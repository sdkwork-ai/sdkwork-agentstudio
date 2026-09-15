use crate::framework::{FrameworkError, Result};
use sdkwork_local_api_proxy_native::kernel::{
    build_standard_hermes_config_file_path, build_standard_hermes_root_dir,
    build_standard_openclaw_config_file_path, build_standard_openclaw_root_dir,
    build_standard_openclaw_workspace_dir,
};
use std::{
    fs,
    path::{Path, PathBuf},
};
#[cfg(not(windows))]
use tauri::Manager;
use tauri::{AppHandle, Runtime};

pub const OPENCLAW_KERNEL_ID: &str = "openclaw";
pub const HERMES_KERNEL_ID: &str = "hermes";
pub const OPENCLAW_DEFAULT_AGENT_ID: &str = "main";
const SUPPORTED_KERNEL_IDS: [&str; 2] = [OPENCLAW_KERNEL_ID, HERMES_KERNEL_ID];
const SDKWORK_USER_HOME_DIR_NAME: &str = ".sdkwork";
const PRODUCT_USER_ROOT_DIR_NAME: &str = "crawstudio";
const SDKWORK_CLAW_MACHINE_ROOT_ENV_VAR: &str = "SDKWORK_CLAW_MACHINE_ROOT";
const SDKWORK_CLAW_USER_ROOT_ENV_VAR: &str = "SDKWORK_CLAW_USER_ROOT";
const MAX_OPENCLAW_AGENT_ID_LEN: usize = 64;

#[derive(Clone, Debug, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct KernelPaths {
    pub runtime_id: String,
    pub kernel_state_dir: PathBuf,
    pub runtime_dir: PathBuf,
    pub home_dir: PathBuf,
    pub state_dir: PathBuf,
    pub workspace_dir: PathBuf,
    pub authority_file: PathBuf,
    pub migrations_file: PathBuf,
    pub runtime_upgrades_file: PathBuf,
    pub config_dir: PathBuf,
    pub config_file: PathBuf,
    pub quarantine_dir: PathBuf,
}

impl KernelPaths {
    pub fn openclaw_agents_dir(&self) -> Result<PathBuf> {
        self.ensure_openclaw_paths()?;
        Ok(self.state_dir.join("agents"))
    }

    pub fn openclaw_agent_root_dir(&self, agent_id: &str) -> Result<PathBuf> {
        self.ensure_openclaw_paths()?;
        Ok(self
            .openclaw_agents_dir()?
            .join(normalize_openclaw_agent_id(agent_id)))
    }

    pub fn openclaw_agent_dir(&self, agent_id: &str) -> Result<PathBuf> {
        Ok(self.openclaw_agent_root_dir(agent_id)?.join("agent"))
    }

    pub fn openclaw_agent_sessions_dir(&self, agent_id: &str) -> Result<PathBuf> {
        Ok(self.openclaw_agent_root_dir(agent_id)?.join("sessions"))
    }

    pub fn openclaw_agent_workspace_dir(&self, agent_id: &str) -> Result<PathBuf> {
        self.ensure_openclaw_paths()?;
        let normalized_agent_id = normalize_openclaw_agent_id(agent_id);
        if normalized_agent_id == OPENCLAW_DEFAULT_AGENT_ID {
            return Ok(self.workspace_dir.clone());
        }
        Ok(self
            .state_dir
            .join(format!("workspace-{normalized_agent_id}")))
    }

    pub fn openclaw_workspace_memory_dir(&self) -> Result<PathBuf> {
        self.ensure_openclaw_paths()?;
        Ok(self.workspace_dir.join("memory"))
    }

    pub fn openclaw_workspace_skills_dir(&self) -> Result<PathBuf> {
        self.ensure_openclaw_paths()?;
        Ok(self.workspace_dir.join("skills"))
    }

    pub fn openclaw_workspace_extensions_dir(&self) -> Result<PathBuf> {
        self.ensure_openclaw_paths()?;
        Ok(self.workspace_dir.join(".openclaw").join("extensions"))
    }

    pub fn openclaw_skills_dir(&self) -> Result<PathBuf> {
        self.ensure_openclaw_paths()?;
        Ok(self.state_dir.join("skills"))
    }

    pub fn openclaw_extensions_dir(&self) -> Result<PathBuf> {
        self.ensure_openclaw_paths()?;
        Ok(self.state_dir.join("extensions"))
    }

    pub fn openclaw_cron_dir(&self) -> Result<PathBuf> {
        self.ensure_openclaw_paths()?;
        Ok(self.state_dir.join("cron"))
    }

    pub fn openclaw_credentials_dir(&self) -> Result<PathBuf> {
        self.ensure_openclaw_paths()?;
        Ok(self.state_dir.join("credentials"))
    }

    fn ensure_openclaw_paths(&self) -> Result<()> {
        if self.runtime_id == OPENCLAW_KERNEL_ID {
            return Ok(());
        }

        Err(FrameworkError::ValidationFailed(format!(
            "OpenClaw path helper requires openclaw kernel paths, received {}",
            self.runtime_id
        )))
    }
}

