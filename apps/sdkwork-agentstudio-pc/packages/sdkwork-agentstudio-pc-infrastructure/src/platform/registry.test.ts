// WORKSPACE-PATH:allow-fixture: fixtures name a foreign checkout root, drive, or home directory to exercise path handling, so the literal is the value under assertion rather than a binding this build resolves
import assert from 'node:assert/strict';
import {
  DEFAULT_REQUIRED_OPENCLAW_NODE_VERSION,
  type StudioInstanceDetailRecord,
} from '@sdkwork/agentstudio-pc-types';
import {
  bootstrapServerBrowserPlatformBridge,
  STUDIO_DETAIL_CACHE_TTL_MS,
  configureServerBrowserPlatformBridge,
  configurePlatformBridge,
  getPlatformBridge,
  internal,
  installer,
  kernel,
  manage,
  runtime,
  studio,
} from './index.ts';

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

function sleep(ms: number) {
  return new Promise<void>((resolve) => {
    setTimeout(resolve, ms);
  });
}

function createMetaDocument(meta: Record<string, string>) {
  return {
    querySelector(selector: string) {
      const metaNamePrefix = 'meta[name="';
      if (!selector.startsWith(metaNamePrefix) || !selector.endsWith('"]')) {
        return null;
      }

      const name = selector.slice(metaNamePrefix.length, -2);
      const content = meta[name];

      if (content === undefined) {
        return null;
      }

      return {
        getAttribute(attribute: string) {
          return attribute === 'content' ? content : null;
        },
      };
    },
  };
}

function createJsonResponse(payload: unknown) {
  return {
    ok: true,
    status: 200,
    statusText: 'OK',
    headers: {
      get(name: string) {
        return name.toLowerCase() === 'content-type' ? 'application/json' : null;
      },
    },
    async json() {
      return payload;
    },
    async text() {
      return JSON.stringify(payload);
    },
  };
}

