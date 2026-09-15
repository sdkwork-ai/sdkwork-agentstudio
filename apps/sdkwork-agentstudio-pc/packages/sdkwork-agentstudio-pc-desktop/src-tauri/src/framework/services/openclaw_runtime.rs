use super::local_ai_proxy::{
    config::ensure_local_ai_proxy_client_api_key, OPENCLAW_LOCAL_PROXY_TOKEN_ENV_VAR,
};
use crate::{
    framework::{
        paths::{AppPaths, KernelPaths},
        ports::{
            managed_gateway_fallback_port_range_end, managed_gateway_fallback_port_range_start,
            OPENCLAW_GATEWAY_DEFAULT_PORT,
        },
        services::{
            kernel_runtime_authority::KernelRuntimeAuthorityService,
            openclaw_channel_config::sanitize_openclaw_channel_config,
        },
        FrameworkError, Result,
    },
    platform,
};
use sdkwork_agentstudio_host_core::port_allocator::{
    allocate_tcp_listener, PortAllocationRequest, PortRange,
};
use serde_json::{Map, Number, Value};
use sha2::{Digest, Sha256};
use std::{
    collections::{BTreeMap, BTreeSet},
    env, fs,
    io::{self, Read},
    path::{Path, PathBuf},
    time::{SystemTime, UNIX_EPOCH},
};
use uuid::Uuid;
use zip::ZipArchive;

pub const OPENCLAW_RUNTIME_ID: &str = "openclaw";
const OPENCLAW_DEFAULT_AGENT_ID: &str = "main";
const BUNDLED_RESOURCE_DIR: &str = "openclaw";
const NESTED_BUNDLED_RESOURCE_DIR: &str = "resources/openclaw";
const BUNDLED_RUNTIME_ARCHIVE_FILE_NAME: &str = "runtime.zip";
const PREPARED_RUNTIME_SIDECAR_MANIFEST_FILE_NAME: &str = ".sdkwork-openclaw-runtime.json";
pub(crate) const DEFAULT_GATEWAY_PORT: u16 = OPENCLAW_GATEWAY_DEFAULT_PORT;
const OPENCLAW_NODE_PATH_OVERRIDE_ENV: &str = "SDKWORK_OPENCLAW_NODE_PATH";
const TAURI_CONTROL_UI_ALLOWED_ORIGINS: [&str; 3] = [
    "http://tauri.localhost",
    "https://tauri.localhost",
    "tauri://localhost",
];
const LEGACY_PROVIDER_RUNTIME_CONFIG_KEYS: [&str; 5] =
    ["temperature", "topP", "maxTokens", "timeoutMs", "streaming"];

#[derive(Clone, Debug, PartialEq, Eq, serde::Deserialize, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BundledOpenClawManifest {
    pub schema_version: u32,
    pub runtime_id: String,
    pub openclaw_version: String,
    pub required_external_runtimes: Vec<String>,
    pub required_external_runtime_versions: BTreeMap<String, String>,
    pub platform: String,
    pub arch: String,
    pub cli_relative_path: String,
}

#[derive(Clone, Debug, PartialEq, Eq, serde::Deserialize, serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct PreparedOpenClawRuntimeSidecarManifest {
    #[serde(flatten)]
    manifest: BundledOpenClawManifest,
    #[serde(default)]
    runtime_integrity: Option<PreparedOpenClawRuntimeIntegrityManifest>,
}

#[derive(Clone, Debug, PartialEq, Eq, serde::Deserialize, serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct PreparedOpenClawRuntimeIntegrityManifest {
    schema_version: u32,
    files: Vec<PreparedOpenClawRuntimeIntegrityFile>,
}

