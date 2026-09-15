// WORKSPACE-PATH:allow-fixture: fixtures name a foreign checkout root, drive, or home directory to exercise path handling, so the literal is the value under assertion rather than a binding this build resolves
import assert from 'node:assert/strict';
import {
  DEFAULT_BUNDLED_OPENCLAW_VERSION,
  DEFAULT_REQUIRED_OPENCLAW_NODE_VERSION,
} from '@sdkwork/agentstudio-pc-types';

import { createExtensionService } from './extensionService.ts';

type FileEntryKind = 'file' | 'directory';

interface TestFsEntry {
  kind: FileEntryKind;
  content?: string;
}

function normalizePath(path: string): string {
  return path.replace(/\\/g, '/').replace(/\/+/g, '/').replace(/\/$/, '') || '/';
}

function joinPath(basePath: string, ...segments: string[]): string {
  const separator = basePath.includes('\\') ? '\\' : '/';
  const normalizedBase = basePath.replace(/[\\/]+$/, '');
  const normalizedSegments = segments
    .map((segment) => segment.replace(/^[\\/]+/, '').replace(/[\\/]+$/, ''))
    .filter(Boolean);

  if (normalizedSegments.length === 0) {
    return normalizedBase;
  }

  return [normalizedBase, ...normalizedSegments].join(separator);
}

function createPackageManifest({
  name,
  version,
  description,
  author,
  openclaw,
}: {
  name: string;
  version: string;
  description: string;
  author?: string;
  openclaw?: Record<string, unknown>;
}) {
  return JSON.stringify(
    {
      name,
      version,
      description,
      ...(author ? { author } : {}),
      type: 'module',
      ...(openclaw ? { openclaw } : {}),
    },
    null,
    2,
  );
}

function createTestFileSystem(seedEntries: Array<[string, TestFsEntry]>) {
  const entries = new Map<string, TestFsEntry>();

  function setDirectory(path: string) {
    const normalizedPath = normalizePath(path);
    if (!entries.has(normalizedPath)) {
      entries.set(normalizedPath, { kind: 'directory' });
    }
  }

  function setFile(path: string, content: string) {
    const normalizedPath = normalizePath(path);
    const parentPath = normalizedPath.slice(0, normalizedPath.lastIndexOf('/'));
    if (parentPath) {
      setDirectory(parentPath);
    }
    entries.set(normalizedPath, {
      kind: 'file',
      content,
    });
  }

  for (const [path, entry] of seedEntries) {
    if (entry.kind === 'directory') {
      setDirectory(path);
      continue;
    }

    setFile(path, entry.content ?? '');
  }

  function listDirectory(path: string) {
    const normalizedPath = normalizePath(path);
    const prefix = normalizedPath === '/' ? '/' : `${normalizedPath}/`;
    const children = new Map<string, { name: string; path: string; kind: FileEntryKind }>();

    for (const [entryPath, entry] of entries) {
      if (!entryPath.startsWith(prefix) || entryPath === normalizedPath) {
        continue;
      }

      const remainder = entryPath.slice(prefix.length);
      if (remainder.length === 0) {
        continue;
      }

      const [firstSegment] = remainder.split('/');
      const childPath = normalizedPath === '/' ? `/${firstSegment}` : `${normalizedPath}/${firstSegment}`;
      const existing = entries.get(childPath);
      const childKind = remainder.includes('/') ? 'directory' : (existing?.kind ?? entry.kind);
      children.set(firstSegment, {
        name: firstSegment,
        path: childPath,
        kind: childKind,
      });
    }

    return [...children.values()]
      .sort((left, right) => left.name.localeCompare(right.name))
      .map((entry) => ({
        path: entry.path,
        name: entry.name,
        kind: entry.kind,
        size: entry.kind === 'file' ? entries.get(entry.path)?.content?.length ?? null : null,
        extension:
          entry.kind === 'file' && entry.name.includes('.')
            ? entry.name.slice(entry.name.lastIndexOf('.') + 1)
            : null,
      }));
  }

  return {
    async listDirectory(path: string) {
      return listDirectory(path);
    },
    async readFile(path: string) {
      const entry = entries.get(normalizePath(path));
      if (!entry || entry.kind !== 'file') {
        throw new Error(`Missing file: ${path}`);
      }

      return entry.content ?? '';
    },
    async pathExists(path: string) {
      return entries.has(normalizePath(path));
    },
    async createDirectory(path: string) {
      setDirectory(path);
    },
    async copyPath(sourcePath: string, destinationPath: string) {
      const normalizedSourcePath = normalizePath(sourcePath);
      const normalizedDestinationPath = normalizePath(destinationPath);
      const entriesToCopy = [...entries.entries()].filter(([entryPath]) =>
        entryPath === normalizedSourcePath || entryPath.startsWith(`${normalizedSourcePath}/`),
      );

      if (entriesToCopy.length === 0) {
        throw new Error(`Missing copy source: ${sourcePath}`);
      }

      for (const [entryPath, entry] of entriesToCopy) {
        const relativePath = entryPath.slice(normalizedSourcePath.length);
        const nextPath = `${normalizedDestinationPath}${relativePath}`;
        if (entry.kind === 'directory') {
          setDirectory(nextPath);
          continue;
        }

        setFile(nextPath, entry.content ?? '');
      }
    },
    async removePath(path: string) {
      const normalizedPath = normalizePath(path);
      for (const entryPath of [...entries.keys()]) {
        if (entryPath === normalizedPath || entryPath.startsWith(`${normalizedPath}/`)) {
          entries.delete(entryPath);
        }
      }
    },
  };
}

