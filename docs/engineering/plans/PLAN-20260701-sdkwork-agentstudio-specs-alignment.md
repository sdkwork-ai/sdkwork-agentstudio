# 执行计划：agent-studio → sdkwork-agentstudio 对齐 sdkwork-specs

- 计划 ID：PLAN-20260701-sdkwork-agentstudio-pc-specs-alignment
- 仓库：`agent-studio`（将重命名为 `sdkwork-agentstudio`）
- 应用根：`apps/sdkwork-agentstudio-pc/`
- 权威标准：`../sdkwork-specs/`（SOUL.md、NAMING_SPEC.md、WEB_FRAMEWORK_SPEC.md、DATABASE_FRAMEWORK_SPEC.md、API_SPEC.md、DRIVE_SPEC.md、DISCOVERY_SPEC.md、RUST_CODE_SPEC.md、WEB_BACKEND_SPEC.md、SDKWORK_DEPLOY_SPEC.md、GITHUB_WORKFLOW_SPEC.md、TEST_SPEC.md、SECURITY_SPEC.md、COMPONENT_SPEC.md、MIGRATION_SPEC.md）
- 执行原则：SOUL.md（specs before memory、dictionary before context、evidence before completion、stop on ambiguity、human review owns irreversible direction）

---

## 第一部分：对齐审计报告（差距分析）

### 检查点 1：是否对齐 sdkwork-specs 标准规范 — 部分对齐 ❌

| 项 | 现状 | 期望 | 结论 |
| --- | --- | --- | --- |
| `AGENTS.md` + 兼容 shim | 存在，指向 `../sdkwork-specs` | shim 不重复规则 | ✅ |
| `sdkwork.app.config.json` | 存在 v3 | 存在 | ✅ |
| 模块 `specs/component.spec.json` | 27 个包大部分有 | 每模块必有 | ✅ |
| 根 `specs/component.spec.json` | `languages: ["typescript"]`，缺失 Rust 与框架规范链接 | 声明 Rust + 链接 RUST_CODE_SPEC/WEB_FRAMEWORK_SPEC/DATABASE_FRAMEWORK_SPEC/DRIVE_SPEC/WEB_BACKEND_SPEC/API_SPEC | ❌ |
| `canonicalSpecs` 覆盖 | 未含 RUST_CODE_SPEC、WEB_FRAMEWORK_SPEC、DATABASE_FRAMEWORK_SPEC、WEB_BACKEND_SPEC、API_SPEC、DRIVE_SPEC、DISCOVERY_SPEC、RPC_SPEC、SECURITY_SPEC | 按 README 任务矩阵补全 | ❌ |
| `domain`/`capability` | `system`/`component`（占位） | 真实域与能力 | ⚠️ |
| `.sdkwork/` 工作区元数据 | 存在 | 无生成/运行时内容 | ✅ |

### 检查点 2：是否接入 sdkwork-web-framework — 未接入 ❌（最高优先级）

证据：
- `sdkwork-agentstudio-pc-server/src-host/Cargo.toml` 依赖：`axum 0.8`、`tower`、`reqwest`、`serde`，**无任何 `sdkwork-web-*` crate**。
- `http/router.rs` 用裸 `axum::Router` + `middleware::from_fn_with_state` 自实现 CORS；无 `WebRequestContext`、无 18 阶拦截器链、无路由清单框架元数据、无 `sdkwork-web-bootstrap` 装配。
- `http/error_response.rs` 自定义 `InternalErrorEnvelope`（字符串 `code`、`x-claw-correlation-id` 头），非 `application/problem+json` `ProblemDetail`。
- `http/auth.rs` 自实现 `authorize_public_studio_request`，非框架 `WebRequestPrincipal`/`RequirePrincipal`。
- 违反：`WEB_FRAMEWORK_SPEC.md` §2/§3/§4/§5/§6，`API_SPEC.md` §10/§15。

### 检查点 3：是否接入 sdkwork-database — 未接入 ❌

