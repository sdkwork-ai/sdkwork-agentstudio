// WORKSPACE-PATH:allow-fixture: fixtures name a foreign checkout root, drive, or home directory to exercise path handling, so the literal is the value under assertion rather than a binding this build resolves
import assert from 'node:assert/strict';
import type { StudioInstanceDetailRecord, StudioInstanceRecord } from '@sdkwork/agentstudio-pc-types';
import {
  PROVIDER_CONFIG_CENTER_STORAGE_NAMESPACE,
  createProviderConfigCenterService,
  type ProviderConfigDraft,
  type ProviderConfigCenterServiceOverrides,
  type ProviderConfigRecord,
} from './providerConfigCenterService.ts';

const BUILT_IN_INSTANCE_ID = 'managed-openclaw-primary';

type ProviderRoutingApiOverrides = NonNullable<
  ProviderConfigCenterServiceOverrides['providerRoutingApi']
>;
type SaveProviderRoutingRecordInput = Parameters<
  NonNullable<ProviderRoutingApiOverrides['saveProviderRoutingRecord']>
>[0];
type ProviderRuntimeConfig = ProviderConfigRecord['config'];

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

const SDKWORK_LOCAL_PROXY_TOKEN_PLACEHOLDER = '${SDKWORK_LOCAL_PROXY_TOKEN}';

function createRuntimeConfig(
  overrides: Partial<ProviderRuntimeConfig> = {},
): ProviderRuntimeConfig {
  return {
    temperature: 0.2,
    topP: 1,
    maxTokens: 12000,
    timeoutMs: 120000,
    streaming: true,
    ...overrides,
  };
}

function createDraft(overrides: Partial<ProviderConfigDraft> = {}): ProviderConfigDraft {
  return {
    name: 'OpenAI Production',
    providerId: 'openai',
    clientProtocol: 'openai-compatible',
    upstreamProtocol: 'openai-compatible',
    upstreamBaseUrl: 'https://api.openai.com/v1',
    apiKey: 'sk-live-secret',
    enabled: true,
    isDefault: false,
    managedBy: 'user',
    defaultModelId: 'gpt-5.4',
    reasoningModelId: 'o4-mini',
    embeddingModelId: 'text-embedding-3-large',
    models: [
      { id: 'gpt-5.4', name: 'GPT-5.4' },
      { id: 'o4-mini', name: 'o4-mini' },
      { id: 'text-embedding-3-large', name: 'text-embedding-3-large' },
    ],
    exposeTo: ['openclaw'],
    config: createRuntimeConfig(overrides.config),
    ...overrides,
  };
}

function createRecord(
  overrides: (Partial<ProviderConfigRecord> & Partial<ProviderConfigDraft>) = {},
): ProviderConfigRecord {
  const draft = createDraft(overrides);
  const upstreamBaseUrl =
    overrides.upstreamBaseUrl || draft.upstreamBaseUrl || draft.baseUrl || 'https://ai.sdkwork.com';

  return {
    id: overrides.id || 'provider-config-openai-prod',
    schemaVersion: overrides.schemaVersion ?? 1,
    name: overrides.name || draft.name,
    enabled: overrides.enabled ?? draft.enabled ?? true,
    isDefault: overrides.isDefault ?? draft.isDefault ?? false,
    managedBy: overrides.managedBy || draft.managedBy || 'user',
    clientProtocol: overrides.clientProtocol || draft.clientProtocol || 'openai-compatible',
    upstreamProtocol: overrides.upstreamProtocol || draft.upstreamProtocol || 'openai-compatible',
    providerId: overrides.providerId || draft.providerId,
    upstreamBaseUrl,
    apiKey: overrides.apiKey || draft.apiKey,
    defaultModelId: overrides.defaultModelId || draft.defaultModelId,
    reasoningModelId: overrides.reasoningModelId ?? draft.reasoningModelId,
    embeddingModelId: overrides.embeddingModelId ?? draft.embeddingModelId,
    models: overrides.models || draft.models,
    notes: overrides.notes ?? draft.notes,
    exposeTo: overrides.exposeTo || draft.exposeTo || ['openclaw'],
    presetId: overrides.presetId ?? draft.presetId,
    createdAt: overrides.createdAt ?? 1,
    updatedAt: overrides.updatedAt ?? 1,
    baseUrl: overrides.baseUrl || upstreamBaseUrl,
    config: createRuntimeConfig(overrides.config),
  };
}

function createOpenClawInstance(
  overrides: Partial<StudioInstanceRecord> = {},
): StudioInstanceRecord {
  return {
    id: BUILT_IN_INSTANCE_ID,
    name: 'Local Built-In',
    description: 'Packaged local OpenClaw kernel.',
    runtimeKind: 'openclaw',
    deploymentMode: 'local-managed',
    transportKind: 'openclawGatewayWs',
    status: 'online',
    isBuiltIn: true,
    isDefault: true,
    iconType: 'server',
    version: '2026.3.26',
    typeLabel: 'OpenClaw Gateway',
    host: '127.0.0.1',
    port: 21280,
    baseUrl: 'http://127.0.0.1:21280',
    websocketUrl: 'ws://127.0.0.1:21280',
    cpu: 0,
    memory: 0,
    totalMemory: 'Unknown',
    uptime: '-',
    capabilities: ['chat', 'models'],
    storage: {
      provider: 'localFile',
      namespace: 'agent-studio',
    },
    config: {
      port: '21280',
      sandbox: true,
      autoUpdate: true,
      logLevel: 'info',
      corsOrigins: '*',
      baseUrl: 'http://127.0.0.1:21280',
      websocketUrl: 'ws://127.0.0.1:21280',
      authToken: 'token',
    },
    createdAt: 1,
    updatedAt: 1,
    lastSeenAt: 1,
    ...overrides,
  };
}

function createOpenClawDetail(
  overrides: Partial<StudioInstanceDetailRecord> = {},
): StudioInstanceDetailRecord {
  const instance = createOpenClawInstance();
  return {
    instance,
    config: instance.config,
    logs: '',
    health: {
      score: 90,
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
      namespace: 'agent-studio',
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
      routes: [
        {
          id: 'config',
          label: 'Config',
          scope: 'config',
          mode: 'managedFile',
          status: 'ready',
          target: 'D:/OpenClaw/.openclaw/openclaw.json',
          readonly: false,
          authoritative: true,
          detail: 'Writable config file',
          source: 'config',
        },
      ],
    },
    artifacts: [
      {
        id: 'config-file',
        label: 'Config File',
        kind: 'configFile',
        status: 'configured',
        location: 'D:/OpenClaw/.openclaw/openclaw.json',
        readonly: false,
        detail: 'Writable config file',
        source: 'config',
      },
    ],
    capabilities: [],
    officialRuntimeNotes: [],
    ...overrides,
  };
}

function createKernelInfoWithLocalAiProxy(
  overrides: Record<string, unknown> = {},
) {
  return {
    localAiProxy: {
      lifecycle: 'running',
      baseUrl: 'http://localhost:21280/v1',
      rootBaseUrl: 'http://localhost:21280',
      openaiCompatibleBaseUrl: 'http://localhost:21280/v1',
      anthropicBaseUrl: 'http://localhost:21280/v1',
      geminiBaseUrl: 'http://localhost:21280',
      activePort: 21280,
      loopbackOnly: true,
      defaultRouteId: 'local-ai-proxy-system-default-openai-compatible',
      defaultRouteName: 'SDKWork Default',
      upstreamBaseUrl: 'https://ai.sdkwork.com',
      modelCount: 2,
      configFile: 'D:/state/local-ai-proxy.json',
      snapshotPath: 'D:/state/local-ai-proxy.snapshot.json',
      logPath: 'D:/logs/local-ai-proxy.log',
      lastError: null,
      ...overrides,
    },
  } as any;
}

await runTest('providerConfigCenterService delegates route catalog CRUD to the shared provider routing control plane', async () => {
  const routedRecord = createRecord({
    id: 'provider-config-openai-prod',
    updatedAt: 2,
      isDefault: true,
  });
  const listCalls: string[] = [];
  const saveCalls: SaveProviderRoutingRecordInput[] = [];
  const deleteCalls: string[] = [];
  const service = createProviderConfigCenterService({
    storageApi: {
      getStorageInfo: async () => {
        throw new Error('storageApi should not be used when providerRoutingApi is supplied');
      },
      getText: async () => {
        throw new Error('storageApi should not be used when providerRoutingApi is supplied');
      },
      putText: async () => {
        throw new Error('storageApi should not be used when providerRoutingApi is supplied');
      },
      delete: async () => {
        throw new Error('storageApi should not be used when providerRoutingApi is supplied');
      },
      listKeys: async () => {
        throw new Error('storageApi should not be used when providerRoutingApi is supplied');
      },
    } as any,
    providerRoutingApi: {
      listProviderRoutingRecords: async () => {
        listCalls.push('list');
        return [routedRecord];
      },
      saveProviderRoutingRecord: async (input) => {
        saveCalls.push(input);
        return routedRecord;
      },
      deleteProviderRoutingRecord: async (id) => {
        deleteCalls.push(id);
        return true;
      },
    },
  });

  const listed = await service.listProviderConfigs();
  const saved = await service.saveProviderConfig(createDraft({ isDefault: true }));
  const deleted = await service.deleteProviderConfig('provider-config-openai-prod');

  assert.deepEqual(listCalls, ['list']);
  assert.equal(listed.length, 1);
  assert.equal(listed[0]?.id, 'provider-config-openai-prod');
  assert.equal(saveCalls.length, 1);
  assert.equal(saveCalls[0]?.name, 'OpenAI Production');
  assert.equal(saved.id, 'provider-config-openai-prod');
  assert.deepEqual(deleteCalls, ['provider-config-openai-prod']);
  assert.equal(deleted, true);
});

