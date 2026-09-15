// WORKSPACE-PATH:allow-fixture: fixtures name a foreign checkout root, drive, or home directory to exercise path handling, so the literal is the value under assertion rather than a binding this build resolves
import assert from 'node:assert/strict';
import {
  DEFAULT_BUNDLED_OPENCLAW_VERSION,
  DEFAULT_REQUIRED_OPENCLAW_NODE_VERSION,
  type OpenClawMirrorExportPreview,
  type OpenClawMirrorExportRequest,
  type OpenClawMirrorExportResult,
  type OpenClawMirrorImportPreview,
  type OpenClawMirrorImportRequest,
  type OpenClawMirrorImportResult,
} from '@sdkwork/agentstudio-pc-types';

const DEFAULT_OPENCLAW_INSTALL_KEY = `${DEFAULT_BUNDLED_OPENCLAW_VERSION}-windows-x64`;

async function runTest(name: string, callback: () => Promise<void> | void) {
  try {
    await callback();
    console.log(`ok - ${name}`);
  } catch (error) {
    console.error(`not ok - ${name}`);
    throw error;
  }
}

function createPreview(
  overrides: Partial<OpenClawMirrorExportPreview> = {},
): OpenClawMirrorExportPreview {
  return {
    mode: 'full-private',
    runtime: {
      runtimeId: 'openclaw',
      installKey: DEFAULT_OPENCLAW_INSTALL_KEY,
      openclawVersion: DEFAULT_BUNDLED_OPENCLAW_VERSION,
      nodeVersion: DEFAULT_REQUIRED_OPENCLAW_NODE_VERSION,
      platform: 'windows',
      arch: 'x64',
      homeDir: 'C:/Users/admin',
      stateDir: 'C:/Users/admin/.openclaw',
      workspaceDir: 'C:/Users/admin/.openclaw/workspace',
      configFile: 'C:/Users/admin/.openclaw/openclaw.json',
      gatewayPort: 21280,
    },
    components: [
      {
        id: 'config',
        kind: 'config',
        relativePath: 'components/config/openclaw.json',
        sourcePath:
          'C:/Users/admin/.openclaw/openclaw.json',
      },
      {
        id: 'state',
        kind: 'state',
        relativePath: 'components/state',
        sourcePath: 'C:/Users/admin/.openclaw',
      },
      {
        id: 'workspace',
        kind: 'workspace',
        relativePath: 'components/workspace',
        sourcePath:
          'C:/Users/admin/.openclaw/workspace',
      },
    ],
    manifest: {
      schemaVersion: 1,
      mirrorVersion: '1.0.0',
      mode: 'full-private',
      createdAt: '2026-04-03T08:00:00.000Z',
      runtime: {
        runtimeId: 'openclaw',
        installKey: DEFAULT_OPENCLAW_INSTALL_KEY,
        openclawVersion: DEFAULT_BUNDLED_OPENCLAW_VERSION,
        nodeVersion: DEFAULT_REQUIRED_OPENCLAW_NODE_VERSION,
        platform: 'windows',
        arch: 'x64',
      },
      components: [
        {
          id: 'config',
          kind: 'config',
          relativePath: 'components/config/openclaw.json',
        },
        {
          id: 'state',
          kind: 'state',
          relativePath: 'components/state',
        },
        {
          id: 'workspace',
          kind: 'workspace',
          relativePath: 'components/workspace',
        },
      ],
    },
    ...overrides,
  };
}

function createExportRequest(
  overrides: Partial<OpenClawMirrorExportRequest> = {},
): OpenClawMirrorExportRequest {
  return {
    mode: 'full-private',
    destinationPath: 'C:/Users/admin/Desktop/openclaw-full-private.ocmirror',
    ...overrides,
  };
}

function createExportResult(
  overrides: Partial<OpenClawMirrorExportResult> = {},
): OpenClawMirrorExportResult {
  return {
    destinationPath: 'C:/Users/admin/Desktop/openclaw-full-private.ocmirror',
    fileName: 'openclaw-full-private.ocmirror',
    fileSizeBytes: 4096,
    manifest: createPreview().manifest,
    components: createPreview().components,
    exportedAt: '2026-04-03T08:00:01.000Z',
    ...overrides,
  };
}

