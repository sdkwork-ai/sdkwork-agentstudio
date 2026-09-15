// WORKSPACE-PATH:allow-fixture: fixtures name a foreign checkout root, drive, or home directory to exercise path handling, so the literal is the value under assertion rather than a binding this build resolves
import assert from 'node:assert/strict';
import type { RuntimeInfo } from '@sdkwork/agentstudio-pc-infrastructure';
import {
  createProviderConfigImportService,
  type ProviderConfigImportSource,
} from './providerConfigImportService.ts';

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

function createRuntimeInfo(userRoot: string): RuntimeInfo {
  return {
    platform: 'desktop',
    paths: {
      installRoot: 'D:/sdkwork/agent-studio',
      foundationDir: 'D:/sdkwork/agent-studio/foundation',
      foundationComponentsDir: 'D:/sdkwork/agent-studio/foundation/components',
      modulesDir: 'D:/sdkwork/agent-studio/modules',
      runtimesDir: 'D:/sdkwork/agent-studio/runtimes',
      toolsDir: 'D:/sdkwork/agent-studio/tools',
      trustDir: 'D:/sdkwork/agent-studio/trust',
      packsDir: 'D:/sdkwork/agent-studio/packs',
      extensionsDir: 'D:/sdkwork/agent-studio/extensions',
      machineRoot: 'D:/sdkwork/agent-studio/machine',
      machineStateDir: 'D:/sdkwork/agent-studio/machine/state',
      machineStoreDir: 'D:/sdkwork/agent-studio/machine/store',
      machineStagingDir: 'D:/sdkwork/agent-studio/machine/staging',
      machineReceiptsDir: 'D:/sdkwork/agent-studio/machine/receipts',
      machineRuntimeDir: 'D:/sdkwork/agent-studio/machine/runtime',
      machineRecoveryDir: 'D:/sdkwork/agent-studio/machine/recovery',
      machineLogsDir: 'D:/sdkwork/agent-studio/machine/logs',
      userRoot,
      userDir: `${userRoot}/user`,
      userAuthDir: `${userRoot}/auth`,
      userStorageDir: `${userRoot}/storage`,
      userIntegrationsDir: `${userRoot}/integrations`,
      studioDir: `${userRoot}/studio`,
      workspacesDir: `${userRoot}/workspaces`,
      studioBackupsDir: `${userRoot}/studio-backups`,
      userLogsDir: `${userRoot}/logs`,
      configDir: `${userRoot}/config`,
      dataDir: `${userRoot}/data`,
      cacheDir: `${userRoot}/cache`,
      logsDir: `${userRoot}/logs`,
      stateDir: `${userRoot}/state`,
      storageDir: `${userRoot}/storage`,
      pluginsDir: `${userRoot}/plugins`,
      integrationsDir: `${userRoot}/integrations`,
      backupsDir: `${userRoot}/backups`,
      configFile: `${userRoot}/config/config.json`,
      layoutFile: `${userRoot}/config/layout.json`,
      activeFile: `${userRoot}/config/active.json`,
      inventoryFile: `${userRoot}/config/inventory.json`,
      retentionFile: `${userRoot}/config/retention.json`,
      pinnedFile: `${userRoot}/config/pinned.json`,
      channelsFile: `${userRoot}/config/channels.json`,
      policiesFile: `${userRoot}/config/policies.json`,
      sourcesFile: `${userRoot}/config/sources.json`,
      serviceFile: `${userRoot}/config/service.json`,
      componentsFile: `${userRoot}/config/components.json`,
      upgradesFile: `${userRoot}/config/upgrades.json`,
      componentRegistryFile: `${userRoot}/config/component-registry.json`,
      serviceDefaultsFile: `${userRoot}/config/service-defaults.json`,
      upgradePolicyFile: `${userRoot}/config/upgrade-policy.json`,
      deviceIdFile: `${userRoot}/config/device-id`,
      mainLogFile: `${userRoot}/logs/main.log`,
    },
  };
}

