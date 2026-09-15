// WORKSPACE-PATH:allow-fixture: fixtures name a foreign checkout root, drive, or home directory to exercise path handling, so the literal is the value under assertion rather than a binding this build resolves
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  DEFAULT_BUNDLED_OPENCLAW_VERSION,
  DEFAULT_REQUIRED_OPENCLAW_NODE_VERSION,
} from '@sdkwork/agentstudio-pc-types';

const DEFAULT_RUNTIME_VERSION = `v${DEFAULT_BUNDLED_OPENCLAW_VERSION}`;
const DEFAULT_NODE_VERSION = DEFAULT_REQUIRED_OPENCLAW_NODE_VERSION;

async function runTest(name: string, callback: () => Promise<void> | void) {
  try {
    await callback();
    console.log(`ok - ${name}`);
  } catch (error) {
    console.error(`not ok - ${name}`);
    throw error;
  }
}

async function readKernelPlatformServiceSource() {
  return readFile(new URL('./kernelPlatformService.ts', import.meta.url), 'utf8');
}

let kernelPlatformServiceModule:
  | typeof import('./kernelPlatformService.ts')
  | undefined;

try {
  kernelPlatformServiceModule = await import('./kernelPlatformService.ts');
} catch {
  kernelPlatformServiceModule = undefined;
}

