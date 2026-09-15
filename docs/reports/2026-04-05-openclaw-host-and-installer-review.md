# OpenClaw Host And Installer Review

Date: 2026-04-05

## Scope

This review covered four connected problem areas:

1. bundled OpenClaw version centralization and package release assets
2. installer-time OpenClaw preparation across Windows, Linux, and macOS
3. desktop hosted control-plane bootstrapping and `qistudio.resolveHostedBasePath` failures
4. host-mode contract drift between desktop and canonical server surfaces

The bundled OpenClaw release metadata is now pinned to `2026.4.2` in `config/openclaw-release.json`. This matches the latest upstream GitHub release that was visible on 2026-04-05 during this review.

## Findings

### Critical

1. Installer prewarm failures were previously allowed to fall through to first launch.
   - Windows NSIS hooks logged a deferred message and continued.
   - Linux postinstall also swallowed prewarm failures with `|| true`.
   - Impact: installation could report success even though the bundled OpenClaw runtime had not been prepared, which pushed extraction and recovery work into desktop startup.
   - Status: fixed. Windows installer prewarm now aborts installation on failure. Linux postinstall now exits non-zero when install-root discovery, binary discovery, or runtime prewarm fails.

### High

2. Linux packaged binary fallback lookup could emit multiple `command -v` results.
   - The postinstall helper printed both `agent-studio` and `sdkwork-agentstudio-pc-desktop` lookups without returning after the first match.
   - Impact: the script could build an invalid multi-line executable path and fail to invoke the intended packaged binary.
   - Status: fixed. The helper now captures and returns the first valid command path deterministically. The embedded prepare/register CLI now also accepts an explicit `--install-root` override, and the Linux postinstall hook forwards the resolved install root into that CLI so runtime preparation and managed install paths stay anchored to the packaged resource root even when the launcher binary is not resource-adjacent.

3. Desktop hosted runtime resolution raced the Tauri runtime and could fail with:
   - `qistudio.resolveHostedBasePath failed for studio.resolveHostedBasePath: Canonical desktop embedded host browserBaseUrl is unavailable.`
   - Impact: hosted studio surface initialization failed before the desktop embedded host runtime descriptor was ready.
   - Status: fixed. Desktop hosted bridge resolution now waits for Tauri runtime readiness and consumes a canonical runtime descriptor instead of inferring `browserBaseUrl` indirectly from host endpoints.

### Medium

4. Release archive verification and reuse previously trusted `runtime.zip` presence instead of validating archive payload contents.
   - Impact: a stale or malformed packaged runtime archive could pass release checks and be reused even when its embedded runtime sidecar no longer matched the canonical prepared runtime contract, which reopened the risk of install-time preparation drift and startup-time revalidation or reinstall.
   - Status: fixed. Release verification now parses `runtime.zip` directly and requires the packaged archive to contain the runtime sidecar plus bundled Node and CLI entrypoints. Archive reuse now validates archive payload contents instead of reusing any same-version archive blindly.

5. Runtime materialization previously accepted extracted OpenClaw payloads without requiring a matching runtime sidecar.
   - Impact: installer prewarm could still report success after extracting a malformed or stale archive as long as the bundled Node and CLI entrypoints existed, which left a remaining path for startup-time reinstall or revalidation work.
   - Status: fixed. The desktop runtime service now validates the materialized manifest, Node entrypoint, CLI entrypoint, and runtime sidecar integrity before accepting either directory-backed or archive-backed payloads.

6. Desktop hosted browser requests did not consistently forward the browser session token.
   - Impact: desktop combined mode could lose auth parity with server-hosted browser mode for manage, internal, and studio HTTP surfaces.
   - Status: fixed. Shared browser-session-aware fetch wiring now sits under both server and desktop hosted bridges.

7. Desktop startup probing only validated `app.getInfo()` and did not prove the hosted control-plane surface was reachable.
   - Impact: startup could be marked healthy while the actual embedded host contract remained unavailable.
   - Status: fixed. Startup now probes hosted control-plane status and host endpoints during bootstrap.

8. Desktop host platform lifecycle was incorrectly coupled to OpenClaw gateway runtime state.
   - Impact: host platform status could degrade even when the embedded host itself was healthy.
   - Status: fixed. Lifecycle now follows embedded host runtime state, with `starting` or `stopped` fallbacks when no runtime snapshot exists.

9. Desktop capability keys drifted from the shared server host contract.
   - Impact: the desktop combined host underreported control-plane capabilities relative to canonical server behavior.
   - Status: fixed. Desktop now reuses shared server-side capability helpers for mode-based capability key derivation.

