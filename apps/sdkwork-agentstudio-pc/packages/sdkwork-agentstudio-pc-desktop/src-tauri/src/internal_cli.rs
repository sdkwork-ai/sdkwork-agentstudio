use crate::framework::{
    child_process::configure_hidden_child_process,
    kernel_host::{
        clear_kernel_host_ownership_marker, platform::resolve_current_platform_service_spec,
        types::KernelHostOwnershipMarker, write_kernel_host_ownership_marker,
    },
    paths::AppPaths,
    services::{
        openclaw_runtime::{
            resolve_bundled_resource_root, ActivatedOpenClawRuntime, OpenClawRuntimeService,
        },
        path_registration::PathRegistrationService,
        supervisor::SupervisorService,
    },
    FrameworkError, Result,
};
#[cfg(windows)]
use std::sync::OnceLock;
use std::{
    ffi::{OsStr, OsString},
    net::{Ipv4Addr, SocketAddr, SocketAddrV4, TcpStream},
    path::{Path, PathBuf},
    process::{Command, Stdio},
    sync::mpsc,
    thread,
    time::{Duration, SystemTime, UNIX_EPOCH},
};
#[cfg(windows)]
use windows_service::{
    define_windows_service,
    service::{
        ServiceControl, ServiceControlAccept, ServiceExitCode, ServiceState, ServiceStatus,
        ServiceType,
    },
    service_control_handler::{self, ServiceControlHandlerResult, ServiceStatusHandle},
    service_dispatcher,
};

const REGISTER_OPENCLAW_CLI_FLAG: &str = "--register-openclaw-cli";
const PREPARE_BUNDLED_OPENCLAW_RUNTIME_FLAG: &str = "--prepare-bundled-openclaw-runtime";
pub(crate) const RUN_OPENCLAW_CLI_FLAG: &str = "--run-openclaw-cli";
const RUN_KERNEL_HOST_SERVICE_FLAG: &str = "--run-kernel-host-service";
const INSTALL_ROOT_FLAG: &str = "--install-root";
const MACHINE_ROOT_FLAG: &str = "--machine-root";
const USER_ROOT_FLAG: &str = "--user-root";
#[cfg(windows)]
const WINDOWS_SERVICE_CONTROLLER_CONNECT_ERROR: i32 = 1063;
#[cfg(windows)]
const WINDOWS_KERNEL_HOST_SERVICE_WAIT_HINT: Duration = Duration::from_secs(30);

#[cfg(windows)]
#[derive(Clone, Debug)]
struct WindowsKernelHostLaunchContext {
    service_name: String,
    machine_root: Option<PathBuf>,
    user_root: Option<PathBuf>,
}

#[cfg(windows)]
static WINDOWS_KERNEL_HOST_LAUNCH_CONTEXT: OnceLock<WindowsKernelHostLaunchContext> =
    OnceLock::new();

#[cfg(windows)]
define_windows_service!(
    ffi_kernel_host_service_main,
    windows_kernel_host_service_main
);

#[derive(Clone, Debug, PartialEq, Eq)]
enum InternalCliAction {
    PrepareBundledOpenClawRuntime {
        install_root: Option<OsString>,
    },
    RegisterOpenClawCli {
        install_root: Option<OsString>,
    },
    RunOpenClawCli(Vec<OsString>),
    RunKernelHostService {
        machine_root: Option<OsString>,
        user_root: Option<OsString>,
    },
}

pub fn maybe_handle_internal_cli_action() -> bool {
    match resolve_internal_cli_action(std::env::args_os()) {
        Some(InternalCliAction::PrepareBundledOpenClawRuntime { install_root }) => {
            if let Err(error) =
                prepare_bundled_openclaw_runtime_for_current_install(install_root.as_deref())
            {
                eprintln!("failed to prepare packaged OpenClaw runtime: {error}");
                std::process::exit(1);
            }
            true
        }
        Some(InternalCliAction::RegisterOpenClawCli { install_root }) => {
            if let Err(error) = register_openclaw_cli_for_current_install(install_root.as_deref()) {
                eprintln!("failed to register embedded openclaw cli: {error}");
                std::process::exit(1);
            }
            true
        }
        Some(InternalCliAction::RunOpenClawCli(cli_args)) => {
            let exit_code = match run_openclaw_cli_for_current_install(&cli_args) {
                Ok(code) => code,
                Err(error) => {
                    eprintln!("failed to run embedded openclaw cli: {error}");
                    1
                }
            };
            std::process::exit(exit_code);
        }
        Some(InternalCliAction::RunKernelHostService {
            machine_root,
            user_root,
        }) => {
            if let Err(error) = run_kernel_host_service_for_current_install(
                machine_root.as_deref(),
                user_root.as_deref(),
            ) {
                eprintln!("failed to run embedded kernel host service: {error}");
                std::process::exit(1);
            }
            true
        }
        None => false,
    }
}

