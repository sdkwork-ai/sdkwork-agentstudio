// WORKSPACE-PATH:allow-fixture: fixtures name a foreign checkout root, drive, or home directory to exercise path handling, so the literal is the value under assertion rather than a binding this build resolves
import assert from 'node:assert/strict';
import type { InstanceWorkbenchSnapshot } from '../types/index.ts';
import {
  buildInstanceConfigWorkbenchModel,
  buildInstanceConfigWorkbenchSectionDescriptors,
  computeInstanceConfigWorkbenchDiff,
  getInstanceConfigWorkbenchModes,
} from './instanceConfigWorkbench.ts';

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

function createWorkbench(): InstanceWorkbenchSnapshot {
  return {
    instance: {
      id: 'instance-openclaw',
      name: 'OpenClaw',
      type: 'OpenClaw Gateway',
      iconType: 'server',
      status: 'online',
      version: '2026.4.3',
      uptime: '12h',
      ip: '127.0.0.1',
      cpu: 10,
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
    detail: {
      instance: {
        id: 'instance-openclaw',
        name: 'OpenClaw',
        runtimeKind: 'openclaw',
        deploymentMode: 'local-managed',
        transportKind: 'openclawGatewayWs',
        status: 'online',
        isBuiltIn: true,
        isDefault: true,
        iconType: 'server',
        version: '2026.4.3',
        typeLabel: 'OpenClaw Gateway',
        host: '127.0.0.1',
        port: 21280,
        baseUrl: 'http://127.0.0.1:21280',
        websocketUrl: 'ws://127.0.0.1:21280',
        cpu: 10,
        memory: 28,
        totalMemory: '32 GB',
        uptime: '12h',
        capabilities: ['chat', 'models', 'tasks', 'files', 'tools'],
        storage: {
          provider: 'localFile',
          namespace: 'instance-openclaw',
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
        score: 95,
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
        namespace: 'instance-openclaw',
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
    } as any,
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
    configChannels: [
      {
        id: 'slack',
        name: 'Slack',
        description: 'Slack channel',
        status: 'connected',
        enabled: true,
        configurationMode: 'required',
        fieldCount: 2,
        configuredFieldCount: 2,
        setupSteps: ['Add bot token', 'Add app token'],
        values: {
          botToken: 'xoxb-token',
          appToken: 'xapp-token',
        },
        fields: [],
      },
      {
        id: 'telegram',
        name: 'Telegram',
        description: 'Telegram channel',
        status: 'not_configured',
        enabled: false,
        configurationMode: 'required',
        fieldCount: 1,
        configuredFieldCount: 0,
        setupSteps: ['Add bot token'],
        values: {
          botToken: '',
        },
        fields: [],
      },
    ],
    kernelConfigInsights: {
      defaultAgentId: 'main',
      defaultModelRef: 'openai/gpt-5.4',
      sessionsVisibility: 'tree',
      agentToAgentEnabled: true,
      agentToAgentAllow: ['research', 'ops'],
    },
    configWebSearch: {
      enabled: true,
      provider: 'searxng',
      maxResults: 8,
      timeoutSeconds: 30,
      cacheTtlMinutes: 20,
      providers: [
        {
          id: 'searxng',
          name: 'SearXNG',
          description: 'Self-hosted search',
          apiKeySource: '',
          baseUrl: 'http://127.0.0.1:8080',
          model: '',
          advancedConfig: '{\n  "language": "zh-CN"\n}',
          supportsApiKey: false,
          supportsBaseUrl: true,
          supportsModel: false,
        },
      ],
    },
    configAuthCooldowns: {
      rateLimitedProfileRotations: 2,
      overloadedProfileRotations: 1,
      overloadedBackoffMs: 45000,
      billingBackoffHours: 5,
      billingMaxHours: 24,
      failureWindowHours: 24,
    },
    healthScore: 95,
    runtimeStatus: 'healthy',
    connectedChannelCount: 1,
    activeTaskCount: 1,
    installedSkillCount: 2,
    readyToolCount: 3,
    sectionCounts: {
      overview: 1,
      channels: 2,
      cronTasks: 1,
      llmProviders: 2,
      agents: 2,
      skills: 2,
      files: 0,
      memory: 0,
      tools: 3,
      config: 1,
    },
    sectionAvailability: {
      overview: { status: 'ready', detail: 'ready' },
      channels: { status: 'ready', detail: 'ready' },
      cronTasks: { status: 'ready', detail: 'ready' },
      llmProviders: { status: 'ready', detail: 'ready' },
      agents: { status: 'ready', detail: 'ready' },
      skills: { status: 'ready', detail: 'ready' },
      files: { status: 'planned', detail: 'planned' },
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
          systemPrompt: 'Handle the main session',
          creator: 'OpenClaw',
        },
        focusAreas: ['Generalist'],
        automationFitScore: 74,
        workspace: 'D:/OpenClaw/.openclaw/workspace',
        agentDir: 'D:/OpenClaw/.openclaw/agents/main/agent',
        isDefault: true,
        model: {
          primary: 'openai/gpt-5.4',
          fallbacks: ['openai/gpt-5.4-mini'],
        },
        configSource: 'configFile',
      },
      {
        agent: {
          id: 'research',
          name: 'Research',
          description: 'Research agent',
          avatar: 'R',
          systemPrompt: 'Research and synthesize',
          creator: 'OpenClaw',
        },
        focusAreas: ['Research'],
        automationFitScore: 81,
        workspace: 'D:/OpenClaw/.openclaw/workspace-research',
        agentDir: 'D:/OpenClaw/.openclaw/agents/research/agent',
        isDefault: false,
        model: {
          primary: 'openai/gpt-5.4-mini',
          fallbacks: [],
        },
        configSource: 'configFile',
      },
    ],
    skills: [],
    files: [],
    llmProviders: [
      {
        id: 'openai',
        name: 'OpenAI',
        provider: 'openai',
        endpoint: 'https://api.openai.com/v1',
        apiKeySource: 'env:OPENAI_API_KEY',
        status: 'ready',
        defaultModelId: 'gpt-5.4',
        reasoningModelId: 'gpt-5.4',
        embeddingModelId: 'text-embedding-3-large',
        description: 'OpenAI provider',
        icon: 'O',
        lastCheckedAt: '2026-04-03T00:00:00.000Z',
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
          maxTokens: 8192,
          timeoutMs: 60000,
          streaming: true,
        },
      },
      {
        id: 'anthropic',
        name: 'Anthropic',
        provider: 'anthropic',
        endpoint: 'https://api.anthropic.com/v1',
        apiKeySource: 'env:ANTHROPIC_API_KEY',
        status: 'configurationRequired',
        defaultModelId: 'claude-4-sonnet',
        description: 'Anthropic provider',
        icon: 'A',
        lastCheckedAt: '2026-04-03T00:00:00.000Z',
        capabilities: ['chat'],
        models: [],
        config: {
          temperature: 0.3,
          topP: 1,
          maxTokens: 8192,
          timeoutMs: 60000,
          streaming: true,
        },
      },
    ],
    memories: [],
    tools: [],
  };
}

