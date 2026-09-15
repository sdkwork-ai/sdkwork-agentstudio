// WORKSPACE-PATH:allow-fixture: fixtures name a foreign checkout root, drive, or home directory to exercise path handling, so the literal is the value under assertion rather than a binding this build resolves
import assert from 'node:assert/strict';
import {
  DEFAULT_BUNDLED_OPENCLAW_VERSION,
  type StudioInstanceDetailRecord,
} from '@sdkwork/agentstudio-pc-types';
import { createAgentSkillManagementService } from './agentSkillManagementServiceCore.ts';

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

function createOpenClawDetail(overrides: Partial<StudioInstanceDetailRecord> = {}) {
  return {
    instance: {
      id: 'openclaw-instance',
      name: 'OpenClaw Host',
      description: 'OpenClaw host',
      runtimeKind: 'openclaw',
      deploymentMode: 'local-external',
      transportKind: 'openclawGatewayWs',
      status: 'online',
      isBuiltIn: false,
      isDefault: false,
      iconType: 'server',
      version: DEFAULT_BUNDLED_OPENCLAW_VERSION,
      typeLabel: 'OpenClaw Gateway',
      host: '127.0.0.1',
      port: 28789,
      baseUrl: 'http://127.0.0.1:28789',
      websocketUrl: 'ws://127.0.0.1:28789',
      cpu: 12,
      memory: 26,
      totalMemory: '32 GB',
      uptime: '3h',
      capabilities: ['chat', 'files', 'models', 'tools'],
      storage: {
        provider: 'localFile',
        namespace: 'openclaw-instance',
      },
      config: {
        port: '28789',
        sandbox: true,
        autoUpdate: false,
        logLevel: 'info',
        corsOrigins: '*',
        baseUrl: 'http://127.0.0.1:28789',
        websocketUrl: 'ws://127.0.0.1:28789',
        authToken: 'gateway-token',
      },
      createdAt: 1,
      updatedAt: 2,
      lastSeenAt: 3,
    },
    config: {
      port: '28789',
      sandbox: true,
      autoUpdate: false,
      logLevel: 'info',
      corsOrigins: '*',
      baseUrl: 'http://127.0.0.1:28789',
      websocketUrl: 'ws://127.0.0.1:28789',
      authToken: 'gateway-token',
    },
    logs: '',
    health: {
      score: 100,
      status: 'healthy',
      checks: [],
      evaluatedAt: 1,
    },
    lifecycle: {
      owner: 'externalProcess',
      startStopSupported: false,
      configWritable: true,
      notes: [],
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
      lastSeenAt: 3,
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
          detail: 'OpenClaw config file',
          source: 'integration',
        },
      ],
    },
    artifacts: [],
    capabilities: [],
    officialRuntimeNotes: [],
    ...overrides,
  } as StudioInstanceDetailRecord;
}

await runTest(
  'agentSkillManagementService writes skill enabled state through the discovered config file when available',
  async () => {
    const configWrites: Array<{ configFile: string; skillKey: string; enabled?: boolean }> = [];
    const service = createAgentSkillManagementService({
      studioApi: {
        getInstanceDetail: async () => createOpenClawDetail(),
      },
      kernelConfigAttachmentApi: {
        resolveAttachedKernelConfigFile: () => 'D:/OpenClaw/.openclaw/openclaw.json',
      },
      openClawConfigDocumentApi: {
        saveSkillEntry: async (input) => {
          configWrites.push(input);
          return null;
        },
      },
      openClawGatewayClient: {
        updateSkill: async () => {
          throw new Error('gateway update should not be used when config file is writable');
        },
      },
    });

    await service.setSkillEnabled({
      instanceId: 'openclaw-instance',
      skillKey: 'research-skill',
      enabled: false,
    });

    assert.deepEqual(configWrites, [
      {
        configFile: 'D:/OpenClaw/.openclaw/openclaw.json',
        skillKey: 'research-skill',
        enabled: false,
      },
    ]);
  },
);

await runTest(
  'agentSkillManagementService falls back to gateway skills.update when no writable config path exists',
  async () => {
    const gatewayUpdates: Array<{ instanceId: string; args: Record<string, unknown> }> = [];
    const service = createAgentSkillManagementService({
      studioApi: {
        getInstanceDetail: async () =>
          createOpenClawDetail({
            lifecycle: {
              owner: 'remoteService',
              startStopSupported: false,
              configWritable: false,
              notes: [],
            },
            dataAccess: {
              routes: [],
            },
          }),
      },
      kernelConfigAttachmentApi: {
        resolveAttachedKernelConfigFile: () => null,
      },
      openClawConfigDocumentApi: {
        saveSkillEntry: async () => {
          throw new Error('config service should not be used without a writable config path');
        },
      },
      openClawGatewayClient: {
        updateSkill: async (instanceId, args) => {
          gatewayUpdates.push({ instanceId, args });
          return { ok: true };
        },
      },
    });

    await service.setSkillEnabled({
      instanceId: 'openclaw-instance',
      skillKey: 'research-skill',
      enabled: true,
    });

    assert.deepEqual(gatewayUpdates, [
      {
        instanceId: 'openclaw-instance',
        args: {
          skillKey: 'research-skill',
          enabled: true,
        },
      },
    ]);
  },
);

