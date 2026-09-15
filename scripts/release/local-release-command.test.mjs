// WORKSPACE-PATH:allow-fixture: fixtures name a foreign checkout root, drive, or home directory to exercise path handling, so the literal is the value under assertion rather than a binding this build resolves
import assert from 'node:assert/strict';
import path from 'node:path';
import test from 'node:test';
import { pathToFileURL } from 'node:url';

const rootDir = path.resolve(import.meta.dirname, '..', '..');

test('local release helper resolves usable defaults for root release commands', async () => {
  const helperPath = path.join(rootDir, 'scripts', 'release', 'local-release-command.mjs');
  const helper = await import(pathToFileURL(helperPath).href);

  assert.equal(typeof helper.resolveLocalReleaseContext, 'function');
  assert.equal(typeof helper.parseArgs, 'function');

  const planContext = helper.resolveLocalReleaseContext({
    mode: 'plan',
    env: {},
    platform: 'win32',
    arch: 'x64',
    resolveGitRepositoryFn() {
      return 'sdkwork-ai/agent-studio';
    },
  });

  assert.equal(planContext.releaseTag, 'release-local');
  assert.equal(planContext.profileId, 'agent-studio');
  assert.equal(planContext.repository, 'sdkwork-ai/agent-studio');

  const serverContext = helper.resolveLocalReleaseContext({
    mode: 'release:package:server',
    env: {},
    platform: 'win32',
    arch: 'x64',
  });

  assert.equal(serverContext.platform, 'windows');
  assert.equal(serverContext.arch, 'x64');
  assert.equal(serverContext.target, 'x86_64-pc-windows-msvc');
  assert.equal(serverContext.outputDir.replaceAll('\\', '/'), path.join(rootDir, 'artifacts', 'release').replaceAll('\\', '/'));

  const deploymentContext = helper.resolveLocalReleaseContext({
    mode: 'package:container',
    env: {},
    platform: 'win32',
    arch: 'x64',
  });

  assert.equal(deploymentContext.platform, 'linux');
  assert.equal(deploymentContext.arch, 'x64');
  assert.equal(deploymentContext.target, 'x86_64-unknown-linux-gnu');
  assert.equal(deploymentContext.accelerator, 'cpu');
  assert.equal(deploymentContext.imageTag, 'release-local');

  const parsedContainerOptions = helper.parseArgs(['package', 'container']);
  const parsedContainerContext = helper.resolveLocalReleaseContext({
    mode: parsedContainerOptions.mode,
    env: {},
    platform: parsedContainerOptions.platform,
    arch: parsedContainerOptions.arch,
    cliOverrides: parsedContainerOptions,
  });

  assert.equal(parsedContainerContext.arch, 'x64');
  assert.equal(parsedContainerContext.target, 'x86_64-unknown-linux-gnu');

  const parsedPartialFinalizeOptions = helper.parseArgs([
    'finalize',
    '--allow-partial-release',
  ]);
  assert.equal(parsedPartialFinalizeOptions.mode, 'finalize');
  assert.equal(parsedPartialFinalizeOptions.allowPartialRelease, true);

  const parsedReadinessOptions = helper.parseArgs(['assert-ready']);
  assert.equal(parsedReadinessOptions.mode, 'assert-ready');

  const parsedStatusOptions = helper.parseArgs(['status']);
  assert.equal(parsedStatusOptions.mode, 'status');

  const parsedSmokeOptions = helper.parseArgs(['smoke', 'desktop']);
  const parsedSmokeContext = helper.resolveLocalReleaseContext({
    mode: parsedSmokeOptions.mode,
    env: {},
    platform: 'darwin',
    arch: 'arm64',
    cliOverrides: parsedSmokeOptions,
  });

  assert.equal(parsedSmokeContext.mode, 'smoke:desktop');
  assert.equal(parsedSmokeContext.platform, 'macos');
  assert.equal(parsedSmokeContext.arch, 'arm64');
  assert.equal(parsedSmokeContext.target, 'aarch64-apple-darwin');

  const parsedDesktopStartupSmokeOptions = helper.parseArgs([
    'smoke',
    'desktop',
    '--startup-evidence-path',
    'D:/synthetic/desktop-startup-evidence.json',
  ]);

  assert.equal(
    parsedDesktopStartupSmokeOptions.startupEvidencePath.replaceAll('\\', '/'),
    'D:/synthetic/desktop-startup-evidence.json',
  );

  const parsedServerSmokeOptions = helper.parseArgs(['smoke', 'server']);
  const parsedServerSmokeContext = helper.resolveLocalReleaseContext({
    mode: parsedServerSmokeOptions.mode,
    env: {},
    platform: 'linux',
    arch: 'x64',
    cliOverrides: parsedServerSmokeOptions,
  });

  assert.equal(parsedServerSmokeContext.mode, 'smoke:server');
  assert.equal(parsedServerSmokeContext.platform, 'linux');
  assert.equal(parsedServerSmokeContext.arch, 'x64');
  assert.equal(parsedServerSmokeContext.target, 'x86_64-unknown-linux-gnu');

  const parsedWebSmokeOptions = helper.parseArgs(['smoke', 'web']);
  const parsedWebSmokeContext = helper.resolveLocalReleaseContext({
    mode: parsedWebSmokeOptions.mode,
    env: {},
    platform: 'linux',
    arch: 'x64',
    cliOverrides: parsedWebSmokeOptions,
  });

  assert.equal(parsedWebSmokeContext.mode, 'smoke:web');
  assert.equal(parsedWebSmokeContext.platform, 'web');
  assert.equal(parsedWebSmokeContext.arch, 'any');
  assert.equal(parsedWebSmokeContext.target, '');

  const parsedContainerSmokeOptions = helper.parseArgs(['smoke', 'container']);
  const parsedContainerSmokeContext = helper.resolveLocalReleaseContext({
    mode: parsedContainerSmokeOptions.mode,
    env: {},
    platform: 'win32',
    arch: 'x64',
    cliOverrides: parsedContainerSmokeOptions,
  });

  assert.equal(parsedContainerSmokeContext.mode, 'smoke:container');
  assert.equal(parsedContainerSmokeContext.platform, 'linux');
  assert.equal(parsedContainerSmokeContext.arch, 'x64');
  assert.equal(parsedContainerSmokeContext.target, 'x86_64-unknown-linux-gnu');
  assert.equal(parsedContainerSmokeContext.accelerator, 'cpu');

  const parsedKubernetesSmokeOptions = helper.parseArgs(['smoke', 'kubernetes']);
  const parsedKubernetesSmokeContext = helper.resolveLocalReleaseContext({
    mode: parsedKubernetesSmokeOptions.mode,
    env: {},
    platform: 'darwin',
    arch: 'arm64',
    cliOverrides: parsedKubernetesSmokeOptions,
  });

  assert.equal(parsedKubernetesSmokeContext.mode, 'smoke:kubernetes');
  assert.equal(parsedKubernetesSmokeContext.platform, 'linux');
  assert.equal(parsedKubernetesSmokeContext.arch, 'arm64');
  assert.equal(parsedKubernetesSmokeContext.target, 'aarch64-unknown-linux-gnu');
  assert.equal(parsedKubernetesSmokeContext.accelerator, 'cpu');

  const parsedDesktopPackageOptions = helper.parseArgs([
    'package',
    'desktop',
    '--package-profile',
    'dual-kernel',
  ]);
  assert.equal(parsedDesktopPackageOptions.packageProfileId, 'dual-kernel');

  const envPackageProfileContext = helper.resolveLocalReleaseContext({
    mode: 'package:desktop',
    env: {
      SDKWORK_RELEASE_PACKAGE_PROFILE: 'hermes-only',
    },
    platform: 'win32',
    arch: 'x64',
    resolveGitRepositoryFn() {
      return 'sdkwork-ai/agent-studio';
    },
  });

  assert.equal(envPackageProfileContext.packageProfileId, 'hermes-only');

  const cliPackageProfileContext = helper.resolveLocalReleaseContext({
    mode: 'package:desktop',
    env: {
      SDKWORK_RELEASE_PACKAGE_PROFILE: 'openclaw-only',
      SDKWORK_RELEASE_REPOSITORY: 'Env-Owner/env-repo',
    },
    platform: 'win32',
    arch: 'x64',
    cliOverrides: {
      packageProfileId: 'dual-kernel',
      repository: 'Cli-Owner/cli-repo',
    },
    resolveGitRepositoryFn() {
      return 'sdkwork-ai/agent-studio';
    },
  });

  assert.equal(cliPackageProfileContext.packageProfileId, 'dual-kernel');
  assert.equal(cliPackageProfileContext.repository, 'Cli-Owner/cli-repo');

  const envRepositoryContext = helper.resolveLocalReleaseContext({
    mode: 'package:desktop',
    env: {
      SDKWORK_RELEASE_REPOSITORY: 'Env-Owner/env-repo',
    },
    platform: 'win32',
    arch: 'x64',
    resolveGitRepositoryFn() {
      return 'sdkwork-ai/agent-studio';
    },
  });

  assert.equal(envRepositoryContext.repository, 'Env-Owner/env-repo');
});

