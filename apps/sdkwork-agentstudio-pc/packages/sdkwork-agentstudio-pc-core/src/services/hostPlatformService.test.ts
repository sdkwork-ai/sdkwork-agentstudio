// WORKSPACE-PATH:allow-fixture: fixtures name a foreign checkout root, drive, or home directory to exercise path handling, so the literal is the value under assertion rather than a binding this build resolves
import assert from 'node:assert/strict';
import type {
  HostPlatformStatusRecord,
  InternalNodeSessionRecord,
} from '@sdkwork/agentstudio-pc-infrastructure';
import { STABLE_BUILT_IN_OPENCLAW_INSTANCE_ID } from '@sdkwork/agentstudio-pc-types';

async function runTest(name: string, callback: () => Promise<void> | void) {
  try {
    await callback();
    console.log(`ok - ${name}`);
  } catch (error) {
    console.error(`not ok - ${name}`);
    throw error;
  }
}

function createHostStatus(
  overrides: Partial<HostPlatformStatusRecord> = {},
): HostPlatformStatusRecord {
  return {
    mode: 'desktopCombined',
    lifecycle: 'ready',
    distributionFamily: 'desktop',
    deploymentFamily: 'bareMetal',
    acceleratorProfile: null,
    hostId: 'desktop-combined',
    displayName: 'Desktop Combined Host',
    version: '0.1.0',
    desiredStateProjectionVersion: 'phase1',
    rolloutEngineVersion: 'phase1',
    manageBasePath: '/claw/manage/v1',
    internalBasePath: '/claw/internal/v1',
    stateStoreDriver: 'sqlite',
    stateStore: {
      activeProfileId: 'default-sqlite',
      providers: [
        {
          id: 'sqlite',
          label: 'SQLite',
          availability: 'ready',
          requiresConfiguration: false,
          configurationKeys: [],
          projectionMode: 'runtime',
        },
        {
          id: 'postgres',
          label: 'PostgreSQL',
          availability: 'planned',
          requiresConfiguration: true,
          configurationKeys: ['postgresUrl', 'postgresSchema'],
          projectionMode: 'metadataOnly',
        },
      ],
      profiles: [
        {
          id: 'default-sqlite',
          label: 'SQLite',
          driver: 'sqlite',
          active: true,
          availability: 'ready',
          path: 'C:/Users/admin/.sdkwork/crawstudio/storage/default.db',
          connectionConfigured: false,
          configuredKeys: ['path'],
          projectionMode: 'runtime',
        },
        {
          id: 'planned-postgres',
          label: 'PostgreSQL',
          driver: 'postgres',
          active: false,
          availability: 'planned',
          connectionConfigured: true,
          configuredKeys: ['postgresUrl'],
          projectionMode: 'metadataOnly',
        },
      ],
    },
    capabilityKeys: ['nodeSessions', 'rollouts'],
    updatedAt: 1_743_200_000_000,
    ...overrides,
  };
}

function createNodeSession(
  overrides: Partial<InternalNodeSessionRecord> = {},
): InternalNodeSessionRecord {
  return {
    sessionId: `desktop-combined-${STABLE_BUILT_IN_OPENCLAW_INSTANCE_ID}`,
    nodeId: STABLE_BUILT_IN_OPENCLAW_INSTANCE_ID,
    state: 'admitted',
    compatibilityState: 'compatible',
    desiredStateRevision: 7,
    desiredStateHash: 'rev-7',
    lastSeenAt: 1_743_200_000_123,
    ...overrides,
  };
}

await runTest(
  'hostPlatformService exposes host status snapshots and node sessions through the internal platform bridge',
  async () => {
    const { createHostPlatformService } = await import('./hostPlatformService.ts');

    const service = createHostPlatformService({
      getInternalPlatform: () => ({
        getHostPlatformStatus: async () => createHostStatus(),
        listNodeSessions: async () => [
          createNodeSession(),
          createNodeSession({
            sessionId: 'remote-managed-session',
            nodeId: 'managed-remote',
            compatibilityState: 'blocked',
            state: 'blocked',
            desiredStateRevision: null,
            desiredStateHash: null,
          }),
        ],
      }),
    });

    const status = await service.getStatus();
    const sessions = await service.listNodeSessions();

    assert.equal(status.mode, 'desktopCombined');
    assert.equal(status.lifecycle, 'ready');
    assert.equal(status.capabilityCount, 2);
    assert.equal(status.isReady, true);
    assert.equal(status.stateStoreDriver, 'sqlite');
    assert.equal(status.stateStore.activeProfileId, 'default-sqlite');
    assert.deepEqual(status.stateStore.profiles[0]?.configuredKeys, ['path']);
    assert.equal(status.stateStore.providers[1]?.projectionMode, 'metadataOnly');
    assert.equal(status.stateStore.profiles[1]?.projectionMode, 'metadataOnly');
    assert.deepEqual(status.capabilityKeys, ['nodeSessions', 'rollouts']);
    assert.equal(sessions[0]?.desiredStateRevision, 7);
    assert.equal(sessions[1]?.compatibilityState, 'blocked');
  },
);

