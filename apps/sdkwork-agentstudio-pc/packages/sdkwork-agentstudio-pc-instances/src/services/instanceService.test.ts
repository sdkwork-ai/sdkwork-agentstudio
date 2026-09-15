// WORKSPACE-PATH:allow-fixture: fixtures name a foreign checkout root, drive, or home directory to exercise path handling, so the literal is the value under assertion rather than a binding this build resolves
import assert from 'node:assert/strict';
import {
  parseOpenClawConfigDocument,
  serializeOpenClawConfigDocument,
} from '@sdkwork/agentstudio-pc-core';
import {
  DEFAULT_BUNDLED_OPENCLAW_VERSION,
  type StudioInstanceDetailRecord,
} from '@sdkwork/agentstudio-pc-types';
import {
  buildOpenClawAgentFileId,
  createInstanceService,
} from './instanceServiceCore.ts';

const BUILT_IN_INSTANCE_ID = 'managed-openclaw-primary';

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

function createOpenClawDetail(
  instanceId = 'openclaw-prod',
  overrides: Partial<StudioInstanceDetailRecord> = {},
): StudioInstanceDetailRecord {
  const {
    instance: instanceOverride,
    config: configOverride,
    lifecycle: lifecycleOverride,
    ...restOverrides
  } = overrides;
  const instance = {
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
      baseUrl: 'http://10.0.0.8:21280',
      websocketUrl: 'ws://10.0.0.8:21280',
      authToken: 'gateway-token',
    },
    createdAt: 1,
    updatedAt: 1,
    lastSeenAt: 1,
    ...(instanceOverride || {}),
  };

  const builtInManaged = instance.isBuiltIn && instance.deploymentMode === 'local-managed';

  return {
    instance,
    config: {
      port: '21280',
      sandbox: true,
      autoUpdate: true,
      logLevel: 'info',
      corsOrigins: '*',
      baseUrl: 'http://10.0.0.8:21280',
      websocketUrl: 'ws://10.0.0.8:21280',
      authToken: 'gateway-token',
      ...(configOverride || {}),
    },
    logs: '',
    health: {
      score: 91,
      status: 'healthy',
      checks: [],
      evaluatedAt: 1,
    },
    lifecycle: {
      owner: builtInManaged ? 'appManaged' : 'remoteService',
      startStopSupported: builtInManaged,
      configWritable: true,
      workbenchManaged: builtInManaged,
      endpointObserved: builtInManaged,
      lifecycleControllable: builtInManaged,
      notes: [],
      ...(lifecycleOverride || {}),
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
    ...restOverrides,
  };
}

function createCustomDetail(
  instanceId = 'custom-runtime',
  overrides: Partial<StudioInstanceDetailRecord> = {},
): StudioInstanceDetailRecord {
  const base = createOpenClawDetail(instanceId);

  return {
    ...base,
    instance: {
      ...base.instance,
      runtimeKind: 'custom',
      deploymentMode: 'remote',
      transportKind: 'customHttp',
      typeLabel: 'Custom Runtime',
      config: {
        port: '17890',
        sandbox: true,
        autoUpdate: false,
        logLevel: 'info',
        corsOrigins: '*',
      },
      ...(overrides.instance || {}),
    },
    config: {
      port: '17890',
      sandbox: true,
      autoUpdate: false,
      logLevel: 'info',
      corsOrigins: '*',
      ...(overrides.config || {}),
    },
    capabilities:
      overrides.capabilities || [
        {
          id: 'files',
          status: 'ready',
          detail: 'Files are available.',
          source: 'runtime',
        },
        {
          id: 'models',
          status: 'ready',
          detail: 'Provider config is available.',
          source: 'runtime',
        },
      ],
    workbench:
      overrides.workbench || {
        channels: [],
        cronTasks: {
          tasks: [],
          taskExecutionsById: {},
        },
        llmProviders: [],
        agents: [],
        skills: [],
        files: [],
        memory: [],
        tools: [],
      },
    ...overrides,
  };
}

function createConfigBackedOpenClawDetail(
  instanceId = 'managed-openclaw',
  overrides: Partial<StudioInstanceDetailRecord> = {},
): StudioInstanceDetailRecord {
  const {
    instance: instanceOverride,
    lifecycle: lifecycleOverride,
    dataAccess: dataAccessOverride,
    ...restOverrides
  } = overrides;
  const base = createOpenClawDetail(instanceId);

  return createOpenClawDetail(instanceId, {
    instance: {
      ...base.instance,
      deploymentMode: 'local-external',
      status: 'online',
      ...(instanceOverride || {}),
    },
    lifecycle: {
      ...base.lifecycle,
      configWritable: true,
      ...(lifecycleOverride || {}),
    },
    dataAccess: {
      routes: [
        {
          id: 'config',
          label: 'Configuration',
          scope: 'config',
          mode: 'managedFile',
          status: 'ready',
          target: `D:/OpenClaw/${instanceId}/.openclaw/openclaw.json`,
          readonly: false,
          authoritative: true,
          detail: 'OpenClaw config file is writable.',
          source: 'integration',
        },
      ],
      ...(dataAccessOverride || {}),
    },
    ...restOverrides,
  });
}

function requireParsedOpenClawConfig(raw: string): Record<string, unknown> {
  const parsed = parseOpenClawConfigDocument(raw);
  assert.equal(parsed.parseError, null);
  assert.ok(parsed.parsed);
  return parsed.parsed as Record<string, unknown>;
}

await runTest(
  'getInstanceById preserves runtime deployment and storage metadata for registry-backed fallback callers',
  async () => {
    const instanceRecord = createOpenClawDetail('fallback-metadata').instance;
    const service = createInstanceService({
      studioApi: {
        getInstance: async () => ({
          ...instanceRecord,
          storage: {
            provider: 'remoteApi',
            namespace: 'fallback-metadata',
            endpoint: 'https://gateway.example.com/claw/api',
          },
        }),
      },
    });

    const instance = await service.getInstanceById('fallback-metadata');

    assert.ok(instance);
    assert.equal(instance?.runtimeKind, 'openclaw');
    assert.equal(instance?.deploymentMode, 'remote');
    assert.equal(instance?.transportKind, 'openclawGatewayWs');
    assert.equal(instance?.baseUrl, 'http://10.0.0.8:21280');
    assert.equal(instance?.websocketUrl, 'ws://10.0.0.8:21280');
    assert.equal(instance?.storage?.provider, 'remoteApi');
    assert.equal(instance?.storage?.endpoint, 'https://gateway.example.com/claw/api');
  },
);

await runTest('lifecycle operations reject unsupported instances before calling the studio bridge', async () => {
  const calls: string[] = [];
  const detail = createOpenClawDetail('remote-openclaw', {
    lifecycle: {
      ...createOpenClawDetail('remote-openclaw').lifecycle,
      owner: 'remoteService',
      startStopSupported: false,
      configWritable: false,
    },
  });
  const service = createInstanceService({
    studioApi: {
      getInstanceDetail: async () => detail,
      startInstance: async () => {
        calls.push('start');
        return detail.instance;
      },
      stopInstance: async () => {
        calls.push('stop');
        return detail.instance;
      },
      restartInstance: async () => {
        calls.push('restart');
        return detail.instance;
      },
    },
  });

  await assert.rejects(() => service.startInstance('remote-openclaw'), /lifecycle control/i);
  await assert.rejects(() => service.stopInstance('remote-openclaw'), /lifecycle control/i);
  await assert.rejects(() => service.restartInstance('remote-openclaw'), /lifecycle control/i);
  assert.deepEqual(calls, []);
});

await runTest('lifecycle operations delegate to the studio bridge when the instance is controllable', async () => {
  const calls: string[] = [];
  const detail = createOpenClawDetail(BUILT_IN_INSTANCE_ID, {
    instance: {
      ...createOpenClawDetail(BUILT_IN_INSTANCE_ID).instance,
      isBuiltIn: true,
      isDefault: true,
      deploymentMode: 'local-managed',
      host: '127.0.0.1',
    },
    lifecycle: {
      ...createOpenClawDetail(BUILT_IN_INSTANCE_ID).lifecycle,
      owner: 'appManaged',
      startStopSupported: true,
      configWritable: true,
    },
  });
  const service = createInstanceService({
    studioApi: {
      getInstanceDetail: async () => detail,
      startInstance: async () => {
        calls.push('start');
        return detail.instance;
      },
      stopInstance: async () => {
        calls.push('stop');
        return detail.instance;
      },
      restartInstance: async () => {
        calls.push('restart');
        return detail.instance;
      },
    },
  });

  await service.startInstance(BUILT_IN_INSTANCE_ID);
  await service.stopInstance(BUILT_IN_INSTANCE_ID);
  await service.restartInstance(BUILT_IN_INSTANCE_ID);
  assert.deepEqual(calls, ['start', 'stop', 'restart']);
});

await runTest('deleteInstance rejects built-in managed instances before calling the studio bridge', async () => {
  let deleteCalls = 0;
  const detail = createOpenClawDetail(BUILT_IN_INSTANCE_ID, {
    instance: {
      ...createOpenClawDetail(BUILT_IN_INSTANCE_ID).instance,
      isBuiltIn: true,
      isDefault: true,
      deploymentMode: 'local-managed',
      host: '127.0.0.1',
    },
    lifecycle: {
      ...createOpenClawDetail(BUILT_IN_INSTANCE_ID).lifecycle,
      owner: 'appManaged',
      startStopSupported: true,
      configWritable: true,
      workbenchManaged: true,
      lifecycleControllable: true,
    },
  });
  const service = createInstanceService({
    studioApi: {
      getInstanceDetail: async () => detail,
      deleteInstance: async () => {
        deleteCalls += 1;
        return true;
      },
    },
  });

  await assert.rejects(
    () => service.deleteInstance(BUILT_IN_INSTANCE_ID),
    /built-in|uninstall|delete/i,
  );
  assert.equal(deleteCalls, 0);
});

await runTest(
  'instance service allows local-managed Hermes instances and forwards them to the studio bridge',
  async () => {
    let createCalls = 0;
    const service = createInstanceService({
      studioApi: {
        createInstance: async (input) => {
          createCalls += 1;
          return createOpenClawDetail('hermes-local-managed', {
            instance: {
              ...createOpenClawDetail('hermes-local-managed').instance,
              name: input.name,
              description: input.description ?? 'Managed Hermes runtime.',
              runtimeKind: 'hermes',
              deploymentMode: 'local-managed',
              transportKind: 'customHttp',
              typeLabel: input.typeLabel ?? 'Hermes Agent',
              host: input.host ?? '127.0.0.1',
              port: input.port ?? 19540,
              baseUrl: input.baseUrl ?? 'http://127.0.0.1:19540',
              websocketUrl: input.websocketUrl ?? null,
              isBuiltIn: false,
              isDefault: false,
              capabilities: ['chat', 'health', 'files', 'memory', 'tools', 'models'],
              config: {
                port: String(input.port ?? 19540),
                sandbox: true,
                autoUpdate: false,
                logLevel: 'info',
                corsOrigins: '*',
                baseUrl: input.baseUrl ?? 'http://127.0.0.1:19540',
                websocketUrl: input.websocketUrl ?? null,
              },
            },
          }).instance;
        },
      },
    });

    const created = await service.create({
      name: 'Hermes Local Managed',
      type: 'Hermes Agent',
      runtimeKind: 'hermes',
      deploymentMode: 'local-managed',
      transportKind: 'customHttp',
      host: '127.0.0.1',
      port: 19540,
      baseUrl: 'http://127.0.0.1:19540',
    });

    assert.equal(created.runtimeKind, 'hermes');
    assert.equal(created.deploymentMode, 'local-managed');
    assert.equal(created.type, 'Hermes Agent');
    assert.equal(createCalls, 1);
  },
);

