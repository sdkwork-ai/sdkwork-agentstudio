use super::{
    kernel_runtime_authority::KernelRuntimeAuthorityService,
    local_ai_proxy::{
        LocalAiProxyLifecycle, LocalAiProxyService, LocalAiProxyServiceHealth,
        OPENCLAW_LOCAL_PROXY_API_KEY_PLACEHOLDER,
    },
    local_ai_proxy_snapshot::{
        resolve_provider_center_profile_id, restore_provider_center_catalog,
        LocalAiProxyProviderCenterCatalogSnapshot, LocalAiProxySnapshot,
        LOCAL_AI_PROXY_PROVIDER_CENTER_NAMESPACE,
    },
    openclaw_mirror_export::{export_phase1_full_private_mirror, OpenClawMirrorExportRequest},
    openclaw_mirror_manifest::{
        compute_bytes_digest_sha256, compute_component_digest_sha256, compute_component_stats,
        OpenClawMirrorManagedAssetsSnapshot, OpenClawMirrorManagedPluginAssetRecord,
        OpenClawMirrorManagedSkillAssetRecord, OpenClawMirrorManifestComponentRecord,
        OpenClawMirrorManifestMetadataFileRecord, OpenClawMirrorManifestRecord,
        OpenClawMirrorManifestRuntimeSnapshot, OpenClawMirrorRuntimeSnapshot,
    },
    openclaw_runtime::ActivatedOpenClawRuntime,
    storage::StorageService,
    supervisor::SupervisorService,
};
#[cfg(windows)]
use crate::framework::child_process::configure_hidden_child_process;
use crate::framework::storage::{StorageGetTextRequest, StorageListKeysRequest};
use crate::framework::{
    config::AppConfig,
    paths::{normalize_openclaw_agent_id, AppPaths, OPENCLAW_DEFAULT_AGENT_ID, OPENCLAW_KERNEL_ID},
    FrameworkError, Result,
};
use serde_json::Value;
use std::{
    collections::{HashMap, HashSet},
    fs,
    path::{Path, PathBuf},
    process::Command,
};
use time::{format_description::well_known::Rfc3339, OffsetDateTime};
use uuid::Uuid;

const STUDIO_ROUTING_COMPONENT_ID: &str = "studio-routing";
const STUDIO_ROUTING_COMPONENT_KIND: &str = "studio-routing";
const STUDIO_ROUTING_COMPONENT_RELATIVE_PATH: &str =
    "components/studio-routing/provider-center.json";
const RUNTIME_SNAPSHOT_METADATA_ID: &str = "runtime-snapshot";
const MANAGED_ASSETS_METADATA_ID: &str = "managed-assets-inventory";
const PRIVATE_RUNTIME_SNAPSHOT_FILE_NAME: &str = "runtime.json";
const PRIVATE_MANAGED_ASSETS_FILE_NAME: &str = "managed-assets.json";

#[derive(Clone, Debug, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OpenClawMirrorImportPreview {
    pub source_path: String,
    pub mode: String,
    pub manifest: OpenClawMirrorManifestRecord,
    pub components: Vec<OpenClawMirrorManifestComponentRecord>,
    pub detected_runtime: OpenClawMirrorManifestRuntimeSnapshot,
    pub warnings: Vec<String>,
}

#[derive(Clone, Debug, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OpenClawMirrorImportRequest {
    pub source_path: PathBuf,
    pub create_safety_snapshot: bool,
    pub restart_gateway: bool,
}

#[derive(Clone, Debug, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OpenClawMirrorSafetySnapshotRecord {
    pub destination_path: String,
    pub file_name: String,
    pub file_size_bytes: u64,
    pub created_at: String,
}

#[derive(Clone, Debug, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OpenClawMirrorImportVerificationCheck {
    pub id: String,
    pub label: String,
    pub status: String,
    pub detail: String,
}

#[derive(Clone, Debug, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OpenClawMirrorImportVerification {
    pub checked_at: String,
    pub status: String,
    pub checks: Vec<OpenClawMirrorImportVerificationCheck>,
}

#[derive(Clone, Debug, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OpenClawMirrorImportResult {
    pub source_path: String,
    pub imported_at: String,
    pub manifest: OpenClawMirrorManifestRecord,
    pub restored_components: Vec<OpenClawMirrorManifestComponentRecord>,
    pub gateway_was_running: bool,
    pub gateway_running_after_import: bool,
    pub safety_snapshot: Option<OpenClawMirrorSafetySnapshotRecord>,
    pub verification: OpenClawMirrorImportVerification,
}

pub fn inspect_openclaw_mirror_import(source_path: &Path) -> Result<OpenClawMirrorImportPreview> {
    with_prepared_import_archive(source_path, |prepared| {
        Ok(OpenClawMirrorImportPreview {
            source_path: normalize_path(source_path),
            mode: prepared.manifest.mode.clone(),
            manifest: prepared.manifest.clone(),
            components: prepared.manifest.components.clone(),
            detected_runtime: prepared.manifest.runtime.clone(),
            warnings: Vec::new(),
        })
    })
}

pub fn import_openclaw_mirror(
    paths: &AppPaths,
    config: &AppConfig,
    storage: &StorageService,
    local_ai_proxy: &LocalAiProxyService,
    supervisor: &SupervisorService,
    runtime: &ActivatedOpenClawRuntime,
    request: &OpenClawMirrorImportRequest,
) -> Result<OpenClawMirrorImportResult> {
    with_prepared_import_archive(&request.source_path, |prepared| {
        let imported_at = format_now()?;
        let gateway_was_running = supervisor.is_openclaw_gateway_running()?;
        let safety_snapshot = if request.create_safety_snapshot {
            Some(create_safety_snapshot(paths, config, storage, runtime)?)
        } else {
            None
        };

        if gateway_was_running {
            supervisor.stop_openclaw_gateway()?;
        }

        restore_manifest_payloads(prepared, runtime)?;
        rebase_restored_managed_runtime_config(paths, runtime, &prepared.source_runtime_snapshot)?;
        repair_local_managed_plugin_installs(paths, runtime)?;
        if let Some(catalog) = prepared.provider_center_catalog.as_ref() {
            restore_provider_center_catalog(paths, config, storage, catalog)?;
        }
        let local_proxy_projection =
            reproject_local_ai_proxy(paths, config, storage, local_ai_proxy)?;
        run_post_import_doctor(paths, runtime)?;

        if request.restart_gateway {
            supervisor.start_openclaw_gateway(paths)?;
        }

        let gateway_running_after_import = supervisor.is_openclaw_gateway_running()?;
        let verification = build_post_restore_verification(
            paths,
            config,
            storage,
            local_ai_proxy,
            prepared.provider_center_catalog.as_ref(),
            &prepared.managed_assets_snapshot,
            &local_proxy_projection,
            request.restart_gateway,
            gateway_running_after_import,
            &imported_at,
        );

        Ok(OpenClawMirrorImportResult {
            source_path: normalize_path(&request.source_path),
            imported_at,
            manifest: prepared.manifest.clone(),
            restored_components: prepared.manifest.components.clone(),
            gateway_was_running,
            gateway_running_after_import,
            safety_snapshot,
            verification,
        })
    })
}

#[derive(Clone, Debug)]
struct PreparedOpenClawMirrorArchive {
    staging_root: PathBuf,
    manifest: OpenClawMirrorManifestRecord,
    provider_center_catalog: Option<LocalAiProxyProviderCenterCatalogSnapshot>,
    source_runtime_snapshot: OpenClawMirrorRuntimeSnapshot,
    managed_assets_snapshot: OpenClawMirrorManagedAssetsSnapshot,
}

#[derive(Clone, Debug)]
struct OpenClawMirrorLocalProxyReprojection {
    snapshot: LocalAiProxySnapshot,
    health: LocalAiProxyServiceHealth,
}

fn with_prepared_import_archive<T>(
    source_path: &Path,
    operation: impl FnOnce(&PreparedOpenClawMirrorArchive) -> Result<T>,
) -> Result<T> {
    if !source_path.exists() || !source_path.is_file() {
        return Err(FrameworkError::NotFound(format!(
            "openclaw mirror archive not found: {}",
            source_path.display()
        )));
    }

    let staging_root = create_temp_staging_dir("openclaw-mirror-import")?;
    let result = (|| -> Result<T> {
        extract_archive_to_staging(source_path, &staging_root)?;
        let manifest = load_manifest_from_staging(&staging_root)?;
        validate_manifest(&manifest)?;
        validate_component_payloads(&staging_root, &manifest)?;
        validate_component_payload_entry_ownership(&staging_root, &manifest)?;
        validate_metadata_payloads(&staging_root, &manifest)?;
        let provider_center_catalog =
            load_optional_provider_center_catalog(&staging_root, &manifest)?;
        let source_runtime_snapshot = load_runtime_snapshot(&staging_root)?;
        validate_manifest_runtime_summary(&manifest.runtime, &source_runtime_snapshot)?;
        let managed_assets_snapshot = load_openclaw_assets_snapshot(&staging_root)?;
        validate_openclaw_assets_payloads(&staging_root, &manifest, &managed_assets_snapshot)?;
        validate_component_payload_digests(&staging_root, &manifest)?;
        validate_component_payload_stats(&staging_root, &manifest)?;

        operation(&PreparedOpenClawMirrorArchive {
            staging_root: staging_root.clone(),
            manifest,
            provider_center_catalog,
            source_runtime_snapshot,
            managed_assets_snapshot,
        })
    })();

    let _ = fs::remove_dir_all(&staging_root);
    result
}

fn restore_manifest_payloads(
    prepared: &PreparedOpenClawMirrorArchive,
    runtime: &ActivatedOpenClawRuntime,
) -> Result<()> {
    for component_id in ["state", "workspace", "config"] {
        let component = prepared
            .manifest
            .components
            .iter()
            .find(|item| item.id == component_id)
            .ok_or_else(|| {
                FrameworkError::ValidationFailed(format!(
                    "openclaw mirror import is missing required component: {component_id}"
                ))
            })?;
        let source_path = prepared.staging_root.join(&component.relative_path);

        match component.id.as_str() {
            "config" => restore_file(&source_path, &runtime.config_path)?,
            "state" => restore_directory(&source_path, &runtime.state_dir)?,
            "workspace" => restore_directory(&source_path, &runtime.workspace_dir)?,
            other => {
                return Err(FrameworkError::InvalidOperation(format!(
                    "unsupported openclaw mirror import component id: {other}"
                )))
            }
        }
    }

    Ok(())
}

fn rebase_restored_managed_runtime_config(
    paths: &AppPaths,
    runtime: &ActivatedOpenClawRuntime,
    source_runtime_snapshot: &OpenClawMirrorRuntimeSnapshot,
) -> Result<()> {
    let openclaw_paths = paths.kernel_paths(OPENCLAW_KERNEL_ID)?;
    let config_text = fs::read_to_string(&runtime.config_path)?;
    let mut config_root = serde_json::from_str::<Value>(&config_text)?;
    if !config_root.is_object() {
        return Err(FrameworkError::ValidationFailed(format!(
            "restored OpenClaw config is not a JSON object: {}",
            runtime.config_path.display()
        )));
    }

    set_nested_string(&mut config_root, &["gateway", "mode"], "local")?;
    set_nested_string(&mut config_root, &["gateway", "bind"], "loopback")?;
    set_nested_u16(&mut config_root, &["gateway", "port"], runtime.gateway_port)?;
    set_nested_string(&mut config_root, &["gateway", "auth", "mode"], "token")?;
    set_nested_string(
        &mut config_root,
        &["gateway", "auth", "token"],
        runtime.gateway_auth_token.as_str(),
    )?;
    remove_nested_value(&mut config_root, &["agents", "defaults", "workspace"]);
    remove_nested_value(&mut config_root, &["agents", "defaults", "agentDir"]);

    let agent_entries = ensure_array_path(&mut config_root, &["agents", "list"])?;
    let main_index = agent_entries
        .iter()
        .position(|entry| {
            entry
                .as_object()
                .and_then(|agent_root| agent_root.get("id"))
                .and_then(Value::as_str)
                .map(normalize_openclaw_agent_id)
                .is_some_and(|agent_id| agent_id == OPENCLAW_DEFAULT_AGENT_ID)
        })
        .unwrap_or_else(|| {
            agent_entries.push(Value::Object(serde_json::Map::new()));
            agent_entries.len() - 1
        });

    for (index, entry) in agent_entries.iter_mut().enumerate() {
        if !entry.is_object() {
            *entry = Value::Object(serde_json::Map::new());
        }
        let Some(agent_root) = entry.as_object_mut() else {
            continue;
        };

        let mut agent_id = normalize_openclaw_agent_id(
            agent_root
                .get("id")
                .and_then(Value::as_str)
                .unwrap_or_default(),
        );
        if index == main_index {
            agent_id = OPENCLAW_DEFAULT_AGENT_ID.to_string();
            agent_root
                .entry("name".to_string())
                .or_insert_with(|| Value::String("Main".to_string()));
        } else if agent_id == OPENCLAW_DEFAULT_AGENT_ID {
            agent_id = format!("agent-{index}");
        }

        let workspace_dir = openclaw_paths.openclaw_agent_workspace_dir(&agent_id)?;
        let agent_dir = openclaw_paths.openclaw_agent_dir(&agent_id)?;

        agent_root.insert("id".to_string(), Value::String(agent_id.clone()));
        agent_root.insert(
            "workspace".to_string(),
            Value::String(workspace_dir.to_string_lossy().into_owned()),
        );
        agent_root.insert(
            "agentDir".to_string(),
            Value::String(agent_dir.to_string_lossy().into_owned()),
        );
        agent_root.insert("default".to_string(), Value::Bool(index == main_index));
    }

    let managed_path_rebaser = ManagedPathRebaser::new(source_runtime_snapshot, runtime);
    if let Some(extra_dirs) =
        get_nested_array_mut(&mut config_root, &["skills", "load", "extraDirs"])
    {
        for extra_dir in extra_dirs.iter_mut() {
            let Some(raw_dir) = extra_dir.as_str() else {
                continue;
            };
            if let Some(rebased_dir) = managed_path_rebaser.rebase(raw_dir) {
                *extra_dir = Value::String(rebased_dir);
            }
        }
    }
    if let Some(plugin_paths) =
        get_nested_array_mut(&mut config_root, &["plugins", "load", "paths"])
    {
        for plugin_path in plugin_paths.iter_mut() {
            let Some(raw_path) = plugin_path.as_str() else {
                continue;
            };
            if let Some(rebased_path) = managed_path_rebaser.rebase(raw_path) {
                *plugin_path = Value::String(rebased_path);
            }
        }
    }
    if let Some(plugin_installs) = get_nested_object_mut(&mut config_root, &["plugins", "installs"])
    {
        for install in plugin_installs.values_mut() {
            let Some(install_root) = install.as_object_mut() else {
                continue;
            };
            rebase_object_string_field(install_root, "installPath", &managed_path_rebaser);
            rebase_object_string_field(install_root, "sourcePath", &managed_path_rebaser);
        }
    }

    fs::write(
        &runtime.config_path,
        format!("{}\n", serde_json::to_string_pretty(&config_root)?),
    )?;

    Ok(())
}

#[derive(Clone, Debug)]
struct ManagedPathRebaser {
    exact_mappings: Vec<ManagedPathRootMapping>,
}

#[derive(Clone, Debug)]
struct ManagedPathRootMapping {
    source_root: String,
    target_root: PathBuf,
}

impl ManagedPathRebaser {
    fn new(
        source_runtime: &OpenClawMirrorRuntimeSnapshot,
        target_runtime: &ActivatedOpenClawRuntime,
    ) -> Self {
        let exact_mappings = vec![
            ManagedPathRootMapping {
                source_root: normalize_rebased_path_input(&source_runtime.workspace_dir),
                target_root: target_runtime.workspace_dir.clone(),
            },
            ManagedPathRootMapping {
                source_root: normalize_rebased_path_input(&source_runtime.state_dir),
                target_root: target_runtime.state_dir.clone(),
            },
            ManagedPathRootMapping {
                source_root: normalize_rebased_path_input(&source_runtime.home_dir),
                target_root: target_runtime.home_dir.clone(),
            },
        ]
        .into_iter()
        .filter(|mapping| !mapping.source_root.is_empty())
        .collect::<Vec<_>>();

        Self { exact_mappings }
    }

    fn rebase(&self, raw: &str) -> Option<String> {
        if !looks_like_absolute_path(raw) {
            return None;
        }

        let normalized = normalize_rebased_path_input(raw);
        if normalized.is_empty() {
            return None;
        }

        for mapping in &self.exact_mappings {
            if let Some(rebased) = rebase_from_exact_mapping(&normalized, mapping) {
                return Some(rebased);
            }
        }

        None
    }
}

fn rebase_from_exact_mapping(normalized: &str, mapping: &ManagedPathRootMapping) -> Option<String> {
    if normalized == mapping.source_root {
        return Some(mapping.target_root.to_string_lossy().into_owned());
    }

    let prefix = format!("{}/", mapping.source_root);
    if !normalized.starts_with(&prefix) {
        return None;
    }

    let suffix = &normalized[prefix.len()..];
    Some(rebased_path_with_suffix(&mapping.target_root, suffix))
}

fn rebased_path_with_suffix(target_root: &Path, suffix: &str) -> String {
    let mut rebased = target_root.to_path_buf();
    for segment in suffix.split('/').filter(|segment| !segment.is_empty()) {
        rebased.push(segment);
    }
    rebased.to_string_lossy().into_owned()
}

fn normalize_rebased_path_input(raw: &str) -> String {
    raw.trim()
        .replace('\\', "/")
        .trim_end_matches('/')
        .to_string()
}

fn looks_like_absolute_path(raw: &str) -> bool {
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return false;
    }

    Path::new(trimmed).is_absolute()
        || trimmed.starts_with('/')
        || trimmed.starts_with("\\\\")
        || trimmed.starts_with("//")
        || matches!(
            trimmed.as_bytes(),
            [drive, b':', slash, ..]
                if drive.is_ascii_alphabetic() && (*slash == b'/' || *slash == b'\\')
        )
}

fn set_nested_string(root: &mut Value, path: &[&str], value: &str) -> Result<()> {
    if path.is_empty() {
        return Ok(());
    }

    let parent = ensure_object_path(root, &path[..path.len() - 1])?;
    parent.insert(
        path[path.len() - 1].to_string(),
        Value::String(value.to_string()),
    );
    Ok(())
}

fn set_nested_u16(root: &mut Value, path: &[&str], value: u16) -> Result<()> {
    if path.is_empty() {
        return Ok(());
    }

    let parent = ensure_object_path(root, &path[..path.len() - 1])?;
    parent.insert(
        path[path.len() - 1].to_string(),
        Value::Number(serde_json::Number::from(u64::from(value))),
    );
    Ok(())
}

fn remove_nested_value(root: &mut Value, path: &[&str]) -> bool {
    if path.is_empty() {
        return false;
    }

    let mut current = root;
    for segment in &path[..path.len() - 1] {
        let Some(object) = current.as_object_mut() else {
            return false;
        };
        let Some(next) = object.get_mut(*segment) else {
            return false;
        };
        current = next;
    }

    current
        .as_object_mut()
        .and_then(|object| object.remove(path[path.len() - 1]))
        .is_some()
}

fn ensure_object_path<'a>(
    root: &'a mut Value,
    path: &[&str],
) -> Result<&'a mut serde_json::Map<String, Value>> {
    let mut current = root;
    for segment in path {
        if !current.is_object() {
            *current = Value::Object(serde_json::Map::new());
        }
        let object = current.as_object_mut().ok_or_else(|| {
            FrameworkError::ValidationFailed(
                "failed to normalize OpenClaw mirror config path to a JSON object".to_string(),
            )
        })?;
        let child = object
            .entry((*segment).to_string())
            .or_insert_with(|| Value::Object(serde_json::Map::new()));
        if !child.is_object() {
            *child = Value::Object(serde_json::Map::new());
        }
        current = child;
    }

    if !current.is_object() {
        *current = Value::Object(serde_json::Map::new());
    }

    current.as_object_mut().ok_or_else(|| {
        FrameworkError::ValidationFailed(
            "failed to resolve OpenClaw mirror config path as a JSON object".to_string(),
        )
    })
}

fn ensure_array_path<'a>(root: &'a mut Value, path: &[&str]) -> Result<&'a mut Vec<Value>> {
    if path.is_empty() {
        return Err(FrameworkError::ValidationFailed(
            "cannot normalize an empty OpenClaw mirror config path as an array".to_string(),
        ));
    }

    let parent = ensure_object_path(root, &path[..path.len() - 1])?;
    let key = path[path.len() - 1];
    if !matches!(parent.get(key), Some(Value::Array(_))) {
        parent.insert(key.to_string(), Value::Array(Vec::new()));
    }

    parent
        .get_mut(key)
        .and_then(Value::as_array_mut)
        .ok_or_else(|| {
            FrameworkError::ValidationFailed(
                "failed to resolve OpenClaw mirror config path as a JSON array".to_string(),
            )
        })
}

fn get_nested_array_mut<'a>(root: &'a mut Value, path: &[&str]) -> Option<&'a mut Vec<Value>> {
    let mut current = root;
    for segment in path {
        let object = current.as_object_mut()?;
        current = object.get_mut(*segment)?;
    }
    current.as_array_mut()
}

fn get_nested_object_mut<'a>(
    root: &'a mut Value,
    path: &[&str],
) -> Option<&'a mut serde_json::Map<String, Value>> {
    let mut current = root;
    for segment in path {
        let object = current.as_object_mut()?;
        current = object.get_mut(*segment)?;
    }
    current.as_object_mut()
}

fn rebase_object_string_field(
    root: &mut serde_json::Map<String, Value>,
    key: &str,
    rebaser: &ManagedPathRebaser,
) {
    let Some(raw_path) = root.get(key).and_then(Value::as_str) else {
        return;
    };
    if let Some(rebased_path) = rebaser.rebase(raw_path) {
        root.insert(key.to_string(), Value::String(rebased_path));
    }
}

fn load_optional_provider_center_catalog(
    staging_root: &Path,
    manifest: &OpenClawMirrorManifestRecord,
) -> Result<Option<LocalAiProxyProviderCenterCatalogSnapshot>> {
    let Some(component) = manifest
        .components
        .iter()
        .find(|component| component.id == STUDIO_ROUTING_COMPONENT_ID)
    else {
        return Ok(None);
    };

    let content = fs::read_to_string(staging_root.join(&component.relative_path))?;
    let catalog = serde_json::from_str::<LocalAiProxyProviderCenterCatalogSnapshot>(&content)?;
    Ok(Some(catalog))
}

fn load_runtime_snapshot(staging_root: &Path) -> Result<OpenClawMirrorRuntimeSnapshot> {
    let runtime_snapshot_path = staging_root.join(PRIVATE_RUNTIME_SNAPSHOT_FILE_NAME);
    if !runtime_snapshot_path.exists() {
        return Err(FrameworkError::NotFound(format!(
            "required openclaw mirror metadata file not found under {}",
            normalize_path(&runtime_snapshot_path)
        )));
    }

    let content = fs::read_to_string(runtime_snapshot_path)?;
    serde_json::from_str::<OpenClawMirrorRuntimeSnapshot>(&content).map_err(Into::into)
}

