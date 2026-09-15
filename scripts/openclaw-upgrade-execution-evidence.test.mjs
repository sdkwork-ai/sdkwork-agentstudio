// WORKSPACE-PATH:allow-fixture - this file is a test fixture that simulates a foreign
// checkout root, so the sdkwork-<name> segment below is the value under assertion rather
// than a binding to a real sibling checkout. PORTABILITY_SPEC.md section 5.2 governs it.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { pathToFileURL } from 'node:url';

import { DEFAULT_OPENCLAW_VERSION } from './openclaw-release.mjs';

const rootDir = path.resolve(import.meta.dirname, '..');

test('desktop openclaw runtime check includes upgrade execution evidence contract', () => {
  const packageJson = JSON.parse(readFileSync(path.join(rootDir, 'package.json'), 'utf8'));

  assert.match(
    packageJson.scripts['check:desktop-openclaw-runtime'],
    /node scripts\/openclaw-upgrade-execution-evidence\.test\.mjs/,
    'check:desktop-openclaw-runtime must execute the upgrade execution evidence test',
  );
  assert.match(
    packageJson.scripts['check:desktop-openclaw-runtime'],
    /node scripts\/openclaw-upgrade-execution-evidence\.mjs/,
    'check:desktop-openclaw-runtime must execute the real upgrade execution evidence probe against the current workspace',
  );
});

test('upgrade execution evidence summarizes release sync, target clean, prepare, and verify phases', async () => {
  const modulePath = path.join(rootDir, 'scripts', 'openclaw-upgrade-execution-evidence.mjs');
  const evidence = await import(pathToFileURL(modulePath).href);
  const expectedTargetCleanEnv = {
    CARGO_TARGET_DIR: path.join(
      'D:/synthetic/workspace',
      'target',
      'check-desktop-openclaw-runtime',
    ),
  };

  assert.equal(typeof evidence.buildOpenClawUpgradeExecutionEvidence, 'function');

  const result = await evidence.buildOpenClawUpgradeExecutionEvidence({
    workspaceRootDir: 'D:/synthetic/workspace',
    platform: 'windows',
    arch: 'x64',
    targetTriple: 'x86_64-pc-windows-msvc',
    srcTauriDir: 'D:/synthetic/workspace/packages/sdkwork-agentstudio-pc-desktop/src-tauri',
    createDesktopReleaseBuildPlanFn: ({ phase, targetTriple, releaseMode }) => ({
      command: process.execPath,
      args: phase === 'sync'
        ? ['scripts/sync-bundled-components.mjs', '--no-fetch', '--release']
        : ['scripts/prepare-openclaw-runtime.mjs'],
      env: {
        SDKWORK_DESKTOP_TARGET: targetTriple,
      },
      releaseMode,
    }),
    buildDesktopReleaseBuildPreflightPlanFn: ({ targetTriple }) => ({
      command: process.execPath,
      args: ['scripts/verify-desktop-openclaw-release-assets.mjs'],
      env: {
        SDKWORK_DESKTOP_TARGET: targetTriple,
      },
    }),
    createComponentExecutionPlanFn: ({ componentId, releaseMode }) => {
      assert.equal(componentId, 'openclaw');
      assert.equal(releaseMode, true);
      return {
        shouldBuild: false,
        shouldStage: false,
      };
    },
    ensureTauriTargetCleanFn: (srcTauriDir, { env } = {}) => {
      assert.equal(
        srcTauriDir,
        'D:/synthetic/workspace/packages/sdkwork-agentstudio-pc-desktop/src-tauri',
      );
      assert.equal(
        env.CARGO_TARGET_DIR.replaceAll('\\', '/'),
        expectedTargetCleanEnv.CARGO_TARGET_DIR.replaceAll('\\', '/'),
      );
      return {
        targetDir: 'D:/synthetic/workspace/packages/sdkwork-agentstudio-pc-desktop/src-tauri/target',
        targetDirs: ['D:/synthetic/workspace/packages/sdkwork-agentstudio-pc-desktop/src-tauri/target'],
        removedTarget: false,
        removedTargetDirs: [],
        staleEntries: [],
        bundledOpenClawIssues: [],
        stale: false,
      };
    },
    inspectTauriTargetFn: (_srcTauriDir, { env } = {}) => {
      assert.equal(
        env.CARGO_TARGET_DIR.replaceAll('\\', '/'),
        expectedTargetCleanEnv.CARGO_TARGET_DIR.replaceAll('\\', '/'),
      );
      return {
      targetDir: 'D:/synthetic/workspace/packages/sdkwork-agentstudio-pc-desktop/src-tauri/target',
      targetDirs: ['D:/synthetic/workspace/packages/sdkwork-agentstudio-pc-desktop/src-tauri/target'],
      staleEntries: [],
      bundledOpenClawIssues: [],
      stale: false,
      };
    },
    verifyDesktopOpenClawReleaseAssetsFn: async ({ target }) => {
      assert.equal(target.platformId, 'windows');
      assert.equal(target.archId, 'x64');
      return {
        manifest: {
          openclawVersion: DEFAULT_OPENCLAW_VERSION,
        },
        packagedResourceDir:
          'D:/synthetic/workspace/packages/sdkwork-agentstudio-pc-desktop/src-tauri/generated/release/openclaw-resource',
        installReadyLayout: {
          mode: 'archive-extract-ready',
        },
      };
    },
  });

  assert.equal(result.executionReady, true);
  assert.deepEqual(result.blockers, []);
  assert.deepEqual(
    result.phases.map((entry) => ({ id: entry.id, status: entry.status })),
    [
      { id: 'sync-plan', status: 'passed' },
      { id: 'target-clean', status: 'passed' },
      { id: 'prepare-plan', status: 'passed' },
      { id: 'release-verify', status: 'passed' },
      { id: 'execution-readiness', status: 'passed' },
    ],
  );
  assert.equal(result.syncExecutionPlan.shouldBuild, false);
  assert.equal(result.syncExecutionPlan.shouldStage, false);
});

