// WORKSPACE-PATH:allow-fixture: fixtures name a foreign checkout root, drive, or home directory to exercise path handling, so the literal is the value under assertion rather than a binding this build resolves
import assert from 'node:assert/strict';
import {
  configurePlatformBridge,
  getPlatformBridge,
  openClawGatewayClient,
} from '@sdkwork/agentstudio-pc-infrastructure';
import type { StudioInstanceDetailRecord } from '@sdkwork/agentstudio-pc-types';
import { createKernelAgentManagementService } from './kernelAgentManagementService.ts';
import { openClawConfigService } from './openClawConfigService.ts';

const FULL_FIELD_SUPPORT = {
  avatar: true,
  isDefault: true,
  primaryModel: true,
  fallbackModels: true,
  workspace: true,
  agentDir: true,
  temperature: true,
  topP: true,
  maxTokens: true,
  timeoutMs: true,
  streaming: true,
} as const;

const OPENCLAW_MANAGED_FIELD_SUPPORT = {
  avatar: true,
  isDefault: true,
  primaryModel: true,
  fallbackModels: true,
  workspace: false,
  agentDir: false,
  temperature: true,
  topP: true,
  maxTokens: true,
  timeoutMs: true,
  streaming: true,
} as const;

const UNSUPPORTED_FIELD_SUPPORT = {
  avatar: false,
  isDefault: false,
  primaryModel: false,
  fallbackModels: false,
  workspace: false,
  agentDir: false,
  temperature: false,
  topP: false,
  maxTokens: false,
  timeoutMs: false,
  streaming: false,
} as const;

const HERMES_FIELD_SUPPORT = {
  avatar: true,
  isDefault: false,
  primaryModel: false,
  fallbackModels: false,
  workspace: false,
  agentDir: false,
  temperature: false,
  topP: false,
  maxTokens: false,
  timeoutMs: false,
  streaming: false,
} as const;

