// WORKSPACE-PATH:allow-fixture - this file is a test fixture that simulates a foreign
// checkout root, so the sdkwork-<name> segment below is the value under assertion rather
// than a binding to a real sibling checkout. PORTABILITY_SPEC.md section 5.2 governs it.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { pathToFileURL } from 'node:url';

import { shiftNumericVersion } from './test-support/version-fixtures.mjs';

const rootDir = path.resolve(import.meta.dirname, '..');
const openClawReleaseConfig = JSON.parse(
  readFileSync(path.join(rootDir, 'config', 'kernel-releases', 'openclaw.json'), 'utf8'),
);
const expectedNodeVersion = openClawReleaseConfig.nodeVersion;
const currentOpenClawVersion = String(openClawReleaseConfig.stableVersion);
const nextOpenClawVersion = shiftNumericVersion(currentOpenClawVersion, 1);

function createReadJsonFileStub() {
  return async (filePath) => {
    const normalizedPath = String(filePath).replaceAll('\\', '/');

    if (normalizedPath.endsWith('/config/kernel-releases/openclaw.json')) {
      return {
        kernelId: 'openclaw',
        stableVersion: currentOpenClawVersion,
        supportedChannels: ['stable'],
        defaultChannel: 'stable',
        nodeVersion: expectedNodeVersion,
        packageName: 'openclaw',
        runtimeRequirements: {
          requiredExternalRuntimes: ['nodejs'],
          requiredExternalRuntimeVersions: {
            nodejs: expectedNodeVersion,
          },
        },
      };
    }

    if (normalizedPath.endsWith('/packages/sdkwork-agentstudio-pc-desktop/src-tauri/resources/openclaw/manifest.json')) {
      return {
        schemaVersion: 1,
        runtimeId: 'openclaw',
        openclawVersion: currentOpenClawVersion,
        nodeVersion: expectedNodeVersion,
        platform: 'windows',
        arch: 'x64',
      };
    }

    if (normalizedPath.endsWith('/packages/sdkwork-agentstudio-pc-desktop/src-tauri/generated/release/openclaw-resource/manifest.json')) {
      return {
        schemaVersion: 1,
        runtimeId: 'openclaw',
        openclawVersion: currentOpenClawVersion,
        nodeVersion: expectedNodeVersion,
        platform: 'windows',
        arch: 'x64',
      };
    }

    throw new Error(`Unexpected JSON read: ${filePath}`);
  };
}

test('desktop openclaw runtime check includes upgrade rollback evidence contract', () => {
  const packageJson = JSON.parse(readFileSync(path.join(rootDir, 'package.json'), 'utf8'));

  assert.match(
    packageJson.scripts['check:desktop-openclaw-runtime'],
    /node scripts\/openclaw-upgrade-rollback-evidence\.test\.mjs/,
    'check:desktop-openclaw-runtime must execute the upgrade rollback evidence test',
  );
});

test('upgrade rollback evidence summarizes explicit upgrade and rollback readiness', async () => {
  const modulePath = path.join(rootDir, 'scripts', 'openclaw-upgrade-rollback-evidence.mjs');
  const evidence = await import(pathToFileURL(modulePath).href);

  assert.equal(typeof evidence.buildOpenClawUpgradeRollbackEvidence, 'function');

  const result = await evidence.buildOpenClawUpgradeRollbackEvidence({
    workspaceRootDir: 'D:/synthetic/workspace',
    targetVersion: nextOpenClawVersion,
    rollbackVersion: currentOpenClawVersion,
    target: {
      platformId: 'windows',
      archId: 'x64',
    },
    readJsonFileFn: createReadJsonFileStub(),
    assessOpenClawUpgradeReadinessFn: async () => ({
      targetVersion: nextOpenClawVersion,
      readyToUpgrade: true,
      blockers: [],
    }),
    inspectPreparedOpenClawRuntimeFn: async () => ({
      reusable: true,
      reason: 'ready',
      manifestPath: 'D:/synthetic/workspace/packages/sdkwork-agentstudio-pc-desktop/src-tauri/resources/openclaw/manifest.json',
    }),
    verifyDesktopOpenClawReleaseAssetsFn: async () => ({
      manifest: {
        openclawVersion: currentOpenClawVersion,
      },
      packagedResourceDir: 'D:/synthetic/workspace/packages/sdkwork-agentstudio-pc-desktop/src-tauri/generated/release/openclaw-resource',
    }),
  });

  assert.equal(result.baselineVersion, currentOpenClawVersion);
  assert.equal(result.targetVersion, nextOpenClawVersion);
  assert.equal(result.upgradeReady, true);
  assert.equal(result.rollbackReady, true);
  assert.match(
    result.sources.releaseConfigPath.replaceAll('\\', '/'),
    /config\/kernel-releases\/openclaw\.json$/,
    'upgrade rollback evidence must resolve OpenClaw baseline version from the kernel release registry',
  );
  assert.deepEqual(result.blockers, {
    upgrade: [],
    rollback: [],
  });
  assert.deepEqual(
    result.phases.map((entry) => ({ id: entry.id, status: entry.status })),
    [
      { id: 'baseline-alignment', status: 'passed' },
      { id: 'prepared-runtime', status: 'passed' },
      { id: 'packaged-release-verify', status: 'passed' },
      { id: 'upgrade-readiness', status: 'passed' },
      { id: 'rollback-readiness', status: 'passed' },
    ],
  );
});

test('upgrade rollback evidence turns packaged release verification failures into rollback blockers', async () => {
  const modulePath = path.join(rootDir, 'scripts', 'openclaw-upgrade-rollback-evidence.mjs');
  const evidence = await import(pathToFileURL(modulePath).href);

  const result = await evidence.buildOpenClawUpgradeRollbackEvidence({
    workspaceRootDir: 'D:/synthetic/workspace',
    rollbackVersion: currentOpenClawVersion,
    target: {
      platformId: 'windows',
      archId: 'x64',
    },
    readJsonFileFn: createReadJsonFileStub(),
    inspectPreparedOpenClawRuntimeFn: async () => ({
      reusable: true,
      reason: 'ready',
      manifestPath: 'D:/synthetic/workspace/packages/sdkwork-agentstudio-pc-desktop/src-tauri/resources/openclaw/manifest.json',
    }),
    verifyDesktopOpenClawReleaseAssetsFn: async () => {
      throw new Error('Missing packaged OpenClaw release manifest.');
    },
  });

  assert.equal(result.targetVersion, null);
  assert.equal(result.upgradeReady, null);
  assert.equal(result.rollbackReady, false);
  assert.match(
    result.blockers.rollback.join('\n'),
    /Missing packaged OpenClaw release manifest\./,
  );
  assert.deepEqual(
    result.phases.map((entry) => ({ id: entry.id, status: entry.status })),
    [
      { id: 'baseline-alignment', status: 'passed' },
      { id: 'prepared-runtime', status: 'passed' },
      { id: 'packaged-release-verify', status: 'failed' },
      { id: 'rollback-readiness', status: 'failed' },
    ],
  );
});