fn load_openclaw_assets_snapshot(
    staging_root: &Path,
) -> Result<OpenClawMirrorManagedAssetsSnapshot> {
    let managed_assets_path = staging_root.join(PRIVATE_MANAGED_ASSETS_FILE_NAME);
    if !managed_assets_path.exists() {
        return Err(FrameworkError::NotFound(format!(
            "required openclaw mirror metadata file not found under {}",
            normalize_path(&managed_assets_path)
        )));
    }

    let content = fs::read_to_string(managed_assets_path)?;
    serde_json::from_str::<OpenClawMirrorManagedAssetsSnapshot>(&content).map_err(Into::into)
}

fn validate_openclaw_assets_payloads(
    staging_root: &Path,
    manifest: &OpenClawMirrorManifestRecord,
    managed_assets_snapshot: &OpenClawMirrorManagedAssetsSnapshot,
) -> Result<()> {
    if managed_assets_snapshot.schema_version != 1 {
        return Err(FrameworkError::ValidationFailed(format!(
            "unsupported OpenClaw asset inventory schema version: {}",
            managed_assets_snapshot.schema_version
        )));
    }

    for asset in &managed_assets_snapshot.skills {
        validate_openclaw_asset_canonical_root("skill", &asset.anchor, &asset.relative_path)?;
        let path = resolve_staged_openclaw_asset_path(
            staging_root,
            manifest,
            &asset.anchor,
            &asset.relative_path,
        )?;
        if !path.is_dir() {
            return Err(FrameworkError::NotFound(format!(
                "skill asset payload missing from mirror archive: {}",
                normalize_path(&path)
            )));
        }
        if !path.join("SKILL.md").is_file() {
            return Err(FrameworkError::ValidationFailed(format!(
                "skill asset payload is invalid in mirror archive: {}",
                normalize_path(&path)
            )));
        }
    }

    for asset in &managed_assets_snapshot.plugins {
        validate_openclaw_asset_canonical_root("plugin", &asset.anchor, &asset.relative_path)?;
        let path = resolve_staged_openclaw_asset_path(
            staging_root,
            manifest,
            &asset.anchor,
            &asset.relative_path,
        )?;
        match asset.entry_kind.as_str() {
            "directory" if plugin_asset_directory_is_valid(&path) => {}
            "directory" if !path.exists() => {
                return Err(FrameworkError::NotFound(format!(
                    "plugin asset payload missing from mirror archive: {}",
                    normalize_path(&path)
                )))
            }
            "directory" => {
                return Err(FrameworkError::ValidationFailed(format!(
                    "plugin asset payload is invalid in mirror archive: {}",
                    normalize_path(&path)
                )))
            }
            "file" if plugin_asset_file_is_valid(&path) => {}
            "file" if !path.exists() => {
                return Err(FrameworkError::NotFound(format!(
                    "plugin asset payload missing from mirror archive: {}",
                    normalize_path(&path)
                )))
            }
            "file" => {
                return Err(FrameworkError::ValidationFailed(format!(
                    "plugin asset payload is invalid in mirror archive: {}",
                    normalize_path(&path)
                )))
            }
            other => {
                return Err(FrameworkError::ValidationFailed(format!(
                    "plugin asset entry kind is unsupported in mirror archive: {} ({})",
                    normalize_path(&path),
                    other
                )))
            }
        }
    }

    Ok(())
}

fn validate_openclaw_asset_canonical_root(
    asset_kind: &str,
    anchor: &str,
    relative_path: &str,
) -> Result<()> {
    let normalized = relative_path.trim().replace('\\', "/");
    if normalized.is_empty() {
        return Ok(());
    }

    let canonical_root = match (asset_kind, anchor.trim()) {
        ("skill", "state") => "skills",
        ("skill", "workspace") => "skills",
        ("plugin", "state") => "extensions",
        ("plugin", "workspace") => ".openclaw/extensions",
        _ => {
            return Err(FrameworkError::ValidationFailed(format!(
                "unsupported {asset_kind} asset anchor in mirror archive: {}",
                anchor.trim()
            )))
        }
    };

    if managed_asset_path_has_canonical_root(&normalized, canonical_root) {
        return Ok(());
    }

    Err(FrameworkError::ValidationFailed(format!(
        "{asset_kind} asset inventory path is outside the canonical root for anchor {}: {} (expected under {})",
        anchor.trim(),
        relative_path.trim(),
        canonical_root
    )))
}

fn managed_asset_path_has_canonical_root(relative_path: &str, canonical_root: &str) -> bool {
    let path_segments = relative_path
        .split('/')
        .filter(|segment| !segment.is_empty())
        .collect::<Vec<_>>();
    let root_segments = canonical_root
        .split('/')
        .filter(|segment| !segment.is_empty())
        .collect::<Vec<_>>();

    path_segments.len() >= root_segments.len()
        && path_segments
            .iter()
            .zip(root_segments.iter())
            .all(|(left, right)| left == right)
}

fn validate_manifest_runtime_summary(
    manifest_runtime: &OpenClawMirrorManifestRuntimeSnapshot,
    runtime_snapshot: &OpenClawMirrorRuntimeSnapshot,
) -> Result<()> {
    validate_runtime_summary_field(
        "runtimeId",
        &manifest_runtime.runtime_id,
        &runtime_snapshot.runtime_id,
    )?;
    validate_runtime_summary_optional_field(
        "installKey",
        manifest_runtime.install_key.as_deref(),
        runtime_snapshot.install_key.as_deref(),
    )?;
    validate_runtime_summary_optional_field(
        "openclawVersion",
        manifest_runtime.openclaw_version.as_deref(),
        runtime_snapshot.openclaw_version.as_deref(),
    )?;
    validate_runtime_summary_optional_field(
        "nodeVersion",
        manifest_runtime.node_version.as_deref(),
        runtime_snapshot.node_version.as_deref(),
    )?;
    validate_runtime_summary_field(
        "platform",
        &manifest_runtime.platform,
        &runtime_snapshot.platform,
    )?;
    validate_runtime_summary_field("arch", &manifest_runtime.arch, &runtime_snapshot.arch)?;

    Ok(())
}

fn validate_runtime_summary_field(
    field: &str,
    manifest_value: &str,
    runtime_value: &str,
) -> Result<()> {
    if manifest_value.trim() == runtime_value.trim() {
        return Ok(());
    }

    Err(FrameworkError::ValidationFailed(format!(
        "openclaw mirror runtime summary mismatch for {}: manifest {} runtime {}",
        field,
        manifest_value.trim(),
        runtime_value.trim()
    )))
}

fn validate_runtime_summary_optional_field(
    field: &str,
    manifest_value: Option<&str>,
    runtime_value: Option<&str>,
) -> Result<()> {
    let normalized_manifest = manifest_value
        .map(str::trim)
        .filter(|value| !value.is_empty());
    let normalized_runtime = runtime_value
        .map(str::trim)
        .filter(|value| !value.is_empty());
    if normalized_manifest == normalized_runtime {
        return Ok(());
    }

    Err(FrameworkError::ValidationFailed(format!(
        "openclaw mirror runtime summary mismatch for {}: manifest {} runtime {}",
        field,
        normalized_manifest.unwrap_or("<none>"),
        normalized_runtime.unwrap_or("<none>")
    )))
}

fn reproject_local_ai_proxy(
    paths: &AppPaths,
    config: &AppConfig,
    storage: &StorageService,
    local_ai_proxy: &LocalAiProxyService,
) -> Result<OpenClawMirrorLocalProxyReprojection> {
    let snapshot = local_ai_proxy.ensure_snapshot(paths, config, storage)?;
    let health = local_ai_proxy.start(paths, snapshot.clone())?;
    local_ai_proxy.project_managed_openclaw_provider(paths, &snapshot, &health)?;
    Ok(OpenClawMirrorLocalProxyReprojection { snapshot, health })
}

fn repair_local_managed_plugin_installs(
    paths: &AppPaths,
    runtime: &ActivatedOpenClawRuntime,
) -> Result<()> {
    let config_text = fs::read_to_string(&runtime.config_path)?;
    let config_root = serde_json::from_str::<Value>(&config_text)?;
    let Some(installs) = config_root
        .get("plugins")
        .and_then(Value::as_object)
        .and_then(|plugins| plugins.get("installs"))
        .and_then(Value::as_object)
    else {
        return Ok(());
    };

    for install in installs.values() {
        let Some(install_root) = install.as_object() else {
            continue;
        };
        if install_root
            .get("source")
            .and_then(Value::as_str)
            .map(str::trim)
            != Some("local")
        {
            continue;
        }

        let Some(source_path) = install_root
            .get("sourcePath")
            .and_then(Value::as_str)
            .and_then(|raw| managed_absolute_path(raw, paths))
        else {
            continue;
        };
        let Some(install_path) = install_root
            .get("installPath")
            .and_then(Value::as_str)
            .and_then(|raw| managed_absolute_path(raw, paths))
        else {
            continue;
        };

        if install_path.exists()
            || source_path == install_path
            || !source_path.is_dir()
            || !plugin_root_has_descriptor(&source_path)
        {
            continue;
        }

        copy_directory_recursive(&source_path, &install_path)?;
    }

    Ok(())
}

fn build_post_restore_verification(
    paths: &AppPaths,
    config: &AppConfig,
    storage: &StorageService,
    local_ai_proxy: &LocalAiProxyService,
    provider_center_catalog: Option<&LocalAiProxyProviderCenterCatalogSnapshot>,
    managed_assets_snapshot: &OpenClawMirrorManagedAssetsSnapshot,
    local_proxy_projection: &OpenClawMirrorLocalProxyReprojection,
    restart_gateway: bool,
    gateway_running_after_import: bool,
    checked_at: &str,
) -> OpenClawMirrorImportVerification {
    let readable_config_path = readable_openclaw_config_path(paths);
    let config_path_label = readable_config_path
        .as_ref()
        .map(|path| normalize_path(path))
        .unwrap_or_else(|error| format!("unresolved OpenClaw config path ({error})"));
    let config_text = readable_config_path
        .as_ref()
        .ok()
        .and_then(|path| fs::read_to_string(path).ok());
    let config_root = config_text
        .as_deref()
        .and_then(|content| serde_json::from_str::<Value>(content).ok());

    let mut checks = vec![
        verify_openclaw_config_file(&config_path_label, config_root.as_ref()),
        verify_managed_state(paths),
        verify_managed_workspace(paths),
        verify_openclaw_skill_assets(
            paths,
            config_root.as_ref(),
            Some(managed_assets_snapshot.skills.as_slice()),
        ),
        verify_openclaw_plugin_assets(
            paths,
            config_root.as_ref(),
            Some(managed_assets_snapshot.plugins.as_slice()),
        ),
        verify_provider_center_catalog(paths, config, storage, provider_center_catalog),
        verify_local_proxy(local_ai_proxy, local_proxy_projection),
        verify_managed_openclaw_provider(config_root.as_ref(), local_proxy_projection),
        verify_gateway_state(restart_gateway, gateway_running_after_import),
    ];

    let status = if checks.iter().any(|check| check.status == "failed") {
        "degraded".to_string()
    } else {
        "ready".to_string()
    };

    checks.shrink_to_fit();

    OpenClawMirrorImportVerification {
        checked_at: checked_at.to_string(),
        status,
        checks,
    }
}

fn verify_openclaw_config_file(
    config_path: &str,
    config_root: Option<&Value>,
) -> OpenClawMirrorImportVerificationCheck {
    if config_root.is_some() {
        verification_check(
            "openclaw-config-file",
            "OpenClaw config file restored",
            "passed",
            format!("Restored OpenClaw config file is present and readable at {config_path}."),
        )
    } else {
        verification_check(
            "openclaw-config-file",
            "OpenClaw config file restored",
            "failed",
            format!("OpenClaw config file is missing or invalid after import at {config_path}."),
        )
    }
}

fn readable_openclaw_config_path(paths: &AppPaths) -> Result<PathBuf> {
    active_openclaw_config_path(paths)
}

fn active_openclaw_config_path(paths: &AppPaths) -> Result<PathBuf> {
    KernelRuntimeAuthorityService::new().active_config_file_path("openclaw", paths)
}

fn verify_managed_state(paths: &AppPaths) -> OpenClawMirrorImportVerificationCheck {
    let state_path = normalize_path(&paths.openclaw_root_dir);
    if paths.openclaw_root_dir.is_dir() {
        verification_check(
            "managed-state",
            "OpenClaw state restored",
            "passed",
            format!("Restored OpenClaw state directory is present at {state_path}."),
        )
    } else {
        verification_check(
            "managed-state",
            "OpenClaw state restored",
            "failed",
            format!("OpenClaw state directory is missing after import at {state_path}."),
        )
    }
}

fn verify_managed_workspace(paths: &AppPaths) -> OpenClawMirrorImportVerificationCheck {
    let workspace_path = normalize_path(&paths.openclaw_workspace_dir);
    if paths.openclaw_workspace_dir.is_dir() {
        verification_check(
            "managed-workspace",
            "OpenClaw workspace restored",
            "passed",
            format!("Restored OpenClaw workspace directory is present at {workspace_path}."),
        )
    } else {
        verification_check(
            "managed-workspace",
            "OpenClaw workspace restored",
            "failed",
            format!("OpenClaw workspace directory is missing after import at {workspace_path}."),
        )
    }
}

fn verify_openclaw_skill_assets(
    paths: &AppPaths,
    config_root: Option<&Value>,
    managed_assets: Option<&[OpenClawMirrorManagedSkillAssetRecord]>,
) -> OpenClawMirrorImportVerificationCheck {
    let Some(root) = config_root else {
        return verification_check(
            "managed-skills",
            "Skill folders restored",
            "skipped",
            "OpenClaw config file could not be parsed to verify restored skill folders."
                .to_string(),
        );
    };

    let managed_dirs = collect_managed_skill_dirs_from_config(root, paths);
    let managed_assets = managed_assets.unwrap_or(&[]);

    if managed_dirs.is_empty() && managed_assets.is_empty() {
        return verification_check(
            "managed-skills",
            "Skill folders restored",
            "skipped",
            "Restored OpenClaw config file does not declare skill paths, and the archive did not include skill asset inventory."
                .to_string(),
        );
    }

    let mut failures = managed_dirs
        .iter()
        .filter(|path| !path.is_dir())
        .map(|path| format!("skill dir missing: {}", normalize_path(path)))
        .collect::<Vec<_>>();

    failures.extend(
        managed_assets
            .iter()
            .filter_map(|asset| {
                let path = resolve_openclaw_asset_path(paths, &asset.anchor, &asset.relative_path)?;
                if path.is_dir() && path.join("SKILL.md").is_file() {
                    None
                } else {
                    Some(format!("skill asset missing: {}", normalize_path(&path)))
                }
            })
            .collect::<Vec<_>>(),
    );

    if failures.is_empty() {
        verification_check(
            "managed-skills",
            "Skill folders restored",
            "passed",
            format!(
                "Verified {} skill directories and {} inventoried skill assets restored from the mirror.",
                managed_dirs.len(),
                managed_assets.len()
            ),
        )
    } else {
        verification_check(
            "managed-skills",
            "Skill folders restored",
            "failed",
            failures.join(", "),
        )
    }
}

fn verify_openclaw_plugin_assets(
    paths: &AppPaths,
    config_root: Option<&Value>,
    managed_assets: Option<&[OpenClawMirrorManagedPluginAssetRecord]>,
) -> OpenClawMirrorImportVerificationCheck {
    let Some(root) = config_root else {
        return verification_check(
            "managed-plugins",
            "Plugin assets restored",
            "skipped",
            "OpenClaw config file could not be parsed to verify restored plugin assets."
                .to_string(),
        );
    };

    let targets = collect_managed_plugin_targets_from_config(root, paths);
    let managed_assets = managed_assets.unwrap_or(&[]);

    if targets.is_empty() && managed_assets.is_empty() {
        return verification_check(
            "managed-plugins",
            "Plugin assets restored",
            "skipped",
            "Restored OpenClaw config file does not declare plugin filesystem paths, and the archive did not include plugin asset inventory."
                .to_string(),
        );
    }

    let mut failures = targets
        .iter()
        .filter_map(|target| {
            if !target.path.exists() {
                return Some(format!(
                    "{}={} (missing)",
                    target.label,
                    normalize_path(&target.path)
                ));
            }
            if !target.path.is_dir() {
                return Some(format!(
                    "{}={} (not a directory)",
                    target.label,
                    normalize_path(&target.path)
                ));
            }
            if target.requires_plugin_descriptor && !plugin_root_has_descriptor(&target.path) {
                return Some(format!(
                    "{}={} (missing plugin.json/package.json)",
                    target.label,
                    normalize_path(&target.path)
                ));
            }
            None
        })
        .collect::<Vec<_>>();

    failures.extend(
        managed_assets
            .iter()
            .filter_map(|asset| {
                let path = resolve_openclaw_asset_path(paths, &asset.anchor, &asset.relative_path)?;
                match asset.entry_kind.as_str() {
                    "directory" if plugin_asset_directory_is_valid(&path) => None,
                    "directory" => Some(format!(
                        "plugin asset missing or invalid: {}",
                        normalize_path(&path)
                    )),
                    "file" if plugin_asset_file_is_valid(&path) => None,
                    "file" => Some(format!(
                        "plugin asset missing or invalid: {}",
                        normalize_path(&path)
                    )),
                    other => Some(format!(
                        "plugin asset entry kind is unsupported: {} ({})",
                        normalize_path(&path),
                        other
                    )),
                }
            })
            .collect::<Vec<_>>(),
    );

    if failures.is_empty() {
        verification_check(
            "managed-plugins",
            "Plugin assets restored",
            "passed",
            format!(
                "Verified {} plugin filesystem references and {} inventoried plugin assets restored from the mirror.",
                targets.len(),
                managed_assets.len()
            ),
        )
    } else {
        verification_check(
            "managed-plugins",
            "Plugin assets restored",
            "failed",
            format!(
                "Plugin filesystem references are invalid after restore: {}",
                failures.join(", ")
            ),
        )
    }
}

#[derive(Clone, Debug)]
struct ManagedPluginVerificationTarget {
    label: String,
    path: PathBuf,
    requires_plugin_descriptor: bool,
}

fn collect_managed_skill_dirs_from_config(root: &Value, paths: &AppPaths) -> Vec<PathBuf> {
    root.get("skills")
        .and_then(Value::as_object)
        .and_then(|skills| skills.get("load"))
        .and_then(Value::as_object)
        .and_then(|load| load.get("extraDirs"))
        .and_then(Value::as_array)
        .map(|dirs| {
            dirs.iter()
                .filter_map(Value::as_str)
                .filter_map(|raw| managed_absolute_path(raw, paths))
                .collect::<Vec<_>>()
        })
        .unwrap_or_default()
}

fn collect_managed_plugin_targets_from_config(
    root: &Value,
    paths: &AppPaths,
) -> Vec<ManagedPluginVerificationTarget> {
    let mut targets = root
        .get("plugins")
        .and_then(Value::as_object)
        .and_then(|plugins| plugins.get("load"))
        .and_then(Value::as_object)
        .and_then(|load| load.get("paths"))
        .and_then(Value::as_array)
        .map(|paths_array| {
            paths_array
                .iter()
                .filter_map(Value::as_str)
                .filter_map(|raw| managed_absolute_path(raw, paths))
                .map(|path| ManagedPluginVerificationTarget {
                    label: "plugins.load.paths".to_string(),
                    path,
                    requires_plugin_descriptor: false,
                })
                .collect::<Vec<_>>()
        })
        .unwrap_or_default();

    if let Some(installs) = root
        .get("plugins")
        .and_then(Value::as_object)
        .and_then(|plugins| plugins.get("installs"))
        .and_then(Value::as_object)
    {
        for (plugin_id, install) in installs {
            let Some(install_root) = install.as_object() else {
                continue;
            };
            if let Some(path) = install_root
                .get("sourcePath")
                .and_then(Value::as_str)
                .and_then(|raw| managed_absolute_path(raw, paths))
            {
                targets.push(ManagedPluginVerificationTarget {
                    label: format!("plugins.installs.{plugin_id}.sourcePath"),
                    path,
                    requires_plugin_descriptor: false,
                });
            }
            if let Some(path) = install_root
                .get("installPath")
                .and_then(Value::as_str)
                .and_then(|raw| managed_absolute_path(raw, paths))
            {
                targets.push(ManagedPluginVerificationTarget {
                    label: format!("plugins.installs.{plugin_id}.installPath"),
                    path,
                    requires_plugin_descriptor: true,
                });
            }
        }
    }

    targets
}

fn managed_absolute_path(raw: &str, paths: &AppPaths) -> Option<PathBuf> {
    if !looks_like_absolute_path(raw) {
        return None;
    }

    let candidate = PathBuf::from(raw.trim());
    if is_path_within_managed_roots(&candidate, paths) {
        Some(candidate)
    } else {
        None
    }
}

fn is_path_within_managed_roots(path: &Path, paths: &AppPaths) -> bool {
    path.starts_with(&paths.openclaw_root_dir) || path.starts_with(&paths.openclaw_workspace_dir)
}

fn resolve_openclaw_asset_path(
    paths: &AppPaths,
    anchor: &str,
    relative_path: &str,
) -> Option<PathBuf> {
    let base = match anchor.trim() {
        "state" => paths.openclaw_root_dir.clone(),
        "workspace" => paths.openclaw_workspace_dir.clone(),
        _ => return None,
    };

    let normalized = relative_path.trim().replace('\\', "/");
    let mut resolved = base;
    for segment in normalized.split('/').filter(|segment| !segment.is_empty()) {
        resolved.push(segment);
    }
    Some(resolved)
}

fn resolve_staged_openclaw_asset_path(
    staging_root: &Path,
    manifest: &OpenClawMirrorManifestRecord,
    anchor: &str,
    relative_path: &str,
) -> Result<PathBuf> {
    let component_id = match anchor.trim() {
        "state" => "state",
        "workspace" => "workspace",
        other => {
            return Err(FrameworkError::ValidationFailed(format!(
                "OpenClaw asset inventory uses unsupported anchor: {other}"
            )))
        }
    };

    let component = manifest
        .components
        .iter()
        .find(|item| item.id == component_id)
        .ok_or_else(|| {
            FrameworkError::ValidationFailed(format!(
                "OpenClaw asset inventory references missing component: {component_id}"
            ))
        })?;
    let mut resolved = staging_root.join(&component.relative_path);
    let normalized = relative_path.trim().replace('\\', "/");
    if normalized.is_empty() {
        return Err(FrameworkError::ValidationFailed(format!(
            "OpenClaw asset inventory relative path is empty for anchor {component_id}"
        )));
    }

    for segment in normalized.split('/').filter(|segment| !segment.is_empty()) {
        if matches!(segment, "." | "..") {
            return Err(FrameworkError::ValidationFailed(format!(
                "OpenClaw asset inventory relative path is invalid for anchor {component_id}: {relative_path}"
            )));
        }
        resolved.push(segment);
    }

    Ok(resolved)
}

fn plugin_root_has_descriptor(path: &Path) -> bool {
    path.join("plugin.json").is_file() || path.join("package.json").is_file()
}

fn plugin_asset_directory_is_valid(path: &Path) -> bool {
    path.is_dir()
        && (plugin_root_has_descriptor(path)
            || plugin_entrypoint_names()
                .iter()
                .any(|name| path.join(name).is_file()))
}

fn plugin_asset_file_is_valid(path: &Path) -> bool {
    path.is_file()
        && path
            .file_name()
            .and_then(|value| value.to_str())
            .map(|value| plugin_entrypoint_names().contains(&value))
            .unwrap_or(false)
}

