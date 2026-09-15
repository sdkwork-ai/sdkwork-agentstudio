// WORKSPACE-PATH:allow-fixture: fixtures name a foreign checkout root, drive, or home directory to exercise path handling, so the literal is the value under assertion rather than a binding this build resolves
import assert from 'node:assert/strict';
import type { AgentInstallTarget, KernelAgentLibraryItem } from '@sdkwork/agentstudio-pc-core';
import {
  filterChatAgentTemplates,
  resolveChatAgentMarketSelectedTargetId,
  resolveChatAgentPreferredKernelId,
  resolveChatAgentMarketSelectedTemplateId,
  resolveChatAgentTemplateKey,
  resolveChatAgentTemplateSelectionKey,
} from './chatAgentCreationDialogState.ts';

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

function createLibraryAgent(
  overrides: Partial<KernelAgentLibraryItem> = {},
): KernelAgentLibraryItem {
  return {
    sourceInstanceId: 'instance-a',
    sourceInstanceName: 'OpenClaw Alpha',
    sourceKernelId: 'openclaw',
    sourceInstanceHost: '127.0.0.1',
    sourceInstanceBuiltIn: true,
    sourceInstanceStatus: 'online',
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

function createInstallTarget(
  overrides: Partial<AgentInstallTarget> = {},
): AgentInstallTarget {
  return {
    id: 'instance-a',
    name: 'OpenClaw Alpha',
    kernelId: 'openclaw',
    typeLabel: 'Built-In OpenClaw',
    host: '127.0.0.1',
    status: 'online',
    deploymentMode: 'local-managed',
    isBuiltIn: true,
    configFile: 'D:/OpenClaw/.openclaw/openclaw.json',
    agentCount: 1,
    installedAgentIds: ['main'],
    installedTemplateIds: [],
    ...overrides,
  };
}

await runTest('filterChatAgentTemplates matches name, id, description, instance, and kernel fields case-insensitively', () => {
  const agents = [
    createLibraryAgent(),
    createLibraryAgent({
      sourceInstanceId: 'instance-b',
      sourceInstanceName: 'Hermes Beta',
      sourceKernelId: 'hermes',
      agentId: 'ops-responder',
      displayName: 'Ops Responder',
      description: 'Incident response workflow.',
    }),
  ];

  assert.deepEqual(
    filterChatAgentTemplates(agents, 'incident').map((agent) => agent.agentId),
    ['ops-responder'],
  );
  assert.deepEqual(
    filterChatAgentTemplates(agents, 'HERMES').map((agent) => agent.agentId),
    ['ops-responder'],
  );
  assert.deepEqual(
    filterChatAgentTemplates(agents, 'alpha').map((agent) => agent.agentId),
    ['research-analyst'],
  );
  assert.deepEqual(
    filterChatAgentTemplates(agents, 'research-analyst').map((agent) => agent.agentId),
    ['research-analyst'],
  );
});

await runTest('resolveChatAgentTemplateSelectionKey preserves valid selection and falls back predictably', () => {
  const firstAgent = createLibraryAgent();
  const secondAgent = createLibraryAgent({
    sourceInstanceId: 'instance-b',
    agentId: 'ops-responder',
    displayName: 'Ops Responder',
  });
  const firstKey = resolveChatAgentTemplateKey(firstAgent);
  const secondKey = resolveChatAgentTemplateKey(secondAgent);

  assert.equal(
    resolveChatAgentTemplateSelectionKey([firstAgent, secondAgent], secondKey),
    secondKey,
  );
  assert.equal(
    resolveChatAgentTemplateSelectionKey([firstAgent, secondAgent], 'missing:key'),
    firstKey,
  );
  assert.equal(resolveChatAgentTemplateSelectionKey([], secondKey), null);
});

await runTest('resolveChatAgentTemplateKey includes the source kernel so same-id agents across kernels remain distinct', () => {
  const openClawAgent = createLibraryAgent({
    sourceInstanceId: 'instance-a',
    sourceKernelId: 'openclaw',
    agentId: 'assistant',
  });
  const hermesAgent = createLibraryAgent({
    sourceInstanceId: 'instance-a',
    sourceKernelId: 'hermes',
    agentId: 'assistant',
  });

  assert.notEqual(
    resolveChatAgentTemplateKey(openClawAgent),
    resolveChatAgentTemplateKey(hermesAgent),
  );
});

await runTest('resolveChatAgentPreferredKernelId keeps a valid manual selection and otherwise prefers the source kernel before the default', () => {
  assert.equal(
    resolveChatAgentPreferredKernelId({
      availableKernelIds: ['openclaw', 'hermes'],
      selectedKernelId: 'hermes',
      sourceKernelId: 'openclaw',
      defaultKernelId: 'openclaw',
    }),
    'hermes',
  );

  assert.equal(
    resolveChatAgentPreferredKernelId({
      availableKernelIds: ['openclaw', 'hermes'],
      selectedKernelId: 'missing',
      sourceKernelId: 'hermes',
      defaultKernelId: 'openclaw',
    }),
    'hermes',
  );

  assert.equal(
    resolveChatAgentPreferredKernelId({
      availableKernelIds: ['openclaw', 'hermes'],
      selectedKernelId: null,
      sourceKernelId: 'missing',
      defaultKernelId: 'openclaw',
    }),
    'openclaw',
  );

  assert.equal(
    resolveChatAgentPreferredKernelId({
      availableKernelIds: ['openclaw', 'hermes'],
      selectedKernelId: null,
      sourceKernelId: null,
      defaultKernelId: 'missing',
    }),
    'openclaw',
  );

  assert.equal(
    resolveChatAgentPreferredKernelId({
      availableKernelIds: [],
      selectedKernelId: 'openclaw',
      sourceKernelId: 'hermes',
      defaultKernelId: 'openclaw',
    }),
    null,
  );
});

await runTest('resolveChatAgentMarketSelectedTemplateId preserves valid selection and otherwise falls back to the first template', () => {
  const templates = [
    { id: 'research-analyst' },
    { id: 'ops-responder' },
  ];

  assert.equal(
    resolveChatAgentMarketSelectedTemplateId(templates, 'ops-responder'),
    'ops-responder',
  );
  assert.equal(
    resolveChatAgentMarketSelectedTemplateId(templates, 'missing-template'),
    'research-analyst',
  );
  assert.equal(resolveChatAgentMarketSelectedTemplateId([], 'ops-responder'), null);
});

await runTest('resolveChatAgentMarketSelectedTargetId prefers an explicit valid target unless it is an installed target with a better alternative', () => {
  const targets = [
    createInstallTarget({
      id: 'instance-a',
      installedTemplateIds: ['research-analyst'],
    }),
    createInstallTarget({
      id: 'instance-b',
      name: 'OpenClaw Beta',
      isBuiltIn: false,
      deploymentMode: 'local-external',
      installedTemplateIds: [],
    }),
  ];

  assert.equal(
    resolveChatAgentMarketSelectedTargetId({
      targets,
      templateId: 'research-analyst',
      preferredTargetId: '',
      selectedTargetId: 'instance-a',
    }),
    'instance-b',
  );
  assert.equal(
    resolveChatAgentMarketSelectedTargetId({
      targets,
      templateId: 'research-analyst',
      preferredTargetId: 'instance-a',
      selectedTargetId: 'instance-a',
    }),
    'instance-a',
  );
  assert.equal(
    resolveChatAgentMarketSelectedTargetId({
      targets,
      templateId: 'research-analyst',
      preferredTargetId: '',
      selectedTargetId: 'instance-b',
    }),
    'instance-b',
  );
  assert.equal(
    resolveChatAgentMarketSelectedTargetId({
      targets: [],
      templateId: 'research-analyst',
      preferredTargetId: '',
      selectedTargetId: 'instance-a',
    }),
    '',
  );
});
