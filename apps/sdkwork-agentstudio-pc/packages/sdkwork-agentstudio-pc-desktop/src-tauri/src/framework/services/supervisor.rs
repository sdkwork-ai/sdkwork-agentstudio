#![allow(dead_code)]

use crate::framework::services::openclaw_runtime::{
    ActivatedOpenClawRuntime, OpenClawRuntimeService,
};
use crate::framework::{
    child_process::{configure_hidden_child_process, configure_managed_child_process},
    kernel::{DesktopSupervisorInfo, DesktopSupervisorServiceInfo},
    paths::AppPaths,
    services::kernel_runtime_authority::KernelRuntimeAuthorityService,
    FrameworkError, Result,
};
#[cfg(windows)]
const CREATE_NEW_PROCESS_GROUP: u32 =
    crate::framework::child_process::WINDOWS_CREATE_NEW_PROCESS_GROUP;
#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = crate::framework::child_process::WINDOWS_CREATE_NO_WINDOW;
use std::{
    collections::{BTreeMap, HashMap},
    env,
    ffi::OsStr,
    fs,
    io::{Read, Write},
    net::{Ipv4Addr, SocketAddr, SocketAddrV4, TcpStream},
    path::{Path, PathBuf},
    process::{Child, Command, Stdio},
    sync::{Arc, Mutex, MutexGuard},
    thread,
    time::{Duration, Instant, SystemTime},
};
use sysinfo::{ProcessStatus, ProcessesToUpdate, System};
#[cfg(windows)]
use windows_sys::Win32::{
    Foundation::{CloseHandle, HANDLE, WAIT_OBJECT_0},
    System::Threading::{
        OpenProcess, TerminateProcess, WaitForSingleObject, PROCESS_SYNCHRONIZE, PROCESS_TERMINATE,
    },
};

const DEFAULT_RESTART_WINDOW_MS: u64 = 60_000;
const DEFAULT_RESTART_BACKOFF_MS: u64 = 5_000;
const DEFAULT_MAX_RESTARTS: usize = 3;
const DEFAULT_GRACEFUL_SHUTDOWN_TIMEOUT_MS: u64 = 10_000;
// Packaged OpenClaw cold starts on Windows can take more than 26s before the
// loopback listener binds, so the supervisor needs extra startup slack.
const DEFAULT_OPENCLAW_GATEWAY_READY_TIMEOUT_MS: u64 = 60_000;
const DEFAULT_OPENCLAW_GATEWAY_START_RETRY_ATTEMPTS: usize = 3;
const DEFAULT_OPENCLAW_GATEWAY_START_RETRY_DELAY_MS: u64 = 250;
const DEFAULT_OPENCLAW_GATEWAY_HEALTH_PROBE_INTERVAL_MS: u64 = 500;
const DEFAULT_OPENCLAW_GATEWAY_STARTUP_MIN_PROCESS_STABILITY_MS: u64 = 1_000;
const DEFAULT_OPENCLAW_GATEWAY_POST_READY_STABILITY_MS: u64 = 300;
const DEFAULT_OPENCLAW_GATEWAY_HTTP_CONNECT_TIMEOUT_MS: u64 = 200;
const DEFAULT_OPENCLAW_GATEWAY_START_HTTP_READY_IO_TIMEOUT_MS: u64 = 4_000;
const DEFAULT_OPENCLAW_GATEWAY_RUNTIME_HTTP_IO_TIMEOUT_MS: u64 = 1_000;
const DEFAULT_OPENCLAW_GATEWAY_RUNTIME_HEALTH_PROBE_TIMEOUT_MS: u64 = 1_000;
const DEFAULT_OPENCLAW_GATEWAY_HTTP_LIVE_PATH: &str = "/healthz";
const DEFAULT_OPENCLAW_GATEWAY_HTTP_READY_PATH: &str = "/readyz";
pub const SERVICE_ID_OPENCLAW_GATEWAY: &str = "openclaw_gateway";

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum SupervisorLifecycle {
    Starting,
    Running,
    Stopping,
    Stopped,
    Failed,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum ManagedServiceLifecycle {
    Starting,
    Running,
    Stopping,
    Stopped,
    Failed,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct RestartPolicy {
    pub max_restarts: usize,
    pub window_ms: u64,
    pub backoff_ms: u64,
}

impl RestartPolicy {
    pub fn crash_only_default() -> Self {
        Self {
            max_restarts: DEFAULT_MAX_RESTARTS,
            window_ms: DEFAULT_RESTART_WINDOW_MS,
            backoff_ms: DEFAULT_RESTART_BACKOFF_MS,
        }
    }
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum ManagedServiceHealthCheck {
    None,
    ProcessAlive,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ManagedServiceDefinition {
    pub id: String,
    pub display_name: String,
    pub command: Option<String>,
    pub args: Vec<String>,
    pub cwd: Option<PathBuf>,
    pub env: BTreeMap<String, String>,
    pub startup_order: u16,
    pub graceful_shutdown_timeout_ms: u64,
    pub restart_policy: RestartPolicy,
    pub health_check: ManagedServiceHealthCheck,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ManagedServiceSnapshot {
    pub id: String,
    pub display_name: String,
    pub lifecycle: ManagedServiceLifecycle,
    pub startup_order: u16,
    pub pid: Option<u32>,
    pub last_exit_code: Option<i32>,
    pub restart_count: usize,
    pub last_error: Option<String>,
    pub graceful_shutdown_timeout_ms: u64,
    pub restart_policy: RestartPolicy,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct SupervisorSnapshot {
    pub lifecycle: SupervisorLifecycle,
    pub shutdown_requested: bool,
    pub services: Vec<ManagedServiceSnapshot>,
}

#[derive(Clone, Debug)]
pub struct SupervisorService {
    paths: Option<AppPaths>,
    definitions: Arc<Vec<ManagedServiceDefinition>>,
    runtime: Arc<Mutex<SupervisorRuntime>>,
    openclaw_runtime: Arc<Mutex<Option<ActivatedOpenClawRuntime>>>,
    managed_processes: Arc<Mutex<HashMap<String, ManagedServiceProcessHandle>>>,
    openclaw_gateway_operation: Arc<Mutex<()>>,
}

#[derive(Clone, Debug)]
struct SupervisorRuntime {
    lifecycle: SupervisorLifecycle,
    shutdown_requested: bool,
    services: HashMap<String, ManagedServiceRuntime>,
}

#[derive(Clone, Debug)]
struct ManagedServiceRuntime {
    lifecycle: ManagedServiceLifecycle,
    pid: Option<u32>,
    last_exit_code: Option<i32>,
    restart_count: usize,
    recent_restart_attempts: Vec<SystemTime>,
    last_error: Option<String>,
}

#[derive(Debug)]
struct ManagedServiceProcessHandle {
    children: Vec<ManagedChildProcessHandle>,
}

#[derive(Debug)]
struct ManagedChildProcessHandle {
    label: String,
    child: Child,
}

#[derive(Clone, Debug, PartialEq, Eq)]
enum GatewayProbeStatus {
    Ready,
    Pending(String),
    HttpStatus { code: u16, detail: String },
}

impl GatewayProbeStatus {
    fn is_ready(&self) -> bool {
        matches!(self, Self::Ready)
    }

    fn is_http_status(&self) -> bool {
        matches!(self, Self::HttpStatus { .. })
    }

    fn is_http_not_found(&self) -> bool {
        matches!(self, Self::HttpStatus { code: 404, .. })
    }

    fn detail(self) -> String {
        match self {
            Self::Ready => "ready".to_string(),
            Self::Pending(detail) => detail,
            Self::HttpStatus { detail, .. } => detail,
        }
    }
}

impl SupervisorService {
    pub fn for_paths(paths: &AppPaths) -> Self {
        Self::build(Some(paths.clone()))
    }

    pub fn new() -> Self {
        Self::build(None)
    }

    fn build(paths: Option<AppPaths>) -> Self {
        let definitions = default_managed_services();
        let services = definitions
            .iter()
            .map(|definition| {
                (
                    definition.id.clone(),
                    ManagedServiceRuntime {
                        lifecycle: ManagedServiceLifecycle::Stopped,
                        pid: None,
                        last_exit_code: None,
                        restart_count: 0,
                        recent_restart_attempts: Vec::new(),
                        last_error: None,
                    },
                )
            })
            .collect();

        Self {
            paths,
            definitions: Arc::new(definitions),
            runtime: Arc::new(Mutex::new(SupervisorRuntime {
                lifecycle: SupervisorLifecycle::Running,
                shutdown_requested: false,
                services,
            })),
            openclaw_runtime: Arc::new(Mutex::new(None)),
            managed_processes: Arc::new(Mutex::new(HashMap::new())),
            openclaw_gateway_operation: Arc::new(Mutex::new(())),
        }
    }

    pub fn start_default_services(&self) -> Result<Vec<String>> {
        self.configured_openclaw_runtime()?
            .ok_or_else(|| FrameworkError::NotFound("configured openclaw runtime".to_string()))?;

        if self.is_service_running(SERVICE_ID_OPENCLAW_GATEWAY)? {
            return Ok(Vec::new());
        }

        let paths = self.paths.as_ref().ok_or_else(|| {
            FrameworkError::Internal(
                "supervisor service paths are not configured for default-service startup"
                    .to_string(),
            )
        })?;
        self.start_openclaw_gateway(paths)?;

        Ok(vec![SERVICE_ID_OPENCLAW_GATEWAY.to_string()])
    }

    pub fn managed_service_ids(&self) -> Vec<String> {
        self.definitions
            .iter()
            .map(|definition| definition.id.clone())
            .collect()
    }

    pub fn planned_startup_order(&self) -> Vec<String> {
        let mut definitions = self.definitions.iter().collect::<Vec<_>>();
        definitions.sort_by_key(|definition| definition.startup_order);
        definitions
            .into_iter()
            .map(|definition| definition.id.clone())
            .collect()
    }

    pub fn planned_shutdown_order(&self) -> Vec<String> {
        let mut ids = self.planned_startup_order();
        ids.reverse();
        ids
    }

    pub fn register_restart_attempt(&self, service_id: &str, at: SystemTime) -> Result<bool> {
        let definition = self.require_definition(service_id)?;
        let mut runtime = self.lock_runtime()?;
        if runtime.shutdown_requested {
            return Ok(false);
        }

        let service = runtime.services.get_mut(service_id).ok_or_else(|| {
            FrameworkError::NotFound(format!("managed service not found: {service_id}"))
        })?;

        let window = Duration::from_millis(definition.restart_policy.window_ms);
        service
            .recent_restart_attempts
            .retain(|timestamp| match at.duration_since(*timestamp) {
                Ok(elapsed) => elapsed <= window,
                Err(_) => true,
            });

        if service.recent_restart_attempts.len() >= definition.restart_policy.max_restarts {
            service.lifecycle = ManagedServiceLifecycle::Failed;
            service.last_error = Some(format!(
                "restart budget exhausted for {} within {}ms",
                service_id, definition.restart_policy.window_ms
            ));
            runtime.lifecycle = SupervisorLifecycle::Failed;
            return Ok(false);
        }

        service.recent_restart_attempts.push(at);
        service.restart_count += 1;
        service.lifecycle = ManagedServiceLifecycle::Starting;
        service.last_error = None;
        runtime.lifecycle = SupervisorLifecycle::Running;
        Ok(true)
    }

    pub fn request_restart(&self, service_id: &str) -> Result<()> {
        let mut runtime = self.lock_runtime()?;
        if runtime.shutdown_requested {
            return Err(FrameworkError::Conflict(
                "application shutdown has already been requested".to_string(),
            ));
        }

        let service = runtime.services.get_mut(service_id).ok_or_else(|| {
            FrameworkError::NotFound(format!("managed service not found: {service_id}"))
        })?;
        service.lifecycle = ManagedServiceLifecycle::Starting;
        service.pid = None;
        service.last_exit_code = None;
        service.last_error = None;
        runtime.lifecycle = SupervisorLifecycle::Running;
        Ok(())
    }

    pub fn request_restart_all(&self) -> Result<Vec<String>> {
        let planned_services = self.planned_startup_order();
        for service_id in &planned_services {
            self.request_restart(service_id)?;
        }

        Ok(planned_services)
    }

    pub fn stop_service(&self, service_id: &str) -> Result<()> {
        self.stop_service_process(service_id)
    }

    pub fn configure_openclaw_gateway(&self, runtime: &ActivatedOpenClawRuntime) -> Result<()> {
        *self.lock_openclaw_runtime()? = Some(runtime.clone());
        Ok(())
    }

    pub fn configured_openclaw_runtime(&self) -> Result<Option<ActivatedOpenClawRuntime>> {
        Ok(self.lock_openclaw_runtime()?.clone())
    }

    pub fn prepare_openclaw_runtime_activation(&self, paths: &AppPaths) -> Result<()> {
        reap_stale_openclaw_gateway_processes(paths)
    }

    pub fn start_openclaw_gateway(&self, paths: &AppPaths) -> Result<()> {
        let _operation = self.lock_openclaw_gateway_operation()?;
        self.start_openclaw_gateway_locked(paths)
    }

    fn start_openclaw_gateway_locked(&self, paths: &AppPaths) -> Result<()> {
        if self.is_service_running(SERVICE_ID_OPENCLAW_GATEWAY)? {
            return Ok(());
        }

        let runtime = self
            .lock_openclaw_runtime()?
            .clone()
            .ok_or_else(|| FrameworkError::NotFound("configured openclaw runtime".to_string()))?;
        self.prepare_openclaw_runtime_activation(paths)?;
        let runtime_service = OpenClawRuntimeService::new();
        let mut runtime = runtime_service.refresh_configured_runtime(paths, &runtime)?;
        *self.lock_openclaw_runtime()? = Some(runtime.clone());

        self.request_restart(SERVICE_ID_OPENCLAW_GATEWAY)?;
        let mut last_failure = None;

        for attempt in 0..DEFAULT_OPENCLAW_GATEWAY_START_RETRY_ATTEMPTS {
            let log_file_path = paths.logs_dir.join("openclaw-gateway.log");
            if let Some(parent) = log_file_path.parent() {
                fs::create_dir_all(parent)?;
            }
            let stdout = fs::OpenOptions::new()
                .create(true)
                .append(true)
                .open(&log_file_path)?;
            let stderr = stdout.try_clone()?;
            let mut command = Command::new(&runtime.node_path);
            configure_command_for_managed_process(&mut command);
            command.arg(&runtime.cli_path);
            command.arg("gateway");
            command.current_dir(&runtime.runtime_dir);
            command.env("PATH", prepend_path_env(&paths.user_bin_dir));
            command.envs(runtime.managed_env_with_local_ai_proxy(paths)?);
            command.stdout(Stdio::from(stdout));
            command.stderr(Stdio::from(stderr));

            match command.spawn() {
                Ok(mut child) => {
                    match wait_for_gateway_ready(
                        &mut child,
                        &runtime,
                        paths,
                        DEFAULT_OPENCLAW_GATEWAY_READY_TIMEOUT_MS,
                    ) {
                        Ok(()) => {
                            let pid = child.id();
                            self.lock_managed_processes()?.insert(
                                SERVICE_ID_OPENCLAW_GATEWAY.to_string(),
                                ManagedServiceProcessHandle {
                                    children: vec![ManagedChildProcessHandle {
                                        label: "gateway".to_string(),
                                        child,
                                    }],
                                },
                            );
                            self.record_running(SERVICE_ID_OPENCLAW_GATEWAY, Some(pid))?;
                            return Ok(());
                        }
                        Err(error) => {
                            let retryable = should_retry_openclaw_gateway_start_failure(&error);
                            let _ = force_process_shutdown(&mut child);
                            let _ = child.wait();
                            if retryable
                                && attempt + 1 < DEFAULT_OPENCLAW_GATEWAY_START_RETRY_ATTEMPTS
                            {
                                last_failure = Some(error);
                                runtime = runtime_service
                                    .refresh_configured_runtime(paths, &runtime)
                                    .map_err(|refresh_error| {
                                        let _ = self.record_stopped(
                                            SERVICE_ID_OPENCLAW_GATEWAY,
                                            None,
                                            Some(refresh_error.to_string()),
                                        );
                                        refresh_error
                                    })?;
                                *self.lock_openclaw_runtime()? = Some(runtime.clone());
                                thread::sleep(Duration::from_millis(
                                    DEFAULT_OPENCLAW_GATEWAY_START_RETRY_DELAY_MS,
                                ));
                                continue;
                            }
                            let _ = self.record_stopped(
                                SERVICE_ID_OPENCLAW_GATEWAY,
                                None,
                                Some(error.to_string()),
                            );
                            return Err(error);
                        }
                    }
                }
                Err(error) => {
                    let retryable = should_retry_openclaw_gateway_spawn_error(&error);
                    let failure = FrameworkError::Io(error);
                    if retryable && attempt + 1 < DEFAULT_OPENCLAW_GATEWAY_START_RETRY_ATTEMPTS {
                        last_failure = Some(failure);
                        thread::sleep(Duration::from_millis(
                            DEFAULT_OPENCLAW_GATEWAY_START_RETRY_DELAY_MS,
                        ));
                        continue;
                    }
                    let _ = self.record_stopped(
                        SERVICE_ID_OPENCLAW_GATEWAY,
                        None,
                        Some(failure.to_string()),
                    );
                    return Err(failure);
                }
            }
        }

        let failure = last_failure.unwrap_or_else(|| {
            FrameworkError::Internal(
                "openclaw gateway start loop exhausted without producing a final result"
                    .to_string(),
            )
        });
        let _ = self.record_stopped(SERVICE_ID_OPENCLAW_GATEWAY, None, Some(failure.to_string()));
        Err(failure)
    }

    pub fn restart_openclaw_gateway(&self, paths: &AppPaths) -> Result<()> {
        let _operation = self.lock_openclaw_gateway_operation()?;
        let _ = self.stop_openclaw_gateway_locked();
        self.start_openclaw_gateway_locked(paths)
    }

    pub fn stop_openclaw_gateway(&self) -> Result<()> {
        let _operation = self.lock_openclaw_gateway_operation()?;
        self.stop_openclaw_gateway_locked()
    }

    fn stop_openclaw_gateway_locked(&self) -> Result<()> {
        self.stop_service_process(SERVICE_ID_OPENCLAW_GATEWAY)
    }

    pub fn is_service_running(&self, service_id: &str) -> Result<bool> {
        self.refresh_service_runtime_state(service_id)?;
        let runtime = self.lock_runtime()?;
        let service = runtime.services.get(service_id).ok_or_else(|| {
            FrameworkError::NotFound(format!("managed service not found: {service_id}"))
        })?;

        Ok(matches!(
            service.lifecycle,
            ManagedServiceLifecycle::Running
        ))
    }

    pub fn is_openclaw_gateway_running(&self) -> Result<bool> {
        self.is_service_running(SERVICE_ID_OPENCLAW_GATEWAY)
    }

    pub fn begin_shutdown(&self) -> Result<()> {
        let mut runtime = self.lock_runtime()?;
        runtime.shutdown_requested = true;
        runtime.lifecycle = SupervisorLifecycle::Stopping;
        for service in runtime.services.values_mut() {
            service.lifecycle = match service.lifecycle {
                ManagedServiceLifecycle::Running | ManagedServiceLifecycle::Starting => {
                    ManagedServiceLifecycle::Stopping
                }
                ManagedServiceLifecycle::Failed => ManagedServiceLifecycle::Failed,
                _ => ManagedServiceLifecycle::Stopped,
            };
        }
        drop(runtime);
        self.stop_openclaw_gateway()?;
        Ok(())
    }

    pub fn complete_shutdown(&self) -> Result<()> {
        let mut runtime = self.lock_runtime()?;
        runtime.lifecycle = SupervisorLifecycle::Stopped;
        for service in runtime.services.values_mut() {
            service.lifecycle = ManagedServiceLifecycle::Stopped;
            service.pid = None;
        }
        Ok(())
    }

    pub fn record_running(&self, service_id: &str, pid: Option<u32>) -> Result<()> {
        let mut runtime = self.lock_runtime()?;
        let service = runtime.services.get_mut(service_id).ok_or_else(|| {
            FrameworkError::NotFound(format!("managed service not found: {service_id}"))
        })?;
        service.lifecycle = ManagedServiceLifecycle::Running;
        service.pid = pid;
        service.last_error = None;
        runtime.lifecycle = SupervisorLifecycle::Running;
        Ok(())
    }

    pub fn record_stopped(
        &self,
        service_id: &str,
        exit_code: Option<i32>,
        last_error: Option<String>,
    ) -> Result<()> {
        let mut runtime = self.lock_runtime()?;
        let service = runtime.services.get_mut(service_id).ok_or_else(|| {
            FrameworkError::NotFound(format!("managed service not found: {service_id}"))
        })?;
        service.pid = None;
        service.last_exit_code = exit_code;
        service.last_error = last_error;
        service.lifecycle = if service.last_error.is_some() {
            ManagedServiceLifecycle::Failed
        } else {
            ManagedServiceLifecycle::Stopped
        };
        Ok(())
    }

    pub fn snapshot(&self) -> Result<SupervisorSnapshot> {
        for service_id in self.managed_service_ids() {
            self.refresh_service_runtime_state(service_id.as_str())?;
        }
        let runtime = self.lock_runtime()?;
        let services = self
            .definitions
            .iter()
            .map(|definition| {
                let service = runtime.services.get(&definition.id).ok_or_else(|| {
                    FrameworkError::NotFound(format!(
                        "managed service runtime not found: {}",
                        definition.id
                    ))
                })?;

                Ok(ManagedServiceSnapshot {
                    id: definition.id.clone(),
                    display_name: definition.display_name.clone(),
                    lifecycle: service.lifecycle.clone(),
                    startup_order: definition.startup_order,
                    pid: service.pid,
                    last_exit_code: service.last_exit_code,
                    restart_count: service.restart_count,
                    last_error: service.last_error.clone(),
                    graceful_shutdown_timeout_ms: definition.graceful_shutdown_timeout_ms,
                    restart_policy: definition.restart_policy.clone(),
                })
            })
            .collect::<Result<Vec<_>>>()?;

        Ok(SupervisorSnapshot {
            lifecycle: runtime.lifecycle.clone(),
            shutdown_requested: runtime.shutdown_requested,
            services,
        })
    }

    pub fn kernel_info(&self) -> Result<DesktopSupervisorInfo> {
        let snapshot = self.snapshot()?;
        let managed_service_ids = snapshot
            .services
            .iter()
            .map(|service| service.id.clone())
            .collect::<Vec<_>>();
        let services = snapshot
            .services
            .into_iter()
            .map(|service| DesktopSupervisorServiceInfo {
                id: service.id,
                display_name: service.display_name,
                lifecycle: managed_service_lifecycle_label(&service.lifecycle).to_string(),
                pid: service.pid,
                last_exit_code: service.last_exit_code,
                restart_count: service.restart_count,
                last_error: service.last_error,
            })
            .collect::<Vec<_>>();

        Ok(DesktopSupervisorInfo {
            lifecycle: supervisor_lifecycle_label(&snapshot.lifecycle).to_string(),
            shutdown_requested: snapshot.shutdown_requested,
            service_count: services.len(),
            managed_service_ids,
            services,
        })
    }

    fn require_definition(&self, service_id: &str) -> Result<&ManagedServiceDefinition> {
        self.definitions
            .iter()
            .find(|definition| definition.id == service_id)
            .ok_or_else(|| {
                FrameworkError::NotFound(format!("managed service not found: {service_id}"))
            })
    }

    fn lock_runtime(&self) -> Result<MutexGuard<'_, SupervisorRuntime>> {
        self.runtime
            .lock()
            .map_err(|_| FrameworkError::Internal("supervisor runtime lock poisoned".to_string()))
    }

    fn stop_service_process(&self, service_id: &str) -> Result<()> {
        let graceful_shutdown_timeout_ms = self
            .require_definition(service_id)?
            .graceful_shutdown_timeout_ms;

        {
            let mut runtime = self.lock_runtime()?;
            if let Some(service) = runtime.services.get_mut(service_id) {
                service.lifecycle = ManagedServiceLifecycle::Stopping;
            }
        }

        let Some(mut handle) = self.lock_managed_processes()?.remove(service_id) else {
            self.record_stopped(service_id, None, None)?;
            return Ok(());
        };

        let (exit_code, last_error) =
            terminate_process_group(&mut handle.children, graceful_shutdown_timeout_ms)?;
        self.record_stopped(service_id, exit_code, last_error)
    }

    fn lock_openclaw_runtime(&self) -> Result<MutexGuard<'_, Option<ActivatedOpenClawRuntime>>> {
        self.openclaw_runtime
            .lock()
            .map_err(|_| FrameworkError::Internal("openclaw runtime lock poisoned".to_string()))
    }

    fn lock_managed_processes(
        &self,
    ) -> Result<MutexGuard<'_, HashMap<String, ManagedServiceProcessHandle>>> {
        self.managed_processes.lock().map_err(|_| {
            FrameworkError::Internal("managed process registry lock poisoned".to_string())
        })
    }

    fn lock_openclaw_gateway_operation(&self) -> Result<MutexGuard<'_, ()>> {
        self.openclaw_gateway_operation.lock().map_err(|_| {
            FrameworkError::Internal("openclaw gateway operation lock poisoned".to_string())
        })
    }

    fn refresh_service_runtime_state(&self, service_id: &str) -> Result<()> {
        let lifecycle = {
            let runtime = self.lock_runtime()?;
            let service = runtime.services.get(service_id).ok_or_else(|| {
                FrameworkError::NotFound(format!("managed service not found: {service_id}"))
            })?;
            service.lifecycle.clone()
        };

        if matches!(
            lifecycle,
            ManagedServiceLifecycle::Stopped | ManagedServiceLifecycle::Stopping
        ) {
            return Ok(());
        }

        let (observed_pid, exited_children, handle_present) = {
            let mut managed_processes = self.lock_managed_processes()?;
            let Some(handle) = managed_processes.get_mut(service_id) else {
                return Ok(());
            };

            let mut observed_pid = None;
            let mut exited_children = Vec::new();
            for child_handle in handle.children.iter_mut() {
                observed_pid = Some(child_handle.child.id());
                if let Some(status) = child_handle.child.try_wait()? {
                    exited_children.push((child_handle.label.clone(), status.code()));
                }
            }

            if !exited_children.is_empty() {
                managed_processes.remove(service_id);
            }

            (observed_pid, exited_children, true)
        };

        if !exited_children.is_empty() {
            let exit_code = exited_children.first().and_then(|(_, code)| *code);
            let detail = exited_children
                .iter()
                .map(|(label, code)| match code {
                    Some(value) => format!("{label} exited with code {value}"),
                    None => format!("{label} exited without an exit code"),
                })
                .collect::<Vec<_>>()
                .join(", ");
            self.record_stopped(
                service_id,
                exit_code,
                Some(format!(
                    "managed service {service_id} exited unexpectedly: {detail}"
                )),
            )?;
            return Ok(());
        }

        if !handle_present || matches!(lifecycle, ManagedServiceLifecycle::Starting) {
            return Ok(());
        }

        if service_id == SERVICE_ID_OPENCLAW_GATEWAY {
            let Some(runtime) = self.configured_openclaw_runtime()? else {
                return Ok(());
            };

            // Running-state supervision should use shallow liveness first. OpenClaw
            // can temporarily drop /readyz while channels or sidecars reconnect even
            // though the gateway process and HTTP listener are still healthy.
            let health = self
                .paths
                .as_ref()
                .map(|paths| probe_running_gateway_health(&runtime, Some(paths)))
                .unwrap_or_else(|| probe_running_gateway_health(&runtime, None));
            if health.is_ready() {
                if matches!(lifecycle, ManagedServiceLifecycle::Failed) {
                    self.record_running(service_id, observed_pid)?;
                }
            } else if !matches!(lifecycle, ManagedServiceLifecycle::Failed) {
                self.record_health_check_failed(
                    service_id,
                    observed_pid,
                    format!(
                        "OpenClaw gateway on 127.0.0.1:{} is not ready ({})",
                        runtime.gateway_port,
                        health.detail()
                    ),
                )?;
            }
        }

        Ok(())
    }

    fn record_health_check_failed(
        &self,
        service_id: &str,
        pid: Option<u32>,
        last_error: String,
    ) -> Result<()> {
        let mut runtime = self.lock_runtime()?;
        let service = runtime.services.get_mut(service_id).ok_or_else(|| {
            FrameworkError::NotFound(format!("managed service not found: {service_id}"))
        })?;
        service.pid = pid.or(service.pid);
        service.last_error = Some(last_error);
        service.lifecycle = ManagedServiceLifecycle::Failed;
        Ok(())
    }

    #[cfg(test)]
    pub fn openclaw_gateway_launch_snapshot(&self) -> Result<Option<(String, Vec<String>)>> {
        Ok(self.lock_openclaw_runtime()?.as_ref().map(|runtime| {
            (
                runtime.node_path.to_string_lossy().into_owned(),
                vec![
                    runtime.cli_path.to_string_lossy().into_owned(),
                    "gateway".to_string(),
                ],
            )
        }))
    }
}

impl Default for SupervisorService {
    fn default() -> Self {
        Self::new()
    }
}

fn default_managed_services() -> Vec<ManagedServiceDefinition> {
    vec![ManagedServiceDefinition {
        id: SERVICE_ID_OPENCLAW_GATEWAY.to_string(),
        display_name: "OpenClaw Gateway".to_string(),
        command: None,
        args: Vec::new(),
        cwd: None,
        env: BTreeMap::new(),
        startup_order: 10,
        graceful_shutdown_timeout_ms: DEFAULT_GRACEFUL_SHUTDOWN_TIMEOUT_MS,
        restart_policy: RestartPolicy::crash_only_default(),
        health_check: ManagedServiceHealthCheck::ProcessAlive,
    }]
}

fn supervisor_lifecycle_label(lifecycle: &SupervisorLifecycle) -> &'static str {
    match lifecycle {
        SupervisorLifecycle::Starting => "starting",
        SupervisorLifecycle::Running => "running",
        SupervisorLifecycle::Stopping => "stopping",
        SupervisorLifecycle::Stopped => "stopped",
        SupervisorLifecycle::Failed => "failed",
    }
}

fn managed_service_lifecycle_label(lifecycle: &ManagedServiceLifecycle) -> &'static str {
    match lifecycle {
        ManagedServiceLifecycle::Starting => "starting",
        ManagedServiceLifecycle::Running => "running",
        ManagedServiceLifecycle::Stopping => "stopping",
        ManagedServiceLifecycle::Stopped => "stopped",
        ManagedServiceLifecycle::Failed => "failed",
    }
}