10. Windows short-path OpenClaw alias refresh could still fail on locked legacy mirror roots.
   - Observed failure:
     - `EPERM: operation not permitted, unlink '<device-state-dir>/.sdkwork-bc\agent-studio\openclaw\runtime.zip'`
   - Root cause:
     - older workspaces could retain a real directory at the stable short-path alias root instead of a junction
     - the refresh path previously required deleting that root before recreating the alias
     - if `manifest.json` or `runtime.zip` were locked by another process, prepare failed and required a manual `SDKWORK_WINDOWS_MIRROR_BASE_DIR` override
   - Impact:
     - `prepare-openclaw-runtime.mjs` could still fail on Windows even though the canonical packaged release root was valid
     - the fix path was operationally fragile because callers had to remember an environment override
   - Status: fixed. Windows alias refresh now:
     - first tries to reuse a valid archive-only short-path root
     - then attempts in-place archive repair when cleanup is locked
     - and finally falls back automatically to a workspace-local short mirror base dir under `.cache/short-mirrors`
     - the selected mirror base dir is persisted into `generated/release/windows-mirror-base-dir.json` so later bundle scripts reuse the same short path automatically

11. The direct Windows NSIS bundle entrypoint could still skip OpenClaw alias repair between prepare and build.
   - Root cause:
     - `run-windows-tauri-bundle.mjs` verified packaged OpenClaw release assets, but did not reassert the Windows short-path OpenClaw alias root before invoking `tauri build`
     - that left a remaining drift window where `prepare-openclaw-runtime` had succeeded earlier, but the alias root could be removed or stale before a later direct bundle run
   - Impact:
     - direct Windows bundle runs could still depend on prior side effects from `sync-bundled-components`
     - NSIS retry rewrites could point at a persisted short-path root that had not been refreshed for the current bundle invocation
   - Status: fixed. `run-windows-tauri-bundle.mjs` now explicitly refreshes the canonical Windows OpenClaw alias root after release-asset preflight and before `tauri build`.

12. Persisted Windows short-mirror fallback state could become stale after a workspace path move.
   - Root cause:
     - `generated/release/windows-mirror-base-dir.json` stores an absolute mirror base dir
     - the resolver previously trusted any persisted value blindly, including a fallback path that no longer belonged to the current workspace
   - Impact:
     - a moved or re-cloned workspace could still rewrite NSIS and bridge paths toward an old `.cache/short-mirrors` location from another checkout
     - subsequent bundle or prepare runs could silently target the wrong short-path root
   - Status: fixed. Persisted Windows mirror base state is now accepted only when it still matches one of the current workspace's valid roots:
     - the current default short-path base dir under `.sdkwork-bc`
     - or the current workspace-local fallback dir under `.cache/short-mirrors`

13. Low-level Windows mirror path resolvers accepted `win32` but not `windows`.
   - Root cause:
     - `resolveBundledResourceMirrorBaseDir(...)` and `resolveBundledResourceMirrorRoot(...)` previously branched directly on `platform === 'win32'`
     - several higher-level helpers already normalize both `windows` and `win32`, so the low-level resolvers were weaker than their callers
   - Impact:
     - passing `platform = 'windows'` could silently return an empty mirror base dir or the non-Windows resource path
     - that reopened the risk of helper-level contract drift across prepare, bundle, and bridge path resolution
   - Status: fixed. Both resolvers now normalize `windows -> win32` before selecting the Windows short-path mirror logic.

14. The desktop release `all` phase silently dropped explicit package-build customization flags when delegating into `@sdkwork/agentstudio-pc-desktop`.
   - Root cause:
     - `run-desktop-release-build.mjs --phase all` previously delegated to `pnpm --filter @sdkwork/agentstudio-pc-desktop run build:desktop` without forwarding the resolved `--profile`, `--vite-mode`, `--bundles`, or caller-provided overrides
     - direct phase-specific execution paths already respected those values, so the drift existed only in the convenience `all` orchestration path
   - Impact:
     - local or scripted desktop release runs that relied on `--phase all` could silently build with package defaults instead of the requested release profile, Vite mode, bundle set, or target combination
     - that reopened the risk of packaging the wrong installer mix even when OpenClaw release preparation and alias repair were already correct
   - Status: fixed. The `all` phase now forwards the resolved package-build arguments through `--` into `@sdkwork/agentstudio-pc-desktop` and the release-flow contract tests now lock that behavior.

15. Points recharge integration drifted behind the generated shared SDK surface.
   - Root cause:
     - `pointsWalletService` still called `client.account.rechargePoints(...)`
     - the current generated SDK exposes `client.account.createRecharge(...)` instead
   - Impact:
     - points recharge flows could fail as soon as workspace TypeScript validation or runtime packaging consumed the current generated SDK
     - the drift weakened the guarantee that bundled Agent Studio business flows stay aligned with the canonical app SDK surface
   - Status: fixed. `pointsWalletService` now uses `client.account.createRecharge(...)` and the service test fixture was updated to lock the current generated contract.

