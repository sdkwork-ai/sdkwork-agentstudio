// WORKSPACE-PATH:allow-fixture: fixtures name a foreign checkout root, drive, or home directory to exercise path handling, so the literal is the value under assertion rather than a binding this build resolves
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import {
  buildDesktopStartupEvidenceDocument,
  DESKTOP_STARTUP_EVIDENCE_RELATIVE_PATH,
  resolvePassingDesktopStartupEvidencePhase,
  sanitizeDesktopStartupDescriptor,
  shouldPersistShellMountedDesktopStartupEvidence,
  serializeDesktopStartupEvidence,
} from './desktopStartupEvidence.ts';

const BUILT_IN_INSTANCE_ID = 'managed-openclaw-primary';
const DEFAULT_BUNDLED_OPENCLAW_VERSION = JSON.parse(
  readFileSync(
    new URL('../../../../../config/kernel-releases/openclaw.json', import.meta.url),
    'utf8',
  ),
).stableVersion;

test('desktop startup evidence sanitizes the embedded host descriptor and excludes the browser session token', () => {
  const descriptor = sanitizeDesktopStartupDescriptor({
    mode: 'desktopCombined',
    lifecycle: 'ready',
    apiBasePath: '/claw/api/v1',
    manageBasePath: '/claw/manage/v1',
    internalBasePath: '/claw/internal/v1',
    browserBaseUrl: 'http://127.0.0.1:21289',
    browserSessionToken: 'secret-session-token',
    lastError: null,
    endpointId: 'desktop-host',
    requestedPort: 21289,
    activePort: 21289,
    loopbackOnly: true,
    dynamicPort: false,
    stateStoreDriver: 'sqlite',
    stateStoreProfileId: 'default-local',
    runtimeDataDir: 'C:/Users/admin/AppData/Claw/data/desktop-host',
    webDistDir: 'C:/Program Files/Agent Studio/resources/web-dist',
  });

  assert.deepEqual(descriptor, {
    mode: 'desktopCombined',
    lifecycle: 'ready',
    apiBasePath: '/claw/api/v1',
    manageBasePath: '/claw/manage/v1',
    internalBasePath: '/claw/internal/v1',
    browserBaseUrl: 'http://127.0.0.1:21289',
    lastError: null,
    endpointId: 'desktop-host',
    requestedPort: 21289,
    activePort: 21289,
    loopbackOnly: true,
    dynamicPort: false,
    stateStoreDriver: 'sqlite',
    stateStoreProfileId: 'default-local',
    runtimeDataDir: 'C:/Users/admin/AppData/Claw/data/desktop-host',
    webDistDir: 'C:/Program Files/Agent Studio/resources/web-dist',
  });
  assert.equal(
    Object.prototype.hasOwnProperty.call(descriptor ?? {}, 'browserSessionToken'),
    false,
  );
});

test('desktop startup evidence resolves the passing phase to shell-mounted once the shell is already mounted', () => {
  assert.equal(resolvePassingDesktopStartupEvidencePhase(false), 'runtime-ready');
  assert.equal(resolvePassingDesktopStartupEvidencePhase(true), 'shell-mounted');
});

test('desktop startup evidence can capture an in-progress bootstrap marker before runtime metadata is available', () => {
  const document = buildDesktopStartupEvidenceDocument({
    status: 'running',
    phase: 'bootstrap-started',
    runId: 3,
    durationMs: 42,
    recordedAt: '2026-04-20T00:00:00.000Z',
  });

  assert.equal(document.status, 'running');
  assert.equal(document.phase, 'bootstrap-started');
  assert.equal(document.app, null);
  assert.equal(document.paths, null);
  assert.equal(document.descriptor, null);
  assert.equal(document.readinessEvidence, null);
  assert.equal(document.error, null);
});