fn resolve_internal_cli_action<I, S>(args: I) -> Option<InternalCliAction>
where
    I: IntoIterator<Item = S>,
    S: AsRef<OsStr>,
{
    let mut args = args.into_iter();
    while let Some(arg) = args.next() {
        if arg.as_ref() == OsStr::new(PREPARE_BUNDLED_OPENCLAW_RUNTIME_FLAG) {
            let remaining = args
                .map(|value| value.as_ref().to_os_string())
                .collect::<Vec<_>>();
            return Some(InternalCliAction::PrepareBundledOpenClawRuntime {
                install_root: parse_install_root_override(&remaining),
            });
        }

        if arg.as_ref() == OsStr::new(REGISTER_OPENCLAW_CLI_FLAG) {
            let remaining = args
                .map(|value| value.as_ref().to_os_string())
                .collect::<Vec<_>>();
            return Some(InternalCliAction::RegisterOpenClawCli {
                install_root: parse_install_root_override(&remaining),
            });
        }

        if arg.as_ref() == OsStr::new(RUN_OPENCLAW_CLI_FLAG) {
            return Some(InternalCliAction::RunOpenClawCli(
                args.map(|value| value.as_ref().to_os_string()).collect(),
            ));
        }

        if arg.as_ref() == OsStr::new(RUN_KERNEL_HOST_SERVICE_FLAG) {
            let mut machine_root = None;
            let mut user_root = None;
            let remaining = args
                .map(|value| value.as_ref().to_os_string())
                .collect::<Vec<_>>();
            let mut index = 0usize;
            while index < remaining.len() {
                if remaining[index].as_os_str() == OsStr::new(MACHINE_ROOT_FLAG) {
                    if let Some(value) = remaining.get(index + 1) {
                        machine_root = Some(value.clone());
                    }
                    index += 2;
                    continue;
                }
                if remaining[index].as_os_str() == OsStr::new(USER_ROOT_FLAG) {
                    if let Some(value) = remaining.get(index + 1) {
                        user_root = Some(value.clone());
                    }
                    index += 2;
                    continue;
                }
                index += 1;
            }
            return Some(InternalCliAction::RunKernelHostService {
                machine_root,
                user_root,
            });
        }
    }

    None
}

fn parse_install_root_override(args: &[OsString]) -> Option<OsString> {
    let mut index = 0usize;
    while index < args.len() {
        if args[index].as_os_str() == OsStr::new(INSTALL_ROOT_FLAG) {
            return args.get(index + 1).cloned();
        }

        let argument_text = args[index].to_string_lossy();
        if let Some(value) = argument_text.strip_prefix("--install-root=") {
            return Some(OsString::from(value));
        }

        index += 1;
    }

    None
}

fn resolve_requested_install_root(install_root: Option<&OsStr>) -> Result<Option<PathBuf>> {
    let Some(install_root) = install_root else {
        return Ok(None);
    };

    let install_root = PathBuf::from(install_root);
    if install_root.as_os_str().is_empty() {
        return Err(FrameworkError::ValidationFailed(
            "embedded openclaw install root override must not be empty".to_string(),
        ));
    }

    Ok(Some(install_root))
}

fn prepare_bundled_openclaw_runtime_for_current_install(
    install_root: Option<&OsStr>,
) -> Result<()> {
    let requested_install_root = resolve_requested_install_root(install_root)?;
    let (machine_root_override, user_root_override) =
        resolve_install_scoped_path_overrides(requested_install_root.as_deref());
    let paths = crate::framework::paths::resolve_paths_from_current_process_with_overrides(
        requested_install_root.clone(),
        machine_root_override,
        user_root_override,
    )?;
    let install_root =
        requested_install_root.unwrap_or_else(|| resolve_install_root_from_paths(&paths));
    let _runtime =
        prepare_bundled_openclaw_runtime_for_paths_and_install_root(&paths, &install_root)?;
    Ok(())
}

fn register_openclaw_cli_for_current_install(install_root: Option<&OsStr>) -> Result<()> {
    let requested_install_root = resolve_requested_install_root(install_root)?;
    let has_install_root_override = requested_install_root.is_some();
    let (machine_root_override, user_root_override) =
        resolve_install_scoped_path_overrides(requested_install_root.as_deref());
    let paths = crate::framework::paths::resolve_paths_from_current_process_with_overrides(
        requested_install_root.clone(),
        machine_root_override,
        user_root_override,
    )?;

    let path_registration = PathRegistrationService::new();
    path_registration.install_openclaw_shims(&paths)?;
    if has_install_root_override {
        path_registration.ensure_install_local_user_bin_on_path(&paths)?;
    } else {
        path_registration.ensure_user_bin_on_path(&paths)?;
    }

    Ok(())
}

#[cfg_attr(not(test), allow(dead_code))]
pub(crate) fn prepare_bundled_openclaw_runtime_for_paths_and_install_root(
    paths: &AppPaths,
    install_root: &Path,
) -> Result<ActivatedOpenClawRuntime> {
    OpenClawRuntimeService::new()
        .ensure_bundled_runtime_from_root(paths, &resolve_bundled_resource_root(install_root)?)
}

