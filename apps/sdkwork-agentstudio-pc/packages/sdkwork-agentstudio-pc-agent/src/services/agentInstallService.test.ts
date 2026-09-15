// WORKSPACE-PATH:allow-fixture: fixtures name a foreign checkout root, drive, or home directory to exercise path handling, so the literal is the value under assertion rather than a binding this build resolves
import assert from 'node:assert/strict';
import type { PlatformAPI, StudioPlatformAPI } from '@sdkwork/agentstudio-pc-infrastructure';
import type {
  StudioInstanceDetailRecord,
  StudioInstanceRecord,
  StudioInstanceStatus,
} from '@sdkwork/agentstudio-pc-types';

const BUILT_IN_INSTANCE_ID = 'managed-openclaw-primary';

async function runTest(name: string, callback: () => Promise<void> | void) {
  try {
    await callback();
    console.log(`ok - ${name}`);
  } catch (error) {
    console.error(`not ok - ${name}`);
    throw error;
  }
}

function normalizePath(path: string) {
  return path.replace(/\\/g, '/').replace(/\/+$/, '');
}

function createPlatformStub(
  fileSystem: Record<string, string>,
  directories: Set<string>,
  overrides: Partial<PlatformAPI> = {},
): PlatformAPI {
  return {
    getPlatform: () => 'desktop',
    getDeviceId: async () => 'agent-install-test-device',
    setStorage: async () => {},
    getStorage: async () => null,
    copy: async () => {},
    showNotification: async () => {},
    openExternal: async () => {},
    supportsNativeScreenshot: () => false,
    captureScreenshot: async () => null,
    fetchRemoteUrl: async (url) => ({
      url,
      bytes: new Uint8Array(),
    }),
    selectFile: async () => [],
    saveFile: async () => {},
    minimizeWindow: async () => {},
    maximizeWindow: async () => {},
    restoreWindow: async () => {},
    isWindowMaximized: async () => false,
    subscribeWindowMaximized: async () => async () => {},
    closeWindow: async () => {},
    listDirectory: async () => [],
    pathExists: async (path) => {
      const normalizedPath = normalizePath(path);
      return directories.has(normalizedPath) || fileSystem[normalizedPath] !== undefined;
    },
    pathExistsForUserTooling: async (path) => {
      const normalizedPath = normalizePath(path);
      return directories.has(normalizedPath) || fileSystem[normalizedPath] !== undefined;
    },
    getPathInfo: async (path) => {
      const normalizedPath = normalizePath(path);
      const fileContent = fileSystem[normalizedPath];
      const isDirectory = directories.has(normalizedPath);
      const kind = isDirectory ? 'directory' : fileContent !== undefined ? 'file' : 'missing';
      return {
        path,
        name: normalizedPath.split('/').pop() || normalizedPath,
        kind,
        size: fileContent?.length ?? null,
        extension: normalizedPath.includes('.') ? normalizedPath.slice(normalizedPath.lastIndexOf('.')) : null,
        exists: isDirectory || fileContent !== undefined,
        lastModifiedMs: null,
      };
    },
    createDirectory: async (path) => {
      directories.add(normalizePath(path));
    },
    removePath: async () => {},
    copyPath: async () => {},
    movePath: async () => {},
    readBinaryFile: async () => new Uint8Array(),
    writeBinaryFile: async () => {},
    readFile: async (path) => {
      const normalizedPath = normalizePath(path);
      const content = fileSystem[normalizedPath];
      if (content === undefined) {
        throw new Error(`Missing file: ${normalizedPath}`);
      }

      return content;
    },
    readFileForUserTooling: async (path) => {
      const normalizedPath = normalizePath(path);
      const content = fileSystem[normalizedPath];
      if (content === undefined) {
        throw new Error(`Missing file: ${normalizedPath}`);
      }

      return content;
    },
    writeFile: async (path, content) => {
      fileSystem[normalizePath(path)] = content;
    },
    ...overrides,
  };
}

