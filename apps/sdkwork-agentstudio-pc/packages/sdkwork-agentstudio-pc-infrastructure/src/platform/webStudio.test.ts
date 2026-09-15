// WORKSPACE-PATH:allow-fixture: fixtures name a foreign checkout root, drive, or home directory to exercise path handling, so the literal is the value under assertion rather than a binding this build resolves
import assert from 'node:assert/strict';
import {
  DEFAULT_BUNDLED_OPENCLAW_VERSION,
  STABLE_BUILT_IN_OPENCLAW_INSTANCE_ID,
} from '@sdkwork/agentstudio-pc-types';
import { WebStudioPlatform } from './webStudio.ts';

async function runTest(name: string, fn: () => Promise<void>) {
  try {
    await fn();
    console.log(`ok - ${name}`);
  } catch (error) {
    console.error(`not ok - ${name}`);
    throw error;
  }
}

const INSTANCE_STORAGE_KEY = 'agent-studio:studio:instances:v1';
const WORKBENCH_STORAGE_KEY = 'agent-studio:studio:workbench:v1';
const BUILT_IN_INSTANCE_ID = STABLE_BUILT_IN_OPENCLAW_INSTANCE_ID;

function derivePreviousNumericVersion(version: string) {
  const match = String(version).match(
    /^(\d+)\.(\d+)\.(\d+)(?:-(?:\d+|[0-9A-Za-z]+(?:\.[0-9A-Za-z]+)*))?$/u,
  );
  assert.ok(match, `Expected numeric OpenClaw test version, received ${version}`);

  const major = Number.parseInt(match[1], 10);
  const minor = Number.parseInt(match[2], 10);
  const patch = Number.parseInt(match[3], 10);

  if (patch > 0) {
    return `${major}.${minor}.${patch - 1}`;
  }
  if (minor > 0) {
    return `${major}.${minor - 1}.0`;
  }
  assert.ok(major > 0, `Expected a previous numeric version to exist for ${version}`);
  return `${major - 1}.0.0`;
}

const staleOpenClawVersion = derivePreviousNumericVersion(DEFAULT_BUNDLED_OPENCLAW_VERSION);

interface MockedWindowStorageContext {
  storage: Map<string, string>;
  readJson(key: string): unknown;
}

async function withMockedWindowStorage(
  fn: (context: MockedWindowStorageContext) => Promise<void>,
) {
  const originalWindow = (globalThis as typeof globalThis & { window?: unknown }).window;
  const storage = new Map<string, string>();
  const localStorage = {
    getItem(key: string) {
      return storage.get(key) ?? null;
    },
    setItem(key: string, value: string) {
      storage.set(key, value);
    },
    removeItem(key: string) {
      storage.delete(key);
    },
  };

  (globalThis as typeof globalThis & { window?: { localStorage: typeof localStorage } }).window = {
    localStorage,
  };

  try {
    await fn({
      storage,
      readJson(key: string) {
        const value = storage.get(key);
        return value ? JSON.parse(value) : null;
      },
    });
  } finally {
    (globalThis as typeof globalThis & { window?: unknown }).window = originalWindow;
  }
}

async function withBlockedWindowStorage(fn: () => Promise<void>) {
  const originalWindow = (globalThis as typeof globalThis & { window?: unknown }).window;

  (globalThis as typeof globalThis & { window?: unknown }).window = {
    get localStorage() {
      throw new DOMException('localStorage is blocked', 'SecurityError');
    },
  };

  try {
    await fn();
  } finally {
    (globalThis as typeof globalThis & { window?: unknown }).window = originalWindow;
  }
}

await runTest('web studio persists created OpenClaw workbench tasks through instance detail', async () => {
  await withMockedWindowStorage(async () => {
    const platform = new WebStudioPlatform();
    const taskName = 'Web studio main session cron test';

    await platform.createInstanceTask(BUILT_IN_INSTANCE_ID, {
      name: taskName,
      description: 'Runs on the main session heartbeat.',
      enabled: true,
      schedule: {
        kind: 'cron',
        expr: '0 9 * * *',
      },
      sessionTarget: 'main',
      wakeMode: 'next-heartbeat',
      payload: {
        kind: 'systemEvent',
        text: 'Post a main-session reminder.',
      },
    });

    const detail = await platform.getInstanceDetail(BUILT_IN_INSTANCE_ID);
    const created = detail?.workbench?.cronTasks.tasks.find((task) => task.name === taskName);

    assert.ok(created);
    assert.equal(created.sessionMode, 'main');
    assert.equal(created.executionContent, 'sendPromptMessage');
    assert.equal(created.deliveryMode, 'none');
    assert.equal(created.deliveryChannel, undefined);
    assert.equal(created.recipient, undefined);
  });
});

