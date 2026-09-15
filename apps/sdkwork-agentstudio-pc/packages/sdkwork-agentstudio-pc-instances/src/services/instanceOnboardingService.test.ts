// WORKSPACE-PATH:allow-fixture: fixtures name a foreign checkout root, drive, or home directory to exercise path handling, so the literal is the value under assertion rather than a binding this build resolves
import assert from 'node:assert/strict';
import type {
  InstallAssessmentResult,
  InstallCatalogEntry,
  InstallRequest,
  RuntimeInfo,
  StudioCreateInstanceInput,
  StudioInstanceRecord,
  StudioUpdateInstanceInput,
} from '@sdkwork/agentstudio-pc-infrastructure';
import { createInstanceOnboardingService } from './instanceOnboardingService.ts';

function runTest(name: string, fn: () => Promise<void> | void) {
  return Promise.resolve()
    .then(fn)
    .then(() => {
      console.log(`ok - ${name}`);
    })
    .catch((error) => {
      console.error(`not ok - ${name}`);
      throw error;
    });
}

function createRuntimeInfo(overrides: Partial<RuntimeInfo> = {}): RuntimeInfo {
  return {
    platform: 'desktop',
    paths: {
      installRoot: 'D:/Apps/Agent Studio',
      foundationDir: 'D:/Apps/Agent Studio/foundation',
      foundationComponentsDir: 'D:/Apps/Agent Studio/foundation/components',
      modulesDir: 'D:/Apps/Agent Studio/modules',
      runtimesDir: 'D:/Apps/Agent Studio/runtimes',
      toolsDir: 'D:/Apps/Agent Studio/tools',
      trustDir: 'D:/Apps/Agent Studio/trust',
      packsDir: 'D:/Apps/Agent Studio/packs',
      extensionsDir: 'D:/Apps/Agent Studio/extensions',
      machineRoot: 'D:/Apps/Agent Studio/machine',
      machineStateDir: 'D:/Apps/Agent Studio/machine/state',
      machineStoreDir: 'D:/Apps/Agent Studio/machine/store',
      machineStagingDir: 'D:/Apps/Agent Studio/machine/staging',
      machineReceiptsDir: 'D:/Apps/Agent Studio/machine/receipts',
      machineRuntimeDir: 'D:/Apps/Agent Studio/machine/runtime',
      machineRecoveryDir: 'D:/Apps/Agent Studio/machine/recovery',
      machineLogsDir: 'D:/Apps/Agent Studio/machine/logs',
      userRoot: 'D:/Users/admin',
      userDir: 'D:/Users/admin',
      userAuthDir: 'D:/Users/admin/auth',
      userStorageDir: 'D:/Users/admin/storage',
      userIntegrationsDir: 'D:/Users/admin/integrations',
      studioDir: 'D:/Users/admin/studio',
      workspacesDir: 'D:/Users/admin/workspaces',
      studioBackupsDir: 'D:/Users/admin/backups',
      userLogsDir: 'D:/Users/admin/logs',
      configDir: 'D:/Users/admin/config',
      dataDir: 'D:/Users/admin/data',
      cacheDir: 'D:/Users/admin/cache',
      logsDir: 'D:/Users/admin/logs',
      stateDir: 'D:/Users/admin/state',
      storageDir: 'D:/Users/admin/storage',
      pluginsDir: 'D:/Users/admin/plugins',
      integrationsDir: 'D:/Users/admin/integrations',
      backupsDir: 'D:/Users/admin/backups',
      configFile: 'D:/Users/admin/config/config.json',
      layoutFile: 'D:/Users/admin/config/layout.json',
      activeFile: 'D:/Users/admin/config/active.json',
      inventoryFile: 'D:/Users/admin/config/inventory.json',
      retentionFile: 'D:/Users/admin/config/retention.json',
      pinnedFile: 'D:/Users/admin/config/pinned.json',
      channelsFile: 'D:/Users/admin/config/channels.json',
      policiesFile: 'D:/Users/admin/config/policies.json',
      sourcesFile: 'D:/Users/admin/config/sources.json',
      serviceFile: 'D:/Users/admin/config/service.json',
      componentsFile: 'D:/Users/admin/config/components.json',
      upgradesFile: 'D:/Users/admin/config/upgrades.json',
      componentRegistryFile: 'D:/Users/admin/config/component-registry.json',
      serviceDefaultsFile: 'D:/Users/admin/config/service-defaults.json',
      upgradePolicyFile: 'D:/Users/admin/config/upgrade-policy.json',
      deviceIdFile: 'D:/Users/admin/config/device-id',
      mainLogFile: 'D:/Users/admin/logs/main.log',
    },
    system: {
      os: 'windows',
      arch: 'x64',
      family: 'windows',
      target: 'x86_64-pc-windows-msvc',
    },
    ...overrides,
  };
}