function createInstanceRecord(overrides: Partial<StudioInstanceRecord> = {}): StudioInstanceRecord {
  return {
    id: 'openclaw-managed',
    name: 'OpenClaw Runtime',
    description: 'OpenClaw instance',
    runtimeKind: 'openclaw',
    deploymentMode: 'local-managed',
    transportKind: 'openclawGatewayWs',
    status: 'online',
    isBuiltIn: false,
    isDefault: true,
    iconType: 'server',
    version: '1.0.0',
    typeLabel: 'OpenClaw',
    host: '127.0.0.1',
    port: 28789,
    baseUrl: 'http://127.0.0.1:28789',
    websocketUrl: 'ws://127.0.0.1:28789',
    cpu: 0,
    memory: 0,
    totalMemory: '32 GB',
    uptime: '1h',
    capabilities: ['chat', 'health', 'tasks', 'models', 'tools'],
    storage: {
      profileId: 'default-local',
      provider: 'localFile',
      namespace: 'openclaw-managed',
      database: null,
      connectionHint: null,
      endpoint: null,
    },
    config: {
      port: '28789',
      sandbox: true,
      autoUpdate: false,
      logLevel: 'info',
      corsOrigins: '*',
      workspacePath: 'D:/OpenClaw/workspace',
      baseUrl: 'http://127.0.0.1:28789',
      websocketUrl: 'ws://127.0.0.1:28789',
      authToken: null,
    },
    createdAt: 1,
    updatedAt: 1,
    lastSeenAt: 1,
    ...overrides,
  };
}

function createInstanceDetail(
  instance: StudioInstanceRecord,
  input: {
    configFile?: string | null;
    configRouteMode?: 'managedFile' | 'metadataOnly';
    includeConfigArtifact?: boolean;
    configWritable?: boolean;
    status?: StudioInstanceStatus;
    owner?: 'appManaged' | 'externalProcess' | 'remoteService';
  },
): StudioInstanceDetailRecord {
  return {
    instance: {
      ...instance,
      status: input.status || instance.status,
    },
    config: instance.config,
    logs: '',
    health: {
      score: 100,
      status: 'healthy',
      checks: [],
      evaluatedAt: 1,
    },
    lifecycle: {
      owner: input.owner ?? 'appManaged',
      startStopSupported: (input.owner ?? 'appManaged') === 'appManaged',
      configWritable: input.configWritable ?? true,
      notes: [],
    },
    storage: {
      status: 'ready',
      profileId: instance.storage.profileId || null,
      provider: instance.storage.provider,
      namespace: instance.storage.namespace,
      database: instance.storage.database || null,
      connectionHint: instance.storage.connectionHint || null,
      endpoint: instance.storage.endpoint || null,
      durable: true,
      queryable: true,
      transactional: false,
      remote: false,
    },
    connectivity: {
      primaryTransport: instance.transportKind,
      endpoints: [],
    },
    observability: {
      status: 'ready',
      logAvailable: false,
      logFilePath: null,
      logPreview: [],
      lastSeenAt: 1,
      metricsSource: 'derived',
    },
    dataAccess: {
      routes: input.configFile
        ? [
            {
              id: 'config-file',
              label: 'Config file',
              scope: 'config',
              mode: input.configRouteMode ?? 'managedFile',
              status: 'ready',
              target: input.configFile,
              readonly: false,
              authoritative: (input.configRouteMode ?? 'managedFile') === 'managedFile',
              detail: 'OpenClaw config file',
              source: 'config',
            },
          ]
        : [],
    },
    artifacts:
      input.configFile && input.includeConfigArtifact !== false
        ? [
            {
              id: 'config-file',
              label: 'Config file',
              kind: 'configFile',
              status: 'available',
              location: input.configFile,
              readonly: false,
              detail: 'OpenClaw config file',
              source: 'config',
            },
          ]
        : [],
    capabilities: [],
    officialRuntimeNotes: [],
    consoleAccess: null,
    workbench: null,
  };
}

