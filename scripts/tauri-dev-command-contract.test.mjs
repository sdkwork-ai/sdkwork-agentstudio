// WORKSPACE-PATH:allow-fixture: fixtures name a foreign checkout root, drive, or home directory to exercise path handling, so the literal is the value under assertion rather than a binding this build resolves
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');
const bundledComponentsModulePath = path.join(rootDir, 'scripts', 'sync-bundled-components.mjs');
const bundledComponentsModule = await import(pathToFileURL(bundledComponentsModulePath).href);

function readJson(relativePath) {
  return JSON.parse(readFileSync(path.join(rootDir, relativePath), 'utf8'));
}

function readText(relativePath) {
  return readFileSync(path.join(rootDir, relativePath), 'utf8');
}

function fail(message) {
  throw new Error(message);
}

const desktopPackage = readJson('packages/sdkwork-agentstudio-pc-desktop/package.json');
const tauriConfig = readJson('packages/sdkwork-agentstudio-pc-desktop/src-tauri/tauri.conf.json');
const tauriWindowsConfig = readJson('packages/sdkwork-agentstudio-pc-desktop/src-tauri/tauri.windows.conf.json');
const tauriLinuxConfig = readJson('packages/sdkwork-agentstudio-pc-desktop/src-tauri/tauri.linux.conf.json');
const tauriMacosConfig = readJson('packages/sdkwork-agentstudio-pc-desktop/src-tauri/tauri.macos.conf.json');
const windowsInstallerHooksPath = 'packages/sdkwork-agentstudio-pc-desktop/src-tauri/installer-hooks.nsh';
const nodeScriptRunner = 'sdkwork-run-node';
const bundledSyncDevCommand = `${nodeScriptRunner} ../../scripts/sync-bundled-components.mjs --dev --no-fetch`;
const bundledSyncBuildCommand = `${nodeScriptRunner} ../../scripts/sync-bundled-components.mjs --no-fetch --release`;
const staleTargetGuardCommand = `${nodeScriptRunner} ../../scripts/ensure-tauri-target-clean.mjs src-tauri`;
const rustToolchainGuardCommand = `${nodeScriptRunner} ../../scripts/ensure-native-rust-toolchain.mjs`;
const devBinaryUnlockGuardCommand =
  `${nodeScriptRunner} ../../scripts/ensure-tauri-dev-binary-unlocked.mjs src-tauri sdkwork-agentstudio-pc-desktop`;
const devPortGuardCommand = `${nodeScriptRunner} ../../scripts/ensure-tauri-dev-port-free.mjs 127.0.0.1 1426`;
const bundledOpenClawPrepareCommand = `${nodeScriptRunner} ../../scripts/prepare-openclaw-runtime.mjs`;
const desktopBuildVerifyCommand = `${nodeScriptRunner} ../../scripts/verify-desktop-build-assets.mjs`;
const tauriDevRunnerCommand = `${nodeScriptRunner} ../../scripts/run-tauri-cli.mjs dev`;
const desktopBundleRunnerCommand = `${nodeScriptRunner} ../../scripts/run-desktop-release-build.mjs --phase bundle --vite-mode production`;

function assertCommandsAppearInOrder(script, commands, label) {
  let lastIndex = -1;
  for (const command of commands) {
    const index = script.indexOf(command);
    if (index === -1) {
      fail(`${label} must include "${command}".`);
    }
    if (index < lastIndex) {
      fail(`${label} must execute "${command}" after the previous required step.`);
    }
    lastIndex = index;
  }
}

const tauriCliDevScript = desktopPackage.scripts?.['dev:desktop'];
if (typeof tauriCliDevScript !== 'string' || tauriCliDevScript.trim().length === 0) {
  fail('Desktop package must define a "dev:desktop" script.');
}

const bundledOpenClawPrepareScript = desktopPackage.scripts?.['sdk:prepare-openclaw-runtime'];
if (bundledOpenClawPrepareScript !== bundledOpenClawPrepareCommand) {
  fail(
    `Desktop package must define "sdk:prepare-openclaw-runtime" as "${bundledOpenClawPrepareCommand}".`,
  );
}

if ('prepare:api-router-runtime' in (desktopPackage.scripts ?? {})) {
  fail('Desktop package must not keep the legacy "prepare:api-router-runtime" script after api-router runtime extraction.');
}

assertCommandsAppearInOrder(
  tauriCliDevScript,
  [
    rustToolchainGuardCommand,
    bundledOpenClawPrepareCommand,
    bundledSyncDevCommand,
    devBinaryUnlockGuardCommand,
    staleTargetGuardCommand,
    devPortGuardCommand,
    tauriDevRunnerCommand,
  ],
  'Desktop "dev:desktop"',
);