function createImportPreview(
  overrides: Partial<OpenClawMirrorImportPreview> = {},
): OpenClawMirrorImportPreview {
  return {
    sourcePath: 'C:/Users/admin/Desktop/openclaw-full-private.ocmirror',
    mode: 'full-private',
    manifest: createPreview().manifest,
    components: createPreview().manifest.components,
    detectedRuntime: {
      runtimeId: 'openclaw',
      installKey: DEFAULT_OPENCLAW_INSTALL_KEY,
      openclawVersion: DEFAULT_BUNDLED_OPENCLAW_VERSION,
      nodeVersion: DEFAULT_REQUIRED_OPENCLAW_NODE_VERSION,
      platform: 'windows',
      arch: 'x64',
    },
    warnings: [],
    ...overrides,
  };
}

function createImportRequest(
  overrides: Partial<OpenClawMirrorImportRequest> = {},
): OpenClawMirrorImportRequest {
  return {
    sourcePath: 'C:/Users/admin/Desktop/openclaw-full-private.ocmirror',
    createSafetySnapshot: true,
    restartGateway: true,
    ...overrides,
  };
}

function createImportResult(
  overrides: Partial<OpenClawMirrorImportResult> = {},
): OpenClawMirrorImportResult {
  return {
    sourcePath: 'C:/Users/admin/Desktop/openclaw-full-private.ocmirror',
    importedAt: '2026-04-03T08:00:02.000Z',
    manifest: createPreview().manifest,
    restoredComponents: createPreview().manifest.components,
    gatewayWasRunning: true,
    gatewayRunningAfterImport: true,
    safetySnapshot: {
      destinationPath: 'C:/Users/admin/Desktop/snapshots/openclaw-safety.ocmirror',
      fileName: 'openclaw-safety.ocmirror',
      fileSizeBytes: 8192,
      createdAt: '2026-04-03T08:00:01.500Z',
    },
    verification: {
      checkedAt: '2026-04-03T08:00:02.500Z',
      status: 'ready',
      checks: [
        {
          id: 'openclaw-config-file',
          label: 'OpenClaw config file restored',
          status: 'passed',
          detail:
            'Restored OpenClaw config file is present on disk and readable after import.',
        },
        {
          id: 'managed-state',
          label: 'Managed state restored',
          status: 'passed',
          detail:
            'Restored OpenClaw state directory is present on disk after import.',
        },
        {
          id: 'managed-workspace',
          label: 'Managed workspace restored',
          status: 'passed',
          detail:
            'Restored OpenClaw workspace directory is present on disk after import.',
        },
        {
          id: 'provider-center-catalog',
          label: 'Provider Center catalog restored',
          status: 'passed',
          detail: 'Restored 1 Provider Center route records into storage.',
        },
        {
          id: 'local-proxy',
          label: 'Local proxy projected',
          status: 'passed',
          detail:
            'Local proxy is running and serving the restored default route on the projected base URL.',
        },
        {
          id: 'managed-openclaw-provider',
          label: 'OpenClaw provider projected',
          status: 'passed',
          detail:
            'Managed sdkwork-local-proxy provider was written into openclaw.json with restored defaults.',
        },
        {
          id: 'gateway',
          label: 'Gateway state matches request',
          status: 'passed',
          detail:
            'Gateway running state after import matches the requested post-restore behavior.',
        },
      ],
    },
    ...overrides,
  };
}

