use crate::framework::{
    components::{
        bundled_component_defaults, PackagedComponentDefinition, PackagedComponentKind,
        PackagedComponentStartupMode,
    },
    paths::AppPaths,
    Result,
};
use serde::{de::DeserializeOwned, Deserialize, Serialize};
use std::{collections::BTreeMap, fs, path::Path};

const LAYOUT_VERSION: u32 = 1;
const PRODUCT_ID: &str = "sdkwork.crawstudio";

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub struct LayoutState {
    pub layout_version: u32,
    pub product_id: String,
    pub install_root: String,
    pub machine_root: String,
    pub user_root: String,
    pub last_migrated_at: Option<String>,
}

impl Default for LayoutState {
    fn default() -> Self {
        Self {
            layout_version: LAYOUT_VERSION,
            product_id: PRODUCT_ID.to_string(),
            install_root: String::new(),
            machine_root: String::new(),
            user_root: String::new(),
            last_migrated_at: None,
        }
    }
}

impl LayoutState {
    pub fn from_paths(paths: &AppPaths) -> Self {
        Self {
            install_root: paths.install_root.to_string_lossy().into_owned(),
            machine_root: paths.machine_root.to_string_lossy().into_owned(),
            user_root: paths.user_root.to_string_lossy().into_owned(),
            ..Self::default()
        }
    }
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(default, rename_all = "camelCase")]
pub struct ActiveStateEntry {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub active_version: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub fallback_version: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub active_install_key: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub fallback_install_key: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub active_version_label: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub fallback_version_label: Option<String>,
}

impl ActiveStateEntry {
    pub fn active_runtime_install_key(&self) -> Option<&str> {
        self.active_install_key.as_deref()
    }

    pub fn fallback_runtime_install_key(&self) -> Option<&str> {
        self.fallback_install_key.as_deref()
    }

    #[allow(dead_code)]
    pub fn active_runtime_version_label(&self) -> Option<&str> {
        self.active_version_label.as_deref()
    }

    #[allow(dead_code)]
    pub fn fallback_runtime_version_label(&self) -> Option<&str> {
        self.fallback_version_label.as_deref()
    }