function createAssessment(
  softwareName: string,
  overrides: Partial<InstallAssessmentResult> = {},
): InstallAssessmentResult {
  return {
    registryName: 'remote-catalog',
    registrySource: 'https://example.com/registry',
    softwareName,
    manifestSource: `${softwareName}.hub.yaml`,
    manifestName: softwareName,
    manifestDescription: `${softwareName} install`,
    manifestHomepage: 'https://openclaw.dev',
    ready: true,
    requiresElevatedSetup: false,
    platform: 'windows',
    effectiveRuntimePlatform: 'windows',
    resolvedInstallScope: 'user',
    resolvedInstallRoot: `D:/OpenClaw/${softwareName}/install`,
    resolvedWorkRoot: `D:/OpenClaw/${softwareName}/work`,
    resolvedBinDir: `D:/OpenClaw/${softwareName}/bin`,
    resolvedDataRoot: `D:/OpenClaw/${softwareName}/data`,
    installControlLevel: 'partial',
    installStatus: 'installed',
    dependencies: [],
    issues: [],
    recommendations: [],
    installation: {
      method: {
        id: softwareName.includes('docker') ? 'docker' : 'pnpm',
        label: softwareName.includes('docker') ? 'Docker Compose' : 'pnpm global',
        type: softwareName.includes('docker') ? 'container' : 'package',
        summary: softwareName.includes('docker')
          ? 'OpenClaw managed by Docker on this host.'
          : 'OpenClaw installed globally with pnpm.',
        notes: [],
      },
      alternatives: [],
      directories: null,
    },
    dataItems: [],
    migrationStrategies: [],
    runtime: {
      hostPlatform: 'windows',
      requestedRuntimePlatform: 'windows',
      effectiveRuntimePlatform: 'windows',
      containerRuntimePreference: 'host',
      resolvedContainerRuntime: 'host',
      wslDistribution: null,
      availableWslDistributions: [],
      wslAvailable: false,
      hostDockerAvailable: true,
      wslDockerAvailable: false,
      runtimeHomeDir: 'D:/Users/admin',
      commandAvailability: {},
    },
    ...overrides,
  };
}

function createCatalogEntry(): InstallCatalogEntry {
  return {
    appId: 'app-openclaw',
    title: 'OpenClaw',
    developer: 'OpenClaw',
    category: 'runtime',
    summary: 'Install OpenClaw through supported host methods.',
    description: null,
    homepage: 'https://openclaw.dev',
    tags: ['openclaw'],
    defaultVariantId: 'openclaw-pnpm',
    defaultSoftwareName: 'openclaw',
    supportedHostPlatforms: ['windows', 'macos', 'ubuntu'],
    variants: [
      {
        id: 'openclaw-pnpm',
        label: 'pnpm install',
        summary: 'Global pnpm install',
        softwareName: 'openclaw-pnpm',
        hostPlatforms: ['windows', 'macos', 'ubuntu'],
        runtimePlatform: 'host',
        installationMethod: {
          id: 'pnpm',
          label: 'pnpm global',
          type: 'package',
          summary: 'Global pnpm install',
          notes: [],
        },
        request: {
          softwareName: 'openclaw-pnpm',
        },
      },
      {
        id: 'openclaw-docker',
        label: 'Docker install',
        summary: 'Docker Compose deployment',
        softwareName: 'openclaw-docker',
        hostPlatforms: ['windows', 'macos', 'ubuntu'],
        runtimePlatform: 'host',
        installationMethod: {
          id: 'docker',
          label: 'Docker Compose',
          type: 'container',
          summary: 'Docker install',
          notes: [],
        },
        request: {
          softwareName: 'openclaw-docker',
        },
      },
    ],
  };
}