#[derive(Clone, Debug, PartialEq, Eq, serde::Deserialize, serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct PreparedOpenClawRuntimeIntegrityFile {
    relative_path: String,
    size: u64,
    sha256: String,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum RuntimeSidecarValidation {
    Missing,
    Match,
    Mismatch,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ActivatedOpenClawRuntime {
    pub install_key: String,
    pub install_dir: PathBuf,
    pub runtime_dir: PathBuf,
    pub node_path: PathBuf,
    pub cli_path: PathBuf,
    pub home_dir: PathBuf,
    pub state_dir: PathBuf,
    pub workspace_dir: PathBuf,
    pub config_path: PathBuf,
    pub gateway_port: u16,
    pub gateway_auth_token: String,
}

#[derive(Clone, Debug, Default)]
pub struct OpenClawRuntimeService;

#[derive(Clone, Debug, PartialEq, Eq)]
struct BuiltInOpenClawState {
    home_dir: PathBuf,
    state_dir: PathBuf,
    workspace_dir: PathBuf,
    config_path: PathBuf,
    gateway_port: u16,
    gateway_auth_token: String,
}

impl BundledOpenClawManifest {
    pub fn install_key(&self) -> String {
        format!("{}-{}-{}", self.openclaw_version, self.platform, self.arch)
    }

    pub fn external_node_version(&self) -> Option<&str> {
        self.required_external_runtime_versions
            .get("nodejs")
            .map(String::as_str)
    }

    fn requires_external_node_runtime(&self) -> bool {
        self.required_external_runtimes
            .iter()
            .any(|runtime| runtime == "nodejs")
            && self
                .external_node_version()
                .is_some_and(|version| !version.trim().is_empty())
    }
}

impl ActivatedOpenClawRuntime {
    pub fn managed_env(&self) -> BTreeMap<String, String> {
        BTreeMap::from([
            (
                "OPENCLAW_HOME".to_string(),
                self.home_dir.to_string_lossy().into_owned(),
            ),
            (
                "OPENCLAW_STATE_DIR".to_string(),
                self.state_dir.to_string_lossy().into_owned(),
            ),
            (
                "OPENCLAW_CONFIG_PATH".to_string(),
                self.config_path.to_string_lossy().into_owned(),
            ),
            (
                "OPENCLAW_GATEWAY_TOKEN".to_string(),
                self.gateway_auth_token.clone(),
            ),
        ])
    }

    pub fn managed_env_with_local_ai_proxy(
        &self,
        paths: &AppPaths,
    ) -> Result<BTreeMap<String, String>> {
        let mut env = self.managed_env();
        env.insert(
            OPENCLAW_LOCAL_PROXY_TOKEN_ENV_VAR.to_string(),
            ensure_local_ai_proxy_client_api_key(paths)?,
        );
        Ok(env)
    }
}

impl OpenClawRuntimeService {
    pub fn new() -> Self {
        Self
    }

    pub fn ensure_bundled_runtime_from_root(
        &self,
        paths: &AppPaths,
        resource_root: &Path,
    ) -> Result<ActivatedOpenClawRuntime> {
        let bundled_manifest_path = resource_root.join("manifest.json");
        let manifest = load_manifest(&bundled_manifest_path)?;
        validate_manifest_target(&manifest)?;

        if manifest.runtime_id != OPENCLAW_RUNTIME_ID {
            return Err(FrameworkError::ValidationFailed(format!(
                "unsupported packaged OpenClaw runtime id {}",
                manifest.runtime_id
            )));
        }

        let bundled_runtime_dir = resource_root.join("runtime");
        let bundled_runtime_archive_path = resource_root.join(BUNDLED_RUNTIME_ARCHIVE_FILE_NAME);
        if !bundled_runtime_dir.exists() && !bundled_runtime_archive_path.exists() {
            return Err(FrameworkError::NotFound(format!(
                "packaged OpenClaw runtime payload not found under {} (expected {} or {})",
                resource_root.display(),
                bundled_runtime_dir.display(),
                bundled_runtime_archive_path.display()
            )));
        }

        let install_key = manifest.install_key();
        let install_dir = paths.openclaw_runtime_dir.join(&install_key);
        let expected_runtime_dir = install_dir.join("runtime");

        if bundled_runtime_dir.exists() {
            ensure_runtime_installation_from_directory(
                &bundled_runtime_dir,
                &bundled_manifest_path,
                &manifest,
                &install_dir,
                &expected_runtime_dir,
            )?;
        } else {
            ensure_runtime_installation_from_archive(
                &bundled_runtime_archive_path,
                &bundled_manifest_path,
                &manifest,
                &install_dir,
                &expected_runtime_dir,
            )?;
        }

        let install_dir =
            resolve_launch_runtime_install_dir(&install_dir, &manifest)?.ok_or_else(|| {
                FrameworkError::NotFound(format!(
                    "packaged OpenClaw runtime is incomplete under {}",
                    install_dir.display()
                ))
            })?;
        let runtime_dir = install_dir.join("runtime");
        let node_path = resolve_external_node_path()?;
        let cli_path = install_dir.join(&manifest.cli_relative_path);
        if !cli_path.exists() {
            return Err(FrameworkError::NotFound(format!(
                "packaged OpenClaw runtime is missing the CLI entrypoint under {}",
                install_dir.display()
            )));
        }

        let available_channel_ids = collect_openclaw_runtime_channel_ids(&runtime_dir)?;
        let built_in_state = ensure_built_in_openclaw_state(
            paths,
            Some(manifest.openclaw_version.as_str()),
            Some(&available_channel_ids),
        )?;
        KernelRuntimeAuthorityService::new().record_activation_result(
            OPENCLAW_RUNTIME_ID,
            paths,
            &install_key,
            None,
        )?;

        Ok(ActivatedOpenClawRuntime {
            install_key,
            install_dir,
            runtime_dir,
            node_path,
            cli_path,
            home_dir: built_in_state.home_dir,
            state_dir: built_in_state.state_dir,
            workspace_dir: built_in_state.workspace_dir,
            config_path: built_in_state.config_path,
            gateway_port: built_in_state.gateway_port,
            gateway_auth_token: built_in_state.gateway_auth_token,
        })
    }

    pub fn refresh_configured_runtime(
        &self,
        paths: &AppPaths,
        runtime: &ActivatedOpenClawRuntime,
    ) -> Result<ActivatedOpenClawRuntime> {
        if !runtime.node_path.exists()
            || !runtime.cli_path.exists()
            || !runtime.runtime_dir.exists()
        {
            return Err(FrameworkError::NotFound(format!(
                "configured openclaw runtime is incomplete under {}",
                runtime.install_dir.display()
            )));
        }

        let available_channel_ids = collect_openclaw_runtime_channel_ids(&runtime.runtime_dir)?;
        let built_in_state =
            ensure_built_in_openclaw_state(paths, None, Some(&available_channel_ids))?;

        Ok(ActivatedOpenClawRuntime {
            install_key: runtime.install_key.clone(),
            install_dir: runtime.install_dir.clone(),
            runtime_dir: runtime.runtime_dir.clone(),
            node_path: runtime.node_path.clone(),
            cli_path: runtime.cli_path.clone(),
            home_dir: built_in_state.home_dir,
            state_dir: built_in_state.state_dir,
            workspace_dir: built_in_state.workspace_dir,
            config_path: built_in_state.config_path,
            gateway_port: built_in_state.gateway_port,
            gateway_auth_token: built_in_state.gateway_auth_token,
        })
    }
}

pub(crate) fn resolve_bundled_resource_root(resource_dir: &Path) -> Result<PathBuf> {
    resolve_bundled_resource_root_with_manifest_dir(
        resource_dir,
        Path::new(env!("CARGO_MANIFEST_DIR")),
    )
}

fn resolve_bundled_resource_root_with_manifest_dir(
    resource_dir: &Path,
    manifest_dir: &Path,
) -> Result<PathBuf> {
    let candidates = [
        resource_dir.join(BUNDLED_RESOURCE_DIR),
        resource_dir.join(NESTED_BUNDLED_RESOURCE_DIR),
        manifest_dir.join("resources").join(BUNDLED_RESOURCE_DIR),
    ];

    for candidate in candidates.iter() {
        if candidate.exists() {
            return Ok(candidate.to_path_buf());
        }
    }

    let candidate_paths = candidates
        .iter()
        .map(|candidate| candidate.display().to_string())
        .collect::<Vec<_>>()
        .join(", ");

    Err(FrameworkError::NotFound(format!(
        "packaged OpenClaw runtime resources not found under any of: {candidate_paths}"
    )))
}

fn ensure_runtime_installation_from_directory(
    bundled_runtime_dir: &Path,
    bundled_manifest_path: &Path,
    manifest: &BundledOpenClawManifest,
    install_dir: &Path,
    runtime_dir: &Path,
) -> Result<()> {
    if resolve_launch_runtime_install_dir(install_dir, manifest)?.is_some() {
        return Ok(());
    }

    let staging_dir = staged_runtime_install_dir(install_dir, unix_timestamp_ms()?);
    if staging_dir.exists() {
        fs::remove_dir_all(&staging_dir)?;
    }

    fs::create_dir_all(&staging_dir)?;
    copy_directory_recursive(bundled_runtime_dir, &staging_dir.join("runtime"))?;
    fs::copy(bundled_manifest_path, staging_dir.join("manifest.json"))?;
    validate_materialized_runtime_installation(
        &staging_dir,
        manifest,
        "packaged OpenClaw runtime directory payload",
    )?;

    if let Some(parent) = install_dir.parent() {
        fs::create_dir_all(parent)?;
    }

    if install_dir.exists() {
        fs::remove_dir_all(install_dir).map_err(|error| {
            FrameworkError::Internal(format!(
                "failed to replace existing packaged OpenClaw install root {}: {error}",
                install_dir.display()
            ))
        })?;
    }

    finalize_runtime_install_dir(&staging_dir, install_dir)?;

    if !runtime_dir.exists() {
        return Err(FrameworkError::Internal(format!(
            "failed to finalize packaged OpenClaw runtime installation at {}",
            install_dir.display()
        )));
    }

    Ok(())
}

fn ensure_runtime_installation_from_archive(
    bundled_runtime_archive_path: &Path,
    bundled_manifest_path: &Path,
    manifest: &BundledOpenClawManifest,
    install_dir: &Path,
    runtime_dir: &Path,
) -> Result<()> {
    if resolve_launch_runtime_install_dir(install_dir, manifest)?.is_some() {
        return Ok(());
    }

    let staging_dir = staged_runtime_install_dir(install_dir, unix_timestamp_ms()?);
    if staging_dir.exists() {
        fs::remove_dir_all(&staging_dir)?;
    }

    fs::create_dir_all(&staging_dir)?;
    extract_bundled_runtime_archive(bundled_runtime_archive_path, &staging_dir)?;
    if !staging_dir.join("runtime").exists() {
        return Err(FrameworkError::ValidationFailed(format!(
            "packaged OpenClaw runtime archive did not materialize a runtime directory under {}",
            staging_dir.display()
        )));
    }
    fs::copy(bundled_manifest_path, staging_dir.join("manifest.json"))?;
    validate_materialized_runtime_installation(
        &staging_dir,
        manifest,
        "packaged OpenClaw runtime archive payload",
    )?;

    if let Some(parent) = install_dir.parent() {
        fs::create_dir_all(parent)?;
    }

    if install_dir.exists() {
        fs::remove_dir_all(install_dir).map_err(|error| {
            FrameworkError::Internal(format!(
                "failed to replace existing packaged OpenClaw install root {}: {error}",
                install_dir.display()
            ))
        })?;
    }

    finalize_runtime_install_dir(&staging_dir, install_dir)?;

    if !runtime_dir.exists() {
        return Err(FrameworkError::Internal(format!(
            "failed to finalize packaged OpenClaw runtime installation at {}",
            install_dir.display()
        )));
    }

    Ok(())
}

fn runtime_install_root_is_complete(
    install_dir: &Path,
    manifest: &BundledOpenClawManifest,
) -> bool {
    let manifest_path = install_dir.join("manifest.json");
    let runtime_dir = install_dir.join("runtime");
    let cli_path = install_dir.join(&manifest.cli_relative_path);
    install_dir.exists()
        && manifest_path.exists()
        && cli_path.exists()
        && resolve_external_node_path().is_ok()
        && manifest_file_matches(&manifest_path, manifest)
        && matches!(
            runtime_sidecar_manifest_validation(&runtime_dir, manifest),
            RuntimeSidecarValidation::Match
        )
}

fn staged_runtime_install_dir(install_dir: &Path, timestamp_ms: u128) -> PathBuf {
    let parent = install_dir
        .parent()
        .map(Path::to_path_buf)
        .unwrap_or_else(|| PathBuf::from("."));
    let install_name = install_dir
        .file_name()
        .map(|value| value.to_string_lossy().into_owned())
        .filter(|value| !value.trim().is_empty())
        .unwrap_or_else(|| OPENCLAW_RUNTIME_ID.to_string());
    parent.join(format!("{install_name}.staging-{timestamp_ms}"))
}

fn matching_staged_runtime_install_dirs(
    install_dir: &Path,
    manifest: &BundledOpenClawManifest,
) -> Result<Vec<PathBuf>> {
    let Some(parent) = install_dir.parent() else {
        return Ok(Vec::new());
    };
    if !parent.exists() {
        return Ok(Vec::new());
    }

    let prefix = format!("{}.staging-", manifest.install_key());
    let mut candidates = fs::read_dir(parent)?
        .filter_map(|entry| entry.ok())
        .filter(|entry| entry.file_type().is_ok_and(|file_type| file_type.is_dir()))
        .map(|entry| entry.path())
        .filter(|path| {
            path.file_name()
                .map(|value| value.to_string_lossy().starts_with(&prefix))
                .unwrap_or(false)
        })
        .filter(|path| runtime_install_root_is_complete(path, manifest))
        .collect::<Vec<_>>();
    candidates.sort_by_key(|path| {
        fs::metadata(path)
            .and_then(|metadata| metadata.modified())
            .ok()
    });
    candidates.reverse();
    Ok(candidates)
}

fn resolve_launch_runtime_install_dir(
    install_dir: &Path,
    manifest: &BundledOpenClawManifest,
) -> Result<Option<PathBuf>> {
    if runtime_install_root_is_complete(install_dir, manifest) {
        return Ok(Some(install_dir.to_path_buf()));
    }

    let mut staged_candidates = matching_staged_runtime_install_dirs(install_dir, manifest)?;
    let Some(candidate) = staged_candidates.drain(..).next() else {
        return Ok(None);
    };

    if install_dir.exists() {
        return Err(FrameworkError::Internal(format!(
            "failed to finalize packaged OpenClaw install root {} because a blocking path still exists; staged runtime candidate remains at {}",
            install_dir.display(),
            candidate.display()
        )));
    }

    finalize_runtime_install_dir(&candidate, install_dir)?;

    if runtime_install_root_is_complete(install_dir, manifest) {
        return Ok(Some(install_dir.to_path_buf()));
    }

    Err(FrameworkError::Internal(format!(
        "packaged OpenClaw runtime staged candidate {} did not materialize a complete install root at {}",
        candidate.display(),
        install_dir.display()
    )))
}

fn validate_materialized_runtime_installation(
    install_root: &Path,
    manifest: &BundledOpenClawManifest,
    context_label: &str,
) -> Result<()> {
    let runtime_dir = install_root.join("runtime");
    let manifest_path = install_root.join("manifest.json");
    let cli_path = install_root.join(&manifest.cli_relative_path);

    if !runtime_dir.exists() {
        return Err(FrameworkError::ValidationFailed(format!(
            "{context_label} did not materialize a runtime directory under {}",
            install_root.display()
        )));
    }

    if !manifest_path.exists() || !manifest_file_matches(&manifest_path, manifest) {
        return Err(FrameworkError::ValidationFailed(format!(
            "{context_label} did not materialize a matching packaged OpenClaw manifest under {}",
            install_root.display()
        )));
    }

    if !cli_path.exists() {
        return Err(FrameworkError::ValidationFailed(format!(
            "{context_label} is missing the packaged OpenClaw CLI entrypoint under {}",
            install_root.display()
        )));
    }

    resolve_external_node_path().map_err(|error| {
        FrameworkError::ValidationFailed(format!(
            "{context_label} could not resolve an external Node.js runtime: {error}"
        ))
    })?;

    match runtime_sidecar_manifest_validation(&runtime_dir, manifest) {
        RuntimeSidecarValidation::Match => Ok(()),
        RuntimeSidecarValidation::Missing => Err(FrameworkError::ValidationFailed(format!(
            "{context_label} is missing the runtime sidecar under {}",
            runtime_dir.display()
        ))),
        RuntimeSidecarValidation::Mismatch => Err(FrameworkError::ValidationFailed(format!(
            "{context_label} runtime sidecar failed integrity validation under {}",
            runtime_dir.display()
        ))),
    }
}

pub(crate) fn validate_installed_openclaw_runtime(
    paths: &AppPaths,
    install_key: &str,
) -> Result<BundledOpenClawManifest> {
    let install_root = paths.openclaw_runtime_dir.join(install_key);
    let manifest = load_manifest(&install_root.join("manifest.json"))?;
    validate_manifest_target(&manifest)?;

    if manifest.runtime_id != OPENCLAW_RUNTIME_ID {
        return Err(FrameworkError::ValidationFailed(format!(
            "unsupported OpenClaw runtime id {} for install key {}",
            manifest.runtime_id, install_key
        )));
    }

    if manifest.install_key() != install_key {
        return Err(FrameworkError::ValidationFailed(format!(
            "OpenClaw runtime install key {} does not match manifest key {}",
            install_key,
            manifest.install_key()
        )));
    }

    validate_materialized_runtime_installation(
        &install_root,
        &manifest,
        "built-in OpenClaw runtime install",
    )?;
    Ok(manifest)
}

fn finalize_runtime_install_dir(source_dir: &Path, target_dir: &Path) -> Result<()> {
    finalize_runtime_install_dir_using(source_dir, target_dir, |source_dir, target_dir| {
        fs::rename(source_dir, target_dir)
    })
}

fn finalize_runtime_install_dir_using<F>(
    source_dir: &Path,
    target_dir: &Path,
    mut rename_fn: F,
) -> Result<()>
where
    F: FnMut(&Path, &Path) -> std::io::Result<()>,
{
    match rename_directory_with_retry_using(source_dir, target_dir, |source_dir, target_dir| {
        rename_fn(source_dir, target_dir)
    }) {
        Ok(()) => Ok(()),
        Err(error) if should_retry_runtime_install_rename(&error) && !target_dir.exists() => {
            copy_directory_recursive(source_dir, target_dir)?;
            fs::remove_dir_all(source_dir).map_err(|remove_error| {
                FrameworkError::Internal(format!(
                    "failed to remove staged packaged OpenClaw install root {} after copy fallback into {}: {remove_error}",
                    source_dir.display(),
                    target_dir.display()
                ))
            })?;
            Ok(())
        }
        Err(error) => Err(FrameworkError::Internal(format!(
            "failed to finalize packaged OpenClaw install root {} from {}: {error}",
            target_dir.display(),
            source_dir.display()
        ))),
    }
}

fn rename_directory_with_retry_using<F>(
    source_dir: &Path,
    target_dir: &Path,
    mut rename_fn: F,
) -> std::io::Result<()>
where
    F: FnMut(&Path, &Path) -> std::io::Result<()>,
{
    const WINDOWS_MAX_RENAME_ATTEMPTS: usize = 120;
    const WINDOWS_RENAME_RETRY_DELAY_MS: u64 = 100;

    let max_attempts = if cfg!(windows) {
        WINDOWS_MAX_RENAME_ATTEMPTS
    } else {
        1
    };

    for attempt in 0..max_attempts {
        match rename_fn(source_dir, target_dir) {
            Ok(()) => return Ok(()),
            Err(error)
                if should_retry_runtime_install_rename(&error) && attempt + 1 < max_attempts =>
            {
                std::thread::sleep(std::time::Duration::from_millis(
                    WINDOWS_RENAME_RETRY_DELAY_MS,
                ));
            }
            Err(error) => return Err(error),
        }
    }

    Ok(())
}

fn should_retry_runtime_install_rename(error: &std::io::Error) -> bool {
    cfg!(windows)
        && (error.kind() == std::io::ErrorKind::PermissionDenied
            || matches!(error.raw_os_error(), Some(5 | 32)))
}

fn manifest_file_matches(path: &Path, expected: &BundledOpenClawManifest) -> bool {
    fs::read_to_string(path)
        .ok()
        .and_then(|content| serde_json::from_str::<BundledOpenClawManifest>(&content).ok())
        .is_some_and(|manifest| manifest == *expected)
}

fn resolve_runtime_sidecar_manifest_path(runtime_dir: impl AsRef<Path>) -> PathBuf {
    runtime_dir
        .as_ref()
        .join(PREPARED_RUNTIME_SIDECAR_MANIFEST_FILE_NAME)
}

fn runtime_sidecar_manifest_validation(
    runtime_dir: impl AsRef<Path>,
    expected: &BundledOpenClawManifest,
) -> RuntimeSidecarValidation {
    let runtime_dir = runtime_dir.as_ref();
    let sidecar_path = resolve_runtime_sidecar_manifest_path(runtime_dir);
    if !sidecar_path.exists() {
        return RuntimeSidecarValidation::Missing;
    }

    fs::read_to_string(sidecar_path)
        .ok()
        .and_then(|content| {
            serde_json::from_str::<PreparedOpenClawRuntimeSidecarManifest>(&content).ok()
        })
        .map_or(RuntimeSidecarValidation::Mismatch, |sidecar_manifest| {
            if sidecar_manifest.manifest == *expected
                && runtime_integrity_manifest_matches(
                    runtime_dir,
                    expected,
                    sidecar_manifest.runtime_integrity.as_ref(),
                )
            {
                RuntimeSidecarValidation::Match
            } else {
                RuntimeSidecarValidation::Mismatch
            }
        })
}

fn runtime_integrity_manifest_matches(
    runtime_dir: &Path,
    _manifest: &BundledOpenClawManifest,
    runtime_integrity: Option<&PreparedOpenClawRuntimeIntegrityManifest>,
) -> bool {
    let Some(runtime_integrity) = runtime_integrity else {
        return false;
    };

    if runtime_integrity.schema_version != 1 || runtime_integrity.files.is_empty() {
        return false;
    }
    let mut matched_entries = 0usize;

    for entry in runtime_integrity.files.iter() {
        if !runtime_integrity_file_matches(runtime_dir, entry) {
            return false;
        }
        matched_entries += 1;
    }

    matched_entries > 0
}

fn runtime_integrity_file_matches(
    runtime_dir: &Path,
    entry: &PreparedOpenClawRuntimeIntegrityFile,
) -> bool {
    let relative_path = PathBuf::from(&entry.relative_path);
    if relative_path.as_os_str().is_empty() || relative_path.is_absolute() {
        return false;
    }
    if relative_path.components().any(|component| {
        matches!(
            component,
            std::path::Component::ParentDir
                | std::path::Component::Prefix(_)
                | std::path::Component::RootDir
        )
    }) {
        return false;
    }

    let absolute_path = runtime_dir.join(&relative_path);
    let metadata = match fs::metadata(&absolute_path) {
        Ok(metadata) => metadata,
        Err(_) => return false,
    };
    if !metadata.is_file() || metadata.len() != entry.size {
        return false;
    }

    sha256_file_hex(&absolute_path).is_ok_and(|digest| digest.eq_ignore_ascii_case(&entry.sha256))
}

fn sha256_file_hex(path: &Path) -> Result<String> {
    let mut file = fs::File::open(path)?;
    let mut hasher = Sha256::new();
    let mut buffer = [0_u8; 8192];

    loop {
        let bytes_read = file.read(&mut buffer)?;
        if bytes_read == 0 {
            break;
        }
        hasher.update(&buffer[..bytes_read]);
    }

    let digest = hasher.finalize();
    Ok(digest
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect::<String>())
}

fn extract_bundled_runtime_archive(archive_path: &Path, destination_dir: &Path) -> Result<()> {
    let archive_file = fs::File::open(archive_path)?;
    let mut archive = ZipArchive::new(archive_file).map_err(map_zip_error)?;

    for index in 0..archive.len() {
        let mut entry = archive.by_index(index).map_err(map_zip_error)?;
        let relative_path = entry
            .enclosed_name()
            .map(Path::to_path_buf)
            .ok_or_else(|| {
                FrameworkError::ValidationFailed(format!(
                    "packaged OpenClaw runtime archive contains an unsafe entry at index {index}"
                ))
            })?;
        let destination_path = destination_dir.join(&relative_path);

        if entry.is_dir() {
            fs::create_dir_all(&destination_path).map_err(|error| {
                FrameworkError::Internal(format!(
                    "failed to create packaged OpenClaw runtime archive directory {} from entry {}: {error}",
                    destination_path.display(),
                    relative_path.display()
                ))
            })?;
            continue;
        }

        if let Some(parent) = destination_path.parent() {
            fs::create_dir_all(parent).map_err(|error| {
                FrameworkError::Internal(format!(
                    "failed to create packaged OpenClaw runtime archive parent {} for entry {}: {error}",
                    parent.display(),
                    relative_path.display()
                ))
            })?;
        }

        let mut output_file = fs::File::create(&destination_path).map_err(|error| {
            FrameworkError::Internal(format!(
                "failed to create packaged OpenClaw runtime archive file {} from entry {}: {error}",
                destination_path.display(),
                relative_path.display()
            ))
        })?;
        io::copy(&mut entry, &mut output_file).map_err(|error| {
            FrameworkError::Internal(format!(
                "failed to extract packaged OpenClaw runtime archive entry {} to {}: {error}",
                relative_path.display(),
                destination_path.display()
            ))
        })?;
        apply_zip_entry_permissions(&destination_path, entry.unix_mode()).map_err(|error| {
            FrameworkError::Internal(format!(
                "failed to apply packaged OpenClaw runtime archive permissions to {} from entry {}: {error}",
                destination_path.display(),
                relative_path.display()
            ))
        })?;
    }

    Ok(())
}

fn map_zip_error(error: zip::result::ZipError) -> FrameworkError {
    FrameworkError::Internal(format!("packaged OpenClaw runtime archive error: {error}"))
}

#[cfg(unix)]
fn apply_zip_entry_permissions(destination_path: &Path, unix_mode: Option<u32>) -> Result<()> {
    use std::os::unix::fs::PermissionsExt;

    let Some(unix_mode) = unix_mode else {
        return Ok(());
    };

    let mut permissions = fs::metadata(destination_path)?.permissions();
    permissions.set_mode(unix_mode);
    fs::set_permissions(destination_path, permissions)?;
    Ok(())
}

#[cfg(not(unix))]
fn apply_zip_entry_permissions(_destination_path: &Path, _unix_mode: Option<u32>) -> Result<()> {
    Ok(())
}

fn ensure_built_in_openclaw_state(
    paths: &AppPaths,
    bundled_openclaw_version: Option<&str>,
    available_channel_ids: Option<&BTreeSet<String>>,
) -> Result<BuiltInOpenClawState> {
    let openclaw_paths = paths.kernel_paths(OPENCLAW_RUNTIME_ID)?;

    fs::create_dir_all(&openclaw_paths.state_dir)?;
    fs::create_dir_all(&openclaw_paths.workspace_dir)?;
    fs::create_dir_all(openclaw_paths.openclaw_workspace_memory_dir()?)?;
    fs::create_dir_all(openclaw_paths.openclaw_workspace_skills_dir()?)?;
    fs::create_dir_all(openclaw_paths.openclaw_workspace_extensions_dir()?)?;
    fs::create_dir_all(openclaw_paths.openclaw_agents_dir()?)?;
    fs::create_dir_all(openclaw_paths.openclaw_agent_dir(OPENCLAW_DEFAULT_AGENT_ID)?)?;
    fs::create_dir_all(openclaw_paths.openclaw_agent_sessions_dir(OPENCLAW_DEFAULT_AGENT_ID)?)?;
    fs::create_dir_all(openclaw_paths.openclaw_skills_dir()?)?;
    fs::create_dir_all(openclaw_paths.openclaw_extensions_dir()?)?;
    fs::create_dir_all(openclaw_paths.openclaw_cron_dir()?)?;
    fs::create_dir_all(openclaw_paths.openclaw_credentials_dir()?)?;
    let authority = KernelRuntimeAuthorityService::new();
    let config_file_path = authority.active_config_file_path("openclaw", paths)?;
    let imported_config = authority.import_or_default_openclaw_config(paths, &config_file_path)?;

    let mut config = imported_config.root;
    sanitize_legacy_provider_runtime_config(&mut config);
    if let Some(available_channel_ids) = available_channel_ids {
        sanitize_openclaw_channel_config(&mut config, available_channel_ids);
    }
    set_nested_string(&mut config, &["gateway", "mode"], "local")?;
    set_nested_string(&mut config, &["gateway", "bind"], "loopback")?;
    let configured_port = get_nested_u16(&config, &["gateway", "port"]).filter(|port| *port > 0);
    let requested_port =
        resolve_requested_managed_gateway_port(configured_port, bundled_openclaw_version);
    let gateway_port = allocate_gateway_port(requested_port)?;
    let gateway_auth_token = get_nested_string(&config, &["gateway", "auth", "token"])
        .filter(|value| !value.trim().is_empty())
        .unwrap_or_else(generate_gateway_auth_token);
    set_nested_u16(&mut config, &["gateway", "port"], gateway_port)?;
    set_nested_string(&mut config, &["gateway", "auth", "mode"], "token")?;
    set_nested_string(
        &mut config,
        &["gateway", "auth", "token"],
        gateway_auth_token.as_str(),
    )?;
    ensure_managed_control_ui_allowed_origins(&mut config)?;
    ensure_nested_string_array_contains(&mut config, &["gateway", "tools", "allow"], "cron")?;
    ensure_built_in_main_agent_paths(&mut config, &openclaw_paths)?;
    remove_nested_key(&mut config, &["meta", "lastTouchedVersion"]);
    remove_nested_key(&mut config, &["meta", "lastTouchedAt"]);

    fs::write(
        &config_file_path,
        format!("{}\n", serde_json::to_string_pretty(&config)?),
    )?;
    authority.record_config_migration(
        "openclaw",
        paths,
        imported_config.source_path.as_deref(),
        imported_config.quarantined_path.as_deref(),
        &config_file_path,
    )?;

    Ok(BuiltInOpenClawState {
        home_dir: openclaw_paths.home_dir,
        state_dir: openclaw_paths.state_dir,
        workspace_dir: openclaw_paths.workspace_dir,
        config_path: config_file_path,
        gateway_port,
        gateway_auth_token,
    })
}

fn resolve_requested_managed_gateway_port(
    configured_port: Option<u16>,
    bundled_openclaw_version: Option<&str>,
) -> u16 {
    if bundled_openclaw_version.is_some() {
        return DEFAULT_GATEWAY_PORT;
    }

    configured_port.unwrap_or(DEFAULT_GATEWAY_PORT)
}

fn resolve_external_node_path() -> Result<PathBuf> {
    if let Some(override_value) = env::var_os(OPENCLAW_NODE_PATH_OVERRIDE_ENV) {
        let override_path = PathBuf::from(&override_value);
        if override_path.as_os_str().is_empty() {
            return Err(FrameworkError::ValidationFailed(format!(
                "{OPENCLAW_NODE_PATH_OVERRIDE_ENV} must not be empty"
            )));
        }
        if override_path.exists() {
            return Ok(override_path);
        }
        return Err(FrameworkError::NotFound(format!(
            "external Node.js executable configured via {OPENCLAW_NODE_PATH_OVERRIDE_ENV} was not found at {}",
            override_path.display()
        )));
    }

    let executable_name = if cfg!(windows) { "node.exe" } else { "node" };
    let path_entries = env::var_os("PATH").ok_or_else(|| {
        FrameworkError::NotFound(format!(
            "external Node.js executable not found; install Node.js and expose it on PATH or set {OPENCLAW_NODE_PATH_OVERRIDE_ENV}"
        ))
    })?;

    env::split_paths(&path_entries)
        .map(|entry| entry.join(executable_name))
        .find(|candidate| candidate.exists())
        .ok_or_else(|| {
            FrameworkError::NotFound(format!(
                "external Node.js executable not found on PATH; install Node.js or set {OPENCLAW_NODE_PATH_OVERRIDE_ENV}"
            ))
        })
}

fn sanitize_legacy_provider_runtime_config(config: &mut Value) {
    let Some(models_root) = config.get_mut("models").and_then(Value::as_object_mut) else {
        return;
    };
    let Some(providers_root) = models_root
        .get_mut("providers")
        .and_then(Value::as_object_mut)
    else {
        return;
    };

    for provider in providers_root.values_mut() {
        let Some(provider_root) = provider.as_object_mut() else {
            continue;
        };

        for key in LEGACY_PROVIDER_RUNTIME_CONFIG_KEYS {
            provider_root.remove(key);
        }
    }
}

pub(crate) fn collect_openclaw_runtime_channel_ids(runtime_dir: &Path) -> Result<BTreeSet<String>> {
    let extensions_dir = runtime_dir
        .join("package")
        .join("node_modules")
        .join("openclaw")
        .join("dist")
        .join("extensions");

    if !extensions_dir.is_dir() {
        return Err(FrameworkError::NotFound(format!(
            "packaged OpenClaw runtime channel metadata not found at {}",
            extensions_dir.display()
        )));
    }

    let mut channel_ids = BTreeSet::new();
    collect_openclaw_extension_channel_ids(&extensions_dir, &mut channel_ids)?;
    if channel_ids.is_empty() {
        return Err(FrameworkError::ValidationFailed(format!(
            "packaged OpenClaw runtime channel metadata is empty under {}",
            extensions_dir.display()
        )));
    }

    Ok(channel_ids)
}

fn collect_openclaw_extension_channel_ids(
    directory: &Path,
    channel_ids: &mut BTreeSet<String>,
) -> Result<()> {
    for entry in fs::read_dir(directory)? {
        let entry = entry?;
        let entry_path = entry.path();
        if !entry.file_type()?.is_dir() {
            continue;
        }

        collect_openclaw_extension_channel_id(&entry_path, channel_ids)?;
    }

    Ok(())
}

fn collect_openclaw_extension_channel_id(
    extension_dir: &Path,
    channel_ids: &mut BTreeSet<String>,
) -> Result<()> {
    let package_json_path = extension_dir.join("package.json");
    if package_json_path.exists() {
        let raw = fs::read_to_string(&package_json_path)?;
        let parsed = serde_json::from_str::<Value>(&raw).map_err(|error| {
            FrameworkError::ValidationFailed(format!(
                "invalid OpenClaw extension package metadata at {}: {error}",
                package_json_path.display()
            ))
        })?;

        collect_openclaw_package_json_channel_ids(&parsed, channel_ids);
    }

    let plugin_json_path = extension_dir.join("openclaw.plugin.json");
    if plugin_json_path.exists() {
        let raw = fs::read_to_string(&plugin_json_path)?;
        let parsed = serde_json::from_str::<Value>(&raw).map_err(|error| {
            FrameworkError::ValidationFailed(format!(
                "invalid OpenClaw plugin metadata at {}: {error}",
                plugin_json_path.display()
            ))
        })?;

        collect_openclaw_plugin_json_channel_ids(&parsed, channel_ids);
    }

    let node_modules_dir = extension_dir.join("node_modules");
    if node_modules_dir.exists() {
        collect_openclaw_extension_channel_ids(&node_modules_dir, channel_ids)?;
    }

    Ok(())
}

fn collect_openclaw_package_json_channel_ids(parsed: &Value, channel_ids: &mut BTreeSet<String>) {
    if let Some(channel_id) = get_nested_string(parsed, &["openclaw", "channel", "id"])
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
    {
        channel_ids.insert(channel_id);
    }
}

fn collect_openclaw_plugin_json_channel_ids(parsed: &Value, channel_ids: &mut BTreeSet<String>) {
    if let Some(channels) = parsed.get("channels").and_then(Value::as_array) {
        for channel_id in channels {
            if let Some(channel_id) = channel_id
                .as_str()
                .map(str::trim)
                .filter(|channel_id| !channel_id.is_empty())
            {
                channel_ids.insert(channel_id.to_string());
            }
        }
    }

    if let Some(channel_configs) = parsed.get("channelConfigs").and_then(Value::as_object) {
        for channel_id in channel_configs.keys() {
            let channel_id = channel_id.trim();
            if !channel_id.is_empty() {
                channel_ids.insert(channel_id.to_string());
            }
        }
    }
}

fn ensure_managed_control_ui_allowed_origins(config: &mut Value) -> Result<()> {
    for origin in TAURI_CONTROL_UI_ALLOWED_ORIGINS {
        ensure_nested_string_array_contains(
            config,
            &["gateway", "controlUi", "allowedOrigins"],
            origin,
        )?;
    }
    Ok(())
}

fn ensure_built_in_main_agent_paths(
    config: &mut Value,
    openclaw_paths: &KernelPaths,
) -> Result<()> {
    remove_nested_key(config, &["agents", "defaults", "workspace"]);
    remove_nested_key(config, &["agents", "defaults", "agentDir"]);

    if !config.is_object() {
        *config = Value::Object(Map::new());
    }

    let root = ensure_json_object_mut(config, "openclaw config root")?;
    let agents_root = root
        .entry("agents".to_string())
        .or_insert_with(|| Value::Object(Map::new()));
    let agents_root = ensure_json_object_mut(agents_root, "openclaw agents root")?;
    if agents_root
        .get("defaults")
        .and_then(Value::as_object)
        .is_some_and(|object| object.is_empty())
    {
        agents_root.remove("defaults");
    }
    let list = agents_root
        .entry("list".to_string())
        .or_insert_with(|| Value::Array(Vec::new()));

    let list = ensure_json_array_mut(list, "openclaw agents list")?;
    let main_index = list.iter().position(|entry| {
        entry
            .get("id")
            .and_then(Value::as_str)
            .is_some_and(|id| id.trim().eq_ignore_ascii_case(OPENCLAW_DEFAULT_AGENT_ID))
    });
    let main_index = match main_index {
        Some(index) => index,
        None => {
            let mut main = Map::new();
            main.insert(
                "id".to_string(),
                Value::String(OPENCLAW_DEFAULT_AGENT_ID.to_string()),
            );
            main.insert("name".to_string(), Value::String("Main".to_string()));
            list.push(Value::Object(main));
            list.len() - 1
        }
    };

    {
        let main = ensure_json_object_mut(&mut list[main_index], "openclaw main agent")?;
        main.insert(
            "id".to_string(),
            Value::String(OPENCLAW_DEFAULT_AGENT_ID.to_string()),
        );
        if main
            .get("name")
            .and_then(Value::as_str)
            .is_none_or(|name| name.trim().is_empty())
        {
            main.insert("name".to_string(), Value::String("Main".to_string()));
        }
        main.insert(
            "workspace".to_string(),
            Value::String(
                openclaw_paths
                    .openclaw_agent_workspace_dir(OPENCLAW_DEFAULT_AGENT_ID)?
                    .to_string_lossy()
                    .into_owned(),
            ),
        );
        main.insert(
            "agentDir".to_string(),
            Value::String(
                openclaw_paths
                    .openclaw_agent_dir(OPENCLAW_DEFAULT_AGENT_ID)?
                    .to_string_lossy()
                    .into_owned(),
            ),
        );
    }

    for (index, entry) in list.iter_mut().enumerate() {
        let Some(agent) = entry.as_object_mut() else {
            continue;
        };
        agent.insert("default".to_string(), Value::Bool(index == main_index));
    }

    Ok(())
}

pub(crate) fn load_manifest(path: &Path) -> Result<BundledOpenClawManifest> {
    let content = fs::read_to_string(path)?;
    serde_json::from_str::<BundledOpenClawManifest>(&content).map_err(Into::into)
}

fn validate_manifest_target(manifest: &BundledOpenClawManifest) -> Result<()> {
    let expected_platform = normalized_target_platform();
    let expected_arch = normalized_target_arch();

    if manifest.platform != expected_platform || manifest.arch != expected_arch {
        return Err(FrameworkError::ValidationFailed(format!(
            "packaged OpenClaw runtime target mismatch: expected {expected_platform}-{expected_arch}, received {}-{}",
            manifest.platform, manifest.arch
        )));
    }

    if !manifest.requires_external_node_runtime() {
        return Err(FrameworkError::ValidationFailed(
            "packaged OpenClaw runtime manifest must require an external Node.js runtime"
                .to_string(),
        ));
    }

    Ok(())
}

fn normalized_target_platform() -> &'static str {
    match platform::current_target() {
        "windows" => "windows",
        "macos" => "macos",
        "linux" => "linux",
        other => other,
    }
}

