// WORKSPACE-PATH:allow-fixture: fixtures name a foreign checkout root, drive, or home directory to exercise path handling, so the literal is the value under assertion rather than a binding this build resolves
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { pathToFileURL } from 'node:url';

import { DEFAULT_OPENCLAW_VERSION } from '../openclaw-release.mjs';

const rootDir = path.resolve(import.meta.dirname, '..', '..');
const BUILT_IN_INSTANCE_ID = 'managed-openclaw-primary';

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

function writeDesktopManifest({
  releaseAssetsDir,
  platform,
  arch,
  artifacts,
  packageProfileId = 'openclaw-only',
  includedKernelIds = ['openclaw'],
  defaultEnabledKernelIds = ['openclaw'],
} = {}) {
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
    releaseTag: 'release-2026-04-06-08',
    packageProfileId,
    includedKernelIds,
    defaultEnabledKernelIds,
    platform,
    arch,
    artifacts,
  });

  return manifestPath;
}

function buildDesktopStartupEvidence({
  status = 'passed',
  phase = 'shell-mounted',
  ready = true,
  gatewayWebsocketDialable = true,
  packageProfileId = 'openclaw-only',
  includedKernelIds = ['openclaw'],
  defaultEnabledKernelIds = ['openclaw'],
  builtInInstanceId = BUILT_IN_INSTANCE_ID,
  builtInInstanceStatus = 'online',
  openClawConfigHealth = {
    status: 'ready',
    valid: true,
    runtimeMetadataAvailable: true,
    configReadable: true,
    supportedChannelIds: ['qqbot', 'feishu', 'imessage', 'irc', 'matrix', 'mattermost', 'signal', 'slack', 'telegram'],
    configuredChannelIds: ['telegram'],
    unknownChannelIds: [],
    malformedChannelIds: [],
    modelByChannelIds: ['telegram'],
    unknownModelByChannelIds: [],
    invalidModelByChannelIds: [],
  },
  localAiProxy = {
    lifecycle: 'running',
    messageCaptureEnabled: true,
    observabilityDbPath: 'C:/Users/test/AppData/Roaming/Agent Studio/store/local-ai-proxy-observability.sqlite3',
    snapshotPath: 'C:/Users/test/AppData/Roaming/Agent Studio/state/local-ai-proxy.snapshot.json',
    logPath: 'C:/Users/test/AppData/Roaming/Agent Studio/logs/local-ai-proxy.log',
  },
} = {}) {
  return {
    version: 1,
    status,
    phase,
    runId: 2,
    durationMs: 1842,
    recordedAt: '2026-04-06T12:13:14.000Z',
    app: {
      name: 'Agent Studio',
      version: '0.1.0',
      tauriVersion: '2.0.0',
    },
    bundledComponents: {
      packageProfileId,
      includedKernelIds,
      defaultEnabledKernelIds,
      componentCount: 1,
      defaultStartupComponentIds: ['desktop-host'],
      autoUpgradeEnabled: true,
      approvalMode: 'strict',
      components: [],
    },
    paths: {
      dataDir: 'C:/Users/test/AppData/Roaming/Agent Studio',
      logsDir: 'C:/Users/test/AppData/Roaming/Agent Studio/logs',
      machineLogsDir: 'C:/Users/test/AppData/Roaming/Agent Studio/logs/machine',
      mainLogFile: 'C:/Users/test/AppData/Roaming/Agent Studio/logs/main.log',
    },
    descriptor: {
      mode: 'desktopCombined',
      lifecycle: 'ready',
      apiBasePath: '/claw/api/v1',
      manageBasePath: '/claw/manage/v1',
      internalBasePath: '/claw/internal/v1',
      browserBaseUrl: 'http://127.0.0.1:19797',
      lastError: null,
      endpointId: 'desktop-managed-endpoint',
      requestedPort: 19797,
      activePort: 19797,
      loopbackOnly: true,
      dynamicPort: false,
      stateStoreDriver: 'sqlite',
      stateStoreProfileId: 'desktop-managed',
      runtimeDataDir: 'C:/runtime',
      webDistDir: 'C:/web',
    },
    hostPlatformStatus: {
      lifecycle: 'ready',
      mode: 'desktopCombined',
      supportedCapabilityKeys: ['manage.openclaw.gateway.invoke'],
      availableCapabilityKeys: ['manage.openclaw.gateway.invoke'],
    },
    hostEndpoints: [
      {
        endpointId: 'desktop-managed-endpoint',
        requestedPort: 19797,
        activePort: 19797,
        baseUrl: 'http://127.0.0.1:19797',
      },
    ],
    openClawRuntime: {
      lifecycle: 'ready',
      endpointId: 'desktop-managed-endpoint',
      activePort: 19797,
      baseUrl: 'http://127.0.0.1:19797',
      websocketUrl: 'ws://127.0.0.1:19797/openclaw/ws',
    },
    openClawGateway: {
      lifecycle: 'ready',
      endpointId: 'desktop-managed-endpoint',
      activePort: 19797,
      baseUrl: 'http://127.0.0.1:19797',
      websocketUrl: 'ws://127.0.0.1:19797/openclaw/ws',
    },
    builtInInstance: {
      id: builtInInstanceId,
      name: 'OpenClaw',
      version: DEFAULT_OPENCLAW_VERSION,
      runtimeKind: 'openclaw',
      deploymentMode: 'local-managed',
      transportKind: 'openclawGatewayWs',
      status: builtInInstanceStatus,
      baseUrl: 'http://127.0.0.1:19797',
      websocketUrl: 'ws://127.0.0.1:19797/openclaw/ws',
      isBuiltIn: true,
      isDefault: true,
    },
    openClawConfigHealth,
    readinessEvidence: {
      hostLifecycleReady: true,
      gatewayInvokeCapabilityAvailable: true,
      manageEndpointPublished: true,
      manageEndpointMatchesDescriptor: true,
      openClawRuntimeReady: true,
      openClawGatewayReady: true,
      runtimeAndGatewayBaseUrlMatch: true,
      runtimeAndGatewayWebsocketUrlMatch: true,
      builtInInstanceOnline: builtInInstanceStatus === 'online',
      builtInInstanceReady: builtInInstanceStatus === 'online',
      gatewayWebsocketProbeSupported: true,
      gatewayWebsocketDialable,
      ready,
    },
    localAiProxy,
    error: null,
  };
}