function createStudioStub(
  originalStudio: StudioPlatformAPI,
  instances: StudioInstanceRecord[],
  detailsById: Record<string, StudioInstanceDetailRecord | null | Error>,
): StudioPlatformAPI {
  return {
    listInstances: async () => instances.map((instance) => ({ ...instance })),
    getInstance: async (id) => instances.find((instance) => instance.id === id) || null,
    getInstanceDetail: async (id) => {
      const detail = detailsById[id];
      if (detail instanceof Error) {
        throw detail;
      }

      return detail || null;
    },
    createInstance: originalStudio.createInstance.bind(originalStudio),
    updateInstance: originalStudio.updateInstance.bind(originalStudio),
    deleteInstance: originalStudio.deleteInstance.bind(originalStudio),
    startInstance: originalStudio.startInstance.bind(originalStudio),
    stopInstance: originalStudio.stopInstance.bind(originalStudio),
    restartInstance: originalStudio.restartInstance.bind(originalStudio),
    setInstanceStatus: originalStudio.setInstanceStatus.bind(originalStudio),
    getInstanceConfig: originalStudio.getInstanceConfig.bind(originalStudio),
    updateInstanceConfig: originalStudio.updateInstanceConfig.bind(originalStudio),
    getInstanceLogs: originalStudio.getInstanceLogs.bind(originalStudio),
    createInstanceTask: originalStudio.createInstanceTask.bind(originalStudio),
    updateInstanceTask: originalStudio.updateInstanceTask.bind(originalStudio),
    updateInstanceFileContent: originalStudio.updateInstanceFileContent.bind(originalStudio),
    updateInstanceLlmProviderConfig:
      originalStudio.updateInstanceLlmProviderConfig.bind(originalStudio),
    cloneInstanceTask: originalStudio.cloneInstanceTask.bind(originalStudio),
    runInstanceTaskNow: originalStudio.runInstanceTaskNow.bind(originalStudio),
    listInstanceTaskExecutions: originalStudio.listInstanceTaskExecutions.bind(originalStudio),
    updateInstanceTaskStatus: originalStudio.updateInstanceTaskStatus.bind(originalStudio),
    deleteInstanceTask: originalStudio.deleteInstanceTask.bind(originalStudio),
    listConversations: originalStudio.listConversations.bind(originalStudio),
    putConversation: originalStudio.putConversation.bind(originalStudio),
    deleteConversation: originalStudio.deleteConversation.bind(originalStudio),
  };
}