证据：
- `sdkwork-agentstudio-pc-host-core/src-host/Cargo.toml` 依赖 `rusqlite 0.39 (bundled)`，**无 `sdkwork-database-*` crate**。
- `storage/sqlite_store.rs` 手写 `CREATE TABLE host_catalog_documents` DDL，手写 `INSERT ... ON CONFLICT`，无 `database/contract/`、无 `migrations/`、无 `seeds/`、无 lifecycle SPI、无 drift。
- 违反：`DATABASE_FRAMEWORK_SPEC.md` §1/§4（L1 未达），`DATABASE_SPEC.md` §33（连接池须经 sdkwork-database）。
- 注意：`sdkwork-database` crate 提供 `sdkwork-database-spi`、`sdkwork-database-lifecycle`、`sdkwork-database-sqlx`、`sdkwork-database-cli` 等，支持 SQLite/PostgreSQL。

### 检查点 4：是否接入 sdkwork-utils — 未接入 ❌

证据：
- Rust 侧：`sdkwork-agentstudio-pc-server`、`sdkwork-agentstudio-pc-host-core` 均未依赖 `sdkwork-utils-rust`（crate 名 `sdkwork-utils-rust`）。
- 手写可替换逻辑：`chatUploadService.ts` 的 `defaultCreateId`（`asset-${Date.now()}-...`）、`sanitizePathSegment`/`sanitizeFileName`、`numberFromString`；Rust 侧自实现错误分类、ID 生成。
- TS 侧：`sdkwork-utils-typescript`（`@sdkwork/utils`）未在 workspace 依赖中出现。
- 违反：`NAMING_SPEC.md` §0.2（`utils` → `@sdkwork/utils`），`CODE_STYLE_SPEC.md`（减少重复）。

### 检查点 5：是否接入注册中心 sdkwork-discovery — 暂不需要 ✅

- 当前为本地 HTTP server + Tauri 桌面 + OpenClaw 网关代理，**无 gRPC/RPC 服务间调用**。
- `DISCOVERY_SPEC.md` 适用场景为“服务发现、动态 RPC 端点解析、版本化运行时配置控制面”。
- 结论：**当前不接入**，符合用户指示；待引入 RPC 服务（`sdkwork-rpc-framework` + `sdkwork-routes-*` RPC）后再接入 `sdkwork-discovery` resolver。

### 检查点 6：文件上传是否经 sdkwork-drive 集成 — 前端已接入 ✅，服务端未对齐 ❌

证据：
- 前端 ✅：`sdkwork-agentstudio-pc-core/src/sdk/useAppSdkClient.ts` 已组装 `createDriveAppClient`，与 IAM/Messaging 共享 `tokenManager`；`services/chatUploadService.ts` 通过 `client.uploader.uploadAttachment` 走 Drive Uploader，产出 `driveUri`/`driveSpaceId`/`driveNodeId`。符合 `DRIVE_SPEC.md` §2/§13。
- 服务端 ❌：`api_public.rs` 的 `put_public_studio_instance_file_content` → `provider.update_instance_file_content` → `host-core/storage/file_store.rs` 写本地文件系统，**未走 `sdkwork-drive-uploader-service` 或 Drive RPC**。违反 `DRIVE_SPEC.md` §2（业务域不得自建对象存储生命周期）。

### 横切：结构 / 部署 / 打包 / API / 代码 / 测试 / 安全

