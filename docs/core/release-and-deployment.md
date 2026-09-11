# Release And Deployment

## Overview

Agent Studio now publishes a unified multi-family release instead of a desktop-only artifact set.

The release flow produces:

- `desktop` installers and native application bundles
- `server` native Rust server archives with embedded web assets
- `container` deployment bundles for Docker-oriented environments
- `kubernetes` deployment bundles with Helm-compatible chart assets
- `web` static web/docs archives

This keeps one tag and one workflow while still giving desktop users, server operators, and platform teams the release shape they actually need.

## Local Verification And Packaging

When a change touches cross-mode runtime authority or delivery behavior and you
need one decisive gate instead of a manual checklist, run the unified multi-mode
verification command from the workspace root:

```bash
pnpm check:multi-mode
```

`pnpm check:multi-mode` chains the current desktop runtime contract, native
server contract, unified host-runtime authority smoke contract, bundled
OpenClaw readiness checks, and release-flow packaging contracts. Treat it as
the highest-signal local gate for "desktop + server + docker/kubernetes release
surfaces still close correctly together".

Before changing desktop embedded-host bootstrap, desktop hosted browser
authority, or packaged startup behavior, verify the current desktop runtime
contract from the workspace root:

```bash
pnpm check:desktop
```

`pnpm check:desktop` now enforces both the renderer-side desktop hosted-runtime
regression suite and focused Rust embedded-host bootstrap regressions for the
structured browser bootstrap descriptor plus canonical hosted route families.

Before attempting to upgrade the bundled desktop OpenClaw runtime to a newer
upstream tag, verify upgrade readiness from the workspace root:

```bash
pnpm check:desktop-openclaw-runtime
pnpm exec node scripts/openclaw-upgrade-readiness.mjs <target-version>
```

Interpret the readiness output before touching `config/kernel-releases/openclaw.json` or
the packaged OpenClaw manifest files:

- `versionSourcesAligned: true` means the configured release source, packaged
  manifest, generated manifest, and prepared runtime all agree on the same
  OpenClaw version baseline.
- `readyToUpgrade: true` means the local checkout, local tag, and local offline
  asset inputs are present for a real upgrade attempt.
- `readyToUpgrade: false` means do not change packaged OpenClaw runtime version sources
  yet.
- `versionSourcesAligned: true` and `readyToUpgrade: false` can both be correct
  at the same time. That state means the current packaged baseline is internally
  consistent, but the workspace is not prepared for a future retargeting step
  yet.
- If `localUpstreamDirtyCheck` is `unavailable` in the Node diagnostic, run
  `git -C .cache/bundled-components/upstreams/openclaw status --short`
  separately before refreshing the upstream checkout.

Before changing native server behavior, deployment bundles, or release metadata, verify the current server runtime contract from the workspace root:

```bash
pnpm check:server
```

Before finalizing a release that changes desktop/server/container/kubernetes runtime authority, readiness, built-in OpenClaw ownership, or hosted/browser bridge behavior, re-run the unified host runtime smoke contract:

```bash
pnpm check:sdkwork-host-runtime
```

The persisted unified host runtime smoke report lives at `docs/reports/2026-04-05-unified-rust-host-runtime-hardening-smoke.md`. Treat that report as release evidence, not as optional notes. It records the automated verification batch and the remaining manual runtime checklist for desktop packaged startup, hosted parity, docker, and singleton-kubernetes flows.

The persisted deployment bootstrap smoke report lives at `docs/reports/2026-04-05-unified-rust-host-deployment-bootstrap-smoke.md`. Treat that deployment bootstrap smoke report as release evidence as well. It records the automated verification batch plus the required packaged container image startup, docker compose startup, and singleton-k8s readiness commands that still need live execution outside this sandbox.

Before changing GitHub workflows, release packaging scripts, or asset finalization behavior, validate the release automation contracts:

```bash
pnpm check:automation
```

Before pushing a release tag after shared SDK changes, compare the configured
GitHub release sources against the local source-of-truth package roots:

```bash
pnpm check:shared-sdk-release-parity
```

This check clones the pinned refs from `config/shared-sdk-release-sources.json`
and compares them with the local sibling SDK package roots that development
still uses through relative workspace paths, including `retired generic app SDK package`,
`@sdkwork/sdk-common`, `@sdkwork/core-pc-react`,
`@sdkwork/im-sdk`, and `@sdkwork/rtc-sdk`. The comparison normalizes text-file
line endings so Windows `CRLF` checkouts and GitHub `LF` checkouts do not raise
false drift. Shared SDK package scripts must resolve `vite`, `tsc`, and other
build tools from package-local workspace metadata rather than hard-coded
cross-repository `../../../node_modules/*` paths; otherwise clean-room release
workspaces can pass parity and still fail during `Verify release inputs`. If
this check fails, do not push a release tag yet.

Before collecting artifacts, inspect the current multi-family release matrices:

```bash
pnpm release:plan
```

The plan JSON is also the machine-readable target-count authority for release automation. It emits `familyTargetCounts` and `requiredTargetCount` alongside the Web, desktop, server, container, and kubernetes matrices; CI forwards the same data as `family_target_counts` and `required_target_count` prepare-job outputs, and the readiness fixture refuses plans that omit `requiredTargetCount`.

Before finalization, inspect the current local release asset directory without turning the check into a publish gate:

```bash
pnpm release:status
```

