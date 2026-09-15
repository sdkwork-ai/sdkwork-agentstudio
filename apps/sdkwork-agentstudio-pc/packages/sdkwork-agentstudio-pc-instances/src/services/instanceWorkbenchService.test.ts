// WORKSPACE-PATH:allow-fixture: fixtures name a foreign checkout root, drive, or home directory to exercise path handling, so the literal is the value under assertion rather than a binding this build resolves
import assert from 'node:assert/strict';
import {
  DEFAULT_BUNDLED_OPENCLAW_VERSION,
  listOpenClawChannelDefinitions,
  type StudioInstanceDetailRecord,
} from '@sdkwork/agentstudio-pc-types';
import { buildOpenClawAgentFileId } from './openClawSupport.ts';
import {
  createInstanceWorkbenchService as createInstanceWorkbenchServiceCore,
  type InstanceWorkbenchServiceDependencies,
  type InstanceWorkbenchServiceDependencyOverrides,
} from './instanceWorkbenchServiceCore.ts';

const BUILT_IN_INSTANCE_ID = 'managed-openclaw-primary';

function runTest(name: string, fn: () => Promise<void> | void) {
  return Promise.resolve()
    .then(fn)
    .then(() => {
      console.log(`ok - ${name}`);
    })
    .catch((error) => {
      console.error(`not ok - ${name}`);
      throw error;
    });
}

type ConfigSnapshot =
  Awaited<
    ReturnType<InstanceWorkbenchServiceDependencies['openClawConfigDocumentApi']['readConfigSnapshot']>
  >;
type ConfigRoute = StudioInstanceDetailRecord['dataAccess']['routes'][number];
type LiveTask =
  Awaited<ReturnType<InstanceWorkbenchServiceDependencies['openClawGatewayClient']['listWorkbenchCronJobs']>>[number];

function createConfigSnapshot(
  configPath = '',
  overrides: Partial<ConfigSnapshot> = {},
): ConfigSnapshot {
  return {
    configPath,
    providerSnapshots: [],
    agentSnapshots: [],
    channelSnapshots: [],
    webSearchConfig: {
      enabled: true,
      provider: '',
      maxResults: 0,
      timeoutSeconds: 0,
      cacheTtlMinutes: 0,
      providers: [],
    },
    xSearchConfig: {
      enabled: false,
      apiKeySource: '',
      model: '',
      inlineCitations: false,
      maxTurns: 2,
      timeoutSeconds: 30,
      cacheTtlMinutes: 15,
      advancedConfig: '',
    },
    webSearchNativeCodexConfig: {
      enabled: false,
      mode: 'cached',
      allowedDomains: [],
      contextSize: '',
      userLocation: {
        country: '',
        city: '',
        timezone: '',
      },
      advancedConfig: '',
    },
    webFetchConfig: {
      enabled: true,
      maxChars: 50000,
      maxCharsCap: 50000,
      maxResponseBytes: 2000000,
      timeoutSeconds: 30,
      cacheTtlMinutes: 15,
      maxRedirects: 3,
      readability: true,
      userAgent: '',
      fallbackProvider: {
        providerId: 'firecrawl',
        name: 'Firecrawl Fetch',
        description: 'Use Firecrawl as the OpenClaw web_fetch fallback provider.',
        apiKeySource: '',
        baseUrl: '',
        advancedConfig: '',
        supportsApiKey: true,
        supportsBaseUrl: true,
      },
    },
    authCooldownsConfig: {
      rateLimitedProfileRotations: null,
      overloadedProfileRotations: null,
      overloadedBackoffMs: null,
      billingBackoffHours: null,
      billingMaxHours: null,
      failureWindowHours: null,
    },
    dreamingConfig: {
      enabled: false,
      frequency: '',
    },
    root: {},
    ...overrides,
  };
}

function createConfigRoute(
  target: string,
  overrides: Partial<ConfigRoute> = {},
): ConfigRoute {
  return {
    id: 'config',
    label: 'Configuration',
    scope: 'config',
    mode: 'managedFile',
    status: 'ready',
    target,
    readonly: false,
    authoritative: true,
    detail: 'OpenClaw config file is writable.',
    source: 'integration',
    ...overrides,
  };
}

function resolveConfigFile(detail: StudioInstanceDetailRecord | null | undefined) {
  const configRoute = detail?.dataAccess?.routes?.find((route) => route.scope === 'config');
  if (configRoute) {
    if (configRoute.mode === 'managedFile' && configRoute.target) {
      return configRoute.target;
    }

    return null;
  }

  const configArtifact = detail?.artifacts?.find(
    (artifact) => artifact.kind === 'configFile' && artifact.location,
  );
  return configArtifact?.location || null;
}

const kernelConfigAttachmentApi: InstanceWorkbenchServiceDependencies['kernelConfigAttachmentApi'] =
  {
    resolveAttachedKernelConfigFile: (detail: StudioInstanceDetailRecord | null | undefined) =>
      resolveConfigFile(detail),
  };

const openClawConfigDocumentApi: InstanceWorkbenchServiceDependencies['openClawConfigDocumentApi'] =
  {
  readConfigSnapshot: async (configPath: string) => createConfigSnapshot(configPath),
  getChannelDefinitions: () =>
    listOpenClawChannelDefinitions().map((definition) => ({
      ...definition,
      fields: definition.fields.map((field) => ({ ...field })),
      setupSteps: [...definition.setupSteps],
    })),
  };

function createConfigChannelSnapshots(): ConfigSnapshot['channelSnapshots'] {
  return openClawConfigDocumentApi.getChannelDefinitions().map((definition) => ({
    id: definition.id,
    name: definition.name,
    description: definition.description,
    status: definition.configurationMode === 'none' ? 'connected' : 'not_configured',
    enabled: definition.configurationMode === 'none',
    configurationMode: definition.configurationMode || 'required',
    fieldCount: definition.fields.length,
    configuredFieldCount: 0,
    setupSteps: [...definition.setupSteps],
    values: Object.fromEntries(definition.fields.map((field) => [field.key, ''])),
    fields: definition.fields.map((field) => ({ ...field })),
  }));
}

function buildOpenClawCronTaskPayloadForTest(
  task: Record<string, any>,
  rawDefinition?: Record<string, unknown>,
) {
  if (rawDefinition && Object.keys(rawDefinition).length > 0) {
    return {
      ...rawDefinition,
      name: task.name,
      description: task.description,
    };
  }

  return {
    name: task.name,
    ...(task.description ? { description: task.description } : {}),
    enabled: task.status !== 'paused',
    schedule: {
      kind: task.scheduleMode === 'datetime' ? 'datetime' : task.scheduleMode === 'interval' ? 'interval' : 'cron',
      ...(task.scheduleMode === 'datetime'
        ? {
            at:
              task.scheduleConfig?.datetime ||
              task.scheduleConfig?.at ||
              task.schedule ||
              '',
          }
        : task.scheduleMode === 'interval'
          ? {
              ms:
                task.scheduleConfig?.intervalMs ||
                task.scheduleConfig?.interval ||
                0,
            }
          : {
              expr:
                task.cronExpression ||
                task.scheduleConfig?.cronExpression ||
                task.schedule ||
                '',
            }),
    },
    sessionTarget:
      task.sessionMode === 'main'
        ? 'main'
        : task.sessionMode === 'current'
          ? 'current'
          : task.sessionMode === 'custom' && task.customSessionId
            ? task.customSessionId
            : 'isolated',
    wakeMode: task.wakeUpMode === 'nextCycle' ? 'nextCycle' : 'now',
    payload:
      task.executionContent === 'sendPromptMessage'
        ? {
            kind: 'systemEvent',
            message: task.prompt || '',
          }
        : {
            kind: 'agentTurn',
            message: task.prompt || '',
          },
    delivery:
      task.deliveryMode === 'publishSummary'
        ? {
            mode: 'announce',
            ...(task.deliveryChannel ? { channel: task.deliveryChannel } : {}),
            ...(task.recipient ? { to: task.recipient } : {}),
          }
        : task.deliveryMode === 'webhook'
          ? {
              mode: 'webhook',
              ...(task.recipient ? { url: task.recipient } : {}),
            }
          : {
              mode: 'none',
            },
  };
}

function createInstanceWorkbenchService(
  overrides: InstanceWorkbenchServiceDependencyOverrides = {},
) {
  return createInstanceWorkbenchServiceCore({
    ...overrides,
    kernelConfigAttachmentApi: {
      ...kernelConfigAttachmentApi,
      ...(overrides.kernelConfigAttachmentApi || {}),
    },
    openClawConfigDocumentApi: {
      ...openClawConfigDocumentApi,
      ...(overrides.openClawConfigDocumentApi || {}),
    },
    buildCronTaskPayload: overrides.buildCronTaskPayload || buildOpenClawCronTaskPayloadForTest,
  });
}

function createOpenClawDetail(
  instanceId = 'openclaw-prod',
  overrides: Partial<StudioInstanceDetailRecord> = {},
): StudioInstanceDetailRecord {
  return {
    instance: {
      id: instanceId,
      name: `OpenClaw ${instanceId}`,
      description: 'Primary OpenClaw gateway.',
      runtimeKind: 'openclaw',
      deploymentMode: 'remote',
      transportKind: 'openclawGatewayWs',
      status: 'online',
      isBuiltIn: false,
      isDefault: false,
      iconType: 'server',
      version: DEFAULT_BUNDLED_OPENCLAW_VERSION,
      typeLabel: 'OpenClaw Gateway',
      host: '10.0.0.8',
      port: 21280,
      baseUrl: 'http://10.0.0.8:21280',
      websocketUrl: 'ws://10.0.0.8:21280',
      cpu: 12,
      memory: 35,
      totalMemory: '64GB',
      uptime: '18h',
      capabilities: ['chat', 'health', 'tasks', 'files', 'memory', 'tools', 'models'],
      storage: {
        provider: 'localFile',
        namespace: instanceId,
      },
      config: {
        port: '21280',
        sandbox: true,
        autoUpdate: true,
        logLevel: 'info',
        corsOrigins: '*',
        baseUrl: 'http://10.0.0.8:21280',
        websocketUrl: 'ws://10.0.0.8:21280',
        authToken: 'gateway-token',
      },
      createdAt: 1,
      updatedAt: 1,
      lastSeenAt: 1,
    },
    config: {
      port: '21280',
      sandbox: true,
      autoUpdate: true,
      logLevel: 'info',
      corsOrigins: '*',
      baseUrl: 'http://10.0.0.8:21280',
      websocketUrl: 'ws://10.0.0.8:21280',
      authToken: 'gateway-token',
    },
    logs: '',
    health: {
      score: 91,
      status: 'healthy',
      checks: [],
      evaluatedAt: 1,
    },
    lifecycle: {
      owner: 'remoteService',
      startStopSupported: false,
      configWritable: true,
      notes: [],
    },
    storage: {
      status: 'ready',
      provider: 'localFile',
      namespace: instanceId,
      durable: true,
      queryable: false,
      transactional: false,
      remote: false,
    },
    connectivity: {
      primaryTransport: 'openclawGatewayWs',
      endpoints: [],
    },
    observability: {
      status: 'ready',
      logAvailable: true,
      logPreview: [],
      metricsSource: 'runtime',
      lastSeenAt: 1,
    },
    dataAccess: {
      routes: [],
    },
    artifacts: [],
    capabilities: [
      {
        id: 'tasks',
        status: 'ready',
        detail: 'Cron tasks are enabled.',
        source: 'runtime',
      },
      {
        id: 'files',
        status: 'ready',
        detail: 'Agent files are readable.',
        source: 'runtime',
      },
      {
        id: 'memory',
        status: 'ready',
        detail: 'Memory reads are enabled.',
        source: 'runtime',
      },
      {
        id: 'tools',
        status: 'ready',
        detail: 'Tool catalog is available.',
        source: 'runtime',
      },
      {
        id: 'models',
        status: 'ready',
        detail: 'Model configuration is available.',
        source: 'runtime',
      },
    ],
    officialRuntimeNotes: [],
    ...overrides,
  };
}

