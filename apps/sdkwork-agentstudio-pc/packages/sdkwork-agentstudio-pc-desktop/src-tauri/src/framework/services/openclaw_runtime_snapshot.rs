use crate::{
    framework::{
        kernel::{
            DesktopOpenClawChannelConfigHealthInfo, DesktopOpenClawProviderProjectionInfo,
            DesktopOpenClawRuntimeAuthorityInfo, DesktopOpenClawRuntimeAuthorityProbeInfo,
            DesktopOpenClawRuntimeInfo, DesktopOpenClawRuntimeStageInfo,
        },
        paths::AppPaths,
        services::{
            kernel_runtime_authority::KernelRuntimeAuthorityService,
            local_ai_proxy::{
                resolve_projected_openclaw_provider_api,
                resolve_projected_openclaw_provider_base_url, LocalAiProxyLifecycle,
                LocalAiProxyService, LocalAiProxyServiceStatus, OPENCLAW_LOCAL_PROXY_PROVIDER_AUTH,
                OPENCLAW_LOCAL_PROXY_PROVIDER_ID,
            },
            openclaw_runtime::{
                collect_openclaw_runtime_channel_ids, load_manifest, ActivatedOpenClawRuntime,
                OPENCLAW_RUNTIME_ID,
            },
            supervisor::{
                ManagedServiceLifecycle, ManagedServiceSnapshot, SupervisorService,
                SERVICE_ID_OPENCLAW_GATEWAY,
            },
        },
        Result,
    },
    platform,
};
use serde_json::{Map, Value};
use std::{
    fs,
    path::{Path, PathBuf},
};

#[derive(Clone, Debug, Default)]
pub struct OpenClawRuntimeSnapshotService;

#[derive(Clone, Debug)]
struct ProviderProjectionEvidence {
    status: String,
    detail: String,
    base_url: Option<String>,
    api: Option<String>,
    auth: Option<String>,
    default_model: Option<String>,
    available: bool,
}

#[derive(Clone, Debug)]
struct ExpectedProviderProjectionContract {
    base_url: String,
    api: &'static str,
    auth: &'static str,
}

impl OpenClawRuntimeSnapshotService {
    pub fn new() -> Self {
        Self
    }

