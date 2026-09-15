// WORKSPACE-PATH:allow-fixture: fixtures name a foreign checkout root, drive, or home directory to exercise path handling, so the literal is the value under assertion rather than a binding this build resolves
import assert from 'node:assert/strict';
import {
  buildTaskAgentSelectState,
  createOpenClawAgentCatalogService,
  DEFAULT_TASK_AGENT_SELECT_VALUE,
} from './openClawAgentCatalogService.ts';

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

await runTest(
  'openclaw agent catalog merges config-backed defaults with runtime workbench agents',
  async () => {
    const service = createOpenClawAgentCatalogService({
      getInstanceDetail: async () =>
        ({
          instance: {
            id: 'instance-openclaw',
            runtimeKind: 'openclaw',
          },
          dataAccess: {
            routes: [
              {
                scope: 'config',
                mode: 'managedFile',
                target: 'D:/OpenClaw/.openclaw/openclaw.json',
              },
            ],
          },
          workbench: {
            agents: [
              {
                agent: {
                  id: 'main',
                  name: 'Main Agent',
                  description: 'General assistant',
                  avatar: 'M',
                  systemPrompt: 'You are Main.',
                  creator: 'OpenClaw',
                },
                focusAreas: ['General'],
                automationFitScore: 84,
              },
            ],
          },
        }) as any,
      resolveAttachedKernelConfigFile: (detail) =>
        detail?.dataAccess?.routes?.[0]?.target ?? null,
      readOpenClawConfigSnapshot: async (configFile) => {
        assert.equal(configFile, 'D:/OpenClaw/.openclaw/openclaw.json');
        return ({
          agentSnapshots: [
            {
              id: 'research',
              name: 'Research Agent',
              avatar: 'R',
              description: 'Deep research assistant',
              workspace: 'D:/OpenClaw/.openclaw/workspace-research',
              agentDir: 'D:/OpenClaw/.openclaw/agents/research/agent',
              isDefault: true,
              model: {
                primary: 'anthropic/claude-3-7-sonnet',
                fallbacks: [],
              },
              params: {},
            },
            {
              id: 'main',
              name: 'Main Agent',
              avatar: 'M',
              description: 'General assistant',
              workspace: 'D:/OpenClaw/.openclaw/workspace',
              agentDir: 'D:/OpenClaw/.openclaw/agents/main/agent',
              isDefault: false,
              model: {
                fallbacks: [],
              },
              params: {},
            },
          ],
          configFile,
        }) as any;
      },
    });

    const catalog = await service.getCatalog('instance-openclaw');

    assert.equal(catalog.defaultAgentId, 'research');
    assert.deepEqual(
      catalog.agents.map((agent) => ({
        id: agent.id,
        name: agent.name,
        isDefault: agent.isDefault,
      })),
      [
        {
          id: 'research',
          name: 'Research Agent',
          isDefault: true,
        },
        {
          id: 'main',
          name: 'Main Agent',
          isDefault: false,
        },
      ],
    );
  },
);

await runTest(
  'openclaw agent catalog falls back to runtime workbench agents when config snapshot loading fails',
  async () => {
    const service = createOpenClawAgentCatalogService({
      getInstanceDetail: async () =>
        ({
          instance: {
            id: 'instance-openclaw',
            runtimeKind: 'openclaw',
          },
          dataAccess: {
            routes: [
              {
                scope: 'config',
                mode: 'managedFile',
                target: 'D:/OpenClaw/.openclaw/openclaw.json',
              },
            ],
          },
          workbench: {
            agents: [
              {
                agent: {
                  id: 'main',
                  name: 'Main Agent',
                  description: 'General assistant',
                  avatar: 'M',
                  systemPrompt: 'You are Main.',
                  creator: 'OpenClaw',
                },
                focusAreas: ['General'],
                automationFitScore: 84,
              },
              {
                agent: {
                  id: 'ops',
                  name: 'Ops Agent',
                  description: 'Operations assistant',
                  avatar: 'O',
                  systemPrompt: 'You are Ops.',
                  creator: 'OpenClaw',
                },
                focusAreas: ['Ops'],
                automationFitScore: 76,
              },
            ],
          },
        }) as any,
      resolveAttachedKernelConfigFile: (detail) =>
        detail?.dataAccess?.routes?.[0]?.target ?? null,
      readOpenClawConfigSnapshot: async () => {
        throw new Error('config unavailable');
      },
    });

    const catalog = await service.getCatalog('instance-openclaw');

    assert.equal(catalog.defaultAgentId, 'main');
    assert.deepEqual(
      catalog.agents.map((agent) => ({
        id: agent.id,
        isDefault: agent.isDefault,
      })),
      [
        {
          id: 'main',
          isDefault: true,
        },
        {
          id: 'ops',
          isDefault: false,
        },
      ],
    );
  },
);