    pub fn set_runtime_state(
        &mut self,
        active_install_key: Option<String>,
        fallback_install_key: Option<String>,
        active_version_label: Option<String>,
        fallback_version_label: Option<String>,
    ) {
        self.active_install_key = active_install_key.clone();
        self.fallback_install_key = fallback_install_key.clone();
        self.active_version_label = active_version_label.or_else(|| active_install_key.clone());
        self.fallback_version_label =
            fallback_version_label.or_else(|| fallback_install_key.clone());
        self.active_version = None;
        self.fallback_version = None;
    }
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub struct ActiveState {
    pub layout_version: u32,
    pub modules: BTreeMap<String, ActiveStateEntry>,
    pub runtimes: BTreeMap<String, ActiveStateEntry>,
}

impl Default for ActiveState {
    fn default() -> Self {
        Self {
            layout_version: LAYOUT_VERSION,
            modules: BTreeMap::new(),
            runtimes: BTreeMap::new(),
        }
    }
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub struct InventoryState {
    pub layout_version: u32,
    pub module_packages: BTreeMap<String, Vec<String>>,
    pub runtime_packages: BTreeMap<String, Vec<String>>,
}

impl Default for InventoryState {
    fn default() -> Self {
        Self {
            layout_version: LAYOUT_VERSION,
            module_packages: BTreeMap::new(),
            runtime_packages: BTreeMap::new(),
        }
    }
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub struct PinnedState {
    pub layout_version: u32,
    pub modules: BTreeMap<String, Vec<String>>,
    pub runtimes: BTreeMap<String, Vec<String>>,
}

impl Default for PinnedState {
    fn default() -> Self {
        Self {
            layout_version: LAYOUT_VERSION,
            modules: BTreeMap::new(),
            runtimes: BTreeMap::new(),
        }
    }
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub struct ChannelState {
    pub layout_version: u32,
    pub modules: BTreeMap<String, String>,
    pub runtimes: BTreeMap<String, String>,
}

impl Default for ChannelState {
    fn default() -> Self {
        Self {
            layout_version: LAYOUT_VERSION,
            modules: BTreeMap::new(),
            runtimes: BTreeMap::new(),
        }
    }
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub struct PolicyState {
    pub layout_version: u32,
    pub allow_module_hot_update: bool,
    pub allow_runtime_hot_update: bool,
    pub allow_rollback: bool,
    pub require_signed_packages: bool,
}

impl Default for PolicyState {
    fn default() -> Self {
        Self {
            layout_version: LAYOUT_VERSION,
            allow_module_hot_update: true,
            allow_runtime_hot_update: true,
            allow_rollback: true,
            require_signed_packages: true,
        }
    }
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub struct SourceState {
    pub layout_version: u32,
    pub modules: BTreeMap<String, Vec<String>>,
    pub runtimes: BTreeMap<String, Vec<String>>,
}

impl Default for SourceState {
    fn default() -> Self {
        Self {
            layout_version: LAYOUT_VERSION,
            modules: BTreeMap::new(),
            runtimes: BTreeMap::new(),
        }
    }
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub struct ServiceState {
    pub layout_version: u32,
    pub service_enabled: bool,
    pub maintenance_mode: bool,
    pub last_cleanup_at: Option<String>,
    pub last_health_check_at: Option<String>,
}

impl Default for ServiceState {
    fn default() -> Self {
        Self {
            layout_version: LAYOUT_VERSION,
            service_enabled: true,
            maintenance_mode: false,
            last_cleanup_at: None,
            last_health_check_at: None,
        }
    }
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub struct ComponentStateEntry {
    pub display_name: String,
    pub kind: String,
    pub bundled_version: String,
    pub active_version: Option<String>,
    pub fallback_version: Option<String>,
    pub startup_mode: String,
    pub enabled_by_default: bool,
}

impl Default for ComponentStateEntry {
    fn default() -> Self {
        Self {
            display_name: String::new(),
            kind: "binary".to_string(),
            bundled_version: "bundled".to_string(),
            active_version: None,
            fallback_version: None,
            startup_mode: "manual".to_string(),
            enabled_by_default: false,
        }
    }
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub struct ComponentsState {
    pub layout_version: u32,
    pub entries: BTreeMap<String, ComponentStateEntry>,
}

impl Default for ComponentsState {
    fn default() -> Self {
        Self {
            layout_version: LAYOUT_VERSION,
            entries: bundled_component_defaults()
                .into_iter()
                .map(|definition| {
                    (
                        definition.id.clone(),
                        ComponentStateEntry::from_definition(&definition),
                    )
                })
                .collect(),
        }
    }
}

impl ComponentStateEntry {
    fn from_definition(definition: &PackagedComponentDefinition) -> Self {
        Self {
            display_name: definition.display_name.clone(),
            kind: component_kind_label(&definition.kind).to_string(),
            bundled_version: definition.bundled_version.clone(),
            active_version: Some(definition.bundled_version.clone()),
            fallback_version: None,
            startup_mode: startup_mode_label(&definition.startup_mode).to_string(),
            enabled_by_default: definition.startup_mode == PackagedComponentStartupMode::AutoStart,
        }
    }
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub struct UpgradeStateEntry {
    pub channel: String,
    pub auto_upgrade_enabled: bool,
    pub last_attempted_version: Option<String>,
    pub last_applied_version: Option<String>,
    pub last_attempted_at: Option<String>,
    pub last_error: Option<String>,
}

impl Default for UpgradeStateEntry {
    fn default() -> Self {
        Self {
            channel: "stable".to_string(),
            auto_upgrade_enabled: false,
            last_attempted_version: None,
            last_applied_version: None,
            last_attempted_at: None,
            last_error: None,
        }
    }
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub struct UpgradesState {
    pub layout_version: u32,
    pub components: BTreeMap<String, UpgradeStateEntry>,
}

impl Default for UpgradesState {
    fn default() -> Self {
        Self {
            layout_version: LAYOUT_VERSION,
            components: bundled_component_defaults()
                .into_iter()
                .map(|definition| {
                    (
                        definition.id,
                        UpgradeStateEntry {
                            channel: definition.upgrade_channel,
                            auto_upgrade_enabled: false,
                            ..UpgradeStateEntry::default()
                        },
                    )
                })
                .collect(),
        }
    }
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(default, deny_unknown_fields, rename_all = "camelCase")]
pub struct KernelAuthorityState {
    pub layout_version: u32,
    pub runtime_id: String,
    pub active_install_key: Option<String>,
    pub fallback_install_key: Option<String>,
    pub active_version_label: Option<String>,
    pub fallback_version_label: Option<String>,
    pub config_file_path: Option<String>,
    pub owned_runtime_roots: Vec<String>,
    pub quarantined_paths: Vec<String>,
    pub last_activation_at: Option<String>,
    pub last_error: Option<String>,
}

impl Default for KernelAuthorityState {
    fn default() -> Self {
        Self {
            layout_version: LAYOUT_VERSION,
            runtime_id: String::new(),
            active_install_key: None,
            fallback_install_key: None,
            active_version_label: None,
            fallback_version_label: None,
            config_file_path: None,
            owned_runtime_roots: Vec::new(),
            quarantined_paths: Vec::new(),
            last_activation_at: None,
            last_error: None,
        }
    }
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub struct KernelMigrationState {
    pub layout_version: u32,
    pub runtime_id: String,
    pub last_config_source_path: Option<String>,
    pub last_config_target_path: Option<String>,
    pub last_config_migrated_at: Option<String>,
    pub last_data_source_path: Option<String>,
    pub last_data_target_path: Option<String>,
    pub last_data_migrated_at: Option<String>,
    pub last_error: Option<String>,
}

impl Default for KernelMigrationState {
    fn default() -> Self {
        Self {
            layout_version: LAYOUT_VERSION,
            runtime_id: String::new(),
            last_config_source_path: None,
            last_config_target_path: None,
            last_config_migrated_at: None,
            last_data_source_path: None,
            last_data_target_path: None,
            last_data_migrated_at: None,
            last_error: None,
        }
    }
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub struct RuntimeUpgradeStateEntry {
    pub active_install_key: Option<String>,
    pub fallback_install_key: Option<String>,
    pub active_version_label: Option<String>,
    pub fallback_version_label: Option<String>,
    pub last_attempted_version: Option<String>,
    pub last_applied_version: Option<String>,
    pub last_attempted_at: Option<String>,
    pub last_error: Option<String>,
}

impl Default for RuntimeUpgradeStateEntry {
    fn default() -> Self {
        Self {
            active_install_key: None,
            fallback_install_key: None,
            active_version_label: None,
            fallback_version_label: None,
            last_attempted_version: None,
            last_applied_version: None,
            last_attempted_at: None,
            last_error: None,
        }
    }
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub struct RuntimeUpgradesState {
    pub layout_version: u32,
    pub runtimes: BTreeMap<String, RuntimeUpgradeStateEntry>,
}

impl Default for RuntimeUpgradesState {
    fn default() -> Self {
        Self {
            layout_version: LAYOUT_VERSION,
            runtimes: BTreeMap::new(),
        }
    }
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub struct RetentionBucket {
    pub active_slots: u32,
    pub fallback_slots: u32,
    pub historical_packages: u32,
}

impl Default for RetentionBucket {
    fn default() -> Self {
        Self {
            active_slots: 1,
            fallback_slots: 1,
            historical_packages: 0,
        }
    }
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub struct RetentionState {
    pub layout_version: u32,
    pub modules: RetentionBucket,
    pub runtimes: RetentionBucket,
}

impl Default for RetentionState {
    fn default() -> Self {
        Self {
            layout_version: LAYOUT_VERSION,
            modules: RetentionBucket {
                historical_packages: 3,
                ..RetentionBucket::default()
            },
            runtimes: RetentionBucket {
                historical_packages: 2,
                ..RetentionBucket::default()
            },
        }
    }
}

pub fn initialize_machine_state(paths: &AppPaths) -> Result<()> {
    write_json_if_missing(&paths.layout_file, &LayoutState::from_paths(paths))?;
    write_json_if_missing(&paths.active_file, &ActiveState::default())?;
    write_json_if_missing(&paths.inventory_file, &InventoryState::default())?;
    write_json_if_missing(&paths.retention_file, &RetentionState::default())?;
    write_json_if_missing(&paths.pinned_file, &PinnedState::default())?;
    write_json_if_missing(&paths.channels_file, &ChannelState::default())?;
    write_json_if_missing(&paths.policies_file, &PolicyState::default())?;
    write_json_if_missing(&paths.sources_file, &SourceState::default())?;
    write_json_if_missing(&paths.service_file, &ServiceState::default())?;
    write_json_if_missing(&paths.components_file, &ComponentsState::default())?;
    write_json_if_missing(&paths.upgrades_file, &UpgradesState::default())?;
    for runtime_id in crate::framework::paths::supported_kernel_ids() {
        let runtime_id = *runtime_id;
        let kernel = paths.kernel_paths(runtime_id)?;
        write_kernel_authority_json_if_missing(
            &kernel.authority_file,
            &KernelAuthorityState::default(),
        )?;
        write_json_if_missing(&kernel.migrations_file, &KernelMigrationState::default())?;
        write_json_if_missing(
            &kernel.runtime_upgrades_file,
            &RuntimeUpgradesState::default(),
        )?;
    }
    Ok(())
}

pub fn sync_component_registry_state(
    paths: &AppPaths,
    definitions: &[PackagedComponentDefinition],
) -> Result<()> {
    let mut components = read_json_file::<ComponentsState>(&paths.components_file)?;
    let mut upgrades = read_json_file::<UpgradesState>(&paths.upgrades_file)?;
    for definition in definitions {
        let enabled_by_default = definition.startup_mode == PackagedComponentStartupMode::AutoStart;
        components
            .entries
            .entry(definition.id.clone())
            .and_modify(|entry| {
                entry.display_name = definition.display_name.clone();
                entry.kind = component_kind_label(&definition.kind).to_string();
                entry.bundled_version = definition.bundled_version.clone();
                entry.startup_mode = startup_mode_label(&definition.startup_mode).to_string();
                entry.enabled_by_default = enabled_by_default;
            })
            .or_insert_with(|| ComponentStateEntry::from_definition(definition));

        upgrades
            .components
            .entry(definition.id.clone())
            .and_modify(|entry| {
                entry.channel = definition.upgrade_channel.clone();
            })
            .or_insert_with(|| UpgradeStateEntry {
                channel: definition.upgrade_channel.clone(),
                auto_upgrade_enabled: false,
                ..UpgradeStateEntry::default()
            });
    }

    write_json_file(&paths.components_file, &components)?;
    write_json_file(&paths.upgrades_file, &upgrades)?;
    Ok(())
}

#[cfg(test)]
pub fn set_active_runtime_version(paths: &AppPaths, runtime_id: &str, version: &str) -> Result<()> {
    let mut active = read_json_file::<ActiveState>(&paths.active_file)?;
    let previous_active = active
        .runtimes
        .get(runtime_id)
        .and_then(|entry| entry.active_runtime_install_key().map(str::to_string))
        .filter(|current| current != version);
    let entry = active.runtimes.entry(runtime_id.to_string()).or_default();

    if entry.active_runtime_install_key() != Some(version) {
        entry.set_runtime_state(
            Some(version.to_string()),
            previous_active.clone(),
            Some(version.to_string()),
            previous_active,
        );
    }

    write_json_file(&paths.active_file, &active)
}

fn component_kind_label(kind: &PackagedComponentKind) -> &'static str {
    match kind {
        PackagedComponentKind::Binary => "binary",
        PackagedComponentKind::NodeApp => "nodeApp",
        PackagedComponentKind::ServiceGroup => "serviceGroup",
        PackagedComponentKind::EmbeddedLibrary => "embeddedLibrary",
    }
}

fn startup_mode_label(mode: &PackagedComponentStartupMode) -> &'static str {
    match mode {
        PackagedComponentStartupMode::AutoStart => "autoStart",
        PackagedComponentStartupMode::Manual => "manual",
        PackagedComponentStartupMode::Embedded => "embedded",
    }
}

fn write_json_if_missing<T>(path: &Path, value: &T) -> Result<()>
where
    T: Serialize + DeserializeOwned,
{
    if path.exists() {
        let parsed = read_json_file::<T>(path)?;
        write_json_file(path, &parsed)?;
        return Ok(());
    }

    write_json_file(path, value)?;
    Ok(())
}

fn write_kernel_authority_json_if_missing(path: &Path, value: &KernelAuthorityState) -> Result<()> {
    if path.exists() {
        let parsed = read_kernel_authority_json_file(path)?;
        write_json_file(path, &parsed)?;
        return Ok(());
    }

    write_json_file(path, value)?;
    Ok(())
}

fn read_kernel_authority_json_file(path: &Path) -> Result<KernelAuthorityState> {
    let content = fs::read_to_string(path)?;
    match serde_json::from_str::<KernelAuthorityState>(&content) {
        Ok(state) => Ok(state),
        Err(error) => {
            let mut root = match serde_json::from_str::<serde_json::Value>(&content) {
                Ok(root) => root,
                Err(_) => return Err(error.into()),
            };
            let Some(object) = root.as_object_mut() else {
                return Err(error.into());
            };

            if object.remove("legacyRuntimeRoots").is_none() {
                return Err(error.into());
            }

            serde_json::from_value::<KernelAuthorityState>(root).map_err(Into::into)
        }
    }
}

fn read_json_file<T>(path: &Path) -> Result<T>
where
    T: DeserializeOwned,
{
    let content = fs::read_to_string(path)?;
    serde_json::from_str::<T>(&content).map_err(Into::into)
}

fn write_json_file<T>(path: &Path, value: &T) -> Result<()>
where
    T: Serialize,
{
    let content = serde_json::to_string_pretty(value)?;
    fs::write(path, content)?;
    Ok(())
}

#[cfg(test)] // WORKSPACE-PATH:allow-fixture-block: this module is the file's #[cfg(test)] unit-test fixture data
mod tests {
    use super::{
        initialize_machine_state, set_active_runtime_version, sync_component_registry_state,
        ActiveState, ActiveStateEntry, InventoryState, KernelAuthorityState, KernelMigrationState,
        LayoutState, PinnedState, RetentionState, RuntimeUpgradesState, UpgradesState,
    };
    use crate::framework::{
        components::{
            PackagedComponentDefinition, PackagedComponentKind, PackagedComponentStartupMode,
        },
        paths::resolve_paths_for_root,
    };
    use serde_json::Value;