await runTest(
  'agentInstallService includes config-backed built-in OpenClaw targets, surfaces install kernel ids, sorts them first, and skips metadata-only fallbacks',
  async () => {
    const { configurePlatformBridge, getPlatformBridge } = await import('@sdkwork/agentstudio-pc-infrastructure');
    const { agentInstallService } = await import('./agentInstallService.ts');

    const originalBridge = getPlatformBridge();
    const builtInConfigPath = 'D:/agentstudio/.openclaw/openclaw.json';
    const externalConfigPath = 'D:/External/.openclaw/openclaw.json';
    const fileSystem: Record<string, string> = {
      [normalizePath(builtInConfigPath)]: `{
  models: { providers: {} },
  agents: {
    defaults: {
      workspace: "D:/agentstudio/workspace",
    },
    list: [
      {
        id: "main",
        name: "Main",
        default: true,
        workspace: "D:/agentstudio/workspace",
        agentDir: "D:/agentstudio/.openclaw/agents/main/agent",
      },
    ],
  },
}`,
      [normalizePath(externalConfigPath)]: `{
  models: { providers: {} },
  agents: {
    defaults: {
      workspace: "D:/External/workspace",
    },
    list: [
      {
        id: "main",
        name: "Main",
        default: true,
        workspace: "D:/External/workspace",
        agentDir: "D:/External/.openclaw/agents/main/agent",
      },
    ],
  },
}`,
    };
    const directories = new Set<string>([
      'D:/agentstudio',
      'D:/agentstudio/.openclaw',
      'D:/agentstudio/workspace',
      'D:/agentstudio/.openclaw/agents',
      'D:/External',
      'D:/External/.openclaw',
      'D:/External/workspace',
      'D:/External/.openclaw/agents',
    ]);
    const builtInInstance = createInstanceRecord({
      id: BUILT_IN_INSTANCE_ID,
      name: 'Local Built-In',
      description: 'Packaged local OpenClaw kernel managed by Agent Studio.',
      isBuiltIn: true,
      typeLabel: 'Built-In OpenClaw',
    });
    const externalInstance = createInstanceRecord({
      id: 'external-openclaw',
      name: 'External OpenClaw',
      deploymentMode: 'local-external',
      isDefault: false,
      typeLabel: 'Local External OpenClaw',
      host: '192.168.1.5',
    });
    const metadataOnlyBuiltIn = createInstanceRecord({
      id: 'web-built-in-fallback',
      name: 'Web Built-In Fallback',
      isBuiltIn: true,
      isDefault: false,
      typeLabel: 'Built-In OpenClaw',
    });

    configurePlatformBridge({
      platform: createPlatformStub(fileSystem, directories),
      studio: createStudioStub(
        originalBridge.studio,
        [externalInstance, metadataOnlyBuiltIn, builtInInstance],
        {
          [builtInInstance.id]: createInstanceDetail(builtInInstance, {
            configFile: builtInConfigPath,
          }),
          [externalInstance.id]: createInstanceDetail(externalInstance, {
            configFile: externalConfigPath,
            owner: 'externalProcess',
          }),
          [metadataOnlyBuiltIn.id]: createInstanceDetail(metadataOnlyBuiltIn, {
            configFile: 'studio.instances registry metadata',
            configRouteMode: 'metadataOnly',
            includeConfigArtifact: false,
          }),
        },
      ),
    });

    try {
      const targets = await agentInstallService.listInstallTargets();

      assert.deepEqual(
        targets.map((target) => [target.id, target.isBuiltIn, target.deploymentMode]),
        [
          [BUILT_IN_INSTANCE_ID, true, 'local-managed'],
          ['external-openclaw', false, 'local-external'],
        ],
      );
      assert.deepEqual(
        targets.map((target) => target.kernelId),
        ['openclaw', 'openclaw'],
      );
      assert.equal(targets[0]?.typeLabel, 'Built-In OpenClaw');
      assert.equal(targets[0]?.configFile, builtInConfigPath);
      assert.equal(targets[1]?.configFile, externalConfigPath);
    } finally {
      configurePlatformBridge(originalBridge);
    }
  },
);
await runTest(
  'agentInstallService skips metadata-only OpenClaw targets even when a config artifact path is present',
  async () => {
    const { configurePlatformBridge, getPlatformBridge } = await import('@sdkwork/agentstudio-pc-infrastructure');
    const { agentInstallService } = await import('./agentInstallService.ts');

    const originalBridge = getPlatformBridge();
    const builtInConfigPath = 'D:/Users/admin/.openclaw/openclaw.json';
    const metadataArtifactPath = 'D:/Shadow/.openclaw/openclaw.json';
    const fileSystem: Record<string, string> = {
      [normalizePath(builtInConfigPath)]: `{
  models: { providers: {} },
  agents: { list: [{ id: 'main', name: 'Main', workspace: 'D:/Users/admin/workspace', agentDir: 'D:/Users/admin/.openclaw/agents/main/agent' }] }
}`,
      [normalizePath(metadataArtifactPath)]: `{
  models: { providers: {} },
  agents: { list: [{ id: 'ghost', name: 'Ghost', workspace: 'D:/Shadow/workspace', agentDir: 'D:/Shadow/.openclaw/agents/ghost/agent' }] }
}`,
    };
    const directories = new Set<string>([
      'D:/Users/admin/.openclaw',
      'D:/Users/admin/workspace',
      'D:/Users/admin/.openclaw/agents',
      'D:/Shadow/.openclaw',
      'D:/Shadow/workspace',
      'D:/Shadow/.openclaw/agents',
    ]);

    const builtInInstance = createInstanceRecord({
      id: BUILT_IN_INSTANCE_ID,
      name: 'Local Built-In',
      description: 'Packaged local OpenClaw kernel managed by Agent Studio.',
      isBuiltIn: true,
      typeLabel: 'Built-In OpenClaw',
    });
    const metadataOnlyInstance = createInstanceRecord({
      id: 'metadata-only-artifact',
      name: 'Metadata Only Artifact',
      isBuiltIn: false,
      isDefault: false,
      deploymentMode: 'remote',
      typeLabel: 'Remote Metadata Projection',
      host: '10.0.0.22',
    });

    configurePlatformBridge({
      platform: createPlatformStub(fileSystem, directories),
      studio: createStudioStub(
        originalBridge.studio,
        [metadataOnlyInstance, builtInInstance],
        {
          [builtInInstance.id]: createInstanceDetail(builtInInstance, {
            configFile: builtInConfigPath,
          }),
          [metadataOnlyInstance.id]: createInstanceDetail(metadataOnlyInstance, {
            configFile: metadataArtifactPath,
            configRouteMode: 'metadataOnly',
          }),
        },
      ),
    });

    try {
      const targets = await agentInstallService.listInstallTargets();

      assert.deepEqual(
        targets.map((target) => target.id),
        [BUILT_IN_INSTANCE_ID],
      );
    } finally {
      configurePlatformBridge(originalBridge);
    }
  },
);
await runTest(
  'agentInstallService lists only writable OpenClaw targets and tracks installed curated templates',
  async () => {
    const { configurePlatformBridge, getPlatformBridge } = await import('@sdkwork/agentstudio-pc-infrastructure');
    const { agentInstallService } = await import('./agentInstallService.ts');

    const originalBridge = getPlatformBridge();
    const configFile = 'D:/OpenClaw/.openclaw/openclaw.json';
    const readOnlyConfigPath = 'D:/ReadOnly/.openclaw/openclaw.json';
    const fileSystem: Record<string, string> = {
      [normalizePath(configFile)]: `{
  models: { providers: {} },
  agents: {
    defaults: {
      workspace: "D:/OpenClaw/workspace",
    },
    list: [
      {
        id: "main",
        name: "Main",
        default: true,
        workspace: "D:/OpenClaw/workspace",
        agentDir: "D:/OpenClaw/.openclaw/agents/main/agent",
      },
      {
        id: "coding-engineer",
        name: "Coding Engineer",
        workspace: "D:/OpenClaw/.openclaw/workspace-coding-engineer",
        agentDir: "D:/OpenClaw/.openclaw/agents/coding-engineer/agent",
      },
    ],
  },
}`,
      [normalizePath(readOnlyConfigPath)]: `{
  models: { providers: {} },
  agents: { defaults: {} },
}`,
    };
    const directories = new Set<string>([
      'D:/OpenClaw',
      'D:/OpenClaw/.openclaw',
      'D:/OpenClaw/workspace',
      'D:/OpenClaw/.openclaw/agents',
      'D:/ReadOnly',
      'D:/ReadOnly/.openclaw',
    ]);
    const managedInstance = createInstanceRecord();
    const readOnlyInstance = createInstanceRecord({
      id: 'openclaw-readonly',
      name: 'ReadOnly OpenClaw',
      host: '192.168.1.7',
      isDefault: false,
    });
    const detailsById = {
      [managedInstance.id]: createInstanceDetail(managedInstance, {
        configFile,
      }),
      [readOnlyInstance.id]: createInstanceDetail(readOnlyInstance, {
        configFile: readOnlyConfigPath,
        configWritable: false,
      }),
    };

    configurePlatformBridge({
      platform: createPlatformStub(fileSystem, directories),
      studio: createStudioStub(originalBridge.studio, [managedInstance, readOnlyInstance], detailsById),
    });

    try {
      const targets = await agentInstallService.listInstallTargets();

      assert.equal(targets.length, 1);
      assert.equal(targets[0]?.id, managedInstance.id);
      assert.equal(targets[0]?.agentCount, 2);
      assert.deepEqual(targets[0]?.installedTemplateIds, ['coding-engineer']);
      assert.deepEqual(targets[0]?.installedAgentIds, ['main', 'coding-engineer']);
    } finally {
      configurePlatformBridge(originalBridge);
    }
  },
);

