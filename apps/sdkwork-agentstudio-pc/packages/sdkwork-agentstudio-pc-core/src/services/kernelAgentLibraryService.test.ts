// WORKSPACE-PATH:allow-fixture: fixtures name a foreign checkout root, drive, or home directory to exercise path handling, so the literal is the value under assertion rather than a binding this build resolves
import assert from 'node:assert/strict';
import type {
  PersistedKernelChatAgentRecord,
  StudioInstanceDetailRecord,
  StudioInstanceRecord,
} from '@sdkwork/agentstudio-pc-types';
import { createKernelAgentLibraryService } from './kernelAgentLibraryService.ts';

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
    host: overrides.host ?? 'localhost',
    status: overrides.status ?? 'ready',
    transportKind: overrides.transportKind ?? 'stdio',
    endpoint: overrides.endpoint ?? null,
    lastSeenAt: overrides.lastSeenAt ?? null,
    isBuiltIn: overrides.isBuiltIn ?? false,
    notes: overrides.notes ?? null,
  };
}

function createDetail(
  instance: StudioInstanceRecord,
  configFile: string | null,
): StudioInstanceDetailRecord {
  return {
    instance,
    lifecycle: {
      ready: true,
      running: true,
      configWritable: true,
    },
    connectivity: {
      reachable: true,
      primaryTransport: instance.transportKind,
    },
    dataAccess: configFile
      ? {
          routes: [
            {
              scope: 'config',
              mode: 'managedFile',
              target: configFile,
              authoritative: true,
            },
          ],
        }
      : {
          routes: [],
        },
    workbench: null,
    artifacts: configFile
      ? [
          {
            kind: 'configFile',
            location: configFile,
          },
        ]
      : [],
  } as StudioInstanceDetailRecord;
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

await runTest(
  'kernelAgentLibraryService aggregates copy-ready local kernel agents from writable OpenClaw instance configs',
  async () => {
    const builtInInstance = createInstance({
      id: 'built-in',
      name: 'Built-In OpenClaw',
      isBuiltIn: true,
    });
    const externalInstance = createInstance({
      id: 'external',
      name: 'External OpenClaw',
      isBuiltIn: false,
    });
    const unsupportedInstance = createInstance({
      id: 'hermes',
      name: 'Hermes',
      runtimeKind: 'hermes',
    });

    const service = createKernelAgentLibraryService({
      listInstances: async () => [externalInstance, builtInInstance, unsupportedInstance],
      getInstanceDetail: async (instanceId) => {
        if (instanceId === builtInInstance.id) {
          return createDetail(
            builtInInstance,
            'D:/BuiltIn/.openclaw/openclaw.json',
          );
        }
        if (instanceId === externalInstance.id) {
          return createDetail(
            externalInstance,
            'D:/External/.openclaw/openclaw.json',
          );
        }
        return createDetail(unsupportedInstance, null);
      },
      resolveInstanceConfigPath: (detail) =>
        detail?.instance.runtimeKind === 'openclaw'
          ? detail.dataAccess?.routes?.[0]?.target ?? null
          : null,
      readConfigSnapshot: async (configFile) => {
        if (configFile.includes('BuiltIn')) {
          return {
            configFile,
            root: {},
            providerSnapshots: [],
            channelSnapshots: [],
            webSearchConfig: { enabled: false, provider: null, endpoint: null, timeoutMs: null },
            xSearchConfig: { enabled: false, provider: null, endpoint: null, timeoutMs: null },
            webSearchNativeCodexConfig: {
              enabled: false,
              baseUrl: null,
              clientToken: null,
              source: null,
              userLocation: null,
            },
            webFetchConfig: { enabled: false, provider: null, endpoint: null, timeoutMs: null },
            authCooldownsConfig: {
              rateLimitedProfileRotations: null,
              overloadedProfileRotations: null,
              overloadedBackoffMs: null,
              billingBackoffHours: null,
              billingMaxHours: null,
              failureWindowHours: null,
            },
            dreamingConfig: { enabled: false, frequency: 'never' },
            agentSnapshots: [
              {
                id: 'main',
                name: 'Main Agent',
                avatar: 'MA',
                description: 'Primary operator.',
                workspace: 'D:/BuiltIn/workspace',
                agentDir: 'D:/BuiltIn/.openclaw/agents/main/agent',
                isDefault: true,
                model: {
                  primary: 'openai/gpt-5.1',
                  fallbacks: ['anthropic/claude-sonnet-4'],
                },
                params: {
                  temperature: 0.2,
                  streaming: true,
                },
                paramSources: {
                  temperature: 'agent',
                  streaming: 'defaults',
                },
              },
            ],
          } as any;
        }

        return {
          configFile,
          root: {},
          providerSnapshots: [],
          channelSnapshots: [],
          webSearchConfig: { enabled: false, provider: null, endpoint: null, timeoutMs: null },
          xSearchConfig: { enabled: false, provider: null, endpoint: null, timeoutMs: null },
          webSearchNativeCodexConfig: {
            enabled: false,
            baseUrl: null,
            clientToken: null,
            source: null,
            userLocation: null,
          },
          webFetchConfig: { enabled: false, provider: null, endpoint: null, timeoutMs: null },
          authCooldownsConfig: {
            rateLimitedProfileRotations: null,
            overloadedProfileRotations: null,
            overloadedBackoffMs: null,
            billingBackoffHours: null,
            billingMaxHours: null,
            failureWindowHours: null,
          },
          dreamingConfig: { enabled: false, frequency: 'never' },
          agentSnapshots: [
            {
              id: 'ops-responder',
              name: 'Ops Responder',
              avatar: 'OR',
              description: 'Incident response specialist.',
              workspace: 'D:/External/workspace',
              agentDir: 'D:/External/.openclaw/agents/ops-responder/agent',
              isDefault: false,
              model: {
                primary: 'openai/gpt-5.1-mini',
                fallbacks: [],
              },
              params: {
                topP: 0.9,
                maxTokens: 12000,
                timeoutMs: 45000,
                streaming: false,
              },
              paramSources: {
                topP: 'agent',
                maxTokens: 'agent',
                timeoutMs: 'agent',
                streaming: 'agent',
              },
            },
          ],
        } as any;
      },
    });

    const result = await service.listAgents();

    assert.equal(result.length, 2);
    assert.deepEqual(
      result.map((agent) => ({
        sourceInstanceId: agent.sourceInstanceId,
        sourceInstanceName: agent.sourceInstanceName,
        agentId: agent.agentId,
        displayName: agent.displayName,
        isDefault: agent.isDefault,
      })),
      [
        {
          sourceInstanceId: 'built-in',
          sourceInstanceName: 'Built-In OpenClaw',
          agentId: 'main',
          displayName: 'Main Agent',
          isDefault: true,
        },
        {
          sourceInstanceId: 'external',
          sourceInstanceName: 'External OpenClaw',
          agentId: 'ops-responder',
          displayName: 'Ops Responder',
          isDefault: false,
        },
      ],
    );
    assert.deepEqual(result[0]?.model, {
      primary: 'openai/gpt-5.1',
      fallbacks: ['anthropic/claude-sonnet-4'],
    });
    assert.deepEqual(result[1]?.params, {
      temperature: null,
      topP: 0.9,
      maxTokens: 12000,
      timeoutMs: 45000,
      streaming: false,
    });
  },
);

await runTest(
  'kernelAgentLibraryService tolerates unreadable instance details and config snapshots without failing the modal data source',
  async () => {
    const instance = createInstance({
      id: 'broken',
      name: 'Broken OpenClaw',
    });

    const service = createKernelAgentLibraryService({
      listInstances: async () => [instance],
      getInstanceDetail: async () => {
        throw new Error('boom');
      },
      resolveInstanceConfigPath: () => null,
      readConfigSnapshot: async () => {
        throw new Error('should not be called');
      },
    });

    const result = await service.listAgents();

    assert.deepEqual(result, []);
  },
);

await runTest(
  'kernelAgentLibraryService merges persisted multi-kernel agent records with config-backed agents so the global copy library stays complete',
  async () => {
    const builtInOpenClaw = createInstance({
      id: 'built-in',
      name: 'Built-In OpenClaw',
      isBuiltIn: true,
      runtimeKind: 'openclaw',
    });
    const hermesInstance = createInstance({
      id: 'hermes',
      name: 'Hermes Runtime',
      runtimeKind: 'hermes',
      isBuiltIn: false,
    });

    const service = createKernelAgentLibraryService({
      listInstances: async () => [hermesInstance, builtInOpenClaw],
      getInstanceDetail: async (instanceId) => {
        if (instanceId === builtInOpenClaw.id) {
          return createDetail(
            builtInOpenClaw,
            'D:/BuiltIn/.openclaw/openclaw.json',
          );
        }

        return createDetail(hermesInstance, null);
      },
      resolveInstanceConfigPath: (detail) =>
        detail?.instance.runtimeKind === 'openclaw'
          ? detail.dataAccess?.routes?.[0]?.target ?? null
          : null,
      readConfigSnapshot: async () =>
        ({
          configFile: 'D:/BuiltIn/.openclaw/openclaw.json',
          root: {},
          providerSnapshots: [],
          channelSnapshots: [],
          webSearchConfig: { enabled: false, provider: null, endpoint: null, timeoutMs: null },
          xSearchConfig: { enabled: false, provider: null, endpoint: null, timeoutMs: null },
          webSearchNativeCodexConfig: {
            enabled: false,
            baseUrl: null,
            clientToken: null,
            source: null,
            userLocation: null,
          },
          webFetchConfig: { enabled: false, provider: null, endpoint: null, timeoutMs: null },
          authCooldownsConfig: {
            rateLimitedProfileRotations: null,
            overloadedProfileRotations: null,
            overloadedBackoffMs: null,
            billingBackoffHours: null,
            billingMaxHours: null,
            failureWindowHours: null,
          },
          dreamingConfig: { enabled: false, frequency: 'never' },
          agentSnapshots: [
            {
              id: 'main',
              name: 'Main Agent',
              avatar: 'MA',
              description: 'Config-backed main agent.',
              workspace: 'D:/BuiltIn/workspace',
              agentDir: 'D:/BuiltIn/.openclaw/agents/main/agent',
              isDefault: false,
              model: {
                primary: 'openai/gpt-5.1',
                fallbacks: [],
              },
              params: {
                streaming: true,
              },
              paramSources: {
                streaming: 'agent',
              },
            },
            {
              id: 'ops-responder',
              name: 'Ops Responder',
              avatar: 'OR',
              description: 'Config-only responder agent.',
              workspace: 'D:/BuiltIn/workspace',
              agentDir: 'D:/BuiltIn/.openclaw/agents/ops-responder/agent',
              isDefault: false,
              model: {
                primary: 'openai/gpt-5.1-mini',
                fallbacks: [],
              },
              params: {},
              paramSources: {},
            },
          ],
        }) as any,
      listPersistedKernelChatAgents: async (instanceId) => {
        if (instanceId === builtInOpenClaw.id) {
          return [
            createPersistedAgentRecord({
              instanceId,
              kernelId: 'openclaw',
              agentId: 'main',
              label: 'Main Agent',
              description: 'Persisted primary operator.',
              avatar: 'PM',
              isDefault: true,
              sortOrder: 0,
            }),
          ];
        }

        if (instanceId === hermesInstance.id) {
          return [
            createPersistedAgentRecord({
              instanceId,
              kernelId: 'hermes',
              agentId: 'planner',
              label: 'Planner',
              description: 'Hermes planner agent.',
              avatar: 'HP',
              isDefault: false,
              sortOrder: 0,
            }),
          ];
        }

        return [];
      },
    } as any);

    const result = await service.listAgents();

    assert.deepEqual(
      result.map((agent) => ({
        sourceInstanceId: agent.sourceInstanceId,
        sourceKernelId: agent.sourceKernelId,
        agentId: agent.agentId,
        displayName: agent.displayName,
        avatar: agent.avatar,
        description: agent.description,
        isDefault: agent.isDefault,
      })),
      [
        {
          sourceInstanceId: 'built-in',
          sourceKernelId: 'openclaw',
          agentId: 'main',
          displayName: 'Main Agent',
          avatar: 'PM',
          description: 'Persisted primary operator.',
          isDefault: true,
        },
        {
          sourceInstanceId: 'built-in',
          sourceKernelId: 'openclaw',
          agentId: 'ops-responder',
          displayName: 'Ops Responder',
          avatar: 'OR',
          description: 'Config-only responder agent.',
          isDefault: false,
        },
        {
          sourceInstanceId: 'hermes',
          sourceKernelId: 'hermes',
          agentId: 'planner',
          displayName: 'Planner',
          avatar: 'HP',
          description: 'Hermes planner agent.',
          isDefault: false,
        },
      ],
    );
    assert.deepEqual(result[2]?.model, {
      primary: null,
      fallbacks: [],
    });
  },
);