test('desktop startup smoke validates captured startup evidence and writes a structured smoke report', async () => {
  const smokePath = path.join(rootDir, 'scripts', 'release', 'smoke-desktop-startup-evidence.mjs');
  const smoke = await import(pathToFileURL(smokePath).href);

  assert.equal(typeof smoke.smokeDesktopStartupEvidence, 'function');
  assert.equal(typeof smoke.resolveDesktopStartupSmokeReportPath, 'function');
  assert.equal(typeof smoke.resolveCapturedDesktopStartupEvidencePath, 'function');

  const tempRoot = mkdtempSync(path.join(os.tmpdir(), 'claw-smoke-desktop-startup-'));
  const releaseAssetsDir = path.join(tempRoot, 'release-assets');
  const artifactRelativePath = 'desktop/windows/x64/nsis/Agent Studio_0.1.0_x64-setup.exe';

  try {
    writeArtifactFile(releaseAssetsDir, artifactRelativePath);
    const manifestPath = writeDesktopManifest({
      releaseAssetsDir,
      platform: 'windows',
      arch: 'x64',
      artifacts: [
        {
          name: 'Agent Studio_0.1.0_x64-setup.exe',
          relativePath: artifactRelativePath,
          family: 'desktop',
          platform: 'windows',
          arch: 'x64',
          kind: 'installer',
          sha256: 'synthetic',
          size: 17,
        },
      ],
    });
    const evidencePath = smoke.resolveCapturedDesktopStartupEvidencePath({
      releaseAssetsDir,
      platform: 'windows',
      arch: 'x64',
    });
    writeJsonFile(evidencePath, buildDesktopStartupEvidence());

    const result = await smoke.smokeDesktopStartupEvidence({
      releaseAssetsDir,
      platform: 'windows',
      arch: 'x64',
    });

    assert.equal(result.manifestPath.replaceAll('\\', '/'), manifestPath.replaceAll('\\', '/'));
    assert.equal(result.evidencePath.replaceAll('\\', '/'), evidencePath.replaceAll('\\', '/'));
    const smokeReportPath = smoke.resolveDesktopStartupSmokeReportPath({
      releaseAssetsDir,
      platform: 'windows',
      arch: 'x64',
    });
    const smokeReport = JSON.parse(readFileSync(smokeReportPath, 'utf8'));
    assert.equal(smokeReport.platform, 'windows');
    assert.equal(smokeReport.arch, 'x64');
    assert.equal(smokeReport.status, 'passed');
    assert.equal(smokeReport.phase, 'shell-mounted');
    assert.equal(smokeReport.packageProfileId, 'openclaw-only');
    assert.deepEqual(smokeReport.includedKernelIds, ['openclaw']);
    assert.deepEqual(smokeReport.defaultEnabledKernelIds, ['openclaw']);
    assert.equal(smokeReport.descriptorBrowserBaseUrl, 'http://127.0.0.1:19797');
    assert.equal(smokeReport.builtInInstanceId, BUILT_IN_INSTANCE_ID);
    assert.equal(smokeReport.builtInInstanceStatus, 'online');
    assert.deepEqual(smokeReport.openClawConfigHealth, {
      status: 'ready',
      valid: true,
      runtimeMetadataAvailable: true,
      configReadable: true,
      supportedChannelIds: ['qqbot', 'feishu', 'imessage', 'irc', 'matrix', 'mattermost', 'signal', 'slack', 'telegram'],
      configuredChannelIds: ['telegram'],
      unknownChannelIds: [],
      malformedChannelIds: [],
      modelByChannelIds: ['telegram'],
      unknownModelByChannelIds: [],
      invalidModelByChannelIds: [],
    });
    assert.deepEqual(
      smokeReport.localAiProxyRuntime,
      {
        lifecycle: 'running',
        messageCaptureEnabled: true,
        observabilityDbPath: 'C:/Users/test/AppData/Roaming/Agent Studio/store/local-ai-proxy-observability.sqlite3',
        snapshotPath: 'C:/Users/test/AppData/Roaming/Agent Studio/state/local-ai-proxy.snapshot.json',
        logPath: 'C:/Users/test/AppData/Roaming/Agent Studio/logs/local-ai-proxy.log',
      },
    );
    assert.equal(
      smokeReport.capturedEvidenceRelativePath,
      'desktop/windows/x64/diagnostics/desktop-startup-evidence.json',
    );
    assert.deepEqual(smokeReport.artifactRelativePaths, [artifactRelativePath]);
    assert.deepEqual(
      smokeReport.checks.map((check) => check.id),
      [
        'startup-status',
        'startup-phase',
        'runtime-readiness',
        'built-in-instance',
        'gateway-websocket',
        'openclaw-config-health',
        'local-ai-proxy-runtime',
      ],
    );
    assert.equal(smokeReport.checks.every((check) => check.status === 'passed'), true);
  } finally {
    rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('desktop startup smoke preserves the canonical managed built-in OpenClaw instance id', async () => {
  const smokePath = path.join(rootDir, 'scripts', 'release', 'smoke-desktop-startup-evidence.mjs');
  const smoke = await import(pathToFileURL(smokePath).href);

  const tempRoot = mkdtempSync(path.join(os.tmpdir(), 'claw-smoke-desktop-startup-managed-id-'));
  const releaseAssetsDir = path.join(tempRoot, 'release-assets');
  const artifactRelativePath = 'desktop/windows/x64/nsis/Agent Studio_0.1.0_x64-setup.exe';

  try {
    writeArtifactFile(releaseAssetsDir, artifactRelativePath);
    writeDesktopManifest({
      releaseAssetsDir,
      platform: 'windows',
      arch: 'x64',
      artifacts: [
        {
          name: 'Agent Studio_0.1.0_x64-setup.exe',
          relativePath: artifactRelativePath,
          family: 'desktop',
          platform: 'windows',
          arch: 'x64',
          kind: 'installer',
          sha256: 'synthetic',
          size: 17,
        },
      ],
    });

    writeJsonFile(
      smoke.resolveCapturedDesktopStartupEvidencePath({
        releaseAssetsDir,
        platform: 'windows',
        arch: 'x64',
      }),
      buildDesktopStartupEvidence({
        builtInInstanceId: BUILT_IN_INSTANCE_ID,
      }),
    );

    const result = await smoke.smokeDesktopStartupEvidence({
      releaseAssetsDir,
      platform: 'windows',
      arch: 'x64',
    });

    assert.equal(result.report.builtInInstanceId, BUILT_IN_INSTANCE_ID);
  } finally {
    rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('desktop startup smoke rejects unsafe artifact paths before writing reports', async () => {
  const smokePath = path.join(rootDir, 'scripts', 'release', 'smoke-desktop-startup-evidence.mjs');
  const smoke = await import(pathToFileURL(smokePath).href);

  const tempRoot = mkdtempSync(path.join(os.tmpdir(), 'claw-smoke-desktop-startup-artifact-path-'));
  const releaseAssetsDir = path.join(tempRoot, 'release-assets');
  const artifactRelativePath = '../desktop/windows/x64/nsis/Agent Studio_0.1.0_x64-setup.exe';

  try {
    const manifestPath = writeDesktopManifest({
      releaseAssetsDir,
      platform: 'windows',
      arch: 'x64',
      artifacts: [
        {
          name: 'Agent Studio_0.1.0_x64-setup.exe',
          relativePath: artifactRelativePath,
          family: 'desktop',
          platform: 'windows',
          arch: 'x64',
          kind: 'installer',
          sha256: 'synthetic',
          size: 17,
        },
      ],
    });
    const evidencePath = smoke.resolveCapturedDesktopStartupEvidencePath({
      releaseAssetsDir,
      platform: 'windows',
      arch: 'x64',
    });
    writeJsonFile(evidencePath, buildDesktopStartupEvidence());

    assert.throws(
      () => smoke.writeDesktopStartupSmokeReport({
        releaseAssetsDir,
        platform: 'windows',
        arch: 'x64',
        target: 'x86_64-pc-windows-msvc',
        manifestPath,
        capturedEvidencePath: evidencePath,
        evidence: buildDesktopStartupEvidence(),
        localAiProxyRuntime: {
          lifecycle: 'running',
          messageCaptureEnabled: true,
          observabilityDbPath: 'C:/Users/test/AppData/Roaming/Agent Studio/store/local-ai-proxy-observability.sqlite3',
          snapshotPath: 'C:/Users/test/AppData/Roaming/Agent Studio/state/local-ai-proxy.snapshot.json',
          logPath: 'C:/Users/test/AppData/Roaming/Agent Studio/logs/local-ai-proxy.log',
        },
        artifactRelativePaths: [artifactRelativePath],
      }),
      /unsafe desktop startup smoke artifact path/,
    );
  } finally {
    rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('desktop startup smoke rejects captured evidence paths outside release assets before writing reports', async () => {
  const smokePath = path.join(rootDir, 'scripts', 'release', 'smoke-desktop-startup-evidence.mjs');
  const smoke = await import(pathToFileURL(smokePath).href);

  const tempRoot = mkdtempSync(path.join(os.tmpdir(), 'claw-smoke-desktop-startup-evidence-path-'));
  const releaseAssetsDir = path.join(tempRoot, 'release-assets');
  const artifactRelativePath = 'desktop/windows/x64/nsis/Agent Studio_0.1.0_x64-setup.exe';
  const outsideEvidencePath = path.join(tempRoot, 'outside-desktop-startup-evidence.json');

  try {
    writeJsonFile(outsideEvidencePath, buildDesktopStartupEvidence());
    const manifestPath = writeDesktopManifest({
      releaseAssetsDir,
      platform: 'windows',
      arch: 'x64',
      artifacts: [
        {
          name: 'Agent Studio_0.1.0_x64-setup.exe',
          relativePath: artifactRelativePath,
          family: 'desktop',
          platform: 'windows',
          arch: 'x64',
          kind: 'installer',
          sha256: 'synthetic',
          size: 17,
        },
      ],
    });

    assert.throws(
      () => smoke.writeDesktopStartupSmokeReport({
        releaseAssetsDir,
        platform: 'windows',
        arch: 'x64',
        target: 'x86_64-pc-windows-msvc',
        manifestPath,
        capturedEvidencePath: outsideEvidencePath,
        evidence: buildDesktopStartupEvidence(),
        localAiProxyRuntime: {
          lifecycle: 'running',
          messageCaptureEnabled: true,
          observabilityDbPath: 'C:/Users/test/AppData/Roaming/Agent Studio/store/local-ai-proxy-observability.sqlite3',
          snapshotPath: 'C:/Users/test/AppData/Roaming/Agent Studio/state/local-ai-proxy.snapshot.json',
          logPath: 'C:/Users/test/AppData/Roaming/Agent Studio/logs/local-ai-proxy.log',
        },
        artifactRelativePaths: [artifactRelativePath],
      }),
      /unsafe desktop startup smoke captured evidence path/,
    );
  } finally {
    rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('desktop startup smoke rejects legacy local-built-in OpenClaw evidence for OpenClaw packages', async () => {
  const smokePath = path.join(rootDir, 'scripts', 'release', 'smoke-desktop-startup-evidence.mjs');
  const smoke = await import(pathToFileURL(smokePath).href);

  const tempRoot = mkdtempSync(path.join(os.tmpdir(), 'claw-smoke-desktop-startup-legacy-id-'));
  const releaseAssetsDir = path.join(tempRoot, 'release-assets');
  const artifactRelativePath = 'desktop/windows/x64/nsis/Agent Studio_0.1.0_x64-setup.exe';

  try {
    writeArtifactFile(releaseAssetsDir, artifactRelativePath);
    writeDesktopManifest({
      releaseAssetsDir,
      platform: 'windows',
      arch: 'x64',
      artifacts: [
        {
          name: 'Agent Studio_0.1.0_x64-setup.exe',
          relativePath: artifactRelativePath,
          family: 'desktop',
          platform: 'windows',
          arch: 'x64',
          kind: 'installer',
          sha256: 'synthetic',
          size: 17,
        },
      ],
    });

    writeJsonFile(
      smoke.resolveCapturedDesktopStartupEvidencePath({
        releaseAssetsDir,
        platform: 'windows',
        arch: 'x64',
      }),
      buildDesktopStartupEvidence({
        builtInInstanceId: 'local-built-in',
      }),
    );

    await assert.rejects(
      () => smoke.smokeDesktopStartupEvidence({
        releaseAssetsDir,
        platform: 'windows',
        arch: 'x64',
      }),
      /canonical managed built-in OpenClaw instance id/i,
    );
  } finally {
    rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('desktop startup smoke rejects OpenClaw packages without channel config sanitation evidence', async () => {
  const smokePath = path.join(rootDir, 'scripts', 'release', 'smoke-desktop-startup-evidence.mjs');
  const smoke = await import(pathToFileURL(smokePath).href);

  const tempRoot = mkdtempSync(path.join(os.tmpdir(), 'claw-smoke-desktop-startup-config-health-missing-'));
  const releaseAssetsDir = path.join(tempRoot, 'release-assets');
  const artifactRelativePath = 'desktop/windows/x64/nsis/Agent Studio_0.1.0_x64-setup.exe';

  try {
    writeArtifactFile(releaseAssetsDir, artifactRelativePath);
    writeDesktopManifest({
      releaseAssetsDir,
      platform: 'windows',
      arch: 'x64',
      artifacts: [
        {
          name: 'Agent Studio_0.1.0_x64-setup.exe',
          relativePath: artifactRelativePath,
          family: 'desktop',
          platform: 'windows',
          arch: 'x64',
          kind: 'installer',
          sha256: 'synthetic',
          size: 17,
        },
      ],
    });

    const evidence = buildDesktopStartupEvidence();
    delete evidence.openClawConfigHealth;
    writeJsonFile(
      smoke.resolveCapturedDesktopStartupEvidencePath({
        releaseAssetsDir,
        platform: 'windows',
        arch: 'x64',
      }),
      evidence,
    );

    await assert.rejects(
      () => smoke.smokeDesktopStartupEvidence({
        releaseAssetsDir,
        platform: 'windows',
        arch: 'x64',
      }),
      /OpenClaw channel config sanitation evidence/i,
    );
  } finally {
    rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('desktop startup smoke rejects OpenClaw packages with stale channel ids in config health evidence', async () => {
  const smokePath = path.join(rootDir, 'scripts', 'release', 'smoke-desktop-startup-evidence.mjs');
  const smoke = await import(pathToFileURL(smokePath).href);

  const tempRoot = mkdtempSync(path.join(os.tmpdir(), 'claw-smoke-desktop-startup-config-health-stale-'));
  const releaseAssetsDir = path.join(tempRoot, 'release-assets');
  const artifactRelativePath = 'desktop/windows/x64/nsis/Agent Studio_0.1.0_x64-setup.exe';

  try {
    writeArtifactFile(releaseAssetsDir, artifactRelativePath);
    writeDesktopManifest({
      releaseAssetsDir,
      platform: 'windows',
      arch: 'x64',
      artifacts: [
        {
          name: 'Agent Studio_0.1.0_x64-setup.exe',
          relativePath: artifactRelativePath,
          family: 'desktop',
          platform: 'windows',
          arch: 'x64',
          kind: 'installer',
          sha256: 'synthetic',
          size: 17,
        },
      ],
    });

    writeJsonFile(
      smoke.resolveCapturedDesktopStartupEvidencePath({
        releaseAssetsDir,
        platform: 'windows',
        arch: 'x64',
      }),
      buildDesktopStartupEvidence({
        openClawConfigHealth: {
          status: 'degraded',
          valid: false,
          runtimeMetadataAvailable: true,
          configReadable: true,
          supportedChannelIds: ['telegram', 'slack'],
          configuredChannelIds: ['telegram', 'qq'],
          unknownChannelIds: ['qq'],
          malformedChannelIds: [],
          modelByChannelIds: [],
          unknownModelByChannelIds: [],
          invalidModelByChannelIds: [],
        },
      }),
    );

    await assert.rejects(
      () => smoke.smokeDesktopStartupEvidence({
        releaseAssetsDir,
        platform: 'windows',
        arch: 'x64',
      }),
      /unsupported configured OpenClaw channel ids|unknown OpenClaw channel ids/i,
    );
  } finally {
    rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('desktop startup smoke rejects OpenClaw packages whose supported channel evidence includes retired channel ids', async () => {
  const smokePath = path.join(rootDir, 'scripts', 'release', 'smoke-desktop-startup-evidence.mjs');
  const smoke = await import(pathToFileURL(smokePath).href);

  const tempRoot = mkdtempSync(path.join(os.tmpdir(), 'claw-smoke-desktop-startup-config-health-supported-stale-'));
  const releaseAssetsDir = path.join(tempRoot, 'release-assets');
  const artifactRelativePath = 'desktop/windows/x64/nsis/Agent Studio_0.1.0_x64-setup.exe';

  try {
    writeArtifactFile(releaseAssetsDir, artifactRelativePath);
    writeDesktopManifest({
      releaseAssetsDir,
      platform: 'windows',
      arch: 'x64',
      artifacts: [
        {
          name: 'Agent Studio_0.1.0_x64-setup.exe',
          relativePath: artifactRelativePath,
          family: 'desktop',
          platform: 'windows',
          arch: 'x64',
          kind: 'installer',
          sha256: 'synthetic',
          size: 17,
        },
      ],
    });

    writeJsonFile(
      smoke.resolveCapturedDesktopStartupEvidencePath({
        releaseAssetsDir,
        platform: 'windows',
        arch: 'x64',
      }),
      buildDesktopStartupEvidence({
        openClawConfigHealth: {
          status: 'ready',
          valid: true,
          runtimeMetadataAvailable: true,
          configReadable: true,
          supportedChannelIds: ['telegram', 'qq'],
          configuredChannelIds: ['telegram'],
          unknownChannelIds: [],
          malformedChannelIds: [],
          modelByChannelIds: [],
          unknownModelByChannelIds: [],
          invalidModelByChannelIds: [],
        },
      }),
    );

    await assert.rejects(
      () => smoke.smokeDesktopStartupEvidence({
        releaseAssetsDir,
        platform: 'windows',
        arch: 'x64',
      }),
      /unsupported OpenClaw channel ids in packaged runtime metadata/i,
    );
  } finally {
    rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('desktop startup smoke accepts hermes-only desktop packages without managed built-in OpenClaw evidence', async () => {
  const smokePath = path.join(rootDir, 'scripts', 'release', 'smoke-desktop-startup-evidence.mjs');
  const smoke = await import(pathToFileURL(smokePath).href);

  const tempRoot = mkdtempSync(path.join(os.tmpdir(), 'claw-smoke-desktop-startup-hermes-only-'));
  const releaseAssetsDir = path.join(tempRoot, 'release-assets');
  const artifactRelativePath = 'desktop/windows/x64/nsis/Agent Studio_0.1.0_x64-setup.exe';

  try {
    writeArtifactFile(releaseAssetsDir, artifactRelativePath);
    writeDesktopManifest({
      releaseAssetsDir,
      platform: 'windows',
      arch: 'x64',
      packageProfileId: 'hermes-only',
      includedKernelIds: ['hermes'],
      defaultEnabledKernelIds: ['hermes'],
      artifacts: [
        {
          name: 'Agent Studio_0.1.0_x64-setup.exe',
          relativePath: artifactRelativePath,
          family: 'desktop',
          platform: 'windows',
          arch: 'x64',
          kind: 'installer',
          sha256: 'synthetic',
          size: 17,
        },
      ],
    });

    const evidence = buildDesktopStartupEvidence({
      packageProfileId: 'hermes-only',
      includedKernelIds: ['hermes'],
      defaultEnabledKernelIds: ['hermes'],
      gatewayWebsocketDialable: false,
    });
    evidence.openClawRuntime = null;
    evidence.openClawGateway = null;
    evidence.builtInInstance = null;
    evidence.openClawConfigHealth = null;
    evidence.readinessEvidence.gatewayWebsocketProbeSupported = false;
    evidence.readinessEvidence.gatewayWebsocketDialable = false;

    writeJsonFile(
      smoke.resolveCapturedDesktopStartupEvidencePath({
        releaseAssetsDir,
        platform: 'windows',
        arch: 'x64',
      }),
      evidence,
    );

    const result = await smoke.smokeDesktopStartupEvidence({
      releaseAssetsDir,
      platform: 'windows',
      arch: 'x64',
    });

    assert.equal(result.report.builtInInstanceId, '');
    assert.equal(result.report.builtInInstanceStatus, '');
    assert.equal(result.report.packageProfileId, 'hermes-only');
    assert.deepEqual(result.report.includedKernelIds, ['hermes']);
    assert.deepEqual(result.report.defaultEnabledKernelIds, ['hermes']);
    assert.deepEqual(
      result.report.checks
        .filter((check) => check.id === 'built-in-instance' || check.id === 'gateway-websocket')
        .map((check) => ({ id: check.id, status: check.status, detail: check.detail })),
      [
        {
          id: 'built-in-instance',
          status: 'passed',
          detail: 'desktop startup evidence skipped built-in OpenClaw instance checks because package profile excludes openclaw',
        },
        {
          id: 'gateway-websocket',
          status: 'passed',
          detail: 'desktop startup evidence skipped OpenClaw gateway websocket checks because package profile excludes openclaw',
        },
      ],
    );
  } finally {
    rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('desktop startup smoke rejects captured evidence when bundled package context drifts from the desktop manifest', async () => {
  const smokePath = path.join(rootDir, 'scripts', 'release', 'smoke-desktop-startup-evidence.mjs');
  const smoke = await import(pathToFileURL(smokePath).href);

  const tempRoot = mkdtempSync(path.join(os.tmpdir(), 'claw-smoke-desktop-startup-profile-drift-'));
  const releaseAssetsDir = path.join(tempRoot, 'release-assets');
  const artifactRelativePath = 'desktop/windows/x64/nsis/Agent Studio_0.1.0_x64-setup.exe';

  try {
    writeArtifactFile(releaseAssetsDir, artifactRelativePath);
    writeDesktopManifest({
      releaseAssetsDir,
      platform: 'windows',
      arch: 'x64',
      packageProfileId: 'hermes-only',
      includedKernelIds: ['hermes'],
      defaultEnabledKernelIds: ['hermes'],
      artifacts: [
        {
          name: 'Agent Studio_0.1.0_x64-setup.exe',
          relativePath: artifactRelativePath,
          family: 'desktop',
          platform: 'windows',
          arch: 'x64',
          kind: 'installer',
          sha256: 'synthetic',
          size: 17,
        },
      ],
    });

    writeJsonFile(
      smoke.resolveCapturedDesktopStartupEvidencePath({
        releaseAssetsDir,
        platform: 'windows',
        arch: 'x64',
      }),
      buildDesktopStartupEvidence({
        packageProfileId: 'dual-kernel',
        includedKernelIds: ['openclaw', 'hermes'],
        defaultEnabledKernelIds: ['openclaw', 'hermes'],
      }),
    );

    await assert.rejects(
      () => smoke.smokeDesktopStartupEvidence({
        releaseAssetsDir,
        platform: 'windows',
        arch: 'x64',
      }),
      /package profile|included kernels|default enabled kernels/i,
    );
  } finally {
    rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('desktop startup smoke rejects a missing captured startup evidence file', async () => {
  const smokePath = path.join(rootDir, 'scripts', 'release', 'smoke-desktop-startup-evidence.mjs');
  const smoke = await import(pathToFileURL(smokePath).href);

  const tempRoot = mkdtempSync(path.join(os.tmpdir(), 'claw-smoke-desktop-startup-missing-'));
  const releaseAssetsDir = path.join(tempRoot, 'release-assets');
  const artifactRelativePath = 'desktop/windows/x64/nsis/Agent Studio_0.1.0_x64-setup.exe';

  try {
    writeArtifactFile(releaseAssetsDir, artifactRelativePath);
    writeDesktopManifest({
      releaseAssetsDir,
      platform: 'windows',
      arch: 'x64',
      artifacts: [
        {
          name: 'Agent Studio_0.1.0_x64-setup.exe',
          relativePath: artifactRelativePath,
          family: 'desktop',
          platform: 'windows',
          arch: 'x64',
          kind: 'installer',
          sha256: 'synthetic',
          size: 17,
        },
      ],
    });

    await assert.rejects(
      () => smoke.smokeDesktopStartupEvidence({
        releaseAssetsDir,
        platform: 'windows',
        arch: 'x64',
      }),
      /Missing desktop startup evidence/i,
    );
  } finally {
    rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('desktop startup smoke rejects captured evidence that did not reach the shell-mounted ready phase', async () => {
  const smokePath = path.join(rootDir, 'scripts', 'release', 'smoke-desktop-startup-evidence.mjs');
  const smoke = await import(pathToFileURL(smokePath).href);

  const tempRoot = mkdtempSync(path.join(os.tmpdir(), 'claw-smoke-desktop-startup-phase-'));
  const releaseAssetsDir = path.join(tempRoot, 'release-assets');
  const artifactRelativePath = 'desktop/linux/x64/deb/agent-studio_0.1.0_amd64.deb';

  try {
    writeArtifactFile(releaseAssetsDir, artifactRelativePath);
    writeDesktopManifest({
      releaseAssetsDir,
      platform: 'linux',
      arch: 'x64',
      artifacts: [
        {
          name: 'agent-studio_0.1.0_amd64.deb',
          relativePath: artifactRelativePath,
          family: 'desktop',
          platform: 'linux',
          arch: 'x64',
          kind: 'package',
          sha256: 'synthetic',
          size: 18,
        },
      ],
    });
    writeJsonFile(
      smoke.resolveCapturedDesktopStartupEvidencePath({
        releaseAssetsDir,
        platform: 'linux',
        arch: 'x64',
      }),
      buildDesktopStartupEvidence({
        status: 'failed',
        phase: 'runtime-readiness-failed',
        ready: false,
        gatewayWebsocketDialable: false,
        builtInInstanceStatus: 'starting',
      }),
    );

    await assert.rejects(
      () => smoke.smokeDesktopStartupEvidence({
        releaseAssetsDir,
        platform: 'linux',
        arch: 'x64',
      }),
      /shell-mounted|passed|ready/i,
    );
  } finally {
    rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('desktop startup smoke rejects captured evidence when local ai proxy runtime artifact facts are missing', async () => {
  const smokePath = path.join(rootDir, 'scripts', 'release', 'smoke-desktop-startup-evidence.mjs');
  const smoke = await import(pathToFileURL(smokePath).href);

  const tempRoot = mkdtempSync(path.join(os.tmpdir(), 'claw-smoke-desktop-startup-local-ai-proxy-'));
  const releaseAssetsDir = path.join(tempRoot, 'release-assets');
  const artifactRelativePath = 'desktop/windows/x64/nsis/Agent Studio_0.1.0_x64-setup.exe';

  try {
    writeArtifactFile(releaseAssetsDir, artifactRelativePath);
    writeDesktopManifest({
      releaseAssetsDir,
      platform: 'windows',
      arch: 'x64',
      artifacts: [
        {
          name: 'Agent Studio_0.1.0_x64-setup.exe',
          relativePath: artifactRelativePath,
          family: 'desktop',
          platform: 'windows',
          arch: 'x64',
          kind: 'installer',
          sha256: 'synthetic',
          size: 17,
        },
      ],
    });
    writeJsonFile(
      smoke.resolveCapturedDesktopStartupEvidencePath({
        releaseAssetsDir,
        platform: 'windows',
        arch: 'x64',
      }),
      buildDesktopStartupEvidence({
        localAiProxy: null,
      }),
    );

    await assert.rejects(
      () => smoke.smokeDesktopStartupEvidence({
        releaseAssetsDir,
        platform: 'windows',
        arch: 'x64',
      }),
      /local ai proxy/i,
    );
  } finally {
    rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('desktop startup smoke parses explicit evidence path overrides', async () => {
  const smokePath = path.join(rootDir, 'scripts', 'release', 'smoke-desktop-startup-evidence.mjs');
  const smoke = await import(pathToFileURL(smokePath).href);

  const parsed = smoke.parseArgs([
    '--platform',
    'windows',
    '--arch',
    'x64',
    '--startup-evidence-path',
    'D:/synthetic/desktop-startup-evidence.json',
  ]);

  assert.equal(parsed.platform, 'windows');
  assert.equal(parsed.arch, 'x64');
  assert.equal(
    parsed.startupEvidencePath.replaceAll('\\', '/'),
    'D:/synthetic/desktop-startup-evidence.json',
  );
});