fn prepend_path_env(user_bin_dir: &std::path::Path) -> String {
    let current = env::var_os("PATH")
        .map(|value| value.to_string_lossy().into_owned())
        .unwrap_or_default();
    let separator = if cfg!(windows) { ';' } else { ':' };
    let user_bin = user_bin_dir.to_string_lossy();

    if current
        .split(separator)
        .any(|entry| entry.eq_ignore_ascii_case(user_bin.as_ref()))
    {
        return current;
    }

    if current.is_empty() {
        return user_bin.into_owned();
    }

    format!("{user_bin}{separator}{current}")
}

fn configure_command_for_managed_process(command: &mut Command) {
    configure_managed_child_process(command);
}

#[cfg(windows)]
fn managed_process_creation_flags() -> u32 {
    crate::framework::child_process::managed_child_process_creation_flags()
}

fn terminate_managed_process(child: &mut Child, timeout_ms: u64) -> Result<Option<i32>> {
    if let Some(status) = child.try_wait()? {
        return Ok(status.code());
    }

    request_process_shutdown(child)?;
    let deadline = Instant::now() + Duration::from_millis(timeout_ms);

    while Instant::now() < deadline {
        if let Some(status) = child.try_wait()? {
            return Ok(status.code());
        }
        thread::sleep(Duration::from_millis(50));
    }

    force_process_shutdown(child)?;
    Ok(child.wait()?.code())
}

