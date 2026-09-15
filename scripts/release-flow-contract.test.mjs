// WORKSPACE-PATH:allow-fixture: fixtures name a foreign checkout root, drive, or home directory to exercise path handling, so the literal is the value under assertion rather than a binding this build resolves
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, realpathSync, symlinkSync } from 'node:fs';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { pathToFileURL } from 'node:url';

const rootDir = path.resolve(import.meta.dirname, '..');
const desktopBundleOverlayConfig = path.join(
  'src-tauri',
  'generated',
  'tauri.bundle.overlay.json',
);
const desktopLinuxTauriConfig = path.join(
  'src-tauri',
  'tauri.linux.conf.json',
);
const desktopMacosTauriConfig = path.join(
  'src-tauri',
  'tauri.macos.conf.json',
);
const desktopPackageDir = path.join('packages', 'sdkwork-agentstudio-pc-desktop');

function read(relativePath) {
  return readFileSync(path.join(rootDir, relativePath), 'utf8');
}

function createPnpmCliFixture(prefix = 'claw-pnpm-cli-') {
  const tempRoot = mkdtempSync(path.join(os.tmpdir(), prefix));
  const pnpmCliPath = path.join(tempRoot, 'pnpm.cjs');
  writeFileSync(pnpmCliPath, '#!/usr/bin/env node\n', 'utf8');
  return { tempRoot, pnpmCliPath };
}

test('desktop release inputs keep the Windows Tauri installer config under version control', (t) => {
  const trackedFiles = spawnSync(
    'git',
    ['ls-files', 'packages/sdkwork-agentstudio-pc-desktop/src-tauri/tauri.windows.conf.json'],
    {
      cwd: rootDir,
      encoding: 'utf8',
      shell: false,
    },
  );

  if (trackedFiles.error?.code === 'EPERM') {
    t.skip('sandbox blocks git child processes; cannot verify tracked-file status through git');
    return;
  }

  assert.equal(trackedFiles.error, undefined);
  assert.equal(trackedFiles.status, 0);
  assert.match(
    trackedFiles.stdout,
    /packages\/sdkwork-agentstudio-pc-desktop\/src-tauri\/tauri\.windows\.conf\.json/,
    'release verification must not depend on an untracked local tauri.windows.conf.json file',
  );
});

test('repository exposes a cross-platform agent-studio release workflow', () => {
  const workflowPath = path.join(rootDir, '.github', 'workflows', 'release.yml');
  const reusableWorkflowPath = path.join(rootDir, '.github', 'workflows', 'release-reusable.yml');
  assert.equal(existsSync(workflowPath), true, 'missing .github/workflows/release.yml');
  assert.equal(existsSync(reusableWorkflowPath), true, 'missing .github/workflows/release-reusable.yml');

  const workflow = read('.github/workflows/release.yml');
  const reusableWorkflow = read('.github/workflows/release-reusable.yml');
  const rustToolchain = read('rust-toolchain.toml');
  const nodeWrapperPath = path.join(rootDir, 'sdkwork-run-node');
  const pnpmWrapperPath = path.join(rootDir, 'sdkwork-run-pnpm');
  const gitSourcePreparationCount =
    reusableWorkflow.match(/node scripts\/prepare-shared-sdk-git-sources\.mjs/g)?.length ?? 0;
  const sharedSdkPreparationCount =
    reusableWorkflow.match(/pnpm prepare:shared-sdk/g)?.length ?? 0;
  const wrapperPathExposureCount =
    reusableWorkflow.match(/Expose workspace command wrappers/g)?.length ?? 0;

  assert.match(workflow, /workflow_dispatch:/);
  assert.match(workflow, /push:\s*[\s\S]*tags:\s*[\s\S]*release-\*/);
  assert.match(workflow, /package_profile:/);
  assert.match(workflow, /uses:\s*\.\/\.github\/workflows\/release-reusable\.yml/);
  assert.match(
    workflow,
    /secrets:\s*inherit/,
    'release caller workflow must pass repository secrets through to the reusable release workflow',
  );
  assert.match(workflow, /release_profile:\s*agent-studio/);
  assert.match(workflow, /package_profile:\s*\$\{\{ github\.event_name == 'push' && 'openclaw-only' \|\| github\.event\.inputs\.package_profile \}\}/);
  assert.match(
    workflow,
    /permissions:\s*[\s\S]*packages:\s*write/,
    'release caller workflow must grant packages: write to the reusable release workflow',
  );
  assert.match(reusableWorkflow, /workflow_call:/);
  assert.match(
    reusableWorkflow,
    /workflow_call:[\s\S]*secrets:[\s\S]*SDKWORK_SHARED_SDK_GITHUB_TOKEN:[\s\S]*required:\s*false/,
    'reusable release workflow must declare the optional private shared SDK GitHub token secret',
  );
  assert.match(reusableWorkflow, /package_profile:/);
  assert.match(reusableWorkflow, /concurrency:/);
  assert.match(reusableWorkflow, /release-\$\{\{ inputs\.release_profile \}\}-\$\{\{ inputs\.package_profile \}\}-\$\{\{ inputs\.release_tag \}\}/);
  assert.match(reusableWorkflow, /packages:\s*write/);
  assert.match(reusableWorkflow, /SDKWORK_SHARED_SDK_MODE:\s*git/);
  assert.match(
    reusableWorkflow,
    /SDKWORK_PREPARE_OPTIONAL_SHARED_SDKS:\s*'true'/,
    'release clean-room builds must explicitly opt into optional sibling shared SDK package maintenance',
  );
  assert.match(
    rustToolchain,
    /channel\s*=\s*"1\.90\.0"/,
    'release builds must pin Rust to the locally verified toolchain that passes the Windows windows-sys release compile gate instead of floating stable',
  );
  assert.doesNotMatch(
    reusableWorkflow,
    /uses:\s*dtolnay\/rust-toolchain@stable/,
    'release workflow must not float Rust to a future stable compiler that can change release results',
  );
  assert.match(
    reusableWorkflow,
    /uses:\s*dtolnay\/rust-toolchain@1\.90\.0/,
    'release workflow must install the same Rust toolchain pinned by rust-toolchain.toml',
  );
  assert.match(
    reusableWorkflow,
    /SDKWORK_SHARED_SDK_GITHUB_TOKEN:\s*\$\{\{ secrets\.SDKWORK_SHARED_SDK_GITHUB_TOKEN \|\| github\.token \}\}/,
    'release workflow must pass a GitHub token to private shared SDK clones without embedding credentials in repo URLs',
  );
  assert.equal(
    existsSync(nodeWrapperPath),
    true,
    'release Linux and macOS runners need a POSIX sdkwork-run-node wrapper because package scripts invoke sdkwork-run-node without a .cmd extension',
  );
  assert.equal(
    existsSync(pnpmWrapperPath),
    true,
    'release Linux and macOS runners need a POSIX sdkwork-run-pnpm wrapper because package scripts invoke sdkwork-run-pnpm without a .cmd extension',
  );
  assert.match(
    reusableWorkflow,
    /Expose workspace command wrappers[\s\S]*command -v cygpath[\s\S]*chmod \+x "\$\{workspace_path\}\/sdkwork-run-node" "\$\{workspace_path\}\/sdkwork-run-pnpm"[\s\S]*printf '%s\\n' "\$GITHUB_WORKSPACE" >> "\$\{github_path_file\}"/,
    'release jobs must add the checked-out workspace root to PATH before running pnpm scripts that call sdkwork-run-node or sdkwork-run-pnpm',
  );
  assert.equal(
    wrapperPathExposureCount,
    5,
    'release workflow must expose workspace command wrappers in every job that runs pnpm lifecycle scripts',
  );
  assert.match(reusableWorkflow, /verify-release:/);
  assert.match(reusableWorkflow, /Prepare shared SDK sources/);
  assert.doesNotMatch(
    reusableWorkflow,
    /SDKWORK_SHARED_SDK_GIT_REF:\s*main/,
    'release workflow must not float shared SDK resolution on a remote main branch',
  );
  assert.doesNotMatch(
    reusableWorkflow,
    /SDKWORK_SHARED_SDK_APPBASE_APP_REPO_URL:/,
    'release workflow should be self-contained and must not require an external appbase SDK repo URL',
  );
  assert.doesNotMatch(
    reusableWorkflow,
    /SDKWORK_SHARED_SDK_COMMON_REPO_URL:/,
    'release workflow should be self-contained and must not require an external common SDK repo URL',
  );
  assert.equal(gitSourcePreparationCount, 5);
  assert.match(reusableWorkflow, /pnpm install --frozen-lockfile/);
  assert.equal(sharedSdkPreparationCount, 5);
  assert.match(reusableWorkflow, /submodules:\s*recursive/);
  assert.match(reusableWorkflow, /libgtk-3-dev/);
  assert.match(reusableWorkflow, /libpipewire-0\.3-dev/);
  assert.match(reusableWorkflow, /libssl-dev/);
  assert.match(reusableWorkflow, /libfuse2t64/);
  assert.match(reusableWorkflow, /libgbm-dev/);
  assert.match(reusableWorkflow, /file/);
  assert.match(reusableWorkflow, /pkg-config/);
  assert.match(reusableWorkflow, /libwayland-dev/);
  assert.match(reusableWorkflow, /libxkbcommon-dev/);
  assert.match(reusableWorkflow, /pnpm check:server/);
  assert.match(
    reusableWorkflow,
    /node scripts\/run-cargo\.mjs test --manifest-path packages\/sdkwork-agentstudio-pc-desktop\/src-tauri\/Cargo\.toml/,
    'release verification must execute Rust checks through scripts/run-cargo.mjs so Cargo dependency resolution stays locked and diagnostics stay consistent with local checks',
  );
  assert.doesNotMatch(
    reusableWorkflow,
    /(^|\s)cargo test --manifest-path packages\/sdkwork-agentstudio-pc-desktop\/src-tauri\/Cargo\.toml/,
    'release workflow must not bypass the shared Cargo wrapper',
  );
  assert.match(reusableWorkflow, /pnpm build/);
  assert.match(reusableWorkflow, /pnpm docs:build/);
  assert.match(reusableWorkflow, /package_profile_id: \$\{\{ steps\.plan\.outputs\.package_profile_id \}\}/);
  assert.match(reusableWorkflow, /package_profile_included_kernel_ids: \$\{\{ steps\.plan\.outputs\.package_profile_included_kernel_ids \}\}/);
  assert.match(reusableWorkflow, /node scripts\/release\/resolve-release-plan\.mjs --profile \$\{\{ inputs\.release_profile \}\} --package-profile \$\{\{ inputs\.package_profile \}\}/);
  assert.match(reusableWorkflow, /server_matrix: \$\{\{ steps\.plan\.outputs\.server_matrix \}\}/);
  assert.match(reusableWorkflow, /container_matrix: \$\{\{ steps\.plan\.outputs\.container_matrix \}\}/);
  assert.match(reusableWorkflow, /kubernetes_matrix: \$\{\{ steps\.plan\.outputs\.kubernetes_matrix \}\}/);
  assert.match(reusableWorkflow, /required_target_count: \$\{\{ steps\.plan\.outputs\.required_target_count \}\}/);
  assert.match(reusableWorkflow, /family_target_counts: \$\{\{ steps\.plan\.outputs\.family_target_counts \}\}/);
  assert.match(reusableWorkflow, /manifest_checksum_file_name: \$\{\{ steps\.plan\.outputs\.manifest_checksum_file_name \}\}/);
  assert.match(reusableWorkflow, /attestation_evidence_file_name: \$\{\{ steps\.plan\.outputs\.attestation_evidence_file_name \}\}/);
  assert.match(reusableWorkflow, /node scripts\/run-desktop-release-build\.mjs --profile \$\{\{ inputs\.release_profile \}\} --package-profile \$\{\{ needs\.prepare\.outputs\.package_profile_id \}\} --phase sync --target \$\{\{ matrix\.target \}\} --release/);
  assert.match(reusableWorkflow, /node scripts\/run-desktop-release-build\.mjs --profile \$\{\{ inputs\.release_profile \}\} --package-profile \$\{\{ needs\.prepare\.outputs\.package_profile_id \}\} --phase prepare-target --target \$\{\{ matrix\.target \}\}/);
  assert.match(reusableWorkflow, /if: contains\(needs\.prepare\.outputs\.package_profile_included_kernel_ids, 'openclaw'\)[\s\S]*node scripts\/run-desktop-release-build\.mjs --profile \$\{\{ inputs\.release_profile \}\} --package-profile \$\{\{ needs\.prepare\.outputs\.package_profile_id \}\} --phase prepare-openclaw --target \$\{\{ matrix\.target \}\}/);
  assert.match(reusableWorkflow, /node scripts\/run-desktop-release-build\.mjs --profile \$\{\{ inputs\.release_profile \}\} --package-profile \$\{\{ needs\.prepare\.outputs\.package_profile_id \}\} --phase bundle --target \$\{\{ matrix\.target \}\}/);
  assert.match(reusableWorkflow, /node scripts\/release\/package-release-assets\.mjs desktop --profile \$\{\{ inputs\.release_profile \}\} --package-profile \$\{\{ needs\.prepare\.outputs\.package_profile_id \}\} --platform \$\{\{ matrix\.platform \}\} --arch \$\{\{ matrix\.arch \}\} --target \$\{\{ matrix\.target \}\}/);
  assert.match(
    reusableWorkflow,
    /desktop-release:[\s\S]*apt-get install -y[\s\S]*xvfb/s,
    'desktop release workflow must install xvfb so Linux packaged launch smoke can run headlessly',
  );
  assert.match(
    reusableWorkflow,
    /desktop-release:[\s\S]*package-release-assets\.mjs desktop --profile \$\{\{ inputs\.release_profile \}\} --package-profile \$\{\{ needs\.prepare\.outputs\.package_profile_id \}\} --platform \$\{\{ matrix\.platform \}\} --arch \$\{\{ matrix\.arch \}\} --target \$\{\{ matrix\.target \}\} --output-dir artifacts\/release[\s\S]*smoke-desktop-installers\.mjs --platform \$\{\{ matrix\.platform \}\} --arch \$\{\{ matrix\.arch \}\} --target \$\{\{ matrix\.target \}\} --release-assets-dir artifacts\/release/s,
    'desktop release workflow must smoke packaged installers before attesting and uploading artifacts',
  );
  assert.match(
    reusableWorkflow,
    /desktop-release:[\s\S]*smoke-desktop-installers\.mjs --platform \$\{\{ matrix\.platform \}\} --arch \$\{\{ matrix\.arch \}\} --target \$\{\{ matrix\.target \}\} --release-assets-dir artifacts\/release[\s\S]*smoke-desktop-packaged-launch\.mjs --platform \$\{\{ matrix\.platform \}\} --arch \$\{\{ matrix\.arch \}\} --target \$\{\{ matrix\.target \}\} --release-assets-dir artifacts\/release[\s\S]*actions\/attest-build-provenance@v3/s,
    'desktop release workflow must smoke packaged launch startup after installer smoke and before attesting artifacts',
  );
  assert.match(reusableWorkflow, /server-release:/);
  assert.match(reusableWorkflow, /container-release:/);
  assert.match(reusableWorkflow, /kubernetes-release:/);
  assert.match(
    reusableWorkflow,
    /container-release:[\s\S]*docker\/setup-buildx-action@/,
    'container release workflow must provision buildx before publishing OCI images',
  );
  assert.match(
    reusableWorkflow,
    /container-release:[\s\S]*docker\/login-action@/,
    'container release workflow must authenticate to the OCI registry before pushing images',
  );
  assert.match(
    reusableWorkflow,
    /container-release:[\s\S]*docker\/build-push-action@/,
    'container release workflow must build and push the published server image',
  );
  assert.match(
    reusableWorkflow,
    /container-image-metadata-\$\{\{ matrix\.arch \}\}/,
    'release workflow must persist published image metadata by architecture for downstream packaging',
  );
  assert.match(reusableWorkflow, /pnpm server:build/);
  assert.match(reusableWorkflow, /node scripts\/run-agentstudio-server-build\.mjs --target \$\{\{ matrix\.target \}\}/);
  assert.match(reusableWorkflow, /node scripts\/release\/package-release-assets\.mjs server --profile \$\{\{ inputs\.release_profile \}\} --release-tag \$\{\{ needs\.prepare\.outputs\.release_tag \}\} --platform \$\{\{ matrix\.platform \}\} --arch \$\{\{ matrix\.arch \}\} --target \$\{\{ matrix\.target \}\}/);
  assert.match(reusableWorkflow, /node scripts\/release\/package-release-assets\.mjs container --profile \$\{\{ inputs\.release_profile \}\} --release-tag \$\{\{ needs\.prepare\.outputs\.release_tag \}\} --platform \$\{\{ matrix\.platform \}\} --arch \$\{\{ matrix\.arch \}\} --target \$\{\{ matrix\.target \}\} --accelerator \$\{\{ matrix\.accelerator \}\}/);
  assert.match(reusableWorkflow, /node scripts\/release\/package-release-assets\.mjs kubernetes --profile \$\{\{ inputs\.release_profile \}\} --release-tag \$\{\{ needs\.prepare\.outputs\.release_tag \}\} --platform \$\{\{ matrix\.platform \}\} --arch \$\{\{ matrix\.arch \}\} --target \$\{\{ matrix\.target \}\} --accelerator \$\{\{ matrix\.accelerator \}\}/);
  assert.match(
    reusableWorkflow,
    /kubernetes-release:[\s\S]*needs:\s*\[\s*prepare,\s*verify-release,\s*container-release\s*\]/,
    'kubernetes packaging must wait for the OCI image publication metadata',
  );
  assert.match(
    reusableWorkflow,
    /kubernetes-release:[\s\S]*actions\/download-artifact@v4[\s\S]*container-image-metadata-\$\{\{ matrix\.arch \}\}/,
    'kubernetes packaging must download the published image metadata for the current architecture',
  );
  assert.match(
    reusableWorkflow,
    /package-release-assets\.mjs kubernetes[\s\S]*--image-repository \$\{\{ steps\.[^.]+\.outputs\.image_repository \}\}[\s\S]*--image-tag \$\{\{ steps\.[^.]+\.outputs\.image_tag \}\}[\s\S]*--image-digest \$\{\{ steps\.[^.]+\.outputs\.image_digest \}\}/,
    'kubernetes release packaging must stamp repository, tag, and digest from the published OCI image metadata',
  );
  assert.match(
    reusableWorkflow,
    /node scripts\/release\/package-release-assets\.mjs web --profile \$\{\{ inputs\.release_profile \}\}[\s\S]*node scripts\/release\/smoke-web-release-assets\.mjs --release-assets-dir artifacts\/release/,
    'web release workflow must smoke packaged web and docs archives before attesting artifacts',
  );
  assert.match(reusableWorkflow, /node scripts\/release\/finalize-release-assets\.mjs --profile \$\{\{ inputs\.release_profile \}\}/);
  assert.match(
    reusableWorkflow,
    /Render release notes[\s\S]*node scripts\/release\/render-release-notes\.mjs --release-tag \$\{\{ needs\.prepare\.outputs\.release_tag \}\} --output release-assets\/release-notes\.md[\s\S]*Finalize release assets[\s\S]*Attest finalized release assets[\s\S]*Write finalized attestation evidence[\s\S]*node scripts\/release\/write-attestation-evidence\.mjs --profile \$\{\{ inputs\.release_profile \}\} --release-assets-dir release-assets --repository \$\{\{ github\.repository \}\} --release-tag \$\{\{ needs\.prepare\.outputs\.release_tag \}\}[\s\S]*Assert release readiness[\s\S]*node scripts\/release\/assert-release-readiness\.mjs --profile \$\{\{ inputs\.release_profile \}\} --release-assets-dir release-assets[\s\S]*Publish release assets/,
    'release workflow must render notes before finalization, attest the finalized set, write offline attestation evidence, then assert readiness before publishing assets',
  );
  assert.doesNotMatch(
    reusableWorkflow,
    /Finalize release assets[\s\S]*--allow-partial-release[\s\S]*Assert release readiness/,
    'GitHub release finalization must require complete release asset coverage',
  );
  assert.match(
    reusableWorkflow,
    /node scripts\/release\/render-release-notes\.mjs --release-tag \$\{\{ needs\.prepare\.outputs\.release_tag \}\} --output release-assets\/release-notes\.md/,
  );
  assert.match(reusableWorkflow, /actions\/attest-build-provenance@v3/);
  assert.match(
    reusableWorkflow,
    /Write finalized attestation evidence[\s\S]*write-attestation-evidence\.mjs/,
    'release workflow must produce machine-readable attestation verification evidence for the readiness gate',
  );
  assert.match(reusableWorkflow, /attestations:\s*write/);
  assert.match(reusableWorkflow, /id-token:\s*write/);
  assert.match(reusableWorkflow, /softprops\/action-gh-release@/);
  assert.match(reusableWorkflow, /body_path:\s*release-assets\/release-notes\.md/);
  assert.doesNotMatch(reusableWorkflow, /generate_release_notes:\s*true/);
  assert.match(reusableWorkflow, /CMAKE_GENERATOR:\s*Visual Studio 17 2022/);
  assert.match(reusableWorkflow, /needs:\s*\[\s*prepare,\s*verify-release\s*\]/);
  assert.match(reusableWorkflow, /-\s*server-release/);
  assert.match(reusableWorkflow, /-\s*container-release/);
  assert.match(reusableWorkflow, /-\s*kubernetes-release/);
});