function createInstance(
  id: string,
  overrides: Partial<StudioInstanceRecord> = {},
): StudioInstanceRecord {
  return {
    id,
    name: 'OpenClaw Host',
    description: 'Existing attached OpenClaw runtime.',
    runtimeKind: 'openclaw',
    deploymentMode: 'local-external',
    transportKind: 'openclawGatewayWs',
    status: 'online',
    isBuiltIn: false,
    isDefault: false,
    iconType: 'server',
    version: 'host-managed',
    typeLabel: 'Associated OpenClaw',
    host: '127.0.0.1',
    port: 28789,
    baseUrl: 'http://127.0.0.1:28789',
    websocketUrl: 'ws://127.0.0.1:28789',
    cpu: 0,
    memory: 0,
    totalMemory: 'Unknown',
    uptime: '-',
    capabilities: ['chat', 'files', 'health', 'models', 'tasks', 'tools', 'memory'],
    storage: {
      provider: 'localFile',
      namespace: 'openclaw-local-external',
    },
    config: {
      port: '28789',
      sandbox: true,
      autoUpdate: false,
      logLevel: 'info',
      corsOrigins: '*',
      workspacePath: 'D:/OpenClaw/openclaw-pnpm/workspace',
      baseUrl: 'http://127.0.0.1:28789',
      websocketUrl: 'ws://127.0.0.1:28789',
      authToken: 'existing-token',
    },
    createdAt: 1,
    updatedAt: 1,
    lastSeenAt: 1,
    ...overrides,
  };
}

await runTest('discoverInstalledOpenClawInstalls returns installed variants with association metadata', async () => {
  const catalog = createCatalogEntry();
  const service = createInstanceOnboardingService({
    runtimeApi: {
      getRuntimeInfo: async () => createRuntimeInfo(),
    },
    installerApi: {
      listInstallCatalog: async () => [catalog],
      inspectInstall: async (request) => {
        if (request.softwareName === 'openclaw-pnpm') {
          return createAssessment('openclaw-pnpm');
        }

        return createAssessment('openclaw-docker', {
          installStatus: 'uninstalled',
        });
      },
    },
    studioApi: {
      listInstances: async () => [
        createInstance('instance-associated'),
      ],
      createInstance: async () => {
        throw new Error('createInstance should not run during discovery');
      },
      updateInstance: async () => {
        throw new Error('updateInstance should not run during discovery');
      },
    },
    kernelConfigApi: {
      resolveInstallConfigPath: async (input) => {
        assert.deepEqual(input, {
          kernelId: 'openclaw',
          installRoot: 'D:/OpenClaw/openclaw-pnpm/install',
          workRoot: 'D:/OpenClaw/openclaw-pnpm/work',
          dataRoot: 'D:/OpenClaw/openclaw-pnpm/data',
          homeRoots: ['D:/Users/admin'],
        });
        return 'D:/Users/admin/.openclaw/openclaw.json';
      },
    },
    openClawAssociationApi: {
      readAssociationSnapshot: async () => ({
        root: {
          gateway: {
            port: 28789,
            auth: {
              token: 'pnpm-token',
            },
          },
        },
        defaultWorkspacePath: 'D:/OpenClaw/openclaw-pnpm/workspace',
      }),
    },
  });

  const installs = await service.discoverInstalledOpenClawInstalls();

  assert.equal(installs.length, 1);
  assert.deepEqual(installs[0], {
    id: 'openclaw-pnpm',
    label: 'pnpm install',
    summary: 'Global pnpm install',
    methodId: 'pnpm',
    methodLabel: 'pnpm global',
    runtimePlatform: 'host',
    installControlLevel: 'partial',
    installStatus: 'installed',
    configFile: 'D:/Users/admin/.openclaw/openclaw.json',
    installRoot: 'D:/OpenClaw/openclaw-pnpm/install',
    workRoot: 'D:/OpenClaw/openclaw-pnpm/work',
    dataRoot: 'D:/OpenClaw/openclaw-pnpm/data',
    workspacePath: 'D:/OpenClaw/openclaw-pnpm/workspace',
    baseUrl: 'http://127.0.0.1:28789',
    websocketUrl: 'ws://127.0.0.1:28789',
    associatedInstanceId: 'instance-associated',
    associationStatus: 'associated',
  });
  assert.equal('configPath' in (installs[0] || {}), false);
});