await runTest('updateInstanceFileContent routes built-in OpenClaw writes through the studio bridge', async () => {
  const calls: Array<[string, string, string]> = [];
  const service = createInstanceService({
    studioApi: {
      getInstanceDetail: async () =>
        createOpenClawDetail(BUILT_IN_INSTANCE_ID, {
          instance: {
            ...createOpenClawDetail(BUILT_IN_INSTANCE_ID).instance,
            isBuiltIn: true,
            isDefault: true,
            deploymentMode: 'local-managed',
            host: '127.0.0.1',
          },
        }),
      updateInstanceFileContent: async (instanceId, fileId, content) => {
        calls.push([instanceId, fileId, content]);
        return true;
      },
    },
    openClawGatewayClient: {
      setAgentFile: async () => {
        throw new Error('gateway file write should not be used for built-in OpenClaw');
      },
    },
  });

  await service.updateInstanceFileContent(BUILT_IN_INSTANCE_ID, '/workspace/main/AGENTS.md', '# updated');

  assert.deepEqual(calls, [[BUILT_IN_INSTANCE_ID, '/workspace/main/AGENTS.md', '# updated']]);
});

await runTest(
  'updateInstanceFileContent does not infer built-in OpenClaw writes from deployment metadata alone',
  async () => {
    const calls: Array<[string, string, string]> = [];
    const service = createInstanceService({
      studioApi: {
        getInstanceDetail: async () =>
          createOpenClawDetail('legacy-shaped-built-in', {
            instance: {
              ...createOpenClawDetail('legacy-shaped-built-in').instance,
              isBuiltIn: true,
              isDefault: true,
              deploymentMode: 'local-managed',
              host: '127.0.0.1',
            },
            lifecycle: {
              owner: 'appManaged',
              startStopSupported: false,
              configWritable: false,
              workbenchManaged: undefined,
              endpointObserved: undefined,
              lifecycleControllable: undefined,
              notes: [],
            },
            workbench: {
              files: [
                {
                  id: '/workspace/main/AGENTS.md',
                  name: 'AGENTS.md',
                  path: '/workspace/main/AGENTS.md',
                  category: 'prompt',
                  language: 'markdown',
                  size: '1 KB',
                  updatedAt: '2026-04-05T00:00:00.000Z',
                  status: 'synced',
                  description: 'Legacy-shaped file snapshot.',
                  content: '# legacy',
                  isReadonly: false,
                },
              ],
              llmProviders: [],
            } as any,
          }),
        updateInstanceFileContent: async (instanceId, fileId, content) => {
          calls.push([instanceId, fileId, content]);
          return true;
        },
      },
    });

    await assert.rejects(
      () =>
        service.updateInstanceFileContent(
          'legacy-shaped-built-in',
          '/workspace/main/AGENTS.md',
          '# updated',
        ),
      /not writable through the gateway/i,
    );
    assert.deepEqual(calls, []);
  },
);

await runTest('updateInstanceFileContent routes backend-authored non-OpenClaw writes through the studio bridge', async () => {
  const calls: Array<[string, string, string]> = [];
  const service = createInstanceService({
    studioApi: {
      getInstanceDetail: async () =>
        createCustomDetail('custom-runtime', {
          workbench: {
            channels: [],
            cronTasks: {
              tasks: [],
              taskExecutionsById: {},
            },
            llmProviders: [],
            agents: [],
            skills: [],
            files: [
              {
                id: 'project-plan.md',
                name: 'project-plan.md',
                path: '/workspace/project-plan.md',
                category: 'prompt',
                language: 'markdown',
                size: '1 KB',
                updatedAt: '2025-03-19T00:00:00.000Z',
                status: 'synced',
                description: 'Backend-authored project plan.',
                content: '# original',
                isReadonly: false,
              },
            ],
            memory: [],
            tools: [],
          },
        }),
      updateInstanceFileContent: async (instanceId, fileId, content) => {
        calls.push([instanceId, fileId, content]);
        return true;
      },
    },
    openClawGatewayClient: {
      setAgentFile: async () => {
        throw new Error('gateway file write should not be used for non-OpenClaw instances');
      },
    },
  });

  await service.updateInstanceFileContent('custom-runtime', 'project-plan.md', '# updated');

  assert.deepEqual(calls, [['custom-runtime', 'project-plan.md', '# updated']]);
});

await runTest('updateInstanceFileContent routes remote OpenClaw agent files through the gateway client', async () => {
  const calls: Array<[string, string, string, string]> = [];
  const service = createInstanceService({
    studioApi: {
      getInstanceDetail: async () => createOpenClawDetail('remote-openclaw'),
    },
    openClawGatewayClient: {
      setAgentFile: async (instanceId, args) => {
        calls.push([instanceId, args.agentId, args.name, args.content]);
        return {
          ok: true,
          agentId: args.agentId,
        };
      },
    },
  });

  await service.updateInstanceFileContent(
    'remote-openclaw',
    buildOpenClawAgentFileId('ops', 'AGENTS.md'),
    '# remote update',
  );

  assert.deepEqual(calls, [['remote-openclaw', 'ops', 'AGENTS.md', '# remote update']]);
});

await runTest('getInstanceFileContent routes remote OpenClaw agent file reads through the gateway client', async () => {
  const calls: Array<[string, string, string]> = [];
  const service = createInstanceService({
    studioApi: {
      getInstanceDetail: async () => createOpenClawDetail('remote-openclaw'),
    },
    openClawGatewayClient: {
      getAgentFile: async (instanceId, args) => {
        calls.push([instanceId, args.agentId, args.name]);
        return {
          agentId: args.agentId,
          file: {
            name: args.name,
            path: `/workspace/${args.agentId}/${args.name}`,
            content: '# remote content',
          },
        };
      },
    },
  });

  const content = await service.getInstanceFileContent(
    'remote-openclaw',
    buildOpenClawAgentFileId('ops', 'AGENTS.md'),
  );

  assert.equal(content, '# remote content');
  assert.deepEqual(calls, [['remote-openclaw', 'ops', 'AGENTS.md']]);
});

await runTest(
  'getInstanceFileContent normalizes backend-authored OpenClaw file ids before gateway reads',
  async () => {
    const calls: Array<[string, string, string]> = [];
    const service = createInstanceService({
      studioApi: {
        getInstanceDetail: async () => createOpenClawDetail('remote-openclaw'),
      },
      openClawGatewayClient: {
        getAgentFile: async (instanceId, args) => {
          calls.push([instanceId, args.agentId, args.name]);
          return {
            agentId: args.agentId,
            file: {
              name: args.name,
              path: `/workspace/${args.agentId}/${args.name}`,
              content: '# normalized remote content',
            },
          };
        },
      },
    });

    const content = await service.getInstanceFileContent(
      'remote-openclaw',
      buildOpenClawAgentFileId('Research Team', 'AGENTS.md'),
    );

    assert.equal(content, '# normalized remote content');
    assert.deepEqual(calls, [['remote-openclaw', 'research-team', 'AGENTS.md']]);
  },
);

await runTest('getInstanceFileContent returns built-in workbench file content without gateway reads', async () => {
  const service = createInstanceService({
    studioApi: {
      getInstanceDetail: async () =>
        createOpenClawDetail(BUILT_IN_INSTANCE_ID, {
          instance: {
            ...createOpenClawDetail(BUILT_IN_INSTANCE_ID).instance,
            isBuiltIn: true,
            isDefault: true,
            deploymentMode: 'local-managed',
            host: '127.0.0.1',
          },
          workbench: {
            channels: [],
            cronTasks: {
              tasks: [],
              taskExecutionsById: {},
            },
            llmProviders: [],
            agents: [],
            skills: [],
            files: [
              {
                id: '/workspace/main/AGENTS.md',
                name: 'AGENTS.md',
                path: '/workspace/main/AGENTS.md',
                category: 'prompt',
                language: 'markdown',
                size: '1 KB',
                updatedAt: '2025-03-19T00:00:00.000Z',
                status: 'synced',
                description: 'Built-in file',
                content: '# built-in content',
                isReadonly: false,
              },
            ],
            memory: [],
            tools: [],
          },
        }),
    },
    openClawGatewayClient: {
      getAgentFile: async () => {
        throw new Error('gateway file read should not be used for built-in OpenClaw');
      },
    },
  });

  const content = await service.getInstanceFileContent(
    BUILT_IN_INSTANCE_ID,
    '/workspace/main/AGENTS.md',
  );

  assert.equal(content, '# built-in content');
});

await runTest(
  'getOpenClawConfigDocument keeps the canonical config API available for config-backed OpenClaw instances',
  async () => {
    const calls: string[] = [];
    const service = createInstanceService({
      studioApi: {
        getInstanceDetail: async () =>
          createConfigBackedOpenClawDetail('managed-openclaw'),
      },
      openClawGatewayClient: {
        getConfig: async (instanceId: string) => {
          calls.push(instanceId);
          return {
            config: {
              agents: {
                defaults: {
                  primary: 'ops',
                },
              },
            },
          };
        },
      },
    });

    const raw = await service.getOpenClawConfigDocument('managed-openclaw');

    assert.deepEqual(calls, ['managed-openclaw']);
    assert.deepEqual(requireParsedOpenClawConfig(raw), {
      agents: {
        defaults: {
          primary: 'ops',
        },
      },
    });
  },
);

await runTest(
  'getOpenClawConfigDocument prefers the built-in gateway bridge when built-in runtime status projection lags behind',
  async () => {
    const calls: string[] = [];
    const service = createInstanceService({
      studioApi: {
      getInstanceDetail: async () =>
        createOpenClawDetail(BUILT_IN_INSTANCE_ID, {
          instance: {
            ...createOpenClawDetail(BUILT_IN_INSTANCE_ID).instance,
            status: 'offline',
              isBuiltIn: true,
              isDefault: true,
              deploymentMode: 'local-managed',
              host: '127.0.0.1',
              baseUrl: 'http://127.0.0.1:21280',
              websocketUrl: 'ws://127.0.0.1:21280',
            },
            lifecycle: {
              owner: 'appManaged',
              startStopSupported: true,
              configWritable: true,
              workbenchManaged: true,
              endpointObserved: true,
              lifecycleControllable: true,
              notes: [],
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
                  detail: 'Built-in OpenClaw config file.',
                  source: 'integration',
                },
              ],
            },
          }),
      },
      openClawGatewayClient: {
        getConfig: async (instanceId: string) => {
          calls.push(instanceId);
          return {
            config: {
              agents: {
                defaults: {
                  primary: 'ops',
                },
              },
            },
          };
        },
      },
    });

    const raw = await service.getOpenClawConfigDocument(BUILT_IN_INSTANCE_ID);

    assert.deepEqual(calls, [BUILT_IN_INSTANCE_ID]);
    assert.deepEqual(requireParsedOpenClawConfig(raw), {
      agents: {
        defaults: {
          primary: 'ops',
        },
      },
    });
  },
);