test('ci workflow authenticates private GitHub shared SDK source preparation', () => {
  const ciWorkflowPath = path.join(rootDir, '.github', 'workflows', 'ci.yml');
  assert.equal(existsSync(ciWorkflowPath), true, 'missing .github/workflows/ci.yml');

  const ciWorkflow = read('.github/workflows/ci.yml');
  const gitSourcePreparationCount =
    ciWorkflow.match(/node scripts\/prepare-shared-sdk-git-sources\.mjs/g)?.length ?? 0;

  assert.match(ciWorkflow, /SDKWORK_SHARED_SDK_MODE:\s*git/);
  assert.match(ciWorkflow, /SDKWORK_PREPARE_OPTIONAL_SHARED_SDKS:\s*'true'/);
  assert.match(
    ciWorkflow,
    /SDKWORK_SHARED_SDK_GITHUB_TOKEN:\s*\$\{\{ secrets\.SDKWORK_SHARED_SDK_GITHUB_TOKEN \|\| github\.token \}\}/,
    'CI must pass a GitHub token to private shared SDK clones without embedding credentials in repo URLs',
  );
  assert.equal(gitSourcePreparationCount, 2);
});

test('desktop tauri build script keeps generated bundled resources explicit', () => {
  const buildScript = read('packages/sdkwork-agentstudio-pc-desktop/src-tauri/build.rs');

  assert.match(buildScript, /generated\/bundled/);
  assert.match(buildScript, /placeholder\.txt/);
});

