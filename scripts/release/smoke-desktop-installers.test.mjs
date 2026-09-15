// WORKSPACE-PATH:allow-fixture: fixtures name a foreign checkout root, drive, or home directory to exercise path handling, so the literal is the value under assertion rather than a binding this build resolves
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { pathToFileURL } from 'node:url';

import { DEFAULT_OPENCLAW_VERSION } from '../openclaw-release.mjs';
import { createStoredZipArchive } from '../test-support/archive-fixtures.mjs';

const rootDir = path.resolve(import.meta.dirname, '..', '..');

function openClawInstallKey(platform, arch) {
  return `${DEFAULT_OPENCLAW_VERSION}-${platform}-${arch}`;
}

function writeJsonFile(filePath, value) {
  mkdirSync(path.dirname(filePath), { recursive: true });
  writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function writeArtifactFile(releaseAssetsDir, relativePath) {
  const absolutePath = path.join(releaseAssetsDir, relativePath);
  mkdirSync(path.dirname(absolutePath), { recursive: true });
  writeFileSync(absolutePath, 'synthetic desktop artifact\n', 'utf8');
  return absolutePath;
}

function writeZipArtifactFile(releaseAssetsDir, relativePath, entries) {
  const absolutePath = path.join(releaseAssetsDir, relativePath);
  mkdirSync(path.dirname(absolutePath), { recursive: true });
  writeFileSync(absolutePath, createStoredZipArchive(entries));
  return absolutePath;
}

function buildInstallerContract(platform) {
  if (platform === 'windows') {
    return {
      version: 2,
      platform: 'windows',
      delivery: 'archive-only-resources',
      installMode: 'first-launch-archive-extract',
      bundledResourceRoot: 'resources/openclaw/',
      runtimeArchive: 'resources/openclaw/runtime.zip',
      sourceConfigPath: 'packages/sdkwork-agentstudio-pc-desktop/src-tauri/tauri.windows.conf.json',
      requiredExternalRuntimes: ['nodejs'],
    };
  }

  if (platform === 'linux') {
    return {
      version: 2,
      platform: 'linux',
      delivery: 'archive-only-resources',
      installMode: 'first-launch-archive-extract',
      bundledResourceRoot: 'resources/openclaw/',
      runtimeArchive: 'resources/openclaw/runtime.zip',
      sourceConfigPath: 'packages/sdkwork-agentstudio-pc-desktop/src-tauri/tauri.linux.conf.json',
      requiredExternalRuntimes: ['nodejs'],
      packageFormats: ['deb', 'rpm'],
    };
  }

  if (platform === 'macos') {
    return {
      version: 2,
      platform: 'macos',
      delivery: 'archive-only-resources',
      installMode: 'preexpanded-managed-layout',
      bundledResourceRoot: 'resources/openclaw/',
      runtimeArchive: 'resources/openclaw/runtime.zip',
      sourceConfigPath: 'packages/sdkwork-agentstudio-pc-desktop/src-tauri/tauri.macos.conf.json',
      stagedInstallRootSource: 'generated/release/macos-install-root/',
      stagedInstallRootTarget: 'MacOS/',
      requiredExternalRuntimes: ['nodejs'],
    };
  }

  throw new Error(`Unsupported installer contract platform: ${platform}`);
}

function buildPackageProfileManifestFields(packageProfileId) {
  if (packageProfileId === 'openclaw-only') {
    return {
      includedKernelIds: ['openclaw'],
      defaultEnabledKernelIds: ['openclaw'],
      requiredExternalRuntimes: ['nodejs'],
      optionalExternalRuntimes: [],
      launcherKinds: ['externalLocal'],
      kernelPlatformSupport: {
        openclaw: {
          windows: 'native',
          macos: 'native',
          linux: 'native',
        },
      },
    };
  }

  if (packageProfileId === 'hermes-only') {
    return {
      includedKernelIds: ['hermes'],
      defaultEnabledKernelIds: ['hermes'],
      requiredExternalRuntimes: ['python', 'uv'],
      optionalExternalRuntimes: ['nodejs'],
      launcherKinds: ['externalWslOrRemote'],
      kernelPlatformSupport: {
        hermes: {
          windows: 'wsl2OrRemoteOnly',
          macos: 'native',
          linux: 'native',
        },
      },
    };
  }

  if (packageProfileId === 'dual-kernel') {
    return {
      includedKernelIds: ['openclaw', 'hermes'],
      defaultEnabledKernelIds: ['openclaw', 'hermes'],
      requiredExternalRuntimes: ['nodejs', 'python', 'uv'],
      optionalExternalRuntimes: [],
      launcherKinds: ['externalLocal', 'externalWslOrRemote'],
      kernelPlatformSupport: {
        openclaw: {
          windows: 'native',
          macos: 'native',
          linux: 'native',
        },
        hermes: {
          windows: 'wsl2OrRemoteOnly',
          macos: 'native',
          linux: 'native',
        },
      },
    };
  }

  throw new Error(`Unsupported test package profile: ${packageProfileId}`);
}

function buildHermesExternalRuntimePolicy() {
  return {
    packagingPolicy: 'external-runtime-only',
    launcherKinds: ['externalWslOrRemote'],
    platformSupport: {
      windows: 'wsl2OrRemoteOnly',
      macos: 'native',
      linux: 'native',
    },
    runtimeRequirements: ['python', 'uv'],
    optionalRuntimeRequirements: ['nodejs'],
  };
}

function buildOpenClawExternalRuntimePolicy() {
  return {
    packagingPolicy: 'external-runtime-only',
    launcherKinds: ['externalLocal'],
    platformSupport: {
      windows: 'native',
      macos: 'native',
      linux: 'native',
    },
    runtimeRequirements: ['nodejs'],
    optionalRuntimeRequirements: [],
  };
}

function writeDesktopManifest({
  releaseAssetsDir,
  platform,
  arch,
  artifacts,
  packageProfileId = 'openclaw-only',
  includedKernelIds,
  defaultEnabledKernelIds,
  requiredExternalRuntimes,
  optionalExternalRuntimes,
  launcherKinds,
  kernelPlatformSupport,
  kernelInstallContracts = {
    openclaw: buildInstallerContract(platform),
  },
}) {
  const packageProfileManifestFields = buildPackageProfileManifestFields(packageProfileId);
  const manifestPath = path.join(
    releaseAssetsDir,
    'desktop',
    platform,
    arch,
    'release-asset-manifest.json',
  );

  writeJsonFile(manifestPath, {
    profileId: 'agent-studio',
    productName: 'Agent Studio',
    releaseTag: 'release-2026-04-05-01',
    packageProfileId,
    includedKernelIds: includedKernelIds ?? packageProfileManifestFields.includedKernelIds,
    defaultEnabledKernelIds:
      defaultEnabledKernelIds ?? packageProfileManifestFields.defaultEnabledKernelIds,
    requiredExternalRuntimes:
      requiredExternalRuntimes ?? packageProfileManifestFields.requiredExternalRuntimes,
    optionalExternalRuntimes:
      optionalExternalRuntimes ?? packageProfileManifestFields.optionalExternalRuntimes,
    launcherKinds: launcherKinds ?? packageProfileManifestFields.launcherKinds,
    kernelPlatformSupport:
      kernelPlatformSupport ?? packageProfileManifestFields.kernelPlatformSupport,
    platform,
    arch,
    ...(kernelInstallContracts !== undefined
      ? { kernelInstallContracts }
      : {}),
    artifacts,
  });

  return manifestPath;
}

function buildInstallReadyLayout({
  mode,
  installKey,
  cliEntryRelativePath = 'runtime/package/node_modules/openclaw/openclaw.mjs',
} = {}) {
  return {
    mode,
    installKey,
    reuseOnFirstLaunch: true,
    requiresArchiveExtractionOnFirstLaunch: false,
    manifestRelativePath: 'manifest.json',
    runtimeSidecarRelativePath: 'runtime/.sdkwork-openclaw-runtime.json',
    cliEntryRelativePath,
  };
}

test('desktop installer smoke module imports without vendored removed installer bindings', async () => {
  const smokePath = path.join(rootDir, 'scripts', 'release', 'smoke-desktop-installers.mjs');
  const source = readFileSync(smokePath, 'utf8');

  assert.doesNotMatch(source, /vendor\/[^/]+\/registry\//);
  assert.doesNotMatch(source, /resolveInstallerBindings/);
  assert.doesNotMatch(source, /loadInstallerModule/);
  assert.doesNotMatch(source, /ensureInstallerDistReady/);

  const smoke = await import(pathToFileURL(smokePath).href);
  assert.equal(typeof smoke.smokeDesktopInstallers, 'function');
});

test('desktop installer smoke exports local planning helpers for default dry-run summaries', async () => {
  const smokePath = path.join(rootDir, 'scripts', 'release', 'smoke-desktop-installers.mjs');
  const smoke = await import(pathToFileURL(smokePath).href);

  assert.equal(typeof smoke.resolveDesktopInstallerPlanningPlatform, 'function');
  assert.equal(typeof smoke.detectDesktopInstallerFormat, 'function');
  assert.equal(typeof smoke.createDesktopInstallPlan, 'function');
  assert.equal(smoke.resolveDesktopInstallerPlanningPlatform('linux'), 'ubuntu');
  assert.equal(smoke.resolveDesktopInstallerPlanningPlatform('windows'), 'windows');
  assert.equal(
    smoke.detectDesktopInstallerFormat('C:/tmp/Agent Studio_0.1.0_x64-setup.exe'),
    'exe',
  );
  assert.equal(
    smoke.detectDesktopInstallerFormat('/tmp/agent-studio_0.1.0_amd64.deb'),
    'deb',
  );

  const plan = await smoke.createDesktopInstallPlan({
    source: 'C:/tmp/Agent Studio_0.1.0_x64-setup.exe',
    platform: 'windows',
    format: 'exe',
    dryRun: true,
  });

  assert.equal(plan.request.platform, 'windows');
  assert.equal(plan.request.format, 'exe');
  assert.equal(plan.request.dryRun, true);
  assert.ok(Array.isArray(plan.steps));
  assert.ok(plan.steps.length > 0);
});

test('desktop installer smoke uses the default local planner when no installer functions are injected', async () => {
  const smokePath = path.join(rootDir, 'scripts', 'release', 'smoke-desktop-installers.mjs');
  const smoke = await import(pathToFileURL(smokePath).href);

  const tempRoot = mkdtempSync(path.join(os.tmpdir(), 'claw-smoke-desktop-default-planner-'));
  const releaseAssetsDir = path.join(tempRoot, 'release-assets');
  const installerRelativePath = 'desktop/windows/x64/nsis/Agent Studio_0.1.0_x64-setup.exe';

  try {
    writeArtifactFile(releaseAssetsDir, installerRelativePath);
    writeDesktopManifest({
      releaseAssetsDir,
      platform: 'windows',
      arch: 'x64',
      artifacts: [
        {
          name: 'Agent Studio_0.1.0_x64-setup.exe',
          relativePath: installerRelativePath,
          family: 'desktop',
          platform: 'windows',
          arch: 'x64',
          kind: 'installer',
          sha256: 'synthetic',
          size: readFileSync(path.join(releaseAssetsDir, installerRelativePath)).length,
        },
      ],
    });

    const result = await smoke.smokeDesktopInstallers({
      releaseAssetsDir,
      platform: 'windows',
      arch: 'x64',
      verifyDesktopOpenClawReleaseAssetsFn: async () => ({
        installReadyLayout: buildInstallReadyLayout({
          mode: 'archive-extract-ready',
          installKey: openClawInstallKey('windows', 'x64'),
        }),
      }),
      readDesktopOpenClawInstallerContractFn: async () => buildInstallerContract('windows'),
    });

    assert.equal(result.installPlans.length, 1);
    assert.equal(result.installPlans[0].artifact.relativePath, installerRelativePath);
    assert.equal(result.installPlans[0].plan.request.platform, 'windows');
    assert.equal(result.installPlans[0].plan.request.format, 'exe');
    assert.equal(result.installPlans[0].plan.request.dryRun, true);
  } finally {
    rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('desktop installer smoke skips OpenClaw runtime verification for hermes-only desktop package profiles', async () => {
  const smokePath = path.join(rootDir, 'scripts', 'release', 'smoke-desktop-installers.mjs');
  const smoke = await import(pathToFileURL(smokePath).href);

  const tempRoot = mkdtempSync(path.join(os.tmpdir(), 'claw-smoke-desktop-hermes-only-'));
  const releaseAssetsDir = path.join(tempRoot, 'release-assets');
  const installerRelativePath = 'desktop/windows/x64/nsis/Agent Studio_0.1.0_x64-setup.exe';

  try {
    writeArtifactFile(releaseAssetsDir, installerRelativePath);
    writeDesktopManifest({
      releaseAssetsDir,
      platform: 'windows',
      arch: 'x64',
      packageProfileId: 'hermes-only',
      includedKernelIds: ['hermes'],
      defaultEnabledKernelIds: ['hermes'],
      kernelInstallContracts: undefined,
      artifacts: [
        {
          name: 'Agent Studio_0.1.0_x64-setup.exe',
          relativePath: installerRelativePath,
          family: 'desktop',
          platform: 'windows',
          arch: 'x64',
          kind: 'installer',
          sha256: 'synthetic',
          size: readFileSync(path.join(releaseAssetsDir, installerRelativePath)).length,
        },
      ],
    });

    const result = await smoke.smokeDesktopInstallers({
      releaseAssetsDir,
      platform: 'windows',
      arch: 'x64',
      verifyDesktopOpenClawReleaseAssetsFn: async () => {
        throw new Error('hermes-only package must not invoke OpenClaw release asset verification');
      },
      readDesktopOpenClawInstallerContractFn: async () => {
        throw new Error('hermes-only package must not read an OpenClaw installer contract');
      },
    });

    assert.equal(result.installPlans.length, 1);
    const smokeReportPath = smoke.resolveDesktopInstallerSmokeReportPath({
      releaseAssetsDir,
      platform: 'windows',
      arch: 'x64',
    });
    const smokeReport = JSON.parse(readFileSync(smokeReportPath, 'utf8'));
    assert.equal('kernelInstallContracts' in smokeReport, false);
    assert.deepEqual(smokeReport.kernelInstallReadiness, {
      hermes: {
        externalRuntimePolicy: buildHermesExternalRuntimePolicy(),
      },
    });
  } finally {
    rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('desktop installer smoke rejects desktop manifests whose package-profile metadata drifts from the active kernel profile contract', async () => {
  const smokePath = path.join(rootDir, 'scripts', 'release', 'smoke-desktop-installers.mjs');
  const smoke = await import(pathToFileURL(smokePath).href);

  const tempRoot = mkdtempSync(path.join(os.tmpdir(), 'claw-smoke-desktop-profile-drift-'));
  const releaseAssetsDir = path.join(tempRoot, 'release-assets');
  const installerRelativePath = 'desktop/windows/x64/nsis/Agent Studio_0.1.0_x64-setup.exe';

  try {
    writeArtifactFile(releaseAssetsDir, installerRelativePath);
    writeDesktopManifest({
      releaseAssetsDir,
      platform: 'windows',
      arch: 'x64',
      packageProfileId: 'hermes-only',
      kernelPlatformSupport: {
        hermes: {
          windows: 'native',
          macos: 'native',
          linux: 'native',
        },
      },
      kernelInstallContracts: undefined,
      artifacts: [
        {
          name: 'Agent Studio_0.1.0_x64-setup.exe',
          relativePath: installerRelativePath,
          family: 'desktop',
          platform: 'windows',
          arch: 'x64',
          kind: 'installer',
          sha256: 'synthetic',
          size: readFileSync(path.join(releaseAssetsDir, installerRelativePath)).length,
        },
      ],
    });

    await assert.rejects(
      () => smoke.smokeDesktopInstallers({
        releaseAssetsDir,
        platform: 'windows',
        arch: 'x64',
        verifyDesktopOpenClawReleaseAssetsFn: async () => {
          throw new Error('profile-drift hermes-only package must not invoke OpenClaw verification');
        },
        readDesktopOpenClawInstallerContractFn: async () => {
          throw new Error('profile-drift hermes-only package must not read an OpenClaw installer contract');
        },
      }),
      /package-profile metadata/i,
    );
  } finally {
    rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('desktop installer smoke creates dry-run install plans for Windows installers after OpenClaw verification', async () => {
  const smokePath = path.join(rootDir, 'scripts', 'release', 'smoke-desktop-installers.mjs');
  const smoke = await import(pathToFileURL(smokePath).href);

  assert.equal(typeof smoke.smokeDesktopInstallers, 'function');
  assert.equal(typeof smoke.resolveDesktopInstallerSmokeReportPath, 'function');

  const tempRoot = mkdtempSync(path.join(os.tmpdir(), 'claw-smoke-desktop-windows-'));
  const releaseAssetsDir = path.join(tempRoot, 'release-assets');
  const installerRelativePath = 'desktop/windows/x64/nsis/Agent Studio_0.1.0_x64-setup.exe';

  try {
    writeArtifactFile(releaseAssetsDir, installerRelativePath);
    writeDesktopManifest({
      releaseAssetsDir,
      platform: 'windows',
      arch: 'x64',
      artifacts: [
        {
          name: 'Agent Studio_0.1.0_x64-setup.exe',
          relativePath: installerRelativePath,
          family: 'desktop',
          platform: 'windows',
          arch: 'x64',
          kind: 'installer',
          sha256: 'synthetic',
          size: readFileSync(path.join(releaseAssetsDir, installerRelativePath)).length,
        },
      ],
    });

    const callOrder = [];
    const planRequests = [];
    const result = await smoke.smokeDesktopInstallers({
      releaseAssetsDir,
      platform: 'windows',
      arch: 'x64',
      verifyDesktopOpenClawReleaseAssetsFn: async () => {
        callOrder.push('verify');
        return {
          installReadyLayout: buildInstallReadyLayout({
            mode: 'archive-extract-ready',
            installKey: openClawInstallKey('windows', 'x64'),
          }),
        };
      },
      detectFormatFn(source) {
        callOrder.push('detect');
        return path.extname(source).slice(1).toLowerCase();
      },
      createInstallPlanFn: async (request) => {
        callOrder.push('plan');
        planRequests.push(request);
        return {
          request,
          steps: [
            {
              id: 'install-exe',
              description: 'synthetic windows install',
              command: 'installer.exe',
            },
          ],
          notes: [],
        };
      },
    });

    assert.deepEqual(callOrder, ['verify', 'detect', 'plan']);
    assert.equal(planRequests.length, 1);
    assert.equal(planRequests[0].platform, 'windows');
    assert.equal(planRequests[0].format, 'exe');
    assert.equal(planRequests[0].dryRun, true);
    assert.equal(
      planRequests[0].source.replaceAll('\\', '/'),
      path.join(releaseAssetsDir, installerRelativePath).replaceAll('\\', '/'),
    );
    assert.equal(result.installPlans.length, 1);
    assert.equal(result.installPlans[0].artifact.relativePath, installerRelativePath);
    const smokeReportPath = smoke.resolveDesktopInstallerSmokeReportPath({
      releaseAssetsDir,
      platform: 'windows',
      arch: 'x64',
    });
    const smokeReport = JSON.parse(readFileSync(smokeReportPath, 'utf8'));
    assert.equal(smokeReport.platform, 'windows');
    assert.equal(smokeReport.arch, 'x64');
    assert.equal(
      smokeReport.manifestPath.replaceAll('\\', '/'),
      path.join(releaseAssetsDir, 'desktop', 'windows', 'x64', 'release-asset-manifest.json').replaceAll('\\', '/'),
    );
    assert.deepEqual(smokeReport.installableArtifactRelativePaths, [installerRelativePath]);
    assert.deepEqual(
      smokeReport.kernelInstallReadiness,
      {
        openclaw: {
          externalRuntimePolicy: buildOpenClawExternalRuntimePolicy(),
          installReadyLayout: buildInstallReadyLayout({
            mode: 'archive-extract-ready',
            installKey: openClawInstallKey('windows', 'x64'),
          }),
        },
      },
    );
  } finally {
    rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('desktop installer smoke plans every Linux installable artifact through local dry-run mode', async () => {
  const smokePath = path.join(rootDir, 'scripts', 'release', 'smoke-desktop-installers.mjs');
  const smoke = await import(pathToFileURL(smokePath).href);

  const tempRoot = mkdtempSync(path.join(os.tmpdir(), 'claw-smoke-desktop-linux-'));
  const releaseAssetsDir = path.join(tempRoot, 'release-assets');
  const debRelativePath = 'desktop/linux/x64/deb/agent-studio_0.1.0_amd64.deb';
  const rpmRelativePath = 'desktop/linux/x64/rpm/agent-studio-0.1.0-1.x86_64.rpm';

  try {
    writeArtifactFile(releaseAssetsDir, debRelativePath);
    writeArtifactFile(releaseAssetsDir, rpmRelativePath);
    writeDesktopManifest({
      releaseAssetsDir,
      platform: 'linux',
      arch: 'x64',
      artifacts: [
        {
          name: 'agent-studio_0.1.0_amd64.deb',
          relativePath: debRelativePath,
          family: 'desktop',
          platform: 'linux',
          arch: 'x64',
          kind: 'package',
          sha256: 'deb',
          size: 10,
        },
        {
          name: 'agent-studio-0.1.0-1.x86_64.rpm',
          relativePath: rpmRelativePath,
          family: 'desktop',
          platform: 'linux',
          arch: 'x64',
          kind: 'package',
          sha256: 'rpm',
          size: 11,
        },
      ],
    });

    const planRequests = [];
    const result = await smoke.smokeDesktopInstallers({
      releaseAssetsDir,
      platform: 'linux',
      arch: 'x64',
      verifyDesktopOpenClawReleaseAssetsFn: async () => ({
        installReadyLayout: buildInstallReadyLayout({
          mode: 'archive-extract-ready',
          installKey: openClawInstallKey('linux', 'x64'),
        }),
      }),
      detectFormatFn(source) {
        return path.extname(source).slice(1).toLowerCase();
      },
      createInstallPlanFn: async (request) => {
        planRequests.push(request);
        return {
          request,
          steps: [
            {
              id: `install-${request.format}`,
              description: 'synthetic linux install',
              command: 'installer',
            },
          ],
          notes: [],
        };
      },
    });

    assert.deepEqual(
      planRequests.map((request) => ({
        platform: request.platform,
        format: request.format,
        dryRun: request.dryRun,
      })),
      [
        {
          platform: 'ubuntu',
          format: 'deb',
          dryRun: true,
        },
        {
          platform: 'ubuntu',
          format: 'rpm',
          dryRun: true,
        },
      ],
    );
    assert.equal(result.installPlans.length, 2);
  } finally {
    rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('desktop installer smoke rejects verification results that do not prove an install-ready OpenClaw layout', async () => {
  const smokePath = path.join(rootDir, 'scripts', 'release', 'smoke-desktop-installers.mjs');
  const smoke = await import(pathToFileURL(smokePath).href);

  const tempRoot = mkdtempSync(path.join(os.tmpdir(), 'claw-smoke-desktop-install-ready-'));
  const releaseAssetsDir = path.join(tempRoot, 'release-assets');
  const installerRelativePath = 'desktop/windows/x64/nsis/Agent Studio_0.1.0_x64-setup.exe';

  try {
    writeArtifactFile(releaseAssetsDir, installerRelativePath);
    writeDesktopManifest({
      releaseAssetsDir,
      platform: 'windows',
      arch: 'x64',
      artifacts: [
        {
          name: 'Agent Studio_0.1.0_x64-setup.exe',
          relativePath: installerRelativePath,
          family: 'desktop',
          platform: 'windows',
          arch: 'x64',
          kind: 'installer',
          sha256: 'synthetic',
          size: readFileSync(path.join(releaseAssetsDir, installerRelativePath)).length,
        },
      ],
    });

    await assert.rejects(
      () => smoke.smokeDesktopInstallers({
        releaseAssetsDir,
        platform: 'windows',
        arch: 'x64',
        verifyDesktopOpenClawReleaseAssetsFn: async () => ({}),
        detectFormatFn(source) {
          return path.extname(source).slice(1).toLowerCase();
        },
        createInstallPlanFn: async (request) => ({
          request,
          steps: [],
          notes: [],
        }),
      }),
      /install-ready|installReadyLayout/i,
    );
  } finally {
    rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('desktop installer smoke rejects install-ready layout evidence whose mode does not match the target platform contract', async () => {
  const smokePath = path.join(rootDir, 'scripts', 'release', 'smoke-desktop-installers.mjs');
  const smoke = await import(pathToFileURL(smokePath).href);

  const tempRoot = mkdtempSync(path.join(os.tmpdir(), 'claw-smoke-desktop-install-ready-mode-'));
  const releaseAssetsDir = path.join(tempRoot, 'release-assets');
  const installerRelativePath = 'desktop/windows/x64/nsis/Agent Studio_0.1.0_x64-setup.exe';

  try {
    writeArtifactFile(releaseAssetsDir, installerRelativePath);
    writeDesktopManifest({
      releaseAssetsDir,
      platform: 'windows',
      arch: 'x64',
      artifacts: [
        {
          name: 'Agent Studio_0.1.0_x64-setup.exe',
          relativePath: installerRelativePath,
          family: 'desktop',
          platform: 'windows',
          arch: 'x64',
          kind: 'installer',
          sha256: 'synthetic',
          size: readFileSync(path.join(releaseAssetsDir, installerRelativePath)).length,
        },
      ],
    });

    await assert.rejects(
      () => smoke.smokeDesktopInstallers({
        releaseAssetsDir,
        platform: 'windows',
        arch: 'x64',
        verifyDesktopOpenClawReleaseAssetsFn: async () => ({
          installReadyLayout: buildInstallReadyLayout({
            mode: 'staged-layout',
            installKey: openClawInstallKey('windows', 'x64'),
          }),
        }),
        detectFormatFn(source) {
          return path.extname(source).slice(1).toLowerCase();
        },
        createInstallPlanFn: async (request) => ({
          request,
          steps: [],
          notes: [],
        }),
      }),
      /install-ready|installReadyLayout|archive-extract-ready/i,
    );
  } finally {
    rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('desktop installer smoke requires a macOS dmg plan target and a bundled app archive companion', async () => {
  const smokePath = path.join(rootDir, 'scripts', 'release', 'smoke-desktop-installers.mjs');
  const smoke = await import(pathToFileURL(smokePath).href);

  const tempRoot = mkdtempSync(path.join(os.tmpdir(), 'claw-smoke-desktop-macos-'));
  const releaseAssetsDir = path.join(tempRoot, 'release-assets');
  const dmgRelativePath = 'desktop/macos/arm64/dmg/Agent Studio_0.1.0_aarch64.dmg';
  const archiveRelativePath = 'desktop/macos/arm64/macos/Agent Studio_0.1.0_arm64.app.zip';

  try {
    writeArtifactFile(releaseAssetsDir, dmgRelativePath);
    writeZipArtifactFile(releaseAssetsDir, archiveRelativePath, [
      {
        name: 'Agent Studio.app/Contents/MacOS/agent-studio',
        content: 'synthetic app binary\n',
      },
    ]);
    writeDesktopManifest({
      releaseAssetsDir,
      platform: 'macos',
      arch: 'arm64',
      artifacts: [
        {
          name: 'Agent Studio_0.1.0_aarch64.dmg',
          relativePath: dmgRelativePath,
          family: 'desktop',
          platform: 'macos',
          arch: 'arm64',
          kind: 'installer',
          sha256: 'dmg',
          size: 20,
        },
        {
          name: 'Agent Studio_0.1.0_arm64.app.zip',
          relativePath: archiveRelativePath,
          family: 'desktop',
          platform: 'macos',
          arch: 'arm64',
          kind: 'archive',
          sha256: 'zip',
          size: 21,
        },
      ],
    });

    const planRequests = [];
    const result = await smoke.smokeDesktopInstallers({
      releaseAssetsDir,
      platform: 'macos',
      arch: 'arm64',
      verifyDesktopOpenClawReleaseAssetsFn: async () => ({
        installReadyLayout: buildInstallReadyLayout({
          mode: 'staged-layout',
          installKey: openClawInstallKey('macos', 'arm64'),
        }),
      }),
      detectFormatFn(source) {
        const lowerCaseSource = source.toLowerCase();
        if (lowerCaseSource.endsWith('.app.zip')) {
          return 'zip';
        }
        return path.extname(source).slice(1).toLowerCase();
      },
      createInstallPlanFn: async (request) => {
        planRequests.push(request);
        return {
          request,
          steps: [
            {
              id: `install-${request.format}`,
              description: 'synthetic macos install',
              command: 'installer',
            },
          ],
          notes: [],
        };
      },
    });

    assert.equal(planRequests.length, 1);
    assert.equal(planRequests[0].platform, 'macos');
    assert.equal(planRequests[0].format, 'dmg');
    assert.equal(result.installPlans.length, 1);
    assert.equal(result.requiredCompanionArtifacts.length, 1);
    assert.equal(result.requiredCompanionArtifacts[0].relativePath, archiveRelativePath);
  } finally {
    rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('desktop installer smoke rejects unsafe macOS app archive companion entries', async () => {
  const smokePath = path.join(rootDir, 'scripts', 'release', 'smoke-desktop-installers.mjs');
  const smoke = await import(pathToFileURL(smokePath).href);

  const tempRoot = mkdtempSync(path.join(os.tmpdir(), 'claw-smoke-desktop-macos-unsafe-app-'));
  const releaseAssetsDir = path.join(tempRoot, 'release-assets');
  const dmgRelativePath = 'desktop/macos/arm64/dmg/Agent Studio_0.1.0_aarch64.dmg';
  const archiveRelativePath = 'desktop/macos/arm64/macos/Agent Studio_0.1.0_arm64.app.zip';

  try {
    writeArtifactFile(releaseAssetsDir, dmgRelativePath);
    writeZipArtifactFile(releaseAssetsDir, archiveRelativePath, [
      {
        name: 'Agent Studio.app/Contents/MacOS/agent-studio',
        content: 'synthetic app binary\n',
      },
      {
        name: 'Agent Studio.app/Contents/MacOS/agent-studio-link',
        content: 'agent-studio',
        externalAttributes: 0o120777 << 16,
      },
    ]);
    writeDesktopManifest({
      releaseAssetsDir,
      platform: 'macos',
      arch: 'arm64',
      packageProfileId: 'hermes-only',
      kernelInstallContracts: undefined,
      artifacts: [
        {
          name: 'Agent Studio_0.1.0_aarch64.dmg',
          relativePath: dmgRelativePath,
          family: 'desktop',
          platform: 'macos',
          arch: 'arm64',
          kind: 'installer',
          sha256: 'dmg',
          size: 20,
        },
        {
          name: 'Agent Studio_0.1.0_arm64.app.zip',
          relativePath: archiveRelativePath,
          family: 'desktop',
          platform: 'macos',
          arch: 'arm64',
          kind: 'archive',
          sha256: 'zip',
          size: readFileSync(path.join(releaseAssetsDir, archiveRelativePath)).length,
        },
      ],
    });

    await assert.rejects(
      () => smoke.smokeDesktopInstallers({
        releaseAssetsDir,
        platform: 'macos',
        arch: 'arm64',
        verifyDesktopOpenClawReleaseAssetsFn: async () => {
          throw new Error('hermes-only package must not invoke OpenClaw verification');
        },
        readDesktopOpenClawInstallerContractFn: async () => {
          throw new Error('hermes-only package must not read an OpenClaw installer contract');
        },
        detectFormatFn(source) {
          return path.extname(source).slice(1).toLowerCase();
        },
        createInstallPlanFn: async (request) => ({
          request,
          steps: [],
          notes: [],
        }),
      }),
      /unsupported archive entry type/i,
    );
  } finally {
    rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('desktop installer smoke rejects a macOS release manifest that is missing the bundled app archive companion', async () => {
  const smokePath = path.join(rootDir, 'scripts', 'release', 'smoke-desktop-installers.mjs');
  const smoke = await import(pathToFileURL(smokePath).href);

  const tempRoot = mkdtempSync(path.join(os.tmpdir(), 'claw-smoke-desktop-macos-missing-app-'));
  const releaseAssetsDir = path.join(tempRoot, 'release-assets');
  const dmgRelativePath = 'desktop/macos/x64/dmg/Agent Studio_0.1.0_x64.dmg';

  try {
    writeArtifactFile(releaseAssetsDir, dmgRelativePath);
    writeDesktopManifest({
      releaseAssetsDir,
      platform: 'macos',
      arch: 'x64',
      artifacts: [
        {
          name: 'Agent Studio_0.1.0_x64.dmg',
          relativePath: dmgRelativePath,
          family: 'desktop',
          platform: 'macos',
          arch: 'x64',
          kind: 'installer',
          sha256: 'dmg',
          size: 22,
        },
      ],
    });

    await assert.rejects(
      () => smoke.smokeDesktopInstallers({
        releaseAssetsDir,
        platform: 'macos',
        arch: 'x64',
        verifyDesktopOpenClawReleaseAssetsFn: async () => ({
          installReadyLayout: buildInstallReadyLayout({
            mode: 'staged-layout',
            installKey: openClawInstallKey('macos', 'x64'),
          }),
        }),
        detectFormatFn(source) {
          return path.extname(source).slice(1).toLowerCase();
        },
        createInstallPlanFn: async (request) => ({
          request,
          steps: [],
          notes: [],
        }),
      }),
      /Missing macOS desktop app archive/,
    );
  } finally {
    rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('desktop installer smoke rejects manifests whose persisted OpenClaw installer contract is missing or stale', async () => {
  const smokePath = path.join(rootDir, 'scripts', 'release', 'smoke-desktop-installers.mjs');
  const smoke = await import(pathToFileURL(smokePath).href);

  const tempRoot = mkdtempSync(path.join(os.tmpdir(), 'claw-smoke-desktop-contract-'));
  const releaseAssetsDir = path.join(tempRoot, 'release-assets');
  const installerRelativePath = 'desktop/windows/x64/nsis/Agent Studio_0.1.0_x64-setup.exe';
  const expectedInstallerContract = {
    version: 2,
    platform: 'windows',
    delivery: 'archive-only-resources',
    installMode: 'first-launch-archive-extract',
    bundledResourceRoot: 'resources/openclaw/',
    runtimeArchive: 'resources/openclaw/runtime.zip',
    sourceConfigPath: 'packages/sdkwork-agentstudio-pc-desktop/src-tauri/tauri.windows.conf.json',
    requiredExternalRuntimes: ['nodejs'],
  };

  try {
    writeArtifactFile(releaseAssetsDir, installerRelativePath);
    const manifestPath = writeDesktopManifest({
      releaseAssetsDir,
      platform: 'windows',
      arch: 'x64',
      kernelInstallContracts: null,
      artifacts: [
        {
          name: 'Agent Studio_0.1.0_x64-setup.exe',
          relativePath: installerRelativePath,
          family: 'desktop',
          platform: 'windows',
          arch: 'x64',
          kind: 'installer',
          sha256: 'synthetic',
          size: readFileSync(path.join(releaseAssetsDir, installerRelativePath)).length,
        },
      ],
    });

    await assert.rejects(
      () => smoke.smokeDesktopInstallers({
        releaseAssetsDir,
        platform: 'windows',
        arch: 'x64',
        verifyDesktopOpenClawReleaseAssetsFn: async () => ({
          installReadyLayout: buildInstallReadyLayout({
            mode: 'archive-extract-ready',
            installKey: openClawInstallKey('windows', 'x64'),
          }),
        }),
        detectFormatFn(source) {
          return path.extname(source).slice(1).toLowerCase();
        },
        createInstallPlanFn: async (request) => ({
          request,
          steps: [],
          notes: [],
        }),
        readDesktopOpenClawInstallerContractFn: async () => expectedInstallerContract,
      }),
      /OpenClaw installer contract/i,
    );

    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
    manifest.kernelInstallContracts = {
      openclaw: {
        ...expectedInstallerContract,
        prepareFailureMode: 'defer-install',
      },
    };
    writeJsonFile(manifestPath, manifest);

    await assert.rejects(
      () => smoke.smokeDesktopInstallers({
        releaseAssetsDir,
        platform: 'windows',
        arch: 'x64',
        verifyDesktopOpenClawReleaseAssetsFn: async () => ({
          installReadyLayout: buildInstallReadyLayout({
            mode: 'archive-extract-ready',
            installKey: openClawInstallKey('windows', 'x64'),
          }),
        }),
        detectFormatFn(source) {
          return path.extname(source).slice(1).toLowerCase();
        },
        createInstallPlanFn: async (request) => ({
          request,
          steps: [],
          notes: [],
        }),
        readDesktopOpenClawInstallerContractFn: async () => expectedInstallerContract,
      }),
      /OpenClaw installer contract/i,
    );
  } finally {
    rmSync(tempRoot, { recursive: true, force: true });
  }
});
