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

let pathResolutionServiceModule:
  | typeof import('./openClawPathResolutionService.ts')
  | undefined;

try {
  pathResolutionServiceModule = await import('./openClawPathResolutionService.ts');
} catch {
  pathResolutionServiceModule = undefined;
}

await runTest(
  'openClawPathResolutionService exposes config-file rooted path resolvers',
  () => {
    assert.ok(pathResolutionServiceModule, 'Expected openClawPathResolutionService.ts to exist');
    assert.equal(
      typeof pathResolutionServiceModule?.resolveOpenClawStateRootFromConfigFile,
      'function',
    );
    assert.equal(
      typeof pathResolutionServiceModule?.resolveOpenClawUserRootFromConfigFile,
      'function',
    );
    assert.equal(
      typeof pathResolutionServiceModule?.resolveOpenClawUserPathFromConfigFile,
      'function',
    );
  },
);

await runTest(
  'openClawPathResolutionService resolves built-in state roots, user roots, and relative user paths from canonical config files',
  () => {
    assert.equal(
      pathResolutionServiceModule?.resolveOpenClawStateRootFromConfigFile(
        'D:/OpenClaw/.openclaw/openclaw.json',
      ),
      'D:/OpenClaw/.openclaw',
    );
    assert.equal(
      pathResolutionServiceModule?.resolveOpenClawUserRootFromConfigFile(
        'D:/OpenClaw/.openclaw/openclaw.json',
      ),
      'D:/OpenClaw',
    );
    assert.equal(
      pathResolutionServiceModule?.resolveOpenClawUserPathFromConfigFile(
        'D:/OpenClaw/.openclaw/openclaw.json',
        '~/workspace',
      ),
      'D:/OpenClaw/workspace',
    );
    assert.equal(
      pathResolutionServiceModule?.resolveOpenClawUserPathFromConfigFile(
        'D:/OpenClaw/.openclaw/openclaw.json',
        './agents/research/agent',
      ),
      'D:/OpenClaw/.openclaw/agents/research/agent',
    );
  },
);

await runTest(
  'openClawPathResolutionService resolves legacy data-root configs back to the data root for relative paths',
  () => {
    assert.equal(
      pathResolutionServiceModule?.resolveOpenClawStateRootFromConfigFile(
        'D:/OpenClaw/data/config/openclaw.json',
      ),
      'D:/OpenClaw/data',
    );
    assert.equal(
      pathResolutionServiceModule?.resolveOpenClawUserRootFromConfigFile(
        'D:/OpenClaw/data/config/openclaw.json',
      ),
      'D:/OpenClaw',
    );
    assert.equal(
      pathResolutionServiceModule?.resolveOpenClawUserPathFromConfigFile(
        'D:/OpenClaw/data/config/openclaw.json',
        'workspace',
      ),
      'D:/OpenClaw/data/workspace',
    );
  },
);
