// WORKSPACE-PATH:allow-fixture - this file is a test fixture that simulates a foreign
// checkout root, so the sdkwork-<name> segment below is the value under assertion rather
// than a binding to a real sibling checkout. PORTABILITY_SPEC.md section 5.2 governs it.
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { derivePreviousNumericVersion } from './test-support/version-fixtures.mjs';

const rootDir = path.resolve(import.meta.dirname, '..');
const syncModulePath = path.join(rootDir, 'scripts', 'sync-bundled-components.mjs');
const syncModuleSource = readFileSync(syncModulePath, 'utf8');
const syncModule = await import(pathToFileURL(syncModulePath).href);
const expectedOpenClawVersion = syncModule.resolvePinnedOpenClawVersion({ env: {} });
const openClawReleaseConfig = JSON.parse(
  readFileSync(path.join(rootDir, 'config', 'kernel-releases', 'openclaw.json'), 'utf8'),
);
const expectedNodeVersion = openClawReleaseConfig.nodeVersion;

const staleOpenClawVersion = derivePreviousNumericVersion(expectedOpenClawVersion);

assert.equal(
  typeof syncModule.createTauriBundleOverlayConfig,
  'function',
  'sync-bundled-components must export createTauriBundleOverlayConfig',
);
assert.equal(
  typeof syncModule.resolveComponentRepositoryDir,
  'function',
  'sync-bundled-components must export resolveComponentRepositoryDir',
);
assert.equal(
  typeof syncModule.resolvePinnedOpenClawVersion,
  'function',
  'sync-bundled-components must export resolvePinnedOpenClawVersion',
);
assert.equal(
  typeof syncModule.shouldRefreshComponentRepository,
  'function',
  'sync-bundled-components must export shouldRefreshComponentRepository',
);
assert.equal(
  typeof syncModule.removeDirectoryWithRetriesSync,
  'function',
  'sync-bundled-components must export removeDirectoryWithRetriesSync',
);
assert.equal(
  typeof syncModule.inspectOpenClawPackageMetadata,
  'function',
  'sync-bundled-components must export inspectOpenClawPackageMetadata',
);
assert.equal(
  typeof syncModule.resolvePreparedOpenClawPackageRoots,
  'function',
  'sync-bundled-components must export resolvePreparedOpenClawPackageRoots',
);
assert.equal(
  typeof syncModule.inspectPreparedOpenClawPackageRuntime,
  'function',
  'sync-bundled-components must export inspectPreparedOpenClawPackageRuntime',
);
assert.equal(
  typeof syncModule.resolveBundledBuildRoot,
  'function',
  'sync-bundled-components must export resolveBundledBuildRoot',
);
assert.equal(
  typeof syncModule.pruneWindowsBundledMirrorRoots,
  'function',
  'sync-bundled-components must export pruneWindowsBundledMirrorRoots',
);
assert.equal(
  typeof syncModule.prepareBundledOutputRootSync,
  'function',
  'sync-bundled-components must export prepareBundledOutputRootSync',
);
assert.equal(
  typeof syncModule.copyBundledFileSync,
  'function',
  'sync-bundled-components must export copyBundledFileSync',
);
assert.equal(
  typeof syncModule.writeJsonWithWindowsLockFallback,
  'function',
  'sync-bundled-components must export writeJsonWithWindowsLockFallback',
);
assert.equal(
  typeof syncModule.syncSourceFoundationComponentRegistrySync,
  'function',
  'sync-bundled-components must export syncSourceFoundationComponentRegistrySync',
);
assert.equal(
  typeof syncModule.validateStagedOpenClawPackage,
  'function',
  'sync-bundled-components must export validateStagedOpenClawPackage',
);
assert.equal(
  typeof syncModule.ensureBuildTimeNodeRuntimeCacheReady,
  'function',
  'sync-bundled-components must export ensureBuildTimeNodeRuntimeCacheReady',
);
assert.equal(
  typeof syncModule.createBundleManifest,
  'function',
  'sync-bundled-components must export createBundleManifest',
);
assert.equal(
  typeof syncModule.createPackageProfileBundleSyncPlan,
  'function',
  'sync-bundled-components must export createPackageProfileBundleSyncPlan',
);
assert.equal(
  typeof syncModule.filterPackagedComponentRegistry,
  'function',
  'sync-bundled-components must export filterPackagedComponentRegistry',
);
assert.match(
  syncModuleSource,
  /resolveOpenClawRuntimeInstallSpecs/,
  'sync-bundled-components must use the shared OpenClaw runtime install spec helper so supplemental runtime packages stay aligned across prepare and stage flows',
);
assert.match(
  syncModuleSource,
  /buildOpenClawRuntimeInstallEnv/,
  'sync-bundled-components must use the shared OpenClaw runtime install env helper so staging installs disable the bundled plugin postinstall',
);
assert.match(
  syncModuleSource,
  /env:\s*buildOpenClawRuntimeInstallEnv\(commandEnv\)/,
  'sync-bundled-components must install OpenClaw staging packages with the shared runtime install env',
);
assert.match(
  syncModuleSource,
  /spawnSync\(command, commandArgs,[\s\S]*windowsHide:\s*true/,
  'sync-bundled-components command runner must hide Windows child-process windows',
);
assert.match(
  syncModuleSource,
  /if \(process\.argv\[1\] && path\.resolve\(process\.argv\[1\]\) === __filename\) \{\s*main\(\)\.catch\(\(error\) => \{\s*console\.error\(error instanceof Error \? error\.message : String\(error\)\);\s*process\.exit\(1\);\s*\}\);\s*\}/s,
  'sync-bundled-components must wrap the CLI entrypoint with a top-level error handler',
);
assert.match(
  syncModuleSource,
  /validatePreparedOpenClawPackageTree/,
  'sync-bundled-components must reuse the shared prepared OpenClaw package validation before accepting staged bundles',
);
assert.match(
  syncModuleSource,
  /installMissingBundledPluginRuntimeDeps/,
  'sync-bundled-components must hydrate missing bundled plugin runtime dependencies after staging npm installs so dev bundles survive plugin dependency additions',
);
assert.doesNotMatch(
  syncModuleSource,
  /findMissingDirectPackageDependencies|did not hydrate direct dependencies/,
  'sync-bundled-components must delegate upstream dependency hydration to pnpm install instead of inspecting node_modules directly',
);
assert.match(
  syncModuleSource,
  /runCommand\(pnpmCmd,\s*\['install',\s*'--frozen-lockfile'\]/,
  'sync-bundled-components must run pnpm install before building OpenClaw so package-manager state, not custom node_modules probing, hydrates new dependencies',
);
const overlay = syncModule.createTauriBundleOverlayConfig({
  workspaceRootDir: 'D:\\workspace\\agent-studio',
  platform: 'win32',
});

assert.equal(typeof overlay, 'object');
assert.equal(typeof overlay.bundle, 'object');
assert.equal(typeof overlay.bundle.resources, 'object');

const resources = overlay.bundle.resources;

assert.ok(
  syncModuleSource.indexOf("const desktopSrcTauriPathSegments = ['packages', 'sdkwork-agentstudio-pc-desktop', 'src-tauri'];") <
    syncModuleSource.indexOf('const bundledRoot = resolveBundledBuildRoot(rootDir, process.platform);'),
  'desktopSrcTauriPathSegments must be initialized before bundledRoot for non-Windows module loading',
);

for (const [resourceId, expectedSource, expectedTarget] of [
  ['bundled', 'generated/br/b/', 'generated/bundled/'],
  ['web-dist', 'generated/br/w/', 'dist/'],
  ['openclaw-runtime', 'generated/br/o/', 'resources/openclaw/'],
]) {
  assert.equal(
    resources[expectedSource],
    expectedTarget,
    `missing overlay bridge mapping for ${resourceId}`,
  );
  assert.doesNotMatch(
    expectedSource,
    /^[a-zA-Z]:[\\/]/,
    `overlay bridge source must stay repo-relative for ${resourceId}`,
  );
  assert.equal(
    expectedSource.includes('.sdkwork-bc'),
    false,
    `overlay bridge source must not expose external mirror roots for ${resourceId}`,
  );
}

assert.deepEqual(
  Object.keys(resources).sort(),
  [
    'foundation/components/',
    'generated/br/b/',
    'generated/br/o/',
    'generated/br/w/',
  ],
  'sync-bundled-components must keep only OpenClaw, web dist, and foundation mappings in the Windows Tauri overlay',
);

assert.deepEqual(
  syncModule.createPackageProfileBundleSyncPlan({
    packageProfileId: 'hermes-only',
  }),
  {
    packageProfileId: 'hermes-only',
    includedKernelIds: ['hermes'],
    bundledKernelIds: [],
    includesOpenClaw: false,
    requiresBuildTimeNodeRuntimeCache: false,
    shouldIncludeOpenClawResources: false,
  },
  'sync-bundled-components must derive a package-profile sync plan that removes OpenClaw bundle work from hermes-only packages',
);

assert.equal(
  syncModule.createPackageProfileBundleSyncPlan({
    packageProfileId: 'openclaw-only',
  }).requiresBuildTimeNodeRuntimeCache,
  true,
  'sync-bundled-components must record that openclaw-bearing package profiles depend on a build-time Node cache while still keeping Node.js external to packaged artifacts',
);

assert.deepEqual(
  syncModule.filterPackagedComponentRegistry({
    componentRegistry: {
      version: 1,
      components: [
        { id: 'openclaw', bundledVersion: expectedOpenClawVersion },
        { id: 'zeroclaw', bundledVersion: 'bundled' },
      ],
    },
    bundledKernelIds: [],
  }),
  {
    version: 1,
    components: [
      { id: 'zeroclaw', bundledVersion: 'bundled' },
    ],
  },
  'sync-bundled-components must remove kernel component catalog entries that are excluded by the active package profile while keeping unrelated support components',
);

assert.deepEqual(
  syncModule.createTauriBundleOverlayConfig({
    workspaceRootDir: 'D:\\workspace\\agent-studio',
    platform: 'win32',
    packageProfileId: 'hermes-only',
  }),
  {
    bundle: {
      resources: {
        'foundation/components/': 'foundation/components/',
        'generated/br/b/': 'generated/bundled/',
        'generated/br/w/': 'dist/',
      },
    },
  },
  'sync-bundled-components must omit OpenClaw resource bridge mappings from hermes-only Windows bundle overlays',
);

const cachedOpenClawRepoDir = syncModule.resolveComponentRepositoryDir({
  component: {
    checkoutDir: 'openclaw',
  },
  upstreamRootDir: 'D:\\workspace\\agent-studio\\.cache\\bundled-components\\upstreams',
});

assert.equal(
  cachedOpenClawRepoDir,
  'D:\\workspace\\agent-studio\\.cache\\bundled-components\\upstreams\\openclaw',
  'sync-bundled-components must continue to use cached upstream checkouts for non-vendored components',
);

const windowsBundledBuildRoot = syncModule.resolveBundledBuildRoot(
  'D:\\workspace\\agent-studio',
  'win32',
  'unit-test-run',
);

assert.equal(
  windowsBundledBuildRoot,
  'D:\\.sdkwork-bc\\agent-studio\\bundled-mirrors\\bundled-unit-test-run',
  'sync-bundled-components must stage Windows bundled assets into a dedicated mirror directory instead of mutating a long-lived shared bundled root in place',
);

const overriddenWindowsBundledBuildRoot = syncModule.resolveBundledBuildRoot(
  'D:\\workspace\\agent-studio',
  'win32',
  'unit-test-run',
  'D:\\workspace\\agent-studio\\.cache\\short-mirrors',
);

assert.equal(
  overriddenWindowsBundledBuildRoot,
  'D:\\workspace\\agent-studio\\.cache\\short-mirrors\\bundled-mirrors\\bundled-unit-test-run',
  'sync-bundled-components must allow the Windows short mirror base directory to be overridden for restricted environments that cannot write to the drive-root mirror location',
);

{
  const windowsMirrorBaseDir = 'D:\\.sdkwork-bc\\agent-studio';
  const mirrorRoot = 'D:\\.sdkwork-bc\\agent-studio\\bundled-mirrors';
  const activeBundleRoot = `${mirrorRoot}\\bundled-20260405-120000-1234`;
  const removedMirrorPaths = [];
  const loggedMessages = [];
  const mirrorMtimeByPath = new Map([
    [`${mirrorRoot}\\bundled-20260405-120000-1234`, 500],
    [`${mirrorRoot}\\bundled-20260405-110000-1233`, 400],
    [`${mirrorRoot}\\bundled-20260405-100000-1232`, 300],
    [`${mirrorRoot}\\bundled-20260405-090000-1231`, 200],
    [`${mirrorRoot}\\bundled-20260405-080000-1230`, 100],
  ]);

  const prunedMirrorPaths = syncModule.pruneWindowsBundledMirrorRoots({
    workspaceRootDir: 'D:\\workspace\\agent-studio',
    platform: 'win32',
    activeBundleRoot,
    windowsMirrorBaseDir,
    retentionCount: 3,
    existsImpl: () => true,
    readdirImpl: () => [
      { name: 'bundled-20260405-120000-1234', isDirectory: () => true },
      { name: 'bundled-20260405-110000-1233', isDirectory: () => true },
      { name: 'bundled-20260405-100000-1232', isDirectory: () => true },
      { name: 'bundled-20260405-090000-1231', isDirectory: () => true },
      { name: 'bundled-20260405-080000-1230', isDirectory: () => true },
      { name: 'notes.txt', isDirectory: () => false },
    ],
    statImpl: (targetPath) => ({
      mtimeMs: mirrorMtimeByPath.get(targetPath) ?? 0,
    }),
    cleanupImpl: (targetPath) => {
      removedMirrorPaths.push(targetPath);
    },
    logger: (message) => {
      loggedMessages.push(message);
    },
  });

  assert.deepEqual(
    prunedMirrorPaths,
    [
      `${mirrorRoot}\\bundled-20260405-090000-1231`,
      `${mirrorRoot}\\bundled-20260405-080000-1230`,
    ],
    'sync-bundled-components must prune stale Windows bundled mirrors beyond the active mirror plus a small rollback window',
  );
  assert.deepEqual(
    removedMirrorPaths,
    prunedMirrorPaths,
    'sync-bundled-components must delete the same stale Windows bundled mirrors that it reports as pruned',
  );
  assert.deepEqual(
    loggedMessages,
    [],
    'sync-bundled-components must not log pruning warnings when stale Windows bundled mirrors are removed successfully',
  );
}

assert.equal(
  syncModule.resolvePinnedOpenClawVersion({ env: {} }),
  expectedOpenClawVersion,
  'sync-bundled-components must stay aligned with the bundled OpenClaw runtime version pin',
);
assert.equal(
  syncModule.resolvePinnedOpenClawVersion({
    env: {
      OPENCLAW_VERSION: `${expectedOpenClawVersion}-override`,
    },
  }),
  expectedOpenClawVersion,
  'sync-bundled-components must ignore OPENCLAW_VERSION so config/kernel-releases/openclaw.json remains the only OpenClaw version source',
);
assert.match(
  syncModuleSource,
  /inspectCachedNodeRuntimeDir/,
  'sync-bundled-components must validate the bundled node runtime against the prepared OpenClaw runtime cache before staging it',
);
assert.match(
  syncModuleSource,
  /prepareOpenClawRuntime/,
  'sync-bundled-components must reuse the shared OpenClaw runtime preparation flow when the build-time Node cache is missing or stale',
);
assert.doesNotMatch(
  syncModuleSource,
  /bundleManifest\.runtimeVersions\.node = DEFAULT_NODE_VERSION;/,
  'sync-bundled-components must not record a standalone bundled node runtime in bundle-manifest.json because Node.js is not packaged as a desktop asset',
);
assert.doesNotMatch(
  syncModuleSource,
  /const nodeVersion = process\.versions\.node;/,
  'sync-bundled-components must not derive the bundled node runtime manifest version from the local shell Node.js version',
);
assert.doesNotMatch(
  syncModuleSource,
  /copyFile\(process\.execPath,\s*bundledNodeBinaryPath\);/,
  'sync-bundled-components must not stage the bundled node runtime from the local shell executable because that can drift from the pinned OpenClaw runtime version',
);
assert.doesNotMatch(
  syncModuleSource,
  /shouldStageBundledNodeRuntime/,
  'sync-bundled-components package-profile sync plans must stop exposing legacy bundled Node staging flags after the external-runtime hard cut',
);
assert.doesNotMatch(
  syncModuleSource,
  /bundleManifest\.components\.push\(/,
  'sync-bundled-components must not record kernel bundle staging entries under the generic support-component manifest field',
);
assert.match(
  syncModuleSource,
  /bundleManifest\.kernelBundles\.push\(/,
  'sync-bundled-components must record kernel bundle staging entries under a dedicated kernelBundles manifest field',
);
assert.doesNotMatch(
  syncModuleSource,
  /normalized source component registry openclaw version/,
  'sync-bundled-components must stop normalizing OpenClaw version metadata inside the generic desktop component registry after the kernel-platform hard cut',
);

  assert.deepEqual(
    syncModule.createBundleManifest({
      packageProfileId: 'dual-kernel',
      generatedAt: '1970-01-01T00:00:00.000Z',
  }),
  {
    version: 1,
    generatedAt: '1970-01-01T00:00:00.000Z',
    packageProfileId: 'dual-kernel',
    includedKernelIds: ['openclaw', 'hermes'],
    defaultEnabledKernelIds: ['openclaw', 'hermes'],
    requiredExternalRuntimes: ['nodejs', 'python', 'uv'],
    optionalExternalRuntimes: [],
    launcherKinds: ['externalLocal', 'externalWslOrRemote'],
    kernelPlatformSupport: {
      openclaw: {
        windows: 'native',
        macos: 'native',
        linux: 'native',
      },
      hermes: {
        windows: 'wsl2OrRemoteOnly',
        macos: 'native',
        linux: 'native',
      },
    },
    components: [],
    kernelBundles: [],
    runtimeVersions: {},
  },
  'sync-bundled-components must seed bundle-manifest.json from the explicit kernel package profile contract instead of only from generic bundled component metadata',
);

{
  const inspectCalls = [];
  const prepareCalls = [];
  const readyTarget = {
    platformId: 'windows',
    archId: 'x64',
    nodeBinaryRelativePath: 'runtime/node/node.exe',
    nodeArchiveName(version) {
      return `node-v${version}-win-x64.zip`;
    },
  };
  const readyResult = await syncModule.ensureBuildTimeNodeRuntimeCacheReady({
    cacheDir: 'D:\\workspace\\.cache\\openclaw-runtime-cache',
    openclawVersion: expectedOpenClawVersion,
    nodeVersion: expectedNodeVersion,
    target: readyTarget,
    inspectCachedNodeRuntimeDirImpl: async (params) => {
      inspectCalls.push(params);
      return {
        reusable: true,
        reason: 'ready',
        preparedNodeVersion: expectedNodeVersion,
      };
    },
    prepareOpenClawRuntimeImpl: async (params) => {
      prepareCalls.push(params);
    },
  });

  assert.equal(
    readyResult.nodeSourceDir,
    `D:\\workspace\\.cache\\openclaw-runtime-cache\\node\\windows-x64-node-v${expectedNodeVersion}`,
    'sync-bundled-components must stage the bundled node runtime from the prepared OpenClaw node cache root',
  );
  assert.equal(
    readyResult.nodeBinaryPath,
    `D:\\workspace\\.cache\\openclaw-runtime-cache\\node\\windows-x64-node-v${expectedNodeVersion}\\node.exe`,
    'sync-bundled-components must resolve the staged build-time Node binary from the prepared cache instead of process.execPath',
  );
  assert.equal(
    readyResult.refreshedRuntime,
    false,
    'sync-bundled-components must reuse a ready build-time Node cache without re-running runtime preparation',
  );
  assert.equal(
    inspectCalls.length,
    1,
    'sync-bundled-components must inspect the prepared build-time Node cache before staging it',
  );
  assert.deepEqual(
    prepareCalls,
    [],
    'sync-bundled-components must not re-run OpenClaw runtime preparation when the prepared build-time Node cache is already reusable',
  );
}

{
  const prepareCalls = [];
  const inspectResults = [
    {
      reusable: false,
      reason: 'invalid',
    },
    {
      reusable: true,
      reason: 'ready',
      preparedNodeVersion: expectedNodeVersion,
    },
  ];

  const refreshedResult = await syncModule.ensureBuildTimeNodeRuntimeCacheReady({
    cacheDir: 'D:\\workspace\\.cache\\openclaw-runtime-cache',
    openclawVersion: expectedOpenClawVersion,
    nodeVersion: expectedNodeVersion,
    target: {
      platformId: 'windows',
      archId: 'x64',
      nodeBinaryRelativePath: 'runtime/node/node.exe',
      nodeArchiveName(version) {
        return `node-v${version}-win-x64.zip`;
      },
    },
    inspectCachedNodeRuntimeDirImpl: async () => inspectResults.shift(),
    prepareOpenClawRuntimeImpl: async (params) => {
      prepareCalls.push(params);
    },
  });

  assert.equal(
    refreshedResult.refreshedRuntime,
    true,
    'sync-bundled-components must refresh the prepared node runtime cache when the cached runtime is missing or stale',
  );
  assert.equal(
    prepareCalls.length,
    1,
    'sync-bundled-components must invoke the shared OpenClaw runtime preparation flow when the build-time Node cache is not reusable',
  );
  assert.equal(
    prepareCalls[0].nodeVersion,
    expectedNodeVersion,
    'sync-bundled-components must prepare the build-time Node runtime using the shared pinned Node version',
  );
  assert.equal(
    prepareCalls[0].openclawVersion,
    expectedOpenClawVersion,
    'sync-bundled-components must prepare the build-time Node runtime using the shared pinned OpenClaw version',
  );
}

{
  await assert.rejects(
    () =>
      syncModule.ensureBuildTimeNodeRuntimeCacheReady({
        cacheDir: 'D:\\workspace\\.cache\\openclaw-runtime-cache',
        openclawVersion: expectedOpenClawVersion,
        nodeVersion: expectedNodeVersion,
        target: {
          platformId: 'windows',
          archId: 'x64',
          nodeBinaryRelativePath: 'runtime/node/node.exe',
          nodeArchiveName(version) {
            return `node-v${version}-win-x64.zip`;
          },
        },
        inspectCachedNodeRuntimeDirImpl: async () => ({
          reusable: false,
          reason: 'invalid',
        }),
        prepareOpenClawRuntimeImpl: async () => ({
          resourceDir: 'D:\\workspace\\agent-studio\\packages\\sdkwork-agentstudio-pc-desktop\\src-tauri\\resources\\openclaw',
          manifest: {
            cliRelativePath: 'runtime/package/node_modules/openclaw/openclaw.mjs',
          },
        }),
        inspectPreparedOpenClawRuntimeImpl: async () => ({
          reusable: true,
          reason: 'reused-existing',
        }),
      }),
    /build-time node runtime cache/i,
    'sync-bundled-components must not fall back to a prepared resource runtime because Node.js is an external prerequisite and the build-time node cache remains the only valid node source',
  );
}

{
  await assert.rejects(
    () =>
      syncModule.ensureBuildTimeNodeRuntimeCacheReady({
        cacheDir: 'D:\\workspace\\.cache\\openclaw-runtime-cache',
        openclawVersion: expectedOpenClawVersion,
        nodeVersion: expectedNodeVersion,
        target: {
          platformId: 'windows',
          archId: 'x64',
          nodeBinaryRelativePath: 'runtime/node/node.exe',
          nodeArchiveName(version) {
            return `node-v${version}-win-x64.zip`;
          },
        },
        inspectCachedNodeRuntimeDirImpl: async () => ({
          reusable: false,
          reason: 'node-version-mismatch',
          preparedNodeVersion: '22.20.0',
        }),
        prepareOpenClawRuntimeImpl: async () => ({
          resourceDir: 'D:\\workspace\\agent-studio\\packages\\sdkwork-agentstudio-pc-desktop\\src-tauri\\resources\\openclaw',
          manifest: {
            cliRelativePath: 'runtime/package/node_modules/openclaw/openclaw.mjs',
          },
        }),
        inspectPreparedOpenClawRuntimeImpl: async () => ({
          reusable: false,
          reason: 'node-version-mismatch',
          preparedNodeVersion: '22.20.0',
        }),
      }),
    new RegExp(`${expectedNodeVersion.replaceAll('.', '\\.')}.*22\\.20\\.0|22\\.20\\.0.*${expectedNodeVersion.replaceAll('.', '\\.')}`),
    'sync-bundled-components must fail loudly when the prepared build-time Node cache still does not match the pinned OpenClaw runtime version after preparation',
  );
}

{
  const preparedRoots = syncModule.resolvePreparedOpenClawPackageRoots({
    cacheDir: 'D:\\workspace\\.cache\\openclaw-runtime-cache',
    openclawVersion: expectedOpenClawVersion,
    nodeVersion: expectedNodeVersion,
    target: {
      platformId: 'windows',
      archId: 'x64',
      nodeArchiveName(version) {
        return `node-v${version}-win-x64.zip`;
      },
    },
  });

  assert.equal(
    preparedRoots.preparedPackageRoot,
    `D:\\workspace\\.cache\\openclaw-runtime-cache\\package\\windows-x64-openclaw-v${expectedOpenClawVersion}\\node_modules\\openclaw`,
    'sync-bundled-components must resolve prepared OpenClaw staging roots from the runtime cache instead of src-tauri resources',
  );
  assert.equal(
    preparedRoots.preparedModulesDir,
    `D:\\workspace\\.cache\\openclaw-runtime-cache\\package\\windows-x64-openclaw-v${expectedOpenClawVersion}\\node_modules`,
    'sync-bundled-components must reuse the cached runtime node_modules directory for prepared OpenClaw staging',
  );
}

assert.equal(
  syncModule.shouldRefreshComponentRepository({
    componentId: 'openclaw',
    noFetch: true,
    releaseMode: true,
    desiredVersion: expectedOpenClawVersion,
    currentVersion: staleOpenClawVersion,
    currentTags: [`v${staleOpenClawVersion}`],
  }),
  false,
  'sync-bundled-components release mode must not refresh stale OpenClaw checkouts because release packaging is handled by the dedicated runtime preparation phase',
);

assert.equal(
  syncModule.shouldRefreshComponentRepository({
    componentId: 'openclaw',
    noFetch: true,
    desiredVersion: expectedOpenClawVersion,
    currentVersion: staleOpenClawVersion,
    currentTags: [`v${staleOpenClawVersion}`],
  }),
  true,
  'sync-bundled-components must refresh stale OpenClaw checkouts even when --no-fetch is enabled',
);

assert.equal(
  syncModule.shouldRefreshComponentRepository({
    componentId: 'openclaw',
    noFetch: true,
    desiredVersion: expectedOpenClawVersion,
    currentVersion: expectedOpenClawVersion,
    currentTags: [`v${expectedOpenClawVersion}`],
  }),
  false,
  'sync-bundled-components must reuse OpenClaw checkouts already pinned to the bundled runtime release',
);

assert.equal(
  syncModule.shouldRefreshComponentRepository({
    componentId: 'openclaw',
    noFetch: true,
    desiredVersion: expectedOpenClawVersion,
    currentVersion: expectedOpenClawVersion,
    currentTags: [],
  }),
  false,
  'sync-bundled-components must not require git tag inspection during --no-fetch when the checkout version already matches',
);

assert.match(
  syncModuleSource,
  /refs\/tags\/v\$\{desiredVersion\}/,
  'sync-bundled-components must pin OpenClaw checkouts to the matching release tag',
);

{
  let attempts = 0;
  const sleepCalls = [];

  syncModule.removeDirectoryWithRetriesSync('D:\\tmp\\bundled', {
    retryCount: 3,
    retryDelayMs: 10,
    logger: () => {},
    sleepImpl: (delayMs) => {
      sleepCalls.push(delayMs);
    },
    removeImpl: () => {
      attempts += 1;
      if (attempts === 1) {
        const error = new Error('busy directory');
        error.code = 'ENOTEMPTY';
        throw error;
      }
    },
  });

  assert.equal(
    attempts,
    2,
    'sync-bundled-components must retry bundled directory cleanup after transient ENOTEMPTY failures',
  );
  assert.deepEqual(
    sleepCalls,
    [10],
    'sync-bundled-components must back off before retrying transient bundled cleanup failures',
  );
}

{
  let cleanupCalls = 0;
  const logLines = [];

  syncModule.prepareBundledOutputRootSync('D:\\tmp\\bundled', {
    cleanupImpl: () => {
      cleanupCalls += 1;
      const error = new Error('bundle-manifest.json is locked');
      error.code = 'EPERM';
      throw error;
    },
    logger: (line) => {
      logLines.push(line);
    },
  });

  assert.equal(
    cleanupCalls,
    1,
    'sync-bundled-components must attempt bundled root cleanup before falling back to in-place sync',
  );
  assert.ok(
    logLines.some((line) => line.includes('continuing with in-place bundle sync after cleanup fallback')),
    'sync-bundled-components must log when it falls back to in-place bundle sync after a Windows cleanup lock',
  );
}

{
  const tempRoot = mkdtempSync(path.join(os.tmpdir(), 'claw-sync-source-registry-'));
  const foundationDir = path.join(tempRoot, 'foundation', 'components');
  mkdirSync(foundationDir, { recursive: true });
  writeFileSync(
    path.join(foundationDir, 'component-registry.json'),
    `${JSON.stringify(
      {
        version: 1,
        components: [
          {
            id: 'local-proxy',
            bundledVersion: '1.0.0',
          },
        ],
      },
      null,
      2,
    )}\n`,
    'utf8',
  );

  const sourceRegistry = syncModule.syncSourceFoundationComponentRegistrySync({
    foundationDir,
  });
  const sourceRegistryFile = JSON.parse(
    readFileSync(path.join(foundationDir, 'component-registry.json'), 'utf8'),
  );

  assert.deepEqual(
    sourceRegistry,
    sourceRegistryFile,
    'sync-bundled-components must read the source desktop component registry as-is when it only contains generic support components',
  );

  rmSync(tempRoot, { recursive: true, force: true });
}

{
  const tempRoot = mkdtempSync(path.join(os.tmpdir(), 'claw-sync-source-registry-kernel-'));
  const foundationDir = path.join(tempRoot, 'foundation', 'components');
  mkdirSync(foundationDir, { recursive: true });
  writeFileSync(
    path.join(foundationDir, 'component-registry.json'),
    `${JSON.stringify(
      {
        version: 1,
        components: [
          {
            id: 'openclaw',
            bundledVersion: expectedOpenClawVersion,
          },
        ],
      },
      null,
      2,
    )}\n`,
    'utf8',
  );

  assert.throws(
    () => syncModule.syncSourceFoundationComponentRegistrySync({
      foundationDir,
    }),
    /must not contain kernel entries: openclaw/u,
    'sync-bundled-components must reject source desktop component registries that leak kernel ids into the generic support-component catalog',
  );

  rmSync(tempRoot, { recursive: true, force: true });
}

{
  const tempRoot = mkdtempSync(path.join(os.tmpdir(), 'claw-sync-openclaw-'));
  const packageRoot = path.join(tempRoot, 'openclaw');
  mkdirSync(path.join(packageRoot, 'dist'), { recursive: true });
  writeFileSync(
    path.join(packageRoot, 'package.json'),
    `${JSON.stringify({ name: 'openclaw', version: expectedOpenClawVersion }, null, 2)}\n`,
    'utf8',
  );
  writeFileSync(
    path.join(packageRoot, 'dist', 'build-info.json'),
    `${JSON.stringify(
      {
        version: staleOpenClawVersion,
        commit: '685f17460d69966be32f5409055c51a82bc0ad7e',
      },
      null,
      2,
    )}\n`,
    'utf8',
  );
  writeFileSync(
    path.join(packageRoot, 'dist', 'cli-startup-metadata.json'),
    `${JSON.stringify(
      {
        rootHelpText: `\n馃 OpenClaw ${staleOpenClawVersion} (685f174)\n`,
      },
      null,
      2,
    )}\n`,
    'utf8',
  );

  const inspection = syncModule.inspectOpenClawPackageMetadata({
    packageRoot,
    expectedVersion: expectedOpenClawVersion,
    expectedCommit: '213a704b71f4996dc82a583288ee53785215f627',
  });

  assert.equal(
    inspection.fresh,
    false,
    'sync-bundled-components must detect stale OpenClaw dist metadata before dev staging',
  );
  assert.deepEqual(
    inspection.issues,
    [
      'build-info-version-mismatch',
      'build-info-commit-mismatch',
      'cli-startup-version-mismatch',
      'cli-startup-commit-mismatch',
    ],
    'sync-bundled-components must flag stale build-info and CLI startup metadata drift',
  );

  rmSync(tempRoot, { recursive: true, force: true });
}

{
  const tempRoot = mkdtempSync(path.join(os.tmpdir(), 'claw-sync-prepared-runtime-'));
  const packageInstallRoot = path.join(tempRoot, 'prepared-runtime');
  const packageRoot = path.join(packageInstallRoot, 'node_modules', 'openclaw');
  mkdirSync(path.join(packageRoot, 'dist', 'extensions', 'tlon'), { recursive: true });
  writeFileSync(
    path.join(packageRoot, 'package.json'),
    `${JSON.stringify({ name: 'openclaw', version: expectedOpenClawVersion }, null, 2)}\n`,
    'utf8',
  );
  writeFileSync(
    path.join(packageRoot, 'dist', 'build-info.json'),
    `${JSON.stringify(
      {
        version: expectedOpenClawVersion,
        commit: '213a704b71f4996dc82a583288ee53785215f627',
      },
      null,
      2,
    )}\n`,
    'utf8',
  );
  writeFileSync(
    path.join(packageRoot, 'dist', 'cli-startup-metadata.json'),
    `${JSON.stringify(
      {
        rootHelpText: `\nOpenClaw ${expectedOpenClawVersion} (213a704)\n`,
      },
      null,
      2,
    )}\n`,
    'utf8',
  );
  writeFileSync(
    path.join(packageRoot, 'dist', 'extensions', 'tlon', 'package.json'),
    `${JSON.stringify(
      {
        name: '@openclaw/tlon',
        version: expectedOpenClawVersion,
        dependencies: {
          '@aws-sdk/client-s3': '3.1020.0',
        },
      },
      null,
      2,
    )}\n`,
    'utf8',
  );

  const inspection = await syncModule.inspectPreparedOpenClawPackageRuntime({
    packageRoot,
    packageInstallRoot,
    expectedVersion: expectedOpenClawVersion,
    expectedCommit: '213a704b71f4996dc82a583288ee53785215f627',
    runtimeSupplementalPackages: [],
  });

  assert.equal(
    inspection.fresh,
    false,
    'sync-bundled-components must reject prepared OpenClaw cache layouts that are missing bundled plugin runtime dependencies',
  );
  assert.ok(
    inspection.issues.some((issue) => issue.includes('bundled-plugin-runtime-dependency @aws-sdk/client-s3')),
    `Expected prepared cache inspection to report the missing tlon runtime dependency, received ${inspection.issues.join(', ')}`,
  );

  rmSync(tempRoot, { recursive: true, force: true });
}

{
  const tempRoot = mkdtempSync(path.join(os.tmpdir(), 'claw-sync-runtime-readiness-'));
  const packageRoot = path.join(tempRoot, 'app');
  const modulesRoot = path.join(packageRoot, 'node_modules');
  mkdirSync(path.join(packageRoot, 'dist'), { recursive: true });
  mkdirSync(path.join(modulesRoot, 'openclaw'), { recursive: true });
  writeFileSync(
    path.join(packageRoot, 'package.json'),
    `${JSON.stringify(
      {
        name: 'openclaw',
        version: expectedOpenClawVersion,
        dependencies: {
          koffi: '2.15.2',
        },
        pnpm: {
          onlyBuiltDependencies: ['koffi'],
        },
      },
      null,
      2,
    )}\n`,
    'utf8',
  );
  writeFileSync(
    path.join(packageRoot, 'openclaw.mjs'),
    'export const openclaw = true;\n',
    'utf8',
  );

  await assert.rejects(
    () =>
      syncModule.validateStagedOpenClawPackage({
        packageRoot,
        expectedVersion: expectedOpenClawVersion,
        runtimeSupplementalPackages: [],
      }),
    /koffi/,
    'sync-bundled-components must reject staged OpenClaw bundles whose runtime-only dependencies cannot be loaded',
  );

  rmSync(tempRoot, { recursive: true, force: true });
}

{
  const tempRoot = mkdtempSync(path.join(os.tmpdir(), 'claw-sync-locked-copy-'));
  const sourcePath = path.join(tempRoot, 'source.txt');
  const targetPath = path.join(tempRoot, 'target.txt');
  writeFileSync(sourcePath, 'same-openclaw-payload\n', 'utf8');
  writeFileSync(targetPath, 'same-openclaw-payload\n', 'utf8');

  const logLines = [];
  const result = syncModule.copyBundledFileSync(sourcePath, targetPath, {
    logger: (line) => {
      logLines.push(line);
    },
    copyFileImpl: () => {
      const error = new Error('avatar-placeholder.svg is locked');
      error.code = 'EPERM';
      throw error;
    },
  });

  assert.deepEqual(
    result,
    { reusedLockedTarget: true },
    'sync-bundled-components must reuse an equivalent locked target file instead of aborting the staged bundle sync',
  );
  assert.ok(
    logLines.some((line) => line.includes('reusing existing locked bundled file')),
    'sync-bundled-components must log when it reuses an equivalent locked file during bundle staging',
  );

  rmSync(tempRoot, { recursive: true, force: true });
}

{
  const tempRoot = mkdtempSync(path.join(os.tmpdir(), 'claw-sync-locked-json-'));
  const targetPath = path.join(tempRoot, 'component-registry.json');
  writeFileSync(
    targetPath,
    `${JSON.stringify({ version: 1, components: [{ id: 'openclaw', bundledVersion: `${expectedOpenClawVersion}+213a704b71f4` }] }, null, 2)}\n`,
    'utf8',
  );

  const logLines = [];
  const result = syncModule.writeJsonWithWindowsLockFallback(
    targetPath,
    { version: 1, components: [{ id: 'openclaw', bundledVersion: `${expectedOpenClawVersion}+213a704b71f4` }] },
    {
      logger: (line) => {
        logLines.push(line);
      },
      writeFileImpl: () => {
        const error = new Error('component-registry.json is locked');
        error.code = 'EPERM';
        throw error;
      },
      allowEquivalentExistingOnLock: true,
    },
  );

  assert.deepEqual(
    result,
    { reusedLockedTarget: true },
    'sync-bundled-components must tolerate a locked JSON target when it already matches the desired bundled metadata',
  );
  assert.ok(
    logLines.some((line) => line.includes('reusing existing locked bundled json')),
    'sync-bundled-components must log when it reuses equivalent locked bundled metadata',
  );

  assert.throws(
    () =>
      syncModule.writeJsonWithWindowsLockFallback(
        targetPath,
        {
          version: 1,
          components: [{ id: 'openclaw', bundledVersion: `${expectedOpenClawVersion}+newcommit` }],
        },
        {
          writeFileImpl: () => {
            const error = new Error('component-registry.json is locked');
            error.code = 'EPERM';
            throw error;
          },
          allowEquivalentExistingOnLock: true,
        },
      ),
    /component-registry\.json is locked/,
    'sync-bundled-components must still fail when a locked bundled metadata file is stale',
  );

  rmSync(tempRoot, { recursive: true, force: true });
}

assert.match(
  syncModuleSource,
  /refreshing openclaw dist for dev staging/,
  'sync-bundled-components must rebuild stale OpenClaw dist before dev staging',
);

console.log('ok - sync-bundled-components emits short Windows Tauri bundle bridge roots');