#[derive(Clone, Debug, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AppPaths {
    pub install_root: PathBuf,
    pub foundation_dir: PathBuf,
    pub foundation_components_dir: PathBuf,
    pub modules_dir: PathBuf,
    pub runtimes_dir: PathBuf,
    pub tools_dir: PathBuf,
    pub trust_dir: PathBuf,
    pub packs_dir: PathBuf,
    pub extensions_dir: PathBuf,
    pub machine_root: PathBuf,
    pub machine_state_dir: PathBuf,
    pub machine_store_dir: PathBuf,
    pub machine_staging_dir: PathBuf,
    pub machine_receipts_dir: PathBuf,
    pub machine_runtime_dir: PathBuf,
    pub managed_runtimes_dir: PathBuf,
    pub openclaw_runtime_dir: PathBuf,
    pub machine_recovery_dir: PathBuf,
    pub machine_logs_dir: PathBuf,
    pub user_root: PathBuf,
    pub user_bin_dir: PathBuf,
    pub openclaw_root_dir: PathBuf,
    pub openclaw_config_file: PathBuf,
    pub openclaw_workspace_dir: PathBuf,
    pub openclaw_workspace_memory_dir: PathBuf,
    pub openclaw_workspace_skills_dir: PathBuf,
    pub openclaw_workspace_extensions_dir: PathBuf,
    pub openclaw_agents_dir: PathBuf,
    pub openclaw_main_agent_dir: PathBuf,
    pub openclaw_main_agent_sessions_dir: PathBuf,
    pub openclaw_skills_dir: PathBuf,
    pub openclaw_extensions_dir: PathBuf,
    pub openclaw_cron_dir: PathBuf,
    pub openclaw_credentials_dir: PathBuf,
    pub local_ai_proxy_config_file: PathBuf,
    pub local_ai_proxy_snapshot_file: PathBuf,
    pub local_ai_proxy_token_file: PathBuf,
    pub local_ai_proxy_observability_db_file: PathBuf,
    pub local_ai_proxy_log_file: PathBuf,
    pub user_dir: PathBuf,
    pub user_auth_dir: PathBuf,
    pub user_storage_dir: PathBuf,
    pub user_integrations_dir: PathBuf,
    pub studio_dir: PathBuf,
    pub workspaces_dir: PathBuf,
    pub studio_backups_dir: PathBuf,
    pub user_logs_dir: PathBuf,
    pub config_dir: PathBuf,
    pub kernels_state_dir: PathBuf,
    pub openclaw_kernel_dir: PathBuf,
    pub openclaw_authority_file: PathBuf,
    pub openclaw_migrations_file: PathBuf,
    pub openclaw_runtime_upgrades_file: PathBuf,
    pub openclaw_quarantine_dir: PathBuf,
    pub data_dir: PathBuf,
    pub cache_dir: PathBuf,
    pub logs_dir: PathBuf,
    pub state_dir: PathBuf,
    pub storage_dir: PathBuf,
    pub plugins_dir: PathBuf,
    pub integrations_dir: PathBuf,
    pub backups_dir: PathBuf,
    pub config_file: PathBuf,
    pub layout_file: PathBuf,
    pub active_file: PathBuf,
    pub inventory_file: PathBuf,
    pub retention_file: PathBuf,
    pub pinned_file: PathBuf,
    pub channels_file: PathBuf,
    pub policies_file: PathBuf,
    pub sources_file: PathBuf,
    pub service_file: PathBuf,
    pub components_file: PathBuf,
    pub upgrades_file: PathBuf,
    pub component_registry_file: PathBuf,
    pub service_defaults_file: PathBuf,
    pub upgrade_policy_file: PathBuf,
    pub device_id_file: PathBuf,
    pub main_log_file: PathBuf,
}

impl AppPaths {
    pub fn kernel_paths(&self, runtime_id: &str) -> Result<KernelPaths> {
        let normalized_runtime_id = normalize_kernel_id(runtime_id);
        if !supported_kernel_ids()
            .iter()
            .any(|candidate| *candidate == normalized_runtime_id.as_str())
        {
            return Err(unsupported_kernel_id_error(runtime_id));
        }

        let kernel_state_dir = self.kernels_state_dir.join(&normalized_runtime_id);
        let runtime_dir = self.managed_runtimes_dir.join(&normalized_runtime_id);
        let (home_dir, state_dir, workspace_dir, config_dir, config_file) =
            if normalized_runtime_id == OPENCLAW_KERNEL_ID {
                let state_dir = build_standard_openclaw_root_dir(&self.user_root);
                (
                    self.user_root.clone(),
                    state_dir.clone(),
                    build_standard_openclaw_workspace_dir(&self.user_root),
                    state_dir,
                    build_standard_openclaw_config_file_path(&self.user_root),
                )
            } else if normalized_runtime_id == HERMES_KERNEL_ID {
                let state_dir = build_standard_hermes_root_dir(&self.user_root);
                (
                    self.user_root.clone(),
                    state_dir.clone(),
                    self.user_root
                        .join("kernels")
                        .join(&normalized_runtime_id)
                        .join("workspace"),
                    state_dir,
                    build_standard_hermes_config_file_path(&self.user_root),
                )
            } else {
                let base_dir = self.user_root.join("kernels").join(&normalized_runtime_id);
                let config_dir = kernel_state_dir.join("config");
                (
                    base_dir.join("home"),
                    base_dir.join("state"),
                    base_dir.join("workspace"),
                    config_dir.clone(),
                    config_dir.join(format!("{normalized_runtime_id}.json")),
                )
            };
        Ok(KernelPaths {
            runtime_id: normalized_runtime_id,
            kernel_state_dir: kernel_state_dir.clone(),
            runtime_dir,
            home_dir,
            state_dir,
            workspace_dir,
            authority_file: kernel_state_dir.join("authority.json"),
            migrations_file: kernel_state_dir.join("migrations.json"),
            runtime_upgrades_file: kernel_state_dir.join("runtime-upgrades.json"),
            config_dir,
            config_file,
            quarantine_dir: kernel_state_dir.join("quarantine"),
        })
    }

