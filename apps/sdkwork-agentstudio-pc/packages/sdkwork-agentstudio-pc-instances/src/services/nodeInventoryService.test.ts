// WORKSPACE-PATH:allow-fixture: fixtures name a foreign checkout root, drive, or home directory to exercise path handling, so the literal is the value under assertion rather than a binding this build resolves
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  DEFAULT_BUNDLED_OPENCLAW_VERSION,
  DEFAULT_REQUIRED_OPENCLAW_NODE_VERSION,
  buildBuiltInKernelPrimaryInstanceId,
  STABLE_BUILT_IN_OPENCLAW_INSTANCE_ID,
} from '@sdkwork/agentstudio-pc-types';

const DEFAULT_RUNTIME_VERSION = `v${DEFAULT_BUNDLED_OPENCLAW_VERSION}`;
const DEFAULT_NODE_VERSION = DEFAULT_REQUIRED_OPENCLAW_NODE_VERSION;
const FUTURE_KERNEL_RUNTIME_VERSION = shiftOpenClawVersion(DEFAULT_BUNDLED_OPENCLAW_VERSION, 1);
const BUILT_IN_PHOENIXCLAW_INSTANCE_ID =
  buildBuiltInKernelPrimaryInstanceId('phoenixclaw') ?? 'managed-phoenixclaw-primary';

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

async function readNodeInventoryServiceSource() {
  return readFile(new URL('./nodeInventoryServiceCore.ts', import.meta.url), 'utf8');
}

