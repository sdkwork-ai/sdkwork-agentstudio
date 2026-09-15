// WORKSPACE-PATH:allow-fixture: fixtures name a foreign checkout root, drive, or home directory to exercise path handling, so the literal is the value under assertion rather than a binding this build resolves
import assert from 'node:assert/strict';
import { DEFAULT_BUNDLED_OPENCLAW_VERSION } from '@sdkwork/agentstudio-pc-types';
import { buildInstanceDetailDerivedState } from './instanceDetailDerivedState.ts';

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

function createWorkbench() {
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
      port: 3456,
      sandbox: true,
      autoUpdate: false,
      corsOrigins: '*',
    },
    detail: {
      instance: {
        id: 'instance-1',
        name: 'OpenAgent Studio',
        runtimeKind: 'openclaw',
        deploymentMode: 'local-managed',
        status: 'online',
        isBuiltIn: true,
      },
      lifecycle: {
        owner: 'appManaged',
        startStopSupported: true,
        configWritable: true,
        lifecycleControllable: true,
        workbenchManaged: true,
        endpointObserved: true,
        notes: ['Managed by Agent Studio.'],
      },
      storage: {
        namespace: 'openclaw-workspace',
      },
      health: {
        status: 'healthy',
      },
      dataAccess: {
        routes: [
          {
            id: 'config-managed',
            scope: 'config',
            mode: 'managedDirectory',
            readonly: false,
            target: 'D:/OpenClaw/.openclaw',
          },
        ],
      },
      artifacts: [
        {
          id: 'workspace-root',
          kind: 'workspaceDirectory',
          location: 'D:/OpenClaw/.openclaw/workspace',
        },
      ],
      consoleAccess: {
        available: true,
        url: 'http://127.0.0.1:3456/ui',
        autoLoginUrl: 'http://127.0.0.1:3456/ui/autologin',
        installMethod: 'pnpm',
      },
      officialRuntimeNotes: [],
    },
    kernelConfig: {
      configFile: 'D:/OpenClaw/.openclaw/openclaw.json',
      configRoot: 'D:/OpenClaw/.openclaw',
      userRoot: 'D:/OpenClaw',
      format: 'json',
      access: 'localFs',
      provenance: 'standardUserRoot',
      writable: true,
      resolved: true,
      schemaVersion: null,
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
    configChannels: [
      {
        id: 'slack',
        name: 'Slack',
        description: 'Managed Slack channel',
        status: 'connected',
        enabled: true,
        configurationMode: 'managed',
        fieldCount: 1,
        setupSteps: ['Authorize Slack'],
        fields: [{ key: 'token', label: 'Token', required: true }],
        values: {
          token: 'managed-token',
        },
      },
    ],
    configWebSearch: {
      enabled: true,
      provider: 'serpapi',
      maxResults: 5,
      timeoutSeconds: 20,
      cacheTtlMinutes: 30,
      providers: [
        {
          id: 'serpapi',
          label: 'SerpAPI',
          apiKeySource: 'SERPAPI_KEY',
          baseUrl: 'https://serpapi.example.com',
          model: 'serpapi-default',
          advancedConfig: '{"safe":true}',
        },
      ],
    },
    configXSearch: {
      enabled: true,
    },
    configWebSearchNativeCodex: {
      enabled: true,
    },
    configWebFetch: {
      enabled: true,
    },
    configAuthCooldowns: {
      rateLimitedProfileRotations: 1,
    },
    configDreaming: {
      enabled: true,
    },
    sectionAvailability: {},
    sectionCounts: {
      overview: 1,
      channels: 1,
      cronTasks: 0,
      llmProviders: 1,
      agents: 1,
      skills: 0,
      files: 0,
      memory: 0,
      tools: 0,
      config: 1,
    },
    channels: [
      {
        id: 'slack',
        name: 'Slack',
        description: 'Runtime Slack channel',
        status: 'connected',
        enabled: true,
        configurationMode: 'managed',
        fieldCount: 1,
        setupSteps: ['Use runtime setup'],
        fields: [{ key: 'token', label: 'Token', required: true }],
        values: {},
      },
      {
        id: 'matrix',
        name: 'Matrix',
        description: 'Read only Matrix',
        status: 'disconnected',
        enabled: false,
        configurationMode: 'managed',
        fieldCount: 1,
        setupSteps: ['Connect Matrix'],
        fields: [{ key: 'accessToken', label: 'Access Token', required: true }],
        values: { accessToken: '' },
      },
    ],
    tasks: [],
    agents: [
      {
        agent: {
          id: 'agent-main',
          name: 'Main',
          creator: 'SDKWork',
        },
        workspace: 'D:/OpenClaw/.openclaw/workspace',
      },
    ],
    skills: [],
    files: [],
    llmProviders: [
      {
        id: 'openai',
        name: 'OpenAI',
        endpoint: 'https://api.openai.com/v1',
        apiKeySource: 'OPENAI_API_KEY',
        defaultModelId: 'gpt-5.4',
        reasoningModelId: 'o4-mini',
        embeddingModelId: 'text-embedding-3-large',
        config: {
          request: {
            timeoutMs: 30000,
          },
        },
        models: [
          {
            id: 'model-gpt-5-4',
            name: 'GPT-5.4',
          },
          {
            id: 'model-o4-mini',
            name: 'o4-mini',
          },
        ],
      },
    ],
    memories: [],
    tools: [],
    connectedChannelCount: 1,
    activeTaskCount: 0,
    installedSkillCount: 0,
    readyToolCount: 0,
    runtimeStatus: 'healthy',
    healthScore: 98,
  } as any;
}