function createInstanceDetail(id: string): StudioInstanceDetailRecord {
  return {
    instance: {
      id,
      name: `Instance ${id}`,
      description: 'Cached instance detail fixture.',
      runtimeKind: 'openclaw',
      deploymentMode: 'local-managed',
      transportKind: 'openclawGatewayWs',
      status: 'online',
      isBuiltIn: false,
      isDefault: false,
      iconType: 'server',
      version: '2026.03.31',
      typeLabel: 'OpenClaw',
      host: '127.0.0.1',
      port: 21280,
      baseUrl: 'http://127.0.0.1:21280',
      websocketUrl: 'ws://127.0.0.1:21280',
      cpu: 0,
      memory: 0,
      totalMemory: '0 GB',
      uptime: '0m',
      capabilities: [],
      storage: {
        provider: 'localFile',
        namespace: id,
      },
      config: {
        port: '21280',
        sandbox: true,
        autoUpdate: true,
        logLevel: 'info',
        corsOrigins: '*',
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
    },
    logs: '',
    health: {
      score: 100,
      status: 'healthy',
      checks: [],
      evaluatedAt: 1,
    },
    lifecycle: {
      owner: 'appSupervisor',
      startStopSupported: true,
      configWritable: true,
      notes: [],
    },
    storage: {
      status: 'ready',
      provider: 'localFile',
      namespace: id,
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
      supported: false,
      entries: [],
    },
    workbench: null,
  };
}

function createKernelStatus(callId: number) {
  return {
    topology: {
      kind: 'localManagedNative',
      state: 'installed',
      label: `Built-In Runtime ${callId}`,
      recommended: true,
    },
    runtime: {
      state: 'running',
      health: 'healthy',
      reason: `Kernel status ${callId}`,
      startedBy: 'appSupervisor',
      lastTransitionAt: callId,
    },
    endpoint: {
      preferredPort: 21280,
      activePort: 18800 + callId,
      baseUrl: `http://127.0.0.1:${18800 + callId}`,
      websocketUrl: `ws://127.0.0.1:${18800 + callId}`,
      loopbackOnly: true,
      dynamicPort: true,
      endpointSource: 'allocated',
    },
    host: {
      serviceManager: 'tauriSupervisor',
      ownership: 'appSupervisor',
      serviceName: 'agentstudioOpenClawKernel',
      serviceConfigPath:
        'C:/ProgramData/SdkWork/CrawStudio/machine/state/kernel-host/windows-service.json',
      startupMode: 'auto',
      attachSupported: true,
      repairSupported: true,
      controlSocket: null,
    },
    provenance: {
      runtimeId: 'openclaw',
      installKey: `install-${callId}`,
      openclawVersion: `2026.04.${String(callId).padStart(2, '0')}`,
      nodeVersion: DEFAULT_REQUIRED_OPENCLAW_NODE_VERSION,
      platform: 'windows',
      arch: 'x64',
      installSource: 'bundled',
      configFile: 'C:/Users/admin/.openclaw/openclaw.json',
      runtimeHomeDir: 'C:/Users/admin',
      runtimeInstallDir:
        `C:/Program Files/SdkWork/CrawStudio/runtimes/openclaw/install-${callId}`,
    },
  } as const;
}

function createInstallAssessment(callId: number) {
  return {
    registryName: 'remote-catalog',
    registrySource: 'bundled',
    softwareName: 'openclaw',
    manifestSource: 'bundled',
    manifestName: 'openclaw-host',
    ready: true,
    requiresElevatedSetup: false,
    platform: 'windows',
    effectiveRuntimePlatform: 'windows',
    resolvedInstallScope: 'user',
    resolvedInstallRoot: `C:/Runtime/${callId}`,
    resolvedWorkRoot: 'C:/Runtime/work',
    resolvedBinDir: 'C:/Runtime/bin',
    resolvedDataRoot: 'C:/Runtime/data',
    installControlLevel: 'managed',
    installStatus: callId === 1 ? 'uninstalled' : 'installed',
    dependencies: [],
    issues: [],
    recommendations: [],
    dataItems: [],
    migrationStrategies: [],
    runtime: {
      hostPlatform: 'windows',
      requestedRuntimePlatform: 'windows',
      effectiveRuntimePlatform: 'windows',
      availableWslDistributions: [],
      wslAvailable: false,
      hostDockerAvailable: false,
      wslDockerAvailable: false,
      runtimeHomeDir: 'C:/Users/admin',
      commandAvailability: {},
    },
  } as any;
}

function createInstallResult() {
  return {
    registryName: 'remote-catalog',
    registrySource: 'bundled',
    softwareName: 'openclaw',
    manifestSource: 'bundled',
    manifestName: 'openclaw-host',
    success: true,
    durationMs: 1,
    platform: 'windows',
    effectiveRuntimePlatform: 'windows',
    resolvedInstallScope: 'user',
    resolvedInstallRoot: 'C:/Runtime',
    resolvedWorkRoot: 'C:/Runtime/work',
    resolvedBinDir: 'C:/Runtime/bin',
    resolvedDataRoot: 'C:/Runtime/data',
    installControlLevel: 'managed',
    stageReports: [],
    artifactReports: [],
  } as any;
}

await runTest('studio.getInstanceDetail de-duplicates concurrent lookups for the same instance', async () => {
  const originalBridge = getPlatformBridge();
  let detailCalls = 0;

  configurePlatformBridge({
    studio: {
      ...originalBridge.studio,
      async getInstanceDetail(id) {
        detailCalls += 1;
        await sleep(10);
        return createInstanceDetail(id);
      },
    },
  });

  try {
    const [first, second] = await Promise.all([
      studio.getInstanceDetail('instance-a'),
      studio.getInstanceDetail('instance-a'),
    ]);

    assert.equal(detailCalls, 1);
    assert.equal(first?.instance.id, 'instance-a');
    assert.equal(second?.instance.id, 'instance-a');
  } finally {
    configurePlatformBridge(originalBridge);
  }
});

await runTest('studio.getInstanceDetail refreshes after the short cache window expires', async () => {
  const originalBridge = getPlatformBridge();
  let detailCalls = 0;

  configurePlatformBridge({
    studio: {
      ...originalBridge.studio,
      async getInstanceDetail(id) {
        detailCalls += 1;
        return createInstanceDetail(`${id}-${detailCalls}`);
      },
    },
  });

  try {
    const first = await studio.getInstanceDetail('instance-b');
    await sleep(STUDIO_DETAIL_CACHE_TTL_MS + 25);
    const second = await studio.getInstanceDetail('instance-b');

    assert.equal(detailCalls, 2);
    assert.notEqual(first?.instance.id, second?.instance.id);
  } finally {
    configurePlatformBridge(originalBridge);
  }
});

await runTest('kernel platform de-duplicates rapid status reads and invalidates after restart', async () => {
  const originalBridge = getPlatformBridge();
  let statusCalls = 0;
  let restartCalls = 0;

  configurePlatformBridge({
    kernel: {
      ...originalBridge.kernel,
      async getStatus() {
        statusCalls += 1;
        await sleep(10);
        return createKernelStatus(statusCalls) as any;
      },
      async restart() {
        restartCalls += 1;
        return createKernelStatus(99) as any;
      },
    },
  });

  try {
    const [first, second] = await Promise.all([kernel.getStatus(), kernel.getStatus()]);
    await kernel.restart();
    const third = await kernel.getStatus();

    assert.equal(statusCalls, 2);
    assert.equal(restartCalls, 1);
    assert.equal(first?.endpoint.activePort, 18801);
    assert.equal(second?.endpoint.activePort, 18801);
    assert.equal(third?.endpoint.activePort, 18802);
  } finally {
    configurePlatformBridge(originalBridge);
  }
});

await runTest('kernel platform de-duplicates rapid info reads', async () => {
  const originalBridge = getPlatformBridge();
  let infoCalls = 0;

  configurePlatformBridge({
    kernel: {
      ...originalBridge.kernel,
      async getInfo() {
        infoCalls += 1;
        await sleep(10);
        return {
          infoToken: infoCalls,
        } as any;
      },
    },
  });

  try {
    const [first, second] = await Promise.all([kernel.getInfo(), kernel.getInfo()]);

    assert.equal(infoCalls, 1);
    assert.equal((first as any)?.infoToken, 1);
    assert.equal((second as any)?.infoToken, 1);
  } finally {
    configurePlatformBridge(originalBridge);
  }
});

await runTest('runtime platform de-duplicates rapid runtime reads and invalidates after language changes', async () => {
  const originalBridge = getPlatformBridge();
  let runtimeInfoCalls = 0;
  const languageUpdates: string[] = [];

  configurePlatformBridge({
    runtime: {
      ...originalBridge.runtime,
      async getRuntimeInfo() {
        runtimeInfoCalls += 1;
        await sleep(10);
        return {
          platform: 'desktop',
          app: {
            name: 'Agent Studio',
            version: String(runtimeInfoCalls),
            target: 'desktop-x64',
          },
        } as any;
      },
      async setAppLanguage(language) {
        languageUpdates.push(language);
      },
    },
  });

  try {
    const [first, second] = await Promise.all([
      runtime.getRuntimeInfo(),
      runtime.getRuntimeInfo(),
    ]);
    await runtime.setAppLanguage('zh');
    const third = await runtime.getRuntimeInfo();

    assert.equal(runtimeInfoCalls, 2);
    assert.deepEqual(languageUpdates, ['zh']);
    assert.equal(first.app?.version, '1');
    assert.equal(second.app?.version, '1');
    assert.equal(third.app?.version, '2');
  } finally {
    configurePlatformBridge(originalBridge);
  }
});

await runTest('kernel lifecycle actions also invalidate runtime info cache to avoid mixed dashboard snapshots', async () => {
  const originalBridge = getPlatformBridge();
  let runtimeInfoCalls = 0;
  let restartCalls = 0;

  configurePlatformBridge({
    kernel: {
      ...originalBridge.kernel,
      async restart() {
        restartCalls += 1;
        return createKernelStatus(99) as any;
      },
    },
    runtime: {
      ...originalBridge.runtime,
      async getRuntimeInfo() {
        runtimeInfoCalls += 1;
        await sleep(10);
        return {
          platform: 'desktop',
          app: {
            name: 'Agent Studio',
            version: String(runtimeInfoCalls),
            target: 'desktop-x64',
          },
        } as any;
      },
    },
  });

  try {
    const [first, second] = await Promise.all([
      runtime.getRuntimeInfo(),
      runtime.getRuntimeInfo(),
    ]);
    await kernel.restart();
    const third = await runtime.getRuntimeInfo();

    assert.equal(restartCalls, 1);
    assert.equal(runtimeInfoCalls, 2);
    assert.equal(first.app?.version, '1');
    assert.equal(second.app?.version, '1');
    assert.equal(third.app?.version, '2');
  } finally {
    configurePlatformBridge(originalBridge);
  }
});

await runTest('installer platform de-duplicates install inspections and invalidates after installs', async () => {
  const originalBridge = getPlatformBridge();
  let inspectCalls = 0;
  let installCalls = 0;

  configurePlatformBridge({
    installer: {
      ...originalBridge.installer,
      async inspectInstall() {
        inspectCalls += 1;
        await sleep(10);
        return createInstallAssessment(inspectCalls);
      },
      async runInstall() {
        installCalls += 1;
        return createInstallResult();
      },
    },
  });

  try {
    const request = {
      softwareName: 'openclaw',
      effectiveRuntimePlatform: 'windows',
      installScope: 'user',
    } as const;
    const [first, second] = await Promise.all([
      installer.inspectInstall(request),
      installer.inspectInstall(request),
    ]);
    await installer.runInstall(request);
    const third = await installer.inspectInstall(request);

    assert.equal(inspectCalls, 2);
    assert.equal(installCalls, 1);
    assert.equal(first.resolvedInstallRoot, 'C:/Runtime/1');
    assert.equal(second.resolvedInstallRoot, 'C:/Runtime/1');
    assert.equal(third.resolvedInstallRoot, 'C:/Runtime/2');
  } finally {
    configurePlatformBridge(originalBridge);
  }
});

await runTest('installer platform de-duplicates rapid catalog lookups for the same host', async () => {
  const originalBridge = getPlatformBridge();
  let catalogCalls = 0;

  configurePlatformBridge({
    installer: {
      ...originalBridge.installer,
      async listInstallCatalog(query) {
        catalogCalls += 1;
        await sleep(10);
        return [
          {
            appId: 'app-openclaw',
            title: `OpenClaw ${catalogCalls}`,
            developer: 'SdkWork',
            category: 'Runtime',
            summary: 'OpenClaw runtime',
            tags: [],
            defaultVariantId: 'host',
            defaultSoftwareName: 'openclaw',
            supportedHostPlatforms: [query?.hostPlatform ?? 'windows'],
            variants: [],
          },
        ] as any;
      },
    },
  });

  try {
    const [first, second] = await Promise.all([
      installer.listInstallCatalog({ hostPlatform: 'windows' }),
      installer.listInstallCatalog({ hostPlatform: 'windows' }),
    ]);

    assert.equal(catalogCalls, 1);
    assert.equal(first[0]?.title, 'OpenClaw 1');
    assert.equal(second[0]?.title, 'OpenClaw 1');
  } finally {
    configurePlatformBridge(originalBridge);
  }
});

await runTest('server browser bridge installs live manage and internal clients when server metadata is present', async () => {
  const originalBridge = getPlatformBridge();
  const requests: Array<{ input: string; method: string }> = [];

  try {
    const configured = configureServerBrowserPlatformBridge({
      document: createMetaDocument({
        'sdkwork-agentstudio-pc-host-mode': 'server',
        'sdkwork-agentstudio-pc-manage-base-path': '/claw/manage/v1',
        'sdkwork-agentstudio-pc-internal-base-path': '/claw/internal/v1',
      }) as Document,
      fetchImpl: async (input, init) => {
        const inputText = String(input);
        requests.push({
          input: inputText,
          method: init?.method ?? 'GET',
        });

        if (inputText === '/claw/internal/v1/host-platform') {
          return createJsonResponse({
            mode: 'server',
            lifecycle: 'ready',
            hostId: 'server-local',
            displayName: 'Server Combined Host',
            version: 'sdkwork-agentstudio-pc-server@test',
            desiredStateProjectionVersion: 'phase2',
            rolloutEngineVersion: 'phase2',
            manageBasePath: '/claw/manage/v1',
            internalBasePath: '/claw/internal/v1',
            stateStoreDriver: 'json-file',
            stateStore: {
              activeProfileId: 'default-json-file',
              providers: [
                {
                  id: 'json-file',
                  label: 'JSON File Catalogs',
                  availability: 'ready',
                  requiresConfiguration: false,
                  configurationKeys: [],
                },
              ],
              profiles: [
                {
                  id: 'default-json-file',
                  label: 'JSON File Catalogs',
                  driver: 'json-file',
                  active: true,
                  availability: 'ready',
                  path: '.agentstudio-server',
                  connectionConfigured: false,
                  configuredKeys: ['path'],
                },
              ],
            },
            capabilityKeys: ['manage.rollouts.list'],
            updatedAt: 1,
          }) as Response;
        }

        if (inputText === '/claw/internal/v1/node-sessions') {
          return createJsonResponse([]) as Response;
        }

        if (inputText === '/claw/manage/v1/rollouts') {
          return createJsonResponse({
            items: [
              {
                id: 'rollout-a',
                phase: 'ready',
                attempt: 1,
                targetCount: 2,
                updatedAt: 1,
              },
            ],
            total: 1,
          }) as Response;
        }

        throw new Error(`unexpected fetch input: ${inputText}`);
      },
    });

    assert.equal(configured, true);

    const status = await internal.getHostPlatformStatus();
    const sessions = await internal.listNodeSessions();
    const rollouts = await manage.listRollouts();

    assert.equal(status.mode, 'server');
    assert.equal(status.manageBasePath, '/claw/manage/v1');
    assert.equal(status.stateStoreDriver, 'json-file');
    assert.equal(status.stateStore.activeProfileId, 'default-json-file');
    assert.deepEqual(sessions, []);
    assert.equal(rollouts.total, 1);
    assert.deepEqual(requests, [
      {
        input: '/claw/internal/v1/host-platform',
        method: 'GET',
      },
      {
        input: '/claw/internal/v1/node-sessions',
        method: 'GET',
      },
      {
        input: '/claw/manage/v1/rollouts',
        method: 'GET',
      },
    ]);
  } finally {
    configurePlatformBridge(originalBridge);
  }
});

await runTest('server browser bridge also installs live manage and internal clients when desktopCombined metadata is present', async () => {
  const originalBridge = getPlatformBridge();
  const requests: Array<{ input: string; method: string }> = [];

  try {
    const configured = configureServerBrowserPlatformBridge({
      document: createMetaDocument({
        'sdkwork-agentstudio-pc-host-mode': 'desktopCombined',
        'sdkwork-agentstudio-pc-manage-base-path': '/claw/manage/v1',
        'sdkwork-agentstudio-pc-internal-base-path': '/claw/internal/v1',
      }) as Document,
      fetchImpl: async (input, init) => {
        const inputText = String(input);
        requests.push({
          input: inputText,
          method: init?.method ?? 'GET',
        });

        if (inputText === '/claw/internal/v1/host-platform') {
          return createJsonResponse({
            mode: 'desktopCombined',
            lifecycle: 'ready',
            hostId: 'desktop-local',
            displayName: 'Desktop Combined Host',
            version: 'sdkwork-agentstudio-pc-desktop@test',
            desiredStateProjectionVersion: 'phase2',
            rolloutEngineVersion: 'phase2',
            manageBasePath: '/claw/manage/v1',
            internalBasePath: '/claw/internal/v1',
            stateStoreDriver: 'sqlite',
            stateStore: {
              activeProfileId: 'default-sqlite',
              providers: [
                {
                  id: 'sqlite',
                  label: 'SQLite Host State',
                  availability: 'ready',
                  requiresConfiguration: false,
                  configurationKeys: [],
                },
              ],
              profiles: [
                {
                  id: 'default-sqlite',
                  label: 'SQLite Host State',
                  driver: 'sqlite',
                  active: true,
                  availability: 'ready',
                  path: 'desktop-state.sqlite3',
                  connectionConfigured: false,
                  configuredKeys: ['path'],
                },
              ],
            },
            capabilityKeys: ['manage.rollouts.list'],
            updatedAt: 1,
          }) as Response;
        }

        if (inputText === '/claw/internal/v1/node-sessions') {
          return createJsonResponse([]) as Response;
        }

        if (inputText === '/claw/manage/v1/rollouts') {
          return createJsonResponse({
            items: [
              {
                id: 'rollout-desktop-a',
                phase: 'ready',
                attempt: 1,
                targetCount: 1,
                updatedAt: 1,
              },
            ],
            total: 1,
          }) as Response;
        }

        throw new Error(`unexpected fetch input: ${inputText}`);
      },
    });

    assert.equal(configured, true);

    const status = await internal.getHostPlatformStatus();
    const sessions = await internal.listNodeSessions();
    const rollouts = await manage.listRollouts();

    assert.equal(status.mode, 'desktopCombined');
    assert.equal(status.manageBasePath, '/claw/manage/v1');
    assert.equal(status.stateStoreDriver, 'sqlite');
    assert.equal(status.stateStore.activeProfileId, 'default-sqlite');
    assert.deepEqual(sessions, []);
    assert.equal(rollouts.total, 1);
    assert.deepEqual(requests, [
      {
        input: '/claw/internal/v1/host-platform',
        method: 'GET',
      },
      {
        input: '/claw/internal/v1/node-sessions',
        method: 'GET',
      },
      {
        input: '/claw/manage/v1/rollouts',
        method: 'GET',
      },
    ]);
  } finally {
    configurePlatformBridge(originalBridge);
  }
});

await runTest('server browser bridge also installs hosted-browser runtime startup metadata for server mode', async () => {
  const originalBridge = getPlatformBridge();

  try {
    const configured = configureServerBrowserPlatformBridge({
      document: createMetaDocument({
        'sdkwork-agentstudio-pc-host-mode': 'server',
        'sdkwork-agentstudio-pc-deployment-family': 'container',
        'sdkwork-agentstudio-pc-accelerator-profile': 'nvidia-cuda',
        'sdkwork-agentstudio-pc-manage-base-path': '/claw/manage/v1',
        'sdkwork-agentstudio-pc-internal-base-path': '/claw/internal/v1',
      }) as Document,
      browserBaseUrl: 'http://127.0.0.1:18797',
    });

    assert.equal(configured, true);

    const runtimeInfo = await runtime.getRuntimeInfo();

    assert.equal(runtimeInfo.platform, 'server');
    assert.equal(runtimeInfo.startup?.hostMode, 'server');
    assert.equal(runtimeInfo.startup?.distributionFamily, 'server');
    assert.equal(runtimeInfo.startup?.deploymentFamily, 'container');
    assert.equal(runtimeInfo.startup?.acceleratorProfile, 'nvidia-cuda');
    assert.equal(runtimeInfo.startup?.hostedBrowser, true);
    assert.equal(runtimeInfo.startup?.manageBasePath, '/claw/manage/v1');
    assert.equal(runtimeInfo.startup?.internalBasePath, '/claw/internal/v1');
    assert.equal(runtimeInfo.startup?.browserBaseUrl, 'http://127.0.0.1:18797');
  } finally {
    configurePlatformBridge(originalBridge);
  }
});

await runTest('server browser bridge also installs hosted-browser runtime startup metadata for desktopCombined mode', async () => {
  const originalBridge = getPlatformBridge();

  try {
    const configured = configureServerBrowserPlatformBridge({
      document: createMetaDocument({
        'sdkwork-agentstudio-pc-host-mode': 'desktopCombined',
        'sdkwork-agentstudio-pc-manage-base-path': '/claw/manage/v1',
        'sdkwork-agentstudio-pc-internal-base-path': '/claw/internal/v1',
      }) as Document,
      browserBaseUrl: 'http://127.0.0.1:19876',
    });

    assert.equal(configured, true);

    const runtimeInfo = await runtime.getRuntimeInfo();

    assert.equal(runtimeInfo.platform, 'desktop');
    assert.equal(runtimeInfo.startup?.hostMode, 'desktopCombined');
    assert.equal(runtimeInfo.startup?.distributionFamily, 'desktop');
    assert.equal(runtimeInfo.startup?.deploymentFamily, 'bareMetal');
    assert.equal(runtimeInfo.startup?.acceleratorProfile, null);
    assert.equal(runtimeInfo.startup?.hostedBrowser, true);
    assert.equal(runtimeInfo.startup?.manageBasePath, '/claw/manage/v1');
    assert.equal(runtimeInfo.startup?.internalBasePath, '/claw/internal/v1');
    assert.equal(runtimeInfo.startup?.browserBaseUrl, 'http://127.0.0.1:19876');
  } finally {
    configurePlatformBridge(originalBridge);
  }
});

await runTest('server browser bridge bootstrap preserves kubernetes hosted runtime metadata', async () => {
  const originalBridge = getPlatformBridge();

  try {
    const configured = await bootstrapServerBrowserPlatformBridge({
      document: {
        baseURI: 'https://claw.example.com/index.html',
        querySelector() {
          return null;
        },
      } as Document,
      fetchImpl: async (input) => {
        const inputText = String(input);

        if (inputText === 'https://claw.example.com/sdkwork-agentstudio-pc-bootstrap.json') {
          return createJsonResponse({
            mode: 'server',
            distributionFamily: 'server',
            deploymentFamily: 'kubernetes',
            acceleratorProfile: 'cpu',
            apiBasePath: '/claw/api/v1',
            manageBasePath: '/claw/manage/v1',
            internalBasePath: '/claw/internal/v1',
            browserSessionToken: null,
          }) as Response;
        }

        throw new Error(`unexpected descriptor fetch: ${inputText}`);
      },
    });

    assert.equal(configured, true);

    const runtimeInfo = await runtime.getRuntimeInfo();

    assert.equal(runtimeInfo.platform, 'server');
    assert.equal(runtimeInfo.startup?.hostMode, 'server');
    assert.equal(runtimeInfo.startup?.distributionFamily, 'server');
    assert.equal(runtimeInfo.startup?.deploymentFamily, 'kubernetes');
    assert.equal(runtimeInfo.startup?.acceleratorProfile, 'cpu');
    assert.equal(runtimeInfo.startup?.browserBaseUrl, 'https://claw.example.com');
    assert.equal(runtimeInfo.startup?.hostedBrowser, true);
  } finally {
    configurePlatformBridge(originalBridge);
  }
});

await runTest('server browser bridge keeps the default mock bridge when server metadata is absent', async () => {
  const originalBridge = getPlatformBridge();

  try {
    const configured = configureServerBrowserPlatformBridge({
      document: createMetaDocument({}) as Document,
      fetchImpl: async () => {
        throw new Error('fetch should not run when server metadata is absent');
      },
    });

    assert.equal(configured, false);

    const status = await internal.getHostPlatformStatus();
    const rollouts = await manage.listRollouts();

    assert.equal(status.mode, 'web');
    assert.equal(status.stateStore.activeProfileId, 'web-preview');
    assert.deepEqual(status.stateStore.providers, []);
    assert.equal(rollouts.total, 0);
  } finally {
    configurePlatformBridge(originalBridge);
  }
});

await runTest('default platform bridge freezes startup context and canonical host-manage placeholders', async () => {
  const runtimeInfo = await runtime.getRuntimeInfo();
  const status = await internal.getHostPlatformStatus();

  assert.equal(runtimeInfo.startup?.hostMode, 'web');
  assert.equal(runtimeInfo.startup?.distributionFamily, 'web');
  assert.equal(runtimeInfo.startup?.deploymentFamily, 'bareMetal');
  assert.equal(runtimeInfo.startup?.acceleratorProfile, null);
  assert.equal(status.distributionFamily, 'web');
  assert.equal(status.deploymentFamily, 'bareMetal');
  await assert.rejects(
    async () => manage.getHostEndpoints(),
    /Manage host endpoints are not available/,
  );
  await assert.rejects(
    async () => manage.getOpenClawRuntime(),
    /Manage OpenClaw runtime is not available/,
  );
  await assert.rejects(
    async () => manage.getOpenClawGateway(),
    /Manage OpenClaw gateway is not available/,
  );
  await assert.rejects(
    async () =>
      manage.invokeOpenClawGateway({
        tool: 'gateway',
      }),
    /Manage OpenClaw gateway invoke is not available/,
  );
});