await runTest(
  'openClawMirrorService inspects and exports mirrors through the shared kernel bridge',
  async () => {
    const { createOpenClawMirrorService } = await import('./openClawMirrorService.ts');

    const calls: string[] = [];
    const preview = createPreview();
    const result = createExportResult();
    const request = createExportRequest();

    const service = createOpenClawMirrorService({
      getKernelPlatform: () => ({
        getInfo: async () => null,
        getStorageInfo: async () => null,
        getStatus: async () => null,
        ensureRunning: async () => null,
        restart: async () => null,
        testLocalAiProxyRoute: async () => null,
        listLocalAiProxyRequestLogs: async () => ({
          items: [],
          total: 0,
          page: 1,
          pageSize: 20,
          hasMore: false,
          pageInfo: {
            mode: 'offset',
            page: 1,
            page_size: 20,
            has_more: false,
            total: 0,
          },
        }),
        listLocalAiProxyMessageLogs: async () => ({
          items: [],
          total: 0,
          page: 1,
          pageSize: 20,
          hasMore: false,
          pageInfo: {
            mode: 'offset',
            page: 1,
            page_size: 20,
            has_more: false,
            total: 0,
          },
        }),
        updateLocalAiProxyMessageCapture: async (enabled) => ({
          enabled,
          updatedAt: null,
        }),
        inspectOpenClawMirrorExport: async () => {
          calls.push('inspect');
          return preview;
        },
        exportOpenClawMirror: async (currentRequest) => {
          calls.push(`export:${currentRequest.destinationPath}`);
          return result;
        },
      }),
    });

    const inspected = await service.inspectOpenClawMirrorExport();
    const exported = await service.exportOpenClawMirror(request);

    assert.deepEqual(calls, ['inspect', `export:${request.destinationPath}`]);
    assert.equal(inspected?.mode, 'full-private');
    assert.equal(inspected?.runtime.openclawVersion, DEFAULT_BUNDLED_OPENCLAW_VERSION);
    assert.equal(inspected?.runtime.configFile, 'C:/Users/admin/.openclaw/openclaw.json');
    assert.equal(exported.fileName, 'openclaw-full-private.ocmirror');
    assert.equal(exported.components.length, 3);
    assert.equal(exported.manifest.mode, 'full-private');
  },
);

await runTest(
  'openClawMirrorService inspects and imports mirrors through the shared kernel bridge',
  async () => {
    const { createOpenClawMirrorService } = await import('./openClawMirrorService.ts');

    const calls: string[] = [];
    const preview = createImportPreview();
    const result = createImportResult();
    const request = createImportRequest();

    const service = createOpenClawMirrorService({
      getKernelPlatform: () => ({
        getInfo: async () => null,
        getStorageInfo: async () => null,
        getStatus: async () => null,
        ensureRunning: async () => null,
        restart: async () => null,
        testLocalAiProxyRoute: async () => null,
        listLocalAiProxyRequestLogs: async () => ({
          items: [],
          total: 0,
          page: 1,
          pageSize: 20,
          hasMore: false,
          pageInfo: {
            mode: 'offset',
            page: 1,
            page_size: 20,
            has_more: false,
            total: 0,
          },
        }),
        listLocalAiProxyMessageLogs: async () => ({
          items: [],
          total: 0,
          page: 1,
          pageSize: 20,
          hasMore: false,
          pageInfo: {
            mode: 'offset',
            page: 1,
            page_size: 20,
            has_more: false,
            total: 0,
          },
        }),
        updateLocalAiProxyMessageCapture: async (enabled) => ({
          enabled,
          updatedAt: null,
        }),
        inspectOpenClawMirrorExport: async () => createPreview(),
        exportOpenClawMirror: async () => createExportResult(),
        inspectOpenClawMirrorImport: async (sourcePath) => {
          calls.push(`inspectImport:${sourcePath}`);
          return preview;
        },
        importOpenClawMirror: async (currentRequest) => {
          calls.push(`import:${currentRequest.sourcePath}`);
          return result;
        },
      }),
    });

    const inspected = await service.inspectOpenClawMirrorImport(request.sourcePath);
    const imported = await service.importOpenClawMirror(request);

    assert.deepEqual(calls, [
      `inspectImport:${request.sourcePath}`,
      `import:${request.sourcePath}`,
    ]);
    assert.equal(inspected?.mode, 'full-private');
    assert.equal(inspected?.manifest.mode, 'full-private');
    assert.equal(imported.sourcePath, request.sourcePath);
    assert.equal(imported.restoredComponents.length, 3);
    assert.equal(imported.safetySnapshot?.fileName, 'openclaw-safety.ocmirror');
    assert.equal(imported.verification.status, 'ready');
    assert.equal(imported.verification.checks.length, 7);
    assert.ok(
      imported.verification.checks.some(
        (check) => check.id === 'local-proxy' && check.status === 'passed',
      ),
    );
  },
);