    pub fn managed_roots(&self) -> Vec<PathBuf> {
        let mut roots = vec![
            self.install_root.clone(),
            self.foundation_dir.clone(),
            self.foundation_components_dir.clone(),
            self.modules_dir.clone(),
            self.runtimes_dir.clone(),
            self.tools_dir.clone(),
            self.trust_dir.clone(),
            self.packs_dir.clone(),
            self.extensions_dir.clone(),
            self.machine_root.clone(),
            self.machine_state_dir.clone(),
            self.machine_store_dir.clone(),
            self.machine_staging_dir.clone(),
            self.machine_receipts_dir.clone(),
            self.machine_runtime_dir.clone(),
            self.managed_runtimes_dir.clone(),
            self.openclaw_runtime_dir.clone(),
            self.machine_recovery_dir.clone(),
            self.machine_logs_dir.clone(),
            self.user_root.clone(),
            self.user_bin_dir.clone(),
            self.openclaw_root_dir.clone(),
            self.openclaw_workspace_dir.clone(),
            self.openclaw_workspace_memory_dir.clone(),
            self.openclaw_workspace_skills_dir.clone(),
            self.openclaw_workspace_extensions_dir.clone(),
            self.openclaw_agents_dir.clone(),
            self.openclaw_main_agent_dir.clone(),
            self.openclaw_main_agent_sessions_dir.clone(),
            self.openclaw_skills_dir.clone(),
            self.openclaw_extensions_dir.clone(),
            self.openclaw_cron_dir.clone(),
            self.openclaw_credentials_dir.clone(),
            self.user_dir.clone(),
            self.user_auth_dir.clone(),
            self.user_storage_dir.clone(),
            self.user_integrations_dir.clone(),
            self.studio_dir.clone(),
            self.workspaces_dir.clone(),
            self.studio_backups_dir.clone(),
            self.user_logs_dir.clone(),
            self.config_dir.clone(),
            self.kernels_state_dir.clone(),
            self.openclaw_kernel_dir.clone(),
            self.openclaw_quarantine_dir.clone(),
            self.data_dir.clone(),
            self.cache_dir.clone(),
            self.logs_dir.clone(),
            self.state_dir.clone(),
            self.storage_dir.clone(),
            self.plugins_dir.clone(),
            self.integrations_dir.clone(),
            self.backups_dir.clone(),
        ];
        if let Some(openclaw_config_dir) = self.openclaw_config_file.parent() {
            roots.push(openclaw_config_dir.to_path_buf());
        }
        for runtime_id in supported_kernel_ids() {
            if let Ok(kernel) = self.kernel_paths(runtime_id) {
                roots.push(kernel.kernel_state_dir.clone());
                roots.push(kernel.home_dir.clone());
                roots.push(kernel.state_dir.clone());
                roots.push(kernel.workspace_dir.clone());
                roots.push(kernel.config_dir.clone());
                roots.push(kernel.quarantine_dir.clone());
                if kernel.runtime_id == OPENCLAW_KERNEL_ID {
                    for root in [
                        kernel.openclaw_workspace_memory_dir(),
                        kernel.openclaw_workspace_skills_dir(),
                        kernel.openclaw_workspace_extensions_dir(),
                        kernel.openclaw_agents_dir(),
                        kernel.openclaw_agent_dir(OPENCLAW_DEFAULT_AGENT_ID),
                        kernel.openclaw_agent_sessions_dir(OPENCLAW_DEFAULT_AGENT_ID),
                        kernel.openclaw_skills_dir(),
                        kernel.openclaw_extensions_dir(),
                        kernel.openclaw_cron_dir(),
                        kernel.openclaw_credentials_dir(),
                    ]
                    .into_iter()
                    .filter_map(|root| root.ok())
                    {
                        roots.push(root);
                    }
                }
            }
        }
        roots.sort();
        roots.dedup();
        roots
    }
}

fn normalize_kernel_id(runtime_id: &str) -> String {
    runtime_id.trim().to_ascii_lowercase()
}

pub fn normalize_openclaw_agent_id(raw: &str) -> String {
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return OPENCLAW_DEFAULT_AGENT_ID.to_string();
    }

    let mut normalized = String::new();
    let mut previous_was_invalid = false;
    for ch in trimmed.to_ascii_lowercase().chars() {
        let is_valid =
            ch.is_ascii_lowercase() || ch.is_ascii_digit() || matches!(ch, '.' | '_' | '-');
        if is_valid {
            normalized.push(ch);
            previous_was_invalid = false;
        } else if !previous_was_invalid {
            normalized.push('-');
            previous_was_invalid = true;
        }
    }

    let normalized = normalized
        .trim_matches('-')
        .chars()
        .take(MAX_OPENCLAW_AGENT_ID_LEN)
        .collect::<String>();
    if normalized.is_empty() {
        OPENCLAW_DEFAULT_AGENT_ID.to_string()
    } else {
        normalized
    }
}

pub fn supported_kernel_ids() -> &'static [&'static str] {
    &SUPPORTED_KERNEL_IDS
}

fn unsupported_kernel_id_error(runtime_id: &str) -> FrameworkError {
    FrameworkError::ValidationFailed(format!(
        "unsupported kernel runtime id {}",
        runtime_id.trim()
    ))
}

pub fn resolve_paths<R: Runtime>(app: &AppHandle<R>) -> Result<AppPaths> {
    let install_root = resolve_install_root()?;
    let machine_root = resolve_machine_root(app)?;
    let user_root = resolve_user_root(app)?;

    let paths = build_paths(install_root, machine_root, user_root);
    ensure_runtime_directories(&paths)?;
    Ok(paths)
}

pub(crate) fn resolve_paths_from_current_process() -> Result<AppPaths> {
    resolve_paths_from_current_process_with_overrides(None, None, None)
}

pub(crate) fn resolve_paths_from_current_process_with_overrides(
    install_root: Option<PathBuf>,
    machine_root: Option<PathBuf>,
    user_root: Option<PathBuf>,
) -> Result<AppPaths> {
    let paths = build_paths(
        install_root.unwrap_or(resolve_install_root()?),
        machine_root.unwrap_or(resolve_machine_root_from_current_process()?),
        user_root.unwrap_or(resolve_user_root_from_current_process()?),
    );
    ensure_runtime_directories(&paths)?;
    Ok(paths)
}

#[cfg(test)]
pub fn resolve_paths_for_root(root: &std::path::Path) -> Result<AppPaths> {
    let paths = build_paths(
        root.join("install"),
        root.join("machine"),
        root.join("app-user-root"),
    );
    ensure_runtime_directories(&paths)?;
    Ok(paths)
}