await runTest(
  'getOpenClawConfigDocument reads the attached openclaw.json for config-backed OpenClaw instances when the gateway is unavailable',
  async () => {
    const calls: string[] = [];
    const service = createInstanceService({
      studioApi: {
        getInstanceDetail: async () =>
          createOpenClawDetail('managed-openclaw', {
            instance: {
              ...createOpenClawDetail('managed-openclaw').instance,
              deploymentMode: 'local-external',
              status: 'offline',
            },
            lifecycle: {
              ...createOpenClawDetail('managed-openclaw').lifecycle,
              configWritable: false,
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
                  readonly: true,
                  authoritative: true,
                  detail: 'OpenClaw config file is readable.',
                  source: 'integration',
                },
              ],
            },
          }),
      },
      openClawConfigDocumentApi: {
        readConfigDocument: async (configPath: string) => {
          calls.push(configPath);
          return '{\n  "agents": {}\n}\n';
        },
      },
    });

    const content = await service.getOpenClawConfigDocument('managed-openclaw');

    assert.equal(content, '{\n  "agents": {}\n}\n');
    assert.deepEqual(calls, ['D:/OpenClaw/.openclaw/openclaw.json']);
  },
);

await runTest(
  'getOpenClawConfigDocument reports a product-level error when the attached config file is missing offline',
  async () => {
    const service = createInstanceService({
      studioApi: {
        getInstanceDetail: async () =>
          createOpenClawDetail('missing-config-openclaw', {
            instance: {
              ...createOpenClawDetail('missing-config-openclaw').instance,
              deploymentMode: 'local-external',
              status: 'offline',
            },
            lifecycle: {
              ...createOpenClawDetail('missing-config-openclaw').lifecycle,
              configWritable: false,
            },
            dataAccess: {
              routes: [
                {
                  id: 'config',
                  label: 'Configuration',
                  scope: 'config',
                  mode: 'managedFile',
                  status: 'ready',
                  target: 'D:/Missing/.openclaw/openclaw.json',
                  readonly: true,
                  authoritative: true,
                  detail: 'OpenClaw config file is readable.',
                  source: 'integration',
                },
              ],
            },
          }),
      },
      openClawConfigDocumentApi: {
        getConfigDocumentPathInfo: async (configPath: string) => ({
          path: configPath,
          name: 'openclaw.json',
          kind: 'missing' as const,
          size: null,
          extension: '.json',
          exists: false,
          lastModifiedMs: null,
        }),
        readConfigDocument: async () => {
          throw new Error(
            'filesystem.readTextFile failed for read_text_file: io error: 绯荤粺鎵句笉鍒版寚瀹氱殑鏂囦欢銆?(os error 2)',
          );
        },
      },
    });

    await assert.rejects(
      () => service.getOpenClawConfigDocument('missing-config-openclaw'),
      /attached OpenClaw config file is no longer available on disk/i,
    );
  },
);

await runTest(
  'getOpenClawConfigDocument reads the OpenClaw config through the gateway when the gateway is ready',
  async () => {
    const fileCalls: string[] = [];
    const gatewayCalls: string[] = [];
    const expectedRoot = {
      agents: {
        defaults: {
          model: {
            primary: 'openai/gpt-5.4',
          },
        },
      },
    };
    const service = createInstanceService({
      studioApi: {
        getInstanceDetail: async () =>
          createOpenClawDetail('managed-openclaw', {
            instance: {
              ...createOpenClawDetail('managed-openclaw').instance,
              deploymentMode: 'local-external',
              status: 'online',
            },
            lifecycle: {
              ...createOpenClawDetail('managed-openclaw').lifecycle,
              configWritable: false,
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
                  readonly: true,
                  authoritative: true,
                  detail: 'OpenClaw config file is readable.',
                  source: 'integration',
                },
              ],
            },
          }),
      },
      openClawGatewayClient: {
        getConfig: async (instanceId: string) => {
          gatewayCalls.push(instanceId);
          return {
            baseHash: 'hash-1',
            config: expectedRoot,
          };
        },
      },
      openClawConfigDocumentApi: {
        readConfigDocument: async (configPath: string) => {
          fileCalls.push(configPath);
          throw new Error('platform file read should not be used when gateway is ready');
        },
      },
    });

    const content = await service.getOpenClawConfigDocument('managed-openclaw');

    assert.equal(content, serializeOpenClawConfigDocument(expectedRoot));
    assert.deepEqual(gatewayCalls, ['managed-openclaw']);
    assert.deepEqual(fileCalls, []);
  },
);

await runTest(
  'getOpenClawConfigDocument ignores config artifacts when config access is metadata-only',
  async () => {
    const calls: string[] = [];
    const service = createInstanceService({
      studioApi: {
        getInstanceDetail: async () =>
          createOpenClawDetail('metadata-only-openclaw', {
            instance: {
              ...createOpenClawDetail('metadata-only-openclaw').instance,
              deploymentMode: 'remote',
            },
            lifecycle: {
              ...createOpenClawDetail('metadata-only-openclaw').lifecycle,
              configWritable: false,
            },
            dataAccess: {
              routes: [
                {
                  id: 'config',
                  label: 'Configuration',
                  scope: 'config',
                  mode: 'metadataOnly',
                  status: 'ready',
                  target: 'studio.instances registry metadata',
                  readonly: false,
                  authoritative: false,
                  detail: 'Metadata projection only.',
                  source: 'integration',
                },
              ],
            },
            artifacts: [
              {
                id: 'config-file',
                label: 'Config File',
                kind: 'configFile',
                status: 'available',
                location: 'D:/Shadow/.openclaw/openclaw.json',
                readonly: false,
                detail: 'Artifact path should not override metadata-only config access.',
                source: 'config',
              },
            ],
          }),
      },
      openClawConfigDocumentApi: {
        readConfigDocument: async (configPath: string) => {
          calls.push(configPath);
          return '{}';
        },
      },
    });

    await assert.rejects(
      () => service.getOpenClawConfigDocument('metadata-only-openclaw'),
      /does not expose an attached OpenClaw config file/i,
    );
    assert.deepEqual(calls, []);
  },
);

await runTest(
  'updateOpenClawConfigDocument writes the attached openclaw.json for config-backed OpenClaw instances when the gateway is unavailable',
  async () => {
    const calls: Array<[string, string]> = [];
    const service = createInstanceService({
      studioApi: {
        getInstanceDetail: async () =>
          createOpenClawDetail('managed-openclaw', {
            instance: {
              ...createOpenClawDetail('managed-openclaw').instance,
              deploymentMode: 'local-external',
              status: 'offline',
            },
            lifecycle: {
              ...createOpenClawDetail('managed-openclaw').lifecycle,
              configWritable: true,
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
                  detail: 'OpenClaw config file is writable.',
                  source: 'integration',
                },
              ],
            },
          }),
      },
      openClawConfigDocumentApi: {
        writeConfigDocument: async (configPath: string, raw: string) => {
          calls.push([configPath, raw]);
        },
      },
    });

    await service.updateOpenClawConfigDocument(
      'managed-openclaw',
      '{\n  "tools": {}\n}\n',
    );

    assert.deepEqual(calls, [['D:/OpenClaw/.openclaw/openclaw.json', '{\n  "tools": {}\n}\n']]);
  },
);

await runTest(
  'updateOpenClawConfigDocument saves the OpenClaw config through the gateway when the gateway is ready',
  async () => {
    const fileCalls: Array<[string, string]> = [];
    const gatewaySnapshotCalls: string[] = [];
    const gatewayWriteCalls: Array<[
      string,
      {
        raw: string;
        baseHash?: string;
      },
    ]> = [];
    const nextRaw = '{\n  "tools": {}\n}\n';
    const service = createInstanceService({
      studioApi: {
        getInstanceDetail: async () =>
          createOpenClawDetail('managed-openclaw', {
            instance: {
              ...createOpenClawDetail('managed-openclaw').instance,
              deploymentMode: 'local-external',
              status: 'online',
            },
            lifecycle: {
              ...createOpenClawDetail('managed-openclaw').lifecycle,
              configWritable: true,
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
                  detail: 'OpenClaw config file is writable.',
                  source: 'integration',
                },
              ],
            },
          }),
      },
      openClawGatewayClient: {
        getConfig: async (instanceId: string) => {
          gatewaySnapshotCalls.push(instanceId);
          return {
            baseHash: 'hash-1',
            config: {
              tools: {},
            },
          };
        },
        setConfig: async (
          instanceId: string,
          args: {
            raw: string;
            baseHash?: string;
          },
        ) => {
          gatewayWriteCalls.push([instanceId, args]);
          return {
            ok: true,
            path: 'D:/OpenClaw/.openclaw/openclaw.json',
          };
        },
      },
      openClawConfigDocumentApi: {
        writeConfigDocument: async (configPath: string, raw: string) => {
          fileCalls.push([configPath, raw]);
          throw new Error('platform file write should not be used when gateway is ready');
        },
      },
    });

    await service.updateOpenClawConfigDocument('managed-openclaw', nextRaw);

    assert.deepEqual(gatewaySnapshotCalls, ['managed-openclaw']);
    assert.deepEqual(gatewayWriteCalls, [['managed-openclaw', { raw: nextRaw, baseHash: 'hash-1' }]]);
    assert.deepEqual(fileCalls, []);
  },
);

await runTest(
  'createOpenClawAgent saves the OpenClaw config through the gateway when the gateway is ready',
  async () => {
    const fileCalls: string[] = [];
    const gatewaySnapshotCalls: string[] = [];
    const gatewayWriteCalls: Array<[string, { raw: string; baseHash?: string }]> = [];
    const service = createInstanceService({
      studioApi: {
        getInstanceDetail: async () =>
          createConfigBackedOpenClawDetail('managed-openclaw'),
      },
      openClawGatewayClient: {
        getConfig: async (instanceId: string) => {
          gatewaySnapshotCalls.push(instanceId);
          return {
            baseHash: 'hash-agent-create',
            config: {},
          };
        },
        setConfig: async (instanceId: string, args) => {
          gatewayWriteCalls.push([instanceId, args]);
          return {
            ok: true,
          };
        },
      },
      openClawConfigDocumentApi: {
        saveAgent: async () => {
          fileCalls.push('saveAgent');
          throw new Error('platform config save should not be used when gateway is ready');
        },
      },
    });

    await service.createOpenClawAgent('managed-openclaw', {
      id: 'ops',
      name: 'Ops Agent',
      workspace: './workspace/ops',
      agentDir: 'agents/ops/agent',
      isDefault: true,
    });

    assert.deepEqual(gatewaySnapshotCalls, ['managed-openclaw']);
    assert.equal(gatewayWriteCalls.length, 1);
    assert.deepEqual(fileCalls, []);
    assert.equal(gatewayWriteCalls[0]?.[1].baseHash, 'hash-agent-create');
    assert.deepEqual(requireParsedOpenClawConfig(gatewayWriteCalls[0]![1].raw), {
      agents: {
        list: [
          {
            id: 'ops',
            name: 'Ops Agent',
            workspace: './workspace/ops',
            agentDir: 'agents/ops/agent',
            default: true,
          },
        ],
      },
    });
  },
);

