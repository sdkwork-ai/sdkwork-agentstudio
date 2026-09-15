// WORKSPACE-PATH:allow-fixture: fixtures name a foreign checkout root, drive, or home directory to exercise path handling, so the literal is the value under assertion rather than a binding this build resolves
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { pathToFileURL } from 'node:url';
import { gzipSync } from 'node:zlib';

import { createStoredZipArchive } from '../test-support/archive-fixtures.mjs';

const rootDir = path.resolve(import.meta.dirname, '..', '..');

function formatTarOctal(value, width) {
  return `${value.toString(8).padStart(width - 2, '0')}\0 `;
}

function createTarHeader({
  name,
  size,
  type = '0',
} = {}) {
  const header = Buffer.alloc(512, 0);
  Buffer.from(String(name ?? '').slice(0, 100), 'utf8').copy(header, 0);
  Buffer.from(formatTarOctal(0o644, 8), 'utf8').copy(header, 100);
  Buffer.from(formatTarOctal(0, 8), 'utf8').copy(header, 108);
  Buffer.from(formatTarOctal(0, 8), 'utf8').copy(header, 116);
  Buffer.from(formatTarOctal(size, 12), 'utf8').copy(header, 124);
  Buffer.from(formatTarOctal(0, 12), 'utf8').copy(header, 136);
  header.fill(0x20, 148, 156);
  header.write(String(type ?? '0').slice(0, 1), 156, 1, 'utf8');
  Buffer.from('ustar\0', 'utf8').copy(header, 257);
  Buffer.from('00', 'utf8').copy(header, 263);

  let checksum = 0;
  for (const value of header.values()) {
    checksum += value;
  }
  Buffer.from(formatTarOctal(checksum, 8), 'utf8').copy(header, 148);

  return header;
}

function createTarRecord({
  name,
  content = '',
  type = '0',
} = {}) {
  const contentBuffer = Buffer.isBuffer(content)
    ? content
    : Buffer.from(String(content ?? ''), 'utf8');
  const paddingSize = (512 - (contentBuffer.length % 512)) % 512;

  return Buffer.concat([
    createTarHeader({
      name,
      size: contentBuffer.length,
      type,
    }),
    contentBuffer,
    Buffer.alloc(paddingSize, 0),
  ]);
}

function writeTarGzArchive(archivePath, records) {
  mkdirSync(path.dirname(archivePath), { recursive: true });
  writeFileSync(
    archivePath,
    gzipSync(Buffer.concat([
      ...records,
      Buffer.alloc(1024, 0),
    ])),
  );
}

function writeSyntheticServerRuntime({
  serverTargetDir,
  targetTriple,
  binaryName,
  webDistDir,
  envExamplePath,
} = {}) {
  const serverBinaryPath = path.join(serverTargetDir, targetTriple, 'release', binaryName);
  mkdirSync(path.dirname(serverBinaryPath), { recursive: true });
  mkdirSync(path.join(webDistDir, 'assets'), { recursive: true });
  writeFileSync(serverBinaryPath, 'synthetic binary\n', 'utf8');
  writeFileSync(path.join(webDistDir, 'index.html'), '<html><body>synthetic web</body></html>\n', 'utf8');
  writeFileSync(path.join(webDistDir, 'assets', 'index.js'), 'console.log("synthetic");\n', 'utf8');
  writeFileSync(
    envExamplePath,
    'CLAW_SERVER_HOST=127.0.0.1\nCLAW_SERVER_PORT=18797\nCLAW_SERVER_WEB_DIST=../sdkwork-agentstudio-pc-web/dist\n',
    'utf8',
  );
}