function runTest(name: string, fn: () => Promise<void> | void) {
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

function createDetail(input: {
  instanceId: string;
  instanceName: string;
  runtimeKind?: string;
  transportKind?: string;
  primaryTransport?: string;
  configWritable?: boolean;
  configFile?: string | null;
  llmProviders?: Array<{
    id: string;
    name?: string;
    models: Array<{
      id: string;
      name?: string;
    }>;
  }>;
}): StudioInstanceDetailRecord {
  const configFile = input.configFile ?? null;

  return {
    instance: {
      id: input.instanceId,
      name: input.instanceName,
      type: 'runtime',
      typeLabel: 'Runtime',
      runtimeKind: input.runtimeKind ?? 'openclaw',
      deploymentMode: 'local-managed',
      transportKind: input.transportKind ?? 'openclawGatewayWs',
      host: '127.0.0.1',
      status: 'ready',
      endpoint: null,
      lastSeenAt: null,
      isBuiltIn: true,
      notes: null,
    },
    lifecycle: {
      ready: true,
      running: true,
      configWritable: input.configWritable ?? false,
    },
    connectivity: {
      reachable: true,
      primaryTransport: input.primaryTransport ?? 'openclawGatewayWs',
    },
    dataAccess: configFile
      ? {
          routes: [
            {
              scope: 'config',
              mode: 'managedFile',
              target: configFile,
              authoritative: true,
            },
          ],
        }
      : {
          routes: [],
        },
    artifacts: configFile
      ? [
          {
            kind: 'configFile',
            location: configFile,
          },
        ]
      : [],
    workbench: {
      llmProviders: input.llmProviders ?? [],
    },
  } as StudioInstanceDetailRecord;
}

await runTest(
  'kernelAgentManagementService treats OpenClaw gateway instances as creatable even when no host-writable config file is attached',
  async () => {
    const instanceId = 'gateway-openclaw-instance';
    const originalBridge = getPlatformBridge();

    configurePlatformBridge({
      studio: {
        ...originalBridge.studio,
        async getInstanceDetail(requestedInstanceId) {
          assert.equal(requestedInstanceId, instanceId);
          return createDetail({
            instanceId,
            instanceName: 'Gateway OpenClaw',
            runtimeKind: 'custom',
            transportKind: 'openclawGatewayWs',
            primaryTransport: 'openclawGatewayWs',
            configWritable: false,
            configFile: null,
          });
        },
      },
    });

    try {
      const service = createKernelAgentManagementService();
      const capability = await service.getCreationCapability(instanceId);

      assert.equal(capability.instanceId, instanceId);
      assert.equal(capability.defaultKernelId, 'openclaw');
      assert.deepEqual(capability.kernelOptions, [
        {
          kernelId: 'openclaw',
          label: 'OpenClaw',
          supported: true,
          reasonCode: null,
          reason: null,
          modelOptions: [],
          fieldSupport: OPENCLAW_MANAGED_FIELD_SUPPORT,
        },
      ]);
    } finally {
      configurePlatformBridge(originalBridge);
    }
  },
);

await runTest(
  'kernelAgentManagementService creates OpenClaw gateway agents by writing canonical workspace and agentDir paths to the gateway config',
  async () => {
    const instanceId = 'gateway-openclaw-create-instance';
    const configFile = 'D:/OpenClaw/.openclaw/openclaw.json';
    const originalBridge = getPlatformBridge();
    const originalCreateAgent = openClawGatewayClient.createAgent;
    const originalGetConfig = openClawGatewayClient.getConfig;
    const originalSetConfig = openClawGatewayClient.setConfig;
    const gatewayCalls: Array<{ method: 'createAgent' | 'getConfig' | 'setConfig'; args: unknown }> = [];

    configurePlatformBridge({
      studio: {
        ...originalBridge.studio,
        async getInstanceDetail(requestedInstanceId) {
          assert.equal(requestedInstanceId, instanceId);
          return createDetail({
            instanceId,
            instanceName: 'Gateway OpenClaw Create',
            runtimeKind: 'custom',
            transportKind: 'openclawGatewayWs',
            primaryTransport: 'openclawGatewayWs',
            configWritable: false,
            configFile: null,
            llmProviders: [
              {
                id: 'openai',
                name: 'OpenAI',
                models: [
                  {
                    id: 'gpt-5.4',
                    name: 'GPT-5.4',
                  },
                  {
                    id: 'gpt-4.1',
                    name: 'GPT-4.1',
                  },
                ],
              },
            ],
          });
        },
      },
    });

    openClawGatewayClient.createAgent = (async (
      requestedInstanceId: string,
      args: Record<string, unknown>,
    ) => {
      assert.equal(requestedInstanceId, instanceId);
      gatewayCalls.push({
        method: 'createAgent',
        args,
      });
      throw new Error('agents.create should not be used because it cannot preserve the requested agent id and agentDir.');
    }) as typeof openClawGatewayClient.createAgent;

    openClawGatewayClient.getConfig = (async (requestedInstanceId: string) => {
      assert.equal(requestedInstanceId, instanceId);
      gatewayCalls.push({
        method: 'getConfig',
        args: requestedInstanceId,
      });
      return {
        path: configFile,
        config: {},
        baseHash: 'base-hash-create',
      };
    }) as typeof openClawGatewayClient.getConfig;

    openClawGatewayClient.setConfig = (async (
      requestedInstanceId: string,
      args: { raw: string; baseHash?: string },
    ) => {
      assert.equal(requestedInstanceId, instanceId);
      gatewayCalls.push({
        method: 'setConfig',
        args,
      });
      return {
        ok: true,
      };
    }) as typeof openClawGatewayClient.setConfig;

    try {
      const service = createKernelAgentManagementService();
      const result = await service.createAgent({
        instanceId,
        kernelId: 'openclaw',
        agentId: 'navigator',
        displayName: 'Navigator',
        avatar: 'N',
        isDefault: true,
        primaryModel: 'openai/gpt-5.4',
        fallbackModels: ['openai/gpt-4.1'],
        temperature: 0.4,
        topP: 0.9,
        maxTokens: 1200,
        timeoutMs: 60000,
        streaming: true,
      });

      assert.deepEqual(result, {
        instanceId,
        kernelId: 'openclaw',
        agentId: 'navigator',
        displayName: 'Navigator',
      });
      assert.equal(gatewayCalls.some((call) => call.method === 'createAgent'), false);
      assert.equal(gatewayCalls[0]?.method, 'getConfig');
      assert.equal(gatewayCalls[1]?.method, 'setConfig');
      const setConfigArgs = gatewayCalls[1]?.args as { raw: string; baseHash?: string };
      assert.equal(setConfigArgs.baseHash, 'base-hash-create');
      const parsed = JSON.parse(setConfigArgs.raw);
      const main = parsed.agents.list.find((entry: any) => entry.id === 'main');
      const navigator = parsed.agents.list.find((entry: any) => entry.id === 'navigator');
      assert.deepEqual(main, {
        id: 'main',
        name: 'Main',
        workspace: 'D:/OpenClaw/.openclaw/workspace',
        agentDir: 'D:/OpenClaw/.openclaw/agents/main/agent',
        default: false,
      });
      assert.deepEqual(navigator, {
        id: 'navigator',
        name: 'Navigator',
        workspace: 'D:/OpenClaw/.openclaw/workspace-navigator',
        agentDir: 'D:/OpenClaw/.openclaw/agents/navigator/agent',
        params: {
          temperature: 0.4,
          topP: 0.9,
          maxTokens: 1200,
          timeoutMs: 60000,
          streaming: true,
        },
        identity: {
          emoji: 'N',
        },
        default: true,
      });
    } finally {
      openClawGatewayClient.createAgent = originalCreateAgent;
      openClawGatewayClient.getConfig = originalGetConfig;
      openClawGatewayClient.setConfig = originalSetConfig;
      configurePlatformBridge(originalBridge);
    }
  },
);

await runTest(
  'kernelAgentManagementService keeps the standard main OpenClaw agent when gateway config is empty and the created agent is not default',
  async () => {
    const instanceId = 'gateway-openclaw-empty-config-non-default-instance';
    const configFile = 'D:/OpenClaw/.openclaw/openclaw.json';
    const originalBridge = getPlatformBridge();
    const originalGetConfig = openClawGatewayClient.getConfig;
    const originalSetConfig = openClawGatewayClient.setConfig;
    let setConfigRaw = '';

    configurePlatformBridge({
      studio: {
        ...originalBridge.studio,
        async getInstanceDetail(requestedInstanceId) {
          assert.equal(requestedInstanceId, instanceId);
          return createDetail({
            instanceId,
            instanceName: 'Gateway OpenClaw Empty Config',
            runtimeKind: 'custom',
            transportKind: 'openclawGatewayWs',
            primaryTransport: 'openclawGatewayWs',
            configWritable: false,
            configFile: null,
          });
        },
      },
    });

    openClawGatewayClient.getConfig = (async (requestedInstanceId: string) => {
      assert.equal(requestedInstanceId, instanceId);
      return {
        path: configFile,
        config: {},
        baseHash: 'base-hash-empty-config',
      };
    }) as typeof openClawGatewayClient.getConfig;

    openClawGatewayClient.setConfig = (async (
      requestedInstanceId: string,
      args: { raw: string; baseHash?: string },
    ) => {
      assert.equal(requestedInstanceId, instanceId);
      assert.equal(args.baseHash, 'base-hash-empty-config');
      setConfigRaw = args.raw;
      return {
        ok: true,
      };
    }) as typeof openClawGatewayClient.setConfig;

    try {
      const service = createKernelAgentManagementService();
      const result = await service.createAgent({
        instanceId,
        kernelId: 'openclaw',
        agentId: 'research analyst',
        displayName: 'Research Analyst',
        isDefault: false,
      });

      assert.deepEqual(result, {
        instanceId,
        kernelId: 'openclaw',
        agentId: 'research-analyst',
        displayName: 'Research Analyst',
      });

      const parsed = JSON.parse(setConfigRaw);
      const main = parsed.agents.list.find((entry: any) => entry.id === 'main');
      const research = parsed.agents.list.find((entry: any) => entry.id === 'research-analyst');
      assert.deepEqual(main, {
        id: 'main',
        name: 'Main',
        workspace: 'D:/OpenClaw/.openclaw/workspace',
        agentDir: 'D:/OpenClaw/.openclaw/agents/main/agent',
        default: true,
      });
      assert.equal(research.workspace, 'D:/OpenClaw/.openclaw/workspace-research-analyst');
      assert.equal(research.agentDir, 'D:/OpenClaw/.openclaw/agents/research-analyst/agent');
      assert.equal(research.default, false);
    } finally {
      openClawGatewayClient.getConfig = originalGetConfig;
      openClawGatewayClient.setConfig = originalSetConfig;
      configurePlatformBridge(originalBridge);
    }
  },
);

await runTest(
  'kernelAgentManagementService resolves empty OpenClaw workspace and agentDir fields from the gateway config path before saving',
  async () => {
    const instanceId = 'gateway-openclaw-config-fallback-instance';
    const configFile = 'D:/OpenClaw/.openclaw/openclaw.json';
    const originalBridge = getPlatformBridge();
    const originalCreateAgent = openClawGatewayClient.createAgent;
    const originalGetConfig = openClawGatewayClient.getConfig;
    const originalSetConfig = openClawGatewayClient.setConfig;
    const gatewayCalls: Array<{ method: 'createAgent' | 'getConfig' | 'setConfig'; args: unknown }> = [];

    configurePlatformBridge({
      studio: {
        ...originalBridge.studio,
        async getInstanceDetail(requestedInstanceId) {
          assert.equal(requestedInstanceId, instanceId);
          return createDetail({
            instanceId,
            instanceName: 'Gateway OpenClaw Config Fallback',
            runtimeKind: 'custom',
            transportKind: 'openclawGatewayWs',
            primaryTransport: 'openclawGatewayWs',
            configWritable: false,
            configFile: null,
          });
        },
      },
    });

    openClawGatewayClient.createAgent = (async (requestedInstanceId: string) => {
      assert.equal(requestedInstanceId, instanceId);
      gatewayCalls.push({
        method: 'createAgent',
        args: requestedInstanceId,
      });
      throw new Error('agents.create should not be used for config-backed OpenClaw agent creation');
    }) as typeof openClawGatewayClient.createAgent;

    openClawGatewayClient.getConfig = (async (requestedInstanceId: string) => {
      assert.equal(requestedInstanceId, instanceId);
      gatewayCalls.push({
        method: 'getConfig',
        args: requestedInstanceId,
      });
      return {
        path: configFile,
        config: {},
        baseHash: 'base-hash-1',
      };
    }) as typeof openClawGatewayClient.getConfig;

    openClawGatewayClient.setConfig = (async (
      requestedInstanceId: string,
      args: { raw: string; baseHash?: string },
    ) => {
      assert.equal(requestedInstanceId, instanceId);
      gatewayCalls.push({
        method: 'setConfig',
        args,
      });
      return {
        ok: true,
      };
    }) as typeof openClawGatewayClient.setConfig;

    try {
      const service = createKernelAgentManagementService();
      const result = await service.createAgent({
        instanceId,
        kernelId: 'openclaw',
        agentId: 'ops',
        displayName: 'Ops',
      });

      assert.deepEqual(result, {
        instanceId,
        kernelId: 'openclaw',
        agentId: 'ops',
        displayName: 'Ops',
      });
      assert.equal(gatewayCalls.some((call) => call.method === 'createAgent'), false);
      assert.equal(gatewayCalls.length, 2);
      assert.equal(gatewayCalls[0]?.method, 'getConfig');
      assert.equal(gatewayCalls[1]?.method, 'setConfig');
      const setConfigArgs = gatewayCalls[1]?.args as { raw: string; baseHash?: string };
      assert.equal(setConfigArgs.baseHash, 'base-hash-1');
      const parsed = JSON.parse(setConfigArgs.raw);
      const ops = parsed.agents.list.find((entry: any) => entry.id === 'ops');
      assert.equal(ops.workspace, 'D:/OpenClaw/.openclaw/workspace-ops');
      assert.equal(ops.agentDir, 'D:/OpenClaw/.openclaw/agents/ops/agent');
    } finally {
      openClawGatewayClient.createAgent = originalCreateAgent;
      openClawGatewayClient.getConfig = originalGetConfig;
      openClawGatewayClient.setConfig = originalSetConfig;
      configurePlatformBridge(originalBridge);
    }
  },
);

await runTest(
  'kernelAgentManagementService falls back to the writable OpenClaw config file when gateway agent creation and config updates fail',
  async () => {
    const instanceId = 'gateway-openclaw-fallback-instance';
    const configFile = 'D:/OpenClaw/.openclaw/openclaw.json';
    const originalBridge = getPlatformBridge();
    const originalCreateAgent = openClawGatewayClient.createAgent;
    const originalGetConfig = openClawGatewayClient.getConfig;
    const originalSetConfig = openClawGatewayClient.setConfig;
    const originalResolveAgentPaths = openClawConfigService.resolveAgentPaths;
    const originalSaveAgent = openClawConfigService.saveAgent;
    const saveAgentCalls: Array<{
      configFile: string;
      agentId: string;
      displayName: string;
      workspace?: string;
      agentDir?: string;
    }> = [];

    configurePlatformBridge({
      studio: {
        ...originalBridge.studio,
        async getInstanceDetail(requestedInstanceId) {
          assert.equal(requestedInstanceId, instanceId);
          return createDetail({
            instanceId,
            instanceName: 'Gateway OpenClaw Fallback',
            runtimeKind: 'openclaw',
            transportKind: 'openclawGatewayWs',
            primaryTransport: 'openclawGatewayWs',
            configWritable: true,
            configFile,
          });
        },
      },
    });

    openClawGatewayClient.createAgent = (async () => {
      throw new Error('agents.create unavailable');
    }) as typeof openClawGatewayClient.createAgent;

    openClawGatewayClient.getConfig = (async () => {
      throw new Error('Gateway config update failed.');
    }) as typeof openClawGatewayClient.getConfig;

    openClawGatewayClient.setConfig = (async () => {
      throw new Error('setConfig should not run when getConfig already failed');
    }) as typeof openClawGatewayClient.setConfig;

    openClawConfigService.resolveAgentPaths = (async (input: {
      configFile: string;
      agentId: string;
      workspace?: string | null;
      agentDir?: string | null;
    }) => {
      assert.deepEqual(input, {
        configFile,
        agentId: 'planner',
        workspace: null,
        agentDir: null,
      });
      return {
        id: 'planner',
        workspace: 'D:/OpenClaw/.openclaw/workspace-planner',
        agentDir: 'D:/OpenClaw/.openclaw/agents/planner/agent',
        isDefault: false,
      };
    }) as typeof openClawConfigService.resolveAgentPaths;

    openClawConfigService.saveAgent = (async (input: {
      configFile: string;
      agent: { id: string; name: string; workspace?: string; agentDir?: string };
    }) => {
      saveAgentCalls.push({
        configFile: input.configFile,
        agentId: input.agent.id,
        displayName: input.agent.name,
        workspace: input.agent.workspace,
        agentDir: input.agent.agentDir,
      });
      return null;
    }) as typeof openClawConfigService.saveAgent;

    try {
      const service = createKernelAgentManagementService();
      const result = await service.createAgent({
        instanceId,
        kernelId: 'openclaw',
        agentId: 'planner',
        displayName: 'Planner',
      });

      assert.deepEqual(result, {
        instanceId,
        kernelId: 'openclaw',
        agentId: 'planner',
        displayName: 'Planner',
      });
      assert.deepEqual(saveAgentCalls, [
        {
          configFile,
          agentId: 'planner',
          displayName: 'Planner',
          workspace: 'D:/OpenClaw/.openclaw/workspace-planner',
          agentDir: 'D:/OpenClaw/.openclaw/agents/planner/agent',
        },
      ]);
    } finally {
      openClawGatewayClient.createAgent = originalCreateAgent;
      openClawGatewayClient.getConfig = originalGetConfig;
      openClawGatewayClient.setConfig = originalSetConfig;
      openClawConfigService.resolveAgentPaths = originalResolveAgentPaths;
      openClawConfigService.saveAgent = originalSaveAgent;
      configurePlatformBridge(originalBridge);
    }
  },
);

await runTest(
  'kernelAgentManagementService rejects platform kernel options that omit explicit field support declarations',
  async () => {
    const instanceId = 'platform-capability-missing-field-support';
    const originalBridge = getPlatformBridge();

    configurePlatformBridge({
      studio: {
        ...originalBridge.studio,
        async getInstanceDetail(requestedInstanceId) {
          assert.equal(requestedInstanceId, instanceId);
          throw new Error('detail intentionally unavailable');
        },
        async getKernelAgentCreationCapability(requestedInstanceId: string) {
          assert.equal(requestedInstanceId, instanceId);
          return {
            instanceId,
            instanceName: 'Invalid Capability Runtime',
            kernelOptions: [
              {
                kernelId: 'hermes',
                label: 'Hermes',
                supported: true,
                reasonCode: null,
                reason: null,
                modelOptions: [],
              },
            ],
            defaultKernelId: 'hermes',
          } as any;
        },
      },
    });

    try {
      const service = createKernelAgentManagementService();

      await assert.rejects(
        () => service.getCreationCapability(instanceId),
        /field support/i,
      );
    } finally {
      configurePlatformBridge(originalBridge);
    }
  },
);

await runTest(
  'kernelAgentManagementService does not mask invalid platform capability contracts behind inferred fallback capability',
  async () => {
    const instanceId = 'platform-capability-masked-field-support';
    const originalBridge = getPlatformBridge();

    configurePlatformBridge({
      studio: {
        ...originalBridge.studio,
        async getInstanceDetail(requestedInstanceId) {
          assert.equal(requestedInstanceId, instanceId);
          return createDetail({
            instanceId,
            instanceName: 'Gateway OpenClaw With Invalid Platform Capability',
            runtimeKind: 'custom',
            transportKind: 'openclawGatewayWs',
            primaryTransport: 'openclawGatewayWs',
            configWritable: false,
            configFile: null,
          });
        },
        async getKernelAgentCreationCapability(requestedInstanceId: string) {
          assert.equal(requestedInstanceId, instanceId);
          return {
            instanceId,
            instanceName: 'Gateway OpenClaw With Invalid Platform Capability',
            kernelOptions: [
              {
                kernelId: 'openclaw',
                label: 'OpenClaw',
                supported: false,
                reasonCode: 'configUnavailable',
                reason: 'Invalid platform capability should fail before inferred fallback.',
                modelOptions: [],
              },
            ],
            defaultKernelId: 'openclaw',
          } as any;
        },
      },
    });

    try {
      const service = createKernelAgentManagementService();

      await assert.rejects(
        () => service.getCreationCapability(instanceId),
        /field support/i,
      );
    } finally {
      configurePlatformBridge(originalBridge);
    }
  },
);

await runTest(
  'kernelAgentManagementService prefers platform-declared kernel agent creation capability over inferred unsupported kernel fallback',
  async () => {
    const instanceId = 'platform-capability-hermes-instance';
    const originalBridge = getPlatformBridge();
    let capabilityRequests = 0;

    configurePlatformBridge({
      studio: {
        ...originalBridge.studio,
        async getInstanceDetail(requestedInstanceId) {
          assert.equal(requestedInstanceId, instanceId);
          return createDetail({
            instanceId,
            instanceName: 'Hermes Runtime',
            runtimeKind: 'hermes',
            transportKind: 'http',
            primaryTransport: 'http',
            configWritable: false,
            configFile: null,
          });
        },
        async getKernelAgentCreationCapability(requestedInstanceId: string) {
          assert.equal(requestedInstanceId, instanceId);
          capabilityRequests += 1;
          return {
            instanceId,
            instanceName: 'Hermes Runtime',
            kernelOptions: [
              {
                kernelId: 'hermes',
                label: 'Hermes',
                supported: true,
                reasonCode: null,
                reason: null,
                modelOptions: [
                  {
                    value: 'anthropic/claude-sonnet-4-5',
                    label: 'Anthropic / Claude Sonnet 4.5',
                    providerId: 'anthropic',
                    providerLabel: 'Anthropic',
                  },
                ],
                fieldSupport: HERMES_FIELD_SUPPORT,
              },
            ],
            defaultKernelId: 'hermes',
          };
        },
      },
    });

    try {
      const service = createKernelAgentManagementService();
      const capability = await service.getCreationCapability(instanceId);

      assert.equal(capabilityRequests, 1);
      assert.deepEqual(capability, {
        instanceId,
        instanceName: 'Hermes Runtime',
        kernelOptions: [
          {
            kernelId: 'hermes',
            label: 'Hermes',
            supported: true,
            reasonCode: null,
            reason: null,
            modelOptions: [
              {
                value: 'anthropic/claude-sonnet-4-5',
                label: 'Anthropic / Claude Sonnet 4.5',
                providerId: 'anthropic',
                providerLabel: 'Anthropic',
              },
            ],
            fieldSupport: HERMES_FIELD_SUPPORT,
          },
        ],
        defaultKernelId: 'hermes',
      });
    } finally {
      configurePlatformBridge(originalBridge);
    }
  },
);

await runTest(
  'kernelAgentManagementService delegates agent creation to the platform contract when the selected kernel is platform-managed',
  async () => {
    const instanceId = 'platform-create-hermes-instance';
    const originalBridge = getPlatformBridge();
    const createRequests: Array<{
      instanceId: string;
      kernelId: string;
      agentId: string;
      displayName: string;
    }> = [];

    configurePlatformBridge({
      studio: {
        ...originalBridge.studio,
        async getInstanceDetail(requestedInstanceId) {
          assert.equal(requestedInstanceId, instanceId);
          return createDetail({
            instanceId,
            instanceName: 'Hermes Runtime',
            runtimeKind: 'hermes',
            transportKind: 'http',
            primaryTransport: 'http',
            configWritable: false,
            configFile: null,
          });
        },
        async getKernelAgentCreationCapability(requestedInstanceId: string) {
          assert.equal(requestedInstanceId, instanceId);
          return {
            instanceId,
            instanceName: 'Hermes Runtime',
            kernelOptions: [
              {
                kernelId: 'hermes',
                label: 'Hermes',
                supported: true,
                reasonCode: null,
                reason: null,
                modelOptions: [],
                fieldSupport: HERMES_FIELD_SUPPORT,
              },
            ],
            defaultKernelId: 'hermes',
          };
        },
        async createKernelAgent(request: {
          instanceId: string;
          kernelId?: string | null;
          agentId: string;
          displayName: string;
        }) {
          createRequests.push({
            instanceId: request.instanceId,
            kernelId: request.kernelId ?? '',
            agentId: request.agentId,
            displayName: request.displayName,
          });

          return {
            instanceId: request.instanceId,
            kernelId: request.kernelId ?? 'hermes',
            agentId: request.agentId,
            displayName: request.displayName,
          };
        },
      },
    });

    try {
      const service = createKernelAgentManagementService();
      const result = await service.createAgent({
        instanceId,
        kernelId: 'hermes',
        agentId: 'researcher',
        displayName: 'Researcher',
      });

      assert.deepEqual(createRequests, [
        {
          instanceId,
          kernelId: 'hermes',
          agentId: 'researcher',
          displayName: 'Researcher',
        },
      ]);
      assert.deepEqual(result, {
        instanceId,
        kernelId: 'hermes',
        agentId: 'researcher',
        displayName: 'Researcher',
      });
    } finally {
      configurePlatformBridge(originalBridge);
    }
  },
);

await runTest(
  'kernelAgentManagementService prefers OpenClaw gateway config writes over platform local config writes for gateway-backed OpenClaw kernels',
  async () => {
    const instanceId = 'platform-openclaw-gateway-preferred-instance';
    const configFile = 'D:/OpenClaw/.openclaw/openclaw.json';
    const originalBridge = getPlatformBridge();
    const originalCreateAgent = openClawGatewayClient.createAgent;
    const originalGetConfig = openClawGatewayClient.getConfig;
    const originalSetConfig = openClawGatewayClient.setConfig;
    let platformCreateCalls = 0;
    const gatewayCalls: Array<{ method: 'createAgent' | 'getConfig' | 'setConfig'; args: unknown }> = [];

    configurePlatformBridge({
      studio: {
        ...originalBridge.studio,
        async getInstanceDetail(requestedInstanceId) {
          assert.equal(requestedInstanceId, instanceId);
          return createDetail({
            instanceId,
            instanceName: 'Built In OpenClaw Gateway',
            runtimeKind: 'openclaw',
            transportKind: 'openclawGatewayWs',
            primaryTransport: 'openclawGatewayWs',
            configWritable: true,
            configFile,
          });
        },
        async getKernelAgentCreationCapability(requestedInstanceId: string) {
          assert.equal(requestedInstanceId, instanceId);
          return {
            instanceId,
            instanceName: 'Built In OpenClaw Gateway',
            kernelOptions: [
              {
                kernelId: 'openclaw',
                label: 'OpenClaw',
                supported: true,
                reasonCode: null,
                reason: null,
                modelOptions: [],
                fieldSupport: FULL_FIELD_SUPPORT,
              },
            ],
            defaultKernelId: 'openclaw',
          };
        },
        async createKernelAgent() {
          platformCreateCalls += 1;
          throw new Error('platform createKernelAgent should not run for gateway-backed OpenClaw creation');
        },
      },
    });

    openClawGatewayClient.createAgent = (async (
      requestedInstanceId: string,
      args: Record<string, unknown>,
    ) => {
      assert.equal(requestedInstanceId, instanceId);
      gatewayCalls.push({
        method: 'createAgent',
        args,
      });
      throw new Error('agents.create should not be used for config-backed OpenClaw agent creation');
    }) as typeof openClawGatewayClient.createAgent;

    openClawGatewayClient.getConfig = (async (requestedInstanceId: string) => {
      assert.equal(requestedInstanceId, instanceId);
      gatewayCalls.push({
        method: 'getConfig',
        args: requestedInstanceId,
      });
      return {
        path: configFile,
        config: {},
        baseHash: 'base-hash-preferred',
      };
    }) as typeof openClawGatewayClient.getConfig;

    openClawGatewayClient.setConfig = (async (
      requestedInstanceId: string,
      args: { raw: string; baseHash?: string },
    ) => {
      assert.equal(requestedInstanceId, instanceId);
      gatewayCalls.push({
        method: 'setConfig',
        args,
      });
      return {
        ok: true,
      };
    }) as typeof openClawGatewayClient.setConfig;

    try {
      const service = createKernelAgentManagementService();
      const result = await service.createAgent({
        instanceId,
        kernelId: 'openclaw',
        agentId: 'reviewer',
        displayName: 'Reviewer',
      });

      assert.equal(platformCreateCalls, 0);
      assert.equal(gatewayCalls.some((call) => call.method === 'createAgent'), false);
      assert.equal(gatewayCalls[0]?.method, 'getConfig');
      assert.equal(gatewayCalls[1]?.method, 'setConfig');
      const setConfigArgs = gatewayCalls[1]?.args as { raw: string; baseHash?: string };
      assert.equal(setConfigArgs.baseHash, 'base-hash-preferred');
      const parsed = JSON.parse(setConfigArgs.raw);
      const reviewer = parsed.agents.list.find((entry: any) => entry.id === 'reviewer');
      assert.equal(reviewer.workspace, 'D:/OpenClaw/.openclaw/workspace-reviewer');
      assert.equal(reviewer.agentDir, 'D:/OpenClaw/.openclaw/agents/reviewer/agent');
      assert.deepEqual(result, {
        instanceId,
        kernelId: 'openclaw',
        agentId: 'reviewer',
        displayName: 'Reviewer',
      });
    } finally {
      openClawGatewayClient.createAgent = originalCreateAgent;
      openClawGatewayClient.getConfig = originalGetConfig;
      openClawGatewayClient.setConfig = originalSetConfig;
      configurePlatformBridge(originalBridge);
    }
  },
);

await runTest(
  'kernelAgentManagementService rejects create requests that set fields outside the selected kernel field support contract',
  async () => {
    const instanceId = 'platform-create-hermes-invalid-fields';
    const originalBridge = getPlatformBridge();
    let platformCreateCalls = 0;

    configurePlatformBridge({
      studio: {
        ...originalBridge.studio,
        async getInstanceDetail(requestedInstanceId) {
          assert.equal(requestedInstanceId, instanceId);
          return createDetail({
            instanceId,
            instanceName: 'Hermes Runtime',
            runtimeKind: 'hermes',
            transportKind: 'http',
            primaryTransport: 'http',
            configWritable: false,
            configFile: null,
          });
        },
        async getKernelAgentCreationCapability(requestedInstanceId: string) {
          assert.equal(requestedInstanceId, instanceId);
          return {
            instanceId,
            instanceName: 'Hermes Runtime',
            kernelOptions: [
              {
                kernelId: 'hermes',
                label: 'Hermes',
                supported: true,
                reasonCode: null,
                reason: null,
                modelOptions: [],
                fieldSupport: HERMES_FIELD_SUPPORT,
              },
            ],
            defaultKernelId: 'hermes',
          };
        },
        async createKernelAgent() {
          platformCreateCalls += 1;
          throw new Error('platform createKernelAgent should not run for invalid field combinations');
        },
      },
    });

    try {
      const service = createKernelAgentManagementService();

      await assert.rejects(
        () =>
          service.createAgent({
            instanceId,
            kernelId: 'hermes',
            agentId: 'researcher',
            displayName: 'Researcher',
            primaryModel: 'anthropic/claude-sonnet-4-5',
            workspace: 'workspace/research',
            isDefault: true,
          }),
        /primaryModel|workspace|isDefault/,
      );

      assert.equal(platformCreateCalls, 0);
    } finally {
      configurePlatformBridge(originalBridge);
    }
  },
);

await runTest(
  'kernelAgentManagementService merges platform-declared kernels with inferred OpenClaw transport support so multi-kernel capability stays intact',
  async () => {
    const instanceId = 'platform-custom-openclaw-instance';
    const originalBridge = getPlatformBridge();

    configurePlatformBridge({
      studio: {
        ...originalBridge.studio,
        async getInstanceDetail(requestedInstanceId) {
          assert.equal(requestedInstanceId, instanceId);
          return createDetail({
            instanceId,
            instanceName: 'Custom Gateway Runtime',
            runtimeKind: 'custom',
            transportKind: 'openclawGatewayWs',
            primaryTransport: 'openclawGatewayWs',
            configWritable: false,
            configFile: null,
          });
        },
        async getKernelAgentCreationCapability(requestedInstanceId: string) {
          assert.equal(requestedInstanceId, instanceId);
          return {
            instanceId,
            instanceName: 'Custom Gateway Runtime',
            kernelOptions: [
              {
                kernelId: 'custom',
                label: 'Custom',
                supported: false,
                reasonCode: 'unsupportedKernel',
                reason: 'Custom kernel creation is not implemented.',
                modelOptions: [],
                fieldSupport: UNSUPPORTED_FIELD_SUPPORT,
              },
            ],
            defaultKernelId: 'custom',
          };
        },
      },
    });

    try {
      const service = createKernelAgentManagementService();
      const capability = await service.getCreationCapability(instanceId);

      assert.equal(capability.defaultKernelId, 'openclaw');
      assert.deepEqual(capability.kernelOptions, [
        {
          kernelId: 'openclaw',
          label: 'OpenClaw',
          supported: true,
          reasonCode: null,
          reason: null,
          modelOptions: [],
          fieldSupport: OPENCLAW_MANAGED_FIELD_SUPPORT,
        },
        {
          kernelId: 'custom',
          label: 'Custom',
          supported: false,
          reasonCode: 'unsupportedKernel',
          reason: 'Custom kernel creation is not implemented.',
          modelOptions: [],
          fieldSupport: UNSUPPORTED_FIELD_SUPPORT,
        },
      ]);
    } finally {
      configurePlatformBridge(originalBridge);
    }
  },
);

await runTest(
  'kernelAgentManagementService falls back to inferred capability when platform capability loading fails but instance detail still exposes OpenClaw gateway creation',
  async () => {
    const instanceId = 'platform-capability-error-openclaw-instance';
    const originalBridge = getPlatformBridge();

    configurePlatformBridge({
      studio: {
        ...originalBridge.studio,
        async getInstanceDetail(requestedInstanceId) {
          assert.equal(requestedInstanceId, instanceId);
          return createDetail({
            instanceId,
            instanceName: 'Gateway OpenClaw After Capability Error',
            runtimeKind: 'custom',
            transportKind: 'openclawGatewayWs',
            primaryTransport: 'openclawGatewayWs',
            configWritable: false,
            configFile: null,
          });
        },
        async getKernelAgentCreationCapability(requestedInstanceId: string) {
          assert.equal(requestedInstanceId, instanceId);
          throw new Error('desktop capability bridge unavailable');
        },
      },
    });

    try {
      const service = createKernelAgentManagementService();
      const capability = await service.getCreationCapability(instanceId);

      assert.equal(capability.defaultKernelId, 'openclaw');
      assert.deepEqual(capability.kernelOptions, [
        {
          kernelId: 'openclaw',
          label: 'OpenClaw',
          supported: true,
          reasonCode: null,
          reason: null,
          modelOptions: [],
          fieldSupport: OPENCLAW_MANAGED_FIELD_SUPPORT,
        },
      ]);
    } finally {
      configurePlatformBridge(originalBridge);
    }
  },
);

await runTest(
  'kernelAgentManagementService creates inferred OpenClaw agents when platform capability loading fails but gateway transport remains available',
  async () => {
    const instanceId = 'platform-capability-error-openclaw-create-instance';
    const originalBridge = getPlatformBridge();
    const originalGetConfig = openClawGatewayClient.getConfig;
    const originalSetConfig = openClawGatewayClient.setConfig;
    let platformCreateCalls = 0;

    configurePlatformBridge({
      studio: {
        ...originalBridge.studio,
        async getInstanceDetail(requestedInstanceId) {
          assert.equal(requestedInstanceId, instanceId);
          return createDetail({
            instanceId,
            instanceName: 'Gateway OpenClaw Create After Capability Error',
            runtimeKind: 'custom',
            transportKind: 'openclawGatewayWs',
            primaryTransport: 'openclawGatewayWs',
            configWritable: false,
            configFile: null,
          });
        },
        async getKernelAgentCreationCapability(requestedInstanceId: string) {
          assert.equal(requestedInstanceId, instanceId);
          throw new Error('desktop capability bridge unavailable');
        },
        async createKernelAgent() {
          platformCreateCalls += 1;
          throw new Error('platform createKernelAgent should not run when capability loading already failed');
        },
      },
    });

    openClawGatewayClient.getConfig = (async (requestedInstanceId: string) => {
      assert.equal(requestedInstanceId, instanceId);
      return {
        path: 'D:/OpenClaw/.openclaw/openclaw.json',
        config: {},
        baseHash: 'base-hash-capability-error',
      };
    }) as typeof openClawGatewayClient.getConfig;

    openClawGatewayClient.setConfig = (async (
      requestedInstanceId: string,
      args: { raw: string; baseHash?: string },
    ) => {
      assert.equal(requestedInstanceId, instanceId);
      assert.equal(args.baseHash, 'base-hash-capability-error');
      assert.match(args.raw, /"id": "navigator"/);
      return {
        ok: true,
      };
    }) as typeof openClawGatewayClient.setConfig;

    try {
      const service = createKernelAgentManagementService();
      const result = await service.createAgent({
        instanceId,
        kernelId: 'openclaw',
        agentId: 'navigator',
        displayName: 'Navigator',
      });

      assert.equal(platformCreateCalls, 0);
      assert.deepEqual(result, {
        instanceId,
        kernelId: 'openclaw',
        agentId: 'navigator',
        displayName: 'Navigator',
      });
    } finally {
      openClawGatewayClient.getConfig = originalGetConfig;
      openClawGatewayClient.setConfig = originalSetConfig;
      configurePlatformBridge(originalBridge);
    }
  },
);

await runTest(
  'kernelAgentManagementService rejects OpenClaw gateway config writes when no authoritative config path is available',
  async () => {
    const instanceId = 'gateway-openclaw-missing-config-path-instance';
    const originalBridge = getPlatformBridge();
    const originalGetConfig = openClawGatewayClient.getConfig;
    const originalSetConfig = openClawGatewayClient.setConfig;
    let gatewaySetConfigCalls = 0;

    configurePlatformBridge({
      studio: {
        ...originalBridge.studio,
        async getInstanceDetail(requestedInstanceId) {
          assert.equal(requestedInstanceId, instanceId);
          return createDetail({
            instanceId,
            instanceName: 'Gateway OpenClaw Missing Config Path',
            runtimeKind: 'custom',
            transportKind: 'openclawGatewayWs',
            primaryTransport: 'openclawGatewayWs',
            configWritable: false,
            configFile: null,
          });
        },
        async getKernelAgentCreationCapability(requestedInstanceId: string) {
          assert.equal(requestedInstanceId, instanceId);
          throw new Error('desktop capability bridge unavailable');
        },
      },
    });

    openClawGatewayClient.getConfig = (async (requestedInstanceId: string) => {
      assert.equal(requestedInstanceId, instanceId);
      return {
        config: {},
        baseHash: 'base-hash-without-path',
      };
    }) as typeof openClawGatewayClient.getConfig;

    openClawGatewayClient.setConfig = (async () => {
      gatewaySetConfigCalls += 1;
      throw new Error('setConfig should not run without a config path');
    }) as typeof openClawGatewayClient.setConfig;

    try {
      const service = createKernelAgentManagementService();

      await assert.rejects(
        () =>
          service.createAgent({
            instanceId,
            kernelId: 'openclaw',
            agentId: 'navigator',
            displayName: 'Navigator',
          }),
        /OpenClaw gateway config path is required/,
      );

      assert.equal(gatewaySetConfigCalls, 0);
    } finally {
      openClawGatewayClient.getConfig = originalGetConfig;
      openClawGatewayClient.setConfig = originalSetConfig;
      configurePlatformBridge(originalBridge);
    }
  },
);

await runTest(
  'kernelAgentManagementService rejects inferred OpenClaw model selections that are not present in the kernel model catalog',
  async () => {
    const instanceId = 'inferred-openclaw-invalid-model-instance';
    const originalBridge = getPlatformBridge();
    const originalGetConfig = openClawGatewayClient.getConfig;
    const originalSetConfig = openClawGatewayClient.setConfig;
    let gatewayCalls = 0;

    configurePlatformBridge({
      studio: {
        ...originalBridge.studio,
        async getInstanceDetail(requestedInstanceId) {
          assert.equal(requestedInstanceId, instanceId);
          return createDetail({
            instanceId,
            instanceName: 'Gateway OpenClaw With Model Catalog',
            runtimeKind: 'custom',
            transportKind: 'openclawGatewayWs',
            primaryTransport: 'openclawGatewayWs',
            configWritable: false,
            configFile: null,
            llmProviders: [
              {
                id: 'openai',
                name: 'OpenAI',
                models: [
                  {
                    id: 'gpt-5.4',
                    name: 'GPT-5.4',
                  },
                ],
              },
            ],
          });
        },
      },
    });

    openClawGatewayClient.getConfig = (async () => {
      gatewayCalls += 1;
      throw new Error('getConfig should not run for invalid model selections');
    }) as typeof openClawGatewayClient.getConfig;

    openClawGatewayClient.setConfig = (async () => {
      gatewayCalls += 1;
      throw new Error('setConfig should not run for invalid model selections');
    }) as typeof openClawGatewayClient.setConfig;

    try {
      const service = createKernelAgentManagementService();

      await assert.rejects(
        () =>
          service.createAgent({
            instanceId,
            kernelId: 'openclaw',
            agentId: 'operator',
            displayName: 'Operator',
            primaryModel: 'anthropic/claude-sonnet-4-5',
          }),
        /primaryModel/,
      );

      assert.equal(gatewayCalls, 0);
    } finally {
      openClawGatewayClient.getConfig = originalGetConfig;
      openClawGatewayClient.setConfig = originalSetConfig;
      configurePlatformBridge(originalBridge);
    }
  },
);

await runTest(
  'kernelAgentManagementService falls back to inferred OpenClaw provider creation when platform capability does not manage the selected kernel',
  async () => {
    const instanceId = 'platform-openclaw-fallback-instance';
    const originalBridge = getPlatformBridge();
    const originalGetConfig = openClawGatewayClient.getConfig;
    const originalSetConfig = openClawGatewayClient.setConfig;
    let platformCreateCalls = 0;

    configurePlatformBridge({
      studio: {
        ...originalBridge.studio,
        async getInstanceDetail(requestedInstanceId) {
          assert.equal(requestedInstanceId, instanceId);
          return createDetail({
            instanceId,
            instanceName: 'External OpenClaw Runtime',
            runtimeKind: 'openclaw',
            transportKind: 'openclawGatewayWs',
            primaryTransport: 'openclawGatewayWs',
            configWritable: false,
            configFile: null,
          });
        },
        async getKernelAgentCreationCapability(requestedInstanceId: string) {
          assert.equal(requestedInstanceId, instanceId);
          return {
            instanceId,
            instanceName: 'External OpenClaw Runtime',
            kernelOptions: [
              {
                kernelId: 'openclaw',
                label: 'OpenClaw',
                supported: false,
                reasonCode: 'configUnavailable',
                reason: 'Desktop bridge does not manage this runtime directly.',
                modelOptions: [],
                fieldSupport: FULL_FIELD_SUPPORT,
              },
            ],
            defaultKernelId: 'openclaw',
          };
        },
        async createKernelAgent() {
          platformCreateCalls += 1;
          throw new Error('platform createKernelAgent should not be used for inferred OpenClaw fallback');
        },
      },
    });

    openClawGatewayClient.getConfig = (async (requestedInstanceId: string) => {
      assert.equal(requestedInstanceId, instanceId);
      return {
        path: 'D:/OpenClaw/.openclaw/openclaw.json',
        config: {},
        baseHash: 'base-hash-platform-fallback',
      };
    }) as typeof openClawGatewayClient.getConfig;

    openClawGatewayClient.setConfig = (async (
      requestedInstanceId: string,
      args: { raw: string; baseHash?: string },
    ) => {
      assert.equal(requestedInstanceId, instanceId);
      assert.equal(args.baseHash, 'base-hash-platform-fallback');
      assert.match(args.raw, /"id": "operator"/);
      return {
        ok: true,
      };
    }) as typeof openClawGatewayClient.setConfig;

    try {
      const service = createKernelAgentManagementService();
      const result = await service.createAgent({
        instanceId,
        kernelId: 'openclaw',
        agentId: 'operator',
        displayName: 'Operator',
      });

      assert.equal(platformCreateCalls, 0);
      assert.deepEqual(result, {
        instanceId,
        kernelId: 'openclaw',
        agentId: 'operator',
        displayName: 'Operator',
      });
    } finally {
      openClawGatewayClient.getConfig = originalGetConfig;
      openClawGatewayClient.setConfig = originalSetConfig;
      configurePlatformBridge(originalBridge);
    }
  },
);

await runTest(
  'kernelAgentManagementService scopes model options to each kernel when merging platform-managed and inferred multi-kernel capability',
  async () => {
    const instanceId = 'platform-multi-kernel-model-scope-instance';
    const originalBridge = getPlatformBridge();

    configurePlatformBridge({
      studio: {
        ...originalBridge.studio,
        async getInstanceDetail(requestedInstanceId) {
          assert.equal(requestedInstanceId, instanceId);
          return createDetail({
            instanceId,
            instanceName: 'Multi Kernel Runtime',
            runtimeKind: 'custom',
            transportKind: 'openclawGatewayWs',
            primaryTransport: 'openclawGatewayWs',
            configWritable: false,
            configFile: null,
            llmProviders: [
              {
                id: 'openai',
                name: 'OpenAI',
                models: [
                  {
                    id: 'gpt-5.4',
                    name: 'GPT-5.4',
                  },
                ],
              },
            ],
          });
        },
        async getKernelAgentCreationCapability(requestedInstanceId: string) {
          assert.equal(requestedInstanceId, instanceId);
          return {
            instanceId,
            instanceName: 'Multi Kernel Runtime',
            kernelOptions: [
              {
                kernelId: 'hermes',
                label: 'Hermes',
                supported: true,
                reasonCode: null,
                reason: null,
                modelOptions: [
                  {
                    value: 'anthropic/claude-sonnet-4-5',
                    label: 'Anthropic / Claude Sonnet 4.5',
                    providerId: 'anthropic',
                    providerLabel: 'Anthropic',
                  },
                ],
                fieldSupport: HERMES_FIELD_SUPPORT,
              },
            ],
            defaultKernelId: 'hermes',
          };
        },
      },
    });

    try {
      const service = createKernelAgentManagementService();
      const capability = await service.getCreationCapability(instanceId);

      assert.equal(capability.defaultKernelId, 'hermes');
      assert.deepEqual(capability.kernelOptions, [
        {
          kernelId: 'openclaw',
          label: 'OpenClaw',
          supported: true,
          reasonCode: null,
          reason: null,
          modelOptions: [
            {
              value: 'openai/gpt-5.4',
              label: 'OpenAI / GPT-5.4',
              providerId: 'openai',
              providerLabel: 'OpenAI',
            },
          ],
          fieldSupport: OPENCLAW_MANAGED_FIELD_SUPPORT,
        },
        {
          kernelId: 'hermes',
          label: 'Hermes',
          supported: true,
          reasonCode: null,
          reason: null,
          modelOptions: [
            {
              value: 'anthropic/claude-sonnet-4-5',
              label: 'Anthropic / Claude Sonnet 4.5',
              providerId: 'anthropic',
              providerLabel: 'Anthropic',
            },
          ],
          fieldSupport: HERMES_FIELD_SUPPORT,
        },
      ]);
    } finally {
      configurePlatformBridge(originalBridge);
    }
  },
);

await runTest(
  'kernelAgentManagementService keeps platform model options authoritative when inferred and platform capability describe the same kernel',
  async () => {
    const instanceId = 'platform-openclaw-authoritative-model-options-instance';
    const originalBridge = getPlatformBridge();

    configurePlatformBridge({
      studio: {
        ...originalBridge.studio,
        async getInstanceDetail(requestedInstanceId) {
          assert.equal(requestedInstanceId, instanceId);
          return createDetail({
            instanceId,
            instanceName: 'OpenClaw Runtime',
            runtimeKind: 'openclaw',
            transportKind: 'openclawGatewayWs',
            primaryTransport: 'openclawGatewayWs',
            configWritable: false,
            configFile: null,
            llmProviders: [
              {
                id: 'openai',
                name: 'OpenAI',
                models: [
                  {
                    id: 'gpt-5.4',
                    name: 'GPT-5.4',
                  },
                ],
              },
            ],
          });
        },
        async getKernelAgentCreationCapability(requestedInstanceId: string) {
          assert.equal(requestedInstanceId, instanceId);
          return {
            instanceId,
            instanceName: 'OpenClaw Runtime',
            kernelOptions: [
              {
                kernelId: 'openclaw',
                label: 'OpenClaw',
                supported: true,
                reasonCode: null,
                reason: null,
                modelOptions: [
                  {
                    value: 'openrouter/meta-llama/llama-3.1-8b-instruct',
                    label: 'OpenRouter / Llama 3.1 8B Instruct',
                    providerId: 'openrouter',
                    providerLabel: 'OpenRouter',
                  },
                ],
                fieldSupport: FULL_FIELD_SUPPORT,
              },
            ],
            defaultKernelId: 'openclaw',
          };
        },
      },
    });

    try {
      const service = createKernelAgentManagementService();
      const capability = await service.getCreationCapability(instanceId);

      assert.deepEqual(capability.kernelOptions, [
        {
          kernelId: 'openclaw',
          label: 'OpenClaw',
          supported: true,
          reasonCode: null,
          reason: null,
          modelOptions: [
            {
              value: 'openrouter/meta-llama/llama-3.1-8b-instruct',
              label: 'OpenRouter / Llama 3.1 8B Instruct',
              providerId: 'openrouter',
              providerLabel: 'OpenRouter',
            },
          ],
          fieldSupport: OPENCLAW_MANAGED_FIELD_SUPPORT,
        },
      ]);
    } finally {
      configurePlatformBridge(originalBridge);
    }
  },
);