await runTest(
  'createOpenClawAgent writes through the local config file service with configFile when the gateway is unavailable',
  async () => {
    const saveCalls: Array<{ configFile: string; agent: Record<string, unknown> }> = [];
    const service = createInstanceService({
      studioApi: {
        getInstanceDetail: async () =>
          createConfigBackedOpenClawDetail('managed-openclaw', {
            instance: {
              ...createConfigBackedOpenClawDetail('managed-openclaw').instance,
              status: 'offline',
            },
          }),
      },
      openClawGatewayClient: {
        getConfig: async () => {
          throw new Error('gateway should not be used while offline');
        },
      },
      openClawConfigDocumentApi: {
        saveAgent: async (input) => {
          saveCalls.push(input as any);
          return null;
        },
      },
    });

    await service.createOpenClawAgent('managed-openclaw', {
      id: 'ops',
      name: 'Ops Agent',
      workspace: './workspace/ops',
      agentDir: 'agents/ops/agent',
      isDefault: true,
    });

    assert.deepEqual(saveCalls, [
      {
        configFile: 'D:/OpenClaw/managed-openclaw/.openclaw/openclaw.json',
        agent: {
          id: 'ops',
          name: 'Ops Agent',
          workspace: './workspace/ops',
          agentDir: 'agents/ops/agent',
          isDefault: true,
        },
      },
    ]);
    assert.equal('configPath' in (saveCalls[0] || {}), false);
  },
);

await runTest(
  'deleteOpenClawAgent saves the OpenClaw config through the gateway when the gateway is ready',
  async () => {
    const fileCalls: string[] = [];
    const gatewaySnapshotCalls: string[] = [];
    const gatewayWriteCalls: Array<[string, { raw: string; baseHash?: string }]> = [];
    const service = createInstanceService({
      studioApi: {
        getInstanceDetail: async () =>
          createConfigBackedOpenClawDetail('managed-openclaw'),
      },
      openClawGatewayClient: {
        getConfig: async (instanceId: string) => {
          gatewaySnapshotCalls.push(instanceId);
          return {
            baseHash: 'hash-agent-delete',
            config: {
              agents: {
                list: [
                  {
                    id: 'ops',
                    name: 'Ops Agent',
                    default: true,
                  },
                  {
                    id: 'reviewer',
                    name: 'Reviewer',
                  },
                ],
              },
            },
          };
        },
        setConfig: async (instanceId: string, args) => {
          gatewayWriteCalls.push([instanceId, args]);
          return {
            ok: true,
          };
        },
      },
      openClawConfigDocumentApi: {
        deleteAgent: async () => {
          fileCalls.push('deleteAgent');
          throw new Error('platform config delete should not be used when gateway is ready');
        },
      },
    });

    await service.deleteOpenClawAgent('managed-openclaw', 'ops');

    assert.deepEqual(gatewaySnapshotCalls, ['managed-openclaw']);
    assert.equal(gatewayWriteCalls.length, 1);
    assert.deepEqual(fileCalls, []);
    assert.equal(gatewayWriteCalls[0]?.[1].baseHash, 'hash-agent-delete');
    assert.deepEqual(requireParsedOpenClawConfig(gatewayWriteCalls[0]![1].raw), {
      agents: {
        list: [
          {
            id: 'reviewer',
            name: 'Reviewer',
            default: true,
          },
        ],
      },
    });
  },
);

await runTest(
  'deleteOpenClawAgent writes through the local config file service with configFile when the gateway is unavailable',
  async () => {
    const deleteCalls: Array<{ configFile: string; agentId: string }> = [];
    const service = createInstanceService({
      studioApi: {
        getInstanceDetail: async () =>
          createConfigBackedOpenClawDetail('managed-openclaw', {
            instance: {
              ...createConfigBackedOpenClawDetail('managed-openclaw').instance,
              status: 'offline',
            },
          }),
      },
      openClawGatewayClient: {
        getConfig: async () => {
          throw new Error('gateway should not be used while offline');
        },
      },
      openClawConfigDocumentApi: {
        deleteAgent: async (input) => {
          deleteCalls.push(input as any);
          return [];
        },
      },
    });

    await service.deleteOpenClawAgent('managed-openclaw', 'ops');

    assert.deepEqual(deleteCalls, [
      {
        configFile: 'D:/OpenClaw/managed-openclaw/.openclaw/openclaw.json',
        agentId: 'ops',
      },
    ]);
    assert.equal('configPath' in (deleteCalls[0] || {}), false);
  },
);

await runTest(
  'saveOpenClawChannelConfig saves the OpenClaw config through the gateway when the gateway is ready',
  async () => {
    const fileCalls: string[] = [];
    const gatewaySnapshotCalls: string[] = [];
    const gatewayWriteCalls: Array<[string, { raw: string; baseHash?: string }]> = [];
    const service = createInstanceService({
      studioApi: {
        getInstanceDetail: async () =>
          createConfigBackedOpenClawDetail('managed-openclaw'),
      },
      openClawGatewayClient: {
        getConfig: async (instanceId: string) => {
          gatewaySnapshotCalls.push(instanceId);
          return {
            baseHash: 'hash-channel-save',
            config: {},
          };
        },
        setConfig: async (instanceId: string, args) => {
          gatewayWriteCalls.push([instanceId, args]);
          return {
            ok: true,
          };
        },
      },
      openClawConfigDocumentApi: {
        saveChannelConfiguration: async () => {
          fileCalls.push('saveChannelConfiguration');
          throw new Error('platform channel save should not be used when gateway is ready');
        },
      },
    });

    await service.saveOpenClawChannelConfig('managed-openclaw', 'telegram', {
      botToken: '123456:telegram-token',
      webhookUrl: 'https://example.com/telegram/webhook',
    });

    assert.deepEqual(gatewaySnapshotCalls, ['managed-openclaw']);
    assert.equal(gatewayWriteCalls.length, 1);
    assert.deepEqual(fileCalls, []);
    assert.equal(gatewayWriteCalls[0]?.[1].baseHash, 'hash-channel-save');
    assert.deepEqual(requireParsedOpenClawConfig(gatewayWriteCalls[0]![1].raw), {
      channels: {
        telegram: {
          botToken: '123456:telegram-token',
          webhookUrl: 'https://example.com/telegram/webhook',
          enabled: true,
        },
      },
    });
  },
);