await runTest('web studio preserves advanced OpenClaw cron fields inside the persisted workbench detail', async () => {
  await withMockedWindowStorage(async () => {
    const platform = new WebStudioPlatform();

    await platform.createInstanceTask(BUILT_IN_INSTANCE_ID, {
      name: 'Web studio advanced cron source',
      description: 'Created as a baseline task before OpenClaw-style update.',
      enabled: true,
      schedule: {
        kind: 'cron',
        expr: '0 8 * * *',
      },
      sessionTarget: 'isolated',
      wakeMode: 'now',
      payload: {
        kind: 'agentTurn',
        message: 'Baseline prompt.',
        timeoutSeconds: 120,
      },
      delivery: {
        mode: 'announce',
        channel: 'telegram',
        to: 'channel:baseline',
      },
    });

    const originalDetail = await platform.getInstanceDetail(BUILT_IN_INSTANCE_ID);
    const original = originalDetail?.workbench?.cronTasks.tasks.find(
      (task) => task.name === 'Web studio advanced cron source',
    );

    assert.ok(original);

    await platform.updateInstanceTask(BUILT_IN_INSTANCE_ID, original.id, {
      name: 'Web studio advanced cron mapped',
      description: 'Uses a persistent custom session and webhook delivery.',
      enabled: false,
      deleteAfterRun: true,
      agentId: 'ops',
      schedule: {
        kind: 'cron',
        expr: '0 7 * * *',
        tz: 'Asia/Shanghai',
        staggerMs: 30000,
      },
      sessionTarget: 'session:project-alpha-monitor',
      wakeMode: 'now',
      payload: {
        kind: 'agentTurn',
        message: 'Summarize overnight updates.',
        model: 'openai/gpt-5.4',
        thinking: 'high',
        timeoutSeconds: 600,
        lightContext: true,
      },
      delivery: {
        mode: 'webhook',
        to: 'https://hooks.example.com/openclaw/cron',
        bestEffort: true,
      },
    });

    const updatedDetail = await platform.getInstanceDetail(BUILT_IN_INSTANCE_ID);
    const updated = updatedDetail?.workbench?.cronTasks.tasks.find((task) => task.id === original.id);

    assert.ok(updated);
    assert.equal(updated.name, 'Web studio advanced cron mapped');
    assert.equal(updated.status, 'paused');
    assert.equal(updated.sessionMode, 'custom');
    assert.equal(updated.customSessionId, 'project-alpha-monitor');
    assert.equal(updated.executionContent, 'runAssistantTask');
    assert.equal(updated.deleteAfterRun, true);
    assert.equal(updated.agentId, 'ops');
    assert.equal(updated.model, 'openai/gpt-5.4');
    assert.equal(updated.thinking, 'high');
    assert.equal(updated.lightContext, true);
    assert.equal(updated.deliveryMode, 'webhook');
    assert.equal(updated.deliveryBestEffort, true);
    assert.equal(updated.deliveryChannel, undefined);
    assert.equal(updated.recipient, 'https://hooks.example.com/openclaw/cron');
    assert.equal(updated.scheduleConfig.cronTimezone, 'Asia/Shanghai');
    assert.equal(updated.scheduleConfig.staggerMs, 30000);
  });
});

await runTest('web studio persists current-session OpenClaw jobs, file edits, and provider edits through the workbench detail', async () => {
  await withMockedWindowStorage(async ({ readJson }) => {
    const platform = new WebStudioPlatform();
    const taskName = 'Web studio current session cron test';

    await platform.createInstanceTask(BUILT_IN_INSTANCE_ID, {
      name: taskName,
      description: 'Runs against the current session context.',
      enabled: true,
      schedule: {
        kind: 'cron',
        expr: '*/30 * * * *',
      },
      sessionTarget: 'current',
      wakeMode: 'now',
      payload: {
        kind: 'agentTurn',
        message: 'Check the current session context.',
        timeoutSeconds: 90,
      },
      delivery: {
        mode: 'announce',
        channel: 'telegram',
        to: 'channel:current-session',
        bestEffort: true,
      },
    });

    const taskDetail = await platform.getInstanceDetail(BUILT_IN_INSTANCE_ID);
    const created = taskDetail?.workbench?.cronTasks.tasks.find((task) => task.name === taskName);

    assert.ok(created);
    assert.equal(created.sessionMode, 'current');
    assert.equal(created.customSessionId, undefined);
    assert.equal(created.deliveryMode, 'publishSummary');
    assert.equal(created.deliveryBestEffort, true);
    assert.equal(created.deliveryChannel, 'telegram');
    assert.equal(created.recipient, 'channel:current-session');

    const nextAgentsContent = '# Updated from web fallback';
    const nextModelId = 'gpt-5.4';

    const fileUpdated = await platform.updateInstanceFileContent(
      BUILT_IN_INSTANCE_ID,
      '/workspace/main/AGENTS.md',
      nextAgentsContent,
    );
    const providerUpdated = await platform.updateInstanceLlmProviderConfig(BUILT_IN_INSTANCE_ID, 'openai', {
      endpoint: 'https://api.openai.com/v1',
      apiKeySource: 'env:OPENAI_API_KEY',
      defaultModelId: nextModelId,
      reasoningModelId: 'o4-mini',
      embeddingModelId: 'text-embedding-3-large',
      config: {
        temperature: 0.2,
        topP: 1,
        maxTokens: 4096,
        timeoutMs: 60000,
        streaming: true,
      },
    });

    assert.equal(fileUpdated, true);
    assert.equal(providerUpdated, true);

    const updatedDetail = await platform.getInstanceDetail(BUILT_IN_INSTANCE_ID);
    assert.equal(
      updatedDetail?.workbench?.files.find((file) => file.id === '/workspace/main/AGENTS.md')?.content,
      nextAgentsContent,
    );
    assert.equal(
      updatedDetail?.workbench?.llmProviders.find((provider) => provider.id === 'openai')?.defaultModelId,
      nextModelId,
    );
    const persistedWorkbench = readJson(WORKBENCH_STORAGE_KEY) as {
      workbenches?: Record<string, {
        llmProviders?: Array<{
          id: string;
          endpoint?: string;
          apiKeySource?: string;
          config?: {
            request?: unknown;
          };
        }>;
      }>;
    } | null;
    const persistedProvider = persistedWorkbench?.workbenches?.[STABLE_BUILT_IN_OPENCLAW_INSTANCE_ID]?.llmProviders?.find(
      (provider) => provider.id === 'openai',
    );

    assert.ok(persistedProvider);
    assert.equal(persistedProvider?.endpoint, 'https://api.openai.com/v1');
    assert.equal(persistedProvider?.apiKeySource, '');
    assert.equal(persistedProvider?.config?.request, undefined);
  });
});