function createBuiltInOpenClawDetail(): StudioInstanceDetailRecord {
  return {
    ...createOpenClawDetail(BUILT_IN_INSTANCE_ID),
    instance: {
      ...createOpenClawDetail(BUILT_IN_INSTANCE_ID).instance,
      isBuiltIn: true,
      isDefault: true,
      deploymentMode: 'local-managed',
      host: '127.0.0.1',
      baseUrl: 'http://127.0.0.1:21280',
      websocketUrl: 'ws://127.0.0.1:21280',
    },
    config: {
      ...createOpenClawDetail(BUILT_IN_INSTANCE_ID).config,
      baseUrl: 'http://127.0.0.1:21280',
      websocketUrl: 'ws://127.0.0.1:21280',
    },
    workbench: {
      channels: [
        {
          id: 'old-channel',
          name: 'Old Channel',
          description: 'Stale backend data',
          status: 'disconnected',
          enabled: false,
          fieldCount: 1,
          configuredFieldCount: 0,
          setupSteps: ['Reconnect the channel.'],
        },
      ],
      cronTasks: {
        tasks: [
          {
            id: 'backend-task-1',
            name: 'Backend Snapshot Task',
            description: 'Task from backend snapshot',
            prompt: 'Snapshot prompt',
            schedule: '0 8 * * *',
            scheduleMode: 'cron',
            scheduleConfig: {
              cronExpression: '0 8 * * *',
            },
            cronExpression: '0 8 * * *',
            actionType: 'skill',
            status: 'active',
            sessionMode: 'isolated',
            wakeUpMode: 'immediate',
            executionContent: 'runAssistantTask',
            deliveryMode: 'publishSummary',
            deliveryChannel: 'slack',
            deliveryLabel: 'Slack',
            recipient: 'channel:C001',
            lastRun: '2025-03-19T00:00:00.000Z',
            nextRun: '2025-03-20T00:00:00.000Z',
            latestExecution: null,
          },
        ],
        taskExecutionsById: {
          'backend-task-1': [],
        },
      },
      llmProviders: [
        {
          id: 'backend-provider',
          name: 'Backend Provider',
          provider: 'backend',
          endpoint: 'https://backend.example.com',
          apiKeySource: 'env:BACKEND_KEY',
          status: 'ready',
          defaultModelId: 'backend-model',
          description: 'Stale backend provider.',
          icon: 'B',
          lastCheckedAt: '2025-03-19T00:00:00.000Z',
          capabilities: ['chat'],
          models: [
            {
              id: 'backend-model',
              name: 'Backend Model',
              role: 'primary',
              contextWindow: 'Unknown',
            },
          ],
          config: {
            temperature: 0.2,
            topP: 1,
            maxTokens: 4096,
            timeoutMs: 60000,
            streaming: true,
          },
        },
      ],
      agents: [
        {
          agent: {
            id: 'backend-agent',
            name: 'Backend Agent',
            description: 'Stale backend agent.',
            avatar: 'B',
            systemPrompt: 'Handle backend tasks.',
            creator: 'Agent Studio',
          },
          focusAreas: ['Generalist'],
          automationFitScore: 55,
        },
      ],
      skills: [
        {
          id: 'backend-skill',
          name: 'Backend Skill',
          description: 'Stale backend skill.',
          author: 'Agent Studio',
          rating: 5,
          downloads: 1,
          category: 'Automation',
        },
      ],
      files: [
        {
          id: '/workspace/main/AGENTS.md',
          name: 'AGENTS.md',
          path: '/workspace/main/AGENTS.md',
          category: 'prompt',
          language: 'markdown',
          size: '1.0 KB',
          updatedAt: '2025-03-19T00:00:00.000Z',
          status: 'synced',
          description: 'Built-in managed file.',
          content: '# Backend file',
          isReadonly: false,
        },
      ],
      memory: [
        {
          id: 'backend-memory',
          title: 'Backend Memory',
          type: 'fact',
          summary: 'Stale backend memory.',
          source: 'system',
          updatedAt: '2025-03-19T00:00:00.000Z',
          retention: 'rolling',
          tokens: 12,
        },
      ],
      tools: [
        {
          id: 'backend-tool',
          name: 'Backend Tool',
          description: 'Stale backend tool.',
          category: 'automation',
          status: 'ready',
          access: 'execute',
          command: 'tool:backend',
        },
      ],
    },
  };
}

function createLiveTask(taskId = 'job-ops-daily'): LiveTask {
  return {
    id: taskId,
    name: 'Ops Daily Brief',
    description: 'Morning operations summary',
    prompt: 'Summarize operations updates.',
    schedule: '0 9 * * *',
    scheduleMode: 'cron' as const,
    scheduleConfig: {
      cronExpression: '0 9 * * *',
    },
    cronExpression: '0 9 * * *',
    actionType: 'skill' as const,
    status: 'active' as const,
    sessionMode: 'isolated' as const,
    wakeUpMode: 'immediate' as const,
    executionContent: 'runAssistantTask' as const,
    deliveryMode: 'publishSummary' as const,
    deliveryChannel: 'slack',
    deliveryLabel: 'slack',
    recipient: 'channel:C001',
    lastRun: '2025-03-19T01:00:00.000Z',
    nextRun: '2025-03-20T01:00:00.000Z',
    latestExecution: {
      id: `${taskId}-latest`,
      taskId,
      status: 'success' as const,
      trigger: 'schedule' as const,
      startedAt: '2025-03-19T01:00:00.000Z',
      finishedAt: '2025-03-19T01:00:00.000Z',
      summary: 'Cron job completed successfully.',
      details: undefined,
    },
  };
}

function createCustomDetail(
  instanceId = 'custom-remote',
  overrides: Partial<StudioInstanceDetailRecord> = {},
): StudioInstanceDetailRecord {
  return {
    ...createOpenClawDetail(instanceId),
    instance: {
      ...createOpenClawDetail(instanceId).instance,
      runtimeKind: 'custom',
      transportKind: 'customHttp',
      typeLabel: 'Custom Runtime',
      capabilities: ['chat', 'health'],
      config: {
        port: '17890',
        sandbox: true,
        autoUpdate: false,
        logLevel: 'info',
        corsOrigins: '*',
      },
    },
    config: {
      port: '17890',
      sandbox: true,
      autoUpdate: false,
      logLevel: 'info',
      corsOrigins: '*',
    },
    capabilities: [
      {
        id: 'chat',
        status: 'ready',
        detail: 'Chat is enabled.',
        source: 'runtime',
      },
      {
        id: 'health',
        status: 'ready',
        detail: 'Health checks are enabled.',
        source: 'runtime',
      },
    ],
    workbench: null,
    ...overrides,
  };
}

function createMockChannel(id = 'slack', name = 'Slack') {
  return {
    id,
    name,
    description: `${name} notifications`,
    status: 'connected' as const,
    enabled: true,
    configurationMode: 'required' as const,
    fields: [
      {
        key: 'token',
        value: 'configured',
      },
    ],
    setupGuide: [`Configure ${name}`],
  };
}

await runTest('getInstanceWorkbench builds a remote OpenClaw snapshot from gateway-backed sections', async () => {
  const service = createInstanceWorkbenchService({
    studioApi: {
      getInstanceDetail: async () =>
        createOpenClawDetail('openclaw-prod', {
          workbench: null,
        }),
    },
    openClawGatewayClient: {
      listWorkbenchCronJobs: async () => [createLiveTask()],
      listWorkbenchCronRuns: async () => [],
      getConfig: async () => ({
        baseHash: 'hash-1',
        config: {
          meta: {
            lastTouchedAt: '2025-03-19T02:00:00.000Z',
          },
          memory: {
            backend: 'vector',
            citations: 'auto',
            qmd: {
              paths: [
                {
                  name: 'Runbooks',
                  path: '/memory/runbooks',
                  pattern: '**/*.md',
                },
              ],
            },
          },
          models: {
            providers: {
              openai: {
                baseUrl: 'https://api.openai.com/v1',
                apiKey: '${OPENAI_API_KEY}',
                temperature: 0.3,
                topP: 0.95,
                maxTokens: 12000,
                timeoutMs: 120000,
                streaming: true,
                models: [
                  {
                    id: 'gpt-5.4',
                    name: 'GPT-5.4',
                    contextWindow: 200000,
                    reasoning: true,
                  },
                  {
                    id: 'text-embedding-3-large',
                    name: 'text-embedding-3-large',
                    contextWindow: 8192,
                    api: 'embeddings',
                  },
                ],
              },
            },
          },
          agents: {
            list: [
              {
                id: 'ops',
                name: 'Ops',
                default: true,
                identity: {
                  emoji: 'O',
                },
              },
            ],
          },
        },
      }),
      listModels: async () => [
        {
          provider: 'openai',
          id: 'gpt-5.4',
          label: 'GPT-5.4',
          contextWindow: 200000,
          reasoning: true,
          input: ['text', 'image'],
        },
        {
          provider: 'openai',
          id: 'text-embedding-3-large',
          label: 'text-embedding-3-large',
          contextWindow: 8192,
          api: 'embeddings',
        },
      ],
      getChannelStatus: async () => ({
        channelOrder: ['slack'],
        channelLabels: {
          slack: 'Slack',
        },
        channels: {
          slack: {
            enabled: true,
            configured: true,
            fields: {
              token: true,
              workspace: true,
            },
            accounts: {
              primary: {
                configured: true,
              },
            },
          },
        },
      }),
      getSkillsStatus: async () => ({
        agentId: 'ops',
        skills: [
          {
            id: 'diag-helper',
            name: 'Diagnostics Helper',
            description: 'Troubleshoot runtime incidents.',
            author: 'OpenClaw',
            version: '1.0.0',
            size: '4 KB',
            updatedAt: '2025-03-19T03:00:00.000Z',
            readme: '# Diagnostics Helper',
          },
        ],
      }),
      getToolsCatalog: async () => ({
        agentId: 'ops',
        profiles: [
          {
            id: 'coding',
            label: 'Coding',
          },
        ],
        groups: [
          {
            id: 'group:filesystem',
            label: 'Filesystem',
            source: 'core',
            tools: [
              {
                id: 'read',
                label: 'read',
                description: 'Read files.',
              },
            ],
          },
          {
            id: 'group:automation',
            label: 'Automation',
            source: 'core',
            tools: [
              {
                id: 'cron',
                label: 'cron',
                description: 'Schedule work.',
              },
            ],
          },
        ],
      }),
      listAgents: async () => ({
        requester: 'main',
        agents: [
          {
            id: 'ops',
            name: 'Ops',
            description: 'Automation and incident response agent.',
            avatar: 'O',
            systemPrompt: 'Handle cron tasks and debug incidents.',
            creator: 'OpenClaw',
            workspace: '/workspace/ops',
          },
        ],
      }),
      listAgentFiles: async (_instanceId, args) => ({
        agentId: args.agentId,
        workspace: '/workspace/ops',
        files: [
          {
            name: 'AGENTS.md',
            path: '/workspace/ops/AGENTS.md',
            size: 128,
            updatedAtMs: 1742353200000,
          },
          {
            name: 'MEMORY.md',
            path: '/workspace/ops/MEMORY.md',
            size: 256,
            updatedAtMs: 1742356800000,
          },
        ],
      }),
      getAgentFile: async (_instanceId, args) => ({
        agentId: args.agentId,
        workspace: '/workspace/ops',
        file: {
          name: args.name,
          path: `/workspace/ops/${args.name}`,
          content:
            args.name === 'MEMORY.md'
              ? '# Ops Memory\nIncident note and rollback plan.'
              : '# Ops Agent\nYou handle incidents and automation.',
          size: args.name === 'MEMORY.md' ? 256 : 128,
          updatedAtMs: args.name === 'MEMORY.md' ? 1742356800000 : 1742353200000,
        },
      }),
    },
  });

  const workbench = await service.getInstanceWorkbench('openclaw-prod');

  assert.ok(workbench);
  assert.deepEqual(
    workbench?.channels.slice(0, 6).map((channel) => channel.id),
    ['qqbot', 'feishu', 'imessage', 'irc', 'matrix', 'mattermost'],
  );
  assert.equal(workbench?.channels.find((channel) => channel.id === 'slack')?.status, 'connected');
  assert.equal(workbench?.channels.find((channel) => channel.id === 'telegram')?.status, 'not_configured');
  assert.equal(workbench?.tasks.length, 1);
  assert.equal(workbench?.tasks[0]?.id, 'job-ops-daily');
  assert.equal(workbench?.llmProviders.length, 1);
  assert.equal(workbench?.llmProviders[0]?.defaultModelId, 'gpt-5.4');
  assert.equal(workbench?.llmProviders[0]?.embeddingModelId, 'text-embedding-3-large');
  assert.deepEqual(workbench?.llmProviders[0]?.capabilities, ['chat', 'embedding', 'reasoning', 'vision']);
  assert.equal(workbench?.agents.length, 1);
  assert.equal(workbench?.agents[0]?.agent.id, 'ops');
  assert.equal(workbench?.skills.length, 1);
  assert.equal(workbench?.files.length, 0);
  assert.equal(workbench?.memories.length, 0);
  assert.equal(workbench?.tools.length, 2);
  assert.equal(workbench?.sectionCounts.files, 0);
  assert.equal(workbench?.sectionAvailability.files.status, 'ready');
  assert.equal(workbench?.sectionAvailability.memory.status, 'ready');
});
await runTest('getInstanceWorkbench defers OpenClaw file and memory reads until a section requests them', async () => {
  const getAgentFileCalls: string[] = [];
  let listAgentFilesCalls = 0;
  const service = createInstanceWorkbenchService({
    studioApi: {
      getInstanceDetail: async () =>
        createOpenClawDetail('openclaw-files-lazy', {
          workbench: null,
        }),
    },
    openClawGatewayClient: {
      listWorkbenchCronJobs: async () => [],
      listWorkbenchCronRuns: async () => [],
      getConfig: async () => ({
        config: {
          memory: {
            backend: 'vector',
          },
          models: {
            providers: {},
          },
          agents: {
            list: [
              {
                id: 'ops',
                name: 'Ops',
                default: true,
              },
            ],
          },
        },
      }),
      listModels: async () => [],
      getChannelStatus: async () => ({
        channels: {},
      }),
      getSkillsStatus: async () => ({
        skills: [],
      }),
      getToolsCatalog: async () => ({
        profiles: [],
        groups: [],
      }),
      listAgents: async () => ({
        agents: [
          {
            id: 'ops',
            name: 'Ops',
            description: 'Automation and incident response agent.',
            avatar: 'O',
            systemPrompt: 'Handle incidents and automation.',
            creator: 'OpenClaw',
            workspace: '/workspace/ops',
          },
        ],
      }),
      listAgentFiles: async () => {
        listAgentFilesCalls += 1;
        return {
        workspace: '/workspace/ops',
        files: [
          {
            name: 'AGENTS.md',
            path: '/workspace/ops/AGENTS.md',
            size: 128,
            updatedAtMs: 1742353200000,
          },
          {
            name: 'MEMORY.md',
            path: '/workspace/ops/MEMORY.md',
            size: 256,
            updatedAtMs: 1742356800000,
          },
          {
            name: 'RUNBOOK.md',
            path: '/workspace/ops/RUNBOOK.md',
            size: 512,
            updatedAtMs: 1742358600000,
          },
        ],
      };
      },
      getAgentFile: async (_instanceId, args) => {
        getAgentFileCalls.push(args.name);
        return {
          workspace: '/workspace/ops',
          file: {
            name: args.name,
            path: `/workspace/ops/${args.name}`,
            content: `# ${args.name}\nLoaded on demand.`,
            size: 128,
            updatedAtMs: 1742356800000,
          },
        };
      },
    },
  });

  const workbench = await service.getInstanceWorkbench('openclaw-files-lazy');

  assert.ok(workbench);
  assert.equal(listAgentFilesCalls, 0);
  assert.deepEqual(getAgentFileCalls, []);
  assert.equal(workbench?.files.length, 0);
  assert.equal(workbench?.memories.length, 0);
  assert.equal(workbench?.sectionAvailability.files.status, 'ready');
  assert.equal(workbench?.sectionAvailability.memory.status, 'ready');
});