await runTest(
  'saveOpenClawWebSearchConfig saves the OpenClaw config through the gateway when the gateway is ready',
  async () => {
    const fileCalls: string[] = [];
    const gatewaySnapshotCalls: string[] = [];
    const gatewayWriteCalls: Array<[string, { raw: string; baseHash?: string }]> = [];
    const service = createInstanceService({
      studioApi: {
        getInstanceDetail: async () =>
          createConfigBackedOpenClawDetail('managed-openclaw'),
      },
      openClawGatewayClient: {
        getConfig: async (instanceId: string) => {
          gatewaySnapshotCalls.push(instanceId);
          return {
            baseHash: 'hash-web-search',
            config: {},
          };
        },
        setConfig: async (instanceId: string, args) => {
          gatewayWriteCalls.push([instanceId, args]);
          return {
            ok: true,
          };
        },
      },
      openClawConfigDocumentApi: {
        saveWebSearchConfiguration: async () => {
          fileCalls.push('saveWebSearchConfiguration');
          throw new Error('platform web search save should not be used when gateway is ready');
        },
      },
    });

    await service.saveOpenClawWebSearchConfig('managed-openclaw', {
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

    assert.deepEqual(gatewaySnapshotCalls, ['managed-openclaw']);
    assert.equal(gatewayWriteCalls.length, 1);
    assert.deepEqual(fileCalls, []);
    assert.equal(gatewayWriteCalls[0]?.[1].baseHash, 'hash-web-search');
    assert.deepEqual(requireParsedOpenClawConfig(gatewayWriteCalls[0]![1].raw), {
      tools: {
        web: {
          search: {
            enabled: true,
            provider: 'searxng',
            maxResults: 12,
            timeoutSeconds: 60,
            cacheTtlMinutes: 20,
          },
        },
      },
      plugins: {
        entries: {
          searxng: {
            config: {
              webSearch: {
                baseUrl: 'http://search.internal:8080',
                categories: 'general',
                language: 'en',
              },
            },
          },
        },
      },
    });
  },
);

await runTest(
  'saveOpenClawWebFetchConfig saves the OpenClaw config through the gateway when the gateway is ready',
  async () => {
    const fileCalls: string[] = [];
    const gatewaySnapshotCalls: string[] = [];
    const gatewayWriteCalls: Array<[string, { raw: string; baseHash?: string }]> = [];
    const service = createInstanceService({
      studioApi: {
        getInstanceDetail: async () =>
          createConfigBackedOpenClawDetail('managed-openclaw'),
      },
      openClawGatewayClient: {
        getConfig: async (instanceId: string) => {
          gatewaySnapshotCalls.push(instanceId);
          return {
            baseHash: 'hash-web-fetch',
            config: {
              plugins: {
                entries: {
                  firecrawl: {
                    config: {
                      webSearch: {
                        apiKey: 'fc-search-live',
                      },
                    },
                  },
                },
              },
            },
          };
        },
        setConfig: async (instanceId: string, args) => {
          gatewayWriteCalls.push([instanceId, args]);
          return {
            ok: true,
          };
        },
      },
      openClawConfigDocumentApi: {
        saveWebFetchConfiguration: async () => {
          fileCalls.push('saveWebFetchConfiguration');
          throw new Error('platform web fetch save should not be used when gateway is ready');
        },
      },
    });

    await service.saveOpenClawWebFetchConfig('managed-openclaw', {
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
        apiKeySource: 'fc-live',
        baseUrl: 'https://api.firecrawl.dev',
        advancedConfig: `{
  "onlyMainContent": true,
  "maxAgeMs": 86400000,
  "timeoutSeconds": 60
}`,
      },
    });

    assert.deepEqual(gatewaySnapshotCalls, ['managed-openclaw']);
    assert.equal(gatewayWriteCalls.length, 1);
    assert.deepEqual(fileCalls, []);
    assert.equal(gatewayWriteCalls[0]?.[1].baseHash, 'hash-web-fetch');
    assert.deepEqual(requireParsedOpenClawConfig(gatewayWriteCalls[0]![1].raw), {
      tools: {
        web: {
          fetch: {
            enabled: true,
            maxChars: 42000,
            maxCharsCap: 64000,
            maxResponseBytes: 2500000,
            timeoutSeconds: 28,
            cacheTtlMinutes: 9,
            maxRedirects: 4,
            readability: false,
            userAgent: 'SDKWork Fetch Bot/1.0',
          },
        },
      },
      plugins: {
        entries: {
          firecrawl: {
            config: {
              webSearch: {
                apiKey: 'fc-search-live',
              },
              webFetch: {
                apiKey: 'fc-live',
                baseUrl: 'https://api.firecrawl.dev',
                onlyMainContent: true,
                maxAgeMs: 86400000,
                timeoutSeconds: 60,
              },
            },
          },
        },
      },
    });
  },
);

await runTest(
  'saveOpenClawXSearchConfig saves the OpenClaw config through the gateway when the gateway is ready',
  async () => {
    const fileCalls: string[] = [];
    const gatewaySnapshotCalls: string[] = [];
    const gatewayWriteCalls: Array<[string, { raw: string; baseHash?: string }]> = [];
    const service = createInstanceService({
      studioApi: {
        getInstanceDetail: async () =>
          createConfigBackedOpenClawDetail('managed-openclaw'),
      },
      openClawGatewayClient: {
        getConfig: async (instanceId: string) => {
          gatewaySnapshotCalls.push(instanceId);
          return {
            baseHash: 'hash-x-search',
            config: {
              plugins: {
                entries: {
                  xai: {
                    config: {
                      webSearch: {
                        model: 'grok-4-fast',
                      },
                    },
                  },
                },
              },
            },
          };
        },
        setConfig: async (instanceId: string, args) => {
          gatewayWriteCalls.push([instanceId, args]);
          return {
            ok: true,
          };
        },
      },
      openClawConfigDocumentApi: {
        saveXSearchConfiguration: async () => {
          fileCalls.push('saveXSearchConfiguration');
          throw new Error('platform x_search save should not be used when gateway is ready');
        },
      },
    });

    await service.saveOpenClawXSearchConfig('managed-openclaw', {
      enabled: true,
      apiKeySource: 'xai-live',
      model: 'grok-4-1-fast-non-reasoning',
      inlineCitations: false,
      maxTurns: 3,
      timeoutSeconds: 45,
      cacheTtlMinutes: 18,
      advancedConfig: `{
  "userTag": "internal-research"
}`,
    });

    assert.deepEqual(gatewaySnapshotCalls, ['managed-openclaw']);
    assert.equal(gatewayWriteCalls.length, 1);
    assert.deepEqual(fileCalls, []);
    assert.equal(gatewayWriteCalls[0]?.[1].baseHash, 'hash-x-search');
    assert.deepEqual(requireParsedOpenClawConfig(gatewayWriteCalls[0]![1].raw), {
      plugins: {
        entries: {
          xai: {
            config: {
              webSearch: {
                model: 'grok-4-fast',
                apiKey: 'xai-live',
              },
              xSearch: {
                enabled: true,
                model: 'grok-4-1-fast-non-reasoning',
                inlineCitations: false,
                maxTurns: 3,
                timeoutSeconds: 45,
                cacheTtlMinutes: 18,
                userTag: 'internal-research',
              },
            },
          },
        },
      },
    });
  },
);

await runTest(
  'saveOpenClawWebSearchNativeCodexConfig saves the OpenClaw config through the gateway when the gateway is ready',
  async () => {
    const fileCalls: string[] = [];
    const gatewaySnapshotCalls: string[] = [];
    const gatewayWriteCalls: Array<[string, { raw: string; baseHash?: string }]> = [];
    const service = createInstanceService({
      studioApi: {
        getInstanceDetail: async () =>
          createConfigBackedOpenClawDetail('managed-openclaw'),
      },
      openClawGatewayClient: {
        getConfig: async (instanceId: string) => {
          gatewaySnapshotCalls.push(instanceId);
          return {
            baseHash: 'hash-codex-search',
            config: {
              tools: {
                web: {
                  search: {
                    enabled: true,
                    provider: 'searxng',
                    maxResults: 10,
                    timeoutSeconds: 45,
                    cacheTtlMinutes: 20,
                  },
                },
              },
            },
          };
        },
        setConfig: async (instanceId: string, args) => {
          gatewayWriteCalls.push([instanceId, args]);
          return {
            ok: true,
          };
        },
      },
      openClawConfigDocumentApi: {
        saveWebSearchNativeCodexConfiguration: async () => {
          fileCalls.push('saveWebSearchNativeCodexConfiguration');
          throw new Error('platform native codex search save should not be used when gateway is ready');
        },
      },
    });

    await service.saveOpenClawWebSearchNativeCodexConfig('managed-openclaw', {
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

    assert.deepEqual(gatewaySnapshotCalls, ['managed-openclaw']);
    assert.equal(gatewayWriteCalls.length, 1);
    assert.deepEqual(fileCalls, []);
    assert.equal(gatewayWriteCalls[0]?.[1].baseHash, 'hash-codex-search');
    assert.deepEqual(requireParsedOpenClawConfig(gatewayWriteCalls[0]![1].raw), {
      tools: {
        web: {
          search: {
            enabled: true,
            provider: 'searxng',
            maxResults: 10,
            timeoutSeconds: 45,
            cacheTtlMinutes: 20,
            openaiCodex: {
              enabled: true,
              mode: 'cached',
              allowedDomains: ['example.com', 'openai.com'],
              contextSize: 'high',
              userLocation: {
                country: 'US',
                city: 'New York',
                timezone: 'America/New_York',
              },
              reasoningEffort: 'medium',
            },
          },
        },
      },
    });
  },
);

await runTest(
  'saveOpenClawAuthCooldownsConfig saves the OpenClaw config through the gateway when the gateway is ready',
  async () => {
    const fileCalls: string[] = [];
    const gatewaySnapshotCalls: string[] = [];
    const gatewayWriteCalls: Array<[string, { raw: string; baseHash?: string }]> = [];
    const service = createInstanceService({
      studioApi: {
        getInstanceDetail: async () =>
          createConfigBackedOpenClawDetail('managed-openclaw'),
      },
      openClawGatewayClient: {
        getConfig: async (instanceId: string) => {
          gatewaySnapshotCalls.push(instanceId);
          return {
            baseHash: 'hash-auth-cooldowns',
            config: {
              auth: {
                order: ['openai', 'anthropic'],
              },
            },
          };
        },
        setConfig: async (instanceId: string, args) => {
          gatewayWriteCalls.push([instanceId, args]);
          return {
            ok: true,
          };
        },
      },
      openClawConfigDocumentApi: {
        saveAuthCooldownsConfiguration: async () => {
          fileCalls.push('saveAuthCooldownsConfiguration');
          throw new Error('platform auth cooldown save should not be used when gateway is ready');
        },
      },
    });

    await service.saveOpenClawAuthCooldownsConfig('managed-openclaw', {
      rateLimitedProfileRotations: 2,
      overloadedProfileRotations: 1,
      overloadedBackoffMs: 45000,
      billingBackoffHours: 5,
      billingMaxHours: 24,
      failureWindowHours: 36,
    });

    assert.deepEqual(gatewaySnapshotCalls, ['managed-openclaw']);
    assert.equal(gatewayWriteCalls.length, 1);
    assert.deepEqual(fileCalls, []);
    assert.equal(gatewayWriteCalls[0]?.[1].baseHash, 'hash-auth-cooldowns');
    assert.deepEqual(requireParsedOpenClawConfig(gatewayWriteCalls[0]![1].raw), {
      auth: {
        order: ['openai', 'anthropic'],
        cooldowns: {
          rateLimitedProfileRotations: 2,
          overloadedProfileRotations: 1,
          overloadedBackoffMs: 45000,
          billingBackoffHours: 5,
          billingMaxHours: 24,
          failureWindowHours: 36,
        },
      },
    });
  },
);

await runTest(
  'saveOpenClawDreamingConfig saves the OpenClaw config through the gateway when the gateway is ready',
  async () => {
    const fileCalls: string[] = [];
    const gatewaySnapshotCalls: string[] = [];
    const gatewayWriteCalls: Array<[string, { raw: string; baseHash?: string }]> = [];
    const service = createInstanceService({
      studioApi: {
        getInstanceDetail: async () =>
          createConfigBackedOpenClawDetail('managed-openclaw'),
      },
      openClawGatewayClient: {
        getConfig: async (instanceId: string) => {
          gatewaySnapshotCalls.push(instanceId);
          return {
            baseHash: 'hash-dreaming',
            config: {
              plugins: {
                entries: {
                  'memory-core': {
                    enabled: true,
                    config: {
                      journal: {
                        retentionDays: 30,
                      },
                    },
                  },
                },
              },
            },
          };
        },
        setConfig: async (instanceId: string, args) => {
          gatewayWriteCalls.push([instanceId, args]);
          return {
            ok: true,
          };
        },
      },
      openClawConfigDocumentApi: {
        saveDreamingConfiguration: async () => {
          fileCalls.push('saveDreamingConfiguration');
          throw new Error('platform dreaming save should not be used when gateway is ready');
        },
      },
    });

    await service.saveOpenClawDreamingConfig('managed-openclaw', {
      enabled: true,
      frequency: '0 3 * * *',
    });

    assert.deepEqual(gatewaySnapshotCalls, ['managed-openclaw']);
    assert.equal(gatewayWriteCalls.length, 1);
    assert.deepEqual(fileCalls, []);
    assert.equal(gatewayWriteCalls[0]?.[1].baseHash, 'hash-dreaming');
    assert.deepEqual(requireParsedOpenClawConfig(gatewayWriteCalls[0]![1].raw), {
      plugins: {
        entries: {
          'memory-core': {
            enabled: true,
            config: {
              journal: {
                retentionDays: 30,
              },
              dreaming: {
                enabled: true,
                frequency: '0 3 * * *',
              },
            },
          },
        },
      },
    });
  },
);

await runTest(
  'setOpenClawChannelEnabled saves the OpenClaw config through the gateway when the gateway is ready',
  async () => {
    const fileCalls: string[] = [];
    const gatewaySnapshotCalls: string[] = [];
    const gatewayWriteCalls: Array<[string, { raw: string; baseHash?: string }]> = [];
    const service = createInstanceService({
      studioApi: {
        getInstanceDetail: async () =>
          createConfigBackedOpenClawDetail('managed-openclaw'),
      },
      openClawGatewayClient: {
        getConfig: async (instanceId: string) => {
          gatewaySnapshotCalls.push(instanceId);
          return {
            baseHash: 'hash-channel-enabled',
            config: {
              channels: {
                telegram: {
                  botToken: '123456:telegram-token',
                  webhookUrl: 'https://example.com/telegram/webhook',
                  enabled: true,
                },
              },
            },
          };
        },
        setConfig: async (instanceId: string, args) => {
          gatewayWriteCalls.push([instanceId, args]);
          return {
            ok: true,
          };
        },
      },
      openClawConfigDocumentApi: {
        setChannelEnabled: async () => {
          fileCalls.push('setChannelEnabled');
          throw new Error('platform channel toggle should not be used when gateway is ready');
        },
      },
    });

    await service.setOpenClawChannelEnabled('managed-openclaw', 'telegram', false);

    assert.deepEqual(gatewaySnapshotCalls, ['managed-openclaw']);
    assert.equal(gatewayWriteCalls.length, 1);
    assert.deepEqual(fileCalls, []);
    assert.equal(gatewayWriteCalls[0]?.[1].baseHash, 'hash-channel-enabled');
    assert.deepEqual(requireParsedOpenClawConfig(gatewayWriteCalls[0]![1].raw), {
      channels: {
        telegram: {
          botToken: '123456:telegram-token',
          webhookUrl: 'https://example.com/telegram/webhook',
          enabled: false,
        },
      },
    });
  },
);

await runTest(
  'getOpenClawConfigSchema reads the gateway-backed config schema for config-backed OpenClaw instances',
  async () => {
    const calls: string[] = [];
    const service = createInstanceService({
      studioApi: {
        getInstanceDetail: async () =>
          createOpenClawDetail('managed-openclaw', {
            instance: {
              ...createOpenClawDetail('managed-openclaw').instance,
              deploymentMode: 'local-external',
            },
            lifecycle: {
              ...createOpenClawDetail('managed-openclaw').lifecycle,
              configWritable: true,
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
                  detail: 'OpenClaw config file is writable.',
                  source: 'integration',
                },
              ],
            },
          }),
      },
      openClawGatewayClient: {
        getConfigSchema: async (instanceId: string) => {
          calls.push(instanceId);
          return {
            schema: {
              type: 'object',
              properties: {
                env: {
                  type: 'object',
                  properties: {
                    OPENAI_API_KEY: { type: 'string' },
                  },
                },
              },
            },
            uiHints: {
              env: {
                label: 'Environment',
                order: 1,
              },
            },
            version: '2026.4.3',
            generatedAt: '2026-04-03T00:00:00.000Z',
          };
        },
      } as any,
    });

    const snapshot = await service.getOpenClawConfigSchema('managed-openclaw');

    assert.deepEqual(calls, ['managed-openclaw']);
    assert.equal(snapshot.version, '2026.4.3');
    assert.deepEqual(snapshot.schema, {
      type: 'object',
      properties: {
        env: {
          type: 'object',
          properties: {
            OPENAI_API_KEY: { type: 'string' },
          },
        },
      },
    });
    assert.deepEqual(snapshot.uiHints, {
      env: {
        label: 'Environment',
        order: 1,
      },
    });
  },
);

await runTest(
  'getOpenClawConfigSchema does not probe the live gateway when the instance is offline',
  async () => {
    const calls: string[] = [];
    const service = createInstanceService({
      studioApi: {
        getInstanceDetail: async () =>
          createOpenClawDetail('offline-openclaw', {
            instance: {
              ...createOpenClawDetail('offline-openclaw').instance,
              status: 'offline',
              deploymentMode: 'local-managed',
              isBuiltIn: true,
              isDefault: true,
              host: '127.0.0.1',
            },
            lifecycle: {
              ...createOpenClawDetail('offline-openclaw').lifecycle,
              configWritable: true,
              workbenchManaged: true,
              endpointObserved: false,
              lifecycleControllable: false,
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
                  detail: 'OpenClaw config file is writable.',
                  source: 'integration',
                },
              ],
            },
          }),
      },
      openClawGatewayClient: {
        getConfigSchema: async (instanceId: string) => {
          calls.push(instanceId);
          throw new Error('gateway should stay idle while the instance is offline');
        },
      } as any,
    });

    const snapshot = await service.getOpenClawConfigSchema('offline-openclaw');

    assert.deepEqual(calls, []);
    assert.deepEqual(snapshot, {
      schema: null,
      uiHints: {},
      version: null,
      generatedAt: null,
    });
  },
);