fn build_user_root_from_home_dir(home_dir: &Path) -> PathBuf {
    home_dir
        .join(SDKWORK_USER_HOME_DIR_NAME)
        .join(PRODUCT_USER_ROOT_DIR_NAME)
}

fn resolve_root_override_from_env(env_var: &str) -> Option<PathBuf> {
    let raw_value = std::env::var_os(env_var)?;
    if raw_value.to_string_lossy().trim().is_empty() {
        return None;
    }

    Some(PathBuf::from(raw_value))
}

fn build_paths(install_root: PathBuf, machine_root: PathBuf, user_root: PathBuf) -> AppPaths {
    let foundation_dir = install_root.join("foundation");
    let foundation_components_dir = foundation_dir.join("components");
    let modules_dir = install_root.join("modules");
    let runtimes_dir = install_root.join("runtimes");
    let tools_dir = install_root.join("tools");
    let trust_dir = install_root.join("trust");
    let packs_dir = install_root.join("packs");
    let extensions_dir = install_root.join("extensions");
    let plugins_dir = extensions_dir.join("plugins");

    let machine_state_dir = machine_root.join("state");
    let machine_store_dir = machine_root.join("store");
    let machine_staging_dir = machine_root.join("staging");
    let machine_receipts_dir = machine_root.join("receipts");
    let machine_runtime_dir = machine_root.join("runtime");
    let managed_runtimes_dir = install_root.join("runtimes");
    let openclaw_runtime_dir = managed_runtimes_dir.join("openclaw");
    let machine_recovery_dir = machine_root.join("recovery");
    let machine_logs_dir = machine_root.join("logs");

    let user_bin_dir = user_root.join("bin");
    let openclaw_root_dir = build_standard_openclaw_root_dir(&user_root);
    let openclaw_config_file = build_standard_openclaw_config_file_path(&user_root);
    let openclaw_workspace_dir = build_standard_openclaw_workspace_dir(&user_root);
    let openclaw_workspace_memory_dir = openclaw_workspace_dir.join("memory");
    let openclaw_workspace_skills_dir = openclaw_workspace_dir.join("skills");
    let openclaw_workspace_extensions_dir =
        openclaw_workspace_dir.join(".openclaw").join("extensions");
    let openclaw_agents_dir = openclaw_root_dir.join("agents");
    let openclaw_main_agent_dir = openclaw_agents_dir.join("main").join("agent");
    let openclaw_main_agent_sessions_dir = openclaw_agents_dir.join("main").join("sessions");
    let openclaw_skills_dir = openclaw_root_dir.join("skills");
    let openclaw_extensions_dir = openclaw_root_dir.join("extensions");
    let openclaw_cron_dir = openclaw_root_dir.join("cron");
    let openclaw_credentials_dir = openclaw_root_dir.join("credentials");
    let user_dir = user_root.join("user");
    let user_auth_dir = user_dir.join("auth");
    let user_storage_dir = user_dir.join("storage");
    let user_integrations_dir = user_dir.join("integrations");
    let studio_dir = user_root.join("studio");
    let workspaces_dir = studio_dir.join("workspaces");
    let studio_backups_dir = studio_dir.join("backups");
    let user_logs_dir = user_root.join("logs");

    let config_dir = machine_state_dir.clone();
    let kernels_state_dir = config_dir.join("kernels");
    let openclaw_kernel_dir = kernels_state_dir.join("openclaw");
    let openclaw_authority_file = openclaw_kernel_dir.join("authority.json");
    let openclaw_migrations_file = openclaw_kernel_dir.join("migrations.json");
    let openclaw_runtime_upgrades_file = openclaw_kernel_dir.join("runtime-upgrades.json");
    let openclaw_quarantine_dir = openclaw_kernel_dir.join("quarantine");
    let data_dir = studio_dir.clone();
    let cache_dir = machine_staging_dir.clone();
    let logs_dir = machine_logs_dir.join("app");
    let state_dir = machine_runtime_dir.join("state");
    let local_ai_proxy_config_file = machine_state_dir.join("local-ai-proxy.json");
    let local_ai_proxy_snapshot_file = state_dir.join("local-ai-proxy.snapshot.json");
    let local_ai_proxy_token_file = state_dir.join("local-ai-proxy.token");
    let local_ai_proxy_observability_db_file =
        machine_store_dir.join("local-ai-proxy-observability.sqlite3");
    let local_ai_proxy_log_file = logs_dir.join("local-ai-proxy.log");
    let storage_dir = user_storage_dir.clone();
    let integrations_dir = user_integrations_dir.clone();
    let backups_dir = studio_backups_dir.clone();
    let config_file = config_dir.join("app.json");
    let layout_file = config_dir.join("layout.json");
    let active_file = config_dir.join("active.json");
    let inventory_file = config_dir.join("inventory.json");
    let retention_file = config_dir.join("retention.json");
    let pinned_file = config_dir.join("pinned.json");
    let channels_file = config_dir.join("channels.json");
    let policies_file = config_dir.join("policies.json");
    let sources_file = config_dir.join("sources.json");
    let service_file = config_dir.join("service.json");
    let components_file = config_dir.join("components.json");
    let upgrades_file = config_dir.join("upgrades.json");
    let component_registry_file = foundation_components_dir.join("component-registry.json");
    let service_defaults_file = foundation_components_dir.join("service-defaults.json");
    let upgrade_policy_file = foundation_components_dir.join("upgrade-policy.json");
    let device_id_file = state_dir.join("device-id");
    let main_log_file = logs_dir.join("app.log");

    AppPaths {
        install_root,
        foundation_dir,
        foundation_components_dir,
        modules_dir,
        runtimes_dir,
        tools_dir,
        trust_dir,
        packs_dir,
        extensions_dir,
        machine_root,
        machine_state_dir,
        machine_store_dir,
        machine_staging_dir,
        machine_receipts_dir,
        machine_runtime_dir,
        managed_runtimes_dir,
        openclaw_runtime_dir,
        machine_recovery_dir,
        machine_logs_dir,
        user_root,
        user_bin_dir,
        openclaw_root_dir,
        openclaw_config_file,
        openclaw_workspace_dir,
        openclaw_workspace_memory_dir,
        openclaw_workspace_skills_dir,
        openclaw_workspace_extensions_dir,
        openclaw_agents_dir,
        openclaw_main_agent_dir,
        openclaw_main_agent_sessions_dir,
        openclaw_skills_dir,
        openclaw_extensions_dir,
        openclaw_cron_dir,
        openclaw_credentials_dir,
        local_ai_proxy_config_file,
        local_ai_proxy_snapshot_file,
        local_ai_proxy_token_file,
        local_ai_proxy_observability_db_file,
        local_ai_proxy_log_file,
        user_dir,
        user_auth_dir,
        user_storage_dir,
        user_integrations_dir,
        studio_dir,
        workspaces_dir,
        studio_backups_dir,
        user_logs_dir,
        config_dir,
        kernels_state_dir,
        openclaw_kernel_dir,
        openclaw_authority_file,
        openclaw_migrations_file,
        openclaw_runtime_upgrades_file,
        openclaw_quarantine_dir,
        data_dir,
        cache_dir,
        logs_dir,
        state_dir,
        storage_dir,
        plugins_dir,
        integrations_dir,
        backups_dir,
        config_file,
        layout_file,
        active_file,
        inventory_file,
        retention_file,
        pinned_file,
        channels_file,
        policies_file,
        sources_file,
        service_file,
        components_file,
        upgrades_file,
        component_registry_file,
        service_defaults_file,
        upgrade_policy_file,
        device_id_file,
        main_log_file,
    }
}