await runTest('listInstanceFiles loads OpenClaw file catalog on demand after workbench initialization', async () => {
  let listAgentFilesCalls = 0;
  const service = createInstanceWorkbenchService({
    openClawGatewayClient: {
      listAgentFiles: async (_instanceId, args) => {
        listAgentFilesCalls += 1;
        return {
          agentId: args.agentId,
          workspace: `/workspace/${args.agentId}`,
          files: [
            {
              name: 'AGENTS.md',
              path: `/workspace/${args.agentId}/AGENTS.md`,
              size: 128,
              updatedAtMs: 1742353200000,
              content: '# list payload should not become editor body',
            },
            {
              name: 'RUNBOOK.md',
              path: `/workspace/${args.agentId}/RUNBOOK.md`,
              size: 256,
              updatedAtMs: 1742356800000,
              content: '# another list payload',
            },
          ],
        };
      },
      getAgentFile: async () => {
        throw new Error('listInstanceFiles should not eagerly fetch file content');
      },
    },
  });

  const files = await service.listInstanceFiles('openclaw-files-lazy', [
    {
      agent: {
        id: 'ops',
        name: 'Ops',
        description: 'Automation agent',
        avatar: 'O',
        systemPrompt: 'Handle incidents',
        creator: 'OpenClaw',
      },
      focusAreas: ['Operations'],
      automationFitScore: 80,
      workspace: '/workspace/ops',
      configSource: 'runtime',
    },
  ]);

  assert.equal(listAgentFilesCalls, 1);
  assert.equal(files.length, 2);
  assert.equal(files[0]?.content, '');
  assert.equal(files[1]?.content, '');
  assert.ok(files.every((file) => file.id.startsWith('openclaw-agent-file:ops:')));
});

await runTest(
  'listInstanceFiles prefers backend-authored OpenClaw workbench files before gateway fallback',
  async () => {
    let listAgentFilesCalls = 0;
    const service = createInstanceWorkbenchService({
      studioApi: {
        getInstanceDetail: async () =>
          createOpenClawDetail('openclaw-backend-files-authoritative', {
            workbench: {
              channels: [],
              cronTasks: {
                tasks: [],
                taskExecutionsById: {},
              },
              llmProviders: [],
              agents: [
                {
                  agent: {
                    id: 'Ops Team',
                    name: 'Ops Team',
                    description: 'Backend-authored operations agent.',
                    avatar: 'O',
                    systemPrompt: 'Handle operations tasks.',
                    creator: 'OpenClaw',
                  },
                  focusAreas: ['Operations'],
                  automationFitScore: 82,
                },
              ],
              skills: [],
              files: [
                {
                  id: buildOpenClawAgentFileId('Ops Team', 'AGENTS.md'),
                  name: 'AGENTS.md',
                  path: '/workspace/ops-team/AGENTS.md',
                  category: 'prompt',
                  language: 'markdown',
                  size: '1.0 KB',
                  updatedAt: '2026-04-06T00:00:00.000Z',
                  status: 'synced',
                  description: 'Backend-authored agent prompt.',
                  content: '# Backend authoritative file',
                  isReadonly: false,
                },
              ],
              memory: [],
              tools: [],
            },
          }),
      },
      openClawGatewayClient: {
        listAgentFiles: async () => {
          listAgentFilesCalls += 1;
          throw new Error('listInstanceFiles should use backend workbench files first');
        },
      },
    });

    const files = await service.listInstanceFiles('openclaw-backend-files-authoritative', [
      {
        agent: {
          id: 'ops-team',
          name: 'Ops Team',
          description: 'Operations agent',
          avatar: 'O',
          systemPrompt: 'Handle incidents',
          creator: 'OpenClaw',
        },
        focusAreas: ['Operations'],
        automationFitScore: 82,
        workspace: '/workspace/ops-team',
        configSource: 'runtime',
      },
    ]);

    assert.equal(listAgentFilesCalls, 0);
    assert.deepEqual(
      files.map((file) => file.id),
      [buildOpenClawAgentFileId('ops-team', 'AGENTS.md')],
    );
    assert.equal(files[0]?.content, '# Backend authoritative file');
  },
);

await runTest(
  'listInstanceFiles derives unique OpenClaw file ids from relative workspace paths when nested files share a basename',
  async () => {
    const service = createInstanceWorkbenchService({
      openClawGatewayClient: {
        listAgentFiles: async () => ({
          agentId: 'ops',
          workspace: '/workspace/ops',
          files: [
            {
              name: 'README.md',
              path: '/workspace/ops/prompts/README.md',
              size: 128,
              updatedAtMs: 1742353200000,
            },
            {
              name: 'README.md',
              path: '/workspace/ops/runbooks/README.md',
              size: 256,
              updatedAtMs: 1742356800000,
            },
          ],
        }),
        getAgentFile: async () => {
          throw new Error('listInstanceFiles should not eagerly fetch nested file content');
        },
      },
    });

    const files = await service.listInstanceFiles('openclaw-files-nested', [
      {
        agent: {
          id: 'ops',
          name: 'Ops',
          description: 'Automation agent',
          avatar: 'O',
          systemPrompt: 'Handle incidents',
          creator: 'OpenClaw',
        },
        focusAreas: ['Operations'],
        automationFitScore: 80,
        workspace: '/workspace/ops',
        configSource: 'runtime',
      },
    ]);

    assert.deepEqual(
      files.map((file) => file.id),
      [
        buildOpenClawAgentFileId('ops', 'prompts/README.md'),
        buildOpenClawAgentFileId('ops', 'runbooks/README.md'),
      ],
    );
    assert.deepEqual(
      files.map((file) => file.name),
      ['README.md', 'README.md'],
    );
  },
);

await runTest(
  'listInstanceMemories prefers backend-authored OpenClaw workbench memory before gateway fallback',
  async () => {
    let getConfigCalls = 0;
    let getAgentFileCalls = 0;
    let getDoctorMemoryStatusCalls = 0;
    let searchMemoryCalls = 0;
    const service = createInstanceWorkbenchService({
      studioApi: {
        getInstanceDetail: async () =>
          createOpenClawDetail('openclaw-backend-memory-authoritative', {
            workbench: {
              channels: [],
              cronTasks: {
                tasks: [],
                taskExecutionsById: {},
              },
              llmProviders: [],
              agents: [
                {
                  agent: {
                    id: 'Ops Team',
                    name: 'Ops Team',
                    description: 'Backend-authored operations agent.',
                    avatar: 'O',
                    systemPrompt: 'Handle operations tasks.',
                    creator: 'OpenClaw',
                  },
                  focusAreas: ['Operations'],
                  automationFitScore: 82,
                },
              ],
              skills: [],
              files: [],
              memory: [
                {
                  id: 'backend-memory',
                  title: 'Backend Memory',
                  type: 'fact',
                  summary: 'Backend authoritative memory snapshot.',
                  source: 'system',
                  updatedAt: '2026-04-06T00:00:00.000Z',
                  retention: 'rolling',
                  tokens: 16,
                },
              ],
              tools: [],
            },
          }),
      },
      openClawGatewayClient: {
        getConfig: async () => {
          getConfigCalls += 1;
          throw new Error('listInstanceMemories should use backend workbench memory first');
        },
        getAgentFile: async () => {
          getAgentFileCalls += 1;
          throw new Error('listInstanceMemories should not fetch MEMORY.md from gateway');
        },
        getDoctorMemoryStatus: async () => {
          getDoctorMemoryStatusCalls += 1;
          throw new Error('listInstanceMemories should not probe doctor memory status');
        },
        searchMemory: async () => {
          searchMemoryCalls += 1;
          throw new Error('listInstanceMemories should not probe runtime search');
        },
      },
    });

    const memories = await service.listInstanceMemories('openclaw-backend-memory-authoritative', [
      {
        agent: {
          id: 'ops-team',
          name: 'Ops Team',
          description: 'Operations agent',
          avatar: 'O',
          systemPrompt: 'Handle incidents',
          creator: 'OpenClaw',
        },
        focusAreas: ['Operations'],
        automationFitScore: 82,
        workspace: '/workspace/ops-team',
        configSource: 'runtime',
      },
    ]);

    assert.equal(getConfigCalls, 0);
    assert.equal(getAgentFileCalls, 0);
    assert.equal(getDoctorMemoryStatusCalls, 0);
    assert.equal(searchMemoryCalls, 0);
    assert.deepEqual(
      memories.map((entry) => entry.id),
      ['backend-memory'],
    );
    assert.equal(memories[0]?.summary, 'Backend authoritative memory snapshot.');
  },
);

await runTest(
  'listInstanceFiles keeps nested OpenClaw relative paths stable when the gateway returns relative file paths',
  async () => {
    const service = createInstanceWorkbenchService({
      openClawGatewayClient: {
        listAgentFiles: async () => ({
          agentId: 'ops',
          workspace: '/workspace/ops',
          files: [
            {
              name: 'README.md',
              path: 'prompts/README.md',
              size: 128,
              updatedAtMs: 1742353200000,
            },
            {
              name: 'README.md',
              path: 'runbooks/README.md',
              size: 256,
              updatedAtMs: 1742356800000,
            },
          ],
        }),
      },
    });

    const files = await service.listInstanceFiles('openclaw-files-relative', [
      {
        agent: {
          id: 'ops',
          name: 'Ops',
          description: 'Automation agent',
          avatar: 'O',
          systemPrompt: 'Handle incidents',
          creator: 'OpenClaw',
        },
        focusAreas: ['Operations'],
        automationFitScore: 80,
        workspace: '/workspace/ops',
        configSource: 'runtime',
      },
    ]);

    assert.deepEqual(
      files.map((file) => file.id),
      [
        buildOpenClawAgentFileId('ops', 'prompts/README.md'),
        buildOpenClawAgentFileId('ops', 'runbooks/README.md'),
      ],
    );
  },
);

await runTest(
  'listInstanceFiles derives stable nested OpenClaw ids from Windows rooted paths even when drive letters differ by case',
  async () => {
    const service = createInstanceWorkbenchService({
      openClawGatewayClient: {
        listAgentFiles: async () => ({
          agentId: 'ops',
          workspace: 'D:/Workspace/Ops',
          files: [
            {
              name: 'README.md',
              path: 'd:/workspace/ops/prompts/README.md',
              size: 128,
              updatedAtMs: 1742353200000,
            },
            {
              name: 'README.md',
              path: 'd:/workspace/ops/runbooks/README.md',
              size: 256,
              updatedAtMs: 1742356800000,
            },
          ],
        }),
      },
    });

    const files = await service.listInstanceFiles('openclaw-files-windows-case', [
      {
        agent: {
          id: 'ops',
          name: 'Ops',
          description: 'Automation agent',
          avatar: 'O',
          systemPrompt: 'Handle incidents',
          creator: 'OpenClaw',
        },
        focusAreas: ['Operations'],
        automationFitScore: 80,
        workspace: 'D:/Workspace/Ops',
        configSource: 'runtime',
      },
    ]);

    assert.deepEqual(
      files.map((file) => file.id),
      [
        buildOpenClawAgentFileId('ops', 'prompts/README.md'),
        buildOpenClawAgentFileId('ops', 'runbooks/README.md'),
      ],
    );
    assert.deepEqual(
      files.map((file) => file.path),
      [
        'd:/workspace/ops/prompts/README.md',
        'd:/workspace/ops/runbooks/README.md',
      ],
    );
  },
);

await runTest(
  'getInstanceWorkbench queries OpenClaw tools per agent and preserves tool scope metadata',
  async () => {
    const toolCatalogCalls: string[] = [];
    const service = createInstanceWorkbenchService({
      studioApi: {
        getInstanceDetail: async () =>
          createOpenClawDetail('openclaw-tools-scope', {
            workbench: null,
          }),
      },
      openClawGatewayClient: {
        getConfig: async () => ({
          baseHash: 'hash-tools',
          config: {
            agents: {
              list: [
                {
                  id: 'ops',
                  name: 'Ops',
                  default: true,
                },
                {
                  id: 'research',
                  name: 'Research',
                },
              ],
            },
          },
        }),
        listModels: async () => [],
        getChannelStatus: async () => ({
          channelOrder: [],
          channelLabels: {},
          channels: {},
        }),
        getSkillsStatus: async () => ({
          skills: [],
        }),
        getToolsCatalog: async (_instanceId, args = {}) => {
          const agentId = typeof args.agentId === 'string' ? args.agentId : 'default';
          toolCatalogCalls.push(agentId);

          if (agentId === 'ops') {
            return {
              agentId: 'ops',
              profiles: [],
              groups: [
                {
                  id: 'group:automation',
                  label: 'Automation',
                  source: 'core',
                  tools: [
                    {
                      id: 'cron',
                      label: 'cron',
                      description: 'Schedule work.',
                    },
                  ],
                },
              ],
            };
          }

          if (agentId === 'research') {
            return {
              agentId: 'research',
              profiles: [],
              groups: [
                {
                  id: 'group:automation',
                  label: 'Automation',
                  source: 'core',
                  tools: [
                    {
                      id: 'cron',
                      label: 'cron',
                      description: 'Schedule work.',
                    },
                  ],
                },
                {
                  id: 'group:reasoning',
                  label: 'Reasoning',
                  source: 'core',
                  tools: [
                    {
                      id: 'web.search',
                      label: 'web.search',
                      description: 'Search the web.',
                    },
                  ],
                },
              ],
            };
          }

          return {
            agentId: 'default',
            profiles: [],
            groups: [
              {
                id: 'group:filesystem',
                label: 'Filesystem',
                source: 'core',
                tools: [
                  {
                    id: 'read',
                    label: 'read',
                    description: 'Read files.',
                  },
                ],
              },
            ],
          };
        },
        listAgents: async () => ({
          requester: 'ops',
          agents: [
            {
              id: 'ops',
              name: 'Ops',
              description: 'Automation agent.',
              avatar: 'O',
              systemPrompt: 'Handle cron tasks.',
              creator: 'OpenClaw',
              workspace: '/workspace/ops',
            },
            {
              id: 'research',
              name: 'Research',
              description: 'Research agent.',
              avatar: 'R',
              systemPrompt: 'Handle research tasks.',
              creator: 'OpenClaw',
              workspace: '/workspace/research',
            },
          ],
        }),
        listWorkbenchCronJobs: async () => [],
        listWorkbenchCronRuns: async () => [],
        listAgentFiles: async (_instanceId, args) => ({
          agentId: args.agentId,
          workspace: `/workspace/${args.agentId}`,
          files: [],
        }),
        getAgentFile: async (_instanceId, args) => ({
          agentId: args.agentId,
          workspace: `/workspace/${args.agentId}`,
          file: {
            name: args.name,
            path: `/workspace/${args.agentId}/${args.name}`,
            missing: true,
          },
        }),
      },
    });

    const workbench = await service.getInstanceWorkbench('openclaw-tools-scope');

    assert.deepEqual(toolCatalogCalls, ['ops', 'research']);
    assert.deepEqual(
      workbench?.tools.map((tool) => tool.id),
      ['cron', 'web.search'],
    );
    assert.deepEqual(
      workbench?.tools.find((tool) => tool.id === 'cron')?.agentIds,
      ['ops', 'research'],
    );
    assert.deepEqual(
      workbench?.tools.find((tool) => tool.id === 'cron')?.agentNames,
      ['Ops', 'Research'],
    );
    assert.deepEqual(
      workbench?.tools.find((tool) => tool.id === 'web.search')?.agentIds,
      ['research'],
    );
  },
);