await runTest(
  'discoverInstalledOpenClawInstalls projects the configured control-ui base path into websocket metadata',
  async () => {
    const catalog = createCatalogEntry();
    const service = createInstanceOnboardingService({
      runtimeApi: {
        getRuntimeInfo: async () => createRuntimeInfo(),
      },
      installerApi: {
        listInstallCatalog: async () => [catalog],
        inspectInstall: async (request) => {
          if (request.softwareName === 'openclaw-pnpm') {
            return createAssessment('openclaw-pnpm');
          }

          return createAssessment('openclaw-docker', {
            installStatus: 'uninstalled',
          });
        },
      },
      studioApi: {
        listInstances: async () => [],
        createInstance: async () => {
          throw new Error('createInstance should not run during discovery');
        },
        updateInstance: async () => {
          throw new Error('updateInstance should not run during discovery');
        },
      },
      kernelConfigApi: {
        resolveInstallConfigPath: async () => 'D:/Users/admin/.openclaw/openclaw.json',
      },
      openClawAssociationApi: {
        readAssociationSnapshot: async () => ({
          root: {
            gateway: {
              port: 28789,
              controlUi: {
                basePath: '/openclaw',
              },
            },
          },
          defaultWorkspacePath: 'D:/OpenClaw/openclaw-pnpm/workspace',
        }),
      },
    });

    const installs = await service.discoverInstalledOpenClawInstalls();

    assert.equal(installs.length, 1);
    assert.equal(installs[0]?.baseUrl, 'http://127.0.0.1:28789');
    assert.equal(installs[0]?.websocketUrl, 'ws://127.0.0.1:28789/openclaw');
  },
);

await runTest('discoverInstalledOpenClawInstalls keeps installs visible when the config file is missing', async () => {
  const service = createInstanceOnboardingService({
    runtimeApi: {
      getRuntimeInfo: async () => createRuntimeInfo(),
    },
    installerApi: {
      listInstallCatalog: async () => [createCatalogEntry()],
      inspectInstall: async (request) => {
        if (request.softwareName === 'openclaw-pnpm') {
          return createAssessment('openclaw-pnpm', {
            installStatus: 'uninstalled',
          });
        }

        return createAssessment('openclaw-docker', {
          installation: {
            method: {
              id: 'docker',
              label: 'Docker Compose',
              type: 'container',
              summary: 'Docker install',
              notes: [],
            },
            alternatives: [],
            directories: null,
          },
        });
      },
    },
    studioApi: {
      listInstances: async () => [],
      createInstance: async () => {
        throw new Error('createInstance should not run during discovery');
      },
      updateInstance: async () => {
        throw new Error('updateInstance should not run during discovery');
      },
    },
    kernelConfigApi: {
      resolveInstallConfigPath: async () => null,
    },
    openClawAssociationApi: {
      readAssociationSnapshot: async () => {
        throw new Error('readAssociationSnapshot should not run when config is missing');
      },
    },
  });

  const installs = await service.discoverInstalledOpenClawInstalls();

  assert.equal(installs.length, 1);
  assert.equal(installs[0]?.associationStatus, 'configMissing');
  assert.equal(installs[0]?.configFile, null);
  assert.equal(installs[0]?.methodId, 'docker');
  assert.equal('configPath' in (installs[0] || {}), false);
});

await runTest('associateInstalledOpenClawInstall updates an existing matching local-external instance instead of duplicating it', async () => {
  const updates: Array<{ id: string; input: StudioUpdateInstanceInput }> = [];
  const creates: StudioCreateInstanceInput[] = [];
  const service = createInstanceOnboardingService({
    runtimeApi: {
      getRuntimeInfo: async () => createRuntimeInfo(),
    },
    installerApi: {
      listInstallCatalog: async () => [createCatalogEntry()],
      inspectInstall: async (request) => {
        assert.equal(request.softwareName, 'openclaw-pnpm');
        return createAssessment('openclaw-pnpm');
      },
    },
    studioApi: {
      listInstances: async () => [createInstance('existing-openclaw')],
      createInstance: async (input) => {
        creates.push(input);
        return createInstance('created-openclaw');
      },
      updateInstance: async (id, input) => {
        updates.push({ id, input });
        return createInstance(id, {
          ...input,
          baseUrl: input.baseUrl ?? 'http://127.0.0.1:28789',
          websocketUrl: input.websocketUrl ?? 'ws://127.0.0.1:28789',
          config: {
            ...createInstance(id).config,
            ...(input.config || {}),
          },
        });
      },
    },
    kernelConfigApi: {
      resolveInstallConfigPath: async () => 'D:/Users/admin/.openclaw/openclaw.json',
    },
    openClawAssociationApi: {
      readAssociationSnapshot: async () => ({
        root: {
          gateway: {
            port: 28789,
            auth: {
              token: 'fresh-token',
            },
          },
        },
        defaultWorkspacePath: 'D:/OpenClaw/openclaw-pnpm/workspace',
      }),
    },
  });

  const result = await service.associateInstalledOpenClawInstall({
    request: { softwareName: 'openclaw-pnpm' },
  });

  assert.equal(result.instance.id, 'existing-openclaw');
  assert.equal(result.mode, 'updated');
  assert.equal(result.configFile, 'D:/Users/admin/.openclaw/openclaw.json');
  assert.equal('configPath' in result, false);
  assert.equal(creates.length, 0);
  assert.equal(updates.length, 1);
  assert.equal(updates[0]?.id, 'existing-openclaw');
  assert.equal(updates[0]?.input.name, 'OpenClaw Host');
  assert.equal(updates[0]?.input.typeLabel, 'Associated OpenClaw');
  assert.deepEqual(updates[0]?.input.config, {
    port: '28789',
    sandbox: true,
    autoUpdate: false,
    logLevel: 'info',
    corsOrigins: '*',
    workspacePath: 'D:/OpenClaw/openclaw-pnpm/workspace',
    baseUrl: 'http://127.0.0.1:28789',
    websocketUrl: 'ws://127.0.0.1:28789',
    authToken: 'fresh-token',
  });
});

