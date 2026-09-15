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

const DRIFTED_CONFIG_FILE_PATH =
  'C:/ProgramData/SdkWork/CrawStudio/state/kernels/hermes/config/hermes.json';
const STANDARD_WORKSPACE_PATH = 'C:/Users/admin/.hermes/workspace';
const STANDARD_CONFIG_FILE_PATH = 'C:/Users/admin/.hermes/config.yaml';

let hermesKernelConfigPathServiceModule:
  | typeof import('./hermesKernelConfigPathService.ts')
  | undefined;

try {
  hermesKernelConfigPathServiceModule = await import('./hermesKernelConfigPathService.ts');
} catch {
  hermesKernelConfigPathServiceModule = undefined;
}

await runTest(
  'hermesKernelConfigPathService exposes the shared Hermes kernel-config path standard helpers',
  () => {
    assert.ok(
      hermesKernelConfigPathServiceModule,
      'Expected hermesKernelConfigPathService.ts to exist',
    );
    assert.equal(
      typeof hermesKernelConfigPathServiceModule?.buildStandardHermesConfigFilePath,
      'function',
    );
    assert.equal(
      typeof hermesKernelConfigPathServiceModule?.buildStandardHermesWorkspacePath,
      'function',
    );
    assert.equal(
      typeof hermesKernelConfigPathServiceModule?.buildStandardHermesStateDatabasePath,
      'function',
    );
    assert.equal(
      typeof hermesKernelConfigPathServiceModule?.buildStandardHermesSessionsRootPath,
      'function',
    );
    assert.equal(
      typeof hermesKernelConfigPathServiceModule?.buildStandardHermesLogsRootPath,
      'function',
    );
    assert.equal(
      typeof hermesKernelConfigPathServiceModule?.normalizeHermesKernelConfigFilePath,
      'function',
    );
  },
);

await runTest(
  'hermesKernelConfigPathService canonicalizes built-in Hermes drifted config paths to the standard user-root config file',
  () => {
    assert.equal(
      hermesKernelConfigPathServiceModule?.normalizeHermesKernelConfigFilePath({
        runtimeKind: 'hermes',
        deploymentMode: 'local-managed',
        isBuiltIn: true,
        configFile: DRIFTED_CONFIG_FILE_PATH,
        workspacePath: STANDARD_WORKSPACE_PATH,
      }),
      STANDARD_CONFIG_FILE_PATH,
    );
    assert.equal(
      hermesKernelConfigPathServiceModule?.buildStandardHermesWorkspacePath('C:/Users/admin'),
      STANDARD_WORKSPACE_PATH,
    );
    assert.equal(
      hermesKernelConfigPathServiceModule?.buildStandardHermesStateDatabasePath(
        'C:/Users/admin',
      ),
      'C:/Users/admin/.hermes/state.db',
    );
    assert.equal(
      hermesKernelConfigPathServiceModule?.buildStandardHermesSessionsRootPath(
        'C:/Users/admin',
      ),
      'C:/Users/admin/.hermes/sessions',
    );
    assert.equal(
      hermesKernelConfigPathServiceModule?.buildStandardHermesLogsRootPath(
        'C:/Users/admin',
      ),
      'C:/Users/admin/.hermes/logs',
    );
    assert.equal(
      hermesKernelConfigPathServiceModule?.buildStandardHermesConfigFilePath(
        'C:/Users/admin',
      ),
      STANDARD_CONFIG_FILE_PATH,
    );
  },
);
