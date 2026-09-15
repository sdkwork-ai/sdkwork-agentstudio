// WORKSPACE-PATH:allow-fixture: fixtures name a foreign checkout root, drive, or home directory to exercise path handling, so the literal is the value under assertion rather than a binding this build resolves
import assert from 'node:assert/strict';
import { DEFAULT_BUNDLED_OPENCLAW_VERSION } from '@sdkwork/agentstudio-pc-types';
import type { InstanceWorkbenchSnapshot } from '../types/index.ts';
import { normalizeInstanceWorkbenchSnapshot } from './instanceWorkbenchNormalization.ts';

function runTest(name: string, callback: () => void | Promise<void>) {
  return Promise.resolve()
    .then(callback)
    .then(() => {
      console.log(`ok - ${name}`);
    })
    .catch((error) => {
      console.error(`not ok - ${name}`);
      throw error;
    });
}

function createWorkbench(): InstanceWorkbenchSnapshot {
  return {
    instance: {
      id: 'instance-1',
      name: 'OpenAgent Studio',
      type: 'OpenClaw',
      iconType: 'server',
      status: 'online',
      version: DEFAULT_BUNDLED_OPENCLAW_VERSION,
      uptime: '2h',
      ip: '127.0.0.1',
      cpu: 12,
      memory: 8,
      totalMemory: '16 GB',
    },
    config: {
      port: '3456',
      sandbox: true,
      autoUpdate: false,
      logLevel: 'info',
      corsOrigins: '*',
    },
    token: '',
    logs: '',
    detail: {
      instance: {
        id: 'instance-1',
        name: 'OpenAgent Studio',
        runtimeKind: 'openclaw',
        deploymentMode: 'local-managed',
        transportKind: 'openclawGatewayWs',
        status: 'online',
        isBuiltIn: true,
        isDefault: true,
        iconType: 'server',
        version: DEFAULT_BUNDLED_OPENCLAW_VERSION,
        typeLabel: 'OpenClaw',
        host: '127.0.0.1',
        port: 3456,
        baseUrl: 'http://127.0.0.1:3456',
        websocketUrl: 'ws://127.0.0.1:3456',
        cpu: 12,
        memory: 8,
        totalMemory: '16 GB',
        uptime: '2h',
        capabilities: [],
        storage: {
          provider: 'localFile',
          namespace: 'openclaw-workspace',
        },
        config: {
          port: '3456',
          sandbox: true,
          autoUpdate: false,
          logLevel: 'info',
          corsOrigins: '*',
          workspacePath: 'C:/Users/admin/.sdkwork/crawstudio/.openclaw/workspace',
          baseUrl: 'http://127.0.0.1:3456',
          websocketUrl: 'ws://127.0.0.1:3456',
          authToken: null,
        },
        createdAt: 1,
        updatedAt: 1,
        lastSeenAt: 1,
      },
      config: {
        port: '3456',
        sandbox: true,
        autoUpdate: false,
        logLevel: 'info',
        corsOrigins: '*',
        workspacePath: 'C:/Users/admin/.sdkwork/crawstudio/.openclaw/workspace',
        baseUrl: 'http://127.0.0.1:3456',
        websocketUrl: 'ws://127.0.0.1:3456',
        authToken: null,
      },
      logs: '',
      health: {
        score: 100,
        status: 'healthy',
        checks: [],
        evaluatedAt: 1,
      },
      lifecycle: {
        owner: 'appManaged',
        startStopSupported: true,
        configWritable: true,
        lifecycleControllable: true,
        workbenchManaged: true,
        endpointObserved: true,
        notes: [],
      },
      storage: {
        status: 'ready',
        provider: 'localFile',
        namespace: 'openclaw-workspace',
        durable: true,
        queryable: false,
        transactional: false,
        remote: false,
      },
      connectivity: {
        primaryTransport: 'openclawGatewayWs',
        endpoints: [],
      },
      observability: {
        status: 'ready',
        logAvailable: false,
        logPreview: [],
        metricsSource: 'runtime',
        lastSeenAt: 1,
      },
      dataAccess: {
        routes: [
          {
            id: 'config-route',
            scope: 'config',
            mode: 'managedFile',
            readonly: false,
            target: 'C:/ProgramData/SdkWork/CrawStudio/state/kernels/openclaw/noncanonical-config/openclaw.json',
          },
          {
            id: 'workspace-root',
            scope: 'files',
            mode: 'managedDirectory',
            readonly: false,
            target: 'C:/Users/admin/.sdkwork/crawstudio/.openclaw/workspace',
          },
        ],
      },
      artifacts: [
        {
          id: 'config-file',
          kind: 'configFile',
          location: 'C:/ProgramData/SdkWork/CrawStudio/state/kernels/openclaw/noncanonical-config/openclaw.json',
        },
        {
          id: 'workspace-root',
          kind: 'workspaceDirectory',
          location: 'C:/Users/admin/.sdkwork/crawstudio/.openclaw/workspace',
        },
      ],
      capabilities: [],
      officialRuntimeNotes: [],
      consoleAccess: null,
      workbench: null,
    } as any,
    kernelConfig: {
      configFile:
        'C:/ProgramData/SdkWork/CrawStudio/state/kernels/openclaw/noncanonical-config/openclaw.json',
      configRoot: 'C:/ProgramData/SdkWork/CrawStudio/state/kernels/openclaw/noncanonical-config',
      userRoot: 'C:/ProgramData/SdkWork/CrawStudio/state/kernels/openclaw',
      standardConfigFile: 'C:/Users/admin/.sdkwork/crawstudio/.openclaw/openclaw.json',
      standardStateRoot: 'C:/Users/admin/.sdkwork/crawstudio/.openclaw',
      format: 'json',
      access: 'localFs',
      provenance: 'kernelAuthority',
      writable: true,
      resolved: true,
      schemaVersion: null,
      isStandardUserRootLayout: false,
    },
    kernelAuthority: {
      owner: 'appManaged',
      controlPlane: 'desktopHost',
      lifecycleControl: true,
      configControl: true,
      upgradeControl: true,
      doctorSupport: true,
      migrationSupport: true,
      observable: true,
      writable: true,
    },
    configChannels: [],
    kernelConfigInsights: null,
    configWebSearch: null,
    configXSearch: null,
    configWebSearchNativeCodex: null,
    configWebFetch: null,
    configAuthCooldowns: null,
    configDreaming: null,
    healthScore: 100,
    runtimeStatus: 'healthy',
    connectedChannelCount: 0,
    activeTaskCount: 0,
    installedSkillCount: 0,
    readyToolCount: 0,
    sectionCounts: {
      overview: 2,
      channels: 0,
      cronTasks: 0,
      llmProviders: 0,
      agents: 0,
      skills: 0,
      files: 0,
      memory: 0,
      tools: 0,
      config: 1,
    },
    sectionAvailability: {
      overview: {
        status: 'ready',
        detail: 'ready',
      },
      channels: {
        status: 'planned',
        detail: 'planned',
      },
      cronTasks: {
        status: 'planned',
        detail: 'planned',
      },
      llmProviders: {
        status: 'planned',
        detail: 'planned',
      },
      agents: {
        status: 'planned',
        detail: 'planned',
      },
      skills: {
        status: 'planned',
        detail: 'planned',
      },
      files: {
        status: 'planned',
        detail: 'planned',
      },
      memory: {
        status: 'planned',
        detail: 'planned',
      },
      tools: {
        status: 'planned',
        detail: 'planned',
      },
      config: {
        status: 'ready',
        detail: 'ready',
      },
    },
    channels: [],
    tasks: [],
    agents: [],
    skills: [],
    files: [],
    llmProviders: [],
    memories: [],
    tools: [],
  };
}

await runTest(
  'normalizeInstanceWorkbenchSnapshot rewrites stale kernelConfig and detail config surfaces to the canonical user-root layout',
  () => {
    const workbench = createWorkbench();
    const normalized = normalizeInstanceWorkbenchSnapshot(workbench);

    assert.equal(
      normalized?.kernelConfig?.configFile,
      'C:/Users/admin/.sdkwork/crawstudio/.openclaw/openclaw.json',
    );
    assert.equal(
      normalized?.detail.dataAccess.routes.find((route) => route.scope === 'config')?.target,
      'C:/Users/admin/.sdkwork/crawstudio/.openclaw/openclaw.json',
    );
    assert.equal(
      normalized?.detail.artifacts.find((artifact) => artifact.kind === 'configFile')?.location,
      'C:/Users/admin/.sdkwork/crawstudio/.openclaw/openclaw.json',
    );
  },
);