| 维度 | 现状 | 期望 | 结论 |
| --- | --- | --- | --- |
| 仓库命名 | `agent-studio` | `sdkwork-<application-code>` = `sdkwork-agentstudio` | ❌ |
| 应用根 | `apps/sdkwork-agentstudio-pc/` | `apps/sdkwork-agentstudio-pc/` | ❌ |
| 包命名 | `sdkwork-agentstudio-pc-*`（`@sdkwork/agentstudio-pc-*`） | `sdkwork-agentstudio-pc-*`（`@sdkwork/agentstudio-pc-*`）按 NAMING_SPEC §2 | ❌（需迁移评估） |
| `app.key` | `agent-studio` | `agentstudio`（含 platform_app 注册、desktopAppId、containerImage 联动） | ❌（需人工评审） |
| 部署清单 | 有 `deployments/docker`、`deployments/kubernetes`，**无 `deployments/deploy.yaml`** | `deployments/deploy.yaml`（SDKWORK_DEPLOY_SPEC） | ❌ |
| 打包/发布 | 有 `scripts/release/*` 与 `sdkwork.workflow.json`? | `sdkwork.workflow.json` + `sdkwork-github-workflow`（GITHUB_WORKFLOW_SPEC） | ⚠️ 需核验 |
| API 信封 | 成功裸 `Json<Value>`；错误字符串 `code` | `SdkWorkApiResponse{code:0,data,traceId}` + `ProblemDetail`（数字 code） | ❌ |
| API 路由前缀 | `/claw/api/v1`、`/claw/health`、`/claw/manage/v1` | app-api `/app/v3/api`、backend-api `/backend/v3/api` 或经批准 open-api 前缀 | ❌ |
| OpenAPI 契约 | `openapi.rs` 自生成，无 `x-sdkwork-request-context`/`x-sdkwork-api-surface`/operationId | OpenAPI 3.1.2 + 路由清单 + 框架扩展 | ❌ |
| 代码（Rust） | `tokio::task::spawn_blocking` 包同步 rusqlite；错误用 `String` | thiserror 类型化错误、无 library `unwrap`、async 不阻塞 | ⚠️ |
| 代码（前端） | `infrastructure/http/httpClient.ts` 裸 `fetch`（基础设施层可接受）；业务层走 SDK ✅ | 业务层禁裸 HTTP | ✅/⚠️ |
| 测试 | 大量 `scripts/*.test.mjs` 契约测试，无统一 `pnpm test` | `pnpm test` 统一入口 + TEST_SPEC 覆盖 | ⚠️ |
| 安全 | 自实现 CORS、自实现 auth、字符串错误码 | 框架拦截器链 + `RequirePrincipal` + `ProblemDetail` + SECURITY_SPEC | ❌ |

---

## 第二部分：分阶段执行计划

> 人工评审门（Human Review Gate，SOUL.md §1）：涉及公共命名、SDK 所有权、数据库 schema、安全/认证、生产部署配置的变更，必须经人工确认后再执行。

### Phase 0 — 仓库重命名（前置，低风险可逆）

前置条件：停止所有 dev server / Tauri / cargo 进程，关闭 IDE 对 `agent-studio` 的文件监视（当前因 node/cargo 进程占用导致 `Move-Item` 访问被拒绝）。

```powershell
# 在干净的 PowerShell（无 IDE/dev server 占用）中执行
Move-Item -Path "<workspace-root>/agent-studio" -Destination "<workspace-root>/sdkwork-agentstudio"
```

校验：
- `sdkwork-agentstudio/AGENTS.md` 中 `../sdkwork-specs` 相对路径仍可解析 ✅（兄弟目录不变）
- `sdkwork-agentstudio/pnpm-workspace.yaml` 中 `../sdkwork-iam`、`../sdkwork-drive` 等兄弟相对路径仍有效 ✅
- 父级 `<workspace-root>/pnpm-workspace.yaml` 为 `packages: []`，不受影响 ✅
- 跨仓引用（`sdkwork-clawrouter/data/app/sdkwork-apps.json`、`sdkwork-birdcoder/scripts/claw-*` 等）需在 Phase 1 同步更新

### Phase 1 — 命名与身份迁移【Human Review Gate】

目标：统一 `application-code = agentstudio`，对齐 NAMING_SPEC §0.1/§2。因涉及 platform_app 注册、desktopAppId、containerImage、跨仓引用，需人工评审与兼容窗口（MIGRATION_SPEC §4）。