test('local release helper forwards explicit partial finalization intent', async () => {
  const helperPath = path.join(rootDir, 'scripts', 'release', 'local-release-command.mjs');
  const helper = await import(pathToFileURL(helperPath).href);

  const finalizeCalls = [];
  const result = await helper.runLocalReleaseCommand({
    mode: 'finalize',
    env: {},
    releaseTag: 'release-2026-04-11-06',
    releaseAssetsDir: 'D:/synthetic/release-assets',
    repository: 'sdkwork-ai/agent-studio',
    allowPartialRelease: true,
    finalizeReleaseAssetsFn(options) {
      finalizeCalls.push(options);
    },
  });

  assert.equal(result.mode, 'finalize');
  assert.deepEqual(finalizeCalls.map((call) => ({
    ...call,
    releaseAssetsDir: call.releaseAssetsDir.replaceAll('\\', '/'),
  })), [
    {
      profileId: 'agent-studio',
      releaseTag: 'release-2026-04-11-06',
      repository: 'sdkwork-ai/agent-studio',
      releaseAssetsDir: 'D:/synthetic/release-assets',
      allowPartialRelease: true,
    },
  ]);
});

test('local release helper forwards release readiness assertions through the finalized manifest gate', async () => {
  const helperPath = path.join(rootDir, 'scripts', 'release', 'local-release-command.mjs');
  const helper = await import(pathToFileURL(helperPath).href);

  const readinessCalls = [];
  const result = await helper.runLocalReleaseCommand({
    mode: 'assert-ready',
    env: {},
    releaseAssetsDir: 'D:/synthetic/release-assets',
    assertReleaseReadinessFn(options) {
      readinessCalls.push(options);
      return {
        artifactCount: 1,
      };
    },
  });

  assert.equal(result.mode, 'assert-ready');
  assert.deepEqual(
    readinessCalls.map((call) => ({
      ...call,
      releaseAssetsDir: call.releaseAssetsDir.replaceAll('\\', '/'),
    })),
    [
      {
        profileId: 'agent-studio',
        releaseAssetsDir: 'D:/synthetic/release-assets',
      },
    ],
  );
});

