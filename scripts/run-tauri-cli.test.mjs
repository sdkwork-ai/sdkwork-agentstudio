// WORKSPACE-PATH:allow-fixture: fixtures name a foreign checkout root, drive, or home directory to exercise path handling, so the literal is the value under assertion rather than a binding this build resolves
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';

import { createTauriCliPlan } from './run-tauri-cli.mjs';

const modulePath = path.resolve(import.meta.dirname, 'run-tauri-cli.mjs');
const moduleSource = readFileSync(modulePath, 'utf8');

const defaultPlan = createTauriCliPlan({
  argv: ['dev'],
  env: {},
  platform: 'linux',
  execPath: '/usr/bin/node',
  resolveTauriCliEntrypoint: () => '/workspace/agent-studio/node_modules/@tauri-apps/cli/tauri.js',
});

assert.equal(defaultPlan.command, '/usr/bin/node');
assert.deepEqual(defaultPlan.args, ['/workspace/agent-studio/node_modules/@tauri-apps/cli/tauri.js', 'dev']);
assert.equal(defaultPlan.env.SDKWORK_VITE_MODE, 'development');
assert.equal(defaultPlan.shell, false);

const testPlan = createTauriCliPlan({
  argv: ['dev', '--vite-mode', 'test', '--', '--target', 'x86_64-pc-windows-msvc'],
  env: {},
  platform: 'win32',
  execPath: 'C:\\Program Files\\nodejs\\node.exe',
  resolveTauriCliEntrypoint: () => 'D:\\workspace\\agent-studio\\node_modules\\@tauri-apps\\cli\\tauri.js',
});

assert.equal(testPlan.command, 'C:\\Program Files\\nodejs\\node.exe');
assert.deepEqual(
  testPlan.args,
  ['D:\\workspace\\agent-studio\\node_modules\\@tauri-apps\\cli\\tauri.js', 'dev', '--', '--target', 'x86_64-pc-windows-msvc'],
);
assert.equal(testPlan.env.SDKWORK_VITE_MODE, 'test');
assert.equal(testPlan.shell, false);
assert.throws(
  () => createTauriCliPlan({
    argv: ['build', '--vite-mode'],
    env: {},
    platform: 'linux',
  }),
  /Missing value for --vite-mode/,
);
assert.throws(
  () => createTauriCliPlan({
    argv: ['info'],
    env: {},
    platform: 'linux',
    resolveTauriCliEntrypoint: () => '',
  }),
  /Unable to resolve the local @tauri-apps\/cli entrypoint/,
);
assert.match(
  moduleSource,
  /if \(path\.resolve\(process\.argv\[1\] \?\? ''\) === __filename\) \{\s*try \{\s*runCli\(\);\s*\} catch \(error\) \{\s*console\.error\(error instanceof Error \? error\.message : String\(error\)\);\s*process\.exit\(1\);\s*\}\s*\}/s,
);
assert.match(
  moduleSource,
  /windowsHide:\s*true/u,
  'run-tauri-cli must hide delegated Windows child processes so desktop dev/build launch automation does not flash terminal windows',
);

console.log('ok - tauri cli runner resolves the local workspace CLI and forwards vite mode through the tauri process environment');
