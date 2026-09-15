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
  | typeof import('./hermesPathResolutionService.ts')
  | undefined;

try {
  pathResolutionServiceModule = await import('./hermesPathResolutionService.ts');
} catch {
  pathResolutionServiceModule = undefined;
}

await runTest(
  'hermesPathResolutionService exposes config-file rooted path resolvers',
  () => {
    assert.ok(pathResolutionServiceModule, 'Expected hermesPathResolutionService.ts to exist');
    assert.equal(
      typeof pathResolutionServiceModule?.resolveHermesStateRootFromConfigFile,
      'function',
    );
    assert.equal(
      typeof pathResolutionServiceModule?.resolveHermesUserRootFromConfigFile,
      'function',
    );
    assert.equal(
      typeof pathResolutionServiceModule?.resolveHermesStateDatabasePathFromConfigFile,
      'function',
    );
    assert.equal(
      typeof pathResolutionServiceModule?.resolveHermesSessionsRootFromConfigFile,
      'function',
    );
    assert.equal(
      typeof pathResolutionServiceModule?.resolveHermesLogsRootFromConfigFile,
      'function',
    );
  },
);

await runTest(
  'hermesPathResolutionService resolves canonical config.yaml state, database, sessions, and logs paths from the standard user root',
  () => {
    assert.equal(
      pathResolutionServiceModule?.resolveHermesStateRootFromConfigFile(
        'D:/Hermes/.hermes/config.yaml',
      ),
      'D:/Hermes/.hermes',
    );
    assert.equal(
      pathResolutionServiceModule?.resolveHermesUserRootFromConfigFile(
        'D:/Hermes/.hermes/config.yaml',
      ),
      'D:/Hermes',
    );
    assert.equal(
      pathResolutionServiceModule?.resolveHermesStateDatabasePathFromConfigFile(
        'D:/Hermes/.hermes/config.yaml',
      ),
      'D:/Hermes/.hermes/state.db',
    );
    assert.equal(
      pathResolutionServiceModule?.resolveHermesSessionsRootFromConfigFile(
        'D:/Hermes/.hermes/config.yaml',
      ),
      'D:/Hermes/.hermes/sessions',
    );
    assert.equal(
      pathResolutionServiceModule?.resolveHermesLogsRootFromConfigFile(
        'D:/Hermes/.hermes/config.yaml',
      ),
      'D:/Hermes/.hermes/logs',
    );
  },
);