function createService(options: {
  userRoot?: string;
  files: Record<string, string>;
  userToolingFiles?: Record<string, string>;
  blockGeneralFs?: boolean;
}) {
  const userRoot = options.userRoot ?? 'C:/Users/admin/.sdkwork/crawstudio';
  const files = new Map(
    Object.entries(options.files).map(([filePath, value]) => [
      filePath.replaceAll('\\', '/'),
      value,
    ]),
  );
  const userToolingFiles = new Map(
    Object.entries(options.userToolingFiles ?? options.files).map(([filePath, value]) => [
      filePath.replaceAll('\\', '/'),
      value,
    ]),
  );

  return createProviderConfigImportService({
    runtimeApi: {
      getRuntimeInfo: async () => createRuntimeInfo(userRoot),
    },
    platformApi: {
      getPlatform: () => 'desktop',
      pathExists: async (filePath: string) => {
        if (options.blockGeneralFs) {
          throw new Error(`general pathExists should not be used for ${filePath}`);
        }
        return files.has(filePath.replaceAll('\\', '/'));
      },
      readFile: async (filePath: string) => {
        if (options.blockGeneralFs) {
          throw new Error(`general readFile should not be used for ${filePath}`);
        }
        const normalizedPath = filePath.replaceAll('\\', '/');
        const value = files.get(normalizedPath);
        if (value === undefined) {
          throw new Error(`missing test fixture for ${normalizedPath}`);
        }
        return value;
      },
      pathExistsForUserTooling: async (filePath: string) =>
        userToolingFiles.has(filePath.replaceAll('\\', '/')),
      readFileForUserTooling: async (filePath: string) => {
        const normalizedPath = filePath.replaceAll('\\', '/');
        const value = userToolingFiles.get(normalizedPath);
        if (value === undefined) {
          throw new Error(`missing user tooling fixture for ${normalizedPath}`);
        }
        return value;
      },
    } as any,
  });
}

function findImportedDraft(
  result: Awaited<ReturnType<ReturnType<typeof createService>['importProviderConfigs']>>,
  source: ProviderConfigImportSource,
  providerId: string,
) {
  return result.drafts.find(
    (entry) =>
      entry.source === source &&
      entry.draft.providerId === providerId,
  );
}

await runTest('providerConfigImportService imports Codex provider routes from config.toml plus auth.json', async () => {
  const service = createService({
    files: {
      'C:/Users/admin/.codex/config.toml': `
model = "gpt-5.4"
model_provider = "openai"

[model_providers.openai]
base_url = "https://api.openai.com/v1"
env_key = "OPENAI_API_KEY"

[model_providers.azure]
base_url = "https://sdkwork.openai.azure.com/openai/v1"
env_key = "AZURE_OPENAI_API_KEY"
`,
      'C:/Users/admin/.codex/auth.json': JSON.stringify({
        OPENAI_API_KEY: 'sk-codex-openai',
        AZURE_OPENAI_API_KEY: 'azure-codex-secret',
      }),
    },
  });

  const imported = await service.importProviderConfigs('codex');
  const openAiDraft = findImportedDraft(imported, 'codex', 'openai');
  const azureDraft = findImportedDraft(imported, 'codex', 'azure-openai');

  assert.equal(imported.drafts.length, 2);
  assert.ok(openAiDraft);
  assert.equal(openAiDraft?.draft.name, 'Codex / OpenAI');
  assert.equal(openAiDraft?.draft.apiKey, 'sk-codex-openai');
  assert.equal(openAiDraft?.draft.baseUrl, 'https://api.openai.com/v1');
  assert.equal(openAiDraft?.draft.defaultModelId, 'gpt-5.4');
  assert.equal(openAiDraft?.draft.isDefault, true);

  assert.ok(azureDraft);
  assert.equal(azureDraft?.draft.apiKey, 'azure-codex-secret');
  assert.equal(azureDraft?.draft.baseUrl, 'https://sdkwork.openai.azure.com/openai/v1');
});

await runTest('providerConfigImportService reads Codex imports through dedicated user tooling access', async () => {
  const service = createService({
    blockGeneralFs: true,
    files: {},
    userToolingFiles: {
      'C:/Users/admin/.codex/config.toml': `
model = "gpt-5.4"
model_provider = "openai"

[model_providers.openai]
base_url = "https://api.openai.com/v1"
env_key = "OPENAI_API_KEY"
`,
      'C:/Users/admin/.codex/auth.json': JSON.stringify({
        OPENAI_API_KEY: 'sk-codex-openai',
      }),
    },
  });

  const imported = await service.importProviderConfigs('codex');
  const openAiDraft = findImportedDraft(imported, 'codex', 'openai');

  assert.equal(imported.drafts.length, 1);
  assert.ok(openAiDraft);
  assert.equal(openAiDraft?.draft.apiKey, 'sk-codex-openai');
  assert.equal(openAiDraft?.draft.baseUrl, 'https://api.openai.com/v1');
});

