// WORKSPACE-PATH:allow-fixture: fixtures name a foreign checkout root, drive, or home directory to exercise path handling, so the literal is the value under assertion rather than a binding this build resolves
import assert from 'node:assert/strict';
import {
  isPersistableClientField,
  sanitizeBrowserInstanceRecord,
  sanitizeBrowserWorkbenchChannelRecord,
  sanitizeBrowserWorkbenchFileRecord,
  sanitizeBrowserWorkbenchProviderRecord,
} from './browserPersistencePolicy.ts';

const BUILT_IN_INSTANCE_ID = 'managed-openclaw-primary';

async function runTest(name: string, fn: () => Promise<void> | void) {
  try {
    await fn();
    console.log(`ok - ${name}`);
  } catch (error) {
    console.error(`not ok - ${name}`);
    throw error;
  }
}

await runTest('browser persistence policy rejects trusted and secret-bearing fields', () => {
  assert.equal(isPersistableClientField('authToken'), false);
  assert.equal(isPersistableClientField('token'), false);
  assert.equal(isPersistableClientField('workspacePath'), false);
  assert.equal(isPersistableClientField('apiKeySource'), false);
  assert.equal(isPersistableClientField('description'), true);
  assert.equal(isPersistableClientField('appId'), true);
});

await runTest('browser persistence policy strips trusted instance config state', () => {
  const sanitized = sanitizeBrowserInstanceRecord({
    id: BUILT_IN_INSTANCE_ID,
    name: 'Local Built-In',
    runtimeKind: 'openclaw',
    deploymentMode: 'local-managed',
    transportKind: 'openclawGatewayWs',
    status: 'online',
    isBuiltIn: true,
    isDefault: true,
    iconType: 'server',
    version: '2026.4.15',
    typeLabel: 'Built-In OpenClaw',
    host: '127.0.0.1',
    port: 21280,
    baseUrl: 'http://127.0.0.1:21280',
    websocketUrl: 'ws://127.0.0.1:21280',
    cpu: 0,
    memory: 0,
    totalMemory: 'Unknown',
    uptime: '-',
    capabilities: ['chat'],
    storage: {
      profileId: 'default-local',
      provider: 'localFile',
      namespace: 'agent-studio',
      database: null,
      connectionHint: null,
      endpoint: null,
    },
    config: {
      port: '21280',
      sandbox: true,
      autoUpdate: true,
      logLevel: 'info',
      corsOrigins: '*',
      workspacePath: 'C:\\kernel\\workspace',
      baseUrl: 'http://127.0.0.1:21280',
      websocketUrl: 'ws://127.0.0.1:21280',
      authToken: 'root-secret',
    },
    createdAt: 1,
    updatedAt: 2,
    lastSeenAt: 3,
  });

  assert.equal(sanitized.config.workspacePath, undefined);
  assert.equal(sanitized.config.authToken, undefined);
  assert.equal(sanitized.config.baseUrl, 'http://127.0.0.1:21280');
  assert.equal(sanitized.config.websocketUrl, 'ws://127.0.0.1:21280');
});

await runTest('browser persistence policy keeps channel counts while dropping secrets', () => {
  const sanitized = sanitizeBrowserWorkbenchChannelRecord({
    id: 'telegram',
    name: 'Telegram',
    description: 'Telegram channel',
    status: 'connected',
    enabled: true,
    configurationMode: 'required',
    fieldCount: 4,
    configuredFieldCount: 3,
    setupSteps: [],
    values: {
      botToken: '123456:telegram-token',
      webhookSecret: 'secret',
      webhookUrl: 'https://example.com/telegram/webhook',
    },
  });

  assert.equal(sanitized.configuredFieldCount, 3);
  assert.deepEqual(sanitized.values, {
    webhookUrl: 'https://example.com/telegram/webhook',
  });
});

await runTest('browser persistence policy removes provider secret sources and request overrides', () => {
  const sanitized = sanitizeBrowserWorkbenchProviderRecord({
    id: 'openai',
    name: 'OpenAI',
    provider: 'openai',
    endpoint: 'https://api.openai.com/v1',
    apiKeySource: 'env:OPENAI_API_KEY',
    status: 'ready',
    defaultModelId: 'gpt-5.4',
    reasoningModelId: 'o4-mini',
    embeddingModelId: 'text-embedding-3-large',
    description: 'OpenAI provider',
    icon: 'openai',
    lastCheckedAt: '2026-04-15T00:00:00.000Z',
    capabilities: ['chat'],
    models: [],
    config: {
      temperature: 0.2,
      topP: 1,
      maxTokens: 4096,
      timeoutMs: 60000,
      streaming: true,
      request: {
        headers: {
          Authorization: 'Bearer secret',
        },
        auth: {
          mode: 'bearer',
          token: 'secret',
        },
      },
    },
  });

  assert.equal(sanitized.apiKeySource, '');
  assert.equal(sanitized.config.request, undefined);
  assert.equal(sanitized.defaultModelId, 'gpt-5.4');
});

await runTest('browser persistence policy sanitizes generated openclaw config files before persistence', () => {
  const sanitized = sanitizeBrowserWorkbenchFileRecord({
    id: '/workspace/main/openclaw.json',
    name: 'openclaw.json',
    path: '/workspace/main/openclaw.json',
    category: 'config',
    language: 'json',
    size: '1 KB',
    updatedAt: '2026-04-15T00:00:00.000Z',
    status: 'modified',
    description: 'Generated config',
    isReadonly: false,
    content: JSON.stringify({
      channels: {
        telegram: {
          botToken: '123456:telegram-token',
          webhookSecret: 'secret',
          webhookUrl: 'https://example.com/telegram/webhook',
          enabled: true,
        },
      },
    }),
  });

  const parsed = JSON.parse(sanitized.content) as {
    channels?: {
      telegram?: Record<string, unknown>;
    };
  };

  assert.deepEqual(parsed.channels?.telegram, {
    webhookUrl: 'https://example.com/telegram/webhook',
    enabled: true,
  });
});