    pub fn kernel_info(
        &self,
        paths: &AppPaths,
        supervisor: &SupervisorService,
        local_ai_proxy: &LocalAiProxyService,
    ) -> Result<DesktopOpenClawRuntimeInfo> {
        let configured_runtime = supervisor.configured_openclaw_runtime()?;
        let openclaw_paths = paths.kernel_paths(OPENCLAW_RUNTIME_ID)?;
        let supervisor_snapshot = supervisor.snapshot()?;
        let gateway_service = supervisor_snapshot
            .services
            .iter()
            .find(|service| service.id == SERVICE_ID_OPENCLAW_GATEWAY);
        let local_ai_proxy_status = local_ai_proxy.status()?;
        let readable_config_path = readable_openclaw_config_path(paths)?;
        let active_config_path = active_openclaw_config_path(paths)?;
        let (config_root, config_error) = load_openclaw_config_root(&readable_config_path);
        let provider_projection = build_provider_projection(
            &config_root,
            config_error.as_deref(),
            &local_ai_proxy_status,
        );
        let startup_chain = build_startup_chain(
            configured_runtime.as_ref(),
            gateway_service,
            &local_ai_proxy_status,
            &provider_projection,
        );
        let authority =
            KernelRuntimeAuthorityService::new().contract(OPENCLAW_RUNTIME_ID, paths)?;
        let manifest = configured_runtime
            .as_ref()
            .and_then(|runtime| load_manifest(&runtime.install_dir.join("manifest.json")).ok());

        Ok(DesktopOpenClawRuntimeInfo {
            runtime_id: OPENCLAW_RUNTIME_ID.to_string(),
            lifecycle: resolve_runtime_lifecycle(
                configured_runtime.as_ref(),
                gateway_service,
                &local_ai_proxy_status,
                &provider_projection,
            ),
            configured: configured_runtime.is_some(),
            install_key: configured_runtime
                .as_ref()
                .map(|runtime| runtime.install_key.clone()),
            openclaw_version: manifest
                .as_ref()
                .map(|manifest| manifest.openclaw_version.clone()),
            node_version: manifest
                .as_ref()
                .and_then(|manifest| manifest.external_node_version().map(str::to_string)),
            platform: manifest
                .as_ref()
                .map(|manifest| manifest.platform.clone())
                .unwrap_or_else(|| platform::current_target().to_string()),
            arch: manifest
                .as_ref()
                .map(|manifest| manifest.arch.clone())
                .unwrap_or_else(|| platform::current_arch().to_string()),
            install_dir: configured_runtime
                .as_ref()
                .map(|runtime| path_string(&runtime.install_dir)),
            runtime_dir: configured_runtime
                .as_ref()
                .map(|runtime| path_string(&runtime.runtime_dir)),
            home_dir: configured_runtime
                .as_ref()
                .map(|runtime| path_string(&runtime.home_dir))
                .unwrap_or_else(|| path_string(&openclaw_paths.home_dir)),
            state_dir: configured_runtime
                .as_ref()
                .map(|runtime| path_string(&runtime.state_dir))
                .unwrap_or_else(|| path_string(&openclaw_paths.state_dir)),
            workspace_dir: path_string(&openclaw_paths.workspace_dir),
            config_file: path_string(&active_config_path),
            gateway_port: configured_runtime
                .as_ref()
                .map(|runtime| runtime.gateway_port),
            gateway_base_url: configured_runtime
                .as_ref()
                .map(|runtime| format!("http://127.0.0.1:{}", runtime.gateway_port)),
            local_ai_proxy_base_url: local_ai_proxy_status
                .health
                .as_ref()
                .map(|health| health.base_url.clone()),
            local_ai_proxy_snapshot_path: path_string(&paths.local_ai_proxy_snapshot_file),
            authority: DesktopOpenClawRuntimeAuthorityInfo {
                config_file: path_string(&authority.config_file_path),
                owned_runtime_roots: authority
                    .owned_runtime_roots
                    .iter()
                    .map(|path| path_string(path))
                    .collect(),
                readiness_probe: DesktopOpenClawRuntimeAuthorityProbeInfo {
                    supports_loopback_health_probe: authority
                        .readiness_probe
                        .supports_loopback_health_probe,
                    health_probe_timeout_ms: authority.readiness_probe.health_probe_timeout_ms,
                },
            },
            channel_config_health: Some(build_channel_config_health(
                configured_runtime.as_ref(),
                &readable_config_path,
                &config_root,
                config_error.as_deref(),
            )),
            provider_projection: DesktopOpenClawProviderProjectionInfo {
                provider_id: OPENCLAW_LOCAL_PROXY_PROVIDER_ID.to_string(),
                available: provider_projection.available,
                status: provider_projection.status,
                base_url: provider_projection.base_url,
                api: provider_projection.api,
                auth: provider_projection.auth,
                default_model: provider_projection.default_model,
            },
            startup_chain,
        })
    }
}

fn resolve_runtime_lifecycle(
    configured_runtime: Option<&ActivatedOpenClawRuntime>,
    gateway_service: Option<&ManagedServiceSnapshot>,
    local_ai_proxy_status: &LocalAiProxyServiceStatus,
    provider_projection: &ProviderProjectionEvidence,
) -> String {
    if configured_runtime.is_none() {
        return "inactive".to_string();
    }

    match gateway_service.map(|service| &service.lifecycle) {
        Some(ManagedServiceLifecycle::Starting) => "starting".to_string(),
        Some(ManagedServiceLifecycle::Stopping) => "stopping".to_string(),
        Some(ManagedServiceLifecycle::Failed) => "degraded".to_string(),
        Some(ManagedServiceLifecycle::Running) => {
            if matches!(
                local_ai_proxy_status.lifecycle,
                LocalAiProxyLifecycle::Running
            ) && provider_projection.status == "ready"
            {
                "ready".to_string()
            } else {
                "degraded".to_string()
            }
        }
        _ => "stopped".to_string(),
    }
}