test('desktop startup evidence only persists shell-mounted success once readiness evidence is available', () => {
  assert.equal(
    shouldPersistShellMountedDesktopStartupEvidence({
      runtimeReadinessFailed: false,
      readinessSnapshot: null,
    }),
    false,
  );

  assert.equal(
    shouldPersistShellMountedDesktopStartupEvidence({
      runtimeReadinessFailed: true,
      readinessSnapshot: {
        evidence: {
          ready: true,
        },
      } as never,
    }),
    false,
  );

  assert.equal(
    shouldPersistShellMountedDesktopStartupEvidence({
      runtimeReadinessFailed: false,
      readinessSnapshot: {
        evidence: {
          ready: true,
        },
      } as never,
    }),
    true,
  );
});

test('desktop startup evidence builds a passed launch document with a sanitized built-in instance projection', () => {
  const document = buildDesktopStartupEvidenceDocument({
    status: 'passed',
    phase: 'shell-mounted',
    runId: 7,
    durationMs: 842,
    recordedAt: '2026-04-06T10:00:00.000Z',
    appInfo: {
      name: 'Agent Studio',
      version: '0.1.0',
      target: 'x86_64-pc-windows-msvc',
    },
    bundledComponents: {
      packageProfileId: 'dual-kernel',
      includedKernelIds: ['openclaw', 'hermes'],
      defaultEnabledKernelIds: ['openclaw', 'hermes'],
      componentCount: 2,
      defaultStartupComponentIds: ['desktop-host'],
      autoUpgradeEnabled: true,
      approvalMode: 'strict',
      components: [],
    } as never,
    appPaths: {
      dataDir: 'C:/Users/admin/AppData/Claw/data',
      logsDir: 'C:/Users/admin/AppData/Claw/logs',
      machineLogsDir: 'C:/ProgramData/Claw/logs',
      mainLogFile: 'C:/ProgramData/Claw/logs/app/app.log',
    } as never,
    readinessSnapshot: {
      descriptor: {
        mode: 'desktopCombined',
        lifecycle: 'ready',
        apiBasePath: '/claw/api/v1',
        manageBasePath: '/claw/manage/v1',
        internalBasePath: '/claw/internal/v1',
        browserBaseUrl: 'http://127.0.0.1:21289',
        browserSessionToken: 'secret-session-token',
        endpointId: 'desktop-host',
        requestedPort: 21289,
        activePort: 21289,
        loopbackOnly: true,
        dynamicPort: false,
        stateStoreDriver: 'sqlite',
        stateStoreProfileId: 'default-local',
        runtimeDataDir: 'C:/Users/admin/AppData/Claw/data/desktop-host',
        webDistDir: 'C:/Program Files/Agent Studio/resources/web-dist',
      },
      hostPlatformStatus: {
        mode: 'desktopCombined',
        lifecycle: 'ready',
      },
      hostEndpoints: [
        {
          endpointId: 'desktop-host',
          requestedPort: 21289,
          activePort: 21289,
          baseUrl: 'http://127.0.0.1:21289',
        },
      ],
      openClawRuntime: {
        lifecycle: 'ready',
        endpointId: 'desktop-host',
        activePort: 21289,
        baseUrl: 'http://127.0.0.1:21289',
        websocketUrl: 'ws://127.0.0.1:21289/ws',
      },
      openClawGateway: {
        lifecycle: 'ready',
        endpointId: 'desktop-host',
        activePort: 21289,
        baseUrl: 'http://127.0.0.1:21289',
        websocketUrl: 'ws://127.0.0.1:21289/ws',
      },
      instances: [
        {
          id: BUILT_IN_INSTANCE_ID,
          name: 'Local Built-In',
          version: DEFAULT_BUNDLED_OPENCLAW_VERSION,
          runtimeKind: 'openclaw',
          deploymentMode: 'local-managed',
          transportKind: 'openclawGatewayWs',
          status: 'online',
          baseUrl: 'http://127.0.0.1:21289',
          websocketUrl: 'ws://127.0.0.1:21289/ws',
          isBuiltIn: true,
          isDefault: true,
          config: {
            authToken: 'sensitive-token',
          },
        },
      ],
      evidence: {
        descriptorBrowserBaseUrl: 'http://127.0.0.1:21289',
        descriptorEndpointId: 'desktop-host',
        descriptorActivePort: 21289,
        hostLifecycle: 'ready',
        hostLifecycleReady: true,
        gatewayInvokeCapabilitySupported: true,
        gatewayInvokeCapabilityAvailable: true,
        hostEndpointCount: 1,
        manageEndpointId: 'desktop-host',
        manageEndpointRequestedPort: 21289,
        manageEndpointActivePort: 21289,
        manageBaseUrl: 'http://127.0.0.1:21289',
        manageEndpointPublished: true,
        manageEndpointMatchesDescriptor: true,
        manageEndpointIdMatchesDescriptor: true,
        manageEndpointActivePortMatchesDescriptor: true,
        openClawRuntimeLifecycle: 'ready',
        openClawRuntimeEndpointId: 'desktop-host',
        openClawRuntimeActivePort: 21289,
        openClawRuntimeBaseUrl: 'http://127.0.0.1:21289',
        openClawRuntimeWebsocketUrl: 'ws://127.0.0.1:21289/ws',
        openClawRuntimeReady: true,
        openClawRuntimeUrlsPublished: true,
        openClawGatewayLifecycle: 'ready',
        openClawGatewayEndpointId: 'desktop-host',
        openClawGatewayActivePort: 21289,
        openClawGatewayBaseUrl: 'http://127.0.0.1:21289',
        openClawGatewayWebsocketUrl: 'ws://127.0.0.1:21289/ws',
        openClawGatewayReady: true,
        openClawGatewayUrlsPublished: true,
        runtimeAndGatewayBaseUrlMatch: true,
        runtimeAndGatewayWebsocketUrlMatch: true,
        runtimeAndGatewayEndpointIdMatch: true,
        runtimeAndGatewayActivePortMatch: true,
        gatewayWebsocketReady: true,
        gatewayWebsocketProbeSupported: true,
        gatewayWebsocketDialable: true,
        builtInInstanceId: BUILT_IN_INSTANCE_ID,
        builtInInstanceRuntimeKind: 'openclaw',
        builtInInstanceDeploymentMode: 'local-managed',
        builtInInstanceTransportKind: 'openclawGatewayWs',
        builtInInstanceStatus: 'online',
        builtInInstanceBaseUrl: 'http://127.0.0.1:21289',
        builtInInstanceWebsocketUrl: 'ws://127.0.0.1:21289/ws',
        builtInInstancePublished: true,
        builtInInstanceRuntimeKindMatchesOpenClaw: true,
        builtInInstanceDeploymentModeMatchesLocalManaged: true,
        builtInInstanceTransportKindMatchesOpenClawGateway: true,
        builtInInstanceOnline: true,
        builtInInstanceUrlsPublished: true,
        builtInInstanceBaseUrlMatchesGateway: true,
        builtInInstanceWebsocketUrlMatchesGateway: true,
        builtInInstanceReady: true,
        ready: true,
      },
    } as never,
    localAiProxy: {
      lifecycle: 'running',
      baseUrl: 'http://127.0.0.1:19797/v1',
      rootBaseUrl: 'http://127.0.0.1:19797',
      activePort: 19797,
      messageCaptureEnabled: true,
      observabilityDbPath: 'C:/Users/admin/AppData/Claw/machine/store/local-ai-proxy-observability.sqlite3',
      configPath: 'C:/Users/admin/AppData/Claw/data/local-ai-proxy.config.json',
      snapshotPath: 'C:/Users/admin/AppData/Claw/data/local-ai-proxy.snapshot.json',
      logPath: 'C:/Users/admin/AppData/Claw/logs/local-ai-proxy.log',
      lastError: null,
    } as never,
  });

  assert.equal(document.version, 1);
  assert.equal(document.status, 'passed');
  assert.equal(document.phase, 'shell-mounted');
  assert.equal(document.runId, 7);
  assert.equal(document.durationMs, 842);
  assert.equal(document.bundledComponents?.packageProfileId, 'dual-kernel');
  assert.deepEqual(document.bundledComponents?.includedKernelIds, ['openclaw', 'hermes']);
  assert.deepEqual(document.bundledComponents?.defaultEnabledKernelIds, ['openclaw', 'hermes']);
  assert.equal(document.paths?.dataDir, 'C:/Users/admin/AppData/Claw/data');
  assert.equal(document.descriptor?.browserBaseUrl, 'http://127.0.0.1:21289');
  assert.equal(
    Object.prototype.hasOwnProperty.call(document.descriptor ?? {}, 'browserSessionToken'),
    false,
  );
  assert.equal(document.builtInInstance?.id, BUILT_IN_INSTANCE_ID);
  assert.equal(document.builtInInstance?.status, 'online');
  assert.equal(document.localAiProxy?.lifecycle, 'running');
  assert.equal(document.localAiProxy?.messageCaptureEnabled, true);
  assert.equal(
    document.localAiProxy?.observabilityDbPath,
    'C:/Users/admin/AppData/Claw/machine/store/local-ai-proxy-observability.sqlite3',
  );
  assert.equal(
    document.localAiProxy?.snapshotPath,
    'C:/Users/admin/AppData/Claw/data/local-ai-proxy.snapshot.json',
  );
  assert.equal(
    document.localAiProxy?.logPath,
    'C:/Users/admin/AppData/Claw/logs/local-ai-proxy.log',
  );
  assert.equal(
    Object.prototype.hasOwnProperty.call(document.builtInInstance ?? {}, 'config'),
    false,
  );

  const serialized = serializeDesktopStartupEvidence(document);
  assert.match(serialized, /"phase": "shell-mounted"/);
  assert.match(serialized, /"packageProfileId": "dual-kernel"/);
  assert.match(serialized, /"localAiProxy": \{/);
  assert.match(serialized, /"snapshotPath": "C:\/Users\/admin\/AppData\/Claw\/data\/local-ai-proxy\.snapshot\.json"/);
  assert.doesNotMatch(serialized, /browserSessionToken/);
  assert.doesNotMatch(serialized, /authToken/);
  assert.equal(
    DESKTOP_STARTUP_EVIDENCE_RELATIVE_PATH,
    'diagnostics/desktop-startup-evidence.json',
  );
});

test('desktop startup evidence preserves non-secret OpenClaw channel config health', () => {
  const document = buildDesktopStartupEvidenceDocument({
    status: 'passed',
    phase: 'runtime-ready',
    runId: 10,
    durationMs: 612,
    openClawRuntime: {
      channelConfigHealth: {
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
      configFile: 'C:/Users/admin/.sdkwork/crawstudio/.openclaw/openclaw.json',
    } as never,
  });

  assert.deepEqual(document.openClawConfigHealth, {
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

  const serialized = serializeDesktopStartupEvidence(document);
  assert.match(serialized, /"openClawConfigHealth": \{/);
  assert.doesNotMatch(serialized, /openclaw\.json/);
  assert.doesNotMatch(serialized, /authToken|gatewayAuthToken|browserSessionToken/);
});

test('desktop startup evidence resolves the built-in instance from readiness evidence instead of assuming a legacy built-in id', () => {
  const document = buildDesktopStartupEvidenceDocument({
    status: 'passed',
    phase: 'runtime-ready',
    runId: 8,
    durationMs: 512,
    readinessSnapshot: {
      descriptor: {
        mode: 'desktopCombined',
        lifecycle: 'ready',
        apiBasePath: '/claw/api/v1',
        manageBasePath: '/claw/manage/v1',
        internalBasePath: '/claw/internal/v1',
        browserBaseUrl: 'http://127.0.0.1:21289',
        browserSessionToken: 'secret-session-token',
      },
      hostPlatformStatus: {
        mode: 'desktopCombined',
        lifecycle: 'ready',
      },
      hostEndpoints: [],
      openClawRuntime: null,
      openClawGateway: {
        lifecycle: 'ready',
        endpointId: 'openclaw-gateway',
        activePort: 18871,
        baseUrl: 'http://127.0.0.1:18871',
        websocketUrl: 'ws://127.0.0.1:18871',
      },
      instances: [
        {
          id: BUILT_IN_INSTANCE_ID,
          name: 'Built-In OpenClaw Primary',
          version: DEFAULT_BUNDLED_OPENCLAW_VERSION,
          runtimeKind: 'openclaw',
          deploymentMode: 'local-managed',
          transportKind: 'openclawGatewayWs',
          status: 'online',
          baseUrl: 'http://127.0.0.1:18871',
          websocketUrl: 'ws://127.0.0.1:18871',
          isBuiltIn: true,
          isDefault: true,
          config: {
            authToken: 'sensitive-token',
          },
        },
      ],
      evidence: {
        builtInInstanceId: BUILT_IN_INSTANCE_ID,
      },
    } as never,
  });

  assert.equal(document.builtInInstance?.id, BUILT_IN_INSTANCE_ID);
  assert.equal(document.builtInInstance?.runtimeKind, 'openclaw');
});

test('desktop startup evidence preserves bundled package context for hermes-only packages even when openclaw diagnostics are absent', () => {
  const document = buildDesktopStartupEvidenceDocument({
    status: 'passed',
    phase: 'runtime-ready',
    runId: 9,
    durationMs: 420,
    bundledComponents: {
      packageProfileId: 'hermes-only',
      includedKernelIds: ['hermes'],
      defaultEnabledKernelIds: ['hermes'],
      componentCount: 1,
      defaultStartupComponentIds: ['desktop-host'],
      autoUpgradeEnabled: true,
      approvalMode: 'strict',
      components: [],
    } as never,
    readinessSnapshot: {
      descriptor: {
        mode: 'desktopCombined',
        lifecycle: 'ready',
        apiBasePath: '/claw/api/v1',
        manageBasePath: '/claw/manage/v1',
        internalBasePath: '/claw/internal/v1',
        browserBaseUrl: 'http://127.0.0.1:21289',
        browserSessionToken: 'secret-session-token',
      },
      hostPlatformStatus: {
        mode: 'desktopCombined',
        lifecycle: 'ready',
      },
      hostEndpoints: [],
      openClawRuntime: null,
      openClawGateway: null,
      instances: [],
      evidence: {
        ready: true,
      },
    } as never,
  });

  assert.equal(document.bundledComponents?.packageProfileId, 'hermes-only');
  assert.deepEqual(document.bundledComponents?.includedKernelIds, ['hermes']);
  assert.deepEqual(document.bundledComponents?.defaultEnabledKernelIds, ['hermes']);
  assert.equal(document.openClawRuntime, null);
  assert.equal(document.openClawGateway, null);
  assert.equal(document.builtInInstance, null);
});

test('desktop startup evidence builds a failed launch document with summarized error cause', () => {
  const error = new Error('gateway websocket did not become dialable');
  error.cause = new Error('socket timeout');

  const document = buildDesktopStartupEvidenceDocument({
    status: 'failed',
    phase: 'runtime-readiness-failed',
    runId: 4,
    durationMs: 1234,
    recordedAt: '2026-04-06T10:05:00.000Z',
    error,
  });

  assert.deepEqual(document.error, {
    message: 'gateway websocket did not become dialable',
    cause: 'socket timeout',
  });
  assert.equal(document.descriptor, null);
  assert.equal(document.builtInInstance, null);
});