1.1 顶层身份：
- `sdkwork.app.config.json`：`app.key` `agent-studio`→`agentstudio`；`displayName`/`name`/`officialWebsiteUrl`/`iconUrl`/`containerImage`/`storeUrl`/`environments.*.accessUrl`/`artifacts.installConfig.packages[].url` 全量替换 `agent-studio`→`agentstudio`；`publish.config.workspaceRoot` `apps/agent-studio`→`apps/sdkwork-agentstudio-pc`；`devApp.sourceRoot` 同步。
- `package.json`：`name` `@sdkwork/agentstudio-workspace`→`@sdkwork/agentstudio-workspace`。
- `specs/component.spec.json`：`component.name`→`agentstudio`、`component.root`→`sdkwork-agentstudio`、`verification.commands` 中 `@sdkwork/agentstudio-workspace`→`@sdkwork/agentstudio-workspace`。

1.2 应用根与包 taxonomy（NAMING_SPEC §2）：
- 应用根目录：`apps/sdkwork-agentstudio-pc/` → `apps/sdkwork-agentstudio-pc/`。
- 包目录与 `package.json#name`：`sdkwork-agentstudio-pc-<cap>` → `sdkwork-agentstudio-pc-<cap>`，`@sdkwork/agentstudio-pc-<cap>` → `@sdkwork/agentstudio-pc-<cap>`（27 个包）。
- Rust crate：`sdkwork-agentstudio-pc-host-core`→`sdkwork-agentstudio-pc-host-core`、`sdkwork-agentstudio-pc-host-studio`→`sdkwork-agentstudio-pc-host-studio`、`sdkwork-agentstudio-pc-server`→`sdkwork-agentstudio-pc-server`、`sdkwork-agentstudio-pc-desktop`→`sdkwork-agentstudio-pc-desktop`；同步 `Cargo.toml` workspace.members、`[[bin]] name`、`sdkwork_agentstudio_host_core` lib name。
- desktopAppId：`com.sdkwork.claw.studio.desktop`→`com.sdkwork.agentstudio.desktop`（Tauri `tauri.conf.json` 同步）。

1.3 脚本与契约同步：
- `pnpm-workspace.yaml`、`package.json#scripts`（`--filter @sdkwork/agentstudio-pc-*`）、`scripts/check-sdkwork-agentstudio-pc-*.mjs`、`scripts/run-agentstudio-server-build.mjs`、`sdkwork-run-node`/`sdkwork-run-pnpm`、`tauri-dev-fast.cmd` 中所有 `claw`/`agent-studio` 字面量替换。
- `pnpm-lock.yaml` 重建：`pnpm install --lockfile-only`。
- 跨仓引用同步：`sdkwork-clawrouter/data/app/sdkwork-apps.json`、`sdkwork-birdcoder/scripts/claw-release-parity-*`、`sdkwork-specs/workspace/consumers/*` 等。

1.4 兼容窗口：保留旧 `@sdkwork/agentstudio-pc-*` 包名别名一个发布周期（MIGRATION_SPEC），或一次性切换并同步所有消费方（需评估消费方清单）。

校验：`pnpm install`、`pnpm check:arch`、`pnpm check:parity`、`pnpm lint`、`cargo check --workspace`。

### Phase 2 — Rust 后端接入 sdkwork-web-framework【最高优先级】

目标：`sdkwork-agentstudio-pc-server` 经框架装配 HTTP 运行时，替换裸 axum。权威：`sdkwork-web-framework/specs/WEB_FRAMEWORK_STANDARD.md`。

2.1 依赖（`sdkwork-agentstudio-pc-server/src-host/Cargo.toml`）：
```toml
sdkwork-web-axum = { path = "../../sdkwork-web-framework/crates/sdkwork-web-axum" }      # 或 git 依赖
sdkwork-web-bootstrap = { path = "../../sdkwork-web-framework/crates/sdkwork-web-bootstrap" }
sdkwork-web-contract = { path = "../../sdkwork-web-framework/crates/sdkwork-web-contract" }
sdkwork-web-context = { path = "../../sdkwork-web-framework/crates/sdkwork-web-core" }   # 按 L1 实际 crate 名
```
> 按 `DEPENDENCY_MANAGEMENT_SPEC.md` 选择 `path`（开发）或 pinned `git`（发布）依赖；以 `sdkwork-web-framework` 实际公开 crate 名为准（见其 `Cargo.toml` workspace.members）。