#[cfg_attr(not(test), allow(dead_code))]
pub(crate) fn register_openclaw_cli_for_paths_and_install_root(
    paths: &AppPaths,
    _install_root: &Path,
) -> Result<()> {
    let path_registration = PathRegistrationService::new();
    path_registration.install_openclaw_shims(paths)?;
    path_registration.ensure_user_bin_on_path(paths)?;

    Ok(())
}

fn run_openclaw_cli_for_current_install(cli_args: &[OsString]) -> Result<i32> {
    let paths = crate::framework::paths::resolve_paths_from_current_process()?;
    let resource_root = resolve_current_bundled_resource_root()?;
    run_openclaw_cli_for_paths_and_install_root_with_resource_root(&paths, &resource_root, cli_args)
}

fn run_kernel_host_service_for_current_install(
    machine_root: Option<&OsStr>,
    user_root: Option<&OsStr>,
) -> Result<()> {
    let machine_root = machine_root.map(PathBuf::from);
    let user_root = user_root.map(PathBuf::from);

    #[cfg(windows)]
    {
        if try_run_windows_kernel_host_service(machine_root.clone(), user_root.clone())? {
            return Ok(());
        }
    }

    KernelHostRuntimeLoop::start(machine_root, user_root)?.monitor(None)
}

#[cfg_attr(not(test), allow(dead_code))]
pub(crate) fn run_openclaw_cli_for_paths_and_install_root(
    paths: &AppPaths,
    install_root: &Path,
    cli_args: &[OsString],
) -> Result<i32> {
    let resource_root = resolve_bundled_resource_root(install_root)?;
    run_openclaw_cli_for_paths_and_install_root_with_resource_root(paths, &resource_root, cli_args)
}

fn run_openclaw_cli_for_paths_and_install_root_with_resource_root(
    paths: &AppPaths,
    resource_root: &Path,
    cli_args: &[OsString],
) -> Result<i32> {
    let runtime =
        OpenClawRuntimeService::new().ensure_bundled_runtime_from_root(paths, resource_root)?;
    let mut command = Command::new(&runtime.node_path);
    command.arg(&runtime.cli_path);
    command.args(cli_args);
    command.current_dir(&runtime.runtime_dir);
    command.stdin(Stdio::inherit());
    command.stdout(Stdio::inherit());
    command.stderr(Stdio::inherit());
    command.envs(runtime.managed_env());
    configure_hidden_child_process(&mut command);

    let status = command.status()?;
    Ok(status
        .code()
        .unwrap_or(if status.success() { 0 } else { 1 }))
}

fn resolve_current_bundled_resource_root() -> Result<PathBuf> {
    let context: tauri::Context<tauri::Wry> = tauri::generate_context!();
    let resource_dir =
        tauri::utils::platform::resource_dir(context.package_info(), &tauri::utils::Env::default())
            .map_err(|error| {
                crate::framework::FrameworkError::Internal(format!(
                    "failed to resolve current packaged resource directory: {error}"
                ))
            })?;

    resolve_bundled_resource_root(&resource_dir)
}

fn resolve_install_root_from_paths(paths: &AppPaths) -> PathBuf {
    paths.install_root.clone()
}

fn resolve_install_scoped_path_overrides(
    install_root: Option<&Path>,
) -> (Option<PathBuf>, Option<PathBuf>) {
    install_root
        .map(|install_root| {
            (
                Some(install_root.join("machine")),
                Some(install_root.join("app-user-root")),
            )
        })
        .unwrap_or((None, None))
}

fn loopback_port_is_ready(port: u16) -> bool {
    let loopback = SocketAddr::V4(SocketAddrV4::new(Ipv4Addr::LOCALHOST, port));
    TcpStream::connect_timeout(&loopback, Duration::from_millis(200)).is_ok()
}

struct KernelHostRuntimeLoop {
    paths: AppPaths,
    runtime: crate::framework::services::openclaw_runtime::ActivatedOpenClawRuntime,
    supervisor: SupervisorService,
}

impl KernelHostRuntimeLoop {
    fn start(machine_root: Option<PathBuf>, user_root: Option<PathBuf>) -> Result<Self> {
        let paths = crate::framework::paths::resolve_paths_from_current_process_with_overrides(
            None,
            machine_root,
            user_root,
        )?;
        let resource_root = resolve_current_bundled_resource_root()?;
        let runtime = OpenClawRuntimeService::new()
            .ensure_bundled_runtime_from_root(&paths, &resource_root)?;
        let supervisor = SupervisorService::new();
        let service_spec = resolve_current_platform_service_spec(&paths);

        supervisor.configure_openclaw_gateway(&runtime)?;
        supervisor.start_openclaw_gateway(&paths)?;
        write_kernel_host_ownership_marker(
            &paths,
            &KernelHostOwnershipMarker {
                service_name: service_spec.service_name,
                active_port: runtime.gateway_port,
                started_at_ms: SystemTime::now()
                    .duration_since(UNIX_EPOCH)
                    .unwrap_or_default()
                    .as_millis() as u64,
                host_pid: Some(std::process::id()),
            },
        )?;

        Ok(Self {
            paths,
            runtime,
            supervisor,
        })
    }

