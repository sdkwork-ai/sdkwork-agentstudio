// WORKSPACE-PATH:allow-fixture: fixtures name a foreign checkout root, drive, or home directory to exercise path handling, so the literal is the value under assertion rather than a binding this build resolves
import assert from 'node:assert/strict';
import {
  buildOpenClawAgentModelOptions,
  buildOpenClawAgentInputFromForm,
  buildOpenClawAgentDialogStateHandlers,
  buildOpenClawAgentParamEntries,
  createOpenClawAgentCreateDialogState,
  createOpenClawAgentEditDialogState,
  createOpenClawAgentFormStateFromLibraryAgent,
  createOpenClawAgentFormState,
  createOpenClawAgentWorkspaceResetState,
} from './openClawAgentPresentation.ts';
import type {
  InstanceWorkbenchAgent,
  InstanceWorkbenchLLMProvider,
} from '../types/index.ts';
import type { KernelAgentLibraryItem } from '@sdkwork/agentstudio-pc-core';

async function runTest(name: string, callback: () => void | Promise<void>) {
  try {
    await callback();
    console.log(`ok - ${name}`);
  } catch (error) {
    console.error(`not ok - ${name}`);
    throw error;
  }
}

function createWorkbenchAgent(
  overrides: Partial<InstanceWorkbenchAgent> = {},
): InstanceWorkbenchAgent {
  return {
    agent: {
      id: 'ops',
      name: 'Ops',
      description: 'Operations agent.',
      avatar: 'O',
      systemPrompt: 'Handle incidents.',
      creator: 'OpenClaw',
    },
    focusAreas: ['Operations'],
    automationFitScore: 82,
    workspace: 'D:/OpenClaw/.openclaw/workspace',
    agentDir: 'D:/OpenClaw/.openclaw/agents/ops/agent',
    isDefault: true,
    model: {
      primary: 'openai/gpt-5.4',
      fallbacks: ['openai/gpt-4.1'],
    },
    params: {
      temperature: 0.4,
      topP: 0.9,
      timeoutMs: 90000,
      streaming: false,
    },
    paramSources: {
      temperature: 'defaults',
      topP: 'agent',
      timeoutMs: 'defaults',
      streaming: 'defaults',
    },
    configSource: 'configFile',
    ...overrides,
  };
}

await runTest(
  'createOpenClawAgentFormState keeps defaults-sourced agent fields inherited instead of copying them into explicit edits',
  () => {
    const draft = createOpenClawAgentFormState(createWorkbenchAgent(), 'defaults');

    assert.equal(draft.primaryModel, '');
    assert.equal(draft.fallbackModelsText, '');
    assert.equal(draft.fieldSources.model, 'defaults');
    assert.equal(draft.inherited.primaryModel, 'openai/gpt-5.4');
    assert.equal(draft.inherited.fallbackModelsText, 'openai/gpt-4.1');

    assert.equal(draft.temperature, '');
    assert.equal(draft.inherited.temperature, '0.4');
    assert.equal(draft.topP, '0.9');
    assert.equal(draft.inherited.topP, '');
    assert.equal(draft.timeoutMs, '');
    assert.equal(draft.inherited.timeoutMs, '90000');
    assert.equal(draft.streamingMode, 'inherit');
    assert.equal(draft.inherited.streaming, false);
  },
);

await runTest(
  'buildOpenClawAgentInputFromForm omits inherited defaults while preserving explicit per-agent overrides',
  () => {
    const draft = createOpenClawAgentFormState(createWorkbenchAgent(), 'defaults');
    const input = buildOpenClawAgentInputFromForm(draft);

    assert.equal(input.id, 'ops');
    assert.equal(input.model, null);
    assert.deepEqual(input.params, {
      topP: 0.9,
    });
  },
);

await runTest(
  'buildOpenClawAgentInputFromForm writes explicit streaming and fallback-only model overrides when the user chooses them',
  () => {
    const draft = createOpenClawAgentFormState(null);
    draft.id = 'research';
    draft.primaryModel = '';
    draft.fallbackModelsText = 'openai/gpt-4.1\nopenai/gpt-4.1\nanthropic/claude-3-7-sonnet';
    draft.streamingMode = 'enabled';
    draft.timeoutMs = '120000';

    const input = buildOpenClawAgentInputFromForm(draft);

    assert.deepEqual(input.model, {
      primary: undefined,
      fallbacks: ['openai/gpt-4.1', 'anthropic/claude-3-7-sonnet'],
    });
    assert.deepEqual(input.params, {
      timeoutMs: 120000,
      streaming: true,
    });
  },
);

