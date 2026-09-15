// WORKSPACE-PATH:allow-fixture: fixtures name a foreign checkout root, drive, or home directory to exercise path handling, so the literal is the value under assertion rather than a binding this build resolves
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { pathToFileURL } from 'node:url';

import { DEFAULT_OPENCLAW_VERSION } from '../openclaw-release.mjs';

const rootDir = path.resolve(import.meta.dirname, '..', '..');
const BUILT_IN_INSTANCE_ID = 'managed-openclaw-primary';
const currentOpenClawWindowsInstallKey = `${DEFAULT_OPENCLAW_VERSION}-windows-x64`;

function fileEvidenceMetadata(filePath, prefix) {
  return {
    [`${prefix}Sha256`]: createHash('sha256').update(readFileSync(filePath)).digest('hex'),
    [`${prefix}Size`]: statSync(filePath).size,
  };
}

function fileSha256(filePath) {
  return createHash('sha256').update(readFileSync(filePath)).digest('hex');
}

function stringSha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

function writeReleaseNotesFixture(releaseAssetsDir, content = '# Agent Studio Release\n\nRelease notes.\n') {
  writeFileSync(path.join(releaseAssetsDir, 'release-notes.md'), content, 'utf8');
}

function releaseNotesMetadataFor(releaseAssetsDir) {
  const releaseNotesPath = path.join(releaseAssetsDir, 'release-notes.md');
  return {
    kind: 'release-notes',
    purpose: 'github-release-body',
    relativePath: 'release-notes.md',
    sha256: fileSha256(releaseNotesPath),
    size: statSync(releaseNotesPath).size,
    required: true,
  };
}