fn build_startup_chain(
    configured_runtime: Option<&ActivatedOpenClawRuntime>,
    gateway_service: Option<&ManagedServiceSnapshot>,
    local_ai_proxy_status: &LocalAiProxyServiceStatus,
    provider_projection: &ProviderProjectionEvidence,
) -> Vec<DesktopOpenClawRuntimeStageInfo> {
    let configure_status = if let Some(runtime) = configured_runtime {
        DesktopOpenClawRuntimeStageInfo {
            id: "configureOpenClawGateway".to_string(),
            status: "ready".to_string(),
            detail: format!(
                "Gateway runtime is configured with install key {} on port {}.",
                runtime.install_key, runtime.gateway_port
            ),
        }
    } else {
        DesktopOpenClawRuntimeStageInfo {
            id: "configureOpenClawGateway".to_string(),
            status: "pending".to_string(),
            detail: "No built-in OpenClaw runtime is configured in the desktop supervisor yet."
                .to_string(),
        }
    };

    let ensure_proxy_status = DesktopOpenClawRuntimeStageInfo {
        id: "ensureLocalAiProxyReady".to_string(),
        status: match local_ai_proxy_status.lifecycle {
            LocalAiProxyLifecycle::Running => "ready".to_string(),
            LocalAiProxyLifecycle::Failed => "degraded".to_string(),
            LocalAiProxyLifecycle::Stopped => "pending".to_string(),
        },
        detail: match (
            &local_ai_proxy_status.lifecycle,
            local_ai_proxy_status.health.as_ref(),
        ) {
            (LocalAiProxyLifecycle::Running, Some(health)) => format!(
                "Local AI proxy is serving OpenClaw traffic at {}.",
                health.base_url
            ),
            (LocalAiProxyLifecycle::Failed, _) => local_ai_proxy_status
                .last_error
                .clone()
                .unwrap_or_else(|| "Local AI proxy failed to initialize.".to_string()),
            _ => {
                "Local AI proxy has not been started for the built-in OpenClaw runtime.".to_string()
            }
        },
    };

    let project_provider_status = DesktopOpenClawRuntimeStageInfo {
        id: "projectManagedOpenClawProvider".to_string(),
        status: provider_projection.status.clone(),
        detail: provider_projection.detail.clone(),
    };

    let mut stages = vec![
        configure_status,
        ensure_proxy_status,
        project_provider_status,
    ];
    if let Some(service) = gateway_service {
        if matches!(service.lifecycle, ManagedServiceLifecycle::Failed) {
            stages.push(DesktopOpenClawRuntimeStageInfo {
                id: "openclawGatewayHealth".to_string(),
                status: "degraded".to_string(),
                detail: service.last_error.clone().unwrap_or_else(|| {
                    "Bundled OpenClaw gateway entered a failed state.".to_string()
                }),
            });
        }
    }
    stages
}