await runTest(
  'agentSkillManagementService installs ClawHub skills through the gateway for the default agent workspace only',
  async () => {
    const gatewayInstalls: Array<{ instanceId: string; args: Record<string, unknown> }> = [];
    const service = createAgentSkillManagementService({
      studioApi: {
        getInstanceDetail: async () => createOpenClawDetail(),
      },
      openClawGatewayClient: {
        installSkill: async (instanceId, args) => {
          gatewayInstalls.push({ instanceId, args });
          return { ok: true };
        },
      },
    });

    await service.installSkill({
      instanceId: 'openclaw-instance',
      agentId: 'main',
      isDefaultAgent: true,
      slug: 'research-skill',
      force: true,
    });

    assert.deepEqual(gatewayInstalls, [
      {
        instanceId: 'openclaw-instance',
        args: {
          source: 'clawhub',
          slug: 'research-skill',
          force: true,
        },
      },
    ]);
  },
);

await runTest(
  'agentSkillManagementService rejects direct installs for non-default agents because upstream install targets the default workspace',
  async () => {
    const service = createAgentSkillManagementService({
      studioApi: {
        getInstanceDetail: async () => createOpenClawDetail(),
      },
    });

    await assert.rejects(
      () =>
        service.installSkill({
          instanceId: 'openclaw-instance',
          agentId: 'research',
          isDefaultAgent: false,
          slug: 'research-skill',
        }),
      /default OpenClaw workspace/i,
    );
  },
);

await runTest(
  'agentSkillManagementService removes workspace-installed skills and clears local config plus ClawHub tracking metadata',
  async () => {
    const removedPaths: string[] = [];
    const deletedConfigEntries: string[] = [];
    let lockfileContent = JSON.stringify(
      {
        version: 1,
        skills: {
          'research-skill': {
            version: '1.0.0',
            installedAt: 1,
          },
          'calendar-skill': {
            version: '1.1.0',
            installedAt: 2,
          },
        },
      },
      null,
      2,
    );

    const service = createAgentSkillManagementService({
      studioApi: {
        getInstanceDetail: async () => createOpenClawDetail(),
      },
      kernelConfigAttachmentApi: {
        resolveAttachedKernelConfigFile: () => 'D:/OpenClaw/.openclaw/openclaw.json',
      },
      openClawConfigDocumentApi: {
        saveSkillEntry: async () => null,
        deleteSkillEntry: async ({ skillKey }: any) => {
          deletedConfigEntries.push(skillKey);
          return null;
        },
      } as any,
      platform: {
        pathExists: async (path: string) =>
          path === 'D:/OpenClaw/.openclaw/workspace/skills/research-skill' ||
          path === 'D:/OpenClaw/.openclaw/workspace/.clawhub/lock.json',
        removePath: async (path: string) => {
          removedPaths.push(path);
        },
        readFile: async () => lockfileContent,
        writeFile: async (_path: string, content: string) => {
          lockfileContent = content;
        },
      } as any,
    } as any);

    await service.removeSkill({
      instanceId: 'openclaw-instance',
      skillKey: 'research-skill',
      scope: 'workspace',
      baseDir: 'D:/OpenClaw/.openclaw/workspace/skills/research-skill',
      workspacePath: 'D:/OpenClaw/.openclaw/workspace',
    });

    assert.deepEqual(removedPaths, [
      'D:/OpenClaw/.openclaw/workspace/skills/research-skill',
    ]);
    assert.deepEqual(deletedConfigEntries, ['research-skill']);
    assert.equal(lockfileContent.includes('research-skill'), false);
    assert.equal(lockfileContent.includes('calendar-skill'), true);
  },
);

await runTest(
  'agentSkillManagementService ignores stale typo lockfile roots outside the canonical .clawhub workspace metadata path',
  async () => {
    const removedPaths: string[] = [];
    const deletedConfigEntries: string[] = [];
    let typoLockfileContent = JSON.stringify(
      {
        version: 1,
        skills: {
          'research-skill': {
            version: '1.0.0',
            installedAt: 1,
          },
        },
      },
      null,
      2,
    );

    const service = createAgentSkillManagementService({
      studioApi: {
        getInstanceDetail: async () => createOpenClawDetail(),
      },
      kernelConfigAttachmentApi: {
        resolveAttachedKernelConfigFile: () => 'D:/OpenClaw/.openclaw/openclaw.json',
      },
      openClawConfigDocumentApi: {
        saveSkillEntry: async () => null,
        deleteSkillEntry: async ({ skillKey }: any) => {
          deletedConfigEntries.push(skillKey);
          return null;
        },
      } as any,
      platform: {
        pathExists: async (path: string) =>
          path === 'D:/OpenClaw/.openclaw/workspace/skills/research-skill' ||
          path === 'D:/OpenClaw/.openclaw/workspace/.clawdhub/lock.json',
        removePath: async (path: string) => {
          removedPaths.push(path);
        },
        readFile: async () => typoLockfileContent,
        writeFile: async (_path: string, content: string) => {
          typoLockfileContent = content;
        },
      } as any,
    } as any);

    await service.removeSkill({
      instanceId: 'openclaw-instance',
      skillKey: 'research-skill',
      scope: 'workspace',
      baseDir: 'D:/OpenClaw/.openclaw/workspace/skills/research-skill',
      workspacePath: 'D:/OpenClaw/.openclaw/workspace',
    });

    assert.deepEqual(removedPaths, [
      'D:/OpenClaw/.openclaw/workspace/skills/research-skill',
    ]);
    assert.deepEqual(deletedConfigEntries, ['research-skill']);
    assert.equal(typoLockfileContent.includes('research-skill'), true);
  },
);