test('upgrade execution evidence turns target clean drift into execution blockers', async () => {
  const modulePath = path.join(rootDir, 'scripts', 'openclaw-upgrade-execution-evidence.mjs');
  const evidence = await import(pathToFileURL(modulePath).href);
  const expectedTargetCleanEnv = {
    CARGO_TARGET_DIR: path.join(
      'D:/synthetic/workspace',
      'target',
      'check-desktop-openclaw-runtime',
    ),
  };

  const result = await evidence.buildOpenClawUpgradeExecutionEvidence({
    workspaceRootDir: 'D:/synthetic/workspace',
    platform: 'windows',
    arch: 'x64',
    targetTriple: 'x86_64-pc-windows-msvc',
    srcTauriDir: 'D:/synthetic/workspace/packages/sdkwork-agentstudio-pc-desktop/src-tauri',
    createDesktopReleaseBuildPlanFn: ({ phase, targetTriple }) => ({
      command: process.execPath,
      args: phase === 'sync'
        ? ['scripts/sync-bundled-components.mjs', '--no-fetch', '--release']
        : ['scripts/prepare-openclaw-runtime.mjs'],
      env: {
        SDKWORK_DESKTOP_TARGET: targetTriple,
      },
    }),
    buildDesktopReleaseBuildPreflightPlanFn: ({ targetTriple }) => ({
      command: process.execPath,
      args: ['scripts/verify-desktop-openclaw-release-assets.mjs'],
      env: {
        SDKWORK_DESKTOP_TARGET: targetTriple,
      },
    }),
    createComponentExecutionPlanFn: () => ({
      shouldBuild: false,
      shouldStage: false,
    }),
    ensureTauriTargetCleanFn: (_srcTauriDir, { env } = {}) => {
      assert.equal(
        env.CARGO_TARGET_DIR.replaceAll('\\', '/'),
        expectedTargetCleanEnv.CARGO_TARGET_DIR.replaceAll('\\', '/'),
      );
      return {
      targetDir: 'D:/synthetic/workspace/packages/sdkwork-agentstudio-pc-desktop/src-tauri/target',
      targetDirs: ['D:/synthetic/workspace/packages/sdkwork-agentstudio-pc-desktop/src-tauri/target'],
      removedTarget: true,
      removedTargetDirs: ['D:/synthetic/workspace/packages/sdkwork-agentstudio-pc-desktop/src-tauri/target'],
      staleEntries: [
        {
          entryPath: 'D:/synthetic/workspace/packages/sdkwork-agentstudio-pc-desktop/src-tauri/target/permission-files',
          reason: 'referenced permission file does not exist',
        },
      ],
      bundledOpenClawIssues: [],
      stale: true,
      };
    },
    inspectTauriTargetFn: (_srcTauriDir, { env } = {}) => {
      assert.equal(
        env.CARGO_TARGET_DIR.replaceAll('\\', '/'),
        expectedTargetCleanEnv.CARGO_TARGET_DIR.replaceAll('\\', '/'),
      );
      return {
      targetDir: 'D:/synthetic/workspace/packages/sdkwork-agentstudio-pc-desktop/src-tauri/target',
      targetDirs: ['D:/synthetic/workspace/packages/sdkwork-agentstudio-pc-desktop/src-tauri/target'],
      staleEntries: [
        {
          entryPath: 'D:/synthetic/workspace/packages/sdkwork-agentstudio-pc-desktop/src-tauri/target/permission-files',
          reason: 'referenced permission file does not exist',
        },
      ],
      bundledOpenClawIssues: [],
      stale: true,
      };
    },
    verifyDesktopOpenClawReleaseAssetsFn: async () => ({
      manifest: {
        openclawVersion: DEFAULT_OPENCLAW_VERSION,
      },
      packagedResourceDir:
        'D:/synthetic/workspace/packages/sdkwork-agentstudio-pc-desktop/src-tauri/generated/release/openclaw-resource',
      installReadyLayout: {
        mode: 'archive-extract-ready',
      },
    }),
  });

  assert.equal(result.executionReady, false);
  assert.match(
    result.blockers.join('\n'),
    /Tauri target cache still contains stale packaged OpenClaw or permission references after cleanup\./,
  );
  assert.deepEqual(
    result.phases.map((entry) => ({ id: entry.id, status: entry.status })),
    [
      { id: 'sync-plan', status: 'passed' },
      { id: 'target-clean', status: 'failed' },
      { id: 'prepare-plan', status: 'passed' },
      { id: 'release-verify', status: 'passed' },
      { id: 'execution-readiness', status: 'failed' },
    ],
  );
});