await runTest(
  'openClawConfigFile uses the gateway open-file bridge for attached configs',
  async () => {
    const calls: string[] = [];
    const service = createInstanceService({
      studioApi: {
        getInstanceDetail: async () =>
          createOpenClawDetail('managed-openclaw', {
            instance: {
              ...createOpenClawDetail('managed-openclaw').instance,
              deploymentMode: 'local-external',
            },
            lifecycle: {
              ...createOpenClawDetail('managed-openclaw').lifecycle,
              configWritable: true,
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
                  detail: 'OpenClaw config file is writable.',
                  source: 'integration',
                },
              ],
            },
          }),
      },
      openClawGatewayClient: {
        openConfigFile: async (instanceId: string) => {
          calls.push(instanceId);
          return {
            ok: true,
            path: 'D:/OpenClaw/.openclaw/openclaw.json',
          };
        },
      } as any,
    });

    const openedPath = await service.openClawConfigFile('managed-openclaw');

    assert.deepEqual(calls, ['managed-openclaw']);
    assert.equal(openedPath, 'D:/OpenClaw/.openclaw/openclaw.json');
  },
);

await runTest(
  'applyOpenClawConfigDocument uses the gateway apply bridge with the latest base hash',
  async () => {
    const calls: Array<{ step: string; instanceId: string; raw?: string; baseHash?: string }> = [];
    const service = createInstanceService({
      studioApi: {
        getInstanceDetail: async () =>
          createOpenClawDetail('managed-openclaw', {
            instance: {
              ...createOpenClawDetail('managed-openclaw').instance,
              deploymentMode: 'local-external',
            },
            lifecycle: {
              ...createOpenClawDetail('managed-openclaw').lifecycle,
              configWritable: true,
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
                  detail: 'OpenClaw config file is writable.',
                  source: 'integration',
                },
              ],
            },
          }),
      },
      openClawGatewayClient: {
        getConfig: async (instanceId: string) => {
          calls.push({ step: 'getConfig', instanceId });
          return {
            baseHash: 'config-hash-42',
            config: {},
          };
        },
        applyConfig: async (instanceId: string, args: { raw: string; baseHash?: string }) => {
          calls.push({
            step: 'applyConfig',
            instanceId,
            raw: args.raw,
            baseHash: args.baseHash,
          });
          return {
            ok: true,
          };
        },
      } as any,
    });

    await service.applyOpenClawConfigDocument(
      'managed-openclaw',
      '{\n  "agents": {\n    "defaults": {}\n  }\n}\n',
    );

    assert.deepEqual(calls, [
      {
        step: 'getConfig',
        instanceId: 'managed-openclaw',
      },
      {
        step: 'applyConfig',
        instanceId: 'managed-openclaw',
        raw: '{\n  "agents": {\n    "defaults": {}\n  }\n}\n',
        baseHash: 'config-hash-42',
      },
    ]);
  },
);

await runTest(
  'applyOpenClawConfigDocument still uses the gateway apply bridge when config-backed runtime observation proves readiness despite a stale offline status',
  async () => {
    const calls: Array<{ step: string; instanceId: string; raw?: string; baseHash?: string }> = [];
    const service = createInstanceService({
      studioApi: {
        getInstanceDetail: async () =>
          createConfigBackedOpenClawDetail('managed-openclaw', {
            instance: {
              ...createConfigBackedOpenClawDetail('managed-openclaw').instance,
              status: 'offline',
            },
            lifecycle: {
              ...createConfigBackedOpenClawDetail('managed-openclaw').lifecycle,
              endpointObserved: true,
            },
            health: {
              score: 88,
              status: 'healthy',
              checks: [],
              evaluatedAt: 1,
            },
          }),
      },
      openClawGatewayClient: {
        getConfig: async (instanceId: string) => {
          calls.push({ step: 'getConfig', instanceId });
          return {
            baseHash: 'config-hash-stale-status',
            config: {},
          };
        },
        applyConfig: async (instanceId: string, args: { raw: string; baseHash?: string }) => {
          calls.push({
            step: 'applyConfig',
            instanceId,
            raw: args.raw,
            baseHash: args.baseHash,
          });
          return {
            ok: true,
          };
        },
      } as any,
    });

    await service.applyOpenClawConfigDocument(
      'managed-openclaw',
      '{\n  "agents": {\n    "defaults": {\n      "primary": "ops"\n    }\n  }\n}\n',
    );

    assert.deepEqual(calls, [
      {
        step: 'getConfig',
        instanceId: 'managed-openclaw',
      },
      {
        step: 'applyConfig',
        instanceId: 'managed-openclaw',
        raw: '{\n  "agents": {\n    "defaults": {\n      "primary": "ops"\n    }\n  }\n}\n',
        baseHash: 'config-hash-stale-status',
      },
    ]);
  },
);

await runTest(
  'runOpenClawUpdate triggers the gateway update bridge for attached configs',
  async () => {
    const calls: string[] = [];
    const service = createInstanceService({
      studioApi: {
        getInstanceDetail: async () =>
          createOpenClawDetail('managed-openclaw', {
            instance: {
              ...createOpenClawDetail('managed-openclaw').instance,
              deploymentMode: 'local-external',
            },
            lifecycle: {
              ...createOpenClawDetail('managed-openclaw').lifecycle,
              configWritable: true,
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
                  detail: 'OpenClaw config file is writable.',
                  source: 'integration',
                },
              ],
            },
          }),
      },
      openClawGatewayClient: {
        runUpdate: async (instanceId: string) => {
          calls.push(instanceId);
          return {
            ok: true,
          };
        },
      } as any,
    });

    await service.runOpenClawUpdate('managed-openclaw');

    assert.deepEqual(calls, ['managed-openclaw']);
  },
);

await runTest('getInstanceFileContent rejects reads when instance detail is unavailable', async () => {
  const service = createInstanceService({
    studioApi: {
      getInstanceDetail: async () => null,
    },
  });

  await assert.rejects(
    () => service.getInstanceFileContent('custom-runtime', 'missing-file.md'),
    /instance detail is unavailable/i,
  );
});

await runTest('updateInstanceLlmProviderConfig rejects built-in OpenClaw provider edits and keeps Provider Center as the control plane', async () => {
  const calls: Array<[string, string, string]> = [];
  const service = createInstanceService({
    studioApi: {
      getInstanceDetail: async () =>
        createOpenClawDetail(BUILT_IN_INSTANCE_ID, {
          instance: {
            ...createOpenClawDetail(BUILT_IN_INSTANCE_ID).instance,
            isBuiltIn: true,
            isDefault: true,
            deploymentMode: 'local-managed',
            host: '127.0.0.1',
          },
        }),
      updateInstanceLlmProviderConfig: async (instanceId, providerId, update) => {
        calls.push([instanceId, providerId, update.defaultModelId]);
        return true;
      },
    },
    openClawGatewayClient: {
      getConfig: async () => {
        throw new Error('gateway config patch should not be used for built-in OpenClaw');
      },
      patchConfig: async () => {
        throw new Error('gateway config patch should not be used for built-in OpenClaw');
      },
    },
  });

  await assert.rejects(
    () =>
      service.updateInstanceLlmProviderConfig(BUILT_IN_INSTANCE_ID, 'openai', {
        endpoint: 'https://api.openai.com/v1',
        apiKeySource: '${OPENAI_API_KEY}',
        defaultModelId: 'gpt-5.4',
        reasoningModelId: 'gpt-5.4',
        embeddingModelId: 'text-embedding-3-large',
        config: {
          temperature: 0.3,
          topP: 0.95,
          maxTokens: 12000,
          timeoutMs: 120000,
          streaming: true,
        },
      }),
    /provider center/i,
  );

  assert.deepEqual(calls, []);
});

