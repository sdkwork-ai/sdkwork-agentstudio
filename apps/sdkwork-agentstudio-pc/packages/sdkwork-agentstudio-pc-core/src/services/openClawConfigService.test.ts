// WORKSPACE-PATH:allow-fixture: fixtures name a foreign checkout root, drive, or home directory to exercise path handling, so the literal is the value under assertion rather than a binding this build resolves
import assert from 'node:assert/strict';
import type { PlatformAPI } from '@sdkwork/agentstudio-pc-infrastructure';
import { parseJson5 } from '@sdkwork/local-api-proxy';
import { parseOpenClawConfigDocument } from './openClawConfigService.ts';

async function runTest(name: string, callback: () => Promise<void> | void) {
  try {
    await callback();
    console.log(`ok - ${name}`);
  } catch (error) {
    console.error(`not ok - ${name}`);
    throw error;
  }
}

function createPlatformBridgeStub(overrides: Partial<PlatformAPI> = {}): PlatformAPI {
  return {
    getPlatform: () => 'desktop',
    getDeviceId: async () => 'test-device',
    setStorage: async () => {},
    getStorage: async () => null,
    copy: async () => {},
    openExternal: async () => {},
    supportsNativeScreenshot: () => false,
    captureScreenshot: async () => null,
    fetchRemoteUrl: async (url) => ({
      url,
      bytes: new Uint8Array(),
    }),
    selectFile: async () => [],
    saveFile: async () => {},
    minimizeWindow: async () => {},
    maximizeWindow: async () => {},
    restoreWindow: async () => {},
    isWindowMaximized: async () => false,
    subscribeWindowMaximized: async () => async () => {},
    closeWindow: async () => {},
    listDirectory: async () => [],
    pathExists: async () => false,
    pathExistsForUserTooling: async () => false,
    getPathInfo: async (path) => ({
      path,
      name: path.split(/[\\/]/).pop() || path,
      kind: 'missing',
      size: null,
      extension: null,
      exists: false,
      lastModifiedMs: null,
    }),
    createDirectory: async () => {},
    removePath: async () => {},
    copyPath: async () => {},
    movePath: async () => {},
    readBinaryFile: async () => new Uint8Array(),
    writeBinaryFile: async () => {},
    readFile: async () => {
      throw new Error('readFile stub not configured');
    },
    readFileForUserTooling: async () => {
      throw new Error('readFileForUserTooling stub not configured');
    },
    writeFile: async () => {},
    ...overrides,
  };
}

await runTest(
  'openClawConfigService does not expose install-config discovery because kernel discovery is standardized separately',
  async () => {
    const { openClawConfigService } = await import('./openClawConfigService.ts');

    assert.equal('resolveInstallConfigPath' in openClawConfigService, false);
  },
);

await runTest('openClawConfigService deduplicates repeated snapshot reads for the same config path', async () => {
  const { configurePlatformBridge, getPlatformBridge } = await import('@sdkwork/agentstudio-pc-infrastructure');
  const { openClawConfigService } = await import('./openClawConfigService.ts');

  const originalBridge = getPlatformBridge();
  let readFileCalls = 0;

  configurePlatformBridge({
    platform: createPlatformBridgeStub({
      readFile: async () => {
        readFileCalls += 1;
        return `{
  providers: {
    openai: {
      apiKey: "test-key"
    }
  }
}`;
      },
    }),
  });

  try {
    const configFile = 'D:/OpenClaw/.openclaw/openclaw-cache-test.json';
    const [first, second] = await Promise.all([
      openClawConfigService.readConfigSnapshot(configFile),
      openClawConfigService.readConfigSnapshot(configFile),
    ]);
    const third = await openClawConfigService.readConfigSnapshot(configFile);

    assert.equal(readFileCalls, 1);
    assert.deepEqual(first.providerSnapshots, second.providerSnapshots);
    assert.deepEqual(second.providerSnapshots, third.providerSnapshots);
  } finally {
    configurePlatformBridge(originalBridge);
  }
});

await runTest('parseOpenClawConfigDocument prefixes JSON5 syntax failures with openclaw context', () => {
  const parsed = parseOpenClawConfigDocument('{ agents: { ');

  assert.equal(parsed.parsed, null);
  assert.match(parsed.parseError || '', /invalid|json5|openclaw\.json/i);
  assert.match(parsed.parseError || '', /unterminated object literal/i);
});

await runTest('openClawConfigService reuses a cached parsed root across different readers for the same config path', async () => {
  const { configurePlatformBridge, getPlatformBridge } = await import('@sdkwork/agentstudio-pc-infrastructure');
  const { openClawConfigService } = await import('./openClawConfigService.ts');

  const originalBridge = getPlatformBridge();
  let readFileCalls = 0;

  configurePlatformBridge({
    platform: createPlatformBridgeStub({
      readFile: async () => {
        readFileCalls += 1;
        return `{
  agents: {
    defaults: {
      workspace: "~/workspace"
    }
  },
  channels: {
    telegram: {
      enabled: true,
      botToken: "123456:telegram-token"
    }
  }
}`;
      },
    }),
  });

  try {
    const configFile = 'D:/OpenClaw/.openclaw/openclaw-root-cache-test.json';

    const resolvedPaths = await openClawConfigService.resolveAgentPaths({
      configFile,
      agentId: 'main',
    });
    const snapshot = await openClawConfigService.readConfigSnapshot(configFile);

    assert.equal(readFileCalls, 1);
    assert.equal(resolvedPaths.workspace, 'D:/OpenClaw/.openclaw/workspace');
    assert.equal(snapshot.channelSnapshots.find((channel) => channel.id === 'telegram')?.enabled, true);
  } finally {
    configurePlatformBridge(originalBridge);
  }
});