test('upgrade execution evidence re-inspects after stale OpenClaw resource cleanup', async () => {
  const modulePath = path.join(rootDir, 'scripts', 'openclaw-upgrade-execution-evidence.mjs');
  const evidence = await import(pathToFileURL(modulePath).href);
  let inspectCalls = 0;

  const result = await evidence.buildOpenClawUpgradeExecutionEvidence({
    workspaceRootDir: 'D:/synthetic/workspace',
    platform: 'windows',
    arch: 'x64',
    targetTriple: 'x86_64-pc-windows-msvc',
    srcTauriDir: 'D:/synthetic/workspace/packages/sdkwork-agentstudio-pc-desktop/src-tauri',
    createDesktopReleaseBuildPlanFn: ({ phase }) => ({
      command: process.execPath,
      args: phase === 'sync'
        ? ['scripts/sync-bundled-components.mjs', '--no-fetch', '--release']
        : ['scripts/prepare-openclaw-runtime.mjs'],
    }),
    buildDesktopReleaseBuildPreflightPlanFn: () => ({
      command: process.execPath,
      args: ['scripts/verify-desktop-openclaw-release-assets.mjs'],
    }),
    createComponentExecutionPlanFn: () => ({
      shouldBuild: false,
      shouldStage: false,
    }),
    ensureTauriTargetCleanFn: () => ({
      targetDir: 'D:/synthetic/workspace/packages/sdkwork-agentstudio-pc-desktop/src-tauri/target',
      targetDirs: ['D:/synthetic/workspace/packages/sdkwork-agentstudio-pc-desktop/src-tauri/target'],
      removedTarget: false,
      removedTargetDirs: [],
      removedResourceDirs: [
        'D:/synthetic/workspace/packages/sdkwork-agentstudio-pc-desktop/src-tauri/target/debug/resources/openclaw',
      ],
      staleEntries: [],
      bundledOpenClawIssues: [
        {
          resourceDir:
            'D:/synthetic/workspace/packages/sdkwork-agentstudio-pc-desktop/src-tauri/target/debug/resources/openclaw',
          reason: 'packaged OpenClaw target manifest does not match the expected packaged OpenClaw manifest for the current release target',
        },
      ],
      stale: true,
    }),
    inspectTauriTargetFn: () => {
      inspectCalls += 1;
      return {
        targetDir: 'D:/synthetic/workspace/packages/sdkwork-agentstudio-pc-desktop/src-tauri/target',
        targetDirs: ['D:/synthetic/workspace/packages/sdkwork-agentstudio-pc-desktop/src-tauri/target'],
        staleEntries: [],
        bundledOpenClawIssues: [],
        stale: false,
      };
    },
    verifyDesktopOpenClawReleaseAssetsFn: async () => ({
      manifest: {
        openclawVersion: DEFAULT_OPENCLAW_VERSION,
      },
      packagedResourceDir:
        'D:/synthetic/workspace/packages/sdkwork-agentstudio-pc-desktop/src-tauri/generated/release/openclaw-resource',
      installReadyLayout: {
        mode: 'archive-extract-ready',
      },
    }),
  });

  assert.equal(inspectCalls, 1);
  assert.equal(result.executionReady, true);
  assert.equal(
    result.phases.find((phase) => phase.id === 'target-clean')?.status,
    'passed',
  );
  assert.deepEqual(result.blockers, []);
});