await runTest(
  'buildInstanceDetailDerivedState composes page-facing provider, channel, and management presentation state',
  () => {
    const workbench = createWorkbench();
    const derivedState = buildInstanceDetailDerivedState({
      id: 'instance-1',
      workbench,
      selectedProviderId: 'openai',
      providerDeleteId: 'openai',
      providerModelDeleteId: 'model-gpt-5-4',
      providerDrafts: {},
      providerRequestDrafts: {},
      selectedConfigChannelId: 'slack',
      configChannelDrafts: {
        slack: {
          token: 'draft-token',
        },
      },
      selectedWebSearchProviderId: 'serpapi',
      webSearchProviderDrafts: {},
      providerDialogDraft: {
        id: '',
        name: 'OpenAI',
        endpoint: 'https://api.openai.com/v1',
        apiKeySource: 'OPENAI_API_KEY',
        defaultModelId: 'gpt-5.4',
        reasoningModelId: 'o4-mini',
        embeddingModelId: 'text-embedding-3-large',
        modelsText: 'gpt-5.4|GPT-5.4',
        requestOverridesText: '{ timeoutMs: 30000 }',
      },
      t: (key: string) => key,
    });

    assert.equal(derivedState.instance?.id, 'instance-1');
    assert.equal(derivedState.detail?.instance.runtimeKind, 'openclaw');
    assert.equal(derivedState.isOpenClawConfigWritable, true);
    assert.equal(derivedState.canControlLifecycle, true);
    assert.equal(derivedState.canRestartLifecycle, true);
    assert.equal(derivedState.canEditConfigChannels, true);
    assert.equal(derivedState.canEditConfigWebSearch, true);
    assert.equal(derivedState.canEditConfigWebFetch, true);
    assert.equal(derivedState.canEditDreamingConfig, true);
    assert.equal(derivedState.isProviderConfigReadonly, true);
    assert.equal(derivedState.canManageOpenClawProviders, false);
    assert.equal(derivedState.canOpenControlPage, true);
    assert.equal(derivedState.managementSummary?.entries.length, 5);
    assert.equal(derivedState.providerSelectionState.selectedProvider?.id, 'openai');
    assert.equal(derivedState.providerSelectionState.deletingProvider?.id, 'openai');
    assert.equal(derivedState.providerSelectionState.deletingProviderModel?.id, 'model-gpt-5-4');
    assert.equal(derivedState.configChannelSelectionState.selectedConfigChannel?.id, 'slack');
    assert.equal(
      derivedState.configChannelSelectionState.selectedConfigChannelDraft?.token,
      'draft-token',
    );
    assert.equal(
      derivedState.webSearchProviderSelectionState.selectedProvider?.id,
      'serpapi',
    );
    assert.equal(
      derivedState.webSearchProviderSelectionState.selectedProviderDraft?.apiKeySource,
      'SERPAPI_KEY',
    );
    assert.equal(derivedState.providerDialogPresentation.requestParseError, null);
    assert.equal(derivedState.availableAgentModelOptions.length, 2);
    assert.equal(derivedState.readonlyChannelWorkspaceItems.length, 2);
    assert.equal(derivedState.configChannelWorkspaceItems.length, 1);
    assert.equal(derivedState.configChannelWorkspaceItems[0]?.description, 'Runtime Slack channel');
    assert.equal(derivedState.configChannelWorkspaceItems[0]?.values.token, 'draft-token');
  },
);

