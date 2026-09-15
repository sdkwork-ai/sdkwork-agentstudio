// WORKSPACE-PATH:allow-fixture: fixtures name a foreign checkout root, drive, or home directory to exercise path handling, so the literal is the value under assertion rather than a binding this build resolves
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';

function runTest(name: string, fn: () => void | Promise<void>) {
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

async function loadAgentSkillMutationSupportModule() {
  const moduleUrl = new URL('./openClawAgentSkillMutationSupport.ts', import.meta.url);

  assert.ok(
    existsSync(moduleUrl),
    'expected openClawAgentSkillMutationSupport.ts to exist',
  );

  return import('./openClawAgentSkillMutationSupport.ts');
}

await runTest(
  'createOpenClawAgentSkillMutationRunner executes the injected install action, reloads the workbench, and preserves page-owned boolean pending hooks',
  async () => {
    const { createOpenClawAgentSkillMutationRunner } =
      await loadAgentSkillMutationSupportModule();
    const pendingStates: boolean[] = [];
    const callLog: string[] = [];

    const runAgentSkillMutation = createOpenClawAgentSkillMutationRunner({
      reloadWorkbench: async (instanceId, options) => {
        callLog.push(`reload:${instanceId}:${options.withSpinner}`);
      },
      reportSuccess: (message) => {
        callLog.push(`success:${message}`);
      },
      reportError: (message) => {
        callLog.push(`error:${message}`);
      },
      t: (key: string) => `translated:${key}`,
    });

    await runAgentSkillMutation({
      instanceId: 'instance-01',
      kind: 'install',
      setPending: (value: boolean) => {
        pendingStates.push(value);
      },
      execute: async () => {
        callLog.push('install:skill');
      },
      successKey: 'instances.detail.instanceWorkbench.agents.toasts.skillInstalled',
      failureKey: 'instances.detail.instanceWorkbench.agents.toasts.skillInstallFailed',
    });

    assert.deepEqual(pendingStates, [true, false]);
    assert.deepEqual(callLog, [
      'install:skill',
      'success:translated:instances.detail.instanceWorkbench.agents.toasts.skillInstalled',
      'reload:instance-01:false',
    ]);
  },
);

await runTest(
  'createOpenClawAgentSkillMutationRunner tracks keyed pending skill mutations and reports fallback errors through the page reporter',
  async () => {
    const { createOpenClawAgentSkillMutationRunner } =
      await loadAgentSkillMutationSupportModule();
    const pendingSnapshots: string[][] = [];
    let currentPending: string[] = [];
    const reportedErrors: string[] = [];

    const runAgentSkillMutation = createOpenClawAgentSkillMutationRunner({
      reloadWorkbench: async () => undefined,
      reportSuccess: () => undefined,
      reportError: (message) => {
        reportedErrors.push(message);
      },
      t: (key: string) => `translated:${key}`,
    });

    await runAgentSkillMutation({
      instanceId: 'instance-01',
      kind: 'toggle',
      pendingKey: 'calendar',
      setPendingKeys: (updater) => {
        currentPending = updater(currentPending);
        pendingSnapshots.push([...currentPending]);
      },
      execute: async () => {
        throw new Error('');
      },
      successKey: 'instances.detail.instanceWorkbench.agents.toasts.skillEnabled',
      failureKey: 'instances.detail.instanceWorkbench.agents.toasts.skillUpdateFailed',
    });

    assert.deepEqual(pendingSnapshots, [['calendar'], []]);
    assert.deepEqual(reportedErrors, [
      'translated:instances.detail.instanceWorkbench.agents.toasts.skillUpdateFailed',
    ]);
  },
);

await runTest(
  'buildOpenClawAgentSkillInstallMutationRequest skips when the page lacks an instance id or selected agent and builds the install payload through the injected page callback',
  async () => {
    const { buildOpenClawAgentSkillInstallMutationRequest } =
      await loadAgentSkillMutationSupportModule();
    const capturedInputs: any[] = [];

    assert.deepEqual(
      buildOpenClawAgentSkillInstallMutationRequest({
        instanceId: undefined,
        selectedAgent: {
          agent: {
            agent: {
              id: 'ops',
            },
            isDefault: true,
          },
        } as any,
        slug: 'calendar',
        setPending: () => undefined,
        executeInstall: async (input) => {
          capturedInputs.push(input);
        },
      }),
      {
        kind: 'skip',
      },
    );

    const requestResult = buildOpenClawAgentSkillInstallMutationRequest({
      instanceId: 'instance-01',
      selectedAgent: {
        agent: {
          agent: {
            id: 'ops',
          },
          isDefault: true,
        },
      } as any,
      slug: 'calendar',
      setPending: () => undefined,
      executeInstall: async (input) => {
        capturedInputs.push(input);
      },
    });

    assert.equal(requestResult.kind, 'mutation');
    assert.equal(requestResult.request.instanceId, 'instance-01');
    assert.equal(requestResult.request.kind, 'install');
    assert.equal(
      requestResult.request.successKey,
      'instances.detail.instanceWorkbench.agents.toasts.skillInstalled',
    );
    assert.equal(
      requestResult.request.failureKey,
      'instances.detail.instanceWorkbench.agents.toasts.skillInstallFailed',
    );

    await requestResult.request.execute();

    assert.deepEqual(capturedInputs, [
      {
        instanceId: 'instance-01',
        agentId: 'ops',
        isDefaultAgent: true,
        slug: 'calendar',
      },
    ]);
  },
);

await runTest(
  'buildOpenClawAgentSkillRemoveMutationRequest builds the removal payload through the injected page callback while preserving workspace-scoped fields',
  async () => {
    const { buildOpenClawAgentSkillRemoveMutationRequest } =
      await loadAgentSkillMutationSupportModule();
    const capturedInputs: any[] = [];

    const requestResult = buildOpenClawAgentSkillRemoveMutationRequest({
      instanceId: 'instance-01',
      selectedAgent: {
        paths: {
          workspacePath: 'D:/OpenClaw/.openclaw/workspace',
        },
      } as any,
      skill: {
        skillKey: 'calendar',
        scope: 'workspace',
        baseDir: 'D:/OpenClaw/.openclaw/workspace/skills/calendar',
        filePath: 'D:/OpenClaw/.openclaw/workspace/skills/calendar/index.ts',
      } as any,
      setPendingKeys: () => undefined,
      executeRemove: async (input) => {
        capturedInputs.push(input);
      },
    });

    assert.equal(requestResult.kind, 'mutation');
    assert.equal(requestResult.request.kind, 'remove');
    assert.equal(requestResult.request.pendingKey, 'calendar');
    assert.equal(
      requestResult.request.successKey,
      'instances.detail.instanceWorkbench.agents.toasts.skillRemoved',
    );
    assert.equal(
      requestResult.request.failureKey,
      'instances.detail.instanceWorkbench.agents.toasts.skillRemoveFailed',
    );

    await requestResult.request.execute();

    assert.deepEqual(capturedInputs, [
      {
        instanceId: 'instance-01',
        skillKey: 'calendar',
        scope: 'workspace',
        workspacePath: 'D:/OpenClaw/.openclaw/workspace',
        baseDir: 'D:/OpenClaw/.openclaw/workspace/skills/calendar',
        filePath: 'D:/OpenClaw/.openclaw/workspace/skills/calendar/index.ts',
      },
    ]);
  },
);

await runTest(
  'buildOpenClawAgentSkillToggleMutationRequest builds the toggle payload and success key through the injected page callback',
  async () => {
    const { buildOpenClawAgentSkillToggleMutationRequest } =
      await loadAgentSkillMutationSupportModule();
    const capturedInputs: any[] = [];

    const requestResult = buildOpenClawAgentSkillToggleMutationRequest({
      instanceId: 'instance-01',
      skillKey: 'calendar',
      enabled: false,
      setPendingKeys: () => undefined,
      executeToggle: async (input) => {
        capturedInputs.push(input);
      },
    });

    assert.equal(requestResult.kind, 'mutation');
    assert.equal(requestResult.request.kind, 'toggle');
    assert.equal(requestResult.request.pendingKey, 'calendar');
    assert.equal(
      requestResult.request.successKey,
      'instances.detail.instanceWorkbench.agents.toasts.skillDisabled',
    );
    assert.equal(
      requestResult.request.failureKey,
      'instances.detail.instanceWorkbench.agents.toasts.skillUpdateFailed',
    );

    await requestResult.request.execute();

    assert.deepEqual(capturedInputs, [
      {
        instanceId: 'instance-01',
        skillKey: 'calendar',
        enabled: false,
      },
    ]);
  },
);

await runTest(
  'buildOpenClawAgentSkillMutationHandlers routes install, toggle, and remove through injected page-owned mutation execution',
  async () => {
    const { buildOpenClawAgentSkillMutationHandlers } =
      await loadAgentSkillMutationSupportModule();
    const executedRequests: any[] = [];

    const skippedHandlers = buildOpenClawAgentSkillMutationHandlers({
      instanceId: undefined,
      selectedAgent: null,
      setInstallingSkill: () => undefined,
      setUpdatingSkillKeys: () => undefined,
      setRemovingSkillKeys: () => undefined,
      executeInstall: async () => undefined,
      executeToggle: async () => undefined,
      executeRemove: async () => undefined,
      executeMutation: async (request) => {
        executedRequests.push(request);
      },
    });

    await skippedHandlers.onInstallAgentSkill('calendar');
    await skippedHandlers.onSetAgentSkillEnabled('calendar', true);
    await skippedHandlers.onRemoveAgentSkill({
      skillKey: 'calendar',
      scope: 'workspace',
      baseDir: 'D:/OpenClaw/.openclaw/workspace/skills/calendar',
      filePath: 'D:/OpenClaw/.openclaw/workspace/skills/calendar/index.ts',
    });

    assert.deepEqual(executedRequests, []);

    const activeHandlers = buildOpenClawAgentSkillMutationHandlers({
      instanceId: 'instance-01',
      selectedAgent: {
        agent: {
          agent: {
            id: 'ops',
          },
          isDefault: true,
        },
        paths: {
          workspacePath: 'D:/OpenClaw/.openclaw/workspace',
        },
      } as any,
      setInstallingSkill: () => undefined,
      setUpdatingSkillKeys: () => undefined,
      setRemovingSkillKeys: () => undefined,
      executeInstall: async () => undefined,
      executeToggle: async () => undefined,
      executeRemove: async () => undefined,
      executeMutation: async (request) => {
        executedRequests.push(request);
      },
    });

    await activeHandlers.onInstallAgentSkill('calendar');
    await activeHandlers.onSetAgentSkillEnabled('calendar', false);
    await activeHandlers.onRemoveAgentSkill({
      skillKey: 'calendar',
      scope: 'workspace',
      baseDir: 'D:/OpenClaw/.openclaw/workspace/skills/calendar',
      filePath: 'D:/OpenClaw/.openclaw/workspace/skills/calendar/index.ts',
    });

    assert.equal(executedRequests.length, 3);
    assert.equal(executedRequests[0].kind, 'install');
    assert.equal(executedRequests[1].kind, 'toggle');
    assert.equal(executedRequests[2].kind, 'remove');
  },
);