    #[test]
    fn initializes_machine_state_files_with_expected_defaults() {
        let root = tempfile::tempdir().expect("temp dir");
        let paths = resolve_paths_for_root(root.path()).expect("paths");

        initialize_machine_state(&paths).expect("initialize machine state");

        let layout = serde_json::from_str::<LayoutState>(
            &std::fs::read_to_string(&paths.layout_file).expect("layout file"),
        )
        .expect("layout json");
        let active = serde_json::from_str::<ActiveState>(
            &std::fs::read_to_string(&paths.active_file).expect("active file"),
        )
        .expect("active json");
        let inventory = serde_json::from_str::<InventoryState>(
            &std::fs::read_to_string(&paths.inventory_file).expect("inventory file"),
        )
        .expect("inventory json");
        let retention = serde_json::from_str::<RetentionState>(
            &std::fs::read_to_string(&paths.retention_file).expect("retention file"),
        )
        .expect("retention json");
        let pinned = serde_json::from_str::<PinnedState>(
            &std::fs::read_to_string(&paths.pinned_file).expect("pinned file"),
        )
        .expect("pinned json");
        let channels = serde_json::from_str::<Value>(
            &std::fs::read_to_string(&paths.channels_file).expect("channels file"),
        )
        .expect("channels json");
        let policies = serde_json::from_str::<Value>(
            &std::fs::read_to_string(&paths.policies_file).expect("policies file"),
        )
        .expect("policies json");
        let sources = serde_json::from_str::<Value>(
            &std::fs::read_to_string(&paths.sources_file).expect("sources file"),
        )
        .expect("sources json");
        let service = serde_json::from_str::<Value>(
            &std::fs::read_to_string(&paths.service_file).expect("service file"),
        )
        .expect("service json");
        let components = serde_json::from_str::<Value>(
            &std::fs::read_to_string(&paths.components_file).expect("components file"),
        )
        .expect("components json");
        let upgrades = serde_json::from_str::<UpgradesState>(
            &std::fs::read_to_string(&paths.upgrades_file).expect("upgrades file"),
        )
        .expect("upgrades json");
        let hermes = paths.kernel_paths("hermes").expect("hermes kernel paths");
        assert_eq!(layout.layout_version, 1);
        assert!(layout.install_root.replace('\\', "/").ends_with("install"));
        assert!(layout.machine_root.replace('\\', "/").ends_with("machine"));
        assert!(layout
            .user_root
            .replace('\\', "/")
            .ends_with("app-user-root"));
        assert!(active.modules.is_empty());
        assert!(active.runtimes.is_empty());
        assert!(inventory.module_packages.is_empty());
        assert!(inventory.runtime_packages.is_empty());
        assert_eq!(retention.modules.historical_packages, 3);
        assert_eq!(retention.runtimes.historical_packages, 2);
        assert!(pinned.modules.is_empty());
        assert!(pinned.runtimes.is_empty());
        assert!(hermes.authority_file.exists());
        assert!(hermes.migrations_file.exists());
        assert!(hermes.runtime_upgrades_file.exists());
        assert_eq!(
            channels.get("layoutVersion").and_then(Value::as_u64),
            Some(1)
        );
        assert_eq!(
            channels
                .pointer("/modules")
                .and_then(Value::as_object)
                .map(|value| value.len()),
            Some(0)
        );
        assert_eq!(
            channels
                .pointer("/runtimes")
                .and_then(Value::as_object)
                .map(|value| value.len()),
            Some(0)
        );
        assert_eq!(
            policies.get("layoutVersion").and_then(Value::as_u64),
            Some(1)
        );
        assert_eq!(
            policies
                .get("allowModuleHotUpdate")
                .and_then(Value::as_bool),
            Some(true)
        );
        assert_eq!(
            policies
                .get("allowRuntimeHotUpdate")
                .and_then(Value::as_bool),
            Some(true)
        );
        assert_eq!(
            sources.get("layoutVersion").and_then(Value::as_u64),
            Some(1)
        );
        assert_eq!(
            sources
                .pointer("/modules")
                .and_then(Value::as_object)
                .map(|value| value.len()),
            Some(0)
        );
        assert_eq!(
            sources
                .pointer("/runtimes")
                .and_then(Value::as_object)
                .map(|value| value.len()),
            Some(0)
        );
        assert_eq!(
            service.get("layoutVersion").and_then(Value::as_u64),
            Some(1)
        );
        assert_eq!(
            service.get("serviceEnabled").and_then(Value::as_bool),
            Some(true)
        );
        assert_eq!(
            service.get("maintenanceMode").and_then(Value::as_bool),
            Some(false)
        );
        assert_eq!(
            components
                .get("entries")
                .and_then(Value::as_object)
                .map(|value| value.len()),
            Some(0)
        );
        assert!(upgrades.components.is_empty());
    }