await runTest('associateOpenClawConfigFile creates a local-external instance from a manually selected config file', async () => {
  const creates: StudioCreateInstanceInput[] = [];
  const service = createInstanceOnboardingService({
    runtimeApi: {
      getRuntimeInfo: async () => createRuntimeInfo({
        system: {
          os: 'linux',
          arch: 'x64',
          family: 'unix',
          target: 'x86_64-unknown-linux-gnu',
        },
        paths: {
          ...createRuntimeInfo().paths!,
          userRoot: '/home/admin',
          userDir: '/home/admin',
        },
      }),
    },
    installerApi: {
      listInstallCatalog: async () => [createCatalogEntry()],
      inspectInstall: async () => createAssessment('openclaw-pnpm'),
    },
    studioApi: {
      listInstances: async () => [],
      createInstance: async (input) => {
        creates.push(input);
        return createInstance('created-from-config', {
          name: input.name,
          typeLabel: input.typeLabel || 'Associated OpenClaw',
          host: input.host || '127.0.0.1',
          port: input.port ?? 29876,
          baseUrl: input.baseUrl ?? 'http://127.0.0.1:29876',
          websocketUrl: input.websocketUrl ?? 'ws://127.0.0.1:29876',
          config: {
            ...createInstance('created-from-config').config,
            ...(input.config || {}),
          },
        });
      },
      updateInstance: async () => {
        throw new Error('updateInstance should not run when no match exists');
      },
    },
    openClawAssociationApi: {
      readAssociationSnapshot: async (configFile) => {
        assert.equal(configFile, '/opt/openclaw/.openclaw/openclaw.json');
        return {
          root: {
            gateway: {
              port: 29876,
              auth: {
                token: 'docker-token',
              },
            },
          },
          defaultWorkspacePath: '/srv/openclaw/workspace',
        };
      },
    },
  });

  const result = await service.associateOpenClawConfigFile({
    configFile: '/opt/openclaw/.openclaw/openclaw.json',
    installationMethodId: 'docker',
    installationMethodLabel: 'Docker Compose',
  });

  assert.equal(result.mode, 'created');
  assert.equal(result.instance.id, 'created-from-config');
  assert.equal(creates.length, 1);
  assert.equal(creates[0]?.name, 'OpenClaw Host');
  assert.equal(creates[0]?.baseUrl, 'http://127.0.0.1:29876');
  assert.equal(creates[0]?.websocketUrl, 'ws://127.0.0.1:29876');
  assert.equal(creates[0]?.config?.workspacePath, '/srv/openclaw/workspace');
  assert.equal(creates[0]?.config?.authToken, 'docker-token');
  assert.equal(result.configFile, '/opt/openclaw/.openclaw/openclaw.json');
  assert.equal('configPath' in result, false);
});