`pnpm release:status` reads the active `artifacts/release` directory, accepts a missing directory as an empty local aggregation, and emits JSON with top-level `status`, `issueCount`, `blockingIssueCount`, `hasIssues`, `hasBlockingIssues`, `issueCountsBySeverity`, `issueCountsByCode`, `releaseCoverage`, `requiredTargetCount`, `familyTargetCounts`, `presentTargetCount`, `missingTargetCount`, partial manifest counts, artifact counts, profile/path/duplicate-target issues, target-specific `nextCommands`, and prioritized `nextActions`. Each issue includes `severity`, `blocking`, and `recommendedAction` so CI dashboards and local release operators can classify the failure without parsing prose. `nextActions` turns that raw diagnostic state into a stable action queue: `fix-issue` entries aggregate issue codes and carry the issue `recommendedAction`, `package-target` entries derive from `nextCommands`, and numeric `priority` puts blocking remediation before missing-target packaging. The top-level `status` is the diagnostic conclusion for automation: `complete` means full coverage with no structural issues, `partial` means coverage is incomplete and no structural issues were found, and `invalid` means one or more issues exist even when nested `releaseCoverage.status` is `complete`. Use it after one or more `release:package:*` jobs to decide which exact family/target command to run next. It deliberately does not replace `release:assert-ready`: `release:status` is a diagnostic for partial local work, while `release:finalize` and `release:assert-ready` remain the strict fail-closed publish gates.

Local family packagers remain available when you need to validate one slice without waiting for the full GitHub workflow:

```bash
pnpm release:package:desktop
pnpm release:package:server
pnpm release:package:container
pnpm release:package:kubernetes
pnpm release:package:web
pnpm release:smoke:desktop
pnpm release:smoke:desktop-packaged-launch -- --platform <platform> --arch <arch> --target <target>
pnpm release:smoke:desktop-startup -- --platform <platform> --arch <arch> --startup-evidence-path <path-to-desktop-startup-evidence.json>
pnpm release:smoke:server
pnpm release:smoke:container
pnpm release:smoke:kubernetes
```

These commands collect family-specific assets into `artifacts/release` so they can be reviewed locally or aggregated for final release processing.

When you need to switch desktop kernel packaging without editing scripts, pass an explicit package profile through the local wrapper:

```bash
pnpm release:package:desktop -- --package-profile dual-kernel
pnpm release:smoke:desktop -- --package-profile hermes-only
```

The same local wrapper also accepts `SDKWORK_RELEASE_PACKAGE_PROFILE` so repeated local verification can stay pinned to `openclaw-only`, `hermes-only`, or `dual-kernel` without rewriting each command line.

Local prerequisite notes:

- `pnpm release:package:desktop` only collects installers and app bundles that already exist; run `pnpm release:desktop` or `pnpm build:desktop` first.
- `pnpm release:package:desktop` now also runs the same desktop installer smoke contract used by release finalization, so each packaged desktop target persists an `installer-smoke-report.json` beside its `release-asset-manifest.json`.
- Desktop installer smoke also treats the packaged OpenClaw `runtime.zip` and macOS `.app.zip`/`.app.tar.gz` companion archive as release-security boundaries. Before first-launch extraction simulation or installer smoke reporting, it rejects archive-internal absolute paths, `..` traversal, non-canonical relative paths, duplicate normalized paths, encrypted ZIP entries, symlinks, hardlinks, devices, pipes, and other non-regular archive entries.
- `pnpm release:smoke:desktop` now re-runs the packaged desktop installer smoke and then closes the launched-session check for the same target. When `--startup-evidence-path` is omitted it launches the canonical packaged desktop artifact for that platform, waits until `desktop-startup-evidence.json` reaches `status=passed` and `phase=shell-mounted`, requires the captured evidence to preserve a running `localAiProxyRuntime`, and then writes `desktop-startup-smoke-report.json`. When `--startup-evidence-path` is provided it imports that external evidence instead of launching the package. The smoke writer rejects unsafe or non-canonical `artifactRelativePaths` and `capturedEvidenceRelativePath` values before writing the report.
- `pnpm release:smoke:desktop-packaged-launch` launches the canonical packaged desktop artifact for the requested target, captures isolated packaged-session startup evidence, and forwards that evidence into the canonical startup smoke report writer. On Linux it automatically falls back to `xvfb-run` when no desktop display is available.
- `pnpm release:smoke:desktop-startup` validates only the captured launched-session startup evidence and copies that evidence into the canonical release asset path when you provide `--startup-evidence-path`. The resulting smoke report must preserve `localAiProxyRuntime.lifecycle`, `messageCaptureEnabled`, `observabilityDbPath`, `snapshotPath`, and `logPath`.
- `pnpm release:package:server` now refreshes the matching native server release binary before packaging when you invoke the root local wrapper. The build remains incremental, but packaging no longer depends on whatever prior target output happens to exist.
- `pnpm release:package:server` now also runs packaged bundle-runtime smoke and persists a `release-smoke-report.json` beside the server `release-asset-manifest.json`.
- `pnpm release:package:container` packages Docker deployment assets around a Linux server binary. The root local wrapper refreshes that target binary first through an incremental build. On Windows, `pnpm build:server -- --target x86_64-unknown-linux-gnu` bridges into an installed WSL distro automatically. On macOS and other non-Linux hosts, the same fallback still depends on a working Linux target toolchain.
- `pnpm release:package:kubernetes` packages chart assets and release values, so it does not require a locally built server binary.
- `pnpm release:package:web` rebuilds the production web host, enforces the web performance budget, rebuilds the docs site, verifies both canonical dist directories before archiving, and then smokes the real packaged web archive. The web smoke writes `web/release-smoke-report.json` and verifies `web/dist/index.html`, built browser assets, `docs/dist/index.html`, `docs/dist/404.html`, `docs/dist/search-index.json`, checksums, and the public docs boundary. It also rejects archive-internal absolute paths, `..` traversal, non-canonical relative paths, duplicate normalized paths, symlinks, hardlinks, devices, pipes, and other non-regular archive entries while reading the packaged Web/docs `.tar.gz`. Local web packaging must never reuse whatever stale `dist/` output happened to be on disk.
- `pnpm release:smoke:web` re-runs the packaged web archive smoke stage for an existing Web/docs artifact set without rebuilding it.
- `pnpm release:smoke:server` re-runs only the packaged server bundle smoke stage when you want fresh runtime evidence for an existing server artifact set without rebuilding it. The shared release smoke writer rejects unsafe or non-canonical `artifactRelativePaths` and `launcherRelativePath` values before writing `release-smoke-report.json`. Before invoking PowerShell `Expand-Archive`, `unzip`, or `tar`, server smoke also pre-validates every `.tar.gz`/`.zip` archive entry and rejects absolute paths, `..` traversal, non-canonical relative paths, duplicate normalized paths, symlinks, hardlinks, devices, pipes, and other non-regular archive entries.
- `pnpm release:smoke:container` now extracts the packaged deployment bundle only after the same archive-entry preflight rejects unsafe paths, duplicate normalized paths, symlinks, hardlinks, devices, pipes, and other non-regular entries. It verifies that the packaged runtime profile keeps `CLAW_SERVER_ALLOW_INSECURE_PUBLIC_BIND=false` and `CLAW_SERVER_DATA_DIR=/var/lib/agentstudio-server`, verifies that the packaged Docker Compose layout requires explicit manage credentials and persists `/var/lib/agentstudio-server`, runs Docker Compose against that packaged layout, requires Docker to report the packaged services healthy, and then verifies `/claw/health/ready`, `/claw/manage/v1/host-endpoints`, and the bundled browser shell before persisting `release-smoke-report.json`. When Docker and/or Docker Compose are unavailable on the current host, it emits machine-readable skipped evidence instead of hanging or silently succeeding.
- `pnpm release:smoke:kubernetes` now extracts the packaged chart bundle only after the same archive-entry preflight rejects unsafe paths, duplicate normalized paths, symlinks, hardlinks, devices, pipes, and other non-regular entries. It renders the packaged chart with `helm template`, requires immutable image metadata from `release-metadata.json`, verifies the rendered readiness, Secret-backed credential wiring, and `/var/lib/agentstudio-server` PersistentVolumeClaim contract, and uses `kubectl apply --dry-run=client` when `kubectl` is available. When Helm is unavailable, it still emits machine-readable skipped evidence instead of silently succeeding.

