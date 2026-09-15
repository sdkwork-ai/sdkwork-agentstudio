// WORKSPACE-PATH:allow-fixture: fixtures name a foreign checkout root, drive, or home directory to exercise path handling, so the literal is the value under assertion rather than a binding this build resolves
import assert from 'node:assert/strict';
import {
  DEFAULT_BUNDLED_OPENCLAW_VERSION,
  type StudioInstanceDetailRecord,
} from '@sdkwork/agentstudio-pc-types';
import {
  hasReadyOpenClawGateway,
  hasWritableOpenClawConfigRoute,
  isProviderCenterControlledOpenClawDetail,
  shouldProbeOpenClawGateway,
} from './openClawManagementCapabilities.ts';

const BUILT_IN_INSTANCE_ID = 'managed-openclaw-primary';

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

await runTest('isProviderCenterControlledOpenClawDetail returns true for built-in workbench lifecycles', () => {
  const detail = createDetail({
    instance: {
      id: BUILT_IN_INSTANCE_ID,
      isBuiltIn: true,
      isDefault: true,
      deploymentMode: 'local-managed',
      host: '127.0.0.1',
    },
    lifecycle: {
      owner: 'appManaged',
      startStopSupported: false,
      configWritable: true,
      workbenchManaged: true,
      endpointObserved: true,
      lifecycleControllable: false,
      notes: [],
    },
  });

  assert.equal(isProviderCenterControlledOpenClawDetail(detail), true);
  assert.equal(hasWritableOpenClawConfigRoute(detail), false);
});

await runTest('isProviderCenterControlledOpenClawDetail returns true for writable config routes', () => {
  const detail = createDetail({
    instance: {
      id: 'managed-openclaw',
      deploymentMode: 'local-external',
    },
    lifecycle: {
      owner: 'externalProcess',
      startStopSupported: false,
      configWritable: true,
      workbenchManaged: false,
      endpointObserved: false,
      lifecycleControllable: false,
      notes: [],
    },
    dataAccess: {
      routes: [
        {
          id: 'config',
          label: 'Configuration',
          scope: 'config',
          mode: 'managedFile',
          status: 'ready',
          target: 'D:/OpenClaw/.openclaw/openclaw.json',
          readonly: false,
          authoritative: true,
          detail: 'Writable OpenClaw config file.',
          source: 'integration',
        },
      ],
    },
  });

  assert.equal(hasWritableOpenClawConfigRoute(detail), true);
  assert.equal(isProviderCenterControlledOpenClawDetail(detail), true);
});