fn plugin_entrypoint_names() -> &'static [&'static str] {
    &[
        "index.ts",
        "index.js",
        "index.mjs",
        "index.cjs",
        "index.mts",
        "index.cts",
    ]
}

fn verify_provider_center_catalog(
    paths: &AppPaths,
    config: &AppConfig,
    storage: &StorageService,
    provider_center_catalog: Option<&LocalAiProxyProviderCenterCatalogSnapshot>,
) -> OpenClawMirrorImportVerificationCheck {
    let Some(catalog) = provider_center_catalog else {
        return verification_check(
            "provider-center-catalog",
            "Provider Center catalog restored",
            "skipped",
            "Mirror source did not include a Provider Center route catalog.".to_string(),
        );
    };

    let Some(profile_id) = resolve_provider_center_profile_id(config) else {
        return verification_check(
            "provider-center-catalog",
            "Provider Center catalog restored",
            "failed",
            "No writable storage profile is available for the Provider Center route catalog."
                .to_string(),
        );
    };

    let listed = match storage.list_keys(
        paths,
        config,
        StorageListKeysRequest {
            profile_id: Some(profile_id.clone()),
            namespace: Some(LOCAL_AI_PROXY_PROVIDER_CENTER_NAMESPACE.to_string()),
        },
    ) {
        Ok(value) => value,
        Err(error) => {
            return verification_check(
                "provider-center-catalog",
                "Provider Center catalog restored",
                "failed",
                format!("Failed to list restored Provider Center routes: {error}"),
            )
        }
    };

    let mut actual_keys = listed.keys;
    actual_keys.sort();
    let expected_keys = catalog
        .routes
        .iter()
        .map(|route| route.key.clone())
        .collect::<Vec<_>>();

    if actual_keys != expected_keys {
        return verification_check(
            "provider-center-catalog",
            "Provider Center catalog restored",
            "failed",
            format!(
                "Provider Center route keys differ after restore. expected={expected_keys:?} actual={actual_keys:?}"
            ),
        );
    }

    for route in &catalog.routes {
        let restored = match storage.get_text(
            paths,
            config,
            StorageGetTextRequest {
                profile_id: Some(profile_id.clone()),
                namespace: Some(LOCAL_AI_PROXY_PROVIDER_CENTER_NAMESPACE.to_string()),
                key: route.key.clone(),
            },
        ) {
            Ok(value) => value.value.unwrap_or_default(),
            Err(error) => {
                return verification_check(
                    "provider-center-catalog",
                    "Provider Center catalog restored",
                    "failed",
                    format!(
                        "Failed to read restored Provider Center route {}: {error}",
                        route.key
                    ),
                )
            }
        };

        if restored != route.value {
            return verification_check(
                "provider-center-catalog",
                "Provider Center catalog restored",
                "failed",
                format!(
                    "Provider Center route {} does not match the restored archive payload.",
                    route.key
                ),
            );
        }
    }

    verification_check(
        "provider-center-catalog",
        "Provider Center catalog restored",
        "passed",
        format!(
            "Restored {} Provider Center route records into {}.",
            catalog.routes.len(),
            LOCAL_AI_PROXY_PROVIDER_CENTER_NAMESPACE
        ),
    )
}

fn verify_local_proxy(
    local_ai_proxy: &LocalAiProxyService,
    local_proxy_projection: &OpenClawMirrorLocalProxyReprojection,
) -> OpenClawMirrorImportVerificationCheck {
    let status = match local_ai_proxy.status() {
        Ok(value) => value,
        Err(error) => {
            return verification_check(
                "local-proxy",
                "Local proxy projected",
                "failed",
                format!("Failed to read local proxy status after restore: {error}"),
            )
        }
    };

    let Some(health) = status.health.as_ref() else {
        return verification_check(
            "local-proxy",
            "Local proxy projected",
            "failed",
            format!(
                "Local proxy reported {:?} lifecycle without health details after restore.",
                status.lifecycle
            ),
        );
    };

    let snapshot_exists = Path::new(&health.snapshot_path).exists();
    let matches_projection = status.lifecycle == LocalAiProxyLifecycle::Running
        && health.base_url == local_proxy_projection.health.base_url
        && health.default_route_id == local_proxy_projection.health.default_route_id
        && health.model_count == local_proxy_projection.health.model_count
        && snapshot_exists;

    if matches_projection {
        verification_check(
            "local-proxy",
            "Local proxy projected",
            "passed",
            format!(
                "Local proxy is running at {} with default route {}.",
                health.base_url, health.default_route_id
            ),
        )
    } else {
        verification_check(
            "local-proxy",
            "Local proxy projected",
            "failed",
            format!(
                "Local proxy health does not match the restored projection. lifecycle={:?} baseUrl={} defaultRoute={} snapshotExists={snapshot_exists}",
                status.lifecycle,
                health.base_url,
                health.default_route_id
            ),
        )
    }
}

fn verify_managed_openclaw_provider(
    config_root: Option<&Value>,
    local_proxy_projection: &OpenClawMirrorLocalProxyReprojection,
) -> OpenClawMirrorImportVerificationCheck {
    let Some(root) = config_root else {
        return verification_check(
            "managed-openclaw-provider",
            "OpenClaw provider projected",
            "failed",
            "OpenClaw config file could not be parsed to verify the projected provider."
                .to_string(),
        );
    };

    let Some(route) = local_proxy_projection.snapshot.default_route() else {
        return verification_check(
            "managed-openclaw-provider",
            "OpenClaw provider projected",
            "failed",
            "Restored local proxy snapshot has no default route for OpenClaw provider projection."
                .to_string(),
        );
    };

    let expected_model_id = match resolve_verification_default_route_model_id(route) {
        Some(value) => value,
        None => {
            return verification_check(
                "managed-openclaw-provider",
                "OpenClaw provider projected",
                "failed",
                "Restored local proxy default route does not expose a default model.".to_string(),
            )
        }
    };
    let expected_base_url = resolve_verification_projected_openclaw_provider_base_url(
        route,
        &local_proxy_projection.health,
    );
    let expected_api_key = OPENCLAW_LOCAL_PROXY_API_KEY_PLACEHOLDER;

    let provider_root = root
        .get("models")
        .and_then(Value::as_object)
        .and_then(|models| models.get("providers"))
        .and_then(Value::as_object)
        .and_then(|providers| providers.get("sdkwork-local-proxy"))
        .and_then(Value::as_object);

    let Some(provider_root) = provider_root else {
        return verification_check(
            "managed-openclaw-provider",
            "OpenClaw provider projected",
            "failed",
            "sdkwork-local-proxy provider is missing from openclaw.json.".to_string(),
        );
    };

    let base_url_matches = provider_root
        .get("baseUrl")
        .and_then(Value::as_str)
        .map(str::trim)
        == Some(expected_base_url.as_str());
    let api_key_matches = provider_root
        .get("apiKey")
        .and_then(Value::as_str)
        .map(str::trim)
        == Some(expected_api_key);
    let models_contain_default = provider_root
        .get("models")
        .and_then(Value::as_array)
        .map(|models| {
            models.iter().any(|model| {
                model.get("id").and_then(Value::as_str).map(str::trim)
                    == Some(expected_model_id.as_str())
            })
        })
        .unwrap_or(false);

    if base_url_matches && api_key_matches && models_contain_default {
        verification_check(
            "managed-openclaw-provider",
            "OpenClaw provider projected",
            "passed",
            format!(
                "sdkwork-local-proxy provider targets {} with default model {}.",
                expected_base_url, expected_model_id
            ),
        )
    } else {
        verification_check(
            "managed-openclaw-provider",
            "OpenClaw provider projected",
            "failed",
            format!(
                "sdkwork-local-proxy provider did not match the restored projection. baseUrlMatches={} apiKeyMatches={} modelsContainDefault={}",
                base_url_matches, api_key_matches, models_contain_default
            ),
        )
    }
}

fn verify_gateway_state(
    restart_gateway: bool,
    gateway_running_after_import: bool,
) -> OpenClawMirrorImportVerificationCheck {
    if gateway_running_after_import == restart_gateway {
        verification_check(
            "gateway",
            "Gateway state matches request",
            "passed",
            format!(
                "Gateway running state after import matches the requested post-restore behavior (restartGateway={restart_gateway})."
            ),
        )
    } else {
        verification_check(
            "gateway",
            "Gateway state matches request",
            "failed",
            format!(
                "Gateway running state after import did not match the requested post-restore behavior (restartGateway={restart_gateway}, running={gateway_running_after_import})."
            ),
        )
    }
}

fn resolve_verification_default_route_model_id(
    route: &super::local_ai_proxy_snapshot::LocalAiProxyRouteSnapshot,
) -> Option<String> {
    route
        .default_model_id
        .trim()
        .to_string()
        .chars()
        .next()
        .map(|_| route.default_model_id.trim().to_string())
        .or_else(|| route.models.first().map(|model| model.id.clone()))
}

fn resolve_verification_projected_openclaw_provider_base_url(
    route: &super::local_ai_proxy_snapshot::LocalAiProxyRouteSnapshot,
    health: &LocalAiProxyServiceHealth,
) -> String {
    let trimmed = health.base_url.trim();
    if route.client_protocol.trim() != "gemini" {
        return trimmed.to_string();
    }

    let root = trimmed.trim_end_matches("/v1").trim_end_matches('/');
    if root.is_empty() {
        trimmed.to_string()
    } else {
        root.to_string()
    }
}

fn verification_check(
    id: &str,
    label: &str,
    status: &str,
    detail: String,
) -> OpenClawMirrorImportVerificationCheck {
    OpenClawMirrorImportVerificationCheck {
        id: id.to_string(),
        label: label.to_string(),
        status: status.to_string(),
        detail,
    }
}

fn create_safety_snapshot(
    paths: &AppPaths,
    config: &AppConfig,
    storage: &StorageService,
    runtime: &ActivatedOpenClawRuntime,
) -> Result<OpenClawMirrorSafetySnapshotRecord> {
    let destination_path = paths
        .backups_dir
        .join(format!("openclaw-safety-{}.ocmirror", Uuid::new_v4()));
    let exported = export_phase1_full_private_mirror(
        &OpenClawMirrorExportRequest {
            mode: "full-private".to_string(),
            destination_path,
        },
        paths,
        config,
        storage,
        runtime,
    )?;

    Ok(OpenClawMirrorSafetySnapshotRecord {
        destination_path: exported.destination_path,
        file_name: exported.file_name,
        file_size_bytes: exported.file_size_bytes,
        created_at: exported.exported_at,
    })
}

fn run_post_import_doctor(paths: &AppPaths, runtime: &ActivatedOpenClawRuntime) -> Result<()> {
    let mut command = Command::new(&runtime.node_path);
    configure_hidden_child_process(&mut command);
    command.arg(&runtime.cli_path);
    command.arg("doctor");
    command.arg("--fix");
    command.arg("--non-interactive");
    command.arg("--yes");
    command.current_dir(&runtime.runtime_dir);
    command.env("PATH", prepend_path_env(&paths.user_bin_dir));
    command.envs(runtime.managed_env_with_local_ai_proxy(paths)?);

    let output = command.output()?;
    if output.status.success() {
        return Ok(());
    }

    let stderr_tail = String::from_utf8_lossy(&output.stderr).trim().to_string();
    let stdout_tail = String::from_utf8_lossy(&output.stdout).trim().to_string();

    Err(FrameworkError::ProcessFailed {
        command: format!(
            "{} {} doctor --fix --non-interactive --yes",
            runtime.node_path.display(),
            runtime.cli_path.display()
        ),
        exit_code: output.status.code(),
        stderr_tail: if stderr_tail.is_empty() {
            stdout_tail
        } else {
            stderr_tail
        },
    })
}

fn load_manifest_from_staging(staging_root: &Path) -> Result<OpenClawMirrorManifestRecord> {
    let manifest_path = staging_root.join("manifest.json");
    let content = fs::read_to_string(&manifest_path)?;
    serde_json::from_str::<OpenClawMirrorManifestRecord>(&content).map_err(Into::into)
}

fn validate_manifest(manifest: &OpenClawMirrorManifestRecord) -> Result<()> {
    if manifest.schema_version != 1 {
        return Err(FrameworkError::ValidationFailed(format!(
            "unsupported openclaw mirror schema version: {}",
            manifest.schema_version
        )));
    }

    if manifest.mode != "full-private" {
        return Err(FrameworkError::InvalidOperation(format!(
            "unsupported openclaw mirror import mode: {}",
            manifest.mode
        )));
    }

    if manifest.runtime.runtime_id != "openclaw" {
        return Err(FrameworkError::ValidationFailed(format!(
            "unsupported openclaw mirror runtime id: {}",
            manifest.runtime.runtime_id
        )));
    }

    let mut component_ids = HashSet::new();
    let mut metadata_ids = HashSet::new();
    let mut declared_relative_paths = HashSet::new();
    for component in &manifest.components {
        let component_id = component.id.trim();
        if !component_ids.insert(component_id.to_string()) {
            return Err(FrameworkError::ValidationFailed(format!(
                "duplicate openclaw mirror component id: {component_id}"
            )));
        }

        validate_manifest_relative_path(
            &component.relative_path,
            &format!("component {}", component_id),
        )?;
        validate_manifest_component_descriptor(component)?;
        let relative_path = manifest_component_relative_path_identity(&component.relative_path);
        if !declared_relative_paths.insert(relative_path.clone()) {
            return Err(FrameworkError::ValidationFailed(format!(
                "duplicate openclaw mirror component relative path: {}",
                component.relative_path.trim()
            )));
        }
    }

    for metadata_file in &manifest.metadata_files {
        let metadata_id = metadata_file.id.trim();
        if !metadata_ids.insert(metadata_id.to_string()) {
            return Err(FrameworkError::ValidationFailed(format!(
                "duplicate openclaw mirror metadata file id: {metadata_id}"
            )));
        }

        validate_manifest_relative_path(
            &metadata_file.relative_path,
            &format!("metadata file {}", metadata_id),
        )?;
        let relative_path = manifest_component_relative_path_identity(&metadata_file.relative_path);
        if !declared_relative_paths.insert(relative_path) {
            return Err(FrameworkError::ValidationFailed(format!(
                "duplicate openclaw mirror metadata file relative path: {}",
                metadata_file.relative_path.trim()
            )));
        }

        match metadata_id {
            RUNTIME_SNAPSHOT_METADATA_ID
                if metadata_file.relative_path.trim() != PRIVATE_RUNTIME_SNAPSHOT_FILE_NAME => {}
            MANAGED_ASSETS_METADATA_ID
                if metadata_file.relative_path.trim() != PRIVATE_MANAGED_ASSETS_FILE_NAME => {}
            RUNTIME_SNAPSHOT_METADATA_ID | MANAGED_ASSETS_METADATA_ID => continue,
            other => {
                return Err(FrameworkError::ValidationFailed(format!(
                    "unsupported openclaw mirror metadata file id: {other}"
                )))
            }
        }

        let expected_relative_path = if metadata_id == RUNTIME_SNAPSHOT_METADATA_ID {
            PRIVATE_RUNTIME_SNAPSHOT_FILE_NAME
        } else {
            PRIVATE_MANAGED_ASSETS_FILE_NAME
        };

        return Err(FrameworkError::ValidationFailed(format!(
            "openclaw mirror metadata file {metadata_id} must use relative path {expected_relative_path}"
        )));
    }

    for required_metadata_id in [RUNTIME_SNAPSHOT_METADATA_ID, MANAGED_ASSETS_METADATA_ID] {
        if !metadata_ids.contains(required_metadata_id) {
            return Err(FrameworkError::ValidationFailed(format!(
                "incomplete openclaw mirror metadata file set: missing {}",
                required_metadata_id
            )));
        }
    }

    for required_component_id in ["config", "state", "workspace"] {
        if !manifest
            .components
            .iter()
            .any(|component| component.id == required_component_id)
        {
            return Err(FrameworkError::ValidationFailed(format!(
                "openclaw mirror import is missing required component: {required_component_id}"
            )));
        }
    }

    Ok(())
}

fn manifest_component_relative_path_identity(relative_path: &str) -> String {
    relative_path
        .trim()
        .replace('\\', "/")
        .trim_matches('/')
        .to_lowercase()
}

fn validate_manifest_relative_path(raw_path: &str, label: &str) -> Result<()> {
    validate_archive_entry_name(raw_path).map_err(|_| {
        FrameworkError::ValidationFailed(format!(
            "unsafe openclaw mirror manifest relative path for {label}: {raw_path}"
        ))
    })?;

    if manifest_component_relative_path_identity(raw_path).is_empty() {
        return Err(FrameworkError::ValidationFailed(format!(
            "unsafe openclaw mirror manifest relative path for {label}: {raw_path}"
        )));
    }

    Ok(())
}

fn validate_manifest_component_descriptor(
    component: &OpenClawMirrorManifestComponentRecord,
) -> Result<()> {
    let (expected_kind, expected_relative_path) = match component.id.trim() {
        "config" => ("config", "components/config/openclaw.json"),
        "state" => ("state", "components/state"),
        "workspace" => ("workspace", "components/workspace"),
        STUDIO_ROUTING_COMPONENT_ID => (
            STUDIO_ROUTING_COMPONENT_KIND,
            STUDIO_ROUTING_COMPONENT_RELATIVE_PATH,
        ),
        other => {
            return Err(FrameworkError::ValidationFailed(format!(
                "unsupported openclaw mirror component id: {other}"
            )));
        }
    };

    let kind_matches = component.kind.trim() == expected_kind;
    let relative_path_matches = manifest_component_relative_path_identity(&component.relative_path)
        == manifest_component_relative_path_identity(expected_relative_path);
    if kind_matches && relative_path_matches {
        return Ok(());
    }

    Err(FrameworkError::ValidationFailed(format!(
        "openclaw mirror component descriptor mismatch for {}: expected kind {} path {} but got kind {} path {}",
        component.id.trim(),
        expected_kind,
        expected_relative_path,
        component.kind.trim(),
        component.relative_path.trim()
    )))
}

fn validate_component_payloads(
    staging_root: &Path,
    manifest: &OpenClawMirrorManifestRecord,
) -> Result<()> {
    for component in &manifest.components {
        let payload_path = staging_root.join(&component.relative_path);
        if !payload_path.exists() {
            return Err(FrameworkError::NotFound(format!(
                "declared openclaw mirror payload not found for component {} under {}",
                component.id,
                payload_path.display()
            )));
        }

        match component.id.as_str() {
            "config" if !payload_path.is_file() => {
                return Err(FrameworkError::ValidationFailed(format!(
                    "openclaw mirror config payload must be a file: {}",
                    payload_path.display()
                )))
            }
            STUDIO_ROUTING_COMPONENT_ID if !payload_path.is_file() => {
                return Err(FrameworkError::ValidationFailed(format!(
                    "openclaw mirror studio routing payload must be a file: {}",
                    payload_path.display()
                )))
            }
            "state" | "workspace" if !payload_path.is_dir() => {
                return Err(FrameworkError::ValidationFailed(format!(
                    "openclaw mirror payload must be a directory: {}",
                    payload_path.display()
                )))
            }
            _ => {}
        }
    }

    Ok(())
}

fn validate_component_payload_digests(
    staging_root: &Path,
    manifest: &OpenClawMirrorManifestRecord,
) -> Result<()> {
    for component in &manifest.components {
        let Some(expected_digest) = component.digest_sha256.as_deref() else {
            continue;
        };
        let payload_path = staging_root.join(&component.relative_path);
        let actual_digest = compute_component_digest_sha256(&payload_path)?;
        if actual_digest != expected_digest.trim() {
            return Err(FrameworkError::ValidationFailed(format!(
                "openclaw mirror component digest mismatch for component {} at {}: expected {} got {}",
                component.id,
                normalize_path(&payload_path),
                expected_digest.trim(),
                actual_digest
            )));
        }
    }

    Ok(())
}

fn validate_component_payload_stats(
    staging_root: &Path,
    manifest: &OpenClawMirrorManifestRecord,
) -> Result<()> {
    for component in &manifest.components {
        if component.byte_size.is_none() && component.file_count.is_none() {
            continue;
        }

        let payload_path = staging_root.join(&component.relative_path);
        let (actual_file_count, actual_byte_size) = compute_component_stats(&payload_path)?;

        if let Some(expected_byte_size) = component.byte_size {
            if actual_byte_size != expected_byte_size {
                return Err(FrameworkError::ValidationFailed(format!(
                    "openclaw mirror component byte size mismatch for component {} at {}: expected {} got {}",
                    component.id,
                    normalize_path(&payload_path),
                    expected_byte_size,
                    actual_byte_size
                )));
            }
        }

        if let Some(expected_file_count) = component.file_count {
            if actual_file_count != expected_file_count {
                return Err(FrameworkError::ValidationFailed(format!(
                    "openclaw mirror component file count mismatch for component {} at {}: expected {} got {}",
                    component.id,
                    normalize_path(&payload_path),
                    expected_file_count,
                    actual_file_count
                )));
            }
        }
    }

    Ok(())
}

fn validate_component_payload_entry_ownership(
    staging_root: &Path,
    manifest: &OpenClawMirrorManifestRecord,
) -> Result<()> {
    let components_root = staging_root.join("components");
    if !components_root.exists() || !components_root.is_dir() {
        return Ok(());
    }

    validate_component_payload_entry_ownership_under(staging_root, &components_root, manifest)
}

fn validate_component_payload_entry_ownership_under(
    staging_root: &Path,
    current_dir: &Path,
    manifest: &OpenClawMirrorManifestRecord,
) -> Result<()> {
    for entry in fs::read_dir(current_dir)? {
        let entry = entry?;
        let entry_path = entry.path();
        let file_type = entry.file_type()?;
        if file_type.is_dir() {
            validate_component_payload_entry_ownership_under(staging_root, &entry_path, manifest)?;
            continue;
        }
        if !file_type.is_file() {
            continue;
        }

        let relative_path =
            normalize_path(entry_path.strip_prefix(staging_root).map_err(|error| {
                FrameworkError::Internal(format!(
                    "strip staging root for component payload ownership validation: {error}"
                ))
            })?);
        if component_file_is_claimed_by_manifest(&relative_path, manifest) {
            continue;
        }

        return Err(FrameworkError::ValidationFailed(format!(
            "unclaimed openclaw mirror component payload entry: {relative_path}"
        )));
    }

    Ok(())
}

fn component_file_is_claimed_by_manifest(
    relative_path: &str,
    manifest: &OpenClawMirrorManifestRecord,
) -> bool {
    let entry_identity = manifest_component_relative_path_identity(relative_path);
    manifest.components.iter().any(|component| {
        let component_identity =
            manifest_component_relative_path_identity(&component.relative_path);
        match component.id.as_str() {
            "state" | "workspace" => entry_identity
                .strip_prefix(&component_identity)
                .is_some_and(|suffix| suffix.starts_with('/')),
            _ => entry_identity == component_identity,
        }
    })
}

fn validate_metadata_payloads(
    staging_root: &Path,
    manifest: &OpenClawMirrorManifestRecord,
) -> Result<()> {
    for metadata_file in &manifest.metadata_files {
        validate_metadata_payload(staging_root, metadata_file)?;
    }

    Ok(())
}