await runTest(
  'providerConfigCenterService forwards dirty drafts through the shared provider routing normalizer before saving',
  async () => {
    const routedRecord = createRecord({
      id: 'provider-config-openai-prod',
      updatedAt: 2,
      providerId: 'openai',
      defaultModelId: 'gpt-5.4',
      reasoningModelId: 'o4-mini',
      embeddingModelId: 'atlas-index',
      models: [
        { id: 'gpt-5.4', name: 'GPT-5.4' },
        { id: 'o4-mini', name: 'o4-mini' },
        { id: 'atlas-index', name: 'Atlas Index' },
      ],
      exposeTo: ['openclaw', 'desktop-clients'],
    });
    const saveCalls: SaveProviderRoutingRecordInput[] = [];
    const service = createProviderConfigCenterService({
      providerRoutingApi: {
        listProviderRoutingRecords: async () => [routedRecord],
        saveProviderRoutingRecord: async (input) => {
          saveCalls.push(input);
          return routedRecord;
        },
        deleteProviderRoutingRecord: async () => true,
      },
      kernelPlatformService: {
        ensureRunning: async () => undefined,
      } as any,
    });

    await service.saveProviderConfig({
      presetId: ' openai ',
      name: ' OpenAI Alias ',
      providerId: '',
      channelId: ' api-router-openai ',
      apiKey: ' sk-openai ',
      baseUrl: ' https://api.openai.com/v1/ ',
      defaultModelId: ' gpt-5.4 ',
      reasoningModelId: ' o4-mini ',
      embeddingModelId: ' atlas-index ',
      models: [
        { id: ' gpt-5.4 ', name: ' GPT-5.4 ' },
        { id: ' o4-mini ', name: ' o4-mini ' },
        { id: ' atlas-index ', name: ' Atlas Index ' },
        { id: 'gpt-5.4', name: 'Duplicate GPT-5.4' },
      ],
      exposeTo: [' openclaw ', ' desktop-clients ', 'openclaw'],
      notes: ' shared route ',
      config: {
        temperature: 0.35,
        streaming: false,
      },
    } as any);

    assert.equal(saveCalls.length, 1);
    assert.equal(saveCalls[0]?.presetId, 'openai');
    assert.equal(saveCalls[0]?.name, 'OpenAI Alias');
    assert.equal(saveCalls[0]?.providerId, 'openai');
    assert.equal(saveCalls[0]?.upstreamBaseUrl, 'https://api.openai.com/v1');
    assert.equal(saveCalls[0]?.baseUrl, 'https://api.openai.com/v1');
    assert.equal(saveCalls[0]?.apiKey, 'sk-openai');
    assert.equal(saveCalls[0]?.defaultModelId, 'gpt-5.4');
    assert.equal(saveCalls[0]?.reasoningModelId, 'o4-mini');
    assert.equal(saveCalls[0]?.embeddingModelId, 'atlas-index');
    assert.deepEqual(saveCalls[0]?.models, [
      { id: 'gpt-5.4', name: 'Duplicate GPT-5.4' },
      { id: 'o4-mini', name: 'o4-mini' },
      { id: 'atlas-index', name: 'Atlas Index' },
    ]);
    assert.deepEqual(saveCalls[0]?.exposeTo, ['openclaw', 'desktop-clients']);
    assert.equal(saveCalls[0]?.notes, 'shared route');
    assert.deepEqual(saveCalls[0]?.config, {
      temperature: 0.35,
      topP: 1,
      maxTokens: 8192,
      timeoutMs: 60000,
      streaming: false,
    });
  },
);

await runTest(
  'providerConfigCenterService still lists provider configs when kernel info is temporarily unavailable',
  async () => {
    const record = createRecord({
      id: 'provider-config-openai-prod',
      updatedAt: 2,
      isDefault: true,
    });
    const service = createProviderConfigCenterService({
      providerRoutingApi: {
        listProviderRoutingRecords: async () => [record],
      },
      kernelPlatformService: {
        getInfo: async () => {
          throw new Error('kernel info unavailable');
        },
      } as any,
    });

    const listed = await service.listProviderConfigs();

    assert.equal(listed.length, 1);
    assert.equal(listed[0]?.id, 'provider-config-openai-prod');
    assert.equal(listed[0]?.runtimeMetrics, undefined);
    assert.equal(listed[0]?.latestTest, null);
  },
);

await runTest(
  'providerConfigCenterService keeps saved provider configs when local AI proxy sync fails after persistence',
  async () => {
    const record = createRecord({
      id: 'provider-config-openai-prod',
      updatedAt: 2,
      isDefault: true,
    });
    const calls: string[] = [];
    const service = createProviderConfigCenterService({
      providerRoutingApi: {
        saveProviderRoutingRecord: async (input) => {
          calls.push(`save:${input.name}`);
          return record;
        },
      },
      kernelPlatformService: {
        ensureRunning: async () => {
          calls.push('ensureRunning');
          throw new Error('kernel sync unavailable');
        },
      } as any,
    });

    const saved = await service.saveProviderConfig(createDraft({ isDefault: true }));

    assert.equal(saved.id, 'provider-config-openai-prod');
    assert.deepEqual(calls, ['save:OpenAI Production', 'ensureRunning']);
  },
);

await runTest(
  'providerConfigCenterService keeps deletions applied when local AI proxy sync fails after delete',
  async () => {
    const calls: string[] = [];
    const service = createProviderConfigCenterService({
      providerRoutingApi: {
        deleteProviderRoutingRecord: async (id) => {
          calls.push(`delete:${id}`);
          return true;
        },
      },
      kernelPlatformService: {
        ensureRunning: async () => {
          calls.push('ensureRunning');
          throw new Error('kernel sync unavailable');
        },
      } as any,
    });

    const deleted = await service.deleteProviderConfig('provider-config-openai-prod');

    assert.equal(deleted, true);
    assert.deepEqual(calls, ['delete:provider-config-openai-prod', 'ensureRunning']);
  },
);

await runTest('providerConfigCenterService persists proxy route records in the sqlite storage namespace and reads them back', async () => {
  const store = new Map<string, string>();
  const putCalls: Array<{ profileId?: string | null; namespace?: string | null; key: string }> = [];
  const service = createProviderConfigCenterService({
    now: () => 1_742_950_000_000,
    storageApi: {
      getStorageInfo: async () => ({
        activeProfileId: 'default-local',
        rootDir: 'D:/storage',
        providers: [],
        profiles: [
          {
            id: 'default-local',
            label: 'Managed Local File',
            provider: 'localFile',
            active: true,
            availability: 'ready',
            namespace: 'agent-studio',
            readOnly: false,
            connectionConfigured: false,
            databaseConfigured: false,
            endpointConfigured: false,
          },
          {
            id: 'default-sqlite',
            label: 'SQLite',
            provider: 'sqlite',
            active: false,
            availability: 'ready',
            namespace: 'agent-studio',
            readOnly: false,
            path: 'D:/storage/profiles/default.db',
            connectionConfigured: false,
            databaseConfigured: false,
            endpointConfigured: false,
          },
        ],
      }),
      getText: async ({ namespace, key }) => ({
        profileId: 'default-sqlite',
        namespace: namespace || PROVIDER_CONFIG_CENTER_STORAGE_NAMESPACE,
        key,
        value: store.get(`${namespace}:${key}`) ?? null,
      }),
      putText: async ({ profileId, namespace, key, value }) => {
        putCalls.push({ profileId, namespace, key });
        store.set(`${namespace}:${key}`, value);
        return {
          profileId: profileId || 'default-sqlite',
          namespace: namespace || PROVIDER_CONFIG_CENTER_STORAGE_NAMESPACE,
          key,
        };
      },
      delete: async ({ namespace, key }) => {
        const lookupKey = `${namespace}:${key}`;
        const existed = store.delete(lookupKey);
        return {
          profileId: 'default-sqlite',
          namespace: namespace || PROVIDER_CONFIG_CENTER_STORAGE_NAMESPACE,
          key,
          existed,
        };
      },
      listKeys: async ({ namespace } = {}) => ({
        profileId: 'default-sqlite',
        namespace: namespace || PROVIDER_CONFIG_CENTER_STORAGE_NAMESPACE,
        keys: Array.from(store.keys())
          .map((entry) => entry.split(':').slice(1).join(':'))
          .sort((left, right) => left.localeCompare(right)),
      }),
    },
  });

  const saved = await service.saveProviderConfig(
    createDraft({
      config: {
        temperature: 0.2,
        topP: 1,
        maxTokens: 12000,
        timeoutMs: 120000,
        streaming: true,
        request: {
          headers: {
            'cf-aig-authorization': 'Bearer cf-gateway-secret',
            'x-openai-client': 'agent-studio',
          },
        },
      },
    }),
  );
  const listed = await service.listProviderConfigs();

  assert.equal(saved.providerId, 'openai');
  assert.equal(saved.schemaVersion, 1);
  assert.equal(saved.clientProtocol, 'openai-compatible');
  assert.equal(saved.upstreamProtocol, 'openai-compatible');
  assert.equal(saved.enabled, true);
  assert.equal(saved.isDefault, true);
  assert.equal(saved.managedBy, 'user');
  assert.equal(saved.id.startsWith('provider-config-openai-'), true);
  assert.equal(saved.upstreamBaseUrl, 'https://api.openai.com/v1');
  assert.deepEqual(saved.config.request, {
    headers: {
      'cf-aig-authorization': 'Bearer cf-gateway-secret',
      'x-openai-client': 'agent-studio',
    },
  });
  assert.deepEqual(putCalls, [
    {
      profileId: 'default-sqlite',
      namespace: PROVIDER_CONFIG_CENTER_STORAGE_NAMESPACE,
      key: saved.id,
    },
  ]);
  assert.equal(listed.length, 3);
  assert.equal(listed.some((record) => record.id === saved.id), true);
  assert.equal(
    listed.some(
      (record) => record.clientProtocol === 'anthropic' && record.managedBy === 'system-default',
    ),
    true,
  );
  assert.equal(
    listed.some(
      (record) => record.clientProtocol === 'gemini' && record.managedBy === 'system-default',
    ),
    true,
  );
  assert.equal(
    listed.find((record) => record.id === saved.id)?.embeddingModelId,
    'text-embedding-3-large',
  );
  assert.deepEqual(
    listed.find((record) => record.id === saved.id)?.config.request,
    saved.config.request,
  );
});

