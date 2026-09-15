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

let kernelConfigAttachmentServiceModule:
  | typeof import('./kernelConfigAttachmentService.ts')
  | undefined;

try {
  kernelConfigAttachmentServiceModule = await import('./kernelConfigAttachmentService.ts');
} catch {
  kernelConfigAttachmentServiceModule = undefined;
}

await runTest(
  'kernelConfigAttachmentService exposes standard attached-kernel config resolvers',
  () => {
    assert.ok(
      kernelConfigAttachmentServiceModule,
      'Expected kernelConfigAttachmentService.ts to exist',
    );
    assert.equal(
      typeof kernelConfigAttachmentServiceModule?.resolveAttachedKernelConfigFile,
      'function',
    );
    assert.equal(
      typeof kernelConfigAttachmentServiceModule?.resolveAttachedKernelConfig,
      'function',
    );
  },
);

await runTest('resolveAttachedKernelConfigFile prefers config routes over artifacts', () => {
  assert.equal(
    kernelConfigAttachmentServiceModule?.resolveAttachedKernelConfigFile({
      instance: {
        runtimeKind: 'openclaw',
      },
      dataAccess: {
        routes: [
          {
            scope: 'config',
            mode: 'managedFile',
            target: '/workspace/main/openclaw.json',
          },
        ],
      },
      artifacts: [
        {
          kind: 'configFile',
          location: '/tmp/stale-openclaw.json',
        },
      ],
    } as any),
    '/workspace/main/openclaw.json',
  );
});

await runTest(
  'resolveAttachedKernelConfigFile ignores config artifacts when a metadata-only config route exists',
  () => {
    assert.equal(
      kernelConfigAttachmentServiceModule?.resolveAttachedKernelConfigFile({
        instance: {
          runtimeKind: 'openclaw',
        },
        dataAccess: {
          routes: [
            {
              scope: 'config',
              mode: 'metadataOnly',
              target: '/workspace/metadata-only/openclaw.json',
            },
          ],
        },
        artifacts: [
          {
            kind: 'configFile',
            location: '/workspace/external/openclaw.json',
          },
        ],
      } as any),
      null,
    );
  },
);

await runTest(
  'resolveAttachedKernelConfig projects built-in OpenClaw config routes through the shared kernel standard when the route already uses the canonical user-root config file',
  () => {
    const standardWorkspacePath = 'C:/Users/admin/.openclaw/workspace';
    const standardConfigFilePath = 'C:/Users/admin/.openclaw/openclaw.json';
    const projected = kernelConfigAttachmentServiceModule?.resolveAttachedKernelConfig({
      instance: {
        runtimeKind: 'openclaw',
        deploymentMode: 'local-managed',
        isBuiltIn: true,
        config: {
          workspacePath: standardWorkspacePath,
        },
      },
      config: {
        workspacePath: standardWorkspacePath,
      },
      lifecycle: {
        configWritable: true,
      },
      dataAccess: {
        routes: [
          {
            scope: 'config',
            mode: 'managedFile',
            target: standardConfigFilePath,
          },
        ],
      },
    } as any);

    assert.deepEqual(projected, {
      kernelId: 'openclaw',
      runtimeKind: 'openclaw',
      configFile: standardConfigFilePath,
      configRoot: 'C:/Users/admin/.openclaw',
      stateRoot: 'C:/Users/admin/.openclaw',
      userRoot: 'C:/Users/admin',
      standardStateRoot: 'C:/Users/admin/.openclaw',
      standardConfigFile: standardConfigFilePath,
      format: 'json',
      access: 'localFs',
      provenance: 'standardUserRoot',
      writable: true,
      resolved: true,
      schemaVersion: null,
      isStandardUserRootLayout: true,
    });
  },
);