await runTest(
  'getInstanceWorkbench normalizes OpenClaw agent ids when config fallback is used for live agents',
  async () => {
    const toolCatalogCalls: string[] = [];
    const service = createInstanceWorkbenchService({
      studioApi: {
        getInstanceDetail: async () =>
          createOpenClawDetail('openclaw-agent-id-normalization', {
            workbench: null,
          }),
      },
      openClawGatewayClient: {
        getConfig: async () => ({
          baseHash: 'hash-agent-id-normalization',
          config: {
            agents: {
              list: [
                {
                  id: 'Research Team',
                  name: 'Research Team',
                  default: true,
                  identity: {
                    emoji: 'R',
                  },
                },
              ],
            },
          },
        }),
        listModels: async () => [],
        getChannelStatus: async () => ({
          channelOrder: [],
          channelLabels: {},
          channels: {},
        }),
        getSkillsStatus: async () => ({
          skills: [],
        }),
        getToolsCatalog: async (_instanceId, args = {}) => {
          toolCatalogCalls.push(String(args.agentId || ''));
          return {
            agentId: String(args.agentId || ''),
            profiles: [],
            groups: [
              {
                id: 'group:reasoning',
                label: 'Reasoning',
                source: 'core',
                tools: [
                  {
                    id: 'web.search',
                    label: 'web.search',
                    description: 'Search the web.',
                  },
                ],
              },
            ],
          };
        },
        listAgents: async () => {
          throw new Error('agents endpoint unavailable');
        },
        listWorkbenchCronJobs: async () => [],
        listWorkbenchCronRuns: async () => [],
        listAgentFiles: async (_instanceId, args) => ({
          agentId: args.agentId,
          workspace: `/workspace/${args.agentId}`,
          files: [],
        }),
        getAgentFile: async (_instanceId, args) => ({
          agentId: args.agentId,
          workspace: `/workspace/${args.agentId}`,
          file: {
            name: args.name,
            path: `/workspace/${args.agentId}/${args.name}`,
            missing: true,
          },
        }),
      },
    });

    const workbench = await service.getInstanceWorkbench('openclaw-agent-id-normalization');

    assert.deepEqual(
      workbench?.agents.map((agent) => [agent.agent.id, agent.agent.name]),
      [['research-team', 'Research Team']],
    );
    assert.deepEqual(toolCatalogCalls, ['research-team']);
    assert.deepEqual(
      workbench?.tools.find((tool) => tool.id === 'web.search')?.agentIds,
      ['research-team'],
    );
  },
);

await runTest(
  'getInstanceWorkbench normalizes raw agent ids from backend OpenClaw workbench snapshots',
  async () => {
    const service = createInstanceWorkbenchService({
      studioApi: {
        getInstanceDetail: async () =>
          createOpenClawDetail('openclaw-backend-raw-agent', {
            workbench: {
              channels: [],
              cronTasks: {
                tasks: [
                  {
                    id: 'task-research',
                    name: 'Research Digest',
                    description: 'Research digest',
                    prompt: 'Digest',
                    schedule: '0 9 * * *',
                    scheduleMode: 'cron',
                    scheduleConfig: {
                      cronExpression: '0 9 * * *',
                    },
                    cronExpression: '0 9 * * *',
                    actionType: 'skill',
                    status: 'active',
                    sessionMode: 'isolated',
                    wakeUpMode: 'immediate',
                    executionContent: 'runAssistantTask',
                    deliveryMode: 'publishSummary',
                    agentId: 'Research Team',
                    latestExecution: null,
                  },
                ],
                taskExecutionsById: {},
              },
              llmProviders: [],
              agents: [
                {
                  agent: {
                    id: 'Research Team',
                    name: 'Research Team',
                    description: 'Research agent.',
                    avatar: 'R',
                    systemPrompt: 'Handle research tasks.',
                    creator: 'OpenClaw',
                  },
                  focusAreas: ['Research'],
                  automationFitScore: 88,
                },
              ],
              skills: [],
              files: [],
              memory: [],
              tools: [],
            },
          }),
      },
      openClawGatewayClient: {
        getConfig: async () => ({
          config: {},
        }),
        listModels: async () => [],
        getChannelStatus: async () => ({
          channelOrder: [],
          channelLabels: {},
          channels: {},
        }),
        getSkillsStatus: async () => ({
          skills: [],
        }),
        getToolsCatalog: async () => ({
          profiles: [],
          groups: [],
        }),
        listAgents: async () => ({
          agents: [],
        }),
        listAgentFiles: async () => ({
          files: [],
        }),
        getAgentFile: async () => ({
          file: undefined,
        }),
        listWorkbenchCronJobs: async () => [],
        listWorkbenchCronRuns: async () => [],
      },
    });

    const workbench = await service.getInstanceWorkbench('openclaw-backend-raw-agent');

    assert.deepEqual(
      workbench?.agents.map((agent) => agent.agent.id),
      ['research-team'],
    );
    assert.deepEqual(
      workbench?.tasks.map((task) => task.agentId),
      ['research-team'],
    );
  },
);

await runTest(
  'getInstanceWorkbench normalizes backend-authored OpenClaw file ids alongside normalized agent ids',
  async () => {
    const service = createInstanceWorkbenchService({
      studioApi: {
        getInstanceDetail: async () =>
          createOpenClawDetail('openclaw-backend-raw-file-agent', {
            workbench: {
              channels: [],
              cronTasks: {
                tasks: [],
                taskExecutionsById: {},
              },
              llmProviders: [],
              agents: [
                {
                  agent: {
                    id: 'Research Team',
                    name: 'Research Team',
                    description: 'Research agent.',
                    avatar: 'R',
                    systemPrompt: 'Handle research tasks.',
                    creator: 'OpenClaw',
                  },
                  focusAreas: ['Research'],
                  automationFitScore: 88,
                },
              ],
              skills: [],
              files: [
                {
                  id: buildOpenClawAgentFileId('Research Team', 'AGENTS.md'),
                  name: 'AGENTS.md',
                  path: 'C:/OpenClaw/.openclaw/workspace-research/AGENTS.md',
                  category: 'prompt',
                  language: 'markdown',
                  size: '1 KB',
                  updatedAt: '2026-03-23T00:00:00.000Z',
                  status: 'synced',
                  description: 'Research agent prompt',
                  content: '# Research agent',
                  isReadonly: false,
                },
              ],
              memory: [],
              tools: [],
            },
          }),
      },
      openClawGatewayClient: {
        getConfig: async () => ({
          config: {},
        }),
        listModels: async () => [],
        getChannelStatus: async () => ({
          channelOrder: [],
          channelLabels: {},
          channels: {},
        }),
        getSkillsStatus: async () => ({
          skills: [],
        }),
        getToolsCatalog: async () => ({
          profiles: [],
          groups: [],
        }),
        listAgents: async () => ({
          agents: [],
        }),
        listAgentFiles: async () => ({
          files: [],
        }),
        getAgentFile: async () => ({
          file: undefined,
        }),
        listWorkbenchCronJobs: async () => [],
        listWorkbenchCronRuns: async () => [],
      },
    });

    const workbench = await service.getInstanceWorkbench('openclaw-backend-raw-file-agent');

    assert.deepEqual(
      workbench?.agents.map((agent) => agent.agent.id),
      ['research-team'],
    );
    assert.deepEqual(
      workbench?.files.map((file) => file.id),
      [buildOpenClawAgentFileId('research-team', 'AGENTS.md')],
    );
  },
);

await runTest('listInstanceMemories loads OpenClaw memory entries on demand after workbench initialization', async () => {
  const getAgentFileCalls: string[] = [];
  let getConfigCalls = 0;
  const service = createInstanceWorkbenchService({
    openClawGatewayClient: {
      getConfig: async () => {
        getConfigCalls += 1;
        return {
          config: {
            memory: {
              backend: 'builtin',
              citations: 'auto',
            },
          },
        };
      },
      getAgentFile: async (_instanceId, args) => {
        getAgentFileCalls.push(args.name);
        return {
          workspace: '/workspace/ops',
          file: {
            name: args.name,
            path: `/workspace/ops/${args.name}`,
            content: '# MEMORY.md\nOps runbook memory content.',
            size: 256,
            updatedAtMs: 1742356800000,
          },
        };
      },
    },
  });

  const memories = await service.listInstanceMemories('openclaw-files-lazy', [
    {
      agent: {
        id: 'ops',
        name: 'Ops',
        description: 'Automation agent',
        avatar: 'O',
        systemPrompt: 'Handle incidents',
        creator: 'OpenClaw',
      },
      focusAreas: ['Operations'],
      automationFitScore: 80,
      workspace: '/workspace/ops',
      configSource: 'runtime',
    },
  ]);

  assert.equal(getConfigCalls, 1);
  assert.deepEqual(getAgentFileCalls, ['MEMORY.md']);
  assert.equal(memories.some((entry) => entry.title === 'Memory Backend'), true);
  assert.equal(memories.some((entry) => entry.title === 'Ops Memory'), true);
});

await runTest('listInstanceMemories prefers OpenClaw runtime memory hits and status when gateway memory runtime is available', async () => {
  const searchMemoryCalls: Array<Record<string, unknown>> = [];
  let getDoctorMemoryStatusCalls = 0;
  const service = createInstanceWorkbenchService({
    openClawGatewayClient: {
      getConfig: async () => ({
        config: {
          memory: {
            backend: 'builtin',
            citations: 'auto',
          },
        },
      }),
      getDoctorMemoryStatus: async () => {
        getDoctorMemoryStatusCalls += 1;
        return {
          agentId: 'ops',
          provider: 'openai',
          embedding: {
            ok: true,
          },
        };
      },
      searchMemory: async (_instanceId, args) => {
        searchMemoryCalls.push(args as Record<string, unknown>);
        return {
          results: [
            {
              path: 'memory/runbooks/deploy.md',
              score: 0.91,
              text: 'Deployment uses canary rollout to reduce blast radius.',
              from: 12,
              to: 18,
            },
            {
              path: 'MEMORY.md',
              score: 0.78,
              snippet: 'Release checklist owner is Ops.',
              lineStart: 3,
              lineEnd: 5,
            },
          ],
        };
      },
      getAgentFile: async (_instanceId, args) => ({
        workspace: '/workspace/ops',
        file: {
          name: args.name,
          path: `/workspace/ops/${args.name}`,
          content: '# MEMORY.md\nLegacy fallback summary.',
          size: 256,
          updatedAtMs: 1742356800000,
        },
      }),
    },
  });

  const memories = await service.listInstanceMemories('openclaw-runtime-memory', [
    {
      agent: {
        id: 'ops',
        name: 'Ops',
        description: 'Automation agent',
        avatar: 'O',
        systemPrompt: 'Handle incidents',
        creator: 'OpenClaw',
      },
      focusAreas: ['Operations'],
      automationFitScore: 80,
      workspace: '/workspace/ops',
      configSource: 'runtime',
    },
  ]);

  assert.equal(getDoctorMemoryStatusCalls, 1);
  assert.equal(searchMemoryCalls.length, 1);
  assert.equal(memories[0]?.title, 'Memory Runtime');
  assert.equal(memories.some((entry) => entry.title === 'Memory Backend'), false);
  assert.equal(memories.some((entry) => entry.summary.includes('Provider=openai')), true);
  assert.equal(
    memories.some((entry) => entry.summary.includes('Deployment uses canary rollout')),
    true,
  );
  assert.equal(
    memories.some((entry) => entry.summary.includes('memory/runbooks/deploy.md')),
    true,
  );
});