await runTest('providerConfigCenterService resolves blank upstream base URLs to the SDKWork fallback before persisting', async () => {
  const store = new Map<string, string>();
  const service = createProviderConfigCenterService({
    now: () => 1_742_950_000_100,
    storageApi: {
      getStorageInfo: async () => null,
      getText: async ({ namespace, key }) => ({
        profileId: 'default-sqlite',
        namespace: namespace || PROVIDER_CONFIG_CENTER_STORAGE_NAMESPACE,
        key,
        value: store.get(`${namespace}:${key}`) ?? null,
      }),
      putText: async ({ namespace, key, value }) => {
        store.set(`${namespace}:${key}`, value);
        return {
          profileId: 'default-sqlite',
          namespace: namespace || PROVIDER_CONFIG_CENTER_STORAGE_NAMESPACE,
          key,
        };
      },
      delete: async ({ namespace, key }) => ({
        profileId: 'default-sqlite',
        namespace: namespace || PROVIDER_CONFIG_CENTER_STORAGE_NAMESPACE,
        key,
        existed: false,
      }),
      listKeys: async ({ namespace } = {}) => ({
        profileId: 'default-sqlite',
        namespace: namespace || PROVIDER_CONFIG_CENTER_STORAGE_NAMESPACE,
        keys: Array.from(store.keys()).map((entry) => entry.split(':').slice(1).join(':')),
      }),
    },
  });

  const saved = await service.saveProviderConfig(
    createDraft({
      upstreamBaseUrl: '   ',
      config: {
        temperature: Number.NaN,
        topP: Number.POSITIVE_INFINITY,
        maxTokens: Number.NaN,
        timeoutMs: Number.NaN,
        streaming: false,
      },
    }),
  );

  assert.equal(saved.upstreamBaseUrl, 'https://ai.sdkwork.com');
  assert.deepEqual(saved.config, {
    temperature: 0.2,
    topP: 1,
    maxTokens: 8192,
    timeoutMs: 60000,
    streaming: false,
  });
});

await runTest(
  'providerConfigCenterService normalizes broader provider families onto OpenAI-compatible local proxy routes with the SDKWork fallback',
  async () => {
    const store = new Map<string, string>();
    const service = createProviderConfigCenterService({
      now: () => 1_742_950_000_150,
      storageApi: {
        getStorageInfo: async () => null,
        getText: async ({ namespace, key }) => ({
          profileId: 'default-sqlite',
          namespace: namespace || PROVIDER_CONFIG_CENTER_STORAGE_NAMESPACE,
          key,
          value: store.get(`${namespace}:${key}`) ?? null,
        }),
        putText: async ({ namespace, key, value }) => {
          store.set(`${namespace}:${key}`, value);
          return {
            profileId: 'default-sqlite',
            namespace: namespace || PROVIDER_CONFIG_CENTER_STORAGE_NAMESPACE,
            key,
          };
        },
        delete: async ({ namespace, key }) => ({
          profileId: 'default-sqlite',
          namespace: namespace || PROVIDER_CONFIG_CENTER_STORAGE_NAMESPACE,
          key,
          existed: false,
        }),
        listKeys: async ({ namespace } = {}) => ({
          profileId: 'default-sqlite',
          namespace: namespace || PROVIDER_CONFIG_CENTER_STORAGE_NAMESPACE,
          keys: Array.from(store.keys()).map((entry) => entry.split(':').slice(1).join(':')),
        }),
      },
    });

    const saved = await service.saveProviderConfig(
      createDraft({
        name: 'Meta Llama Route',
        providerId: 'meta',
        clientProtocol: undefined,
        upstreamProtocol: undefined,
        upstreamBaseUrl: '   ',
        defaultModelId: 'llama-4-maverick',
        reasoningModelId: undefined,
        embeddingModelId: undefined,
        models: [{ id: 'llama-4-maverick', name: 'Llama 4 Maverick' }],
      }),
    );

    assert.equal(saved.providerId, 'meta');
    assert.equal(saved.clientProtocol, 'openai-compatible');
    assert.equal(saved.upstreamProtocol, 'openai-compatible');
    assert.equal(saved.upstreamBaseUrl, 'https://ai.sdkwork.com');
    assert.equal(saved.defaultModelId, 'llama-4-maverick');
  },
);

await runTest(
  'providerConfigCenterService exposes SDKWork universal preset ahead of native Anthropic and Gemini presets',
  async () => {
  const service = createProviderConfigCenterService();
  const presets = service.listPresets();
  const sdkworkPreset = presets[0];
  const anthropicPreset = presets.find((preset) => preset.id === 'anthropic');
  const geminiPreset = presets.find((preset) => preset.id === 'gemini');
  const azurePreset = presets.find((preset) => preset.id === 'azure-openai');
  const openRouterPreset = presets.find((preset) => preset.id === 'openrouter');
  const zhipuPreset = presets.find((preset) => preset.id === 'zhipu');
  const metaPreset = presets.find((preset) => preset.id === 'meta');
  const baichuanPreset = presets.find((preset) => preset.id === 'baichuan');

  assert.ok(sdkworkPreset);
  assert.equal(sdkworkPreset.id, 'sdkwork');
  assert.equal(sdkworkPreset.draft.providerId, 'sdkwork');
  assert.equal(sdkworkPreset.draft.clientProtocol, 'openai-compatible');
  assert.equal(sdkworkPreset.draft.upstreamProtocol, 'sdkwork');
  assert.equal(sdkworkPreset.draft.upstreamBaseUrl, 'https://ai.sdkwork.com');
  assert.equal(sdkworkPreset.draft.defaultModelId, 'gpt-5.4');
  assert.equal(sdkworkPreset.draft.reasoningModelId, 'o4-mini');
  assert.equal(sdkworkPreset.draft.embeddingModelId, 'text-embedding-3-large');
  assert.ok(sdkworkPreset.draft.models.some((model) => model.id === 'gpt-5.4'));
  assert.ok(sdkworkPreset.draft.models.some((model) => model.id === 'claude-sonnet-4-20250514'));
  assert.ok(sdkworkPreset.draft.models.some((model) => model.id === 'gemini-2.5-pro'));
  assert.ok(sdkworkPreset.draft.models.some((model) => model.id === 'deepseek-chat'));
  assert.ok(sdkworkPreset.draft.models.some((model) => model.id === 'qwen-max'));
  assert.ok(sdkworkPreset.draft.models.some((model) => model.id === 'minimax-m1'));
  assert.ok(sdkworkPreset.draft.models.some((model) => model.id === 'kimi-k2'));
  assert.ok(sdkworkPreset.draft.models.some((model) => model.id === 'glm-5.1'));
  assert.ok(sdkworkPreset.draft.models.some((model) => model.id === 'glm-5v-turbo'));

  assert.ok(anthropicPreset);
  assert.equal(anthropicPreset.draft.clientProtocol, 'anthropic');
  assert.equal(anthropicPreset.draft.upstreamProtocol, 'anthropic');
  assert.equal(anthropicPreset.draft.upstreamBaseUrl, 'https://api.anthropic.com/v1');
  assert.equal(anthropicPreset.draft.defaultModelId, 'claude-sonnet-4-20250514');

  assert.ok(geminiPreset);
  assert.equal(geminiPreset.draft.clientProtocol, 'gemini');
  assert.equal(geminiPreset.draft.upstreamProtocol, 'gemini');
  assert.equal(geminiPreset.draft.upstreamBaseUrl, 'https://generativelanguage.googleapis.com');
  assert.equal(geminiPreset.draft.defaultModelId, 'gemini-2.5-pro');
  assert.equal(geminiPreset.draft.embeddingModelId, 'text-embedding-004');

  assert.ok(azurePreset);
  assert.equal(azurePreset.draft.clientProtocol, 'openai-compatible');
  assert.equal(azurePreset.draft.upstreamProtocol, 'azure-openai');
  assert.equal(azurePreset.draft.upstreamBaseUrl, 'https://YOUR-RESOURCE-NAME.openai.azure.com');
  assert.equal(azurePreset.draft.defaultModelId, 'gpt-4.1');
  assert.equal(azurePreset.draft.embeddingModelId, 'text-embedding-3-large');

  assert.ok(openRouterPreset);
  assert.equal(openRouterPreset.draft.clientProtocol, 'openai-compatible');
  assert.equal(openRouterPreset.draft.upstreamProtocol, 'openrouter');
  assert.equal(openRouterPreset.draft.upstreamBaseUrl, 'https://openrouter.ai/api/v1');
  assert.equal(openRouterPreset.draft.defaultModelId, 'openai/gpt-4o');

  assert.ok(zhipuPreset);
  assert.equal(zhipuPreset.label, 'Z.AI');
  assert.equal(zhipuPreset.draft.providerId, 'zhipu');
  assert.equal(zhipuPreset.draft.clientProtocol, 'openai-compatible');
  assert.equal(zhipuPreset.draft.upstreamProtocol, 'openai-compatible');
  assert.equal(zhipuPreset.draft.upstreamBaseUrl, 'https://open.bigmodel.cn/api/paas/v4');
  assert.equal(zhipuPreset.draft.defaultModelId, 'glm-5.1');
  assert.equal(zhipuPreset.draft.reasoningModelId, 'glm-5.1');
  assert.deepEqual(zhipuPreset.draft.models, [
    { id: 'glm-5.1', name: 'GLM-5.1' },
    { id: 'glm-5v-turbo', name: 'GLM-5V Turbo' },
  ]);

  assert.ok(metaPreset);
  assert.equal(metaPreset.draft.providerId, 'meta');
  assert.equal(metaPreset.draft.clientProtocol, 'openai-compatible');
  assert.equal(metaPreset.draft.upstreamProtocol, 'openai-compatible');
  assert.equal(metaPreset.draft.upstreamBaseUrl, 'https://ai.sdkwork.com');
  assert.equal(metaPreset.draft.defaultModelId, '');
  assert.deepEqual(metaPreset.draft.models, []);

  assert.ok(baichuanPreset);
  assert.equal(baichuanPreset.draft.providerId, 'baichuan');
  assert.equal(baichuanPreset.draft.clientProtocol, 'openai-compatible');
  assert.equal(baichuanPreset.draft.upstreamProtocol, 'openai-compatible');
  assert.equal(baichuanPreset.draft.upstreamBaseUrl, 'https://ai.sdkwork.com');
  assert.equal(baichuanPreset.draft.defaultModelId, '');
  assert.deepEqual(baichuanPreset.draft.models, []);
});

