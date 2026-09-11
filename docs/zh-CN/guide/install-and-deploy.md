# 安装与部署

## 先选对产物类型

| 产物家族 | 典型输出 | 支持目标 | 适用场景 |
| --- | --- | --- | --- |
| Desktop | 安装器与应用包 | Windows、Linux、macOS | 需要原生桌面应用 |
| Server | 含内置 Web 资源的原生归档包 | Windows、Linux、macOS | 需要独立浏览器管理型服务 |
| Container | 面向 Docker 的部署包 | Linux `x64` 与 `arm64` | 使用 Docker / Compose 部署 |
| Kubernetes | Helm 兼容部署包 | Linux `x64` 与 `arm64` | 部署到 Kubernetes |
| Web | 静态 Web 与 docs 归档 | web | 只需要静态资源 |

## 基于源码的本地安装

### Web

```bash
pnpm install
pnpm dev
```

### 桌面端

```bash
pnpm install
pnpm dev:desktop
```

### Server

```bash
pnpm install
pnpm build
pnpm dev:server
```

当你希望原生 Server 提供当前构建出的浏览器界面时，先执行 `pnpm build` 再执行 `pnpm dev:server`。

## 默认访问入口

| 模式 | 默认或典型入口 |
| --- | --- |
| Web 工作区 | `http://localhost:3001` |
| 桌面端运行时 | 执行 `pnpm dev:desktop` 后打开原生窗口 |
| 原生 Server | 默认 `http://127.0.0.1:18797` |
| Container | 由部署包映射出的宿主端口 |
| Kubernetes | ingress 域名或 service 地址 |

## 桌面端安装说明

### Windows

桌面端发布产物通常会包含 `.exe` 或 `.msi` 等 Windows 安装器格式。

### Linux

桌面端发布产物通常会包含 `.deb`、`.rpm` 和 `.AppImage`。

### macOS

桌面端发布产物通常会包含 `.dmg` 和归档后的 `.app` 包。

## 原生 Server 安装说明

### Server 包结构

打包后的 Server 归档中包含：

- `bin/` 下的 Rust Server 二进制
- `web/dist/` 下的浏览器应用
- `.env.example`
- 可选启动包装脚本
- 包内 README

### Windows

```powershell
.\bin\agentstudio-server.exe
```

### Linux 与 macOS

```bash
./bin/agentstudio-server
```

当从解压后的 bundle 中直接启动原生二进制时，会默认：

- 将 `CLAW_SERVER_WEB_DIST` 指向包内的 `web/dist`
- 将 `CLAW_SERVER_DATA_DIR` 指向解压目录下的 `.agentstudio-server`

`start-agentstudio-server.cmd` 与 `start-agentstudio-server.sh` 仍然是可选的便捷包装脚本，它们调用的是同一个原生二进制，并保持相同的 bundle 默认值。

## 安装后验证

### Server

检查 readiness：

```bash
curl http://127.0.0.1:18797/claw/health/ready
```

读取 discovery：

```bash
curl http://127.0.0.1:18797/claw/api/v1/discovery
```

下载 OpenAPI 文档：

```bash
curl http://127.0.0.1:18797/claw/openapi/v1.json
```

### 启用 Basic Auth 的 Server

```bash
curl -u operator:manage-secret \
  http://127.0.0.1:18797/claw/manage/v1/rollouts
```

### Desktop

桌面端启动后，至少完成以下检查：

1. 确认窗口正常拉起
2. 打开关键设置或管理页面
3. 确认 provider 或 host 状态数据能正常加载，没有 bridge 错误

## Docker 部署

容器镜像会直接启动规范的 `app/bin/agentstudio-server` 原生二进制，而不是通过可选的 shell wrapper 间接启动。

> 通道说明：agentstudio 的容器路径是"解压 bundle 直跑 compose（GPU 覆盖层 / Kubernetes chart）"，**不属于**标准 `bin/` 五环境部署通道（`MODULE_BIN_SPEC.md`、`OPERATIONS_SPEC.md`）。标准 `bin/` 契约与运维 runbook 见 `docs/runbooks/`；在 GPU/K8s 面接入 `bin/lib/module.sh` 之前，本节仍是这些面的权威说明。

以下命令需要在解压后的 bundle 根目录执行。Compose 文件会从 `deployments/docker/profiles/*` 解析环境覆盖项，并把 bundle 根目录作为 Docker build context。

基础部署：

```bash
docker compose -f deployments/docker/docker-compose.yml up -d
```

NVIDIA CUDA 覆盖层：

```bash
docker compose -f deployments/docker/docker-compose.yml -f deployments/docker/docker-compose.nvidia-cuda.yml up -d
```

AMD ROCm 覆盖层：

```bash
docker compose -f deployments/docker/docker-compose.yml -f deployments/docker/docker-compose.amd-rocm.yml up -d
```

## Kubernetes 部署

```bash
helm upgrade --install agent-studio ./chart -f values.release.yaml
```

## 打包前校验

```bash
pnpm check:server
pnpm check:automation
pnpm release:plan
```

本地打包前置条件：