The local wrapper defaults `release:plan`, `release:package:*`, `release:finalize`, and `release:assert-ready` to `artifacts/release`. CI still aggregates assets under `release-assets/`. Before finalization, CI renders `release-assets/release-notes.md`; local release simulations must render the same file before calling `pnpm release:finalize`. `pnpm release:finalize` is strict by default: it rejects a final manifest unless every target in the release profile is present, rejects partial manifests for a different release profile, rejects unsafe or non-canonical artifact paths before they can enter the final inventory, rejects unsafe or non-canonical server and deployment smoke `launcherRelativePath` values before they can enter release metadata, rejects unsafe or non-canonical desktop startup captured evidence paths before reading launch evidence, rejects artifacts outside the active release profile, rejects multiple artifacts for the same release target, requires `release-notes.md`, records it under top-level `releaseMetadata`, and writes the resulting `releaseCoverage` summary into `release-manifest.json`. Smoke generation itself is also fail-closed: `release-smoke-report.json` and `desktop-startup-smoke-report.json` reject unsafe or non-canonical artifact, launcher, and captured evidence paths before writing report metadata, desktop OpenClaw runtime and macOS companion archive smoke reject unsafe archive-internal entries before install-root simulation or installer smoke reporting, web/server/deployment smoke reject unsafe archive-internal entries before reading or extracting packaged archives, and finalization revalidates those same paths through the shared smoke path contract. `pnpm release:finalize` also cryptographically binds every lifted smoke evidence file into the final manifest with `reportSha256`/`reportSize`, `manifestSha256`/`manifestSize`, and, for desktop startup smoke, `capturedEvidenceSha256`/`capturedEvidenceSize`; after writing the manifest it emits `release-manifest.json.sha256.txt` as a detached checksum for the top-level manifest itself. `pnpm release:assert-ready` is the final publish gate: it verifies `release-manifest.json.sha256.txt` against `release-manifest.json` before parsing the finalized manifest, re-reads `release-manifest.json` and `SHA256SUMS.txt`, independently rejects partial coverage, rejects manifests created with `--allow-partial-release`, rejects artifacts outside the active release profile, rejects multiple artifacts for the same release target, independently revalidates every finalized `.tar.gz` and `.zip` artifact, including macOS `.app.zip` and `.app.tar.gz` desktop app companion archives, so unsafe paths, duplicate normalized paths, symlinks, hardlinks, devices, pipes, and other non-regular archive entries cannot be published even if an archive changes after smoke, verifies every listed artifact and release metadata checksum and size, requires `release-notes.md` to remain listed in `releaseMetadata`, `SHA256SUMS.txt`, and `release-attestations.json`, and rejects finalized manifests whose family-specific smoke metadata is missing, malformed, points at missing evidence files, has mismatched evidence sha256/size bindings, or no longer matches the referenced smoke report contents. Each smoke metadata `reportRelativePath` and `manifestRelativePath`, plus desktop startup `capturedEvidenceRelativePath`, must still resolve to ordinary files inside the active release asset directory and must still match the recorded sha256/size binding. The readiness gate re-reads smoke reports and rejects drift in status, smoke kind, artifact references, required checks, launcher or captured-evidence paths, and desktop installer plan summaries. Desktop artifacts must carry both `desktopInstallerSmoke` and `desktopStartupSmoke`; Web artifacts must carry `webArchiveSmoke`; server artifacts must carry `serverBundleSmoke`; container and kubernetes artifacts must carry `deploymentSmoke`. Use `pnpm release:finalize:partial` or pass `--allow-partial-release` only for explicit local/debug aggregation of an incomplete artifact directory; partial manifests remain machine-identifiable through `releaseCoverage.status=partial` and `releaseCoverage.allowPartialRelease=true`.