await runTest(
  'providerConfigCenterService exposes curated Fireworks and Amazon Bedrock Mantle presets aligned with upstream endpoints',
  async () => {
    const service = createProviderConfigCenterService();
    const presets = service.listPresets();
    const fireworksPreset = presets.find((preset) => preset.id === 'fireworks');
    const mantlePreset = presets.find((preset) => preset.id === 'amazon-bedrock-mantle');

    assert.ok(fireworksPreset);
    assert.equal(fireworksPreset?.draft.providerId, 'fireworks');
    assert.equal(fireworksPreset?.draft.clientProtocol, 'openai-compatible');
    assert.equal(fireworksPreset?.draft.upstreamProtocol, 'openai-compatible');
    assert.equal(fireworksPreset?.draft.upstreamBaseUrl, 'https://api.fireworks.ai/inference/v1');
    assert.equal(
      fireworksPreset?.draft.defaultModelId,
      'fireworks/accounts/fireworks/routers/kimi-k2p5-turbo',
    );
    assert.ok(
      fireworksPreset?.draft.models.some(
        (model) => model.id === 'fireworks/accounts/fireworks/routers/kimi-k2p5-turbo',
      ),
    );

    assert.ok(mantlePreset);
    assert.equal(mantlePreset?.draft.providerId, 'amazon-bedrock-mantle');
    assert.equal(mantlePreset?.draft.clientProtocol, 'openai-compatible');
    assert.equal(mantlePreset?.draft.upstreamProtocol, 'openai-compatible');
    assert.equal(
      mantlePreset?.draft.upstreamBaseUrl,
      'https://bedrock-mantle.us-east-1.api.aws/v1',
    );
    assert.equal(mantlePreset?.draft.defaultModelId, 'gpt-oss-120b');
    assert.deepEqual(mantlePreset?.draft.models, [
      {
        id: 'gpt-oss-120b',
        name: 'GPT-OSS 120B',
      },
    ]);
  },
);

await runTest(
  'providerConfigCenterService exposes additional official proxy and gateway presets aligned with the latest OpenClaw provider docs',
  async () => {
    const service = createProviderConfigCenterService();
    const presets = service.listPresets();
    const cloudflarePreset = presets.find((preset) => preset.id === 'cloudflare-ai-gateway');
    const sdkworkPreset = presets.find((preset) => preset.id === 'sdkwork');
    const groqPreset = presets.find((preset) => preset.id === 'groq');
    const ollamaPreset = presets.find((preset) => preset.id === 'ollama');
    const sglangPreset = presets.find((preset) => preset.id === 'sglang');
    const vercelPreset = presets.find((preset) => preset.id === 'vercel-ai-gateway');
    const togetherPreset = presets.find((preset) => preset.id === 'together');
    const litellmPreset = presets.find((preset) => preset.id === 'litellm');
    const kiloPreset = presets.find((preset) => preset.id === 'kilocode');
    const vllmPreset = presets.find((preset) => preset.id === 'vllm');
    const venicePreset = presets.find((preset) => preset.id === 'venice');

    assert.ok(sdkworkPreset);
    assert.equal(sdkworkPreset?.draft.providerId, 'sdkwork');
    assert.equal(sdkworkPreset?.draft.apiKey, 'sk_sdkwork_api_key');

    assert.ok(cloudflarePreset);
    assert.equal(cloudflarePreset?.draft.providerId, 'cloudflare-ai-gateway');
    assert.equal(cloudflarePreset?.draft.clientProtocol, 'anthropic');
    assert.equal(cloudflarePreset?.draft.upstreamProtocol, 'anthropic');
    assert.equal(
      cloudflarePreset?.draft.upstreamBaseUrl,
      'https://gateway.ai.cloudflare.com/v1/<account_id>/<gateway_id>/anthropic',
    );
    assert.equal(
      cloudflarePreset?.draft.defaultModelId,
      'cloudflare-ai-gateway/claude-sonnet-4-5',
    );
    assert.ok(
      cloudflarePreset?.draft.models.some(
        (model) => model.id === 'cloudflare-ai-gateway/claude-sonnet-4-5',
      ),
    );

    assert.ok(groqPreset);
    assert.equal(groqPreset?.draft.providerId, 'groq');
    assert.equal(groqPreset?.draft.upstreamBaseUrl, 'https://api.groq.com/openai/v1');
    assert.equal(groqPreset?.draft.defaultModelId, 'llama-3.3-70b-versatile');
    assert.ok(
      groqPreset?.draft.models.some((model) => model.id === 'llama-3.3-70b-versatile'),
    );

    assert.ok(ollamaPreset);
    assert.equal(ollamaPreset?.draft.providerId, 'ollama');
    assert.equal(ollamaPreset?.draft.clientProtocol, 'openai-compatible');
    assert.equal(ollamaPreset?.draft.upstreamProtocol, 'ollama');
    assert.equal(ollamaPreset?.draft.upstreamBaseUrl, 'http://127.0.0.1:11434');
    assert.equal(ollamaPreset?.draft.apiKey, 'ollama-local');
    assert.equal(ollamaPreset?.draft.defaultModelId, 'glm-4.7-flash');
    assert.ok(
      ollamaPreset?.draft.models.some((model) => model.id === 'glm-4.7-flash'),
    );

    assert.ok(sglangPreset);
    assert.equal(sglangPreset?.draft.providerId, 'sglang');
    assert.equal(sglangPreset?.draft.upstreamBaseUrl, 'http://127.0.0.1:30000/v1');
    assert.equal(sglangPreset?.draft.apiKey, 'sglang-local');
    assert.equal(sglangPreset?.draft.defaultModelId, '');
    assert.deepEqual(sglangPreset?.draft.models, []);

    assert.ok(vercelPreset);
    assert.equal(vercelPreset?.draft.providerId, 'vercel-ai-gateway');
    assert.equal(vercelPreset?.draft.clientProtocol, 'anthropic');
    assert.equal(vercelPreset?.draft.upstreamProtocol, 'anthropic');
    assert.equal(vercelPreset?.draft.upstreamBaseUrl, 'https://ai-gateway.vercel.sh');
    assert.equal(vercelPreset?.draft.defaultModelId, 'anthropic/claude-opus-4.6');
    assert.ok(
      vercelPreset?.draft.models.some((model) => model.id === 'anthropic/claude-opus-4.6'),
    );

    assert.ok(togetherPreset);
    assert.equal(togetherPreset?.draft.providerId, 'together');
    assert.equal(togetherPreset?.draft.upstreamBaseUrl, 'https://api.together.xyz/v1');
    assert.equal(togetherPreset?.draft.defaultModelId, 'moonshotai/Kimi-K2.5');
    assert.ok(
      togetherPreset?.draft.models.some((model) => model.id === 'moonshotai/Kimi-K2.5'),
    );

    assert.ok(litellmPreset);
    assert.equal(litellmPreset?.draft.providerId, 'litellm');
    assert.equal(litellmPreset?.draft.upstreamBaseUrl, 'http://localhost:4000');
    assert.equal(litellmPreset?.draft.defaultModelId, 'claude-opus-4-6');
    assert.ok(litellmPreset?.draft.models.some((model) => model.id === 'gpt-4o'));

    assert.ok(kiloPreset);
    assert.equal(kiloPreset?.draft.providerId, 'kilocode');
    assert.equal(kiloPreset?.draft.upstreamBaseUrl, 'https://api.kilo.ai/api/gateway');
    assert.equal(kiloPreset?.draft.defaultModelId, 'kilo/auto');
    assert.deepEqual(kiloPreset?.draft.models, [{ id: 'kilo/auto', name: 'Kilo Auto' }]);

    assert.ok(vllmPreset);
    assert.equal(vllmPreset?.draft.providerId, 'vllm');
    assert.equal(vllmPreset?.draft.upstreamBaseUrl, 'http://127.0.0.1:8000/v1');
    assert.equal(vllmPreset?.draft.apiKey, 'vllm-local');
    assert.equal(vllmPreset?.draft.defaultModelId, '');
    assert.deepEqual(vllmPreset?.draft.models, []);

    assert.ok(venicePreset);
    assert.equal(venicePreset?.draft.providerId, 'venice');
    assert.equal(venicePreset?.draft.upstreamBaseUrl, 'https://api.venice.ai/api/v1');
    assert.equal(venicePreset?.draft.defaultModelId, 'kimi-k2-5');
    assert.ok(venicePreset?.draft.models.some((model) => model.id === 'kimi-k2-5'));
  },
);

