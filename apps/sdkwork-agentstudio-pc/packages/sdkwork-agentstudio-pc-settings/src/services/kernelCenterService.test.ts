// WORKSPACE-PATH:allow-fixture: fixtures name a foreign checkout root, drive, or home directory to exercise path handling, so the literal is the value under assertion rather than a binding this build resolves
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import type { RuntimeDesktopKernelInfo } from '@sdkwork/agentstudio-pc-infrastructure';
import {
  DEFAULT_BUNDLED_OPENCLAW_VERSION,
  DEFAULT_REQUIRED_OPENCLAW_NODE_VERSION,
} from '@sdkwork/agentstudio-pc-types';

const DEFAULT_RUNTIME_VERSION = DEFAULT_BUNDLED_OPENCLAW_VERSION;
const DEFAULT_NODE_VERSION = DEFAULT_REQUIRED_OPENCLAW_NODE_VERSION;
const DEFAULT_BUNDLED_OPENCLAW_NODE_VERSION = DEFAULT_NODE_VERSION;
const FUTURE_KERNEL_RUNTIME_VERSION = shiftOpenClawVersion(DEFAULT_BUNDLED_OPENCLAW_VERSION, 1);
const LOCAL_AI_PROXY_ROOT_BASE_URL = 'http://localhost:21280';
const LOCAL_AI_PROXY_BASE_URL = `${LOCAL_AI_PROXY_ROOT_BASE_URL}/v1`;
const BUILT_IN_INSTANCE_ID = 'managed-openclaw-primary';

function shiftOpenClawVersion(version: string, patchOffset: number) {
  const match = /^(\d+)\.(\d+)\.(\d+)(?:-(?:\d+|[0-9A-Za-z]+(?:\.[0-9A-Za-z]+)*))?$/u.exec(version);
  assert.ok(match, `Expected numeric OpenClaw test version, received ${version}`);
  const [, year, month, patch] = match;
  const shiftedPatch = Number(patch) + patchOffset;
  assert.ok(shiftedPatch >= 0, `Cannot derive OpenClaw test version before patch 0 from ${version}`);
  return `${year}.${month}.${shiftedPatch}`;
}

async function runTest(name: string, callback: () => Promise<void> | void) {
  try {
    await callback();
    console.log(`ok - ${name}`);
  } catch (error) {
    console.error(`not ok - ${name}`);
    throw error;
  }
}

async function readKernelCenterServiceSource() {
  return readFile(new URL('./kernelCenterService.ts', import.meta.url), 'utf8');
}

function createSnapshot(overrides: Record<string, unknown> = {}) {
  const raw = {
    topology: {
      kind: 'localManagedNative',
      state: 'installed',
      label: 'Built-In Native Runtime',
      recommended: true,
    },
    runtime: {
      state: 'running',
      health: 'healthy',
      reason: 'Kernel attached to a healthy packaged OpenClaw install.',
      startedBy: 'appSupervisor',
      lastTransitionAt: 1_743_100_000_000,
    },
    endpoint: {
      preferredPort: 21280,
      activePort: 18845,
      baseUrl: 'http://127.0.0.1:18845',
      websocketUrl: 'ws://127.0.0.1:18845',
      loopbackOnly: true,
      dynamicPort: true,
      endpointSource: 'allocated',
    },
    host: {
      serviceManager: 'windowsService',
      ownership: 'appSupervisor',
      serviceName: 'agentstudioOpenClawKernel',
      serviceConfigPath: 'C:/ProgramData/SdkWork/agentstudio/kernel/windows-service.json',
      startupMode: 'auto',
      attachSupported: true,
      repairSupported: true,
      controlSocket: {
        socketKind: 'namedPipe',
        location: '\\\\.\\pipe\\agent-studio-openclaw',
        available: false,
      },
    },
    provenance: {
      runtimeId: 'openclaw',
      installKey: `${DEFAULT_RUNTIME_VERSION}-windows-x64`,
      runtimeVersion: DEFAULT_RUNTIME_VERSION,
      nodeVersion: DEFAULT_NODE_VERSION,
      platform: 'windows',
      arch: 'x64',
      installSource: 'bundled',
      configFile: 'C:/Users/admin/.openclaw/openclaw.json',
      runtimeHomeDir: 'C:/Users/admin',
      runtimeInstallDir:
        `C:/Program Files/SdkWork/CrawStudio/runtimes/openclaw/${DEFAULT_RUNTIME_VERSION}-windows-x64`,
    },
  };

  return {
    raw,
    topologyKind: raw.topology.kind,
    topologyState: raw.topology.state,
    runtimeState: raw.runtime.state,
    runtimeHealth: raw.runtime.health,
    runtimeId: raw.provenance.runtimeId,
    hostManager: raw.host.serviceManager,
    controlMode: 'supervisedFallback',
    baseUrl: raw.endpoint.baseUrl,
    websocketUrl: raw.endpoint.websocketUrl,
    preferredPort: raw.endpoint.preferredPort,
    activePort: raw.endpoint.activePort,
    usesDynamicPort: raw.endpoint.dynamicPort,
    serviceConfigPath: raw.host.serviceConfigPath,
    runtimeVersion: raw.provenance.runtimeVersion,
    nodeVersion: raw.provenance.nodeVersion,
    ...overrides,
  };
}

function createKernelInfo(overrides: Record<string, unknown> = {}) {
  const snapshot = createSnapshot();

  return {
    capabilities: [
      { key: 'doctor', status: 'ready', detail: 'Health diagnostics are available.' },
      { key: 'upgrades', status: 'planned', detail: 'Slot-based upgrades will be exposed next.' },
    ],
    storage: {
      activeProfileId: 'default-sqlite',
      rootDir: 'C:/Users/admin/.sdkwork/crawstudio/storage',
      providers: [],
      profiles: [
        {
          id: 'default-sqlite',
          label: 'SQLite Profile',
          provider: 'sqlite',
          active: true,
          availability: 'ready',
          namespace: 'agent-studio',
          readOnly: false,
          path: 'C:/Users/admin/.sdkwork/crawstudio/storage/default.db',
          connectionConfigured: false,
          databaseConfigured: true,
          endpointConfigured: false,
        },
      ],
    },
    localAiProxy: {
      lifecycle: 'running',
      baseUrl: LOCAL_AI_PROXY_BASE_URL,
      rootBaseUrl: LOCAL_AI_PROXY_ROOT_BASE_URL,
      openaiCompatibleBaseUrl: LOCAL_AI_PROXY_BASE_URL,
      anthropicBaseUrl: LOCAL_AI_PROXY_BASE_URL,
      geminiBaseUrl: LOCAL_AI_PROXY_ROOT_BASE_URL,
      activePort: 21280,
      loopbackOnly: true,
      defaultRouteName: 'SDKWork Default',
      defaultRoutes: [
        {
          clientProtocol: 'openai-compatible',
          id: 'local-ai-proxy-system-default-openai-compatible',
          name: 'SDKWork Default',
          managedBy: 'system-default',
          upstreamProtocol: 'sdkwork',
          upstreamBaseUrl: 'https://ai.sdkwork.com',
          modelCount: 3,
        },
      ],
      upstreamBaseUrl: 'https://ai.sdkwork.com',
      modelCount: 3,
      routeMetrics: [],
      routeTests: [],
      messageCaptureEnabled: false,
      observabilityDbPath: null,
      configFile: 'C:/ProgramData/SdkWork/agentstudio/state/local-ai-proxy.json',
      snapshotPath: 'C:/ProgramData/SdkWork/agentstudio/runtime/state/local-ai-proxy.snapshot.json',
      logPath: 'C:/ProgramData/SdkWork/agentstudio/logs/app/local-ai-proxy.log',
      lastError: null,
    },
    host: snapshot.raw,
    ...overrides,
  };
}

function createHostPlatformStatus(overrides: Record<string, unknown> = {}) {
  return {
    mode: 'desktopCombined',
    lifecycle: 'ready',
    hostId: 'desktop-combined',
    displayName: 'Desktop Combined Host',
    version: '0.1.0',
    desiredStateProjectionVersion: 'phase1',
    rolloutEngineVersion: 'phase1',
    manageBasePath: '/claw/manage/v1',
    internalBasePath: '/claw/internal/v1',
    capabilityKeys: ['nodeSessions', 'rollouts'],
    capabilityCount: 2,
    isReady: true,
    ...overrides,
  };
}

function createRolloutListResult(overrides: Record<string, unknown> = {}) {
  return {
    items: [
      {
        id: 'desktop-bootstrap',
        phase: 'ready',
        attempt: 1,
        targetCount: 1,
        updatedAt: 1_743_100_200_000,
      },
      {
        id: 'remote-repair',
        phase: 'failed',
        attempt: 2,
        targetCount: 2,
        updatedAt: 1_743_100_300_000,
      },
    ],
    total: 2,
    ...overrides,
  };
}

function createRuntimeInfo(overrides: Record<string, unknown> = {}) {
  return {
    platform: 'desktop',
    startup: {
      hostMode: 'desktopCombined',
      distributionFamily: 'desktop',
      deploymentFamily: 'bareMetal',
      acceleratorProfile: null,
      browserBaseUrl: 'http://127.0.0.1:18797',
      hostEndpointId: 'claw-manage-http',
      hostRequestedPort: 18797,
      hostActivePort: 18797,
      hostLoopbackOnly: true,
      hostDynamicPort: false,
      stateStoreDriver: 'sqlite',
      stateStoreProfileId: 'default-sqlite',
      runtimeDataDir: 'C:/Users/admin/.sdkwork/crawstudio',
      webDistDir: 'C:/Program Files/Agent Studio/resources/web-dist',
    },
    ...overrides,
  };
}