await runTest('updateInstanceFileContent rejects non-OpenClaw files not exposed by the backend workbench', async () => {
  const service = createInstanceService({
    studioApi: {
      getInstanceDetail: async () => createCustomDetail('custom-runtime'),
    },
  });

  await assert.rejects(
    () => service.updateInstanceFileContent('custom-runtime', 'missing-file.md', '# updated'),
    /not writable through the studio backend/i,
  );
});

await runTest('updateInstanceLlmProviderConfig routes backend-authored non-OpenClaw providers through the studio bridge', async () => {
  const calls: Array<[string, string, string]> = [];
  const service = createInstanceService({
    studioApi: {
      getInstanceDetail: async () =>
        createCustomDetail('custom-runtime', {
          workbench: {
            channels: [],
            cronTasks: {
              tasks: [],
              taskExecutionsById: {},
            },
            llmProviders: [
              {
                id: 'openai',
                name: 'OpenAI',
                provider: 'openai',
                endpoint: 'https://api.openai.com/v1',
                apiKeySource: '${OPENAI_API_KEY}',
                status: 'ready',
                defaultModelId: 'gpt-5.4',
                description: 'Backend-authored provider.',
                icon: 'O',
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
                  topP: 0.95,
                  maxTokens: 12000,
                  timeoutMs: 120000,
                  streaming: true,
                },
              },
            ],
            agents: [],
            skills: [],
            files: [],
            memory: [],
            tools: [],
          },
        }),
      updateInstanceLlmProviderConfig: async (instanceId, providerId, update) => {
        calls.push([instanceId, providerId, update.defaultModelId]);
        return true;
      },
    },
    openClawGatewayClient: {
      getConfig: async () => {
        throw new Error('gateway config read should not be used for non-OpenClaw instances');
      },
      patchConfig: async () => {
        throw new Error('gateway config patch should not be used for non-OpenClaw instances');
      },
    },
  });

  await service.updateInstanceLlmProviderConfig('custom-runtime', 'openai', {
    endpoint: 'https://api.openai.com/v1',
    apiKeySource: '${OPENAI_API_KEY}',
    defaultModelId: 'gpt-5.4',
    reasoningModelId: 'gpt-5.4',
    embeddingModelId: 'text-embedding-3-large',
    config: {
      temperature: 0.3,
      topP: 0.95,
      maxTokens: 12000,
      timeoutMs: 120000,
      streaming: true,
    },
  });

  assert.deepEqual(calls, [['custom-runtime', 'openai', 'gpt-5.4']]);
});

await runTest('updateInstanceLlmProviderConfig rejects non-OpenClaw providers not exposed by the backend workbench', async () => {
  const service = createInstanceService({
    studioApi: {
      getInstanceDetail: async () => createCustomDetail('custom-runtime'),
    },
  });

  await assert.rejects(
    () =>
      service.updateInstanceLlmProviderConfig('custom-runtime', 'missing-provider', {
        endpoint: 'https://api.openai.com/v1',
        apiKeySource: '${OPENAI_API_KEY}',
        defaultModelId: 'gpt-5.4',
        reasoningModelId: 'gpt-5.4',
        embeddingModelId: 'text-embedding-3-large',
        config: {
          temperature: 0.3,
          topP: 0.95,
          maxTokens: 12000,
          timeoutMs: 120000,
          streaming: true,
        },
      }),
    /not writable through the studio backend/i,
  );
});

await runTest('updateInstanceLlmProviderConfig patches remote OpenClaw provider config through the gateway client', async () => {
  const patches: Array<{ instanceId: string; args: { raw: string; baseHash?: string } }> = [];
  const service = createInstanceService({
    studioApi: {
      getInstanceDetail: async () => createOpenClawDetail('remote-openclaw'),
    },
    openClawGatewayClient: {
      getConfig: async () => ({
        baseHash: 'hash-1',
        config: {
          models: {
            providers: {
              openai: {
                baseUrl: 'https://old.example.com/v1',
                apiKey: '${OLD_KEY}',
                models: [
                  {
                    id: 'old-default',
                    name: 'old-default',
                    role: 'primary',
                  },
                  {
                    id: 'old-embedding',
                    name: 'old-embedding',
                    role: 'embedding',
                  },
                ],
                temperature: 0.2,
                topP: 1,
                maxTokens: 4096,
                timeoutMs: 60000,
                streaming: true,
              },
            },
          },
          agents: {
            defaults: {
              model: {
                primary: 'openai/old-default',
              },
              models: {
                'openai/old-default': {
                  alias: 'old-default',
                  params: {
                    temperature: 0.2,
                    topP: 1,
                    maxTokens: 4096,
                    timeoutMs: 60000,
                    streaming: true,
                  },
                },
              },
            },
          },
        },
      }),
      patchConfig: async (instanceId, args) => {
        patches.push({ instanceId, args });
        return {
          ok: true,
        };
      },
    },
  });

  await service.updateInstanceLlmProviderConfig('remote-openclaw', 'openai', {
    endpoint: 'https://api.openai.com/v1',
    apiKeySource: '${OPENAI_API_KEY}',
    defaultModelId: 'gpt-5.4',
    reasoningModelId: 'o4-mini',
    embeddingModelId: 'text-embedding-3-large',
    config: {
      temperature: 0.3,
      topP: 0.95,
      maxTokens: 12000,
      timeoutMs: 120000,
      streaming: true,
    },
  });

  assert.equal(patches.length, 1);
  assert.equal(patches[0]?.instanceId, 'remote-openclaw');
  assert.equal(patches[0]?.args.baseHash, 'hash-1');
  assert.deepEqual(JSON.parse(patches[0]!.args.raw), {
    models: {
      providers: {
        openai: {
          baseUrl: 'https://api.openai.com/v1',
          apiKey: '${OPENAI_API_KEY}',
          temperature: null,
          topP: null,
          maxTokens: null,
          timeoutMs: null,
          streaming: null,
          request: null,
          models: [
            {
              id: 'gpt-5.4',
              name: 'gpt-5.4',
              role: 'primary',
            },
            {
              id: 'o4-mini',
              name: 'o4-mini',
              role: 'reasoning',
            },
            {
              id: 'text-embedding-3-large',
              name: 'text-embedding-3-large',
              role: 'embedding',
            },
            {
              id: 'old-default',
              name: 'old-default',
              role: 'fallback',
            },
            {
              id: 'old-embedding',
              name: 'old-embedding',
              role: 'embedding',
            },
          ],
        },
      },
    },
    agents: {
      defaults: {
        model: {
          primary: 'openai/gpt-5.4',
          fallbacks: ['openai/o4-mini'],
        },
        models: {
          'openai/gpt-5.4': {
            alias: 'gpt-5.4',
            streaming: true,
            params: {
              temperature: 0.3,
              topP: 0.95,
              maxTokens: 12000,
              timeoutMs: 120000,
              streaming: true,
            },
          },
          'openai/o4-mini': {
            alias: 'o4-mini',
            streaming: true,
          },
          'openai/text-embedding-3-large': {
            alias: 'text-embedding-3-large',
            streaming: false,
          },
          'openai/old-default': {
            alias: 'old-default',
            streaming: true,
          },
          'openai/old-embedding': {
            alias: 'old-embedding',
            streaming: false,
          },
        },
      },
    },
  });
});

await runTest(
  'updateInstanceLlmProviderConfig patches remote OpenClaw provider request overrides through the gateway client',
  async () => {
    const patches: Array<{ instanceId: string; args: { raw: string; baseHash?: string } }> = [];
    const service = createInstanceService({
      studioApi: {
        getInstanceDetail: async () => createOpenClawDetail('remote-openclaw-request'),
      },
      openClawGatewayClient: {
        getConfig: async () => ({
          baseHash: 'hash-request',
          config: {
            models: {
              providers: {
                openai: {
                  baseUrl: 'https://old.example.com/v1',
                  apiKey: '${OLD_KEY}',
                  models: [
                    {
                      id: 'gpt-5.4',
                      name: 'gpt-5.4',
                      role: 'primary',
                    },
                  ],
                },
              },
            },
            agents: {
              defaults: {
                model: {
                  primary: 'openai/gpt-5.4',
                },
                models: {
                  'openai/gpt-5.4': {
                    alias: 'gpt-5.4',
                    params: {
                      temperature: 0.2,
                      topP: 1,
                      maxTokens: 4096,
                      timeoutMs: 60000,
                      streaming: true,
                    },
                  },
                },
              },
            },
          },
        }),
        patchConfig: async (instanceId, args) => {
          patches.push({ instanceId, args });
          return {
            ok: true,
          };
        },
      },
    });

    await service.updateInstanceLlmProviderConfig('remote-openclaw-request', 'openai', {
      endpoint: 'https://api.openai.com/v1',
      apiKeySource: '${OPENAI_API_KEY}',
      defaultModelId: 'gpt-5.4',
      reasoningModelId: undefined,
      embeddingModelId: undefined,
      config: {
        temperature: 0.25,
        topP: 0.8,
        maxTokens: 12000,
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
            mode: 'explicit-proxy',
            url: 'http://127.0.0.1:8080',
          },
          tls: {
            insecureSkipVerify: true,
            serverName: 'api.openai.internal',
          },
        },
      },
    });

    assert.equal(patches.length, 1);
    assert.deepEqual(JSON.parse(patches[0]!.args.raw), {
      models: {
        providers: {
          openai: {
            baseUrl: 'https://api.openai.com/v1',
            apiKey: '${OPENAI_API_KEY}',
            temperature: null,
            topP: null,
            maxTokens: null,
            timeoutMs: null,
            streaming: null,
            request: {
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
              },
              tls: {
                insecureSkipVerify: true,
                serverName: 'api.openai.internal',
              },
            },
            models: [
              {
                id: 'gpt-5.4',
                name: 'gpt-5.4',
                role: 'primary',
              },
            ],
          },
        },
      },
      agents: {
        defaults: {
          model: {
            primary: 'openai/gpt-5.4',
          },
          models: {
            'openai/gpt-5.4': {
              alias: 'gpt-5.4',
              streaming: true,
              params: {
                temperature: 0.25,
                topP: 0.8,
                maxTokens: 12000,
                timeoutMs: 90000,
                streaming: true,
              },
            },
          },
        },
      },
    });
  },
);