if (kernelPlatformServiceModule) {
  await runTest(
    'kernelPlatformService maps kernel host status into a UI-friendly platform snapshot',
    async () => {
      const { createKernelPlatformService } = kernelPlatformServiceModule;

      const service = createKernelPlatformService({
        getKernelPlatform: () => ({
          getInfo: async () => null,
          getStorageInfo: async () => null,
          getStatus: async () => ({
            topology: {
              kind: 'localManagedNative',
              state: 'installed',
              label: 'Built-In Native Runtime',
              recommended: true,
            },
            runtime: {
              state: 'running',
              health: 'healthy',
              reason: 'Kernel attached to a healthy local OpenClaw gateway.',
              startedBy: 'appSupervisor',
              lastTransitionAt: 1743000000000,
            },
            endpoint: {
              preferredPort: 21280,
              activePort: 18845,
              baseUrl: 'http://127.0.0.1:18845',
              websocketUrl: 'ws://127.0.0.1:18845',
              loopbackOnly: true,
              dynamicPort: true,
              endpointSource: 'allocated',
            },
            host: {
              serviceManager: 'windowsService',
              ownership: 'appSupervisor',
              serviceName: 'agentstudioOpenClawKernel',
              serviceConfigPath:
                'C:/ProgramData/SdkWork/CrawStudio/machine/state/kernel-host/windows-service.json',
              startupMode: 'auto',
              attachSupported: true,
              repairSupported: true,
              controlSocket: {
                socketKind: 'namedPipe',
                location: '\\\\.\\pipe\\agent-studio-openclaw',
                available: false,
              },
            },
            provenance: {
              runtimeId: 'openclaw',
              installKey: `${DEFAULT_RUNTIME_VERSION}-windows-x64`,
              runtimeVersion: DEFAULT_RUNTIME_VERSION,
              nodeVersion: DEFAULT_NODE_VERSION,
              platform: 'windows',
              arch: 'x64',
              installSource: 'bundled',
              configFile: 'C:/Users/admin/.openclaw/openclaw.json',
              runtimeHomeDir: 'C:/Users/admin',
              runtimeInstallDir:
                `C:/Program Files/SdkWork/CrawStudio/runtimes/openclaw/${DEFAULT_RUNTIME_VERSION}-windows-x64`,
            },
          }),
          ensureRunning: async () => {
            throw new Error('not needed');
          },
          restart: async () => {
            throw new Error('not needed');
          },
          testLocalAiProxyRoute: async () => null,
          listLocalAiProxyRequestLogs: async () => ({
            items: [],
            pageInfo: {
              mode: 'offset',
              page: 1,
              pageSize: 20,
              hasMore: false,
              totalItems: '0',
            },
          }),
          listLocalAiProxyMessageLogs: async () => ({
            items: [],
            pageInfo: {
              mode: 'offset',
              page: 1,
              pageSize: 20,
              hasMore: false,
              totalItems: '0',
            },
          }),
          updateLocalAiProxyMessageCapture: async (enabled) => ({
            enabled,
            updatedAt: 1743000000000,
          }),
        }),
      });

      const snapshot = await service.getStatus();

      assert.ok(snapshot, 'Expected kernel platform snapshot');
      assert.equal(snapshot.topologyKind, 'localManagedNative');
      assert.equal(snapshot.runtimeState, 'running');
      assert.equal(snapshot.runtimeId, 'openclaw');
      assert.equal(snapshot.hostManager, 'windowsService');
      assert.equal(snapshot.controlMode, 'supervisedFallback');
      assert.equal(snapshot.baseUrl, 'http://127.0.0.1:18845');
      assert.equal(snapshot.usesDynamicPort, true);
      assert.equal(snapshot.runtimeVersion, DEFAULT_RUNTIME_VERSION);
      assert.equal(snapshot.nodeVersion, DEFAULT_NODE_VERSION);
      assert.equal(snapshot.serviceConfigPath.endsWith('windows-service.json'), true);
      assert.equal('openclawVersion' in snapshot, false);
    },
  );

  await runTest(
    'kernelPlatformService delegates ensureRunning and restart to the shared kernel bridge',
    async () => {
      const { createKernelPlatformService } = kernelPlatformServiceModule;

      const calls: string[] = [];
      const response = {
        topology: {
          kind: 'localManagedNative',
          state: 'installed',
          label: 'Built-In Native Runtime',
          recommended: true,
        },
        runtime: {
          state: 'running',
          health: 'healthy',
          reason: 'Kernel is ready.',
          startedBy: 'nativeService',
          lastTransitionAt: 1743000001000,
        },
        endpoint: {
          preferredPort: 21280,
          activePort: 21280,
          baseUrl: 'http://127.0.0.1:21280',
          websocketUrl: 'ws://127.0.0.1:21280',
          loopbackOnly: true,
          dynamicPort: false,
          endpointSource: 'configured',
        },
        host: {
          serviceManager: 'systemdUser',
          ownership: 'nativeService',
          serviceName: 'agent-studio-openclaw',
          serviceConfigPath: '/home/admin/.config/systemd/user/agent-studio-openclaw.service',
          startupMode: 'auto',
          attachSupported: true,
          repairSupported: true,
          controlSocket: {
            socketKind: 'unixDomainSocket',
            location: '/home/admin/.sdkwork/crawstudio/run/kernel-host.sock',
            available: true,
          },
        },
        provenance: {
          runtimeId: 'openclaw',
          installKey: `${DEFAULT_RUNTIME_VERSION}-linux-x64`,
          runtimeVersion: DEFAULT_RUNTIME_VERSION,
          nodeVersion: DEFAULT_NODE_VERSION,
          platform: 'linux',
          arch: 'x64',
          installSource: 'bundled',
          configFile: '/home/admin/.openclaw/openclaw.json',
          runtimeHomeDir: '/home/admin',
          runtimeInstallDir:
            `/opt/sdkwork/crawstudio/runtimes/openclaw/${DEFAULT_RUNTIME_VERSION}-linux-x64`,
        },
      } as const;

      const service = createKernelPlatformService({
        getKernelPlatform: () => ({
          getInfo: async () => null,
          getStorageInfo: async () => null,
          getStatus: async () => response,
          ensureRunning: async () => {
            calls.push('ensureRunning');
            return response;
          },
          restart: async () => {
            calls.push('restart');
            return response;
          },
          testLocalAiProxyRoute: async () => null,
          listLocalAiProxyRequestLogs: async () => ({
            items: [],
            pageInfo: {
              mode: 'offset',
              page: 1,
              pageSize: 20,
              hasMore: false,
              totalItems: '0',
            },
          }),
          listLocalAiProxyMessageLogs: async () => ({
            items: [],
            pageInfo: {
              mode: 'offset',
              page: 1,
              pageSize: 20,
              hasMore: false,
              totalItems: '0',
            },
          }),
          updateLocalAiProxyMessageCapture: async (enabled) => ({
            enabled,
            updatedAt: 1743000001234,
          }),
        }),
      });

      const ensured = await service.ensureRunning();
      const restarted = await service.restart();

      assert.deepEqual(calls, ['ensureRunning', 'restart']);
      assert.equal(ensured?.controlMode, 'nativeService');
      assert.equal(restarted?.hostManager, 'systemdUser');
      assert.equal(ensured?.runtimeVersion, DEFAULT_RUNTIME_VERSION);
    },
  );

  await runTest(
    'kernelPlatformService exposes local ai proxy request logs, message logs, and message capture updates',
    async () => {
      const { createKernelPlatformService } = kernelPlatformServiceModule;

      const calls: string[] = [];
      const service = createKernelPlatformService({
        getKernelPlatform: () => ({
          getInfo: async () => null,
          getStorageInfo: async () => null,
          getStatus: async () => null,
          ensureRunning: async () => null,
          restart: async () => null,
          testLocalAiProxyRoute: async () => null,
          listLocalAiProxyRequestLogs: async (query) => {
            calls.push(`requestLogs:${query.page}:${query.page_size}:${query.q || ''}`);
            return {
              items: [
                {
                  id: 'req_1',
                  createdAt: 1743510000000,
                  routeId: 'provider-config-openai',
                  routeName: 'OpenAI',
                  providerId: 'openai',
                  clientProtocol: 'openai-compatible',
                  upstreamProtocol: 'openai-compatible',
                  endpoint: '/v1/chat/completions',
                  status: 'succeeded',
                  modelId: 'gpt-5.4',
                  baseUrl: 'https://api.openai.com/v1',
                  ttftMs: 220,
                  totalDurationMs: 810,
                  totalTokens: 1800,
                  promptTokens: 910,
                  completionTokens: 840,
                  inputTokens: 900,
                  outputTokens: 850,
                  cacheTokens: 50,
                  responseStatus: 200,
                },
              ],
              total: 1,
              page: query.page || 1,
              pageSize: query.page_size || 20,
              hasMore: false,
              pageInfo: {
                mode: 'offset',
                page: query.page || 1,
                pageSize: query.page_size || 20,
                hasMore: false,
                totalItems: '1',
              },
            };
          },
          listLocalAiProxyMessageLogs: async (query) => {
            calls.push(`messageLogs:${query.page}:${query.page_size}:${query.q || ''}`);
            return {
              items: [
                {
                  id: 'msg_1',
                  requestLogId: 'req_1',
                  createdAt: 1743510000000,
                  routeId: 'provider-config-openai',
                  routeName: 'OpenAI',
                  providerId: 'openai',
                  clientProtocol: 'openai-compatible',
                  upstreamProtocol: 'openai-compatible',
                  modelId: 'gpt-5.4',
                  baseUrl: 'https://api.openai.com/v1',
                  messageCount: 2,
                  preview: 'Summarize this design.',
                  messages: [
                    { index: 0, role: 'system', content: 'You are helpful.' },
                    { index: 1, role: 'user', content: 'Summarize this design.' },
                  ],
                },
              ],
              total: 1,
              page: query.page || 1,
              pageSize: query.page_size || 20,
              hasMore: false,
              pageInfo: {
                mode: 'offset',
                page: query.page || 1,
                pageSize: query.page_size || 20,
                hasMore: false,
                totalItems: '1',
              },
            };
          },
          updateLocalAiProxyMessageCapture: async (enabled) => {
            calls.push(`capture:${enabled}`);
            return {
              enabled,
              updatedAt: 1743510001234,
            };
          },
        }),
      });

      const requestLogs = await service.listLocalAiProxyRequestLogs({
        page: 2,
        page_size: 10,
        q: 'openai',
      });
      const messageLogs = await service.listLocalAiProxyMessageLogs({
        page: 1,
        page_size: 5,
        q: 'summarize',
      });
      const capture = await service.updateLocalAiProxyMessageCapture(true);

      assert.deepEqual(calls, [
        'requestLogs:2:10:openai',
        'messageLogs:1:5:summarize',
        'capture:true',
      ]);
      assert.equal(requestLogs.items[0]?.id, 'req_1');
      assert.equal(requestLogs.items[0]?.promptTokens, 910);
      assert.equal(requestLogs.items[0]?.completionTokens, 840);
      assert.equal(requestLogs.items[0]?.cacheTokens, 50);
      assert.equal(messageLogs.items[0]?.messages.length, 2);
      assert.deepEqual(capture, {
        enabled: true,
        updatedAt: 1743510001234,
      });
    },
  );
} else {
  await runTest(
    'kernelPlatformService source keeps package-root imports and the shared snapshot contract',
    async () => {
      const source = await readKernelPlatformServiceSource();

      assert.match(source, /from '@sdkwork\/claw-infrastructure'/);
      assert.match(source, /from '@sdkwork\/claw-types'/);
      assert.match(source, /export interface KernelPlatformSnapshot/);
      assert.match(source, /runtimeId:\s*string;/);
      assert.match(source, /runtimeVersion\?:\s*string \| null;/);
    },
  );

  await runTest(
    'kernelPlatformService source maps shared provenance runtimeId and runtimeVersion without OpenClaw-only leakage',
    async () => {
      const source = await readKernelPlatformServiceSource();

      assert.match(source, /runtimeId:\s*status\.provenance\.runtimeId/);
      assert.match(source, /runtimeVersion:\s*status\.provenance\.runtimeVersion \?\? null/);
      assert.doesNotMatch(source, /openclawVersion:/);
    },
  );

  await runTest(
    'kernelPlatformService source delegates lifecycle and local ai proxy methods through the shared kernel bridge',
    async () => {
      const source = await readKernelPlatformServiceSource();

      assert.match(source, /resolveKernelPlatform\(\)\.ensureRunning\(\)/);
      assert.match(source, /resolveKernelPlatform\(\)\.restart\(\)/);
      assert.match(source, /resolveKernelPlatform\(\)\.listLocalAiProxyRequestLogs\(query\)/);
      assert.match(source, /resolveKernelPlatform\(\)\.listLocalAiProxyMessageLogs\(query\)/);
      assert.match(source, /resolveKernelPlatform\(\)\.updateLocalAiProxyMessageCapture\(enabled\)/);
    },
  );
}