await runTest('listInstanceMemories includes Dream Diary and dreaming cadence when the latest OpenClaw runtime exposes dreaming surfaces', async () => {
  let getDoctorMemoryStatusCalls = 0;
  let getDoctorMemoryDreamDiaryCalls = 0;
  const service = createInstanceWorkbenchService({
    openClawGatewayClient: {
      getConfig: async () => ({
        config: {
          plugins: {
            entries: {
              'memory-core': {
                config: {
                  dreaming: {
                    enabled: true,
                    frequency: '0 3 * * *',
                  },
                },
              },
            },
          },
        },
      }),
      getDoctorMemoryStatus: async () => {
        getDoctorMemoryStatusCalls += 1;
        return {
          agentId: 'ops',
          provider: 'openai',
          embedding: {
            ok: true,
          },
          dreaming: {
            enabled: true,
            frequency: '0 3 * * *',
            lastRunAt: '2026-04-07T03:00:00.000Z',
          },
        };
      },
      getDoctorMemoryDreamDiary: async () => {
        getDoctorMemoryDreamDiaryCalls += 1;
        return {
          path: 'dreams.md',
          content:
            '# Dream Diary\n\n## 2026-04-07\nConsolidated deployment runbooks into a single operator playbook.',
          updatedAt: '2026-04-07T03:05:00.000Z',
        };
      },
      searchMemory: async () => ({
        results: [],
      }),
      getAgentFile: async () => ({
        file: undefined,
      }),
    },
  });

  const memories = await service.listInstanceMemories('openclaw-dreaming-runtime', [
    {
      agent: {
        id: 'ops',
        name: 'Ops',
        description: 'Automation agent',
        avatar: 'O',
        systemPrompt: 'Handle incidents',
        creator: 'OpenClaw',
      },
      focusAreas: ['Operations'],
      automationFitScore: 80,
      workspace: '/workspace/ops',
      configSource: 'runtime',
    },
  ]);

  assert.equal(getDoctorMemoryStatusCalls, 1);
  assert.equal(getDoctorMemoryDreamDiaryCalls, 1);
  assert.equal(memories.some((entry) => entry.title === 'Dream Diary'), true);
  assert.equal(memories.some((entry) => entry.summary.includes('Consolidated deployment runbooks')), true);
  assert.equal(memories.some((entry) => entry.summary.includes('Frequency=0 3 * * *')), true);
});

await runTest('getInstanceWorkbench keeps Provider Center managed llmProviders authoritative while overlaying other live OpenClaw sections', async () => {
  const configFilePath = 'D:/OpenClaw/.openclaw/openclaw.json';
  const originalReadConfigSnapshot =
    openClawConfigDocumentApi.readConfigSnapshot.bind(openClawConfigDocumentApi);

  openClawConfigDocumentApi.readConfigSnapshot = async (_configPath: string) =>
    createConfigSnapshot(configFilePath, {
      providerSnapshots: [
      {
        id: 'sdkwork-local-proxy',
        providerKey: 'sdkwork-local-proxy',
        name: 'SDKWork Local Proxy',
        provider: 'sdkwork-local-proxy',
        endpoint: 'http://127.0.0.1:21280/v1',
        apiKeySource: 'sk_sdkwork_api_key',
        status: 'ready',
        defaultModelId: 'gpt-5.4',
        reasoningModelId: 'gpt-5.4',
        embeddingModelId: 'text-embedding-3-large',
        description: 'Managed local proxy projection.',
        icon: 'S',
        lastCheckedAt: '2026-04-02T00:00:00.000Z',
        capabilities: ['chat', 'embedding', 'reasoning'],
        models: [
          {
            id: 'gpt-5.4',
            name: 'GPT-5.4',
            role: 'primary',
            contextWindow: '200K',
          },
          {
            id: 'text-embedding-3-large',
            name: 'Text Embedding 3 Large',
            role: 'embedding',
            contextWindow: '8K',
          },
        ],
        config: {
          temperature: 0.2,
          topP: 1,
          maxTokens: 8192,
          timeoutMs: 60000,
          streaming: true,
        },
      },
      ],
    });

  try {
    const service = createInstanceWorkbenchService({
      studioApi: {
        getInstanceDetail: async () => ({
          ...createBuiltInOpenClawDetail(),
          dataAccess: {
            routes: [
              {
                id: 'config',
                label: 'Configuration',
                scope: 'config',
                mode: 'managedFile',
                status: 'ready',
                target: configFilePath,
                readonly: false,
                authoritative: true,
                detail: 'OpenClaw config file is writable.',
                source: 'integration',
              },
            ],
          },
        }),
      },
      openClawGatewayClient: {
        listWorkbenchCronJobs: async () => [createLiveTask('live-task-1')],
        listWorkbenchCronRuns: async () => [],
        getConfig: async () => ({
          config: {
            models: {
              providers: {
                openai: {
                  baseUrl: 'https://api.openai.com/v1',
                  apiKey: '${OPENAI_API_KEY}',
                  models: [
                    {
                      id: 'gpt-5.4',
                      name: 'GPT-5.4',
                      contextWindow: 200000,
                      reasoning: true,
                    },
                  ],
                },
              },
            },
            agents: {
              list: [
                {
                  id: 'ops',
                  name: 'Ops',
                  default: true,
                },
              ],
            },
          },
        }),
        listModels: async () => [
          {
            provider: 'openai',
            id: 'gpt-5.4',
            label: 'GPT-5.4',
            contextWindow: 200000,
            reasoning: true,
          },
        ],
        getChannelStatus: async () => ({
          channelOrder: ['slack'],
          channelLabels: {
            slack: 'Slack',
          },
          channels: {
            slack: {
              enabled: true,
              configured: true,
              fields: {
                token: true,
              },
            },
          },
        }),
        getSkillsStatus: async () => ({
          skills: [
            {
              id: 'diag-helper',
              name: 'Diagnostics Helper',
              description: 'Troubleshoot runtime incidents.',
            },
          ],
        }),
        getToolsCatalog: async () => ({
          profiles: [],
          groups: [
            {
              id: 'group:automation',
              label: 'Automation',
              source: 'core',
              tools: [
                {
                  id: 'cron',
                  label: 'cron',
                  description: 'Schedule work.',
                },
              ],
            },
          ],
        }),
        listAgents: async () => ({
          agents: [
            {
              id: 'ops',
              name: 'Ops',
              description: 'Automation and incident response agent.',
              avatar: 'O',
              systemPrompt: 'Handle cron tasks and debug incidents.',
              creator: 'OpenClaw',
              workspace: '/workspace/ops',
            },
          ],
        }),
        listAgentFiles: async () => ({
          files: [],
        }),
        getAgentFile: async () => ({
          file: undefined,
        }),
      },
    });

    const workbench = await service.getInstanceWorkbench(BUILT_IN_INSTANCE_ID);

    assert.ok(workbench);
    assert.deepEqual(
      workbench?.channels.slice(0, 6).map((channel) => channel.id),
      ['qqbot', 'feishu', 'imessage', 'irc', 'matrix', 'mattermost'],
    );
    assert.equal(workbench?.channels.some((channel) => channel.id === 'telegram'), true);
    assert.equal(workbench?.channels.some((channel) => channel.id === 'old-channel'), true);
    assert.equal(workbench?.tasks[0]?.id, 'live-task-1');
    assert.equal(workbench?.llmProviders[0]?.id, 'sdkwork-local-proxy');
    assert.equal(workbench?.llmProviders[0]?.endpoint, 'http://127.0.0.1:21280/v1');
    assert.equal(workbench?.agents[0]?.agent.id, 'ops');
    assert.equal(workbench?.skills[0]?.id, 'diag-helper');
    assert.equal(workbench?.tools[0]?.id, 'cron');
    assert.equal(workbench?.files[0]?.id, '/workspace/main/AGENTS.md');
    assert.equal(workbench?.memories[0]?.id, 'backend-memory');
  } finally {
    openClawConfigDocumentApi.readConfigSnapshot = originalReadConfigSnapshot;
  }
});

await runTest(
  'getInstanceWorkbench does not attach a config path for metadata-only config access even when a config artifact is present',
  async () => {
    let readConfigSnapshotCalls = 0;
    const service = createInstanceWorkbenchService({
      studioApi: {
        getInstanceDetail: async () =>
          createOpenClawDetail('metadata-only-openclaw', {
            instance: {
              ...createOpenClawDetail('metadata-only-openclaw').instance,
              deploymentMode: 'remote',
            },
            lifecycle: {
              ...createOpenClawDetail('metadata-only-openclaw').lifecycle,
              configWritable: false,
              workbenchManaged: false,
              endpointObserved: false,
              lifecycleControllable: false,
            },
            dataAccess: {
              routes: [
                {
                  id: 'config',
                  label: 'Configuration',
                  scope: 'config',
                  mode: 'metadataOnly',
                  status: 'ready',
                  target: 'studio.instances registry metadata',
                  readonly: false,
                  authoritative: false,
                  detail: 'Metadata projection only.',
                  source: 'integration',
                },
              ],
            },
            artifacts: [
              {
                id: 'config-file',
                label: 'Config File',
                kind: 'configFile',
                status: 'available',
                location: 'D:/Shadow/.openclaw/openclaw.json',
                readonly: false,
                detail: 'Artifact path should not override metadata-only config access.',
                source: 'config',
              },
            ],
          }),
      },
      openClawConfigDocumentApi: {
        ...openClawConfigDocumentApi,
        readConfigSnapshot: async (configPath: string) => {
          readConfigSnapshotCalls += 1;
          return createConfigSnapshot(configPath);
        },
      },
    });

    const workbench = await service.getInstanceWorkbench('metadata-only-openclaw');

    assert.equal(workbench?.kernelConfig, null);
    assert.equal('managedConfigPath' in (workbench || {}), false);
    assert.equal(readConfigSnapshotCalls, 0);
  },
);

await runTest('getInstanceWorkbench keeps config channel editing metadata when OpenClaw is sourced from live gateway sections', async () => {
  const configFilePath = 'D:/OpenClaw/.openclaw/openclaw.json';
  const configChannelSnapshots = createConfigChannelSnapshots();
  const originalReadConfigSnapshot =
    openClawConfigDocumentApi.readConfigSnapshot.bind(openClawConfigDocumentApi);

  openClawConfigDocumentApi.readConfigSnapshot = async (_configPath: string) =>
    createConfigSnapshot(configFilePath, {
      channelSnapshots: configChannelSnapshots,
      webSearchConfig: {
      enabled: true,
      provider: 'searxng',
      maxResults: 10,
      timeoutSeconds: 45,
      cacheTtlMinutes: 20,
      providers: [
        {
          id: 'searxng',
          name: 'SearXNG',
          description: 'Self-hosted search.',
          apiKeySource: '',
          baseUrl: 'http://127.0.0.1:8080',
          model: '',
          advancedConfig: '{\n  "language": "zh-CN"\n}',
          supportsApiKey: false,
          supportsBaseUrl: true,
          supportsModel: false,
        },
      ],
      },
      xSearchConfig: {
      enabled: true,
      apiKeySource: 'xai-live',
      model: 'grok-4-1-fast-non-reasoning',
      inlineCitations: false,
      maxTurns: 3,
      timeoutSeconds: 45,
      cacheTtlMinutes: 18,
      advancedConfig: '{\n  "userTag": "internal-research"\n}',
      },
      webFetchConfig: {
      enabled: true,
      maxChars: 42000,
      maxCharsCap: 64000,
      maxResponseBytes: 2500000,
      timeoutSeconds: 28,
      cacheTtlMinutes: 9,
      maxRedirects: 4,
      readability: false,
      userAgent: 'SDKWork Fetch Bot/1.0',
      fallbackProvider: {
        providerId: 'firecrawl',
        name: 'Firecrawl Fetch',
        description: 'Use Firecrawl as the OpenClaw web_fetch fallback provider.',
        apiKeySource: 'fc-live',
        baseUrl: 'https://api.firecrawl.dev',
        advancedConfig: '{\n  "onlyMainContent": true\n}',
        supportsApiKey: true,
        supportsBaseUrl: true,
      },
      },
      webSearchNativeCodexConfig: {
      enabled: true,
      mode: 'cached',
      allowedDomains: ['example.com', 'openai.com'],
      contextSize: 'high',
      userLocation: {
        country: 'US',
        city: 'New York',
        timezone: 'America/New_York',
      },
      advancedConfig: '{\n  "reasoningEffort": "medium"\n}',
      },
      authCooldownsConfig: {
      rateLimitedProfileRotations: 2,
      overloadedProfileRotations: 1,
      overloadedBackoffMs: 45000,
      billingBackoffHours: 5,
      billingMaxHours: 24,
      failureWindowHours: 24,
      },
      dreamingConfig: {
      enabled: true,
      frequency: '0 3 * * *',
      },
    });

  try {
    const service = createInstanceWorkbenchService({
      studioApi: {
        getInstanceDetail: async () =>
          createOpenClawDetail('managed-live', {
            workbench: null,
            dataAccess: {
              routes: [
                createConfigRoute(configFilePath),
              ],
            },
          }),
      },
      openClawGatewayClient: {
        listWorkbenchCronJobs: async () => [createLiveTask('live-task-managed')],
        listWorkbenchCronRuns: async () => [],
        getConfig: async () => ({
          config: {
            models: {
              providers: {},
            },
          },
        }),
        listModels: async () => [],
        getChannelStatus: async () => ({
          channelOrder: ['slack'],
          channelLabels: {
            slack: 'Slack',
          },
          channels: {
            slack: {
              enabled: true,
              configured: true,
              fields: {
                token: true,
              },
            },
          },
        }),
        getSkillsStatus: async () => ({
          skills: [],
        }),
        getToolsCatalog: async () => ({
          profiles: [],
          groups: [],
        }),
        listAgents: async () => ({
          agents: [],
        }),
        listAgentFiles: async () => ({
          files: [],
        }),
        getAgentFile: async () => ({
          file: undefined,
        }),
      },
    });

    const workbench = await service.getInstanceWorkbench('managed-live');

    assert.ok(workbench);
    assert.equal(workbench?.sectionCounts.config, 1);
    assert.equal(workbench?.sectionAvailability.config.status, 'ready');
    assert.deepEqual(workbench?.kernelConfig, {
      kernelId: 'openclaw',
      runtimeKind: 'openclaw',
      configFile: configFilePath,
      configRoot: 'D:/OpenClaw/.openclaw',
      stateRoot: 'D:/OpenClaw/.openclaw',
      userRoot: 'D:/OpenClaw',
      standardStateRoot: 'D:/OpenClaw/.openclaw',
      standardConfigFile: configFilePath,
      format: 'json',
      access: 'localFs',
      provenance: 'standardUserRoot',
      writable: true,
      resolved: true,
      schemaVersion: null,
      isStandardUserRootLayout: true,
    });
    assert.equal('managedConfigPath' in (workbench || {}), false);
    assert.equal(workbench?.configChannels?.some((channel) => channel.id === 'telegram'), true);
    assert.equal(workbench?.configChannels?.some((channel) => channel.id === 'signal'), true);
    assert.equal(workbench?.configWebSearch?.provider, 'searxng');
    assert.equal(workbench?.configWebSearch?.providers[0]?.baseUrl, 'http://127.0.0.1:8080');
    assert.equal(workbench?.configXSearch?.apiKeySource, 'xai-live');
    assert.equal(workbench?.configXSearch?.model, 'grok-4-1-fast-non-reasoning');
    assert.equal(workbench?.configWebSearchNativeCodex?.mode, 'cached');
    assert.equal(
      workbench?.configWebSearchNativeCodex?.userLocation.timezone,
      'America/New_York',
    );
    assert.equal(workbench?.configWebFetch?.fallbackProvider.providerId, 'firecrawl');
    assert.equal(workbench?.configWebFetch?.fallbackProvider.baseUrl, 'https://api.firecrawl.dev');
    assert.equal(workbench?.configAuthCooldowns?.rateLimitedProfileRotations, 2);
    assert.equal(workbench?.configAuthCooldowns?.overloadedBackoffMs, 45000);
    assert.equal(workbench?.configDreaming?.enabled, true);
    assert.equal(workbench?.configDreaming?.frequency, '0 3 * * *');
    assert.equal(workbench?.channels.find((channel) => channel.id === 'slack')?.status, 'connected');
    assert.equal(workbench?.channels.find((channel) => channel.id === 'telegram')?.status, 'not_configured');
  } finally {
    openClawConfigDocumentApi.readConfigSnapshot = originalReadConfigSnapshot;
  }
});

