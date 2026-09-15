// WORKSPACE-PATH:allow-fixture: fixtures name a foreign checkout root, drive, or home directory to exercise path handling, so the literal is the value under assertion rather than a binding this build resolves
import assert from 'node:assert/strict';
import { studio } from '@sdkwork/agentstudio-pc-infrastructure';
import type {
  PersistedKernelChatAgentRecord,
  StudioInstanceRecord,
} from '@sdkwork/agentstudio-pc-types';
import type { KernelAgentLibraryItem } from './kernelAgentLibraryService.ts';
import { createKernelOwnedAgentLibraryService } from './kernelOwnedAgentLibraryService.ts';

function createInstance(
  overrides: Partial<StudioInstanceRecord> & Pick<StudioInstanceRecord, 'id' | 'name'>,
): StudioInstanceRecord {
  return {
    id: overrides.id,
    name: overrides.name,
    type: overrides.type ?? 'runtime',
    typeLabel: overrides.typeLabel ?? 'Runtime',
    runtimeKind: overrides.runtimeKind ?? 'openclaw',
    deploymentMode: overrides.deploymentMode ?? 'local-managed',
    transportKind: overrides.transportKind ?? 'stdio',
    host: overrides.host ?? 'localhost',
    status: overrides.status ?? 'ready',
    endpoint: overrides.endpoint ?? null,
    lastSeenAt: overrides.lastSeenAt ?? null,
    isBuiltIn: overrides.isBuiltIn ?? true,
    notes: overrides.notes ?? null,
  };
}

function createLibraryAgent(
  overrides: Partial<KernelAgentLibraryItem> = {},
): KernelAgentLibraryItem {
  return {
    sourceInstanceId: 'instance-a',
    sourceInstanceName: 'OpenClaw Alpha',
    sourceKernelId: 'openclaw',
    sourceInstanceHost: '127.0.0.1',
    sourceInstanceBuiltIn: true,
    sourceInstanceStatus: 'ready',
    sourceConfigFile: 'D:/OpenClaw/.openclaw/openclaw.json',
    agentId: 'research-analyst',
    displayName: 'Research Analyst',
    avatar: 'RA',
    description: 'Collect evidence and synthesize findings.',
    isDefault: false,
    workspace: 'D:/OpenClaw/workspace',
    agentDir: 'D:/OpenClaw/.openclaw/agents/research-analyst/agent',
    model: {
      primary: 'gpt-5.2',
      fallbacks: ['gpt-5.1'],
    },
    params: {
      temperature: null,
      topP: null,
      maxTokens: null,
      timeoutMs: null,
      streaming: null,
    },
    ...overrides,
  };
}

function createPersistedAgentRecord(
  overrides: Partial<PersistedKernelChatAgentRecord> &
    Pick<PersistedKernelChatAgentRecord, 'instanceId' | 'kernelId' | 'agentId' | 'label'>,
): PersistedKernelChatAgentRecord {
  return {
    id: `${overrides.instanceId}:${overrides.kernelId}:${overrides.agentId}`,
    instanceId: overrides.instanceId,
    kernelId: overrides.kernelId,
    agentId: overrides.agentId,
    label: overrides.label,
    description: overrides.description ?? null,
    source: overrides.source ?? 'kernelCatalog',
    systemPrompt: overrides.systemPrompt ?? null,
    avatar: overrides.avatar ?? null,
    creator: overrides.creator ?? null,
    isDefault: overrides.isDefault ?? false,
    sortOrder: overrides.sortOrder ?? 0,
    syncedAt: overrides.syncedAt ?? 1,
    nativeMetadata: overrides.nativeMetadata ?? null,
  };
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

await runTest(
  'kernelOwnedAgentLibraryService falls back to config-backed agents when persisted-agent support is unavailable on the active platform bridge',
  async () => {
    const originalListPersistedKernelChatAgents = studio.listPersistedKernelChatAgents;
    studio.listPersistedKernelChatAgents = undefined;

    try {
      const service = createKernelOwnedAgentLibraryService({
        getInstance: async () =>
          createInstance({
            id: 'instance-a',
            name: 'OpenClaw Alpha',
          }),
        listConfigBackedAgents: async () => [
          createLibraryAgent(),
          createLibraryAgent({
            agentId: 'ops-responder',
            displayName: 'Ops Responder',
            description: 'Respond to incidents quickly.',
          }),
        ],
      });

      const result = await service.listAgents('instance-a');

      assert.deepEqual(
        result.map((agent) => agent.agentId),
        ['ops-responder', 'research-analyst'],
      );
    } finally {
      studio.listPersistedKernelChatAgents = originalListPersistedKernelChatAgents;
    }
  },
);

await runTest(
  'kernelOwnedAgentLibraryService keeps unmatched config-backed agents visible when persisted ordering data is partial',
  async () => {
    const service = createKernelOwnedAgentLibraryService({
      getInstance: async () =>
        createInstance({
          id: 'instance-a',
          name: 'OpenClaw Alpha',
        }),
      listPersistedKernelChatAgents: async () => [
        createPersistedAgentRecord({
          instanceId: 'instance-a',
          kernelId: 'openclaw',
          agentId: 'research-analyst',
          label: 'Research Analyst',
          description: 'Persisted analyst metadata.',
          avatar: 'PA',
          isDefault: true,
          sortOrder: 0,
        }),
      ],
      listConfigBackedAgents: async () => [
        createLibraryAgent({
          agentId: 'research-analyst',
          displayName: 'Research Analyst',
          description: 'Config-backed analyst metadata.',
          avatar: 'RA',
        }),
        createLibraryAgent({
          agentId: 'ops-responder',
          displayName: 'Ops Responder',
          description: 'Respond to incidents quickly.',
          avatar: 'OR',
        }),
      ],
    });

    const result = await service.listAgents('instance-a');

    assert.deepEqual(
      result.map((agent) => ({
        agentId: agent.agentId,
        displayName: agent.displayName,
        avatar: agent.avatar,
        description: agent.description,
        isDefault: agent.isDefault,
      })),
      [
        {
          agentId: 'research-analyst',
          displayName: 'Research Analyst',
          avatar: 'PA',
          description: 'Persisted analyst metadata.',
          isDefault: true,
        },
        {
          agentId: 'ops-responder',
          displayName: 'Ops Responder',
          avatar: 'OR',
          description: 'Respond to incidents quickly.',
          isDefault: false,
        },
      ],
    );
  },
);