fn validate_metadata_payload(
    staging_root: &Path,
    metadata_file: &OpenClawMirrorManifestMetadataFileRecord,
) -> Result<()> {
    let payload_path = staging_root.join(&metadata_file.relative_path);
    if !payload_path.exists() {
        return Err(FrameworkError::NotFound(format!(
            "declared openclaw mirror metadata file not found under {}",
            normalize_path(&payload_path)
        )));
    }
    if !payload_path.is_file() {
        return Err(FrameworkError::ValidationFailed(format!(
            "openclaw mirror metadata payload must be a file: {}",
            normalize_path(&payload_path)
        )));
    }

    let payload = fs::read(&payload_path)?;
    if payload.len() as u64 != metadata_file.byte_size {
        return Err(FrameworkError::ValidationFailed(format!(
            "openclaw mirror metadata size mismatch for file {} at {}: expected {} got {}",
            metadata_file.id,
            normalize_path(&payload_path),
            metadata_file.byte_size,
            payload.len()
        )));
    }

    let actual_digest = compute_bytes_digest_sha256(&payload);
    if actual_digest != metadata_file.digest_sha256.trim() {
        return Err(FrameworkError::ValidationFailed(format!(
            "openclaw mirror metadata digest mismatch for file {} at {}: expected {} got {}",
            metadata_file.id,
            normalize_path(&payload_path),
            metadata_file.digest_sha256.trim(),
            actual_digest
        )));
    }

    Ok(())
}

fn extract_archive_to_staging(source_path: &Path, staging_root: &Path) -> Result<()> {
    fs::create_dir_all(staging_root)?;
    validate_archive_entry_paths(source_path)?;
    let archive_copy_path = staging_root.join("openclaw-import.zip");
    fs::copy(source_path, &archive_copy_path)?;

    let extract_result = extract_archive(&archive_copy_path, staging_root);

    let _ = fs::remove_file(&archive_copy_path);
    extract_result
}

fn validate_archive_entry_paths(source_path: &Path) -> Result<()> {
    let entries = list_archive_entries(source_path)?;
    let mut seen_entries = HashMap::<String, String>::new();

    for entry in entries {
        validate_archive_entry_name(&entry)?;
        validate_archive_entry_layout(&entry)?;
        let Some(identity) = archive_entry_identity(&entry) else {
            continue;
        };
        if let Some(existing) = seen_entries.insert(identity, entry.clone()) {
            return Err(FrameworkError::ValidationFailed(format!(
                "duplicate openclaw mirror archive entry path: {} conflicts with {}",
                existing, entry
            )));
        }
    }

    Ok(())
}

fn validate_archive_entry_layout(raw_name: &str) -> Result<()> {
    let Some(identity) = archive_entry_identity(raw_name) else {
        return Ok(());
    };

    if matches!(
        identity.as_str(),
        "manifest.json" | PRIVATE_RUNTIME_SNAPSHOT_FILE_NAME | PRIVATE_MANAGED_ASSETS_FILE_NAME
    ) || identity == "components"
        || identity.starts_with("components/")
    {
        return Ok(());
    }

    Err(FrameworkError::ValidationFailed(format!(
        "unsupported openclaw mirror archive entry layout: {raw_name}"
    )))
}

#[cfg(windows)]
fn list_archive_entries(source_path: &Path) -> Result<Vec<String>> {
    list_windows_archive_entries(source_path)
}

#[cfg(not(windows))]
fn list_archive_entries(source_path: &Path) -> Result<Vec<String>> {
    list_unix_archive_entries(source_path)
}

#[cfg(windows)]
fn list_windows_archive_entries(source_path: &Path) -> Result<Vec<String>> {
    let script = format!(
        "$ErrorActionPreference = 'Stop'; Add-Type -AssemblyName 'System.IO.Compression.FileSystem'; \
         $zip = [System.IO.Compression.ZipFile]::OpenRead('{}'); \
         try {{ $zip.Entries | ForEach-Object {{ $_.FullName }} }} finally {{ $zip.Dispose() }}",
        normalize_native_path(source_path)
    );
    let mut command = Command::new(windows_powershell_executable());
    configure_hidden_child_process(&mut command);
    let output = command.args(["-NoProfile", "-Command", &script]).output()?;

    if !output.status.success() {
        return Err(FrameworkError::ProcessFailed {
            command: "powershell ZipArchive listing".to_string(),
            exit_code: output.status.code(),
            stderr_tail: String::from_utf8_lossy(&output.stderr).trim().to_string(),
        });
    }

    Ok(String::from_utf8_lossy(&output.stdout)
        .lines()
        .map(str::trim)
        .filter(|line| !line.is_empty())
        .map(ToOwned::to_owned)
        .collect())
}

#[cfg(not(windows))]
fn list_unix_archive_entries(source_path: &Path) -> Result<Vec<String>> {
    let output = Command::new("unzip")
        .args(["-Z1", source_path.to_string_lossy().as_ref()])
        .output()?;

    if !output.status.success() {
        return Err(FrameworkError::ProcessFailed {
            command: "unzip -Z1".to_string(),
            exit_code: output.status.code(),
            stderr_tail: String::from_utf8_lossy(&output.stderr).trim().to_string(),
        });
    }

    Ok(String::from_utf8_lossy(&output.stdout)
        .lines()
        .map(str::trim)
        .filter(|line| !line.is_empty())
        .map(ToOwned::to_owned)
        .collect())
}

fn validate_archive_entry_name(raw_name: &str) -> Result<()> {
    let normalized = raw_name.trim().replace('\\', "/");
    if normalized.is_empty() {
        return Ok(());
    }

    if normalized.starts_with('/')
        || normalized.starts_with('\\')
        || normalized.contains('\0')
        || normalized.contains('\n')
        || normalized.contains('\r')
    {
        return Err(FrameworkError::ValidationFailed(format!(
            "unsafe openclaw mirror archive entry path: {raw_name}"
        )));
    }

    let bytes = normalized.as_bytes();
    if bytes.len() >= 2 && bytes[0].is_ascii_alphabetic() && bytes[1] == b':' {
        return Err(FrameworkError::ValidationFailed(format!(
            "unsafe openclaw mirror archive entry path: {raw_name}"
        )));
    }

    if normalized.split('/').any(|segment| segment.trim() == "..") {
        return Err(FrameworkError::ValidationFailed(format!(
            "unsafe openclaw mirror archive entry path: {raw_name}"
        )));
    }

    Ok(())
}

fn archive_entry_identity(raw_name: &str) -> Option<String> {
    let normalized = raw_name.trim().replace('\\', "/");
    let collapsed = normalized.trim_matches('/');
    if collapsed.is_empty() {
        return None;
    }

    Some(
        collapsed
            .split('/')
            .filter(|segment| !segment.is_empty())
            .collect::<Vec<_>>()
            .join("/")
            .to_lowercase(),
    )
}

#[cfg(windows)]
fn extract_archive(archive_path: &Path, destination_dir: &Path) -> Result<()> {
    extract_windows_archive(archive_path, destination_dir)
}

#[cfg(not(windows))]
fn extract_archive(archive_path: &Path, destination_dir: &Path) -> Result<()> {
    extract_unix_archive(archive_path, destination_dir)
}

#[cfg(windows)]
fn extract_windows_archive(archive_path: &Path, destination_dir: &Path) -> Result<()> {
    let script = format!(
        "$ErrorActionPreference = 'Stop'; Expand-Archive -Force -LiteralPath '{}' -DestinationPath '{}'",
        normalize_native_path(archive_path),
        normalize_native_path(destination_dir)
    );
    let mut command = Command::new(windows_powershell_executable());
    configure_hidden_child_process(&mut command);
    let output = command.args(["-NoProfile", "-Command", &script]).output()?;

    if !output.status.success() {
        return Err(FrameworkError::ProcessFailed {
            command: "powershell Expand-Archive".to_string(),
            exit_code: output.status.code(),
            stderr_tail: String::from_utf8_lossy(&output.stderr).trim().to_string(),
        });
    }

    Ok(())
}

#[cfg(not(windows))]
fn extract_unix_archive(archive_path: &Path, destination_dir: &Path) -> Result<()> {
    let output = Command::new("unzip")
        .args([
            "-qq",
            archive_path.to_string_lossy().as_ref(),
            "-d",
            destination_dir.to_string_lossy().as_ref(),
        ])
        .output()?;

    if !output.status.success() {
        return Err(FrameworkError::ProcessFailed {
            command: "unzip -qq".to_string(),
            exit_code: output.status.code(),
            stderr_tail: String::from_utf8_lossy(&output.stderr).trim().to_string(),
        });
    }

    Ok(())
}

#[cfg(windows)]
fn windows_powershell_executable() -> PathBuf {
    let candidate = std::env::var_os("SystemRoot")
        .map(PathBuf::from)
        .unwrap_or_else(|| PathBuf::from(r"C:\Windows"))
        .join("System32")
        .join("WindowsPowerShell")
        .join("v1.0")
        .join("powershell.exe");

    if candidate.exists() {
        candidate
    } else {
        PathBuf::from("powershell.exe")
    }
}

fn create_temp_staging_dir(prefix: &str) -> Result<PathBuf> {
    let staging_root = std::env::temp_dir().join(format!("{prefix}-{}", Uuid::new_v4()));
    fs::create_dir_all(&staging_root)?;
    Ok(staging_root)
}