2.2 路由重构：
- `http/router.rs`：`build_router` 改为经 `sdkwork-web-bootstrap` 装配，挂载 `sdkwork-web-axum` 路由助手；CORS/上下文/认证/日志/审计/响应身份阶段交由框架 18 阶拦截器链。
- 每个路由声明 `requestContext: WebRequestContext` 与 `apiSurface`（路由清单）。
- 删除 `http/cors_policy.rs`、`http/auth.rs` 自实现，改用框架 `WebRequestPrincipal`/`RequirePrincipal` 与扩展 trait。
- `http/error_response.rs` 替换为框架 `ProblemDetail` 响应映射（数字 code + traceId）。

2.3 表面分类：将 `/claw/api/v1` 重构为标准 `app-api`/`backend-api`/`open-api` 前缀（见 Phase 5），或经批准的 open-api 业务前缀 + `x-sdkwork-api-surface`。

2.4 bootstrap：`bootstrap.rs` 的 `ServerState` 装配改为框架 bootstrap API；预检（preflight）走框架。

校验：`cargo check --workspace`、`cargo clippy --workspace --all-targets -- -D warnings`、`pnpm check:server`、框架 `framework-adoption.evidence.json` 自检。

### Phase 3 — 接入 sdkwork-database（迁移 rusqlite → 框架 SPI）

目标：`sdkwork-agentstudio-pc-host-core` 经 `sdkwork-database` 管理生命周期，达 L2（Contract Governed）。权威：`sdkwork-database/specs/DATABASE_FRAMEWORK_STANDARD.md`。【Human Review Gate：schema 变更】

3.1 资产字典（`sdkwork-agentstudio-pc-host-core/database/`）：
- `contract/schema.yaml`：声明 `host_catalog_documents`（及 rollout/node_session 投影表）的契约（逻辑类型、租户隔离、索引）。
- `migrations/sqlite/`：版本化迁移脚本（替换内联 `CREATE TABLE`）。
- `seeds/common`、`database.manifest.json`。
- 若未来上 PostgreSQL，复用同一契约生成 `migrations/postgresql/`。

3.2 依赖与 SPI：
```toml
sdkwork-database-spi = { path = "../../sdkwork-database/crates/sdkwork-database-spi" }
sdkwork-database-lifecycle = { path = "../../sdkwork-database/crates/sdkwork-database-lifecycle" }
sdkwork-database-sqlx = { path = "../../sdkwork-database/crates/sdkwork-database-sqlx" }   # SQLite/Postgres 连接池
```
- `storage/sqlite_store.rs` 改为实现 `sdkwork-database-spi` 的 Repository/Entity trait，连接池经 `sdkwork-database-sqlx`。
- 启动序列：`bootstrap → migrate → seed → operate`（DATABASE_FRAMEWORK_SPEC §4.3），`AUTO_MIGRATE` 仅 dev。
- drift 观测：接 `sdkwork-database-drift` + `sdkwork-database-ops-http`（`/backend/v3/ops/database/*`）。

3.3 表命名对齐 DATABASE_SPEC：`host_catalog_documents` → `agentstudio_host_catalog_documents`（域前缀），列逻辑类型替换裸 SQL 类型。

校验：`sdkwork-database-cli validate`、`migrate`、`seed`、`drift`；`cargo test -p sdkwork-agentstudio-pc-host-core`。

### Phase 4 — 接入 sdkwork-utils（去重标准化）

目标：Rust 与 TS 侧消费 `sdkwork-utils`，删除手写通用逻辑。

4.1 Rust：`Cargo.toml` 加 `sdkwork-utils-rust = { path = "../../sdkwork-utils/packages/sdkwork-utils-rust" }`；替换手写 ID 生成（`IdUtils`）、字符串/路径清洗（`StringUtils`/`PathUtils`）、校验（`ValidationUtils`）、加密（`CryptoUtils`）。

