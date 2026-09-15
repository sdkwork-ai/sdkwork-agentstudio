// WORKSPACE-PATH:allow-fixture: fixtures name a foreign checkout root, drive, or home directory to exercise path handling, so the literal is the value under assertion rather than a binding this build resolves
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { pathToFileURL } from 'node:url';
import { gunzipSync, gzipSync } from 'node:zlib';

const rootDir = path.resolve(import.meta.dirname, '..');

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
    'CLAW_SERVER_HOST=0.0.0.0\nCLAW_SERVER_PORT=18797\nCLAW_SERVER_WEB_DIST=../sdkwork-agentstudio-pc-web/dist\n',
    'utf8',
  );
}

function parseTarOctal(buffer) {
  const trimmed = buffer.toString('utf8').replace(/\0.*$/, '').trim();
  if (!trimmed) {
    return 0;
  }

  return Number.parseInt(trimmed, 8);
}

function formatTarOctal(value, width) {
  return `${value.toString(8).padStart(width - 2, '0')}\0 `;
}

function createTarHeader({
  name,
  size,
  type = '0',
  prefix = '',
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
  Buffer.from(String(prefix ?? '').slice(0, 155), 'utf8').copy(header, 345);

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
  prefix = '',
} = {}) {
  const contentBuffer = Buffer.isBuffer(content)
    ? content
    : Buffer.from(String(content ?? ''), 'utf8');
  const header = createTarHeader({
    name,
    size: contentBuffer.length,
    type,
    prefix,
  });
  const paddingSize = (512 - (contentBuffer.length % 512)) % 512;
  return Buffer.concat([
    header,
    contentBuffer,
    Buffer.alloc(paddingSize, 0),
  ]);
}

function buildPaxField(key, value) {
  const body = `${key}=${value}\n`;
  let length = body.length + 3;

  while (true) {
    const record = `${length} ${body}`;
    if (record.length === length) {
      return record;
    }
    length = record.length;
  }
}

function createTarGzArchiveBuffer(records = []) {
  return gzipSync(Buffer.concat([
    ...records,
    Buffer.alloc(1024, 0),
  ]));
}

function parsePaxHeaders(content) {
  const headers = new Map();
  const source = content.toString('utf8');
  let offset = 0;

  while (offset < source.length) {
    const separatorIndex = source.indexOf(' ', offset);
    if (separatorIndex === -1) {
      break;
    }

    const length = Number.parseInt(source.slice(offset, separatorIndex), 10);
    if (!Number.isFinite(length) || length <= 0) {
      break;
    }

    const record = source.slice(separatorIndex + 1, offset + length - 1);
    const equalsIndex = record.indexOf('=');
    if (equalsIndex !== -1) {
      headers.set(
        record.slice(0, equalsIndex),
        record.slice(equalsIndex + 1),
      );
    }

    offset += length;
  }

  return headers;
}

function readTarGzEntries(archivePath) {
  const archiveBuffer = gunzipSync(readFileSync(archivePath));
  const entries = new Map();
  let offset = 0;
  let pendingPathOverride = '';

  while (offset + 512 <= archiveBuffer.length) {
    const header = archiveBuffer.subarray(offset, offset + 512);
    const isEmptyHeader = header.every((value) => value === 0);
    if (isEmptyHeader) {
      break;
    }

    const name = header.subarray(0, 100).toString('utf8').replace(/\0.*$/, '');
    const prefix = header.subarray(345, 500).toString('utf8').replace(/\0.*$/, '');
    const fullName = prefix ? `${prefix}/${name}` : name;
    const size = parseTarOctal(header.subarray(124, 136));
    const typeFlag = header.subarray(156, 157).toString('utf8').replace(/\0.*$/, '');
    const contentStart = offset + 512;
    const contentEnd = contentStart + size;
    const content = archiveBuffer.subarray(contentStart, contentEnd);

    if (typeFlag === 'x') {
      pendingPathOverride = parsePaxHeaders(content).get('path') ?? pendingPathOverride;
      offset = contentStart + Math.ceil(size / 512) * 512;
      continue;
    }
    if (typeFlag === 'L') {
      pendingPathOverride = content.toString('utf8').replace(/\0.*$/, '');
      offset = contentStart + Math.ceil(size / 512) * 512;
      continue;
    }

    entries.set(pendingPathOverride || fullName, {
      type: typeFlag || '0',
      content,
    });
    pendingPathOverride = '';

    offset = contentStart + Math.ceil(size / 512) * 512;
  }

  return entries;
}

test('readTarGzEntries preserves PAX long-path metadata for nested release bundle files', () => {
  const tempRoot = mkdtempSync(path.join(os.tmpdir(), 'claw-release-tar-pax-'));
  const archivePath = path.join(tempRoot, 'bundle.tar.gz');
  const longPath = 'agent-studio-container-bundle-release-2026-04-03-03-linux-x64-nvidia-cuda/deployments/docker/docker-compose.nvidia-cuda.yml';

  try {
    writeFileSync(
      archivePath,
      createTarGzArchiveBuffer([
        createTarRecord({
          name: 'PaxHeaders/long-path',
          type: 'x',
          content: buildPaxField('path', longPath),
        }),
        createTarRecord({
          name: 'docker-compose.nvidia-cuda.yml',
          content: 'services:\n  agent-studio:\n    image: claw\n',
        }),
      ]),
    );

    const entries = readTarGzEntries(archivePath);
    assert.equal(entries.has(longPath), true);
    assert.match(
      entries.get(longPath).content.toString('utf8'),
      /agent-studio/,
    );
  } finally {
    rmSync(tempRoot, { recursive: true, force: true });
  }
});