fn normalized_target_arch() -> &'static str {
    match platform::current_arch() {
        "x86_64" => "x64",
        "aarch64" => "arm64",
        other => other,
    }
}

fn copy_directory_recursive(source: &Path, target: &Path) -> Result<()> {
    fs::create_dir_all(target)?;

    for entry in fs::read_dir(source)? {
        let entry = entry?;
        let entry_path = entry.path();
        let target_path = target.join(entry.file_name());

        if entry.file_type()?.is_dir() {
            copy_directory_recursive(&entry_path, &target_path)?;
        } else {
            if let Some(parent) = target_path.parent() {
                fs::create_dir_all(parent)?;
            }
            fs::copy(entry_path, target_path)?;
        }
    }

    Ok(())
}

fn set_nested_string(value: &mut Value, path: &[&str], next: &str) -> Result<()> {
    set_nested_value(value, path, Value::String(next.to_string()))
}

fn set_nested_u16(value: &mut Value, path: &[&str], next: u16) -> Result<()> {
    set_nested_value(value, path, Value::Number(Number::from(next)))
}

fn ensure_nested_string_array_contains(value: &mut Value, path: &[&str], item: &str) -> Result<()> {
    if path.is_empty() {
        return Err(FrameworkError::ValidationFailed(
            "nested string array path must not be empty".to_string(),
        ));
    }

    let mut current = value;
    for segment in &path[..path.len() - 1] {
        let object = ensure_json_object_mut(current, "nested config object")?;
        current = object
            .entry((*segment).to_string())
            .or_insert_with(|| Value::Object(Map::new()));
    }

    let entry = ensure_json_object_mut(current, "nested config object")?
        .entry(path[path.len() - 1].to_string())
        .or_insert_with(|| Value::Array(Vec::new()));

    let items = ensure_json_array_mut(entry, "nested config array")?;
    if items.iter().any(|value| value.as_str() == Some(item)) {
        return Ok(());
    }

    items.push(Value::String(item.to_string()));
    Ok(())
}

fn set_nested_value(value: &mut Value, path: &[&str], next: Value) -> Result<()> {
    if path.is_empty() {
        *value = next;
        return Ok(());
    }

    let mut current = value;
    for segment in &path[..path.len() - 1] {
        let object = ensure_json_object_mut(current, "nested config object")?;
        current = object
            .entry((*segment).to_string())
            .or_insert_with(|| Value::Object(Map::new()));
    }

    ensure_json_object_mut(current, "nested config object")?
        .insert(path[path.len() - 1].to_string(), next);
    Ok(())
}

fn ensure_json_object_mut<'a>(
    value: &'a mut Value,
    label: &str,
) -> Result<&'a mut Map<String, Value>> {
    if !value.is_object() {
        *value = Value::Object(Map::new());
    }

    value.as_object_mut().ok_or_else(|| {
        FrameworkError::Internal(format!("{label} must be a JSON object after normalization"))
    })
}

fn ensure_json_array_mut<'a>(value: &'a mut Value, label: &str) -> Result<&'a mut Vec<Value>> {
    if !value.is_array() {
        *value = Value::Array(Vec::new());
    }

    value.as_array_mut().ok_or_else(|| {
        FrameworkError::Internal(format!("{label} must be a JSON array after normalization"))
    })
}

fn remove_nested_key(value: &mut Value, path: &[&str]) {
    if path.is_empty() {
        return;
    }

    let Some(root) = value.as_object_mut() else {
        return;
    };

    if path.len() == 1 {
        root.remove(path[0]);
        return;
    }

    let Some(next) = root.get_mut(path[0]) else {
        return;
    };

    remove_nested_key(next, &path[1..]);
}

fn get_nested_u16(value: &Value, path: &[&str]) -> Option<u16> {
    let mut current = value;
    for segment in path {
        current = current.as_object()?.get(*segment)?;
    }
    current
        .as_u64()
        .and_then(|number| u16::try_from(number).ok())
}