16. Desktop update-check request shaping drifted from the current generated SDK types and backend payload contract.
   - Root cause:
     - `updateClient` still treated `AppUpdateCheckForm.metadata` and `capabilities` as if the generated TypeScript surface matched the older handwritten request shape
     - the backend still expects a flat `Map<String, Object>` style metadata payload
   - Impact:
     - workspace type safety regressed around update checks
     - future update request changes could have broken desktop update negotiation or encouraged a second compatibility shim instead of staying on the generated SDK contract
   - Status: fixed. `updateClient` now keeps the request payload flat while satisfying the current SDK types, and `updateClient.test.ts` now asserts the exact outbound body shape.

17. Workspace parity checks depended on `tsx` child-process startup and could fail with Windows `spawn EPERM`.
   - Root cause:
     - multiple `run-sdkwork-*-check.mjs` scripts launched TypeScript service checks via `tsx`
     - on this Windows environment, the nested `tsx` / `esbuild` process startup path could fail before the actual business checks ran
   - Impact:
     - `pnpm.cmd lint` could fail for tool-runner reasons instead of real product regressions
     - parity verification for auth, agent, chat, and core services became operationally fragile even when the app code itself was healthy
   - Status: fixed. The parity runners now share a native Node TypeScript execution path based on `node --experimental-strip-types`, centralized in `scripts/run-node-typescript-check.mjs` with `scripts/ts-extension-loader.mjs`, and the corresponding contract tests now lock that execution model.

18. Host-runtime contract coverage drifted behind the current desktop bootstrap import shape after hosted control-plane startup hardening.
   - Root cause:
     - `scripts/sdkwork-host-runtime-contract.test.ts` still expected `DesktopBootstrapApp.tsx` to import only `getAppInfo` and `setAppLanguage` from `tauriBridge`
     - the current bootstrap now also imports `probeDesktopHostedControlPlane` as part of the canonical hosted desktop startup path
   - Impact:
     - `pnpm.cmd lint` could still report a false-negative parity failure after a valid host bootstrap improvement
     - this weakened confidence in the host-mode contract gate because it no longer reflected the real desktop startup surface
   - Status: fixed. The contract now accepts the current `tauriBridge` import shape, and the dedicated desktop bootstrap test continues to lock the hosted control-plane probe behavior separately.

19. Shared browser host metadata injection trusted any preexisting `index.html` meta tags instead of refreshing them from the live host runtime.
   - Root cause:
     - `inject_server_host_metadata(...)` returned the original HTML as soon as the core host meta tag names were present
     - this skipped value refresh for `host-mode`, `distribution-family`, `deployment-family`, `accelerator-profile`, base paths, and `sdkwork-agentstudio-pc-browser-session-token`
   - Impact:
     - server, desktop combined, Docker, and Kubernetes browser shells could drift away from the real live host identity if the built frontend bundle already contained placeholder or stale meta values
     - stale browser session token metadata could break hosted control-plane requests after host restarts or deployment-mode changes
   - Status: fixed. The server static asset layer now strips the managed host metadata set from HTML responses and reinjects the current runtime-derived values on every browser-shell response. Optional accelerator and browser-session metadata are also removed when not configured.

### High (Additional)

20. Hosted browser platform bridge snapshots browser-session and host metadata at bootstrap time instead of resolving live values per request.
   - Root cause:
     - `bootstrapShellRuntime()` called `configureServerBrowserPlatformBridge()` once during page startup
     - the previous browser bridge implementation created fixed `manage`, `internal`, `studio`, and `runtime` adapters from that first metadata snapshot
     - if a running server, Docker, Kubernetes, or desktop-combined host refreshed the browser session token or other hosted metadata later, the browser bridge kept using the stale token and stale startup metadata until a full page reload
   - Impact:
     - hosted control-plane requests from already-open browser shells could keep sending an expired `x-claw-browser-session` header after host restarts or rolling updates
     - this recreated the same class of stale identity bug that was already fixed for the desktop Tauri bridge
   - Status: fixed. The browser hosted bridge now installs resolver-driven `manage`, `internal`, `studio`, and `runtime` adapters that reread the current live host metadata for each hosted request instead of freezing the first bootstrap snapshot.

### Medium (Additional)

21. The default web-preview host status placeholder drifted behind the shared `HostPlatformStatusRecord` contract.
   - Root cause:
     - the fallback `internal.getHostPlatformStatus()` object in `registry.ts` still omitted `distributionFamily` and `deploymentFamily`
     - the shared TypeScript contract also excluded `web` from `distributionFamily`, even though `HostPlatformMode` and the runtime startup context already model a `web` preview mode
   - Impact:
     - workspace TypeScript validation failed even though the fallback bridge is part of the production shared platform layer
   - the internal host-status contract and runtime startup contract no longer agreed on the legal shape of the web-preview fallback surface
   - Status: fixed. The fallback host status now reports `distributionFamily: web` and `deploymentFamily: bareMetal`, the shared TypeScript contract now allows `web`, and the server OpenAPI schema/test were updated to keep the published contract aligned with the shared bridge model.