let kernelCenterServiceModule:
  | typeof import('./kernelCenterService.ts')
  | undefined;

try {
  kernelCenterServiceModule = await import('./kernelCenterService.ts');
} catch {
  kernelCenterServiceModule = undefined;
}

if (kernelCenterServiceModule) {
  await runTest(
    'kernelCenterService composes the shared dashboard model with runtimeVersion provenance',
    async () => {
      const { createKernelCenterService } = kernelCenterServiceModule;

      const service = createKernelCenterService({
        kernelPlatformService: {
          getInfo: async () => createKernelInfo(),
          getStatus: async () => createSnapshot(),
          ensureRunning: async () => createSnapshot(),
          restart: async () => createSnapshot(),
        },
        hostPlatformService: {
          getStatus: async () => createHostPlatformStatus(),
        },
        hostRuntimeModeService: {
          getSummary: async () => ({
            mode: 'desktopCombined',
            modeLabel: 'Desktop Combined',
            lifecycle: 'ready',
            lifecycleLabel: 'Ready',
            browserManagementSupported: true,
            browserManagementAvailable: true,
            browserManagementLabel: 'Embedded Browser Management',
            manageBasePath: '/claw/manage/v1',
            internalBasePath: '/claw/internal/v1',
          }),
        },
        hostPortSettingsService: {
          getSummary: async () => ({
            totalEndpoints: 2,
            readyEndpoints: 2,
            conflictedEndpoints: 1,
            dynamicPortEndpoints: 2,
            browserBaseUrl: 'http://127.0.0.1:18797',
            rows: [
              {
                endpointId: 'openclaw-gateway-http',
                bindHost: '0.0.0.0',
                requestedPort: 18801,
                activePort: 18819,
                portBindingLabel: '18801 -> 18819',
                statusLabel: 'Fallback Active',
                exposureLabel: 'Network',
                conflictSummary: 'Requested port unavailable: EADDRINUSE',
                baseUrl: 'http://0.0.0.0:18819',
                websocketUrl: 'ws://0.0.0.0:18819',
              },
            ],
          }),
        },
        rolloutService: {
          list: async () => createRolloutListResult(),
          summarizePhases: () => ({
            active: 1,
            failed: 1,
            completed: 0,
            paused: 0,
            drafts: 0,
          }),
        },
        runtimeApi: {
          getRuntimeInfo: async () => createRuntimeInfo(),
        },
      });

      const dashboard = await service.getDashboard();

      assert.equal(dashboard.snapshot?.runtimeState, 'running');
      assert.equal(dashboard.statusTone, 'healthy');
      assert.equal(dashboard.host.serviceManagerLabel, 'Windows Service');
      assert.equal(dashboard.host.ownershipLabel, 'App Supervisor Fallback');
      assert.equal(dashboard.endpoint.activePort, 18845);
      assert.equal(dashboard.localAiProxy.baseUrl, LOCAL_AI_PROXY_BASE_URL);
      assert.equal(dashboard.localAiProxy.defaultRouteName, 'SDKWork Default');
      assert.equal(dashboard.storage.activeProfileLabel, 'SQLite Profile');
      assert.deepEqual(dashboard.capabilities.readyKeys, ['doctor']);
      assert.deepEqual(dashboard.capabilities.plannedKeys, ['upgrades']);
      assert.equal(dashboard.provenance.installSource, 'bundled');
      assert.equal(dashboard.provenance.runtimeVersion, DEFAULT_RUNTIME_VERSION);
      assert.equal(dashboard.provenance.nodeVersion, DEFAULT_NODE_VERSION);
      assert.equal(dashboard.hostRuntimeContract.hostMode, 'desktopCombined');
      assert.equal(dashboard.hostRuntimeContract.runtimeDataDir, 'C:/Users/admin/.sdkwork/crawstudio');
      assert.equal(dashboard.hostEndpoints.rows[0]?.portBindingLabel, '18801 -> 18819');
      assert.equal(dashboard.rollouts.latestUpdatedAt, 1_743_100_300_000);
    },
  );

  await runTest(
    'kernelCenterService prefers OpenClaw-specific runtime evidence over stale shared provenance fields',
    async () => {
      const { createKernelCenterService } = kernelCenterServiceModule;

      const snapshot = createSnapshot();
      snapshot.raw.provenance.runtimeVersion = 'stale-runtime';
      snapshot.raw.provenance.nodeVersion = 'stale-node';
      snapshot.raw.provenance.platform = 'stale-platform';
      snapshot.raw.provenance.arch = 'stale-arch';
      snapshot.raw.provenance.configFile = 'C:/stale/openclaw.json';
      snapshot.raw.provenance.runtimeHomeDir = 'C:/stale/home';
      snapshot.raw.provenance.runtimeInstallDir = 'C:/stale/install';
      snapshot.runtimeVersion = 'stale-runtime';
      snapshot.nodeVersion = 'stale-node';

      const info = createKernelInfo({
        openClawRuntime: {
          runtimeId: 'openclaw',
          openclawVersion: DEFAULT_RUNTIME_VERSION,
          nodeVersion: DEFAULT_NODE_VERSION,
          platform: 'windows',
          arch: 'x64',
          installDir:
            `C:/Program Files/SdkWork/CrawStudio/runtimes/openclaw/${DEFAULT_RUNTIME_VERSION}-windows-x64`,
          homeDir: 'C:/Users/admin',
          configFile: 'C:/Users/admin/.openclaw/openclaw.json',
          startupChain: [{ id: 'configureOpenClawGateway', status: 'ready', detail: 'configured' }],
        },
      });

      const service = createKernelCenterService({
        kernelPlatformService: {
          getInfo: async () => info,
          getStatus: async () => snapshot,
          ensureRunning: async () => snapshot,
          restart: async () => snapshot,
        },
        hostPlatformService: {
          getStatus: async () => createHostPlatformStatus(),
        },
        rolloutService: {
          list: async () => createRolloutListResult(),
          summarizePhases: () => ({
            active: 1,
            failed: 1,
            completed: 0,
            paused: 0,
            drafts: 0,
          }),
        },
        runtimeApi: {
          getRuntimeInfo: async () => createRuntimeInfo(),
        },
      });

      const dashboard = await service.getDashboard();

      assert.equal(dashboard.provenance.runtimeVersion, DEFAULT_RUNTIME_VERSION);
      assert.equal(dashboard.provenance.nodeVersion, DEFAULT_NODE_VERSION);
      assert.equal(dashboard.provenance.platformLabel, 'windows/x64');
      assert.equal(dashboard.provenance.configFile, 'C:/Users/admin/.openclaw/openclaw.json');
      assert.equal(dashboard.provenance.runtimeHomeDir, 'C:/Users/admin');
    },
  );

  await runTest(
    'kernelCenterService does not let legacy OpenClaw runtime diagnostics override non-OpenClaw shared provenance',
    async () => {
      const { createKernelCenterService } = kernelCenterServiceModule;

      const snapshot = createSnapshot({
        runtimeId: 'hermes',
        runtimeVersion: FUTURE_KERNEL_RUNTIME_VERSION,
        nodeVersion: null,
      });
      snapshot.raw.provenance.runtimeId = 'hermes';
      snapshot.raw.provenance.runtimeVersion = FUTURE_KERNEL_RUNTIME_VERSION;
      snapshot.raw.provenance.nodeVersion = null;
      snapshot.raw.provenance.platform = 'linux';
      snapshot.raw.provenance.arch = 'x64';
      snapshot.raw.provenance.installSource = 'external';
      snapshot.raw.provenance.configFile = '/srv/hermes/config.yaml';
      snapshot.raw.provenance.runtimeHomeDir = '/srv/hermes';
      snapshot.raw.provenance.runtimeInstallDir = '/opt/hermes';

      const info = createKernelInfo({
        openClawRuntime: {
          runtimeId: 'openclaw',
          openclawVersion: DEFAULT_RUNTIME_VERSION,
          nodeVersion: DEFAULT_NODE_VERSION,
          platform: 'windows',
          arch: 'x64',
          installDir:
            `C:/Program Files/SdkWork/CrawStudio/runtimes/openclaw/${DEFAULT_RUNTIME_VERSION}-windows-x64`,
          homeDir: 'C:/Users/admin',
          configFile: 'C:/Users/admin/.openclaw/openclaw.json',
          startupChain: [{ id: 'configureOpenClawGateway', status: 'ready', detail: 'configured' }],
        },
      });

      const service = createKernelCenterService({
        kernelPlatformService: {
          getInfo: async () => info,
          getStatus: async () => snapshot,
          ensureRunning: async () => snapshot,
          restart: async () => snapshot,
        },
        hostPlatformService: {
          getStatus: async () => createHostPlatformStatus(),
        },
        rolloutService: {
          list: async () => createRolloutListResult(),
          summarizePhases: () => ({
            active: 1,
            failed: 1,
            completed: 0,
            paused: 0,
            drafts: 0,
          }),
        },
        runtimeApi: {
          getRuntimeInfo: async () => createRuntimeInfo(),
        },
      });

      const dashboard = await service.getDashboard();

      assert.equal(dashboard.provenance.installSource, 'external');
      assert.equal(dashboard.provenance.runtimeVersion, FUTURE_KERNEL_RUNTIME_VERSION);
      assert.equal(dashboard.provenance.nodeVersion, null);
      assert.equal(dashboard.provenance.platformLabel, 'linux/x64');
      assert.equal(dashboard.provenance.configFile, '/srv/hermes/config.yaml');
      assert.equal(dashboard.provenance.runtimeHomeDir, '/srv/hermes');
      assert.equal(dashboard.provenance.runtimeInstallDir, '/opt/hermes');
    },
  );

  await runTest(
    'kernelCenterService prefers generic managed runtime authority for non-openclaw active kernels',
    async () => {
      const { createKernelCenterService } = kernelCenterServiceModule;

      const snapshot = createSnapshot({
        runtimeId: 'hermes',
        runtimeVersion: FUTURE_KERNEL_RUNTIME_VERSION,
        nodeVersion: null,
      });
      snapshot.raw.provenance.runtimeId = 'hermes';
      snapshot.raw.provenance.runtimeVersion = FUTURE_KERNEL_RUNTIME_VERSION;
      snapshot.raw.provenance.nodeVersion = null;
      snapshot.raw.provenance.platform = 'linux';
      snapshot.raw.provenance.arch = 'x64';
      snapshot.raw.provenance.installSource = 'external';
      snapshot.raw.provenance.configFile = '/srv/hermes/config.yaml';
      snapshot.raw.provenance.runtimeHomeDir = '/srv/hermes';
      snapshot.raw.provenance.runtimeInstallDir = '/opt/hermes';

      const info = createKernelInfo({
        runtimeAuthorities: [
          {
            runtimeId: 'hermes',
            configFile: '/var/lib/claw/kernels/hermes/config/hermes.json',
            ownedRuntimeRoots: ['/opt/hermes', '/srv/hermes/runtime'],
            readinessProbe: {
              supportsLoopbackHealthProbe: false,
              healthProbeTimeoutMs: 0,
            },
            runtimeVersion: FUTURE_KERNEL_RUNTIME_VERSION,
            nodeVersion: null,
            platform: 'linux',
            arch: 'x64',
            installSource: 'external',
            runtimeHomeDir: '/srv/hermes',
            runtimeInstallDir: '/opt/hermes',
          },
        ],
        openClawRuntime: {
          runtimeId: 'openclaw',
          openclawVersion: DEFAULT_RUNTIME_VERSION,
          nodeVersion: DEFAULT_NODE_VERSION,
          platform: 'windows',
          arch: 'x64',
          installDir:
            `C:/Program Files/SdkWork/CrawStudio/runtimes/openclaw/${DEFAULT_RUNTIME_VERSION}-windows-x64`,
          homeDir: 'C:/Users/admin',
          configFile: 'C:/Users/admin/.openclaw/openclaw.json',
          authority: {
            configFile:
              'C:/Users/admin/.openclaw/openclaw.json',
            ownedRuntimeRoots: [
              'C:/Program Files/SdkWork/CrawStudio/runtimes/openclaw',
            ],
            readinessProbe: {
              supportsLoopbackHealthProbe: true,
              healthProbeTimeoutMs: 750,
            },
          },
          startupChain: [{ id: 'configureOpenClawGateway', status: 'ready', detail: 'configured' }],
        },
      });

      const service = createKernelCenterService({
        kernelPlatformService: {
          getInfo: async () => info,
          getStatus: async () => snapshot,
          ensureRunning: async () => snapshot,
          restart: async () => snapshot,
        },
        hostPlatformService: {
          getStatus: async () => createHostPlatformStatus(),
        },
        rolloutService: {
          list: async () => createRolloutListResult(),
          summarizePhases: () => ({
            active: 1,
            failed: 1,
            completed: 0,
            paused: 0,
            drafts: 0,
          }),
        },
        runtimeApi: {
          getRuntimeInfo: async () => createRuntimeInfo(),
        },
      });

      const dashboard = await service.getDashboard();

      assert.equal(
        dashboard.runtimeAuthority.configFile,
        '/var/lib/claw/kernels/hermes/config/hermes.json',
      );
      assert.deepEqual(dashboard.runtimeAuthority.ownedRuntimeRoots, ['/opt/hermes', '/srv/hermes/runtime']);
      assert.equal(dashboard.runtimeAuthority.supportsLoopbackHealthProbe, false);
      assert.equal(dashboard.runtimeAuthority.healthProbeTimeoutMs, 0);
      assert.equal(dashboard.provenance.installSource, 'external');
      assert.equal(dashboard.provenance.runtimeVersion, FUTURE_KERNEL_RUNTIME_VERSION);
      assert.equal(dashboard.provenance.nodeVersion, null);
      assert.equal(dashboard.provenance.platformLabel, 'linux/x64');
      assert.equal(dashboard.provenance.configFile, '/srv/hermes/config.yaml');
      assert.equal(dashboard.provenance.runtimeHomeDir, '/srv/hermes');
      assert.equal(dashboard.provenance.runtimeInstallDir, '/opt/hermes');
    },
  );

  await runTest(
    'kernelCenterService consumes generic activeRuntime authority when dedicated runtime-specific payloads are absent',
    async () => {
      const { createKernelCenterService } = kernelCenterServiceModule;

      const snapshot = createSnapshot({
        runtimeId: 'hermes',
        runtimeVersion: FUTURE_KERNEL_RUNTIME_VERSION,
        nodeVersion: null,
      });
      snapshot.raw.provenance.runtimeId = 'hermes';
      snapshot.raw.provenance.runtimeVersion = FUTURE_KERNEL_RUNTIME_VERSION;
      snapshot.raw.provenance.nodeVersion = null;
      snapshot.raw.provenance.platform = 'linux';
      snapshot.raw.provenance.arch = 'x64';
      snapshot.raw.provenance.installSource = 'external';
      snapshot.raw.provenance.configFile = '/srv/hermes/config.yaml';
      snapshot.raw.provenance.runtimeHomeDir = '/srv/hermes';
      snapshot.raw.provenance.runtimeInstallDir = '/opt/hermes';

      const info = createKernelInfo({
        runtimeAuthorities: [],
        openClawRuntime: null,
        activeRuntime: {
          runtimeId: 'hermes',
          state: 'running',
          health: 'healthy',
          reason: 'Kernel attached to a healthy hermes host.',
          installKey: null,
          installSource: 'external',
          runtimeVersion: FUTURE_KERNEL_RUNTIME_VERSION,
          nodeVersion: null,
          platform: 'linux',
          arch: 'x64',
          configFile: '/srv/hermes/config.yaml',
          runtimeHomeDir: '/srv/hermes',
          runtimeInstallDir: '/opt/hermes',
          authority: {
            runtimeId: 'hermes',
            configFile: '/var/lib/claw/kernels/hermes/config/hermes.json',
            ownedRuntimeRoots: ['/opt/hermes', '/srv/hermes/runtime'],
            readinessProbe: {
              supportsLoopbackHealthProbe: false,
              healthProbeTimeoutMs: 0,
            },
            runtimeVersion: FUTURE_KERNEL_RUNTIME_VERSION,
            nodeVersion: null,
            platform: 'linux',
            arch: 'x64',
            installSource: 'external',
            runtimeHomeDir: '/srv/hermes',
            runtimeInstallDir: '/opt/hermes',
          },
        },
      });

      const service = createKernelCenterService({
        kernelPlatformService: {
          getInfo: async () => info,
          getStatus: async () => snapshot,
          ensureRunning: async () => snapshot,
          restart: async () => snapshot,
        },
        hostPlatformService: {
          getStatus: async () => createHostPlatformStatus(),
        },
        rolloutService: {
          list: async () => createRolloutListResult(),
          summarizePhases: () => ({
            active: 1,
            failed: 1,
            completed: 0,
            paused: 0,
            drafts: 0,
          }),
        },
        runtimeApi: {
          getRuntimeInfo: async () => createRuntimeInfo(),
        },
      });

      const dashboard = await service.getDashboard();

      assert.equal(
        dashboard.runtimeAuthority.configFile,
        '/var/lib/claw/kernels/hermes/config/hermes.json',
      );
      assert.deepEqual(dashboard.runtimeAuthority.ownedRuntimeRoots, ['/opt/hermes', '/srv/hermes/runtime']);
      assert.equal(dashboard.runtimeAuthority.supportsLoopbackHealthProbe, false);
      assert.equal(dashboard.runtimeAuthority.healthProbeTimeoutMs, 0);
      assert.equal(dashboard.provenance.installSource, 'external');
      assert.equal(dashboard.provenance.runtimeVersion, FUTURE_KERNEL_RUNTIME_VERSION);
      assert.equal(dashboard.provenance.nodeVersion, null);
      assert.equal(dashboard.provenance.platformLabel, 'linux/x64');
      assert.equal(dashboard.provenance.configFile, '/srv/hermes/config.yaml');
      assert.equal(dashboard.provenance.runtimeHomeDir, '/srv/hermes');
      assert.equal(dashboard.provenance.runtimeInstallDir, '/opt/hermes');
    },
  );

  await runTest(
    'kernelCenterService degrades gracefully for host runtime and endpoint summaries during control actions',
    async () => {
      const { createKernelCenterService } = kernelCenterServiceModule;

      const calls: string[] = [];
      const service = createKernelCenterService({
        kernelPlatformService: {
          getInfo: async () => createKernelInfo(),
          getStatus: async () => createSnapshot(),
          ensureRunning: async () => {
            calls.push('ensureRunning');
            return createSnapshot({ controlMode: 'nativeService' });
          },
          restart: async () => {
            calls.push('restart');
            return createSnapshot({ runtimeState: 'recovering' });
          },
        },
        hostPlatformService: {
          getStatus: async () => createHostPlatformStatus({ lifecycle: 'degraded', isReady: false }),
        },
        rolloutService: {
          list: async () => createRolloutListResult(),
          summarizePhases: () => ({
            active: 1,
            failed: 1,
            completed: 0,
            paused: 0,
            drafts: 0,
          }),
        },
        runtimeApi: {
          getRuntimeInfo: async () => ({ platform: 'desktop', startup: null }),
        },
      });

      const ensured = await service.ensureRunning();
      const restarted = await service.restart();

      assert.deepEqual(calls, ['ensureRunning', 'restart']);
      assert.equal(ensured.snapshot?.controlMode, 'nativeService');
      assert.equal(restarted.snapshot?.runtimeState, 'recovering');
      assert.equal(ensured.hostPlatform.lifecycleLabel, 'Degraded');
      assert.equal(ensured.hostRuntime.modeLabel, 'Desktop Combined');
      assert.equal(ensured.hostRuntime.lifecycleLabel, 'Degraded');
      assert.equal(ensured.hostRuntime.browserManagementAvailable, false);
      assert.equal(ensured.hostRuntime.browserManagementLabel, 'Host Runtime Available');
      assert.equal(ensured.hostRuntimeContract.hostMode, null);
      assert.equal(ensured.hostRuntimeContract.stateStoreDriver, null);
      assert.equal(ensured.hostRuntimeContract.runtimeDataDir, null);
      assert.equal(ensured.hostEndpoints.totalEndpoints, 0);
      assert.equal(ensured.hostEndpoints.rows.length, 0);
      assert.equal(ensured.hostEndpoints.browserBaseUrl, null);
    },
  );
  await runTest(
    'kernelCenterService forwards local AI proxy observability details into the dashboard',
    async () => {
      const { createKernelCenterService } = kernelCenterServiceModule;

      const info = createKernelInfo();
      info.localAiProxy = {
        ...info.localAiProxy,
        routeMetrics: [
          {
            routeId: 'local-ai-proxy-system-default-openai-compatible',
            clientProtocol: 'openai-compatible',
            upstreamProtocol: 'sdkwork',
            health: 'healthy',
            requestCount: 28,
            successCount: 27,
            failureCount: 1,
            rpm: 3.5,
            totalTokens: 9800,
            inputTokens: 6400,
            outputTokens: 3100,
            cacheTokens: 300,
            averageLatencyMs: 220,
            lastLatencyMs: 180,
            lastUsedAt: 1_743_100_400_000,
            lastError: 'upstream timeout',
          },
        ],
        routeTests: [
          {
            routeId: 'local-ai-proxy-system-default-openai-compatible',
            status: 'passed',
            testedAt: 1_743_100_450_000,
            latencyMs: 260,
            checkedCapability: 'chat',
            modelId: 'gpt-4.1-mini',
            error: null,
          },
        ],
        messageCaptureEnabled: true,
        observabilityDbPath:
          'C:/ProgramData/SdkWork/agentstudio/state/local-ai-proxy-observability.sqlite',
      };

      const service = createKernelCenterService({
        kernelPlatformService: {
          getInfo: async () => info,
          getStatus: async () => createSnapshot(),
          ensureRunning: async () => createSnapshot(),
          restart: async () => createSnapshot(),
        },
        hostPlatformService: {
          getStatus: async () => ({
            ...createHostPlatformStatus(),
            capabilityCount: 2,
            isReady: true,
          }),
        },
        rolloutService: {
          list: async () => createRolloutListResult({ items: [], total: 0 }),
          summarizePhases: () => ({
            active: 0,
            failed: 0,
            completed: 0,
            paused: 0,
            drafts: 0,
          }),
        },
        hostRuntimeModeService: {
          getSummary: async () => ({
            mode: 'desktopCombined',
            modeLabel: 'Desktop Combined',
            lifecycle: 'ready',
            lifecycleLabel: 'Ready',
            browserManagementSupported: true,
            browserManagementAvailable: true,
            browserManagementLabel: 'Embedded Browser Management',
            manageBasePath: '/claw/manage/v1',
            internalBasePath: '/claw/internal/v1',
          }),
        },
        hostPortSettingsService: {
          getSummary: async () => ({
            totalEndpoints: 1,
            readyEndpoints: 1,
            conflictedEndpoints: 0,
            dynamicPortEndpoints: 0,
            browserBaseUrl: 'http://127.0.0.1:18797',
            rows: [],
          }),
        },
        runtimeApi: {
          getRuntimeInfo: async () => createRuntimeInfo(),
        },
      });

      const dashboard = await service.getDashboard();

      assert.equal(dashboard.localAiProxy.messageCaptureEnabled, true);
      assert.equal(
        dashboard.localAiProxy.observabilityDbPath,
        'C:/ProgramData/SdkWork/agentstudio/state/local-ai-proxy-observability.sqlite',
      );
      assert.deepEqual(dashboard.localAiProxy.routeMetrics, [
        {
          routeId: 'local-ai-proxy-system-default-openai-compatible',
          clientProtocol: 'openai-compatible',
          upstreamProtocol: 'sdkwork',
          health: 'healthy',
          requestCount: 28,
          successCount: 27,
          failureCount: 1,
          rpm: 3.5,
          totalTokens: 9800,
          inputTokens: 6400,
          outputTokens: 3100,
          cacheTokens: 300,
          averageLatencyMs: 220,
          lastLatencyMs: 180,
          lastUsedAt: 1_743_100_400_000,
          lastError: 'upstream timeout',
        },
      ]);
      assert.deepEqual(dashboard.localAiProxy.routeTests, [
        {
          routeId: 'local-ai-proxy-system-default-openai-compatible',
          status: 'passed',
          testedAt: 1_743_100_450_000,
          latencyMs: 260,
          checkedCapability: 'chat',
          modelId: 'gpt-4.1-mini',
          error: null,
        },
      ]);
    },
  );

  await runTest(
    'kernelCenterService prefers the dedicated OpenClaw runtime snapshot for provenance fields when available',
    async () => {
      const { createKernelCenterService } = kernelCenterServiceModule;

      const snapshot = createSnapshot();
      snapshot.raw.provenance.runtimeVersion = 'stale-runtime';
      snapshot.raw.provenance.nodeVersion = 'stale-node';
      snapshot.raw.provenance.platform = 'stale-platform';
      snapshot.raw.provenance.arch = 'stale-arch';
      snapshot.raw.provenance.configFile = 'C:/stale/openclaw.json';
      snapshot.raw.provenance.runtimeHomeDir = 'C:/stale/home';
      snapshot.raw.provenance.runtimeInstallDir = 'C:/stale/install';
      snapshot.runtimeVersion = 'stale-runtime';
      snapshot.nodeVersion = 'stale-node';

      const kernelInfo = createKernelInfo();
      (kernelInfo as RuntimeDesktopKernelInfo & {
        openClawRuntime?: Record<string, unknown>;
      }).openClawRuntime = {
        runtimeId: 'openclaw',
        lifecycle: 'ready',
        configured: true,
        installKey: `${DEFAULT_BUNDLED_OPENCLAW_VERSION}-windows-x64`,
        openclawVersion: DEFAULT_BUNDLED_OPENCLAW_VERSION,
        nodeVersion: DEFAULT_BUNDLED_OPENCLAW_NODE_VERSION,
        platform: 'windows',
        arch: 'x64',
        installDir:
          `C:/Program Files/SdkWork/CrawStudio/runtimes/openclaw/${DEFAULT_BUNDLED_OPENCLAW_VERSION}-windows-x64`,
        runtimeDir:
          `C:/Program Files/SdkWork/CrawStudio/runtimes/openclaw/${DEFAULT_BUNDLED_OPENCLAW_VERSION}-windows-x64/runtime`,
        homeDir: 'C:/Users/admin',
        workspaceDir: 'C:/Users/admin/.openclaw/workspace',
        configFile: 'C:/Users/admin/.openclaw/openclaw.json',
        gatewayPort: 21280,
        gatewayBaseUrl: 'http://127.0.0.1:21280',
        localAiProxyBaseUrl: LOCAL_AI_PROXY_BASE_URL,
        localAiProxySnapshotPath:
          'C:/ProgramData/SdkWork/agentstudio/state/local-ai-proxy.snapshot.json',
        authority: {
          configFile:
            'C:/Users/admin/.openclaw/openclaw.json',
          ownedRuntimeRoots: [
            'C:/Program Files/SdkWork/CrawStudio/runtimes/openclaw',
            'C:/ProgramData/SdkWork/agentstudio/runtime/runtimes/openclaw',
          ],
          readinessProbe: {
            supportsLoopbackHealthProbe: true,
            healthProbeTimeoutMs: 750,
          },
        },
        providerProjection: {
          providerId: 'sdkwork-local-proxy',
          available: true,
          status: 'ready',
          baseUrl: LOCAL_AI_PROXY_BASE_URL,
          api: 'openai-completions',
          auth: 'api-key',
          defaultModel: 'sdkwork-local-proxy/gpt-5.4',
        },
        startupChain: [
          {
            id: 'configureOpenClawGateway',
            status: 'ready',
            detail: 'configured',
          },
        ],
      };

      const service = createKernelCenterService({
        kernelPlatformService: {
          getInfo: async () => kernelInfo,
          getStatus: async () => snapshot,
          ensureRunning: async () => snapshot,
          restart: async () => snapshot,
        },
        hostPlatformService: {
          getStatus: async () => ({
            ...createHostPlatformStatus(),
            capabilityCount: 2,
            isReady: true,
          }),
        },
        rolloutService: {
          list: async () => createRolloutListResult(),
          summarizePhases: () => ({
            active: 1,
            failed: 1,
            completed: 0,
            paused: 0,
            drafts: 0,
          }),
        },
        runtimeApi: {
          getRuntimeInfo: async () => createRuntimeInfo(),
        },
      });

      const dashboard = await service.getDashboard();

      assert.equal(dashboard.provenance.runtimeVersion, DEFAULT_BUNDLED_OPENCLAW_VERSION);
      assert.equal(dashboard.provenance.nodeVersion, DEFAULT_BUNDLED_OPENCLAW_NODE_VERSION);
      assert.equal(dashboard.provenance.platformLabel, 'windows/x64');
      assert.equal(
        dashboard.provenance.configFile,
        'C:/Users/admin/.openclaw/openclaw.json',
      );
      assert.equal(
        dashboard.provenance.runtimeHomeDir,
        'C:/Users/admin',
      );
      assert.equal(
        dashboard.provenance.runtimeInstallDir,
        `C:/Program Files/SdkWork/CrawStudio/runtimes/openclaw/${DEFAULT_BUNDLED_OPENCLAW_VERSION}-windows-x64`,
      );
    },
  );

  await runTest(
    'kernelCenterService surfaces OpenClaw runtime authority details when the desktop kernel publishes them',
    async () => {
      const { createKernelCenterService } = kernelCenterServiceModule;

      const snapshot = createSnapshot();
      const kernelInfo = createKernelInfo();
      (kernelInfo as RuntimeDesktopKernelInfo & {
        openClawRuntime?: Record<string, unknown>;
      }).openClawRuntime = {
        runtimeId: 'openclaw',
        lifecycle: 'ready',
        configured: true,
        installKey: `${DEFAULT_BUNDLED_OPENCLAW_VERSION}-windows-x64`,
        openclawVersion: DEFAULT_BUNDLED_OPENCLAW_VERSION,
        nodeVersion: DEFAULT_BUNDLED_OPENCLAW_NODE_VERSION,
        platform: 'windows',
        arch: 'x64',
        installDir:
          `C:/Program Files/SdkWork/CrawStudio/runtimes/openclaw/${DEFAULT_BUNDLED_OPENCLAW_VERSION}-windows-x64`,
        runtimeDir:
          `C:/Program Files/SdkWork/CrawStudio/runtimes/openclaw/${DEFAULT_BUNDLED_OPENCLAW_VERSION}-windows-x64/runtime`,
        homeDir: 'C:/Users/admin',
        workspaceDir: 'C:/Users/admin/.openclaw/workspace',
        configFile: 'C:/Users/admin/.openclaw/openclaw.json',
        gatewayPort: 21280,
        gatewayBaseUrl: 'http://127.0.0.1:21280',
        localAiProxyBaseUrl: LOCAL_AI_PROXY_BASE_URL,
        localAiProxySnapshotPath:
          'C:/ProgramData/SdkWork/agentstudio/state/local-ai-proxy.snapshot.json',
        authority: {
          configFile:
            'C:/Users/admin/.openclaw/openclaw.json',
          ownedRuntimeRoots: [
            'C:/Program Files/SdkWork/CrawStudio/runtimes/openclaw',
            'C:/ProgramData/SdkWork/agentstudio/runtime/runtimes/openclaw',
          ],
          readinessProbe: {
            supportsLoopbackHealthProbe: true,
            healthProbeTimeoutMs: 750,
          },
        },
        providerProjection: {
          providerId: 'sdkwork-local-proxy',
          available: true,
          status: 'ready',
          baseUrl: LOCAL_AI_PROXY_BASE_URL,
          api: 'openai-completions',
          auth: 'api-key',
          defaultModel: 'sdkwork-local-proxy/gpt-5.4',
        },
        startupChain: [
          {
            id: 'configureOpenClawGateway',
            status: 'ready',
            detail: 'configured',
          },
        ],
      };

      const service = createKernelCenterService({
        kernelPlatformService: {
          getInfo: async () => kernelInfo,
          getStatus: async () => snapshot,
          ensureRunning: async () => snapshot,
          restart: async () => snapshot,
        },
        hostPlatformService: {
          getStatus: async () => ({
            ...createHostPlatformStatus(),
            capabilityCount: 2,
            isReady: true,
          }),
        },
        rolloutService: {
          list: async () => createRolloutListResult(),
          summarizePhases: () => ({
            active: 1,
            failed: 1,
            completed: 0,
            paused: 0,
            drafts: 0,
          }),
        },
        runtimeApi: {
          getRuntimeInfo: async () => createRuntimeInfo(),
        },
      });

      const dashboard = await service.getDashboard();

      assert.equal(
        dashboard.runtimeAuthority.configFile,
        'C:/Users/admin/.openclaw/openclaw.json',
      );
      assert.deepEqual(dashboard.runtimeAuthority.ownedRuntimeRoots, [
        'C:/Program Files/SdkWork/CrawStudio/runtimes/openclaw',
        'C:/ProgramData/SdkWork/agentstudio/runtime/runtimes/openclaw',
      ]);
      assert.equal(dashboard.runtimeAuthority.supportsLoopbackHealthProbe, true);
      assert.equal(dashboard.runtimeAuthority.healthProbeTimeoutMs, 750);
    },
  );

  await runTest(
    'kernelCenterService surfaces desktop startup evidence from the published kernel snapshot when live runtime reason is unavailable',
    async () => {
      const { createKernelCenterService } = kernelCenterServiceModule;

      const snapshot = createSnapshot();
      snapshot.raw.runtime.reason = '';
      const kernelInfo = createKernelInfo();
      (kernelInfo as RuntimeDesktopKernelInfo & {
        desktopStartupEvidence?: Record<string, unknown>;
      }).desktopStartupEvidence = {
        status: 'passed',
        phase: 'shell-mounted',
        runId: 11,
        recordedAt: '2026-04-08T10:30:00.000Z',
        durationMs: 842,
        evidencePath:
          'C:/Users/admin/.sdkwork/crawstudio/studio/diagnostics/desktop-startup-evidence.json',
        descriptorMode: 'desktopCombined',
        descriptorLifecycle: 'ready',
        descriptorEndpointId: 'desktop-host',
        descriptorActivePort: 18797,
        descriptorRequestedPort: 18797,
        descriptorLoopbackOnly: true,
        descriptorDynamicPort: false,
        descriptorStateStoreDriver: 'sqlite',
        descriptorStateStoreProfileId: 'default-sqlite',
        descriptorBrowserBaseUrl: 'http://127.0.0.1:18797',
        manageBaseUrl: 'http://127.0.0.1:18797',
        builtInInstanceId: BUILT_IN_INSTANCE_ID,
        builtInInstanceName: 'Local Built-In',
        builtInInstanceVersion: DEFAULT_BUNDLED_OPENCLAW_VERSION,
        builtInInstanceRuntimeKind: 'openclaw',
        builtInInstanceDeploymentMode: 'local-managed',
        builtInInstanceTransportKind: 'openclawGatewayWs',
        builtInInstanceBaseUrl: 'http://127.0.0.1:18797',
        builtInInstanceWebsocketUrl: 'ws://127.0.0.1:18797/ws',
        builtInInstanceIsBuiltIn: true,
        builtInInstanceIsDefault: true,
        builtInInstanceStatus: 'online',
        openClawRuntimeLifecycle: 'ready',
        openClawGatewayLifecycle: 'ready',
        ready: true,
        errorMessage: 'gateway websocket did not become dialable',
        errorCause: 'socket timeout',
      };

      const service = createKernelCenterService({
        kernelPlatformService: {
          getInfo: async () => kernelInfo,
          getStatus: async () => snapshot,
          ensureRunning: async () => snapshot,
          restart: async () => snapshot,
        },
        hostPlatformService: {
          getStatus: async () => ({
            ...createHostPlatformStatus(),
            capabilityCount: 2,
            isReady: true,
          }),
        },
        rolloutService: {
          list: async () => createRolloutListResult(),
          summarizePhases: () => ({
            active: 1,
            failed: 1,
            completed: 0,
            paused: 0,
            drafts: 0,
          }),
        },
        runtimeApi: {
          getRuntimeInfo: async () => createRuntimeInfo(),
        },
      });

      const dashboard = await service.getDashboard();

      assert.equal(dashboard.startupEvidence.status, 'passed');
      assert.equal(dashboard.startupEvidence.phase, 'shell-mounted');
      assert.equal(dashboard.startupEvidence.runId, 11);
      assert.equal(
        dashboard.startupEvidence.path,
        'C:/Users/admin/.sdkwork/crawstudio/studio/diagnostics/desktop-startup-evidence.json',
      );
      assert.equal(dashboard.startupEvidence.descriptorMode, 'desktopCombined');
      assert.equal(dashboard.startupEvidence.descriptorLifecycle, 'ready');
      assert.equal(dashboard.startupEvidence.descriptorEndpointId, 'desktop-host');
      assert.equal(dashboard.startupEvidence.descriptorActivePort, 18797);
      assert.equal(dashboard.startupEvidence.descriptorRequestedPort, 18797);
      assert.equal(dashboard.startupEvidence.descriptorLoopbackOnly, true);
      assert.equal(dashboard.startupEvidence.descriptorDynamicPort, false);
      assert.equal(dashboard.startupEvidence.descriptorStateStoreDriver, 'sqlite');
      assert.equal(
        dashboard.startupEvidence.descriptorStateStoreProfileId,
        'default-sqlite',
      );
      assert.equal(dashboard.startupEvidence.manageBaseUrl, 'http://127.0.0.1:18797');
      assert.equal(dashboard.startupEvidence.builtInInstanceId, BUILT_IN_INSTANCE_ID);
      assert.equal(dashboard.startupEvidence.builtInInstanceName, 'Local Built-In');
      assert.equal(
        dashboard.startupEvidence.builtInInstanceVersion,
        DEFAULT_BUNDLED_OPENCLAW_VERSION,
      );
      assert.equal(
        dashboard.startupEvidence.builtInInstanceRuntimeKind,
        'openclaw',
      );
      assert.equal(
        dashboard.startupEvidence.builtInInstanceDeploymentMode,
        'local-managed',
      );
      assert.equal(
        dashboard.startupEvidence.builtInInstanceTransportKind,
        'openclawGatewayWs',
      );
      assert.equal(
        dashboard.startupEvidence.builtInInstanceBaseUrl,
        'http://127.0.0.1:18797',
      );
      assert.equal(
        dashboard.startupEvidence.builtInInstanceWebsocketUrl,
        'ws://127.0.0.1:18797/ws',
      );
      assert.equal(dashboard.startupEvidence.builtInInstanceIsBuiltIn, true);
      assert.equal(dashboard.startupEvidence.builtInInstanceIsDefault, true);
      assert.equal(dashboard.startupEvidence.runtimeLifecycle, 'ready');
      assert.equal(dashboard.startupEvidence.gatewayLifecycle, 'ready');
      assert.equal(dashboard.startupEvidence.ready, true);
      assert.equal(dashboard.startupEvidence.errorCause, 'socket timeout');
      assert.match(dashboard.statusSummary, /gateway websocket did not become dialable/);
    },
  );
  await runTest(
    'kernelCenterService still surfaces ensureRunning failures instead of hiding them behind info fallbacks',
    async () => {
      const { createKernelCenterService } = kernelCenterServiceModule;

      const service = createKernelCenterService({
        kernelPlatformService: {
          getInfo: async () => createKernelInfo(),
          getStatus: async () => createSnapshot(),
          ensureRunning: async () => {
            throw new Error('kernel ensure timeout');
          },
          restart: async () => createSnapshot(),
        },
        hostPlatformService: {
          getStatus: async () => ({
            ...createHostPlatformStatus(),
            capabilityCount: 2,
            isReady: true,
          }),
        },
        rolloutService: {
          list: async () => createRolloutListResult({ items: [], total: 0 }),
          summarizePhases: () => ({
            active: 0,
            failed: 0,
            completed: 0,
            paused: 0,
            drafts: 0,
          }),
        },
        runtimeApi: {
          getRuntimeInfo: async () => createRuntimeInfo({ startup: null }),
        },
      });

      await assert.rejects(
        () => service.ensureRunning(),
        /Failed to load kernel status: kernel ensure timeout/,
      );
    },
  );

  await runTest(
    'kernelCenterService rejects ensureRunning when the platform bridge returns no runtime snapshot',
    async () => {
      const { createKernelCenterService } = kernelCenterServiceModule;

      const service = createKernelCenterService({
        kernelPlatformService: {
          getInfo: async () => createKernelInfo(),
          getStatus: async () => createSnapshot(),
          ensureRunning: async () => null,
          restart: async () => createSnapshot(),
        },
        hostPlatformService: {
          getStatus: async () => ({
            ...createHostPlatformStatus(),
            capabilityCount: 2,
            isReady: true,
          }),
        },
        rolloutService: {
          list: async () => createRolloutListResult({ items: [], total: 0 }),
          summarizePhases: () => ({
            active: 0,
            failed: 0,
            completed: 0,
            paused: 0,
            drafts: 0,
          }),
        },
        runtimeApi: {
          getRuntimeInfo: async () => createRuntimeInfo({ startup: null }),
        },
      });

      await assert.rejects(
        () => service.ensureRunning(),
        /Failed to load kernel status: kernel action did not return a runtime snapshot/,
      );
    },
  );

  await runTest(
    'kernelCenterService rejects restart when the platform bridge returns no runtime snapshot',
    async () => {
      const { createKernelCenterService } = kernelCenterServiceModule;

      const service = createKernelCenterService({
        kernelPlatformService: {
          getInfo: async () => createKernelInfo(),
          getStatus: async () => createSnapshot(),
          ensureRunning: async () => createSnapshot(),
          restart: async () => null,
        },
        hostPlatformService: {
          getStatus: async () => ({
            ...createHostPlatformStatus(),
            capabilityCount: 2,
            isReady: true,
          }),
        },
        rolloutService: {
          list: async () => createRolloutListResult({ items: [], total: 0 }),
          summarizePhases: () => ({
            active: 0,
            failed: 0,
            completed: 0,
            paused: 0,
            drafts: 0,
          }),
        },
        runtimeApi: {
          getRuntimeInfo: async () => createRuntimeInfo({ startup: null }),
        },
      });

      await assert.rejects(
        () => service.restart(),
        /Failed to load kernel status: kernel action did not return a runtime snapshot/,
      );
    },
  );

  await runTest(
    'kernelCenterService still builds the dashboard when host platform status is temporarily unavailable',
    async () => {
      const { createKernelCenterService } = kernelCenterServiceModule;

      const service = createKernelCenterService({
        kernelPlatformService: {
          getInfo: async () => createKernelInfo(),
          getStatus: async () => createSnapshot(),
          ensureRunning: async () => createSnapshot(),
          restart: async () => createSnapshot(),
        },
        hostPlatformService: {
          getStatus: async () => {
            throw new Error('host platform timeout');
          },
        },
        rolloutService: {
          list: async () => createRolloutListResult({ items: [], total: 0 }),
          summarizePhases: () => ({
            active: 0,
            failed: 0,
            completed: 0,
            paused: 0,
            drafts: 0,
          }),
        },
        runtimeApi: {
          getRuntimeInfo: async () => createRuntimeInfo({ startup: null }),
        },
      });

      const dashboard = await service.getDashboard();

      assert.equal(dashboard.snapshot?.runtimeState, 'running');
      assert.equal(dashboard.info?.localAiProxy.lifecycle, 'running');
      assert.equal(dashboard.hostPlatform.status, null);
      assert.equal(dashboard.hostPlatform.modeLabel, 'Unknown');
      assert.equal(dashboard.hostPlatform.lifecycleLabel, 'Unavailable');
      assert.equal(dashboard.hostRuntime.mode, 'web');
      assert.equal(dashboard.hostRuntime.lifecycle, 'inactive');
      assert.equal(dashboard.hostRuntime.browserManagementAvailable, false);
      assert.equal(dashboard.hostRuntime.browserManagementLabel, 'Browser Management Unavailable');
      assert.equal(dashboard.hostRuntimeContract.hostMode, null);
    },
  );

  await runTest(
    'kernelCenterService still builds the dashboard when kernel details are temporarily unavailable',
    async () => {
      const { createKernelCenterService } = kernelCenterServiceModule;

      const service = createKernelCenterService({
        kernelPlatformService: {
          getInfo: async () => {
            throw new Error('kernel info timeout');
          },
          getStatus: async () => createSnapshot(),
          ensureRunning: async () => createSnapshot(),
          restart: async () => createSnapshot(),
        },
        hostPlatformService: {
          getStatus: async () => ({
            ...createHostPlatformStatus(),
            capabilityCount: 2,
            isReady: true,
          }),
        },
        rolloutService: {
          list: async () => createRolloutListResult({ items: [], total: 0 }),
          summarizePhases: () => ({
            active: 0,
            failed: 0,
            completed: 0,
            paused: 0,
            drafts: 0,
          }),
        },
        runtimeApi: {
          getRuntimeInfo: async () => createRuntimeInfo({ startup: null }),
        },
      });

      const dashboard = await service.getDashboard();

      assert.equal(dashboard.info, null);
      assert.equal(dashboard.snapshot?.runtimeState, 'running');
      assert.equal(dashboard.host.serviceManagerLabel, 'Windows Service');
      assert.equal(dashboard.endpoint.activePort, 18845);
      assert.equal(dashboard.localAiProxy.lifecycle, 'Unavailable');
      assert.equal(dashboard.storage.profileCount, 0);
      assert.equal(dashboard.provenance.installSource, 'bundled');
    },
  );

  await runTest(
    'kernelCenterService derives a dashboard snapshot from kernel info when kernel status is temporarily unavailable',
    async () => {
      const { createKernelCenterService } = kernelCenterServiceModule;

      const service = createKernelCenterService({
        kernelPlatformService: {
          getInfo: async () => createKernelInfo(),
          getStatus: async () => {
            throw new Error('kernel status timeout');
          },
          ensureRunning: async () => createSnapshot(),
          restart: async () => createSnapshot(),
        },
        hostPlatformService: {
          getStatus: async () => ({
            ...createHostPlatformStatus(),
            capabilityCount: 2,
            isReady: true,
          }),
        },
        rolloutService: {
          list: async () => createRolloutListResult({ items: [], total: 0 }),
          summarizePhases: () => ({
            active: 0,
            failed: 0,
            completed: 0,
            paused: 0,
            drafts: 0,
          }),
        },
        runtimeApi: {
          getRuntimeInfo: async () => createRuntimeInfo({ startup: null }),
        },
      });

      const dashboard = await service.getDashboard();

      assert.equal(dashboard.snapshot?.runtimeState, 'running');
      assert.equal(dashboard.snapshot?.hostManager, 'windowsService');
      assert.equal(dashboard.statusTitle, 'Running');
      assert.equal(dashboard.host.serviceManagerLabel, 'Windows Service');
      assert.equal(dashboard.endpoint.baseUrl, 'http://127.0.0.1:18845');
      assert.equal(dashboard.provenance.installSource, 'bundled');
    },
  );

  await runTest(
    'kernelCenterService still builds the dashboard when rollout status is temporarily unavailable',
    async () => {
      const { createKernelCenterService } = kernelCenterServiceModule;

      const service = createKernelCenterService({
        kernelPlatformService: {
          getInfo: async () => createKernelInfo(),
          getStatus: async () => createSnapshot(),
          ensureRunning: async () => createSnapshot(),
          restart: async () => createSnapshot(),
        },
        hostPlatformService: {
          getStatus: async () => ({
            ...createHostPlatformStatus(),
            capabilityCount: 2,
            isReady: true,
          }),
        },
        rolloutService: {
          list: async () => {
            throw new Error('rollout list timeout');
          },
          summarizePhases: () => ({
            active: 0,
            failed: 0,
            completed: 0,
            paused: 0,
            drafts: 0,
          }),
        },
        runtimeApi: {
          getRuntimeInfo: async () => createRuntimeInfo({ startup: null }),
        },
      });

      const dashboard = await service.getDashboard();

      assert.equal(dashboard.snapshot?.runtimeState, 'running');
      assert.equal(dashboard.rollouts.total, 0);
      assert.deepEqual(dashboard.rollouts.items, []);
      assert.deepEqual(dashboard.rollouts.phaseCounts, {
        active: 0,
        failed: 0,
        completed: 0,
        paused: 0,
        drafts: 0,
      });
      assert.equal(dashboard.rollouts.latestUpdatedAt, null);
    },
  );
  await runTest(
    'kernelCenterService maps a ready local AI proxy lifecycle to a ready dashboard label',
    async () => {
      const { createKernelCenterService } = kernelCenterServiceModule;

      const kernelInfo = createKernelInfo({
        localAiProxy: {
          ...createKernelInfo().localAiProxy,
          lifecycle: 'ready',
        },
      });

      const service = createKernelCenterService({
        kernelPlatformService: {
          getInfo: async () => kernelInfo,
          getStatus: async () => createSnapshot(),
          ensureRunning: async () => createSnapshot(),
          restart: async () => createSnapshot(),
        },
        hostPlatformService: {
          getStatus: async () => ({
            ...createHostPlatformStatus(),
            capabilityCount: 2,
            isReady: true,
          }),
        },
        rolloutService: {
          list: async () => createRolloutListResult({ items: [], total: 0 }),
          summarizePhases: () => ({
            active: 0,
            failed: 0,
            completed: 0,
            paused: 0,
            drafts: 0,
          }),
        },
        runtimeApi: {
          getRuntimeInfo: async () => createRuntimeInfo(),
        },
      });

      const dashboard = await service.getDashboard();

      assert.equal(dashboard.localAiProxy.lifecycle, 'Ready');
    },
  );

  await runTest(
    'kernelCenterService keeps the published host runtime state when dedicated OpenClaw diagnostics report ready but kernel status is unavailable',
    async () => {
      const { createKernelCenterService } = kernelCenterServiceModule;

      const kernelInfo = createKernelInfo();
      (kernelInfo as RuntimeDesktopKernelInfo & {
        openClawRuntime?: Record<string, unknown>;
      }).openClawRuntime = {
        runtimeId: 'openclaw',
        lifecycle: 'ready',
        configured: true,
        installKey: `${DEFAULT_BUNDLED_OPENCLAW_VERSION}-windows-x64`,
        openclawVersion: DEFAULT_BUNDLED_OPENCLAW_VERSION,
        nodeVersion: DEFAULT_BUNDLED_OPENCLAW_NODE_VERSION,
        platform: 'windows',
        arch: 'x64',
        installDir:
          `C:/Program Files/SdkWork/CrawStudio/runtimes/openclaw/${DEFAULT_BUNDLED_OPENCLAW_VERSION}-windows-x64`,
        runtimeDir:
          `C:/Program Files/SdkWork/CrawStudio/runtimes/openclaw/${DEFAULT_BUNDLED_OPENCLAW_VERSION}-windows-x64/runtime`,
        homeDir: 'C:/Users/admin',
        workspaceDir: 'C:/Users/admin/.openclaw/workspace',
        configFile: 'C:/Users/admin/.openclaw/openclaw.json',
        gatewayPort: 21280,
        gatewayBaseUrl: 'http://127.0.0.1:21280',
        localAiProxyBaseUrl: LOCAL_AI_PROXY_BASE_URL,
        localAiProxySnapshotPath:
          'C:/ProgramData/SdkWork/agentstudio/state/local-ai-proxy.snapshot.json',
        authority: {
          configFile:
            'C:/Users/admin/.openclaw/openclaw.json',
          ownedRuntimeRoots: [
            'C:/Program Files/SdkWork/CrawStudio/runtimes/openclaw',
          ],
          readinessProbe: {
            supportsLoopbackHealthProbe: true,
            healthProbeTimeoutMs: 750,
          },
        },
        providerProjection: {
          providerId: 'sdkwork-local-proxy',
          available: true,
          status: 'ready',
          baseUrl: LOCAL_AI_PROXY_BASE_URL,
          api: 'openai-completions',
          auth: 'api-key',
          defaultModel: 'sdkwork-local-proxy/gpt-5.4',
        },
        startupChain: [
          {
            id: 'ensureLocalAiProxyReady',
            status: 'ready',
            detail: 'Local AI proxy is serving OpenClaw traffic.',
          },
        ],
      };

      const service = createKernelCenterService({
        kernelPlatformService: {
          getInfo: async () => kernelInfo,
          getStatus: async () => null,
          ensureRunning: async () => null,
          restart: async () => null,
        },
        hostPlatformService: {
          getStatus: async () => ({
            ...createHostPlatformStatus(),
            capabilityCount: 2,
            isReady: true,
          }),
        },
        rolloutService: {
          list: async () => createRolloutListResult({ items: [], total: 0 }),
          summarizePhases: () => ({
            active: 0,
            failed: 0,
            completed: 0,
            paused: 0,
            drafts: 0,
          }),
        },
        runtimeApi: {
          getRuntimeInfo: async () => createRuntimeInfo(),
        },
      });

      const dashboard = await service.getDashboard();

      assert.equal(dashboard.snapshot, null);
      assert.equal(dashboard.statusTitle, 'Running');
      assert.equal(dashboard.host.serviceManagerLabel, 'Windows Service');
      assert.equal(dashboard.host.ownershipLabel, 'App Supervisor Fallback');
      assert.equal(dashboard.endpoint.activePort, 18845);
      assert.equal(dashboard.provenance.installSource, 'bundled');
    },
  );

  await runTest(
    'kernelCenterService does not let inactive OpenClaw diagnostics override the published host runtime state when kernel status is unavailable',
    async () => {
      const { createKernelCenterService } = kernelCenterServiceModule;

      const kernelInfo = createKernelInfo();
      (kernelInfo as RuntimeDesktopKernelInfo & {
        openClawRuntime?: Record<string, unknown>;
      }).openClawRuntime = {
        runtimeId: 'openclaw',
        lifecycle: 'inactive',
        configured: false,
        platform: 'windows',
        arch: 'x64',
        homeDir: 'C:/Users/admin',
        workspaceDir: 'C:/Users/admin/.openclaw/workspace',
        configFile: 'C:/Users/admin/.openclaw/openclaw.json',
        localAiProxySnapshotPath:
          'C:/ProgramData/SdkWork/agentstudio/state/local-ai-proxy.snapshot.json',
        authority: {
          configFile:
            'C:/Users/admin/.openclaw/openclaw.json',
          ownedRuntimeRoots: [
            'C:/Program Files/SdkWork/CrawStudio/runtimes/openclaw',
          ],
          readinessProbe: {
            supportsLoopbackHealthProbe: true,
            healthProbeTimeoutMs: 750,
          },
        },
        providerProjection: {
          providerId: 'sdkwork-local-proxy',
          available: false,
          status: 'planned',
        },
        startupChain: [
          {
            id: 'configureOpenClawGateway',
            status: 'pending',
            detail: 'Built-in OpenClaw has not been configured yet.',
          },
        ],
      };

      const service = createKernelCenterService({
        kernelPlatformService: {
          getInfo: async () => kernelInfo,
          getStatus: async () => null,
          ensureRunning: async () => null,
          restart: async () => null,
        },
        hostPlatformService: {
          getStatus: async () => ({
            ...createHostPlatformStatus(),
            capabilityCount: 2,
            isReady: true,
          }),
        },
        rolloutService: {
          list: async () => createRolloutListResult({ items: [], total: 0 }),
          summarizePhases: () => ({
            active: 0,
            failed: 0,
            completed: 0,
            paused: 0,
            drafts: 0,
          }),
        },
        runtimeApi: {
          getRuntimeInfo: async () => createRuntimeInfo(),
        },
      });

      const dashboard = await service.getDashboard();

      assert.equal(dashboard.snapshot, null);
      assert.equal(dashboard.statusTitle, 'Running');
    },
  );

  await runTest(
    'kernelCenterService does not let OpenClaw-only diagnostics override a hermes host when kernel status is unavailable',
    async () => {
      const { createKernelCenterService } = kernelCenterServiceModule;

      const kernelInfo = createKernelInfo();
      kernelInfo.host = {
        ...kernelInfo.host,
        runtime: {
          ...kernelInfo.host.runtime,
          state: 'running',
          reason: 'Kernel attached to a healthy hermes host.',
        },
        provenance: {
          ...kernelInfo.host.provenance,
          runtimeId: 'hermes',
          runtimeVersion: FUTURE_KERNEL_RUNTIME_VERSION,
          nodeVersion: null,
          platform: 'linux',
          arch: 'x64',
          installSource: 'external',
          configFile: '/srv/hermes/config.yaml',
          runtimeHomeDir: '/srv/hermes',
          runtimeInstallDir: '/opt/hermes',
        },
      };
      kernelInfo.runtimeAuthorities = [
        {
          runtimeId: 'hermes',
          configFile: '/var/lib/claw/kernels/hermes/config/hermes.json',
          ownedRuntimeRoots: ['/opt/hermes', '/srv/hermes/runtime'],
          readinessProbe: {
            supportsLoopbackHealthProbe: false,
            healthProbeTimeoutMs: 0,
          },
          runtimeVersion: FUTURE_KERNEL_RUNTIME_VERSION,
          nodeVersion: null,
          platform: 'linux',
          arch: 'x64',
          installSource: 'external',
          runtimeHomeDir: '/srv/hermes',
          runtimeInstallDir: '/opt/hermes',
        },
      ];
      (kernelInfo as RuntimeDesktopKernelInfo & {
        openClawRuntime?: Record<string, unknown>;
      }).openClawRuntime = {
        runtimeId: 'openclaw',
        lifecycle: 'stopping',
        configured: true,
        platform: 'windows',
        arch: 'x64',
        homeDir: 'C:/Users/admin',
        workspaceDir: 'C:/Users/admin/.openclaw/workspace',
        configFile: 'C:/Users/admin/.openclaw/openclaw.json',
        localAiProxySnapshotPath:
          'C:/ProgramData/SdkWork/agentstudio/state/local-ai-proxy.snapshot.json',
        authority: {
          configFile:
            'C:/Users/admin/.openclaw/openclaw.json',
          ownedRuntimeRoots: [
            'C:/Program Files/SdkWork/CrawStudio/runtimes/openclaw',
          ],
          readinessProbe: {
            supportsLoopbackHealthProbe: true,
            healthProbeTimeoutMs: 750,
          },
        },
        providerProjection: {
          providerId: 'sdkwork-local-proxy',
          available: true,
          status: 'planned',
        },
        startupChain: [
          {
            id: 'configureOpenClawGateway',
            status: 'pending',
            detail: 'Built-in OpenClaw is stopping.',
          },
        ],
      };

      const service = createKernelCenterService({
        kernelPlatformService: {
          getInfo: async () => kernelInfo,
          getStatus: async () => null,
          ensureRunning: async () => null,
          restart: async () => null,
        },
        hostPlatformService: {
          getStatus: async () => ({
            ...createHostPlatformStatus(),
            capabilityCount: 2,
            isReady: true,
          }),
        },
        rolloutService: {
          list: async () => createRolloutListResult({ items: [], total: 0 }),
          summarizePhases: () => ({
            active: 0,
            failed: 0,
            completed: 0,
            paused: 0,
            drafts: 0,
          }),
        },
        runtimeApi: {
          getRuntimeInfo: async () => createRuntimeInfo(),
        },
      });

      const dashboard = await service.getDashboard();

      assert.equal(dashboard.snapshot, null);
      assert.equal(dashboard.statusTitle, 'Running');
      assert.equal(dashboard.statusSummary, 'Kernel attached to a healthy hermes host.');
      assert.equal(dashboard.provenance.installSource, 'external');
      assert.equal(dashboard.provenance.runtimeVersion, FUTURE_KERNEL_RUNTIME_VERSION);
      assert.equal(dashboard.provenance.nodeVersion, null);
      assert.equal(dashboard.provenance.platformLabel, 'linux/x64');
      assert.equal(dashboard.provenance.configFile, '/srv/hermes/config.yaml');
      assert.equal(dashboard.provenance.runtimeHomeDir, '/srv/hermes');
      assert.equal(dashboard.provenance.runtimeInstallDir, '/opt/hermes');
      assert.equal(
        dashboard.runtimeAuthority.configFile,
        '/var/lib/claw/kernels/hermes/config/hermes.json',
      );
    },
  );
} else {
  await runTest(
    'kernelCenterService source keeps package-root imports and exposes runtimeVersion as shared provenance output',
    async () => {
      const source = await readKernelCenterServiceSource();

      assert.match(source, /from '@sdkwork\/claw-core'/);
      assert.match(source, /from '@sdkwork\/claw-infrastructure'/);
      assert.match(
        source,
        /provenance:\s*{[\s\S]*installSource:\s*string \| null;[\s\S]*platformLabel:\s*string;[\s\S]*runtimeVersion:\s*string \| null;[\s\S]*nodeVersion:\s*string \| null;/,
      );
      assert.doesNotMatch(source, /provenance:\s*{[\s\S]*openclawVersion:\s*string \| null;/);
      assert.doesNotMatch(source, /installSourceLabel:\s*string;/);
    },
  );

  await runTest(
    'kernelCenterService source only bridges OpenClaw-specific runtime data when the shared snapshot still identifies OpenClaw',
    async () => {
      const source = await readKernelCenterServiceSource();

      assert.match(source, /function resolvePreferredOpenClawRuntime\(/);
      assert.match(source, /const activeRuntimeId = snapshot\?\.runtimeId \?\? info\?\.host\?\.provenance\.runtimeId \?\? null;/);
      assert.match(source, /if \(activeRuntimeId\) \{/);
      assert.match(source, /return activeRuntimeId === 'openclaw' \? openClawRuntime : null;/);
      assert.match(source, /const kernelHost = snapshot\?\.raw \?\? info\?\.host \?\? null;/);
      assert.match(source, /const openClawRuntime = resolvePreferredOpenClawRuntime\(snapshot, info\);/);
      assert.match(
        source,
        /runtimeVersion:\s*openClawRuntime\?\.openclawVersion[\s\S]*snapshot\?\.runtimeVersion[\s\S]*kernelHost\?\.provenance\.runtimeVersion[\s\S]*\?\? null/,
      );
      assert.match(
        source,
        /platformLabel:\s*formatPlatformLabel\(\s*openClawRuntime\?\.platform \?\? kernelHost\?\.provenance\.platform,/,
      );
      assert.match(
        source,
        /configFile:\s*openClawRuntime\?\.configFile \?\? kernelHost\?\.provenance\.configFile \?\? null/,
      );
    },
  );

  await runTest(
    'kernelCenterService source preserves host fallback and observability mappings for iterative convergence',
    async () => {
      const source = await readKernelCenterServiceSource();

      assert.match(source, /const EMPTY_HOST_PORT_SETTINGS_SUMMARY/);
      assert.match(source, /function createFallbackHostRuntimeSummary\(/);
      assert.match(source, /routeMetrics:\s*info\?\.localAiProxy\?\.routeMetrics \?\? \[\]/);
      assert.match(source, /routeTests:\s*info\?\.localAiProxy\?\.routeTests \?\? \[\]/);
      assert.match(source, /path:\s*startupEvidence\?\.evidencePath \?\? null/);
      assert.match(source, /errorCause:\s*startupEvidence\?\.errorCause \?\? null/);
    },
  );

  await runTest(
    'kernelCenterService source exposes raw install provenance without embedding install-source copy',
    async () => {
      const source = await readKernelCenterServiceSource();

      assert.match(
        source,
        /installSource:\s*kernelHost\?\.provenance\.installSource \?\? null/,
      );
      assert.doesNotMatch(source, /function formatInstallSource\(/);
      assert.doesNotMatch(source, /case 'bundled':\s*return 'Packaged';/);
      assert.doesNotMatch(source, /case 'bundled':\s*return 'Bundled';/);
    },
  );
}