await runTest('openClawConfigService persists native OpenClaw provider defaults and root-level channel credentials into openclaw.json', async () => {
  const { configurePlatformBridge, getPlatformBridge } = await import('@sdkwork/agentstudio-pc-infrastructure');
  const { openClawConfigService } = await import('./openClawConfigService.ts');

  const originalBridge = getPlatformBridge();
  const writes: Array<{ path: string; content: string }> = [];
  let fileContent = `{
  gateway: {
    port: 28789,
  },
  models: {
    mode: "merge",
    providers: {},
  },
  agents: {
    defaults: {},
  },
  channels: {},
}`;

  configurePlatformBridge({
    platform: createPlatformBridgeStub({
      readFile: async () => fileContent,
      writeFile: async (path, content) => {
        fileContent = content;
        writes.push({ path, content });
      },
    }),
  });

  try {
    const provider = {
      id: 'provider-openai-primary',
      channelId: 'openai',
      name: 'OpenAI Shared Router',
      apiKey: ' env:OPENAI_API_KEY ',
      groupId: 'ops',
      usage: {
        requestCount: 0,
        tokenCount: 0,
        spendUsd: 0,
        period: '30d' as const,
      },
      expiresAt: null,
      status: 'active' as const,
      createdAt: '2026-03-20T00:00:00.000Z',
      baseUrl: 'https://router.example.com/v1',
      models: [
        { id: 'gpt-4.1', name: 'GPT-4.1' },
        { id: 'o4-mini', name: 'o4-mini' },
        { id: 'text-embedding-3-small', name: 'text-embedding-3-small' },
      ],
      notes: 'shared router',
    };

    await openClawConfigService.saveProviderSelection({
      configFile: 'D:/OpenClaw/.openclaw/openclaw.json',
      provider,
      selection: {
        defaultModelId: 'gpt-4.1',
        reasoningModelId: 'o4-mini',
        embeddingModelId: 'text-embedding-3-small',
      },
    });

    await openClawConfigService.saveChannelConfiguration({
      configFile: 'D:/OpenClaw/.openclaw/openclaw.json',
      channelId: 'telegram',
      enabled: true,
      values: {
        botToken: '123456:telegram-token',
        webhookUrl: 'https://example.com/telegram/webhook',
      },
    });

    const snapshot = await openClawConfigService.readConfigSnapshot(
      'D:/OpenClaw/.openclaw/openclaw.json',
    );

    assert.equal(writes.length >= 2, true);
    assert.equal(snapshot.configFile, 'D:/OpenClaw/.openclaw/openclaw.json');
    assert.equal('configPath' in snapshot, false);
    assert.equal(snapshot.providerSnapshots[0]?.id, 'provider-openai-primary');
    assert.equal(snapshot.providerSnapshots[0]?.defaultModelId, 'gpt-4.1');
    assert.equal(snapshot.providerSnapshots[0]?.reasoningModelId, 'o4-mini');
    assert.equal(snapshot.providerSnapshots[0]?.embeddingModelId, 'text-embedding-3-small');
    assert.equal(snapshot.providerSnapshots[0]?.status, 'ready');
    assert.equal(snapshot.providerSnapshots[0]?.endpoint, 'https://router.example.com/v1');
    assert.equal(snapshot.providerSnapshots[0]?.apiKeySource, 'env:OPENAI_API_KEY');
    assert.equal(snapshot.channelSnapshots.find((channel) => channel.id === 'telegram')?.enabled, true);
    assert.equal(
      snapshot.channelSnapshots.find((channel) => channel.id === 'telegram')?.configuredFieldCount,
      2,
    );
    assert.equal(snapshot.channelSnapshots[0]?.id, 'qqbot');
    assert.equal(snapshot.channelSnapshots[0]?.name, 'QQ Bot');
    assert.equal(snapshot.channelSnapshots[0]?.status, 'not_configured');
    assert.equal(snapshot.channelSnapshots[0]?.enabled, false);
    assert.equal(snapshot.channelSnapshots[0]?.fieldCount > 0, true);
    assert.equal(snapshot.channelSnapshots[0]?.configuredFieldCount, 0);
    assert.deepEqual(
      snapshot.channelSnapshots.map((channel) => channel.id),
      ['qqbot', 'feishu', 'imessage', 'irc', 'matrix', 'mattermost', 'signal', 'slack', 'telegram'],
    );
    assert.equal(
      snapshot.channelSnapshots.some((channel) =>
        ['sdkworkchat', 'wechat', 'wehcat', 'qq', 'dingtalk', 'wecom'].includes(channel.id),
      ),
      false,
    );
    assert.match(fileContent, /provider-openai-primary/);
    assert.match(fileContent, /provider-openai-primary\/gpt-4\.1/);
    assert.match(fileContent, /channels:\s*\{/);
    assert.match(fileContent, /telegram/);
  } finally {
    configurePlatformBridge(originalBridge);
  }
});

await runTest(
  'openClawConfigService reads provider request transport overrides from native provider config',
  async () => {
    const { configurePlatformBridge, getPlatformBridge } = await import('@sdkwork/agentstudio-pc-infrastructure');
    const { openClawConfigService } = await import('./openClawConfigService.ts');

    const originalBridge = getPlatformBridge();
    const fileContent = `{
  models: {
    providers: {
      openai: {
        baseUrl: "https://api.openai.com/v1",
        apiKey: "\${OPENAI_API_KEY}",
        request: {
          headers: {
            "OpenAI-Organization": "org_live",
          },
          auth: {
            mode: "authorization-bearer",
            token: "\${OPENAI_API_KEY}",
          },
          proxy: {
            mode: "explicit-proxy",
            url: "http://127.0.0.1:8080",
            tls: {
              insecureSkipVerify: true,
              serverName: "proxy.internal",
            },
          },
          tls: {
            insecureSkipVerify: true,
            serverName: "api.openai.internal",
          },
        },
        models: [
          {
            id: "gpt-5.4",
            name: "GPT-5.4",
          },
        ],
      },
    },
  },
  agents: {
    defaults: {
      model: {
        primary: "openai/gpt-5.4",
      },
      models: {
        "openai/gpt-5.4": {
          alias: "GPT-5.4",
          params: {
            temperature: 0.2,
            topP: 1,
            maxTokens: 8192,
            timeoutMs: 60000,
            streaming: true,
          },
        },
      },
    },
  },
}`;

    configurePlatformBridge({
      platform: createPlatformBridgeStub({
        readFile: async () => fileContent,
      }),
    });

    try {
      const snapshot = await openClawConfigService.readConfigSnapshot(
        'D:/OpenClaw/.openclaw/openclaw.json',
      );
      const provider = snapshot.providerSnapshots.find((entry) => entry.id === 'openai');

      assert.deepEqual(provider?.config.request, {
        headers: {
          'OpenAI-Organization': 'org_live',
        },
        auth: {
          mode: 'authorization-bearer',
          token: '${OPENAI_API_KEY}',
        },
        proxy: {
          mode: 'explicit-proxy',
          url: 'http://127.0.0.1:8080',
          tls: {
            insecureSkipVerify: true,
            serverName: 'proxy.internal',
          },
        },
        tls: {
          insecureSkipVerify: true,
          serverName: 'api.openai.internal',
        },
      });
    } finally {
      configurePlatformBridge(originalBridge);
    }
  },
);

await runTest(
  'openClawConfigService persists provider request transport overrides without collapsing runtime params back into the provider root',
  async () => {
    const { configurePlatformBridge, getPlatformBridge } = await import('@sdkwork/agentstudio-pc-infrastructure');
    const { openClawConfigService } = await import('./openClawConfigService.ts');

    const originalBridge = getPlatformBridge();
    let fileContent = `{
  models: {
    providers: {},
  },
  agents: {
    defaults: {},
  },
}`;

    configurePlatformBridge({
      platform: createPlatformBridgeStub({
        readFile: async () => fileContent,
        writeFile: async (_path, content) => {
          fileContent = content;
        },
      }),
    });

    try {
      await openClawConfigService.saveProviderSelection({
        configFile: 'D:/OpenClaw/.openclaw/openclaw.json',
        provider: {
          id: 'openai',
          channelId: 'openai',
          name: 'OpenAI',
          apiKey: '${OPENAI_API_KEY}',
          baseUrl: 'https://api.openai.com/v1',
          models: [
            {
              id: 'gpt-5.4',
              name: 'GPT-5.4',
            },
          ],
          config: {
            temperature: 0.4,
            topP: 0.9,
            maxTokens: 16000,
            timeoutMs: 90000,
            streaming: true,
            request: {
              headers: {
                'OpenAI-Organization': 'org_live',
              },
              auth: {
                mode: 'authorization-bearer',
                token: '${OPENAI_API_KEY}',
              },
              proxy: {
                mode: 'env-proxy',
              },
              tls: {
                insecureSkipVerify: true,
                serverName: 'api.openai.internal',
              },
            },
          },
        },
        selection: {
          defaultModelId: 'gpt-5.4',
        },
      });

      const parsed = parseJson5<{
        models?: {
          providers?: {
            openai?: {
              request?: {
                headers?: Record<string, string>;
                auth?: {
                  mode?: string;
                  token?: string;
                };
                proxy?: {
                  mode?: string;
                };
                tls?: {
                  insecureSkipVerify?: boolean;
                  serverName?: string;
                };
              };
              temperature?: number | null;
            };
          };
        };
        agents?: {
          defaults?: {
            models?: Record<
              string,
              {
                params?: {
                  temperature?: number;
                };
              }
            >;
          };
        };
      }>(fileContent);

      assert.deepEqual(parsed.models?.providers?.openai?.request, {
        headers: {
          'OpenAI-Organization': 'org_live',
        },
        auth: {
          mode: 'authorization-bearer',
          token: '${OPENAI_API_KEY}',
        },
        proxy: {
          mode: 'env-proxy',
        },
        tls: {
          insecureSkipVerify: true,
          serverName: 'api.openai.internal',
        },
      });
      assert.equal(parsed.models?.providers?.openai?.temperature, undefined);
      assert.equal(
        parsed.agents?.defaults?.models?.['openai/gpt-5.4']?.params?.temperature,
        0.4,
      );
    } finally {
      configurePlatformBridge(originalBridge);
    }
  },
);

await runTest(
  'openClawConfigService exposes stable Telegram channel recovery knobs through the existing channel definition catalog',
  async () => {
    const { openClawConfigService } = await import('./openClawConfigService.ts');

    const telegram = openClawConfigService
      .getChannelDefinitions()
      .find((channel) => channel.id === 'telegram');

    assert.ok(telegram);
    assert.equal(telegram?.fields.some((field) => field.key === 'errorPolicy'), true);
    assert.equal(
      telegram?.fields.find((field) => field.key === 'errorCooldownMs')?.inputMode,
      'numeric',
    );
  },
);

await runTest(
  'openClawConfigService exposes only bundled runtime channel definitions',
  async () => {
    const { openClawConfigService } = await import('./openClawConfigService.ts');

    const ids = openClawConfigService
      .getChannelDefinitions()
      .map((channel) => channel.id);

    assert.deepEqual(ids, ['qqbot', 'feishu', 'imessage', 'irc', 'matrix', 'mattermost', 'signal', 'slack', 'telegram']);
    assert.equal(ids.includes('qq'), false);
    assert.equal(ids.includes('whatsapp'), false);
    assert.equal(ids.includes('sdkworkchat'), false);
  },
);

await runTest(
  'openClawConfigService exposes per-channel context visibility controls aligned to the latest channel config surface',
  async () => {
    const { openClawConfigService } = await import('./openClawConfigService.ts');

    const telegram = openClawConfigService
      .getChannelDefinitions()
      .find((channel) => channel.id === 'telegram');
    const slack = openClawConfigService
      .getChannelDefinitions()
      .find((channel) => channel.id === 'slack');

    assert.ok(telegram);
    assert.ok(slack);
    assert.equal(telegram?.fields.some((field) => field.key === 'contextVisibility'), true);
    assert.equal(slack?.fields.some((field) => field.key === 'contextVisibility'), true);
    assert.match(
      telegram?.fields.find((field) => field.key === 'contextVisibility')?.helpText || '',
      /allowlist_quote/i,
    );
  },
);

await runTest(
  'openClawConfigService writes channel access rules as native array and object values instead of string blobs',
  async () => {
    const { configurePlatformBridge, getPlatformBridge } = await import('@sdkwork/agentstudio-pc-infrastructure');
    const { openClawConfigService } = await import('./openClawConfigService.ts');

    const originalBridge = getPlatformBridge();
    let fileContent = `{
  channels: {},
}`;

    configurePlatformBridge({
      platform: createPlatformBridgeStub({
        readFile: async () => fileContent,
        writeFile: async (_path, content) => {
          fileContent = content;
        },
      }),
    });

    try {
      await openClawConfigService.saveChannelConfiguration({
        configFile: 'D:/OpenClaw/.openclaw/openclaw.json',
        channelId: 'slack',
        enabled: true,
        values: {
          allowFrom: '+15555550123\n+15555550124',
          groups: `{
  "*": {
    "requireMention": true
  }
}`,
        },
      });

      const snapshot = await openClawConfigService.readConfigSnapshot(
        'D:/OpenClaw/.openclaw/openclaw.json',
      );
      const parsed = parseJson5<{
        channels?: {
          slack?: {
            allowFrom?: string[];
            groups?: Record<string, { requireMention?: boolean }>;
          };
        };
      }>(fileContent);
      const slack = snapshot.channelSnapshots.find((channel) => channel.id === 'slack');

      assert.deepEqual(parsed.channels?.slack?.allowFrom, ['+15555550123', '+15555550124']);
      assert.deepEqual(parsed.channels?.slack?.groups, {
        '*': {
          requireMention: true,
        },
      });
      assert.equal(slack?.enabled, true);
      assert.equal(slack?.configuredFieldCount, 2);
      assert.match(slack?.values.allowFrom || '', /\+15555550123/);
      assert.match(slack?.values.groups || '', /requireMention/);
    } finally {
      configurePlatformBridge(originalBridge);
    }
  },
);

await runTest(
  'openClawConfigService migrates legacy qq channel entries during unrelated structured config saves',
  async () => {
    const { configurePlatformBridge, getPlatformBridge } = await import('@sdkwork/agentstudio-pc-infrastructure');
    const { openClawConfigService } = await import('./openClawConfigService.ts');

    const originalBridge = getPlatformBridge();
    let fileContent = `{
  channels: {
    telegram: {
      botToken: "123456:telegram-token",
      enabled: true,
    },
    feishu: {
      appId: "cli_a1234567890abcdef",
      enabled: true,
    },
    qq: {
      appId: "legacy-app-id",
      clientSecret: "legacy-secret",
      enabled: false,
    },
    defaults: {
      enabled: false,
    },
    modelByChannel: {
      telegram: {
        "*": "openai/gpt-5.4",
      },
      feishu: {
        "*": "openai/gpt-feishu",
      },
      qq: {
        "*": "openai/gpt-legacy",
      },
      dingtalk: {
        "*": "openai/gpt-legacy",
      },
    },
  },
  webSearch: {
    enabled: false,
  },
}`;

    configurePlatformBridge({
      platform: createPlatformBridgeStub({
        readFile: async () => fileContent,
        writeFile: async (_path, content) => {
          fileContent = content;
        },
      }),
    });

    try {
      await openClawConfigService.saveWebSearchConfiguration({
        configFile: 'D:/OpenClaw/.openclaw/openclaw.json',
        enabled: true,
        provider: 'searxng',
        maxResults: 8,
        timeoutSeconds: 20,
        cacheTtlMinutes: 10,
        providerConfig: {
          providerId: 'searxng',
          baseUrl: 'http://127.0.0.1:8080',
          advancedConfig: '',
        },
      });

      const parsed = parseJson5<{
        channels?: Record<string, unknown>;
      }>(fileContent);

      assert.equal(parsed.channels?.qq, undefined);
      assert.deepEqual(parsed.channels?.qqbot, {
        appId: 'legacy-app-id',
        clientSecret: 'legacy-secret',
        enabled: false,
      });
      assert.equal(typeof parsed.channels?.telegram, 'object');
      assert.equal(typeof parsed.channels?.feishu, 'object');
      assert.equal(typeof parsed.channels?.defaults, 'object');
      assert.deepEqual(parsed.channels?.modelByChannel, {
        feishu: {
          '*': 'openai/gpt-feishu',
        },
        qqbot: {
          '*': 'openai/gpt-legacy',
        },
        telegram: {
          '*': 'openai/gpt-5.4',
        },
      });
    } finally {
      configurePlatformBridge(originalBridge);
    }
  },
);

await runTest(
  'openClawConfigService migrates legacy qq channel entries during unrelated document helper saves',
  async () => {
    const { saveOpenClawWebSearchConfigInDocument } = await import('./openClawConfigService.ts');

    const nextDocument = saveOpenClawWebSearchConfigInDocument(
      `{
  channels: {
    qq: {
      appId: "legacy-app-id",
      clientSecret: "legacy-secret",
      enabled: false,
    },
    modelByChannel: {
      qq: {
        "*": "openai/gpt-legacy",
      },
    },
  },
  webSearch: {
    enabled: false,
  },
}`,
      {
        enabled: true,
        provider: 'searxng',
        maxResults: 8,
        timeoutSeconds: 20,
        cacheTtlMinutes: 10,
        providerConfig: {
          providerId: 'searxng',
          baseUrl: 'http://127.0.0.1:8080',
          advancedConfig: '',
        },
      },
    );

    const parsed = parseJson5<{
      channels?: Record<string, unknown>;
    }>(nextDocument);

    assert.equal(parsed.channels?.qq, undefined);
    assert.deepEqual(parsed.channels?.qqbot, {
      appId: 'legacy-app-id',
      clientSecret: 'legacy-secret',
      enabled: false,
    });
    assert.deepEqual(parsed.channels?.modelByChannel, {
      qqbot: {
        '*': 'openai/gpt-legacy',
      },
    });
  },
);

await runTest(
  'openClawConfigService migrates legacy qq channel entries when saving raw config documents',
  async () => {
    const { configurePlatformBridge, getPlatformBridge } = await import('@sdkwork/agentstudio-pc-infrastructure');
    const { openClawConfigService } = await import('./openClawConfigService.ts');

    const originalBridge = getPlatformBridge();
    let fileContent = '';

    configurePlatformBridge({
      platform: createPlatformBridgeStub({
        getPathInfo: async (path) => ({
          path,
          name: 'openclaw.json',
          kind: 'file',
          size: 0,
          extension: '.json',
          exists: true,
          lastModifiedMs: 1,
        }),
        writeFile: async (_path, content) => {
          fileContent = content;
        },
      }),
    });

    try {
      await openClawConfigService.writeConfigDocument(
        'D:/OpenClaw/.openclaw/openclaw.json',
        `{
  channels: {
    telegram: {
      botToken: "123456:telegram-token",
      enabled: true,
    },
    qq: {
      appId: "legacy-app-id",
      clientSecret: "legacy-secret",
      enabled: true,
    },
    modelByChannel: {
      telegram: {
        "*": "openai/gpt-5.4",
      },
      qq: {
        "*": "openai/gpt-legacy",
      },
    },
  },
}`,
      );

      const parsed = parseJson5<{
        channels?: Record<string, unknown>;
      }>(fileContent);

      assert.equal(parsed.channels?.qq, undefined);
      assert.deepEqual(parsed.channels?.qqbot, {
        appId: 'legacy-app-id',
        clientSecret: 'legacy-secret',
        enabled: true,
      });
      assert.deepEqual(parsed.channels?.modelByChannel, {
        qqbot: {
          '*': 'openai/gpt-legacy',
        },
        telegram: {
          '*': 'openai/gpt-5.4',
        },
      });
    } finally {
      configurePlatformBridge(originalBridge);
    }
  },
);

await runTest(
  'openClawConfigService writes per-channel context visibility without losing other channel settings',
  async () => {
    const { configurePlatformBridge, getPlatformBridge } = await import('@sdkwork/agentstudio-pc-infrastructure');
    const { openClawConfigService } = await import('./openClawConfigService.ts');

    const originalBridge = getPlatformBridge();
    let fileContent = `{
  channels: {
    telegram: {
      botToken: "123456:telegram-token"
    }
  },
}`;

    configurePlatformBridge({
      platform: createPlatformBridgeStub({
        readFile: async () => fileContent,
        writeFile: async (_path, content) => {
          fileContent = content;
        },
      }),
    });

    try {
      await openClawConfigService.saveChannelConfiguration({
        configFile: 'D:/OpenClaw/.openclaw/openclaw.json',
        channelId: 'telegram',
        enabled: true,
        values: {
          botToken: '123456:telegram-token',
          contextVisibility: 'allowlist_quote',
        },
      });

      const snapshot = await openClawConfigService.readConfigSnapshot(
        'D:/OpenClaw/.openclaw/openclaw.json',
      );
      const parsed = parseJson5<{
        channels?: {
          telegram?: {
            botToken?: string;
            contextVisibility?: string;
          };
        };
      }>(fileContent);
      const telegram = snapshot.channelSnapshots.find((channel) => channel.id === 'telegram');

      assert.equal(parsed.channels?.telegram?.botToken, '123456:telegram-token');
      assert.equal(parsed.channels?.telegram?.contextVisibility, 'allowlist_quote');
      assert.equal(telegram?.values.contextVisibility, 'allowlist_quote');
    } finally {
      configurePlatformBridge(originalBridge);
    }
  },
);

await runTest(
  'openClawConfigService reads canonical Gemini, Grok, and Kimi web search providers from their plugin webSearch roots',
  async () => {
    const { configurePlatformBridge, getPlatformBridge } = await import('@sdkwork/agentstudio-pc-infrastructure');
    const { openClawConfigService } = await import('./openClawConfigService.ts');

    const originalBridge = getPlatformBridge();
    const fileContent = `{
  tools: {
    web: {
      search: {
        enabled: true,
        provider: "grok",
        maxResults: 7,
        timeoutSeconds: 40,
        cacheTtlMinutes: 10,
      },
    },
  },
  plugins: {
    entries: {
      google: {
        config: {
          webSearch: {
            apiKey: "\${GEMINI_API_KEY}",
            model: "gemini-2.5-flash",
          },
        },
      },
      xai: {
        config: {
          webSearch: {
            apiKey: "\${XAI_API_KEY}",
            model: "grok-4-fast",
            inlineCitations: true,
          },
        },
      },
      moonshot: {
        config: {
          webSearch: {
            apiKey: "\${MOONSHOT_API_KEY}",
            baseUrl: "https://api.moonshot.ai/v1",
            model: "kimi-k2.5",
          },
        },
      },
    },
  },
}`;

    configurePlatformBridge({
      platform: createPlatformBridgeStub({
        readFile: async () => fileContent,
      }),
    });

    try {
      const snapshot = await openClawConfigService.readConfigSnapshot(
        'D:/OpenClaw/.openclaw/openclaw.json',
      );
      const gemini = snapshot.webSearchConfig.providers.find((provider) => provider.id === 'gemini');
      const grok = snapshot.webSearchConfig.providers.find((provider) => provider.id === 'grok');
      const kimi = snapshot.webSearchConfig.providers.find((provider) => provider.id === 'kimi');

      assert.equal(snapshot.webSearchConfig.provider, 'grok');
      assert.equal(gemini?.apiKeySource, 'env:GEMINI_API_KEY');
      assert.equal(gemini?.model, 'gemini-2.5-flash');
      assert.equal(gemini?.supportsModel, true);
      assert.equal(grok?.apiKeySource, 'env:XAI_API_KEY');
      assert.equal(grok?.model, 'grok-4-fast');
      assert.match(grok?.advancedConfig || '', /inlineCitations/);
      assert.equal(grok?.supportsModel, true);
      assert.equal(kimi?.apiKeySource, 'env:MOONSHOT_API_KEY');
      assert.equal(kimi?.baseUrl, 'https://api.moonshot.ai/v1');
      assert.equal(kimi?.model, 'kimi-k2.5');
      assert.equal(kimi?.supportsBaseUrl, true);
      assert.equal(kimi?.supportsModel, true);
    } finally {
      configurePlatformBridge(originalBridge);
    }
  },
);

await runTest(
  'openClawConfigService reads web search settings from shared tools.web.search and provider plugin config together',
  async () => {
    const { configurePlatformBridge, getPlatformBridge } = await import('@sdkwork/agentstudio-pc-infrastructure');
    const { openClawConfigService } = await import('./openClawConfigService.ts');

    const originalBridge = getPlatformBridge();
    const fileContent = `{
  tools: {
    web: {
      search: {
        enabled: true,
        provider: "searxng",
        maxResults: 9,
        timeoutSeconds: 45,
        cacheTtlMinutes: 25,
      },
    },
  },
  plugins: {
    entries: {
      searxng: {
        config: {
          webSearch: {
            baseUrl: "http://127.0.0.1:8080",
            categories: "general,news",
            language: "zh-CN",
          },
        },
      },
      perplexity: {
        config: {
          webSearch: {
            apiKey: "pplx-live",
            model: "sonar-pro",
          },
        },
      },
    },
  },
}`;

    configurePlatformBridge({
      platform: createPlatformBridgeStub({
        readFile: async () => fileContent,
      }),
    });

    try {
      const snapshot = await openClawConfigService.readConfigSnapshot(
        'D:/OpenClaw/.openclaw/openclaw.json',
      );
      const searxng = snapshot.webSearchConfig.providers.find((provider) => provider.id === 'searxng');
      const perplexity = snapshot.webSearchConfig.providers.find((provider) => provider.id === 'perplexity');

      assert.equal(snapshot.webSearchConfig.enabled, true);
      assert.equal(snapshot.webSearchConfig.provider, 'searxng');
      assert.equal(snapshot.webSearchConfig.maxResults, 9);
      assert.equal(snapshot.webSearchConfig.timeoutSeconds, 45);
      assert.equal(snapshot.webSearchConfig.cacheTtlMinutes, 25);
      assert.equal(searxng?.baseUrl, 'http://127.0.0.1:8080');
      assert.match(searxng?.advancedConfig || '', /categories/);
      assert.equal(perplexity?.apiKeySource, 'pplx-live');
      assert.equal(perplexity?.model, 'sonar-pro');
    } finally {
      configurePlatformBridge(originalBridge);
    }
  },
);

await runTest(
  'openClawConfigService writes canonical Grok web search settings into the xai webSearch plugin root',
  async () => {
    const { configurePlatformBridge, getPlatformBridge } = await import('@sdkwork/agentstudio-pc-infrastructure');
    const { openClawConfigService } = await import('./openClawConfigService.ts');

    const originalBridge = getPlatformBridge();
    let fileContent = `{
  tools: {
    web: {
      search: {
        enabled: false,
        provider: "brave",
        maxResults: 5,
        timeoutSeconds: 30,
        cacheTtlMinutes: 15,
      },
    },
  },
  plugins: {
    entries: {
      xai: {
        enabled: false,
        metadata: {
          label: "xAI Search",
        },
        config: {
          theme: "dark",
          webSearch: {
            apiKey: "xai-old",
          },
          xSearch: {
            enabled: true,
          },
        },
      },
    },
  },
}`;

    configurePlatformBridge({
      platform: createPlatformBridgeStub({
        readFile: async () => fileContent,
        writeFile: async (_path, content) => {
          fileContent = content;
        },
      }),
    });

    try {
      const saved = await openClawConfigService.saveWebSearchConfiguration({
        configFile: 'D:/OpenClaw/.openclaw/openclaw.json',
        enabled: true,
        provider: 'grok',
        maxResults: 11,
        timeoutSeconds: 55,
        cacheTtlMinutes: 18,
        providerConfig: {
          providerId: 'grok',
          apiKeySource: 'env:XAI_API_KEY',
          model: 'grok-4-fast',
          advancedConfig: `{
  "inlineCitations": true
}`,
        },
      });
      const parsed = parseJson5<{
        tools?: {
          web?: {
            search?: {
              enabled?: boolean;
              provider?: string;
            };
          };
        };
        plugins?: {
          entries?: {
            xai?: {
              config?: {
                theme?: string;
                webSearch?: {
                  apiKey?: string;
                  model?: string;
                  inlineCitations?: boolean;
                };
                xSearch?: {
                  enabled?: boolean;
                };
              };
            };
          };
        };
      }>(fileContent);
      const grok = saved.providers.find((provider) => provider.id === 'grok');

      assert.equal(parsed.tools?.web?.search?.enabled, true);
      assert.equal(parsed.tools?.web?.search?.provider, 'grok');
      assert.equal(parsed.plugins?.entries?.xai?.config?.theme, 'dark');
      assert.equal(parsed.plugins?.entries?.xai?.config?.xSearch?.enabled, true);
      assert.equal(parsed.plugins?.entries?.xai?.config?.webSearch?.apiKey, '${XAI_API_KEY}');
      assert.equal(parsed.plugins?.entries?.xai?.config?.webSearch?.model, 'grok-4-fast');
      assert.equal(parsed.plugins?.entries?.xai?.config?.webSearch?.inlineCitations, true);
      assert.equal(grok?.apiKeySource, 'env:XAI_API_KEY');
      assert.equal(grok?.model, 'grok-4-fast');
      assert.match(grok?.advancedConfig || '', /inlineCitations/);
    } finally {
      configurePlatformBridge(originalBridge);
    }
  },
);

await runTest(
  'openClawConfigService writes canonical Kimi web search settings into the moonshot webSearch plugin root',
  async () => {
    const { configurePlatformBridge, getPlatformBridge } = await import('@sdkwork/agentstudio-pc-infrastructure');
    const { openClawConfigService } = await import('./openClawConfigService.ts');

    const originalBridge = getPlatformBridge();
    let fileContent = `{
  tools: {
    web: {
      search: {
        enabled: false,
        provider: "brave",
        maxResults: 5,
        timeoutSeconds: 30,
        cacheTtlMinutes: 15,
      },
    },
  },
}`;

    configurePlatformBridge({
      platform: createPlatformBridgeStub({
        readFile: async () => fileContent,
        writeFile: async (_path, content) => {
          fileContent = content;
        },
      }),
    });

    try {
      const saved = await openClawConfigService.saveWebSearchConfiguration({
        configFile: 'D:/OpenClaw/.openclaw/openclaw.json',
        enabled: true,
        provider: 'kimi',
        maxResults: 8,
        timeoutSeconds: 35,
        cacheTtlMinutes: 12,
        providerConfig: {
          providerId: 'kimi',
          apiKeySource: 'env:MOONSHOT_API_KEY',
          baseUrl: 'https://api.moonshot.ai/v1',
          model: 'kimi-k2.5',
          advancedConfig: `{
  "region": "cn"
}`,
        },
      });
      const parsed = parseJson5<{
        tools?: {
          web?: {
            search?: {
              enabled?: boolean;
              provider?: string;
            };
          };
        };
        plugins?: {
          entries?: {
            moonshot?: {
              config?: {
                webSearch?: {
                  apiKey?: string;
                  baseUrl?: string;
                  model?: string;
                  region?: string;
                };
              };
            };
          };
        };
      }>(fileContent);
      const kimi = saved.providers.find((provider) => provider.id === 'kimi');

      assert.equal(parsed.tools?.web?.search?.enabled, true);
      assert.equal(parsed.tools?.web?.search?.provider, 'kimi');
      assert.equal(parsed.plugins?.entries?.moonshot?.config?.webSearch?.apiKey, '${MOONSHOT_API_KEY}');
      assert.equal(parsed.plugins?.entries?.moonshot?.config?.webSearch?.baseUrl, 'https://api.moonshot.ai/v1');
      assert.equal(parsed.plugins?.entries?.moonshot?.config?.webSearch?.model, 'kimi-k2.5');
      assert.equal(parsed.plugins?.entries?.moonshot?.config?.webSearch?.region, 'cn');
      assert.equal(kimi?.apiKeySource, 'env:MOONSHOT_API_KEY');
      assert.equal(kimi?.baseUrl, 'https://api.moonshot.ai/v1');
      assert.equal(kimi?.model, 'kimi-k2.5');
      assert.match(kimi?.advancedConfig || '', /region/);
    } finally {
      configurePlatformBridge(originalBridge);
    }
  },
);

await runTest(
  'openClawConfigService writes managed web search settings without clobbering sibling plugin config',
  async () => {
    const { configurePlatformBridge, getPlatformBridge } = await import('@sdkwork/agentstudio-pc-infrastructure');
    const { openClawConfigService } = await import('./openClawConfigService.ts');

    const originalBridge = getPlatformBridge();
    let fileContent = `{
  tools: {
    web: {
      search: {
        enabled: false,
        provider: "brave",
        maxResults: 5,
        timeoutSeconds: 30,
        cacheTtlMinutes: 15,
      },
    },
  },
  plugins: {
    entries: {
      searxng: {
        enabled: false,
        metadata: {
          label: "Self-hosted SearXNG",
        },
        config: {
          theme: "dark",
          webSearch: {
            baseUrl: "http://old.example",
          },
        },
      },
    },
  },
}`;

    configurePlatformBridge({
      platform: createPlatformBridgeStub({
        readFile: async () => fileContent,
        writeFile: async (_path, content) => {
          fileContent = content;
        },
      }),
    });

    try {
      const saved = await openClawConfigService.saveWebSearchConfiguration({
        configFile: 'D:/OpenClaw/.openclaw/openclaw.json',
        enabled: true,
        provider: 'searxng',
        maxResults: 12,
        timeoutSeconds: 60,
        cacheTtlMinutes: 20,
        providerConfig: {
          providerId: 'searxng',
          baseUrl: 'http://search.internal:8080',
          advancedConfig: `{
  "categories": "general",
  "language": "en"
}`,
        },
      });
      const parsed = parseJson5<{
        tools?: {
          web?: {
            search?: {
              enabled?: boolean;
              provider?: string;
              maxResults?: number;
              timeoutSeconds?: number;
              cacheTtlMinutes?: number;
            };
          };
        };
        plugins?: {
          entries?: {
            searxng?: {
              enabled?: boolean;
              metadata?: {
                label?: string;
              };
              config?: {
                theme?: string;
                webSearch?: {
                  baseUrl?: string;
                  categories?: string;
                  language?: string;
                };
              };
            };
          };
        };
      }>(fileContent);
      const searxng = saved.providers.find((provider) => provider.id === 'searxng');

      assert.equal(parsed.tools?.web?.search?.enabled, true);
      assert.equal(parsed.tools?.web?.search?.provider, 'searxng');
      assert.equal(parsed.tools?.web?.search?.maxResults, 12);
      assert.equal(parsed.tools?.web?.search?.timeoutSeconds, 60);
      assert.equal(parsed.tools?.web?.search?.cacheTtlMinutes, 20);
      assert.equal(parsed.plugins?.entries?.searxng?.enabled, false);
      assert.equal(parsed.plugins?.entries?.searxng?.metadata?.label, 'Self-hosted SearXNG');
      assert.equal(parsed.plugins?.entries?.searxng?.config?.theme, 'dark');
      assert.equal(
        parsed.plugins?.entries?.searxng?.config?.webSearch?.baseUrl,
        'http://search.internal:8080',
      );
      assert.equal(parsed.plugins?.entries?.searxng?.config?.webSearch?.categories, 'general');
      assert.equal(parsed.plugins?.entries?.searxng?.config?.webSearch?.language, 'en');
      assert.equal(searxng?.baseUrl, 'http://search.internal:8080');
      assert.match(searxng?.advancedConfig || '', /language/);
    } finally {
      configurePlatformBridge(originalBridge);
    }
  },
);

await runTest(
  'openClawConfigService normalizes legacy xai web search provider ids to canonical Grok snapshots',
  async () => {
    const { configurePlatformBridge, getPlatformBridge } = await import('@sdkwork/agentstudio-pc-infrastructure');
    const { openClawConfigService } = await import('./openClawConfigService.ts');

    const originalBridge = getPlatformBridge();
    const fileContent = `{
  tools: {
    web: {
      search: {
        enabled: true,
        provider: "xai",
        maxResults: 7,
        timeoutSeconds: 40,
        cacheTtlMinutes: 10,
      },
    },
  },
  plugins: {
    entries: {
      xai: {
        config: {
          webSearch: {
            apiKey: "\${XAI_API_KEY}",
            model: "grok-4-fast",
            inlineCitations: true,
          },
          xSearch: {
            mode: "balanced",
            userLocation: "CN",
          },
        },
      },
    },
  },
}`;

    configurePlatformBridge({
      platform: createPlatformBridgeStub({
        readFile: async () => fileContent,
      }),
    });

    try {
      const snapshot = await openClawConfigService.readConfigSnapshot(
        'D:/OpenClaw/.openclaw/openclaw.json',
      );
      const grok = snapshot.webSearchConfig.providers.find((provider) => provider.id === 'grok');

      assert.equal(snapshot.webSearchConfig.provider, 'grok');
      assert.equal(grok?.apiKeySource, 'env:XAI_API_KEY');
      assert.equal(grok?.model, 'grok-4-fast');
      assert.match(grok?.advancedConfig || '', /inlineCitations/);
      assert.doesNotMatch(grok?.advancedConfig || '', /userLocation/);
    } finally {
      configurePlatformBridge(originalBridge);
    }
  },
);

await runTest(
  'openClawConfigService preserves sibling xSearch settings while writing canonical Grok web search config',
  async () => {
    const { configurePlatformBridge, getPlatformBridge } = await import('@sdkwork/agentstudio-pc-infrastructure');
    const { openClawConfigService } = await import('./openClawConfigService.ts');

    const originalBridge = getPlatformBridge();
    let fileContent = `{
  tools: {
    web: {
      search: {
        enabled: false,
        provider: "brave",
        maxResults: 5,
        timeoutSeconds: 30,
        cacheTtlMinutes: 15,
      },
    },
  },
  plugins: {
    entries: {
      xai: {
        enabled: false,
        metadata: {
          label: "xAI Search",
        },
        config: {
          theme: "dark",
          webSearch: {
            apiKey: "\${OLD_XAI_API_KEY}",
          },
          xSearch: {
            enabled: true,
          },
        },
      },
    },
  },
}`;

    configurePlatformBridge({
      platform: createPlatformBridgeStub({
        readFile: async () => fileContent,
        writeFile: async (_path, content) => {
          fileContent = content;
        },
      }),
    });

    try {
      const saved = await openClawConfigService.saveWebSearchConfiguration({
        configFile: 'D:/OpenClaw/.openclaw/openclaw.json',
        enabled: true,
        provider: 'grok',
        maxResults: 11,
        timeoutSeconds: 55,
        cacheTtlMinutes: 18,
        providerConfig: {
          providerId: 'grok',
          apiKeySource: 'env:XAI_API_KEY',
          model: 'grok-4-fast',
          advancedConfig: `{
  "inlineCitations": true
}`,
        },
      });
      const parsed = parseJson5<{
        tools?: {
          web?: {
            search?: {
              enabled?: boolean;
              provider?: string;
              maxResults?: number;
              timeoutSeconds?: number;
              cacheTtlMinutes?: number;
            };
          };
        };
        plugins?: {
          entries?: {
            xai?: {
              enabled?: boolean;
              metadata?: {
                label?: string;
              };
              config?: {
                theme?: string;
                webSearch?: {
                  apiKey?: string;
                  model?: string;
                  inlineCitations?: boolean;
                };
                xSearch?: {
                  enabled?: boolean;
                };
              };
            };
          };
        };
      }>(fileContent);
      const grok = saved.providers.find((provider) => provider.id === 'grok');

      assert.equal(parsed.tools?.web?.search?.enabled, true);
      assert.equal(parsed.tools?.web?.search?.provider, 'grok');
      assert.equal(parsed.tools?.web?.search?.maxResults, 11);
      assert.equal(parsed.tools?.web?.search?.timeoutSeconds, 55);
      assert.equal(parsed.tools?.web?.search?.cacheTtlMinutes, 18);
      assert.equal(parsed.plugins?.entries?.xai?.enabled, false);
      assert.equal(parsed.plugins?.entries?.xai?.metadata?.label, 'xAI Search');
      assert.equal(parsed.plugins?.entries?.xai?.config?.theme, 'dark');
      assert.equal(parsed.plugins?.entries?.xai?.config?.webSearch?.apiKey, '${XAI_API_KEY}');
      assert.equal(parsed.plugins?.entries?.xai?.config?.webSearch?.model, 'grok-4-fast');
      assert.equal(parsed.plugins?.entries?.xai?.config?.webSearch?.inlineCitations, true);
      assert.equal(parsed.plugins?.entries?.xai?.config?.xSearch?.enabled, true);
      assert.equal(grok?.apiKeySource, 'env:XAI_API_KEY');
      assert.equal(grok?.model, 'grok-4-fast');
      assert.match(grok?.advancedConfig || '', /inlineCitations/);
    } finally {
      configurePlatformBridge(originalBridge);
    }
  },
);

await runTest(
  'openClawConfigService reads web fetch settings from shared tools.web.fetch and firecrawl plugin webFetch config together',
  async () => {
    const { configurePlatformBridge, getPlatformBridge } = await import('@sdkwork/agentstudio-pc-infrastructure');
    const { openClawConfigService } = await import('./openClawConfigService.ts');

    const originalBridge = getPlatformBridge();
    const fileContent = `{
  tools: {
    web: {
      fetch: {
        enabled: true,
        maxChars: 42000,
        maxCharsCap: 60000,
        maxResponseBytes: 2500000,
        timeoutSeconds: 28,
        cacheTtlMinutes: 9,
        maxRedirects: 4,
        readability: false,
        userAgent: "SDKWork Fetch Bot/1.0",
      },
    },
  },
  plugins: {
    entries: {
      firecrawl: {
        config: {
          webFetch: {
            apiKey: "\${FIRECRAWL_API_KEY}",
            baseUrl: "https://api.firecrawl.dev",
            onlyMainContent: true,
            maxAgeMs: 86400000,
            timeoutSeconds: 60,
          },
          webSearch: {
            apiKey: "fc-search-live",
          },
        },
      },
    },
  },
}`;

    configurePlatformBridge({
      platform: createPlatformBridgeStub({
        readFile: async () => fileContent,
      }),
    });

    try {
      const snapshot = await openClawConfigService.readConfigSnapshot(
        'D:/OpenClaw/.openclaw/openclaw.json',
      );

      assert.equal(snapshot.webFetchConfig.enabled, true);
      assert.equal(snapshot.webFetchConfig.maxChars, 42000);
      assert.equal(snapshot.webFetchConfig.maxCharsCap, 60000);
      assert.equal(snapshot.webFetchConfig.maxResponseBytes, 2500000);
      assert.equal(snapshot.webFetchConfig.timeoutSeconds, 28);
      assert.equal(snapshot.webFetchConfig.cacheTtlMinutes, 9);
      assert.equal(snapshot.webFetchConfig.maxRedirects, 4);
      assert.equal(snapshot.webFetchConfig.readability, false);
      assert.equal(snapshot.webFetchConfig.userAgent, 'SDKWork Fetch Bot/1.0');
      assert.equal(snapshot.webFetchConfig.fallbackProvider.providerId, 'firecrawl');
      assert.equal(snapshot.webFetchConfig.fallbackProvider.apiKeySource, 'env:FIRECRAWL_API_KEY');
      assert.equal(snapshot.webFetchConfig.fallbackProvider.baseUrl, 'https://api.firecrawl.dev');
      assert.match(snapshot.webFetchConfig.fallbackProvider.advancedConfig, /onlyMainContent/);
      assert.doesNotMatch(snapshot.webFetchConfig.fallbackProvider.advancedConfig, /fc-search-live/);
    } finally {
      configurePlatformBridge(originalBridge);
    }
  },
);

await runTest(
  'openClawConfigService writes managed web fetch settings into the firecrawl webFetch plugin root without clobbering sibling plugin config',
  async () => {
    const { configurePlatformBridge, getPlatformBridge } = await import('@sdkwork/agentstudio-pc-infrastructure');
    const { openClawConfigService } = await import('./openClawConfigService.ts');

    const originalBridge = getPlatformBridge();
    let fileContent = `{
  tools: {
    web: {
      fetch: {
        enabled: false,
        maxChars: 50000,
        maxCharsCap: 50000,
        maxResponseBytes: 2000000,
        timeoutSeconds: 30,
        cacheTtlMinutes: 15,
        maxRedirects: 3,
        readability: true,
      },
    },
  },
  plugins: {
    entries: {
      firecrawl: {
        enabled: false,
        metadata: {
          label: "Firecrawl",
        },
        config: {
          theme: "dark",
          webSearch: {
            apiKey: "fc-search-live",
          },
          webFetch: {
            apiKey: "\${OLD_FIRECRAWL_API_KEY}",
          },
        },
      },
    },
  },
}`;

    configurePlatformBridge({
      platform: createPlatformBridgeStub({
        readFile: async () => fileContent,
        writeFile: async (_path, content) => {
          fileContent = content;
        },
      }),
    });

    try {
      const saved = await openClawConfigService.saveWebFetchConfiguration({
        configFile: 'D:/OpenClaw/.openclaw/openclaw.json',
        enabled: true,
        maxChars: 42000,
        maxCharsCap: 64000,
        maxResponseBytes: 2500000,
        timeoutSeconds: 28,
        cacheTtlMinutes: 9,
        maxRedirects: 4,
        readability: false,
        userAgent: 'SDKWork Fetch Bot/1.0',
        fallbackProviderConfig: {
          providerId: 'firecrawl',
          apiKeySource: 'env:FIRECRAWL_API_KEY',
          baseUrl: 'https://api.firecrawl.dev',
          advancedConfig: `{
  "onlyMainContent": true,
  "maxAgeMs": 86400000,
  "timeoutSeconds": 60
}`,
        },
      });
      const parsed = parseJson5<{
        tools?: {
          web?: {
            fetch?: {
              enabled?: boolean;
              maxChars?: number;
              maxCharsCap?: number;
              maxResponseBytes?: number;
              timeoutSeconds?: number;
              cacheTtlMinutes?: number;
              maxRedirects?: number;
              readability?: boolean;
              userAgent?: string;
            };
          };
        };
        plugins?: {
          entries?: {
            firecrawl?: {
              enabled?: boolean;
              metadata?: {
                label?: string;
              };
              config?: {
                theme?: string;
                webSearch?: {
                  apiKey?: string;
                };
                webFetch?: {
                  apiKey?: string;
                  baseUrl?: string;
                  onlyMainContent?: boolean;
                  maxAgeMs?: number;
                  timeoutSeconds?: number;
                };
              };
            };
          };
        };
      }>(fileContent);

      assert.equal(parsed.tools?.web?.fetch?.enabled, true);
      assert.equal(parsed.tools?.web?.fetch?.maxChars, 42000);
      assert.equal(parsed.tools?.web?.fetch?.maxCharsCap, 64000);
      assert.equal(parsed.tools?.web?.fetch?.maxResponseBytes, 2500000);
      assert.equal(parsed.tools?.web?.fetch?.timeoutSeconds, 28);
      assert.equal(parsed.tools?.web?.fetch?.cacheTtlMinutes, 9);
      assert.equal(parsed.tools?.web?.fetch?.maxRedirects, 4);
      assert.equal(parsed.tools?.web?.fetch?.readability, false);
      assert.equal(parsed.tools?.web?.fetch?.userAgent, 'SDKWork Fetch Bot/1.0');
      assert.equal(parsed.plugins?.entries?.firecrawl?.enabled, false);
      assert.equal(parsed.plugins?.entries?.firecrawl?.metadata?.label, 'Firecrawl');
      assert.equal(parsed.plugins?.entries?.firecrawl?.config?.theme, 'dark');
      assert.equal(parsed.plugins?.entries?.firecrawl?.config?.webSearch?.apiKey, 'fc-search-live');
      assert.equal(parsed.plugins?.entries?.firecrawl?.config?.webFetch?.apiKey, '${FIRECRAWL_API_KEY}');
      assert.equal(parsed.plugins?.entries?.firecrawl?.config?.webFetch?.baseUrl, 'https://api.firecrawl.dev');
      assert.equal(parsed.plugins?.entries?.firecrawl?.config?.webFetch?.onlyMainContent, true);
      assert.equal(parsed.plugins?.entries?.firecrawl?.config?.webFetch?.maxAgeMs, 86400000);
      assert.equal(parsed.plugins?.entries?.firecrawl?.config?.webFetch?.timeoutSeconds, 60);
      assert.equal(saved.fallbackProvider.providerId, 'firecrawl');
      assert.equal(saved.fallbackProvider.apiKeySource, 'env:FIRECRAWL_API_KEY');
      assert.equal(saved.fallbackProvider.baseUrl, 'https://api.firecrawl.dev');
      assert.match(saved.fallbackProvider.advancedConfig, /onlyMainContent/);
    } finally {
      configurePlatformBridge(originalBridge);
    }
  },
);

await runTest(
  'openClawConfigService reads x_search settings from xai plugin config together with shared xAI auth',
  async () => {
    const { configurePlatformBridge, getPlatformBridge } = await import('@sdkwork/agentstudio-pc-infrastructure');
    const { openClawConfigService } = await import('./openClawConfigService.ts');

    const originalBridge = getPlatformBridge();
    const fileContent = `{
  plugins: {
    entries: {
      xai: {
        config: {
          webSearch: {
            apiKey: "\${XAI_API_KEY}",
            model: "grok-4-fast",
          },
          xSearch: {
            enabled: true,
            model: "grok-4-1-fast-non-reasoning",
            inlineCitations: false,
            maxTurns: 2,
            timeoutSeconds: 30,
            cacheTtlMinutes: 15,
            userTag: "internal-research",
          },
        },
      },
    },
  },
}`;

    configurePlatformBridge({
      platform: createPlatformBridgeStub({
        readFile: async () => fileContent,
      }),
    });

    try {
      const snapshot = await openClawConfigService.readConfigSnapshot(
        'D:/OpenClaw/.openclaw/openclaw.json',
      );

      assert.equal(snapshot.xSearchConfig.enabled, true);
      assert.equal(snapshot.xSearchConfig.apiKeySource, 'env:XAI_API_KEY');
      assert.equal(snapshot.xSearchConfig.model, 'grok-4-1-fast-non-reasoning');
      assert.equal(snapshot.xSearchConfig.inlineCitations, false);
      assert.equal(snapshot.xSearchConfig.maxTurns, 2);
      assert.equal(snapshot.xSearchConfig.timeoutSeconds, 30);
      assert.equal(snapshot.xSearchConfig.cacheTtlMinutes, 15);
      assert.match(snapshot.xSearchConfig.advancedConfig, /internal-research/);
      assert.doesNotMatch(snapshot.xSearchConfig.advancedConfig, /xai-live/);
    } finally {
      configurePlatformBridge(originalBridge);
    }
  },
);

await runTest(
  'openClawConfigService writes managed x_search settings into the xai plugin root without clobbering sibling webSearch config',
  async () => {
    const { configurePlatformBridge, getPlatformBridge } = await import('@sdkwork/agentstudio-pc-infrastructure');
    const { openClawConfigService } = await import('./openClawConfigService.ts');

    const originalBridge = getPlatformBridge();
    let fileContent = `{
  plugins: {
    entries: {
      xai: {
        enabled: false,
        metadata: {
          label: "xAI Search",
        },
        config: {
          theme: "dark",
          webSearch: {
            apiKey: "\${OLD_XAI_API_KEY}",
            model: "grok-4-fast",
            inlineCitations: true,
          },
          xSearch: {
            enabled: false,
            model: "grok-4-fast-mini",
          },
        },
      },
    },
  },
}`;

    configurePlatformBridge({
      platform: createPlatformBridgeStub({
        readFile: async () => fileContent,
        writeFile: async (_path, content) => {
          fileContent = content;
        },
      }),
    });

    try {
      const saved = await openClawConfigService.saveXSearchConfiguration({
        configFile: 'D:/OpenClaw/.openclaw/openclaw.json',
        enabled: true,
        apiKeySource: 'env:XAI_API_KEY',
        model: 'grok-4-1-fast-non-reasoning',
        inlineCitations: false,
        maxTurns: 3,
        timeoutSeconds: 45,
        cacheTtlMinutes: 18,
        advancedConfig: `{
  "userTag": "internal-research"
}`,
      });
      const parsed = parseJson5<{
        plugins?: {
          entries?: {
            xai?: {
              enabled?: boolean;
              metadata?: {
                label?: string;
              };
              config?: {
                theme?: string;
                webSearch?: {
                  apiKey?: string;
                  model?: string;
                  inlineCitations?: boolean;
                };
                xSearch?: {
                  enabled?: boolean;
                  model?: string;
                  inlineCitations?: boolean;
                  maxTurns?: number;
                  timeoutSeconds?: number;
                  cacheTtlMinutes?: number;
                  userTag?: string;
                };
              };
            };
          };
        };
      }>(fileContent);

      assert.equal(parsed.plugins?.entries?.xai?.enabled, false);
      assert.equal(parsed.plugins?.entries?.xai?.metadata?.label, 'xAI Search');
      assert.equal(parsed.plugins?.entries?.xai?.config?.theme, 'dark');
      assert.equal(parsed.plugins?.entries?.xai?.config?.webSearch?.apiKey, '${XAI_API_KEY}');
      assert.equal(parsed.plugins?.entries?.xai?.config?.webSearch?.model, 'grok-4-fast');
      assert.equal(parsed.plugins?.entries?.xai?.config?.webSearch?.inlineCitations, true);
      assert.equal(parsed.plugins?.entries?.xai?.config?.xSearch?.enabled, true);
      assert.equal(parsed.plugins?.entries?.xai?.config?.xSearch?.model, 'grok-4-1-fast-non-reasoning');
      assert.equal(parsed.plugins?.entries?.xai?.config?.xSearch?.inlineCitations, false);
      assert.equal(parsed.plugins?.entries?.xai?.config?.xSearch?.maxTurns, 3);
      assert.equal(parsed.plugins?.entries?.xai?.config?.xSearch?.timeoutSeconds, 45);
      assert.equal(parsed.plugins?.entries?.xai?.config?.xSearch?.cacheTtlMinutes, 18);
      assert.equal(parsed.plugins?.entries?.xai?.config?.xSearch?.userTag, 'internal-research');
      assert.equal(saved.apiKeySource, 'env:XAI_API_KEY');
      assert.equal(saved.model, 'grok-4-1-fast-non-reasoning');
      assert.equal(saved.maxTurns, 3);
      assert.match(saved.advancedConfig, /internal-research/);
    } finally {
      configurePlatformBridge(originalBridge);
    }
  },
);

await runTest(
  'openClawConfigService reads native Codex web search settings from tools.web.search.openaiCodex',
  async () => {
    const { configurePlatformBridge, getPlatformBridge } = await import('@sdkwork/agentstudio-pc-infrastructure');
    const { openClawConfigService } = await import('./openClawConfigService.ts');

    const originalBridge = getPlatformBridge();
    const fileContent = `{
  tools: {
    web: {
      search: {
        enabled: true,
        provider: "brave",
        maxResults: 5,
        timeoutSeconds: 30,
        cacheTtlMinutes: 15,
        openaiCodex: {
          enabled: true,
          mode: "cached",
          allowedDomains: ["example.com", "openai.com"],
          contextSize: "high",
          userLocation: {
            country: "US",
            city: "New York",
            timezone: "America/New_York",
          },
          reasoningEffort: "medium",
        },
      },
    },
  },
}`;

    configurePlatformBridge({
      platform: createPlatformBridgeStub({
        readFile: async () => fileContent,
      }),
    });

    try {
      const snapshot = await openClawConfigService.readConfigSnapshot(
        'D:/OpenClaw/.openclaw/openclaw.json',
      );

      assert.equal(snapshot.webSearchNativeCodexConfig.enabled, true);
      assert.equal(snapshot.webSearchNativeCodexConfig.mode, 'cached');
      assert.deepEqual(snapshot.webSearchNativeCodexConfig.allowedDomains, ['example.com', 'openai.com']);
      assert.equal(snapshot.webSearchNativeCodexConfig.contextSize, 'high');
      assert.equal(snapshot.webSearchNativeCodexConfig.userLocation.country, 'US');
      assert.equal(snapshot.webSearchNativeCodexConfig.userLocation.city, 'New York');
      assert.equal(snapshot.webSearchNativeCodexConfig.userLocation.timezone, 'America/New_York');
      assert.match(snapshot.webSearchNativeCodexConfig.advancedConfig, /reasoningEffort/);
      assert.doesNotMatch(snapshot.webSearchNativeCodexConfig.advancedConfig, /New York/);
    } finally {
      configurePlatformBridge(originalBridge);
    }
  },
);

await runTest(
  'openClawConfigService writes native Codex web search settings under tools.web.search.openaiCodex without clobbering managed web_search settings',
  async () => {
    const { configurePlatformBridge, getPlatformBridge } = await import('@sdkwork/agentstudio-pc-infrastructure');
    const { openClawConfigService } = await import('./openClawConfigService.ts');

    const originalBridge = getPlatformBridge();
    let fileContent = `{
  tools: {
    web: {
      search: {
        enabled: true,
        provider: "searxng",
        maxResults: 10,
        timeoutSeconds: 45,
        cacheTtlMinutes: 20,
        openaiCodex: {
          enabled: false,
          mode: "off",
        },
      },
    },
  },
}`;

    configurePlatformBridge({
      platform: createPlatformBridgeStub({
        readFile: async () => fileContent,
        writeFile: async (_path, content) => {
          fileContent = content;
        },
      }),
    });

    try {
      const saved = await openClawConfigService.saveWebSearchNativeCodexConfiguration({
        configFile: 'D:/OpenClaw/.openclaw/openclaw.json',
        enabled: true,
        mode: 'cached',
        allowedDomains: ['example.com', 'openai.com'],
        contextSize: 'high',
        userLocation: {
          country: 'US',
          city: 'New York',
          timezone: 'America/New_York',
        },
        advancedConfig: `{
  "reasoningEffort": "medium"
}`,
      });
      const parsed = parseJson5<{
        tools?: {
          web?: {
            search?: {
              enabled?: boolean;
              provider?: string;
              maxResults?: number;
              timeoutSeconds?: number;
              cacheTtlMinutes?: number;
              openaiCodex?: {
                enabled?: boolean;
                mode?: string;
                allowedDomains?: string[];
                contextSize?: string;
                userLocation?: {
                  country?: string;
                  city?: string;
                  timezone?: string;
                };
                reasoningEffort?: string;
              };
            };
          };
        };
      }>(fileContent);

      assert.equal(parsed.tools?.web?.search?.enabled, true);
      assert.equal(parsed.tools?.web?.search?.provider, 'searxng');
      assert.equal(parsed.tools?.web?.search?.maxResults, 10);
      assert.equal(parsed.tools?.web?.search?.timeoutSeconds, 45);
      assert.equal(parsed.tools?.web?.search?.cacheTtlMinutes, 20);
      assert.equal(parsed.tools?.web?.search?.openaiCodex?.enabled, true);
      assert.equal(parsed.tools?.web?.search?.openaiCodex?.mode, 'cached');
      assert.deepEqual(parsed.tools?.web?.search?.openaiCodex?.allowedDomains, ['example.com', 'openai.com']);
      assert.equal(parsed.tools?.web?.search?.openaiCodex?.contextSize, 'high');
      assert.equal(parsed.tools?.web?.search?.openaiCodex?.userLocation?.country, 'US');
      assert.equal(parsed.tools?.web?.search?.openaiCodex?.userLocation?.city, 'New York');
      assert.equal(parsed.tools?.web?.search?.openaiCodex?.userLocation?.timezone, 'America/New_York');
      assert.equal(parsed.tools?.web?.search?.openaiCodex?.reasoningEffort, 'medium');
      assert.equal(saved.enabled, true);
      assert.equal(saved.mode, 'cached');
      assert.deepEqual(saved.allowedDomains, ['example.com', 'openai.com']);
      assert.equal(saved.contextSize, 'high');
      assert.match(saved.advancedConfig, /reasoningEffort/);
    } finally {
      configurePlatformBridge(originalBridge);
    }
  },
);

await runTest(
  'openClawConfigService reads auth cooldown settings from auth.cooldowns',
  async () => {
    const { configurePlatformBridge, getPlatformBridge } = await import('@sdkwork/agentstudio-pc-infrastructure');
    const { openClawConfigService } = await import('./openClawConfigService.ts');

    const originalBridge = getPlatformBridge();
    const fileContent = `{
  auth: {
    cooldowns: {
      rateLimitedProfileRotations: 2,
      overloadedProfileRotations: 1,
      overloadedBackoffMs: 45000,
      billingBackoffHours: 5,
      billingMaxHours: 24,
      failureWindowHours: 24,
    },
  },
}`;

    configurePlatformBridge({
      platform: createPlatformBridgeStub({
        readFile: async () => fileContent,
      }),
    });

    try {
      const snapshot = await openClawConfigService.readConfigSnapshot(
        'D:/OpenClaw/.openclaw/openclaw.json',
      );

      assert.equal(snapshot.authCooldownsConfig?.rateLimitedProfileRotations, 2);
      assert.equal(snapshot.authCooldownsConfig?.overloadedProfileRotations, 1);
      assert.equal(snapshot.authCooldownsConfig?.overloadedBackoffMs, 45000);
      assert.equal(snapshot.authCooldownsConfig?.billingBackoffHours, 5);
      assert.equal(snapshot.authCooldownsConfig?.billingMaxHours, 24);
      assert.equal(snapshot.authCooldownsConfig?.failureWindowHours, 24);
    } finally {
      configurePlatformBridge(originalBridge);
    }
  },
);

await runTest(
  'openClawConfigService writes managed auth cooldown settings without clobbering sibling auth config',
  async () => {
    const { configurePlatformBridge, getPlatformBridge } = await import('@sdkwork/agentstudio-pc-infrastructure');
    const { openClawConfigService } = await import('./openClawConfigService.ts');

    const originalBridge = getPlatformBridge();
    let fileContent = `{
  auth: {
    order: ["openai", "anthropic"],
    defaultProfile: "openai",
    cooldowns: {
      billingBackoffHoursByProvider: {
        openai: 3,
      },
      failureWindowHours: 12,
    },
  },
}`;

    configurePlatformBridge({
      platform: createPlatformBridgeStub({
        readFile: async () => fileContent,
        writeFile: async (_path, content) => {
          fileContent = content;
        },
      }),
    });

    try {
      const saved = await openClawConfigService.saveAuthCooldownsConfiguration({
        configFile: 'D:/OpenClaw/.openclaw/openclaw.json',
        rateLimitedProfileRotations: 2,
        overloadedProfileRotations: 1,
        overloadedBackoffMs: 45000,
        billingBackoffHours: 5,
        billingMaxHours: 24,
        failureWindowHours: 36,
      });
      const parsed = parseJson5<{
        auth?: {
          order?: string[];
          defaultProfile?: string;
          cooldowns?: {
            rateLimitedProfileRotations?: number;
            overloadedProfileRotations?: number;
            overloadedBackoffMs?: number;
            billingBackoffHours?: number;
            billingMaxHours?: number;
            failureWindowHours?: number;
            billingBackoffHoursByProvider?: {
              openai?: number;
            };
          };
        };
      }>(fileContent);

      assert.deepEqual(parsed.auth?.order, ['openai', 'anthropic']);
      assert.equal(parsed.auth?.defaultProfile, 'openai');
      assert.equal(parsed.auth?.cooldowns?.rateLimitedProfileRotations, 2);
      assert.equal(parsed.auth?.cooldowns?.overloadedProfileRotations, 1);
      assert.equal(parsed.auth?.cooldowns?.overloadedBackoffMs, 45000);
      assert.equal(parsed.auth?.cooldowns?.billingBackoffHours, 5);
      assert.equal(parsed.auth?.cooldowns?.billingMaxHours, 24);
      assert.equal(parsed.auth?.cooldowns?.failureWindowHours, 36);
      assert.equal(parsed.auth?.cooldowns?.billingBackoffHoursByProvider?.openai, 3);
      assert.equal(saved.rateLimitedProfileRotations, 2);
      assert.equal(saved.overloadedBackoffMs, 45000);
    } finally {
      configurePlatformBridge(originalBridge);
    }
  },
);

await runTest(
  'openClawConfigService reads managed dreaming settings from the memory-core plugin config',
  async () => {
    const { configurePlatformBridge, getPlatformBridge } = await import('@sdkwork/agentstudio-pc-infrastructure');
    const { openClawConfigService } = await import('./openClawConfigService.ts');

    const originalBridge = getPlatformBridge();
    const fileContent = `{
  plugins: {
    entries: {
      "memory-core": {
        config: {
          dreaming: {
            enabled: true,
            frequency: "0 3 * * *",
          },
          journal: {
            retentionDays: 30,
          },
        },
      },
    },
  },
}`;

    configurePlatformBridge({
      platform: createPlatformBridgeStub({
        readFile: async () => fileContent,
      }),
    });

    try {
      const snapshot = await openClawConfigService.readConfigSnapshot(
        'D:/OpenClaw/.openclaw/openclaw.json',
      );

      assert.equal(snapshot.dreamingConfig?.enabled, true);
      assert.equal(snapshot.dreamingConfig?.frequency, '0 3 * * *');
    } finally {
      configurePlatformBridge(originalBridge);
    }
  },
);

await runTest(
  'openClawConfigService writes managed dreaming settings without clobbering sibling memory-core config',
  async () => {
    const { configurePlatformBridge, getPlatformBridge } = await import('@sdkwork/agentstudio-pc-infrastructure');
    const { openClawConfigService } = await import('./openClawConfigService.ts');

    const originalBridge = getPlatformBridge();
    let fileContent = `{
  plugins: {
    entries: {
      "memory-core": {
        enabled: true,
        config: {
          journal: {
            retentionDays: 30,
          },
          dreaming: {
            enabled: false,
          },
        },
      },
    },
  },
}`;

    configurePlatformBridge({
      platform: createPlatformBridgeStub({
        readFile: async () => fileContent,
        writeFile: async (_path, content) => {
          fileContent = content;
        },
      }),
    });

    try {
      const saved = await openClawConfigService.saveDreamingConfiguration({
        configFile: 'D:/OpenClaw/.openclaw/openclaw.json',
        enabled: true,
        frequency: '0 3 * * *',
      });
      const parsed = parseJson5<{
        plugins?: {
          entries?: {
            'memory-core'?: {
              enabled?: boolean;
              config?: {
                dreaming?: {
                  enabled?: boolean;
                  frequency?: string;
                };
                journal?: {
                  retentionDays?: number;
                };
              };
            };
          };
        };
      }>(fileContent);

      assert.equal(parsed.plugins?.entries?.['memory-core']?.enabled, true);
      assert.equal(parsed.plugins?.entries?.['memory-core']?.config?.dreaming?.enabled, true);
      assert.equal(
        parsed.plugins?.entries?.['memory-core']?.config?.dreaming?.frequency,
        '0 3 * * *',
      );
      assert.equal(
        parsed.plugins?.entries?.['memory-core']?.config?.journal?.retentionDays,
        30,
      );
      assert.equal(saved.enabled, true);
      assert.equal(saved.frequency, '0 3 * * *');
    } finally {
      configurePlatformBridge(originalBridge);
    }
  },
);

await runTest('openClawConfigService canonicalizes managed local proxy projection as the only OpenClaw provider and default model source', async () => {
  const { configurePlatformBridge, getPlatformBridge } = await import('@sdkwork/agentstudio-pc-infrastructure');
  const { openClawConfigService } = await import('./openClawConfigService.ts');

  const originalBridge = getPlatformBridge();
  let fileContent = `{
  models: {
    providers: {
      "openai": {
        baseUrl: "https://router.example.com/v1",
        apiKey: "sk-router-live",
        models: [
          { id: "gpt-4.1", name: "GPT-4.1" },
        ],
      },
      "anthropic": {
        baseUrl: "https://api.anthropic.com/v1",
        apiKey: "sk-anthropic",
        models: [
          { id: "claude-sonnet-4-5", name: "Claude Sonnet 4.5" },
        ],
      },
    },
  },
  agents: {
    defaults: {
      model: {
        primary: "anthropic/claude-sonnet-4-5",
      },
    },
  },
}`;

  configurePlatformBridge({
    platform: createPlatformBridgeStub({
      readFile: async () => fileContent,
      writeFile: async (_path, content) => {
        fileContent = content;
      },
    }),
  });

  try {
    await openClawConfigService.saveManagedLocalProxyProjection({
      configFile: 'D:/OpenClaw/.openclaw/openclaw.json',
      projection: {
        provider: {
          id: 'sdkwork-local-proxy',
          channelId: 'openai-compatible',
          name: 'SDKWork Local Proxy',
          apiKey: '${SDKWORK_LOCAL_PROXY_TOKEN}',
          baseUrl: 'http://127.0.0.1:21280/v1',
          models: [
            { id: 'gpt-5.4', name: 'GPT-5.4' },
            { id: 'o4-mini', name: 'o4-mini' },
          ],
          notes: 'Managed local proxy provider',
        },
        selection: {
          defaultModelId: 'gpt-5.4',
          reasoningModelId: 'o4-mini',
        },
      },
    });

    let snapshot = await openClawConfigService.readConfigSnapshot(
      'D:/OpenClaw/.openclaw/openclaw.json',
    );
    let managedProvider = snapshot.providerSnapshots.find(
      (provider) => provider.id === 'sdkwork-local-proxy',
    );

    assert.ok(managedProvider);
    assert.equal(managedProvider?.endpoint, 'http://127.0.0.1:21280/v1');
    assert.deepEqual(
      snapshot.providerSnapshots.map((provider) => provider.id),
      ['sdkwork-local-proxy'],
    );
    assert.equal(
      (snapshot.root.agents as Record<string, any>).defaults.model.primary,
      'sdkwork-local-proxy/gpt-5.4',
    );

    await openClawConfigService.saveProviderSelection({
      configFile: 'D:/OpenClaw/.openclaw/openclaw.json',
      provider: {
        id: 'sdkwork-local-proxy',
        channelId: 'openai-compatible',
        name: 'SDKWork Local Proxy',
        apiKey: '${SDKWORK_LOCAL_PROXY_TOKEN}',
        baseUrl: 'http://127.0.0.1:21280/v1',
        models: [
          { id: 'gpt-5.4', name: 'GPT-5.4' },
          { id: 'o4-mini', name: 'o4-mini' },
        ],
        notes: 'Managed local proxy provider',
      },
      selection: {
        defaultModelId: 'gpt-5.4',
        reasoningModelId: 'o4-mini',
      },
    });

    await openClawConfigService.saveManagedLocalProxyProjection({
      configFile: 'D:/OpenClaw/.openclaw/openclaw.json',
      projection: {
        provider: {
          id: 'sdkwork-local-proxy',
          channelId: 'openai-compatible',
          name: 'SDKWork Local Proxy',
          apiKey: '${SDKWORK_LOCAL_PROXY_TOKEN}',
          baseUrl: 'http://127.0.0.1:21280/v1',
          models: [
            { id: 'gpt-5.4-mini', name: 'GPT-5.4 mini' },
            { id: 'o4-mini', name: 'o4-mini' },
          ],
          notes: 'Managed local proxy provider',
        },
        selection: {
          defaultModelId: 'gpt-5.4-mini',
          reasoningModelId: 'o4-mini',
        },
      },
    });

    snapshot = await openClawConfigService.readConfigSnapshot('D:/OpenClaw/.openclaw/openclaw.json');
    managedProvider = snapshot.providerSnapshots.find((provider) => provider.id === 'sdkwork-local-proxy');

    assert.equal(managedProvider?.defaultModelId, 'gpt-5.4-mini');
    assert.equal(
      (snapshot.root.agents as Record<string, any>).defaults.model.primary,
      'sdkwork-local-proxy/gpt-5.4-mini',
    );
    assert.equal(fileContent.includes('sdkwork-local-proxy'), true);
  } finally {
    configurePlatformBridge(originalBridge);
  }
});

await runTest('openClawConfigService writes protocol-aware managed local proxy provider adapters for native routes', async () => {
  const { configurePlatformBridge, getPlatformBridge } = await import('@sdkwork/agentstudio-pc-infrastructure');
  const { openClawConfigService } = await import('./openClawConfigService.ts');

  const originalBridge = getPlatformBridge();
  let fileContent = `{
  models: {
    providers: {},
  },
  agents: {
    defaults: {
      model: {},
    },
  },
}`;

  configurePlatformBridge({
    platform: createPlatformBridgeStub({
      readFile: async () => fileContent,
      writeFile: async (_path, content) => {
        fileContent = content;
      },
    }),
  });

  try {
    await openClawConfigService.saveManagedLocalProxyProjection({
      configFile: 'D:/OpenClaw/.openclaw/openclaw.json',
      projection: {
        provider: {
          id: 'sdkwork-local-proxy',
          channelId: 'anthropic',
          name: 'SDKWork Local Proxy',
          apiKey: 'sk_sdkwork_api_key',
          baseUrl: 'http://127.0.0.1:21280/v1',
          models: [
            { id: 'claude-sonnet-4-20250514', name: 'Claude Sonnet 4' },
            { id: 'claude-opus-4-20250514', name: 'Claude Opus 4' },
          ],
          notes: 'Managed local proxy provider',
        },
        selection: {
          defaultModelId: 'claude-sonnet-4-20250514',
          reasoningModelId: 'claude-opus-4-20250514',
        },
      },
    });

    let snapshot = await openClawConfigService.readConfigSnapshot(
      'D:/OpenClaw/.openclaw/openclaw.json',
    );
    assert.equal(
      ((snapshot.root.models as Record<string, any>).providers['sdkwork-local-proxy'] as Record<string, any>).api,
      'anthropic-messages',
    );
    assert.equal(
      ((snapshot.root.models as Record<string, any>).providers['sdkwork-local-proxy'] as Record<string, any>).auth,
      'api-key',
    );

    await openClawConfigService.saveManagedLocalProxyProjection({
      configFile: 'D:/OpenClaw/.openclaw/openclaw.json',
      projection: {
        provider: {
          id: 'sdkwork-local-proxy',
          channelId: 'gemini',
          name: 'SDKWork Local Proxy',
          apiKey: 'sk_sdkwork_api_key',
          baseUrl: 'http://127.0.0.1:21280',
          models: [
            { id: 'gemini-2.5-pro', name: 'Gemini 2.5 Pro' },
            { id: 'text-embedding-004', name: 'text-embedding-004' },
          ],
          notes: 'Managed local proxy provider',
        },
        selection: {
          defaultModelId: 'gemini-2.5-pro',
          embeddingModelId: 'text-embedding-004',
        },
      },
    });

    snapshot = await openClawConfigService.readConfigSnapshot('D:/OpenClaw/.openclaw/openclaw.json');
    assert.equal(
      ((snapshot.root.models as Record<string, any>).providers['sdkwork-local-proxy'] as Record<string, any>).api,
      'google-generative-ai',
    );
    assert.equal(
      ((snapshot.root.models as Record<string, any>).providers['sdkwork-local-proxy'] as Record<string, any>).baseUrl,
      'http://127.0.0.1:21280',
    );
  } finally {
    configurePlatformBridge(originalBridge);
  }
});

await runTest('openClawConfigService saves direct native ollama providers with the official ollama adapter', async () => {
  const { configurePlatformBridge, getPlatformBridge } = await import('@sdkwork/agentstudio-pc-infrastructure');
  const { openClawConfigService } = await import('./openClawConfigService.ts');

  const originalBridge = getPlatformBridge();
  let fileContent = `{
  models: {
    providers: {},
  },
  agents: {
    defaults: {
      model: {},
    },
  },
}`;

  configurePlatformBridge({
    platform: createPlatformBridgeStub({
      readFile: async () => fileContent,
      writeFile: async (_path, content) => {
        fileContent = content;
      },
    }),
  });

  try {
    await openClawConfigService.saveProviderSelection({
      configFile: 'D:/OpenClaw/.openclaw/openclaw.json',
      provider: {
        id: 'ollama',
        channelId: 'ollama',
        name: 'Ollama',
        apiKey: 'ollama-local',
        baseUrl: 'http://127.0.0.1:11434',
        models: [
          { id: 'glm-4.7-flash', name: 'GLM 4.7 Flash' },
          { id: 'nomic-embed-text', name: 'nomic-embed-text' },
        ],
      },
      selection: {
        defaultModelId: 'glm-4.7-flash',
        embeddingModelId: 'nomic-embed-text',
      },
    });

    const snapshot = await openClawConfigService.readConfigSnapshot(
      'D:/OpenClaw/.openclaw/openclaw.json',
    );
    const provider = ((snapshot.root.models as Record<string, any>).providers[
      'ollama'
    ] as Record<string, any>);

    assert.equal(provider.api, 'ollama');
    assert.equal(provider.auth, 'api-key');
    assert.equal(provider.baseUrl, 'http://127.0.0.1:11434');
    assert.equal(snapshot.providerSnapshots.find((entry) => entry.id === 'ollama')?.defaultModelId, 'glm-4.7-flash');
  } finally {
    configurePlatformBridge(originalBridge);
  }
});

await runTest('openClawConfigService preserves already-qualified OpenRouter model refs when saving provider selections', async () => {
  const { configurePlatformBridge, getPlatformBridge } = await import('@sdkwork/agentstudio-pc-infrastructure');
  const { openClawConfigService } = await import('./openClawConfigService.ts');

  const originalBridge = getPlatformBridge();
  let fileContent = `{
  agents: {
    defaults: {
      model: {},
    },
  },
}`;

  configurePlatformBridge({
    platform: createPlatformBridgeStub({
      readFile: async () => fileContent,
      writeFile: async (_path, content) => {
        fileContent = content;
      },
    }),
  });

  try {
    await openClawConfigService.saveProviderSelection({
      configFile: 'D:/OpenClaw/.openclaw/openclaw.json',
      provider: {
        id: 'openrouter',
        channelId: 'openrouter',
        name: 'OpenRouter',
        apiKey: '${OPENROUTER_API_KEY}',
        baseUrl: 'https://openrouter.ai/api/v1',
        models: [
          {
            id: 'openrouter/meta-llama/llama-3.1-8b-instruct',
            name: 'Llama 3.1 8B Instruct',
          },
          {
            id: 'anthropic/claude-3.7-sonnet',
            name: 'Claude 3.7 Sonnet',
          },
        ],
      },
      selection: {
        defaultModelId: 'openrouter/meta-llama/llama-3.1-8b-instruct',
        reasoningModelId: 'anthropic/claude-3.7-sonnet',
      },
    });

    const snapshot = await openClawConfigService.readConfigSnapshot(
      'D:/OpenClaw/.openclaw/openclaw.json',
    );
    const defaultsModel = ((snapshot.root.agents as Record<string, any>).defaults as Record<string, any>)
      .model as Record<string, any>;
    const defaultsCatalog = (((snapshot.root.agents as Record<string, any>).defaults as Record<string, any>)
      .models ?? {}) as Record<string, unknown>;

    assert.equal(defaultsModel.primary, 'openrouter/meta-llama/llama-3.1-8b-instruct');
    assert.deepEqual(defaultsModel.fallbacks, ['anthropic/claude-3.7-sonnet']);
    assert.equal(
      Object.hasOwn(defaultsCatalog, 'openrouter/meta-llama/llama-3.1-8b-instruct'),
      true,
    );
    assert.equal(
      Object.hasOwn(defaultsCatalog, 'anthropic/claude-3.7-sonnet'),
      true,
    );
    assert.equal(
      Object.hasOwn(
        defaultsCatalog,
        'openrouter/openrouter/meta-llama/llama-3.1-8b-instruct',
      ),
      false,
    );
    assert.equal(
      Object.hasOwn(defaultsCatalog, 'openrouter/anthropic/claude-3.7-sonnet'),
      false,
    );
  } finally {
    configurePlatformBridge(originalBridge);
  }
});

await runTest('openClawConfigService strips legacy provider runtime keys when saving managed local proxy projection', async () => {
  const { configurePlatformBridge, getPlatformBridge } = await import('@sdkwork/agentstudio-pc-infrastructure');
  const { openClawConfigService } = await import('./openClawConfigService.ts');

  const originalBridge = getPlatformBridge();
  let fileContent = `{
  models: {
    providers: {
      "sdkwork-local-proxy": {
        baseUrl: "http://127.0.0.1:21280/v1",
        apiKey: "sk_sdkwork_api_key",
        temperature: 0.35,
        topP: 0.9,
        maxTokens: 24000,
        timeoutMs: 90000,
        streaming: false,
        models: [
          { id: "gpt-5.4", name: "GPT-5.4" },
        ],
      },
    },
  },
  agents: {
    defaults: {
      model: {
        primary: "sdkwork-local-proxy/gpt-5.4",
      },
    },
  },
}`;

  configurePlatformBridge({
    platform: createPlatformBridgeStub({
      readFile: async () => fileContent,
      writeFile: async (_path, content) => {
        fileContent = content;
      },
    }),
  });

  try {
    await openClawConfigService.saveManagedLocalProxyProjection({
      configFile: 'D:/OpenClaw/.openclaw/openclaw.json',
      projection: {
        provider: {
          id: 'sdkwork-local-proxy',
          channelId: 'openai-compatible',
          name: 'SDKWork Local Proxy',
          apiKey: 'sk_sdkwork_api_key',
          baseUrl: 'http://127.0.0.1:21280/v1',
          models: [
            { id: 'gpt-5.4', name: 'GPT-5.4' },
            { id: 'o4-mini', name: 'o4-mini' },
          ],
          notes: 'Managed local proxy provider',
          config: {
            temperature: 0.35,
            topP: 0.9,
            maxTokens: 24000,
            timeoutMs: 90000,
            streaming: false,
          },
        },
        selection: {
          defaultModelId: 'gpt-5.4',
          reasoningModelId: 'o4-mini',
        },
      },
    });

    const snapshot = await openClawConfigService.readConfigSnapshot(
      'D:/OpenClaw/.openclaw/openclaw.json',
    );
    const provider = ((snapshot.root.models as Record<string, any>).providers[
      'sdkwork-local-proxy'
    ] as Record<string, any>);

    assert.equal('temperature' in provider, false);
    assert.equal('topP' in provider, false);
    assert.equal('maxTokens' in provider, false);
    assert.equal('timeoutMs' in provider, false);
    assert.equal('streaming' in provider, false);

    const defaultsModels = ((((snapshot.root.agents as Record<string, any>).defaults ||
      {}) as Record<string, any>).models || {}) as Record<string, any>;
    assert.deepEqual(defaultsModels['sdkwork-local-proxy/gpt-5.4']?.params, {
      temperature: 0.35,
      topP: 0.9,
      maxTokens: 24000,
      timeoutMs: 90000,
      streaming: false,
    });

    const managedProvider = snapshot.providerSnapshots.find(
      (entry) => entry.id === 'sdkwork-local-proxy',
    );
    assert.deepEqual(managedProvider?.config, {
      temperature: 0.35,
      topP: 0.9,
      maxTokens: 24000,
      timeoutMs: 90000,
      streaming: false,
    });
  } finally {
    configurePlatformBridge(originalBridge);
  }
});
await runTest('openClawConfigService normalizes managed local proxy projection model catalogs and selections before writing config', async () => {
  const { configurePlatformBridge, getPlatformBridge } = await import('@sdkwork/agentstudio-pc-infrastructure');
  const { openClawConfigService } = await import('./openClawConfigService.ts');

  const originalBridge = getPlatformBridge();
  let fileContent = `{
  models: {
    providers: {},
  },
  agents: {
    defaults: {
      model: {},
    },
  },
}`;

  configurePlatformBridge({
    platform: createPlatformBridgeStub({
      readFile: async () => fileContent,
      writeFile: async (_path, content) => {
        fileContent = content;
      },
    }),
  });

  try {
    await openClawConfigService.saveManagedLocalProxyProjection({
      configFile: 'D:/OpenClaw/.openclaw/openclaw.json',
      projection: {
        provider: {
          id: 'sdkwork-local-proxy',
          channelId: 'openai-compatible',
          name: 'SDKWork Local Proxy',
          apiKey: 'sk_sdkwork_api_key',
          baseUrl: 'http://127.0.0.1:21280/v1',
          models: [
            { id: ' text-embedding-3-large ', name: 'text-embedding-3-large' },
            { id: ' gpt-5.4 ', name: ' GPT-5.4 ' },
            { id: 'o4-mini', name: ' o4-mini ' },
            { id: 'gpt-5.4', name: 'Duplicate GPT-5.4' },
          ],
          notes: 'Managed local proxy provider',
        },
        selection: {
          defaultModelId: ' gpt-5.4 ',
          reasoningModelId: ' o4-mini ',
          embeddingModelId: ' text-embedding-3-large ',
        },
      },
    });

    const snapshot = await openClawConfigService.readConfigSnapshot(
      'D:/OpenClaw/.openclaw/openclaw.json',
    );
    const managedProvider = snapshot.providerSnapshots.find(
      (entry) => entry.id === 'sdkwork-local-proxy',
    );
    const providerRoot = ((snapshot.root.models as Record<string, any>).providers[
      'sdkwork-local-proxy'
    ] as Record<string, any>);

    assert.equal(managedProvider?.defaultModelId, 'gpt-5.4');
    assert.equal(managedProvider?.reasoningModelId, 'o4-mini');
    assert.equal(managedProvider?.embeddingModelId, 'text-embedding-3-large');
    assert.deepEqual(
      managedProvider?.models.map((model) => model.id),
      ['gpt-5.4', 'o4-mini', 'text-embedding-3-large'],
    );
    assert.equal(
      (snapshot.root.agents as Record<string, any>).defaults.model.primary,
      'sdkwork-local-proxy/gpt-5.4',
    );
    assert.deepEqual(
      (snapshot.root.agents as Record<string, any>).defaults.model.fallbacks,
      ['sdkwork-local-proxy/o4-mini'],
    );
    assert.deepEqual(
      (providerRoot.models as Array<Record<string, unknown>>).map((model) => model.id),
      ['gpt-5.4', 'o4-mini', 'text-embedding-3-large'],
    );
    assert.deepEqual(
      (providerRoot.models as Array<Record<string, unknown>>).map((model) => ({
        id: model.id,
        reasoning: model.reasoning,
        api: model.api,
        contextWindow: model.contextWindow,
        maxTokens: model.maxTokens,
      })),
      [
        {
          id: 'gpt-5.4',
          reasoning: false,
          api: undefined,
          contextWindow: 128000,
          maxTokens: 32000,
        },
        {
          id: 'o4-mini',
          reasoning: true,
          api: undefined,
          contextWindow: 200000,
          maxTokens: 32000,
        },
        {
          id: 'text-embedding-3-large',
          reasoning: false,
          api: 'embedding',
          contextWindow: 8192,
          maxTokens: 8192,
        },
      ],
    );
  } finally {
    configurePlatformBridge(originalBridge);
  }
});
await runTest('openClawConfigService normalizes dirty provider model catalogs when reading config snapshots', async () => {
  const { configurePlatformBridge, getPlatformBridge } = await import('@sdkwork/agentstudio-pc-infrastructure');
  const { openClawConfigService } = await import('./openClawConfigService.ts');

  const originalBridge = getPlatformBridge();
  const fileContent = `{
  models: {
    providers: {
      "sdkwork-local-proxy": {
        baseUrl: "http://127.0.0.1:21280/v1",
        apiKey: "sk_sdkwork_api_key",
        models: [
          { id: " text-embedding-3-large ", name: " text-embedding-3-large " },
          { id: " gpt-5.4 ", name: " GPT-5.4 " },
          { id: "o4-mini", name: " o4-mini " },
          { id: "gpt-5.4", name: "Duplicate GPT-5.4" },
        ],
      },
    },
  },
  agents: {
    defaults: {
      model: {
        primary: "sdkwork-local-proxy/gpt-5.4",
        fallbacks: ["sdkwork-local-proxy/o4-mini"],
      },
    },
  },
}`;

  configurePlatformBridge({
    platform: createPlatformBridgeStub({
      readFile: async () => fileContent,
    }),
  });

  try {
    const snapshot = await openClawConfigService.readConfigSnapshot(
      'D:/OpenClaw/.openclaw/openclaw.json',
    );
    const managedProvider = snapshot.providerSnapshots.find(
      (entry) => entry.id === 'sdkwork-local-proxy',
    );

    assert.equal(managedProvider?.defaultModelId, 'gpt-5.4');
    assert.equal(managedProvider?.reasoningModelId, 'o4-mini');
    assert.equal(managedProvider?.embeddingModelId, 'text-embedding-3-large');
    assert.deepEqual(
      managedProvider?.models.map((model) => ({
        id: model.id,
        name: model.name,
        role: model.role,
      })),
      [
        { id: 'gpt-5.4', name: 'GPT-5.4', role: 'primary' },
        { id: 'o4-mini', name: 'o4-mini', role: 'reasoning' },
        { id: 'text-embedding-3-large', name: 'text-embedding-3-large', role: 'embedding' },
      ],
    );
  } finally {
    configurePlatformBridge(originalBridge);
  }
});

await runTest('openClawConfigService persists explicit embedding role metadata for managed local proxy projections', async () => {
  const { configurePlatformBridge, getPlatformBridge } = await import('@sdkwork/agentstudio-pc-infrastructure');
  const { openClawConfigService } = await import('./openClawConfigService.ts');

  const originalBridge = getPlatformBridge();
  let fileContent = `{
  models: {
    providers: {},
  },
  agents: {
    defaults: {
      model: {},
      models: {},
    },
  },
}`;

  configurePlatformBridge({
    platform: createPlatformBridgeStub({
      readFile: async () => fileContent,
      writeFile: async (_path, content) => {
        fileContent = content;
      },
    }),
  });

  try {
    await openClawConfigService.saveManagedLocalProxyProjection({
      configFile: 'D:/OpenClaw/.openclaw/openclaw.json',
      projection: {
        provider: {
          id: 'sdkwork-local-proxy',
          channelId: 'openai-compatible',
          name: 'SDKWork Local Proxy',
          apiKey: 'sk_sdkwork_api_key',
          baseUrl: 'http://127.0.0.1:21280/v1',
          models: [
            { id: 'gpt-5.4', name: 'GPT-5.4' },
            { id: 'o4-mini', name: 'o4-mini' },
            { id: 'atlas-index', name: 'Atlas Index' },
          ],
          notes: 'Managed local proxy provider',
        },
        selection: {
          defaultModelId: 'gpt-5.4',
          reasoningModelId: 'o4-mini',
          embeddingModelId: 'atlas-index',
        },
      },
    });

    const snapshot = await openClawConfigService.readConfigSnapshot(
      'D:/OpenClaw/.openclaw/openclaw.json',
    );
    const managedProvider = snapshot.providerSnapshots.find(
      (entry) => entry.id === 'sdkwork-local-proxy',
    );
    const providerRoot = ((snapshot.root.models as Record<string, any>).providers[
      'sdkwork-local-proxy'
    ] as Record<string, any>);
    const defaultsModels = ((((snapshot.root.agents as Record<string, any>).defaults ||
      {}) as Record<string, any>).models || {}) as Record<string, any>;

    assert.equal(managedProvider?.embeddingModelId, 'atlas-index');
    assert.equal(
      managedProvider?.models.find((model) => model.id === 'atlas-index')?.role,
      'embedding',
    );
    assert.equal(
      (providerRoot.models as Array<Record<string, unknown>>).find(
        (model) => model.id === 'atlas-index',
      )?.api,
      'embedding',
    );
    assert.equal(defaultsModels['sdkwork-local-proxy/atlas-index']?.streaming, false);
  } finally {
    configurePlatformBridge(originalBridge);
  }
});

await runTest('openClawConfigService reads provider runtime config from canonical defaults model params instead of provider-root legacy fields', async () => {
  const { configurePlatformBridge, getPlatformBridge } = await import('@sdkwork/agentstudio-pc-infrastructure');
  const { openClawConfigService } = await import('./openClawConfigService.ts');

  const originalBridge = getPlatformBridge();
  const fileContent = `{
  models: {
    providers: {
      openai: {
        baseUrl: "https://api.openai.com/v1",
        apiKey: "\${OPENAI_API_KEY}",
        temperature: 0.05,
        topP: 0.1,
        maxTokens: 256,
        timeoutMs: 1000,
        streaming: false,
        models: [
          { id: "gpt-5.4", name: "GPT-5.4" },
          { id: "o4-mini", name: "o4-mini", reasoning: true },
          { id: "text-embedding-3-large", name: "text-embedding-3-large", api: "embedding" },
        ],
      },
    },
  },
  agents: {
    defaults: {
      model: {
        primary: "openai/gpt-5.4",
        fallbacks: ["openai/o4-mini"],
      },
      models: {
        "openai/gpt-5.4": {
          alias: "GPT-5.4",
          params: {
            temperature: 0.45,
            topP: 0.92,
            maxTokens: 16000,
            timeoutMs: 180000,
            streaming: true,
          },
        },
      },
    },
  },
}`;

  configurePlatformBridge({
    platform: createPlatformBridgeStub({
      readFile: async () => fileContent,
    }),
  });

  try {
    const snapshot = await openClawConfigService.readConfigSnapshot(
      'D:/OpenClaw/.openclaw/openclaw.json',
    );
    const provider = snapshot.providerSnapshots.find((entry) => entry.id === 'openai');

    assert.deepEqual(provider?.config, {
      temperature: 0.45,
      topP: 0.92,
      maxTokens: 16000,
      timeoutMs: 180000,
      streaming: true,
    });
  } finally {
    configurePlatformBridge(originalBridge);
  }
});

await runTest(
  'openClawConfigService does not expose instance-detail config attachment resolution because kernel attachment is standardized separately',
  async () => {
    const { openClawConfigService } = await import('./openClawConfigService.ts');

    assert.equal('resolveInstanceConfigFile' in openClawConfigService, false);
  },
);

await runTest('openClawConfigService reads legacy api-router-prefixed providers and migrates them to native provider ids on save', async () => {
  const { configurePlatformBridge, getPlatformBridge } = await import('@sdkwork/agentstudio-pc-infrastructure');
  const { openClawConfigService } = await import('./openClawConfigService.ts');

  const originalBridge = getPlatformBridge();
  let fileContent = `{
  models: {
    providers: {
      "api-router-openai": {
        baseUrl: "https://router.example.com/v1",
        apiKey: "sk-router-live",
        models: [
          { id: "gpt-4.1", name: "GPT-4.1" },
          { id: "text-embedding-3-small", name: "text-embedding-3-small", api: "embedding" },
        ],
      },
    },
  },
  agents: {
    defaults: {
      model: {
        primary: "api-router-openai/gpt-4.1",
      },
    },
    list: [
      {
        id: "main",
        default: true,
        model: {
          primary: "api-router-openai/gpt-4.1",
        },
      },
    ],
  },
}`;

  configurePlatformBridge({
    platform: createPlatformBridgeStub({
      readFile: async () => fileContent,
      writeFile: async (_path, content) => {
        fileContent = content;
      },
    }),
  });

  try {
    let snapshot = await openClawConfigService.readConfigSnapshot(
      'D:/OpenClaw/.openclaw/openclaw.json',
    );
    assert.equal(snapshot.providerSnapshots[0]?.id, 'openai');
    assert.equal(snapshot.agentSnapshots[0]?.model.primary, 'openai/gpt-4.1');

    await openClawConfigService.saveAgent({
      configFile: 'D:/OpenClaw/.openclaw/openclaw.json',
      agent: {
        id: 'main',
        model: {
          primary: 'openai/gpt-4.1',
          fallbacks: [],
        },
      },
    });

    snapshot = await openClawConfigService.readConfigSnapshot(
      'D:/OpenClaw/.openclaw/openclaw.json',
    );
    assert.equal(snapshot.providerSnapshots[0]?.id, 'openai');
    assert.equal(snapshot.agentSnapshots[0]?.model.primary, 'openai/gpt-4.1');
    assert.equal(fileContent.includes('api-router-openai'), false);
    assert.match(fileContent, /openai/);
  } finally {
    configurePlatformBridge(originalBridge);
  }
});

await runTest('openClawConfigService manages agent CRUD with standard per-agent workspace, agentDir, and model rules', async () => {
  const { configurePlatformBridge, getPlatformBridge } = await import('@sdkwork/agentstudio-pc-infrastructure');
  const { openClawConfigService } = await import('./openClawConfigService.ts');

  const originalBridge = getPlatformBridge();
  let fileContent = `{
  models: {
    providers: {
      "openai": {
        baseUrl: "https://router.example.com/v1",
        apiKey: "sk-router-live",
        models: [
          { id: "gpt-4.1", name: "GPT-4.1" },
          { id: "o4-mini", name: "o4-mini", reasoning: true },
        ],
      },
    },
  },
  agents: {
    defaults: {
      workspace: "D:/OpenClaw/workspace",
      model: {
        primary: "openai/gpt-4.1",
        fallbacks: ["openai/o4-mini"],
      },
    },
    list: [
      {
        id: "main",
        default: true,
        name: "Main",
        identity: {
          emoji: "馃",
        },
      },
    ],
  },
}`;

  configurePlatformBridge({
    platform: createPlatformBridgeStub({
      readFile: async () => fileContent,
      writeFile: async (_path, content) => {
        fileContent = content;
      },
    }),
  });

  try {
    await openClawConfigService.saveAgent({
      configFile: 'D:/OpenClaw/.openclaw/openclaw.json',
      agent: {
        id: 'research',
        name: 'Research',
        avatar: '馃敩',
        model: {
          primary: 'openai/o4-mini',
          fallbacks: ['openai/gpt-4.1'],
        },
        params: {
          temperature: 0.4,
          maxTokens: 24000,
        },
      },
    });

    let snapshot = await openClawConfigService.readConfigSnapshot(
      'D:/OpenClaw/.openclaw/openclaw.json',
    );
    let research = snapshot.agentSnapshots.find((agent) => agent.id === 'research');
    let main = snapshot.agentSnapshots.find((agent) => agent.id === 'main');

    assert.equal(research?.name, 'Research');
    assert.equal(research?.avatar, '馃敩');
    assert.equal(research?.isDefault, false);
    assert.equal(research?.workspace, 'D:/OpenClaw/.openclaw/workspace-research');
    assert.equal(research?.agentDir, 'D:/OpenClaw/.openclaw/agents/research/agent');
    assert.equal(research?.model.primary, 'openai/o4-mini');
    assert.deepEqual(research?.model.fallbacks, ['openai/gpt-4.1']);
    assert.equal(research?.params.temperature, 0.4);
    assert.equal(research?.params.maxTokens, 24000);
    assert.equal(main?.isDefault, true);

    await openClawConfigService.saveAgent({
      configFile: 'D:/OpenClaw/.openclaw/openclaw.json',
      agent: {
        id: 'research',
        name: 'Research Ops',
        avatar: '馃',
        workspace: './workspace-research-ops',
        agentDir: './agents/research-home/agent',
        isDefault: true,
        model: {
          primary: 'openai/gpt-4.1',
          fallbacks: ['openai/o4-mini'],
        },
      },
    });

    snapshot = await openClawConfigService.readConfigSnapshot('D:/OpenClaw/.openclaw/openclaw.json');
    research = snapshot.agentSnapshots.find((agent) => agent.id === 'research');
    main = snapshot.agentSnapshots.find((agent) => agent.id === 'main');

    assert.equal(research?.name, 'Research Ops');
    assert.equal(research?.avatar, '馃');
    assert.equal(research?.isDefault, true);
    assert.equal(research?.workspace, 'D:/OpenClaw/.openclaw/workspace-research');
    assert.equal(research?.agentDir, 'D:/OpenClaw/.openclaw/agents/research/agent');
    assert.equal(main?.isDefault, false);

    await openClawConfigService.deleteAgent({
      configFile: 'D:/OpenClaw/.openclaw/openclaw.json',
      agentId: 'research',
    });

    snapshot = await openClawConfigService.readConfigSnapshot('D:/OpenClaw/.openclaw/openclaw.json');

    assert.equal(snapshot.agentSnapshots.some((agent) => agent.id === 'research'), false);
    assert.equal(snapshot.agentSnapshots[0]?.id, 'main');
    assert.equal(snapshot.agentSnapshots[0]?.isDefault, true);
    assert.match(fileContent, /default:\s*true/);
    assert.doesNotMatch(fileContent, /workspace:\s*['"]D:\/OpenClaw\/workspace['"]/);
  } finally {
    configurePlatformBridge(originalBridge);
  }
});

await runTest(
  'openClawConfigService merges agents.defaults.params into effective agent params while tracking param sources',
  async () => {
    const { configurePlatformBridge, getPlatformBridge } = await import('@sdkwork/agentstudio-pc-infrastructure');
    const { openClawConfigService } = await import('./openClawConfigService.ts');

    const originalBridge = getPlatformBridge();
    const fileContent = `{
  agents: {
    defaults: {
      workspace: "workspace",
      params: {
        temperature: 0.25,
        streaming: false,
        timeoutMs: 90000,
      },
    },
    list: [
      {
        id: "main",
        default: true,
        name: "Main",
        params: {
          temperature: 0.4,
        },
      },
      {
        id: "research",
        name: "Research",
      },
    ],
  },
}`;

    configurePlatformBridge({
      platform: createPlatformBridgeStub({
        readFile: async () => fileContent,
      }),
    });

    try {
      const snapshot = await openClawConfigService.readConfigSnapshot(
        'D:/OpenClaw/.openclaw/openclaw.json',
      );
      const main = snapshot.agentSnapshots.find((agent) => agent.id === 'main');
      const research = snapshot.agentSnapshots.find((agent) => agent.id === 'research');

      assert.deepEqual(main?.params, {
        temperature: 0.4,
        streaming: false,
        timeoutMs: 90000,
      });
      assert.deepEqual(main?.paramSources, {
        temperature: 'agent',
        streaming: 'defaults',
        timeoutMs: 'defaults',
      });
      assert.deepEqual(research?.params, {
        temperature: 0.25,
        streaming: false,
        timeoutMs: 90000,
      });
      assert.deepEqual(research?.paramSources, {
        temperature: 'defaults',
        streaming: 'defaults',
        timeoutMs: 'defaults',
      });
    } finally {
      configurePlatformBridge(originalBridge);
    }
  },
);

await runTest('openClawConfigService updates provider-model references and prunes removed providers without leaving stale defaults behind', async () => {
  const { configurePlatformBridge, getPlatformBridge } = await import('@sdkwork/agentstudio-pc-infrastructure');
  const { openClawConfigService } = await import('./openClawConfigService.ts');

  const originalBridge = getPlatformBridge();
  let fileContent = `{
  models: {
    providers: {
      "openai": {
        baseUrl: "https://router.example.com/v1",
        apiKey: "sk-router-live",
        models: [
          { id: "gpt-4.1", name: "GPT-4.1" },
          { id: "o4-mini", name: "o4-mini", reasoning: true },
        ],
      },
      "anthropic": {
        baseUrl: "https://anthropic.example.com/v1",
        apiKey: "sk-ant-live",
        models: [
          { id: "claude-sonnet-4-5", name: "Claude Sonnet 4.5" },
        ],
      },
    },
  },
  agents: {
    defaults: {
      model: {
        primary: "openai/gpt-4.1",
        fallbacks: [
          "openai/o4-mini",
          "anthropic/claude-sonnet-4-5",
        ],
      },
      models: {
        "openai/gpt-4.1": {
          alias: "GPT-4.1",
          streaming: true,
          params: {
            transport: "sse",
          },
        },
        "openai/o4-mini": {
          alias: "o4-mini",
          streaming: true,
        },
        "anthropic/claude-sonnet-4-5": {
          alias: "Claude Sonnet 4.5",
          streaming: true,
        },
      },
    },
    list: [
      {
        id: "main",
        default: true,
        name: "Main",
        model: {
          primary: "openai/o4-mini",
          fallbacks: ["anthropic/claude-sonnet-4-5"],
        },
      },
    ],
  },
}`;

  configurePlatformBridge({
    platform: createPlatformBridgeStub({
      readFile: async () => fileContent,
      writeFile: async (_path, content) => {
        fileContent = content;
      },
    }),
  });

  try {
    await openClawConfigService.createProviderModel({
      configFile: 'D:/OpenClaw/.openclaw/openclaw.json',
      providerId: 'openai',
      model: {
        id: 'text-embedding-3-small',
        name: 'text-embedding-3-small',
      },
    });

    let snapshot = await openClawConfigService.readConfigSnapshot(
      'D:/OpenClaw/.openclaw/openclaw.json',
    );
    let openai = snapshot.providerSnapshots.find((provider) => provider.id === 'openai');
    assert.equal(
      openai?.models.some((model) => model.id === 'text-embedding-3-small'),
      true,
    );
    assert.equal(
      snapshot.root.agents &&
        typeof snapshot.root.agents === 'object' &&
        !Array.isArray(snapshot.root.agents) &&
        (snapshot.root.agents as Record<string, any>).defaults.models['openai/text-embedding-3-small']
          .alias,
      'text-embedding-3-small',
    );

    await openClawConfigService.updateProviderModel({
      configFile: 'D:/OpenClaw/.openclaw/openclaw.json',
      providerId: 'openai',
      modelId: 'o4-mini',
      model: {
        id: 'o4-mini-high',
        name: 'o4-mini-high',
      },
    });

    snapshot = await openClawConfigService.readConfigSnapshot('D:/OpenClaw/.openclaw/openclaw.json');
    openai = snapshot.providerSnapshots.find((provider) => provider.id === 'openai');
    const mainAgent = snapshot.agentSnapshots.find((agent) => agent.id === 'main');
    const defaultsAfterRename = (snapshot.root.agents as Record<string, any>).defaults;

    assert.equal(openai?.models.some((model) => model.id === 'o4-mini-high'), true);
    assert.equal(openai?.models.some((model) => model.id === 'o4-mini'), false);
    assert.equal(
      defaultsAfterRename.model.fallbacks.includes('openai/o4-mini'),
      false,
    );
    assert.equal(
      Object.prototype.hasOwnProperty.call(
        defaultsAfterRename.models,
        'openai/o4-mini',
      ),
      false,
    );
    assert.equal(mainAgent?.model.primary, 'openai/o4-mini-high');

    await openClawConfigService.deleteProvider({
      configFile: 'D:/OpenClaw/.openclaw/openclaw.json',
      providerId: 'openai',
    });

    snapshot = await openClawConfigService.readConfigSnapshot('D:/OpenClaw/.openclaw/openclaw.json');
    const remainingProviderIds = snapshot.providerSnapshots.map((provider) => provider.id);
    const remainingMainAgent = snapshot.agentSnapshots.find((agent) => agent.id === 'main');

    assert.deepEqual(remainingProviderIds, ['anthropic']);
    assert.equal(
      snapshot.root.agents && JSON.stringify(snapshot.root.agents).includes('openai/'),
      false,
    );
    assert.equal(
      snapshot.root.agents &&
        JSON.stringify(snapshot.root.agents).includes('anthropic/claude-sonnet-4-5'),
      true,
    );
    assert.equal(remainingMainAgent?.model.primary, 'anthropic/claude-sonnet-4-5');
    assert.match(fileContent, /anthropic/);
  } finally {
    configurePlatformBridge(originalBridge);
  }
});

await runTest('openClawConfigService persists skill entry overrides and removes empty skill config cleanly', async () => {
  const { configurePlatformBridge, getPlatformBridge } = await import('@sdkwork/agentstudio-pc-infrastructure');
  const { openClawConfigService } = await import('./openClawConfigService.ts');

  const originalBridge = getPlatformBridge();
  let fileContent = `{
  skills: {
    entries: {
      "research-skill": {
        enabled: false,
        apiKey: "\${OLD_RESEARCH_KEY}",
        env: {
          RESEARCH_API_KEY: "\${OLD_RESEARCH_KEY}",
        },
      },
    },
  },
}`;

  configurePlatformBridge({
    platform: createPlatformBridgeStub({
      readFile: async () => fileContent,
      writeFile: async (_path, content) => {
        fileContent = content;
      },
    }),
  });

  try {
    await openClawConfigService.saveSkillEntry({
      configFile: 'D:/OpenClaw/.openclaw/openclaw.json',
      skillKey: 'research-skill',
      enabled: false,
      apiKey: '${RESEARCH_API_KEY}',
      env: {
        RESEARCH_API_KEY: '${RESEARCH_API_KEY}',
        RESEARCH_REGION: 'global',
      },
    });

    let snapshot = await openClawConfigService.readConfigSnapshot(
      'D:/OpenClaw/.openclaw/openclaw.json',
    );
    let entries = (((snapshot.root.skills as Record<string, any>) || {}).entries ||
      {}) as Record<string, any>;

    assert.equal(entries['research-skill']?.enabled, false);
    assert.equal(entries['research-skill']?.apiKey, '${RESEARCH_API_KEY}');
    assert.equal(entries['research-skill']?.env?.RESEARCH_API_KEY, '${RESEARCH_API_KEY}');
    assert.equal(entries['research-skill']?.env?.RESEARCH_REGION, 'global');

    await openClawConfigService.saveSkillEntry({
      configFile: 'D:/OpenClaw/.openclaw/openclaw.json',
      skillKey: 'research-skill',
      enabled: true,
      apiKey: '',
      env: {
        RESEARCH_API_KEY: '',
        RESEARCH_REGION: '',
      },
    });

    snapshot = await openClawConfigService.readConfigSnapshot('D:/OpenClaw/.openclaw/openclaw.json');
    entries = (((snapshot.root.skills as Record<string, any>) || {}).entries || {}) as Record<
      string,
      any
    >;

    assert.equal(entries['research-skill'], undefined);
    assert.equal(fileContent.includes('research-skill'), false);
  } finally {
    configurePlatformBridge(originalBridge);
  }
});

await runTest('openClawConfigService deletes a persisted skill entry without touching sibling skill config', async () => {
  const { configurePlatformBridge, getPlatformBridge } = await import('@sdkwork/agentstudio-pc-infrastructure');
  const { openClawConfigService } = await import('./openClawConfigService.ts');

  const originalBridge = getPlatformBridge();
  let fileContent = `{
  skills: {
    entries: {
      "research-skill": {
        enabled: false,
      },
      "calendar-skill": {
        env: {
          CALDAV_URL: "https://calendar.example.com",
        },
      },
    },
  },
}`;

  configurePlatformBridge({
    platform: createPlatformBridgeStub({
      readFile: async () => fileContent,
      writeFile: async (_path, content) => {
        fileContent = content;
      },
    }),
  });

  try {
    await openClawConfigService.deleteSkillEntry({
      configFile: 'D:/OpenClaw/.openclaw/openclaw.json',
      skillKey: 'research-skill',
    });

    const snapshot = await openClawConfigService.readConfigSnapshot(
      'D:/OpenClaw/.openclaw/openclaw.json',
    );
    const entries = (((snapshot.root.skills as Record<string, any>) || {}).entries ||
      {}) as Record<string, any>;

    assert.equal(entries['research-skill'], undefined);
    assert.deepEqual(entries['calendar-skill'], {
      env: {
        CALDAV_URL: 'https://calendar.example.com',
      },
    });
  } finally {
    configurePlatformBridge(originalBridge);
  }
});