await runTest(
  'buildOpenClawAgentParamEntries keeps stable param ordering and source metadata for the workbench UI',
  () => {
    const entries = buildOpenClawAgentParamEntries(createWorkbenchAgent());

    assert.deepEqual(entries, [
      {
        key: 'temperature',
        value: '0.4',
        source: 'defaults',
      },
      {
        key: 'topP',
        value: '0.9',
        source: 'agent',
      },
      {
        key: 'timeoutMs',
        value: '90000',
        source: 'defaults',
      },
      {
        key: 'streaming',
        value: 'false',
        source: 'defaults',
      },
    ]);
  },
);

await runTest(
  'buildOpenClawAgentModelOptions normalizes legacy provider ids, deduplicates repeated model refs, and keeps the first label',
  () => {
    const options = buildOpenClawAgentModelOptions([
      {
        id: ' api-router-openai ',
        name: 'OpenAI',
        models: [
          { id: 'gpt-5.4', name: 'GPT-5.4' },
          { id: 'gpt-4.1', name: 'GPT-4.1' },
        ],
      },
      {
        id: 'openai',
        name: 'OpenAI Mirror',
        models: [
          { id: 'gpt-5.4', name: 'GPT-5.4 Mirror' },
          { id: 'gpt-4.1-mini', name: 'GPT-4.1 Mini' },
        ],
      },
    ] as InstanceWorkbenchLLMProvider[]);

    assert.deepEqual(options, [
      {
        value: 'openai/gpt-5.4',
        label: 'OpenAI / GPT-5.4',
      },
      {
        value: 'openai/gpt-4.1',
        label: 'OpenAI / GPT-4.1',
      },
      {
        value: 'openai/gpt-4.1-mini',
        label: 'OpenAI Mirror / GPT-4.1 Mini',
      },
    ]);
  },
);

await runTest(
  'buildOpenClawAgentModelOptions preserves already-qualified OpenRouter model refs whose ids already contain provider prefixes',
  () => {
    const options = buildOpenClawAgentModelOptions([
      {
        id: 'openrouter',
        name: 'OpenRouter',
        models: [
          {
            id: 'openrouter/meta-llama/llama-3.1-8b-instruct',
            name: 'Llama 3.1 8B Instruct',
          },
          {
            id: 'anthropic/claude-3.7-sonnet',
            name: 'Claude 3.7 Sonnet',
          },
        ],
      },
    ] as InstanceWorkbenchLLMProvider[]);

    assert.deepEqual(options, [
      {
        value: 'openrouter/meta-llama/llama-3.1-8b-instruct',
        label: 'OpenRouter / Llama 3.1 8B Instruct',
      },
      {
        value: 'anthropic/claude-3.7-sonnet',
        label: 'OpenRouter / Claude 3.7 Sonnet',
      },
    ]);
  },
);

await runTest(
  'buildOpenClawAgentModelOptions tolerates missing providers and empty model catalogs',
  () => {
    assert.deepEqual(buildOpenClawAgentModelOptions(undefined), []);
    assert.deepEqual(
      buildOpenClawAgentModelOptions([
        {
          id: 'anthropic',
          name: 'Anthropic',
          models: [],
        },
      ] as InstanceWorkbenchLLMProvider[]),
      [],
    );
  },
);

await runTest(
  'createOpenClawAgentCreateDialogState returns a fresh draft with no editing agent selected',
  () => {
    const dialogState = createOpenClawAgentCreateDialogState();

    assert.equal(dialogState.editingAgentId, null);
    assert.deepEqual(dialogState.draft, createOpenClawAgentFormState(null));
  },
);

await runTest(
  'createOpenClawAgentFormStateFromLibraryAgent creates a portable copy draft with cloned parameters and a copy-safe id',
  () => {
    const draft = createOpenClawAgentFormStateFromLibraryAgent({
      sourceInstanceId: 'instance-2',
      sourceInstanceName: 'Research Instance',
      sourceKernelId: 'hermes',
      sourceInstanceHost: 'local',
      sourceInstanceBuiltIn: false,
      sourceInstanceStatus: 'running',
      sourceConfigFile: '/workspace/openclaw.json',
      agentId: 'research-agent',
      displayName: 'Research Agent',
      avatar: 'RA',
      description: 'Synthesizes findings.',
      isDefault: true,
      workspace: '/workspace/research',
      agentDir: '.agents/research-agent',
      model: {
        primary: 'anthropic/claude-sonnet-4',
        fallbacks: ['openai/gpt-5.4'],
      },
      params: {
        temperature: 0.3,
        topP: 0.8,
        maxTokens: 16000,
        timeoutMs: 120000,
        streaming: true,
      },
    } satisfies KernelAgentLibraryItem);

    assert.equal(draft.id, 'research-agent-copy');
    assert.equal(draft.name, 'Research Agent Copy');
    assert.equal(draft.avatar, 'RA');
    assert.equal(draft.primaryModel, 'anthropic/claude-sonnet-4');
    assert.equal(draft.fallbackModelsText, 'openai/gpt-5.4');
    assert.equal(draft.workspace, '');
    assert.equal(draft.agentDir, '');
    assert.equal(draft.temperature, '0.3');
    assert.equal(draft.topP, '0.8');
    assert.equal(draft.maxTokens, '16000');
    assert.equal(draft.timeoutMs, '120000');
    assert.equal(draft.streamingMode, 'enabled');
    assert.equal(draft.isDefault, false);
    assert.equal(draft.fieldSources.model, 'agent');
  },
);

