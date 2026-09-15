// WORKSPACE-PATH:allow-fixture - this file is a test fixture that simulates a foreign
// checkout root, so the sdkwork-<name> segment below is the value under assertion rather
// than a binding to a real sibling checkout. PORTABILITY_SPEC.md section 5.2 governs it.
import assert from 'node:assert/strict';
import path from 'node:path';
import test from 'node:test';
import { pathToFileURL } from 'node:url';

const rootDir = path.resolve(import.meta.dirname, '..');

test('desktop cargo target helper keeps the default non-Windows target inside src-tauri', async () => {
  const modulePath = path.join(rootDir, 'scripts', 'desktop-cargo-target.mjs');
  const helper = await import(pathToFileURL(modulePath).href);

  assert.equal(typeof helper.resolveDefaultDesktopCargoTargetDir, 'function');

  assert.equal(
    helper.resolveDefaultDesktopCargoTargetDir({
      desktopPackageDir: 'D:/workspace/agent-studio/packages/sdkwork-agentstudio-pc-desktop',
      platform: 'linux',
    }).replaceAll('\\', '/'),
    'D:/workspace/agent-studio/packages/sdkwork-agentstudio-pc-desktop/src-tauri/target',
  );
});

test('desktop cargo target helper assigns Windows desktop builds to a short external target root', async () => {
  const modulePath = path.join(rootDir, 'scripts', 'desktop-cargo-target.mjs');
  const helper = await import(pathToFileURL(modulePath).href);

  assert.equal(typeof helper.resolveDefaultDesktopCargoTargetDir, 'function');

  const targetDir = helper.resolveDefaultDesktopCargoTargetDir({
    desktopPackageDir: 'D:/workspace/very/deep/path/agent-studio/packages/sdkwork-agentstudio-pc-desktop',
    platform: 'win32',
  }).replaceAll('\\', '/');

  assert.match(
    targetDir,
    /^D:\/\.sdkwork-claw\/cargo-target\/[0-9a-f]{10}\/desktop$/,
  );
  assert.doesNotMatch(targetDir, /src-tauri\/target/);
});

test('desktop cargo target helper resolves explicit relative overrides from the current working directory', async () => {
  const modulePath = path.join(rootDir, 'scripts', 'desktop-cargo-target.mjs');
  const helper = await import(pathToFileURL(modulePath).href);

  assert.equal(typeof helper.resolveDesktopCargoTargetDir, 'function');

  assert.equal(
    helper.resolveDesktopCargoTargetDir({
      desktopPackageDir: 'D:/workspace/agent-studio/packages/sdkwork-agentstudio-pc-desktop',
      platform: 'win32',
      cwd: 'D:/workspace/agent-studio/packages/sdkwork-agentstudio-pc-desktop',
      env: {
        CARGO_TARGET_DIR: '.tauri-short-target',
      },
    }).replaceAll('\\', '/'),
    'D:/workspace/agent-studio/packages/sdkwork-agentstudio-pc-desktop/.tauri-short-target',
  );
});