fn get_nested_string(value: &Value, path: &[&str]) -> Option<String> {
    let mut current = value;
    for segment in path {
        current = current.as_object()?.get(*segment)?;
    }

    current.as_str().map(|item| item.to_string())
}

fn generate_gateway_auth_token() -> String {
    Uuid::new_v4().simple().to_string()
}

fn unix_timestamp_ms() -> Result<u128> {
    Ok(SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|error| FrameworkError::Internal(error.to_string()))?
        .as_millis())
}

fn allocate_gateway_port(requested_port: u16) -> Result<u16> {
    let allocation = allocate_tcp_listener(PortAllocationRequest {
        bind_host: "127.0.0.1".to_string(),
        requested_port,
        fallback_range: Some(PortRange::new(
            managed_gateway_fallback_port_range_start(requested_port),
            managed_gateway_fallback_port_range_end(requested_port),
        )),
        allow_ephemeral_fallback: true,
    })
    .map_err(FrameworkError::Conflict)?;

    let active_port = allocation.active_port;
    drop(allocation.into_listener());
    Ok(active_port)
}

#[cfg(test)] // WORKSPACE-PATH:allow-fixture-block: this module is the file's #[cfg(test)] unit-test fixture data
mod tests {
    use super::{
        collect_openclaw_runtime_channel_ids, copy_directory_recursive, load_manifest,
        normalized_target_arch, normalized_target_platform, rename_directory_with_retry_using,
        resolve_bundled_resource_root, resolve_bundled_resource_root_with_manifest_dir,
        resolve_runtime_sidecar_manifest_path, sha256_file_hex, staged_runtime_install_dir,
        BundledOpenClawManifest, OpenClawRuntimeService, PreparedOpenClawRuntimeIntegrityFile,
        PreparedOpenClawRuntimeIntegrityManifest, PreparedOpenClawRuntimeSidecarManifest,
        BUNDLED_RUNTIME_ARCHIVE_FILE_NAME, DEFAULT_GATEWAY_PORT, OPENCLAW_RUNTIME_ID,
        PREPARED_RUNTIME_SIDECAR_MANIFEST_FILE_NAME, TAURI_CONTROL_UI_ALLOWED_ORIGINS,
    };
    use crate::framework::{
        layout::{ActiveState, KernelAuthorityState, KernelMigrationState},
        openclaw_release::required_openclaw_node_version,
        paths::resolve_paths_for_root,
        services::{
            local_ai_proxy::OPENCLAW_LOCAL_PROXY_TOKEN_ENV_VAR,
            local_ai_proxy_snapshot::LOCAL_AI_PROXY_DEFAULT_PORT,
        },
    };
    use serde_json::Value;
    use std::{collections::BTreeSet, env, ffi::OsString, fs, io::Write, sync::MutexGuard};
    use zip::{write::FileOptions, CompressionMethod, ZipWriter};

    const TEST_BUNDLED_OPENCLAW_VERSION: &str = env!("SDKWORK_BUNDLED_OPENCLAW_VERSION");

    #[test]
    fn openclaw_activation_config_normalization_helpers_do_not_panic_in_production() {
        let production_source = include_str!("openclaw_runtime.rs")
            .split("mod tests {")
            .next()
            .expect("production source");
        let config_normalization_source = production_source
            .split("fn ensure_built_in_main_agent_paths")
            .nth(1)
            .and_then(|tail| tail.split("fn remove_nested_key").next())
            .expect("activation config normalization source");

        assert!(
            !config_normalization_source.contains(".expect("),
            "OpenClaw activation config normalization must propagate malformed-shape errors instead of panicking"
        );
    }

    struct ScopedPathGuard {
        _env_lock: MutexGuard<'static, ()>,
        original_path: Option<OsString>,
    }

    impl ScopedPathGuard {
        fn clear() -> Self {
            let env_lock = crate::framework::services::test_support::lock_process_env();
            let original_path = env::var_os("PATH");
            unsafe {
                env::set_var("PATH", "");
            }
            Self {
                _env_lock: env_lock,
                original_path,
            }
        }
    }

    struct ScopedEnvVarGuard {
        key: &'static str,
        original_value: Option<OsString>,
    }

    impl ScopedEnvVarGuard {
        fn set(key: &'static str, value: &std::path::Path) -> Self {
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

    #[cfg(windows)]
    fn resolve_test_node_executable() -> std::path::PathBuf {
        crate::framework::services::test_support::resolve_test_node_executable("runtime tests")
    }

    #[cfg(not(windows))]
    fn resolve_test_node_executable() -> std::path::PathBuf {
        crate::framework::services::test_support::resolve_test_node_executable("runtime tests")
    }

    impl Drop for ScopedPathGuard {
        fn drop(&mut self) {
            unsafe {
                if let Some(original_path) = &self.original_path {
                    env::set_var("PATH", original_path);
                } else {
                    env::remove_var("PATH");
                }
            }
        }
    }

    #[test]
    fn installs_bundled_runtime_into_managed_directory_and_activates_it() {
        let temp = tempfile::tempdir().expect("temp dir");
        let paths = resolve_paths_for_root(temp.path()).expect("paths");
        let resource_root =
            create_bundled_runtime_fixture(temp.path(), TEST_BUNDLED_OPENCLAW_VERSION);
        let service = OpenClawRuntimeService::new();

        let activated = service
            .ensure_bundled_runtime_from_root(&paths, &resource_root)
            .expect("activated runtime");

        let expected_install_key = format!(
            "{}-{}-{}",
            TEST_BUNDLED_OPENCLAW_VERSION,
            normalized_target_platform(),
            normalized_target_arch()
        );

        assert_eq!(activated.install_key, expected_install_key);
        assert!(activated.install_dir.exists());
        assert!(activated.runtime_dir.exists());
        assert!(activated.node_path.exists());
        assert!(activated.cli_path.exists());
        assert_eq!(
            activated.cli_path,
            activated
                .install_dir
                .join("runtime")
                .join("package")
                .join("node_modules")
                .join("openclaw")
                .join("openclaw.mjs")
        );
        assert_eq!(activated.home_dir, paths.user_root);
        assert_eq!(activated.state_dir, paths.openclaw_root_dir);
        assert_eq!(activated.workspace_dir, paths.openclaw_workspace_dir);
        assert_eq!(activated.config_path, paths.openclaw_config_file);
        assert!(activated.gateway_port >= DEFAULT_GATEWAY_PORT);
        assert!(paths
            .openclaw_runtime_dir
            .join(&expected_install_key)
            .join("manifest.json")
            .exists());

        let config = serde_json::from_str::<Value>(
            &fs::read_to_string(&paths.openclaw_config_file).expect("config file"),
        )
        .expect("config json");
        assert_eq!(
            config.pointer("/gateway/mode").and_then(Value::as_str),
            Some("local")
        );
        assert_eq!(
            config.pointer("/gateway/bind").and_then(Value::as_str),
            Some("loopback")
        );
        assert_eq!(
            config
                .pointer("/gateway/http/endpoints/chatCompletions/enabled")
                .and_then(Value::as_bool),
            None
        );
        assert_eq!(
            config
                .pointer("/gateway/http/endpoints/responses/enabled")
                .and_then(Value::as_bool),
            None
        );
        assert_eq!(
            config.pointer("/gateway/auth/mode").and_then(Value::as_str),
            Some("token")
        );
        assert!(config
            .pointer("/gateway/auth/token")
            .and_then(Value::as_str)
            .is_some_and(|token| !token.trim().is_empty()));
        assert_eq!(
            config
                .pointer("/gateway/controlUi/allowedOrigins")
                .and_then(Value::as_array)
                .map(|items| items.iter().filter_map(Value::as_str).collect::<Vec<_>>()),
            Some(TAURI_CONTROL_UI_ALLOWED_ORIGINS.to_vec())
        );
        assert_eq!(
            config
                .pointer("/gateway/tools/allow")
                .and_then(Value::as_array)
                .map(|items| items.iter().filter_map(Value::as_str).collect::<Vec<_>>()),
            Some(vec!["cron"])
        );
        assert_eq!(
            config
                .pointer("/agents/defaults/workspace")
                .and_then(Value::as_str),
            None
        );
        let agents = config
            .pointer("/agents/list")
            .and_then(Value::as_array)
            .expect("agent list");
        let main = agents
            .iter()
            .find(|entry| entry.get("id").and_then(Value::as_str) == Some("main"))
            .expect("main agent entry");
        assert_eq!(main.get("default").and_then(Value::as_bool), Some(true));
        assert_eq!(
            main.get("workspace").and_then(Value::as_str),
            Some(paths.openclaw_workspace_dir.to_string_lossy().as_ref())
        );
        assert_eq!(
            main.get("agentDir").and_then(Value::as_str),
            Some(paths.openclaw_main_agent_dir.to_string_lossy().as_ref())
        );
        assert!(config.pointer("/meta/lastTouchedVersion").is_none());
        assert!(config.pointer("/meta/lastTouchedAt").is_none());

        let active = serde_json::from_str::<ActiveState>(
            &fs::read_to_string(&paths.active_file).expect("active file"),
        )
        .expect("active json");
        assert_eq!(
            active
                .runtimes
                .get(OPENCLAW_RUNTIME_ID)
                .and_then(|entry| entry.active_runtime_install_key()),
            Some(expected_install_key.as_str())
        );
        let openclaw_runtime = active
            .runtimes
            .get(OPENCLAW_RUNTIME_ID)
            .expect("openclaw active runtime");
        assert!(openclaw_runtime.active_version.is_none());
        assert!(openclaw_runtime.fallback_version.is_none());
    }

    #[test]
    fn activation_materializes_main_agent_paths_without_global_workspace_fallback() {
        let temp = tempfile::tempdir().expect("temp dir");
        let paths = resolve_paths_for_root(temp.path()).expect("paths");
        let resource_root =
            create_bundled_runtime_fixture(temp.path(), TEST_BUNDLED_OPENCLAW_VERSION);
        let service = OpenClawRuntimeService::new();

        fs::write(
            &paths.openclaw_config_file,
            r#"{
  "agents": {
    "defaults": {
      "workspace": "legacy-workspace",
      "agentDir": "legacy-agent-dir"
    },
    "list": [
      {
        "id": "research",
        "name": "Research"
      }
    ]
  }
}
"#,
        )
        .expect("seed config file");

        service
            .ensure_bundled_runtime_from_root(&paths, &resource_root)
            .expect("activated runtime");

        let config = serde_json::from_str::<Value>(
            &fs::read_to_string(&paths.openclaw_config_file).expect("config file"),
        )
        .expect("config json");
        assert_eq!(
            config
                .pointer("/agents/defaults/workspace")
                .and_then(Value::as_str),
            None,
            "global workspace fallback would make non-default agents resolve under workspace/<agentId>"
        );
        assert_eq!(
            config
                .pointer("/agents/defaults/agentDir")
                .and_then(Value::as_str),
            None,
            "global agentDir fallback has no role in the built-in OpenClaw directory contract"
        );
        let agents = config
            .pointer("/agents/list")
            .and_then(Value::as_array)
            .expect("agent list");
        let main = agents
            .iter()
            .find(|entry| entry.get("id").and_then(Value::as_str) == Some("main"))
            .expect("main agent entry");
        assert_eq!(main.get("default").and_then(Value::as_bool), Some(true));
        assert_eq!(
            main.get("workspace").and_then(Value::as_str),
            Some(paths.openclaw_workspace_dir.to_string_lossy().as_ref())
        );
        assert_eq!(
            main.get("agentDir").and_then(Value::as_str),
            Some(paths.openclaw_main_agent_dir.to_string_lossy().as_ref())
        );
        let research = agents
            .iter()
            .find(|entry| entry.get("id").and_then(Value::as_str) == Some("research"))
            .expect("research agent entry");
        assert!(research.get("workspace").is_none());
        assert!(research.get("agentDir").is_none());
        assert!(paths
            .openclaw_root_dir
            .join("workspace-research")
            .starts_with(&paths.openclaw_root_dir));
    }

    #[test]
    fn activation_promotes_main_as_single_default_agent_while_pinpointing_paths() {
        let temp = tempfile::tempdir().expect("temp dir");
        let paths = resolve_paths_for_root(temp.path()).expect("paths");
        let resource_root =
            create_bundled_runtime_fixture(temp.path(), TEST_BUNDLED_OPENCLAW_VERSION);
        let service = OpenClawRuntimeService::new();

        fs::write(
            &paths.openclaw_config_file,
            r#"{
  "agents": {
    "defaults": {
      "workspace": "legacy-workspace"
    },
    "list": [
      {
        "id": "research",
        "default": true,
        "name": "Research"
      }
    ]
  }
}
"#,
        )
        .expect("seed config file");

        service
            .ensure_bundled_runtime_from_root(&paths, &resource_root)
            .expect("activated runtime");

        let config = serde_json::from_str::<Value>(
            &fs::read_to_string(&paths.openclaw_config_file).expect("config file"),
        )
        .expect("config json");
        let agents = config
            .pointer("/agents/list")
            .and_then(Value::as_array)
            .expect("agent list");
        let main = agents
            .iter()
            .find(|entry| entry.get("id").and_then(Value::as_str) == Some("main"))
            .expect("main agent entry");
        let research = agents
            .iter()
            .find(|entry| entry.get("id").and_then(Value::as_str) == Some("research"))
            .expect("research agent entry");

        assert_eq!(main.get("default").and_then(Value::as_bool), Some(true));
        assert_ne!(research.get("default").and_then(Value::as_bool), Some(true));
        assert_eq!(
            main.get("workspace").and_then(Value::as_str),
            Some(paths.openclaw_workspace_dir.to_string_lossy().as_ref())
        );
        assert_eq!(
            main.get("agentDir").and_then(Value::as_str),
            Some(paths.openclaw_main_agent_dir.to_string_lossy().as_ref())
        );
        assert!(config.pointer("/meta/lastTouchedVersion").is_none());
        assert!(config.pointer("/meta/lastTouchedAt").is_none());
    }

    #[test]
    fn activation_normalizes_case_variant_main_agent_without_creating_a_duplicate() {
        let temp = tempfile::tempdir().expect("temp dir");
        let paths = resolve_paths_for_root(temp.path()).expect("paths");
        let resource_root =
            create_bundled_runtime_fixture(temp.path(), TEST_BUNDLED_OPENCLAW_VERSION);
        let service = OpenClawRuntimeService::new();

        fs::write(
            &paths.openclaw_config_file,
            r#"{
  "agents": {
    "list": [
      {
        "id": "Main",
        "name": "Primary"
      }
    ]
  }
}
"#,
        )
        .expect("seed config file");

        service
            .ensure_bundled_runtime_from_root(&paths, &resource_root)
            .expect("activated runtime");

        let config = serde_json::from_str::<Value>(
            &fs::read_to_string(&paths.openclaw_config_file).expect("config file"),
        )
        .expect("config json");
        let agents = config
            .pointer("/agents/list")
            .and_then(Value::as_array)
            .expect("agent list");
        let main_entries = agents
            .iter()
            .filter(|entry| entry.get("id").and_then(Value::as_str) == Some("main"))
            .collect::<Vec<_>>();