fn build_provider_projection(
    config_root: &Value,
    config_error: Option<&str>,
    local_ai_proxy_status: &LocalAiProxyServiceStatus,
) -> ProviderProjectionEvidence {
    if let Some(error) = config_error {
        return ProviderProjectionEvidence {
            status: "degraded".to_string(),
            detail: format!("OpenClaw config file could not be parsed: {error}"),
            base_url: None,
            api: None,
            auth: None,
            default_model: None,
            available: false,
        };
    }

    let Some(provider) = config_root
        .pointer("/models/providers/sdkwork-local-proxy")
        .and_then(Value::as_object)
    else {
        return ProviderProjectionEvidence {
            status: "pending".to_string(),
            detail: "Managed local proxy provider has not been projected into openclaw.json."
                .to_string(),
            base_url: None,
            api: None,
            auth: None,
            default_model: None,
            available: false,
        };
    };

    let base_url = provider
        .get("baseUrl")
        .and_then(Value::as_str)
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty());
    let api = provider
        .get("api")
        .and_then(Value::as_str)
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty());
    let auth = provider
        .get("auth")
        .and_then(Value::as_str)
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty());
    let default_model = config_root
        .pointer("/agents/defaults/model/primary")
        .and_then(Value::as_str)
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty());
    let default_model_managed = default_model
        .as_deref()
        .map(|value| value.starts_with(&format!("{}/", OPENCLAW_LOCAL_PROXY_PROVIDER_ID)))
        .unwrap_or(false);
    let expected_contract = resolve_expected_provider_projection_contract(local_ai_proxy_status);
    let drift_reasons = collect_provider_projection_drift_reasons(
        expected_contract.as_ref(),
        base_url.as_deref(),
        api.as_deref(),
        auth.as_deref(),
        default_model.as_deref(),
        default_model_managed,
    );

    let (status, detail) = match (
        &local_ai_proxy_status.lifecycle,
        expected_contract.as_ref(),
        drift_reasons.is_empty(),
    ) {
        (LocalAiProxyLifecycle::Running, Some(expected), true) => {
            (
                "ready".to_string(),
                format!(
                    "Managed provider projects the local AI proxy at {} with {} auth, {} API, and default model {}.",
                    expected.base_url,
                    expected.auth,
                    expected.api,
                    default_model.as_deref().unwrap_or("unknown")
                ),
            )
        }
        (LocalAiProxyLifecycle::Running, Some(_), false) => (
            "degraded".to_string(),
            format!(
                "Managed provider projection is out of sync with the local AI proxy: {}.",
                drift_reasons.join("; ")
            ),
        ),
        (LocalAiProxyLifecycle::Running, None, _) => (
            "degraded".to_string(),
            "Local AI proxy reports running, but projection validation details are unavailable."
                .to_string(),
        ),
        (_, _, _) if base_url.is_some() => (
            "pending".to_string(),
            format!(
                "Managed provider is configured at {}, but the local AI proxy is not ready yet.",
                base_url.as_deref().unwrap_or("unknown")
            ),
        ),
        _ => (
            "pending".to_string(),
            "Managed provider exists but is missing a projected base URL.".to_string(),
        ),
    };

    ProviderProjectionEvidence {
        status,
        detail,
        base_url,
        api,
        auth,
        default_model,
        available: true,
    }
}

fn build_channel_config_health(
    configured_runtime: Option<&ActivatedOpenClawRuntime>,
    config_path: &Path,
    config_root: &Value,
    config_error: Option<&str>,
) -> DesktopOpenClawChannelConfigHealthInfo {
    let supported_channel_ids = configured_runtime
        .map(|runtime| collect_openclaw_runtime_channel_ids(&runtime.runtime_dir))
        .transpose();
    let (runtime_metadata_available, supported_channel_ids) = match supported_channel_ids {
        Ok(Some(channel_ids)) => (true, channel_ids.into_iter().collect::<Vec<String>>()),
        Ok(None) | Err(_) => (false, Vec::new()),
    };
    let supported_channel_id_set = supported_channel_ids
        .iter()
        .cloned()
        .collect::<std::collections::BTreeSet<_>>();
    let config_readable = config_error.is_none() && config_path.exists();
    let mut configured_channel_ids = Vec::new();
    let mut unknown_channel_ids = Vec::new();
    let mut malformed_channel_ids = Vec::new();
    let mut model_by_channel_ids = Vec::new();
    let mut unknown_model_by_channel_ids = Vec::new();
    let mut invalid_model_by_channel_ids = Vec::new();

    if let Some(channels_root) = config_root.get("channels").and_then(Value::as_object) {
        for (channel_id, value) in channels_root {
            if channel_id == "defaults" || channel_id == "modelByChannel" {
                continue;
            }

            if supported_channel_id_set.contains(channel_id) {
                if value.is_object() {
                    configured_channel_ids.push(channel_id.clone());
                } else {
                    malformed_channel_ids.push(channel_id.clone());
                }
            } else {
                unknown_channel_ids.push(channel_id.clone());
            }
        }

        if let Some(model_by_channel) = channels_root
            .get("modelByChannel")
            .and_then(Value::as_object)
        {
            for (channel_id, value) in model_by_channel {
                if !supported_channel_id_set.contains(channel_id) {
                    unknown_model_by_channel_ids.push(channel_id.clone());
                } else if value.as_object().is_some_and(|overrides| {
                    !overrides.is_empty() && overrides.values().all(Value::is_string)
                }) {
                    model_by_channel_ids.push(channel_id.clone());
                } else {
                    invalid_model_by_channel_ids.push(channel_id.clone());
                }
            }
        } else if channels_root.contains_key("modelByChannel") {
            invalid_model_by_channel_ids.push("modelByChannel".to_string());
        }
    }

    let valid = runtime_metadata_available
        && config_readable
        && unknown_channel_ids.is_empty()
        && malformed_channel_ids.is_empty()
        && unknown_model_by_channel_ids.is_empty()
        && invalid_model_by_channel_ids.is_empty();
    let status = if valid { "ready" } else { "degraded" }.to_string();

    DesktopOpenClawChannelConfigHealthInfo {
        status,
        valid,
        runtime_metadata_available,
        config_readable,
        supported_channel_ids,
        configured_channel_ids,
        unknown_channel_ids,
        malformed_channel_ids,
        model_by_channel_ids,
        unknown_model_by_channel_ids,
        invalid_model_by_channel_ids,
    }
}