await runTest(
  'agentInstallService keeps usable targets discoverable when another OpenClaw instance detail fails',
  async () => {
    const { configurePlatformBridge, getPlatformBridge } = await import('@sdkwork/agentstudio-pc-infrastructure');
    const { agentInstallService } = await import('./agentInstallService.ts');

    const originalBridge = getPlatformBridge();
    const configFile = 'D:/OpenClaw/.openclaw/openclaw.json';
    const fileSystem: Record<string, string> = {
      [normalizePath(configFile)]: `{
  models: { providers: {} },
  agents: {
    defaults: {
      workspace: "D:/OpenClaw/workspace",
    },
    list: [
      {
        id: "main",
        name: "Main",
        default: true,
        workspace: "D:/OpenClaw/workspace",
        agentDir: "D:/OpenClaw/.openclaw/agents/main/agent",
      },
    ],
  },
}`,
    };
    const directories = new Set<string>([
      'D:/OpenClaw',
      'D:/OpenClaw/.openclaw',
      'D:/OpenClaw/workspace',
      'D:/OpenClaw/.openclaw/agents',
    ]);
    const managedInstance = createInstanceRecord();
    const brokenInstance = createInstanceRecord({
      id: 'openclaw-broken',
      name: 'Broken OpenClaw',
      host: '192.168.1.9',
      isDefault: false,
    });

    configurePlatformBridge({
      platform: createPlatformStub(fileSystem, directories),
      studio: createStudioStub(originalBridge.studio, [managedInstance, brokenInstance], {
        [managedInstance.id]: createInstanceDetail(managedInstance, {
          configFile,
        }),
        [brokenInstance.id]: new Error('Broken instance detail'),
      }),
    });

    try {
      const targets = await agentInstallService.listInstallTargets();

      assert.equal(targets.length, 1);
      assert.equal(targets[0]?.id, managedInstance.id);
    } finally {
      configurePlatformBridge(originalBridge);
    }
  },
);