4.2 TS：`sdkwork-agentstudio-pc-core` 等包 `dependencies` 加 `@sdkwork/utils`（`../sdkwork-utils/packages/sdkwork-utils-typescript`）；`chatUploadService.ts` 的 `defaultCreateId`/`sanitizePathSegment`/`sanitizeFileName`/`numberFromString` 替换为 `@sdkwork/utils` 对应方法；`infrastructure/http/httpClient.ts` 保留（基础设施层），但错误归一化用 utils。

校验：`pnpm lint`、`pnpm check:arch`、单元测试通过。

### Phase 5 — API 契约对齐（信封 + OpenAPI + 路由清单）

目标：对齐 API_SPEC §4.5/§14/§15/§19 与 WEB_FRAMEWORK_SPEC §6。权威：`API_SPEC.md`。

5.1 信封：
- 成功：`{ "code": 0, "data": <payload>, "traceId": "<server-uuid>" }`；单资源 `data.item`，列表 `data.items`+`data.pageInfo`，命令 `data.accepted`。
- 错误：HTTP 4xx/5xx `application/problem+json` `ProblemDetail`（数字 code 如 `40001`/`40401`、`traceId`），禁字符串 code/`success`/`message`。
- 经 `sdkwork-web-framework` 响应映射序列化。

5.2 路由前缀与表面：
- 评估 `/claw/api/v1` → `app-api`(`/app/v3/api`) 或 `backend-api`(`/backend/v3/api`)；`/claw/manage/v1` → `backend-api`；`/claw/health` 保留探针豁免。
- OpenAI 兼容代理（`local_ai_compat`、`openclaw_gateway_proxy`）若镜像上游 wire，声明 `x-sdkwork-wire-protocol: external` + `x-sdkwork-external-protocol-id`（API_SPEC §4.5.2）。

5.3 OpenAPI 3.1.2 + 路由清单：
- 建立 `apis/` 契约源（`app-api`/`backend-api`/`open-api`），每操作 `operationId = <domain>.<capability>.<action>`、`x-sdkwork-request-context: WebRequestContext`、`x-sdkwork-api-surface`、安全声明。
- 路由清单 `routes.manifest.json`（`requestContext`/`apiSurface`），框架物化为 OpenAPI 扩展。
- 替换 `http/routes/openapi.rs` 自生成逻辑。

5.4 校验：`node ../sdkwork-specs/tools/check-api-response-envelope.mjs --workspace .` 必须通过。

### Phase 6 — 服务端 Drive 集成（file_store → Drive）

目标：服务端文件写入经 `sdkwork-drive-uploader-service` 或 Drive RPC，达成高内聚低耦合。权威：`DRIVE_SPEC.md` §2/§13。【Human Review Gate：存储行为变更】

6.1 评估 `put_public_studio_instance_file_content` 语义：若为“实例工作台文件内容编辑”而非用户上传，判定是否属于 Drive `app_upload`/`ai_generated` 空间；若是，改用 `sdkwork-drive-uploader-service`（`sdkwork_drive_uploader_service`）写入，业务侧仅存 `driveSpaceId`/`driveNodeId`/`driveUri` 引用。
6.2 `host-core/storage/file_store.rs` 降级为 Drive 引用读模型，不再持有对象字节；删除自建本地对象存储逻辑。
6.3 若该文件属本地桌面运行时私有状态（非租户存储），明确标注为 `RUNTIME_DIRECTORY_SPEC` 私有路径，不纳入 Drive；但需在 component spec 声明边界。

### Phase 7 — 部署 / 打包对齐

7.1 `deployments/deploy.yaml`：按 SDKWORK_DEPLOY_SPEC 创建（当前缺失），声明 adaptive Web/API/WebSocket、nginx 站点生成、客户端包编排；`deployments/docker`、`deployments/kubernetes` 作为其下游产物。
7.2 GitHub workflow：核验/补全 `sdkwork.workflow.json` + `sdkwork-github-workflow` 复用流程（GITHUB_WORKFLOW_SPEC），矩阵、依赖 checkout、产物发布、attestation、部署环境。
7.3 部署配置对齐 DEPLOYMENT_SPEC：standalone/cloud parity、Java/Rust 切换、runtime bootstrap；`configs/` 与 `ENVIRONMENT_SPEC.md` 对齐。