await runTest('web studio persists managed channel configuration through the browser workbench detail', async () => {
  await withMockedWindowStorage(async ({ readJson }) => {
    const platform = new WebStudioPlatform();

    const saved = await platform.saveInstanceChannelConfig(BUILT_IN_INSTANCE_ID, 'telegram', {
      botToken: '123456:telegram-token',
      webhookUrl: 'https://example.com/openclaw/telegram',
      webhookSecret: 'secret',
    });

    assert.equal(saved, true);

    let detail = await platform.getInstanceDetail(BUILT_IN_INSTANCE_ID);
    let telegram = detail?.workbench?.channels.find((channel) => channel.id === 'telegram') as
      | ({ values?: Record<string, string> } & NonNullable<
          NonNullable<typeof detail>['workbench']
        >['channels'][number])
      | undefined;

    assert.ok(telegram);
    assert.equal(telegram?.fieldCount > 0, true);
    assert.equal(telegram?.enabled, true);
    assert.equal(telegram?.status, 'connected');
    assert.equal(telegram?.configuredFieldCount, 3);
    assert.equal(telegram?.values?.webhookUrl, 'https://example.com/openclaw/telegram');
    assert.equal(telegram?.values?.botToken, undefined);
    assert.equal(telegram?.values?.webhookSecret, undefined);

    const persistedWorkbench = readJson(WORKBENCH_STORAGE_KEY) as {
      workbenches?: Record<string, {
        channels?: Array<{
          id: string;
          configuredFieldCount?: number;
          values?: Record<string, string>;
        }>;
        files?: Array<{
          id: string;
          content: string;
        }>;
      }>;
    } | null;
    const persistedTelegram = persistedWorkbench?.workbenches?.[STABLE_BUILT_IN_OPENCLAW_INSTANCE_ID]?.channels?.find(
      (channel) => channel.id === 'telegram',
    );
    const persistedConfigFile = persistedWorkbench?.workbenches?.[STABLE_BUILT_IN_OPENCLAW_INSTANCE_ID]?.files?.find(
      (file) => file.id === '/workspace/main/openclaw.json',
    );
    const persistedConfigRoot = persistedConfigFile
      ? JSON.parse(persistedConfigFile.content) as {
          channels?: Record<string, Record<string, unknown>>;
        }
      : null;

    assert.ok(persistedTelegram);
    assert.equal(persistedTelegram?.configuredFieldCount, 3);
    assert.deepEqual(persistedTelegram?.values, {
      webhookUrl: 'https://example.com/openclaw/telegram',
    });
    assert.deepEqual(persistedConfigRoot?.channels?.telegram, {
      webhookUrl: 'https://example.com/openclaw/telegram',
      enabled: true,
    });

    const disabled = await platform.setInstanceChannelEnabled(BUILT_IN_INSTANCE_ID, 'telegram', false);
    assert.equal(disabled, true);

    detail = await platform.getInstanceDetail(BUILT_IN_INSTANCE_ID);
    telegram = detail?.workbench?.channels.find((channel) => channel.id === 'telegram') as
      | ({ values?: Record<string, string> } & NonNullable<
          NonNullable<typeof detail>['workbench']
        >['channels'][number])
      | undefined;

    assert.ok(telegram);
    assert.equal(telegram?.enabled, false);
    assert.equal(telegram?.status, 'disconnected');
    assert.equal(telegram?.configuredFieldCount, 3);
    assert.equal(telegram?.values?.webhookSecret, undefined);

    const deleted = await platform.deleteInstanceChannelConfig(BUILT_IN_INSTANCE_ID, 'telegram');
    assert.equal(deleted, true);

    detail = await platform.getInstanceDetail(BUILT_IN_INSTANCE_ID);
    telegram = detail?.workbench?.channels.find((channel) => channel.id === 'telegram') as
      | ({ values?: Record<string, string> } & NonNullable<
          NonNullable<typeof detail>['workbench']
        >['channels'][number])
      | undefined;

    assert.ok(telegram);
    assert.equal(telegram?.enabled, false);
    assert.equal(telegram?.status, 'not_configured');
    assert.deepEqual(telegram?.values || {}, {});
  });
});

await runTest('web studio does not fabricate OpenAI HTTP endpoints for the built-in OpenClaw gateway metadata', async () => {
  const platform = new WebStudioPlatform();

  const detail = await platform.getInstanceDetail(BUILT_IN_INSTANCE_ID);

  assert.ok(detail);
  assert.equal(detail.lifecycle.owner, 'appManaged');
  assert.equal(detail.lifecycle.startStopSupported, false);
  assert.equal(detail.lifecycle.configWritable, true);
  assert.equal(detail.lifecycle.lifecycleControllable, false);
  assert.equal(detail.lifecycle.workbenchManaged, true);
  assert.equal(detail.lifecycle.endpointObserved, false);
  assert.ok(detail.connectivity.endpoints.some((endpoint) => endpoint.id === 'gateway-http'));
  assert.ok(detail.connectivity.endpoints.some((endpoint) => endpoint.id === 'gateway-ws'));
  assert.ok(!detail.connectivity.endpoints.some((endpoint) => endpoint.id === 'openai-http-chat'));
  assert.ok(
    detail.officialRuntimeNotes.some((note) =>
      note.content.includes('optionally expose OpenAI-compatible HTTP endpoints when enabled'),
    ),
  );
});

await runTest('web studio creates the browser fallback built-in OpenClaw instance on the canonical gateway authority', async () => {
  await withMockedWindowStorage(async () => {
    const platform = new WebStudioPlatform();

    const instances = await platform.listInstances();
    const builtIn = instances.find((instance) => instance.id === BUILT_IN_INSTANCE_ID);

    assert.ok(builtIn);
    assert.equal(builtIn?.port, 21280);
    assert.equal(builtIn?.baseUrl, 'http://127.0.0.1:21280');
    assert.equal(builtIn?.websocketUrl, 'ws://127.0.0.1:21280');
    assert.equal(builtIn?.config.port, '21280');
    assert.equal(builtIn?.config.baseUrl, 'http://127.0.0.1:21280');
    assert.equal(builtIn?.config.websocketUrl, 'ws://127.0.0.1:21280');
  });
});