await runTest(
  'agentInstallService installs workspace files, agent config, and multi-agent defaults into the selected OpenClaw instance',
  async () => {
    const { configurePlatformBridge, getPlatformBridge } = await import('@sdkwork/agentstudio-pc-infrastructure');
    const { openClawConfigService } = await import('@sdkwork/agentstudio-pc-core');
    const { agentInstallService } = await import('./agentInstallService.ts');

    const originalBridge = getPlatformBridge();
    const configFile = 'D:/OpenClaw/.openclaw/openclaw.json';
    const fileSystem: Record<string, string> = {
      [normalizePath(configFile)]: `{
  models: { providers: {} },
  agents: {
    defaults: {
      workspace: "D:/OpenClaw/workspace",
    },
    list: [
      {
        id: "main",
        name: "Main",
        default: true,
        workspace: "D:/OpenClaw/workspace",
        agentDir: "D:/OpenClaw/.openclaw/agents/main/agent",
      },
      {
        id: "coding-engineer",
        name: "Coding Engineer",
        workspace: "D:/OpenClaw/.openclaw/workspace-coding-engineer",
        agentDir: "D:/OpenClaw/.openclaw/agents/coding-engineer/agent",
      },
    ],
  },
}`,
    };
    const directories = new Set<string>([
      'D:/OpenClaw',
      'D:/OpenClaw/.openclaw',
      'D:/OpenClaw/workspace',
      'D:/OpenClaw/.openclaw/agents',
      'D:/OpenClaw/.openclaw/agents/main',
      'D:/OpenClaw/.openclaw/agents/main/agent',
      'D:/OpenClaw/.openclaw/agents/coding-engineer',
      'D:/OpenClaw/.openclaw/agents/coding-engineer/agent',
    ]);
    const managedInstance = createInstanceRecord();
    const detailsById = {
      [managedInstance.id]: createInstanceDetail(managedInstance, {
        configFile,
      }),
    };

    configurePlatformBridge({
      platform: createPlatformStub(fileSystem, directories),
      studio: createStudioStub(originalBridge.studio, [managedInstance], detailsById),
    });

    try {
      const snapshot = await agentInstallService.installTemplate({
        instanceId: managedInstance.id,
        templateId: 'ops-responder',
      });

      const installedAgent = snapshot.agentSnapshots.find((agent) => agent.id === 'ops-responder');
      assert.ok(installedAgent);
      assert.equal(
        installedAgent?.workspace,
        'D:/OpenClaw/.openclaw/workspace-ops-responder',
      );
      assert.equal(
        installedAgent?.agentDir,
        'D:/OpenClaw/.openclaw/agents/ops-responder/agent',
      );

      const workspaceRoot = 'D:/OpenClaw/.openclaw/workspace-ops-responder';
      for (const fileName of [
        'AGENTS.md',
        'BOOT.md',
        'SOUL.md',
        'TOOLS.md',
        'IDENTITY.md',
        'USER.md',
        'HEARTBEAT.md',
        'BOOTSTRAP.md',
        'MEMORY.md',
      ]) {
        assert.equal(
          typeof fileSystem[normalizePath(`${workspaceRoot}/${fileName}`)] === 'string',
          true,
        );
      }

      const coordinatorWorkspaceRoot = 'D:/OpenClaw/workspace';
      for (const fileName of [
        'AGENTS.md',
        'BOOT.md',
        'SOUL.md',
        'TOOLS.md',
        'IDENTITY.md',
        'USER.md',
        'HEARTBEAT.md',
        'BOOTSTRAP.md',
        'MEMORY.md',
      ]) {
        assert.equal(
          typeof fileSystem[normalizePath(`${coordinatorWorkspaceRoot}/${fileName}`)] === 'string',
          true,
        );
      }

      assert.equal(directories.has('D:/OpenClaw/.openclaw/workspace-ops-responder'), true);
      assert.equal(directories.has('D:/OpenClaw/.openclaw/workspace-ops-responder/memory'), true);
      assert.equal(directories.has('D:/OpenClaw/workspace/memory'), true);
      assert.equal(directories.has('D:/OpenClaw/.openclaw/agents/main/sessions'), true);
      assert.equal(directories.has('D:/OpenClaw/.openclaw/agents/ops-responder/agent'), true);
      assert.equal(directories.has('D:/OpenClaw/.openclaw/agents/ops-responder/sessions'), true);

      const updatedSnapshot = await openClawConfigService.readConfigSnapshot(configFile);
      assert.deepEqual(
        updatedSnapshot.agentSnapshots.map((agent) => agent.id),
        ['main', 'coding-engineer', 'ops-responder'],
      );
      assert.equal(
        JSON.stringify(updatedSnapshot.root.tools).includes('"enabled":true'),
        true,
      );
      assert.equal(
        JSON.stringify(updatedSnapshot.root.tools).includes('ops-responder'),
        true,
      );
      assert.equal(
        JSON.stringify(updatedSnapshot.root.tools).includes('"visibility":"all"'),
        true,
      );
      assert.equal(
        JSON.stringify(updatedSnapshot.root.agents).includes('"maxConcurrent":4'),
        true,
      );
      assert.equal(
        JSON.stringify(updatedSnapshot.root.agents).includes('"maxSpawnDepth":2'),
        true,
      );
      assert.equal(
        JSON.stringify(updatedSnapshot.root.agents).includes('"maxChildrenPerAgent":5'),
        true,
      );
    } finally {
      configurePlatformBridge(originalBridge);
    }
  },
);
