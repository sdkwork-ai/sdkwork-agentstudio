// WORKSPACE-PATH:allow-fixture: fixtures name a foreign checkout root, drive, or home directory to exercise path handling, so the literal is the value under assertion rather than a binding this build resolves
import assert from 'node:assert/strict';
import {
  DEFAULT_BUNDLED_OPENCLAW_VERSION,
  type Skill,
} from '@sdkwork/agentstudio-pc-types';
import type { InstanceWorkbenchSnapshot } from '../types/index.ts';
import { createAgentWorkbenchService } from './agentWorkbenchServiceCore.ts';
import { buildOpenClawAgentFileId } from './openClawSupport.ts';

function runTest(name: string, callback: () => void | Promise<void>) {
  return Promise.resolve()
    .then(callback)
    .then(() => {
      console.log(`ok - ${name}`);
    })
    .catch((error) => {
      console.error(`not ok - ${name}`);
      throw error;
    });
}

function createSkill(id: string, name: string): Skill {
  return {
    id,
    name,
    description: `${name} description`,
    author: 'OpenClaw',
    rating: 5,
    downloads: 12,
    category: 'Automation',
  };
}

function createWorkbench(): InstanceWorkbenchSnapshot {
  return {
    instance: {
      id: 'instance-openclaw',
      name: 'OpenClaw',
      type: 'OpenClaw Gateway',
      iconType: 'server',
      status: 'online',
      version: DEFAULT_BUNDLED_OPENCLAW_VERSION,
      uptime: '8h',
      ip: '127.0.0.1',
      cpu: 12,
      memory: 24,
      totalMemory: '32 GB',
    },
    config: {
      port: '21280',
      sandbox: true,
      autoUpdate: true,
      logLevel: 'info',
      corsOrigins: '*',
    },
    token: 'token',
    logs: '',
    detail: {
      instance: {
        id: 'instance-openclaw',
        name: 'OpenClaw',
        runtimeKind: 'openclaw',
        deploymentMode: 'local-managed',
        transportKind: 'openclawGatewayWs',
        status: 'online',
        isBuiltIn: true,
        isDefault: true,
        iconType: 'server',
        version: DEFAULT_BUNDLED_OPENCLAW_VERSION,
        typeLabel: 'OpenClaw Gateway',
        host: '127.0.0.1',
        port: 21280,
        baseUrl: 'http://127.0.0.1:21280',
        websocketUrl: 'ws://127.0.0.1:21280',
        cpu: 12,
        memory: 24,
        totalMemory: '32 GB',
        uptime: '8h',
        capabilities: ['chat', 'models', 'tasks', 'files', 'tools'],
        storage: {
          provider: 'localFile',
          namespace: 'instance-openclaw',
        },
        config: {
          port: '21280',
          sandbox: true,
          autoUpdate: true,
          logLevel: 'info',
          corsOrigins: '*',
          baseUrl: 'http://127.0.0.1:21280',
          websocketUrl: 'ws://127.0.0.1:21280',
          authToken: 'token',
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
        baseUrl: 'http://127.0.0.1:21280',
        websocketUrl: 'ws://127.0.0.1:21280',
        authToken: 'token',
      },
      logs: '',
      health: {
        score: 92,
        status: 'healthy',
        checks: [],
        evaluatedAt: 1,
      },
      lifecycle: {
        owner: 'localProcess',
        startStopSupported: true,
        configWritable: true,
        notes: [],
      },
      storage: {
        status: 'ready',
        provider: 'localFile',
        namespace: 'instance-openclaw',
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
      capabilities: [],
      officialRuntimeNotes: [],
      workbench: null,
    } as any,
    kernelConfig: {
      configFile: 'C:/OpenClaw/.openclaw/openclaw.json',
      configRoot: 'C:/OpenClaw/.openclaw',
      userRoot: 'C:/OpenClaw',
      format: 'json',
      access: 'localFs',
      provenance: 'standardUserRoot',
      writable: true,
      resolved: true,
      schemaVersion: null,
    },
    configChannels: [],
    kernelConfigInsights: null,
    healthScore: 92,
    runtimeStatus: 'healthy',
    connectedChannelCount: 2,
    activeTaskCount: 2,
    installedSkillCount: 2,
    readyToolCount: 2,
    sectionCounts: {
      overview: 1,
      channels: 3,
      cronTasks: 2,
      llmProviders: 2,
      agents: 2,
      skills: 2,
      files: 2,
      memory: 0,
      tools: 2,
      config: 1,
    },
    sectionAvailability: {
      overview: {
        status: 'ready',
        detail: 'ready',
      },
      channels: {
        status: 'ready',
        detail: 'ready',
      },
      cronTasks: {
        status: 'ready',
        detail: 'ready',
      },
      llmProviders: {
        status: 'ready',
        detail: 'ready',
      },
      agents: {
        status: 'ready',
        detail: 'ready',
      },
      skills: {
        status: 'ready',
        detail: 'ready',
      },
      files: {
        status: 'ready',
        detail: 'ready',
      },
      memory: {
        status: 'planned',
        detail: 'planned',
      },
      tools: {
        status: 'ready',
        detail: 'ready',
      },
      config: {
        status: 'ready',
        detail: 'ready',
      },
    },
    channels: [
      {
        id: 'slack',
        name: 'Slack',
        description: 'Slack bot',
        status: 'connected',
        enabled: true,
        configurationMode: 'required',
        fieldCount: 2,
        configuredFieldCount: 2,
        setupSteps: [],
      },
      {
        id: 'telegram',
        name: 'Telegram',
        description: 'Telegram bot',
        status: 'connected',
        enabled: true,
        configurationMode: 'required',
        fieldCount: 2,
        configuredFieldCount: 2,
        setupSteps: [],
      },
      {
        id: 'matrix',
        name: 'Matrix',
        description: 'Matrix bot',
        status: 'disconnected',
        enabled: false,
        configurationMode: 'required',
        fieldCount: 1,
        configuredFieldCount: 1,
        setupSteps: [],
      },
    ],
    tasks: [
      {
        id: 'task-main',
        name: 'Main Summary',
        prompt: 'Summarize',
        schedule: '0 * * * *',
        scheduleMode: 'cron',
        scheduleConfig: {
          cronExpression: '0 * * * *',
        },
        actionType: 'skill',
        status: 'active',
        sessionMode: 'main',
        wakeUpMode: 'immediate',
        executionContent: 'runAssistantTask',
        deliveryMode: 'publishSummary',
        agentId: 'main',
      },
      {
        id: 'task-research',
        name: 'Research Digest',
        prompt: 'Digest',
        schedule: '0 9 * * *',
        scheduleMode: 'cron',
        scheduleConfig: {
          cronExpression: '0 9 * * *',
        },
        actionType: 'skill',
        status: 'active',
        sessionMode: 'isolated',
        wakeUpMode: 'immediate',
        executionContent: 'runAssistantTask',
        deliveryMode: 'publishSummary',
        agentId: 'research',
      },
    ],
    agents: [
      {
        agent: {
          id: 'main',
          name: 'Main',
          description: 'Default agent',
          avatar: 'M',
          systemPrompt: 'Main',
          creator: 'OpenClaw',
        },
        focusAreas: ['Operations'],
        automationFitScore: 60,
        workspace: 'C:/OpenClaw/.openclaw/workspace',
        agentDir: 'C:/OpenClaw/.openclaw/agents/main/agent',
        isDefault: true,
        model: {
          primary: 'openai/gpt-4.1',
          fallbacks: ['openai/o4-mini'],
        },
      },
      {
        agent: {
          id: 'research',
          name: 'Research',
          description: 'Research agent',
          avatar: 'R',
          systemPrompt: 'Research',
          creator: 'OpenClaw',
        },
        focusAreas: ['Analytics'],
        automationFitScore: 88,
        workspace: 'C:/OpenClaw/.openclaw/workspace-research',
        agentDir: 'C:/OpenClaw/.openclaw/agents/research/agent',
        isDefault: false,
        model: {
          primary: 'anthropic/claude-3-7-sonnet',
          fallbacks: ['openai/gpt-4.1'],
        },
      },
    ],
    skills: [createSkill('shared-skill', 'Shared Skill')],
    files: [
      {
        id: buildOpenClawAgentFileId('main', 'AGENTS.md'),
        name: 'AGENTS.md',
        path: 'C:/OpenClaw/.openclaw/workspace/AGENTS.md',
        category: 'prompt',
        language: 'markdown',
        size: '1 KB',
        updatedAt: '2026-03-23T00:00:00.000Z',
        status: 'synced',
        description: 'Main agent prompt',
        content: '# Main agent',
        isReadonly: false,
      },
      {
        id: buildOpenClawAgentFileId('research', 'AGENTS.md'),
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
    llmProviders: [
      {
        id: 'openai',
        name: 'OpenAI',
        provider: 'openai',
        endpoint: 'http://127.0.0.1:13003/api/v1',
        apiKeySource: 'env:OPENAI_API_KEY',
        status: 'ready',
        defaultModelId: 'gpt-4.1',
        description: 'OpenAI router',
        icon: 'OA',
        lastCheckedAt: '2026-03-23T00:00:00.000Z',
        capabilities: ['chat'],
        models: [
          {
            id: 'gpt-4.1',
            name: 'GPT-4.1',
            role: 'primary',
            contextWindow: 'Unknown',
          },
          {
            id: 'o4-mini',
            name: 'o4-mini',
            role: 'fallback',
            contextWindow: 'Unknown',
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
      {
        id: 'anthropic',
        name: 'Anthropic',
        provider: 'anthropic',
        endpoint: 'http://127.0.0.1:13003/api/v1',
        apiKeySource: 'env:ANTHROPIC_API_KEY',
        status: 'ready',
        defaultModelId: 'claude-3-7-sonnet',
        description: 'Anthropic router',
        icon: 'AT',
        lastCheckedAt: '2026-03-23T00:00:00.000Z',
        capabilities: ['chat'],
        models: [
          {
            id: 'claude-3-7-sonnet',
            name: 'Claude 3.7 Sonnet',
            role: 'primary',
            contextWindow: 'Unknown',
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
    memories: [],
    tools: [
      {
        id: 'shared-tool',
        name: 'Shared Tool',
        description: 'Shared fallback tool',
        category: 'integration',
        status: 'ready',
        access: 'execute',
        command: 'shared-tool',
      },
    ],
  };
}

await runTest(
  'agentWorkbenchService builds an agent-scoped workbench with filtered tasks/files plus per-agent skills, tools, and channel bindings',
  async () => {
    const service = createAgentWorkbenchService({
      openClawGatewayClient: {
        getSkillsStatus: async (_instanceId, args = {}) => {
          if (args.agentId === 'research') {
            return {
              agentId: 'research',
              workspace: 'C:/OpenClaw/.openclaw/workspace-research',
              skills: [
                {
                  id: 'research-skill',
                  name: 'Research Skill',
                  description: 'Research workflows',
                  author: 'OpenClaw',
                  readme: '# Research Skill',
                  bundled: false,
                  skillKey: 'research-skill',
                  source: 'workspace',
                  filePath: 'C:/OpenClaw/.openclaw/workspace-research/skills/research-skill/SKILL.md',
                  baseDir: 'C:/OpenClaw/.openclaw/workspace-research/skills/research-skill',
                  primaryEnv: 'RESEARCH_API_KEY',
                  homepage: 'https://clawhub.com/skills/research-skill',
                  eligible: false,
                  disabled: false,
                  blockedByAllowlist: false,
                  missing: {
                    env: ['RESEARCH_API_KEY'],
                    bins: ['uv'],
                  },
                  install: [
                    {
                      id: 'uv',
                      kind: 'uv',
                      label: 'Install research-skill (uv)',
                      bins: ['uv'],
                    },
                  ],
                },
              ],
            };
          }

          return {
            agentId: 'main',
            workspace: 'C:/OpenClaw/.openclaw/workspace',
            skills: [],
          };
        },
        getToolsCatalog: async (_instanceId, args = {}) => {
          if (args.agentId === 'research') {
            return {
              agentId: 'research',
              profiles: [],
              groups: [
                {
                  id: 'group:reasoning',
                  label: 'Reasoning',
                  tools: [
                    {
                      id: 'web.search',
                      label: 'Web Search',
                      description: 'Search the web',
                    },
                  ],
                },
              ],
            };
          }

          return {
            agentId: 'main',
            profiles: [],
            groups: [],
          };
        },
      },
      readOpenClawConfigSnapshot: async () =>
        ({
          root: {
            channels: {
              telegram: {
                accounts: {
                  default: {
                    botToken: 'telegram-default',
                  },
                  research: {
                    botToken: 'telegram-research',
                  },
                },
              },
              matrix: {
                accounts: {
                  default: {
                    accessToken: 'matrix-default',
                  },
                  research: {
                    accessToken: 'matrix-research',
                  },
                },
              },
            },
            bindings: [
              {
                agentId: 'research',
                match: {
                  channel: 'telegram',
                  accountId: 'research',
                },
              },
              {
                agentId: 'research',
                match: {
                  channel: 'matrix',
                  accountId: 'research',
                },
              },
            ],
            agents: {
              defaults: {
                model: {
                  primary: 'openai/gpt-4.1',
                },
              },
              list: [
                {
                  id: 'main',
                  default: true,
                },
                {
                  id: 'research',
                  model: {
                    primary: 'anthropic/claude-3-7-sonnet',
                    fallbacks: ['openai/gpt-4.1'],
                  },
                },
              ],
            },
          },
        }) as any,
    });

    const snapshot = await service.getAgentWorkbench({
      instanceId: 'instance-openclaw',
      workbench: createWorkbench(),
      agentId: 'research',
    });

    assert.equal(snapshot.agent.agent.id, 'research');
    assert.equal(
      snapshot.paths.authProfilesPath,
      'C:/OpenClaw/.openclaw/agents/research/agent/auth-profiles.json',
    );
    assert.equal(
      snapshot.paths.modelsRegistryPath,
      'C:/OpenClaw/.openclaw/agents/research/agent/models.json',
    );
    assert.equal(
      snapshot.paths.sessionsPath,
      'C:/OpenClaw/.openclaw/agents/research/sessions',
    );
    assert.deepEqual(
      snapshot.tasks.map((task) => task.id),
      ['task-research'],
    );
    assert.deepEqual(
      snapshot.files.map((file) => file.id),
      [buildOpenClawAgentFileId('research', 'AGENTS.md')],
    );
    assert.deepEqual(
      snapshot.files.map((file) => file.path),
      ['AGENTS.md'],
    );
    assert.deepEqual(
      snapshot.skills.map((skill) => skill.id),
      ['research-skill'],
    );
    assert.equal(snapshot.skills[0]?.skillKey, 'research-skill');
    assert.equal(snapshot.skills[0]?.scope, 'workspace');
    assert.equal(snapshot.skills[0]?.eligible, false);
    assert.equal(snapshot.skills[0]?.disabled, false);
    assert.equal(snapshot.skills[0]?.primaryEnv, 'RESEARCH_API_KEY');
    assert.equal(snapshot.skills[0]?.homepage, 'https://clawhub.com/skills/research-skill');
    assert.deepEqual(snapshot.skills[0]?.missing.env, ['RESEARCH_API_KEY']);
    assert.deepEqual(
      snapshot.skills[0]?.installOptions,
      [
        {
          id: 'uv',
          kind: 'uv',
          label: 'Install research-skill (uv)',
          bins: ['uv'],
        },
      ],
    );
    assert.deepEqual(
      snapshot.tools.map((tool) => tool.id),
      ['web.search'],
    );
    assert.deepEqual(
      snapshot.modelProviders.map((provider) => provider.id),
      ['anthropic', 'openai'],
    );
    assert.equal(snapshot.channels.find((channel) => channel.id === 'telegram')?.routeStatus, 'bound');
    assert.deepEqual(
      snapshot.channels.find((channel) => channel.id === 'telegram')?.accountIds,
      ['research'],
    );
    assert.equal(snapshot.channels.find((channel) => channel.id === 'matrix')?.routeStatus, 'bound');
    assert.equal(snapshot.channels.find((channel) => channel.id === 'slack')?.routeStatus, 'available');
  },
);

await runTest(
  'agentWorkbenchService keeps agent file explorer paths workspace-relative for nested files',
  async () => {
    const service = createAgentWorkbenchService({
      readOpenClawConfigSnapshot: async () => null as any,
      openClawGatewayClient: {
        getSkillsStatus: async () => ({ skills: [] }),
        getToolsCatalog: async () => ({ profiles: [], groups: [] }),
      } as any,
    });

    const nestedWorkbench = createWorkbench();
    nestedWorkbench.files = [
      {
        id: buildOpenClawAgentFileId('research', 'prompts/README.md'),
        name: 'README.md',
        path: 'C:/OpenClaw/.openclaw/workspace-research/prompts/README.md',
        category: 'prompt',
        language: 'markdown',
        size: '1 KB',
        updatedAt: '2026-03-23T00:00:00.000Z',
        status: 'synced',
        description: 'Nested prompt',
        content: '# Nested',
        isReadonly: false,
      },
      {
        id: buildOpenClawAgentFileId('research', 'runbooks/README.md'),
        name: 'README.md',
        path: 'C:/OpenClaw/.openclaw/workspace-research/runbooks/README.md',
        category: 'artifact',
        language: 'markdown',
        size: '1 KB',
        updatedAt: '2026-03-23T00:00:00.000Z',
        status: 'synced',
        description: 'Nested runbook',
        content: '# Runbook',
        isReadonly: false,
      },
    ];

    const snapshot = await service.getAgentWorkbench({
      instanceId: 'instance-openclaw',
      workbench: nestedWorkbench,
      agentId: 'research',
    });

    assert.deepEqual(
      snapshot.files.map((file) => file.path),
      ['prompts/README.md', 'runbooks/README.md'],
    );
    assert.deepEqual(
      snapshot.files.map((file) => file.name),
      ['README.md', 'README.md'],
    );
  },
);

await runTest(
  'agentWorkbenchService normalizes raw OpenClaw agent ids when loading detail snapshots',
  async () => {
    const service = createAgentWorkbenchService({
      readOpenClawConfigSnapshot: async () =>
        ({
          root: {
            agents: {
              list: [
                {
                  id: 'Research Team',
                  name: 'Research Team',
                  default: true,
                  model: {
                    primary: 'anthropic/claude-3-7-sonnet',
                    fallbacks: ['openai/gpt-4.1'],
                  },
                },
              ],
            },
            channels: {
              telegram: {
                accounts: {
                  default: {
                    botToken: 'telegram-default',
                  },
                  research: {
                    botToken: 'telegram-research',
                  },
                },
              },
            },
            bindings: [
              {
                agentId: 'Research Team',
                match: {
                  channel: 'telegram',
                  accountId: 'research',
                },
              },
            ],
          },
          agentSnapshots: [],
          providerSnapshots: [],
          channelSnapshots: [],
        }) as any,
      openClawGatewayClient: {
        getSkillsStatus: async (_instanceId, args = {}) => {
          assert.equal(args.agentId, 'research-team');
          return {
            agentId: 'research-team',
            workspace: 'C:/OpenClaw/.openclaw/workspace-research',
            skills: [],
          };
        },
        getToolsCatalog: async (_instanceId, args = {}) => {
          assert.equal(args.agentId, 'research-team');
          return {
            agentId: 'research-team',
            profiles: [],
            groups: [],
          };
        },
      },
    });

    const rawWorkbench = createWorkbench();
    rawWorkbench.tasks = [
      {
        id: 'task-research',
        name: 'Research Digest',
        prompt: 'Digest',
        schedule: '0 9 * * *',
        scheduleMode: 'cron',
        scheduleConfig: {
          cronExpression: '0 9 * * *',
        },
        actionType: 'skill',
        status: 'active',
        sessionMode: 'isolated',
        wakeUpMode: 'immediate',
        executionContent: 'runAssistantTask',
        deliveryMode: 'publishSummary',
        agentId: 'Research Team',
      },
    ];
    rawWorkbench.agents = [
      {
        agent: {
          id: 'Research Team',
          name: 'Research Team',
          description: 'Research agent',
          avatar: 'R',
          systemPrompt: 'Research',
          creator: 'OpenClaw',
        },
        focusAreas: ['Analytics'],
        automationFitScore: 88,
        workspace: 'C:/OpenClaw/.openclaw/workspace-research',
        agentDir: 'C:/OpenClaw/.openclaw/agents/research-team/agent',
        isDefault: true,
      },
    ];
    rawWorkbench.files = [
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
    ];

    const snapshot = await service.getAgentWorkbench({
      instanceId: 'instance-openclaw',
      workbench: rawWorkbench,
      agentId: 'Research Team',
    });

    assert.equal(snapshot.model.source, 'agent');
    assert.equal(snapshot.model.primary, 'anthropic/claude-3-7-sonnet');
    assert.deepEqual(snapshot.model.fallbacks, ['openai/gpt-4.1']);
    assert.deepEqual(
      snapshot.tasks.map((task) => task.id),
      ['task-research'],
    );
    assert.deepEqual(
      snapshot.files.map((file) => file.path),
      ['AGENTS.md'],
    );
    assert.deepEqual(
      snapshot.channels.find((channel) => channel.id === 'telegram')?.accountIds,
      ['research'],
    );
  },
);

await runTest(
  'agentWorkbenchService keeps the detail panel renderable when a non-critical agent surface fails',
  async () => {
    const service = createAgentWorkbenchService({
      readOpenClawConfigSnapshot: async () => {
        throw new Error('OpenClaw config unavailable');
      },
      openClawGatewayClient: {
        getSkillsStatus: async () => {
          throw new Error('skills endpoint unavailable');
        },
        getToolsCatalog: async (_instanceId, args = {}) => ({
          agentId: typeof args.agentId === 'string' ? args.agentId : undefined,
          profiles: [],
          groups: [
            {
              id: 'group:reasoning',
              label: 'Reasoning',
              tools: [
                {
                  id: 'web.search',
                  label: 'Web Search',
                  description: 'Search the web',
                },
              ],
            },
          ],
        }),
      },
    });

    const snapshot = await service.getAgentWorkbench({
      instanceId: 'instance-openclaw',
      workbench: createWorkbench(),
      agentId: 'research',
    });

    assert.equal(snapshot.agent.agent.id, 'research');
    assert.deepEqual(snapshot.skills, []);
    assert.deepEqual(
      snapshot.tools.map((tool) => tool.id),
      ['web.search'],
    );
    assert.equal(snapshot.model.source, 'runtime');
  },
);

await runTest(
  'agentWorkbenchService infers workspace skill scope from canonical embedded workspace paths when agent workspace metadata is unavailable',
  async () => {
    const service = createAgentWorkbenchService({
      readOpenClawConfigSnapshot: async () => null as any,
      openClawGatewayClient: {
        getSkillsStatus: async (_instanceId, args = {}) => ({
          agentId: typeof args.agentId === 'string' ? args.agentId : 'research',
          skills: [
            {
              id: 'research-skill',
              name: 'Research Skill',
              description: 'Research workflows',
              author: 'OpenClaw',
              readme: '# Research Skill',
              bundled: false,
              skillKey: 'research-skill',
              source: 'local',
              filePath:
                'C:/OpenClaw/.openclaw/workspace-research/skills/research-skill/SKILL.md',
              baseDir: 'C:/OpenClaw/.openclaw/workspace-research/skills/research-skill',
              eligible: true,
              disabled: false,
              blockedByAllowlist: false,
            },
          ],
        }),
        getToolsCatalog: async () => ({ profiles: [], groups: [] }),
      } as any,
    });

    const workbench = createWorkbench();
    workbench.agents = workbench.agents.map((agent) =>
      agent.agent.id === 'research'
        ? {
            ...agent,
            workspace: undefined as any,
          }
        : agent,
    );

    const snapshot = await service.getAgentWorkbench({
      instanceId: 'instance-openclaw',
      workbench,
      agentId: 'research',
    });

    assert.equal(snapshot.skills[0]?.scope, 'workspace');
    assert.equal(
      snapshot.skills[0]?.baseDir,
      'C:/OpenClaw/.openclaw/workspace-research/skills/research-skill',
    );
  },
);

await runTest(
  'agentWorkbenchService reads config snapshot from kernelConfig.configFile without legacy path fields',
  async () => {
    const readConfigSnapshotCalls: string[] = [];
    const service = createAgentWorkbenchService({
      readOpenClawConfigSnapshot: async (configFile) => {
        readConfigSnapshotCalls.push(configFile);
        return {
          root: {},
          agentSnapshots: [],
          providerSnapshots: [],
          channelSnapshots: [],
        } as any;
      },
      openClawGatewayClient: {
        getSkillsStatus: async () => ({ skills: [] }),
        getToolsCatalog: async () => ({ profiles: [], groups: [] }),
      } as any,
    });

    const workbench = createWorkbench() as any;
    workbench.kernelConfig = {
      configFile: 'C:/Users/admin/.openclaw/openclaw.json',
      configRoot: 'C:/Users/admin/.openclaw',
      userRoot: 'C:/Users/admin',
      format: 'json',
      access: 'localFs',
      provenance: 'standardUserRoot',
      writable: true,
      resolved: true,
      schemaVersion: null,
    };
    await service.getAgentWorkbench({
      instanceId: 'instance-openclaw',
      workbench,
      agentId: 'research',
    });

    assert.deepEqual(readConfigSnapshotCalls, [
      'C:/Users/admin/.openclaw/openclaw.json',
    ]);
  },
);
