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

let fileWorkbenchSupportModule:
  | typeof import('./openClawFileWorkbenchSupport.ts')
  | undefined;

try {
  fileWorkbenchSupportModule = await import('./openClawFileWorkbenchSupport.ts');
} catch {
  fileWorkbenchSupportModule = undefined;
}

await runTest(
  'openClawFileWorkbenchSupport exposes shared file shaping helpers',
  () => {
    assert.ok(fileWorkbenchSupportModule, 'Expected openClawFileWorkbenchSupport.ts to exist');
    assert.equal(typeof fileWorkbenchSupportModule?.inferOpenClawFileCategory, 'function');
    assert.equal(typeof fileWorkbenchSupportModule?.mapOpenClawFileEntryToWorkbenchFile, 'function');
    assert.equal(typeof fileWorkbenchSupportModule?.mergeOpenClawFileCollections, 'function');
    assert.equal(typeof fileWorkbenchSupportModule?.buildOpenClawMemories, 'function');
  },
);

await runTest(
  'mapOpenClawFileEntryToWorkbenchFile derives stable ids, categories, and fallback paths from OpenClaw entries',
  () => {
    const file = fileWorkbenchSupportModule?.mapOpenClawFileEntryToWorkbenchFile({
      agent: {
        agent: {
          id: 'ops-lead',
          name: 'Ops Lead',
        },
        focusAreas: [],
        automationFitScore: 0,
        configSource: 'runtime',
      } as any,
      entry: {
        path: 'D:/OpenClaw/workspace/prompts/review.md',
        size: 512,
        updatedAtMs: Date.parse('2026-04-09T00:00:00.000Z'),
      },
      workspace: 'D:/OpenClaw/workspace',
      content: '# Review Prompt\nFocus on risks first.',
    });

    assert.equal(file?.id, 'openclaw-agent-file:ops-lead:prompts%2Freview.md');
    assert.equal(file?.name, 'review.md');
    assert.equal(file?.path, 'D:/OpenClaw/workspace/prompts/review.md');
    assert.equal(file?.category, 'prompt');
    assert.equal(file?.status, 'synced');
    assert.equal(file?.description, 'prompts/review.md workspace file for Ops Lead.');
    assert.equal(file?.content, '# Review Prompt\nFocus on risks first.');
  },
);

await runTest(
  'buildOpenClawMemories derives backend, agent memory, and qmd entries from file snapshots',
  () => {
    const memoryFile = fileWorkbenchSupportModule?.mapOpenClawFileEntryToWorkbenchFile({
      agent: {
        agent: {
          id: 'ops-lead',
          name: 'Ops Lead',
        },
        focusAreas: [],
        automationFitScore: 0,
        configSource: 'runtime',
      } as any,
      entry: {
        path: 'D:/OpenClaw/workspace/MEMORY.md',
        updatedAtMs: Date.parse('2026-04-09T00:00:00.000Z'),
      },
      workspace: 'D:/OpenClaw/workspace',
      content: '# Ops Memory\nIncident note and rollback plan.',
    });

    const memories = fileWorkbenchSupportModule?.buildOpenClawMemories(
      {
        config: {
          meta: {
            lastTouchedAt: '2026-04-09T00:00:00.000Z',
          },
          memory: {
            backend: 'sqlite',
            citations: 'required',
            qmd: {
              paths: [
                {
                  path: 'memory/qmd',
                  pattern: '**/*.md',
                },
              ],
            },
          },
        },
      } as any,
      [memoryFile].filter(Boolean) as any,
      [
        {
          agent: {
            id: 'ops-lead',
            name: 'Ops Lead',
          },
          focusAreas: [],
          automationFitScore: 0,
          configSource: 'runtime',
        },
      ] as any,
    );

    assert.equal(memories?.[0]?.title, 'Memory Backend');
    assert.equal(memories?.[0]?.summary, 'Backend=sqlite, citations=required.');
    assert.equal(memories?.[1]?.title, 'Ops Lead Memory');
    assert.equal(memories?.[1]?.source, 'agent');
    assert.ok(memories?.[1]?.summary.includes('Incident note'));
    assert.equal(memories?.[2]?.id, 'qmd-0');
    assert.equal(memories?.[2]?.title, 'memory/qmd');
    assert.equal(memories?.[2]?.summary, 'QMD index path memory/qmd (pattern: **/*.md)');
  },
);

await runTest(
  'mergeOpenClawFileCollections overlays later snapshots while keeping deterministic path ordering',
  () => {
    const files = fileWorkbenchSupportModule?.mergeOpenClawFileCollections(
      [
        {
          id: 'b',
          name: 'b.md',
          path: '/workspace/b.md',
          category: 'prompt',
          language: 'markdown',
          size: '1 KB',
          updatedAt: 'Unknown',
          status: 'synced',
          description: 'base b',
          content: 'base b',
          isReadonly: false,
        },
        {
          id: 'a',
          name: 'a.md',
          path: '/workspace/a.md',
          category: 'prompt',
          language: 'markdown',
          size: '1 KB',
          updatedAt: 'Unknown',
          status: 'synced',
          description: 'base a',
          content: 'base a',
          isReadonly: false,
        },
      ] as any,
      [
        {
          id: 'b',
          name: 'b.md',
          path: '/workspace/b.md',
          category: 'prompt',
          language: 'markdown',
          size: '2 KB',
          updatedAt: '2026-04-09T00:00:00.000Z',
          status: 'missing',
          description: 'override b',
          content: 'override b',
          isReadonly: true,
        },
      ] as any,
    );

    assert.deepEqual(
      files?.map((file) => file.id),
      ['a', 'b'],
    );
    assert.equal(files?.[1]?.size, '2 KB');
    assert.equal(files?.[1]?.status, 'missing');
    assert.equal(files?.[1]?.description, 'override b');
    assert.equal(files?.[1]?.isReadonly, true);
  },
);
