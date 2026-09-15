// WORKSPACE-PATH:allow-fixture: fixtures name a foreign checkout root, drive, or home directory to exercise path handling, so the literal is the value under assertion rather than a binding this build resolves
import assert from 'node:assert/strict';
import { createOpenClawChatAgentCatalogService } from './openClawChatAgentCatalogService.ts';

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
  'openclaw chat agent catalog merges config-backed default agent routing with workbench agent profiles',
  async () => {
    const service = createOpenClawChatAgentCatalogService({
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
                  id: 'research',
                  name: 'Research Agent',
                  description: 'Deep research assistant',
                  avatar: 'R',
                  systemPrompt: 'You are Research.',
                  creator: 'OpenClaw',
                },
                focusAreas: ['Research'],
                automationFitScore: 97,
              },
            ],
          },
        }) as any,
      resolveAttachedKernelConfigFile: (detail) =>
        detail?.dataAccess?.routes?.[0]?.target ?? null,
      readOpenClawConfigSnapshot: async (configFile) =>
        ({
          agentSnapshots: [
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
          ],
          configFile,
        }) as any,
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