await runTest(
  'associateOpenClawConfigFile projects the configured control-ui base path into websocket metadata',
  async () => {
    const creates: StudioCreateInstanceInput[] = [];
    const service = createInstanceOnboardingService({
      runtimeApi: {
        getRuntimeInfo: async () => createRuntimeInfo(),
      },
      installerApi: {
        listInstallCatalog: async () => [createCatalogEntry()],
        inspectInstall: async () => createAssessment('openclaw-pnpm'),
      },
      studioApi: {
        listInstances: async () => [],
        createInstance: async (input) => {
          creates.push(input);
          return createInstance('created-with-base-path', {
            name: input.name,
            typeLabel: input.typeLabel || 'Associated OpenClaw',
            host: input.host || '127.0.0.1',
            port: input.port ?? 29876,
            baseUrl: input.baseUrl ?? 'http://127.0.0.1:29876',
            websocketUrl: input.websocketUrl ?? 'ws://127.0.0.1:29876/openclaw',
            config: {
              ...createInstance('created-with-base-path').config,
              ...(input.config || {}),
            },
          });
        },
        updateInstance: async () => {
          throw new Error('updateInstance should not run when no match exists');
        },
      },
      openClawAssociationApi: {
        readAssociationSnapshot: async () => ({
          root: {
            gateway: {
              port: 29876,
              controlUi: {
                basePath: '/openclaw',
              },
              auth: {
                token: 'docker-token',
              },
            },
          },
          defaultWorkspacePath: '/srv/openclaw/workspace',
        }),
      },
    });

    const result = await service.associateOpenClawConfigFile({
      configFile: '/opt/openclaw/.openclaw/openclaw.json',
      installationMethodId: 'docker',
      installationMethodLabel: 'Docker Compose',
    });

    assert.equal(result.mode, 'created');
    assert.equal(result.configFile, '/opt/openclaw/.openclaw/openclaw.json');
    assert.equal(creates.length, 1);
    assert.equal(creates[0]?.baseUrl, 'http://127.0.0.1:29876');
    assert.equal(creates[0]?.websocketUrl, 'ws://127.0.0.1:29876/openclaw');
    assert.equal(creates[0]?.config?.websocketUrl, 'ws://127.0.0.1:29876/openclaw');
  },
);

await runTest('createRemoteOpenClawInstance maps a polished remote gateway form into a remote OpenClaw instance', async () => {
  const creates: StudioCreateInstanceInput[] = [];
  const service = createInstanceOnboardingService({
    runtimeApi: {
      getRuntimeInfo: async () => createRuntimeInfo(),
    },
    installerApi: {
      listInstallCatalog: async () => [createCatalogEntry()],
      inspectInstall: async () => createAssessment('openclaw-pnpm'),
    },
    studioApi: {
      listInstances: async () => [],
      createInstance: async (input) => {
        creates.push(input);
        return createInstance('remote-instance', {
          name: input.name,
          deploymentMode: 'remote',
          host: input.host || 'gateway.example.com',
          port: input.port ?? 443,
          baseUrl: input.baseUrl ?? 'https://gateway.example.com:443',
          websocketUrl: input.websocketUrl ?? 'wss://gateway.example.com:443',
          config: {
            ...createInstance('remote-instance').config,
            ...(input.config || {}),
          },
        });
      },
      updateInstance: async () => {
        throw new Error('updateInstance should not run for new remote instances');
      },
    },
  });

  const result = await service.createRemoteOpenClawInstance({
    name: 'Team Gateway',
    host: 'gateway.example.com',
    port: 443,
    secure: true,
    authToken: 'remote-token',
    description: 'Shared team OpenClaw gateway.',
  });

  assert.equal(result.id, 'remote-instance');
  assert.equal(creates.length, 1);
  assert.deepEqual(creates[0], {
    name: 'Team Gateway',
    description: 'Shared team OpenClaw gateway.',
    runtimeKind: 'openclaw',
    deploymentMode: 'remote',
    transportKind: 'openclawGatewayWs',
    iconType: 'server',
    version: 'remote',
    typeLabel: 'Remote OpenClaw Gateway',
    host: 'gateway.example.com',
    port: 443,
    baseUrl: 'https://gateway.example.com:443',
    websocketUrl: 'wss://gateway.example.com:443',
    storage: {
      provider: 'localFile',
      namespace: 'openclaw-remote',
    },
    config: {
      port: '443',
      sandbox: true,
      autoUpdate: false,
      logLevel: 'info',
      corsOrigins: '*',
      workspacePath: null,
      baseUrl: 'https://gateway.example.com:443',
      websocketUrl: 'wss://gateway.example.com:443',
      authToken: 'remote-token',
    },
  });
});
