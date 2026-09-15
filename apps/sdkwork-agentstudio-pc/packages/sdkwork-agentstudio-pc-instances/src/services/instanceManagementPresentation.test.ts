// WORKSPACE-PATH:allow-fixture: fixtures name a foreign checkout root, drive, or home directory to exercise path handling, so the literal is the value under assertion rather than a binding this build resolves
import assert from 'node:assert/strict';
import {
  DEFAULT_BUNDLED_OPENCLAW_VERSION,
  type StudioInstanceDetailRecord,
} from '@sdkwork/agentstudio-pc-types';
import type { InstanceWorkbenchSnapshot } from '../types/index.ts';
import { buildInstanceManagementSummary } from './instanceManagementPresentation.ts';

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

function createDetail(overrides: Partial<StudioInstanceDetailRecord> = {}): StudioInstanceDetailRecord {
  return {
    instance: {
      id: 'openclaw-instance',
      name: 'OpenClaw Instance',
      runtimeKind: 'openclaw',
      deploymentMode: 'local-managed',
      transportKind: 'openclawGatewayWs',
      status: 'online',
      isBuiltIn: true,
      isDefault: true,
      iconType: 'server',
      version: DEFAULT_BUNDLED_OPENCLAW_VERSION,
      typeLabel: 'OpenClaw Gateway',
      host: '127.0.0.1',
      port: 21280,
      baseUrl: 'http://127.0.0.1:21280',
      websocketUrl: 'ws://127.0.0.1:21280',
      cpu: 12,
      memory: 28,
      totalMemory: '32 GB',
      uptime: '12h',
      capabilities: ['chat', 'health', 'files', 'models', 'tasks', 'tools'],
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
        baseUrl: 'http://127.0.0.1:21280',
        websocketUrl: 'ws://127.0.0.1:21280',
        authToken: 'token',
      },
      createdAt: 1,
      updatedAt: 1,
      lastSeenAt: 1,
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
    logs: '',
    health: {
      score: 92,
      status: 'healthy',
      checks: [],
      evaluatedAt: 1,
    },
    lifecycle: {
      owner: 'appManaged',
      startStopSupported: true,
      configWritable: true,
      notes: ['Agent Studio manages the built-in OpenClaw runtime.'],
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
    consoleAccess: {
      kind: 'openclawControlUi',
      available: true,
      url: 'http://127.0.0.1:21280/ui',
      autoLoginUrl: 'http://127.0.0.1:21280/ui/autologin',
      gatewayUrl: 'http://127.0.0.1:21280',
      authMode: 'token',
      authSource: 'configFile',
      installMethod: 'pnpm',
      reason: null,
    },
    workbench: null,
    ...overrides,
  };
}

function createWorkbench(
  overrides: Partial<InstanceWorkbenchSnapshot> = {},
): InstanceWorkbenchSnapshot {
  return {
    instance: {
      id: 'openclaw-instance',
      name: 'OpenClaw Instance',
      type: 'OpenClaw Gateway',
      iconType: 'server',
      status: 'online',
      version: DEFAULT_BUNDLED_OPENCLAW_VERSION,
      uptime: '12h',
      ip: '127.0.0.1',
      cpu: 12,
      memory: 28,
      totalMemory: '32 GB',
    },
    config: {
      port: '21280',
      sandbox: true,
      autoUpdate: true,
      logLevel: 'info',
      corsOrigins: '*',
    },
    token: 'token',
    logs: '',
    detail: createDetail(),
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
    configChannels: [],
    kernelConfigInsights: null,
    healthScore: 92,
    runtimeStatus: 'healthy',
    connectedChannelCount: 2,
    activeTaskCount: 1,
    installedSkillCount: 3,
    readyToolCount: 4,
    sectionCounts: {
      overview: 1,
      channels: 2,
      cronTasks: 1,
      llmProviders: 1,
      agents: 1,
      skills: 3,
      files: 2,
      memory: 0,
      tools: 4,
      config: 1,
    },
    sectionAvailability: {
      overview: { status: 'ready', detail: 'ready' },
      channels: { status: 'ready', detail: 'ready' },
      cronTasks: { status: 'ready', detail: 'ready' },
      llmProviders: { status: 'ready', detail: 'ready' },
      agents: { status: 'ready', detail: 'ready' },
      skills: { status: 'ready', detail: 'ready' },
      files: { status: 'ready', detail: 'ready' },
      memory: { status: 'planned', detail: 'planned' },
      tools: { status: 'ready', detail: 'ready' },
      config: { status: 'ready', detail: 'ready' },
    },
    channels: [],
    tasks: [],
    agents: [
      {
        agent: {
          id: 'main',
          name: 'Main',
          description: 'Default agent',
          avatar: 'M',
          systemPrompt: 'Main agent',
          creator: 'OpenClaw',
        },
        focusAreas: ['Generalist'],
        automationFitScore: 72,
        workspace: 'D:/OpenClaw/.openclaw/workspace',
        agentDir: 'D:/OpenClaw/.openclaw/agents/main/agent',
        isDefault: true,
        model: {
          primary: 'api-router/gpt-5.4',
          fallbacks: [],
        },
      },
    ],
    skills: [],
    files: [],
    llmProviders: [],
    memories: [],
    tools: [],
    ...overrides,
  };
}

await runTest(
  'buildInstanceManagementSummary highlights Provider Center routing for fully app-managed built-in OpenClaw instances',
  () => {
    const summary = buildInstanceManagementSummary(createWorkbench());

    assert.deepEqual(summary.entries.map((entry) => entry.id), [
      'controlPlane',
      'installMethod',
      'kernelConfig',
      'defaultWorkspace',
      'managementScope',
    ]);
    assert.equal(
      summary.entries.find((entry) => entry.id === 'controlPlane')?.value,
      'App Managed / Local Managed',
    );
    assert.equal(summary.entries.find((entry) => entry.id === 'installMethod')?.value, 'pnpm');
    assert.equal(
      summary.entries.find((entry) => entry.id === 'kernelConfig')?.value,
      'D:/OpenClaw/.openclaw/openclaw.json',
    );
    assert.equal(
      summary.entries.find((entry) => entry.id === 'kernelConfig')?.detailKey,
      'instances.detail.instanceWorkbench.overview.management.details.configManagedFile',
    );
    assert.equal(summary.entries.find((entry) => entry.id === 'kernelConfig')?.mono, true);
    assert.equal(
      summary.entries.find((entry) => entry.id === 'defaultWorkspace')?.value,
      'D:/OpenClaw/.openclaw/workspace',
    );
    assert.equal(
      summary.entries.find((entry) => entry.id === 'managementScope')?.value,
      'Provider Center + config workspace',
    );
    assert.deepEqual(summary.notes, ['Agent Studio manages the built-in OpenClaw runtime.']);
  },
);

await runTest(
  'buildInstanceManagementSummary falls back to partial runtime control when no OpenClaw config file is attached',
  () => {
    const detail = createDetail({
      instance: {
        ...createDetail().instance,
        isBuiltIn: false,
        isDefault: false,
        deploymentMode: 'remote',
        host: '10.0.0.8',
      },
      lifecycle: {
        owner: 'remoteService',
        startStopSupported: false,
        configWritable: false,
        lifecycleControllable: false,
        workbenchManaged: false,
        endpointObserved: false,
        notes: [],
      },
      dataAccess: {
        routes: [
          {
            id: 'config-api',
            label: 'Config API',
            scope: 'config',
            mode: 'remoteEndpoint',
            status: 'ready',
            target: 'https://gateway.example.com/admin/config',
            readonly: false,
            authoritative: true,
            detail: 'Remote config endpoint.',
            source: 'runtime',
          },
        ],
      },
      artifacts: [
        {
          id: 'workspace-root',
          label: 'Workspace Root',
          kind: 'workspaceDirectory',
          status: 'remote',
          location: '/srv/openclaw/workspace-main',
          readonly: false,
          detail: 'Remote workspace mount.',
          source: 'runtime',
        },
      ],
      consoleAccess: {
        kind: 'openclawControlUi',
        available: true,
        url: 'https://gateway.example.com/ui',
        autoLoginUrl: null,
        gatewayUrl: 'https://gateway.example.com',
        authMode: 'token',
        authSource: 'workspaceConfig',
        installMethod: 'docker',
        reason: null,
      },
    });
    const summary = buildInstanceManagementSummary(
      createWorkbench({
        detail,
        kernelConfig: null,
        agents: [],
      }),
    );

    assert.equal(
      summary.entries.find((entry) => entry.id === 'controlPlane')?.value,
      'Remote Service / Remote',
    );
    assert.equal(summary.entries.find((entry) => entry.id === 'installMethod')?.value, 'Docker');
    assert.equal(
      summary.entries.find((entry) => entry.id === 'kernelConfig')?.value,
      'https://gateway.example.com/admin/config',
    );
    assert.equal(
      summary.entries.find((entry) => entry.id === 'kernelConfig')?.detailKey,
      'instances.detail.instanceWorkbench.overview.management.details.configRemoteEndpoint',
    );
    assert.equal(summary.entries.find((entry) => entry.id === 'kernelConfig')?.tone, 'warning');
    assert.equal(
      summary.entries.find((entry) => entry.id === 'defaultWorkspace')?.value,
      '/srv/openclaw/workspace-main',
    );
    assert.equal(
      summary.entries.find((entry) => entry.id === 'managementScope')?.value,
      'Partial runtime control',
    );
  },
);

await runTest(
  'buildInstanceManagementSummary reports partial runtime control for workbench-controlled OpenClaw without a local config file attachment',
  () => {
    const detail = createDetail({
      lifecycle: {
        owner: 'appManaged',
        startStopSupported: false,
        configWritable: true,
        lifecycleControllable: false,
        workbenchManaged: true,
        endpointObserved: true,
        notes: ['Workbench is managed through the hosted control plane.'],
      },
    });
    const summary = buildInstanceManagementSummary(
      createWorkbench({
        detail,
        kernelConfig: null,
      }),
    );

    assert.equal(
      summary.entries.find((entry) => entry.id === 'managementScope')?.value,
      'Partial runtime control',
    );
  },
);

await runTest(
  'buildInstanceManagementSummary surfaces the attached built-in OpenClaw config route when the workbench projection is not precomputed',
  () => {
    const standardWorkspacePath = 'C:/Users/admin/.openclaw/workspace';
    const standardConfigFilePath = 'C:/Users/admin/.openclaw/openclaw.json';
    const detail = createDetail({
      dataAccess: {
        routes: [
          {
            scope: 'config',
            mode: 'managedFile',
            target: standardConfigFilePath,
            readonly: false,
          },
          {
            scope: 'files',
            mode: 'managedDirectory',
            target: standardWorkspacePath,
            readonly: false,
          },
        ],
      },
    });

    const summary = buildInstanceManagementSummary(
      createWorkbench({
        detail,
        kernelConfig: null,
      }),
    );

    assert.equal(
      summary.entries.find((entry) => entry.id === 'kernelConfig')?.value,
      standardConfigFilePath,
    );
    assert.equal(
      summary.entries.find((entry) => entry.id === 'kernelConfig')?.detailKey,
      'instances.detail.instanceWorkbench.overview.management.details.configManagedFile',
    );
  },
);

await runTest(
  'buildInstanceManagementSummary reports partial runtime control for non-OpenClaw instances when a writable remote management surface is exposed',
  () => {
    const detail = createDetail({
      instance: {
        ...createDetail().instance,
        id: 'custom-managed-instance',
        name: 'Custom Managed Instance',
        runtimeKind: 'custom',
        deploymentMode: 'remote',
        transportKind: 'customHttp',
        isBuiltIn: false,
        isDefault: false,
        version: 'custom-runtime-1',
        typeLabel: 'Custom Remote Runtime',
        host: '10.0.0.42',
        port: 8080,
        baseUrl: 'https://runtime.example.com/v1',
        websocketUrl: null,
      },
      lifecycle: {
        owner: 'remoteService',
        startStopSupported: false,
        configWritable: false,
        lifecycleControllable: false,
        workbenchManaged: false,
        endpointObserved: true,
        notes: ['Remote control plane exposes a writable management surface.'],
      },
      dataAccess: {
        routes: [
          {
            id: 'config-api',
            label: 'Config API',
            scope: 'config',
            mode: 'remoteEndpoint',
            status: 'ready',
            target: 'https://runtime.example.com/admin/config',
            readonly: false,
            authoritative: true,
            detail: 'Remote config endpoint.',
            source: 'runtime',
          },
        ],
      },
      consoleAccess: null,
      officialRuntimeNotes: [
        {
          title: 'Remote Runtime',
          content: 'Managed over HTTPS',
        },
      ],
    });

    const summary = buildInstanceManagementSummary(
      createWorkbench({
        detail,
        kernelConfig: null,
        agents: [],
      }),
    );

    assert.equal(
      summary.entries.find((entry) => entry.id === 'managementScope')?.value,
      'Partial runtime control',
    );
  },
);

await runTest(
  'buildInstanceManagementSummary does not infer partial runtime control from local-managed deployment metadata alone',
  () => {
    const detail = createDetail({
      lifecycle: {
        owner: 'appManaged',
        startStopSupported: false,
        configWritable: false,
        notes: [],
      },
      workbench: {} as any,
      consoleAccess: {
        kind: 'openclawControlUi',
        available: false,
        url: null,
        autoLoginUrl: null,
        gatewayUrl: null,
        authMode: 'none',
        authSource: 'runtime',
        installMethod: null,
        reason: 'No writable control plane is attached.',
      },
    });

    const summary = buildInstanceManagementSummary(
      createWorkbench({
        detail,
        kernelConfig: null,
      }),
    );

    assert.equal(
      summary.entries.find((entry) => entry.id === 'managementScope')?.value,
      'Read-only discovery',
    );
  },
);

await runTest(
  'buildInstanceManagementSummary keeps registry-backed metadata-only OpenClaw fallback in read-only discovery scope',
  () => {
    const detail = createDetail({
      instance: {
        ...createDetail().instance,
        isBuiltIn: false,
        isDefault: false,
        deploymentMode: 'remote',
        host: '10.0.0.9',
      },
      lifecycle: {
        owner: 'remoteService',
        startStopSupported: false,
        configWritable: false,
        lifecycleControllable: false,
        workbenchManaged: false,
        endpointObserved: false,
        notes: ['Registry-backed detail projection.'],
      },
      dataAccess: {
        routes: [
          {
            id: 'config',
            label: 'Configuration',
            scope: 'config',
            mode: 'metadataOnly',
            status: 'ready',
            target: 'studio.instances registry metadata',
            readonly: false,
            authoritative: false,
            detail: 'Registry-backed detail projects configuration from Agent Studio metadata.',
            source: 'integration',
          },
        ],
      },
      consoleAccess: null,
    });

    const summary = buildInstanceManagementSummary(
      createWorkbench({
        detail,
        kernelConfig: null,
        agents: [],
      }),
    );

    assert.equal(
      summary.entries.find((entry) => entry.id === 'managementScope')?.value,
      'Read-only discovery',
    );
  },
);

await runTest(
  'buildInstanceManagementSummary surfaces built-in OpenClaw startup failures with actionable readiness-timeout diagnostics',
  () => {
    const startupError =
      'timeout: openclaw gateway did not become ready on 127.0.0.1:18871 within 30000ms';
    const detail = createDetail({
      observability: {
        ...createDetail().observability,
        logFilePath: 'D:/OpenClaw/.openclaw/logs/openclaw-gateway.log',
      },
      artifacts: [
        {
          id: 'desktop-main-log-file',
          label: 'Desktop Main Log',
          kind: 'logFile',
          status: 'available',
          location: 'D:/OpenClaw/.openclaw/logs/app.log',
          readonly: true,
          detail: 'Agent Studio desktop shell log with bootstrap and supervisor events.',
          source: 'runtime',
        },
      ],
      lifecycle: {
        ...createDetail().lifecycle,
        lastActivationStage: 'prepareConfig',
        lastError: startupError,
        notes: [
          'Agent Studio manages the built-in OpenClaw runtime.',
          'Last built-in OpenClaw activation detail stage: Gateway Configured',
          `Last built-in OpenClaw start error: ${startupError}`,
        ],
      },
    });
    const summary = buildInstanceManagementSummary(
      createWorkbench({
        detail,
      }),
    );

    assert.deepEqual(summary.alert, {
      tone: 'warning',
      titleKey:
        'instances.detail.instanceWorkbench.overview.management.alerts.bundledStartupFailure.title',
      detailKey:
        'instances.detail.instanceWorkbench.overview.management.alerts.bundledStartupFailure.description',
      message: startupError,
      recommendedActionDetailKey:
        'instances.detail.instanceWorkbench.overview.management.alerts.bundledStartupFailure.actions.gatewayReadinessTimeout',
      diagnostics: [
        {
          id: 'lastActivationStage',
          labelKey:
            'instances.detail.instanceWorkbench.overview.management.alerts.bundledStartupFailure.diagnostics.lastActivationStage.label',
          detailKey:
            'instances.detail.instanceWorkbench.overview.management.alerts.bundledStartupFailure.diagnostics.lastActivationStage.description',
          value: 'Gateway Configured',
        },
        {
          id: 'gatewayLogPath',
          labelKey:
            'instances.detail.instanceWorkbench.overview.management.alerts.bundledStartupFailure.diagnostics.gatewayLogPath.label',
          detailKey:
            'instances.detail.instanceWorkbench.overview.management.alerts.bundledStartupFailure.diagnostics.gatewayLogPath.description',
          value: 'D:/OpenClaw/.openclaw/logs/openclaw-gateway.log',
          mono: true,
        },
        {
          id: 'desktopMainLogPath',
          labelKey:
            'instances.detail.instanceWorkbench.overview.management.alerts.bundledStartupFailure.diagnostics.desktopMainLogPath.label',
          detailKey:
            'instances.detail.instanceWorkbench.overview.management.alerts.bundledStartupFailure.diagnostics.desktopMainLogPath.description',
          value: 'D:/OpenClaw/.openclaw/logs/app.log',
          mono: true,
        },
      ],
    });
    assert.deepEqual(summary.notes, ['Agent Studio manages the built-in OpenClaw runtime.']);
  },
);

await runTest(
  'buildInstanceManagementSummary recommends checking file locks when built-in startup fails with access denied',
  () => {
    const startupError =
      'failed to finalize bundled runtime install root D:/OpenClaw/runtimes/openclaw: 拒绝访问。 (os error 5)';
    const detail = createDetail({
      observability: {
        ...createDetail().observability,
        logFilePath: 'D:/OpenClaw/.openclaw/logs/openclaw-gateway.log',
      },
      artifacts: [
        {
          id: 'desktop-main-log-file',
          label: 'Desktop Main Log',
          kind: 'logFile',
          status: 'available',
          location: 'D:/OpenClaw/.openclaw/logs/app.log',
          readonly: true,
          detail: 'Agent Studio desktop shell log with bootstrap and supervisor events.',
          source: 'runtime',
        },
      ],
      lifecycle: {
        ...createDetail().lifecycle,
        lastActivationStage: 'prepareInstall',
        lastError: startupError,
        notes: [
          'Agent Studio manages the built-in OpenClaw runtime.',
          'Last built-in OpenClaw activation detail stage: Prepare Runtime Activation',
          `Last built-in OpenClaw start error: ${startupError}`,
        ],
      },
    });

    const summary = buildInstanceManagementSummary(
      createWorkbench({
        detail,
      }),
    );

    assert.deepEqual(summary.alert, {
      tone: 'warning',
      titleKey:
        'instances.detail.instanceWorkbench.overview.management.alerts.bundledStartupFailure.title',
      detailKey:
        'instances.detail.instanceWorkbench.overview.management.alerts.bundledStartupFailure.description',
      message: startupError,
      recommendedActionDetailKey:
        'instances.detail.instanceWorkbench.overview.management.alerts.bundledStartupFailure.actions.runtimeAccessDenied',
      diagnostics: [
        {
          id: 'lastActivationStage',
          labelKey:
            'instances.detail.instanceWorkbench.overview.management.alerts.bundledStartupFailure.diagnostics.lastActivationStage.label',
          detailKey:
            'instances.detail.instanceWorkbench.overview.management.alerts.bundledStartupFailure.diagnostics.lastActivationStage.description',
          value: 'Prepare Runtime Activation',
        },
        {
          id: 'gatewayLogPath',
          labelKey:
            'instances.detail.instanceWorkbench.overview.management.alerts.bundledStartupFailure.diagnostics.gatewayLogPath.label',
          detailKey:
            'instances.detail.instanceWorkbench.overview.management.alerts.bundledStartupFailure.diagnostics.gatewayLogPath.description',
          value: 'D:/OpenClaw/.openclaw/logs/openclaw-gateway.log',
          mono: true,
        },
        {
          id: 'desktopMainLogPath',
          labelKey:
            'instances.detail.instanceWorkbench.overview.management.alerts.bundledStartupFailure.diagnostics.desktopMainLogPath.label',
          detailKey:
            'instances.detail.instanceWorkbench.overview.management.alerts.bundledStartupFailure.diagnostics.desktopMainLogPath.description',
          value: 'D:/OpenClaw/.openclaw/logs/app.log',
          mono: true,
        },
      ],
    });
  },
);