function commonSmokeEvidenceMetadata({
  reportPath,
  manifestPath,
}) {
  return {
    ...fileEvidenceMetadata(reportPath, 'report'),
    ...fileEvidenceMetadata(manifestPath, 'manifest'),
  };
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

  throw new Error(`Unsupported installer contract platform: ${platform}`);
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

function buildDesktopStartupSmokeReport({
  manifestPath,
  capturedEvidenceRelativePath = 'desktop/windows/x64/diagnostics/desktop-startup-evidence.json',
  target = 'x86_64-pc-windows-msvc',
  packageProfileId = 'openclaw-only',
  includedKernelIds = ['openclaw'],
  defaultEnabledKernelIds = ['openclaw'],
  artifactRelativePaths = [
    'desktop/windows/x64/Claw.Studio_0.1.0_x64-setup.exe',
  ],
  localAiProxyRuntime = {
    lifecycle: 'running',
    messageCaptureEnabled: true,
    observabilityDbPath: 'C:/Users/test/AppData/Roaming/Agent Studio/store/local-ai-proxy-observability.sqlite3',
    snapshotPath: 'C:/Users/test/AppData/Roaming/Agent Studio/state/local-ai-proxy.snapshot.json',
    logPath: 'C:/Users/test/AppData/Roaming/Agent Studio/logs/local-ai-proxy.log',
  },
  checks = [
    {
      id: 'startup-status',
      status: 'passed',
      detail: 'desktop startup evidence recorded a passed launch',
    },
    {
      id: 'startup-phase',
      status: 'passed',
      detail: 'desktop startup evidence recorded shell-mounted phase',
    },
    {
      id: 'runtime-readiness',
      status: 'passed',
      detail: 'desktop startup evidence preserved ready runtime invariants',
    },
    {
      id: 'built-in-instance',
      status: 'passed',
      detail: 'desktop startup evidence preserved the built-in OpenClaw instance projection',
    },
    {
      id: 'gateway-websocket',
      status: 'passed',
      detail: 'desktop startup evidence proved the OpenClaw gateway websocket was dialable',
    },
    {
      id: 'local-ai-proxy-runtime',
      status: 'passed',
      detail: 'desktop startup evidence preserved local ai proxy runtime lifecycle and artifact paths',
    },
  ],
} = {}) {
  return {
    platform: 'windows',
    arch: 'x64',
    target,
    status: 'passed',
    phase: 'shell-mounted',
    verifiedAt: '2026-04-06T12:13:14.000Z',
    manifestPath,
    capturedEvidenceRelativePath,
    packageProfileId,
    includedKernelIds,
    defaultEnabledKernelIds,
    descriptorBrowserBaseUrl: 'http://127.0.0.1:19797',
    builtInInstanceId: BUILT_IN_INSTANCE_ID,
    builtInInstanceStatus: 'online',
    localAiProxyRuntime,
    artifactRelativePaths,
    checks,
  };
}

function writePassingDesktopStartupSmokeFixture({
  windowsDir,
  manifestPath,
  artifactRelativePath = 'desktop/windows/x64/Claw.Studio_0.1.0_x64-setup.exe',
  packageProfileId = 'openclaw-only',
  includedKernelIds = ['openclaw'],
  defaultEnabledKernelIds = ['openclaw'],
} = {}) {
  const diagnosticsDir = path.join(windowsDir, 'diagnostics');
  mkdirSync(diagnosticsDir, { recursive: true });
  writeFileSync(
    path.join(diagnosticsDir, 'desktop-startup-evidence.json'),
    `${JSON.stringify({
      version: 2,
      status: 'passed',
      phase: 'shell-mounted',
      runId: 2,
      durationMs: 1842,
      recordedAt: '2026-04-06T12:13:14.000Z',
      descriptor: {
        browserBaseUrl: 'http://127.0.0.1:19797',
      },
      builtInInstance: {
        id: BUILT_IN_INSTANCE_ID,
        status: 'online',
      },
      localAiProxy: {
        lifecycle: 'running',
        messageCaptureEnabled: true,
        observabilityDbPath: 'C:/Users/test/AppData/Roaming/Agent Studio/store/local-ai-proxy-observability.sqlite3',
        snapshotPath: 'C:/Users/test/AppData/Roaming/Agent Studio/state/local-ai-proxy.snapshot.json',
        logPath: 'C:/Users/test/AppData/Roaming/Agent Studio/logs/local-ai-proxy.log',
      },
      readinessEvidence: {
        ready: true,
        gatewayWebsocketDialable: true,
      },
    }, null, 2)}\n`,
    'utf8',
  );
  writeFileSync(
    path.join(windowsDir, 'desktop-startup-smoke-report.json'),
    `${JSON.stringify(buildDesktopStartupSmokeReport({
      manifestPath,
      packageProfileId,
      includedKernelIds,
      defaultEnabledKernelIds,
      artifactRelativePaths: [artifactRelativePath],
    }), null, 2)}\n`,
    'utf8',
  );
}

function buildServerSmokeReport({
  manifestPath,
  platform = 'linux',
  arch = 'x64',
  target = 'x86_64-unknown-linux-gnu',
  artifactRelativePaths = [
    'server/linux/x64/agent-studio-server-release-2026-04-03-08-linux-x64.tar.gz',
  ],
  launcherRelativePath = platform === 'windows' ? 'bin/agentstudio-server.exe' : 'bin/agentstudio-server',
} = {}) {
  return {
    family: 'server',
    platform,
    arch,
    target,
    smokeKind: 'bundle-runtime',
    status: 'passed',
    verifiedAt: '2026-04-06T09:08:07.000Z',
    manifestPath,
    artifactRelativePaths,
    launcherRelativePath,
    runtimeBaseUrl: 'http://127.0.0.1:19797',
    checks: [
      {
        id: 'health-ready',
        status: 'passed',
        detail: '/claw/health/ready returned 200',
      },
      {
        id: 'host-endpoints',
        status: 'passed',
        detail: '/claw/manage/v1/host-endpoints returned canonical endpoints',
      },
      {
        id: 'browser-shell',
        status: 'passed',
        detail: '/ returned bundled browser shell HTML',
      },
    ],
  };
}

function buildWebSmokeReport({
  manifestPath,
  artifactRelativePaths = [
    'agent-studio-web-assets-release-2026-04-11-04.tar.gz',
  ],
  checks = [
    {
      id: 'artifact-checksum',
      status: 'passed',
      detail: 'archive checksum matches manifest and sidecar metadata',
    },
    {
      id: 'web-index',
      status: 'passed',
      detail: 'web/dist/index.html is present in the archive',
    },
    {
      id: 'web-assets',
      status: 'passed',
      detail: 'web/dist/assets contains browser assets',
    },
    {
      id: 'docs-index',
      status: 'passed',
      detail: 'docs/dist/index.html is present in the archive',
    },
    {
      id: 'docs-404',
      status: 'passed',
      detail: 'docs/dist/404.html is present in the archive',
    },
    {
      id: 'docs-search-index',
      status: 'passed',
      detail: 'docs/dist/search-index.json is present and parseable',
    },
    {
      id: 'public-doc-boundary',
      status: 'passed',
      detail: 'docs/dist excludes internal-only documentation directories',
    },
  ],
} = {}) {
  return {
    family: 'web',
    platform: 'web',
    arch: 'any',
    target: '',
    smokeKind: 'web-archive-content',
    status: 'passed',
    verifiedAt: '2026-04-11T08:09:10.000Z',
    manifestPath,
    artifactRelativePaths,
    launcherRelativePath: '',
    runtimeBaseUrl: '',
    checks,
  };
}

function buildContainerDeploymentChecks() {
  return [
    {
      id: 'deployment-identity',
      status: 'passed',
      detail: 'packaged container bundle preserves deployment family and accelerator identity',
    },
    {
      id: 'runtime-profile',
      status: 'passed',
      detail: 'packaged container profile pins safe public bind and data directory defaults',
    },
    {
      id: 'manage-credentials',
      status: 'passed',
      detail: 'packaged docker compose requires explicit manage credentials',
    },
    {
      id: 'persistent-storage',
      status: 'passed',
      detail: 'packaged docker compose persists /var/lib/agentstudio-server',
    },
    {
      id: 'docker-compose-up',
      status: 'passed',
      detail: 'docker compose brought the packaged bundle online',
    },
    {
      id: 'docker-compose-healthy',
      status: 'passed',
      detail: 'docker compose reported all packaged services healthy',
    },
    {
      id: 'health-ready',
      status: 'passed',
      detail: '/claw/health/ready returned 200',
    },
    {
      id: 'host-endpoints',
      status: 'passed',
      detail: '/claw/manage/v1/host-endpoints returned canonical endpoints',
    },
    {
      id: 'browser-shell',
      status: 'passed',
      detail: '/ returned bundled browser shell HTML',
    },
  ];
}

function buildKubernetesDeploymentChecks() {
  return [
    {
      id: 'helm-template',
      status: 'passed',
      detail: 'helm template rendered the packaged chart successfully',
    },
    {
      id: 'deployment-identity',
      status: 'passed',
      detail: 'packaged kubernetes bundle preserves target architecture and accelerator identity',
    },
    {
      id: 'image-reference',
      status: 'passed',
      detail: 'rendered manifests reference the packaged OCI image coordinates',
    },
    {
      id: 'configmap-runtime-identity',
      status: 'passed',
      detail: 'rendered config map preserves kubernetes deployment family and accelerator profile',
    },
    {
      id: 'readiness-probe',
      status: 'passed',
      detail: 'rendered deployment probes /claw/health/ready',
    },
    {
      id: 'secret-ref',
      status: 'passed',
      detail: 'rendered deployment consumes Secret-backed control-plane credentials',
    },
    {
      id: 'persistent-storage',
      status: 'passed',
      detail: 'rendered manifests mount /var/lib/agentstudio-server through a PersistentVolumeClaim',
    },
  ];
}

function buildDefaultDeploymentChecks(family) {
  return family === 'container'
    ? buildContainerDeploymentChecks()
    : buildKubernetesDeploymentChecks();
}

function buildDeploymentChecksWithout(family, missingCheckId) {
  return buildDefaultDeploymentChecks(family).filter(
    (check) => check.id !== missingCheckId,
  );
}

function buildDeploymentSmokeReport({
  family,
  manifestPath,
  platform = 'linux',
  arch = 'x64',
  accelerator = 'cpu',
  target = 'x86_64-unknown-linux-gnu',
  smokeKind = family === 'container' ? 'live-deployment' : 'chart-render',
  status = 'passed',
  artifactRelativePaths = [],
  launcherRelativePath = family === 'container' ? 'deployments/docker/docker-compose.yml' : 'chart/Chart.yaml',
  runtimeBaseUrl = family === 'container' ? 'http://127.0.0.1:18797' : '',
  checks = buildDefaultDeploymentChecks(family),
  skippedReason = '',
  capabilities,
} = {}) {
  return {
    family,
    platform,
    arch,
    accelerator,
    target,
    smokeKind,
    status,
    verifiedAt: '2026-04-06T10:11:12.000Z',
    manifestPath,
    artifactRelativePaths,
    launcherRelativePath,
    runtimeBaseUrl,
    checks,
    ...(String(skippedReason ?? '').trim()
      ? { skippedReason: String(skippedReason ?? '').trim() }
      : {}),
    ...(capabilities ? { capabilities } : {}),
  };
}

test('release asset finalizer writes a global checksum manifest and release manifest from partial package outputs', async () => {
  const finalizerPath = path.join(rootDir, 'scripts', 'release', 'finalize-release-assets.mjs');
  assert.equal(existsSync(finalizerPath), true, 'missing scripts/release/finalize-release-assets.mjs');

  const finalizer = await import(pathToFileURL(finalizerPath).href);
  assert.equal(typeof finalizer.parseArgs, 'function');
  assert.equal(typeof finalizer.finalizeReleaseAssets, 'function');
  assert.throws(
    () => finalizer.parseArgs(['--release-tag']),
    /Missing value for --release-tag/,
  );
  assert.equal(
    finalizer.parseArgs(['--release-tag', 'release-2026-03-31-03', '--allow-partial-release']).allowPartialRelease,
    true,
  );

  const tempRoot = mkdtempSync(path.join(os.tmpdir(), 'claw-release-finalize-'));
  const releaseAssetsDir = path.join(tempRoot, 'release-assets');
  const windowsDir = path.join(releaseAssetsDir, 'desktop', 'windows', 'x64');
  const legacyWindowsDir = path.join(releaseAssetsDir, 'desktop', 'windows', 'nsis');
  const staleArm64WindowsDir = path.join(releaseAssetsDir, 'desktop', 'windows', 'arm64');
  const webDir = path.join(releaseAssetsDir, 'web');

  try {
    mkdirSync(windowsDir, { recursive: true });
    mkdirSync(legacyWindowsDir, { recursive: true });
    mkdirSync(staleArm64WindowsDir, { recursive: true });
    mkdirSync(webDir, { recursive: true });

    const windowsAssetPath = path.join(windowsDir, 'Claw.Studio_0.1.0_x64-setup.exe');
    const webAssetPath = path.join(webDir, 'agent-studio-web-assets-release-2026-03-31-03.tar.gz');
    const staleLegacyWindowsAssetPath = path.join(
      legacyWindowsDir,
      'Claw.Studio_0.1.0_x64-setup.exe',
    );
    const staleTopLevelWebAssetPath = path.join(
      releaseAssetsDir,
      'agent-studio-web-assets-release-2026-03-20-legacy.tar.gz',
    );
    const staleArm64WindowsAssetPath = path.join(
      staleArm64WindowsDir,
      'Claw.Studio_0.1.0_arm64-setup.exe',
    );

    writeFileSync(windowsAssetPath, 'windows-installer', 'utf8');
    writeFileSync(webAssetPath, 'web-assets', 'utf8');
    writeFileSync(
      `${windowsAssetPath}.sha256.txt`,
      `${stringSha256('windows-installer')}  Claw.Studio_0.1.0_x64-setup.exe\n`,
      'utf8',
    );
    writeFileSync(
      `${webAssetPath}.sha256.txt`,
      `${stringSha256('web-assets')}  agent-studio-web-assets-release-2026-03-31-03.tar.gz\n`,
      'utf8',
    );
    writeFileSync(staleLegacyWindowsAssetPath, 'stale-desktop-installer', 'utf8');
    writeFileSync(staleTopLevelWebAssetPath, 'stale-web-assets', 'utf8');
    writeFileSync(staleArm64WindowsAssetPath, 'stale-arm64-installer', 'utf8');
    writeFileSync(
      path.join(windowsDir, 'release-asset-manifest.json'),
      `${JSON.stringify({
        profileId: 'agent-studio',
        releaseTag: 'release-2026-03-31-03',
        packageProfileId: 'openclaw-only',
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
        platform: 'windows',
        arch: 'x64',
        kernelInstallContracts: {
          openclaw: buildInstallerContract('windows'),
        },
        artifacts: [
          {
            name: 'Claw.Studio_0.1.0_x64-setup.exe',
            relativePath: 'desktop/windows/x64/Claw.Studio_0.1.0_x64-setup.exe',
            platform: 'windows',
            arch: 'x64',
            kind: 'installer',
            sha256: 'placeholder',
            size: 17,
          },
        ],
      }, null, 2)}\n`,
      'utf8',
    );
    writeFileSync(
      path.join(webDir, 'release-asset-manifest.json'),
      `${JSON.stringify({
        profileId: 'agent-studio',
        releaseTag: 'release-2026-03-31-03',
        artifacts: [
          {
            name: 'agent-studio-web-assets-release-2026-03-31-03.tar.gz',
            relativePath: 'web/agent-studio-web-assets-release-2026-03-31-03.tar.gz',
            platform: 'web',
            arch: 'any',
            kind: 'archive',
            sha256: 'placeholder',
            size: 10,
          },
        ],
      }, null, 2)}\n`,
      'utf8',
    );
    writeFileSync(
      path.join(staleArm64WindowsDir, 'release-asset-manifest.json'),
      `${JSON.stringify({
        profileId: 'agent-studio',
        platform: 'windows',
        arch: 'arm64',
        artifacts: [
          {
            name: 'Claw.Studio_0.1.0_arm64-setup.exe',
            relativePath: 'desktop/windows/arm64/Claw.Studio_0.1.0_arm64-setup.exe',
            platform: 'windows',
            arch: 'arm64',
            kind: 'installer',
            sha256: 'placeholder',
            size: 21,
          },
        ],
      }, null, 2)}\n`,
      'utf8',
    );
    writeFileSync(
      path.join(windowsDir, 'installer-smoke-report.json'),
      `${JSON.stringify({
        platform: 'windows',
        arch: 'x64',
        target: 'x86_64-pc-windows-msvc',
        manifestPath: path.join(windowsDir, 'release-asset-manifest.json'),
        verifiedAt: '2026-04-05T11:22:33.000Z',
        installableArtifactRelativePaths: [
          'desktop/windows/x64/Claw.Studio_0.1.0_x64-setup.exe',
        ],
        requiredCompanionArtifactRelativePaths: [],
        kernelInstallReadiness: {
          openclaw: {
            externalRuntimePolicy: buildOpenClawExternalRuntimePolicy(),
            installReadyLayout: {
              ...buildInstallReadyLayout({
                mode: 'archive-extract-ready',
                installKey: currentOpenClawWindowsInstallKey,
              }),
            },
          },
        },
        kernelInstallContracts: {
          openclaw: buildInstallerContract('windows'),
        },
        installPlanSummaries: [
          {
            relativePath: 'desktop/windows/x64/Claw.Studio_0.1.0_x64-setup.exe',
            format: 'nsis',
            platform: 'windows',
            stepCount: 3,
          },
        ],
      }, null, 2)}\n`,
      'utf8',
    );
    writePassingDesktopStartupSmokeFixture({
      windowsDir,
      manifestPath: path.join(windowsDir, 'release-asset-manifest.json'),
    });
    writeReleaseNotesFixture(releaseAssetsDir);
    writeFileSync(
      path.join(webDir, 'release-smoke-report.json'),
      `${JSON.stringify(buildWebSmokeReport({
        manifestPath: path.join(webDir, 'release-asset-manifest.json'),
        artifactRelativePaths: [
          'web/agent-studio-web-assets-release-2026-03-31-03.tar.gz',
        ],
      }), null, 2)}\n`,
      'utf8',
    );

    finalizer.finalizeReleaseAssets({
      profileId: 'agent-studio',
      releaseTag: 'release-2026-03-31-03',
      repository: 'sdkwork-ai/agent-studio',
      releaseAssetsDir,
      allowPartialRelease: true,
    });

    const manifestPath = path.join(releaseAssetsDir, 'release-manifest.json');
    const checksumPath = path.join(releaseAssetsDir, 'SHA256SUMS.txt');
    const manifestChecksumPath = path.join(releaseAssetsDir, 'release-manifest.json.sha256.txt');
    const attestationEvidencePath = path.join(releaseAssetsDir, 'release-attestations.json');

    assert.equal(existsSync(manifestPath), true, 'missing release manifest');
    assert.equal(existsSync(checksumPath), true, 'missing global checksum manifest');
    assert.equal(existsSync(manifestChecksumPath), true, 'missing release manifest checksum sidecar');
    assert.equal(existsSync(attestationEvidencePath), false, 'finalizer must leave attestation evidence for the post-attestation evidence writer');

    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
    const checksums = readFileSync(checksumPath, 'utf8');
    const manifestChecksum = readFileSync(manifestChecksumPath, 'utf8');

    assert.equal(manifest.profileId, 'agent-studio');
    assert.equal(manifest.releaseTag, 'release-2026-03-31-03');
    assert.equal(manifest.repository, 'sdkwork-ai/agent-studio');
    assert.equal(manifest.attestationEvidenceFileName, 'release-attestations.json');
    assert.equal(manifest.attestationPredicateType, 'https://slsa.dev/provenance/v1');
    assert.deepEqual(manifest.releaseMetadata, [
      releaseNotesMetadataFor(releaseAssetsDir),
    ]);
    assert.equal(manifest.releaseCoverage.status, 'partial');
    assert.equal(manifest.releaseCoverage.allowPartialRelease, true);
    assert.deepEqual(
      manifest.releaseCoverage.presentTargets,
      [
        'desktop/windows/x64/nsis',
        'web/web/any',
      ],
    );
    assert.match(
      manifest.releaseCoverage.missingTargets.join(','),
      /server\/windows\/x64/,
    );
    assert.equal(manifest.artifacts.length, 2);
    assert.doesNotMatch(
      checksums,
      /desktop\/windows\/nsis\/Claw\.Studio_0\.1\.0_x64-setup\.exe/,
    );
    assert.doesNotMatch(
      checksums,
      /agent-studio-web-assets-release-2026-03-20-legacy\.tar\.gz/,
    );
    assert.doesNotMatch(
      checksums,
      /desktop\/windows\/arm64\/Claw\.Studio_0\.1\.0_arm64-setup\.exe/,
    );
    assert.deepEqual(
      manifest.artifacts.map((artifact) => ({
        relativePath: artifact.relativePath,
        family: artifact.family,
        platform: artifact.platform,
        arch: artifact.arch,
        kind: artifact.kind,
      })),
      [
        {
          relativePath: 'desktop/windows/x64/Claw.Studio_0.1.0_x64-setup.exe',
          family: 'desktop',
          platform: 'windows',
          arch: 'x64',
          kind: 'installer',
        },
        {
          relativePath: 'web/agent-studio-web-assets-release-2026-03-31-03.tar.gz',
          family: 'web',
          platform: 'web',
          arch: 'any',
          kind: 'archive',
        },
      ],
    );
    const desktopArtifact = manifest.artifacts.find(
      (artifact) => artifact.relativePath === 'desktop/windows/x64/Claw.Studio_0.1.0_x64-setup.exe',
    );
    const webArtifact = manifest.artifacts.find(
      (artifact) => artifact.relativePath === 'web/agent-studio-web-assets-release-2026-03-31-03.tar.gz',
    );

    assert.deepEqual(
      desktopArtifact?.kernelInstallContracts,
      {
        openclaw: buildInstallerContract('windows'),
      },
    );
    assert.deepEqual(desktopArtifact?.kernelInstallReadiness, {
      openclaw: {
        externalRuntimePolicy: buildOpenClawExternalRuntimePolicy(),
        installReadyLayout: buildInstallReadyLayout({
          mode: 'archive-extract-ready',
          installKey: currentOpenClawWindowsInstallKey,
        }),
      },
    });
    assert.equal(desktopArtifact?.packageProfileId, 'openclaw-only');
    assert.deepEqual(desktopArtifact?.includedKernelIds, ['openclaw']);
    assert.deepEqual(desktopArtifact?.defaultEnabledKernelIds, ['openclaw']);
    assert.deepEqual(desktopArtifact?.requiredExternalRuntimes, ['nodejs']);
    assert.deepEqual(desktopArtifact?.optionalExternalRuntimes, []);
    assert.deepEqual(desktopArtifact?.launcherKinds, ['externalLocal']);
    assert.deepEqual(
      desktopArtifact?.kernelPlatformSupport,
      {
        openclaw: {
          windows: 'native',
          macos: 'native',
          linux: 'native',
        },
      },
    );
    assert.deepEqual(
      desktopArtifact?.desktopInstallerSmoke,
      {
        reportRelativePath: 'desktop/windows/x64/installer-smoke-report.json',
        manifestRelativePath: 'desktop/windows/x64/release-asset-manifest.json',
        ...commonSmokeEvidenceMetadata({
          reportPath: path.join(windowsDir, 'installer-smoke-report.json'),
          manifestPath: path.join(windowsDir, 'release-asset-manifest.json'),
        }),
        verifiedAt: '2026-04-05T11:22:33.000Z',
        target: 'x86_64-pc-windows-msvc',
        installableArtifactRelativePaths: [
          'desktop/windows/x64/Claw.Studio_0.1.0_x64-setup.exe',
        ],
        requiredCompanionArtifactRelativePaths: [],
        kernelInstallReadiness: {
          openclaw: {
            externalRuntimePolicy: buildOpenClawExternalRuntimePolicy(),
            installReadyLayout: {
              ...buildInstallReadyLayout({
                mode: 'archive-extract-ready',
                installKey: currentOpenClawWindowsInstallKey,
              }),
            },
          },
        },
        installPlanSummaries: [
          {
            relativePath: 'desktop/windows/x64/Claw.Studio_0.1.0_x64-setup.exe',
            format: 'nsis',
            platform: 'windows',
            stepCount: 3,
          },
        ],
      },
    );
    assert.deepEqual(
      webArtifact?.webArchiveSmoke,
      {
        reportRelativePath: 'web/release-smoke-report.json',
        manifestRelativePath: 'web/release-asset-manifest.json',
        ...commonSmokeEvidenceMetadata({
          reportPath: path.join(webDir, 'release-smoke-report.json'),
          manifestPath: path.join(webDir, 'release-asset-manifest.json'),
        }),
        verifiedAt: '2026-04-11T08:09:10.000Z',
        target: '',
        smokeKind: 'web-archive-content',
        status: 'passed',
        artifactRelativePaths: [
          'web/agent-studio-web-assets-release-2026-03-31-03.tar.gz',
        ],
        checks: buildWebSmokeReport({
          manifestPath: path.join(webDir, 'release-asset-manifest.json'),
        }).checks,
      },
    );
    assert.equal('kernelInstallContracts' in webArtifact, false);
    assert.equal('packageProfileId' in webArtifact, false);
    assert.equal('desktopInstallerSmoke' in webArtifact, false);
    assert.match(checksums, /desktop\/windows\/x64\/Claw\.Studio_0\.1\.0_x64-setup\.exe/);
    assert.match(checksums, /web\/agent-studio-web-assets-release-2026-03-31-03\.tar\.gz/);
    assert.match(checksums, /^[a-f0-9]{64}  release-notes\.md$/m);
    assert.equal(existsSync(`${windowsAssetPath}.sha256.txt`), false);
    assert.equal(existsSync(`${webAssetPath}.sha256.txt`), false);
    assert.equal(
      manifestChecksum,
      `${fileSha256(manifestPath)}  release-manifest.json\n`,
    );
  } finally {
    rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('release asset finalizer accepts hermes-only desktop artifacts without OpenClaw installer metadata', async () => {
  const finalizerPath = path.join(rootDir, 'scripts', 'release', 'finalize-release-assets.mjs');
  const finalizer = await import(pathToFileURL(finalizerPath).href);

  const tempRoot = mkdtempSync(path.join(os.tmpdir(), 'claw-release-finalize-hermes-desktop-'));
  const releaseAssetsDir = path.join(tempRoot, 'release-assets');
  const windowsDir = path.join(releaseAssetsDir, 'desktop', 'windows', 'x64');
  const installerRelativePath = 'desktop/windows/x64/Claw.Studio_0.1.0_x64-setup.exe';

  try {
    mkdirSync(windowsDir, { recursive: true });
    writeFileSync(path.join(releaseAssetsDir, installerRelativePath), 'windows-installer', 'utf8');
    writeFileSync(
      path.join(windowsDir, 'release-asset-manifest.json'),
      `${JSON.stringify({
        profileId: 'agent-studio',
        productName: 'Agent Studio',
        releaseTag: 'release-2026-04-08-01',
        packageProfileId: 'hermes-only',
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
        platform: 'windows',
        arch: 'x64',
        artifacts: [
          {
            name: 'Claw.Studio_0.1.0_x64-setup.exe',
            relativePath: installerRelativePath,
            platform: 'windows',
            arch: 'x64',
            kind: 'installer',
            sha256: 'placeholder',
            size: 17,
          },
        ],
      }, null, 2)}\n`,
      'utf8',
    );
    writeFileSync(
      path.join(windowsDir, 'installer-smoke-report.json'),
      `${JSON.stringify({
        platform: 'windows',
        arch: 'x64',
        target: 'x86_64-pc-windows-msvc',
        manifestPath: path.join(windowsDir, 'release-asset-manifest.json'),
        verifiedAt: '2026-04-08T11:22:33.000Z',
        installableArtifactRelativePaths: [installerRelativePath],
        requiredCompanionArtifactRelativePaths: [],
        installPlanSummaries: [
          {
            relativePath: installerRelativePath,
            format: 'nsis',
            platform: 'windows',
            stepCount: 1,
          },
        ],
        kernelInstallReadiness: {
          hermes: {
            externalRuntimePolicy: buildHermesExternalRuntimePolicy(),
          },
        },
      }, null, 2)}\n`,
      'utf8',
    );
    writePassingDesktopStartupSmokeFixture({
      windowsDir,
      manifestPath: path.join(windowsDir, 'release-asset-manifest.json'),
      artifactRelativePath: installerRelativePath,
      packageProfileId: 'hermes-only',
      includedKernelIds: ['hermes'],
      defaultEnabledKernelIds: ['hermes'],
    });
    writeReleaseNotesFixture(releaseAssetsDir);

    finalizer.finalizeReleaseAssets({
      profileId: 'agent-studio',
      releaseTag: 'release-2026-04-08-01',
      repository: 'sdkwork-ai/agent-studio',
      releaseAssetsDir,
      allowPartialRelease: true,
    });

    const manifest = JSON.parse(
      readFileSync(path.join(releaseAssetsDir, 'release-manifest.json'), 'utf8'),
    );
    const desktopArtifact = manifest.artifacts.find(
      (artifact) => artifact.relativePath === installerRelativePath,
    );

    assert.equal('kernelInstallContracts' in desktopArtifact, false);
    assert.deepEqual(desktopArtifact?.kernelInstallReadiness, {
      hermes: {
        externalRuntimePolicy: buildHermesExternalRuntimePolicy(),
      },
    });
    assert.equal(desktopArtifact?.packageProfileId, 'hermes-only');
    assert.deepEqual(desktopArtifact?.includedKernelIds, ['hermes']);
    assert.deepEqual(desktopArtifact?.defaultEnabledKernelIds, ['hermes']);
    assert.deepEqual(desktopArtifact?.requiredExternalRuntimes, ['python', 'uv']);
    assert.deepEqual(desktopArtifact?.optionalExternalRuntimes, ['nodejs']);
    assert.deepEqual(desktopArtifact?.launcherKinds, ['externalWslOrRemote']);
    assert.deepEqual(
      desktopArtifact?.kernelPlatformSupport,
      {
        hermes: {
          windows: 'wsl2OrRemoteOnly',
          macos: 'native',
          linux: 'native',
        },
      },
    );
    assert.deepEqual(
      desktopArtifact?.desktopInstallerSmoke,
      {
        reportRelativePath: 'desktop/windows/x64/installer-smoke-report.json',
        manifestRelativePath: 'desktop/windows/x64/release-asset-manifest.json',
        ...commonSmokeEvidenceMetadata({
          reportPath: path.join(windowsDir, 'installer-smoke-report.json'),
          manifestPath: path.join(windowsDir, 'release-asset-manifest.json'),
        }),
        verifiedAt: '2026-04-08T11:22:33.000Z',
        target: 'x86_64-pc-windows-msvc',
        installableArtifactRelativePaths: [installerRelativePath],
        requiredCompanionArtifactRelativePaths: [],
        kernelInstallReadiness: {
          hermes: {
            externalRuntimePolicy: buildHermesExternalRuntimePolicy(),
          },
        },
        installPlanSummaries: [
          {
            relativePath: installerRelativePath,
            format: 'nsis',
            platform: 'windows',
            stepCount: 1,
          },
        ],
      },
    );
  } finally {
    rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('release asset finalizer rejects hermes-only desktop artifacts when Hermes external-runtime readiness evidence is missing', async () => {
  const finalizerPath = path.join(rootDir, 'scripts', 'release', 'finalize-release-assets.mjs');
  const finalizer = await import(pathToFileURL(finalizerPath).href);

  const tempRoot = mkdtempSync(path.join(os.tmpdir(), 'claw-release-finalize-hermes-readiness-missing-'));
  const releaseAssetsDir = path.join(tempRoot, 'release-assets');
  const windowsDir = path.join(releaseAssetsDir, 'desktop', 'windows', 'x64');
  const installerRelativePath = 'desktop/windows/x64/Claw.Studio_0.1.0_x64-setup.exe';

  try {
    mkdirSync(windowsDir, { recursive: true });
    writeFileSync(path.join(releaseAssetsDir, installerRelativePath), 'windows-installer', 'utf8');
    writeFileSync(
      path.join(windowsDir, 'release-asset-manifest.json'),
      `${JSON.stringify({
        profileId: 'agent-studio',
        productName: 'Agent Studio',
        releaseTag: 'release-2026-04-08-01',
        packageProfileId: 'hermes-only',
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
        platform: 'windows',
        arch: 'x64',
        artifacts: [
          {
            name: 'Claw.Studio_0.1.0_x64-setup.exe',
            relativePath: installerRelativePath,
            platform: 'windows',
            arch: 'x64',
            kind: 'installer',
            sha256: 'placeholder',
            size: 17,
          },
        ],
      }, null, 2)}\n`,
      'utf8',
    );
    writeFileSync(
      path.join(windowsDir, 'installer-smoke-report.json'),
      `${JSON.stringify({
        platform: 'windows',
        arch: 'x64',
        target: 'x86_64-pc-windows-msvc',
        manifestPath: path.join(windowsDir, 'release-asset-manifest.json'),
        verifiedAt: '2026-04-08T11:22:33.000Z',
        installableArtifactRelativePaths: [installerRelativePath],
        requiredCompanionArtifactRelativePaths: [],
        installPlanSummaries: [
          {
            relativePath: installerRelativePath,
            format: 'nsis',
            platform: 'windows',
            stepCount: 1,
          },
        ],
      }, null, 2)}\n`,
      'utf8',
    );
    writePassingDesktopStartupSmokeFixture({
      windowsDir,
      manifestPath: path.join(windowsDir, 'release-asset-manifest.json'),
      artifactRelativePath: installerRelativePath,
      packageProfileId: 'hermes-only',
      includedKernelIds: ['hermes'],
      defaultEnabledKernelIds: ['hermes'],
    });

    assert.throws(
      () => finalizer.finalizeReleaseAssets({
        profileId: 'agent-studio',
        releaseTag: 'release-2026-04-08-01',
        repository: 'sdkwork-ai/agent-studio',
        releaseAssetsDir,
      }),
      /Hermes Agent external-runtime readiness/i,
    );
  } finally {
    rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('release asset finalizer requires rendered release notes before writing finalized publish metadata', async () => {
  const finalizerPath = path.join(rootDir, 'scripts', 'release', 'finalize-release-assets.mjs');
  const finalizer = await import(pathToFileURL(finalizerPath).href);

  const tempRoot = mkdtempSync(path.join(os.tmpdir(), 'claw-release-finalize-notes-required-'));
  const releaseAssetsDir = path.join(tempRoot, 'release-assets');
  const webDir = path.join(releaseAssetsDir, 'web');
  const webArchiveRelativePath = 'web/agent-studio-web-assets-release-2026-04-12-02.tar.gz';
  const manifestPath = path.join(webDir, 'release-asset-manifest.json');

  try {
    mkdirSync(webDir, { recursive: true });
    writeFileSync(path.join(releaseAssetsDir, webArchiveRelativePath), 'web-archive', 'utf8');
    writeFileSync(
      manifestPath,
      `${JSON.stringify({
        profileId: 'agent-studio',
        releaseTag: 'release-2026-04-12-02',
        platform: 'web',
        arch: 'any',
        artifacts: [
          {
            name: path.basename(webArchiveRelativePath),
            relativePath: webArchiveRelativePath,
            family: 'web',
            platform: 'web',
            arch: 'any',
            kind: 'archive',
            sha256: 'placeholder',
            size: 11,
          },
        ],
      }, null, 2)}\n`,
      'utf8',
    );
    writeFileSync(
      path.join(webDir, 'release-smoke-report.json'),
      `${JSON.stringify(buildWebSmokeReport({
        manifestPath,
        artifactRelativePaths: [webArchiveRelativePath],
      }), null, 2)}\n`,
      'utf8',
    );

    assert.throws(
      () => finalizer.finalizeReleaseAssets({
        profileId: 'agent-studio',
        releaseTag: 'release-2026-04-12-02',
        repository: 'sdkwork-ai/agent-studio',
        releaseAssetsDir,
        allowPartialRelease: true,
      }),
      /Missing required release metadata file: release-notes\.md/,
    );
  } finally {
    rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('release asset finalizer rejects desktop release assets when installer smoke evidence is missing or stale', async () => {
  const finalizerPath = path.join(rootDir, 'scripts', 'release', 'finalize-release-assets.mjs');
  const finalizer = await import(pathToFileURL(finalizerPath).href);

  const tempRoot = mkdtempSync(path.join(os.tmpdir(), 'claw-release-finalize-desktop-smoke-'));
  const releaseAssetsDir = path.join(tempRoot, 'release-assets');
  const windowsDir = path.join(releaseAssetsDir, 'desktop', 'windows', 'x64');

  try {
    mkdirSync(windowsDir, { recursive: true });
    writeFileSync(
      path.join(windowsDir, 'Claw.Studio_0.1.0_x64-setup.exe'),
      'windows-installer',
      'utf8',
    );
    writeFileSync(
      path.join(windowsDir, 'release-asset-manifest.json'),
      `${JSON.stringify({
        profileId: 'agent-studio',
        releaseTag: 'release-2026-04-05-02',
        platform: 'windows',
        arch: 'x64',
        kernelInstallContracts: {
          openclaw: buildInstallerContract('windows'),
        },
        artifacts: [
          {
            name: 'Claw.Studio_0.1.0_x64-setup.exe',
            relativePath: 'desktop/windows/x64/Claw.Studio_0.1.0_x64-setup.exe',
            platform: 'windows',
            arch: 'x64',
            kind: 'installer',
            sha256: 'placeholder',
            size: 17,
          },
        ],
      }, null, 2)}\n`,
      'utf8',
    );

    assert.throws(
      () => finalizer.finalizeReleaseAssets({
        profileId: 'agent-studio',
        releaseTag: 'release-2026-04-05-02',
        repository: 'sdkwork-ai/agent-studio',
        releaseAssetsDir,
      }),
      /Missing desktop installer smoke report/,
    );

    writeFileSync(
      path.join(windowsDir, 'installer-smoke-report.json'),
      `${JSON.stringify({
        platform: 'windows',
        arch: 'x64',
        manifestPath: path.join(windowsDir, 'release-asset-manifest.json'),
        installableArtifactRelativePaths: [
          'desktop/windows/x64/another-installer.exe',
        ],
        kernelInstallContracts: {
          openclaw: buildInstallerContract('windows'),
        },
      }, null, 2)}\n`,
      'utf8',
    );

    assert.throws(
      () => finalizer.finalizeReleaseAssets({
        profileId: 'agent-studio',
        releaseTag: 'release-2026-04-05-02',
        repository: 'sdkwork-ai/agent-studio',
        releaseAssetsDir,
      }),
      /Desktop installer smoke report does not match the current installable artifact set/,
    );
  } finally {
    rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('release asset finalizer rejects desktop release assets when startup smoke evidence is missing', async () => {
  const finalizerPath = path.join(rootDir, 'scripts', 'release', 'finalize-release-assets.mjs');
  const finalizer = await import(pathToFileURL(finalizerPath).href);

  const tempRoot = mkdtempSync(path.join(os.tmpdir(), 'claw-release-finalize-desktop-startup-required-'));
  const releaseAssetsDir = path.join(tempRoot, 'release-assets');
  const windowsDir = path.join(releaseAssetsDir, 'desktop', 'windows', 'x64');

  try {
    mkdirSync(windowsDir, { recursive: true });
    writeFileSync(
      path.join(windowsDir, 'Claw.Studio_0.1.0_x64-setup.exe'),
      'windows-installer',
      'utf8',
    );
    writeFileSync(
      path.join(windowsDir, 'release-asset-manifest.json'),
      `${JSON.stringify({
        profileId: 'agent-studio',
        releaseTag: 'release-2026-04-06-07',
        platform: 'windows',
        arch: 'x64',
        packageProfileId: 'openclaw-only',
        includedKernelIds: ['openclaw'],
        defaultEnabledKernelIds: ['openclaw'],
        kernelInstallContracts: {
          openclaw: buildInstallerContract('windows'),
        },
        artifacts: [
          {
            name: 'Claw.Studio_0.1.0_x64-setup.exe',
            relativePath: 'desktop/windows/x64/Claw.Studio_0.1.0_x64-setup.exe',
            platform: 'windows',
            arch: 'x64',
            kind: 'installer',
            sha256: 'placeholder',
            size: 17,
          },
        ],
      }, null, 2)}\n`,
      'utf8',
    );
    writeFileSync(
      path.join(windowsDir, 'installer-smoke-report.json'),
      `${JSON.stringify({
        platform: 'windows',
        arch: 'x64',
        target: 'x86_64-pc-windows-msvc',
        manifestPath: path.join(windowsDir, 'release-asset-manifest.json'),
        verifiedAt: '2026-04-05T11:22:33.000Z',
        installableArtifactRelativePaths: [
          'desktop/windows/x64/Claw.Studio_0.1.0_x64-setup.exe',
        ],
        requiredCompanionArtifactRelativePaths: [],
        kernelInstallReadiness: {
          openclaw: {
            externalRuntimePolicy: buildOpenClawExternalRuntimePolicy(),
            installReadyLayout: buildInstallReadyLayout({
              mode: 'archive-extract-ready',
              installKey: currentOpenClawWindowsInstallKey,
            }),
          },
        },
        kernelInstallContracts: {
          openclaw: buildInstallerContract('windows'),
        },
        installPlanSummaries: [
          {
            relativePath: 'desktop/windows/x64/Claw.Studio_0.1.0_x64-setup.exe',
            format: 'nsis',
            platform: 'windows',
            stepCount: 3,
          },
        ],
      }, null, 2)}\n`,
      'utf8',
    );

    assert.throws(
      () => finalizer.finalizeReleaseAssets({
        profileId: 'agent-studio',
        releaseTag: 'release-2026-04-06-07',
        repository: 'sdkwork-ai/agent-studio',
        releaseAssetsDir,
      }),
      /Missing desktop startup smoke report/,
    );

    mkdirSync(path.join(windowsDir, 'diagnostics'), { recursive: true });
    writeFileSync(
      path.join(windowsDir, 'diagnostics', 'desktop-startup-evidence.json'),
      `${JSON.stringify({
        version: 2,
        status: 'passed',
        phase: 'shell-mounted',
        runId: 2,
        durationMs: 1842,
        recordedAt: '2026-04-06T12:13:14.000Z',
        descriptor: {
          browserBaseUrl: 'http://127.0.0.1:19797',
        },
        builtInInstance: {
          id: BUILT_IN_INSTANCE_ID,
          status: 'online',
        },
        localAiProxy: {
          lifecycle: 'running',
          messageCaptureEnabled: true,
          observabilityDbPath: 'C:/Users/test/AppData/Roaming/Agent Studio/store/local-ai-proxy-observability.sqlite3',
          snapshotPath: 'C:/Users/test/AppData/Roaming/Agent Studio/state/local-ai-proxy.snapshot.json',
          logPath: 'C:/Users/test/AppData/Roaming/Agent Studio/logs/local-ai-proxy.log',
        },
        readinessEvidence: {
          ready: true,
          gatewayWebsocketDialable: true,
        },
      }, null, 2)}\n`,
      'utf8',
    );
    writeFileSync(
      path.join(windowsDir, 'desktop-startup-smoke-report.json'),
      `${JSON.stringify(buildDesktopStartupSmokeReport({
        manifestPath: path.join(windowsDir, 'release-asset-manifest.json'),
        checks: [
          {
            id: 'startup-status',
            status: 'passed',
            detail: 'desktop startup evidence recorded a passed launch',
          },
          {
            id: 'startup-phase',
            status: 'passed',
            detail: 'desktop startup evidence recorded shell-mounted phase',
          },
          {
            id: 'runtime-readiness',
            status: 'passed',
            detail: 'desktop startup evidence preserved ready runtime invariants',
          },
          {
            id: 'built-in-instance',
            status: 'passed',
            detail: 'desktop startup evidence preserved the built-in OpenClaw instance projection',
          },
          {
            id: 'gateway-websocket',
            status: 'passed',
            detail: 'desktop startup evidence proved the OpenClaw gateway websocket was dialable',
          },
        ],
      }), null, 2)}\n`,
      'utf8',
    );

    assert.throws(
      () => finalizer.finalizeReleaseAssets({
        profileId: 'agent-studio',
        releaseTag: 'release-2026-04-06-07',
        repository: 'sdkwork-ai/agent-studio',
        releaseAssetsDir,
      }),
      /local-ai-proxy-runtime/i,
    );
  } finally {
    rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('release asset finalizer lifts desktop startup smoke metadata onto desktop artifacts when launched-session evidence exists', async () => {
  const finalizerPath = path.join(rootDir, 'scripts', 'release', 'finalize-release-assets.mjs');
  const finalizer = await import(pathToFileURL(finalizerPath).href);

  const tempRoot = mkdtempSync(path.join(os.tmpdir(), 'claw-release-finalize-desktop-startup-smoke-'));
  const releaseAssetsDir = path.join(tempRoot, 'release-assets');
  const windowsDir = path.join(releaseAssetsDir, 'desktop', 'windows', 'x64');
  const diagnosticsDir = path.join(windowsDir, 'diagnostics');
  const manifestPath = path.join(windowsDir, 'release-asset-manifest.json');
  const artifactRelativePath = 'desktop/windows/x64/Claw.Studio_0.1.0_x64-setup.exe';

  try {
    mkdirSync(windowsDir, { recursive: true });
    mkdirSync(diagnosticsDir, { recursive: true });
    writeFileSync(
      path.join(windowsDir, 'Claw.Studio_0.1.0_x64-setup.exe'),
      'windows-installer',
      'utf8',
    );
    writeFileSync(
      manifestPath,
      `${JSON.stringify({
        profileId: 'agent-studio',
        releaseTag: 'release-2026-04-06-08',
        platform: 'windows',
        arch: 'x64',
        packageProfileId: 'openclaw-only',
        includedKernelIds: ['openclaw'],
        defaultEnabledKernelIds: ['openclaw'],
        kernelInstallContracts: {
          openclaw: buildInstallerContract('windows'),
        },
        artifacts: [
          {
            name: 'Claw.Studio_0.1.0_x64-setup.exe',
            relativePath: artifactRelativePath,
            platform: 'windows',
            arch: 'x64',
            kind: 'installer',
            sha256: 'placeholder',
            size: 17,
          },
        ],
      }, null, 2)}\n`,
      'utf8',
    );
    writeFileSync(
      path.join(windowsDir, 'installer-smoke-report.json'),
      `${JSON.stringify({
        platform: 'windows',
        arch: 'x64',
        target: 'x86_64-pc-windows-msvc',
        manifestPath,
        verifiedAt: '2026-04-05T11:22:33.000Z',
        installableArtifactRelativePaths: [artifactRelativePath],
        requiredCompanionArtifactRelativePaths: [],
        kernelInstallReadiness: {
          openclaw: {
            externalRuntimePolicy: buildOpenClawExternalRuntimePolicy(),
            installReadyLayout: buildInstallReadyLayout({
              mode: 'archive-extract-ready',
              installKey: currentOpenClawWindowsInstallKey,
            }),
          },
        },
        kernelInstallContracts: {
          openclaw: buildInstallerContract('windows'),
        },
        installPlanSummaries: [
          {
            relativePath: artifactRelativePath,
            format: 'nsis',
            platform: 'windows',
            stepCount: 3,
          },
        ],
      }, null, 2)}\n`,
      'utf8',
    );
    writeFileSync(
      path.join(diagnosticsDir, 'desktop-startup-evidence.json'),
      `${JSON.stringify({
        version: 2,
        status: 'passed',
        phase: 'shell-mounted',
        runId: 2,
        durationMs: 1842,
        recordedAt: '2026-04-06T12:13:14.000Z',
        descriptor: {
          browserBaseUrl: 'http://127.0.0.1:19797',
        },
        builtInInstance: {
          id: BUILT_IN_INSTANCE_ID,
          status: 'online',
        },
        localAiProxy: {
          lifecycle: 'running',
          messageCaptureEnabled: true,
          observabilityDbPath: 'C:/Users/test/AppData/Roaming/Agent Studio/store/local-ai-proxy-observability.sqlite3',
          snapshotPath: 'C:/Users/test/AppData/Roaming/Agent Studio/state/local-ai-proxy.snapshot.json',
          logPath: 'C:/Users/test/AppData/Roaming/Agent Studio/logs/local-ai-proxy.log',
        },
        readinessEvidence: {
          ready: true,
          gatewayWebsocketDialable: true,
        },
      }, null, 2)}\n`,
      'utf8',
    );
    writeFileSync(
      path.join(windowsDir, 'desktop-startup-smoke-report.json'),
      `${JSON.stringify(buildDesktopStartupSmokeReport({
        manifestPath,
      }), null, 2)}\n`,
      'utf8',
    );
    writeReleaseNotesFixture(releaseAssetsDir);

    finalizer.finalizeReleaseAssets({
      profileId: 'agent-studio',
      releaseTag: 'release-2026-04-06-08',
      repository: 'sdkwork-ai/agent-studio',
      releaseAssetsDir,
      allowPartialRelease: true,
    });

    const manifest = JSON.parse(
      readFileSync(path.join(releaseAssetsDir, 'release-manifest.json'), 'utf8'),
    );
    const desktopArtifact = manifest.artifacts.find(
      (artifact) => artifact.relativePath === artifactRelativePath,
    );

    assert.deepEqual(
      desktopArtifact?.desktopStartupSmoke,
      {
        reportRelativePath: 'desktop/windows/x64/desktop-startup-smoke-report.json',
        manifestRelativePath: 'desktop/windows/x64/release-asset-manifest.json',
        capturedEvidenceRelativePath: 'desktop/windows/x64/diagnostics/desktop-startup-evidence.json',
        ...commonSmokeEvidenceMetadata({
          reportPath: path.join(windowsDir, 'desktop-startup-smoke-report.json'),
          manifestPath: path.join(windowsDir, 'release-asset-manifest.json'),
        }),
        ...fileEvidenceMetadata(
          path.join(windowsDir, 'diagnostics', 'desktop-startup-evidence.json'),
          'capturedEvidence',
        ),
        verifiedAt: '2026-04-06T12:13:14.000Z',
        target: 'x86_64-pc-windows-msvc',
        status: 'passed',
        phase: 'shell-mounted',
        packageProfileId: 'openclaw-only',
        includedKernelIds: ['openclaw'],
        defaultEnabledKernelIds: ['openclaw'],
        descriptorBrowserBaseUrl: 'http://127.0.0.1:19797',
        builtInInstanceId: BUILT_IN_INSTANCE_ID,
        builtInInstanceStatus: 'online',
        localAiProxyRuntime: {
          lifecycle: 'running',
          messageCaptureEnabled: true,
          observabilityDbPath: 'C:/Users/test/AppData/Roaming/Agent Studio/store/local-ai-proxy-observability.sqlite3',
          snapshotPath: 'C:/Users/test/AppData/Roaming/Agent Studio/state/local-ai-proxy.snapshot.json',
          logPath: 'C:/Users/test/AppData/Roaming/Agent Studio/logs/local-ai-proxy.log',
        },
        artifactRelativePaths: [artifactRelativePath],
        checks: [
          {
            id: 'startup-status',
            status: 'passed',
            detail: 'desktop startup evidence recorded a passed launch',
          },
          {
            id: 'startup-phase',
            status: 'passed',
            detail: 'desktop startup evidence recorded shell-mounted phase',
          },
          {
            id: 'runtime-readiness',
            status: 'passed',
            detail: 'desktop startup evidence preserved ready runtime invariants',
          },
          {
            id: 'built-in-instance',
            status: 'passed',
            detail: 'desktop startup evidence preserved the built-in OpenClaw instance projection',
          },
          {
            id: 'gateway-websocket',
            status: 'passed',
            detail: 'desktop startup evidence proved the OpenClaw gateway websocket was dialable',
          },
          {
            id: 'local-ai-proxy-runtime',
            status: 'passed',
            detail: 'desktop startup evidence preserved local ai proxy runtime lifecycle and artifact paths',
          },
        ],
      },
    );
  } finally {
    rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('release asset finalizer rejects desktop startup smoke reports that reference evidence outside release assets', async () => {
  const finalizerPath = path.join(rootDir, 'scripts', 'release', 'finalize-release-assets.mjs');
  const finalizer = await import(pathToFileURL(finalizerPath).href);

  const tempRoot = mkdtempSync(path.join(os.tmpdir(), 'claw-release-finalize-desktop-startup-evidence-path-'));
  const releaseAssetsDir = path.join(tempRoot, 'release-assets');
  const windowsDir = path.join(releaseAssetsDir, 'desktop', 'windows', 'x64');
  const diagnosticsDir = path.join(windowsDir, 'diagnostics');
  const manifestPath = path.join(windowsDir, 'release-asset-manifest.json');
  const artifactRelativePath = 'desktop/windows/x64/Claw.Studio_0.1.0_x64-setup.exe';
  const outsideEvidencePath = path.join(tempRoot, 'outside-desktop-startup-evidence.json');

  try {
    mkdirSync(windowsDir, { recursive: true });
    mkdirSync(diagnosticsDir, { recursive: true });
    writeFileSync(
      path.join(windowsDir, 'Claw.Studio_0.1.0_x64-setup.exe'),
      'windows-installer',
      'utf8',
    );
    writeFileSync(
      manifestPath,
      `${JSON.stringify({
        profileId: 'agent-studio',
        releaseTag: 'release-2026-04-06-09',
        platform: 'windows',
        arch: 'x64',
        packageProfileId: 'openclaw-only',
        includedKernelIds: ['openclaw'],
        defaultEnabledKernelIds: ['openclaw'],
        kernelInstallContracts: {
          openclaw: buildInstallerContract('windows'),
        },
        artifacts: [
          {
            name: 'Claw.Studio_0.1.0_x64-setup.exe',
            relativePath: artifactRelativePath,
            platform: 'windows',
            arch: 'x64',
            kind: 'installer',
            sha256: 'placeholder',
            size: 17,
          },
        ],
      }, null, 2)}\n`,
      'utf8',
    );
    writeFileSync(
      path.join(windowsDir, 'installer-smoke-report.json'),
      `${JSON.stringify({
        platform: 'windows',
        arch: 'x64',
        target: 'x86_64-pc-windows-msvc',
        manifestPath,
        verifiedAt: '2026-04-05T11:22:33.000Z',
        installableArtifactRelativePaths: [artifactRelativePath],
        requiredCompanionArtifactRelativePaths: [],
        kernelInstallReadiness: {
          openclaw: {
            externalRuntimePolicy: buildOpenClawExternalRuntimePolicy(),
            installReadyLayout: buildInstallReadyLayout({
              mode: 'archive-extract-ready',
              installKey: currentOpenClawWindowsInstallKey,
            }),
          },
        },
        kernelInstallContracts: {
          openclaw: buildInstallerContract('windows'),
        },
        installPlanSummaries: [
          {
            relativePath: artifactRelativePath,
            format: 'nsis',
            platform: 'windows',
            stepCount: 3,
          },
        ],
      }, null, 2)}\n`,
      'utf8',
    );
    writeFileSync(
      outsideEvidencePath,
      `${JSON.stringify({
        version: 2,
        status: 'passed',
        phase: 'shell-mounted',
        runId: 2,
        durationMs: 1842,
        recordedAt: '2026-04-06T12:13:14.000Z',
        descriptor: {
          browserBaseUrl: 'http://127.0.0.1:19797',
        },
        builtInInstance: {
          id: BUILT_IN_INSTANCE_ID,
          status: 'online',
        },
        localAiProxy: {
          lifecycle: 'running',
          messageCaptureEnabled: true,
          observabilityDbPath: 'C:/Users/test/AppData/Roaming/Agent Studio/store/local-ai-proxy-observability.sqlite3',
          snapshotPath: 'C:/Users/test/AppData/Roaming/Agent Studio/state/local-ai-proxy.snapshot.json',
          logPath: 'C:/Users/test/AppData/Roaming/Agent Studio/logs/local-ai-proxy.log',
        },
        readinessEvidence: {
          ready: true,
          gatewayWebsocketDialable: true,
        },
      }, null, 2)}\n`,
      'utf8',
    );
    writeFileSync(
      path.join(windowsDir, 'desktop-startup-smoke-report.json'),
      `${JSON.stringify(buildDesktopStartupSmokeReport({
        manifestPath,
        capturedEvidenceRelativePath: '../outside-desktop-startup-evidence.json',
        artifactRelativePaths: [artifactRelativePath],
      }), null, 2)}\n`,
      'utf8',
    );

    assert.throws(
      () => finalizer.finalizeReleaseAssets({
        profileId: 'agent-studio',
        releaseTag: 'release-2026-04-06-09',
        repository: 'sdkwork-ai/agent-studio',
        releaseAssetsDir,
        allowPartialRelease: true,
      }),
      /unsafe captured evidence path/,
    );
  } finally {
    rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('release asset finalizer rejects desktop startup smoke metadata when packaged kernel context drifts from manifest', async () => {
  const finalizerPath = path.join(rootDir, 'scripts', 'release', 'finalize-release-assets.mjs');
  const finalizer = await import(pathToFileURL(finalizerPath).href);

  const tempRoot = mkdtempSync(path.join(os.tmpdir(), 'claw-release-finalize-desktop-startup-package-context-'));
  const releaseAssetsDir = path.join(tempRoot, 'release-assets');
  const windowsDir = path.join(releaseAssetsDir, 'desktop', 'windows', 'x64');
  const diagnosticsDir = path.join(windowsDir, 'diagnostics');
  const manifestPath = path.join(windowsDir, 'release-asset-manifest.json');
  const artifactRelativePath = 'desktop/windows/x64/Claw.Studio_0.1.0_x64-setup.exe';

  try {
    mkdirSync(windowsDir, { recursive: true });
    mkdirSync(diagnosticsDir, { recursive: true });
    writeFileSync(
      path.join(windowsDir, 'Claw.Studio_0.1.0_x64-setup.exe'),
      'windows-installer',
      'utf8',
    );
    writeFileSync(
      manifestPath,
      `${JSON.stringify({
        profileId: 'agent-studio',
        releaseTag: 'release-2026-04-06-08',
        platform: 'windows',
        arch: 'x64',
        packageProfileId: 'openclaw-only',
        includedKernelIds: ['openclaw'],
        defaultEnabledKernelIds: ['openclaw'],
        kernelInstallContracts: {
          openclaw: buildInstallerContract('windows'),
        },
        artifacts: [
          {
            name: 'Claw.Studio_0.1.0_x64-setup.exe',
            relativePath: artifactRelativePath,
            platform: 'windows',
            arch: 'x64',
            kind: 'installer',
            sha256: 'placeholder',
            size: 17,
          },
        ],
      }, null, 2)}\n`,
      'utf8',
    );
    writeFileSync(
      path.join(windowsDir, 'installer-smoke-report.json'),
      `${JSON.stringify({
        platform: 'windows',
        arch: 'x64',
        target: 'x86_64-pc-windows-msvc',
        manifestPath,
        verifiedAt: '2026-04-05T11:22:33.000Z',
        installableArtifactRelativePaths: [artifactRelativePath],
        requiredCompanionArtifactRelativePaths: [],
        kernelInstallReadiness: {
          openclaw: {
            externalRuntimePolicy: buildOpenClawExternalRuntimePolicy(),
            installReadyLayout: buildInstallReadyLayout({
              mode: 'archive-extract-ready',
              installKey: currentOpenClawWindowsInstallKey,
            }),
          },
        },
        kernelInstallContracts: {
          openclaw: buildInstallerContract('windows'),
        },
        installPlanSummaries: [
          {
            relativePath: artifactRelativePath,
            format: 'nsis',
            platform: 'windows',
            stepCount: 3,
          },
        ],
      }, null, 2)}\n`,
      'utf8',
    );
    writeFileSync(
      path.join(diagnosticsDir, 'desktop-startup-evidence.json'),
      `${JSON.stringify({
        version: 2,
        status: 'passed',
        phase: 'shell-mounted',
        runId: 2,
        durationMs: 1842,
        recordedAt: '2026-04-06T12:13:14.000Z',
        descriptor: {
          browserBaseUrl: 'http://127.0.0.1:19797',
        },
        builtInInstance: {
          id: BUILT_IN_INSTANCE_ID,
          status: 'online',
        },
        localAiProxy: {
          lifecycle: 'running',
          messageCaptureEnabled: true,
          observabilityDbPath: 'C:/Users/test/AppData/Roaming/Agent Studio/store/local-ai-proxy-observability.sqlite3',
          snapshotPath: 'C:/Users/test/AppData/Roaming/Agent Studio/state/local-ai-proxy.snapshot.json',
          logPath: 'C:/Users/test/AppData/Roaming/Agent Studio/logs/local-ai-proxy.log',
        },
        readinessEvidence: {
          ready: true,
          gatewayWebsocketDialable: true,
        },
      }, null, 2)}\n`,
      'utf8',
    );
    writeFileSync(
      path.join(windowsDir, 'desktop-startup-smoke-report.json'),
      `${JSON.stringify(buildDesktopStartupSmokeReport({
        manifestPath,
        packageProfileId: 'hermes-only',
        includedKernelIds: ['hermes'],
        defaultEnabledKernelIds: ['hermes'],
      }), null, 2)}\n`,
      'utf8',
    );

    assert.throws(
      () => finalizer.finalizeReleaseAssets({
        profileId: 'agent-studio',
        releaseTag: 'release-2026-04-06-08',
        repository: 'sdkwork-ai/agent-studio',
        releaseAssetsDir,
      }),
      /package profile|included kernels|default enabled kernels/i,
    );
  } finally {
    rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('release asset finalizer rejects desktop manifests whose OpenClaw installer contract metadata is missing or stale', async () => {
  const finalizerPath = path.join(rootDir, 'scripts', 'release', 'finalize-release-assets.mjs');
  const finalizer = await import(pathToFileURL(finalizerPath).href);

  const tempRoot = mkdtempSync(path.join(os.tmpdir(), 'claw-release-finalize-desktop-contract-'));
  const releaseAssetsDir = path.join(tempRoot, 'release-assets');
  const windowsDir = path.join(releaseAssetsDir, 'desktop', 'windows', 'x64');
  const expectedInstallerContract = buildInstallerContract('windows');

  try {
    mkdirSync(windowsDir, { recursive: true });
    writeFileSync(
      path.join(windowsDir, 'Claw.Studio_0.1.0_x64-setup.exe'),
      'windows-installer',
      'utf8',
    );
    writeFileSync(
      path.join(windowsDir, 'release-asset-manifest.json'),
      `${JSON.stringify({
        profileId: 'agent-studio',
        releaseTag: 'release-2026-04-05-03',
        platform: 'windows',
        arch: 'x64',
        artifacts: [
          {
            name: 'Claw.Studio_0.1.0_x64-setup.exe',
            relativePath: 'desktop/windows/x64/Claw.Studio_0.1.0_x64-setup.exe',
            platform: 'windows',
            arch: 'x64',
            kind: 'installer',
            sha256: 'placeholder',
            size: 17,
          },
        ],
      }, null, 2)}\n`,
      'utf8',
    );
    writeFileSync(
      path.join(windowsDir, 'installer-smoke-report.json'),
      `${JSON.stringify({
        platform: 'windows',
        arch: 'x64',
        manifestPath: path.join(windowsDir, 'release-asset-manifest.json'),
        installableArtifactRelativePaths: [
          'desktop/windows/x64/Claw.Studio_0.1.0_x64-setup.exe',
        ],
        kernelInstallContracts: {
          openclaw: expectedInstallerContract,
        },
      }, null, 2)}\n`,
      'utf8',
    );

    assert.throws(
      () => finalizer.finalizeReleaseAssets({
        profileId: 'agent-studio',
        releaseTag: 'release-2026-04-05-03',
        repository: 'sdkwork-ai/agent-studio',
        releaseAssetsDir,
      }),
      /OpenClaw installer contract/i,
    );

    writeFileSync(
      path.join(windowsDir, 'release-asset-manifest.json'),
      `${JSON.stringify({
        profileId: 'agent-studio',
        releaseTag: 'release-2026-04-05-03',
        platform: 'windows',
        arch: 'x64',
        kernelInstallContracts: {
          openclaw: {
            ...expectedInstallerContract,
            prepareFailureMode: 'defer-install',
          },
        },
        artifacts: [
          {
            name: 'Claw.Studio_0.1.0_x64-setup.exe',
            relativePath: 'desktop/windows/x64/Claw.Studio_0.1.0_x64-setup.exe',
            platform: 'windows',
            arch: 'x64',
            kind: 'installer',
            sha256: 'placeholder',
            size: 17,
          },
        ],
      }, null, 2)}\n`,
      'utf8',
    );

    assert.throws(
      () => finalizer.finalizeReleaseAssets({
        profileId: 'agent-studio',
        releaseTag: 'release-2026-04-05-03',
        repository: 'sdkwork-ai/agent-studio',
        releaseAssetsDir,
      }),
      /OpenClaw installer contract/i,
    );
  } finally {
    rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('release asset finalizer rejects desktop smoke reports that are missing install-ready layout evidence', async () => {
  const finalizerPath = path.join(rootDir, 'scripts', 'release', 'finalize-release-assets.mjs');
  const finalizer = await import(pathToFileURL(finalizerPath).href);

  const tempRoot = mkdtempSync(path.join(os.tmpdir(), 'claw-release-finalize-install-ready-'));
  const releaseAssetsDir = path.join(tempRoot, 'release-assets');
  const windowsDir = path.join(releaseAssetsDir, 'desktop', 'windows', 'x64');

  try {
    mkdirSync(windowsDir, { recursive: true });
    writeFileSync(
      path.join(windowsDir, 'Claw.Studio_0.1.0_x64-setup.exe'),
      'windows-installer',
      'utf8',
    );
    writeFileSync(
      path.join(windowsDir, 'release-asset-manifest.json'),
      `${JSON.stringify({
        profileId: 'agent-studio',
        releaseTag: 'release-2026-04-05-04',
        platform: 'windows',
        arch: 'x64',
        kernelInstallContracts: {
          openclaw: buildInstallerContract('windows'),
        },
        artifacts: [
          {
            name: 'Claw.Studio_0.1.0_x64-setup.exe',
            relativePath: 'desktop/windows/x64/Claw.Studio_0.1.0_x64-setup.exe',
            platform: 'windows',
            arch: 'x64',
            kind: 'installer',
            sha256: 'placeholder',
            size: 17,
          },
        ],
      }, null, 2)}\n`,
      'utf8',
    );
    writeFileSync(
      path.join(windowsDir, 'installer-smoke-report.json'),
      `${JSON.stringify({
        platform: 'windows',
        arch: 'x64',
        target: 'x86_64-pc-windows-msvc',
        manifestPath: path.join(windowsDir, 'release-asset-manifest.json'),
        verifiedAt: '2026-04-05T12:34:56.000Z',
        installableArtifactRelativePaths: [
          'desktop/windows/x64/Claw.Studio_0.1.0_x64-setup.exe',
        ],
        requiredCompanionArtifactRelativePaths: [],
        kernelInstallContracts: {
          openclaw: buildInstallerContract('windows'),
        },
        installPlanSummaries: [
          {
            relativePath: 'desktop/windows/x64/Claw.Studio_0.1.0_x64-setup.exe',
            format: 'nsis',
            platform: 'windows',
            stepCount: 3,
          },
        ],
      }, null, 2)}\n`,
      'utf8',
    );

    assert.throws(
      () => finalizer.finalizeReleaseAssets({
        profileId: 'agent-studio',
        releaseTag: 'release-2026-04-05-04',
        repository: 'sdkwork-ai/agent-studio',
        releaseAssetsDir,
      }),
      /install-ready|installReadyLayout/i,
    );

    writeFileSync(
      path.join(windowsDir, 'installer-smoke-report.json'),
      `${JSON.stringify({
        platform: 'windows',
        arch: 'x64',
        target: 'x86_64-pc-windows-msvc',
        manifestPath: path.join(windowsDir, 'release-asset-manifest.json'),
        verifiedAt: '2026-04-05T12:34:56.000Z',
        installableArtifactRelativePaths: [
          'desktop/windows/x64/Claw.Studio_0.1.0_x64-setup.exe',
        ],
        requiredCompanionArtifactRelativePaths: [],
        kernelInstallReadiness: {
          openclaw: {
            externalRuntimePolicy: buildOpenClawExternalRuntimePolicy(),
            installReadyLayout: {
              ...buildInstallReadyLayout({
                mode: '',
                installKey: currentOpenClawWindowsInstallKey,
              }),
            },
          },
        },
        kernelInstallContracts: {
          openclaw: buildInstallerContract('windows'),
        },
        installPlanSummaries: [
          {
            relativePath: 'desktop/windows/x64/Claw.Studio_0.1.0_x64-setup.exe',
            format: 'nsis',
            platform: 'windows',
            stepCount: 3,
          },
        ],
      }, null, 2)}\n`,
      'utf8',
    );

    assert.throws(
      () => finalizer.finalizeReleaseAssets({
        profileId: 'agent-studio',
        releaseTag: 'release-2026-04-05-04',
        repository: 'sdkwork-ai/agent-studio',
        releaseAssetsDir,
      }),
      /install-ready|installReadyLayout/i,
    );
  } finally {
    rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('release asset finalizer rejects desktop smoke reports whose install-ready mode drifts from the installer contract', async () => {
  const finalizerPath = path.join(rootDir, 'scripts', 'release', 'finalize-release-assets.mjs');
  const finalizer = await import(pathToFileURL(finalizerPath).href);

  const tempRoot = mkdtempSync(path.join(os.tmpdir(), 'claw-release-finalize-install-ready-mode-'));
  const releaseAssetsDir = path.join(tempRoot, 'release-assets');
  const windowsDir = path.join(releaseAssetsDir, 'desktop', 'windows', 'x64');

  try {
    mkdirSync(windowsDir, { recursive: true });
    writeFileSync(
      path.join(windowsDir, 'Claw.Studio_0.1.0_x64-setup.exe'),
      'windows-installer',
      'utf8',
    );
    writeFileSync(
      path.join(windowsDir, 'release-asset-manifest.json'),
      `${JSON.stringify({
        profileId: 'agent-studio',
        releaseTag: 'release-2026-04-05-05',
        platform: 'windows',
        arch: 'x64',
        kernelInstallContracts: {
          openclaw: buildInstallerContract('windows'),
        },
        artifacts: [
          {
            name: 'Claw.Studio_0.1.0_x64-setup.exe',
            relativePath: 'desktop/windows/x64/Claw.Studio_0.1.0_x64-setup.exe',
            platform: 'windows',
            arch: 'x64',
            kind: 'installer',
            sha256: 'placeholder',
            size: 17,
          },
        ],
      }, null, 2)}\n`,
      'utf8',
    );
    writeFileSync(
      path.join(windowsDir, 'installer-smoke-report.json'),
      `${JSON.stringify({
        platform: 'windows',
        arch: 'x64',
        target: 'x86_64-pc-windows-msvc',
        manifestPath: path.join(windowsDir, 'release-asset-manifest.json'),
        verifiedAt: '2026-04-05T12:45:56.000Z',
        installableArtifactRelativePaths: [
          'desktop/windows/x64/Claw.Studio_0.1.0_x64-setup.exe',
        ],
        requiredCompanionArtifactRelativePaths: [],
        kernelInstallReadiness: {
          openclaw: {
            externalRuntimePolicy: buildOpenClawExternalRuntimePolicy(),
            installReadyLayout: {
              ...buildInstallReadyLayout({
                mode: 'staged-layout',
                installKey: currentOpenClawWindowsInstallKey,
              }),
            },
          },
        },
        kernelInstallContracts: {
          openclaw: buildInstallerContract('windows'),
        },
        installPlanSummaries: [
          {
            relativePath: 'desktop/windows/x64/Claw.Studio_0.1.0_x64-setup.exe',
            format: 'nsis',
            platform: 'windows',
            stepCount: 3,
          },
        ],
      }, null, 2)}\n`,
      'utf8',
    );

    assert.throws(
      () => finalizer.finalizeReleaseAssets({
        profileId: 'agent-studio',
        releaseTag: 'release-2026-04-05-05',
        repository: 'sdkwork-ai/agent-studio',
        releaseAssetsDir,
      }),
      /install-ready|installReadyLayout|archive-extract-ready/i,
    );
  } finally {
    rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('release asset finalizer infers multi-family metadata when fallback assets do not have partial manifests', async () => {
  const finalizerPath = path.join(rootDir, 'scripts', 'release', 'finalize-release-assets.mjs');
  const finalizer = await import(pathToFileURL(finalizerPath).href);

  const tempRoot = mkdtempSync(path.join(os.tmpdir(), 'claw-release-finalize-fallback-'));
  const releaseAssetsDir = path.join(tempRoot, 'release-assets');
  const serverDir = path.join(releaseAssetsDir, 'server', 'linux', 'x64');
  const containerDir = path.join(releaseAssetsDir, 'container', 'linux', 'arm64', 'cpu');
  const kubernetesDir = path.join(releaseAssetsDir, 'kubernetes', 'linux', 'x64', 'nvidia-cuda');

  try {
    mkdirSync(serverDir, { recursive: true });
    mkdirSync(containerDir, { recursive: true });
    mkdirSync(kubernetesDir, { recursive: true });

    writeFileSync(
      path.join(serverDir, 'agent-studio-server-release-2026-04-03-05-linux-x64.tar.gz'),
      'server-asset',
      'utf8',
    );
    writeFileSync(
      path.join(containerDir, 'agent-studio-container-bundle-release-2026-04-03-05-linux-arm64-cpu.tar.gz'),
      'container-asset',
      'utf8',
    );
    writeFileSync(
      path.join(kubernetesDir, 'agent-studio-kubernetes-bundle-release-2026-04-03-05-linux-x64-nvidia-cuda.tar.gz'),
      'kubernetes-asset',
      'utf8',
    );
    writeReleaseNotesFixture(releaseAssetsDir);

    finalizer.finalizeReleaseAssets({
      profileId: 'agent-studio',
      releaseTag: 'release-2026-04-03-05',
      repository: 'sdkwork-ai/agent-studio',
      releaseAssetsDir,
      allowPartialRelease: true,
    });

    const manifest = JSON.parse(
      readFileSync(path.join(releaseAssetsDir, 'release-manifest.json'), 'utf8'),
    );

    assert.deepEqual(
      manifest.artifacts.map((artifact) => ({
        relativePath: artifact.relativePath,
        family: artifact.family,
        platform: artifact.platform,
        arch: artifact.arch,
        accelerator: artifact.accelerator,
        kind: artifact.kind,
      })),
      [
        {
          relativePath: 'container/linux/arm64/cpu/agent-studio-container-bundle-release-2026-04-03-05-linux-arm64-cpu.tar.gz',
          family: 'container',
          platform: 'linux',
          arch: 'arm64',
          accelerator: 'cpu',
          kind: 'archive',
        },
        {
          relativePath: 'kubernetes/linux/x64/nvidia-cuda/agent-studio-kubernetes-bundle-release-2026-04-03-05-linux-x64-nvidia-cuda.tar.gz',
          family: 'kubernetes',
          platform: 'linux',
          arch: 'x64',
          accelerator: 'nvidia-cuda',
          kind: 'archive',
        },
        {
          relativePath: 'server/linux/x64/agent-studio-server-release-2026-04-03-05-linux-x64.tar.gz',
          family: 'server',
          platform: 'linux',
          arch: 'x64',
          accelerator: undefined,
          kind: 'archive',
        },
      ],
    );
  } finally {
    rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('release asset finalizer lifts server bundle smoke metadata onto server artifacts', async () => {
  const finalizerPath = path.join(rootDir, 'scripts', 'release', 'finalize-release-assets.mjs');
  const finalizer = await import(pathToFileURL(finalizerPath).href);

  const tempRoot = mkdtempSync(path.join(os.tmpdir(), 'claw-release-finalize-server-smoke-'));
  const releaseAssetsDir = path.join(tempRoot, 'release-assets');
  const serverDir = path.join(releaseAssetsDir, 'server', 'linux', 'x64');
  const serverArchiveRelativePath = 'server/linux/x64/agent-studio-server-release-2026-04-03-08-linux-x64.tar.gz';
  const manifestPath = path.join(serverDir, 'release-asset-manifest.json');

  try {
    mkdirSync(serverDir, { recursive: true });
    writeFileSync(
      path.join(releaseAssetsDir, serverArchiveRelativePath),
      'server-archive',
      'utf8',
    );
    writeFileSync(
      manifestPath,
      `${JSON.stringify({
        profileId: 'agent-studio',
        releaseTag: 'release-2026-04-03-08',
        platform: 'linux',
        arch: 'x64',
        artifacts: [
          {
            name: 'agent-studio-server-release-2026-04-03-08-linux-x64.tar.gz',
            relativePath: serverArchiveRelativePath,
            family: 'server',
            platform: 'linux',
            arch: 'x64',
            kind: 'archive',
            sha256: 'placeholder',
            size: 14,
          },
        ],
      }, null, 2)}\n`,
      'utf8',
    );
    writeFileSync(
      path.join(serverDir, 'release-smoke-report.json'),
      `${JSON.stringify(buildServerSmokeReport({ manifestPath }), null, 2)}\n`,
      'utf8',
    );
    writeReleaseNotesFixture(releaseAssetsDir);

    finalizer.finalizeReleaseAssets({
      profileId: 'agent-studio',
      releaseTag: 'release-2026-04-03-08',
      repository: 'sdkwork-ai/agent-studio',
      releaseAssetsDir,
      allowPartialRelease: true,
    });

    const manifest = JSON.parse(
      readFileSync(path.join(releaseAssetsDir, 'release-manifest.json'), 'utf8'),
    );
    const serverArtifact = manifest.artifacts.find(
      (artifact) => artifact.relativePath === serverArchiveRelativePath,
    );

    assert.deepEqual(
      serverArtifact?.serverBundleSmoke,
      {
        reportRelativePath: 'server/linux/x64/release-smoke-report.json',
        manifestRelativePath: 'server/linux/x64/release-asset-manifest.json',
        ...commonSmokeEvidenceMetadata({
          reportPath: path.join(serverDir, 'release-smoke-report.json'),
          manifestPath,
        }),
        verifiedAt: '2026-04-06T09:08:07.000Z',
        target: 'x86_64-unknown-linux-gnu',
        smokeKind: 'bundle-runtime',
        status: 'passed',
        launcherRelativePath: 'bin/agentstudio-server',
        runtimeBaseUrl: 'http://127.0.0.1:19797',
        artifactRelativePaths: [
          'server/linux/x64/agent-studio-server-release-2026-04-03-08-linux-x64.tar.gz',
        ],
        checks: [
          {
            id: 'health-ready',
            status: 'passed',
            detail: '/claw/health/ready returned 200',
          },
          {
            id: 'host-endpoints',
            status: 'passed',
            detail: '/claw/manage/v1/host-endpoints returned canonical endpoints',
          },
          {
            id: 'browser-shell',
            status: 'passed',
            detail: '/ returned bundled browser shell HTML',
          },
        ],
      },
    );
  } finally {
    rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('release asset finalizer rejects incomplete release coverage unless partial finalization is explicit', async () => {
  const finalizerPath = path.join(rootDir, 'scripts', 'release', 'finalize-release-assets.mjs');
  const finalizer = await import(pathToFileURL(finalizerPath).href);

  const tempRoot = mkdtempSync(path.join(os.tmpdir(), 'claw-release-finalize-incomplete-'));
  const releaseAssetsDir = path.join(tempRoot, 'release-assets');
  const webDir = path.join(releaseAssetsDir, 'web');
  const webArchiveRelativePath = 'agent-studio-web-assets-release-2026-04-11-06.tar.gz';
  const manifestPath = path.join(webDir, 'release-asset-manifest.json');

  try {
    mkdirSync(webDir, { recursive: true });
    writeFileSync(
      path.join(releaseAssetsDir, webArchiveRelativePath),
      'web-archive',
      'utf8',
    );
    writeFileSync(
      manifestPath,
      `${JSON.stringify({
        profileId: 'agent-studio',
        releaseTag: 'release-2026-04-11-06',
        platform: 'web',
        arch: 'any',
        artifacts: [
          {
            name: webArchiveRelativePath,
            relativePath: webArchiveRelativePath,
            family: 'web',
            platform: 'web',
            arch: 'any',
            kind: 'archive',
            sha256: 'placeholder',
            size: 11,
          },
        ],
      }, null, 2)}\n`,
      'utf8',
    );
    writeFileSync(
      path.join(webDir, 'release-smoke-report.json'),
      `${JSON.stringify(buildWebSmokeReport({
        manifestPath,
        artifactRelativePaths: [webArchiveRelativePath],
      }), null, 2)}\n`,
      'utf8',
    );

    assert.throws(
      () => finalizer.finalizeReleaseAssets({
        profileId: 'agent-studio',
        releaseTag: 'release-2026-04-11-06',
        repository: 'sdkwork-ai/agent-studio',
        releaseAssetsDir,
      }),
      /Incomplete release asset coverage.*desktop\/windows\/x64/s,
    );
    writeReleaseNotesFixture(releaseAssetsDir);

    finalizer.finalizeReleaseAssets({
      profileId: 'agent-studio',
      releaseTag: 'release-2026-04-11-06',
      repository: 'sdkwork-ai/agent-studio',
      releaseAssetsDir,
      allowPartialRelease: true,
    });

    const manifest = JSON.parse(
      readFileSync(path.join(releaseAssetsDir, 'release-manifest.json'), 'utf8'),
    );

    assert.equal(manifest.artifacts.length, 1);
    assert.equal(manifest.artifacts[0].relativePath, webArchiveRelativePath);
    assert.equal(manifest.releaseCoverage.status, 'partial');
    assert.equal(manifest.releaseCoverage.allowPartialRelease, true);
    assert.deepEqual(manifest.releaseCoverage.presentTargets, ['web/web/any']);
    assert.match(
      manifest.releaseCoverage.missingTargets.join(','),
      /desktop\/windows\/x64\/nsis/,
    );
  } finally {
    rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('release asset finalizer removes stale finalized manifests when strict coverage validation fails', async () => {
  const finalizerPath = path.join(rootDir, 'scripts', 'release', 'finalize-release-assets.mjs');
  const finalizer = await import(pathToFileURL(finalizerPath).href);

  const tempRoot = mkdtempSync(path.join(os.tmpdir(), 'claw-release-finalize-stale-final-'));
  const releaseAssetsDir = path.join(tempRoot, 'release-assets');
  const webDir = path.join(releaseAssetsDir, 'web');
  const webArchiveRelativePath = 'agent-studio-web-assets-release-2026-04-11-07.tar.gz';
  const manifestPath = path.join(webDir, 'release-asset-manifest.json');
  const staleReleaseManifestPath = path.join(releaseAssetsDir, 'release-manifest.json');
  const staleReleaseManifestChecksumPath = path.join(releaseAssetsDir, 'release-manifest.json.sha256.txt');
  const staleAttestationEvidencePath = path.join(releaseAssetsDir, 'release-attestations.json');
  const staleChecksumPath = path.join(releaseAssetsDir, 'SHA256SUMS.txt');

  try {
    mkdirSync(webDir, { recursive: true });
    writeFileSync(
      path.join(releaseAssetsDir, webArchiveRelativePath),
      'web-archive',
      'utf8',
    );
    writeFileSync(
      manifestPath,
      `${JSON.stringify({
        profileId: 'agent-studio',
        releaseTag: 'release-2026-04-11-07',
        platform: 'web',
        arch: 'any',
        artifacts: [
          {
            name: webArchiveRelativePath,
            relativePath: webArchiveRelativePath,
            family: 'web',
            platform: 'web',
            arch: 'any',
            kind: 'archive',
            sha256: 'placeholder',
            size: 11,
          },
        ],
      }, null, 2)}\n`,
      'utf8',
    );
    writeFileSync(
      path.join(webDir, 'release-smoke-report.json'),
      `${JSON.stringify(buildWebSmokeReport({
        manifestPath,
        artifactRelativePaths: [webArchiveRelativePath],
      }), null, 2)}\n`,
      'utf8',
    );
    writeFileSync(
      staleReleaseManifestPath,
      `${JSON.stringify({
        profileId: 'agent-studio',
        releaseTag: 'release-previous',
        releaseCoverage: {
          status: 'complete',
        },
        artifacts: [],
      }, null, 2)}\n`,
      'utf8',
    );
    writeFileSync(
      staleChecksumPath,
      'stale-checksum  stale-artifact\n',
      'utf8',
    );
    writeFileSync(
      staleReleaseManifestChecksumPath,
      `${'0'.repeat(64)}  release-manifest.json\n`,
      'utf8',
    );
    writeFileSync(
      staleAttestationEvidencePath,
      `${JSON.stringify({ stale: true }, null, 2)}\n`,
      'utf8',
    );

    assert.throws(
      () => finalizer.finalizeReleaseAssets({
        profileId: 'agent-studio',
        releaseTag: 'release-2026-04-11-07',
        repository: 'sdkwork-ai/agent-studio',
        releaseAssetsDir,
      }),
      /Incomplete release asset coverage.*desktop\/windows\/x64/s,
    );

    assert.equal(existsSync(staleReleaseManifestPath), false);
    assert.equal(existsSync(staleReleaseManifestChecksumPath), false);
    assert.equal(existsSync(staleAttestationEvidencePath), false);
    assert.equal(existsSync(staleChecksumPath), false);
  } finally {
    rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('release asset finalizer lifts web archive smoke metadata onto web artifacts', async () => {
  const finalizerPath = path.join(rootDir, 'scripts', 'release', 'finalize-release-assets.mjs');
  const finalizer = await import(pathToFileURL(finalizerPath).href);

  const tempRoot = mkdtempSync(path.join(os.tmpdir(), 'claw-release-finalize-web-smoke-'));
  const releaseAssetsDir = path.join(tempRoot, 'release-assets');
  const webDir = path.join(releaseAssetsDir, 'web');
  const webArchiveRelativePath = 'agent-studio-web-assets-release-2026-04-11-04.tar.gz';
  const manifestPath = path.join(webDir, 'release-asset-manifest.json');

  try {
    mkdirSync(webDir, { recursive: true });
    writeFileSync(
      path.join(releaseAssetsDir, webArchiveRelativePath),
      'web-archive',
      'utf8',
    );
    writeFileSync(
      manifestPath,
      `${JSON.stringify({
        profileId: 'agent-studio',
        releaseTag: 'release-2026-04-11-04',
        platform: 'web',
        arch: 'any',
        artifacts: [
          {
            name: webArchiveRelativePath,
            relativePath: webArchiveRelativePath,
            family: 'web',
            platform: 'web',
            arch: 'any',
            kind: 'archive',
            sha256: 'placeholder',
            size: 11,
          },
        ],
      }, null, 2)}\n`,
      'utf8',
    );
    writeFileSync(
      path.join(webDir, 'release-smoke-report.json'),
      `${JSON.stringify(buildWebSmokeReport({ manifestPath }), null, 2)}\n`,
      'utf8',
    );
    writeReleaseNotesFixture(releaseAssetsDir);

    finalizer.finalizeReleaseAssets({
      profileId: 'agent-studio',
      releaseTag: 'release-2026-04-11-04',
      repository: 'sdkwork-ai/agent-studio',
      releaseAssetsDir,
      allowPartialRelease: true,
    });

    const manifest = JSON.parse(
      readFileSync(path.join(releaseAssetsDir, 'release-manifest.json'), 'utf8'),
    );
    const webArtifact = manifest.artifacts.find(
      (artifact) => artifact.relativePath === webArchiveRelativePath,
    );

    assert.deepEqual(
      webArtifact?.webArchiveSmoke,
      {
        reportRelativePath: 'web/release-smoke-report.json',
        manifestRelativePath: 'web/release-asset-manifest.json',
        ...commonSmokeEvidenceMetadata({
          reportPath: path.join(webDir, 'release-smoke-report.json'),
          manifestPath,
        }),
        verifiedAt: '2026-04-11T08:09:10.000Z',
        target: '',
        smokeKind: 'web-archive-content',
        status: 'passed',
        artifactRelativePaths: [webArchiveRelativePath],
        checks: buildWebSmokeReport({ manifestPath }).checks,
      },
    );
  } finally {
    rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('release asset finalizer rejects web artifacts when archive smoke evidence is missing or stale', async () => {
  const finalizerPath = path.join(rootDir, 'scripts', 'release', 'finalize-release-assets.mjs');
  const finalizer = await import(pathToFileURL(finalizerPath).href);

  const tempRoot = mkdtempSync(path.join(os.tmpdir(), 'claw-release-finalize-web-smoke-missing-'));
  const releaseAssetsDir = path.join(tempRoot, 'release-assets');
  const webDir = path.join(releaseAssetsDir, 'web');
  const webArchiveRelativePath = 'agent-studio-web-assets-release-2026-04-11-05.tar.gz';
  const manifestPath = path.join(webDir, 'release-asset-manifest.json');

  try {
    mkdirSync(webDir, { recursive: true });
    writeFileSync(
      path.join(releaseAssetsDir, webArchiveRelativePath),
      'web-archive',
      'utf8',
    );
    writeFileSync(
      manifestPath,
      `${JSON.stringify({
        profileId: 'agent-studio',
        releaseTag: 'release-2026-04-11-05',
        platform: 'web',
        arch: 'any',
        artifacts: [
          {
            name: webArchiveRelativePath,
            relativePath: webArchiveRelativePath,
            family: 'web',
            platform: 'web',
            arch: 'any',
            kind: 'archive',
            sha256: 'placeholder',
            size: 11,
          },
        ],
      }, null, 2)}\n`,
      'utf8',
    );

    assert.throws(
      () => finalizer.finalizeReleaseAssets({
        profileId: 'agent-studio',
        releaseTag: 'release-2026-04-11-05',
        repository: 'sdkwork-ai/agent-studio',
        releaseAssetsDir,
      }),
      /Missing web archive smoke report/,
    );

    writeFileSync(
      path.join(webDir, 'release-smoke-report.json'),
      `${JSON.stringify(buildWebSmokeReport({
        manifestPath,
        artifactRelativePaths: ['agent-studio-web-assets-another.tar.gz'],
      }), null, 2)}\n`,
      'utf8',
    );

    assert.throws(
      () => finalizer.finalizeReleaseAssets({
        profileId: 'agent-studio',
        releaseTag: 'release-2026-04-11-05',
        repository: 'sdkwork-ai/agent-studio',
        releaseAssetsDir,
      }),
      /Web archive smoke report does not match the current artifact set/,
    );

    writeFileSync(
      path.join(webDir, 'release-smoke-report.json'),
      `${JSON.stringify(buildWebSmokeReport({
        manifestPath,
        artifactRelativePaths: [webArchiveRelativePath],
        checks: buildWebSmokeReport({ manifestPath }).checks.filter(
          (check) => check.id !== 'public-doc-boundary',
        ),
      }), null, 2)}\n`,
      'utf8',
    );

    assert.throws(
      () => finalizer.finalizeReleaseAssets({
        profileId: 'agent-studio',
        releaseTag: 'release-2026-04-11-05',
        repository: 'sdkwork-ai/agent-studio',
        releaseAssetsDir,
      }),
      /Web archive smoke report is missing a passing public-doc-boundary check/,
    );
  } finally {
    rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('release asset finalizer rejects server artifacts when bundle smoke evidence is missing or stale', async () => {
  const finalizerPath = path.join(rootDir, 'scripts', 'release', 'finalize-release-assets.mjs');
  const finalizer = await import(pathToFileURL(finalizerPath).href);

  const tempRoot = mkdtempSync(path.join(os.tmpdir(), 'claw-release-finalize-server-smoke-missing-'));
  const releaseAssetsDir = path.join(tempRoot, 'release-assets');
  const serverDir = path.join(releaseAssetsDir, 'server', 'linux', 'x64');
  const serverArchiveRelativePath = 'server/linux/x64/agent-studio-server-release-2026-04-03-09-linux-x64.tar.gz';
  const manifestPath = path.join(serverDir, 'release-asset-manifest.json');

  try {
    mkdirSync(serverDir, { recursive: true });
    writeFileSync(
      path.join(releaseAssetsDir, serverArchiveRelativePath),
      'server-archive',
      'utf8',
    );
    writeFileSync(
      manifestPath,
      `${JSON.stringify({
        profileId: 'agent-studio',
        releaseTag: 'release-2026-04-03-09',
        platform: 'linux',
        arch: 'x64',
        artifacts: [
          {
            name: 'agent-studio-server-release-2026-04-03-09-linux-x64.tar.gz',
            relativePath: serverArchiveRelativePath,
            family: 'server',
            platform: 'linux',
            arch: 'x64',
            kind: 'archive',
            sha256: 'placeholder',
            size: 14,
          },
        ],
      }, null, 2)}\n`,
      'utf8',
    );

    assert.throws(
      () => finalizer.finalizeReleaseAssets({
        profileId: 'agent-studio',
        releaseTag: 'release-2026-04-03-09',
        repository: 'sdkwork-ai/agent-studio',
        releaseAssetsDir,
      }),
      /Missing server bundle smoke report/,
    );

    writeFileSync(
      path.join(serverDir, 'release-smoke-report.json'),
      `${JSON.stringify(buildServerSmokeReport({
        manifestPath,
        artifactRelativePaths: ['server/linux/x64/another-server-archive.tar.gz'],
      }), null, 2)}\n`,
      'utf8',
    );

    assert.throws(
      () => finalizer.finalizeReleaseAssets({
        profileId: 'agent-studio',
        releaseTag: 'release-2026-04-03-09',
        repository: 'sdkwork-ai/agent-studio',
        releaseAssetsDir,
      }),
      /Server bundle smoke report does not match the current artifact set/,
    );
  } finally {
    rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('release asset finalizer rejects server smoke reports with unsafe launcher paths', async () => {
  const finalizerPath = path.join(rootDir, 'scripts', 'release', 'finalize-release-assets.mjs');
  const finalizer = await import(pathToFileURL(finalizerPath).href);

  const tempRoot = mkdtempSync(path.join(os.tmpdir(), 'claw-release-finalize-server-launcher-path-'));
  const releaseAssetsDir = path.join(tempRoot, 'release-assets');
  const serverDir = path.join(releaseAssetsDir, 'server', 'linux', 'x64');
  const serverArchiveRelativePath = 'server/linux/x64/agent-studio-server-release-2026-04-13-01-linux-x64.tar.gz';
  const manifestPath = path.join(serverDir, 'release-asset-manifest.json');

  try {
    mkdirSync(serverDir, { recursive: true });
    writeFileSync(
      path.join(releaseAssetsDir, serverArchiveRelativePath),
      'server-archive',
      'utf8',
    );
    writeFileSync(
      manifestPath,
      `${JSON.stringify({
        profileId: 'agent-studio',
        releaseTag: 'release-2026-04-13-01',
        platform: 'linux',
        arch: 'x64',
        artifacts: [
          {
            name: path.basename(serverArchiveRelativePath),
            relativePath: serverArchiveRelativePath,
            family: 'server',
            platform: 'linux',
            arch: 'x64',
            kind: 'archive',
            sha256: 'placeholder',
            size: 14,
          },
        ],
      }, null, 2)}\n`,
      'utf8',
    );
    writeFileSync(
      path.join(serverDir, 'release-smoke-report.json'),
      `${JSON.stringify(buildServerSmokeReport({
        manifestPath,
        artifactRelativePaths: [serverArchiveRelativePath],
        launcherRelativePath: '../bin/agentstudio-server',
      }), null, 2)}\n`,
      'utf8',
    );

    assert.throws(
      () => finalizer.finalizeReleaseAssets({
        profileId: 'agent-studio',
        releaseTag: 'release-2026-04-13-01',
        repository: 'sdkwork-ai/agent-studio',
        releaseAssetsDir,
        allowPartialRelease: true,
      }),
      /unsafe launcher path/,
    );
  } finally {
    rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('release asset finalizer lifts deployment smoke metadata onto container and kubernetes artifacts', async () => {
  const finalizerPath = path.join(rootDir, 'scripts', 'release', 'finalize-release-assets.mjs');
  const finalizer = await import(pathToFileURL(finalizerPath).href);

  const tempRoot = mkdtempSync(path.join(os.tmpdir(), 'claw-release-finalize-deployment-smoke-'));
  const releaseAssetsDir = path.join(tempRoot, 'release-assets');
  const containerDir = path.join(releaseAssetsDir, 'container', 'linux', 'x64', 'cpu');
  const kubernetesDir = path.join(releaseAssetsDir, 'kubernetes', 'linux', 'x64', 'cpu');
  const containerArchiveRelativePath = 'container/linux/x64/cpu/agent-studio-container-bundle-release-2026-04-06-05-linux-x64-cpu.tar.gz';
  const kubernetesArchiveRelativePath = 'kubernetes/linux/x64/cpu/agent-studio-kubernetes-bundle-release-2026-04-06-05-linux-x64-cpu.tar.gz';
  const containerManifestPath = path.join(containerDir, 'release-asset-manifest.json');
  const kubernetesManifestPath = path.join(kubernetesDir, 'release-asset-manifest.json');

  try {
    mkdirSync(containerDir, { recursive: true });
    mkdirSync(kubernetesDir, { recursive: true });
    writeFileSync(path.join(releaseAssetsDir, containerArchiveRelativePath), 'container-archive', 'utf8');
    writeFileSync(path.join(releaseAssetsDir, kubernetesArchiveRelativePath), 'kubernetes-archive', 'utf8');
    writeFileSync(
      containerManifestPath,
      `${JSON.stringify({
        profileId: 'agent-studio',
        releaseTag: 'release-2026-04-06-05',
        platform: 'linux',
        arch: 'x64',
        artifacts: [
          {
            name: path.basename(containerArchiveRelativePath),
            relativePath: containerArchiveRelativePath,
            family: 'container',
            platform: 'linux',
            arch: 'x64',
            accelerator: 'cpu',
            kind: 'archive',
            sha256: 'placeholder',
            size: 17,
          },
        ],
      }, null, 2)}\n`,
      'utf8',
    );
    writeFileSync(
      kubernetesManifestPath,
      `${JSON.stringify({
        profileId: 'agent-studio',
        releaseTag: 'release-2026-04-06-05',
        platform: 'linux',
        arch: 'x64',
        artifacts: [
          {
            name: path.basename(kubernetesArchiveRelativePath),
            relativePath: kubernetesArchiveRelativePath,
            family: 'kubernetes',
            platform: 'linux',
            arch: 'x64',
            accelerator: 'cpu',
            kind: 'archive',
            sha256: 'placeholder',
            size: 18,
          },
        ],
      }, null, 2)}\n`,
      'utf8',
    );
    writeFileSync(
      path.join(containerDir, 'release-smoke-report.json'),
      `${JSON.stringify(buildDeploymentSmokeReport({
        family: 'container',
        manifestPath: containerManifestPath,
        artifactRelativePaths: [containerArchiveRelativePath],
      }), null, 2)}\n`,
      'utf8',
    );
    writeFileSync(
      path.join(kubernetesDir, 'release-smoke-report.json'),
      `${JSON.stringify(buildDeploymentSmokeReport({
        family: 'kubernetes',
        manifestPath: kubernetesManifestPath,
        artifactRelativePaths: [kubernetesArchiveRelativePath],
      }), null, 2)}\n`,
      'utf8',
    );
    writeReleaseNotesFixture(releaseAssetsDir);

    finalizer.finalizeReleaseAssets({
      profileId: 'agent-studio',
      releaseTag: 'release-2026-04-06-05',
      repository: 'sdkwork-ai/agent-studio',
      releaseAssetsDir,
      allowPartialRelease: true,
    });

    const manifest = JSON.parse(
      readFileSync(path.join(releaseAssetsDir, 'release-manifest.json'), 'utf8'),
    );
    const containerArtifact = manifest.artifacts.find(
      (artifact) => artifact.relativePath === containerArchiveRelativePath,
    );
    const kubernetesArtifact = manifest.artifacts.find(
      (artifact) => artifact.relativePath === kubernetesArchiveRelativePath,
    );

    assert.deepEqual(
      containerArtifact?.deploymentSmoke,
      {
        reportRelativePath: 'container/linux/x64/cpu/release-smoke-report.json',
        manifestRelativePath: 'container/linux/x64/cpu/release-asset-manifest.json',
        ...commonSmokeEvidenceMetadata({
          reportPath: path.join(containerDir, 'release-smoke-report.json'),
          manifestPath: containerManifestPath,
        }),
        verifiedAt: '2026-04-06T10:11:12.000Z',
        target: 'x86_64-unknown-linux-gnu',
        smokeKind: 'live-deployment',
        status: 'passed',
        launcherRelativePath: 'deployments/docker/docker-compose.yml',
        runtimeBaseUrl: 'http://127.0.0.1:18797',
        artifactRelativePaths: [containerArchiveRelativePath],
        checks: [
          {
            id: 'deployment-identity',
            status: 'passed',
            detail: 'packaged container bundle preserves deployment family and accelerator identity',
          },
          {
            id: 'runtime-profile',
            status: 'passed',
            detail: 'packaged container profile pins safe public bind and data directory defaults',
          },
          {
            id: 'manage-credentials',
            status: 'passed',
            detail: 'packaged docker compose requires explicit manage credentials',
          },
          {
            id: 'persistent-storage',
            status: 'passed',
            detail: 'packaged docker compose persists /var/lib/agentstudio-server',
          },
          {
            id: 'docker-compose-up',
            status: 'passed',
            detail: 'docker compose brought the packaged bundle online',
          },
          {
            id: 'docker-compose-healthy',
            status: 'passed',
            detail: 'docker compose reported all packaged services healthy',
          },
          {
            id: 'health-ready',
            status: 'passed',
            detail: '/claw/health/ready returned 200',
          },
          {
            id: 'host-endpoints',
            status: 'passed',
            detail: '/claw/manage/v1/host-endpoints returned canonical endpoints',
          },
          {
            id: 'browser-shell',
            status: 'passed',
            detail: '/ returned bundled browser shell HTML',
          },
        ],
      },
    );
    assert.deepEqual(
      kubernetesArtifact?.deploymentSmoke,
      {
        reportRelativePath: 'kubernetes/linux/x64/cpu/release-smoke-report.json',
        manifestRelativePath: 'kubernetes/linux/x64/cpu/release-asset-manifest.json',
        ...commonSmokeEvidenceMetadata({
          reportPath: path.join(kubernetesDir, 'release-smoke-report.json'),
          manifestPath: kubernetesManifestPath,
        }),
        verifiedAt: '2026-04-06T10:11:12.000Z',
        target: 'x86_64-unknown-linux-gnu',
        smokeKind: 'chart-render',
        status: 'passed',
        launcherRelativePath: 'chart/Chart.yaml',
        artifactRelativePaths: [kubernetesArchiveRelativePath],
        checks: [
          {
            id: 'helm-template',
            status: 'passed',
            detail: 'helm template rendered the packaged chart successfully',
          },
          {
            id: 'deployment-identity',
            status: 'passed',
            detail: 'packaged kubernetes bundle preserves target architecture and accelerator identity',
          },
          {
            id: 'image-reference',
            status: 'passed',
            detail: 'rendered manifests reference the packaged OCI image coordinates',
          },
          {
            id: 'configmap-runtime-identity',
            status: 'passed',
            detail: 'rendered config map preserves kubernetes deployment family and accelerator profile',
          },
          {
            id: 'readiness-probe',
            status: 'passed',
            detail: 'rendered deployment probes /claw/health/ready',
          },
          {
            id: 'secret-ref',
            status: 'passed',
            detail: 'rendered deployment consumes Secret-backed control-plane credentials',
          },
          {
            id: 'persistent-storage',
            status: 'passed',
            detail: 'rendered manifests mount /var/lib/agentstudio-server through a PersistentVolumeClaim',
          },
        ],
      },
    );
  } finally {
    rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('release asset finalizer accepts structured skipped deployment smoke evidence and preserves it in the release manifest', async () => {
  const finalizerPath = path.join(rootDir, 'scripts', 'release', 'finalize-release-assets.mjs');
  const finalizer = await import(pathToFileURL(finalizerPath).href);

  const tempRoot = mkdtempSync(path.join(os.tmpdir(), 'claw-release-finalize-deployment-smoke-skipped-'));
  const releaseAssetsDir = path.join(tempRoot, 'release-assets');
  const containerDir = path.join(releaseAssetsDir, 'container', 'linux', 'x64', 'cpu');
  const kubernetesDir = path.join(releaseAssetsDir, 'kubernetes', 'linux', 'x64', 'cpu');
  const containerArchiveRelativePath = 'container/linux/x64/cpu/agent-studio-container-bundle-release-2026-04-06-07-linux-x64-cpu.tar.gz';
  const kubernetesArchiveRelativePath = 'kubernetes/linux/x64/cpu/agent-studio-kubernetes-bundle-release-2026-04-06-07-linux-x64-cpu.tar.gz';
  const containerManifestPath = path.join(containerDir, 'release-asset-manifest.json');
  const kubernetesManifestPath = path.join(kubernetesDir, 'release-asset-manifest.json');

  try {
    mkdirSync(containerDir, { recursive: true });
    mkdirSync(kubernetesDir, { recursive: true });
    writeFileSync(path.join(releaseAssetsDir, containerArchiveRelativePath), 'container-archive', 'utf8');
    writeFileSync(path.join(releaseAssetsDir, kubernetesArchiveRelativePath), 'kubernetes-archive', 'utf8');
    writeFileSync(
      containerManifestPath,
      `${JSON.stringify({
        profileId: 'agent-studio',
        releaseTag: 'release-2026-04-06-07',
        platform: 'linux',
        arch: 'x64',
        artifacts: [
          {
            name: path.basename(containerArchiveRelativePath),
            relativePath: containerArchiveRelativePath,
            family: 'container',
            platform: 'linux',
            arch: 'x64',
            accelerator: 'cpu',
            kind: 'archive',
            sha256: 'placeholder',
            size: 17,
          },
        ],
      }, null, 2)}\n`,
      'utf8',
    );
    writeFileSync(
      kubernetesManifestPath,
      `${JSON.stringify({
        profileId: 'agent-studio',
        releaseTag: 'release-2026-04-06-07',
        platform: 'linux',
        arch: 'x64',
        artifacts: [
          {
            name: path.basename(kubernetesArchiveRelativePath),
            relativePath: kubernetesArchiveRelativePath,
            family: 'kubernetes',
            platform: 'linux',
            arch: 'x64',
            accelerator: 'cpu',
            kind: 'archive',
            sha256: 'placeholder',
            size: 18,
          },
        ],
      }, null, 2)}\n`,
      'utf8',
    );
    writeFileSync(
      path.join(containerDir, 'release-smoke-report.json'),
      `${JSON.stringify(buildDeploymentSmokeReport({
        family: 'container',
        manifestPath: containerManifestPath,
        artifactRelativePaths: [containerArchiveRelativePath],
        status: 'skipped',
        launcherRelativePath: '',
        runtimeBaseUrl: '',
        checks: [],
        skippedReason: 'docker and/or docker compose are unavailable on this host',
        capabilities: {
          docker: false,
          dockerCompose: true,
        },
      }), null, 2)}\n`,
      'utf8',
    );
    writeFileSync(
      path.join(kubernetesDir, 'release-smoke-report.json'),
      `${JSON.stringify(buildDeploymentSmokeReport({
        family: 'kubernetes',
        manifestPath: kubernetesManifestPath,
        artifactRelativePaths: [kubernetesArchiveRelativePath],
        status: 'skipped',
        launcherRelativePath: '',
        checks: [],
        skippedReason: 'helm is unavailable on this host',
        capabilities: {
          helm: false,
          kubectl: true,
        },
      }), null, 2)}\n`,
      'utf8',
    );
    writeReleaseNotesFixture(releaseAssetsDir);

    finalizer.finalizeReleaseAssets({
      profileId: 'agent-studio',
      releaseTag: 'release-2026-04-06-07',
      repository: 'sdkwork-ai/agent-studio',
      releaseAssetsDir,
      allowPartialRelease: true,
    });

    const manifest = JSON.parse(
      readFileSync(path.join(releaseAssetsDir, 'release-manifest.json'), 'utf8'),
    );
    const containerArtifact = manifest.artifacts.find(
      (artifact) => artifact.relativePath === containerArchiveRelativePath,
    );
    const kubernetesArtifact = manifest.artifacts.find(
      (artifact) => artifact.relativePath === kubernetesArchiveRelativePath,
    );

    assert.deepEqual(
      containerArtifact?.deploymentSmoke,
      {
        reportRelativePath: 'container/linux/x64/cpu/release-smoke-report.json',
        manifestRelativePath: 'container/linux/x64/cpu/release-asset-manifest.json',
        ...commonSmokeEvidenceMetadata({
          reportPath: path.join(containerDir, 'release-smoke-report.json'),
          manifestPath: containerManifestPath,
        }),
        verifiedAt: '2026-04-06T10:11:12.000Z',
        target: 'x86_64-unknown-linux-gnu',
        smokeKind: 'live-deployment',
        status: 'skipped',
        artifactRelativePaths: [containerArchiveRelativePath],
        checks: [],
        skippedReason: 'docker and/or docker compose are unavailable on this host',
        capabilities: {
          docker: false,
          dockerCompose: true,
        },
      },
    );
    assert.deepEqual(
      kubernetesArtifact?.deploymentSmoke,
      {
        reportRelativePath: 'kubernetes/linux/x64/cpu/release-smoke-report.json',
        manifestRelativePath: 'kubernetes/linux/x64/cpu/release-asset-manifest.json',
        ...commonSmokeEvidenceMetadata({
          reportPath: path.join(kubernetesDir, 'release-smoke-report.json'),
          manifestPath: kubernetesManifestPath,
        }),
        verifiedAt: '2026-04-06T10:11:12.000Z',
        target: 'x86_64-unknown-linux-gnu',
        smokeKind: 'chart-render',
        status: 'skipped',
        artifactRelativePaths: [kubernetesArchiveRelativePath],
        checks: [],
        skippedReason: 'helm is unavailable on this host',
        capabilities: {
          helm: false,
          kubectl: true,
        },
      },
    );
  } finally {
    rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('release asset finalizer rejects deployment artifacts when smoke evidence is missing or stale', async () => {
  const finalizerPath = path.join(rootDir, 'scripts', 'release', 'finalize-release-assets.mjs');
  const finalizer = await import(pathToFileURL(finalizerPath).href);

  const tempRoot = mkdtempSync(path.join(os.tmpdir(), 'claw-release-finalize-deployment-smoke-missing-'));
  const releaseAssetsDir = path.join(tempRoot, 'release-assets');
  const containerDir = path.join(releaseAssetsDir, 'container', 'linux', 'x64', 'cpu');
  const kubernetesDir = path.join(releaseAssetsDir, 'kubernetes', 'linux', 'x64', 'cpu');
  const containerArchiveRelativePath = 'container/linux/x64/cpu/agent-studio-container-bundle-release-2026-04-06-06-linux-x64-cpu.tar.gz';
  const kubernetesArchiveRelativePath = 'kubernetes/linux/x64/cpu/agent-studio-kubernetes-bundle-release-2026-04-06-06-linux-x64-cpu.tar.gz';
  const containerManifestPath = path.join(containerDir, 'release-asset-manifest.json');
  const kubernetesManifestPath = path.join(kubernetesDir, 'release-asset-manifest.json');

  try {
    mkdirSync(containerDir, { recursive: true });
    mkdirSync(kubernetesDir, { recursive: true });
    writeFileSync(path.join(releaseAssetsDir, containerArchiveRelativePath), 'container-archive', 'utf8');
    writeFileSync(path.join(releaseAssetsDir, kubernetesArchiveRelativePath), 'kubernetes-archive', 'utf8');
    writeFileSync(
      containerManifestPath,
      `${JSON.stringify({
        profileId: 'agent-studio',
        releaseTag: 'release-2026-04-06-06',
        platform: 'linux',
        arch: 'x64',
        artifacts: [
          {
            name: path.basename(containerArchiveRelativePath),
            relativePath: containerArchiveRelativePath,
            family: 'container',
            platform: 'linux',
            arch: 'x64',
            accelerator: 'cpu',
            kind: 'archive',
            sha256: 'placeholder',
            size: 17,
          },
        ],
      }, null, 2)}\n`,
      'utf8',
    );
    writeFileSync(
      kubernetesManifestPath,
      `${JSON.stringify({
        profileId: 'agent-studio',
        releaseTag: 'release-2026-04-06-06',
        platform: 'linux',
        arch: 'x64',
        artifacts: [
          {
            name: path.basename(kubernetesArchiveRelativePath),
            relativePath: kubernetesArchiveRelativePath,
            family: 'kubernetes',
            platform: 'linux',
            arch: 'x64',
            accelerator: 'cpu',
            kind: 'archive',
            sha256: 'placeholder',
            size: 18,
          },
        ],
      }, null, 2)}\n`,
      'utf8',
    );

    assert.throws(
      () => finalizer.finalizeReleaseAssets({
        profileId: 'agent-studio',
        releaseTag: 'release-2026-04-06-06',
        repository: 'sdkwork-ai/agent-studio',
        releaseAssetsDir,
      }),
      /Missing container deployment smoke report/,
    );

    writeFileSync(
      path.join(containerDir, 'release-smoke-report.json'),
      `${JSON.stringify(buildDeploymentSmokeReport({
        family: 'container',
        manifestPath: containerManifestPath,
        artifactRelativePaths: [containerArchiveRelativePath],
      }), null, 2)}\n`,
      'utf8',
    );
    writeFileSync(
      path.join(kubernetesDir, 'release-smoke-report.json'),
      `${JSON.stringify(buildDeploymentSmokeReport({
        family: 'kubernetes',
        manifestPath: kubernetesManifestPath,
        artifactRelativePaths: ['kubernetes/linux/x64/cpu/another-kubernetes-bundle.tar.gz'],
      }), null, 2)}\n`,
      'utf8',
    );

    assert.throws(
      () => finalizer.finalizeReleaseAssets({
        profileId: 'agent-studio',
        releaseTag: 'release-2026-04-06-06',
        repository: 'sdkwork-ai/agent-studio',
        releaseAssetsDir,
      }),
      /Kubernetes deployment smoke report does not match the current artifact set/,
    );

    writeFileSync(
      path.join(kubernetesDir, 'release-smoke-report.json'),
      `${JSON.stringify(buildDeploymentSmokeReport({
        family: 'kubernetes',
        manifestPath: kubernetesManifestPath,
        artifactRelativePaths: [kubernetesArchiveRelativePath],
      }), null, 2)}\n`,
      'utf8',
    );
    writeFileSync(
      path.join(containerDir, 'release-smoke-report.json'),
      `${JSON.stringify(buildDeploymentSmokeReport({
        family: 'container',
        manifestPath: containerManifestPath,
        artifactRelativePaths: [containerArchiveRelativePath],
        checks: buildDeploymentChecksWithout('container', 'deployment-identity'),
      }), null, 2)}\n`,
      'utf8',
    );

    assert.throws(
      () => finalizer.finalizeReleaseAssets({
        profileId: 'agent-studio',
        releaseTag: 'release-2026-04-06-06',
        repository: 'sdkwork-ai/agent-studio',
        releaseAssetsDir,
      }),
      /Container deployment smoke report is missing a passing deployment-identity check/,
    );

    writeFileSync(
      path.join(containerDir, 'release-smoke-report.json'),
      `${JSON.stringify(buildDeploymentSmokeReport({
        family: 'container',
        manifestPath: containerManifestPath,
        artifactRelativePaths: [containerArchiveRelativePath],
        checks: buildDeploymentChecksWithout('container', 'runtime-profile'),
      }), null, 2)}\n`,
      'utf8',
    );

    assert.throws(
      () => finalizer.finalizeReleaseAssets({
        profileId: 'agent-studio',
        releaseTag: 'release-2026-04-06-06',
        repository: 'sdkwork-ai/agent-studio',
        releaseAssetsDir,
      }),
      /Container deployment smoke report is missing a passing runtime-profile check/,
    );

    writeFileSync(
      path.join(containerDir, 'release-smoke-report.json'),
      `${JSON.stringify(buildDeploymentSmokeReport({
        family: 'container',
        manifestPath: containerManifestPath,
        artifactRelativePaths: [containerArchiveRelativePath],
        checks: buildDeploymentChecksWithout('container', 'manage-credentials'),
      }), null, 2)}\n`,
      'utf8',
    );

    assert.throws(
      () => finalizer.finalizeReleaseAssets({
        profileId: 'agent-studio',
        releaseTag: 'release-2026-04-06-06',
        repository: 'sdkwork-ai/agent-studio',
        releaseAssetsDir,
      }),
      /Container deployment smoke report is missing a passing manage-credentials check/,
    );

    writeFileSync(
      path.join(containerDir, 'release-smoke-report.json'),
      `${JSON.stringify(buildDeploymentSmokeReport({
        family: 'container',
        manifestPath: containerManifestPath,
        artifactRelativePaths: [containerArchiveRelativePath],
      }), null, 2)}\n`,
      'utf8',
    );
    writeFileSync(
      path.join(kubernetesDir, 'release-smoke-report.json'),
      `${JSON.stringify(buildDeploymentSmokeReport({
        family: 'kubernetes',
        manifestPath: kubernetesManifestPath,
        artifactRelativePaths: [kubernetesArchiveRelativePath],
        checks: buildDeploymentChecksWithout('kubernetes', 'deployment-identity'),
      }), null, 2)}\n`,
      'utf8',
    );

    assert.throws(
      () => finalizer.finalizeReleaseAssets({
        profileId: 'agent-studio',
        releaseTag: 'release-2026-04-06-06',
        repository: 'sdkwork-ai/agent-studio',
        releaseAssetsDir,
      }),
      /Kubernetes deployment smoke report is missing a passing deployment-identity check/,
    );

    writeFileSync(
      path.join(kubernetesDir, 'release-smoke-report.json'),
      `${JSON.stringify(buildDeploymentSmokeReport({
        family: 'kubernetes',
        manifestPath: kubernetesManifestPath,
        artifactRelativePaths: [kubernetesArchiveRelativePath],
        checks: buildDeploymentChecksWithout('kubernetes', 'configmap-runtime-identity'),
      }), null, 2)}\n`,
      'utf8',
    );

    assert.throws(
      () => finalizer.finalizeReleaseAssets({
        profileId: 'agent-studio',
        releaseTag: 'release-2026-04-06-06',
        repository: 'sdkwork-ai/agent-studio',
        releaseAssetsDir,
      }),
      /Kubernetes deployment smoke report is missing a passing configmap-runtime-identity check/,
    );

    writeFileSync(
      path.join(kubernetesDir, 'release-smoke-report.json'),
      `${JSON.stringify(buildDeploymentSmokeReport({
        family: 'kubernetes',
        manifestPath: kubernetesManifestPath,
        artifactRelativePaths: [kubernetesArchiveRelativePath],
        checks: buildDeploymentChecksWithout('kubernetes', 'persistent-storage'),
      }), null, 2)}\n`,
      'utf8',
    );

    assert.throws(
      () => finalizer.finalizeReleaseAssets({
        profileId: 'agent-studio',
        releaseTag: 'release-2026-04-06-06',
        repository: 'sdkwork-ai/agent-studio',
        releaseAssetsDir,
      }),
      /Kubernetes deployment smoke report is missing a passing persistent-storage check/,
    );
  } finally {
    rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('release asset finalizer rejects deployment smoke reports with unsafe launcher paths', async () => {
  const finalizerPath = path.join(rootDir, 'scripts', 'release', 'finalize-release-assets.mjs');
  const finalizer = await import(pathToFileURL(finalizerPath).href);

  const tempRoot = mkdtempSync(path.join(os.tmpdir(), 'claw-release-finalize-deployment-launcher-path-'));
  const releaseAssetsDir = path.join(tempRoot, 'release-assets');
  const containerDir = path.join(releaseAssetsDir, 'container', 'linux', 'x64', 'cpu');
  const containerArchiveRelativePath = 'container/linux/x64/cpu/agent-studio-container-bundle-release-2026-04-13-02-linux-x64-cpu.tar.gz';
  const containerManifestPath = path.join(containerDir, 'release-asset-manifest.json');

  try {
    mkdirSync(containerDir, { recursive: true });
    writeFileSync(path.join(releaseAssetsDir, containerArchiveRelativePath), 'container-archive', 'utf8');
    writeFileSync(
      containerManifestPath,
      `${JSON.stringify({
        profileId: 'agent-studio',
        releaseTag: 'release-2026-04-13-02',
        platform: 'linux',
        arch: 'x64',
        artifacts: [
          {
            name: path.basename(containerArchiveRelativePath),
            relativePath: containerArchiveRelativePath,
            family: 'container',
            platform: 'linux',
            arch: 'x64',
            accelerator: 'cpu',
            kind: 'archive',
            sha256: 'placeholder',
            size: 17,
          },
        ],
      }, null, 2)}\n`,
      'utf8',
    );
    writeFileSync(
      path.join(containerDir, 'release-smoke-report.json'),
      `${JSON.stringify(buildDeploymentSmokeReport({
        family: 'container',
        manifestPath: containerManifestPath,
        artifactRelativePaths: [containerArchiveRelativePath],
        launcherRelativePath: '../docker-compose.yml',
      }), null, 2)}\n`,
      'utf8',
    );

    assert.throws(
      () => finalizer.finalizeReleaseAssets({
        profileId: 'agent-studio',
        releaseTag: 'release-2026-04-13-02',
        repository: 'sdkwork-ai/agent-studio',
        releaseAssetsDir,
        allowPartialRelease: true,
      }),
      /unsafe launcher path/,
    );
  } finally {
    rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('release asset finalizer rejects partial manifests from another active release profile', async () => {
  const finalizerPath = path.join(rootDir, 'scripts', 'release', 'finalize-release-assets.mjs');
  const finalizer = await import(pathToFileURL(finalizerPath).href);

  const tempRoot = mkdtempSync(path.join(os.tmpdir(), 'claw-release-finalize-profile-mismatch-'));
  const releaseAssetsDir = path.join(tempRoot, 'release-assets');
  const webDir = path.join(releaseAssetsDir, 'web');
  const releaseTag = 'release-2026-04-12-profile';
  const webArchiveRelativePath = `web/agent-studio-web-assets-${releaseTag}.tar.gz`;
  const manifestPath = path.join(webDir, 'release-asset-manifest.json');

  try {
    mkdirSync(webDir, { recursive: true });
    writeFileSync(path.join(releaseAssetsDir, webArchiveRelativePath), 'web-assets', 'utf8');
    writeFileSync(
      manifestPath,
      `${JSON.stringify({
        profileId: 'another-product',
        releaseTag,
        platform: 'web',
        arch: 'any',
        artifacts: [
          {
            name: path.basename(webArchiveRelativePath),
            relativePath: webArchiveRelativePath,
            family: 'web',
            platform: 'web',
            arch: 'any',
            kind: 'archive',
            sha256: 'placeholder',
            size: 10,
          },
        ],
      }, null, 2)}\n`,
      'utf8',
    );
    writeFileSync(
      path.join(webDir, 'release-smoke-report.json'),
      `${JSON.stringify(buildWebSmokeReport({
        manifestPath,
        artifactRelativePaths: [webArchiveRelativePath],
      }), null, 2)}\n`,
      'utf8',
    );

    assert.throws(
      () => finalizer.finalizeReleaseAssets({
        profileId: 'agent-studio',
        releaseTag,
        repository: 'sdkwork-ai/agent-studio',
        releaseAssetsDir,
        allowPartialRelease: true,
      }),
      /Partial release asset manifest profile mismatch/,
    );
  } finally {
    rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('release asset finalizer rejects non-canonical artifact paths before writing the final manifest', async () => {
  const finalizerPath = path.join(rootDir, 'scripts', 'release', 'finalize-release-assets.mjs');
  const finalizer = await import(pathToFileURL(finalizerPath).href);

  const tempRoot = mkdtempSync(path.join(os.tmpdir(), 'claw-release-finalize-unsafe-path-'));
  const releaseAssetsDir = path.join(tempRoot, 'release-assets');
  const webDir = path.join(releaseAssetsDir, 'web');
  const releaseTag = 'release-2026-04-12-path';
  const webArchiveRelativePath = `web/agent-studio-web-assets-${releaseTag}.tar.gz`;
  const nonCanonicalArtifactRelativePath = `./${webArchiveRelativePath}`;
  const manifestPath = path.join(webDir, 'release-asset-manifest.json');

  try {
    mkdirSync(webDir, { recursive: true });
    writeFileSync(path.join(releaseAssetsDir, webArchiveRelativePath), 'web-assets', 'utf8');
    writeFileSync(
      manifestPath,
      `${JSON.stringify({
        profileId: 'agent-studio',
        releaseTag,
        platform: 'web',
        arch: 'any',
        artifacts: [
          {
            name: path.basename(webArchiveRelativePath),
            relativePath: nonCanonicalArtifactRelativePath,
            family: 'web',
            platform: 'web',
            arch: 'any',
            kind: 'archive',
            sha256: 'placeholder',
            size: 10,
          },
        ],
      }, null, 2)}\n`,
      'utf8',
    );
    writeFileSync(
      path.join(webDir, 'release-smoke-report.json'),
      `${JSON.stringify(buildWebSmokeReport({
        manifestPath,
        artifactRelativePaths: [nonCanonicalArtifactRelativePath],
      }), null, 2)}\n`,
      'utf8',
    );

    assert.throws(
      () => finalizer.finalizeReleaseAssets({
        profileId: 'agent-studio',
        releaseTag,
        repository: 'sdkwork-ai/agent-studio',
        releaseAssetsDir,
        allowPartialRelease: true,
      }),
      /non-canonical release artifact path/,
    );
  } finally {
    rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('release asset finalizer rejects duplicate artifacts for the same release target', async () => {
  const finalizerPath = path.join(rootDir, 'scripts', 'release', 'finalize-release-assets.mjs');
  const finalizer = await import(pathToFileURL(finalizerPath).href);

  const tempRoot = mkdtempSync(path.join(os.tmpdir(), 'claw-release-finalize-duplicate-target-'));
  const releaseAssetsDir = path.join(tempRoot, 'release-assets');
  const primaryWebDir = path.join(releaseAssetsDir, 'web');
  const secondaryWebDir = path.join(releaseAssetsDir, 'web', 'secondary');
  const releaseTag = 'release-2026-04-12-duplicate';
  const firstWebArchiveRelativePath = `web/agent-studio-web-assets-${releaseTag}-a.tar.gz`;
  const secondWebArchiveRelativePath = `web/secondary/agent-studio-web-assets-${releaseTag}-b.tar.gz`;
  const firstManifestPath = path.join(primaryWebDir, 'release-asset-manifest.json');
  const secondManifestPath = path.join(secondaryWebDir, 'release-asset-manifest.json');

  try {
    mkdirSync(primaryWebDir, { recursive: true });
    mkdirSync(secondaryWebDir, { recursive: true });
    writeFileSync(path.join(releaseAssetsDir, firstWebArchiveRelativePath), 'web-assets-a', 'utf8');
    writeFileSync(path.join(releaseAssetsDir, secondWebArchiveRelativePath), 'web-assets-b', 'utf8');
    writeFileSync(
      firstManifestPath,
      `${JSON.stringify({
        profileId: 'agent-studio',
        releaseTag,
        platform: 'web',
        arch: 'any',
        artifacts: [
          {
            name: path.basename(firstWebArchiveRelativePath),
            relativePath: firstWebArchiveRelativePath,
            family: 'web',
            platform: 'web',
            arch: 'any',
            kind: 'archive',
            sha256: 'placeholder',
            size: 12,
          },
        ],
      }, null, 2)}\n`,
      'utf8',
    );
    writeFileSync(
      secondManifestPath,
      `${JSON.stringify({
        profileId: 'agent-studio',
        releaseTag,
        platform: 'web',
        arch: 'any',
        artifacts: [
          {
            name: path.basename(secondWebArchiveRelativePath),
            relativePath: secondWebArchiveRelativePath,
            family: 'web',
            platform: 'web',
            arch: 'any',
            kind: 'archive',
            sha256: 'placeholder',
            size: 12,
          },
        ],
      }, null, 2)}\n`,
      'utf8',
    );
    writeFileSync(
      path.join(primaryWebDir, 'release-smoke-report.json'),
      `${JSON.stringify(buildWebSmokeReport({
        manifestPath: firstManifestPath,
        artifactRelativePaths: [firstWebArchiveRelativePath],
      }), null, 2)}\n`,
      'utf8',
    );
    writeFileSync(
      path.join(secondaryWebDir, 'release-smoke-report.json'),
      `${JSON.stringify(buildWebSmokeReport({
        manifestPath: secondManifestPath,
        artifactRelativePaths: [secondWebArchiveRelativePath],
      }), null, 2)}\n`,
      'utf8',
    );

    assert.throws(
      () => finalizer.finalizeReleaseAssets({
        profileId: 'agent-studio',
        releaseTag,
        repository: 'sdkwork-ai/agent-studio',
        releaseAssetsDir,
        allowPartialRelease: true,
      }),
      /multiple artifacts for the same release target/,
    );
  } finally {
    rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('release asset finalizer hashes artifacts in fixed-size chunks', () => {
  const finalizerSource = readFileSync(
    path.join(rootDir, 'scripts', 'release', 'finalize-release-assets.mjs'),
    'utf8',
  );

  assert.match(
    finalizerSource,
    /function computeSha256\(filePath\)[\s\S]*openSync[\s\S]*readSync[\s\S]*closeSync/,
    'release finalization must hash large artifacts with bounded memory usage',
  );
  assert.doesNotMatch(
    finalizerSource,
    /createHash\('sha256'\)\.update\(readFileSync\(filePath\)\)/,
    'release finalization must not read whole release artifacts into memory for hashing',
  );
});