await runTest(
  'buildInstanceDetailDerivedState exposes canonical configFilePath and drops the legacy config alias field',
  () => {
    const workbench = createWorkbench();
    const derivedState = buildInstanceDetailDerivedState({
      id: 'instance-1',
      workbench,
      selectedProviderId: null,
      providerDeleteId: null,
      providerModelDeleteId: null,
      providerDrafts: {},
      providerRequestDrafts: {},
      selectedConfigChannelId: null,
      configChannelDrafts: {},
      selectedWebSearchProviderId: null,
      webSearchProviderDrafts: {},
      providerDialogDraft: {
        id: '',
        name: '',
        endpoint: '',
        apiKeySource: '',
        defaultModelId: '',
        reasoningModelId: '',
        embeddingModelId: '',
        modelsText: '',
        requestOverridesText: '',
      },
      t: (key: string) => key,
    });

    assert.equal(
      (derivedState as any).configFilePath,
      'D:/OpenClaw/.openclaw/openclaw.json',
    );
    assert.equal('managedConfigPath' in derivedState, false);
  },
);

await runTest(
  'buildInstanceDetailDerivedState reconstructs canonical built-in OpenClaw config metadata from drifted detail targets',
  () => {
    const workbench = createWorkbench();
    const driftedConfigFilePath =
      'C:/ProgramData/SdkWork/CrawStudio/state/kernels/openclaw/noncanonical-config/openclaw.json';
    const canonicalConfigFilePath =
      'C:/Users/admin/.sdkwork/crawstudio/.openclaw/openclaw.json';
    const canonicalWorkspacePath =
      'C:/Users/admin/.sdkwork/crawstudio/.openclaw/workspace';

    workbench.kernelConfig = null;
    workbench.detail.dataAccess.routes = [
      {
        id: 'config-managed',
        scope: 'config',
        mode: 'managedFile',
        readonly: false,
        target: driftedConfigFilePath,
      },
      {
        id: 'workspace-root',
        scope: 'files',
        mode: 'managedDirectory',
        readonly: false,
        target: canonicalWorkspacePath,
      },
    ];
    workbench.detail.artifacts = [
      {
        id: 'config-file',
        kind: 'configFile',
        location: driftedConfigFilePath,
      },
      {
        id: 'workspace-root',
        kind: 'workspaceDirectory',
        location: canonicalWorkspacePath,
      },
    ];

    const derivedState = buildInstanceDetailDerivedState({
      id: 'instance-1',
      workbench,
      selectedProviderId: null,
      providerDeleteId: null,
      providerModelDeleteId: null,
      providerDrafts: {},
      providerRequestDrafts: {},
      selectedConfigChannelId: null,
      configChannelDrafts: {},
      selectedWebSearchProviderId: null,
      webSearchProviderDrafts: {},
      providerDialogDraft: {
        id: '',
        name: '',
        endpoint: '',
        apiKeySource: '',
        defaultModelId: '',
        reasoningModelId: '',
        embeddingModelId: '',
        modelsText: '',
        requestOverridesText: '',
      },
      t: (key: string) => key,
    });

    assert.equal(derivedState.configFilePath, canonicalConfigFilePath);
    assert.equal(derivedState.isOpenClawConfigWritable, true);
    assert.equal(
      derivedState.detail?.dataAccess.routes.find((route) => route.scope === 'config')?.target,
      canonicalConfigFilePath,
    );
    assert.equal(
      derivedState.detail?.artifacts.find((artifact) => artifact.kind === 'configFile')?.location,
      canonicalConfigFilePath,
    );
    assert.equal(
      derivedState.managementSummary?.entries.find((entry) => entry.id === 'kernelConfig')?.value,
      canonicalConfigFilePath,
    );
    assert.equal(derivedState.workbench?.kernelConfig?.configFile, canonicalConfigFilePath);
  },
);