    fn monitor(self, shutdown_rx: Option<&mpsc::Receiver<()>>) -> Result<()> {
        loop {
            match shutdown_rx {
                Some(receiver) => match receiver.recv_timeout(Duration::from_secs(1)) {
                    Ok(_) | Err(mpsc::RecvTimeoutError::Disconnected) => {
                        self.shutdown();
                        return Ok(());
                    }
                    Err(mpsc::RecvTimeoutError::Timeout) => {}
                },
                None => thread::sleep(Duration::from_secs(1)),
            }

            if loopback_port_is_ready(self.runtime.gateway_port) {
                continue;
            }

            self.shutdown();
            return Err(FrameworkError::Conflict(format!(
                "kernel host lost the OpenClaw gateway on 127.0.0.1:{}",
                self.runtime.gateway_port
            )));
        }
    }

    fn shutdown(&self) {
        let _ = self.supervisor.stop_openclaw_gateway();
        let _ = clear_kernel_host_ownership_marker(&self.paths);
    }
}

#[cfg(windows)]
fn try_run_windows_kernel_host_service(
    machine_root: Option<PathBuf>,
    user_root: Option<PathBuf>,
) -> Result<bool> {
    let paths = crate::framework::paths::resolve_paths_from_current_process_with_overrides(
        None,
        machine_root.clone(),
        user_root.clone(),
    )?;
    let service_name = resolve_current_platform_service_spec(&paths).service_name;
    WINDOWS_KERNEL_HOST_LAUNCH_CONTEXT.get_or_init(|| WindowsKernelHostLaunchContext {
        service_name: service_name.clone(),
        machine_root,
        user_root,
    });

    match service_dispatcher::start(service_name, ffi_kernel_host_service_main) {
        Ok(()) => Ok(true),
        Err(error)
            if matches!(
                &error,
                windows_service::Error::Winapi(inner)
                    if inner.raw_os_error() == Some(WINDOWS_SERVICE_CONTROLLER_CONNECT_ERROR)
            ) =>
        {
            Ok(false)
        }
        Err(error) => Err(map_windows_service_error(error)),
    }
}

#[cfg(windows)]
fn windows_kernel_host_service_main(_arguments: Vec<OsString>) {
    let _ = run_windows_kernel_host_service();
}

#[cfg(windows)]
fn run_windows_kernel_host_service() -> Result<()> {
    let launch_context = WINDOWS_KERNEL_HOST_LAUNCH_CONTEXT
        .get()
        .cloned()
        .ok_or_else(|| {
            FrameworkError::Internal("missing windows kernel host launch context".to_string())
        })?;
    let (shutdown_tx, shutdown_rx) = mpsc::channel();
    let status_handle =
        service_control_handler::register(&launch_context.service_name, move |control_event| {
            match control_event {
                ServiceControl::Stop => {
                    let _ = shutdown_tx.send(());
                    ServiceControlHandlerResult::NoError
                }
                ServiceControl::Interrogate => ServiceControlHandlerResult::NoError,
                _ => ServiceControlHandlerResult::NotImplemented,
            }
        })
        .map_err(map_windows_service_error)?;

    set_windows_service_status(
        &status_handle,
        ServiceState::StartPending,
        ServiceControlAccept::empty(),
        ServiceExitCode::Win32(0),
        WINDOWS_KERNEL_HOST_SERVICE_WAIT_HINT,
    )?;

    let runtime_loop =
        match KernelHostRuntimeLoop::start(launch_context.machine_root, launch_context.user_root) {
            Ok(runtime_loop) => runtime_loop,
            Err(error) => {
                let _ = set_windows_service_status(
                    &status_handle,
                    ServiceState::Stopped,
                    ServiceControlAccept::empty(),
                    ServiceExitCode::Win32(1),
                    Duration::default(),
                );
                return Err(error);
            }
        };

    set_windows_service_status(
        &status_handle,
        ServiceState::Running,
        ServiceControlAccept::STOP,
        ServiceExitCode::Win32(0),
        Duration::default(),
    )?;

    let result = runtime_loop.monitor(Some(&shutdown_rx));
    let exit_code = if result.is_ok() {
        ServiceExitCode::Win32(0)
    } else {
        ServiceExitCode::Win32(1)
    };
    let _ = set_windows_service_status(
        &status_handle,
        ServiceState::Stopped,
        ServiceControlAccept::empty(),
        exit_code,
        Duration::default(),
    );
    result
}

#[cfg(windows)]
fn set_windows_service_status(
    status_handle: &ServiceStatusHandle,
    current_state: ServiceState,
    controls_accepted: ServiceControlAccept,
    exit_code: ServiceExitCode,
    wait_hint: Duration,
) -> Result<()> {
    status_handle
        .set_service_status(ServiceStatus {
            service_type: ServiceType::OWN_PROCESS,
            current_state,
            controls_accepted,
            exit_code,
            checkpoint: 0,
            wait_hint,
            process_id: None,
        })
        .map_err(map_windows_service_error)
}

#[cfg(windows)]
fn map_windows_service_error(error: windows_service::Error) -> FrameworkError {
    match error {
        windows_service::Error::Winapi(inner) => FrameworkError::Io(inner),
        other => FrameworkError::Internal(format!("windows service error: {other}")),
    }
}