22. Shared SDK preparation still escalated a missing package-local link into a full workspace `pnpm install`.
   - Root cause:
     - `scripts/prepare-shared-sdk-packages.mjs` previously treated a missing `@sdkwork/sdk-common` link inside the sibling `retired generic app SDK package` checkout as a signal to rerun `pnpm install` for the entire Agent Studio workspace
     - that conflated two separate concerns:
       - workspace root dependency installation
       - package-local dependency link hydration for the sibling shared SDK checkouts
   - Impact:
     - `prepare:shared-sdk`, `pnpm lint`, and `pnpm build` could fall into an unnecessary heavyweight install path
     - on this environment that path failed with `ERR_PNPM_ENOSPC`, even though the real missing state was only a small set of package-local links and build-tool entries under the sibling shared SDK workspaces
   - Status: fixed. Shared SDK preparation now repairs package-local dependency links directly from the existing workspace install, preserves already-present package-local installs, and hydrates devDependencies only when a shared SDK package actually needs rebuilding.

23. Shell lazy-loading still collapsed optional chat and workspace-switcher surfaces back into the entry bundle.
   - Root cause:
     - `packages/sdkwork-agentstudio-pc-shell/src/application/layouts/MainLayout.tsx` still statically imported `OpenClawGatewayConnections` and `ChatCronActivityNotifications`, even though the main chat route is lazy-loaded
     - `packages/sdkwork-agentstudio-pc-shell/src/index.ts` still re-exported `InstanceSwitcher`, which defeated the local lazy boundary inside `AppHeader.tsx`
   - Impact:
     - production builds emitted `INEFFECTIVE_DYNAMIC_IMPORT` warnings for `@sdkwork/agentstudio-pc-chat` and `InstanceSwitcher`
     - browser, desktop, server-hosted, Docker, and Kubernetes shells could preload optional chat warmers and the workspace switcher earlier than intended, weakening startup responsiveness and chunk separation
   - Status: fixed. The shell now lazy-loads a dedicated `ChatRuntimeWarmers` bridge component from `MainLayout`, and the shell root no longer re-exports `InstanceSwitcher`. The shell contract test now locks both lazy boundaries.

24. The default web studio bridge was still being pulled into the main infrastructure runtime even after the shell lazy-boundary cleanup.
   - Root cause:
     - `packages/sdkwork-agentstudio-pc-infrastructure/src/platform/registry.ts` still eagerly instantiated `WebStudioPlatform`
     - production barrel exports from `packages/sdkwork-agentstudio-pc-infrastructure/src/index.ts` and `packages/sdkwork-agentstudio-pc-infrastructure/src/platform/index.ts` still re-exported `WebStudioPlatform`, which collapsed the intended lazy boundary
   - Impact:
     - web-only and hosted runtime consumers kept paying the cost of the studio bridge upfront
     - `claw-infrastructure` stayed oversized and the lazy split around the studio platform was not real even though the code path was conceptually optional
   - Status: fixed. The default browser runtime now routes studio access through `LazyWebStudioPlatform`, production barrels no longer export `WebStudioPlatform`, and the build now emits a dedicated `claw-platform-web-studio` chunk (`37.96 kB`) while reducing `claw-infrastructure` to `479.19 kB`, below the previous large-chunk warning threshold.

25. The web workspace remap plugin still stayed on the resolution hot path for normal non-worktree builds.
   - Root cause:
     - direct `@sdkwork/agentstudio-pc-*` package imports were still flowing through custom resolver logic instead of deterministic aliases
     - the worktree remap plugin could stay enabled even when the workspace was not running from a `.worktrees/...` checkout
   - Impact:
     - normal web builds paid avoidable resolution overhead
     - plugin timing noise obscured the remaining real build hotspots
   - Status: fixed. Web and desktop Vite hosts now share one workspace resolver implementation. Direct `@sdkwork/agentstudio-pc-*` package imports resolve through generated aliases, the worktree remap plugin is enabled only for actual worktree paths or an explicit `SDKWORK_ENABLE_WORKTREE_RESOLVER=true` override, and the remaining build warning is now generic `rolldown:vite-resolve` plus Tailwind generation timing instead of the custom workspace remap plugin.