await runTest('web studio rejects retired OpenClaw channel ids before they reach persisted config', async () => {
  await withMockedWindowStorage(async ({ readJson }) => {
    const platform = new WebStudioPlatform();

    const saved = await platform.saveInstanceChannelConfig(BUILT_IN_INSTANCE_ID, 'qq', {
      botToken: 'legacy-token',
    });
    const toggled = await platform.setInstanceChannelEnabled(BUILT_IN_INSTANCE_ID, 'qq', true);
    const deleted = await platform.deleteInstanceChannelConfig(BUILT_IN_INSTANCE_ID, 'qq');

    assert.equal(saved, false);
    assert.equal(toggled, false);
    assert.equal(deleted, false);

    const detail = await platform.getInstanceDetail(BUILT_IN_INSTANCE_ID);
    assert.ok(!detail?.workbench?.channels.some((channel) => channel.id === 'qq'));

    const persistedWorkbench = readJson(WORKBENCH_STORAGE_KEY) as {
      workbenches?: Record<string, {
        channels?: Array<{ id: string }>;
        files?: Array<{
          id: string;
          content: string;
        }>;
      }>;
    } | null;
    const persistedBuiltIn = persistedWorkbench?.workbenches?.[STABLE_BUILT_IN_OPENCLAW_INSTANCE_ID];
    const persistedConfigFile = persistedBuiltIn?.files?.find(
      (file) => file.id === '/workspace/main/openclaw.json',
    );
    const persistedConfigRoot = persistedConfigFile
      ? JSON.parse(persistedConfigFile.content) as {
          channels?: Record<string, Record<string, unknown>>;
        }
      : null;

    assert.ok(!persistedBuiltIn?.channels?.some((channel) => channel.id === 'qq'));
    assert.equal(persistedConfigRoot?.channels?.qq, undefined);
  });
});

await runTest('web studio prunes retired channel ids while preserving OpenClaw channel metadata roots', async () => {
  await withMockedWindowStorage(async ({ readJson }) => {
    const platform = new WebStudioPlatform();

    await platform.updateInstanceFileContent(
      BUILT_IN_INSTANCE_ID,
      '/workspace/main/openclaw.json',
      `${JSON.stringify({
        channels: {
          defaults: {
            contextVisibility: 'quote',
          },
          modelByChannel: {
            feishu: {
              '*': 'openai/gpt-5.4',
            },
            telegram: {
              '*': 'openai/gpt-5.4',
            },
            qq: {
              '*': 'openai/gpt-legacy',
            },
            dingtalk: {
              '*': 'openai/gpt-legacy',
            },
          },
          qq: {
            enabled: true,
            botKey: 'legacy-key',
          },
        },
      }, null, 2)}\n`,
    );

    const saved = await platform.saveInstanceChannelConfig(BUILT_IN_INSTANCE_ID, 'telegram', {
      botToken: '123456:telegram-token',
    });

    assert.equal(saved, true);

    const persistedWorkbench = readJson(WORKBENCH_STORAGE_KEY) as {
      workbenches?: Record<string, {
        files?: Array<{
          id: string;
          content: string;
        }>;
      }>;
    } | null;
    const persistedConfigFile = persistedWorkbench?.workbenches?.[STABLE_BUILT_IN_OPENCLAW_INSTANCE_ID]?.files?.find(
      (file) => file.id === '/workspace/main/openclaw.json',
    );
    const persistedConfigRoot = persistedConfigFile
      ? JSON.parse(persistedConfigFile.content) as {
          channels?: Record<string, unknown>;
        }
      : null;

    assert.deepEqual(persistedConfigRoot?.channels?.defaults, {
      contextVisibility: 'quote',
    });
    assert.deepEqual(persistedConfigRoot?.channels?.modelByChannel, {
      feishu: {
        '*': 'openai/gpt-5.4',
      },
      qqbot: {
        '*': 'openai/gpt-legacy',
      },
      telegram: {
        '*': 'openai/gpt-5.4',
      },
    });
    assert.equal(persistedConfigRoot?.channels?.qq, undefined);
    assert.deepEqual(persistedConfigRoot?.channels?.qqbot, {
      enabled: true,
      botKey: 'legacy-key',
    });
  });
});

await runTest('web studio removes the channels root when only retired channel config remains', async () => {
  await withMockedWindowStorage(async ({ readJson }) => {
    const platform = new WebStudioPlatform();

    await platform.updateInstanceFileContent(
      BUILT_IN_INSTANCE_ID,
      '/workspace/main/openclaw.json',
      `${JSON.stringify({
        channels: {
          modelByChannel: {
            dingtalk: {
              '*': 'openai/gpt-legacy',
            },
          },
          dingtalk: {
            enabled: true,
            accessToken: 'legacy-token',
          },
        },
      }, null, 2)}\n`,
    );

    const saved = await platform.saveInstanceChannelConfig(BUILT_IN_INSTANCE_ID, 'telegram', {
      botToken: '123456:telegram-token',
    });
    const deleted = await platform.deleteInstanceChannelConfig(BUILT_IN_INSTANCE_ID, 'telegram');

    assert.equal(saved, true);
    assert.equal(deleted, true);

    const persistedWorkbench = readJson(WORKBENCH_STORAGE_KEY) as {
      workbenches?: Record<string, {
        files?: Array<{
          id: string;
          content: string;
        }>;
      }>;
    } | null;
    const persistedConfigFile = persistedWorkbench?.workbenches?.[STABLE_BUILT_IN_OPENCLAW_INSTANCE_ID]?.files?.find(
      (file) => file.id === '/workspace/main/openclaw.json',
    );
    const persistedConfigRoot = persistedConfigFile
      ? JSON.parse(persistedConfigFile.content) as {
          channels?: Record<string, unknown>;
        }
      : null;

    assert.equal(persistedConfigRoot?.channels, undefined);
  });
});