function createKernelPlatformStub({
  runtimeInstallDir,
  pluginsDir,
  installedPluginCount,
}: {
  runtimeInstallDir: string;
  pluginsDir: string;
  installedPluginCount?: number;
}) {
  const nextInstalledPluginCount = installedPluginCount ?? 0;
  return {
    async getInfo() {
      return {
        directories: {
          pluginsDir,
          integrationsDir: joinPath(pluginsDir, '..', 'integrations'),
        },
        integrations: {
          pluginsEnabled: true,
          remoteApiEnabled: false,
          allowUnsignedPlugins: false,
          pluginsDir,
          integrationsDir: joinPath(pluginsDir, '..', 'integrations'),
          installedPluginCount: nextInstalledPluginCount,
          status: 'ready',
          availableAdapters: [],
        },
      };
    },
    async getStatus() {
      return {
        topology: {
          kind: 'localManagedNative',
          state: 'installed',
          label: 'Local Managed Native',
          recommended: true,
        },
        runtime: {
          state: 'running',
          health: 'healthy',
          reason: 'running',
          startedBy: 'nativeService',
          lastTransitionAt: Date.now(),
        },
        endpoint: {
          preferredPort: 0,
          activePort: 0,
          baseUrl: 'http://127.0.0.1:0',
          websocketUrl: 'ws://127.0.0.1:0',
          loopbackOnly: true,
          dynamicPort: false,
          endpointSource: 'configured',
        },
        host: {
          serviceManager: 'windowsService',
          ownership: 'nativeService',
          serviceName: 'agentstudioOpenClawKernel',
          serviceConfigPath: 'C:/ProgramData/SdkWork/agentstudio/service.json',
          startupMode: 'auto',
          attachSupported: true,
          repairSupported: true,
          controlSocket: null,
        },
        provenance: {
          runtimeId: 'openclaw',
          installKey: 'bundled',
          openclawVersion: DEFAULT_BUNDLED_OPENCLAW_VERSION,
          nodeVersion: DEFAULT_REQUIRED_OPENCLAW_NODE_VERSION,
          platform: 'windows',
          arch: 'x64',
          installSource: 'bundled',
          configPath: 'C:/Users/admin/.sdkwork/crawstudio/config.json',
          runtimeHomeDir: joinPath(runtimeInstallDir, '..'),
          runtimeInstallDir,
        },
      };
    },
  };
}

async function runTest(name: string, callback: () => Promise<void> | void) {
  try {
    await callback();
    console.log(`ok - ${name}`);
  } catch (error) {
    console.error(`not ok - ${name}`);
    throw error;
  }
}

await runTest('getExtensions merges bundled and local plugin directories with real metadata', async () => {
  const runtimeInstallDir = 'C:\\Runtime\\openclaw';
  const pluginsDir = 'C:\\Users\\admin\\.sdkwork\\agent-studio\\install\\extensions\\plugins';
  const bundledExtensionsDir = joinPath(runtimeInstallDir, 'dist', 'extensions');
  const fileSystem = createTestFileSystem([
    [bundledExtensionsDir, { kind: 'directory' }],
    [joinPath(bundledExtensionsDir, 'openai'), { kind: 'directory' }],
    [
      joinPath(bundledExtensionsDir, 'openai', 'package.json'),
      {
        kind: 'file',
        content: createPackageManifest({
          name: '@openclaw/openai-provider',
          version: DEFAULT_BUNDLED_OPENCLAW_VERSION,
          description: 'OpenClaw OpenAI provider plugins',
          openclaw: { extensions: ['./index.js'] },
        }),
      },
    ],
    [joinPath(bundledExtensionsDir, 'line'), { kind: 'directory' }],
    [
      joinPath(bundledExtensionsDir, 'line', 'package.json'),
      {
        kind: 'file',
        content: createPackageManifest({
          name: '@openclaw/line',
          version: DEFAULT_BUNDLED_OPENCLAW_VERSION,
          description: 'OpenClaw LINE channel plugin',
          openclaw: {
            extensions: ['./index.js'],
            channel: {
              id: 'line',
              label: 'LINE',
            },
          },
        }),
      },
    ],
    [pluginsDir, { kind: 'directory' }],
    [joinPath(pluginsDir, 'openai'), { kind: 'directory' }],
    [
      joinPath(pluginsDir, 'openai', 'package.json'),
      {
        kind: 'file',
        content: createPackageManifest({
          name: '@openclaw/openai-provider',
          version: DEFAULT_BUNDLED_OPENCLAW_VERSION,
          description: 'OpenClaw OpenAI provider plugins',
          openclaw: { extensions: ['./index.js'] },
        }),
      },
    ],
    [joinPath(pluginsDir, 'custom-tool'), { kind: 'directory' }],
    [
      joinPath(pluginsDir, 'custom-tool', 'package.json'),
      {
        kind: 'file',
        content: createPackageManifest({
          name: '@acme/custom-tool',
          version: '1.0.0',
          description: 'Private workflow automation tool',
          author: 'Acme',
          openclaw: { extensions: ['./index.js'] },
        }),
      },
    ],
  ]);

  const service = createExtensionService({
    getKernelPlatformService: () =>
      createKernelPlatformStub({
        runtimeInstallDir,
        pluginsDir,
        installedPluginCount: 2,
      }),
    getPlatform: () => fileSystem,
  });

  const page = await service.getExtensions({ keyword: 'plugin', page: 1, pageSize: 10 });
  const localOnlyPage = await service.getExtensions({ keyword: 'Acme', page: 1, pageSize: 10 });

  assert.equal(page.total, 2);
  assert.deepEqual(
    page.items.map((extension) => ({
      id: extension.id,
      installed: extension.installed,
      source: extension.source,
      category: extension.category,
    })),
    [
      {
        id: 'line',
        installed: false,
        source: 'bundled',
        category: 'channel',
      },
      {
        id: 'openai',
        installed: true,
        source: 'bundled',
        category: 'provider',
      },
    ],
  );
  assert.equal(page.items[1]?.author, 'OpenClaw');
  assert.equal(localOnlyPage.total, 1);
  assert.deepEqual(
    localOnlyPage.items.map((extension) => ({
      id: extension.id,
      source: extension.source,
      installed: extension.installed,
    })),
    [
      {
        id: 'custom-tool',
        source: 'local',
        installed: true,
      },
    ],
  );
});

