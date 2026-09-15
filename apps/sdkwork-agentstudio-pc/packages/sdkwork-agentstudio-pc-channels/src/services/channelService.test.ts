// WORKSPACE-PATH:allow-fixture: fixtures name a foreign checkout root, drive, or home directory to exercise path handling, so the literal is the value under assertion rather than a binding this build resolves
import assert from 'node:assert/strict';
import { openClawConfigService } from '@sdkwork/agentstudio-pc-core';
import { configurePlatformBridge, getPlatformBridge } from '@sdkwork/agentstudio-pc-infrastructure';
import {
  STABLE_BUILT_IN_OPENCLAW_INSTANCE_ID,
  type StudioInstanceDetailRecord,
} from '@sdkwork/agentstudio-pc-types';
import { channelService } from './channelService.ts';

const BUILT_IN_INSTANCE_ID = STABLE_BUILT_IN_OPENCLAW_INSTANCE_ID;

async function runTest(name: string, callback: () => Promise<void> | void) {
  try {
    await callback();
    console.log(`ok - ${name}`);
  } catch (error) {
    console.error(`not ok - ${name}`);
    throw error;
  }
}

async function withMockedWindowStorage(fn: () => Promise<void>) {
  const globalWithWindow = globalThis as unknown as { window?: unknown };
  const originalWindow = globalWithWindow.window;
  const storage = new Map<string, string>();
  const localStorage: Storage = {
    get length() {
      return storage.size;
    },
    clear() {
      storage.clear();
    },
    getItem(key: string) {
      return storage.get(key) ?? null;
    },
    key(index: number) {
      return [...storage.keys()][index] ?? null;
    },
    setItem(key: string, value: string) {
      storage.set(key, value);
    },
    removeItem(key: string) {
      storage.delete(key);
    },
  };

  globalWithWindow.window = {
    localStorage,
  };

  try {
    await fn();
  } finally {
    globalWithWindow.window = originalWindow;
  }
}

