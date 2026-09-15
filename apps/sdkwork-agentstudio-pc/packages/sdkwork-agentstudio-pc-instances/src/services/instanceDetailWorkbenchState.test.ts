// WORKSPACE-PATH:allow-fixture: fixtures name a foreign checkout root, drive, or home directory to exercise path handling, so the literal is the value under assertion rather than a binding this build resolves
import assert from 'node:assert/strict';
import type { InstanceConfig, InstanceWorkbenchSnapshot } from '../types/index.ts';
import { startLoadInstanceDetailWorkbench } from './instanceDetailWorkbenchState.ts';

function runAsyncTest(name: string, fn: () => Promise<void>) {
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

function flushMicrotasks() {
  return new Promise<void>((resolve) => setTimeout(resolve, 0));
}

function createDeferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;

  const promise = new Promise<T>((nextResolve, nextReject) => {
    resolve = nextResolve;
    reject = nextReject;
  });

  return {
    promise,
    resolve,
    reject,
  };
}

function createWorkbench(id: string, port = '21280') {
  return {
    instance: {
      id,
    },
    config: {
      port,
      sandbox: true,
      autoUpdate: false,
      logLevel: 'info',
      corsOrigins: '*',
    },
  } as InstanceWorkbenchSnapshot;
}

function createDriftedConfigPathWorkbench(id: string) {
  const workbench = createWorkbench(id) as any;
  workbench.detail = {
    instance: {
      id,
      runtimeKind: 'openclaw',
      deploymentMode: 'local-managed',
      isBuiltIn: true,
      config: {
        workspacePath: 'C:/Users/admin/.sdkwork/crawstudio/.openclaw/workspace',
      },
    },
    config: {
      workspacePath: 'C:/Users/admin/.sdkwork/crawstudio/.openclaw/workspace',
    },
    lifecycle: {
      configWritable: true,
    },
    dataAccess: {
      routes: [
        {
          id: 'config-route',
          scope: 'config',
          mode: 'managedFile',
          readonly: false,
          target:
            'C:/ProgramData/SdkWork/CrawStudio/state/kernels/openclaw/noncanonical-config/openclaw.json',
        },
        {
          id: 'workspace-root',
          scope: 'files',
          mode: 'managedDirectory',
          readonly: false,
          target: 'C:/Users/admin/.sdkwork/crawstudio/.openclaw/workspace',
        },
      ],
    },
    artifacts: [
      {
        id: 'config-file',
        kind: 'configFile',
        location:
          'C:/ProgramData/SdkWork/CrawStudio/state/kernels/openclaw/noncanonical-config/openclaw.json',
      },
      {
        id: 'workspace-root',
        kind: 'workspaceDirectory',
        location: 'C:/Users/admin/.sdkwork/crawstudio/.openclaw/workspace',
      },
    ],
  };
  workbench.kernelConfig = {
    configFile:
      'C:/ProgramData/SdkWork/CrawStudio/state/kernels/openclaw/noncanonical-config/openclaw.json',
    configRoot: 'C:/ProgramData/SdkWork/CrawStudio/state/kernels/openclaw/noncanonical-config',
    userRoot: 'C:/ProgramData/SdkWork/CrawStudio/state/kernels/openclaw',
    standardConfigFile: 'C:/Users/admin/.sdkwork/crawstudio/.openclaw/openclaw.json',
    standardStateRoot: 'C:/Users/admin/.sdkwork/crawstudio/.openclaw',
    format: 'json',
    access: 'localFs',
    provenance: 'kernelAuthority',
    writable: true,
    resolved: true,
    schemaVersion: null,
    isStandardUserRootLayout: false,
  };
  return workbench as InstanceWorkbenchSnapshot;
}

await runAsyncTest(
  'startLoadInstanceDetailWorkbench loads the workbench through the injected loader and syncs config state',
  async () => {
    const nextWorkbench = createWorkbench('instance-1');
    const loadingStates: boolean[] = [];
    const captured = {
      workbench: createWorkbench('stale') as InstanceWorkbenchSnapshot | null,
      config: createWorkbench('stale').config as InstanceConfig | null,
      isLoading: false,
    };

    const request = startLoadInstanceDetailWorkbench({
      targetInstanceId: 'instance-1',
      setWorkbench: (value) => {
        captured.workbench =
          typeof value === 'function' ? value(captured.workbench) : value;
      },
      setConfig: (value) => {
        captured.config =
          typeof value === 'function' ? value(captured.config) : value;
      },
      setIsLoading: (value) => {
        captured.isLoading =
          typeof value === 'function' ? value(captured.isLoading) : value;
        loadingStates.push(captured.isLoading);
      },
      loadWorkbench: async (instanceId) => {
        assert.equal(instanceId, 'instance-1');
        return nextWorkbench;
      },
      reportError: (error) => {
        throw error;
      },
    });

    await request.promise;

    assert.deepEqual(loadingStates, [true, false]);
    assert.equal(captured.workbench, nextWorkbench);
    assert.equal(captured.config, nextWorkbench.config);
    assert.equal(captured.isLoading, false);
  },
);