fn wait_for_gateway_ready(
    child: &mut Child,
    runtime: &ActivatedOpenClawRuntime,
    _paths: &AppPaths,
    timeout_ms: u64,
) -> Result<()> {
    let deadline = Instant::now() + Duration::from_millis(timeout_ms);
    let started_waiting_at = Instant::now();
    let loopback = SocketAddr::V4(SocketAddrV4::new(Ipv4Addr::LOCALHOST, runtime.gateway_port));
    let mut next_health_probe_at = Instant::now();
    let mut last_probe_detail =
        "loopback listener is not yet accepting readiness probes".to_string();

    while Instant::now() < deadline {
        if let Some(status) = child.try_wait()? {
            return Err(FrameworkError::ProcessFailed {
                command: "openclaw gateway".to_string(),
                exit_code: status.code(),
                stderr_tail: format!("gateway exited before becoming ready on {}", loopback),
            });
        }

        let include_health_probe = Instant::now() >= next_health_probe_at;
        let readiness = probe_gateway_ready(runtime, include_health_probe);
        if readiness.is_ready() {
            ensure_gateway_child_survives_startup_stability_window(
                child,
                loopback,
                started_waiting_at,
            )?;
            return Ok(());
        }
        last_probe_detail = readiness.detail();
        if include_health_probe {
            next_health_probe_at = Instant::now()
                + Duration::from_millis(DEFAULT_OPENCLAW_GATEWAY_HEALTH_PROBE_INTERVAL_MS);
        }

        thread::sleep(Duration::from_millis(100));
    }

    Err(FrameworkError::Timeout(format!(
        "openclaw gateway did not become ready on {} within {}ms ({})",
        loopback, timeout_ms, last_probe_detail,
    )))
}

fn ensure_gateway_child_survives_startup_stability_window(
    child: &mut Child,
    loopback: SocketAddr,
    started_waiting_at: Instant,
) -> Result<()> {
    let post_ready_deadline =
        Instant::now() + Duration::from_millis(DEFAULT_OPENCLAW_GATEWAY_POST_READY_STABILITY_MS);
    let process_stability_deadline = started_waiting_at
        + Duration::from_millis(DEFAULT_OPENCLAW_GATEWAY_STARTUP_MIN_PROCESS_STABILITY_MS);
    let deadline = post_ready_deadline.max(process_stability_deadline);
    while Instant::now() < deadline {
        if let Some(status) = child.try_wait()? {
            return Err(FrameworkError::ProcessFailed {
                command: "openclaw gateway".to_string(),
                exit_code: status.code(),
                stderr_tail: format!("gateway exited before becoming ready on {}", loopback),
            });
        }
        thread::sleep(Duration::from_millis(25));
    }

    Ok(())
}

fn should_retry_openclaw_gateway_start_failure(error: &FrameworkError) -> bool {
    match error {
        FrameworkError::Io(io_error) => should_retry_openclaw_gateway_spawn_error(io_error),
        FrameworkError::ProcessFailed {
            command,
            stderr_tail,
            ..
        } => command == "openclaw gateway" && stderr_tail.contains("before becoming ready"),
        _ => false,
    }
}

fn should_retry_openclaw_gateway_spawn_error(error: &std::io::Error) -> bool {
    cfg!(windows)
        && (error.kind() == std::io::ErrorKind::PermissionDenied
            || matches!(error.raw_os_error(), Some(5 | 32 | 33)))
}

fn probe_gateway_ready(
    runtime: &ActivatedOpenClawRuntime,
    include_health_probe: bool,
) -> GatewayProbeStatus {
    let http_ready_probe = probe_gateway_http_ready(
        runtime,
        DEFAULT_OPENCLAW_GATEWAY_START_HTTP_READY_IO_TIMEOUT_MS,
    );
    if http_ready_probe.is_ready() {
        return http_ready_probe;
    }
    if is_gateway_readiness_terminal_http_status(&http_ready_probe) {
        return http_ready_probe;
    }

    if !include_health_probe {
        return GatewayProbeStatus::Pending(http_ready_probe.detail());
    }

    let http_live_probe = probe_gateway_http_live(
        runtime,
        DEFAULT_OPENCLAW_GATEWAY_START_HTTP_READY_IO_TIMEOUT_MS,
    );
    if http_live_probe.is_ready() {
        return http_live_probe;
    }

    GatewayProbeStatus::Pending(format!(
        "{}; {}",
        http_ready_probe.detail(),
        http_live_probe.detail()
    ))
}

fn is_gateway_readiness_terminal_http_status(status: &GatewayProbeStatus) -> bool {
    matches!(
        status,
        GatewayProbeStatus::HttpStatus {
            code: 401 | 403,
            ..
        }
    )
}

fn probe_gateway_http_ready(
    runtime: &ActivatedOpenClawRuntime,
    io_timeout_ms: u64,
) -> GatewayProbeStatus {
    probe_gateway_http_status(
        runtime,
        DEFAULT_OPENCLAW_GATEWAY_HTTP_READY_PATH,
        "ready probe",
        io_timeout_ms,
    )
}

fn probe_gateway_http_live(
    runtime: &ActivatedOpenClawRuntime,
    io_timeout_ms: u64,
) -> GatewayProbeStatus {
    probe_gateway_http_status(
        runtime,
        DEFAULT_OPENCLAW_GATEWAY_HTTP_LIVE_PATH,
        "live probe",
        io_timeout_ms,
    )
}

fn probe_running_gateway_health(
    runtime: &ActivatedOpenClawRuntime,
    paths: Option<&AppPaths>,
) -> GatewayProbeStatus {
    let live_probe =
        probe_gateway_http_live(runtime, DEFAULT_OPENCLAW_GATEWAY_RUNTIME_HTTP_IO_TIMEOUT_MS);
    if live_probe.is_ready() {
        return live_probe;
    }

    let ready_probe =
        probe_gateway_http_ready(runtime, DEFAULT_OPENCLAW_GATEWAY_RUNTIME_HTTP_IO_TIMEOUT_MS);
    if ready_probe.is_ready() {
        return ready_probe;
    }

    let Some(paths) = paths else {
        return GatewayProbeStatus::Pending(format!(
            "{}; {}",
            live_probe.detail(),
            ready_probe.detail()
        ));
    };

    let health_probe = probe_gateway_cli_health_ready(
        runtime,
        paths,
        DEFAULT_OPENCLAW_GATEWAY_RUNTIME_HEALTH_PROBE_TIMEOUT_MS,
    );
    if health_probe.is_ready() {
        return health_probe;
    }

    GatewayProbeStatus::Pending(format!(
        "{}; {}; {}",
        live_probe.detail(),
        ready_probe.detail(),
        health_probe.detail()
    ))
}

fn probe_gateway_http_status(
    runtime: &ActivatedOpenClawRuntime,
    path: &str,
    label: &str,
    io_timeout_ms: u64,
) -> GatewayProbeStatus {
    let loopback = SocketAddr::V4(SocketAddrV4::new(Ipv4Addr::LOCALHOST, runtime.gateway_port));
    let mut stream = match TcpStream::connect_timeout(
        &loopback,
        Duration::from_millis(DEFAULT_OPENCLAW_GATEWAY_HTTP_CONNECT_TIMEOUT_MS),
    ) {
        Ok(stream) => stream,
        Err(error) => {
            return GatewayProbeStatus::Pending(format!(
                "{label} could not connect to {}: {}",
                loopback, error
            ));
        }
    };

    if stream
        .set_read_timeout(Some(Duration::from_millis(io_timeout_ms)))
        .is_err()
        || stream
            .set_write_timeout(Some(Duration::from_millis(io_timeout_ms)))
            .is_err()
    {
        return GatewayProbeStatus::Pending(format!(
            "{label} could not configure socket timeouts for {}",
            loopback
        ));
    }

    let request = format!(
        "GET {path} HTTP/1.1\r\nHost: 127.0.0.1:{port}\r\nAccept: application/json\r\nConnection: close\r\n\r\n",
        port = runtime.gateway_port,
    );

    if let Err(error) = stream.write_all(request.as_bytes()) {
        return GatewayProbeStatus::Pending(format!(
            "{label} write failed for {}: {}",
            loopback, error
        ));
    }
    if let Err(error) = stream.flush() {
        return GatewayProbeStatus::Pending(format!(
            "{label} flush failed for {}: {}",
            loopback, error
        ));
    }

    let status_line = match read_http_status_line(&mut stream) {
        Ok(Some(status_line)) => status_line,
        Ok(None) => {
            return GatewayProbeStatus::Pending(format!("{label} returned an empty response"))
        }
        Err(error) => {
            return GatewayProbeStatus::Pending(format!(
                "{label} read failed for {}: {}",
                loopback, error
            ));
        }
    };

    let code = parse_http_status_code(status_line.as_str()).unwrap_or_default();
    if (200..=299).contains(&code) {
        return GatewayProbeStatus::Ready;
    }

    GatewayProbeStatus::HttpStatus {
        code,
        detail: format!("{label} returned {}", status_line),
    }
}

fn parse_http_status_code(status_line: &str) -> Option<u16> {
    status_line.split_whitespace().nth(1)?.parse::<u16>().ok()
}

fn read_http_status_line(stream: &mut TcpStream) -> std::io::Result<Option<String>> {
    let mut response = Vec::new();
    let mut chunk = [0_u8; 1024];

    loop {
        match stream.read(&mut chunk) {
            Ok(0) => return Ok(extract_http_status_line(&response)),
            Ok(bytes_read) => {
                response.extend_from_slice(&chunk[..bytes_read]);
                if let Some(status_line) = extract_http_status_line(&response) {
                    return Ok(Some(status_line));
                }
            }
            Err(error) => {
                if extract_http_status_line(&response).is_some() {
                    return Ok(extract_http_status_line(&response));
                }
                return Err(error);
            }
        }
    }
}

fn extract_http_status_line(response: &[u8]) -> Option<String> {
    let header_end = response
        .windows(2)
        .position(|window| window == b"\r\n")
        .or_else(|| response.iter().position(|byte| *byte == b'\n'))?;
    let line = String::from_utf8_lossy(&response[..header_end])
        .trim_end_matches('\r')
        .trim()
        .to_string();
    if line.is_empty() {
        None
    } else {
        Some(line)
    }
}

fn probe_gateway_cli_health_ready(
    runtime: &ActivatedOpenClawRuntime,
    paths: &AppPaths,
    timeout_ms: u64,
) -> GatewayProbeStatus {
    if !is_loopback_port_accepting(runtime.gateway_port) {
        return GatewayProbeStatus::Pending(format!(
            "gateway health probe skipped because 127.0.0.1:{} is not accepting connections",
            runtime.gateway_port
        ));
    }

    let mut command = Command::new(&runtime.node_path);
    configure_command_for_managed_process(&mut command);
    command.arg(&runtime.cli_path);
    command.arg("gateway");
    command.arg("health");
    command.arg("--json");
    command.arg("--timeout");
    command.arg(timeout_ms.to_string());
    command.current_dir(&runtime.runtime_dir);
    let managed_env = match runtime.managed_env_with_local_ai_proxy(paths) {
        Ok(env) => env,
        Err(error) => {
            return GatewayProbeStatus::Pending(format!(
                "gateway health probe could not resolve local ai proxy token: {}",
                error
            ));
        }
    };
    command.envs(managed_env);
    command.stdout(Stdio::piped());
    command.stderr(Stdio::piped());

    let mut child = match command.spawn() {
        Ok(child) => child,
        Err(error) => {
            return GatewayProbeStatus::Pending(format!(
                "gateway health probe failed to spawn: {}",
                error
            ));
        }
    };

    let deadline = Instant::now() + Duration::from_millis(timeout_ms.saturating_add(250));
    while Instant::now() < deadline {
        match child.try_wait() {
            Ok(Some(status)) => {
                let (stdout, stderr) = collect_child_output(&mut child);
                if status.success() {
                    return GatewayProbeStatus::Ready;
                }

                let detail = summarize_probe_output(&stderr)
                    .or_else(|| summarize_probe_output(&stdout))
                    .unwrap_or_else(|| {
                        format!(
                            "gateway health probe exited with status {}",
                            status
                                .code()
                                .map(|value| value.to_string())
                                .unwrap_or_else(|| "unknown".to_string())
                        )
                    });
                return GatewayProbeStatus::Pending(detail);
            }
            Ok(None) => thread::sleep(Duration::from_millis(50)),
            Err(error) => {
                let _ = force_process_shutdown(&mut child);
                let _ = child.wait();
                return GatewayProbeStatus::Pending(format!(
                    "gateway health probe wait failed: {}",
                    error
                ));
            }
        }
    }

    let _ = force_process_shutdown(&mut child);
    let _ = child.wait();
    GatewayProbeStatus::Pending(format!(
        "gateway health probe timed out after {}ms",
        timeout_ms
    ))
}

fn collect_child_output(child: &mut Child) -> (String, String) {
    let mut stdout = String::new();
    if let Some(mut pipe) = child.stdout.take() {
        let _ = pipe.read_to_string(&mut stdout);
    }

    let mut stderr = String::new();
    if let Some(mut pipe) = child.stderr.take() {
        let _ = pipe.read_to_string(&mut stderr);
    }

    (stdout, stderr)
}

fn summarize_probe_output(output: &str) -> Option<String> {
    output
        .lines()
        .map(str::trim)
        .find(|line| !line.is_empty())
        .map(|line| {
            if line.len() > 200 {
                format!("{}...", &line[..200])
            } else {
                line.to_string()
            }
        })
}

fn reap_stale_openclaw_gateway_processes(paths: &AppPaths) -> Result<()> {
    let stale_pids = find_stale_openclaw_gateway_process_ids(paths)?;
    if stale_pids.is_empty() {
        return Ok(());
    }

    let configured_port = configured_openclaw_gateway_port(paths);
    match terminate_process_ids(&stale_pids) {
        Ok(()) => {}
        Err(error) => {
            if should_continue_after_stale_openclaw_termination_error(
                &error,
                configured_port,
                is_loopback_port_accepting,
            ) {
                return Ok(());
            }
            return Err(error);
        }
    }

    let deadline = Instant::now() + Duration::from_secs(5);
    while Instant::now() < deadline {
        if find_stale_openclaw_gateway_process_ids(paths)?.is_empty() {
            return Ok(());
        }

        if configured_port
            .map(|port| !is_loopback_port_accepting(port))
            .unwrap_or(false)
        {
            return Ok(());
        }

        thread::sleep(Duration::from_millis(100));
    }

    let remaining_processes = describe_stale_openclaw_gateway_processes(paths);
    let port_diagnostic = configured_port
        .map(|port| {
            format!(
                "configured gateway port {port} listening={}",
                is_loopback_port_accepting(port)
            )
        })
        .unwrap_or_else(|| "configured gateway port unavailable".to_string());

    let runtime_dir = built_in_openclaw_runtime_dir(paths)?;
    Err(FrameworkError::Timeout(format!(
        "stale openclaw gateway processes did not stop within 5000ms under {} ({port_diagnostic}; remaining processes: {})",
        runtime_dir.display(),
        if remaining_processes.is_empty() {
            "none".to_string()
        } else {
            remaining_processes.join(" | ")
        }
    )))
}

fn should_continue_after_stale_openclaw_termination_error<F>(
    error: &FrameworkError,
    configured_port: Option<u16>,
    is_port_accepting: F,
) -> bool
where
    F: Fn(u16) -> bool,
{
    is_stale_openclaw_termination_access_denied(error)
        && configured_port
            .map(|port| !is_port_accepting(port))
            .unwrap_or(false)
}

fn is_stale_openclaw_termination_access_denied(error: &FrameworkError) -> bool {
    let message = error.to_string().to_ascii_lowercase();
    message.contains("stale openclaw gateway process")
        && (message.contains("os error 5") || message.contains("access denied"))
}

fn configured_openclaw_gateway_port(paths: &AppPaths) -> Option<u16> {
    let config_path = readable_openclaw_config_file_path(paths).ok()?;
    if !config_path.exists() {
        return None;
    }
    let config = fs::read_to_string(config_path).ok()?;
    let parsed = json5::from_str::<serde_json::Value>(&config).ok()?;
    parsed
        .get("gateway")
        .and_then(|value| value.get("port"))
        .and_then(|value| value.as_u64())
        .and_then(|value| u16::try_from(value).ok())
        .filter(|port| *port > 0)
}

fn readable_openclaw_config_file_path(paths: &AppPaths) -> Result<PathBuf> {
    KernelRuntimeAuthorityService::new().active_config_file_path("openclaw", paths)
}

fn built_in_openclaw_runtime_dir(paths: &AppPaths) -> Result<PathBuf> {
    paths
        .kernel_paths("openclaw")
        .map(|kernel| kernel.runtime_dir)
}