fn prepend_path_env(user_bin_dir: &Path) -> String {
    let current = std::env::var_os("PATH")
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

fn restore_file(source_path: &Path, destination_path: &Path) -> Result<()> {
    let parent = destination_path.parent().ok_or_else(|| {
        FrameworkError::ValidationFailed(format!(
            "destination path has no parent directory: {}",
            destination_path.display()
        ))
    })?;
    fs::create_dir_all(parent)?;

    if destination_path.exists() {
        if destination_path.is_dir() {
            fs::remove_dir_all(destination_path)?;
        } else {
            fs::remove_file(destination_path)?;
        }
    }

    fs::copy(source_path, destination_path)?;
    Ok(())
}

fn restore_directory(source_dir: &Path, destination_dir: &Path) -> Result<()> {
    if destination_dir.exists() {
        fs::remove_dir_all(destination_dir)?;
    }

    copy_directory_recursive(source_dir, destination_dir)
}

fn copy_directory_recursive(source_dir: &Path, destination_dir: &Path) -> Result<()> {
    fs::create_dir_all(destination_dir)?;

    for entry in fs::read_dir(source_dir)? {
        let entry = entry?;
        let entry_path = entry.path();
        let destination_path = destination_dir.join(entry.file_name());

        if entry.file_type()?.is_dir() {
            copy_directory_recursive(&entry_path, &destination_path)?;
        } else {
            if let Some(parent) = destination_path.parent() {
                fs::create_dir_all(parent)?;
            }
            fs::copy(entry_path, destination_path)?;
        }
    }

    Ok(())
}

fn normalize_path(path: &Path) -> String {
    path.to_string_lossy().replace('\\', "/")
}

fn normalize_native_path(path: &Path) -> String {
    path.to_string_lossy().replace('\'', "''")
}

fn format_now() -> Result<String> {
    OffsetDateTime::now_utc().format(&Rfc3339).map_err(|error| {
        FrameworkError::Internal(format!("format openclaw mirror timestamp: {error}"))
    })
}

#[cfg(test)]
mod tests {
    use super::{
        extract_archive_to_staging, import_openclaw_mirror, inspect_openclaw_mirror_import,
        normalize_native_path, normalize_path, validate_openclaw_asset_canonical_root,
        OpenClawMirrorImportRequest, MANAGED_ASSETS_METADATA_ID, PRIVATE_MANAGED_ASSETS_FILE_NAME,
        PRIVATE_RUNTIME_SNAPSHOT_FILE_NAME, RUNTIME_SNAPSHOT_METADATA_ID,
    };
    use crate::framework::{
        config::AppConfig,
        openclaw_release::bundled_openclaw_version,
        paths::{resolve_paths_for_root, AppPaths},
        services::{
            local_ai_proxy::LocalAiProxyService,
            local_ai_proxy_snapshot::LOCAL_AI_PROXY_PROVIDER_CENTER_NAMESPACE,
            openclaw_channel_config::write_test_openclaw_channel_metadata,
            openclaw_mirror_export::{
                export_phase1_full_private_mirror, OpenClawMirrorExportRequest,
            },
            openclaw_mirror_manifest::{
                compute_component_digest_sha256, compute_component_stats,
                OpenClawMirrorManifestRecord,
            },
            openclaw_runtime::ActivatedOpenClawRuntime,
            storage::StorageService,
            supervisor::SupervisorService,
        },
        storage::{
            StorageGetTextRequest, StorageListKeysRequest, StorageProfileConfig,
            StorageProviderKind, StoragePutTextRequest,
        },
    };
    use serde_json::{json, Value};
    use std::{
        fs,
        net::TcpListener,
        path::{Path, PathBuf},
        process::Command,
    };

    fn openclaw_config_file_path(paths: &AppPaths) -> PathBuf {
        crate::framework::services::kernel_runtime_authority::KernelRuntimeAuthorityService::new()
            .active_config_file_path("openclaw", paths)
            .expect("canonical openclaw config path")
    }

    #[test]
    fn openclaw_mirror_import_production_path_has_no_panic_exits() {
        let source = include_str!("openclaw_mirror_import.rs");
        let production_source = source.split("#[cfg(test)]").next().unwrap_or(source); // WORKSPACE-PATH:allow-fixture-block: this module is the file's #[cfg(test)] unit-test fixture data
        let forbidden_patterns = [
            ".expect(",
            ".unwrap(",
            "panic!(",
            "todo!(",
            "unimplemented!(",
            "unreachable!(",
        ];
        let mut offenders = Vec::new();

        for (index, line) in production_source.lines().enumerate() {
            for pattern in forbidden_patterns {
                if line.contains(pattern) {
                    offenders.push(format!("{}:{}", index + 1, line.trim()));
                }
            }
        }

        assert!(
            offenders.is_empty(),
            "OpenClaw mirror import production code must return structured errors instead of panicking:\n{}",
            offenders.join("\n")
        );
    }

    fn current_openclaw_install_key() -> String {
        format!("{}-windows-x64", bundled_openclaw_version())
    }

    fn create_archive_runtime(paths: &AppPaths) -> ActivatedOpenClawRuntime {
        let install_key = current_openclaw_install_key();
        let install_dir = paths.openclaw_runtime_dir.join(&install_key);
        ActivatedOpenClawRuntime {
            install_key,
            install_dir: install_dir.clone(),
            runtime_dir: install_dir.join("runtime"),
            node_path: install_dir.join("runtime").join("node.exe"),
            cli_path: install_dir.join("runtime").join("openclaw.cjs"),
            home_dir: paths.user_root.clone(),
            state_dir: paths.openclaw_root_dir.clone(),
            workspace_dir: paths.openclaw_workspace_dir.clone(),
            config_path: openclaw_config_file_path(paths),
            gateway_port: 21_280,
            gateway_auth_token: "mirror-import-test-token".to_string(),
        }
    }

    fn seed_built_in_openclaw_tree(paths: &AppPaths, label: &str) {
        fs::create_dir_all(paths.openclaw_root_dir.join("agents").join("main"))
            .expect("agents dir");
        fs::create_dir_all(&paths.openclaw_workspace_dir).expect("workspace dir");
        fs::write(
            &openclaw_config_file_path(paths),
            format!("{{ \"label\": \"{label}\", \"agents\": {{}} }}"),
        )
        .expect("config");
        fs::write(
            paths
                .openclaw_root_dir
                .join("agents")
                .join("main")
                .join("profile.json"),
            format!("{{ \"id\": \"main\", \"label\": \"{label}\" }}"),
        )
        .expect("state file");
        fs::write(
            paths.openclaw_workspace_dir.join("AGENTS.md"),
            format!("# managed workspace {label}"),
        )
        .expect("workspace file");
    }

    fn create_storage_config() -> AppConfig {
        let mut config = AppConfig::default();
        config.storage.active_profile_id = "default-sqlite".to_string();
        config.storage.profiles = vec![StorageProfileConfig {
            id: "default-sqlite".to_string(),
            label: "SQLite".to_string(),
            provider: StorageProviderKind::Sqlite,
            namespace: "agent-studio".to_string(),
            path: Some("profiles/default.db".to_string()),
            connection: None,
            database: None,
            endpoint: None,
            read_only: false,
        }];
        config
    }

    fn seed_provider_center_route(
        storage: &StorageService,
        paths: &AppPaths,
        config: &AppConfig,
        key: &str,
        provider_id: &str,
        upstream_base_url: &str,
        default_model_id: &str,
    ) {
        storage
            .put_text(
                paths,
                config,
                StoragePutTextRequest {
                    profile_id: Some("default-sqlite".to_string()),
                    namespace: Some(LOCAL_AI_PROXY_PROVIDER_CENTER_NAMESPACE.to_string()),
                    key: key.to_string(),
                    value: format!(
                        r#"{{
  "id": "{key}",
  "name": "{provider_id} route",
  "enabled": true,
  "isDefault": true,
  "managedBy": "user",
  "clientProtocol": "openai-compatible",
  "upstreamProtocol": "openai-compatible",
  "providerId": "{provider_id}",
  "upstreamBaseUrl": "{upstream_base_url}",
  "apiKey": "sk-{provider_id}",
  "defaultModelId": "{default_model_id}",
  "models": [
    {{ "id": "{default_model_id}", "name": "{default_model_id}" }}
  ],
  "notes": "mirror route {key}",
  "exposeTo": ["openclaw"]
}}"#
                    ),
                },
            )
            .expect("seed provider center route");
    }

    fn export_fixture_archive(root: &Path, label: &str) -> std::path::PathBuf {
        let source_root = root.join(format!("source-{label}"));
        let paths = resolve_paths_for_root(&source_root).expect("source paths");
        let config = create_storage_config();
        let storage = StorageService::new();
        seed_built_in_openclaw_tree(&paths, label);
        seed_provider_center_route(
            &storage,
            &paths,
            &config,
            "route-openai",
            "openai",
            "https://api.openai.com/v1",
            "gpt-5.4",
        );
        let runtime = create_archive_runtime(&paths);
        let destination_path = root.join(format!("{label}.ocmirror"));

        export_phase1_full_private_mirror(
            &OpenClawMirrorExportRequest {
                mode: "full-private".to_string(),
                destination_path: destination_path.clone(),
            },
            &paths,
            &config,
            &storage,
            &runtime,
        )
        .expect("export mirror");

        destination_path
    }

    fn export_fixture_archive_with_stale_managed_config(
        root: &Path,
        label: &str,
    ) -> std::path::PathBuf {
        let source_root = root.join(format!("source-{label}"));
        let paths = resolve_paths_for_root(&source_root).expect("source paths");
        let config = create_storage_config();
        let storage = StorageService::new();
        seed_built_in_openclaw_tree(&paths, label);
        fs::write(
            &openclaw_config_file_path(&paths),
            format!(
                "{}\n",
                serde_json::to_string_pretty(&json!({
                    "label": label,
                    "gateway": {
                        "port": 41234,
                        "auth": {
                            "mode": "none",
                            "token": "source-archive-token",
                        }
                    },
                    "agents": {
                        "defaults": {
                            "workspace": normalize_path(&source_root.join("archived-default-workspace"))
                        },
                        "list": [
                            {
                                "id": "main",
                                "default": true,
                                "workspace": normalize_path(&source_root.join("archived-main-workspace")),
                                "agentDir": normalize_path(&source_root.join("archived-main-agent").join("agent"))
                            },
                            {
                                "id": "Writer Agent",
                                "workspace": normalize_path(&source_root.join("archived-writer-workspace")),
                                "agentDir": normalize_path(&source_root.join("archived-writer-agent").join("agent"))
                            }
                        ]
                    }
                }))
                .expect("stale config file json"),
            ),
        )
        .expect("stale config file");
        seed_provider_center_route(
            &storage,
            &paths,
            &config,
            "route-openai",
            "openai",
            "https://api.openai.com/v1",
            "gpt-5.4",
        );
        let runtime = create_archive_runtime(&paths);
        let destination_path = root.join(format!("{label}.ocmirror"));

        export_phase1_full_private_mirror(
            &OpenClawMirrorExportRequest {
                mode: "full-private".to_string(),
                destination_path: destination_path.clone(),
            },
            &paths,
            &config,
            &storage,
            &runtime,
        )
        .expect("export mirror");

        destination_path
    }

    fn export_fixture_archive_with_stale_skill_extra_dirs(
        root: &Path,
        label: &str,
    ) -> std::path::PathBuf {
        let source_root = root.join(format!("source-{label}"));
        let external_skills_dir = root.join(format!("external-{label}-skills"));
        let paths = resolve_paths_for_root(&source_root).expect("source paths");
        let config = create_storage_config();
        let storage = StorageService::new();
        seed_built_in_openclaw_tree(&paths, label);
        fs::create_dir_all(paths.openclaw_skills_dir.join("shared-calendar"))
            .expect("shared skills dir");
        fs::create_dir_all(&external_skills_dir).expect("external skills dir");
        fs::write(
            paths
                .openclaw_skills_dir
                .join("shared-calendar")
                .join("SKILL.md"),
            "# shared calendar\n",
        )
        .expect("shared skill file");
        fs::write(
            external_skills_dir.join("SKILL.md"),
            "# external calendar\n",
        )
        .expect("external skill file");
        fs::write(
            &openclaw_config_file_path(&paths),
            format!(
                "{}\n",
                serde_json::to_string_pretty(&json!({
                    "label": label,
                    "skills": {
                        "load": {
                            "extraDirs": [
                                normalize_path(&paths.openclaw_skills_dir),
                                normalize_path(&external_skills_dir),
                            ]
                        }
                    }
                }))
                .expect("stale skill extraDirs config json"),
            ),
        )
        .expect("stale skill extraDirs config");
        seed_provider_center_route(
            &storage,
            &paths,
            &config,
            "route-openai",
            "openai",
            "https://api.openai.com/v1",
            "gpt-5.4",
        );
        let runtime = create_archive_runtime(&paths);
        let destination_path = root.join(format!("{label}.ocmirror"));

        export_phase1_full_private_mirror(
            &OpenClawMirrorExportRequest {
                mode: "full-private".to_string(),
                destination_path: destination_path.clone(),
            },
            &paths,
            &config,
            &storage,
            &runtime,
        )
        .expect("export mirror");

        destination_path
    }

    fn export_fixture_archive_with_stale_plugin_paths(
        root: &Path,
        label: &str,
    ) -> std::path::PathBuf {
        let source_root = root.join(format!("source-{label}"));
        let external_plugins_dir = root.join(format!("external-{label}-plugins"));
        let paths = resolve_paths_for_root(&source_root).expect("source paths");
        let config = create_storage_config();
        let storage = StorageService::new();
        let state_plugin_dir = paths.openclaw_extensions_dir.join("voice-call");
        let source_plugin_dir = paths
            .openclaw_workspace_extensions_dir
            .join("workspace-voice-call");
        seed_built_in_openclaw_tree(&paths, label);
        fs::create_dir_all(&state_plugin_dir).expect("state plugin dir");
        fs::create_dir_all(&source_plugin_dir).expect("source plugin dir");
        fs::create_dir_all(&external_plugins_dir).expect("external plugins dir");
        fs::write(
            state_plugin_dir.join("plugin.json"),
            "{ \"id\": \"voice-call\" }\n",
        )
        .expect("state plugin file");
        fs::write(
            source_plugin_dir.join("plugin.json"),
            "{ \"id\": \"source-voice-call\" }\n",
        )
        .expect("source plugin file");
        fs::write(
            external_plugins_dir.join("plugin.json"),
            "{ \"id\": \"external-plugin\" }\n",
        )
        .expect("external plugin file");
        fs::write(
            &openclaw_config_file_path(&paths),
            format!(
                "{}\n",
                serde_json::to_string_pretty(&json!({
                    "label": label,
                    "plugins": {
                        "load": {
                            "paths": [
                                normalize_path(&paths.openclaw_extensions_dir),
                                normalize_path(&external_plugins_dir),
                            ]
                        },
                        "installs": {
                            "voice-call": {
                                "source": "local",
                                "spec": "./extensions/voice-call",
                                "sourcePath": normalize_path(&source_plugin_dir),
                                "installPath": normalize_path(&state_plugin_dir),
                                "installedAt": "2026-04-03T00:00:00Z"
                            }
                        }
                    }
                }))
                .expect("stale plugin path config json"),
            ),
        )
        .expect("stale plugin path config");
        seed_provider_center_route(
            &storage,
            &paths,
            &config,
            "route-openai",
            "openai",
            "https://api.openai.com/v1",
            "gpt-5.4",
        );
        let runtime = create_archive_runtime(&paths);
        let destination_path = root.join(format!("{label}.ocmirror"));

        export_phase1_full_private_mirror(
            &OpenClawMirrorExportRequest {
                mode: "full-private".to_string(),
                destination_path: destination_path.clone(),
            },
            &paths,
            &config,
            &storage,
            &runtime,
        )
        .expect("export mirror");

        destination_path
    }

    fn export_fixture_archive_with_stale_skill_and_plugin_paths(
        root: &Path,
        label: &str,
    ) -> std::path::PathBuf {
        let source_root = root.join(format!("source-{label}"));
        let external_skills_dir = root.join(format!("external-{label}-skills"));
        let external_plugins_dir = root.join(format!("external-{label}-plugins"));
        let paths = resolve_paths_for_root(&source_root).expect("source paths");
        let config = create_storage_config();
        let storage = StorageService::new();
        let state_plugin_dir = paths.openclaw_extensions_dir.join("voice-call");
        let source_plugin_dir = paths
            .openclaw_workspace_extensions_dir
            .join("workspace-voice-call");
        seed_built_in_openclaw_tree(&paths, label);
        fs::create_dir_all(paths.openclaw_skills_dir.join("shared-calendar"))
            .expect("shared skills dir");
        fs::create_dir_all(&state_plugin_dir).expect("state plugin dir");
        fs::create_dir_all(&source_plugin_dir).expect("source plugin dir");
        fs::create_dir_all(&external_skills_dir).expect("external skills dir");
        fs::create_dir_all(&external_plugins_dir).expect("external plugins dir");
        fs::write(
            paths
                .openclaw_skills_dir
                .join("shared-calendar")
                .join("SKILL.md"),
            "# shared calendar\n",
        )
        .expect("shared skill file");
        fs::write(
            external_skills_dir.join("SKILL.md"),
            "# external calendar\n",
        )
        .expect("external skill file");
        fs::write(
            state_plugin_dir.join("plugin.json"),
            "{ \"id\": \"voice-call\" }\n",
        )
        .expect("state plugin file");
        fs::write(
            source_plugin_dir.join("plugin.json"),
            "{ \"id\": \"source-voice-call\" }\n",
        )
        .expect("source plugin file");
        fs::write(
            external_plugins_dir.join("plugin.json"),
            "{ \"id\": \"external-plugin\" }\n",
        )
        .expect("external plugin file");
        fs::write(
            &openclaw_config_file_path(&paths),
            format!(
                "{}\n",
                serde_json::to_string_pretty(&json!({
                    "label": label,
                    "skills": {
                        "load": {
                            "extraDirs": [
                                normalize_path(&paths.openclaw_skills_dir),
                                normalize_path(&external_skills_dir),
                            ]
                        }
                    },
                    "plugins": {
                        "load": {
                            "paths": [
                                normalize_path(&paths.openclaw_extensions_dir),
                                normalize_path(&external_plugins_dir),
                            ]
                        },
                        "installs": {
                            "voice-call": {
                                "source": "local",
                                "spec": "./extensions/voice-call",
                                "sourcePath": normalize_path(&source_plugin_dir),
                                "installPath": normalize_path(&state_plugin_dir),
                                "installedAt": "2026-04-03T00:00:00Z"
                            }
                        }
                    }
                }))
                .expect("stale skill and plugin path config json"),
            ),
        )
        .expect("stale skill and plugin path config");
        seed_provider_center_route(
            &storage,
            &paths,
            &config,
            "route-openai",
            "openai",
            "https://api.openai.com/v1",
            "gpt-5.4",
        );
        let runtime = create_archive_runtime(&paths);
        let destination_path = root.join(format!("{label}.ocmirror"));

        export_phase1_full_private_mirror(
            &OpenClawMirrorExportRequest {
                mode: "full-private".to_string(),
                destination_path: destination_path.clone(),
            },
            &paths,
            &config,
            &storage,
            &runtime,
        )
        .expect("export mirror");

        destination_path
    }

    fn export_fixture_archive_with_missing_managed_skill_and_plugin_assets(
        root: &Path,
        label: &str,
    ) -> std::path::PathBuf {
        let source_root = root.join(format!("source-{label}"));
        let paths = resolve_paths_for_root(&source_root).expect("source paths");
        let config = create_storage_config();
        let storage = StorageService::new();
        let state_plugin_dir = paths.openclaw_extensions_dir.join("voice-call");
        let source_plugin_dir = paths
            .openclaw_workspace_extensions_dir
            .join("workspace-voice-call");
        seed_built_in_openclaw_tree(&paths, label);
        fs::write(
            &openclaw_config_file_path(&paths),
            format!(
                "{}\n",
                serde_json::to_string_pretty(&json!({
                    "label": label,
                    "skills": {
                        "load": {
                            "extraDirs": [
                                normalize_path(&paths.openclaw_skills_dir),
                            ]
                        }
                    },
                    "plugins": {
                        "load": {
                            "paths": [
                                normalize_path(&paths.openclaw_extensions_dir),
                            ]
                        },
                        "installs": {
                            "voice-call": {
                                "source": "local",
                                "spec": "./extensions/voice-call",
                                "sourcePath": normalize_path(&source_plugin_dir),
                                "installPath": normalize_path(&state_plugin_dir),
                                "installedAt": "2026-04-03T00:00:00Z"
                            }
                        }
                    }
                }))
                .expect("missing OpenClaw asset config json"),
            ),
        )
        .expect("missing OpenClaw asset config");
        seed_provider_center_route(
            &storage,
            &paths,
            &config,
            "route-openai",
            "openai",
            "https://api.openai.com/v1",
            "gpt-5.4",
        );
        let runtime = create_archive_runtime(&paths);
        let destination_path = root.join(format!("{label}.ocmirror"));

        export_phase1_full_private_mirror(
            &OpenClawMirrorExportRequest {
                mode: "full-private".to_string(),
                destination_path: destination_path.clone(),
            },
            &paths,
            &config,
            &storage,
            &runtime,
        )
        .expect("export mirror");

        destination_path
    }

    fn export_fixture_archive_with_missing_local_managed_plugin_install(
        root: &Path,
        label: &str,
    ) -> std::path::PathBuf {
        let source_root = root.join(format!("source-{label}"));
        let paths = resolve_paths_for_root(&source_root).expect("source paths");
        let config = create_storage_config();
        let storage = StorageService::new();
        let source_plugin_dir = paths
            .openclaw_workspace_extensions_dir
            .join("workspace-voice-call");
        let state_plugin_dir = paths.openclaw_extensions_dir.join("voice-call");
        seed_built_in_openclaw_tree(&paths, label);
        fs::create_dir_all(&source_plugin_dir).expect("source plugin dir");
        fs::write(
            source_plugin_dir.join("plugin.json"),
            "{ \"id\": \"source-voice-call\" }\n",
        )
        .expect("source plugin file");
        fs::write(
            &openclaw_config_file_path(&paths),
            format!(
                "{}\n",
                serde_json::to_string_pretty(&json!({
                    "label": label,
                    "plugins": {
                        "load": {
                            "paths": [
                                normalize_path(&paths.openclaw_extensions_dir),
                            ]
                        },
                        "installs": {
                            "voice-call": {
                                "source": "local",
                                "spec": "./extensions/voice-call",
                                "sourcePath": normalize_path(&source_plugin_dir),
                                "installPath": normalize_path(&state_plugin_dir),
                                "installedAt": "2026-04-03T00:00:00Z"
                            }
                        }
                    }
                }))
                .expect("missing local install config json"),
            ),
        )
        .expect("missing local install config");
        seed_provider_center_route(
            &storage,
            &paths,
            &config,
            "route-openai",
            "openai",
            "https://api.openai.com/v1",
            "gpt-5.4",
        );
        let runtime = create_archive_runtime(&paths);
        let destination_path = root.join(format!("{label}.ocmirror"));

        export_phase1_full_private_mirror(
            &OpenClawMirrorExportRequest {
                mode: "full-private".to_string(),
                destination_path: destination_path.clone(),
            },
            &paths,
            &config,
            &storage,
            &runtime,
        )
        .expect("export mirror");

        destination_path
    }

    fn export_fixture_archive_with_managed_skill_and_plugin_assets(
        root: &Path,
        label: &str,
    ) -> std::path::PathBuf {
        let source_root = root.join(format!("source-{label}"));
        let paths = resolve_paths_for_root(&source_root).expect("source paths");
        let config = create_storage_config();
        let storage = StorageService::new();
        let managed_skill_dir = paths.openclaw_skills_dir.join("shared-calendar");
        let managed_workspace_skill_dir = paths
            .openclaw_workspace_skills_dir
            .join("workspace-calendar");
        let managed_plugin_dir = paths.openclaw_extensions_dir.join("voice-call");
        let managed_workspace_plugin_dir = paths
            .openclaw_workspace_extensions_dir
            .join("workspace-voice-call");
        seed_built_in_openclaw_tree(&paths, label);
        fs::create_dir_all(&managed_skill_dir).expect("OpenClaw skill dir");
        fs::create_dir_all(&managed_workspace_skill_dir).expect("managed workspace skill dir");
        fs::create_dir_all(&managed_plugin_dir).expect("OpenClaw plugin dir");
        fs::create_dir_all(&managed_workspace_plugin_dir).expect("managed workspace plugin dir");
        fs::write(managed_skill_dir.join("SKILL.md"), "# shared calendar\n")
            .expect("OpenClaw skill file");
        fs::write(
            managed_workspace_skill_dir.join("SKILL.md"),
            "# workspace calendar\n",
        )
        .expect("managed workspace skill file");
        fs::write(
            managed_plugin_dir.join("plugin.json"),
            "{ \"id\": \"voice-call\" }\n",
        )
        .expect("OpenClaw plugin file");
        fs::write(
            managed_workspace_plugin_dir.join("plugin.json"),
            "{ \"id\": \"workspace-voice-call\" }\n",
        )
        .expect("managed workspace plugin file");
        fs::write(
            &openclaw_config_file_path(&paths),
            format!(
                "{}\n",
                serde_json::to_string_pretty(&json!({
                    "label": label,
                    "skills": {
                        "load": {
                            "extraDirs": [
                                normalize_path(&paths.openclaw_skills_dir),
                            ]
                        }
                    },
                    "plugins": {
                        "load": {
                            "paths": [
                                normalize_path(&paths.openclaw_extensions_dir),
                            ]
                        }
                    }
                }))
                .expect("OpenClaw asset config json"),
            ),
        )
        .expect("OpenClaw asset config");
        seed_provider_center_route(
            &storage,
            &paths,
            &config,
            "route-openai",
            "openai",
            "https://api.openai.com/v1",
            "gpt-5.4",
        );
        let runtime = create_archive_runtime(&paths);
        let destination_path = root.join(format!("{label}.ocmirror"));

        export_phase1_full_private_mirror(
            &OpenClawMirrorExportRequest {
                mode: "full-private".to_string(),
                destination_path: destination_path.clone(),
            },
            &paths,
            &config,
            &storage,
            &runtime,
        )
        .expect("export mirror");

        destination_path
    }

    fn create_test_archive_from_staging(staging_root: &Path, destination_path: &Path) {
        let temp_zip_path = destination_path.with_extension("zip");
        if destination_path.exists() {
            fs::remove_file(destination_path).expect("remove existing test archive");
        }
        if temp_zip_path.exists() {
            fs::remove_file(&temp_zip_path).expect("remove existing temp zip");
        }

        if cfg!(windows) {
            let archive_glob = format!("{}\\*", normalize_native_path(staging_root));
            let destination = normalize_native_path(&temp_zip_path);
            let command = format!(
                "$ErrorActionPreference = 'Stop'; if (Test-Path -LiteralPath '{destination}') {{ Remove-Item -LiteralPath '{destination}' -Force }}; Compress-Archive -Path '{archive_glob}' -DestinationPath '{destination}' -Force"
            );
            let output = Command::new(super::windows_powershell_executable())
                .args(["-NoProfile", "-Command", &command])
                .output()
                .expect("create windows test archive");
            assert!(
                output.status.success(),
                "windows archive creation failed: {}",
                String::from_utf8_lossy(&output.stderr)
            );
        } else {
            let output = Command::new("zip")
                .args(["-q", "-r", temp_zip_path.to_string_lossy().as_ref(), "."])
                .current_dir(staging_root)
                .output()
                .expect("create unix test archive");
            assert!(
                output.status.success(),
                "unix archive creation failed: {}",
                String::from_utf8_lossy(&output.stderr)
            );
        }

        fs::rename(&temp_zip_path, destination_path).expect("rename temp zip to test archive");
    }

    fn create_legacy_archive_without_runtime_snapshot(
        root: &Path,
        archive_path: &Path,
        label: &str,
    ) -> std::path::PathBuf {
        let staging_dir = tempfile::tempdir().expect("legacy staging dir");
        extract_archive_to_staging(archive_path, staging_dir.path()).expect("extract archive");
        fs::remove_file(staging_dir.path().join(PRIVATE_RUNTIME_SNAPSHOT_FILE_NAME))
            .expect("remove runtime snapshot");
        let manifest_path = staging_dir.path().join("manifest.json");
        let mut manifest = serde_json::from_str::<OpenClawMirrorManifestRecord>(
            &fs::read_to_string(&manifest_path).expect("read manifest"),
        )
        .expect("parse manifest");
        manifest.metadata_files.clear();
        fs::write(
            &manifest_path,
            serde_json::to_string_pretty(&manifest).expect("serialize manifest"),
        )
        .expect("write manifest");
        let legacy_archive_path = root.join(format!("{label}-legacy.ocmirror"));
        create_test_archive_from_staging(staging_dir.path(), &legacy_archive_path);
        legacy_archive_path
    }

    fn create_archive_without_payload_paths(
        root: &Path,
        archive_path: &Path,
        label: &str,
        relative_paths: &[&str],
    ) -> std::path::PathBuf {
        let staging_dir = tempfile::tempdir().expect("payload rewrite staging dir");
        extract_archive_to_staging(archive_path, staging_dir.path()).expect("extract archive");
        for relative_path in relative_paths {
            let candidate = staging_dir.path().join(relative_path);
            if candidate.is_dir() {
                fs::remove_dir_all(&candidate).expect("remove staged directory");
            } else if candidate.is_file() {
                fs::remove_file(&candidate).expect("remove staged file");
            }
        }
        let rewritten_archive_path = root.join(format!("{label}-rewritten.ocmirror"));
        create_test_archive_from_staging(staging_dir.path(), &rewritten_archive_path);
        rewritten_archive_path
    }

    fn create_archive_with_rewritten_file(
        root: &Path,
        archive_path: &Path,
        label: &str,
        relative_path: &str,
        replacement_content: &str,
    ) -> std::path::PathBuf {
        let staging_dir = tempfile::tempdir().expect("payload rewrite staging dir");
        extract_archive_to_staging(archive_path, staging_dir.path()).expect("extract archive");
        let candidate = staging_dir.path().join(relative_path);
        fs::write(&candidate, replacement_content).expect("rewrite staged file");
        let rewritten_archive_path = root.join(format!("{label}-digest-mismatch.ocmirror"));
        create_test_archive_from_staging(staging_dir.path(), &rewritten_archive_path);
        rewritten_archive_path
    }

    fn create_archive_with_extra_file(
        root: &Path,
        archive_path: &Path,
        label: &str,
        relative_path: &str,
        content: &str,
    ) -> PathBuf {
        let staging_dir = tempfile::tempdir().expect("payload rewrite staging dir");
        extract_archive_to_staging(archive_path, staging_dir.path()).expect("extract archive");
        let candidate = staging_dir.path().join(relative_path);
        if let Some(parent) = candidate.parent() {
            fs::create_dir_all(parent).expect("extra file parent");
        }
        fs::write(&candidate, content).expect("write extra file");
        let rewritten_archive_path = root.join(format!("{label}-extra-file.ocmirror"));
        create_test_archive_from_staging(staging_dir.path(), &rewritten_archive_path);
        rewritten_archive_path
    }

    fn refresh_manifest_component_payload(
        staging_root: &Path,
        manifest: &mut OpenClawMirrorManifestRecord,
        component_id: &str,
    ) {
        let component = manifest
            .components
            .iter_mut()
            .find(|component| component.id == component_id)
            .expect("component");
        let payload_path = staging_root.join(&component.relative_path);
        component.digest_sha256 =
            Some(compute_component_digest_sha256(&payload_path).expect("refresh component digest"));
        let (file_count, byte_size) =
            compute_component_stats(&payload_path).expect("refresh component stats");
        component.byte_size = Some(byte_size);
        component.file_count = Some(file_count);
    }

    fn create_archive_with_extra_file_and_refreshed_component(
        root: &Path,
        archive_path: &Path,
        label: &str,
        relative_path: &str,
        content: &str,
        component_id: &str,
    ) -> PathBuf {
        let staging_dir = tempfile::tempdir().expect("payload rewrite staging dir");
        extract_archive_to_staging(archive_path, staging_dir.path()).expect("extract archive");
        let candidate = staging_dir.path().join(relative_path);
        if let Some(parent) = candidate.parent() {
            fs::create_dir_all(parent).expect("extra file parent");
        }
        fs::write(&candidate, content).expect("write extra file");

        let manifest_path = staging_dir.path().join("manifest.json");
        let mut manifest = serde_json::from_str::<OpenClawMirrorManifestRecord>(
            &fs::read_to_string(&manifest_path).expect("read manifest"),
        )
        .expect("parse manifest");
        refresh_manifest_component_payload(staging_dir.path(), &mut manifest, component_id);
        fs::write(
            &manifest_path,
            serde_json::to_string_pretty(&manifest).expect("serialize manifest"),
        )
        .expect("write manifest");

        let rewritten_archive_path = root.join(format!("{label}-extra-file.ocmirror"));
        create_test_archive_from_staging(staging_dir.path(), &rewritten_archive_path);
        rewritten_archive_path
    }

    fn create_archive_with_duplicate_manifest_component_id(
        root: &Path,
        archive_path: &Path,
        label: &str,
        component_id: &str,
    ) -> PathBuf {
        let staging_dir = tempfile::tempdir().expect("manifest rewrite staging dir");
        extract_archive_to_staging(archive_path, staging_dir.path()).expect("extract archive");
        let manifest_path = staging_dir.path().join("manifest.json");
        let mut manifest = serde_json::from_str::<OpenClawMirrorManifestRecord>(
            &fs::read_to_string(&manifest_path).expect("read manifest"),
        )
        .expect("parse manifest");
        let duplicated_component = manifest
            .components
            .iter()
            .find(|component| component.id == component_id)
            .cloned()
            .expect("component to duplicate");
        manifest.components.push(duplicated_component);
        fs::write(
            &manifest_path,
            serde_json::to_string_pretty(&manifest).expect("serialize manifest"),
        )
        .expect("write manifest");
        let rewritten_archive_path = root.join(format!("{label}-duplicate-component.ocmirror"));
        create_test_archive_from_staging(staging_dir.path(), &rewritten_archive_path);
        rewritten_archive_path
    }

    fn create_archive_with_rewritten_manifest_component_relative_path(
        root: &Path,
        archive_path: &Path,
        label: &str,
        component_id: &str,
        relative_path: &str,
    ) -> PathBuf {
        let staging_dir = tempfile::tempdir().expect("manifest rewrite staging dir");
        extract_archive_to_staging(archive_path, staging_dir.path()).expect("extract archive");
        let manifest_path = staging_dir.path().join("manifest.json");
        let mut manifest = serde_json::from_str::<OpenClawMirrorManifestRecord>(
            &fs::read_to_string(&manifest_path).expect("read manifest"),
        )
        .expect("parse manifest");
        let component = manifest
            .components
            .iter_mut()
            .find(|component| component.id == component_id)
            .expect("component");
        component.relative_path = relative_path.to_string();
        fs::write(
            &manifest_path,
            serde_json::to_string_pretty(&manifest).expect("serialize manifest"),
        )
        .expect("write manifest");
        let rewritten_archive_path = root.join(format!("{label}-component-relative-path.ocmirror"));
        create_test_archive_from_staging(staging_dir.path(), &rewritten_archive_path);
        rewritten_archive_path
    }

    fn create_archive_with_rewritten_manifest_metadata_relative_path(
        root: &Path,
        archive_path: &Path,
        label: &str,
        metadata_id: &str,
        relative_path: &str,
    ) -> PathBuf {
        let staging_dir = tempfile::tempdir().expect("manifest rewrite staging dir");
        extract_archive_to_staging(archive_path, staging_dir.path()).expect("extract archive");
        let manifest_path = staging_dir.path().join("manifest.json");
        let mut manifest = serde_json::from_str::<OpenClawMirrorManifestRecord>(
            &fs::read_to_string(&manifest_path).expect("read manifest"),
        )
        .expect("parse manifest");
        let metadata_file = manifest
            .metadata_files
            .iter_mut()
            .find(|metadata_file| metadata_file.id == metadata_id)
            .expect("metadata file");
        metadata_file.relative_path = relative_path.to_string();
        fs::write(
            &manifest_path,
            serde_json::to_string_pretty(&manifest).expect("serialize manifest"),
        )
        .expect("write manifest");
        let rewritten_archive_path = root.join(format!("{label}-metadata-relative-path.ocmirror"));
        create_test_archive_from_staging(staging_dir.path(), &rewritten_archive_path);
        rewritten_archive_path
    }

    fn create_archive_with_duplicate_manifest_metadata_relative_path(
        root: &Path,
        archive_path: &Path,
        label: &str,
        source_metadata_id: &str,
        duplicated_metadata_id: &str,
    ) -> PathBuf {
        let staging_dir = tempfile::tempdir().expect("manifest rewrite staging dir");
        extract_archive_to_staging(archive_path, staging_dir.path()).expect("extract archive");
        let manifest_path = staging_dir.path().join("manifest.json");
        let mut manifest = serde_json::from_str::<OpenClawMirrorManifestRecord>(
            &fs::read_to_string(&manifest_path).expect("read manifest"),
        )
        .expect("parse manifest");
        let mut duplicated_metadata = manifest
            .metadata_files
            .iter()
            .find(|metadata_file| metadata_file.id == source_metadata_id)
            .cloned()
            .expect("source metadata file");
        duplicated_metadata.id = duplicated_metadata_id.to_string();
        manifest.metadata_files.push(duplicated_metadata);
        fs::write(
            &manifest_path,
            serde_json::to_string_pretty(&manifest).expect("serialize manifest"),
        )
        .expect("write manifest");
        let rewritten_archive_path = root.join(format!("{label}-duplicate-metadata-path.ocmirror"));
        create_test_archive_from_staging(staging_dir.path(), &rewritten_archive_path);
        rewritten_archive_path
    }

    fn create_archive_with_removed_manifest_metadata_file(
        root: &Path,
        archive_path: &Path,
        label: &str,
        metadata_id: &str,
    ) -> PathBuf {
        let staging_dir = tempfile::tempdir().expect("manifest rewrite staging dir");
        extract_archive_to_staging(archive_path, staging_dir.path()).expect("extract archive");
        let manifest_path = staging_dir.path().join("manifest.json");
        let mut manifest = serde_json::from_str::<OpenClawMirrorManifestRecord>(
            &fs::read_to_string(&manifest_path).expect("read manifest"),
        )
        .expect("parse manifest");
        manifest
            .metadata_files
            .retain(|metadata_file| metadata_file.id != metadata_id);
        fs::write(
            &manifest_path,
            serde_json::to_string_pretty(&manifest).expect("serialize manifest"),
        )
        .expect("write manifest");
        let rewritten_archive_path = root.join(format!("{label}-removed-metadata.ocmirror"));
        create_test_archive_from_staging(staging_dir.path(), &rewritten_archive_path);
        rewritten_archive_path
    }

    fn create_archive_with_rewritten_manifest_metadata_id(
        root: &Path,
        archive_path: &Path,
        label: &str,
        source_metadata_id: &str,
        rewritten_metadata_id: &str,
    ) -> PathBuf {
        let staging_dir = tempfile::tempdir().expect("manifest rewrite staging dir");
        extract_archive_to_staging(archive_path, staging_dir.path()).expect("extract archive");
        let manifest_path = staging_dir.path().join("manifest.json");
        let mut manifest = serde_json::from_str::<OpenClawMirrorManifestRecord>(
            &fs::read_to_string(&manifest_path).expect("read manifest"),
        )
        .expect("parse manifest");
        let metadata_file = manifest
            .metadata_files
            .iter_mut()
            .find(|metadata_file| metadata_file.id == source_metadata_id)
            .expect("metadata file");
        metadata_file.id = rewritten_metadata_id.to_string();
        fs::write(
            &manifest_path,
            serde_json::to_string_pretty(&manifest).expect("serialize manifest"),
        )
        .expect("write manifest");
        let rewritten_archive_path = root.join(format!("{label}-rewritten-metadata-id.ocmirror"));
        create_test_archive_from_staging(staging_dir.path(), &rewritten_archive_path);
        rewritten_archive_path
    }

    fn create_archive_with_rewritten_manifest_component_descriptor(
        root: &Path,
        archive_path: &Path,
        label: &str,
        component_id: &str,
        rewritten_id: Option<&str>,
        rewritten_kind: Option<&str>,
        rewritten_relative_path: Option<&str>,
        refresh_digest: bool,
    ) -> PathBuf {
        let staging_dir = tempfile::tempdir().expect("manifest rewrite staging dir");
        extract_archive_to_staging(archive_path, staging_dir.path()).expect("extract archive");
        let manifest_path = staging_dir.path().join("manifest.json");
        let mut manifest = serde_json::from_str::<OpenClawMirrorManifestRecord>(
            &fs::read_to_string(&manifest_path).expect("read manifest"),
        )
        .expect("parse manifest");
        let component = manifest
            .components
            .iter_mut()
            .find(|component| component.id == component_id)
            .expect("component");
        if let Some(value) = rewritten_id {
            component.id = value.to_string();
        }
        if let Some(value) = rewritten_kind {
            component.kind = value.to_string();
        }
        if let Some(value) = rewritten_relative_path {
            component.relative_path = value.to_string();
        }
        if refresh_digest {
            let payload_path = staging_dir.path().join(&component.relative_path);
            component.digest_sha256 = Some(
                compute_component_digest_sha256(&payload_path).expect("refresh component digest"),
            );
        }
        fs::write(
            &manifest_path,
            serde_json::to_string_pretty(&manifest).expect("serialize manifest"),
        )
        .expect("write manifest");
        let rewritten_archive_path = root.join(format!("{label}-component-descriptor.ocmirror"));
        create_test_archive_from_staging(staging_dir.path(), &rewritten_archive_path);
        rewritten_archive_path
    }

    fn create_archive_with_rewritten_manifest_component_stats(
        root: &Path,
        archive_path: &Path,
        label: &str,
        component_id: &str,
        byte_size: Option<u64>,
        file_count: Option<u64>,
    ) -> PathBuf {
        let staging_dir = tempfile::tempdir().expect("manifest rewrite staging dir");
        extract_archive_to_staging(archive_path, staging_dir.path()).expect("extract archive");
        let manifest_path = staging_dir.path().join("manifest.json");
        let mut manifest = serde_json::from_str::<OpenClawMirrorManifestRecord>(
            &fs::read_to_string(&manifest_path).expect("read manifest"),
        )
        .expect("parse manifest");
        let component = manifest
            .components
            .iter_mut()
            .find(|component| component.id == component_id)
            .expect("component");
        if let Some(value) = byte_size {
            component.byte_size = Some(value);
        }
        if let Some(value) = file_count {
            component.file_count = Some(value);
        }
        fs::write(
            &manifest_path,
            serde_json::to_string_pretty(&manifest).expect("serialize manifest"),
        )
        .expect("write manifest");
        let rewritten_archive_path = root.join(format!("{label}-component-stats.ocmirror"));
        create_test_archive_from_staging(staging_dir.path(), &rewritten_archive_path);
        rewritten_archive_path
    }

    fn create_archive_with_rewritten_manifest_runtime_summary(
        root: &Path,
        archive_path: &Path,
        label: &str,
        rewritten_install_key: Option<&str>,
        rewritten_platform: Option<&str>,
    ) -> PathBuf {
        let staging_dir = tempfile::tempdir().expect("manifest rewrite staging dir");
        extract_archive_to_staging(archive_path, staging_dir.path()).expect("extract archive");
        let manifest_path = staging_dir.path().join("manifest.json");
        let mut manifest = serde_json::from_str::<OpenClawMirrorManifestRecord>(
            &fs::read_to_string(&manifest_path).expect("read manifest"),
        )
        .expect("parse manifest");
        if let Some(value) = rewritten_install_key {
            manifest.runtime.install_key = Some(value.to_string());
        }
        if let Some(value) = rewritten_platform {
            manifest.runtime.platform = value.to_string();
        }
        fs::write(
            &manifest_path,
            serde_json::to_string_pretty(&manifest).expect("serialize manifest"),
        )
        .expect("write manifest");
        let rewritten_archive_path = root.join(format!("{label}-runtime-summary.ocmirror"));
        create_test_archive_from_staging(staging_dir.path(), &rewritten_archive_path);
        rewritten_archive_path
    }

    fn create_archive_with_rewritten_managed_assets_snapshot(
        root: &Path,
        archive_path: &Path,
        label: &str,
        replacement_content: &str,
    ) -> PathBuf {
        let staging_dir = tempfile::tempdir().expect("OpenClaw assets rewrite staging dir");
        extract_archive_to_staging(archive_path, staging_dir.path()).expect("extract archive");
        let openclaw_assets_path = staging_dir.path().join(PRIVATE_MANAGED_ASSETS_FILE_NAME);
        fs::write(&openclaw_assets_path, replacement_content).expect("rewrite OpenClaw assets");

        let manifest_path = staging_dir.path().join("manifest.json");
        let mut manifest = serde_json::from_str::<OpenClawMirrorManifestRecord>(
            &fs::read_to_string(&manifest_path).expect("read manifest"),
        )
        .expect("parse manifest");
        let metadata_file = manifest
            .metadata_files
            .iter_mut()
            .find(|metadata_file| metadata_file.id == MANAGED_ASSETS_METADATA_ID)
            .expect("OpenClaw assets metadata file");
        metadata_file.digest_sha256 = compute_component_digest_sha256(&openclaw_assets_path)
            .expect("compute OpenClaw assets digest");
        metadata_file.byte_size = fs::metadata(&openclaw_assets_path)
            .expect("OpenClaw assets metadata")
            .len();
        fs::write(
            &manifest_path,
            serde_json::to_string_pretty(&manifest).expect("serialize manifest"),
        )
        .expect("write manifest");

        let rewritten_archive_path = root.join(format!("{label}-managed-assets.ocmirror"));
        create_test_archive_from_staging(staging_dir.path(), &rewritten_archive_path);
        rewritten_archive_path
    }

    fn create_archive_with_traversal_entry(
        root: &Path,
        archive_path: &Path,
        label: &str,
    ) -> PathBuf {
        let staging_dir = tempfile::tempdir().expect("payload rewrite staging dir");
        extract_archive_to_staging(archive_path, staging_dir.path()).expect("extract archive");
        let rewritten_archive_path = root.join(format!("{label}-traversal.ocmirror"));
        create_archive_with_windows_traversal_entry(
            staging_dir.path(),
            &rewritten_archive_path,
            "../escaped.txt",
            "malicious payload",
        );
        rewritten_archive_path
    }

    fn create_archive_with_duplicate_entry(
        root: &Path,
        archive_path: &Path,
        label: &str,
        duplicate_entry_name: &str,
        duplicate_entry_content: &str,
    ) -> PathBuf {
        let staging_dir = tempfile::tempdir().expect("duplicate entry staging dir");
        extract_archive_to_staging(archive_path, staging_dir.path()).expect("extract archive");
        let rewritten_archive_path = root.join(format!("{label}-duplicate-entry.ocmirror"));
        create_archive_with_windows_duplicate_entry(
            staging_dir.path(),
            &rewritten_archive_path,
            duplicate_entry_name,
            duplicate_entry_content,
        );
        rewritten_archive_path
    }

    #[cfg(windows)]
    fn create_archive_with_windows_traversal_entry(
        staging_root: &Path,
        destination_path: &Path,
        traversal_entry_name: &str,
        traversal_content: &str,
    ) {
        let destination = normalize_native_path(destination_path);
        let staging = normalize_native_path(staging_root);
        let traversal_name = traversal_entry_name.replace('\'', "''");
        let traversal_content = traversal_content.replace('\'', "''");
        let command = format!(
            "$ErrorActionPreference = 'Stop'; Add-Type -AssemblyName 'System.IO.Compression'; Add-Type -AssemblyName 'System.IO.Compression.FileSystem'; \
             if (Test-Path -LiteralPath '{destination}') {{ Remove-Item -LiteralPath '{destination}' -Force }}; \
             $zip = [System.IO.Compression.ZipFile]::Open('{destination}', [System.IO.Compression.ZipArchiveMode]::Create); \
             try {{ \
               Get-ChildItem -LiteralPath '{staging}' -Recurse -File | ForEach-Object {{ \
                 $full = $_.FullName; \
                 $relative = $full.Substring('{staging}'.Length).TrimStart('\\','/'); \
                 [System.IO.Compression.ZipFileExtensions]::CreateEntryFromFile($zip, $full, $relative, [System.IO.Compression.CompressionLevel]::Optimal) | Out-Null; \
               }}; \
               $entry = $zip.CreateEntry('{traversal_name}'); \
               $writer = New-Object System.IO.StreamWriter($entry.Open()); \
               try {{ $writer.Write('{traversal_content}') }} finally {{ $writer.Dispose() }}; \
             }} finally {{ $zip.Dispose() }}"
        );
        let output = Command::new(super::windows_powershell_executable())
            .args(["-NoProfile", "-Command", &command])
            .output()
            .expect("create traversal archive");
        assert!(
            output.status.success(),
            "windows traversal archive creation failed: {}",
            String::from_utf8_lossy(&output.stderr)
        );
    }

    #[cfg(windows)]
    fn create_archive_with_windows_duplicate_entry(
        staging_root: &Path,
        destination_path: &Path,
        duplicate_entry_name: &str,
        duplicate_entry_content: &str,
    ) {
        let destination = normalize_native_path(destination_path);
        let staging = normalize_native_path(staging_root);
        let duplicate_name = duplicate_entry_name.replace('\'', "''");
        let duplicate_content = duplicate_entry_content.replace('\'', "''");
        let command = format!(
            "$ErrorActionPreference = 'Stop'; Add-Type -AssemblyName 'System.IO.Compression'; Add-Type -AssemblyName 'System.IO.Compression.FileSystem'; \
             if (Test-Path -LiteralPath '{destination}') {{ Remove-Item -LiteralPath '{destination}' -Force }}; \
             $zip = [System.IO.Compression.ZipFile]::Open('{destination}', [System.IO.Compression.ZipArchiveMode]::Create); \
             try {{ \
               Get-ChildItem -LiteralPath '{staging}' -Recurse -File | ForEach-Object {{ \
                 $full = $_.FullName; \
                 $relative = $full.Substring('{staging}'.Length).TrimStart('\\','/'); \
                 [System.IO.Compression.ZipFileExtensions]::CreateEntryFromFile($zip, $full, $relative, [System.IO.Compression.CompressionLevel]::Optimal) | Out-Null; \
               }}; \
               $entry = $zip.CreateEntry('{duplicate_name}'); \
               $writer = New-Object System.IO.StreamWriter($entry.Open()); \
               try {{ $writer.Write('{duplicate_content}') }} finally {{ $writer.Dispose() }}; \
             }} finally {{ $zip.Dispose() }}"
        );
        let output = Command::new(super::windows_powershell_executable())
            .args(["-NoProfile", "-Command", &command])
            .output()
            .expect("create duplicate entry archive");
        assert!(
            output.status.success(),
            "windows duplicate entry archive creation failed: {}",
            String::from_utf8_lossy(&output.stderr)
        );
    }

    #[cfg(not(windows))]
    fn create_archive_with_windows_traversal_entry(
        _staging_root: &Path,
        _destination_path: &Path,
        _traversal_entry_name: &str,
        _traversal_content: &str,
    ) {
        panic!("traversal archive helper is only implemented on windows");
    }

    #[cfg(not(windows))]
    fn create_archive_with_windows_duplicate_entry(
        _staging_root: &Path,
        _destination_path: &Path,
        _duplicate_entry_name: &str,
        _duplicate_entry_content: &str,
    ) {
        panic!("duplicate entry archive helper is only implemented on windows");
    }

    fn doctor_marker_path(paths: &AppPaths) -> std::path::PathBuf {
        paths.openclaw_root_dir.join("doctor-ran.json")
    }

    fn assert_json_path_value(value: &Value, expected: &Path) {
        assert_eq!(
            value.as_str().expect("json path string").replace('\\', "/"),
            normalize_path(expected)
        );
    }

    fn create_gateway_runtime_cli_script(paths: &AppPaths) -> String {
        format!(
            "import fs from 'node:fs';\nimport path from 'node:path';\nimport http from 'node:http';\nconst args = process.argv.slice(2);\nconst markerPath = {};\nif (args[0] === 'doctor') {{\n  fs.mkdirSync(path.dirname(markerPath), {{ recursive: true }});\n  fs.writeFileSync(markerPath, JSON.stringify({{ args }}));\n  process.exit(0);\n}}\nconst configPath = process.env.OPENCLAW_CONFIG_PATH;\nconst config = JSON.parse(fs.readFileSync(configPath, 'utf8'));\nconst gatewayPort = Number(config.gateway?.port ?? 21280);\nif (args[0] === 'gateway' && args[1] === 'health') {{\n  process.stdout.write(JSON.stringify({{ ok: true, result: {{ status: 'ok' }} }}));\n  process.exit(0);\n}}\nif (args[0] !== 'gateway') {{\n  process.stderr.write(`unexpected args: ${{args.join(' ')}}`);\n  process.exit(1);\n}}\nconst expectedAuthorization = `Bearer ${{process.env.OPENCLAW_GATEWAY_TOKEN ?? ''}}`;\nconst server = http.createServer((req, res) => {{\n  if (req.url === '/health' || req.url === '/healthz') {{\n    res.writeHead(200, {{ 'content-type': 'application/json' }});\n    res.end(JSON.stringify({{ ok: true, status: 'live' }}));\n    return;\n  }}\n  if (req.url === '/ready' || req.url === '/readyz') {{\n    res.writeHead(200, {{ 'content-type': 'application/json' }});\n    res.end(JSON.stringify({{ ready: true, failing: [], uptimeMs: 1 }}));\n    return;\n  }}\n  if (req.url !== '/tools/invoke' || req.method !== 'POST') {{\n    res.writeHead(404, {{ 'content-type': 'application/json' }});\n    res.end(JSON.stringify({{ ok: false, error: {{ message: 'unexpected path' }} }}));\n    return;\n  }}\n  if ((req.headers.authorization ?? '') !== expectedAuthorization) {{\n    res.writeHead(401, {{ 'content-type': 'application/json' }});\n    res.end(JSON.stringify({{ ok: false, error: {{ message: 'unauthorized' }} }}));\n    return;\n  }}\n  let body = '';\n  req.setEncoding('utf8');\n  req.on('data', (chunk) => {{ body += chunk; }});\n  req.on('end', () => {{\n    const payload = body.trim() ? JSON.parse(body) : {{}};\n    if (payload.tool !== 'cron' || payload.action !== 'status') {{\n      res.writeHead(404, {{ 'content-type': 'application/json' }});\n      res.end(JSON.stringify({{ ok: false, error: {{ message: `unexpected method ${{payload.tool ?? 'missing'}}.${{payload.action ?? 'missing'}}` }} }}));\n      return;\n    }}\n    res.writeHead(200, {{ 'content-type': 'application/json' }});\n    res.end(JSON.stringify({{ ok: true, result: {{ method: 'cron.status' }} }}));\n  }});\n}});\nserver.listen(gatewayPort, '127.0.0.1');\nsetInterval(() => {{}}, 1000);\n",
            serde_json::to_string(&doctor_marker_path(paths).to_string_lossy().into_owned())
                .expect("doctor marker path json"),
        )
    }

    #[cfg(windows)]
    fn create_gateway_runtime(paths: &AppPaths, gateway_port: u16) -> ActivatedOpenClawRuntime {
        let install_dir = paths.openclaw_runtime_dir.join("test-gateway");
        let runtime_dir = install_dir.join("runtime");
        let node_path = resolve_test_node_executable();
        let cli_path = runtime_dir
            .join("package")
            .join("node_modules")
            .join("openclaw")
            .join("openclaw.mjs");

        fs::create_dir_all(cli_path.parent().expect("cli parent")).expect("cli dir");
        write_test_openclaw_channel_metadata(&runtime_dir);
        fs::write(
            &openclaw_config_file_path(paths),
            format!("{{\n  \"gateway\": {{\n    \"port\": {gateway_port}\n  }}\n}}\n"),
        )
        .expect("config file");
        fs::write(&cli_path, create_gateway_runtime_cli_script(paths)).expect("cli file");

        ActivatedOpenClawRuntime {
            install_key: "test-gateway".to_string(),
            install_dir,
            runtime_dir,
            node_path,
            cli_path,
            home_dir: paths.user_root.clone(),
            state_dir: paths.openclaw_root_dir.clone(),
            workspace_dir: paths.openclaw_workspace_dir.clone(),
            config_path: openclaw_config_file_path(paths),
            gateway_port,
            gateway_auth_token: "test-token".to_string(),
        }
    }

    #[cfg(not(windows))]
    fn create_gateway_runtime(paths: &AppPaths, gateway_port: u16) -> ActivatedOpenClawRuntime {
        let install_dir = paths.openclaw_runtime_dir.join("test-gateway");
        let runtime_dir = install_dir.join("runtime");
        let node_path = resolve_test_node_executable();
        let cli_path = runtime_dir
            .join("package")
            .join("node_modules")
            .join("openclaw")
            .join("openclaw.mjs");

        fs::create_dir_all(cli_path.parent().expect("cli parent")).expect("cli dir");
        write_test_openclaw_channel_metadata(&runtime_dir);
        fs::write(
            &openclaw_config_file_path(paths),
            format!("{{\n  \"gateway\": {{\n    \"port\": {gateway_port}\n  }}\n}}\n"),
        )
        .expect("config file");
        fs::write(&cli_path, create_gateway_runtime_cli_script(paths)).expect("cli file");

        ActivatedOpenClawRuntime {
            install_key: "test-gateway".to_string(),
            install_dir,
            runtime_dir,
            node_path,
            cli_path,
            home_dir: paths.user_root.clone(),
            state_dir: paths.openclaw_root_dir.clone(),
            workspace_dir: paths.openclaw_workspace_dir.clone(),
            config_path: openclaw_config_file_path(paths),
            gateway_port,
            gateway_auth_token: "test-token".to_string(),
        }
    }

    #[cfg(windows)]
    fn resolve_test_node_executable() -> std::path::PathBuf {
        crate::framework::services::test_support::resolve_test_node_executable(
            "OpenClaw mirror import tests",
        )
    }

    #[cfg(not(windows))]
    fn resolve_test_node_executable() -> std::path::PathBuf {
        crate::framework::services::test_support::resolve_test_node_executable(
            "OpenClaw mirror import tests",
        )
    }

    fn reserve_test_loopback_port() -> u16 {
        let listener =
            TcpListener::bind(("127.0.0.1", 0)).expect("bind loopback listener for test port");
        let port = listener.local_addr().expect("listener addr").port();
        drop(listener);
        port
    }

    #[test]
    fn openclaw_mirror_import_reads_manifest_from_exported_archive() {
        let root = tempfile::tempdir().expect("temp dir");
        let archive_path = export_fixture_archive(root.path(), "import-preview");

        let preview = inspect_openclaw_mirror_import(&archive_path).expect("inspect import");

        assert_eq!(preview.mode, "full-private");
        assert_eq!(preview.manifest.mode, "full-private");
        assert_eq!(preview.components.len(), 4);
        assert!(preview.warnings.is_empty());
    }

    #[cfg(windows)]
    #[test]
    fn openclaw_mirror_import_rejects_traversal_archive_entries() {
        let root = tempfile::tempdir().expect("temp dir");
        let label = "traversal-entry";
        let archive_path = export_fixture_archive(root.path(), label);
        let malicious_archive_path =
            create_archive_with_traversal_entry(root.path(), &archive_path, label);

        let error = inspect_openclaw_mirror_import(&malicious_archive_path)
            .expect_err("traversal entry should be rejected");

        let error_text = error.to_string();
        assert!(
            error_text.contains("unsafe openclaw mirror archive entry"),
            "unexpected error: {error_text}"
        );
        assert!(!root.path().join("escaped.txt").exists());
    }

    #[cfg(windows)]
    #[test]
    fn openclaw_mirror_import_rejects_duplicate_archive_entries() {
        let root = tempfile::tempdir().expect("temp dir");
        let label = "duplicate-entry";
        let archive_path = export_fixture_archive(root.path(), label);
        let duplicate_archive_path = create_archive_with_duplicate_entry(
            root.path(),
            &archive_path,
            label,
            "manifest.json",
            "{\"mode\":\"tampered\"}",
        );

        let error = inspect_openclaw_mirror_import(&duplicate_archive_path)
            .expect_err("duplicate entry archive should be rejected");

        let error_text = error.to_string();
        assert!(
            error_text.contains("duplicate openclaw mirror archive entry"),
            "unexpected error: {error_text}"
        );
    }

    #[test]
    fn openclaw_mirror_import_rejects_archive_entries_outside_allowed_layout() {
        let root = tempfile::tempdir().expect("temp dir");
        let label = "unexpected-layout-entry";
        let archive_path = export_fixture_archive(root.path(), label);
        let corrupted_archive_path = create_archive_with_extra_file(
            root.path(),
            &archive_path,
            label,
            "notes/extra.txt",
            "unexpected archive payload",
        );

        let error = inspect_openclaw_mirror_import(&corrupted_archive_path)
            .expect_err("unexpected layout entry should be rejected");

        let error_text = error.to_string();
        assert!(
            error_text.contains("unsupported openclaw mirror archive entry layout"),
            "unexpected error: {error_text}"
        );
        assert!(
            error_text.contains("extra.txt"),
            "unexpected error: {error_text}"
        );
    }

    #[test]
    fn openclaw_mirror_import_rejects_unclaimed_component_payload_entries() {
        let root = tempfile::tempdir().expect("temp dir");
        let label = "unclaimed-component-entry";
        let archive_path = export_fixture_archive(root.path(), label);
        let corrupted_archive_path = create_archive_with_extra_file(
            root.path(),
            &archive_path,
            label,
            "components/untracked/rogue.txt",
            "unexpected component payload",
        );

        let error = inspect_openclaw_mirror_import(&corrupted_archive_path)
            .expect_err("unclaimed component payload entry should be rejected");

        let error_text = error.to_string();
        assert!(
            error_text.contains("unclaimed openclaw mirror component payload entry"),
            "unexpected error: {error_text}"
        );
        assert!(
            error_text.contains("rogue.txt"),
            "unexpected error: {error_text}"
        );
    }

    #[test]
    fn openclaw_mirror_import_rejects_duplicate_manifest_component_ids() {
        let root = tempfile::tempdir().expect("temp dir");
        let label = "duplicate-component-id";
        let archive_path = export_fixture_archive(root.path(), label);
        let duplicate_manifest_archive_path = create_archive_with_duplicate_manifest_component_id(
            root.path(),
            &archive_path,
            label,
            "config",
        );

        let error = inspect_openclaw_mirror_import(&duplicate_manifest_archive_path)
            .expect_err("duplicate component ids should be rejected");

        let error_text = error.to_string();
        assert!(
            error_text.contains("duplicate openclaw mirror component id: config"),
            "unexpected error: {error_text}"
        );
    }

    #[test]
    fn openclaw_mirror_import_rejects_duplicate_manifest_metadata_relative_paths() {
        let root = tempfile::tempdir().expect("temp dir");
        let label = "duplicate-metadata-relative-path";
        let archive_path = export_fixture_archive(root.path(), label);
        let duplicate_manifest_archive_path =
            create_archive_with_duplicate_manifest_metadata_relative_path(
                root.path(),
                &archive_path,
                label,
                RUNTIME_SNAPSHOT_METADATA_ID,
                "runtime-snapshot-copy",
            );

        let error = inspect_openclaw_mirror_import(&duplicate_manifest_archive_path)
            .expect_err("duplicate metadata relative paths should be rejected");

        let error_text = error.to_string();
        assert!(
            error_text.contains("duplicate openclaw mirror metadata file relative path"),
            "unexpected error: {error_text}"
        );
    }

    #[test]
    fn openclaw_mirror_import_rejects_incomplete_manifest_metadata_file_set() {
        let root = tempfile::tempdir().expect("temp dir");
        let label = "missing-metadata-file-record";
        let archive_path = export_fixture_archive(root.path(), label);
        let corrupted_archive_path = create_archive_with_removed_manifest_metadata_file(
            root.path(),
            &archive_path,
            label,
            MANAGED_ASSETS_METADATA_ID,
        );

        let error = inspect_openclaw_mirror_import(&corrupted_archive_path)
            .expect_err("incomplete metadata file set should be rejected");

        let error_text = error.to_string();
        assert!(
            error_text.contains("incomplete openclaw mirror metadata file set"),
            "unexpected error: {error_text}"
        );
        assert!(
            error_text.contains("managed-assets-inventory"),
            "unexpected error: {error_text}"
        );
    }

    #[test]
    fn openclaw_mirror_import_rejects_unsupported_manifest_metadata_file_id() {
        let root = tempfile::tempdir().expect("temp dir");
        let label = "unsupported-metadata-file-id";
        let archive_path = export_fixture_archive(root.path(), label);
        let corrupted_archive_path = create_archive_with_rewritten_manifest_metadata_id(
            root.path(),
            &archive_path,
            label,
            RUNTIME_SNAPSHOT_METADATA_ID,
            "surprise-metadata",
        );

        let error = inspect_openclaw_mirror_import(&corrupted_archive_path)
            .expect_err("unsupported metadata file id should be rejected");

        let error_text = error.to_string();
        assert!(
            error_text.contains("unsupported openclaw mirror metadata file id"),
            "unexpected error: {error_text}"
        );
        assert!(
            error_text.contains("surprise-metadata"),
            "unexpected error: {error_text}"
        );
    }

    #[test]
    fn openclaw_mirror_import_rejects_component_manifest_traversal_relative_path() {
        let root = tempfile::tempdir().expect("temp dir");
        let label = "component-manifest-traversal-path";
        let archive_path = export_fixture_archive(root.path(), label);
        let corrupted_archive_path = create_archive_with_rewritten_manifest_component_relative_path(
            root.path(),
            &archive_path,
            label,
            "workspace",
            "components/workspace/../workspace",
        );

        let error = inspect_openclaw_mirror_import(&corrupted_archive_path)
            .expect_err("component manifest traversal path should be rejected");

        let error_text = error.to_string();
        assert!(
            error_text.contains("unsafe openclaw mirror manifest relative path"),
            "unexpected error: {error_text}"
        );
        assert!(
            error_text.contains("component workspace"),
            "unexpected error: {error_text}"
        );
    }

    #[test]
    fn openclaw_mirror_import_rejects_metadata_manifest_traversal_relative_path() {
        let root = tempfile::tempdir().expect("temp dir");
        let label = "metadata-manifest-traversal-path";
        let archive_path = export_fixture_archive(root.path(), label);
        let corrupted_archive_path = create_archive_with_rewritten_manifest_metadata_relative_path(
            root.path(),
            &archive_path,
            label,
            RUNTIME_SNAPSHOT_METADATA_ID,
            "components/../runtime.json",
        );

        let error = inspect_openclaw_mirror_import(&corrupted_archive_path)
            .expect_err("metadata manifest traversal path should be rejected");

        let error_text = error.to_string();
        assert!(
            error_text.contains("unsafe openclaw mirror manifest relative path"),
            "unexpected error: {error_text}"
        );
        assert!(
            error_text.contains("metadata file runtime-snapshot"),
            "unexpected error: {error_text}"
        );
    }

    #[test]
    fn openclaw_mirror_import_rejects_component_kind_mismatch() {
        let root = tempfile::tempdir().expect("temp dir");
        let label = "component-kind-mismatch";
        let archive_path = export_fixture_archive(root.path(), label);
        let corrupted_archive_path = create_archive_with_rewritten_manifest_component_descriptor(
            root.path(),
            &archive_path,
            label,
            "config",
            None,
            Some("workspace"),
            None,
            false,
        );

        let error = inspect_openclaw_mirror_import(&corrupted_archive_path)
            .expect_err("component kind mismatch should be rejected");

        let error_text = error.to_string();
        assert!(
            error_text.contains("openclaw mirror component descriptor mismatch"),
            "unexpected error: {error_text}"
        );
        assert!(
            error_text.contains("config"),
            "unexpected error: {error_text}"
        );
    }

    #[test]
    fn openclaw_mirror_import_rejects_component_relative_path_mismatch() {
        let root = tempfile::tempdir().expect("temp dir");
        let label = "component-relative-path-mismatch";
        let archive_path = export_fixture_archive(root.path(), label);
        let corrupted_archive_path = create_archive_with_rewritten_manifest_component_descriptor(
            root.path(),
            &archive_path,
            label,
            "config",
            None,
            None,
            Some("components/state/agents/main/profile.json"),
            true,
        );

        let error = inspect_openclaw_mirror_import(&corrupted_archive_path)
            .expect_err("component relative path mismatch should be rejected");

        let error_text = error.to_string();
        assert!(
            error_text.contains("openclaw mirror component descriptor mismatch"),
            "unexpected error: {error_text}"
        );
        assert!(
            error_text.contains("config"),
            "unexpected error: {error_text}"
        );
    }

    #[test]
    fn openclaw_mirror_import_rejects_component_byte_size_mismatch() {
        let root = tempfile::tempdir().expect("temp dir");
        let label = "component-byte-size-mismatch";
        let archive_path = export_fixture_archive(root.path(), label);
        let corrupted_archive_path = create_archive_with_rewritten_manifest_component_stats(
            root.path(),
            &archive_path,
            label,
            "config",
            Some(999),
            None,
        );

        let error = inspect_openclaw_mirror_import(&corrupted_archive_path)
            .expect_err("component byte size mismatch should be rejected");

        let error_text = error.to_string();
        assert!(
            error_text.contains("openclaw mirror component byte size mismatch"),
            "unexpected error: {error_text}"
        );
        assert!(
            error_text.contains("config"),
            "unexpected error: {error_text}"
        );
    }

    #[test]
    fn openclaw_mirror_import_rejects_component_file_count_mismatch() {
        let root = tempfile::tempdir().expect("temp dir");
        let label = "component-file-count-mismatch";
        let archive_path = export_fixture_archive(root.path(), label);
        let corrupted_archive_path = create_archive_with_rewritten_manifest_component_stats(
            root.path(),
            &archive_path,
            label,
            "workspace",
            None,
            Some(99),
        );

        let error = inspect_openclaw_mirror_import(&corrupted_archive_path)
            .expect_err("component file count mismatch should be rejected");

        let error_text = error.to_string();
        assert!(
            error_text.contains("openclaw mirror component file count mismatch"),
            "unexpected error: {error_text}"
        );
        assert!(
            error_text.contains("workspace"),
            "unexpected error: {error_text}"
        );
    }

    #[test]
    fn openclaw_mirror_import_rejects_unsupported_component_id() {
        let root = tempfile::tempdir().expect("temp dir");
        let label = "unsupported-component-id";
        let archive_path = export_fixture_archive(root.path(), label);
        let corrupted_archive_path = create_archive_with_rewritten_manifest_component_descriptor(
            root.path(),
            &archive_path,
            label,
            "studio-routing",
            Some("surprise-routing"),
            None,
            None,
            false,
        );

        let error = inspect_openclaw_mirror_import(&corrupted_archive_path)
            .expect_err("unsupported component id should be rejected");

        let error_text = error.to_string();
        assert!(
            error_text.contains("unsupported openclaw mirror component id"),
            "unexpected error: {error_text}"
        );
        assert!(
            error_text.contains("surprise-routing"),
            "unexpected error: {error_text}"
        );
    }

    #[test]
    fn openclaw_mirror_import_rejects_runtime_snapshot_digest_mismatch() {
        let root = tempfile::tempdir().expect("temp dir");
        let label = "runtime-snapshot-digest-mismatch";
        let archive_path = export_fixture_archive(root.path(), label);
        let corrupted_archive_path = create_archive_with_rewritten_file(
            root.path(),
            &archive_path,
            label,
            PRIVATE_RUNTIME_SNAPSHOT_FILE_NAME,
            &format!(
                "{{\n  \"runtimeId\": \"openclaw\",\n  \"installKey\": \"{}\",\n  \"openclawVersion\": \"{}\",\n  \"nodeVersion\": null,\n  \"platform\": \"windows\",\n  \"arch\": \"x64\",\n  \"homeDir\": \"D:/tampered/home/.openclaw\",\n  \"stateDir\": \"D:/tampered/home/.openclaw\",\n  \"workspaceDir\": \"D:/tampered/home/.openclaw/workspace\",\n  \"configFile\": \"D:/tampered/home/.openclaw/openclaw.json\",\n  \"gatewayPort\": 19999\n}}\n",
                current_openclaw_install_key(),
                bundled_openclaw_version(),
            ),
        );

        let error = inspect_openclaw_mirror_import(&corrupted_archive_path)
            .expect_err("runtime snapshot digest mismatch should be rejected");

        let error_text = error.to_string();
        assert!(
            error_text.contains("openclaw mirror metadata"),
            "unexpected error: {error_text}"
        );
        assert!(
            error_text.contains("runtime-snapshot"),
            "unexpected error: {error_text}"
        );
    }

    #[test]
    fn openclaw_mirror_import_rejects_archives_without_required_private_metadata_files() {
        let root = tempfile::tempdir().expect("temp dir");
        let label = "missing-private-metadata";
        let archive_path = export_fixture_archive(root.path(), label);
        let legacy_archive_path =
            create_legacy_archive_without_runtime_snapshot(root.path(), &archive_path, label);

        let error = inspect_openclaw_mirror_import(&legacy_archive_path)
            .expect_err("archives without required metadata should be rejected");

        let error_text = error.to_string();
        assert!(
            error_text.contains("incomplete openclaw mirror metadata file set"),
            "unexpected error: {error_text}"
        );
        assert!(
            error_text.contains("runtime-snapshot"),
            "unexpected error: {error_text}"
        );
    }

    #[test]
    fn openclaw_mirror_import_rejects_manifest_runtime_summary_mismatch() {
        let root = tempfile::tempdir().expect("temp dir");
        let label = "runtime-summary-mismatch";
        let archive_path = export_fixture_archive(root.path(), label);
        let corrupted_archive_path = create_archive_with_rewritten_manifest_runtime_summary(
            root.path(),
            &archive_path,
            label,
            Some("tampered-install-key"),
            None,
        );

        let error = inspect_openclaw_mirror_import(&corrupted_archive_path)
            .expect_err("runtime summary mismatch should be rejected");

        let error_text = error.to_string();
        assert!(
            error_text.contains("openclaw mirror runtime summary mismatch"),
            "unexpected error: {error_text}"
        );
        assert!(
            error_text.contains("installKey"),
            "unexpected error: {error_text}"
        );
    }

    #[test]
    fn openclaw_mirror_import_rejects_managed_skill_outside_canonical_root() {
        let root = tempfile::tempdir().expect("temp dir");
        let label = "managed-skill-outside-root";
        let archive_path = export_fixture_archive(root.path(), label);
        let rogue_skill_path = "components/state/rogue-skill/SKILL.md";
        let archive_with_skill = create_archive_with_extra_file_and_refreshed_component(
            root.path(),
            &archive_path,
            label,
            rogue_skill_path,
            "# Rogue skill\n",
            "state",
        );
        let corrupted_archive_path = create_archive_with_rewritten_managed_assets_snapshot(
            root.path(),
            &archive_with_skill,
            label,
            "{\n  \"schemaVersion\": 1,\n  \"skills\": [\n    {\n      \"anchor\": \"state\",\n      \"relativePath\": \"rogue-skill\"\n    }\n  ],\n  \"plugins\": []\n}\n",
        );

        let error = inspect_openclaw_mirror_import(&corrupted_archive_path)
            .expect_err("skill asset outside canonical root should be rejected");

        let error_text = error.to_string();
        assert!(
            error_text.contains("skill asset inventory path is outside the canonical root"),
            "unexpected error: {error_text}"
        );
        assert!(
            error_text.contains("rogue-skill"),
            "unexpected error: {error_text}"
        );
    }

    #[test]
    fn openclaw_mirror_import_rejects_managed_plugin_outside_canonical_root() {
        let root = tempfile::tempdir().expect("temp dir");
        let label = "managed-plugin-outside-root";
        let archive_path = export_fixture_archive(root.path(), label);
        let archive_with_plugin = create_archive_with_extra_file_and_refreshed_component(
            root.path(),
            &archive_path,
            label,
            "components/state/rogue-plugin/plugin.json",
            "{\n  \"name\": \"rogue-plugin\"\n}\n",
            "state",
        );
        let corrupted_archive_path = create_archive_with_rewritten_managed_assets_snapshot(
            root.path(),
            &archive_with_plugin,
            label,
            "{\n  \"schemaVersion\": 1,\n  \"skills\": [],\n  \"plugins\": [\n    {\n      \"anchor\": \"state\",\n      \"relativePath\": \"rogue-plugin\",\n      \"entryKind\": \"directory\"\n    }\n  ]\n}\n",
        );

        let error = inspect_openclaw_mirror_import(&corrupted_archive_path)
            .expect_err("plugin asset outside canonical root should be rejected");

        let error_text = error.to_string();
        assert!(
            error_text.contains("plugin asset inventory path is outside the canonical root"),
            "unexpected error: {error_text}"
        );
        assert!(
            error_text.contains("rogue-plugin"),
            "unexpected error: {error_text}"
        );
    }

    #[test]
    fn openclaw_mirror_import_accepts_workspace_managed_asset_canonical_roots() {
        validate_openclaw_asset_canonical_root("skill", "workspace", "skills/workspace-calendar")
            .expect("workspace skills root should be accepted");
        validate_openclaw_asset_canonical_root(
            "plugin",
            "workspace",
            ".openclaw/extensions/workspace-voice-call",
        )
        .expect("workspace plugin root should be accepted");
    }

    #[test]
    fn openclaw_mirror_import_rejects_managed_assets_snapshot_digest_mismatch() {
        let root = tempfile::tempdir().expect("temp dir");
        let label = "managed-assets-digest-mismatch";
        let archive_path = export_fixture_archive(root.path(), label);
        let corrupted_archive_path = create_archive_with_rewritten_file(
            root.path(),
            &archive_path,
            label,
            PRIVATE_MANAGED_ASSETS_FILE_NAME,
            "{\n  \"schemaVersion\": 1,\n  \"skills\": [\n    {\n      \"anchor\": \"state\",\n      \"relativePath\": \"skills/tampered-skill\"\n    }\n  ],\n  \"plugins\": []\n}\n",
        );

        let error = inspect_openclaw_mirror_import(&corrupted_archive_path)
            .expect_err("OpenClaw assets snapshot digest mismatch should be rejected");

        let error_text = error.to_string();
        assert!(
            error_text.contains("openclaw mirror metadata"),
            "unexpected error: {error_text}"
        );
        assert!(
            error_text.contains("managed-assets-inventory"),
            "unexpected error: {error_text}"
        );
    }

    #[test]
    fn openclaw_mirror_import_restores_managed_runtime_and_creates_safety_snapshot() {
        let root = tempfile::tempdir().expect("temp dir");
        let archive_path = export_fixture_archive(root.path(), "restore-source");
        let target_root = root.path().join("target-runtime");
        let paths = resolve_paths_for_root(&target_root).expect("target paths");
        let config = create_storage_config();
        let storage = StorageService::new();
        seed_built_in_openclaw_tree(&paths, "restore-target-before");
        seed_provider_center_route(
            &storage,
            &paths,
            &config,
            "route-stale",
            "gemini",
            "https://generativelanguage.googleapis.com/v1beta",
            "gemini-2.5-pro",
        );
        let runtime = create_gateway_runtime(&paths, reserve_test_loopback_port());
        let supervisor = SupervisorService::for_paths(&paths);
        let local_ai_proxy = LocalAiProxyService::new();
        supervisor
            .configure_openclaw_gateway(&runtime)
            .expect("configure runtime");

        let result = import_openclaw_mirror(
            &paths,
            &config,
            &storage,
            &local_ai_proxy,
            &supervisor,
            &runtime,
            &OpenClawMirrorImportRequest {
                source_path: archive_path,
                create_safety_snapshot: true,
                restart_gateway: false,
            },
        )
        .expect("import mirror");

        let config_text =
            fs::read_to_string(&openclaw_config_file_path(&paths)).expect("restored config text");
        let state_text = fs::read_to_string(
            paths
                .openclaw_root_dir
                .join("agents")
                .join("main")
                .join("profile.json"),
        )
        .expect("restored state text");
        let workspace_text =
            fs::read_to_string(paths.openclaw_workspace_dir.join("AGENTS.md")).expect("workspace");
        let doctor_text =
            fs::read_to_string(doctor_marker_path(&paths)).expect("doctor marker text");
        let listed_routes = storage
            .list_keys(
                &paths,
                &config,
                StorageListKeysRequest {
                    profile_id: Some("default-sqlite".to_string()),
                    namespace: Some(LOCAL_AI_PROXY_PROVIDER_CENTER_NAMESPACE.to_string()),
                },
            )
            .expect("list provider center routes");
        let restored_route = storage
            .get_text(
                &paths,
                &config,
                StorageGetTextRequest {
                    profile_id: Some("default-sqlite".to_string()),
                    namespace: Some(LOCAL_AI_PROXY_PROVIDER_CENTER_NAMESPACE.to_string()),
                    key: "route-openai".to_string(),
                },
            )
            .expect("read restored route");
        let restored_openclaw_config =
            serde_json::from_str::<Value>(&config_text).expect("openclaw config json");

        assert!(config_text.contains("restore-source"));
        assert!(state_text.contains("restore-source"));
        assert!(workspace_text.contains("restore-source"));
        assert!(doctor_text.contains("\"doctor\""));
        assert!(doctor_text.contains("\"--fix\""));
        assert!(doctor_text.contains("\"--non-interactive\""));
        assert!(doctor_text.contains("\"--yes\""));
        assert!(result.safety_snapshot.is_some());
        assert_eq!(result.restored_components.len(), 4);
        assert_eq!(result.verification.status, "ready");
        assert_eq!(result.verification.checks.len(), 9);
        assert!(result
            .verification
            .checks
            .iter()
            .any(|check| check.id == "openclaw-config-file" && check.status == "passed"));
        assert!(result
            .verification
            .checks
            .iter()
            .any(|check| check.id == "provider-center-catalog" && check.status == "passed"));
        assert!(result
            .verification
            .checks
            .iter()
            .any(|check| check.id == "local-proxy" && check.status == "passed"));
        assert!(result
            .verification
            .checks
            .iter()
            .any(|check| check.id == "managed-openclaw-provider" && check.status == "passed"));
        assert!(result
            .verification
            .checks
            .iter()
            .any(|check| check.id == "managed-skills" && check.status == "skipped"));
        assert!(result
            .verification
            .checks
            .iter()
            .any(|check| check.id == "managed-plugins" && check.status == "skipped"));
        assert!(result
            .verification
            .checks
            .iter()
            .any(|check| check.id == "gateway" && check.status == "passed"));
        assert_eq!(listed_routes.keys, vec!["route-openai".to_string()]);
        assert!(restored_route
            .value
            .as_deref()
            .unwrap_or_default()
            .contains("https://api.openai.com/v1"));
        assert_eq!(
            restored_openclaw_config["gateway"]["port"],
            Value::from(u64::from(runtime.gateway_port))
        );
        assert_eq!(
            restored_openclaw_config["gateway"]["auth"]["mode"],
            Value::String("token".to_string())
        );
        assert_eq!(
            restored_openclaw_config["gateway"]["auth"]["token"],
            Value::String(runtime.gateway_auth_token.clone())
        );
        assert!(
            restored_openclaw_config
                .pointer("/agents/defaults/workspace")
                .is_none(),
            "managed restore must not reintroduce agents.defaults.workspace because OpenClaw treats it as a global fallback for non-main agents"
        );
        assert_eq!(
            restored_openclaw_config["models"]["providers"]["sdkwork-local-proxy"]["apiKey"],
            Value::String("${SDKWORK_LOCAL_PROXY_TOKEN}".to_string())
        );
        assert!(
            restored_openclaw_config["models"]["providers"]["sdkwork-local-proxy"]["baseUrl"]
                .as_str()
                .unwrap_or_default()
                .contains("/v1")
        );
        assert_eq!(
            restored_openclaw_config["agents"]["defaults"]["model"]["primary"],
            Value::String("sdkwork-local-proxy/gpt-5.4".to_string())
        );
        local_ai_proxy.stop().expect("stop local ai proxy");
    }

    #[test]
    fn openclaw_mirror_import_runs_doctor_in_non_interactive_mode() {
        let root = tempfile::tempdir().expect("temp dir");
        let archive_path = export_fixture_archive(root.path(), "doctor-automation-source");
        let target_root = root.path().join("doctor-automation-target");
        let paths = resolve_paths_for_root(&target_root).expect("target paths");
        let config = create_storage_config();
        let storage = StorageService::new();
        seed_built_in_openclaw_tree(&paths, "doctor-automation-target-before");
        let runtime = create_gateway_runtime(&paths, reserve_test_loopback_port());
        let supervisor = SupervisorService::for_paths(&paths);
        let local_ai_proxy = LocalAiProxyService::new();
        supervisor
            .configure_openclaw_gateway(&runtime)
            .expect("configure runtime");

        import_openclaw_mirror(
            &paths,
            &config,
            &storage,
            &local_ai_proxy,
            &supervisor,
            &runtime,
            &OpenClawMirrorImportRequest {
                source_path: archive_path,
                create_safety_snapshot: false,
                restart_gateway: false,
            },
        )
        .expect("import mirror");

        let doctor_text =
            fs::read_to_string(doctor_marker_path(&paths)).expect("doctor marker text");
        assert!(doctor_text.contains("\"doctor\""));
        assert!(doctor_text.contains("\"--fix\""));
        assert!(doctor_text.contains("\"--non-interactive\""));
        assert!(doctor_text.contains("\"--yes\""));

        local_ai_proxy.stop().expect("stop local ai proxy");
    }

    #[test]
    fn openclaw_mirror_import_verification_detects_missing_managed_plugin_assets() {
        let root = tempfile::tempdir().expect("temp dir");
        let archive_path = export_fixture_archive_with_missing_managed_skill_and_plugin_assets(
            root.path(),
            "missing-managed-assets-source",
        );
        let target_root = root.path().join("missing-managed-assets-target");
        let paths = resolve_paths_for_root(&target_root).expect("target paths");
        let config = create_storage_config();
        let storage = StorageService::new();
        seed_built_in_openclaw_tree(&paths, "missing-managed-assets-target-before");
        let runtime = create_gateway_runtime(&paths, reserve_test_loopback_port());
        let supervisor = SupervisorService::new();
        let local_ai_proxy = LocalAiProxyService::new();
        supervisor
            .configure_openclaw_gateway(&runtime)
            .expect("configure runtime");

        let result = import_openclaw_mirror(
            &paths,
            &config,
            &storage,
            &local_ai_proxy,
            &supervisor,
            &runtime,
            &OpenClawMirrorImportRequest {
                source_path: archive_path,
                create_safety_snapshot: false,
                restart_gateway: false,
            },
        )
        .expect("import mirror");

        assert_eq!(result.verification.status, "degraded");
        assert!(result
            .verification
            .checks
            .iter()
            .any(|check| check.id == "managed-plugins" && check.status == "failed"));

        local_ai_proxy.stop().expect("stop local ai proxy");
    }

    #[test]
    fn openclaw_mirror_import_repairs_missing_local_managed_plugin_install() {
        let root = tempfile::tempdir().expect("temp dir");
        let archive_path = export_fixture_archive_with_missing_local_managed_plugin_install(
            root.path(),
            "repair-local-plugin-source",
        );
        let target_root = root.path().join("repair-local-plugin-target");
        let paths = resolve_paths_for_root(&target_root).expect("target paths");
        let config = create_storage_config();
        let storage = StorageService::new();
        seed_built_in_openclaw_tree(&paths, "repair-local-plugin-target-before");
        let runtime = create_gateway_runtime(&paths, reserve_test_loopback_port());
        let supervisor = SupervisorService::new();
        let local_ai_proxy = LocalAiProxyService::new();
        supervisor
            .configure_openclaw_gateway(&runtime)
            .expect("configure runtime");

        let result = import_openclaw_mirror(
            &paths,
            &config,
            &storage,
            &local_ai_proxy,
            &supervisor,
            &runtime,
            &OpenClawMirrorImportRequest {
                source_path: archive_path,
                create_safety_snapshot: false,
                restart_gateway: false,
            },
        )
        .expect("import mirror");

        let install_root = paths
            .openclaw_root_dir
            .join("extensions")
            .join("voice-call");
        assert!(install_root.is_dir());
        assert!(install_root.join("plugin.json").is_file());
        assert_eq!(result.verification.status, "ready");
        assert!(result
            .verification
            .checks
            .iter()
            .any(|check| check.id == "managed-plugins" && check.status == "passed"));

        local_ai_proxy.stop().expect("stop local ai proxy");
    }

    #[test]
    fn openclaw_mirror_import_rejects_missing_managed_asset_entries_before_restore() {
        let root = tempfile::tempdir().expect("temp dir");
        let label = "managed-asset-entries-source";
        let archive_path =
            export_fixture_archive_with_managed_skill_and_plugin_assets(root.path(), label);
        let corrupted_archive_path = create_archive_without_payload_paths(
            root.path(),
            &archive_path,
            label,
            &[
                "components/state/skills/shared-calendar",
                "components/state/extensions/voice-call",
                "components/workspace/skills/workspace-calendar",
                "components/workspace/.openclaw/extensions/workspace-voice-call",
            ],
        );
        let target_root = root.path().join("managed-asset-entries-target");
        let paths = resolve_paths_for_root(&target_root).expect("target paths");
        let config = create_storage_config();
        let storage = StorageService::new();
        seed_built_in_openclaw_tree(&paths, "managed-asset-entries-target-before");
        let runtime = create_gateway_runtime(&paths, reserve_test_loopback_port());
        let original_config =
            fs::read_to_string(&openclaw_config_file_path(&paths)).expect("original config");
        let original_workspace = fs::read_to_string(paths.openclaw_workspace_dir.join("AGENTS.md"))
            .expect("original workspace");
        let original_profile = fs::read_to_string(
            paths
                .openclaw_root_dir
                .join("agents")
                .join("main")
                .join("profile.json"),
        )
        .expect("original profile");
        let supervisor = SupervisorService::new();
        let local_ai_proxy = LocalAiProxyService::new();
        supervisor
            .configure_openclaw_gateway(&runtime)
            .expect("configure runtime");

        let error = import_openclaw_mirror(
            &paths,
            &config,
            &storage,
            &local_ai_proxy,
            &supervisor,
            &runtime,
            &OpenClawMirrorImportRequest {
                source_path: corrupted_archive_path,
                create_safety_snapshot: false,
                restart_gateway: false,
            },
        )
        .expect_err("OpenClaw asset validation should fail before restore");

        let error_text = error.to_string();
        assert!(
            error_text.contains("skill asset payload missing")
                || error_text.contains("plugin asset payload missing"),
            "unexpected error: {error_text}"
        );
        assert_eq!(
            fs::read_to_string(&openclaw_config_file_path(&paths)).expect("config after failure"),
            original_config
        );
        assert_eq!(
            fs::read_to_string(paths.openclaw_workspace_dir.join("AGENTS.md"))
                .expect("workspace after failure"),
            original_workspace
        );
        assert_eq!(
            fs::read_to_string(
                paths
                    .openclaw_root_dir
                    .join("agents")
                    .join("main")
                    .join("profile.json"),
            )
            .expect("profile after failure"),
            original_profile
        );
        assert!(!doctor_marker_path(&paths).exists());
    }

    #[test]
    fn openclaw_mirror_import_rejects_component_digest_mismatch_before_restore() {
        let root = tempfile::tempdir().expect("temp dir");
        let label = "component-digest-source";
        let archive_path = export_fixture_archive(root.path(), label);
        let corrupted_archive_path = create_archive_with_rewritten_file(
            root.path(),
            &archive_path,
            label,
            "components/config/openclaw.json",
            "{ \"label\": \"tampered\" }\n",
        );
        let target_root = root.path().join("component-digest-target");
        let paths = resolve_paths_for_root(&target_root).expect("target paths");
        let config = create_storage_config();
        let storage = StorageService::new();
        seed_built_in_openclaw_tree(&paths, "component-digest-target-before");
        let runtime = create_gateway_runtime(&paths, reserve_test_loopback_port());
        let original_config =
            fs::read_to_string(&openclaw_config_file_path(&paths)).expect("original config");
        let original_workspace = fs::read_to_string(paths.openclaw_workspace_dir.join("AGENTS.md"))
            .expect("original workspace");
        let original_profile = fs::read_to_string(
            paths
                .openclaw_root_dir
                .join("agents")
                .join("main")
                .join("profile.json"),
        )
        .expect("original profile");
        let supervisor = SupervisorService::new();
        let local_ai_proxy = LocalAiProxyService::new();
        supervisor
            .configure_openclaw_gateway(&runtime)
            .expect("configure runtime");

        let error = import_openclaw_mirror(
            &paths,
            &config,
            &storage,
            &local_ai_proxy,
            &supervisor,
            &runtime,
            &OpenClawMirrorImportRequest {
                source_path: corrupted_archive_path,
                create_safety_snapshot: false,
                restart_gateway: false,
            },
        )
        .expect_err("component digest mismatch should fail before restore");

        let error_text = error.to_string();
        assert!(
            error_text.contains("component digest mismatch"),
            "unexpected error: {error_text}"
        );
        assert_eq!(
            fs::read_to_string(&openclaw_config_file_path(&paths)).expect("config after failure"),
            original_config
        );
        assert_eq!(
            fs::read_to_string(paths.openclaw_workspace_dir.join("AGENTS.md"))
                .expect("workspace after failure"),
            original_workspace
        );
        assert_eq!(
            fs::read_to_string(
                paths
                    .openclaw_root_dir
                    .join("agents")
                    .join("main")
                    .join("profile.json"),
            )
            .expect("profile after failure"),
            original_profile
        );
        assert!(!doctor_marker_path(&paths).exists());
    }

    #[test]
    fn openclaw_mirror_import_rebases_managed_paths_after_restore() {
        let root = tempfile::tempdir().expect("temp dir");
        let archive_path =
            export_fixture_archive_with_stale_managed_config(root.path(), "rebase-source");
        let target_root = root.path().join("rebase-target");
        let paths = resolve_paths_for_root(&target_root).expect("target paths");
        let config = create_storage_config();
        let storage = StorageService::new();
        seed_built_in_openclaw_tree(&paths, "rebase-target-before");
        let runtime = create_gateway_runtime(&paths, reserve_test_loopback_port());
        let supervisor = SupervisorService::new();
        let local_ai_proxy = LocalAiProxyService::new();
        supervisor
            .configure_openclaw_gateway(&runtime)
            .expect("configure runtime");

        import_openclaw_mirror(
            &paths,
            &config,
            &storage,
            &local_ai_proxy,
            &supervisor,
            &runtime,
            &OpenClawMirrorImportRequest {
                source_path: archive_path,
                create_safety_snapshot: false,
                restart_gateway: false,
            },
        )
        .expect("import mirror");

        let restored_openclaw_config = serde_json::from_str::<Value>(
            &fs::read_to_string(&openclaw_config_file_path(&paths)).expect("restored config text"),
        )
        .expect("restored config json");
        let agents_list = restored_openclaw_config["agents"]["list"]
            .as_array()
            .expect("agents list");
        let main_agent = agents_list
            .iter()
            .find(|entry| entry["id"] == "main")
            .expect("main agent");
        let writer_agent = agents_list
            .iter()
            .find(|entry| entry["id"] == "writer-agent")
            .expect("canonical writer agent");

        assert_eq!(
            restored_openclaw_config["gateway"]["port"],
            Value::from(u64::from(runtime.gateway_port))
        );
        assert_eq!(
            restored_openclaw_config["gateway"]["auth"]["mode"],
            Value::String("token".to_string())
        );
        assert_eq!(
            restored_openclaw_config["gateway"]["auth"]["token"],
            Value::String(runtime.gateway_auth_token.clone())
        );
        assert!(
            restored_openclaw_config
                .pointer("/agents/defaults/workspace")
                .is_none(),
            "managed restore must not reintroduce agents.defaults.workspace because OpenClaw treats it as a global fallback for non-main agents"
        );
        assert_json_path_value(&main_agent["workspace"], &paths.openclaw_workspace_dir);
        assert_json_path_value(
            &main_agent["agentDir"],
            &paths
                .openclaw_root_dir
                .join("agents")
                .join("main")
                .join("agent"),
        );
        assert_json_path_value(
            &writer_agent["workspace"],
            &paths.openclaw_root_dir.join("workspace-writer-agent"),
        );
        assert_json_path_value(
            &writer_agent["agentDir"],
            &paths
                .openclaw_root_dir
                .join("agents")
                .join("writer-agent")
                .join("agent"),
        );

        local_ai_proxy.stop().expect("stop local ai proxy");
    }

    #[test]
    fn openclaw_mirror_import_rebases_managed_skill_extra_dirs_after_restore() {
        let root = tempfile::tempdir().expect("temp dir");
        let label = "rebase-skills-source";
        let archive_path = export_fixture_archive_with_stale_skill_extra_dirs(root.path(), label);
        let target_root = root.path().join("rebase-skills-target");
        let external_skills_dir = root.path().join(format!("external-{label}-skills"));
        let paths = resolve_paths_for_root(&target_root).expect("target paths");
        let config = create_storage_config();
        let storage = StorageService::new();
        seed_built_in_openclaw_tree(&paths, "rebase-skills-target-before");
        let runtime = create_gateway_runtime(&paths, reserve_test_loopback_port());
        let supervisor = SupervisorService::new();
        let local_ai_proxy = LocalAiProxyService::new();
        supervisor
            .configure_openclaw_gateway(&runtime)
            .expect("configure runtime");

        import_openclaw_mirror(
            &paths,
            &config,
            &storage,
            &local_ai_proxy,
            &supervisor,
            &runtime,
            &OpenClawMirrorImportRequest {
                source_path: archive_path,
                create_safety_snapshot: false,
                restart_gateway: false,
            },
        )
        .expect("import mirror");

        let restored_openclaw_config = serde_json::from_str::<Value>(
            &fs::read_to_string(&openclaw_config_file_path(&paths)).expect("restored config text"),
        )
        .expect("restored config json");
        let extra_dirs = restored_openclaw_config["skills"]["load"]["extraDirs"]
            .as_array()
            .expect("extraDirs array");

        assert_eq!(extra_dirs.len(), 2);
        assert_json_path_value(&extra_dirs[0], &paths.openclaw_skills_dir);
        assert_json_path_value(&extra_dirs[1], &external_skills_dir);

        local_ai_proxy.stop().expect("stop local ai proxy");
    }

    #[test]
    fn openclaw_mirror_import_rebases_managed_plugin_paths_after_restore() {
        let root = tempfile::tempdir().expect("temp dir");
        let label = "rebase-plugins-source";
        let archive_path = export_fixture_archive_with_stale_plugin_paths(root.path(), label);
        let target_root = root.path().join("rebase-plugins-target");
        let external_plugins_dir = root.path().join(format!("external-{label}-plugins"));
        let paths = resolve_paths_for_root(&target_root).expect("target paths");
        let config = create_storage_config();
        let storage = StorageService::new();
        seed_built_in_openclaw_tree(&paths, "rebase-plugins-target-before");
        let runtime = create_gateway_runtime(&paths, reserve_test_loopback_port());
        let supervisor = SupervisorService::new();
        let local_ai_proxy = LocalAiProxyService::new();
        supervisor
            .configure_openclaw_gateway(&runtime)
            .expect("configure runtime");

        import_openclaw_mirror(
            &paths,
            &config,
            &storage,
            &local_ai_proxy,
            &supervisor,
            &runtime,
            &OpenClawMirrorImportRequest {
                source_path: archive_path,
                create_safety_snapshot: false,
                restart_gateway: false,
            },
        )
        .expect("import mirror");

        let restored_openclaw_config = serde_json::from_str::<Value>(
            &fs::read_to_string(&openclaw_config_file_path(&paths)).expect("restored config text"),
        )
        .expect("restored config json");
        let plugin_paths = restored_openclaw_config["plugins"]["load"]["paths"]
            .as_array()
            .expect("plugin load paths array");
        let install_root = restored_openclaw_config["plugins"]["installs"]["voice-call"]
            .as_object()
            .expect("plugin install root");

        assert_eq!(plugin_paths.len(), 2);
        assert_json_path_value(&plugin_paths[0], &paths.openclaw_extensions_dir);
        assert_json_path_value(&plugin_paths[1], &external_plugins_dir);
        assert_json_path_value(
            install_root.get("installPath").expect("install path"),
            &paths.openclaw_extensions_dir.join("voice-call"),
        );
        assert_json_path_value(
            install_root.get("sourcePath").expect("source path"),
            &paths
                .openclaw_workspace_extensions_dir
                .join("workspace-voice-call"),
        );

        local_ai_proxy.stop().expect("stop local ai proxy");
    }

    #[test]
    fn openclaw_mirror_import_rejects_legacy_archives_without_runtime_diagnostics() {
        let root = tempfile::tempdir().expect("temp dir");
        let label = "legacy-rebase-source";
        let archive_path =
            export_fixture_archive_with_stale_skill_and_plugin_paths(root.path(), label);
        let legacy_archive_path =
            create_legacy_archive_without_runtime_snapshot(root.path(), &archive_path, label);
        let target_root = root.path().join("legacy-rebase-target");
        let paths = resolve_paths_for_root(&target_root).expect("target paths");
        let config = create_storage_config();
        let storage = StorageService::new();
        seed_built_in_openclaw_tree(&paths, "legacy-rebase-target-before");
        let runtime = create_gateway_runtime(&paths, reserve_test_loopback_port());
        let supervisor = SupervisorService::new();
        let local_ai_proxy = LocalAiProxyService::new();
        supervisor
            .configure_openclaw_gateway(&runtime)
            .expect("configure runtime");

        let error = import_openclaw_mirror(
            &paths,
            &config,
            &storage,
            &local_ai_proxy,
            &supervisor,
            &runtime,
            &OpenClawMirrorImportRequest {
                source_path: legacy_archive_path,
                create_safety_snapshot: false,
                restart_gateway: false,
            },
        )
        .expect_err("legacy mirror should be rejected");

        let error_text = error.to_string();
        assert!(
            error_text.contains("incomplete openclaw mirror metadata file set"),
            "unexpected error: {error_text}"
        );
        assert!(
            error_text.contains("runtime-snapshot"),
            "unexpected error: {error_text}"
        );

        local_ai_proxy.stop().expect("stop local ai proxy");
    }

    #[test]
    fn openclaw_mirror_import_hides_all_background_child_processes() {
        let production_source = include_str!("openclaw_mirror_import.rs")
            .split("mod tests {")
            .next()
            .expect("production source");

        let doctor_source = production_source
            .split("fn run_post_import_doctor")
            .nth(1)
            .and_then(|tail| tail.split("fn build_safety_snapshot_record").next())
            .expect("post-import doctor source");
        assert!(
            doctor_source.contains("configure_hidden_child_process(&mut command);"),
            "post-import OpenClaw doctor runs node.exe from the GUI app and must hide child process windows"
        );

        let archive_listing_source = production_source
            .split("fn list_windows_archive_entries")
            .nth(1)
            .and_then(|tail| tail.split("fn normalize_archive_entry_name").next())
            .expect("windows archive listing source");
        assert!(
            archive_listing_source.contains("configure_hidden_child_process(&mut command);"),
            "PowerShell ZipArchive listing must use the shared hidden child process policy"
        );

        let archive_extract_source = production_source
            .split("fn extract_windows_archive")
            .nth(1)
            .and_then(|tail| tail.split("fn extract_unix_archive").next())
            .expect("windows archive extract source");
        assert!(
            archive_extract_source.contains("configure_hidden_child_process(&mut command);"),
            "PowerShell Expand-Archive must use the shared hidden child process policy"
        );
    }

    #[test]
    fn openclaw_mirror_import_can_restart_gateway_when_requested() {
        let root = tempfile::tempdir().expect("temp dir");
        let archive_path = export_fixture_archive(root.path(), "restart-source");
        let target_root = root.path().join("restart-target");
        let paths = resolve_paths_for_root(&target_root).expect("target paths");
        seed_built_in_openclaw_tree(&paths, "restart-target-before");
        let config = create_storage_config();
        let storage = StorageService::new();
        let gateway_port = reserve_test_loopback_port();
        let runtime = create_gateway_runtime(&paths, gateway_port);
        let supervisor = SupervisorService::for_paths(&paths);
        let local_ai_proxy = LocalAiProxyService::new();
        supervisor
            .configure_openclaw_gateway(&runtime)
            .expect("configure runtime");

        let result = import_openclaw_mirror(
            &paths,
            &config,
            &storage,
            &local_ai_proxy,
            &supervisor,
            &runtime,
            &OpenClawMirrorImportRequest {
                source_path: archive_path,
                create_safety_snapshot: false,
                restart_gateway: true,
            },
        )
        .expect("import mirror");

        assert!(!result.gateway_was_running);
        assert!(result.gateway_running_after_import);
        assert_eq!(result.verification.status, "ready");
        assert!(result
            .verification
            .checks
            .iter()
            .any(|check| check.id == "gateway" && check.status == "passed"));
        assert!(supervisor
            .is_openclaw_gateway_running()
            .expect("gateway running state"));

        local_ai_proxy.stop().expect("stop local ai proxy");
        supervisor.begin_shutdown().expect("shutdown");
    }

    #[test]
    fn openclaw_mirror_import_can_leave_gateway_stopped_after_restore() {
        let root = tempfile::tempdir().expect("temp dir");
        let archive_path = export_fixture_archive(root.path(), "stopped-source");
        let target_root = root.path().join("stopped-target");
        let paths = resolve_paths_for_root(&target_root).expect("target paths");
        seed_built_in_openclaw_tree(&paths, "stopped-target-before");
        let config = create_storage_config();
        let storage = StorageService::new();
        let gateway_port = reserve_test_loopback_port();
        let runtime = create_gateway_runtime(&paths, gateway_port);
        let supervisor = SupervisorService::for_paths(&paths);
        let local_ai_proxy = LocalAiProxyService::new();
        supervisor
            .configure_openclaw_gateway(&runtime)
            .expect("configure runtime");
        supervisor
            .start_openclaw_gateway(&paths)
            .expect("start gateway");

        let result = import_openclaw_mirror(
            &paths,
            &config,
            &storage,
            &local_ai_proxy,
            &supervisor,
            &runtime,
            &OpenClawMirrorImportRequest {
                source_path: archive_path,
                create_safety_snapshot: false,
                restart_gateway: false,
            },
        )
        .expect("import mirror");

        assert!(result.gateway_was_running);
        assert!(!result.gateway_running_after_import);
        assert_eq!(result.verification.status, "ready");
        assert!(result
            .verification
            .checks
            .iter()
            .any(|check| check.id == "gateway" && check.status == "passed"));
        assert!(!supervisor
            .is_openclaw_gateway_running()
            .expect("gateway running state"));
        local_ai_proxy.stop().expect("stop local ai proxy");
    }
}