fn resolve_expected_provider_projection_contract(
    local_ai_proxy_status: &LocalAiProxyServiceStatus,
) -> Option<ExpectedProviderProjectionContract> {
    let health = local_ai_proxy_status.health.as_ref()?;
    let client_protocol = health
        .default_routes
        .iter()
        .find(|route| route.id == health.default_route_id)
        .map(|route| route.client_protocol.as_str())
        .or_else(|| {
            health
                .default_routes
                .first()
                .map(|route| route.client_protocol.as_str())
        })
        .unwrap_or("openai-compatible");

    Some(ExpectedProviderProjectionContract {
        base_url: resolve_projected_openclaw_provider_base_url(client_protocol, &health.base_url),
        api: resolve_projected_openclaw_provider_api(client_protocol),
        auth: OPENCLAW_LOCAL_PROXY_PROVIDER_AUTH,
    })
}

fn collect_provider_projection_drift_reasons(
    expected_contract: Option<&ExpectedProviderProjectionContract>,
    actual_base_url: Option<&str>,
    actual_api: Option<&str>,
    actual_auth: Option<&str>,
    default_model: Option<&str>,
    default_model_managed: bool,
) -> Vec<String> {
    let mut reasons = Vec::new();

    if let Some(expected) = expected_contract {
        if actual_base_url != Some(expected.base_url.as_str()) {
            reasons.push(match actual_base_url {
                Some(actual) => format!(
                    "base URL {actual} does not match expected {}",
                    expected.base_url
                ),
                None => format!("base URL is missing; expected {}", expected.base_url),
            });
        }

        if actual_api != Some(expected.api) {
            reasons.push(match actual_api {
                Some(actual) => {
                    format!("api {actual} does not match expected {}", expected.api)
                }
                None => format!("api is missing; expected {}", expected.api),
            });
        }

        if actual_auth != Some(expected.auth) {
            reasons.push(match actual_auth {
                Some(actual) => {
                    format!("auth {actual} does not match expected {}", expected.auth)
                }
                None => format!("auth is missing; expected {}", expected.auth),
            });
        }
    }

    if !default_model_managed {
        reasons.push(format!(
            "default model {} is not managed by {}",
            default_model.unwrap_or("unknown"),
            OPENCLAW_LOCAL_PROXY_PROVIDER_ID
        ));
    }

    reasons
}

fn load_openclaw_config_root(path: &Path) -> (Value, Option<String>) {
    if !path.exists() {
        return (Value::Object(Map::new()), None);
    }

    match fs::read_to_string(path) {
        Ok(content) => match json5::from_str::<Value>(&content) {
            Ok(value) if value.is_object() => (value, None),
            Ok(_) => (
                Value::Object(Map::new()),
                Some(format!("expected config object at {}", path.display())),
            ),
            Err(error) => (
                Value::Object(Map::new()),
                Some(format!(
                    "invalid json5 config at {}: {error}",
                    path.display()
                )),
            ),
        },
        Err(error) => (
            Value::Object(Map::new()),
            Some(format!("failed to read {}: {error}", path.display())),
        ),
    }
}

fn readable_openclaw_config_path(paths: &AppPaths) -> Result<PathBuf> {
    active_openclaw_config_path(paths)
}