fn is_loopback_port_accepting(port: u16) -> bool {
    let loopback = SocketAddr::V4(SocketAddrV4::new(Ipv4Addr::LOCALHOST, port));
    TcpStream::connect_timeout(&loopback, Duration::from_millis(200)).is_ok()
}

fn describe_stale_openclaw_gateway_processes(paths: &AppPaths) -> Vec<String> {
    let owned_runtime_roots = match openclaw_owned_runtime_roots(paths) {
        Ok(roots) => roots,
        Err(_) => return Vec::new(),
    };
    let current_process_id = std::process::id();
    let mut system = System::new_all();
    system.refresh_processes(ProcessesToUpdate::All, true);

    system
        .processes()
        .iter()
        .filter_map(|(pid, process)| {
            let pid = pid.as_u32();
            if pid == current_process_id {
                return None;
            }

            if !command_matches_built_in_openclaw_gateway(process.cmd(), &owned_runtime_roots) {
                return None;
            }

            Some(format!(
                "pid={pid} status={:?} cmd={}",
                process.status(),
                process
                    .cmd()
                    .iter()
                    .map(|segment| segment.to_string_lossy())
                    .collect::<Vec<_>>()
                    .join(" ")
            ))
        })
        .collect()
}

fn find_stale_openclaw_gateway_process_ids(paths: &AppPaths) -> Result<Vec<u32>> {
    let owned_runtime_roots = openclaw_owned_runtime_roots(paths)?;
    let current_process_id = std::process::id();
    let mut system = System::new_all();
    system.refresh_processes(ProcessesToUpdate::All, true);

    Ok(system
        .processes()
        .iter()
        .filter_map(|(pid, process)| {
            let pid = pid.as_u32();
            if pid == current_process_id {
                return None;
            }

            if matches!(
                process.status(),
                ProcessStatus::Dead | ProcessStatus::Zombie
            ) {
                return None;
            }

            if !command_matches_built_in_openclaw_gateway(process.cmd(), &owned_runtime_roots) {
                return None;
            }

            Some(pid)
        })
        .collect())
}

fn openclaw_owned_runtime_roots(paths: &AppPaths) -> Result<Vec<PathBuf>> {
    KernelRuntimeAuthorityService::new()
        .contract("openclaw", paths)
        .map(|contract| contract.owned_runtime_roots)
        .or_else(|_| built_in_openclaw_runtime_dir(paths).map(|runtime_dir| vec![runtime_dir]))
}

fn command_matches_built_in_openclaw_gateway<S>(
    command: &[S],
    owned_runtime_roots: &[PathBuf],
) -> bool
where
    S: AsRef<OsStr>,
{
    let normalized_roots = owned_runtime_roots
        .iter()
        .map(|path| normalize_process_match_path(path))
        .collect::<Vec<_>>();

    let matches_runtime = command.iter().any(|segment| {
        let segment = normalize_command_segment(segment.as_ref());
        normalized_roots
            .iter()
            .any(|root| segment.starts_with(root) && segment.ends_with("openclaw.mjs"))
    });
    let matches_gateway = command
        .iter()
        .any(|segment| normalize_command_segment(segment.as_ref()) == "gateway");

    matches_runtime && matches_gateway
}

fn normalize_process_match_path(path: &Path) -> String {
    path.to_string_lossy()
        .replace('/', "\\")
        .trim_end_matches('\\')
        .to_ascii_lowercase()
}

fn normalize_command_segment(segment: &OsStr) -> String {
    segment
        .to_string_lossy()
        .replace('/', "\\")
        .trim_matches('"')
        .to_ascii_lowercase()
}

fn terminate_process_group(
    children: &mut Vec<ManagedChildProcessHandle>,
    timeout_ms: u64,
) -> Result<(Option<i32>, Option<String>)> {
    let mut first_exit_code = None;
    let mut first_error = None;

    for child in children.iter_mut() {
        match terminate_managed_process(&mut child.child, timeout_ms) {
            Ok(exit_code) => {
                if first_exit_code.is_none() {
                    first_exit_code = exit_code;
                }
            }
            Err(error) => {
                if first_error.is_none() {
                    first_error =
                        Some(format!("failed to stop {} process: {}", child.label, error));
                }
            }
        }
    }

    Ok((first_exit_code, first_error))
}

#[cfg(windows)]
fn terminate_process_id(pid: u32) -> Result<()> {
    let Some(handle) = open_terminable_process_handle(pid)? else {
        return Ok(());
    };
    let _handle = WindowsHandle(handle);

    let terminated = unsafe { TerminateProcess(handle, 1) };
    if terminated == 0 {
        return Err(FrameworkError::Internal(format!(
            "failed to terminate stale openclaw gateway process {pid}: {}",
            std::io::Error::last_os_error()
        )));
    }

    let wait_result = unsafe { WaitForSingleObject(handle, 5_000) };
    if wait_result != WAIT_OBJECT_0 {
        return Err(FrameworkError::Timeout(format!(
            "stale openclaw gateway process {pid} did not exit after native termination"
        )));
    }

    Ok(())
}

#[cfg(not(windows))]
fn terminate_process_id(pid: u32) -> Result<()> {
    unsafe {
        libc::kill(pid as i32, libc::SIGKILL);
    }
    Ok(())
}

#[cfg(windows)]
fn terminate_process_ids(pids: &[u32]) -> Result<()> {
    for pid in pids {
        terminate_process_id(*pid)?;
    }
    Ok(())
}

#[cfg(windows)]
struct WindowsHandle(HANDLE);

#[cfg(windows)]
impl Drop for WindowsHandle {
    fn drop(&mut self) {
        if !self.0.is_null() {
            unsafe {
                CloseHandle(self.0);
            }
        }
    }
}

#[cfg(windows)]
fn open_terminable_process_handle(pid: u32) -> Result<Option<HANDLE>> {
    let handle = unsafe { OpenProcess(PROCESS_TERMINATE | PROCESS_SYNCHRONIZE, 0, pid) };
    if !handle.is_null() {
        return Ok(Some(handle));
    }

    match std::io::Error::last_os_error().raw_os_error() {
        Some(87) => Ok(None),
        _ => Err(FrameworkError::Internal(format!(
            "failed to open stale openclaw gateway process {pid}: {}",
            std::io::Error::last_os_error()
        ))),
    }
}

#[cfg(not(windows))]
fn terminate_process_ids(pids: &[u32]) -> Result<()> {
    for pid in pids {
        terminate_process_id(*pid)?;
    }
    Ok(())
}

#[cfg(windows)]
fn request_process_shutdown(child: &mut Child) -> Result<()> {
    let pid = child.id().to_string();
    let mut command = Command::new("taskkill");
    configure_hidden_child_process(&mut command);
    let _ = command
        .args(["/PID", pid.as_str(), "/T"])
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status();
    Ok(())
}

#[cfg(not(windows))]
fn request_process_shutdown(child: &mut Child) -> Result<()> {
    let pid = child.id() as i32;
    unsafe {
        libc::killpg(pid, libc::SIGTERM);
    }
    Ok(())
}

#[cfg(windows)]
fn force_process_shutdown(child: &mut Child) -> Result<()> {
    let pid = child.id().to_string();
    let mut command = Command::new("taskkill");
    configure_hidden_child_process(&mut command);
    let _ = command
        .args(["/PID", pid.as_str(), "/T", "/F"])
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status();

    if child.try_wait()?.is_none() {
        child.kill()?;
    }

    Ok(())
}