await runTest(
  'buildInstanceDetailDerivedState rewrites stale workbench kernelConfig paths from canonical detail projection',
  () => {
    const workbench = createWorkbench();
    const driftedConfigFilePath =
      'C:/ProgramData/SdkWork/CrawStudio/state/kernels/openclaw/noncanonical-config/openclaw.json';
    const canonicalConfigFilePath =
      'C:/Users/admin/.sdkwork/crawstudio/.openclaw/openclaw.json';
    const canonicalWorkspacePath =
      'C:/Users/admin/.sdkwork/crawstudio/.openclaw/workspace';

    workbench.kernelConfig = {
      ...workbench.kernelConfig,
      configFile: driftedConfigFilePath,
      configRoot: 'C:/ProgramData/SdkWork/CrawStudio/state/kernels/openclaw/noncanonical-config',
      userRoot: 'C:/ProgramData/SdkWork/CrawStudio/state/kernels/openclaw',
      standardConfigFile: canonicalConfigFilePath,
      standardStateRoot: 'C:/Users/admin/.sdkwork/crawstudio/.openclaw',
      isStandardUserRootLayout: false,
    };
    workbench.detail.dataAccess.routes = [
      {
        id: 'config-managed',
        scope: 'config',
        mode: 'managedFile',
        readonly: false,
        target: driftedConfigFilePath,
      },
      {
        id: 'workspace-root',
        scope: 'files',
        mode: 'managedDirectory',
        readonly: false,
        target: canonicalWorkspacePath,
      },
    ];
    workbench.detail.artifacts = [
      {
        id: 'config-file',
        kind: 'configFile',
        location: driftedConfigFilePath,
      },
      {
        id: 'workspace-root',
        kind: 'workspaceDirectory',
        location: canonicalWorkspacePath,
      },
    ];

    const derivedState = buildInstanceDetailDerivedState({
      id: 'instance-1',
      workbench,
      selectedProviderId: null,
      providerDeleteId: null,
      providerModelDeleteId: null,
      providerDrafts: {},
      providerRequestDrafts: {},
      selectedConfigChannelId: null,
      configChannelDrafts: {},
      selectedWebSearchProviderId: null,
      webSearchProviderDrafts: {},
      providerDialogDraft: {
        id: '',
        name: '',
        endpoint: '',
        apiKeySource: '',
        defaultModelId: '',
        reasoningModelId: '',
        embeddingModelId: '',
        modelsText: '',
        requestOverridesText: '',
      },
      t: (key) => key,
    });

    assert.equal(derivedState.configFilePath, canonicalConfigFilePath);
    assert.equal(derivedState.detail?.dataAccess.routes[0]?.target, canonicalConfigFilePath);
    assert.equal(
      derivedState.detail?.artifacts.find((artifact) => artifact.kind === 'configFile')?.location,
      canonicalConfigFilePath,
    );
    assert.equal(
      derivedState.managementSummary?.entries.find((entry) => entry.id === 'kernelConfig')?.value,
      canonicalConfigFilePath,
    );
  },
);

await runTest(
  'buildInstanceDetailDerivedState gates editing from kernel config and authority instead of legacy configFilePath heuristics',
  () => {
    const workbench = createWorkbench();
    workbench.kernelConfig = {
      configFile: 'D:/OpenClaw/.openclaw/openclaw.json',
      configRoot: 'D:/OpenClaw/.openclaw',
      userRoot: 'D:/OpenClaw',
      format: 'json',
      access: 'localFs',
      provenance: 'standardUserRoot',
      writable: false,
      resolved: true,
      schemaVersion: null,
    };
    workbench.kernelAuthority = {
      owner: 'appManaged',
      controlPlane: 'desktopHost',
      lifecycleControl: true,
      configControl: false,
      upgradeControl: true,
      doctorSupport: true,
      migrationSupport: true,
      observable: true,
      writable: false,
    };

    const derivedState = buildInstanceDetailDerivedState({
      id: 'instance-1',
      workbench,
      selectedProviderId: null,
      providerDeleteId: null,
      providerModelDeleteId: null,
      providerDrafts: {},
      providerRequestDrafts: {},
      selectedConfigChannelId: null,
      configChannelDrafts: {},
      selectedWebSearchProviderId: null,
      webSearchProviderDrafts: {},
      providerDialogDraft: {
        id: '',
        name: '',
        endpoint: '',
        apiKeySource: '',
        defaultModelId: '',
        reasoningModelId: '',
        embeddingModelId: '',
        modelsText: '',
        requestOverridesText: '',
      },
      t: (key: string) => key,
    });

    assert.equal(derivedState.isOpenClawConfigWritable, false);
    assert.equal(derivedState.canEditConfigChannels, false);
    assert.equal(derivedState.canEditConfigWebSearch, false);
    assert.equal(derivedState.isProviderConfigReadonly, false);
  },
);

await runTest(
  'buildInstanceDetailDerivedState treats built-in detail metadata as authoritative for destructive actions when the snapshot instance omits isBuiltIn',
  () => {
    const workbench = createWorkbench();
    delete workbench.instance.isBuiltIn;

    const derivedState = buildInstanceDetailDerivedState({
      id: 'instance-1',
      workbench,
      selectedProviderId: null,
      providerDeleteId: null,
      providerModelDeleteId: null,
      providerDrafts: {},
      providerRequestDrafts: {},
      selectedConfigChannelId: null,
      configChannelDrafts: {},
      selectedWebSearchProviderId: null,
      webSearchProviderDrafts: {},
      providerDialogDraft: {
        id: '',
        name: '',
        endpoint: '',
        apiKeySource: '',
        defaultModelId: '',
        reasoningModelId: '',
        embeddingModelId: '',
        modelsText: '',
        requestOverridesText: '',
      },
      t: (key: string) => key,
    });

    assert.equal(workbench.detail.instance.isBuiltIn, true);
    assert.equal(workbench.instance.isBuiltIn, undefined);
    assert.equal(derivedState.canDelete, false);
  },
);