await runTest(
  'getInstanceWorkbench does not probe the live gateway when the OpenClaw instance is offline',
  async () => {
    const gatewayCalls: string[] = [];
    const service = createInstanceWorkbenchService({
      studioApi: {
        getInstanceDetail: async () =>
          createOpenClawDetail('offline-openclaw', {
            instance: {
              ...createOpenClawDetail('offline-openclaw').instance,
              status: 'offline',
              deploymentMode: 'local-managed',
              isBuiltIn: true,
              isDefault: true,
              host: '127.0.0.1',
            },
            lifecycle: {
              ...createOpenClawDetail('offline-openclaw').lifecycle,
              configWritable: true,
              workbenchManaged: true,
              endpointObserved: false,
              lifecycleControllable: false,
            },
            workbench: null,
          }),
      },
      openClawGatewayClient: {
        getConfig: async () => {
          gatewayCalls.push('getConfig');
          throw new Error('gateway should stay idle while offline');
        },
        listModels: async () => {
          gatewayCalls.push('listModels');
          throw new Error('gateway should stay idle while offline');
        },
        getChannelStatus: async () => {
          gatewayCalls.push('getChannelStatus');
          throw new Error('gateway should stay idle while offline');
        },
        getSkillsStatus: async () => {
          gatewayCalls.push('getSkillsStatus');
          throw new Error('gateway should stay idle while offline');
        },
        getToolsCatalog: async () => {
          gatewayCalls.push('getToolsCatalog');
          throw new Error('gateway should stay idle while offline');
        },
        listAgents: async () => {
          gatewayCalls.push('listAgents');
          throw new Error('gateway should stay idle while offline');
        },
        listAgentFiles: async () => ({ files: [] }),
        getAgentFile: async () => ({ file: undefined }),
      },
    });

    const workbench = await service.getInstanceWorkbench('offline-openclaw');

    assert.ok(workbench);
    assert.deepEqual(gatewayCalls, []);
    assert.equal(workbench?.instance.status, 'offline');
  },
);

await runTest(
  'getInstanceWorkbench hides config access when the attached config file is missing and the OpenClaw gateway is offline',
  async () => {
    let readConfigSnapshotCalls = 0;

    const service = createInstanceWorkbenchService({
      studioApi: {
        getInstanceDetail: async () =>
          createOpenClawDetail('offline-missing-config-openclaw', {
            instance: {
              ...createOpenClawDetail('offline-missing-config-openclaw').instance,
              deploymentMode: 'local-external',
              status: 'offline',
            },
            lifecycle: {
              ...createOpenClawDetail('offline-missing-config-openclaw').lifecycle,
              configWritable: false,
            },
            dataAccess: {
              routes: [
                createConfigRoute('D:/Missing/.openclaw/openclaw.json', {
                  readonly: true,
                  detail: 'OpenClaw config file is readable.',
                }),
              ],
            },
            workbench: null,
          }),
      },
      openClawConfigDocumentApi: {
        getConfigDocumentPathInfo: async (configPath: string) => ({
          path: configPath,
          name: 'openclaw.json',
          kind: 'missing' as const,
          size: null,
          extension: '.json',
          exists: false,
          lastModifiedMs: null,
        }),
        readConfigSnapshot: async (configPath: string) => {
          readConfigSnapshotCalls += 1;
          return createConfigSnapshot(configPath);
        },
      },
    });

    const workbench = await service.getInstanceWorkbench('offline-missing-config-openclaw');

    assert.equal(workbench?.kernelConfig, null);
    assert.equal('managedConfigPath' in (workbench || {}), false);
    assert.equal(workbench?.sectionCounts.config, 0);
    assert.equal(workbench?.sectionAvailability.config.status, 'planned');
    assert.equal(readConfigSnapshotCalls, 0);
  },
);

await runTest(
  'getInstanceWorkbench keeps config-backed agent default params visible as inherited sources in workbench agents',
  async () => {
    const configFilePath = 'D:/OpenClaw/.openclaw/openclaw.json';
    const originalReadConfigSnapshot =
      openClawConfigDocumentApi.readConfigSnapshot.bind(openClawConfigDocumentApi);

    openClawConfigDocumentApi.readConfigSnapshot = async (_configPath: string) =>
      createConfigSnapshot(configFilePath, {
        agentSnapshots: [
        {
          id: 'ops',
          name: 'Ops',
          avatar: 'O',
          description: 'Ops agent backed by config.',
          workspace: 'D:/OpenClaw/.openclaw/workspace',
          agentDir: 'D:/OpenClaw/.openclaw/agents/ops/agent',
          isDefault: true,
          model: {
            primary: 'openai/gpt-5.4',
            fallbacks: [],
          },
          params: {
            temperature: 0.4,
            streaming: false,
            timeoutMs: 90000,
          },
          paramSources: {
            temperature: 'agent',
            streaming: 'defaults',
            timeoutMs: 'defaults',
          },
        },
        ],
      });

    try {
      const service = createInstanceWorkbenchService({
        studioApi: {
          getInstanceDetail: async () =>
            createOpenClawDetail('managed-agent-default-params', {
              workbench: null,
              dataAccess: {
                routes: [
                  createConfigRoute(configFilePath),
                ],
              },
            }),
        },
        openClawGatewayClient: {
          getConfig: async () => ({
            config: {
              models: {
                providers: {},
              },
            },
          }),
          listModels: async () => [],
          getChannelStatus: async () => ({
            channels: {},
          }),
          getSkillsStatus: async () => ({
            skills: [],
          }),
          getToolsCatalog: async () => ({
            profiles: [],
            groups: [],
          }),
          listAgents: async () => ({
            agents: [
              {
                id: 'ops',
                name: 'Ops',
                description: 'Automation and incident response agent.',
                avatar: 'O',
                systemPrompt: 'Handle cron tasks and debug incidents.',
                creator: 'OpenClaw',
                workspace: '/workspace/ops',
              },
            ],
          }),
          listAgentFiles: async () => ({
            files: [],
          }),
          getAgentFile: async () => ({
            file: undefined,
          }),
          listWorkbenchCronJobs: async () => [],
          listWorkbenchCronRuns: async () => [],
        },
      });

      const workbench = await service.getInstanceWorkbench('managed-agent-default-params');
      const ops = workbench?.agents.find((agent) => agent.agent.id === 'ops');

      assert.ok(ops);
      assert.deepEqual(ops?.params, {
        temperature: 0.4,
        streaming: false,
        timeoutMs: 90000,
      });
      assert.deepEqual(ops?.paramSources, {
        temperature: 'agent',
        streaming: 'defaults',
        timeoutMs: 'defaults',
      });
    } finally {
      openClawConfigDocumentApi.readConfigSnapshot = originalReadConfigSnapshot;
    }
  },
);

await runTest(
  'getInstanceWorkbench preserves channel account runtime state when config overlays live OpenClaw sections',
  async () => {
    const configFilePath = 'D:/OpenClaw/.openclaw/openclaw.json';
    const configChannelSnapshots = createConfigChannelSnapshots();
    const originalReadConfigSnapshot =
      openClawConfigDocumentApi.readConfigSnapshot.bind(openClawConfigDocumentApi);

    openClawConfigDocumentApi.readConfigSnapshot = async (_configPath: string) =>
      createConfigSnapshot(configFilePath, {
        channelSnapshots: configChannelSnapshots,
      });

    try {
      const service = createInstanceWorkbenchService({
        studioApi: {
          getInstanceDetail: async () => createOpenClawDetail('config-channel-accounts', { workbench: null }),
        },
        openClawGatewayClient: {
          getConfig: async () => ({
            config: {
              models: {
                providers: {},
              },
            },
          }),
          listModels: async () => [],
          getChannelStatus: async () => ({
            channelOrder: ['slack'],
            channelLabels: {
              slack: 'Slack',
            },
            channels: {
              slack: {
                enabled: true,
                configured: true,
                fields: {
                  token: true,
                },
                accounts: {
                  primary: {
                    configured: true,
                  },
                  backup: {
                    configured: true,
                  },
                },
              },
            },
            channelAccounts: {
              slack: {
                primary: {
                  label: 'Primary',
                  configured: true,
                  enabled: true,
                  status: 'connected',
                  detail: 'Primary workspace connected.',
                },
                backup: {
                  label: 'Backup',
                  configured: true,
                  enabled: false,
                  status: 'disconnected',
                  detail: 'Backup token needs reconnect.',
                },
              },
            },
          }),
          getSkillsStatus: async () => ({
            skills: [],
          }),
          getToolsCatalog: async () => ({
            profiles: [],
            groups: [],
          }),
          listAgents: async () => ({
            agents: [],
          }),
          listAgentFiles: async () => ({
            files: [],
          }),
          getAgentFile: async () => ({
            file: undefined,
          }),
          listWorkbenchCronJobs: async () => [],
          listWorkbenchCronRuns: async () => [],
        },
      });

      const workbench = await service.getInstanceWorkbench('config-channel-accounts');
      const slack = workbench?.channels.find((channel) => channel.id === 'slack');

      assert.ok(slack);
      assert.deepEqual(
        slack?.accounts?.map((account) => [account.id, account.status, account.enabled]),
        [
          ['backup', 'disconnected', false],
          ['primary', 'connected', true],
        ],
      );
      assert.match(slack?.description || '', /Primary|Backup/);
      assert.match(slack?.setupSteps[0] || '', /account/i);
    } finally {
      openClawConfigDocumentApi.readConfigSnapshot = originalReadConfigSnapshot;
    }
  },
);

await runTest('listTaskExecutions stays scoped to the most recently loaded OpenClaw instance when task ids overlap', async () => {
  const taskExecutionReads: Array<[string, string]> = [];
  const detailById: Record<string, StudioInstanceDetailRecord> = {
    alpha: createOpenClawDetail('alpha', { workbench: null }),
    beta: createOpenClawDetail('beta', { workbench: null }),
  };
  const service = createInstanceWorkbenchService({
    studioApi: {
      getInstanceDetail: async (instanceId) => detailById[instanceId] || null,
    },
    openClawGatewayClient: {
      listWorkbenchCronJobs: async (instanceId) => [createLiveTask(`shared-task`)].map((task) => ({
        ...task,
        name: `${instanceId} task`,
      })),
      listWorkbenchCronRuns: async (instanceId, taskId) => {
        taskExecutionReads.push([instanceId, taskId]);
        return [];
      },
      getConfig: async () => ({
        config: {
          models: {
            providers: {},
          },
        },
      }),
      listModels: async () => [],
      getChannelStatus: async () => ({
        channels: {},
      }),
      getSkillsStatus: async () => ({
        skills: [],
      }),
      getToolsCatalog: async () => ({
        profiles: [],
        groups: [],
      }),
      listAgents: async () => ({
        agents: [],
      }),
      listAgentFiles: async () => ({
        files: [],
      }),
      getAgentFile: async () => ({
        file: undefined,
      }),
    },
  });

  await service.getInstanceWorkbench('alpha');
  await service.getInstanceWorkbench('beta');
  await service.listTaskExecutions('shared-task');
  await service.getInstanceWorkbench('alpha');
  await service.listTaskExecutions('shared-task');

  assert.deepEqual(taskExecutionReads, [
    ['beta', 'shared-task'],
    ['alpha', 'shared-task'],
  ]);
});

await runTest(
  'getInstanceWorkbench still probes the built-in OpenClaw gateway when managed runtime status projection lags behind',
  async () => {
    const gatewayCalls: string[] = [];
    const detail = createBuiltInOpenClawDetail();
    detail.instance.status = 'offline';
    detail.lifecycle = {
      owner: 'appManaged',
      startStopSupported: true,
      configWritable: true,
      lifecycleControllable: true,
      workbenchManaged: true,
      endpointObserved: true,
      notes: [],
    };
    detail.workbench = null;

    const service = createInstanceWorkbenchService({
      studioApi: {
        getInstanceDetail: async () => detail,
      },
      openClawGatewayClient: {
        getConfig: async () => {
          gatewayCalls.push('getConfig');
          return {
            config: {
              agents: {
                defaults: {},
              },
              models: {
                providers: {},
              },
            },
          };
        },
        listModels: async () => {
          gatewayCalls.push('listModels');
          return [];
        },
        getChannelStatus: async () => {
          gatewayCalls.push('getChannelStatus');
          return {
            channels: {},
            channelOrder: [],
          };
        },
        getSkillsStatus: async () => {
          gatewayCalls.push('getSkillsStatus');
          return {
            skills: [],
          };
        },
        listAgents: async () => {
          gatewayCalls.push('listAgents');
          return {
            agents: [],
          };
        },
        listWorkbenchCronJobs: async () => {
          gatewayCalls.push('listWorkbenchCronJobs');
          return [createLiveTask('job-ops-daily')];
        },
        getToolsCatalog: async () => {
          gatewayCalls.push('getToolsCatalog');
          return {
            profiles: [],
            groups: [],
          };
        },
      },
    });

    const workbench = await service.getInstanceWorkbench(BUILT_IN_INSTANCE_ID);

    assert.ok(workbench);
    assert.ok(gatewayCalls.includes('getConfig'));
    assert.ok(gatewayCalls.includes('listWorkbenchCronJobs'));
  },
);