await runTest('web studio migrates legacy qq config when only canonical qqbot remains after pruning', async () => {
  await withMockedWindowStorage(async ({ readJson }) => {
    const platform = new WebStudioPlatform();

    await platform.updateInstanceFileContent(
      BUILT_IN_INSTANCE_ID,
      '/workspace/main/openclaw.json',
      `${JSON.stringify({
        channels: {
          modelByChannel: {
            qq: {
              '*': 'openai/gpt-legacy',
            },
            dingtalk: {
              '*': 'openai/gpt-legacy',
            },
          },
          qq: {
            enabled: true,
            botKey: 'legacy-key',
          },
          dingtalk: {
            enabled: true,
            accessToken: 'legacy-token',
          },
        },
      }, null, 2)}\n`,
    );

    const saved = await platform.saveInstanceChannelConfig(BUILT_IN_INSTANCE_ID, 'telegram', {
      botToken: '123456:telegram-token',
    });
    const deleted = await platform.deleteInstanceChannelConfig(BUILT_IN_INSTANCE_ID, 'telegram');

    assert.equal(saved, true);
    assert.equal(deleted, true);

    const persistedWorkbench = readJson(WORKBENCH_STORAGE_KEY) as {
      workbenches?: Record<string, {
        files?: Array<{
          id: string;
          content: string;
        }>;
      }>;
    } | null;
    const persistedConfigFile = persistedWorkbench?.workbenches?.[STABLE_BUILT_IN_OPENCLAW_INSTANCE_ID]?.files?.find(
      (file) => file.id === '/workspace/main/openclaw.json',
    );
    const persistedConfigRoot = persistedConfigFile
      ? JSON.parse(persistedConfigFile.content) as {
          channels?: Record<string, unknown>;
        }
      : null;

    assert.deepEqual(persistedConfigRoot?.channels, {
      modelByChannel: {
        qqbot: {
          '*': 'openai/gpt-legacy',
        },
      },
      qqbot: {
        enabled: true,
        botKey: 'legacy-key',
      },
    });
  });
});

await runTest('web studio removes malformed supported channel config roots', async () => {
  await withMockedWindowStorage(async ({ readJson }) => {
    const platform = new WebStudioPlatform();

    await platform.updateInstanceFileContent(
      BUILT_IN_INSTANCE_ID,
      '/workspace/main/openclaw.json',
      `${JSON.stringify({
        channels: {
          telegram: '123456:telegram-token',
          slack: ['xoxb-token'],
          modelByChannel: {
            telegram: {
              '*': 'openai/gpt-5.4',
            },
            slack: {
              C123: 'openai/gpt-5.4',
            },
          },
        },
      }, null, 2)}\n`,
    );

    const saved = await platform.saveInstanceChannelConfig(BUILT_IN_INSTANCE_ID, 'telegram', {
      botToken: '123456:telegram-token',
    });
    const deleted = await platform.deleteInstanceChannelConfig(BUILT_IN_INSTANCE_ID, 'telegram');

    assert.equal(saved, true);
    assert.equal(deleted, true);

    const persistedWorkbench = readJson(WORKBENCH_STORAGE_KEY) as {
      workbenches?: Record<string, {
        files?: Array<{
          id: string;
          content: string;
        }>;
      }>;
    } | null;
    const persistedConfigFile = persistedWorkbench?.workbenches?.[STABLE_BUILT_IN_OPENCLAW_INSTANCE_ID]?.files?.find(
      (file) => file.id === '/workspace/main/openclaw.json',
    );
    const persistedConfigRoot = persistedConfigFile
      ? JSON.parse(persistedConfigFile.content) as {
          channels?: Record<string, unknown>;
        }
      : null;

    assert.deepEqual(persistedConfigRoot?.channels, {
      modelByChannel: {
        telegram: {
          '*': 'openai/gpt-5.4',
        },
        slack: {
          C123: 'openai/gpt-5.4',
        },
      },
    });
  });
});

await runTest('web studio removes malformed channel metadata roots and model override maps', async () => {
  await withMockedWindowStorage(async ({ readJson }) => {
    const platform = new WebStudioPlatform();

    await platform.updateInstanceFileContent(
      BUILT_IN_INSTANCE_ID,
      '/workspace/main/openclaw.json',
      `${JSON.stringify({
        channels: {
          defaults: 'always-on',
          modelByChannel: {
            telegram: {
              '*': 'openai/gpt-5.4',
              C123: 42,
            },
            slack: 'openai/gpt-legacy',
            qq: {
              '*': 'openai/gpt-legacy',
            },
          },
          telegram: {
            botToken: '123456:telegram-token',
          },
        },
      }, null, 2)}\n`,
    );

    const saved = await platform.saveInstanceChannelConfig(BUILT_IN_INSTANCE_ID, 'telegram', {
      botToken: '123456:telegram-token',
    });

    assert.equal(saved, true);

    const persistedWorkbench = readJson(WORKBENCH_STORAGE_KEY) as {
      workbenches?: Record<string, {
        files?: Array<{
          id: string;
          content: string;
        }>;
      }>;
    } | null;
    const persistedConfigFile = persistedWorkbench?.workbenches?.[STABLE_BUILT_IN_OPENCLAW_INSTANCE_ID]?.files?.find(
      (file) => file.id === '/workspace/main/openclaw.json',
    );
    const persistedConfigRoot = persistedConfigFile
      ? JSON.parse(persistedConfigFile.content) as {
          channels?: Record<string, unknown>;
        }
      : null;

    assert.equal(persistedConfigRoot?.channels?.defaults, undefined);
    assert.deepEqual(persistedConfigRoot?.channels?.modelByChannel, {
      telegram: {
        '*': 'openai/gpt-5.4',
      },
      qqbot: {
        '*': 'openai/gpt-legacy',
      },
    });
  });
});

