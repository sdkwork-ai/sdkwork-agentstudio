// WORKSPACE-PATH:allow-fixture: fixtures name a foreign checkout root, drive, or home directory to exercise path handling, so the literal is the value under assertion rather than a binding this build resolves
import assert from 'node:assert/strict';

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

let agentSnapshotServiceModule:
  | typeof import('./openClawAgentSnapshotService.ts')
  | undefined;

try {
  agentSnapshotServiceModule = await import('./openClawAgentSnapshotService.ts');
} catch {
  agentSnapshotServiceModule = undefined;
}

await runTest(
  'openClawAgentSnapshotService exposes config-root agent snapshot and path resolvers',
  () => {
    assert.ok(agentSnapshotServiceModule, 'Expected openClawAgentSnapshotService.ts to exist');
    assert.equal(
      typeof agentSnapshotServiceModule?.buildOpenClawAgentSnapshotsFromConfigRoot,
      'function',
    );
    assert.equal(
      typeof agentSnapshotServiceModule?.resolveOpenClawAgentPathsFromConfigRoot,
      'function',
    );
  },
);

await runTest(
  'openClawAgentSnapshotService builds effective agent snapshots from config root defaults and agent overrides',
  () => {
    const snapshots = agentSnapshotServiceModule?.buildOpenClawAgentSnapshotsFromConfigRoot(
      {
        agents: {
          defaults: {
            workspace: 'D:/OpenClaw/workspace',
            model: {
              primary: 'openai/gpt-4.1',
              fallbacks: ['openai/o4-mini'],
            },
            params: {
              temperature: 0.25,
              streaming: false,
              timeoutMs: 90000,
            },
          },
          list: [
            {
              id: 'main',
              default: true,
              name: 'Main',
              identity: {
                emoji: '*',
              },
            },
            {
              id: 'research',
              name: 'Research',
              identity: {
                emoji: 'R',
              },
              workspace: './workspace-research',
              agentDir: './agents/research-home/agent',
              model: {
                primary: 'openai/o4-mini',
                fallbacks: ['openai/gpt-4.1'],
              },
              params: {
                temperature: 0.4,
                maxTokens: 24000,
              },
            },
          ],
        },
      },
      'D:/OpenClaw/.openclaw/openclaw.json',
    );

    assert.equal(snapshots?.[0]?.id, 'main');
    assert.equal(snapshots?.[0]?.isDefault, true);
    assert.equal(snapshots?.[0]?.workspace, 'D:/OpenClaw/.openclaw/workspace');
    assert.equal(snapshots?.[0]?.agentDir, 'D:/OpenClaw/.openclaw/agents/main/agent');
    assert.deepEqual(snapshots?.[0]?.model, {
      primary: 'openai/gpt-4.1',
      fallbacks: ['openai/o4-mini'],
    });
    assert.deepEqual(snapshots?.[0]?.params, {
      temperature: 0.25,
      streaming: false,
      timeoutMs: 90000,
    });
    assert.deepEqual(snapshots?.[0]?.paramSources, {
      temperature: 'defaults',
      streaming: 'defaults',
      timeoutMs: 'defaults',
    });

    assert.equal(snapshots?.[1]?.id, 'research');
    assert.equal(snapshots?.[1]?.workspace, 'D:/OpenClaw/.openclaw/workspace-research');
    assert.equal(snapshots?.[1]?.agentDir, 'D:/OpenClaw/.openclaw/agents/research-home/agent');
    assert.deepEqual(snapshots?.[1]?.model, {
      primary: 'openai/o4-mini',
      fallbacks: ['openai/gpt-4.1'],
    });
    assert.deepEqual(snapshots?.[1]?.params, {
      temperature: 0.4,
      streaming: false,
      timeoutMs: 90000,
      maxTokens: 24000,
    });
    assert.deepEqual(snapshots?.[1]?.paramSources, {
      temperature: 'agent',
      streaming: 'defaults',
      timeoutMs: 'defaults',
      maxTokens: 'agent',
    });
  },
);

await runTest(
  'openClawAgentSnapshotService resolves effective agent paths from standard workspace roots and explicit overrides',
  () => {
    const research = agentSnapshotServiceModule?.resolveOpenClawAgentPathsFromConfigRoot({
      root: {
        agents: {
          defaults: {
            workspace: 'D:/OpenClaw/workspace',
          },
          list: [
            {
              id: 'main',
              default: true,
            },
          ],
        },
      },
      configFile: 'D:/OpenClaw/.openclaw/openclaw.json',
      agentId: 'research crew',
    });
    const main = agentSnapshotServiceModule?.resolveOpenClawAgentPathsFromConfigRoot({
      root: {
        agents: {
          defaults: {
            workspace: 'D:/OpenClaw/workspace',
          },
          list: [
            {
              id: 'main',
              default: true,
            },
          ],
        },
      },
      configFile: 'D:/OpenClaw/.openclaw/openclaw.json',
      agentId: 'main',
      workspace: './workspace-override',
      agentDir: './agents/custom-main/agent',
    });

    assert.deepEqual(research, {
      id: 'research-crew',
      workspace: 'D:/OpenClaw/.openclaw/workspace-research-crew',
      agentDir: 'D:/OpenClaw/.openclaw/agents/research-crew/agent',
      isDefault: false,
    });
    assert.deepEqual(main, {
      id: 'main',
      workspace: 'D:/OpenClaw/.openclaw/workspace-override',
      agentDir: 'D:/OpenClaw/.openclaw/agents/custom-main/agent',
      isDefault: true,
    });
  },
);