#[cfg(test)] // WORKSPACE-PATH:allow-fixture-block: this module is the file's #[cfg(test)] unit-test fixture data
mod tests {
    use super::{
        prepare_bundled_openclaw_runtime_for_current_install,
        prepare_bundled_openclaw_runtime_for_paths_and_install_root,
        register_openclaw_cli_for_paths_and_install_root, resolve_internal_cli_action,
        run_openclaw_cli_for_paths_and_install_root, InternalCliAction,
        PREPARE_BUNDLED_OPENCLAW_RUNTIME_FLAG, RUN_OPENCLAW_CLI_FLAG,
    };
    use crate::framework::{
        openclaw_release::required_openclaw_node_version,
        paths::resolve_paths_for_root,
        services::{
            kernel_runtime_authority::KernelRuntimeAuthorityService,
            openclaw_channel_config::write_test_openclaw_channel_metadata,
            openclaw_runtime::BundledOpenClawManifest,
        },
    };
    use sha2::{Digest, Sha256};
    use std::{
        env,
        ffi::{OsStr, OsString},
        fs,
    };

    const TEST_BUNDLED_OPENCLAW_VERSION: &str = env!("SDKWORK_BUNDLED_OPENCLAW_VERSION");
    const PREPARED_RUNTIME_SIDECAR_MANIFEST_FILE_NAME: &str = ".sdkwork-openclaw-runtime.json";

    struct ScopedEnvVarGuard {
        key: &'static str,
        original_value: Option<OsString>,
    }

    impl ScopedEnvVarGuard {
        fn set(key: &'static str, value: &OsStr) -> Self {
            let original_value = env::var_os(key);
            unsafe {
                env::set_var(key, value);
            }
            Self {
                key,
                original_value,
            }
        }
    }

    impl Drop for ScopedEnvVarGuard {
        fn drop(&mut self) {
            unsafe {
                if let Some(original_value) = &self.original_value {
                    env::set_var(self.key, original_value);
                } else {
                    env::remove_var(self.key);
                }
            }
        }
    }

    fn openclaw_config_file_path(paths: &crate::framework::paths::AppPaths) -> std::path::PathBuf {
        KernelRuntimeAuthorityService::new()
            .active_config_file_path("openclaw", paths)
            .unwrap_or_else(|_| {
                paths
                    .kernel_paths("openclaw")
                    .map(|kernel| kernel.config_file)
                    .unwrap_or_else(|_| paths.openclaw_config_file.clone())
            })
    }

    #[test]
    fn detects_internal_register_openclaw_cli_action() {
        let action = resolve_internal_cli_action(["agent-studio.exe", "--register-openclaw-cli"]);

        assert_eq!(
            action,
            Some(InternalCliAction::RegisterOpenClawCli { install_root: None })
        );
    }

    #[test]
    fn detects_internal_register_openclaw_cli_action_with_install_root_override() {
        let action = resolve_internal_cli_action([
            "agent-studio.exe",
            "--register-openclaw-cli",
            "--install-root",
            "C:\\Program Files\\Agent Studio",
        ]);

        assert_eq!(
            action,
            Some(InternalCliAction::RegisterOpenClawCli {
                install_root: Some(OsString::from("C:\\Program Files\\Agent Studio")),
            })
        );
    }

    #[test]
    fn detects_internal_prepare_bundled_openclaw_runtime_action() {
        let action =
            resolve_internal_cli_action(["agent-studio.exe", PREPARE_BUNDLED_OPENCLAW_RUNTIME_FLAG]);

        assert_eq!(
            action,
            Some(InternalCliAction::PrepareBundledOpenClawRuntime { install_root: None })
        );
    }

    #[test]
    fn detects_internal_prepare_bundled_openclaw_runtime_action_with_install_root_override() {
        let action = resolve_internal_cli_action([
            "agent-studio.exe",
            PREPARE_BUNDLED_OPENCLAW_RUNTIME_FLAG,
            "--install-root",
            "/opt/agent-studio",
        ]);

        assert_eq!(
            action,
            Some(InternalCliAction::PrepareBundledOpenClawRuntime {
                install_root: Some(OsString::from("/opt/agent-studio")),
            })
        );
    }

    #[test]
    fn detects_internal_run_openclaw_cli_action_and_forwards_remaining_args() {
        let action = resolve_internal_cli_action([
            "agent-studio.exe",
            RUN_OPENCLAW_CLI_FLAG,
            "doctor",
            "--json",
        ]);

        assert_eq!(
            action,
            Some(InternalCliAction::RunOpenClawCli(vec![
                OsString::from("doctor"),
                OsString::from("--json"),
            ]))
        );
    }

