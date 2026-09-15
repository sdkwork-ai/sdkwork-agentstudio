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

let kernelConfigProjectionModule:
  | typeof import('./kernelConfigProjection.ts')
  | undefined;

try {
  kernelConfigProjectionModule = await import('./kernelConfigProjection.ts');
} catch {
  kernelConfigProjectionModule = undefined;
}

await runTest('buildKernelConfigProjection canonicalizes OpenClaw config under userRoot', () => {
  assert.ok(kernelConfigProjectionModule, 'Expected kernelConfigProjection.ts to exist');

  const projected = kernelConfigProjectionModule?.buildKernelConfigProjection({
    runtimeKind: 'openclaw',
    configFile: 'C:/Users/admin/.openclaw/openclaw.json',
    configWritable: true,
    schemaVersion: null,
  });

  assert.deepEqual(projected, {
    kernelId: 'openclaw',
    runtimeKind: 'openclaw',
    configFile: 'C:/Users/admin/.openclaw/openclaw.json',
    configRoot: 'C:/Users/admin/.openclaw',
    stateRoot: 'C:/Users/admin/.openclaw',
    userRoot: 'C:/Users/admin',
    standardStateRoot: 'C:/Users/admin/.openclaw',
    standardConfigFile: 'C:/Users/admin/.openclaw/openclaw.json',
    format: 'json',
    access: 'localFs',
    provenance: 'standardUserRoot',
    writable: true,
    resolved: true,
    schemaVersion: null,
    isStandardUserRootLayout: true,
  });
});

await runTest('buildKernelConfigProjection preserves unresolved state when no config path exists', () => {
  assert.ok(kernelConfigProjectionModule, 'Expected kernelConfigProjection.ts to exist');

  const projected = kernelConfigProjectionModule?.buildKernelConfigProjection({
    runtimeKind: 'openclaw',
    configFile: null,
    configWritable: false,
    schemaVersion: null,
  });

  assert.equal(projected, null);
});