await runTest(
  'getInstanceWorkbench preserves backend-authored task details when live OpenClaw task payloads are partial',
  async () => {
    const detail = createBuiltInOpenClawDetail();
    detail.workbench = {
      ...detail.workbench!,
      cronTasks: {
        tasks: [createLiveTask('job-ops-daily')],
        taskExecutionsById: {
          'job-ops-daily': [],
        },
      },
    };

    const service = createInstanceWorkbenchService({
      studioApi: {
        getInstanceDetail: async () => detail,
      },
      openClawGatewayClient: {
        listWorkbenchCronJobs: async () =>
          ([
            {
              id: 'job-ops-daily',
              name: 'Ops Daily Brief',
              status: 'paused',
            },
          ] as unknown as LiveTask[]),
        listWorkbenchCronRuns: async () => [],
        getConfig: async () => ({
          config: {
            models: {
              providers: {},
            },
          },
        }),
        listModels: async () => [],
        getChannelStatus: async () => ({
          channels: {},
        }),
        getSkillsStatus: async () => ({
          skills: [],
        }),
        getToolsCatalog: async () => ({
          profiles: [],
          groups: [],
        }),
        listAgents: async () => ({
          agents: [],
        }),
        listAgentFiles: async () => ({
          files: [],
        }),
        getAgentFile: async () => ({
          file: undefined,
        }),
      },
    });

    const workbench = await service.getInstanceWorkbench(BUILT_IN_INSTANCE_ID);
    const task = workbench?.tasks.find((entry) => entry.id === 'job-ops-daily');

    assert.ok(task);
    assert.equal(task?.status, 'paused');
    assert.equal(task?.prompt, 'Summarize operations updates.');
    assert.equal(task?.scheduleMode, 'cron');
    assert.equal(task?.scheduleConfig.cronExpression, '0 9 * * *');
    assert.equal(task?.executionContent, 'runAssistantTask');
    assert.equal(task?.deliveryMode, 'publishSummary');
    assert.equal(task?.latestExecution?.id, 'job-ops-daily-latest');
  },
);

await runTest(
  'getInstanceWorkbench normalizes and deduplicates malformed live OpenClaw task ids before exposing them to the workbench',
  async () => {
    const service = createInstanceWorkbenchService({
      studioApi: {
        getInstanceDetail: async () =>
          createOpenClawDetail('openclaw-task-normalization', {
            workbench: null,
          }),
      },
      openClawGatewayClient: {
        listWorkbenchCronJobs: async () =>
          ([
            {
              ...createLiveTask(' shared-task '),
              id: ' shared-task ',
              name: 'Shared Task',
            },
            {
              ...createLiveTask('shared-task'),
              name: 'Shared Task Duplicate',
            },
            {
              id: '   ',
              name: 'Ghost Task',
              status: 'active',
            },
          ] as unknown as LiveTask[]),
        listWorkbenchCronRuns: async () => [],
        getConfig: async () => ({
          config: {
            models: {
              providers: {},
            },
          },
        }),
        listModels: async () => [],
        getChannelStatus: async () => ({
          channels: {},
        }),
        getSkillsStatus: async () => ({
          skills: [],
        }),
        getToolsCatalog: async () => ({
          profiles: [],
          groups: [],
        }),
        listAgents: async () => ({
          agents: [],
        }),
        listAgentFiles: async () => ({
          files: [],
        }),
        getAgentFile: async () => ({
          file: undefined,
        }),
      },
    });

    const workbench = await service.getInstanceWorkbench('openclaw-task-normalization');

    assert.ok(workbench);
    assert.deepEqual(
      workbench?.tasks.map((task) => task.id),
      ['shared-task'],
    );
    assert.match(workbench?.tasks[0]?.name || '', /Shared Task/);
    assert.equal(workbench?.sectionCounts.cronTasks, 1);
  },
);

await runTest('getInstanceWorkbench keeps non-OpenClaw backend detail truthful when no backend workbench is available', async () => {
  const service = createInstanceWorkbenchService({
    studioApi: {
      getInstanceDetail: async () => createCustomDetail('custom-instance-1'),
    },
  });

  const workbench = await service.getInstanceWorkbench('custom-instance-1');

  assert.ok(workbench);
  assert.equal(workbench?.detail.instance.runtimeKind, 'custom');
  assert.equal(workbench?.detail.lifecycle.notes.length, 0);
  assert.equal(workbench?.channels.length, 0);
  assert.equal(workbench?.tasks.length, 0);
  assert.equal(workbench?.agents.length, 0);
  assert.equal(workbench?.files.length, 0);
  assert.equal(workbench?.llmProviders.length, 0);
  assert.equal(workbench?.memories.length, 0);
  assert.equal(workbench?.tools.length, 0);
  assert.equal(workbench?.sectionCounts.cronTasks, 0);
  assert.equal(workbench?.sectionAvailability.cronTasks.status, 'planned');
  assert.match(
    workbench?.sectionAvailability.cronTasks.detail || '',
    /(future runtime adapter|not yet backed by a runtime-specific adapter)/i,
  );
});

await runTest('getInstanceWorkbench falls back to registry-backed detail when backend detail is unavailable', async () => {
  const service = createInstanceWorkbenchService({
    studioApi: {
      getInstanceDetail: async () => null,
    },
    instanceService: {
      getInstanceById: async () => ({
        id: 'fallback-instance-1',
        name: 'Fallback Instance',
        type: 'Registry Runtime',
        iconType: 'server',
        status: 'online',
        version: '1.0.0',
        uptime: '1h',
        ip: '127.0.0.1',
        cpu: 8,
        memory: 18,
        totalMemory: '16GB',
      }),
      getInstanceConfig: async () => ({
        port: '17890',
        sandbox: true,
        autoUpdate: false,
        logLevel: 'info',
        corsOrigins: '*',
      }),
      getInstanceToken: async () => 'token',
      getInstanceLogs: async () => '',
    },
  });

  const workbench = await service.getInstanceWorkbench('fallback-instance-1');

  assert.ok(workbench);
  assert.equal(workbench?.detail.lifecycle.notes[0], 'Registry-backed detail projection.');
  assert.equal(workbench?.detail.lifecycle.configWritable, false);
  assert.equal(workbench?.detail.lifecycle.workbenchManaged, false);
  assert.equal(workbench?.detail.lifecycle.endpointObserved, false);
  assert.equal(workbench?.detail.lifecycle.lifecycleControllable, false);
  assert.equal(workbench?.tasks.length, 0);
  assert.equal(workbench?.channels.length, 0);
  assert.equal(workbench?.files.length, 0);
});

await runTest(
  'getInstanceWorkbench fallback preserves remote OpenClaw deployment, storage, and transport truth',
  async () => {
    const service = createInstanceWorkbenchService({
      studioApi: {
        getInstanceDetail: async () => null,
      },
      instanceService: {
        getInstanceById: async () => ({
          id: 'fallback-remote-openclaw',
          name: 'Fallback Remote OpenClaw',
          type: 'Remote OpenClaw',
          iconType: 'server',
          status: 'online',
          version: '2026.4.1',
          uptime: '8h',
          ip: 'gateway.example.com',
          cpu: 6,
          memory: 14,
          totalMemory: '32GB',
          isBuiltIn: false,
          runtimeKind: 'openclaw',
          deploymentMode: 'remote',
          transportKind: 'openclawGatewayWs',
          baseUrl: 'https://gateway.example.com/claw/api',
          websocketUrl: 'wss://gateway.example.com/claw/ws',
          storage: {
            provider: 'remoteApi',
            namespace: 'gateway.example.com',
            endpoint: 'https://gateway.example.com/claw/api',
          },
        }),
        getInstanceConfig: async () => ({
          port: '443',
          sandbox: true,
          autoUpdate: false,
          logLevel: 'info',
          corsOrigins: '*',
        }),
        getInstanceToken: async () => 'remote-token',
        getInstanceLogs: async () => 'remote fallback log',
      },
    });

    const workbench = await service.getInstanceWorkbench('fallback-remote-openclaw');

    assert.ok(workbench);
    assert.equal(workbench?.detail.instance.runtimeKind, 'openclaw');
    assert.equal(workbench?.detail.instance.deploymentMode, 'remote');
    assert.equal(workbench?.detail.instance.transportKind, 'openclawGatewayWs');
    assert.equal(workbench?.detail.instance.baseUrl, 'https://gateway.example.com/claw/api');
    assert.equal(workbench?.detail.instance.websocketUrl, 'wss://gateway.example.com/claw/ws');
    assert.equal(workbench?.detail.lifecycle.owner, 'remoteService');
    assert.equal(workbench?.detail.storage.provider, 'remoteApi');
    assert.equal(workbench?.detail.storage.remote, true);
    assert.equal(workbench?.detail.connectivity.primaryTransport, 'openclawGatewayWs');
  },
);

await runTest(
  'getInstanceWorkbench fallback preserves local-external OpenClaw deployment, storage, and transport truth',
  async () => {
    const service = createInstanceWorkbenchService({
      studioApi: {
        getInstanceDetail: async () => null,
      },
      instanceService: {
        getInstanceById: async () => ({
          id: 'fallback-local-openclaw',
          name: 'Fallback Local External OpenClaw',
          type: 'Local External OpenClaw',
          iconType: 'box',
          status: 'offline',
          version: '2026.4.1',
          uptime: '0m',
          ip: '127.0.0.1',
          cpu: 0,
          memory: 0,
          totalMemory: '16GB',
          isBuiltIn: false,
          runtimeKind: 'openclaw',
          deploymentMode: 'local-external',
          transportKind: 'openclawGatewayWs',
          baseUrl: 'http://127.0.0.1:28789',
          websocketUrl: 'ws://127.0.0.1:28789',
          storage: {
            provider: 'localFile',
            namespace: 'fallback-local-openclaw',
          },
        }),
        getInstanceConfig: async () => ({
          port: '28789',
          sandbox: true,
          autoUpdate: false,
          logLevel: 'info',
          corsOrigins: '*',
        }),
        getInstanceToken: async () => 'local-token',
        getInstanceLogs: async () => '',
      },
    });

    const workbench = await service.getInstanceWorkbench('fallback-local-openclaw');

    assert.ok(workbench);
    assert.equal(workbench?.detail.instance.runtimeKind, 'openclaw');
    assert.equal(workbench?.detail.instance.deploymentMode, 'local-external');
    assert.equal(workbench?.detail.instance.transportKind, 'openclawGatewayWs');
    assert.equal(workbench?.detail.instance.baseUrl, 'http://127.0.0.1:28789');
    assert.equal(workbench?.detail.instance.websocketUrl, 'ws://127.0.0.1:28789');
    assert.equal(workbench?.detail.lifecycle.owner, 'externalProcess');
    assert.equal(workbench?.detail.storage.provider, 'localFile');
    assert.equal(workbench?.detail.storage.remote, false);
    assert.equal(workbench?.detail.connectivity.primaryTransport, 'openclawGatewayWs');
  },
);

await runTest('getInstanceWorkbench does not consult mock services when backend detail is unavailable', async () => {
  const service = createInstanceWorkbenchService({
    studioApi: {
      getInstanceDetail: async () => null,
    },
    instanceService: {
      getInstanceById: async () => ({
        id: 'fallback-no-mock',
        name: 'Fallback No Mock',
        type: 'Registry Runtime',
        iconType: 'server',
        status: 'online',
        version: '1.0.1',
        uptime: '2h',
        ip: '127.0.0.1',
        cpu: 12,
        memory: 22,
        totalMemory: '32GB',
      }),
      getInstanceConfig: async () => ({
        port: '17891',
        sandbox: true,
        autoUpdate: true,
        logLevel: 'debug',
        corsOrigins: '*',
      }),
      getInstanceToken: async () => 'registry-token',
      getInstanceLogs: async () => 'registry log line',
    },
  });

  const workbench = await service.getInstanceWorkbench('fallback-no-mock');

  assert.ok(workbench);
  assert.equal(workbench?.detail.lifecycle.notes[0], 'Registry-backed detail projection.');
  assert.equal(workbench?.token, 'registry-token');
  assert.equal(workbench?.files.length, 0);
});

await runTest('task operations stay truthful when no runtime-backed task mapping exists', async () => {
  const service = createInstanceWorkbenchService();

  await assert.rejects(service.cloneTask('unknown-task'), /Task is not available/i);
  await assert.rejects(service.runTaskNow('unknown-task'), /Task is not available/i);
  assert.deepEqual(await service.listTaskExecutions('unknown-task'), []);
  await assert.rejects(
    service.updateTaskStatus('unknown-task', 'active'),
    /Task is not available/i,
  );
  await assert.rejects(service.deleteTask('unknown-task'), /Task is not available/i);
});