await runTest('providerConfigCenterService synthesizes a system default route when storage is empty', async () => {
  const service = createProviderConfigCenterService({
    storageApi: {
      getStorageInfo: async () => null,
      getText: async () => ({
        profileId: 'default-sqlite',
        namespace: PROVIDER_CONFIG_CENTER_STORAGE_NAMESPACE,
        key: 'unused',
        value: null,
      }),
      putText: async () => ({
        profileId: 'default-sqlite',
        namespace: PROVIDER_CONFIG_CENTER_STORAGE_NAMESPACE,
        key: 'unused',
      }),
      delete: async () => ({
        profileId: 'default-sqlite',
        namespace: PROVIDER_CONFIG_CENTER_STORAGE_NAMESPACE,
        key: 'unused',
        existed: false,
      }),
      listKeys: async () => ({
        profileId: 'default-sqlite',
        namespace: PROVIDER_CONFIG_CENTER_STORAGE_NAMESPACE,
        keys: [],
      }),
    },
  });

  const records = await service.listProviderConfigs();

  assert.equal(records.length, 3);
  assert.deepEqual(
    records.map((record) => record.clientProtocol).sort(),
    ['anthropic', 'gemini', 'openai-compatible'],
  );
  assert.equal(records.every((record) => record.managedBy === 'system-default'), true);
  assert.equal(records.every((record) => record.upstreamProtocol === 'sdkwork'), true);
  assert.equal(records.every((record) => record.upstreamBaseUrl === 'https://ai.sdkwork.com'), true);
  assert.equal(
    records.find((record) => record.clientProtocol === 'openai-compatible')?.isDefault,
    true,
  );
});

await runTest('providerConfigCenterService clears the previous default route on the same client protocol when a new default is saved', async () => {
  const store = new Map<string, string>();
  const service = createProviderConfigCenterService({
    now: (() => {
      let current = 1_742_950_000_200;
      return () => current++;
    })(),
    storageApi: {
      getStorageInfo: async () => null,
      getText: async ({ namespace, key }) => ({
        profileId: 'default-sqlite',
        namespace: namespace || PROVIDER_CONFIG_CENTER_STORAGE_NAMESPACE,
        key,
        value: store.get(`${namespace}:${key}`) ?? null,
      }),
      putText: async ({ namespace, key, value }) => {
        store.set(`${namespace}:${key}`, value);
        return {
          profileId: 'default-sqlite',
          namespace: namespace || PROVIDER_CONFIG_CENTER_STORAGE_NAMESPACE,
          key,
        };
      },
      delete: async ({ namespace, key }) => {
        const existed = store.delete(`${namespace}:${key}`);
        return {
          profileId: 'default-sqlite',
          namespace: namespace || PROVIDER_CONFIG_CENTER_STORAGE_NAMESPACE,
          key,
          existed,
        };
      },
      listKeys: async ({ namespace } = {}) => ({
        profileId: 'default-sqlite',
        namespace: namespace || PROVIDER_CONFIG_CENTER_STORAGE_NAMESPACE,
        keys: Array.from(store.keys()).map((entry) => entry.split(':').slice(1).join(':')),
      }),
    },
  });

  const firstRoute = await service.saveProviderConfig(
    createDraft({
      name: 'Primary OpenAI',
      isDefault: true,
    }),
  );
  const secondRoute = await service.saveProviderConfig(
    createDraft({
      name: 'Backup OpenAI',
      providerId: 'deepseek',
      upstreamBaseUrl: 'https://api.deepseek.com/v1',
      defaultModelId: 'deepseek-chat',
      reasoningModelId: 'deepseek-reasoner',
      embeddingModelId: undefined,
      models: [
        { id: 'deepseek-chat', name: 'DeepSeek Chat' },
        { id: 'deepseek-reasoner', name: 'DeepSeek Reasoner' },
      ],
      isDefault: true,
    }),
  );

  const records = await service.listProviderConfigs();
  const reloadedFirstRoute = records.find((record) => record.id === firstRoute.id);
  const reloadedSecondRoute = records.find((record) => record.id === secondRoute.id);

  assert.equal(reloadedFirstRoute?.clientProtocol, 'openai-compatible');
  assert.equal(reloadedFirstRoute?.isDefault, false);
  assert.equal(reloadedSecondRoute?.clientProtocol, 'openai-compatible');
  assert.equal(reloadedSecondRoute?.isDefault, true);
});

await runTest('providerConfigCenterService exposes writable config-backed instances and their agent targets', async () => {
  const service = createProviderConfigCenterService({
    storageApi: {
      getStorageInfo: async () => null,
      getText: async () => ({
        profileId: 'default-sqlite',
        namespace: PROVIDER_CONFIG_CENTER_STORAGE_NAMESPACE,
        key: 'unused',
        value: null,
      }),
      putText: async () => ({
        profileId: 'default-sqlite',
        namespace: PROVIDER_CONFIG_CENTER_STORAGE_NAMESPACE,
        key: 'unused',
      }),
      delete: async () => ({
        profileId: 'default-sqlite',
        namespace: PROVIDER_CONFIG_CENTER_STORAGE_NAMESPACE,
        key: 'unused',
        existed: false,
      }),
      listKeys: async () => ({
        profileId: 'default-sqlite',
        namespace: PROVIDER_CONFIG_CENTER_STORAGE_NAMESPACE,
        keys: [],
      }),
    },
    studioApi: {
      listInstances: async () => [
        createOpenClawInstance(),
        createOpenClawInstance({
          id: 'remote-custom',
          runtimeKind: 'custom',
          deploymentMode: 'remote',
          isDefault: false,
          isBuiltIn: false,
        }),
      ],
      getInstanceDetail: async (instanceId) =>
        instanceId === 'remote-custom'
          ? createOpenClawDetail({
              instance: createOpenClawInstance({
                id: 'remote-custom',
                name: 'Remote Custom',
                runtimeKind: 'custom',
                deploymentMode: 'remote',
                isDefault: false,
                isBuiltIn: false,
              }),
            })
          : createOpenClawDetail(),
    },
    kernelPlatformService: {
      getInfo: async () =>
        ({
          localAiProxy: {
            lifecycle: 'running',
            baseUrl: 'http://localhost:21280/v1',
            rootBaseUrl: 'http://localhost:21280',
            openaiCompatibleBaseUrl: 'http://localhost:21280/v1',
            anthropicBaseUrl: 'http://localhost:21280/v1',
            geminiBaseUrl: 'http://localhost:21280',
            activePort: 21280,
            loopbackOnly: true,
            defaultRouteId: 'local-ai-proxy-system-default-openai-compatible',
            defaultRouteName: 'SDKWork Default',
            upstreamBaseUrl: 'https://ai.sdkwork.com',
            modelCount: 2,
            configFile: 'D:/state/local-ai-proxy.json',
            snapshotPath: 'D:/state/local-ai-proxy.snapshot.json',
            logPath: 'D:/logs/local-ai-proxy.log',
            lastError: null,
          },
        }) as any,
    } as any,
    kernelConfigAttachmentApi: {
      resolveAttachedKernelConfigFile: () => 'D:/OpenClaw/.openclaw/openclaw.json',
    },
    openClawConfigDocumentApi: {
      readConfigSnapshot: async () =>
        ({
          agentSnapshots: [
            {
              id: 'main',
              name: 'Main',
              avatar: 'M',
              description: 'Default agent',
              workspace: 'D:/OpenClaw/workspace',
              agentDir: 'D:/OpenClaw/agents/main/agent',
              isDefault: true,
              model: {
                primary: 'openai/gpt-4.1',
                fallbacks: [],
              },
              params: {},
            },
            {
              id: 'research',
              name: 'Research',
              avatar: 'R',
              description: 'Research agent',
              workspace: 'D:/OpenClaw/workspace-research',
              agentDir: 'D:/OpenClaw/agents/research/agent',
              isDefault: false,
              model: {
                primary: 'openai/gpt-4.1',
                fallbacks: [],
              },
              params: {},
            },
          ],
        }) as any,
    },
  });

  const instances = await service.listApplyInstances();
  const target = await service.getInstanceApplyTarget(BUILT_IN_INSTANCE_ID);

  assert.deepEqual(
    instances.map((instance) => instance.id),
    [BUILT_IN_INSTANCE_ID, 'remote-custom'],
  );
  assert.equal(target.instance.id, BUILT_IN_INSTANCE_ID);
  assert.equal(target.instance.configFile, 'D:/OpenClaw/.openclaw/openclaw.json');
  assert.deepEqual(
    target.agents.map((agent) => agent.id),
    ['main', 'research'],
  );
  assert.equal(target.agents[0]?.isDefault, true);
});

await runTest(
  'providerConfigCenterService hides quick-apply instances when the local AI proxy runtime is unavailable',
  async () => {
    const service = createProviderConfigCenterService({
      storageApi: {
        getStorageInfo: async () => null,
        getText: async () => ({
          profileId: 'default-sqlite',
          namespace: PROVIDER_CONFIG_CENTER_STORAGE_NAMESPACE,
          key: 'unused',
          value: null,
        }),
        putText: async () => ({
          profileId: 'default-sqlite',
          namespace: PROVIDER_CONFIG_CENTER_STORAGE_NAMESPACE,
          key: 'unused',
        }),
        delete: async () => ({
          profileId: 'default-sqlite',
          namespace: PROVIDER_CONFIG_CENTER_STORAGE_NAMESPACE,
          key: 'unused',
          existed: false,
        }),
        listKeys: async () => ({
          profileId: 'default-sqlite',
          namespace: PROVIDER_CONFIG_CENTER_STORAGE_NAMESPACE,
          keys: [],
        }),
      },
      studioApi: {
        listInstances: async () => [createOpenClawInstance()],
        getInstanceDetail: async () => createOpenClawDetail(),
      },
      kernelPlatformService: {
        getInfo: async () => null,
      } as any,
      kernelConfigAttachmentApi: {
        resolveAttachedKernelConfigFile: () => 'D:/OpenClaw/.openclaw/openclaw.json',
      } as any,
    });

    const instances = await service.listApplyInstances();

    assert.deepEqual(instances, []);
  },
);

