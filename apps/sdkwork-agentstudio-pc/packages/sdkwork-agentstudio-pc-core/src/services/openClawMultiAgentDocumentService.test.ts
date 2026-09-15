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

let multiAgentDocumentServiceModule:
  | typeof import('./openClawMultiAgentDocumentService.ts')
  | undefined;

try {
  multiAgentDocumentServiceModule = await import('./openClawMultiAgentDocumentService.ts');
} catch {
  multiAgentDocumentServiceModule = undefined;
}

await runTest(
  'openClawMultiAgentDocumentService exposes multi-agent document helpers',
  () => {
    assert.ok(
      multiAgentDocumentServiceModule,
      'Expected openClawMultiAgentDocumentService.ts to exist',
    );
    assert.equal(
      typeof multiAgentDocumentServiceModule?.configureOpenClawMultiAgentSupportInConfigRoot,
      'function',
    );
  },
);

await runTest(
  'openClawMultiAgentDocumentService restores the coordinator, merges allowlists, and preserves explicit user overrides',
  () => {
    const root = {
      agents: {
        defaults: {
          workspace: 'D:/OpenClaw/workspace',
          subagents: {
            maxSpawnDepth: 3,
          },
        },
        list: [
          {
            id: 'research',
            default: true,
          },
        ],
      },
      tools: {
        sessions: {
          visibility: 'tree',
        },
        agentToAgent: {
          enabled: false,
          allow: ['legacy'],
        },
      },
    };

    multiAgentDocumentServiceModule?.configureOpenClawMultiAgentSupportInConfigRoot(root, {
      coordinatorAgentId: 'main',
      allowAgentIds: ['research', 'ops'],
      subagentDefaults: {
        maxConcurrent: 4,
        maxSpawnDepth: 2,
        maxChildrenPerAgent: 5,
      },
      sessionsVisibility: 'all',
    });

    assert.deepEqual(root, {
      agents: {
        defaults: {
          workspace: 'D:/OpenClaw/workspace',
          subagents: {
            maxSpawnDepth: 3,
            maxConcurrent: 4,
            maxChildrenPerAgent: 5,
          },
        },
        list: [
          {
            id: 'research',
            default: false,
          },
          {
            id: 'main',
            default: true,
            subagents: {
              allowAgents: ['research', 'ops'],
            },
          },
        ],
      },
      tools: {
        sessions: {
          visibility: 'tree',
        },
        agentToAgent: {
          enabled: true,
          allow: ['legacy', 'main', 'research', 'ops'],
        },
      },
    });
  },
);

await runTest(
  'openClawMultiAgentDocumentService preserves wildcard agent allow entries without normalizing them away',
  () => {
    const root = {
      agents: {
        list: [
          {
            id: 'main',
            default: true,
          },
        ],
      },
      tools: {
        agentToAgent: {
          enabled: true,
          allow: ['main'],
        },
      },
    };

    multiAgentDocumentServiceModule?.configureOpenClawMultiAgentSupportInConfigRoot(root, {
      allowAgentIds: ['*', ' Research Crew '],
    });

    assert.deepEqual(root, {
      agents: {
        list: [
          {
            id: 'main',
            default: true,
            subagents: {
              allowAgents: ['*', 'research-crew'],
            },
          },
        ],
      },
      tools: {
        agentToAgent: {
          enabled: true,
          allow: ['main', '*', 'research-crew'],
        },
      },
    });
  },
);