fn active_openclaw_config_path(paths: &AppPaths) -> Result<PathBuf> {
    KernelRuntimeAuthorityService::new().active_config_file_path("openclaw", paths)
}

fn path_string(path: &Path) -> String {
    path.to_string_lossy().into_owned()
}

#[cfg(test)]
mod tests {
    use super::{build_channel_config_health, build_provider_projection};
    use crate::framework::services::openclaw_runtime::ActivatedOpenClawRuntime;
    use crate::framework::services::{
        local_ai_proxy::{
            LocalAiProxyDefaultRouteHealth, LocalAiProxyLifecycle, LocalAiProxyServiceHealth,
            LocalAiProxyServiceStatus,
        },
        local_ai_proxy_snapshot::LOCAL_AI_PROXY_DEFAULT_PORT,
    };
    use serde_json::json;
    use std::path::PathBuf;

    fn default_local_ai_proxy_root_base_url() -> String {
        format!("http://127.0.0.1:{LOCAL_AI_PROXY_DEFAULT_PORT}")
    }

    fn default_local_ai_proxy_v1_base_url() -> String {
        format!("{}/v1", default_local_ai_proxy_root_base_url())
    }

    #[test]
    fn openclaw_runtime_snapshot_production_path_has_no_panic_exits() {
        let source = include_str!("openclaw_runtime_snapshot.rs");
        let production_source = source.split("#[cfg(test)]").next().unwrap_or(source); // WORKSPACE-PATH:allow-fixture-block: this module is the file's #[cfg(test)] unit-test fixture data
        let forbidden_patterns = [
            ".expect(",
            ".unwrap(",
            "panic!(",
            "todo!(",
            "unimplemented!(",
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
            "OpenClaw runtime snapshot production code must propagate errors instead of panicking:\n{}",
            offenders.join("\n")
        );
    }

    fn create_running_local_ai_proxy_status(client_protocol: &str) -> LocalAiProxyServiceStatus {
        LocalAiProxyServiceStatus {
            lifecycle: LocalAiProxyLifecycle::Running,
            health: Some(LocalAiProxyServiceHealth {
                base_url: default_local_ai_proxy_v1_base_url(),
                active_port: LOCAL_AI_PROXY_DEFAULT_PORT,
                loopback_only: true,
                default_route_id: "default-route".to_string(),
                default_route_name: "SDKWork Default".to_string(),
                default_routes: vec![LocalAiProxyDefaultRouteHealth {
                    client_protocol: client_protocol.to_string(),
                    id: "default-route".to_string(),
                    name: "SDKWork Default".to_string(),
                    managed_by: "system-default".to_string(),
                    upstream_protocol: "sdkwork".to_string(),
                    upstream_base_url: "https://ai.sdkwork.com".to_string(),
                    model_count: 3,
                }],
                upstream_base_url: "https://ai.sdkwork.com".to_string(),
                model_count: 3,
                snapshot_path: "C:/runtime/local-ai-proxy.snapshot.json".to_string(),
                log_path: "C:/runtime/local-ai-proxy.log".to_string(),
            }),
            route_metrics: Vec::new(),
            route_tests: Vec::new(),
            last_error: None,
        }
    }