await runTest(
  'providerConfigCenterService degrades action support when kernel info is temporarily unavailable',
  async () => {
    const service = createProviderConfigCenterService({
      kernelPlatformService: {
        getInfo: async () => {
          throw new Error('kernel info unavailable');
        },
      } as any,
    });

    const support = await service.getActionSupport();

    assert.equal(support.quickApply.available, false);
    assert.equal(support.test.available, false);
    assert.equal(support.quickApply.reasonKey, 'runtimeStatusUnavailable');
    assert.equal(support.test.reasonKey, 'runtimeStatusUnavailable');
    assert.ok(support.quickApply.reason);
    assert.ok(support.test.reason);
  },
);

await runTest(
  'providerConfigCenterService keeps route testing available when quick-apply target discovery is temporarily unavailable',
  async () => {
    const service = createProviderConfigCenterService({
      kernelPlatformService: {
        getInfo: async () => createKernelInfoWithLocalAiProxy(),
      } as any,
      studioApi: {
        listInstances: async () => {
          throw new Error('instances unavailable');
        },
      } as any,
    });

    const support = await service.getActionSupport();

    assert.equal(support.quickApply.available, false);
    assert.equal(support.quickApply.reasonKey, 'quickApplyTargetsUnavailable');
    assert.ok(support.quickApply.reason);
    assert.equal(support.test.available, true);
    assert.equal(support.test.reasonKey, undefined);
    assert.equal(support.test.reason, undefined);
  },
);

await runTest(
  'providerConfigCenterService disables quick apply when the local AI proxy runtime is not loopback-only',
  async () => {
    const service = createProviderConfigCenterService({
      kernelPlatformService: {
        getInfo: async () =>
          createKernelInfoWithLocalAiProxy({
            loopbackOnly: false,
          }),
      } as any,
    });

    const support = await service.getActionSupport();

    assert.equal(support.quickApply.available, false);
    assert.equal(support.quickApply.reasonKey, 'quickApplyRequiresLoopback');
    assert.ok(support.quickApply.reason);
    assert.equal(support.test.available, true);
    assert.equal(support.test.reasonKey, undefined);
  },
);

await runTest(
  'providerConfigCenterService hides quick-apply instances when the local AI proxy runtime is network-exposed',
  async () => {
    const service = createProviderConfigCenterService({
      kernelPlatformService: {
        getInfo: async () =>
          createKernelInfoWithLocalAiProxy({
            loopbackOnly: false,
          }),
      } as any,
      studioApi: {
        listInstances: async () => {
          throw new Error('listInstances should not be called when quick apply is unsupported');
        },
      } as any,
    });

    const instances = await service.listApplyInstances();

    assert.deepEqual(instances, []);
  },
);

await runTest(
  'providerConfigCenterService reports a dedicated quick-apply reason when no writable OpenClaw instance is available',
  async () => {
    const service = createProviderConfigCenterService({
      kernelPlatformService: {
        getInfo: async () => createKernelInfoWithLocalAiProxy(),
      } as any,
      studioApi: {
        listInstances: async () => [],
      } as any,
    });

    const support = await service.getActionSupport();

    assert.equal(support.quickApply.available, false);
    assert.equal(support.quickApply.reasonKey, 'quickApplyInstanceUnavailable');
    assert.ok(support.quickApply.reason);
    assert.equal(support.test.available, true);
  },
);

await runTest('providerConfigCenterService applies a saved provider config through the managed local proxy projection and updates selected agents', async () => {
  const projectionCalls: Array<unknown> = [];
  const agentCalls: Array<unknown> = [];
  const kernelCalls: string[] = [];
  const record = createRecord({
    id: 'provider-config-openai-prod',
    config: {
      temperature: 0.2,
      topP: 1,
      maxTokens: 12000,
      timeoutMs: 120000,
      streaming: true,
      request: {
        headers: {
          'cf-aig-authorization': 'Bearer cf-gateway-secret',
          'x-openai-client': 'agent-studio',
        },
      },
    },
  });
  const service = createProviderConfigCenterService({
    storageApi: {
      getStorageInfo: async () => null,
      getText: async () => ({
        profileId: 'default-sqlite',
        namespace: PROVIDER_CONFIG_CENTER_STORAGE_NAMESPACE,
        key: 'unused',
        value: null,
      }),
      putText: async () => ({
        profileId: 'default-sqlite',
        namespace: PROVIDER_CONFIG_CENTER_STORAGE_NAMESPACE,
        key: 'unused',
      }),
      delete: async () => ({
        profileId: 'default-sqlite',
        namespace: PROVIDER_CONFIG_CENTER_STORAGE_NAMESPACE,
        key: 'unused',
        existed: false,
      }),
      listKeys: async () => ({
        profileId: 'default-sqlite',
        namespace: PROVIDER_CONFIG_CENTER_STORAGE_NAMESPACE,
        keys: [],
      }),
    },
    studioApi: {
      getInstanceDetail: async () => createOpenClawDetail(),
    },
    kernelPlatformService: {
      ensureRunning: async () => {
        kernelCalls.push('ensureRunning');
        return null;
      },
      getInfo: async () =>
        ({
          localAiProxy: {
            lifecycle: 'running',
            baseUrl: 'http://localhost:21280/v1',
            rootBaseUrl: 'http://localhost:21280',
            openaiCompatibleBaseUrl: 'http://localhost:21280/v1',
            anthropicBaseUrl: 'http://localhost:21280/v1',
            geminiBaseUrl: 'http://localhost:21280',
            activePort: 21280,
            loopbackOnly: true,
            defaultRouteId: 'local-ai-proxy-system-default-openai-compatible',
            defaultRouteName: 'SDKWork Default',
            upstreamBaseUrl: 'https://ai.sdkwork.com',
            modelCount: 3,
            configFile: 'D:/state/local-ai-proxy.json',
            snapshotPath: 'D:/state/local-ai-proxy.snapshot.json',
            logPath: 'D:/logs/local-ai-proxy.log',
            lastError: null,
          },
        }) as any,
    },
    kernelConfigAttachmentApi: {
      resolveAttachedKernelConfigFile: () => 'D:/OpenClaw/.openclaw/openclaw.json',
    },
    openClawConfigDocumentApi: {
      saveManagedLocalProxyProjection: async (input) => {
        projectionCalls.push(input);
        return null;
      },
      saveAgent: async (input) => {
        agentCalls.push(input);
        return null;
      },
    },
  });

  await service.applyProviderConfig({
    instanceId: BUILT_IN_INSTANCE_ID,
    config: record,
    agentIds: ['main', 'research'],
  });

  assert.deepEqual(kernelCalls, ['ensureRunning']);
  assert.deepEqual(projectionCalls, [
    {
      configFile: 'D:/OpenClaw/.openclaw/openclaw.json',
      projection: {
        sourceRoute: record,
        provider: {
          id: 'sdkwork-local-proxy',
          channelId: 'openai-compatible',
          name: 'SDKWork Local Proxy',
          apiKey: SDKWORK_LOCAL_PROXY_TOKEN_PLACEHOLDER,
          baseUrl: 'http://localhost:21280/v1',
          models: [
            { id: 'gpt-5.4', name: 'GPT-5.4' },
            { id: 'o4-mini', name: 'o4-mini' },
            { id: 'text-embedding-3-large', name: 'text-embedding-3-large' },
          ],
          notes: 'Managed local proxy projection for route "OpenAI Production".',
          config: {
            temperature: 0.2,
            topP: 1,
            maxTokens: 12000,
            timeoutMs: 120000,
            streaming: true,
            request: {
              headers: {
                'cf-aig-authorization': 'Bearer cf-gateway-secret',
                'x-openai-client': 'agent-studio',
              },
            },
          },
        },
        selection: {
          defaultModelId: 'gpt-5.4',
          reasoningModelId: 'o4-mini',
          embeddingModelId: 'text-embedding-3-large',
        },
      },
    },
  ]);
  assert.deepEqual(agentCalls, [
    {
      configFile: 'D:/OpenClaw/.openclaw/openclaw.json',
      agent: {
        id: 'main',
        model: {
          primary: 'sdkwork-local-proxy/gpt-5.4',
          fallbacks: ['sdkwork-local-proxy/o4-mini'],
        },
      },
    },
    {
      configFile: 'D:/OpenClaw/.openclaw/openclaw.json',
      agent: {
        id: 'research',
        model: {
          primary: 'sdkwork-local-proxy/gpt-5.4',
          fallbacks: ['sdkwork-local-proxy/o4-mini'],
        },
      },
    },
  ]);
});