    #[test]
    fn initializes_openclaw_authority_state_files_with_expected_defaults() {
        let root = tempfile::tempdir().expect("temp dir");
        let paths = resolve_paths_for_root(root.path()).expect("paths");
        let openclaw = paths
            .kernel_paths("openclaw")
            .expect("openclaw kernel paths");

        initialize_machine_state(&paths).expect("initialize machine state");

        let authority = serde_json::from_str::<KernelAuthorityState>(
            &std::fs::read_to_string(&openclaw.authority_file).expect("authority file"),
        )
        .expect("authority json");
        let migrations = serde_json::from_str::<KernelMigrationState>(
            &std::fs::read_to_string(&openclaw.migrations_file).expect("migrations file"),
        )
        .expect("migrations json");
        let runtime_upgrades = serde_json::from_str::<RuntimeUpgradesState>(
            &std::fs::read_to_string(&openclaw.runtime_upgrades_file)
                .expect("runtime upgrades file"),
        )
        .expect("runtime upgrades json");

        assert_eq!(authority.layout_version, 1);
        assert_eq!(authority.runtime_id, "");
        assert!(authority.active_install_key.is_none());
        assert!(authority.active_version_label.is_none());
        assert!(authority.config_file_path.is_none());
        assert!(authority.owned_runtime_roots.is_empty());

        let authority_json = serde_json::from_str::<Value>(
            &std::fs::read_to_string(&openclaw.authority_file).expect("authority file"),
        )
        .expect("authority json value");
        assert!(authority_json.get("configFilePath").is_some());

        assert_eq!(migrations.layout_version, 1);
        assert_eq!(migrations.runtime_id, "");
        assert!(migrations.last_config_source_path.is_none());
        assert!(migrations.last_data_source_path.is_none());
        assert!(migrations.last_error.is_none());

        assert!(runtime_upgrades.runtimes.is_empty());
    }

