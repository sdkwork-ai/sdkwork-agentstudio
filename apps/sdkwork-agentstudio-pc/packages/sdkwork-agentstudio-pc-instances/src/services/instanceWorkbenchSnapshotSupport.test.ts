// WORKSPACE-PATH:allow-fixture: fixtures name a foreign checkout root, drive, or home directory to exercise path handling, so the literal is the value under assertion rather than a binding this build resolves
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  DEFAULT_BUNDLED_OPENCLAW_VERSION,
  STABLE_BUILT_IN_OPENCLAW_INSTANCE_ID,
} from '@sdkwork/agentstudio-pc-types';
import { createEmptyOpenClawConfigSnapshot } from './openClawConfigWorkbenchSupport.ts';

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

let snapshotSupportModule:
  | typeof import('./instanceWorkbenchSnapshotSupport.ts')
  | undefined;

try {
  snapshotSupportModule = await import('./instanceWorkbenchSnapshotSupport.ts');
} catch {
  snapshotSupportModule = undefined;
}

function createConfigRoute(target: string) {
  return {
    id: 'config',
    label: 'Configuration',
    scope: 'config',
    mode: 'managedFile',
    status: 'ready',
    target,
    readonly: false,
    authoritative: true,
    detail: 'Config file is writable.',
    source: 'integration',
  } as const;
}

