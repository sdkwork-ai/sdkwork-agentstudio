// WORKSPACE-PATH:allow-fixture: fixtures name a foreign checkout root, drive, or home directory to exercise path handling, so the literal is the value under assertion rather than a binding this build resolves
import assert from 'node:assert/strict';
import path from 'node:path';

import { buildCargoFailureMessage, normalizeCargoInvocationArgs } from './run-cargo.mjs';

const workspaceRoot = 'D:\\workspace\\agent-studio';

assert.deepEqual(
  normalizeCargoInvocationArgs([
    'test',
    '--manifest-path',
    'packages/sdkwork-agentstudio-pc-desktop/src-tauri/Cargo.toml',
    '--target-dir',
    'target/check-desktop',
    'embedded_host_bootstrap_exposes_structured_browser_bootstrap_descriptor',
    '--',
    '--test-threads=1',
  ], { cwd: workspaceRoot }),
  [
    'test',
    '--locked',
    '--manifest-path',
    path.resolve(workspaceRoot, 'packages/sdkwork-agentstudio-pc-desktop/src-tauri/Cargo.toml'),
    '--target-dir',
    path.resolve(workspaceRoot, 'target/check-desktop'),
    'embedded_host_bootstrap_exposes_structured_browser_bootstrap_descriptor',
    '--',
    '--test-threads=1',
  ],
  'run-cargo must absolutize manifest and target paths before Cargo resolves local path dependencies',
);

assert.deepEqual(
  normalizeCargoInvocationArgs([
    'test',
    '--manifest-path=packages/sdkwork-agentstudio-pc-server/src-host/Cargo.toml',
    '--target-dir=target/check-server',
  ], { cwd: workspaceRoot }),
  [
    'test',
    '--locked',
    `--manifest-path=${path.resolve(workspaceRoot, 'packages/sdkwork-agentstudio-pc-server/src-host/Cargo.toml')}`,
    `--target-dir=${path.resolve(workspaceRoot, 'target/check-server')}`,
  ],
  'run-cargo must support equals-style Cargo path arguments',
);

assert.deepEqual(
  normalizeCargoInvocationArgs([
    'test',
    '--',
    '--manifest-path',
    'not-a-cargo-manifest-argument',
  ], { cwd: workspaceRoot }),
  [
    'test',
    '--locked',
    '--',
    '--manifest-path',
    'not-a-cargo-manifest-argument',
  ],
  'run-cargo must not rewrite test-binary arguments after the Cargo argument separator',
);

assert.deepEqual(
  normalizeCargoInvocationArgs([
    'test',
    '--locked',
    '--manifest-path',
    'packages/sdkwork-agentstudio-pc-server/src-host/Cargo.toml',
  ], { cwd: workspaceRoot }),
  [
    'test',
    '--locked',
    '--manifest-path',
    path.resolve(workspaceRoot, 'packages/sdkwork-agentstudio-pc-server/src-host/Cargo.toml'),
  ],
  'run-cargo must not duplicate an explicit --locked flag',
);

assert.deepEqual(
  normalizeCargoInvocationArgs([
    '+stable',
    '--color',
    'always',
    'test',
    '--manifest-path',
    'packages/sdkwork-agentstudio-pc-desktop/src-tauri/Cargo.toml',
  ], { cwd: workspaceRoot }),
  [
    '+stable',
    '--color',
    'always',
    'test',
    '--locked',
    '--manifest-path',
    path.resolve(workspaceRoot, 'packages/sdkwork-agentstudio-pc-desktop/src-tauri/Cargo.toml'),
  ],
  'run-cargo must preserve Cargo global arguments and inject --locked after the build subcommand',
);

assert.deepEqual(
  normalizeCargoInvocationArgs([
    'metadata',
    '--format-version=1',
  ], { cwd: workspaceRoot }),
  [
    'metadata',
    '--format-version=1',
  ],
  'run-cargo must not inject --locked into non-build cargo utility commands',
);

assert.match(
  buildCargoFailureMessage({
    status: 101,
    stderr: [
      'error: failed to get `clap` as a dependency of package `sdkwork-agentstudio-pc-server`',
      'Caused by:',
      '  failed to download from `https://index.crates.io/cl/ap/clap`',
      'Caused by:',
      '  [35] SSL connect error (schannel: AcquireCredentialsHandle failed: SEC_E_NO_CREDENTIALS (0x8009030E))',
    ].join('\n'),
  }),
  /Cargo failed with exit code 101[\s\S]*Cargo dependency retrieval failed[\s\S]*pre-populated Cargo cache or an approved crates mirror[\s\S]*SEC_E_NO_CREDENTIALS/,
  'run-cargo must turn crates.io SSL/download failures into actionable commercial-build diagnostics',
);

assert.match(
  buildCargoFailureMessage({
    status: 101,
    stderr: 'error: the lock file needs to be updated but --locked was passed',
  }),
  /Cargo lockfile enforcement failed[\s\S]*Update the relevant Cargo\.lock intentionally/,
  'run-cargo must explain locked dependency drift instead of leaving Cargo output ambiguous',
);

console.log('ok - run-cargo normalizes Cargo path arguments and enforces locked build commands before spawning cargo');