await runTest('installExtension copies the bundled plugin package into the real plugins directory', async () => {
  const runtimeInstallDir = 'C:\\Runtime\\openclaw';
  const pluginsDir = 'C:\\Users\\admin\\.sdkwork\\agent-studio\\install\\extensions\\plugins';
  const bundledExtensionsDir = joinPath(runtimeInstallDir, 'dist', 'extensions');
  const fileSystem = createTestFileSystem([
    [bundledExtensionsDir, { kind: 'directory' }],
    [joinPath(bundledExtensionsDir, 'line'), { kind: 'directory' }],
    [
      joinPath(bundledExtensionsDir, 'line', 'package.json'),
      {
        kind: 'file',
        content: createPackageManifest({
          name: '@openclaw/line',
          version: DEFAULT_BUNDLED_OPENCLAW_VERSION,
          description: 'OpenClaw LINE channel plugin',
          openclaw: {
            extensions: ['./index.js'],
            channel: {
              id: 'line',
              label: 'LINE',
            },
          },
        }),
      },
    ],
    [pluginsDir, { kind: 'directory' }],
  ]);

  const service = createExtensionService({
    getKernelPlatformService: () =>
      createKernelPlatformStub({
        runtimeInstallDir,
        pluginsDir,
      }),
    getPlatform: () => fileSystem,
  });

  await service.installExtension('line');

  const page = await service.getExtensions({ keyword: 'line', page: 1, pageSize: 10 });
  assert.equal(page.items[0]?.installed, true);
  assert.equal(
    await fileSystem.pathExists(joinPath(pluginsDir, 'line', 'package.json')),
    true,
  );
});

await runTest('uninstallExtension removes the installed plugin directory and rejects missing ids', async () => {
  const runtimeInstallDir = 'C:\\Runtime\\openclaw';
  const pluginsDir = 'C:\\Users\\admin\\.sdkwork\\agent-studio\\install\\extensions\\plugins';
  const bundledExtensionsDir = joinPath(runtimeInstallDir, 'dist', 'extensions');
  const fileSystem = createTestFileSystem([
    [bundledExtensionsDir, { kind: 'directory' }],
    [pluginsDir, { kind: 'directory' }],
    [joinPath(pluginsDir, 'custom-tool'), { kind: 'directory' }],
    [
      joinPath(pluginsDir, 'custom-tool', 'package.json'),
      {
        kind: 'file',
        content: createPackageManifest({
          name: '@acme/custom-tool',
          version: '1.0.0',
          description: 'Private workflow automation tool',
          author: 'Acme',
          openclaw: { extensions: ['./index.js'] },
        }),
      },
    ],
  ]);

  const service = createExtensionService({
    getKernelPlatformService: () =>
      createKernelPlatformStub({
        runtimeInstallDir,
        pluginsDir,
        installedPluginCount: 1,
      }),
    getPlatform: () => fileSystem,
  });

  await service.uninstallExtension('custom-tool');

  assert.equal(await fileSystem.pathExists(joinPath(pluginsDir, 'custom-tool')), false);
  await assert.rejects(
    () => service.uninstallExtension('missing-extension'),
    /Extension not found/,
  );
});