await runTest('providerConfigCenterService applies provider configs through the managed local proxy projection instead of writing raw upstream providers', async () => {
  const projectionCalls: Array<unknown> = [];
  const agentCalls: Array<unknown> = [];
  const kernelCalls: string[] = [];
  const record = createRecord({
    id: 'provider-config-anthropic-route',
    name: 'Anthropic Route',
    providerId: 'anthropic',
    upstreamProtocol: 'anthropic',
    upstreamBaseUrl: 'https://api.anthropic.com/v1',
    defaultModelId: 'claude-sonnet-4-20250514',
    reasoningModelId: 'claude-opus-4-20250514',
    embeddingModelId: undefined,
    models: [
      { id: 'claude-sonnet-4-20250514', name: 'Claude Sonnet 4' },
      { id: 'claude-opus-4-20250514', name: 'Claude Opus 4' },
    ],
  });
  const service = createProviderConfigCenterService({
    storageApi: {
      getStorageInfo: async () => null,
      getText: async () => ({
        profileId: 'default-sqlite',
        namespace: PROVIDER_CONFIG_CENTER_STORAGE_NAMESPACE,
        key: 'unused',
        value: null,
      }),
      putText: async () => ({
        profileId: 'default-sqlite',
        namespace: PROVIDER_CONFIG_CENTER_STORAGE_NAMESPACE,
        key: 'unused',
      }),
      delete: async () => ({
        profileId: 'default-sqlite',
        namespace: PROVIDER_CONFIG_CENTER_STORAGE_NAMESPACE,
        key: 'unused',
        existed: false,
      }),
      listKeys: async () => ({
        profileId: 'default-sqlite',
        namespace: PROVIDER_CONFIG_CENTER_STORAGE_NAMESPACE,
        keys: [],
      }),
    },
    studioApi: {
      getInstanceDetail: async () => createOpenClawDetail(),
    },
    kernelPlatformService: {
      ensureRunning: async () => {
        kernelCalls.push('ensureRunning');
        return null;
      },
      getInfo: async () =>
        ({
          localAiProxy: {
            lifecycle: 'running',
            baseUrl: 'http://localhost:21280/v1',
            rootBaseUrl: 'http://localhost:21280',
            openaiCompatibleBaseUrl: 'http://localhost:21280/v1',
            anthropicBaseUrl: 'http://localhost:21280/v1',
            geminiBaseUrl: 'http://localhost:21280',
            activePort: 21280,
            loopbackOnly: true,
            defaultRouteId: 'local-ai-proxy-system-default-openai-compatible',
            defaultRouteName: 'SDKWork Default',
            upstreamBaseUrl: 'https://ai.sdkwork.com',
            modelCount: 2,
            configFile: 'D:/state/local-ai-proxy.json',
            snapshotPath: 'D:/state/local-ai-proxy.snapshot.json',
            logPath: 'D:/logs/local-ai-proxy.log',
            lastError: null,
          },
        }) as any,
    },
    kernelConfigAttachmentApi: {
      resolveAttachedKernelConfigFile: () => 'D:/OpenClaw/.openclaw/openclaw.json',
    },
    openClawConfigDocumentApi: {
      saveManagedLocalProxyProjection: async (input) => {
        projectionCalls.push(input);
        return null;
      },
      saveAgent: async (input) => {
        agentCalls.push(input);
        return null;
      },
    },
  });

  await service.applyProviderConfig({
    instanceId: BUILT_IN_INSTANCE_ID,
    config: record,
    agentIds: ['main'],
  });

  assert.deepEqual(kernelCalls, ['ensureRunning']);
  assert.deepEqual(projectionCalls, [
    {
      configFile: 'D:/OpenClaw/.openclaw/openclaw.json',
      projection: {
        sourceRoute: record,
        provider: {
          id: 'sdkwork-local-proxy',
          channelId: 'openai-compatible',
          name: 'SDKWork Local Proxy',
          apiKey: SDKWORK_LOCAL_PROXY_TOKEN_PLACEHOLDER,
          baseUrl: 'http://localhost:21280/v1',
          models: [
            { id: 'claude-sonnet-4-20250514', name: 'Claude Sonnet 4' },
            { id: 'claude-opus-4-20250514', name: 'Claude Opus 4' },
          ],
          notes: 'Managed local proxy projection for route "Anthropic Route".',
          config: {
            temperature: 0.2,
            topP: 1,
            maxTokens: 12000,
            timeoutMs: 120000,
            streaming: true,
          },
        },
        selection: {
          defaultModelId: 'claude-sonnet-4-20250514',
          reasoningModelId: 'claude-opus-4-20250514',
          embeddingModelId: undefined,
        },
      },
    },
  ]);
  assert.deepEqual(agentCalls, [
    {
      configFile: 'D:/OpenClaw/.openclaw/openclaw.json',
      agent: {
        id: 'main',
        model: {
          primary: 'sdkwork-local-proxy/claude-sonnet-4-20250514',
          fallbacks: ['sdkwork-local-proxy/claude-opus-4-20250514'],
        },
      },
    },
  ]);
});

await runTest('providerConfigCenterService applies native gemini client routes through the gemini local proxy endpoint', async () => {
  const projectionCalls: Array<unknown> = [];
  const agentCalls: Array<unknown> = [];
  const kernelCalls: string[] = [];
  const record = createRecord({
    id: 'provider-config-gemini-native',
    name: 'Gemini Native',
    providerId: 'google',
    clientProtocol: 'gemini',
    upstreamProtocol: 'gemini',
    upstreamBaseUrl: 'https://generativelanguage.googleapis.com',
    defaultModelId: 'gemini-2.5-pro',
    reasoningModelId: undefined,
    embeddingModelId: 'text-embedding-004',
    models: [
      { id: 'gemini-2.5-pro', name: 'Gemini 2.5 Pro' },
      { id: 'text-embedding-004', name: 'text-embedding-004' },
    ],
  });
  const service = createProviderConfigCenterService({
    storageApi: {
      getStorageInfo: async () => null,
      getText: async () => ({
        profileId: 'default-sqlite',
        namespace: PROVIDER_CONFIG_CENTER_STORAGE_NAMESPACE,
        key: 'unused',
        value: null,
      }),
      putText: async () => ({
        profileId: 'default-sqlite',
        namespace: PROVIDER_CONFIG_CENTER_STORAGE_NAMESPACE,
        key: 'unused',
      }),
      delete: async () => ({
        profileId: 'default-sqlite',
        namespace: PROVIDER_CONFIG_CENTER_STORAGE_NAMESPACE,
        key: 'unused',
        existed: false,
      }),
      listKeys: async () => ({
        profileId: 'default-sqlite',
        namespace: PROVIDER_CONFIG_CENTER_STORAGE_NAMESPACE,
        keys: [],
      }),
    },
    studioApi: {
      getInstanceDetail: async () => createOpenClawDetail(),
    },
    kernelPlatformService: {
      ensureRunning: async () => {
        kernelCalls.push('ensureRunning');
        return null;
      },
      getInfo: async () =>
        ({
          localAiProxy: {
            lifecycle: 'running',
            baseUrl: 'http://localhost:21280/v1',
            rootBaseUrl: 'http://localhost:21280',
            openaiCompatibleBaseUrl: 'http://localhost:21280/v1',
            anthropicBaseUrl: 'http://localhost:21280/v1',
            geminiBaseUrl: 'http://localhost:21280',
            activePort: 21280,
            loopbackOnly: true,
            defaultRouteId: 'local-ai-proxy-system-default-openai-compatible',
            defaultRouteName: 'SDKWork Default',
            upstreamBaseUrl: 'https://ai.sdkwork.com',
            modelCount: 2,
            configFile: 'D:/state/local-ai-proxy.json',
            snapshotPath: 'D:/state/local-ai-proxy.snapshot.json',
            logPath: 'D:/logs/local-ai-proxy.log',
            lastError: null,
          },
        }) as any,
    },
    kernelConfigAttachmentApi: {
      resolveAttachedKernelConfigFile: () => 'D:/OpenClaw/.openclaw/openclaw.json',
    },
    openClawConfigDocumentApi: {
      saveManagedLocalProxyProjection: async (input) => {
        projectionCalls.push(input);
        return null;
      },
      saveAgent: async (input) => {
        agentCalls.push(input);
        return null;
      },
    },
  });

  await service.applyProviderConfig({
    instanceId: BUILT_IN_INSTANCE_ID,
    config: record,
    agentIds: ['main'],
  });

  assert.deepEqual(kernelCalls, ['ensureRunning']);
  assert.deepEqual(projectionCalls, [
    {
      configFile: 'D:/OpenClaw/.openclaw/openclaw.json',
      projection: {
        sourceRoute: record,
        provider: {
          id: 'sdkwork-local-proxy',
          channelId: 'gemini',
          name: 'SDKWork Local Proxy',
          apiKey: SDKWORK_LOCAL_PROXY_TOKEN_PLACEHOLDER,
          baseUrl: 'http://localhost:21280',
          models: [
            { id: 'gemini-2.5-pro', name: 'Gemini 2.5 Pro' },
            { id: 'text-embedding-004', name: 'text-embedding-004' },
          ],
          notes: 'Managed local proxy projection for route "Gemini Native".',
          config: {
            temperature: 0.2,
            topP: 1,
            maxTokens: 12000,
            timeoutMs: 120000,
            streaming: true,
          },
        },
        selection: {
          defaultModelId: 'gemini-2.5-pro',
          reasoningModelId: undefined,
          embeddingModelId: 'text-embedding-004',
        },
      },
    },
  ]);
  assert.deepEqual(agentCalls, [
    {
      configFile: 'D:/OpenClaw/.openclaw/openclaw.json',
      agent: {
        id: 'main',
        model: {
          primary: 'sdkwork-local-proxy/gemini-2.5-pro',
          fallbacks: [],
        },
      },
    },
  ]);
});

await runTest(
  'providerConfigCenterService rejects quick apply when the local AI proxy runtime is not loopback-only',
  async () => {
    const calls: string[] = [];
    const projectionCalls: Array<unknown> = [];
    const service = createProviderConfigCenterService({
      studioApi: {
        getInstanceDetail: async () => createOpenClawDetail(),
      },
      kernelPlatformService: {
        ensureRunning: async () => {
          calls.push('ensureRunning');
          return null;
        },
        getInfo: async () => {
          calls.push('getInfo');
          return createKernelInfoWithLocalAiProxy({
            loopbackOnly: false,
          });
        },
      } as any,
      kernelConfigAttachmentApi: {
        resolveAttachedKernelConfigFile: () => 'D:/OpenClaw/.openclaw/openclaw.json',
      } as any,
      openClawConfigDocumentApi: {
        saveManagedLocalProxyProjection: async (input) => {
          projectionCalls.push(input);
          return null;
        },
      } as any,
    });

    await assert.rejects(
      () =>
        service.applyProviderConfig({
          instanceId: BUILT_IN_INSTANCE_ID,
          config: createRecord({
            id: 'provider-config-openai-prod',
          }),
          agentIds: ['main'],
        }),
      /loopback-only local AI proxy runtime/i,
    );
    assert.deepEqual(calls, ['ensureRunning', 'getInfo']);
    assert.deepEqual(projectionCalls, []);
  },
);

