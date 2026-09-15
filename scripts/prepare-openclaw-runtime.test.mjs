// WORKSPACE-PATH:allow-fixture - this file is a test fixture that simulates a foreign
// checkout root, so the sdkwork-<name> segment below is the value under assertion rather
// than a binding to a real sibling checkout. PORTABILITY_SPEC.md section 5.2 governs it.
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, readlinkSync, symlinkSync } from 'node:fs';
import { cp, mkdtemp, mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';

import {
  BUNDLED_RESOURCE_RUNTIME_ARCHIVE_FILENAME,
  buildOpenClawManifest,
  buildOpenClawRuntimeInstallEnv,
  copyDirectoryWithWindowsFallback,
  DEFAULT_NODE_VERSION,
  DEFAULT_OPENCLAW_RUNTIME_SUPPLEMENTAL_PACKAGES,
  DEFAULT_OPENCLAW_VERSION,
  DEFAULT_RESOURCE_DIR,
  hydrateBundledPluginRuntimeDependency,
  inspectCachedNodeRuntimeDir,
  inspectPreparedOpenClawRuntime,
  prepareOpenClawRuntime,
  prepareOpenClawRuntimeFromStagedDirs,
  resolveDownloadedNativeRuntimeAsset,
  resolveBundledResourceMirrorBaseDir,
  resolveMissingRuntimeCompanionInstallSpecs,
  resolveNapiPackageBinaryInstallSpec,
  resolveBundledPluginRuntimeHydrationTarget,
  resolveRuntimePackageCompanionInstallSpecs,
  resolveScriptCompanionPackageInstallSpec,
  resolveMissingBundledPluginRuntimeInstallSpecs,
  prepareOpenClawRuntimeFromSource,
  removeDirectoryWithRetries,
  retryOpenClawRuntimeOperation,
  refreshCachedOpenClawRuntimeArtifacts,
  resolveOpenClawRuntimeInstallSpecs,
  resolveNodeArchiveExtractionCommand,
  resolveNodeRuntimeNpmCommand,
  resolveBundledResourceMirrorRoot,
  resolveDefaultOpenClawPrepareCacheDir,
  resolveOpenClawRuntimeSystemCommand,
  resolveOpenClawPrepareCachePaths,
  resolveOpenClawTarget,
  resolvePackagedOpenClawInstallRootLayoutDir,
  resolvePackagedOpenClawResourceDir,
  resolveRequestedOpenClawTarget,
  resolveBundledResourceFsPathApi,
  syncWindowsPackagedOpenClawAliasRoot,
  stageDownloadedNativeRuntimeAsset,
  syncPackagedOpenClawReleaseArtifacts,
  syncBundledResourceMirror,
  shouldRetryOpenClawRuntimeOperationError,
  shouldRetryDirectoryCleanup,
  shouldSyncBundledResourceMirror,
  shouldReusePreparedOpenClawRuntime,
  validatePreparedOpenClawPackageTree,
} from './prepare-openclaw-runtime.mjs';
import {
  derivePreviousNumericVersion,
  escapeRegExp,
} from './test-support/version-fixtures.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');
const prepareScriptPath = path.join(rootDir, 'scripts', 'prepare-openclaw-runtime.mjs');
const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'prepare-openclaw-runtime-test-'));
const actualNodeVersion = process.version.replace(/^v/i, '');
const expectedOpenClawVersion = DEFAULT_OPENCLAW_VERSION;
const prereleaseOpenClawVersion = `${expectedOpenClawVersion}-beta.1`;
const expectedNodeVersion = DEFAULT_NODE_VERSION;
const defaultRuntimeSupplementalPackages = [
  `@openclaw/feishu@${expectedOpenClawVersion}`,
  `@openclaw/qqbot@${expectedOpenClawVersion}`,
];
const customRuntimeSupplementalPackages = ['@buape/carbon@0.14.0'];
const cachedNodeRuntimeSidecarManifestRelativePath = '.sdkwork-node-runtime.json';
const runtimeSidecarManifestRelativePath = path.join('runtime', '.sdkwork-openclaw-runtime.json');
const trackedResourcePlaceholder = 'packages/sdkwork-agentstudio-pc-desktop/src-tauri/resources/openclaw/.gitkeep';
const fakeNodeExecutableContent = 'not-a-real-node-runtime';

const staleOpenClawVersion = derivePreviousNumericVersion(expectedOpenClawVersion);

async function writeAlreadyPatchedOpenClawServerImpl(packageDir) {
  const serverImplPath = path.join(
    packageDir,
    'node_modules',
    'openclaw',
    'dist',
    'server.impl-fixture.js',
  );
  await mkdir(path.dirname(serverImplPath), { recursive: true });
  await writeFile(
    serverImplPath,
    [
      'function materializeConfigAgentPaths(config, previousConfig) {',
      '  const hasCanonicalAgentDirShape = true;',
      '  return { config, previousConfig, hasCanonicalAgentDirShape };',
      '}',
      '',
    ].join('\n'),
  );
  return serverImplPath;
}

async function writeOfficialQqbotSupplementalPackage(packageDir, version = expectedOpenClawVersion) {
  const qqbotPackageDir = path.join(packageDir, 'node_modules', '@openclaw', 'qqbot');
  await mkdir(path.join(qqbotPackageDir, 'dist'), { recursive: true });
  await mkdir(
    path.join(packageDir, 'node_modules', '@tencent-connect', 'qqbot-connector'),
    { recursive: true },
  );
  await mkdir(path.join(packageDir, 'node_modules', 'ws'), { recursive: true });
  await writeFile(
    path.join(qqbotPackageDir, 'package.json'),
    `${JSON.stringify(
      {
        name: '@openclaw/qqbot',
        version,
        type: 'module',
        dependencies: {
          '@tencent-connect/qqbot-connector': '^1.1.0',
          ws: '^8.20.0',
        },
        peerDependencies: {
          openclaw: `>=${version}`,
        },
        openclaw: {
          channel: {
            id: 'qqbot',
            label: 'QQ Bot',
          },
          runtimeExtensions: ['./dist/index.js'],
        },
      },
      null,
      2,
    )}\n`,
  );
  await writeFile(
    path.join(qqbotPackageDir, 'openclaw.plugin.json'),
    `${JSON.stringify(
      {
        id: 'qqbot',
        channelConfigs: {
          qqbot: {
            label: 'QQ Bot',
          },
        },
      },
      null,
      2,
    )}\n`,
  );
  await writeFile(path.join(qqbotPackageDir, 'dist', 'index.js'), 'export {};\n');
  await writeFile(
    path.join(packageDir, 'node_modules', '@tencent-connect', 'qqbot-connector', 'package.json'),
    `${JSON.stringify(
      {
        name: '@tencent-connect/qqbot-connector',
        version: '1.1.0',
      },
      null,
      2,
    )}\n`,
  );
  await writeFile(
    path.join(packageDir, 'node_modules', 'ws', 'package.json'),
    `${JSON.stringify(
      {
        name: 'ws',
        version: '8.20.0',
      },
      null,
      2,
    )}\n`,
  );
  return qqbotPackageDir;
}

async function writeOfficialFeishuSupplementalPackage(packageDir, version = expectedOpenClawVersion) {
  const feishuPackageDir = path.join(packageDir, 'node_modules', '@openclaw', 'feishu');
  await mkdir(path.join(feishuPackageDir, 'dist'), { recursive: true });
  await mkdir(path.join(packageDir, 'node_modules', '@larksuiteoapi', 'node-sdk'), {
    recursive: true,
  });
  await writeFile(
    path.join(feishuPackageDir, 'package.json'),
    `${JSON.stringify(
      {
        name: '@openclaw/feishu',
        version,
        type: 'module',
        dependencies: {
          '@larksuiteoapi/node-sdk': '^1.52.0',
        },
        peerDependencies: {
          openclaw: `>=${version}`,
        },
        openclaw: {
          channel: {
            id: 'feishu',
            label: 'Feishu',
          },
          runtimeExtensions: ['./dist/index.js'],
        },
      },
      null,
      2,
    )}\n`,
  );
  await writeFile(
    path.join(feishuPackageDir, 'openclaw.plugin.json'),
    `${JSON.stringify(
      {
        id: 'feishu',
        channelConfigs: {
          feishu: {
            label: 'Feishu',
          },
        },
      },
      null,
      2,
    )}\n`,
  );
  await writeFile(path.join(feishuPackageDir, 'dist', 'index.js'), 'export {};\n');
  await writeFile(
    path.join(packageDir, 'node_modules', '@larksuiteoapi', 'node-sdk', 'package.json'),
    `${JSON.stringify(
      {
        name: '@larksuiteoapi/node-sdk',
        version: '1.52.0',
      },
      null,
      2,
    )}\n`,
  );
  return feishuPackageDir;
}

async function writeOfficialDefaultSupplementalPackages(packageDir, version = expectedOpenClawVersion) {
  await writeOfficialFeishuSupplementalPackage(packageDir, version);
  await writeOfficialQqbotSupplementalPackage(packageDir, version);
}

async function writePluginManifestOnlyQqbotSupplementalPackage(
  packageDir,
  version = expectedOpenClawVersion,
) {
  const qqbotPackageDir = path.join(packageDir, 'node_modules', '@openclaw', 'qqbot');
  await mkdir(path.join(qqbotPackageDir, 'dist'), { recursive: true });
  await writeFile(
    path.join(qqbotPackageDir, 'package.json'),
    `${JSON.stringify(
      {
        name: '@openclaw/qqbot',
        version,
        type: 'module',
      },
      null,
      2,
    )}\n`,
  );
  await writeFile(
    path.join(qqbotPackageDir, 'openclaw.plugin.json'),
    `${JSON.stringify(
      {
        id: 'qqbot',
        channelConfigs: {
          qqbot: {
            label: 'QQ Bot',
          },
        },
      },
      null,
      2,
    )}\n`,
  );
  await writeFile(path.join(qqbotPackageDir, 'dist', 'index.js'), 'export {};\n');
  return qqbotPackageDir;
}

async function writePluginManifestOnlyFeishuSupplementalPackage(
  packageDir,
  version = expectedOpenClawVersion,
) {
  const feishuPackageDir = path.join(packageDir, 'node_modules', '@openclaw', 'feishu');
  await mkdir(path.join(feishuPackageDir, 'dist'), { recursive: true });
  await writeFile(
    path.join(feishuPackageDir, 'package.json'),
    `${JSON.stringify(
      {
        name: '@openclaw/feishu',
        version,
        type: 'module',
      },
      null,
      2,
    )}\n`,
  );
  await writeFile(
    path.join(feishuPackageDir, 'openclaw.plugin.json'),
    `${JSON.stringify(
      {
        id: 'feishu',
        channelConfigs: {
          feishu: {
            label: 'Feishu',
          },
        },
      },
      null,
      2,
    )}\n`,
  );
  await writeFile(path.join(feishuPackageDir, 'dist', 'index.js'), 'export {};\n');
  return feishuPackageDir;
}