- `pnpm release:package:desktop` 只会收集已经生成完成的桌面安装器与应用包，需要先执行 `pnpm release:desktop` 或 `pnpm build:desktop`。
- `pnpm release:package:server` 在使用根级本地 wrapper 时会先刷新对应 target 的原生 Server release 二进制。这个构建仍然是增量的，但可以保证打包时使用的是当前 target 的最新产物，而不是之前遗留的旧二进制。
- `pnpm release:package:container` 在使用根级本地 wrapper 时会先刷新匹配目标架构的 Linux Server 二进制。在 Windows 上，如果已经安装 WSL 发行版，`pnpm build:server -- --target x86_64-unknown-linux-gnu` 会自动通过 WSL 构建；在 macOS 上，这条回退路径仍然需要显式准备对应的 Rust target 与 cross-build toolchain。
- `pnpm release:package:kubernetes` 只打包 chart 与 values 资产，因此不依赖本地先构建 Server 二进制。
- `pnpm release:finalize` 会读取当前 release 资产目录中的 family manifest。本地 wrapper 默认目录是 `artifacts/release`，GitHub workflow 使用的是 `release-assets/`。本地执行时，`release-manifest.json.repository` 会依次从 `SDKWORK_RELEASE_REPOSITORY`、`GITHUB_REPOSITORY`、`git remote origin` 推断；对于 `container` / `kubernetes`，结构化的 `status=skipped` deployment smoke 证据也会被原样保留，而不是被错误地视为通过。

## 常见运维操作

### 重启打包后的 Server Bundle

Windows：

```powershell
taskkill /IM agentstudio-server.exe /F
.\bin\agentstudio-server.exe
```

Linux 或 macOS：

```bash
pkill -f agentstudio-server || true
./bin/agentstudio-server
```

这些是针对打包后原生二进制的直接进程操作示例。包装脚本仍可用于本地运维便捷启动，但 `bin/` 下的二进制才是打包交付的规范入口。如果你把原生 Server 安装为系统服务，请优先使用 `agentstudio-server service start|stop|restart|status`，这样 CLI、浏览器管理和服务清单投影会保持一致。

### 安装为受管系统服务

当前打包后的 Server bundle 会在 `bin/` 目录下提供原生 service-capable 二进制，作为规范运行入口；`start-agentstudio-server.sh` 与 `start-agentstudio-server.cmd` 只是围绕同一原生二进制的可选便捷包装层。

Windows：

```powershell
.\bin\agentstudio-server.exe service install
.\bin\agentstudio-server.exe service status
```

Linux 或 macOS：

```bash
./bin/agentstudio-server service install
./bin/agentstudio-server service status
```

如果需要先审阅即将投影出来的服务单元，可以执行 `service print-manifest --platform <linux|macos|windows>`。`service install/start/stop/restart/status` 默认会使用当前平台，但仍然要求操作者具备对应系统服务管理器所需的权限。

### 查看 Container 部署状态

```bash
docker compose -f deployments/docker/docker-compose.yml ps
docker compose -f deployments/docker/docker-compose.yml logs --tail=200
```

### 查看 Kubernetes 部署状态

```bash
helm status agent-studio
kubectl get pods
kubectl get svc
```

### 验证浏览器可访问性

优先检查：

- `/claw/health/ready`
- `/claw/api/v1/discovery`
- `/claw/openapi/v1.json`

## 当前服务管理器边界

当前原生 Server 运行时已经内建 `systemd`、`launchd` 和 `Windows Service` 风格的服务生命周期支持。非 service 安装应优先使用 `./bin/agentstudio-server` 或 `.\bin\agentstudio-server.exe` 作为打包后的规范入口，`start-agentstudio-server.sh` 与 `start-agentstudio-server.cmd` 仅作为本地运维便捷包装脚本存在。`./bin/agentstudio-server service *`、`.\bin\agentstudio-server.exe service *` 与逻辑命令面 `agentstudio-server service *` 共享同一套受管服务入口。真正的安装、启动与停止仍然通过宿主操作系统自己的服务管理器完成，因此需要对应的平台权限。
## Release Readiness Gate

在发布前，`pnpm release:finalize` 之后必须执行：

```bash
pnpm release:assert-ready
```

该命令会重新读取最终 `release-manifest.json` 与 `SHA256SUMS.txt`，拒绝 partial coverage 或 `--allow-partial-release` 清单，验证每个 artifact 与 `releaseMetadata` 的 checksum 与 size，要求 `release-notes.md` 同时被 `releaseMetadata`、`SHA256SUMS.txt`、`release-attestations.json` 覆盖，并拒绝缺少、格式错误、引用的 smoke 证据文件已不在 release 资产目录中，或与引用 smoke report 内容不一致的家族级 smoke 元数据。
## 发布证据完整性补充

`pnpm release:finalize` 会记录 smoke evidence 的 `reportSha256` / `reportSize`、`manifestSha256` / `manifestSize`，桌面启动 smoke 还会记录 `capturedEvidenceSha256` / `capturedEvidenceSize`。部署发布前的 `pnpm release:assert-ready` 会重新校验这些 sha256/size 绑定和 smoke report 内容，防止证据文件在 finalization 后被替换。

发布完整性补充：`pnpm release:finalize` 会为顶层 `release-manifest.json` 生成 `release-manifest.json.sha256.txt`；部署或发布前的 `pnpm release:assert-ready` 会先校验该 sidecar，再继续校验 `SHA256SUMS.txt`、artifact checksum/size 与 smoke evidence。
## release-attestations.json

发布前在 `pnpm release:finalize` 之后运行 `pnpm release:write-attestation-evidence -- --release-assets-dir artifacts/release --repository sdkwork-ai/agent-studio --release-tag release-local`，再运行 `pnpm release:assert-ready`。`release-attestations.json` 记录每个 artifact 与 release metadata（包括 `release-notes.md`）的 `gh attestation verify` 结果，并要求 `relativePath`、`sha256`、`repository`、`releaseTag`、`sourceRef`、`predicateType` 与 `release-manifest.json` 一致。

部署发布必须把 artifact 证明绑定到指定发布 workflow：`gh attestation verify --signer-workflow <owner/repo/.github/workflows/release-reusable.yml>`。`release-attestations.json` 会记录 `signerWorkflow` 与 `signerWorkflowIdentity`，`pnpm release:assert-ready` 会拒绝未绑定 signer workflow identity 或命令中缺少 `--signer-workflow` 的证明证据。
