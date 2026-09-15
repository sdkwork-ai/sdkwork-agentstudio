// WORKSPACE-PATH:allow-fixture: fixtures name a foreign checkout root, drive, or home directory to exercise path handling, so the literal is the value under assertion rather than a binding this build resolves
import assert from 'node:assert/strict';
import path from 'node:path';

import {
  buildCargoFailureMessage,
  ensureLockedCargoSubcommandArgs,
  normalizeCargoInvocationArgs,
} from './cargo-command-standards.mjs';

const workspaceRoot = 'D:\\workspace\\agent-studio';

assert.deepEqual(
  ensureLockedCargoSubcommandArgs(['build', '--manifest-path', 'src-host/Cargo.toml']),
  ['build', '--locked', '--manifest-path', 'src-host/Cargo.toml'],
  'Cargo build commands must be locked by default',
);

assert.deepEqual(
  ensureLockedCargoSubcommandArgs(['+stable', '--color', 'always', 'test', '--manifest-path', 'src-host/Cargo.toml']),
  ['+stable', '--color', 'always', 'test', '--locked', '--manifest-path', 'src-host/Cargo.toml'],
  'Cargo lock injection must preserve toolchain and global arguments',
);

assert.deepEqual(
  ensureLockedCargoSubcommandArgs(['metadata', '--format-version=1']),
  ['metadata', '--format-version=1'],
  'Cargo utility commands must not receive build-only lock flags',
);

assert.deepEqual(
  normalizeCargoInvocationArgs([
    'test',
    '--manifest-path',
    'packages/sdkwork-agentstudio-pc-server/src-host/Cargo.toml',
    '--target-dir=target/check-server',
  ], { cwd: workspaceRoot }),
  [
    'test',
    '--locked',
    '--manifest-path',
    path.resolve(workspaceRoot, 'packages/sdkwork-agentstudio-pc-server/src-host/Cargo.toml'),
    `--target-dir=${path.resolve(workspaceRoot, 'target/check-server')}`,
  ],
  'Cargo invocation normalization must lock dependency resolution and absolutize path arguments',
);

assert.match(
  buildCargoFailureMessage({
    status: 101,
    stderr: 'error: the lock file needs to be updated but --locked was passed',
  }),
  /Cargo lockfile enforcement failed[\s\S]*Update the relevant Cargo\.lock intentionally/,
  'Cargo failure messages must explain lockfile drift',
);

console.log('ok - Cargo command standards enforce locked dependency resolution and actionable diagnostics');