    #[test]
    fn initialize_machine_state_removes_retired_legacy_runtime_roots_from_existing_authority_state()
    {
        let root = tempfile::tempdir().expect("temp dir");
        let paths = resolve_paths_for_root(root.path()).expect("paths");
        let openclaw = paths
            .kernel_paths("openclaw")
            .expect("openclaw kernel paths");
        std::fs::create_dir_all(openclaw.authority_file.parent().expect("authority parent"))
            .expect("create authority parent");
        std::fs::write(
            &openclaw.authority_file,
            r#"{
  "layoutVersion": 1,
  "runtimeId": "openclaw",
  "activeInstallKey": "openclaw-nightly-windows-x64",
  "fallbackInstallKey": null,
  "activeVersionLabel": "2026.4.28",
  "fallbackVersionLabel": null,
  "configFilePath": null,
  "ownedRuntimeRoots": ["D:/managed/openclaw"],
  "legacyRuntimeRoots": ["D:/legacy/openclaw"],
  "quarantinedPaths": [],
  "lastActivationAt": null,
  "lastError": null
}"#,
        )
        .expect("write legacy authority");

        initialize_machine_state(&paths).expect("initialize machine state");

        let authority_json = serde_json::from_str::<Value>(
            &std::fs::read_to_string(&openclaw.authority_file).expect("authority file"),
        )
        .expect("authority json value");
        let authority = serde_json::from_value::<KernelAuthorityState>(authority_json.clone())
            .expect("canonical authority state");