function createConfigBackedWorkbenchDetail(
  channelOverrides: Partial<
    NonNullable<NonNullable<StudioInstanceDetailRecord['workbench']>['channels']>[number]
  > = {},
): StudioInstanceDetailRecord {
  const channel = {
    id: 'telegram',
    name: 'Telegram',
    description: 'Telegram Bot API bridge.',
    status: 'connected',
    enabled: true,
    configurationMode: 'required',
    fieldCount: 3,
    configuredFieldCount: 3,
    setupSteps: ['Create a bot', 'Copy credentials'],
    values: {
      botToken: '123456:telegram-token',
      webhookUrl: 'https://example.com/openclaw/telegram',
      webhookSecret: 'secret',
    },
    ...channelOverrides,
  };

  return {
    instance: {
      id: BUILT_IN_INSTANCE_ID,
      name: 'Built-In OpenClaw',
      description: 'Built-In OpenClaw instance for channels fallback tests.',
      runtimeKind: 'openclaw',
      deploymentMode: 'local-managed',
      transportKind: 'openclawGatewayWs',
      status: 'online',
      isBuiltIn: true,
      isDefault: true,
      iconType: 'server',
      version: '2026.04.16',
      typeLabel: 'OpenClaw',
      host: '127.0.0.1',
      port: 21280,
      baseUrl: 'http://127.0.0.1:21280',
      websocketUrl: 'ws://127.0.0.1:21280',
      cpu: 0,
      memory: 0,
      totalMemory: '0 GB',
      uptime: '0m',
      capabilities: ['channels'],
      storage: {
        provider: 'localFile',
        namespace: 'managed-openclaw',
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
      namespace: 'managed-openclaw',
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
      routes: [
        {
          id: 'config',
          label: 'Config',
          scope: 'config',
          mode: 'managedFile',
          status: 'ready',
          target: 'D:/missing/.openclaw/openclaw.json',
          readonly: false,
          authoritative: true,
          detail: 'Writable config file',
          source: 'config',
        },
      ],
    },
    artifacts: [
      {
        id: 'config-file',
        label: 'Config File',
        kind: 'configFile',
        status: 'configured',
        location: 'D:/missing/.openclaw/openclaw.json',
        readonly: false,
        detail: 'Writable config file',
        source: 'config',
      },
    ],
    capabilities: [],
    officialRuntimeNotes: [],
    consoleAccess: {
      supported: false,
      entries: [],
    },
    workbench: {
      channels: [channel],
    } as StudioInstanceDetailRecord['workbench'],
  };
}

function createMissingConfigError() {
  return new Error(
    'The attached OpenClaw config file is no longer available on disk. Re-scan or reattach the instance configuration. (C:/Users/admin/.openclaw/openclaw.json)',
  );
}

await runTest('getList exposes the seeded channel catalog', async () => {
  await withMockedWindowStorage(async () => {
    const result = await channelService.getList(BUILT_IN_INSTANCE_ID, { page: 1, pageSize: 20 });

    assert.equal(result.items[0]?.id, 'qqbot');
    assert.equal(result.items.some((channel) => channel.id === 'telegram'), true);
    assert.equal(result.items.some((channel) => channel.id === 'qq'), false);
    assert.equal(result.items[0]?.fieldCount > 0, true);
    assert.equal(result.items[0]?.configuredFieldCount, 0);
    assert.equal(result.items[0]?.status, 'not_configured');
  });
});

await runTest('saveChannelConfig and deleteChannelConfig keep state in sync with v3 behavior', async () => {
  await withMockedWindowStorage(async () => {
    await channelService.saveChannelConfig(BUILT_IN_INSTANCE_ID, 'telegram', {
      botToken: '123456:telegram-token',
      webhookUrl: 'https://example.com/openclaw/telegram',
      webhookSecret: 'secret',
    });

    let telegram = await channelService.getById(BUILT_IN_INSTANCE_ID, 'telegram');
    assert.equal(telegram?.enabled, true);
    assert.equal(telegram?.status, 'connected');
    assert.equal(
      telegram?.fields.find((field) => field.key === 'webhookUrl')?.value,
      'https://example.com/openclaw/telegram',
    );

    await channelService.deleteChannelConfig(BUILT_IN_INSTANCE_ID, 'telegram');

    telegram = await channelService.getById(BUILT_IN_INSTANCE_ID, 'telegram');
    assert.equal(telegram?.enabled, false);
    assert.equal(telegram?.status, 'not_configured');
    assert.equal(
      telegram?.fields.find((field) => field.key === 'webhookUrl')?.value,
      undefined,
    );
  });
});

await runTest('create preserves the v3 unimplemented mutation contract', async () => {
  await assert.rejects(
    () =>
      channelService.create(BUILT_IN_INSTANCE_ID, {
        name: 'Custom Channel',
        description: 'Custom integration',
        icon: 'Webhook',
        fields: [],
        setupGuide: [],
      }),
    /Method not implemented\./,
  );
});

await runTest(
  'getChannels falls back to the workbench snapshot when the config file path is stale',
  async () => {
    const originalBridge = getPlatformBridge();
    const originalReadConfigSnapshot = openClawConfigService.readConfigSnapshot;
    const detail = createConfigBackedWorkbenchDetail();

    configurePlatformBridge({
      studio: {
        ...originalBridge.studio,
        async getInstanceDetail() {
          return detail;
        },
      },
    });
    (openClawConfigService as typeof openClawConfigService & {
      readConfigSnapshot: typeof openClawConfigService.readConfigSnapshot;
    }).readConfigSnapshot = async () => {
      throw createMissingConfigError();
    };

    try {
      const channels = await channelService.getChannels(BUILT_IN_INSTANCE_ID);
      const telegram = channels.find((channel) => channel.id === 'telegram');

      assert.equal(telegram?.enabled, true);
      assert.equal(telegram?.status, 'connected');
      assert.equal(
        telegram?.fields.find((field) => field.key === 'webhookUrl')?.value,
        'https://example.com/openclaw/telegram',
      );
    } finally {
      (openClawConfigService as typeof openClawConfigService & {
        readConfigSnapshot: typeof openClawConfigService.readConfigSnapshot;
      }).readConfigSnapshot = originalReadConfigSnapshot;
      configurePlatformBridge(originalBridge);
    }
  },
);

await runTest(
  'getChannels prunes retired workbench channels when falling back from a stale config path',
  async () => {
    const originalBridge = getPlatformBridge();
    const originalReadConfigSnapshot = openClawConfigService.readConfigSnapshot;
    const detail = createConfigBackedWorkbenchDetail();
    detail.workbench?.channels.push({
      id: 'qq',
      name: 'QQ',
      description: 'Retired QQ channel from a stale workbench snapshot.',
      status: 'connected',
      enabled: true,
      configurationMode: 'required',
      fieldCount: 1,
      configuredFieldCount: 1,
      setupSteps: ['Legacy QQ setup'],
      values: {
        botKey: 'legacy-key',
      },
    });
    detail.workbench?.channels.push({
      id: 'openclaw-weixin',
      name: 'Weixin',
      description: 'Runtime-discovered external Weixin plugin.',
      status: 'connected',
      enabled: true,
      configurationMode: 'required',
      fieldCount: 1,
      configuredFieldCount: 1,
      setupSteps: ['Scan QR code from the runtime plugin.'],
      values: {
        account: 'runtime-managed',
      },
    });
    detail.workbench?.channels.push({
      id: 'wecom',
      name: 'WeCom',
      description: 'Runtime-discovered external WeCom plugin.',
      status: 'connected',
      enabled: true,
      configurationMode: 'required',
      fieldCount: 1,
      configuredFieldCount: 1,
      setupSteps: ['Configure the WeCom bot in the runtime plugin.'],
      values: {
        botId: 'env:WECOM_BOT_ID',
      },
    });
    detail.workbench?.channels.push({
      id: 'dingtalk',
      name: 'DingTalk',
      description: 'Runtime-discovered DingTalk plugin.',
      status: 'connected',
      enabled: true,
      configurationMode: 'required',
      fieldCount: 1,
      configuredFieldCount: 1,
      setupSteps: ['Configure DingTalk stream mode in the runtime plugin.'],
      values: {
        robotCode: 'env:DINGTALK_ROBOT_CODE',
      },
    });

    configurePlatformBridge({
      studio: {
        ...originalBridge.studio,
        async getInstanceDetail() {
          return detail;
        },
      },
    });
    (openClawConfigService as typeof openClawConfigService & {
      readConfigSnapshot: typeof openClawConfigService.readConfigSnapshot;
    }).readConfigSnapshot = async () => {
      throw createMissingConfigError();
    };

    try {
      const channels = await channelService.getChannels(BUILT_IN_INSTANCE_ID);

      assert.equal(channels.some((channel) => channel.id === 'qq'), false);
      assert.equal(channels.some((channel) => channel.id === 'telegram'), true);
      assert.equal(channels.find((channel) => channel.id === 'openclaw-weixin')?.status, 'connected');
      assert.equal(channels.find((channel) => channel.id === 'wecom')?.status, 'connected');
      assert.equal(channels.find((channel) => channel.id === 'dingtalk')?.status, 'connected');
    assert.deepEqual(
      channels.map((channel) => channel.id),
      [
        'qqbot',
        'feishu',
        'imessage',
        'irc',
        'matrix',
          'mattermost',
          'signal',
          'slack',
          'telegram',
          'openclaw-weixin',
          'wecom',
          'dingtalk',
        ],
      );
    } finally {
      (openClawConfigService as typeof openClawConfigService & {
        readConfigSnapshot: typeof openClawConfigService.readConfigSnapshot;
      }).readConfigSnapshot = originalReadConfigSnapshot;
      configurePlatformBridge(originalBridge);
    }
  },
);
await runTest(
  'updateChannelStatus falls back to the workbench bridge when the config file path is stale',
  async () => {
    const originalBridge = getPlatformBridge();
    const originalReadConfigSnapshot = openClawConfigService.readConfigSnapshot;
    const originalSetChannelEnabled = openClawConfigService.setChannelEnabled;
    const detail = createConfigBackedWorkbenchDetail();
    const bridgeCalls: string[] = [];

    configurePlatformBridge({
      studio: {
        ...originalBridge.studio,
        async getInstanceDetail() {
          return detail;
        },
        async setInstanceChannelEnabled(_instanceId, channelId, enabled) {
          bridgeCalls.push(`toggle:${channelId}:${enabled}`);
          const telegram = detail.workbench?.channels.find((channel) => channel.id === channelId);
          if (!telegram) {
            return false;
          }

          telegram.enabled = enabled;
          telegram.status = enabled ? 'connected' : 'disconnected';
          return true;
        },
      },
    });
    (openClawConfigService as typeof openClawConfigService & {
      readConfigSnapshot: typeof openClawConfigService.readConfigSnapshot;
      setChannelEnabled: typeof openClawConfigService.setChannelEnabled;
    }).readConfigSnapshot = async () => {
      throw createMissingConfigError();
    };
    (openClawConfigService as typeof openClawConfigService & {
      readConfigSnapshot: typeof openClawConfigService.readConfigSnapshot;
      setChannelEnabled: typeof openClawConfigService.setChannelEnabled;
    }).setChannelEnabled = async () => {
      throw createMissingConfigError();
    };

    try {
      const channels = await channelService.updateChannelStatus(
        'managed-openclaw',
        'telegram',
        false,
      );
      const telegram = channels.find((channel) => channel.id === 'telegram');

      assert.deepEqual(bridgeCalls, ['toggle:telegram:false']);
      assert.equal(telegram?.enabled, false);
      assert.equal(telegram?.status, 'disconnected');
    } finally {
      (openClawConfigService as typeof openClawConfigService & {
        readConfigSnapshot: typeof openClawConfigService.readConfigSnapshot;
        setChannelEnabled: typeof openClawConfigService.setChannelEnabled;
      }).readConfigSnapshot = originalReadConfigSnapshot;
      (openClawConfigService as typeof openClawConfigService & {
        readConfigSnapshot: typeof openClawConfigService.readConfigSnapshot;
        setChannelEnabled: typeof openClawConfigService.setChannelEnabled;
      }).setChannelEnabled = originalSetChannelEnabled;
      configurePlatformBridge(originalBridge);
    }
  },
);
await runTest(
  'saveChannelConfig falls back to the workbench bridge when the config file path is stale',
  async () => {
    const originalBridge = getPlatformBridge();
    const originalReadConfigSnapshot = openClawConfigService.readConfigSnapshot;
    const originalSaveChannelConfiguration = openClawConfigService.saveChannelConfiguration;
    const detail = createConfigBackedWorkbenchDetail({
      status: 'not_configured',
      enabled: false,
      configuredFieldCount: 0,
      values: {},
    });
    const bridgeCalls: string[] = [];

    configurePlatformBridge({
      studio: {
        ...originalBridge.studio,
        async getInstanceDetail() {
          return detail;
        },
        async saveInstanceChannelConfig(_instanceId, channelId, values) {
          bridgeCalls.push(`save:${channelId}`);
          const telegram = detail.workbench?.channels.find((channel) => channel.id === channelId);
          if (!telegram) {
            return false;
          }

          telegram.values = { ...values };
          telegram.enabled = true;
          telegram.status = 'connected';
          telegram.configuredFieldCount = Object.values(values).filter((value) => value.trim()).length;
          return true;
        },
      },
    });
    (openClawConfigService as typeof openClawConfigService & {
      readConfigSnapshot: typeof openClawConfigService.readConfigSnapshot;
      saveChannelConfiguration: typeof openClawConfigService.saveChannelConfiguration;
    }).readConfigSnapshot = async () => {
      throw createMissingConfigError();
    };
    (openClawConfigService as typeof openClawConfigService & {
      readConfigSnapshot: typeof openClawConfigService.readConfigSnapshot;
      saveChannelConfiguration: typeof openClawConfigService.saveChannelConfiguration;
    }).saveChannelConfiguration = async () => {
      throw createMissingConfigError();
    };

    try {
      const channels = await channelService.saveChannelConfig('managed-openclaw', 'telegram', {
        webhookUrl: 'https://example.com/openclaw/telegram',
        appSecret: 'secret',
        token: 'token',
      });
      const telegram = channels.find((channel) => channel.id === 'telegram');

      assert.deepEqual(bridgeCalls, ['save:telegram']);
      assert.equal(telegram?.enabled, true);
      assert.equal(telegram?.status, 'connected');
      assert.equal(
        telegram?.fields.find((field) => field.key === 'webhookUrl')?.value,
        'https://example.com/openclaw/telegram',
      );
    } finally {
      (openClawConfigService as typeof openClawConfigService & {
        readConfigSnapshot: typeof openClawConfigService.readConfigSnapshot;
        saveChannelConfiguration: typeof openClawConfigService.saveChannelConfiguration;
      }).readConfigSnapshot = originalReadConfigSnapshot;
      (openClawConfigService as typeof openClawConfigService & {
        readConfigSnapshot: typeof openClawConfigService.readConfigSnapshot;
        saveChannelConfiguration: typeof openClawConfigService.saveChannelConfiguration;
      }).saveChannelConfiguration = originalSaveChannelConfiguration;
      configurePlatformBridge(originalBridge);
    }
  },
);
await runTest(
  'deleteChannelConfig falls back to the workbench bridge when the config file path is stale',
  async () => {
    const originalBridge = getPlatformBridge();
    const originalReadConfigSnapshot = openClawConfigService.readConfigSnapshot;
    const originalSaveChannelConfiguration = openClawConfigService.saveChannelConfiguration;
    const detail = createConfigBackedWorkbenchDetail();
    const bridgeCalls: string[] = [];

    configurePlatformBridge({
      studio: {
        ...originalBridge.studio,
        async getInstanceDetail() {
          return detail;
        },
        async deleteInstanceChannelConfig(_instanceId, channelId) {
          bridgeCalls.push(`delete:${channelId}`);
          const telegram = detail.workbench?.channels.find((channel) => channel.id === channelId);
          if (!telegram) {
            return false;
          }

          telegram.values = {};
          telegram.enabled = false;
          telegram.status = 'not_configured';
          telegram.configuredFieldCount = 0;
          return true;
        },
      },
    });
    (openClawConfigService as typeof openClawConfigService & {
      readConfigSnapshot: typeof openClawConfigService.readConfigSnapshot;
      saveChannelConfiguration: typeof openClawConfigService.saveChannelConfiguration;
    }).readConfigSnapshot = async () => {
      throw createMissingConfigError();
    };
    (openClawConfigService as typeof openClawConfigService & {
      readConfigSnapshot: typeof openClawConfigService.readConfigSnapshot;
      saveChannelConfiguration: typeof openClawConfigService.saveChannelConfiguration;
    }).saveChannelConfiguration = async () => {
      throw createMissingConfigError();
    };

    try {
      const channels = await channelService.deleteChannelConfig('managed-openclaw', 'telegram');
      const telegram = channels.find((channel) => channel.id === 'telegram');

      assert.deepEqual(bridgeCalls, ['delete:telegram']);
      assert.equal(telegram?.enabled, false);
      assert.equal(telegram?.status, 'not_configured');
      assert.equal(
        telegram?.fields.find((field) => field.key === 'webhookUrl')?.value,
        undefined,
      );
    } finally {
      (openClawConfigService as typeof openClawConfigService & {
        readConfigSnapshot: typeof openClawConfigService.readConfigSnapshot;
        saveChannelConfiguration: typeof openClawConfigService.saveChannelConfiguration;
      }).readConfigSnapshot = originalReadConfigSnapshot;
      (openClawConfigService as typeof openClawConfigService & {
        readConfigSnapshot: typeof openClawConfigService.readConfigSnapshot;
        saveChannelConfiguration: typeof openClawConfigService.saveChannelConfiguration;
      }).saveChannelConfiguration = originalSaveChannelConfiguration;
      configurePlatformBridge(originalBridge);
    }
  },
);