const tauriCliBuildScript = desktopPackage.scripts?.['build:desktop'];
if (typeof tauriCliBuildScript !== 'string' || tauriCliBuildScript.trim().length === 0) {
  fail('Desktop package must define a "build:desktop" script.');
}

const desktopBuildScript = desktopPackage.scripts?.build;
if (typeof desktopBuildScript !== 'string' || desktopBuildScript.trim().length === 0) {
  fail('Desktop package must define a "build" script.');
}

if (!desktopBuildScript.includes(desktopBuildVerifyCommand)) {
  fail(`Desktop "build" must verify bundled frontend assets with "${desktopBuildVerifyCommand}".`);
}
if (
  !/if \(path\.resolve\(process\.argv\[1\] \?\? ''\) === __filename\) \{\s*try \{\s*main\(\);\s*\} catch \(error\) \{\s*console\.error\(error instanceof Error \? error\.message : String\(error\)\);\s*process\.exit\(1\);\s*\}\s*\}/s.test(
    readText('scripts/verify-desktop-build-assets.mjs'),
  )
) {
  fail('Desktop bundled asset verification script must wrap the CLI entrypoint with a top-level error handler.');
}

assertCommandsAppearInOrder(
  tauriCliBuildScript,
  [
    rustToolchainGuardCommand,
    bundledOpenClawPrepareCommand,
    bundledSyncBuildCommand,
    devBinaryUnlockGuardCommand,
    staleTargetGuardCommand,
    desktopBundleRunnerCommand,
  ],
  'Desktop "build:desktop"',
);

if (!tauriCliBuildScript.includes(desktopBundleRunnerCommand)) {
  fail(
    `Desktop "build:desktop" must delegate the final bundle step through "${desktopBundleRunnerCommand}".`,
  );
}

const bundledResources = tauriConfig.bundle?.resources;
if (!Array.isArray(bundledResources) || !bundledResources.includes('resources/openclaw/')) {
  fail('Desktop Tauri bundle resources must include resources/openclaw/ as a directory resource root.');
}
if (!Array.isArray(bundledResources) || !bundledResources.includes('../dist/')) {
  fail('Desktop Tauri bundle resources must include ../dist/ as a directory resource root so the embedded host can serve the packaged browser shell.');
}
if (!Array.isArray(bundledResources) || !bundledResources.includes('generated/bundled/')) {
  fail('Desktop Tauri bundle resources must include generated/bundled/ as a directory resource root.');
}
if (!Array.isArray(bundledResources) || !bundledResources.includes('foundation/components/')) {
  fail('Desktop Tauri bundle resources must include foundation/components/ as a directory resource root.');
}
if (Array.isArray(bundledResources) && bundledResources.some((resource) => resource.includes('/**/*'))) {
  fail('Desktop Tauri bundle resources must prefer directory resource roots over recursive glob patterns for packaged folders.');
}

const windowsBundleResources = bundledComponentsModule.createTauriBundleOverlayConfig({
  workspaceRootDir: 'D:\\workspace\\agent-studio',
  platform: 'win32',
}).bundle?.resources;
if (!windowsBundleResources || Array.isArray(windowsBundleResources)) {
  fail('Desktop Windows bundle overlay must declare bundle.resources as a source-to-target mapping object.');
}

const expectedWindowsBundleSources = [
  'foundation/components/',
  'generated/br/b/',
  'generated/br/w/',
  'generated/br/o/',
];

for (const source of expectedWindowsBundleSources) {
  if (!(source in windowsBundleResources)) {
    fail(`Desktop Windows bundle overlay must map "${source}" as a bundled resource root.`);
  }
}

if (JSON.stringify(Object.keys(windowsBundleResources).sort()) !== JSON.stringify(expectedWindowsBundleSources.sort())) {
  fail('Desktop Windows bundle overlay must keep only foundation, bundled mirror, browser shell, and OpenClaw resource mappings.');
}

for (const source of Object.keys(windowsBundleResources)) {
  if (/^[a-zA-Z]:[\\/]/.test(source) || source.includes('.sdkwork-bc')) {
    fail(
      `Desktop Windows bundle overlay must not depend on external absolute mirror paths, found "${source}".`,
    );
  }
}

