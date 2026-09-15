// WORKSPACE-PATH:allow-fixture: fixtures name a foreign checkout root, drive, or home directory to exercise path handling, so the literal is the value under assertion rather than a binding this build resolves
import assert from 'node:assert/strict';
import {
  DEFAULT_BUNDLED_OPENCLAW_VERSION,
  type StudioInstanceDetailRecord,
} from '@sdkwork/agentstudio-pc-types';
import { buildBundledOpenClawStartupAlert } from './bundledOpenClawStartupAlert.ts';

const BUILT_IN_INSTANCE_ID = 'managed-openclaw-primary';

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

function createDetail(
  overrides: Partial<StudioInstanceDetailRecord> = {},
): StudioInstanceDetailRecord {
  return {
    instance: {
      id: BUILT_IN_INSTANCE_ID,
      name: 'Built-In OpenClaw',
      runtimeKind: 'openclaw',
      deploymentMode: 'local-managed',
      transportKind: 'openclawGatewayWs',
      status: 'error',
      isBuiltIn: true,
      isDefault: true,
      iconType: 'server',
      version: DEFAULT_BUNDLED_OPENCLAW_VERSION,
      typeLabel: 'OpenClaw Gateway',
      host: '127.0.0.1',
      port: 18871,
      baseUrl: 'http://127.0.0.1:18871',
      websocketUrl: 'ws://127.0.0.1:18871',
      cpu: 0,
      memory: 0,
      totalMemory: 'Unknown',
      uptime: '-',
      capabilities: [],
      storage: {
        provider: 'localFile',
        namespace: BUILT_IN_INSTANCE_ID,
      },
      config: {
        port: '18871',
        sandbox: true,
        autoUpdate: true,
        logLevel: 'info',
        corsOrigins: '*',
      },
      createdAt: 1,
      updatedAt: 1,
      lastSeenAt: 1,
      ...(overrides.instance || {}),
    },
    config: {
      port: '18871',
      sandbox: true,
      autoUpdate: true,
      logLevel: 'info',
      corsOrigins: '*',
      ...(overrides.config || {}),
    },
    logs: '',
    health: {
      score: 20,
      status: 'offline',
      checks: [],
      evaluatedAt: 1,
    },
    lifecycle: {
      owner: 'appManaged',
      startStopSupported: true,
      configWritable: true,
      lastActivationStage: 'prepareConfig',
      lastError:
        'timeout: openclaw gateway did not become ready on 127.0.0.1:18871 within 30000ms',
      notes: [
        'Last built-in OpenClaw activation detail stage: Gateway Configured',
      ],
      ...(overrides.lifecycle || {}),
    },
    storage: {
      status: 'ready',
      provider: 'localFile',
      namespace: BUILT_IN_INSTANCE_ID,
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
      logFilePath: 'D:/OpenClaw/.openclaw/logs/openclaw-gateway.log',
      ...(overrides.observability || {}),
    },
    dataAccess: {
      routes: [],
    },
    artifacts: [
      {
        id: 'desktop-main-log-file',
        label: 'Desktop Main Log',
        kind: 'logFile',
        status: 'available',
        location: 'D:/OpenClaw/.openclaw/logs/app.log',
        readonly: true,
        detail: 'Desktop startup and supervisor log.',
        source: 'runtime',
      },
      ...((overrides.artifacts as StudioInstanceDetailRecord['artifacts']) || []),
    ],
    capabilities: [],
    officialRuntimeNotes: [],
    ...(overrides as Omit<StudioInstanceDetailRecord, 'instance' | 'config' | 'health' | 'lifecycle' | 'storage' | 'connectivity' | 'observability' | 'dataAccess' | 'artifacts'>),
  };
}

await runTest(
  'buildBundledOpenClawStartupAlert returns timeout diagnostics for built-in managed startup failures',
  () => {
    const alert = buildBundledOpenClawStartupAlert(createDetail());

    assert.deepEqual(alert, {
      tone: 'warning',
      titleKey:
        'instances.detail.instanceWorkbench.overview.management.alerts.bundledStartupFailure.title',
      detailKey:
        'instances.detail.instanceWorkbench.overview.management.alerts.bundledStartupFailure.description',
      message:
        'timeout: openclaw gateway did not become ready on 127.0.0.1:18871 within 30000ms',
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
  },
);

await runTest(
  'buildBundledOpenClawStartupAlert falls back to the shared activation stage label when no OpenClaw-specific detail note is present',
  () => {
    const alert = buildBundledOpenClawStartupAlert(
      createDetail({
        lifecycle: {
          ...createDetail().lifecycle,
          lastActivationStage: 'verifyEndpoint',
          notes: [],
        },
      }),
    );

    assert.equal(alert?.diagnostics[0]?.value, 'Verify Endpoint');
  },
);

await runTest(
  'buildBundledOpenClawStartupAlert ignores non-built-in or non-error details',
  () => {
    assert.equal(
      buildBundledOpenClawStartupAlert(
        createDetail({
          lifecycle: {
            ...createDetail().lifecycle,
            lastError: undefined,
          },
        }),
      ),
      null,
    );

    assert.equal(
      buildBundledOpenClawStartupAlert(
        createDetail({
          instance: {
            ...createDetail().instance,
            isBuiltIn: false,
          },
        }),
      ),
      null,
    );
  },
);

await runTest(
  'buildBundledOpenClawStartupAlert classifies localized access denied startup failures',
  () => {
    const alert = buildBundledOpenClawStartupAlert(
      createDetail({
        lifecycle: {
          ...createDetail().lifecycle,
          lastActivationStage: 'prepareRuntimeActivation',
          lastError:
            'Windows \u62d2\u7edd\u8bbf\u95ee bundled runtime \u76ee\u5f55\uff0c\u65e0\u6cd5\u5b8c\u6210\u5185\u7f6e runtime \u843d\u5730',
        },
      }),
    );

    assert.equal(
      alert?.recommendedActionDetailKey,
      'instances.detail.instanceWorkbench.overview.management.alerts.bundledStartupFailure.actions.runtimeAccessDenied',
    );
  },
);