test('root package exposes release helper scripts for desktop and asset packaging', () => {
  const rootPackage = JSON.parse(read('package.json'));
  const releaseClosureScriptPath = path.join(rootDir, 'scripts', 'check-release-closure.mjs');

  assert.match(
    rootPackage.scripts['check:multi-mode'],
    /sdkwork-run-pnpm check:desktop && sdkwork-run-pnpm check:server && sdkwork-run-pnpm check:sdkwork-host-runtime && sdkwork-run-pnpm check:desktop-openclaw-runtime && sdkwork-run-pnpm check:release-flow/,
    'root package must expose one unified multi-mode verification command for desktop, server, deployment runtime, OpenClaw readiness, and release packaging',
  );
  assert.match(rootPackage.scripts['check:release-flow'], /sdkwork-run-node scripts\/release-flow-contract\.test\.mjs/);
  assert.match(rootPackage.scripts['check:release-flow'], /sdkwork-run-node scripts\/release-deployment-contract\.test\.mjs/);
  assert.equal(existsSync(releaseClosureScriptPath), true, 'missing scripts/check-release-closure.mjs');
  assert.match(rootPackage.scripts['check:release-flow'], /sdkwork-run-node scripts\/check-release-closure\.mjs/);
  assert.match(rootPackage.scripts['check:release-flow'], /sdkwork-run-node scripts\/release\/release-profiles\.test\.mjs/);
  assert.match(rootPackage.scripts['check:release-flow'], /sdkwork-run-node scripts\/release\/kernel-definitions\.test\.mjs/);
  assert.match(rootPackage.scripts['check:release-flow'], /sdkwork-run-node scripts\/run-desktop-release-build\.test\.mjs/);
  assert.match(rootPackage.scripts['check:release-flow'], /sdkwork-run-node scripts\/run-agentstudio-server-build\.test\.mjs/);
  assert.match(rootPackage.scripts['check:release-flow'], /sdkwork-run-node scripts\/release\/release-smoke-contract\.test\.mjs/);
  assert.match(rootPackage.scripts['check:release-flow'], /sdkwork-run-node scripts\/release\/release-paths\.test\.mjs/);
  assert.match(rootPackage.scripts['check:release-flow'], /sdkwork-run-node scripts\/release\/release-coverage\.test\.mjs/);
  assert.match(rootPackage.scripts['check:release-flow'], /sdkwork-run-node scripts\/release\/release-status\.test\.mjs/);
  assert.match(rootPackage.scripts['check:release-flow'], /sdkwork-run-node scripts\/release\/finalize-release-assets\.test\.mjs/);
  assert.match(rootPackage.scripts['check:release-flow'], /sdkwork-run-node scripts\/release\/assert-release-readiness\.test\.mjs/);
  assert.match(rootPackage.scripts['check:release-flow'], /sdkwork-run-node scripts\/release\/write-attestation-evidence\.test\.mjs/);
  assert.match(rootPackage.scripts['check:release-flow'], /sdkwork-run-node scripts\/release\/smoke-deployment-release-assets\.test\.mjs/);
  assert.match(rootPackage.scripts['check:release-flow'], /sdkwork-run-node scripts\/release\/smoke-server-release-assets\.test\.mjs/);
  assert.match(rootPackage.scripts['check:release-flow'], /sdkwork-run-node scripts\/release\/smoke-web-release-assets\.test\.mjs/);
  assert.match(rootPackage.scripts['check:release-flow'], /sdkwork-run-node scripts\/release\/smoke-desktop-installers\.test\.mjs/);
  assert.match(rootPackage.scripts['check:release-flow'], /sdkwork-run-node scripts\/release\/smoke-desktop-packaged-launch\.test\.mjs/);
  assert.match(rootPackage.scripts['check:release-flow'], /sdkwork-run-node scripts\/release\/smoke-desktop-startup-evidence\.test\.mjs/);
  assert.match(rootPackage.scripts['check:release-flow'], /sdkwork-run-node scripts\/release\/local-release-command\.test\.mjs/);
  assert.match(rootPackage.scripts['check:release-flow'], /sdkwork-run-node scripts\/release\/render-release-notes\.mjs --help/);
  assert.match(rootPackage.scripts['check:ci-flow'], /sdkwork-run-node scripts\/ci-flow-contract\.test\.mjs/);
  assert.match(
    rootPackage.scripts['check:automation'],
    /sdkwork-run-node scripts\/openclaw-quality-gate-contract\.test\.mjs/,
  );
  assert.match(rootPackage.scripts['check:automation'], /sdkwork-run-node scripts\/cargo-command-standards\.test\.mjs/);
  assert.match(rootPackage.scripts['check:automation'], /sdkwork-run-pnpm check:release-flow && sdkwork-run-pnpm check:ci-flow/);
  assert.match(rootPackage.scripts['release:write-attestation-evidence'], /sdkwork-run-node scripts\/release\/write-attestation-evidence\.mjs/);
  assert.match(rootPackage.scripts['lint'], /sdkwork-run-pnpm check:automation/);
  assert.match(rootPackage.scripts['check:shared-sdk-release-parity'], /sdkwork-run-node scripts\/check-shared-sdk-release-parity\.mjs/);
  assert.match(rootPackage.scripts['check:server'], /sdkwork-run-node scripts\/check-server-platform-foundation\.mjs/);
  assert.match(rootPackage.scripts['check:server'], /sdkwork-run-node scripts\/run-cargo\.mjs test --manifest-path packages\/sdkwork-agentstudio-pc-server\/src-host\/Cargo\.toml/);
  assert.match(
    rootPackage.scripts['check:desktop-openclaw-runtime'],
    /sdkwork-run-node scripts\/verify-desktop-openclaw-release-assets\.test\.mjs/,
    'desktop OpenClaw runtime checks must include the dedicated release asset verifier test',
  );
  assert.match(
    rootPackage.scripts['check:desktop'],
    /sdkwork-run-node scripts\/verify-desktop-openclaw-release-assets\.test\.mjs/,
    'desktop verification must include the dedicated OpenClaw release asset verifier test',
  );
  assert.match(
    rootPackage.scripts['check:release-flow'],
    /node scripts\/verify-desktop-openclaw-release-assets\.test\.mjs/,
    'release flow verification must include the dedicated OpenClaw release asset verifier test',
  );
  assert.match(rootPackage.scripts['build:web'], /sdkwork-run-pnpm prepare:shared-sdk && sdkwork-run-pnpm --filter @sdkwork\/claw-web build/);
  assert.match(rootPackage.scripts['build:server'], /sdkwork-run-node scripts\/run-agentstudio-server-build\.mjs/);
  assert.match(
    rootPackage.scripts['build:desktop-host'],
    /sdkwork-run-pnpm --dir packages\/sdkwork-agentstudio-pc-desktop build:prod/,
  );
  assert.match(
    rootPackage.scripts['build:desktop'],
    /sdkwork-run-pnpm --dir packages\/sdkwork-agentstudio-pc-desktop build:desktop:prod/,
  );
  assert.match(
    rootPackage.scripts['package:desktop'],
    /sdkwork-run-node scripts\/release\/local-release-command\.mjs package desktop/,
  );
  assert.match(
    rootPackage.scripts['release:package:server'],
    /sdkwork-run-node scripts\/release\/local-release-command\.mjs package server/,
  );
  assert.match(rootPackage.scripts['release:desktop'], /sdkwork-run-node scripts\/run-desktop-release-build\.mjs/);
  assert.match(rootPackage.scripts['release:plan'], /sdkwork-run-node scripts\/release\/local-release-command\.mjs plan/);
  assert.match(rootPackage.scripts['release:status'], /sdkwork-run-node scripts\/release\/local-release-command\.mjs status/);
  assert.match(rootPackage.scripts['release:package:desktop'], /sdkwork-run-node scripts\/release\/local-release-command\.mjs package desktop/);
  assert.match(rootPackage.scripts['release:package:server'], /sdkwork-run-node scripts\/release\/local-release-command\.mjs package server/);
  assert.match(rootPackage.scripts['release:package:container'], /sdkwork-run-node scripts\/release\/local-release-command\.mjs package container/);
  assert.match(rootPackage.scripts['release:package:kubernetes'], /sdkwork-run-node scripts\/release\/local-release-command\.mjs package kubernetes/);
  assert.match(rootPackage.scripts['release:package:web'], /sdkwork-run-node scripts\/release\/local-release-command\.mjs package web/);
  const localReleaseCommandSource = read('scripts/release/local-release-command.mjs');
  assert.match(
    localReleaseCommandSource,
    /context\.mode === 'status'[\s\S]*collectReleaseStatusFn\(\{[\s\S]*releaseAssetsDir: context\.releaseAssetsDir[\s\S]*JSON\.stringify\(status, null, 2\)/,
    'local release wrapper must expose a machine-readable release status diagnostic before strict finalization',
  );
  assert.match(
    read('scripts/release/release-status.mjs'),
    /releaseIssueMetadataByCode[\s\S]*recommendedAction[\s\S]*normalizeReleaseIssue[\s\S]*buildReleaseNextActions/,
    'release status diagnostics must map issue codes to actionable remediation metadata and aggregate next actions',
  );
  assert.match(
    read('scripts/release/release-status.mjs'),
    /buildReleaseCoverage[\s\S]*buildArtifactsOutsideReleaseProfile[\s\S]*buildDuplicateReleaseTargetEntries[\s\S]*issues\.map\(normalizeReleaseIssue\)[\s\S]*blockingIssueCount[\s\S]*issueCountsBySeverity[\s\S]*issueCountsByCode[\s\S]*nextCommands[\s\S]*nextActions: buildReleaseNextActions/,
    'release status diagnostics must reuse shared release coverage, surface actionable issue metadata, emit target-specific next packaging commands, and aggregate prioritized next actions',
  );
  assert.match(
    localReleaseCommandSource,
    /export function runLocalWebBuild/,
    'local release wrapper must expose a canonical web/docs build prerequisite for local web packaging',
  );
  assert.match(
    localReleaseCommandSource,
    /path\.join\(rootDir, 'scripts', 'run-vite-host\.mjs'\)[\s\S]*'build'[\s\S]*'--mode'[\s\S]*'production'/,
    'local web packaging must rebuild the production web host through the canonical Vite host runner',
  );
  assert.match(
    localReleaseCommandSource,
    /path\.join\(rootDir, 'scripts', 'check-web-performance-budget\.mjs'\)/,
    'local web packaging must enforce the frozen web performance budget before archiving assets',
  );
  assert.match(
    localReleaseCommandSource,
    /path\.join\(rootDir, 'scripts', 'run-vitepress\.mjs'\)[\s\S]*'build'[\s\S]*'docs'/,
    'local web packaging must rebuild docs before archiving assets',
  );
  assert.match(
    localReleaseCommandSource,
    /ensureLocalWebBuildPrerequisiteFn\(\{[\s\S]*context[\s\S]*\}\);[\s\S]*packageWebAssetsFn\(context\);[\s\S]*await smokeWebReleaseAssetsFn\(context\);/,
    'local package:web must run the web/docs prerequisite, package assets, then smoke the real web archive',
  );
  assert.match(rootPackage.scripts['release:smoke:desktop'], /sdkwork-run-node scripts\/release\/local-release-command\.mjs smoke desktop/);
  assert.match(rootPackage.scripts['release:smoke:desktop-packaged-launch'], /sdkwork-run-node scripts\/release\/smoke-desktop-packaged-launch\.mjs/);
  assert.match(rootPackage.scripts['release:smoke:desktop-startup'], /sdkwork-run-node scripts\/release\/smoke-desktop-startup-evidence\.mjs/);
  assert.match(rootPackage.scripts['release:smoke:server'], /sdkwork-run-node scripts\/release\/local-release-command\.mjs smoke server/);
  assert.match(rootPackage.scripts['release:smoke:web'], /sdkwork-run-node scripts\/release\/local-release-command\.mjs smoke web/);
  assert.match(rootPackage.scripts['release:smoke:container'], /sdkwork-run-node scripts\/release\/local-release-command\.mjs smoke container/);
  assert.match(rootPackage.scripts['release:smoke:kubernetes'], /sdkwork-run-node scripts\/release\/local-release-command\.mjs smoke kubernetes/);
  assert.match(rootPackage.scripts['release:finalize'], /sdkwork-run-node scripts\/release\/local-release-command\.mjs finalize/);
  assert.match(rootPackage.scripts['release:assert-ready'], /sdkwork-run-node scripts\/release\/local-release-command\.mjs assert-ready/);
  assert.match(rootPackage.scripts['release:fixture:ready'], /sdkwork-run-node scripts\/release\/write-readiness-fixture\.mjs/);
  assert.match(rootPackage.scripts['check:release-flow'], /sdkwork-run-node scripts\/release\/write-readiness-fixture\.mjs --help/);
  assert.doesNotMatch(
    rootPackage.scripts['release:finalize'],
    /--allow-partial-release/,
    'release:finalize must remain a strict full-matrix finalization command',
  );
  assert.match(
    rootPackage.scripts['release:finalize:partial'],
    /sdkwork-run-node scripts\/release\/local-release-command\.mjs finalize --allow-partial-release/,
    'partial release aggregation must be an explicit local/debug command',
  );
  assert.match(rootPackage.scripts['build:server'], /sdkwork-run-node scripts\/run-agentstudio-server-build\.mjs/);
});

test('release closure guard passes against the committed release packaging contracts', () => {
  const releaseClosureCheck = spawnSync(process.execPath, ['scripts/check-release-closure.mjs'], {
    cwd: rootDir,
    encoding: 'utf8',
  });

  if (releaseClosureCheck.error?.code === 'EPERM') {
    return import(pathToFileURL(path.join(rootDir, 'scripts', 'check-release-closure.mjs')).href)
      .then((module) => {
        assert.equal(typeof module.main, 'function');
        module.main();
      });
  }

  assert.equal(
    releaseClosureCheck.status,
    0,
    releaseClosureCheck.stderr || releaseClosureCheck.stdout || 'release closure guard must pass',
  );
});

test('release closure contract documents and guards desktop install-ready smoke evidence', () => {
  const releaseClosureGuard = read('scripts/check-release-closure.mjs');
  const releaseDoc = read('docs/core/release-and-deployment.md');

  assert.match(
    releaseClosureGuard,
    /smoke-desktop-installers/,
    'release closure guard must require the desktop workflow smoke step',
  );
  assert.match(
    releaseClosureGuard,
    /kernelInstallContracts/,
    'release closure guard must protect the persisted desktop kernel install contracts',
  );
  assert.match(
    releaseClosureGuard,
    /desktopInstallerSmoke/,
    'release closure guard must protect aggregated desktop installer smoke metadata',
  );
  assert.match(
    releaseClosureGuard,
    /kernelInstallReadiness/,
    'release closure guard must protect per-kernel install readiness metadata',
  );
  assert.match(
    releaseClosureGuard,
    /installReadyLayout/,
    'release closure guard must protect install-ready layout evidence',
  );
  assert.match(
    releaseClosureGuard,
    /release:smoke:desktop-packaged-launch/,
    'release closure guard must expose the dedicated desktop packaged launch smoke command',
  );
  assert.match(
    releaseClosureGuard,
    /release:smoke:desktop-startup/,
    'release closure guard must expose the dedicated desktop startup smoke command',
  );
  assert.match(
    releaseClosureGuard,
    /desktopStartupSmoke/,
    'release closure guard must protect aggregated desktop startup smoke metadata when it exists',
  );
  assert.match(
    releaseClosureGuard,
    /localAiProxyRuntime/,
    'release closure guard must protect aggregated desktop startup local ai proxy runtime metadata',
  );
  assert.match(
    releaseClosureGuard,
    /desktop-startup-evidence\.json/,
    'release closure guard must protect the captured desktop startup evidence path',
  );

  assert.match(
    releaseDoc,
    /check:multi-mode/,
    'release documentation must expose the unified multi-mode verification command',
  );
  assert.match(
    releaseDoc,
    /versionSourcesAligned/,
    'release documentation must explain when OpenClaw version sources are internally aligned even if no upgrade should run yet',
  );
  assert.match(
    releaseDoc,
    /release:smoke:desktop/,
    'release documentation must expose the desktop smoke command',
  );
  assert.match(
    releaseDoc,
    /release:smoke:desktop-packaged-launch/,
    'release documentation must expose the desktop packaged launch smoke command',
  );
  assert.match(
    releaseDoc,
    /release:smoke:desktop-startup/,
    'release documentation must expose the desktop startup smoke command',
  );
  assert.match(
    releaseDoc,
    /kernelInstallContracts/,
    'release documentation must describe the desktop kernel install contract metadata',
  );
  assert.match(
    releaseDoc,
    /desktopInstallerSmoke/,
    'release documentation must describe aggregated desktop installer smoke metadata',
  );
  assert.match(
    releaseDoc,
    /kernelInstallReadiness/,
    'release documentation must describe per-kernel install readiness metadata',
  );
  assert.match(
    releaseDoc,
    /installReadyLayout/,
    'release documentation must describe install-ready layout evidence',
  );
  assert.match(
    releaseDoc,
    /desktopStartupSmoke/,
    'release documentation must describe aggregated desktop startup smoke metadata',
  );
  assert.match(
    releaseDoc,
    /localAiProxyRuntime/,
    'release documentation must describe aggregated desktop startup local ai proxy runtime metadata',
  );
  assert.match(
    releaseDoc,
    /desktop-startup-evidence\.json/,
    'release documentation must describe the captured desktop startup evidence artifact',
  );
});

test('release closure contract documents and guards packaged server bundle smoke evidence', () => {
  const releaseClosureGuard = read('scripts/check-release-closure.mjs');
  const releaseDoc = read('docs/core/release-and-deployment.md');
  const reusableWorkflow = read('.github/workflows/release-reusable.yml');

  assert.match(
    releaseClosureGuard,
    /release:smoke:server/,
    'release closure guard must require the packaged server smoke command',
  );
  assert.match(
    releaseClosureGuard,
    /serverBundleSmoke/,
    'release closure guard must protect aggregated server bundle smoke metadata',
  );
  assert.match(
    reusableWorkflow,
    /server-release:[\s\S]*package-release-assets\.mjs server[\s\S]*smoke-server-release-assets\.mjs --platform \$\{\{ matrix\.platform \}\} --arch \$\{\{ matrix\.arch \}\} --target \$\{\{ matrix\.target \}\} --release-assets-dir artifacts\/release/s,
    'server release workflow must smoke packaged server bundles before attesting and uploading artifacts',
  );
  assert.match(
    releaseDoc,
    /release:smoke:server/,
    'release documentation must expose the server smoke command',
  );
  assert.match(
    releaseDoc,
    /serverBundleSmoke/,
    'release documentation must describe aggregated server bundle smoke metadata',
  );
});

test('release closure contract documents and guards deployment smoke evidence', () => {
  const releaseClosureGuard = read('scripts/check-release-closure.mjs');
  const releaseDoc = read('docs/core/release-and-deployment.md');
  const reusableWorkflow = read('.github/workflows/release-reusable.yml');

  assert.match(
    releaseClosureGuard,
    /release:smoke:container/,
    'release closure guard must require the packaged container smoke command',
  );
  assert.match(
    releaseClosureGuard,
    /release:smoke:kubernetes/,
    'release closure guard must require the packaged kubernetes smoke command',
  );
  assert.match(
    releaseClosureGuard,
    /deploymentSmoke/,
    'release closure guard must protect aggregated deployment smoke metadata',
  );
  assert.match(
    reusableWorkflow,
    /container-release:[\s\S]*package-release-assets\.mjs container[\s\S]*smoke-deployment-release-assets\.mjs --family container --platform \$\{\{ matrix\.platform \}\} --arch \$\{\{ matrix\.arch \}\} --target \$\{\{ matrix\.target \}\} --accelerator \$\{\{ matrix\.accelerator \}\} --release-assets-dir artifacts\/release/s,
    'container release workflow must smoke packaged deployment bundles before attesting and uploading artifacts',
  );
  assert.match(
    reusableWorkflow,
    /kubernetes-release:[\s\S]*smoke-deployment-release-assets\.mjs --family kubernetes --platform \$\{\{ matrix\.platform \}\} --arch \$\{\{ matrix\.arch \}\} --target \$\{\{ matrix\.target \}\} --accelerator \$\{\{ matrix\.accelerator \}\} --release-assets-dir artifacts\/release/s,
    'kubernetes release workflow must smoke packaged chart bundles before attesting and uploading artifacts',
  );
  assert.match(
    releaseDoc,
    /release:smoke:container/,
    'release documentation must expose the container smoke command',
  );
  assert.match(
    releaseDoc,
    /release:smoke:kubernetes/,
    'release documentation must expose the kubernetes smoke command',
  );
  assert.match(
    releaseDoc,
    /deploymentSmoke/,
    'release documentation must describe aggregated deployment smoke metadata',
  );
});

test('release closure contract guards unified host runtime smoke evidence', () => {
  const releaseClosureGuard = read('scripts/check-release-closure.mjs');
  const releaseDoc = read('docs/core/release-and-deployment.md');
  const runtimeSmokeReport = read(
    'docs/reports/2026-04-05-unified-rust-host-runtime-hardening-smoke.md',
  );

  assert.match(
    releaseClosureGuard,
    /2026-04-05-unified-rust-host-runtime-hardening-smoke\.md/,
    'release closure guard must require the persisted unified host runtime smoke report',
  );
  assert.match(
    releaseClosureGuard,
    /check:sdkwork-host-runtime/,
    'release closure guard must require the runtime authority verification command to stay documented',
  );

  assert.match(
    releaseDoc,
    /check:sdkwork-host-runtime/,
    'release documentation must expose the unified runtime authority verification command',
  );
  assert.match(
    releaseDoc,
    /unified host runtime smoke report/i,
    'release documentation must describe the persisted unified host runtime smoke report',
  );
  assert.match(
    runtimeSmokeReport,
    /Automated Verification/,
    'unified host runtime smoke report must record automated verification evidence',
  );
  assert.match(
    runtimeSmokeReport,
    /Follow-up Manual Checklist/,
    'unified host runtime smoke report must preserve the remaining manual verification checklist',
  );
});

test('release closure contract guards deployment bootstrap smoke evidence', () => {
  const releaseClosureGuard = read('scripts/check-release-closure.mjs');
  const releaseDoc = read('docs/core/release-and-deployment.md');
  const deploymentBootstrapSmokeReport = read(
    'docs/reports/2026-04-05-unified-rust-host-deployment-bootstrap-smoke.md',
  );

  assert.match(
    releaseClosureGuard,
    /2026-04-05-unified-rust-host-deployment-bootstrap-smoke\.md/,
    'release closure guard must require the persisted deployment bootstrap smoke report',
  );
  assert.match(
    releaseClosureGuard,
    /docker compose startup/i,
    'release closure guard must preserve docker compose startup smoke evidence requirements',
  );
  assert.match(
    releaseClosureGuard,
    /singleton-k8s readiness/i,
    'release closure guard must preserve singleton-k8s readiness smoke evidence requirements',
  );

  assert.match(
    releaseDoc,
    /deployment bootstrap smoke report/i,
    'release documentation must describe the persisted deployment bootstrap smoke report',
  );
  assert.match(
    releaseDoc,
    /release:package:container/,
    'release documentation must expose the container packaging command that produces deployment bundles',
  );
  assert.match(
    releaseDoc,
    /release:package:kubernetes/,
    'release documentation must expose the kubernetes packaging command that produces deployment bundles',
  );
  assert.match(
    deploymentBootstrapSmokeReport,
    /Automated Verification/,
    'deployment bootstrap smoke report must preserve automated verification evidence',
  );
  assert.match(
    deploymentBootstrapSmokeReport,
    /docker compose -f deploy\/docker\/docker-compose\.yml up -d/,
    'deployment bootstrap smoke report must preserve docker compose startup commands',
  );
  assert.match(
    deploymentBootstrapSmokeReport,
    /helm upgrade --install agent-studio \.\/chart -f values\.release\.yaml/,
    'deployment bootstrap smoke report must preserve singleton-k8s install commands',
  );
});

test('shared sdk mode helper defaults to source mode and supports git trunk release mode', async () => {
  const helperPath = path.join(rootDir, 'scripts', 'shared-sdk-mode.mjs');
  assert.equal(existsSync(helperPath), true, 'missing scripts/shared-sdk-mode.mjs');

  const helper = await import(pathToFileURL(helperPath).href);
  assert.equal(typeof helper.resolveSharedSdkMode, 'function');
  assert.equal(typeof helper.isSharedSdkSourceMode, 'function');
  assert.equal(typeof helper.SHARED_SDK_MODE_ENV_VAR, 'string');

  assert.equal(helper.SHARED_SDK_MODE_ENV_VAR, 'SDKWORK_SHARED_SDK_MODE');
  assert.equal(helper.resolveSharedSdkMode({}), 'source');
  assert.equal(helper.resolveSharedSdkMode({ SDKWORK_SHARED_SDK_MODE: 'source' }), 'source');
  assert.equal(helper.resolveSharedSdkMode({ SDKWORK_SHARED_SDK_MODE: 'git' }), 'git');
  assert.equal(helper.isSharedSdkSourceMode({}), true);
  assert.equal(helper.isSharedSdkSourceMode({ SDKWORK_SHARED_SDK_MODE: 'git' }), false);
});

test('shared sdk package preparation exposes explicit opt-in for optional external shared source maintenance', async () => {
  const helperPath = path.join(rootDir, 'scripts', 'prepare-shared-sdk-packages.mjs');
  assert.equal(existsSync(helperPath), true, 'missing scripts/prepare-shared-sdk-packages.mjs');

  const helper = await import(pathToFileURL(helperPath).href);

  assert.equal(
    helper.OPTIONAL_SHARED_SDK_PACKAGE_PREPARATION_ENV_VAR,
    'SDKWORK_PREPARE_OPTIONAL_SHARED_SDKS',
  );
  assert.equal(typeof helper.shouldPrepareOptionalSharedSdkPackages, 'function');
  assert.equal(helper.shouldPrepareOptionalSharedSdkPackages({}), false);
  assert.equal(
    helper.shouldPrepareOptionalSharedSdkPackages({
      SDKWORK_PREPARE_OPTIONAL_SHARED_SDKS: 'true',
    }),
    true,
  );
  assert.equal(
    helper.shouldPrepareOptionalSharedSdkPackages({
      SDKWORK_PREPARE_OPTIONAL_SHARED_SDKS: '1',
    }),
    true,
  );
  assert.equal(
    helper.shouldPrepareOptionalSharedSdkPackages({
      SDKWORK_PREPARE_OPTIONAL_SHARED_SDKS: 'false',
    }),
    false,
  );
  assert.throws(
    () => helper.shouldPrepareOptionalSharedSdkPackages({
      SDKWORK_PREPARE_OPTIONAL_SHARED_SDKS: 'sometimes',
    }),
    /Unsupported SDKWORK_PREPARE_OPTIONAL_SHARED_SDKS value "sometimes"/,
  );
});

test('shared sdk package preparation resolves the workspace root consistently from repo root and package directories', async () => {
  const helperPath = path.join(rootDir, 'scripts', 'prepare-shared-sdk-packages.mjs');
  assert.equal(existsSync(helperPath), true, 'missing scripts/prepare-shared-sdk-packages.mjs');

  const helper = await import(pathToFileURL(helperPath).href);
  assert.equal(typeof helper.resolveWorkspaceRootDir, 'function');
  assert.equal(typeof helper.createSharedSdkPackageContext, 'function');
  assert.equal(typeof helper.resolveCanonicalWorkspaceRootDir, 'function');

  const packageDir = path.join(rootDir, 'packages', 'sdkwork-agentstudio-pc-web');
  const expectedWorkspaceRoot = rootDir;
  const expectedCanonicalWorkspaceRoot = rootDir.includes(`${path.sep}.worktrees${path.sep}`)
    ? path.resolve(rootDir, '..', '..')
    : rootDir;
  const worktreePackageDir = path.join(
    expectedWorkspaceRoot,
    '.worktrees',
    'synthetic-worktree',
    'packages',
    'sdkwork-agentstudio-pc-web',
  );
  assert.equal(helper.resolveWorkspaceRootDir(rootDir), expectedWorkspaceRoot);
  assert.equal(helper.resolveWorkspaceRootDir(packageDir), expectedWorkspaceRoot);
  assert.equal(helper.resolveWorkspaceRootDir(worktreePackageDir), expectedWorkspaceRoot);
  assert.equal(helper.resolveCanonicalWorkspaceRootDir(packageDir), expectedCanonicalWorkspaceRoot);

  assert.deepEqual(
    helper.createSharedSdkPackageContext({
      currentWorkingDir: packageDir,
      env: { SDKWORK_SHARED_SDK_MODE: 'git' },
    }),
    {
      workspaceRoot: expectedWorkspaceRoot,
      canonicalWorkspaceRoot: expectedCanonicalWorkspaceRoot,
      sharedAppSdkRoot: path.resolve(
        expectedCanonicalWorkspaceRoot,
        '../sdkwork-iam/sdks/sdkwork-iam-app-sdk/sdkwork-iam-app-sdk-typescript/generated/server-openapi',
      ),
      sharedMessagingAppSdkRoot: path.resolve(
        expectedCanonicalWorkspaceRoot,
        '../sdkwork-messaging/sdks/sdkwork-messaging-app-sdk/sdkwork-messaging-app-sdk-typescript/generated/server-openapi',
      ),
      sharedSdkCommonRoot: path.resolve(
        expectedCanonicalWorkspaceRoot,
        '../sdkwork-sdk-commons/sdkwork-sdk-common-typescript',
      ),
      sharedCorePcReactRoot: path.resolve(
        expectedCanonicalWorkspaceRoot,
        '../sdkwork-core/sdkwork-core-pc-react',
      ),
      sharedLocalApiProxyRoot: path.resolve(
        expectedCanonicalWorkspaceRoot,
        '../sdkwork-local-router/packages/pc-react/intelligence/sdkwork-local-api-proxy',
      ),
      sharedImSdkRoot: path.resolve(
        expectedCanonicalWorkspaceRoot,
        '../sdkwork-im/sdks/sdkwork-im-sdk/sdkwork-im-sdk-typescript',
      ),
      sharedRtcSdkRoot: path.resolve(
        expectedCanonicalWorkspaceRoot,
        '../sdkwork-rtc/sdks/sdkwork-rtc-sdk/sdkwork-rtc-sdk-typescript',
      ),
      mode: 'git',
    },
  );
  assert.match(
    read('scripts/prepare-shared-sdk-packages.mjs'),
    /if \(path\.resolve\(process\.argv\[1\] \?\? ''\) === __filename\) \{\s*try \{\s*main\(\);\s*\} catch \(error\) \{\s*console\.error\(error instanceof Error \? error\.message : String\(error\)\);\s*process\.exit\(1\);\s*\}\s*\}/s,
  );
});

test('shared sdk package preparation repairs package-local dependency links from the existing workspace install', async () => {
  const helperPath = path.join(rootDir, 'scripts', 'prepare-shared-sdk-packages.mjs');
  const helper = await import(pathToFileURL(helperPath).href);

  assert.equal(typeof helper.resolveWorkspaceInstalledPackageRoot, 'function');
  assert.equal(typeof helper.ensurePackageDependencyLinks, 'function');

  const tempRoot = mkdtempSync(path.join(os.tmpdir(), 'claw-shared-sdk-links-'));
  const workspaceRoot = path.join(tempRoot, 'apps', 'agent-studio');
  const sharedAppSdkRoot = path.join(
    tempRoot,
    'sdkwork-appbase',
    'sdks',
    'sdkwork-iam-app-sdk',
    'sdkwork-iam-app-sdk-typescript',
    'generated',
    'server-openapi',
  );
  const sharedSdkCommonRoot = path.join(
    tempRoot,
    'sdk',
    'sdkwork-sdk-commons',
    'sdkwork-sdk-common-typescript',
  );

  const writeWorkspaceInstalledPackage = (packageName, version = '1.0.0') => {
    const pnpmPackageDir = path.join(
      workspaceRoot,
      'node_modules',
      '.pnpm',
      `${packageName.replace('/', '+')}@${version}`,
      'node_modules',
      ...packageName.split('/'),
    );

    mkdirSync(pnpmPackageDir, { recursive: true });
    writeFileSync(
      path.join(pnpmPackageDir, 'package.json'),
      JSON.stringify({ name: packageName, version }, null, 2),
      'utf8',
    );

    return pnpmPackageDir;
  };

  mkdirSync(workspaceRoot, { recursive: true });
  writeFileSync(
    path.join(workspaceRoot, 'package.json'),
    JSON.stringify({ name: '@sdkwork/agentstudio-workspace' }, null, 2),
    'utf8',
  );
  writeFileSync(path.join(workspaceRoot, 'pnpm-workspace.yaml'), 'packages: []\n', 'utf8');

  mkdirSync(sharedAppSdkRoot, { recursive: true });
  writeFileSync(
    path.join(sharedAppSdkRoot, 'package.json'),
    JSON.stringify(
      {
        name: '@sdkwork/iam-app-sdk',
        dependencies: {
          '@sdkwork/sdk-common': '^1.0.2',
        },
        devDependencies: {
          '@types/node': '^20.0.0',
          typescript: '^5.3.0',
          vite: '^7.0.0',
          'vite-plugin-dts': '^4.0.0',
        },
      },
      null,
      2,
    ),
    'utf8',
  );

  mkdirSync(path.join(sharedSdkCommonRoot, 'dist'), { recursive: true });
  writeFileSync(
    path.join(sharedSdkCommonRoot, 'package.json'),
    JSON.stringify({ name: '@sdkwork/sdk-common', version: '1.0.2' }, null, 2),
    'utf8',
  );
  writeFileSync(path.join(sharedSdkCommonRoot, 'dist', 'index.js'), 'export {};\n', 'utf8');

  const expectedTargets = new Map([
    ['@sdkwork/sdk-common', sharedSdkCommonRoot],
    ['@types/node', writeWorkspaceInstalledPackage('@types/node', '20.19.39')],
    ['typescript', writeWorkspaceInstalledPackage('typescript', '6.0.2')],
    ['vite', writeWorkspaceInstalledPackage('vite', '7.3.1')],
    ['vite-plugin-dts', writeWorkspaceInstalledPackage('vite-plugin-dts', '4.5.4')],
  ]);

  try {
    const repairedPackages = helper.ensurePackageDependencyLinks(sharedAppSdkRoot, workspaceRoot, {
      localPackageRoots: {
        '@sdkwork/sdk-common': sharedSdkCommonRoot,
      },
    });

    assert.deepEqual(
      repairedPackages.sort(),
      Array.from(expectedTargets.keys()).sort(),
    );

    for (const [packageName, expectedTarget] of expectedTargets) {
      const linkPath = path.join(sharedAppSdkRoot, 'node_modules', ...packageName.split('/'));

      assert.equal(existsSync(linkPath), true, `missing link for ${packageName}`);
      assert.equal(
        realpathSync(linkPath),
        realpathSync(expectedTarget),
        `unexpected target for ${packageName}`,
      );
      assert.equal(
        helper.resolveWorkspaceInstalledPackageRoot(packageName, workspaceRoot),
        packageName === '@sdkwork/sdk-common' ? null : expectedTarget,
      );
    }
  } finally {
    rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('shared sdk package preparation preserves existing package-local dependency installs while repairing only missing links', async () => {
  const helperPath = path.join(rootDir, 'scripts', 'prepare-shared-sdk-packages.mjs');
  const helper = await import(pathToFileURL(helperPath).href);

  const tempRoot = mkdtempSync(path.join(os.tmpdir(), 'claw-shared-sdk-preserve-links-'));
  const workspaceRoot = path.join(tempRoot, 'apps', 'agent-studio');
  const sharedAppSdkRoot = path.join(
    tempRoot,
    'sdkwork-appbase',
    'sdks',
    'sdkwork-iam-app-sdk',
    'sdkwork-iam-app-sdk-typescript',
    'generated',
    'server-openapi',
  );
  const sharedSdkCommonRoot = path.join(
    tempRoot,
    'sdk',
    'sdkwork-sdk-commons',
    'sdkwork-sdk-common-typescript',
  );

  const writeWorkspaceInstalledPackage = (packageName, version = '1.0.0') => {
    const pnpmPackageDir = path.join(
      workspaceRoot,
      'node_modules',
      '.pnpm',
      `${packageName.replace('/', '+')}@${version}`,
      'node_modules',
      ...packageName.split('/'),
    );

    mkdirSync(pnpmPackageDir, { recursive: true });
    writeFileSync(
      path.join(pnpmPackageDir, 'package.json'),
      JSON.stringify({ name: packageName, version }, null, 2),
      'utf8',
    );

    return pnpmPackageDir;
  };

  mkdirSync(workspaceRoot, { recursive: true });
  writeFileSync(
    path.join(workspaceRoot, 'package.json'),
    JSON.stringify({ name: '@sdkwork/agentstudio-workspace' }, null, 2),
    'utf8',
  );
  writeFileSync(path.join(workspaceRoot, 'pnpm-workspace.yaml'), 'packages: []\n', 'utf8');

  mkdirSync(sharedAppSdkRoot, { recursive: true });
  writeFileSync(
    path.join(sharedAppSdkRoot, 'package.json'),
    JSON.stringify(
      {
        name: '@sdkwork/iam-app-sdk',
        dependencies: {
          '@sdkwork/sdk-common': '^1.0.2',
        },
        devDependencies: {
          '@types/node': '^20.0.0',
          typescript: '^5.3.0',
        },
      },
      null,
      2,
    ),
    'utf8',
  );

  mkdirSync(sharedSdkCommonRoot, { recursive: true });
  writeFileSync(
    path.join(sharedSdkCommonRoot, 'package.json'),
    JSON.stringify({ name: '@sdkwork/sdk-common', version: '1.0.2' }, null, 2),
    'utf8',
  );

  const existingTypeScriptInstall = path.join(
    sharedAppSdkRoot,
    'node_modules',
    'typescript',
  );
  mkdirSync(existingTypeScriptInstall, { recursive: true });
  writeFileSync(
    path.join(existingTypeScriptInstall, 'package.json'),
    JSON.stringify({ name: 'typescript', version: '5.3.0-local' }, null, 2),
    'utf8',
  );

  writeWorkspaceInstalledPackage('@types/node', '20.19.39');
  writeWorkspaceInstalledPackage('typescript', '6.0.2');

  try {
    const repairedPackages = helper.ensurePackageDependencyLinks(sharedAppSdkRoot, workspaceRoot, {
      localPackageRoots: {
        '@sdkwork/sdk-common': sharedSdkCommonRoot,
      },
    });

    assert.deepEqual(repairedPackages.sort(), ['@sdkwork/sdk-common', '@types/node']);
    assert.equal(
      readFileSync(path.join(existingTypeScriptInstall, 'package.json'), 'utf8').includes(
        '5.3.0-local',
      ),
      true,
    );
    assert.equal(
      realpathSync(path.join(sharedAppSdkRoot, 'node_modules', '@sdkwork', 'sdk-common')),
      realpathSync(sharedSdkCommonRoot),
    );
  } finally {
    rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('shared sdk package preparation resolves pnpm virtual store packages even when pnpm shortens long directory names', async () => {
  const helperPath = path.join(rootDir, 'scripts', 'prepare-shared-sdk-packages.mjs');
  const helper = await import(pathToFileURL(helperPath).href);

  const tempRoot = mkdtempSync(path.join(os.tmpdir(), 'claw-shared-sdk-truncated-pnpm-root-'));
  const workspaceRoot = path.join(tempRoot, 'apps', 'agent-studio');
  const shortenedStoreDir = path.join(
    workspaceRoot,
    'node_modules',
    '.pnpm',
    '@typescript-eslint+eslint-p_0b8888e8f4d6444f0cae34f670a09065',
    'node_modules',
    '@typescript-eslint',
    'eslint-plugin',
  );

  mkdirSync(workspaceRoot, { recursive: true });
  writeFileSync(
    path.join(workspaceRoot, 'package.json'),
    JSON.stringify({ name: '@sdkwork/agentstudio-workspace' }, null, 2),
    'utf8',
  );
  writeFileSync(path.join(workspaceRoot, 'pnpm-workspace.yaml'), 'packages: []\n', 'utf8');
  mkdirSync(shortenedStoreDir, { recursive: true });
  writeFileSync(
    path.join(shortenedStoreDir, 'package.json'),
    JSON.stringify(
      {
        name: '@typescript-eslint/eslint-plugin',
        version: '8.58.0',
      },
      null,
      2,
    ),
    'utf8',
  );

  try {
    assert.equal(
      helper.resolveWorkspaceInstalledPackageRoot('@typescript-eslint/eslint-plugin', workspaceRoot),
      shortenedStoreDir,
    );
  } finally {
    rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('shared sdk package preparation can skip devDependency hydration for packages that do not need rebuilding', async () => {
  const helperPath = path.join(rootDir, 'scripts', 'prepare-shared-sdk-packages.mjs');
  const helper = await import(pathToFileURL(helperPath).href);

  const tempRoot = mkdtempSync(path.join(os.tmpdir(), 'claw-shared-sdk-runtime-links-'));
  const workspaceRoot = path.join(tempRoot, 'apps', 'agent-studio');
  const packageRoot = path.join(tempRoot, 'sdk', 'runtime-only-package');
  const localDependencyRoot = path.join(tempRoot, 'sdk', 'shared-runtime-dependency');

  mkdirSync(workspaceRoot, { recursive: true });
  writeFileSync(
    path.join(workspaceRoot, 'package.json'),
    JSON.stringify({ name: '@sdkwork/agentstudio-workspace' }, null, 2),
    'utf8',
  );
  writeFileSync(path.join(workspaceRoot, 'pnpm-workspace.yaml'), 'packages: []\n', 'utf8');

  mkdirSync(packageRoot, { recursive: true });
  writeFileSync(
    path.join(packageRoot, 'package.json'),
    JSON.stringify(
      {
        name: '@sdkwork/runtime-only',
        dependencies: {
          '@sdkwork/shared-runtime': '^1.0.0',
        },
        devDependencies: {
          'missing-build-tool': '^1.0.0',
        },
      },
      null,
      2,
    ),
    'utf8',
  );

  mkdirSync(localDependencyRoot, { recursive: true });
  writeFileSync(
    path.join(localDependencyRoot, 'package.json'),
    JSON.stringify({ name: '@sdkwork/shared-runtime', version: '1.0.0' }, null, 2),
    'utf8',
  );

  try {
    const repairedPackages = helper.ensurePackageDependencyLinks(packageRoot, workspaceRoot, {
      includeDevDependencies: false,
      localPackageRoots: {
        '@sdkwork/shared-runtime': localDependencyRoot,
      },
    });

    assert.deepEqual(repairedPackages, ['@sdkwork/shared-runtime']);
    assert.equal(
      realpathSync(path.join(packageRoot, 'node_modules', '@sdkwork', 'shared-runtime')),
      realpathSync(localDependencyRoot),
    );
    assert.equal(
      existsSync(path.join(packageRoot, 'node_modules', 'missing-build-tool')),
      false,
    );
  } finally {
    rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('shared sdk package preparation can hydrate peer dependencies for linked source packages', async () => {
  const helperPath = path.join(rootDir, 'scripts', 'prepare-shared-sdk-packages.mjs');
  const helper = await import(pathToFileURL(helperPath).href);

  const tempRoot = mkdtempSync(path.join(os.tmpdir(), 'claw-shared-sdk-peer-links-'));
  const workspaceRoot = path.join(tempRoot, 'apps', 'agent-studio');
  const packageRoot = path.join(tempRoot, 'apps', 'sdkwork-appbase', 'packages', 'pc-react', 'intelligence', 'sdkwork-local-api-proxy');

  const writeWorkspaceInstalledPackage = (packageName, version = '1.0.0') => {
    const pnpmPackageDir = path.join(
      workspaceRoot,
      'node_modules',
      '.pnpm',
      `${packageName.replace('/', '+')}@${version}`,
      'node_modules',
      ...packageName.split('/'),
    );

    mkdirSync(pnpmPackageDir, { recursive: true });
    writeFileSync(
      path.join(pnpmPackageDir, 'package.json'),
      JSON.stringify({ name: packageName, version }, null, 2),
      'utf8',
    );

    return pnpmPackageDir;
  };

  mkdirSync(workspaceRoot, { recursive: true });
  writeFileSync(
    path.join(workspaceRoot, 'package.json'),
    JSON.stringify({ name: '@sdkwork/agentstudio-workspace' }, null, 2),
    'utf8',
  );
  writeFileSync(path.join(workspaceRoot, 'pnpm-workspace.yaml'), 'packages: []\n', 'utf8');

  mkdirSync(packageRoot, { recursive: true });
  writeFileSync(
    path.join(packageRoot, 'package.json'),
    JSON.stringify(
      {
        name: '@sdkwork/local-api-proxy',
        peerDependencies: {
          '@sdkwork/ui-pc-react': '*',
          react: '>=18.2.0 <20.0.0',
          'react-dom': '>=18.2.0 <20.0.0',
        },
        peerDependenciesMeta: {
          '@sdkwork/ui-pc-react': {
            optional: true,
          },
        },
      },
      null,
      2,
    ),
    'utf8',
  );

  const reactPackageRoot = writeWorkspaceInstalledPackage('react', '19.2.4');
  const reactDomPackageRoot = writeWorkspaceInstalledPackage('react-dom', '19.2.4');

  try {
    const repairedPackages = helper.ensurePackageDependencyLinks(packageRoot, workspaceRoot, {
      includeDependencies: false,
      includeDevDependencies: false,
      includePeerDependencies: true,
    });

    assert.deepEqual(repairedPackages.sort(), ['react', 'react-dom']);
    assert.equal(
      realpathSync(path.join(packageRoot, 'node_modules', 'react')),
      realpathSync(reactPackageRoot),
    );
    assert.equal(
      realpathSync(path.join(packageRoot, 'node_modules', 'react-dom')),
      realpathSync(reactDomPackageRoot),
    );
    assert.equal(
      existsSync(path.join(packageRoot, 'node_modules', '@sdkwork', 'ui-pc-react')),
      false,
    );
  } finally {
    rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('shared sdk package preparation skips optional external source package mutation by default', async () => {
  const helperPath = path.join(rootDir, 'scripts', 'prepare-shared-sdk-packages.mjs');
  const helper = await import(pathToFileURL(helperPath).href);

  const tempRoot = mkdtempSync(path.join(os.tmpdir(), 'claw-shared-sdk-optional-skip-'));
  const workspaceRoot = path.join(tempRoot, 'apps', 'agent-studio');
  const sharedSdkCommonRoot = path.join(
    tempRoot,
    'apps',
    'sdkwork-sdk-commons',
    'sdkwork-sdk-common-typescript',
  );
  const sharedAppSdkRoot = path.join(
    tempRoot,
    'apps',
    'sdkwork-appbase',
    'sdks',
    'sdkwork-iam-app-sdk',
    'sdkwork-iam-app-sdk-typescript',
    'generated',
    'server-openapi',
  );
  const sharedMessagingAppSdkRoot = path.join(
    tempRoot,
    'apps',
    'sdkwork-messaging',
    'sdks',
    'sdkwork-messaging-app-sdk',
    'sdkwork-messaging-app-sdk-typescript',
    'generated',
    'server-openapi',
  );
  const sharedCorePcReactRoot = path.join(
    tempRoot,
    'apps',
    'sdkwork-core',
    'sdkwork-core-pc-react',
  );
  const sharedLocalApiProxyRoot = path.join(
    tempRoot,
    'apps',
    'sdkwork-local-router',
    'packages',
    'pc-react',
    'intelligence',
    'sdkwork-local-api-proxy',
  );
  const sharedImSdkRoot = path.join(
    tempRoot,
    'apps',
    'sdkwork-im',
    'sdks',
    'sdkwork-im-sdk',
    'sdkwork-im-sdk-typescript',
  );
  const sharedRtcSdkRoot = path.join(
    tempRoot,
    'apps',
    'sdkwork-rtc',
    'sdks',
    'sdkwork-rtc-sdk',
    'sdkwork-rtc-sdk-typescript',
  );

  const writePackage = (packageRoot, manifest) => {
    mkdirSync(path.join(packageRoot, 'dist'), { recursive: true });
    writeFileSync(
      path.join(packageRoot, 'package.json'),
      JSON.stringify(manifest, null, 2),
      'utf8',
    );
    writeFileSync(path.join(packageRoot, 'dist', 'index.js'), 'export {};\n', 'utf8');
  };
  const writeWorkspaceInstalledPackage = (packageName, version = '1.0.0') => {
    const pnpmPackageDir = path.join(
      workspaceRoot,
      'node_modules',
      '.pnpm',
      `${packageName.replace('/', '+')}@${version}`,
      'node_modules',
      ...packageName.split('/'),
    );

    mkdirSync(pnpmPackageDir, { recursive: true });
    writeFileSync(
      path.join(pnpmPackageDir, 'package.json'),
      JSON.stringify({ name: packageName, version }, null, 2),
      'utf8',
    );

    return pnpmPackageDir;
  };

  mkdirSync(workspaceRoot, { recursive: true });
  writeFileSync(
    path.join(workspaceRoot, 'package.json'),
    JSON.stringify({ name: '@sdkwork/agentstudio-workspace' }, null, 2),
    'utf8',
  );
  writeFileSync(path.join(workspaceRoot, 'pnpm-workspace.yaml'), 'packages: []\n', 'utf8');

  writePackage(sharedSdkCommonRoot, { name: '@sdkwork/sdk-common', version: '1.0.2' });
  writePackage(sharedAppSdkRoot, {
    name: '@sdkwork/iam-app-sdk',
    version: '0.1.0',
    dependencies: {
      '@sdkwork/sdk-common': '^1.0.2',
    },
  });
  writePackage(sharedMessagingAppSdkRoot, {
    name: '@sdkwork/messaging-app-sdk',
    version: '0.1.0',
    dependencies: {
      '@sdkwork/sdk-common': '^1.0.2',
    },
  });
  writePackage(sharedCorePcReactRoot, {
    name: '@sdkwork/core-pc-react',
    version: '0.1.1',
    dependencies: {
      '@sdkwork/iam-app-sdk': '^0.1.0',
      '@sdkwork/messaging-app-sdk': '^0.1.0',
      '@sdkwork/sdk-common': '^1.0.2',
      '@sdkwork/im-sdk': '^0.1.1',
      '@sdkwork/rtc-sdk': '^0.1.1',
    },
    peerDependencies: {
      react: '>=18.2.0',
      'react-dom': '>=18.2.0',
    },
  });
  writePackage(sharedLocalApiProxyRoot, {
    name: '@sdkwork/local-api-proxy',
    version: '0.1.0',
    peerDependencies: {
      '@sdkwork/core-pc-react': '*',
      react: '>=18.2.0 <20.0.0',
      'react-dom': '>=18.2.0 <20.0.0',
    },
    peerDependenciesMeta: {
      '@sdkwork/core-pc-react': {
        optional: true,
      },
    },
  });
  writePackage(sharedImSdkRoot, {
    name: '@sdkwork/im-sdk',
    version: '0.1.1',
    dependencies: {
      '@sdkwork/sdk-common': '^1.0.2',
    },
  });
  writePackage(sharedRtcSdkRoot, {
    name: '@sdkwork/rtc-sdk',
    version: '0.1.1',
    peerDependencies: {
      '@sdkwork/im-sdk': '^0.1.1',
    },
    peerDependenciesMeta: {
      '@sdkwork/im-sdk': {
        optional: true,
      },
    },
  });

  writeWorkspaceInstalledPackage('react', '19.2.4');
  writeWorkspaceInstalledPackage('react-dom', '19.2.4');
  writeWorkspaceInstalledPackage('@types/react', '19.2.14');
  writeWorkspaceInstalledPackage('@types/react-dom', '19.2.3');

  try {
    helper.prepareSharedSdkPackages({
      currentWorkingDir: workspaceRoot,
      env: { SDKWORK_SHARED_SDK_MODE: 'source' },
    });

    assert.equal(
      existsSync(path.join(sharedCorePcReactRoot, 'node_modules')),
      false,
      'default app builds must not mutate optional core pc react sibling sources',
    );
    assert.equal(
      existsSync(path.join(sharedLocalApiProxyRoot, 'node_modules')),
      false,
      'default app builds must not mutate optional local api proxy sibling sources',
    );
    assert.equal(
      existsSync(path.join(sharedImSdkRoot, 'node_modules')),
      false,
      'default app builds must not mutate optional IM SDK sibling sources',
    );
    assert.equal(
      existsSync(path.join(sharedRtcSdkRoot, 'node_modules')),
      false,
      'default app builds must not mutate optional RTC SDK sibling sources',
    );
    assert.equal(
      realpathSync(path.join(sharedAppSdkRoot, 'node_modules', '@sdkwork', 'sdk-common')),
      realpathSync(sharedSdkCommonRoot),
      'required appbase app sdk preparation must remain active for app builds',
    );
    assert.equal(
      realpathSync(path.join(sharedMessagingAppSdkRoot, 'node_modules', '@sdkwork', 'sdk-common')),
      realpathSync(sharedSdkCommonRoot),
      'required messaging app sdk preparation must remain active for app builds',
    );
  } finally {
    rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('shared sdk package preparation hydrates local api proxy peers for clean release workspaces', async () => {
  const helperPath = path.join(rootDir, 'scripts', 'prepare-shared-sdk-packages.mjs');
  const helper = await import(pathToFileURL(helperPath).href);

  const tempRoot = mkdtempSync(path.join(os.tmpdir(), 'claw-shared-sdk-local-proxy-peers-'));
  const workspaceRoot = path.join(tempRoot, 'apps', 'agent-studio');
  const sharedSdkCommonRoot = path.join(
    tempRoot,
    'apps',
    'sdkwork-sdk-commons',
    'sdkwork-sdk-common-typescript',
  );
  const sharedAppSdkRoot = path.join(
    tempRoot,
    'apps',
    'sdkwork-appbase',
    'sdks',
    'sdkwork-iam-app-sdk',
    'sdkwork-iam-app-sdk-typescript',
    'generated',
    'server-openapi',
  );
  const sharedMessagingAppSdkRoot = path.join(
    tempRoot,
    'apps',
    'sdkwork-messaging',
    'sdks',
    'sdkwork-messaging-app-sdk',
    'sdkwork-messaging-app-sdk-typescript',
    'generated',
    'server-openapi',
  );
  const sharedCorePcReactRoot = path.join(
    tempRoot,
    'apps',
    'sdkwork-core',
    'sdkwork-core-pc-react',
  );
  const sharedLocalApiProxyRoot = path.join(
    tempRoot,
    'apps',
    'sdkwork-local-router',
    'packages',
    'pc-react',
    'intelligence',
    'sdkwork-local-api-proxy',
  );

  const writePackage = (packageRoot, manifest) => {
    mkdirSync(path.join(packageRoot, 'dist'), { recursive: true });
    writeFileSync(
      path.join(packageRoot, 'package.json'),
      JSON.stringify(manifest, null, 2),
      'utf8',
    );
    writeFileSync(path.join(packageRoot, 'dist', 'index.js'), 'export {};\n', 'utf8');
  };
  const writeWorkspaceInstalledPackage = (packageName, version = '1.0.0') => {
    const pnpmPackageDir = path.join(
      workspaceRoot,
      'node_modules',
      '.pnpm',
      `${packageName.replace('/', '+')}@${version}`,
      'node_modules',
      ...packageName.split('/'),
    );

    mkdirSync(pnpmPackageDir, { recursive: true });
    writeFileSync(
      path.join(pnpmPackageDir, 'package.json'),
      JSON.stringify({ name: packageName, version }, null, 2),
      'utf8',
    );

    return pnpmPackageDir;
  };

  mkdirSync(workspaceRoot, { recursive: true });
  writeFileSync(
    path.join(workspaceRoot, 'package.json'),
    JSON.stringify({ name: '@sdkwork/agentstudio-workspace' }, null, 2),
    'utf8',
  );
  writeFileSync(path.join(workspaceRoot, 'pnpm-workspace.yaml'), 'packages: []\n', 'utf8');

  writePackage(sharedSdkCommonRoot, { name: '@sdkwork/sdk-common', version: '1.0.2' });
  writePackage(sharedAppSdkRoot, {
    name: '@sdkwork/iam-app-sdk',
    version: '0.1.0',
    dependencies: {
      '@sdkwork/sdk-common': '^1.0.2',
    },
  });
  writePackage(sharedMessagingAppSdkRoot, {
    name: '@sdkwork/messaging-app-sdk',
    version: '0.1.0',
    dependencies: {
      '@sdkwork/sdk-common': '^1.0.2',
    },
  });
  writePackage(sharedCorePcReactRoot, {
    name: '@sdkwork/core-pc-react',
    version: '0.1.1',
    dependencies: {
      '@sdkwork/iam-app-sdk': '^0.1.0',
      '@sdkwork/messaging-app-sdk': '^0.1.0',
      '@sdkwork/sdk-common': '^1.0.2',
    },
    peerDependencies: {
      react: '>=18.2.0',
      'react-dom': '>=18.2.0',
    },
  });
  writePackage(sharedLocalApiProxyRoot, {
    name: '@sdkwork/local-api-proxy',
    version: '0.1.0',
    peerDependencies: {
      '@sdkwork/core-pc-react': '*',
      '@sdkwork/ui-pc-react': '*',
      react: '>=18.2.0 <20.0.0',
      'react-dom': '>=18.2.0 <20.0.0',
    },
    peerDependenciesMeta: {
      '@sdkwork/core-pc-react': {
        optional: true,
      },
      '@sdkwork/ui-pc-react': {
        optional: true,
      },
    },
  });

  const reactPackageRoot = writeWorkspaceInstalledPackage('react', '19.2.4');
  const reactDomPackageRoot = writeWorkspaceInstalledPackage('react-dom', '19.2.4');
  const reactTypesPackageRoot = writeWorkspaceInstalledPackage('@types/react', '19.2.14');
  const reactDomTypesPackageRoot = writeWorkspaceInstalledPackage('@types/react-dom', '19.2.3');

  try {
    helper.prepareSharedSdkPackages({
      currentWorkingDir: workspaceRoot,
      env: {
        SDKWORK_SHARED_SDK_MODE: 'source',
        SDKWORK_PREPARE_OPTIONAL_SHARED_SDKS: 'true',
      },
    });

    assert.equal(
      realpathSync(path.join(sharedLocalApiProxyRoot, 'node_modules', 'react')),
      realpathSync(reactPackageRoot),
    );
    assert.equal(
      realpathSync(path.join(sharedLocalApiProxyRoot, 'node_modules', 'react-dom')),
      realpathSync(reactDomPackageRoot),
    );
    assert.equal(
      realpathSync(path.join(sharedLocalApiProxyRoot, 'node_modules', '@types', 'react')),
      realpathSync(reactTypesPackageRoot),
    );
    assert.equal(
      realpathSync(path.join(sharedLocalApiProxyRoot, 'node_modules', '@types', 'react-dom')),
      realpathSync(reactDomTypesPackageRoot),
    );
    assert.equal(
      realpathSync(path.join(sharedLocalApiProxyRoot, 'node_modules', '@sdkwork', 'core-pc-react')),
      realpathSync(sharedCorePcReactRoot),
    );
    assert.equal(
      existsSync(path.join(sharedLocalApiProxyRoot, 'node_modules', '@sdkwork', 'ui-pc-react')),
      false,
    );
  } finally {
    rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('shared sdk package preparation hydrates core pc react SDK dependencies for clean release workspaces', async () => {
  const helperPath = path.join(rootDir, 'scripts', 'prepare-shared-sdk-packages.mjs');
  const helper = await import(pathToFileURL(helperPath).href);

  const tempRoot = mkdtempSync(path.join(os.tmpdir(), 'claw-shared-sdk-core-deps-'));
  const workspaceRoot = path.join(tempRoot, 'apps', 'agent-studio');
  const sharedSdkCommonRoot = path.join(
    tempRoot,
    'apps',
    'sdkwork-sdk-commons',
    'sdkwork-sdk-common-typescript',
  );
  const sharedAppSdkRoot = path.join(
    tempRoot,
    'apps',
    'sdkwork-appbase',
    'sdks',
    'sdkwork-iam-app-sdk',
    'sdkwork-iam-app-sdk-typescript',
    'generated',
    'server-openapi',
  );
  const sharedMessagingAppSdkRoot = path.join(
    tempRoot,
    'apps',
    'sdkwork-messaging',
    'sdks',
    'sdkwork-messaging-app-sdk',
    'sdkwork-messaging-app-sdk-typescript',
    'generated',
    'server-openapi',
  );
  const sharedCorePcReactRoot = path.join(
    tempRoot,
    'apps',
    'sdkwork-core',
    'sdkwork-core-pc-react',
  );
  const sharedLocalApiProxyRoot = path.join(
    tempRoot,
    'apps',
    'sdkwork-local-router',
    'packages',
    'pc-react',
    'intelligence',
    'sdkwork-local-api-proxy',
  );
  const sharedImSdkRoot = path.join(
    tempRoot,
    'apps',
    'sdkwork-im',
    'sdks',
    'sdkwork-im-sdk',
    'sdkwork-im-sdk-typescript',
  );
  const sharedRtcSdkRoot = path.join(
    tempRoot,
    'apps',
    'sdkwork-rtc',
    'sdks',
    'sdkwork-rtc-sdk',
    'sdkwork-rtc-sdk-typescript',
  );

  const writePackage = (packageRoot, manifest) => {
    mkdirSync(path.join(packageRoot, 'dist'), { recursive: true });
    writeFileSync(
      path.join(packageRoot, 'package.json'),
      JSON.stringify(manifest, null, 2),
      'utf8',
    );
    writeFileSync(path.join(packageRoot, 'dist', 'index.js'), 'export {};\n', 'utf8');
  };
  const writeWorkspaceInstalledPackage = (packageName, version = '1.0.0') => {
    const pnpmPackageDir = path.join(
      workspaceRoot,
      'node_modules',
      '.pnpm',
      `${packageName.replace('/', '+')}@${version}`,
      'node_modules',
      ...packageName.split('/'),
    );

    mkdirSync(pnpmPackageDir, { recursive: true });
    writeFileSync(
      path.join(pnpmPackageDir, 'package.json'),
      JSON.stringify({ name: packageName, version }, null, 2),
      'utf8',
    );

    return pnpmPackageDir;
  };

  mkdirSync(workspaceRoot, { recursive: true });
  writeFileSync(
    path.join(workspaceRoot, 'package.json'),
    JSON.stringify({ name: '@sdkwork/agentstudio-workspace' }, null, 2),
    'utf8',
  );
  writeFileSync(path.join(workspaceRoot, 'pnpm-workspace.yaml'), 'packages: []\n', 'utf8');

  writePackage(sharedSdkCommonRoot, { name: '@sdkwork/sdk-common', version: '1.0.2' });
  writePackage(sharedAppSdkRoot, {
    name: '@sdkwork/iam-app-sdk',
    version: '0.1.0',
    dependencies: {
      '@sdkwork/sdk-common': '^1.0.2',
    },
  });
  writePackage(sharedMessagingAppSdkRoot, {
    name: '@sdkwork/messaging-app-sdk',
    version: '0.1.0',
    dependencies: {
      '@sdkwork/sdk-common': '^1.0.2',
    },
  });
  writePackage(sharedImSdkRoot, {
    name: '@sdkwork/im-sdk',
    version: '0.1.1',
    dependencies: {
      '@sdkwork/sdk-common': '^1.0.2',
    },
  });
  writePackage(sharedRtcSdkRoot, {
    name: '@sdkwork/rtc-sdk',
    version: '0.1.1',
    dependencies: {
      '@sdkwork/im-sdk': '^0.1.1',
    },
  });
  writePackage(sharedCorePcReactRoot, {
    name: '@sdkwork/core-pc-react',
    version: '0.1.1',
    dependencies: {
      '@sdkwork/iam-app-sdk': '^0.1.0',
      '@sdkwork/messaging-app-sdk': '^0.1.0',
      '@sdkwork/sdk-common': '^1.0.2',
      '@sdkwork/im-sdk': '^0.1.1',
      '@sdkwork/rtc-sdk': '^0.1.1',
    },
    peerDependencies: {
      react: '>=18.2.0',
      'react-dom': '>=18.2.0',
    },
  });
  writePackage(sharedLocalApiProxyRoot, {
    name: '@sdkwork/local-api-proxy',
    version: '0.1.0',
    peerDependencies: {
      react: '>=18.2.0 <20.0.0',
      'react-dom': '>=18.2.0 <20.0.0',
    },
  });

  writeWorkspaceInstalledPackage('react', '19.2.4');
  writeWorkspaceInstalledPackage('react-dom', '19.2.4');
  writeWorkspaceInstalledPackage('@types/react', '19.2.14');
  writeWorkspaceInstalledPackage('@types/react-dom', '19.2.3');

  try {
    helper.prepareSharedSdkPackages({
      currentWorkingDir: workspaceRoot,
      env: {
        SDKWORK_SHARED_SDK_MODE: 'source',
        SDKWORK_PREPARE_OPTIONAL_SHARED_SDKS: 'true',
      },
    });

    assert.equal(
      realpathSync(path.join(sharedCorePcReactRoot, 'node_modules', '@sdkwork', 'appbase-app-sdk')),
      realpathSync(sharedAppSdkRoot),
    );
    assert.equal(
      realpathSync(path.join(sharedCorePcReactRoot, 'node_modules', '@sdkwork', 'messaging-app-sdk')),
      realpathSync(sharedMessagingAppSdkRoot),
    );
    assert.equal(
      realpathSync(path.join(sharedCorePcReactRoot, 'node_modules', '@sdkwork', 'sdk-common')),
      realpathSync(sharedSdkCommonRoot),
    );
    assert.equal(
      realpathSync(path.join(sharedCorePcReactRoot, 'node_modules', '@sdkwork', 'im-sdk')),
      realpathSync(sharedImSdkRoot),
    );
    assert.equal(
      realpathSync(path.join(sharedCorePcReactRoot, 'node_modules', '@sdkwork', 'rtc-sdk')),
      realpathSync(sharedRtcSdkRoot),
    );
  } finally {
    rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('shared sdk package preparation exposes a generator root for relocated IM and RTC release sources', async () => {
  const helperPath = path.join(rootDir, 'scripts', 'prepare-shared-sdk-packages.mjs');
  const helper = await import(pathToFileURL(helperPath).href);

  assert.equal(typeof helper.createSharedSdkBuildEnv, 'function');

  const tempRoot = mkdtempSync(path.join(os.tmpdir(), 'claw-shared-sdk-generator-root-'));
  const workspaceRoot = path.join(tempRoot, 'apps', 'agent-studio');
  const expectedGeneratorRoot = path.join(tempRoot, 'apps', 'sdkwork-sdk-generator');
  const explicitGeneratorRoot = path.join(tempRoot, 'custom-generator-root');

  try {
    mkdirSync(workspaceRoot, { recursive: true });
    mkdirSync(expectedGeneratorRoot, { recursive: true });
    mkdirSync(explicitGeneratorRoot, { recursive: true });

    assert.equal(
      helper.createSharedSdkBuildEnv(
        {
          workspaceRoot,
          canonicalWorkspaceRoot: workspaceRoot,
        },
        {},
      ).SDKWORK_GENERATOR_ROOT,
      path.resolve(expectedGeneratorRoot),
      'local release builds should use the real workspace generator when it exists',
    );

    rmSync(expectedGeneratorRoot, { recursive: true, force: true });

    assert.equal(
      helper.createSharedSdkBuildEnv(
        {
          workspaceRoot,
          canonicalWorkspaceRoot: workspaceRoot,
        },
        {},
      ).SDKWORK_GENERATOR_ROOT,
      path.resolve(workspaceRoot),
      'GitHub release clean-room builds should fall back to the installed agent-studio workspace dependencies',
    );

    assert.equal(
      helper.createSharedSdkBuildEnv(
        {
          workspaceRoot,
          canonicalWorkspaceRoot: workspaceRoot,
        },
        {
          SDKWORK_GENERATOR_ROOT: explicitGeneratorRoot,
        },
      ).SDKWORK_GENERATOR_ROOT,
      path.resolve(explicitGeneratorRoot),
      'an explicit SDKWORK_GENERATOR_ROOT must remain authoritative for SDK release builds',
    );
  } finally {
    rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('shared sdk release pins include the IM TypeScript rootDir clean-room build fix', () => {
  const releaseSources = JSON.parse(read('config/shared-sdk-release-sources.json'));

  assert.equal(
    releaseSources.sources?.['im-sdk']?.ref,
    '12abdbd638d499194e89cf966ed0aa4cd103f19b',
    'the IM SDK release pin must include the TypeScript root tsconfig fix required by TS 6 clean-room package builds',
  );
});

test('git-backed shared sdk source detection resolves origin from nested directories inside an existing git checkout', async () => {
  const helperPath = path.join(rootDir, 'scripts', 'prepare-shared-sdk-git-sources.mjs');
  const helper = await import(pathToFileURL(helperPath).href);
  const helperSource = read('scripts/prepare-shared-sdk-git-sources.mjs');

  assert.equal(typeof helper.isGitCheckout, 'function');
  assert.equal(typeof helper.detectExistingOriginUrl, 'function');
  assert.match(
    helperSource,
    /if \(path\.resolve\(process\.argv\[1\] \?\? ''\) === __filename\) \{\s*try \{\s*main\(\);\s*\} catch \(error\) \{\s*console\.error\(error instanceof Error \? error\.message : String\(error\)\);\s*process\.exit\(1\);\s*\}\s*\}/s,
    'prepare-shared-sdk-git-sources must wrap the CLI entrypoint with a top-level error handler',
  );

  const tempRoot = mkdtempSync(path.join(os.tmpdir(), 'claw-shared-sdk-'));
  const repoRoot = path.join(tempRoot, 'shared-sdk-repo');
  const nestedPackageRoot = path.join(repoRoot, 'packages', 'sdkwork-iam-app-sdk');
  const gitConfigPath = path.join(repoRoot, '.git', 'config');

  mkdirSync(repoRoot, { recursive: true });
  mkdirSync(nestedPackageRoot, { recursive: true });
  mkdirSync(path.dirname(gitConfigPath), { recursive: true });
  writeFileSync(
    gitConfigPath,
    [
      '[core]',
      '\trepositoryformatversion = 0',
      '\tfilemode = false',
      '\tbare = false',
      '\tlogallrefupdates = true',
      '[remote "origin"]',
      '\turl = https://example.com/shared-sdk.git',
      '\tfetch = +refs/heads/*:refs/remotes/origin/*',
      '',
    ].join('\n'),
    'utf8',
  );

  try {
    assert.equal(helper.isGitCheckout(nestedPackageRoot), true);
    assert.equal(
      helper.detectExistingOriginUrl(nestedPackageRoot),
      'https://example.com/shared-sdk.git',
    );
  } finally {
    rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('git-backed shared sdk source helper normalizes local clone repo URLs to file URLs without rewriting remote URLs', async () => {
  const helperPath = path.join(rootDir, 'scripts', 'prepare-shared-sdk-git-sources.mjs');
  const helper = await import(pathToFileURL(helperPath).href);
  const tempRoot = mkdtempSync(path.join(os.tmpdir(), 'claw-shared-sdk-clone-url-'));
  const localRepoRoot = path.join(tempRoot, 'source-repo');

  mkdirSync(localRepoRoot, { recursive: true });

  try {
    assert.equal(typeof helper.resolveGitCloneRepoUrl, 'function');
    assert.equal(
      helper.resolveGitCloneRepoUrl(localRepoRoot),
      pathToFileURL(localRepoRoot).href,
    );
    assert.equal(
      helper.resolveGitCloneRepoUrl('https://example.com/sdkwork/shared-sdk.git'),
      'https://example.com/sdkwork/shared-sdk.git',
    );
    assert.equal(
      helper.resolveGitCloneRepoUrl('git@github.com:sdkwork-ai/sdkwork-core.git'),
      'git@github.com:sdkwork-ai/sdkwork-core.git',
    );
    assert.equal(
      helper.resolveGitCloneRepoUrl(pathToFileURL(localRepoRoot).href),
      pathToFileURL(localRepoRoot).href,
    );
  } finally {
    rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('git-backed shared sdk source helper authenticates private GitHub SDK clones without rewriting logged URLs', async () => {
  const helperPath = path.join(rootDir, 'scripts', 'prepare-shared-sdk-git-sources.mjs');
  const helper = await import(pathToFileURL(helperPath).href);
  const helperSource = read('scripts/prepare-shared-sdk-git-sources.mjs');
  const repoUrl = 'https://github.com/sdkwork-ai/sdkwork-appbase.git';
  const token = 'synthetic-token-for-private-sdk-read';
  const expectedHeader = Buffer.from(`x-access-token:${token}`, 'utf8').toString('base64');

  assert.equal(helper.SHARED_SDK_GITHUB_TOKEN_ENV_VAR, 'SDKWORK_SHARED_SDK_GITHUB_TOKEN');
  assert.equal(typeof helper.resolveGitAuthConfigArgs, 'function');
  assert.equal(typeof helper.formatCommandForError, 'function');
  assert.deepEqual(
    helper.resolveGitAuthConfigArgs(repoUrl, {
      [helper.SHARED_SDK_GITHUB_TOKEN_ENV_VAR]: token,
    }),
    [
      '-c',
      `http.https://github.com/.extraheader=AUTHORIZATION: basic ${expectedHeader}`,
    ],
  );
  assert.deepEqual(
    helper.resolveGitAuthConfigArgs('https://example.com/sdkwork-ai/sdkwork-appbase.git', {
      [helper.SHARED_SDK_GITHUB_TOKEN_ENV_VAR]: token,
    }),
    [],
  );
  assert.equal(
    helper.resolveGitCloneRepoUrl(repoUrl),
    repoUrl,
    'release logs should keep the configured GitHub URL and must not embed tokens in clone URLs',
  );
  assert.equal(
    helper.formatCommandForError('git', [
      '-c',
      `http.https://github.com/.extraheader=AUTHORIZATION: basic ${expectedHeader}`,
      'clone',
      '--depth',
      '1',
      repoUrl,
      '/tmp/sdkwork-appbase',
    ]),
    'git -c http.https://github.com/.extraheader=<redacted> clone --depth 1 https://github.com/sdkwork-ai/sdkwork-appbase.git /tmp/sdkwork-appbase',
  );
  assert.doesNotMatch(
    helper.formatCommandForError('git', [
      '-c',
      `http.https://github.com/.extraheader=AUTHORIZATION: basic ${expectedHeader}`,
      'clone',
      repoUrl,
    ]),
    new RegExp(expectedHeader),
    'git command errors must not leak the base64 encoded GitHub token header',
  );
  assert.doesNotMatch(helper.resolveGitCloneRepoUrl(repoUrl), /synthetic-token-for-private-sdk-read/);
  assert.match(helperSource, /resolveGitAuthConfigArgs\(repoUrl, env\)/);
  assert.match(helperSource, /run\('git', buildGitRemoteArgs\(\['clone'/);
  assert.match(helperSource, /run\('git', buildGitRemoteArgs\(\['-C', repoRoot, 'fetch'/);
  assert.match(helperSource, /run\('git', buildGitRemoteArgs\(\['ls-remote'/);
});

test('git-backed shared sdk source helper parses current SDK family layouts and resolves config-backed package roots', async () => {
  const helperPath = path.join(rootDir, 'scripts', 'prepare-shared-sdk-git-sources.mjs');
  const helper = await import(pathToFileURL(helperPath).href);

  assert.equal(typeof helper.resolveSharedSdkReleaseConfigPath, 'function');
  assert.equal(typeof helper.readSharedSdkReleaseConfig, 'function');
  assert.equal(typeof helper.resolveSourcePackageContainerRoot, 'function');
  assert.equal(typeof helper.resolveSourcePackageRoot, 'function');
  assert.equal(typeof helper.resolveMonorepoSubmoduleRoot, 'function');
  assert.equal(typeof helper.resolveMonorepoPackageRoot, 'function');
  assert.equal(typeof helper.resolveCheckoutRootForRepoUrl, 'function');
  assert.equal(typeof helper.resolvePackageRootForCheckoutRoot, 'function');
  assert.equal(typeof helper.resolveGitCloneRepoUrl, 'function');
  assert.equal(typeof helper.parseGitSubmodulePaths, 'function');
  assert.equal(typeof helper.materializePackageRootFromMonorepo, 'function');
  assert.equal(helper.DEFAULT_SHARED_SDK_APPBASE_APP_REPO_URL, 'https://github.com/sdkwork-ai/sdkwork-appbase.git');
  assert.equal(helper.DEFAULT_SHARED_SDK_COMMON_REPO_URL, 'https://github.com/sdkwork-ai/sdkwork-sdk-commons.git');
  assert.equal(helper.DEFAULT_SHARED_SDK_CORE_REPO_URL, 'https://github.com/sdkwork-ai/sdkwork-core.git');
  assert.equal(helper.DEFAULT_SHARED_SDK_LOCAL_ROUTER_REPO_URL, 'https://github.com/sdkwork-ai/sdkwork-local-router.git');
  assert.equal(helper.DEFAULT_SHARED_SDK_MESSAGING_REPO_URL, 'https://github.com/sdkwork-ai/sdkwork-messaging.git');
  assert.equal(helper.DEFAULT_SHARED_SDK_RELEASE_CONFIG_PATH, 'config/shared-sdk-release-sources.json');
  assert.match(
    read('scripts/prepare-shared-sdk-git-sources.mjs'),
    /advice\.detachedHead=false/,
    'shared sdk git source helper must suppress detached HEAD advice in green release automation logs',
  );

  const repoRoot = path.join(rootDir, '.tmp', 'shared-sdk-layout');
  const spec = {
    repoRoot,
    packageContainerDirName: 'sdks/sdkwork-iam-app-sdk/sdkwork-iam-app-sdk-typescript/generated',
    packageDirName: 'server-openapi',
    monorepoSubmodulePath: 'sdks/sdkwork-iam-app-sdk/sdkwork-iam-app-sdk-typescript/generated',
  };

  assert.equal(
    helper.resolveSourcePackageContainerRoot(spec).replaceAll('\\', '/'),
    path.join(repoRoot, 'sdks', 'sdkwork-iam-app-sdk', 'sdkwork-iam-app-sdk-typescript', 'generated').replaceAll('\\', '/'),
  );
  assert.equal(
    helper.resolveSourcePackageRoot(spec).replaceAll('\\', '/'),
    path.join(repoRoot, 'sdks', 'sdkwork-iam-app-sdk', 'sdkwork-iam-app-sdk-typescript', 'generated', 'server-openapi').replaceAll('\\', '/'),
  );
  assert.equal(
    helper.resolveMonorepoSubmoduleRoot(spec).replaceAll('\\', '/'),
    path.join(repoRoot, 'sdks', 'sdkwork-iam-app-sdk', 'sdkwork-iam-app-sdk-typescript', 'generated').replaceAll('\\', '/'),
  );
  assert.equal(
    helper.resolveMonorepoPackageRoot(spec).replaceAll('\\', '/'),
    path.join(
      repoRoot,
      'sdks',
      'sdkwork-iam-app-sdk',
      'sdkwork-iam-app-sdk-typescript',
      'generated',
      'server-openapi',
    ).replaceAll('\\', '/'),
  );
  assert.equal(
    helper.resolveCheckoutRootForRepoUrl(
      spec,
      'https://github.com/sdkwork-ai/sdkwork-appbase.git',
    ).replaceAll('\\', '/'),
    repoRoot.replaceAll('\\', '/'),
  );
  assert.equal(
    helper.resolveCheckoutRootForRepoUrl(
      spec,
      'https://github.com/sdkwork-ai/server-openapi.git',
    ).replaceAll('\\', '/'),
    path.join(repoRoot, 'sdks', 'sdkwork-iam-app-sdk', 'sdkwork-iam-app-sdk-typescript', 'generated', 'server-openapi').replaceAll('\\', '/'),
  );
  assert.equal(
    helper.resolvePackageRootForCheckoutRoot(
      spec,
      repoRoot,
    ).replaceAll('\\', '/'),
    path.join(repoRoot, 'sdks', 'sdkwork-iam-app-sdk', 'sdkwork-iam-app-sdk-typescript', 'generated', 'server-openapi').replaceAll('\\', '/'),
  );

  const parsedPaths = helper.parseGitSubmodulePaths(`
[submodule "sdkwork-sdk-commons"]
    path = sdkwork-sdk-commons
[submodule "sdkwork-appbase"]
    path = sdkwork-appbase
`);
  assert.deepEqual([...parsedPaths], [
    'sdkwork-sdk-commons',
    'sdkwork-appbase',
  ]);

  const sharedSdkReleaseConfig = helper.readSharedSdkReleaseConfig(rootDir);
  assert.equal(
    path.relative(rootDir, helper.resolveSharedSdkReleaseConfigPath(rootDir)).replaceAll('\\', '/'),
    'config/shared-sdk-release-sources.json',
  );
  assert.equal(sharedSdkReleaseConfig.sources['appbase-app-sdk'].repoUrl, helper.DEFAULT_SHARED_SDK_APPBASE_APP_REPO_URL);
  assert.equal(sharedSdkReleaseConfig.sources['sdk-common'].repoUrl, helper.DEFAULT_SHARED_SDK_COMMON_REPO_URL);
  assert.equal(sharedSdkReleaseConfig.sources['core-pc-react'].repoUrl, helper.DEFAULT_SHARED_SDK_CORE_REPO_URL);
  assert.equal(sharedSdkReleaseConfig.sources['local-api-proxy'].repoUrl, helper.DEFAULT_SHARED_SDK_LOCAL_ROUTER_REPO_URL);
  assert.equal(sharedSdkReleaseConfig.sources['im-sdk'].repoUrl, helper.DEFAULT_SHARED_SDK_IM_REPO_URL);
  assert.equal(sharedSdkReleaseConfig.sources['messaging-app-sdk'].repoUrl, helper.DEFAULT_SHARED_SDK_MESSAGING_REPO_URL);
  assert.equal(sharedSdkReleaseConfig.sources['rtc-sdk'].repoUrl, helper.DEFAULT_SHARED_SDK_RTC_REPO_URL);
  assert.doesNotMatch(JSON.stringify(sharedSdkReleaseConfig), /"ref"\s*:\s*"main"/);

  const helperSource = read('scripts/prepare-shared-sdk-git-sources.mjs');
  assert.match(helperSource, /submodule/);
  assert.match(helperSource, /--init/);
  assert.match(helperSource, /symlinkSync/);
  assert.match(helperSource, /monorepoSubmodulePath/);
  assert.match(helperSource, /shared-sdk-release-sources\.json/);
  assert.match(helperSource, /FETCH_HEAD/);
  assert.match(helperSource, /SDKWORK_SHARED_SDK_APPBASE_APP_REPO_URL/);
  assert.match(helperSource, /SDKWORK_SHARED_SDK_IM_REPO_URL/);
  assert.match(helperSource, /SDKWORK_SHARED_SDK_MESSAGING_REPO_URL/);
  assert.match(helperSource, /SDKWORK_SHARED_SDK_RTC_REPO_URL/);
  assert.match(helperSource, /https:\/\/github\.com\/sdkwork-ai\/sdkwork-im-sdk\.git/);
  assert.match(helperSource, /https:\/\/github\.com\/sdkwork-ai\/sdkwork-messaging\.git/);
  assert.match(helperSource, /https:\/\/github\.com\/sdkwork-ai\/sdkwork-rtc-sdk\.git/);
  assert.match(helperSource, /https:\/\/github\.com\/sdkwork-ai\/sdkwork-appbase\.git/);
  assert.match(helperSource, /https:\/\/github\.com\/sdkwork-ai\/sdkwork-local-router\.git/);
});

test('git-backed shared sdk source helper can materialize pinned local git sources from the release config', async (t) => {
  const helperPath = path.join(rootDir, 'scripts', 'prepare-shared-sdk-git-sources.mjs');
  const helper = await import(pathToFileURL(helperPath).href);

  const tempRoot = mkdtempSync(path.join(os.tmpdir(), 'claw-release-shared-sdk-'));
  const workspaceRoot = path.join(tempRoot, 'apps', 'agent-studio');
  const configPath = path.join(workspaceRoot, 'config', 'shared-sdk-release-sources.json');
  const sourceRepoRoot = path.join(tempRoot, 'source-repos');
  const appbaseAppRepoRoot = path.join(sourceRepoRoot, 'sdkwork-appbase');
  const commonRepoRoot = path.join(sourceRepoRoot, 'sdkwork-sdk-commons');
  const coreRepoRoot = path.join(sourceRepoRoot, 'sdkwork-core');
  const localRouterRepoRoot = path.join(sourceRepoRoot, 'sdkwork-local-router');
  const imRepoRoot = path.join(sourceRepoRoot, 'sdkwork-im-sdk');
  const messagingRepoRoot = path.join(sourceRepoRoot, 'sdkwork-messaging');
  const rtcRepoRoot = path.join(sourceRepoRoot, 'sdkwork-rtc-sdk');
  const appbaseAppPackageRoot = path.join(
    appbaseAppRepoRoot,
    'sdks',
    'sdkwork-iam-app-sdk',
    'sdkwork-iam-app-sdk-typescript',
    'generated',
    'server-openapi',
  );
  const commonPackageRoot = path.join(commonRepoRoot, 'sdkwork-sdk-common-typescript');
  const corePackageRoot = path.join(coreRepoRoot, 'sdkwork-core-pc-react');
  const localApiProxyPackageRoot = path.join(localRouterRepoRoot, 'packages', 'pc-react', 'intelligence', 'sdkwork-local-api-proxy');
  const imPackageRoot = path.join(imRepoRoot, 'sdkwork-im-sdk-typescript');
  const messagingPackageRoot = path.join(
    messagingRepoRoot,
    'sdks',
    'sdkwork-messaging-app-sdk',
    'sdkwork-messaging-app-sdk-typescript',
    'generated',
    'server-openapi',
  );
  const rtcPackageRoot = path.join(rtcRepoRoot, 'sdkwork-rtc-sdk-typescript');

  function runGit(args, cwd) {
    const result = spawnSync(helper.resolveSpawnCommand('git'), args, {
      cwd,
      encoding: 'utf8',
      shell: false,
    });
    if (result.error?.code === 'EPERM' || result.error?.code === 'ENOENT') {
      t.skip('sandbox blocks git child processes; cannot materialize synthetic release git sources');
      return false;
    }
    assert.equal(result.status, 0, result.stderr || result.stdout || `git ${args.join(' ')} failed`);
    return true;
  }

  mkdirSync(appbaseAppPackageRoot, { recursive: true });
  mkdirSync(commonPackageRoot, { recursive: true });
  mkdirSync(corePackageRoot, { recursive: true });
  mkdirSync(localApiProxyPackageRoot, { recursive: true });
  mkdirSync(imPackageRoot, { recursive: true });
  mkdirSync(messagingPackageRoot, { recursive: true });
  mkdirSync(rtcPackageRoot, { recursive: true });
  mkdirSync(path.dirname(configPath), { recursive: true });

  writeFileSync(
    path.join(appbaseAppPackageRoot, 'package.json'),
    JSON.stringify({ name: '@sdkwork/iam-app-sdk', version: '0.1.0' }, null, 2),
    'utf8',
  );
  writeFileSync(
    path.join(commonPackageRoot, 'package.json'),
    JSON.stringify({ name: '@sdkwork/sdk-common', version: '1.0.2' }, null, 2),
    'utf8',
  );
  writeFileSync(
    path.join(corePackageRoot, 'package.json'),
    JSON.stringify({ name: '@sdkwork/core-pc-react', version: '0.1.0' }, null, 2),
    'utf8',
  );
  writeFileSync(
    path.join(localApiProxyPackageRoot, 'package.json'),
    JSON.stringify({ name: '@sdkwork/local-api-proxy', version: '0.1.0' }, null, 2),
    'utf8',
  );
  writeFileSync(
    path.join(imPackageRoot, 'package.json'),
    JSON.stringify({ name: '@sdkwork/im-sdk', version: '0.1.0' }, null, 2),
    'utf8',
  );
  writeFileSync(
    path.join(messagingPackageRoot, 'package.json'),
    JSON.stringify({ name: '@sdkwork/messaging-app-sdk', version: '0.1.0' }, null, 2),
    'utf8',
  );
  writeFileSync(
    path.join(rtcPackageRoot, 'package.json'),
    JSON.stringify({ name: '@sdkwork/rtc-sdk', version: '0.1.0' }, null, 2),
    'utf8',
  );

  if (!runGit(['init', '--initial-branch', 'main'], appbaseAppRepoRoot)) {
    return;
  }
  runGit(['config', 'user.name', 'Codex'], appbaseAppRepoRoot);
  runGit(['config', 'user.email', 'sdkwork@zowalk.com'], appbaseAppRepoRoot);
  runGit(['add', '.'], appbaseAppRepoRoot);
  runGit(['commit', '-m', 'seed-appbase-app-sdk'], appbaseAppRepoRoot);

  if (!runGit(['init', '--initial-branch', 'main'], commonRepoRoot)) {
    return;
  }
  runGit(['config', 'user.name', 'Codex'], commonRepoRoot);
  runGit(['config', 'user.email', 'sdkwork@zowalk.com'], commonRepoRoot);
  runGit(['add', '.'], commonRepoRoot);
  runGit(['commit', '-m', 'seed-sdk-common'], commonRepoRoot);

  if (!runGit(['init', '--initial-branch', 'main'], coreRepoRoot)) {
    return;
  }
  runGit(['config', 'user.name', 'Codex'], coreRepoRoot);
  runGit(['config', 'user.email', 'sdkwork@zowalk.com'], coreRepoRoot);
  runGit(['add', '.'], coreRepoRoot);
  runGit(['commit', '-m', 'seed-core-pc-react'], coreRepoRoot);

  if (!runGit(['init', '--initial-branch', 'main'], localRouterRepoRoot)) {
    return;
  }
  runGit(['config', 'user.name', 'Codex'], localRouterRepoRoot);
  runGit(['config', 'user.email', 'sdkwork@zowalk.com'], localRouterRepoRoot);
  runGit(['add', '.'], localRouterRepoRoot);
  runGit(['commit', '-m', 'seed-local-api-proxy'], localRouterRepoRoot);

  if (!runGit(['init', '--initial-branch', 'main'], imRepoRoot)) {
    return;
  }
  runGit(['config', 'user.name', 'Codex'], imRepoRoot);
  runGit(['config', 'user.email', 'sdkwork@zowalk.com'], imRepoRoot);
  runGit(['add', '.'], imRepoRoot);
  runGit(['commit', '-m', 'seed-sdkwork-im-sdk'], imRepoRoot);

  if (!runGit(['init', '--initial-branch', 'main'], messagingRepoRoot)) {
    return;
  }
  runGit(['config', 'user.name', 'Codex'], messagingRepoRoot);
  runGit(['config', 'user.email', 'sdkwork@zowalk.com'], messagingRepoRoot);
  runGit(['add', '.'], messagingRepoRoot);
  runGit(['commit', '-m', 'seed-sdkwork-messaging-app-sdk'], messagingRepoRoot);

  if (!runGit(['init', '--initial-branch', 'main'], rtcRepoRoot)) {
    return;
  }
  runGit(['config', 'user.name', 'Codex'], rtcRepoRoot);
  runGit(['config', 'user.email', 'sdkwork@zowalk.com'], rtcRepoRoot);
  runGit(['add', '.'], rtcRepoRoot);
  runGit(['commit', '-m', 'seed-sdkwork-rtc-sdk'], rtcRepoRoot);

  writeFileSync(
    configPath,
    JSON.stringify(
      {
        sources: {
          'appbase-app-sdk': {
            repoUrl: appbaseAppRepoRoot,
            ref: 'main',
          },
          'sdk-common': {
            repoUrl: commonRepoRoot,
            ref: 'main',
          },
          'core-pc-react': {
            repoUrl: coreRepoRoot,
            ref: 'main',
          },
          'local-api-proxy': {
            repoUrl: localRouterRepoRoot,
            ref: 'main',
          },
          'im-sdk': {
            repoUrl: imRepoRoot,
            ref: 'main',
          },
          'messaging-app-sdk': {
            repoUrl: messagingRepoRoot,
            ref: 'main',
          },
          'rtc-sdk': {
            repoUrl: rtcRepoRoot,
            ref: 'main',
          },
        },
      },
      null,
      2,
    ),
    'utf8',
  );

  try {
    const preparedSources = helper.ensureSharedSdkGitSources({
      workspaceRootDir: workspaceRoot,
      env: {
        [helper.SHARED_SDK_RELEASE_CONFIG_PATH_ENV_VAR]: configPath,
      },
      syncExistingRepos: false,
    });

    const preparedAppbaseAppSdk = preparedSources.find((entry) => entry.id === 'appbase-app-sdk');
    const preparedSdkCommon = preparedSources.find((entry) => entry.id === 'sdk-common');
    const preparedCorePcReact = preparedSources.find((entry) => entry.id === 'core-pc-react');
    const preparedLocalApiProxy = preparedSources.find((entry) => entry.id === 'local-api-proxy');
    const preparedImSdk = preparedSources.find((entry) => entry.id === 'im-sdk');
    const preparedMessagingAppSdk = preparedSources.find((entry) => entry.id === 'messaging-app-sdk');
    const preparedRtcSdk = preparedSources.find((entry) => entry.id === 'rtc-sdk');

    assert.equal(preparedAppbaseAppSdk?.targetRef, 'main');
    assert.equal(preparedSdkCommon?.targetRef, 'main');
    assert.equal(preparedCorePcReact?.targetRef, 'main');
    assert.equal(preparedLocalApiProxy?.targetRef, 'main');
    assert.equal(preparedImSdk?.targetRef, 'main');
    assert.equal(preparedMessagingAppSdk?.targetRef, 'main');
    assert.equal(preparedRtcSdk?.targetRef, 'main');
    assert.equal(realpathSync(preparedAppbaseAppSdk.packageRoot), realpathSync(path.join(
      tempRoot,
      'apps',
      'sdkwork-appbase',
      'sdks',
      'sdkwork-iam-app-sdk',
      'sdkwork-iam-app-sdk-typescript',
      'generated',
      'server-openapi',
    )));
    assert.equal(realpathSync(preparedSdkCommon.packageRoot), realpathSync(path.join(
      tempRoot,
      'apps',
      'sdkwork-sdk-commons',
      'sdkwork-sdk-common-typescript',
    )));
    assert.equal(realpathSync(preparedCorePcReact.packageRoot), realpathSync(path.join(
      tempRoot,
      'apps',
      'sdkwork-core',
      'sdkwork-core-pc-react',
    )));
    assert.equal(realpathSync(preparedLocalApiProxy.packageRoot), realpathSync(path.join(
      tempRoot,
      'apps',
      'sdkwork-local-router',
      'packages',
      'pc-react',
      'intelligence',
      'sdkwork-local-api-proxy',
    )));
    assert.equal(realpathSync(preparedImSdk.packageRoot), realpathSync(path.join(
      tempRoot,
      'apps',
      'sdkwork-im',
      'sdks',
      'sdkwork-im-sdk',
      'sdkwork-im-sdk-typescript',
    )));
    assert.equal(realpathSync(preparedRtcSdk.packageRoot), realpathSync(path.join(
      tempRoot,
      'apps',
      'sdkwork-rtc',
      'sdks',
      'sdkwork-rtc-sdk',
      'sdkwork-rtc-sdk-typescript',
    )));
    assert.equal(realpathSync(preparedMessagingAppSdk.packageRoot), realpathSync(path.join(
      tempRoot,
      'apps',
      'sdkwork-messaging',
      'sdks',
      'sdkwork-messaging-app-sdk',
      'sdkwork-messaging-app-sdk-typescript',
      'generated',
      'server-openapi',
    )));
    assert.equal(
      JSON.parse(readFileSync(path.join(preparedAppbaseAppSdk.packageRoot, 'package.json'), 'utf8')).name,
      '@sdkwork/iam-app-sdk',
    );
    assert.equal(
      JSON.parse(readFileSync(path.join(preparedSdkCommon.packageRoot, 'package.json'), 'utf8')).name,
      '@sdkwork/sdk-common',
    );
    assert.equal(
      JSON.parse(readFileSync(path.join(preparedCorePcReact.packageRoot, 'package.json'), 'utf8')).name,
      '@sdkwork/core-pc-react',
    );
    assert.equal(
      JSON.parse(readFileSync(path.join(preparedLocalApiProxy.packageRoot, 'package.json'), 'utf8')).name,
      '@sdkwork/local-api-proxy',
    );
    assert.equal(
      JSON.parse(readFileSync(path.join(preparedImSdk.packageRoot, 'package.json'), 'utf8')).name,
      '@sdkwork/im-sdk',
    );
    assert.equal(
      JSON.parse(readFileSync(path.join(preparedMessagingAppSdk.packageRoot, 'package.json'), 'utf8')).name,
      '@sdkwork/messaging-app-sdk',
    );
    assert.equal(
      JSON.parse(readFileSync(path.join(preparedRtcSdk.packageRoot, 'package.json'), 'utf8')).name,
      '@sdkwork/rtc-sdk',
    );
    assert.equal(
      preparedAppbaseAppSdk?.repoUrl,
      appbaseAppRepoRoot,
    );
    assert.equal(
      preparedSdkCommon?.repoUrl,
      commonRepoRoot,
    );
    assert.equal(
      preparedCorePcReact?.repoUrl,
      coreRepoRoot,
    );
    assert.equal(
      preparedLocalApiProxy?.repoUrl,
      localRouterRepoRoot,
    );
    assert.equal(
      preparedImSdk?.repoUrl,
      imRepoRoot,
    );
    assert.equal(
      preparedMessagingAppSdk?.repoUrl,
      messagingRepoRoot,
    );
    assert.equal(
      preparedRtcSdk?.repoUrl,
      rtcRepoRoot,
    );
  } finally {
    rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('shared sdk release parity hashing treats LF and CRLF text sources as the same content', async () => {
  const helperPath = path.join(rootDir, 'scripts', 'check-shared-sdk-release-parity.mjs');
  const helper = await import(pathToFileURL(helperPath).href);

  assert.equal(typeof helper.hashBufferForParity, 'function');
  assert.equal(
    helper.hashBufferForParity(Buffer.from('export const value = 1;\n', 'utf8')),
    helper.hashBufferForParity(Buffer.from('export const value = 1;\r\n', 'utf8')),
  );
});

test('shared sdk release parity compares every git materialized release source', async () => {
  const helperPath = path.join(rootDir, 'scripts', 'check-shared-sdk-release-parity.mjs');
  const helper = await import(pathToFileURL(helperPath).href);

  assert.ok(Array.isArray(helper.paritySources));
  assert.deepEqual(
    helper.paritySources.map((entry) => entry.id).sort(),
    [
      'appbase-app-sdk',
      'core-pc-react',
      'im-sdk',
      'local-api-proxy',
      'messaging-app-sdk',
      'rtc-sdk',
      'sdk-common',
    ],
  );
});

test('shared sdk release parity ignores generated directory symlinks before hashing', async (t) => {
  const helperPath = path.join(rootDir, 'scripts', 'check-shared-sdk-release-parity.mjs');
  const helper = await import(pathToFileURL(helperPath).href);
  const tempRoot = mkdtempSync(path.join(os.tmpdir(), 'claw-parity-symlink-'));

  try {
    const root = path.join(tempRoot, 'sdk');
    const generatedDist = path.join(root, 'generated', 'server-openapi', 'dist');
    const composedDir = path.join(root, 'composed');
    mkdirSync(generatedDist, { recursive: true });
    mkdirSync(composedDir, { recursive: true });
    writeFileSync(path.join(generatedDist, 'index.d.ts'), 'export type Generated = true;\n');

    const linkedGeneratedDir = path.join(composedDir, '.generated');
    try {
      symlinkSync(generatedDist, linkedGeneratedDir, 'junction');
    } catch (error) {
      if (error?.code === 'EPERM' || error?.code === 'EACCES') {
        t.skip(`directory symlink creation is unavailable in this environment: ${error.code}`);
        return;
      }

      throw error;
    }

    assert.equal(typeof helper.walkSnapshot, 'function');
    const snapshot = helper.walkSnapshot(root);
    assert.equal(
      snapshot.has('composed/.generated/index.d.ts'),
      false,
      'generated directory symlinks point at local build outputs and must not be hashed as files',
    );
  } finally {
    rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('shared sdk release parity ignores package manager cache directories', async () => {
  const helperPath = path.join(rootDir, 'scripts', 'check-shared-sdk-release-parity.mjs');
  const helper = await import(pathToFileURL(helperPath).href);
  const tempRoot = mkdtempSync(path.join(os.tmpdir(), 'claw-parity-cache-'));

  try {
    const root = path.join(tempRoot, 'sdk');
    const cacheDir = path.join(root, 'generated', 'server-openapi', '.npm-cache', '_cacache');
    mkdirSync(cacheDir, { recursive: true });
    writeFileSync(path.join(cacheDir, 'blob'), 'cache-only\n');
    writeFileSync(path.join(root, 'package.json'), '{"name":"sdk"}\n');

    assert.equal(typeof helper.walkSnapshot, 'function');
    const snapshot = helper.walkSnapshot(root);
    assert.equal(snapshot.has('package.json'), true);
    assert.equal(
      [...snapshot.keys()].some((entry) => entry.includes('.npm-cache')),
      false,
      'release parity must not compare local npm cache payloads',
    );
  } finally {
    rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('shared sdk release parity ignores native build output directories', async () => {
  const helperPath = path.join(rootDir, 'scripts', 'check-shared-sdk-release-parity.mjs');
  const helper = await import(pathToFileURL(helperPath).href);
  const tempRoot = mkdtempSync(path.join(os.tmpdir(), 'claw-parity-native-build-'));

  try {
    const root = path.join(tempRoot, 'sdk');
    mkdirSync(path.join(root, 'native', 'tauri-rust', 'target', 'debug'), { recursive: true });
    writeFileSync(path.join(root, 'native', 'tauri-rust', 'target', 'debug', 'lib.rlib'), 'build-only\n');
    writeFileSync(path.join(root, 'native', 'tauri-rust', 'Cargo.toml'), '[package]\nname = "sdk"\n');

    assert.equal(typeof helper.walkSnapshot, 'function');
    const snapshot = helper.walkSnapshot(root);
    assert.equal(snapshot.has('native/tauri-rust/Cargo.toml'), true);
    assert.equal(
      [...snapshot.keys()].some((entry) => entry.includes('/target/')),
      false,
      'release parity must not compare local Rust target build output',
    );
  } finally {
    rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('desktop release build runner injects the supported Visual Studio generator only on Windows', async () => {
  const runnerPath = path.join(rootDir, 'scripts', 'run-desktop-release-build.mjs');
  assert.equal(existsSync(runnerPath), true, 'missing scripts/run-desktop-release-build.mjs');

  const runner = await import(pathToFileURL(runnerPath).href);
  assert.equal(typeof runner.createDesktopReleaseBuildPlan, 'function');
  const { tempRoot, pnpmCliPath } = createPnpmCliFixture('claw-release-pnpm-cli-');

  try {
    const windowsPlan = runner.createDesktopReleaseBuildPlan({
      platform: 'win32',
      env: { npm_execpath: pnpmCliPath },
    });
    const linuxPlan = runner.createDesktopReleaseBuildPlan({
      platform: 'linux',
      env: {},
    });

    assert.equal(windowsPlan.command, process.execPath);
    assert.deepEqual(windowsPlan.args, [
      pnpmCliPath,
      '--filter',
      '@sdkwork/agentstudio-pc-desktop',
      'run',
      'build:desktop',
      '--',
      '--profile',
      'agent-studio',
      '--package-profile',
      'openclaw-only',
      '--vite-mode',
      'production',
      '--bundles',
      'nsis',
    ]);
    assert.equal(windowsPlan.env.CMAKE_GENERATOR, 'Visual Studio 17 2022');
    assert.equal(windowsPlan.env.HOST_CMAKE_GENERATOR, 'Visual Studio 17 2022');
    assert.equal(windowsPlan.shell, false);

    assert.equal(linuxPlan.command, 'pnpm');
    assert.deepEqual(linuxPlan.args, [
      '--filter',
      '@sdkwork/agentstudio-pc-desktop',
      'run',
      'build:desktop',
      '--',
      '--profile',
      'agent-studio',
      '--package-profile',
      'openclaw-only',
      '--vite-mode',
      'production',
      '--bundles',
      'deb,rpm',
    ]);
    assert.equal(Object.hasOwn(linuxPlan.env, 'CMAKE_GENERATOR'), false);
    assert.equal(windowsPlan.env.SDKWORK_VITE_MODE, 'production');
    assert.equal(linuxPlan.env.SDKWORK_VITE_MODE, 'production');
    assert.equal(linuxPlan.shell, false);
  } finally {
    rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('desktop release build runner can override the vite mode for test bundles while keeping production as the default', async () => {
  const runnerPath = path.join(rootDir, 'scripts', 'run-desktop-release-build.mjs');
  const runner = await import(pathToFileURL(runnerPath).href);

  const defaultPlan = runner.createDesktopReleaseBuildPlan({
    platform: 'linux',
    env: {},
  });
  const testPlan = runner.createDesktopReleaseBuildPlan({
    platform: 'linux',
    env: {},
    viteMode: 'test',
  });

  assert.equal(defaultPlan.env.SDKWORK_VITE_MODE, 'production');
  assert.equal(testPlan.env.SDKWORK_VITE_MODE, 'test');
});

test('desktop release target helpers resolve platform and architecture from explicit target triples', async () => {
  const helperPath = path.join(rootDir, 'scripts', 'release', 'desktop-targets.mjs');
  assert.equal(existsSync(helperPath), true, 'missing scripts/release/desktop-targets.mjs');

  const helper = await import(pathToFileURL(helperPath).href);
  assert.equal(typeof helper.parseDesktopTargetTriple, 'function');
  assert.equal(typeof helper.resolveDesktopReleaseTarget, 'function');

  assert.deepEqual(
    helper.parseDesktopTargetTriple('aarch64-pc-windows-msvc'),
    {
      platform: 'windows',
      arch: 'arm64',
      targetTriple: 'aarch64-pc-windows-msvc',
    },
  );
  assert.deepEqual(
    helper.parseDesktopTargetTriple('x86_64-apple-darwin'),
    {
      platform: 'macos',
      arch: 'x64',
      targetTriple: 'x86_64-apple-darwin',
    },
  );
  assert.deepEqual(
    helper.resolveDesktopReleaseTarget({
      env: {
        SDKWORK_DESKTOP_TARGET: 'x86_64-unknown-linux-gnu',
      },
    }),
    {
      platform: 'linux',
      arch: 'x64',
      targetTriple: 'x86_64-unknown-linux-gnu',
    },
  );
});

test('desktop release build runner forwards explicit target triples to tauri build', async () => {
  const runnerPath = path.join(rootDir, 'scripts', 'run-desktop-release-build.mjs');
  const runner = await import(pathToFileURL(runnerPath).href);
  const { tempRoot, pnpmCliPath } = createPnpmCliFixture('claw-release-pnpm-cli-');

  try {
    const arm64WindowsPlan = runner.createDesktopReleaseBuildPlan({
      platform: 'win32',
      env: { npm_execpath: pnpmCliPath },
      targetTriple: 'aarch64-pc-windows-msvc',
    });

    assert.deepEqual(arm64WindowsPlan.args, [
      pnpmCliPath,
      '--filter',
      '@sdkwork/agentstudio-pc-desktop',
      'run',
      'build:desktop',
      '--',
      '--profile',
      'agent-studio',
      '--package-profile',
      'openclaw-only',
      '--vite-mode',
      'production',
      '--bundles',
      'nsis',
      '--target',
      'aarch64-pc-windows-msvc',
    ]);
    assert.equal(arm64WindowsPlan.env.SDKWORK_DESKTOP_TARGET, 'aarch64-pc-windows-msvc');
    assert.equal(arm64WindowsPlan.env.SDKWORK_DESKTOP_TARGET_PLATFORM, 'windows');
    assert.equal(arm64WindowsPlan.env.SDKWORK_DESKTOP_TARGET_ARCH, 'arm64');
  } finally {
    rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('desktop release bundle phase merges the generated Windows bundle overlay config and limits CI installers to the stable profile bundle set', async () => {
  const runnerPath = path.join(rootDir, 'scripts', 'run-desktop-release-build.mjs');
  const runner = await import(pathToFileURL(runnerPath).href);

  const windowsBundlePlan = runner.createDesktopReleaseBuildPlan({
    platform: 'win32',
    env: {},
    phase: 'bundle',
    targetTriple: 'x86_64-pc-windows-msvc',
  });

  assert.equal(windowsBundlePlan.command, process.execPath);
  assert.deepEqual(windowsBundlePlan.args, [
    'scripts/run-windows-tauri-bundle.mjs',
    '--profile',
    'agent-studio',
    '--config',
    path.join(desktopPackageDir, desktopBundleOverlayConfig),
    '--bundles',
    'nsis',
  ]);

  const windowsBundleModulePath = path.join(rootDir, 'scripts', 'run-windows-tauri-bundle.mjs');
  const windowsBundleModule = await import(pathToFileURL(windowsBundleModulePath).href);
  const windowsCommand = windowsBundleModule.buildWindowsTauriBundleCommand();
  const previousSdkworkDesktopTarget = process.env.SDKWORK_DESKTOP_TARGET;
  const previousSdkworkDesktopTargetPlatform = process.env.SDKWORK_DESKTOP_TARGET_PLATFORM;
  const previousSdkworkDesktopTargetArch = process.env.SDKWORK_DESKTOP_TARGET_ARCH;
  try {
    process.env.SDKWORK_DESKTOP_TARGET = 'x86_64-pc-windows-msvc';
    process.env.SDKWORK_DESKTOP_TARGET_PLATFORM = 'windows';
    process.env.SDKWORK_DESKTOP_TARGET_ARCH = 'x64';
    assert.equal(
      windowsBundleModule.parseArgs([]).targetTriple,
      '',
      'Windows bundle helper must not inherit SDKWORK_DESKTOP_TARGET as an implicit --target after the outer runner omits the native target flag',
    );
  } finally {
    if (previousSdkworkDesktopTarget === undefined) {
      delete process.env.SDKWORK_DESKTOP_TARGET;
    } else {
      process.env.SDKWORK_DESKTOP_TARGET = previousSdkworkDesktopTarget;
    }
    if (previousSdkworkDesktopTargetPlatform === undefined) {
      delete process.env.SDKWORK_DESKTOP_TARGET_PLATFORM;
    } else {
      process.env.SDKWORK_DESKTOP_TARGET_PLATFORM = previousSdkworkDesktopTargetPlatform;
    }
    if (previousSdkworkDesktopTargetArch === undefined) {
      delete process.env.SDKWORK_DESKTOP_TARGET_ARCH;
    } else {
      process.env.SDKWORK_DESKTOP_TARGET_ARCH = previousSdkworkDesktopTargetArch;
    }
  }

  assert.match(windowsCommand.args.join(' '), /--bundles nsis/);
  assert.doesNotMatch(windowsCommand.args.join(' '), /--target x86_64-pc-windows-msvc/);
  assert.equal(
    windowsCommand.env.CARGO_PROFILE_RELEASE_STRIP,
    'none',
    'Windows release bundling must avoid Cargo release strip=debuginfo because Windows release builds can trip const-eval failures in the full desktop dependency graph',
  );
  assert.equal(
    windowsCommand.env.CARGO_PROFILE_RELEASE_OPT_LEVEL,
    '2',
    'Windows release bundling must lower Cargo release opt-level to 2 because Windows release builds can trip const-eval failures in the full desktop dependency graph at the default opt-level',
  );
});

test('desktop release build runner exposes granular release phases for CI diagnostics', async () => {
  const runnerPath = path.join(rootDir, 'scripts', 'run-desktop-release-build.mjs');
  const runner = await import(pathToFileURL(runnerPath).href);

  const syncPlan = runner.createDesktopReleaseBuildPlan({
    platform: 'linux',
    env: {},
    phase: 'sync',
    targetTriple: 'aarch64-unknown-linux-gnu',
  });
  const prepareTargetPlan = runner.createDesktopReleaseBuildPlan({
    platform: 'linux',
    env: {},
    phase: 'prepare-target',
    targetTriple: 'aarch64-unknown-linux-gnu',
  });
  const openClawPlan = runner.createDesktopReleaseBuildPlan({
    platform: 'linux',
    env: {},
    phase: 'prepare-openclaw',
    targetTriple: 'aarch64-unknown-linux-gnu',
  });
  const bundlePlan = runner.createDesktopReleaseBuildPlan({
    platform: 'linux',
    env: {},
    phase: 'bundle',
    targetTriple: 'aarch64-unknown-linux-gnu',
  });

  assert.match(syncPlan.args.join(' '), /sync-bundled-components\.mjs --no-fetch --release/);
  assert.match(prepareTargetPlan.args.join(' '), /ensure-tauri-target-clean\.mjs/);
  assert.match(openClawPlan.args.join(' '), /prepare-openclaw-runtime\.mjs/);
  assert.deepEqual(bundlePlan.args, [
    '--dir',
    desktopPackageDir,
    'exec',
    'tauri',
    'build',
    '--config',
    desktopLinuxTauriConfig,
    '--config',
    desktopBundleOverlayConfig,
    '--bundles',
    'deb,rpm',
    '--target',
    'aarch64-unknown-linux-gnu',
  ]);
  assert.equal(bundlePlan.env.SDKWORK_DESKTOP_TARGET, 'aarch64-unknown-linux-gnu');
  assert.equal(bundlePlan.env.SDKWORK_DESKTOP_TARGET_PLATFORM, 'linux');
  assert.equal(bundlePlan.env.SDKWORK_DESKTOP_TARGET_ARCH, 'arm64');
});

test('desktop release build runner requests standard macOS dmg and app bundle outputs in CI', async () => {
  const runnerPath = path.join(rootDir, 'scripts', 'run-desktop-release-build.mjs');
  const runner = await import(pathToFileURL(runnerPath).href);

  const macosBundlePlan = runner.createDesktopReleaseBuildPlan({
    platform: 'darwin',
    hostArch: 'x64',
    env: {},
    phase: 'bundle',
    targetTriple: 'x86_64-apple-darwin',
  });

  assert.deepEqual(macosBundlePlan.args, [
    '--dir',
    desktopPackageDir,
    'exec',
    'tauri',
    'build',
    '--config',
    desktopMacosTauriConfig,
    '--config',
    desktopBundleOverlayConfig,
    '--bundles',
    'app,dmg',
  ]);
  assert.equal(macosBundlePlan.env.SDKWORK_DESKTOP_TARGET, 'x86_64-apple-darwin');
  assert.equal(macosBundlePlan.env.SDKWORK_DESKTOP_TARGET_PLATFORM, 'macos');
  assert.equal(macosBundlePlan.env.SDKWORK_DESKTOP_TARGET_ARCH, 'x64');
});

test('desktop release build runner avoids explicit tauri target flags on native architecture runners', async () => {
  const runnerPath = path.join(rootDir, 'scripts', 'run-desktop-release-build.mjs');
  const runner = await import(pathToFileURL(runnerPath).href);

  const nativeLinuxArmPlan = runner.createDesktopReleaseBuildPlan({
    platform: 'linux',
    hostArch: 'arm64',
    env: {},
    phase: 'bundle',
    targetTriple: 'aarch64-unknown-linux-gnu',
  });

  assert.deepEqual(nativeLinuxArmPlan.args, [
    '--dir',
    desktopPackageDir,
    'exec',
    'tauri',
    'build',
    '--config',
    desktopLinuxTauriConfig,
    '--config',
    desktopBundleOverlayConfig,
    '--bundles',
    'deb,rpm',
  ]);
  assert.equal(nativeLinuxArmPlan.env.SDKWORK_DESKTOP_TARGET, 'aarch64-unknown-linux-gnu');
  assert.equal(nativeLinuxArmPlan.env.SDKWORK_DESKTOP_TARGET_PLATFORM, 'linux');
  assert.equal(nativeLinuxArmPlan.env.SDKWORK_DESKTOP_TARGET_ARCH, 'arm64');
});

test('desktop release build runner can recover a macOS dmg bundle failure when the app and dmg outputs already exist', async () => {
  const runnerPath = path.join(rootDir, 'scripts', 'run-desktop-release-build.mjs');
  const runner = await import(pathToFileURL(runnerPath).href);

  assert.equal(typeof runner.canRecoverMacosBundleFailure, 'function');

  const tempRoot = mkdtempSync(path.join(os.tmpdir(), 'claw-macos-bundle-recovery-'));

  try {
    const targetDir = path.join(tempRoot, 'target');
    const bundleRoot = path.join(targetDir, 'release', 'bundle');
    const appBundleDir = path.join(bundleRoot, 'macos', 'Agent Studio.app');
    const dmgPath = path.join(bundleRoot, 'dmg', 'Agent Studio_0.1.0_x64.dmg');

    mkdirSync(path.join(appBundleDir, 'Contents'), { recursive: true });
    mkdirSync(path.dirname(dmgPath), { recursive: true });
    writeFileSync(dmgPath, 'synthetic dmg');

    assert.equal(
      runner.canRecoverMacosBundleFailure({
        platform: 'darwin',
        targetTriple: 'x86_64-apple-darwin',
        bundleTargets: ['app', 'dmg'],
        targetDir,
      }),
      true,
    );
  } finally {
    rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('desktop release build runner can recover a macOS dmg bundle failure when Tauri leaves the dmg under the macos bundle directory', async () => {
  const runnerPath = path.join(rootDir, 'scripts', 'run-desktop-release-build.mjs');
  const runner = await import(pathToFileURL(runnerPath).href);

  assert.equal(typeof runner.canRecoverMacosBundleFailure, 'function');

  const tempRoot = mkdtempSync(path.join(os.tmpdir(), 'claw-macos-bundle-recovery-macos-dir-'));

  try {
    const targetDir = path.join(tempRoot, 'target');
    const bundleRoot = path.join(targetDir, 'release', 'bundle');
    const appBundleDir = path.join(bundleRoot, 'macos', 'Agent Studio.app');
    const dmgPath = path.join(bundleRoot, 'macos', 'Agent Studio_0.1.0_x64.dmg');

    mkdirSync(path.join(appBundleDir, 'Contents'), { recursive: true });
    writeFileSync(dmgPath, 'synthetic dmg');

    assert.equal(
      runner.canRecoverMacosBundleFailure({
        platform: 'darwin',
        targetTriple: 'x86_64-apple-darwin',
        bundleTargets: ['app', 'dmg'],
        targetDir,
      }),
      true,
    );
  } finally {
    rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('desktop release build runner does not treat a Tauri rw temporary dmg as a completed dmg output', async () => {
  const runnerPath = path.join(rootDir, 'scripts', 'run-desktop-release-build.mjs');
  const runner = await import(pathToFileURL(runnerPath).href);

  assert.equal(typeof runner.canRecoverMacosBundleFailure, 'function');

  const tempRoot = mkdtempSync(path.join(os.tmpdir(), 'claw-macos-bundle-temp-dmg-'));

  try {
    const targetDir = path.join(tempRoot, 'target');
    const bundleRoot = path.join(targetDir, 'release', 'bundle');
    const appBundleDir = path.join(bundleRoot, 'macos', 'Agent Studio.app');
    const temporaryDmgPath = path.join(bundleRoot, 'macos', 'rw.86444.Claw.Studio_0.1.0_x64.dmg');

    mkdirSync(path.join(appBundleDir, 'Contents'), { recursive: true });
    writeFileSync(temporaryDmgPath, 'synthetic temporary dmg');

    assert.equal(
      runner.canRecoverMacosBundleFailure({
        platform: 'darwin',
        targetTriple: 'x86_64-apple-darwin',
        bundleTargets: ['app', 'dmg'],
        targetDir,
      }),
      false,
    );
  } finally {
    rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('desktop release build runner can repair a macOS dmg bundle failure by converting a Tauri rw temporary dmg into the final dmg artifact', async () => {
  const runnerPath = path.join(rootDir, 'scripts', 'run-desktop-release-build.mjs');
  const runner = await import(pathToFileURL(runnerPath).href);

  assert.equal(typeof runner.repairMacosDmgBundleOutput, 'function');

  const tempRoot = mkdtempSync(path.join(os.tmpdir(), 'claw-macos-bundle-repair-'));

  try {
    const targetDir = path.join(tempRoot, 'target');
    const bundleRoot = path.join(targetDir, 'release', 'bundle');
    const appBundleDir = path.join(bundleRoot, 'macos', 'Agent Studio.app');
    const temporaryDmgPath = path.join(bundleRoot, 'macos', 'rw.86444.Claw.Studio_0.1.0_x64.dmg');
    const finalDmgPath = path.join(bundleRoot, 'dmg', 'Claw.Studio_0.1.0_x64.dmg');

    mkdirSync(path.join(appBundleDir, 'Contents'), { recursive: true });
    mkdirSync(path.dirname(temporaryDmgPath), { recursive: true });
    writeFileSync(temporaryDmgPath, 'synthetic temporary dmg');

    const spawnCalls = [];
    const repaired = runner.repairMacosDmgBundleOutput({
      platform: 'darwin',
      targetTriple: 'x86_64-apple-darwin',
      bundleTargets: ['app', 'dmg'],
      targetDir,
      spawnSyncImpl(command, args) {
        spawnCalls.push({ command, args });
        mkdirSync(path.dirname(finalDmgPath), { recursive: true });
        writeFileSync(finalDmgPath, 'synthetic finalized dmg');
        return { status: 0 };
      },
    });

    assert.equal(repaired, true);
    assert.equal(existsSync(finalDmgPath), true);
    assert.equal(spawnCalls.length, 1);
    assert.equal(spawnCalls[0].command, 'hdiutil');
    assert.deepEqual(spawnCalls[0].args, [
      'convert',
      temporaryDmgPath,
      '-format',
      'UDZO',
      '-o',
      finalDmgPath,
    ]);
  } finally {
    rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('desktop release build runner does not recover a macOS dmg bundle failure when the dmg output is missing', async () => {
  const runnerPath = path.join(rootDir, 'scripts', 'run-desktop-release-build.mjs');
  const runner = await import(pathToFileURL(runnerPath).href);

  assert.equal(typeof runner.canRecoverMacosBundleFailure, 'function');

  const tempRoot = mkdtempSync(path.join(os.tmpdir(), 'claw-macos-bundle-failure-'));

  try {
    const targetDir = path.join(tempRoot, 'target');
    const bundleRoot = path.join(targetDir, 'release', 'bundle');
    const appBundleDir = path.join(bundleRoot, 'macos', 'Agent Studio.app');

    mkdirSync(path.join(appBundleDir, 'Contents'), { recursive: true });

    assert.equal(
      runner.canRecoverMacosBundleFailure({
        platform: 'darwin',
        targetTriple: 'x86_64-apple-darwin',
        bundleTargets: ['app', 'dmg'],
        targetDir,
      }),
      false,
    );
  } finally {
    rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('release plan resolver expands the agent-studio profile into the full desktop matrix', async () => {
  const resolverPath = path.join(rootDir, 'scripts', 'release', 'resolve-release-plan.mjs');
  assert.equal(existsSync(resolverPath), true, 'missing scripts/release/resolve-release-plan.mjs');

  const resolver = await import(pathToFileURL(resolverPath).href);
  assert.equal(typeof resolver.createReleasePlan, 'function');
  assert.equal(typeof resolver.parseArgs, 'function');

  const plan = resolver.createReleasePlan({
    profileId: 'agent-studio',
    packageProfileId: 'dual-kernel',
    releaseTag: 'release-2026-03-31-03',
    gitRef: 'refs/tags/release-2026-03-31-03',
  });

  assert.equal(plan.profileId, 'agent-studio');
  assert.equal(plan.defaultPackageProfileId, 'openclaw-only');
  assert.equal(plan.packageProfileId, 'dual-kernel');
  assert.deepEqual(plan.packageProfile.includedKernelIds, ['openclaw', 'hermes']);
  assert.equal(plan.packageProfiles.length >= 3, true);
  assert.equal(plan.desktopMatrix.length, 6);
  assert.equal(plan.serverMatrix.length, 6);
  assert.equal(plan.containerMatrix.length, 4);
  assert.equal(plan.kubernetesMatrix.length, 4);
  assert.deepEqual(plan.familyTargetCounts, {
    web: 1,
    desktop: 10,
    server: 6,
    container: 4,
    kubernetes: 4,
  });
  assert.equal(plan.requiredTargetCount, 25);
  assert.equal(
    plan.requiredTargetCount,
    Object.values(plan.familyTargetCounts).reduce((total, count) => total + count, 0),
  );
  assert.equal(plan.release.manifestFileName, 'release-manifest.json');
  assert.equal(plan.release.manifestChecksumFileName, 'release-manifest.json.sha256.txt');
  assert.equal(plan.release.attestationEvidenceFileName, 'release-attestations.json');
  assert.equal(plan.release.globalChecksumsFileName, 'SHA256SUMS.txt');
  assert.deepEqual(
    plan.desktopMatrix.find((entry) => entry.platform === 'linux' && entry.arch === 'x64'),
    {
      runner: 'ubuntu-24.04',
      platform: 'linux',
      arch: 'x64',
      target: 'x86_64-unknown-linux-gnu',
      bundles: ['deb', 'rpm'],
    },
  );
  assert.deepEqual(
    plan.desktopMatrix.find((entry) => entry.platform === 'macos' && entry.arch === 'arm64'),
    {
      runner: 'macos-15',
      platform: 'macos',
      arch: 'arm64',
      target: 'aarch64-apple-darwin',
      bundles: ['app', 'dmg'],
    },
  );
  assert.deepEqual(
    plan.serverMatrix.find((entry) => entry.platform === 'linux' && entry.arch === 'arm64'),
    {
      runner: 'ubuntu-24.04-arm',
      platform: 'linux',
      arch: 'arm64',
      target: 'aarch64-unknown-linux-gnu',
      archiveFormat: 'tar.gz',
    },
  );
  assert.deepEqual(
    plan.containerMatrix.find((entry) => entry.arch === 'x64' && entry.accelerator === 'amd-rocm'),
    {
      runner: 'ubuntu-24.04',
      platform: 'linux',
      arch: 'x64',
      target: 'x86_64-unknown-linux-gnu',
      accelerator: 'amd-rocm',
    },
  );
  assert.deepEqual(
    plan.kubernetesMatrix.find((entry) => entry.arch === 'x64' && entry.accelerator === 'nvidia-cuda'),
    {
      runner: 'ubuntu-24.04',
      platform: 'linux',
      arch: 'x64',
      target: 'x86_64-unknown-linux-gnu',
      accelerator: 'nvidia-cuda',
    },
  );
  assert.throws(
    () => resolver.parseArgs(['--release-tag']),
    /Missing value for --release-tag/,
  );
  assert.deepEqual(
    resolver.parseArgs(['--package-profile', 'hermes-only']).packageProfileId,
    'hermes-only',
  );
});

test('shared sdk release parity ignores local generator manual backups', async () => {
  const helperPath = path.join(rootDir, 'scripts', 'check-shared-sdk-release-parity.mjs');
  const helper = await import(pathToFileURL(helperPath).href);

  assert.equal(typeof helper.shouldIgnoreParityPath, 'function');
  assert.equal(helper.shouldIgnoreParityPath('.sdkwork/manual-backups/README.md'), true);
  assert.equal(helper.shouldIgnoreParityPath('.sdkwork/manual-backups/src/api/app.ts'), true);
  assert.equal(helper.shouldIgnoreParityPath('generated/server-openapi/.sdkwork/sdkwork-generator-changes.json'), true);
  assert.equal(helper.shouldIgnoreParityPath('generated/server-openapi/.sdkwork/sdkwork-generator-manifest.json'), true);
  assert.equal(helper.shouldIgnoreParityPath('generated/server-openapi/.sdkwork/sdkwork-generator-report.json'), true);
  assert.equal(helper.shouldIgnoreParityPath('.sdkwork/sdkwork-generator-report.json'), false);
  assert.equal(helper.shouldIgnoreParityPath('sdkwork-sdk.json'), false);
});

test('release plan resolver exposes target counts through GitHub output', async () => {
  const resolverPath = path.join(rootDir, 'scripts', 'release', 'resolve-release-plan.mjs');
  const resolver = await import(pathToFileURL(resolverPath).href);
  assert.equal(typeof resolver.buildGitHubOutputLines, 'function');

  const plan = resolver.createReleasePlan({
    profileId: 'agent-studio',
    packageProfileId: 'dual-kernel',
    releaseTag: 'release-2026-03-31-03',
  });
  const output = resolver.buildGitHubOutputLines(plan).join('\n');

  assert.match(output, /^required_target_count=25$/m);
  assert.match(
    output,
    /^family_target_counts=\{"web":1,"desktop":10,"server":6,"container":4,"kubernetes":4\}$/m,
  );
});

test('release asset packager knows how to filter desktop bundle outputs, resolve target roots, and name web archives', async () => {
  const packagerPath = path.join(rootDir, 'scripts', 'release', 'package-release-assets.mjs');
  assert.equal(existsSync(packagerPath), true, 'missing scripts/release/package-release-assets.mjs');

  const packager = await import(pathToFileURL(packagerPath).href);
  assert.equal(typeof packager.normalizePlatformId, 'function');
  assert.equal(typeof packager.shouldIncludeDesktopBundleFile, 'function');
  assert.equal(typeof packager.buildDesktopBundleRootCandidates, 'function');
  assert.equal(typeof packager.resolveDesktopBundleRoot, 'function');
  assert.equal(typeof packager.resolveExistingDesktopBundleRoot, 'function');
  assert.equal(typeof packager.buildWebArchiveBaseName, 'function');

  assert.equal(packager.normalizePlatformId('win32'), 'windows');
  assert.equal(packager.normalizePlatformId('darwin'), 'macos');
  assert.equal(packager.normalizePlatformId('linux'), 'linux');

  assert.equal(
    packager.shouldIncludeDesktopBundleFile('windows', 'nsis/Agent Studio_0.1.0_x64-setup.exe'),
    true,
  );
  assert.equal(
    packager.shouldIncludeDesktopBundleFile('windows', 'deb/agent-studio_0.1.0_amd64.deb'),
    false,
  );
  assert.equal(
    packager.shouldIncludeDesktopBundleFile('linux', 'deb/agent-studio_0.1.0_amd64.deb'),
    true,
  );
  assert.equal(
    packager.shouldIncludeDesktopBundleFile('macos', 'dmg/Agent Studio_0.1.0_aarch64.dmg'),
    true,
  );
  assert.equal(
    packager.shouldIncludeDesktopBundleFile('macos', 'macos/rw.86444.Claw.Studio_0.1.0_x64.dmg'),
    false,
  );
  assert.equal(
    packager.resolveDesktopBundleRoot({
      targetTriple: 'aarch64-pc-windows-msvc',
      targetDir: path.join(
        rootDir,
        'packages',
        'sdkwork-agentstudio-pc-desktop',
        'src-tauri',
        'target',
      ),
    }).replaceAll('\\', '/'),
    path.join(
      rootDir,
      'packages',
      'sdkwork-agentstudio-pc-desktop',
      'src-tauri',
      'target',
      'aarch64-pc-windows-msvc',
      'release',
      'bundle',
    ).replaceAll('\\', '/'),
  );

  const tempRoot = mkdtempSync(path.join(os.tmpdir(), 'claw-release-bundle-root-'));

  try {
    const tempTargetDir = path.join(tempRoot, 'target');
    const fallbackBundleRoot = path.join(tempTargetDir, 'release', 'bundle');

    mkdirSync(fallbackBundleRoot, { recursive: true });

    assert.deepEqual(
      packager.buildDesktopBundleRootCandidates({
        targetTriple: 'x86_64-pc-windows-msvc',
        targetDir: tempTargetDir,
      }).map((candidate) => candidate.replaceAll('\\', '/')),
      [
        path.join(tempTargetDir, 'x86_64-pc-windows-msvc', 'release', 'bundle').replaceAll('\\', '/'),
        fallbackBundleRoot.replaceAll('\\', '/'),
      ],
    );

    assert.equal(
      packager.resolveExistingDesktopBundleRoot({
        targetTriple: 'x86_64-pc-windows-msvc',
        targetDir: tempTargetDir,
      }).replaceAll('\\', '/'),
      fallbackBundleRoot.replaceAll('\\', '/'),
    );
  } finally {
    rmSync(tempRoot, { recursive: true, force: true });
  }

  assert.equal(
    packager.buildWebArchiveBaseName('release-2026-03-26'),
    'agent-studio-web-assets-release-2026-03-26',
  );
});

test('bundled component sync resolves the npm global node_modules root for Unix and Windows layouts', async () => {
  const syncPath = path.join(rootDir, 'scripts', 'sync-bundled-components.mjs');
  const syncModule = await import(pathToFileURL(syncPath).href);
  const syncSource = read('scripts/sync-bundled-components.mjs');

  assert.equal(typeof syncModule.resolveGlobalNodeModulesDir, 'function');
  assert.match(syncSource, /buildAttempts:\s*3/);
  assert.match(syncSource, /retrying after cleaning dist/);

  assert.equal(
    syncModule.resolveGlobalNodeModulesDir('/tmp/openclaw-prefix', 'linux'),
    '/tmp/openclaw-prefix/lib/node_modules',
  );
  assert.equal(
    syncModule.resolveGlobalNodeModulesDir('/tmp/openclaw-prefix', 'darwin'),
    '/tmp/openclaw-prefix/lib/node_modules',
  );
  assert.equal(
    syncModule.resolveGlobalNodeModulesDir('C:/openclaw-prefix', 'win32'),
    'C:\\openclaw-prefix\\node_modules',
  );
  assert.doesNotMatch(syncSource, /'router-web-service',/);
  assert.doesNotMatch(syncSource, /"router-web-service",/);
  assert.doesNotMatch(syncSource, /-p'\s*,\s*'router-web-service'/);
});

test('release sync defers heavyweight openclaw builds to the dedicated preparation phase', async () => {
  const syncPath = path.join(rootDir, 'scripts', 'sync-bundled-components.mjs');
  const syncModule = await import(pathToFileURL(syncPath).href);

  assert.equal(typeof syncModule.createComponentExecutionPlan, 'function');

  assert.deepEqual(
    syncModule.createComponentExecutionPlan({
      componentId: 'openclaw',
      devMode: false,
      releaseMode: true,
    }),
    {
      shouldBuild: false,
      shouldStage: false,
    },
  );
  assert.deepEqual(
    syncModule.createComponentExecutionPlan({
      componentId: 'generic-bundled-component',
      devMode: false,
      releaseMode: true,
    }),
    {
      shouldBuild: true,
      shouldStage: true,
    },
  );
});

