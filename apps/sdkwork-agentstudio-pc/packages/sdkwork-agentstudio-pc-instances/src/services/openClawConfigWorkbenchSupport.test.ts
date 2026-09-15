// WORKSPACE-PATH:allow-fixture: fixtures name a foreign checkout root, drive, or home directory to exercise path handling, so the literal is the value under assertion rather than a binding this build resolves
import assert from 'node:assert/strict';

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

let configWorkbenchSupportModule:
  | typeof import('./openClawConfigWorkbenchSupport.ts')
  | undefined;

try {
  configWorkbenchSupportModule = await import('./openClawConfigWorkbenchSupport.ts');
} catch {
  configWorkbenchSupportModule = undefined;
}

await runTest(
  'openClawConfigWorkbenchSupport exposes shared config workbench helpers',
  () => {
    assert.ok(
      configWorkbenchSupportModule,
      'Expected openClawConfigWorkbenchSupport.ts to exist',
    );
    assert.equal(
      typeof configWorkbenchSupportModule?.buildConfigWorkbenchState,
      'function',
    );
    assert.equal(
      typeof configWorkbenchSupportModule?.createEmptyOpenClawConfigSnapshot,
      'function',
    );
  },
);

await runTest(
  'buildConfigWorkbenchState clones config surfaces and derives kernel insights',
  () => {
    const configSnapshot = {
      configFile: 'D:/OpenClaw/.openclaw/openclaw.json',
      providerSnapshots: [],
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
            primary: 'openai/gpt-5.4',
            fallbacks: ['openai/gpt-5.4-mini'],
          },
          params: {
            temperature: 0.3,
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
      webSearchConfig: {
        enabled: true,
        provider: 'searxng',
        maxResults: 10,
        timeoutSeconds: 45,
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
      xSearchConfig: {
        enabled: true,
        apiKeySource: 'xai-live',
        model: 'grok-4.1',
        inlineCitations: true,
        maxTurns: 3,
        timeoutSeconds: 30,
        cacheTtlMinutes: 15,
        advancedConfig: '{\n  "userTag": "internal-research"\n}',
      },
      webSearchNativeCodexConfig: {
        enabled: true,
        mode: 'cached',
        allowedDomains: ['example.com', 'openai.com'],
        contextSize: 'high',
        userLocation: {
          country: 'US',
          city: 'New York',
          timezone: 'America/New_York',
        },
        advancedConfig: '{\n  "reasoningEffort": "medium"\n}',
      },
      webFetchConfig: {
        enabled: true,
        maxChars: 42000,
        maxCharsCap: 64000,
        maxResponseBytes: 2500000,
        timeoutSeconds: 28,
        cacheTtlMinutes: 9,
        maxRedirects: 4,
        readability: false,
        userAgent: 'SDKWork Fetch Bot/1.0',
        fallbackProvider: {
          providerId: 'firecrawl',
          name: 'Firecrawl Fetch',
          description: 'Use Firecrawl as the OpenClaw web_fetch fallback provider.',
          apiKeySource: 'fc-live',
          baseUrl: 'https://api.firecrawl.dev',
          advancedConfig: '{\n  "onlyMainContent": true\n}',
          supportsApiKey: true,
          supportsBaseUrl: true,
        },
      },
      authCooldownsConfig: {
        rateLimitedProfileRotations: 2,
        overloadedProfileRotations: 1,
        overloadedBackoffMs: 45000,
        billingBackoffHours: 5,
        billingMaxHours: 24,
        failureWindowHours: 24,
      },
      dreamingConfig: {
        enabled: true,
        frequency: '0 3 * * *',
      },
      root: {
        agents: {
          defaults: {
            model: {
              primary: 'openai/gpt-5.4',
            },
          },
        },
        tools: {
          sessions: {
            visibility: 'tree',
          },
          agentToAgent: {
            enabled: true,
            allow: ['ops-lead', ' reviewer ', '', null],
          },
        },
      },
    } as any;

    const configWorkbenchState =
      configWorkbenchSupportModule?.buildConfigWorkbenchState(
        'D:/OpenClaw/.openclaw/openclaw.json',
        configSnapshot,
      );

    assert.equal('managedConfigPath' in (configWorkbenchState || {}), false);
    assert.equal(configWorkbenchState?.configSectionCount, 1);
    assert.equal(configWorkbenchState?.kernelConfigInsights?.defaultAgentId, 'Ops Lead');
    assert.equal(
      configWorkbenchState?.kernelConfigInsights?.defaultModelRef,
      'openai/gpt-5.4',
    );
    assert.equal(configWorkbenchState?.kernelConfigInsights?.sessionsVisibility, 'tree');
    assert.equal(configWorkbenchState?.kernelConfigInsights?.agentToAgentEnabled, true);
    assert.deepEqual(
      configWorkbenchState?.kernelConfigInsights?.agentToAgentAllow,
      ['ops-lead', 'reviewer'],
    );

    configWorkbenchState?.configChannels?.[0]?.setupSteps.push('Invite bot');
    if (configWorkbenchState?.configWebSearch) {
      configWorkbenchState.configWebSearch.providers[0]!.name = 'Changed';
    }
    configWorkbenchState?.configWebSearchNativeCodex?.allowedDomains.push(
      'sdkwork.dev',
    );
    if (configWorkbenchState?.configWebFetch) {
      configWorkbenchState.configWebFetch.fallbackProvider.name = 'Changed';
    }
    if (configWorkbenchState?.configAuthCooldowns) {
      configWorkbenchState.configAuthCooldowns.failureWindowHours = 12;
    }
    if (configWorkbenchState?.configDreaming) {
      configWorkbenchState.configDreaming.frequency = '0 1 * * *';
    }

    assert.deepEqual(configSnapshot.channelSnapshots[0]?.setupSteps, ['Configure token']);
    assert.equal(configSnapshot.webSearchConfig.providers[0]?.name, 'SearXNG');
    assert.deepEqual(configSnapshot.webSearchNativeCodexConfig.allowedDomains, [
      'example.com',
      'openai.com',
    ]);
    assert.equal(configSnapshot.webFetchConfig.fallbackProvider.name, 'Firecrawl Fetch');
    assert.equal(configSnapshot.authCooldownsConfig.failureWindowHours, 24);
    assert.equal(configSnapshot.dreamingConfig.frequency, '0 3 * * *');
  },
);

await runTest(
  'createEmptyOpenClawConfigSnapshot returns isolated defaults for missing config state',
  () => {
    const first =
      configWorkbenchSupportModule?.createEmptyOpenClawConfigSnapshot(
        'D:/OpenClaw/.openclaw/openclaw.json',
      );
    const second =
      configWorkbenchSupportModule?.createEmptyOpenClawConfigSnapshot(
        'D:/OpenClaw/.openclaw/openclaw.json',
      );

    assert.equal(first?.configFile, 'D:/OpenClaw/.openclaw/openclaw.json');
    assert.deepEqual(first?.providerSnapshots, []);
    assert.deepEqual(first?.agentSnapshots, []);
    assert.deepEqual(first?.channelSnapshots, []);
    assert.equal(first?.webFetchConfig.fallbackProvider.name, 'Firecrawl Fetch');

    if (first) {
      first.webFetchConfig.fallbackProvider.name = 'Mutated';
      first.webSearchConfig.providers.push({
        id: 'searxng',
        name: 'SearXNG',
        description: 'Mutated',
        apiKeySource: '',
        baseUrl: '',
        model: '',
        advancedConfig: '',
        supportsApiKey: false,
        supportsBaseUrl: true,
        supportsModel: false,
      });
    }

    assert.equal(second?.webFetchConfig.fallbackProvider.name, 'Firecrawl Fetch');
    assert.deepEqual(second?.webSearchConfig.providers, []);
  },
);