test('local release helper prints machine-readable release status for an empty release assets directory', async () => {
  const helperPath = path.join(rootDir, 'scripts', 'release', 'local-release-command.mjs');
  const helper = await import(pathToFileURL(helperPath).href);

  const os = await import('node:os');
  const fs = await import('node:fs');
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'claw-release-status-empty-'));
  const releaseAssetsDir = path.join(tempRoot, 'missing-release-assets');
  const stdoutChunks = [];
  const originalWrite = process.stdout.write;

  process.stdout.write = (chunk, encoding, callback) => {
    stdoutChunks.push(String(chunk));
    if (typeof callback === 'function') {
      callback();
    }
    return true;
  };

  try {
    const result = await helper.runLocalReleaseCommand({
      mode: 'status',
      env: {},
      releaseTag: 'release-2026-04-18-01',
      releaseAssetsDir,
      resolveGitRepositoryFn() {
        return 'sdkwork-ai/agent-studio';
      },
    });

    const status = JSON.parse(stdoutChunks.join(''));
    assert.equal(result.mode, 'status');
    assert.equal(status.profileId, 'agent-studio');
    assert.equal(status.releaseTag, 'release-2026-04-18-01');
    assert.equal(status.releaseAssetsDir.replaceAll('\\', '/'), releaseAssetsDir.replaceAll('\\', '/'));
    assert.equal(status.releaseAssetsDirExists, false);
    assert.equal(status.status, 'partial');
    assert.equal(status.requiredTargetCount, 25);
    assert.equal(status.presentTargetCount, 0);
    assert.equal(status.missingTargetCount, 25);
    assert.deepEqual(status.familyTargetCounts, {
      web: 1,
      desktop: 10,
      server: 6,
      container: 4,
      kubernetes: 4,
    });
    assert.equal(status.releaseCoverage.status, 'partial');
    assert.equal(status.releaseCoverage.missingTargets.length, 25);
    assert.deepEqual(
      [...new Set(status.nextCommands.map((entry) => entry.family))].sort(),
      ['container', 'desktop', 'kubernetes', 'server', 'web'],
    );
    assert.ok(
      status.nextCommands.some((entry) => entry.command === 'pnpm release:package:web'),
      'status output should recommend web packaging when web is missing',
    );
    assert.ok(
      status.nextCommands.some((entry) => entry.command.includes('pnpm release:package:desktop -- --platform windows --arch x64 --target x86_64-pc-windows-msvc')),
      'status output should recommend a target-specific desktop packaging command',
    );
    assert.ok(
      status.nextCommands.some((entry) => entry.command.includes('pnpm release:package:container -- --platform linux --arch x64 --target x86_64-unknown-linux-gnu --accelerator cpu')),
      'status output should recommend accelerator-specific container packaging',
    );
    assert.deepEqual(
      [...new Set(status.nextActions.map((entry) => entry.kind))],
      ['package-target'],
    );
    assert.deepEqual(
      [...new Set(status.nextActions.map((entry) => entry.family))].sort(),
      ['container', 'desktop', 'kubernetes', 'server', 'web'],
    );
    assert.equal(
      status.nextActions.some((entry) => entry.command === 'pnpm release:package:web' && entry.priority === 100),
      true,
      'status output should expose missing web packaging as a prioritized next action',
    );
  } finally {
    process.stdout.write = originalWrite;
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('local release helper reports partial release status from existing partial manifests', async () => {
  const helperPath = path.join(rootDir, 'scripts', 'release', 'local-release-command.mjs');
  const helper = await import(pathToFileURL(helperPath).href);

  const os = await import('node:os');
  const fs = await import('node:fs');
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'claw-release-status-web-'));
  const releaseAssetsDir = path.join(tempRoot, 'release-assets');
  const webDir = path.join(releaseAssetsDir, 'web');
  const webArchiveRelativePath = 'web/agent-studio-web-assets-release-2026-04-18-01.tar.gz';
  const stdoutChunks = [];
  const originalWrite = process.stdout.write;

  process.stdout.write = (chunk, encoding, callback) => {
    stdoutChunks.push(String(chunk));
    if (typeof callback === 'function') {
      callback();
    }
    return true;
  };

  try {
    fs.mkdirSync(webDir, { recursive: true });
    fs.writeFileSync(path.join(releaseAssetsDir, webArchiveRelativePath), 'synthetic web archive', 'utf8');
    fs.writeFileSync(
      path.join(webDir, 'release-asset-manifest.json'),
      `${JSON.stringify({
        profileId: 'agent-studio',
        releaseTag: 'release-2026-04-18-01',
        family: 'web',
        platform: 'web',
        arch: 'any',
        artifacts: [
          {
            relativePath: webArchiveRelativePath,
            family: 'web',
            platform: 'web',
            arch: 'any',
            kind: 'archive',
          },
        ],
      }, null, 2)}\n`,
      'utf8',
    );

    await helper.runLocalReleaseCommand({
      mode: 'status',
      env: {},
      releaseTag: 'release-2026-04-18-01',
      releaseAssetsDir,
      resolveGitRepositoryFn() {
        return 'sdkwork-ai/agent-studio';
      },
    });

    const status = JSON.parse(stdoutChunks.join(''));
    assert.equal(status.releaseAssetsDirExists, true);
    assert.equal(status.status, 'partial');
    assert.equal(status.partialManifestCount, 1);
    assert.equal(status.artifactCount, 1);
    assert.equal(status.requiredTargetCount, 25);
    assert.equal(status.presentTargetCount, 1);
    assert.equal(status.missingTargetCount, 24);
    assert.deepEqual(status.releaseCoverage.presentTargets, ['web/web/any']);
    assert.equal(status.releaseCoverage.missingTargets.includes('web/web/any'), false);
    assert.equal(
      status.nextCommands.some((entry) => entry.family === 'web'),
      false,
      'status output should not recommend web packaging after web target is present',
    );
    assert.ok(
      status.nextCommands.some((entry) => entry.family === 'desktop'),
      'status output should still recommend missing desktop packaging',
    );
    assert.equal(
      status.nextActions.some((entry) => entry.kind === 'package-target' && entry.family === 'web'),
      false,
      'status output should not emit a web package next action after web target is present',
    );
    assert.ok(
      status.nextActions.some((entry) => entry.kind === 'package-target' && entry.family === 'desktop'),
      'status output should still emit package next actions for missing desktop targets',
    );
  } finally {
    process.stdout.write = originalWrite;
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('local release helper always refreshes server prerequisites for local server and container packaging', async () => {
  const helperPath = path.join(rootDir, 'scripts', 'release', 'local-release-command.mjs');
  const helper = await import(pathToFileURL(helperPath).href);

  assert.equal(typeof helper.ensureLocalServerBuildPrerequisite, 'function');

  const buildCalls = [];
  const existingBinaries = new Set([
    'D:/synthetic/agentstudio-server.exe',
    'D:/synthetic/agentstudio-server',
  ]);
  const serverResult = helper.ensureLocalServerBuildPrerequisite({
    context: {
      mode: 'release:package:server',
      target: 'x86_64-pc-windows-msvc',
      platform: 'windows',
    },
    fileExists(targetPath) {
      return existingBinaries.has(targetPath);
    },
    resolveBinaryPath() {
      return 'D:/synthetic/agentstudio-server.exe';
    },
    runServerBuildFn(options) {
      buildCalls.push(options);
    },
  });

  const containerResult = helper.ensureLocalServerBuildPrerequisite({
    context: {
      mode: 'package:container',
      target: 'x86_64-unknown-linux-gnu',
      platform: 'linux',
    },
    fileExists(targetPath) {
      return existingBinaries.has(targetPath);
    },
    resolveBinaryPath() {
      return 'D:/synthetic/agentstudio-server';
    },
    runServerBuildFn(options) {
      buildCalls.push(options);
    },
  });

  assert.deepEqual(buildCalls, [
    { targetTriple: 'x86_64-pc-windows-msvc' },
    { targetTriple: 'x86_64-unknown-linux-gnu' },
  ]);
  assert.deepEqual(serverResult, {
    binaryPath: 'D:/synthetic/agentstudio-server.exe',
    built: true,
  });
  assert.deepEqual(containerResult, {
    binaryPath: 'D:/synthetic/agentstudio-server',
    built: true,
  });
});

test('local release helper rejects server prerequisite builds that do not materialize the canonical binary path', async () => {
  const helperPath = path.join(rootDir, 'scripts', 'release', 'local-release-command.mjs');
  const helper = await import(pathToFileURL(helperPath).href);

  assert.equal(typeof helper.ensureLocalServerBuildPrerequisite, 'function');

  let existenceChecks = 0;

  assert.throws(
    () => helper.ensureLocalServerBuildPrerequisite({
      context: {
        mode: 'release:package:server',
        target: 'x86_64-unknown-linux-gnu',
        platform: 'linux',
      },
      fileExists() {
        existenceChecks += 1;
        return false;
      },
      resolveBinaryPath() {
        return 'D:/synthetic/agentstudio-server';
      },
      runServerBuildFn() {},
    }),
    /Server build completed without producing the canonical binary at D:\/synthetic\/agentstudio-server/i,
  );

  assert.equal(existenceChecks, 1);
});

test('local release helper auto-builds stale desktop prerequisites for local desktop packaging', async () => {
  const helperPath = path.join(rootDir, 'scripts', 'release', 'local-release-command.mjs');
  const helper = await import(pathToFileURL(helperPath).href);

  assert.equal(typeof helper.ensureLocalDesktopBuildPrerequisite, 'function');

  const buildCalls = [];
  const resolvedBundleRoots = [
    'D:/synthetic/fallback-desktop-bundle',
    'D:/synthetic/x86_64-pc-windows-msvc-desktop-bundle',
  ];
  const result = helper.ensureLocalDesktopBuildPrerequisite({
    context: {
      mode: 'package:desktop',
      profileId: 'agent-studio',
      target: 'x86_64-pc-windows-msvc',
    },
    fileExists() {
      return true;
    },
    resolveDesktopBundleRoot() {
      return resolvedBundleRoots.shift();
    },
    inspectTauriTargetFn() {
      return {
        stale: true,
      };
    },
    runDesktopBuildFn(options) {
      buildCalls.push(options);
    },
  });

  assert.deepEqual(buildCalls, [
    {
      profileId: 'agent-studio',
      targetTriple: 'x86_64-pc-windows-msvc',
    },
  ]);
  assert.deepEqual(result, {
    bundleRoot: 'D:/synthetic/x86_64-pc-windows-msvc-desktop-bundle',
    built: true,
    staleTarget: true,
  });
});

test('local release helper rejects desktop prerequisite builds that do not materialize the canonical bundle root', async () => {
  const helperPath = path.join(rootDir, 'scripts', 'release', 'local-release-command.mjs');
  const helper = await import(pathToFileURL(helperPath).href);

  assert.equal(typeof helper.ensureLocalDesktopBuildPrerequisite, 'function');

  let existenceChecks = 0;

  assert.throws(
    () => helper.ensureLocalDesktopBuildPrerequisite({
      context: {
        mode: 'package:desktop',
        profileId: 'agent-studio',
        target: 'x86_64-pc-windows-msvc',
      },
      fileExists() {
        existenceChecks += 1;
        return false;
      },
      resolveDesktopBundleRoot() {
        return 'D:/synthetic/desktop-bundle';
      },
      inspectTauriTargetFn() {
        return {
          stale: true,
        };
      },
      runDesktopBuildFn() {},
    }),
    /Desktop release build completed without producing the canonical bundle root at D:\/synthetic\/desktop-bundle/i,
  );

  assert.equal(existenceChecks, 2);
});

test('local release helper runs desktop prerequisite builds through the unified desktop release runner', async () => {
  const helperPath = path.join(rootDir, 'scripts', 'release', 'local-release-command.mjs');
  const helper = await import(pathToFileURL(helperPath).href);

  assert.equal(typeof helper.runLocalDesktopBuild, 'function');

  const spawnCalls = [];
  helper.runLocalDesktopBuild({
    profileId: 'agent-studio',
    targetTriple: 'x86_64-pc-windows-msvc',
    spawnSyncImpl(command, args, options) {
      spawnCalls.push({
        command,
        args,
        options,
      });
      return {
        status: 0,
      };
    },
  });

  assert.deepEqual(spawnCalls, [
    {
      command: process.execPath,
      args: [
        path.join(rootDir, 'scripts', 'run-desktop-release-build.mjs'),
        '--profile',
        'agent-studio',
        '--target',
        'x86_64-pc-windows-msvc',
      ],
      options: {
        cwd: rootDir,
        shell: false,
        stdio: 'inherit',
        windowsHide: true,
      },
    },
  ]);
});

test('local release helper dispatches desktop installer and startup smoke through the dedicated smoke command', async () => {
  const helperPath = path.join(rootDir, 'scripts', 'release', 'local-release-command.mjs');
  const helper = await import(pathToFileURL(helperPath).href);

  const smokeCalls = [];
  const result = await helper.runLocalReleaseCommand({
    mode: 'smoke:desktop',
    env: {},
    platform: 'darwin',
    arch: 'arm64',
    startupEvidencePath: 'D:/synthetic/desktop-startup-evidence.json',
    smokeDesktopInstallersFn(context) {
      smokeCalls.push({
        step: 'installers',
        context,
      });
      return {
        ok: true,
        context,
      };
    },
    smokeDesktopStartupEvidenceFn(context) {
      smokeCalls.push({
        step: 'startup',
        context,
      });
      return {
        ok: true,
        context,
      };
    },
  });

  assert.deepEqual(
    smokeCalls.map((entry) => entry.step),
    ['installers', 'startup'],
  );
  assert.equal(smokeCalls[0].context.mode, 'smoke:desktop');
  assert.equal(smokeCalls[0].context.platform, 'macos');
  assert.equal(smokeCalls[0].context.arch, 'arm64');
  assert.equal(smokeCalls[0].context.target, 'aarch64-apple-darwin');
  assert.equal(
    smokeCalls[1].context.startupEvidencePath.replaceAll('\\', '/'),
    'D:/synthetic/desktop-startup-evidence.json',
  );
  assert.equal(result.mode, 'smoke:desktop');
});

test('local release helper dispatches packaged desktop launch smoke when no external startup evidence path is provided', async () => {
  const helperPath = path.join(rootDir, 'scripts', 'release', 'local-release-command.mjs');
  const helper = await import(pathToFileURL(helperPath).href);

  const smokeCalls = [];
  const result = await helper.runLocalReleaseCommand({
    mode: 'smoke:desktop',
    env: {},
    platform: 'linux',
    arch: 'x64',
    smokeDesktopInstallersFn(context) {
      smokeCalls.push({
        step: 'installers',
        context,
      });
      return {
        ok: true,
        context,
      };
    },
    smokeDesktopPackagedLaunchFn(context) {
      smokeCalls.push({
        step: 'packaged-launch',
        context,
      });
      return {
        ok: true,
        context,
      };
    },
  });

  assert.deepEqual(
    smokeCalls.map((entry) => entry.step),
    ['installers', 'packaged-launch'],
  );
  assert.equal(smokeCalls[1].context.platform, 'linux');
  assert.equal(smokeCalls[1].context.arch, 'x64');
  assert.equal(smokeCalls[1].context.target, 'x86_64-unknown-linux-gnu');
  assert.equal(result.mode, 'smoke:desktop');
});

test('local release helper dispatches server, web, and deployment smoke through dedicated smoke commands', async () => {
  const helperPath = path.join(rootDir, 'scripts', 'release', 'local-release-command.mjs');
  const helper = await import(pathToFileURL(helperPath).href);

  const smokeCalls = [];

  const serverResult = await helper.runLocalReleaseCommand({
    mode: 'smoke:server',
    env: {},
    platform: 'linux',
    arch: 'x64',
    smokeServerReleaseAssetsFn(context) {
      smokeCalls.push({
        family: 'server',
        context,
      });
      return {
        ok: true,
        context,
      };
    },
  });

  const webResult = await helper.runLocalReleaseCommand({
    mode: 'smoke:web',
    env: {},
    smokeWebReleaseAssetsFn(context) {
      smokeCalls.push({
        family: 'web',
        context,
      });
      return {
        ok: true,
        context,
      };
    },
  });

  const containerResult = await helper.runLocalReleaseCommand({
    mode: 'smoke:container',
    env: {},
    platform: 'win32',
    arch: 'x64',
    smokeDeploymentReleaseAssetsFn(context) {
      smokeCalls.push({
        family: context.mode,
        context,
      });
      return {
        ok: true,
        context,
      };
    },
  });

  const kubernetesResult = await helper.runLocalReleaseCommand({
    mode: 'smoke:kubernetes',
    env: {},
    platform: 'darwin',
    arch: 'arm64',
    smokeDeploymentReleaseAssetsFn(context) {
      smokeCalls.push({
        family: context.mode,
        context,
      });
      return {
        ok: true,
        context,
      };
    },
  });

  assert.equal(smokeCalls.length, 4);
  assert.equal(smokeCalls[0].family, 'server');
  assert.equal(smokeCalls[0].context.mode, 'smoke:server');
  assert.equal(smokeCalls[0].context.target, 'x86_64-unknown-linux-gnu');
  assert.equal(smokeCalls[1].family, 'web');
  assert.equal(smokeCalls[1].context.mode, 'smoke:web');
  assert.equal(smokeCalls[1].context.platform, 'web');
  assert.equal(smokeCalls[1].context.arch, 'any');
  assert.equal(smokeCalls[2].family, 'smoke:container');
  assert.equal(smokeCalls[2].context.platform, 'linux');
  assert.equal(smokeCalls[2].context.accelerator, 'cpu');
  assert.equal(smokeCalls[3].family, 'smoke:kubernetes');
  assert.equal(smokeCalls[3].context.platform, 'linux');
  assert.equal(smokeCalls[3].context.arch, 'arm64');
  assert.equal(serverResult.mode, 'smoke:server');
  assert.equal(webResult.mode, 'smoke:web');
  assert.equal(containerResult.mode, 'smoke:container');
  assert.equal(kubernetesResult.mode, 'smoke:kubernetes');
});

test('local release helper automatically runs desktop smoke after packaging desktop release assets', async () => {
  const helperPath = path.join(rootDir, 'scripts', 'release', 'local-release-command.mjs');
  const helper = await import(pathToFileURL(helperPath).href);

  const callOrder = [];
  await helper.runLocalReleaseCommand({
    mode: 'package:desktop',
    env: {},
    platform: 'linux',
    arch: 'x64',
    packageProfileId: 'dual-kernel',
    releaseAssetsDir: 'D:/synthetic/release-assets',
    ensureLocalDesktopBuildPrerequisiteFn({ context }) {
      callOrder.push({
        step: 'desktop-prereq',
        context,
      });
      return {
        bundleRoot: 'D:/synthetic/desktop-bundle',
        built: false,
        staleTarget: false,
      };
    },
    packageDesktopAssetsFn(context) {
      callOrder.push({
        step: 'package',
        context,
      });
    },
    smokeDesktopInstallersFn: async (context) => {
      callOrder.push({
        step: 'installers',
        context,
      });
      return {
        ok: true,
      };
    },
    smokeDesktopPackagedLaunchFn: async (context) => {
      callOrder.push({
        step: 'packaged-launch',
        context,
      });
      return {
        ok: true,
      };
    },
  });

  assert.deepEqual(
    callOrder.map((entry) => entry.step),
    ['desktop-prereq', 'package', 'installers', 'packaged-launch'],
  );
  assert.equal(callOrder[0].context.releaseAssetsDir.replaceAll('\\', '/'), 'D:/synthetic/release-assets');
  assert.equal(callOrder[1].context.releaseAssetsDir.replaceAll('\\', '/'), 'D:/synthetic/release-assets');
  assert.equal(callOrder[1].context.platform, 'linux');
  assert.equal(callOrder[1].context.arch, 'x64');
  assert.equal(callOrder[1].context.target, 'x86_64-unknown-linux-gnu');
  assert.equal(callOrder[1].context.packageProfileId, 'dual-kernel');
  assert.equal(callOrder[2].context.releaseAssetsDir.replaceAll('\\', '/'), 'D:/synthetic/release-assets');
  assert.equal(callOrder[2].context.platform, 'linux');
  assert.equal(callOrder[2].context.arch, 'x64');
  assert.equal(callOrder[2].context.target, 'x86_64-unknown-linux-gnu');
  assert.equal(callOrder[2].context.packageProfileId, 'dual-kernel');
  assert.equal(callOrder[3].context.releaseAssetsDir.replaceAll('\\', '/'), 'D:/synthetic/release-assets');
  assert.equal(callOrder[3].context.platform, 'linux');
  assert.equal(callOrder[3].context.arch, 'x64');
  assert.equal(callOrder[3].context.target, 'x86_64-unknown-linux-gnu');
  assert.equal(callOrder[3].context.packageProfileId, 'dual-kernel');
});

test('local release helper forwards the resolved package profile into plan generation', async () => {
  const helperPath = path.join(rootDir, 'scripts', 'release', 'local-release-command.mjs');
  const helper = await import(pathToFileURL(helperPath).href);

  const planCalls = [];
  const stdoutChunks = [];
  const originalWrite = process.stdout.write;

  process.stdout.write = (chunk, encoding, callback) => {
    stdoutChunks.push(String(chunk));
    if (typeof callback === 'function') {
      callback();
    }
    return true;
  };

  try {
    const context = await helper.runLocalReleaseCommand({
      mode: 'plan',
      env: {},
      platform: 'win32',
      arch: 'x64',
      packageProfileId: 'dual-kernel',
      createReleasePlanFn(options) {
        planCalls.push(options);
        return {
          profileId: options.profileId,
          packageProfileId: options.packageProfileId,
          releaseTag: options.releaseTag,
          gitRef: options.gitRef,
          desktopMatrix: [],
          serverMatrix: [],
          containerMatrix: [],
          kubernetesMatrix: [],
          release: {
            manifestFileName: 'release-manifest.json',
            manifestChecksumFileName: 'release-manifest.json.sha256.txt',
            attestationEvidenceFileName: 'release-attestations.json',
            globalChecksumsFileName: 'SHA256SUMS.txt',
          },
        };
      },
    });

    assert.equal(context.mode, 'plan');
    assert.equal(context.packageProfileId, 'dual-kernel');
    assert.deepEqual(planCalls, [
      {
        profileId: 'agent-studio',
        packageProfileId: 'dual-kernel',
        releaseTag: 'release-local',
        gitRef: 'refs/tags/release-local',
      },
    ]);
    assert.match(stdoutChunks.join(''), /"packageProfileId": "dual-kernel"/);
  } finally {
    process.stdout.write = originalWrite;
  }
});

test('local release helper automatically runs server smoke after packaging server release assets', async () => {
  const helperPath = path.join(rootDir, 'scripts', 'release', 'local-release-command.mjs');
  const helper = await import(pathToFileURL(helperPath).href);

  const callOrder = [];
  await helper.runLocalReleaseCommand({
    mode: 'release:package:server',
    env: {},
    platform: 'linux',
    arch: 'x64',
    releaseAssetsDir: 'D:/synthetic/release-assets',
    fileExists() {
      return true;
    },
    runServerBuildFn() {
      callOrder.push({
        step: 'build',
      });
    },
    packageServerAssetsFn(context) {
      callOrder.push({
        step: 'package',
        context,
      });
    },
    smokeServerReleaseAssetsFn: async (context) => {
      callOrder.push({
        step: 'smoke',
        context,
      });
      return {
        ok: true,
      };
    },
  });

  assert.deepEqual(
    callOrder.map((entry) => entry.step),
    ['build', 'package', 'smoke'],
  );
  assert.equal(callOrder[1].context.releaseAssetsDir.replaceAll('\\', '/'), 'D:/synthetic/release-assets');
  assert.equal(callOrder[2].context.releaseAssetsDir.replaceAll('\\', '/'), 'D:/synthetic/release-assets');
  assert.equal(callOrder[2].context.platform, 'linux');
  assert.equal(callOrder[2].context.arch, 'x64');
  assert.equal(callOrder[2].context.target, 'x86_64-unknown-linux-gnu');
});

test('local release helper automatically runs deployment smoke after packaging container and kubernetes release assets', async () => {
  const helperPath = path.join(rootDir, 'scripts', 'release', 'local-release-command.mjs');
  const helper = await import(pathToFileURL(helperPath).href);

  const callOrder = [];
  await helper.runLocalReleaseCommand({
    mode: 'package:container',
    env: {},
    platform: 'linux',
    arch: 'x64',
    releaseAssetsDir: 'D:/synthetic/release-assets',
    fileExists() {
      return true;
    },
    runServerBuildFn() {
      callOrder.push({
        step: 'build-container',
      });
    },
    packageContainerAssetsFn(context) {
      callOrder.push({
        step: 'package-container',
        context,
      });
    },
    smokeDeploymentReleaseAssetsFn: async (context) => {
      callOrder.push({
        step: `smoke-${context.family}`,
        context,
      });
      return {
        ok: true,
      };
    },
  });

  await helper.runLocalReleaseCommand({
    mode: 'package:kubernetes',
    env: {},
    platform: 'linux',
    arch: 'arm64',
    releaseAssetsDir: 'D:/synthetic/release-assets',
    packageKubernetesAssetsFn(context) {
      callOrder.push({
        step: 'package-kubernetes',
        context,
      });
    },
    smokeDeploymentReleaseAssetsFn: async (context) => {
      callOrder.push({
        step: `smoke-${context.family}`,
        context,
      });
      return {
        ok: true,
      };
    },
  });

  assert.deepEqual(
    callOrder.map((entry) => entry.step),
    ['build-container', 'package-container', 'smoke-container', 'package-kubernetes', 'smoke-kubernetes'],
  );
  assert.equal(callOrder[2].context.releaseAssetsDir.replaceAll('\\', '/'), 'D:/synthetic/release-assets');
  assert.equal(callOrder[2].context.platform, 'linux');
  assert.equal(callOrder[2].context.arch, 'x64');
  assert.equal(callOrder[2].context.accelerator, 'cpu');
  assert.equal(callOrder[4].context.releaseAssetsDir.replaceAll('\\', '/'), 'D:/synthetic/release-assets');
  assert.equal(callOrder[4].context.platform, 'linux');
  assert.equal(callOrder[4].context.arch, 'arm64');
  assert.equal(callOrder[4].context.family, 'kubernetes');
});

test('local release helper runs web and docs builds before packaging web release assets', async () => {
  const helperPath = path.join(rootDir, 'scripts', 'release', 'local-release-command.mjs');
  const helper = await import(pathToFileURL(helperPath).href);

  const callOrder = [];
  await helper.runLocalReleaseCommand({
    mode: 'package:web',
    env: {},
    releaseTag: 'release-2026-04-07-01',
    outputDir: 'D:/synthetic/release-assets',
    ensureLocalWebBuildPrerequisiteFn({ context }) {
      callOrder.push({
        step: 'web-prereq',
        context,
      });
      return {
        built: true,
      };
    },
    packageWebAssetsFn(context) {
      callOrder.push({
        step: 'package',
        context,
      });
    },
    smokeWebReleaseAssetsFn: async (context) => {
      callOrder.push({
        step: 'smoke',
        context,
      });
      return {
        ok: true,
      };
    },
  });

  assert.deepEqual(
    callOrder.map((entry) => entry.step),
    ['web-prereq', 'package', 'smoke'],
  );
  assert.equal(callOrder[0].context.mode, 'package:web');
  assert.equal(callOrder[0].context.releaseTag, 'release-2026-04-07-01');
  assert.equal(callOrder[0].context.outputDir.replaceAll('\\', '/'), 'D:/synthetic/release-assets');
  assert.equal(callOrder[1].context.outputDir.replaceAll('\\', '/'), 'D:/synthetic/release-assets');
  assert.equal(callOrder[2].context.outputDir.replaceAll('\\', '/'), 'D:/synthetic/release-assets');
  assert.equal(callOrder[2].context.releaseAssetsDir.replaceAll('\\', '/'), 'D:/synthetic/release-assets');
});

test('local release helper runs web prerequisite builds through canonical local build commands', async () => {
  const helperPath = path.join(rootDir, 'scripts', 'release', 'local-release-command.mjs');
  const helper = await import(pathToFileURL(helperPath).href);

  assert.equal(typeof helper.runLocalWebBuild, 'function');

  const spawnCalls = [];
  helper.runLocalWebBuild({
    spawnSyncImpl(command, args, options) {
      spawnCalls.push({
        command,
        args,
        options,
      });
      return {
        status: 0,
      };
    },
  });

  assert.deepEqual(
    spawnCalls.map((call) => ({
      command: call.command,
      args: call.args,
      options: call.options,
    })),
    [
      {
        command: process.execPath,
        args: [path.join(rootDir, 'scripts', 'prepare-shared-sdk-packages.mjs')],
        options: {
          cwd: rootDir,
          shell: false,
          stdio: 'inherit',
          windowsHide: true,
        },
      },
      {
        command: process.execPath,
        args: [path.join(rootDir, 'scripts', 'run-vite-host.mjs'), 'build', '--mode', 'production'],
        options: {
          cwd: path.join(rootDir, 'packages', 'sdkwork-agentstudio-pc-web'),
          shell: false,
          stdio: 'inherit',
          windowsHide: true,
        },
      },
      {
        command: process.execPath,
        args: [path.join(rootDir, 'scripts', 'check-web-performance-budget.mjs')],
        options: {
          cwd: rootDir,
          shell: false,
          stdio: 'inherit',
          windowsHide: true,
        },
      },
      {
        command: process.execPath,
        args: [path.join(rootDir, 'scripts', 'run-vitepress.mjs'), 'build', 'docs'],
        options: {
          cwd: rootDir,
          shell: false,
          stdio: 'inherit',
          windowsHide: true,
        },
      },
    ],
  );
});

test('local release helper stops web packaging when a prerequisite build fails', async () => {
  const helperPath = path.join(rootDir, 'scripts', 'release', 'local-release-command.mjs');
  const helper = await import(pathToFileURL(helperPath).href);

  const packageCalls = [];

  await assert.rejects(
    () => helper.runLocalReleaseCommand({
      mode: 'package:web',
      env: {},
      ensureLocalWebBuildPrerequisiteFn() {
        throw new Error('Web release prerequisite failed.');
      },
      packageWebAssetsFn(context) {
        packageCalls.push(context);
      },
    }),
    /Web release prerequisite failed\./,
  );

  assert.equal(packageCalls.length, 0);
});

test('local release helper rejects web prerequisite builds that do not materialize build outputs', async () => {
  const helperPath = path.join(rootDir, 'scripts', 'release', 'local-release-command.mjs');
  const helper = await import(pathToFileURL(helperPath).href);

  assert.equal(typeof helper.ensureLocalWebBuildPrerequisite, 'function');

  const buildCalls = [];
  const existingOutputs = new Set([
    'D:/synthetic/web-dist',
  ]);

  assert.throws(
    () => helper.ensureLocalWebBuildPrerequisite({
      context: {
        mode: 'package:web',
      },
      fileExists(targetPath) {
        return existingOutputs.has(targetPath);
      },
      webBuildDir: 'D:/synthetic/web-dist',
      docsBuildDir: 'D:/synthetic/docs-dist',
      runWebBuildFn() {
        buildCalls.push('build');
      },
    }),
    /Web release build completed without producing the canonical docs dist directory at D:\/synthetic\/docs-dist/i,
  );

  assert.deepEqual(buildCalls, ['build']);
});

test('release readiness fixture generator creates a complete default-profile publish gate fixture', async () => {
  const fixturePath = path.join(rootDir, 'scripts', 'release', 'write-readiness-fixture.mjs');
  const readinessPath = path.join(rootDir, 'scripts', 'release', 'assert-release-readiness.mjs');
  const planPath = path.join(rootDir, 'scripts', 'release', 'resolve-release-plan.mjs');
  const fixture = await import(pathToFileURL(fixturePath).href);
  const readiness = await import(pathToFileURL(readinessPath).href);
  const releasePlan = await import(pathToFileURL(planPath).href);

  assert.equal(typeof fixture.writeReleaseReadinessFixture, 'function');

  const os = await import('node:os');
  const fs = await import('node:fs');
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'claw-release-fixture-ready-'));
  const releaseAssetsDir = path.join(tempRoot, 'release-assets');

  try {
    const result = fixture.writeReleaseReadinessFixture({
      releaseAssetsDir,
      profileId: 'agent-studio',
      releaseTag: 'release-fixture',
      repository: 'sdkwork-ai/agent-studio',
    });

    assert.equal(result.releaseAssetsDir, releaseAssetsDir);
    assert.equal(result.artifactCount, 25);
    assert.equal(result.requiredTargetCount, 25);
    assert.equal(result.releasePlanTargetCount, 25);

    const plan = releasePlan.createReleasePlan({
      profileId: 'agent-studio',
      releaseTag: 'release-fixture',
    });

    assert.equal(plan.requiredTargetCount, 25);
    assert.equal(result.requiredTargetCount, plan.requiredTargetCount);
    assert.equal(result.releasePlanTargetCount, plan.requiredTargetCount);

    const readinessResult = readiness.assertReleaseReadiness({
      releaseAssetsDir,
      profileId: 'agent-studio',
    });

    assert.equal(readinessResult.artifactCount, 25);
    assert.equal(readinessResult.requiredTargetCount, 25);
    assert.equal(readinessResult.releaseMetadataCount, 1);
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('release readiness fixture generator writes smoke manifests for the selected profile', async () => {
  const fixturePath = path.join(rootDir, 'scripts', 'release', 'write-readiness-fixture.mjs');
  const fixture = await import(pathToFileURL(fixturePath).href);

  const os = await import('node:os');
  const fs = await import('node:fs');
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'claw-release-fixture-profile-'));
  const releaseAssetsDir = path.join(tempRoot, 'release-assets');
  const profile = {
    id: 'synthetic-commercial-profile',
    productName: 'Synthetic Commercial Profile',
    defaultPackageProfileId: 'synthetic-package-profile',
    desktop: {
      matrix: [],
    },
    server: {
      matrix: [],
    },
    container: {
      matrix: [],
    },
    kubernetes: {
      matrix: [],
    },
    release: {
      manifestFileName: 'release-manifest.json',
      manifestChecksumFileName: 'release-manifest.json.sha256.txt',
      attestationEvidenceFileName: 'release-attestations.json',
      attestationPredicateType: 'https://slsa.dev/provenance/v1',
      attestationSignerWorkflowPath: '.github/workflows/release-reusable.yml',
      globalChecksumsFileName: 'SHA256SUMS.txt',
    },
  };

  try {
    fixture.writeReleaseReadinessFixture({
      releaseAssetsDir,
      profileId: profile.id,
      releaseTag: 'release-fixture',
      repository: 'sdkwork-ai/agent-studio',
      resolveReleaseProfileFn(requestedProfileId) {
        assert.equal(requestedProfileId, profile.id);
        return profile;
      },
      createReleasePlanFn({ profileId, releaseTag }) {
        assert.equal(profileId, profile.id);
        assert.equal(releaseTag, 'release-fixture');
        return {
          familyTargetCounts: {
            web: 1,
            desktop: 0,
            server: 0,
            container: 0,
            kubernetes: 0,
          },
          requiredTargetCount: 1,
          desktopMatrix: [],
          serverMatrix: [],
          containerMatrix: [],
          kubernetesMatrix: [],
        };
      },
    });

    const webSmokeManifest = JSON.parse(
      fs.readFileSync(path.join(releaseAssetsDir, 'web', 'release-asset-manifest.json'), 'utf8'),
    );

    assert.equal(webSmokeManifest.profileId, profile.id);
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('release readiness fixture generator requires release plan target count metadata', async () => {
  const fixturePath = path.join(rootDir, 'scripts', 'release', 'write-readiness-fixture.mjs');
  const fixture = await import(pathToFileURL(fixturePath).href);

  const os = await import('node:os');
  const fs = await import('node:fs');
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'claw-release-fixture-missing-plan-count-'));
  const releaseAssetsDir = path.join(tempRoot, 'release-assets');
  const profile = {
    id: 'synthetic-commercial-profile',
    productName: 'Synthetic Commercial Profile',
    defaultPackageProfileId: 'synthetic-package-profile',
    desktop: {
      matrix: [],
    },
    server: {
      matrix: [],
    },
    container: {
      matrix: [],
    },
    kubernetes: {
      matrix: [],
    },
    release: {
      manifestFileName: 'release-manifest.json',
      manifestChecksumFileName: 'release-manifest.json.sha256.txt',
      attestationEvidenceFileName: 'release-attestations.json',
      attestationPredicateType: 'https://slsa.dev/provenance/v1',
      attestationSignerWorkflowPath: '.github/workflows/release-reusable.yml',
      globalChecksumsFileName: 'SHA256SUMS.txt',
    },
  };

  try {
    assert.throws(
      () => fixture.writeReleaseReadinessFixture({
        releaseAssetsDir,
        profileId: profile.id,
        releaseTag: 'release-fixture',
        repository: 'sdkwork-ai/agent-studio',
        resolveReleaseProfileFn() {
          return profile;
        },
        createReleasePlanFn() {
          return {
            desktopMatrix: [],
            serverMatrix: [],
            containerMatrix: [],
            kubernetesMatrix: [],
          };
        },
      }),
      /Release plan for synthetic-commercial-profile did not expose requiredTargetCount/,
    );
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('release readiness fixture generator refuses to clean real release asset directories', async () => {
  const fixturePath = path.join(rootDir, 'scripts', 'release', 'write-readiness-fixture.mjs');
  const fixture = await import(pathToFileURL(fixturePath).href);

  assert.throws(
    () => fixture.writeReleaseReadinessFixture({
      releaseAssetsDir: path.join(rootDir, 'artifacts', 'release'),
      profileId: 'agent-studio',
      releaseTag: 'release-fixture',
      repository: 'sdkwork-ai/agent-studio',
      clean: true,
    }),
    /Refusing to clean unsafe release readiness fixture directory/,
  );
});

test('release readiness fixture generator refuses to clean non-temporary external directories', async () => {
  const fixturePath = path.join(rootDir, 'scripts', 'release', 'write-readiness-fixture.mjs');
  const fixture = await import(pathToFileURL(fixturePath).href);
  const externalOutputDir = path.parse(rootDir).root === rootDir
    ? path.join(rootDir, 'release-readiness-fixture')
    : path.parse(rootDir).root;

  assert.throws(
    () => fixture.writeReleaseReadinessFixture({
      releaseAssetsDir: externalOutputDir,
      profileId: 'agent-studio',
      releaseTag: 'release-fixture',
      repository: 'sdkwork-ai/agent-studio',
      clean: true,
    }),
    /Refusing to use release readiness fixture directory outside the workspace or system temporary directory/,
  );
});