Override the local defaults with environment variables such as:

- `SDKWORK_RELEASE_TAG`
- `SDKWORK_RELEASE_PACKAGE_PROFILE`
- `SDKWORK_RELEASE_OUTPUT_DIR`
- `SDKWORK_RELEASE_ASSETS_DIR`
- `SDKWORK_RELEASE_TARGET`
- `SDKWORK_RELEASE_PLATFORM`
- `SDKWORK_RELEASE_ARCH`
- `SDKWORK_RELEASE_ACCELERATOR`
- `SDKWORK_RELEASE_IMAGE_REPOSITORY`
- `SDKWORK_RELEASE_IMAGE_TAG`
- `SDKWORK_RELEASE_IMAGE_DIGEST`
- `SDKWORK_RELEASE_REPOSITORY`

When `SDKWORK_RELEASE_REPOSITORY` is unset, the local wrapper falls back to `GITHUB_REPOSITORY` and then to the local `git remote origin` so `release-manifest.json.repository` remains populated during local finalization.

Finalized release asset directories are closed inventories. The publish workflow uploads `release-assets/**/*`, so `pnpm release:assert-ready` now recursively scans the active release asset directory and rejects any file that is not declared by `release-manifest.json` as a product artifact, a `releaseMetadata` subject, a top-level control file (`release-manifest.json`, `release-manifest.json.sha256.txt`, `SHA256SUMS.txt`, or `release-attestations.json` when attestations are enabled), or a smoke evidence file with manifest-bound sha256/size metadata. The same scan rejects symlinks, junctions, devices, pipes, and any other non-regular filesystem entry under the release asset directory, so every publishable entry is either a directory used for layout or an ordinary file covered by the finalized manifest. `pnpm release:finalize` also removes per-artifact packaging checksum sidecars such as `<artifact>.sha256.txt` after writing the authoritative `SHA256SUMS.txt`, so duplicate or stale sidecars cannot be uploaded as undeclared release assets.

## Release Notes Source

GitHub release notes are now repository-owned artifacts instead of auto-generated
platform summaries.

- Release metadata lives in `docs/release/releases.json`
- Per-tag release note documents live under `docs/release/`
- The reusable GitHub release workflow renders notes with `node scripts/release/render-release-notes.mjs --release-tag <tag> --output release-assets/release-notes.md` before finalization

When a release attempt fails before GitHub publishes the release, carry the
unpublished change log forward by referencing the earlier failed tags in the
next successful release entry.

`release-notes.md` is a finalized public release metadata subject. It is not counted as a product artifact and does not participate in release-profile target coverage, but strict finalization requires it, records it as `releaseMetadata` with `kind=release-notes`, `purpose=github-release-body`, `relativePath`, `sha256`, `size`, and `required=true`, includes it in `SHA256SUMS.txt`, includes it in `release-attestations.json`, and requires `release:assert-ready` to verify its checksum, size, provenance binding, and file presence before publishing.

## Release Metadata Contract

Each unified release produces three top-level inventory files under the active release asset directory, which is `artifacts/release` for the local wrapper and `release-assets/` inside GitHub workflows:

- `release-manifest.json`
- `release-manifest.json.sha256.txt`
- `SHA256SUMS.txt`
- `release-attestations.json`

`release-manifest.json.sha256.txt` is the detached checksum for `release-manifest.json`. It contains exactly one `sha256  release-manifest.json` entry and is verified by `release:assert-ready` before the manifest is parsed, so a tampered but still parseable inventory cannot become the source of truth for the rest of the publish gate.

`release-attestations.json` is the offline provenance evidence file for finalized publishable subjects. CI writes it after `actions/attest-build-provenance@v3` attests the finalized `release-assets/**/*` set and after `scripts/release/write-attestation-evidence.mjs` runs `gh attestation verify` for every manifest artifact and every `releaseMetadata` entry, including `release-notes.md`, against the release repository, `refs/tags/<releaseTag>`, the SLSA provenance predicate, and the reusable release workflow through `--signer-workflow <owner/repo/.github/workflows/release-reusable.yml>`. `release:assert-ready` then requires every artifact and release metadata subject to have a verified evidence entry whose `relativePath`, `sha256`, `repository`, `releaseTag`, `sourceRef`, `predicateType`, `signerWorkflow`, and `signerWorkflowIdentity` still match `release-manifest.json`.

`SHA256SUMS.txt` is the portable checksum surface.

`release-manifest.json` is also the file-level allowlist for publication. A file can remain under the active release asset directory only when the manifest declares it directly as an artifact or release metadata subject, or indirectly as hash-bound smoke evidence. The directory may contain ordinary directories for layout, but not symlinks, junctions, device nodes, named pipes, or other non-regular entries. This keeps `release-assets/**/*` from uploading debug logs, stale package outputs, stale per-artifact checksum sidecars, symlink escape surfaces, or any other entry that was not part of the finalized release evidence model.