fn resolve_install_root() -> Result<PathBuf> {
    let executable = std::env::current_exe()?;
    executable
        .parent()
        .map(|path| path.to_path_buf())
        .ok_or_else(|| {
            FrameworkError::Internal(
                "failed to resolve install root from current executable".to_string(),
            )
        })
}

#[cfg(windows)]
fn resolve_machine_root<R: Runtime>(_app: &AppHandle<R>) -> Result<PathBuf> {
    resolve_machine_root_from_env()
}

#[cfg(windows)]
fn resolve_machine_root_from_env() -> Result<PathBuf> {
    if let Some(root) = resolve_root_override_from_env(SDKWORK_CLAW_MACHINE_ROOT_ENV_VAR) {
        return Ok(root);
    }

    let base = std::env::var_os("ProgramData")
        .map(PathBuf::from)
        .ok_or_else(|| FrameworkError::NotFound("ProgramData environment variable".to_string()))?;

    Ok(base.join("SdkWork").join("CrawStudio"))
}

#[cfg(windows)]
fn resolve_machine_root_from_current_process() -> Result<PathBuf> {
    resolve_machine_root_from_env()
}

#[cfg(not(windows))]
fn resolve_machine_root<R: Runtime>(app: &AppHandle<R>) -> Result<PathBuf> {
    if let Some(root) = resolve_root_override_from_env(SDKWORK_CLAW_MACHINE_ROOT_ENV_VAR) {
        return Ok(root);
    }

    let resolver = app.path();
    resolver
        .app_data_dir()
        .map(|path| path.join("machine"))
        .map_err(FrameworkError::from)
}

#[cfg(not(windows))]
fn resolve_machine_root_from_current_process() -> Result<PathBuf> {
    if let Some(root) = resolve_root_override_from_env(SDKWORK_CLAW_MACHINE_ROOT_ENV_VAR) {
        return Ok(root);
    }

    let context: tauri::Context<tauri::Wry> = tauri::generate_context!();
    dirs::data_dir()
        .map(|path| {
            path.join(context.config().identifier.as_str())
                .join("machine")
        })
        .ok_or_else(|| FrameworkError::NotFound("platform app data directory".to_string()))
}

#[cfg(windows)]
fn resolve_user_root<R: Runtime>(_app: &AppHandle<R>) -> Result<PathBuf> {
    resolve_user_root_from_env()
}

#[cfg(windows)]
fn resolve_user_root_from_env() -> Result<PathBuf> {
    if let Some(root) = resolve_root_override_from_env(SDKWORK_CLAW_USER_ROOT_ENV_VAR) {
        return Ok(root);
    }

    let base = dirs::home_dir()
        .or_else(|| std::env::var_os("USERPROFILE").map(PathBuf::from))
        .ok_or_else(|| FrameworkError::NotFound("user home directory".to_string()))?;

    Ok(build_user_root_from_home_dir(&base))
}

#[cfg(windows)]
fn resolve_user_root_from_current_process() -> Result<PathBuf> {
    resolve_user_root_from_env()
}

#[cfg(not(windows))]
fn resolve_user_root<R: Runtime>(app: &AppHandle<R>) -> Result<PathBuf> {
    if let Some(root) = resolve_root_override_from_env(SDKWORK_CLAW_USER_ROOT_ENV_VAR) {
        return Ok(root);
    }

    let resolver = app.path();
    resolver
        .home_dir()
        .map(|path| build_user_root_from_home_dir(&path))
        .map_err(FrameworkError::from)
}

#[cfg(not(windows))]
fn resolve_user_root_from_current_process() -> Result<PathBuf> {
    if let Some(root) = resolve_root_override_from_env(SDKWORK_CLAW_USER_ROOT_ENV_VAR) {
        return Ok(root);
    }

    dirs::home_dir()
        .map(|path| build_user_root_from_home_dir(&path))
        .ok_or_else(|| FrameworkError::NotFound("user home directory".to_string()))
}