26. Desktop release assets, smoke reports, and the final aggregated release manifest still did not surface one machine-readable OpenClaw installer contract and smoke-evidence chain for packaged desktop targets.
   - Root cause:
     - desktop partial manifests persisted artifact-local metadata, but the final aggregated `release-manifest.json` still collapsed desktop artifacts down to plain file records
     - installer smoke and release finalization validated installable artifacts and smoke evidence, but the final release manifest did not expose which packaged desktop artifacts had been smoked against which platform-specific OpenClaw install contract
     - that left a gap where source-side NSIS, Linux postinstall, or macOS staged-layout regressions could drift away from previously packaged desktop artifacts without downstream release consumers seeing the same contract/evidence chain that finalization had validated
   - Impact:
     - desktop release assets did not carry explicit evidence that Windows still aborts on prewarm failure, Linux still prewarms during postinstall with install-root override support, or macOS still relies on the preexpanded managed runtime layout once consumers moved past the per-target partial manifests
     - smoke evidence proved dry-run installability, but the final release manifest could not show which desktop artifacts were covered, when they were verified, or where the persisted smoke report lived
   - Status: fixed. Desktop packaging now persists `openClawInstallerContract` metadata into each desktop `release-asset-manifest.json`, desktop smoke validates that metadata against the current source contract before writing `installer-smoke-report.json`, release finalization rejects desktop artifacts whose manifest or smoke report contract is missing or stale, and the final aggregated `release-manifest.json` now lifts the same `openClawInstallerContract` plus a sanitized `desktopInstallerSmoke` summary onto every packaged desktop artifact record.

27. Archive-only desktop release verification still did not prove that Windows and Linux packaged OpenClaw resources could materialize the install-root layout that the startup fast path expects after installer prewarm.
   - Root cause:
     - `verify-desktop-openclaw-release-assets.mjs` verified archive-only resource roots for Windows/Linux and a staged install-root layout for macOS, but it stopped short of simulating the Windows/Linux postinstall prewarm output
     - that meant the verifier could prove `runtime.zip` shape and sidecar contents without proving that the packaged archive could be expanded into a runtime install tree matching `manifest.json`, `.sdkwork-openclaw-runtime.json`, bundled Node, and CLI entrypoints at the paths the desktop runtime service checks on first launch
   - Impact:
     - the packaged release verifier could still miss regressions where an archive looked structurally valid but no longer produced an install-root layout compatible with the runtime sidecar fast path
     - smoke reports and final release manifests could not distinguish between “archive looks valid�?and “archive has been proven install-ready for startup reuse�?
   - Status: fixed. The desktop OpenClaw release verifier now simulates archive-prewarm materialization for Windows and Linux in a disposable temp install-root, validates the resulting manifest/sidecar/entrypoint layout against the same startup readiness assumptions as the desktop runtime service, returns a normalized `installReadyLayout` summary per platform, and desktop smoke plus final release manifests now persist that summary alongside the installer contract evidence. Desktop smoke now rejects verifier results that do not prove an install-ready layout or whose `installReadyLayout.mode` drifts from the current target platform contract, and release finalization now rejects desktop smoke reports that omit, corrupt, or mode-drift that proof.

28. The GitHub desktop release workflow and public release contract still did not promote desktop installer smoke to a mandatory release step even after finalization started requiring smoke evidence.
   - Root cause:
     - the local `release:package:desktop` wrapper already chained `smoke-desktop-installers.mjs`, but `.github/workflows/release-reusable.yml` still packaged and uploaded desktop assets without an explicit smoke step
     - `scripts/check-release-closure.mjs` and `docs/core/release-and-deployment.md` still documented the generic release families without treating `openClawInstallerContract`, `desktopInstallerSmoke`, and `desktopInstallerSmoke.installReadyLayout` as part of the public desktop release contract
   - Impact:
     - CI could drift away from the local desktop packaging contract and risk attesting/uploading desktop assets that had not been smoke-verified after packaging
     - downstream maintainers had no contract-level reminder that packaged desktop correctness now depends on persisted OpenClaw installer metadata plus install-ready smoke evidence
   - Status: fixed. The reusable GitHub release workflow now runs `scripts/release/smoke-desktop-installers.mjs` immediately after desktop asset packaging and before attestation/upload, `scripts/check-release-closure.mjs` now rejects workflow or documentation regressions around that step, and `docs/core/release-and-deployment.md` now documents `release:smoke:desktop`, `openClawInstallerContract`, `desktopInstallerSmoke`, and `installReadyLayout` as explicit desktop release contract surface.

## Packaging Model Review

### Windows

- The packaged bundle ships archive-only OpenClaw resources under `resources/openclaw/`.
- NSIS postinstall invokes:
  - `--prepare-bundled-openclaw-runtime --install-root "$INSTDIR"`
  - `--register-openclaw-cli --install-root "$INSTDIR"`
- The runtime prewarm step is now mandatory. If it fails, the installer aborts.
- NSIS now forwards the canonical installer root explicitly into both embedded CLI actions so runtime preparation, CLI registration, and later startup all resolve the same managed install root instead of relying on implicit `current_exe()` layout assumptions.
- If the legacy default short-path alias root under `<device-state-dir>/.sdkwork-bc\...` is locked, prepare now auto-switches to the persisted workspace-local fallback mirror root instead of requiring a manual environment override.