        assert_eq!(
            authority.active_install_key.as_deref(),
            Some("openclaw-nightly-windows-x64")
        );
        assert_eq!(authority.owned_runtime_roots, vec!["D:/managed/openclaw"]);
        assert_eq!(authority_json.get("legacyRuntimeRoots"), None);
    }

    #[test]
    fn kernel_authority_state_rejects_retired_legacy_runtime_roots_field() {
        let error = serde_json::from_str::<KernelAuthorityState>(
            r#"{
  "layoutVersion": 1,
  "runtimeId": "openclaw",
  "activeInstallKey": null,
  "fallbackInstallKey": null,
  "activeVersionLabel": null,
  "fallbackVersionLabel": null,
  "configFilePath": null,
  "ownedRuntimeRoots": [],
  "legacyRuntimeRoots": [],
  "quarantinedPaths": [],
  "lastActivationAt": null,
  "lastError": null
}"#,
        )
        .expect_err("retired legacyRuntimeRoots authority field must be rejected");

        assert!(
            error.to_string().contains("legacyRuntimeRoots"),
            "unexpected authority parse error: {error}"
        );
    }

    #[test]
    fn sync_component_registry_state_backfills_bundle_defined_components_into_machine_state() {
        let root = tempfile::tempdir().expect("temp dir");
        let paths = resolve_paths_for_root(root.path()).expect("paths");

        initialize_machine_state(&paths).expect("initialize machine state");
        sync_component_registry_state(
            &paths,
            &[PackagedComponentDefinition {
                id: "codex".to_string(),
                display_name: "Codex".to_string(),
                kind: PackagedComponentKind::Binary,
                bundled_version: "1.2.3".to_string(),
                startup_mode: PackagedComponentStartupMode::AutoStart,
                install_subdir: "modules/codex/current".to_string(),
                upgrade_channel: "stable".to_string(),
                service_ids: vec!["codex".to_string()],
                source_url: None,
                commit: None,
            }],
        )
        .expect("sync codex definitions");

        let components = serde_json::from_str::<Value>(
            &std::fs::read_to_string(&paths.components_file).expect("components file"),
        )
        .expect("components json");
        let upgrades = serde_json::from_str::<UpgradesState>(
            &std::fs::read_to_string(&paths.upgrades_file).expect("upgrades file"),
        )
        .expect("upgrades json");

        assert_eq!(
            components
                .pointer("/entries/codex/displayName")
                .and_then(Value::as_str),
            Some("Codex")
        );
        assert_eq!(
            components
                .pointer("/entries/codex/enabledByDefault")
                .and_then(Value::as_bool),
            Some(true)
        );
        assert!(upgrades.components.contains_key("codex"));
    }