await runTest(
  'openclaw agent catalog reads live gateway agents for OpenClaw-compatible runtimes without local config files',
  async () => {
    const service = createOpenClawAgentCatalogService({
      getInstanceDetail: async () =>
        ({
          instance: {
            id: 'instance-gateway-compatible',
            runtimeKind: 'custom',
            transportKind: 'openclawGatewayWs',
          },
          connectivity: {
            primaryTransport: 'openclawGatewayWs',
          },
          workbench: null,
        }) as any,
      resolveAttachedKernelConfigFile: () => null,
      readOpenClawConfigSnapshot: async () => {
        throw new Error('local config should not be required');
      },
      getOpenClawGatewayConfig: async (instanceId) => {
        assert.equal(instanceId, 'instance-gateway-compatible');
        return {
          path: '/runtime/openclaw.json',
          config: {
            agents: {
              list: [
                {
                  id: 'main',
                  name: 'Main',
                  default: true,
                },
              ],
            },
          },
        };
      },
      listOpenClawGatewayAgents: async (instanceId) => {
        assert.equal(instanceId, 'instance-gateway-compatible');
        return {
          agents: [
            {
              id: 'main',
              name: 'Main',
              description: 'Default runtime agent',
              identity: {
                emoji: 'M',
              },
            },
            {
              id: 'research-agent',
              name: 'Research Agent',
              description: 'Created from chat',
              avatar: 'R',
              systemPrompt: 'You are Research.',
              creator: 'OpenClaw',
            },
          ],
        };
      },
    });

    const catalog = await service.getCatalog('instance-gateway-compatible');

    assert.equal(catalog.defaultAgentId, 'main');
    assert.deepEqual(
      catalog.agents.map((agent) => ({
        id: agent.id,
        name: agent.name,
        description: agent.description,
        avatar: agent.avatar,
        systemPrompt: agent.systemPrompt,
        isDefault: agent.isDefault,
      })),
      [
        {
          id: 'main',
          name: 'Main',
          description: 'Default runtime agent',
          avatar: 'M',
          systemPrompt: '',
          isDefault: true,
        },
        {
          id: 'research-agent',
          name: 'Research Agent',
          description: 'Created from chat',
          avatar: 'R',
          systemPrompt: 'You are Research.',
          isDefault: false,
        },
      ],
    );
  },
);

await runTest(
  'task agent select state keeps a default routing option and preserves unavailable agent bindings',
  () => {
    const state = buildTaskAgentSelectState({
      catalog: {
        defaultAgentId: 'research',
        agents: [
          {
            id: 'research',
            name: 'Research Agent',
            description: 'Deep research assistant',
            avatar: 'R',
            systemPrompt: 'You are Research.',
            creator: 'OpenClaw',
            isDefault: true,
          },
          {
            id: 'main',
            name: 'Main Agent',
            description: 'General assistant',
            avatar: 'M',
            systemPrompt: 'You are Main.',
            creator: 'OpenClaw',
            isDefault: false,
          },
        ],
      },
      selectedAgentId: 'ops',
    });

    assert.equal(state.value, 'ops');
    assert.deepEqual(
      state.options.map((option) => ({
        value: option.value,
        agentId: option.agentId,
        missing: option.missing,
        defaultRoute: option.defaultRoute,
        defaultAgent: option.defaultAgent,
      })),
      [
        {
          value: DEFAULT_TASK_AGENT_SELECT_VALUE,
          agentId: null,
          missing: false,
          defaultRoute: true,
          defaultAgent: false,
        },
        {
          value: 'research',
          agentId: 'research',
          missing: false,
          defaultRoute: false,
          defaultAgent: true,
        },
        {
          value: 'main',
          agentId: 'main',
          missing: false,
          defaultRoute: false,
          defaultAgent: false,
        },
        {
          value: 'ops',
          agentId: 'ops',
          missing: true,
          defaultRoute: false,
          defaultAgent: false,
        },
      ],
    );
  },
);
