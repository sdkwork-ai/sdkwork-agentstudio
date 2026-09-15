use super::{storage::StorageService, supervisor::SupervisorService};
use crate::framework::{
    config::{
        AppConfig, HOST_PLATFORM_DESIRED_STATE_PROJECTION_VERSION,
        HOST_PLATFORM_ROLLOUT_ENGINE_VERSION,
    },
    embedded_host_server::{EmbeddedHostRuntimeSnapshot, EmbeddedHostRuntimeStatus},
    install_records::{
        resolve_openclaw_install_records_home_candidates, InstallRecord, InstallRecordStatus,
        OPENCLAW_INSTALL_RECORDS_HOME_NAME,
    },
    layout::{ActiveState, KernelAuthorityState},
    openclaw_release::bundled_openclaw_version,
    paths::AppPaths,
    services::{
        kernel_runtime_authority::KernelRuntimeAuthorityService,
        openclaw_channel_config::{
            bundled_openclaw_channel_id_set, sanitize_openclaw_channel_config,
        },
        openclaw_runtime::{collect_openclaw_runtime_channel_ids, load_manifest, DEFAULT_GATEWAY_PORT},
        supervisor::{ManagedServiceLifecycle, SERVICE_ID_OPENCLAW_GATEWAY},
    },
    storage::{
        StorageDeleteRequest, StorageGetTextRequest, StorageListKeysRequest, StorageProviderKind,
        StoragePutTextRequest,
    },
    FrameworkError, Result,
};
use sdkwork_agentstudio_host_core::{
    host_core_metadata,
    host_endpoints::{
        project_openclaw_gateway, project_openclaw_runtime, HostEndpointRecord,
        OpenClawGatewayProjection, OpenClawLifecycle, OpenClawRuntimeProjection,
    },
    openclaw_control_plane::OpenClawGatewayInvokeRequest,
    projection::compiler::{DesiredStateInput, ProjectionCompiler},
    rollout::engine::{preflight_target, PreflightOutcome, RolloutPolicy, RolloutPreflightTarget},
};
use sdkwork_agentstudio_server::bootstrap::{
    host_platform_capability_keys_for_mode, ServerStateStoreProfileRecord,
    ServerStateStoreProviderRecord, ServerStateStoreSnapshot,
};
use sdkwork_local_api_proxy_native::kernel::{
    build_standard_hermes_config_file_path, build_standard_hermes_root_dir,
};
use serde::{de::Error as SerdeDeError, Deserialize, Deserializer, Serialize, Serializer};
use serde_json::{Map, Number, Value};
use std::{
    collections::{BTreeMap, BTreeSet},
    fs,
    path::{Path, PathBuf},
    time::{SystemTime, UNIX_EPOCH},
};

mod hermes_chat;
mod kernel_chat;
mod kernel_chat_service;
mod openclaw_chat;
mod openclaw_control;
mod openclaw_workbench;

use hermes_chat::create_kernel_chat_agent_profile_for_managed_hermes;
pub use kernel_chat::{
    KernelChatAgentProfile, KernelChatAttachment, KernelChatMessage, KernelChatRun,
    KernelChatSession, PersistedKernelChatAgentRecord, StudioCreateKernelChatSessionInput,
    StudioPatchKernelChatSessionInput, StudioStartKernelChatRunInput,
};
use openclaw_control::{
    clone_openclaw_task, create_openclaw_task, delete_openclaw_task, invoke_openclaw_gateway,
    list_openclaw_task_executions, require_running_openclaw_runtime, run_openclaw_task_now,
    update_openclaw_task, update_openclaw_task_status,
};
use openclaw_workbench::build_openclaw_workbench_snapshot;

const INSTANCE_NAMESPACE: &str = "studio.instances";
const INSTANCE_REGISTRY_KEY: &str = "registry";
const CHAT_NAMESPACE: &str = "studio.chat";
const CONVERSATION_KEY_PREFIX: &str = "conversation:";
const PERSISTED_KERNEL_CHAT_AGENT_KEY_PREFIX: &str = "kernel-agent:";
const CHAT_STORAGE_PROFILE_ID: &str = "default-sqlite";
const DEFAULT_INSTANCE_ID: &str = "managed-openclaw-primary";
const OPENCLAW_INSTALLER_SOFTWARE_NAME: &str = "openclaw";
const OPENCLAW_PROVIDER_RUNTIME_DEFAULT_TEMPERATURE: f64 = 0.2;
const OPENCLAW_PROVIDER_RUNTIME_DEFAULT_TOP_P: f64 = 1.0;
const OPENCLAW_PROVIDER_RUNTIME_DEFAULT_MAX_TOKENS: u32 = 8192;
const OPENCLAW_PROVIDER_RUNTIME_DEFAULT_TIMEOUT_MS: u32 = 60_000;

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum StudioRuntimeKind {
    Openclaw,
    Hermes,
    Zeroclaw,
    Ironclaw,
    Custom,
    Other(String),
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum StudioInstanceDeploymentMode {
    LocalManaged,
    LocalExternal,
    Remote,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum StudioInstanceTransportKind {
    OpenclawGatewayWs,
    ZeroclawHttp,
    IronclawWeb,
    OpenaiHttp,
    CustomHttp,
    CustomWs,
    Other(String),
}

impl StudioRuntimeKind {
    fn from_serialized(value: &str) -> Self {
        match value.trim() {
            "openclaw" => Self::Openclaw,
            "hermes" => Self::Hermes,
            "zeroclaw" => Self::Zeroclaw,
            "ironclaw" => Self::Ironclaw,
            "custom" => Self::Custom,
            other => Self::Other(other.to_string()),
        }
    }

    fn as_serialized(&self) -> &str {
        match self {
            Self::Openclaw => "openclaw",
            Self::Hermes => "hermes",
            Self::Zeroclaw => "zeroclaw",
            Self::Ironclaw => "ironclaw",
            Self::Custom => "custom",
            Self::Other(value) => value.as_str(),
        }
    }
}

impl Serialize for StudioRuntimeKind {
    fn serialize<S>(&self, serializer: S) -> std::result::Result<S::Ok, S::Error>
    where
        S: Serializer,
    {
        serializer.serialize_str(self.as_serialized())
    }
}

impl<'de> Deserialize<'de> for StudioRuntimeKind {
    fn deserialize<D>(deserializer: D) -> std::result::Result<Self, D::Error>
    where
        D: Deserializer<'de>,
    {
        let value = String::deserialize(deserializer)?;
        let normalized = value.trim();
        if normalized.is_empty() {
            return Err(<D::Error as SerdeDeError>::custom(
                "studio runtime kind cannot be blank",
            ));
        }

        Ok(Self::from_serialized(normalized))
    }
}

impl StudioInstanceTransportKind {
    fn from_serialized(value: &str) -> Self {
        match value.trim() {
            "openclawGatewayWs" => Self::OpenclawGatewayWs,
            "zeroclawHttp" => Self::ZeroclawHttp,
            "ironclawWeb" => Self::IronclawWeb,
            "openaiHttp" => Self::OpenaiHttp,
            "customHttp" => Self::CustomHttp,
            "customWs" => Self::CustomWs,
            other => Self::Other(other.to_string()),
        }
    }

    fn as_serialized(&self) -> &str {
        match self {
            Self::OpenclawGatewayWs => "openclawGatewayWs",
            Self::ZeroclawHttp => "zeroclawHttp",
            Self::IronclawWeb => "ironclawWeb",
            Self::OpenaiHttp => "openaiHttp",
            Self::CustomHttp => "customHttp",
            Self::CustomWs => "customWs",
            Self::Other(value) => value.as_str(),
        }
    }
}

impl Serialize for StudioInstanceTransportKind {
    fn serialize<S>(&self, serializer: S) -> std::result::Result<S::Ok, S::Error>
    where
        S: Serializer,
    {
        serializer.serialize_str(self.as_serialized())
    }
}

impl<'de> Deserialize<'de> for StudioInstanceTransportKind {
    fn deserialize<D>(deserializer: D) -> std::result::Result<Self, D::Error>
    where
        D: Deserializer<'de>,
    {
        let value = String::deserialize(deserializer)?;
        let normalized = value.trim();
        if normalized.is_empty() {
            return Err(<D::Error as SerdeDeError>::custom(
                "studio instance transport kind cannot be blank",
            ));
        }

        Ok(Self::from_serialized(normalized))
    }
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum StudioInstanceStatus {
    Online,
    Offline,
    Starting,
    Error,
    Syncing,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum StudioInstanceCapability {
    Chat,
    Health,
    Files,
    Memory,
    Tasks,
    Tools,
    Models,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum StudioInstanceIconType {
    Apple,
    Box,
    Server,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StudioStorageBinding {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub profile_id: Option<String>,
    pub provider: StorageProviderKind,
    pub namespace: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub database: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub connection_hint: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub endpoint: Option<String>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub struct StudioInstanceConfig {
    pub port: String,
    pub sandbox: bool,
    pub auto_update: bool,
    pub log_level: String,
    pub cors_origins: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub workspace_path: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub base_url: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub websocket_url: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub auth_token: Option<String>,
}

impl Default for StudioInstanceConfig {
    fn default() -> Self {
        let base_url = format!("http://127.0.0.1:{DEFAULT_GATEWAY_PORT}");
        let websocket_url = format!("ws://127.0.0.1:{DEFAULT_GATEWAY_PORT}");

        Self {
            port: DEFAULT_GATEWAY_PORT.to_string(),
            sandbox: true,
            auto_update: true,
            log_level: "info".to_string(),
            cors_origins: "*".to_string(),
            workspace_path: None,
            base_url: Some(base_url),
            websocket_url: Some(websocket_url),
            auth_token: None,
        }
    }
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StudioInstanceRecord {
    pub id: String,
    pub name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    pub runtime_kind: StudioRuntimeKind,
    pub deployment_mode: StudioInstanceDeploymentMode,
    pub transport_kind: StudioInstanceTransportKind,
    pub status: StudioInstanceStatus,
    pub is_built_in: bool,
    pub is_default: bool,
    pub icon_type: StudioInstanceIconType,
    pub version: String,
    pub type_label: String,
    pub host: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub port: Option<u16>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub base_url: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub websocket_url: Option<String>,
    pub cpu: u32,
    pub memory: u32,
    pub total_memory: String,
    pub uptime: String,
    pub capabilities: Vec<StudioInstanceCapability>,
    pub storage: StudioStorageBinding,
    pub config: StudioInstanceConfig,
    pub created_at: u64,
    pub updated_at: u64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub last_seen_at: Option<u64>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum StudioConversationRole {
    User,
    Assistant,
    System,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum StudioConversationMessageStatus {
    Complete,
    Streaming,
    Error,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StudioConversationMessage {
    pub id: String,
    pub conversation_id: String,
    pub role: StudioConversationRole,
    pub content: String,
    pub created_at: u64,
    pub updated_at: u64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub model: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub sender_instance_id: Option<String>,
    pub status: StudioConversationMessageStatus,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub attachments: Vec<KernelChatAttachment>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub kernel_message: Option<KernelChatMessage>,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StudioConversationRecord {
    pub id: String,
    pub title: String,
    pub primary_instance_id: String,
    pub participant_instance_ids: Vec<String>,
    pub created_at: u64,
    pub updated_at: u64,
    pub message_count: u64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub last_message_preview: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub last_seen_at: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub kernel_session: Option<KernelChatSession>,
    pub messages: Vec<StudioConversationMessage>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum StudioInstanceHealthStatus {
    Healthy,
    Attention,
    Degraded,
    Offline,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum StudioInstanceCapabilityStatus {
    Ready,
    Degraded,
    ConfigurationRequired,
    Unsupported,
    Planned,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum StudioInstanceLifecycleOwner {
    AppManaged,
    ExternalProcess,
    RemoteService,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum StudioInstanceActivationStage {
    ResolveRequirements,
    PrepareInstall,
    ValidateInstall,
    ActivateInstall,
    PrepareConfig,
    StartProcess,
    VerifyEndpoint,
    ProjectInstance,
    Ready,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum StudioInstanceAuthMode {
    Token,
    None,
    External,
    Unknown,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum StudioInstanceEndpointKind {
    Http,
    Websocket,
    OpenaiChatCompletions,
    OpenaiResponses,
    Dashboard,
    Sse,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum StudioInstanceEndpointStatus {
    Ready,
    ConfigurationRequired,
    Unavailable,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum StudioInstanceExposure {
    Loopback,
    Private,
    Remote,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum StudioInstanceStorageStatus {
    Ready,
    ConfigurationRequired,
    Planned,
    Unavailable,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum StudioInstanceObservabilityStatus {
    Ready,
    Limited,
    Unavailable,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum StudioInstanceCapabilitySource {
    Runtime,
    Config,
    Storage,
    Integration,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum StudioInstanceEndpointSource {
    Config,
    Derived,
    Runtime,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum StudioInstanceMetricsSource {
    Runtime,
    Derived,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum StudioInstanceDataAccessScope {
    Config,
    Logs,
    Files,
    Memory,
    Tasks,
    Tools,
    Models,
    Connectivity,
    Storage,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum StudioInstanceDataAccessMode {
    ManagedFile,
    ManagedDirectory,
    StorageBinding,
    RemoteEndpoint,
    MetadataOnly,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum StudioInstanceDataAccessStatus {
    Ready,
    Limited,
    ConfigurationRequired,
    Planned,
    Unavailable,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum StudioInstanceArtifactKind {
    ConfigFile,
    LogFile,
    WorkspaceDirectory,
    RuntimeDirectory,
    Endpoint,
    StorageBinding,
    Dashboard,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum StudioInstanceArtifactStatus {
    Available,
    Configured,
    Missing,
    Remote,
    Planned,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum StudioInstanceDetailSource {
    Runtime,
    Config,
    Storage,
    Integration,
    Derived,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StudioInstanceHealthCheck {
    pub id: String,
    pub label: String,
    pub status: StudioInstanceHealthStatus,
    pub detail: String,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StudioInstanceHealthSnapshot {
    pub score: u8,
    pub status: StudioInstanceHealthStatus,
    pub checks: Vec<StudioInstanceHealthCheck>,
    pub evaluated_at: u64,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StudioInstanceLifecycleSnapshot {
    pub owner: StudioInstanceLifecycleOwner,
    pub start_stop_supported: bool,
    pub config_writable: bool,
    #[serde(default)]
    pub lifecycle_controllable: bool,
    #[serde(default)]
    pub workbench_managed: bool,
    #[serde(default)]
    pub endpoint_observed: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub last_activation_stage: Option<StudioInstanceActivationStage>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub last_error: Option<String>,
    pub notes: Vec<String>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StudioInstanceConnectivityEndpoint {
    pub id: String,
    pub label: String,
    pub kind: StudioInstanceEndpointKind,
    pub status: StudioInstanceEndpointStatus,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub url: Option<String>,
    pub exposure: StudioInstanceExposure,
    pub auth: StudioInstanceAuthMode,
    pub source: StudioInstanceEndpointSource,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StudioInstanceConnectivitySnapshot {
    pub primary_transport: StudioInstanceTransportKind,
    pub endpoints: Vec<StudioInstanceConnectivityEndpoint>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StudioInstanceStorageSnapshot {
    pub status: StudioInstanceStorageStatus,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub profile_id: Option<String>,
    pub provider: StorageProviderKind,
    pub namespace: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub database: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub connection_hint: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub endpoint: Option<String>,
    pub durable: bool,
    pub queryable: bool,
    pub transactional: bool,
    pub remote: bool,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StudioInstanceCapabilitySnapshot {
    pub id: StudioInstanceCapability,
    pub status: StudioInstanceCapabilityStatus,
    pub detail: String,
    pub source: StudioInstanceCapabilitySource,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StudioInstanceObservabilitySnapshot {
    pub status: StudioInstanceObservabilityStatus,
    pub log_available: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub log_file_path: Option<String>,
    pub log_preview: Vec<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub last_seen_at: Option<u64>,
    pub metrics_source: StudioInstanceMetricsSource,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StudioInstanceDataAccessEntry {
    pub id: String,
    pub label: String,
    pub scope: StudioInstanceDataAccessScope,
    pub mode: StudioInstanceDataAccessMode,
    pub status: StudioInstanceDataAccessStatus,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub target: Option<String>,
    pub readonly: bool,
    pub authoritative: bool,
    pub detail: String,
    pub source: StudioInstanceDetailSource,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StudioInstanceDataAccessSnapshot {
    pub routes: Vec<StudioInstanceDataAccessEntry>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StudioInstanceArtifactRecord {
    pub id: String,
    pub label: String,
    pub kind: StudioInstanceArtifactKind,
    pub status: StudioInstanceArtifactStatus,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub location: Option<String>,
    pub readonly: bool,
    pub detail: String,
    pub source: StudioInstanceDetailSource,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StudioInstanceRuntimeNote {
    pub title: String,
    pub content: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub source_url: Option<String>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum StudioInstanceConsoleKind {
    OpenclawControlUi,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum StudioInstanceConsoleAuthMode {
    Token,
    Password,
    None,
    External,
    Unknown,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum StudioInstanceConsoleAuthSource {
    ConfigFile,
    InstallRecord,
    WorkspaceConfig,
    SecretRef,
    Unresolved,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum StudioInstanceConsoleInstallMethod {
    Bundled,
    InstallerScript,
    CliScript,
    Npm,
    Pnpm,
    Source,
    Git,
    Wsl,
    Docker,
    Podman,
    Ansible,
    Bun,
    Nix,
    Unknown,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StudioInstanceConsoleAccessRecord {
    pub kind: StudioInstanceConsoleKind,
    pub available: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub url: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub auto_login_url: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub gateway_url: Option<String>,
    pub auth_mode: StudioInstanceConsoleAuthMode,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub auth_source: Option<StudioInstanceConsoleAuthSource>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub install_method: Option<StudioInstanceConsoleInstallMethod>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub reason: Option<String>,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StudioWorkbenchChannelRecord {
    pub id: String,
    pub name: String,
    pub description: String,
    pub status: String,
    pub enabled: bool,
    pub field_count: u32,
    pub configured_field_count: u32,
    pub setup_steps: Vec<String>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StudioWorkbenchTaskScheduleConfig {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub interval_value: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub interval_unit: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub scheduled_date: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub scheduled_time: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub cron_expression: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub cron_timezone: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub stagger_ms: Option<u64>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StudioWorkbenchTaskExecutionRecord {
    pub id: String,
    pub task_id: String,
    pub status: String,
    pub trigger: String,
    pub started_at: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub finished_at: Option<String>,
    pub summary: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub details: Option<String>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StudioWorkbenchTaskRecord {
    pub id: String,
    pub name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    pub prompt: String,
    pub schedule: String,
    pub schedule_mode: String,
    pub schedule_config: StudioWorkbenchTaskScheduleConfig,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub cron_expression: Option<String>,
    pub action_type: String,
    pub status: String,
    pub session_mode: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub custom_session_id: Option<String>,
    pub wake_up_mode: String,
    pub execution_content: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub timeout_seconds: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub delete_after_run: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub agent_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub model: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub thinking: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub light_context: Option<bool>,
    pub delivery_mode: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub delivery_best_effort: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub delivery_channel: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub delivery_label: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub recipient: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub last_run: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub next_run: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub latest_execution: Option<StudioWorkbenchTaskExecutionRecord>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub raw_definition: Option<Value>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StudioWorkbenchCronTasksSnapshot {
    pub tasks: Vec<StudioWorkbenchTaskRecord>,
    pub task_executions_by_id: BTreeMap<String, Vec<StudioWorkbenchTaskExecutionRecord>>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StudioWorkbenchLLMProviderModelRecord {
    pub id: String,
    pub name: String,
    pub role: String,
    pub context_window: String,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StudioWorkbenchLLMProviderConfigRecord {
    pub temperature: f64,
    pub top_p: f64,
    pub max_tokens: u32,
    pub timeout_ms: u32,
    pub streaming: bool,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StudioWorkbenchLLMProviderRecord {
    pub id: String,
    pub name: String,
    pub provider: String,
    pub endpoint: String,
    pub api_key_source: String,
    pub status: String,
    pub default_model_id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub reasoning_model_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub embedding_model_id: Option<String>,
    pub description: String,
    pub icon: String,
    pub last_checked_at: String,
    pub capabilities: Vec<String>,
    pub models: Vec<StudioWorkbenchLLMProviderModelRecord>,
    pub config: StudioWorkbenchLLMProviderConfigRecord,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StudioWorkbenchAgentProfile {
    pub id: String,
    pub name: String,
    pub description: String,
    pub avatar: String,
    pub system_prompt: String,
    pub creator: String,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StudioWorkbenchAgentRecord {
    pub agent: StudioWorkbenchAgentProfile,
    pub focus_areas: Vec<String>,
    pub automation_fit_score: u8,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StudioWorkbenchSkillRecord {
    pub id: String,
    pub name: String,
    pub description: String,
    pub author: String,
    pub rating: f64,
    pub downloads: u64,
    pub category: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub icon: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub version: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub size: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub updated_at: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub readme: Option<String>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StudioWorkbenchFileRecord {
    pub id: String,
    pub name: String,
    pub path: String,
    pub category: String,
    pub language: String,
    pub size: String,
    pub updated_at: String,
    pub status: String,
    pub description: String,
    pub content: String,
    pub is_readonly: bool,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StudioWorkbenchMemoryEntryRecord {
    pub id: String,
    pub title: String,
    pub r#type: String,
    pub summary: String,
    pub source: String,
    pub updated_at: String,
    pub retention: String,
    pub tokens: u32,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StudioWorkbenchToolRecord {
    pub id: String,
    pub name: String,
    pub description: String,
    pub category: String,
    pub status: String,
    pub access: String,
    pub command: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub last_used_at: Option<String>,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StudioWorkbenchSnapshot {
    pub channels: Vec<StudioWorkbenchChannelRecord>,
    pub cron_tasks: StudioWorkbenchCronTasksSnapshot,
    pub llm_providers: Vec<StudioWorkbenchLLMProviderRecord>,
    pub agents: Vec<StudioWorkbenchAgentRecord>,
    pub skills: Vec<StudioWorkbenchSkillRecord>,
    pub files: Vec<StudioWorkbenchFileRecord>,
    pub memory: Vec<StudioWorkbenchMemoryEntryRecord>,
    pub tools: Vec<StudioWorkbenchToolRecord>,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StudioInstanceDetailRecord {
    pub instance: StudioInstanceRecord,
    pub config: StudioInstanceConfig,
    pub logs: String,
    pub health: StudioInstanceHealthSnapshot,
    pub lifecycle: StudioInstanceLifecycleSnapshot,
    pub storage: StudioInstanceStorageSnapshot,
    pub connectivity: StudioInstanceConnectivitySnapshot,
    pub observability: StudioInstanceObservabilitySnapshot,
    pub data_access: StudioInstanceDataAccessSnapshot,
    pub artifacts: Vec<StudioInstanceArtifactRecord>,
    pub capabilities: Vec<StudioInstanceCapabilitySnapshot>,
    pub official_runtime_notes: Vec<StudioInstanceRuntimeNote>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub console_access: Option<StudioInstanceConsoleAccessRecord>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub workbench: Option<StudioWorkbenchSnapshot>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StudioCreateInstanceInput {
    pub name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    pub runtime_kind: StudioRuntimeKind,
    pub deployment_mode: StudioInstanceDeploymentMode,
    pub transport_kind: StudioInstanceTransportKind,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub icon_type: Option<StudioInstanceIconType>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub version: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub type_label: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub host: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub port: Option<u16>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub base_url: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub websocket_url: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub storage: Option<PartialStudioStorageBinding>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub config: Option<PartialStudioInstanceConfig>,
}

#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub struct StudioUpdateInstanceInput {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub icon_type: Option<StudioInstanceIconType>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub version: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub type_label: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub host: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub port: Option<u16>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub base_url: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub websocket_url: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub status: Option<StudioInstanceStatus>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub is_default: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub config: Option<PartialStudioInstanceConfig>,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StudioUpdateInstanceLlmProviderConfigInput {
    pub endpoint: String,
    pub api_key_source: String,
    pub default_model_id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub reasoning_model_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub embedding_model_id: Option<String>,
    pub config: StudioWorkbenchLLMProviderConfigRecord,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StudioOpenClawGatewayInvokeRequest {
    pub tool: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub action: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub args: Option<Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub session_key: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub dry_run: Option<bool>,
}

#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub struct StudioOpenClawGatewayInvokeOptions {
    pub message_channel: Option<String>,
    pub account_id: Option<String>,
    pub headers: BTreeMap<String, String>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum StudioKernelAgentCreationReasonCode {
    UnsupportedKernel,
    ConfigUnavailable,
    ConfigNotWritable,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StudioKernelAgentCreationFieldSupport {
    pub avatar: bool,
    pub is_default: bool,
    pub primary_model: bool,
    pub fallback_models: bool,
    pub workspace: bool,
    pub agent_dir: bool,
    pub temperature: bool,
    pub top_p: bool,
    pub max_tokens: bool,
    pub timeout_ms: bool,
    pub streaming: bool,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StudioKernelAgentCreationKernelOption {
    pub kernel_id: String,
    pub label: String,
    pub supported: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub reason_code: Option<StudioKernelAgentCreationReasonCode>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub reason: Option<String>,
    #[serde(default)]
    pub model_options: Vec<StudioKernelAgentCreationModelOption>,
    pub field_support: StudioKernelAgentCreationFieldSupport,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StudioKernelAgentCreationModelOption {
    pub value: String,
    pub label: String,
    pub provider_id: String,
    pub provider_label: String,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StudioKernelAgentCreationCapability {
    pub instance_id: String,
    pub instance_name: String,
    pub kernel_options: Vec<StudioKernelAgentCreationKernelOption>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub default_kernel_id: Option<String>,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub struct StudioCreateKernelAgentInput {
    pub instance_id: String,
    pub kernel_id: Option<String>,
    pub agent_id: String,
    pub display_name: String,
    pub avatar: Option<String>,
    pub is_default: bool,
    pub primary_model: Option<String>,
    pub fallback_models: Vec<String>,
    pub workspace: Option<String>,
    pub agent_dir: Option<String>,
    pub temperature: Option<f64>,
    pub top_p: Option<f64>,
    pub max_tokens: Option<u32>,
    pub timeout_ms: Option<u32>,
    pub streaming: Option<bool>,
}

impl Default for StudioCreateKernelAgentInput {
    fn default() -> Self {
        Self {
            instance_id: String::new(),
            kernel_id: None,
            agent_id: String::new(),
            display_name: String::new(),
            avatar: None,
            is_default: false,
            primary_model: None,
            fallback_models: Vec::new(),
            workspace: None,
            agent_dir: None,
            temperature: None,
            top_p: None,
            max_tokens: None,
            timeout_ms: None,
            streaming: None,
        }
    }
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StudioCreatedKernelAgentRecord {
    pub instance_id: String,
    pub kernel_id: String,
    pub agent_id: String,
    pub display_name: String,
}

#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub struct PartialStudioStorageBinding {
    pub profile_id: Option<String>,
    pub provider: Option<StorageProviderKind>,
    pub namespace: Option<String>,
    pub database: Option<String>,
    pub connection_hint: Option<String>,
    pub endpoint: Option<String>,
}

#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub struct PartialStudioInstanceConfig {
    pub port: Option<String>,
    pub sandbox: Option<bool>,
    pub auto_update: Option<bool>,
    pub log_level: Option<String>,
    pub cors_origins: Option<String>,
    pub workspace_path: Option<String>,
    pub base_url: Option<String>,
    pub websocket_url: Option<String>,
    pub auth_token: Option<String>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct InstanceRegistryDocument {
    version: u32,
    instances: Vec<StudioInstanceRecord>,
}

impl Default for InstanceRegistryDocument {
    fn default() -> Self {
        Self {
            version: 1,
            instances: Vec::new(),
        }
    }
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HostPlatformStatusRecord {
    pub mode: String,
    pub lifecycle: String,
    pub distribution_family: String,
    pub deployment_family: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub accelerator_profile: Option<String>,
    pub host_id: String,
    pub display_name: String,
    pub version: String,
    pub desired_state_projection_version: String,
    pub rollout_engine_version: String,
    pub manage_base_path: String,
    pub internal_base_path: String,
    pub state_store_driver: String,
    pub state_store: ServerStateStoreSnapshot,
    pub capability_keys: Vec<String>,
    pub supported_capability_keys: Vec<String>,
    pub available_capability_keys: Vec<String>,
    pub updated_at: u64,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PreviewRolloutInput {
    pub rollout_id: String,
    #[serde(default)]
    pub force_recompute: bool,
    #[serde(default)]
    pub include_targets: bool,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ManageRolloutRecord {
    pub id: String,
    pub phase: String,
    pub attempt: u32,
    pub target_count: u32,
    pub updated_at: u64,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ManageRolloutListResult {
    pub items: Vec<ManageRolloutRecord>,
    pub total: u32,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ManageRolloutTargetPreviewRecord {
    pub node_id: String,
    pub preflight_outcome: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub blocked_reason: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub desired_state_revision: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub desired_state_hash: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub wave_id: Option<String>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ManageRolloutPreviewSummary {
    pub total_targets: u32,
    pub admissible_targets: u32,
    pub degraded_targets: u32,
    pub blocked_targets: u32,
    pub predicted_wave_count: u32,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ManageRolloutCandidateRevisionSummary {
    pub total_targets: u32,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub min_desired_state_revision: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub max_desired_state_revision: Option<u64>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ManageRolloutPreview {
    pub rollout_id: String,
    pub phase: String,
    pub attempt: u32,
    pub summary: ManageRolloutPreviewSummary,
    pub targets: Vec<ManageRolloutTargetPreviewRecord>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub candidate_revision_summary: Option<ManageRolloutCandidateRevisionSummary>,
    pub generated_at: u64,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct InternalNodeSessionRecord {
    pub session_id: String,
    pub node_id: String,
    pub state: String,
    pub compatibility_state: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub desired_state_revision: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub desired_state_hash: Option<String>,
    pub last_seen_at: u64,
}

fn build_desktop_host_state_store_snapshot(paths: &AppPaths) -> (String, ServerStateStoreSnapshot) {
    let sqlite_path = paths
        .machine_state_dir
        .join("desktop-host")
        .join("host-state.sqlite3")
        .to_string_lossy()
        .into_owned();

    (
        "sqlite".to_string(),
        ServerStateStoreSnapshot {
            active_profile_id: "default-sqlite".to_string(),
            providers: vec![
                ServerStateStoreProviderRecord {
                    id: "json-file".to_string(),
                    label: "JSON File Catalogs".to_string(),
                    availability: "ready".to_string(),
                    requires_configuration: false,
                    configuration_keys: Vec::new(),
                    projection_mode: "runtime".to_string(),
                },
                ServerStateStoreProviderRecord {
                    id: "sqlite".to_string(),
                    label: "SQLite Host State".to_string(),
                    availability: "ready".to_string(),
                    requires_configuration: false,
                    configuration_keys: Vec::new(),
                    projection_mode: "runtime".to_string(),
                },
                ServerStateStoreProviderRecord {
                    id: "postgres".to_string(),
                    label: "Postgres Host State".to_string(),
                    availability: "planned".to_string(),
                    requires_configuration: true,
                    configuration_keys: vec![
                        "postgresUrl".to_string(),
                        "postgresSchema".to_string(),
                    ],
                    projection_mode: "metadataOnly".to_string(),
                },
            ],
            profiles: vec![
                ServerStateStoreProfileRecord {
                    id: "default-json-file".to_string(),
                    label: "JSON File Catalogs".to_string(),
                    driver: "json-file".to_string(),
                    active: false,
                    availability: "ready".to_string(),
                    path: Some(
                        paths
                            .install_root
                            .join("rollout-catalogs.json")
                            .to_string_lossy()
                            .into_owned(),
                    ),
                    connection_configured: true,
                    configured_keys: vec!["path".to_string()],
                    projection_mode: "runtime".to_string(),
                },
                ServerStateStoreProfileRecord {
                    id: "default-sqlite".to_string(),
                    label: "SQLite Host State".to_string(),
                    driver: "sqlite".to_string(),
                    active: true,
                    availability: "ready".to_string(),
                    path: Some(sqlite_path),
                    connection_configured: true,
                    configured_keys: vec!["path".to_string()],
                    projection_mode: "runtime".to_string(),
                },
                ServerStateStoreProfileRecord {
                    id: "default-postgres".to_string(),
                    label: "Postgres Host State".to_string(),
                    driver: "postgres".to_string(),
                    active: false,
                    availability: "planned".to_string(),
                    path: None,
                    connection_configured: false,
                    configured_keys: Vec::new(),
                    projection_mode: "metadataOnly".to_string(),
                },
            ],
        },
    )
}

#[derive(Clone, Debug, Default)]
pub struct StudioService;

impl StudioService {
    pub fn new() -> Self {
        Self
    }

    #[allow(dead_code)]
    pub fn list_instances(
        &self,
        paths: &AppPaths,
        config: &AppConfig,
        storage: &StorageService,
    ) -> Result<Vec<StudioInstanceRecord>> {
        self.list_instances_internal(paths, config, storage, None)
    }

    pub fn list_instances_with_supervisor(
        &self,
        paths: &AppPaths,
        config: &AppConfig,
        storage: &StorageService,
        supervisor: &SupervisorService,
    ) -> Result<Vec<StudioInstanceRecord>> {
        self.list_instances_internal(paths, config, storage, Some(supervisor))
    }

    pub fn get_instance(
        &self,
        paths: &AppPaths,
        config: &AppConfig,
        storage: &StorageService,
        id: &str,
    ) -> Result<Option<StudioInstanceRecord>> {
        self.get_instance_internal(paths, config, storage, None, id)
    }

    pub fn get_instance_with_supervisor(
        &self,
        paths: &AppPaths,
        config: &AppConfig,
        storage: &StorageService,
        supervisor: &SupervisorService,
        id: &str,
    ) -> Result<Option<StudioInstanceRecord>> {
        self.get_instance_internal(paths, config, storage, Some(supervisor), id)
    }

    pub fn get_host_platform_status(
        &self,
        paths: &AppPaths,
        _config: &AppConfig,
        _storage: &StorageService,
        supervisor: &SupervisorService,
        desktop_host: Option<&EmbeddedHostRuntimeSnapshot>,
        desktop_host_status: Option<&EmbeddedHostRuntimeStatus>,
    ) -> Result<HostPlatformStatusRecord> {
        let metadata = host_core_metadata();
        let supported_capability_keys = host_platform_capability_keys_for_mode("desktopCombined");

        let (mode, manage_base_path, internal_base_path, state_store_driver, state_store) =
            if let Some(snapshot) = desktop_host {
                (
                    snapshot.mode.clone(),
                    snapshot.manage_base_path.clone(),
                    snapshot.internal_base_path.clone(),
                    snapshot.state_store_driver.clone(),
                    snapshot.state_store.clone(),
                )
            } else {
                let (state_store_driver, state_store) =
                    build_desktop_host_state_store_snapshot(paths);
                (
                    "desktopCombined".to_string(),
                    "/claw/manage/v1".to_string(),
                    "/claw/internal/v1".to_string(),
                    state_store_driver,
                    state_store,
                )
            };
        let lifecycle = desktop_host_status
            .map(|status| status.lifecycle.clone())
            .unwrap_or_else(|| {
                if desktop_host.is_some() {
                    "starting".to_string()
                } else {
                    "stopped".to_string()
                }
            });
        let available_capability_keys = project_desktop_host_available_capability_keys(
            &supported_capability_keys,
            supervisor,
            desktop_host_status,
        )?;

        Ok(HostPlatformStatusRecord {
            mode,
            lifecycle,
            distribution_family: "desktop".to_string(),
            deployment_family: "bareMetal".to_string(),
            accelerator_profile: None,
            host_id: "desktop-local".to_string(),
            display_name: "Desktop Combined Host".to_string(),
            version: metadata.package_version.to_string(),
            desired_state_projection_version: HOST_PLATFORM_DESIRED_STATE_PROJECTION_VERSION
                .to_string(),
            rollout_engine_version: HOST_PLATFORM_ROLLOUT_ENGINE_VERSION.to_string(),
            manage_base_path,
            internal_base_path,
            state_store_driver,
            state_store,
            capability_keys: available_capability_keys.clone(),
            supported_capability_keys,
            available_capability_keys,
            updated_at: unix_timestamp_ms()?,
        })
    }

    pub fn get_host_endpoints(
        &self,
        paths: &AppPaths,
        _config: &AppConfig,
        _storage: &StorageService,
        supervisor: &SupervisorService,
        desktop_host: Option<&EmbeddedHostRuntimeSnapshot>,
    ) -> Result<Vec<HostEndpointRecord>> {
        let mut endpoints = Vec::new();

        if let Some(snapshot) = desktop_host {
            endpoints.push(snapshot.endpoint.clone());
        }

        if let Some(gateway_endpoint) = built_in_openclaw_gateway_endpoint(paths, supervisor)? {
            endpoints.push(gateway_endpoint);
        }

        Ok(endpoints)
    }

    pub fn get_openclaw_runtime(
        &self,
        paths: &AppPaths,
        _config: &AppConfig,
        _storage: &StorageService,
        supervisor: &SupervisorService,
    ) -> Result<OpenClawRuntimeProjection> {
        let updated_at = unix_timestamp_ms()?;
        let endpoint = built_in_openclaw_gateway_endpoint(paths, supervisor)?;

        Ok(project_openclaw_runtime(
            endpoint.as_ref(),
            built_in_openclaw_lifecycle(supervisor)?,
            "desktopCombined",
            updated_at,
        ))
    }

    pub fn get_openclaw_gateway(
        &self,
        paths: &AppPaths,
        _config: &AppConfig,
        _storage: &StorageService,
        supervisor: &SupervisorService,
    ) -> Result<OpenClawGatewayProjection> {
        let updated_at = unix_timestamp_ms()?;
        let endpoint = built_in_openclaw_gateway_endpoint(paths, supervisor)?;

        Ok(project_openclaw_gateway(
            endpoint.as_ref(),
            built_in_openclaw_lifecycle(supervisor)?,
            "desktopCombined",
            updated_at,
        ))
    }

    pub fn invoke_managed_openclaw_gateway(
        &self,
        paths: &AppPaths,
        config: &AppConfig,
        storage: &StorageService,
        supervisor: &SupervisorService,
        request: OpenClawGatewayInvokeRequest,
    ) -> Result<Value> {
        let hosted_request = StudioOpenClawGatewayInvokeRequest {
            tool: request.tool,
            action: request.action,
            args: request.args,
            session_key: request.session_key,
            dry_run: request.dry_run,
        };
        let options = StudioOpenClawGatewayInvokeOptions {
            message_channel: request.message_channel,
            account_id: request.account_id,
            headers: request.headers.unwrap_or_default(),
        };

        self.invoke_openclaw_gateway(
            paths,
            config,
            storage,
            supervisor,
            &self
                .resolve_built_in_openclaw_instance(paths, config, storage)?
                .id,
            &hosted_request,
            &options,
        )
    }

    pub fn list_rollouts(
        &self,
        _paths: &AppPaths,
        _config: &AppConfig,
        _storage: &StorageService,
        _supervisor: &SupervisorService,
    ) -> Result<ManageRolloutListResult> {
        Ok(ManageRolloutListResult {
            items: vec![ManageRolloutRecord {
                id: "desktop-combined-rollout".to_string(),
                phase: "draft".to_string(),
                attempt: 0,
                target_count: 1,
                updated_at: unix_timestamp_ms()?,
            }],
            total: 1,
        })
    }

    pub fn preview_rollout(
        &self,
        paths: &AppPaths,
        config: &AppConfig,
        storage: &StorageService,
        _supervisor: &SupervisorService,
        input: PreviewRolloutInput,
    ) -> Result<ManageRolloutPreview> {
        let instance = self
            .resolve_built_in_openclaw_instance(paths, config, storage)
            .map_err(|_| FrameworkError::NotFound("built-in combined node".to_string()))?;
        let compiler = ProjectionCompiler::new();
        let projection = compiler.compile(&DesiredStateInput {
            node_id: instance.id.clone(),
            config_projection_version: HOST_PLATFORM_DESIRED_STATE_PROJECTION_VERSION.to_string(),
            semantic_payload: format!(
                "rollout={};runtime={:?};status={:?};forceRecompute={}",
                input.rollout_id, instance.runtime_kind, instance.status, input.force_recompute
            ),
        });
        let target = RolloutPreflightTarget {
            node_id: instance.id.clone(),
            capabilities: vec![
                "desired-state.pull".to_string(),
                "internal.node-sessions.hello".to_string(),
                "internal.node-sessions.heartbeat".to_string(),
            ],
            trusted: true,
            compatible: true,
        };
        let policy = RolloutPolicy {
            required_capabilities: vec!["desired-state.pull".to_string()],
            allow_degraded_targets: false,
        };
        let outcome = preflight_target(&target, &policy);
        let target_record = ManageRolloutTargetPreviewRecord {
            node_id: instance.id,
            preflight_outcome: preflight_outcome_label(outcome).to_string(),
            blocked_reason: blocked_reason_for_outcome(outcome),
            desired_state_revision: Some(projection.desired_state_revision),
            desired_state_hash: Some(projection.desired_state_hash),
            wave_id: Some("wave-1".to_string()),
        };

        Ok(ManageRolloutPreview {
            rollout_id: input.rollout_id,
            phase: "ready".to_string(),
            attempt: 1,
            summary: build_rollout_preview_summary(outcome),
            targets: if input.include_targets {
                vec![target_record]
            } else {
                Vec::new()
            },
            candidate_revision_summary: Some(ManageRolloutCandidateRevisionSummary {
                total_targets: 1,
                min_desired_state_revision: Some(projection.desired_state_revision),
                max_desired_state_revision: Some(projection.desired_state_revision),
            }),
            generated_at: unix_timestamp_ms()?,
        })
    }

    pub fn start_rollout(
        &self,
        paths: &AppPaths,
        config: &AppConfig,
        storage: &StorageService,
        supervisor: &SupervisorService,
        rollout_id: &str,
    ) -> Result<ManageRolloutRecord> {
        let preview = self.preview_rollout(
            paths,
            config,
            storage,
            supervisor,
            PreviewRolloutInput {
                rollout_id: rollout_id.to_string(),
                force_recompute: false,
                include_targets: true,
            },
        )?;

        Ok(ManageRolloutRecord {
            id: preview.rollout_id,
            phase: "ready".to_string(),
            attempt: preview.attempt,
            target_count: preview.summary.total_targets,
            updated_at: preview.generated_at,
        })
    }

    pub fn list_node_sessions(
        &self,
        paths: &AppPaths,
        config: &AppConfig,
        storage: &StorageService,
        supervisor: &SupervisorService,
        desktop_host: Option<&EmbeddedHostRuntimeSnapshot>,
        desktop_host_status: Option<&EmbeddedHostRuntimeStatus>,
    ) -> Result<Vec<InternalNodeSessionRecord>> {
        let status = self.get_host_platform_status(
            paths,
            config,
            storage,
            supervisor,
            desktop_host,
            desktop_host_status,
        )?;
        let preview = self.preview_rollout(
            paths,
            config,
            storage,
            supervisor,
            PreviewRolloutInput {
                rollout_id: "desktop-combined-bootstrap".to_string(),
                force_recompute: false,
                include_targets: true,
            },
        )?;
        let target = preview.targets.into_iter().next();
        let node_id = self
            .resolve_built_in_openclaw_instance(paths, config, storage)?
            .id;

        Ok(vec![InternalNodeSessionRecord {
            session_id: format!("desktop-combined-{node_id}"),
            node_id,
            state: if status.lifecycle == "ready" {
                "admitted".to_string()
            } else {
                "degraded".to_string()
            },
            compatibility_state: match target
                .as_ref()
                .map(|record| record.preflight_outcome.as_str())
            {
                Some("admissible") | Some("admissibleDegraded") => "compatible".to_string(),
                _ => "blocked".to_string(),
            },
            desired_state_revision: target
                .as_ref()
                .and_then(|record| record.desired_state_revision),
            desired_state_hash: target.and_then(|record| record.desired_state_hash),
            last_seen_at: unix_timestamp_ms()?,
        }])
    }

    pub fn create_instance(
        &self,
        paths: &AppPaths,
        config: &AppConfig,
        storage: &StorageService,
        input: StudioCreateInstanceInput,
    ) -> Result<StudioInstanceRecord> {
        validate_create_instance_input(&input)?;
        let mut registry = self.load_instance_registry(paths, config, storage)?;
        let created_at = unix_timestamp_ms()?;
        let storage_binding = merge_storage_binding(
            default_storage_binding(config),
            input.storage.unwrap_or_default(),
        );
        let instance_config = merge_instance_config(StudioInstanceConfig::default(), input.config);
        let capabilities = default_capabilities_for_runtime(&input.runtime_kind);
        let port = input.port.or_else(|| {
            instance_config
                .port
                .parse::<u16>()
                .ok()
                .filter(|value| *value > 0)
        });

        let record = StudioInstanceRecord {
            id: format!("instance-{}", created_at),
            name: input.name.trim().to_string(),
            description: normalize_optional_string(input.description),
            runtime_kind: input.runtime_kind,
            deployment_mode: input.deployment_mode,
            transport_kind: input.transport_kind,
            status: StudioInstanceStatus::Offline,
            is_built_in: false,
            is_default: registry.instances.is_empty(),
            icon_type: input.icon_type.unwrap_or(StudioInstanceIconType::Server),
            version: input.version.unwrap_or_else(|| "custom".to_string()),
            type_label: input
                .type_label
                .unwrap_or_else(|| "Managed Instance".to_string()),
            host: input.host.unwrap_or_else(|| "127.0.0.1".to_string()),
            port,
            base_url: input.base_url.or(instance_config.base_url.clone()),
            websocket_url: input
                .websocket_url
                .or(instance_config.websocket_url.clone()),
            cpu: 0,
            memory: 0,
            total_memory: "Unknown".to_string(),
            uptime: "-".to_string(),
            capabilities,
            storage: storage_binding,
            config: instance_config,
            created_at,
            updated_at: created_at,
            last_seen_at: None,
        };

        registry.instances.push(record.clone());
        normalize_default_instance(&mut registry.instances);
        self.write_instance_registry(paths, config, storage, &registry)?;
        Ok(record)
    }

    pub fn update_instance(
        &self,
        paths: &AppPaths,
        config: &AppConfig,
        storage: &StorageService,
        id: &str,
        input: StudioUpdateInstanceInput,
    ) -> Result<StudioInstanceRecord> {
        let mut registry = self.load_instance_registry(paths, config, storage)?;
        let index = registry
            .instances
            .iter()
            .position(|instance| matches_requested_instance_id(instance, id))
            .ok_or_else(|| FrameworkError::NotFound(format!("instance \"{id}\"")))?;

        let current = registry.instances[index].clone();
        let next_port = input.port.or(current.port);
        let mut merged_config = merge_instance_config(current.config.clone(), input.config);
        if is_built_in_openclaw_instance(&current) {
            merged_config = normalize_built_in_openclaw_instance_config(paths, merged_config);
        }

        registry.instances[index] = StudioInstanceRecord {
            name: input.name.unwrap_or(current.name),
            description: input
                .description
                .map(Some)
                .map(normalize_optional_string)
                .unwrap_or(current.description),
            icon_type: input.icon_type.unwrap_or(current.icon_type),
            version: input.version.unwrap_or(current.version),
            type_label: input.type_label.unwrap_or(current.type_label),
            host: input.host.unwrap_or(current.host),
            port: next_port,
            base_url: input.base_url.or(current.base_url),
            websocket_url: input.websocket_url.or(current.websocket_url),
            status: input.status.unwrap_or(current.status),
            is_default: input.is_default.unwrap_or(current.is_default),
            config: merged_config,
            updated_at: unix_timestamp_ms()?,
            ..current
        };

        if is_built_in_openclaw_instance(&registry.instances[index]) {
            self.sync_built_in_runtime_config(paths, &registry.instances[index].config)?;
        }

        if input.is_default == Some(true) {
            for (current_index, instance) in registry.instances.iter_mut().enumerate() {
                if current_index != index {
                    instance.is_default = false;
                }
            }
        }

        normalize_default_instance(&mut registry.instances);
        let updated = registry.instances[index].clone();
        self.write_instance_registry(paths, config, storage, &registry)?;
        Ok(updated)
    }

    pub fn delete_instance(
        &self,
        paths: &AppPaths,
        config: &AppConfig,
        storage: &StorageService,
        id: &str,
    ) -> Result<bool> {
        if let Some(instance) = self.get_instance(paths, config, storage, id)? {
            if is_built_in_openclaw_instance(&instance) {
                return Err(FrameworkError::Conflict(
                    "the built-in instance cannot be deleted".to_string(),
                ));
            }
        }

        let mut registry = self.load_instance_registry(paths, config, storage)?;
        let initial_len = registry.instances.len();
        registry.instances.retain(|instance| instance.id != id);
        if registry.instances.len() == initial_len {
            return Ok(false);
        }

        normalize_default_instance(&mut registry.instances);
        self.write_instance_registry(paths, config, storage, &registry)?;

        let keys = storage.list_keys(
            paths,
            config,
            StorageListKeysRequest {
                profile_id: chat_storage_profile_id(),
                namespace: Some(CHAT_NAMESPACE.to_string()),
            },
        )?;
        for key in keys.keys {
            if !key.starts_with(CONVERSATION_KEY_PREFIX) {
                continue;
            }

            let Some(mut conversation) = self.read_conversation(paths, config, storage, &key)?
            else {
                continue;
            };

            if conversation.primary_instance_id != id
                && !conversation
                    .participant_instance_ids
                    .iter()
                    .any(|value| value == id)
            {
                continue;
            }

            conversation
                .participant_instance_ids
                .retain(|participant_id| participant_id != id);

            if conversation.primary_instance_id == id {
                let Some(next_primary_instance_id) =
                    conversation.participant_instance_ids.first().cloned()
                else {
                    let _ = storage.delete(
                        paths,
                        config,
                        StorageDeleteRequest {
                            profile_id: chat_storage_profile_id(),
                            namespace: Some(CHAT_NAMESPACE.to_string()),
                            key,
                        },
                    )?;
                    continue;
                };

                conversation.primary_instance_id = next_primary_instance_id;
            }

            conversation.updated_at = conversation.updated_at.max(unix_timestamp_ms()?);
            let _ = self.put_conversation(paths, config, storage, conversation)?;
        }

        Ok(true)
    }

    pub fn start_instance(
        &self,
        paths: &AppPaths,
        config: &AppConfig,
        storage: &StorageService,
        supervisor: &SupervisorService,
        id: &str,
    ) -> Result<Option<StudioInstanceRecord>> {
        let instance = self.get_instance(paths, config, storage, id)?;
        let Some(instance) = instance else {
            return Ok(None);
        };

        if is_built_in_openclaw_instance(&instance) {
            self.set_built_in_openclaw_status(
                paths,
                config,
                storage,
                StudioInstanceStatus::Starting,
            )?;
            match supervisor.start_openclaw_gateway(paths) {
                Ok(()) => {
                    return Ok(Some(self.set_built_in_openclaw_status(
                        paths,
                        config,
                        storage,
                        StudioInstanceStatus::Online,
                    )?));
                }
                Err(error) => {
                    let _ = self.set_built_in_openclaw_status(
                        paths,
                        config,
                        storage,
                        StudioInstanceStatus::Error,
                    );
                    return Err(error);
                }
            }
        }

        Ok(Some(self.set_instance_status(
            paths,
            config,
            storage,
            id,
            StudioInstanceStatus::Online,
        )?))
    }

    pub fn stop_instance(
        &self,
        paths: &AppPaths,
        config: &AppConfig,
        storage: &StorageService,
        supervisor: &SupervisorService,
        id: &str,
    ) -> Result<Option<StudioInstanceRecord>> {
        let instance = self.get_instance(paths, config, storage, id)?;
        let Some(instance) = instance else {
            return Ok(None);
        };

        if is_built_in_openclaw_instance(&instance) {
            if let Err(error) = supervisor.stop_openclaw_gateway() {
                let _ = self.set_built_in_openclaw_status(
                    paths,
                    config,
                    storage,
                    StudioInstanceStatus::Error,
                );
                return Err(error);
            }
            return Ok(Some(self.set_built_in_openclaw_status(
                paths,
                config,
                storage,
                StudioInstanceStatus::Offline,
            )?));
        }

        Ok(Some(self.set_instance_status(
            paths,
            config,
            storage,
            id,
            StudioInstanceStatus::Offline,
        )?))
    }

    pub fn restart_instance(
        &self,
        paths: &AppPaths,
        config: &AppConfig,
        storage: &StorageService,
        supervisor: &SupervisorService,
        id: &str,
    ) -> Result<Option<StudioInstanceRecord>> {
        let instance = self.get_instance(paths, config, storage, id)?;
        let Some(instance) = instance else {
            return Ok(None);
        };

        if is_built_in_openclaw_instance(&instance) {
            self.set_built_in_openclaw_status(
                paths,
                config,
                storage,
                StudioInstanceStatus::Starting,
            )?;
            match supervisor.restart_openclaw_gateway(paths) {
                Ok(()) => {
                    return Ok(Some(self.set_built_in_openclaw_status(
                        paths,
                        config,
                        storage,
                        StudioInstanceStatus::Online,
                    )?));
                }
                Err(error) => {
                    let _ = self.set_built_in_openclaw_status(
                        paths,
                        config,
                        storage,
                        StudioInstanceStatus::Error,
                    );
                    return Err(error);
                }
            }
        }

        Ok(Some(self.set_instance_status(
            paths,
            config,
            storage,
            id,
            StudioInstanceStatus::Online,
        )?))
    }

    pub fn set_instance_status(
        &self,
        paths: &AppPaths,
        config: &AppConfig,
        storage: &StorageService,
        id: &str,
        status: StudioInstanceStatus,
    ) -> Result<StudioInstanceRecord> {
        let mut registry = self.load_instance_registry(paths, config, storage)?;
        let index = registry
            .instances
            .iter()
            .position(|instance| matches_requested_instance_id(instance, id))
            .ok_or_else(|| FrameworkError::NotFound(format!("instance \"{id}\"")))?;

        let now = unix_timestamp_ms()?;
        registry.instances[index].status = status;
        registry.instances[index].updated_at = now;
        registry.instances[index].last_seen_at = Some(now);

        let updated = registry.instances[index].clone();
        self.write_instance_registry(paths, config, storage, &registry)?;
        Ok(updated)
    }

    pub fn set_built_in_openclaw_status(
        &self,
        paths: &AppPaths,
        config: &AppConfig,
        storage: &StorageService,
        status: StudioInstanceStatus,
    ) -> Result<StudioInstanceRecord> {
        let mut registry = self.load_instance_registry(paths, config, storage)?;
        let index = find_built_in_openclaw_index(&registry.instances)
            .ok_or_else(|| FrameworkError::NotFound("built-in OpenClaw instance".to_string()))?;
        let now = unix_timestamp_ms()?;
        registry.instances[index].status = status;
        registry.instances[index].updated_at = now;
        registry.instances[index].last_seen_at = Some(now);

        let updated = registry.instances[index].clone();
        self.write_instance_registry(paths, config, storage, &registry)?;
        Ok(updated)
    }

    pub fn get_instance_config(
        &self,
        paths: &AppPaths,
        config: &AppConfig,
        storage: &StorageService,
        id: &str,
    ) -> Result<Option<StudioInstanceConfig>> {
        Ok(self
            .get_instance(paths, config, storage, id)?
            .map(|instance| instance.config))
    }

    pub fn update_instance_config(
        &self,
        paths: &AppPaths,
        config: &AppConfig,
        storage: &StorageService,
        id: &str,
        next_config: StudioInstanceConfig,
    ) -> Result<Option<StudioInstanceConfig>> {
        let updated = self.update_instance(
            paths,
            config,
            storage,
            id,
            StudioUpdateInstanceInput {
                port: next_config.port.parse::<u16>().ok(),
                base_url: next_config.base_url.clone(),
                websocket_url: next_config.websocket_url.clone(),
                config: Some(PartialStudioInstanceConfig {
                    port: Some(next_config.port.clone()),
                    sandbox: Some(next_config.sandbox),
                    auto_update: Some(next_config.auto_update),
                    log_level: Some(next_config.log_level.clone()),
                    cors_origins: Some(next_config.cors_origins.clone()),
                    workspace_path: next_config.workspace_path.clone(),
                    base_url: next_config.base_url.clone(),
                    websocket_url: next_config.websocket_url.clone(),
                    auth_token: next_config.auth_token.clone(),
                }),
                ..StudioUpdateInstanceInput::default()
            },
        )?;

        Ok(Some(updated.config))
    }

    pub fn get_instance_logs(
        &self,
        paths: &AppPaths,
        config: &AppConfig,
        storage: &StorageService,
        id: &str,
    ) -> Result<String> {
        if let Some(instance) = self.get_instance(paths, config, storage, id)? {
            if is_built_in_openclaw_instance(&instance) {
                let log_file = paths.logs_dir.join("openclaw-gateway.log");
                if log_file.exists() {
                    return Ok(fs::read_to_string(log_file)?);
                }
            }

            return Ok(format!(
                "[{}] instance={} status={:?} transport={:?}",
                instance.updated_at, instance.id, instance.status, instance.transport_kind
            ));
        }

        Ok(String::new())
    }

    pub fn update_instance_file_content(
        &self,
        paths: &AppPaths,
        config: &AppConfig,
        storage: &StorageService,
        instance_id: &str,
        file_id: &str,
        content: &str,
    ) -> Result<bool> {
        self.require_built_in_openclaw_instance(paths, config, storage, instance_id)?;
        let file_path = Path::new(file_id);
        let instance = self
            .get_instance(paths, config, storage, instance_id)?
            .ok_or_else(|| FrameworkError::NotFound(format!("instance \"{instance_id}\"")))?;
        let workbench = build_openclaw_workbench_snapshot(paths, &instance)?.ok_or_else(|| {
            FrameworkError::Conflict("workbench snapshot unavailable".to_string())
        })?;
        let is_writable = workbench
            .files
            .iter()
            .any(|file| file.path == file_id && !file.is_readonly);

        if !is_writable {
            return Err(FrameworkError::Conflict(format!(
                "workbench file \"{file_id}\" is read-only"
            )));
        }

        if let Some(parent) = file_path.parent() {
            fs::create_dir_all(parent)?;
        }
        fs::write(file_path, content)?;
        Ok(true)
    }

    pub fn update_instance_llm_provider_config(
        &self,
        paths: &AppPaths,
        config: &AppConfig,
        storage: &StorageService,
        instance_id: &str,
        provider_id: &str,
        update: StudioUpdateInstanceLlmProviderConfigInput,
    ) -> Result<bool> {
        self.require_built_in_openclaw_instance(paths, config, storage, instance_id)?;

        let mut root = read_openclaw_config(paths)?;
        let provider_path = ["models", "providers", provider_id];

        if !update.endpoint.trim().is_empty() {
            set_nested_string(
                &mut root,
                &["models", "providers", provider_id, "baseUrl"],
                update.endpoint.trim(),
            );
        }
        set_nested_value(
            &mut root,
            &["models", "providers", provider_id, "apiKey"],
            if update.api_key_source.trim().is_empty() {
                Value::Null
            } else {
                Value::String(update.api_key_source.trim().to_string())
            },
        );
        remove_nested_value(
            &mut root,
            &["models", "providers", provider_id, "temperature"],
        );
        remove_nested_value(&mut root, &["models", "providers", provider_id, "topP"]);
        remove_nested_value(
            &mut root,
            &["models", "providers", provider_id, "maxTokens"],
        );
        remove_nested_value(
            &mut root,
            &["models", "providers", provider_id, "timeoutMs"],
        );
        remove_nested_value(
            &mut root,
            &["models", "providers", provider_id, "streaming"],
        );

        let existing_models = get_nested_value(
            &root,
            &[
                provider_path[0],
                provider_path[1],
                provider_path[2],
                "models",
            ],
        )
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();
        let next_models = upsert_openclaw_provider_models(
            existing_models,
            update.default_model_id.as_str(),
            update.reasoning_model_id.as_deref(),
            update.embedding_model_id.as_deref(),
        );
        set_nested_value(
            &mut root,
            &["models", "providers", provider_id, "models"],
            Value::Array(next_models),
        );
        let next_models = get_nested_value(&root, &["models", "providers", provider_id, "models"])
            .and_then(Value::as_array)
            .cloned()
            .unwrap_or_default();
        sync_openclaw_defaults_model_selection(
            &mut root,
            provider_id,
            &update.default_model_id,
            update.reasoning_model_id.as_deref(),
        );
        sync_openclaw_provider_model_catalog(
            &mut root,
            provider_id,
            &next_models,
            &update.default_model_id,
            &update.config,
        );

        write_openclaw_config_file(paths, &root)?;
        Ok(true)
    }

    pub fn clone_instance_task(
        &self,
        paths: &AppPaths,
        config: &AppConfig,
        storage: &StorageService,
        supervisor: &SupervisorService,
        instance_id: &str,
        task_id: &str,
        name: Option<&str>,
    ) -> Result<()> {
        self.require_built_in_openclaw_task_instance(paths, config, storage, instance_id)?;
        let runtime = require_running_openclaw_runtime(supervisor)?;
        clone_openclaw_task(paths, &runtime, task_id, name)
    }

    pub fn create_instance_task(
        &self,
        paths: &AppPaths,
        config: &AppConfig,
        storage: &StorageService,
        supervisor: &SupervisorService,
        instance_id: &str,
        payload: &Value,
    ) -> Result<()> {
        self.require_built_in_openclaw_task_instance(paths, config, storage, instance_id)?;
        let runtime = require_running_openclaw_runtime(supervisor)?;
        create_openclaw_task(paths, &runtime, payload)
    }

    pub fn invoke_openclaw_gateway(
        &self,
        paths: &AppPaths,
        config: &AppConfig,
        storage: &StorageService,
        supervisor: &SupervisorService,
        instance_id: &str,
        request: &StudioOpenClawGatewayInvokeRequest,
        options: &StudioOpenClawGatewayInvokeOptions,
    ) -> Result<Value> {
        self.require_built_in_openclaw_instance(paths, config, storage, instance_id)?;
        let runtime = require_running_openclaw_runtime(supervisor)?;
        invoke_openclaw_gateway(&runtime, request, options)
    }

    pub fn update_instance_task(
        &self,
        paths: &AppPaths,
        config: &AppConfig,
        storage: &StorageService,
        supervisor: &SupervisorService,
        instance_id: &str,
        task_id: &str,
        payload: &Value,
    ) -> Result<()> {
        self.require_built_in_openclaw_task_instance(paths, config, storage, instance_id)?;
        let runtime = require_running_openclaw_runtime(supervisor)?;
        update_openclaw_task(paths, &runtime, task_id, payload)
    }

    pub fn run_instance_task_now(
        &self,
        paths: &AppPaths,
        config: &AppConfig,
        storage: &StorageService,
        supervisor: &SupervisorService,
        instance_id: &str,
        task_id: &str,
    ) -> Result<StudioWorkbenchTaskExecutionRecord> {
        self.require_built_in_openclaw_task_instance(paths, config, storage, instance_id)?;
        let runtime = require_running_openclaw_runtime(supervisor)?;
        run_openclaw_task_now(paths, &runtime, task_id)
    }

    pub fn list_instance_task_executions(
        &self,
        paths: &AppPaths,
        config: &AppConfig,
        storage: &StorageService,
        instance_id: &str,
        task_id: &str,
    ) -> Result<Vec<StudioWorkbenchTaskExecutionRecord>> {
        self.require_built_in_openclaw_task_instance(paths, config, storage, instance_id)?;
        list_openclaw_task_executions(paths, task_id)
    }

    pub fn update_instance_task_status(
        &self,
        paths: &AppPaths,
        config: &AppConfig,
        storage: &StorageService,
        supervisor: &SupervisorService,
        instance_id: &str,
        task_id: &str,
        status: &str,
    ) -> Result<()> {
        self.require_built_in_openclaw_task_instance(paths, config, storage, instance_id)?;
        let runtime = require_running_openclaw_runtime(supervisor)?;
        update_openclaw_task_status(paths, &runtime, task_id, status)
    }

    pub fn delete_instance_task(
        &self,
        paths: &AppPaths,
        config: &AppConfig,
        storage: &StorageService,
        supervisor: &SupervisorService,
        instance_id: &str,
        task_id: &str,
    ) -> Result<bool> {
        self.require_built_in_openclaw_task_instance(paths, config, storage, instance_id)?;
        let runtime = require_running_openclaw_runtime(supervisor)?;
        delete_openclaw_task(paths, &runtime, task_id)
    }

    #[allow(dead_code)]
    pub fn get_instance_detail(
        &self,
        paths: &AppPaths,
        config: &AppConfig,
        storage: &StorageService,
        id: &str,
    ) -> Result<Option<StudioInstanceDetailRecord>> {
        self.get_instance_detail_internal(paths, config, storage, None, id)
    }

    pub fn get_instance_detail_with_supervisor(
        &self,
        paths: &AppPaths,
        config: &AppConfig,
        storage: &StorageService,
        supervisor: &SupervisorService,
        id: &str,
    ) -> Result<Option<StudioInstanceDetailRecord>> {
        self.get_instance_detail_internal(paths, config, storage, Some(supervisor), id)
    }

    fn list_instances_internal(
        &self,
        paths: &AppPaths,
        config: &AppConfig,
        storage: &StorageService,
        supervisor: Option<&SupervisorService>,
    ) -> Result<Vec<StudioInstanceRecord>> {
        Ok(self
            .load_instance_registry_projected(paths, config, storage, supervisor)?
            .instances)
    }

    fn get_instance_internal(
        &self,
        paths: &AppPaths,
        config: &AppConfig,
        storage: &StorageService,
        supervisor: Option<&SupervisorService>,
        id: &str,
    ) -> Result<Option<StudioInstanceRecord>> {
        Ok(self
            .load_instance_registry_projected(paths, config, storage, supervisor)?
            .instances
            .into_iter()
            .find(|instance| matches_requested_instance_id(instance, id)))
    }

    fn get_instance_detail_internal(
        &self,
        paths: &AppPaths,
        config: &AppConfig,
        storage: &StorageService,
        supervisor: Option<&SupervisorService>,
        id: &str,
    ) -> Result<Option<StudioInstanceDetailRecord>> {
        let Some(instance) = self.get_instance_internal(paths, config, storage, supervisor, id)?
        else {
            return Ok(None);
        };
        let logs = self.get_instance_logs(paths, config, storage, id)?;
        let config = instance.config.clone();
        let storage_snapshot = build_storage_snapshot_for_instance(&instance);
        let built_in_openclaw_root = if uses_built_in_openclaw_config(&instance) {
            Some(read_openclaw_config(paths)?)
        } else {
            None
        };
        let connectivity = build_connectivity_snapshot(&instance, built_in_openclaw_root.as_ref());
        let observability = build_observability_snapshot(paths, &instance, &logs);
        let data_access = build_data_access_snapshot(
            paths,
            &instance,
            &storage_snapshot,
            &connectivity,
            &observability,
        );
        let artifacts = build_artifacts(
            paths,
            &instance,
            &storage_snapshot,
            &connectivity,
            &observability,
        );
        let health =
            build_health_snapshot(&instance, &storage_snapshot, &connectivity, &observability)?;
        let lifecycle = build_lifecycle_snapshot(paths, &instance, supervisor)?;
        let capabilities = build_capability_snapshots(&instance, &storage_snapshot);
        let official_runtime_notes = build_official_runtime_notes(&instance);
        let console_access = build_console_access(paths, &instance)?;
        let workbench = if uses_built_in_openclaw_config(&instance) {
            build_openclaw_workbench_snapshot(paths, &instance)?
        } else {
            None
        };

        Ok(Some(StudioInstanceDetailRecord {
            instance,
            config,
            logs,
            health,
            lifecycle,
            storage: storage_snapshot,
            connectivity,
            observability,
            data_access,
            artifacts,
            capabilities,
            official_runtime_notes,
            console_access,
            workbench,
        }))
    }

    pub fn get_kernel_agent_creation_capability(
        &self,
        paths: &AppPaths,
        config: &AppConfig,
        storage: &StorageService,
        instance_id: &str,
    ) -> Result<StudioKernelAgentCreationCapability> {
        let instance = self
            .get_instance(paths, config, storage, instance_id)?
            .ok_or_else(|| FrameworkError::NotFound(format!("instance \"{instance_id}\"")))?;
        let instance_kernel_id = kernel_runtime_kind_id(&instance.runtime_kind);

        if is_built_in_openclaw_instance(&instance) {
            let config_path = readable_openclaw_config_file_path(paths);
            let config_exists = config_path.exists();
            let config_readonly = config_exists
                && fs::metadata(&config_path)
                    .map(|metadata| metadata.permissions().readonly())
                    .unwrap_or(false);
            let reason = if !config_exists {
                Some((
                    StudioKernelAgentCreationReasonCode::ConfigUnavailable,
                    format!(
                        "Desktop OpenClaw agent creation requires the managed config file at {}.",
                        config_path.display()
                    ),
                ))
            } else if config_readonly {
                Some((
                    StudioKernelAgentCreationReasonCode::ConfigNotWritable,
                    format!(
                        "Desktop OpenClaw agent creation cannot update the read-only config file at {}.",
                        config_path.display()
                    ),
                ))
            } else {
                None
            };
            let model_options = if config_exists {
                build_openclaw_kernel_agent_creation_model_options(&read_openclaw_config(paths)?)
            } else {
                Vec::new()
            };

            return Ok(StudioKernelAgentCreationCapability {
                instance_id: instance.id,
                instance_name: instance.name,
                kernel_options: vec![build_kernel_agent_creation_kernel_option(
                    instance_kernel_id.as_str(),
                    reason.is_none(),
                    reason.as_ref().map(|(code, _)| code.clone()),
                    reason.map(|(_, message)| message),
                    model_options,
                    build_openclaw_kernel_agent_creation_field_support(),
                )],
                default_kernel_id: Some(instance_kernel_id),
            });
        }

        let (reason_code, reason) = if is_managed_hermes_instance(&instance) {
            (None, None)
        } else if instance.runtime_kind == StudioRuntimeKind::Openclaw {
            (
                Some(StudioKernelAgentCreationReasonCode::ConfigUnavailable),
                Some("Desktop OpenClaw agent creation currently requires the managed local OpenClaw runtime configuration owned by Agent Studio.".to_string()),
            )
        } else {
            (
                Some(StudioKernelAgentCreationReasonCode::UnsupportedKernel),
                Some(format!(
                    "Kernel \"{}\" does not currently expose a desktop agent creation contract.",
                    instance_kernel_id
                )),
            )
        };
        let field_support = if is_managed_hermes_instance(&instance) {
            build_kernel_agent_creation_field_support(
                true, false, false, false, false, false, false, false, false, false, false,
            )
        } else if instance.runtime_kind == StudioRuntimeKind::Openclaw {
            build_openclaw_kernel_agent_creation_field_support()
        } else {
            build_kernel_agent_creation_field_support(
                false, false, false, false, false, false, false, false, false, false, false,
            )
        };

        Ok(StudioKernelAgentCreationCapability {
            instance_id: instance.id,
            instance_name: instance.name,
            kernel_options: vec![build_kernel_agent_creation_kernel_option(
                instance_kernel_id.as_str(),
                reason_code.is_none(),
                reason_code,
                reason,
                Vec::new(),
                field_support,
            )],
            default_kernel_id: Some(instance_kernel_id),
        })
    }

    pub fn create_kernel_agent(
        &self,
        paths: &AppPaths,
        config: &AppConfig,
        storage: &StorageService,
        input: StudioCreateKernelAgentInput,
    ) -> Result<StudioCreatedKernelAgentRecord> {
        let instance_id =
            trim_required_kernel_agent_field(input.instance_id.as_str(), "instanceId")?;
        let capability = self.get_kernel_agent_creation_capability(
            paths,
            config,
            storage,
            instance_id.as_str(),
        )?;
        let requested_kernel_id = normalize_kernel_agent_kernel_id(input.kernel_id.as_deref())
            .or(capability.default_kernel_id.clone())
            .ok_or_else(|| {
                FrameworkError::InvalidOperation(format!(
                    "instance \"{}\" does not expose a kernel agent creation target",
                    instance_id
                ))
            })?;
        let selected_kernel = capability
            .kernel_options
            .iter()
            .find(|option| option.kernel_id == requested_kernel_id)
            .ok_or_else(|| {
                FrameworkError::InvalidOperation(format!(
                    "instance \"{}\" does not expose kernel \"{}\" for agent creation",
                    instance_id, requested_kernel_id
                ))
            })?;

        if !selected_kernel.supported {
            return Err(FrameworkError::InvalidOperation(
                selected_kernel.reason.clone().unwrap_or_else(|| {
                    format!(
                        "kernel \"{}\" is not available for desktop agent creation",
                        requested_kernel_id
                    )
                }),
            ));
        }
        ensure_kernel_agent_create_input_matches_field_support(
            requested_kernel_id.as_str(),
            &selected_kernel.field_support,
            &input,
        )?;

        match requested_kernel_id.as_str() {
            "openclaw" => {
                self.require_built_in_openclaw_instance(
                    paths,
                    config,
                    storage,
                    instance_id.as_str(),
                )?;
                let supported_model_refs = selected_kernel
                    .model_options
                    .iter()
                    .map(|option| option.value.clone())
                    .collect::<BTreeSet<_>>();
                let primary_model =
                    normalize_optional_kernel_agent_field(input.primary_model.as_deref());
                if let Some(primary_model_ref) = primary_model.as_ref() {
                    ensure_openclaw_model_ref_is_supported(
                        &supported_model_refs,
                        primary_model_ref,
                        "primaryModel",
                    )?;
                }
                let fallback_models = normalize_kernel_agent_fallback_models(
                    &input.fallback_models,
                    primary_model.as_deref(),
                );
                for fallback_model in fallback_models.iter() {
                    ensure_openclaw_model_ref_is_supported(
                        &supported_model_refs,
                        fallback_model,
                        "fallbackModels",
                    )?;
                }

                let normalized_agent_id = normalize_kernel_agent_id(
                    &trim_required_kernel_agent_field(input.agent_id.as_str(), "agentId")?,
                );
                let display_name =
                    trim_required_kernel_agent_field(input.display_name.as_str(), "displayName")?;
                let openclaw_paths = paths.kernel_paths("openclaw")?;
                let workspace = openclaw_paths
                    .openclaw_agent_workspace_dir(normalized_agent_id.as_str())?
                    .to_string_lossy()
                    .into_owned();
                let agent_dir = openclaw_paths
                    .openclaw_agent_dir(normalized_agent_id.as_str())?
                    .to_string_lossy()
                    .into_owned();
                let mut root = read_openclaw_config(paths)?;
                ensure_built_in_openclaw_standard_agent_paths(&mut root, paths);

                save_openclaw_kernel_agent_to_config_root(
                    &mut root,
                    OpenClawKernelAgentConfigInput {
                        id: normalized_agent_id.clone(),
                        display_name: display_name.clone(),
                        avatar: normalize_optional_kernel_agent_field(input.avatar.as_deref()),
                        is_default: input.is_default,
                        primary_model,
                        fallback_models,
                        workspace: Some(workspace),
                        agent_dir: Some(agent_dir),
                        temperature: input.temperature,
                        top_p: input.top_p,
                        max_tokens: input.max_tokens,
                        timeout_ms: input.timeout_ms,
                        streaming: input.streaming,
                    },
                );
                write_openclaw_config_file(paths, &root)?;

                Ok(StudioCreatedKernelAgentRecord {
                    instance_id,
                    kernel_id: requested_kernel_id,
                    agent_id: normalized_agent_id,
                    display_name,
                })
            }
            "hermes" => {
                let instance = self
                    .get_instance(paths, config, storage, instance_id.as_str())?
                    .ok_or_else(|| {
                        FrameworkError::NotFound(format!("instance \"{}\"", instance_id))
                    })?;
                create_kernel_chat_agent_profile_for_managed_hermes(paths, &instance, &input)
            }
            _ => Err(FrameworkError::InvalidOperation(format!(
                "kernel \"{}\" is not implemented for desktop agent creation",
                requested_kernel_id
            ))),
        }
    }

    pub fn list_conversations(
        &self,
        paths: &AppPaths,
        config: &AppConfig,
        storage: &StorageService,
        instance_id: &str,
    ) -> Result<Vec<StudioConversationRecord>> {
        let response = storage.list_keys(
            paths,
            config,
            StorageListKeysRequest {
                profile_id: chat_storage_profile_id(),
                namespace: Some(CHAT_NAMESPACE.to_string()),
            },
        )?;
        let mut conversations = Vec::new();

        for key in response.keys {
            if !key.starts_with(CONVERSATION_KEY_PREFIX) {
                continue;
            }

            let Some(conversation) = self.read_conversation(paths, config, storage, &key)? else {
                continue;
            };
            if conversation.primary_instance_id == instance_id
                || conversation
                    .participant_instance_ids
                    .iter()
                    .any(|participant_id| participant_id == instance_id)
            {
                conversations.push(conversation);
            }
        }

        conversations.sort_by(|left, right| right.updated_at.cmp(&left.updated_at));
        Ok(conversations)
    }

    pub fn list_persisted_kernel_chat_agents(
        &self,
        paths: &AppPaths,
        config: &AppConfig,
        storage: &StorageService,
        instance_id: &str,
    ) -> Result<Vec<PersistedKernelChatAgentRecord>> {
        let response = storage.list_keys(
            paths,
            config,
            StorageListKeysRequest {
                profile_id: chat_storage_profile_id(),
                namespace: Some(CHAT_NAMESPACE.to_string()),
            },
        )?;
        let key_prefix = persisted_kernel_chat_agent_storage_key_prefix(instance_id);
        let mut records = Vec::new();

        for key in response.keys {
            if !key.starts_with(key_prefix.as_str()) {
                continue;
            }

            let Some(record) =
                self.read_persisted_kernel_chat_agent(paths, config, storage, &key)?
            else {
                continue;
            };
            records.push(record);
        }

        records.sort_by(|left, right| {
            left.sort_order
                .cmp(&right.sort_order)
                .then_with(|| {
                    if left.is_default == right.is_default {
                        std::cmp::Ordering::Equal
                    } else if left.is_default {
                        std::cmp::Ordering::Less
                    } else {
                        std::cmp::Ordering::Greater
                    }
                })
                .then_with(|| left.label.cmp(&right.label))
        });

        Ok(records)
    }

    pub fn replace_persisted_kernel_chat_agents(
        &self,
        paths: &AppPaths,
        config: &AppConfig,
        storage: &StorageService,
        instance_id: &str,
        mut records: Vec<PersistedKernelChatAgentRecord>,
    ) -> Result<Vec<PersistedKernelChatAgentRecord>> {
        let registry = self.load_instance_registry(paths, config, storage)?;
        if !registry
            .instances
            .iter()
            .any(|instance| instance.id == instance_id)
        {
            return Err(FrameworkError::NotFound(format!(
                "instance \"{instance_id}\""
            )));
        }

        let response = storage.list_keys(
            paths,
            config,
            StorageListKeysRequest {
                profile_id: chat_storage_profile_id(),
                namespace: Some(CHAT_NAMESPACE.to_string()),
            },
        )?;
        let key_prefix = persisted_kernel_chat_agent_storage_key_prefix(instance_id);

        for key in response.keys {
            if !key.starts_with(key_prefix.as_str()) {
                continue;
            }

            storage.delete(
                paths,
                config,
                StorageDeleteRequest {
                    profile_id: chat_storage_profile_id(),
                    namespace: Some(CHAT_NAMESPACE.to_string()),
                    key,
                },
            )?;
        }

        for (index, record) in records.iter_mut().enumerate() {
            record.instance_id =
                trim_required_storage_field(record.instance_id.as_str(), "instanceId")?;
            if record.instance_id != instance_id {
                return Err(FrameworkError::InvalidOperation(format!(
                    "persisted kernel chat agent \"{}\" targets instance \"{}\" instead of \"{}\"",
                    record.id, record.instance_id, instance_id,
                )));
            }
            record.kernel_id = trim_required_storage_field(record.kernel_id.as_str(), "kernelId")?;
            record.agent_id = trim_required_storage_field(record.agent_id.as_str(), "agentId")?;
            record.label = trim_required_storage_field(record.label.as_str(), "label")?;
            record.description = normalize_optional_storage_field(record.description.take());
            record.source = trim_required_storage_field(record.source.as_str(), "source")?;
            record.system_prompt = normalize_optional_storage_field(record.system_prompt.take());
            record.avatar = normalize_optional_storage_field(record.avatar.take());
            record.creator = normalize_optional_storage_field(record.creator.take());
            record.sort_order = index as u32;
            if record.synced_at == 0 {
                record.synced_at = unix_timestamp_ms()?;
            }
            record.id = format!(
                "{}:{}:{}",
                record.instance_id, record.kernel_id, record.agent_id
            );

            storage.put_text(
                paths,
                config,
                StoragePutTextRequest {
                    profile_id: chat_storage_profile_id(),
                    namespace: Some(CHAT_NAMESPACE.to_string()),
                    key: persisted_kernel_chat_agent_storage_key(
                        record.instance_id.as_str(),
                        record.kernel_id.as_str(),
                        record.agent_id.as_str(),
                    ),
                    value: serde_json::to_string_pretty(&record)?,
                },
            )?;
        }

        self.list_persisted_kernel_chat_agents(paths, config, storage, instance_id)
    }

    pub fn put_conversation(
        &self,
        paths: &AppPaths,
        config: &AppConfig,
        storage: &StorageService,
        mut record: StudioConversationRecord,
    ) -> Result<StudioConversationRecord> {
        let registry = self.load_instance_registry(paths, config, storage)?;
        let instance_ids = registry
            .instances
            .iter()
            .map(|instance| instance.id.as_str())
            .collect::<BTreeSet<_>>();

        if !instance_ids.contains(record.primary_instance_id.as_str()) {
            return Err(FrameworkError::NotFound(format!(
                "instance \"{}\"",
                record.primary_instance_id
            )));
        }

        record.participant_instance_ids = normalize_participant_instance_ids(
            &record.primary_instance_id,
            std::mem::take(&mut record.participant_instance_ids),
        );

        if let Some(missing_participant_id) = record
            .participant_instance_ids
            .iter()
            .find(|participant_id| !instance_ids.contains(participant_id.as_str()))
        {
            return Err(FrameworkError::NotFound(format!(
                "instance \"{}\"",
                missing_participant_id
            )));
        }
        record = sanitize_studio_conversation_record(record);

        storage.put_text(
            paths,
            config,
            StoragePutTextRequest {
                profile_id: chat_storage_profile_id(),
                namespace: Some(CHAT_NAMESPACE.to_string()),
                key: conversation_storage_key(&record.id),
                value: serde_json::to_string_pretty(&record)?,
            },
        )?;

        Ok(record)
    }

    pub fn delete_conversation(
        &self,
        paths: &AppPaths,
        config: &AppConfig,
        storage: &StorageService,
        id: &str,
    ) -> Result<bool> {
        Ok(storage
            .delete(
                paths,
                config,
                StorageDeleteRequest {
                    profile_id: chat_storage_profile_id(),
                    namespace: Some(CHAT_NAMESPACE.to_string()),
                    key: conversation_storage_key(id),
                },
            )?
            .existed)
    }

    fn load_instance_registry(
        &self,
        paths: &AppPaths,
        config: &AppConfig,
        storage: &StorageService,
    ) -> Result<InstanceRegistryDocument> {
        self.load_instance_registry_projected(paths, config, storage, None)
    }

    fn load_instance_registry_projected(
        &self,
        paths: &AppPaths,
        config: &AppConfig,
        storage: &StorageService,
        supervisor: Option<&SupervisorService>,
    ) -> Result<InstanceRegistryDocument> {
        let response = storage.get_text(
            paths,
            config,
            StorageGetTextRequest {
                profile_id: None,
                namespace: Some(INSTANCE_NAMESPACE.to_string()),
                key: INSTANCE_REGISTRY_KEY.to_string(),
            },
        )?;
        let mut document = response
            .value
            .as_deref()
            .map(serde_json::from_str::<InstanceRegistryDocument>)
            .transpose()?
            .unwrap_or_default();

        let builtin = build_built_in_instance(paths, config)?;
        let mut changed = upsert_built_in_instance(&mut document.instances, builtin);
        changed |= normalize_default_instance(&mut document.instances);

        if changed {
            self.write_instance_registry(paths, config, storage, &document)?;
        }

        if let Some(supervisor) = supervisor {
            project_built_in_instance_live_state(paths, &mut document.instances, supervisor)?;
        }

        Ok(document)
    }

    fn write_instance_registry(
        &self,
        paths: &AppPaths,
        config: &AppConfig,
        storage: &StorageService,
        document: &InstanceRegistryDocument,
    ) -> Result<()> {
        storage.put_text(
            paths,
            config,
            StoragePutTextRequest {
                profile_id: None,
                namespace: Some(INSTANCE_NAMESPACE.to_string()),
                key: INSTANCE_REGISTRY_KEY.to_string(),
                value: serde_json::to_string_pretty(document)?,
            },
        )?;
        Ok(())
    }

    fn read_conversation(
        &self,
        paths: &AppPaths,
        config: &AppConfig,
        storage: &StorageService,
        key: &str,
    ) -> Result<Option<StudioConversationRecord>> {
        let response = storage.get_text(
            paths,
            config,
            StorageGetTextRequest {
                profile_id: chat_storage_profile_id(),
                namespace: Some(CHAT_NAMESPACE.to_string()),
                key: key.to_string(),
            },
        )?;

        let stored_record = response
            .value
            .as_deref()
            .map(serde_json::from_str::<StudioConversationRecord>)
            .transpose()
            .map_err(FrameworkError::from)?;
        let Some(stored_record) = stored_record else {
            return Ok(None);
        };
        let sanitized_record = sanitize_studio_conversation_record(stored_record.clone());

        if sanitized_record != stored_record {
            storage.put_text(
                paths,
                config,
                StoragePutTextRequest {
                    profile_id: chat_storage_profile_id(),
                    namespace: Some(CHAT_NAMESPACE.to_string()),
                    key: key.to_string(),
                    value: serde_json::to_string_pretty(&sanitized_record)?,
                },
            )?;
        }

        Ok(Some(sanitized_record))
    }

    fn read_persisted_kernel_chat_agent(
        &self,
        paths: &AppPaths,
        config: &AppConfig,
        storage: &StorageService,
        key: &str,
    ) -> Result<Option<PersistedKernelChatAgentRecord>> {
        let response = storage.get_text(
            paths,
            config,
            StorageGetTextRequest {
                profile_id: chat_storage_profile_id(),
                namespace: Some(CHAT_NAMESPACE.to_string()),
                key: key.to_string(),
            },
        )?;

        response
            .value
            .as_deref()
            .map(serde_json::from_str::<PersistedKernelChatAgentRecord>)
            .transpose()
            .map_err(Into::into)
    }

    fn resolve_built_in_openclaw_instance(
        &self,
        paths: &AppPaths,
        config: &AppConfig,
        storage: &StorageService,
    ) -> Result<StudioInstanceRecord> {
        self.load_instance_registry(paths, config, storage)?
            .instances
            .into_iter()
            .find(is_built_in_openclaw_instance)
            .ok_or_else(|| FrameworkError::NotFound("built-in OpenClaw instance".to_string()))
    }

    fn sync_built_in_runtime_config(
        &self,
        paths: &AppPaths,
        config: &StudioInstanceConfig,
    ) -> Result<()> {
        let mut root = read_openclaw_config(paths)?;
        set_nested_u16(
            &mut root,
            &["gateway", "port"],
            config.port.parse::<u16>().unwrap_or(DEFAULT_GATEWAY_PORT),
        );
        set_nested_string(
            &mut root,
            &["studio", "logLevel"],
            config.log_level.as_str(),
        );
        set_nested_string(
            &mut root,
            &["studio", "corsOrigins"],
            config.cors_origins.as_str(),
        );
        set_nested_bool(&mut root, &["studio", "sandbox"], config.sandbox);
        set_nested_bool(&mut root, &["studio", "autoUpdate"], config.auto_update);
        set_nested_string(&mut root, &["gateway", "auth", "mode"], "token");
        if let Some(auth_token) = config.auth_token.as_deref() {
            set_nested_string(&mut root, &["gateway", "auth", "token"], auth_token);
        }
        ensure_built_in_openclaw_standard_agent_paths(&mut root, paths);

        write_openclaw_config_file(paths, &root)?;
        Ok(())
    }

    fn require_built_in_openclaw_instance(
        &self,
        paths: &AppPaths,
        config: &AppConfig,
        storage: &StorageService,
        instance_id: &str,
    ) -> Result<StudioInstanceRecord> {
        let instance = self
            .get_instance(paths, config, storage, instance_id)?
            .ok_or_else(|| FrameworkError::NotFound(format!("instance \"{instance_id}\"")))?;

        if !is_built_in_openclaw_instance(&instance) {
            return Err(FrameworkError::Conflict(
                "runtime-backed OpenClaw workspace operations are only available for the built-in OpenClaw instance"
                    .to_string(),
            ));
        }

        Ok(instance)
    }

    fn require_built_in_openclaw_task_instance(
        &self,
        paths: &AppPaths,
        config: &AppConfig,
        storage: &StorageService,
        instance_id: &str,
    ) -> Result<StudioInstanceRecord> {
        self.require_built_in_openclaw_instance(paths, config, storage, instance_id)
            .map_err(|error| match error {
                FrameworkError::Conflict(_) => FrameworkError::Conflict(
                    "runtime-backed task operations are only available for the built-in OpenClaw instance"
                        .to_string(),
                ),
                other => other,
            })
    }
}

fn build_health_snapshot(
    instance: &StudioInstanceRecord,
    storage: &StudioInstanceStorageSnapshot,
    connectivity: &StudioInstanceConnectivitySnapshot,
    observability: &StudioInstanceObservabilitySnapshot,
) -> Result<StudioInstanceHealthSnapshot> {
    let runtime_status = health_status_for_instance(instance);
    let endpoint_ready = connectivity
        .endpoints
        .iter()
        .any(|endpoint| endpoint.status == StudioInstanceEndpointStatus::Ready);
    let storage_ready = storage.status == StudioInstanceStorageStatus::Ready;
    let logs_ready = observability.log_available;
    let baseline = match runtime_status {
        StudioInstanceHealthStatus::Healthy => 88,
        StudioInstanceHealthStatus::Attention => 62,
        StudioInstanceHealthStatus::Offline => 30,
        StudioInstanceHealthStatus::Degraded => 18,
    };
    let mut score = baseline - (instance.cpu as i32 / 4) - (instance.memory as i32 / 5);
    if endpoint_ready {
        score += 6;
    }
    if storage_ready {
        score += 6;
    }
    if logs_ready {
        score += 4;
    }
    let score = score.clamp(0, 100) as u8;

    let checks = vec![
        StudioInstanceHealthCheck {
            id: "runtime-status".to_string(),
            label: "Runtime status".to_string(),
            status: runtime_status.clone(),
            detail: format!("Instance is {:?}.", instance.status),
        },
        StudioInstanceHealthCheck {
            id: "connectivity".to_string(),
            label: "Connectivity".to_string(),
            status: if endpoint_ready {
                StudioInstanceHealthStatus::Healthy
            } else if instance.status == StudioInstanceStatus::Offline {
                StudioInstanceHealthStatus::Offline
            } else {
                StudioInstanceHealthStatus::Attention
            },
            detail: if endpoint_ready {
                "Endpoint metadata is configured.".to_string()
            } else {
                "No reachable endpoint metadata is configured.".to_string()
            },
        },
        StudioInstanceHealthCheck {
            id: "storage".to_string(),
            label: "Storage".to_string(),
            status: match storage.status {
                StudioInstanceStorageStatus::Ready => StudioInstanceHealthStatus::Healthy,
                StudioInstanceStorageStatus::ConfigurationRequired => {
                    StudioInstanceHealthStatus::Attention
                }
                StudioInstanceStorageStatus::Planned => StudioInstanceHealthStatus::Attention,
                StudioInstanceStorageStatus::Unavailable => StudioInstanceHealthStatus::Degraded,
            },
            detail: format!("Storage provider is {:?}.", storage.provider),
        },
        StudioInstanceHealthCheck {
            id: "observability".to_string(),
            label: "Observability".to_string(),
            status: match observability.status {
                StudioInstanceObservabilityStatus::Ready => StudioInstanceHealthStatus::Healthy,
                StudioInstanceObservabilityStatus::Limited => StudioInstanceHealthStatus::Attention,
                StudioInstanceObservabilityStatus::Unavailable => {
                    StudioInstanceHealthStatus::Degraded
                }
            },
            detail: if observability.log_available {
                "Logs are available for inspection.".to_string()
            } else {
                "No logs are currently available.".to_string()
            },
        },
    ];

    Ok(StudioInstanceHealthSnapshot {
        score,
        status: if instance.status == StudioInstanceStatus::Offline {
            StudioInstanceHealthStatus::Offline
        } else if score >= 80 {
            StudioInstanceHealthStatus::Healthy
        } else if score >= 55 {
            StudioInstanceHealthStatus::Attention
        } else {
            StudioInstanceHealthStatus::Degraded
        },
        checks,
        evaluated_at: unix_timestamp_ms()?,
    })
}

fn health_status_for_instance(instance: &StudioInstanceRecord) -> StudioInstanceHealthStatus {
    match instance.status {
        StudioInstanceStatus::Online => StudioInstanceHealthStatus::Healthy,
        StudioInstanceStatus::Starting | StudioInstanceStatus::Syncing => {
            StudioInstanceHealthStatus::Attention
        }
        StudioInstanceStatus::Offline => StudioInstanceHealthStatus::Offline,
        StudioInstanceStatus::Error => StudioInstanceHealthStatus::Degraded,
    }
}

fn build_lifecycle_snapshot(
    paths: &AppPaths,
    instance: &StudioInstanceRecord,
    supervisor: Option<&SupervisorService>,
) -> Result<StudioInstanceLifecycleSnapshot> {
    let built_in_openclaw = uses_built_in_openclaw_config(instance);
    let managed_hermes = is_managed_hermes_instance(instance);
    let mut snapshot = if built_in_openclaw {
        StudioInstanceLifecycleSnapshot {
            owner: StudioInstanceLifecycleOwner::AppManaged,
            start_stop_supported: true,
            config_writable: true,
            lifecycle_controllable: true,
            workbench_managed: true,
            endpoint_observed: true,
            last_activation_stage: None,
            last_error: None,
            notes: vec!["Lifecycle is managed by Agent Studio.".to_string()],
        }
    } else if managed_hermes {
        StudioInstanceLifecycleSnapshot {
            owner: StudioInstanceLifecycleOwner::AppManaged,
            start_stop_supported: false,
            config_writable: true,
            lifecycle_controllable: false,
            workbench_managed: false,
            endpoint_observed: false,
            last_activation_stage: None,
            last_error: None,
            notes: vec![
                "Hermes kernel state is managed by Agent Studio under the user-root kernel layout."
                    .to_string(),
                "Hermes runtime lifecycle control is not wired to a desktop supervisor yet."
                    .to_string(),
            ],
        }
    } else {
        match instance.deployment_mode {
            StudioInstanceDeploymentMode::LocalManaged => StudioInstanceLifecycleSnapshot {
                owner: StudioInstanceLifecycleOwner::ExternalProcess,
                start_stop_supported: false,
                config_writable: false,
                lifecycle_controllable: false,
                workbench_managed: false,
                endpoint_observed: false,
                last_activation_stage: None,
                last_error: None,
                notes: vec![
                "This local-managed runtime is not bound to the built-in Agent Studio controller."
                    .to_string(),
            ],
            },
            StudioInstanceDeploymentMode::LocalExternal => StudioInstanceLifecycleSnapshot {
                owner: StudioInstanceLifecycleOwner::ExternalProcess,
                start_stop_supported: false,
                config_writable: true,
                lifecycle_controllable: false,
                workbench_managed: false,
                endpoint_observed: false,
                last_activation_stage: None,
                last_error: None,
                notes: vec!["Lifecycle is owned by an external local process.".to_string()],
            },
            StudioInstanceDeploymentMode::Remote => StudioInstanceLifecycleSnapshot {
                owner: StudioInstanceLifecycleOwner::RemoteService,
                start_stop_supported: false,
                config_writable: false,
                lifecycle_controllable: false,
                workbench_managed: false,
                endpoint_observed: false,
                last_activation_stage: None,
                last_error: None,
                notes: vec!["Lifecycle is owned by a remote deployment.".to_string()],
            },
        }
    };

    if built_in_openclaw {
        let last_bundled_openclaw_activation =
            read_last_bundled_openclaw_activation_stage(paths.main_log_file.as_path());
        if let Some((stage, _)) = last_bundled_openclaw_activation.as_ref() {
            snapshot.last_activation_stage = Some(stage.clone());
        }
        if let Some(supervisor) = supervisor {
            if let Some(last_error) = built_in_openclaw_last_error(supervisor)? {
                snapshot.last_error = Some(last_error.clone());
                snapshot
                    .notes
                    .push(format!("Last built-in OpenClaw start error: {last_error}"));
                if let Some((_, detail_stage_label)) = last_bundled_openclaw_activation.as_ref() {
                    snapshot.notes.push(format!(
                        "Last built-in OpenClaw activation detail stage: {detail_stage_label}"
                    ));
                }
            }
        }
    }

    Ok(snapshot)
}

fn read_last_bundled_openclaw_activation_stage(
    main_log_file: &Path,
) -> Option<(StudioInstanceActivationStage, &'static str)> {
    const STAGE_PREFIX: &str = "bundled openclaw activation stage:";
    let content = fs::read_to_string(main_log_file).ok()?;

    for line in content.lines().rev() {
        let Some((_, stage_marker)) = line.split_once(STAGE_PREFIX) else {
            continue;
        };

        let stage = match stage_marker.trim() {
            "prepare-runtime-activation" => (
                StudioInstanceActivationStage::PrepareInstall,
                "Prepare Runtime Activation",
            ),
            "bundled-runtime-ready" => (
                StudioInstanceActivationStage::ActivateInstall,
                "Bundled Runtime Ready",
            ),
            "gateway-configured" => (
                StudioInstanceActivationStage::PrepareConfig,
                "Gateway Configured",
            ),
            "local-ai-proxy-ready" => (
                StudioInstanceActivationStage::StartProcess,
                "Local AI Proxy Ready",
            ),
            "desktop-kernel-running" => (
                StudioInstanceActivationStage::VerifyEndpoint,
                "Desktop Kernel Running",
            ),
            "built-in-instance-online" => (
                StudioInstanceActivationStage::Ready,
                "Built-In Instance Online",
            ),
            _ => continue,
        };

        return Some(stage);
    }

    None
}

fn build_storage_snapshot_for_instance(
    instance: &StudioInstanceRecord,
) -> StudioInstanceStorageSnapshot {
    let (durable, queryable, transactional, remote) =
        storage_capabilities_for_provider(&instance.storage.provider);

    StudioInstanceStorageSnapshot {
        status: storage_status_for_binding(&instance.storage),
        profile_id: instance.storage.profile_id.clone(),
        provider: instance.storage.provider.clone(),
        namespace: instance.storage.namespace.clone(),
        database: instance.storage.database.clone(),
        connection_hint: instance.storage.connection_hint.clone(),
        endpoint: instance.storage.endpoint.clone(),
        durable,
        queryable,
        transactional,
        remote,
    }
}

fn storage_status_for_binding(binding: &StudioStorageBinding) -> StudioInstanceStorageStatus {
    match binding.provider {
        StorageProviderKind::Memory | StorageProviderKind::LocalFile => {
            StudioInstanceStorageStatus::Ready
        }
        StorageProviderKind::Sqlite => {
            if binding.namespace.trim().is_empty() {
                StudioInstanceStorageStatus::ConfigurationRequired
            } else {
                StudioInstanceStorageStatus::Ready
            }
        }
        StorageProviderKind::Postgres => {
            if binding.connection_hint.is_some() {
                StudioInstanceStorageStatus::Ready
            } else {
                StudioInstanceStorageStatus::ConfigurationRequired
            }
        }
        StorageProviderKind::RemoteApi => {
            if binding.endpoint.is_some() {
                StudioInstanceStorageStatus::Planned
            } else {
                StudioInstanceStorageStatus::ConfigurationRequired
            }
        }
    }
}

fn storage_capabilities_for_provider(kind: &StorageProviderKind) -> (bool, bool, bool, bool) {
    match kind {
        StorageProviderKind::Memory => (false, true, false, false),
        StorageProviderKind::LocalFile => (true, false, false, false),
        StorageProviderKind::Sqlite => (true, true, true, false),
        StorageProviderKind::Postgres => (true, true, true, true),
        StorageProviderKind::RemoteApi => (true, true, false, true),
    }
}

fn build_connectivity_snapshot(
    instance: &StudioInstanceRecord,
    root: Option<&Value>,
) -> StudioInstanceConnectivitySnapshot {
    let mut endpoints = Vec::new();

    if let Some(base_url) = instance.base_url.as_deref() {
        endpoints.push(connectivity_endpoint(
            instance,
            "gateway-http",
            "HTTP endpoint",
            StudioInstanceEndpointKind::Http,
            Some(base_url.to_string()),
            StudioInstanceEndpointSource::Config,
        ));
    }

    if let Some(websocket_url) = instance.websocket_url.as_deref() {
        endpoints.push(connectivity_endpoint(
            instance,
            "gateway-ws",
            "Gateway WebSocket",
            StudioInstanceEndpointKind::Websocket,
            Some(websocket_url.to_string()),
            StudioInstanceEndpointSource::Config,
        ));
    }

    if let Some(base_url) = instance.base_url.as_deref() {
        match instance.runtime_kind {
            StudioRuntimeKind::Openclaw => {
                let chat_completions_enabled = root
                    .and_then(|value| {
                        get_nested_bool(
                            value,
                            &["gateway", "http", "endpoints", "chatCompletions", "enabled"],
                        )
                    })
                    .unwrap_or(root.is_none());
                if chat_completions_enabled {
                    endpoints.push(connectivity_endpoint(
                        instance,
                        "openai-http-chat",
                        "OpenAI Chat Completions",
                        StudioInstanceEndpointKind::OpenaiChatCompletions,
                        Some(format!(
                            "{}/v1/chat/completions",
                            base_url.trim_end_matches('/')
                        )),
                        StudioInstanceEndpointSource::Derived,
                    ));
                }
                let responses_enabled = root
                    .and_then(|value| {
                        get_nested_bool(
                            value,
                            &["gateway", "http", "endpoints", "responses", "enabled"],
                        )
                    })
                    .unwrap_or(false);
                if responses_enabled {
                    endpoints.push(connectivity_endpoint(
                        instance,
                        "openai-http-responses",
                        "OpenAI Responses",
                        StudioInstanceEndpointKind::OpenaiResponses,
                        Some(format!("{}/v1/responses", base_url.trim_end_matches('/'))),
                        StudioInstanceEndpointSource::Derived,
                    ));
                }
            }
            StudioRuntimeKind::Hermes => {}
            StudioRuntimeKind::Zeroclaw => endpoints.push(connectivity_endpoint(
                instance,
                "dashboard",
                "Gateway Dashboard",
                StudioInstanceEndpointKind::Dashboard,
                Some(base_url.to_string()),
                StudioInstanceEndpointSource::Derived,
            )),
            StudioRuntimeKind::Ironclaw => endpoints.push(connectivity_endpoint(
                instance,
                "gateway-sse",
                "Realtime Gateway",
                StudioInstanceEndpointKind::Sse,
                Some(base_url.to_string()),
                StudioInstanceEndpointSource::Derived,
            )),
            StudioRuntimeKind::Custom | StudioRuntimeKind::Other(_) => {}
        }
    }

    StudioInstanceConnectivitySnapshot {
        primary_transport: instance.transport_kind.clone(),
        endpoints,
    }
}

fn connectivity_endpoint(
    instance: &StudioInstanceRecord,
    id: &str,
    label: &str,
    kind: StudioInstanceEndpointKind,
    url: Option<String>,
    source: StudioInstanceEndpointSource,
) -> StudioInstanceConnectivityEndpoint {
    StudioInstanceConnectivityEndpoint {
        id: id.to_string(),
        label: label.to_string(),
        kind,
        status: if url.is_some() {
            StudioInstanceEndpointStatus::Ready
        } else {
            StudioInstanceEndpointStatus::ConfigurationRequired
        },
        url,
        exposure: endpoint_exposure_for_instance(instance),
        auth: endpoint_auth_for_instance(instance),
        source,
    }
}

fn endpoint_exposure_for_instance(instance: &StudioInstanceRecord) -> StudioInstanceExposure {
    if instance.deployment_mode == StudioInstanceDeploymentMode::Remote {
        return StudioInstanceExposure::Remote;
    }

    if is_loopback_host(&instance.host) {
        StudioInstanceExposure::Loopback
    } else {
        StudioInstanceExposure::Private
    }
}

fn endpoint_auth_for_instance(instance: &StudioInstanceRecord) -> StudioInstanceAuthMode {
    if instance.config.auth_token.is_some() {
        StudioInstanceAuthMode::Token
    } else if instance.deployment_mode == StudioInstanceDeploymentMode::Remote {
        StudioInstanceAuthMode::External
    } else {
        StudioInstanceAuthMode::Unknown
    }
}

#[derive(Clone, Debug)]
struct ResolvedOpenClawConsoleAuth {
    mode: StudioInstanceConsoleAuthMode,
    token: Option<String>,
    source: Option<StudioInstanceConsoleAuthSource>,
    reason: Option<String>,
}

fn build_console_access(
    paths: &AppPaths,
    instance: &StudioInstanceRecord,
) -> Result<Option<StudioInstanceConsoleAccessRecord>> {
    if instance.runtime_kind != StudioRuntimeKind::Openclaw {
        return Ok(None);
    }

    if uses_built_in_openclaw_config(instance) {
        let root = read_openclaw_config(paths)?;
        return Ok(Some(build_openclaw_console_access(
            instance,
            Some(&root),
            Some(StudioInstanceConsoleAuthSource::ConfigFile),
            Some(StudioInstanceConsoleInstallMethod::Bundled),
            None,
        )));
    }

    if instance.deployment_mode == StudioInstanceDeploymentMode::LocalExternal {
        return Ok(Some(build_local_external_openclaw_console_access(
            paths, instance,
        )?));
    }

    Ok(Some(build_openclaw_console_access(
        instance,
        None,
        Some(StudioInstanceConsoleAuthSource::WorkspaceConfig),
        Some(StudioInstanceConsoleInstallMethod::Unknown),
        Some(
            "Automatic OpenClaw console authorization is only enabled for locally resolved literal tokens."
                .to_string(),
        ),
    )))
}

fn build_local_external_openclaw_console_access(
    paths: &AppPaths,
    instance: &StudioInstanceRecord,
) -> Result<StudioInstanceConsoleAccessRecord> {
    let install_record = resolve_local_external_openclaw_install_record(paths, instance)?;
    let install_method = install_record
        .as_ref()
        .map(|(_, record)| console_install_method_from_install_record(record))
        .unwrap_or(StudioInstanceConsoleInstallMethod::Unknown);

    if install_record.is_some() {
        if let Some(config_path) = discover_openclaw_config_path(paths, &install_method) {
            let root = read_json5_object(&config_path)?;
            return Ok(build_openclaw_console_access(
                instance,
                Some(&root),
                Some(StudioInstanceConsoleAuthSource::InstallRecord),
                Some(install_method),
                None,
            ));
        }
    }

    Ok(build_openclaw_console_access(
        instance,
        None,
        Some(StudioInstanceConsoleAuthSource::WorkspaceConfig),
        Some(install_method.clone()),
        Some(missing_openclaw_console_config_reason(&install_method)),
    ))
}

fn build_openclaw_console_access(
    instance: &StudioInstanceRecord,
    root: Option<&Value>,
    default_auth_source: Option<StudioInstanceConsoleAuthSource>,
    install_method: Option<StudioInstanceConsoleInstallMethod>,
    fallback_reason: Option<String>,
) -> StudioInstanceConsoleAccessRecord {
    let url = build_openclaw_control_ui_url(instance, root);
    let gateway_url = build_openclaw_gateway_ws_url(instance, root);
    let auth = resolve_openclaw_console_auth(instance, root, default_auth_source);
    let runtime_available = instance.status == StudioInstanceStatus::Online;
    let loopback_target = gateway_url
        .as_deref()
        .and_then(url_host)
        .map(|host| is_loopback_host(&host))
        .unwrap_or_else(|| is_loopback_host(&instance.host));
    let auto_login_url = if let (
        Some(url),
        Some(gateway_url),
        StudioInstanceConsoleAuthMode::Token,
        Some(token),
    ) = (
        url.as_ref(),
        gateway_url.as_ref(),
        auth.mode.clone(),
        auth.token.clone(),
    ) {
        if runtime_available && loopback_target {
            Some(format!(
                "{url}?gatewayUrl={}#token={}",
                percent_encode_url_component(gateway_url),
                percent_encode_url_component(&token)
            ))
        } else {
            None
        }
    } else {
        None
    };

    let reason = if !runtime_available {
        Some(match instance.deployment_mode {
            StudioInstanceDeploymentMode::LocalManaged
                if uses_built_in_openclaw_config(instance) =>
            {
                "Built-in OpenClaw gateway is not running yet.".to_string()
            }
            StudioInstanceDeploymentMode::LocalExternal => {
                "Local external OpenClaw runtime is offline; start the external process before opening the console."
                    .to_string()
            }
            StudioInstanceDeploymentMode::Remote => {
                "Remote OpenClaw runtime is offline or unreachable; reconnect the instance before opening the console."
                    .to_string()
            }
            StudioInstanceDeploymentMode::LocalManaged => {
                "OpenClaw runtime is offline; start the instance before opening the console."
                    .to_string()
            }
        })
    } else if url.is_none() {
        Some(fallback_reason.unwrap_or_else(|| {
            "No OpenClaw Control UI endpoint is configured for this instance.".to_string()
        }))
    } else if auto_login_url.is_none() {
        auth.reason.or_else(|| {
            if matches!(auth.mode, StudioInstanceConsoleAuthMode::Token) && !loopback_target {
                Some(
                    "Remote OpenClaw consoles require device pairing or manual authorization."
                        .to_string(),
                )
            } else {
                fallback_reason
            }
        })
    } else {
        None
    };

    StudioInstanceConsoleAccessRecord {
        kind: StudioInstanceConsoleKind::OpenclawControlUi,
        available: runtime_available && url.is_some(),
        url,
        auto_login_url,
        gateway_url,
        auth_mode: auth.mode,
        auth_source: auth.source,
        install_method,
        reason,
    }
}

fn resolve_openclaw_console_auth(
    instance: &StudioInstanceRecord,
    root: Option<&Value>,
    default_auth_source: Option<StudioInstanceConsoleAuthSource>,
) -> ResolvedOpenClawConsoleAuth {
    let explicit_mode = root
        .and_then(|value| get_nested_string(value, &["gateway", "auth", "mode"]))
        .map(|value| value.trim().to_ascii_lowercase());
    let config_token = root
        .and_then(|value| get_nested_string(value, &["gateway", "auth", "token"]))
        .filter(|value| !value.trim().is_empty());
    let metadata_token = instance
        .config
        .auth_token
        .clone()
        .filter(|value| !value.trim().is_empty());
    let token = config_token.clone().or(metadata_token.clone());
    let token_is_secret_ref = token
        .as_deref()
        .map(token_looks_secret_ref)
        .unwrap_or(false);
    let mode = match explicit_mode.as_deref() {
        Some("token") => StudioInstanceConsoleAuthMode::Token,
        Some("password") => StudioInstanceConsoleAuthMode::Password,
        Some("none") => StudioInstanceConsoleAuthMode::None,
        Some("external") => StudioInstanceConsoleAuthMode::External,
        Some(_) => StudioInstanceConsoleAuthMode::Unknown,
        None if token.is_some() => StudioInstanceConsoleAuthMode::Token,
        None if instance.deployment_mode == StudioInstanceDeploymentMode::Remote => {
            StudioInstanceConsoleAuthMode::External
        }
        None => StudioInstanceConsoleAuthMode::Unknown,
    };
    let source = match token.as_ref() {
        Some(_) if token_is_secret_ref => Some(StudioInstanceConsoleAuthSource::SecretRef),
        Some(_) if config_token.is_some() => default_auth_source.clone(),
        Some(_) if metadata_token.is_some() => {
            Some(StudioInstanceConsoleAuthSource::WorkspaceConfig)
        }
        Some(_) => default_auth_source
            .clone()
            .or(Some(StudioInstanceConsoleAuthSource::WorkspaceConfig)),
        None if mode == StudioInstanceConsoleAuthMode::Token => {
            Some(StudioInstanceConsoleAuthSource::Unresolved)
        }
        None => None,
    };
    let reason = match mode {
        StudioInstanceConsoleAuthMode::Token if token.is_none() => Some(
            "OpenClaw token authentication is configured, but the token could not be resolved locally."
                .to_string(),
        ),
        StudioInstanceConsoleAuthMode::Token if token_is_secret_ref => Some(
            "This OpenClaw token is secret-managed; open the console and complete authorization manually."
                .to_string(),
        ),
        StudioInstanceConsoleAuthMode::Password => Some(
            "This OpenClaw console uses password authentication and requires manual sign-in."
                .to_string(),
        ),
        StudioInstanceConsoleAuthMode::External => Some(
            "This OpenClaw console relies on external authentication and must be opened manually."
                .to_string(),
        ),
        StudioInstanceConsoleAuthMode::Unknown => Some(
            "Agent Studio could not determine the OpenClaw console authentication mode."
                .to_string(),
        ),
        _ => None,
    };

    ResolvedOpenClawConsoleAuth {
        mode,
        token: if token_is_secret_ref { None } else { token },
        source,
        reason,
    }
}

fn build_openclaw_control_ui_url(
    instance: &StudioInstanceRecord,
    root: Option<&Value>,
) -> Option<String> {
    let base_path = resolved_openclaw_control_ui_base_path(instance, root);

    if let Some(base_url) = instance.base_url.as_deref() {
        if let Some(origin) = url_origin(base_url) {
            return Some(format!("{}{}", origin.trim_end_matches('/'), base_path));
        }
        return Some(format!("{}{}", base_url.trim_end_matches('/'), base_path));
    }

    let port = resolved_openclaw_gateway_port(instance, root)?;
    Some(format!(
        "http://{}:{port}{}",
        normalized_instance_host(instance),
        base_path
    ))
}

fn build_openclaw_gateway_ws_url(
    instance: &StudioInstanceRecord,
    root: Option<&Value>,
) -> Option<String> {
    let gateway_path = resolved_openclaw_control_ui_gateway_path(
        root,
        instance.base_url.as_deref(),
        instance.websocket_url.as_deref(),
    );

    if let Some(websocket_url) = instance.websocket_url.as_deref() {
        if let Some(origin) = url_origin(websocket_url) {
            return Some(format!("{origin}{gateway_path}"));
        }
        return Some(websocket_url.trim_end_matches('/').to_string());
    }

    if let Some(base_url) = instance.base_url.as_deref() {
        if let Some(origin) = url_origin(base_url) {
            return Some(format!(
                "{}{}",
                http_origin_to_ws_origin(&origin),
                gateway_path
            ));
        }
    }

    let port = resolved_openclaw_gateway_port(instance, root)?;
    Some(format!(
        "ws://{}:{port}{}",
        normalized_instance_host(instance),
        gateway_path
    ))
}

fn resolved_openclaw_gateway_port(
    instance: &StudioInstanceRecord,
    root: Option<&Value>,
) -> Option<u16> {
    root.and_then(|value| get_nested_u16(value, &["gateway", "port"]))
        .or(instance.port)
        .or_else(|| {
            instance
                .config
                .port
                .parse::<u16>()
                .ok()
                .filter(|value| *value > 0)
        })
}

fn normalize_control_ui_base_path(value: Option<&str>) -> String {
    let trimmed = value.unwrap_or("/").trim();
    if trimmed.is_empty() || trimmed == "/" {
        return "/".to_string();
    }

    format!("/{}/", trimmed.trim_matches('/'))
}

fn resolved_openclaw_control_ui_base_path(
    instance: &StudioInstanceRecord,
    root: Option<&Value>,
) -> String {
    resolved_openclaw_control_ui_base_path_for_sources(
        root,
        instance.base_url.as_deref(),
        instance.websocket_url.as_deref(),
    )
}

fn resolved_openclaw_control_ui_base_path_for_sources(
    root: Option<&Value>,
    base_url: Option<&str>,
    websocket_url: Option<&str>,
) -> String {
    let configured_or_inferred = root
        .and_then(|value| get_nested_string(value, &["gateway", "controlUi", "basePath"]))
        .or_else(|| base_url.and_then(url_path))
        .or_else(|| websocket_url.and_then(url_path));

    normalize_control_ui_base_path(configured_or_inferred.as_deref())
}

fn normalize_control_ui_gateway_path(base_path: &str) -> String {
    if base_path == "/" {
        String::new()
    } else {
        base_path.trim_end_matches('/').to_string()
    }
}

fn resolved_openclaw_control_ui_gateway_path(
    root: Option<&Value>,
    base_url: Option<&str>,
    websocket_url: Option<&str>,
) -> String {
    let base_path =
        resolved_openclaw_control_ui_base_path_for_sources(root, base_url, websocket_url);
    normalize_control_ui_gateway_path(&base_path)
}

fn normalized_instance_host(instance: &StudioInstanceRecord) -> &str {
    let trimmed = instance.host.trim();
    if trimmed.is_empty() {
        "127.0.0.1"
    } else {
        trimmed
    }
}

fn http_origin_to_ws_origin(origin: &str) -> String {
    if let Some(rest) = origin.strip_prefix("https://") {
        return format!("wss://{rest}");
    }
    if let Some(rest) = origin.strip_prefix("http://") {
        return format!("ws://{rest}");
    }
    origin.to_string()
}

fn url_origin(value: &str) -> Option<String> {
    let (scheme, rest) = value.split_once("://")?;
    let authority = rest.split('/').next().unwrap_or(rest).trim();
    if authority.is_empty() {
        return None;
    }
    Some(format!("{scheme}://{authority}"))
}

fn url_path(value: &str) -> Option<String> {
    let (_, rest) = value.split_once("://")?;
    let (_, path_and_more) = rest.split_once('/')?;
    let path = format!(
        "/{}",
        path_and_more.split(['?', '#']).next().unwrap_or_default()
    );
    let trimmed = path.trim();
    if trimmed.is_empty() {
        return None;
    }
    Some(trimmed.to_string())
}

fn url_host(value: &str) -> Option<String> {
    let authority = value.split_once("://")?.1.split('/').next()?.trim();
    let host_port = authority.rsplit('@').next().unwrap_or(authority);
    if host_port.starts_with('[') {
        let (host, _) = host_port.split_once(']')?;
        return Some(host.trim_start_matches('[').to_string());
    }
    Some(host_port.split(':').next().unwrap_or(host_port).to_string())
}

fn is_loopback_host(value: &str) -> bool {
    let normalized = value.trim().trim_matches(['[', ']']).to_ascii_lowercase();
    normalized == "127.0.0.1"
        || normalized == "::1"
        || normalized == "localhost"
        || normalized.ends_with(".localhost")
}

fn percent_encode_url_component(value: &str) -> String {
    let mut encoded = String::new();
    for byte in value.as_bytes() {
        if byte.is_ascii_alphanumeric() || matches!(*byte, b'-' | b'.' | b'_' | b'~') {
            encoded.push(*byte as char);
        } else {
            encoded.push_str(&format!("%{:02X}", byte));
        }
    }
    encoded
}

fn token_looks_secret_ref(value: &str) -> bool {
    let normalized = value.trim().to_ascii_lowercase();
    normalized.contains("secretref")
        || normalized.starts_with("secret:")
        || normalized.starts_with("secret://")
        || normalized.starts_with("${")
        || normalized.starts_with("{{")
        || normalized.starts_with("env:")
}

fn resolve_local_external_openclaw_install_record(
    paths: &AppPaths,
    instance: &StudioInstanceRecord,
) -> Result<Option<(PathBuf, InstallRecord)>> {
    let mut records = read_installed_openclaw_install_records(paths)?;
    if records.is_empty() {
        return Ok(None);
    }

    let instance_workspace = normalized_path_key(instance.config.workspace_path.as_deref());
    if let Some(expected_workspace) = instance_workspace.as_deref() {
        if let Some(index) = records.iter().position(|(_, record)| {
            [
                Some(record.work_root.as_str()),
                Some(record.install_root.as_str()),
                Some(record.data_root.as_str()),
            ]
            .into_iter()
            .filter_map(normalized_path_key)
            .any(|candidate| candidate == expected_workspace)
        }) {
            return Ok(Some(records.remove(index)));
        }
    }

    Ok(records.into_iter().next())
}

fn read_installed_openclaw_install_records(
    paths: &AppPaths,
) -> Result<Vec<(PathBuf, InstallRecord)>> {
    let mut records = Vec::new();

    for installer_home in resolve_openclaw_install_records_home_candidates(&paths.user_root) {
        let records_dir = installer_home.join("state").join("install-records");
        if !records_dir.is_dir() {
            continue;
        }

        for entry in fs::read_dir(&records_dir).map_err(|error| {
            FrameworkError::Internal(format!("failed to read OpenClaw install records: {error}"))
        })? {
            let entry = entry.map_err(|error| {
                FrameworkError::Internal(format!(
                    "failed to read OpenClaw install record entry: {error}"
                ))
            })?;
            let file_type = entry.file_type().map_err(|error| {
                FrameworkError::Internal(format!(
                    "failed to inspect OpenClaw install record entry: {error}"
                ))
            })?;
            if !file_type.is_file() {
                continue;
            }

            let file_name = entry.file_name();
            let file_name = file_name.to_string_lossy().to_ascii_lowercase();
            if !file_name.starts_with(OPENCLAW_INSTALLER_SOFTWARE_NAME)
                || !file_name.ends_with(".json")
            {
                continue;
            }

            let content = fs::read_to_string(entry.path()).map_err(|error| {
                FrameworkError::Internal(format!(
                    "failed to read OpenClaw install record file: {error}"
                ))
            })?;
            let record: InstallRecord = serde_json::from_str(&content).map_err(|error| {
                FrameworkError::Internal(format!(
                    "failed to parse OpenClaw install record file: {error}"
                ))
            })?;
            if record.status == InstallRecordStatus::Installed
                && is_openclaw_family_software_name(&record.software_name)
            {
                records.push((installer_home.clone(), record));
            }
        }
    }

    records.sort_by(|(left_home, left_record), (right_home, right_record)| {
        right_record
            .updated_at
            .cmp(&left_record.updated_at)
            .then_with(|| right_record.installed_at.cmp(&left_record.installed_at))
            .then_with(|| {
                openclaw_install_records_home_rank(left_home)
                    .cmp(&openclaw_install_records_home_rank(right_home))
            })
            .then_with(|| left_record.software_name.cmp(&right_record.software_name))
    });
    Ok(records)
}

fn openclaw_install_records_home_rank(installer_home: &Path) -> u8 {
    match installer_home.file_name().and_then(|value| value.to_str()) {
        Some(OPENCLAW_INSTALL_RECORDS_HOME_NAME) => 0,
        _ => u8::MAX,
    }
}

fn is_openclaw_family_software_name(software_name: &str) -> bool {
    let normalized = software_name.trim().to_ascii_lowercase();
    normalized == OPENCLAW_INSTALLER_SOFTWARE_NAME
        || normalized == "openclaw-all"
        || normalized.starts_with("openclaw-")
}

fn normalized_path_key(value: Option<&str>) -> Option<String> {
    let normalized = value?.trim().replace('\\', "/");
    let normalized = normalized.trim_end_matches('/').to_string();
    if normalized.is_empty() {
        None
    } else {
        Some(normalized)
    }
}

fn console_install_method_from_install_record(
    record: &InstallRecord,
) -> StudioInstanceConsoleInstallMethod {
    let manifest_profile = Path::new(&record.manifest_path)
        .file_name()
        .and_then(|value| value.to_str())
        .map(|value| {
            value
                .trim_end_matches(".hub.yaml")
                .trim_end_matches(".yaml")
        });

    console_install_method_from_profile_key(&record.software_name)
        .or_else(|| manifest_profile.and_then(console_install_method_from_profile_key))
        .unwrap_or_else(|| console_install_method_from_manifest_name(&record.manifest_name))
}

fn console_install_method_from_profile_key(
    profile_key: &str,
) -> Option<StudioInstanceConsoleInstallMethod> {
    match profile_key.trim().to_ascii_lowercase().as_str() {
        "openclaw-npm" => Some(StudioInstanceConsoleInstallMethod::Npm),
        "openclaw-pnpm" => Some(StudioInstanceConsoleInstallMethod::Pnpm),
        "openclaw-source" => Some(StudioInstanceConsoleInstallMethod::Source),
        "openclaw-wsl" => Some(StudioInstanceConsoleInstallMethod::Wsl),
        "openclaw-docker" => Some(StudioInstanceConsoleInstallMethod::Docker),
        "openclaw-podman" => Some(StudioInstanceConsoleInstallMethod::Podman),
        "openclaw-ansible" => Some(StudioInstanceConsoleInstallMethod::Ansible),
        "openclaw-git" | "openclaw-installer-script-git" => {
            Some(StudioInstanceConsoleInstallMethod::Git)
        }
        "openclaw-cli-script" | "openclaw-installer-cli-script" => {
            Some(StudioInstanceConsoleInstallMethod::CliScript)
        }
        "openclaw-bun" => Some(StudioInstanceConsoleInstallMethod::Bun),
        "openclaw-nix" => Some(StudioInstanceConsoleInstallMethod::Nix),
        "openclaw" | "openclaw-all" => Some(StudioInstanceConsoleInstallMethod::InstallerScript),
        _ => None,
    }
}

fn console_install_method_from_manifest_name(
    manifest_name: &str,
) -> StudioInstanceConsoleInstallMethod {
    let normalized = manifest_name.trim().to_ascii_lowercase();

    if normalized.contains("wsl") {
        return StudioInstanceConsoleInstallMethod::Wsl;
    }
    if normalized.contains("docker") {
        return StudioInstanceConsoleInstallMethod::Docker;
    }
    if normalized.contains("podman") {
        return StudioInstanceConsoleInstallMethod::Podman;
    }
    if normalized.contains("ansible") {
        return StudioInstanceConsoleInstallMethod::Ansible;
    }
    if normalized.contains("nix") {
        return StudioInstanceConsoleInstallMethod::Nix;
    }
    if normalized.contains("bun") {
        return StudioInstanceConsoleInstallMethod::Bun;
    }
    if normalized.contains("pnpm") {
        return StudioInstanceConsoleInstallMethod::Pnpm;
    }
    if normalized.contains("npm") {
        return StudioInstanceConsoleInstallMethod::Npm;
    }
    if normalized.contains("git") {
        return StudioInstanceConsoleInstallMethod::Git;
    }
    if normalized.contains("cli") {
        return StudioInstanceConsoleInstallMethod::CliScript;
    }
    if normalized.contains("source") {
        return StudioInstanceConsoleInstallMethod::Source;
    }
    if normalized.contains("installer") || normalized.contains("recommended") {
        return StudioInstanceConsoleInstallMethod::InstallerScript;
    }

    StudioInstanceConsoleInstallMethod::Unknown
}

fn discover_openclaw_config_path(
    paths: &AppPaths,
    install_method: &StudioInstanceConsoleInstallMethod,
) -> Option<PathBuf> {
    let config_path = readable_openclaw_config_file_path(paths);
    match install_method {
        StudioInstanceConsoleInstallMethod::Wsl
        | StudioInstanceConsoleInstallMethod::Docker
        | StudioInstanceConsoleInstallMethod::Podman => None,
        _ if config_path.is_file() => Some(config_path),
        _ => None,
    }
}

fn discover_local_external_openclaw_config_path(
    paths: &AppPaths,
    instance: &StudioInstanceRecord,
) -> Option<PathBuf> {
    if instance.runtime_kind != StudioRuntimeKind::Openclaw
        || instance.deployment_mode != StudioInstanceDeploymentMode::LocalExternal
    {
        return None;
    }

    let (installer_home, install_record) =
        resolve_local_external_openclaw_install_record(paths, instance)
            .ok()
            .flatten()?;
    let install_method = console_install_method_from_install_record(&install_record);

    let _ = installer_home;
    discover_openclaw_config_path(paths, &install_method)
}

fn missing_openclaw_console_config_reason(
    install_method: &StudioInstanceConsoleInstallMethod,
) -> String {
    match install_method {
        StudioInstanceConsoleInstallMethod::Wsl => {
            "This OpenClaw WSL install keeps its runtime configuration inside WSL, so the console opens without automatic authorization."
                .to_string()
        }
        StudioInstanceConsoleInstallMethod::Docker
        | StudioInstanceConsoleInstallMethod::Podman => {
            "This containerized OpenClaw install does not expose a host-readable literal token, so the console opens without automatic authorization."
                .to_string()
        }
        _ => {
            "Agent Studio could not locate a host-readable OpenClaw config file for this install, so the console opens without automatic authorization."
                .to_string()
        }
    }
}

fn build_observability_snapshot(
    paths: &AppPaths,
    instance: &StudioInstanceRecord,
    logs: &str,
) -> StudioInstanceObservabilitySnapshot {
    let log_preview = logs
        .lines()
        .map(str::trim_end)
        .filter(|line| !line.is_empty())
        .map(str::to_string)
        .rev()
        .take(5)
        .collect::<Vec<_>>()
        .into_iter()
        .rev()
        .collect::<Vec<_>>();
    let log_file_path = if uses_built_in_openclaw_config(instance) {
        Some(
            paths
                .logs_dir
                .join("openclaw-gateway.log")
                .to_string_lossy()
                .into_owned(),
        )
    } else {
        None
    };

    StudioInstanceObservabilitySnapshot {
        status: if !log_preview.is_empty() {
            StudioInstanceObservabilityStatus::Ready
        } else if uses_built_in_openclaw_config(instance) {
            StudioInstanceObservabilityStatus::Limited
        } else {
            StudioInstanceObservabilityStatus::Unavailable
        },
        log_available: !log_preview.is_empty(),
        log_file_path,
        log_preview,
        last_seen_at: instance.last_seen_at,
        metrics_source: StudioInstanceMetricsSource::Derived,
    }
}

fn build_data_access_snapshot(
    paths: &AppPaths,
    instance: &StudioInstanceRecord,
    storage: &StudioInstanceStorageSnapshot,
    connectivity: &StudioInstanceConnectivitySnapshot,
    observability: &StudioInstanceObservabilitySnapshot,
) -> StudioInstanceDataAccessSnapshot {
    let mut routes = Vec::new();
    let registry_target = Some("studio.instances registry metadata".to_string());
    let workspace_target = local_workspace_target(paths, instance);
    let local_external_openclaw_config_target =
        discover_local_external_openclaw_config_path(paths, instance)
            .map(|path| path.to_string_lossy().into_owned());
    let built_in_openclaw = uses_built_in_openclaw_config(instance);
    let managed_hermes = is_managed_hermes_instance(instance);
    let primary_endpoint = primary_connectivity_target(connectivity);
    let openai_endpoint = connectivity
        .endpoints
        .iter()
        .find(|endpoint| endpoint.id == "openai-http-chat")
        .and_then(|endpoint| endpoint.url.clone());

    match instance.deployment_mode {
        StudioInstanceDeploymentMode::LocalManaged => {
            routes.push(data_access_entry(
                "config",
                "Configuration",
                StudioInstanceDataAccessScope::Config,
                if built_in_openclaw {
                    StudioInstanceDataAccessMode::ManagedFile
                } else if managed_hermes {
                    StudioInstanceDataAccessMode::ManagedFile
                } else {
                    StudioInstanceDataAccessMode::MetadataOnly
                },
                StudioInstanceDataAccessStatus::Ready,
                if built_in_openclaw {
                    Some(openclaw_config_target(paths))
                } else if managed_hermes {
                    Some(hermes_config_target(paths))
                } else {
                    registry_target.clone()
                },
                false,
                built_in_openclaw || managed_hermes,
                if built_in_openclaw {
                    "Agent Studio reads and writes the built-in OpenClaw config file directly."
                } else if managed_hermes {
                    "Agent Studio reads and writes the managed Hermes config file directly from the user-root kernel layout."
                } else {
                    "Agent Studio stores registry metadata for this local-managed runtime, but does not yet project a managed kernel config file for it."
                },
                if built_in_openclaw || managed_hermes {
                    StudioInstanceDetailSource::Config
                } else {
                    StudioInstanceDetailSource::Integration
                },
            ));
            routes.push(data_access_entry(
                "logs",
                "Logs",
                StudioInstanceDataAccessScope::Logs,
                if built_in_openclaw {
                    StudioInstanceDataAccessMode::ManagedFile
                } else if managed_hermes {
                    StudioInstanceDataAccessMode::ManagedDirectory
                } else {
                    StudioInstanceDataAccessMode::MetadataOnly
                },
                if built_in_openclaw {
                    if observability.log_file_path.is_some() {
                        StudioInstanceDataAccessStatus::Ready
                    } else {
                        StudioInstanceDataAccessStatus::Limited
                    }
                } else {
                    StudioInstanceDataAccessStatus::Planned
                },
                if built_in_openclaw {
                    observability.log_file_path.clone()
                } else if managed_hermes {
                    Some(hermes_logs_target(paths))
                } else {
                    None
                },
                true,
                built_in_openclaw || managed_hermes,
                if built_in_openclaw {
                    "Log inspection comes from the managed gateway log file owned by Agent Studio."
                } else if managed_hermes {
                    "Managed Hermes logs are projected from the user-root kernel logs directory when runtime diagnostics are emitted."
                } else {
                    "Agent Studio does not yet ingest logs from this local-managed runtime."
                },
                if built_in_openclaw {
                    StudioInstanceDetailSource::Derived
                } else {
                    StudioInstanceDetailSource::Runtime
                },
            ));
            routes.push(data_access_entry(
                "files",
                "Workspace",
                StudioInstanceDataAccessScope::Files,
                if built_in_openclaw || managed_hermes {
                    StudioInstanceDataAccessMode::ManagedDirectory
                } else {
                    StudioInstanceDataAccessMode::MetadataOnly
                },
                if workspace_target.is_some() {
                    StudioInstanceDataAccessStatus::Ready
                } else {
                    StudioInstanceDataAccessStatus::ConfigurationRequired
                },
                workspace_target,
                false,
                built_in_openclaw || managed_hermes,
                if built_in_openclaw {
                    "Runtime workspace files live in the managed local workspace directory."
                } else if managed_hermes {
                    "Managed Hermes workspace files live under the user-root kernel workspace directory."
                } else {
                    "Agent Studio only stores metadata for this local-managed runtime workspace."
                },
                if built_in_openclaw || managed_hermes {
                    StudioInstanceDetailSource::Runtime
                } else {
                    StudioInstanceDetailSource::Integration
                },
            ));
        }
        StudioInstanceDeploymentMode::LocalExternal => {
            routes.push(data_access_entry(
                "config",
                "Configuration",
                StudioInstanceDataAccessScope::Config,
                if local_external_openclaw_config_target.is_some() {
                    StudioInstanceDataAccessMode::ManagedFile
                } else {
                    StudioInstanceDataAccessMode::MetadataOnly
                },
                StudioInstanceDataAccessStatus::Ready,
                local_external_openclaw_config_target
                    .clone()
                    .or_else(|| registry_target.clone()),
                false,
                local_external_openclaw_config_target.is_some(),
                if local_external_openclaw_config_target.is_some() {
                    "Agent Studio discovered the installed OpenClaw config file and can edit it directly for this local-external runtime."
                } else {
                    "Agent Studio stores operator metadata for this local-external runtime, but does not own its native config file."
                },
                if local_external_openclaw_config_target.is_some() {
                    StudioInstanceDetailSource::Config
                } else {
                    StudioInstanceDetailSource::Integration
                },
            ));
            routes.push(data_access_entry(
                "logs",
                "Logs",
                StudioInstanceDataAccessScope::Logs,
                StudioInstanceDataAccessMode::MetadataOnly,
                if observability.log_available {
                    StudioInstanceDataAccessStatus::Limited
                } else {
                    StudioInstanceDataAccessStatus::Planned
                },
                observability.log_file_path.clone(),
                true,
                false,
                "Log visibility is limited unless explicit local diagnostics are configured for the external runtime.",
                StudioInstanceDetailSource::Integration,
            ));
            routes.push(data_access_entry(
                "files",
                "Workspace",
                StudioInstanceDataAccessScope::Files,
                if instance.config.workspace_path.is_some() {
                    StudioInstanceDataAccessMode::ManagedDirectory
                } else {
                    StudioInstanceDataAccessMode::MetadataOnly
                },
                if instance.config.workspace_path.is_some() {
                    StudioInstanceDataAccessStatus::Limited
                } else {
                    StudioInstanceDataAccessStatus::Planned
                },
                instance.config.workspace_path.clone(),
                false,
                false,
                "Workspace access depends on explicitly configured external runtime paths.",
                StudioInstanceDetailSource::Config,
            ));
        }
        StudioInstanceDeploymentMode::Remote => {
            routes.push(data_access_entry(
                "config",
                "Configuration",
                StudioInstanceDataAccessScope::Config,
                StudioInstanceDataAccessMode::MetadataOnly,
                StudioInstanceDataAccessStatus::Ready,
                registry_target.clone(),
                false,
                false,
                "Remote instance configuration is represented by Agent Studio metadata, not a locally managed runtime file.",
                StudioInstanceDetailSource::Integration,
            ));
            routes.push(data_access_entry(
                "logs",
                "Logs",
                StudioInstanceDataAccessScope::Logs,
                StudioInstanceDataAccessMode::MetadataOnly,
                if observability.log_available {
                    StudioInstanceDataAccessStatus::Limited
                } else {
                    StudioInstanceDataAccessStatus::Planned
                },
                None,
                true,
                false,
                "Remote log transport is not yet integrated, so Agent Studio currently exposes metadata posture only.",
                StudioInstanceDetailSource::Integration,
            ));
            routes.push(data_access_entry(
                "files",
                "Workspace",
                StudioInstanceDataAccessScope::Files,
                StudioInstanceDataAccessMode::MetadataOnly,
                StudioInstanceDataAccessStatus::Planned,
                instance.config.workspace_path.clone(),
                false,
                false,
                "Remote runtimes do not expose a Agent Studio-owned workspace directory by default.",
                StudioInstanceDetailSource::Integration,
            ));
        }
    }

    let storage_status = data_access_status_for_storage(storage);
    let storage_target = storage_target(storage);
    routes.push(data_access_entry(
        "memory",
        "Memory",
        StudioInstanceDataAccessScope::Memory,
        StudioInstanceDataAccessMode::StorageBinding,
        storage_status.clone(),
        storage_target.clone(),
        false,
        storage.status == StudioInstanceStorageStatus::Ready,
        "Memory truth is anchored to the configured storage binding for this runtime.",
        StudioInstanceDetailSource::Storage,
    ));

    let tasks_mode =
        if instance.runtime_kind == StudioRuntimeKind::Zeroclaw && primary_endpoint.is_some() {
            StudioInstanceDataAccessMode::RemoteEndpoint
        } else if storage.status == StudioInstanceStorageStatus::Ready {
            StudioInstanceDataAccessMode::StorageBinding
        } else {
            StudioInstanceDataAccessMode::MetadataOnly
        };
    let tasks_target = if tasks_mode == StudioInstanceDataAccessMode::RemoteEndpoint {
        primary_endpoint.clone()
    } else if tasks_mode == StudioInstanceDataAccessMode::StorageBinding {
        storage_target.clone()
    } else {
        registry_target.clone()
    };
    routes.push(data_access_entry(
        "tasks",
        "Tasks",
        StudioInstanceDataAccessScope::Tasks,
        tasks_mode,
        if tasks_target.is_some() {
            if matches!(instance.runtime_kind, StudioRuntimeKind::Zeroclaw)
                && primary_endpoint.is_some()
            {
                StudioInstanceDataAccessStatus::Ready
            } else {
                storage_status.clone()
            }
        } else {
            StudioInstanceDataAccessStatus::ConfigurationRequired
        },
        tasks_target,
        false,
        primary_endpoint.is_some() || storage.status == StudioInstanceStorageStatus::Ready,
        "Task detail is linked either through runtime endpoints or the bound storage plane, depending on the runtime.",
        if primary_endpoint.is_some() && instance.runtime_kind == StudioRuntimeKind::Zeroclaw {
            StudioInstanceDetailSource::Runtime
        } else {
            StudioInstanceDetailSource::Storage
        },
    ));

    routes.push(data_access_entry(
        "tools",
        "Tools",
        StudioInstanceDataAccessScope::Tools,
        if primary_endpoint.is_some() {
            StudioInstanceDataAccessMode::RemoteEndpoint
        } else {
            StudioInstanceDataAccessMode::MetadataOnly
        },
        if primary_endpoint.is_some() {
            StudioInstanceDataAccessStatus::Planned
        } else {
            StudioInstanceDataAccessStatus::ConfigurationRequired
        },
        primary_endpoint.clone(),
        true,
        false,
        "Tool detail depends on runtime-specific adapters and is currently limited to endpoint posture.",
        StudioInstanceDetailSource::Integration,
    ));

    routes.push(data_access_entry(
        "models",
        "Models",
        StudioInstanceDataAccessScope::Models,
        if openai_endpoint.is_some() || primary_endpoint.is_some() {
            StudioInstanceDataAccessMode::RemoteEndpoint
        } else {
            StudioInstanceDataAccessMode::MetadataOnly
        },
        if openai_endpoint.is_some() || primary_endpoint.is_some() {
            StudioInstanceDataAccessStatus::Planned
        } else {
            StudioInstanceDataAccessStatus::ConfigurationRequired
        },
        openai_endpoint.or(primary_endpoint),
        false,
        false,
        "Model/provider detail requires runtime-specific adapters beyond the base endpoint metadata.",
        StudioInstanceDetailSource::Integration,
    ));

    StudioInstanceDataAccessSnapshot { routes }
}

fn build_artifacts(
    paths: &AppPaths,
    instance: &StudioInstanceRecord,
    storage: &StudioInstanceStorageSnapshot,
    connectivity: &StudioInstanceConnectivitySnapshot,
    observability: &StudioInstanceObservabilitySnapshot,
) -> Vec<StudioInstanceArtifactRecord> {
    let mut artifacts = Vec::new();
    let local_external_openclaw_config_path =
        discover_local_external_openclaw_config_path(paths, instance);

    if uses_built_in_openclaw_config(instance) {
        artifacts.push(artifact_record(
            "config-file",
            "Config File",
            StudioInstanceArtifactKind::ConfigFile,
            StudioInstanceArtifactStatus::Available,
            Some(openclaw_config_target(paths)),
            false,
            "OpenClaw runtime configuration file.",
            StudioInstanceDetailSource::Config,
        ));
        artifacts.push(artifact_record(
            "runtime-directory",
            "Runtime Directory",
            StudioInstanceArtifactKind::RuntimeDirectory,
            StudioInstanceArtifactStatus::Available,
            Some(
                built_in_openclaw_runtime_dir(paths)
                    .to_string_lossy()
                    .into_owned(),
            ),
            true,
            "Packaged OpenClaw install directory managed by Agent Studio.",
            StudioInstanceDetailSource::Runtime,
        ));
        artifacts.push(artifact_record(
            "desktop-main-log-file",
            "Desktop Main Log",
            StudioInstanceArtifactKind::LogFile,
            if paths.main_log_file.is_file() {
                StudioInstanceArtifactStatus::Available
            } else {
                StudioInstanceArtifactStatus::Configured
            },
            Some(paths.main_log_file.to_string_lossy().into_owned()),
            true,
            "Agent Studio desktop shell log with bootstrap stages and supervisor activity.",
            StudioInstanceDetailSource::Runtime,
        ));
    } else if is_managed_hermes_instance(instance) {
        artifacts.push(artifact_record(
            "config-file",
            "Config File",
            StudioInstanceArtifactKind::ConfigFile,
            StudioInstanceArtifactStatus::Available,
            Some(hermes_config_target(paths)),
            false,
            "Hermes runtime configuration file owned by the managed kernel layout.",
            StudioInstanceDetailSource::Config,
        ));
        artifacts.push(artifact_record(
            "runtime-directory",
            "Runtime Directory",
            StudioInstanceArtifactKind::RuntimeDirectory,
            StudioInstanceArtifactStatus::Configured,
            Some(hermes_runtime_target(paths)),
            true,
            "Managed Hermes runtime installation directory reserved by Agent Studio.",
            StudioInstanceDetailSource::Runtime,
        ));
    } else if let Some(config_path) = local_external_openclaw_config_path {
        artifacts.push(artifact_record(
            "config-file",
            "Config File",
            StudioInstanceArtifactKind::ConfigFile,
            StudioInstanceArtifactStatus::Available,
            Some(config_path.to_string_lossy().into_owned()),
            false,
            "Installed OpenClaw configuration file discovered for this local-external runtime.",
            StudioInstanceDetailSource::Config,
        ));
    }

    if let Some(workspace_path) = local_workspace_target(paths, instance) {
        artifacts.push(artifact_record(
            "workspace-directory",
            "Workspace Directory",
            StudioInstanceArtifactKind::WorkspaceDirectory,
            if instance.deployment_mode == StudioInstanceDeploymentMode::Remote {
                StudioInstanceArtifactStatus::Planned
            } else {
                StudioInstanceArtifactStatus::Available
            },
            Some(workspace_path),
            false,
            "Workspace directory or configured runtime workspace root.",
            StudioInstanceDetailSource::Config,
        ));
    }

    if let Some(log_file_path) = observability.log_file_path.clone() {
        artifacts.push(artifact_record(
            "log-file",
            "Log File",
            StudioInstanceArtifactKind::LogFile,
            StudioInstanceArtifactStatus::Available,
            Some(log_file_path),
            true,
            "Primary runtime log file exposed by the detail snapshot.",
            StudioInstanceDetailSource::Derived,
        ));
    }

    if let Some(base_url) = instance.base_url.clone() {
        artifacts.push(artifact_record(
            "gateway-endpoint",
            "Gateway Endpoint",
            StudioInstanceArtifactKind::Endpoint,
            if instance.deployment_mode == StudioInstanceDeploymentMode::Remote {
                StudioInstanceArtifactStatus::Remote
            } else {
                StudioInstanceArtifactStatus::Configured
            },
            Some(base_url.clone()),
            true,
            "Primary configured runtime endpoint.",
            StudioInstanceDetailSource::Config,
        ));

        if instance.runtime_kind == StudioRuntimeKind::Zeroclaw {
            artifacts.push(artifact_record(
                "dashboard",
                "Gateway Dashboard",
                StudioInstanceArtifactKind::Dashboard,
                if instance.deployment_mode == StudioInstanceDeploymentMode::Remote {
                    StudioInstanceArtifactStatus::Remote
                } else {
                    StudioInstanceArtifactStatus::Configured
                },
                Some(base_url),
                true,
                "ZeroClaw dashboard surface derived from the configured gateway URL.",
                StudioInstanceDetailSource::Derived,
            ));
        }
    } else if connectivity.endpoints.is_empty() {
        artifacts.push(artifact_record(
            "gateway-endpoint",
            "Gateway Endpoint",
            StudioInstanceArtifactKind::Endpoint,
            StudioInstanceArtifactStatus::Missing,
            None,
            true,
            "No runtime endpoint is configured for this instance.",
            StudioInstanceDetailSource::Config,
        ));
    }

    artifacts.push(artifact_record(
        "storage-binding",
        "Storage Binding",
        StudioInstanceArtifactKind::StorageBinding,
        artifact_status_for_storage(storage),
        storage_target(storage),
        false,
        "Storage profile, namespace, and backing database or endpoint bound to this instance.",
        StudioInstanceDetailSource::Storage,
    ));

    artifacts
}

fn data_access_entry(
    id: &str,
    label: &str,
    scope: StudioInstanceDataAccessScope,
    mode: StudioInstanceDataAccessMode,
    status: StudioInstanceDataAccessStatus,
    target: Option<String>,
    readonly: bool,
    authoritative: bool,
    detail: &str,
    source: StudioInstanceDetailSource,
) -> StudioInstanceDataAccessEntry {
    StudioInstanceDataAccessEntry {
        id: id.to_string(),
        label: label.to_string(),
        scope,
        mode,
        status,
        target,
        readonly,
        authoritative,
        detail: detail.to_string(),
        source,
    }
}

fn artifact_record(
    id: &str,
    label: &str,
    kind: StudioInstanceArtifactKind,
    status: StudioInstanceArtifactStatus,
    location: Option<String>,
    readonly: bool,
    detail: &str,
    source: StudioInstanceDetailSource,
) -> StudioInstanceArtifactRecord {
    StudioInstanceArtifactRecord {
        id: id.to_string(),
        label: label.to_string(),
        kind,
        status,
        location,
        readonly,
        detail: detail.to_string(),
        source,
    }
}

fn data_access_status_for_storage(
    storage: &StudioInstanceStorageSnapshot,
) -> StudioInstanceDataAccessStatus {
    match storage.status {
        StudioInstanceStorageStatus::Ready => StudioInstanceDataAccessStatus::Ready,
        StudioInstanceStorageStatus::ConfigurationRequired => {
            StudioInstanceDataAccessStatus::ConfigurationRequired
        }
        StudioInstanceStorageStatus::Planned => StudioInstanceDataAccessStatus::Planned,
        StudioInstanceStorageStatus::Unavailable => StudioInstanceDataAccessStatus::Unavailable,
    }
}

fn artifact_status_for_storage(
    storage: &StudioInstanceStorageSnapshot,
) -> StudioInstanceArtifactStatus {
    match storage.status {
        StudioInstanceStorageStatus::Ready => StudioInstanceArtifactStatus::Configured,
        StudioInstanceStorageStatus::ConfigurationRequired => StudioInstanceArtifactStatus::Missing,
        StudioInstanceStorageStatus::Planned => StudioInstanceArtifactStatus::Planned,
        StudioInstanceStorageStatus::Unavailable => StudioInstanceArtifactStatus::Missing,
    }
}

fn storage_target(storage: &StudioInstanceStorageSnapshot) -> Option<String> {
    storage
        .endpoint
        .clone()
        .or_else(|| storage.database.clone())
        .or_else(|| Some(storage.namespace.clone()))
}

fn local_workspace_target(paths: &AppPaths, instance: &StudioInstanceRecord) -> Option<String> {
    if uses_built_in_openclaw_config(instance) {
        return Some(paths.openclaw_workspace_dir.to_string_lossy().into_owned());
    }
    if is_managed_hermes_instance(instance) {
        return Some(hermes_workspace_target(paths));
    }

    instance.config.workspace_path.clone()
}

fn uses_built_in_openclaw_config(instance: &StudioInstanceRecord) -> bool {
    is_built_in_openclaw_instance(instance)
}

fn is_built_in_openclaw_instance(instance: &StudioInstanceRecord) -> bool {
    instance.is_built_in
        && instance.runtime_kind == StudioRuntimeKind::Openclaw
        && instance.deployment_mode == StudioInstanceDeploymentMode::LocalManaged
        && instance.transport_kind == StudioInstanceTransportKind::OpenclawGatewayWs
}

fn is_managed_hermes_instance(instance: &StudioInstanceRecord) -> bool {
    instance.runtime_kind == StudioRuntimeKind::Hermes
        && instance.deployment_mode == StudioInstanceDeploymentMode::LocalManaged
}

fn canonical_built_in_openclaw_instance_id(value: &str) -> &str {
    let normalized = value.trim();
    if normalized == DEFAULT_INSTANCE_ID {
        DEFAULT_INSTANCE_ID
    } else {
        normalized
    }
}

fn matches_requested_instance_id(instance: &StudioInstanceRecord, requested_id: &str) -> bool {
    if instance.id == requested_id {
        return true;
    }

    is_built_in_openclaw_instance(instance)
        && canonical_built_in_openclaw_instance_id(instance.id.as_str())
            == canonical_built_in_openclaw_instance_id(requested_id)
}

fn find_built_in_openclaw_index(instances: &[StudioInstanceRecord]) -> Option<usize> {
    instances
        .iter()
        .position(|instance| {
            is_built_in_openclaw_instance(instance) && instance.id != DEFAULT_INSTANCE_ID
        })
        .or_else(|| instances.iter().position(is_built_in_openclaw_instance))
}

fn primary_connectivity_target(
    connectivity: &StudioInstanceConnectivitySnapshot,
) -> Option<String> {
    connectivity
        .endpoints
        .iter()
        .find(|endpoint| endpoint.status == StudioInstanceEndpointStatus::Ready)
        .and_then(|endpoint| endpoint.url.clone())
}

fn build_capability_snapshots(
    instance: &StudioInstanceRecord,
    storage: &StudioInstanceStorageSnapshot,
) -> Vec<StudioInstanceCapabilitySnapshot> {
    const ALL_CAPABILITIES: [StudioInstanceCapability; 7] = [
        StudioInstanceCapability::Chat,
        StudioInstanceCapability::Health,
        StudioInstanceCapability::Files,
        StudioInstanceCapability::Memory,
        StudioInstanceCapability::Tasks,
        StudioInstanceCapability::Tools,
        StudioInstanceCapability::Models,
    ];

    ALL_CAPABILITIES
        .into_iter()
        .map(|capability| {
            let supported = instance.capabilities.contains(&capability);
            let (status, detail, source) = if !supported {
                (
                    StudioInstanceCapabilityStatus::Unsupported,
                    "This runtime is not currently modeled as supporting this capability."
                        .to_string(),
                    StudioInstanceCapabilitySource::Runtime,
                )
            } else if matches!(
                capability,
                StudioInstanceCapability::Memory | StudioInstanceCapability::Tasks
            ) && storage.status != StudioInstanceStorageStatus::Ready
            {
                (
                    StudioInstanceCapabilityStatus::ConfigurationRequired,
                    "Capability depends on a configured durable storage binding.".to_string(),
                    StudioInstanceCapabilitySource::Storage,
                )
            } else if matches!(
                capability,
                StudioInstanceCapability::Files | StudioInstanceCapability::Tools
            ) && instance.deployment_mode != StudioInstanceDeploymentMode::LocalManaged
            {
                (
                    StudioInstanceCapabilityStatus::Planned,
                    "Runtime may support this, but Agent Studio has not integrated this external detail surface yet."
                        .to_string(),
                    StudioInstanceCapabilitySource::Integration,
                )
            } else {
                (
                    StudioInstanceCapabilityStatus::Ready,
                    "Advertised by the runtime record.".to_string(),
                    StudioInstanceCapabilitySource::Runtime,
                )
            };

            StudioInstanceCapabilitySnapshot {
                id: capability,
                status,
                detail,
                source,
            }
        })
        .collect()
}

fn build_official_runtime_notes(instance: &StudioInstanceRecord) -> Vec<StudioInstanceRuntimeNote> {
    match instance.runtime_kind {
        StudioRuntimeKind::Openclaw => vec![StudioInstanceRuntimeNote {
            title: "Gateway-first transport".to_string(),
            content: "OpenClaw centers its runtime around the Gateway WebSocket and can optionally expose OpenAI-compatible HTTP endpoints when enabled.".to_string(),
            source_url: Some("https://docs.openclaw.ai/gateway/openai-http-api".to_string()),
        }],
        StudioRuntimeKind::Hermes => vec![StudioInstanceRuntimeNote {
            title: "External Python runtime".to_string(),
            content: "Hermes Agent requires external Python and uv, optionally uses Node.js for some capabilities, and on Windows must run through WSL2 or a remote Linux environment.".to_string(),
            source_url: Some(
                "https://hermes-agent.nousresearch.com/docs/getting-started/installation/"
                    .to_string(),
            ),
        }],
        StudioRuntimeKind::Zeroclaw => vec![StudioInstanceRuntimeNote {
            title: "Gateway and dashboard".to_string(),
            content: "ZeroClaw ships as a single Rust binary and exposes a gateway/dashboard surface that can be run locally or remotely.".to_string(),
            source_url: Some("https://github.com/zeroclaw-labs/zeroclaw".to_string()),
        }],
        StudioRuntimeKind::Ironclaw => vec![StudioInstanceRuntimeNote {
            title: "Database-first runtime".to_string(),
            content: "IronClaw expects PostgreSQL plus pgvector and emphasizes persistent storage, routines, and realtime gateway streaming.".to_string(),
            source_url: Some("https://github.com/nearai/ironclaw".to_string()),
        }],
        StudioRuntimeKind::Custom | StudioRuntimeKind::Other(_) => vec![StudioInstanceRuntimeNote {
            title: "Custom runtime".to_string(),
            content: "This instance uses a custom runtime binding. Connectivity and capability surfaces depend on the configured metadata.".to_string(),
            source_url: None,
        }],
    }
}

fn default_capabilities_for_runtime(
    runtime_kind: &StudioRuntimeKind,
) -> Vec<StudioInstanceCapability> {
    match runtime_kind {
        StudioRuntimeKind::Openclaw => vec![
            StudioInstanceCapability::Chat,
            StudioInstanceCapability::Health,
            StudioInstanceCapability::Files,
            StudioInstanceCapability::Memory,
            StudioInstanceCapability::Tasks,
            StudioInstanceCapability::Tools,
            StudioInstanceCapability::Models,
        ],
        StudioRuntimeKind::Hermes => vec![
            StudioInstanceCapability::Chat,
            StudioInstanceCapability::Health,
            StudioInstanceCapability::Files,
            StudioInstanceCapability::Memory,
            StudioInstanceCapability::Tools,
            StudioInstanceCapability::Models,
        ],
        StudioRuntimeKind::Zeroclaw => vec![
            StudioInstanceCapability::Chat,
            StudioInstanceCapability::Health,
            StudioInstanceCapability::Memory,
            StudioInstanceCapability::Tasks,
            StudioInstanceCapability::Tools,
            StudioInstanceCapability::Models,
        ],
        StudioRuntimeKind::Ironclaw => vec![
            StudioInstanceCapability::Chat,
            StudioInstanceCapability::Health,
            StudioInstanceCapability::Memory,
            StudioInstanceCapability::Tasks,
            StudioInstanceCapability::Models,
        ],
        StudioRuntimeKind::Custom | StudioRuntimeKind::Other(_) => vec![
            StudioInstanceCapability::Chat,
            StudioInstanceCapability::Health,
        ],
    }
}

#[cfg(test)]
fn read_active_openclaw_install_key(paths: &AppPaths) -> Option<String> {
    read_active_state(paths).and_then(|active| {
        active
            .runtimes
            .get("openclaw")
            .and_then(|entry| entry.active_runtime_install_key().map(str::to_string))
    })
}

fn read_active_state(paths: &AppPaths) -> Option<ActiveState> {
    fs::read_to_string(&paths.active_file)
        .ok()
        .and_then(|content| serde_json::from_str::<ActiveState>(&content).ok())
}

fn read_openclaw_authority_state(paths: &AppPaths) -> Option<KernelAuthorityState> {
    let authority_file = paths.kernel_paths("openclaw").ok()?.authority_file;
    fs::read_to_string(&authority_file)
        .ok()
        .and_then(|content| serde_json::from_str::<KernelAuthorityState>(&content).ok())
}

fn resolve_installed_openclaw_manifest_version(
    paths: &AppPaths,
    install_key: &str,
) -> Option<String> {
    let runtime_dir = paths.kernel_paths("openclaw").ok()?.runtime_dir;
    load_manifest(&runtime_dir.join(install_key).join("manifest.json"))
        .ok()
        .map(|manifest| manifest.openclaw_version)
}

fn compare_version_like(left: &str, right: &str) -> std::cmp::Ordering {
    let left_parts = left
        .split(|character: char| !character.is_ascii_digit())
        .filter(|segment| !segment.is_empty())
        .filter_map(|segment| segment.parse::<u64>().ok())
        .collect::<Vec<_>>();
    let right_parts = right
        .split(|character: char| !character.is_ascii_digit())
        .filter(|segment| !segment.is_empty())
        .filter_map(|segment| segment.parse::<u64>().ok())
        .collect::<Vec<_>>();

    for (left_part, right_part) in left_parts.iter().zip(right_parts.iter()) {
        match left_part.cmp(right_part) {
            std::cmp::Ordering::Equal => continue,
            ordering => return ordering,
        }
    }

    match left_parts.len().cmp(&right_parts.len()) {
        std::cmp::Ordering::Equal => left.cmp(right),
        ordering => ordering,
    }
}

fn validate_create_instance_input(input: &StudioCreateInstanceInput) -> Result<()> {
    let _ = input;

    Ok(())
}

fn resolve_latest_installed_openclaw_version(paths: &AppPaths) -> Option<String> {
    let runtime_dir = paths.kernel_paths("openclaw").ok()?.runtime_dir;
    fs::read_dir(runtime_dir)
        .ok()?
        .filter_map(|entry| {
            let path = entry.ok()?.path();
            if !path.is_dir() {
                return None;
            }

            load_manifest(&path.join("manifest.json"))
                .ok()
                .map(|manifest| manifest.openclaw_version)
        })
        .max_by(|left, right| compare_version_like(left, right))
}

fn current_display_version_label(label: Option<&str>, manifest_version: &str) -> Option<String> {
    let trimmed = label?.trim();
    if trimmed == manifest_version {
        return Some(trimmed.to_string());
    }

    None
}

fn resolve_built_in_openclaw_display_version(paths: &AppPaths) -> String {
    if let Some(authority) = read_openclaw_authority_state(paths) {
        if let Some(install_key) = authority.active_install_key.as_deref() {
            if let Some(manifest_version) =
                resolve_installed_openclaw_manifest_version(paths, install_key)
            {
                return current_display_version_label(
                    authority.active_version_label.as_deref(),
                    &manifest_version,
                )
                .unwrap_or(manifest_version);
            }
        }
    }

    if let Some(active) = read_active_state(paths) {
        if let Some(entry) = active.runtimes.get("openclaw") {
            if let Some(install_key) = entry.active_runtime_install_key() {
                if let Some(manifest_version) =
                    resolve_installed_openclaw_manifest_version(paths, install_key)
                {
                    return current_display_version_label(
                        entry.active_version_label.as_deref(),
                        &manifest_version,
                    )
                    .unwrap_or(manifest_version);
                }
            }
        }
    }

    if let Some(version) = resolve_latest_installed_openclaw_version(paths) {
        return version;
    }

    bundled_openclaw_version().to_string()
}

fn build_built_in_instance(paths: &AppPaths, config: &AppConfig) -> Result<StudioInstanceRecord> {
    let active_version = resolve_built_in_openclaw_display_version(paths);
    let root = read_openclaw_config(paths)?;
    let port = get_nested_u16(&root, &["gateway", "port"]).unwrap_or(DEFAULT_GATEWAY_PORT);
    let workspace_path = Some(paths.openclaw_workspace_dir.to_string_lossy().into_owned());
    let log_level =
        get_nested_string(&root, &["studio", "logLevel"]).unwrap_or_else(|| "info".to_string());
    let cors_origins =
        get_nested_string(&root, &["studio", "corsOrigins"]).unwrap_or_else(|| "*".to_string());
    let sandbox = get_nested_bool(&root, &["studio", "sandbox"]).unwrap_or(true);
    let auto_update = get_nested_bool(&root, &["studio", "autoUpdate"]).unwrap_or(true);
    let auth_token = get_nested_string(&root, &["gateway", "auth", "token"]);
    let timestamp = unix_timestamp_ms()?;

    Ok(StudioInstanceRecord {
        id: DEFAULT_INSTANCE_ID.to_string(),
        name: "Local Built-In".to_string(),
        description: Some("Packaged local OpenClaw kernel managed by Agent Studio.".to_string()),
        runtime_kind: StudioRuntimeKind::Openclaw,
        deployment_mode: StudioInstanceDeploymentMode::LocalManaged,
        transport_kind: StudioInstanceTransportKind::OpenclawGatewayWs,
        status: StudioInstanceStatus::Offline,
        is_built_in: true,
        is_default: true,
        icon_type: StudioInstanceIconType::Server,
        version: active_version,
        type_label: "Built-In OpenClaw".to_string(),
        host: "127.0.0.1".to_string(),
        port: Some(port),
        base_url: None,
        websocket_url: None,
        cpu: 0,
        memory: 0,
        total_memory: "Unknown".to_string(),
        uptime: "-".to_string(),
        capabilities: vec![
            StudioInstanceCapability::Chat,
            StudioInstanceCapability::Health,
            StudioInstanceCapability::Files,
            StudioInstanceCapability::Memory,
            StudioInstanceCapability::Tasks,
            StudioInstanceCapability::Tools,
            StudioInstanceCapability::Models,
        ],
        storage: default_storage_binding(config),
        config: StudioInstanceConfig {
            port: port.to_string(),
            sandbox,
            auto_update,
            log_level,
            cors_origins,
            workspace_path,
            base_url: None,
            websocket_url: None,
            auth_token,
        },
        created_at: timestamp,
        updated_at: timestamp,
        last_seen_at: Some(timestamp),
    })
}

fn upsert_built_in_instance(
    instances: &mut Vec<StudioInstanceRecord>,
    built_in: StudioInstanceRecord,
) -> bool {
    let Some(index) = find_built_in_openclaw_index(instances) else {
        instances.insert(0, built_in);
        return true;
    };

    let previous_instances = instances.clone();
    let previous = instances[index].clone();
    let preferred_id = DEFAULT_INSTANCE_ID.to_string();
    let merged = StudioInstanceRecord {
        id: preferred_id.clone(),
        name: previous.name.clone(),
        description: previous.description.clone(),
        type_label: previous.type_label.clone(),
        created_at: previous.created_at,
        is_default: previous.is_default,
        status: previous.status.clone(),
        updated_at: previous.updated_at,
        last_seen_at: previous.last_seen_at,
        ..built_in
    };

    instances.retain(|instance| !is_built_in_openclaw_instance(instance));
    instances.insert(index.min(instances.len()), merged);

    *instances != previous_instances
}

fn project_built_in_instance_live_state(
    paths: &AppPaths,
    instances: &mut [StudioInstanceRecord],
    supervisor: &SupervisorService,
) -> Result<()> {
    let Some(index) = find_built_in_openclaw_index(instances) else {
        return Ok(());
    };
    let instance = &mut instances[index];

    let lifecycle = built_in_openclaw_lifecycle(supervisor)?;
    let gateway_running = matches!(lifecycle, OpenClawLifecycle::Ready);

    if let Some(runtime) = supervisor.configured_openclaw_runtime()? {
        instance.port = Some(runtime.gateway_port);
        instance.config.port = runtime.gateway_port.to_string();
        instance.config.auth_token = Some(runtime.gateway_auth_token);

        if gateway_running {
            let base_url = format!("http://127.0.0.1:{}", runtime.gateway_port);
            let config_root = read_openclaw_config(paths)?;
            let mut gateway_projection = instance.clone();
            gateway_projection.port = Some(runtime.gateway_port);
            gateway_projection.config.port = runtime.gateway_port.to_string();
            gateway_projection.base_url = Some(base_url.clone());
            gateway_projection.websocket_url = None;
            gateway_projection.config.base_url = Some(base_url.clone());
            gateway_projection.config.websocket_url = None;
            let websocket_url =
                build_openclaw_gateway_ws_url(&gateway_projection, Some(&config_root))
                    .unwrap_or_else(|| format!("ws://127.0.0.1:{}", runtime.gateway_port));
            instance.base_url = Some(base_url.clone());
            instance.websocket_url = Some(websocket_url.clone());
            instance.config.base_url = Some(base_url);
            instance.config.websocket_url = Some(websocket_url);
        } else {
            instance.base_url = None;
            instance.websocket_url = None;
            instance.config.base_url = None;
            instance.config.websocket_url = None;
        }
    }

    let now = unix_timestamp_ms()?;
    match lifecycle {
        OpenClawLifecycle::Ready => {
            instance.status = StudioInstanceStatus::Online;
            instance.last_seen_at = Some(now);
        }
        OpenClawLifecycle::Starting | OpenClawLifecycle::Stopping => {
            instance.status = StudioInstanceStatus::Starting;
            instance.last_seen_at = Some(now);
        }
        OpenClawLifecycle::Degraded => {
            instance.status = StudioInstanceStatus::Error;
            instance.last_seen_at = Some(now);
        }
        OpenClawLifecycle::Stopped | OpenClawLifecycle::Inactive => {
            instance.status = StudioInstanceStatus::Offline;
        }
    }

    Ok(())
}

fn normalize_default_instance(instances: &mut Vec<StudioInstanceRecord>) -> bool {
    if instances.is_empty() {
        return false;
    }

    let default_id = instances
        .iter()
        .find(|instance| instance.is_default)
        .map(|instance| instance.id.clone())
        .unwrap_or_else(|| {
            find_built_in_openclaw_index(instances)
                .map(|index| instances[index].id.clone())
                .unwrap_or_else(|| instances[0].id.clone())
        });

    let mut changed = false;
    for instance in instances.iter_mut() {
        let should_be_default = instance.id == default_id;
        if instance.is_default != should_be_default {
            instance.is_default = should_be_default;
            changed = true;
        }
    }

    changed
}

fn default_storage_binding(config: &AppConfig) -> StudioStorageBinding {
    let normalized = config.storage.normalized();
    let active_profile = normalized
        .profiles
        .iter()
        .find(|profile| profile.id == normalized.active_profile_id)
        .cloned()
        .unwrap_or_default();

    StudioStorageBinding {
        profile_id: Some(active_profile.id),
        provider: active_profile.provider,
        namespace: active_profile.namespace,
        database: active_profile.database,
        connection_hint: active_profile.connection.map(|_| "configured".to_string()),
        endpoint: active_profile.endpoint,
    }
}

fn merge_storage_binding(
    current: StudioStorageBinding,
    input: PartialStudioStorageBinding,
) -> StudioStorageBinding {
    StudioStorageBinding {
        profile_id: input.profile_id.or(current.profile_id),
        provider: input.provider.unwrap_or(current.provider),
        namespace: input.namespace.unwrap_or(current.namespace),
        database: input.database.or(current.database),
        connection_hint: input.connection_hint.or(current.connection_hint),
        endpoint: input.endpoint.or(current.endpoint),
    }
}

fn merge_instance_config(
    current: StudioInstanceConfig,
    input: Option<PartialStudioInstanceConfig>,
) -> StudioInstanceConfig {
    let Some(input) = input else {
        return current;
    };

    StudioInstanceConfig {
        port: input.port.unwrap_or(current.port),
        sandbox: input.sandbox.unwrap_or(current.sandbox),
        auto_update: input.auto_update.unwrap_or(current.auto_update),
        log_level: input.log_level.unwrap_or(current.log_level),
        cors_origins: input.cors_origins.unwrap_or(current.cors_origins),
        workspace_path: input.workspace_path.or(current.workspace_path),
        base_url: input.base_url.or(current.base_url),
        websocket_url: input.websocket_url.or(current.websocket_url),
        auth_token: input.auth_token.or(current.auth_token),
    }
}

fn normalize_built_in_openclaw_instance_config(
    paths: &AppPaths,
    mut config: StudioInstanceConfig,
) -> StudioInstanceConfig {
    config.workspace_path = Some(paths.openclaw_workspace_dir.to_string_lossy().into_owned());
    config.base_url = None;
    config.websocket_url = None;
    config
}

fn normalize_optional_string(value: Option<String>) -> Option<String> {
    value.and_then(|item| {
        let trimmed = item.trim().to_string();
        if trimmed.is_empty() {
            None
        } else {
            Some(trimmed)
        }
    })
}

fn normalize_participant_instance_ids(
    primary_instance_id: &str,
    participant_instance_ids: Vec<String>,
) -> Vec<String> {
    let mut seen = BTreeSet::new();
    let mut normalized = Vec::new();

    if seen.insert(primary_instance_id.to_string()) {
        normalized.push(primary_instance_id.to_string());
    }

    for participant_instance_id in participant_instance_ids {
        let trimmed = participant_instance_id.trim();
        if trimmed.is_empty() {
            continue;
        }

        if seen.insert(trimmed.to_string()) {
            normalized.push(trimmed.to_string());
        }
    }

    normalized
}

fn normalize_conversation_message_id(value: &str) -> Option<String> {
    let trimmed = value.trim();
    if trimmed.is_empty() {
        None
    } else {
        Some(trimmed.to_string())
    }
}

fn compare_studio_conversation_message_recency(
    left_message: &StudioConversationMessage,
    left_index: usize,
    right_message: &StudioConversationMessage,
    right_index: usize,
) -> std::cmp::Ordering {
    left_message
        .updated_at
        .cmp(&right_message.updated_at)
        .then_with(|| left_message.created_at.cmp(&right_message.created_at))
        .then_with(|| left_index.cmp(&right_index))
}

fn sanitize_studio_conversation_record(
    mut record: StudioConversationRecord,
) -> StudioConversationRecord {
    let conversation_id = record.id.clone();
    let mut deduped_messages: Vec<(usize, StudioConversationMessage)> = Vec::new();
    let mut deduped_message_indexes: BTreeMap<String, usize> = BTreeMap::new();

    for (index, mut message) in std::mem::take(&mut record.messages).into_iter().enumerate() {
        message.conversation_id = conversation_id.clone();

        let Some(normalized_message_id) = normalize_conversation_message_id(message.id.as_str())
        else {
            deduped_messages.push((index, message));
            continue;
        };

        message.id = normalized_message_id.clone();
        if let Some(existing_index) = deduped_message_indexes.get(&normalized_message_id).copied() {
            let existing_message: &(usize, StudioConversationMessage) =
                &deduped_messages[existing_index];
            if compare_studio_conversation_message_recency(
                &existing_message.1,
                existing_message.0,
                &message,
                index,
            ) != std::cmp::Ordering::Greater
            {
                deduped_messages[existing_index] = (index, message);
            }
            continue;
        }

        deduped_message_indexes.insert(normalized_message_id, deduped_messages.len());
        deduped_messages.push((index, message));
    }

    deduped_messages.sort_by(|left, right| {
        left.1
            .updated_at
            .cmp(&right.1.updated_at)
            .then_with(|| left.1.created_at.cmp(&right.1.created_at))
            .then_with(|| left.0.cmp(&right.0))
    });

    record.messages = deduped_messages
        .into_iter()
        .map(|(_, message)| message)
        .collect();
    record.message_count = record.messages.len() as u64;
    record.last_message_preview = record
        .messages
        .last()
        .map(|message| message.content.chars().take(120).collect::<String>());
    record.updated_at = record.messages.iter().fold(
        record.updated_at.max(record.created_at),
        |max_updated_at, message| max_updated_at.max(message.updated_at),
    );

    record
}

fn conversation_storage_key(id: &str) -> String {
    format!("{CONVERSATION_KEY_PREFIX}{id}")
}

fn persisted_kernel_chat_agent_storage_key_prefix(instance_id: &str) -> String {
    format!("{PERSISTED_KERNEL_CHAT_AGENT_KEY_PREFIX}{instance_id}:")
}

fn persisted_kernel_chat_agent_storage_key(
    instance_id: &str,
    kernel_id: &str,
    agent_id: &str,
) -> String {
    format!("{PERSISTED_KERNEL_CHAT_AGENT_KEY_PREFIX}{instance_id}:{kernel_id}:{agent_id}")
}

struct OpenClawKernelAgentConfigInput {
    id: String,
    display_name: String,
    avatar: Option<String>,
    is_default: bool,
    primary_model: Option<String>,
    fallback_models: Vec<String>,
    workspace: Option<String>,
    agent_dir: Option<String>,
    temperature: Option<f64>,
    top_p: Option<f64>,
    max_tokens: Option<u32>,
    timeout_ms: Option<u32>,
    streaming: Option<bool>,
}

fn trim_required_kernel_agent_field(value: &str, field_name: &str) -> Result<String> {
    let trimmed = value.trim();
    if trimmed.is_empty() {
        return Err(FrameworkError::InvalidOperation(format!(
            "kernel agent field \"{field_name}\" must not be empty"
        )));
    }

    Ok(trimmed.to_string())
}

fn normalize_optional_kernel_agent_field(value: Option<&str>) -> Option<String> {
    value.and_then(|entry| {
        let trimmed = entry.trim();
        if trimmed.is_empty() {
            None
        } else {
            Some(trimmed.to_string())
        }
    })
}

fn create_unsupported_kernel_agent_field_error(
    kernel_id: &str,
    field_name: &str,
) -> FrameworkError {
    FrameworkError::InvalidOperation(format!(
        "kernel \"{kernel_id}\" does not support create field \"{field_name}\""
    ))
}

fn ensure_kernel_agent_field_support(
    kernel_id: &str,
    field_name: &str,
    supported: bool,
    has_explicit_value: bool,
) -> Result<()> {
    if !supported && has_explicit_value {
        return Err(create_unsupported_kernel_agent_field_error(
            kernel_id, field_name,
        ));
    }

    Ok(())
}

fn ensure_kernel_agent_create_input_matches_field_support(
    kernel_id: &str,
    field_support: &StudioKernelAgentCreationFieldSupport,
    input: &StudioCreateKernelAgentInput,
) -> Result<()> {
    ensure_kernel_agent_field_support(
        kernel_id,
        "avatar",
        field_support.avatar,
        normalize_optional_kernel_agent_field(input.avatar.as_deref()).is_some(),
    )?;
    ensure_kernel_agent_field_support(
        kernel_id,
        "isDefault",
        field_support.is_default,
        input.is_default,
    )?;
    ensure_kernel_agent_field_support(
        kernel_id,
        "primaryModel",
        field_support.primary_model,
        normalize_optional_kernel_agent_field(input.primary_model.as_deref()).is_some(),
    )?;
    ensure_kernel_agent_field_support(
        kernel_id,
        "fallbackModels",
        field_support.fallback_models,
        input
            .fallback_models
            .iter()
            .any(|entry| normalize_optional_kernel_agent_field(Some(entry.as_str())).is_some()),
    )?;
    ensure_kernel_agent_field_support(
        kernel_id,
        "workspace",
        field_support.workspace,
        normalize_optional_kernel_agent_field(input.workspace.as_deref()).is_some(),
    )?;
    ensure_kernel_agent_field_support(
        kernel_id,
        "agentDir",
        field_support.agent_dir,
        normalize_optional_kernel_agent_field(input.agent_dir.as_deref()).is_some(),
    )?;
    ensure_kernel_agent_field_support(
        kernel_id,
        "temperature",
        field_support.temperature,
        input.temperature.is_some(),
    )?;
    ensure_kernel_agent_field_support(
        kernel_id,
        "topP",
        field_support.top_p,
        input.top_p.is_some(),
    )?;
    ensure_kernel_agent_field_support(
        kernel_id,
        "maxTokens",
        field_support.max_tokens,
        input.max_tokens.is_some(),
    )?;
    ensure_kernel_agent_field_support(
        kernel_id,
        "timeoutMs",
        field_support.timeout_ms,
        input.timeout_ms.is_some(),
    )?;
    ensure_kernel_agent_field_support(
        kernel_id,
        "streaming",
        field_support.streaming,
        input.streaming.is_some(),
    )?;

    Ok(())
}

fn normalize_kernel_agent_kernel_id(value: Option<&str>) -> Option<String> {
    normalize_optional_kernel_agent_field(value).map(|entry| entry.to_ascii_lowercase())
}

fn kernel_runtime_kind_id(kind: &StudioRuntimeKind) -> String {
    kind.as_serialized().to_string()
}

fn title_case_kernel_identifier(value: &str) -> String {
    value
        .split(['-', '_', '.'])
        .filter(|segment| !segment.is_empty())
        .map(|segment| {
            let mut chars = segment.chars();
            match chars.next() {
                Some(first) => format!("{}{}", first.to_ascii_uppercase(), chars.as_str()),
                None => String::new(),
            }
        })
        .collect::<Vec<_>>()
        .join(" ")
}

fn kernel_agent_creation_kernel_label(kernel_id: &str) -> String {
    match kernel_id {
        "openclaw" => "OpenClaw".to_string(),
        "hermes" => "Hermes".to_string(),
        "zeroclaw" => "ZeroClaw".to_string(),
        "ironclaw" => "IronClaw".to_string(),
        other => title_case_kernel_identifier(other),
    }
}

fn build_kernel_agent_creation_kernel_option(
    kernel_id: &str,
    supported: bool,
    reason_code: Option<StudioKernelAgentCreationReasonCode>,
    reason: Option<String>,
    model_options: Vec<StudioKernelAgentCreationModelOption>,
    field_support: StudioKernelAgentCreationFieldSupport,
) -> StudioKernelAgentCreationKernelOption {
    StudioKernelAgentCreationKernelOption {
        kernel_id: kernel_id.to_string(),
        label: kernel_agent_creation_kernel_label(kernel_id),
        supported,
        reason_code,
        reason,
        model_options,
        field_support,
    }
}

fn build_kernel_agent_creation_field_support(
    avatar: bool,
    is_default: bool,
    primary_model: bool,
    fallback_models: bool,
    workspace: bool,
    agent_dir: bool,
    temperature: bool,
    top_p: bool,
    max_tokens: bool,
    timeout_ms: bool,
    streaming: bool,
) -> StudioKernelAgentCreationFieldSupport {
    StudioKernelAgentCreationFieldSupport {
        avatar,
        is_default,
        primary_model,
        fallback_models,
        workspace,
        agent_dir,
        temperature,
        top_p,
        max_tokens,
        timeout_ms,
        streaming,
    }
}

fn build_openclaw_kernel_agent_creation_field_support() -> StudioKernelAgentCreationFieldSupport {
    build_kernel_agent_creation_field_support(
        true, true, true, true, false, false, true, true, true, true, true,
    )
}

fn build_openclaw_kernel_agent_creation_model_options(
    root: &Value,
) -> Vec<StudioKernelAgentCreationModelOption> {
    let Some(providers) =
        get_nested_value(root, &["models", "providers"]).and_then(Value::as_object)
    else {
        return Vec::new();
    };

    let mut options = Vec::new();
    let mut seen = BTreeSet::new();
    let mut provider_ids = providers.keys().cloned().collect::<Vec<_>>();
    provider_ids.sort();

    for provider_id in provider_ids {
        let Some(provider) = providers.get(provider_id.as_str()) else {
            continue;
        };
        let provider_label = title_case_kernel_identifier(provider_id.as_str());
        let Some(models) = get_nested_value(provider, &["models"]).and_then(Value::as_array) else {
            continue;
        };

        for model in models {
            let Some(model_id) = get_nested_string(model, &["id"]) else {
                continue;
            };
            let Some(value) = build_openclaw_model_ref(provider_id.as_str(), model_id.as_str())
            else {
                continue;
            };
            if !seen.insert(value.clone()) {
                continue;
            }
            let model_label =
                get_nested_string(model, &["name"]).unwrap_or_else(|| model_id.clone());

            options.push(StudioKernelAgentCreationModelOption {
                value: value.clone(),
                label: format!("{provider_label} / {model_label}"),
                provider_id: provider_id.clone(),
                provider_label: provider_label.clone(),
            });
        }
    }

    options.sort_by(|left, right| {
        left.provider_label
            .cmp(&right.provider_label)
            .then_with(|| left.label.cmp(&right.label))
            .then_with(|| left.value.cmp(&right.value))
    });
    options
}

fn ensure_openclaw_model_ref_is_supported(
    supported_model_refs: &BTreeSet<String>,
    model_ref: &str,
    field_name: &str,
) -> Result<()> {
    if supported_model_refs.contains(model_ref) {
        return Ok(());
    }

    Err(FrameworkError::InvalidOperation(format!(
        "kernel agent field \"{field_name}\" references unavailable model \"{model_ref}\""
    )))
}

fn normalize_kernel_agent_fallback_models(
    fallback_models: &[String],
    primary_model: Option<&str>,
) -> Vec<String> {
    let mut seen = BTreeSet::new();
    let mut normalized = Vec::new();

    for fallback_model in fallback_models {
        let Some(candidate) = normalize_optional_kernel_agent_field(Some(fallback_model.as_str()))
        else {
            continue;
        };
        if primary_model.is_some_and(|primary| primary == candidate.as_str()) {
            continue;
        }
        if seen.insert(candidate.clone()) {
            normalized.push(candidate);
        }
    }

    normalized
}

fn normalize_kernel_agent_id(value: &str) -> String {
    let lowered = value.trim().to_ascii_lowercase();
    if lowered.is_empty() {
        return "main".to_string();
    }

    let mut normalized = String::new();
    let mut last_was_dash = false;
    for character in lowered.chars() {
        let next = if character.is_ascii_lowercase()
            || character.is_ascii_digit()
            || character == '.'
            || character == '_'
            || character == '-'
        {
            character
        } else {
            '-'
        };

        if next == '-' {
            if normalized.is_empty() || last_was_dash {
                continue;
            }
            last_was_dash = true;
            normalized.push(next);
        } else {
            last_was_dash = false;
            normalized.push(next);
        }

        if normalized.len() >= 64 {
            break;
        }
    }

    while normalized.ends_with('-') {
        normalized.pop();
    }

    if normalized.is_empty() {
        "main".to_string()
    } else {
        normalized
    }
}

fn ensure_json_object(value: &mut Value) -> &mut Map<String, Value> {
    if !value.is_object() {
        *value = Value::Object(Map::new());
    }

    value.as_object_mut().expect("json object")
}

fn ensure_json_child_object<'a>(
    parent: &'a mut Map<String, Value>,
    key: &str,
) -> &'a mut Map<String, Value> {
    let reset_child = !matches!(parent.get(key), Some(Value::Object(_)));
    if reset_child {
        parent.insert(key.to_string(), Value::Object(Map::new()));
    }

    parent
        .get_mut(key)
        .and_then(Value::as_object_mut)
        .expect("json child object")
}

fn ensure_json_child_array<'a>(
    parent: &'a mut Map<String, Value>,
    key: &str,
) -> &'a mut Vec<Value> {
    let reset_child = !matches!(parent.get(key), Some(Value::Array(_)));
    if reset_child {
        parent.insert(key.to_string(), Value::Array(Vec::new()));
    }

    parent
        .get_mut(key)
        .and_then(Value::as_array_mut)
        .expect("json child array")
}

fn read_json_scalar_string(value: &Value) -> Option<String> {
    match value {
        Value::String(entry) => normalize_optional_kernel_agent_field(Some(entry.as_str())),
        Value::Number(entry) => Some(entry.to_string()),
        Value::Bool(entry) => Some(entry.to_string()),
        _ => None,
    }
}

fn configured_openclaw_agent_id(entry: &Value) -> Option<String> {
    entry
        .as_object()
        .and_then(|object| object.get("id"))
        .and_then(read_json_scalar_string)
        .map(|id| normalize_kernel_agent_id(id.as_str()))
}

fn set_optional_json_string(target: &mut Map<String, Value>, key: &str, value: Option<&str>) {
    match normalize_optional_kernel_agent_field(value) {
        Some(normalized) => {
            target.insert(key.to_string(), Value::String(normalized));
        }
        None => {
            target.remove(key);
        }
    }
}

fn ensure_single_default_openclaw_kernel_agent(agent_list: &mut [Value]) {
    let default_index = agent_list
        .iter()
        .enumerate()
        .find_map(|(index, entry)| {
            entry.as_object().and_then(|object| {
                object
                    .get("default")
                    .and_then(Value::as_bool)
                    .filter(|is_default| *is_default)
                    .map(|_| index)
            })
        })
        .unwrap_or(0);

    for (index, entry) in agent_list.iter_mut().enumerate() {
        let Some(object) = entry.as_object_mut() else {
            continue;
        };
        object.insert("default".to_string(), Value::Bool(index == default_index));
    }
}

fn ensure_built_in_openclaw_standard_agent_paths(root: &mut Value, paths: &AppPaths) {
    remove_nested_value(root, &["agents", "defaults", "workspace"]);
    remove_nested_value(root, &["agents", "defaults", "agentDir"]);

    let root_object = ensure_json_object(root);
    let agents_object = ensure_json_child_object(root_object, "agents");
    if agents_object
        .get("defaults")
        .and_then(Value::as_object)
        .is_some_and(|object| object.is_empty())
    {
        agents_object.remove("defaults");
    }

    let agent_list = ensure_json_child_array(agents_object, "list");
    let main_index = agent_list
        .iter()
        .position(|entry| configured_openclaw_agent_id(entry).as_deref() == Some("main"))
        .unwrap_or_else(|| {
            agent_list.push(Value::Object(Map::new()));
            agent_list.len() - 1
        });

    if !agent_list[main_index].is_object() {
        agent_list[main_index] = Value::Object(Map::new());
    }

    for (index, entry) in agent_list.iter_mut().enumerate() {
        let Some(agent) = entry.as_object_mut() else {
            continue;
        };

        if index == main_index {
            agent.insert("id".to_string(), Value::String("main".to_string()));
            agent
                .entry("name".to_string())
                .or_insert_with(|| Value::String("Main".to_string()));
            agent.insert(
                "workspace".to_string(),
                Value::String(paths.openclaw_workspace_dir.to_string_lossy().into_owned()),
            );
            agent.insert(
                "agentDir".to_string(),
                Value::String(paths.openclaw_main_agent_dir.to_string_lossy().into_owned()),
            );
        }

        agent.insert("default".to_string(), Value::Bool(index == main_index));
    }
}

fn save_openclaw_kernel_agent_to_config_root(
    root: &mut Value,
    input: OpenClawKernelAgentConfigInput,
) {
    let root_object = ensure_json_object(root);
    let agents_object = ensure_json_child_object(root_object, "agents");
    let agent_list = ensure_json_child_array(agents_object, "list");
    let target_index = if let Some(existing_index) = agent_list
        .iter()
        .position(|entry| configured_openclaw_agent_id(entry).as_deref() == Some(input.id.as_str()))
    {
        existing_index
    } else {
        agent_list.push(Value::Object(Map::new()));
        agent_list.len() - 1
    };
    if !agent_list[target_index].is_object() {
        agent_list[target_index] = Value::Object(Map::new());
    }

    let target = agent_list[target_index]
        .as_object_mut()
        .expect("agent config object");
    target.insert("id".to_string(), Value::String(input.id.clone()));
    target.insert("name".to_string(), Value::String(input.display_name));
    set_optional_json_string(target, "workspace", input.workspace.as_deref());
    set_optional_json_string(target, "agentDir", input.agent_dir.as_deref());

    if input.primary_model.is_some() || !input.fallback_models.is_empty() {
        let remove_model = {
            let model_object = ensure_json_child_object(target, "model");
            set_optional_json_string(model_object, "primary", input.primary_model.as_deref());
            if input.fallback_models.is_empty() {
                model_object.remove("fallbacks");
            } else {
                model_object.insert(
                    "fallbacks".to_string(),
                    Value::Array(
                        input
                            .fallback_models
                            .into_iter()
                            .map(Value::String)
                            .collect::<Vec<_>>(),
                    ),
                );
            }
            model_object.is_empty()
        };
        if remove_model {
            target.remove("model");
        }
    } else {
        target.remove("model");
    }

    let mut params = Map::new();
    if let Some(temperature) = input.temperature.and_then(Number::from_f64) {
        params.insert("temperature".to_string(), Value::Number(temperature));
    }
    if let Some(top_p) = input.top_p.and_then(Number::from_f64) {
        params.insert("topP".to_string(), Value::Number(top_p));
    }
    if let Some(max_tokens) = input.max_tokens {
        params.insert(
            "maxTokens".to_string(),
            Value::Number(Number::from(max_tokens)),
        );
    }
    if let Some(timeout_ms) = input.timeout_ms {
        params.insert(
            "timeoutMs".to_string(),
            Value::Number(Number::from(timeout_ms)),
        );
    }
    if let Some(streaming) = input.streaming {
        params.insert("streaming".to_string(), Value::Bool(streaming));
    }
    if params.is_empty() {
        target.remove("params");
    } else {
        target.insert("params".to_string(), Value::Object(params));
    }

    match input.avatar {
        Some(avatar) => {
            let remove_identity = {
                let identity_object = ensure_json_child_object(target, "identity");
                identity_object.insert("emoji".to_string(), Value::String(avatar));
                identity_object.remove("avatar");
                identity_object.is_empty()
            };
            if remove_identity {
                target.remove("identity");
            }
        }
        None => {
            let remove_identity =
                if let Some(identity) = target.get_mut("identity").and_then(Value::as_object_mut) {
                    identity.remove("emoji");
                    identity.remove("avatar");
                    identity.is_empty()
                } else {
                    false
                };
            if remove_identity {
                target.remove("identity");
            }
        }
    }

    if input.is_default {
        for entry in agent_list.iter_mut() {
            let is_target =
                configured_openclaw_agent_id(entry).as_deref() == Some(input.id.as_str());
            let Some(object) = entry.as_object_mut() else {
                continue;
            };
            object.insert("default".to_string(), Value::Bool(is_target));
        }
    } else {
        ensure_single_default_openclaw_kernel_agent(agent_list.as_mut_slice());
    }
}

fn trim_required_storage_field(value: &str, field_name: &str) -> Result<String> {
    let trimmed = value.trim();
    if trimmed.is_empty() {
        return Err(FrameworkError::InvalidOperation(format!(
            "studio storage field \"{field_name}\" must not be empty"
        )));
    }

    Ok(trimmed.to_string())
}

fn normalize_optional_storage_field(value: Option<String>) -> Option<String> {
    value.and_then(|entry| {
        let trimmed = entry.trim();
        if trimmed.is_empty() {
            None
        } else {
            Some(trimmed.to_string())
        }
    })
}

fn chat_storage_profile_id() -> Option<String> {
    Some(CHAT_STORAGE_PROFILE_ID.to_string())
}

fn build_rollout_preview_summary(outcome: PreflightOutcome) -> ManageRolloutPreviewSummary {
    match outcome {
        PreflightOutcome::Admissible => ManageRolloutPreviewSummary {
            total_targets: 1,
            admissible_targets: 1,
            degraded_targets: 0,
            blocked_targets: 0,
            predicted_wave_count: 1,
        },
        PreflightOutcome::AdmissibleDegraded => ManageRolloutPreviewSummary {
            total_targets: 1,
            admissible_targets: 0,
            degraded_targets: 1,
            blocked_targets: 0,
            predicted_wave_count: 1,
        },
        PreflightOutcome::BlockedByVersion
        | PreflightOutcome::BlockedByCapability
        | PreflightOutcome::BlockedByTrust
        | PreflightOutcome::BlockedByPolicy => ManageRolloutPreviewSummary {
            total_targets: 1,
            admissible_targets: 0,
            degraded_targets: 0,
            blocked_targets: 1,
            predicted_wave_count: 0,
        },
    }
}

fn preflight_outcome_label(outcome: PreflightOutcome) -> &'static str {
    match outcome {
        PreflightOutcome::Admissible => "admissible",
        PreflightOutcome::AdmissibleDegraded => "admissibleDegraded",
        PreflightOutcome::BlockedByVersion => "blockedByVersion",
        PreflightOutcome::BlockedByCapability => "blockedByCapability",
        PreflightOutcome::BlockedByTrust => "blockedByTrust",
        PreflightOutcome::BlockedByPolicy => "blockedByPolicy",
    }
}

fn blocked_reason_for_outcome(outcome: PreflightOutcome) -> Option<String> {
    match outcome {
        PreflightOutcome::BlockedByVersion => Some("node-version-mismatch".to_string()),
        PreflightOutcome::BlockedByCapability => Some("missing-required-capability".to_string()),
        PreflightOutcome::BlockedByTrust => Some("node-trust-blocked".to_string()),
        PreflightOutcome::BlockedByPolicy => Some("rollout-policy-blocked".to_string()),
        _ => None,
    }
}

fn built_in_openclaw_lifecycle(supervisor: &SupervisorService) -> Result<OpenClawLifecycle> {
    if supervisor.configured_openclaw_runtime()?.is_none() {
        return Ok(OpenClawLifecycle::Inactive);
    }

    if supervisor.is_openclaw_gateway_running()? {
        Ok(OpenClawLifecycle::Ready)
    } else if supervisor.snapshot()?.services.iter().any(|service| {
        service.id == SERVICE_ID_OPENCLAW_GATEWAY
            && matches!(service.lifecycle, ManagedServiceLifecycle::Failed)
    }) {
        Ok(OpenClawLifecycle::Degraded)
    } else {
        Ok(OpenClawLifecycle::Stopped)
    }
}

fn built_in_openclaw_last_error(supervisor: &SupervisorService) -> Result<Option<String>> {
    if supervisor.configured_openclaw_runtime()?.is_none() {
        return Ok(None);
    }

    Ok(supervisor
        .snapshot()?
        .services
        .into_iter()
        .find(|service| {
            service.id == SERVICE_ID_OPENCLAW_GATEWAY
                && matches!(service.lifecycle, ManagedServiceLifecycle::Failed)
        })
        .and_then(|service| service.last_error))
}

fn project_desktop_host_available_capability_keys(
    supported_capability_keys: &[String],
    supervisor: &SupervisorService,
    desktop_host_status: Option<&EmbeddedHostRuntimeStatus>,
) -> Result<Vec<String>> {
    let mut capability_keys = supported_capability_keys.to_vec();
    let host_surface_usable = desktop_host_status
        .map(|status| matches!(status.lifecycle.as_str(), "ready" | "degraded"))
        .unwrap_or(false);
    let gateway_ready = matches!(
        built_in_openclaw_lifecycle(supervisor)?,
        OpenClawLifecycle::Ready
    );

    if !(host_surface_usable && gateway_ready) {
        capability_keys.retain(|key| key != "manage.openclaw.gateway.invoke");
    }

    Ok(capability_keys)
}

fn built_in_openclaw_gateway_endpoint(
    paths: &AppPaths,
    supervisor: &SupervisorService,
) -> Result<Option<HostEndpointRecord>> {
    let Some(runtime) = supervisor.configured_openclaw_runtime()? else {
        return Ok(None);
    };

    let gateway_running = supervisor.is_openclaw_gateway_running()?;
    let active_port = gateway_running.then_some(runtime.gateway_port);
    let gateway_path = if active_port.is_some() {
        let root = read_openclaw_config(paths)?;
        resolved_openclaw_control_ui_gateway_path(Some(&root), None, None)
    } else {
        String::new()
    };

    Ok(Some(HostEndpointRecord {
        endpoint_id: "openclaw-gateway".to_string(),
        bind_host: "127.0.0.1".to_string(),
        requested_port: runtime.gateway_port,
        active_port,
        scheme: "http".to_string(),
        base_url: active_port.map(|port| format!("http://127.0.0.1:{port}")),
        websocket_url: active_port.map(|port| format!("ws://127.0.0.1:{port}{gateway_path}")),
        loopback_only: true,
        dynamic_port: false,
        last_conflict_at: None,
        last_conflict_reason: None,
    }))
}

fn unix_timestamp_ms() -> Result<u64> {
    Ok(SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|error| FrameworkError::Internal(error.to_string()))?
        .as_millis() as u64)
}

fn read_json5_object(path: &std::path::Path) -> Result<Value> {
    if !path.exists() {
        return Ok(Value::Object(Map::new()));
    }

    let content = fs::read_to_string(path)?;
    let parsed = json5::from_str::<Value>(&content).map_err(|error| {
        FrameworkError::ValidationFailed(format!("invalid json5 config: {error}"))
    })?;

    if parsed.is_object() {
        Ok(parsed)
    } else {
        Err(FrameworkError::ValidationFailed(format!(
            "expected config object at {}",
            path.display()
        )))
    }
}

fn set_nested_string(value: &mut Value, path: &[&str], next: &str) {
    set_nested_value(value, path, Value::String(next.to_string()));
}

fn set_nested_bool(value: &mut Value, path: &[&str], next: bool) {
    set_nested_value(value, path, Value::Bool(next));
}

fn set_nested_u16(value: &mut Value, path: &[&str], next: u16) {
    set_nested_value(value, path, Value::Number(Number::from(next)));
}

fn set_nested_value(value: &mut Value, path: &[&str], next: Value) {
    if path.is_empty() {
        *value = next;
        return;
    }

    let mut current = value;
    for segment in &path[..path.len() - 1] {
        let object = current.as_object_mut().expect("nested objects");
        current = object
            .entry((*segment).to_string())
            .or_insert_with(|| Value::Object(Map::new()));
        if !current.is_object() {
            *current = Value::Object(Map::new());
        }
    }

    current
        .as_object_mut()
        .expect("nested objects")
        .insert(path[path.len() - 1].to_string(), next);
}

fn remove_nested_value(value: &mut Value, path: &[&str]) -> bool {
    if path.is_empty() {
        return false;
    }

    let mut current = value;
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

fn build_openclaw_model_ref(provider_id: &str, model_id: &str) -> Option<String> {
    let normalized_provider_id = provider_id.trim();
    let normalized_model_id = model_id.trim();
    if normalized_model_id.is_empty() {
        return None;
    }

    if normalized_model_id.contains('/') {
        return Some(normalized_model_id.to_string());
    }

    if normalized_provider_id.is_empty() {
        return None;
    }

    Some(format!("{normalized_provider_id}/{normalized_model_id}"))
}

fn infer_openclaw_model_catalog_streaming(model: &Value) -> bool {
    if get_nested_string(model, &["role"]).as_deref() == Some("embedding") {
        return false;
    }

    let id = get_nested_string(model, &["id"])
        .unwrap_or_default()
        .to_ascii_lowercase();
    let name = get_nested_string(model, &["name"])
        .unwrap_or_default()
        .to_ascii_lowercase();
    let api = get_nested_string(model, &["api"])
        .unwrap_or_default()
        .to_ascii_lowercase();

    !(id.contains("embed") || name.contains("embed") || api.contains("embedding"))
}

fn build_openclaw_provider_runtime_params_value(
    config: &StudioWorkbenchLLMProviderConfigRecord,
) -> Value {
    let mut params = Map::new();
    params.insert(
        "temperature".to_string(),
        Number::from_f64(config.temperature)
            .map(Value::Number)
            .unwrap_or_else(|| {
                Value::Number(
                    Number::from_f64(OPENCLAW_PROVIDER_RUNTIME_DEFAULT_TEMPERATURE)
                        .expect("default temperature"),
                )
            }),
    );
    params.insert(
        "topP".to_string(),
        Number::from_f64(config.top_p)
            .map(Value::Number)
            .unwrap_or_else(|| {
                Value::Number(
                    Number::from_f64(OPENCLAW_PROVIDER_RUNTIME_DEFAULT_TOP_P)
                        .expect("default top_p"),
                )
            }),
    );
    params.insert(
        "maxTokens".to_string(),
        Value::Number(Number::from(config.max_tokens)),
    );
    params.insert(
        "timeoutMs".to_string(),
        Value::Number(Number::from(config.timeout_ms)),
    );
    params.insert("streaming".to_string(), Value::Bool(config.streaming));
    Value::Object(params)
}

fn sync_openclaw_defaults_model_selection(
    root: &mut Value,
    provider_id: &str,
    default_model_id: &str,
    reasoning_model_id: Option<&str>,
) {
    let Some(primary_model_ref) = build_openclaw_model_ref(provider_id, default_model_id) else {
        return;
    };

    set_nested_string(
        root,
        &["agents", "defaults", "model", "primary"],
        &primary_model_ref,
    );
    match reasoning_model_id.and_then(|value| build_openclaw_model_ref(provider_id, value)) {
        Some(reasoning_model_ref) => set_nested_value(
            root,
            &["agents", "defaults", "model", "fallbacks"],
            Value::Array(vec![Value::String(reasoning_model_ref)]),
        ),
        None => {
            remove_nested_value(root, &["agents", "defaults", "model", "fallbacks"]);
        }
    }
}

fn sync_openclaw_provider_model_catalog(
    root: &mut Value,
    provider_id: &str,
    models: &[Value],
    default_model_id: &str,
    config: &StudioWorkbenchLLMProviderConfigRecord,
) {
    let normalized_default_model_id = default_model_id.trim();

    for model in models {
        let Some(model_id) = get_nested_string(model, &["id"]) else {
            continue;
        };
        let Some(model_ref) = build_openclaw_model_ref(provider_id, &model_id) else {
            continue;
        };
        let alias = get_nested_string(model, &["name"]).unwrap_or_else(|| model_id.clone());

        set_nested_string(
            root,
            &["agents", "defaults", "models", model_ref.as_str(), "alias"],
            &alias,
        );
        set_nested_bool(
            root,
            &[
                "agents",
                "defaults",
                "models",
                model_ref.as_str(),
                "streaming",
            ],
            infer_openclaw_model_catalog_streaming(model),
        );

        if model_id == normalized_default_model_id {
            set_nested_value(
                root,
                &["agents", "defaults", "models", model_ref.as_str(), "params"],
                build_openclaw_provider_runtime_params_value(config),
            );
        }
    }
}

pub(super) fn read_openclaw_provider_runtime_config(
    root: &Value,
    provider_id: &str,
    model_id: &str,
) -> StudioWorkbenchLLMProviderConfigRecord {
    let Some(model_ref) = build_openclaw_model_ref(provider_id, model_id) else {
        return StudioWorkbenchLLMProviderConfigRecord {
            temperature: OPENCLAW_PROVIDER_RUNTIME_DEFAULT_TEMPERATURE,
            top_p: OPENCLAW_PROVIDER_RUNTIME_DEFAULT_TOP_P,
            max_tokens: OPENCLAW_PROVIDER_RUNTIME_DEFAULT_MAX_TOKENS,
            timeout_ms: OPENCLAW_PROVIDER_RUNTIME_DEFAULT_TIMEOUT_MS,
            streaming: true,
        };
    };

    let temperature_path = [
        "agents",
        "defaults",
        "models",
        model_ref.as_str(),
        "params",
        "temperature",
    ];
    let top_p_path = [
        "agents",
        "defaults",
        "models",
        model_ref.as_str(),
        "params",
        "topP",
    ];
    let max_tokens_path = [
        "agents",
        "defaults",
        "models",
        model_ref.as_str(),
        "params",
        "maxTokens",
    ];
    let timeout_ms_path = [
        "agents",
        "defaults",
        "models",
        model_ref.as_str(),
        "params",
        "timeoutMs",
    ];
    let streaming_path = [
        "agents",
        "defaults",
        "models",
        model_ref.as_str(),
        "params",
        "streaming",
    ];

    StudioWorkbenchLLMProviderConfigRecord {
        temperature: get_nested_f64(root, &temperature_path)
            .unwrap_or(OPENCLAW_PROVIDER_RUNTIME_DEFAULT_TEMPERATURE),
        top_p: get_nested_f64(root, &top_p_path).unwrap_or(OPENCLAW_PROVIDER_RUNTIME_DEFAULT_TOP_P),
        max_tokens: get_nested_u32(root, &max_tokens_path)
            .unwrap_or(OPENCLAW_PROVIDER_RUNTIME_DEFAULT_MAX_TOKENS),
        timeout_ms: get_nested_u32(root, &timeout_ms_path)
            .unwrap_or(OPENCLAW_PROVIDER_RUNTIME_DEFAULT_TIMEOUT_MS),
        streaming: get_nested_bool_value(root, &streaming_path).unwrap_or(true),
    }
}

fn write_openclaw_config_file(paths: &AppPaths, root: &Value) -> Result<()> {
    let config_path = authority_openclaw_config_file_path(paths);
    if let Some(parent) = config_path.parent() {
        fs::create_dir_all(parent)?;
    }
    let mut normalized_root = root.clone();
    let channel_ids = resolve_openclaw_config_writer_channel_ids(paths);
    sanitize_openclaw_channel_config(&mut normalized_root, &channel_ids);
    fs::write(
        config_path,
        format!("{}\n", serde_json::to_string_pretty(&normalized_root)?),
    )?;
    Ok(())
}

fn resolve_openclaw_config_writer_channel_ids(paths: &AppPaths) -> std::collections::BTreeSet<String> {
    read_active_openclaw_runtime_install_key(paths)
        .and_then(|install_key| {
            let runtime_dir = paths
                .openclaw_runtime_dir
                .join(install_key)
                .join("runtime");
            collect_openclaw_runtime_channel_ids(&runtime_dir).ok()
        })
        .unwrap_or_else(bundled_openclaw_channel_id_set)
}

fn read_active_openclaw_runtime_install_key(paths: &AppPaths) -> Option<String> {
    let active_content = fs::read_to_string(&paths.active_file).ok()?;
    let active = serde_json::from_str::<ActiveState>(&active_content).ok()?;
    active
        .runtimes
        .get("openclaw")
        .and_then(|entry| entry.active_runtime_install_key().map(str::to_string))
}

fn read_openclaw_config(paths: &AppPaths) -> Result<Value> {
    read_json5_object(&readable_openclaw_config_file_path(paths))
}

fn openclaw_config_target(paths: &AppPaths) -> String {
    authority_openclaw_config_file_path(paths)
        .to_string_lossy()
        .into_owned()
}

fn hermes_state_root(paths: &AppPaths) -> PathBuf {
    paths
        .kernel_paths("hermes")
        .map(|kernel| kernel.config_dir)
        .unwrap_or_else(|_| build_standard_hermes_root_dir(&paths.user_root))
}

fn hermes_config_file_path(paths: &AppPaths) -> PathBuf {
    paths
        .kernel_paths("hermes")
        .map(|kernel| kernel.config_file)
        .unwrap_or_else(|_| build_standard_hermes_config_file_path(&paths.user_root))
}

fn hermes_config_target(paths: &AppPaths) -> String {
    hermes_config_file_path(paths)
        .to_string_lossy()
        .into_owned()
}

fn hermes_workspace_target(paths: &AppPaths) -> String {
    hermes_state_root(paths)
        .join("workspace")
        .to_string_lossy()
        .into_owned()
}

fn hermes_logs_target(paths: &AppPaths) -> String {
    hermes_state_root(paths)
        .join("logs")
        .to_string_lossy()
        .into_owned()
}

fn hermes_runtime_target(paths: &AppPaths) -> String {
    paths
        .kernel_paths("hermes")
        .map(|kernel| kernel.runtime_dir)
        .unwrap_or_else(|_| paths.managed_runtimes_dir.join("hermes"))
        .to_string_lossy()
        .into_owned()
}

fn built_in_openclaw_runtime_dir(paths: &AppPaths) -> PathBuf {
    paths
        .kernel_paths("openclaw")
        .map(|kernel| kernel.runtime_dir)
        .expect("canonical openclaw runtime path")
}

fn readable_openclaw_config_file_path(paths: &AppPaths) -> PathBuf {
    authority_openclaw_config_file_path(paths)
}

fn authority_openclaw_config_file_path(paths: &AppPaths) -> PathBuf {
    KernelRuntimeAuthorityService::new()
        .active_config_file_path("openclaw", paths)
        .expect("canonical openclaw config path")
}

fn build_openclaw_provider_model_value(id: &str, role: &str, existing: Option<&Value>) -> Value {
    let mut next = existing
        .and_then(Value::as_object)
        .cloned()
        .unwrap_or_default();
    next.insert("id".to_string(), Value::String(id.to_string()));
    if !next.contains_key("name") {
        next.insert("name".to_string(), Value::String(id.to_string()));
    }
    next.insert("role".to_string(), Value::String(role.to_string()));
    Value::Object(next)
}

fn upsert_openclaw_provider_models(
    existing_models: Vec<Value>,
    default_model_id: &str,
    reasoning_model_id: Option<&str>,
    embedding_model_id: Option<&str>,
) -> Vec<Value> {
    let mut existing_by_id = BTreeMap::new();
    let mut passthrough = Vec::new();

    for item in existing_models {
        let Some(item_id) = item
            .get("id")
            .and_then(Value::as_str)
            .map(str::trim)
            .filter(|value| !value.is_empty())
        else {
            passthrough.push(item);
            continue;
        };

        existing_by_id.insert(item_id.to_string(), item);
    }

    let default_model_id = default_model_id.trim();
    let reasoning_model_id = reasoning_model_id.map(str::trim);
    let embedding_model_id = embedding_model_id.map(str::trim);
    let mut next = Vec::new();

    if !default_model_id.is_empty() {
        next.push(build_openclaw_provider_model_value(
            default_model_id,
            "primary",
            existing_by_id.get(default_model_id),
        ));
    }
    if let Some(reasoning_model_id) = reasoning_model_id.filter(|value| !value.is_empty()) {
        if reasoning_model_id != default_model_id {
            next.push(build_openclaw_provider_model_value(
                reasoning_model_id,
                "reasoning",
                existing_by_id.get(reasoning_model_id),
            ));
        }
    }
    if let Some(embedding_model_id) = embedding_model_id.filter(|value| !value.is_empty()) {
        if embedding_model_id != default_model_id && Some(embedding_model_id) != reasoning_model_id
        {
            next.push(build_openclaw_provider_model_value(
                embedding_model_id,
                "embedding",
                existing_by_id.get(embedding_model_id),
            ));
        }
    }

    for (id, item) in existing_by_id {
        if id == default_model_id
            || reasoning_model_id == Some(id.as_str())
            || embedding_model_id == Some(id.as_str())
        {
            continue;
        }
        next.push(item);
    }
    next.extend(passthrough);
    next
}

fn get_nested_string(value: &Value, path: &[&str]) -> Option<String> {
    let mut current = value;
    for segment in path {
        current = current.as_object()?.get(*segment)?;
    }

    current.as_str().map(|item| item.to_string())
}

fn get_nested_bool(value: &Value, path: &[&str]) -> Option<bool> {
    let mut current = value;
    for segment in path {
        current = current.as_object()?.get(*segment)?;
    }

    current.as_bool()
}

fn get_nested_u16(value: &Value, path: &[&str]) -> Option<u16> {
    let mut current = value;
    for segment in path {
        current = current.as_object()?.get(*segment)?;
    }

    current.as_u64().and_then(|item| u16::try_from(item).ok())
}

fn get_nested_f64(value: &Value, path: &[&str]) -> Option<f64> {
    get_nested_value(value, path).and_then(|current| {
        current.as_f64().or_else(|| {
            current
                .as_str()
                .and_then(|item| item.trim().parse::<f64>().ok())
        })
    })
}

fn get_nested_u32(value: &Value, path: &[&str]) -> Option<u32> {
    get_nested_value(value, path).and_then(|current| {
        current
            .as_u64()
            .and_then(|item| u32::try_from(item).ok())
            .or_else(|| {
                current
                    .as_str()
                    .and_then(|item| item.trim().parse::<u32>().ok())
            })
    })
}

fn get_nested_bool_value(value: &Value, path: &[&str]) -> Option<bool> {
    get_nested_value(value, path).and_then(|current| {
        current.as_bool().or_else(|| match current.as_str() {
            Some("true") => Some(true),
            Some("false") => Some(false),
            _ => None,
        })
    })
}

fn get_nested_value<'a>(value: &'a Value, path: &[&str]) -> Option<&'a Value> {
    let mut current = value;
    for segment in path {
        current = current.as_object()?.get(*segment)?;
    }

    Some(current)
}

#[cfg(test)] // WORKSPACE-PATH:allow-fixture-block: this module is the file's #[cfg(test)] unit-test fixture data
mod tests {
    use super::{
        built_in_openclaw_last_error, built_in_openclaw_lifecycle, bundled_openclaw_version,
        console_install_method_from_install_record, default_storage_binding, get_nested_string,
        get_nested_value, percent_encode_url_component, read_json5_object,
        write_openclaw_config_file, EmbeddedHostRuntimeStatus, InstanceRegistryDocument,
        PartialStudioInstanceConfig, StudioConversationMessage, StudioConversationMessageStatus,
        StudioConversationRecord, StudioConversationRole, StudioCreateInstanceInput,
        StudioCreateKernelAgentInput, StudioInstanceArtifactKind, StudioInstanceAuthMode,
        StudioInstanceCapability, StudioInstanceCapabilityStatus, StudioInstanceConfig,
        StudioInstanceConsoleInstallMethod, StudioInstanceDataAccessMode,
        StudioInstanceDataAccessScope, StudioInstanceDeploymentMode, StudioInstanceIconType,
        StudioInstanceLifecycleOwner, StudioInstanceRecord, StudioInstanceStatus,
        StudioInstanceStorageStatus, StudioInstanceTransportKind,
        StudioKernelAgentCreationFieldSupport, StudioRuntimeKind, StudioService,
        StudioUpdateInstanceLlmProviderConfigInput, StudioWorkbenchLLMProviderConfigRecord,
        DEFAULT_INSTANCE_ID,
    };
    use crate::framework::openclaw_release::required_openclaw_node_version;
    use crate::framework::{
        config::AppConfig,
        install_records::{
            write_install_record, EffectiveRuntimePlatform, InstallControlLevel, InstallRecord,
            InstallRecordStatus, InstallScope, SupportedPlatform,
            OPENCLAW_INSTALL_RECORDS_HOME_NAME,
        },
        paths::resolve_paths_for_root,
        services::{
            kernel_runtime_authority::KernelRuntimeAuthorityService,
            openclaw_runtime::ActivatedOpenClawRuntime,
            storage::StorageService,
            supervisor::{SupervisorService, SERVICE_ID_OPENCLAW_GATEWAY},
        },
        storage::StorageProviderKind,
    };
    use sdkwork_agentstudio_host_core::host_endpoints::OpenClawLifecycle;
    use sdkwork_agentstudio_host_core::openclaw_control_plane::OpenClawGatewayInvokeRequest;
    use sdkwork_agentstudio_server::bootstrap::{
        ServerStateStoreProfileRecord, ServerStateStoreProviderRecord, ServerStateStoreSnapshot,
    };
    use serde_json::{json, Value};
    use std::{
        collections::BTreeMap,
        fs,
        io::{Read, Write},
        net::{TcpListener, TcpStream},
        path::PathBuf,
        sync::{
            atomic::{AtomicBool, Ordering},
            Arc, Mutex,
        },
        thread::{self, JoinHandle},
        time::Duration,
    };

    fn stale_authority_config_file_path(paths: &crate::framework::paths::AppPaths) -> PathBuf {
        paths
            .openclaw_kernel_dir
            .join("stale-config")
            .join("openclaw.json")
    }

    #[test]
    fn studio_runtime_kind_preserves_unknown_kernel_ids_during_json_round_trip() {
        let parsed: StudioRuntimeKind =
            serde_json::from_str("\"nova\"").expect("unknown runtime kind should deserialize");

        assert_eq!(parsed, StudioRuntimeKind::Other("nova".to_string()));
        assert_eq!(
            serde_json::to_string(&parsed).expect("unknown runtime kind should serialize"),
            "\"nova\""
        );
    }

    #[test]
    fn studio_transport_kind_preserves_unknown_transport_ids_during_json_round_trip() {
        let parsed: StudioInstanceTransportKind = serde_json::from_str("\"novaSocket\"")
            .expect("unknown transport kind should deserialize");

        assert_eq!(
            parsed,
            StudioInstanceTransportKind::Other("novaSocket".to_string())
        );
        assert_eq!(
            serde_json::to_string(&parsed).expect("unknown transport kind should serialize"),
            "\"novaSocket\""
        );
    }

    fn studio_context() -> (
        tempfile::TempDir,
        crate::framework::paths::AppPaths,
        AppConfig,
        StorageService,
        StudioService,
    ) {
        let root = tempfile::tempdir().expect("temp dir");
        let paths = resolve_paths_for_root(root.path()).expect("paths");
        let config = AppConfig::default();
        let storage = StorageService::new();
        let service = StudioService::new();

        (root, paths, config, storage, service)
    }

    fn write_openclaw_manifest(
        paths: &crate::framework::paths::AppPaths,
        install_key: &str,
        openclaw_version: &str,
    ) {
        let install_dir = paths.openclaw_runtime_dir.join(install_key);
        fs::create_dir_all(&install_dir).expect("create install dir");
        fs::write(
            install_dir.join("manifest.json"),
            format!(
                r#"{{
  "schemaVersion": 2,
  "runtimeId": "openclaw",
  "openclawVersion": "{openclaw_version}",
  "requiredExternalRuntimes": ["nodejs"],
  "requiredExternalRuntimeVersions": {{
    "nodejs": "{}"
  }},
  "platform": "windows",
  "arch": "x64",
  "cliRelativePath": "runtime/package/node_modules/openclaw/openclaw.mjs"
}}"#,
                required_openclaw_node_version()
            ),
        )
        .expect("write manifest");
    }

    fn write_openclaw_channel_metadata(
        paths: &crate::framework::paths::AppPaths,
        install_key: &str,
        channel_id: &str,
    ) {
        let package_json_path = paths
            .openclaw_runtime_dir
            .join(install_key)
            .join("runtime")
            .join("package")
            .join("node_modules")
            .join("openclaw")
            .join("dist")
            .join("extensions")
            .join(channel_id)
            .join("package.json");
        fs::create_dir_all(
            package_json_path
                .parent()
                .expect("test OpenClaw channel metadata parent"),
        )
        .expect("create test OpenClaw channel metadata dir");
        fs::write(
            package_json_path,
            format!(
                r#"{{
  "name": "@openclaw/{channel_id}",
  "version": "0.0.0-test",
  "openclaw": {{
    "extensions": ["./index.js"],
    "channel": {{
      "id": "{channel_id}",
      "label": "{channel_id}"
    }}
  }}
}}
"#
            ),
        )
        .expect("write test OpenClaw channel metadata package");
    }

    fn openclaw_fixture_version(patch_offset: i32) -> String {
        let numeric_version = bundled_openclaw_version()
            .split('-')
            .next()
            .expect("openclaw numeric version prefix");
        let parts = numeric_version
            .split('.')
            .map(|part| part.parse::<i32>().expect("numeric openclaw version part"))
            .collect::<Vec<_>>();
        assert_eq!(parts.len(), 3);
        let shifted_patch = parts[2] + patch_offset;
        assert!(shifted_patch >= 0);
        format!("{}.{}.{}", parts[0], parts[1], shifted_patch)
    }

    fn openclaw_config_file_path(paths: &crate::framework::paths::AppPaths) -> std::path::PathBuf {
        KernelRuntimeAuthorityService::new()
            .active_config_file_path("openclaw", paths)
            .expect("canonical openclaw config path")
    }

    fn desktop_host_snapshot_fixture(
    ) -> crate::framework::embedded_host_server::EmbeddedHostRuntimeSnapshot {
        crate::framework::embedded_host_server::EmbeddedHostRuntimeSnapshot {
            mode: "desktopCombined".to_string(),
            api_base_path: "/claw/api/v1".to_string(),
            manage_base_path: "/claw/manage/v1".to_string(),
            internal_base_path: "/claw/internal/v1".to_string(),
            browser_base_url: "http://127.0.0.1:21289".to_string(),
            browser_session_token: "desktop-session-token".to_string(),
            endpoint: sdkwork_agentstudio_host_core::host_endpoints::HostEndpointRecord {
                endpoint_id: "claw-manage-http".to_string(),
                bind_host: "127.0.0.1".to_string(),
                requested_port: 21_289,
                active_port: Some(21_289),
                scheme: "http".to_string(),
                base_url: Some("http://127.0.0.1:21289".to_string()),
                websocket_url: None,
                loopback_only: true,
                dynamic_port: false,
                last_conflict_at: None,
                last_conflict_reason: None,
            },
            state_store_driver: "sqlite".to_string(),
            state_store: ServerStateStoreSnapshot {
                active_profile_id: "default-sqlite".to_string(),
                providers: vec![ServerStateStoreProviderRecord {
                    id: "sqlite".to_string(),
                    label: "SQLite Host State".to_string(),
                    availability: "ready".to_string(),
                    requires_configuration: false,
                    configuration_keys: Vec::new(),
                    projection_mode: "runtime".to_string(),
                }],
                profiles: vec![ServerStateStoreProfileRecord {
                    id: "default-sqlite".to_string(),
                    label: "SQLite Host State".to_string(),
                    driver: "sqlite".to_string(),
                    active: true,
                    availability: "ready".to_string(),
                    path: Some("machine-state/desktop-host/host-state.sqlite3".to_string()),
                    connection_configured: true,
                    configured_keys: vec!["path".to_string()],
                    projection_mode: "runtime".to_string(),
                }],
            },
            runtime_data_dir: std::path::PathBuf::from("/tmp/desktop-host"),
            web_dist_dir: std::path::PathBuf::from("/tmp/web-dist"),
        }
    }

    #[test]
    fn host_platform_status_projects_embedded_host_state_store_metadata() {
        let (_root, paths, config, storage, service) = studio_context();
        let (supervisor, _server) = configured_openclaw_supervisor(&paths);
        let desktop_host_snapshot = desktop_host_snapshot_fixture();
        let desktop_host_status = EmbeddedHostRuntimeStatus {
            lifecycle: "ready".to_string(),
            last_error: None,
        };

        let status = service
            .get_host_platform_status(
                &paths,
                &config,
                &storage,
                &supervisor,
                Some(&desktop_host_snapshot),
                Some(&desktop_host_status),
            )
            .expect("host platform status");

        assert_eq!(status.lifecycle, "ready");
        assert_eq!(status.state_store_driver, "sqlite");
        assert_eq!(status.state_store.active_profile_id, "default-sqlite");
        assert_eq!(status.state_store.profiles.len(), 1);
    }

    #[test]
    fn host_platform_status_uses_embedded_host_runtime_lifecycle_when_surface_is_not_ready() {
        let (_root, paths, config, storage, service) = studio_context();
        let (supervisor, _server) = configured_openclaw_supervisor(&paths);
        let desktop_host_snapshot = desktop_host_snapshot_fixture();
        let desktop_host_status = EmbeddedHostRuntimeStatus {
            lifecycle: "stopped".to_string(),
            last_error: Some("embedded desktop host stopped unexpectedly".to_string()),
        };

        let status = service
            .get_host_platform_status(
                &paths,
                &config,
                &storage,
                &supervisor,
                Some(&desktop_host_snapshot),
                Some(&desktop_host_status),
            )
            .expect("host platform status");

        assert_eq!(status.lifecycle, "stopped");
    }

    #[test]
    fn host_platform_status_reports_stopped_when_embedded_host_is_unavailable() {
        let (_root, paths, config, storage, service) = studio_context();
        let (supervisor, _server) = configured_openclaw_supervisor(&paths);

        let status = service
            .get_host_platform_status(&paths, &config, &storage, &supervisor, None, None)
            .expect("host platform status");

        assert_eq!(status.lifecycle, "stopped");
    }

    #[test]
    fn host_platform_status_remains_ready_when_embedded_host_is_ready_and_gateway_is_stopped() {
        let (_root, paths, config, storage, service) = studio_context();
        let supervisor = SupervisorService::new();
        let desktop_host_snapshot = desktop_host_snapshot_fixture();
        let desktop_host_status = EmbeddedHostRuntimeStatus {
            lifecycle: "ready".to_string(),
            last_error: None,
        };

        let status = service
            .get_host_platform_status(
                &paths,
                &config,
                &storage,
                &supervisor,
                Some(&desktop_host_snapshot),
                Some(&desktop_host_status),
            )
            .expect("host platform status");

        assert_eq!(status.lifecycle, "ready");
    }

    #[test]
    fn host_platform_status_matches_desktop_combined_capability_contract() {
        let (_root, paths, config, storage, service) = studio_context();
        let (supervisor, _server) = configured_openclaw_supervisor(&paths);
        let desktop_host_snapshot = desktop_host_snapshot_fixture();
        let desktop_host_status = EmbeddedHostRuntimeStatus {
            lifecycle: "ready".to_string(),
            last_error: None,
        };

        let status = service
            .get_host_platform_status(
                &paths,
                &config,
                &storage,
                &supervisor,
                Some(&desktop_host_snapshot),
                Some(&desktop_host_status),
            )
            .expect("host platform status");

        assert_eq!(
            status.supported_capability_keys,
            sdkwork_agentstudio_server::bootstrap::host_platform_capability_keys_for_mode(
                "desktopCombined",
            )
        );
        assert_eq!(
            status.available_capability_keys,
            status.supported_capability_keys
        );
        assert_eq!(status.capability_keys, status.available_capability_keys);
    }

    #[test]
    fn host_platform_status_keeps_gateway_invoke_available_when_degraded_host_surface_is_usable() {
        let (_root, paths, config, storage, service) = studio_context();
        let (supervisor, _server) = configured_openclaw_supervisor(&paths);
        let desktop_host_snapshot = desktop_host_snapshot_fixture();
        let desktop_host_status = EmbeddedHostRuntimeStatus {
            lifecycle: "degraded".to_string(),
            last_error: Some(
                "background worker exited after the host surface was published".to_string(),
            ),
        };

        let status = service
            .get_host_platform_status(
                &paths,
                &config,
                &storage,
                &supervisor,
                Some(&desktop_host_snapshot),
                Some(&desktop_host_status),
            )
            .expect("host platform status");

        assert_eq!(status.lifecycle, "degraded");
        assert!(status
            .supported_capability_keys
            .contains(&"manage.openclaw.gateway.invoke".to_string()));
        assert!(status
            .available_capability_keys
            .contains(&"manage.openclaw.gateway.invoke".to_string()));
        assert_eq!(status.capability_keys, status.available_capability_keys);
    }

    #[test]
    fn host_platform_status_excludes_gateway_invoke_from_available_capabilities_when_runtime_is_not_ready(
    ) {
        let (_root, paths, config, storage, service) = studio_context();
        let supervisor = SupervisorService::new();
        let desktop_host_snapshot = desktop_host_snapshot_fixture();
        let desktop_host_status = EmbeddedHostRuntimeStatus {
            lifecycle: "ready".to_string(),
            last_error: None,
        };

        let status = service
            .get_host_platform_status(
                &paths,
                &config,
                &storage,
                &supervisor,
                Some(&desktop_host_snapshot),
                Some(&desktop_host_status),
            )
            .expect("host platform status");

        assert!(status
            .supported_capability_keys
            .contains(&"manage.openclaw.gateway.invoke".to_string()));
        assert!(!status
            .available_capability_keys
            .contains(&"manage.openclaw.gateway.invoke".to_string()));
        assert_eq!(status.capability_keys, status.available_capability_keys);
    }

    #[test]
    fn built_in_openclaw_lifecycle_ignores_stale_failed_service_when_runtime_is_not_configured() {
        let supervisor = SupervisorService::new();
        supervisor
            .record_stopped(
                SERVICE_ID_OPENCLAW_GATEWAY,
                None,
                Some("stale gateway failure from a previous kernel profile".to_string()),
            )
            .expect("record stale failed gateway service");

        let lifecycle =
            built_in_openclaw_lifecycle(&supervisor).expect("project built-in lifecycle");
        let last_error =
            built_in_openclaw_last_error(&supervisor).expect("project built-in last error");

        assert_eq!(lifecycle, OpenClawLifecycle::Inactive);
        assert_eq!(last_error, None);
    }

    #[test]
    fn built_in_display_version_keeps_active_runtime_install_when_newer_runtime_is_only_staged() {
        let (_root, paths, _config, _storage, _service) = studio_context();
        let latest_version = crate::framework::openclaw_release::bundled_openclaw_version();
        let stale_version = "0.0.1";
        write_openclaw_manifest(
            &paths,
            &format!("{stale_version}-windows-x64"),
            stale_version,
        );
        write_openclaw_manifest(
            &paths,
            &format!("{latest_version}-windows-x64"),
            latest_version,
        );
        fs::write(
            &paths.active_file,
            format!(
                r#"{{
  "layoutVersion": 1,
  "modules": {{}},
  "runtimes": {{
    "openclaw": {{
      "activeInstallKey": "{stale_version}-windows-x64",
      "activeVersionLabel": "{stale_version}"
    }}
  }}
}}"#
            ),
        )
        .expect("write active file");

        assert_eq!(
            super::resolve_built_in_openclaw_display_version(&paths),
            stale_version.to_string()
        );
    }

    #[test]
    fn built_in_display_version_keeps_active_runtime_install_when_bundled_release_is_newer() {
        let (_root, paths, _config, _storage, _service) = studio_context();
        let stale_version = "0.0.1";
        write_openclaw_manifest(
            &paths,
            &format!("{stale_version}-windows-x64"),
            stale_version,
        );
        fs::write(
            &paths.active_file,
            format!(
                r#"{{
  "layoutVersion": 1,
  "modules": {{}},
  "runtimes": {{
    "openclaw": {{
      "activeInstallKey": "{stale_version}-windows-x64",
      "activeVersionLabel": "{stale_version}"
    }}
  }}
}}"#
            ),
        )
        .expect("write active file");

        assert_eq!(
            super::resolve_built_in_openclaw_display_version(&paths),
            stale_version.to_string()
        );
    }

    #[test]
    fn built_in_display_version_prefers_authority_version_label_over_install_key_parsing() {
        let (_root, paths, _config, _storage, _service) = studio_context();
        let version = format!("{}-beta.1", bundled_openclaw_version());
        write_openclaw_manifest(&paths, "openclaw-nightly-windows-x64", &version);
        fs::write(
            &paths.openclaw_authority_file,
            format!(
                r#"{{
  "layoutVersion": 1,
  "runtimeId": "openclaw",
  "activeInstallKey": "openclaw-nightly-windows-x64",
  "fallbackInstallKey": null,
  "activeVersionLabel": "{version}",
  "fallbackVersionLabel": null,
  "configFilePath": null,
  "ownedRuntimeRoots": [],
  "quarantinedPaths": [],
  "lastActivationAt": null,
  "lastError": null
}}"#
            ),
        )
        .expect("write authority state");
        fs::write(
            &paths.active_file,
            r#"{
  "layoutVersion": 1,
  "modules": {},
  "runtimes": {
    "openclaw": {
      "activeInstallKey": "openclaw-nightly-windows-x64"
    }
  }
}"#,
        )
        .expect("write active file");

        assert_eq!(
            super::resolve_built_in_openclaw_display_version(&paths),
            version
        );
    }

    #[test]
    fn built_in_display_version_uses_manifest_when_authority_label_is_not_current_metadata() {
        let (_root, paths, _config, _storage, _service) = studio_context();
        let version = bundled_openclaw_version();
        write_openclaw_manifest(&paths, "openclaw-nightly-windows-x64", version);
        fs::write(
            &paths.openclaw_authority_file,
            r#"{
  "layoutVersion": 1,
  "runtimeId": "openclaw",
  "activeInstallKey": "openclaw-nightly-windows-x64",
  "fallbackInstallKey": null,
  "activeVersionLabel": "openclaw-nightly-windows-x64",
  "fallbackVersionLabel": null,
  "configFilePath": null,
  "ownedRuntimeRoots": [],
  "quarantinedPaths": [],
  "lastActivationAt": null,
  "lastError": null
}"#,
        )
        .expect("write authority state");

        assert_eq!(
            super::resolve_built_in_openclaw_display_version(&paths),
            version.to_string()
        );
    }

    #[test]
    fn built_in_display_version_reads_canonical_authority_and_runtime_paths_when_noncanonical_app_path_fields_drift(
    ) {
        let (root, mut paths, _config, _storage, _service) = studio_context();
        let install_key = "openclaw-nightly-windows-x64";
        let version = format!("{}-beta.1", bundled_openclaw_version());
        let openclaw = paths
            .kernel_paths("openclaw")
            .expect("openclaw kernel paths");

        write_openclaw_manifest(&paths, install_key, &version);
        paths.openclaw_authority_file = root
            .path()
            .join("noncanonical-app-paths")
            .join("authority.json");
        paths.openclaw_runtime_dir = root.path().join("noncanonical-app-paths").join("runtime");
        fs::write(
            &openclaw.authority_file,
            format!(
                r#"{{
  "layoutVersion": 1,
  "runtimeId": "openclaw",
  "activeInstallKey": "{install_key}",
  "fallbackInstallKey": null,
  "activeVersionLabel": "{version}",
  "fallbackVersionLabel": null,
  "configFilePath": null,
  "ownedRuntimeRoots": [],
  "quarantinedPaths": [],
  "lastActivationAt": null,
  "lastError": null
}}"#
            ),
        )
        .expect("write authority state");
        fs::write(
            &paths.active_file,
            format!(
                r#"{{
  "layoutVersion": 1,
  "modules": {{}},
  "runtimes": {{
    "openclaw": {{
      "activeInstallKey": "{install_key}",
      "activeVersionLabel": "{version}"
    }}
  }}
}}"#
            ),
        )
        .expect("write active file");

        assert_eq!(
            super::resolve_built_in_openclaw_display_version(&paths),
            version
        );
    }

    #[test]
    fn built_in_display_version_uses_active_state_version_label_when_authority_is_missing() {
        let (_root, paths, _config, _storage, _service) = studio_context();
        let version = format!("{}-beta.1", bundled_openclaw_version());
        write_openclaw_manifest(&paths, "openclaw-nightly-windows-x64", &version);
        fs::write(
            &paths.active_file,
            format!(
                r#"{{
  "layoutVersion": 1,
  "modules": {{}},
  "runtimes": {{
    "openclaw": {{
      "activeInstallKey": "openclaw-nightly-windows-x64",
      "activeVersionLabel": "{version}"
    }}
  }}
}}"#
            ),
        )
        .expect("write active file");

        assert_eq!(
            super::resolve_built_in_openclaw_display_version(&paths),
            version
        );
    }

    #[test]
    fn built_in_display_version_ignores_missing_active_runtime_and_uses_latest_current_install() {
        let (_root, paths, _config, _storage, _service) = studio_context();
        let latest_version = crate::framework::openclaw_release::bundled_openclaw_version();
        let stale_version = openclaw_fixture_version(-1);
        write_openclaw_manifest(
            &paths,
            &format!("{latest_version}-windows-x64"),
            latest_version,
        );
        fs::write(
            &paths.active_file,
            format!(
                r#"{{
  "layoutVersion": 1,
  "modules": {{}},
  "runtimes": {{
    "openclaw": {{
      "activeInstallKey": "{stale_version}-windows-x64",
      "activeVersionLabel": "{stale_version}"
    }}
  }}
}}"#
            ),
        )
        .expect("write active file");

        assert_eq!(
            super::resolve_built_in_openclaw_display_version(&paths),
            latest_version.to_string()
        );
    }

    #[test]
    fn built_in_display_version_ignores_missing_authority_runtime_and_falls_back_to_bundled_version(
    ) {
        let (_root, paths, _config, _storage, _service) = studio_context();
        fs::write(
            &paths.openclaw_authority_file,
            format!(
                r#"{{
  "layoutVersion": 1,
  "runtimeId": "openclaw",
  "activeInstallKey": "{}-windows-x64",
  "fallbackInstallKey": null,
  "activeVersionLabel": "{}",
  "fallbackVersionLabel": null,
  "configFilePath": null,
  "ownedRuntimeRoots": [],
  "quarantinedPaths": [],
  "lastActivationAt": null,
  "lastError": null
}}"#,
                openclaw_fixture_version(-1),
                openclaw_fixture_version(-1)
            ),
        )
        .expect("write authority state");

        assert_eq!(
            super::resolve_built_in_openclaw_display_version(&paths),
            bundled_openclaw_version().to_string()
        );
    }

    #[test]
    fn read_active_openclaw_install_key_prefers_explicit_install_key_over_version_alias() {
        let (_root, paths, _config, _storage, _service) = studio_context();
        let version = format!("{}-beta.1", bundled_openclaw_version());
        fs::write(
            &paths.active_file,
            format!(
                r#"{{
  "layoutVersion": 1,
  "modules": {{}},
  "runtimes": {{
    "openclaw": {{
      "activeVersion": "{version}",
      "activeInstallKey": "openclaw-nightly-windows-x64",
      "activeVersionLabel": "{version}"
    }}
  }}
}}"#
            ),
        )
        .expect("write active file");

        assert_eq!(
            super::read_active_openclaw_install_key(&paths),
            Some("openclaw-nightly-windows-x64".to_string())
        );
    }

    fn write_openclaw_install_record(
        paths: &crate::framework::paths::AppPaths,
        manifest_name: &str,
        install_root: &std::path::Path,
        work_root: &std::path::Path,
        data_root: &std::path::Path,
        effective_runtime_platform: EffectiveRuntimePlatform,
        install_control_level: InstallControlLevel,
    ) {
        let installer_home = paths.user_root.join(OPENCLAW_INSTALL_RECORDS_HOME_NAME);
        let record = InstallRecord {
            schema_version: "1.0".to_string(),
            software_name: manifest_name.to_string(),
            manifest_name: manifest_name.to_string(),
            manifest_path: format!("./manifests/{manifest_name}.hub.yaml"),
            manifest_source_input: "bundled-registry".to_string(),
            manifest_source_kind: "registry".to_string(),
            platform: SupportedPlatform::Windows,
            effective_runtime_platform,
            installer_home: installer_home.to_string_lossy().into_owned(),
            install_scope: InstallScope::User,
            install_root: install_root.to_string_lossy().into_owned(),
            work_root: work_root.to_string_lossy().into_owned(),
            bin_dir: install_root.join("bin").to_string_lossy().into_owned(),
            data_root: data_root.to_string_lossy().into_owned(),
            install_control_level,
            status: InstallRecordStatus::Installed,
            installed_at: Some("2026-03-21T00:00:00Z".to_string()),
            updated_at: "2026-03-21T00:00:00Z".to_string(),
        };

        write_install_record(
            installer_home.to_string_lossy().as_ref(),
            manifest_name,
            &record,
        )
        .expect("write openclaw install record");
    }

    fn configured_openclaw_supervisor(
        paths: &crate::framework::paths::AppPaths,
    ) -> (SupervisorService, TestGatewayServer) {
        let supervisor = SupervisorService::new();
        let (runtime, server) = create_openclaw_runtime_fixture(paths);

        supervisor
            .configure_openclaw_gateway(&runtime)
            .expect("configure runtime");
        supervisor
            .record_running(SERVICE_ID_OPENCLAW_GATEWAY, Some(42))
            .expect("record running");

        (supervisor, server)
    }

    fn create_openclaw_runtime_fixture(
        paths: &crate::framework::paths::AppPaths,
    ) -> (ActivatedOpenClawRuntime, TestGatewayServer) {
        let install_dir = paths.openclaw_runtime_dir.join("test-runtime");
        let runtime_dir = install_dir.join("runtime");
        let cli_path = runtime_dir
            .join("package")
            .join("node_modules")
            .join("openclaw")
            .join("openclaw.mjs");
        let node_path = runtime_dir.join("node").join("node");
        let gateway_port = reserve_available_loopback_port();
        let server = TestGatewayServer::spawn(gateway_port);

        (
            ActivatedOpenClawRuntime {
                install_key: "test-runtime".to_string(),
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
            },
            server,
        )
    }

    fn read_gateway_call_captures(server: &TestGatewayServer) -> Vec<Value> {
        server.captures()
    }

    fn reserve_available_loopback_port() -> u16 {
        TcpListener::bind("127.0.0.1:0")
            .expect("reserve loopback port")
            .local_addr()
            .expect("loopback addr")
            .port()
    }

    struct TestGatewayServer {
        captures: Arc<Mutex<Vec<Value>>>,
        stop: Arc<AtomicBool>,
        handle: Option<JoinHandle<()>>,
        port: u16,
    }

    impl TestGatewayServer {
        fn spawn(port: u16) -> Self {
            let listener = TcpListener::bind(("127.0.0.1", port)).expect("bind gateway server");
            listener
                .set_nonblocking(true)
                .expect("gateway listener nonblocking");

            let captures = Arc::new(Mutex::new(Vec::new()));
            let stop = Arc::new(AtomicBool::new(false));
            let worker_captures = Arc::clone(&captures);
            let worker_stop = Arc::clone(&stop);

            let handle = thread::spawn(move || {
                while !worker_stop.load(Ordering::SeqCst) {
                    match listener.accept() {
                        Ok((mut stream, _)) => {
                            handle_gateway_request(&mut stream, &worker_captures);
                        }
                        Err(error) if error.kind() == std::io::ErrorKind::WouldBlock => {
                            thread::sleep(Duration::from_millis(10));
                        }
                        Err(_) => break,
                    }
                }
            });

            Self {
                captures,
                stop,
                handle: Some(handle),
                port,
            }
        }

        fn captures(&self) -> Vec<Value> {
            self.captures.lock().expect("gateway captures lock").clone()
        }
    }

    impl Drop for TestGatewayServer {
        fn drop(&mut self) {
            self.stop.store(true, Ordering::SeqCst);
            let _ = TcpStream::connect(("127.0.0.1", self.port));
            if let Some(handle) = self.handle.take() {
                let _ = handle.join();
            }
        }
    }

    fn handle_gateway_request(stream: &mut TcpStream, captures: &Arc<Mutex<Vec<Value>>>) {
        stream
            .set_nonblocking(false)
            .expect("gateway stream blocking mode");
        let (path, headers, body) = read_http_request(stream);
        let payload = serde_json::from_slice::<Value>(&body).expect("gateway request json");
        let tool = payload
            .get("tool")
            .and_then(Value::as_str)
            .unwrap_or_default()
            .to_string();
        let method = payload
            .get("action")
            .and_then(Value::as_str)
            .map(|action| format!("{tool}.{action}"))
            .unwrap_or(tool);
        let params = payload.get("args").cloned().unwrap_or(Value::Null);

        captures.lock().expect("gateway captures lock").push(json!({
            "path": path,
            "method": method,
            "params": params,
            "authorization": headers.get("authorization").cloned(),
            "headers": headers,
            "request": payload,
        }));

        let method = payload
            .get("action")
            .and_then(Value::as_str)
            .map(|action| {
                format!(
                    "{}.{}",
                    payload
                        .get("tool")
                        .and_then(Value::as_str)
                        .unwrap_or_default(),
                    action
                )
            })
            .unwrap_or_else(|| {
                payload
                    .get("tool")
                    .and_then(Value::as_str)
                    .unwrap_or_default()
                    .to_string()
            });

        let params = payload.get("args").cloned().unwrap_or(Value::Null);
        let result = match method.as_str() {
            "cron.run" => json!({
                "ok": true,
                "enqueued": true,
                "runId": "run-123",
            }),
            "cron.remove" => json!({
                "removed": true,
            }),
            _ => json!({
                "ok": true,
                "method": method,
                "params": params,
            }),
        };

        write_json_response(
            stream,
            "200 OK",
            &json!({
                "ok": true,
                "result": result,
            }),
        );
    }

    fn read_http_request(
        stream: &mut TcpStream,
    ) -> (String, std::collections::BTreeMap<String, String>, Vec<u8>) {
        stream
            .set_read_timeout(Some(Duration::from_secs(2)))
            .expect("gateway read timeout");

        let mut buffer = Vec::new();
        let mut chunk = [0u8; 1024];
        let mut header_end = None;
        let mut content_length = 0usize;

        loop {
            let read = stream.read(&mut chunk).expect("read gateway request");
            if read == 0 {
                break;
            }
            buffer.extend_from_slice(&chunk[..read]);

            if header_end.is_none() {
                if let Some(index) = find_bytes(&buffer, b"\r\n\r\n") {
                    let end = index + 4;
                    let header_text = String::from_utf8_lossy(&buffer[..end]);
                    content_length = parse_content_length(header_text.as_ref());
                    header_end = Some(end);
                    if buffer.len() >= end + content_length {
                        break;
                    }
                }
            } else if buffer.len() >= header_end.expect("header end") + content_length {
                break;
            }
        }

        let header_end = header_end.expect("gateway request headers");
        let header_text = String::from_utf8_lossy(&buffer[..header_end]);
        let mut lines = header_text.split("\r\n").filter(|line| !line.is_empty());
        let request_line = lines.next().expect("request line");
        let path = request_line
            .split_whitespace()
            .nth(1)
            .unwrap_or_default()
            .to_string();
        let headers = lines
            .filter_map(|line| line.split_once(':'))
            .map(|(name, value)| (name.trim().to_ascii_lowercase(), value.trim().to_string()))
            .collect::<std::collections::BTreeMap<_, _>>();
        let body = buffer[header_end..header_end + content_length].to_vec();

        (path, headers, body)
    }

    fn parse_content_length(headers: &str) -> usize {
        headers
            .lines()
            .filter_map(|line| line.split_once(':'))
            .find_map(|(name, value)| {
                if name.trim().eq_ignore_ascii_case("content-length") {
                    value.trim().parse::<usize>().ok()
                } else {
                    None
                }
            })
            .unwrap_or(0)
    }

    fn find_bytes(buffer: &[u8], needle: &[u8]) -> Option<usize> {
        buffer
            .windows(needle.len())
            .position(|window| window == needle)
    }

    fn write_json_response(stream: &mut TcpStream, status_line: &str, body: &Value) {
        let body_text = serde_json::to_string(body).expect("response json");
        let response = format!(
            "HTTP/1.1 {status_line}\r\ncontent-type: application/json\r\ncontent-length: {}\r\nconnection: close\r\n\r\n{}",
            body_text.len(),
            body_text
        );
        stream
            .write_all(response.as_bytes())
            .expect("write gateway response");
        stream.flush().expect("flush gateway response");
    }

    #[test]
    fn list_instances_seeds_built_in_default_instance() {
        let (_root, paths, config, storage, service) = studio_context();

        let instances = service
            .list_instances(&paths, &config, &storage)
            .expect("list instances");

        assert_eq!(instances.len(), 1);
        assert_eq!(instances[0].id, DEFAULT_INSTANCE_ID);
        assert!(instances[0].is_built_in);
        assert!(instances[0].is_default);
        assert_eq!(instances[0].runtime_kind, StudioRuntimeKind::Openclaw);
        assert_eq!(
            instances[0].deployment_mode,
            StudioInstanceDeploymentMode::LocalManaged
        );
        assert_eq!(instances[0].status, StudioInstanceStatus::Offline);
    }

    #[test]
    fn list_instances_repairs_corrupt_local_file_storage_document_before_projection() {
        let (_root, paths, config, storage, service) = studio_context();
        let profile_path = paths
            .storage_dir
            .join("profiles")
            .join("default-local.json");
        fs::create_dir_all(profile_path.parent().expect("profile dir"))
            .expect("create profile dir");
        fs::write(
            &profile_path,
            "{\n  \"studio.instances\": {\n    \"registry\": \"{\\\"version\\\":1,\\\"instances\\\":[]}\"\n  }\n}\n}",
        )
        .expect("seed corrupt storage document");

        let instances = service
            .list_instances(&paths, &config, &storage)
            .expect("list instances");

        assert_eq!(instances.len(), 1);
        assert_eq!(instances[0].id, DEFAULT_INSTANCE_ID);
        let repaired = fs::read_to_string(profile_path).expect("repaired storage document");
        serde_json::from_str::<Value>(&repaired)
            .expect("storage document should be repaired to strict JSON");
    }

    #[test]
    fn list_instances_preserves_stable_built_in_openclaw_identity_without_injecting_legacy_default_instance(
    ) {
        let (_root, paths, config, storage, service) = studio_context();
        let registry = InstanceRegistryDocument {
            version: 1,
            instances: vec![StudioInstanceRecord {
                id: "managed-openclaw-primary".to_string(),
                name: "Built-In OpenClaw Primary".to_string(),
                description: Some("Stable built-in OpenClaw identity.".to_string()),
                runtime_kind: StudioRuntimeKind::Openclaw,
                deployment_mode: StudioInstanceDeploymentMode::LocalManaged,
                transport_kind: StudioInstanceTransportKind::OpenclawGatewayWs,
                status: StudioInstanceStatus::Online,
                is_built_in: true,
                is_default: true,
                icon_type: StudioInstanceIconType::Server,
                version: openclaw_fixture_version(-1),
                type_label: "Built-In OpenClaw".to_string(),
                host: "127.0.0.1".to_string(),
                port: Some(18871),
                base_url: Some("http://127.0.0.1:18871".to_string()),
                websocket_url: Some("ws://127.0.0.1:18871".to_string()),
                cpu: 0,
                memory: 0,
                total_memory: "Unknown".to_string(),
                uptime: "-".to_string(),
                capabilities: vec![
                    StudioInstanceCapability::Chat,
                    StudioInstanceCapability::Health,
                    StudioInstanceCapability::Files,
                    StudioInstanceCapability::Memory,
                    StudioInstanceCapability::Tasks,
                    StudioInstanceCapability::Tools,
                    StudioInstanceCapability::Models,
                ],
                storage: default_storage_binding(&config),
                config: StudioInstanceConfig {
                    port: "18871".to_string(),
                    sandbox: true,
                    auto_update: true,
                    log_level: "info".to_string(),
                    cors_origins: "*".to_string(),
                    workspace_path: None,
                    base_url: Some("http://127.0.0.1:18871".to_string()),
                    websocket_url: Some("ws://127.0.0.1:18871".to_string()),
                    auth_token: None,
                },
                created_at: 1,
                updated_at: 1,
                last_seen_at: Some(1),
            }],
        };
        service
            .write_instance_registry(&paths, &config, &storage, &registry)
            .expect("seed stable built-in registry");

        let instances = service
            .list_instances(&paths, &config, &storage)
            .expect("list instances");

        assert_eq!(instances.len(), 1);
        assert_eq!(instances[0].id, "managed-openclaw-primary");
        assert_eq!(instances[0].name, "Built-In OpenClaw Primary");
        assert_eq!(instances[0].version, bundled_openclaw_version());
        assert!(!instances
            .iter()
            .any(|instance| instance.id == "local-built-in"));
    }

    #[test]
    fn get_instance_rejects_legacy_built_in_openclaw_identity_requests() {
        let (_root, paths, config, storage, service) = studio_context();

        let built_in = service
            .get_instance(&paths, &config, &storage, "local-built-in")
            .expect("get built-in instance");

        assert!(built_in.is_none());
    }

    #[test]
    fn start_instance_marks_built_in_openclaw_as_error_when_gateway_start_fails() {
        let (_root, paths, config, storage, service) = studio_context();
        let supervisor = SupervisorService::new();

        let error = service
            .start_instance(&paths, &config, &storage, &supervisor, DEFAULT_INSTANCE_ID)
            .expect_err("built-in start should fail without configured runtime");

        assert!(error.to_string().contains("configured openclaw runtime"));

        let built_in = service
            .get_instance(&paths, &config, &storage, DEFAULT_INSTANCE_ID)
            .expect("get built-in instance")
            .expect("built-in instance");
        assert_eq!(built_in.status, StudioInstanceStatus::Error);
    }

    #[test]
    fn start_instance_uses_stable_built_in_openclaw_identity_for_gateway_control() {
        let (_root, paths, config, storage, service) = studio_context();
        let supervisor = SupervisorService::new();
        let stable_id = "managed-openclaw-primary";
        let registry = InstanceRegistryDocument {
            version: 1,
            instances: vec![StudioInstanceRecord {
                id: stable_id.to_string(),
                name: "Built-In OpenClaw Primary".to_string(),
                description: Some("Stable built-in OpenClaw identity.".to_string()),
                runtime_kind: StudioRuntimeKind::Openclaw,
                deployment_mode: StudioInstanceDeploymentMode::LocalManaged,
                transport_kind: StudioInstanceTransportKind::OpenclawGatewayWs,
                status: StudioInstanceStatus::Offline,
                is_built_in: true,
                is_default: true,
                icon_type: StudioInstanceIconType::Server,
                version: bundled_openclaw_version().to_string(),
                type_label: "Built-In OpenClaw".to_string(),
                host: "127.0.0.1".to_string(),
                port: Some(18871),
                base_url: Some("http://127.0.0.1:18871".to_string()),
                websocket_url: Some("ws://127.0.0.1:18871".to_string()),
                cpu: 0,
                memory: 0,
                total_memory: "Unknown".to_string(),
                uptime: "-".to_string(),
                capabilities: vec![
                    StudioInstanceCapability::Chat,
                    StudioInstanceCapability::Health,
                    StudioInstanceCapability::Files,
                    StudioInstanceCapability::Memory,
                    StudioInstanceCapability::Tasks,
                    StudioInstanceCapability::Tools,
                    StudioInstanceCapability::Models,
                ],
                storage: default_storage_binding(&config),
                config: StudioInstanceConfig {
                    port: "18871".to_string(),
                    sandbox: true,
                    auto_update: true,
                    log_level: "info".to_string(),
                    cors_origins: "*".to_string(),
                    workspace_path: None,
                    base_url: Some("http://127.0.0.1:18871".to_string()),
                    websocket_url: Some("ws://127.0.0.1:18871".to_string()),
                    auth_token: None,
                },
                created_at: 1,
                updated_at: 1,
                last_seen_at: Some(1),
            }],
        };
        service
            .write_instance_registry(&paths, &config, &storage, &registry)
            .expect("seed stable built-in registry");

        let error = service
            .start_instance(&paths, &config, &storage, &supervisor, stable_id)
            .expect_err("stable built-in start should fail without configured runtime");

        assert!(error.to_string().contains("configured openclaw runtime"));

        let built_in = service
            .get_instance(&paths, &config, &storage, stable_id)
            .expect("get stable built-in instance")
            .expect("stable built-in instance");
        assert_eq!(built_in.status, StudioInstanceStatus::Error);
    }

    #[test]
    fn preview_rollout_uses_stable_built_in_openclaw_identity() {
        let (_root, paths, config, storage, service) = studio_context();
        let supervisor = SupervisorService::new();
        let stable_id = "managed-openclaw-primary";
        let registry = InstanceRegistryDocument {
            version: 1,
            instances: vec![StudioInstanceRecord {
                id: stable_id.to_string(),
                name: "Built-In OpenClaw Primary".to_string(),
                description: Some("Stable built-in OpenClaw identity.".to_string()),
                runtime_kind: StudioRuntimeKind::Openclaw,
                deployment_mode: StudioInstanceDeploymentMode::LocalManaged,
                transport_kind: StudioInstanceTransportKind::OpenclawGatewayWs,
                status: StudioInstanceStatus::Offline,
                is_built_in: true,
                is_default: true,
                icon_type: StudioInstanceIconType::Server,
                version: bundled_openclaw_version().to_string(),
                type_label: "Built-In OpenClaw".to_string(),
                host: "127.0.0.1".to_string(),
                port: Some(18871),
                base_url: Some("http://127.0.0.1:18871".to_string()),
                websocket_url: Some("ws://127.0.0.1:18871".to_string()),
                cpu: 0,
                memory: 0,
                total_memory: "Unknown".to_string(),
                uptime: "-".to_string(),
                capabilities: vec![
                    StudioInstanceCapability::Chat,
                    StudioInstanceCapability::Health,
                    StudioInstanceCapability::Files,
                    StudioInstanceCapability::Memory,
                    StudioInstanceCapability::Tasks,
                    StudioInstanceCapability::Tools,
                    StudioInstanceCapability::Models,
                ],
                storage: default_storage_binding(&config),
                config: StudioInstanceConfig {
                    port: "18871".to_string(),
                    sandbox: true,
                    auto_update: true,
                    log_level: "info".to_string(),
                    cors_origins: "*".to_string(),
                    workspace_path: None,
                    base_url: Some("http://127.0.0.1:18871".to_string()),
                    websocket_url: Some("ws://127.0.0.1:18871".to_string()),
                    auth_token: None,
                },
                created_at: 1,
                updated_at: 1,
                last_seen_at: Some(1),
            }],
        };
        service
            .write_instance_registry(&paths, &config, &storage, &registry)
            .expect("seed stable built-in registry");

        let preview = service
            .preview_rollout(
                &paths,
                &config,
                &storage,
                &supervisor,
                super::PreviewRolloutInput {
                    rollout_id: "stable-built-in-rollout".to_string(),
                    force_recompute: false,
                    include_targets: true,
                },
            )
            .expect("preview rollout");

        assert_eq!(preview.targets.len(), 1);
        assert_eq!(preview.targets[0].node_id, stable_id);
    }

    #[test]
    fn built_in_instance_reads_http_auth_from_openclaw_config_file() {
        let (_root, paths, config, storage, service) = studio_context();
        fs::write(
            &openclaw_config_file_path(&paths),
            r#"{
  gateway: {
    port: 19876,
    auth: {
      mode: "token",
      token: "studio-token",
    },
  },
}
"#,
        )
        .expect("seed config file");

        let instances = service
            .list_instances(&paths, &config, &storage)
            .expect("list instances");
        let built_in = instances
            .into_iter()
            .find(|instance| instance.id == DEFAULT_INSTANCE_ID)
            .expect("built-in instance");

        assert_eq!(built_in.port, Some(19876));
        assert_eq!(built_in.config.port, "19876");
        assert_eq!(built_in.base_url, None);
        assert_eq!(built_in.config.base_url, None);
        assert_eq!(built_in.config.auth_token.as_deref(), Some("studio-token"));
    }

    #[test]
    fn built_in_instance_ignores_stale_authority_config_file_path_when_reading_http_auth() {
        let (_root, paths, config, storage, service) = studio_context();
        let stale_config_file_path = stale_authority_config_file_path(&paths);
        let canonical_config_file_path = paths.openclaw_config_file.clone();
        fs::create_dir_all(
            stale_config_file_path
                .parent()
                .expect("stale config file parent"),
        )
        .expect("stale config file dir");
        fs::write(
            &stale_config_file_path,
            r#"{
  gateway: {
    port: 19877,
    auth: {
      mode: "token",
      token: "stale-token",
    },
  },
}
"#,
        )
        .expect("seed stale config file");
        fs::write(
            &canonical_config_file_path,
            r#"{
  gateway: {
    port: 19876,
    auth: {
      mode: "token",
      token: "studio-token",
    },
  },
}
"#,
        )
        .expect("seed canonical config file");

        let mut authority = serde_json::from_str::<Value>(
            &fs::read_to_string(&paths.openclaw_authority_file).expect("authority state"),
        )
        .expect("authority state json");
        authority["configFilePath"] =
            Value::String(stale_config_file_path.to_string_lossy().into_owned());
        fs::write(
            &paths.openclaw_authority_file,
            format!(
                "{}\n",
                serde_json::to_string_pretty(&authority).expect("authority json")
            ),
        )
        .expect("write authority state");

        let instances = service
            .list_instances(&paths, &config, &storage)
            .expect("list instances");
        let built_in = instances
            .into_iter()
            .find(|instance| instance.id == DEFAULT_INSTANCE_ID)
            .expect("built-in instance");

        assert_eq!(built_in.port, Some(19876));
        assert_eq!(built_in.config.port, "19876");
        assert_eq!(built_in.config.auth_token.as_deref(), Some("studio-token"));
    }

    #[test]
    fn sdkwork_localhost_subdomains_are_treated_as_loopback_hosts() {
        assert!(super::is_loopback_host("ai.sdkwork.localhost"));
        assert!(super::is_loopback_host("AI.SDKWORK.LOCALHOST"));
        assert!(!super::is_loopback_host("ai.sdkwork.com"));
    }

    #[test]
    fn updating_built_in_instance_does_not_force_openai_http_endpoints_on() {
        let (_root, paths, config, storage, service) = studio_context();

        fs::write(
            &openclaw_config_file_path(&paths),
            r#"{
  gateway: {
    port: 19876,
    auth: {
      mode: "token",
      token: "studio-token",
    },
  },
}
"#,
        )
        .expect("seed config file");

        service
            .update_instance(
                &paths,
                &config,
                &storage,
                DEFAULT_INSTANCE_ID,
                super::StudioUpdateInstanceInput {
                    config: Some(super::PartialStudioInstanceConfig {
                        log_level: Some("debug".to_string()),
                        cors_origins: Some("http://localhost:3001".to_string()),
                        sandbox: Some(true),
                        auto_update: Some(true),
                        ..super::PartialStudioInstanceConfig::default()
                    }),
                    ..super::StudioUpdateInstanceInput::default()
                },
            )
            .expect("update built-in instance");

        let root = serde_json::from_str::<Value>(
            &fs::read_to_string(&openclaw_config_file_path(&paths)).expect("config file"),
        )
        .expect("config file json");

        assert_eq!(
            root.pointer("/studio/logLevel").and_then(Value::as_str),
            Some("debug")
        );
        assert_eq!(
            root.pointer("/studio/corsOrigins").and_then(Value::as_str),
            Some("http://localhost:3001")
        );
        assert_eq!(
            root.pointer("/gateway/http/endpoints/chatCompletions/enabled")
                .and_then(Value::as_bool),
            None
        );
        assert_eq!(
            root.pointer("/gateway/http/endpoints/responses/enabled")
                .and_then(Value::as_bool),
            None
        );
    }

    #[test]
    fn updating_built_in_instance_removes_legacy_global_workspace_fallback() {
        let (_root, paths, config, storage, service) = studio_context();
        let canonical_workspace = paths.openclaw_workspace_dir.to_string_lossy().into_owned();

        fs::write(
            &openclaw_config_file_path(&paths),
            r#"{
  gateway: {
    port: 19876,
    auth: {
      mode: "token",
      token: "studio-token",
    },
  },
  agents: {
    defaults: {
      workspace: "D:/legacy/global-workspace",
    },
    list: [
      {
        id: "main",
        name: "Main",
        default: true,
      },
    ],
  },
}
"#,
        )
        .expect("seed config file");

        let updated = service
            .update_instance_config(
                &paths,
                &config,
                &storage,
                DEFAULT_INSTANCE_ID,
                super::StudioInstanceConfig {
                    port: "19888".to_string(),
                    sandbox: true,
                    auto_update: true,
                    log_level: "info".to_string(),
                    cors_origins: "*".to_string(),
                    workspace_path: Some("D:/ui/custom-workspace".to_string()),
                    base_url: None,
                    websocket_url: None,
                    auth_token: Some("studio-token".to_string()),
                },
            )
            .expect("update built-in config")
            .expect("updated config");

        assert_eq!(
            updated.workspace_path.as_deref(),
            Some(canonical_workspace.as_str())
        );

        let root = read_json5_object(&openclaw_config_file_path(&paths)).expect("read config file");
        assert!(
            get_nested_value(&root, &["agents", "defaults", "workspace"]).is_none(),
            "built-in OpenClaw must not persist agents.defaults.workspace because OpenClaw treats it as a global fallback for non-main agents"
        );
    }

    #[test]
    fn remote_instance_crud_round_trips_with_storage_binding_metadata() {
        let (_root, paths, config, storage, service) = studio_context();

        let created = service
            .create_instance(
                &paths,
                &config,
                &storage,
                StudioCreateInstanceInput {
                    name: "Zero Remote".to_string(),
                    description: Some("Remote ZeroClaw".to_string()),
                    runtime_kind: StudioRuntimeKind::Zeroclaw,
                    deployment_mode: StudioInstanceDeploymentMode::Remote,
                    transport_kind: StudioInstanceTransportKind::ZeroclawHttp,
                    icon_type: None,
                    version: Some("0.9.0".to_string()),
                    type_label: Some("Remote ZeroClaw".to_string()),
                    host: Some("zeroclaw.example.com".to_string()),
                    port: Some(8443),
                    base_url: Some("https://zeroclaw.example.com".to_string()),
                    websocket_url: Some("wss://zeroclaw.example.com/ws".to_string()),
                    storage: Some(super::PartialStudioStorageBinding {
                        provider: Some(StorageProviderKind::Postgres),
                        namespace: Some("studio.instances.remote".to_string()),
                        database: Some("claw_studio".to_string()),
                        connection_hint: Some("configured".to_string()),
                        endpoint: Some("postgresql://zeroclaw.example.com".to_string()),
                        ..super::PartialStudioStorageBinding::default()
                    }),
                    config: Some(super::PartialStudioInstanceConfig {
                        base_url: Some("https://zeroclaw.example.com".to_string()),
                        websocket_url: Some("wss://zeroclaw.example.com/ws".to_string()),
                        port: Some("8443".to_string()),
                        ..super::PartialStudioInstanceConfig::default()
                    }),
                },
            )
            .expect("create instance");

        assert_eq!(created.runtime_kind, StudioRuntimeKind::Zeroclaw);
        assert_eq!(created.storage.provider, StorageProviderKind::Postgres);
        assert_eq!(created.storage.database.as_deref(), Some("claw_studio"));
        assert!(!created.is_default);

        let updated = service
            .update_instance(
                &paths,
                &config,
                &storage,
                &created.id,
                super::StudioUpdateInstanceInput {
                    is_default: Some(true),
                    version: Some("1.0.0".to_string()),
                    ..super::StudioUpdateInstanceInput::default()
                },
            )
            .expect("update instance");

        let listed = service
            .list_instances(&paths, &config, &storage)
            .expect("list updated instances");

        assert_eq!(updated.version, "1.0.0");
        assert!(listed
            .iter()
            .any(|instance| instance.id == updated.id && instance.is_default));
        assert!(listed
            .iter()
            .any(|instance| instance.id == DEFAULT_INSTANCE_ID && !instance.is_default));

        let deleted = service
            .delete_instance(&paths, &config, &storage, &created.id)
            .expect("delete instance");
        let remaining = service
            .list_instances(&paths, &config, &storage)
            .expect("list remaining instances");

        assert!(deleted);
        assert_eq!(remaining.len(), 1);
        assert_eq!(remaining[0].id, DEFAULT_INSTANCE_ID);
        assert!(remaining[0].is_default);
    }

    #[test]
    fn conversations_follow_participants_and_reassign_when_primary_instance_is_deleted() {
        let (_root, paths, config, storage, service) = studio_context();
        let remote = service
            .create_instance(
                &paths,
                &config,
                &storage,
                StudioCreateInstanceInput {
                    name: "Iron Remote".to_string(),
                    description: Some("Remote IronClaw".to_string()),
                    runtime_kind: StudioRuntimeKind::Ironclaw,
                    deployment_mode: StudioInstanceDeploymentMode::Remote,
                    transport_kind: StudioInstanceTransportKind::IronclawWeb,
                    icon_type: None,
                    version: Some("0.3.0".to_string()),
                    type_label: Some("Remote IronClaw".to_string()),
                    host: Some("ironclaw.example.com".to_string()),
                    port: Some(443),
                    base_url: Some("https://ironclaw.example.com".to_string()),
                    websocket_url: None,
                    storage: None,
                    config: None,
                },
            )
            .expect("create remote instance");

        let stored = service
            .put_conversation(
                &paths,
                &config,
                &storage,
                StudioConversationRecord {
                    id: "conversation-1".to_string(),
                    title: "Cross-instance".to_string(),
                    primary_instance_id: remote.id.clone(),
                    participant_instance_ids: vec![
                        DEFAULT_INSTANCE_ID.to_string(),
                        remote.id.clone(),
                        DEFAULT_INSTANCE_ID.to_string(),
                    ],
                    created_at: 10,
                    updated_at: 12,
                    message_count: 0,
                    last_message_preview: None,
                    last_seen_at: None,
                    kernel_session: None,
                    messages: vec![
                        StudioConversationMessage {
                            id: "message-1".to_string(),
                            conversation_id: "stale-id".to_string(),
                            role: StudioConversationRole::User,
                            content: "hello".to_string(),
                            created_at: 10,
                            updated_at: 10,
                            model: Some("gpt-4.1".to_string()),
                            sender_instance_id: Some(DEFAULT_INSTANCE_ID.to_string()),
                            status: StudioConversationMessageStatus::Complete,
                            attachments: Vec::new(),
                            kernel_message: None,
                        },
                        StudioConversationMessage {
                            id: "message-2".to_string(),
                            conversation_id: "stale-id".to_string(),
                            role: StudioConversationRole::Assistant,
                            content: "world".to_string(),
                            created_at: 11,
                            updated_at: 12,
                            model: Some("ironclaw".to_string()),
                            sender_instance_id: Some(remote.id.clone()),
                            status: StudioConversationMessageStatus::Complete,
                            attachments: Vec::new(),
                            kernel_message: None,
                        },
                    ],
                },
            )
            .expect("store conversation");

        let built_in_view = service
            .list_conversations(&paths, &config, &storage, DEFAULT_INSTANCE_ID)
            .expect("list built-in conversations");
        let remote_view = service
            .list_conversations(&paths, &config, &storage, &remote.id)
            .expect("list remote conversations");

        assert_eq!(stored.primary_instance_id, remote.id);
        assert_eq!(
            stored.participant_instance_ids,
            vec![remote.id.clone(), DEFAULT_INSTANCE_ID.to_string()]
        );
        assert_eq!(stored.messages[0].conversation_id, "conversation-1");
        assert_eq!(built_in_view.len(), 1);
        assert_eq!(remote_view.len(), 1);

        let deleted = service
            .delete_instance(&paths, &config, &storage, &remote.id)
            .expect("delete remote participant");
        let reassigned = service
            .list_conversations(&paths, &config, &storage, DEFAULT_INSTANCE_ID)
            .expect("list reassigned conversations");

        assert!(deleted);
        assert_eq!(reassigned.len(), 1);
        assert_eq!(reassigned[0].primary_instance_id, DEFAULT_INSTANCE_ID);
        assert_eq!(
            reassigned[0].participant_instance_ids,
            vec![DEFAULT_INSTANCE_ID.to_string()]
        );
    }

    #[test]
    fn put_conversation_rejects_unknown_participants() {
        let (_root, paths, config, storage, service) = studio_context();

        let error = service
            .put_conversation(
                &paths,
                &config,
                &storage,
                StudioConversationRecord {
                    id: "conversation-invalid".to_string(),
                    title: "Invalid".to_string(),
                    primary_instance_id: DEFAULT_INSTANCE_ID.to_string(),
                    participant_instance_ids: vec!["missing-instance".to_string()],
                    created_at: 1,
                    updated_at: 1,
                    message_count: 0,
                    last_message_preview: None,
                    last_seen_at: None,
                    kernel_session: None,
                    messages: Vec::new(),
                },
            )
            .expect_err("missing participant should fail");

        assert_eq!(
            error.to_string(),
            "not found: instance \"missing-instance\""
        );
    }

    #[test]
    fn conversations_are_persisted_in_default_sqlite_profile() {
        let (_root, paths, config, storage, service) = studio_context();
        let conversation_id = "conversation-sqlite";

        service
            .put_conversation(
                &paths,
                &config,
                &storage,
                StudioConversationRecord {
                    id: conversation_id.to_string(),
                    title: "SQLite Conversation".to_string(),
                    primary_instance_id: DEFAULT_INSTANCE_ID.to_string(),
                    participant_instance_ids: vec![DEFAULT_INSTANCE_ID.to_string()],
                    created_at: 1,
                    updated_at: 1,
                    message_count: 0,
                    last_message_preview: None,
                    last_seen_at: None,
                    kernel_session: None,
                    messages: vec![StudioConversationMessage {
                        id: "message-sqlite-1".to_string(),
                        conversation_id: conversation_id.to_string(),
                        role: StudioConversationRole::User,
                        content: "persist me in sqlite".to_string(),
                        created_at: 1,
                        updated_at: 2,
                        model: Some("gpt-4.1".to_string()),
                        sender_instance_id: Some(DEFAULT_INSTANCE_ID.to_string()),
                        status: StudioConversationMessageStatus::Complete,
                        attachments: Vec::new(),
                        kernel_message: None,
                    }],
                },
            )
            .expect("store conversation in sqlite-backed profile");

        let sqlite_value = storage
            .get_text(
                &paths,
                &config,
                crate::framework::storage::StorageGetTextRequest {
                    profile_id: Some("default-sqlite".to_string()),
                    namespace: Some(super::CHAT_NAMESPACE.to_string()),
                    key: super::conversation_storage_key(conversation_id),
                },
            )
            .expect("read conversation from sqlite profile")
            .value;
        let local_value = storage
            .get_text(
                &paths,
                &config,
                crate::framework::storage::StorageGetTextRequest {
                    profile_id: Some("default-local".to_string()),
                    namespace: Some(super::CHAT_NAMESPACE.to_string()),
                    key: super::conversation_storage_key(conversation_id),
                },
            )
            .expect("read conversation from local profile")
            .value;

        assert!(
            sqlite_value.is_some(),
            "conversation should be stored in sqlite"
        );
        assert!(
            local_value.is_none(),
            "conversation should no longer be stored in the default local-file profile"
        );
    }

    #[test]
    fn list_conversations_preserves_gateway_kernel_session_metadata_from_sqlite() {
        let (_root, paths, config, storage, service) = studio_context();
        let conversation_id = "conversation-gateway-metadata";
        let raw_record = serde_json::json!({
            "id": conversation_id,
            "title": "Explain why OpenClaw starts degraded and repair the startup flow",
            "primaryInstanceId": DEFAULT_INSTANCE_ID,
            "participantInstanceIds": [DEFAULT_INSTANCE_ID],
            "createdAt": 10_u64,
            "updatedAt": 20_u64,
            "lastSeenAt": 18_u64,
            "messageCount": 1_u64,
            "lastMessagePreview": "Explain why OpenClaw starts degraded and repair the startup flow",
            "kernelSession": {
                "ref": {
                    "kernelId": "openclaw",
                    "instanceId": DEFAULT_INSTANCE_ID,
                    "sessionId": "session-alpha",
                    "routingKey": "session-alpha"
                },
                "authority": {
                    "kind": "gateway",
                    "source": "kernel",
                    "durable": true,
                    "writable": true
                },
                "lifecycle": "ready",
                "title": "Explain why OpenClaw starts degraded and repair the startup flow",
                "createdAt": 10_u64,
                "updatedAt": 20_u64,
                "messageCount": 1_u64,
                "lastMessagePreview": "Explain why OpenClaw starts degraded and repair the startup flow",
                "nativeMetadata": {
                    "__agentstudioTitleSource": "firstUser"
                }
            },
            "messages": [{
                "id": "message-1",
                "conversationId": conversation_id,
                "role": "user",
                "content": "Explain why OpenClaw starts degraded and repair the startup flow",
                "createdAt": 10_u64,
                "updatedAt": 20_u64,
                "model": "openai/gpt-4.1",
                "senderInstanceId": DEFAULT_INSTANCE_ID,
                "status": "complete",
                "attachments": [{
                    "id": "attachment-1",
                    "kind": "file",
                    "name": "startup.log"
                }],
                "kernelMessage": {
                    "id": "message-1",
                    "sessionRef": {
                        "kernelId": "openclaw",
                        "instanceId": DEFAULT_INSTANCE_ID,
                        "sessionId": "session-alpha",
                        "routingKey": "session-alpha"
                    },
                    "role": "user",
                    "status": "complete",
                    "createdAt": 10_u64,
                    "updatedAt": 20_u64,
                    "text": "Explain why OpenClaw starts degraded and repair the startup flow",
                    "parts": [{
                        "kind": "text",
                        "text": "Explain why OpenClaw starts degraded and repair the startup flow"
                    }],
                    "nativeMetadata": {
                        "seq": 1
                    }
                }
            }]
        });

        storage
            .put_text(
                &paths,
                &config,
                crate::framework::storage::StoragePutTextRequest {
                    profile_id: Some("default-sqlite".to_string()),
                    namespace: Some(super::CHAT_NAMESPACE.to_string()),
                    key: super::conversation_storage_key(conversation_id),
                    value: serde_json::to_string_pretty(&raw_record)
                        .expect("serialize gateway conversation"),
                },
            )
            .expect("seed gateway conversation");

        let conversations = service
            .list_conversations(&paths, &config, &storage, DEFAULT_INSTANCE_ID)
            .expect("list gateway conversations");
        let stored = conversations
            .iter()
            .find(|record| record.id == conversation_id)
            .expect("gateway conversation should be returned");
        let stored_json = serde_json::to_value(stored).expect("serialize stored conversation");

        assert_eq!(
            stored.title,
            "Explain why OpenClaw starts degraded and repair the startup flow"
        );
        assert_eq!(
            stored_json
                .get("kernelSession")
                .and_then(|kernel_session| kernel_session.get("authority"))
                .and_then(|authority| authority.get("kind"))
                .and_then(|kind| kind.as_str()),
            Some("gateway")
        );
        assert_eq!(
            stored_json
                .get("messages")
                .and_then(|messages| messages.as_array())
                .and_then(|messages| messages.first())
                .and_then(|message| message.get("kernelMessage"))
                .and_then(|kernel_message| kernel_message.get("nativeMetadata"))
                .and_then(|metadata| metadata.get("seq"))
                .and_then(|seq| seq.as_u64()),
            Some(1)
        );
        assert_eq!(
            stored_json
                .get("messages")
                .and_then(|messages| messages.as_array())
                .and_then(|messages| messages.first())
                .and_then(|message| message.get("attachments"))
                .and_then(|attachments| attachments.as_array())
                .map(|attachments| attachments.len()),
            Some(1)
        );
    }

    #[test]
    fn put_conversation_compacts_duplicate_message_ids_before_persisting() {
        let (_root, paths, config, storage, service) = studio_context();

        let stored = service
            .put_conversation(
                &paths,
                &config,
                &storage,
                StudioConversationRecord {
                    id: "conversation-deduped-write".to_string(),
                    title: "Deduped Write".to_string(),
                    primary_instance_id: DEFAULT_INSTANCE_ID.to_string(),
                    participant_instance_ids: vec![DEFAULT_INSTANCE_ID.to_string()],
                    created_at: 10,
                    updated_at: 12,
                    message_count: 3,
                    last_message_preview: Some("stale preview".to_string()),
                    last_seen_at: None,
                    kernel_session: None,
                    messages: vec![
                        StudioConversationMessage {
                            id: "message-duplicate-1".to_string(),
                            conversation_id: "stale-id".to_string(),
                            role: StudioConversationRole::User,
                            content: "stale user prompt".to_string(),
                            created_at: 10,
                            updated_at: 10,
                            model: Some("gpt-4.1".to_string()),
                            sender_instance_id: Some(DEFAULT_INSTANCE_ID.to_string()),
                            status: StudioConversationMessageStatus::Complete,
                            attachments: Vec::new(),
                            kernel_message: None,
                        },
                        StudioConversationMessage {
                            id: "message-duplicate-1".to_string(),
                            conversation_id: "stale-id".to_string(),
                            role: StudioConversationRole::User,
                            content: "latest user prompt".to_string(),
                            created_at: 10,
                            updated_at: 18,
                            model: Some("gpt-4.1".to_string()),
                            sender_instance_id: Some(DEFAULT_INSTANCE_ID.to_string()),
                            status: StudioConversationMessageStatus::Complete,
                            attachments: Vec::new(),
                            kernel_message: None,
                        },
                        StudioConversationMessage {
                            id: "message-duplicate-2".to_string(),
                            conversation_id: "stale-id".to_string(),
                            role: StudioConversationRole::Assistant,
                            content: "final assistant reply".to_string(),
                            created_at: 22,
                            updated_at: 22,
                            model: Some("gpt-4.1".to_string()),
                            sender_instance_id: Some(DEFAULT_INSTANCE_ID.to_string()),
                            status: StudioConversationMessageStatus::Complete,
                            attachments: Vec::new(),
                            kernel_message: None,
                        },
                    ],
                },
            )
            .expect("store deduped conversation");

        assert_eq!(stored.message_count, 2);
        assert_eq!(
            stored
                .messages
                .iter()
                .map(|message| message.id.as_str())
                .collect::<Vec<_>>(),
            vec!["message-duplicate-1", "message-duplicate-2"]
        );
        assert_eq!(stored.messages[0].content, "latest user prompt");
        assert_eq!(
            stored.messages[0].conversation_id,
            "conversation-deduped-write"
        );
        assert_eq!(
            stored.last_message_preview.as_deref(),
            Some("final assistant reply")
        );
        assert_eq!(stored.updated_at, 22);
    }

    #[test]
    fn list_conversations_repairs_historical_duplicate_message_ids_before_returning() {
        let (_root, paths, config, storage, service) = studio_context();
        let conversation_id = "conversation-deduped-read";
        let raw_record = StudioConversationRecord {
            id: conversation_id.to_string(),
            title: "Deduped Read".to_string(),
            primary_instance_id: DEFAULT_INSTANCE_ID.to_string(),
            participant_instance_ids: vec![DEFAULT_INSTANCE_ID.to_string()],
            created_at: 10,
            updated_at: 12,
            message_count: 3,
            last_message_preview: Some("stale preview".to_string()),
            last_seen_at: None,
            kernel_session: None,
            messages: vec![
                StudioConversationMessage {
                    id: "message-history-1".to_string(),
                    conversation_id: "stale-id".to_string(),
                    role: StudioConversationRole::User,
                    content: "stale hydrated prompt".to_string(),
                    created_at: 10,
                    updated_at: 10,
                    model: Some("gpt-4.1".to_string()),
                    sender_instance_id: Some(DEFAULT_INSTANCE_ID.to_string()),
                    status: StudioConversationMessageStatus::Complete,
                    attachments: Vec::new(),
                    kernel_message: None,
                },
                StudioConversationMessage {
                    id: "message-history-1".to_string(),
                    conversation_id: "stale-id".to_string(),
                    role: StudioConversationRole::User,
                    content: "latest hydrated prompt".to_string(),
                    created_at: 10,
                    updated_at: 18,
                    model: Some("gpt-4.1".to_string()),
                    sender_instance_id: Some(DEFAULT_INSTANCE_ID.to_string()),
                    status: StudioConversationMessageStatus::Complete,
                    attachments: Vec::new(),
                    kernel_message: None,
                },
                StudioConversationMessage {
                    id: "message-history-2".to_string(),
                    conversation_id: "stale-id".to_string(),
                    role: StudioConversationRole::Assistant,
                    content: "final hydrated reply".to_string(),
                    created_at: 30,
                    updated_at: 30,
                    model: Some("gpt-4.1".to_string()),
                    sender_instance_id: Some(DEFAULT_INSTANCE_ID.to_string()),
                    status: StudioConversationMessageStatus::Complete,
                    attachments: Vec::new(),
                    kernel_message: None,
                },
            ],
        };

        storage
            .put_text(
                &paths,
                &config,
                crate::framework::storage::StoragePutTextRequest {
                    profile_id: Some("default-sqlite".to_string()),
                    namespace: Some(super::CHAT_NAMESPACE.to_string()),
                    key: super::conversation_storage_key(conversation_id),
                    value: serde_json::to_string_pretty(&raw_record)
                        .expect("serialize duplicated conversation"),
                },
            )
            .expect("seed duplicated conversation");

        let conversations = service
            .list_conversations(&paths, &config, &storage, DEFAULT_INSTANCE_ID)
            .expect("list repaired conversations");
        let repaired = conversations
            .iter()
            .find(|record| record.id == conversation_id)
            .expect("find repaired conversation");

        assert_eq!(repaired.message_count, 2);
        assert_eq!(
            repaired
                .messages
                .iter()
                .map(|message| message.id.as_str())
                .collect::<Vec<_>>(),
            vec!["message-history-1", "message-history-2"]
        );
        assert_eq!(repaired.messages[0].content, "latest hydrated prompt");
        assert_eq!(repaired.messages[0].conversation_id, conversation_id);
        assert_eq!(
            repaired.last_message_preview.as_deref(),
            Some("final hydrated reply")
        );
        assert_eq!(repaired.updated_at, 30);

        let rewritten = storage
            .get_text(
                &paths,
                &config,
                crate::framework::storage::StorageGetTextRequest {
                    profile_id: Some("default-sqlite".to_string()),
                    namespace: Some(super::CHAT_NAMESPACE.to_string()),
                    key: super::conversation_storage_key(conversation_id),
                },
            )
            .expect("read repaired conversation")
            .value
            .expect("persisted repaired conversation");
        let rewritten_record: StudioConversationRecord =
            serde_json::from_str(rewritten.as_str()).expect("parse repaired conversation");

        assert_eq!(rewritten_record.message_count, 2);
        assert_eq!(rewritten_record.messages.len(), 2);
        assert_eq!(
            rewritten_record.messages[0].content,
            "latest hydrated prompt"
        );
        assert_eq!(
            rewritten_record.last_message_preview.as_deref(),
            Some("final hydrated reply")
        );
        assert_eq!(rewritten_record.updated_at, 30);
    }

    #[test]
    fn persisted_kernel_chat_agents_are_stored_in_default_sqlite_profile() {
        let (_root, paths, config, storage, service) = studio_context();

        let stored = service
            .replace_persisted_kernel_chat_agents(
                &paths,
                &config,
                &storage,
                DEFAULT_INSTANCE_ID,
                vec![super::PersistedKernelChatAgentRecord {
                    id: "managed-openclaw-primary:hermes:planner".to_string(),
                    instance_id: DEFAULT_INSTANCE_ID.to_string(),
                    kernel_id: "hermes".to_string(),
                    agent_id: "planner".to_string(),
                    label: "Planner".to_string(),
                    description: Some("Persisted planner agent.".to_string()),
                    source: "kernelCatalog".to_string(),
                    system_prompt: Some("plan first".to_string()),
                    avatar: Some("P".to_string()),
                    creator: Some("Hermes".to_string()),
                    is_default: true,
                    sort_order: 0,
                    synced_at: 42,
                    native_metadata: Some(serde_json::json!({
                        "persisted": true,
                    })),
                }],
            )
            .expect("store persisted kernel chat agents");

        let sqlite_value = storage
            .get_text(
                &paths,
                &config,
                crate::framework::storage::StorageGetTextRequest {
                    profile_id: Some("default-sqlite".to_string()),
                    namespace: Some(super::CHAT_NAMESPACE.to_string()),
                    key: super::persisted_kernel_chat_agent_storage_key(
                        DEFAULT_INSTANCE_ID,
                        "hermes",
                        "planner",
                    ),
                },
            )
            .expect("read persisted kernel chat agent from sqlite profile")
            .value;

        assert_eq!(stored.len(), 1);
        assert!(
            sqlite_value.is_some(),
            "persisted kernel chat agent should be stored in sqlite"
        );
    }

    #[test]
    fn replacing_persisted_kernel_chat_agents_removes_stale_agents_for_the_same_instance() {
        let (_root, paths, config, storage, service) = studio_context();

        service
            .replace_persisted_kernel_chat_agents(
                &paths,
                &config,
                &storage,
                DEFAULT_INSTANCE_ID,
                vec![super::PersistedKernelChatAgentRecord {
                    id: "managed-openclaw-primary:hermes:planner".to_string(),
                    instance_id: DEFAULT_INSTANCE_ID.to_string(),
                    kernel_id: "hermes".to_string(),
                    agent_id: "planner".to_string(),
                    label: "Planner".to_string(),
                    description: Some("Persisted planner agent.".to_string()),
                    source: "kernelCatalog".to_string(),
                    system_prompt: Some("plan first".to_string()),
                    avatar: Some("P".to_string()),
                    creator: Some("Hermes".to_string()),
                    is_default: true,
                    sort_order: 0,
                    synced_at: 42,
                    native_metadata: None,
                }],
            )
            .expect("store initial persisted kernel chat agent");

        let replaced = service
            .replace_persisted_kernel_chat_agents(
                &paths,
                &config,
                &storage,
                DEFAULT_INSTANCE_ID,
                vec![super::PersistedKernelChatAgentRecord {
                    id: "managed-openclaw-primary:hermes:main".to_string(),
                    instance_id: DEFAULT_INSTANCE_ID.to_string(),
                    kernel_id: "hermes".to_string(),
                    agent_id: "main".to_string(),
                    label: "Main".to_string(),
                    description: Some("Replacement persisted agent.".to_string()),
                    source: "kernelCatalog".to_string(),
                    system_prompt: Some("main".to_string()),
                    avatar: Some("M".to_string()),
                    creator: Some("Hermes".to_string()),
                    is_default: true,
                    sort_order: 0,
                    synced_at: 43,
                    native_metadata: None,
                }],
            )
            .expect("replace persisted kernel chat agents");

        let records = service
            .list_persisted_kernel_chat_agents(&paths, &config, &storage, DEFAULT_INSTANCE_ID)
            .expect("list persisted kernel chat agents");

        let stale_value = storage
            .get_text(
                &paths,
                &config,
                crate::framework::storage::StorageGetTextRequest {
                    profile_id: Some("default-sqlite".to_string()),
                    namespace: Some(super::CHAT_NAMESPACE.to_string()),
                    key: super::persisted_kernel_chat_agent_storage_key(
                        DEFAULT_INSTANCE_ID,
                        "hermes",
                        "planner",
                    ),
                },
            )
            .expect("read stale persisted kernel chat agent")
            .value;

        assert_eq!(replaced.len(), 1);
        assert_eq!(records.len(), 1);
        assert_eq!(records[0].agent_id, "main");
        assert!(
            stale_value.is_none(),
            "stale persisted kernel chat agents should be removed when the snapshot is replaced"
        );
    }

    #[test]
    fn built_in_instance_detail_reports_gateway_and_openai_http_endpoints_when_the_gateway_is_running(
    ) {
        let (_root, paths, config, storage, service) = studio_context();
        let supervisor = SupervisorService::new();
        let (runtime, _server) = create_openclaw_runtime_fixture(&paths);
        let expected_gateway_ws_url = format!("ws://127.0.0.1:{}", runtime.gateway_port);
        let expected_chat_url = format!(
            "http://127.0.0.1:{}/v1/chat/completions",
            runtime.gateway_port
        );
        let expected_responses_url =
            format!("http://127.0.0.1:{}/v1/responses", runtime.gateway_port);
        supervisor
            .configure_openclaw_gateway(&runtime)
            .expect("configure runtime");
        supervisor
            .record_running(SERVICE_ID_OPENCLAW_GATEWAY, Some(42))
            .expect("record running");
        fs::write(
            &openclaw_config_file_path(&paths),
            r#"{
  gateway: {
    port: 19876,
    auth: {
      mode: "token",
      token: "studio-token",
    },
    http: {
      endpoints: {
        chatCompletions: { enabled: true },
        responses: { enabled: true },
      },
    },
  },
  studio: {
    logLevel: "debug",
    corsOrigins: "http://localhost:3001",
    sandbox: true,
    autoUpdate: true,
  },
}
"#,
        )
        .expect("seed config file");
        fs::write(
            paths.logs_dir.join("openclaw-gateway.log"),
            "gateway booted\nchat completions ready\n",
        )
        .expect("seed managed log");
        fs::write(
            &paths.main_log_file,
            "desktop shell booted\nopenclaw background activation scheduled\n",
        )
        .expect("seed desktop app log");

        let detail = service
            .get_instance_detail_with_supervisor(
                &paths,
                &config,
                &storage,
                &supervisor,
                DEFAULT_INSTANCE_ID,
            )
            .expect("load instance detail")
            .expect("built-in detail");

        assert_eq!(detail.instance.runtime_kind, StudioRuntimeKind::Openclaw);
        assert_eq!(
            detail.lifecycle.owner,
            StudioInstanceLifecycleOwner::AppManaged
        );
        assert!(detail.lifecycle.start_stop_supported);
        assert!(detail.lifecycle.lifecycle_controllable);
        assert!(detail.lifecycle.workbench_managed);
        assert!(detail.lifecycle.endpoint_observed);
        assert_eq!(detail.storage.provider, StorageProviderKind::LocalFile);
        assert!(detail
            .connectivity
            .endpoints
            .iter()
            .any(|endpoint| endpoint.id == "gateway-ws"
                && endpoint.url.as_deref() == Some(expected_gateway_ws_url.as_str())
                && endpoint.auth == StudioInstanceAuthMode::Token));
        assert!(detail
            .connectivity
            .endpoints
            .iter()
            .any(|endpoint| endpoint.id == "openai-http-chat"
                && endpoint.url.as_deref() == Some(expected_chat_url.as_str())));
        assert!(detail
            .connectivity
            .endpoints
            .iter()
            .any(|endpoint| endpoint.id == "openai-http-responses"
                && endpoint.url.as_deref() == Some(expected_responses_url.as_str())));
        assert!(detail.observability.log_available);
        assert!(detail.data_access.routes.iter().any(|route| route.scope
            == StudioInstanceDataAccessScope::Config
            && route.mode == StudioInstanceDataAccessMode::ManagedFile
            && route.authoritative
            && route.target.as_deref()
                == Some(openclaw_config_file_path(&paths).to_string_lossy().as_ref())));
        assert!(detail.artifacts.iter().any(|artifact| artifact.kind
            == StudioInstanceArtifactKind::WorkspaceDirectory
            && artifact.location.as_deref()
                == Some(paths.openclaw_workspace_dir.to_string_lossy().as_ref())));
        assert!(detail
            .artifacts
            .iter()
            .any(|artifact| artifact.id == "desktop-main-log-file"
                && artifact.kind == StudioInstanceArtifactKind::LogFile
                && artifact.location.as_deref()
                    == Some(paths.main_log_file.to_string_lossy().as_ref())));
        assert!(detail
            .capabilities
            .iter()
            .any(|capability| capability.id == StudioInstanceCapability::Chat
                && capability.status == StudioInstanceCapabilityStatus::Ready));
    }

    #[test]
    fn built_in_instance_detail_reads_authority_config_file_target() {
        let (_root, paths, config, storage, service) = studio_context();
        let (supervisor, _server) = configured_openclaw_supervisor(&paths);
        let config_file_path = KernelRuntimeAuthorityService::new()
            .active_config_file_path("openclaw", &paths)
            .expect("authority config file path");

        fs::write(
            &config_file_path,
            r#"{
  gateway: {
    port: 19876,
    auth: {
      mode: "token",
      token: "studio-token",
    },
  },
}
"#,
        )
        .expect("seed authority config file");

        let detail = service
            .get_instance_detail_with_supervisor(
                &paths,
                &config,
                &storage,
                &supervisor,
                DEFAULT_INSTANCE_ID,
            )
            .expect("load instance detail")
            .expect("built-in detail");

        assert!(detail.data_access.routes.iter().any(|route| route.scope
            == StudioInstanceDataAccessScope::Config
            && route.mode == StudioInstanceDataAccessMode::ManagedFile
            && route.authoritative
            && route.target.as_deref() == Some(config_file_path.to_string_lossy().as_ref())));
    }

    #[test]
    fn built_in_instance_detail_keeps_canonical_config_targets_when_authority_path_is_stale() {
        let (_root, paths, config, storage, service) = studio_context();
        let (supervisor, _server) = configured_openclaw_supervisor(&paths);
        let stale_config_file_path = stale_authority_config_file_path(&paths);
        let canonical_config_file_path = paths.openclaw_config_file.clone();
        let authority_file = paths
            .kernel_paths("openclaw")
            .expect("openclaw kernel paths")
            .authority_file;

        if let Some(parent) = canonical_config_file_path.parent() {
            fs::create_dir_all(parent).expect("canonical config parent");
        }
        fs::write(
            &canonical_config_file_path,
            r#"{
  gateway: {
    port: 19876,
    auth: {
      mode: "token",
      token: "studio-token",
    },
  },
}
"#,
        )
        .expect("seed canonical config file");

        let mut authority = super::read_openclaw_authority_state(&paths).expect("authority state");
        authority.config_file_path = Some(stale_config_file_path.to_string_lossy().into_owned());
        fs::write(
            &authority_file,
            format!(
                "{}\n",
                serde_json::to_string_pretty(&authority).expect("serialize authority")
            ),
        )
        .expect("write stale authority file");

        let detail = service
            .get_instance_detail_with_supervisor(
                &paths,
                &config,
                &storage,
                &supervisor,
                DEFAULT_INSTANCE_ID,
            )
            .expect("load instance detail")
            .expect("built-in detail");

        assert!(detail.data_access.routes.iter().any(|route| route.scope
            == StudioInstanceDataAccessScope::Config
            && route.mode == StudioInstanceDataAccessMode::ManagedFile
            && route.authoritative
            && route.target.as_deref()
                == Some(canonical_config_file_path.to_string_lossy().as_ref())));
        assert!(detail.artifacts.iter().any(|artifact| artifact.kind
            == StudioInstanceArtifactKind::ConfigFile
            && artifact.location.as_deref()
                == Some(canonical_config_file_path.to_string_lossy().as_ref())));
    }

    #[test]
    fn built_in_instance_detail_reports_canonical_runtime_directory_when_noncanonical_app_path_field_drifts(
    ) {
        let (root, mut paths, config, storage, service) = studio_context();
        let openclaw = paths
            .kernel_paths("openclaw")
            .expect("openclaw kernel paths");
        let (supervisor, _server) = configured_openclaw_supervisor(&paths);

        paths.openclaw_runtime_dir = root.path().join("noncanonical-app-paths").join("runtime");

        let detail = service
            .get_instance_detail_with_supervisor(
                &paths,
                &config,
                &storage,
                &supervisor,
                DEFAULT_INSTANCE_ID,
            )
            .expect("load instance detail")
            .expect("built-in detail");

        assert!(detail
            .artifacts
            .iter()
            .any(|artifact| artifact.id == "runtime-directory"
                && artifact.kind == StudioInstanceArtifactKind::RuntimeDirectory
                && artifact.location.as_deref()
                    == Some(openclaw.runtime_dir.to_string_lossy().as_ref())));
    }

    #[test]
    fn studio_production_code_does_not_call_openclaw_specific_config_wrapper() {
        let production_source = include_str!("studio.rs")
            .split("mod tests {")
            .next()
            .expect("production source");

        assert!(!production_source.contains(".active_openclaw_config_path("));
    }

    #[test]
    fn built_in_instance_detail_projects_control_ui_base_path_into_live_gateway_websocket_url() {
        let (_root, paths, config, storage, service) = studio_context();
        let supervisor = SupervisorService::new();
        let (runtime, _server) = create_openclaw_runtime_fixture(&paths);
        let expected_gateway_http_url = format!("http://127.0.0.1:{}", runtime.gateway_port);
        let expected_gateway_ws_url = format!("ws://127.0.0.1:{}/openclaw", runtime.gateway_port);
        supervisor
            .configure_openclaw_gateway(&runtime)
            .expect("configure runtime");
        supervisor
            .record_running(SERVICE_ID_OPENCLAW_GATEWAY, Some(42))
            .expect("record running");
        fs::write(
            &openclaw_config_file_path(&paths),
            r#"{
  gateway: {
    port: 19876,
    controlUi: {
      basePath: "/openclaw",
    },
    auth: {
      mode: "token",
      token: "studio-token",
    },
    http: {
      endpoints: {
        chatCompletions: { enabled: true },
      },
    },
  },
}
"#,
        )
        .expect("seed config file");

        let detail = service
            .get_instance_detail_with_supervisor(
                &paths,
                &config,
                &storage,
                &supervisor,
                DEFAULT_INSTANCE_ID,
            )
            .expect("load instance detail")
            .expect("built-in detail");

        assert_eq!(
            detail.instance.base_url.as_deref(),
            Some(expected_gateway_http_url.as_str())
        );
        assert_eq!(
            detail.config.base_url.as_deref(),
            Some(expected_gateway_http_url.as_str())
        );
        assert_eq!(
            detail.instance.websocket_url.as_deref(),
            Some(expected_gateway_ws_url.as_str())
        );
        assert_eq!(
            detail.config.websocket_url.as_deref(),
            Some(expected_gateway_ws_url.as_str())
        );
        assert!(detail
            .connectivity
            .endpoints
            .iter()
            .any(|endpoint| endpoint.id == "gateway-ws"
                && endpoint.url.as_deref() == Some(expected_gateway_ws_url.as_str())));
        assert!(detail
            .connectivity
            .endpoints
            .iter()
            .any(|endpoint| endpoint.id == "openai-http-chat"
                && endpoint.url.as_deref()
                    == Some(format!("{expected_gateway_http_url}/v1/chat/completions").as_str())));
    }

    #[test]
    fn managed_openclaw_gateway_projection_projects_control_ui_base_path_into_websocket_url() {
        let (_root, paths, config, storage, service) = studio_context();
        let supervisor = SupervisorService::new();
        let (runtime, _server) = create_openclaw_runtime_fixture(&paths);
        let expected_gateway_http_url = format!("http://127.0.0.1:{}", runtime.gateway_port);
        let expected_gateway_ws_url = format!("ws://127.0.0.1:{}/openclaw", runtime.gateway_port);
        supervisor
            .configure_openclaw_gateway(&runtime)
            .expect("configure runtime");
        supervisor
            .record_running(SERVICE_ID_OPENCLAW_GATEWAY, Some(42))
            .expect("record running");
        fs::write(
            &openclaw_config_file_path(&paths),
            r#"{
  gateway: {
    port: 19876,
    controlUi: {
      basePath: "/openclaw",
    },
    auth: {
      mode: "token",
      token: "studio-token",
    },
  },
}
"#,
        )
        .expect("seed config file");

        let host_endpoints = service
            .get_host_endpoints(&paths, &config, &storage, &supervisor, None)
            .expect("load host endpoints");
        let gateway_endpoint = host_endpoints
            .iter()
            .find(|endpoint| endpoint.endpoint_id == "openclaw-gateway")
            .expect("managed gateway endpoint");
        assert_eq!(
            gateway_endpoint.base_url.as_deref(),
            Some(expected_gateway_http_url.as_str())
        );
        assert_eq!(
            gateway_endpoint.websocket_url.as_deref(),
            Some(expected_gateway_ws_url.as_str())
        );

        let runtime_projection = service
            .get_openclaw_runtime(&paths, &config, &storage, &supervisor)
            .expect("load runtime projection");
        assert_eq!(
            runtime_projection.base_url.as_deref(),
            Some(expected_gateway_http_url.as_str())
        );
        assert_eq!(
            runtime_projection.websocket_url.as_deref(),
            Some(expected_gateway_ws_url.as_str())
        );

        let gateway_projection = service
            .get_openclaw_gateway(&paths, &config, &storage, &supervisor)
            .expect("load gateway projection");
        assert_eq!(
            gateway_projection.base_url.as_deref(),
            Some(expected_gateway_http_url.as_str())
        );
        assert_eq!(
            gateway_projection.websocket_url.as_deref(),
            Some(expected_gateway_ws_url.as_str())
        );
    }

    #[test]
    fn built_in_instance_detail_hides_live_gateway_endpoints_when_the_gateway_is_not_running() {
        let (_root, paths, config, storage, service) = studio_context();
        fs::write(
            &openclaw_config_file_path(&paths),
            r#"{
  gateway: {
    port: 19876,
    auth: {
      mode: "token",
      token: "studio-token",
    },
  },
}
"#,
        )
        .expect("seed config file");

        let detail = service
            .get_instance_detail(&paths, &config, &storage, DEFAULT_INSTANCE_ID)
            .expect("load instance detail")
            .expect("built-in detail");

        assert_eq!(detail.instance.status, StudioInstanceStatus::Offline);
        assert!(detail.instance.base_url.is_none());
        assert!(detail.instance.websocket_url.is_none());
        assert!(detail.config.base_url.is_none());
        assert!(detail.config.websocket_url.is_none());
        assert!(detail
            .connectivity
            .endpoints
            .iter()
            .all(|endpoint| endpoint.id != "gateway-http"));
        assert!(detail
            .connectivity
            .endpoints
            .iter()
            .all(|endpoint| endpoint.id != "gateway-ws"));
        assert!(detail
            .connectivity
            .endpoints
            .iter()
            .all(|endpoint| endpoint.id != "openai-http-chat"));
        assert!(detail
            .connectivity
            .endpoints
            .iter()
            .all(|endpoint| endpoint.id != "openai-http-responses"));
    }

    #[test]
    fn built_in_instance_detail_exposes_last_gateway_start_error_when_bundled_openclaw_fails() {
        let (_root, paths, config, storage, service) = studio_context();
        let supervisor = SupervisorService::new();
        let (runtime, _server) = create_openclaw_runtime_fixture(&paths);
        let expected_error = "openclaw gateway readiness timeout";
        fs::write(
            &paths.main_log_file,
            concat!(
                "bundled openclaw activation stage: prepare-runtime-activation\n",
                "bundled openclaw activation stage: bundled-runtime-ready\n",
                "bundled openclaw activation stage: gateway-configured\n"
            ),
        )
        .expect("seed desktop app log");

        supervisor
            .configure_openclaw_gateway(&runtime)
            .expect("configure runtime");
        supervisor
            .record_stopped(
                SERVICE_ID_OPENCLAW_GATEWAY,
                Some(101),
                Some(expected_error.to_string()),
            )
            .expect("record stopped");

        let detail = service
            .get_instance_detail_with_supervisor(
                &paths,
                &config,
                &storage,
                &supervisor,
                DEFAULT_INSTANCE_ID,
            )
            .expect("load instance detail")
            .expect("built-in detail");
        let lifecycle_json =
            serde_json::to_value(&detail.lifecycle).expect("serialize lifecycle snapshot");

        assert_eq!(detail.instance.status, StudioInstanceStatus::Error);
        assert!(detail
            .lifecycle
            .notes
            .iter()
            .any(|note| note.contains(expected_error)));
        assert_eq!(
            lifecycle_json
                .get("lastError")
                .and_then(|value| value.as_str()),
            Some(expected_error)
        );
        assert_eq!(
            lifecycle_json
                .get("lastActivationStage")
                .and_then(|value| value.as_str()),
            Some("prepareConfig")
        );
        assert!(detail.lifecycle.notes.iter().any(|note| {
            note == "Last built-in OpenClaw activation detail stage: Gateway Configured"
        }));
    }

    #[test]
    fn custom_local_managed_openclaw_detail_does_not_read_built_in_managed_config() {
        let (_root, paths, config, storage, service) = studio_context();
        fs::write(
            &openclaw_config_file_path(&paths),
            r#"{
  gateway: {
    port: 19876,
    auth: {
      mode: "token",
      token: "studio-token",
    },
    http: {
      endpoints: {
        responses: { enabled: true },
      },
    },
  },
}
"#,
        )
        .expect("seed config file");

        let instance = service
            .create_instance(
                &paths,
                &config,
                &storage,
                StudioCreateInstanceInput {
                    name: "Custom Local OpenClaw".to_string(),
                    description: Some("Instance-owned local-managed runtime".to_string()),
                    runtime_kind: StudioRuntimeKind::Openclaw,
                    deployment_mode: StudioInstanceDeploymentMode::LocalManaged,
                    transport_kind: StudioInstanceTransportKind::OpenclawGatewayWs,
                    icon_type: None,
                    version: Some("custom".to_string()),
                    type_label: Some("Custom Local Managed".to_string()),
                    host: Some("127.0.0.1".to_string()),
                    port: Some(28789),
                    base_url: Some("http://127.0.0.1:28789".to_string()),
                    websocket_url: Some("ws://127.0.0.1:28789".to_string()),
                    storage: None,
                    config: Some(PartialStudioInstanceConfig {
                        workspace_path: Some("/custom/workspace".to_string()),
                        ..Default::default()
                    }),
                },
            )
            .expect("create custom managed instance");

        let detail = service
            .get_instance_detail(&paths, &config, &storage, &instance.id)
            .expect("load instance detail")
            .expect("custom detail");

        assert_eq!(
            detail.lifecycle.owner,
            StudioInstanceLifecycleOwner::ExternalProcess
        );
        assert!(!detail.lifecycle.start_stop_supported);
        assert!(!detail.lifecycle.config_writable);
        assert!(!detail.lifecycle.lifecycle_controllable);
        assert!(!detail.lifecycle.workbench_managed);
        assert!(!detail.lifecycle.endpoint_observed);
        assert!(detail.workbench.is_none());
        assert!(detail
            .connectivity
            .endpoints
            .iter()
            .all(|endpoint| endpoint.id != "openai-http-responses"));

        let config_route = detail
            .data_access
            .routes
            .iter()
            .find(|route| route.scope == StudioInstanceDataAccessScope::Config)
            .expect("config route");
        assert_eq!(
            config_route.mode,
            StudioInstanceDataAccessMode::MetadataOnly
        );
        assert!(!config_route.authoritative);
        assert_ne!(
            config_route.target.as_deref(),
            Some(openclaw_config_file_path(&paths).to_string_lossy().as_ref())
        );
        assert_eq!(
            config_route.target.as_deref(),
            Some("studio.instances registry metadata")
        );
    }

    #[test]
    fn create_instance_accepts_local_managed_hermes_records() {
        let (_root, paths, config, storage, service) = studio_context();
        let instances_before = service
            .list_instances(&paths, &config, &storage)
            .expect("list instances before");

        let created = service
            .create_instance(
                &paths,
                &config,
                &storage,
                StudioCreateInstanceInput {
                    name: "Hermes Local Managed".to_string(),
                    description: Some("Managed local Hermes runtime".to_string()),
                    runtime_kind: StudioRuntimeKind::Hermes,
                    deployment_mode: StudioInstanceDeploymentMode::LocalManaged,
                    transport_kind: StudioInstanceTransportKind::CustomHttp,
                    icon_type: None,
                    version: Some("0.1.0".to_string()),
                    type_label: Some("Hermes Agent".to_string()),
                    host: Some("127.0.0.1".to_string()),
                    port: Some(19540),
                    base_url: Some("http://127.0.0.1:19540".to_string()),
                    websocket_url: None,
                    storage: None,
                    config: Some(PartialStudioInstanceConfig {
                        port: Some("19540".to_string()),
                        base_url: Some("http://127.0.0.1:19540".to_string()),
                        ..Default::default()
                    }),
                },
            )
            .expect("local-managed Hermes should be accepted");
        let instances_after = service
            .list_instances(&paths, &config, &storage)
            .expect("list instances after");
        assert_eq!(instances_after.len(), instances_before.len() + 1);

        let detail = service
            .get_instance_detail(&paths, &config, &storage, &created.id)
            .expect("load hermes instance detail")
            .expect("managed hermes detail");

        assert_eq!(detail.instance.runtime_kind, StudioRuntimeKind::Hermes);
        assert_eq!(
            detail.instance.deployment_mode,
            StudioInstanceDeploymentMode::LocalManaged
        );
        assert_eq!(
            detail.lifecycle.owner,
            StudioInstanceLifecycleOwner::AppManaged
        );
        assert!(!detail.lifecycle.start_stop_supported);
        assert!(detail.lifecycle.config_writable);
        assert!(!detail.lifecycle.workbench_managed);
        assert!(detail.data_access.routes.iter().any(|route| route.scope
            == StudioInstanceDataAccessScope::Config
            && route.mode == StudioInstanceDataAccessMode::ManagedFile
            && route.authoritative
            && route.target.as_deref().is_some_and(|target| target
                .replace('\\', "/")
                .ends_with("/app-user-root/.hermes/config.yaml"))));
        assert!(detail.workbench.is_none());
    }

    #[test]
    fn built_in_instance_detail_exposes_console_access_with_auto_login_url() {
        let (_root, paths, config, storage, service) = studio_context();
        let supervisor = SupervisorService::new();
        let (runtime, _server) = create_openclaw_runtime_fixture(&paths);
        let expected_console_url = format!("http://127.0.0.1:{}/openclaw/", runtime.gateway_port);
        let expected_gateway_url = format!("ws://127.0.0.1:{}/openclaw", runtime.gateway_port);
        let expected_auto_login_url = format!(
            "{}?gatewayUrl={}#token=studio-token",
            expected_console_url,
            percent_encode_url_component(&expected_gateway_url)
        );
        supervisor
            .configure_openclaw_gateway(&runtime)
            .expect("configure runtime");
        supervisor
            .record_running(SERVICE_ID_OPENCLAW_GATEWAY, Some(42))
            .expect("record running");
        fs::write(
            &openclaw_config_file_path(&paths),
            r#"{
  gateway: {
    port: 19876,
    controlUi: {
      basePath: "/openclaw",
    },
    auth: {
      mode: "token",
      token: "studio-token",
    },
  },
}
"#,
        )
        .expect("seed config file");

        let detail = service
            .get_instance_detail_with_supervisor(
                &paths,
                &config,
                &storage,
                &supervisor,
                DEFAULT_INSTANCE_ID,
            )
            .expect("load instance detail")
            .expect("built-in detail");
        let serialized = serde_json::to_value(&detail).expect("serialize detail");
        let console_access = serialized
            .get("consoleAccess")
            .and_then(Value::as_object)
            .expect("detail should include console access");

        assert_eq!(
            console_access.get("kind").and_then(Value::as_str),
            Some("openclawControlUi")
        );
        assert_eq!(
            console_access.get("available").and_then(Value::as_bool),
            Some(true)
        );
        assert_eq!(
            console_access.get("url").and_then(Value::as_str),
            Some(expected_console_url.as_str())
        );
        assert_eq!(
            console_access.get("gatewayUrl").and_then(Value::as_str),
            Some(expected_gateway_url.as_str())
        );
        assert_eq!(
            console_access.get("autoLoginUrl").and_then(Value::as_str),
            Some(expected_auto_login_url.as_str())
        );
        assert_eq!(
            console_access.get("authMode").and_then(Value::as_str),
            Some("token")
        );
        assert_eq!(
            console_access.get("authSource").and_then(Value::as_str),
            Some("configFile")
        );
        assert_eq!(
            console_access.get("installMethod").and_then(Value::as_str),
            Some("bundled")
        );
    }

    #[test]
    fn built_in_instance_detail_hides_console_launch_when_the_gateway_is_not_running() {
        let (_root, paths, config, storage, service) = studio_context();
        fs::write(
            &openclaw_config_file_path(&paths),
            r#"{
  gateway: {
    port: 19876,
    auth: {
      mode: "token",
      token: "studio-token",
    },
  },
}
"#,
        )
        .expect("seed config file");

        let detail = service
            .get_instance_detail(&paths, &config, &storage, DEFAULT_INSTANCE_ID)
            .expect("load instance detail")
            .expect("built-in detail");
        let serialized = serde_json::to_value(&detail).expect("serialize detail");
        let console_access = serialized
            .get("consoleAccess")
            .and_then(Value::as_object)
            .expect("detail should include console access");

        assert_eq!(
            console_access.get("available").and_then(Value::as_bool),
            Some(false)
        );
        assert!(console_access.get("autoLoginUrl").is_none());
        assert!(console_access
            .get("reason")
            .and_then(Value::as_str)
            .unwrap_or_default()
            .contains("not running"));
    }

    #[test]
    fn built_in_instance_detail_hides_auto_login_for_secret_ref_tokens() {
        let (_root, paths, config, storage, service) = studio_context();
        let supervisor = SupervisorService::new();
        let (runtime, _server) = create_openclaw_runtime_fixture(&paths);
        let expected_console_url = format!("http://127.0.0.1:{}/", runtime.gateway_port);
        supervisor
            .configure_openclaw_gateway(&runtime)
            .expect("configure runtime");
        supervisor
            .record_running(SERVICE_ID_OPENCLAW_GATEWAY, Some(42))
            .expect("record running");
        fs::write(
            &openclaw_config_file_path(&paths),
            r#"{
  gateway: {
    port: 19876,
    auth: {
      mode: "token",
      token: "secretRef://gateway-token",
    },
  },
}
"#,
        )
        .expect("seed config file");

        let detail = service
            .get_instance_detail_with_supervisor(
                &paths,
                &config,
                &storage,
                &supervisor,
                DEFAULT_INSTANCE_ID,
            )
            .expect("load instance detail")
            .expect("built-in detail");
        let serialized = serde_json::to_value(&detail).expect("serialize detail");
        let console_access = serialized
            .get("consoleAccess")
            .and_then(Value::as_object)
            .expect("detail should include console access");

        assert_eq!(
            console_access.get("url").and_then(Value::as_str),
            Some(expected_console_url.as_str())
        );
        assert_eq!(
            console_access.get("authMode").and_then(Value::as_str),
            Some("token")
        );
        assert_eq!(
            console_access.get("authSource").and_then(Value::as_str),
            Some("secretRef")
        );
        assert!(
            console_access.get("autoLoginUrl").is_none(),
            "secret-managed tokens must not be embedded into auto-login URLs"
        );
        assert!(console_access
            .get("reason")
            .and_then(Value::as_str)
            .unwrap_or_default()
            .contains("manual"));
    }

    #[test]
    fn local_external_openclaw_detail_reads_install_record_for_console_auto_login() {
        let (root, paths, config, storage, service) = studio_context();
        let install_root = root.path().join("external-install");
        let work_root = root.path().join("external-work");
        let data_root = root.path().join("external-data");
        let host_openclaw_root = paths.user_root.join(".openclaw");
        fs::create_dir_all(&install_root).expect("create install root");
        fs::create_dir_all(&work_root).expect("create work root");
        fs::create_dir_all(&data_root).expect("create data root");
        fs::create_dir_all(&host_openclaw_root).expect("create host openclaw root");
        fs::write(
            host_openclaw_root.join("openclaw.json"),
            r#"{
  gateway: {
    port: 28789,
    controlUi: {
      basePath: "/console",
    },
    auth: {
      mode: "token",
      token: "external-token",
    },
  },
}
"#,
        )
        .expect("write external config");
        write_openclaw_install_record(
            &paths,
            "openclaw-npm",
            &install_root,
            &work_root,
            &data_root,
            EffectiveRuntimePlatform::Windows,
            InstallControlLevel::Partial,
        );

        let instance = service
            .create_instance(
                &paths,
                &config,
                &storage,
                StudioCreateInstanceInput {
                    name: "External OpenClaw".to_string(),
                    description: Some("Host OpenClaw runtime".to_string()),
                    runtime_kind: StudioRuntimeKind::Openclaw,
                    deployment_mode: StudioInstanceDeploymentMode::LocalExternal,
                    transport_kind: StudioInstanceTransportKind::OpenclawGatewayWs,
                    icon_type: None,
                    version: Some("1.0.0".to_string()),
                    type_label: Some("OpenClaw External".to_string()),
                    host: Some("127.0.0.1".to_string()),
                    port: Some(28789),
                    base_url: Some("http://127.0.0.1:28789".to_string()),
                    websocket_url: Some("ws://127.0.0.1:28789".to_string()),
                    storage: None,
                    config: Some(super::PartialStudioInstanceConfig {
                        base_url: Some("http://127.0.0.1:28789".to_string()),
                        websocket_url: Some("ws://127.0.0.1:28789".to_string()),
                        port: Some("28789".to_string()),
                        ..super::PartialStudioInstanceConfig::default()
                    }),
                },
            )
            .expect("create local external openclaw");

        service
            .update_instance(
                &paths,
                &config,
                &storage,
                &instance.id,
                super::StudioUpdateInstanceInput {
                    status: Some(StudioInstanceStatus::Online),
                    ..super::StudioUpdateInstanceInput::default()
                },
            )
            .expect("mark local external runtime online");

        let detail = service
            .get_instance_detail(&paths, &config, &storage, &instance.id)
            .expect("load instance detail")
            .expect("local external detail");
        let serialized = serde_json::to_value(&detail).expect("serialize detail");
        let console_access = serialized
            .get("consoleAccess")
            .and_then(Value::as_object)
            .expect("detail should include console access");

        assert_eq!(
            console_access.get("available").and_then(Value::as_bool),
            Some(true)
        );
        assert_eq!(
            console_access.get("url").and_then(Value::as_str),
            Some("http://127.0.0.1:28789/console/")
        );
        assert_eq!(
            console_access.get("gatewayUrl").and_then(Value::as_str),
            Some("ws://127.0.0.1:28789/console")
        );
        assert_eq!(
            console_access.get("autoLoginUrl").and_then(Value::as_str),
            Some(
                "http://127.0.0.1:28789/console/?gatewayUrl=ws%3A%2F%2F127.0.0.1%3A28789%2Fconsole#token=external-token"
            )
        );
        assert_eq!(
            console_access.get("authSource").and_then(Value::as_str),
            Some("installRecord")
        );
        assert_eq!(
            console_access.get("installMethod").and_then(Value::as_str),
            Some("npm")
        );
        assert!(detail.workbench.is_none());
        assert!(detail.data_access.routes.iter().any(|route| route.scope
            == StudioInstanceDataAccessScope::Config
            && route.mode == StudioInstanceDataAccessMode::ManagedFile
            && route.authoritative
            && !route.readonly
            && route.target.as_deref()
                == Some(
                    host_openclaw_root
                        .join("openclaw.json")
                        .to_string_lossy()
                        .as_ref()
                )));
        assert!(detail.artifacts.iter().any(|artifact| artifact.kind
            == StudioInstanceArtifactKind::ConfigFile
            && !artifact.readonly
            && artifact.location.as_deref()
                == Some(
                    host_openclaw_root
                        .join("openclaw.json")
                        .to_string_lossy()
                        .as_ref()
                )));
    }

    #[test]
    fn local_external_openclaw_detail_hides_console_launch_while_runtime_is_offline() {
        let (root, paths, config, storage, service) = studio_context();
        let install_root = root.path().join("external-install");
        let work_root = root.path().join("external-work");
        let data_root = root.path().join("external-data");
        let host_openclaw_root = paths.user_root.join(".openclaw");
        fs::create_dir_all(&install_root).expect("create install root");
        fs::create_dir_all(&work_root).expect("create work root");
        fs::create_dir_all(&data_root).expect("create data root");
        fs::create_dir_all(&host_openclaw_root).expect("create host openclaw root");
        fs::write(
            host_openclaw_root.join("openclaw.json"),
            r#"{
  gateway: {
    port: 28789,
    controlUi: {
      basePath: "/console",
    },
    auth: {
      mode: "token",
      token: "external-token",
    },
  },
}
"#,
        )
        .expect("write external config");
        write_openclaw_install_record(
            &paths,
            "openclaw-npm",
            &install_root,
            &work_root,
            &data_root,
            EffectiveRuntimePlatform::Windows,
            InstallControlLevel::Partial,
        );

        let instance = service
            .create_instance(
                &paths,
                &config,
                &storage,
                StudioCreateInstanceInput {
                    name: "External OpenClaw".to_string(),
                    description: Some("Host OpenClaw runtime".to_string()),
                    runtime_kind: StudioRuntimeKind::Openclaw,
                    deployment_mode: StudioInstanceDeploymentMode::LocalExternal,
                    transport_kind: StudioInstanceTransportKind::OpenclawGatewayWs,
                    icon_type: None,
                    version: Some("1.0.0".to_string()),
                    type_label: Some("OpenClaw External".to_string()),
                    host: Some("127.0.0.1".to_string()),
                    port: Some(28789),
                    base_url: Some("http://127.0.0.1:28789".to_string()),
                    websocket_url: Some("ws://127.0.0.1:28789".to_string()),
                    storage: None,
                    config: Some(super::PartialStudioInstanceConfig {
                        base_url: Some("http://127.0.0.1:28789".to_string()),
                        websocket_url: Some("ws://127.0.0.1:28789".to_string()),
                        port: Some("28789".to_string()),
                        ..super::PartialStudioInstanceConfig::default()
                    }),
                },
            )
            .expect("create local external openclaw");

        let detail = service
            .get_instance_detail(&paths, &config, &storage, &instance.id)
            .expect("load instance detail")
            .expect("local external detail");
        let serialized = serde_json::to_value(&detail).expect("serialize detail");
        let console_access = serialized
            .get("consoleAccess")
            .and_then(Value::as_object)
            .expect("detail should include console access");

        assert_eq!(
            console_access.get("available").and_then(Value::as_bool),
            Some(false)
        );
        assert!(console_access.get("autoLoginUrl").is_none());
        assert!(console_access
            .get("reason")
            .and_then(Value::as_str)
            .unwrap_or_default()
            .contains("offline"));
    }

    #[test]
    fn local_external_openclaw_detail_ignores_legacy_data_root_config_candidates() {
        let (root, paths, config, storage, service) = studio_context();
        let install_root = root.path().join("external-install");
        let work_root = root.path().join("external-work");
        let data_root = root.path().join("external-data");
        let legacy_config_path = data_root.join("config").join("openclaw.json");
        fs::create_dir_all(&install_root).expect("create install root");
        fs::create_dir_all(&work_root).expect("create work root");
        fs::create_dir_all(legacy_config_path.parent().expect("legacy config parent"))
            .expect("create legacy config dir");
        fs::write(
            &legacy_config_path,
            r#"{
  gateway: {
    port: 28789,
    controlUi: {
      basePath: "/console",
    },
    auth: {
      mode: "token",
      token: "legacy-token",
    },
  },
}
"#,
        )
        .expect("write legacy config");
        write_openclaw_install_record(
            &paths,
            "openclaw-npm",
            &install_root,
            &work_root,
            &data_root,
            EffectiveRuntimePlatform::Windows,
            InstallControlLevel::Partial,
        );

        let instance = service
            .create_instance(
                &paths,
                &config,
                &storage,
                StudioCreateInstanceInput {
                    name: "Legacy Candidate OpenClaw".to_string(),
                    description: Some("Legacy config candidate should be ignored".to_string()),
                    runtime_kind: StudioRuntimeKind::Openclaw,
                    deployment_mode: StudioInstanceDeploymentMode::LocalExternal,
                    transport_kind: StudioInstanceTransportKind::OpenclawGatewayWs,
                    icon_type: None,
                    version: Some("1.0.0".to_string()),
                    type_label: Some("OpenClaw External".to_string()),
                    host: Some("127.0.0.1".to_string()),
                    port: Some(28789),
                    base_url: Some("http://127.0.0.1:28789".to_string()),
                    websocket_url: Some("ws://127.0.0.1:28789".to_string()),
                    storage: None,
                    config: Some(super::PartialStudioInstanceConfig {
                        base_url: Some("http://127.0.0.1:28789".to_string()),
                        websocket_url: Some("ws://127.0.0.1:28789".to_string()),
                        port: Some("28789".to_string()),
                        ..super::PartialStudioInstanceConfig::default()
                    }),
                },
            )
            .expect("create local external openclaw");

        service
            .update_instance(
                &paths,
                &config,
                &storage,
                &instance.id,
                super::StudioUpdateInstanceInput {
                    status: Some(StudioInstanceStatus::Online),
                    ..super::StudioUpdateInstanceInput::default()
                },
            )
            .expect("mark local external runtime online");

        let detail = service
            .get_instance_detail(&paths, &config, &storage, &instance.id)
            .expect("load instance detail")
            .expect("local external detail");
        let serialized = serde_json::to_value(&detail).expect("serialize detail");
        let console_access = serialized
            .get("consoleAccess")
            .and_then(Value::as_object)
            .expect("detail should include console access");
        let config_route = detail
            .data_access
            .routes
            .iter()
            .find(|route| route.scope == StudioInstanceDataAccessScope::Config)
            .expect("config route");

        assert_eq!(
            console_access.get("available").and_then(Value::as_bool),
            Some(true)
        );
        assert_eq!(console_access.get("autoLoginUrl"), None);
        assert_ne!(
            console_access.get("authSource").and_then(Value::as_str),
            Some("installRecord")
        );
        assert_eq!(
            config_route.mode,
            StudioInstanceDataAccessMode::MetadataOnly
        );
        assert_eq!(config_route.authoritative, false);
        assert_eq!(
            config_route.target.as_deref(),
            Some("studio.instances registry metadata")
        );
        assert!(!detail.artifacts.iter().any(|artifact| {
            artifact.kind == StudioInstanceArtifactKind::ConfigFile
                && artifact.location.as_deref()
                    == Some(legacy_config_path.to_string_lossy().as_ref())
        }));
    }

    #[test]
    fn local_external_openclaw_detail_reads_profile_specific_install_record_shape() {
        let (root, paths, config, storage, service) = studio_context();
        let install_root = root.path().join("profile-install");
        let work_root = root.path().join("profile-work");
        let data_root = root.path().join("profile-data");
        let host_openclaw_root = paths.user_root.join(".openclaw");
        let installer_home = paths.user_root.join(OPENCLAW_INSTALL_RECORDS_HOME_NAME);
        fs::create_dir_all(&install_root).expect("create install root");
        fs::create_dir_all(&work_root).expect("create work root");
        fs::create_dir_all(&data_root).expect("create data root");
        fs::create_dir_all(&host_openclaw_root).expect("create host openclaw root");
        fs::write(
            host_openclaw_root.join("openclaw.json"),
            r#"{
  gateway: {
    port: 28789,
    auth: {
      mode: "token",
      token: "profile-token",
    },
  },
}
"#,
        )
        .expect("write external config");
        write_install_record(
            installer_home.to_string_lossy().as_ref(),
            "openclaw-pnpm",
            &InstallRecord {
                schema_version: "1.0".to_string(),
                software_name: "openclaw-pnpm".to_string(),
                manifest_name: "OpenClaw Install (pnpm)".to_string(),
                manifest_path: "./manifests/openclaw-pnpm.hub.yaml".to_string(),
                manifest_source_input: "bundled-registry".to_string(),
                manifest_source_kind: "registry".to_string(),
                platform: SupportedPlatform::Windows,
                effective_runtime_platform: EffectiveRuntimePlatform::Windows,
                installer_home: installer_home.to_string_lossy().into_owned(),
                install_scope: InstallScope::User,
                install_root: install_root.to_string_lossy().into_owned(),
                work_root: work_root.to_string_lossy().into_owned(),
                bin_dir: install_root.join("bin").to_string_lossy().into_owned(),
                data_root: data_root.to_string_lossy().into_owned(),
                install_control_level: InstallControlLevel::Partial,
                status: InstallRecordStatus::Installed,
                installed_at: Some("2026-03-23T00:00:00Z".to_string()),
                updated_at: "2026-03-23T00:00:00Z".to_string(),
            },
        )
        .expect("write profile install record");

        let instance = service
            .create_instance(
                &paths,
                &config,
                &storage,
                StudioCreateInstanceInput {
                    name: "Profile OpenClaw".to_string(),
                    description: Some("Profile-specific OpenClaw runtime".to_string()),
                    runtime_kind: StudioRuntimeKind::Openclaw,
                    deployment_mode: StudioInstanceDeploymentMode::LocalExternal,
                    transport_kind: StudioInstanceTransportKind::OpenclawGatewayWs,
                    icon_type: None,
                    version: Some("1.0.0".to_string()),
                    type_label: Some("OpenClaw External".to_string()),
                    host: Some("127.0.0.1".to_string()),
                    port: Some(28789),
                    base_url: Some("http://127.0.0.1:28789".to_string()),
                    websocket_url: Some("ws://127.0.0.1:28789".to_string()),
                    storage: None,
                    config: Some(super::PartialStudioInstanceConfig {
                        base_url: Some("http://127.0.0.1:28789".to_string()),
                        websocket_url: Some("ws://127.0.0.1:28789".to_string()),
                        port: Some("28789".to_string()),
                        ..super::PartialStudioInstanceConfig::default()
                    }),
                },
            )
            .expect("create local external openclaw");

        let detail = service
            .get_instance_detail(&paths, &config, &storage, &instance.id)
            .expect("load instance detail")
            .expect("local external detail");
        let serialized = serde_json::to_value(&detail).expect("serialize detail");
        let console_access = serialized
            .get("consoleAccess")
            .and_then(Value::as_object)
            .expect("detail should include console access");

        assert_eq!(
            console_access.get("authSource").and_then(Value::as_str),
            Some("installRecord")
        );
        assert_eq!(
            console_access.get("installMethod").and_then(Value::as_str),
            Some("pnpm")
        );
        assert_eq!(console_access.get("autoLoginUrl"), None);
        assert_eq!(
            console_access.get("available").and_then(Value::as_bool),
            Some(false)
        );
    }

    #[test]
    fn local_external_openclaw_detail_reports_ansible_install_method_from_profile_record() {
        let (root, paths, config, storage, service) = studio_context();
        let install_root = root.path().join("ansible-install");
        let work_root = root.path().join("ansible-work");
        let data_root = root.path().join("ansible-data");
        let installer_home = paths.user_root.join(OPENCLAW_INSTALL_RECORDS_HOME_NAME);
        fs::create_dir_all(&install_root).expect("create ansible install root");
        fs::create_dir_all(&work_root).expect("create ansible work root");
        fs::create_dir_all(&data_root).expect("create ansible data root");
        write_install_record(
            installer_home.to_string_lossy().as_ref(),
            "openclaw-ansible",
            &InstallRecord {
                schema_version: "1.0".to_string(),
                software_name: "openclaw-ansible".to_string(),
                manifest_name: "OpenClaw Install (Ansible)".to_string(),
                manifest_path: "./manifests/openclaw-ansible.hub.yaml".to_string(),
                manifest_source_input: "bundled-registry".to_string(),
                manifest_source_kind: "registry".to_string(),
                platform: SupportedPlatform::Ubuntu,
                effective_runtime_platform: EffectiveRuntimePlatform::Ubuntu,
                installer_home: installer_home.to_string_lossy().into_owned(),
                install_scope: InstallScope::User,
                install_root: install_root.to_string_lossy().into_owned(),
                work_root: work_root.to_string_lossy().into_owned(),
                bin_dir: install_root.join("bin").to_string_lossy().into_owned(),
                data_root: data_root.to_string_lossy().into_owned(),
                install_control_level: InstallControlLevel::Opaque,
                status: InstallRecordStatus::Installed,
                installed_at: Some("2026-03-23T00:00:00Z".to_string()),
                updated_at: "2026-03-23T00:00:00Z".to_string(),
            },
        )
        .expect("write ansible install record");

        let instance = service
            .create_instance(
                &paths,
                &config,
                &storage,
                StudioCreateInstanceInput {
                    name: "Ansible OpenClaw".to_string(),
                    description: Some("Ansible OpenClaw runtime".to_string()),
                    runtime_kind: StudioRuntimeKind::Openclaw,
                    deployment_mode: StudioInstanceDeploymentMode::LocalExternal,
                    transport_kind: StudioInstanceTransportKind::OpenclawGatewayWs,
                    icon_type: None,
                    version: Some("1.0.0".to_string()),
                    type_label: Some("OpenClaw External".to_string()),
                    host: Some("127.0.0.1".to_string()),
                    port: Some(28789),
                    base_url: Some("http://127.0.0.1:28789".to_string()),
                    websocket_url: Some("ws://127.0.0.1:28789".to_string()),
                    storage: None,
                    config: Some(super::PartialStudioInstanceConfig {
                        base_url: Some("http://127.0.0.1:28789".to_string()),
                        websocket_url: Some("ws://127.0.0.1:28789".to_string()),
                        port: Some("28789".to_string()),
                        workspace_path: Some(work_root.to_string_lossy().into_owned()),
                        ..super::PartialStudioInstanceConfig::default()
                    }),
                },
            )
            .expect("create ansible openclaw");

        let detail = service
            .get_instance_detail(&paths, &config, &storage, &instance.id)
            .expect("load instance detail")
            .expect("ansible local external detail");
        let serialized = serde_json::to_value(&detail).expect("serialize detail");
        let console_access = serialized
            .get("consoleAccess")
            .and_then(Value::as_object)
            .expect("detail should include console access");

        assert_eq!(
            console_access.get("installMethod").and_then(Value::as_str),
            Some("ansible")
        );
    }

    #[test]
    fn openclaw_console_install_method_falls_back_to_ansible_manifest_name() {
        let record = InstallRecord {
            schema_version: "1.0".to_string(),
            software_name: "openclaw-custom".to_string(),
            manifest_name: "OpenClaw Install (Ansible)".to_string(),
            manifest_path: "./manifests/openclaw-custom.hub.yaml".to_string(),
            manifest_source_input: "bundled-registry".to_string(),
            manifest_source_kind: "registry".to_string(),
            platform: SupportedPlatform::Ubuntu,
            effective_runtime_platform: EffectiveRuntimePlatform::Ubuntu,
            installer_home: format!("/tmp/{OPENCLAW_INSTALL_RECORDS_HOME_NAME}"),
            install_scope: InstallScope::User,
            install_root: "/tmp/openclaw/install".to_string(),
            work_root: "/tmp/openclaw/work".to_string(),
            bin_dir: "/tmp/openclaw/bin".to_string(),
            data_root: "/tmp/openclaw/data".to_string(),
            install_control_level: InstallControlLevel::Opaque,
            status: InstallRecordStatus::Installed,
            installed_at: Some("2026-03-23T00:00:00Z".to_string()),
            updated_at: "2026-03-23T00:00:00Z".to_string(),
        };

        assert_eq!(
            console_install_method_from_install_record(&record),
            StudioInstanceConsoleInstallMethod::Ansible
        );
    }

    #[test]
    fn local_external_openclaw_detail_prefers_install_record_matching_instance_workspace() {
        let (root, paths, config, storage, service) = studio_context();
        let host_openclaw_root = paths.user_root.join(".openclaw");
        let installer_home = paths.user_root.join(OPENCLAW_INSTALL_RECORDS_HOME_NAME);
        let profile_work_root = root.path().join("target-work");
        let profile_install_root = root.path().join("target-install");
        let profile_data_root = root.path().join("target-data");
        let other_work_root = root.path().join("other-work");
        let other_install_root = root.path().join("other-install");
        let other_data_root = root.path().join("other-data");
        fs::create_dir_all(&host_openclaw_root).expect("create host openclaw root");
        fs::create_dir_all(&profile_work_root).expect("create target work root");
        fs::create_dir_all(&profile_install_root).expect("create target install root");
        fs::create_dir_all(&profile_data_root).expect("create target data root");
        fs::create_dir_all(&other_work_root).expect("create other work root");
        fs::create_dir_all(&other_install_root).expect("create other install root");
        fs::create_dir_all(&other_data_root).expect("create other data root");
        fs::write(
            host_openclaw_root.join("openclaw.json"),
            r#"{
  gateway: {
    port: 28789,
    auth: {
      mode: "token",
      token: "workspace-token",
    },
  },
}
"#,
        )
        .expect("write external config");
        write_install_record(
            installer_home.to_string_lossy().as_ref(),
            "openclaw-docker",
            &InstallRecord {
                schema_version: "1.0".to_string(),
                software_name: "openclaw-docker".to_string(),
                manifest_name: "OpenClaw Install (Docker)".to_string(),
                manifest_path: "./manifests/openclaw-docker.hub.yaml".to_string(),
                manifest_source_input: "bundled-registry".to_string(),
                manifest_source_kind: "registry".to_string(),
                platform: SupportedPlatform::Windows,
                effective_runtime_platform: EffectiveRuntimePlatform::Windows,
                installer_home: installer_home.to_string_lossy().into_owned(),
                install_scope: InstallScope::User,
                install_root: other_install_root.to_string_lossy().into_owned(),
                work_root: other_work_root.to_string_lossy().into_owned(),
                bin_dir: other_install_root
                    .join("bin")
                    .to_string_lossy()
                    .into_owned(),
                data_root: other_data_root.to_string_lossy().into_owned(),
                install_control_level: InstallControlLevel::Managed,
                status: InstallRecordStatus::Installed,
                installed_at: Some("2026-03-23T01:00:00Z".to_string()),
                updated_at: "2026-03-23T01:00:00Z".to_string(),
            },
        )
        .expect("write docker install record");
        write_install_record(
            installer_home.to_string_lossy().as_ref(),
            "openclaw-pnpm",
            &InstallRecord {
                schema_version: "1.0".to_string(),
                software_name: "openclaw-pnpm".to_string(),
                manifest_name: "OpenClaw Install (pnpm)".to_string(),
                manifest_path: "./manifests/openclaw-pnpm.hub.yaml".to_string(),
                manifest_source_input: "bundled-registry".to_string(),
                manifest_source_kind: "registry".to_string(),
                platform: SupportedPlatform::Windows,
                effective_runtime_platform: EffectiveRuntimePlatform::Windows,
                installer_home: installer_home.to_string_lossy().into_owned(),
                install_scope: InstallScope::User,
                install_root: profile_install_root.to_string_lossy().into_owned(),
                work_root: profile_work_root.to_string_lossy().into_owned(),
                bin_dir: profile_install_root
                    .join("bin")
                    .to_string_lossy()
                    .into_owned(),
                data_root: profile_data_root.to_string_lossy().into_owned(),
                install_control_level: InstallControlLevel::Partial,
                status: InstallRecordStatus::Installed,
                installed_at: Some("2026-03-23T00:00:00Z".to_string()),
                updated_at: "2026-03-23T00:00:00Z".to_string(),
            },
        )
        .expect("write pnpm install record");

        let instance = service
            .create_instance(
                &paths,
                &config,
                &storage,
                StudioCreateInstanceInput {
                    name: "Workspace Matched OpenClaw".to_string(),
                    description: Some("Workspace matched OpenClaw runtime".to_string()),
                    runtime_kind: StudioRuntimeKind::Openclaw,
                    deployment_mode: StudioInstanceDeploymentMode::LocalExternal,
                    transport_kind: StudioInstanceTransportKind::OpenclawGatewayWs,
                    icon_type: None,
                    version: Some("1.0.0".to_string()),
                    type_label: Some("OpenClaw External".to_string()),
                    host: Some("127.0.0.1".to_string()),
                    port: Some(28789),
                    base_url: Some("http://127.0.0.1:28789".to_string()),
                    websocket_url: Some("ws://127.0.0.1:28789".to_string()),
                    storage: None,
                    config: Some(super::PartialStudioInstanceConfig {
                        base_url: Some("http://127.0.0.1:28789".to_string()),
                        websocket_url: Some("ws://127.0.0.1:28789".to_string()),
                        port: Some("28789".to_string()),
                        workspace_path: Some(profile_work_root.to_string_lossy().into_owned()),
                        ..super::PartialStudioInstanceConfig::default()
                    }),
                },
            )
            .expect("create local external openclaw");

        let detail = service
            .get_instance_detail(&paths, &config, &storage, &instance.id)
            .expect("load instance detail")
            .expect("local external detail");
        let serialized = serde_json::to_value(&detail).expect("serialize detail");
        let console_access = serialized
            .get("consoleAccess")
            .and_then(Value::as_object)
            .expect("detail should include console access");

        assert_eq!(
            console_access.get("installMethod").and_then(Value::as_str),
            Some("pnpm")
        );
        assert_eq!(
            console_access.get("authSource").and_then(Value::as_str),
            Some("installRecord")
        );
    }

    #[test]
    fn local_external_openclaw_detail_reads_from_preferred_install_record_home() {
        let (root, paths, config, storage, service) = studio_context();
        let host_openclaw_root = paths.user_root.join(".openclaw");
        let preferred_installer_home = paths.user_root.join(OPENCLAW_INSTALL_RECORDS_HOME_NAME);
        let preferred_install_root = root.path().join("preferred-install");
        let preferred_work_root = root.path().join("preferred-work");
        let preferred_data_root = root.path().join("preferred-data");
        fs::create_dir_all(&host_openclaw_root).expect("create host openclaw root");
        fs::create_dir_all(&preferred_install_root).expect("create preferred install root");
        fs::create_dir_all(&preferred_work_root).expect("create preferred work root");
        fs::create_dir_all(&preferred_data_root).expect("create preferred data root");
        fs::write(
            host_openclaw_root.join("openclaw.json"),
            r#"{
  gateway: {
    port: 28789,
    auth: {
      mode: "token",
      token: "preferred-home-token",
    },
  },
}
"#,
        )
        .expect("write external config");
        write_install_record(
            preferred_installer_home.to_string_lossy().as_ref(),
            "openclaw-pnpm",
            &InstallRecord {
                schema_version: "1.0".to_string(),
                software_name: "openclaw-pnpm".to_string(),
                manifest_name: "OpenClaw Install (pnpm)".to_string(),
                manifest_path: "./manifests/openclaw-pnpm.hub.yaml".to_string(),
                manifest_source_input: "bundled-registry".to_string(),
                manifest_source_kind: "registry".to_string(),
                platform: SupportedPlatform::Windows,
                effective_runtime_platform: EffectiveRuntimePlatform::Windows,
                installer_home: preferred_installer_home.to_string_lossy().into_owned(),
                install_scope: InstallScope::User,
                install_root: preferred_install_root.to_string_lossy().into_owned(),
                work_root: preferred_work_root.to_string_lossy().into_owned(),
                bin_dir: preferred_install_root
                    .join("bin")
                    .to_string_lossy()
                    .into_owned(),
                data_root: preferred_data_root.to_string_lossy().into_owned(),
                install_control_level: InstallControlLevel::Partial,
                status: InstallRecordStatus::Installed,
                installed_at: Some("2026-03-23T00:00:00Z".to_string()),
                updated_at: "2026-03-23T00:00:00Z".to_string(),
            },
        )
        .expect("write preferred install record");

        let instance = service
            .create_instance(
                &paths,
                &config,
                &storage,
                StudioCreateInstanceInput {
                    name: "Preferred Home OpenClaw".to_string(),
                    description: Some("Preferred-home OpenClaw runtime".to_string()),
                    runtime_kind: StudioRuntimeKind::Openclaw,
                    deployment_mode: StudioInstanceDeploymentMode::LocalExternal,
                    transport_kind: StudioInstanceTransportKind::OpenclawGatewayWs,
                    icon_type: None,
                    version: Some("1.0.0".to_string()),
                    type_label: Some("OpenClaw External".to_string()),
                    host: Some("127.0.0.1".to_string()),
                    port: Some(28789),
                    base_url: Some("http://127.0.0.1:28789".to_string()),
                    websocket_url: Some("ws://127.0.0.1:28789".to_string()),
                    storage: None,
                    config: Some(super::PartialStudioInstanceConfig {
                        base_url: Some("http://127.0.0.1:28789".to_string()),
                        websocket_url: Some("ws://127.0.0.1:28789".to_string()),
                        port: Some("28789".to_string()),
                        ..super::PartialStudioInstanceConfig::default()
                    }),
                },
            )
            .expect("create local external openclaw");

        let detail = service
            .get_instance_detail(&paths, &config, &storage, &instance.id)
            .expect("load instance detail")
            .expect("local external detail");
        let serialized = serde_json::to_value(&detail).expect("serialize detail");
        let console_access = serialized
            .get("consoleAccess")
            .and_then(Value::as_object)
            .expect("detail should include console access");

        assert_eq!(
            console_access.get("installMethod").and_then(Value::as_str),
            Some("pnpm")
        );
        assert_eq!(
            console_access.get("authSource").and_then(Value::as_str),
            Some("installRecord")
        );
    }

    #[test]
    fn built_in_instance_detail_includes_openclaw_workbench_sections() {
        let (_root, paths, config, storage, service) = studio_context();
        fs::write(
            &openclaw_config_file_path(&paths),
            r#"{
  gateway: {
    port: 19876,
    auth: {
      mode: "token",
      token: "studio-token",
    },
    http: {
      endpoints: {
        chatCompletions: { enabled: true },
      },
    },
  },
  studio: {
    logLevel: "debug",
    corsOrigins: "http://localhost:3001",
    sandbox: true,
    autoUpdate: true,
  },
}
"#,
        )
        .expect("seed config file");

        let detail = service
            .get_instance_detail(&paths, &config, &storage, DEFAULT_INSTANCE_ID)
            .expect("load instance detail")
            .expect("built-in detail");
        let serialized = serde_json::to_value(&detail).expect("serialize detail");
        let workbench = serialized
            .get("workbench")
            .and_then(Value::as_object)
            .expect("detail should include workbench snapshot");

        for key in [
            "channels",
            "cronTasks",
            "llmProviders",
            "agents",
            "skills",
            "files",
            "memory",
            "tools",
        ] {
            assert!(
                workbench.contains_key(key),
                "expected workbench to include {key}"
            );
        }
    }

    #[test]
    fn desktop_openclaw_config_writer_sanitizes_retired_and_malformed_channel_config() {
        let (_root, paths, _config, _storage, _service) = studio_context();
        let root = json!({
            "channels": {
                "telegram": {
                    "botToken": "${TELEGRAM_BOT_TOKEN}",
                    "enabled": true
                },
                "qq": {
                    "appId": "legacy-app-id",
                    "clientSecret": "legacy-secret",
                    "enabled": true
                },
                "dingtalk": {
                    "enabled": true
                },
                "slack": ["xoxb-token"],
                "defaults": {
                    "model": "sdkwork-local-proxy/gpt-5.4"
                },
                "modelByChannel": {
                    "telegram": {
                        "*": "sdkwork-local-proxy/gpt-5.4",
                        "C123": 42
                    },
                    "slack": {
                        "C123": "sdkwork-local-proxy/gpt-5.4"
                    },
                    "qq": {
                        "*": "sdkwork-local-proxy/gpt-legacy"
                    },
                    "dingtalk": {
                        "*": "sdkwork-local-proxy/gpt-legacy"
                    }
                }
            }
        });

        write_openclaw_config_file(&paths, &root).expect("write config file");

        let written =
            read_json5_object(&openclaw_config_file_path(&paths)).expect("read written config");
        let channels = written
            .get("channels")
            .and_then(Value::as_object)
            .expect("channels object");

        assert!(channels.contains_key("telegram"));
        assert!(channels.contains_key("qqbot"));
        assert!(channels.contains_key("defaults"));
        assert!(!channels.contains_key("qq"));
        assert!(!channels.contains_key("dingtalk"));
        assert!(!channels.contains_key("slack"));
        assert_eq!(
            channels
                .get("modelByChannel")
                .and_then(Value::as_object)
                .expect("modelByChannel object")
                .keys()
                .cloned()
                .collect::<Vec<_>>(),
            vec![
                "qqbot".to_string(),
                "slack".to_string(),
                "telegram".to_string()
            ]
        );
        assert_eq!(
            channels
                .get("modelByChannel")
                .and_then(Value::as_object)
                .and_then(|model_by_channel| model_by_channel.get("telegram"))
                .and_then(Value::as_object)
                .expect("telegram model overrides")
                .keys()
                .cloned()
                .collect::<Vec<_>>(),
            vec!["*".to_string()]
        );
    }

    #[test]
    fn desktop_openclaw_config_writer_uses_active_runtime_channel_metadata() {
        let (_root, paths, _config, _storage, _service) = studio_context();
        let install_key = "2026.5.6-windows-x64";
        write_openclaw_manifest(&paths, install_key, "2026.5.6");
        write_openclaw_channel_metadata(&paths, install_key, "matrix");
        crate::framework::layout::set_active_runtime_version(&paths, "openclaw", install_key)
            .expect("record active runtime install key");
        let root = json!({
            "channels": {
                "telegram": {
                    "botToken": "${TELEGRAM_BOT_TOKEN}",
                    "enabled": true
                },
                "matrix": {
                    "homeserver": "https://matrix.example",
                    "userId": "@openclaw:matrix.example",
                    "accessToken": "${MATRIX_ACCESS_TOKEN}",
                    "enabled": true
                },
                "modelByChannel": {
                    "telegram": {
                        "*": "sdkwork-local-proxy/gpt-legacy"
                    },
                    "matrix": {
                        "*": "sdkwork-local-proxy/gpt-5.4"
                    }
                }
            }
        });

        write_openclaw_config_file(&paths, &root).expect("write config file");

        let written =
            read_json5_object(&openclaw_config_file_path(&paths)).expect("read written config");
        let channels = written
            .get("channels")
            .and_then(Value::as_object)
            .expect("channels object");

        assert!(channels.contains_key("matrix"));
        assert!(!channels.contains_key("telegram"));
        assert_eq!(
            channels
                .get("modelByChannel")
                .and_then(Value::as_object)
                .expect("modelByChannel object")
                .keys()
                .cloned()
                .collect::<Vec<_>>(),
            vec!["matrix".to_string()]
        );
    }

    #[test]
    fn updating_built_in_openclaw_provider_writes_canonical_defaults_model_params() {
        let (_root, paths, config, storage, service) = studio_context();
        fs::write(
            &openclaw_config_file_path(&paths),
            r#"{
  models: {
    providers: {
      openai: {
        baseUrl: "https://old.example.com/v1",
        apiKey: "${OLD_KEY}",
        temperature: 0.2,
        topP: 1,
        maxTokens: 4096,
        timeoutMs: 60000,
        streaming: true,
        models: [
          { id: "old-default", name: "old-default", role: "primary" },
          { id: "old-embedding", name: "old-embedding", role: "embedding" },
        ],
      },
    },
  },
  agents: {
    defaults: {
      model: {
        primary: "openai/old-default",
      },
      models: {
        "openai/old-default": {
          alias: "old-default",
          params: {
            temperature: 0.2,
            topP: 1,
            maxTokens: 4096,
            timeoutMs: 60000,
            streaming: true,
          },
        },
      },
    },
  },
}"#,
        )
        .expect("seed config file");

        service
            .update_instance_llm_provider_config(
                &paths,
                &config,
                &storage,
                DEFAULT_INSTANCE_ID,
                "openai",
                StudioUpdateInstanceLlmProviderConfigInput {
                    endpoint: "https://api.openai.com/v1".to_string(),
                    api_key_source: "${OPENAI_API_KEY}".to_string(),
                    default_model_id: "gpt-5.4".to_string(),
                    reasoning_model_id: Some("o4-mini".to_string()),
                    embedding_model_id: Some("text-embedding-3-large".to_string()),
                    config: StudioWorkbenchLLMProviderConfigRecord {
                        temperature: 0.3,
                        top_p: 0.95,
                        max_tokens: 12000,
                        timeout_ms: 120000,
                        streaming: true,
                    },
                },
            )
            .expect("update managed provider");

        let root = read_json5_object(&openclaw_config_file_path(&paths)).expect("read config file");
        let provider = get_nested_value(&root, &["models", "providers", "openai"])
            .and_then(Value::as_object)
            .expect("provider config");

        assert!(!provider.contains_key("temperature"));
        assert!(!provider.contains_key("topP"));
        assert!(!provider.contains_key("maxTokens"));
        assert!(!provider.contains_key("timeoutMs"));
        assert!(!provider.contains_key("streaming"));
        assert_eq!(
            get_nested_string(&root, &["agents", "defaults", "model", "primary"]).as_deref(),
            Some("openai/gpt-5.4")
        );
        assert_eq!(
            get_nested_value(&root, &["agents", "defaults", "model", "fallbacks"])
                .and_then(Value::as_array)
                .cloned(),
            Some(vec![Value::String("openai/o4-mini".to_string())])
        );

        let params = get_nested_value(
            &root,
            &["agents", "defaults", "models", "openai/gpt-5.4", "params"],
        )
        .and_then(Value::as_object)
        .expect("default model params");
        assert_eq!(params.get("temperature").and_then(Value::as_f64), Some(0.3));
        assert_eq!(params.get("topP").and_then(Value::as_f64), Some(0.95));
        assert_eq!(params.get("maxTokens").and_then(Value::as_u64), Some(12000));
        assert_eq!(
            params.get("timeoutMs").and_then(Value::as_u64),
            Some(120000)
        );
        assert_eq!(params.get("streaming").and_then(Value::as_bool), Some(true));
        assert!(
            get_nested_value(&root, &["agents", "defaults", "models", "openai/o4-mini"]).is_some()
        );
        assert!(get_nested_value(
            &root,
            &[
                "agents",
                "defaults",
                "models",
                "openai/text-embedding-3-large"
            ]
        )
        .is_some());
    }

    #[test]
    fn update_instance_llm_provider_config_preserves_provider_qualified_openrouter_model_refs() {
        let (_root, paths, config, storage, service) = studio_context();
        fs::write(
            &openclaw_config_file_path(&paths),
            r#"{
  gateway: {
    port: 19876,
    auth: {
      mode: "token",
      token: "studio-token",
    },
  },
}"#,
        )
        .expect("seed config file");

        service
            .update_instance_llm_provider_config(
                &paths,
                &config,
                &storage,
                DEFAULT_INSTANCE_ID,
                "openrouter",
                StudioUpdateInstanceLlmProviderConfigInput {
                    endpoint: "https://openrouter.ai/api/v1".to_string(),
                    api_key_source: "${OPENROUTER_API_KEY}".to_string(),
                    default_model_id: "openrouter/meta-llama/llama-3.1-8b-instruct".to_string(),
                    reasoning_model_id: Some("anthropic/claude-3.7-sonnet".to_string()),
                    embedding_model_id: None,
                    config: StudioWorkbenchLLMProviderConfigRecord {
                        temperature: 0.2,
                        top_p: 1.0,
                        max_tokens: 8192,
                        timeout_ms: 60_000,
                        streaming: true,
                    },
                },
            )
            .expect("update openrouter provider");

        let root = read_json5_object(&openclaw_config_file_path(&paths)).expect("read config file");
        assert_eq!(
            get_nested_string(&root, &["agents", "defaults", "model", "primary"]).as_deref(),
            Some("openrouter/meta-llama/llama-3.1-8b-instruct")
        );
        assert_eq!(
            get_nested_value(&root, &["agents", "defaults", "model", "fallbacks"])
                .and_then(Value::as_array)
                .cloned(),
            Some(vec![Value::String(
                "anthropic/claude-3.7-sonnet".to_string()
            )])
        );
        assert!(get_nested_value(
            &root,
            &[
                "agents",
                "defaults",
                "models",
                "openrouter/meta-llama/llama-3.1-8b-instruct"
            ]
        )
        .is_some());
        assert!(get_nested_value(
            &root,
            &[
                "agents",
                "defaults",
                "models",
                "anthropic/claude-3.7-sonnet"
            ]
        )
        .is_some());
        assert!(get_nested_value(
            &root,
            &[
                "agents",
                "defaults",
                "models",
                "openrouter/openrouter/meta-llama/llama-3.1-8b-instruct"
            ]
        )
        .is_none());
        assert!(get_nested_value(
            &root,
            &[
                "agents",
                "defaults",
                "models",
                "openrouter/anthropic/claude-3.7-sonnet"
            ]
        )
        .is_none());
    }

    #[test]
    fn kernel_agent_creation_capability_reports_supported_openclaw_models_for_the_built_in_instance(
    ) {
        let (_root, paths, config, storage, service) = studio_context();
        fs::write(
            &openclaw_config_file_path(&paths),
            r#"{
  models: {
    providers: {
      openai: {
        baseUrl: "https://api.openai.com/v1",
        models: [
          { id: "gpt-5.4", name: "GPT-5.4" },
          { id: "o4-mini", name: "o4-mini", role: "reasoning" },
        ],
      },
      openrouter: {
        baseUrl: "https://openrouter.ai/api/v1",
        models: [
          {
            id: "openrouter/meta-llama/llama-3.1-8b-instruct",
            name: "Llama 3.1 8B Instruct",
          },
        ],
      },
    },
  },
}"#,
        )
        .expect("seed config file");

        let capability = service
            .get_kernel_agent_creation_capability(&paths, &config, &storage, DEFAULT_INSTANCE_ID)
            .expect("get kernel agent creation capability");

        assert_eq!(capability.instance_id, DEFAULT_INSTANCE_ID);
        assert_eq!(capability.default_kernel_id.as_deref(), Some("openclaw"));
        assert_eq!(capability.kernel_options.len(), 1);
        assert_eq!(capability.kernel_options[0].kernel_id, "openclaw");
        assert!(capability.kernel_options[0].supported);
        assert_eq!(capability.kernel_options[0].reason_code, None);
        assert_eq!(
            capability.kernel_options[0].field_support,
            StudioKernelAgentCreationFieldSupport {
                avatar: true,
                is_default: true,
                primary_model: true,
                fallback_models: true,
                workspace: false,
                agent_dir: false,
                temperature: true,
                top_p: true,
                max_tokens: true,
                timeout_ms: true,
                streaming: true,
            }
        );
        assert!(capability.kernel_options[0]
            .model_options
            .iter()
            .any(|option| option.value == "openai/gpt-5.4"
                && option.provider_id == "openai"
                && option.provider_label == "Openai"));
        assert!(capability.kernel_options[0]
            .model_options
            .iter()
            .any(
                |option| option.value == "openrouter/meta-llama/llama-3.1-8b-instruct"
                    && option.provider_id == "openrouter"
            ));
    }

    #[test]
    fn kernel_agent_creation_capability_marks_managed_hermes_as_supported_for_profile_creation() {
        let (_root, paths, config, storage, service) = studio_context();
        let hermes = service
            .create_instance(
                &paths,
                &config,
                &storage,
                StudioCreateInstanceInput {
                    name: "Hermes Local Managed".to_string(),
                    description: Some("Managed local Hermes runtime".to_string()),
                    runtime_kind: StudioRuntimeKind::Hermes,
                    deployment_mode: StudioInstanceDeploymentMode::LocalManaged,
                    transport_kind: StudioInstanceTransportKind::CustomHttp,
                    icon_type: None,
                    version: Some("0.1.0".to_string()),
                    type_label: Some("Hermes Agent".to_string()),
                    host: Some("127.0.0.1".to_string()),
                    port: Some(19540),
                    base_url: Some("http://127.0.0.1:19540".to_string()),
                    websocket_url: None,
                    storage: None,
                    config: Some(PartialStudioInstanceConfig {
                        port: Some("19540".to_string()),
                        base_url: Some("http://127.0.0.1:19540".to_string()),
                        ..Default::default()
                    }),
                },
            )
            .expect("create hermes instance");

        let capability = service
            .get_kernel_agent_creation_capability(&paths, &config, &storage, &hermes.id)
            .expect("get hermes kernel agent creation capability");

        assert_eq!(capability.default_kernel_id.as_deref(), Some("hermes"));
        assert_eq!(capability.kernel_options.len(), 1);
        assert_eq!(capability.kernel_options[0].kernel_id, "hermes");
        assert!(capability.kernel_options[0].supported);
        assert_eq!(capability.kernel_options[0].reason_code, None);
        assert_eq!(capability.kernel_options[0].reason, None);
        assert!(capability.kernel_options[0].model_options.is_empty());
        assert_eq!(
            capability.kernel_options[0].field_support,
            StudioKernelAgentCreationFieldSupport {
                avatar: true,
                is_default: false,
                primary_model: false,
                fallback_models: false,
                workspace: false,
                agent_dir: false,
                temperature: false,
                top_p: false,
                max_tokens: false,
                timeout_ms: false,
                streaming: false,
            }
        );
    }

    #[test]
    fn create_kernel_agent_persists_managed_hermes_agent_profile_catalog() {
        let (_root, paths, config, storage, service) = studio_context();
        let hermes = service
            .create_instance(
                &paths,
                &config,
                &storage,
                StudioCreateInstanceInput {
                    name: "Hermes Local Managed".to_string(),
                    description: Some("Managed local Hermes runtime".to_string()),
                    runtime_kind: StudioRuntimeKind::Hermes,
                    deployment_mode: StudioInstanceDeploymentMode::LocalManaged,
                    transport_kind: StudioInstanceTransportKind::CustomHttp,
                    icon_type: None,
                    version: Some("0.1.0".to_string()),
                    type_label: Some("Hermes Agent".to_string()),
                    host: Some("127.0.0.1".to_string()),
                    port: Some(19540),
                    base_url: Some("http://127.0.0.1:19540".to_string()),
                    websocket_url: None,
                    storage: None,
                    config: Some(PartialStudioInstanceConfig {
                        port: Some("19540".to_string()),
                        base_url: Some("http://127.0.0.1:19540".to_string()),
                        ..Default::default()
                    }),
                },
            )
            .expect("create hermes instance");

        let created = service
            .create_kernel_agent(
                &paths,
                &config,
                &storage,
                StudioCreateKernelAgentInput {
                    instance_id: hermes.id.clone(),
                    kernel_id: Some("hermes".to_string()),
                    agent_id: "Research Planner".to_string(),
                    display_name: "Research Planner".to_string(),
                    avatar: Some("RP".to_string()),
                    ..Default::default()
                },
            )
            .expect("create hermes kernel agent");

        let profiles = service
            .list_kernel_chat_agent_profiles(&paths, &config, &storage, &hermes.id)
            .expect("list hermes kernel chat agent profiles");

        assert_eq!(created.instance_id, hermes.id);
        assert_eq!(created.kernel_id, "hermes");
        assert_eq!(created.agent_id, "research-planner");
        assert_eq!(created.display_name, "Research Planner");
        assert_eq!(profiles.len(), 1);
        assert_eq!(profiles[0].instance_id, hermes.id);
        assert_eq!(profiles[0].kernel_id, "hermes");
        assert_eq!(profiles[0].agent_id, "research-planner");
        assert_eq!(profiles[0].label, "Research Planner");
        assert_eq!(profiles[0].source, "kernelCatalog");
        assert_eq!(profiles[0].avatar.as_deref(), Some("RP"));
    }

    #[test]
    fn create_kernel_agent_rejects_managed_hermes_fields_outside_declared_contract() {
        let (_root, paths, config, storage, service) = studio_context();
        let hermes = service
            .create_instance(
                &paths,
                &config,
                &storage,
                StudioCreateInstanceInput {
                    name: "Hermes Local Managed".to_string(),
                    description: Some("Managed local Hermes runtime".to_string()),
                    runtime_kind: StudioRuntimeKind::Hermes,
                    deployment_mode: StudioInstanceDeploymentMode::LocalManaged,
                    transport_kind: StudioInstanceTransportKind::CustomHttp,
                    icon_type: None,
                    version: Some("0.1.0".to_string()),
                    type_label: Some("Hermes Agent".to_string()),
                    host: Some("127.0.0.1".to_string()),
                    port: Some(19540),
                    base_url: Some("http://127.0.0.1:19540".to_string()),
                    websocket_url: None,
                    storage: None,
                    config: Some(PartialStudioInstanceConfig {
                        port: Some("19540".to_string()),
                        base_url: Some("http://127.0.0.1:19540".to_string()),
                        ..Default::default()
                    }),
                },
            )
            .expect("create hermes instance");

        let error = service
            .create_kernel_agent(
                &paths,
                &config,
                &storage,
                StudioCreateKernelAgentInput {
                    instance_id: hermes.id.clone(),
                    kernel_id: Some("hermes".to_string()),
                    agent_id: "Research Planner".to_string(),
                    display_name: "Research Planner".to_string(),
                    avatar: Some("RP".to_string()),
                    is_default: true,
                    primary_model: Some("hermes/research".to_string()),
                    workspace: Some("workspace/research".to_string()),
                    ..Default::default()
                },
            )
            .expect_err("managed hermes should reject unsupported creation fields");

        let message = error.to_string();
        assert!(
            message.contains("isDefault")
                || message.contains("primaryModel")
                || message.contains("workspace")
        );
    }

    #[test]
    fn create_kernel_agent_persists_openclaw_agent_configuration() {
        let (_root, paths, config, storage, service) = studio_context();
        fs::write(
            &openclaw_config_file_path(&paths),
            r#"{
  models: {
    providers: {
      openai: {
        baseUrl: "https://api.openai.com/v1",
        models: [
          { id: "gpt-5.4", name: "GPT-5.4" },
          { id: "o4-mini", name: "o4-mini", role: "reasoning" },
        ],
      },
    },
  },
  agents: {
    list: [
      {
        id: "main",
        name: "Main",
        default: true,
      },
    ],
  },
}"#,
        )
        .expect("seed config file");

        let created = service
            .create_kernel_agent(
                &paths,
                &config,
                &storage,
                StudioCreateKernelAgentInput {
                    instance_id: DEFAULT_INSTANCE_ID.to_string(),
                    kernel_id: Some("openclaw".to_string()),
                    agent_id: "Reviewer Agent".to_string(),
                    display_name: "Reviewer".to_string(),
                    avatar: Some("R".to_string()),
                    is_default: true,
                    primary_model: Some("openai/gpt-5.4".to_string()),
                    fallback_models: vec!["openai/o4-mini".to_string()],
                    workspace: None,
                    agent_dir: None,
                    temperature: Some(0.3),
                    top_p: Some(0.95),
                    max_tokens: Some(12000),
                    timeout_ms: Some(120000),
                    streaming: Some(true),
                },
            )
            .expect("create kernel agent");

        assert_eq!(created.instance_id, DEFAULT_INSTANCE_ID);
        assert_eq!(created.kernel_id, "openclaw");
        assert_eq!(created.agent_id, "reviewer-agent");
        assert_eq!(created.display_name, "Reviewer");

        let root = read_json5_object(&openclaw_config_file_path(&paths)).expect("read config file");
        let agents = get_nested_value(&root, &["agents", "list"])
            .and_then(Value::as_array)
            .expect("agent list");
        let reviewer = agents
            .iter()
            .find(|entry| get_nested_string(entry, &["id"]).as_deref() == Some("reviewer-agent"))
            .expect("reviewer agent entry");

        assert_eq!(
            get_nested_string(reviewer, &["name"]).as_deref(),
            Some("Reviewer")
        );
        assert_eq!(
            get_nested_string(reviewer, &["identity", "emoji"]).as_deref(),
            Some("R")
        );
        assert_eq!(
            get_nested_string(reviewer, &["model", "primary"]).as_deref(),
            Some("openai/gpt-5.4")
        );
        assert_eq!(
            get_nested_value(reviewer, &["model", "fallbacks"])
                .and_then(Value::as_array)
                .cloned(),
            Some(vec![Value::String("openai/o4-mini".to_string())])
        );
        let reviewer_workspace = paths
            .kernel_paths("openclaw")
            .expect("openclaw kernel paths")
            .openclaw_agent_workspace_dir("reviewer-agent")
            .expect("reviewer workspace")
            .to_string_lossy()
            .into_owned();
        let reviewer_agent_dir = paths
            .kernel_paths("openclaw")
            .expect("openclaw kernel paths")
            .openclaw_agent_dir("reviewer-agent")
            .expect("reviewer agent dir")
            .to_string_lossy()
            .into_owned();
        assert_eq!(
            get_nested_string(reviewer, &["workspace"]).as_deref(),
            Some(reviewer_workspace.as_str())
        );
        assert_eq!(
            get_nested_string(reviewer, &["agentDir"]).as_deref(),
            Some(reviewer_agent_dir.as_str())
        );
        assert_eq!(
            get_nested_value(reviewer, &["params", "temperature"]).and_then(Value::as_f64),
            Some(0.3)
        );
        assert_eq!(
            get_nested_value(reviewer, &["params", "topP"]).and_then(Value::as_f64),
            Some(0.95)
        );
        assert_eq!(
            get_nested_value(reviewer, &["params", "maxTokens"]).and_then(Value::as_u64),
            Some(12000)
        );
        assert_eq!(
            get_nested_value(reviewer, &["params", "timeoutMs"]).and_then(Value::as_u64),
            Some(120000)
        );
        assert_eq!(
            get_nested_value(reviewer, &["params", "streaming"]).and_then(Value::as_bool),
            Some(true)
        );

        let default_agent_ids = agents
            .iter()
            .filter(|entry| {
                get_nested_value(entry, &["default"])
                    .and_then(Value::as_bool)
                    .unwrap_or(false)
            })
            .filter_map(|entry| get_nested_string(entry, &["id"]))
            .collect::<Vec<_>>();
        assert_eq!(default_agent_ids, vec!["reviewer-agent".to_string()]);
    }

    #[test]
    fn create_kernel_agent_keeps_main_as_default_when_config_has_no_agent_list() {
        let (_root, paths, config, storage, service) = studio_context();
        fs::write(&openclaw_config_file_path(&paths), "{}").expect("seed empty config file");

        let created = service
            .create_kernel_agent(
                &paths,
                &config,
                &storage,
                StudioCreateKernelAgentInput {
                    instance_id: DEFAULT_INSTANCE_ID.to_string(),
                    kernel_id: Some("openclaw".to_string()),
                    agent_id: "Research Analyst".to_string(),
                    display_name: "Research Analyst".to_string(),
                    avatar: Some("RA".to_string()),
                    is_default: false,
                    ..Default::default()
                },
            )
            .expect("create kernel agent");

        assert_eq!(created.agent_id, "research-analyst");

        let root = read_json5_object(&openclaw_config_file_path(&paths)).expect("read config file");
        let agents = get_nested_value(&root, &["agents", "list"])
            .and_then(Value::as_array)
            .expect("agent list");
        let main = agents
            .iter()
            .find(|entry| get_nested_string(entry, &["id"]).as_deref() == Some("main"))
            .expect("main agent entry");
        let created_agent = agents
            .iter()
            .find(|entry| get_nested_string(entry, &["id"]).as_deref() == Some("research-analyst"))
            .expect("created agent entry");

        assert_eq!(
            get_nested_value(main, &["default"]).and_then(Value::as_bool),
            Some(true)
        );
        assert_eq!(
            get_nested_string(main, &["workspace"]).as_deref(),
            Some(paths.openclaw_workspace_dir.to_string_lossy().as_ref())
        );
        assert_eq!(
            get_nested_string(main, &["agentDir"]).as_deref(),
            Some(paths.openclaw_main_agent_dir.to_string_lossy().as_ref())
        );
        assert_eq!(
            get_nested_value(created_agent, &["default"]).and_then(Value::as_bool),
            Some(false)
        );
    }

    #[test]
    fn built_in_instance_detail_includes_skills_from_configured_extra_dirs() {
        let (root, paths, config, storage, service) = studio_context();
        let extra_skills_dir = root.path().join("extra-skills");
        let skill_dir = extra_skills_dir.join("diagnostics-helper");
        fs::create_dir_all(&skill_dir).expect("create extra skill dir");
        fs::write(
            skill_dir.join("SKILL.md"),
            r#"---
name: diagnostics-helper
description: Inspects runtime diagnostics.
---

# Diagnostics Helper

Reads runtime diagnostics and summarizes them.
"#,
        )
        .expect("write extra skill");

        let extra_skills_path = extra_skills_dir.to_string_lossy().replace('\\', "\\\\");
        fs::write(
            &openclaw_config_file_path(&paths),
            format!(
                r#"{{
  gateway: {{
    port: 19876,
    auth: {{
      mode: "token",
      token: "studio-token",
    }},
    http: {{
      endpoints: {{
        chatCompletions: {{ enabled: true }},
      }},
    }},
  }},
  skills: {{
    load: {{
      extraDirs: ["{}"],
    }},
  }},
}}
"#,
                extra_skills_path
            ),
        )
        .expect("seed config file");

        let detail = service
            .get_instance_detail(&paths, &config, &storage, DEFAULT_INSTANCE_ID)
            .expect("load instance detail")
            .expect("built-in detail");
        let workbench = detail.workbench.expect("detail workbench");

        assert!(workbench
            .skills
            .iter()
            .any(|skill| skill.id == "diagnostics-helper"));
    }

    #[test]
    fn built_in_openclaw_allows_writing_bootstrap_files_in_configured_agent_workspaces() {
        let (root, paths, config, storage, service) = studio_context();
        let reviewer_workspace = root.path().join("reviewer-workspace");
        fs::create_dir_all(&reviewer_workspace).expect("create reviewer workspace");

        let reviewer_agents_file = reviewer_workspace.join("AGENTS.md");
        fs::write(&reviewer_agents_file, "# reviewer\n").expect("seed reviewer bootstrap");

        let reviewer_workspace_path = reviewer_workspace.to_string_lossy().replace('\\', "\\\\");
        fs::write(
            &openclaw_config_file_path(&paths),
            format!(
                r#"{{
  gateway: {{
    port: 19876,
    auth: {{
      mode: "token",
      token: "studio-token",
    }},
  }},
  agents: {{
    list: [
      {{
        id: "main",
        default: true,
      }},
      {{
        id: "reviewer",
        name: "Reviewer",
        workspace: "{}",
      }},
    ],
  }},
}}
"#,
                reviewer_workspace_path
            ),
        )
        .expect("seed config file");

        let detail = service
            .get_instance_detail(&paths, &config, &storage, DEFAULT_INSTANCE_ID)
            .expect("load instance detail")
            .expect("built-in detail");
        let workbench = detail.workbench.expect("detail workbench");
        let reviewer_agents_path = reviewer_agents_file.to_string_lossy().into_owned();
        let reviewer_file = workbench
            .files
            .iter()
            .find(|file| file.path == reviewer_agents_path)
            .expect("reviewer workspace file");

        assert!(
            !reviewer_file.is_readonly,
            "configured agent workspace bootstrap files should be writable"
        );

        service
            .update_instance_file_content(
                &paths,
                &config,
                &storage,
                DEFAULT_INSTANCE_ID,
                &reviewer_agents_path,
                "# reviewer updated\n",
            )
            .expect("update reviewer workspace bootstrap");

        assert_eq!(
            fs::read_to_string(&reviewer_agents_file).expect("read updated bootstrap"),
            "# reviewer updated\n"
        );
    }

    #[test]
    fn built_in_openclaw_task_controls_delegate_to_the_runtime_bridge() {
        let (_root, paths, config, storage, service) = studio_context();
        let (supervisor, server) = configured_openclaw_supervisor(&paths);

        fs::create_dir_all(paths.openclaw_root_dir.join("cron").join("runs"))
            .expect("cron run dir");
        fs::write(
            paths.openclaw_root_dir.join("cron").join("jobs.json"),
            r#"{
  "version": 1,
  "jobs": [
    {
      "id": "job-1",
      "name": "Nightly Review",
      "description": "Summarize overnight updates.",
      "enabled": true,
      "deleteAfterRun": false,
      "agentId": "main",
      "sessionKey": "agent:main:cron:job-1",
      "schedule": {
        "kind": "cron",
        "expr": "0 7 * * *",
        "tz": "Asia/Shanghai",
        "staggerMs": 0
      },
      "sessionTarget": "isolated",
      "wakeMode": "now",
      "payload": {
        "kind": "agentTurn",
        "message": "Summarize overnight updates.",
        "model": "openai/gpt-5.4",
        "fallbacks": ["openai/gpt-5.3"],
        "thinking": "medium",
        "timeoutSeconds": 600,
        "lightContext": true
      },
      "delivery": {
        "mode": "announce",
        "channel": "telegram",
        "to": "123456",
        "accountId": "bot-default",
        "bestEffort": true
      },
      "failureAlert": false,
      "createdAtMs": 100,
      "updatedAtMs": 101,
      "state": {
        "nextRunAtMs": 200
      }
    }
  ]
}"#,
        )
        .expect("jobs store");
        fs::write(
            paths
                .openclaw_root_dir
                .join("cron")
                .join("runs")
                .join("job-1.jsonl"),
            r#"{"action":"finished","status":"ok","runAtMs":1700000000000,"ts":1700000005000,"summary":"Completed review."}
"#,
        )
        .expect("run log");

        service
            .create_instance_task(
                &paths,
                &config,
                &storage,
                &supervisor,
                DEFAULT_INSTANCE_ID,
                &serde_json::json!({
                    "name": "Morning brief",
                    "description": "Summarize overnight updates.",
                    "enabled": true,
                    "schedule": {
                        "kind": "cron",
                        "expr": "0 7 * * *"
                    },
                    "sessionTarget": "isolated",
                    "wakeMode": "now",
                    "payload": {
                        "kind": "agentTurn",
                        "message": "Summarize overnight updates.",
                        "timeoutSeconds": 600
                    },
                    "delivery": {
                        "mode": "announce",
                        "channel": "telegram",
                        "to": "channel:daily-brief"
                    }
                }),
            )
            .expect("create task");
        service
            .update_instance_task(
                &paths,
                &config,
                &storage,
                &supervisor,
                DEFAULT_INSTANCE_ID,
                "job-1",
                &serde_json::json!({
                    "name": "Nightly Review Updated",
                    "enabled": false,
                    "payload": {
                        "kind": "agentTurn",
                        "message": "Summarize the last 12 hours."
                    }
                }),
            )
            .expect("update task");
        service
            .clone_instance_task(
                &paths,
                &config,
                &storage,
                &supervisor,
                DEFAULT_INSTANCE_ID,
                "job-1",
                Some("Nightly Review Copy"),
            )
            .expect("clone task");
        let queued = service
            .run_instance_task_now(
                &paths,
                &config,
                &storage,
                &supervisor,
                DEFAULT_INSTANCE_ID,
                "job-1",
            )
            .expect("queue run");
        let executions = service
            .list_instance_task_executions(&paths, &config, &storage, DEFAULT_INSTANCE_ID, "job-1")
            .expect("list executions");
        service
            .update_instance_task_status(
                &paths,
                &config,
                &storage,
                &supervisor,
                DEFAULT_INSTANCE_ID,
                "job-1",
                "paused",
            )
            .expect("pause task");
        let deleted = service
            .delete_instance_task(
                &paths,
                &config,
                &storage,
                &supervisor,
                DEFAULT_INSTANCE_ID,
                "job-1",
            )
            .expect("delete task");

        let captures = read_gateway_call_captures(&server);
        assert_eq!(captures.len(), 6);
        assert_eq!(
            captures[0].get("method").and_then(Value::as_str),
            Some("cron.add")
        );
        assert_eq!(
            captures[1].get("method").and_then(Value::as_str),
            Some("cron.update")
        );
        assert_eq!(
            captures[2].get("method").and_then(Value::as_str),
            Some("cron.add")
        );
        assert_eq!(
            captures[3].get("method").and_then(Value::as_str),
            Some("cron.run")
        );
        assert_eq!(
            captures[4].get("method").and_then(Value::as_str),
            Some("cron.update")
        );
        assert_eq!(
            captures[5].get("method").and_then(Value::as_str),
            Some("cron.remove")
        );
        assert_eq!(queued.details.as_deref(), Some("runId=run-123"));
        assert_eq!(executions.len(), 1);
        assert_eq!(executions[0].summary, "Completed review.");
        assert!(deleted);
    }

    #[test]
    fn managed_openclaw_gateway_invoke_uses_the_real_runtime_bridge_for_non_dry_run_requests() {
        let (_root, paths, config, storage, service) = studio_context();
        let (supervisor, server) = configured_openclaw_supervisor(&paths);

        let response = service
            .invoke_managed_openclaw_gateway(
                &paths,
                &config,
                &storage,
                &supervisor,
                OpenClawGatewayInvokeRequest {
                    tool: "gateway".to_string(),
                    action: Some("describe".to_string()),
                    args: Some(json!({
                        "scope": "full",
                    })),
                    session_key: Some("session-1".to_string()),
                    dry_run: Some(false),
                    message_channel: Some("telegram".to_string()),
                    account_id: Some("bot-default".to_string()),
                    headers: Some(BTreeMap::from([(
                        "x-test-header".to_string(),
                        "hello".to_string(),
                    )])),
                },
            )
            .expect("hosted manage invoke should reuse the runtime bridge");

        assert_eq!(
            response,
            json!({
                "ok": true,
                "method": "gateway.describe",
                "params": {
                    "scope": "full",
                },
            })
        );

        let captures = read_gateway_call_captures(&server);
        assert_eq!(captures.len(), 1);
        assert_eq!(
            captures[0].get("method").and_then(Value::as_str),
            Some("gateway.describe")
        );
        assert_eq!(
            captures[0]
                .pointer("/request/sessionKey")
                .and_then(Value::as_str),
            Some("session-1")
        );
        assert_eq!(
            captures[0]
                .pointer("/request/dryRun")
                .and_then(Value::as_bool),
            Some(false)
        );
        assert_eq!(
            captures[0]
                .pointer("/headers/authorization")
                .and_then(Value::as_str),
            Some("Bearer test-token")
        );
        assert_eq!(
            captures[0]
                .pointer("/headers/x-openclaw-message-channel")
                .and_then(Value::as_str),
            Some("telegram")
        );
        assert_eq!(
            captures[0]
                .pointer("/headers/x-openclaw-account-id")
                .and_then(Value::as_str),
            Some("bot-default")
        );
        assert_eq!(
            captures[0]
                .pointer("/headers/x-test-header")
                .and_then(Value::as_str),
            Some("hello")
        );
    }

    #[test]
    fn remote_instances_reject_runtime_backed_openclaw_task_controls() {
        let (_root, paths, config, storage, service) = studio_context();
        let (supervisor, _server) = configured_openclaw_supervisor(&paths);
        let remote = service
            .create_instance(
                &paths,
                &config,
                &storage,
                StudioCreateInstanceInput {
                    name: "Zero Remote".to_string(),
                    description: Some("Remote ZeroClaw".to_string()),
                    runtime_kind: StudioRuntimeKind::Zeroclaw,
                    deployment_mode: StudioInstanceDeploymentMode::Remote,
                    transport_kind: StudioInstanceTransportKind::ZeroclawHttp,
                    icon_type: None,
                    version: Some("0.9.0".to_string()),
                    type_label: Some("Remote ZeroClaw".to_string()),
                    host: Some("zeroclaw.example.com".to_string()),
                    port: Some(8443),
                    base_url: Some("https://zeroclaw.example.com".to_string()),
                    websocket_url: Some("wss://zeroclaw.example.com/ws".to_string()),
                    storage: None,
                    config: None,
                },
            )
            .expect("create remote instance");

        let error = service
            .clone_instance_task(
                &paths,
                &config,
                &storage,
                &supervisor,
                &remote.id,
                "job-1",
                None,
            )
            .expect_err("remote runtime should be rejected");

        assert!(error.to_string().contains("built-in OpenClaw instance"));
    }

    #[test]
    fn remote_openclaw_instance_detail_does_not_reuse_built_in_local_workbench() {
        let (_root, paths, config, storage, service) = studio_context();
        fs::write(
            &openclaw_config_file_path(&paths),
            r#"{
  gateway: {
    port: 19876,
    auth: {
      mode: "token",
      token: "studio-token",
    },
  },
}
"#,
        )
        .expect("seed config file");

        let remote = service
            .create_instance(
                &paths,
                &config,
                &storage,
                StudioCreateInstanceInput {
                    name: "OpenClaw Remote".to_string(),
                    description: Some("Remote OpenClaw gateway".to_string()),
                    runtime_kind: StudioRuntimeKind::Openclaw,
                    deployment_mode: StudioInstanceDeploymentMode::Remote,
                    transport_kind: StudioInstanceTransportKind::OpenclawGatewayWs,
                    icon_type: None,
                    version: Some("2026.3.23-2".to_string()),
                    type_label: Some("Remote OpenClaw".to_string()),
                    host: Some("openclaw.example.com".to_string()),
                    port: Some(21280),
                    base_url: Some("https://openclaw.example.com".to_string()),
                    websocket_url: Some("wss://openclaw.example.com/ws".to_string()),
                    storage: None,
                    config: Some(super::PartialStudioInstanceConfig {
                        base_url: Some("https://openclaw.example.com".to_string()),
                        websocket_url: Some("wss://openclaw.example.com/ws".to_string()),
                        port: Some("21280".to_string()),
                        auth_token: Some("remote-token".to_string()),
                        ..super::PartialStudioInstanceConfig::default()
                    }),
                },
            )
            .expect("create remote openclaw");

        let detail = service
            .get_instance_detail(&paths, &config, &storage, &remote.id)
            .expect("load instance detail")
            .expect("remote openclaw detail");

        assert_eq!(detail.instance.runtime_kind, StudioRuntimeKind::Openclaw);
        assert_eq!(
            detail.instance.deployment_mode,
            StudioInstanceDeploymentMode::Remote
        );
        assert!(
            detail.workbench.is_none(),
            "remote OpenClaw detail should not reuse the built-in local workbench snapshot"
        );
        let serialized = serde_json::to_value(&detail).expect("serialize detail");
        let console_access = serialized
            .get("consoleAccess")
            .and_then(Value::as_object)
            .expect("detail should include console access");
        assert_eq!(
            console_access.get("available").and_then(Value::as_bool),
            Some(false)
        );
        assert!(console_access
            .get("reason")
            .and_then(Value::as_str)
            .unwrap_or_default()
            .contains("offline"));
    }

    #[test]
    fn remote_openclaw_instance_detail_exposes_console_launch_when_runtime_is_online() {
        let (_root, paths, config, storage, service) = studio_context();
        let remote = service
            .create_instance(
                &paths,
                &config,
                &storage,
                StudioCreateInstanceInput {
                    name: "OpenClaw Remote".to_string(),
                    description: Some("Remote OpenClaw gateway".to_string()),
                    runtime_kind: StudioRuntimeKind::Openclaw,
                    deployment_mode: StudioInstanceDeploymentMode::Remote,
                    transport_kind: StudioInstanceTransportKind::OpenclawGatewayWs,
                    icon_type: None,
                    version: Some("2026.3.23-2".to_string()),
                    type_label: Some("Remote OpenClaw".to_string()),
                    host: Some("openclaw.example.com".to_string()),
                    port: Some(21280),
                    base_url: Some("https://openclaw.example.com".to_string()),
                    websocket_url: Some("wss://openclaw.example.com/ws".to_string()),
                    storage: None,
                    config: Some(super::PartialStudioInstanceConfig {
                        base_url: Some("https://openclaw.example.com".to_string()),
                        websocket_url: Some("wss://openclaw.example.com/ws".to_string()),
                        port: Some("21280".to_string()),
                        auth_token: Some("remote-token".to_string()),
                        ..super::PartialStudioInstanceConfig::default()
                    }),
                },
            )
            .expect("create remote openclaw");

        service
            .update_instance(
                &paths,
                &config,
                &storage,
                &remote.id,
                super::StudioUpdateInstanceInput {
                    status: Some(StudioInstanceStatus::Online),
                    ..super::StudioUpdateInstanceInput::default()
                },
            )
            .expect("mark remote runtime online");

        let detail = service
            .get_instance_detail(&paths, &config, &storage, &remote.id)
            .expect("load instance detail")
            .expect("remote openclaw detail");
        let serialized = serde_json::to_value(&detail).expect("serialize detail");
        let console_access = serialized
            .get("consoleAccess")
            .and_then(Value::as_object)
            .expect("detail should include console access");

        assert_eq!(
            console_access.get("available").and_then(Value::as_bool),
            Some(true)
        );
        assert_eq!(
            console_access.get("authMode").and_then(Value::as_str),
            Some("token")
        );
        assert!(console_access.get("autoLoginUrl").is_none());
        assert!(console_access
            .get("reason")
            .and_then(Value::as_str)
            .unwrap_or_default()
            .contains("manual authorization"));
    }

    #[test]
    fn hermes_remote_instance_detail_reports_external_runtime_constraints_and_generic_connectivity()
    {
        let (_root, paths, config, storage, service) = studio_context();
        let remote = service
            .create_instance(
                &paths,
                &config,
                &storage,
                StudioCreateInstanceInput {
                    name: "Hermes Remote".to_string(),
                    description: Some("Remote Hermes Agent runtime".to_string()),
                    runtime_kind: StudioRuntimeKind::Hermes,
                    deployment_mode: StudioInstanceDeploymentMode::Remote,
                    transport_kind: StudioInstanceTransportKind::CustomHttp,
                    icon_type: None,
                    version: Some("0.1.0".to_string()),
                    type_label: Some("Remote Hermes Agent".to_string()),
                    host: Some("hermes.example.com".to_string()),
                    port: Some(443),
                    base_url: Some("https://hermes.example.com".to_string()),
                    websocket_url: None,
                    storage: None,
                    config: Some(super::PartialStudioInstanceConfig {
                        base_url: Some("https://hermes.example.com".to_string()),
                        port: Some("443".to_string()),
                        ..super::PartialStudioInstanceConfig::default()
                    }),
                },
            )
            .expect("create remote hermes");

        let detail = service
            .get_instance_detail(&paths, &config, &storage, &remote.id)
            .expect("load instance detail")
            .expect("remote hermes detail");

        assert_eq!(detail.instance.runtime_kind, StudioRuntimeKind::Hermes);
        assert_eq!(
            detail.instance.deployment_mode,
            StudioInstanceDeploymentMode::Remote
        );
        assert_eq!(
            detail.lifecycle.owner,
            StudioInstanceLifecycleOwner::RemoteService
        );
        assert!(!detail.lifecycle.start_stop_supported);
        assert!(!detail.lifecycle.lifecycle_controllable);
        assert!(!detail.lifecycle.workbench_managed);
        assert!(
            detail.workbench.is_none(),
            "remote Hermes detail should not reuse the OpenClaw workbench snapshot"
        );
        assert!(detail
            .connectivity
            .endpoints
            .iter()
            .any(|endpoint| endpoint.id == "gateway-http"
                && endpoint.url.as_deref() == Some("https://hermes.example.com")));
        assert!(detail
            .official_runtime_notes
            .iter()
            .any(|note| note.content.contains("WSL2") && note.content.contains("remote Linux")));
        assert!(detail
            .capabilities
            .iter()
            .any(|capability| capability.id == StudioInstanceCapability::Files));
        assert!(detail
            .capabilities
            .iter()
            .any(|capability| capability.id == StudioInstanceCapability::Models));
    }

    #[test]
    fn zeroclaw_remote_instance_detail_reports_external_lifecycle_and_dashboard_endpoint() {
        let (_root, paths, config, storage, service) = studio_context();
        let remote = service
            .create_instance(
                &paths,
                &config,
                &storage,
                StudioCreateInstanceInput {
                    name: "Zero Remote".to_string(),
                    description: Some("Remote ZeroClaw gateway".to_string()),
                    runtime_kind: StudioRuntimeKind::Zeroclaw,
                    deployment_mode: StudioInstanceDeploymentMode::Remote,
                    transport_kind: StudioInstanceTransportKind::ZeroclawHttp,
                    icon_type: None,
                    version: Some("1.0.0".to_string()),
                    type_label: Some("ZeroClaw Remote".to_string()),
                    host: Some("zeroclaw.example.com".to_string()),
                    port: Some(42617),
                    base_url: Some("https://zeroclaw.example.com".to_string()),
                    websocket_url: Some("wss://zeroclaw.example.com/ws".to_string()),
                    storage: Some(super::PartialStudioStorageBinding {
                        provider: Some(StorageProviderKind::Postgres),
                        namespace: Some("studio.remote.zeroclaw".to_string()),
                        database: Some("claw_studio".to_string()),
                        connection_hint: Some("configured".to_string()),
                        endpoint: Some("postgresql://zeroclaw.example.com".to_string()),
                        ..super::PartialStudioStorageBinding::default()
                    }),
                    config: Some(super::PartialStudioInstanceConfig {
                        base_url: Some("https://zeroclaw.example.com".to_string()),
                        websocket_url: Some("wss://zeroclaw.example.com/ws".to_string()),
                        port: Some("42617".to_string()),
                        ..super::PartialStudioInstanceConfig::default()
                    }),
                },
            )
            .expect("create zeroclaw remote");

        let detail = service
            .get_instance_detail(&paths, &config, &storage, &remote.id)
            .expect("load instance detail")
            .expect("zeroclaw detail");

        assert_eq!(detail.instance.runtime_kind, StudioRuntimeKind::Zeroclaw);
        assert_eq!(
            detail.lifecycle.owner,
            StudioInstanceLifecycleOwner::RemoteService
        );
        assert!(!detail.lifecycle.start_stop_supported);
        assert!(!detail.lifecycle.lifecycle_controllable);
        assert!(!detail.lifecycle.workbench_managed);
        assert!(!detail.lifecycle.endpoint_observed);
        assert_eq!(detail.storage.provider, StorageProviderKind::Postgres);
        assert_eq!(detail.storage.status, StudioInstanceStorageStatus::Ready);
        assert!(detail
            .data_access
            .routes
            .iter()
            .any(|route| route.scope == StudioInstanceDataAccessScope::Tasks
                && route.mode == StudioInstanceDataAccessMode::RemoteEndpoint));
        assert!(detail
            .connectivity
            .endpoints
            .iter()
            .any(|endpoint| endpoint.id == "gateway-http"
                && endpoint.url.as_deref() == Some("https://zeroclaw.example.com")));
        assert!(detail.artifacts.iter().any(|artifact| artifact.kind
            == StudioInstanceArtifactKind::Dashboard
            && artifact.location.as_deref() == Some("https://zeroclaw.example.com")));
        assert!(detail
            .official_runtime_notes
            .iter()
            .any(|note| note.title.contains("gateway") || note.title.contains("dashboard")));
    }

    #[test]
    fn ironclaw_remote_instance_detail_highlights_database_requirements() {
        let (_root, paths, config, storage, service) = studio_context();
        let remote = service
            .create_instance(
                &paths,
                &config,
                &storage,
                StudioCreateInstanceInput {
                    name: "Iron Remote".to_string(),
                    description: Some("Remote IronClaw".to_string()),
                    runtime_kind: StudioRuntimeKind::Ironclaw,
                    deployment_mode: StudioInstanceDeploymentMode::Remote,
                    transport_kind: StudioInstanceTransportKind::IronclawWeb,
                    icon_type: None,
                    version: Some("0.3.0".to_string()),
                    type_label: Some("IronClaw Remote".to_string()),
                    host: Some("ironclaw.example.com".to_string()),
                    port: Some(443),
                    base_url: Some("https://ironclaw.example.com".to_string()),
                    websocket_url: Some("wss://ironclaw.example.com/ws".to_string()),
                    storage: Some(super::PartialStudioStorageBinding {
                        provider: Some(StorageProviderKind::Postgres),
                        namespace: Some("studio.remote.ironclaw".to_string()),
                        database: Some("ironclaw".to_string()),
                        connection_hint: Some("configured".to_string()),
                        endpoint: Some("postgresql://ironclaw.example.com".to_string()),
                        ..super::PartialStudioStorageBinding::default()
                    }),
                    config: Some(super::PartialStudioInstanceConfig {
                        base_url: Some("https://ironclaw.example.com".to_string()),
                        websocket_url: Some("wss://ironclaw.example.com/ws".to_string()),
                        port: Some("443".to_string()),
                        ..super::PartialStudioInstanceConfig::default()
                    }),
                },
            )
            .expect("create ironclaw remote");

        let detail = service
            .get_instance_detail(&paths, &config, &storage, &remote.id)
            .expect("load instance detail")
            .expect("ironclaw detail");

        assert_eq!(detail.instance.runtime_kind, StudioRuntimeKind::Ironclaw);
        assert_eq!(
            detail.lifecycle.owner,
            StudioInstanceLifecycleOwner::RemoteService
        );
        assert!(detail.storage.queryable);
        assert!(detail.storage.transactional);
        assert!(detail.data_access.routes.iter().any(|route| route.scope
            == StudioInstanceDataAccessScope::Memory
            && route.mode == StudioInstanceDataAccessMode::StorageBinding
            && route.authoritative
            && route.target.as_deref() == Some("postgresql://ironclaw.example.com")));
        assert!(detail.artifacts.iter().any(|artifact| artifact.kind
            == StudioInstanceArtifactKind::StorageBinding
            && artifact.location.as_deref() == Some("postgresql://ironclaw.example.com")));
        assert!(detail
            .capabilities
            .iter()
            .any(|capability| capability.id == StudioInstanceCapability::Memory));
        assert!(detail
            .official_runtime_notes
            .iter()
            .any(|note| note.content.contains("PostgreSQL") || note.content.contains("pgvector")));
    }
}