await runTest(
  'providerConfigImportService normalizes imported Codex drafts through the shared provider routing standard for custom providers',
  async () => {
    const service = createService({
      files: {
        'C:/Users/admin/.codex/config.toml': `
model = "custom-provider/gpt-oss-120b"
model_provider = "custom-provider"

[model_providers.custom-provider]
base_url = " https://llm.example.com/v1/ "
env_key = "CUSTOM_PROVIDER_API_KEY"
`,
        'C:/Users/admin/.codex/auth.json': JSON.stringify({
          CUSTOM_PROVIDER_API_KEY: 'sk-custom-provider',
        }),
      },
    });

    const imported = await service.importProviderConfigs('codex');
    const customDraft = findImportedDraft(imported, 'codex', 'custom-provider');

    assert.equal(imported.drafts.length, 1);
    assert.ok(customDraft);
    assert.equal(customDraft?.draft.name, 'Codex / Custom Provider');
    assert.equal(customDraft?.draft.providerId, 'custom-provider');
    assert.equal(customDraft?.draft.clientProtocol, 'openai-compatible');
    assert.equal(customDraft?.draft.upstreamProtocol, 'openai-compatible');
    assert.equal(customDraft?.draft.upstreamBaseUrl, 'https://llm.example.com/v1');
    assert.equal(customDraft?.draft.baseUrl, 'https://llm.example.com/v1');
    assert.equal(customDraft?.draft.defaultModelId, 'gpt-oss-120b');
    assert.deepEqual(customDraft?.draft.models, [
      { id: 'gpt-oss-120b', name: 'gpt-oss-120b' },
    ]);
    assert.deepEqual(customDraft?.draft.exposeTo, ['openclaw']);
    assert.deepEqual(customDraft?.draft.config, {
      temperature: 0.2,
      topP: 1,
      maxTokens: 8192,
      timeoutMs: 60000,
      streaming: true,
    });
  },
);

await runTest('providerConfigImportService imports OpenCode provider routes from config JSONC and auth.json', async () => {
  const service = createService({
    files: {
      'C:/Users/admin/AppData/Roaming/opencode/opencode.jsonc': `{
  // Global OpenCode settings
  "model": "openai/gpt-4.1",
  "provider": {
    "openai": {
      "options": {
        "baseURL": "https://api.openai.com/v1",
        "models": {
          "gpt-4.1": { "name": "GPT 4.1" },
          "text-embedding-3-large": {}
        }
      }
    },
    "anthropic": {
      "disabled": true,
      "options": {
        "models": {
          "claude-sonnet-4-20250514": { "name": "Claude Sonnet 4" }
        }
      }
    }
  }
}`,
      'C:/Users/admin/AppData/Roaming/opencode/auth.json': JSON.stringify({
        openai: { type: 'api', key: 'sk-open-code-openai' },
        anthropic: { type: 'api', key: 'sk-open-code-anthropic' },
      }),
    },
  });

  const imported = await service.importProviderConfigs('opencode');
  const openAiDraft = findImportedDraft(imported, 'opencode', 'openai');
  const anthropicDraft = findImportedDraft(imported, 'opencode', 'anthropic');

  assert.equal(imported.drafts.length, 2);
  assert.ok(openAiDraft);
  assert.equal(openAiDraft?.draft.defaultModelId, 'gpt-4.1');
  assert.deepEqual(openAiDraft?.draft.models, [
    { id: 'gpt-4.1', name: 'GPT 4.1' },
    { id: 'text-embedding-3-large', name: 'text-embedding-3-large' },
  ]);
  assert.equal(openAiDraft?.draft.apiKey, 'sk-open-code-openai');

  assert.ok(anthropicDraft);
  assert.equal(anthropicDraft?.draft.enabled, false);
  assert.equal(anthropicDraft?.draft.apiKey, 'sk-open-code-anthropic');
});

await runTest('providerConfigImportService imports Claude Code static Anthropic settings when an API key is present', async () => {
  const service = createService({
    files: {
      'C:/Users/admin/.claude/settings.json': JSON.stringify({
        env: {
          ANTHROPIC_API_KEY: 'sk-claude-static',
        },
        model: 'claude-sonnet-4-20250514',
        availableModels: [
          'claude-sonnet-4-20250514',
          'claude-opus-4-20250514',
        ],
      }),
    },
  });

  const imported = await service.importProviderConfigs('claude-code');
  const anthropicDraft = findImportedDraft(imported, 'claude-code', 'anthropic');

  assert.equal(imported.drafts.length, 1);
  assert.ok(anthropicDraft);
  assert.equal(anthropicDraft?.draft.name, 'Claude Code / Anthropic');
  assert.equal(anthropicDraft?.draft.apiKey, 'sk-claude-static');
  assert.equal(anthropicDraft?.draft.defaultModelId, 'claude-sonnet-4-20250514');
  assert.deepEqual(anthropicDraft?.draft.models, [
    { id: 'claude-sonnet-4-20250514', name: 'claude-sonnet-4-20250514' },
    { id: 'claude-opus-4-20250514', name: 'claude-opus-4-20250514' },
  ]);
});
