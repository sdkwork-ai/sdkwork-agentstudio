// WORKSPACE-PATH:allow-fixture: fixtures name a foreign checkout root, drive, or home directory to exercise path handling, so the literal is the value under assertion rather than a binding this build resolves
import assert from 'node:assert/strict';
import type { StudioInstanceDetailRecord } from '@sdkwork/agentstudio-pc-types';
import { resolveKernelConfigPathWithFallback } from './kernelConfigPathFallback.ts';

async function runTest(name: string, callback: () => Promise<void> | void) {
  try {
    await callback();
    console.log(`ok - ${name}`);
  } catch (error) {
    console.error(`not ok - ${name}`);
    throw error;
  }
}

function createDetail(): StudioInstanceDetailRecord {
  return {
    instance: {
      id: 'openclaw-managed',
      name: 'OpenClaw',
      description: 'OpenClaw runtime',
      runtimeKind: 'openclaw',
      deploymentMode: 'local-managed',
      transportKind: 'openclawGatewayWs',
      status: 'online',
      isBuiltIn: true,
      isDefault: true,
      iconType: 'server',
      version: '1.0.0',
      typeLabel: 'OpenClaw',
      host: '127.0.0.1',
      port: 21280,
      baseUrl: 'http://127.0.0.1:21280',
      websocketUrl: 'ws://127.0.0.1:21280',
      cpu: 0,
      memory: 0,
      totalMemory: '32 GB',
      uptime: '1h',
      capabilities: [],
      storage: {
        profileId: 'default',
        provider: 'localFile',
        namespace: 'openclaw-managed',
        database: null,
        connectionHint: null,
        endpoint: null,
      },
      config: {
        port: '21280',
        sandbox: true,
        autoUpdate: false,
        logLevel: 'info',
        corsOrigins: '*',
        workspacePath: 'C:/Users/admin/.openclaw/workspace',
        baseUrl: 'http://127.0.0.1:21280',
        websocketUrl: 'ws://127.0.0.1:21280',
        authToken: null,
      },
      createdAt: 1,
      updatedAt: 1,
      lastSeenAt: 1,
    },
    config: {
      port: '21280',
      sandbox: true,
      autoUpdate: false,
      logLevel: 'info',
      corsOrigins: '*',
      workspacePath: 'C:/Users/admin/.openclaw/workspace',
      baseUrl: 'http://127.0.0.1:21280',
      websocketUrl: 'ws://127.0.0.1:21280',
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
      notes: [],
    },
    storage: {
      status: 'ready',
      profileId: 'default',
      provider: 'localFile',
      namespace: 'openclaw-managed',
      database: null,
      connectionHint: null,
      endpoint: null,
      durable: true,
      queryable: true,
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
      logFilePath: null,
      logPreview: [],
      lastSeenAt: 1,
      metricsSource: 'derived',
    },
    dataAccess: {
      routes: [],
    },
    artifacts: [],
    capabilities: [],
    officialRuntimeNotes: [],
    consoleAccess: null,
    workbench: null,
  };
}

await runTest(
  'resolveKernelConfigPathWithFallback prefers the standardized instance config path',
  () => {
    const detail = createDetail();
    const resolved = resolveKernelConfigPathWithFallback(
      {
        resolveInstanceConfigPath: () => 'C:/Users/admin/.openclaw/openclaw.json',
        resolveAttachedKernelConfigFile: () => 'C:/ProgramData/OpenClaw/config/openclaw.json',
      },
      detail,
    );

    assert.equal(resolved, 'C:/Users/admin/.openclaw/openclaw.json');
  },
);

await runTest(
  'resolveKernelConfigPathWithFallback falls back to the legacy attachment resolver when needed',
  () => {
    const detail = createDetail();
    const resolved = resolveKernelConfigPathWithFallback(
      {
        resolveAttachedKernelConfigFile: () => 'C:/Users/admin/.openclaw/openclaw.json',
      },
      detail,
    );

    assert.equal(resolved, 'C:/Users/admin/.openclaw/openclaw.json');
  },
);
