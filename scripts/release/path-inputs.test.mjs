// WORKSPACE-PATH:allow-fixture: fixtures name a foreign checkout root, drive, or home directory to exercise path handling, so the literal is the value under assertion rather than a binding this build resolves
import assert from 'node:assert/strict';
import path from 'node:path';
import test from 'node:test';
import { pathToFileURL } from 'node:url';

const rootDir = path.resolve(import.meta.dirname, '..', '..');

test('release path inputs preserve explicit absolute paths across host platforms', async () => {
  const helperPath = path.join(rootDir, 'scripts', 'release', 'path-inputs.mjs');
  const helper = await import(pathToFileURL(helperPath).href);

  assert.equal(typeof helper.resolveCliPath, 'function');
  assert.equal(typeof helper.isExplicitAbsolutePath, 'function');

  assert.equal(helper.isExplicitAbsolutePath('/tmp/release-assets'), true);
  assert.equal(helper.isExplicitAbsolutePath('D:/synthetic/release-assets'), true);
  assert.equal(helper.isExplicitAbsolutePath('D:\\synthetic\\release-assets'), true);
  assert.equal(helper.isExplicitAbsolutePath('\\\\server\\share\\release-assets'), true);
  assert.equal(helper.isExplicitAbsolutePath('./artifacts/release'), false);

  assert.equal(
    helper.resolveCliPath('D:/synthetic/release-assets', '/home/sdkwork/workspace'),
    'D:/synthetic/release-assets',
  );
  assert.equal(
    helper.resolveCliPath('D:\\synthetic\\release-assets', '/home/sdkwork/workspace'),
    'D:\\synthetic\\release-assets',
  );
  assert.equal(
    helper.resolveCliPath('\\\\server\\share\\release-assets', '/home/sdkwork/workspace'),
    '\\\\server\\share\\release-assets',
  );
  assert.equal(
    helper.resolveCliPath('./artifacts/release', process.cwd()).replaceAll('\\', '/'),
    path.resolve(process.cwd(), './artifacts/release').replaceAll('\\', '/'),
  );
});