await runTest('web studio keeps browser fallback state in memory when localStorage is blocked', async () => {
  await withBlockedWindowStorage(async () => {
    const platform = new WebStudioPlatform();

    const created = await platform.createInstance({
      name: 'Blocked Storage Runtime',
      description: 'Runtime created while localStorage is unavailable.',
      runtimeKind: 'openclaw',
      deploymentMode: 'remote',
      transportKind: 'openclawGatewayWs',
      iconType: 'server',
      typeLabel: 'OpenClaw Gateway',
      host: 'openclaw.example.com',
      port: 443,
      baseUrl: 'https://openclaw.example.com',
      websocketUrl: 'wss://openclaw.example.com/ws',
      config: {
        port: '443',
        sandbox: true,
        autoUpdate: false,
        logLevel: 'info',
        corsOrigins: '*',
        baseUrl: 'https://openclaw.example.com',
        websocketUrl: 'wss://openclaw.example.com/ws',
      },
    });

    const instances = await platform.listInstances();

    assert.ok(instances.some((instance) => instance.id === BUILT_IN_INSTANCE_ID));
    assert.ok(instances.some((instance) => instance.id === created.id));
  });
});

await runTest('web studio preserves an explicitly configured OpenClaw responses endpoint without inventing chat completions', async () => {
  const originalWindow = (globalThis as typeof globalThis & { window?: unknown }).window;
  const storage = new Map<string, string>();
  const localStorage = {
    getItem(key: string) {
      return storage.get(key) ?? null;
    },
    setItem(key: string, value: string) {
      storage.set(key, value);
    },
    removeItem(key: string) {
      storage.delete(key);
    },
  };

  (globalThis as typeof globalThis & { window?: { localStorage: typeof localStorage } }).window = {
    localStorage,
  };

  try {
    const platform = new WebStudioPlatform();
    const created = await platform.createInstance({
      name: 'Responses Runtime',
      description: 'OpenClaw runtime with an explicit responses endpoint.',
      runtimeKind: 'openclaw',
      deploymentMode: 'local-external',
      transportKind: 'openclawGatewayWs',
      iconType: 'server',
      typeLabel: 'OpenClaw Responses',
      host: '127.0.0.1',
      port: 18802,
      baseUrl: 'http://127.0.0.1:18802/v1/responses',
      websocketUrl: 'ws://127.0.0.1:18802',
      config: {
        port: '18802',
        sandbox: true,
        autoUpdate: false,
        logLevel: 'info',
        corsOrigins: '*',
        baseUrl: 'http://127.0.0.1:18802/v1/responses',
        websocketUrl: 'ws://127.0.0.1:18802',
      },
    });

    const detail = await platform.getInstanceDetail(created.id);

    assert.ok(detail);
    assert.ok(detail.connectivity.endpoints.some((endpoint) => endpoint.id === 'gateway-http'));
    assert.ok(detail.connectivity.endpoints.some((endpoint) => endpoint.id === 'gateway-ws'));
    assert.ok(!detail.connectivity.endpoints.some((endpoint) => endpoint.id === 'openai-http-chat'));
    assert.ok(
      detail.connectivity.endpoints.some(
        (endpoint) =>
          endpoint.id === 'openai-http-responses' &&
          endpoint.url === 'http://127.0.0.1:18802/v1/responses',
      ),
    );
  } finally {
    (globalThis as typeof globalThis & { window?: unknown }).window = originalWindow;
  }
});

await runTest(
  'web studio treats custom local OpenClaw entries carrying local-managed labels as external metadata-only runtimes',
  async () => {
    await withMockedWindowStorage(async () => {
      const platform = new WebStudioPlatform();
      const created = await platform.createInstance({
        name: 'Custom Local Managed',
        description: 'OpenClaw metadata with local-managed deployment labels but no built-in controller.',
        runtimeKind: 'openclaw',
        deploymentMode: 'local-managed',
        transportKind: 'openclawGatewayWs',
        iconType: 'server',
        typeLabel: 'Custom Local Managed',
        host: '127.0.0.1',
        port: 18812,
        baseUrl: 'http://127.0.0.1:18812',
        websocketUrl: 'ws://127.0.0.1:18812',
        config: {
          port: '18812',
          sandbox: true,
          autoUpdate: false,
          logLevel: 'info',
          corsOrigins: '*',
          baseUrl: 'http://127.0.0.1:18812',
          websocketUrl: 'ws://127.0.0.1:18812',
        },
      });

      const detail = await platform.getInstanceDetail(created.id);

      assert.ok(detail);
      assert.equal(detail.lifecycle.owner, 'externalProcess');
      assert.equal(detail.lifecycle.startStopSupported, false);
      assert.equal(detail.lifecycle.configWritable, false);
      assert.equal(detail.lifecycle.lifecycleControllable, false);
      assert.equal(detail.lifecycle.workbenchManaged, false);
      assert.equal(detail.lifecycle.endpointObserved, false);
      assert.equal(detail.workbench, null);
    });
  },
);