await runTest(
  'isProviderCenterControlledOpenClawDetail does not treat remote api config control as Provider Center controlled without local config authority',
  () => {
    const detail = createDetail({
      lifecycle: {
        owner: 'remoteService',
        startStopSupported: false,
        configWritable: true,
        workbenchManaged: false,
        endpointObserved: true,
        lifecycleControllable: false,
        notes: [],
      },
      dataAccess: {
        routes: [
          {
            id: 'config-api',
            label: 'Configuration API',
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
    });

    assert.equal(hasWritableOpenClawConfigRoute(detail), false);
    assert.equal(isProviderCenterControlledOpenClawDetail(detail), false);
  },
);

await runTest(
  'isProviderCenterControlledOpenClawDetail does not infer controlled status from deploymentMode alone when explicit lifecycle capability is absent',
  () => {
    const detail = createDetail({
      instance: {
        id: 'legacy-shaped-built-in',
        isBuiltIn: true,
        isDefault: true,
        deploymentMode: 'local-managed',
        host: '127.0.0.1',
      },
      lifecycle: {
        owner: 'appManaged',
        startStopSupported: false,
        configWritable: false,
        notes: [],
      },
    });

    assert.equal(hasWritableOpenClawConfigRoute(detail), false);
    assert.equal(isProviderCenterControlledOpenClawDetail(detail), false);
  },
);

await runTest('isProviderCenterControlledOpenClawDetail returns false for metadata-only custom local-managed openclaw', () => {
  const detail = createDetail({
    instance: {
      id: 'custom-local-managed',
      deploymentMode: 'local-managed',
      host: '127.0.0.1',
      isBuiltIn: false,
      isDefault: false,
    },
    lifecycle: {
      owner: 'externalProcess',
      startStopSupported: false,
      configWritable: false,
      workbenchManaged: false,
      endpointObserved: false,
      lifecycleControllable: false,
      notes: [],
    },
    dataAccess: {
      routes: [
        {
          id: 'config',
          label: 'Configuration',
          scope: 'config',
          mode: 'metadataOnly',
          status: 'ready',
          target: 'registry://instances/custom-local-managed',
          readonly: false,
          authoritative: false,
          detail: 'Metadata projection only.',
          source: 'integration',
        },
      ],
    },
  });

  assert.equal(hasWritableOpenClawConfigRoute(detail), false);
  assert.equal(isProviderCenterControlledOpenClawDetail(detail), false);
});

await runTest('isProviderCenterControlledOpenClawDetail returns false for remote openclaw endpoints', () => {
  const detail = createDetail({
    dataAccess: {
      routes: [
        {
          id: 'config-api',
          label: 'Configuration API',
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
  });

  assert.equal(hasWritableOpenClawConfigRoute(detail), false);
  assert.equal(isProviderCenterControlledOpenClawDetail(detail), false);
});

await runTest(
  'hasReadyOpenClawGateway returns true for online instances or when runtime observation proves the gateway is already reachable',
  () => {
  const onlineDetail = createDetail({
    instance: {
      status: 'online',
    },
  });
  const offlineDetail = createDetail({
    instance: {
      status: 'offline',
    },
  });
  const observedDetail = createDetail({
    instance: {
      id: 'observed-local-external',
      status: 'offline',
      deploymentMode: 'local-external',
      host: '127.0.0.1',
    },
    lifecycle: {
      owner: 'externalProcess',
      startStopSupported: false,
      configWritable: true,
      workbenchManaged: false,
      endpointObserved: true,
      lifecycleControllable: false,
      notes: [],
    },
    health: {
      score: 84,
      status: 'healthy',
      checks: [],
      evaluatedAt: 1,
    },
  });

  assert.equal(hasReadyOpenClawGateway(onlineDetail), true);
  assert.equal(hasReadyOpenClawGateway(offlineDetail), false);
  assert.equal(hasReadyOpenClawGateway(observedDetail), true);
  assert.equal(
    hasReadyOpenClawGateway({
      ...onlineDetail,
      instance: {
        ...onlineDetail.instance,
        runtimeKind: 'custom',
      },
    }),
    false,
  );
  },
);

await runTest(
  'shouldProbeOpenClawGateway keeps probing built-in OpenClaw runtimes even when instance status lags behind runtime readiness',
  () => {
    const builtInManagedDetail = createDetail({
      instance: {
        id: BUILT_IN_INSTANCE_ID,
        status: 'offline',
        isBuiltIn: true,
        isDefault: true,
        deploymentMode: 'local-managed',
        host: '127.0.0.1',
      },
      lifecycle: {
        owner: 'appManaged',
        startStopSupported: true,
        configWritable: true,
        workbenchManaged: true,
        endpointObserved: true,
        lifecycleControllable: true,
        notes: [],
      },
    });
    const localExternalDetail = createDetail({
      instance: {
        id: 'local-external',
        status: 'offline',
        deploymentMode: 'local-external',
        host: '127.0.0.1',
      },
      lifecycle: {
        owner: 'externalProcess',
        startStopSupported: false,
        configWritable: true,
        workbenchManaged: false,
        endpointObserved: false,
        lifecycleControllable: false,
        notes: [],
      },
    });
    const observedLocalExternalDetail = createDetail({
      instance: {
        id: 'observed-local-external',
        status: 'offline',
        deploymentMode: 'local-external',
        host: '127.0.0.1',
      },
      lifecycle: {
        owner: 'externalProcess',
        startStopSupported: false,
        configWritable: true,
        workbenchManaged: false,
        endpointObserved: true,
        lifecycleControllable: false,
        notes: [],
      },
      health: {
        score: 76,
        status: 'attention',
        checks: [],
        evaluatedAt: 1,
      },
    });

    assert.equal(shouldProbeOpenClawGateway(builtInManagedDetail), true);
    assert.equal(shouldProbeOpenClawGateway(localExternalDetail), false);
    assert.equal(shouldProbeOpenClawGateway(observedLocalExternalDetail), true);
    assert.equal(
      shouldProbeOpenClawGateway({
        ...builtInManagedDetail,
        instance: {
          ...builtInManagedDetail.instance,
          runtimeKind: 'custom',
        },
      }),
      false,
    );
  },
);