function createOpenClawDetail(
  instanceId = 'openclaw-snapshot',
  overrides: Record<string, unknown> = {},
) {
  return {
    instance: {
      id: instanceId,
      name: `OpenClaw ${instanceId}`,
      description: 'Primary OpenClaw gateway.',
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
      baseUrl: 'http://10.0.0.8:21280',
      websocketUrl: 'ws://10.0.0.8:21280',
      cpu: 12,
      memory: 35,
      totalMemory: '64GB',
      uptime: '18h',
      capabilities: ['chat', 'health', 'tasks', 'files', 'memory', 'tools', 'models'],
      storage: {
        provider: 'localFile',
        namespace: instanceId,
      },
      config: {
        port: '21280',
        sandbox: true,
        autoUpdate: true,
        logLevel: 'info',
        corsOrigins: '*',
        authToken: 'gateway-token',
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
      authToken: 'gateway-token',
    },
    logs: 'runtime log',
    health: {
      score: 91,
      status: 'healthy',
      checks: [],
      evaluatedAt: 1,
    },
    lifecycle: {
      owner: 'remoteService',
      startStopSupported: false,
      configWritable: true,
      workbenchManaged: false,
      endpointObserved: true,
      lifecycleControllable: false,
      notes: [],
    },
    storage: {
      status: 'ready',
      provider: 'localFile',
      namespace: instanceId,
      durable: true,
      queryable: false,
      transactional: false,
      remote: false,
    },
    connectivity: {
      primaryTransport: 'openclawGatewayWs',
      endpoints: [
        {
          id: 'base-url',
          label: 'Base URL',
          kind: 'http',
          status: 'ready',
          url: 'http://10.0.0.8:21280',
          exposure: 'remote',
          auth: 'token',
          source: 'config',
        },
      ],
    },
    observability: {
      status: 'ready',
      logAvailable: true,
      logPreview: ['runtime log'],
      metricsSource: 'runtime',
      lastSeenAt: 1,
    },
    dataAccess: {
      routes: [],
    },
    artifacts: [],
    capabilities: [
      {
        id: 'tasks',
        status: 'ready',
        detail: 'Cron tasks are enabled.',
        source: 'runtime',
      },
      {
        id: 'models',
        status: 'ready',
        detail: 'Model configuration is available.',
        source: 'runtime',
      },
      {
        id: 'files',
        status: 'planned',
        detail: 'Files require runtime data.',
        source: 'runtime',
      },
      {
        id: 'memory',
        status: 'ready',
        detail: 'Memory reads are enabled.',
        source: 'runtime',
      },
      {
        id: 'tools',
        status: 'ready',
        detail: 'Tool catalog is available.',
        source: 'runtime',
      },
    ],
    officialRuntimeNotes: [],
    ...overrides,
  } as any;
}

await runTest(
  'instanceWorkbenchSnapshotSupport exposes shared snapshot assembly helpers',
  () => {
    assert.ok(
      snapshotSupportModule,
      'Expected instanceWorkbenchSnapshotSupport.ts to exist',
    );
    assert.equal(typeof snapshotSupportModule?.buildOpenClawSnapshotFromSections, 'function');
    assert.equal(typeof snapshotSupportModule?.mergeOpenClawSnapshots, 'function');
    assert.equal(typeof snapshotSupportModule?.finalizeOpenClawSnapshot, 'function');
    assert.equal(typeof snapshotSupportModule?.buildDetailOnlyWorkbenchSnapshot, 'function');
    assert.equal(typeof snapshotSupportModule?.mapBackendWorkbench, 'function');
  },
);
await runTest(
  'InstanceWorkbenchSnapshot does not expose the legacy config alias field in shared truth',
  () => {
    const source = readFileSync(new URL('../types/index.ts', import.meta.url), 'utf8');

    assert.doesNotMatch(source, /managedConfigPath\?: string \| null/);
  },
);

await runTest(
  'buildDetailOnlyWorkbenchSnapshot keeps overview and config counts aligned',
  () => {
    const configSnapshot = {
      ...createEmptyOpenClawConfigSnapshot('D:/OpenClaw/.openclaw/openclaw.json'),
      channelSnapshots: [
        {
          id: 'slack',
          name: 'Slack',
          description: 'Managed Slack channel',
          status: 'connected',
          enabled: true,
          configurationMode: 'required',
          fieldCount: 1,
          configuredFieldCount: 1,
          setupSteps: ['Configure token'],
          values: {
            token: 'env:SLACK_TOKEN',
          },
          fields: [
            {
              id: 'token',
              label: 'Token',
            },
          ],
        },
      ],
    } as any;
    const detail = createOpenClawDetail('detail-only', {
      dataAccess: {
        routes: [createConfigRoute('D:/OpenClaw/.openclaw/openclaw.json')],
      },
      artifacts: [
        {
          id: 'config-artifact',
          kind: 'configFile',
          label: 'Config file',
          status: 'ready',
          readonly: false,
        },
      ],
    });

    const snapshot = snapshotSupportModule?.buildDetailOnlyWorkbenchSnapshot(
      detail,
      'D:/OpenClaw/.openclaw/openclaw.json',
      configSnapshot,
    );

    assert.equal(snapshot?.kernelConfig?.kernelId, 'openclaw');
    assert.equal(snapshot?.kernelConfig?.runtimeKind, 'openclaw');
    assert.equal(snapshot?.kernelConfig?.configFile, 'D:/OpenClaw/.openclaw/openclaw.json');
    assert.equal(snapshot?.kernelConfig?.configRoot, 'D:/OpenClaw/.openclaw');
    assert.equal(snapshot?.kernelConfig?.stateRoot, 'D:/OpenClaw/.openclaw');
    assert.equal(snapshot?.kernelConfig?.userRoot, 'D:/OpenClaw');
    assert.equal(snapshot?.kernelConfig?.standardStateRoot, 'D:/OpenClaw/.openclaw');
    assert.equal(snapshot?.kernelConfig?.standardConfigFile, 'D:/OpenClaw/.openclaw/openclaw.json');
    assert.equal(snapshot?.kernelConfig?.format, 'json');
    assert.equal(snapshot?.kernelConfig?.access, 'localFs');
    assert.equal(snapshot?.kernelConfig?.provenance, 'standardUserRoot');
    assert.equal(snapshot?.kernelConfig?.writable, true);
    assert.equal(snapshot?.kernelConfig?.resolved, true);
    assert.equal(snapshot?.kernelConfig?.schemaVersion, null);
    assert.equal(snapshot?.kernelConfig?.isStandardUserRootLayout, true);
    assert.equal('managedConfigPath' in (snapshot || {}), false);
    assert.equal(snapshot?.sectionCounts.overview, 8);
    assert.equal(snapshot?.sectionCounts.config, 1);
    assert.equal(snapshot?.sectionAvailability.config.status, 'ready');
    assert.equal(snapshot?.channels.length, 0);
    assert.equal(snapshot?.configChannels?.[0]?.id, 'slack');
  },
);

await runTest(
  'buildDetailOnlyWorkbenchSnapshot preserves built-in and transport metadata needed by the instance detail action model',
  () => {
    const detail = createOpenClawDetail(STABLE_BUILT_IN_OPENCLAW_INSTANCE_ID, {
      instance: {
        ...createOpenClawDetail(STABLE_BUILT_IN_OPENCLAW_INSTANCE_ID).instance,
        deploymentMode: 'local-managed',
        transportKind: 'openclawGatewayWs',
        isBuiltIn: true,
        baseUrl: 'http://127.0.0.1:21280',
        websocketUrl: 'ws://127.0.0.1:21280',
        storage: {
          provider: 'localFile',
          namespace: STABLE_BUILT_IN_OPENCLAW_INSTANCE_ID,
        },
      },
    });

    const snapshot = snapshotSupportModule?.buildDetailOnlyWorkbenchSnapshot(detail);

    assert.equal(snapshot?.instance.isBuiltIn, true);
    assert.equal(snapshot?.instance.runtimeKind, 'openclaw');
    assert.equal(snapshot?.instance.deploymentMode, 'local-managed');
    assert.equal(snapshot?.instance.transportKind, 'openclawGatewayWs');
    assert.equal(snapshot?.instance.baseUrl, 'http://127.0.0.1:21280');
    assert.equal(snapshot?.instance.websocketUrl, 'ws://127.0.0.1:21280');
    assert.equal(snapshot?.instance.storage?.namespace, STABLE_BUILT_IN_OPENCLAW_INSTANCE_ID);
  },
);

await runTest(
  'finalizeOpenClawSnapshot overlays config ownership while preserving runtime readiness',
  () => {
    const detail = createOpenClawDetail('finalized-openclaw', {
      lifecycle: {
        owner: 'appManaged',
        startStopSupported: false,
        configWritable: true,
        workbenchManaged: true,
        endpointObserved: true,
        lifecycleControllable: false,
        notes: [],
      },
      dataAccess: {
        routes: [createConfigRoute('D:/OpenClaw/.openclaw/openclaw.json')],
      },
    });
    const configSnapshot = {
      ...createEmptyOpenClawConfigSnapshot('D:/OpenClaw/.openclaw/openclaw.json'),
      providerSnapshots: [
        {
          id: 'managed-openai',
          name: 'Managed OpenAI',
          provider: 'openai',
          endpoint: 'https://api.openai.com/v1',
          apiKeySource: 'env:OPENAI_API_KEY',
          status: 'ready',
          defaultModelId: 'gpt-5.4',
          reasoningModelId: 'gpt-5.4',
          embeddingModelId: 'text-embedding-3-large',
          description: 'Managed provider',
          icon: 'O',
          lastCheckedAt: '2025-03-19T00:00:00.000Z',
          capabilities: ['chat', 'reasoning', 'embedding'],
          models: [
            {
              id: 'gpt-5.4',
              name: 'GPT-5.4',
              role: 'primary',
              contextWindow: '200K',
            },
          ],
          config: {
            temperature: 0.2,
            topP: 1,
            maxTokens: 12000,
            timeoutMs: 60000,
            streaming: true,
          },
        },
      ],
      agentSnapshots: [
        {
          id: 'Ops Lead',
          name: 'Ops Lead',
          description: 'Managed ops agent',
          avatar: 'O',
          workspace: 'D:/OpenClaw/workspace',
          agentDir: 'D:/OpenClaw/agents/ops',
          isDefault: true,
          model: {
            primary: 'managed-openai/gpt-5.4',
            fallbacks: [],
          },
          params: {
            temperature: 0.2,
          },
          paramSources: {
            temperature: 'defaults',
          },
        },
      ],
      channelSnapshots: [
        {
          id: 'slack',
          name: 'Slack',
          description: 'Managed Slack channel',
          status: 'not_configured',
          enabled: false,
          configurationMode: 'required',
          fieldCount: 1,
          configuredFieldCount: 0,
          setupSteps: ['Configure token'],
          values: {
            token: '',
          },
          fields: [
            {
              id: 'token',
              label: 'Token',
            },
          ],
        },
      ],
    } as any;
    const runtimeSnapshot = snapshotSupportModule?.buildOpenClawSnapshotFromSections(detail, {
      channels: [
        {
          id: 'slack',
          name: 'Slack',
          description: 'Runtime Slack channel',
          status: 'connected',
          enabled: true,
          configurationMode: 'required',
          fieldCount: 1,
          configuredFieldCount: 1,
          setupSteps: ['Runtime connected'],
        },
      ],
      tasks: [
        {
          id: 'job-ops-daily',
          name: 'Ops Daily Brief',
          description: 'Morning operations summary',
          prompt: 'Summarize operations updates.',
          schedule: '0 9 * * *',
          scheduleMode: 'cron',
          scheduleConfig: {
            cronExpression: '0 9 * * *',
          },
          cronExpression: '0 9 * * *',
          actionType: 'skill',
          status: 'active',
          sessionMode: 'isolated',
          wakeUpMode: 'immediate',
          executionContent: 'runAssistantTask',
          deliveryMode: 'none',
        },
      ],
      agents: [
        {
          agent: {
            id: 'ops-lead',
            name: 'Ops Lead Runtime',
            description: 'Runtime agent',
            avatar: 'R',
            systemPrompt: 'Handle incidents',
            creator: 'OpenClaw',
          },
          focusAreas: ['Operations'],
          automationFitScore: 80,
          configSource: 'runtime',
        },
      ],
      skills: [
        {
          id: 'diag-helper',
          name: 'Diagnostics Helper',
          description: 'Troubleshoot incidents',
          author: 'OpenClaw',
          rating: 5,
          downloads: 1,
          category: 'Operations',
        },
      ],
      files: [
        {
          id: 'openclaw-agent-file:ops-lead:AGENTS.md',
          name: 'AGENTS.md',
          path: '/workspace/ops/AGENTS.md',
          category: 'prompt',
          language: 'markdown',
          size: '1 KB',
          updatedAt: '2025-03-19T00:00:00.000Z',
          status: 'synced',
          description: 'Agent prompt',
          content: '',
          isReadonly: false,
        },
      ],
      llmProviders: [
        {
          id: 'runtime-openai',
          name: 'Runtime OpenAI',
          provider: 'openai',
          endpoint: 'https://runtime.example.com/v1',
          apiKeySource: 'env:RUNTIME_OPENAI_KEY',
          status: 'ready',
          defaultModelId: 'gpt-5.4',
          description: 'Runtime provider',
          icon: 'R',
          lastCheckedAt: '2025-03-19T00:00:00.000Z',
          capabilities: ['chat'],
          models: [
            {
              id: 'gpt-5.4',
              name: 'GPT-5.4',
              role: 'primary',
              contextWindow: '200K',
            },
          ],
          config: {
            temperature: 0.3,
            topP: 1,
            maxTokens: 12000,
            timeoutMs: 60000,
            streaming: true,
          },
        },
      ],
      memories: [],
      tools: [
        {
          id: 'read',
          name: 'read',
          description: 'Read files.',
          category: 'filesystem',
          status: 'ready',
          access: 'execute',
          command: 'tool:read',
        },
      ],
    });
    const finalized = snapshotSupportModule?.finalizeOpenClawSnapshot(
      detail,
      runtimeSnapshot!,
      'D:/OpenClaw/.openclaw/openclaw.json',
      configSnapshot,
      [
        {
          id: 'slack',
          name: 'Slack',
          description: 'Catalog Slack channel',
          status: 'not_configured',
          enabled: false,
          configurationMode: 'required',
          fieldCount: 1,
          configuredFieldCount: 0,
          setupSteps: ['Configure token'],
        },
        {
          id: 'telegram',
          name: 'Telegram',
          description: 'Catalog Telegram channel',
          status: 'not_configured',
          enabled: false,
          configurationMode: 'required',
          fieldCount: 1,
          configuredFieldCount: 0,
          setupSteps: ['Configure bot token'],
        },
      ],
    );

    assert.equal(finalized?.kernelConfig?.kernelId, 'openclaw');
    assert.equal(finalized?.kernelConfig?.runtimeKind, 'openclaw');
    assert.equal(finalized?.kernelConfig?.configFile, 'D:/OpenClaw/.openclaw/openclaw.json');
    assert.equal(finalized?.kernelConfig?.configRoot, 'D:/OpenClaw/.openclaw');
    assert.equal(finalized?.kernelConfig?.stateRoot, 'D:/OpenClaw/.openclaw');
    assert.equal(finalized?.kernelConfig?.userRoot, 'D:/OpenClaw');
    assert.equal(finalized?.kernelConfig?.standardStateRoot, 'D:/OpenClaw/.openclaw');
    assert.equal(finalized?.kernelConfig?.standardConfigFile, 'D:/OpenClaw/.openclaw/openclaw.json');
    assert.equal(finalized?.kernelConfig?.format, 'json');
    assert.equal(finalized?.kernelConfig?.access, 'localFs');
    assert.equal(finalized?.kernelConfig?.provenance, 'standardUserRoot');
    assert.equal(finalized?.kernelConfig?.writable, true);
    assert.equal(finalized?.kernelConfig?.resolved, true);
    assert.equal(finalized?.kernelConfig?.schemaVersion, null);
    assert.equal(finalized?.kernelConfig?.isStandardUserRootLayout, true);
    assert.equal('managedConfigPath' in (finalized || {}), false);
    assert.equal(finalized?.sectionCounts.config, 1);
    assert.equal(finalized?.sectionAvailability.config.status, 'ready');
    assert.equal(finalized?.sectionAvailability.files.status, 'ready');
    assert.deepEqual(
      finalized?.channels.map((channel) => channel.id),
      ['slack', 'telegram'],
    );
    assert.equal(finalized?.channels.find((channel) => channel.id === 'slack')?.status, 'connected');
    assert.equal(finalized?.llmProviders[0]?.id, 'managed-openai');
    assert.equal(finalized?.agents[0]?.configSource, 'configFile');
    assert.equal(finalized?.readyToolCount, 1);
    assert.equal(finalized?.activeTaskCount, 1);
    assert.equal(finalized?.connectedChannelCount, 1);
  },
);
