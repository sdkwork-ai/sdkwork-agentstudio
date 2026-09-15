// WORKSPACE-PATH:allow-fixture: fixtures name a foreign checkout root, drive, or home directory to exercise path handling, so the literal is the value under assertion rather than a binding this build resolves
import assert from 'node:assert/strict';
import type {
  OpenClawConfigSnapshot,
} from '@sdkwork/agentstudio-pc-core';
import type { StudioInstanceDetailRecord } from '@sdkwork/agentstudio-pc-types';
import {
  createOpenClawGatewayHistoryConfigService,
} from './openClawGatewayHistoryConfigService.ts';

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

function createDetail(): StudioInstanceDetailRecord {
  return {
    instance: {
      id: 'instance-a',
      name: 'OpenClaw A',
      runtimeKind: 'openclaw',
      deploymentMode: 'local-managed',
      transportKind: 'openclawGatewayWs',
      status: 'online',
      isBuiltIn: true,
      isDefault: false,
      iconType: 'server',
      version: '2026.4.1',
      typeLabel: 'OpenClaw',
      host: '127.0.0.1',
      port: 18888,
      baseUrl: 'http://127.0.0.1:18888',
      websocketUrl: 'ws://127.0.0.1:18888/ws',
      cpu: 0,
      memory: 0,
      totalMemory: '0 GB',
      uptime: '1m',
      capabilities: [],
      storage: {
        provider: 'localFile',
        namespace: 'default',
      },
      config: {
        port: '18888',
        sandbox: false,
        autoUpdate: false,
        logLevel: 'info',
        corsOrigins: '*',
        baseUrl: 'http://127.0.0.1:18888',
        websocketUrl: 'ws://127.0.0.1:18888/ws',
      },
      createdAt: 1,
      updatedAt: 1,
      lastSeenAt: 1,
    },
    config: {
      port: '18888',
      sandbox: false,
      autoUpdate: false,
      logLevel: 'info',
      corsOrigins: '*',
      baseUrl: 'http://127.0.0.1:18888',
      websocketUrl: 'ws://127.0.0.1:18888/ws',
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
      provider: 'localFile',
      namespace: 'default',
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
      logAvailable: true,
      logPreview: [],
      metricsSource: 'runtime',
      lastSeenAt: 1,
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

function createSnapshot(root: OpenClawConfigSnapshot['root']): OpenClawConfigSnapshot {
  return {
    configFile: 'D:/OpenClaw/.openclaw/openclaw.json',
    providerSnapshots: [],
    agentSnapshots: [],
    channelSnapshots: [],
    webSearchConfig: {
      enabled: false,
      provider: '',
      maxResults: 0,
      timeoutSeconds: 0,
      cacheTtlMinutes: 0,
      providers: [],
    },
    xSearchConfig: {
      enabled: false,
      apiKeySource: '',
      model: '',
      inlineCitations: false,
      maxTurns: 0,
      timeoutSeconds: 0,
      cacheTtlMinutes: 0,
      advancedConfig: '',
    },
    webSearchNativeCodexConfig: {
      enabled: false,
      mode: 'off',
      allowedDomains: [],
      contextSize: '',
      userLocation: {
        country: '',
        city: '',
        timezone: '',
      },
      advancedConfig: '',
    },
    webFetchConfig: {
      enabled: false,
      maxChars: 0,
      maxCharsCap: 0,
      maxResponseBytes: 0,
      timeoutSeconds: 0,
      cacheTtlMinutes: 0,
      maxRedirects: 0,
      readability: false,
      userAgent: '',
      fallbackProvider: {
        providerId: 'firecrawl',
        name: 'Firecrawl',
        description: '',
        apiKeySource: '',
        baseUrl: '',
        advancedConfig: '',
        supportsApiKey: true,
        supportsBaseUrl: true,
      },
    },
    authCooldownsConfig: {
      rateLimitedProfileRotations: null,
      overloadedProfileRotations: null,
      overloadedBackoffMs: null,
      billingBackoffHours: null,
      billingMaxHours: null,
      failureWindowHours: null,
    },
    dreamingConfig: {
      enabled: false,
      frequency: '',
    },
    root,
  };
}

await runTest(
  'openclaw gateway history config service reads gateway.webchat.chatHistoryMaxChars from the OpenClaw config document',
  async () => {
    const service = createOpenClawGatewayHistoryConfigService({
      getInstanceDetail: async () => createDetail(),
      resolveAttachedKernelConfigFile: () => 'D:/OpenClaw/.openclaw/openclaw.json',
      readOpenClawConfigSnapshot: async () =>
        createSnapshot({
          gateway: {
            webchat: {
              chatHistoryMaxChars: 4096,
            },
          },
        }),
    });

    assert.equal(await service.getHistoryMaxChars('instance-a'), 4096);
  },
);

await runTest(
  'openclaw gateway history config service falls back to gateway.webchat.chatHistory.maxChars and caches repeated lookups',
  async () => {
    let readCount = 0;
    const service = createOpenClawGatewayHistoryConfigService({
      getInstanceDetail: async () => createDetail(),
      resolveAttachedKernelConfigFile: () => 'D:/OpenClaw/.openclaw/openclaw.json',
      readOpenClawConfigSnapshot: async () => {
        readCount += 1;
        return createSnapshot({
          gateway: {
            webchat: {
              chatHistory: {
                maxChars: 2048,
              },
            },
          },
        });
      },
      now: () => 1_000,
    });

    assert.equal(await service.getHistoryMaxChars('instance-a'), 2048);
    assert.equal(await service.getHistoryMaxChars('instance-a'), 2048);
    assert.equal(readCount, 1);
  },
);

await runTest(
  'openclaw gateway history config service returns undefined when the instance has no OpenClaw config file path',
  async () => {
    const service = createOpenClawGatewayHistoryConfigService({
      getInstanceDetail: async () => createDetail(),
      resolveAttachedKernelConfigFile: () => null,
      readOpenClawConfigSnapshot: async () => {
        throw new Error('should not read config without a path');
      },
    });

    assert.equal(await service.getHistoryMaxChars('instance-a'), undefined);
  },
);