function createKernelSnapshot(overrides: Record<string, unknown> = {}) {
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
      reason: 'Bundled OpenClaw is healthy.',
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
      controlSocket: null,
    },
    provenance: {
      runtimeId: 'openclaw',
      installKey: `${DEFAULT_RUNTIME_VERSION}-windows-x64`,
      runtimeVersion: DEFAULT_RUNTIME_VERSION,
      nodeVersion: DEFAULT_NODE_VERSION,
      platform: 'windows',
      arch: 'x64',
      installSource: 'bundled',
      configPath: 'C:/Users/admin/.openclaw/openclaw.json',
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

function createInstance(overrides: Record<string, unknown> = {}) {
  return {
    id: STABLE_BUILT_IN_OPENCLAW_INSTANCE_ID,
    name: 'Local Built-In',
    description: 'Packaged local OpenClaw kernel.',
    runtimeKind: 'openclaw',
    deploymentMode: 'local-managed',
    transportKind: 'openclawGatewayWs',
    status: 'online',
    isBuiltIn: true,
    isDefault: true,
    iconType: 'server',
    version: DEFAULT_RUNTIME_VERSION,
    typeLabel: 'OpenClaw Gateway',
    host: '127.0.0.1',
    port: 18845,
    baseUrl: 'http://127.0.0.1:18845',
    websocketUrl: 'ws://127.0.0.1:18845',
    cpu: 0,
    memory: 0,
    totalMemory: 'Unknown',
    uptime: '2h',
    capabilities: ['chat'],
    storage: {
      provider: 'localFile',
      namespace: 'agent-studio',
    },
    config: {
      port: '18845',
      sandbox: true,
      autoUpdate: true,
      logLevel: 'info',
      corsOrigins: 'http://localhost:3001',
      baseUrl: 'http://127.0.0.1:18845',
      websocketUrl: 'ws://127.0.0.1:18845',
    },
    createdAt: 1,
    updatedAt: 1,
    lastSeenAt: 1,
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
    updatedAt: 1_743_100_500_000,
    ...overrides,
  };
}

function createNodeSession(overrides: Record<string, unknown> = {}) {
  return {
    sessionId: `desktop-combined-${STABLE_BUILT_IN_OPENCLAW_INSTANCE_ID}`,
    nodeId: STABLE_BUILT_IN_OPENCLAW_INSTANCE_ID,
    state: 'admitted',
    compatibilityState: 'compatible',
    desiredStateRevision: 6,
    desiredStateHash: 'rev-6',
    lastSeenAt: 1_743_100_501_000,
    ...overrides,
  };
}

let nodeInventoryServiceModule:
  | typeof import('./nodeInventoryServiceCore.ts')
  | undefined;

try {
  nodeInventoryServiceModule = await import('./nodeInventoryServiceCore.ts');
} catch {
  nodeInventoryServiceModule = undefined;
}

if (nodeInventoryServiceModule) {
  await runTest(
    'nodeInventoryService separates the local managed kernel node from attached remote nodes',
    async () => {
      const { createNodeInventoryService } = nodeInventoryServiceModule;

      const service = createNodeInventoryService({
        kernelPlatformService: {
          getStatus: async () => createKernelSnapshot(),
        },
        hostPlatformService: {
          getStatus: async () => createHostPlatformStatus(),
          listNodeSessions: async () => [
            createNodeSession(),
            createNodeSession({
              sessionId: 'remote-attached-session',
              nodeId: 'remote-attached',
              state: 'degraded',
              compatibilityState: 'degraded',
              desiredStateRevision: 3,
              desiredStateHash: 'rev-3',
            }),
          ],
        },
        studioApi: {
          getInstances: async () => [
            createInstance(),
            createInstance({
              id: 'remote-attached',
              name: 'Edge Gateway',
              deploymentMode: 'remote',
              isBuiltIn: false,
              isDefault: false,
              status: 'online',
              host: 'gateway.example.com',
              port: 28789,
              baseUrl: 'https://gateway.example.com',
              websocketUrl: 'wss://gateway.example.com',
            }),
          ],
        },
      });

      const inventory = await service.listNodes();

      assert.deepEqual(inventory.map((node) => node.id), [
        STABLE_BUILT_IN_OPENCLAW_INSTANCE_ID,
        'remote-attached',
      ]);
      assert.equal(inventory[0]?.kind, 'localPrimary');
      assert.equal(inventory[0]?.management, 'managed');
      assert.equal(inventory[0]?.topologyKind, 'localManagedNative');
      assert.equal(inventory[0]?.health, 'ok');
      assert.equal(inventory[0]?.version, DEFAULT_RUNTIME_VERSION);
      assert.equal(
        inventory[0]?.detailPath,
        `/instances/${STABLE_BUILT_IN_OPENCLAW_INSTANCE_ID}`,
      );
      assert.equal(inventory[0]?.sessionState, 'admitted');
      assert.equal(inventory[1]?.kind, 'attachedRemote');
      assert.equal(inventory[1]?.management, 'attached');
      assert.equal(inventory[1]?.health, 'degraded');
    },
  );

  await runTest(
    'nodeInventoryService only suppresses the built-in instance that matches the active kernel runtime',
    async () => {
      const { createNodeInventoryService } = nodeInventoryServiceModule;

      const service = createNodeInventoryService({
        kernelPlatformService: {
          getStatus: async () =>
            createKernelSnapshot({
              runtimeId: 'phoenixclaw',
              runtimeVersion: FUTURE_KERNEL_RUNTIME_VERSION,
              baseUrl: 'http://127.0.0.1:9540',
              websocketUrl: null,
            }),
        },
        hostPlatformService: {
          getStatus: async () => createHostPlatformStatus(),
          listNodeSessions: async () => [
            createNodeSession({
              nodeId: BUILT_IN_PHOENIXCLAW_INSTANCE_ID,
            }),
          ],
        },
        studioApi: {
          getInstances: async () => [
            createInstance({
              id: STABLE_BUILT_IN_OPENCLAW_INSTANCE_ID,
              name: 'Local Built-In OpenClaw',
              description: 'Packaged local OpenClaw kernel.',
            }),
            createInstance({
              id: BUILT_IN_PHOENIXCLAW_INSTANCE_ID,
              name: 'Local PhoenixClaw',
              description: 'Packaged future built-in kernel.',
              runtimeKind: 'phoenixclaw',
              transportKind: 'phoenixSocket',
              version: FUTURE_KERNEL_RUNTIME_VERSION,
              typeLabel: 'PhoenixClaw Runtime',
              port: 9540,
              baseUrl: 'http://127.0.0.1:9540',
              websocketUrl: null,
            }),
          ],
        },
      });

      const inventory = await service.listNodes();

      const phoenixNode = inventory.find((node) => node.id === BUILT_IN_PHOENIXCLAW_INSTANCE_ID);
      const openClawNode = inventory.find(
        (node) => node.id === STABLE_BUILT_IN_OPENCLAW_INSTANCE_ID,
      );

      assert.equal(inventory.length, 2);
      assert.equal(phoenixNode?.source, 'kernel');
      assert.equal(phoenixNode?.kind, 'localPrimary');
      assert.equal(
        phoenixNode?.detailPath,
        `/instances/${BUILT_IN_PHOENIXCLAW_INSTANCE_ID}`,
      );
      assert.equal(phoenixNode?.sessionState, 'admitted');
      assert.equal(openClawNode?.source, 'instance');
      assert.equal(
        openClawNode?.detailPath,
        `/instances/${STABLE_BUILT_IN_OPENCLAW_INSTANCE_ID}`,
      );
    },
  );

  await runTest(
    'nodeInventoryService derives a runtime-aware kernel node identity when the matching built-in instance has not been published yet',
    async () => {
      const { createNodeInventoryService } = nodeInventoryServiceModule;

      const service = createNodeInventoryService({
        kernelPlatformService: {
          getStatus: async () =>
            createKernelSnapshot({
              runtimeId: 'phoenixclaw',
              runtimeVersion: FUTURE_KERNEL_RUNTIME_VERSION,
              baseUrl: 'http://127.0.0.1:9540',
              websocketUrl: null,
            }),
        },
        hostPlatformService: {
          getStatus: async () => createHostPlatformStatus(),
          listNodeSessions: async () => [
            createNodeSession({
              nodeId: BUILT_IN_PHOENIXCLAW_INSTANCE_ID,
            }),
          ],
        },
        studioApi: {
          getInstances: async () => [],
        },
      });

      const inventory = await service.listNodes();

      assert.equal(inventory.length, 1);
      assert.equal(inventory[0]?.id, BUILT_IN_PHOENIXCLAW_INSTANCE_ID);
      assert.equal(inventory[0]?.source, 'kernel');
      assert.equal(inventory[0]?.sessionState, 'admitted');
    },
  );

  await runTest(
    'nodeInventoryService maps degraded kernel health and metadata-only remote instances as attached nodes',
    async () => {
      const { createNodeInventoryService } = nodeInventoryServiceModule;

      const service = createNodeInventoryService({
        kernelPlatformService: {
          getStatus: async () =>
            createKernelSnapshot({
              runtimeHealth: 'failedSafe',
              runtimeState: 'failedSafe',
              controlMode: 'attached',
            }),
        },
        hostPlatformService: {
          getStatus: async () => createHostPlatformStatus({ lifecycle: 'degraded' }),
          listNodeSessions: async () => [
            createNodeSession({
              state: 'blocked',
              compatibilityState: 'blocked',
              desiredStateRevision: null,
              desiredStateHash: null,
            }),
            createNodeSession({
              sessionId: 'metadata-remote-session',
              nodeId: 'managed-remote',
              state: 'blocked',
              compatibilityState: 'blocked',
              desiredStateRevision: null,
              desiredStateHash: null,
            }),
          ],
        },
        studioApi: {
          getInstances: async () => [
            createInstance({
              id: 'managed-remote',
              name: 'Cluster Worker',
              deploymentMode: 'local-managed',
              isBuiltIn: false,
              isDefault: false,
              status: 'starting',
              host: '10.0.0.8',
              port: 28789,
              baseUrl: 'http://10.0.0.8:28789',
              websocketUrl: 'ws://10.0.0.8:28789',
            }),
          ],
        },
      });

      const inventory = await service.listNodes();

      assert.equal(inventory[0]?.health, 'quarantined');
      assert.equal(inventory[0]?.management, 'attached');
      assert.equal(inventory[0]?.compatibilityState, 'blocked');
      assert.equal(inventory[1]?.kind, 'attachedRemote');
      assert.equal(inventory[1]?.management, 'attached');
      assert.equal(inventory[1]?.topologyKind, 'remoteAttachedNode');
      assert.equal(inventory[1]?.health, 'quarantined');
    },
  );

  await runTest(
    'nodeInventoryService does not classify custom local-managed metadata instances as managed remote nodes',
    async () => {
      const { createNodeInventoryService } = nodeInventoryServiceModule;

      const service = createNodeInventoryService({
        kernelPlatformService: {
          getStatus: async () => null,
        },
        hostPlatformService: {
          getStatus: async () => null,
          listNodeSessions: async () => [],
        },
        studioApi: {
          getInstances: async () => [
            createInstance({
              id: 'custom-local-managed',
              name: 'Custom Metadata Runtime',
              deploymentMode: 'local-managed',
              isBuiltIn: false,
              isDefault: false,
              status: 'online',
              host: '10.0.0.8',
              port: 28789,
              baseUrl: 'http://10.0.0.8:28789',
              websocketUrl: 'ws://10.0.0.8:28789',
            }),
          ],
        },
      });

      const inventory = await service.listNodes();

      assert.equal(inventory.length, 1);
      assert.equal(inventory[0]?.id, 'custom-local-managed');
      assert.equal(inventory[0]?.kind, 'attachedRemote');
      assert.equal(inventory[0]?.management, 'attached');
      assert.equal(inventory[0]?.topologyKind, 'remoteAttachedNode');
    },
  );
} else {
  await runTest(
    'nodeInventoryService source keeps package-root imports and projects kernel version from shared runtimeVersion',
    async () => {
      const source = await readNodeInventoryServiceSource();

      assert.match(source, /from '@sdkwork\/claw-core'/);
      assert.match(source, /from '@sdkwork\/claw-types'/);
      assert.match(source, /version:\s*snapshot\.runtimeVersion \?\? null/);
      assert.doesNotMatch(source, /snapshot\.openclawVersion/);
    },
  );

  await runTest(
    'nodeInventoryService source resolves kernel-aware identity and detail routing instead of hardcoding a singleton local-built-in node',
    async () => {
      const source = await readNodeInventoryServiceSource();

      assert.match(source, /kind:\s*'localPrimary'/);
      assert.match(source, /management:\s*snapshot\.controlMode === 'attached' \? 'attached' : 'managed'/);
      assert.match(source, /function findMatchingBuiltInKernelInstance\(/);
      assert.match(source, /function resolveFallbackKernelNodeId\(/);
      assert.match(source, /instance\.runtimeKind\)\s*===\s*normalizeRuntimeId\(snapshot\.runtimeId\)/);
      assert.doesNotMatch(source, /return \['local-built-in', node\.id\];/);
    },
  );

  await runTest(
    'nodeInventoryService source preserves session-based health adjustments and deterministic node sorting',
    async () => {
      const source = await readNodeInventoryServiceSource();

      assert.match(source, /function resolveSessionHealth\(/);
      assert.match(source, /compatibilityState === 'blocked' \|\| sessionState === 'blocked'/);
      assert.match(source, /function sortNodes\(/);
      assert.match(source, /case 'localPrimary':/);
      assert.match(source, /case 'attachedRemote':/);
    },
  );
}