function normalizeArchivePath(pathValue) {
  const normalized = String(pathValue ?? '').replaceAll('\\', '/');
  const segments = [];
  for (const segment of normalized.split('/')) {
    if (!segment || segment === '.') {
      continue;
    }
    if (segment === '..') {
      segments.pop();
      continue;
    }
    segments.push(segment);
  }
  return segments.join('/');
}

function resolveArchiveRelativePath(basePath, relativePath) {
  return normalizeArchivePath(`${basePath}/${relativePath}`);
}

function readSingleLineYamlValue(source, key) {
  const match = source.match(new RegExp(`^\\s*${key}:\\s+([^\\r\\n]+)`, 'm'));
  assert.notEqual(match, null, `missing YAML key "${key}"`);
  return match[1].trim();
}

function readSingleListYamlValue(source, key) {
  const match = source.match(new RegExp(`^\\s*${key}:\\s*[\\r\\n]+\\s*-\\s+([^\\r\\n]+)`, 'm'));
  assert.notEqual(match, null, `missing YAML list entry for "${key}"`);
  return match[1].trim();
}

test('release asset packager archives macOS app bundles into release-safe zip assets', async () => {
  const packagerPath = path.join(rootDir, 'scripts', 'release', 'package-release-assets.mjs');
  const packager = await import(pathToFileURL(packagerPath).href);

  assert.equal(typeof packager.packageDesktopAssets, 'function');

  const tempRoot = mkdtempSync(path.join(os.tmpdir(), 'claw-release-macos-app-'));
  const targetDir = path.join(tempRoot, 'target');
  const bundleRoot = path.join(targetDir, 'x86_64-apple-darwin', 'release', 'bundle', 'macos');
  const appDir = path.join(bundleRoot, 'Agent Studio.app');
  const outputDir = path.join(tempRoot, 'release-assets');
  const tauriConfigPath = path.join(tempRoot, 'tauri.conf.json');

  try {
    mkdirSync(path.join(appDir, 'Contents', 'MacOS'), { recursive: true });
    writeFileSync(path.join(appDir, 'Contents', 'Info.plist'), '<plist version="1.0"></plist>\n');
    writeFileSync(path.join(appDir, 'Contents', 'MacOS', 'agent-studio'), '#!/bin/sh\n');
    writeFileSync(
      tauriConfigPath,
      `${JSON.stringify({ productName: 'Agent Studio', version: '0.1.0' }, null, 2)}\n`,
      'utf8',
    );

    packager.packageDesktopAssets({
      platform: 'macos',
      arch: 'x64',
      target: 'x86_64-apple-darwin',
      outputDir,
      targetDir,
      tauriConfigPath,
    });

    const archivePath = path.join(
      outputDir,
      'desktop',
      'macos',
      'x64',
      'macos',
      'Agent Studio_0.1.0_x64.app.zip',
    );
    const checksumPath = `${archivePath}.sha256.txt`;
    const manifestPath = path.join(
      outputDir,
      'desktop',
      'macos',
      'x64',
      'release-asset-manifest.json',
    );

    assert.equal(existsSync(archivePath), true, `missing expected archive ${archivePath}`);
    assert.equal(existsSync(checksumPath), true, `missing expected checksum ${checksumPath}`);
    assert.match(
      readFileSync(checksumPath, 'utf8'),
      /Agent Studio_0\.1\.0_x64\.app\.zip/,
    );
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
    assert.equal(manifest.artifacts.length, 1);
    assert.equal(manifest.artifacts[0].family, 'desktop');
    assert.equal(
      manifest.artifacts[0].relativePath,
      'desktop/macos/x64/macos/Agent Studio_0.1.0_x64.app.zip',
    );
  } finally {
    rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('release asset packager collects Windows desktop installers from the targeted bundle root', async () => {
  const packagerPath = path.join(rootDir, 'scripts', 'release', 'package-release-assets.mjs');
  const packager = await import(pathToFileURL(packagerPath).href);

  const tempRoot = mkdtempSync(path.join(os.tmpdir(), 'claw-release-windows-desktop-'));
  const targetDir = path.join(tempRoot, 'target');
  const bundleRoot = path.join(targetDir, 'x86_64-pc-windows-msvc', 'release', 'bundle', 'nsis');
  const outputDir = path.join(tempRoot, 'release-assets');

  try {
    mkdirSync(bundleRoot, { recursive: true });
    writeFileSync(
      path.join(bundleRoot, 'Agent Studio_0.1.0_x64-setup.exe'),
      'synthetic desktop installer\n',
      'utf8',
    );

    packager.packageDesktopAssets({
      platform: 'windows',
      arch: 'x64',
      target: 'x86_64-pc-windows-msvc',
      outputDir,
      targetDir,
    });

    const installerPath = path.join(
      outputDir,
      'desktop',
      'windows',
      'x64',
      'nsis',
      'Agent Studio_0.1.0_x64-setup.exe',
    );
    const manifestPath = path.join(
      outputDir,
      'desktop',
      'windows',
      'x64',
      'release-asset-manifest.json',
    );

    assert.equal(existsSync(installerPath), true, `missing expected installer ${installerPath}`);
    assert.equal(existsSync(`${installerPath}.sha256.txt`), true, 'missing expected installer checksum');
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
    assert.equal(manifest.artifacts.length, 1);
    assert.equal(manifest.artifacts[0].family, 'desktop');
    assert.equal(manifest.artifacts[0].platform, 'windows');
    assert.equal(manifest.artifacts[0].kind, 'installer');
    assert.equal(manifest.packageProfileId, 'openclaw-only');
    assert.deepEqual(manifest.includedKernelIds, ['openclaw']);
    assert.deepEqual(manifest.defaultEnabledKernelIds, ['openclaw']);
    assert.deepEqual(manifest.requiredExternalRuntimes, ['nodejs']);
    assert.deepEqual(manifest.optionalExternalRuntimes, []);
    assert.deepEqual(manifest.launcherKinds, ['externalLocal']);
    assert.deepEqual(manifest.kernelPlatformSupport, {
      openclaw: {
        windows: 'native',
        macos: 'native',
        linux: 'native',
      },
    });
    assert.deepEqual(
      manifest.kernelInstallContracts,
      {
        openclaw: {
          version: 2,
          platform: 'windows',
          delivery: 'archive-only-resources',
          installMode: 'first-launch-archive-extract',
          bundledResourceRoot: 'resources/openclaw/',
          runtimeArchive: 'resources/openclaw/runtime.zip',
          sourceConfigPath: 'packages/sdkwork-agentstudio-pc-desktop/src-tauri/tauri.windows.conf.json',
          requiredExternalRuntimes: ['nodejs'],
        },
      },
    );
    assert.equal(
      manifest.artifacts[0].relativePath,
      'desktop/windows/x64/nsis/Agent Studio_0.1.0_x64-setup.exe',
    );
  } finally {
    rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('release asset packager records explicit dual-kernel package profile metadata beside desktop package manifests', async () => {
  const packagerPath = path.join(rootDir, 'scripts', 'release', 'package-release-assets.mjs');
  const packager = await import(pathToFileURL(packagerPath).href);

  const tempRoot = mkdtempSync(path.join(os.tmpdir(), 'claw-release-windows-dual-kernel-'));
  const targetDir = path.join(tempRoot, 'target');
  const bundleRoot = path.join(targetDir, 'x86_64-pc-windows-msvc', 'release', 'bundle', 'nsis');
  const outputDir = path.join(tempRoot, 'release-assets');

  try {
    mkdirSync(bundleRoot, { recursive: true });
    writeFileSync(
      path.join(bundleRoot, 'Agent Studio_0.1.0_x64-setup.exe'),
      'synthetic desktop installer\n',
      'utf8',
    );

    packager.packageDesktopAssets({
      platform: 'windows',
      arch: 'x64',
      target: 'x86_64-pc-windows-msvc',
      outputDir,
      targetDir,
      packageProfileId: 'dual-kernel',
    });

    const manifestPath = path.join(
      outputDir,
      'desktop',
      'windows',
      'x64',
      'release-asset-manifest.json',
    );
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));

    assert.equal(manifest.packageProfileId, 'dual-kernel');
    assert.deepEqual(manifest.includedKernelIds, ['openclaw', 'hermes']);
    assert.deepEqual(manifest.defaultEnabledKernelIds, ['openclaw', 'hermes']);
    assert.deepEqual(manifest.requiredExternalRuntimes, ['nodejs', 'python', 'uv']);
    assert.deepEqual(manifest.optionalExternalRuntimes, []);
    assert.deepEqual(manifest.launcherKinds, ['externalLocal', 'externalWslOrRemote']);
    assert.deepEqual(manifest.kernelPlatformSupport, {
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
    });
  } finally {
    rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('release asset packager records Linux OpenClaw install contract metadata beside desktop package manifests', async () => {
  const packagerPath = path.join(rootDir, 'scripts', 'release', 'package-release-assets.mjs');
  const packager = await import(pathToFileURL(packagerPath).href);

  const tempRoot = mkdtempSync(path.join(os.tmpdir(), 'claw-release-linux-desktop-'));
  const targetDir = path.join(tempRoot, 'target');
  const debBundleRoot = path.join(targetDir, 'x86_64-unknown-linux-gnu', 'release', 'bundle', 'deb');
  const rpmBundleRoot = path.join(targetDir, 'x86_64-unknown-linux-gnu', 'release', 'bundle', 'rpm');
  const outputDir = path.join(tempRoot, 'release-assets');

  try {
    mkdirSync(debBundleRoot, { recursive: true });
    mkdirSync(rpmBundleRoot, { recursive: true });
    writeFileSync(
      path.join(debBundleRoot, 'agent-studio_0.1.0_amd64.deb'),
      'synthetic deb installer\n',
      'utf8',
    );
    writeFileSync(
      path.join(rpmBundleRoot, 'agent-studio-0.1.0-1.x86_64.rpm'),
      'synthetic rpm installer\n',
      'utf8',
    );

    packager.packageDesktopAssets({
      platform: 'linux',
      arch: 'x64',
      target: 'x86_64-unknown-linux-gnu',
      outputDir,
      targetDir,
    });

    const manifestPath = path.join(
      outputDir,
      'desktop',
      'linux',
      'x64',
      'release-asset-manifest.json',
    );
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));

    assert.deepEqual(
      manifest.kernelInstallContracts,
      {
        openclaw: {
          version: 2,
          platform: 'linux',
          delivery: 'archive-only-resources',
          installMode: 'first-launch-archive-extract',
          bundledResourceRoot: 'resources/openclaw/',
          runtimeArchive: 'resources/openclaw/runtime.zip',
          sourceConfigPath: 'packages/sdkwork-agentstudio-pc-desktop/src-tauri/tauri.linux.conf.json',
          requiredExternalRuntimes: ['nodejs'],
          packageFormats: ['deb', 'rpm'],
        },
      },
    );
  } finally {
    rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('release asset packager records macOS OpenClaw staged-layout contract metadata beside desktop package manifests', async () => {
  const packagerPath = path.join(rootDir, 'scripts', 'release', 'package-release-assets.mjs');
  const packager = await import(pathToFileURL(packagerPath).href);

  const tempRoot = mkdtempSync(path.join(os.tmpdir(), 'claw-release-macos-contract-'));
  const targetDir = path.join(tempRoot, 'target');
  const dmgBundleRoot = path.join(targetDir, 'aarch64-apple-darwin', 'release', 'bundle', 'dmg');
  const macosBundleRoot = path.join(targetDir, 'aarch64-apple-darwin', 'release', 'bundle', 'macos');
  const appDir = path.join(macosBundleRoot, 'Agent Studio.app');
  const outputDir = path.join(tempRoot, 'release-assets');
  const tauriConfigPath = path.join(tempRoot, 'tauri.conf.json');

  try {
    mkdirSync(dmgBundleRoot, { recursive: true });
    mkdirSync(path.join(appDir, 'Contents', 'MacOS'), { recursive: true });
    writeFileSync(
      path.join(dmgBundleRoot, 'Agent Studio_0.1.0_aarch64.dmg'),
      'synthetic dmg installer\n',
      'utf8',
    );
    writeFileSync(path.join(appDir, 'Contents', 'Info.plist'), '<plist version="1.0"></plist>\n');
    writeFileSync(path.join(appDir, 'Contents', 'MacOS', 'agent-studio'), '#!/bin/sh\n');
    writeFileSync(
      tauriConfigPath,
      `${JSON.stringify({ productName: 'Agent Studio', version: '0.1.0' }, null, 2)}\n`,
      'utf8',
    );

    packager.packageDesktopAssets({
      platform: 'macos',
      arch: 'arm64',
      target: 'aarch64-apple-darwin',
      outputDir,
      targetDir,
      tauriConfigPath,
    });

    const manifestPath = path.join(
      outputDir,
      'desktop',
      'macos',
      'arm64',
      'release-asset-manifest.json',
    );
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));

    assert.deepEqual(
      manifest.kernelInstallContracts,
      {
        openclaw: {
          version: 2,
          platform: 'macos',
          delivery: 'archive-only-resources',
          installMode: 'preexpanded-managed-layout',
          bundledResourceRoot: 'resources/openclaw/',
          runtimeArchive: 'resources/openclaw/runtime.zip',
          sourceConfigPath: 'packages/sdkwork-agentstudio-pc-desktop/src-tauri/tauri.macos.conf.json',
          stagedInstallRootSource: 'generated/release/macos-install-root/',
          stagedInstallRootTarget: 'MacOS/',
          requiredExternalRuntimes: ['nodejs'],
        },
      },
    );
  } finally {
    rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('release asset packager removes stale Windows desktop output paths before copying fresh installers', async () => {
  const packagerPath = path.join(rootDir, 'scripts', 'release', 'package-release-assets.mjs');
  const packager = await import(pathToFileURL(packagerPath).href);

  const tempRoot = mkdtempSync(path.join(os.tmpdir(), 'claw-release-windows-desktop-stale-'));
  const targetDir = path.join(tempRoot, 'target');
  const bundleRoot = path.join(targetDir, 'x86_64-pc-windows-msvc', 'release', 'bundle', 'nsis');
  const outputDir = path.join(tempRoot, 'release-assets');
  const staleOutputDir = path.join(outputDir, 'desktop', 'windows', 'nsis');
  const staleInstallerPath = path.join(staleOutputDir, 'stale-desktop-installer.exe');

  try {
    mkdirSync(bundleRoot, { recursive: true });
    mkdirSync(staleOutputDir, { recursive: true });
    writeFileSync(staleInstallerPath, 'stale desktop installer\n', 'utf8');
    writeFileSync(
      path.join(bundleRoot, 'Agent Studio_0.1.0_x64-setup.exe'),
      'synthetic desktop installer\n',
      'utf8',
    );

    packager.packageDesktopAssets({
      platform: 'windows',
      arch: 'x64',
      target: 'x86_64-pc-windows-msvc',
      outputDir,
      targetDir,
    });

    assert.equal(
      existsSync(staleOutputDir),
      false,
      `expected stale desktop output directory to be removed: ${staleOutputDir}`,
    );
    assert.equal(
      existsSync(staleInstallerPath),
      false,
      `expected stale desktop installer to be removed: ${staleInstallerPath}`,
    );
  } finally {
    rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('release asset packager explains how to build missing desktop and server release prerequisites', async () => {
  const packagerPath = path.join(rootDir, 'scripts', 'release', 'package-release-assets.mjs');
  const packager = await import(pathToFileURL(packagerPath).href);

  const tempRoot = mkdtempSync(path.join(os.tmpdir(), 'claw-release-prereqs-'));
  const outputDir = path.join(tempRoot, 'release-assets');
  const targetDir = path.join(tempRoot, 'desktop-target');
  const serverTargetDir = path.join(tempRoot, 'server-target');
  const webDistDir = path.join(tempRoot, 'web-dist');
  const envExamplePath = path.join(tempRoot, '.env.example');

  try {
    mkdirSync(path.join(webDistDir, 'assets'), { recursive: true });
    writeFileSync(path.join(webDistDir, 'index.html'), '<html><body>synthetic web</body></html>\n', 'utf8');
    writeFileSync(path.join(webDistDir, 'assets', 'index.js'), 'console.log("synthetic");\n', 'utf8');
    writeFileSync(envExamplePath, 'CLAW_SERVER_PORT=18797\n', 'utf8');

    assert.throws(
      () => packager.packageDesktopAssets({
        platform: 'windows',
        arch: 'x64',
        target: 'x86_64-pc-windows-msvc',
        outputDir,
        targetDir,
      }),
      /Run "pnpm release:desktop" or "pnpm build:desktop" first/,
    );

    assert.throws(
      () => packager.packageContainerAssets({
        releaseTag: 'release-2026-04-04-01',
        platform: 'linux',
        arch: 'x64',
        target: 'x86_64-unknown-linux-gnu',
        accelerator: 'cpu',
        outputDir,
        serverBuildTargetDir: serverTargetDir,
        serverWebDistDir: webDistDir,
        serverEnvPath: envExamplePath,
      }),
      /pnpm build:server -- --target x86_64-unknown-linux-gnu/,
    );
  } finally {
    rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('server asset packager rejects shared release binaries when an explicit target triple is required', async () => {
  const packagerPath = path.join(rootDir, 'scripts', 'release', 'package-release-assets.mjs');
  const packager = await import(pathToFileURL(packagerPath).href);

  const tempRoot = mkdtempSync(path.join(os.tmpdir(), 'claw-release-explicit-target-'));
  const outputDir = path.join(tempRoot, 'release-assets');
  const serverTargetDir = path.join(tempRoot, 'server-target');
  const webDistDir = path.join(tempRoot, 'web-dist');
  const envExamplePath = path.join(tempRoot, '.env.example');

  try {
    writeSyntheticServerRuntime({
      serverTargetDir,
      targetTriple: '',
      binaryName: 'agentstudio-server',
      webDistDir,
      envExamplePath,
    });

    assert.throws(
      () => packager.packageServerAssets({
        releaseTag: 'release-2026-04-21-01',
        platform: 'linux',
        arch: 'x64',
        target: 'x86_64-unknown-linux-gnu',
        outputDir,
        serverBuildTargetDir: serverTargetDir,
        serverWebDistDir: webDistDir,
        serverEnvPath: envExamplePath,
      }),
      (error) => {
        assert.match(
          error.message,
          /Missing server binary output\./,
        );
        assert.match(
          error.message,
          /x86_64-unknown-linux-gnu[\\/]+release[\\/]+agentstudio-server/,
        );
        assert.doesNotMatch(
          error.message,
          /server-target[\\/]+release[\\/]+agentstudio-server/,
        );
        assert.match(
          error.message,
          /pnpm build:server -- --target x86_64-unknown-linux-gnu/,
        );
        return true;
      },
    );
  } finally {
    rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('release asset packager exposes desktop, web, server, container, and kubernetes packaging entrypoints', async () => {
  const packagerPath = path.join(rootDir, 'scripts', 'release', 'package-release-assets.mjs');
  const packager = await import(pathToFileURL(packagerPath).href);

  assert.equal(typeof packager.parseArgs, 'function');
  assert.equal(typeof packager.createTarArchivePlan, 'function');
  assert.equal(typeof packager.packageDesktopAssets, 'function');
  assert.equal(typeof packager.packageWebAssets, 'function');
  assert.equal(typeof packager.packageServerAssets, 'function');
  assert.equal(typeof packager.packageContainerAssets, 'function');
  assert.equal(typeof packager.packageKubernetesAssets, 'function');
  assert.equal(typeof packager.buildServerArchiveBaseName, 'function');
  assert.equal(typeof packager.buildDeploymentBundleBaseName, 'function');

  assert.equal(
    packager.buildServerArchiveBaseName({
      releaseTag: 'release-2026-04-03-01',
      platform: 'windows',
      arch: 'x64',
    }),
    'agent-studio-server-release-2026-04-03-01-windows-x64',
  );
  assert.equal(
    packager.buildDeploymentBundleBaseName({
      family: 'container',
      releaseTag: 'release-2026-04-03-01',
      platform: 'linux',
      arch: 'arm64',
      accelerator: 'cpu',
    }),
    'agent-studio-container-bundle-release-2026-04-03-01-linux-arm64-cpu',
  );
  assert.equal(
    packager.buildDeploymentBundleBaseName({
      family: 'kubernetes',
      releaseTag: 'release-2026-04-03-01',
      platform: 'linux',
      arch: 'x64',
      accelerator: 'nvidia-cuda',
    }),
    'agent-studio-kubernetes-bundle-release-2026-04-03-01-linux-x64-nvidia-cuda',
  );
  assert.throws(
    () => packager.parseArgs(['server', '--release-tag']),
    /Missing value for --release-tag/,
  );
  assert.throws(
    () => packager.parseArgs(['desktop', '--package-profile']),
    /Missing value for --package-profile/,
  );
});

test('release asset packager resolves tar archives without Windows cmd shell wrapping', async () => {
  const packagerPath = path.join(rootDir, 'scripts', 'release', 'package-release-assets.mjs');
  const packager = await import(pathToFileURL(packagerPath).href);

  const windowsPlan = packager.createTarArchivePlan({
    archivePath: 'C:\\release\\bundle.tar.gz',
    workingDirectory: 'D:\\workspace\\bundle-root',
    entryName: 'bundle',
    platform: 'win32',
  });
  const linuxPlan = packager.createTarArchivePlan({
    archivePath: '/tmp/bundle.tar.gz',
    workingDirectory: '/tmp/work',
    entryName: 'bundle',
    platform: 'linux',
  });

  assert.match(
    windowsPlan.command,
    /(?:^|[\\/])tar\.exe$/i,
  );
  assert.deepEqual(
    windowsPlan.args,
    ['-czf', 'C:\\release\\bundle.tar.gz', '-C', 'D:\\workspace\\bundle-root', 'bundle'],
  );
  assert.equal(windowsPlan.shell, false);

  assert.equal(linuxPlan.command, 'tar');
  assert.deepEqual(
    linuxPlan.args,
    ['-czf', '/tmp/bundle.tar.gz', '-C', '/tmp/work', 'bundle'],
  );
  assert.equal(linuxPlan.shell, false);
});

test('web asset packager archives built web and docs outputs with family metadata', async () => {
  const packagerPath = path.join(rootDir, 'scripts', 'release', 'package-release-assets.mjs');
  const packager = await import(pathToFileURL(packagerPath).href);

  const tempRoot = mkdtempSync(path.join(os.tmpdir(), 'claw-release-web-'));
  const outputDir = path.join(tempRoot, 'release-assets');
  const webBuildDir = path.join(tempRoot, 'web-dist');
  const docsBuildDir = path.join(tempRoot, 'docs-dist');
  const releaseTag = 'release-2026-04-03-06';

  try {
    mkdirSync(path.join(webBuildDir, 'assets'), { recursive: true });
    mkdirSync(path.join(docsBuildDir, 'guide'), { recursive: true });
    writeFileSync(path.join(webBuildDir, 'index.html'), '<html><body>web</body></html>\n', 'utf8');
    writeFileSync(path.join(webBuildDir, 'assets', 'index.js'), 'console.log("web");\n', 'utf8');
    writeFileSync(path.join(docsBuildDir, 'index.html'), '<html><body>docs</body></html>\n', 'utf8');
    writeFileSync(path.join(docsBuildDir, 'guide', 'intro.html'), '<html><body>guide</body></html>\n', 'utf8');

    packager.packageWebAssets({
      releaseTag,
      outputDir,
      webBuildDir,
      docsBuildDir,
    });

    const archivePath = path.join(
      outputDir,
      `agent-studio-web-assets-${releaseTag}.tar.gz`,
    );
    const manifestPath = path.join(outputDir, 'web', 'release-asset-manifest.json');
    const archiveEntries = readTarGzEntries(archivePath);
    const bundleRoot = `agent-studio-web-assets-${releaseTag}`;

    assert.equal(existsSync(archivePath), true, `missing expected web archive ${archivePath}`);
    assert.equal(existsSync(`${archivePath}.sha256.txt`), true, 'missing expected web checksum');
    assert.equal(archiveEntries.has(`${bundleRoot}/web/dist/index.html`), true);
    assert.equal(archiveEntries.has(`${bundleRoot}/docs/dist/index.html`), true);
    assert.equal(archiveEntries.has(`${bundleRoot}/docs/dist/guide/intro.html`), true);

    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
    assert.equal(manifest.artifacts.length, 1);
    assert.equal(manifest.artifacts[0].family, 'web');
    assert.equal(manifest.artifacts[0].platform, 'web');
    assert.equal(manifest.artifacts[0].arch, 'any');
    assert.equal(
      manifest.artifacts[0].relativePath,
      `agent-studio-web-assets-${releaseTag}.tar.gz`,
    );
  } finally {
    rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('server asset packager bundles the embedded runtime, launchers, and manifest metadata', async () => {
  const packagerPath = path.join(rootDir, 'scripts', 'release', 'package-release-assets.mjs');
  const packager = await import(pathToFileURL(packagerPath).href);

  const tempRoot = mkdtempSync(path.join(os.tmpdir(), 'claw-release-server-'));
  const outputDir = path.join(tempRoot, 'release-assets');
  const serverTargetDir = path.join(tempRoot, 'server-target');
  const webDistDir = path.join(tempRoot, 'web-dist');
  const envExamplePath = path.join(tempRoot, '.env.example');
  const releaseTag = 'release-2026-04-03-02';

  try {
    writeSyntheticServerRuntime({
      serverTargetDir,
      targetTriple: 'x86_64-unknown-linux-gnu',
      binaryName: 'agentstudio-server',
      webDistDir,
      envExamplePath,
    });

    packager.packageServerAssets({
      releaseTag,
      platform: 'linux',
      arch: 'x64',
      target: 'x86_64-unknown-linux-gnu',
      outputDir,
      serverBuildTargetDir: serverTargetDir,
      serverWebDistDir: webDistDir,
      serverEnvPath: envExamplePath,
    });

    const archivePath = path.join(
      outputDir,
      'server',
      'linux',
      'x64',
      `agent-studio-server-${releaseTag}-linux-x64.tar.gz`,
    );
    const manifestPath = path.join(
      outputDir,
      'server',
      'linux',
      'x64',
      'release-asset-manifest.json',
    );
    const bundleRoot = `agent-studio-server-${releaseTag}-linux-x64`;
    const archiveEntries = readTarGzEntries(archivePath);

    assert.equal(existsSync(archivePath), true, `missing expected server archive ${archivePath}`);
    assert.equal(existsSync(`${archivePath}.sha256.txt`), true, 'missing expected server checksum');
    assert.equal(archiveEntries.has(`${bundleRoot}/bin/agentstudio-server`), true);
    assert.equal(archiveEntries.has(`${bundleRoot}/web/dist/index.html`), true);
    assert.equal(archiveEntries.has(`${bundleRoot}/.env.example`), true);
    assert.equal(archiveEntries.has(`${bundleRoot}/start-agentstudio-server.sh`), true);
    assert.equal(archiveEntries.has(`${bundleRoot}/README.md`), true);
    assert.match(
      archiveEntries.get(`${bundleRoot}/start-agentstudio-server.sh`).content.toString('utf8'),
      /CLAW_SERVER_WEB_DIST="\$\{CLAW_SERVER_WEB_DIST:-\$SCRIPT_DIR\/web\/dist\}"/,
    );
    assert.match(
      archiveEntries.get(`${bundleRoot}/README.md`).content.toString('utf8'),
      /Run the canonical bundled server binary from the extracted directory root:/,
    );
    assert.match(
      archiveEntries.get(`${bundleRoot}/README.md`).content.toString('utf8'),
      /\.\/bin\/agentstudio-server/,
    );
    assert.match(
      archiveEntries.get(`${bundleRoot}/README.md`).content.toString('utf8'),
      /native binary automatically defaults[\s\S]*CLAW_SERVER_WEB_DIST[\s\S]*CLAW_SERVER_DATA_DIR/,
    );
    assert.match(
      archiveEntries.get(`${bundleRoot}/README.md`).content.toString('utf8'),
      /start-agentstudio-server\.sh` and `start-agentstudio-server\.cmd` remain optional convenience wrappers[\s\S]*same native binary/,
    );

    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
    assert.equal(manifest.platform, 'linux');
    assert.equal(manifest.arch, 'x64');
    assert.equal(manifest.artifacts.length, 1);
    assert.equal(manifest.artifacts[0].family, 'server');
    assert.equal(
      manifest.artifacts[0].relativePath,
      `server/linux/x64/agent-studio-server-${releaseTag}-linux-x64.tar.gz`,
    );
  } finally {
    rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('container asset packager bundles deployment overlays, app runtime, and release metadata', async () => {
  const packagerPath = path.join(rootDir, 'scripts', 'release', 'package-release-assets.mjs');
  const packager = await import(pathToFileURL(packagerPath).href);

  const tempRoot = mkdtempSync(path.join(os.tmpdir(), 'claw-release-container-'));
  const outputDir = path.join(tempRoot, 'release-assets');
  const serverTargetDir = path.join(tempRoot, 'server-target');
  const webDistDir = path.join(tempRoot, 'web-dist');
  const envExamplePath = path.join(tempRoot, '.env.example');
  const deploymentSourceDir = path.join(rootDir, 'deployments', 'docker');
  const releaseTag = 'release-2026-04-03-03';

  try {
    writeSyntheticServerRuntime({
      serverTargetDir,
      targetTriple: 'x86_64-unknown-linux-gnu',
      binaryName: 'agentstudio-server',
      webDistDir,
      envExamplePath,
    });

    packager.packageContainerAssets({
      releaseTag,
      platform: 'linux',
      arch: 'x64',
      target: 'x86_64-unknown-linux-gnu',
      accelerator: 'nvidia-cuda',
      outputDir,
      serverBuildTargetDir: serverTargetDir,
      serverWebDistDir: webDistDir,
      serverEnvPath: envExamplePath,
      deploymentSourceDir,
    });

    const archivePath = path.join(
      outputDir,
      'container',
      'linux',
      'x64',
      'nvidia-cuda',
      `agent-studio-container-bundle-${releaseTag}-linux-x64-nvidia-cuda.tar.gz`,
    );
    const manifestPath = path.join(
      outputDir,
      'container',
      'linux',
      'x64',
      'nvidia-cuda',
      'release-asset-manifest.json',
    );
    const bundleRoot = `agent-studio-container-bundle-${releaseTag}-linux-x64-nvidia-cuda`;
    const archiveEntries = readTarGzEntries(archivePath);

    assert.equal(existsSync(archivePath), true, `missing expected container archive ${archivePath}`);
    assert.equal(existsSync(`${archivePath}.sha256.txt`), true, 'missing expected container checksum');
    assert.equal(archiveEntries.has(`${bundleRoot}/app/bin/agentstudio-server`), true);
    assert.equal(archiveEntries.has(`${bundleRoot}/app/start-agentstudio-server.sh`), true);
    assert.equal(archiveEntries.has(`${bundleRoot}/deployments/docker/Dockerfile`), true);
    assert.equal(archiveEntries.has(`${bundleRoot}/deployments/docker/docker-compose.nvidia-cuda.yml`), true);
    assert.equal(archiveEntries.has(`${bundleRoot}/deployments/docker/profiles/default.env`), true);
    assert.equal(archiveEntries.has(`${bundleRoot}/deployments/docker/README.md`), true);
    assert.equal(archiveEntries.has(`${bundleRoot}/.dockerignore`), true);
    const composeSource = archiveEntries
      .get(`${bundleRoot}/deployments/docker/docker-compose.yml`)
      .content
      .toString('utf8');
    const nvidiaComposeSource = archiveEntries
      .get(`${bundleRoot}/deployments/docker/docker-compose.nvidia-cuda.yml`)
      .content
      .toString('utf8');
    const amdComposeSource = archiveEntries
      .get(`${bundleRoot}/deployments/docker/docker-compose.amd-rocm.yml`)
      .content
      .toString('utf8');
    const deployReadmeSource = archiveEntries
      .get(`${bundleRoot}/deployments/docker/README.md`)
      .content
      .toString('utf8');
    const dockerfileSource = archiveEntries
      .get(`${bundleRoot}/deployments/docker/Dockerfile`)
      .content
      .toString('utf8');
    const composeDir = `${bundleRoot}/deployments/docker`;
    const buildContext = readSingleLineYamlValue(composeSource, 'context');
    const dockerfilePath = readSingleLineYamlValue(composeSource, 'dockerfile');
    const defaultEnvPath = readSingleListYamlValue(composeSource, 'env_file');
    const nvidiaEnvPath = readSingleListYamlValue(nvidiaComposeSource, 'env_file');
    const amdEnvPath = readSingleListYamlValue(amdComposeSource, 'env_file');
    const resolvedBuildContext = resolveArchiveRelativePath(composeDir, buildContext);
    const resolvedDockerfile = resolveArchiveRelativePath(resolvedBuildContext, dockerfilePath);
    const resolvedDefaultEnv = resolveArchiveRelativePath(composeDir, defaultEnvPath);
    const resolvedNvidiaEnv = resolveArchiveRelativePath(composeDir, nvidiaEnvPath);
    const resolvedAmdEnv = resolveArchiveRelativePath(composeDir, amdEnvPath);

    assert.equal(
      archiveEntries.has(`${resolvedBuildContext}/app/start-agentstudio-server.sh`),
      true,
      'compose build context must resolve to the bundle root so the app runtime is visible',
    );
    assert.equal(
      archiveEntries.has(resolvedDockerfile),
      true,
      'compose dockerfile path must resolve against the build context inside the bundle',
    );
    assert.equal(
      archiveEntries.has(resolvedDefaultEnv),
      true,
      'compose default env overlay must resolve relative to the packaged deploy directory',
    );
    assert.equal(
      archiveEntries.has(resolvedNvidiaEnv),
      true,
      'compose NVIDIA overlay env file must resolve relative to the packaged deploy directory',
    );
    assert.equal(
      archiveEntries.has(resolvedAmdEnv),
      true,
      'compose AMD overlay env file must resolve relative to the packaged deploy directory',
    );
    assert.match(
      deployReadmeSource,
      /source (?:tree|repository)[\s\S]*deploy\/docker\/docker-compose\.yml/i,
      'packaged deployment README must preserve the source-tree template path explanation for reviewers',
    );
    assert.match(
      deployReadmeSource,
      /extracted bundle root[\s\S]*deploy\/docker\/docker-compose\.yml/i,
      'packaged deployment README must preserve the extracted bundle command surface for operators',
    );
    assert.match(
      deployReadmeSource,
      /refreshes a matching Linux server binary through an incremental build/i,
      'packaged deployment README must preserve the local incremental rebuild contract for container packaging',
    );
    assert.match(
      dockerfileSource,
      /CMD\s+\["\/opt\/claw\/app\/bin\/agentstudio-server"\]/,
      'packaged dockerfile must launch the canonical bundled agentstudio-server binary directly',
    );
    assert.doesNotMatch(
      dockerfileSource,
      /CMD\s+\["\/bin\/sh",\s*"\/opt\/claw\/app\/start-agentstudio-server\.sh"\]/,
      'packaged dockerfile must not launch the optional wrapper script as the container entrypoint',
    );
    assert.match(
      archiveEntries.get(`${bundleRoot}/release-metadata.json`).content.toString('utf8'),
      /"accelerator": "nvidia-cuda"/,
    );

    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
    assert.equal(manifest.platform, 'linux');
    assert.equal(manifest.arch, 'x64');
    assert.equal(manifest.artifacts[0].family, 'container');
    assert.equal(manifest.artifacts[0].accelerator, 'nvidia-cuda');
  } finally {
    rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('kubernetes asset packager bundles chart assets and generated release values', async () => {
  const packagerPath = path.join(rootDir, 'scripts', 'release', 'package-release-assets.mjs');
  const packager = await import(pathToFileURL(packagerPath).href);

  const tempRoot = mkdtempSync(path.join(os.tmpdir(), 'claw-release-kubernetes-'));
  const outputDir = path.join(tempRoot, 'release-assets');
  const deployDir = path.join(tempRoot, 'deploy-kubernetes');
  const releaseTag = 'release-2026-04-03-04';

  try {
    mkdirSync(path.join(deployDir, 'templates'), { recursive: true });
    writeFileSync(path.join(deployDir, 'Chart.yaml'), 'apiVersion: v2\nname: agent-studio\n', 'utf8');
    writeFileSync(path.join(deployDir, 'values.yaml'), 'replicaCount: 1\n', 'utf8');
    writeFileSync(path.join(deployDir, 'values-amd-rocm.yaml'), 'resources: {}\n', 'utf8');
    writeFileSync(path.join(deployDir, 'templates', 'service.yaml'), 'apiVersion: v1\nkind: Service\n', 'utf8');

    packager.packageKubernetesAssets({
      releaseTag,
      platform: 'linux',
      arch: 'arm64',
      accelerator: 'amd-rocm',
      outputDir,
      deploymentSourceDir: deployDir,
    });

    const archivePath = path.join(
      outputDir,
      'kubernetes',
      'linux',
      'arm64',
      'amd-rocm',
      `agent-studio-kubernetes-bundle-${releaseTag}-linux-arm64-amd-rocm.tar.gz`,
    );
    const manifestPath = path.join(
      outputDir,
      'kubernetes',
      'linux',
      'arm64',
      'amd-rocm',
      'release-asset-manifest.json',
    );
    const bundleRoot = `agent-studio-kubernetes-bundle-${releaseTag}-linux-arm64-amd-rocm`;
    const archiveEntries = readTarGzEntries(archivePath);

    assert.equal(existsSync(archivePath), true, `missing expected kubernetes archive ${archivePath}`);
    assert.equal(existsSync(`${archivePath}.sha256.txt`), true, 'missing expected kubernetes checksum');
    assert.equal(archiveEntries.has(`${bundleRoot}/chart/Chart.yaml`), true);
    assert.equal(archiveEntries.has(`${bundleRoot}/chart/values-amd-rocm.yaml`), true);
    assert.equal(archiveEntries.has(`${bundleRoot}/chart/templates/service.yaml`), true);
    assert.match(
      archiveEntries.get(`${bundleRoot}/values.release.yaml`).content.toString('utf8'),
      /targetArchitecture: arm64/,
    );
    assert.match(
      archiveEntries.get(`${bundleRoot}/values.release.yaml`).content.toString('utf8'),
      /acceleratorProfile: amd-rocm/,
    );
    assert.match(
      archiveEntries.get(`${bundleRoot}/values.release.yaml`).content.toString('utf8'),
      /image:\n  repository: agent-studio-server\n  tag: release-2026-04-03-04/,
    );
    assert.match(
      archiveEntries.get(`${bundleRoot}/release-metadata.json`).content.toString('utf8'),
      /"family": "kubernetes"/,
    );
    assert.match(
      archiveEntries.get(`${bundleRoot}/release-metadata.json`).content.toString('utf8'),
      /"imageTag": "release-2026-04-03-04"/,
    );

    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
    assert.equal(manifest.platform, 'linux');
    assert.equal(manifest.arch, 'arm64');
    assert.equal(manifest.artifacts[0].family, 'kubernetes');
    assert.equal(manifest.artifacts[0].accelerator, 'amd-rocm');
  } finally {
    rmSync(tempRoot, { recursive: true, force: true });
  }
});
