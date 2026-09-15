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

let filePathSupportModule:
  | typeof import('./openClawFilePathSupport.ts')
  | undefined;

try {
  filePathSupportModule = await import('./openClawFilePathSupport.ts');
} catch {
  filePathSupportModule = undefined;
}

await runTest('openClawFilePathSupport exposes shared file path normalization helpers', () => {
  assert.ok(filePathSupportModule, 'Expected openClawFilePathSupport.ts to exist');
  assert.equal(typeof filePathSupportModule?.normalizeOpenClawFilePath, 'function');
  assert.equal(typeof filePathSupportModule?.trimOpenClawWorkspacePrefix, 'function');
  assert.equal(typeof filePathSupportModule?.deriveOpenClawFileRequestPath, 'function');
});

await runTest(
  'normalizeOpenClawFilePath normalizes separators, trims whitespace, and preserves root',
  () => {
    assert.equal(
      filePathSupportModule?.normalizeOpenClawFilePath('  C:\\workspace\\agents\\main.md  '),
      'C:/workspace/agents/main.md',
    );
    assert.equal(filePathSupportModule?.normalizeOpenClawFilePath('/'), '/');
    assert.equal(filePathSupportModule?.normalizeOpenClawFilePath('   '), null);
    assert.equal(filePathSupportModule?.normalizeOpenClawFilePath(undefined), null);
  },
);

await runTest(
  'trimOpenClawWorkspacePrefix treats Windows rooted paths case-insensitively and drops exact workspace roots',
  () => {
    assert.equal(
      filePathSupportModule?.trimOpenClawWorkspacePrefix(
        'C:/Workspace/Main/agents/main.md',
        'c:/workspace/main',
      ),
      'agents/main.md',
    );
    assert.equal(
      filePathSupportModule?.trimOpenClawWorkspacePrefix(
        '//SERVER/share/workspace/agents/main.md',
        '//server/share/workspace',
      ),
      'agents/main.md',
    );
    assert.equal(
      filePathSupportModule?.trimOpenClawWorkspacePrefix('/workspace/main', '/workspace/main'),
      null,
    );
  },
);

await runTest(
  'deriveOpenClawFileRequestPath prefers workspace-relative paths, then relative paths, then normalized names or basenames',
  () => {
    assert.equal(
      filePathSupportModule?.deriveOpenClawFileRequestPath(
        '/workspace/main/agents/main.md',
        'C:/workspace/main/agents/main.md',
        'c:/workspace/main',
      ),
      'agents/main.md',
    );
    assert.equal(
      filePathSupportModule?.deriveOpenClawFileRequestPath(
        '/workspace/main/agents/main.md',
        'agents/main.md',
        'c:/workspace/main',
      ),
      'agents/main.md',
    );
    assert.equal(
      filePathSupportModule?.deriveOpenClawFileRequestPath('/agents/main.md', null, undefined),
      'agents/main.md',
    );
    assert.equal(
      filePathSupportModule?.deriveOpenClawFileRequestPath(
        null,
        'C:/workspace/main/agents/main.md',
        undefined,
      ),
      'main.md',
    );
  },
);