function resolveExpectedWindowsSystemCommand(command) {
  const normalizedCommand = String(command ?? '').trim().toLowerCase();
  const systemRoot =
    String(process.env.SystemRoot ?? process.env.WINDIR ?? '').trim() || 'C:\\Windows';

  if (process.platform !== 'win32') {
    return normalizedCommand === 'tar' ? 'tar' : normalizedCommand === 'powershell' ? 'powershell' : command;
  }

  if (normalizedCommand === 'tar') {
    const tarPath = path.win32.join(systemRoot, 'System32', 'tar.exe');
    return existsSync(tarPath) ? tarPath : 'tar.exe';
  }

  if (normalizedCommand === 'powershell') {
    const powershellPath = path.win32.join(
      systemRoot,
      'System32',
      'WindowsPowerShell',
      'v1.0',
      'powershell.exe',
    );
    return existsSync(powershellPath) ? powershellPath : 'powershell.exe';
  }

  return command;
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

function createTarGzArchiveBuffer(records = []) {
  return gzipSync(Buffer.concat([
    ...records,
    Buffer.alloc(1024, 0),
  ]));
}

function listTrackedOpenClawResourceFiles() {
  const result = spawnSync(
    'git',
    ['ls-files', '--', 'packages/sdkwork-agentstudio-pc-desktop/src-tauri/resources/openclaw'],
    {
      cwd: rootDir,
      encoding: 'utf8',
      shell: false,
    },
  );

  if (result.error) {
    if (result.error.code === 'EPERM') {
      return null;
    }
    throw result.error;
  }

  if (result.status !== 0) {
    throw new Error(`git ls-files failed: ${result.stderr || result.stdout}`);
  }

  return result.stdout
    .split(/\r?\n/u)
    .map((entry) => entry.trim())
    .filter(Boolean)
    .sort();
}

try {
  if (DEFAULT_OPENCLAW_VERSION !== expectedOpenClawVersion) {
    throw new Error(
      `Expected DEFAULT_OPENCLAW_VERSION=${expectedOpenClawVersion}, received ${DEFAULT_OPENCLAW_VERSION}`,
    );
  }
  if (
    !Array.isArray(DEFAULT_OPENCLAW_RUNTIME_SUPPLEMENTAL_PACKAGES)
    || JSON.stringify(DEFAULT_OPENCLAW_RUNTIME_SUPPLEMENTAL_PACKAGES) !== JSON.stringify(defaultRuntimeSupplementalPackages)
  ) {
    throw new Error(
      `Expected prepared OpenClaw runtime supplemental package list to include ${defaultRuntimeSupplementalPackages.join(', ')}`,
    );
  }
  if (typeof syncWindowsPackagedOpenClawAliasRoot !== 'function') {
    throw new Error('Expected prepare-openclaw-runtime to export syncWindowsPackagedOpenClawAliasRoot');
  }
  if (
    !/await syncPackagedOpenClawReleaseArtifacts\([\s\S]*await syncWindowsPackagedOpenClawAliasRoot\(/.test(
      readFileSync(prepareScriptPath, 'utf8'),
    )
  ) {
    throw new Error(
      'Expected prepare-openclaw-runtime to materialize canonical packaged release assets before wiring the Windows OpenClaw short-path alias root',
    );
  }

  const trackedOpenClawResourceFiles = listTrackedOpenClawResourceFiles();
  if (
    trackedOpenClawResourceFiles
    && (
      trackedOpenClawResourceFiles.length !== 1
      || trackedOpenClawResourceFiles[0] !== trackedResourcePlaceholder
    )
  ) {
    throw new Error(
      `Expected only ${trackedResourcePlaceholder} to be tracked under resources/openclaw, received ${trackedOpenClawResourceFiles.join(', ') || '<none>'}`,
    );
  }

  const windowsMirrorBaseDirForWin32 = resolveBundledResourceMirrorBaseDir(
    'D:\\workspace\\agent-studio',
    {},
    'win32',
  );
  const windowsMirrorBaseDirForWindows = resolveBundledResourceMirrorBaseDir(
    'D:\\workspace\\agent-studio',
    {},
    'windows',
  );
  if (windowsMirrorBaseDirForWindows !== windowsMirrorBaseDirForWin32) {
    throw new Error(
      `Expected resolveBundledResourceMirrorBaseDir to normalize platform=windows to the same short mirror base dir as win32, received ${windowsMirrorBaseDirForWindows} vs ${windowsMirrorBaseDirForWin32}`,
    );
  }

  const posixMirrorBaseDir = resolveBundledResourceMirrorBaseDir(
    '/tmp/workspace/agent-studio',
    {},
    'win32',
  );
  if (posixMirrorBaseDir !== '/tmp/workspace/agent-studio/.cache/short-mirrors') {
    throw new Error(
      `Expected resolveBundledResourceMirrorBaseDir to preserve a host-accessible POSIX base dir when targeting win32 from a POSIX workspace, received ${posixMirrorBaseDir}`,
    );
  }

  const configuredPosixMirrorBaseDir = resolveBundledResourceMirrorBaseDir(
    '/tmp/workspace/agent-studio',
    {
      SDKWORK_WINDOWS_MIRROR_BASE_DIR: '/tmp/windows-resource-mirrors',
    },
    'win32',
  );
  if (configuredPosixMirrorBaseDir !== '/tmp/windows-resource-mirrors') {
    throw new Error(
      `Expected resolveBundledResourceMirrorBaseDir to preserve explicit POSIX mirror base dirs when targeting win32, received ${configuredPosixMirrorBaseDir}`,
    );
  }

  const windowsMirrorRootForWindows = resolveBundledResourceMirrorRoot(
    'D:\\workspace\\agent-studio',
    'openclaw',
    'windows',
  );
  const windowsMirrorRootForWin32 = resolveBundledResourceMirrorRoot(
    'D:\\workspace\\agent-studio',
    'openclaw',
    'win32',
  );
  if (windowsMirrorRootForWindows !== windowsMirrorRootForWin32) {
    throw new Error(
      `Expected resolveBundledResourceMirrorRoot to normalize platform=windows to the same short mirror root as win32, received ${windowsMirrorRootForWindows} vs ${windowsMirrorRootForWin32}`,
    );
  }

  const posixMirrorRoot = resolveBundledResourceMirrorRoot(
    '/tmp/workspace/agent-studio',
    'openclaw',
    'win32',
  );
  if (posixMirrorRoot !== '/tmp/workspace/agent-studio/.cache/short-mirrors/openclaw') {
    throw new Error(
      `Expected resolveBundledResourceMirrorRoot to preserve a host-accessible POSIX mirror root when targeting win32 from a POSIX workspace, received ${posixMirrorRoot}`,
    );
  }

  const configuredPosixMirrorRoot = resolveBundledResourceMirrorRoot(
    '/tmp/workspace/agent-studio',
    'openclaw',
    'win32',
    '/tmp/windows-resource-mirrors',
  );
  if (configuredPosixMirrorRoot !== '/tmp/windows-resource-mirrors/openclaw') {
    throw new Error(
      `Expected resolveBundledResourceMirrorRoot to preserve explicit POSIX mirror roots when targeting win32, received ${configuredPosixMirrorRoot}`,
    );
  }

  if (typeof resolveBundledResourceFsPathApi !== 'function') {
    throw new Error('Expected prepare-openclaw-runtime to export resolveBundledResourceFsPathApi');
  }

  const posixFsPathApi = resolveBundledResourceFsPathApi('/tmp/source-runtime', 'win32');
  if (posixFsPathApi.join('/tmp/source-runtime', 'manifest.json') !== '/tmp/source-runtime/manifest.json') {
    throw new Error(
      `Expected resolveBundledResourceFsPathApi to keep POSIX host paths untouched when targeting win32, received ${posixFsPathApi.join('/tmp/source-runtime', 'manifest.json')}`,
    );
  }

  const windowsFsPathApi = resolveBundledResourceFsPathApi('D:\\source-runtime', 'win32');
  if (windowsFsPathApi.join('D:\\source-runtime', 'manifest.json') !== 'D:\\source-runtime\\manifest.json') {
    throw new Error(
      `Expected resolveBundledResourceFsPathApi to keep Windows host paths on win32 semantics, received ${windowsFsPathApi.join('D:\\source-runtime', 'manifest.json')}`,
    );
  }

  if (!shouldSyncBundledResourceMirror({ resourceDir: DEFAULT_RESOURCE_DIR })) {
    throw new Error('Expected the default bundled resource directory to keep syncing the Windows mirror');
  }

  if (shouldSyncBundledResourceMirror({ resourceDir: path.join(tempRoot, 'isolated-resource-runtime') })) {
    throw new Error('Expected temporary bundled resource directories to avoid mutating the shared Windows mirror');
  }

  const sourceRuntimeDir = path.join(tempRoot, 'source-runtime');
  const resourceDir = path.join(tempRoot, 'resource-runtime');
  const target = resolveOpenClawTarget('win32', 'x64');
  const manifest = buildOpenClawManifest({
    openclawVersion: expectedOpenClawVersion,
    nodeVersion: expectedNodeVersion,
    target,
  });
  const cliPath = path.join(sourceRuntimeDir, manifest.cliRelativePath.replace(/^runtime[\\/]/, ''));
  const openclawPackageJsonPath = path.join(
    sourceRuntimeDir,
    'package',
    'node_modules',
    'openclaw',
    'package.json',
  );
  const openclawServerImplPath = path.join(
    sourceRuntimeDir,
    'package',
    'node_modules',
    'openclaw',
    'dist',
    'server.impl-fixture.js',
  );
  const carbonPackageJsonPath = path.join(
    sourceRuntimeDir,
    'package',
    'node_modules',
    '@buape',
    'carbon',
    'package.json',
  );

  await mkdir(path.dirname(cliPath), { recursive: true });
  await mkdir(path.dirname(openclawPackageJsonPath), { recursive: true });
  await mkdir(path.dirname(openclawServerImplPath), { recursive: true });
  await mkdir(path.dirname(carbonPackageJsonPath), { recursive: true });
  await mkdir(resourceDir, { recursive: true });
  await writeFile(path.join(resourceDir, '.gitkeep'), '');
  await writeFile(cliPath, 'console.log("openclaw");');
  await writeFile(
    openclawServerImplPath,
    [
      'function materializeConfigAgentPaths(config, previousConfig) {',
      '  const hasCanonicalAgentDirShape = true;',
      '  return { config, previousConfig, hasCanonicalAgentDirShape };',
      '}',
      '',
    ].join('\n'),
  );
  await writeFile(
    openclawPackageJsonPath,
    `${JSON.stringify({ name: 'openclaw', version: expectedOpenClawVersion }, null, 2)}\n`,
  );
  await writeFile(
    carbonPackageJsonPath,
    `${JSON.stringify({ name: '@buape/carbon', version: '0.14.0' }, null, 2)}\n`,
  );
  await writeOfficialDefaultSupplementalPackages(path.join(sourceRuntimeDir, 'package'));

  const result = await prepareOpenClawRuntimeFromSource({
    sourceRuntimeDir,
    resourceDir,
    openclawVersion: expectedOpenClawVersion,
    nodeVersion: expectedNodeVersion,
    target,
  });

  await stat(path.join(resourceDir, 'runtime'));
  await stat(path.join(resourceDir, 'manifest.json'));
  await stat(path.join(resourceDir, runtimeSidecarManifestRelativePath));
  await stat(path.join(resourceDir, '.gitkeep'));
  await stat(
    path.join(
      resourceDir,
      'runtime',
      'package',
      'node_modules',
      'openclaw',
      'dist',
      'extensions',
      'qqbot',
      'openclaw.plugin.json',
    ),
  );
  await stat(
    path.join(
      resourceDir,
      'runtime',
      'package',
      'node_modules',
      'openclaw',
      'dist',
      'extensions',
      'feishu',
      'openclaw.plugin.json',
    ),
  );
  if (
    existsSync(
      path.join(
        resourceDir,
        'runtime',
        'package',
        'node_modules',
        'openclaw',
        'dist',
        'extensions',
        'qqbot',
        'node_modules',
      ),
    )
  ) {
    throw new Error('Expected materialized qqbot extension to exclude nested node_modules');
  }

  const copiedManifest = JSON.parse(await readFile(path.join(resourceDir, 'manifest.json'), 'utf8'));
  const copiedRuntimeSidecarManifest = JSON.parse(
    await readFile(path.join(resourceDir, runtimeSidecarManifestRelativePath), 'utf8'),
  );
  if (copiedManifest.runtimeId !== 'openclaw') {
    throw new Error(`Expected runtimeId=openclaw, received ${copiedManifest.runtimeId}`);
  }

  if (copiedManifest.openclawVersion !== expectedOpenClawVersion) {
    throw new Error(`Expected openclawVersion=${expectedOpenClawVersion}, received ${copiedManifest.openclawVersion}`);
  }
  if (Object.hasOwn(copiedManifest, 'nodeVersion')) {
    throw new Error('Expected prepared runtime manifest to stop exposing a top-level nodeVersion field');
  }
  if (JSON.stringify(copiedManifest.requiredExternalRuntimes) !== JSON.stringify(['nodejs'])) {
    throw new Error(
      `Expected prepared runtime manifest requiredExternalRuntimes=[\"nodejs\"], received ${JSON.stringify(copiedManifest.requiredExternalRuntimes)}`,
    );
  }
  if (copiedManifest.requiredExternalRuntimeVersions?.nodejs !== expectedNodeVersion) {
    throw new Error(
      `Expected prepared runtime manifest requiredExternalRuntimeVersions.nodejs=${expectedNodeVersion}, received ${copiedManifest.requiredExternalRuntimeVersions?.nodejs}`,
    );
  }
  if (copiedRuntimeSidecarManifest.openclawVersion !== expectedOpenClawVersion) {
    throw new Error(
      `Expected runtime sidecar openclawVersion=${expectedOpenClawVersion}, received ${copiedRuntimeSidecarManifest.openclawVersion}`,
    );
  }
  if (Object.hasOwn(copiedRuntimeSidecarManifest, 'nodeVersion')) {
    throw new Error('Expected prepared runtime sidecar manifest to stop exposing a top-level nodeVersion field');
  }
  if (
    JSON.stringify(copiedRuntimeSidecarManifest.requiredExternalRuntimes)
    !== JSON.stringify(['nodejs'])
  ) {
    throw new Error(
      `Expected runtime sidecar requiredExternalRuntimes=[\"nodejs\"], received ${JSON.stringify(copiedRuntimeSidecarManifest.requiredExternalRuntimes)}`,
    );
  }
  if (copiedRuntimeSidecarManifest.requiredExternalRuntimeVersions?.nodejs !== expectedNodeVersion) {
    throw new Error(
      `Expected runtime sidecar requiredExternalRuntimeVersions.nodejs=${expectedNodeVersion}, received ${copiedRuntimeSidecarManifest.requiredExternalRuntimeVersions?.nodejs}`,
    );
  }
  if (
    !copiedRuntimeSidecarManifest.runtimeIntegrity
    || copiedRuntimeSidecarManifest.runtimeIntegrity.schemaVersion !== 1
    || !Array.isArray(copiedRuntimeSidecarManifest.runtimeIntegrity.files)
  ) {
    throw new Error('Expected runtime sidecar to include a schemaVersion=1 runtimeIntegrity snapshot');
  }
  const runtimeIntegrityRelativePaths = new Set(
    copiedRuntimeSidecarManifest.runtimeIntegrity.files.map((entry) => entry.relativePath),
  );
  for (const expectedRelativePath of [
    manifest.cliRelativePath.replace(/^runtime[\\/]/, '').replaceAll('\\', '/'),
    'package/node_modules/openclaw/package.json',
    'package/node_modules/@openclaw/feishu/package.json',
    'package/node_modules/@openclaw/qqbot/package.json',
  ]) {
    if (!runtimeIntegrityRelativePaths.has(expectedRelativePath)) {
      throw new Error(
        `Expected runtime sidecar integrity snapshot to include ${expectedRelativePath}, received ${[...runtimeIntegrityRelativePaths].join(', ')}`,
      );
    }
  }

  if (result.manifest.cliRelativePath !== 'runtime/package/node_modules/openclaw/openclaw.mjs') {
    throw new Error(`Unexpected cliRelativePath ${result.manifest.cliRelativePath}`);
  }

  const sourceRuntimeWithCentralConfigWriterDir = path.join(tempRoot, 'source-runtime-central-config-writer');
  const resourceWithCentralConfigWriterDir = path.join(tempRoot, 'resource-runtime-central-config-writer');
  const centralCliPath = path.join(
    sourceRuntimeWithCentralConfigWriterDir,
    manifest.cliRelativePath.replace(/^runtime[\\/]/, ''),
  );
  const centralOpenClawPackageJsonPath = path.join(
    sourceRuntimeWithCentralConfigWriterDir,
    'package',
    'node_modules',
    'openclaw',
    'package.json',
  );
  const centralMutatePath = path.join(
    sourceRuntimeWithCentralConfigWriterDir,
    'package',
    'node_modules',
    'openclaw',
    'dist',
    'mutate-fixture.js',
  );
  await mkdir(path.dirname(centralCliPath), { recursive: true });
  await mkdir(path.dirname(centralOpenClawPackageJsonPath), { recursive: true });
  await mkdir(path.dirname(centralMutatePath), { recursive: true });
  await writeFile(centralCliPath, 'console.log("openclaw");');
  await writeFile(
    centralOpenClawPackageJsonPath,
    `${JSON.stringify({ name: 'openclaw', version: expectedOpenClawVersion }, null, 2)}\n`,
  );
  await writeOfficialDefaultSupplementalPackages(
    path.join(sourceRuntimeWithCentralConfigWriterDir, 'package'),
  );
  await writeFile(
    centralMutatePath,
    [
      'async function replaceConfigFile(params) {',
      '  await writeConfigFile(params.nextConfig, params.writeOptions);',
      '  return { nextConfig: params.nextConfig };',
      '}',
      'async function mutateConfigFile(params) {',
      '  const draft = structuredClone(params.nextConfig);',
      '  return { nextConfig: draft };',
      '}',
      '',
    ].join('\n'),
  );
  const centralWriterResult = await prepareOpenClawRuntimeFromSource({
    sourceRuntimeDir: sourceRuntimeWithCentralConfigWriterDir,
    resourceDir: resourceWithCentralConfigWriterDir,
    openclawVersion: expectedOpenClawVersion,
    nodeVersion: expectedNodeVersion,
    target,
  });
  if (centralWriterResult.manifest.openclawVersion !== expectedOpenClawVersion) {
    throw new Error(
      `Expected centralized config writer runtime preparation to preserve version ${expectedOpenClawVersion}, received ${centralWriterResult.manifest.openclawVersion}`,
    );
  }

  const mirrorWorkspaceRoot = path.join(tempRoot, 'workspace-root');
  const priorWindowsMirrorBaseDir = process.env.SDKWORK_WINDOWS_MIRROR_BASE_DIR;
  process.env.SDKWORK_WINDOWS_MIRROR_BASE_DIR = path.join(tempRoot, 'windows-resource-mirrors');
  const mirroredResourceRoot = resolveBundledResourceMirrorRoot(
    mirrorWorkspaceRoot,
    'openclaw',
    'win32',
  );
  try {
    await syncBundledResourceMirror({
      resourceDir,
      resourceId: 'openclaw',
      workspaceRootDir: mirrorWorkspaceRoot,
      platform: 'win32',
    });

    await stat(path.join(mirroredResourceRoot, 'manifest.json'));
    await stat(path.join(mirroredResourceRoot, BUNDLED_RESOURCE_RUNTIME_ARCHIVE_FILENAME));

    let mirroredRuntimeDirMissing = false;
    try {
      await stat(path.join(mirroredResourceRoot, 'runtime'));
    } catch (error) {
      mirroredRuntimeDirMissing = error && typeof error === 'object' && error.code === 'ENOENT';
    }

    if (!mirroredRuntimeDirMissing) {
      throw new Error('Expected the Windows bundled resource mirror to materialize an archive instead of a runtime directory tree');
    }

    await syncBundledResourceMirror({
      resourceDir,
      resourceId: 'openclaw',
      workspaceRootDir: mirrorWorkspaceRoot,
      platform: 'win32',
      createArchiveImpl: async () => {
        throw new Error('Expected the Windows bundled resource mirror to reuse an up-to-date archive');
      },
    });

    await writeFile(path.join(mirroredResourceRoot, BUNDLED_RESOURCE_RUNTIME_ARCHIVE_FILENAME), 'stale-archive');
    let staleArchiveRepairCount = 0;
    await syncBundledResourceMirror({
      resourceDir,
      resourceId: 'openclaw',
      workspaceRootDir: mirrorWorkspaceRoot,
      platform: 'win32',
      createArchiveImpl: async ({ archivePath }) => {
        staleArchiveRepairCount += 1;
        await writeFile(archivePath, 'repaired-archive');
      },
    });

    if (staleArchiveRepairCount !== 1) {
      throw new Error(
        `Expected the Windows bundled resource mirror archive to be regenerated once when the existing archive payload is stale, received ${staleArchiveRepairCount} repairs`,
      );
    }
  } finally {
    if (typeof priorWindowsMirrorBaseDir === 'string') {
      process.env.SDKWORK_WINDOWS_MIRROR_BASE_DIR = priorWindowsMirrorBaseDir;
    } else {
      delete process.env.SDKWORK_WINDOWS_MIRROR_BASE_DIR;
    }
  }

  const macosSourceRuntimeDir = path.join(tempRoot, 'macos-source-runtime');
  const macosResourceDir = path.join(tempRoot, 'macos-resource-runtime');
  const macosTarget = resolveOpenClawTarget('macos', 'x64');
  const macosManifest = buildOpenClawManifest({
    openclawVersion: expectedOpenClawVersion,
    nodeVersion: expectedNodeVersion,
    target: macosTarget,
  });
  const macosCliPath = path.join(
    macosSourceRuntimeDir,
    macosManifest.cliRelativePath.replace(/^runtime[\\/]/, ''),
  );
  const macosOpenClawPackageJsonPath = path.join(
    macosSourceRuntimeDir,
    'package',
    'node_modules',
    'openclaw',
    'package.json',
  );
  const macosCarbonPackageJsonPath = path.join(
    macosSourceRuntimeDir,
    'package',
    'node_modules',
    '@buape',
    'carbon',
    'package.json',
  );

  await mkdir(path.dirname(macosCliPath), { recursive: true });
  await mkdir(path.dirname(macosOpenClawPackageJsonPath), { recursive: true });
  await mkdir(path.dirname(macosCarbonPackageJsonPath), { recursive: true });
  await writeAlreadyPatchedOpenClawServerImpl(path.join(macosSourceRuntimeDir, 'package'));
  await mkdir(macosResourceDir, { recursive: true });
  await writeFile(path.join(macosResourceDir, '.gitkeep'), '');
  await writeFile(macosCliPath, 'console.log("openclaw-macos");');
  await writeFile(
    macosOpenClawPackageJsonPath,
    `${JSON.stringify({ name: 'openclaw', version: expectedOpenClawVersion }, null, 2)}\n`,
  );
  await writeFile(
    macosCarbonPackageJsonPath,
    `${JSON.stringify({ name: '@buape/carbon', version: '0.14.0' }, null, 2)}\n`,
  );
  await writeOfficialDefaultSupplementalPackages(path.join(macosSourceRuntimeDir, 'package'));
  await prepareOpenClawRuntimeFromSource({
    sourceRuntimeDir: macosSourceRuntimeDir,
    resourceDir: macosResourceDir,
    openclawVersion: expectedOpenClawVersion,
    nodeVersion: expectedNodeVersion,
    target: macosTarget,
  });

  const packagedWorkspaceRoot = path.join(tempRoot, 'packaged-workspace-root');
  const packagedResourceDir = resolvePackagedOpenClawResourceDir(packagedWorkspaceRoot, 'linux');
  const packagedMacosInstallRootDir = resolvePackagedOpenClawInstallRootLayoutDir(
    packagedWorkspaceRoot,
    'macos',
  );

  await syncPackagedOpenClawReleaseArtifacts({
    resourceDir: macosResourceDir,
    workspaceRootDir: packagedWorkspaceRoot,
    target: macosTarget,
  });

  await stat(path.join(packagedResourceDir, 'manifest.json'));
  await stat(path.join(packagedResourceDir, BUNDLED_RESOURCE_RUNTIME_ARCHIVE_FILENAME));

  let packagedRuntimeDirMissing = false;
  try {
    await stat(path.join(packagedResourceDir, 'runtime'));
  } catch (error) {
    packagedRuntimeDirMissing = error && typeof error === 'object' && error.code === 'ENOENT';
  }

  if (!packagedRuntimeDirMissing) {
    throw new Error('Expected packaged OpenClaw release resources to ship runtime.zip instead of a runtime directory tree');
  }

  const macosInstallKey = `${macosManifest.openclawVersion}-macos-x64`;
  await stat(
    path.join(
      packagedMacosInstallRootDir,
      'runtimes',
      'openclaw',
      macosInstallKey,
      'manifest.json',
    ),
  );
  await stat(
    path.join(
      packagedMacosInstallRootDir,
      'runtimes',
      'openclaw',
      macosInstallKey,
      'runtime',
      '.sdkwork-openclaw-runtime.json',
    ),
  );
  await stat(
    path.join(
      packagedMacosInstallRootDir,
      'runtimes',
      'openclaw',
      macosInstallKey,
      'runtime',
      'package',
      'node_modules',
      'openclaw',
      'openclaw.mjs',
    ),
  );

  const windowsAliasOperations = [];
  await syncWindowsPackagedOpenClawAliasRoot({
    workspaceRootDir: 'D:\\workspace\\agent-studio',
    packagedResourceDir:
      'D:\\workspace\\agent-studio\\packages\\sdkwork-agentstudio-pc-desktop\\src-tauri\\generated\\release\\openclaw-resource',
    platform: 'win32',
    mkdirImpl: async (targetPath) => {
      windowsAliasOperations.push(['mkdir', targetPath]);
    },
    cleanupImpl: async (targetPath) => {
      windowsAliasOperations.push(['cleanup', targetPath]);
    },
    symlinkImpl: (targetPath, linkPath, linkType) => {
      windowsAliasOperations.push(['symlink', targetPath, linkPath, linkType]);
    },
  });

  if (
    JSON.stringify(windowsAliasOperations) !== JSON.stringify([
      ['cleanup', 'D:\\.sdkwork-bc\\agent-studio\\openclaw'],
      ['mkdir', 'D:\\.sdkwork-bc\\agent-studio'],
      [
        'symlink',
        'D:\\workspace\\agent-studio\\packages\\sdkwork-agentstudio-pc-desktop\\src-tauri\\generated\\release\\openclaw-resource',
        'D:\\.sdkwork-bc\\agent-studio\\openclaw',
        'junction',
      ],
    ])
  ) {
    throw new Error(
      `Expected Windows OpenClaw alias sync to point the stable short-path root at the canonical packaged release root, received ${JSON.stringify(windowsAliasOperations)}`,
    );
  }

  const packagedWindowsWorkspaceRoot = path.join(tempRoot, 'packaged-windows-workspace-root');
  const packagedWindowsResourceDir = resolvePackagedOpenClawResourceDir(
    packagedWindowsWorkspaceRoot,
    'windows',
  );
  await syncPackagedOpenClawReleaseArtifacts({
    resourceDir,
    workspaceRootDir: packagedWindowsWorkspaceRoot,
    target,
  });

  const priorWindowsAliasRepairMirrorBaseDir = process.env.SDKWORK_WINDOWS_MIRROR_BASE_DIR;
  process.env.SDKWORK_WINDOWS_MIRROR_BASE_DIR = path.join(
    tempRoot,
    'windows-alias-repair-mirrors',
  );
  const staleWindowsAliasWorkspaceRoot = path.join(tempRoot, 'workspace-root-alias-repair');
  const staleWindowsAliasRoot = resolveBundledResourceMirrorRoot(
    staleWindowsAliasWorkspaceRoot,
    'openclaw',
    'win32',
  );
  try {
    await mkdir(staleWindowsAliasRoot, { recursive: true });
    await cp(
      path.join(packagedWindowsResourceDir, 'manifest.json'),
      path.join(staleWindowsAliasRoot, 'manifest.json'),
    );
    await writeFile(
      path.join(staleWindowsAliasRoot, BUNDLED_RESOURCE_RUNTIME_ARCHIVE_FILENAME),
      'stale-archive',
    );

    let staleWindowsAliasSymlinkAttemptCount = 0;
    await syncWindowsPackagedOpenClawAliasRoot({
      workspaceRootDir: staleWindowsAliasWorkspaceRoot,
      packagedResourceDir: packagedWindowsResourceDir,
      platform: 'win32',
      cleanupImpl: async () => {
        const error = new Error('alias root is locked');
        error.code = 'EPERM';
        throw error;
      },
      symlinkImpl: () => {
        staleWindowsAliasSymlinkAttemptCount += 1;
      },
    });

    if (staleWindowsAliasSymlinkAttemptCount !== 0) {
      throw new Error(
        `Expected Windows OpenClaw alias repair to avoid recreating the short-path junction when cleanup is locked, received ${staleWindowsAliasSymlinkAttemptCount} symlink attempts`,
      );
    }

    const repairedAliasArchive = await readFile(
      path.join(staleWindowsAliasRoot, BUNDLED_RESOURCE_RUNTIME_ARCHIVE_FILENAME),
    );
    const packagedAliasArchive = await readFile(
      path.join(packagedWindowsResourceDir, BUNDLED_RESOURCE_RUNTIME_ARCHIVE_FILENAME),
    );
    if (!repairedAliasArchive.equals(packagedAliasArchive)) {
      throw new Error(
        'Expected Windows OpenClaw alias repair to refresh the archive-only payload in place when the short-path root is locked',
      );
    }
  } finally {
    if (typeof priorWindowsAliasRepairMirrorBaseDir === 'string') {
      process.env.SDKWORK_WINDOWS_MIRROR_BASE_DIR = priorWindowsAliasRepairMirrorBaseDir;
    } else {
      delete process.env.SDKWORK_WINDOWS_MIRROR_BASE_DIR;
    }
  }

  const priorWindowsFallbackMirrorBaseDir = process.env.SDKWORK_WINDOWS_MIRROR_BASE_DIR;
  delete process.env.SDKWORK_WINDOWS_MIRROR_BASE_DIR;
  const fallbackWindowsAliasWorkspaceRoot = path.join(tempRoot, 'workspace-root-alias-fallback');
  const defaultFallbackWindowsAliasRoot = resolveBundledResourceMirrorRoot(
    fallbackWindowsAliasWorkspaceRoot,
    'openclaw',
    'win32',
  );
  try {
    let fallbackRepairAttemptCount = 0;
    const resolvedFallbackAliasRoot = await syncWindowsPackagedOpenClawAliasRoot({
      workspaceRootDir: fallbackWindowsAliasWorkspaceRoot,
      packagedResourceDir: packagedWindowsResourceDir,
      platform: 'win32',
      cleanupImpl: async () => {
        const error = new Error('alias root is locked');
        error.code = 'EPERM';
        throw error;
      },
      symlinkImpl: () => {
        throw new Error('Expected Windows OpenClaw alias fallback to bypass junction recreation');
      },
      repairArchiveOnlyBundledResourceRootInPlaceImpl: async ({ sourceRoot, mirrorRoot }) => {
        fallbackRepairAttemptCount += 1;
        if (mirrorRoot === defaultFallbackWindowsAliasRoot) {
          const error = new Error('runtime.zip is locked');
          error.code = 'EPERM';
          throw error;
        }

        await mkdir(mirrorRoot, { recursive: true });
        await cp(sourceRoot, mirrorRoot, { recursive: true, force: true });
        return mirrorRoot;
      },
    });

    const expectedFallbackAliasRoot = path.win32.join(
      fallbackWindowsAliasWorkspaceRoot,
      '.cache',
      'short-mirrors',
      'openclaw',
    );
    if (resolvedFallbackAliasRoot !== expectedFallbackAliasRoot) {
      throw new Error(
        `Expected Windows OpenClaw alias fallback to switch to ${expectedFallbackAliasRoot}, received ${resolvedFallbackAliasRoot}`,
      );
    }
    if (fallbackRepairAttemptCount !== 2) {
      throw new Error(
        `Expected Windows OpenClaw alias fallback to attempt in-place repair and then retry against the fallback mirror root, received ${fallbackRepairAttemptCount} repair attempts`,
      );
    }

    const persistedFallbackAliasRoot = resolveBundledResourceMirrorRoot(
      fallbackWindowsAliasWorkspaceRoot,
      'openclaw',
      'win32',
    );
    if (persistedFallbackAliasRoot !== expectedFallbackAliasRoot) {
      throw new Error(
        `Expected Windows OpenClaw alias fallback to persist the fallback mirror base dir, received ${persistedFallbackAliasRoot}`,
      );
    }
  } finally {
    if (typeof priorWindowsFallbackMirrorBaseDir === 'string') {
      process.env.SDKWORK_WINDOWS_MIRROR_BASE_DIR = priorWindowsFallbackMirrorBaseDir;
    }
  }

  const staleFallbackWorkspaceRoot = path.join(tempRoot, 'workspace-root-stale-fallback-state');
  const staleFallbackStatePath = path.join(
    staleFallbackWorkspaceRoot,
    'packages',
    'sdkwork-agentstudio-pc-desktop',
    'src-tauri',
    'generated',
    'release',
    'windows-mirror-base-dir.json',
  );
  await mkdir(path.dirname(staleFallbackStatePath), { recursive: true });
  await writeFile(
    staleFallbackStatePath,
    `${JSON.stringify({
      mirrorBaseDir: path.win32.join('D:\\moved-workspace', '.cache', 'short-mirrors'),
    }, null, 2)}\n`,
  );
  const resolvedStaleFallbackAliasRoot = resolveBundledResourceMirrorRoot(
    staleFallbackWorkspaceRoot,
    'openclaw',
    'win32',
  );
  const expectedDefaultAliasRoot = path.win32.join(
    path.win32.parse(staleFallbackWorkspaceRoot).root,
    '.sdkwork-bc',
    path.win32.basename(staleFallbackWorkspaceRoot),
    'openclaw',
  );
  if (resolvedStaleFallbackAliasRoot !== expectedDefaultAliasRoot) {
    throw new Error(
      `Expected stale persisted Windows mirror fallback state to be ignored in favor of the current workspace default alias root ${expectedDefaultAliasRoot}, received ${resolvedStaleFallbackAliasRoot}`,
    );
  }

  await rm(mirroredResourceRoot, { recursive: true, force: true });

  const windowsNpm = resolveNodeRuntimeNpmCommand('C:\\runtime\\node', 'win32');
  if (!windowsNpm.command.toLowerCase().endsWith('cmd.exe')) {
    throw new Error(`Expected Windows command processor path, received ${windowsNpm.command}`);
  }
  if (
    windowsNpm.args.length < 4 ||
    windowsNpm.args[0] !== '/d' ||
    windowsNpm.args[1] !== '/s' ||
    windowsNpm.args[2] !== '/c' ||
    windowsNpm.args[3].toLowerCase() !== 'c:\\runtime\\node\\npm.cmd'
  ) {
    throw new Error(`Expected runtime Windows npm.cmd invocation, received ${windowsNpm.args.join(' ')}`);
  }

  const linuxNpm = resolveNodeRuntimeNpmCommand('/runtime/node', 'linux');
  if (linuxNpm.command.replaceAll('\\', '/') !== '/runtime/node/bin/npm') {
    throw new Error(`Expected runtime Unix npm path, received ${linuxNpm.command}`);
  }
  if (linuxNpm.args.length !== 0) {
    throw new Error(`Expected no extra Unix npm arguments, received ${linuxNpm.args.join(' ')}`);
  }

  const installSpecs = resolveOpenClawRuntimeInstallSpecs({
    openclawPackage: 'openclaw',
    openclawVersion: expectedOpenClawVersion,
    runtimeSupplementalPackages: DEFAULT_OPENCLAW_RUNTIME_SUPPLEMENTAL_PACKAGES,
  });
  if (
    installSpecs.length !== 3
    || installSpecs[0] !== `openclaw@${expectedOpenClawVersion}`
    || installSpecs[1] !== defaultRuntimeSupplementalPackages[0]
    || installSpecs[2] !== defaultRuntimeSupplementalPackages[1]
  ) {
    throw new Error(
      `Expected default install specs to include OpenClaw, official Feishu, and official QQ Bot, received ${installSpecs.join(', ')}`,
    );
  }
  const customInstallSpecs = resolveOpenClawRuntimeInstallSpecs({
    openclawPackage: 'openclaw',
    openclawVersion: expectedOpenClawVersion,
    runtimeSupplementalPackages: customRuntimeSupplementalPackages,
  });
  if (
    customInstallSpecs[0] !== `openclaw@${expectedOpenClawVersion}`
    || !customInstallSpecs.includes('@buape/carbon@0.14.0')
  ) {
    throw new Error(
      `Expected custom install specs to include OpenClaw and @buape/carbon@0.14.0, received ${customInstallSpecs.join(', ')}`,
    );
  }
  const missingBundledPluginRuntimeInstallSpecsRoot = path.join(
    tempRoot,
    'missing-bundled-plugin-runtime-install-specs-root',
  );
  const missingBundledPluginRuntimeInstallSpecsPackageRoot = path.join(
    missingBundledPluginRuntimeInstallSpecsRoot,
    'node_modules',
    'openclaw',
  );
  const missingBundledPluginRuntimeInstallSpecsPluginPackageJsonPath = path.join(
    missingBundledPluginRuntimeInstallSpecsPackageRoot,
    'dist',
    'extensions',
    'tlon',
    'package.json',
  );
  await mkdir(path.dirname(missingBundledPluginRuntimeInstallSpecsPluginPackageJsonPath), {
    recursive: true,
  });
  await writeFile(
    missingBundledPluginRuntimeInstallSpecsPluginPackageJsonPath,
    `${JSON.stringify(
      {
        name: '@openclaw/tlon',
        version: prereleaseOpenClawVersion,
        dependencies: {
          '@aws-sdk/client-s3': '3.1020.0',
          '@aws-sdk/s3-request-presigner': '3.1020.0',
        },
      },
      null,
      2,
    )}\n`,
  );
  const missingBundledPluginRuntimeInstallSpecs =
    await resolveMissingBundledPluginRuntimeInstallSpecs({
      packageRoot: missingBundledPluginRuntimeInstallSpecsPackageRoot,
      packageInstallRoot: missingBundledPluginRuntimeInstallSpecsRoot,
    });
  if (
    !missingBundledPluginRuntimeInstallSpecs.includes('@aws-sdk/client-s3@3.1020.0')
    || !missingBundledPluginRuntimeInstallSpecs.includes(
      '@aws-sdk/s3-request-presigner@3.1020.0',
    )
  ) {
    throw new Error(
      `Expected missing bundled plugin runtime install specs to include tlon dependencies, received ${missingBundledPluginRuntimeInstallSpecs.join(', ')}`,
    );
  }
  const pluginManifestOnlyRuntimeInstallSpecsRoot = path.join(
    tempRoot,
    'plugin-manifest-only-runtime-install-specs-root',
  );
  const pluginManifestOnlyPackageRoot = path.join(
    pluginManifestOnlyRuntimeInstallSpecsRoot,
    'node_modules',
    'openclaw',
  );
  const pluginManifestOnlyPackageJsonPath = path.join(
    pluginManifestOnlyPackageRoot,
    'dist',
    'extensions',
    'wecom',
    'package.json',
  );
  const pluginManifestOnlyManifestPath = path.join(
    pluginManifestOnlyPackageRoot,
    'dist',
    'extensions',
    'wecom',
    'openclaw.plugin.json',
  );
  await mkdir(path.dirname(pluginManifestOnlyPackageJsonPath), { recursive: true });
  await writeFile(
    pluginManifestOnlyPackageJsonPath,
    `${JSON.stringify(
      {
        name: '@openclaw/wecom',
        version: prereleaseOpenClawVersion,
        dependencies: {
          '@wecom/robot-sdk': '1.2.3',
        },
      },
      null,
      2,
    )}\n`,
  );
  await writeFile(
    pluginManifestOnlyManifestPath,
    `${JSON.stringify(
      {
        id: 'wecom',
        channelConfigs: {
          wecom: {
            label: 'WeCom',
          },
        },
      },
      null,
      2,
    )}\n`,
  );
  const pluginManifestOnlyRuntimeInstallSpecs =
    await resolveMissingBundledPluginRuntimeInstallSpecs({
      packageRoot: pluginManifestOnlyPackageRoot,
      packageInstallRoot: pluginManifestOnlyRuntimeInstallSpecsRoot,
    });
  if (!pluginManifestOnlyRuntimeInstallSpecs.includes('@wecom/robot-sdk@1.2.3')) {
    throw new Error(
      `Expected plugin manifest-only channelConfigs metadata to trigger runtime dependency discovery, received ${pluginManifestOnlyRuntimeInstallSpecs.join(', ')}`,
    );
  }
  const bundledPluginRuntimeHydrationTarget =
    resolveBundledPluginRuntimeHydrationTarget({
      installSpec: '@whiskeysockets/baileys@7.0.0-rc.9',
      packageJson: {
        name: '@whiskeysockets/baileys',
        version: '7.0.0-rc.9',
        dependencies: {
          '@cacheable/node-cache': '^1.4.0',
          '@hapi/boom': '^9.1.3',
          'async-mutex': '^0.5.0',
          libsignal: 'git+https://github.com/whiskeysockets/libsignal-node',
          'lru-cache': '^11.1.0',
          'music-metadata': '^11.7.0',
          'p-queue': '^9.0.0',
          pino: '^9.6',
          protobufjs: '^7.2.4',
          ws: '^8.13.0',
        },
      },
    });
  if (!bundledPluginRuntimeHydrationTarget) {
    throw new Error('Expected Baileys prepared runtime dependency hydration target to be resolved');
  }
  if (bundledPluginRuntimeHydrationTarget.packageName !== '@whiskeysockets/baileys') {
    throw new Error(
      `Expected hydration target packageName=@whiskeysockets/baileys, received ${bundledPluginRuntimeHydrationTarget.packageName}`,
    );
  }
  if (
    !bundledPluginRuntimeHydrationTarget.registryDependencyInstallSpecs.includes('protobufjs@^7.2.4')
    || bundledPluginRuntimeHydrationTarget.registryDependencyInstallSpecs.some((entry) =>
      entry.startsWith('libsignal@'),
    )
  ) {
    throw new Error(
      `Expected Baileys hydration target to keep registry deps and exclude libsignal from direct registry installs, received ${bundledPluginRuntimeHydrationTarget.registryDependencyInstallSpecs.join(', ')}`,
    );
  }
  const libsignalHydrationTarget = bundledPluginRuntimeHydrationTarget.gitDependencies.find(
    (entry) => entry.name === 'libsignal',
  );
  if (
    !libsignalHydrationTarget
    || libsignalHydrationTarget.cloneUrl !== 'https://github.com/whiskeysockets/libsignal-node.git'
    || libsignalHydrationTarget.cloneRef !== 'master'
  ) {
    throw new Error(
      `Expected Baileys hydration target to clone libsignal from GitHub master, received ${JSON.stringify(libsignalHydrationTarget)}`,
    );
  }
  const unsupportedBundledPluginRuntimeHydrationTarget =
    resolveBundledPluginRuntimeHydrationTarget({
      installSpec: '@example/custom-git-plugin@1.0.0',
      packageJson: {
        name: '@example/custom-git-plugin',
        version: '1.0.0',
        dependencies: {
          '@example/registry': '^1.0.0',
          '@example/git-runtime': 'git+https://github.com/example/git-runtime.git',
        },
      },
    });
  if (unsupportedBundledPluginRuntimeHydrationTarget !== null) {
    throw new Error('Expected unknown git-backed prepared runtime dependencies to avoid custom hydration');
  }
  const matrixNapiBinaryInstallSpec = resolveNapiPackageBinaryInstallSpec({
    packageJson: {
      name: '@matrix-org/matrix-sdk-crypto-nodejs',
      version: '0.4.0',
      napi: {
        name: 'matrix-sdk-crypto',
      },
    },
    platform: 'win32',
    arch: 'x64',
  });
  if (matrixNapiBinaryInstallSpec !== '@matrix-org/matrix-sdk-crypto-nodejs-win32-x64-msvc@0.4.0') {
    throw new Error(
      `Expected matrix napi binary install spec to target win32-x64-msvc, received ${matrixNapiBinaryInstallSpec}`,
    );
  }
  const matrixRuntimeCompanionInstallSpecs = resolveRuntimePackageCompanionInstallSpecs({
    packageJson: {
      name: '@matrix-org/matrix-sdk-crypto-nodejs',
      version: '0.5.1',
      napi: {
        name: 'matrix-sdk-crypto',
      },
    },
    platform: 'win32',
    arch: 'x64',
  });
  if (matrixRuntimeCompanionInstallSpecs.length !== 0) {
    throw new Error(
      `Expected Matrix native runtime assets to use the downloaded release binary instead of npm companion packages, received ${matrixRuntimeCompanionInstallSpecs.join(', ')}`,
    );
  }
  const tlonSkillScriptCompanionInstallSpec = resolveScriptCompanionPackageInstallSpec({
    packageJson: {
      name: '@tloncorp/tlon-skill',
      version: '0.3.1',
      optionalDependencies: {
        '@tloncorp/tlon-skill-darwin-arm64': '0.3.1',
        '@tloncorp/tlon-skill-darwin-x64': '0.3.1',
        '@tloncorp/tlon-skill-linux-x64': '0.3.1',
        '@tloncorp/tlon-skill-linux-arm64': '0.3.1',
      },
    },
    platform: 'linux',
    arch: 'x64',
  });
  if (tlonSkillScriptCompanionInstallSpec !== '@tloncorp/tlon-skill-linux-x64@0.3.1') {
    throw new Error(
      `Expected tlon-skill companion install spec to target linux-x64, received ${tlonSkillScriptCompanionInstallSpec}`,
    );
  }
  const unsupportedTlonSkillScriptCompanionInstallSpec = resolveScriptCompanionPackageInstallSpec({
    packageJson: {
      name: '@tloncorp/tlon-skill',
      version: '0.3.1',
      optionalDependencies: {
        '@tloncorp/tlon-skill-darwin-arm64': '0.3.1',
        '@tloncorp/tlon-skill-darwin-x64': '0.3.1',
        '@tloncorp/tlon-skill-linux-x64': '0.3.1',
        '@tloncorp/tlon-skill-linux-arm64': '0.3.1',
      },
    },
    platform: 'win32',
    arch: 'x64',
  });
  if (unsupportedTlonSkillScriptCompanionInstallSpec !== null) {
    throw new Error(
      `Expected tlon-skill companion install spec to skip unsupported win32 targets, received ${unsupportedTlonSkillScriptCompanionInstallSpec}`,
    );
  }
  const runtimeCompanionInstallSpecs = resolveRuntimePackageCompanionInstallSpecs({
    packageJson: {
      name: '@tloncorp/tlon-skill',
      version: '0.3.1',
      optionalDependencies: {
        '@tloncorp/tlon-skill-darwin-arm64': '0.3.1',
        '@tloncorp/tlon-skill-darwin-x64': '0.3.1',
        '@tloncorp/tlon-skill-linux-x64': '0.3.1',
        '@tloncorp/tlon-skill-linux-arm64': '0.3.1',
      },
    },
    platform: 'darwin',
    arch: 'arm64',
  });
  if (
    runtimeCompanionInstallSpecs.length !== 1
    || runtimeCompanionInstallSpecs[0] !== '@tloncorp/tlon-skill-darwin-arm64@0.3.1'
  ) {
    throw new Error(
      `Expected runtime companion install specs to include the tlon-skill darwin-arm64 sidecar, received ${runtimeCompanionInstallSpecs.join(', ')}`,
    );
  }
  const missingRuntimeCompanionInstallRoot = path.join(
    tempRoot,
    'missing-runtime-companion-install-root',
  );
  const missingRuntimeCompanionPackageJsonPath = path.join(
    missingRuntimeCompanionInstallRoot,
    'node_modules',
    '@tloncorp',
    'tlon-skill',
    'package.json',
  );
  await mkdir(path.dirname(missingRuntimeCompanionPackageJsonPath), { recursive: true });
  await writeFile(
    missingRuntimeCompanionPackageJsonPath,
    `${JSON.stringify(
      {
        name: '@tloncorp/tlon-skill',
        version: '0.3.1',
        optionalDependencies: {
          '@tloncorp/tlon-skill-darwin-arm64': '0.3.1',
          '@tloncorp/tlon-skill-darwin-x64': '0.3.1',
          '@tloncorp/tlon-skill-linux-x64': '0.3.1',
          '@tloncorp/tlon-skill-linux-arm64': '0.3.1',
        },
      },
      null,
      2,
    )}\n`,
  );
  const missingRuntimeCompanionInstallSpecs = await resolveMissingRuntimeCompanionInstallSpecs({
    packageInstallRoot: missingRuntimeCompanionInstallRoot,
    installSpecs: ['@tloncorp/tlon-skill@0.3.1'],
    platform: 'linux',
    arch: 'x64',
  });
  if (
    missingRuntimeCompanionInstallSpecs.length !== 1
    || missingRuntimeCompanionInstallSpecs[0] !== '@tloncorp/tlon-skill-linux-x64@0.3.1'
  ) {
    throw new Error(
      `Expected missing runtime companion install specs to include the tlon-skill linux-x64 sidecar, received ${missingRuntimeCompanionInstallSpecs.join(', ')}`,
    );
  }
  const missingMatrixRuntimeCompanionInstallRoot = path.join(
    tempRoot,
    'missing-matrix-runtime-companion-install-root',
  );
  const missingMatrixRuntimeCompanionPackageJsonPath = path.join(
    missingMatrixRuntimeCompanionInstallRoot,
    'node_modules',
    '@matrix-org',
    'matrix-sdk-crypto-nodejs',
    'package.json',
  );
  await mkdir(path.dirname(missingMatrixRuntimeCompanionPackageJsonPath), { recursive: true });
  await writeFile(
    missingMatrixRuntimeCompanionPackageJsonPath,
    `${JSON.stringify(
      {
        name: '@matrix-org/matrix-sdk-crypto-nodejs',
        version: '0.5.1',
        napi: {
          name: 'matrix-sdk-crypto',
        },
      },
      null,
      2,
    )}\n`,
  );
  const missingMatrixRuntimeCompanionInstallSpecs =
    await resolveMissingRuntimeCompanionInstallSpecs({
      packageInstallRoot: missingMatrixRuntimeCompanionInstallRoot,
      installSpecs: ['@matrix-org/matrix-sdk-crypto-nodejs@0.5.1'],
      platform: 'win32',
      arch: 'x64',
    });
  if (missingMatrixRuntimeCompanionInstallSpecs.length !== 0) {
    throw new Error(
      `Expected missing Matrix runtime companions to be staged by downloaded native assets, received ${missingMatrixRuntimeCompanionInstallSpecs.join(', ')}`,
    );
  }
  const matrixDownloadedNativeRuntimeAsset = resolveDownloadedNativeRuntimeAsset({
    packageJson: {
      name: '@matrix-org/matrix-sdk-crypto-nodejs',
      version: '0.4.0',
    },
    platform: 'win32',
    arch: 'x64',
  });
  if (!matrixDownloadedNativeRuntimeAsset) {
    throw new Error('Expected Matrix crypto package to resolve a downloaded native runtime asset');
  }
  if (
    matrixDownloadedNativeRuntimeAsset.assetFileName !== 'matrix-sdk-crypto.win32-x64-msvc.node'
    || matrixDownloadedNativeRuntimeAsset.destinationRelativePath !== 'matrix-sdk-crypto.win32-x64-msvc.node'
    || matrixDownloadedNativeRuntimeAsset.downloadUrl
      !== 'https://github.com/matrix-org/matrix-rust-sdk-crypto-nodejs/releases/download/v0.4.0/matrix-sdk-crypto.win32-x64-msvc.node'
  ) {
    throw new Error(
      `Expected Matrix downloaded native runtime asset to target the win32-x64-msvc GitHub release binary, received ${JSON.stringify(matrixDownloadedNativeRuntimeAsset)}`,
    );
  }
  const matrixDownloadedNativeRuntimePackageDir = path.join(
    tempRoot,
    'matrix-downloaded-native-runtime-package',
  );
  await mkdir(matrixDownloadedNativeRuntimePackageDir, { recursive: true });
  const matrixDownloadedNativeRuntimeResult = await stageDownloadedNativeRuntimeAsset({
    packageDir: matrixDownloadedNativeRuntimePackageDir,
    runtimeAsset: matrixDownloadedNativeRuntimeAsset,
    fetchImpl: async (url) => {
      if (url !== matrixDownloadedNativeRuntimeAsset.downloadUrl) {
        throw new Error(`Expected Matrix native runtime asset download URL ${matrixDownloadedNativeRuntimeAsset.downloadUrl}, received ${url}`);
      }
      return new Response('matrix-native-binary');
    },
  });
  if (!matrixDownloadedNativeRuntimeResult.downloaded) {
    throw new Error('Expected Matrix native runtime asset staging to download the missing binary');
  }
  const matrixDownloadedNativeRuntimeDestinationPath = path.join(
    matrixDownloadedNativeRuntimePackageDir,
    'matrix-sdk-crypto.win32-x64-msvc.node',
  );
  const matrixDownloadedNativeRuntimeValue = await readFile(
    matrixDownloadedNativeRuntimeDestinationPath,
    'utf8',
  );
  if (matrixDownloadedNativeRuntimeValue !== 'matrix-native-binary') {
    throw new Error(
      `Expected staged Matrix native runtime asset to contain the downloaded payload, received ${matrixDownloadedNativeRuntimeValue}`,
    );
  }
  const expectedDiscordJsOpusPrebuildDirName =
    `node-v${process.versions.modules}-napi-v3-win32-x64-unknown-unknown`;
  const expectedDiscordJsOpusArchiveFileName =
    `opus-v0.10.0-${expectedDiscordJsOpusPrebuildDirName}.tar.gz`;
  const opusDownloadedNativeRuntimeAsset = resolveDownloadedNativeRuntimeAsset({
    packageJson: {
      name: '@discordjs/opus',
      version: '0.10.0',
      binary: {
        module_name: 'opus',
        module_path: './prebuild/{node_abi}-napi-v{napi_build_version}-{platform}-{arch}-{libc}-{libc_version}/',
        remote_path: 'v{version}',
        package_name: '{module_name}-v{version}-{node_abi}-napi-v{napi_build_version}-{platform}-{arch}-{libc}-{libc_version}.tar.gz',
        host: 'https://github.com/discordjs/opus/releases/download/',
        napi_versions: [3],
      },
    },
    platform: 'win32',
    arch: 'x64',
  });
  if (!opusDownloadedNativeRuntimeAsset) {
    throw new Error('Expected @discordjs/opus to resolve a downloaded native runtime asset');
  }
  if (
    opusDownloadedNativeRuntimeAsset.assetFileName !== expectedDiscordJsOpusArchiveFileName
    || opusDownloadedNativeRuntimeAsset.destinationRelativePath
      !== path.join('prebuild', expectedDiscordJsOpusPrebuildDirName, 'opus.node')
    || opusDownloadedNativeRuntimeAsset.downloadUrl
      !== `https://github.com/discordjs/opus/releases/download/v0.10.0/${expectedDiscordJsOpusArchiveFileName}`
  ) {
    throw new Error(
      `Expected @discordjs/opus downloaded native runtime asset to target the win32-x64 prebuild archive, received ${JSON.stringify(opusDownloadedNativeRuntimeAsset)}`,
    );
  }
  const opusDownloadedNativeRuntimePackageDir = path.join(
    tempRoot,
    'opus-downloaded-native-runtime-package',
  );
  const opusDownloadedNativeRuntimeArchiveSourceDir = path.join(
    tempRoot,
    'opus-downloaded-native-runtime-archive-source',
  );
  const opusDownloadedNativeRuntimeArchiveEntryDir = path.join(
    opusDownloadedNativeRuntimeArchiveSourceDir,
    expectedDiscordJsOpusPrebuildDirName,
  );
  await mkdir(opusDownloadedNativeRuntimePackageDir, { recursive: true });
  await mkdir(opusDownloadedNativeRuntimeArchiveEntryDir, { recursive: true });
  await writeFile(
    path.join(opusDownloadedNativeRuntimeArchiveEntryDir, 'opus.node'),
    'opus-native-binary',
  );
  await writeFile(
    path.join(opusDownloadedNativeRuntimeArchiveEntryDir, 'opus.lib'),
    'opus-import-library',
  );
  const opusDownloadedNativeRuntimeArchivePath = path.join(
    tempRoot,
    expectedDiscordJsOpusArchiveFileName,
  );
  await writeFile(
    opusDownloadedNativeRuntimeArchivePath,
    createTarGzArchiveBuffer([
      createTarRecord({
        name: path.posix.join(expectedDiscordJsOpusPrebuildDirName, 'opus.node'),
        content: 'opus-native-binary',
      }),
      createTarRecord({
        name: path.posix.join(expectedDiscordJsOpusPrebuildDirName, 'opus.lib'),
        content: 'opus-import-library',
      }),
    ]),
  );
  const opusDownloadedNativeRuntimeArchiveBuffer = await readFile(
    opusDownloadedNativeRuntimeArchivePath,
  );
  const opusDownloadedNativeRuntimeResult = await stageDownloadedNativeRuntimeAsset({
    packageDir: opusDownloadedNativeRuntimePackageDir,
    runtimeAsset: opusDownloadedNativeRuntimeAsset,
    fetchImpl: async (url) => {
      if (url !== opusDownloadedNativeRuntimeAsset.downloadUrl) {
        throw new Error(
          `Expected @discordjs/opus native runtime asset download URL ${opusDownloadedNativeRuntimeAsset.downloadUrl}, received ${url}`,
        );
      }
      return new Response(opusDownloadedNativeRuntimeArchiveBuffer);
    },
  });
  if (!opusDownloadedNativeRuntimeResult.downloaded) {
    throw new Error(
      'Expected @discordjs/opus native runtime asset staging to download and extract the missing prebuild archive',
    );
  }
  const opusDownloadedNativeRuntimeDestinationDir = path.join(
    opusDownloadedNativeRuntimePackageDir,
    'prebuild',
    expectedDiscordJsOpusPrebuildDirName,
  );
  const opusDownloadedNativeRuntimeNodeBinaryPath = path.join(
    opusDownloadedNativeRuntimeDestinationDir,
    'opus.node',
  );
  const opusDownloadedNativeRuntimeImportLibraryPath = path.join(
    opusDownloadedNativeRuntimeDestinationDir,
    'opus.lib',
  );
  const opusDownloadedNativeRuntimeNodeBinaryValue = await readFile(
    opusDownloadedNativeRuntimeNodeBinaryPath,
    'utf8',
  );
  if (opusDownloadedNativeRuntimeNodeBinaryValue !== 'opus-native-binary') {
    throw new Error(
      `Expected staged @discordjs/opus native runtime archive to contain the downloaded binary, received ${opusDownloadedNativeRuntimeNodeBinaryValue}`,
    );
  }
  const opusDownloadedNativeRuntimeImportLibraryStat = await stat(
    opusDownloadedNativeRuntimeImportLibraryPath,
  );
  if (!opusDownloadedNativeRuntimeImportLibraryStat.isFile()) {
    throw new Error(
      'Expected staged @discordjs/opus native runtime archive extraction to preserve archive sidecar files',
    );
  }
  const opusDownloadedNativeRuntimeFallbackPackageDir = path.join(
    tempRoot,
    'opus-downloaded-native-runtime-fallback-package',
  );
  await mkdir(opusDownloadedNativeRuntimeFallbackPackageDir, { recursive: true });
  const opusDownloadedNativeRuntimeFallbackResult = await stageDownloadedNativeRuntimeAsset({
    packageDir: opusDownloadedNativeRuntimeFallbackPackageDir,
    runtimeAsset: opusDownloadedNativeRuntimeAsset,
    fetchImpl: async () => {
      const error = new TypeError('fetch failed');
      error.cause = new Error('connect ETIMEDOUT 20.205.243.166:443');
      throw error;
    },
    nativeBuildFallbackImpl: async ({ destinationPath }) => {
      await mkdir(path.dirname(destinationPath), { recursive: true });
      await writeFile(destinationPath, 'opus-native-binary-built');
      return {
        built: true,
        strategy: 'npm-rebuild',
      };
    },
  });
  if (!opusDownloadedNativeRuntimeFallbackResult.built) {
    throw new Error(
      'Expected @discordjs/opus native runtime staging to surface build fallback completion after download failure',
    );
  }
  if (opusDownloadedNativeRuntimeFallbackResult.fallbackStrategy !== 'npm-rebuild') {
    throw new Error(
      `Expected @discordjs/opus native runtime staging to report npm-rebuild fallback, received ${opusDownloadedNativeRuntimeFallbackResult.fallbackStrategy}`,
    );
  }
  const opusDownloadedNativeRuntimeFallbackBinaryPath = path.join(
    opusDownloadedNativeRuntimeFallbackPackageDir,
    'prebuild',
    expectedDiscordJsOpusPrebuildDirName,
    'opus.node',
  );
  const opusDownloadedNativeRuntimeFallbackBinaryValue = await readFile(
    opusDownloadedNativeRuntimeFallbackBinaryPath,
    'utf8',
  );
  if (opusDownloadedNativeRuntimeFallbackBinaryValue !== 'opus-native-binary-built') {
    throw new Error(
      `Expected @discordjs/opus native runtime fallback build output to be materialized, received ${opusDownloadedNativeRuntimeFallbackBinaryValue}`,
    );
  }
  const optionalNativeRuntimeInstallRoot = path.join(
    tempRoot,
    'optional-native-runtime-install-root',
  );
  const optionalNativeRuntimeModulesRoot = path.join(optionalNativeRuntimeInstallRoot, 'node_modules');
  const optionalNativeRuntimeOpenClawDir = path.join(optionalNativeRuntimeModulesRoot, 'openclaw');
  const optionalNativeRuntimeMatrixDir = path.join(
    optionalNativeRuntimeModulesRoot,
    '@matrix-org',
    'matrix-sdk-crypto-nodejs',
  );
  await mkdir(optionalNativeRuntimeOpenClawDir, { recursive: true });
  await mkdir(optionalNativeRuntimeMatrixDir, { recursive: true });
  await writeFile(
    path.join(optionalNativeRuntimeOpenClawDir, 'package.json'),
    `${JSON.stringify(
      {
        name: 'openclaw',
        version: expectedOpenClawVersion,
        optionalDependencies: {
          '@matrix-org/matrix-sdk-crypto-nodejs': '0.4.0',
        },
        pnpm: {
          onlyBuiltDependencies: ['@matrix-org/matrix-sdk-crypto-nodejs'],
        },
      },
      null,
      2,
    )}\n`,
  );
  await writeFile(
    path.join(optionalNativeRuntimeMatrixDir, 'package.json'),
    `${JSON.stringify(
      {
        name: '@matrix-org/matrix-sdk-crypto-nodejs',
        version: '0.4.0',
        main: 'index.js',
      },
      null,
      2,
    )}\n`,
  );
  await writeFile(
    path.join(optionalNativeRuntimeMatrixDir, 'index.js'),
    "module.exports = require('./matrix-sdk-crypto.win32-x64-msvc.node');\n",
  );
  await validatePreparedOpenClawPackageTree({
    packageRoot: optionalNativeRuntimeOpenClawDir,
    packageInstallRoot: optionalNativeRuntimeInstallRoot,
    modulesRoot: optionalNativeRuntimeModulesRoot,
    expectedOpenClawVersion,
    runtimeSupplementalPackages: [],
  });
  const hydratedBundledPluginRuntimeInstallRoot = path.join(
    tempRoot,
    'hydrated-bundled-plugin-runtime-install-root',
  );
  const stagedBundledPluginRuntimePackageDir = path.join(
    tempRoot,
    'staged-bundled-plugin-runtime-package',
  );
  const stagedBundledPluginRuntimeGitDependencyDir = path.join(
    tempRoot,
    'staged-bundled-plugin-runtime-libsignal',
  );
  await mkdir(stagedBundledPluginRuntimePackageDir, { recursive: true });
  await mkdir(stagedBundledPluginRuntimeGitDependencyDir, { recursive: true });
  await writeFile(
    path.join(stagedBundledPluginRuntimePackageDir, 'package.json'),
    `${JSON.stringify(
      {
        name: '@whiskeysockets/baileys',
        version: '7.0.0-rc.9',
        dependencies: {
          '@cacheable/node-cache': '^1.4.0',
          libsignal: 'git+https://github.com/whiskeysockets/libsignal-node',
          protobufjs: '^7.2.4',
        },
      },
      null,
      2,
    )}\n`,
  );
  await writeFile(
    path.join(stagedBundledPluginRuntimePackageDir, 'index.js'),
    'module.exports = "baileys";\n',
  );
  await writeFile(
    path.join(stagedBundledPluginRuntimeGitDependencyDir, 'package.json'),
    `${JSON.stringify(
      {
        name: '@whiskeysockets/libsignal-node',
        version: '2.0.1',
        dependencies: {
          'curve25519-js': '^0.0.4',
          protobufjs: '6.8.8',
        },
      },
      null,
      2,
    )}\n`,
  );
  await writeFile(
    path.join(stagedBundledPluginRuntimeGitDependencyDir, 'index.js'),
    'module.exports = "libsignal";\n',
  );
  const hydratedBundledPluginRuntimeInstallCalls = [];
  await hydrateBundledPluginRuntimeDependency({
    hydrationTarget: bundledPluginRuntimeHydrationTarget,
    packageInstallRoot: hydratedBundledPluginRuntimeInstallRoot,
    cacheDir: path.join(tempRoot, 'hydrated-bundled-plugin-runtime-cache'),
    stageRegistryPackageImpl: async () => stagedBundledPluginRuntimePackageDir,
    cloneGitDependencyImpl: async () => stagedBundledPluginRuntimeGitDependencyDir,
    installPackageDependenciesImpl: async ({ packageDir, installSpecs }) => {
      hydratedBundledPluginRuntimeInstallCalls.push({
        packageDir,
        installSpecs: [...installSpecs].sort(),
      });
    },
  });
  const hydratedBundledPluginRuntimePackageJsonPath = path.join(
    hydratedBundledPluginRuntimeInstallRoot,
    'node_modules',
    '@whiskeysockets',
    'baileys',
    'package.json',
  );
  const hydratedBundledPluginRuntimeGitPackageJsonPath = path.join(
    hydratedBundledPluginRuntimeInstallRoot,
    'node_modules',
    '@whiskeysockets',
    'baileys',
    'node_modules',
    'libsignal',
    'package.json',
  );
  await stat(hydratedBundledPluginRuntimePackageJsonPath);
  await stat(hydratedBundledPluginRuntimeGitPackageJsonPath);
  const directHydrationInstallCall = hydratedBundledPluginRuntimeInstallCalls.find(
    (entry) => entry.packageDir === stagedBundledPluginRuntimePackageDir,
  );
  if (
    !directHydrationInstallCall
    || !directHydrationInstallCall.installSpecs.includes('@cacheable/node-cache@^1.4.0')
    || !directHydrationInstallCall.installSpecs.includes('protobufjs@^7.2.4')
  ) {
    throw new Error(
      `Expected prepared runtime hydration to install direct registry dependencies inside the staged package dir, received ${JSON.stringify(hydratedBundledPluginRuntimeInstallCalls)}`,
    );
  }
  const gitHydrationInstallCall = hydratedBundledPluginRuntimeInstallCalls.find(
    (entry) => entry.packageDir === stagedBundledPluginRuntimeGitDependencyDir,
  );
  if (
    !gitHydrationInstallCall
    || !gitHydrationInstallCall.installSpecs.includes('curve25519-js@^0.0.4')
    || !gitHydrationInstallCall.installSpecs.includes('protobufjs@6.8.8')
  ) {
    throw new Error(
      `Expected prepared runtime hydration to install cloned git dependency registry dependencies inside the staged git dir, received ${JSON.stringify(hydratedBundledPluginRuntimeInstallCalls)}`,
    );
  }

  const tarResolvedHydrationInstallRoot = path.join(
    tempRoot,
    'tar-resolved-hydrated-bundled-plugin-runtime-install-root',
  );
  const tarResolvedCacheDir = path.join(
    tempRoot,
    'tar-resolved-hydrated-bundled-plugin-runtime-cache',
  );
  const tarResolvedCommandCalls = [];
  const tarResolvedExpectedCommand = resolveOpenClawRuntimeSystemCommand(
    'tar',
    'win32',
    process.env,
  );
  await hydrateBundledPluginRuntimeDependency({
    hydrationTarget: bundledPluginRuntimeHydrationTarget,
    packageInstallRoot: tarResolvedHydrationInstallRoot,
    runtimeNpm: {
      command: 'npm',
      args: [],
    },
    baseEnv: process.env,
    cacheDir: tarResolvedCacheDir,
    platform: 'win32',
    runCommandImpl: async (command, args) => {
      tarResolvedCommandCalls.push({ command, args: [...args] });
      if (command === 'npm' && args.includes('pack')) {
        const packDestination = args[args.indexOf('--pack-destination') + 1];
        await mkdir(packDestination, { recursive: true });
        await writeFile(
          path.join(packDestination, 'whiskeysockets-baileys-7.0.0-rc.9.tgz'),
          'placeholder tarball',
        );
        return;
      }

      if (args.includes('-xf')) {
        const extractRoot = args[args.indexOf('-C') + 1];
        const extractedPackageDir = path.join(extractRoot, 'package');
        await mkdir(extractedPackageDir, { recursive: true });
        await writeFile(
          path.join(extractedPackageDir, 'package.json'),
          `${JSON.stringify(
            {
              name: '@whiskeysockets/baileys',
              version: '7.0.0-rc.9',
              dependencies: {
                '@cacheable/node-cache': '^1.4.0',
                libsignal: 'git+https://github.com/whiskeysockets/libsignal-node',
                protobufjs: '^7.2.4',
              },
            },
            null,
            2,
          )}\n`,
        );
        return;
      }
    },
    cloneGitDependencyImpl: async () => {
      const stagedGitDependencyDir = path.join(
        tempRoot,
        'tar-resolved-hydrated-bundled-plugin-runtime-libsignal',
      );
      await mkdir(stagedGitDependencyDir, { recursive: true });
      await writeFile(
        path.join(stagedGitDependencyDir, 'package.json'),
        `${JSON.stringify(
          {
            name: '@whiskeysockets/libsignal-node',
            version: '2.0.1',
            dependencies: {
              'curve25519-js': '^0.0.4',
            },
          },
          null,
          2,
        )}\n`,
      );
      return stagedGitDependencyDir;
    },
    installPackageDependenciesImpl: async () => {},
  });
  const tarExtractionCall = tarResolvedCommandCalls.find((entry) =>
    entry.args.includes('-xf')
  );
  if (!tarExtractionCall) {
    throw new Error('Expected prepared runtime package staging to extract the packed tarball');
  }
  if (tarExtractionCall.command.toLowerCase() !== tarResolvedExpectedCommand.toLowerCase()) {
    throw new Error(
      `Expected prepared runtime package staging to resolve Windows tar through the system command resolver, received ${tarExtractionCall.command}`,
    );
  }

  const installEnv = buildOpenClawRuntimeInstallEnv({
    PATH: 'C:\\runtime\\node',
    npm_config_cache: 'D:\\workspace\\.cache\\npm-cache',
  });
  if (installEnv.PATH !== 'C:\\runtime\\node') {
    throw new Error(`Expected runtime install env to preserve PATH, received ${installEnv.PATH}`);
  }
  if (installEnv.npm_config_cache !== 'D:\\workspace\\.cache\\npm-cache') {
    throw new Error(
      `Expected runtime install env to preserve npm_config_cache, received ${installEnv.npm_config_cache}`,
    );
  }
  if (installEnv.OPENCLAW_DISABLE_BUNDLED_PLUGIN_POSTINSTALL !== '1') {
    throw new Error(
      `Expected runtime install env to disable bundled plugin postinstall, received ${installEnv.OPENCLAW_DISABLE_BUNDLED_PLUGIN_POSTINSTALL}`,
    );
  }
  const managedInstallEnv = buildOpenClawRuntimeInstallEnv(
    {
      PATH: 'C:\\runtime\\node',
      TEMP: 'C:\\Users\\admin\\AppData\\Local\\Temp',
      TMP: 'C:\\Users\\admin\\AppData\\Local\\Temp',
    },
    {
      cacheDir: 'C:\\.sdkwork-bc\\agent-studio\\openclaw-cache',
      platform: 'win32',
    },
  );
  if (managedInstallEnv.npm_config_cache?.toLowerCase() !== 'c:\\.sdkwork-bc\\agent-studio\\openclaw-cache\\npm-cache') {
    throw new Error(
      `Expected runtime install env to force a short npm cache path, received ${managedInstallEnv.npm_config_cache}`,
    );
  }
  if (managedInstallEnv.TEMP?.toLowerCase() !== 'c:\\.sdkwork-bc\\agent-studio\\openclaw-cache\\tmp') {
    throw new Error(
      `Expected runtime install env to force a short TEMP path, received ${managedInstallEnv.TEMP}`,
    );
  }
  if (managedInstallEnv.TMP?.toLowerCase() !== 'c:\\.sdkwork-bc\\agent-studio\\openclaw-cache\\tmp') {
    throw new Error(
      `Expected runtime install env to force a short TMP path, received ${managedInstallEnv.TMP}`,
    );
  }

  const prepareScriptSource = await readFile(prepareScriptPath, 'utf8');
  if (
    !/const\s+runtimeInstallEnv\s*=\s*buildOpenClawRuntimeInstallEnv\(\s*process\.env\s*,[\s\S]*?cacheDir[\s\S]*?platform:\s*target\.platformId[\s\S]*?\)/u.test(prepareScriptSource)
    || !/env:\s*runtimeInstallEnv/u.test(prepareScriptSource)
  ) {
    throw new Error(
      'Expected prepare-openclaw-runtime to install OpenClaw with a runtime install env that uses the active prepare cache dir and platform',
    );
  }
  if (!/['"]--ignore-scripts['"]/u.test(prepareScriptSource)) {
    throw new Error(
      'Expected prepare-openclaw-runtime to install packaged OpenClaw packages with --ignore-scripts so runtime preparation stays deterministic and sandbox-safe',
    );
  }

  const requestedWindowsTarget = resolveRequestedOpenClawTarget({
    env: {
      SDKWORK_DESKTOP_TARGET: 'x86_64-pc-windows-msvc',
      SDKWORK_DESKTOP_TARGET_PLATFORM: 'windows',
      SDKWORK_DESKTOP_TARGET_ARCH: 'x64',
    },
  });
  if (requestedWindowsTarget.platformId !== 'windows' || requestedWindowsTarget.archId !== 'x64') {
    throw new Error(
      `Expected release env target resolution to return windows-x64, received ${requestedWindowsTarget.platformId}-${requestedWindowsTarget.archId}`,
    );
  }

  const windowsCacheDir = resolveDefaultOpenClawPrepareCacheDir({
    workspaceRootDir: 'C:\\workspaces\\agent-studio',
    platform: 'win32',
    localAppData: 'C:\\Users\\admin\\AppData\\Local',
    homeDir: 'C:\\Users\\admin',
  });
  if (windowsCacheDir.toLowerCase() !== 'c:\\.sdkwork-bc\\agent-studio\\openclaw-cache') {
    throw new Error(`Expected short Windows cache dir, received ${windowsCacheDir}`);
  }
  const envOverrideCacheDir = resolveDefaultOpenClawPrepareCacheDir({
    workspaceRootDir: 'C:\\workspaces\\agent-studio',
    platform: 'win32',
    env: {
      OPENCLAW_PREPARE_CACHE_DIR: 'D:\\workspace\\agent-studio\\.cache\\openclaw-cache',
    },
    localAppData: 'C:\\Users\\admin\\AppData\\Local',
    homeDir: 'C:\\Users\\admin',
  });
  if (envOverrideCacheDir.toLowerCase() !== 'd:\\workspace\\agent-studio\\.cache\\openclaw-cache') {
    throw new Error(`Expected OPENCLAW_PREPARE_CACHE_DIR to override the default prepare cache dir, received ${envOverrideCacheDir}`);
  }

  if (typeof shouldRetryOpenClawRuntimeOperationError !== 'function') {
    throw new Error(
      'Expected shouldRetryOpenClawRuntimeOperationError to be exported for transient OpenClaw runtime install retry decisions',
    );
  }
  if (!shouldRetryOpenClawRuntimeOperationError(new Error('npm install failed: ECONNRESET network aborted'))) {
    throw new Error('Expected ECONNRESET runtime install failures to be retried');
  }
  if (shouldRetryOpenClawRuntimeOperationError(new Error('Prepared OpenClaw package.json version mismatch'))) {
    throw new Error('Expected manifest/data integrity errors to avoid retry classification');
  }

  if (typeof retryOpenClawRuntimeOperation !== 'function') {
    throw new Error('Expected retryOpenClawRuntimeOperation to be exported for runtime install retry handling');
  }
  let runtimeRetryAttempts = 0;
  const runtimeRetryResult = await retryOpenClawRuntimeOperation(
    async () => {
      runtimeRetryAttempts += 1;
      if (runtimeRetryAttempts < 3) {
        throw new Error('network aborted: ECONNRESET');
      }
      return 'ready';
    },
    {
      retries: 3,
      retryDelayMs: 0,
      logger: () => {},
    },
  );
  if (runtimeRetryResult !== 'ready') {
    throw new Error(`Expected runtime retry helper to return the successful result, received ${runtimeRetryResult}`);
  }
  if (runtimeRetryAttempts !== 3) {
    throw new Error(`Expected runtime retry helper to retry twice before success, received ${runtimeRetryAttempts} attempts`);
  }

  let nonRetryAttempts = 0;
  let nonRetryError;
  try {
    await retryOpenClawRuntimeOperation(
      async () => {
        nonRetryAttempts += 1;
        throw new Error('Prepared OpenClaw package.json version mismatch');
      },
      {
        retries: 3,
        retryDelayMs: 0,
        logger: () => {},
      },
    );
    throw new Error('Expected non-transient runtime errors to surface without retries');
  } catch (error) {
    nonRetryError = error;
  }
  if (nonRetryAttempts !== 1) {
    throw new Error(`Expected non-transient runtime errors to skip retries, received ${nonRetryAttempts} attempts`);
  }
  if (!(nonRetryError instanceof Error) || !nonRetryError.message.includes('version mismatch')) {
    throw new Error(`Expected non-transient runtime retry error to be preserved, received ${String(nonRetryError)}`);
  }

  const cachedNodeRuntimeDir = path.join(tempRoot, 'cached-node-runtime');
  const cachedNodeExecutablePath = path.join(cachedNodeRuntimeDir, 'node.exe');
  const cachedNodeNpmCliPath = path.join(
    cachedNodeRuntimeDir,
    'node_modules',
    'npm',
    'bin',
    'npm-cli.js',
  );
  const cachedNodeNpmPrefixPath = path.join(
    cachedNodeRuntimeDir,
    'node_modules',
    'npm',
    'bin',
    'npm-prefix.js',
  );
  const cachedNodeSidecarManifestPath = path.join(
    cachedNodeRuntimeDir,
    cachedNodeRuntimeSidecarManifestRelativePath,
  );

  await mkdir(path.dirname(cachedNodeExecutablePath), { recursive: true });
  await mkdir(path.dirname(cachedNodeNpmCliPath), { recursive: true });
  await mkdir(path.dirname(cachedNodeNpmPrefixPath), { recursive: true });
  await writeFile(cachedNodeExecutablePath, 'not-a-real-node-runtime');
  await writeFile(path.join(cachedNodeRuntimeDir, 'npm.cmd'), '@echo off\r\n');
  await writeFile(cachedNodeNpmCliPath, 'module.exports = {};\n');
  await writeFile(cachedNodeNpmPrefixPath, 'module.exports = {};\n');
  await writeFile(
    cachedNodeSidecarManifestPath,
    `${JSON.stringify(
      {
        schemaVersion: 1,
        nodeVersion: expectedNodeVersion,
        platform: 'windows',
        arch: 'x64',
        nodeBinaryRelativePath: 'runtime/node/node.exe',
      },
      null,
      2,
    )}\n`,
  );

  if (typeof inspectCachedNodeRuntimeDir !== 'function') {
    throw new Error('Expected inspectCachedNodeRuntimeDir to be exported for cached node runtime verification');
  }

  const cachedNodeInspection = await inspectCachedNodeRuntimeDir({
    nodeSourceDir: cachedNodeRuntimeDir,
    target,
    nodeVersion: expectedNodeVersion,
  });
  if (!cachedNodeInspection.reusable || cachedNodeInspection.reason !== 'ready') {
    throw new Error(
      `Expected cached node runtime sidecar metadata to allow reuse, received ${JSON.stringify(cachedNodeInspection)}`,
    );
  }

  await writeFile(
    cachedNodeSidecarManifestPath,
    `${JSON.stringify(
      {
        schemaVersion: 1,
        nodeVersion: expectedNodeVersion,
        platform: 'windows',
        arch: 'x64',
        nodeRelativePath: 'runtime/node/node.exe',
      },
      null,
      2,
    )}\n`,
  );

  const legacyCachedNodeInspection = await inspectCachedNodeRuntimeDir({
    nodeSourceDir: cachedNodeRuntimeDir,
    target,
    nodeVersion: expectedNodeVersion,
  });
  if (legacyCachedNodeInspection.reusable || legacyCachedNodeInspection.reason !== 'node-sidecar-mismatch') {
    throw new Error(
      `Expected legacy cached node runtime sidecar metadata to be rejected after the hard cut, received ${JSON.stringify(legacyCachedNodeInspection)}`,
    );
  }

  await rm(cachedNodeSidecarManifestPath);
  const missingSidecarCachedNodeInspection = await inspectCachedNodeRuntimeDir({
    nodeSourceDir: cachedNodeRuntimeDir,
    target,
    nodeVersion: expectedNodeVersion,
  });
  if (
    missingSidecarCachedNodeInspection.reusable
    || missingSidecarCachedNodeInspection.reason !== 'node-sidecar-missing'
  ) {
    throw new Error(
      `Expected cached node runtime without sidecar metadata to be rejected after the hard cut, received ${JSON.stringify(missingSidecarCachedNodeInspection)}`,
    );
  }

  const missingDependencySourceRuntimeDir = path.join(tempRoot, 'source-runtime-missing-carbon');
  const missingDependencyCliPath = path.join(
    missingDependencySourceRuntimeDir,
    manifest.cliRelativePath.replace(/^runtime[\\/]/, ''),
  );
  const missingDependencyOpenclawPackageJsonPath = path.join(
    missingDependencySourceRuntimeDir,
    'package',
    'node_modules',
    'openclaw',
    'package.json',
  );

  await mkdir(path.dirname(missingDependencyCliPath), { recursive: true });
  await mkdir(path.dirname(missingDependencyOpenclawPackageJsonPath), { recursive: true });
  await writeAlreadyPatchedOpenClawServerImpl(path.join(missingDependencySourceRuntimeDir, 'package'));
  await writeFile(missingDependencyCliPath, 'console.log("openclaw");');
  await writeFile(
    missingDependencyOpenclawPackageJsonPath,
    `${JSON.stringify({ name: 'openclaw', version: expectedOpenClawVersion }, null, 2)}\n`,
  );

  await prepareOpenClawRuntimeFromSource({
    sourceRuntimeDir: missingDependencySourceRuntimeDir,
    resourceDir: path.join(tempRoot, 'invalid-resource-runtime'),
    openclawVersion: expectedOpenClawVersion,
    nodeVersion: expectedNodeVersion,
    runtimeSupplementalPackages: [],
    target,
  });

  let missingSupplementalDependencyRejected = false;
  try {
    await prepareOpenClawRuntimeFromSource({
      sourceRuntimeDir: missingDependencySourceRuntimeDir,
      resourceDir: path.join(tempRoot, 'invalid-resource-runtime-missing-carbon'),
      openclawVersion: expectedOpenClawVersion,
      nodeVersion: expectedNodeVersion,
      runtimeSupplementalPackages: customRuntimeSupplementalPackages,
      target,
    });
  } catch (error) {
    missingSupplementalDependencyRejected =
      /@buape[\\/]+carbon/u.test(String(error));
  }
  if (!missingSupplementalDependencyRejected) {
    throw new Error('Expected prepared runtime validation to reject missing configured @buape/carbon supplemental dependency');
  }

  const mismatchedVersionSourceRuntimeDir = path.join(tempRoot, 'source-runtime-mismatched-openclaw-version');
  const mismatchedVersionCliPath = path.join(
    mismatchedVersionSourceRuntimeDir,
    manifest.cliRelativePath.replace(/^runtime[\\/]/, ''),
  );
  const mismatchedVersionOpenclawPackageJsonPath = path.join(
    mismatchedVersionSourceRuntimeDir,
    'package',
    'node_modules',
    'openclaw',
    'package.json',
  );
  const mismatchedVersionCarbonPackageJsonPath = path.join(
    mismatchedVersionSourceRuntimeDir,
    'package',
    'node_modules',
    '@buape',
    'carbon',
    'package.json',
  );

  await mkdir(path.dirname(mismatchedVersionCliPath), { recursive: true });
  await mkdir(path.dirname(mismatchedVersionOpenclawPackageJsonPath), { recursive: true });
  await mkdir(path.dirname(mismatchedVersionCarbonPackageJsonPath), { recursive: true });
  await writeFile(mismatchedVersionCliPath, 'console.log("openclaw");');
  await writeFile(
    mismatchedVersionOpenclawPackageJsonPath,
    `${JSON.stringify({ name: 'openclaw', version: staleOpenClawVersion }, null, 2)}\n`,
  );
  await writeFile(
    mismatchedVersionCarbonPackageJsonPath,
    `${JSON.stringify({ name: '@buape/carbon', version: '0.14.0' }, null, 2)}\n`,
  );

  let mismatchedVersionRejected = false;
  try {
    await prepareOpenClawRuntimeFromSource({
      sourceRuntimeDir: mismatchedVersionSourceRuntimeDir,
      resourceDir: path.join(tempRoot, 'invalid-resource-runtime-mismatched-openclaw-version'),
      openclawVersion: expectedOpenClawVersion,
      nodeVersion: actualNodeVersion,
      runtimeSupplementalPackages: [],
      target,
    });
  } catch (error) {
    mismatchedVersionRejected = new RegExp(
      `openclaw-version-mismatch|Prepared OpenClaw package\\.json version mismatch|${escapeRegExp(staleOpenClawVersion)}`,
      'u',
    ).test(String(error));
  }
  if (!mismatchedVersionRejected) {
    throw new Error('Expected prepared runtime validation to reject mismatched OpenClaw package versions');
  }

  const missingBundledPluginRuntimeDepSourceRuntimeDir = path.join(
    tempRoot,
    'source-runtime-missing-bundled-plugin-runtime-dep',
  );
  const missingBundledPluginRuntimeDepCliPath = path.join(
    missingBundledPluginRuntimeDepSourceRuntimeDir,
    manifest.cliRelativePath.replace(/^runtime[\\/]/, ''),
  );
  const missingBundledPluginRuntimeDepOpenclawPackageJsonPath = path.join(
    missingBundledPluginRuntimeDepSourceRuntimeDir,
    'package',
    'node_modules',
    'openclaw',
    'package.json',
  );
  const missingBundledPluginRuntimeDepCarbonPackageJsonPath = path.join(
    missingBundledPluginRuntimeDepSourceRuntimeDir,
    'package',
    'node_modules',
    '@buape',
    'carbon',
    'package.json',
  );
  const missingBundledPluginRuntimeDepScriptPath = path.join(
    missingBundledPluginRuntimeDepSourceRuntimeDir,
    'package',
    'node_modules',
    'openclaw',
    'scripts',
    'postinstall-bundled-plugins.mjs',
  );
  const missingBundledPluginRuntimeDepPluginPackageJsonPath = path.join(
    missingBundledPluginRuntimeDepSourceRuntimeDir,
    'package',
    'node_modules',
    'openclaw',
    'dist',
    'extensions',
    'amazon-bedrock',
    'package.json',
  );

  await mkdir(path.dirname(missingBundledPluginRuntimeDepCliPath), { recursive: true });
  await mkdir(path.dirname(missingBundledPluginRuntimeDepOpenclawPackageJsonPath), { recursive: true });
  await mkdir(path.dirname(missingBundledPluginRuntimeDepCarbonPackageJsonPath), { recursive: true });
  await mkdir(path.dirname(missingBundledPluginRuntimeDepScriptPath), { recursive: true });
  await mkdir(path.dirname(missingBundledPluginRuntimeDepPluginPackageJsonPath), { recursive: true });
  await writeFile(missingBundledPluginRuntimeDepCliPath, 'console.log("openclaw");');
  await writeFile(
    missingBundledPluginRuntimeDepOpenclawPackageJsonPath,
    `${JSON.stringify({ name: 'openclaw', version: expectedOpenClawVersion }, null, 2)}\n`,
  );
  await writeFile(
    missingBundledPluginRuntimeDepCarbonPackageJsonPath,
    `${JSON.stringify({ name: '@buape/carbon', version: '0.14.0' }, null, 2)}\n`,
  );
  await writeFile(
    missingBundledPluginRuntimeDepPluginPackageJsonPath,
    `${JSON.stringify(
      {
        name: '@openclaw/amazon-bedrock-provider',
        version: prereleaseOpenClawVersion,
        dependencies: {
          '@aws-sdk/client-bedrock': '3.1020.0',
        },
      },
      null,
      2,
    )}\n`,
  );
  await writeFile(
    missingBundledPluginRuntimeDepScriptPath,
    [
      'export function discoverBundledPluginRuntimeDeps() {',
      '  return [',
      '    {',
      '      name: "@aws-sdk/client-bedrock",',
      '      version: "3.1020.0",',
      '      sentinelPath: "node_modules/@aws-sdk/client-bedrock/package.json",',
      '      pluginIds: ["amazon-bedrock"],',
      '    },',
      '  ];',
      '}',
      '',
    ].join('\n'),
  );

  let missingBundledPluginRuntimeDepRejected = false;
  try {
    await prepareOpenClawRuntimeFromSource({
      sourceRuntimeDir: missingBundledPluginRuntimeDepSourceRuntimeDir,
      resourceDir: path.join(tempRoot, 'invalid-resource-runtime-missing-bundled-plugin-runtime-dep'),
      openclawVersion: expectedOpenClawVersion,
      nodeVersion: actualNodeVersion,
      runtimeSupplementalPackages: [],
      target,
    });
  } catch (error) {
    missingBundledPluginRuntimeDepRejected =
      /@aws-sdk[\\/]+client-bedrock|bundled-plugin-runtime-dependency/u.test(String(error));
  }
  if (!missingBundledPluginRuntimeDepRejected) {
    throw new Error(
      'Expected prepared runtime validation to reject missing bundled plugin runtime dependencies',
    );
  }

  const failingNativeSmokeSourceRuntimeDir = path.join(
    tempRoot,
    'source-runtime-failing-native-smoke',
  );
  const failingNativeSmokeCliPath = path.join(
    failingNativeSmokeSourceRuntimeDir,
    manifest.cliRelativePath.replace(/^runtime[\\/]/, ''),
  );
  const failingNativeSmokeOpenclawPackageJsonPath = path.join(
    failingNativeSmokeSourceRuntimeDir,
    'package',
    'node_modules',
    'openclaw',
    'package.json',
  );
  const failingNativeSmokeCarbonPackageJsonPath = path.join(
    failingNativeSmokeSourceRuntimeDir,
    'package',
    'node_modules',
    '@buape',
    'carbon',
    'package.json',
  );
  const failingNativeSmokeKoffiPackageJsonPath = path.join(
    failingNativeSmokeSourceRuntimeDir,
    'package',
    'node_modules',
    'koffi',
    'package.json',
  );
  const failingNativeSmokeKoffiIndexPath = path.join(
    failingNativeSmokeSourceRuntimeDir,
    'package',
    'node_modules',
    'koffi',
    'index.js',
  );

  await mkdir(path.dirname(failingNativeSmokeCliPath), { recursive: true });
  await mkdir(path.dirname(failingNativeSmokeOpenclawPackageJsonPath), { recursive: true });
  await mkdir(path.dirname(failingNativeSmokeCarbonPackageJsonPath), { recursive: true });
  await mkdir(path.dirname(failingNativeSmokeKoffiPackageJsonPath), { recursive: true });
  await writeFile(failingNativeSmokeCliPath, 'console.log("openclaw");');
  await writeFile(
    failingNativeSmokeOpenclawPackageJsonPath,
    `${JSON.stringify(
      {
        name: 'openclaw',
        version: expectedOpenClawVersion,
        pnpm: {
          ignoredBuiltDependencies: ['koffi'],
        },
      },
      null,
      2,
    )}\n`,
  );
  await writeFile(
    failingNativeSmokeCarbonPackageJsonPath,
    `${JSON.stringify({ name: '@buape/carbon', version: '0.14.0' }, null, 2)}\n`,
  );
  await writeFile(
    failingNativeSmokeKoffiPackageJsonPath,
    `${JSON.stringify({ name: 'koffi', version: '2.15.2', main: 'index.js' }, null, 2)}\n`,
  );
  await writeFile(
    failingNativeSmokeKoffiIndexPath,
    'throw new Error("koffi native load failed");\n',
  );

  let failingNativeSmokeRejected = false;
  try {
    await prepareOpenClawRuntimeFromSource({
      sourceRuntimeDir: failingNativeSmokeSourceRuntimeDir,
      resourceDir: path.join(tempRoot, 'invalid-resource-runtime-failing-native-smoke'),
      openclawVersion: expectedOpenClawVersion,
      nodeVersion: actualNodeVersion,
      runtimeSupplementalPackages: [],
      target,
    });
  } catch (error) {
    failingNativeSmokeRejected =
      /koffi|native smoke|runtime smoke/u.test(String(error));
  }
  if (!failingNativeSmokeRejected) {
    throw new Error('Expected prepared runtime validation to reject failing native smoke checks');
  }

  const cliOnlyBuiltDependencySourceRuntimeDir = path.join(
    tempRoot,
    'source-runtime-cli-only-built-dependency',
  );
  const cliOnlyBuiltDependencyCliPath = path.join(
    cliOnlyBuiltDependencySourceRuntimeDir,
    manifest.cliRelativePath.replace(/^runtime[\\/]/, ''),
  );
  const cliOnlyBuiltDependencyOpenclawPackageJsonPath = path.join(
    cliOnlyBuiltDependencySourceRuntimeDir,
    'package',
    'node_modules',
    'openclaw',
    'package.json',
  );
  const cliOnlyBuiltDependencyCarbonPackageJsonPath = path.join(
    cliOnlyBuiltDependencySourceRuntimeDir,
    'package',
    'node_modules',
    '@buape',
    'carbon',
    'package.json',
  );
  const cliOnlyBuiltDependencyPackageJsonPath = path.join(
    cliOnlyBuiltDependencySourceRuntimeDir,
    'package',
    'node_modules',
    '@tloncorp',
    'tlon-skill',
    'package.json',
  );
  const cliOnlyBuiltDependencyBinPath = path.join(
    cliOnlyBuiltDependencySourceRuntimeDir,
    'package',
    'node_modules',
    '@tloncorp',
    'tlon-skill',
    'bin',
    'tlon.js',
  );

  await mkdir(path.dirname(cliOnlyBuiltDependencyCliPath), { recursive: true });
  await mkdir(path.dirname(cliOnlyBuiltDependencyOpenclawPackageJsonPath), { recursive: true });
  await mkdir(path.dirname(cliOnlyBuiltDependencyCarbonPackageJsonPath), { recursive: true });
  await mkdir(path.dirname(cliOnlyBuiltDependencyPackageJsonPath), { recursive: true });
  await mkdir(path.dirname(cliOnlyBuiltDependencyBinPath), { recursive: true });
  await writeAlreadyPatchedOpenClawServerImpl(path.join(cliOnlyBuiltDependencySourceRuntimeDir, 'package'));
  await writeFile(cliOnlyBuiltDependencyCliPath, 'console.log("openclaw");');
  await writeFile(
    cliOnlyBuiltDependencyOpenclawPackageJsonPath,
    `${JSON.stringify(
      {
        name: 'openclaw',
        version: expectedOpenClawVersion,
        pnpm: {
          onlyBuiltDependencies: ['@tloncorp/tlon-skill'],
        },
      },
      null,
      2,
    )}\n`,
  );
  await writeFile(
    cliOnlyBuiltDependencyCarbonPackageJsonPath,
    `${JSON.stringify({ name: '@buape/carbon', version: '0.14.0' }, null, 2)}\n`,
  );
  await writeOfficialDefaultSupplementalPackages(
    path.join(cliOnlyBuiltDependencySourceRuntimeDir, 'package'),
  );
  await writeFile(
    cliOnlyBuiltDependencyPackageJsonPath,
    `${JSON.stringify(
      {
        name: '@tloncorp/tlon-skill',
        version: '0.3.1',
        type: 'module',
        bin: {
          tlon: './bin/tlon.js',
        },
      },
      null,
      2,
    )}\n`,
  );
  await writeFile(cliOnlyBuiltDependencyBinPath, '#!/usr/bin/env node\n');

  await prepareOpenClawRuntimeFromSource({
    sourceRuntimeDir: cliOnlyBuiltDependencySourceRuntimeDir,
    resourceDir: path.join(tempRoot, 'valid-resource-runtime-cli-only-built-dependency'),
    openclawVersion: expectedOpenClawVersion,
    nodeVersion: actualNodeVersion,
    runtimeSupplementalPackages: DEFAULT_OPENCLAW_RUNTIME_SUPPLEMENTAL_PACKAGES,
    target,
  });

  const stagedPackageDir = path.join(tempRoot, 'staged-package');
  const stagedWrapperPackageJsonPath = path.join(stagedPackageDir, 'package.json');
  const stagedCliPath = path.join(stagedPackageDir, 'node_modules', 'openclaw', 'openclaw.mjs');
  const stagedOpenclawPackageJsonPath = path.join(
    stagedPackageDir,
    'node_modules',
    'openclaw',
    'package.json',
  );
  const stagedCarbonPackageJsonPath = path.join(
    stagedPackageDir,
    'node_modules',
    '@buape',
    'carbon',
    'package.json',
  );
  const stagedResourceDir = path.join(tempRoot, 'staged-resource-runtime');

  await mkdir(path.dirname(stagedCliPath), { recursive: true });
  await mkdir(path.dirname(stagedOpenclawPackageJsonPath), { recursive: true });
  await mkdir(path.dirname(stagedCarbonPackageJsonPath), { recursive: true });
  await writeAlreadyPatchedOpenClawServerImpl(stagedPackageDir);
  await writeFile(
    stagedWrapperPackageJsonPath,
    `${JSON.stringify(
      {
        name: 'bundled-openclaw-runtime',
        private: true,
        dependencies: {
          openclaw: `file:${path.join(tempRoot, `openclaw-${expectedOpenClawVersion}.tgz`).replaceAll('\\', '/')}`,
        },
      },
      null,
      2,
    )}\n`,
  );
  await writeFile(stagedCliPath, 'console.log(\"openclaw\");');
  await writeFile(
    stagedOpenclawPackageJsonPath,
    `${JSON.stringify({ name: 'openclaw', version: expectedOpenClawVersion }, null, 2)}\n`,
  );
  await writeFile(
    stagedCarbonPackageJsonPath,
    `${JSON.stringify({ name: '@buape/carbon', version: '0.14.0' }, null, 2)}\n`,
  );
  await writeOfficialDefaultSupplementalPackages(stagedPackageDir);

  await prepareOpenClawRuntimeFromStagedDirs({
    nodeSourceDir: path.join(tempRoot, 'unused-staged-node'),
    packageSourceDir: stagedPackageDir,
    resourceDir: stagedResourceDir,
    openclawVersion: expectedOpenClawVersion,
    nodeVersion: expectedNodeVersion,
    target,
  });

  if (existsSync(path.join(stagedResourceDir, 'runtime', 'node'))) {
    throw new Error('Expected staged prepared runtime output to exclude bundled Node payloads');
  }
  await stat(path.join(stagedResourceDir, 'runtime', 'package', 'node_modules', 'openclaw', 'openclaw.mjs'));
  await stat(path.join(stagedResourceDir, runtimeSidecarManifestRelativePath));
  const stagedResourceWrapperPackageJson = JSON.parse(
    await readFile(path.join(stagedResourceDir, 'runtime', 'package', 'package.json'), 'utf8'),
  );
  if (stagedResourceWrapperPackageJson.dependencies?.openclaw !== expectedOpenClawVersion) {
    throw new Error(
      `Expected prepared runtime wrapper package.json to normalize openclaw dependency to ${expectedOpenClawVersion}, received ${stagedResourceWrapperPackageJson.dependencies?.openclaw}`,
    );
  }
  if (
    stagedResourceWrapperPackageJson.dependencies?.['@openclaw/feishu']
    !== expectedOpenClawVersion
  ) {
    throw new Error(
      `Expected prepared runtime wrapper package.json to preserve @openclaw/feishu dependency ${expectedOpenClawVersion}, received ${stagedResourceWrapperPackageJson.dependencies?.['@openclaw/feishu']}`,
    );
  }
  if (
    stagedResourceWrapperPackageJson.dependencies?.['@openclaw/qqbot']
    !== expectedOpenClawVersion
  ) {
    throw new Error(
      `Expected prepared runtime wrapper package.json to preserve @openclaw/qqbot dependency ${expectedOpenClawVersion}, received ${stagedResourceWrapperPackageJson.dependencies?.['@openclaw/qqbot']}`,
    );
  }
  await stat(
    path.join(
      stagedResourceDir,
      'runtime',
      'package',
      'node_modules',
      'openclaw',
      'dist',
      'extensions',
      'qqbot',
      'openclaw.plugin.json',
    ),
  );
  await stat(
    path.join(
      stagedResourceDir,
      'runtime',
      'package',
      'node_modules',
      'openclaw',
      'dist',
      'extensions',
      'feishu',
      'openclaw.plugin.json',
    ),
  );

  const stagedPluginManifestOnlyPackageDir = path.join(
    tempRoot,
    'staged-package-plugin-manifest-only-qqbot',
  );
  const stagedPluginManifestOnlyWrapperPackageJsonPath = path.join(
    stagedPluginManifestOnlyPackageDir,
    'package.json',
  );
  const stagedPluginManifestOnlyCliPath = path.join(
    stagedPluginManifestOnlyPackageDir,
    manifest.cliRelativePath.replace(/^runtime[\\/]package[\\/]/, ''),
  );
  const stagedPluginManifestOnlyOpenclawPackageJsonPath = path.join(
    stagedPluginManifestOnlyPackageDir,
    'node_modules',
    'openclaw',
    'package.json',
  );
  const stagedPluginManifestOnlyCarbonPackageJsonPath = path.join(
    stagedPluginManifestOnlyPackageDir,
    'node_modules',
    '@buape',
    'carbon',
    'package.json',
  );
  const stagedPluginManifestOnlyResourceDir = path.join(
    tempRoot,
    'staged-resource-plugin-manifest-only-qqbot',
  );

  await mkdir(path.dirname(stagedPluginManifestOnlyCliPath), { recursive: true });
  await mkdir(path.dirname(stagedPluginManifestOnlyOpenclawPackageJsonPath), { recursive: true });
  await mkdir(path.dirname(stagedPluginManifestOnlyCarbonPackageJsonPath), { recursive: true });
  await writeAlreadyPatchedOpenClawServerImpl(stagedPluginManifestOnlyPackageDir);
  await writeFile(
    stagedPluginManifestOnlyWrapperPackageJsonPath,
    `${JSON.stringify(
      {
        name: 'bundled-openclaw-runtime',
        private: true,
        dependencies: {
          openclaw: expectedOpenClawVersion,
          '@openclaw/feishu': expectedOpenClawVersion,
          '@openclaw/qqbot': expectedOpenClawVersion,
        },
      },
      null,
      2,
    )}\n`,
  );
  await writeFile(stagedPluginManifestOnlyCliPath, 'console.log("openclaw");');
  await writeFile(
    stagedPluginManifestOnlyOpenclawPackageJsonPath,
    `${JSON.stringify({ name: 'openclaw', version: expectedOpenClawVersion }, null, 2)}\n`,
  );
  await writeFile(
    stagedPluginManifestOnlyCarbonPackageJsonPath,
    `${JSON.stringify({ name: '@buape/carbon', version: '0.14.0' }, null, 2)}\n`,
  );
  await writePluginManifestOnlyFeishuSupplementalPackage(stagedPluginManifestOnlyPackageDir);
  await writePluginManifestOnlyQqbotSupplementalPackage(stagedPluginManifestOnlyPackageDir);

  await prepareOpenClawRuntimeFromStagedDirs({
    nodeSourceDir: path.join(tempRoot, 'unused-plugin-manifest-only-node'),
    packageSourceDir: stagedPluginManifestOnlyPackageDir,
    resourceDir: stagedPluginManifestOnlyResourceDir,
    openclawVersion: expectedOpenClawVersion,
    nodeVersion: expectedNodeVersion,
    target,
  });

  await stat(
    path.join(
      stagedPluginManifestOnlyResourceDir,
      'runtime',
      'package',
      'node_modules',
      'openclaw',
      'dist',
      'extensions',
      'qqbot',
      'openclaw.plugin.json',
    ),
  );
  await stat(
    path.join(
      stagedPluginManifestOnlyResourceDir,
      'runtime',
      'package',
      'node_modules',
      'openclaw',
      'dist',
      'extensions',
      'feishu',
      'openclaw.plugin.json',
    ),
  );

  const reusableResourceDir = path.join(tempRoot, 'reusable-resource-runtime');
  await prepareOpenClawRuntimeFromSource({
    sourceRuntimeDir,
    resourceDir: reusableResourceDir,
    openclawVersion: expectedOpenClawVersion,
    nodeVersion: expectedNodeVersion,
    target,
  });

  const inspection = await inspectPreparedOpenClawRuntime({
    resourceDir: reusableResourceDir,
    manifest,
  });
  if (!inspection.reusable) {
    throw new Error(`Expected prepared runtime inspection to be reusable, received ${inspection.reason}`);
  }

  if (shouldReusePreparedOpenClawRuntime({ inspection, forcePrepare: true })) {
    throw new Error('Expected forcePrepare=true to disable reuse of an otherwise valid prepared runtime');
  }

  const sentinelPath = path.join(reusableResourceDir, 'runtime', 'package', 'sentinel.txt');
  await writeFile(sentinelPath, 'keep');

  const reused = await prepareOpenClawRuntime({
    resourceDir: reusableResourceDir,
    openclawVersion: expectedOpenClawVersion,
    nodeVersion: expectedNodeVersion,
    openclawPackage: 'openclaw',
    fetchImpl: async () => {
      throw new Error('prepareOpenClawRuntime should have reused the existing runtime instead of re-preparing runtime assets');
    },
    target,
  });

  if (reused.strategy !== 'reused-existing') {
    throw new Error(`Expected an existing runtime reuse strategy, received ${reused.strategy}`);
  }

  const sentinelValue = await readFile(sentinelPath, 'utf8');
  if (sentinelValue !== 'keep') {
    throw new Error(`Expected runtime reuse to preserve existing files, received ${sentinelValue}`);
  }

  const strictResourceDir = path.join(tempRoot, 'strict-resource-runtime');
  await prepareOpenClawRuntimeFromSource({
    sourceRuntimeDir,
    resourceDir: strictResourceDir,
    openclawVersion: expectedOpenClawVersion,
    nodeVersion: actualNodeVersion,
    target,
  });
  await rm(path.join(strictResourceDir, 'manifest.json'));
  const strictManifest = buildOpenClawManifest({
    openclawVersion: expectedOpenClawVersion,
    nodeVersion: actualNodeVersion,
    target,
  });

  const strictMissingManifestInspection = await inspectPreparedOpenClawRuntime({
    resourceDir: strictResourceDir,
    manifest: strictManifest,
  });
  if (
    strictMissingManifestInspection.reusable
    || strictMissingManifestInspection.reason !== 'manifest-unreadable'
  ) {
    throw new Error(
      `Expected prepared runtime with a missing manifest to be rejected instead of repaired, received ${JSON.stringify(strictMissingManifestInspection)}`,
    );
  }

  let strictRebuildError = null;
  try {
    await prepareOpenClawRuntime({
      resourceDir: strictResourceDir,
      cacheDir: path.join(tempRoot, 'strict-cache'),
      openclawVersion: expectedOpenClawVersion,
      nodeVersion: actualNodeVersion,
      openclawPackage: 'openclaw',
      fetchImpl: async () => {
        throw new Error('strict rebuild required for stale prepared runtime metadata');
      },
      target,
    });
  } catch (error) {
    strictRebuildError = error;
  }

  if (
    !strictRebuildError
    || !String(strictRebuildError.message ?? strictRebuildError).includes('strict rebuild required')
  ) {
    throw new Error(
      `Expected strict prepared runtime validation to rebuild instead of repairing stale metadata, received ${strictRebuildError}`,
    );
  }

  if (existsSync(path.join(strictResourceDir, 'manifest.json'))) {
    throw new Error('Expected strict prepared runtime validation to leave stale missing manifest unrepaired');
  }

  const rebuiltResourceDir = path.join(tempRoot, 'rebuilt-resource-runtime');
  const rebuilt = await prepareOpenClawRuntime({
    sourceRuntimeDir,
    resourceDir: rebuiltResourceDir,
    openclawVersion: expectedOpenClawVersion,
    nodeVersion: actualNodeVersion,
    openclawPackage: 'openclaw',
    target,
  });

  if (rebuilt.strategy !== 'prepared-source') {
    throw new Error(`Expected a prepared-source strategy after strict rebuild, received ${rebuilt.strategy}`);
  }

  const rebuiltManifest = JSON.parse(
    await readFile(path.join(rebuiltResourceDir, 'manifest.json'), 'utf8'),
  );
  if (rebuiltManifest.openclawVersion !== expectedOpenClawVersion) {
    throw new Error(
      `Expected rebuilt manifest to restore openclawVersion=${expectedOpenClawVersion}, received ${rebuiltManifest.openclawVersion}`,
    );
  }

  const nodeResidueResourceDir = path.join(tempRoot, 'node-residue-resource-runtime');
  await prepareOpenClawRuntimeFromSource({
    sourceRuntimeDir,
    resourceDir: nodeResidueResourceDir,
    openclawVersion: expectedOpenClawVersion,
    nodeVersion: expectedNodeVersion,
    target,
  });
  await mkdir(path.join(nodeResidueResourceDir, 'runtime', 'node'), { recursive: true });
  await writeFile(
    path.join(nodeResidueResourceDir, 'runtime', 'node', 'node.exe'),
    fakeNodeExecutableContent,
  );

  const nodeResidueInspection = await inspectPreparedOpenClawRuntime({
    resourceDir: nodeResidueResourceDir,
    manifest: buildOpenClawManifest({
      openclawVersion: expectedOpenClawVersion,
      nodeVersion: expectedNodeVersion,
      target,
    }),
  });
  if (nodeResidueInspection.reusable) {
    throw new Error('Expected prepared runtime inspection to reject bundled Node residue in the resource runtime');
  }
  if (!String(nodeResidueInspection.error ?? '').includes('bundled Node payload')) {
    throw new Error(
      `Expected bundled Node residue rejection reason, received ${JSON.stringify(nodeResidueInspection)}`,
    );
  }

  const cacheDir = path.join(tempRoot, 'persistent-cache');
  const cachePaths = resolveOpenClawPrepareCachePaths({
    cacheDir,
    openclawVersion: expectedOpenClawVersion,
    nodeVersion: expectedNodeVersion,
    target,
  });
  await mkdir(path.dirname(cachePaths.cachedArchivePath), { recursive: true });
  await writeFile(cachePaths.cachedArchivePath, 'cached-archive');
  await cp(path.join(sourceRuntimeDir, 'package'), cachePaths.packageCacheDir, { recursive: true });

  const cachePreparedResourceDir = path.join(tempRoot, 'cache-prepared-resource-runtime');
  const cached = await prepareOpenClawRuntime({
    resourceDir: cachePreparedResourceDir,
    cacheDir,
    openclawVersion: expectedOpenClawVersion,
    nodeVersion: expectedNodeVersion,
    openclawPackage: 'openclaw',
    fetchImpl: async () => {
      throw new Error('prepareOpenClawRuntime should have reused cached artifacts instead of re-preparing runtime assets');
    },
    target,
  });

  if (cached.strategy !== 'prepared-cache') {
    throw new Error(`Expected a prepared-cache strategy, received ${cached.strategy}`);
  }

  if (existsSync(path.join(cachePreparedResourceDir, 'runtime', 'node'))) {
    throw new Error('Expected cached prepared runtime output to exclude bundled Node payloads');
  }
  await stat(
    path.join(
      cachePreparedResourceDir,
      'runtime',
      'package',
      'node_modules',
      'openclaw',
      'openclaw.mjs',
    ),
  );
  await stat(
    path.join(
      cachePreparedResourceDir,
      'runtime',
      'package',
      'node_modules',
      'openclaw',
      'dist',
      'extensions',
      'qqbot',
      'openclaw.plugin.json',
    ),
  );

  const windowsExtractor = resolveNodeArchiveExtractionCommand({
    archivePath: `C:\\temp\\node-v${expectedNodeVersion}-win-x64.zip`,
    extractRoot: 'C:\\temp\\extract-root',
    target,
    hasTarCommand: true,
  });
  if (windowsExtractor.command.toLowerCase() !== resolveExpectedWindowsSystemCommand('tar').toLowerCase()) {
    throw new Error(`Expected Windows zip extraction to prefer tar, received ${windowsExtractor.command}`);
  }

  const windowsPowerShellExtractor = resolveNodeArchiveExtractionCommand({
    archivePath: `C:\\temp\\node-v${expectedNodeVersion}-win-x64.zip`,
    extractRoot: 'C:\\temp\\extract-root',
    target,
    hasTarCommand: false,
  });
  if (
    windowsPowerShellExtractor.command.toLowerCase()
    !== resolveExpectedWindowsSystemCommand('powershell').toLowerCase()
  ) {
    throw new Error(
      `Expected Windows zip extraction to fall back to PowerShell, received ${windowsPowerShellExtractor.command}`,
    );
  }

  if (!shouldRetryDirectoryCleanup(Object.assign(new Error('directory not empty'), { code: 'ENOTEMPTY' }))) {
    throw new Error('Expected ENOTEMPTY cleanup failures to be retried');
  }

  if (shouldRetryDirectoryCleanup(Object.assign(new Error('missing'), { code: 'ENOENT' }))) {
    throw new Error('Expected ENOENT cleanup failures to skip retries');
  }

  let transientCleanupAttempts = 0;
  await removeDirectoryWithRetries(path.join(tempRoot, 'transient-cleanup'), {
    retryCount: 3,
    retryDelayMs: 0,
    logger: () => {},
    removeImpl: async () => {
      transientCleanupAttempts += 1;
      if (transientCleanupAttempts === 1) {
        throw Object.assign(new Error('directory not empty'), { code: 'ENOTEMPTY' });
      }
    },
  });

  if (transientCleanupAttempts !== 2) {
    throw new Error(`Expected transient cleanup to retry once, received ${transientCleanupAttempts} attempts`);
  }

  let fatalCleanupAttempts = 0;
  let fatalCleanupError;
  try {
    await removeDirectoryWithRetries(path.join(tempRoot, 'fatal-cleanup'), {
      retryCount: 3,
      retryDelayMs: 0,
      logger: () => {},
      removeImpl: async () => {
        fatalCleanupAttempts += 1;
        throw Object.assign(new Error('bad cleanup'), { code: 'EINVAL' });
      },
    });
    throw new Error('Expected invalid cleanup failures to surface without retries');
  } catch (error) {
    fatalCleanupError = error;
  }

  if (fatalCleanupAttempts !== 1) {
    throw new Error(`Expected fatal cleanup failures to avoid retries, received ${fatalCleanupAttempts} attempts`);
  }

  if (!(fatalCleanupError instanceof Error) || fatalCleanupError.message !== 'bad cleanup') {
    throw new Error(`Expected fatal cleanup error to be preserved, received ${String(fatalCleanupError)}`);
  }

  const aliasedNodeCacheDir = path.join(tempRoot, 'aliased-node-cache');
  const aliasedPackageSourceDir = path.join(tempRoot, 'aliased-package-source');
  const aliasedPackageCacheDir = path.join(tempRoot, 'aliased-package-cache');
  const aliasedNodeExecutable = path.join(aliasedNodeCacheDir, 'node.exe');
  const aliasedPackageJson = path.join(aliasedPackageSourceDir, 'package.json');

  await mkdir(path.dirname(aliasedNodeExecutable), { recursive: true });
  await mkdir(path.dirname(aliasedPackageJson), { recursive: true });
  await writeFile(aliasedNodeExecutable, 'node');
  await writeFile(aliasedPackageJson, '{"name":"openclaw-runtime-cache"}\n');

  await refreshCachedOpenClawRuntimeArtifacts({
    nodeSourceDir: aliasedNodeCacheDir,
    packageSourceDir: aliasedPackageSourceDir,
    cachePaths: {
      nodeCacheDir: aliasedNodeCacheDir,
      packageCacheDir: aliasedPackageCacheDir,
    },
  });

  await stat(aliasedNodeExecutable);
  await stat(path.join(aliasedPackageCacheDir, 'package.json'));

  let fallbackCopyAttempts = 0;
  await copyDirectoryWithWindowsFallback('C:\\temp\\source-package', 'C:\\temp\\target-package', {
    platform: 'win32',
    copyImpl: async () => {
      throw Object.assign(new Error('copy failed'), { code: 'ENOENT' });
    },
    robocopyImpl: async (sourceDir, targetDir) => {
      fallbackCopyAttempts += 1;
      if (sourceDir !== 'C:\\temp\\source-package' || targetDir !== 'C:\\temp\\target-package') {
        throw new Error(`Expected Windows fallback copy paths to be preserved, received ${sourceDir} -> ${targetDir}`);
      }
    },
  });

  if (fallbackCopyAttempts !== 1) {
    throw new Error(`Expected Windows fallback copy to run once, received ${fallbackCopyAttempts}`);
  }

  let nonWindowsCopyError;
  try {
    await copyDirectoryWithWindowsFallback('/tmp/source-package', '/tmp/target-package', {
      platform: 'linux',
      copyImpl: async () => {
        throw Object.assign(new Error('copy failed'), { code: 'ENOENT' });
      },
      robocopyImpl: async () => {
        throw new Error('Non-Windows copies should not invoke robocopy fallback');
      },
    });
    throw new Error('Expected non-Windows copy failures to surface without fallback');
  } catch (error) {
    nonWindowsCopyError = error;
  }

  if (!(nonWindowsCopyError instanceof Error) || nonWindowsCopyError.message !== 'copy failed') {
    throw new Error(`Expected non-Windows copy failure to be preserved, received ${String(nonWindowsCopyError)}`);
  }

  const symlinkSourceDir = path.join(tempRoot, 'symlink-source');
  const symlinkTargetDir = path.join(tempRoot, 'symlink-target');
  const symlinkShimTarget = path.join(
    symlinkSourceDir,
    'lib',
    'node_modules',
    'corepack',
    'dist',
    'corepack.js',
  );
  const symlinkShimPath = path.join(symlinkSourceDir, 'bin', 'corepack');

  await mkdir(path.dirname(symlinkShimTarget), { recursive: true });
  await mkdir(path.dirname(symlinkShimPath), { recursive: true });
  await writeFile(symlinkShimTarget, 'console.log("corepack");\n');
  symlinkSync('../lib/node_modules/corepack/dist/corepack.js', symlinkShimPath);

  await copyDirectoryWithWindowsFallback(symlinkSourceDir, symlinkTargetDir, {
    platform: 'linux',
  });

  const copiedSymlinkPath = path.join(symlinkTargetDir, 'bin', 'corepack');
  const copiedSymlinkTarget = readlinkSync(copiedSymlinkPath).replaceAll('\\', '/');
  if (copiedSymlinkTarget !== '../lib/node_modules/corepack/dist/corepack.js') {
    throw new Error(`Expected copied symlink to preserve its relative target, received ${copiedSymlinkTarget}`);
  }

  await stat(path.join(symlinkTargetDir, 'bin', copiedSymlinkTarget));

  console.log('ok - packaged OpenClaw runtime preparation copies runtime files and writes manifest');
} finally {
  await rm(tempRoot, { recursive: true, force: true });
}
