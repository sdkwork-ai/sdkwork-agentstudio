#![recursion_limit = "512"]

mod bootstrap;
mod cli;
mod config;
mod http;
mod port_governance;
mod service;

use axum::serve;
use serde::Serialize;
use sdkwork_agentstudio_host_core::host_core_metadata;

use crate::{
    bootstrap::build_server_state_from_runtime_contract,
    cli::{parse_cli_args, ClawServerCliCommand, ClawServerServiceCommand},
    config::{
        resolve_server_effective_config_path, resolve_server_runtime_config,
        ServerRuntimeConfigResolutionRequest,
    },
    http::api_surface::{build_openapi_startup_catalog, write_runtime_openapi_snapshots},
    http::router::build_router,
    port_governance::bind_server_listener,
    service::{
        execute_server_service_action, project_service_manifest, ServerRuntimeContract,
        ServerServiceControlPlaneHandle, ServerServiceLifecycleAction,
        ServerServiceManifestProjectionRequest,
    },
};

fn resolve_cli_parse_exit_code(error: &clap::Error) -> i32 {
    match error.kind() {
        clap::error::ErrorKind::DisplayHelp | clap::error::ErrorKind::DisplayVersion => 0,
        _ => 1,
    }
}

fn exit_for_cli_parse_error(error: clap::Error) -> ! {
    let exit_code = resolve_cli_parse_exit_code(&error);

    if exit_code == 0 {
        print!("{error}");
    } else {
        eprint!("{error}");
    }

    std::process::exit(exit_code);
}

fn exit_for_runtime_error(context: &str, error: impl std::fmt::Display) -> ! {
    eprintln!("{context}: {error}");
    std::process::exit(1);
}

fn print_json_or_exit<T: Serialize>(value: &T, pretty: bool, context: &str) {
    let serialized = if pretty {
        serde_json::to_string_pretty(value)
    } else {
        serde_json::to_string(value)
    }
    .unwrap_or_else(|error| exit_for_runtime_error(context, error));

    println!("{serialized}");
}

#[tokio::main]
async fn main() {
    let metadata = host_core_metadata();
    let command =
        parse_cli_args(std::env::args_os()).unwrap_or_else(|error| exit_for_cli_parse_error(error));
    let executable_path = std::env::current_exe().unwrap_or_else(|error| {
        eprintln!("failed to resolve current executable path: {error}");
        std::process::exit(1);
    });
    let env = std::env::vars().collect::<std::collections::BTreeMap<_, _>>();
    let runtime_config = resolve_server_runtime_config(ServerRuntimeConfigResolutionRequest {
        command: command.clone(),
        env: env.clone(),
        executable_path: Some(executable_path.clone()),
    })
    .unwrap_or_else(|error| {
        eprintln!("{error}");
        std::process::exit(1);
    });
    let effective_config_path =
        resolve_server_effective_config_path(&command, &env, &runtime_config);

    match command {
        ClawServerCliCommand::Run(_) => {
            let binding = bind_server_listener(&runtime_config.host, runtime_config.port, true)
                .unwrap_or_else(|error| {
                    eprintln!("{error}");
                    std::process::exit(1);
                });
            let state = build_server_state_from_runtime_contract(
                &runtime_config,
                effective_config_path.clone(),
                executable_path.clone(),
                crate::bootstrap::ServerBoundEndpointContext {
                    bind_host: binding.requested_host.clone(),
                    requested_port: binding.requested_port,
                    active_port: binding.active_port,
                    dynamic_port: binding.dynamic_port,
                    last_conflict_reason: binding.last_conflict_reason.clone(),
                },
            );
            let mode = state.mode;
            let requested_host = binding.requested_host.clone();
            let requested_port = binding.requested_port;
            let active_base_url = binding.base_url();
            let dynamic_port = binding.dynamic_port;
            write_runtime_openapi_snapshots(&state, &active_base_url).unwrap_or_else(|error| {
                eprintln!("failed to write runtime openapi snapshots: {error}");
                std::process::exit(1);
            });
            let openapi_catalog = build_openapi_startup_catalog(&state, &active_base_url);
            let app = build_router(state);
            let listener = binding.into_tokio_listener().unwrap_or_else(|error| {
                eprintln!("{error}");
                std::process::exit(1);
            });

            if dynamic_port {
                println!(
                    "{} [{}] requested http://{}:{} but is listening on {}",
                    metadata.package_name, mode, requested_host, requested_port, active_base_url
                );
            } else {
                println!(
                    "{} [{}] listening on {}",
                    metadata.package_name, mode, active_base_url
                );
            }
            print_json_or_exit(
                &openapi_catalog,
                false,
                "failed to serialize openapi startup catalog",
            );

            if let Err(error) = serve(listener, app).await {
                exit_for_runtime_error("server stopped unexpectedly", error);
            }
        }
        ClawServerCliCommand::PrintConfig(_) => {
            print_json_or_exit(
                &runtime_config,
                true,
                "failed to serialize runtime config",
            );
        }
        ClawServerCliCommand::Service(service_command) => match service_command {
            ClawServerServiceCommand::PrintManifest(args) => {
                let manifest = project_service_manifest(ServerServiceManifestProjectionRequest {
                    platform: args.platform,
                    executable_path: executable_path.clone(),
                    config_path: effective_config_path.clone(),
                    runtime_config,
                });
                print_json_or_exit(
                    &manifest,
                    true,
                    "failed to serialize service manifest",
                );
            }
            ClawServerServiceCommand::Install(args) => {
                print_service_execution_result(
                    ServerServiceLifecycleAction::Install,
                    args.platform,
                    executable_path.clone(),
                    effective_config_path.clone(),
                    runtime_config,
                );
            }
            ClawServerServiceCommand::Start(args) => {
                print_service_execution_result(
                    ServerServiceLifecycleAction::Start,
                    args.platform,
                    executable_path.clone(),
                    effective_config_path.clone(),
                    runtime_config,
                );
            }
            ClawServerServiceCommand::Stop(args) => {
                print_service_execution_result(
                    ServerServiceLifecycleAction::Stop,
                    args.platform,
                    executable_path.clone(),
                    effective_config_path.clone(),
                    runtime_config,
                );
            }
            ClawServerServiceCommand::Restart(args) => {
                print_service_execution_result(
                    ServerServiceLifecycleAction::Restart,
                    args.platform,
                    executable_path.clone(),
                    effective_config_path.clone(),
                    runtime_config,
                );
            }
            ClawServerServiceCommand::Status(args) => {
                print_service_execution_result(
                    ServerServiceLifecycleAction::Status,
                    args.platform,
                    executable_path,
                    effective_config_path,
                    runtime_config,
                );
            }
        },
    }
}

fn print_service_execution_result(
    action: ServerServiceLifecycleAction,
    platform: crate::cli::ClawServerServicePlatform,
    executable_path: std::path::PathBuf,
    config_path: std::path::PathBuf,
    runtime_config: crate::config::ResolvedServerRuntimeConfig,
) {
    let runtime_contract = ServerRuntimeContract {
        platform,
        executable_path,
        config_path,
        runtime_config,
    };
    let control_plane = ServerServiceControlPlaneHandle::os();
    let result = execute_server_service_action(&control_plane, &runtime_contract, action)
        .unwrap_or_else(|error| {
            eprintln!("{error}");
            std::process::exit(1);
        });
    print_json_or_exit(
        &result,
        true,
        "failed to serialize service lifecycle result",
    );
}

#[cfg(test)]
mod tests {
    use std::collections::BTreeMap;
    use std::collections::VecDeque;
    use std::fs;
    use std::path::PathBuf;
    use std::sync::{Arc, Mutex};
    use std::time::{Duration, SystemTime, UNIX_EPOCH};

    use axum::{
        body::{to_bytes, Body},
        http::{header, Request, StatusCode},
    };
    use serde_json::{json, Value};
    use tower::ServiceExt;

    use crate::http::api_surface::PublishedProxyTarget;
    use crate::http::auth::{BasicAuthCredentials, ServerAuthConfig};
    use crate::{
        bootstrap::{
            build_control_plane_manage_openclaw_provider, build_server_state_with_overrides,
            build_server_state_with_rollout_data_dir, ManageOpenClawProvider,
            ManageOpenClawProviderHandle, ServerStateOverrides,
        },
        http::router::build_router,
    };
    use sdkwork_agentstudio_host_core::host_endpoints::{
        HostEndpointRecord, HostEndpointRegistration, HostEndpointRegistry,
        OpenClawGatewayProjection, OpenClawLifecycle, OpenClawRuntimeProjection,
    };
    use sdkwork_agentstudio_host_core::openclaw_control_plane::{
        OpenClawControlPlane, OpenClawGatewayInvokeRequest,
    };