await runAsyncTest(
  'startLoadInstanceDetailWorkbench normalizes drifted config workbench paths before syncing page state',
  async () => {
    const nextWorkbench = createDriftedConfigPathWorkbench('instance-1');
    const captured = {
      workbench: null as InstanceWorkbenchSnapshot | null,
      config: null as InstanceConfig | null,
      isLoading: false,
    };

    const request = startLoadInstanceDetailWorkbench({
      targetInstanceId: 'instance-1',
      setWorkbench: (value) => {
        captured.workbench =
          typeof value === 'function' ? value(captured.workbench) : value;
      },
      setConfig: (value) => {
        captured.config =
          typeof value === 'function' ? value(captured.config) : value;
      },
      setIsLoading: (value) => {
        captured.isLoading =
          typeof value === 'function' ? value(captured.isLoading) : value;
      },
      loadWorkbench: async () => nextWorkbench,
      reportError: (error) => {
        throw error;
      },
    });

    await request.promise;

    assert.equal(
      captured.workbench?.kernelConfig?.configFile,
      'C:/Users/admin/.sdkwork/crawstudio/.openclaw/openclaw.json',
    );
    assert.equal(
      captured.workbench?.detail.dataAccess.routes.find((route) => route.scope === 'config')?.target,
      'C:/Users/admin/.sdkwork/crawstudio/.openclaw/openclaw.json',
    );
    assert.equal(captured.config, nextWorkbench.config);
  },
);

await runAsyncTest(
  'startLoadInstanceDetailWorkbench clears page-owned workbench state on load failure when preserveStateOnError is disabled',
  async () => {
    const loadingStates: boolean[] = [];
    const captured = {
      workbench: createWorkbench('stale') as InstanceWorkbenchSnapshot | null,
      config: createWorkbench('stale').config as InstanceConfig | null,
      isLoading: false,
    };
    let reportedError: unknown = null;
    const failure = new Error('load failed');

    const request = startLoadInstanceDetailWorkbench({
      targetInstanceId: 'instance-1',
      setWorkbench: (value) => {
        captured.workbench =
          typeof value === 'function' ? value(captured.workbench) : value;
      },
      setConfig: (value) => {
        captured.config =
          typeof value === 'function' ? value(captured.config) : value;
      },
      setIsLoading: (value) => {
        captured.isLoading =
          typeof value === 'function' ? value(captured.isLoading) : value;
        loadingStates.push(captured.isLoading);
      },
      loadWorkbench: async () => {
        throw failure;
      },
      reportError: (error) => {
        reportedError = error;
      },
    });

    await request.promise;

    assert.deepEqual(loadingStates, [true, false]);
    assert.equal(captured.workbench, null);
    assert.equal(captured.config, null);
    assert.equal(captured.isLoading, false);
    assert.equal(reportedError, failure);
  },
);

await runAsyncTest(
  'startLoadInstanceDetailWorkbench preserves existing state on load failure when preserveStateOnError is enabled',
  async () => {
    const staleWorkbench = createWorkbench('stale');
    const loadingStates: boolean[] = [];
    const captured = {
      workbench: staleWorkbench as InstanceWorkbenchSnapshot | null,
      config: staleWorkbench.config as InstanceConfig | null,
      isLoading: false,
    };
    let reportedError: unknown = null;
    const failure = new Error('load failed');

    const request = startLoadInstanceDetailWorkbench({
      targetInstanceId: 'instance-1',
      preserveStateOnError: true,
      setWorkbench: (value) => {
        captured.workbench =
          typeof value === 'function' ? value(captured.workbench) : value;
      },
      setConfig: (value) => {
        captured.config =
          typeof value === 'function' ? value(captured.config) : value;
      },
      setIsLoading: (value) => {
        captured.isLoading =
          typeof value === 'function' ? value(captured.isLoading) : value;
        loadingStates.push(captured.isLoading);
      },
      loadWorkbench: async () => {
        throw failure;
      },
      reportError: (error) => {
        reportedError = error;
      },
    });

    await request.promise;

    assert.deepEqual(loadingStates, [true, false]);
    assert.equal(captured.workbench, staleWorkbench);
    assert.equal(captured.config, staleWorkbench.config);
    assert.equal(captured.isLoading, false);
    assert.equal(reportedError, failure);
  },
);

await runAsyncTest(
  'startLoadInstanceDetailWorkbench suppresses post-resolution updates after cancellation',
  async () => {
    const deferred = createDeferred<InstanceWorkbenchSnapshot | null>();
    const loadingStates: boolean[] = [];
    const captured = {
      workbench: null as InstanceWorkbenchSnapshot | null,
      config: null as InstanceConfig | null,
      isLoading: false,
    };

    const request = startLoadInstanceDetailWorkbench({
      targetInstanceId: 'instance-1',
      setWorkbench: (value) => {
        captured.workbench =
          typeof value === 'function' ? value(captured.workbench) : value;
      },
      setConfig: (value) => {
        captured.config =
          typeof value === 'function' ? value(captured.config) : value;
      },
      setIsLoading: (value) => {
        captured.isLoading =
          typeof value === 'function' ? value(captured.isLoading) : value;
        loadingStates.push(captured.isLoading);
      },
      loadWorkbench: async () => deferred.promise,
      reportError: (error) => {
        throw error;
      },
    });

    request.cancel();
    deferred.resolve(createWorkbench('instance-1'));

    await flushMicrotasks();
    await request.promise;

    assert.deepEqual(loadingStates, [true]);
    assert.equal(captured.workbench, null);
    assert.equal(captured.config, null);
    assert.equal(captured.isLoading, true);
  },
);