### Linux

- The packaged bundle maps release-staged OpenClaw resources into `resources/openclaw/`.
- `deb` and `rpm` use `linux-postinstall-openclaw.sh`.
- The postinstall hook now:
  - honors explicit install-root overrides via `SDKWORK_CLAW_INSTALL_ROOT`
  - resolves relocatable RPM prefixes via `RPM_INSTALL_PREFIX`
  - accepts manual `--install-root` overrides for deterministic smoke/debug reruns
  - forwards the resolved install root into the embedded prepare CLI so `AppPaths.install_root` and bundled resource lookup use the same packaged root
  - resolves the packaged install root from the bundled OpenClaw manifest
  - resolves the installed desktop binary deterministically
  - fails installation if the packaged layout is broken or runtime prewarm fails

### macOS

- The packaged app still ships archive-only OpenClaw resources under `resources/openclaw/`.
- In addition, release packaging projects a preexpanded managed install-root layout into `Contents/MacOS/`.
- Result: packaged macOS builds do not need a postinstall extraction step because the managed runtime layout is already staged into the app bundle.

## Startup Path Review

Desktop startup still calls `ensure_bundled_runtime`, but the intended behavior is now:

1. verify the managed runtime install already exists
2. verify the bundled manifest and sidecar integrity still match
3. return immediately without re-extracting when install-time preparation already succeeded

That means startup keeps a fast validation path, but no longer needs to serve as the primary extraction path.

## Verification

The following targeted checks passed after the latest changes:

- `node scripts/tauri-dev-command-contract.test.mjs`
- `node scripts/check-desktop-platform-foundation.test.mjs`
- `node scripts/check-desktop-platform-foundation.mjs`
- `node scripts/openclaw-release-contract.test.mjs`
- `node scripts/prepare-openclaw-runtime.test.mjs`
- `node scripts/release-flow-contract.test.mjs`
- `node scripts/ts-extension-loader.test.mjs`
- `node --experimental-strip-types scripts/sdkwork-core-contract.test.ts`
- `node --experimental-strip-types scripts/sdkwork-host-runtime-contract.test.ts`
- `node --experimental-strip-types scripts/sdkwork-shell-contract.test.ts`
- `node scripts/run-desktop-release-build.test.mjs`
- `node scripts/verify-desktop-openclaw-release-assets.test.mjs`
- `node scripts/sync-bundled-components.test.mjs`
- `node scripts/run-windows-tauri-bundle.test.mjs`
- `node scripts/release/smoke-desktop-installers.test.mjs`
- `node --experimental-strip-types scripts/sdkwork-host-runtime-contract.test.ts`
- `node --experimental-strip-types packages/sdkwork-agentstudio-pc-infrastructure/src/updates/updateClient.test.ts`
- `node scripts/prepare-openclaw-runtime.mjs`
- `node -e "import('./scripts/run-windows-tauri-bundle.mjs').then(async (m) => { const result = await m.ensureWindowsBundleOpenClawAliasRoot({ workspaceRootDir: process.cwd(), platform: 'win32' }); console.log(result ?? 'null'); })"`
- `node -e "import('./scripts/prepare-openclaw-runtime.mjs').then((m) => { console.log(m.resolveBundledResourceMirrorRoot(process.cwd(), 'openclaw', 'win32')); })"`
- `node -e "import('./scripts/prepare-openclaw-runtime.mjs').then((m) => { console.log('base-win32=' + m.resolveBundledResourceMirrorBaseDir(process.cwd(), process.env, 'win32')); console.log('base-windows=' + m.resolveBundledResourceMirrorBaseDir(process.cwd(), process.env, 'windows')); console.log('root-win32=' + m.resolveBundledResourceMirrorRoot(process.cwd(), 'openclaw', 'win32')); console.log('root-windows=' + m.resolveBundledResourceMirrorRoot(process.cwd(), 'openclaw', 'windows')); })"`
- `node scripts/verify-desktop-openclaw-release-assets.mjs`
- `node --experimental-strip-types packages/sdkwork-agentstudio-pc-desktop/src/desktop/tauriBridge.test.ts`
- `node --experimental-strip-types packages/sdkwork-agentstudio-pc-desktop/src/desktop/bootstrap/DesktopBootstrapApp.test.ts`
- `node --experimental-strip-types packages/sdkwork-agentstudio-pc-desktop/src/desktop/desktopHostedBridge.test.ts`
- `node --experimental-strip-types packages/sdkwork-agentstudio-pc-infrastructure/src/platform/serverBrowserBridge.test.ts`
- `node --experimental-strip-types packages/sdkwork-agentstudio-pc-infrastructure/src/platform/registry.test.ts`
- `node --experimental-strip-types packages/sdkwork-agentstudio-pc-desktop/viteBuildOptimization.test.ts`
- `node --experimental-strip-types packages/sdkwork-agentstudio-pc-web/viteWorkspaceResolver.test.ts`
- `node scripts/package-release-assets.test.mjs`
- `node scripts/release/finalize-release-assets.test.mjs`
- `$env:CARGO_TARGET_DIR='<home>\.codex\memories\agent-studio-cargo-target'; $env:CARGO_INCREMENTAL='0'; $env:CARGO_BUILD_JOBS='1'; $env:RUSTFLAGS='-C debuginfo=0'; cargo test --manifest-path packages/sdkwork-agentstudio-pc-server/src-host/Cargo.toml inject_server_host_metadata_ -- --nocapture`
- `$env:CARGO_TARGET_DIR='<home>\.codex\memories\agent-studio-cargo-target'; $env:CARGO_INCREMENTAL='0'; $env:CARGO_BUILD_JOBS='1'; $env:RUSTFLAGS='-C debuginfo=0'; cargo test --manifest-path packages/sdkwork-agentstudio-pc-server/src-host/Cargo.toml openapi_v1_document_describes_host_platform_state_store_driver -- --nocapture`
- `pnpm.cmd --filter @sdkwork/agentstudio-pc-web lint`
- `pnpm.cmd check:sdkwork-core`
- `node scripts/run-sdkwork-auth-check.mjs`
- `node scripts/run-sdkwork-agent-check.mjs`
- `node scripts/run-sdkwork-chat-check.mjs`
- `$env:CARGO_TARGET_DIR='<home>\.codex\memories\agent-studio-rust-target'; cargo test --manifest-path packages/sdkwork-agentstudio-pc-desktop/src-tauri/Cargo.toml rejects_ -- --nocapture`
- `$env:CARGO_TARGET_DIR='<home>\.codex\memories\agent-studio-rust-target'; cargo test --manifest-path packages/sdkwork-agentstudio-pc-desktop/src-tauri/Cargo.toml installs_bundled_runtime_from_runtime_archive_bridge -- --nocapture`
- `$env:CARGO_TARGET_DIR='<home>\.codex\memories\agent-studio-rust-target'; cargo test --manifest-path packages/sdkwork-agentstudio-pc-desktop/src-tauri/Cargo.toml reinstalls_archived_install_when_runtime_sidecar_is_missing -- --nocapture`

