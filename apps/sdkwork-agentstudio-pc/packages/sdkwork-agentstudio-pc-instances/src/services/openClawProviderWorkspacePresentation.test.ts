// WORKSPACE-PATH:allow-fixture: fixtures name a foreign checkout root, drive, or home directory to exercise path handling, so the literal is the value under assertion rather than a binding this build resolves
import assert from 'node:assert/strict';
import {
  DEFAULT_BUNDLED_OPENCLAW_VERSION,
  type StudioInstanceDetailRecord,
} from '@sdkwork/agentstudio-pc-types';
import * as providerWorkspacePresentation from './openClawProviderWorkspacePresentation.ts';

function runTest(name: string, fn: () => void | Promise<void>) {
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

type DetailOverrides =
  Omit<Partial<StudioInstanceDetailRecord>, 'instance' | 'config' | 'lifecycle'> & {
    instance?: Partial<StudioInstanceDetailRecord['instance']>;
    config?: Partial<StudioInstanceDetailRecord['config']>;
    lifecycle?: Partial<StudioInstanceDetailRecord['lifecycle']>;
  };

function createDetail(overrides: DetailOverrides = {}): StudioInstanceDetailRecord {
  const {
    instance: instanceOverrides,
    config: configOverrides,
    lifecycle: lifecycleOverrides,
    ...detailOverrides
  } = overrides;

  return {
    instance: {
      id: 'openclaw-instance',
      name: 'OpenClaw Instance',
      runtimeKind: 'openclaw',
      deploymentMode: 'remote',
      transportKind: 'openclawGatewayWs',
      status: 'online',
      isBuiltIn: false,
      isDefault: false,
      iconType: 'server',
      version: DEFAULT_BUNDLED_OPENCLAW_VERSION,
      typeLabel: 'OpenClaw Gateway',
      host: '10.0.0.8',
      port: 21280,
      baseUrl: 'https://gateway.example.com',
      websocketUrl: 'wss://gateway.example.com/ws',
      cpu: 0,
      memory: 0,
      totalMemory: 'Unknown',
      uptime: '-',
      capabilities: [],
      storage: {
        provider: 'localFile',
        namespace: 'openclaw-instance',
      },
      config: {
        port: '21280',
        sandbox: true,
        autoUpdate: true,
        logLevel: 'info',
        corsOrigins: '*',
        baseUrl: 'https://gateway.example.com',
        websocketUrl: 'wss://gateway.example.com/ws',
      },
      createdAt: 1,
      updatedAt: 1,
      lastSeenAt: 1,
      ...(instanceOverrides || {}),
    },
    config: {
      port: '21280',
      sandbox: true,
      autoUpdate: true,
      logLevel: 'info',
      corsOrigins: '*',
      baseUrl: 'https://gateway.example.com',
      websocketUrl: 'wss://gateway.example.com/ws',
      ...(configOverrides || {}),
    },
    logs: '',
    health: {
      score: 90,
      status: 'healthy',
      checks: [],
      evaluatedAt: 1,
    },
    lifecycle: {
      owner: 'remoteService',
      startStopSupported: false,
      configWritable: false,
      notes: [],
      ...(lifecycleOverrides || {}),
    },
    storage: {
      status: 'ready',
      provider: 'localFile',
      namespace: 'openclaw-instance',
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
    workbench: null,
    ...detailOverrides,
  };
}

await runTest(
  'buildOpenClawProviderWorkspaceState treats managed directory routes as Provider Center controlled even without an OpenClaw config file path',
  () => {
    const state = providerWorkspacePresentation.buildOpenClawProviderWorkspaceState(
      createDetail({
        instance: {
          deploymentMode: 'local-external',
        },
        lifecycle: {
          owner: 'externalProcess',
          configWritable: true,
          workbenchManaged: false,
          lifecycleControllable: false,
          endpointObserved: false,
          notes: [],
        },
        dataAccess: {
          routes: [
            {
              id: 'config-directory',
              label: 'OpenClaw workspace',
              scope: 'config',
              mode: 'managedDirectory',
              status: 'ready',
              target: 'D:/OpenClaw/.openclaw',
              readonly: false,
              authoritative: true,
              detail: 'Writable managed directory.',
              source: 'integration',
            },
          ],
        },
      }),
    );

    assert.equal(state.providerCenterControlled, true);
    assert.equal(state.isProviderConfigReadonly, true);
    assert.equal(state.canManageProviderCatalog, false);
  },
);

await runTest(
  'buildOpenClawProviderWorkspaceState prefers kernel authority over legacy workbench-managed heuristics',
  () => {
    const state = providerWorkspacePresentation.buildOpenClawProviderWorkspaceState({
      detail: createDetail({
        instance: {
          isBuiltIn: true,
          isDefault: true,
          deploymentMode: 'local-managed',
          host: '127.0.0.1',
        },
        lifecycle: {
          owner: 'appManaged',
          configWritable: true,
          workbenchManaged: true,
          lifecycleControllable: true,
          endpointObserved: true,
          notes: [],
        },
      }),
      kernelAuthority: {
        owner: 'appManaged',
        controlPlane: 'desktopHost',
        lifecycleControl: true,
        configControl: false,
        upgradeControl: true,
        doctorSupport: true,
        migrationSupport: true,
        observable: true,
        writable: false,
      },
    } as any);

    assert.equal(state.providerCenterControlled, false);
    assert.equal(state.isProviderConfigReadonly, false);
    assert.equal(state.canManageProviderCatalog, false);
  },
);

await runTest(
  'buildOpenClawProviderWorkspaceState keeps remote openclaw provider config editable when no Provider Center controlled route exists',
  () => {
    const state = providerWorkspacePresentation.buildOpenClawProviderWorkspaceState({
      detail: createDetail({
        lifecycle: {
          owner: 'remoteService',
          configWritable: true,
          workbenchManaged: false,
          lifecycleControllable: false,
          endpointObserved: true,
          notes: [],
        },
      }),
      kernelConfig: null,
      kernelAuthority: {
        owner: 'remoteManaged',
        controlPlane: 'remoteApi',
        lifecycleControl: false,
        configControl: true,
        upgradeControl: false,
        doctorSupport: true,
        migrationSupport: false,
        observable: true,
        writable: true,
      },
    } as any);

    assert.equal(state.providerCenterControlled, false);
    assert.equal(state.isProviderConfigReadonly, false);
    assert.equal(state.canManageProviderCatalog, false);
  },
);

await runTest(
  'buildOpenClawProviderWorkspaceState keeps non-openclaw runtimes writable through the standard provider workspace flow',
  () => {
    const state = providerWorkspacePresentation.buildOpenClawProviderWorkspaceState(
      createDetail({
        instance: {
          runtimeKind: 'custom',
          transportKind: 'customHttp',
        },
      }),
    );

    assert.equal(state.providerCenterControlled, false);
    assert.equal(state.isProviderConfigReadonly, false);
    assert.equal(state.canManageProviderCatalog, true);
  },
);

await runTest(
  'buildOpenClawProviderSelectionState derives selected provider defaults and delete targets from the workbench truth',
  () => {
    const selectionState = (providerWorkspacePresentation as any).buildOpenClawProviderSelectionState({
      workbench: {
        llmProviders: [
          {
            id: 'provider-a',
            name: 'Provider A',
            endpoint: 'https://provider-a.example.com',
            apiKeySource: 'PROVIDER_A_KEY',
            defaultModelId: 'model-a',
            reasoningModelId: 'reasoning-a',
            embeddingModelId: 'embedding-a',
            models: [
              { id: 'model-a', name: 'Model A' },
              { id: 'model-b', name: 'Model B' },
            ],
            config: {
              retries: 3,
              request: {
                temperature: 0.2,
              },
            },
          },
          {
            id: 'provider-b',
            name: 'Provider B',
            endpoint: 'https://provider-b.example.com',
            apiKeySource: 'PROVIDER_B_KEY',
            defaultModelId: 'model-z',
            reasoningModelId: '',
            embeddingModelId: '',
            models: [{ id: 'model-z', name: 'Model Z' }],
            config: {
              retries: 1,
              request: {
                top_p: 0.7,
              },
            },
          },
        ],
      },
      selectedProviderId: 'provider-a',
      providerDeleteId: 'provider-b',
      providerModelDeleteId: 'model-b',
      providerDrafts: {},
      providerRequestDrafts: {},
      t: (key: string) => key,
    });

    assert.equal(selectionState.selectedProvider?.id, 'provider-a');
    assert.equal(selectionState.deletingProvider?.id, 'provider-b');
    assert.equal(selectionState.deletingProviderModel?.id, 'model-b');
    assert.deepEqual(selectionState.selectedProviderDraft, {
      endpoint: 'https://provider-a.example.com',
      apiKeySource: 'PROVIDER_A_KEY',
      defaultModelId: 'model-a',
      reasoningModelId: 'reasoning-a',
      embeddingModelId: 'embedding-a',
      config: {
        retries: 3,
        request: {
          temperature: 0.2,
        },
      },
    });
    assert.match(selectionState.selectedProviderRequestDraft, /temperature/);
    assert.equal(selectionState.selectedProviderRequestParseError, null);
    assert.equal(selectionState.hasPendingProviderChanges, false);
  },
);

await runTest(
  'buildOpenClawProviderSelectionState keeps explicit provider drafts, surfaces request parse errors, and flags pending changes',
  () => {
    const selectionState = (providerWorkspacePresentation as any).buildOpenClawProviderSelectionState({
      workbench: {
        llmProviders: [
          {
            id: 'provider-a',
            name: 'Provider A',
            endpoint: 'https://provider-a.example.com',
            apiKeySource: 'PROVIDER_A_KEY',
            defaultModelId: 'model-a',
            reasoningModelId: 'reasoning-a',
            embeddingModelId: 'embedding-a',
            models: [{ id: 'model-a', name: 'Model A' }],
            config: {
              retries: 3,
              request: {
                temperature: 0.2,
              },
            },
          },
        ],
      },
      selectedProviderId: 'provider-a',
      providerDeleteId: null,
      providerModelDeleteId: null,
      providerDrafts: {
        'provider-a': {
          endpoint: 'https://override.example.com',
          apiKeySource: 'OVERRIDE_KEY',
          defaultModelId: 'model-a',
          reasoningModelId: 'reasoning-a',
          embeddingModelId: 'embedding-a',
          config: {
            retries: 5,
            request: {
              temperature: 0.9,
            },
          },
        },
      },
      providerRequestDrafts: {
        'provider-a': '{"temperature": }',
      },
      t: (key: string) => key,
    });

    assert.equal(selectionState.selectedProvider?.id, 'provider-a');
    assert.equal(selectionState.selectedProviderDraft?.endpoint, 'https://override.example.com');
    assert.equal(selectionState.selectedProviderRequestDraft, '{"temperature": }');
    assert.ok(selectionState.selectedProviderRequestParseError);
    assert.equal(selectionState.hasPendingProviderChanges, true);
  },
);

await runTest(
  'buildOpenClawProviderWorkspaceSyncState clears provider selection and draft maps when no providers exist',
  () => {
    const syncState = providerWorkspacePresentation.buildOpenClawProviderWorkspaceSyncState({
      providers: [],
    });

    assert.equal(syncState.resolveSelectedProviderId('provider-a'), null);
    assert.deepEqual(syncState.providerDrafts, {});
    assert.deepEqual(syncState.providerRequestDrafts, {});
  },
);

await runTest(
  'buildOpenClawProviderWorkspaceSyncState preserves a valid current provider and otherwise falls back to the first provider',
  () => {
    const syncState = providerWorkspacePresentation.buildOpenClawProviderWorkspaceSyncState({
      providers: [
        {
          id: 'provider-a',
          name: 'Provider A',
          endpoint: 'https://provider-a.example.com',
          apiKeySource: 'PROVIDER_A_KEY',
          defaultModelId: 'model-a',
          reasoningModelId: '',
          embeddingModelId: '',
          models: [{ id: 'model-a', name: 'Model A' }],
          config: {},
        },
        {
          id: 'provider-b',
          name: 'Provider B',
          endpoint: 'https://provider-b.example.com',
          apiKeySource: 'PROVIDER_B_KEY',
          defaultModelId: 'model-b',
          reasoningModelId: '',
          embeddingModelId: '',
          models: [{ id: 'model-b', name: 'Model B' }],
          config: {},
        },
      ],
    });

    assert.equal(syncState.resolveSelectedProviderId('provider-b'), 'provider-b');
    assert.equal(syncState.resolveSelectedProviderId('missing-provider'), 'provider-a');
    assert.equal(syncState.resolveSelectedProviderId(null), 'provider-a');
    assert.deepEqual(syncState.providerDrafts, {});
    assert.deepEqual(syncState.providerRequestDrafts, {});
  },
);
