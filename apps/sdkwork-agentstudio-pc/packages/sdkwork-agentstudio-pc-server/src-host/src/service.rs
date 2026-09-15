use std::{
    collections::BTreeMap,
    fs,
    path::{Path, PathBuf},
    process::{Command, Stdio},
    sync::Arc,
};

use serde::Serialize;
use serde_json::json;

use crate::{cli::ClawServerServicePlatform, config::ResolvedServerRuntimeConfig};

const LINUX_SERVICE_NAME: &str = "agentstudio-server";
const MACOS_SERVICE_NAME: &str = "ai.sdkwork.claw.server";
const WINDOWS_SERVICE_NAME: &str = "ClawServer";
#[cfg(windows)]
const WINDOWS_CREATE_NO_WINDOW: u32 = 0x0800_0000;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ServerServiceManifestProjectionRequest {
    pub platform: ClawServerServicePlatform,
    pub executable_path: PathBuf,
    pub config_path: PathBuf,
    pub runtime_config: ResolvedServerRuntimeConfig,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectedServerServiceManifest {
    pub platform: String,
    pub service_manager: String,
    pub service_name: String,
    pub service_config_path: PathBuf,
    pub executable_path: PathBuf,
    pub config_file: PathBuf,
    pub runtime_args: Vec<String>,
    pub runtime_environment: BTreeMap<String, String>,
    pub working_directory: PathBuf,
    pub stdout_log_path: PathBuf,
    pub stderr_log_path: PathBuf,
    pub runtime_config: ResolvedServerRuntimeConfig,
    pub artifact_content: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ServerServiceLifecycleAction {
    Install,
    Start,
    Stop,
    Restart,
    Status,
}

impl ServerServiceLifecycleAction {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Install => "install",
            Self::Start => "start",
            Self::Stop => "stop",
            Self::Restart => "restart",
            Self::Status => "status",
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ServerServiceLifecycleRequest {
    pub action: ServerServiceLifecycleAction,
    pub platform: ClawServerServicePlatform,
    pub executable_path: PathBuf,
    pub config_path: PathBuf,
    pub runtime_config: ResolvedServerRuntimeConfig,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ServerServiceShellCommand {
    pub program: String,
    pub args: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PlannedServerServiceLifecycleAction {
    pub action: String,
    pub platform: String,
    pub service_manager: String,
    pub service_name: String,
    pub service_config_path: PathBuf,
    pub executable_path: PathBuf,
    pub config_file: PathBuf,
    pub commands: Vec<ServerServiceShellCommand>,
    pub runtime_config: ResolvedServerRuntimeConfig,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub manifest: Option<ProjectedServerServiceManifest>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ServerServiceCommandRunOutput {
    pub exit_code: Option<i32>,
    pub stdout: String,
    pub stderr: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ServerServiceCommandResult {
    pub program: String,
    pub args: Vec<String>,
    pub exit_code: Option<i32>,
    pub stdout: String,
    pub stderr: String,
    pub success: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ServerServiceExecutionResult {
    pub action: String,
    pub platform: String,
    pub service_manager: String,
    pub service_name: String,
    pub service_config_path: PathBuf,
    pub executable_path: PathBuf,
    pub config_file: PathBuf,
    pub commands: Vec<ServerServiceShellCommand>,
    pub runtime_config: ResolvedServerRuntimeConfig,
    pub artifact_written: bool,
    pub written_files: Vec<PathBuf>,
    pub success: bool,
    pub state: String,
    pub command_results: Vec<ServerServiceCommandResult>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ServerRuntimeContract {
    pub platform: ClawServerServicePlatform,
    pub executable_path: PathBuf,
    pub config_path: PathBuf,
    pub runtime_config: ResolvedServerRuntimeConfig,
}

impl ServerRuntimeContract {
    pub fn lifecycle_request(
        &self,
        action: ServerServiceLifecycleAction,
    ) -> ServerServiceLifecycleRequest {
        ServerServiceLifecycleRequest {
            action,
            platform: self.platform,
            executable_path: self.executable_path.clone(),
            config_path: self.config_path.clone(),
            runtime_config: self.runtime_config.clone(),
        }
    }
}

pub fn execute_server_service_action(
    control_plane: &ServerServiceControlPlaneHandle,
    runtime_contract: &ServerRuntimeContract,
    action: ServerServiceLifecycleAction,
) -> Result<ServerServiceExecutionResult, String> {
    control_plane.execute(runtime_contract.lifecycle_request(action))
}

pub trait ServerServiceRuntime {
    fn write_text_file(&mut self, path: &Path, contents: &str) -> Result<(), String>;
    fn run_command(
        &mut self,
        command: &ServerServiceShellCommand,
    ) -> Result<ServerServiceCommandRunOutput, String>;
}

pub trait ServerServiceControlPlane: Send + Sync {
    fn execute(
        &self,
        request: ServerServiceLifecycleRequest,
    ) -> Result<ServerServiceExecutionResult, String>;
}

#[derive(Clone)]
pub struct ServerServiceControlPlaneHandle {
    backend: Arc<dyn ServerServiceControlPlane>,
}

impl std::fmt::Debug for ServerServiceControlPlaneHandle {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("ServerServiceControlPlaneHandle").finish()
    }
}

impl ServerServiceControlPlaneHandle {
    pub fn os() -> Self {
        Self {
            backend: Arc::new(OsServerServiceControlPlane),
        }
    }

    #[cfg_attr(not(test), allow(dead_code))]
    pub fn with_backend(backend: Arc<dyn ServerServiceControlPlane>) -> Self {
        Self { backend }
    }

    pub fn execute(
        &self,
        request: ServerServiceLifecycleRequest,
    ) -> Result<ServerServiceExecutionResult, String> {
        self.backend.execute(request)
    }
}

#[derive(Debug, Default)]
pub struct OsServerServiceRuntime;

#[derive(Debug, Default)]
struct OsServerServiceControlPlane;

impl ServerServiceRuntime for OsServerServiceRuntime {
    fn write_text_file(&mut self, path: &Path, contents: &str) -> Result<(), String> {
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent).map_err(|error| {
                format!(
                    "failed to create service artifact directory {}: {error}",
                    parent.display()
                )
            })?;
        }
        fs::write(path, contents).map_err(|error| {
            format!(
                "failed to write service artifact {}: {error}",
                path.display()
            )
        })
    }

    fn run_command(
        &mut self,
        command: &ServerServiceShellCommand,
    ) -> Result<ServerServiceCommandRunOutput, String> {
        let mut process = Command::new(&command.program);
        process.args(&command.args);
        process.stdin(Stdio::null());
        process.stdout(Stdio::piped());
        process.stderr(Stdio::piped());
        #[cfg(windows)]
        configure_hidden_service_command(&mut process);
        let output = process.output().map_err(|error| {
            format!(
                "failed to run service command {}: {error}",
                render_shell_command(command)
            )
        })?;

        Ok(ServerServiceCommandRunOutput {
            exit_code: output.status.code(),
            stdout: String::from_utf8_lossy(&output.stdout).to_string(),
            stderr: String::from_utf8_lossy(&output.stderr).to_string(),
        })
    }
}

#[cfg(windows)]
fn configure_hidden_service_command(process: &mut Command) {
    use std::os::windows::process::CommandExt;

    process.creation_flags(windows_hidden_service_command_creation_flags());
}

#[cfg(windows)]
fn windows_hidden_service_command_creation_flags() -> u32 {
    WINDOWS_CREATE_NO_WINDOW
}

impl ServerServiceControlPlane for OsServerServiceControlPlane {
    fn execute(
        &self,
        request: ServerServiceLifecycleRequest,
    ) -> Result<ServerServiceExecutionResult, String> {
        let plan = plan_server_service_lifecycle(request);
        let mut runtime = OsServerServiceRuntime;
        execute_server_service_lifecycle_with_runtime(&plan, &mut runtime)
    }
}

#[cfg_attr(not(test), allow(dead_code))]
pub fn current_service_platform() -> ClawServerServicePlatform {
    ClawServerServicePlatform::default_current()
}

pub fn project_service_manifest(
    request: ServerServiceManifestProjectionRequest,
) -> ProjectedServerServiceManifest {
    let runtime_args = vec![
        "run".to_string(),
        "--config".to_string(),
        normalize_path_for_manifest(&request.config_path),
    ];
    let working_directory = resolve_working_directory(&request.executable_path);
    let stdout_log_path = request
        .runtime_config
        .data_dir
        .join("logs")
        .join("agentstudio-server.log");
    let stderr_log_path = request
        .runtime_config
        .data_dir
        .join("logs")
        .join("agentstudio-server.error.log");
    let runtime_environment = BTreeMap::from([(
        "CLAW_SERVER_SERVICE_MANAGER".to_string(),
        request.platform.manager_kind().to_string(),
    )]);

    let (service_manager, service_name, service_config_path, artifact_content) =
        match request.platform {
            ClawServerServicePlatform::Linux => {
                let service_config_path = PathBuf::from("/etc/systemd/system/agentstudio-server.service");
                (
                    "systemd".to_string(),
                    LINUX_SERVICE_NAME.to_string(),
                    service_config_path,
                    build_linux_systemd_unit(
                        &request.executable_path,
                        &runtime_args,
                        &runtime_environment,
                        &working_directory,
                        &stdout_log_path,
                        &stderr_log_path,
                    ),
                )
            }
            ClawServerServicePlatform::Macos => {
                let service_config_path =
                    PathBuf::from("/Library/LaunchDaemons/ai.sdkwork.claw.server.plist");
                (
                    "launchd".to_string(),
                    MACOS_SERVICE_NAME.to_string(),
                    service_config_path,
                    build_macos_launchd_plist(
                        MACOS_SERVICE_NAME,
                        &request.executable_path,
                        &runtime_args,
                        &runtime_environment,
                        &working_directory,
                        &stdout_log_path,
                        &stderr_log_path,
                    ),
                )
            }
            ClawServerServicePlatform::Windows => {
                let service_config_path = request
                    .runtime_config
                    .data_dir
                    .join("service")
                    .join("windows-service.json");
                (
                    "windowsService".to_string(),
                    WINDOWS_SERVICE_NAME.to_string(),
                    service_config_path,
                    build_windows_service_manifest(
                        WINDOWS_SERVICE_NAME,
                        &request.executable_path,
                        &runtime_args,
                        &runtime_environment,
                        &working_directory,
                        &stdout_log_path,
                        &stderr_log_path,
                    ),
                )
            }
        };

    ProjectedServerServiceManifest {
        platform: request.platform.as_str().to_string(),
        service_manager,
        service_name,
        service_config_path,
        executable_path: request.executable_path,
        config_file: request.config_path,
        runtime_args,
        runtime_environment,
        working_directory,
        stdout_log_path,
        stderr_log_path,
        runtime_config: request.runtime_config,
        artifact_content,
    }
}

pub fn plan_server_service_lifecycle(
    request: ServerServiceLifecycleRequest,
) -> PlannedServerServiceLifecycleAction {
    let manifest = project_service_manifest(ServerServiceManifestProjectionRequest {
        platform: request.platform,
        executable_path: request.executable_path.clone(),
        config_path: request.config_path.clone(),
        runtime_config: request.runtime_config.clone(),
    });
    let commands = build_service_lifecycle_commands(request.action, request.platform, &manifest);

    PlannedServerServiceLifecycleAction {
        action: request.action.as_str().to_string(),
        platform: request.platform.as_str().to_string(),
        service_manager: manifest.service_manager.clone(),
        service_name: manifest.service_name.clone(),
        service_config_path: manifest.service_config_path.clone(),
        executable_path: manifest.executable_path.clone(),
        config_file: manifest.config_file.clone(),
        commands,
        runtime_config: request.runtime_config,
        manifest: if matches!(request.action, ServerServiceLifecycleAction::Install) {
            Some(manifest)
        } else {
            None
        },
    }
}

pub fn execute_server_service_lifecycle_with_runtime<R: ServerServiceRuntime>(
    plan: &PlannedServerServiceLifecycleAction,
    runtime: &mut R,
) -> Result<ServerServiceExecutionResult, String> {
    let mut artifact_written = false;
    let mut written_files = Vec::new();
    if let Some(manifest) = plan.manifest.as_ref() {
        let runtime_config = serde_json::to_string_pretty(&manifest.runtime_config)
            .map_err(|error| format!("failed to serialize service install config: {error}"))?;
        runtime.write_text_file(&manifest.config_file, &runtime_config)?;
        written_files.push(manifest.config_file.clone());
        runtime.write_text_file(&manifest.service_config_path, &manifest.artifact_content)?;
        written_files.push(manifest.service_config_path.clone());
        artifact_written = true;
    }

    let mut command_results = Vec::with_capacity(plan.commands.len());
    for command in &plan.commands {
        let output = runtime.run_command(command)?;
        let success = output.exit_code.unwrap_or_default() == 0;
        let result = ServerServiceCommandResult {
            program: command.program.clone(),
            args: command.args.clone(),
            exit_code: output.exit_code,
            stdout: output.stdout,
            stderr: output.stderr,
            success,
        };

        if plan.action != ServerServiceLifecycleAction::Status.as_str() && !result.success {
            return Err(format!(
                "service command failed: {} (exit code {:?})\nstdout: {}\nstderr: {}",
                render_shell_command(command),
                result.exit_code,
                result.stdout.trim(),
                result.stderr.trim()
            ));
        }

        command_results.push(result);
    }

    let state = derive_execution_state(plan, &command_results);
    let success = if plan.action == ServerServiceLifecycleAction::Status.as_str() {
        matches!(state.as_str(), "active" | "running" | "loaded")
    } else {
        true
    };

    Ok(ServerServiceExecutionResult {
        action: plan.action.clone(),
        platform: plan.platform.clone(),
        service_manager: plan.service_manager.clone(),
        service_name: plan.service_name.clone(),
        service_config_path: plan.service_config_path.clone(),
        executable_path: plan.executable_path.clone(),
        config_file: plan.config_file.clone(),
        commands: plan.commands.clone(),
        runtime_config: plan.runtime_config.clone(),
        artifact_written,
        written_files,
        success,
        state,
        command_results,
    })
}

fn build_service_lifecycle_commands(
    action: ServerServiceLifecycleAction,
    platform: ClawServerServicePlatform,
    manifest: &ProjectedServerServiceManifest,
) -> Vec<ServerServiceShellCommand> {
    match platform {
        ClawServerServicePlatform::Linux => match action {
            ServerServiceLifecycleAction::Install => vec![
                ServerServiceShellCommand {
                    program: "systemctl".to_string(),
                    args: vec!["daemon-reload".to_string()],
                },
                ServerServiceShellCommand {
                    program: "systemctl".to_string(),
                    args: vec!["enable".to_string(), manifest.service_name.clone()],
                },
            ],
            ServerServiceLifecycleAction::Start => vec![ServerServiceShellCommand {
                program: "systemctl".to_string(),
                args: vec!["start".to_string(), manifest.service_name.clone()],
            }],
            ServerServiceLifecycleAction::Stop => vec![ServerServiceShellCommand {
                program: "systemctl".to_string(),
                args: vec!["stop".to_string(), manifest.service_name.clone()],
            }],
            ServerServiceLifecycleAction::Restart => vec![ServerServiceShellCommand {
                program: "systemctl".to_string(),
                args: vec!["restart".to_string(), manifest.service_name.clone()],
            }],
            ServerServiceLifecycleAction::Status => vec![ServerServiceShellCommand {
                program: "systemctl".to_string(),
                args: vec!["is-active".to_string(), manifest.service_name.clone()],
            }],
        },
        ClawServerServicePlatform::Macos => {
            let domain_service = format!("system/{}", manifest.service_name);
            match action {
                ServerServiceLifecycleAction::Install => vec![ServerServiceShellCommand {
                    program: "launchctl".to_string(),
                    args: vec!["enable".to_string(), domain_service],
                }],
                ServerServiceLifecycleAction::Start => vec![
                    ServerServiceShellCommand {
                        program: "launchctl".to_string(),
                        args: vec![
                            "bootstrap".to_string(),
                            "system".to_string(),
                            normalize_path_for_manifest(&manifest.service_config_path),
                        ],
                    },
                    ServerServiceShellCommand {
                        program: "launchctl".to_string(),
                        args: vec![
                            "enable".to_string(),
                            format!("system/{}", manifest.service_name),
                        ],
                    },
                    ServerServiceShellCommand {
                        program: "launchctl".to_string(),
                        args: vec![
                            "kickstart".to_string(),
                            "-k".to_string(),
                            format!("system/{}", manifest.service_name),
                        ],
                    },
                ],
                ServerServiceLifecycleAction::Stop => vec![ServerServiceShellCommand {
                    program: "launchctl".to_string(),
                    args: vec!["bootout".to_string(), domain_service],
                }],
                ServerServiceLifecycleAction::Restart => vec![
                    ServerServiceShellCommand {
                        program: "launchctl".to_string(),
                        args: vec![
                            "bootout".to_string(),
                            format!("system/{}", manifest.service_name),
                        ],
                    },
                    ServerServiceShellCommand {
                        program: "launchctl".to_string(),
                        args: vec![
                            "bootstrap".to_string(),
                            "system".to_string(),
                            normalize_path_for_manifest(&manifest.service_config_path),
                        ],
                    },
                    ServerServiceShellCommand {
                        program: "launchctl".to_string(),
                        args: vec![
                            "enable".to_string(),
                            format!("system/{}", manifest.service_name),
                        ],
                    },
                    ServerServiceShellCommand {
                        program: "launchctl".to_string(),
                        args: vec![
                            "kickstart".to_string(),
                            "-k".to_string(),
                            format!("system/{}", manifest.service_name),
                        ],
                    },
                ],
                ServerServiceLifecycleAction::Status => vec![ServerServiceShellCommand {
                    program: "launchctl".to_string(),
                    args: vec![
                        "print".to_string(),
                        format!("system/{}", manifest.service_name),
                    ],
                }],
            }
        }
        ClawServerServicePlatform::Windows => match action {
            ServerServiceLifecycleAction::Install => vec![ServerServiceShellCommand {
                program: "sc.exe".to_string(),
                args: vec![
                    "create".to_string(),
                    manifest.service_name.clone(),
                    "binPath=".to_string(),
                    render_windows_command_line(&manifest.executable_path, &manifest.runtime_args),
                    "start=".to_string(),
                    "auto".to_string(),
                    "DisplayName=".to_string(),
                    "Claw Server".to_string(),
                ],
            }],
            ServerServiceLifecycleAction::Start => vec![ServerServiceShellCommand {
                program: "sc.exe".to_string(),
                args: vec!["start".to_string(), manifest.service_name.clone()],
            }],
            ServerServiceLifecycleAction::Stop => vec![ServerServiceShellCommand {
                program: "sc.exe".to_string(),
                args: vec!["stop".to_string(), manifest.service_name.clone()],
            }],
            ServerServiceLifecycleAction::Restart => vec![
                ServerServiceShellCommand {
                    program: "sc.exe".to_string(),
                    args: vec!["stop".to_string(), manifest.service_name.clone()],
                },
                ServerServiceShellCommand {
                    program: "sc.exe".to_string(),
                    args: vec!["start".to_string(), manifest.service_name.clone()],
                },
            ],
            ServerServiceLifecycleAction::Status => vec![ServerServiceShellCommand {
                program: "sc.exe".to_string(),
                args: vec!["query".to_string(), manifest.service_name.clone()],
            }],
        },
    }
}

fn derive_execution_state(
    plan: &PlannedServerServiceLifecycleAction,
    command_results: &[ServerServiceCommandResult],
) -> String {
    match plan.action.as_str() {
        "install" => "installed".to_string(),
        "start" => "started".to_string(),
        "stop" => "stopped".to_string(),
        "restart" => "restarted".to_string(),
        "status" => derive_status_state(plan, command_results),
        _ => "unknown".to_string(),
    }
}

fn derive_status_state(
    plan: &PlannedServerServiceLifecycleAction,
    command_results: &[ServerServiceCommandResult],
) -> String {
    let Some(result) = command_results.first() else {
        return "unknown".to_string();
    };

    let combined = format!("{}\n{}", result.stdout, result.stderr);
    match plan.platform.as_str() {
        "linux" => derive_linux_status_state(&combined),
        "macos" => derive_macos_status_state(result.success, &combined),
        "windows" => derive_windows_status_state(&combined),
        _ => "unknown".to_string(),
    }
}

fn derive_linux_status_state(output: &str) -> String {
    let normalized = output.trim().to_ascii_lowercase();
    if normalized.contains("activating") {
        "activating".to_string()
    } else if normalized.contains("inactive") {
        "inactive".to_string()
    } else if normalized.contains("active") {
        "active".to_string()
    } else if normalized.contains("failed") {
        "failed".to_string()
    } else {
        "unknown".to_string()
    }
}

fn derive_macos_status_state(success: bool, output: &str) -> String {
    if !success {
        return "notLoaded".to_string();
    }

    let normalized = output.to_ascii_lowercase();
    if normalized.contains("state = running") {
        "running".to_string()
    } else {
        "loaded".to_string()
    }
}

fn derive_windows_status_state(output: &str) -> String {
    let normalized = output.to_ascii_uppercase();
    if normalized.contains("RUNNING") {
        "running".to_string()
    } else if normalized.contains("STOPPED") {
        "stopped".to_string()
    } else if normalized.contains("1060") {
        "notInstalled".to_string()
    } else {
        "unknown".to_string()
    }
}

fn resolve_working_directory(executable_path: &Path) -> PathBuf {
    let parent = executable_path
        .parent()
        .map(Path::to_path_buf)
        .unwrap_or_else(|| PathBuf::from("."));
    if parent.file_name().and_then(|value| value.to_str()) == Some("bin") {
        return parent.parent().map(Path::to_path_buf).unwrap_or(parent);
    }

    parent
}

fn build_linux_systemd_unit(
    executable_path: &Path,
    runtime_args: &[String],
    runtime_environment: &BTreeMap<String, String>,
    working_directory: &Path,
    stdout_log_path: &Path,
    stderr_log_path: &Path,
) -> String {
    let exec_start = std::iter::once(normalize_path_for_manifest(executable_path))
        .chain(runtime_args.iter().cloned())
        .map(|value| quote_systemd_arg(&value))
        .collect::<Vec<_>>()
        .join(" ");
    let environment = runtime_environment
        .iter()
        .map(|(key, value)| {
            format!(
                "Environment=\"{}={}\"",
                escape_systemd(key),
                escape_systemd(value)
            )
        })
        .collect::<Vec<_>>()
        .join("\n");

    format!(
        concat!(
            "[Unit]\n",
            "Description=Claw Server\n",
            "After=network-online.target\n",
            "Wants=network-online.target\n\n",
            "[Service]\n",
            "Type=simple\n",
            "WorkingDirectory={working_directory}\n",
            "ExecStart={exec_start}\n",
            "{environment}\n",
            "Restart=on-failure\n",
            "RestartSec=5\n",
            "StandardOutput=append:{stdout_log_path}\n",
            "StandardError=append:{stderr_log_path}\n\n",
            "[Install]\n",
            "WantedBy=multi-user.target\n"
        ),
        working_directory = quote_systemd_arg(&normalize_path_for_manifest(working_directory)),
        exec_start = exec_start,
        environment = environment,
        stdout_log_path = quote_systemd_arg(&normalize_path_for_manifest(stdout_log_path)),
        stderr_log_path = quote_systemd_arg(&normalize_path_for_manifest(stderr_log_path)),
    )
}

fn build_macos_launchd_plist(
    service_name: &str,
    executable_path: &Path,
    runtime_args: &[String],
    runtime_environment: &BTreeMap<String, String>,
    working_directory: &Path,
    stdout_log_path: &Path,
    stderr_log_path: &Path,
) -> String {
    let args = std::iter::once(normalize_path_for_manifest(executable_path))
        .chain(runtime_args.iter().cloned())
        .map(|value| format!("    <string>{}</string>", escape_xml(&value)))
        .collect::<Vec<_>>()
        .join("\n");
    let environment = runtime_environment
        .iter()
        .map(|(key, value)| {
            format!(
                "      <key>{}</key>\n      <string>{}</string>",
                escape_xml(key),
                escape_xml(value)
            )
        })
        .collect::<Vec<_>>()
        .join("\n");

    format!(
        concat!(
            "<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n",
            "<!DOCTYPE plist PUBLIC \"-//Apple//DTD PLIST 1.0//EN\" ",
            "\"http://www.apple.com/DTDs/PropertyList-1.0.dtd\">\n",
            "<plist version=\"1.0\">\n",
            "<dict>\n",
            "  <key>Label</key>\n",
            "  <string>{service_name}</string>\n",
            "  <key>ProgramArguments</key>\n",
            "  <array>\n",
            "{args}\n",
            "  </array>\n",
            "  <key>RunAtLoad</key>\n",
            "  <true/>\n",
            "  <key>KeepAlive</key>\n",
            "  <true/>\n",
            "  <key>WorkingDirectory</key>\n",
            "  <string>{working_directory}</string>\n",
            "  <key>StandardOutPath</key>\n",
            "  <string>{stdout_log_path}</string>\n",
            "  <key>StandardErrorPath</key>\n",
            "  <string>{stderr_log_path}</string>\n",
            "  <key>EnvironmentVariables</key>\n",
            "  <dict>\n",
            "{environment}\n",
            "  </dict>\n",
            "</dict>\n",
            "</plist>\n"
        ),
        service_name = escape_xml(service_name),
        args = args,
        working_directory = escape_xml(&normalize_path_for_manifest(working_directory)),
        stdout_log_path = escape_xml(&normalize_path_for_manifest(stdout_log_path)),
        stderr_log_path = escape_xml(&normalize_path_for_manifest(stderr_log_path)),
        environment = environment,
    )
}

fn build_windows_service_manifest(
    service_name: &str,
    executable_path: &Path,
    runtime_args: &[String],
    runtime_environment: &BTreeMap<String, String>,
    working_directory: &Path,
    stdout_log_path: &Path,
    stderr_log_path: &Path,
) -> String {
    serde_json::to_string_pretty(&json!({
        "schemaVersion": 1,
        "serviceName": service_name,
        "serviceManager": "windowsService",
        "startupMode": "auto",
        "workingDirectory": normalize_path_for_manifest(working_directory),
        "command": normalize_path_for_manifest(executable_path),
        "args": runtime_args,
        "commandLine": std::iter::once(normalize_path_for_manifest(executable_path))
            .chain(runtime_args.iter().cloned())
            .collect::<Vec<_>>(),
        "environment": runtime_environment,
        "stdoutLogPath": normalize_path_for_manifest(stdout_log_path),
        "stderrLogPath": normalize_path_for_manifest(stderr_log_path),
    }))
    .unwrap_or_else(|error| {
        let escaped_error = serde_json::Value::String(format!(
            "failed to serialize windows service manifest: {error}"
        ));
        format!("{{\"error\":{escaped_error}}}")
    })
}

fn render_windows_command_line(executable_path: &Path, runtime_args: &[String]) -> String {
    std::iter::once(normalize_path_for_manifest(executable_path))
        .chain(runtime_args.iter().cloned())
        .map(|value| quote_windows_arg(&value))
        .collect::<Vec<_>>()
        .join(" ")
}

fn quote_windows_arg(value: &str) -> String {
    if value.contains(' ') {
        format!("\"{}\"", value.replace('"', "\\\""))
    } else {
        value.to_string()
    }
}

fn quote_systemd_arg(value: &str) -> String {
    format!("\"{}\"", escape_systemd(value))
}

fn escape_systemd(value: &str) -> String {
    value.replace('\\', "\\\\").replace('"', "\\\"")
}

fn escape_xml(value: &str) -> String {
    value
        .replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
        .replace('\'', "&apos;")
}

fn normalize_path_for_manifest(path: &Path) -> String {
    path.to_string_lossy().replace('\\', "/")
}

fn render_shell_command(command: &ServerServiceShellCommand) -> String {
    std::iter::once(command.program.as_str())
        .chain(command.args.iter().map(String::as_str))
        .collect::<Vec<_>>()
        .join(" ")
}

#[cfg(test)] // WORKSPACE-PATH:allow-fixture-block: this module is the file's #[cfg(test)] unit-test fixture data
mod tests {
    use std::{
        path::PathBuf,
        sync::{Arc, Mutex},
    };

    use super::{
        execute_server_service_action, ResolvedServerRuntimeConfig, ServerRuntimeContract,
        ServerServiceControlPlane, ServerServiceControlPlaneHandle, ServerServiceExecutionResult,
        ServerServiceLifecycleAction, ServerServiceLifecycleRequest, ServerServiceShellCommand,
    };
    use crate::{
        cli::ClawServerServicePlatform,
        config::{ResolvedServerAuthConfig, ResolvedServerStateStoreConfig},
    };

    #[test]
    fn execute_server_service_action_delegates_to_control_plane_handle_using_runtime_contract() {
        let requests = Arc::new(Mutex::new(Vec::<ServerServiceLifecycleRequest>::new()));
        let control_plane = ServerServiceControlPlaneHandle::with_backend(Arc::new(
            FakeServerServiceControlPlane::new(
                requests.clone(),
                Ok(sample_service_execution_result("restart", "restarted")),
            ),
        ));
        let runtime_contract = sample_runtime_contract(ClawServerServicePlatform::Windows);

        let result = execute_server_service_action(
            &control_plane,
            &runtime_contract,
            ServerServiceLifecycleAction::Restart,
        )
        .expect("service action should execute through the control plane");
        let requests = requests
            .lock()
            .expect("fake service control plane requests should lock");

        assert_eq!(requests.len(), 1);
        assert_eq!(
            requests[0],
            runtime_contract.lifecycle_request(ServerServiceLifecycleAction::Restart)
        );
        assert_eq!(result.action, "restart");
        assert_eq!(result.state, "restarted");
    }

    #[test]
    fn execute_server_service_action_returns_control_plane_failures() {
        let control_plane = ServerServiceControlPlaneHandle::with_backend(Arc::new(
            FakeServerServiceControlPlane::new(
                Arc::new(Mutex::new(Vec::new())),
                Err("service manager unavailable".to_string()),
            ),
        ));
        let runtime_contract = sample_runtime_contract(ClawServerServicePlatform::Linux);

        let error = execute_server_service_action(
            &control_plane,
            &runtime_contract,
            ServerServiceLifecycleAction::Status,
        )
        .expect_err("service action should surface control plane failures");

        assert_eq!(error, "service manager unavailable");
    }

    #[test]
    fn server_service_execution_result_serializes_config_file_key() {
        let payload = serde_json::to_value(sample_service_execution_result("status", "running"))
            .expect("service execution result should serialize");

        assert_eq!(
            payload
                .get("configFile")
                .and_then(serde_json::Value::as_str),
            Some("D:/managed/config.json")
        );
        assert!(
            payload.get("configPath").is_none(),
            "legacy configPath should not be serialized",
        );
    }

    #[cfg(windows)]
    #[test]
    fn windows_service_commands_use_hidden_child_process_policy() {
        assert_eq!(
            super::windows_hidden_service_command_creation_flags(),
            super::WINDOWS_CREATE_NO_WINDOW,
        );
    }

    fn sample_runtime_contract(platform: ClawServerServicePlatform) -> ServerRuntimeContract {
        ServerRuntimeContract {
            platform,
            executable_path: PathBuf::from("/opt/claw/bin/agentstudio-server"),
            config_path: PathBuf::from("/etc/agentstudio-server/config.json"),
            runtime_config: ResolvedServerRuntimeConfig {
                host: "127.0.0.1".to_string(),
                port: 18_797,
                data_dir: PathBuf::from("/var/lib/agentstudio-server"),
                web_dist_dir: PathBuf::from("/srv/claw/web"),
                deployment_family: crate::config::ServerDeploymentFamily::BareMetal,
                accelerator_profile: None,
                state_store: ResolvedServerStateStoreConfig {
                    driver: "json-file".to_string(),
                    sqlite_path: None,
                    postgres_url: None,
                    postgres_schema: None,
                },
                auth: ResolvedServerAuthConfig {
                    manage_username: None,
                    manage_password: None,
                    internal_username: None,
                    internal_password: None,
                },
                allow_insecure_public_bind: false,
            },
        }
    }

    fn sample_service_execution_result(action: &str, state: &str) -> ServerServiceExecutionResult {
        ServerServiceExecutionResult {
            action: action.to_string(),
            platform: "windows".to_string(),
            service_manager: "windowsService".to_string(),
            service_name: "ClawServer".to_string(),
            service_config_path: PathBuf::from("D:/managed/service/windows-service.json"),
            executable_path: PathBuf::from("D:/managed/agentstudio-server.exe"),
            config_file: PathBuf::from("D:/managed/config.json"),
            commands: vec![ServerServiceShellCommand {
                program: "sc.exe".to_string(),
                args: vec!["query".to_string(), "ClawServer".to_string()],
            }],
            runtime_config: ResolvedServerRuntimeConfig {
                host: "127.0.0.1".to_string(),
                port: 18_797,
                data_dir: PathBuf::from("D:/managed/data"),
                web_dist_dir: PathBuf::from("D:/managed/web"),
                deployment_family: crate::config::ServerDeploymentFamily::BareMetal,
                accelerator_profile: None,
                state_store: ResolvedServerStateStoreConfig {
                    driver: "json-file".to_string(),
                    sqlite_path: None,
                    postgres_url: None,
                    postgres_schema: None,
                },
                auth: ResolvedServerAuthConfig {
                    manage_username: None,
                    manage_password: None,
                    internal_username: None,
                    internal_password: None,
                },
                allow_insecure_public_bind: false,
            },
            artifact_written: false,
            written_files: Vec::new(),
            success: true,
            state: state.to_string(),
            command_results: Vec::new(),
        }
    }

    struct FakeServerServiceControlPlane {
        requests: Arc<Mutex<Vec<ServerServiceLifecycleRequest>>>,
        result: Result<ServerServiceExecutionResult, String>,
    }

    impl FakeServerServiceControlPlane {
        fn new(
            requests: Arc<Mutex<Vec<ServerServiceLifecycleRequest>>>,
            result: Result<ServerServiceExecutionResult, String>,
        ) -> Self {
            Self { requests, result }
        }
    }

    impl ServerServiceControlPlane for FakeServerServiceControlPlane {
        fn execute(
            &self,
            request: ServerServiceLifecycleRequest,
        ) -> Result<ServerServiceExecutionResult, String> {
            self.requests
                .lock()
                .expect("fake service control plane requests should lock")
                .push(request);
            self.result.clone()
        }
    }
}