`release-manifest.json` is the machine-readable inventory surface for download portals, deployment automation, and release verification. Its top-level metadata includes `profileId`, `productName`, `releaseTag`, `generatedAt`, `checksumFileName`, `repository`, and `releaseCoverage`. The `repository` value resolves from `SDKWORK_RELEASE_REPOSITORY`, then `GITHUB_REPOSITORY`, then the local `git remote origin` when you use the local wrapper without release-specific environment variables.

`releaseCoverage` is the release completeness contract. It includes:

- `status`: `complete` only when every required profile target is represented; otherwise `partial`
- `allowPartialRelease`: `true` only when finalization was explicitly invoked with `--allow-partial-release`
- `requiredTargets`: every required profile target such as `web/web/any`, `desktop/windows/x64/nsis`, `server/linux/x64`, `container/linux/x64/cpu`, or `kubernetes/linux/x64/nvidia-cuda`
- `presentTargets`: the required targets satisfied by the aggregated artifacts
- `missingTargets`: the required targets still absent from the aggregation directory

Each artifact entry carries:

- `family`: one of `desktop`, `web`, `server`, `container`, or `kubernetes`
- `platform`: target platform such as `windows`, `linux`, `macos`, or `web`
- `arch`: target architecture such as `x64`, `arm64`, or `any`
- `accelerator`: deployment-layer accelerator profile when applicable, currently `cpu`, `nvidia-cuda`, or `amd-rocm`
- `kind`: artifact classification such as `installer`, `package`, or `archive`
- `relativePath`: stable path inside the release asset directory
- `sha256`: final artifact checksum
- `size`: final artifact size in bytes

Desktop artifacts carry additional machine-readable metadata because install-time kernel preparation is a release contract whenever a packaged kernel requires it. The current first-party installer contract is OpenClaw:

- `kernelInstallContracts`: normalized per-kernel install contracts stamped from current source-of-truth installers and persisted from packaging through finalization. Current desktop artifacts use `kernelInstallContracts.openclaw` when the package profile includes OpenClaw.
- `desktopInstallerSmoke`: the aggregated desktop installer smoke summary lifted from `installer-smoke-report.json`
- `desktopInstallerSmoke.reportSha256` / `desktopInstallerSmoke.reportSize` and `desktopInstallerSmoke.manifestSha256` / `desktopInstallerSmoke.manifestSize`: final-manifest bindings for the referenced smoke report and partial manifest evidence files. `release:assert-ready` recomputes each sha256/size pair before publishing.
- `desktopInstallerSmoke.kernelInstallReadiness`: normalized per-kernel install-readiness evidence lifted from `installer-smoke-report.json`
- `desktopInstallerSmoke.kernelInstallReadiness.<kernelId>.externalRuntimePolicy`: normalized per-kernel external runtime policy evidence showing that packaged kernels still depend on external language runtimes instead of bundled Node.js, Python, or `uv`
- `desktopInstallerSmoke.kernelInstallReadiness.openclaw.installReadyLayout`: normalized first-launch readiness proof showing how the packaged installer leaves the included OpenClaw payload ready for startup reuse when `kernelInstallContracts.openclaw` is present
- `desktopStartupSmoke`: the aggregated launched-session desktop runtime smoke summary lifted from `desktop-startup-smoke-report.json` when that evidence has been captured for the artifact
- `desktopStartupSmoke.capturedEvidenceRelativePath`: the preserved path of the captured `diagnostics/desktop-startup-evidence.json` launch record. It must be a canonical relative path inside the release asset directory; absolute paths, `..` traversal, drive-qualified paths, and non-canonical forms are rejected before the smoke report is written and revalidated before the finalizer reads evidence.
- `desktopStartupSmoke.reportSha256` / `desktopStartupSmoke.reportSize`, `desktopStartupSmoke.manifestSha256` / `desktopStartupSmoke.manifestSize`, and `desktopStartupSmoke.capturedEvidenceSha256` / `desktopStartupSmoke.capturedEvidenceSize`: final-manifest bindings for the smoke report, partial manifest, and captured launch evidence files.
- `desktopStartupSmoke.packageProfileId`: the packaged kernel profile asserted by launched-session startup smoke and revalidated against the desktop partial manifest during finalization
- `desktopStartupSmoke.includedKernelIds`: the ordered packaged kernel set asserted by launched-session startup smoke and revalidated against the desktop partial manifest during finalization
- `desktopStartupSmoke.defaultEnabledKernelIds`: the default-enabled packaged kernel set asserted by launched-session startup smoke and revalidated against the desktop partial manifest during finalization
- `desktopStartupSmoke.localAiProxyRuntime`: the normalized local AI proxy runtime summary lifted from launched-session startup smoke, including `lifecycle`, `messageCaptureEnabled`, `observabilityDbPath`, `snapshotPath`, and `logPath`

`desktopInstallerSmoke.kernelInstallReadiness.<kernelId>.externalRuntimePolicy` is shared multi-kernel evidence, not an OpenClaw-only extension. Current first-party expectations are:

- `openclaw`: `runtimeRequirements` includes external `nodejs`
- `hermes`: `runtimeRequirements` includes external `python` and `uv`, with optional external `nodejs`

Server artifacts also carry aggregated runtime evidence because a packaged server bundle is not considered releasable until the extracted archive actually boots:

- `serverBundleSmoke`: the aggregated packaged server runtime smoke summary lifted from `release-smoke-report.json`
- `serverBundleSmoke.reportSha256` / `serverBundleSmoke.reportSize` and `serverBundleSmoke.manifestSha256` / `serverBundleSmoke.manifestSize`: final-manifest bindings for the referenced server smoke report and partial manifest evidence files.
- `serverBundleSmoke.launcherRelativePath`: the packaged server launcher path. It must be a canonical release-relative path; absolute paths, `..` traversal, drive-qualified paths, and non-canonical forms are rejected before the smoke report is written and revalidated before final release metadata is written.
- `serverBundleSmoke.checks`: ordered readiness checks proving `/claw/health/ready`, `/claw/manage/v1/host-endpoints`, and the bundled browser shell all respond from the packaged archive

Deployment artifacts also carry aggregated deployment evidence because packaging alone is not sufficient proof that the published bundle can be used safely:

- `deploymentSmoke`: the aggregated deployment smoke summary lifted from `release-smoke-report.json` for `container` and `kubernetes` artifacts
- `deploymentSmoke.reportSha256` / `deploymentSmoke.reportSize` and `deploymentSmoke.manifestSha256` / `deploymentSmoke.manifestSize`: final-manifest bindings for the referenced deployment smoke report and partial manifest evidence files.
- `deploymentSmoke.launcherRelativePath`: the packaged deployment launcher path, such as `deployments/docker/docker-compose.yml` or `chart/Chart.yaml`. When deployment smoke passed, it must be a canonical release-relative path; absolute paths, `..` traversal, drive-qualified paths, and non-canonical forms are rejected before the smoke report is written and revalidated before final release metadata is written.
- `deploymentSmoke.checks`: ordered deployment checks proving packaged container runtime-profile, Docker Compose credential and persistence contracts, Compose startup, container health, and runtime readiness for `container`, plus rendered chart image-reference, readiness, Secret wiring, and persistent-storage validation for `kubernetes`

Deployment smoke is allowed to be either `passed` or structurally `skipped`. A skipped deployment report is valid only when it preserves a non-empty `skippedReason`, and it may also persist discovered host `capabilities` such as Docker, Docker Compose, Helm, or `kubectl`. Release finalization lifts that skipped state verbatim into `release-manifest.json` rather than flattening it into a false pass.

The persisted `desktopInstallerSmoke.kernelInstallReadiness.openclaw.installReadyLayout` object is intentionally stronger than `{ mode, installKey }`. It must prove all of the following:

- `reuseOnFirstLaunch` is `true`
- `requiresArchiveExtractionOnFirstLaunch` is `false`
- `manifestRelativePath` is `manifest.json`
- `runtimeSidecarRelativePath` is `runtime/.sdkwork-openclaw-runtime.json`
- `cliEntryRelativePath` matches the packaged manifest's OpenClaw CLI entrypoint

Release verification treats any field loss or drift in that object as a release-breaking regression, because it would weaken the audit trail for "prepare during install, reuse on first launch".

The `installReadyLayout.mode` contract is platform-specific and is treated as release-breaking when it drifts:

- Windows and Linux desktop installers must produce `archive-extract-ready`
- macOS desktop installers must produce `staged-layout`

The desktop install contract also anchors installer-time OpenClaw preparation to a platform-specific canonical install root:

- Windows NSIS hooks invoke the embedded OpenClaw prepare and CLI registration actions with `--install-root "$INSTDIR"`
- Linux postinstall resolves the packaged install root from the packaged OpenClaw manifest and forwards it as `--install-root "$install_root"`
- macOS projects a preexpanded managed runtime layout into the app bundle instead of relying on a postinstall extraction hook

Family-specific packagers emit partial manifests first. The finalization step then merges them, recomputes final checksums, and also infers the same `family`, `platform`, `arch`, and `accelerator` metadata from fallback asset paths when a partial family manifest is missing. That keeps `server`, `container`, and `kubernetes` assets machine-readable even under degraded packaging conditions.

## GitHub Workflow

The release entrypoint is `.github/workflows/release.yml`, which delegates to `.github/workflows/release-reusable.yml`.

For a `release-*` tag or a manual dispatch, the reusable workflow now builds:

- desktop assets for Windows, Linux, and macOS
- server assets for Windows, Linux, and macOS
- container bundles for Linux `x64` and `arm64`
- architecture-scoped OCI server images published to `ghcr.io/<owner>/agent-studio-server`
- kubernetes bundles for Linux `x64` and `arm64`
- CPU, NVIDIA CUDA, and AMD ROCm-oriented deployment variants where that difference lives at the deployment layer
- a final `release-manifest.json` plus `SHA256SUMS.txt`

## Artifact Families

### Desktop

Desktop remains the existing Tauri-first path:

- Windows: `nsis`
- Linux: `deb`, `rpm`
- macOS: `.app` archive plus `.dmg`

### Server

Server archives are native per-platform bundles. Each archive contains:

- the canonical Rust server binary under `bin/`
- the built browser app under `web/dist`
- `.env.example`
- optional launcher wrappers

The packaged native binary is the canonical bundled launcher. When the expected bundle layout is present, it auto-resolves `CLAW_SERVER_WEB_DIST` to the extracted `web/dist` directory and `CLAW_SERVER_DATA_DIR` to `.agentstudio-server` inside the bundle. `start-agentstudio-server.sh` and `start-agentstudio-server.cmd` remain optional convenience wrappers around that same binary.

Each packaged server target now also persists `release-smoke-report.json` next to its partial manifest. Release finalization rejects the server artifact if that report is missing, stale, or no longer matches the current archive set.

### Container

Container bundles package:

- the prepared server runtime under `app/`
- Docker build files
- Docker Compose files
- CPU and GPU-oriented env overlays

The packaged Dockerfile launches `app/bin/agentstudio-server` directly so container startup stays aligned
with the canonical bundled server entrypoint instead of routing through the optional shell wrapper.

The source repository keeps the container templates under `deployments/docker/` for review and
packaging input:

- `deployments/docker/docker-compose.yml`
- `deployments/docker/docker-compose.nvidia-cuda.yml`
- `deployments/docker/docker-compose.amd-rocm.yml`
- `deployments/docker/Dockerfile`
- `deployments/docker/profiles/*`

Those source tree paths are not the final runnable release layout. Render the packaged layout
locally with `pnpm release:package:container`, then run Docker Compose from the extracted bundle
root.

Inside the extracted bundle root, the same deployment surface becomes:

- `deployments/docker/docker-compose.yml`
- `deployments/docker/docker-compose.nvidia-cuda.yml`
- `deployments/docker/docker-compose.amd-rocm.yml`
- `deployments/docker/Dockerfile`
- `deployments/docker/profiles/*`

Inside that extracted bundle, `deployments/docker/docker-compose.yml` resolves env overlays from
`deployments/docker/profiles/*` and treats the extracted bundle root as the Docker build context.

Base deployment from the extracted bundle root:

> Channel note: agentstudio's container path is this extracted-bundle direct
> compose flow (GPU overlays, Kubernetes chart) — it is **not** the standard
> `bin/` five-environment deploy channel (`MODULE_BIN_SPEC.md`,
> `OPERATIONS_SPEC.md`). The `bin/` contract and the operational runbooks live
> under `docs/runbooks/`; this section stays authoritative for the GPU/K8s
> surfaces until they are wired into `bin/lib/module.sh`.

```bash
export CLAW_SERVER_MANAGE_USERNAME=claw-admin
export CLAW_SERVER_MANAGE_PASSWORD='replace-with-a-strong-secret'
docker compose -f deployments/docker/docker-compose.yml up -d
```

NVIDIA CUDA overlay:

```bash
docker compose -f deployments/docker/docker-compose.yml -f deployments/docker/docker-compose.nvidia-cuda.yml up -d
```

AMD ROCm overlay:

```bash
docker compose -f deployments/docker/docker-compose.yml -f deployments/docker/docker-compose.amd-rocm.yml up -d
```

The base compose file now requires an explicit manage credential pair before it will start the
public control plane, and the default env overlay keeps
`CLAW_SERVER_ALLOW_INSECURE_PUBLIC_BIND=false`.

Each packaged container target now also persists `release-smoke-report.json` next to its partial
manifest. Release finalization rejects the container artifact if Docker Compose smoke is missing,
stale, or no longer matches the current packaged bundle.

### Kubernetes

Kubernetes bundles package:

- a Helm-compatible chart under `chart/`
- base `values.yaml`
- accelerator-specific values files
- generated `values.release.yaml`

Typical deployment:

```bash
helm upgrade --install agent-studio ./chart -f values.release.yaml --set auth.manageUsername=claw-admin --set auth.managePassword='replace-with-a-strong-secret'
```

GitHub release automation publishes one OCI image per Linux architecture and then stamps each
Kubernetes bundle with that immutable image reference. `values.release.yaml` pins `image.tag` to
an architecture-qualified release tag such as `release-2026-04-04-01-linux-x64`, and the release
workflow also writes `image.digest` so production clusters can pull by digest without depending on
mutable tags. Override `image.repository` only when you mirror the published image into another
registry, and keep `image.digest` aligned with the mirrored artifact.

The chart also generates or references a Secret-backed control-plane credential set and mounts a
PersistentVolumeClaim at `/var/lib/agentstudio-server` so the SQLite host-state baseline survives Pod
restarts.

Each packaged kubernetes target now also persists `release-smoke-report.json` next to its partial
manifest. Release finalization rejects the kubernetes artifact if packaged chart rendering smoke is
missing, stale, or no longer matches the current bundle.

## Finalization Step

The packaging flow is intentionally split into:

1. family-specific package collection
2. desktop installer smoke verification for packaged desktop targets
3. launched-session desktop startup smoke verification from a real packaged desktop run for every desktop target
4. packaged server and deployment smoke verification for server/container/kubernetes targets
5. global release finalization

The finalization step emits the final inventory and checksums after all family outputs have been aggregated into one release asset directory. Locally that defaults to `artifacts/release`; in GitHub workflows the same step runs against `release-assets/`:

```bash
pnpm release:finalize
pnpm release:assert-ready
```