    #[test]
    fn tracks_active_runtime_install_keys_without_version_aliases() {
        let root = tempfile::tempdir().expect("temp dir");
        let paths = resolve_paths_for_root(root.path()).expect("paths");

        set_active_runtime_version(&paths, "openclaw", "2026.3.20-windows-x64")
            .expect("first runtime activation");
        set_active_runtime_version(&paths, "openclaw", "2026.3.23-2-windows-x64")
            .expect("second runtime activation");

        let active = serde_json::from_str::<ActiveState>(
            &std::fs::read_to_string(&paths.active_file).expect("active file"),
        )
        .expect("active json");
        let openclaw = active
            .runtimes
            .get("openclaw")
            .expect("openclaw active runtime");

        assert!(openclaw.active_version.is_none());
        assert!(openclaw.fallback_version.is_none());
        assert_eq!(
            openclaw.active_install_key.as_deref(),
            Some("2026.3.23-2-windows-x64")
        );
        assert_eq!(
            openclaw.fallback_install_key.as_deref(),
            Some("2026.3.20-windows-x64")
        );
        assert_eq!(
            openclaw.active_version_label.as_deref(),
            Some("2026.3.23-2-windows-x64")
        );
        assert_eq!(
            openclaw.fallback_version_label.as_deref(),
            Some("2026.3.20-windows-x64")
        );
    }

    #[test]
    fn runtime_install_key_helpers_ignore_retired_version_alias_fields() {
        let entry = ActiveStateEntry {
            active_version: Some("retired-active-version-alias".to_string()),
            fallback_version: Some("retired-fallback-version-alias".to_string()),
            active_install_key: None,
            fallback_install_key: None,
            active_version_label: None,
            fallback_version_label: None,
        };

        assert_eq!(entry.active_runtime_install_key(), None);
        assert_eq!(entry.fallback_runtime_install_key(), None);
        assert_eq!(entry.active_runtime_version_label(), None);
        assert_eq!(entry.fallback_runtime_version_label(), None);
    }
}