test('server bundle smoke validates packaged server bundles and writes runtime-backed evidence', async () => {
  const smokePath = path.join(rootDir, 'scripts', 'release', 'smoke-server-release-assets.mjs');
  assert.equal(existsSync(smokePath), true, 'missing scripts/release/smoke-server-release-assets.mjs');

  const smoke = await import(pathToFileURL(smokePath).href);
  assert.equal(typeof smoke.parseArgs, 'function');
  assert.equal(typeof smoke.smokeServerReleaseAssets, 'function');

  const tempRoot = mkdtempSync(path.join(os.tmpdir(), 'agentstudio-server-smoke-'));
  const releaseAssetsDir = path.join(tempRoot, 'release-assets');
  const serverDir = path.join(releaseAssetsDir, 'server', 'linux', 'x64');
  const archiveRelativePath = 'server/linux/x64/agent-studio-server-release-2026-04-06-01-linux-x64.tar.gz';
  const archivePath = path.join(releaseAssetsDir, archiveRelativePath);
  const manifestPath = path.join(serverDir, 'release-asset-manifest.json');
  const extractedBundleRoot = path.join(tempRoot, 'extracted', 'agent-studio-server-release-2026-04-06-01-linux-x64');
  let stopped = false;

  try {
    mkdirSync(serverDir, { recursive: true });
    writeFileSync(archivePath, 'synthetic server archive', 'utf8');
    writeFileSync(
      manifestPath,
      `${JSON.stringify({
        profileId: 'agent-studio',
        releaseTag: 'release-2026-04-06-01',
        platform: 'linux',
        arch: 'x64',
        artifacts: [
          {
            name: 'agent-studio-server-release-2026-04-06-01-linux-x64.tar.gz',
            relativePath: archiveRelativePath,
            family: 'server',
            platform: 'linux',
            arch: 'x64',
            kind: 'archive',
            sha256: 'placeholder',
            size: 24,
          },
        ],
      }, null, 2)}\n`,
      'utf8',
    );

    const result = await smoke.smokeServerReleaseAssets({
      releaseAssetsDir,
      platform: 'linux',
      arch: 'x64',
      target: 'x86_64-unknown-linux-gnu',
      extractServerArchiveFn: async ({ archivePath: inputArchivePath, extractDir }) => {
        assert.equal(inputArchivePath.replaceAll('\\', '/'), archivePath.replaceAll('\\', '/'));
        assert.match(extractDir.replaceAll('\\', '/'), /agentstudio-server-smoke-/);
        mkdirSync(path.join(extractedBundleRoot, 'bin'), { recursive: true });
        writeFileSync(path.join(extractedBundleRoot, 'start-agentstudio-server.sh'), '#!/usr/bin/env sh\n', 'utf8');
        writeFileSync(path.join(extractedBundleRoot, 'bin', 'agentstudio-server'), 'binary\n', 'utf8');
        return extractedBundleRoot;
      },
      launchServerBundleFn: async ({ bundleRoot, platform, port }) => {
        assert.equal(bundleRoot.replaceAll('\\', '/'), extractedBundleRoot.replaceAll('\\', '/'));
        assert.equal(platform, 'linux');
        assert.equal(typeof port, 'number');
        return {
          baseUrl: `http://127.0.0.1:${port}`,
          launcherRelativePath: 'bin/agentstudio-server',
          async stop() {
            stopped = true;
          },
        };
      },
      probeEndpointFn: async (request) => {
        if (request.path === '/claw/health/ready') {
          return {
            statusCode: 200,
            body: '{"status":"ready"}',
          };
        }
        if (request.path === '/') {
          return {
            statusCode: 200,
            body: '<html><body>Agent Studio</body></html>',
          };
        }

        return {
          statusCode: 404,
          body: 'not-found',
        };
      },
      fetchJsonFn: async (request) => {
        assert.equal(request.path, '/claw/manage/v1/host-endpoints');
        return {
          statusCode: 200,
          json: [
            {
              id: 'manage-http',
              kind: 'manage',
              baseUrl: 'http://127.0.0.1:19797',
            },
          ],
        };
      },
      resolveAvailablePortFn: async () => 19797,
    });

    assert.equal(stopped, true);
    assert.equal(result.platform, 'linux');
    assert.equal(result.arch, 'x64');
    assert.equal(result.target, 'x86_64-unknown-linux-gnu');
    assert.equal(result.report.report.status, 'passed');
    assert.equal(result.report.report.smokeKind, 'bundle-runtime');
    assert.equal(result.report.report.runtimeBaseUrl, 'http://127.0.0.1:19797');
    assert.equal(result.report.report.launcherRelativePath, 'bin/agentstudio-server');
    assert.deepEqual(result.report.report.artifactRelativePaths, [archiveRelativePath]);
    assert.deepEqual(
      result.report.report.checks.map((check) => check.id),
      ['health-ready', 'host-endpoints', 'browser-shell'],
    );
    assert.equal(existsSync(result.report.reportPath), true);
    assert.equal(
      JSON.parse(readFileSync(result.report.reportPath, 'utf8')).status,
      'passed',
    );
  } finally {
    rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('server bundle smoke can extract Windows zip bundles produced by the release packager', async () => {
  const packagerPath = path.join(rootDir, 'scripts', 'release', 'package-release-assets.mjs');
  const smokePath = path.join(rootDir, 'scripts', 'release', 'smoke-server-release-assets.mjs');
  const packager = await import(pathToFileURL(packagerPath).href);
  const smoke = await import(pathToFileURL(smokePath).href);

  const tempRoot = mkdtempSync(path.join(os.tmpdir(), 'agentstudio-server-windows-smoke-'));
  const outputDir = path.join(tempRoot, 'release-assets');
  const serverTargetDir = path.join(tempRoot, 'server-target');
  const webDistDir = path.join(tempRoot, 'web-dist');
  const envExamplePath = path.join(tempRoot, '.env.example');
  const releaseTag = 'release-2026-04-10-171';

  try {
    writeSyntheticServerRuntime({
      serverTargetDir,
      targetTriple: 'x86_64-pc-windows-msvc',
      binaryName: 'agentstudio-server.exe',
      webDistDir,
      envExamplePath,
    });

    packager.packageServerAssets({
      releaseTag,
      platform: 'windows',
      arch: 'x64',
      target: 'x86_64-pc-windows-msvc',
      outputDir,
      serverBuildTargetDir: serverTargetDir,
      serverWebDistDir: webDistDir,
      serverEnvPath: envExamplePath,
    });

    const archivePath = path.join(
      outputDir,
      'server',
      'windows',
      'x64',
      `agent-studio-server-${releaseTag}-windows-x64.zip`,
    );
    const manifestPath = path.join(
      outputDir,
      'server',
      'windows',
      'x64',
      'release-asset-manifest.json',
    );
    const bundleRoot = await smoke.extractServerArchive({
      archivePath,
      extractDir: path.join(tempRoot, 'extract'),
    });

    assert.equal(existsSync(archivePath), true, `missing expected server archive ${archivePath}`);
    assert.equal(existsSync(path.join(bundleRoot, 'bin', 'agentstudio-server.exe')), true);
    assert.equal(existsSync(path.join(bundleRoot, 'start-agentstudio-server.cmd')), true);
    assert.equal(existsSync(path.join(bundleRoot, 'web', 'dist', 'index.html')), true);

    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
    assert.equal(manifest.platform, 'windows');
    assert.equal(manifest.arch, 'x64');
    assert.equal(
      manifest.artifacts[0].relativePath,
      `server/windows/x64/agent-studio-server-${releaseTag}-windows-x64.zip`,
    );
  } finally {
    rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('server bundle smoke rejects unsafe tar entries before extraction', async () => {
  const smokePath = path.join(rootDir, 'scripts', 'release', 'smoke-server-release-assets.mjs');
  const smoke = await import(pathToFileURL(smokePath).href);

  const tempRoot = mkdtempSync(path.join(os.tmpdir(), 'agentstudio-server-unsafe-tar-smoke-'));
  const archivePath = path.join(tempRoot, 'agent-studio-server-unsafe-linux-x64.tar.gz');
  const extractDir = path.join(tempRoot, 'extract');

  try {
    writeTarGzArchive(archivePath, [
      createTarRecord({
        name: '../escape.txt',
        content: 'escape\n',
      }),
    ]);

    await assert.rejects(
      () => smoke.extractServerArchive({
        archivePath,
        extractDir,
      }),
      /unsafe parent traversal path/i,
    );
    assert.equal(existsSync(path.join(tempRoot, 'escape.txt')), false);
  } finally {
    rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('server bundle smoke rejects symlink tar entries before extraction', async () => {
  const smokePath = path.join(rootDir, 'scripts', 'release', 'smoke-server-release-assets.mjs');
  const smoke = await import(pathToFileURL(smokePath).href);

  const tempRoot = mkdtempSync(path.join(os.tmpdir(), 'agentstudio-server-symlink-tar-smoke-'));
  const archivePath = path.join(tempRoot, 'agent-studio-server-symlink-linux-x64.tar.gz');
  const extractDir = path.join(tempRoot, 'extract');

  try {
    writeTarGzArchive(archivePath, [
      createTarRecord({
        name: 'agent-studio-server/bin/agentstudio-server-link',
        content: '/usr/bin/env',
        type: '2',
      }),
    ]);

    await assert.rejects(
      () => smoke.extractServerArchive({
        archivePath,
        extractDir,
      }),
      /unsupported archive entry type/i,
    );
  } finally {
    rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('server bundle smoke rejects duplicate normalized zip entries before extraction', async () => {
  const smokePath = path.join(rootDir, 'scripts', 'release', 'smoke-server-release-assets.mjs');
  const smoke = await import(pathToFileURL(smokePath).href);

  const tempRoot = mkdtempSync(path.join(os.tmpdir(), 'agentstudio-server-duplicate-zip-smoke-'));
  const archivePath = path.join(tempRoot, 'agent-studio-server-duplicate-windows-x64.zip');
  const extractDir = path.join(tempRoot, 'extract');

  try {
    mkdirSync(path.dirname(archivePath), { recursive: true });
    writeFileSync(
      archivePath,
      createStoredZipArchive([
        {
          name: 'agent-studio-server/bin/agentstudio-server.exe',
          content: 'first\n',
        },
        {
          name: 'agent-studio-server\\bin\\agentstudio-server.exe',
          content: 'second\n',
        },
      ]),
    );

    await assert.rejects(
      () => smoke.extractServerArchive({
        archivePath,
        extractDir,
      }),
      /duplicate archive entry/i,
    );
  } finally {
    rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('server bundle smoke rejects symlink zip entries before extraction', async () => {
  const smokePath = path.join(rootDir, 'scripts', 'release', 'smoke-server-release-assets.mjs');
  const smoke = await import(pathToFileURL(smokePath).href);

  const tempRoot = mkdtempSync(path.join(os.tmpdir(), 'agentstudio-server-symlink-zip-smoke-'));
  const archivePath = path.join(tempRoot, 'agent-studio-server-symlink-windows-x64.zip');
  const extractDir = path.join(tempRoot, 'extract');

  try {
    mkdirSync(path.dirname(archivePath), { recursive: true });
    writeFileSync(
      archivePath,
      createStoredZipArchive([
        {
          name: 'agent-studio-server/bin/agentstudio-server-link',
          content: 'bin/agentstudio-server.exe',
          externalAttributes: 0o120777 << 16,
        },
      ]),
    );

    await assert.rejects(
      () => smoke.extractServerArchive({
        archivePath,
        extractDir,
      }),
      /unsupported archive entry type/i,
    );
  } finally {
    rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('server bundle smoke stops Windows launcher trees with taskkill before cleanup', async () => {
  const smokePath = path.join(rootDir, 'scripts', 'release', 'smoke-server-release-assets.mjs');
  const smoke = await import(pathToFileURL(smokePath).href);

  assert.equal(typeof smoke.stopChildProcess, 'function');

  const taskkillCalls = [];
  const child = {
    pid: 4242,
    exitCode: null,
    signalCode: null,
    kill() {
      throw new Error('windows cleanup should not fall back to child.kill before taskkill');
    },
  };

  await smoke.stopChildProcess(child, {
    platform: 'win32',
    runTaskkillFn(command, args, options) {
      taskkillCalls.push({ command, args, options });
      child.exitCode = 0;
      return {
        status: 0,
        error: null,
      };
    },
    waitForExitFn: async () => {},
  });

  assert.deepEqual(taskkillCalls, [
    {
      command: 'taskkill',
      args: ['/PID', '4242', '/T', '/F'],
      options: {
        encoding: 'utf8',
        shell: false,
        windowsHide: true,
      },
    },
  ]);
});

test('server bundle smoke falls back to direct child termination when taskkill is blocked', async () => {
  const smokePath = path.join(rootDir, 'scripts', 'release', 'smoke-server-release-assets.mjs');
  const smoke = await import(pathToFileURL(smokePath).href);

  const killCalls = [];
  const child = {
    pid: 5252,
    exitCode: null,
    signalCode: null,
    kill(signal) {
      killCalls.push(signal ?? 'default');
      this.exitCode = 0;
    },
  };

  await smoke.stopChildProcess(child, {
    platform: 'win32',
    runTaskkillFn() {
      const error = new Error('spawnSync taskkill EPERM');
      error.code = 'EPERM';
      return {
        status: null,
        error,
      };
    },
    waitForExitFn: async () => {},
  });

  assert.deepEqual(killCalls, ['default']);
});

test('server bundle smoke retries transient busy cleanup before failing', async () => {
  const smokePath = path.join(rootDir, 'scripts', 'release', 'smoke-server-release-assets.mjs');
  const smoke = await import(pathToFileURL(smokePath).href);

  assert.equal(typeof smoke.removeDirectoryWithRetries, 'function');

  let attempts = 0;
  await smoke.removeDirectoryWithRetries('C:/synthetic/agentstudio-server-smoke', {
    retries: 3,
    delayMs: 1,
    delayFn: async () => {},
    rmDirFn() {
      attempts += 1;
      if (attempts < 3) {
        const error = new Error('resource busy');
        error.code = 'EBUSY';
        throw error;
      }
    },
  });

  assert.equal(attempts, 3);
});

test('server bundle smoke launches the bundled server binary directly on Windows', async () => {
  const smokePath = path.join(rootDir, 'scripts', 'release', 'smoke-server-release-assets.mjs');
  const smoke = await import(pathToFileURL(smokePath).href);

  const spawnCalls = [];
  const stopCalls = [];
  const tempRoot = mkdtempSync(path.join(os.tmpdir(), 'agentstudio-server-launch-'));
  const bundleRoot = path.join(tempRoot, 'server-bundle');
  const child = {
    pid: 7373,
    exitCode: 0,
    signalCode: null,
  };

  try {
    mkdirSync(bundleRoot, { recursive: true });

    const runtime = await smoke.launchServerBundle({
      bundleRoot,
      platform: 'windows',
      port: 19897,
      spawnFn(command, args, options) {
        spawnCalls.push({ command, args, options });
        return child;
      },
      stopChildProcessFn: async (receivedChild, options) => {
        stopCalls.push({ receivedChild, options });
      },
      existsSyncFn(targetPath) {
        return targetPath === path.join(bundleRoot, 'bin', 'agentstudio-server.exe');
      },
    });

    assert.equal(runtime.baseUrl, 'http://127.0.0.1:19897');
    assert.equal(runtime.launcherRelativePath, 'bin/agentstudio-server.exe');
    assert.deepEqual(spawnCalls, [
      {
        command: path.join(bundleRoot, 'bin', 'agentstudio-server.exe'),
        args: [],
        options: {
          cwd: bundleRoot,
          env: {
            ...process.env,
            CLAW_SERVER_HOST: '127.0.0.1',
            CLAW_SERVER_PORT: '19897',
          },
          stdio: 'ignore',
          windowsHide: true,
        },
      },
    ]);

    await runtime.stop();
    assert.deepEqual(stopCalls, [
      {
        receivedChild: child,
        options: {
          platform: 'windows',
        },
      },
    ]);
  } finally {
    rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('server bundle smoke launches the bundled server binary directly on Linux', async () => {
  const smokePath = path.join(rootDir, 'scripts', 'release', 'smoke-server-release-assets.mjs');
  const smoke = await import(pathToFileURL(smokePath).href);

  const spawnCalls = [];
  const stopCalls = [];
  const tempRoot = mkdtempSync(path.join(os.tmpdir(), 'agentstudio-server-launch-linux-'));
  const bundleRoot = path.join(tempRoot, 'server-bundle');
  const child = {
    pid: 8484,
    exitCode: 0,
    signalCode: null,
  };

  try {
    mkdirSync(bundleRoot, { recursive: true });

    const runtime = await smoke.launchServerBundle({
      bundleRoot,
      platform: 'linux',
      port: 20897,
      spawnFn(command, args, options) {
        spawnCalls.push({ command, args, options });
        return child;
      },
      stopChildProcessFn: async (receivedChild, options) => {
        stopCalls.push({ receivedChild, options });
      },
      existsSyncFn(targetPath) {
        return targetPath === path.join(bundleRoot, 'bin', 'agentstudio-server');
      },
    });

    assert.equal(runtime.baseUrl, 'http://127.0.0.1:20897');
    assert.equal(runtime.launcherRelativePath, 'bin/agentstudio-server');
    assert.deepEqual(spawnCalls, [
      {
        command: path.join(bundleRoot, 'bin', 'agentstudio-server'),
        args: [],
        options: {
          cwd: bundleRoot,
          env: {
            ...process.env,
            CLAW_SERVER_HOST: '127.0.0.1',
            CLAW_SERVER_PORT: '20897',
          },
          stdio: 'ignore',
        },
      },
    ]);

    await runtime.stop();
    assert.deepEqual(stopCalls, [
      {
        receivedChild: child,
        options: {
          platform: 'linux',
        },
      },
    ]);
  } finally {
    rmSync(tempRoot, { recursive: true, force: true });
  }
});