### Phase 8 — component.spec.json / specs 补全

- 根 `specs/component.spec.json`：`languages` 加 `rust`；`canonicalSpecs` 补 `RUST_CODE_SPEC.md`、`WEB_FRAMEWORK_SPEC.md`、`WEB_BACKEND_SPEC.md`、`DATABASE_FRAMEWORK_SPEC.md`、`DATABASE_SPEC.md`、`API_SPEC.md`、`DRIVE_SPEC.md`、`DISCOVERY_SPEC.md`、`RPC_SPEC.md`、`SECURITY_SPEC.md`、`SDKWORK_DEPLOY_SPEC.md`、`GITHUB_WORKFLOW_SPEC.md`、`TEST_SPEC.md`、`MIGRATION_SPEC.md`、`DEPENDENCY_MANAGEMENT_SPEC.md`。
- `contracts.routeManifest` 指向 Phase 5 产物；`contracts.sdkClients` 补 Rust 侧 Drive/RPC 客户端（若引入）。
- 每个模块 `specs/component.spec.json` 的 `canonicalSpecs` 按语言补全。

### Phase 9 — 测试 / 安全 / 性能对齐

- 测试：统一 `pnpm test` 入口（PNPM_SCRIPT_SPEC），补 API 信封契约测试、框架采用证据测试、Drive 集成测试；Rust `cargo test --workspace`。
- 安全：CORS/auth/错误码全部经框架；`SECURITY_SPEC.md` 令牌、租户隔离、CORS、输入校验、安全日志核对；`PRIVACY_SPEC.md` 数据分类。
- 性能：`PERFORMANCE_SPEC.md` 延迟预算、分页；`OBSERVABILITY_SPEC.md` 日志/指标/追踪经框架。

### Phase 10 — 验证收尾

```bash
# TypeScript
pnpm install
pnpm lint
pnpm check:arch
pnpm check:parity
pnpm check:automation
pnpm check:multi-mode
pnpm build
# Rust
cargo check --workspace
cargo clippy --workspace --all-targets -- -D warnings
cargo test --workspace
# API 信封
node ../sdkwork-specs/tools/check-api-response-envelope.mjs --workspace .
# 数据库
# sdkwork-database-cli validate / migrate / seed / drift
# 框架采用证据
# node ../sdkwork-web-framework/scripts/validate-adoption-evidence.mjs
```

---

## 第三部分：风险与人工评审门

| 风险 | 触发阶段 | 处置 |
| --- | --- | --- |
| 公共命名迁移破坏 platform_app 注册 / desktopAppId / containerImage / 跨仓消费方 | Phase 1 | Human Review Gate；MIGRATION_SPEC 兼容窗口；先出消费方清单 |
| 数据库 schema 变更（rusqlite→framework） | Phase 3 | Human Review Gate；迁移脚本 + 回滚；dev 先行 |
| Drive 服务端存储行为变更 | Phase 6 | Human Review Gate；判定空间类型；保留引用兼容 |
| 框架依赖引入路径（path vs git） | Phase 2/3/4 | DEPENDENCY_MANAGEMENT_SPEC；发布前切 pinned git |
| 重命名环境锁 | Phase 0 | 干净环境执行；禁止强杀 IDE |

---

## 第四部分：建议执行顺序与里程碑

1. M1（Phase 0+1）：重命名 + 身份迁移完成，`pnpm install`/`cargo check` 通过。
2. M2（Phase 2+5）：Rust 后端接入 web-framework + API 信封/路由/OpenAPI 对齐，`check-api-response-envelope` 通过。
3. M3（Phase 3+4）：database 框架 + utils 接入，`sdkwork-database-cli` 全绿。
4. M4（Phase 6）：服务端 Drive 集成。
5. M5（Phase 7+8+9+10）：部署/打包/specs/测试/安全/性能收尾，全部校验命令通过。

> 本计划遵循 SOUL.md：specs before memory、evidence before completion。每个里程碑完成前必须运行对应校验命令并记录证据；任一校验失败不得进入下一里程碑。