    #[test]
    fn server_main_production_path_has_no_panic_exits() {
        let source = include_str!("main.rs");
        let production_source = source.split("#[cfg(test)]").next().unwrap_or(source);
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
            "claw server main production code must report startup/runtime errors instead of panicking:\n{}",
            offenders.join("\n")
        );
    }

    #[test]
    fn server_service_and_http_production_paths_have_no_panic_exits() {
        let sources = [
            ("service.rs", include_str!("service.rs")),
            ("http/auth.rs", include_str!("http/auth.rs")),
            ("http/router.rs", include_str!("http/router.rs")),
            ("http/error_response.rs", include_str!("http/error_response.rs")),
            ("http/static_assets.rs", include_str!("http/static_assets.rs")),
        ];
        let forbidden_patterns = [
            ".expect(",
            ".unwrap(",
            "panic!(",
            "todo!(",
            "unimplemented!(",
            "unreachable!(",
        ];
        let mut offenders = Vec::new();

        for (source_name, source) in sources {
            let production_source = source.split("#[cfg(test)]").next().unwrap_or(source); // WORKSPACE-PATH:allow-fixture-block: this module is the file's #[cfg(test)] unit-test fixture data
            for (index, line) in production_source.lines().enumerate() {
                for pattern in forbidden_patterns {
                    if line.contains(pattern) {
                        offenders.push(format!("{source_name}:{}:{}", index + 1, line.trim()));
                    }
                }
            }
        }

        assert!(
            offenders.is_empty(),
            "claw server service/http production code must return errors or degrade safely instead of panicking:\n{}",
            offenders.join("\n")
        );
    }

    #[derive(Debug)]
    struct FakeManageOpenClawProvider {
        host_endpoints: Vec<HostEndpointRecord>,
        runtime: OpenClawRuntimeProjection,
        gateway: OpenClawGatewayProjection,
    }

    impl ManageOpenClawProvider for FakeManageOpenClawProvider {
        fn list_host_endpoints(&self, _updated_at: u64) -> Result<Vec<HostEndpointRecord>, String> {
            Ok(self.host_endpoints.clone())
        }

        fn get_runtime(&self, _updated_at: u64) -> Result<OpenClawRuntimeProjection, String> {
            Ok(self.runtime.clone())
        }

        fn get_gateway(&self, _updated_at: u64) -> Result<OpenClawGatewayProjection, String> {
            Ok(self.gateway.clone())
        }

        fn gateway_invoke_is_available(&self, _updated_at: u64) -> bool {
            self.gateway.lifecycle == "ready"
        }

        fn gateway_proxy_target(&self, _updated_at: u64) -> Option<PublishedProxyTarget> {
            if self.gateway.lifecycle != "ready" {
                return None;
            }

            self.gateway
                .base_url
                .clone()
                .map(|base_url| PublishedProxyTarget {
                    id: "openclaw-gateway",
                    base_url,
                    auth_token: None,
                })
        }

        fn invoke_gateway(
            &self,
            request: OpenClawGatewayInvokeRequest,
            updated_at: u64,
        ) -> Result<Value, String> {
            if self.gateway.lifecycle != "ready" {
                return Err("openclaw gateway is not ready".to_string());
            }

            Ok(json!({
                "tool": request.tool,
                "action": request.action,
                "args": request.args,
                "dryRun": request.dry_run,
                "updatedAt": updated_at,
            }))
        }
    }

    #[tokio::test]
    async fn health_route_returns_ok() {
        let app = build_router(build_server_state_with_rollout_data_dir(
            create_test_rollout_data_dir("health"),
        ));
        let response = app
            .oneshot(
                Request::get("/claw/health/live")
                    .body(Body::empty())
                    .expect("health request should build"),
            )
            .await
            .expect("health request should succeed");

        assert_eq!(response.status(), StatusCode::OK);
    }

    #[tokio::test]
    async fn health_ready_route_returns_service_unavailable_without_a_ready_runtime() {
        let provider = build_control_plane_manage_openclaw_provider(Arc::new(
            OpenClawControlPlane::inactive("agentstudio-server"),
        ));
        let app = build_router(build_server_state_with_overrides(
            create_test_rollout_data_dir("health-ready-inactive"),
            ServerStateOverrides {
                manage_openclaw_provider: Some(provider),
                ..ServerStateOverrides::default()
            },
        ));
        let response = app
            .oneshot(
                Request::get("/claw/health/ready")
                    .body(Body::empty())
                    .expect("health ready request should build"),
            )
            .await
            .expect("health ready request should succeed");

        assert_eq!(response.status(), StatusCode::SERVICE_UNAVAILABLE);
    }

    #[tokio::test]
    async fn health_ready_route_returns_ok_for_default_server_state() {
        let app = build_router(build_server_state_with_rollout_data_dir(
            create_test_rollout_data_dir("health-ready-default-server"),
        ));
        let response = app
            .oneshot(
                Request::get("/claw/health/ready")
                    .body(Body::empty())
                    .expect("health ready request should build"),
            )
            .await
            .expect("health ready request should succeed");

        assert_eq!(response.status(), StatusCode::OK);
    }

    #[tokio::test]
    async fn health_ready_route_returns_ok_when_runtime_and_gateway_are_ready() {
        let provider = ManageOpenClawProviderHandle::new(Arc::new(FakeManageOpenClawProvider {
            host_endpoints: vec![HostEndpointRecord {
                endpoint_id: "openclaw-gateway".to_string(),
                bind_host: "127.0.0.1".to_string(),
                requested_port: 18_871,
                active_port: Some(18_871),
                scheme: "http".to_string(),
                base_url: Some("http://127.0.0.1:18871".to_string()),
                websocket_url: Some("ws://127.0.0.1:18871".to_string()),
                loopback_only: true,
                dynamic_port: false,
                last_conflict_at: None,
                last_conflict_reason: None,
            }],
            runtime: OpenClawRuntimeProjection {
                runtime_kind: "openclaw".to_string(),
                lifecycle: "ready".to_string(),
                endpoint_id: Some("openclaw-gateway".to_string()),
                requested_port: Some(18_871),
                active_port: Some(18_871),
                base_url: Some("http://127.0.0.1:18871".to_string()),
                websocket_url: Some("ws://127.0.0.1:18871".to_string()),
                managed_by: "agentstudio-server".to_string(),
                updated_at: 123,
            },
            gateway: OpenClawGatewayProjection {
                gateway_kind: "openclawGateway".to_string(),
                lifecycle: "ready".to_string(),
                endpoint_id: Some("openclaw-gateway".to_string()),
                requested_port: Some(18_871),
                active_port: Some(18_871),
                base_url: Some("http://127.0.0.1:18871".to_string()),
                websocket_url: Some("ws://127.0.0.1:18871".to_string()),
                managed_by: "agentstudio-server".to_string(),
                updated_at: 123,
            },
        }));
        let app = build_router(build_server_state_with_overrides(
            create_test_rollout_data_dir("health-ready-live"),
            ServerStateOverrides {
                manage_openclaw_provider: Some(provider),
                ..ServerStateOverrides::default()
            },
        ));
        let response = app
            .oneshot(
                Request::get("/claw/health/ready")
                    .body(Body::empty())
                    .expect("health ready request should build"),
            )
            .await
            .expect("health ready request should succeed");

        assert_eq!(response.status(), StatusCode::OK);
    }

    #[tokio::test]
    async fn manage_rollout_list_route_returns_seeded_rollouts() {
        let app = build_router(build_server_state_with_rollout_data_dir(
            create_test_rollout_data_dir("list"),
        ));
        let response = app
            .oneshot(
                Request::get("/claw/manage/v1/rollouts")
                    .body(Body::empty())
                    .expect("rollout list request should build"),
            )
            .await
            .expect("rollout list request should succeed");
        let status = response.status();
        let body = response_body_text(response).await;

        assert_eq!(status, StatusCode::OK);
        assert!(body.contains("\"rollout-a\""));
    }

    #[tokio::test]
    async fn manage_rollout_preview_and_start_routes_return_live_records() {
        let app = build_router(build_server_state_with_rollout_data_dir(
            create_test_rollout_data_dir("preview-start"),
        ));

        let preview_response = app
            .clone()
            .oneshot(
                Request::post("/claw/manage/v1/rollouts/rollout-a:preview")
                    .header("content-type", "application/json")
                    .body(Body::from(
                        r#"{"includeTargets":true,"forceRecompute":false}"#,
                    ))
                    .expect("rollout preview request should build"),
            )
            .await
            .expect("rollout preview request should succeed");
        let preview_status = preview_response.status();
        let preview_body = response_body_text(preview_response).await;

        assert_eq!(preview_status, StatusCode::OK);
        assert!(preview_body.contains("\"rolloutId\":\"rollout-a\""));
        assert!(preview_body.contains("\"phase\":\"ready\""));

        let start_response = app
            .oneshot(
                Request::post("/claw/manage/v1/rollouts/rollout-a:start")
                    .body(Body::empty())
                    .expect("rollout start request should build"),
            )
            .await
            .expect("rollout start request should succeed");
        let start_status = start_response.status();
        let start_body = response_body_text(start_response).await;

        assert_eq!(start_status, StatusCode::OK);
        assert!(start_body.contains("\"id\":\"rollout-a\""));
        assert!(start_body.contains("\"phase\":\"promoting\""));
    }

    #[tokio::test]
    async fn manage_rollout_item_route_returns_requested_rollout() {
        let app = build_router(build_server_state_with_rollout_data_dir(
            create_test_rollout_data_dir("rollout-item"),
        ));
        let response = app
            .oneshot(
                Request::get("/claw/manage/v1/rollouts/rollout-a")
                    .body(Body::empty())
                    .expect("rollout item request should build"),
            )
            .await
            .expect("rollout item request should succeed");
        let status = response.status();
        let body = response_body_json(response).await;

        assert_eq!(status, StatusCode::OK);
        assert_eq!(body.get("id").and_then(Value::as_str), Some("rollout-a"));
        assert_eq!(body.get("phase").and_then(Value::as_str), Some("draft"));
        assert_eq!(body.get("targetCount").and_then(Value::as_u64), Some(2));
    }

    #[tokio::test]
    async fn manage_rollout_targets_route_returns_preview_targets() {
        let app = build_router(build_server_state_with_rollout_data_dir(
            create_test_rollout_data_dir("rollout-targets"),
        ));
        let response = app
            .oneshot(
                Request::get("/claw/manage/v1/rollouts/rollout-a/targets")
                    .body(Body::empty())
                    .expect("rollout targets request should build"),
            )
            .await
            .expect("rollout targets request should succeed");
        let status = response.status();
        let body = response_body_json(response).await;
        let items = body
            .get("items")
            .and_then(Value::as_array)
            .expect("rollout targets response should include items");

        assert_eq!(status, StatusCode::OK);
        assert_eq!(
            body.get("rolloutId").and_then(Value::as_str),
            Some("rollout-a")
        );
        assert_eq!(body.get("total").and_then(Value::as_u64), Some(2));
        assert!(items.iter().any(|item| {
            item.get("nodeId").and_then(Value::as_str) == Some("managed-openclaw-primary")
                && item.get("preflightOutcome").and_then(Value::as_str) == Some("admissible")
                && item
                    .get("desiredStateRevision")
                    .and_then(Value::as_u64)
                    .is_some()
                && item
                    .get("desiredStateHash")
                    .and_then(Value::as_str)
                    .is_some()
        }));
    }

    #[tokio::test]
    async fn manage_rollout_target_item_route_returns_requested_target() {
        let app = build_router(build_server_state_with_rollout_data_dir(
            create_test_rollout_data_dir("rollout-target-item"),
        ));
        let response = app
            .oneshot(
                Request::get("/claw/manage/v1/rollouts/rollout-a/targets/managed-openclaw-primary")
                    .body(Body::empty())
                    .expect("rollout target item request should build"),
            )
            .await
            .expect("rollout target item request should succeed");
        let status = response.status();
        let body = response_body_json(response).await;

        assert_eq!(status, StatusCode::OK);
        assert_eq!(
            body.get("nodeId").and_then(Value::as_str),
            Some("managed-openclaw-primary")
        );
        assert_eq!(
            body.get("preflightOutcome").and_then(Value::as_str),
            Some("admissible")
        );
        assert!(body
            .get("desiredStateRevision")
            .and_then(Value::as_u64)
            .is_some());
        assert!(body
            .get("desiredStateHash")
            .and_then(Value::as_str)
            .is_some());
    }

    #[tokio::test]
    async fn manage_rollout_waves_route_returns_grouped_wave_summary() {
        let app = build_router(build_server_state_with_rollout_data_dir(
            create_test_rollout_data_dir("rollout-waves"),
        ));
        let response = app
            .oneshot(
                Request::get("/claw/manage/v1/rollouts/rollout-b/waves")
                    .body(Body::empty())
                    .expect("rollout waves request should build"),
            )
            .await
            .expect("rollout waves request should succeed");
        let status = response.status();
        let body = response_body_json(response).await;
        let items = body
            .get("items")
            .and_then(Value::as_array)
            .expect("rollout waves response should include items");

        assert_eq!(status, StatusCode::OK);
        assert_eq!(
            body.get("rolloutId").and_then(Value::as_str),
            Some("rollout-b")
        );
        assert_eq!(body.get("total").and_then(Value::as_u64), Some(2));
        assert_eq!(items.len(), 2);
        assert_eq!(
            items[0].get("waveId").and_then(Value::as_str),
            Some("wave-1")
        );
        assert_eq!(items[0].get("index").and_then(Value::as_u64), Some(1));
        assert_eq!(
            items[0].get("phase").and_then(Value::as_str),
            Some("failed")
        );
        assert_eq!(items[0].get("targetCount").and_then(Value::as_u64), Some(1));
        assert_eq!(
            items[0].get("blockedCount").and_then(Value::as_u64),
            Some(1)
        );
        assert_eq!(
            items[1].get("waveId").and_then(Value::as_str),
            Some("wave-2")
        );
        assert_eq!(items[1].get("index").and_then(Value::as_u64), Some(2));
        assert_eq!(
            items[1].get("phase").and_then(Value::as_str),
            Some("failed")
        );
        assert_eq!(items[1].get("targetCount").and_then(Value::as_u64), Some(1));
        assert_eq!(
            items[1].get("blockedCount").and_then(Value::as_u64),
            Some(1)
        );
    }

    #[tokio::test]
    async fn manage_rollout_missing_route_returns_error_envelope() {
        let app = build_router(build_server_state_with_rollout_data_dir(
            create_test_rollout_data_dir("rollout-missing-envelope"),
        ));
        let response = app
            .oneshot(
                Request::get("/claw/manage/v1/rollouts/rollout-missing")
                    .body(Body::empty())
                    .expect("missing rollout request should build"),
            )
            .await
            .expect("missing rollout request should return a response");
        let status = response.status();
        let correlation_id = response
            .headers()
            .get("x-claw-correlation-id")
            .and_then(|value| value.to_str().ok())
            .map(str::to_string)
            .expect("missing rollout response should include x-claw-correlation-id");
        let body = response_body_json(response).await;
        let error = body
            .get("error")
            .and_then(Value::as_object)
            .expect("missing rollout response should include an error envelope");

        assert_eq!(status, StatusCode::NOT_FOUND);
        assert_eq!(
            error.get("code").and_then(Value::as_str),
            Some("rollout_not_found")
        );
        assert_eq!(error.get("category").and_then(Value::as_str), Some("state"));
        assert_eq!(error.get("httpStatus").and_then(Value::as_u64), Some(404));
        assert_eq!(
            error.get("resolution").and_then(Value::as_str),
            Some("fix_request")
        );
        assert_eq!(
            error.get("correlationId").and_then(Value::as_str),
            Some(correlation_id.as_str())
        );
    }

    #[tokio::test]
    async fn manage_rollout_preview_invalid_body_returns_error_envelope() {
        let app = build_router(build_server_state_with_rollout_data_dir(
            create_test_rollout_data_dir("rollout-preview-invalid-body-envelope"),
        ));
        let response = app
            .oneshot(
                Request::post("/claw/manage/v1/rollouts/rollout-a:preview")
                    .header("content-type", "application/json")
                    .body(Body::from("{"))
                    .expect("invalid preview request should build"),
            )
            .await
            .expect("invalid preview request should return a response");
        let status = response.status();
        let correlation_id = response
            .headers()
            .get("x-claw-correlation-id")
            .and_then(|value| value.to_str().ok())
            .map(str::to_string)
            .expect("invalid preview response should include x-claw-correlation-id");
        let body = response_body_json(response).await;
        let error = body
            .get("error")
            .and_then(Value::as_object)
            .expect("invalid preview response should include an error envelope");

        assert_eq!(status, StatusCode::BAD_REQUEST);
        assert_eq!(
            error.get("code").and_then(Value::as_str),
            Some("invalid_body")
        );
        assert_eq!(
            error.get("category").and_then(Value::as_str),
            Some("validation")
        );
        assert_eq!(error.get("httpStatus").and_then(Value::as_u64), Some(400));
        assert_eq!(
            error.get("correlationId").and_then(Value::as_str),
            Some(correlation_id.as_str())
        );
    }

    #[tokio::test]
    async fn manage_routes_require_basic_auth_when_credentials_are_configured() {
        let app = build_router(build_server_state_with_overrides(
            create_test_rollout_data_dir("manage-auth"),
            ServerStateOverrides {
                auth: Some(ServerAuthConfig {
                    manage: Some(BasicAuthCredentials {
                        username: "operator".to_string(),
                        password: "manage-secret".to_string(),
                    }),
                    internal: Some(BasicAuthCredentials {
                        username: "operator".to_string(),
                        password: "manage-secret".to_string(),
                    }),
                    browser_session_token: None,
                }),
                ..ServerStateOverrides::default()
            },
        ));

        let unauthorized_response = app
            .clone()
            .oneshot(
                Request::get("/claw/manage/v1/rollouts")
                    .body(Body::empty())
                    .expect("unauthorized manage request should build"),
            )
            .await
            .expect("unauthorized manage request should return a response");
        let unauthorized_status = unauthorized_response.status();
        let unauthorized_challenge = unauthorized_response
            .headers()
            .get(header::WWW_AUTHENTICATE)
            .and_then(|value| value.to_str().ok())
            .map(str::to_string);

        let authorized_response = app
            .oneshot(
                Request::get("/claw/manage/v1/rollouts")
                    .header(
                        header::AUTHORIZATION,
                        basic_auth_header_value("operator", "manage-secret"),
                    )
                    .body(Body::empty())
                    .expect("authorized manage request should build"),
            )
            .await
            .expect("authorized manage request should succeed");
        let authorized_status = authorized_response.status();

        assert_eq!(unauthorized_status, StatusCode::UNAUTHORIZED);
        assert_eq!(
            unauthorized_challenge.as_deref(),
            Some("Basic realm=\"claw-manage\"")
        );
        assert_eq!(authorized_status, StatusCode::OK);
    }

    #[tokio::test]
    async fn desktop_combined_manage_routes_require_browser_session_token_when_configured() {
        let mut state = build_server_state_with_overrides(
            create_test_rollout_data_dir("manage-browser-session-auth"),
            ServerStateOverrides {
                auth: Some(ServerAuthConfig {
                    manage: None,
                    internal: None,
                    browser_session_token: Some("desktop-session-token".to_string()),
                }),
                ..ServerStateOverrides::default()
            },
        );
        state.set_mode("desktopCombined");
        let app = build_router(state);

        let unauthorized_response = app
            .clone()
            .oneshot(
                Request::get("/claw/manage/v1/rollouts")
                    .body(Body::empty())
                    .expect("unauthorized browser-session manage request should build"),
            )
            .await
            .expect("unauthorized browser-session manage request should return a response");
        let unauthorized_status = unauthorized_response.status();
        let unauthorized_challenge = unauthorized_response
            .headers()
            .get(header::WWW_AUTHENTICATE)
            .and_then(|value| value.to_str().ok())
            .map(str::to_string);

        let authorized_response = app
            .oneshot(
                Request::get("/claw/manage/v1/rollouts")
                    .header("x-claw-browser-session", "desktop-session-token")
                    .body(Body::empty())
                    .expect("authorized browser-session manage request should build"),
            )
            .await
            .expect("authorized browser-session manage request should succeed");
        let authorized_status = authorized_response.status();

        assert_eq!(unauthorized_status, StatusCode::UNAUTHORIZED);
        assert_eq!(
            unauthorized_challenge.as_deref(),
            Some("Bearer realm=\"claw-browser-session\"")
        );
        assert_eq!(authorized_status, StatusCode::OK);
    }

    #[tokio::test]
    async fn manage_service_route_returns_status_from_service_control_plane() {
        let requests = Arc::new(Mutex::new(Vec::<
            crate::service::ServerServiceLifecycleRequest,
        >::new()));
        let app = build_router(build_server_state_with_overrides(
            create_test_rollout_data_dir("manage-service-status"),
            ServerStateOverrides {
                effective_config_path: Some(PathBuf::from("D:/managed/config.json")),
                executable_path: Some(PathBuf::from("D:/managed/agentstudio-server.exe")),
                service_control_plane: Some(
                    crate::service::ServerServiceControlPlaneHandle::with_backend(Arc::new(
                        FakeServerServiceControlPlane::new(
                            requests.clone(),
                            vec![fake_service_execution_result("status", "inactive", false)],
                        ),
                    )),
                ),
                ..ServerStateOverrides::default()
            },
        ));

        let response = app
            .oneshot(
                Request::get("/claw/manage/v1/service")
                    .body(Body::empty())
                    .expect("manage service status request should build"),
            )
            .await
            .expect("manage service status request should succeed");
        let status = response.status();
        let body = response_body_json(response).await;
        let requests = requests
            .lock()
            .expect("fake service controller requests should lock");

        assert_eq!(status, StatusCode::OK);
        assert_eq!(body.get("action").and_then(Value::as_str), Some("status"));
        assert_eq!(body.get("state").and_then(Value::as_str), Some("inactive"));
        assert_eq!(
            body.get("serviceManager").and_then(Value::as_str),
            Some("windowsService")
        );
        assert_eq!(
            body.get("executablePath").and_then(Value::as_str),
            Some("D:/managed/agentstudio-server.exe")
        );
        assert_eq!(
            body.get("runtimeConfig")
                .and_then(Value::as_object)
                .and_then(|runtime| runtime.get("port"))
                .and_then(Value::as_u64),
            Some(18_797)
        );
        assert_eq!(requests.len(), 1);
        assert_eq!(
            requests[0].action,
            crate::service::ServerServiceLifecycleAction::Status
        );
        assert_eq!(
            requests[0].config_path,
            PathBuf::from("D:/managed/config.json")
        );
        assert_eq!(
            requests[0].executable_path,
            PathBuf::from("D:/managed/agentstudio-server.exe")
        );
    }

    #[tokio::test]
    async fn manage_service_route_start_delegates_to_service_control_plane() {
        let requests = Arc::new(Mutex::new(Vec::<
            crate::service::ServerServiceLifecycleRequest,
        >::new()));
        let app = build_router(build_server_state_with_overrides(
            create_test_rollout_data_dir("manage-service-start"),
            ServerStateOverrides {
                effective_config_path: Some(PathBuf::from("D:/managed/config.json")),
                executable_path: Some(PathBuf::from("D:/managed/agentstudio-server.exe")),
                service_control_plane: Some(
                    crate::service::ServerServiceControlPlaneHandle::with_backend(Arc::new(
                        FakeServerServiceControlPlane::new(
                            requests.clone(),
                            vec![fake_service_execution_result("start", "started", true)],
                        ),
                    )),
                ),
                ..ServerStateOverrides::default()
            },
        ));

        let response = app
            .oneshot(
                Request::post("/claw/manage/v1/service:start")
                    .body(Body::empty())
                    .expect("manage service start request should build"),
            )
            .await
            .expect("manage service start request should succeed");
        let status = response.status();
        let body = response_body_json(response).await;
        let requests = requests
            .lock()
            .expect("fake service controller requests should lock");

        assert_eq!(status, StatusCode::OK);
        assert_eq!(body.get("action").and_then(Value::as_str), Some("start"));
        assert_eq!(body.get("state").and_then(Value::as_str), Some("started"));
        assert_eq!(requests.len(), 1);
        assert_eq!(
            requests[0].action,
            crate::service::ServerServiceLifecycleAction::Start
        );
    }

    #[tokio::test]
    async fn manage_service_route_install_delegates_to_service_control_plane() {
        let requests = Arc::new(Mutex::new(Vec::<
            crate::service::ServerServiceLifecycleRequest,
        >::new()));
        let app = build_router(build_server_state_with_overrides(
            create_test_rollout_data_dir("manage-service-install"),
            ServerStateOverrides {
                service_control_plane: Some(
                    crate::service::ServerServiceControlPlaneHandle::with_backend(Arc::new(
                        FakeServerServiceControlPlane::new(
                            requests.clone(),
                            vec![fake_service_execution_result("install", "installed", true)],
                        ),
                    )),
                ),
                ..ServerStateOverrides::default()
            },
        ));

        let response = app
            .oneshot(
                Request::post("/claw/manage/v1/service:install")
                    .body(Body::empty())
                    .expect("manage service install request should build"),
            )
            .await
            .expect("manage service install request should succeed");
        let status = response.status();
        let body = response_body_json(response).await;
        let requests = requests
            .lock()
            .expect("fake service controller requests should lock");

        assert_eq!(status, StatusCode::OK);
        assert_eq!(body.get("action").and_then(Value::as_str), Some("install"));
        assert_eq!(body.get("state").and_then(Value::as_str), Some("installed"));
        assert_eq!(requests.len(), 1);
        assert_eq!(
            requests[0].action,
            crate::service::ServerServiceLifecycleAction::Install
        );
    }

    #[tokio::test]
    async fn manage_service_route_stop_delegates_to_service_control_plane() {
        let requests = Arc::new(Mutex::new(Vec::<
            crate::service::ServerServiceLifecycleRequest,
        >::new()));
        let app = build_router(build_server_state_with_overrides(
            create_test_rollout_data_dir("manage-service-stop"),
            ServerStateOverrides {
                service_control_plane: Some(
                    crate::service::ServerServiceControlPlaneHandle::with_backend(Arc::new(
                        FakeServerServiceControlPlane::new(
                            requests.clone(),
                            vec![fake_service_execution_result("stop", "stopped", true)],
                        ),
                    )),
                ),
                ..ServerStateOverrides::default()
            },
        ));

        let response = app
            .oneshot(
                Request::post("/claw/manage/v1/service:stop")
                    .body(Body::empty())
                    .expect("manage service stop request should build"),
            )
            .await
            .expect("manage service stop request should succeed");
        let status = response.status();
        let body = response_body_json(response).await;
        let requests = requests
            .lock()
            .expect("fake service controller requests should lock");

        assert_eq!(status, StatusCode::OK);
        assert_eq!(body.get("action").and_then(Value::as_str), Some("stop"));
        assert_eq!(body.get("state").and_then(Value::as_str), Some("stopped"));
        assert_eq!(requests.len(), 1);
        assert_eq!(
            requests[0].action,
            crate::service::ServerServiceLifecycleAction::Stop
        );
    }

    #[tokio::test]
    async fn manage_service_route_restart_delegates_to_service_control_plane() {
        let requests = Arc::new(Mutex::new(Vec::<
            crate::service::ServerServiceLifecycleRequest,
        >::new()));
        let app = build_router(build_server_state_with_overrides(
            create_test_rollout_data_dir("manage-service-restart"),
            ServerStateOverrides {
                service_control_plane: Some(
                    crate::service::ServerServiceControlPlaneHandle::with_backend(Arc::new(
                        FakeServerServiceControlPlane::new(
                            requests.clone(),
                            vec![fake_service_execution_result("restart", "restarted", true)],
                        ),
                    )),
                ),
                ..ServerStateOverrides::default()
            },
        ));

        let response = app
            .oneshot(
                Request::post("/claw/manage/v1/service:restart")
                    .body(Body::empty())
                    .expect("manage service restart request should build"),
            )
            .await
            .expect("manage service restart request should succeed");
        let status = response.status();
        let body = response_body_json(response).await;
        let requests = requests
            .lock()
            .expect("fake service controller requests should lock");

        assert_eq!(status, StatusCode::OK);
        assert_eq!(body.get("action").and_then(Value::as_str), Some("restart"));
        assert_eq!(body.get("state").and_then(Value::as_str), Some("restarted"));
        assert_eq!(requests.len(), 1);
        assert_eq!(
            requests[0].action,
            crate::service::ServerServiceLifecycleAction::Restart
        );
    }

    #[tokio::test]
    async fn manage_service_routes_require_basic_auth_when_credentials_are_configured() {
        let requests = Arc::new(Mutex::new(Vec::<
            crate::service::ServerServiceLifecycleRequest,
        >::new()));
        let app = build_router(build_server_state_with_overrides(
            create_test_rollout_data_dir("manage-service-auth"),
            ServerStateOverrides {
                auth: Some(ServerAuthConfig {
                    manage: Some(BasicAuthCredentials {
                        username: "operator".to_string(),
                        password: "manage-secret".to_string(),
                    }),
                    internal: Some(BasicAuthCredentials {
                        username: "operator".to_string(),
                        password: "manage-secret".to_string(),
                    }),
                    browser_session_token: None,
                }),
                service_control_plane: Some(
                    crate::service::ServerServiceControlPlaneHandle::with_backend(Arc::new(
                        FakeServerServiceControlPlane::new(
                            requests.clone(),
                            vec![fake_service_execution_result("status", "inactive", false)],
                        ),
                    )),
                ),
                ..ServerStateOverrides::default()
            },
        ));

        let unauthorized_response = app
            .clone()
            .oneshot(
                Request::get("/claw/manage/v1/service")
                    .body(Body::empty())
                    .expect("unauthorized manage service request should build"),
            )
            .await
            .expect("unauthorized manage service request should return a response");
        let unauthorized_status = unauthorized_response.status();

        let authorized_response = app
            .oneshot(
                Request::get("/claw/manage/v1/service")
                    .header(
                        header::AUTHORIZATION,
                        basic_auth_header_value("operator", "manage-secret"),
                    )
                    .body(Body::empty())
                    .expect("authorized manage service request should build"),
            )
            .await
            .expect("authorized manage service request should succeed");
        let authorized_status = authorized_response.status();

        assert_eq!(unauthorized_status, StatusCode::UNAUTHORIZED);
        assert_eq!(authorized_status, StatusCode::OK);
    }

    #[tokio::test]
    async fn desktop_combined_mode_does_not_expose_manage_service_routes() {
        let requests = Arc::new(Mutex::new(Vec::<
            crate::service::ServerServiceLifecycleRequest,
        >::new()));
        let mut state = build_server_state_with_overrides(
            create_test_rollout_data_dir("desktop-combined-manage-service-hidden"),
            ServerStateOverrides {
                service_control_plane: Some(
                    crate::service::ServerServiceControlPlaneHandle::with_backend(Arc::new(
                        FakeServerServiceControlPlane::new(
                            requests.clone(),
                            vec![fake_service_execution_result("status", "inactive", false)],
                        ),
                    )),
                ),
                ..ServerStateOverrides::default()
            },
        );
        state.set_mode("desktopCombined");
        let app = build_router(state);

        let response = app
            .oneshot(
                Request::get("/claw/manage/v1/service")
                    .body(Body::empty())
                    .expect("desktop combined manage service request should build"),
            )
            .await
            .expect("desktop combined manage service request should return a response");
        let status = response.status();
        let requests = requests
            .lock()
            .expect("fake service controller requests should lock");

        assert_eq!(status, StatusCode::NOT_FOUND);
        assert!(requests.is_empty());
    }

    #[tokio::test]
    async fn manage_host_endpoints_route_returns_canonical_server_endpoint_records() {
        let app = build_router(build_server_state_with_overrides(
            create_test_rollout_data_dir("manage-host-endpoints"),
            ServerStateOverrides {
                host: Some("127.0.0.1".to_string()),
                port: Some(18_797),
                ..ServerStateOverrides::default()
            },
        ));

        let response = app
            .oneshot(
                Request::get("/claw/manage/v1/host-endpoints")
                    .body(Body::empty())
                    .expect("host endpoints request should build"),
            )
            .await
            .expect("host endpoints request should succeed");
        let status = response.status();
        let body = response_body_json(response).await;
        let items = body
            .as_array()
            .expect("host endpoints response should be an array");

        assert_eq!(status, StatusCode::OK);
        assert_eq!(items.len(), 1);
        assert_eq!(
            items[0].get("endpointId").and_then(Value::as_str),
            Some("claw-manage-http")
        );
        assert_eq!(
            items[0].get("requestedPort").and_then(Value::as_u64),
            Some(18_797)
        );
        assert_eq!(
            items[0].get("activePort").and_then(Value::as_u64),
            Some(18_797)
        );
        assert_eq!(
            items[0].get("baseUrl").and_then(Value::as_str),
            Some("http://127.0.0.1:18797")
        );
    }

    #[tokio::test]
    async fn manage_openclaw_routes_return_canonical_inactive_projections() {
        let app = build_router(build_server_state_with_overrides(
            create_test_rollout_data_dir("manage-openclaw-routes"),
            ServerStateOverrides::default(),
        ));

        let runtime_response = app
            .clone()
            .oneshot(
                Request::get("/claw/manage/v1/openclaw/runtime")
                    .body(Body::empty())
                    .expect("openclaw runtime request should build"),
            )
            .await
            .expect("openclaw runtime request should succeed");
        let runtime_status = runtime_response.status();
        let runtime_body = response_body_json(runtime_response).await;

        assert_eq!(runtime_status, StatusCode::OK);
        assert_eq!(
            runtime_body.get("runtimeKind").and_then(Value::as_str),
            Some("openclaw")
        );
        assert_eq!(
            runtime_body.get("lifecycle").and_then(Value::as_str),
            Some("inactive")
        );
        assert!(
            runtime_body.get("endpointId").is_none()
                || runtime_body.get("endpointId") == Some(&Value::Null)
        );

        let gateway_response = app
            .clone()
            .oneshot(
                Request::get("/claw/manage/v1/openclaw/gateway")
                    .body(Body::empty())
                    .expect("openclaw gateway request should build"),
            )
            .await
            .expect("openclaw gateway request should succeed");
        let gateway_status = gateway_response.status();
        let gateway_body = response_body_json(gateway_response).await;

        assert_eq!(gateway_status, StatusCode::OK);
        assert_eq!(
            gateway_body.get("gatewayKind").and_then(Value::as_str),
            Some("openclawGateway")
        );
        assert_eq!(
            gateway_body.get("lifecycle").and_then(Value::as_str),
            Some("inactive")
        );

        let invoke_response = app
            .oneshot(
                Request::post("/claw/manage/v1/openclaw/gateway/invoke")
                    .header("content-type", "application/json")
                    .body(Body::from(r#"{"tool":"gateway"}"#))
                    .expect("openclaw gateway invoke request should build"),
            )
            .await
            .expect("openclaw gateway invoke request should return a response");
        let invoke_status = invoke_response.status();
        let invoke_body = response_body_json(invoke_response).await;
        let invoke_error = invoke_body
            .get("error")
            .and_then(Value::as_object)
            .expect("inactive gateway invoke should return an error envelope");

        assert_eq!(invoke_status, StatusCode::SERVICE_UNAVAILABLE);
        assert_eq!(
            invoke_error.get("code").and_then(Value::as_str),
            Some("openclaw_gateway_unavailable")
        );
    }

    #[tokio::test]
    async fn manage_openclaw_runtime_route_keeps_updated_at_stable_across_unchanged_reads() {
        let app = build_router(build_server_state_with_overrides(
            create_test_rollout_data_dir("manage-openclaw-runtime-stable-updated-at"),
            ServerStateOverrides::default(),
        ));
        let first_response = app
            .clone()
            .oneshot(
                Request::get("/claw/manage/v1/openclaw/runtime")
                    .body(Body::empty())
                    .expect("openclaw runtime request should build"),
            )
            .await
            .expect("openclaw runtime request should succeed");
        let first_status = first_response.status();
        let first_body = response_body_json(first_response).await;
        let first_updated_at = first_body
            .get("updatedAt")
            .and_then(Value::as_u64)
            .expect("openclaw runtime response should include updatedAt");

        std::thread::sleep(Duration::from_millis(5));

        let second_response = app
            .oneshot(
                Request::get("/claw/manage/v1/openclaw/runtime")
                    .body(Body::empty())
                    .expect("openclaw runtime request should build"),
            )
            .await
            .expect("openclaw runtime request should succeed");
        let second_status = second_response.status();
        let second_body = response_body_json(second_response).await;
        let second_updated_at = second_body
            .get("updatedAt")
            .and_then(Value::as_u64)
            .expect("openclaw runtime response should include updatedAt");

        assert_eq!(first_status, StatusCode::OK);
        assert_eq!(second_status, StatusCode::OK);
        assert_eq!(first_updated_at, second_updated_at);
    }

    #[tokio::test]
    async fn desktop_combined_manage_openclaw_host_endpoints_route_prefers_configured_provider() {
        let provider = ManageOpenClawProviderHandle::new(Arc::new(FakeManageOpenClawProvider {
            host_endpoints: vec![
                HostEndpointRecord {
                    endpoint_id: "claw-manage-http".to_string(),
                    bind_host: "127.0.0.1".to_string(),
                    requested_port: 18_797,
                    active_port: Some(18_797),
                    scheme: "http".to_string(),
                    base_url: Some("http://127.0.0.1:18797".to_string()),
                    websocket_url: None,
                    loopback_only: true,
                    dynamic_port: false,
                    last_conflict_at: None,
                    last_conflict_reason: None,
                },
                HostEndpointRecord {
                    endpoint_id: "openclaw-gateway".to_string(),
                    bind_host: "127.0.0.1".to_string(),
                    requested_port: 18_871,
                    active_port: Some(18_871),
                    scheme: "http".to_string(),
                    base_url: Some("http://127.0.0.1:18871".to_string()),
                    websocket_url: Some("ws://127.0.0.1:18871".to_string()),
                    loopback_only: true,
                    dynamic_port: false,
                    last_conflict_at: None,
                    last_conflict_reason: None,
                },
            ],
            runtime: OpenClawRuntimeProjection {
                runtime_kind: "openclaw".to_string(),
                lifecycle: "ready".to_string(),
                endpoint_id: Some("openclaw-gateway".to_string()),
                requested_port: Some(18_871),
                active_port: Some(18_871),
                base_url: Some("http://127.0.0.1:18871".to_string()),
                websocket_url: Some("ws://127.0.0.1:18871".to_string()),
                managed_by: "desktopCombined".to_string(),
                updated_at: 123,
            },
            gateway: OpenClawGatewayProjection {
                gateway_kind: "openclawGateway".to_string(),
                lifecycle: "ready".to_string(),
                endpoint_id: Some("openclaw-gateway".to_string()),
                requested_port: Some(18_871),
                active_port: Some(18_871),
                base_url: Some("http://127.0.0.1:18871".to_string()),
                websocket_url: Some("ws://127.0.0.1:18871".to_string()),
                managed_by: "desktopCombined".to_string(),
                updated_at: 123,
            },
        }));
        let mut state = build_server_state_with_overrides(
            create_test_rollout_data_dir("desktop-combined-manage-provider-host-endpoints"),
            ServerStateOverrides {
                manage_openclaw_provider: Some(provider),
                ..ServerStateOverrides::default()
            },
        );
        state.set_mode("desktopCombined");
        let app = build_router(state);

        let response = app
            .oneshot(
                Request::get("/claw/manage/v1/host-endpoints")
                    .body(Body::empty())
                    .expect("desktop manage host endpoints request should build"),
            )
            .await
            .expect("desktop manage host endpoints request should succeed");
        let status = response.status();
        let body = response_body_json(response).await;
        let items = body
            .as_array()
            .expect("desktop manage host endpoints response should be an array");

        assert_eq!(status, StatusCode::OK);
        assert_eq!(items.len(), 2);
        assert!(items.iter().any(|item| {
            item.get("endpointId").and_then(Value::as_str) == Some("openclaw-gateway")
                && item.get("baseUrl").and_then(Value::as_str) == Some("http://127.0.0.1:18871")
                && item.get("websocketUrl").and_then(Value::as_str) == Some("ws://127.0.0.1:18871")
        }));
    }

    #[tokio::test]
    async fn desktop_combined_manage_openclaw_runtime_and_gateway_routes_prefer_configured_provider(
    ) {
        let provider = ManageOpenClawProviderHandle::new(Arc::new(FakeManageOpenClawProvider {
            host_endpoints: vec![HostEndpointRecord {
                endpoint_id: "openclaw-gateway".to_string(),
                bind_host: "127.0.0.1".to_string(),
                requested_port: 18_871,
                active_port: Some(18_871),
                scheme: "http".to_string(),
                base_url: Some("http://127.0.0.1:18871".to_string()),
                websocket_url: Some("ws://127.0.0.1:18871".to_string()),
                loopback_only: true,
                dynamic_port: false,
                last_conflict_at: None,
                last_conflict_reason: None,
            }],
            runtime: OpenClawRuntimeProjection {
                runtime_kind: "openclaw".to_string(),
                lifecycle: "ready".to_string(),
                endpoint_id: Some("openclaw-gateway".to_string()),
                requested_port: Some(18_871),
                active_port: Some(18_871),
                base_url: Some("http://127.0.0.1:18871".to_string()),
                websocket_url: Some("ws://127.0.0.1:18871".to_string()),
                managed_by: "desktopCombined".to_string(),
                updated_at: 123,
            },
            gateway: OpenClawGatewayProjection {
                gateway_kind: "openclawGateway".to_string(),
                lifecycle: "ready".to_string(),
                endpoint_id: Some("openclaw-gateway".to_string()),
                requested_port: Some(18_871),
                active_port: Some(18_871),
                base_url: Some("http://127.0.0.1:18871".to_string()),
                websocket_url: Some("ws://127.0.0.1:18871".to_string()),
                managed_by: "desktopCombined".to_string(),
                updated_at: 123,
            },
        }));
        let mut state = build_server_state_with_overrides(
            create_test_rollout_data_dir("desktop-combined-manage-provider-runtime"),
            ServerStateOverrides {
                manage_openclaw_provider: Some(provider),
                ..ServerStateOverrides::default()
            },
        );
        state.set_mode("desktopCombined");
        let app = build_router(state);

        let runtime_response = app
            .clone()
            .oneshot(
                Request::get("/claw/manage/v1/openclaw/runtime")
                    .body(Body::empty())
                    .expect("desktop openclaw runtime request should build"),
            )
            .await
            .expect("desktop openclaw runtime request should succeed");
        let runtime_status = runtime_response.status();
        let runtime_body = response_body_json(runtime_response).await;

        assert_eq!(runtime_status, StatusCode::OK);
        assert_eq!(
            runtime_body.get("lifecycle").and_then(Value::as_str),
            Some("ready")
        );
        assert_eq!(
            runtime_body.get("managedBy").and_then(Value::as_str),
            Some("desktopCombined")
        );
        assert_eq!(
            runtime_body.get("baseUrl").and_then(Value::as_str),
            Some("http://127.0.0.1:18871")
        );

        let gateway_response = app
            .oneshot(
                Request::get("/claw/manage/v1/openclaw/gateway")
                    .body(Body::empty())
                    .expect("desktop openclaw gateway request should build"),
            )
            .await
            .expect("desktop openclaw gateway request should succeed");
        let gateway_status = gateway_response.status();
        let gateway_body = response_body_json(gateway_response).await;

        assert_eq!(gateway_status, StatusCode::OK);
        assert_eq!(
            gateway_body.get("lifecycle").and_then(Value::as_str),
            Some("ready")
        );
        assert_eq!(
            gateway_body.get("managedBy").and_then(Value::as_str),
            Some("desktopCombined")
        );
        assert_eq!(
            gateway_body.get("websocketUrl").and_then(Value::as_str),
            Some("ws://127.0.0.1:18871")
        );
    }

    #[tokio::test]
    async fn desktop_combined_manage_openclaw_gateway_invoke_route_uses_configured_provider() {
        let provider = ManageOpenClawProviderHandle::new(Arc::new(FakeManageOpenClawProvider {
            host_endpoints: vec![HostEndpointRecord {
                endpoint_id: "openclaw-gateway".to_string(),
                bind_host: "127.0.0.1".to_string(),
                requested_port: 18_871,
                active_port: Some(18_871),
                scheme: "http".to_string(),
                base_url: Some("http://127.0.0.1:18871".to_string()),
                websocket_url: Some("ws://127.0.0.1:18871".to_string()),
                loopback_only: true,
                dynamic_port: false,
                last_conflict_at: None,
                last_conflict_reason: None,
            }],
            runtime: OpenClawRuntimeProjection {
                runtime_kind: "openclaw".to_string(),
                lifecycle: "ready".to_string(),
                endpoint_id: Some("openclaw-gateway".to_string()),
                requested_port: Some(18_871),
                active_port: Some(18_871),
                base_url: Some("http://127.0.0.1:18871".to_string()),
                websocket_url: Some("ws://127.0.0.1:18871".to_string()),
                managed_by: "desktopCombined".to_string(),
                updated_at: 123,
            },
            gateway: OpenClawGatewayProjection {
                gateway_kind: "openclawGateway".to_string(),
                lifecycle: "ready".to_string(),
                endpoint_id: Some("openclaw-gateway".to_string()),
                requested_port: Some(18_871),
                active_port: Some(18_871),
                base_url: Some("http://127.0.0.1:18871".to_string()),
                websocket_url: Some("ws://127.0.0.1:18871".to_string()),
                managed_by: "desktopCombined".to_string(),
                updated_at: 123,
            },
        }));
        let mut state = build_server_state_with_overrides(
            create_test_rollout_data_dir("desktop-combined-openclaw-gateway-invoke"),
            ServerStateOverrides {
                manage_openclaw_provider: Some(provider),
                ..ServerStateOverrides::default()
            },
        );
        state.set_mode("desktopCombined");
        let app = build_router(state);

        let response = app
            .oneshot(
                Request::post("/claw/manage/v1/openclaw/gateway/invoke")
                    .header("content-type", "application/json")
                    .body(Body::from(
                        r#"{"tool":"gateway","action":"describe","args":{"scope":"full"},"dryRun":false}"#,
                    ))
                    .expect("desktop openclaw gateway invoke request should build"),
            )
            .await
            .expect("desktop openclaw gateway invoke request should succeed");
        let status = response.status();
        let body = response_body_json(response).await;

        assert_eq!(status, StatusCode::OK);
        assert_eq!(body.get("tool").and_then(Value::as_str), Some("gateway"));
        assert_eq!(body.get("action").and_then(Value::as_str), Some("describe"));
        assert_eq!(
            body.pointer("/args/scope").and_then(Value::as_str),
            Some("full")
        );
        assert_eq!(body.get("dryRun").and_then(Value::as_bool), Some(false));
    }

    #[tokio::test]
    async fn browser_routes_require_basic_auth_when_manage_credentials_are_configured() {
        let web_dist_dir = create_test_web_dist_dir("browser-auth");
        fs::write(
            web_dist_dir.join("index.html"),
            "<html><head></head><body><div id=\"root\"></div></body></html>",
        )
        .expect("browser auth test index.html should be written");
        let app = build_router(build_server_state_with_overrides(
            create_test_rollout_data_dir("browser-auth"),
            ServerStateOverrides {
                auth: Some(ServerAuthConfig {
                    manage: Some(BasicAuthCredentials {
                        username: "operator".to_string(),
                        password: "manage-secret".to_string(),
                    }),
                    internal: Some(BasicAuthCredentials {
                        username: "operator".to_string(),
                        password: "manage-secret".to_string(),
                    }),
                    browser_session_token: None,
                }),
                web_dist_dir: Some(web_dist_dir),
                ..ServerStateOverrides::default()
            },
        ));

        let unauthorized_response = app
            .clone()
            .oneshot(
                Request::get("/")
                    .body(Body::empty())
                    .expect("unauthorized browser request should build"),
            )
            .await
            .expect("unauthorized browser request should return a response");
        let unauthorized_status = unauthorized_response.status();

        let authorized_response = app
            .oneshot(
                Request::get("/")
                    .header(
                        header::AUTHORIZATION,
                        basic_auth_header_value("operator", "manage-secret"),
                    )
                    .body(Body::empty())
                    .expect("authorized browser request should build"),
            )
            .await
            .expect("authorized browser request should succeed");
        let authorized_status = authorized_response.status();
        let authorized_body = response_body_text(authorized_response).await;

        assert_eq!(unauthorized_status, StatusCode::UNAUTHORIZED);
        assert_eq!(authorized_status, StatusCode::OK);
        assert!(authorized_body.contains("sdkwork-agentstudio-pc-host-mode"));
    }

    #[tokio::test]
    async fn unknown_claw_paths_do_not_fall_back_to_browser_index() {
        let web_dist_dir = create_test_web_dist_dir("browser-claw-404");
        fs::write(
            web_dist_dir.join("index.html"),
            "<html><head></head><body><div id=\"root\">browser shell</div></body></html>",
        )
        .expect("browser claw 404 test index.html should be written");
        let app = build_router(build_server_state_with_overrides(
            create_test_rollout_data_dir("browser-claw-404"),
            ServerStateOverrides {
                web_dist_dir: Some(web_dist_dir),
                ..ServerStateOverrides::default()
            },
        ));

        let response = app
            .oneshot(
                Request::get("/claw/unknown-route")
                    .body(Body::empty())
                    .expect("unknown claw request should build"),
            )
            .await
            .expect("unknown claw request should return a response");
        let status = response.status();
        let body = response_body_text(response).await;

        assert_eq!(status, StatusCode::NOT_FOUND);
        assert!(!body.contains("browser shell"));
    }

    #[tokio::test]
    async fn internal_host_platform_route_returns_server_status() {
        let app = build_router(build_server_state_with_rollout_data_dir(
            create_test_rollout_data_dir("host-platform"),
        ));
        let response = app
            .oneshot(
                Request::get("/claw/internal/v1/host-platform")
                    .body(Body::empty())
                    .expect("host platform request should build"),
            )
            .await
            .expect("host platform request should succeed");
        let status = response.status();
        let body = response_body_text(response).await;

        assert_eq!(status, StatusCode::OK);
        assert!(body.contains("\"mode\":\"server\""));
        assert!(body.contains("\"distributionFamily\":\"server\""));
        assert!(body.contains("\"deploymentFamily\":\"bareMetal\""));
        assert!(body.contains("\"manageBasePath\":\"/claw/manage/v1\""));
        assert!(body.contains("\"internalBasePath\":\"/claw/internal/v1\""));
        assert!(body.contains("\"stateStoreDriver\":\"sqlite\""));
        assert!(body.contains("\"activeProfileId\":\"default-sqlite\""));
        assert!(body.contains("\"providers\""));
        assert!(body.contains("\"profiles\""));
    }

    #[tokio::test]
    async fn internal_host_platform_route_keeps_updated_at_stable_across_unchanged_reads() {
        let app = build_router(build_server_state_with_rollout_data_dir(
            create_test_rollout_data_dir("host-platform-stable-updated-at"),
        ));
        let first_response = app
            .clone()
            .oneshot(
                Request::get("/claw/internal/v1/host-platform")
                    .body(Body::empty())
                    .expect("host platform request should build"),
            )
            .await
            .expect("host platform request should succeed");
        let first_status = first_response.status();
        let first_body = response_body_json(first_response).await;
        let first_updated_at = first_body
            .get("updatedAt")
            .and_then(Value::as_u64)
            .expect("host platform response should include updatedAt");

        std::thread::sleep(Duration::from_millis(5));

        let second_response = app
            .oneshot(
                Request::get("/claw/internal/v1/host-platform")
                    .body(Body::empty())
                    .expect("host platform request should build"),
            )
            .await
            .expect("host platform request should succeed");
        let second_status = second_response.status();
        let second_body = response_body_json(second_response).await;
        let second_updated_at = second_body
            .get("updatedAt")
            .and_then(Value::as_u64)
            .expect("host platform response should include updatedAt");

        assert_eq!(first_status, StatusCode::OK);
        assert_eq!(second_status, StatusCode::OK);
        assert_eq!(first_updated_at, second_updated_at);
    }

    #[tokio::test]
    async fn internal_host_platform_route_keeps_desktop_combined_host_ready_when_openclaw_is_stopped() {
        let provider = ManageOpenClawProviderHandle::new(Arc::new(FakeManageOpenClawProvider {
            host_endpoints: vec![HostEndpointRecord {
                endpoint_id: "openclaw-gateway".to_string(),
                bind_host: "127.0.0.1".to_string(),
                requested_port: 18_871,
                active_port: None,
                scheme: "http".to_string(),
                base_url: None,
                websocket_url: None,
                loopback_only: true,
                dynamic_port: false,
                last_conflict_at: None,
                last_conflict_reason: None,
            }],
            runtime: OpenClawRuntimeProjection {
                runtime_kind: "openclaw".to_string(),
                lifecycle: "stopped".to_string(),
                endpoint_id: Some("openclaw-gateway".to_string()),
                requested_port: Some(18_871),
                active_port: None,
                base_url: None,
                websocket_url: None,
                managed_by: "desktopCombined".to_string(),
                updated_at: 123,
            },
            gateway: OpenClawGatewayProjection {
                gateway_kind: "openclawGateway".to_string(),
                lifecycle: "stopped".to_string(),
                endpoint_id: Some("openclaw-gateway".to_string()),
                requested_port: Some(18_871),
                active_port: None,
                base_url: None,
                websocket_url: None,
                managed_by: "desktopCombined".to_string(),
                updated_at: 123,
            },
        }));
        let mut state = build_server_state_with_overrides(
            create_test_rollout_data_dir("host-platform-desktop-runtime-lifecycle"),
            ServerStateOverrides {
                manage_openclaw_provider: Some(provider),
                ..ServerStateOverrides::default()
            },
        );
        state.set_mode("desktopCombined");
        let app = build_router(state);

        let response = app
            .oneshot(
                Request::get("/claw/internal/v1/host-platform")
                    .body(Body::empty())
                    .expect("desktop host platform request should build"),
            )
            .await
            .expect("desktop host platform request should succeed");
        let status = response.status();
        let body = response_body_json(response).await;

        assert_eq!(status, StatusCode::OK);
        assert_eq!(
            body.get("mode").and_then(Value::as_str),
            Some("desktopCombined")
        );
        assert_eq!(
            body.get("lifecycle").and_then(Value::as_str),
            Some("ready")
        );
    }

    #[tokio::test]
    async fn internal_host_platform_route_reports_sqlite_state_store_driver() {
        let app = build_router(build_server_state_with_overrides(
            create_test_rollout_data_dir("host-platform-sqlite"),
            ServerStateOverrides {
                state_store_driver: Some("sqlite".to_string()),
                ..ServerStateOverrides::default()
            },
        ));
        let response = app
            .oneshot(
                Request::get("/claw/internal/v1/host-platform")
                    .body(Body::empty())
                    .expect("sqlite host platform request should build"),
            )
            .await
            .expect("sqlite host platform request should succeed");
        let status = response.status();
        let body = response_body_text(response).await;

        assert_eq!(status, StatusCode::OK);
        assert!(body.contains("\"deploymentFamily\":\"bareMetal\""));
        assert!(body.contains("\"stateStoreDriver\":\"sqlite\""));
        assert!(body.contains("\"activeProfileId\":\"default-sqlite\""));
        assert!(body.contains("\"driver\":\"sqlite\""));
    }

    #[tokio::test]
    async fn internal_host_platform_state_store_profile_projection_exposes_configuration_keys() {
        let app = build_router(build_server_state_with_rollout_data_dir(
            create_test_rollout_data_dir("host-platform-state-store-profile"),
        ));
        let response = app
            .oneshot(
                Request::get("/claw/internal/v1/host-platform")
                    .body(Body::empty())
                    .expect("host platform request should build"),
            )
            .await
            .expect("host platform request should succeed");
        let status = response.status();
        let body = response_body_json(response).await;
        let providers = body
            .get("stateStore")
            .and_then(|value| value.get("providers"))
            .and_then(Value::as_array)
            .expect("host platform response should expose state store providers");
        let profiles = body
            .get("stateStore")
            .and_then(|value| value.get("profiles"))
            .and_then(Value::as_array)
            .expect("host platform response should expose state store profiles");
        let postgres_provider = providers
            .iter()
            .find(|provider| provider.get("id").and_then(Value::as_str) == Some("postgres"))
            .expect("host platform response should expose the planned postgres provider");
        let postgres_profile = profiles
            .iter()
            .find(|profile| profile.get("id").and_then(Value::as_str) == Some("planned-postgres"))
            .expect("host platform response should expose the planned postgres profile");

        assert_eq!(status, StatusCode::OK);
        assert_eq!(
            value_string_array(postgres_provider.get("configurationKeys")),
            Some(vec![
                "postgresUrl".to_string(),
                "postgresSchema".to_string()
            ])
        );
        assert_eq!(
            postgres_provider
                .get("projectionMode")
                .and_then(Value::as_str),
            Some("metadataOnly")
        );
        assert_eq!(
            value_string_array(postgres_profile.get("configuredKeys")),
            Some(Vec::new())
        );
        assert_eq!(
            postgres_profile
                .get("connectionConfigured")
                .and_then(Value::as_bool),
            Some(false)
        );
        assert_eq!(
            postgres_profile
                .get("projectionMode")
                .and_then(Value::as_str),
            Some("metadataOnly")
        );
    }

    #[tokio::test]
    async fn internal_host_platform_state_store_profile_projection_marks_postgres_configured_keys()
    {
        let app = build_router(build_server_state_with_overrides(
            create_test_rollout_data_dir("host-platform-state-store-profile-configured"),
            ServerStateOverrides {
                state_store_postgres_url: Some("postgres://db.internal/claw".to_string()),
                state_store_postgres_schema: Some("claw".to_string()),
                ..ServerStateOverrides::default()
            },
        ));
        let response = app
            .oneshot(
                Request::get("/claw/internal/v1/host-platform")
                    .body(Body::empty())
                    .expect("host platform request should build"),
            )
            .await
            .expect("host platform request should succeed");
        let status = response.status();
        let body = response_body_json(response).await;
        let postgres_profile = body
            .get("stateStore")
            .and_then(|value| value.get("profiles"))
            .and_then(Value::as_array)
            .and_then(|profiles| {
                profiles.iter().find(|profile| {
                    profile.get("id").and_then(Value::as_str) == Some("planned-postgres")
                })
            })
            .expect("host platform response should expose the planned postgres profile");

        assert_eq!(status, StatusCode::OK);
        assert_eq!(
            body.get("stateStoreDriver").and_then(Value::as_str),
            Some("sqlite")
        );
        assert_eq!(
            value_string_array(postgres_profile.get("configuredKeys")),
            Some(vec![
                "postgresUrl".to_string(),
                "postgresSchema".to_string()
            ])
        );
        assert_eq!(
            postgres_profile
                .get("connectionConfigured")
                .and_then(Value::as_bool),
            Some(true)
        );
        assert_eq!(
            postgres_profile.get("active").and_then(Value::as_bool),
            Some(false)
        );
        assert_eq!(
            postgres_profile
                .get("projectionMode")
                .and_then(Value::as_str),
            Some("metadataOnly")
        );
    }

    #[tokio::test]
    async fn internal_host_platform_route_reports_complete_manage_capabilities_in_server_mode() {
        let app = build_router(build_server_state_with_rollout_data_dir(
            create_test_rollout_data_dir("host-platform-capabilities-server"),
        ));
        let response = app
            .oneshot(
                Request::get("/claw/internal/v1/host-platform")
                    .body(Body::empty())
                    .expect("host platform request should build"),
            )
            .await
            .expect("host platform request should succeed");
        let status = response.status();
        let body = response_body_json(response).await;
        let supported_capability_keys = value_string_array(body.get("supportedCapabilityKeys"))
            .expect("host platform response should expose supported capability keys");
        let available_capability_keys = value_string_array(body.get("availableCapabilityKeys"))
            .expect("host platform response should expose available capability keys");
        let capability_keys = value_string_array(body.get("capabilityKeys"))
            .expect("host platform response should expose capability keys");

        assert_eq!(status, StatusCode::OK);
        assert!(supported_capability_keys.contains(&"manage.rollouts.list".to_string()));
        assert!(supported_capability_keys.contains(&"manage.host-endpoints.read".to_string()));
        assert!(supported_capability_keys.contains(&"manage.openclaw.runtime.read".to_string()));
        assert!(supported_capability_keys.contains(&"manage.openclaw.gateway.read".to_string()));
        assert!(supported_capability_keys.contains(&"manage.openclaw.gateway.invoke".to_string()));
        assert!(supported_capability_keys.contains(&"manage.service.status".to_string()));
        assert!(supported_capability_keys.contains(&"manage.service.install".to_string()));
        assert!(supported_capability_keys.contains(&"manage.service.start".to_string()));
        assert!(supported_capability_keys.contains(&"manage.service.stop".to_string()));
        assert!(supported_capability_keys.contains(&"manage.service.restart".to_string()));
        assert!(available_capability_keys.contains(&"manage.rollouts.list".to_string()));
        assert!(available_capability_keys.contains(&"manage.host-endpoints.read".to_string()));
        assert!(available_capability_keys.contains(&"manage.openclaw.runtime.read".to_string()));
        assert!(available_capability_keys.contains(&"manage.openclaw.gateway.read".to_string()));
        assert!(!available_capability_keys.contains(&"manage.openclaw.gateway.invoke".to_string()));
        assert!(available_capability_keys.contains(&"manage.service.status".to_string()));
        assert!(available_capability_keys.contains(&"manage.service.install".to_string()));
        assert!(available_capability_keys.contains(&"manage.service.start".to_string()));
        assert!(available_capability_keys.contains(&"manage.service.stop".to_string()));
        assert!(available_capability_keys.contains(&"manage.service.restart".to_string()));
        assert!(capability_keys.contains(&"manage.rollouts.list".to_string()));
        assert!(capability_keys.contains(&"manage.host-endpoints.read".to_string()));
        assert!(capability_keys.contains(&"manage.openclaw.runtime.read".to_string()));
        assert!(capability_keys.contains(&"manage.openclaw.gateway.read".to_string()));
        assert!(!capability_keys.contains(&"manage.openclaw.gateway.invoke".to_string()));
        assert!(capability_keys.contains(&"manage.service.status".to_string()));
        assert!(capability_keys.contains(&"manage.service.install".to_string()));
        assert!(capability_keys.contains(&"manage.service.start".to_string()));
        assert!(capability_keys.contains(&"manage.service.stop".to_string()));
        assert!(capability_keys.contains(&"manage.service.restart".to_string()));
        assert_eq!(capability_keys, available_capability_keys);
    }

    #[tokio::test]
    async fn internal_host_platform_route_reports_gateway_invoke_available_when_control_plane_gateway_is_ready(
    ) {
        let mut host_endpoints = HostEndpointRegistry::default();
        host_endpoints.register(HostEndpointRegistration {
            endpoint_id: "openclaw-gateway".to_string(),
            bind_host: "127.0.0.1".to_string(),
            requested_port: 18_871,
            active_port: Some(18_871),
            scheme: "http".to_string(),
            base_path: None,
            websocket_path: Some("/ws".to_string()),
            loopback_only: true,
            dynamic_port: false,
            last_conflict_at: None,
            last_conflict_reason: None,
        });
        let provider = build_control_plane_manage_openclaw_provider(Arc::new(
            OpenClawControlPlane::inactive("agentstudio-server")
                .with_host_endpoints(host_endpoints)
                .with_gateway_endpoint("openclaw-gateway", OpenClawLifecycle::Ready),
        ));
        let app = build_router(build_server_state_with_overrides(
            create_test_rollout_data_dir("host-platform-capabilities-server-gateway-ready"),
            ServerStateOverrides {
                manage_openclaw_provider: Some(provider),
                ..ServerStateOverrides::default()
            },
        ));

        let response = app
            .oneshot(
                Request::get("/claw/internal/v1/host-platform")
                    .body(Body::empty())
                    .expect("host platform request should build"),
            )
            .await
            .expect("host platform request should succeed");
        let status = response.status();
        let body = response_body_json(response).await;
        let available_capability_keys = value_string_array(body.get("availableCapabilityKeys"))
            .expect("host platform response should expose available capability keys");
        let capability_keys = value_string_array(body.get("capabilityKeys"))
            .expect("host platform response should expose capability keys");

        assert_eq!(status, StatusCode::OK);
        assert!(available_capability_keys.contains(&"manage.openclaw.gateway.invoke".to_string()));
        assert!(capability_keys.contains(&"manage.openclaw.gateway.invoke".to_string()));
    }

    #[tokio::test]
    async fn internal_host_platform_route_omits_manage_service_capabilities_in_desktop_combined_mode(
    ) {
        let mut state = build_server_state_with_rollout_data_dir(create_test_rollout_data_dir(
            "host-platform-capabilities-desktop-combined",
        ));
        state.set_mode("desktopCombined");
        let app = build_router(state);

        let response = app
            .oneshot(
                Request::get("/claw/internal/v1/host-platform")
                    .body(Body::empty())
                    .expect("host platform request should build"),
            )
            .await
            .expect("host platform request should succeed");
        let status = response.status();
        let body = response_body_json(response).await;
        let supported_capability_keys = value_string_array(body.get("supportedCapabilityKeys"))
            .expect(
                "desktop combined host platform response should expose supported capability keys",
            );
        let available_capability_keys = value_string_array(body.get("availableCapabilityKeys"))
            .expect(
                "desktop combined host platform response should expose available capability keys",
            );
        let capability_keys = value_string_array(body.get("capabilityKeys"))
            .expect("desktop combined host platform response should expose capability keys");

        assert_eq!(status, StatusCode::OK);
        assert!(supported_capability_keys.contains(&"manage.host-endpoints.read".to_string()));
        assert!(supported_capability_keys.contains(&"manage.openclaw.runtime.read".to_string()));
        assert!(supported_capability_keys.contains(&"manage.openclaw.gateway.read".to_string()));
        assert!(supported_capability_keys.contains(&"manage.openclaw.gateway.invoke".to_string()));
        assert!(available_capability_keys.contains(&"manage.host-endpoints.read".to_string()));
        assert!(available_capability_keys.contains(&"manage.openclaw.runtime.read".to_string()));
        assert!(available_capability_keys.contains(&"manage.openclaw.gateway.read".to_string()));
        assert!(!available_capability_keys.contains(&"manage.openclaw.gateway.invoke".to_string()));
        assert!(capability_keys.contains(&"manage.host-endpoints.read".to_string()));
        assert!(capability_keys.contains(&"manage.openclaw.runtime.read".to_string()));
        assert!(capability_keys.contains(&"manage.openclaw.gateway.read".to_string()));
        assert!(!capability_keys.contains(&"manage.openclaw.gateway.invoke".to_string()));
        assert!(!capability_keys.contains(&"manage.service.status".to_string()));
        assert!(!capability_keys.contains(&"manage.service.install".to_string()));
        assert!(!capability_keys.contains(&"manage.service.start".to_string()));
        assert!(!capability_keys.contains(&"manage.service.stop".to_string()));
        assert!(!capability_keys.contains(&"manage.service.restart".to_string()));
        assert_eq!(capability_keys, available_capability_keys);
    }

    #[tokio::test]
    async fn internal_host_platform_route_reports_desktop_identity_in_desktop_combined_mode() {
        let mut state = build_server_state_with_rollout_data_dir(create_test_rollout_data_dir(
            "host-platform-desktop-identity",
        ));
        state.set_mode("desktopCombined");
        let app = build_router(state);

        let response = app
            .oneshot(
                Request::get("/claw/internal/v1/host-platform")
                    .body(Body::empty())
                    .expect("host platform request should build"),
            )
            .await
            .expect("host platform request should succeed");
        let status = response.status();
        let body = response_body_json(response).await;

        assert_eq!(status, StatusCode::OK);
        assert_eq!(
            body.get("mode").and_then(Value::as_str),
            Some("desktopCombined")
        );
        assert_eq!(
            body.get("hostId").and_then(Value::as_str),
            Some("desktop-local")
        );
        assert_eq!(
            body.get("displayName").and_then(Value::as_str),
            Some("Desktop Combined Host")
        );
        assert_eq!(
            body.get("version").and_then(Value::as_str),
            Some(sdkwork_agentstudio_host_core::host_core_metadata().package_version)
        );
    }

    #[tokio::test]
    async fn internal_routes_require_basic_auth_when_credentials_are_configured() {
        let app = build_router(build_server_state_with_overrides(
            create_test_rollout_data_dir("internal-auth"),
            ServerStateOverrides {
                auth: Some(ServerAuthConfig {
                    manage: Some(BasicAuthCredentials {
                        username: "operator".to_string(),
                        password: "manage-secret".to_string(),
                    }),
                    internal: Some(BasicAuthCredentials {
                        username: "node".to_string(),
                        password: "internal-secret".to_string(),
                    }),
                    browser_session_token: None,
                }),
                ..ServerStateOverrides::default()
            },
        ));

        let unauthorized_response = app
            .clone()
            .oneshot(
                Request::get("/claw/internal/v1/host-platform")
                    .body(Body::empty())
                    .expect("unauthorized internal request should build"),
            )
            .await
            .expect("unauthorized internal request should return a response");
        let unauthorized_status = unauthorized_response.status();
        let unauthorized_challenge = unauthorized_response
            .headers()
            .get(header::WWW_AUTHENTICATE)
            .and_then(|value| value.to_str().ok())
            .map(str::to_string);

        let authorized_response = app
            .oneshot(
                Request::get("/claw/internal/v1/host-platform")
                    .header(
                        header::AUTHORIZATION,
                        basic_auth_header_value("node", "internal-secret"),
                    )
                    .body(Body::empty())
                    .expect("authorized internal request should build"),
            )
            .await
            .expect("authorized internal request should succeed");
        let authorized_status = authorized_response.status();

        assert_eq!(unauthorized_status, StatusCode::UNAUTHORIZED);
        assert_eq!(
            unauthorized_challenge.as_deref(),
            Some("Basic realm=\"claw-internal\"")
        );
        assert_eq!(authorized_status, StatusCode::OK);
    }

    #[tokio::test]
    async fn desktop_combined_internal_routes_require_browser_session_token_when_configured() {
        let mut state = build_server_state_with_overrides(
            create_test_rollout_data_dir("internal-browser-session-auth"),
            ServerStateOverrides {
                auth: Some(ServerAuthConfig {
                    manage: None,
                    internal: None,
                    browser_session_token: Some("desktop-session-token".to_string()),
                }),
                ..ServerStateOverrides::default()
            },
        );
        state.set_mode("desktopCombined");
        let app = build_router(state);

        let unauthorized_response = app
            .clone()
            .oneshot(
                Request::get("/claw/internal/v1/host-platform")
                    .body(Body::empty())
                    .expect("unauthorized browser-session internal request should build"),
            )
            .await
            .expect("unauthorized browser-session internal request should return a response");
        let unauthorized_status = unauthorized_response.status();
        let unauthorized_challenge = unauthorized_response
            .headers()
            .get(header::WWW_AUTHENTICATE)
            .and_then(|value| value.to_str().ok())
            .map(str::to_string);

        let authorized_response = app
            .oneshot(
                Request::get("/claw/internal/v1/host-platform")
                    .header("x-claw-browser-session", "desktop-session-token")
                    .body(Body::empty())
                    .expect("authorized browser-session internal request should build"),
            )
            .await
            .expect("authorized browser-session internal request should succeed");
        let authorized_status = authorized_response.status();

        assert_eq!(unauthorized_status, StatusCode::UNAUTHORIZED);
        assert_eq!(
            unauthorized_challenge.as_deref(),
            Some("Bearer realm=\"claw-browser-session\"")
        );
        assert_eq!(authorized_status, StatusCode::OK);
    }

    #[tokio::test]
    async fn public_api_discovery_route_returns_native_public_metadata() {
        let app = build_router(build_server_state_with_rollout_data_dir(
            create_test_rollout_data_dir("api-discovery"),
        ));
        let response = app
            .oneshot(
                Request::get("/claw/api/v1/discovery")
                    .body(Body::empty())
                    .expect("public api discovery request should build"),
            )
            .await
            .expect("public api discovery request should succeed");
        let status = response.status();
        let body = response_body_json(response).await;

        assert_eq!(status, StatusCode::OK);
        assert_eq!(body.get("family").and_then(Value::as_str), Some("api"));
        assert_eq!(body.get("version").and_then(Value::as_str), Some("v1"));
        assert_eq!(
            body.get("basePath").and_then(Value::as_str),
            Some("/claw/api/v1")
        );
        assert_eq!(body.get("hostMode").and_then(Value::as_str), Some("server"));
        assert_eq!(
            body.get("openapiDocumentUrl").and_then(Value::as_str),
            Some("/claw/openapi/v1.json")
        );
        assert!(body
            .get("capabilityKeys")
            .and_then(Value::as_array)
            .is_some_and(|items| items
                .iter()
                .any(|item| item.as_str() == Some("api.discovery.read"))));
        assert!(body
            .get("capabilityKeys")
            .and_then(Value::as_array)
            .is_some_and(|items| items
                .iter()
                .any(|item| item.as_str() == Some("api.studio.instances.read"))));
        assert!(body
            .get("capabilityKeys")
            .and_then(Value::as_array)
            .is_some_and(|items| items
                .iter()
                .any(|item| item.as_str() == Some("api.studio.instances.write"))));
    }

    #[tokio::test]
    async fn public_api_discovery_route_keeps_generated_at_stable_across_unchanged_reads() {
        let app = build_router(build_server_state_with_rollout_data_dir(
            create_test_rollout_data_dir("api-discovery-stable-generated-at"),
        ));
        let first_response = app
            .clone()
            .oneshot(
                Request::get("/claw/api/v1/discovery")
                    .body(Body::empty())
                    .expect("public api discovery request should build"),
            )
            .await
            .expect("public api discovery request should succeed");
        let first_status = first_response.status();
        let first_body = response_body_json(first_response).await;
        let first_generated_at = first_body
            .get("generatedAt")
            .and_then(Value::as_u64)
            .expect("public api discovery response should include generatedAt");

        std::thread::sleep(Duration::from_millis(5));

        let second_response = app
            .oneshot(
                Request::get("/claw/api/v1/discovery")
                    .body(Body::empty())
                    .expect("public api discovery request should build"),
            )
            .await
            .expect("public api discovery request should succeed");
        let second_status = second_response.status();
        let second_body = response_body_json(second_response).await;
        let second_generated_at = second_body
            .get("generatedAt")
            .and_then(Value::as_u64)
            .expect("public api discovery response should include generatedAt");

        assert_eq!(first_status, StatusCode::OK);
        assert_eq!(second_status, StatusCode::OK);
        assert_eq!(first_generated_at, second_generated_at);
    }

    #[tokio::test]
    async fn public_studio_routes_return_built_in_instance_projection_by_default() {
        let app = build_router(build_server_state_with_rollout_data_dir(
            create_test_rollout_data_dir("api-studio-default-provider"),
        ));
        let list_response = app
            .clone()
            .oneshot(
                Request::get("/claw/api/v1/studio/instances")
                    .body(Body::empty())
                    .expect("public studio list request should build"),
            )
            .await
            .expect("public studio list request should succeed");
        let get_response = app
            .clone()
            .oneshot(
                Request::get("/claw/api/v1/studio/instances/managed-openclaw-primary")
                    .body(Body::empty())
                    .expect("public studio get request should build"),
            )
            .await
            .expect("public studio get request should succeed");

        assert_eq!(list_response.status(), StatusCode::OK);
        assert_eq!(get_response.status(), StatusCode::OK);

        let body = response_body_json(list_response).await;
        let item = body
            .as_array()
            .and_then(|items| {
                items.iter().find(|item| {
                    item.get("id").and_then(Value::as_str) == Some("managed-openclaw-primary")
                })
            })
            .expect("default server provider should expose the canonical built-in instance");
        assert_eq!(
            item.get("runtimeKind").and_then(Value::as_str),
            Some("openclaw")
        );
        assert_eq!(
            item.get("deploymentMode").and_then(Value::as_str),
            Some("local-managed")
        );
        assert_eq!(
            item.get("transportKind").and_then(Value::as_str),
            Some("openclawGatewayWs")
        );
        assert_eq!(item.get("isBuiltIn").and_then(Value::as_bool), Some(true));
        assert_eq!(item.get("status").and_then(Value::as_str), Some("offline"));

        let get_body = response_body_json(get_response).await;
        assert_eq!(
            get_body.get("id").and_then(Value::as_str),
            Some("managed-openclaw-primary")
        );
    }

    #[tokio::test]
    async fn public_studio_detail_route_returns_projection_by_default() {
        let app = build_router(build_server_state_with_rollout_data_dir(
            create_test_rollout_data_dir("api-studio-detail-default-provider"),
        ));
        let response = app
            .oneshot(
                Request::get("/claw/api/v1/studio/instances/managed-openclaw-primary/detail")
                    .body(Body::empty())
                    .expect("public studio detail request should build"),
            )
            .await
            .expect("public studio detail request should succeed");
        let status = response.status();
        let body = response_body_json(response).await;

        assert_eq!(status, StatusCode::OK);
        assert_eq!(
            body.get("instance")
                .and_then(|value| value.get("id"))
                .and_then(Value::as_str),
            Some("managed-openclaw-primary")
        );
        assert!(body.get("config").is_some());
        assert!(body.get("health").is_some());
        assert!(body.get("logs").is_some());
    }

    #[tokio::test]
    async fn public_studio_config_and_logs_routes_return_projection_by_default() {
        let app = build_router(build_server_state_with_rollout_data_dir(
            create_test_rollout_data_dir("api-studio-config-logs-default-provider"),
        ));
        let config_response = app
            .clone()
            .oneshot(
                Request::get("/claw/api/v1/studio/instances/managed-openclaw-primary/config")
                    .body(Body::empty())
                    .expect("public studio config request should build"),
            )
            .await
            .expect("public studio config request should succeed");
        let logs_response = app
            .oneshot(
                Request::get("/claw/api/v1/studio/instances/managed-openclaw-primary/logs")
                    .body(Body::empty())
                    .expect("public studio logs request should build"),
            )
            .await
            .expect("public studio logs request should succeed");

        assert_eq!(config_response.status(), StatusCode::OK);
        assert_eq!(logs_response.status(), StatusCode::OK);

        let config_body = response_body_json(config_response).await;
        let logs_body = response_body_json(logs_response).await;

        assert_eq!(
            config_body.get("port").and_then(Value::as_str),
            Some("21280")
        );
        assert!(logs_body.as_str().is_some());
    }

    #[tokio::test]
    async fn public_studio_conversation_routes_persist_records_with_default_provider() {
        let app = build_router(build_server_state_with_rollout_data_dir(
            create_test_rollout_data_dir("api-studio-conversations-default-provider"),
        ));
        let list_response = app
            .clone()
            .oneshot(
                Request::get(
                    "/claw/api/v1/studio/instances/managed-openclaw-primary/conversations",
                )
                .body(Body::empty())
                .expect("public studio conversation list request should build"),
            )
            .await
            .expect("public studio conversation list request should succeed");
        let put_response = app
            .clone()
            .oneshot(
                Request::put("/claw/api/v1/studio/conversations/conversation-1")
                    .header(axum::http::header::CONTENT_TYPE, "application/json")
                    .body(Body::from(
                        r#"{"id":"conversation-1","title":"Conversation","primaryInstanceId":"managed-openclaw-primary","participantInstanceIds":["managed-openclaw-primary"],"createdAt":1,"updatedAt":1,"messageCount":0,"messages":[]}"#,
                    ))
                    .expect("public studio conversation put request should build"),
            )
            .await
            .expect("public studio conversation put request should succeed");
        let delete_response = app
            .oneshot(
                Request::delete("/claw/api/v1/studio/conversations/conversation-1")
                    .body(Body::empty())
                    .expect("public studio conversation delete request should build"),
            )
            .await
            .expect("public studio conversation delete request should succeed");

        assert_eq!(list_response.status(), StatusCode::OK);
        assert_eq!(put_response.status(), StatusCode::OK);
        assert_eq!(delete_response.status(), StatusCode::OK);

        let list_body = response_body_json(list_response).await;
        let put_body = response_body_json(put_response).await;
        let delete_body = response_body_json(delete_response).await;

        assert!(list_body.as_array().is_some());
        assert_eq!(
            put_body.get("id").and_then(Value::as_str),
            Some("conversation-1")
        );
        assert_eq!(delete_body.as_bool(), Some(true));
    }

    #[tokio::test]
    async fn public_studio_kernel_chat_routes_manage_managed_hermes_sessions_with_default_provider()
    {
        let hermes_listener = tokio::net::TcpListener::bind(("127.0.0.1", 0))
            .await
            .expect("mock Hermes listener should bind");
        let hermes_addr = hermes_listener
            .local_addr()
            .expect("mock Hermes listener local addr should resolve");
        let hermes_server = tokio::spawn(async move {
            let app = axum::Router::new().route(
                "/v1/chat/completions",
                axum::routing::post(|| async {
                    axum::Json(json!({
                        "id": "hermes-run-1",
                        "choices": [
                            {
                                "message": {
                                    "role": "assistant",
                                    "content": "Hermes hosted reply"
                                }
                            }
                        ]
                    }))
                }),
            );
            axum::serve(hermes_listener, app)
                .await
                .expect("mock Hermes server should serve");
        });

        let app = build_router(build_server_state_with_rollout_data_dir(
            create_test_rollout_data_dir("api-studio-kernel-chat-default-provider"),
        ));
        let instance_payload = json!({
            "name": "Managed Hermes",
            "runtimeKind": "hermes",
            "deploymentMode": "local-managed",
            "transportKind": "customHttp",
            "baseUrl": format!("http://{}", hermes_addr),
            "config": {
                "baseUrl": format!("http://{}", hermes_addr),
                "authToken": "test-token"
            }
        });

        let create_instance_response = app
            .clone()
            .oneshot(
                Request::post("/claw/api/v1/studio/instances")
                    .header(axum::http::header::CONTENT_TYPE, "application/json")
                    .body(Body::from(instance_payload.to_string()))
                    .expect("public studio create hermes instance request should build"),
            )
            .await
            .expect("public studio create hermes instance request should succeed");
        let create_instance_status = create_instance_response.status();
        let created_instance = response_body_json(create_instance_response).await;
        let instance_id = created_instance
            .get("id")
            .and_then(Value::as_str)
            .expect("created Hermes instance should include an id")
            .to_string();

        let profiles_response = app
            .clone()
            .oneshot(
                Request::get(&format!(
                    "/claw/api/v1/studio/instances/{instance_id}/kernel-chat/agent-profiles"
                ))
                .body(Body::empty())
                .expect("public studio kernel chat agent profiles request should build"),
            )
            .await
            .expect("public studio kernel chat agent profiles request should succeed");
        let create_session_response = app
            .clone()
            .oneshot(
                Request::post(&format!(
                    "/claw/api/v1/studio/instances/{instance_id}/kernel-chat/sessions"
                ))
                .header(axum::http::header::CONTENT_TYPE, "application/json")
                .body(Body::from(
                    r#"{"title":"Research Session","model":"hermes-large","agentId":"hermes-default"}"#,
                ))
                .expect("public studio kernel chat create session request should build"),
            )
            .await
            .expect("public studio kernel chat create session request should succeed");
        let create_session_status = create_session_response.status();
        let created_session = response_body_json(create_session_response).await;
        let session_id = created_session
            .get("ref")
            .and_then(|value| value.get("sessionId"))
            .and_then(Value::as_str)
            .expect("created kernel chat session should include a session id")
            .to_string();

        let list_sessions_response = app
            .clone()
            .oneshot(
                Request::get(&format!(
                    "/claw/api/v1/studio/instances/{instance_id}/kernel-chat/sessions"
                ))
                .body(Body::empty())
                .expect("public studio kernel chat list sessions request should build"),
            )
            .await
            .expect("public studio kernel chat list sessions request should succeed");
        let get_session_response = app
            .clone()
            .oneshot(
                Request::get(&format!(
                    "/claw/api/v1/studio/instances/{instance_id}/kernel-chat/sessions/{session_id}"
                ))
                .body(Body::empty())
                .expect("public studio kernel chat get session request should build"),
            )
            .await
            .expect("public studio kernel chat get session request should succeed");
        let run_response = app
            .clone()
            .oneshot(
                Request::post(&format!(
                    "/claw/api/v1/studio/instances/{instance_id}/kernel-chat/sessions/{session_id}:run"
                ))
                .header(axum::http::header::CONTENT_TYPE, "application/json")
                .body(Body::from(
                    r#"{"content":"Hello Hermes","model":"hermes-large"}"#,
                ))
                .expect("public studio kernel chat run request should build"),
            )
            .await
            .expect("public studio kernel chat run request should succeed");
        let list_runs_response = app
            .clone()
            .oneshot(
                Request::get(&format!(
                    "/claw/api/v1/studio/instances/{instance_id}/kernel-chat/sessions/{session_id}/runs"
                ))
                .body(Body::empty())
                .expect("public studio kernel chat runs request should build"),
            )
            .await
            .expect("public studio kernel chat runs request should succeed");
        let get_run_response = app
            .clone()
            .oneshot(
                Request::get(&format!(
                    "/claw/api/v1/studio/instances/{instance_id}/kernel-chat/sessions/{session_id}/runs/hermes-run-1"
                ))
                .body(Body::empty())
                .expect("public studio kernel chat run detail request should build"),
            )
            .await
            .expect("public studio kernel chat run detail request should succeed");
        let messages_response = app
            .clone()
            .oneshot(
                Request::get(&format!(
                    "/claw/api/v1/studio/instances/{instance_id}/kernel-chat/sessions/{session_id}/messages"
                ))
                .body(Body::empty())
                .expect("public studio kernel chat messages request should build"),
            )
            .await
            .expect("public studio kernel chat messages request should succeed");
        let patch_session_response = app
            .clone()
            .oneshot(
                Request::patch(&format!(
                    "/claw/api/v1/studio/instances/{instance_id}/kernel-chat/sessions/{session_id}"
                ))
                .header(axum::http::header::CONTENT_TYPE, "application/json")
                .body(Body::from(
                    r#"{"title":"Renamed Session","model":"hermes-large"}"#,
                ))
                .expect("public studio kernel chat patch session request should build"),
            )
            .await
            .expect("public studio kernel chat patch session request should succeed");
        let delete_session_response = app
            .oneshot(
                Request::delete(&format!(
                    "/claw/api/v1/studio/instances/{instance_id}/kernel-chat/sessions/{session_id}"
                ))
                .body(Body::empty())
                .expect("public studio kernel chat delete session request should build"),
            )
            .await
            .expect("public studio kernel chat delete session request should succeed");

        assert_eq!(create_instance_status, StatusCode::OK);
        assert_eq!(create_session_status, StatusCode::OK);
        assert_eq!(profiles_response.status(), StatusCode::OK);
        assert_eq!(list_sessions_response.status(), StatusCode::OK);
        assert_eq!(get_session_response.status(), StatusCode::OK);
        assert_eq!(run_response.status(), StatusCode::OK);
        assert_eq!(list_runs_response.status(), StatusCode::OK);
        assert_eq!(get_run_response.status(), StatusCode::OK);
        assert_eq!(messages_response.status(), StatusCode::OK);
        assert_eq!(patch_session_response.status(), StatusCode::OK);
        assert_eq!(delete_session_response.status(), StatusCode::OK);

        let profiles_body = response_body_json(profiles_response).await;
        let list_sessions_body = response_body_json(list_sessions_response).await;
        let get_session_body = response_body_json(get_session_response).await;
        let run_body = response_body_json(run_response).await;
        let list_runs_body = response_body_json(list_runs_response).await;
        let get_run_body = response_body_json(get_run_response).await;
        let messages_body = response_body_json(messages_response).await;
        let patch_session_body = response_body_json(patch_session_response).await;
        let delete_session_body = response_body_json(delete_session_response).await;

        assert!(profiles_body
            .as_array()
            .is_some_and(|items| !items.is_empty()));
        assert!(list_sessions_body
            .as_array()
            .is_some_and(|items| items.len() == 1));
        assert_eq!(
            get_session_body
                .get("ref")
                .and_then(|value| value.get("sessionId"))
                .and_then(Value::as_str),
            Some(session_id.as_str())
        );
        assert_eq!(
            run_body.get("id").and_then(Value::as_str),
            Some("hermes-run-1")
        );
        assert_eq!(
            list_runs_body
                .as_array()
                .and_then(|items| items.first())
                .and_then(|value| value.get("id"))
                .and_then(Value::as_str),
            Some("hermes-run-1")
        );
        assert_eq!(
            get_run_body.get("id").and_then(Value::as_str),
            Some("hermes-run-1")
        );
        assert!(messages_body
            .as_array()
            .is_some_and(|items| items.len() == 2));
        assert_eq!(
            messages_body
                .as_array()
                .and_then(|items| items.last())
                .and_then(|value| value.get("text"))
                .and_then(Value::as_str),
            Some("Hermes hosted reply")
        );
        assert_eq!(
            patch_session_body.get("title").and_then(Value::as_str),
            Some("Renamed Session")
        );
        assert!(delete_session_body.is_null());

        hermes_server.abort();
    }

    #[tokio::test]
    async fn public_studio_openclaw_gateway_invoke_route_returns_error_when_gateway_is_unavailable()
    {
        let app = build_router(build_server_state_with_rollout_data_dir(
            create_test_rollout_data_dir("api-studio-openclaw-gateway-invoke-default-provider"),
        ));
        let response = app
            .oneshot(
                Request::post(
                    "/claw/api/v1/studio/instances/managed-openclaw-primary/gateway/invoke",
                )
                .header(axum::http::header::CONTENT_TYPE, "application/json")
                .body(Body::from(
                    r#"{"request":{"tool":"models","action":"list","args":{}}}"#,
                ))
                .expect("public studio gateway invoke request should build"),
            )
            .await
            .expect("public studio gateway invoke request should succeed");
        let status = response.status();
        let body = response_body_json(response).await;
        let error = body
            .get("error")
            .and_then(Value::as_object)
            .expect("public studio gateway invoke failure should return an error envelope");

        assert_eq!(status, StatusCode::SERVICE_UNAVAILABLE);
        assert_eq!(
            error.get("code").and_then(Value::as_str),
            Some("studio_public_api_openclaw_gateway_unavailable")
        );
    }

    #[tokio::test]
    async fn public_studio_instance_mutation_routes_preserve_custom_instance_mutations_and_reject_unsupported_lifecycle_control(
    ) {
        let app = build_router(build_server_state_with_rollout_data_dir(
            create_test_rollout_data_dir("api-studio-instance-mutations-default-provider"),
        ));
        let create_response = app
            .clone()
            .oneshot(
                Request::post("/claw/api/v1/studio/instances")
                    .header(axum::http::header::CONTENT_TYPE, "application/json")
                    .body(Body::from(
                        r#"{"name":"Created instance","runtimeKind":"openclaw","deploymentMode":"local-managed","transportKind":"openclawGatewayWs"}"#,
                    ))
                    .expect("public studio create request should build"),
            )
            .await
            .expect("public studio create request should succeed");
        let create_status = create_response.status();
        let created = response_body_json(create_response).await;
        let created_id = created
            .get("id")
            .and_then(Value::as_str)
            .expect("created instance should include an id")
            .to_string();
        let update_response = app
            .clone()
            .oneshot(
                Request::put(&format!("/claw/api/v1/studio/instances/{created_id}"))
                    .header(axum::http::header::CONTENT_TYPE, "application/json")
                    .body(Body::from(
                        r#"{"name":"Updated instance","status":"offline"}"#,
                    ))
                    .expect("public studio update request should build"),
            )
            .await
            .expect("public studio update request should succeed");
        let start_response = app
            .clone()
            .oneshot(
                Request::post(&format!("/claw/api/v1/studio/instances/{created_id}:start"))
                    .body(Body::empty())
                    .expect("public studio start request should build"),
            )
            .await
            .expect("public studio start request should succeed");
        let start_status = start_response.status();
        let stop_response = app
            .clone()
            .oneshot(
                Request::post(&format!("/claw/api/v1/studio/instances/{created_id}:stop"))
                    .body(Body::empty())
                    .expect("public studio stop request should build"),
            )
            .await
            .expect("public studio stop request should succeed");
        let stop_status = stop_response.status();
        let restart_response = app
            .clone()
            .oneshot(
                Request::post(&format!(
                    "/claw/api/v1/studio/instances/{created_id}:restart"
                ))
                .body(Body::empty())
                .expect("public studio restart request should build"),
            )
            .await
            .expect("public studio restart request should succeed");
        let restart_status = restart_response.status();
        let config_response = app
            .clone()
            .oneshot(
                Request::put(&format!("/claw/api/v1/studio/instances/{created_id}/config"))
                    .header(axum::http::header::CONTENT_TYPE, "application/json")
                    .body(Body::from(
                        r#"{"port":"28888","sandbox":true,"autoUpdate":false,"logLevel":"debug","corsOrigins":"http://localhost:3001"}"#,
                    ))
                    .expect("public studio config put request should build"),
            )
            .await
            .expect("public studio config put request should succeed");
        let delete_response = app
            .oneshot(
                Request::delete(&format!("/claw/api/v1/studio/instances/{created_id}"))
                    .body(Body::empty())
                    .expect("public studio delete request should build"),
            )
            .await
            .expect("public studio delete request should succeed");

        assert_eq!(create_status, StatusCode::OK);
        assert_eq!(
            created.get("name").and_then(Value::as_str),
            Some("Created instance")
        );

        let update_body = response_body_json(update_response).await;
        let start_body = response_body_json(start_response).await;
        let stop_body = response_body_json(stop_response).await;
        let restart_body = response_body_json(restart_response).await;
        let config_body = response_body_json(config_response).await;
        let delete_body = response_body_json(delete_response).await;

        assert_eq!(
            update_body.get("name").and_then(Value::as_str),
            Some("Updated instance")
        );
        assert_eq!(start_status, StatusCode::CONFLICT);
        assert_eq!(stop_status, StatusCode::CONFLICT);
        assert_eq!(restart_status, StatusCode::CONFLICT);
        assert_eq!(
            start_body
                .get("error")
                .and_then(|value| value.get("code"))
                .and_then(Value::as_str),
            Some("studio_public_api_lifecycle_unavailable")
        );
        assert_eq!(
            stop_body
                .get("error")
                .and_then(|value| value.get("code"))
                .and_then(Value::as_str),
            Some("studio_public_api_lifecycle_unavailable")
        );
        assert_eq!(
            restart_body
                .get("error")
                .and_then(|value| value.get("code"))
                .and_then(Value::as_str),
            Some("studio_public_api_lifecycle_unavailable")
        );
        assert_eq!(
            config_body.get("port").and_then(Value::as_str),
            Some("28888")
        );
        assert_eq!(delete_body.as_bool(), Some(true));
    }

    #[tokio::test]
    async fn public_studio_workbench_mutation_routes_reject_built_in_mutations_without_live_runtime_authority(
    ) {
        let app = build_router(build_server_state_with_rollout_data_dir(
            create_test_rollout_data_dir("api-studio-workbench-mutations-default-provider"),
        ));
        let create_task_response = app
            .clone()
            .oneshot(
                Request::post("/claw/api/v1/studio/instances/managed-openclaw-primary/tasks")
                    .header(axum::http::header::CONTENT_TYPE, "application/json")
                    .body(Body::from(
                        r#"{"id":"job-1","name":"Daily Sync","schedule":{"kind":"cron","expr":"0 9 * * *","tz":"Asia/Shanghai"},"payload":{"kind":"agentTurn","message":"Summarize updates.","model":"openai/gpt-5.4"}}"#,
                    ))
                    .expect("public studio task create request should build"),
            )
            .await
            .expect("public studio task create request should succeed");
        let update_task_response = app
            .clone()
            .oneshot(
                Request::put("/claw/api/v1/studio/instances/managed-openclaw-primary/tasks/job-1")
                    .header(axum::http::header::CONTENT_TYPE, "application/json")
                    .body(Body::from(
                        r#"{"id":"job-1","name":"Updated Daily Sync","enabled":false,"schedule":{"kind":"cron","expr":"0 10 * * *","tz":"Asia/Shanghai"},"payload":{"kind":"agentTurn","message":"Summarize only critical updates.","model":"openai/gpt-5.4"}}"#,
                    ))
                    .expect("public studio task update request should build"),
            )
            .await
            .expect("public studio task update request should succeed");
        let clone_task_response = app
            .clone()
            .oneshot(
                Request::post(
                    "/claw/api/v1/studio/instances/managed-openclaw-primary/tasks/job-1:clone",
                )
                .header(axum::http::header::CONTENT_TYPE, "application/json")
                .body(Body::from(r#"{"name":"Daily Sync Copy"}"#))
                .expect("public studio task clone request should build"),
            )
            .await
            .expect("public studio task clone request should succeed");
        let run_task_response = app
            .clone()
            .oneshot(
                Request::post(
                    "/claw/api/v1/studio/instances/managed-openclaw-primary/tasks/job-1:run",
                )
                .body(Body::empty())
                .expect("public studio task run request should build"),
            )
            .await
            .expect("public studio task run request should succeed");
        let executions_response = app
            .clone()
            .oneshot(
                Request::get(
                    "/claw/api/v1/studio/instances/managed-openclaw-primary/tasks/job-1/executions",
                )
                .body(Body::empty())
                .expect("public studio task execution list request should build"),
            )
            .await
            .expect("public studio task execution list request should succeed");
        let status_response = app
            .clone()
            .oneshot(
                Request::post(
                    "/claw/api/v1/studio/instances/managed-openclaw-primary/tasks/job-1:status",
                )
                .header(axum::http::header::CONTENT_TYPE, "application/json")
                .body(Body::from(r#"{"status":"paused"}"#))
                .expect("public studio task status request should build"),
            )
            .await
            .expect("public studio task status request should succeed");
        let file_update_response = app
            .clone()
            .oneshot(
                Request::put(
                    "/claw/api/v1/studio/instances/managed-openclaw-primary/files/%2Fworkspace%2Fmain%2FAGENTS.md",
                )
                .header(axum::http::header::CONTENT_TYPE, "application/json")
                .body(Body::from(r##"{"content":"# Updated main agent"}"##))
                .expect("public studio file update request should build"),
            )
            .await
            .expect("public studio file update request should succeed");
        let provider_update_response = app
            .clone()
            .oneshot(
                Request::put("/claw/api/v1/studio/instances/managed-openclaw-primary/llm-providers/openai")
                    .header(axum::http::header::CONTENT_TYPE, "application/json")
                    .body(Body::from(
                        r#"{"endpoint":"https://api.openai.com/v1","apiKeySource":"env:OPENAI_API_KEY","defaultModelId":"gpt-5.4","reasoningModelId":"o4-mini","embeddingModelId":"text-embedding-3-large","config":{"temperature":0.1,"topP":1.0,"maxTokens":4096,"timeoutMs":60000,"streaming":true}}"#,
                    ))
                    .expect("public studio llm provider update request should build"),
            )
            .await
            .expect("public studio llm provider update request should succeed");
        let delete_task_response = app
            .oneshot(
                Request::delete(
                    "/claw/api/v1/studio/instances/managed-openclaw-primary/tasks/job-1",
                )
                .body(Body::empty())
                .expect("public studio task delete request should build"),
            )
            .await
            .expect("public studio task delete request should succeed");

        assert_eq!(create_task_response.status(), StatusCode::CONFLICT);
        assert_eq!(update_task_response.status(), StatusCode::CONFLICT);
        assert_eq!(clone_task_response.status(), StatusCode::CONFLICT);
        assert_eq!(run_task_response.status(), StatusCode::CONFLICT);
        assert_eq!(executions_response.status(), StatusCode::CONFLICT);
        assert_eq!(status_response.status(), StatusCode::CONFLICT);
        assert_eq!(file_update_response.status(), StatusCode::CONFLICT);
        assert_eq!(provider_update_response.status(), StatusCode::CONFLICT);
        assert_eq!(delete_task_response.status(), StatusCode::CONFLICT);

        let create_task_body = response_body_json(create_task_response).await;
        let update_task_body = response_body_json(update_task_response).await;
        let clone_task_body = response_body_json(clone_task_response).await;
        let run_task_body = response_body_json(run_task_response).await;
        let executions_body = response_body_json(executions_response).await;
        let status_body = response_body_json(status_response).await;
        let file_update_body = response_body_json(file_update_response).await;
        let provider_update_body = response_body_json(provider_update_response).await;
        let delete_task_body = response_body_json(delete_task_response).await;

        for body in [
            &create_task_body,
            &update_task_body,
            &clone_task_body,
            &run_task_body,
            &executions_body,
            &status_body,
            &file_update_body,
            &provider_update_body,
            &delete_task_body,
        ] {
            assert_eq!(
                body.get("error")
                    .and_then(|value| value.get("code"))
                    .and_then(Value::as_str),
                Some("studio_public_api_workbench_unavailable")
            );
        }
    }

    #[tokio::test]
    async fn desktop_combined_public_studio_routes_require_browser_session_token_when_configured() {
        let mut state = build_server_state_with_overrides(
            create_test_rollout_data_dir("public-studio-browser-session-auth"),
            ServerStateOverrides {
                auth: Some(ServerAuthConfig {
                    manage: None,
                    internal: None,
                    browser_session_token: Some("desktop-session-token".to_string()),
                }),
                ..ServerStateOverrides::default()
            },
        );
        state.set_mode("desktopCombined");
        let app = build_router(state);

        let unauthorized_response = app
            .clone()
            .oneshot(
                Request::get("/claw/api/v1/studio/instances")
                    .body(Body::empty())
                    .expect("unauthorized public studio request should build"),
            )
            .await
            .expect("unauthorized public studio request should return a response");
        let unauthorized_status = unauthorized_response.status();
        let unauthorized_challenge = unauthorized_response
            .headers()
            .get(header::WWW_AUTHENTICATE)
            .and_then(|value| value.to_str().ok())
            .map(str::to_string);

        let authorized_response = app
            .oneshot(
                Request::get("/claw/api/v1/studio/instances")
                    .header("x-claw-browser-session", "desktop-session-token")
                    .body(Body::empty())
                    .expect("authorized public studio request should build"),
            )
            .await
            .expect("authorized public studio request should succeed");
        let authorized_status = authorized_response.status();

        assert_eq!(unauthorized_status, StatusCode::UNAUTHORIZED);
        assert_eq!(
            unauthorized_challenge.as_deref(),
            Some("Bearer realm=\"claw-browser-session\"")
        );
        assert_eq!(authorized_status, StatusCode::OK);
    }

    #[tokio::test]
    async fn desktop_combined_hosted_startup_preflight_allows_browser_session_header_for_critical_routes(
    ) {
        let app = build_desktop_combined_browser_session_test_app("hosted-startup-preflight");

        for path in [
            "/claw/internal/v1/host-platform",
            "/claw/manage/v1/host-endpoints",
            "/claw/api/v1/studio/instances",
        ] {
            let response = app
                .clone()
                .oneshot(build_cors_preflight_request(path, "GET"))
                .await
                .expect("desktop hosted preflight request should return a response");
            let status = response.status();
            let headers = response.headers().clone();

            assert_eq!(
                status,
                StatusCode::NO_CONTENT,
                "expected a successful CORS preflight for {path}",
            );
            assert_eq!(
                header_value(&headers, &header::ACCESS_CONTROL_ALLOW_ORIGIN).as_deref(),
                Some(DESKTOP_HOSTED_BROWSER_ORIGIN),
                "expected allow-origin header for {path}",
            );
            assert_csv_header_contains(&headers, header::ACCESS_CONTROL_ALLOW_METHODS, "GET", path);
            assert_csv_header_contains(
                &headers,
                header::ACCESS_CONTROL_ALLOW_HEADERS,
                "x-claw-browser-session",
                path,
            );
        }
    }

    #[tokio::test]
    async fn desktop_combined_hosted_startup_requests_include_cors_headers_on_successful_responses()
    {
        let app = build_desktop_combined_browser_session_test_app("hosted-startup-response-cors");

        for path in [
            "/claw/internal/v1/host-platform",
            "/claw/manage/v1/host-endpoints",
            "/claw/api/v1/studio/instances",
        ] {
            let response = app
                .clone()
                .oneshot(
                    Request::get(path)
                        .header(header::ORIGIN, DESKTOP_HOSTED_BROWSER_ORIGIN)
                        .header("x-claw-browser-session", DESKTOP_BROWSER_SESSION_TOKEN)
                        .body(Body::empty())
                        .expect("desktop hosted browser request should build"),
                )
                .await
                .expect("desktop hosted browser request should return a response");
            let status = response.status();
            let headers = response.headers().clone();

            assert_eq!(
                status,
                StatusCode::OK,
                "expected successful desktop hosted startup request for {path}",
            );
            assert_eq!(
                header_value(&headers, &header::ACCESS_CONTROL_ALLOW_ORIGIN).as_deref(),
                Some(DESKTOP_HOSTED_BROWSER_ORIGIN),
                "expected allow-origin header for {path}",
            );
        }
    }

    #[tokio::test]
    async fn desktop_combined_hosted_startup_preflight_rejects_remote_origins_for_control_plane_surfaces(
    ) {
        let app = build_desktop_combined_browser_session_test_app(
            "hosted-startup-preflight-remote-origin",
        );

        for path in [
            "/claw/internal/v1/host-platform",
            "/claw/manage/v1/host-endpoints",
            "/claw/manage/v1/openclaw/runtime",
            "/claw/manage/v1/openclaw/gateway",
            "/claw/api/v1/studio/instances",
        ] {
            let response = app
                .clone()
                .oneshot(build_cors_preflight_request_with_origin(
                    path,
                    "GET",
                    REMOTE_BROWSER_ORIGIN,
                ))
                .await
                .expect("remote origin preflight request should return a response");
            let status = response.status();
            let headers = response.headers().clone();

            assert_eq!(
                status,
                StatusCode::FORBIDDEN,
                "expected remote-origin preflight rejection for {path}",
            );
            assert_eq!(
                header_value(&headers, &header::ACCESS_CONTROL_ALLOW_ORIGIN).as_deref(),
                None,
                "remote origin should not receive allow-origin for {path}",
            );
        }
    }

    #[tokio::test]
    async fn desktop_combined_hosted_startup_preflight_stays_blocked_for_non_browser_internal_routes(
    ) {
        let app = build_desktop_combined_browser_session_test_app(
            "hosted-startup-preflight-non-browser-internal",
        );

        let response = app
            .oneshot(build_cors_preflight_request(
                "/claw/internal/v1/node-sessions",
                "GET",
            ))
            .await
            .expect("non-browser internal preflight request should return a response");
        let status = response.status();
        let headers = response.headers().clone();

        assert_eq!(status, StatusCode::METHOD_NOT_ALLOWED);
        assert_eq!(
            header_value(&headers, &header::ACCESS_CONTROL_ALLOW_ORIGIN).as_deref(),
            None,
        );
    }

    #[tokio::test]
    async fn desktop_combined_control_plane_responses_do_not_mirror_remote_origins() {
        let app = build_desktop_combined_browser_session_test_app(
            "hosted-startup-response-remote-origin",
        );

        for path in [
            "/claw/internal/v1/host-platform",
            "/claw/manage/v1/host-endpoints",
            "/claw/api/v1/studio/instances",
        ] {
            let response = app
                .clone()
                .oneshot(
                    Request::get(path)
                        .header(header::ORIGIN, REMOTE_BROWSER_ORIGIN)
                        .header("x-claw-browser-session", DESKTOP_BROWSER_SESSION_TOKEN)
                        .body(Body::empty())
                        .expect("remote-origin control-plane request should build"),
                )
                .await
                .expect("remote-origin control-plane request should return a response");
            let status = response.status();
            let headers = response.headers().clone();

            assert_eq!(
                status,
                StatusCode::OK,
                "expected successful control-plane response for {path}",
            );
            assert_eq!(
                header_value(&headers, &header::ACCESS_CONTROL_ALLOW_ORIGIN).as_deref(),
                None,
                "remote origin should not be mirrored for {path}",
            );
        }
    }

    #[tokio::test]
    async fn openapi_discovery_route_returns_native_document_metadata() {
        let app = build_router(build_server_state_with_rollout_data_dir(
            create_test_rollout_data_dir("openapi-discovery"),
        ));
        let response = app
            .oneshot(
                Request::get("/claw/openapi/discovery")
                    .body(Body::empty())
                    .expect("openapi discovery request should build"),
            )
            .await
            .expect("openapi discovery request should succeed");
        let status = response.status();

        assert_eq!(status, StatusCode::OK);
        let body = response_body_json(response).await;
        assert_eq!(body.get("family").and_then(Value::as_str), Some("openapi"));
        assert!(body
            .get("documents")
            .and_then(Value::as_array)
            .is_some_and(|documents| {
                documents.iter().any(|document| {
                    document.get("id").and_then(Value::as_str) == Some("claw-native-v1")
                        && document.get("url").and_then(Value::as_str)
                            == Some("/claw/openapi/v1.json")
                        && document
                            .get("apiFamilies")
                            .and_then(Value::as_array)
                            .is_some_and(|families| {
                                families.iter().any(|family| family.as_str() == Some("api"))
                            })
                })
            }));
    }

    #[tokio::test]
    async fn openapi_discovery_route_keeps_generated_at_stable_across_unchanged_reads() {
        let app = build_router(build_server_state_with_rollout_data_dir(
            create_test_rollout_data_dir("openapi-discovery-stable-generated-at"),
        ));
        let first_response = app
            .clone()
            .oneshot(
                Request::get("/claw/openapi/discovery")
                    .body(Body::empty())
                    .expect("openapi discovery request should build"),
            )
            .await
            .expect("openapi discovery request should succeed");
        let first_status = first_response.status();
        let first_body = response_body_json(first_response).await;
        let first_generated_at = first_body
            .get("generatedAt")
            .and_then(Value::as_u64)
            .expect("openapi discovery response should include generatedAt");

        std::thread::sleep(Duration::from_millis(5));

        let second_response = app
            .oneshot(
                Request::get("/claw/openapi/discovery")
                    .body(Body::empty())
                    .expect("openapi discovery request should build"),
            )
            .await
            .expect("openapi discovery request should succeed");
        let second_status = second_response.status();
        let second_body = response_body_json(second_response).await;
        let second_generated_at = second_body
            .get("generatedAt")
            .and_then(Value::as_u64)
            .expect("openapi discovery response should include generatedAt");

        assert_eq!(first_status, StatusCode::OK);
        assert_eq!(second_status, StatusCode::OK);
        assert_eq!(first_generated_at, second_generated_at);
    }

    #[tokio::test]
    async fn openapi_discovery_route_describes_governed_openclaw_gateway_document_when_available() {
        let provider = ManageOpenClawProviderHandle::new(Arc::new(FakeManageOpenClawProvider {
            host_endpoints: vec![HostEndpointRecord {
                endpoint_id: "openclaw-gateway".to_string(),
                bind_host: "127.0.0.1".to_string(),
                requested_port: 18_871,
                active_port: Some(18_871),
                scheme: "http".to_string(),
                base_url: Some("http://127.0.0.1:18871".to_string()),
                websocket_url: Some("ws://127.0.0.1:18871".to_string()),
                loopback_only: true,
                dynamic_port: false,
                last_conflict_at: None,
                last_conflict_reason: None,
            }],
            runtime: OpenClawRuntimeProjection {
                runtime_kind: "openclaw".to_string(),
                lifecycle: "ready".to_string(),
                endpoint_id: Some("openclaw-gateway".to_string()),
                requested_port: Some(18_871),
                active_port: Some(18_871),
                base_url: Some("http://127.0.0.1:18871".to_string()),
                websocket_url: Some("ws://127.0.0.1:18871".to_string()),
                managed_by: "agentstudio-server".to_string(),
                updated_at: 123,
            },
            gateway: OpenClawGatewayProjection {
                gateway_kind: "openclawGateway".to_string(),
                lifecycle: "ready".to_string(),
                endpoint_id: Some("openclaw-gateway".to_string()),
                requested_port: Some(18_871),
                active_port: Some(18_871),
                base_url: Some("http://127.0.0.1:18871".to_string()),
                websocket_url: Some("ws://127.0.0.1:18871".to_string()),
                managed_by: "agentstudio-server".to_string(),
                updated_at: 123,
            },
        }));
        let app = build_router(build_server_state_with_overrides(
            create_test_rollout_data_dir("openapi-discovery-openclaw-gateway"),
            ServerStateOverrides {
                manage_openclaw_provider: Some(provider),
                ..ServerStateOverrides::default()
            },
        ));
        let response = app
            .oneshot(
                Request::get("/claw/openapi/discovery")
                    .body(Body::empty())
                    .expect("openapi discovery request should build"),
            )
            .await
            .expect("openapi discovery request should succeed");

        assert_eq!(response.status(), StatusCode::OK);
        let body = response_body_json(response).await;
        let documents = body
            .get("documents")
            .and_then(Value::as_array)
            .expect("openapi discovery should include document entries");

        assert!(documents.iter().any(|document| {
            document.get("id").and_then(Value::as_str) == Some("claw-native-v1")
                && document.get("proxyTarget").and_then(Value::as_str) == Some("native-host")
                && document.get("runtimeCapability").and_then(Value::as_str) == Some("always")
        }));
        assert!(documents.iter().any(|document| {
            document.get("id").and_then(Value::as_str) == Some("openclaw-gateway-v1")
                && document.get("url").and_then(Value::as_str)
                    == Some("/claw/openapi/openclaw-gateway-v1.json")
                && document.get("proxyTarget").and_then(Value::as_str) == Some("openclaw-gateway")
                && document.get("runtimeCapability").and_then(Value::as_str)
                    == Some("openclaw-gateway-http")
        }));
    }

    #[tokio::test]
    async fn openapi_governed_proxy_document_route_describes_openclaw_gateway_paths() {
        let provider = ManageOpenClawProviderHandle::new(Arc::new(FakeManageOpenClawProvider {
            host_endpoints: vec![HostEndpointRecord {
                endpoint_id: "openclaw-gateway".to_string(),
                bind_host: "127.0.0.1".to_string(),
                requested_port: 18_871,
                active_port: Some(18_871),
                scheme: "http".to_string(),
                base_url: Some("http://127.0.0.1:18871".to_string()),
                websocket_url: Some("ws://127.0.0.1:18871".to_string()),
                loopback_only: true,
                dynamic_port: false,
                last_conflict_at: None,
                last_conflict_reason: None,
            }],
            runtime: OpenClawRuntimeProjection {
                runtime_kind: "openclaw".to_string(),
                lifecycle: "ready".to_string(),
                endpoint_id: Some("openclaw-gateway".to_string()),
                requested_port: Some(18_871),
                active_port: Some(18_871),
                base_url: Some("http://127.0.0.1:18871".to_string()),
                websocket_url: Some("ws://127.0.0.1:18871".to_string()),
                managed_by: "agentstudio-server".to_string(),
                updated_at: 123,
            },
            gateway: OpenClawGatewayProjection {
                gateway_kind: "openclawGateway".to_string(),
                lifecycle: "ready".to_string(),
                endpoint_id: Some("openclaw-gateway".to_string()),
                requested_port: Some(18_871),
                active_port: Some(18_871),
                base_url: Some("http://127.0.0.1:18871".to_string()),
                websocket_url: Some("ws://127.0.0.1:18871".to_string()),
                managed_by: "agentstudio-server".to_string(),
                updated_at: 123,
            },
        }));
        let app = build_router(build_server_state_with_overrides(
            create_test_rollout_data_dir("openapi-openclaw-gateway-document"),
            ServerStateOverrides {
                manage_openclaw_provider: Some(provider),
                ..ServerStateOverrides::default()
            },
        ));
        let response = app
            .oneshot(
                Request::get("/claw/openapi/openclaw-gateway-v1.json")
                    .body(Body::empty())
                    .expect("governed proxy openapi request should build"),
            )
            .await
            .expect("governed proxy openapi request should succeed");

        assert_eq!(response.status(), StatusCode::OK);
        let body = response_body_json(response).await;
        let paths = body
            .get("paths")
            .and_then(Value::as_object)
            .expect("governed proxy openapi document should include paths");

        assert!(paths.contains_key("/claw/gateway/openclaw/tools/invoke"));
    }

    #[tokio::test]
    async fn openapi_v1_document_route_lists_current_native_paths() {
        let app = build_router(build_server_state_with_rollout_data_dir(
            create_test_rollout_data_dir("openapi-v1"),
        ));
        let response = app
            .oneshot(
                Request::get("/claw/openapi/v1.json")
                    .body(Body::empty())
                    .expect("openapi document request should build"),
            )
            .await
            .expect("openapi document request should succeed");
        let status = response.status();

        assert_eq!(status, StatusCode::OK);
        let body = response_body_json(response).await;
        let paths = body
            .get("paths")
            .and_then(Value::as_object)
            .expect("openapi document should include paths");
        assert_eq!(body.get("openapi").and_then(Value::as_str), Some("3.1.0"));
        assert!(paths.contains_key("/claw/health/live"));
        assert!(paths.contains_key("/claw/api/v1/discovery"));
        assert!(paths.contains_key("/claw/api/v1/studio/instances"));
        assert!(paths.contains_key("/claw/api/v1/studio/instances/{id}"));
        assert!(paths.contains_key("/claw/api/v1/studio/instances/{id}:start"));
        assert!(paths.contains_key("/claw/api/v1/studio/instances/{id}:stop"));
        assert!(paths.contains_key("/claw/api/v1/studio/instances/{id}:restart"));
        assert!(paths.contains_key("/claw/api/v1/studio/instances/{id}/detail"));
        assert!(paths.contains_key("/claw/api/v1/studio/instances/{id}/config"));
        assert!(paths.contains_key("/claw/api/v1/studio/instances/{id}/kernel-chat/agent-profiles"));
        assert!(paths.contains_key("/claw/api/v1/studio/instances/{id}/kernel-chat/sessions"));
        assert!(paths
            .contains_key("/claw/api/v1/studio/instances/{id}/kernel-chat/sessions/{sessionId}"));
        assert!(paths.contains_key(
            "/claw/api/v1/studio/instances/{id}/kernel-chat/sessions/{sessionId}:run"
        ));
        assert!(paths.contains_key(
            "/claw/api/v1/studio/instances/{id}/kernel-chat/sessions/{sessionId}:abort"
        ));
        assert!(paths.contains_key(
            "/claw/api/v1/studio/instances/{id}/kernel-chat/sessions/{sessionId}/runs"
        ));
        assert!(paths.contains_key(
            "/claw/api/v1/studio/instances/{id}/kernel-chat/sessions/{sessionId}/runs/{runId}"
        ));
        assert!(paths.contains_key(
            "/claw/api/v1/studio/instances/{id}/kernel-chat/sessions/{sessionId}/messages"
        ));
        assert!(paths.contains_key("/claw/api/v1/studio/instances/{id}/logs"));
        assert!(paths.contains_key("/claw/api/v1/studio/instances/{id}/conversations"));
        assert!(paths.contains_key("/claw/api/v1/studio/instances/{id}/gateway/invoke"));
        assert!(paths.contains_key("/claw/api/v1/studio/instances/{id}/tasks"));
        assert!(paths.contains_key("/claw/api/v1/studio/instances/{id}/tasks/{taskId}"));
        assert!(paths.contains_key("/claw/api/v1/studio/instances/{id}/tasks/{taskId}:clone"));
        assert!(paths.contains_key("/claw/api/v1/studio/instances/{id}/tasks/{taskId}:run"));
        assert!(paths.contains_key("/claw/api/v1/studio/instances/{id}/tasks/{taskId}:status"));
        assert!(paths.contains_key("/claw/api/v1/studio/instances/{id}/tasks/{taskId}/executions"));
        assert!(paths.contains_key("/claw/api/v1/studio/instances/{id}/files/{fileId}"));
        assert!(paths.contains_key("/claw/api/v1/studio/instances/{id}/llm-providers/{providerId}"));
        assert!(paths.contains_key("/claw/api/v1/studio/conversations/{conversationId}"));
        assert!(paths.contains_key("/claw/internal/v1/node-sessions"));
        assert!(paths.contains_key("/claw/internal/v1/node-sessions:hello"));
        assert!(paths.contains_key("/claw/internal/v1/node-sessions/{sessionId}:admit"));
        assert!(paths.contains_key("/claw/internal/v1/node-sessions/{sessionId}:heartbeat"));
        assert!(
            paths.contains_key("/claw/internal/v1/node-sessions/{sessionId}:pull-desired-state")
        );
        assert!(paths.contains_key("/claw/internal/v1/node-sessions/{sessionId}:ack-desired-state"));
        assert!(paths.contains_key("/claw/internal/v1/node-sessions/{sessionId}:close"));
        assert!(paths.contains_key("/claw/manage/v1/rollouts"));
        assert!(paths.contains_key("/claw/manage/v1/rollouts/{rolloutId}"));
        assert!(paths.contains_key("/claw/manage/v1/rollouts/{rolloutId}/targets"));
        assert!(paths.contains_key("/claw/manage/v1/rollouts/{rolloutId}/targets/{nodeId}"));
        assert!(paths.contains_key("/claw/manage/v1/rollouts/{rolloutId}/waves"));
        assert!(paths.contains_key("/claw/manage/v1/rollouts/{rolloutId}:preview"));
        assert!(paths.contains_key("/claw/manage/v1/rollouts/{rolloutId}:start"));
        assert!(paths.contains_key("/claw/manage/v1/host-endpoints"));
        assert!(paths.contains_key("/claw/manage/v1/openclaw/runtime"));
        assert!(paths.contains_key("/claw/manage/v1/openclaw/gateway"));
        assert!(paths.contains_key("/claw/manage/v1/openclaw/gateway/invoke"));
    }

    #[tokio::test]
    async fn openapi_v1_document_describes_host_platform_state_store_driver() {
        let app = build_router(build_server_state_with_rollout_data_dir(
            create_test_rollout_data_dir("openapi-host-platform-state-store"),
        ));
        let response = app
            .oneshot(
                Request::get("/claw/openapi/v1.json")
                    .body(Body::empty())
                    .expect("openapi document request should build"),
            )
            .await
            .expect("openapi document request should succeed");
        let body = response_body_json(response).await;
        let host_platform_schema = body
            .get("components")
            .and_then(|components| components.get("schemas"))
            .and_then(|schemas| schemas.get("HostPlatformStatusRecord"))
            .and_then(Value::as_object)
            .expect("openapi document should include HostPlatformStatusRecord schema");
        let properties = host_platform_schema
            .get("properties")
            .and_then(Value::as_object)
            .expect("host platform schema should include properties");

        assert!(properties.contains_key("stateStoreDriver"));
        assert!(properties.contains_key("stateStore"));
        assert!(properties.contains_key("supportedCapabilityKeys"));
        assert!(properties.contains_key("availableCapabilityKeys"));
        assert!(properties.contains_key("distributionFamily"));
        assert!(properties.contains_key("deploymentFamily"));
        assert!(properties.contains_key("acceleratorProfile"));
        let distribution_family = properties
            .get("distributionFamily")
            .and_then(Value::as_object)
            .expect("distributionFamily schema should be present");
        let distribution_enum = distribution_family
            .get("enum")
            .and_then(Value::as_array)
            .expect("distributionFamily enum should be present");
        assert!(distribution_enum.iter().any(|value| value == "web"));
    }

    #[tokio::test]
    async fn openapi_v1_document_describes_state_store_profile_configuration_schema() {
        let app = build_router(build_server_state_with_rollout_data_dir(
            create_test_rollout_data_dir("openapi-state-store-profile"),
        ));
        let response = app
            .oneshot(
                Request::get("/claw/openapi/v1.json")
                    .body(Body::empty())
                    .expect("openapi document request should build"),
            )
            .await
            .expect("openapi document request should succeed");
        let body = response_body_json(response).await;
        let provider_properties = body
            .get("components")
            .and_then(|components| components.get("schemas"))
            .and_then(|schemas| schemas.get("HostPlatformStateStoreProviderRecord"))
            .and_then(|schema| schema.get("properties"))
            .and_then(Value::as_object)
            .expect("openapi document should include provider properties");
        let profile_properties = body
            .get("components")
            .and_then(|components| components.get("schemas"))
            .and_then(|schemas| schemas.get("HostPlatformStateStoreProfileRecord"))
            .and_then(|schema| schema.get("properties"))
            .and_then(Value::as_object)
            .expect("openapi document should include profile properties");

        assert!(provider_properties.contains_key("configurationKeys"));
        assert!(provider_properties.contains_key("projectionMode"));
        assert!(profile_properties.contains_key("configuredKeys"));
        assert!(profile_properties.contains_key("projectionMode"));
    }

    #[tokio::test]
    async fn openapi_v1_document_describes_canonical_openclaw_manage_schemas() {
        let app = build_router(build_server_state_with_rollout_data_dir(
            create_test_rollout_data_dir("openapi-openclaw-manage"),
        ));
        let response = app
            .oneshot(
                Request::get("/claw/openapi/v1.json")
                    .body(Body::empty())
                    .expect("openapi document request should build"),
            )
            .await
            .expect("openapi document request should succeed");
        let body = response_body_json(response).await;
        let schemas = body
            .get("components")
            .and_then(|components| components.get("schemas"))
            .and_then(Value::as_object)
            .expect("openapi document should include component schemas");

        assert!(schemas.contains_key("ManageHostEndpointRecord"));
        assert!(schemas.contains_key("ManageOpenClawRuntimeRecord"));
        assert!(schemas.contains_key("ManageOpenClawGatewayRecord"));
        assert!(schemas.contains_key("ManageOpenClawGatewayInvokeRequest"));
    }

    #[tokio::test]
    async fn openapi_v1_document_describes_manage_service_runtime_contract_schema() {
        let app = build_router(build_server_state_with_rollout_data_dir(
            create_test_rollout_data_dir("openapi-manage-service-runtime-contract"),
        ));
        let response = app
            .oneshot(
                Request::get("/claw/openapi/v1.json")
                    .body(Body::empty())
                    .expect("openapi document request should build"),
            )
            .await
            .expect("openapi document request should succeed");
        let body = response_body_json(response).await;
        let schemas = body
            .get("components")
            .and_then(|components| components.get("schemas"))
            .and_then(Value::as_object)
            .expect("openapi document should include component schemas");
        let manage_service_result_properties = schemas
            .get("ManageServiceExecutionResult")
            .and_then(|value| value.get("properties"))
            .and_then(Value::as_object)
            .expect("openapi document should describe ManageServiceExecutionResult");
        let manage_service_runtime_config_properties = schemas
            .get("ManageServiceRuntimeConfig")
            .and_then(|value| value.get("properties"))
            .and_then(Value::as_object)
            .expect("openapi document should describe ManageServiceRuntimeConfig");

        assert_eq!(
            manage_service_result_properties
                .get("executablePath")
                .and_then(|value| value.get("type"))
                .and_then(Value::as_str),
            Some("string")
        );
        assert_eq!(
            manage_service_result_properties
                .get("configFile")
                .and_then(|value| value.get("type"))
                .and_then(Value::as_str),
            Some("string")
        );
        assert!(
            !manage_service_result_properties.contains_key("configPath"),
            "legacy configPath should not be published in OpenAPI",
        );
        assert_eq!(
            manage_service_result_properties
                .get("runtimeConfig")
                .and_then(|value| value.get("$ref"))
                .and_then(Value::as_str),
            Some("#/components/schemas/ManageServiceRuntimeConfig")
        );
        assert_eq!(
            manage_service_runtime_config_properties
                .get("host")
                .and_then(|value| value.get("type"))
                .and_then(Value::as_str),
            Some("string")
        );
        assert_eq!(
            manage_service_runtime_config_properties
                .get("port")
                .and_then(|value| value.get("type"))
                .and_then(Value::as_str),
            Some("integer")
        );
        assert_eq!(
            manage_service_runtime_config_properties
                .get("dataDir")
                .and_then(|value| value.get("type"))
                .and_then(Value::as_str),
            Some("string")
        );
    }

    #[tokio::test]
    async fn desktop_combined_openapi_document_omits_manage_service_paths() {
        let mut state = build_server_state_with_rollout_data_dir(create_test_rollout_data_dir(
            "desktop-combined-openapi-manage-service-hidden",
        ));
        state.set_mode("desktopCombined");
        let app = build_router(state);
        let response = app
            .oneshot(
                Request::get("/claw/openapi/v1.json")
                    .body(Body::empty())
                    .expect("desktop combined openapi document request should build"),
            )
            .await
            .expect("desktop combined openapi document request should succeed");
        let body = response_body_json(response).await;
        let paths = body
            .get("paths")
            .and_then(Value::as_object)
            .expect("openapi document should include path records");

        assert!(!paths.contains_key("/claw/manage/v1/service"));
        assert!(!paths.contains_key("/claw/manage/v1/service:install"));
        assert!(!paths.contains_key("/claw/manage/v1/service:start"));
        assert!(!paths.contains_key("/claw/manage/v1/service:stop"));
        assert!(!paths.contains_key("/claw/manage/v1/service:restart"));
    }

    #[tokio::test]
    async fn openapi_v1_document_declares_json_manage_error_envelopes() {
        let app = build_router(build_server_state_with_rollout_data_dir(
            create_test_rollout_data_dir("openapi-manage-errors"),
        ));
        let response = app
            .oneshot(
                Request::get("/claw/openapi/v1.json")
                    .body(Body::empty())
                    .expect("openapi document request should build"),
            )
            .await
            .expect("openapi document request should succeed");
        let status = response.status();
        let body = response_body_json(response).await;
        let paths = body
            .get("paths")
            .and_then(Value::as_object)
            .expect("openapi document should include paths");
        let rollout_item_get = paths
            .get("/claw/manage/v1/rollouts/{rolloutId}")
            .and_then(Value::as_object)
            .and_then(|path| path.get("get"))
            .and_then(Value::as_object)
            .expect("rollout item path should expose a GET operation");
        let preview_post = paths
            .get("/claw/manage/v1/rollouts/{rolloutId}:preview")
            .and_then(Value::as_object)
            .and_then(|path| path.get("post"))
            .and_then(Value::as_object)
            .expect("rollout preview path should expose a POST operation");

        assert_eq!(status, StatusCode::OK);
        assert_eq!(
            rollout_item_get
                .get("responses")
                .and_then(Value::as_object)
                .and_then(|responses| responses.get("404"))
                .and_then(Value::as_object)
                .and_then(|response| response.get("content"))
                .and_then(Value::as_object)
                .and_then(|content| content.get("application/json"))
                .and_then(Value::as_object)
                .and_then(|json| json.get("schema"))
                .and_then(Value::as_object)
                .and_then(|schema| schema.get("$ref"))
                .and_then(Value::as_str),
            Some("#/components/schemas/InternalErrorEnvelope")
        );
        assert_eq!(
            preview_post
                .get("responses")
                .and_then(Value::as_object)
                .and_then(|responses| responses.get("400"))
                .and_then(Value::as_object)
                .and_then(|response| response.get("content"))
                .and_then(Value::as_object)
                .and_then(|content| content.get("application/json"))
                .and_then(Value::as_object)
                .and_then(|json| json.get("schema"))
                .and_then(Value::as_object)
                .and_then(|schema| schema.get("$ref"))
                .and_then(Value::as_str),
            Some("#/components/schemas/InternalErrorEnvelope")
        );
    }

    #[tokio::test]
    async fn internal_node_sessions_route_returns_projected_combined_sessions() {
        let app = build_router(build_server_state_with_rollout_data_dir(
            create_test_rollout_data_dir("node-sessions"),
        ));
        let response = app
            .oneshot(
                Request::get("/claw/internal/v1/node-sessions")
                    .body(Body::empty())
                    .expect("node sessions request should build"),
            )
            .await
            .expect("node sessions request should succeed");
        let status = response.status();
        let body = response_body_json(response).await;
        let sessions = body
            .as_array()
            .expect("node sessions response should be a json array");

        assert_eq!(status, StatusCode::OK);
        assert_eq!(sessions.len(), 2);
        assert!(sessions.iter().any(|session| {
            session.get("nodeId").and_then(Value::as_str) == Some("managed-openclaw-primary")
                && session.get("state").and_then(Value::as_str) == Some("admitted")
                && session.get("compatibilityState").and_then(Value::as_str) == Some("compatible")
        }));
        assert!(sessions.iter().any(|session| {
            session.get("nodeId").and_then(Value::as_str) == Some("managed-remote")
                && session.get("state").and_then(Value::as_str) == Some("admitted")
                && session.get("compatibilityState").and_then(Value::as_str) == Some("compatible")
                && session
                    .get("desiredStateRevision")
                    .and_then(Value::as_u64)
                    .is_some()
                && session
                    .get("desiredStateHash")
                    .and_then(Value::as_str)
                    .is_some()
        }));
    }

    #[tokio::test]
    async fn internal_node_sessions_route_uses_desktop_host_prefix_in_desktop_combined_mode() {
        let mut state = build_server_state_with_rollout_data_dir(create_test_rollout_data_dir(
            "node-sessions-desktop",
        ));
        state.set_mode("desktopCombined");
        let app = build_router(state);
        let response = app
            .oneshot(
                Request::get("/claw/internal/v1/node-sessions")
                    .body(Body::empty())
                    .expect("desktop node sessions request should build"),
            )
            .await
            .expect("desktop node sessions request should succeed");
        let status = response.status();
        let body = response_body_json(response).await;
        let sessions = body
            .as_array()
            .expect("desktop node sessions response should be a json array");

        assert_eq!(status, StatusCode::OK);
        assert!(!sessions.is_empty());
        assert!(sessions.iter().all(|session| {
            session
                .get("sessionId")
                .and_then(Value::as_str)
                .is_some_and(|value| value.starts_with("desktop-local-"))
        }));
    }

    #[tokio::test]
    async fn internal_node_sessions_hello_creates_live_session_visible_in_list() {
        let app = build_router(build_server_state_with_rollout_data_dir(
            create_test_rollout_data_dir("node-sessions-hello"),
        ));
        let hello_response = app
            .clone()
            .oneshot(
                Request::post("/claw/internal/v1/node-sessions:hello")
                    .header("content-type", "application/json")
                    .body(Body::from(
                        r#"{
                          "bootId":"boot-local-1",
                          "nodeClaim":{
                            "claimedNodeId":"managed-openclaw-primary",
                            "hostPlatform":"linux",
                            "hostArch":"x64"
                          },
                          "versionManifest":{
                            "internalApiVersion":"v1",
                            "configProjectionVersion":"v1"
                          },
                          "capabilities":["desired-state.pull","runtime.apply"]
                        }"#,
                    ))
                    .expect("node hello request should build"),
            )
            .await
            .expect("node hello request should succeed");
        let hello_status = hello_response.status();
        let hello_body = response_body_json(hello_response).await;

        let list_response = app
            .oneshot(
                Request::get("/claw/internal/v1/node-sessions")
                    .body(Body::empty())
                    .expect("node sessions list request should build"),
            )
            .await
            .expect("node sessions list request should succeed");
        let list_status = list_response.status();
        let list_body = response_body_json(list_response).await;
        let sessions = list_body
            .as_array()
            .expect("node sessions list response should be a json array");

        assert_eq!(hello_status, StatusCode::OK);
        assert_eq!(
            hello_body.get("nextAction").and_then(Value::as_str),
            Some("callAdmit")
        );
        assert_eq!(list_status, StatusCode::OK);
        assert!(sessions.iter().any(|session| {
            session.get("nodeId").and_then(Value::as_str) == Some("managed-openclaw-primary")
                && session.get("state").and_then(Value::as_str) == Some("pending")
                && session.get("compatibilityState").and_then(Value::as_str) == Some("compatible")
        }));
        assert!(sessions.iter().any(|session| {
            session.get("nodeId").and_then(Value::as_str) == Some("managed-remote")
        }));
    }

    #[tokio::test]
    async fn internal_node_sessions_follow_the_active_rollout_after_start() {
        let app = build_router(build_server_state_with_rollout_data_dir(
            create_test_rollout_data_dir("node-sessions-active-rollout"),
        ));

        let preview_response = app
            .clone()
            .oneshot(
                Request::post("/claw/manage/v1/rollouts/rollout-c:preview")
                    .header("content-type", "application/json")
                    .body(Body::from(
                        r#"{"includeTargets":true,"forceRecompute":false}"#,
                    ))
                    .expect("rollout preview request should build"),
            )
            .await
            .expect("rollout preview request should succeed");
        let preview_status = preview_response.status();

        let start_response = app
            .clone()
            .oneshot(
                Request::post("/claw/manage/v1/rollouts/rollout-c:start")
                    .body(Body::empty())
                    .expect("rollout start request should build"),
            )
            .await
            .expect("rollout start request should succeed");
        let start_status = start_response.status();

        let list_response = app
            .oneshot(
                Request::get("/claw/internal/v1/node-sessions")
                    .body(Body::empty())
                    .expect("node sessions list request should build"),
            )
            .await
            .expect("node sessions list request should succeed");
        let list_status = list_response.status();
        let list_body = response_body_json(list_response).await;
        let sessions = list_body
            .as_array()
            .expect("node sessions list response should be a json array");

        assert_eq!(preview_status, StatusCode::OK);
        assert_eq!(start_status, StatusCode::OK);
        assert_eq!(list_status, StatusCode::OK);
        assert!(sessions.iter().any(|session| {
            session.get("nodeId").and_then(Value::as_str) == Some("archive-node")
        }));
        assert!(!sessions.iter().any(|session| {
            session.get("nodeId").and_then(Value::as_str) == Some("managed-openclaw-primary")
        }));
    }

    #[tokio::test]
    async fn internal_node_sessions_admit_transitions_live_session_state() {
        let app = build_router(build_server_state_with_rollout_data_dir(
            create_test_rollout_data_dir("node-sessions-admit"),
        ));
        let hello_response = app
            .clone()
            .oneshot(
                Request::post("/claw/internal/v1/node-sessions:hello")
                    .header("content-type", "application/json")
                    .body(Body::from(
                        r#"{
                          "bootId":"boot-local-1",
                          "nodeClaim":{
                            "claimedNodeId":"managed-openclaw-primary",
                            "hostPlatform":"linux",
                            "hostArch":"x64"
                          },
                          "versionManifest":{
                            "internalApiVersion":"v1",
                            "configProjectionVersion":"v1"
                          },
                          "capabilities":["desired-state.pull","runtime.apply"]
                        }"#,
                    ))
                    .expect("node hello request should build"),
            )
            .await
            .expect("node hello request should succeed");
        let hello_body = response_body_json(hello_response).await;
        let session_id = hello_body
            .get("sessionId")
            .and_then(Value::as_str)
            .expect("hello response should include sessionId");
        let hello_token = hello_body
            .get("helloToken")
            .and_then(Value::as_str)
            .expect("hello response should include helloToken");

        let admit_response = app
            .clone()
            .oneshot(
                Request::post(format!(
                    "/claw/internal/v1/node-sessions/{session_id}:admit"
                ))
                .header("content-type", "application/json")
                .body(Body::from(format!(r#"{{"helloToken":"{hello_token}"}}"#)))
                .expect("node admit request should build"),
            )
            .await
            .expect("node admit request should succeed");
        let admit_status = admit_response.status();
        let admit_body = response_body_json(admit_response).await;

        let list_response = app
            .oneshot(
                Request::get("/claw/internal/v1/node-sessions")
                    .body(Body::empty())
                    .expect("node sessions list request should build"),
            )
            .await
            .expect("node sessions list request should succeed");
        let list_body = response_body_json(list_response).await;
        let sessions = list_body
            .as_array()
            .expect("node sessions list response should be a json array");

        assert_eq!(admit_status, StatusCode::OK);
        assert_eq!(
            admit_body.get("sessionId").and_then(Value::as_str),
            Some(session_id)
        );
        assert!(sessions.iter().any(|session| {
            session.get("nodeId").and_then(Value::as_str) == Some("managed-openclaw-primary")
                && session.get("state").and_then(Value::as_str) == Some("admitted")
        }));
    }

    #[tokio::test]
    async fn internal_node_sessions_admit_invalid_body_returns_error_envelope() {
        let app = build_router(build_server_state_with_rollout_data_dir(
            create_test_rollout_data_dir("node-sessions-admit-invalid-body"),
        ));
        let hello_response = app
            .clone()
            .oneshot(
                Request::post("/claw/internal/v1/node-sessions:hello")
                    .header("content-type", "application/json")
                    .body(Body::from(
                        r#"{
                          "bootId":"boot-local-1",
                          "nodeClaim":{
                            "claimedNodeId":"managed-openclaw-primary",
                            "hostPlatform":"linux",
                            "hostArch":"x64"
                          },
                          "versionManifest":{
                            "internalApiVersion":"v1",
                            "configProjectionVersion":"v1"
                          },
                          "capabilities":["desired-state.pull","runtime.apply"]
                        }"#,
                    ))
                    .expect("node hello request should build"),
            )
            .await
            .expect("node hello request should succeed");
        let hello_body = response_body_json(hello_response).await;
        let session_id = hello_body
            .get("sessionId")
            .and_then(Value::as_str)
            .expect("hello response should include sessionId");

        let invalid_admit_response = app
            .oneshot(
                Request::post(format!(
                    "/claw/internal/v1/node-sessions/{session_id}:admit"
                ))
                .header("content-type", "application/json")
                .body(Body::from(r#"{"unexpected":"value"}"#))
                .expect("invalid admit request should build"),
            )
            .await
            .expect("invalid admit request should return a response");
        let invalid_admit_status = invalid_admit_response.status();
        let invalid_admit_correlation_id = invalid_admit_response
            .headers()
            .get("x-claw-correlation-id")
            .and_then(|value| value.to_str().ok())
            .map(str::to_string)
            .expect("invalid admit response should include x-claw-correlation-id");
        let invalid_admit_body = response_body_json(invalid_admit_response).await;
        let error = invalid_admit_body
            .get("error")
            .and_then(Value::as_object)
            .expect("invalid admit response should include an error envelope");

        assert_eq!(invalid_admit_status, StatusCode::BAD_REQUEST);
        assert_eq!(
            error.get("code").and_then(Value::as_str),
            Some("invalid_body")
        );
        assert_eq!(
            error.get("category").and_then(Value::as_str),
            Some("validation")
        );
        assert_eq!(
            error.get("resolution").and_then(Value::as_str),
            Some("fix_request")
        );
        assert_eq!(
            error.get("correlationId").and_then(Value::as_str),
            Some(invalid_admit_correlation_id.as_str())
        );
    }

    #[tokio::test]
    async fn internal_node_sessions_heartbeat_refreshes_live_session() {
        let app = build_router(build_server_state_with_rollout_data_dir(
            create_test_rollout_data_dir("node-sessions-heartbeat"),
        ));
        let hello_response = app
            .clone()
            .oneshot(
                Request::post("/claw/internal/v1/node-sessions:hello")
                    .header("content-type", "application/json")
                    .body(Body::from(
                        r#"{
                          "bootId":"boot-local-1",
                          "nodeClaim":{
                            "claimedNodeId":"managed-openclaw-primary",
                            "hostPlatform":"linux",
                            "hostArch":"x64"
                          },
                          "versionManifest":{
                            "internalApiVersion":"v1",
                            "configProjectionVersion":"v1"
                          },
                          "capabilities":["desired-state.pull","runtime.apply"]
                        }"#,
                    ))
                    .expect("node hello request should build"),
            )
            .await
            .expect("node hello request should succeed");
        let hello_body = response_body_json(hello_response).await;
        let session_id = hello_body
            .get("sessionId")
            .and_then(Value::as_str)
            .expect("hello response should include sessionId");
        let hello_token = hello_body
            .get("helloToken")
            .and_then(Value::as_str)
            .expect("hello response should include helloToken");

        let admit_response = app
            .clone()
            .oneshot(
                Request::post(format!(
                    "/claw/internal/v1/node-sessions/{session_id}:admit"
                ))
                .header("content-type", "application/json")
                .body(Body::from(format!(r#"{{"helloToken":"{hello_token}"}}"#)))
                .expect("node admit request should build"),
            )
            .await
            .expect("node admit request should succeed");
        let admit_body = response_body_json(admit_response).await;
        let lease_id = admit_body
            .get("lease")
            .and_then(Value::as_object)
            .and_then(|lease| lease.get("leaseId"))
            .and_then(Value::as_str)
            .expect("admit response should include leaseId");

        let heartbeat_response = app
            .clone()
            .oneshot(
                Request::post(format!(
                    "/claw/internal/v1/node-sessions/{session_id}:heartbeat"
                ))
                .header("content-type", "application/json")
                .body(Body::from(format!(r#"{{"leaseId":"{lease_id}"}}"#)))
                .expect("node heartbeat request should build"),
            )
            .await
            .expect("node heartbeat request should succeed");
        let heartbeat_status = heartbeat_response.status();
        let heartbeat_body = response_body_json(heartbeat_response).await;

        let list_response = app
            .oneshot(
                Request::get("/claw/internal/v1/node-sessions")
                    .body(Body::empty())
                    .expect("node sessions list request should build"),
            )
            .await
            .expect("node sessions list request should succeed");
        let list_body = response_body_json(list_response).await;
        let sessions = list_body
            .as_array()
            .expect("node sessions list response should be a json array");

        assert_eq!(heartbeat_status, StatusCode::OK);
        assert_eq!(
            heartbeat_body
                .get("lease")
                .and_then(Value::as_object)
                .and_then(|lease| lease.get("leaseId"))
                .and_then(Value::as_str),
            Some(lease_id)
        );
        assert!(sessions.iter().any(|session| {
            session.get("nodeId").and_then(Value::as_str) == Some("managed-openclaw-primary")
                && session.get("state").and_then(Value::as_str) == Some("admitted")
                && session
                    .get("lastSeenAt")
                    .and_then(Value::as_u64)
                    .is_some_and(|value| value > 0)
        }));
    }

    #[tokio::test]
    async fn internal_node_sessions_pull_desired_state_returns_projection_then_not_modified() {
        let app = build_router(build_server_state_with_rollout_data_dir(
            create_test_rollout_data_dir("node-sessions-pull"),
        ));
        let hello_response = app
            .clone()
            .oneshot(
                Request::post("/claw/internal/v1/node-sessions:hello")
                    .header("content-type", "application/json")
                    .body(Body::from(
                        r#"{
                          "bootId":"boot-local-1",
                          "nodeClaim":{
                            "claimedNodeId":"managed-openclaw-primary",
                            "hostPlatform":"linux",
                            "hostArch":"x64"
                          },
                          "versionManifest":{
                            "internalApiVersion":"v1",
                            "configProjectionVersion":"v1"
                          },
                          "capabilities":["desired-state.pull","runtime.apply"]
                        }"#,
                    ))
                    .expect("node hello request should build"),
            )
            .await
            .expect("node hello request should succeed");
        let hello_body = response_body_json(hello_response).await;
        let session_id = hello_body
            .get("sessionId")
            .and_then(Value::as_str)
            .expect("hello response should include sessionId");
        let hello_token = hello_body
            .get("helloToken")
            .and_then(Value::as_str)
            .expect("hello response should include helloToken");

        let admit_response = app
            .clone()
            .oneshot(
                Request::post(format!(
                    "/claw/internal/v1/node-sessions/{session_id}:admit"
                ))
                .header("content-type", "application/json")
                .body(Body::from(format!(r#"{{"helloToken":"{hello_token}"}}"#)))
                .expect("node admit request should build"),
            )
            .await
            .expect("node admit request should succeed");
        let admit_body = response_body_json(admit_response).await;
        let lease_id = admit_body
            .get("lease")
            .and_then(Value::as_object)
            .and_then(|lease| lease.get("leaseId"))
            .and_then(Value::as_str)
            .expect("admit response should include leaseId");

        let first_pull_response = app
            .clone()
            .oneshot(
                Request::post(format!(
                    "/claw/internal/v1/node-sessions/{session_id}:pull-desired-state"
                ))
                .header("content-type", "application/json")
                .body(Body::from(format!(
                    r#"{{
                      "leaseId":"{lease_id}",
                      "supportedConfigProjectionVersions":["v1"],
                      "effectiveCapabilities":["desired-state.pull","runtime.apply"]
                    }}"#
                )))
                .expect("node pull desired state request should build"),
            )
            .await
            .expect("node pull desired state request should succeed");
        let first_pull_status = first_pull_response.status();
        let first_pull_body = response_body_json(first_pull_response).await;
        let desired_state_revision = first_pull_body
            .get("desiredStateRevision")
            .and_then(Value::as_u64)
            .expect("projection response should include desiredStateRevision");
        let desired_state_hash = first_pull_body
            .get("desiredStateHash")
            .and_then(Value::as_str)
            .expect("projection response should include desiredStateHash");

        let second_pull_response = app
            .clone()
            .oneshot(
                Request::post(format!(
                    "/claw/internal/v1/node-sessions/{session_id}:pull-desired-state"
                ))
                .header("content-type", "application/json")
                .body(Body::from(format!(
                    r#"{{
                      "leaseId":"{lease_id}",
                      "knownRevision":{desired_state_revision},
                      "knownHash":"{desired_state_hash}",
                      "supportedConfigProjectionVersions":["v1"],
                      "effectiveCapabilities":["desired-state.pull","runtime.apply"]
                    }}"#
                )))
                .expect("node pull desired state request should build"),
            )
            .await
            .expect("node pull desired state request should succeed");
        let second_pull_status = second_pull_response.status();
        let second_pull_body = response_body_json(second_pull_response).await;

        assert_eq!(first_pull_status, StatusCode::OK);
        assert_eq!(
            first_pull_body.get("mode").and_then(Value::as_str),
            Some("projection")
        );
        assert_eq!(
            first_pull_body
                .get("projection")
                .and_then(Value::as_object)
                .and_then(|projection| projection.get("nodeId"))
                .and_then(Value::as_str),
            Some("managed-openclaw-primary")
        );
        assert_eq!(second_pull_status, StatusCode::OK);
        assert_eq!(
            second_pull_body.get("mode").and_then(Value::as_str),
            Some("notModified")
        );
    }

    #[tokio::test]
    async fn internal_node_sessions_ack_desired_state_records_apply_markers() {
        let app = build_router(build_server_state_with_rollout_data_dir(
            create_test_rollout_data_dir("node-sessions-ack"),
        ));
        let hello_response = app
            .clone()
            .oneshot(
                Request::post("/claw/internal/v1/node-sessions:hello")
                    .header("content-type", "application/json")
                    .body(Body::from(
                        r#"{
                          "bootId":"boot-local-1",
                          "nodeClaim":{
                            "claimedNodeId":"managed-openclaw-primary",
                            "hostPlatform":"linux",
                            "hostArch":"x64"
                          },
                          "versionManifest":{
                            "internalApiVersion":"v1",
                            "configProjectionVersion":"v1"
                          },
                          "capabilities":["desired-state.pull","runtime.apply"]
                        }"#,
                    ))
                    .expect("node hello request should build"),
            )
            .await
            .expect("node hello request should succeed");
        let hello_body = response_body_json(hello_response).await;
        let session_id = hello_body
            .get("sessionId")
            .and_then(Value::as_str)
            .expect("hello response should include sessionId");
        let hello_token = hello_body
            .get("helloToken")
            .and_then(Value::as_str)
            .expect("hello response should include helloToken");

        let admit_response = app
            .clone()
            .oneshot(
                Request::post(format!(
                    "/claw/internal/v1/node-sessions/{session_id}:admit"
                ))
                .header("content-type", "application/json")
                .body(Body::from(format!(r#"{{"helloToken":"{hello_token}"}}"#)))
                .expect("node admit request should build"),
            )
            .await
            .expect("node admit request should succeed");
        let admit_body = response_body_json(admit_response).await;
        let lease_id = admit_body
            .get("lease")
            .and_then(Value::as_object)
            .and_then(|lease| lease.get("leaseId"))
            .and_then(Value::as_str)
            .expect("admit response should include leaseId");

        let pull_response = app
            .clone()
            .oneshot(
                Request::post(format!(
                    "/claw/internal/v1/node-sessions/{session_id}:pull-desired-state"
                ))
                .header("content-type", "application/json")
                .body(Body::from(format!(
                    r#"{{
                      "leaseId":"{lease_id}",
                      "supportedConfigProjectionVersions":["v1"],
                      "effectiveCapabilities":["desired-state.pull","runtime.apply"]
                    }}"#
                )))
                .expect("node pull desired state request should build"),
            )
            .await
            .expect("node pull desired state request should succeed");
        let pull_body = response_body_json(pull_response).await;
        let desired_state_revision = pull_body
            .get("desiredStateRevision")
            .and_then(Value::as_u64)
            .expect("pull response should include desiredStateRevision");
        let desired_state_hash = pull_body
            .get("desiredStateHash")
            .and_then(Value::as_str)
            .expect("pull response should include desiredStateHash");

        let ack_response = app
            .clone()
            .oneshot(
                Request::post(format!(
                    "/claw/internal/v1/node-sessions/{session_id}:ack-desired-state"
                ))
                .header("content-type", "application/json")
                .body(Body::from(format!(
                    r#"{{
                      "leaseId":"{lease_id}",
                      "desiredStateRevision":{desired_state_revision},
                      "desiredStateHash":"{desired_state_hash}",
                      "result":"applied",
                      "effectiveCapabilities":["desired-state.pull","runtime.apply"],
                      "observedEndpoints":["http://127.0.0.1:18797"],
                      "applySummary":{{
                        "appliedAt":4567,
                        "errors":[],
                        "warnings":[],
                        "compatibilityReasons":[]
                      }}
                    }}"#
                )))
                .expect("node ack desired state request should build"),
            )
            .await
            .expect("node ack desired state request should succeed");
        let ack_status = ack_response.status();
        let ack_body = response_body_json(ack_response).await;

        let list_response = app
            .oneshot(
                Request::get("/claw/internal/v1/node-sessions")
                    .body(Body::empty())
                    .expect("node sessions list request should build"),
            )
            .await
            .expect("node sessions list request should succeed");
        let list_status = list_response.status();
        let list_body = response_body_json(list_response).await;
        let sessions = list_body
            .as_array()
            .expect("node sessions list response should be a json array");

        assert_eq!(ack_status, StatusCode::OK);
        assert_eq!(
            ack_body.get("recorded").and_then(Value::as_bool),
            Some(true)
        );
        assert_eq!(
            ack_body.get("nextExpectedRevision").and_then(Value::as_u64),
            Some(desired_state_revision)
        );
        assert_eq!(list_status, StatusCode::OK);
        assert!(sessions.iter().any(|session| {
            session.get("nodeId").and_then(Value::as_str) == Some("managed-openclaw-primary")
                && session.get("lastAppliedRevision").and_then(Value::as_u64)
                    == Some(desired_state_revision)
                && session.get("lastKnownGoodRevision").and_then(Value::as_u64)
                    == Some(desired_state_revision)
                && session.get("lastApplyResult").and_then(Value::as_str) == Some("applied")
        }));
    }

    #[tokio::test]
    async fn internal_node_sessions_ack_desired_state_rejects_stale_revision() {
        let rollout_data_dir = create_test_rollout_data_dir("node-sessions-stale-ack");
        let app = build_router(build_server_state_with_overrides(
            rollout_data_dir.clone(),
            ServerStateOverrides {
                state_store_driver: Some("json-file".to_string()),
                ..ServerStateOverrides::default()
            },
        ));
        let hello_response = app
            .clone()
            .oneshot(
                Request::post("/claw/internal/v1/node-sessions:hello")
                    .header("content-type", "application/json")
                    .body(Body::from(
                        r#"{
                          "bootId":"boot-local-1",
                          "nodeClaim":{
                            "claimedNodeId":"managed-openclaw-primary",
                            "hostPlatform":"linux",
                            "hostArch":"x64"
                          },
                          "versionManifest":{
                            "internalApiVersion":"v1",
                            "configProjectionVersion":"v1"
                          },
                          "capabilities":["desired-state.pull","runtime.apply"]
                        }"#,
                    ))
                    .expect("node hello request should build"),
            )
            .await
            .expect("node hello request should succeed");
        let hello_body = response_body_json(hello_response).await;
        let session_id = hello_body
            .get("sessionId")
            .and_then(Value::as_str)
            .expect("hello response should include sessionId");
        let hello_token = hello_body
            .get("helloToken")
            .and_then(Value::as_str)
            .expect("hello response should include helloToken");

        let admit_response = app
            .clone()
            .oneshot(
                Request::post(format!(
                    "/claw/internal/v1/node-sessions/{session_id}:admit"
                ))
                .header("content-type", "application/json")
                .body(Body::from(format!(r#"{{"helloToken":"{hello_token}"}}"#)))
                .expect("node admit request should build"),
            )
            .await
            .expect("node admit request should succeed");
        let admit_body = response_body_json(admit_response).await;
        let lease_id = admit_body
            .get("lease")
            .and_then(Value::as_object)
            .and_then(|lease| lease.get("leaseId"))
            .and_then(Value::as_str)
            .expect("admit response should include leaseId");

        let first_pull_response = app
            .clone()
            .oneshot(
                Request::post(format!(
                    "/claw/internal/v1/node-sessions/{session_id}:pull-desired-state"
                ))
                .header("content-type", "application/json")
                .body(Body::from(format!(
                    r#"{{
                      "leaseId":"{lease_id}",
                      "supportedConfigProjectionVersions":["v1"],
                      "effectiveCapabilities":["desired-state.pull","runtime.apply"]
                    }}"#
                )))
                .expect("initial pull request should build"),
            )
            .await
            .expect("initial pull request should succeed");
        let first_pull_body = response_body_json(first_pull_response).await;
        let desired_state_revision = first_pull_body
            .get("desiredStateRevision")
            .and_then(Value::as_u64)
            .expect("initial pull response should include desiredStateRevision");
        let desired_state_hash = first_pull_body
            .get("desiredStateHash")
            .and_then(Value::as_str)
            .expect("initial pull response should include desiredStateHash");

        advance_rollout_target_semantic_payload(
            &rollout_data_dir,
            "rollout-a",
            "managed-openclaw-primary",
            ";generation=2",
        );
        let refreshed_app = build_router(build_server_state_with_overrides(
            rollout_data_dir.clone(),
            ServerStateOverrides {
                state_store_driver: Some("json-file".to_string()),
                ..ServerStateOverrides::default()
            },
        ));

        let refreshed_pull_response = refreshed_app
            .clone()
            .oneshot(
                Request::post(format!(
                    "/claw/internal/v1/node-sessions/{session_id}:pull-desired-state"
                ))
                .header("content-type", "application/json")
                .body(Body::from(format!(
                    r#"{{
                      "leaseId":"{lease_id}",
                      "knownRevision":{desired_state_revision},
                      "knownHash":"{desired_state_hash}",
                      "supportedConfigProjectionVersions":["v1"],
                      "effectiveCapabilities":["desired-state.pull","runtime.apply"]
                    }}"#
                )))
                .expect("refreshed pull request should build"),
            )
            .await
            .expect("refreshed pull request should succeed");
        let refreshed_pull_status = refreshed_pull_response.status();
        let refreshed_pull_body = response_body_json(refreshed_pull_response).await;
        let next_desired_state_revision = refreshed_pull_body
            .get("desiredStateRevision")
            .and_then(Value::as_u64)
            .expect("refreshed pull response should include desiredStateRevision");

        let stale_ack_response = refreshed_app
            .oneshot(
                Request::post(format!(
                    "/claw/internal/v1/node-sessions/{session_id}:ack-desired-state"
                ))
                .header("content-type", "application/json")
                .body(Body::from(format!(
                    r#"{{
                      "leaseId":"{lease_id}",
                      "desiredStateRevision":{desired_state_revision},
                      "desiredStateHash":"{desired_state_hash}",
                      "result":"applied",
                      "effectiveCapabilities":["desired-state.pull","runtime.apply"],
                      "observedEndpoints":["http://127.0.0.1:18797"],
                      "applySummary":{{
                        "appliedAt":4567,
                        "errors":[],
                        "warnings":[],
                        "compatibilityReasons":[]
                      }}
                    }}"#
                )))
                .expect("stale ack request should build"),
            )
            .await
            .expect("stale ack request should return a response");
        let stale_ack_status = stale_ack_response.status();
        let stale_ack_correlation_id = stale_ack_response
            .headers()
            .get("x-claw-correlation-id")
            .and_then(|value| value.to_str().ok())
            .map(str::to_string)
            .expect("stale ack response should include x-claw-correlation-id");
        let stale_ack_body = response_body_json(stale_ack_response).await;
        let stale_ack_error = stale_ack_body
            .get("error")
            .and_then(Value::as_object)
            .expect("stale ack response should include an error envelope");

        assert_eq!(refreshed_pull_status, StatusCode::OK);
        assert_eq!(
            refreshed_pull_body.get("mode").and_then(Value::as_str),
            Some("projection")
        );
        assert!(next_desired_state_revision > desired_state_revision);
        assert_eq!(stale_ack_status, StatusCode::CONFLICT);
        assert_eq!(
            stale_ack_error.get("code").and_then(Value::as_str),
            Some("stale_ack")
        );
        assert_eq!(
            stale_ack_error.get("category").and_then(Value::as_str),
            Some("state")
        );
        assert_eq!(
            stale_ack_error.get("resolution").and_then(Value::as_str),
            Some("fetch_latest_projection")
        );
        assert_eq!(
            stale_ack_error.get("correlationId").and_then(Value::as_str),
            Some(stale_ack_correlation_id.as_str())
        );
    }

    #[tokio::test]
    async fn internal_node_sessions_heartbeat_rejects_expired_lease() {
        let state = build_server_state_with_rollout_data_dir(create_test_rollout_data_dir(
            "node-sessions-expired-lease",
        ));
        let compatibility_preview = state
            .rollout_control_plane
            .preview_node_session_compatibility("rollout-a", "managed-openclaw-primary")
            .expect("compatibility preview should succeed");
        let hello = state
            .node_session_registry
            .hello(
                sdkwork_agentstudio_host_core::internal::node_sessions::NodeSessionHelloInput {
                    boot_id: "boot-local-1".to_string(),
                    node_claim: sdkwork_agentstudio_host_core::internal::node_sessions::NodeSessionHelloNodeClaim {
                        claimed_node_id: Some("managed-openclaw-primary".to_string()),
                        host_platform: Some("linux".to_string()),
                        host_arch: Some("x64".to_string()),
                    },
                    version_manifest: sdkwork_agentstudio_host_core::internal::node_sessions::NodeSessionHelloVersionManifest {
                        internal_api_version: "v1".to_string(),
                        config_projection_version: Some("v1".to_string()),
                    },
                    capabilities: vec![
                        "desired-state.pull".to_string(),
                        "runtime.apply".to_string(),
                    ],
                },
                compatibility_preview,
                1_000,
            )
            .expect("hello should create a live session");
        let admit = state
            .node_session_registry
            .admit(
                &hello.session_id,
                sdkwork_agentstudio_host_core::internal::node_sessions::NodeSessionAdmitInput {
                    hello_token: hello.hello_token.clone(),
                },
                2_000,
            )
            .expect("admit should transition the session");
        let session_id = hello.session_id.clone();
        let lease_id = admit.lease.lease_id.clone();
        let app = build_router(state);

        let response = app
            .oneshot(
                Request::post(format!(
                    "/claw/internal/v1/node-sessions/{session_id}:heartbeat"
                ))
                .header("content-type", "application/json")
                .body(Body::from(format!(r#"{{"leaseId":"{lease_id}"}}"#)))
                .expect("node heartbeat request should build"),
            )
            .await
            .expect("node heartbeat request should return a response");
        let status = response.status();
        let body = response_body_text(response).await;

        assert_eq!(status, StatusCode::CONFLICT);
        assert!(body.contains("expired"));
    }

    #[tokio::test]
    async fn internal_node_sessions_close_transitions_live_session_to_closed() {
        let app = build_router(build_server_state_with_rollout_data_dir(
            create_test_rollout_data_dir("node-sessions-close"),
        ));
        let hello_response = app
            .clone()
            .oneshot(
                Request::post("/claw/internal/v1/node-sessions:hello")
                    .header("content-type", "application/json")
                    .body(Body::from(
                        r#"{
                          "bootId":"boot-local-1",
                          "nodeClaim":{
                            "claimedNodeId":"managed-openclaw-primary",
                            "hostPlatform":"linux",
                            "hostArch":"x64"
                          },
                          "versionManifest":{
                            "internalApiVersion":"v1",
                            "configProjectionVersion":"v1"
                          },
                          "capabilities":["desired-state.pull","runtime.apply"]
                        }"#,
                    ))
                    .expect("node hello request should build"),
            )
            .await
            .expect("node hello request should succeed");
        let hello_body = response_body_json(hello_response).await;
        let session_id = hello_body
            .get("sessionId")
            .and_then(Value::as_str)
            .expect("hello response should include sessionId");
        let hello_token = hello_body
            .get("helloToken")
            .and_then(Value::as_str)
            .expect("hello response should include helloToken");

        let admit_response = app
            .clone()
            .oneshot(
                Request::post(format!(
                    "/claw/internal/v1/node-sessions/{session_id}:admit"
                ))
                .header("content-type", "application/json")
                .body(Body::from(format!(r#"{{"helloToken":"{hello_token}"}}"#)))
                .expect("node admit request should build"),
            )
            .await
            .expect("node admit request should succeed");
        let admit_body = response_body_json(admit_response).await;
        let lease_id = admit_body
            .get("lease")
            .and_then(Value::as_object)
            .and_then(|lease| lease.get("leaseId"))
            .and_then(Value::as_str)
            .expect("admit response should include leaseId");

        let close_response = app
            .clone()
            .oneshot(
                Request::post(format!(
                    "/claw/internal/v1/node-sessions/{session_id}:close"
                ))
                .header("content-type", "application/json")
                .body(Body::from(format!(
                    r#"{{
                      "leaseId":"{lease_id}",
                      "reason":"shutdown"
                    }}"#
                )))
                .expect("node close request should build"),
            )
            .await
            .expect("node close request should succeed");
        let close_status = close_response.status();
        let close_body = response_body_json(close_response).await;

        let list_response = app
            .oneshot(
                Request::get("/claw/internal/v1/node-sessions")
                    .body(Body::empty())
                    .expect("node sessions list request should build"),
            )
            .await
            .expect("node sessions list request should succeed");
        let list_status = list_response.status();
        let list_body = response_body_json(list_response).await;
        let sessions = list_body
            .as_array()
            .expect("node sessions list response should be a json array");

        assert_eq!(close_status, StatusCode::OK);
        assert_eq!(
            close_body.get("closed").and_then(Value::as_bool),
            Some(true)
        );
        assert_eq!(
            close_body
                .get("replacementExpected")
                .and_then(Value::as_bool),
            Some(false)
        );
        assert_eq!(list_status, StatusCode::OK);
        assert!(sessions.iter().any(|session| {
            session.get("nodeId").and_then(Value::as_str) == Some("managed-openclaw-primary")
                && session.get("state").and_then(Value::as_str) == Some("closed")
        }));
    }

    #[tokio::test]
    async fn internal_node_sessions_close_with_successor_keeps_successor_visible() {
        let state = build_server_state_with_rollout_data_dir(create_test_rollout_data_dir(
            "node-sessions-close-successor",
        ));
        let compatibility_preview = state
            .rollout_control_plane
            .preview_node_session_compatibility("rollout-a", "managed-openclaw-primary")
            .expect("compatibility preview should succeed");
        let first_hello = state
            .node_session_registry
            .hello(
                sdkwork_agentstudio_host_core::internal::node_sessions::NodeSessionHelloInput {
                    boot_id: "boot-local-1".to_string(),
                    node_claim: sdkwork_agentstudio_host_core::internal::node_sessions::NodeSessionHelloNodeClaim {
                        claimed_node_id: Some("managed-openclaw-primary".to_string()),
                        host_platform: Some("linux".to_string()),
                        host_arch: Some("x64".to_string()),
                    },
                    version_manifest: sdkwork_agentstudio_host_core::internal::node_sessions::NodeSessionHelloVersionManifest {
                        internal_api_version: "v1".to_string(),
                        config_projection_version: Some("v1".to_string()),
                    },
                    capabilities: vec![
                        "desired-state.pull".to_string(),
                        "runtime.apply".to_string(),
                    ],
                },
                compatibility_preview.clone(),
                1_000,
            )
            .expect("first hello should create a live session");
        let first_admit = state
            .node_session_registry
            .admit(
                &first_hello.session_id,
                sdkwork_agentstudio_host_core::internal::node_sessions::NodeSessionAdmitInput {
                    hello_token: first_hello.hello_token.clone(),
                },
                2_000,
            )
            .expect("first admit should transition the session");
        let second_hello = state
            .node_session_registry
            .hello(
                sdkwork_agentstudio_host_core::internal::node_sessions::NodeSessionHelloInput {
                    boot_id: "boot-local-2".to_string(),
                    node_claim: sdkwork_agentstudio_host_core::internal::node_sessions::NodeSessionHelloNodeClaim {
                        claimed_node_id: Some("managed-openclaw-primary".to_string()),
                        host_platform: Some("linux".to_string()),
                        host_arch: Some("x64".to_string()),
                    },
                    version_manifest: sdkwork_agentstudio_host_core::internal::node_sessions::NodeSessionHelloVersionManifest {
                        internal_api_version: "v1".to_string(),
                        config_projection_version: Some("v1".to_string()),
                    },
                    capabilities: vec![
                        "desired-state.pull".to_string(),
                        "runtime.apply".to_string(),
                    ],
                },
                compatibility_preview,
                3_000,
            )
            .expect("second hello should create the successor session");
        state
            .node_session_registry
            .admit(
                &second_hello.session_id,
                sdkwork_agentstudio_host_core::internal::node_sessions::NodeSessionAdmitInput {
                    hello_token: second_hello.hello_token.clone(),
                },
                4_000,
            )
            .expect("second admit should transition the successor session");
        state
            .node_session_registry
            .close(
                &first_hello.session_id,
                sdkwork_agentstudio_host_core::internal::node_sessions::NodeSessionCloseInput {
                    lease_id: first_admit.lease.lease_id.clone(),
                    reason: "restart".to_string(),
                    successor_hint: Some(second_hello.session_id.clone()),
                },
                5_000,
            )
            .expect("close should persist the successor hint");
        let app = build_router(state);

        let list_response = app
            .oneshot(
                Request::get("/claw/internal/v1/node-sessions")
                    .body(Body::empty())
                    .expect("node sessions list request should build"),
            )
            .await
            .expect("node sessions list request should succeed");
        let list_status = list_response.status();
        let list_body = response_body_json(list_response).await;
        let sessions = list_body
            .as_array()
            .expect("node sessions list response should be a json array");

        assert_eq!(list_status, StatusCode::OK);
        assert!(sessions.iter().any(|session| {
            session.get("nodeId").and_then(Value::as_str) == Some("managed-openclaw-primary")
                && session.get("sessionId").and_then(Value::as_str)
                    == Some(second_hello.session_id.as_str())
                && session.get("state").and_then(Value::as_str) == Some("admitted")
        }));
    }

    #[tokio::test]
    async fn internal_node_sessions_heartbeat_rejects_replaced_session() {
        let app = build_router(build_server_state_with_rollout_data_dir(
            create_test_rollout_data_dir("node-sessions-replaced-heartbeat"),
        ));
        let first_hello_response = app
            .clone()
            .oneshot(
                Request::post("/claw/internal/v1/node-sessions:hello")
                    .header("content-type", "application/json")
                    .body(Body::from(
                        r#"{
                          "bootId":"boot-local-1",
                          "nodeClaim":{
                            "claimedNodeId":"managed-openclaw-primary",
                            "hostPlatform":"linux",
                            "hostArch":"x64"
                          },
                          "versionManifest":{
                            "internalApiVersion":"v1",
                            "configProjectionVersion":"v1"
                          },
                          "capabilities":["desired-state.pull","runtime.apply"]
                        }"#,
                    ))
                    .expect("first node hello request should build"),
            )
            .await
            .expect("first node hello request should succeed");
        let first_hello_body = response_body_json(first_hello_response).await;
        let first_session_id = first_hello_body
            .get("sessionId")
            .and_then(Value::as_str)
            .expect("first hello response should include sessionId");
        let first_hello_token = first_hello_body
            .get("helloToken")
            .and_then(Value::as_str)
            .expect("first hello response should include helloToken");

        let first_admit_response = app
            .clone()
            .oneshot(
                Request::post(format!(
                    "/claw/internal/v1/node-sessions/{first_session_id}:admit"
                ))
                .header("content-type", "application/json")
                .body(Body::from(format!(
                    r#"{{"helloToken":"{first_hello_token}"}}"#
                )))
                .expect("first node admit request should build"),
            )
            .await
            .expect("first node admit request should succeed");
        let first_admit_body = response_body_json(first_admit_response).await;
        let first_lease_id = first_admit_body
            .get("lease")
            .and_then(Value::as_object)
            .and_then(|lease| lease.get("leaseId"))
            .and_then(Value::as_str)
            .expect("first admit response should include leaseId");

        let second_hello_response = app
            .clone()
            .oneshot(
                Request::post("/claw/internal/v1/node-sessions:hello")
                    .header("content-type", "application/json")
                    .body(Body::from(
                        r#"{
                          "bootId":"boot-local-2",
                          "nodeClaim":{
                            "claimedNodeId":"managed-openclaw-primary",
                            "hostPlatform":"linux",
                            "hostArch":"x64"
                          },
                          "versionManifest":{
                            "internalApiVersion":"v1",
                            "configProjectionVersion":"v1"
                          },
                          "capabilities":["desired-state.pull","runtime.apply"]
                        }"#,
                    ))
                    .expect("second node hello request should build"),
            )
            .await
            .expect("second node hello request should succeed");
        let second_hello_body = response_body_json(second_hello_response).await;
        let second_session_id = second_hello_body
            .get("sessionId")
            .and_then(Value::as_str)
            .expect("second hello response should include sessionId");
        let second_hello_token = second_hello_body
            .get("helloToken")
            .and_then(Value::as_str)
            .expect("second hello response should include helloToken");

        let second_admit_response = app
            .clone()
            .oneshot(
                Request::post(format!(
                    "/claw/internal/v1/node-sessions/{second_session_id}:admit"
                ))
                .header("content-type", "application/json")
                .body(Body::from(format!(
                    r#"{{"helloToken":"{second_hello_token}"}}"#
                )))
                .expect("second node admit request should build"),
            )
            .await
            .expect("second node admit request should succeed");
        let second_admit_status = second_admit_response.status();
        let _second_admit_body = response_body_json(second_admit_response).await;

        let replaced_heartbeat_response = app
            .clone()
            .oneshot(
                Request::post(format!(
                    "/claw/internal/v1/node-sessions/{first_session_id}:heartbeat"
                ))
                .header("content-type", "application/json")
                .body(Body::from(format!(r#"{{"leaseId":"{first_lease_id}"}}"#)))
                .expect("replaced heartbeat request should build"),
            )
            .await
            .expect("replaced heartbeat request should return a response");
        let replaced_heartbeat_status = replaced_heartbeat_response.status();
        let replaced_heartbeat_correlation_id = replaced_heartbeat_response
            .headers()
            .get("x-claw-correlation-id")
            .and_then(|value| value.to_str().ok())
            .map(str::to_string)
            .expect("replaced heartbeat response should include x-claw-correlation-id");
        let replaced_heartbeat_body = response_body_json(replaced_heartbeat_response).await;
        let replaced_heartbeat_error = replaced_heartbeat_body
            .get("error")
            .and_then(Value::as_object)
            .expect("replaced heartbeat response should include an error envelope");

        let list_response = app
            .oneshot(
                Request::get("/claw/internal/v1/node-sessions")
                    .body(Body::empty())
                    .expect("node sessions list request should build"),
            )
            .await
            .expect("node sessions list request should succeed");
        let list_body = response_body_json(list_response).await;
        let sessions = list_body
            .as_array()
            .expect("node sessions list response should be a json array");

        assert_eq!(second_admit_status, StatusCode::OK);
        assert_eq!(replaced_heartbeat_status, StatusCode::CONFLICT);
        assert_eq!(
            replaced_heartbeat_error.get("code").and_then(Value::as_str),
            Some("session_replaced")
        );
        assert_eq!(
            replaced_heartbeat_error
                .get("category")
                .and_then(Value::as_str),
            Some("session")
        );
        assert_eq!(
            replaced_heartbeat_error
                .get("resolution")
                .and_then(Value::as_str),
            Some("restart_session")
        );
        assert_eq!(
            replaced_heartbeat_error
                .get("correlationId")
                .and_then(Value::as_str),
            Some(replaced_heartbeat_correlation_id.as_str())
        );
        assert!(sessions.iter().any(|session| {
            session.get("nodeId").and_then(Value::as_str) == Some("managed-openclaw-primary")
                && session.get("sessionId").and_then(Value::as_str) == Some(second_session_id)
                && session.get("state").and_then(Value::as_str) == Some("admitted")
        }));
    }

    #[test]
    fn cli_defaults_to_run_command_when_no_subcommand_is_provided() {
        let command =
            crate::cli::parse_cli_args(["agentstudio-server"]).expect("default command should parse");

        assert_eq!(
            command,
            crate::cli::ClawServerCliCommand::Run(crate::cli::ClawServerRunArgs::default())
        );
    }

    #[test]
    fn cli_parses_print_config_command_with_config_path_and_overrides() {
        let command = crate::cli::parse_cli_args([
            "agentstudio-server",
            "print-config",
            "--config",
            "D:/tmp/agentstudio-server.json",
            "--host",
            "0.0.0.0",
            "--port",
            "19000",
        ])
        .expect("print-config command should parse");

        assert_eq!(
            command,
            crate::cli::ClawServerCliCommand::PrintConfig(crate::cli::ClawServerPrintConfigArgs {
                config_path: Some(PathBuf::from("D:/tmp/agentstudio-server.json")),
                host: Some("0.0.0.0".to_string()),
                port: Some(19_000),
            })
        );
    }

    #[test]
    fn cli_parses_service_print_manifest_command_with_platform_and_overrides() {
        let command = crate::cli::parse_cli_args([
            "agentstudio-server",
            "service",
            "print-manifest",
            "--platform",
            "linux",
            "--config",
            "D:/tmp/agentstudio-server.json",
            "--host",
            "0.0.0.0",
            "--port",
            "19000",
        ])
        .expect("service print-manifest command should parse");

        assert_eq!(
            command.config_path(),
            Some(&PathBuf::from("D:/tmp/agentstudio-server.json"))
        );
        assert_eq!(command.host_override(), Some("0.0.0.0"));
        assert_eq!(command.port_override(), Some(19_000));
        assert!(format!("{command:?}").contains("PrintManifest"));
        assert!(format!("{command:?}").contains("Linux"));
    }

    #[test]
    fn cli_help_uses_success_exit_code() {
        let error = crate::cli::parse_cli_args(["agentstudio-server", "--help"])
            .expect_err("help requests should surface a clap display-help result");

        assert_eq!(error.kind(), clap::error::ErrorKind::DisplayHelp);
        assert_eq!(super::resolve_cli_parse_exit_code(&error), 0);
    }

    #[test]
    fn service_lifecycle_cli_parses_install_command_with_current_platform_default() {
        let command = crate::cli::parse_cli_args(["agentstudio-server", "service", "install"])
            .expect("service install command should parse");

        assert_eq!(command.config_path(), None);
        assert_eq!(command.host_override(), None);
        assert_eq!(command.port_override(), None);
        assert!(matches!(
            command,
            crate::cli::ClawServerCliCommand::Service(
                crate::cli::ClawServerServiceCommand::Install(
                    crate::cli::ClawServerServiceLifecycleArgs { platform, .. }
                )
            ) if platform == crate::service::current_service_platform()
        ));
    }

    #[test]
    fn service_lifecycle_install_writes_linux_unit_and_runs_enable_commands() {
        let plan = crate::service::plan_server_service_lifecycle(
            crate::service::ServerServiceLifecycleRequest {
                action: crate::service::ServerServiceLifecycleAction::Install,
                platform: crate::cli::ClawServerServicePlatform::Linux,
                executable_path: PathBuf::from("/opt/claw/bin/agentstudio-server"),
                config_path: PathBuf::from("/etc/agentstudio-server/config.json"),
                runtime_config: sample_service_runtime_config("agentstudio-server-data"),
            },
        );
        let mut runtime = TestServiceRuntime::new(vec![
            crate::service::ServerServiceCommandRunOutput {
                exit_code: Some(0),
                stdout: String::new(),
                stderr: String::new(),
            },
            crate::service::ServerServiceCommandRunOutput {
                exit_code: Some(0),
                stdout: String::new(),
                stderr: String::new(),
            },
        ]);

        let result =
            crate::service::execute_server_service_lifecycle_with_runtime(&plan, &mut runtime)
                .expect("service install should succeed");

        assert!(result.artifact_written);
        assert_eq!(runtime.writes.len(), 2);
        assert_eq!(
            runtime.writes[0].0,
            PathBuf::from("/etc/agentstudio-server/config.json")
        );
        assert!(runtime.writes[0].1.contains("\"host\": \"127.0.0.1\""));
        assert_eq!(
            runtime.writes[1].0,
            PathBuf::from("/etc/systemd/system/agentstudio-server.service")
        );
        assert!(runtime.writes[1].1.contains("ExecStart="));
        assert_eq!(result.commands.len(), 2);
        assert_eq!(result.commands[0].program, "systemctl");
        assert_eq!(result.commands[0].args, vec!["daemon-reload".to_string()]);
        assert_eq!(result.commands[1].program, "systemctl");
        assert_eq!(
            result.commands[1].args,
            vec!["enable".to_string(), "agentstudio-server".to_string()]
        );
    }

    #[test]
    fn service_lifecycle_restart_plans_macos_launchctl_commands() {
        let plan = crate::service::plan_server_service_lifecycle(
            crate::service::ServerServiceLifecycleRequest {
                action: crate::service::ServerServiceLifecycleAction::Restart,
                platform: crate::cli::ClawServerServicePlatform::Macos,
                executable_path: PathBuf::from("/Applications/Claw/bin/agentstudio-server"),
                config_path: PathBuf::from("/Library/Application Support/Claw/config.json"),
                runtime_config: sample_service_runtime_config("agentstudio-server-data"),
            },
        );

        assert_eq!(plan.service_manager, "launchd");
        assert_eq!(plan.service_name, "ai.sdkwork.claw.server");
        assert_eq!(plan.commands.len(), 4);
        assert_eq!(plan.commands[0].program, "launchctl");
        assert_eq!(
            plan.commands[0].args,
            vec![
                "bootout".to_string(),
                "system/ai.sdkwork.claw.server".to_string()
            ]
        );
        assert_eq!(plan.commands[1].program, "launchctl");
        assert_eq!(
            plan.commands[1].args,
            vec![
                "bootstrap".to_string(),
                "system".to_string(),
                "/Library/LaunchDaemons/ai.sdkwork.claw.server.plist".to_string()
            ]
        );
    }

    #[test]
    fn service_lifecycle_start_plans_windows_sc_start_command() {
        let plan = crate::service::plan_server_service_lifecycle(
            crate::service::ServerServiceLifecycleRequest {
                action: crate::service::ServerServiceLifecycleAction::Start,
                platform: crate::cli::ClawServerServicePlatform::Windows,
                executable_path: PathBuf::from("C:/claw/bin/agentstudio-server.exe"),
                config_path: PathBuf::from("C:/claw/config/server.json"),
                runtime_config: sample_service_runtime_config("C:/claw/data"),
            },
        );

        assert_eq!(plan.service_manager, "windowsService");
        assert_eq!(plan.commands.len(), 1);
        assert_eq!(plan.commands[0].program, "sc.exe");
        assert_eq!(
            plan.commands[0].args,
            vec!["start".to_string(), "ClawServer".to_string()]
        );
    }

    #[test]
    fn service_lifecycle_status_returns_structured_result_for_inactive_linux_service() {
        let plan = crate::service::plan_server_service_lifecycle(
            crate::service::ServerServiceLifecycleRequest {
                action: crate::service::ServerServiceLifecycleAction::Status,
                platform: crate::cli::ClawServerServicePlatform::Linux,
                executable_path: PathBuf::from("/opt/claw/bin/agentstudio-server"),
                config_path: PathBuf::from("/etc/agentstudio-server/config.json"),
                runtime_config: sample_service_runtime_config("agentstudio-server-data"),
            },
        );
        let mut runtime =
            TestServiceRuntime::new(vec![crate::service::ServerServiceCommandRunOutput {
                exit_code: Some(3),
                stdout: "inactive\n".to_string(),
                stderr: String::new(),
            }]);

        let result =
            crate::service::execute_server_service_lifecycle_with_runtime(&plan, &mut runtime)
                .expect("service status should not fail when service is inactive");

        assert!(!result.success);
        assert_eq!(result.state, "inactive");
        assert_eq!(result.commands.len(), 1);
        assert_eq!(result.command_results.len(), 1);
        assert_eq!(result.command_results[0].exit_code, Some(3));
        assert_eq!(result.command_results[0].stdout.trim(), "inactive");
    }

    #[test]
    fn service_lifecycle_result_exposes_runtime_contract_projection() {
        let plan = crate::service::plan_server_service_lifecycle(
            crate::service::ServerServiceLifecycleRequest {
                action: crate::service::ServerServiceLifecycleAction::Start,
                platform: crate::cli::ClawServerServicePlatform::Windows,
                executable_path: PathBuf::from("C:/claw/bin/agentstudio-server.exe"),
                config_path: PathBuf::from("C:/claw/config/agentstudio-server.config.json"),
                runtime_config: sample_service_runtime_config("C:/claw/data"),
            },
        );
        let mut runtime =
            TestServiceRuntime::new(vec![crate::service::ServerServiceCommandRunOutput {
                exit_code: Some(0),
                stdout: String::new(),
                stderr: String::new(),
            }]);

        let result =
            crate::service::execute_server_service_lifecycle_with_runtime(&plan, &mut runtime)
                .expect("service lifecycle result should include the runtime contract");

        assert_eq!(
            result.executable_path,
            PathBuf::from("C:/claw/bin/agentstudio-server.exe")
        );
        assert_eq!(
            result.config_file,
            PathBuf::from("C:/claw/config/agentstudio-server.config.json")
        );
        assert_eq!(result.runtime_config.host, "127.0.0.1");
        assert_eq!(result.runtime_config.port, 18_797);
        assert_eq!(
            result.runtime_config.data_dir,
            PathBuf::from("C:/claw/data")
        );
    }

    #[test]
    fn cli_config_resolution_prefers_cli_over_file_over_env() {
        let config_path = write_test_server_config_file(
            "cli-config-resolution",
            serde_json::json!({
                "host": "10.0.0.9",
                "port": 19001,
                "dataDir": "./server-data",
                "webDistDir": "./server-web",
                "stateStore": {
                    "driver": "sqlite",
                    "sqlitePath": "./server-state.sqlite3"
                }
            }),
        );
        let mut env = BTreeMap::new();
        env.insert("CLAW_SERVER_HOST".to_string(), "192.168.1.10".to_string());
        env.insert("CLAW_SERVER_PORT".to_string(), "19002".to_string());
        env.insert(
            "CLAW_SERVER_STATE_STORE_DRIVER".to_string(),
            "json-file".to_string(),
        );

        let resolved = crate::config::resolve_server_runtime_config(
            crate::config::ServerRuntimeConfigResolutionRequest {
                command: crate::cli::ClawServerCliCommand::Run(crate::cli::ClawServerRunArgs {
                    config_path: Some(config_path),
                    host: Some("127.0.0.1".to_string()),
                    port: Some(19_003),
                }),
                env,
                executable_path: None,
            },
        )
        .expect("server config should resolve");

        assert_eq!(resolved.host, "127.0.0.1");
        assert_eq!(resolved.port, 19_003);
        assert_eq!(resolved.data_dir, PathBuf::from("./server-data"));
        assert_eq!(resolved.web_dist_dir, PathBuf::from("./server-web"));
        assert_eq!(resolved.state_store.driver, "sqlite");
        assert_eq!(
            resolved.state_store.sqlite_path,
            Some(PathBuf::from("./server-state.sqlite3"))
        );
    }

    #[test]
    fn port_governance_keeps_requested_port_when_available() {
        let port_probe =
            std::net::TcpListener::bind(("127.0.0.1", 0)).expect("port probe listener should bind");
        let requested_port = port_probe
            .local_addr()
            .expect("port probe local addr should resolve")
            .port();
        drop(port_probe);

        let binding =
            crate::port_governance::bind_server_listener("127.0.0.1", requested_port, false)
                .expect("server listener should bind the requested port");

        assert_eq!(binding.requested_port, requested_port);
        assert_eq!(binding.active_port, requested_port);
        assert!(!binding.dynamic_port);
        assert_eq!(
            binding.base_url(),
            format!("http://127.0.0.1:{requested_port}")
        );
    }

    #[test]
    fn port_governance_allocates_fallback_port_when_requested_port_is_busy() {
        let busy_listener =
            std::net::TcpListener::bind(("127.0.0.1", 0)).expect("busy listener should bind");
        let requested_port = busy_listener
            .local_addr()
            .expect("busy listener local addr should resolve")
            .port();

        let binding =
            crate::port_governance::bind_server_listener("127.0.0.1", requested_port, true)
                .expect("server listener should fall back to an available port");

        assert_eq!(binding.requested_port, requested_port);
        assert_ne!(binding.active_port, requested_port);
        assert!(binding.dynamic_port);
        assert_eq!(
            binding.base_url(),
            format!("http://127.0.0.1:{}", binding.active_port)
        );
    }

    #[test]
    fn service_manifest_projection_for_linux_uses_systemd_semantics() {
        let manifest = crate::service::project_service_manifest(
            crate::service::ServerServiceManifestProjectionRequest {
                platform: crate::cli::ClawServerServicePlatform::Linux,
                executable_path: PathBuf::from("/opt/claw/bin/agentstudio-server"),
                config_path: PathBuf::from("/etc/agentstudio-server/config.json"),
                runtime_config: sample_service_runtime_config("agentstudio-server-data"),
            },
        );

        assert_eq!(manifest.service_manager, "systemd");
        assert_eq!(manifest.service_name, "agentstudio-server");
        assert_eq!(
            manifest.service_config_path,
            PathBuf::from("/etc/systemd/system/agentstudio-server.service")
        );
        assert_eq!(
            manifest.runtime_args,
            vec![
                "run".to_string(),
                "--config".to_string(),
                "/etc/agentstudio-server/config.json".to_string()
            ]
        );
        assert_eq!(
            manifest.config_file,
            PathBuf::from("/etc/agentstudio-server/config.json")
        );
        assert_eq!(
            manifest.executable_path,
            PathBuf::from("/opt/claw/bin/agentstudio-server")
        );
        assert!(manifest
            .artifact_content
            .contains("ExecStart=\"/opt/claw/bin/agentstudio-server\" \"run\" \"--config\" \"/etc/agentstudio-server/config.json\""));
    }

    #[test]
    fn service_manifest_projection_for_macos_uses_launchd_semantics() {
        let manifest = crate::service::project_service_manifest(
            crate::service::ServerServiceManifestProjectionRequest {
                platform: crate::cli::ClawServerServicePlatform::Macos,
                executable_path: PathBuf::from("/Applications/Claw/bin/agentstudio-server"),
                config_path: PathBuf::from("/Library/Application Support/Claw/config.json"),
                runtime_config: sample_service_runtime_config("agentstudio-server-data"),
            },
        );

        assert_eq!(manifest.service_manager, "launchd");
        assert_eq!(manifest.service_name, "ai.sdkwork.claw.server");
        assert_eq!(
            manifest.service_config_path,
            PathBuf::from("/Library/LaunchDaemons/ai.sdkwork.claw.server.plist")
        );
        assert!(manifest
            .artifact_content
            .contains("<key>Label</key>\n  <string>ai.sdkwork.claw.server</string>"));
        assert!(manifest
            .artifact_content
            .contains("<string>/Library/Application Support/Claw/config.json</string>"));
    }

    #[test]
    fn service_manifest_projection_for_windows_uses_windows_service_semantics() {
        let manifest = crate::service::project_service_manifest(
            crate::service::ServerServiceManifestProjectionRequest {
                platform: crate::cli::ClawServerServicePlatform::Windows,
                executable_path: PathBuf::from("C:/claw/bin/agentstudio-server.exe"),
                config_path: PathBuf::from("C:/claw/config/server.json"),
                runtime_config: sample_service_runtime_config("C:/claw/data"),
            },
        );

        assert_eq!(manifest.service_manager, "windowsService");
        assert_eq!(manifest.service_name, "ClawServer");
        assert_eq!(
            manifest.service_config_path,
            PathBuf::from("C:/claw/data")
                .join("service")
                .join("windows-service.json")
        );
        assert!(manifest
            .artifact_content
            .contains("\"serviceManager\": \"windowsService\""));
        assert!(manifest
            .artifact_content
            .contains("\"command\": \"C:/claw/bin/agentstudio-server.exe\""));
        assert!(manifest.artifact_content.contains("\"--config\""));
    }

    async fn response_body_text(response: axum::response::Response) -> String {
        let bytes = to_bytes(response.into_body(), usize::MAX)
            .await
            .expect("response body should be readable");
        String::from_utf8(bytes.to_vec()).expect("response body should be valid utf-8")
    }

    async fn response_body_json(response: axum::response::Response) -> Value {
        serde_json::from_str(&response_body_text(response).await)
            .expect("response body should be valid json")
    }

    fn value_string_array(value: Option<&Value>) -> Option<Vec<String>> {
        value.and_then(Value::as_array).map(|items| {
            items
                .iter()
                .filter_map(|item| item.as_str().map(str::to_string))
                .collect()
        })
    }

    fn create_test_rollout_data_dir(label: &str) -> PathBuf {
        let unique_suffix = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("system time should be after unix epoch")
            .as_nanos();
        let directory = std::env::temp_dir().join(format!(
            "sdkwork-agentstudio-standalone-gateway-rollouts-{label}-{}-{unique_suffix}",
            std::process::id()
        ));
        fs::create_dir_all(&directory).expect("test rollout directory should be created");
        directory
    }

    fn create_test_web_dist_dir(label: &str) -> PathBuf {
        let unique_suffix = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("system time should be after unix epoch")
            .as_nanos();
        let directory = std::env::temp_dir().join(format!(
            "sdkwork-agentstudio-standalone-gateway-web-dist-{label}-{}-{unique_suffix}",
            std::process::id()
        ));
        fs::create_dir_all(&directory).expect("test web dist directory should be created");
        directory
    }

    const DESKTOP_HOSTED_BROWSER_ORIGIN: &str = "http://127.0.0.1:1426";
    const REMOTE_BROWSER_ORIGIN: &str = "https://evil.example.com";
    const DESKTOP_BROWSER_SESSION_TOKEN: &str = "desktop-session-token";

    fn build_desktop_combined_browser_session_test_app(label: &str) -> axum::Router {
        let mut state = build_server_state_with_overrides(
            create_test_rollout_data_dir(label),
            ServerStateOverrides {
                auth: Some(ServerAuthConfig {
                    manage: None,
                    internal: None,
                    browser_session_token: Some(DESKTOP_BROWSER_SESSION_TOKEN.to_string()),
                }),
                ..ServerStateOverrides::default()
            },
        );
        state.set_mode("desktopCombined");
        build_router(state)
    }

    fn build_cors_preflight_request(path: &str, requested_method: &str) -> Request<Body> {
        build_cors_preflight_request_with_origin(
            path,
            requested_method,
            DESKTOP_HOSTED_BROWSER_ORIGIN,
        )
    }

    fn build_cors_preflight_request_with_origin(
        path: &str,
        requested_method: &str,
        origin: &str,
    ) -> Request<Body> {
        Request::builder()
            .method("OPTIONS")
            .uri(path)
            .header(header::ORIGIN, origin)
            .header(header::ACCESS_CONTROL_REQUEST_METHOD, requested_method)
            .header(
                header::ACCESS_CONTROL_REQUEST_HEADERS,
                "x-claw-browser-session",
            )
            .body(Body::empty())
            .expect("CORS preflight request should build")
    }

    fn header_value(headers: &header::HeaderMap, name: &header::HeaderName) -> Option<String> {
        headers
            .get(name)
            .and_then(|value| value.to_str().ok())
            .map(str::to_string)
    }

    fn assert_csv_header_contains(
        headers: &header::HeaderMap,
        name: header::HeaderName,
        expected_value: &str,
        path: &str,
    ) {
        let actual = header_value(headers, &name)
            .unwrap_or_else(|| panic!("expected header {name} to be present for {path}"));
        assert!(
            actual
                .split(',')
                .map(str::trim)
                .any(|value: &str| value.eq_ignore_ascii_case(expected_value)),
            "expected header {name} to include {expected_value} for {path}, got {actual}",
        );
    }

    fn write_test_server_config_file(label: &str, payload: Value) -> PathBuf {
        let unique_suffix = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("system time should be after unix epoch")
            .as_nanos();
        let directory = std::env::temp_dir().join(format!(
            "sdkwork-agentstudio-standalone-gateway-config-{label}-{}-{unique_suffix}",
            std::process::id()
        ));
        fs::create_dir_all(&directory).expect("test config directory should be created");
        let path = directory.join("agentstudio-server.json");
        fs::write(
            &path,
            serde_json::to_string_pretty(&payload)
                .expect("test server config payload should serialize"),
        )
        .expect("test server config file should be written");
        path
    }

    fn sample_service_runtime_config(data_dir: &str) -> crate::config::ResolvedServerRuntimeConfig {
        crate::config::ResolvedServerRuntimeConfig {
            host: "127.0.0.1".to_string(),
            port: 18_797,
            data_dir: PathBuf::from(data_dir),
            web_dist_dir: PathBuf::from("web-dist"),
            deployment_family: crate::config::ServerDeploymentFamily::BareMetal,
            accelerator_profile: None,
            state_store: crate::config::ResolvedServerStateStoreConfig {
                driver: "json-file".to_string(),
                sqlite_path: None,
                postgres_url: None,
                postgres_schema: None,
            },
            auth: crate::config::ResolvedServerAuthConfig {
                manage_username: None,
                manage_password: None,
                internal_username: None,
                internal_password: None,
            },
            allow_insecure_public_bind: false,
        }
    }

    struct TestServiceRuntime {
        outputs: VecDeque<crate::service::ServerServiceCommandRunOutput>,
        writes: Vec<(PathBuf, String)>,
    }

    impl TestServiceRuntime {
        fn new(outputs: Vec<crate::service::ServerServiceCommandRunOutput>) -> Self {
            Self {
                outputs: outputs.into(),
                writes: Vec::new(),
            }
        }
    }

    impl crate::service::ServerServiceRuntime for TestServiceRuntime {
        fn write_text_file(
            &mut self,
            path: &std::path::Path,
            contents: &str,
        ) -> Result<(), String> {
            self.writes.push((path.to_path_buf(), contents.to_string()));
            Ok(())
        }

        fn run_command(
            &mut self,
            _command: &crate::service::ServerServiceShellCommand,
        ) -> Result<crate::service::ServerServiceCommandRunOutput, String> {
            self.outputs
                .pop_front()
                .ok_or_else(|| "missing fake command output".to_string())
        }
    }

    struct FakeServerServiceControlPlane {
        requests: Arc<Mutex<Vec<crate::service::ServerServiceLifecycleRequest>>>,
        results: Mutex<VecDeque<crate::service::ServerServiceExecutionResult>>,
    }

    impl FakeServerServiceControlPlane {
        fn new(
            requests: Arc<Mutex<Vec<crate::service::ServerServiceLifecycleRequest>>>,
            results: Vec<crate::service::ServerServiceExecutionResult>,
        ) -> Self {
            Self {
                requests,
                results: Mutex::new(results.into()),
            }
        }
    }

    impl crate::service::ServerServiceControlPlane for FakeServerServiceControlPlane {
        fn execute(
            &self,
            request: crate::service::ServerServiceLifecycleRequest,
        ) -> Result<crate::service::ServerServiceExecutionResult, String> {
            self.requests
                .lock()
                .expect("fake service controller requests should lock")
                .push(request);
            self.results
                .lock()
                .expect("fake service controller results should lock")
                .pop_front()
                .ok_or_else(|| "missing fake service execution result".to_string())
        }
    }

    fn fake_service_execution_result(
        action: &str,
        state: &str,
        success: bool,
    ) -> crate::service::ServerServiceExecutionResult {
        crate::service::ServerServiceExecutionResult {
            action: action.to_string(),
            platform: "windows".to_string(),
            service_manager: "windowsService".to_string(),
            service_name: "ClawServer".to_string(),
            service_config_path: PathBuf::from("D:/managed/service/windows-service.json"),
            executable_path: PathBuf::from("D:/managed/agentstudio-server.exe"),
            config_file: PathBuf::from("D:/managed/config.json"),
            commands: Vec::new(),
            runtime_config: crate::config::ResolvedServerRuntimeConfig {
                host: "127.0.0.1".to_string(),
                port: 18_797,
                data_dir: PathBuf::from("D:/managed/data"),
                web_dist_dir: PathBuf::from("D:/managed/web"),
                deployment_family: crate::config::ServerDeploymentFamily::BareMetal,
                accelerator_profile: None,
                state_store: crate::config::ResolvedServerStateStoreConfig {
                    driver: "json-file".to_string(),
                    sqlite_path: None,
                    postgres_url: None,
                    postgres_schema: None,
                },
                auth: crate::config::ResolvedServerAuthConfig {
                    manage_username: None,
                    manage_password: None,
                    internal_username: None,
                    internal_password: None,
                },
                allow_insecure_public_bind: false,
            },
            artifact_written: false,
            written_files: Vec::new(),
            success,
            state: state.to_string(),
            command_results: Vec::new(),
        }
    }

    fn basic_auth_header_value(username: &str, password: &str) -> String {
        let credentials = format!("{username}:{password}");
        let encoded = encode_base64(credentials.as_bytes());
        format!("Basic {encoded}")
    }

    fn encode_base64(input: &[u8]) -> String {
        const TABLE: &[u8; 64] =
            b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
        let mut encoded = String::with_capacity(input.len().div_ceil(3) * 4);
        let mut chunks = input.chunks_exact(3);
        for chunk in &mut chunks {
            let combined = ((chunk[0] as u32) << 16) | ((chunk[1] as u32) << 8) | chunk[2] as u32;
            encoded.push(TABLE[((combined >> 18) & 0x3f) as usize] as char);
            encoded.push(TABLE[((combined >> 12) & 0x3f) as usize] as char);
            encoded.push(TABLE[((combined >> 6) & 0x3f) as usize] as char);
            encoded.push(TABLE[(combined & 0x3f) as usize] as char);
        }

        let remainder = chunks.remainder();
        if !remainder.is_empty() {
            let first = remainder[0] as u32;
            let second = remainder.get(1).copied().unwrap_or_default() as u32;
            let combined = (first << 16) | (second << 8);
            encoded.push(TABLE[((combined >> 18) & 0x3f) as usize] as char);
            encoded.push(TABLE[((combined >> 12) & 0x3f) as usize] as char);
            if remainder.len() == 2 {
                encoded.push(TABLE[((combined >> 6) & 0x3f) as usize] as char);
                encoded.push('=');
            } else {
                encoded.push('=');
                encoded.push('=');
            }
        }

        encoded
    }

    fn advance_rollout_target_semantic_payload(
        rollout_data_dir: &PathBuf,
        rollout_id: &str,
        node_id: &str,
        suffix: &str,
    ) {
        let rollout_store_path = rollout_data_dir.join("rollouts.json");
        let raw = fs::read_to_string(&rollout_store_path)
            .expect("seeded rollout store should be readable");
        let mut catalog: Value =
            serde_json::from_str(&raw).expect("seeded rollout store should contain valid json");
        let rollouts = catalog
            .get_mut("rollouts")
            .and_then(Value::as_array_mut)
            .expect("seeded rollout catalog should include rollouts");
        let rollout = rollouts
            .iter_mut()
            .find(|rollout| {
                rollout
                    .get("record")
                    .and_then(Value::as_object)
                    .and_then(|record| record.get("id"))
                    .and_then(Value::as_str)
                    == Some(rollout_id)
            })
            .expect("target rollout should exist");
        let targets = rollout
            .get_mut("targets")
            .and_then(Value::as_array_mut)
            .expect("target rollout should include targets");
        let target = targets
            .iter_mut()
            .find(|target| target.get("node_id").and_then(Value::as_str) == Some(node_id))
            .expect("target node should exist");
        let target_object = target
            .as_object_mut()
            .expect("target node should be represented as an object");
        let semantic_payload = target_object
            .get("semantic_payload")
            .and_then(Value::as_str)
            .expect("target node should include semantic_payload")
            .to_string();

        target_object.insert(
            "semantic_payload".to_string(),
            Value::String(format!("{semantic_payload}{suffix}")),
        );
        fs::write(
            &rollout_store_path,
            serde_json::to_string_pretty(&catalog)
                .expect("updated rollout catalog should serialize back to json"),
        )
        .expect("updated rollout catalog should be writable");
    }
}