Additional verification notes for the shared SDK preparation hardening:

- The new regression coverage for `scripts/prepare-shared-sdk-packages.mjs` passed inside `node scripts/release-flow-contract.test.mjs`.
- A direct end-to-end run of `node scripts/prepare-shared-sdk-packages.mjs` could not be completed inside this Codex sandbox because the script now correctly repairs `node_modules` links inside sibling shared SDK workspaces outside the writable root, and the sandbox rejected that write with:
  - `EPERM: operation not permitted, mkdir '...retired generic app SDK TypeScript package\\node_modules\\@sdkwork'`
- This `EPERM` is a sandbox boundary in the current review environment, not the old `ERR_PNPM_ENOSPC` behavior. The previous full-workspace install escalation path has been removed from the preparation script.
- `$env:CARGO_TARGET_DIR='<home>\.codex\memories\agent-studio-rust-target'; cargo test --manifest-path packages/sdkwork-agentstudio-pc-desktop/src-tauri/Cargo.toml host_platform_status_ -- --nocapture`
- `$env:CARGO_TARGET_DIR='<home>\.codex\memories\agent-studio-rust-target'; cargo test --manifest-path packages/sdkwork-agentstudio-pc-desktop/src-tauri/Cargo.toml embedded_host_bootstrap_serves_root_html_with_desktop_combined_host_metadata -- --nocapture`
- `$env:CARGO_TARGET_DIR='<home>\.codex\memories\agent-studio-rust-target'; cargo test --manifest-path packages/sdkwork-agentstudio-pc-desktop/src-tauri/Cargo.toml framework_context_exposes_live_desktop_host_status -- --nocapture`
- `$env:CARGO_TARGET_DIR='<home>\.codex\memories\agent-studio-rust-target'; cargo test --manifest-path packages/sdkwork-agentstudio-pc-server/src-host/Cargo.toml desktop_combined_ -- --nocapture`
- `node scripts/run-sdkwork-core-check.mjs`
- `node scripts/run-sdkwork-auth-check.mjs`
- `pnpm.cmd build`
- `pnpm.cmd lint`

Latest full-build evidence from the fresh workspace run:

- `pnpm.cmd build` completed successfully after `pnpm sdk:prepare-shared`
- the build no longer emits `INEFFECTIVE_DYNAMIC_IMPORT` warnings
- the build no longer emits the previous large-chunk warning for `claw-infrastructure`
- `claw-platform-web-studio` is now emitted as a dedicated chunk at `37.96 kB`
- `claw-infrastructure` is now emitted at `479.19 kB`
- the only remaining warning is a non-blocking plugin timing breakdown led by:
  - `rolldown:vite-resolve`
  - `@tailwindcss/vite:generate:build`
  - `vite:terser`