await runTest('web studio strips trusted built-in instance config state from browser storage', async () => {
  await withMockedWindowStorage(async ({ readJson }) => {
    const platform = new WebStudioPlatform();

    await platform.updateInstanceConfig(BUILT_IN_INSTANCE_ID, {
      port: '21280',
      sandbox: true,
      autoUpdate: true,
      logLevel: 'info',
      corsOrigins: '*',
      workspacePath: 'C:\\kernel\\workspace',
      baseUrl: 'http://127.0.0.1:21280',
      websocketUrl: 'ws://127.0.0.1:21280',
      authToken: 'root-secret',
    });

    const config = await platform.getInstanceConfig(BUILT_IN_INSTANCE_ID);
    const persistedInstances = readJson(INSTANCE_STORAGE_KEY) as {
      instances?: Array<{
        id: string;
        config?: {
          workspacePath?: string | null;
          authToken?: string | null;
          baseUrl?: string | null;
          websocketUrl?: string | null;
        };
      }>;
    } | null;
    const persistedBuiltIn = persistedInstances?.instances?.find(
      (instance) => instance.id === STABLE_BUILT_IN_OPENCLAW_INSTANCE_ID,
    );

    assert.equal(config?.workspacePath, undefined);
    assert.equal(config?.authToken, undefined);
    assert.ok(persistedBuiltIn);
    assert.equal(persistedBuiltIn?.config?.workspacePath, undefined);
    assert.equal(persistedBuiltIn?.config?.authToken, undefined);
    assert.equal(persistedBuiltIn?.config?.baseUrl, 'http://127.0.0.1:21280');
    assert.equal(persistedBuiltIn?.config?.websocketUrl, 'ws://127.0.0.1:21280');
  });
});

await runTest('web studio keeps the built-in OpenClaw gateway authority canonical when config updates carry non-canonical endpoint metadata', async () => {
  await withMockedWindowStorage(async () => {
    const platform = new WebStudioPlatform();

    const config = await platform.updateInstanceConfig(BUILT_IN_INSTANCE_ID, {
      port: '30080',
      sandbox: true,
      autoUpdate: true,
      logLevel: 'debug',
      corsOrigins: '*',
      baseUrl: 'http://127.0.0.1:30080',
      websocketUrl: 'ws://127.0.0.1:30080',
    });
    const builtIn = await platform.getInstance(BUILT_IN_INSTANCE_ID);

    assert.equal(config?.port, '21280');
    assert.equal(config?.baseUrl, 'http://127.0.0.1:21280');
    assert.equal(config?.websocketUrl, 'ws://127.0.0.1:21280');
    assert.equal(config?.logLevel, 'debug');
    assert.equal(builtIn?.port, 21280);
    assert.equal(builtIn?.baseUrl, 'http://127.0.0.1:21280');
    assert.equal(builtIn?.websocketUrl, 'ws://127.0.0.1:21280');
  });
});

await runTest('web studio preserves future kernel identity in generic runtime notes', async () => {
  await withMockedWindowStorage(async () => {
    const platform = new WebStudioPlatform();
    const created = await platform.createInstance({
      name: 'PhoenixClaw Remote',
      description: 'Future kernel metadata should keep its runtime identity.',
      runtimeKind: 'phoenixclaw',
      deploymentMode: 'remote',
      transportKind: 'phoenixSocket',
      iconType: 'server',
      typeLabel: 'PhoenixClaw',
      host: 'phoenix.example.com',
      port: 443,
      baseUrl: 'https://phoenix.example.com/runtime',
      websocketUrl: 'wss://phoenix.example.com/runtime/ws',
      config: {
        port: '443',
        sandbox: true,
        autoUpdate: false,
        logLevel: 'info',
        corsOrigins: '*',
        baseUrl: 'https://phoenix.example.com/runtime',
        websocketUrl: 'wss://phoenix.example.com/runtime/ws',
      },
    });

    const detail = await platform.getInstanceDetail(created.id);

    assert.ok(detail);
    assert.equal(detail.officialRuntimeNotes[0]?.title, 'phoenixclaw runtime');
    assert.match(detail.officialRuntimeNotes[0]?.content ?? '', /phoenixclaw/i);
  });
});

await runTest(
  'web studio accepts local-managed Hermes metadata and keeps it outside the browser-managed workbench',
  async () => {
    await withMockedWindowStorage(async () => {
      const platform = new WebStudioPlatform();

      const created = await platform.createInstance({
        name: 'Hermes Local Managed',
        description: 'Managed Hermes metadata for the browser fallback.',
        runtimeKind: 'hermes',
        deploymentMode: 'local-managed',
        transportKind: 'customHttp',
        iconType: 'server',
        typeLabel: 'Hermes Agent',
        host: '127.0.0.1',
        port: 19540,
        baseUrl: 'http://127.0.0.1:19540',
        websocketUrl: null,
        config: {
          port: '19540',
          sandbox: true,
          autoUpdate: false,
          logLevel: 'info',
          corsOrigins: '*',
          baseUrl: 'http://127.0.0.1:19540',
          websocketUrl: null,
        },
      });

      const detail = await platform.getInstanceDetail(created.id);

      assert.equal(created.runtimeKind, 'hermes');
      assert.equal(created.deploymentMode, 'local-managed');
      assert.ok(detail);
      assert.equal(detail?.lifecycle.owner, 'externalProcess');
      assert.equal(detail?.lifecycle.startStopSupported, false);
      assert.equal(detail?.lifecycle.configWritable, false);
      assert.equal(detail?.workbench, null);
    });
  },
);