The default finalizer is a commercial release gate, not a best-effort aggregator. It requires full release profile coverage for Web, every desktop bundle target, every native server target, every container accelerator target, and every kubernetes accelerator target. During finalization every partial manifest must match the active release profile, every partial artifact path must be a canonical relative path inside the release asset directory, every generated artifact must satisfy at least one active profile target, and no active profile target may be satisfied by more than one artifact. `pnpm release:finalize` writes `release-manifest.json.sha256.txt` immediately after the top-level manifest so the manifest has a detached sha256 binding instead of trying to hash itself. CI then attests the finalized asset set and writes `release-attestations.json`; local publish simulation can run `pnpm release:write-attestation-evidence -- --release-assets-dir <dir> --repository <owner/repo> --release-tag <tag>` after finalization when GitHub attestation access is available. `pnpm release:assert-ready` then independently checks that the finalized inventory is still publishable: `release-manifest.json.sha256.txt` must contain exactly one `sha256  release-manifest.json` entry that still matches the current manifest before parsing, `release-attestations.json` must contain verified `gh attestation verify` evidence for every artifact, including `--signer-workflow` enforcement recorded as `signerWorkflowIdentity`, `releaseCoverage.status` must be `complete`, `releaseCoverage.allowPartialRelease` must be `false`, `missingTargets` must be empty, `presentTargets` must exactly match `requiredTargets`, every `SHA256SUMS.txt` entry must match a manifest artifact, every manifest artifact must exist with the recorded `sha256` and `size`, every manifest artifact must satisfy at least one active profile target, no active profile target may be satisfied by more than one artifact, every finalized `.tar.gz` and `.zip` artifact must still contain only safe regular files or directories with canonical relative paths, and every artifact must retain the required family-specific smoke metadata (`desktopInstallerSmoke`, `desktopStartupSmoke`, `webArchiveSmoke`, `serverBundleSmoke`, or `deploymentSmoke`) with its required status, paths, artifact references, passing checks, still-present evidence files, smoke report contents that still match the lifted final metadata, and evidence sha256/size bindings that still match the referenced files. The same `release:assert-ready` gate also keeps `release-attestations.json` and smoke evidence under one fail-closed contract: it rejects smoke metadata that is missing, malformed, points at missing evidence files, has mismatched evidence sha256/size bindings, or no longer matches the referenced smoke report contents; this includes `reportRelativePath`, `manifestRelativePath`, desktop `capturedEvidenceRelativePath`, `reportSha256`, `manifestSha256`, and `capturedEvidenceSha256`. The readiness gate rejects manifests when the manifest checksum sidecar is missing or drifted, when attestation evidence is missing, malformed, unverified, or bound to a different digest/repository/tag/source ref/predicate/signer workflow identity, when metadata `reportRelativePath`, `manifestRelativePath`, or desktop startup `capturedEvidenceRelativePath` no longer resolves to an ordinary file inside the active release asset directory, when `reportSha256`, `manifestSha256`, or `capturedEvidenceSha256` no longer matches, when a finalized archive artifact contains unsafe internal entries, and when the referenced smoke report no longer matches the manifest metadata. If you need to inspect a subset while developing release automation, run:

`pnpm release:fixture:ready` is the local and CI success-path proof for this final gate. It writes a synthetic finalized release directory under `artifacts/release-readiness-fixture`, covers every target required by the default `agent-studio` profile, cross-checks the fixture target count against the real `release:plan.requiredTargetCount` summary, emits release notes, checksums, detached manifest checksum, attestation evidence, and hash-bound smoke reports, then runs the real `release:assert-ready` implementation against that directory. This command is not a substitute for real package or smoke jobs; it exists so the strict readiness gate has a reproducible full-profile passing fixture in addition to fail-closed checks, and so CI detects release-matrix drift before a publish run.

```bash
pnpm release:finalize:partial
```

That command passes `--allow-partial-release` and still marks the generated manifest as partial through `releaseCoverage`. GitHub release publishing never uses the partial flag.

A failed strict finalization is also fail-closed for filesystem state. Before validation begins, the finalizer removes stale top-level `release-manifest.json`, `release-manifest.json.sha256.txt`, `release-attestations.json`, and `SHA256SUMS.txt`; it writes fresh manifest and checksum files only after every required release evidence and coverage check passes, and CI rewrites attestation evidence only after the freshly finalized asset set has been attested. This prevents a failed local or CI finalization attempt from leaving older, publishable-looking inventory or provenance evidence beside incomplete artifacts.

Finalization now requires `desktop-startup-smoke-report.json` beside every desktop partial manifest. It lifts that launched-session evidence onto the matching desktop artifact as `desktopStartupSmoke` and rejects desktop release assets when the packaged launch report or its captured `diagnostics/desktop-startup-evidence.json` evidence is missing, stale, outside the release asset directory, or no longer matches the current artifact set. The desktop startup smoke writer rejects unsafe or non-canonical artifact and captured evidence paths before writing the smoke report, and the finalizer revalidates `capturedEvidenceRelativePath` through the same shared smoke path contract before reading captured evidence. Server, Web, container, and kubernetes release smoke reports also reject unsafe or non-canonical artifact paths before writing report metadata; server and passed deployment smoke additionally reject unsafe or non-canonical `launcherRelativePath` values before the report exists, then finalization revalidates them before writing final metadata. The finalizer also requires the packaged kernel context in startup smoke (`packageProfileId`, `includedKernelIds`, and `defaultEnabledKernelIds`) to match the desktop partial manifest, requires the `local-ai-proxy-runtime` startup-smoke check to pass, and requires the emitted `desktopStartupSmoke.localAiProxyRuntime` summary to match the captured launch evidence.

For `container` and `kubernetes` artifacts, finalization accepts deployment smoke only when `status=passed` or when `status=skipped` is paired with a non-empty `skippedReason`. If the current host lacks Docker, Docker Compose, or Helm, the final manifest preserves that skipped deployment status and any captured capability snapshot instead of failing the whole release purely because the local machine could not execute that deployment family.

## GPU Variant Model

The Rust server binary itself is CPU-neutral. GPU variants package deployment overlays and release metadata rather than pretending there are different server binaries.

Profiles:

- `cpu`
- `nvidia-cuda`
- `amd-rocm`

## Recommended Use

- choose `desktop` for local GUI-first installs
- choose `server` for native service-style deployments on Windows, Linux, or macOS
- choose `container` for Docker-based server environments
- choose `kubernetes` for cluster deployment and ingress-managed environments
- choose `web` only when you want the browser and docs static bundle