await runTest(
  'instanceWorkbenchService routes backend-authored OpenClaw task actions through studio APIs when no live gateway task snapshot is available',
  async () => {
    const gatewayTaskCalls: string[] = [];
    const studioCalls: Array<[string, ...unknown[]]> = [];
    const backendExecution = {
      id: 'backend-task-1-run-1',
      taskId: 'backend-task-1',
      status: 'success' as const,
      trigger: 'manual' as const,
      startedAt: '2025-03-19T02:00:00.000Z',
      finishedAt: '2025-03-19T02:00:30.000Z',
      summary: 'Backend execution finished successfully.',
      details: undefined,
    };
    const detail = createBuiltInOpenClawDetail();

    const service = createInstanceWorkbenchService({
      studioApi: {
        getInstanceDetail: async () => detail,
        cloneInstanceTask: async (instanceId, taskId, name) => {
          studioCalls.push(['cloneInstanceTask', instanceId, taskId, name]);
        },
        runInstanceTaskNow: async (instanceId, taskId) => {
          studioCalls.push(['runInstanceTaskNow', instanceId, taskId]);
          return backendExecution;
        },
        listInstanceTaskExecutions: async (instanceId, taskId) => {
          studioCalls.push(['listInstanceTaskExecutions', instanceId, taskId]);
          return [backendExecution];
        },
        updateInstanceTaskStatus: async (instanceId, taskId, status) => {
          studioCalls.push(['updateInstanceTaskStatus', instanceId, taskId, status]);
        },
        deleteInstanceTask: async (instanceId, taskId) => {
          studioCalls.push(['deleteInstanceTask', instanceId, taskId]);
          return true;
        },
      },
      openClawGatewayClient: {
        listWorkbenchCronJobs: async () => {
          gatewayTaskCalls.push('listWorkbenchCronJobs');
          throw new Error('live gateway cron listing is unavailable');
        },
        listWorkbenchCronRuns: async () => {
          gatewayTaskCalls.push('listWorkbenchCronRuns');
          throw new Error('gateway cron history must stay unused for backend-authored tasks');
        },
        addCronJob: async () => {
          gatewayTaskCalls.push('addCronJob');
          throw new Error('gateway add must stay unused for backend-authored tasks');
        },
        runCronJob: async () => {
          gatewayTaskCalls.push('runCronJob');
          throw new Error('gateway run must stay unused for backend-authored tasks');
        },
        updateCronJob: async () => {
          gatewayTaskCalls.push('updateCronJob');
          throw new Error('gateway update must stay unused for backend-authored tasks');
        },
        removeCronJob: async () => {
          gatewayTaskCalls.push('removeCronJob');
          throw new Error('gateway delete must stay unused for backend-authored tasks');
        },
        getConfig: async () => ({
          config: {
            models: {
              providers: {},
            },
          },
        }),
        listModels: async () => [],
        getChannelStatus: async () => ({
          channels: {},
        }),
        getSkillsStatus: async () => ({
          skills: [],
        }),
        getToolsCatalog: async () => ({
          profiles: [],
          groups: [],
        }),
        listAgents: async () => ({
          agents: [],
        }),
        listAgentFiles: async () => ({
          files: [],
        }),
        getAgentFile: async () => ({
          file: undefined,
        }),
      },
    });

    const workbench = await service.getInstanceWorkbench(BUILT_IN_INSTANCE_ID);

    assert.ok(workbench);
    assert.equal(workbench?.tasks.length, 1);
    gatewayTaskCalls.length = 0;

    await service.cloneTask('backend-task-1', 'Backend Snapshot Task Copy');
    const execution = await service.runTaskNow('backend-task-1');
    const executions = await service.listTaskExecutions('backend-task-1');
    await service.updateTaskStatus('backend-task-1', 'paused');
    await service.deleteTask('backend-task-1');

    assert.equal(execution.summary, 'Backend execution finished successfully.');
    assert.deepEqual(executions, [backendExecution]);
    assert.deepEqual(gatewayTaskCalls, []);
    assert.deepEqual(studioCalls, [
      ['cloneInstanceTask', BUILT_IN_INSTANCE_ID, 'backend-task-1', 'Backend Snapshot Task Copy'],
      ['runInstanceTaskNow', BUILT_IN_INSTANCE_ID, 'backend-task-1'],
      ['listInstanceTaskExecutions', BUILT_IN_INSTANCE_ID, 'backend-task-1'],
      ['updateInstanceTaskStatus', BUILT_IN_INSTANCE_ID, 'backend-task-1', 'paused'],
      ['deleteInstanceTask', BUILT_IN_INSTANCE_ID, 'backend-task-1'],
    ]);
    await assert.rejects(service.runTaskNow('backend-task-1'), /Task is not available/i);
  },
);

await runTest(
  'instanceWorkbenchService routes backend-authored OpenClaw task creation and updates through studio APIs when backend workbench remains authoritative',
  async () => {
    const gatewayTaskCalls: string[] = [];
    const studioCalls: Array<[string, string, ...unknown[]]> = [];
    let detail = createBuiltInOpenClawDetail();

    const service = createInstanceWorkbenchService({
      studioApi: {
        getInstanceDetail: async () => detail,
        createInstanceTask: async (instanceId, payload) => {
          studioCalls.push(['createInstanceTask', instanceId, payload]);
          detail = {
            ...detail,
            workbench: {
              ...detail.workbench!,
              cronTasks: {
                ...detail.workbench!.cronTasks,
                tasks: [
                  ...detail.workbench!.cronTasks.tasks,
                  {
                    id: 'backend-task-2',
                    name: String((payload as Record<string, unknown>).name || 'Created Backend Task'),
                    description: 'Created through backend bridge.',
                    prompt: 'Created through backend bridge.',
                    schedule: '0 10 * * *',
                    scheduleMode: 'cron',
                    scheduleConfig: {
                      cronExpression: '0 10 * * *',
                    },
                    cronExpression: '0 10 * * *',
                    actionType: 'skill',
                    status: 'active',
                    sessionMode: 'isolated',
                    wakeUpMode: 'immediate',
                    executionContent: 'runAssistantTask',
                    deliveryMode: 'publishSummary',
                    latestExecution: null,
                  },
                ],
                taskExecutionsById: {
                  ...detail.workbench!.cronTasks.taskExecutionsById,
                  'backend-task-2': [],
                },
              },
            },
          };
        },
        updateInstanceTask: async (instanceId, taskId, payload) => {
          studioCalls.push(['updateInstanceTask', instanceId, taskId, payload]);
          detail = {
            ...detail,
            workbench: {
              ...detail.workbench!,
              cronTasks: {
                ...detail.workbench!.cronTasks,
                tasks: detail.workbench!.cronTasks.tasks.map((task) =>
                  task.id === taskId
                    ? {
                        ...task,
                        name: String((payload as Record<string, unknown>).name || task.name),
                        prompt:
                          typeof (payload as Record<string, unknown>).payload === 'object' &&
                          (payload as Record<string, unknown>).payload &&
                          typeof ((payload as Record<string, unknown>).payload as Record<string, unknown>)
                            .message === 'string'
                            ? String(
                                ((payload as Record<string, unknown>).payload as Record<string, unknown>)
                                  .message,
                              )
                            : task.prompt,
                      }
                    : task,
                ),
              },
            },
          };
        },
      },
      openClawGatewayClient: {
        addCronJob: async () => {
          gatewayTaskCalls.push('addCronJob');
          throw new Error('gateway add must stay unused for backend-authored task creation');
        },
        updateCronJob: async () => {
          gatewayTaskCalls.push('updateCronJob');
          throw new Error('gateway update must stay unused for backend-authored task updates');
        },
      },
    });

    await service.createTask(BUILT_IN_INSTANCE_ID, {
      name: 'Created Backend Task',
      description: 'Created through backend bridge.',
      prompt: 'Created through backend bridge.',
      schedule: '0 10 * * *',
      scheduleMode: 'cron',
      scheduleConfig: {
        cronExpression: '0 10 * * *',
      },
      cronExpression: '0 10 * * *',
      actionType: 'skill',
      status: 'active',
      sessionMode: 'isolated',
      wakeUpMode: 'immediate',
      executionContent: 'runAssistantTask',
      deliveryMode: 'publishSummary',
    });

    await service.updateTask(BUILT_IN_INSTANCE_ID, 'backend-task-1', {
      name: 'Backend Snapshot Task Updated',
      payload: {
        kind: 'agentTurn',
        message: 'Updated through backend bridge.',
      },
    });

    assert.deepEqual(gatewayTaskCalls, []);
    assert.deepEqual(
      studioCalls.map(([name, instanceId]) => ({ name, instanceId })),
      [
        {
          name: 'createInstanceTask',
          instanceId: BUILT_IN_INSTANCE_ID,
        },
        {
          name: 'updateInstanceTask',
          instanceId: BUILT_IN_INSTANCE_ID,
        },
      ],
    );
    assert.equal(detail.workbench?.cronTasks.tasks.some((task) => task.id === 'backend-task-2'), true);
    assert.equal(
      detail.workbench?.cronTasks.tasks.find((task) => task.id === 'backend-task-1')?.name,
      'Backend Snapshot Task Updated',
    );
    assert.equal(
      detail.workbench?.cronTasks.tasks.find((task) => task.id === 'backend-task-1')?.prompt,
      'Updated through backend bridge.',
    );
  },
);

await runTest('instanceWorkbenchService routes OpenClaw task actions through native cron methods', async () => {
  const gatewayCalls: Array<[string, ...unknown[]]> = [];
  let liveTasks = [createLiveTask('job-ops-daily')];

  const service = createInstanceWorkbenchService({
    studioApi: {
      getInstanceDetail: async () =>
        createOpenClawDetail('openclaw-prod', {
          workbench: null,
        }),
      cloneInstanceTask: async () => {
        throw new Error('studio clone should not be used for OpenClaw tasks');
      },
      runInstanceTaskNow: async () => {
        throw new Error('studio run should not be used for OpenClaw tasks');
      },
      listInstanceTaskExecutions: async () => {
        throw new Error('studio history should not be used for OpenClaw tasks');
      },
      updateInstanceTaskStatus: async () => {
        throw new Error('studio status updates should not be used for OpenClaw tasks');
      },
      deleteInstanceTask: async () => {
        throw new Error('studio delete should not be used for OpenClaw tasks');
      },
    },
    openClawGatewayClient: {
      listWorkbenchCronJobs: async () => liveTasks,
      listWorkbenchCronRuns: async (_instanceId, taskId) => {
        gatewayCalls.push(['listWorkbenchCronRuns', taskId]);
        return [
          {
            id: `${taskId}-1742346060000`,
            taskId,
            status: 'success',
            trigger: 'manual',
            startedAt: '2025-03-19T01:00:00.000Z',
            finishedAt: '2025-03-19T01:01:00.000Z',
            summary: 'Gateway execution finished successfully.',
            details: undefined,
          },
        ];
      },
      addCronJob: async (_instanceId, payload) => {
        gatewayCalls.push(['addCronJob', payload]);
        const created = {
          ...createLiveTask('job-ops-daily-copy'),
          name:
            typeof (payload as Record<string, unknown>).name === 'string'
              ? ((payload as Record<string, unknown>).name as string)
              : 'Ops Daily Brief Copy',
        };
        liveTasks = [...liveTasks, created];
        return {
          id: created.id,
        };
      },
      runCronJob: async (_instanceId, taskId) => {
        gatewayCalls.push(['runCronJob', taskId]);
        return {
          ok: true,
          enqueued: true,
          runId: `${taskId}-run-1`,
        };
      },
      updateCronJob: async (_instanceId, taskId, patch) => {
        gatewayCalls.push(['updateCronJob', taskId, patch]);
        liveTasks = liveTasks.map((task) =>
          task.id === taskId
            ? {
                ...task,
                status:
                  (patch as Record<string, unknown>).enabled === false ? 'paused' : 'active',
              }
            : task,
        );
        return {
          id: taskId,
        };
      },
      removeCronJob: async (_instanceId, taskId) => {
        gatewayCalls.push(['removeCronJob', taskId]);
        liveTasks = liveTasks.filter((task) => task.id !== taskId);
        return true;
      },
      getConfig: async () => ({
        baseHash: 'hash-1',
        config: {
          agents: {
            list: [
              {
                id: 'ops',
                name: 'Ops',
                default: true,
              },
            ],
          },
        },
      }),
      listModels: async () => [],
      getChannelStatus: async () => ({
        channelOrder: [],
        channelLabels: {},
        channels: {},
      }),
      getSkillsStatus: async () => ({
        agentId: 'ops',
        skills: [],
      }),
      getToolsCatalog: async () => ({
        agentId: 'ops',
        profiles: [],
        groups: [],
      }),
      listAgents: async () => ({
        requester: 'ops',
        agents: [
          {
            id: 'ops',
            name: 'Ops',
            description: 'Automation agent.',
            avatar: 'O',
            systemPrompt: 'Handle cron tasks.',
            creator: 'OpenClaw',
            workspace: '/workspace/ops',
          },
        ],
      }),
      listAgentFiles: async (_instanceId, args) => ({
        agentId: args.agentId,
        workspace: '/workspace/ops',
        files: [],
      }),
      getAgentFile: async (_instanceId, args) => ({
        agentId: args.agentId,
        workspace: '/workspace/ops',
        file: {
          name: args.name,
          path: `/workspace/ops/${args.name}`,
          missing: true,
        },
      }),
    },
  });

  const workbench = await service.getInstanceWorkbench('openclaw-prod');
  assert.equal(workbench?.tasks.length, 1);

  await service.cloneTask('job-ops-daily', 'Ops Daily Brief Copy');
  const execution = await service.runTaskNow('job-ops-daily');
  await service.updateTaskStatus('job-ops-daily', 'paused');
  await service.deleteTask('job-ops-daily');

  assert.equal(execution.summary, 'Gateway execution finished successfully.');
  assert.deepEqual(gatewayCalls, [
    [
      'addCronJob',
      {
        name: 'Ops Daily Brief Copy',
        description: 'Morning operations summary',
        enabled: true,
        schedule: {
          kind: 'cron',
          expr: '0 9 * * *',
        },
        sessionTarget: 'isolated',
        wakeMode: 'now',
        payload: {
          kind: 'agentTurn',
          message: 'Summarize operations updates.',
        },
        delivery: {
          mode: 'announce',
          channel: 'slack',
          to: 'channel:C001',
        },
      },
    ],
    ['runCronJob', 'job-ops-daily'],
    ['listWorkbenchCronRuns', 'job-ops-daily'],
    ['updateCronJob', 'job-ops-daily', { enabled: false }],
    ['removeCronJob', 'job-ops-daily'],
  ]);
});