    #[test]
    fn detects_kernel_host_service_action_with_path_overrides() {
        let action = resolve_internal_cli_action([
            "agent-studio.exe",
            "--run-kernel-host-service",
            "--machine-root",
            "C:\\ProgramData\\SdkWork\\CrawStudio",
            "--user-root",
            "C:\\Users\\admin\\.sdkwork\\crawstudio",
        ]);

        assert_eq!(
            action,
            Some(InternalCliAction::RunKernelHostService {
                machine_root: Some(OsString::from("C:\\ProgramData\\SdkWork\\CrawStudio")),
                user_root: Some(OsString::from("C:\\Users\\admin\\.sdkwork\\crawstudio")),
            })
        );
    }

    #[test]
    fn internal_registration_writes_user_shell_shims_without_preparing_runtime() {
        let root = tempfile::tempdir().expect("temp dir");
        let paths = resolve_paths_for_root(root.path()).expect("paths");

        register_openclaw_cli_for_paths_and_install_root(&paths, &paths.install_root)
            .expect("register openclaw cli");

        assert!(paths.user_bin_dir.join("openclaw.cmd").exists());
        assert!(paths.user_bin_dir.join("openclaw.ps1").exists());
        assert!(paths.user_bin_dir.join("openclaw").exists());

        let cmd = fs::read_to_string(paths.user_bin_dir.join("openclaw.cmd")).expect("cmd shim");
        assert!(cmd.contains(RUN_OPENCLAW_CLI_FLAG));
        assert!(!cmd.contains("OPENCLAW_GATEWAY_TOKEN"));

        let ps1 = fs::read_to_string(paths.user_bin_dir.join("openclaw.ps1")).expect("ps1 shim");
        assert!(ps1.contains(RUN_OPENCLAW_CLI_FLAG));
        assert!(!ps1.contains("OPENCLAW_GATEWAY_TOKEN"));

        let unix = fs::read_to_string(paths.user_bin_dir.join("openclaw")).expect("unix shim");
        assert!(unix.contains(RUN_OPENCLAW_CLI_FLAG));
        assert!(!unix.contains("OPENCLAW_GATEWAY_TOKEN"));

        let profile =
            fs::read_to_string(paths.user_root.join("profile.sh")).expect("managed profile");
        let export_line = format!(
            "export PATH=\"{}:$PATH\"",
            paths.user_bin_dir.to_string_lossy()
        );
        assert!(profile.contains(export_line.as_str()));
        let managed_runtime_entries = fs::read_dir(&paths.openclaw_runtime_dir)
            .map(|entries| entries.filter_map(|entry| entry.ok()).count())
            .unwrap_or(0);
        assert_eq!(managed_runtime_entries, 0);
        assert!(!openclaw_config_file_path(&paths).exists());
    }

    #[test]
    fn internal_prepare_runtime_prewarms_managed_install_without_touching_shell_shims() {
        let root = tempfile::tempdir().expect("temp dir");
        let paths = resolve_paths_for_root(root.path()).expect("paths");
        create_bundled_runtime_fixture(&paths.install_root, None);

        let runtime = prepare_bundled_openclaw_runtime_for_paths_and_install_root(
            &paths,
            &paths.install_root,
        )
        .expect("prepare packaged OpenClaw runtime");

        assert!(runtime.install_dir.join("manifest.json").exists());
        assert!(runtime.runtime_dir.exists());
        assert!(runtime.node_path.exists());
        assert!(runtime.cli_path.exists());
        assert_eq!(paths.user_bin_dir.join("openclaw.cmd").exists(), false);
        assert_eq!(paths.user_bin_dir.join("openclaw.ps1").exists(), false);
        assert_eq!(paths.user_bin_dir.join("openclaw").exists(), false);
    }

    #[test]
    fn internal_prepare_runtime_with_install_root_override_avoids_global_machine_and_user_roots() {
        let root = tempfile::tempdir().expect("temp dir");
        let install_root = root.path().join("install-root");
        let invalid_program_data = root.path().join("programdata-sentinel");
        let invalid_user_profile = root.path().join("userprofile-sentinel");
        fs::write(&invalid_program_data, "sentinel").expect("write invalid ProgramData sentinel");
        fs::write(&invalid_user_profile, "sentinel").expect("write invalid USERPROFILE sentinel");
        create_bundled_runtime_fixture(&install_root, None);
        let _program_data_guard =
            ScopedEnvVarGuard::set("ProgramData", invalid_program_data.as_os_str());
        let _user_profile_guard =
            ScopedEnvVarGuard::set("USERPROFILE", invalid_user_profile.as_os_str());

        prepare_bundled_openclaw_runtime_for_current_install(Some(install_root.as_os_str()))
            .expect("prepare packaged OpenClaw runtime with install-root override");

        let prepared_runtime_root = install_root.join("runtimes").join("openclaw");
        let prepared_runtime_entries = fs::read_dir(&prepared_runtime_root)
            .expect("read prepared runtime root")
            .filter_map(|entry| entry.ok())
            .map(|entry| entry.path())
            .collect::<Vec<_>>();

        assert!(
            prepared_runtime_entries
                .iter()
                .any(|entry| entry.join("manifest.json").exists()),
            "install-root override should still materialize a packaged OpenClaw runtime install",
        );
        assert!(
            install_root
                .join("app-user-root")
                .join(".openclaw")
                .exists(),
            "install-root override should keep managed user state inside the install root during prewarm",
        );
        assert!(
            install_root.join("machine").join("state").exists(),
            "install-root override should keep managed machine state inside the install root during prewarm",
        );
    }

