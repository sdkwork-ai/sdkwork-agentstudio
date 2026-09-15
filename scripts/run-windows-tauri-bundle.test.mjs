// WORKSPACE-PATH:allow-fixture - this file is a test fixture that simulates a foreign
// checkout root, so the sdkwork-<name> segment below is the value under assertion rather
// than a binding to a real sibling checkout. PORTABILITY_SPEC.md section 5.2 governs it.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const rootDir = path.resolve(import.meta.dirname, '..');
const bundleModulePath = path.join(rootDir, 'scripts', 'run-windows-tauri-bundle.mjs');
const bundleModuleSource = readFileSync(bundleModulePath, 'utf8');
const bundleModule = await import(pathToFileURL(bundleModulePath).href);
const syntheticWorkspaceRoot = 'D:\\workspace\\agent-studio';

assert.equal(
  typeof bundleModule.createWindowsNsisBridgeReplacements,
  'function',
  'run-windows-tauri-bundle must export createWindowsNsisBridgeReplacements',
);
assert.equal(
  typeof bundleModule.createWindowsNsisSourceReplacements,
  'function',
  'run-windows-tauri-bundle must export createWindowsNsisSourceReplacements',
);
assert.equal(
  typeof bundleModule.rewriteNsisSourcePaths,
  'function',
  'run-windows-tauri-bundle must export rewriteNsisSourcePaths',
);
assert.equal(
  typeof bundleModule.prepareWindowsNsisRetryScript,
  'function',
  'run-windows-tauri-bundle must export prepareWindowsNsisRetryScript',
);
assert.equal(
  typeof bundleModule.resolveWindowsNsisSourceReplacementPlans,
  'function',
  'run-windows-tauri-bundle must export resolveWindowsNsisSourceReplacementPlans',
);
assert.equal(
  typeof bundleModule.ensureWindowsNsisRetrySourceAliases,
  'function',
  'run-windows-tauri-bundle must export ensureWindowsNsisRetrySourceAliases',
);
assert.equal(
  typeof bundleModule.buildWindowsTauriBundleCommand,
  'function',
  'run-windows-tauri-bundle must export buildWindowsTauriBundleCommand',
);
assert.equal(
  typeof bundleModule.buildWindowsTauriBundlePreflightCommand,
  'function',
  'run-windows-tauri-bundle must export buildWindowsTauriBundlePreflightCommand',
);
assert.equal(
  typeof bundleModule.buildWindowsBeforeBuildCommand,
  'function',
  'run-windows-tauri-bundle must export buildWindowsBeforeBuildCommand',
);
assert.equal(
  typeof bundleModule.ensureWindowsTauriBuildRuntimeOverlay,
  'function',
  'run-windows-tauri-bundle must export ensureWindowsTauriBuildRuntimeOverlay',
);
assert.equal(
  typeof bundleModule.ensureWindowsBundleOpenClawAliasRoot,
  'function',
  'run-windows-tauri-bundle must export ensureWindowsBundleOpenClawAliasRoot',
);
assert.equal(
  typeof bundleModule.parseArgs,
  'function',
  'run-windows-tauri-bundle must export parseArgs',
);
assert.throws(
  () => bundleModule.parseArgs(['--profile']),
  /Missing value for --profile/,
  'run-windows-tauri-bundle must reject a missing --profile value',
);
assert.throws(
  () => bundleModule.parseArgs(['--config']),
  /Missing value for --config/,
  'run-windows-tauri-bundle must reject a missing --config value',
);
assert.throws(
  () => bundleModule.parseArgs(['--target']),
  /Missing value for --target/,
  'run-windows-tauri-bundle must reject a missing --target value',
);
assert.throws(
  () => bundleModule.parseArgs(['--bundles']),
  /Missing value for --bundles/,
  'run-windows-tauri-bundle must reject a missing --bundles value',
);
const previousSdkworkDesktopTarget = process.env.SDKWORK_DESKTOP_TARGET;
const previousSdkworkDesktopTargetPlatform = process.env.SDKWORK_DESKTOP_TARGET_PLATFORM;
const previousSdkworkDesktopTargetArch = process.env.SDKWORK_DESKTOP_TARGET_ARCH;
try {
  process.env.SDKWORK_DESKTOP_TARGET = 'x86_64-pc-windows-msvc';
  process.env.SDKWORK_DESKTOP_TARGET_PLATFORM = 'windows';
  process.env.SDKWORK_DESKTOP_TARGET_ARCH = 'x64';
  assert.equal(
    bundleModule.parseArgs([]).targetTriple,
    '',
    'run-windows-tauri-bundle must treat --target as an explicit CLI-only option so native Windows builds do not inherit SDKWORK_DESKTOP_TARGET back into tauri build',
  );
} finally {
  if (previousSdkworkDesktopTarget === undefined) {
    delete process.env.SDKWORK_DESKTOP_TARGET;
  } else {
    process.env.SDKWORK_DESKTOP_TARGET = previousSdkworkDesktopTarget;
  }
  if (previousSdkworkDesktopTargetPlatform === undefined) {
    delete process.env.SDKWORK_DESKTOP_TARGET_PLATFORM;
  } else {
    process.env.SDKWORK_DESKTOP_TARGET_PLATFORM = previousSdkworkDesktopTargetPlatform;
  }
  if (previousSdkworkDesktopTargetArch === undefined) {
    delete process.env.SDKWORK_DESKTOP_TARGET_ARCH;
  } else {
    process.env.SDKWORK_DESKTOP_TARGET_ARCH = previousSdkworkDesktopTargetArch;
  }
}
assert.match(
  bundleModuleSource,
  /if \(path\.resolve\(process\.argv\[1\] \?\? ''\) === __filename\) \{\s*try \{\s*await main\(\);\s*\} catch \(error\) \{\s*console\.error\(error instanceof Error \? error\.message : String\(error\)\);\s*process\.exit\(1\);\s*\}\s*\}/s,
  'run-windows-tauri-bundle must wrap the CLI entrypoint with a top-level error handler',
);
assert.match(
  bundleModuleSource,
  /const preflightPlan = buildWindowsTauriBundlePreflightCommand\(/,
  'run-windows-tauri-bundle must derive an OpenClaw preflight plan before tauri build',
);
assert.match(
  bundleModuleSource,
  /runCommand\(\s*preflightPlan\.command,\s*preflightPlan\.args,/s,
  'run-windows-tauri-bundle must execute the OpenClaw verifier before tauri build',
);
assert.match(
  bundleModuleSource,
  /await ensureWindowsBundleOpenClawAliasRoot\([\s\S]*const buildPlan = buildWindowsTauriBundleCommand\(/s,
  'run-windows-tauri-bundle must refresh the Windows OpenClaw alias root before invoking tauri build',
);
assert.match(
  bundleModuleSource,
  /windowsHide:\s*true/u,
  'run-windows-tauri-bundle must hide delegated Windows child processes so installer retry automation does not flash terminal windows',
);

const windowsBundleCommand = bundleModule.buildWindowsTauriBundleCommand({
  platform: 'win32',
  env: {},
  execPath: process.execPath,
  resolveTauriCliEntrypoint: () => 'D:\\workspace\\agent-studio\\node_modules\\@tauri-apps\\cli\\tauri.js',
});
assert.equal(
  windowsBundleCommand.command,
  process.execPath,
  'run-windows-tauri-bundle must reuse the shared tauri CLI runner entrypoint when it shells out to tauri',
);
assert.deepEqual(
  windowsBundleCommand.args.slice(0, 1),
  ['D:\\workspace\\agent-studio\\node_modules\\@tauri-apps\\cli\\tauri.js'],
  'run-windows-tauri-bundle must prefix tauri invocations with the resolved @tauri-apps/cli entrypoint on Windows',
);
assert.equal(
  windowsBundleCommand.shell,
  false,
  'run-windows-tauri-bundle must keep direct Windows tauri execution out of shell mode',
);
assert.equal(
  windowsBundleCommand.env.CARGO_PROFILE_RELEASE_STRIP,
  'none',
  'run-windows-tauri-bundle must disable Cargo release debug-info stripping on Windows because Windows release builds can trigger const-eval failures in the full desktop dependency graph',
);
assert.equal(
  windowsBundleCommand.env.CARGO_PROFILE_RELEASE_OPT_LEVEL,
  '2',
  'run-windows-tauri-bundle must lower Windows Cargo release opt-level to 2 because Windows release builds can trigger const-eval failures in the full desktop dependency graph at the default opt-level',
);
assert.deepEqual(
  windowsBundleCommand.args.slice(1, 9),
  [
    'build',
    '--config',
    'src-tauri/tauri.windows.conf.json',
    '--config',
    'src-tauri/generated/tauri.bundle.overlay.json',
    '--config',
    'src-tauri/generated/tauri.windows.runtime.overlay.json',
    '--bundles',
  ],
  'run-windows-tauri-bundle must invoke tauri from the desktop package with the explicit Windows config and generated bundle overlay config',
);
assert.equal(
  windowsBundleCommand.args[9],
  'nsis',
  'run-windows-tauri-bundle must request nsis-only Windows installers to avoid flaky WiX/MSI packaging on CI runners',
);
assert.equal(
  windowsBundleCommand.cwd,
  path.join(rootDir, 'packages', 'sdkwork-agentstudio-pc-desktop'),
  'run-windows-tauri-bundle must execute the tauri CLI from the desktop package directory',
);
const configuredWindowsBundleCommand = bundleModule.buildWindowsTauriBundleCommand({
  bundleTargets: ['nsis', 'msi'],
  platform: 'win32',
  env: {},
  execPath: process.execPath,
  resolveTauriCliEntrypoint: () => 'D:\\workspace\\agent-studio\\node_modules\\@tauri-apps\\cli\\tauri.js',
});
assert.deepEqual(
  configuredWindowsBundleCommand.args.slice(-2),
  ['--bundles', 'nsis,msi'],
  'run-windows-tauri-bundle must allow release profiles to override the Windows bundle target list when a different application requires it',
);
const nativeWindowsEnvTargetBundleCommand = bundleModule.buildWindowsTauriBundleCommand({
  platform: 'win32',
  env: {
    SDKWORK_DESKTOP_TARGET: 'x86_64-pc-windows-msvc',
    SDKWORK_DESKTOP_TARGET_PLATFORM: 'windows',
    SDKWORK_DESKTOP_TARGET_ARCH: 'x64',
  },
  execPath: process.execPath,
  resolveTauriCliEntrypoint: () => 'D:\\workspace\\agent-studio\\node_modules\\@tauri-apps\\cli\\tauri.js',
});
assert.equal(
  nativeWindowsEnvTargetBundleCommand.args.includes('--target'),
  false,
  'run-windows-tauri-bundle must not reintroduce an explicit native Windows target from inherited release env after the outer runner omitted it',
);
const arm64WindowsBundleCommand = bundleModule.buildWindowsTauriBundleCommand({
  targetTriple: 'aarch64-pc-windows-msvc',
  platform: 'win32',
  env: {},
  execPath: process.execPath,
  resolveTauriCliEntrypoint: () => 'D:\\workspace\\agent-studio\\node_modules\\@tauri-apps\\cli\\tauri.js',
});
assert.deepEqual(
  arm64WindowsBundleCommand.args.slice(-2),
  ['--target', 'aarch64-pc-windows-msvc'],
  'run-windows-tauri-bundle must still pass explicit cross-architecture Windows targets',
);
const windowsBundlePreflight = bundleModule.buildWindowsTauriBundlePreflightCommand({
  targetTriple: 'aarch64-pc-windows-msvc',
});
assert.equal(
  windowsBundlePreflight.command,
  process.execPath,
  'run-windows-tauri-bundle must run the OpenClaw verifier through the current Node executable',
);
assert.deepEqual(
  windowsBundlePreflight.args,
  ['scripts/verify-desktop-openclaw-release-assets.mjs'],
  'run-windows-tauri-bundle must invoke the dedicated OpenClaw release asset verifier before tauri build',
);
assert.equal(windowsBundlePreflight.env.SDKWORK_DESKTOP_TARGET, 'aarch64-pc-windows-msvc');
assert.equal(windowsBundlePreflight.env.SDKWORK_DESKTOP_TARGET_PLATFORM, 'windows');
assert.equal(windowsBundlePreflight.env.SDKWORK_DESKTOP_TARGET_ARCH, 'arm64');

const ensuredAliasCalls = [];
await bundleModule.ensureWindowsBundleOpenClawAliasRoot({
  workspaceRootDir: syntheticWorkspaceRoot,
  platform: 'win32',
  resolvePackagedOpenClawResourceDirImpl(workspaceRootDir, platform) {
    ensuredAliasCalls.push(['resolve', workspaceRootDir, platform]);
    return 'D:\\workspace\\agent-studio\\packages\\sdkwork-agentstudio-pc-desktop\\src-tauri\\generated\\release\\openclaw-resource';
  },
  syncWindowsPackagedOpenClawAliasRootImpl(options) {
    ensuredAliasCalls.push([
      'sync',
      options.workspaceRootDir,
      options.packagedResourceDir,
      options.platform,
    ]);
    return Promise.resolve('ok');
  },
});
assert.deepEqual(
  ensuredAliasCalls,
  [
    ['resolve', syntheticWorkspaceRoot, 'windows'],
    [
      'sync',
      syntheticWorkspaceRoot,
      'D:\\workspace\\agent-studio\\packages\\sdkwork-agentstudio-pc-desktop\\src-tauri\\generated\\release\\openclaw-resource',
      'win32',
    ],
  ],
  'run-windows-tauri-bundle must resolve the canonical packaged OpenClaw release root and refresh the Windows alias root before build',
);

const replacements = bundleModule.createWindowsNsisSourceReplacements(syntheticWorkspaceRoot);

assert.equal(replacements.length, 6);
assert.deepEqual(replacements.slice(0, 3), [
  {
    from:
      'D:\\workspace\\agent-studio\\packages\\sdkwork-agentstudio-pc-desktop\\src-tauri\\generated\\bundled\\',
    to: 'D:\\.sdkwork-bc\\agent-studio\\bundled\\',
  },
  {
    from:
      'D:\\workspace\\agent-studio\\packages\\sdkwork-agentstudio-pc-desktop\\src-tauri\\generated\\br\\b\\',
    to: 'D:\\.sdkwork-bc\\agent-studio\\bundled\\',
  },
  {
    from:
      'D:\\workspace\\agent-studio\\packages\\sdkwork-agentstudio-pc-desktop\\src-tauri\\resources\\openclaw\\',
    to: 'D:\\.sdkwork-bc\\agent-studio\\openclaw\\',
  },
]);
assert.deepEqual(replacements.slice(3), [
  {
    from:
      'D:\\workspace\\agent-studio\\packages\\sdkwork-agentstudio-pc-desktop\\dist\\',
    to: 'D:\\.sdkwork-bc\\agent-studio\\web-dist\\',
  },
  {
    from:
      'D:\\workspace\\agent-studio\\packages\\sdkwork-agentstudio-pc-desktop\\src-tauri\\generated\\br\\w\\',
    to: 'D:\\.sdkwork-bc\\agent-studio\\web-dist\\',
  },
  {
    from:
      'D:\\workspace\\agent-studio\\packages\\sdkwork-agentstudio-pc-desktop\\src-tauri\\generated\\br\\o\\',
    to: 'D:\\.sdkwork-bc\\agent-studio\\openclaw\\',
  },
]);

const mirrorResolvedReplacements = bundleModule.createWindowsNsisSourceReplacements(
  syntheticWorkspaceRoot,
  {
    resolvePathTargetImpl(sourcePath) {
      if (sourcePath.endsWith('generated\\bundled')) {
        return 'D:\\.sdkwork-bc\\agent-studio\\bundled-mirrors\\bundled-20260404-abcdef';
      }
      if (sourcePath.endsWith('generated\\br\\b')) {
        return 'D:\\.sdkwork-bc\\agent-studio\\bundled-mirrors\\bundled-20260404-abcdef';
      }
      if (sourcePath.endsWith('generated\\br\\o')) {
        return 'D:\\workspace\\agent-studio\\packages\\sdkwork-agentstudio-pc-desktop\\src-tauri\\generated\\release\\openclaw-resource';
      }
      return null;
    },
  },
);

assert.equal(
  mirrorResolvedReplacements[0].to,
  'D:\\.sdkwork-bc\\agent-studio\\bundled-mirrors\\bundled-20260404-abcdef\\',
  'run-windows-tauri-bundle must prefer the resolved current bundled mirror target when rewriting generated/bundled NSIS source paths',
);
assert.equal(
  mirrorResolvedReplacements[1].to,
  'D:\\.sdkwork-bc\\agent-studio\\bundled-mirrors\\bundled-20260404-abcdef\\',
  'run-windows-tauri-bundle must rewrite bundled bridge NSIS paths to the same resolved current bundled mirror target',
);
assert.equal(
  mirrorResolvedReplacements[5].to,
  'D:\\.sdkwork-bc\\agent-studio\\openclaw\\',
  'run-windows-tauri-bundle must keep OpenClaw bridge rewrites on the stable short mirror root even when generated/br/o resolves to the canonical packaged release directory',
);

const overrideBaseReplacements = bundleModule.createWindowsNsisSourceReplacements(
  syntheticWorkspaceRoot,
  {
    env: {
      SDKWORK_WINDOWS_MIRROR_BASE_DIR: 'D:\\workspace\\agent-studio\\.cache\\short-mirrors',
    },
  },
);

assert.equal(
  overrideBaseReplacements[2].to,
  'D:\\workspace\\agent-studio\\.cache\\short-mirrors\\openclaw\\',
  'run-windows-tauri-bundle must honor the configured Windows mirror base directory when rewriting direct resources/openclaw NSIS source paths',
);
assert.equal(
  overrideBaseReplacements[3].to,
  'D:\\workspace\\agent-studio\\.cache\\short-mirrors\\web-dist\\',
  'run-windows-tauri-bundle must honor the configured Windows mirror base directory when rewriting direct dist NSIS source paths',
);

const longResolvedMirrorPlans = bundleModule.resolveWindowsNsisSourceReplacementPlans(
  syntheticWorkspaceRoot,
  {
    env: {
      SDKWORK_WINDOWS_MIRROR_BASE_DIR: 'D:\\workspace\\agent-studio\\.cache\\short-mirrors',
    },
    resolvePathTargetImpl(sourcePath) {
      if (sourcePath.endsWith('generated\\bundled') || sourcePath.endsWith('generated\\br\\b')) {
        return [
          'D:\\workspace\\agent-studio',
          '.cache',
          'short-mirrors',
          'bundled-mirrors',
          'this-path-is-still-far-too-long-for-makensis-to-open-safely-even-after-fallback',
          'segment-0001-this-path-is-still-too-long',
          'segment-0002-this-path-is-still-too-long',
          'segment-0003-this-path-is-still-too-long',
          'bundled-20260404-abcdef',
        ].join('\\');
      }
      return null;
    },
  },
);
assert.equal(
  longResolvedMirrorPlans[0].actualTargetRoot,
  [
    'D:\\workspace\\agent-studio',
    '.cache',
    'short-mirrors',
    'bundled-mirrors',
    'this-path-is-still-far-too-long-for-makensis-to-open-safely-even-after-fallback',
    'segment-0001-this-path-is-still-too-long',
    'segment-0002-this-path-is-still-too-long',
    'segment-0003-this-path-is-still-too-long',
    'bundled-20260404-abcdef',
  ].join('\\'),
  'run-windows-tauri-bundle must preserve the resolved current bundled mirror target as the physical source for NSIS retry planning',
);
assert.equal(
  longResolvedMirrorPlans[0].to,
  'D:\\.sdkwork-bc\\agent-studio\\bundled-mirrors\\bundled-20260404-abcdef\\',
  'run-windows-tauri-bundle must route long resolved bundled mirror targets through a shorter retry alias root before rerunning makensis',
);
assert.equal(
  longResolvedMirrorPlans[1].to,
  'D:\\.sdkwork-bc\\agent-studio\\bundled-mirrors\\bundled-20260404-abcdef\\',
  'run-windows-tauri-bundle must route the bundled bridge replacement through the same shorter retry alias root when the persisted bundled mirror root is still too long',
);

const projectedLongFileMirrorPlans = bundleModule.resolveWindowsNsisSourceReplacementPlans(
  syntheticWorkspaceRoot,
  {
    env: {
      SDKWORK_WINDOWS_MIRROR_BASE_DIR: 'D:\\workspace\\agent-studio\\.cache\\short-mirrors',
    },
    resolvePathTargetImpl(sourcePath) {
      if (sourcePath.endsWith('generated\\bundled') || sourcePath.endsWith('generated\\br\\b')) {
        return 'D:\\workspace\\agent-studio\\.cache\\short-mirrors\\bundled-mirrors\\bundled-20260404-abcdef';
      }
      return null;
    },
    resolveMaxNestedSourcePathLengthImpl(sourceRoot, actualTargetRoot) {
      if (
        sourceRoot.endsWith('generated\\bundled')
        || sourceRoot.endsWith('generated\\br\\b')
        || actualTargetRoot.endsWith('bundled-20260404-abcdef')
      ) {
        return 160;
      }
      return 0;
    },
  },
);
assert.equal(
  projectedLongFileMirrorPlans[0].to,
  'D:\\.sdkwork-bc\\agent-studio\\bundled-mirrors\\bundled-20260404-abcdef\\',
  'run-windows-tauri-bundle must switch to the shorter retry alias root when a resolved bundled mirror would still exceed the NSIS source-path limit after appending a deep nested file path',
);
assert.equal(
  projectedLongFileMirrorPlans[1].to,
  'D:\\.sdkwork-bc\\agent-studio\\bundled-mirrors\\bundled-20260404-abcdef\\',
  'run-windows-tauri-bundle must keep the bundled bridge replacement aligned with the shorter retry alias root when projected nested file paths still exceed the NSIS source-path limit',
);

const aliasOperations = [];
bundleModule.ensureWindowsNsisRetrySourceAliases({
  plans: longResolvedMirrorPlans,
  pathExistsImpl(targetPath) {
    return targetPath === [
      'D:\\workspace\\agent-studio',
      '.cache',
      'short-mirrors',
      'bundled-mirrors',
      'this-path-is-still-far-too-long-for-makensis-to-open-safely-even-after-fallback',
      'segment-0001-this-path-is-still-too-long',
      'segment-0002-this-path-is-still-too-long',
      'segment-0003-this-path-is-still-too-long',
      'bundled-20260404-abcdef',
    ].join('\\');
  },
  mkdirImpl(targetPath) {
    aliasOperations.push(['mkdir', targetPath]);
  },
  rmImpl(targetPath, options) {
    aliasOperations.push(['rm', targetPath, options]);
  },
  symlinkImpl(targetPath, aliasPath, type) {
    aliasOperations.push(['symlink', targetPath, aliasPath, type]);
  },
  resolvePathTargetImpl() {
    return null;
  },
});
assert.deepEqual(
  aliasOperations,
  [
    ['mkdir', 'D:\\.sdkwork-bc\\agent-studio\\bundled-mirrors'],
    [
      'symlink',
      [
        'D:\\workspace\\agent-studio',
        '.cache',
        'short-mirrors',
        'bundled-mirrors',
        'this-path-is-still-far-too-long-for-makensis-to-open-safely-even-after-fallback',
        'segment-0001-this-path-is-still-too-long',
        'segment-0002-this-path-is-still-too-long',
        'segment-0003-this-path-is-still-too-long',
        'bundled-20260404-abcdef',
      ].join('\\'),
      'D:\\.sdkwork-bc\\agent-studio\\bundled-mirrors\\bundled-20260404-abcdef',
      'junction',
    ],
  ],
  'run-windows-tauri-bundle must materialize shorter bundled mirror retry aliases before rerunning makensis from a persisted fallback mirror root',
);

const sampleInstaller = [
  'File /a "/oname=generated\\\\bundled\\\\bundle-manifest.json" "D:\\workspace\\agent-studio\\packages\\sdkwork-agentstudio-pc-desktop\\src-tauri\\generated\\bundled\\foundation\\components\\bundle-manifest.json"',
  'File /a "/oname=generated\\\\bundled\\\\bundle-manifest.json" "D:\\workspace\\agent-studio\\packages\\sdkwork-agentstudio-pc-desktop\\src-tauri\\generated\\br\\b\\foundation\\components\\bundle-manifest.json"',
  'File /a "/oname=resources\\\\openclaw\\\\manifest.json" "D:\\workspace\\agent-studio\\packages\\sdkwork-agentstudio-pc-desktop\\src-tauri\\resources\\openclaw\\manifest.json"',
  'File /a "/oname=dist\\\\index.html" "D:\\workspace\\agent-studio\\packages\\sdkwork-agentstudio-pc-desktop\\dist\\index.html"',
  'File /a "/oname=dist\\\\index.html" "D:\\workspace\\agent-studio\\packages\\sdkwork-agentstudio-pc-desktop\\src-tauri\\generated\\br\\w\\index.html"',
  'File /a "/oname=resources\\\\openclaw\\\\manifest.json" "D:\\workspace\\agent-studio\\packages\\sdkwork-agentstudio-pc-desktop\\src-tauri\\generated\\br\\o\\manifest.json"',
].join('\n');

const rewrittenInstaller = bundleModule.rewriteNsisSourcePaths(sampleInstaller, replacements);
const preparedInstaller = bundleModule.prepareWindowsNsisRetryScript({
  installerContent: `!define OUTFILE "nsis-output.exe"\n${sampleInstaller}`,
  workspaceRootDir: syntheticWorkspaceRoot,
  outputFilePath: 'D:\\release\\Agent Studio_0.1.0_x64-setup.exe',
});

assert.match(rewrittenInstaller, /D:\\\.sdkwork-bc\\agent-studio\\bundled\\/);
assert.match(rewrittenInstaller, /D:\\\.sdkwork-bc\\agent-studio\\web-dist\\/);
assert.match(rewrittenInstaller, /D:\\\.sdkwork-bc\\agent-studio\\openclaw\\/);
assert.doesNotMatch(rewrittenInstaller, /generated\\bundled\\\\/);
assert.doesNotMatch(rewrittenInstaller, /generated\\br\\w\\\\/);
assert.doesNotMatch(rewrittenInstaller, /generated\\br\\[bo]\\\\/);
assert.doesNotMatch(rewrittenInstaller, /resources\\openclaw\\\\/);
assert.doesNotMatch(rewrittenInstaller, /packages\\sdkwork-agentstudio-pc-desktop\\dist\\\\/);
assert.match(
  preparedInstaller,
  /!define OUTFILE "D:\\release\\Agent Studio_0\.1\.0_x64-setup\.exe"/,
);
assert.match(preparedInstaller, /D:\\\.sdkwork-bc\\agent-studio\\bundled\\/);
assert.match(preparedInstaller, /D:\\\.sdkwork-bc\\agent-studio\\web-dist\\/);
assert.doesNotMatch(preparedInstaller, /!define OUTFILE "nsis-output\.exe"/);

console.log('ok - windows tauri bundle fallback rewrites long NSIS sources to short absolute sources');