await runTest(
  'createOpenClawAgentEditDialogState inherits the selected workbench model source when editing the active agent',
  () => {
    const agent = createWorkbenchAgent();
    const dialogState = createOpenClawAgentEditDialogState({
      agent,
      selectedAgentWorkbench: {
        agent,
        model: {
          primary: 'openai/gpt-5.4',
          fallbacks: ['openai/gpt-4.1'],
          source: 'defaults',
        },
      },
    });

    assert.equal(dialogState.editingAgentId, 'ops');
    assert.equal(dialogState.draft.fieldSources.model, 'defaults');
    assert.equal(dialogState.draft.primaryModel, '');
    assert.equal(dialogState.draft.inherited.primaryModel, 'openai/gpt-5.4');
  },
);

await runTest(
  'createOpenClawAgentEditDialogState falls back to agent-owned model source when the selected workbench belongs to another agent',
  () => {
    const activeAgent = createWorkbenchAgent();
    const editedAgent = createWorkbenchAgent({
      agent: {
        id: 'research',
        name: 'Research',
        description: 'Research agent.',
        avatar: 'R',
        systemPrompt: 'Synthesize findings.',
        creator: 'OpenClaw',
      },
      isDefault: false,
      model: {
        primary: 'openai/gpt-4.1',
        fallbacks: ['openai/gpt-4o-mini'],
      },
    });
    const dialogState = createOpenClawAgentEditDialogState({
      agent: editedAgent,
      selectedAgentWorkbench: {
        agent: activeAgent,
        model: {
          primary: 'openai/gpt-5.4',
          fallbacks: ['openai/gpt-4.1'],
          source: 'defaults',
        },
      },
    });

    assert.equal(dialogState.editingAgentId, 'research');
    assert.equal(dialogState.draft.fieldSources.model, 'agent');
    assert.equal(dialogState.draft.primaryModel, 'openai/gpt-4.1');
    assert.equal(dialogState.draft.inherited.primaryModel, '');
  },
);

await runTest(
  'createOpenClawAgentWorkspaceResetState centralizes the page reset baseline for agent workbench state',
  () => {
    assert.deepEqual(createOpenClawAgentWorkspaceResetState(), {
      isCreationWorkflowOpen: false,
      isDialogOpen: false,
      selectedAgentId: null,
      selectedAgentWorkbench: null,
      workbenchError: null,
      isWorkbenchLoading: false,
      dialogState: {
        editingAgentId: null,
        draft: createOpenClawAgentFormState(null),
      },
      deleteId: null,
      isInstallingSkill: false,
      updatingSkillKeys: [],
      removingSkillKeys: [],
    });
  },
);

await runTest(
  'buildOpenClawAgentDialogStateHandlers routes create and edit dialog state through page-owned setters',
  () => {
    const captured = {
      editingAgentId: 'stale' as string | null,
      draft: createOpenClawAgentFormState(null),
      isDialogOpen: false,
    };
    const activeAgent = createWorkbenchAgent();
    const editedAgent = createWorkbenchAgent({
      agent: {
        id: 'research',
        name: 'Research',
        description: 'Research agent.',
        avatar: 'R',
        systemPrompt: 'Synthesize findings.',
        creator: 'OpenClaw',
      },
      isDefault: false,
    });

    const handlers = buildOpenClawAgentDialogStateHandlers({
      selectedAgentWorkbench: {
        agent: activeAgent,
        model: {
          primary: 'openai/gpt-5.4',
          fallbacks: ['openai/gpt-4.1'],
          source: 'defaults',
        },
      },
      setEditingAgentId: (value) => {
        captured.editingAgentId = value;
      },
      setAgentDialogDraft: (value) => {
        captured.draft = value;
      },
      setIsAgentDialogOpen: (value) => {
        captured.isDialogOpen = value;
      },
    });

    handlers.openCreateAgentDialog();
    assert.equal(captured.editingAgentId, null);
    assert.deepEqual(captured.draft, createOpenClawAgentFormState(null));
    assert.equal(captured.isDialogOpen, true);

    handlers.openEditAgentDialog(editedAgent);
    assert.equal(captured.editingAgentId, 'research');
    assert.equal(captured.draft.id, 'research');
    assert.equal(captured.draft.fieldSources.model, 'agent');
    assert.equal(captured.isDialogOpen, true);
  },
);
