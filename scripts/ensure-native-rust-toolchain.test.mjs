// WORKSPACE-PATH:allow-fixture: fixtures name a foreign checkout root, drive, or home directory to exercise path handling, so the literal is the value under assertion rather than a binding this build resolves
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';

import {
  buildMissingRustToolchainMessage,
  ensureNativeRustToolchain,
  withRustToolchainPath,
} from './ensure-native-rust-toolchain.mjs';

const successfulChecks = [];
const successResult = ensureNativeRustToolchain({
  inspectCommand(command, args) {
    successfulChecks.push({ command, args });
    return {
      available: true,
      command,
      stdout: `${command} 1.90.0`,
    };
  },
});

assert.deepEqual(
  successfulChecks,
  [
    { command: 'cargo', args: ['--version'] },
    { command: 'rustc', args: ['--version'] },
  ],
  'Rust toolchain guard should verify both cargo and rustc with --version',
);
assert.equal(successResult.length, 2, 'Rust toolchain guard should return successful inspections');

const fakeRustHome = mkdtempSync(path.join(os.tmpdir(), 'native-rust-toolchain-'));
const fakeRustBinDir = path.join(fakeRustHome, '.cargo', 'bin');
mkdirSync(fakeRustBinDir, { recursive: true });
writeFileSync(path.join(fakeRustBinDir, 'cargo.exe'), '', 'utf8');
writeFileSync(path.join(fakeRustBinDir, 'rustc.exe'), '', 'utf8');

const fallbackEnv = withRustToolchainPath({
  PATH: 'C:\\Windows\\System32',
  USERPROFILE: fakeRustHome,
}, {
  platform: 'win32',
});

assert.match(
  fallbackEnv.PATH,
  new RegExp(`^${fakeRustBinDir.replace(/\\/g, '\\\\')}(;|$)`),
  'Rust toolchain PATH helper should prepend the standard rustup bin directory on Windows',
);

const fallbackChecks = [];
const fallbackResult = ensureNativeRustToolchain({
  env: {
    PATH: 'C:\\Windows\\System32',
    USERPROFILE: fakeRustHome,
  },
  platform: 'win32',
  inspectCommand(command, args, options) {
    fallbackChecks.push({ command, args, options });
    return {
      available: true,
      command,
      stdout: `${command} 1.90.0`,
    };
  },
});

assert.equal(fallbackResult.length, 2, 'Rust toolchain guard should still succeed with a standard rustup install path');
assert.equal(fallbackChecks.length, 2, 'Rust toolchain guard should inspect both required commands');
assert.ok(
  fallbackChecks.every(
    ({ options }) => typeof options?.env?.PATH === 'string'
      && options.env.PATH.startsWith(`${fakeRustBinDir};`),
  ),
  'Rust toolchain guard should inspect commands with the augmented PATH',
);

const posixStyleRustHome = fakeRustHome.replace(/\\/g, '/');
const posixStyleRustBinDir = `${posixStyleRustHome}/.cargo/bin`;
const posixStyleFallbackEnv = withRustToolchainPath({
  PATH: 'C:\\Windows\\System32',
  USERPROFILE: posixStyleRustHome,
}, {
  platform: 'win32',
});

assert.match(
  posixStyleFallbackEnv.PATH,
  new RegExp(`^${posixStyleRustBinDir.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(;|$)`),
  'Rust toolchain PATH helper should preserve POSIX-style rustup paths when simulating Windows on Linux runners',
);

let missingToolError;
try {
  ensureNativeRustToolchain({
    inspectCommand(command) {
      if (command === 'cargo') {
        return {
          available: false,
          command,
          reason: 'not-found',
          error: 'spawnSync cargo ENOENT',
        };
      }

      return {
        available: true,
        command,
        stdout: 'rustc 1.90.0',
      };
    },
  });
} catch (error) {
  missingToolError = error;
}

assert.ok(missingToolError instanceof Error, 'Missing cargo should fail the Rust toolchain guard');
assert.match(
  missingToolError.message,
  /Rust\/Cargo toolchain is required for Agent Studio native desktop and server development, checks, and builds\./,
);
assert.match(missingToolError.message, /Missing command\(s\): cargo/);
assert.match(missingToolError.message, /Install Rust via rustup: https:\/\/rustup\.rs\//);
assert.match(missingToolError.message, /cargo --version/);
assert.match(missingToolError.message, /rustc --version/);

const friendlyMessage = buildMissingRustToolchainMessage([
  {
    available: false,
    command: 'cargo',
    reason: 'not-found',
    error: 'spawnSync cargo ENOENT',
  },
  {
    available: false,
    command: 'rustc',
    reason: 'not-found',
    error: 'spawnSync rustc ENOENT',
  },
]);

assert.match(friendlyMessage, /Missing command\(s\): cargo, rustc/);
assert.match(friendlyMessage, /Restart the terminal after installation/);

const blockedMessage = buildMissingRustToolchainMessage([
  {
    available: false,
    command: 'cargo',
    reason: 'spawn-error',
    error: 'spawnSync cargo EPERM',
  },
  {
    available: false,
    command: 'rustc',
    reason: 'spawn-error',
    error: 'spawnSync rustc EPERM',
  },
]);

assert.match(blockedMessage, /Blocked command\(s\): cargo, rustc/);
assert.doesNotMatch(blockedMessage, /Missing command\(s\): cargo, rustc/);
assert.match(
  blockedMessage,
  /could not be launched by the current Node process/i,
);
assert.match(
  blockedMessage,
  /where\.exe cargo.*Get-Command cargo.*which cargo/s,
);

let blockedNodeProcessError;
try {
  ensureNativeRustToolchain({
    platform: 'win32',
    inspectCommand(command) {
      if (
        command === 'cargo'
        || command === 'rustc'
        || command === 'cmd.exe'
        || command === 'powershell.exe'
      ) {
        return {
          available: false,
          command,
          reason: 'spawn-error',
          error: `spawnSync ${command} EPERM`,
        };
      }

      return {
        available: true,
        command,
        stdout: `${command} ok`,
      };
    },
  });
} catch (error) {
  blockedNodeProcessError = error;
}

assert.ok(
  blockedNodeProcessError instanceof Error,
  'A broader Node child-process block should still fail the Rust toolchain guard',
);
assert.match(
  blockedNodeProcessError.message,
  /Node child-process blocker\(s\): cmd\.exe, powershell\.exe/,
);
assert.match(
  blockedNodeProcessError.message,
  /broader child-process restriction than a Rust toolchain problem/i,
);
assert.match(
  blockedNodeProcessError.message,
  /native commands will keep failing until Node is allowed to spawn Windows executables/i,
);
assert.match(
  blockedNodeProcessError.message,
  /broader child-process restriction than a Rust toolchain problem[\s\S]*Confirm the executable locations[\s\S]*Then verify in the same terminal:/i,
);

console.log('ok - native Rust toolchain guard reports actionable errors and passes when cargo and rustc exist');