await runTest('getInstanceConfigWorkbenchModes keeps the config header aligned to config and raw', () => {
  assert.deepEqual(getInstanceConfigWorkbenchModes().map((tab) => tab.id), ['config', 'raw']);
});

await runTest('section descriptors keep navigation labels separate from section hero titles', () => {
  const descriptors = buildInstanceConfigWorkbenchSectionDescriptors([
    'env',
    'meta',
    'cli',
    'nodeHost',
    'canvasHost',
    'acp',
    'mcp',
  ]);

  assert.deepEqual(
    descriptors.map((entry) => ({
      key: entry.key,
      label: entry.label,
      title: entry.title,
    })),
    [
      {
        key: 'env',
        label: 'Environment',
        title: 'Environment Variables',
      },
      {
        key: 'meta',
        label: 'Meta',
        title: 'Metadata',
      },
      {
        key: 'cli',
        label: 'Cli',
        title: 'CLI',
      },
      {
        key: 'nodeHost',
        label: 'NodeHost',
        title: 'Node Host',
      },
      {
        key: 'canvasHost',
        label: 'CanvasHost',
        title: 'Canvas Host',
      },
      {
        key: 'acp',
        label: 'Acp',
        title: 'ACP',
      },
      {
        key: 'mcp',
        label: 'Mcp',
        title: 'MCP',
      },
    ],
  );
});