    #[test]
    fn internal_run_openclaw_cli_executes_managed_runtime_with_ephemeral_gateway_env() {
        let root = tempfile::tempdir().expect("temp dir");
        let paths = resolve_paths_for_root(root.path()).expect("paths");
        let capture_path = paths.user_root.join("openclaw-cli-capture.json");
        create_bundled_runtime_fixture(&paths.install_root, Some(&capture_path));
        fs::write(
            &paths.openclaw_config_file,
            "{\n  \"gateway\": {\n    \"auth\": {\n      \"token\": \"test-token\"\n    }\n  }\n}\n",
        )
        .expect("seed openclaw config");

        let exit_code = run_openclaw_cli_for_paths_and_install_root(
            &paths,
            &paths.install_root,
            &[OsString::from("doctor"), OsString::from("--json")],
        )
        .expect("run embedded openclaw cli");

        assert_eq!(exit_code, 0);
        let capture = fs::read_to_string(&capture_path).expect("capture file");
        assert!(capture.contains("\"doctor\""));
        assert!(capture.contains("\"--json\""));
        assert!(capture.contains("\"test-token\""));
    }

    #[test]
    fn internal_run_openclaw_cli_uses_external_node_when_runtime_manifest_has_no_bundled_node_entrypoint(
    ) {
        let root = tempfile::tempdir().expect("temp dir");
        let paths = resolve_paths_for_root(root.path()).expect("paths");
        let capture_path = paths
            .user_root
            .join("openclaw-cli-external-node-capture.json");
        create_bundled_runtime_fixture(&paths.install_root, Some(&capture_path));

        let exit_code = run_openclaw_cli_for_paths_and_install_root(
            &paths,
            &paths.install_root,
            &[OsString::from("doctor"), OsString::from("--json")],
        )
        .expect("run openclaw cli with external node-only manifest");

        assert_eq!(exit_code, 0);
        let capture = fs::read_to_string(&capture_path).expect("capture file");
        assert!(capture.contains("\"doctor\""));
        assert!(capture.contains("\"--json\""));
    }

    #[test]
    fn internal_openclaw_cli_child_process_uses_hidden_window_policy() {
        let source = include_str!("internal_cli.rs");
        let hidden_child_process_call = [
            "command.envs(runtime.managed_env());",
            "configure_hidden_child_process(&mut command);",
        ]
        .join("\n    ");

        assert!(
            source.contains(&hidden_child_process_call),
            "internal OpenClaw CLI bridge must hide the child Node process on Windows"
        );
    }

    #[test]
    fn bundled_runtime_fixture_materializes_node_less_manifest_and_sidecar() {
        let root = tempfile::tempdir().expect("temp dir");
        let paths = resolve_paths_for_root(root.path()).expect("paths");
        create_bundled_runtime_fixture(&paths.install_root, None);

        let resource_root = paths.install_root.join("openclaw");
        let manifest = serde_json::from_str::<serde_json::Value>(
            &fs::read_to_string(resource_root.join("manifest.json")).expect("manifest json"),
        )
        .expect("packaged OpenClaw manifest value");

        assert!(manifest.get("nodeRelativePath").is_none());
        assert!(!resource_root.join("runtime").join("node").exists());
        assert!(resource_root
            .join("runtime")
            .join(PREPARED_RUNTIME_SIDECAR_MANIFEST_FILE_NAME)
            .exists());
    }