await runTest(
  'saveOpenClawChannelConfig writes through the local config file service with configFile when the gateway is unavailable',
  async () => {
    const saveCalls: Array<{
      configFile: string;
      channelId: string;
      values: Record<string, string>;
      enabled: boolean;
    }> = [];
    const service = createInstanceService({
      studioApi: {
        getInstanceDetail: async () =>
          createConfigBackedOpenClawDetail('managed-openclaw', {
            instance: {
              ...createConfigBackedOpenClawDetail('managed-openclaw').instance,
              status: 'offline',
            },
          }),
      },
      openClawGatewayClient: {
        getConfig: async () => {
          throw new Error('gateway should not be used while offline');
        },
      },
      openClawConfigDocumentApi: {
        saveChannelConfiguration: async (input) => {
          saveCalls.push(input as any);
          return null;
        },
      },
    });

    await service.saveOpenClawChannelConfig('managed-openclaw', 'telegram', {
      botToken: '123456:telegram-token',
      webhookUrl: 'https://example.com/telegram/webhook',
    });

    assert.deepEqual(saveCalls, [
      {
        configFile: 'D:/OpenClaw/managed-openclaw/.openclaw/openclaw.json',
        channelId: 'telegram',
        values: {
          botToken: '123456:telegram-token',
          webhookUrl: 'https://example.com/telegram/webhook',
        },
        enabled: true,
      },
    ]);
    assert.equal('configPath' in (saveCalls[0] || {}), false);
  },
);

await runTest(
  'updateInstanceLlmProviderConfig normalizes legacy remote OpenClaw provider ids through the shared snapshot authority before patching',
  async () => {
    const patches: Array<{ instanceId: string; args: { raw: string; baseHash?: string } }> = [];
    const service = createInstanceService({
      studioApi: {
        getInstanceDetail: async () => createOpenClawDetail('remote-openclaw-legacy-provider'),
      },
      openClawGatewayClient: {
        getConfig: async () => ({
          baseHash: 'hash-legacy-provider',
          config: {
            models: {
              providers: {
                'api-router-openai': {
                  baseUrl: 'https://legacy-router.example.com/v1',
                  apiKey: '${LEGACY_OPENAI_KEY}',
                  models: [
                    {
                      id: 'gpt-4.1',
                      name: 'GPT-4.1',
                      role: 'primary',
                    },
                    {
                      id: 'legacy-fallback',
                      name: 'Legacy Fallback',
                      role: 'fallback',
                    },
                  ],
                },
              },
            },
            agents: {
              defaults: {
                model: {
                  primary: 'api-router-openai/gpt-4.1',
                },
                models: {
                  'api-router-openai/gpt-4.1': {
                    alias: 'GPT-4.1',
                    streaming: true,
                    params: {
                      temperature: 0.2,
                      topP: 1,
                      maxTokens: 4096,
                      timeoutMs: 60000,
                      streaming: true,
                    },
                  },
                },
              },
            },
          },
        }),
        patchConfig: async (instanceId, args) => {
          patches.push({ instanceId, args });
          return {
            ok: true,
          };
        },
      },
    });

    await service.updateInstanceLlmProviderConfig('remote-openclaw-legacy-provider', 'openai', {
      endpoint: ' https://api.openai.com/v1 ',
      apiKeySource: ' ${OPENAI_API_KEY} ',
      defaultModelId: ' gpt-5.4 ',
      reasoningModelId: ' o4-mini ',
      embeddingModelId: undefined,
      config: {
        temperature: 0.3,
        topP: 0.95,
        maxTokens: 12000,
        timeoutMs: 120000,
        streaming: true,
      },
    });

    assert.equal(patches.length, 1);
    assert.deepEqual(JSON.parse(patches[0]!.args.raw), {
      models: {
        providers: {
          openai: {
            baseUrl: 'https://api.openai.com/v1',
            apiKey: '${OPENAI_API_KEY}',
            temperature: null,
            topP: null,
            maxTokens: null,
            timeoutMs: null,
            streaming: null,
            request: null,
            models: [
              {
                id: 'gpt-5.4',
                name: 'gpt-5.4',
                role: 'primary',
              },
              {
                id: 'o4-mini',
                name: 'o4-mini',
                role: 'reasoning',
              },
              {
                id: 'gpt-4.1',
                name: 'GPT-4.1',
                role: 'fallback',
              },
              {
                id: 'legacy-fallback',
                name: 'Legacy Fallback',
                role: 'fallback',
              },
            ],
          },
        },
      },
      agents: {
        defaults: {
          model: {
            primary: 'openai/gpt-5.4',
            fallbacks: ['openai/o4-mini'],
          },
          models: {
            'openai/gpt-5.4': {
              alias: 'gpt-5.4',
              streaming: true,
              params: {
                temperature: 0.3,
                topP: 0.95,
                maxTokens: 12000,
                timeoutMs: 120000,
                streaming: true,
              },
            },
            'openai/o4-mini': {
              alias: 'o4-mini',
              streaming: true,
            },
            'openai/gpt-4.1': {
              alias: 'GPT-4.1',
              streaming: true,
            },
            'openai/legacy-fallback': {
              alias: 'Legacy Fallback',
              streaming: true,
            },
          },
        },
      },
    });
  },
);

await runTest('createInstanceLlmProvider rejects config-backed OpenClaw provider creation and keeps Provider Center as the control plane', async () => {
  const service = createInstanceService({
    studioApi: {
      getInstanceDetail: async () =>
        createOpenClawDetail('managed-openclaw', {
          instance: {
            ...createOpenClawDetail('managed-openclaw').instance,
            deploymentMode: 'local-external',
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
                detail: 'OpenClaw config file is writable.',
                source: 'integration',
              },
            ],
          },
        }),
    },
  });

  await assert.rejects(
    () =>
      service.createInstanceLlmProvider(
        'managed-openclaw',
        {
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
            temperature: 0.3,
            topP: 0.95,
            maxTokens: 12000,
            timeoutMs: 120000,
            streaming: true,
          },
        },
        {
          defaultModelId: 'gpt-5.4',
          reasoningModelId: 'gpt-5.4',
          embeddingModelId: 'text-embedding-3-large',
        },
      ),
    /provider center/i,
  );
});

await runTest('createInstanceLlmProvider rejects built-in OpenClaw provider creation and keeps Provider Center as the control plane', async () => {
  const service = createInstanceService({
    studioApi: {
      getInstanceDetail: async () =>
        createOpenClawDetail(BUILT_IN_INSTANCE_ID, {
          instance: {
            ...createOpenClawDetail(BUILT_IN_INSTANCE_ID).instance,
            isBuiltIn: true,
            isDefault: true,
            deploymentMode: 'local-managed',
            host: '127.0.0.1',
          },
        }),
    },
  });

  await assert.rejects(
    () =>
      service.createInstanceLlmProvider(
        BUILT_IN_INSTANCE_ID,
        {
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
            temperature: 0.3,
            topP: 0.95,
            maxTokens: 12000,
            timeoutMs: 120000,
            streaming: true,
          },
        },
        {
          defaultModelId: 'gpt-5.4',
          reasoningModelId: 'gpt-5.4',
          embeddingModelId: 'text-embedding-3-large',
        },
      ),
    /provider center/i,
  );
});

await runTest('deleteInstanceLlmProvider rejects built-in OpenClaw provider deletion and keeps Provider Center as the control plane', async () => {
  const service = createInstanceService({
    studioApi: {
      getInstanceDetail: async () =>
        createOpenClawDetail(BUILT_IN_INSTANCE_ID, {
          instance: {
            ...createOpenClawDetail(BUILT_IN_INSTANCE_ID).instance,
            isBuiltIn: true,
            isDefault: true,
            deploymentMode: 'local-managed',
            host: '127.0.0.1',
          },
        }),
    },
  });

  await assert.rejects(
    () => service.deleteInstanceLlmProvider(BUILT_IN_INSTANCE_ID, 'sdkwork-local-proxy'),
    /provider center/i,
  );
});

await runTest('createInstanceLlmProviderModel rejects built-in OpenClaw provider model creation and keeps Provider Center as the control plane', async () => {
  const service = createInstanceService({
    studioApi: {
      getInstanceDetail: async () =>
        createOpenClawDetail(BUILT_IN_INSTANCE_ID, {
          instance: {
            ...createOpenClawDetail(BUILT_IN_INSTANCE_ID).instance,
            isBuiltIn: true,
            isDefault: true,
            deploymentMode: 'local-managed',
            host: '127.0.0.1',
          },
        }),
    },
  });

  await assert.rejects(
    () =>
      service.createInstanceLlmProviderModel(BUILT_IN_INSTANCE_ID, 'sdkwork-local-proxy', {
        id: 'gpt-5.4',
        name: 'GPT-5.4',
      }),
    /provider center/i,
  );
});

await runTest('updateInstanceLlmProviderModel rejects built-in OpenClaw provider model edits and keeps Provider Center as the control plane', async () => {
  const service = createInstanceService({
    studioApi: {
      getInstanceDetail: async () =>
        createOpenClawDetail(BUILT_IN_INSTANCE_ID, {
          instance: {
            ...createOpenClawDetail(BUILT_IN_INSTANCE_ID).instance,
            isBuiltIn: true,
            isDefault: true,
            deploymentMode: 'local-managed',
            host: '127.0.0.1',
          },
        }),
    },
  });

  await assert.rejects(
    () =>
      service.updateInstanceLlmProviderModel(
        BUILT_IN_INSTANCE_ID,
        'sdkwork-local-proxy',
        'gpt-5.4',
        {
          id: 'gpt-5.4-mini',
          name: 'GPT-5.4 Mini',
        },
      ),
    /provider center/i,
  );
});

await runTest('deleteInstanceLlmProviderModel rejects built-in OpenClaw provider model deletion and keeps Provider Center as the control plane', async () => {
  const service = createInstanceService({
    studioApi: {
      getInstanceDetail: async () =>
        createOpenClawDetail(BUILT_IN_INSTANCE_ID, {
          instance: {
            ...createOpenClawDetail(BUILT_IN_INSTANCE_ID).instance,
            isBuiltIn: true,
            isDefault: true,
            deploymentMode: 'local-managed',
            host: '127.0.0.1',
          },
        }),
    },
  });

  await assert.rejects(
    () =>
      service.deleteInstanceLlmProviderModel(
        BUILT_IN_INSTANCE_ID,
        'sdkwork-local-proxy',
        'gpt-5.4',
      ),
    /provider center/i,
  );
});

await runTest('updateInstanceLlmProviderConfig rejects config-backed OpenClaw provider edits and keeps Provider Center as the control plane', async () => {
  const service = createInstanceService({
    studioApi: {
      getInstanceDetail: async () =>
        createOpenClawDetail('managed-openclaw', {
          instance: {
            ...createOpenClawDetail('managed-openclaw').instance,
            deploymentMode: 'local-external',
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
                detail: 'OpenClaw config file is writable.',
                source: 'integration',
              },
            ],
          },
        }),
    },
  });

  await assert.rejects(
    () =>
      service.updateInstanceLlmProviderConfig('managed-openclaw', 'sdkwork-local-proxy', {
        endpoint: 'http://localhost:21280/v1',
        apiKeySource: 'sk_sdkwork_api_key',
        defaultModelId: 'sdkwork-chat',
        reasoningModelId: 'sdkwork-reasoning',
        embeddingModelId: 'sdkwork-embedding',
        config: {
          temperature: 0.2,
          topP: 1,
          maxTokens: 8192,
          timeoutMs: 60000,
          streaming: true,
        },
      }),
    /provider center/i,
  );
});