#[cfg(not(windows))]
fn force_process_shutdown(child: &mut Child) -> Result<()> {
    let pid = child.id() as i32;
    unsafe {
        libc::killpg(pid, libc::SIGKILL);
    }
    if child.try_wait()?.is_none() {
        child.kill()?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::{
        command_matches_built_in_openclaw_gateway, configured_openclaw_gateway_port,
        force_process_shutdown,
    };
    use super::{
        configure_command_for_managed_process, terminate_process_id, wait_for_gateway_ready,
        ManagedServiceLifecycle, SupervisorService, SERVICE_ID_OPENCLAW_GATEWAY,
    };
    #[cfg(windows)]
    use super::{managed_process_creation_flags, CREATE_NEW_PROCESS_GROUP, CREATE_NO_WINDOW};
    use crate::framework::{
        openclaw_release::bundled_openclaw_version,
        paths::resolve_paths_for_root,
        services::{
            kernel_runtime_authority::KernelRuntimeAuthorityService,
            openclaw_channel_config::write_test_openclaw_channel_metadata,
            openclaw_runtime::ActivatedOpenClawRuntime,
        },
    };
    use std::{
        fs,
        io::{Read, Write},
        net::{TcpListener, TcpStream},
        process::Command,
        sync::{
            atomic::{AtomicBool, Ordering},
            Arc, Barrier,
        },
        thread,
        time::{Duration, Instant, UNIX_EPOCH},
    };

    #[test]
    fn supervisor_registers_default_background_services() {
        let service = SupervisorService::new();

        assert_eq!(
            service.managed_service_ids(),
            vec![SERVICE_ID_OPENCLAW_GATEWAY.to_string()]
        );
    }

    #[test]
    fn supervisor_plans_shutdown_in_reverse_startup_order() {
        let service = SupervisorService::new();

        assert_eq!(
            service.planned_shutdown_order(),
            vec![SERVICE_ID_OPENCLAW_GATEWAY.to_string()]
        );
    }

    #[test]
    fn supervisor_requests_manual_restart_for_managed_services() {
        let service = SupervisorService::new();
        service
            .record_running(SERVICE_ID_OPENCLAW_GATEWAY, Some(42))
            .expect("service should be running");

        service
            .request_restart(SERVICE_ID_OPENCLAW_GATEWAY)
            .expect("manual restart request");

        let snapshot = service.snapshot().expect("snapshot");
        let openclaw = snapshot
            .services
            .into_iter()
            .find(|managed_service| managed_service.id == SERVICE_ID_OPENCLAW_GATEWAY)
            .expect("openclaw service");

        assert_eq!(openclaw.lifecycle, ManagedServiceLifecycle::Starting);
        assert_eq!(openclaw.pid, None);
        assert_eq!(openclaw.last_exit_code, None);
    }

    #[test]
    fn supervisor_requests_all_services_in_startup_order() {
        let service = SupervisorService::new();

        assert_eq!(
            service.request_restart_all().expect("restart plan"),
            vec![SERVICE_ID_OPENCLAW_GATEWAY.to_string()]
        );
    }

    #[test]
    fn supervisor_throttles_restart_storms_within_the_policy_window() {
        let service = SupervisorService::new();
        let started_at = UNIX_EPOCH + Duration::from_secs(1_000);

        assert!(service
            .register_restart_attempt(SERVICE_ID_OPENCLAW_GATEWAY, started_at)
            .expect("first restart"));
        assert!(service
            .register_restart_attempt(
                SERVICE_ID_OPENCLAW_GATEWAY,
                started_at + Duration::from_secs(5),
            )
            .expect("second restart"));
        assert!(service
            .register_restart_attempt(
                SERVICE_ID_OPENCLAW_GATEWAY,
                started_at + Duration::from_secs(10),
            )
            .expect("third restart"));
        assert!(!service
            .register_restart_attempt(
                SERVICE_ID_OPENCLAW_GATEWAY,
                started_at + Duration::from_secs(15),
            )
            .expect("fourth restart should be blocked"));
    }

    #[test]
    fn supervisor_disables_restarts_after_intentional_shutdown() {
        let service = SupervisorService::new();

        service.begin_shutdown().expect("begin shutdown");

        assert!(!service
            .register_restart_attempt(
                SERVICE_ID_OPENCLAW_GATEWAY,
                UNIX_EPOCH + Duration::from_secs(10),
            )
            .expect("restart should be disabled"));
    }

    #[test]
    fn supervisor_configures_openclaw_gateway_launch_from_runtime() {
        let service = SupervisorService::new();
        let root = tempfile::tempdir().expect("temp dir");
        let paths = resolve_paths_for_root(root.path()).expect("paths");
        let runtime = fake_gateway_runtime(&paths);

        service
            .configure_openclaw_gateway(&runtime)
            .expect("configure runtime");

        let launch = service
            .openclaw_gateway_launch_snapshot()
            .expect("launch snapshot")
            .expect("configured launch");

        assert_eq!(launch.0, runtime.node_path.to_string_lossy());
        assert_eq!(
            launch.1,
            vec![
                runtime.cli_path.to_string_lossy().into_owned(),
                "gateway".to_string(),
            ]
        );
    }

    #[test]
    fn supervisor_starts_and_stops_configured_openclaw_gateway_process() {
        let service = SupervisorService::new();
        let root = tempfile::tempdir().expect("temp dir");
        let paths = resolve_paths_for_root(root.path()).expect("paths");
        let runtime = fake_gateway_runtime(&paths);

        service
            .configure_openclaw_gateway(&runtime)
            .expect("configure runtime");
        service
            .start_openclaw_gateway(&paths)
            .expect("start gateway");

        let running = service.snapshot().expect("running snapshot");
        let openclaw = running
            .services
            .into_iter()
            .find(|managed_service| managed_service.id == SERVICE_ID_OPENCLAW_GATEWAY)
            .expect("openclaw service");
        assert_eq!(openclaw.lifecycle, ManagedServiceLifecycle::Running);
        assert!(openclaw.pid.is_some());

        service.begin_shutdown().expect("shutdown");

        let stopped = service.snapshot().expect("stopped snapshot");
        let openclaw = stopped
            .services
            .into_iter()
            .find(|managed_service| managed_service.id == SERVICE_ID_OPENCLAW_GATEWAY)
            .expect("openclaw service");
        assert_eq!(openclaw.lifecycle, ManagedServiceLifecycle::Stopped);
        assert_eq!(openclaw.pid, None);
    }

    #[test]
    fn bootstrap_start_default_services_starts_configured_openclaw_gateway() {
        let root = tempfile::tempdir().expect("temp dir");
        let paths = resolve_paths_for_root(root.path()).expect("paths");
        let service = SupervisorService::for_paths(&paths);
        let runtime = fake_gateway_runtime(&paths);

        service
            .configure_openclaw_gateway(&runtime)
            .expect("configure runtime");

        let started = service
            .start_default_services()
            .expect("start default services");

        assert_eq!(started, vec![SERVICE_ID_OPENCLAW_GATEWAY.to_string()]);

        let snapshot = service.snapshot().expect("snapshot");
        let openclaw = snapshot
            .services
            .into_iter()
            .find(|managed_service| managed_service.id == SERVICE_ID_OPENCLAW_GATEWAY)
            .expect("openclaw service");
        assert_eq!(openclaw.lifecycle, ManagedServiceLifecycle::Running);
        assert!(openclaw.pid.is_some());

        service.begin_shutdown().expect("shutdown");
    }

    #[test]
    fn bootstrap_start_default_services_fails_without_a_configured_openclaw_runtime() {
        let root = tempfile::tempdir().expect("temp dir");
        let paths = resolve_paths_for_root(root.path()).expect("paths");
        let service = SupervisorService::for_paths(&paths);

        let error = service
            .start_default_services()
            .expect_err("default services should require a configured openclaw runtime");

        assert!(error.to_string().contains("configured openclaw runtime"));
    }

    #[test]
    fn supervisor_start_refreshes_openclaw_runtime_from_managed_config() {
        let service = SupervisorService::new();
        let root = tempfile::tempdir().expect("temp dir");
        let paths = resolve_paths_for_root(root.path()).expect("paths");
        let runtime = fake_gateway_runtime(&paths);
        let configured_port = reserve_test_loopback_port();

        service
            .configure_openclaw_gateway(&runtime)
            .expect("configure runtime");
        fs::write(
            &openclaw_config_file_path(&paths),
            format!("{{\n  \"gateway\": {{\n    \"port\": {configured_port}\n  }}\n}}\n"),
        )
        .expect("seed updated config");

        service
            .start_openclaw_gateway(&paths)
            .expect("start gateway with refreshed port");

        let refreshed = service
            .configured_openclaw_runtime()
            .expect("configured runtime")
            .expect("runtime");
        assert_eq!(refreshed.gateway_port, configured_port);

        service.begin_shutdown().expect("shutdown");
    }

    #[test]
    fn supervisor_allows_slow_openclaw_gateway_startup_within_the_readiness_window() {
        let service = SupervisorService::new();
        let root = tempfile::tempdir().expect("temp dir");
        let paths = resolve_paths_for_root(root.path()).expect("paths");
        let runtime = fake_gateway_runtime_with_delay_ms(&paths, 11_000);

        service
            .configure_openclaw_gateway(&runtime)
            .expect("configure runtime");
        service
            .start_openclaw_gateway(&paths)
            .expect("slow gateway should still become ready");

        let running = service.snapshot().expect("running snapshot");
        let openclaw = running
            .services
            .into_iter()
            .find(|managed_service| managed_service.id == SERVICE_ID_OPENCLAW_GATEWAY)
            .expect("openclaw service");
        assert_eq!(openclaw.lifecycle, ManagedServiceLifecycle::Running);
        assert!(openclaw.pid.is_some());

        service.begin_shutdown().expect("shutdown");
    }

    #[test]
    fn supervisor_accepts_gateway_http_liveness_before_readyz_readiness() {
        let service = SupervisorService::new();
        let root = tempfile::tempdir().expect("temp dir");
        let paths = resolve_paths_for_root(root.path()).expect("paths");
        let runtime = fake_gateway_runtime_with_http_ready_delay_ms(&paths, 0, 1_200);

        service
            .configure_openclaw_gateway(&runtime)
            .expect("configure runtime");

        service
            .start_openclaw_gateway(&paths)
            .expect("gateway should accept /healthz liveness while /readyz warms");

        let running = service.snapshot().expect("running snapshot");
        let openclaw = running
            .services
            .into_iter()
            .find(|managed_service| managed_service.id == SERVICE_ID_OPENCLAW_GATEWAY)
            .expect("openclaw service");
        assert_eq!(openclaw.lifecycle, ManagedServiceLifecycle::Running);
        assert!(openclaw.pid.is_some());

        service.begin_shutdown().expect("shutdown");
    }

    #[test]
    fn concurrent_gateway_start_requests_do_not_spawn_duplicate_processes() {
        let root = tempfile::tempdir().expect("temp dir");
        let paths = resolve_paths_for_root(root.path()).expect("paths");
        let service = SupervisorService::for_paths(&paths);
        let runtime = fake_gateway_runtime_with_script(
            &paths,
            "import fs from 'node:fs';\nimport http from 'node:http';\nconst args = process.argv.slice(2);\nconst configPath = process.env.OPENCLAW_CONFIG_PATH;\nconst attemptPath = `${configPath}.startup-attempt`;\nconst readyPath = `${configPath}.startup-ready`;\nconst config = JSON.parse(fs.readFileSync(configPath, 'utf8'));\nconst gatewayPort = Number(config.gateway?.port ?? 21280);\nconst expectedAuthorization = `Bearer ${process.env.OPENCLAW_GATEWAY_TOKEN ?? ''}`;\nif (args[0] === 'gateway' && args[1] === 'health') {\n  if (fs.existsSync(readyPath)) {\n    process.stdout.write(JSON.stringify({ ok: true, result: { status: 'ok' } }));\n    process.exit(0);\n  }\n  process.stderr.write('gateway warming');\n  process.exit(1);\n}\nconst attempt = (fs.existsSync(attemptPath) ? Number(fs.readFileSync(attemptPath, 'utf8')) : 0) + 1;\nfs.writeFileSync(attemptPath, String(attempt));\nconst server = http.createServer((req, res) => {\n  if (req.url === '/health' || req.url === '/healthz') {\n    res.writeHead(200, { 'content-type': 'application/json' });\n    res.end(JSON.stringify({ ok: true, status: 'live' }));\n    return;\n  }\n  if (req.url === '/ready' || req.url === '/readyz') {\n    if (!fs.existsSync(readyPath)) {\n      res.writeHead(503, { 'content-type': 'application/json' });\n      res.end(JSON.stringify({ ready: false, failing: ['startup'], uptimeMs: 0 }));\n      return;\n    }\n    res.writeHead(200, { 'content-type': 'application/json' });\n    res.end(JSON.stringify({ ready: true, failing: [], uptimeMs: 1800 }));\n    return;\n  }\n  if (req.url !== '/tools/invoke' || req.method !== 'POST') {\n    res.writeHead(404, { 'content-type': 'application/json' });\n    res.end(JSON.stringify({ ok: false, error: { message: 'unexpected path' } }));\n    return;\n  }\n  if ((req.headers.authorization ?? '') !== expectedAuthorization) {\n    res.writeHead(401, { 'content-type': 'application/json' });\n    res.end(JSON.stringify({ ok: false, error: { message: 'unauthorized' } }));\n    return;\n  }\n  let body = '';\n  req.setEncoding('utf8');\n  req.on('data', (chunk) => { body += chunk; });\n  req.on('end', () => {\n    const payload = body.trim() ? JSON.parse(body) : {};\n    if (!fs.existsSync(readyPath)) {\n      res.writeHead(503, { 'content-type': 'application/json' });\n      res.end(JSON.stringify({ ok: false, error: { message: 'gateway warming' } }));\n      return;\n    }\n    res.writeHead(200, { 'content-type': 'application/json' });\n    res.end(JSON.stringify({ ok: true, result: { method: payload.action ? `${payload.tool}.${payload.action}` : payload.tool ?? 'unknown' } }));\n  });\n});\nserver.listen(gatewayPort, '127.0.0.1', () => {\n  setTimeout(() => {\n    fs.writeFileSync(readyPath, 'ok');\n  }, 1800);\n});\nsetInterval(() => {}, 1000);\n"
                .to_string(),
        );
        let attempt_path = runtime.config_path.with_extension("json.startup-attempt");
        let start_barrier = Arc::new(Barrier::new(3));

        service
            .configure_openclaw_gateway(&runtime)
            .expect("configure runtime");

        let first_service = service.clone();
        let first_paths = paths.clone();
        let first_barrier = start_barrier.clone();
        let first_start = thread::spawn(move || {
            first_barrier.wait();
            first_service
                .start_openclaw_gateway(&first_paths)
                .map_err(|error| error.to_string())
        });

        let second_service = service.clone();
        let second_paths = paths.clone();
        let second_barrier = start_barrier.clone();
        let second_start = thread::spawn(move || {
            second_barrier.wait();
            second_service
                .start_openclaw_gateway(&second_paths)
                .map_err(|error| error.to_string())
        });

        start_barrier.wait();

        first_start
            .join()
            .expect("first start thread should join")
            .expect("first concurrent start should succeed");
        second_start
            .join()
            .expect("second start thread should join")
            .expect("second concurrent start should reuse the in-flight startup");

        assert_eq!(
            fs::read_to_string(&attempt_path).expect("startup attempt marker"),
            "1",
            "concurrent start requests must converge on a single spawned gateway process",
        );

        let running = service.snapshot().expect("running snapshot");
        let openclaw = running
            .services
            .into_iter()
            .find(|managed_service| managed_service.id == SERVICE_ID_OPENCLAW_GATEWAY)
            .expect("openclaw service");
        assert_eq!(openclaw.lifecycle, ManagedServiceLifecycle::Running);
        assert!(openclaw.pid.is_some());

        service.begin_shutdown().expect("shutdown");
    }

    #[test]
    fn supervisor_retries_gateway_start_when_the_first_cold_start_exits_immediately() {
        let service = SupervisorService::new();
        let root = tempfile::tempdir().expect("temp dir");
        let paths = resolve_paths_for_root(root.path()).expect("paths");
        let runtime = fake_gateway_runtime_with_script(
            &paths,
            "import fs from 'node:fs';\nimport http from 'node:http';\nconst args = process.argv.slice(2);\nconst configPath = process.env.OPENCLAW_CONFIG_PATH;\nconst attemptPath = `${configPath}.startup-attempt`;\nconst config = JSON.parse(fs.readFileSync(configPath, 'utf8'));\nconst gatewayPort = Number(config.gateway?.port ?? 21280);\nconst expectedAuthorization = `Bearer ${process.env.OPENCLAW_GATEWAY_TOKEN ?? ''}`;\nif (args[0] === 'gateway' && args[1] === 'health') {\n  process.stdout.write(JSON.stringify({ ok: true, result: { status: 'ok' } }));\n  process.exit(0);\n}\nconst attempt = (fs.existsSync(attemptPath) ? Number(fs.readFileSync(attemptPath, 'utf8')) : 0) + 1;\nfs.writeFileSync(attemptPath, String(attempt));\nif (attempt === 1) {\n  process.stderr.write('transient cold-start failure');\n  process.exit(1);\n}\nconst server = http.createServer((req, res) => {\n  if (req.url === '/health' || req.url === '/healthz') {\n    res.writeHead(200, { 'content-type': 'application/json' });\n    res.end(JSON.stringify({ ok: true, status: 'live' }));\n    return;\n  }\n  if (req.url === '/ready' || req.url === '/readyz') {\n    res.writeHead(200, { 'content-type': 'application/json' });\n    res.end(JSON.stringify({ ready: true, failing: [], uptimeMs: 1 }));\n    return;\n  }\n  if (req.url !== '/tools/invoke' || req.method !== 'POST') {\n    res.writeHead(404, { 'content-type': 'application/json' });\n    res.end(JSON.stringify({ ok: false, error: { message: 'unexpected path' } }));\n    return;\n  }\n  if ((req.headers.authorization ?? '') !== expectedAuthorization) {\n    res.writeHead(401, { 'content-type': 'application/json' });\n    res.end(JSON.stringify({ ok: false, error: { message: 'unauthorized' } }));\n    return;\n  }\n  let body = '';\n  req.setEncoding('utf8');\n  req.on('data', (chunk) => { body += chunk; });\n  req.on('end', () => {\n    const payload = body.trim() ? JSON.parse(body) : {};\n    res.writeHead(200, { 'content-type': 'application/json' });\n    res.end(JSON.stringify({ ok: true, result: { method: payload.action ? `${payload.tool}.${payload.action}` : payload.tool ?? 'unknown' } }));\n  });\n});\nserver.listen(gatewayPort, '127.0.0.1');\nsetInterval(() => {}, 1000);\n"
                .to_string(),
        );
        let attempt_path = runtime.config_path.with_extension("json.startup-attempt");

        service
            .configure_openclaw_gateway(&runtime)
            .expect("configure runtime");
        service
            .start_openclaw_gateway(&paths)
            .expect("gateway should recover from the first cold-start exit");

        assert_eq!(
            fs::read_to_string(&attempt_path).expect("startup attempt marker"),
            "2"
        );

        let running = service.snapshot().expect("running snapshot");
        let openclaw = running
            .services
            .into_iter()
            .find(|managed_service| managed_service.id == SERVICE_ID_OPENCLAW_GATEWAY)
            .expect("openclaw service");
        assert_eq!(
            openclaw.lifecycle,
            ManagedServiceLifecycle::Running,
            "openclaw gateway should be running after retry, snapshot: {openclaw:?}"
        );
        assert!(openclaw.pid.is_some());

        service.begin_shutdown().expect("shutdown");
    }

    #[test]
    fn supervisor_refreshes_gateway_port_before_retrying_after_startup_process_exit() {
        let service = SupervisorService::new();
        let root = tempfile::tempdir().expect("temp dir");
        let paths = resolve_paths_for_root(root.path()).expect("paths");
        let runtime = fake_gateway_runtime_with_script(
            &paths,
            "import fs from 'node:fs';\nimport http from 'node:http';\nconst args = process.argv.slice(2);\nconst configPath = process.env.OPENCLAW_CONFIG_PATH;\nconst attemptPath = `${configPath}.startup-attempt`;\nconst config = JSON.parse(fs.readFileSync(configPath, 'utf8'));\nconst gatewayPort = Number(config.gateway?.port ?? 21280);\nif (args[0] === 'gateway' && args[1] === 'health') {\n  process.stdout.write(JSON.stringify({ ok: true, result: { status: 'ok' } }));\n  process.exit(0);\n}\nconst attempt = (fs.existsSync(attemptPath) ? Number(fs.readFileSync(attemptPath, 'utf8')) : 0) + 1;\nfs.writeFileSync(attemptPath, String(attempt));\nif (attempt === 1) {\n  setTimeout(() => process.exit(1), 500);\n} else {\n  const server = http.createServer((req, res) => {\n    if (req.url === '/health' || req.url === '/healthz') {\n      res.writeHead(200, { 'content-type': 'application/json' });\n      res.end(JSON.stringify({ ok: true, status: 'live' }));\n      return;\n    }\n    if (req.url === '/ready' || req.url === '/readyz') {\n      res.writeHead(200, { 'content-type': 'application/json' });\n      res.end(JSON.stringify({ ready: true, failing: [], uptimeMs: 1 }));\n      return;\n    }\n    res.writeHead(404, { 'content-type': 'application/json' });\n    res.end(JSON.stringify({ ok: false, error: { message: 'unexpected path' } }));\n  });\n  server.listen(gatewayPort, '127.0.0.1');\n  setInterval(() => {}, 1000);\n}\n"
                .to_string(),
        );
        let first_port = runtime.gateway_port;
        let attempt_path = runtime.config_path.with_extension("json.startup-attempt");
        let stop_port_blocker = Arc::new(AtomicBool::new(false));
        let stop_port_blocker_for_thread = stop_port_blocker.clone();
        let attempt_path_for_thread = attempt_path.clone();
        let port_blocker = thread::spawn(move || {
            while !attempt_path_for_thread.exists()
                && !stop_port_blocker_for_thread.load(Ordering::SeqCst)
            {
                thread::sleep(Duration::from_millis(10));
            }
            let listener =
                TcpListener::bind(("127.0.0.1", first_port)).expect("occupy first gateway port");
            while !stop_port_blocker_for_thread.load(Ordering::SeqCst) {
                thread::sleep(Duration::from_millis(10));
            }
            drop(listener);
        });

        service
            .configure_openclaw_gateway(&runtime)
            .expect("configure runtime");
        let start_result = service.start_openclaw_gateway(&paths);
        stop_port_blocker.store(true, Ordering::SeqCst);
        port_blocker.join().expect("port blocker thread");

        start_result.expect("gateway retry should refresh away from a newly occupied port");
        let refreshed_runtime = service
            .configured_openclaw_runtime()
            .expect("configured runtime")
            .expect("runtime");
        assert_ne!(refreshed_runtime.gateway_port, first_port);

        service.begin_shutdown().expect("shutdown");
    }

    #[test]
    fn wait_for_gateway_ready_rejects_tools_invoke_without_current_http_readiness() {
        let root = tempfile::tempdir().expect("temp dir");
        let paths = resolve_paths_for_root(root.path()).expect("paths");
        let runtime = fake_gateway_runtime_with_script(
            &paths,
            "import fs from 'node:fs';\nimport http from 'node:http';\nconst configPath = process.env.OPENCLAW_CONFIG_PATH;\nconst config = JSON.parse(fs.readFileSync(configPath, 'utf8'));\nconst gatewayPort = Number(config.gateway?.port ?? 21280);\nconst expectedAuthorization = `Bearer ${process.env.OPENCLAW_GATEWAY_TOKEN ?? ''}`;\nconst server = http.createServer((req, res) => {\n  if (req.url !== '/tools/invoke' || req.method !== 'POST') {\n    res.writeHead(404, { 'content-type': 'application/json' });\n    res.end(JSON.stringify({ ok: false, error: { message: 'unexpected path' } }));\n    return;\n  }\n  if ((req.headers.authorization ?? '') !== expectedAuthorization) {\n    res.writeHead(401, { 'content-type': 'application/json' });\n    res.end(JSON.stringify({ ok: false, error: { message: 'unauthorized' } }));\n    return;\n  }\n  let body = '';\n  req.setEncoding('utf8');\n  req.on('data', (chunk) => { body += chunk; });\n  req.on('end', () => {\n    const payload = body.trim() ? JSON.parse(body) : {};\n    if (payload.tool !== 'cron' || payload.action !== 'status') {\n      res.writeHead(404, { 'content-type': 'application/json' });\n      res.end(JSON.stringify({ ok: false, error: { message: `unexpected method ${payload.tool ?? 'missing'}.${payload.action ?? 'missing'}` } }));\n      return;\n    }\n    res.writeHead(200, { 'content-type': 'application/json' });\n    res.end(JSON.stringify({ ok: true, result: { method: `${payload.tool}.${payload.action}` } }));\n  });\n});\nserver.listen(gatewayPort, '127.0.0.1');\nsetInterval(() => {}, 1000);\n"
                .to_string(),
        );

        let mut gateway = Command::new(&runtime.node_path);
        configure_command_for_managed_process(&mut gateway);
        gateway.arg(&runtime.cli_path);
        gateway.arg("gateway");
        gateway.current_dir(&runtime.runtime_dir);
        gateway.envs(runtime.managed_env());
        let mut gateway = gateway.spawn().expect("spawn gateway");

        wait_for_test_loopback_listener(runtime.gateway_port, 5_000);
        let readiness = wait_for_gateway_ready(&mut gateway, &runtime, &paths, 5_000);

        let _ = force_process_shutdown(&mut gateway);
        let _ = gateway.wait();

        let error =
            readiness.expect_err("gateway without /readyz or /healthz should not become ready");
        assert!(
            error
                .to_string()
                .contains("ready probe returned HTTP/1.1 404")
                || error
                    .to_string()
                    .contains("live probe returned HTTP/1.1 404"),
            "unexpected readiness error: {error}"
        );
    }

    #[test]
    fn wait_for_gateway_ready_accepts_readyz_status_before_connection_close() {
        let root = tempfile::tempdir().expect("temp dir");
        let paths = resolve_paths_for_root(root.path()).expect("paths");
        let runtime = fake_gateway_runtime_with_script(
            &paths,
            "import fs from 'node:fs';\nimport http from 'node:http';\nconst configPath = process.env.OPENCLAW_CONFIG_PATH;\nconst config = JSON.parse(fs.readFileSync(configPath, 'utf8'));\nconst gatewayPort = Number(config.gateway?.port ?? 21280);\nconst server = http.createServer((req, res) => {\n  if (req.url !== '/readyz') {\n    res.writeHead(404, { 'content-type': 'application/json' });\n    res.end(JSON.stringify({ ok: false, error: { message: 'unexpected path' } }));\n    return;\n  }\n  const responseBody = JSON.stringify({ ready: true, failing: [], uptimeMs: 600 });\n  res.writeHead(200, { 'content-type': 'application/json' });\n  res.flushHeaders();\n  res.write(responseBody.slice(0, 20));\n  setTimeout(() => {\n    res.end(responseBody.slice(20));\n  }, 600);\n});\nserver.listen(gatewayPort, '127.0.0.1');\nsetInterval(() => {}, 1000);\n"
                .to_string(),
        );

        let mut gateway = Command::new(&runtime.node_path);
        configure_command_for_managed_process(&mut gateway);
        gateway.arg(&runtime.cli_path);
        gateway.arg("gateway");
        gateway.current_dir(&runtime.runtime_dir);
        gateway.envs(runtime.managed_env());
        let mut gateway = gateway.spawn().expect("spawn gateway");

        wait_for_test_loopback_listener(runtime.gateway_port, 5_000);
        let readiness = wait_for_gateway_ready(&mut gateway, &runtime, &paths, 5_000);

        let _ = force_process_shutdown(&mut gateway);
        let _ = gateway.wait();

        readiness.expect(
            "gateway should become ready once /readyz returns HTTP 200 even before the connection closes",
        );
    }

    #[test]
    fn wait_for_gateway_ready_accepts_successful_empty_readyz_response() {
        let root = tempfile::tempdir().expect("temp dir");
        let paths = resolve_paths_for_root(root.path()).expect("paths");
        let runtime = fake_gateway_runtime_with_script(
            &paths,
            "import fs from 'node:fs';\nimport http from 'node:http';\nconst configPath = process.env.OPENCLAW_CONFIG_PATH;\nconst config = JSON.parse(fs.readFileSync(configPath, 'utf8'));\nconst gatewayPort = Number(config.gateway?.port ?? 21280);\nconst server = http.createServer((req, res) => {\n  if (req.url !== '/readyz') {\n    res.writeHead(404, { 'content-type': 'application/json' });\n    res.end(JSON.stringify({ ok: false, error: { message: 'unexpected path' } }));\n    return;\n  }\n  res.writeHead(204);\n  res.end();\n});\nserver.listen(gatewayPort, '127.0.0.1');\nsetInterval(() => {}, 1000);\n"
                .to_string(),
        );

        let mut gateway = Command::new(&runtime.node_path);
        configure_command_for_managed_process(&mut gateway);
        gateway.arg(&runtime.cli_path);
        gateway.arg("gateway");
        gateway.current_dir(&runtime.runtime_dir);
        gateway.envs(runtime.managed_env());
        let mut gateway = gateway.spawn().expect("spawn gateway");

        wait_for_test_loopback_listener(runtime.gateway_port, 5_000);
        let readiness = wait_for_gateway_ready(&mut gateway, &runtime, &paths, 1_500);

        let _ = force_process_shutdown(&mut gateway);
        let _ = gateway.wait();

        readiness
            .expect("gateway should become ready once /readyz returns any successful 2xx status");
    }

    #[test]
    fn wait_for_gateway_ready_rejects_ready_probe_from_unrelated_listener_after_child_exits() {
        let root = tempfile::tempdir().expect("temp dir");
        let paths = resolve_paths_for_root(root.path()).expect("paths");
        let mut runtime = fake_gateway_runtime_with_script(
            &paths,
            "process.stderr.write('gateway bind failed');\nsetTimeout(() => process.exit(1), 250);\n"
                .to_string(),
        );
        let unrelated_ready_server = TestReadyHttpServer::spawn();
        runtime.gateway_port = unrelated_ready_server.port;

        let mut gateway = Command::new(&runtime.node_path);
        configure_command_for_managed_process(&mut gateway);
        gateway.arg(&runtime.cli_path);
        gateway.arg("gateway");
        gateway.current_dir(&runtime.runtime_dir);
        gateway.envs(runtime.managed_env());
        let mut gateway = gateway.spawn().expect("spawn failing gateway");

        let readiness = wait_for_gateway_ready(&mut gateway, &runtime, &paths, 5_000);

        let _ = force_process_shutdown(&mut gateway);
        let _ = gateway.wait();

        let error = readiness
            .expect_err("gateway readiness from an unrelated listener must not mask child exit");
        assert!(
            error.to_string().contains("exited before becoming ready"),
            "unexpected readiness error: {error}"
        );
    }

    #[test]
    fn wait_for_gateway_ready_rejects_cli_health_without_current_http_readiness() {
        let root = tempfile::tempdir().expect("temp dir");
        let paths = resolve_paths_for_root(root.path()).expect("paths");
        let runtime = fake_gateway_runtime_with_script(
            &paths,
            "import fs from 'node:fs';\nimport http from 'node:http';\nconst args = process.argv.slice(2);\nconst configPath = process.env.OPENCLAW_CONFIG_PATH;\nconst config = JSON.parse(fs.readFileSync(configPath, 'utf8'));\nconst gatewayPort = Number(config.gateway?.port ?? 21280);\nconst readyPath = `${configPath}.health-ready`;\nif (args[0] === 'gateway' && args[1] === 'health') {\n  if (fs.existsSync(readyPath)) {\n    process.stdout.write(JSON.stringify({ ok: true, result: { status: 'ok' } }));\n    process.exit(0);\n  }\n  process.stderr.write('gateway warming');\n  process.exit(1);\n}\nif (args[0] !== 'gateway') {\n  process.stderr.write(`unexpected args: ${args.join(' ')}`);\n  process.exit(1);\n}\nconst server = http.createServer((req, res) => {\n  res.writeHead(404, { 'content-type': 'application/json' });\n  res.end(JSON.stringify({ ok: false, error: { message: 'tools invoke unavailable during startup' } }));\n});\nserver.listen(gatewayPort, '127.0.0.1', () => {\n  setTimeout(() => {\n    fs.writeFileSync(readyPath, 'ok');\n  }, 700);\n});\nsetInterval(() => {}, 1000);\n"
                .to_string(),
        );

        let mut gateway = Command::new(&runtime.node_path);
        configure_command_for_managed_process(&mut gateway);
        gateway.arg(&runtime.cli_path);
        gateway.arg("gateway");
        gateway.current_dir(&runtime.runtime_dir);
        gateway.envs(runtime.managed_env());
        let mut gateway = gateway.spawn().expect("spawn gateway");

        wait_for_test_loopback_listener(runtime.gateway_port, 5_000);
        let readiness = wait_for_gateway_ready(&mut gateway, &runtime, &paths, 5_000);

        let _ = force_process_shutdown(&mut gateway);
        let _ = gateway.wait();

        let error =
            readiness.expect_err("gateway without /readyz or /healthz should not become ready");
        assert!(
            error
                .to_string()
                .contains("ready probe returned HTTP/1.1 404")
                || error
                    .to_string()
                    .contains("live probe returned HTTP/1.1 404"),
            "unexpected readiness error: {error}"
        );
    }

    #[test]
    fn wait_for_gateway_ready_accepts_http_healthz_when_readyz_is_unavailable() {
        let root = tempfile::tempdir().expect("temp dir");
        let paths = resolve_paths_for_root(root.path()).expect("paths");
        let runtime = fake_gateway_runtime_with_script(
            &paths,
            "import fs from 'node:fs';\nimport http from 'node:http';\nconst args = process.argv.slice(2);\nconst configPath = process.env.OPENCLAW_CONFIG_PATH;\nconst config = JSON.parse(fs.readFileSync(configPath, 'utf8'));\nconst gatewayPort = Number(config.gateway?.port ?? 21280);\nif (args[0] === 'gateway' && args[1] === 'health') {\n  process.stderr.write('cli health unavailable while transport is warming');\n  process.exit(1);\n}\nif (args[0] !== 'gateway') {\n  process.stderr.write(`unexpected args: ${args.join(' ')}`);\n  process.exit(1);\n}\nconst server = http.createServer((req, res) => {\n  if (req.url === '/health' || req.url === '/healthz') {\n    res.writeHead(200, { 'content-type': 'application/json' });\n    res.end(JSON.stringify({ ok: true, status: 'live' }));\n    return;\n  }\n  res.writeHead(404, { 'content-type': 'application/json' });\n  res.end(JSON.stringify({ ok: false, error: { message: 'startup endpoint unavailable' } }));\n});\nserver.listen(gatewayPort, '127.0.0.1');\nsetInterval(() => {}, 1000);\n"
                .to_string(),
        );

        let mut gateway = Command::new(&runtime.node_path);
        configure_command_for_managed_process(&mut gateway);
        gateway.arg(&runtime.cli_path);
        gateway.arg("gateway");
        gateway.current_dir(&runtime.runtime_dir);
        gateway.envs(runtime.managed_env());
        let mut gateway = gateway.spawn().expect("spawn gateway");

        wait_for_test_loopback_listener(runtime.gateway_port, 5_000);
        let readiness = wait_for_gateway_ready(&mut gateway, &runtime, &paths, 1_500);

        let _ = force_process_shutdown(&mut gateway);
        let _ = gateway.wait();

        readiness.expect(
            "gateway startup should accept lightweight /healthz liveness when /readyz is unavailable",
        );
    }

    #[test]
    fn wait_for_gateway_ready_accepts_http_healthz_when_readyz_reports_degraded() {
        let root = tempfile::tempdir().expect("temp dir");
        let paths = resolve_paths_for_root(root.path()).expect("paths");
        let runtime = fake_gateway_runtime_with_script(
            &paths,
            "import fs from 'node:fs';\nimport http from 'node:http';\nconst args = process.argv.slice(2);\nconst configPath = process.env.OPENCLAW_CONFIG_PATH;\nconst config = JSON.parse(fs.readFileSync(configPath, 'utf8'));\nconst gatewayPort = Number(config.gateway?.port ?? 21280);\nif (args[0] === 'gateway' && args[1] === 'health') {\n  process.stderr.write('cli health unavailable while channels reconnect');\n  process.exit(1);\n}\nif (args[0] !== 'gateway') {\n  process.stderr.write(`unexpected args: ${args.join(' ')}`);\n  process.exit(1);\n}\nconst server = http.createServer((req, res) => {\n  if (req.url === '/health' || req.url === '/healthz') {\n    res.writeHead(200, { 'content-type': 'application/json' });\n    res.end(JSON.stringify({ ok: true, status: 'live' }));\n    return;\n  }\n  if (req.url === '/ready' || req.url === '/readyz') {\n    res.writeHead(503, { 'content-type': 'application/json' });\n    res.end(JSON.stringify({ ready: false, failing: ['channels'], uptimeMs: 1200 }));\n    return;\n  }\n  if (req.url === '/tools/invoke' && req.method === 'POST') {\n    req.on('data', () => {});\n    req.on('end', () => {\n      res.writeHead(503, { 'content-type': 'application/json' });\n      res.end(JSON.stringify({ ok: false, error: { message: 'gateway still reconnecting channels' } }));\n    });\n    return;\n  }\n  res.writeHead(404, { 'content-type': 'application/json' });\n  res.end(JSON.stringify({ ok: false, error: { message: 'unexpected path' } }));\n});\nserver.listen(gatewayPort, '127.0.0.1');\nsetInterval(() => {}, 1000);\n"
                .to_string(),
        );

        let mut gateway = Command::new(&runtime.node_path);
        configure_command_for_managed_process(&mut gateway);
        gateway.arg(&runtime.cli_path);
        gateway.arg("gateway");
        gateway.current_dir(&runtime.runtime_dir);
        gateway.envs(runtime.managed_env());
        let mut gateway = gateway.spawn().expect("spawn gateway");

        wait_for_test_loopback_listener(runtime.gateway_port, 5_000);
        let readiness = wait_for_gateway_ready(&mut gateway, &runtime, &paths, 1_500);

        let _ = force_process_shutdown(&mut gateway);
        let _ = gateway.wait();

        readiness.expect(
            "gateway startup should keep probing /healthz when /readyz reports temporary degraded status",
        );
    }

    #[test]
    fn wait_for_gateway_ready_retries_readyz_without_blocking_on_nonstandard_probes() {
        let root = tempfile::tempdir().expect("temp dir");
        let paths = resolve_paths_for_root(root.path()).expect("paths");
        let runtime = fake_gateway_runtime_with_script(
            &paths,
            "import fs from 'node:fs';\nimport http from 'node:http';\nconst args = process.argv.slice(2);\nconst configPath = process.env.OPENCLAW_CONFIG_PATH;\nconst config = JSON.parse(fs.readFileSync(configPath, 'utf8'));\nconst gatewayPort = Number(config.gateway?.port ?? 21280);\nconst readyPath = `${configPath}.readyz-ready`;\nif (args[0] === 'gateway' && args[1] === 'health') {\n  setTimeout(() => {\n    process.stderr.write('health transport still warming');\n    process.exit(1);\n  }, 4_000);\n} else {\n  const server = http.createServer((req, res) => {\n    if (req.url === '/ready' || req.url === '/readyz') {\n      if (!fs.existsSync(readyPath)) {\n        res.writeHead(503, { 'content-type': 'application/json' });\n        res.end(JSON.stringify({ ready: false, failing: ['startup'], uptimeMs: 0 }));\n        return;\n      }\n      res.writeHead(200, { 'content-type': 'application/json' });\n      res.end(JSON.stringify({ ready: true, failing: [], uptimeMs: 700 }));\n      return;\n    }\n    if (req.url === '/tools/invoke' && req.method === 'POST') {\n      req.on('data', () => {});\n      req.on('end', () => {});\n      return;\n    }\n    res.writeHead(404, { 'content-type': 'application/json' });\n    res.end(JSON.stringify({ ok: false, error: { message: 'unexpected path' } }));\n  });\n  server.listen(gatewayPort, '127.0.0.1', () => {\n    setTimeout(() => {\n      fs.writeFileSync(readyPath, 'ok');\n    }, 700);\n  });\n  setInterval(() => {}, 1000);\n}\n"
                .to_string(),
        );

        let mut gateway = Command::new(&runtime.node_path);
        configure_command_for_managed_process(&mut gateway);
        gateway.arg(&runtime.cli_path);
        gateway.arg("gateway");
        gateway.current_dir(&runtime.runtime_dir);
        gateway.envs(runtime.managed_env());
        let mut gateway = gateway.spawn().expect("spawn gateway");

        wait_for_test_loopback_listener(runtime.gateway_port, 5_000);
        let readiness = wait_for_gateway_ready(&mut gateway, &runtime, &paths, 5_000);

        let _ = force_process_shutdown(&mut gateway);
        let _ = gateway.wait();

        readiness.expect(
            "gateway should become ready once /readyz returns HTTP 200 without waiting on nonstandard probes",
        );
    }

    #[test]
    fn wait_for_gateway_ready_accepts_slow_readyz_responses_during_cold_start() {
        let root = tempfile::tempdir().expect("temp dir");
        let paths = resolve_paths_for_root(root.path()).expect("paths");
        let runtime = fake_gateway_runtime_with_script(
            &paths,
            "import fs from 'node:fs';\nimport http from 'node:http';\nconst args = process.argv.slice(2);\nconst configPath = process.env.OPENCLAW_CONFIG_PATH;\nconst config = JSON.parse(fs.readFileSync(configPath, 'utf8'));\nconst gatewayPort = Number(config.gateway?.port ?? 21280);\nif (args[0] === 'gateway' && args[1] === 'health') {\n  setTimeout(() => {\n    process.stdout.write(JSON.stringify({ ok: true, result: { status: 'ok' } }));\n    process.exit(0);\n  }, 1_200);\n} else {\n  const server = http.createServer((req, res) => {\n    if (req.url === '/ready' || req.url === '/readyz') {\n      setTimeout(() => {\n        res.writeHead(200, { 'content-type': 'application/json' });\n        res.end(JSON.stringify({ ready: true, failing: [], uptimeMs: 1_200 }));\n      }, 1_200);\n      return;\n    }\n    if (req.url === '/tools/invoke' && req.method === 'POST') {\n      req.on('data', () => {});\n      req.on('end', () => {\n        setTimeout(() => {\n          res.writeHead(200, { 'content-type': 'application/json' });\n          res.end(JSON.stringify({ ok: true, result: { method: 'cron.status' } }));\n        }, 1_200);\n      });\n      return;\n    }\n    res.writeHead(404, { 'content-type': 'application/json' });\n    res.end(JSON.stringify({ ok: false, error: { message: 'unexpected path' } }));\n  });\n  server.listen(gatewayPort, '127.0.0.1');\n  setInterval(() => {}, 1000);\n}\n"
                .to_string(),
        );

        let mut gateway = Command::new(&runtime.node_path);
        configure_command_for_managed_process(&mut gateway);
        gateway.arg(&runtime.cli_path);
        gateway.arg("gateway");
        gateway.current_dir(&runtime.runtime_dir);
        gateway.envs(runtime.managed_env());
        let mut gateway = gateway.spawn().expect("spawn gateway");

        wait_for_test_loopback_listener(runtime.gateway_port, 5_000);
        let readiness = wait_for_gateway_ready(&mut gateway, &runtime, &paths, 5_000);

        let _ = force_process_shutdown(&mut gateway);
        let _ = gateway.wait();

        readiness.expect(
            "gateway should become ready even when cold-start readyz responses take around 1.2s",
        );
    }

    #[test]
    fn gateway_health_probe_uses_environment_config_without_cli_config_flag() {
        let root = tempfile::tempdir().expect("temp dir");
        let paths = resolve_paths_for_root(root.path()).expect("paths");
        let runtime = fake_gateway_runtime_with_script(
            &paths,
            "import fs from 'node:fs';\nimport http from 'node:http';\nconst args = process.argv.slice(2);\nconst configPath = process.env.OPENCLAW_CONFIG_PATH;\nconst config = JSON.parse(fs.readFileSync(configPath, 'utf8'));\nconst gatewayPort = Number(config.gateway?.port ?? 21280);\nif (args[0] === 'gateway' && args[1] === 'health') {\n  if (args.includes('--config')) {\n    process.stderr.write('unexpected --config');\n    process.exit(1);\n  }\n  process.stdout.write(JSON.stringify({ ok: true, result: { status: 'ok' } }));\n  process.exit(0);\n}\nif (args[0] !== 'gateway') {\n  process.stderr.write(`unexpected args: ${args.join(' ')}`);\n  process.exit(1);\n}\nconst server = http.createServer((_req, res) => {\n  res.writeHead(404, { 'content-type': 'application/json' });\n  res.end(JSON.stringify({ ok: false, error: { message: 'tools invoke unavailable during startup' } }));\n});\nserver.listen(gatewayPort, '127.0.0.1');\nsetInterval(() => {}, 1000);\n"
                .to_string(),
        );

        let mut gateway = Command::new(&runtime.node_path);
        configure_command_for_managed_process(&mut gateway);
        gateway.arg(&runtime.cli_path);
        gateway.arg("gateway");
        gateway.current_dir(&runtime.runtime_dir);
        gateway.envs(runtime.managed_env());
        let mut gateway = gateway.spawn().expect("spawn gateway");

        wait_for_test_loopback_listener(runtime.gateway_port, 5_000);
        let readiness = super::probe_gateway_cli_health_ready(&runtime, &paths, 1_500);

        let _ = force_process_shutdown(&mut gateway);
        let _ = gateway.wait();

        assert!(
            readiness.is_ready(),
            "health probe should rely on OPENCLAW_CONFIG_PATH instead of passing an unsupported --config flag: {}",
            readiness.detail()
        );
    }

    #[test]
    fn supervisor_marks_the_openclaw_gateway_unhealthy_when_the_loopback_listener_disappears() {
        let service = SupervisorService::new();
        let root = tempfile::tempdir().expect("temp dir");
        let paths = resolve_paths_for_root(root.path()).expect("paths");
        let runtime = fake_gateway_runtime_with_script(
            &paths,
            "import fs from 'node:fs';\nimport http from 'node:http';\nconst configPath = process.env.OPENCLAW_CONFIG_PATH;\nconst config = JSON.parse(fs.readFileSync(configPath, 'utf8'));\nconst gatewayPort = Number(config.gateway?.port ?? 21280);\nconst server = http.createServer((req, res) => {\n  if (req.url === '/readyz') {\n    res.writeHead(200, { 'content-type': 'application/json' });\n    res.end(JSON.stringify({ ready: true, failing: [], uptimeMs: 1 }));\n    return;\n  }\n  if (req.url === '/healthz') {\n    res.writeHead(200, { 'content-type': 'application/json' });\n    res.end(JSON.stringify({ ok: true, status: 'live' }));\n    return;\n  }\n  res.writeHead(404, { 'content-type': 'application/json' });\n  res.end(JSON.stringify({ ok: false, error: { message: 'unexpected path' } }));\n});\nserver.listen(gatewayPort, '127.0.0.1', () => {\n  setTimeout(() => {\n    server.close(() => {});\n  }, 300);\n});\nsetInterval(() => {}, 1000);\n"
                .to_string(),
        );

        service
            .configure_openclaw_gateway(&runtime)
            .expect("configure runtime");
        service
            .start_openclaw_gateway(&paths)
            .expect("start gateway");

        thread::sleep(Duration::from_millis(700));

        assert!(
            !service
                .is_openclaw_gateway_running()
                .expect("gateway running state"),
            "gateway should no longer be reported as running after its loopback listener disappears"
        );

        let snapshot = service.snapshot().expect("snapshot");
        let openclaw = snapshot
            .services
            .into_iter()
            .find(|managed_service| managed_service.id == SERVICE_ID_OPENCLAW_GATEWAY)
            .expect("openclaw service");
        assert_eq!(openclaw.lifecycle, ManagedServiceLifecycle::Failed);
        assert!(openclaw
            .last_error
            .as_deref()
            .unwrap_or_default()
            .contains("not ready"));

        service.begin_shutdown().expect("shutdown");
    }

    #[test]
    fn supervisor_keeps_running_gateway_healthy_when_only_readiness_temporarily_drops() {
        let service = SupervisorService::new();
        let root = tempfile::tempdir().expect("temp dir");
        let paths = resolve_paths_for_root(root.path()).expect("paths");
        let runtime = fake_gateway_runtime_with_script(
            &paths,
            "import fs from 'node:fs';\nimport http from 'node:http';\nconst args = process.argv.slice(2);\nconst configPath = process.env.OPENCLAW_CONFIG_PATH;\nconst config = JSON.parse(fs.readFileSync(configPath, 'utf8'));\nconst gatewayPort = Number(config.gateway?.port ?? 21280);\nconst degradeAt = Date.now() + 500;\nif (args[0] === 'gateway' && args[1] === 'health') {\n  process.stderr.write('readiness degraded while channels reconnect');\n  process.exit(1);\n}\nconst server = http.createServer((req, res) => {\n  if (req.url === '/health' || req.url === '/healthz') {\n    res.writeHead(200, { 'content-type': 'application/json' });\n    res.end(JSON.stringify({ ok: true, status: 'live' }));\n    return;\n  }\n  if (req.url === '/ready' || req.url === '/readyz') {\n    if (Date.now() >= degradeAt) {\n      res.writeHead(503, { 'content-type': 'application/json' });\n      res.end(JSON.stringify({ ready: false, failing: ['channels'], uptimeMs: 1200 }));\n      return;\n    }\n    res.writeHead(200, { 'content-type': 'application/json' });\n    res.end(JSON.stringify({ ready: true, failing: [], uptimeMs: 300 }));\n    return;\n  }\n  if (req.url === '/tools/invoke' && req.method === 'POST') {\n    req.on('data', () => {});\n    req.on('end', () => {\n      res.writeHead(503, { 'content-type': 'application/json' });\n      res.end(JSON.stringify({ ok: false, error: { message: 'gateway still reconnecting channels' } }));\n    });\n    return;\n  }\n  res.writeHead(404, { 'content-type': 'application/json' });\n  res.end(JSON.stringify({ ok: false, error: { message: 'unexpected path' } }));\n});\nserver.listen(gatewayPort, '127.0.0.1');\nsetInterval(() => {}, 1000);\n"
                .to_string(),
        );

        service
            .configure_openclaw_gateway(&runtime)
            .expect("configure runtime");
        service
            .start_openclaw_gateway(&paths)
            .expect("start gateway");

        thread::sleep(Duration::from_millis(700));

        assert!(
            service
                .is_openclaw_gateway_running()
                .expect("gateway running state"),
            "gateway should stay running while shallow liveness remains healthy even if /readyz temporarily reports not ready"
        );

        let snapshot = service.snapshot().expect("snapshot");
        let openclaw = snapshot
            .services
            .into_iter()
            .find(|managed_service| managed_service.id == SERVICE_ID_OPENCLAW_GATEWAY)
            .expect("openclaw service");
        assert_eq!(openclaw.lifecycle, ManagedServiceLifecycle::Running);
        assert_eq!(openclaw.last_error, None);

        service.begin_shutdown().expect("shutdown");
    }

    #[test]
    fn running_gateway_health_probe_returns_quickly_when_the_listener_accepts_without_responding() {
        let root = tempfile::tempdir().expect("temp dir");
        let paths = resolve_paths_for_root(root.path()).expect("paths");
        let listener = TcpListener::bind(("127.0.0.1", 0)).expect("blackhole listener");
        listener
            .set_nonblocking(true)
            .expect("blackhole listener nonblocking");
        let gateway_port = listener.local_addr().expect("blackhole addr").port();
        let stop_listener = Arc::new(AtomicBool::new(false));
        let stop_listener_for_thread = stop_listener.clone();
        let accept_thread = thread::spawn(move || {
            let mut held_connections = Vec::new();
            while !stop_listener_for_thread.load(Ordering::SeqCst) {
                match listener.accept() {
                    Ok((stream, _addr)) => held_connections.push(stream),
                    Err(error) if error.kind() == std::io::ErrorKind::WouldBlock => {
                        thread::sleep(Duration::from_millis(10));
                    }
                    Err(_error) => break,
                }
            }
        });
        let mut runtime = fake_gateway_runtime(&paths);
        runtime.gateway_port = gateway_port;

        let started_at = Instant::now();
        let health = super::probe_running_gateway_health(&runtime, None);
        let elapsed = started_at.elapsed();

        stop_listener.store(true, Ordering::SeqCst);
        accept_thread
            .join()
            .expect("blackhole listener thread should join");

        assert!(
            !health.is_ready(),
            "blackhole listener should not be considered healthy"
        );
        assert!(
            elapsed < Duration::from_millis(2_500),
            "runtime health checks are on the startup status path and must not wait for long HTTP read timeouts; elapsed={elapsed:?}, health={health:?}"
        );
    }

    #[test]
    fn supervisor_reclaims_stale_openclaw_gateway_before_refreshing_the_managed_port() {
        let service = SupervisorService::new();
        let root = tempfile::tempdir().expect("temp dir");
        let paths = resolve_paths_for_root(root.path()).expect("paths");
        let mut runtime = fake_gateway_runtime(&paths);
        let gateway_port = reserve_test_loopback_port();
        runtime.gateway_port = gateway_port;
        fs::write(
            &openclaw_config_file_path(&paths),
            format!("{{\n  \"gateway\": {{\n    \"port\": {gateway_port}\n  }}\n}}\n"),
        )
        .expect("config file");

        let mut stale_gateway = Command::new(&runtime.node_path);
        configure_command_for_managed_process(&mut stale_gateway);
        stale_gateway.arg(&runtime.cli_path);
        stale_gateway.arg("gateway");
        stale_gateway.current_dir(&runtime.runtime_dir);
        stale_gateway.envs(runtime.managed_env());
        let mut stale_gateway = stale_gateway.spawn().expect("spawn stale gateway");
        #[cfg(windows)]
        let stale_gateway_pid = stale_gateway.id();
        wait_for_gateway_ready(&mut stale_gateway, &runtime, &paths, 5_000)
            .expect("stale gateway should become ready");
        #[cfg(windows)]
        drop(stale_gateway);

        service
            .configure_openclaw_gateway(&runtime)
            .expect("configure runtime");
        service
            .start_openclaw_gateway(&paths)
            .expect("start gateway after reclaiming stale process");

        let refreshed = service
            .configured_openclaw_runtime()
            .expect("configured runtime")
            .expect("runtime");
        assert_eq!(refreshed.gateway_port, gateway_port);

        service.begin_shutdown().expect("shutdown");
        #[cfg(windows)]
        let _ = terminate_process_id(stale_gateway_pid);
        #[cfg(not(windows))]
        {
            let _ = force_process_shutdown(&mut stale_gateway);
            let _ = stale_gateway.wait();
        }
    }

    #[cfg(windows)]
    #[test]
    fn managed_process_creation_flags_hide_console_windows() {
        assert_eq!(
            managed_process_creation_flags(),
            CREATE_NEW_PROCESS_GROUP | CREATE_NO_WINDOW
        );
    }

    #[cfg(windows)]
    fn fake_gateway_runtime(paths: &crate::framework::paths::AppPaths) -> ActivatedOpenClawRuntime {
        fake_gateway_runtime_with_delay_ms(paths, 0)
    }

    #[cfg(windows)]
    fn fake_gateway_runtime_with_http_ready_delay_ms(
        paths: &crate::framework::paths::AppPaths,
        listen_delay_ms: u64,
        ready_delay_ms: u64,
    ) -> ActivatedOpenClawRuntime {
        fake_gateway_runtime_with_script(
            paths,
            fake_gateway_runtime_http_ready_script(listen_delay_ms, ready_delay_ms),
        )
    }

    #[cfg(windows)]
    fn fake_gateway_runtime_with_delay_ms(
        paths: &crate::framework::paths::AppPaths,
        listen_delay_ms: u64,
    ) -> ActivatedOpenClawRuntime {
        fake_gateway_runtime_with_http_ready_delay_ms(paths, listen_delay_ms, 0)
    }

    #[cfg(not(windows))]
    fn fake_gateway_runtime(paths: &crate::framework::paths::AppPaths) -> ActivatedOpenClawRuntime {
        fake_gateway_runtime_with_delay_ms(paths, 0)
    }

    #[cfg(not(windows))]
    fn fake_gateway_runtime_with_http_ready_delay_ms(
        paths: &crate::framework::paths::AppPaths,
        listen_delay_ms: u64,
        ready_delay_ms: u64,
    ) -> ActivatedOpenClawRuntime {
        fake_gateway_runtime_with_script(
            paths,
            fake_gateway_runtime_http_ready_script(listen_delay_ms, ready_delay_ms),
        )
    }

    #[cfg(not(windows))]
    fn fake_gateway_runtime_with_delay_ms(
        paths: &crate::framework::paths::AppPaths,
        listen_delay_ms: u64,
    ) -> ActivatedOpenClawRuntime {
        fake_gateway_runtime_with_http_ready_delay_ms(paths, listen_delay_ms, 0)
    }

    fn fake_gateway_runtime_http_ready_script(listen_delay_ms: u64, ready_delay_ms: u64) -> String {
        format!(
            "import fs from 'node:fs';\nimport http from 'node:http';\nconst args = process.argv.slice(2);\nconst configPath = process.env.OPENCLAW_CONFIG_PATH;\nconst config = JSON.parse(fs.readFileSync(configPath, 'utf8'));\nconst gatewayPort = Number(config.gateway?.port ?? 21280);\nconst expectedAuthorization = `Bearer ${{process.env.OPENCLAW_GATEWAY_TOKEN ?? ''}}`;\nconst readyAt = Date.now() + {ready_delay_ms};\nif (args[0] === 'gateway' && args[1] === 'health') {{\n  if (Date.now() < readyAt) {{\n    process.stderr.write('gateway warming');\n    process.exit(1);\n  }}\n  process.stdout.write(JSON.stringify({{ ok: true, result: {{ status: 'ok' }} }}));\n  process.exit(0);\n}}\nif (args[0] !== 'gateway') {{\n  process.stderr.write(`unexpected args: ${{args.join(' ')}}`);\n  process.exit(1);\n}}\nconst server = http.createServer((req, res) => {{\n  if (req.url === '/health' || req.url === '/healthz') {{\n    res.writeHead(200, {{ 'content-type': 'application/json' }});\n    res.end(JSON.stringify({{ ok: true, status: 'live' }}));\n    return;\n  }}\n  if (req.url === '/ready' || req.url === '/readyz') {{\n    if (Date.now() < readyAt) {{\n      res.writeHead(503, {{ 'content-type': 'application/json' }});\n      res.end(JSON.stringify({{ ready: false, failing: ['startup'], uptimeMs: 0 }}));\n      return;\n    }}\n    res.writeHead(200, {{ 'content-type': 'application/json' }});\n    res.end(JSON.stringify({{ ready: true, failing: [], uptimeMs: {ready_delay_ms} }}));\n    return;\n  }}\n  if (req.url !== '/tools/invoke' || req.method !== 'POST') {{\n    res.writeHead(404, {{ 'content-type': 'application/json' }});\n    res.end(JSON.stringify({{ ok: false, error: {{ message: 'unexpected path' }} }}));\n    return;\n  }}\n  if ((req.headers.authorization ?? '') !== expectedAuthorization) {{\n    res.writeHead(401, {{ 'content-type': 'application/json' }});\n    res.end(JSON.stringify({{ ok: false, error: {{ message: 'unauthorized' }} }}));\n    return;\n  }}\n  let body = '';\n  req.setEncoding('utf8');\n  req.on('data', (chunk) => {{ body += chunk; }});\n  req.on('end', () => {{\n    const payload = body.trim() ? JSON.parse(body) : {{}};\n    if (Date.now() < readyAt) {{\n      res.writeHead(503, {{ 'content-type': 'application/json' }});\n      res.end(JSON.stringify({{ ok: false, error: {{ message: 'gateway warming' }} }}));\n      return;\n    }}\n    res.writeHead(200, {{ 'content-type': 'application/json' }});\n    res.end(JSON.stringify({{ ok: true, result: {{ method: payload.action ? `${{payload.tool}}.${{payload.action}}` : payload.tool ?? 'unknown' }} }}));\n  }});\n}});\nconst start = () => server.listen(gatewayPort, '127.0.0.1');\nsetTimeout(start, {listen_delay_ms});\nsetInterval(() => {{}}, 1000);\n"
        )
    }

    fn fake_gateway_runtime_with_script(
        paths: &crate::framework::paths::AppPaths,
        script: String,
    ) -> ActivatedOpenClawRuntime {
        let install_dir = paths.openclaw_runtime_dir.join("test-gateway");
        let runtime_dir = install_dir.join("runtime");
        let node_path = resolve_test_node_executable();
        let cli_path = runtime_dir
            .join("package")
            .join("node_modules")
            .join("openclaw")
            .join("openclaw.mjs");
        let gateway_port = reserve_test_loopback_port();
        let config_path = openclaw_config_file_path(paths);

        fs::create_dir_all(cli_path.parent().expect("cli parent")).expect("cli dir");
        write_test_openclaw_channel_metadata(&runtime_dir);
        fs::write(
            &config_path,
            format!("{{\n  \"gateway\": {{\n    \"port\": {gateway_port}\n  }}\n}}\n"),
        )
        .expect("config file");
        fs::write(&cli_path, script).expect("cli file");

        ActivatedOpenClawRuntime {
            install_key: "test-gateway".to_string(),
            install_dir,
            runtime_dir,
            node_path,
            cli_path,
            home_dir: paths.user_root.clone(),
            state_dir: paths.openclaw_root_dir.clone(),
            workspace_dir: paths.openclaw_workspace_dir.clone(),
            config_path,
            gateway_port,
            gateway_auth_token: "test-token".to_string(),
        }
    }

    fn openclaw_config_file_path(paths: &crate::framework::paths::AppPaths) -> std::path::PathBuf {
        KernelRuntimeAuthorityService::new()
            .active_config_file_path("openclaw", paths)
            .expect("canonical openclaw config path")
    }

    #[cfg(windows)]
    fn resolve_test_node_executable() -> std::path::PathBuf {
        crate::framework::services::test_support::resolve_test_node_executable(
            "OpenClaw supervisor tests",
        )
    }

    #[cfg(not(windows))]
    fn resolve_test_node_executable() -> std::path::PathBuf {
        crate::framework::services::test_support::resolve_test_node_executable(
            "OpenClaw supervisor tests",
        )
    }

    fn reserve_test_loopback_port() -> u16 {
        let listener =
            TcpListener::bind(("127.0.0.1", 0)).expect("bind loopback listener for test port");
        let port = listener.local_addr().expect("listener addr").port();
        drop(listener);
        port
    }

    fn wait_for_test_loopback_listener(port: u16, timeout_ms: u64) {
        let deadline = Instant::now() + Duration::from_millis(timeout_ms);
        while Instant::now() < deadline {
            if super::is_loopback_port_accepting(port) {
                return;
            }
            thread::sleep(Duration::from_millis(50));
        }

        panic!("test gateway listener did not start on 127.0.0.1:{port} in time");
    }

    struct TestReadyHttpServer {
        port: u16,
        stop: Arc<AtomicBool>,
        thread: Option<thread::JoinHandle<()>>,
    }

    impl TestReadyHttpServer {
        fn spawn() -> Self {
            let listener =
                TcpListener::bind(("127.0.0.1", 0)).expect("bind unrelated ready server");
            listener
                .set_nonblocking(true)
                .expect("unrelated ready server nonblocking");
            let port = listener.local_addr().expect("ready server addr").port();
            let stop = Arc::new(AtomicBool::new(false));
            let stop_for_thread = stop.clone();
            let thread = thread::spawn(move || {
                while !stop_for_thread.load(Ordering::SeqCst) {
                    match listener.accept() {
                        Ok((mut stream, _addr)) => {
                            let mut request = [0_u8; 1024];
                            let _ = stream.read(&mut request);
                            let response = "HTTP/1.1 200 OK\r\ncontent-type: application/json\r\ncontent-length: 49\r\nconnection: close\r\n\r\n{\"ready\":true,\"failing\":[],\"uptimeMs\":999}";
                            let _ = stream.write_all(response.as_bytes());
                            let _ = stream.flush();
                        }
                        Err(error) if error.kind() == std::io::ErrorKind::WouldBlock => {
                            thread::sleep(Duration::from_millis(10));
                        }
                        Err(_error) => break,
                    }
                }
            });

            Self {
                port,
                stop,
                thread: Some(thread),
            }
        }
    }

    impl Drop for TestReadyHttpServer {
        fn drop(&mut self) {
            self.stop.store(true, Ordering::SeqCst);
            let _ = TcpStream::connect(("127.0.0.1", self.port));
            if let Some(thread) = self.thread.take() {
                let _ = thread.join();
            }
        }
    }

    #[test]
    fn configured_gateway_port_prefers_canonical_config_over_stray_sibling_config_when_authority_state_is_missing(
    ) {
        let root = tempfile::tempdir().expect("temp dir");
        let paths = resolve_paths_for_root(root.path()).expect("paths");
        let configured_port = 28_901;
        let stray_port = 18_901;
        let config_file_path = openclaw_config_file_path(&paths);
        let stray_config_path = paths
            .user_root
            .join("stray-openclaw-root")
            .join(".openclaw")
            .join("openclaw.json");

        fs::remove_file(&paths.openclaw_authority_file).expect("remove authority state");

        fs::create_dir_all(
            config_file_path
                .parent()
                .expect("config file parent directory"),
        )
        .expect("config file dir");
        fs::write(
            &config_file_path,
            format!("{{\n  \"gateway\": {{\n    \"port\": {configured_port}\n  }}\n}}\n"),
        )
        .expect("config file");
        fs::create_dir_all(stray_config_path.parent().expect("stray config parent"))
            .expect("stray config dir");
        fs::write(
            &stray_config_path,
            format!("{{\n  \"gateway\": {{\n    \"port\": {stray_port}\n  }}\n}}\n"),
        )
        .expect("stray config");

        assert_eq!(
            configured_openclaw_gateway_port(&paths),
            Some(configured_port)
        );
    }

    #[test]
    fn configured_gateway_port_ignores_stray_sibling_config_before_canonical_config_exists() {
        let root = tempfile::tempdir().expect("temp dir");
        let paths = resolve_paths_for_root(root.path()).expect("paths");
        let stray_config_path = paths
            .user_root
            .join("stray-openclaw-root")
            .join(".openclaw")
            .join("openclaw.json");

        fs::remove_file(&paths.openclaw_authority_file).expect("remove authority state");

        fs::create_dir_all(stray_config_path.parent().expect("stray config parent"))
            .expect("stray config dir");
        fs::write(
            &stray_config_path,
            "{\n  \"gateway\": {\n    \"port\": 18902\n  }\n}\n",
        )
        .expect("stray config");

        assert_eq!(configured_openclaw_gateway_port(&paths), None);
    }

    #[test]
    fn configured_gateway_port_uses_canonical_config_file_path_when_noncanonical_app_path_field_drifts(
    ) {
        let root = tempfile::tempdir().expect("temp dir");
        let mut paths = resolve_paths_for_root(root.path()).expect("paths");
        let openclaw = paths
            .kernel_paths("openclaw")
            .expect("openclaw kernel paths");
        let configured_port = 28_903;

        fs::remove_file(&openclaw.authority_file).expect("remove canonical authority state");
        paths.openclaw_authority_file = root
            .path()
            .join("noncanonical-app-paths")
            .join("authority.json");
        paths.openclaw_config_file = root
            .path()
            .join("noncanonical-app-paths")
            .join(".openclaw")
            .join("openclaw.json");

        fs::create_dir_all(
            openclaw
                .config_file
                .parent()
                .expect("config file parent directory"),
        )
        .expect("config file dir");
        fs::write(
            &openclaw.config_file,
            format!("{{\n  \"gateway\": {{\n    \"port\": {configured_port}\n  }}\n}}\n"),
        )
        .expect("config file");

        assert_eq!(
            configured_openclaw_gateway_port(&paths),
            Some(configured_port)
        );
    }

    #[test]
    fn built_in_openclaw_runtime_dir_uses_canonical_runtime_path_when_noncanonical_app_path_field_drifts(
    ) {
        let root = tempfile::tempdir().expect("temp dir");
        let mut paths = resolve_paths_for_root(root.path()).expect("paths");
        let openclaw = paths
            .kernel_paths("openclaw")
            .expect("openclaw kernel paths");

        paths.openclaw_runtime_dir = root.path().join("noncanonical-app-paths").join("runtime");

        assert_eq!(
            super::built_in_openclaw_runtime_dir(&paths).expect("canonical runtime path"),
            openclaw.runtime_dir
        );
    }

    #[test]
    fn stale_gateway_cleanup_continues_after_access_denied_when_configured_port_is_free() {
        let error = crate::framework::FrameworkError::Internal(
            "failed to terminate stale openclaw gateway process 224684: access denied (os error 5)"
                .to_string(),
        );

        assert!(
            super::should_continue_after_stale_openclaw_termination_error(
                &error,
                Some(21_280),
                |_| false,
            ),
            "a protected stale process should not block startup when it no longer owns the configured gateway port"
        );
        assert!(
            !super::should_continue_after_stale_openclaw_termination_error(
                &error,
                Some(21_280),
                |_| true,
            ),
            "access denied must stay fatal when the stale process still appears to own the gateway port"
        );
    }

    #[test]
    fn supervisor_production_code_does_not_call_openclaw_specific_config_wrapper() {
        let production_source = include_str!("supervisor.rs")
            .split("mod tests {")
            .next()
            .expect("production source");

        assert!(!production_source.contains(".active_openclaw_config_path("));
    }

    #[test]
    fn supervisor_startup_path_helpers_do_not_panic_on_kernel_path_resolution() {
        let production_source = include_str!("supervisor.rs")
            .split("mod tests {")
            .next()
            .expect("production source");
        let startup_path_source = production_source
            .split("fn configured_openclaw_gateway_port")
            .nth(1)
            .and_then(|tail| {
                tail.split("fn command_matches_built_in_openclaw_gateway")
                    .next()
            })
            .expect("startup path helper source");

        assert!(
            !startup_path_source.contains(".expect("),
            "OpenClaw startup path helpers must propagate kernel path errors instead of panicking"
        );
    }

    #[test]
    fn supervisor_keeps_enough_budget_for_packaged_gateway_cold_start() {
        assert!(
            super::DEFAULT_OPENCLAW_GATEWAY_READY_TIMEOUT_MS >= 60_000,
            "packaged OpenClaw gateway cold starts can take more than 26 seconds before binding; keep at least a 60s supervisor readiness budget"
        );
    }

    #[test]
    fn supervisor_hides_windows_taskkill_child_processes() {
        let production_source = include_str!("supervisor.rs")
            .split("mod tests {")
            .next()
            .expect("production source");
        let request_shutdown_source = production_source
            .split("fn request_process_shutdown")
            .nth(1)
            .and_then(|tail| tail.split("fn force_process_shutdown").next())
            .expect("request shutdown source");
        let force_shutdown_source = production_source
            .split("fn force_process_shutdown")
            .nth(1)
            .and_then(|tail| tail.split("#[cfg(test)]").next()) // WORKSPACE-PATH:allow-fixture-block: this module is the file's #[cfg(test)] unit-test fixture data
            .expect("force shutdown source");

        assert!(
            request_shutdown_source.contains("configure_hidden_child_process(&mut command);"),
            "taskkill shutdown must use the shared hidden child process policy"
        );
        assert!(
            force_shutdown_source.contains("configure_hidden_child_process(&mut command);"),
            "forced taskkill shutdown must use the shared hidden child process policy"
        );
    }

    #[test]
    fn stale_gateway_command_matching_accepts_canonical_runtime_roots() {
        let root = tempfile::tempdir().expect("temp dir");
        let paths = resolve_paths_for_root(root.path()).expect("paths");
        let command = vec![
            "C:\\Program Files\\nodejs\\node.exe".to_string(),
            paths
                .openclaw_runtime_dir
                .join(format!("{}-windows-x64", bundled_openclaw_version()))
                .join("runtime")
                .join("package")
                .join("node_modules")
                .join("openclaw")
                .join("openclaw.mjs")
                .to_string_lossy()
                .into_owned(),
            "gateway".to_string(),
        ];

        assert!(command_matches_built_in_openclaw_gateway(
            &command,
            &KernelRuntimeAuthorityService::new()
                .contract("openclaw", &paths)
                .expect("contract")
                .owned_runtime_roots,
        ));
    }

    #[test]
    fn stale_gateway_command_matching_rejects_external_runtime_roots() {
        let root = tempfile::tempdir().expect("temp dir");
        let paths = resolve_paths_for_root(root.path()).expect("paths");
        let command = vec![
            "C:\\Program Files\\nodejs\\node.exe".to_string(),
            "D:\\external\\openclaw\\runtime\\package\\node_modules\\openclaw\\openclaw.mjs"
                .to_string(),
            "gateway".to_string(),
        ];

        assert!(!command_matches_built_in_openclaw_gateway(
            &command,
            &KernelRuntimeAuthorityService::new()
                .contract("openclaw", &paths)
                .expect("contract")
                .owned_runtime_roots,
        ));
    }
}