    #[test]
    fn build_channel_config_health_reports_stale_channel_roots_without_config_contents() {
        let config_root = json!({
            "channels": {
                "telegram": {},
                "qq": {},
                "slack": ["malformed"],
                "modelByChannel": {
                    "telegram": {
                        "*": "sdkwork-local-proxy/gpt-5.4-mini"
                    },
                    "dingtalk": {
                        "*": "sdkwork-local-proxy/gpt-5.4-mini"
                    },
                    "signal": ["malformed"]
                }
            }
        });
        let temp_dir = tempfile::tempdir().expect("temp dir");
        let install_dir = temp_dir.path().join("install");
        let runtime_dir = install_dir.join("runtime");
        let extensions_dir = runtime_dir
            .join("package")
            .join("node_modules")
            .join("openclaw")
            .join("dist")
            .join("extensions");
        for channel_id in ["telegram", "slack", "signal"] {
            let package_path = extensions_dir.join(channel_id).join("package.json");
            std::fs::create_dir_all(package_path.parent().expect("package parent"))
                .expect("create package parent");
            std::fs::write(
                package_path,
                format!(r#"{{"openclaw":{{"channel":{{"id":"{channel_id}"}}}}}}"#),
            )
            .expect("write package metadata");
        }
        let config_path = temp_dir.path().join("openclaw.json");
        std::fs::write(&config_path, "{}").expect("write config");
        let runtime = ActivatedOpenClawRuntime {
            install_key: "test-runtime".to_string(),
            install_dir,
            runtime_dir,
            node_path: PathBuf::from("node"),
            cli_path: PathBuf::from("openclaw"),
            home_dir: temp_dir.path().join("home"),
            state_dir: temp_dir.path().join("state"),
            workspace_dir: temp_dir.path().join("workspace"),
            config_path: config_path.clone(),
            gateway_port: 21_280,
            gateway_auth_token: "secret-token".to_string(),
        };

        let health = build_channel_config_health(Some(&runtime), &config_path, &config_root, None);

        assert_eq!(health.status, "degraded");
        assert!(!health.valid);
        assert!(health.runtime_metadata_available);
        assert!(health.config_readable);
        assert_eq!(
            health.supported_channel_ids,
            vec!["signal", "slack", "telegram"]
        );
        assert_eq!(health.configured_channel_ids, vec!["telegram"]);
        assert_eq!(health.unknown_channel_ids, vec!["qq"]);
        assert_eq!(health.malformed_channel_ids, vec!["slack"]);
        assert_eq!(health.model_by_channel_ids, vec!["telegram"]);
        assert_eq!(health.unknown_model_by_channel_ids, vec!["dingtalk"]);
        assert_eq!(health.invalid_model_by_channel_ids, vec!["signal"]);
    }

    #[test]
    fn build_provider_projection_accepts_gemini_root_base_url_for_running_proxy() {
        let config_root = json!({
            "models": {
                "providers": {
                    "sdkwork-local-proxy": {
                        "baseUrl": default_local_ai_proxy_root_base_url(),
                        "api": "google-generative-ai",
                        "auth": "api-key"
                    }
                }
            },
            "agents": {
                "defaults": {
                    "model": {
                        "primary": "sdkwork-local-proxy/gemini-2.5-pro"
                    }
                }
            }
        });

        let projection = build_provider_projection(
            &config_root,
            None,
            &create_running_local_ai_proxy_status("gemini"),
        );

        assert_eq!(projection.status, "ready");
        assert!(projection
            .detail
            .contains("sdkwork-local-proxy/gemini-2.5-pro"));
    }

    #[test]
    fn build_provider_projection_degrades_when_api_does_not_match_default_route_protocol() {
        let config_root = json!({
            "models": {
                "providers": {
                    "sdkwork-local-proxy": {
                        "baseUrl": default_local_ai_proxy_root_base_url(),
                        "api": "openai-completions",
                        "auth": "api-key"
                    }
                }
            },
            "agents": {
                "defaults": {
                    "model": {
                        "primary": "sdkwork-local-proxy/gemini-2.5-pro"
                    }
                }
            }
        });

        let projection = build_provider_projection(
            &config_root,
            None,
            &create_running_local_ai_proxy_status("gemini"),
        );

        assert_eq!(projection.status, "degraded");
        assert!(projection.detail.contains("api"));
    }

    #[test]
    fn build_provider_projection_degrades_when_auth_mode_does_not_match_proxy_contract() {
        let config_root = json!({
            "models": {
                "providers": {
                    "sdkwork-local-proxy": {
                        "baseUrl": default_local_ai_proxy_v1_base_url(),
                        "api": "openai-completions",
                        "auth": "bearer"
                    }
                }
            },
            "agents": {
                "defaults": {
                    "model": {
                        "primary": "sdkwork-local-proxy/gpt-5.4"
                    }
                }
            }
        });

        let projection = build_provider_projection(
            &config_root,
            None,
            &create_running_local_ai_proxy_status("openai-compatible"),
        );

        assert_eq!(projection.status, "degraded");
        assert!(projection.detail.contains("auth"));
    }
}
