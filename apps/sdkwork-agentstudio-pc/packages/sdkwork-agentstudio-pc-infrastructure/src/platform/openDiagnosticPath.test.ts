// WORKSPACE-PATH:allow-fixture: fixtures name a foreign checkout root, drive, or home directory to exercise path handling, so the literal is the value under assertion rather than a binding this build resolves
import assert from 'node:assert/strict';
import { openDiagnosticPath } from './openDiagnosticPath.ts';

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

await runTest('openDiagnosticPath prefers reveal actions when requested and supported', async () => {
  const actions: string[] = [];

  await openDiagnosticPath('D:/logs/openclaw.log', {
    mode: 'reveal',
    revealPath: async (path) => {
      actions.push(`reveal:${path}`);
    },
    openPath: async (path) => {
      actions.push(`open:${path}`);
    },
  });

  assert.deepEqual(actions, ['reveal:D:/logs/openclaw.log']);
});

await runTest('openDiagnosticPath falls back to open when reveal is unavailable', async () => {
  const actions: string[] = [];

  await openDiagnosticPath('D:/logs/openclaw.log', {
    mode: 'reveal',
    openPath: async (path) => {
      actions.push(`open:${path}`);
    },
  });

  assert.deepEqual(actions, ['open:D:/logs/openclaw.log']);
});

await runTest('openDiagnosticPath falls back to open when reveal fails', async () => {
  const actions: string[] = [];

  await openDiagnosticPath('D:/logs/openclaw.log', {
    mode: 'reveal',
    revealPath: async () => {
      throw new Error('shell reveal unavailable');
    },
    openPath: async (path) => {
      actions.push(`open:${path}`);
    },
  });

  assert.deepEqual(actions, ['open:D:/logs/openclaw.log']);
});

await runTest('openDiagnosticPath rejects when the active platform cannot open diagnostic paths', async () => {
  await assert.rejects(
    async () =>
      openDiagnosticPath('D:/logs/openclaw.log', {
        mode: 'open',
      }),
    /Opening diagnostic files is not available for the active platform\./,
  );
});