await runTest(
  'buildInstanceConfigWorkbenchModel orders detected sections the same way control ui structures the config workbench',
  () => {
    const model = buildInstanceConfigWorkbenchModel({
      workbench: createWorkbench(),
      rawDocument: `{
  agents: {
    list: [{ id: 'main' }],
    defaults: { model: { primary: 'openai/gpt-5.4' } }
  },
  models: {
    providers: {
      openai: {}
    }
  },
  tools: {
    sessions: { visibility: 'tree' }
  },
  channels: {
    telegram: {
      enabled: true
    }
  },
  auth: {
    cooldowns: {
      overloadedBackoffMs: 45000
    }
  },
  plugins: {
    entries: {
      searxng: {}
    }
  },
  ui: {
    dense: true
  },
  customSection: {
    flag: true
  }
}
`,
    });

    assert.equal(model.document.configFile, 'D:/OpenClaw/.openclaw/openclaw.json');
    assert.equal(model.document.defaultAgentId, 'main');
    assert.equal(model.document.defaultModelRef, 'openai/gpt-5.4');
    assert.equal(model.document.sessionsVisibility, 'tree');
    assert.equal(model.document.sectionCount, 8);
    assert.equal(model.document.customSectionCount, 1);
    assert.equal(model.document.isWritable, true);
    assert.deepEqual(
      model.sections.map((section) => section.key),
      [
        'auth',
        'agents',
        'models',
        'tools',
        'channels',
        'plugins',
        'ui',
        'customSection',
      ],
    );
    assert.equal(model.sections[0]?.label, 'Authentication');
    assert.equal(model.sections[0]?.category, 'core');
    assert.deepEqual(model.sections[0]?.fieldNames, ['cooldowns']);
    assert.match(model.sections[0]?.formattedValue || '', /"overloadedBackoffMs": 45000/);
    assert.equal(model.sections[1]?.label, 'Agents');
    assert.equal(model.sections[1]?.category, 'ai');
    assert.match(model.sections[1]?.formattedValue || '', /"list"/);
    assert.equal(model.sections[7]?.label, 'Custom Section');
    assert.equal(model.sections[7]?.category, 'other');
    assert.equal(model.sections[7]?.isKnownSection, false);
    assert.equal(model.raw.lineCount, 35);
    assert.equal(model.raw.sectionCount, 8);
    assert.equal(model.raw.parseError, null);
  },
);

await runTest(
  'buildInstanceConfigWorkbenchModel keeps raw analysis resilient while the draft contains invalid JSON5',
  () => {
    const model = buildInstanceConfigWorkbenchModel({
      workbench: createWorkbench(),
      rawDocument: '{ agents: { ',
    });

    assert.equal(model.document.sectionCount, 0);
    assert.equal(model.document.customSectionCount, 0);
    assert.equal(model.sections.length, 0);
    assert.equal(model.raw.sectionCount, 0);
    assert.match(model.raw.parseError || '', /invalid|unexpected|json/i);
  },
);

await runTest(
  'buildInstanceConfigWorkbenchModel prefers kernel config truth and authority writability',
  () => {
    const workbench = createWorkbench();
    workbench.kernelConfig = {
      configFile: 'C:/Users/admin/.openclaw/openclaw.json',
      configRoot: 'C:/Users/admin/.openclaw',
      userRoot: 'C:/Users/admin',
      format: 'json',
      access: 'localFs',
      provenance: 'standardUserRoot',
      writable: true,
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

    const model = buildInstanceConfigWorkbenchModel({
      workbench,
      rawDocument: '{ models: { providers: {} } }',
    });

    assert.equal(
      model.document.configFile,
      'C:/Users/admin/.openclaw/openclaw.json',
    );
    assert.equal(model.document.isWritable, false);
  },
);

await runTest(
  'computeInstanceConfigWorkbenchDiff lists path-level changes between parsed config snapshots',
  () => {
    const diff = computeInstanceConfigWorkbenchDiff(
      `{
  update: {
    enabled: false,
    intervalHours: 12
  },
  env: {
    OPENAI_API_KEY: "${'${OPENAI_API_KEY}'}"
  }
}
`,
      `{
  update: {
    enabled: true,
    intervalHours: 24
  },
  env: {
    OPENAI_API_KEY: "sk-live-123"
  },
  channels: {
    slack: {
      enabled: true
    }
  }
}
`,
    );

    assert.equal(diff.parseError, null);
    assert.deepEqual(
      diff.entries.map((entry) => ({
        path: entry.path,
        kind: entry.kind,
        before: entry.before,
        after: entry.after,
      })),
      [
        {
          path: 'env.OPENAI_API_KEY',
          kind: 'changed',
          before: '${OPENAI_API_KEY}',
          after: 'sk-live-123',
        },
        {
          path: 'update.enabled',
          kind: 'changed',
          before: false,
          after: true,
        },
        {
          path: 'update.intervalHours',
          kind: 'changed',
          before: 12,
          after: 24,
        },
        {
          path: 'channels',
          kind: 'added',
          before: undefined,
          after: {
            slack: {
              enabled: true,
            },
          },
        },
      ],
    );
  },
);