    fn create_bundled_runtime_fixture(
        install_root: &std::path::Path,
        capture_path: Option<&std::path::Path>,
    ) {
        let resource_root = install_root.join("openclaw");
        let runtime_root = resource_root.join("runtime");
        let cli_path = runtime_root
            .join("package")
            .join("node_modules")
            .join("openclaw")
            .join("openclaw.mjs");
        let openclaw_package_json_path = runtime_root
            .join("package")
            .join("node_modules")
            .join("openclaw")
            .join("package.json");
        let carbon_package_json_path = runtime_root
            .join("package")
            .join("node_modules")
            .join("@buape")
            .join("carbon")
            .join("package.json");
        let client_bedrock_package_json_path = runtime_root
            .join("package")
            .join("node_modules")
            .join("@aws-sdk")
            .join("client-bedrock")
            .join("package.json");

        fs::create_dir_all(cli_path.parent().expect("cli parent")).expect("cli dir");
        write_test_openclaw_channel_metadata(&runtime_root);
        fs::create_dir_all(
            openclaw_package_json_path
                .parent()
                .expect("openclaw package json parent"),
        )
        .expect("openclaw package json dir");
        fs::create_dir_all(
            carbon_package_json_path
                .parent()
                .expect("carbon package json parent"),
        )
        .expect("carbon package json dir");
        fs::create_dir_all(
            client_bedrock_package_json_path
                .parent()
                .expect("client-bedrock package json parent"),
        )
        .expect("client-bedrock package json dir");
        let cli_source = match capture_path {
            Some(capture_path) => format!(
                "import fs from 'node:fs';\nconst payload = {{ args: process.argv.slice(2), token: process.env.OPENCLAW_GATEWAY_TOKEN ?? null }};\nfs.writeFileSync({}, `${{JSON.stringify(payload)}}\\n`);\n",
                serde_json::to_string(&capture_path.to_string_lossy().into_owned()).expect("capture path json"),
            ),
            None => "console.log('openclaw');\n".to_string(),
        };
        fs::write(&cli_path, cli_source).expect("cli file");
        fs::write(
            &openclaw_package_json_path,
            format!(
                concat!(
                    "{{\n",
                    "  \"name\": \"openclaw\",\n",
                    "  \"version\": \"{}\"\n",
                    "}}\n"
                ),
                TEST_BUNDLED_OPENCLAW_VERSION
            ),
        )
        .expect("openclaw package json");
        fs::write(
            &carbon_package_json_path,
            concat!(
                "{\n",
                "  \"name\": \"@buape/carbon\",\n",
                "  \"version\": \"0.0.10\"\n",
                "}\n"
            ),
        )
        .expect("carbon package json");
        fs::write(
            &client_bedrock_package_json_path,
            concat!(
                "{\n",
                "  \"name\": \"@aws-sdk/client-bedrock\",\n",
                "  \"version\": \"3.1020.0\"\n",
                "}\n"
            ),
        )
        .expect("client-bedrock package json");

        let platform = match crate::platform::current_target() {
            "windows" => "windows",
            "macos" => "macos",
            "linux" => "linux",
            other => other,
        };
        let arch = match crate::platform::current_arch() {
            "x86_64" => "x64",
            "aarch64" => "arm64",
            other => other,
        };

        let manifest = BundledOpenClawManifest {
            schema_version: 2,
            runtime_id: "openclaw".to_string(),
            openclaw_version: TEST_BUNDLED_OPENCLAW_VERSION.to_string(),
            required_external_runtimes: vec!["nodejs".to_string()],
            required_external_runtime_versions: std::collections::BTreeMap::from([(
                "nodejs".to_string(),
                required_openclaw_node_version().to_string(),
            )]),
            platform: platform.to_string(),
            arch: arch.to_string(),
            cli_relative_path: "runtime/package/node_modules/openclaw/openclaw.mjs".to_string(),
        };

        fs::write(
            resource_root.join("manifest.json"),
            format!(
                "{}\n",
                serde_json::to_string_pretty(&manifest).expect("manifest json")
            ),
        )
        .expect("manifest file");
        write_runtime_sidecar_manifest(&runtime_root, &manifest);
    }

    fn write_runtime_sidecar_manifest(
        runtime_dir: &std::path::Path,
        manifest: &BundledOpenClawManifest,
    ) {
        let integrity_files = [
            manifest
                .cli_relative_path
                .trim_start_matches("runtime/")
                .to_string(),
            "package/node_modules/openclaw/package.json".to_string(),
            "package/node_modules/@buape/carbon/package.json".to_string(),
            "package/node_modules/@aws-sdk/client-bedrock/package.json".to_string(),
        ]
        .into_iter()
        .map(|relative_path| {
            let absolute_path = runtime_dir.join(&relative_path);
            let metadata = fs::metadata(&absolute_path).expect("runtime integrity file metadata");
            serde_json::json!({
                "relativePath": relative_path,
                "size": metadata.len(),
                "sha256": sha256_file_hex(&absolute_path),
            })
        })
        .collect::<Vec<_>>();

        let sidecar = serde_json::json!({
            "schemaVersion": manifest.schema_version,
            "runtimeId": manifest.runtime_id,
            "openclawVersion": manifest.openclaw_version,
            "requiredExternalRuntimes": manifest.required_external_runtimes,
            "requiredExternalRuntimeVersions": manifest.required_external_runtime_versions,
            "platform": manifest.platform,
            "arch": manifest.arch,
            "cliRelativePath": manifest.cli_relative_path,
            "runtimeIntegrity": {
                "schemaVersion": 1,
                "files": integrity_files,
            },
        });
        fs::write(
            runtime_dir.join(PREPARED_RUNTIME_SIDECAR_MANIFEST_FILE_NAME),
            format!(
                "{}\n",
                serde_json::to_string_pretty(&sidecar).expect("runtime sidecar json")
            ),
        )
        .expect("runtime sidecar manifest");
    }

    fn sha256_file_hex(path: &std::path::Path) -> String {
        let mut file = fs::File::open(path).expect("runtime integrity file");
        let mut hasher = Sha256::new();
        let mut buffer = [0_u8; 8192];
        loop {
            let bytes_read =
                std::io::Read::read(&mut file, &mut buffer).expect("read runtime integrity file");
            if bytes_read == 0 {
                break;
            }
            hasher.update(&buffer[..bytes_read]);
        }
        let digest = hasher.finalize();
        let mut hex = String::with_capacity(digest.len() * 2);
        for byte in digest {
            use std::fmt::Write as _;
            let _ = write!(&mut hex, "{byte:02x}");
        }
        hex
    }
}