await runTest('web studio normalizes stored built-in OpenClaw metadata to the canonical authority and latest bundled version', async () => {
  await withMockedWindowStorage(async ({ readJson }) => {
    const storage = (globalThis as typeof globalThis & {
      window: { localStorage: { setItem(key: string, value: string): void; getItem(key: string): string | null } };
    }).window.localStorage;

    storage.setItem(
      'agent-studio:studio:instances:v1',
      JSON.stringify({
        version: 1,
        instances: [
          {
            id: 'unexpected-bundled-openclaw-id',
            name: 'Unexpected Bundled OpenClaw Id',
            description: 'Bundled runtime with a non-canonical persisted id.',
            runtimeKind: 'openclaw',
            deploymentMode: 'local-managed',
            transportKind: 'openclawGatewayWs',
            status: 'online',
            isBuiltIn: true,
            isDefault: true,
            iconType: 'server',
            version: staleOpenClawVersion,
            typeLabel: 'Built-In OpenClaw',
            host: '127.0.0.1',
            port: 19991,
            baseUrl: 'http://127.0.0.1:19991',
            websocketUrl: 'ws://127.0.0.1:19991',
            cpu: 0,
            memory: 0,
            totalMemory: 'Unknown',
            uptime: '-',
            capabilities: ['chat', 'health', 'files', 'memory', 'tasks', 'tools', 'models'],
            storage: {
              profileId: 'default-local',
              provider: 'localFile',
              namespace: 'agent-studio',
              database: null,
              connectionHint: null,
              endpoint: null,
            },
            config: {
              port: '19991',
              sandbox: true,
              autoUpdate: true,
              logLevel: 'info',
              corsOrigins: '*',
              workspacePath: null,
              baseUrl: 'http://127.0.0.1:19991',
              websocketUrl: 'ws://127.0.0.1:19991',
              authToken: null,
            },
            createdAt: 1,
            updatedAt: 1,
            lastSeenAt: 1,
          },
        ],
      }),
    );

    const platform = new WebStudioPlatform();
    const instances = await platform.listInstances();
    const builtIn = instances.find(
      (instance) => instance.id === STABLE_BUILT_IN_OPENCLAW_INSTANCE_ID,
    );
    const persistedDocument = readJson(INSTANCE_STORAGE_KEY) as {
      instances?: Array<{
        id: string;
        version?: string;
        config?: {
          workspacePath?: string | null;
          authToken?: string | null;
        };
      }>;
    } | null;
    const persistedBuiltIn = persistedDocument?.instances?.find(
      (instance) => instance.id === STABLE_BUILT_IN_OPENCLAW_INSTANCE_ID,
    );

    assert.ok(builtIn);
    assert.equal(builtIn?.version, DEFAULT_BUNDLED_OPENCLAW_VERSION);
    assert.equal(builtIn?.port, 21280);
    assert.equal(builtIn?.baseUrl, 'http://127.0.0.1:21280');
    assert.equal(builtIn?.websocketUrl, 'ws://127.0.0.1:21280');
    assert.equal(
      persistedBuiltIn?.version,
      DEFAULT_BUNDLED_OPENCLAW_VERSION,
    );
    assert.equal(persistedBuiltIn?.config?.port, '21280');
    assert.equal(persistedBuiltIn?.config?.workspacePath, undefined);
    assert.equal(persistedBuiltIn?.config?.authToken, undefined);
  });
});

await runTest(
  'web studio preserves a stable built-in OpenClaw instance id without introducing duplicate built-in entries',
  async () => {
    await withMockedWindowStorage(async () => {
      const storage = (globalThis as typeof globalThis & {
        window: { localStorage: { setItem(key: string, value: string): void; getItem(key: string): string | null } };
      }).window.localStorage;

      storage.setItem(
        'agent-studio:studio:instances:v1',
        JSON.stringify({
          version: 1,
          instances: [
            {
              id: BUILT_IN_INSTANCE_ID,
              name: 'Built-In OpenClaw Primary',
              description: 'Stable built-in OpenClaw identity.',
              runtimeKind: 'openclaw',
              deploymentMode: 'local-managed',
              transportKind: 'openclawGatewayWs',
              status: 'online',
              isBuiltIn: true,
              isDefault: true,
              iconType: 'server',
              version: staleOpenClawVersion,
              typeLabel: 'Built-In OpenClaw',
              host: '127.0.0.1',
              port: 18871,
              baseUrl: 'http://127.0.0.1:18871',
              websocketUrl: 'ws://127.0.0.1:18871',
              cpu: 0,
              memory: 0,
              totalMemory: 'Unknown',
              uptime: '-',
              capabilities: ['chat', 'health', 'files', 'memory', 'tasks', 'tools', 'models'],
              storage: {
                profileId: 'default-local',
                provider: 'localFile',
                namespace: 'agent-studio',
                database: null,
                connectionHint: null,
                endpoint: null,
              },
              config: {
                port: '18871',
                sandbox: true,
                autoUpdate: true,
                logLevel: 'info',
                corsOrigins: '*',
                workspacePath: null,
                baseUrl: 'http://127.0.0.1:18871',
                websocketUrl: 'ws://127.0.0.1:18871',
                authToken: null,
              },
              createdAt: 1,
              updatedAt: 1,
              lastSeenAt: 1,
            },
          ],
        }),
      );

      const platform = new WebStudioPlatform();
      const instances = await platform.listInstances();
      const persisted = storage.getItem('agent-studio:studio:instances:v1');
      const persistedDocument = persisted ? JSON.parse(persisted) : null;

      assert.equal(instances.length, 1);
      assert.equal(instances[0]?.id, BUILT_IN_INSTANCE_ID);
      assert.equal(instances[0]?.name, 'Built-In OpenClaw Primary');
      assert.equal(instances[0]?.version, DEFAULT_BUNDLED_OPENCLAW_VERSION);
      assert.equal(instances[0]?.port, 21280);
      assert.equal(instances[0]?.baseUrl, 'http://127.0.0.1:21280');
      assert.equal(instances[0]?.websocketUrl, 'ws://127.0.0.1:21280');
      assert.equal(
        instances.some((instance) => instance.id === 'unexpected-bundled-openclaw-id'),
        false,
      );
      assert.equal(persistedDocument?.instances?.length, 1);
      assert.equal(persistedDocument?.instances?.[0]?.id, BUILT_IN_INSTANCE_ID);
      assert.equal(persistedDocument?.instances?.[0]?.name, 'Built-In OpenClaw Primary');
      assert.equal(
        persistedDocument?.instances?.[0]?.version,
        DEFAULT_BUNDLED_OPENCLAW_VERSION,
      );
      assert.equal(persistedDocument?.instances?.[0]?.config?.port, '21280');
    });
  },
);
