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

let kernelModelModule:
  | typeof import('./kernelModel.ts')
  | undefined;

try {
  kernelModelModule = await import('./kernelModel.ts');
} catch {
  kernelModelModule = undefined;
}

await runTest('kernelModel exports the standard kernel enum values', () => {
  assert.ok(kernelModelModule, 'Expected kernelModel.ts to exist');
  assert.deepEqual(kernelModelModule?.deploymentModes, [
    'builtIn',
    'localExternal',
    'attached',
    'remote',
  ]);
  assert.deepEqual(kernelModelModule?.authorityOwners, [
    'appManaged',
    'userManaged',
    'remoteManaged',
  ]);
  assert.deepEqual(kernelModelModule?.controlPlaneKinds, [
    'desktopHost',
    'kernelGateway',
    'bridge',
    'remoteApi',
    'none',
  ]);
  assert.deepEqual(kernelModelModule?.kernelConfigAccessModes, [
    'localFs',
    'gateway',
    'bridge',
    'remoteApi',
    'unavailable',
  ]);
});

await runTest('kernelModel accepts KernelConfig and KernelAuthority standard shapes', () => {
  assert.ok(kernelModelModule, 'Expected kernelModel.ts to exist');

  const config: import('./kernelModel.ts').KernelConfig = {
    configFile: 'C:/Users/admin/.openclaw/openclaw.json',
    configRoot: 'C:/Users/admin/.openclaw',
    userRoot: 'C:/Users/admin',
    format: 'json',
    access: 'localFs',
    provenance: 'standardUserRoot',
    writable: true,
    resolved: true,
    schemaVersion: null,
  };

  const authority: import('./kernelModel.ts').KernelAuthority = {
    owner: 'appManaged',
    controlPlane: 'desktopHost',
    lifecycleControl: true,
    configControl: true,
    upgradeControl: true,
    doctorSupport: true,
    migrationSupport: true,
    observable: true,
    writable: true,
  };

  assert.equal(config.configFile, 'C:/Users/admin/.openclaw/openclaw.json');
  assert.equal(authority.owner, 'appManaged');
  assert.equal(authority.controlPlane, 'desktopHost');
});