## Remaining Risks

1. Default workspace Rust target directories under `packages/sdkwork-agentstudio-pc-desktop/src-tauri/target*` still have disk-pressure risk.
   - Targeted Rust verification for the changed host/runtime surfaces passed by redirecting `CARGO_TARGET_DIR` to `<home>\.codex\memories\agent-studio-rust-target`.
   - Full default-path `cargo test` and `cargo check` sweeps were not rerun because the large local target directories could not be destructively cleaned under the current tool policy.

2. Production bundles still report a non-blocking generic build-plugin timing warning.
   - `pnpm.cmd build` now passes and no longer emits the previous `INEFFECTIVE_DYNAMIC_IMPORT` or large-chunk warnings.
   - The remaining warning is currently dominated by:
     - `rolldown:vite-resolve`
     - `@tailwindcss/vite:generate:build`
     - `vite:terser`
   - This does not block correctness or packaging, but it is still worth a profiler-guided follow-up if build time becomes a release priority.

3. Windows CLI registration remains best-effort during install.
   - This does not affect bundled runtime preparation.
   - It can still fall back to first-launch shell shim registration if user shell exposure fails during installation.

4. Real packaged installer smoke has not yet been executed in disposable Windows, Linux, and macOS environments.
   - Contract, manifest, smoke-report, and script-level smoke coverage now exist.
   - Final release confidence still benefits from one full install/uninstall cycle per packaged platform.

## Recommended Next Actions

1. When disk budget allows, clean or relocate the default Tauri Rust target directories and rerun a full desktop Rust verification sweep:
   - `cargo check --manifest-path packages/sdkwork-agentstudio-pc-desktop/src-tauri/Cargo.toml`
   - `cargo test --manifest-path packages/sdkwork-agentstudio-pc-desktop/src-tauri/Cargo.toml`
   - `cargo test --manifest-path packages/sdkwork-agentstudio-pc-server/src-host/Cargo.toml`

2. Run packaged installer smoke in disposable real environments:
   - Windows NSIS install/uninstall
   - Linux `deb`
   - Linux `rpm`
   - macOS `.dmg` app copy and first launch

3. Decide whether Windows CLI registration should remain best-effort or be promoted to installer-fatal after one more round of real install validation.

4. If build time becomes a release concern, profile the remaining generic `rolldown:vite-resolve` and Tailwind generation hotspots before introducing new resolver complexity.

## Outcome

The bundled OpenClaw integration is now materially closer to the intended release contract:

- OpenClaw is pinned to the shared latest bundled version `2026.4.2`
- installer-time preparation is the authoritative extraction path
- startup no longer needs to be the recovery path for normal installs
- installer prewarm no longer treats malformed materialized runtime payloads as success
- desktop `--phase all` release orchestration now preserves the same profile, Vite mode, bundle, and target contract as the granular phase pipeline
- business services that were still drifting from the generated app SDK have been pulled back onto the current shared contract
- parity verification no longer depends on fragile `tsx` child-process startup on Windows
- desktop hosted control-plane bootstrapping now follows a canonical runtime descriptor
- desktop combined mode now aligns more closely with the canonical host contract
- shared browser host metadata now refreshes deployment family, accelerator profile, base paths, and browser session token from the live runtime even when the bundled frontend already contains placeholder meta tags
- hosted browser bridges now resolve browser session token and host metadata live for each request instead of freezing the bootstrap snapshot
- full workspace `pnpm.cmd build` and `pnpm.cmd lint` now pass after the shared SDK preparation hardening
- desktop partial manifests, smoke reports, and the final aggregated release manifest now persist the cross-platform OpenClaw installer contract plus desktop smoke evidence, including whether the packaged runtime was proven `staged-layout` or `simulated-prewarm` install-ready for startup reuse, and that install-ready proof is now required rather than optional at smoke/finalize time
- the GitHub desktop release workflow, release closure guard, and release documentation now all treat packaged desktop installer smoke plus install-ready OpenClaw evidence as mandatory release contract surface instead of an implementation detail
- shell optional chat warmers and the centered workspace switcher now stay behind real lazy boundaries instead of leaking back into the entry bundle
- the studio bridge now stays behind a real infrastructure lazy boundary, with `claw-platform-web-studio` emitted as its own chunk instead of inflating the default infrastructure runtime
- web and desktop hosts now share the same workspace resolver foundation: deterministic package aliases for normal builds, with worktree-only remapping gated to real `.worktrees/...` checkouts or an explicit override
- targeted Rust verification for the touched host/runtime paths has passed with an isolated cargo target directory