if (windowsBundleResources['generated/br/o/'] !== 'resources/openclaw/') {
  fail('Desktop Windows bundle overlay must map the OpenClaw bridge root into resources/openclaw/.');
}
if (windowsBundleResources['generated/br/w/'] !== 'dist/') {
  fail('Desktop Windows bundle overlay must map the browser shell bridge root into dist/.');
}

const expectedUnixBundleResources = {
  'foundation/components/': 'foundation/components/',
  'generated/bundled/': 'generated/bundled/',
  '../dist/': 'dist/',
  'generated/release/openclaw-resource/': 'resources/openclaw/',
};

for (const [platformLabel, platformConfig] of [
  ['Linux', tauriLinuxConfig],
  ['macOS', tauriMacosConfig],
]) {
  const platformBundleResources = platformConfig.bundle?.resources;
  if (!platformBundleResources || Array.isArray(platformBundleResources)) {
    fail(`Desktop ${platformLabel} Tauri config must override bundle.resources with a source-to-target mapping object.`);
  }

  for (const [source, target] of Object.entries(expectedUnixBundleResources)) {
    if (platformBundleResources[source] !== target) {
      fail(`Desktop ${platformLabel} Tauri config must map "${source}" to "${target}".`);
    }
  }

  if (Object.keys(platformBundleResources).length !== Object.keys(expectedUnixBundleResources).length) {
    fail(`Desktop ${platformLabel} Tauri config must not include extra legacy bundle resource mappings.`);
  }
}

const linuxDebPostInstallScript = tauriLinuxConfig.bundle?.linux?.deb?.postInstallScript;
if (typeof linuxDebPostInstallScript !== 'undefined') {
  fail('Desktop Linux deb bundle must not wire a legacy OpenClaw postInstallScript.');
}

const linuxRpmPostInstallScript = tauriLinuxConfig.bundle?.linux?.rpm?.postInstallScript;
if (typeof linuxRpmPostInstallScript !== 'undefined') {
  fail('Desktop Linux rpm bundle must not wire a legacy OpenClaw postInstallScript.');
}

const macosBundleFiles = tauriMacosConfig.bundle?.macOS?.files;
if (!macosBundleFiles || Array.isArray(macosBundleFiles)) {
  fail('Desktop macOS bundle must declare bundle.macOS.files as a source-to-target mapping object.');
}
if (macosBundleFiles['generated/release/macos-install-root/'] !== 'MacOS/') {
  fail('Desktop macOS bundle must project the preexpanded OpenClaw managed runtime layout into Contents/MacOS/.');
}

const windowsTauriResources = tauriWindowsConfig.bundle?.resources;
if (typeof windowsTauriResources !== 'undefined') {
  fail('Desktop Windows Tauri config must not duplicate bundle.resources when the Windows overlay already owns bundled resource mapping.');
}

if (typeof tauriWindowsConfig.bundle?.windows?.nsis?.installerHooks !== 'undefined') {
  fail('Desktop NSIS packaging must not wire legacy OpenClaw installer hooks.');
}
if (existsSync(path.join(rootDir, windowsInstallerHooksPath))) {
  fail('Legacy Windows OpenClaw installer hooks must be removed after the external-runtime hard cut.');
}

if (typeof tauriLinuxConfig.bundle?.linux?.deb?.postInstallScript !== 'undefined') {
  fail('Desktop Linux deb packaging must not wire a legacy OpenClaw postinstall script.');
}
if (typeof tauriLinuxConfig.bundle?.linux?.rpm?.postInstallScript !== 'undefined') {
  fail('Desktop Linux rpm packaging must not wire a legacy OpenClaw postinstall script.');
}
if (existsSync(path.join(rootDir, 'packages/sdkwork-agentstudio-pc-desktop/src-tauri/linux-postinstall-openclaw.sh'))) {
  fail('Legacy Linux OpenClaw postinstall hook must be removed after the external-runtime hard cut.');
}

const tauriBuildScriptSource = readText('packages/sdkwork-agentstudio-pc-desktop/src-tauri/build.rs');
if (!tauriBuildScriptSource.includes('../dist')) {
  fail('Desktop build.rs must keep the frontendDist path available for clean-clone cargo test runs.');
}

if (!tauriBuildScriptSource.includes('generated/bundled')) {
  fail('Desktop build.rs must tolerate clean-clone cargo test runs when generated bundled resources have not been synchronized yet.');
}

if (!tauriBuildScriptSource.includes('placeholder.txt')) {
  fail('Desktop build.rs must seed a visible generated bundled placeholder so Tauri resource glob resolution stays valid on clean clones.');
}

console.log('ok - desktop Tauri commands stay aligned with devUrl and stale-target protection');