await runTest('providerConfigCenterService merges local proxy runtime summaries into listed route records', async () => {
  const record = createRecord({
    id: 'provider-config-openai-prod',
    updatedAt: 2,
      isDefault: true,
  });
  const service = createProviderConfigCenterService({
    storageApi: {
      getStorageInfo: async () => null,
      getText: async () => ({
        profileId: 'default-sqlite',
        namespace: PROVIDER_CONFIG_CENTER_STORAGE_NAMESPACE,
        key: 'unused',
        value: null,
      }),
      putText: async () => ({
        profileId: 'default-sqlite',
        namespace: PROVIDER_CONFIG_CENTER_STORAGE_NAMESPACE,
        key: 'unused',
      }),
      delete: async () => ({
        profileId: 'default-sqlite',
        namespace: PROVIDER_CONFIG_CENTER_STORAGE_NAMESPACE,
        key: 'unused',
        existed: false,
      }),
      listKeys: async () => ({
        profileId: 'default-sqlite',
        namespace: PROVIDER_CONFIG_CENTER_STORAGE_NAMESPACE,
        keys: [],
      }),
    },
    providerRoutingApi: {
      listProviderRoutingRecords: async () => [record],
    },
    kernelPlatformService: {
      getInfo: async () =>
        ({
          localAiProxy: {
            routeMetrics: [
              {
                routeId: 'provider-config-openai-prod',
                clientProtocol: 'openai-compatible',
                upstreamProtocol: 'openai-compatible',
                health: 'healthy',
                requestCount: 18,
                successCount: 16,
                failureCount: 2,
                rpm: 4.5,
                totalTokens: 4800,
                inputTokens: 2600,
                outputTokens: 2000,
                cacheTokens: 200,
                averageLatencyMs: 845,
                lastLatencyMs: 722,
                lastUsedAt: 1_743_510_000_000,
                lastError: 'rate limited',
              },
            ],
            routeTests: [
              {
                routeId: 'provider-config-openai-prod',
                status: 'passed',
                testedAt: 1_743_510_000_100,
                latencyMs: 512,
                checkedCapability: 'chat',
                modelId: 'gpt-5.4',
                error: null,
              },
            ],
          },
        }) as any,
    },
  });

  const listed = await service.listProviderConfigs();

  assert.equal(listed.length, 1);
  assert.deepEqual((listed[0] as any).runtimeMetrics, {
    routeId: 'provider-config-openai-prod',
    clientProtocol: 'openai-compatible',
    upstreamProtocol: 'openai-compatible',
    health: 'healthy',
    requestCount: 18,
    successCount: 16,
    failureCount: 2,
    rpm: 4.5,
    totalTokens: 4800,
    inputTokens: 2600,
    outputTokens: 2000,
    cacheTokens: 200,
    averageLatencyMs: 845,
    lastLatencyMs: 722,
    lastUsedAt: 1_743_510_000_000,
    lastError: 'rate limited',
  });
  assert.deepEqual((listed[0] as any).latestTest, {
    routeId: 'provider-config-openai-prod',
    status: 'passed',
    testedAt: 1_743_510_000_100,
    latencyMs: 512,
    checkedCapability: 'chat',
    modelId: 'gpt-5.4',
    error: null,
  });
});

await runTest('providerConfigCenterService delegates route tests through the kernel platform bridge', async () => {
  const calls: string[] = [];
  const service = createProviderConfigCenterService({
    storageApi: {
      getStorageInfo: async () => null,
      getText: async () => ({
        profileId: 'default-sqlite',
        namespace: PROVIDER_CONFIG_CENTER_STORAGE_NAMESPACE,
        key: 'unused',
        value: null,
      }),
      putText: async () => ({
        profileId: 'default-sqlite',
        namespace: PROVIDER_CONFIG_CENTER_STORAGE_NAMESPACE,
        key: 'unused',
      }),
      delete: async () => ({
        profileId: 'default-sqlite',
        namespace: PROVIDER_CONFIG_CENTER_STORAGE_NAMESPACE,
        key: 'unused',
        existed: false,
      }),
      listKeys: async () => ({
        profileId: 'default-sqlite',
        namespace: PROVIDER_CONFIG_CENTER_STORAGE_NAMESPACE,
        keys: [],
      }),
    },
    kernelPlatformService: {
      getInfo: async () => {
        calls.push('getInfo');
        return {
          localAiProxy: {
            lifecycle: 'running',
            baseUrl: 'http://localhost:21280/v1',
            rootBaseUrl: 'http://localhost:21280',
            openaiCompatibleBaseUrl: 'http://localhost:21280/v1',
            anthropicBaseUrl: 'http://localhost:21280/v1',
            geminiBaseUrl: 'http://localhost:21280',
            activePort: 21280,
            loopbackOnly: true,
            defaultRouteId: 'local-ai-proxy-system-default-openai-compatible',
            defaultRouteName: 'SDKWork Default',
            upstreamBaseUrl: 'https://ai.sdkwork.com',
            modelCount: 2,
            configFile: 'D:/state/local-ai-proxy.json',
            snapshotPath: 'D:/state/local-ai-proxy.snapshot.json',
            logPath: 'D:/logs/local-ai-proxy.log',
            lastError: null,
          },
        } as any;
      },
      ensureRunning: async () => {
        calls.push('ensureRunning');
        return null;
      },
      testLocalAiProxyRoute: async (routeId: string) => {
        calls.push(`test:${routeId}`);
        return {
          routeId,
          status: 'passed',
          testedAt: 1_743_510_100_000,
          latencyMs: 433,
          checkedCapability: 'chat',
          modelId: 'gpt-5.4',
          error: null,
        } as any;
      },
    } as any,
  });

  const result = await (service as any).testProviderConfigRoute('provider-config-openai-prod');

  assert.deepEqual(calls, ['ensureRunning', 'getInfo', 'test:provider-config-openai-prod']);
  assert.deepEqual(result, {
    routeId: 'provider-config-openai-prod',
    status: 'passed',
    testedAt: 1_743_510_100_000,
    latencyMs: 433,
    checkedCapability: 'chat',
    modelId: 'gpt-5.4',
    error: null,
  });
});

await runTest(
  'providerConfigCenterService rejects route tests when the local AI proxy runtime is unavailable',
  async () => {
    const calls: string[] = [];
    const service = createProviderConfigCenterService({
      storageApi: {
        getStorageInfo: async () => null,
        getText: async () => ({
          profileId: 'default-sqlite',
          namespace: PROVIDER_CONFIG_CENTER_STORAGE_NAMESPACE,
          key: 'unused',
          value: null,
        }),
        putText: async () => ({
          profileId: 'default-sqlite',
          namespace: PROVIDER_CONFIG_CENTER_STORAGE_NAMESPACE,
          key: 'unused',
        }),
        delete: async () => ({
          profileId: 'default-sqlite',
          namespace: PROVIDER_CONFIG_CENTER_STORAGE_NAMESPACE,
          key: 'unused',
          existed: false,
        }),
        listKeys: async () => ({
          profileId: 'default-sqlite',
          namespace: PROVIDER_CONFIG_CENTER_STORAGE_NAMESPACE,
          keys: [],
        }),
      },
      kernelPlatformService: {
        ensureRunning: async () => {
          calls.push('ensureRunning');
          return null;
        },
        getInfo: async () => {
          calls.push('getInfo');
          return null;
        },
        testLocalAiProxyRoute: async (routeId: string) => {
          calls.push(`test:${routeId}`);
          return {
            routeId,
            status: 'passed',
            testedAt: 1_743_510_100_000,
            latencyMs: 433,
            checkedCapability: 'chat',
            modelId: 'gpt-5.4',
            error: null,
          } as any;
        },
      } as any,
    });

    await assert.rejects(
      () => (service as any).testProviderConfigRoute('provider-config-openai-prod'),
      /local AI proxy runtime is not available/i,
    );
    assert.deepEqual(calls, ['ensureRunning', 'getInfo']);
  },
);

await runTest(
  'providerConfigCenterService reports temporary runtime status errors when route test kernel info reads fail',
  async () => {
    const calls: string[] = [];
    const service = createProviderConfigCenterService({
      kernelPlatformService: {
        ensureRunning: async () => {
          calls.push('ensureRunning');
          return null;
        },
        getInfo: async () => {
          calls.push('getInfo');
          throw new Error('kernel info unavailable');
        },
      } as any,
    });

    await assert.rejects(
      () => (service as any).testProviderConfigRoute('provider-config-openai-prod'),
      /runtime status is temporarily unavailable/i,
    );
    assert.deepEqual(calls, ['ensureRunning', 'getInfo']);
  },
);

await runTest(
  'providerConfigCenterService reports temporary runtime status errors when apply kernel info reads fail',
  async () => {
    const calls: string[] = [];
    const projectionCalls: Array<unknown> = [];
    const service = createProviderConfigCenterService({
      studioApi: {
        getInstanceDetail: async () => createOpenClawDetail(),
      },
      kernelPlatformService: {
        ensureRunning: async () => {
          calls.push('ensureRunning');
          return null;
        },
        getInfo: async () => {
          calls.push('getInfo');
          throw new Error('kernel info unavailable');
        },
      } as any,
      kernelConfigAttachmentApi: {
        resolveAttachedKernelConfigFile: () => 'D:/OpenClaw/.openclaw/openclaw.json',
      } as any,
      openClawConfigDocumentApi: {
        saveManagedLocalProxyProjection: async (input) => {
          projectionCalls.push(input);
          return null;
        },
      } as any,
    });

    await assert.rejects(
      () =>
        service.applyProviderConfig({
          instanceId: BUILT_IN_INSTANCE_ID,
          config: createRecord({
            id: 'provider-config-openai-prod',
          }),
          agentIds: ['main'],
        }),
      /runtime status is temporarily unavailable/i,
    );
    assert.deepEqual(calls, ['ensureRunning', 'getInfo']);
    assert.deepEqual(projectionCalls, []);
  },
);