        assert_eq!(main_entries.len(), 1);
        let main = main_entries[0];
        assert_eq!(main.get("name").and_then(Value::as_str), Some("Primary"));
        assert_eq!(main.get("default").and_then(Value::as_bool), Some(true));
        assert_eq!(
            main.get("workspace").and_then(Value::as_str),
            Some(paths.openclaw_workspace_dir.to_string_lossy().as_ref())
        );
        assert_eq!(
            main.get("agentDir").and_then(Value::as_str),
            Some(paths.openclaw_main_agent_dir.to_string_lossy().as_ref())
        );
    }

    #[test]
    fn bundled_runtime_uses_21280_as_the_canonical_default_gateway_port() {
        assert_eq!(
            DEFAULT_GATEWAY_PORT, 21_280,
            "the bundled OpenClaw runtime should default to the canonical multi-kernel gateway port"
        );
    }

    #[test]
    fn activation_rewrites_a_non_canonical_saved_gateway_port_into_the_default_window() {
        let temp = tempfile::tempdir().expect("temp dir");
        let paths = resolve_paths_for_root(temp.path()).expect("paths");
        let resource_root =
            create_bundled_runtime_fixture(temp.path(), TEST_BUNDLED_OPENCLAW_VERSION);
        let service = OpenClawRuntimeService::new();

        fs::write(
            &paths.openclaw_config_file,
            "{\n  \"gateway\": {\n    \"port\": 18878\n  }\n}\n",
        )
        .expect("seed non-canonical config file");

        let activated = service
            .ensure_bundled_runtime_from_root(&paths, &resource_root)
            .expect("activated runtime");

        assert_ne!(
            activated.gateway_port, 18_878,
            "bundled activation should stop preserving previously generated managed ports"
        );
        assert!(
            activated.gateway_port >= DEFAULT_GATEWAY_PORT
                && activated.gateway_port < DEFAULT_GATEWAY_PORT.saturating_add(32),
            "bundled activation should request the canonical built-in port window even when 21280 itself is already occupied"
        );

        let config = serde_json::from_str::<Value>(
            &fs::read_to_string(&activated.config_path).expect("config file"),
        )
        .expect("config json");
        assert_eq!(
            config.pointer("/gateway/port").and_then(Value::as_u64),
            Some(u64::from(activated.gateway_port))
        );
    }

    #[test]
    fn activation_ignores_stray_sibling_config_and_writes_canonical_openclaw_config() {
        let temp = tempfile::tempdir().expect("temp dir");
        let paths = resolve_paths_for_root(temp.path()).expect("paths");
        let resource_root =
            create_bundled_runtime_fixture(temp.path(), TEST_BUNDLED_OPENCLAW_VERSION);
        let service = OpenClawRuntimeService::new();
        let stray_config_path = paths
            .user_root
            .join("stray-openclaw-root")
            .join(".openclaw")
            .join("openclaw.json");

        fs::create_dir_all(stray_config_path.parent().expect("stray config parent"))
            .expect("stray config dir");
        fs::write(
            &stray_config_path,
            r#"{
  meta: {
    lastTouchedVersion: "__OPENCLAW_VERSION__",
    lastTouchedAt: "2026-04-09T12:00:00Z",
  },
  gateway: {
    port: 18878,
  },
  agents: {
    defaults: {
      workspace: "legacy-workspace",
    },
  },
}
"#
            .replace("__OPENCLAW_VERSION__", TEST_BUNDLED_OPENCLAW_VERSION),
        )
        .expect("seed stray config");

        let activated = service
            .ensure_bundled_runtime_from_root(&paths, &resource_root)
            .expect("activated runtime");

        assert_eq!(activated.config_path, paths.openclaw_config_file);
        assert!(
            stray_config_path.exists(),
            "stray sibling config should not be imported or mutated during activation"
        );

        let quarantined_paths = fs::read_dir(&paths.openclaw_quarantine_dir)
            .expect("quarantine dir")
            .filter_map(|entry| entry.ok())
            .map(|entry| entry.path())
            .collect::<Vec<_>>();
        assert!(quarantined_paths.is_empty());

        let migrated = serde_json::from_str::<Value>(
            &fs::read_to_string(&paths.openclaw_config_file).expect("migrated config"),
        )
        .expect("migrated config json");
        assert!(migrated.pointer("/meta/lastTouchedVersion").is_none());
        assert!(migrated.pointer("/meta/lastTouchedAt").is_none());
        assert_ne!(
            migrated.pointer("/gateway/port").and_then(Value::as_u64),
            Some(18_878)
        );
        assert_eq!(
            migrated
                .pointer("/agents/defaults/workspace")
                .and_then(Value::as_str),
            None
        );
        let main = migrated
            .pointer("/agents/list")
            .and_then(Value::as_array)
            .and_then(|agents| {
                agents
                    .iter()
                    .find(|entry| entry.get("id").and_then(Value::as_str) == Some("main"))
            })
            .expect("main agent entry");
        assert_eq!(
            main.get("workspace").and_then(Value::as_str),
            Some(paths.openclaw_workspace_dir.to_string_lossy().as_ref())
        );
        assert_eq!(
            main.get("agentDir").and_then(Value::as_str),
            Some(paths.openclaw_main_agent_dir.to_string_lossy().as_ref())
        );

        let authority = serde_json::from_str::<KernelAuthorityState>(
            &fs::read_to_string(&paths.openclaw_authority_file).expect("authority state"),
        )
        .expect("authority state json");
        assert_eq!(
            authority.config_file_path.as_deref(),
            Some(paths.openclaw_config_file.to_string_lossy().as_ref())
        );
        assert_eq!(
            authority.active_install_key.as_deref(),
            Some(activated.install_key.as_str())
        );
        assert_eq!(
            authority.quarantined_paths,
            quarantined_paths
                .iter()
                .map(|path| path.to_string_lossy().into_owned())
                .collect::<Vec<_>>()
        );

        let migration = serde_json::from_str::<KernelMigrationState>(
            &fs::read_to_string(&paths.openclaw_migrations_file).expect("migration state"),
        )
        .expect("migration state json");
        assert_eq!(migration.last_config_source_path, None);
        assert_eq!(
            migration.last_config_target_path.as_deref(),
            Some(paths.openclaw_config_file.to_string_lossy().as_ref())
        );
        assert!(migration
            .last_config_migrated_at
            .as_deref()
            .is_some_and(|value| !value.trim().is_empty()));
    }

    #[test]
    fn load_manifest_reads_external_node_runtime_requirement_contract() {
        let temp = tempfile::tempdir().expect("temp dir");
        let resource_root =
            create_bundled_runtime_fixture(temp.path(), TEST_BUNDLED_OPENCLAW_VERSION);

        let manifest = load_manifest(&resource_root.join("manifest.json"))
            .expect("packaged OpenClaw manifest");

        assert_eq!(
            manifest.required_external_runtimes,
            vec!["nodejs".to_string()]
        );
        assert_eq!(
            manifest
                .required_external_runtime_versions
                .get("nodejs")
                .map(String::as_str),
            Some(required_openclaw_node_version())
        );
    }

    #[test]
    fn installs_bundled_runtime_and_exports_local_ai_proxy_token_to_managed_env() {
        let temp = tempfile::tempdir().expect("temp dir");
        let paths = resolve_paths_for_root(temp.path()).expect("paths");
        let resource_root =
            create_bundled_runtime_fixture(temp.path(), TEST_BUNDLED_OPENCLAW_VERSION);
        let service = OpenClawRuntimeService::new();

        let activated = service
            .ensure_bundled_runtime_from_root(&paths, &resource_root)
            .expect("activated runtime");
        let managed_env = activated
            .managed_env_with_local_ai_proxy(&paths)
            .expect("managed env");

        assert!(managed_env
            .get(OPENCLAW_LOCAL_PROXY_TOKEN_ENV_VAR)
            .is_some_and(|token| !token.trim().is_empty()));
        assert_ne!(
            managed_env.get(OPENCLAW_LOCAL_PROXY_TOKEN_ENV_VAR),
            Some(&"sk_sdkwork_api_key".to_string())
        );
    }

    #[test]
    fn activation_exports_openclaw_home_as_user_root_and_state_dir_as_openclaw_root() {
        let temp = tempfile::tempdir().expect("temp dir");
        let paths = resolve_paths_for_root(temp.path()).expect("paths");
        let resource_root =
            create_bundled_runtime_fixture(temp.path(), TEST_BUNDLED_OPENCLAW_VERSION);
        let service = OpenClawRuntimeService::new();

        let activated = service
            .ensure_bundled_runtime_from_root(&paths, &resource_root)
            .expect("activated runtime");
        let managed_env = activated.managed_env();

        assert_eq!(activated.home_dir, paths.user_root);
        assert_eq!(activated.state_dir, paths.openclaw_root_dir);
        assert_eq!(
            managed_env.get("OPENCLAW_HOME"),
            Some(&paths.user_root.to_string_lossy().into_owned())
        );
        assert_eq!(
            managed_env.get("OPENCLAW_STATE_DIR"),
            Some(&paths.openclaw_root_dir.to_string_lossy().into_owned())
        );
        assert_eq!(
            managed_env.get("OPENCLAW_CONFIG_PATH"),
            Some(&paths.openclaw_config_file.to_string_lossy().into_owned())
        );
    }

    #[test]
    fn activation_fails_when_a_blocking_non_directory_already_exists_at_the_final_install_root() {
        let temp = tempfile::tempdir().expect("temp dir");
        let paths = resolve_paths_for_root(temp.path()).expect("paths");
        let resource_root =
            create_bundled_runtime_fixture(temp.path(), TEST_BUNDLED_OPENCLAW_VERSION);
        let bundled_manifest = load_manifest(&resource_root.join("manifest.json"))
            .expect("packaged OpenClaw manifest");
        let install_dir = paths
            .openclaw_runtime_dir
            .join(bundled_manifest.install_key());
        fs::create_dir_all(
            install_dir
                .parent()
                .expect("managed runtime install parent directory"),
        )
        .expect("runtime parent");
        fs::write(&install_dir, "blocked").expect("blocking install root marker");
        let service = OpenClawRuntimeService::new();

        let error = service
            .ensure_bundled_runtime_from_root(&paths, &resource_root)
            .expect_err(
                "activation should fail instead of silently falling back to a staging runtime",
            );

        assert!(error.to_string().contains("install root"));

        let active = if paths.active_file.exists() {
            serde_json::from_str::<ActiveState>(
                &fs::read_to_string(&paths.active_file).expect("active file"),
            )
            .expect("active json")
        } else {
            ActiveState::default()
        };
        assert_eq!(
            active
                .runtimes
                .get(OPENCLAW_RUNTIME_ID)
                .and_then(|entry| entry.active_version.as_deref()),
            None
        );
    }

    #[test]
    fn activation_failure_does_not_leave_half_switched_active_state() {
        let temp = tempfile::tempdir().expect("temp dir");
        let paths = resolve_paths_for_root(temp.path()).expect("paths");
        let resource_root =
            create_bundled_runtime_fixture(temp.path(), TEST_BUNDLED_OPENCLAW_VERSION);
        fs::remove_file(&paths.openclaw_authority_file).expect("remove authority file");
        fs::create_dir(&paths.openclaw_authority_file).expect("block authority file path");
        let service = OpenClawRuntimeService::new();

        let error = service
            .ensure_bundled_runtime_from_root(&paths, &resource_root)
            .expect_err("activation should fail when authority state cannot be written");
        assert!(!error.to_string().trim().is_empty());

        let active = serde_json::from_str::<ActiveState>(
            &fs::read_to_string(&paths.active_file).expect("active file"),
        )
        .expect("active json");
        assert_eq!(
            active
                .runtimes
                .get(OPENCLAW_RUNTIME_ID)
                .and_then(|entry| entry.active_runtime_install_key()),
            None
        );
    }

    #[test]
    fn reuses_existing_install_when_the_bundled_runtime_key_matches() {
        let temp = tempfile::tempdir().expect("temp dir");
        let paths = resolve_paths_for_root(temp.path()).expect("paths");
        let resource_root =
            create_bundled_runtime_fixture(temp.path(), TEST_BUNDLED_OPENCLAW_VERSION);
        let service = OpenClawRuntimeService::new();

        let first = service
            .ensure_bundled_runtime_from_root(&paths, &resource_root)
            .expect("first activation");
        let sentinel = first.install_dir.join("sentinel.txt");
        fs::write(&sentinel, "keep").expect("sentinel");

        let second = service
            .ensure_bundled_runtime_from_root(&paths, &resource_root)
            .expect("second activation");

        assert_eq!(first.install_key, second.install_key);
        assert!(sentinel.exists());
    }

    #[test]
    fn staged_install_directory_keeps_the_full_install_key_prefix() {
        let install_key = format!("{TEST_BUNDLED_OPENCLAW_VERSION}-windows-x64");
        let install_dir = std::path::PathBuf::from(format!("D:/runtime/openclaw/{install_key}"));

        let staged_dir = staged_runtime_install_dir(&install_dir, 123);
        let expected_staging_name = format!("{install_key}.staging-123");

        assert_eq!(
            staged_dir.file_name().and_then(|value| value.to_str()),
            Some(expected_staging_name.as_str())
        );
    }

    #[test]
    fn reuses_matching_staged_install_when_the_final_install_directory_is_missing() {
        let temp = tempfile::tempdir().expect("temp dir");
        let paths = resolve_paths_for_root(temp.path()).expect("paths");
        let resource_root =
            create_bundled_runtime_fixture(temp.path(), TEST_BUNDLED_OPENCLAW_VERSION);
        let service = OpenClawRuntimeService::new();
        let bundled_manifest = load_manifest(&resource_root.join("manifest.json"))
            .expect("packaged OpenClaw manifest");
        let install_key = bundled_manifest.install_key();
        let install_dir = paths.openclaw_runtime_dir.join(&install_key);
        let staged_dir = staged_runtime_install_dir(&install_dir, 123);
        let runtime_dir = staged_dir.join("runtime");

        copy_directory_recursive(&resource_root.join("runtime"), &runtime_dir)
            .expect("copy runtime into staged dir");
        fs::copy(
            resource_root.join("manifest.json"),
            staged_dir.join("manifest.json"),
        )
        .expect("copy manifest into staged dir");
        assert!(resolve_runtime_sidecar_manifest_path(&runtime_dir).exists());

        let activated = service
            .ensure_bundled_runtime_from_root(&paths, &resource_root)
            .expect("activated runtime from staged install");

        assert_eq!(activated.install_key, install_key);
        assert_eq!(activated.install_dir, install_dir);
        assert!(activated.install_dir.exists());
        assert!(activated.runtime_dir.exists());
        assert!(!staged_dir.exists());
    }

    #[test]
    fn reuses_existing_install_when_matching_runtime_sidecar_is_present() {
        let temp = tempfile::tempdir().expect("temp dir");
        let paths = resolve_paths_for_root(temp.path()).expect("paths");
        let resource_root =
            create_bundled_runtime_fixture(temp.path(), TEST_BUNDLED_OPENCLAW_VERSION);
        let service = OpenClawRuntimeService::new();

        let first = service
            .ensure_bundled_runtime_from_root(&paths, &resource_root)
            .expect("first activation");
        let sentinel = first.install_dir.join("sentinel.txt");
        fs::write(&sentinel, "keep").expect("sentinel");

        let bundled_manifest = load_manifest(&resource_root.join("manifest.json"))
            .expect("packaged OpenClaw manifest");
        write_runtime_sidecar_manifest(&first.runtime_dir, &bundled_manifest);

        fs::remove_file(
            resource_root
                .join("runtime")
                .join("package")
                .join("node_modules")
                .join("@aws-sdk")
                .join("client-bedrock")
                .join("package.json"),
        )
        .expect("remove bundled dependency sentinel");

        let second = service
            .ensure_bundled_runtime_from_root(&paths, &resource_root)
            .expect("second activation");

        assert_eq!(first.install_key, second.install_key);
        assert!(sentinel.exists());
    }

    #[test]
    fn reinstalls_existing_install_when_runtime_sidecar_integrity_mismatch_is_detected() {
        let temp = tempfile::tempdir().expect("temp dir");
        let paths = resolve_paths_for_root(temp.path()).expect("paths");
        let resource_root =
            create_bundled_runtime_fixture(temp.path(), TEST_BUNDLED_OPENCLAW_VERSION);
        let service = OpenClawRuntimeService::new();

        let first = service
            .ensure_bundled_runtime_from_root(&paths, &resource_root)
            .expect("first activation");
        let sentinel = first.install_dir.join("sentinel.txt");
        fs::write(&sentinel, "stale").expect("sentinel");

        let bundled_manifest = load_manifest(&resource_root.join("manifest.json"))
            .expect("packaged OpenClaw manifest");
        write_runtime_sidecar_manifest(&first.runtime_dir, &bundled_manifest);

        fs::write(
            first
                .runtime_dir
                .join("package")
                .join("node_modules")
                .join("openclaw")
                .join("package.json"),
            "{\n  \"name\": \"openclaw\",\n  \"version\": \"tampered\"\n}\n",
        )
        .expect("tamper installed openclaw package json");

        let second = service
            .ensure_bundled_runtime_from_root(&paths, &resource_root)
            .expect("second activation");

        assert_eq!(first.install_key, second.install_key);
        assert!(!sentinel.exists());
        assert!(second
            .runtime_dir
            .join("package")
            .join("node_modules")
            .join("openclaw")
            .join("package.json")
            .exists());
        assert!(fs::read_to_string(
            second
                .runtime_dir
                .join("package")
                .join("node_modules")
                .join("openclaw")
                .join("package.json")
        )
        .expect("restored openclaw package json")
        .contains(TEST_BUNDLED_OPENCLAW_VERSION));
    }

    #[test]
    fn reinstalls_existing_install_when_runtime_sidecar_is_missing() {
        let temp = tempfile::tempdir().expect("temp dir");
        let paths = resolve_paths_for_root(temp.path()).expect("paths");
        let resource_root =
            create_bundled_runtime_fixture(temp.path(), TEST_BUNDLED_OPENCLAW_VERSION);
        let bundled_manifest = load_manifest(&resource_root.join("manifest.json"))
            .expect("packaged OpenClaw manifest");
        write_runtime_sidecar_manifest(&resource_root.join("runtime"), &bundled_manifest);

        let service = OpenClawRuntimeService::new();
        let first = service
            .ensure_bundled_runtime_from_root(&paths, &resource_root)
            .expect("first activation");
        let sentinel = first.install_dir.join("sentinel.txt");
        fs::write(&sentinel, "stale").expect("sentinel");

        let installed_sidecar_path = resolve_runtime_sidecar_manifest_path(&first.runtime_dir);
        assert!(installed_sidecar_path.exists());
        fs::remove_file(&installed_sidecar_path).expect("remove installed sidecar");

        let second = service
            .ensure_bundled_runtime_from_root(&paths, &resource_root)
            .expect("second activation");

        assert_eq!(first.install_key, second.install_key);
        assert!(!sentinel.exists());
        assert!(resolve_runtime_sidecar_manifest_path(&second.runtime_dir).exists());
    }

    #[test]
    fn reinstalls_archived_install_when_runtime_sidecar_is_missing() {
        let temp = tempfile::tempdir().expect("temp dir");
        let paths = resolve_paths_for_root(temp.path()).expect("paths");
        let resource_root =
            create_bundled_runtime_fixture(temp.path(), TEST_BUNDLED_OPENCLAW_VERSION);
        let bundled_manifest = load_manifest(&resource_root.join("manifest.json"))
            .expect("packaged OpenClaw manifest");
        write_runtime_sidecar_manifest(&resource_root.join("runtime"), &bundled_manifest);
        create_test_runtime_archive(&resource_root);
        fs::remove_dir_all(resource_root.join("runtime")).expect("remove source runtime dir");

        let service = OpenClawRuntimeService::new();
        let first = service
            .ensure_bundled_runtime_from_root(&paths, &resource_root)
            .expect("first activation");
        let sentinel = first.install_dir.join("sentinel.txt");
        fs::write(&sentinel, "stale").expect("sentinel");

        let installed_sidecar_path = resolve_runtime_sidecar_manifest_path(&first.runtime_dir);
        assert!(installed_sidecar_path.exists());
        fs::remove_file(&installed_sidecar_path).expect("remove installed sidecar");

        let second = service
            .ensure_bundled_runtime_from_root(&paths, &resource_root)
            .expect("second activation");

        assert_eq!(first.install_key, second.install_key);
        assert!(!sentinel.exists());
        assert!(resolve_runtime_sidecar_manifest_path(&second.runtime_dir).exists());
    }

    #[test]
    fn reinstalls_existing_install_when_a_root_runtime_dependency_is_missing() {
        let temp = tempfile::tempdir().expect("temp dir");
        let paths = resolve_paths_for_root(temp.path()).expect("paths");
        let resource_root =
            create_bundled_runtime_fixture(temp.path(), TEST_BUNDLED_OPENCLAW_VERSION);
        let service = OpenClawRuntimeService::new();

        let first = service
            .ensure_bundled_runtime_from_root(&paths, &resource_root)
            .expect("first activation");
        let sentinel = first.install_dir.join("sentinel.txt");
        fs::write(&sentinel, "stale").expect("sentinel");

        fs::remove_file(
            first
                .install_dir
                .join("runtime")
                .join("package")
                .join("node_modules")
                .join("@buape")
                .join("carbon")
                .join("package.json"),
        )
        .expect("remove root dependency sentinel");

        let second = service
            .ensure_bundled_runtime_from_root(&paths, &resource_root)
            .expect("second activation");

        assert!(second
            .install_dir
            .join("runtime")
            .join("package")
            .join("node_modules")
            .join("@buape")
            .join("carbon")
            .join("package.json")
            .exists());
        assert!(!sentinel.exists());
    }

    #[test]
    fn reinstalls_existing_install_when_a_bundled_plugin_runtime_dependency_is_missing() {
        let temp = tempfile::tempdir().expect("temp dir");
        let paths = resolve_paths_for_root(temp.path()).expect("paths");
        let resource_root =
            create_bundled_runtime_fixture(temp.path(), TEST_BUNDLED_OPENCLAW_VERSION);
        let service = OpenClawRuntimeService::new();

        let first = service
            .ensure_bundled_runtime_from_root(&paths, &resource_root)
            .expect("first activation");
        let sentinel = first.install_dir.join("sentinel.txt");
        fs::write(&sentinel, "stale").expect("sentinel");

        fs::remove_file(
            first
                .install_dir
                .join("runtime")
                .join("package")
                .join("node_modules")
                .join("@aws-sdk")
                .join("client-bedrock")
                .join("package.json"),
        )
        .expect("remove bundled plugin dependency sentinel");

        let second = service
            .ensure_bundled_runtime_from_root(&paths, &resource_root)
            .expect("second activation");

        assert!(second
            .install_dir
            .join("runtime")
            .join("package")
            .join("node_modules")
            .join("@aws-sdk")
            .join("client-bedrock")
            .join("package.json")
            .exists());
        assert!(!sentinel.exists());
    }

    #[test]
    fn installs_bundled_runtime_from_runtime_archive_bridge() {
        let temp = tempfile::tempdir().expect("temp dir");
        let paths = resolve_paths_for_root(temp.path()).expect("paths");
        let resource_root =
            create_archived_bundled_runtime_fixture(temp.path(), TEST_BUNDLED_OPENCLAW_VERSION);
        let service = OpenClawRuntimeService::new();

        let activated = service
            .ensure_bundled_runtime_from_root(&paths, &resource_root)
            .expect("activate archived runtime");

        assert!(activated.node_path.exists());
        assert!(activated.cli_path.exists());
        assert!(
            activated.install_dir.join("manifest.json").exists(),
            "archived packaged OpenClaw runtime install should restore manifest.json",
        );
    }

    #[test]
    fn installs_bundled_runtime_from_runtime_archive_without_shell_tools_on_path() {
        let temp = tempfile::tempdir().expect("temp dir");
        let paths = resolve_paths_for_root(temp.path()).expect("paths");
        let resource_root =
            create_archived_bundled_runtime_fixture(temp.path(), TEST_BUNDLED_OPENCLAW_VERSION);
        let service = OpenClawRuntimeService::new();
        let external_node_path = resolve_test_node_executable();
        let _path_guard = ScopedPathGuard::clear();
        let _node_override_guard =
            ScopedEnvVarGuard::set("SDKWORK_OPENCLAW_NODE_PATH", &external_node_path);

        let activated = service
            .ensure_bundled_runtime_from_root(&paths, &resource_root)
            .expect("activate archived runtime without shell tools on PATH");

        assert_eq!(activated.node_path, external_node_path);
        assert!(activated.cli_path.exists());
    }

    #[test]
    fn activation_uses_external_node_when_runtime_manifest_has_no_bundled_node_entrypoint() {
        let temp = tempfile::tempdir().expect("temp dir");
        let paths = resolve_paths_for_root(temp.path()).expect("paths");
        let resource_root =
            create_bundled_runtime_fixture(temp.path(), TEST_BUNDLED_OPENCLAW_VERSION);
        let service = OpenClawRuntimeService::new();

        let activated = service
            .ensure_bundled_runtime_from_root(&paths, &resource_root)
            .expect("activate runtime with external node-only manifest");

        assert_eq!(activated.node_path, resolve_test_node_executable());
        assert!(activated.cli_path.exists());
        assert!(activated.runtime_dir.exists());
    }

    #[cfg(windows)]
    #[test]
    fn installs_bundled_runtime_from_runtime_archive_when_windows_paths_exceed_max_path() {
        let temp = tempfile::tempdir().expect("temp dir");
        let managed_root = create_long_windows_managed_root(temp.path());
        let paths = resolve_paths_for_root(&managed_root).expect("paths");
        let resource_root =
            create_bundled_runtime_fixture(temp.path(), TEST_BUNDLED_OPENCLAW_VERSION);
        let deep_runtime_relative_path = std::path::Path::new(
            "runtime/package/node_modules/openclaw/dist/extensions/amazon-bedrock-mantle/node_modules/@aws-sdk/nested-clients/dist-types/submodules/bedrock-agent-runtime/commands/ReallyLongBundledRuntimeSmokeSentinel.d.ts",
        );
        let deep_runtime_absolute_path = resource_root.join(deep_runtime_relative_path);
        fs::create_dir_all(
            deep_runtime_absolute_path
                .parent()
                .expect("deep runtime parent"),
        )
        .expect("create deep runtime parent");
        fs::write(
            &deep_runtime_absolute_path,
            "export type SmokeSentinel = 'ready';\n",
        )
        .expect("write deep runtime sentinel");
        create_test_runtime_archive(&resource_root);
        fs::remove_dir_all(resource_root.join("runtime")).expect("remove source runtime dir");
        let service = OpenClawRuntimeService::new();

        let activated = service
            .ensure_bundled_runtime_from_root(&paths, &resource_root)
            .expect("activate archived runtime with long windows paths");

        assert!(
            activated
                .install_dir
                .join(deep_runtime_relative_path)
                .exists(),
            "archived packaged OpenClaw runtime install should preserve long nested file paths",
        );
    }

    #[test]
    fn retries_runtime_install_finalization_after_transient_access_denied() {
        let temp = tempfile::tempdir().expect("temp dir");
        let staging_dir = temp.path().join("openclaw.staging");
        let install_dir = temp.path().join("openclaw");
        let mut attempts = 0u8;

        fs::create_dir_all(&staging_dir).expect("create staging dir");
        fs::write(staging_dir.join("manifest.json"), "{}\n").expect("write staging manifest");

        rename_directory_with_retry_using(&staging_dir, &install_dir, |source, target| {
            attempts = attempts.saturating_add(1);
            if attempts < 3 {
                return Err(std::io::Error::from_raw_os_error(5));
            }
            fs::rename(source, target)
        })
        .expect("finalize runtime install dir after retry");

        assert_eq!(attempts, 3);
        assert!(install_dir.join("manifest.json").exists());
        assert!(!staging_dir.exists());
    }

    #[test]
    fn retries_runtime_install_finalization_after_sustained_access_denied() {
        let temp = tempfile::tempdir().expect("temp dir");
        let staging_dir = temp.path().join("openclaw.staging");
        let install_dir = temp.path().join("openclaw");
        let mut attempts = 0u16;

        fs::create_dir_all(&staging_dir).expect("create staging dir");
        fs::write(staging_dir.join("manifest.json"), "{}\n").expect("write staging manifest");

        rename_directory_with_retry_using(&staging_dir, &install_dir, |source, target| {
            attempts = attempts.saturating_add(1);
            if attempts < 26 {
                return Err(std::io::Error::from_raw_os_error(5));
            }
            fs::rename(source, target)
        })
        .expect("finalize runtime install dir after sustained retry window");

        assert_eq!(attempts, 26);
        assert!(install_dir.join("manifest.json").exists());
        assert!(!staging_dir.exists());
    }

    #[test]
    fn falls_back_to_copy_when_runtime_install_finalization_keeps_hitting_access_denied() {
        let temp = tempfile::tempdir().expect("temp dir");
        let staging_dir = temp.path().join("openclaw.staging");
        let install_dir = temp.path().join("openclaw");
        let nested_file = staging_dir
            .join("runtime")
            .join("package")
            .join("sentinel.txt");
        let mut attempts = 0u16;

        fs::create_dir_all(nested_file.parent().expect("nested runtime parent"))
            .expect("create staged runtime tree");
        fs::write(staging_dir.join("manifest.json"), "{}\n").expect("write staging manifest");
        fs::write(&nested_file, "ready\n").expect("write staged runtime file");

        super::finalize_runtime_install_dir_using(
            &staging_dir,
            &install_dir,
            |_source, _target| {
                attempts = attempts.saturating_add(1);
                Err(std::io::Error::from_raw_os_error(5))
            },
        )
        .expect("finalize runtime install dir via copy fallback");

        assert!(
            attempts >= 1,
            "expected the finalization path to attempt a rename before falling back",
        );
        assert!(install_dir.join("manifest.json").exists());
        assert!(install_dir
            .join("runtime")
            .join("package")
            .join("sentinel.txt")
            .exists());
        assert!(!staging_dir.exists());
    }

    #[test]
    fn rejects_directory_bundled_runtime_when_runtime_sidecar_is_missing() {
        let temp = tempfile::tempdir().expect("temp dir");
        let paths = resolve_paths_for_root(temp.path()).expect("paths");
        let resource_root =
            create_bundled_runtime_fixture(temp.path(), TEST_BUNDLED_OPENCLAW_VERSION);
        fs::remove_file(
            resource_root
                .join("runtime")
                .join(PREPARED_RUNTIME_SIDECAR_MANIFEST_FILE_NAME),
        )
        .expect("remove packaged OpenClaw runtime sidecar");
        let service = OpenClawRuntimeService::new();

        let error = service
            .ensure_bundled_runtime_from_root(&paths, &resource_root)
            .expect_err("missing packaged OpenClaw runtime sidecar should fail");

        assert!(error.to_string().contains("runtime sidecar"));
    }

    #[test]
    fn rejects_archived_bundled_runtime_when_runtime_sidecar_is_missing() {
        let temp = tempfile::tempdir().expect("temp dir");
        let paths = resolve_paths_for_root(temp.path()).expect("paths");
        let resource_root =
            create_bundled_runtime_fixture(temp.path(), TEST_BUNDLED_OPENCLAW_VERSION);
        fs::remove_file(
            resource_root
                .join("runtime")
                .join(PREPARED_RUNTIME_SIDECAR_MANIFEST_FILE_NAME),
        )
        .expect("remove packaged OpenClaw runtime sidecar");
        create_test_runtime_archive(&resource_root);
        fs::remove_dir_all(resource_root.join("runtime")).expect("remove source runtime dir");
        let service = OpenClawRuntimeService::new();

        let error = service
            .ensure_bundled_runtime_from_root(&paths, &resource_root)
            .expect_err("archived runtime without sidecar should fail");

        assert!(error.to_string().contains("runtime sidecar"));
    }

    #[test]
    fn rejects_bundled_runtime_for_a_different_target() {
        let temp = tempfile::tempdir().expect("temp dir");
        let paths = resolve_paths_for_root(temp.path()).expect("paths");
        let resource_root = create_bundled_runtime_fixture_for_target(
            temp.path(),
            TEST_BUNDLED_OPENCLAW_VERSION,
            "windows",
            "x64",
        );
        let service = OpenClawRuntimeService::new();

        if normalized_target_platform() == "windows" && normalized_target_arch() == "x64" {
            return;
        }

        let error = service
            .ensure_bundled_runtime_from_root(&paths, &resource_root)
            .expect_err("target mismatch should fail");

        assert!(error.to_string().contains("target mismatch"));
    }

    #[test]
    fn rewrites_busy_gateway_ports_to_an_available_loopback_port() {
        let temp = tempfile::tempdir().expect("temp dir");
        let paths = resolve_paths_for_root(temp.path()).expect("paths");
        let resource_root =
            create_bundled_runtime_fixture(temp.path(), TEST_BUNDLED_OPENCLAW_VERSION);
        let service = OpenClawRuntimeService::new();
        let (_port_lock, busy_port, occupied_ports) = reserve_contiguous_port_window(1);

        fs::write(
            &paths.openclaw_config_file,
            format!("{{\n  \"gateway\": {{\n    \"port\": {busy_port}\n  }}\n}}\n"),
        )
        .expect("seed config file");

        let activated = service
            .ensure_bundled_runtime_from_root(&paths, &resource_root)
            .expect("activated runtime");

        drop(occupied_ports);

        assert_ne!(activated.gateway_port, busy_port);

        let config = serde_json::from_str::<Value>(
            &fs::read_to_string(&activated.config_path).expect("config file"),
        )
        .expect("config json");
        assert_eq!(
            config.pointer("/gateway/port").and_then(Value::as_u64),
            Some(u64::from(activated.gateway_port))
        );
    }

    #[test]
    fn falls_back_to_os_assigned_port_when_preferred_window_is_unavailable() {
        let temp = tempfile::tempdir().expect("temp dir");
        let paths = resolve_paths_for_root(temp.path()).expect("paths");
        let resource_root =
            create_bundled_runtime_fixture(temp.path(), TEST_BUNDLED_OPENCLAW_VERSION);
        let service = OpenClawRuntimeService::new();
        let (_port_lock, preferred_port, occupied_ports) = reserve_contiguous_port_window(32);

        fs::write(
            &paths.openclaw_config_file,
            format!("{{\n  \"gateway\": {{\n    \"port\": {preferred_port}\n  }}\n}}\n"),
        )
        .expect("seed config file");

        let activated = service
            .ensure_bundled_runtime_from_root(&paths, &resource_root)
            .expect("activated runtime");

        drop(occupied_ports);

        assert!(activated.gateway_port > 0);
        assert!(
            activated.gateway_port < preferred_port
                || activated.gateway_port >= preferred_port.saturating_add(32)
        );

        let config = serde_json::from_str::<Value>(
            &fs::read_to_string(&activated.config_path).expect("config file"),
        )
        .expect("config json");
        assert_eq!(
            config.pointer("/gateway/port").and_then(Value::as_u64),
            Some(u64::from(activated.gateway_port))
        );
    }

    #[test]
    fn refresh_configured_runtime_uses_the_saved_gateway_port_when_available() {
        let temp = tempfile::tempdir().expect("temp dir");
        let paths = resolve_paths_for_root(temp.path()).expect("paths");
        let resource_root =
            create_bundled_runtime_fixture(temp.path(), TEST_BUNDLED_OPENCLAW_VERSION);
        let service = OpenClawRuntimeService::new();
        let (_port_lock, configured_port, occupied_ports) = reserve_contiguous_port_window(1);
        drop(occupied_ports);
        let activated = service
            .ensure_bundled_runtime_from_root(&paths, &resource_root)
            .expect("activated runtime");

        fs::write(
            &activated.config_path,
            format!("{{\n  \"gateway\": {{\n    \"port\": {configured_port}\n  }}\n}}\n"),
        )
        .expect("seed config file");

        let refreshed = service
            .refresh_configured_runtime(&paths, &activated)
            .expect("refreshed runtime");

        assert_eq!(refreshed.gateway_port, configured_port);
    }

    #[test]
    fn preserves_existing_gateway_http_endpoint_flags_when_adding_cron() {
        let temp = tempfile::tempdir().expect("temp dir");
        let paths = resolve_paths_for_root(temp.path()).expect("paths");
        let resource_root =
            create_bundled_runtime_fixture(temp.path(), TEST_BUNDLED_OPENCLAW_VERSION);
        let service = OpenClawRuntimeService::new();

        fs::write(
            &paths.openclaw_config_file,
            r#"{
  gateway: {
    tools: {
      allow: ["gateway", "cron"],
    },
    http: {
      endpoints: {
        chatCompletions: { enabled: false },
        responses: { enabled: false },
      },
    },
  },
}
"#,
        )
        .expect("seed config file");

        service
            .ensure_bundled_runtime_from_root(&paths, &resource_root)
            .expect("activated runtime");

        let config = serde_json::from_str::<Value>(
            &fs::read_to_string(&paths.openclaw_config_file).expect("config file"),
        )
        .expect("config json");
        assert_eq!(
            config
                .pointer("/gateway/tools/allow")
                .and_then(Value::as_array)
                .map(|items| items.iter().filter_map(Value::as_str).collect::<Vec<_>>()),
            Some(vec!["gateway", "cron"])
        );
        assert_eq!(
            config
                .pointer("/gateway/http/endpoints/chatCompletions/enabled")
                .and_then(Value::as_bool),
            Some(false)
        );
        assert_eq!(
            config
                .pointer("/gateway/http/endpoints/responses/enabled")
                .and_then(Value::as_bool),
            Some(false)
        );
        assert_eq!(
            config
                .pointer("/gateway/controlUi/allowedOrigins")
                .and_then(Value::as_array)
                .map(|items| items.iter().filter_map(Value::as_str).collect::<Vec<_>>()),
            Some(TAURI_CONTROL_UI_ALLOWED_ORIGINS.to_vec())
        );
    }

    #[test]
    fn preserves_existing_control_ui_origins_while_appending_tauri_webview_origins() {
        let temp = tempfile::tempdir().expect("temp dir");
        let paths = resolve_paths_for_root(temp.path()).expect("paths");
        let resource_root =
            create_bundled_runtime_fixture(temp.path(), TEST_BUNDLED_OPENCLAW_VERSION);
        let service = OpenClawRuntimeService::new();

        fs::write(
            &paths.openclaw_config_file,
            r#"{
  gateway: {
    controlUi: {
      allowedOrigins: ["https://control.example.com"],
    },
  },
}
"#,
        )
        .expect("seed config file");

        service
            .ensure_bundled_runtime_from_root(&paths, &resource_root)
            .expect("activated runtime");

        let config = serde_json::from_str::<Value>(
            &fs::read_to_string(&paths.openclaw_config_file).expect("config file"),
        )
        .expect("config json");
        assert_eq!(
            config
                .pointer("/gateway/controlUi/allowedOrigins")
                .and_then(Value::as_array)
                .map(|items| items.iter().filter_map(Value::as_str).collect::<Vec<_>>()),
            Some(
                std::iter::once("https://control.example.com")
                    .chain(TAURI_CONTROL_UI_ALLOWED_ORIGINS)
                    .collect::<Vec<_>>()
            )
        );
    }

    #[test]
    fn ensure_bundled_runtime_sanitizes_legacy_provider_runtime_fields() {
        let temp = tempfile::tempdir().expect("temp dir");
        let paths = resolve_paths_for_root(temp.path()).expect("paths");
        let resource_root =
            create_bundled_runtime_fixture(temp.path(), TEST_BUNDLED_OPENCLAW_VERSION);
        let service = OpenClawRuntimeService::new();
        let seeded_openclaw_config = format!(
            r#"{{
  "models": {{
    "providers": {{
      "sdkwork-local-proxy": {{
        "baseUrl": "http://127.0.0.1:{}/v1",
        "apiKey": "sk_sdkwork_api_key",
        "temperature": 0.35,
        "topP": 0.9,
        "maxTokens": 24000,
        "timeoutMs": 90000,
        "streaming": false,
        "models": [
          {{ "id": "gpt-5.4", "name": "GPT-5.4" }}
        ]
      }}
    }}
  }}
}}
"#,
            LOCAL_AI_PROXY_DEFAULT_PORT
        );

        fs::write(&paths.openclaw_config_file, seeded_openclaw_config).expect("seed config file");

        service
            .ensure_bundled_runtime_from_root(&paths, &resource_root)
            .expect("activated runtime");

        let config = serde_json::from_str::<Value>(
            &fs::read_to_string(&paths.openclaw_config_file).expect("config file"),
        )
        .expect("config json");
        let provider = config
            .pointer("/models/providers/sdkwork-local-proxy")
            .and_then(Value::as_object)
            .expect("provider object");

        assert!(!provider.contains_key("temperature"));
        assert!(!provider.contains_key("topP"));
        assert!(!provider.contains_key("maxTokens"));
        assert!(!provider.contains_key("timeoutMs"));
        assert!(!provider.contains_key("streaming"));
    }

    #[test]
    fn ensure_bundled_runtime_sanitizes_retired_openclaw_channel_entries() {
        let temp = tempfile::tempdir().expect("temp dir");
        let paths = resolve_paths_for_root(temp.path()).expect("paths");
        let resource_root =
            create_bundled_runtime_fixture(temp.path(), TEST_BUNDLED_OPENCLAW_VERSION);
        let service = OpenClawRuntimeService::new();

        fs::write(
            &paths.openclaw_config_file,
            r#"{
  "channels": {
    "telegram": {
      "botToken": "${TELEGRAM_BOT_TOKEN}",
      "enabled": true
    },
    "qq": {
      "enabled": false
    },
    "dingtalk": {
      "accessToken": "${DINGTALK_TOKEN}",
      "enabled": true
    },
    "defaults": {
      "enabled": false
    },
    "modelByChannel": {
      "telegram": {
        "*": "sdkwork-local-proxy/gpt-5.4"
      },
      "qq": {
        "*": "sdkwork-local-proxy/gpt-legacy"
      },
      "dingtalk": {
        "*": "sdkwork-local-proxy/gpt-legacy"
      }
    }
  }
}
"#,
        )
        .expect("seed config file");

        service
            .ensure_bundled_runtime_from_root(&paths, &resource_root)
            .expect("activated runtime");

        let config = serde_json::from_str::<Value>(
            &fs::read_to_string(&paths.openclaw_config_file).expect("config file"),
        )
        .expect("config json");
        let channels = config
            .pointer("/channels")
            .and_then(Value::as_object)
            .expect("channels object");

        assert!(channels.contains_key("telegram"));
        assert!(channels.contains_key("defaults"));
        assert_eq!(
            channels
                .get("modelByChannel")
                .and_then(Value::as_object)
                .expect("modelByChannel object")
                .keys()
                .cloned()
                .collect::<Vec<_>>(),
            vec!["telegram".to_string()]
        );
        assert!(!channels.contains_key("qq"));
        assert!(!channels.contains_key("dingtalk"));
    }

    #[test]
    fn ensure_bundled_runtime_removes_malformed_channel_model_mappings() {
        let temp = tempfile::tempdir().expect("temp dir");
        let paths = resolve_paths_for_root(temp.path()).expect("paths");
        let resource_root =
            create_bundled_runtime_fixture(temp.path(), TEST_BUNDLED_OPENCLAW_VERSION);
        let service = OpenClawRuntimeService::new();

        fs::write(
            &paths.openclaw_config_file,
            r#"{
  "channels": {
    "telegram": {
      "botToken": "${TELEGRAM_BOT_TOKEN}",
      "enabled": true
    },
    "modelByChannel": "sdkwork-local-proxy/gpt-legacy"
  }
}
"#,
        )
        .expect("seed config file");

        service
            .ensure_bundled_runtime_from_root(&paths, &resource_root)
            .expect("activated runtime");

        let config = serde_json::from_str::<Value>(
            &fs::read_to_string(&paths.openclaw_config_file).expect("config file"),
        )
        .expect("config json");
        let channels = config
            .pointer("/channels")
            .and_then(Value::as_object)
            .expect("channels object");

        assert!(channels.contains_key("telegram"));
        assert!(!channels.contains_key("modelByChannel"));
    }

    #[test]
    fn ensure_bundled_runtime_removes_malformed_channel_model_override_maps() {
        let temp = tempfile::tempdir().expect("temp dir");
        let paths = resolve_paths_for_root(temp.path()).expect("paths");
        let resource_root =
            create_bundled_runtime_fixture(temp.path(), TEST_BUNDLED_OPENCLAW_VERSION);
        let service = OpenClawRuntimeService::new();

        fs::write(
            &paths.openclaw_config_file,
            r#"{
  "channels": {
    "telegram": {
      "botToken": "${TELEGRAM_BOT_TOKEN}",
      "enabled": true
    },
    "modelByChannel": {
      "telegram": {
        "*": "sdkwork-local-proxy/gpt-5.4",
        "C123": 42
      },
      "slack": "sdkwork-local-proxy/gpt-legacy",
      "qq": {
        "*": "sdkwork-local-proxy/gpt-legacy"
      }
    }
  }
}
"#,
        )
        .expect("seed config file");

        service
            .ensure_bundled_runtime_from_root(&paths, &resource_root)
            .expect("activated runtime");

        let config = serde_json::from_str::<Value>(
            &fs::read_to_string(&paths.openclaw_config_file).expect("config file"),
        )
        .expect("config json");
        let telegram_overrides = config
            .pointer("/channels/modelByChannel/telegram")
            .and_then(Value::as_object)
            .expect("telegram model overrides");

        assert_eq!(
            telegram_overrides.keys().cloned().collect::<Vec<_>>(),
            vec!["*".to_string()]
        );
        assert!(
            config.pointer("/channels/modelByChannel/slack").is_none(),
            "malformed channel model override roots must be removed"
        );
        assert!(
            config.pointer("/channels/modelByChannel/qq").is_none(),
            "retired channel model override roots must be removed"
        );
    }

    #[test]
    fn ensure_bundled_runtime_removes_malformed_channel_defaults() {
        let temp = tempfile::tempdir().expect("temp dir");
        let paths = resolve_paths_for_root(temp.path()).expect("paths");
        let resource_root =
            create_bundled_runtime_fixture(temp.path(), TEST_BUNDLED_OPENCLAW_VERSION);
        let service = OpenClawRuntimeService::new();

        fs::write(
            &paths.openclaw_config_file,
            r#"{
  "channels": {
    "defaults": "always-on",
    "telegram": {
      "botToken": "${TELEGRAM_BOT_TOKEN}",
      "enabled": true
    }
  }
}
"#,
        )
        .expect("seed config file");

        service
            .ensure_bundled_runtime_from_root(&paths, &resource_root)
            .expect("activated runtime");

        let config = serde_json::from_str::<Value>(
            &fs::read_to_string(&paths.openclaw_config_file).expect("config file"),
        )
        .expect("config json");
        let channels = config
            .pointer("/channels")
            .and_then(Value::as_object)
            .expect("channels object");

        assert!(channels.contains_key("telegram"));
        assert!(!channels.contains_key("defaults"));
    }

    #[test]
    fn ensure_bundled_runtime_removes_malformed_supported_channel_roots() {
        let temp = tempfile::tempdir().expect("temp dir");
        let paths = resolve_paths_for_root(temp.path()).expect("paths");
        let resource_root =
            create_bundled_runtime_fixture(temp.path(), TEST_BUNDLED_OPENCLAW_VERSION);
        let service = OpenClawRuntimeService::new();

        fs::write(
            &paths.openclaw_config_file,
            r#"{
  "channels": {
    "telegram": "123456:telegram-token",
    "slack": ["xoxb-token"],
    "modelByChannel": {
      "telegram": {
        "*": "sdkwork-local-proxy/gpt-5.4"
      },
      "slack": {
        "C123": "sdkwork-local-proxy/gpt-5.4"
      }
    }
  }
}
"#,
        )
        .expect("seed config file");

        service
            .ensure_bundled_runtime_from_root(&paths, &resource_root)
            .expect("activated runtime");

        let config = serde_json::from_str::<Value>(
            &fs::read_to_string(&paths.openclaw_config_file).expect("config file"),
        )
        .expect("config json");
        let channels = config
            .pointer("/channels")
            .and_then(Value::as_object)
            .expect("channels object");

        assert!(!channels.contains_key("telegram"));
        assert!(!channels.contains_key("slack"));
        assert_eq!(
            channels
                .get("modelByChannel")
                .and_then(Value::as_object)
                .expect("modelByChannel object")
                .keys()
                .cloned()
                .collect::<Vec<_>>(),
            vec!["slack".to_string(), "telegram".to_string()]
        );
    }

    #[test]
    fn ensure_bundled_runtime_removes_malformed_channels_root() {
        let temp = tempfile::tempdir().expect("temp dir");
        let paths = resolve_paths_for_root(temp.path()).expect("paths");
        let resource_root =
            create_bundled_runtime_fixture(temp.path(), TEST_BUNDLED_OPENCLAW_VERSION);
        let service = OpenClawRuntimeService::new();

        fs::write(
            &paths.openclaw_config_file,
            r#"{
  "channels": ["telegram"]
}
"#,
        )
        .expect("seed config file");

        service
            .ensure_bundled_runtime_from_root(&paths, &resource_root)
            .expect("activated runtime");

        let config = serde_json::from_str::<Value>(
            &fs::read_to_string(&paths.openclaw_config_file).expect("config file"),
        )
        .expect("config json");

        assert!(config.get("channels").is_none());
    }

    #[test]
    fn ensure_bundled_runtime_rejects_missing_channel_metadata_without_rewriting_config() {
        let temp = tempfile::tempdir().expect("temp dir");
        let paths = resolve_paths_for_root(temp.path()).expect("paths");
        let resource_root =
            create_bundled_runtime_fixture(temp.path(), TEST_BUNDLED_OPENCLAW_VERSION);
        let service = OpenClawRuntimeService::new();
        let extensions_dir = resource_root
            .join("runtime")
            .join("package")
            .join("node_modules")
            .join("openclaw")
            .join("dist")
            .join("extensions");
        let seeded_config = r#"{
  "channels": {
    "telegram": {
      "enabled": true
    }
  }
}
"#;

        fs::remove_dir_all(&extensions_dir).expect("remove bundled channel metadata");
        fs::write(&paths.openclaw_config_file, seeded_config).expect("seed config file");

        let error = service
            .ensure_bundled_runtime_from_root(&paths, &resource_root)
            .expect_err("missing channel metadata must reject bundled runtime activation");
        let error_message = error.to_string();

        assert!(
            error_message.contains("packaged OpenClaw runtime channel metadata not found"),
            "unexpected error: {error_message}"
        );
        assert_eq!(
            fs::read_to_string(&paths.openclaw_config_file).expect("config file"),
            seeded_config,
            "runtime activation must not rewrite user config when channel metadata cannot be trusted",
        );
    }

    #[test]
    fn collect_openclaw_runtime_channel_ids_reads_plugin_manifest_channel_metadata() {
        let temp = tempfile::tempdir().expect("temp dir");
        let runtime_dir = temp.path().join("runtime");
        let plugin_dir = runtime_dir
            .join("package")
            .join("node_modules")
            .join("openclaw")
            .join("dist")
            .join("extensions")
            .join("qqbot");
        fs::create_dir_all(&plugin_dir).expect("plugin dir");
        fs::write(
            plugin_dir.join("openclaw.plugin.json"),
            r#"{
  "id": "qqbot",
  "channels": ["qqbot"],
  "channelConfigs": {
    "qqbot": {
      "label": "QQ Bot"
    }
  }
}
"#,
        )
        .expect("plugin manifest");

        let channel_ids =
            collect_openclaw_runtime_channel_ids(&runtime_dir).expect("runtime channel ids");

        assert!(channel_ids.contains("qqbot"));
        assert!(!channel_ids.contains("qq"));
    }

    #[test]
    fn collect_openclaw_runtime_channel_ids_reads_plugin_manifest_channel_config_keys() {
        let temp = tempfile::tempdir().expect("temp dir");
        let runtime_dir = temp.path().join("runtime");
        let plugin_dir = runtime_dir
            .join("package")
            .join("node_modules")
            .join("openclaw")
            .join("dist")
            .join("extensions")
            .join("qqbot");
        fs::create_dir_all(&plugin_dir).expect("plugin dir");
        fs::write(
            plugin_dir.join("openclaw.plugin.json"),
            r#"{
  "id": "qqbot",
  "channelConfigs": {
    "qqbot": {
      "label": "QQ Bot"
    }
  }
}
"#,
        )
        .expect("plugin manifest");

        let channel_ids =
            collect_openclaw_runtime_channel_ids(&runtime_dir).expect("runtime channel ids");

        assert_eq!(channel_ids, BTreeSet::from(["qqbot".to_string()]));
    }

    #[test]
    fn refresh_configured_runtime_rewrites_busy_gateway_ports() {
        let temp = tempfile::tempdir().expect("temp dir");
        let paths = resolve_paths_for_root(temp.path()).expect("paths");
        let resource_root =
            create_bundled_runtime_fixture(temp.path(), TEST_BUNDLED_OPENCLAW_VERSION);
        let service = OpenClawRuntimeService::new();
        let activated = service
            .ensure_bundled_runtime_from_root(&paths, &resource_root)
            .expect("activated runtime");
        let (_port_lock, busy_port, occupied_ports) = reserve_contiguous_port_window(1);

        fs::write(
            &activated.config_path,
            format!("{{\n  \"gateway\": {{\n    \"port\": {busy_port}\n  }}\n}}\n"),
        )
        .expect("seed config file");

        let refreshed = service
            .refresh_configured_runtime(&paths, &activated)
            .expect("refreshed runtime");

        drop(occupied_ports);

        assert_ne!(refreshed.gateway_port, busy_port);
        let config = serde_json::from_str::<Value>(
            &fs::read_to_string(&refreshed.config_path).expect("config file"),
        )
        .expect("config json");
        assert_eq!(
            config.pointer("/gateway/port").and_then(Value::as_u64),
            Some(u64::from(refreshed.gateway_port))
        );
    }

    #[test]
    fn resolves_bundled_runtime_from_nested_resources_directory() {
        let temp = tempfile::tempdir().expect("temp dir");
        let resource_dir = temp.path().join("target").join("debug");
        let nested_resource_root = resource_dir.join("resources").join("openclaw");
        fs::create_dir_all(&nested_resource_root).expect("nested resource root");

        let resolved =
            resolve_bundled_resource_root(&resource_dir).expect("resolved resource root");

        assert_eq!(resolved, nested_resource_root);
    }

    #[test]
    fn resolves_bundled_runtime_from_source_resources_directory_when_dev_target_resources_are_missing(
    ) {
        let temp = tempfile::tempdir().expect("temp dir");
        let manifest_dir = temp.path().join("src-tauri");
        let resource_dir = temp.path().join("target").join("debug");
        let source_resource_root = manifest_dir.join("resources").join("openclaw");
        fs::create_dir_all(&source_resource_root).expect("source resource root");

        let resolved =
            resolve_bundled_resource_root_with_manifest_dir(&resource_dir, &manifest_dir)
                .expect("resolved source resource root");

        assert_eq!(resolved, source_resource_root);
    }

    fn create_bundled_runtime_fixture(root: &std::path::Path, version: &str) -> std::path::PathBuf {
        create_bundled_runtime_fixture_for_target(
            root,
            version,
            normalized_target_platform(),
            normalized_target_arch(),
        )
    }

    fn create_archived_bundled_runtime_fixture(
        root: &std::path::Path,
        version: &str,
    ) -> std::path::PathBuf {
        let resource_root = create_bundled_runtime_fixture(root, version);
        create_test_runtime_archive(&resource_root);
        std::fs::remove_dir_all(resource_root.join("runtime")).expect("remove runtime dir");
        resource_root
    }

    #[cfg(windows)]
    fn create_long_windows_managed_root(root: &std::path::Path) -> std::path::PathBuf {
        let mut managed_root = root.join("managed-root");
        while managed_root.to_string_lossy().len() < 180 {
            managed_root = managed_root.join("very-long-windows-managed-root-segment");
        }
        fs::create_dir_all(&managed_root).expect("create long windows managed root");
        managed_root
    }

    fn create_bundled_runtime_fixture_for_target(
        root: &std::path::Path,
        version: &str,
        platform: &str,
        arch: &str,
    ) -> std::path::PathBuf {
        let resource_root = root.join(format!("bundled-openclaw-{platform}-{arch}"));
        let runtime_root = resource_root.join("runtime");
        let cli_relative_path = "runtime/package/node_modules/openclaw/openclaw.mjs";
        let cli_path = resource_root.join(cli_relative_path);

        fs::create_dir_all(cli_path.parent().expect("cli parent")).expect("cli dir");
        fs::write(&cli_path, "console.log('openclaw');").expect("cli file");
        let openclaw_package_json_path = resource_root
            .join("runtime")
            .join("package")
            .join("node_modules")
            .join("openclaw")
            .join("package.json");
        let bundled_plugin_package_json_path = resource_root
            .join("runtime")
            .join("package")
            .join("node_modules")
            .join("openclaw")
            .join("dist")
            .join("extensions")
            .join("amazon-bedrock")
            .join("package.json");
        let bundled_channel_package_json_paths = [
            ("qqbot", "QQ Bot"),
            ("feishu", "Feishu"),
            ("imessage", "iMessage"),
            ("irc", "IRC"),
            ("matrix", "Matrix"),
            ("mattermost", "Mattermost"),
            ("signal", "Signal"),
            ("slack", "Slack"),
            ("telegram", "Telegram"),
        ]
        .map(|(channel_id, label)| {
            (
                channel_id,
                label,
                resource_root
                    .join("runtime")
                    .join("package")
                    .join("node_modules")
                    .join("openclaw")
                    .join("dist")
                    .join("extensions")
                    .join(channel_id)
                    .join("package.json"),
            )
        });
        let carbon_package_json_path = resource_root
            .join("runtime")
            .join("package")
            .join("node_modules")
            .join("@buape")
            .join("carbon")
            .join("package.json");
        let client_bedrock_package_json_path = resource_root
            .join("runtime")
            .join("package")
            .join("node_modules")
            .join("@aws-sdk")
            .join("client-bedrock")
            .join("package.json");
        fs::create_dir_all(
            openclaw_package_json_path
                .parent()
                .expect("openclaw package json parent"),
        )
        .expect("openclaw package dir");
        fs::create_dir_all(
            bundled_plugin_package_json_path
                .parent()
                .expect("bundled plugin package json parent"),
        )
        .expect("bundled plugin package dir");
        for (_, _, package_json_path) in &bundled_channel_package_json_paths {
            fs::create_dir_all(
                package_json_path
                    .parent()
                    .expect("bundled channel package json parent"),
            )
            .expect("bundled channel package dir");
        }
        fs::create_dir_all(
            carbon_package_json_path
                .parent()
                .expect("carbon package json parent"),
        )
        .expect("carbon package dir");
        fs::create_dir_all(
            client_bedrock_package_json_path
                .parent()
                .expect("client bedrock package json parent"),
        )
        .expect("client bedrock package dir");
        fs::write(
            &openclaw_package_json_path,
            format!(
                r#"{{
  "name": "openclaw",
  "version": "{version}",
  "dependencies": {{
    "@buape/carbon": "0.14.0"
  }}
}}
"#
            ),
        )
        .expect("openclaw package json");
        fs::write(
            &bundled_plugin_package_json_path,
            format!(
                r#"{{
  "name": "@openclaw/amazon-bedrock-provider",
  "version": "{}-beta.1",
  "dependencies": {{
    "@aws-sdk/client-bedrock": "3.1020.0"
  }}
}}
"#,
                TEST_BUNDLED_OPENCLAW_VERSION,
            ),
        )
        .expect("bundled plugin package json");
        for (channel_id, label, package_json_path) in bundled_channel_package_json_paths {
            fs::write(
                &package_json_path,
                format!(
                    r#"{{
  "name": "@openclaw/{channel_id}-channel",
  "version": "{}-beta.1",
  "openclaw": {{
    "extensions": ["./index.js"],
    "channel": {{
      "id": "{channel_id}",
      "label": "{label}"
    }}
  }}
}}
"#,
                    TEST_BUNDLED_OPENCLAW_VERSION,
                ),
            )
            .expect("bundled channel package json");
        }
        fs::write(
            &carbon_package_json_path,
            r#"{
  "name": "@buape/carbon",
  "version": "0.14.0"
}
"#,
        )
        .expect("carbon package json");
        fs::write(
            &client_bedrock_package_json_path,
            r#"{
  "name": "@aws-sdk/client-bedrock",
  "version": "3.1020.0"
}
"#,
        )
        .expect("client-bedrock package json");
        assert!(runtime_root.exists());

        let manifest = BundledOpenClawManifest {
            schema_version: 2,
            runtime_id: OPENCLAW_RUNTIME_ID.to_string(),
            openclaw_version: version.to_string(),
            required_external_runtimes: vec!["nodejs".to_string()],
            required_external_runtime_versions: std::collections::BTreeMap::from([(
                "nodejs".to_string(),
                required_openclaw_node_version().to_string(),
            )]),
            platform: platform.to_string(),
            arch: arch.to_string(),
            cli_relative_path: cli_relative_path.to_string(),
        };

        fs::write(
            resource_root.join("manifest.json"),
            serde_json::to_string_pretty(&manifest).expect("manifest json"),
        )
        .expect("manifest file");
        write_runtime_sidecar_manifest(&runtime_root, &manifest);

        resource_root
    }

    fn create_test_runtime_archive(resource_root: &std::path::Path) {
        let archive_path = resource_root.join(BUNDLED_RUNTIME_ARCHIVE_FILE_NAME);
        if archive_path.exists() {
            fs::remove_file(&archive_path).expect("remove existing runtime archive");
        }

        let archive_file = fs::File::create(&archive_path).expect("create runtime archive file");
        let mut writer = ZipWriter::new(archive_file);
        let options = FileOptions::default().compression_method(CompressionMethod::Stored);
        writer
            .add_directory("runtime/", options)
            .expect("add runtime root directory entry");
        append_directory_to_test_runtime_archive(
            &mut writer,
            resource_root,
            &resource_root.join("runtime"),
            options,
        );
        writer.finish().expect("finish runtime archive");
    }

    fn append_directory_to_test_runtime_archive(
        writer: &mut ZipWriter<fs::File>,
        archive_root: &std::path::Path,
        directory: &std::path::Path,
        options: FileOptions,
    ) {
        let mut entries = fs::read_dir(directory)
            .expect("read runtime archive directory")
            .map(|entry| entry.expect("runtime archive directory entry"))
            .collect::<Vec<_>>();
        entries.sort_by_key(|entry| entry.path());

        for entry in entries {
            let entry_path = entry.path();
            let metadata = entry.metadata().expect("runtime archive entry metadata");
            let relative_path = entry_path
                .strip_prefix(archive_root)
                .expect("runtime archive relative path");
            let archive_path = relative_path
                .components()
                .map(|component| component.as_os_str().to_string_lossy().into_owned())
                .collect::<Vec<_>>()
                .join("/");

            if metadata.is_dir() {
                writer
                    .add_directory(format!("{archive_path}/"), options)
                    .expect("add runtime archive directory entry");
                append_directory_to_test_runtime_archive(
                    writer,
                    archive_root,
                    &entry_path,
                    options,
                );
                continue;
            }

            writer
                .start_file(&archive_path, options)
                .expect("start runtime archive file entry");
            let mut file = fs::File::open(&entry_path).expect("open runtime archive source file");
            std::io::copy(&mut file, writer).expect("write runtime archive file entry");
            writer.flush().expect("flush runtime archive file entry");
        }
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
            PreparedOpenClawRuntimeIntegrityFile {
                relative_path,
                size: metadata.len(),
                sha256: sha256_file_hex(&absolute_path).expect("runtime integrity sha256"),
            }
        })
        .collect::<Vec<_>>();
        let sidecar = PreparedOpenClawRuntimeSidecarManifest {
            manifest: manifest.clone(),
            runtime_integrity: Some(PreparedOpenClawRuntimeIntegrityManifest {
                schema_version: 1,
                files: integrity_files,
            }),
        };
        fs::write(
            runtime_dir.join(".sdkwork-openclaw-runtime.json"),
            format!(
                "{}\n",
                serde_json::to_string_pretty(&sidecar).expect("runtime sidecar json")
            ),
        )
        .expect("runtime sidecar manifest");
    }

    fn reserve_contiguous_port_window(
        size: u16,
    ) -> (MutexGuard<'static, ()>, u16, Vec<std::net::TcpListener>) {
        let port_lock = crate::framework::services::test_support::lock_loopback_ports();
        for start in 20_000..60_000u16.saturating_sub(size) {
            let mut listeners = Vec::new();
            let mut success = true;

            for port in start..start.saturating_add(size) {
                match std::net::TcpListener::bind(("127.0.0.1", port)) {
                    Ok(listener) => listeners.push(listener),
                    Err(_) => {
                        success = false;
                        break;
                    }
                }
            }

            if success {
                return (port_lock, start, listeners);
            }
        }

        panic!("failed to reserve a contiguous loopback port window for the test");
    }
}