pub fn ensure_runtime_directories(paths: &AppPaths) -> Result<()> {
    for directory in paths.managed_roots() {
        fs::create_dir_all(directory)?;
    }

    crate::framework::layout::initialize_machine_state(paths)?;
    crate::framework::config::load_or_create_config(paths)?;

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::{
        build_user_root_from_home_dir, normalize_openclaw_agent_id, resolve_paths_for_root,
    };
    use std::path::PathBuf;
    use std::sync::{Mutex, OnceLock};

    static ENV_LOCK: OnceLock<Mutex<()>> = OnceLock::new();

    fn with_env_override<F>(key: &str, value: &std::path::Path, action: F)
    where
        F: FnOnce(),
    {
        let lock = ENV_LOCK.get_or_init(|| Mutex::new(()));
        let _guard = lock.lock().expect("env lock");
        let previous = std::env::var_os(key);
        std::env::set_var(key, value);
        action();
        if let Some(previous) = previous {
            std::env::set_var(key, previous);
        } else {
            std::env::remove_var(key);
        }
    }

    fn normalize(path: &std::path::Path) -> String {
        path.to_string_lossy().replace('\\', "/")
    }

    #[test]
    fn managed_roots_does_not_panic_when_optional_derived_roots_are_unavailable() {
        let production_source = include_str!("paths.rs")
            .split("#[cfg(test)]") // WORKSPACE-PATH:allow-fixture-block: this module is the file's #[cfg(test)] unit-test fixture data
            .next()
            .expect("production source");
        let managed_roots_source = production_source
            .split("pub fn managed_roots")
            .nth(1)
            .and_then(|tail| tail.split("pub fn kernel_paths").next())
            .expect("managed roots source");

        assert!(
            !managed_roots_source.contains(".expect("),
            "managed_roots must skip unavailable derived roots instead of panicking"
        );
    }

    #[test]
    fn app_user_root_is_always_under_the_platform_user_home_directory() {
        let home_dir = PathBuf::from("C:/Users/alice");
        let user_root = build_user_root_from_home_dir(home_dir.as_path());

        assert_eq!(normalize(&user_root), "C:/Users/alice/.sdkwork/crawstudio");
        assert!(
            !normalize(&user_root).contains("AppData")
                && !normalize(&user_root).contains("ProgramData")
        );
        assert_eq!(
            normalize(
                &sdkwork_local_api_proxy_native::kernel::build_standard_openclaw_root_dir(
                    &user_root
                )
            ),
            "C:/Users/alice/.sdkwork/crawstudio/.openclaw"
        );
    }

    #[cfg(windows)]
    #[test]
    fn explicit_user_root_env_override_takes_precedence_on_windows() {
        let root = tempfile::tempdir().expect("temp dir");
        let expected_user_root = root.path().join(".sdkwork").join("crawstudio");

        with_env_override("SDKWORK_CLAW_USER_ROOT", &expected_user_root, || {
            let user_root = super::resolve_user_root_from_env().expect("user root from env");

            assert_eq!(normalize(&user_root), normalize(&expected_user_root));
        });
    }

    #[cfg(windows)]
    #[test]
    fn explicit_machine_root_env_override_takes_precedence_on_windows() {
        let root = tempfile::tempdir().expect("temp dir");
        let expected_machine_root = root.path().join("SdkWork").join("CrawStudio");

        with_env_override("SDKWORK_CLAW_MACHINE_ROOT", &expected_machine_root, || {
            let machine_root =
                super::resolve_machine_root_from_env().expect("machine root from env");

            assert_eq!(normalize(&machine_root), normalize(&expected_machine_root));
        });
    }

    #[test]
    fn creates_runtime_directories() {
        let root = tempfile::tempdir().expect("temp dir");
        let paths = resolve_paths_for_root(root.path()).expect("paths");

        assert!(normalize(&paths.config_dir).ends_with("machine/state"));
        assert!(normalize(&paths.data_dir).ends_with("app-user-root/studio"));
        assert!(normalize(&paths.cache_dir).ends_with("machine/staging"));
        assert!(normalize(&paths.logs_dir).ends_with("machine/logs/app"));
        assert!(normalize(&paths.state_dir).ends_with("machine/runtime/state"));
        assert!(paths.config_dir.exists());
        assert!(paths.data_dir.exists());
        assert!(paths.cache_dir.exists());
        assert!(paths.logs_dir.exists());
        assert!(paths.state_dir.exists());
    }

    #[test]
    fn creates_extended_kernel_directories() {
        let root = tempfile::tempdir().expect("temp dir");
        let paths = resolve_paths_for_root(root.path()).expect("paths");

        assert!(normalize(&paths.storage_dir).ends_with("app-user-root/user/storage"));
        assert!(normalize(&paths.plugins_dir).ends_with("install/extensions/plugins"));
        assert!(normalize(&paths.integrations_dir).ends_with("app-user-root/user/integrations"));
        assert!(normalize(&paths.backups_dir).ends_with("app-user-root/studio/backups"));
        assert!(root
            .path()
            .join("app-user-root")
            .join("user")
            .join("storage")
            .exists());
        assert!(root
            .path()
            .join("install")
            .join("extensions")
            .join("plugins")
            .exists());
        assert!(root
            .path()
            .join("app-user-root")
            .join("user")
            .join("integrations")
            .exists());
        assert!(root
            .path()
            .join("app-user-root")
            .join("studio")
            .join("backups")
            .exists());
    }

    #[test]
    fn creates_openclaw_runtime_management_directories() {
        let root = tempfile::tempdir().expect("temp dir");
        let paths = resolve_paths_for_root(root.path()).expect("paths");

        assert!(normalize(&paths.managed_runtimes_dir).ends_with("install/runtimes"));
        assert!(normalize(&paths.openclaw_runtime_dir).ends_with("install/runtimes/openclaw"));
        assert!(normalize(&paths.user_bin_dir).ends_with("app-user-root/bin"));
        assert!(normalize(&paths.openclaw_root_dir).ends_with("app-user-root/.openclaw"));
        assert!(normalize(&paths.openclaw_config_file)
            .ends_with("app-user-root/.openclaw/openclaw.json"));
        assert!(
            normalize(&paths.openclaw_workspace_dir).ends_with("app-user-root/.openclaw/workspace")
        );
        assert!(normalize(&paths.openclaw_skills_dir).ends_with("app-user-root/.openclaw/skills"));
        assert!(normalize(&paths.openclaw_extensions_dir)
            .ends_with("app-user-root/.openclaw/extensions"));
        assert!(normalize(&paths.openclaw_workspace_skills_dir)
            .ends_with("app-user-root/.openclaw/workspace/skills"));
        assert!(normalize(&paths.openclaw_workspace_extensions_dir)
            .ends_with("app-user-root/.openclaw/workspace/.openclaw/extensions"));
        assert!(normalize(&paths.local_ai_proxy_config_file)
            .ends_with("machine/state/local-ai-proxy.json"));
        assert!(normalize(&paths.local_ai_proxy_snapshot_file)
            .ends_with("machine/runtime/state/local-ai-proxy.snapshot.json"));
        assert!(normalize(&paths.local_ai_proxy_token_file)
            .ends_with("machine/runtime/state/local-ai-proxy.token"));
        assert!(normalize(&paths.local_ai_proxy_log_file)
            .ends_with("machine/logs/app/local-ai-proxy.log"));
        assert!(paths.managed_runtimes_dir.exists());
        assert!(paths.openclaw_runtime_dir.exists());
        assert!(paths.user_bin_dir.exists());
        assert!(paths.openclaw_root_dir.exists());
        assert!(paths
            .openclaw_config_file
            .parent()
            .is_some_and(|path| path.exists()));
        assert!(paths.openclaw_workspace_dir.exists());
        assert!(paths.openclaw_skills_dir.exists());
        assert!(paths.openclaw_extensions_dir.exists());
        assert!(paths.openclaw_workspace_skills_dir.exists());
        assert!(paths.openclaw_workspace_extensions_dir.exists());
    }

    #[test]
    fn creates_openclaw_authority_management_directories() {
        let root = tempfile::tempdir().expect("temp dir");
        let paths = resolve_paths_for_root(root.path()).expect("paths");

        assert!(normalize(&paths.kernels_state_dir).ends_with("machine/state/kernels"));
        assert!(normalize(&paths.openclaw_kernel_dir).ends_with("machine/state/kernels/openclaw"));
        assert!(normalize(&paths.openclaw_authority_file)
            .ends_with("machine/state/kernels/openclaw/authority.json"));
        assert!(normalize(&paths.openclaw_migrations_file)
            .ends_with("machine/state/kernels/openclaw/migrations.json"));
        assert!(normalize(&paths.openclaw_runtime_upgrades_file)
            .ends_with("machine/state/kernels/openclaw/runtime-upgrades.json"));
        assert!(normalize(&paths.openclaw_quarantine_dir)
            .ends_with("machine/state/kernels/openclaw/quarantine"));
        assert!(paths.kernels_state_dir.exists());
        assert!(paths.openclaw_kernel_dir.exists());
        assert!(paths.openclaw_quarantine_dir.exists());
        assert!(paths.openclaw_authority_file.exists());
        assert!(paths.openclaw_migrations_file.exists());
        assert!(paths.openclaw_runtime_upgrades_file.exists());
    }

    #[test]
    fn resolves_kernel_scoped_machine_state_paths() {
        let root = tempfile::tempdir().expect("temp dir");
        let paths = resolve_paths_for_root(root.path()).expect("paths");
        let openclaw = paths
            .kernel_paths("openclaw")
            .expect("openclaw kernel paths");

        assert!(normalize(&openclaw.kernel_state_dir).ends_with("machine/state/kernels/openclaw"));
        assert!(normalize(&openclaw.runtime_dir).ends_with("install/runtimes/openclaw"));
        assert!(normalize(&openclaw.authority_file)
            .ends_with("machine/state/kernels/openclaw/authority.json"));
        assert!(normalize(&openclaw.migrations_file)
            .ends_with("machine/state/kernels/openclaw/migrations.json"));
        assert!(normalize(&openclaw.runtime_upgrades_file)
            .ends_with("machine/state/kernels/openclaw/runtime-upgrades.json"));
        assert!(normalize(&openclaw.home_dir).ends_with("app-user-root"));
        assert!(normalize(&openclaw.state_dir).ends_with("app-user-root/.openclaw"));
        assert!(normalize(&openclaw.workspace_dir).ends_with("app-user-root/.openclaw/workspace"));
        assert!(normalize(&openclaw.config_dir).ends_with("app-user-root/.openclaw"));
        assert!(normalize(&openclaw.config_file).ends_with("app-user-root/.openclaw/openclaw.json"));
        assert!(normalize(&openclaw.quarantine_dir)
            .ends_with("machine/state/kernels/openclaw/quarantine"));
    }

    #[test]
    fn kernel_paths_reject_unknown_runtime_id() {
        let root = tempfile::tempdir().expect("temp dir");
        let paths = resolve_paths_for_root(root.path()).expect("paths");

        let hermes = paths.kernel_paths("hermes").expect("hermes kernel paths");

        assert!(normalize(&hermes.kernel_state_dir).ends_with("machine/state/kernels/hermes"));
        assert!(normalize(&hermes.runtime_dir).ends_with("install/runtimes/hermes"));
        assert!(normalize(&hermes.authority_file)
            .ends_with("machine/state/kernels/hermes/authority.json"));
        assert!(normalize(&hermes.migrations_file)
            .ends_with("machine/state/kernels/hermes/migrations.json"));
        assert!(normalize(&hermes.runtime_upgrades_file)
            .ends_with("machine/state/kernels/hermes/runtime-upgrades.json"));
        assert!(normalize(&hermes.config_dir).ends_with("app-user-root/.hermes"));
        assert!(normalize(&hermes.config_file).ends_with("app-user-root/.hermes/config.yaml"));
        assert!(
            normalize(&hermes.quarantine_dir).ends_with("machine/state/kernels/hermes/quarantine")
        );

        let error = paths
            .kernel_paths("unsupported-kernel")
            .expect_err("unknown kernel paths should still be rejected");

        assert!(!error.to_string().trim().is_empty());
    }

    #[test]
    fn kernel_paths_canonicalize_runtime_id_case_and_whitespace() {
        let root = tempfile::tempdir().expect("temp dir");
        let paths = resolve_paths_for_root(root.path()).expect("paths");

        let openclaw = paths
            .kernel_paths(" OpenClaw ")
            .expect("case-insensitive openclaw kernel paths");

        assert_eq!(openclaw.runtime_id, "openclaw");
        assert!(normalize(&openclaw.kernel_state_dir).ends_with("machine/state/kernels/openclaw"));
        assert!(normalize(&openclaw.runtime_dir).ends_with("install/runtimes/openclaw"));
        assert!(normalize(&openclaw.config_file).ends_with("app-user-root/.openclaw/openclaw.json"));
    }

    #[test]
    fn kernel_paths_resolve_openclaw_agent_paths_with_canonical_agent_ids() {
        let root = tempfile::tempdir().expect("temp dir");
        let paths = resolve_paths_for_root(root.path()).expect("paths");
        let openclaw = paths
            .kernel_paths(" OpenClaw ")
            .expect("case-insensitive openclaw kernel paths");

        assert_eq!(
            normalize_openclaw_agent_id(" Research Agent "),
            "research-agent"
        );
        assert_eq!(normalize_openclaw_agent_id("main"), "main");
        assert_eq!(normalize_openclaw_agent_id(" 中文 "), "main");
        assert!(
            normalize(&openclaw.openclaw_agents_dir().expect("openclaw agents dir"))
                .ends_with("app-user-root/.openclaw/agents")
        );
        assert!(normalize(
            &openclaw
                .openclaw_agent_workspace_dir(" main ")
                .expect("main workspace")
        )
        .ends_with("app-user-root/.openclaw/workspace"));
        assert!(normalize(
            &openclaw
                .openclaw_agent_dir(" MAIN ")
                .expect("main agent dir")
        )
        .ends_with("app-user-root/.openclaw/agents/main/agent"));
        assert!(normalize(
            &openclaw
                .openclaw_agent_sessions_dir(" MAIN ")
                .expect("main sessions dir")
        )
        .ends_with("app-user-root/.openclaw/agents/main/sessions"));
        assert!(normalize(
            &openclaw
                .openclaw_agent_workspace_dir(" Research Agent ")
                .expect("agent workspace")
        )
        .ends_with("app-user-root/.openclaw/workspace-research-agent"));
        assert!(normalize(
            &openclaw
                .openclaw_agent_dir(" Research Agent ")
                .expect("agent dir")
        )
        .ends_with("app-user-root/.openclaw/agents/research-agent/agent"));
    }

    #[test]
    fn kernel_paths_derive_openclaw_governance_from_kernel_roots_and_config_from_user_root() {
        let root = tempfile::tempdir().expect("temp dir");
        let mut paths = resolve_paths_for_root(root.path()).expect("paths");
        let noncanonical_root = root.path().join("noncanonical-app-paths");

        paths.openclaw_kernel_dir = noncanonical_root.join("kernel");
        paths.openclaw_authority_file = noncanonical_root.join("authority.json");
        paths.openclaw_migrations_file = noncanonical_root.join("migrations.json");
        paths.openclaw_runtime_upgrades_file = noncanonical_root.join("runtime-upgrades.json");
        paths.openclaw_quarantine_dir = noncanonical_root.join("quarantine");
        paths.openclaw_root_dir = noncanonical_root.join(".openclaw");
        paths.openclaw_config_file = noncanonical_root.join(".openclaw").join("openclaw.json");

        let openclaw = paths
            .kernel_paths("openclaw")
            .expect("openclaw kernel paths");

        assert!(normalize(&openclaw.kernel_state_dir).ends_with("machine/state/kernels/openclaw"));
        assert!(normalize(&openclaw.runtime_dir).ends_with("install/runtimes/openclaw"));
        assert!(normalize(&openclaw.authority_file)
            .ends_with("machine/state/kernels/openclaw/authority.json"));
        assert!(normalize(&openclaw.migrations_file)
            .ends_with("machine/state/kernels/openclaw/migrations.json"));
        assert!(normalize(&openclaw.runtime_upgrades_file)
            .ends_with("machine/state/kernels/openclaw/runtime-upgrades.json"));
        assert!(normalize(&openclaw.config_dir).ends_with("app-user-root/.openclaw"));
        assert!(normalize(&openclaw.config_file).ends_with("app-user-root/.openclaw/openclaw.json"));
        assert!(normalize(&openclaw.quarantine_dir)
            .ends_with("machine/state/kernels/openclaw/quarantine"));
    }

    #[test]
    fn creates_machine_state_metadata_files() {
        let root = tempfile::tempdir().expect("temp dir");
        let paths = resolve_paths_for_root(root.path()).expect("paths");

        let machine_state_dir = root.path().join("machine").join("state");

        assert!(paths.config_file.exists());
        assert!(machine_state_dir.join("layout.json").exists());
        assert!(machine_state_dir.join("active.json").exists());
        assert!(machine_state_dir.join("inventory.json").exists());
        assert!(machine_state_dir.join("retention.json").exists());
        assert!(machine_state_dir.join("pinned.json").exists());
        assert!(machine_state_dir.join("channels.json").exists());
        assert!(machine_state_dir.join("policies.json").exists());
        assert!(machine_state_dir.join("sources.json").exists());
        assert!(machine_state_dir.join("service.json").exists());
        assert!(machine_state_dir.join("components.json").exists());
        assert!(machine_state_dir.join("upgrades.json").exists());
    }
}
