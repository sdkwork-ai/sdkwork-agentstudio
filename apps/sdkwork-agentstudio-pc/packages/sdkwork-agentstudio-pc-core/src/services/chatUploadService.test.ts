import assert from 'node:assert/strict';
import type { PlatformAPI } from '@sdkwork/agentstudio-pc-infrastructure';
import { createChatUploadService } from './chatUploadService.ts';

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
    getPlatform: () => 'web',
    getDeviceId: async () => 'test-device',
    setStorage: async () => {},
    getStorage: async () => null,
    copy: async () => {},
    openExternal: async () => {},
    supportsNativeScreenshot: () => false,
    captureScreenshot: async () => null,
    fetchRemoteUrl: async (url) => {
      throw new Error(`fetchRemoteUrl stub not configured for ${url}`);
    },
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
    readFile: async () => '',
    readFileForUserTooling: async () => '',
    writeFile: async () => {},
    ...overrides,
  };
}

function createDriveUploadResult(overrides: {
  originalFileName?: string;
  contentType?: string;
  contentLength?: string;
  uploadProfileCode?: string;
  spaceId?: string;
  nodeId?: string;
} = {}) {
  const originalFileName = overrides.originalFileName ?? 'Screen Shot 2026-03-22.png';
  const contentType = overrides.contentType ?? 'image/png';
  const contentLength = overrides.contentLength ?? '11';
  const uploadProfileCode = overrides.uploadProfileCode ?? 'attachment';
  const spaceId = overrides.spaceId ?? 'space-chat';
  const nodeId = overrides.nodeId ?? 'node-chat-001';

  return {
    uploadItem: {
      id: 'upload-item-001',
      taskId: 'task-chat-001',
      tenantId: '100001',
      actorType: 'anonymous',
      actorId: 'anonymous-agent-studio',
      appId: 'agent-studio',
      appResourceType: 'chat-message-attachment',
      appResourceId: 'draft-attachment',
      uploadProfileCode,
      fileFingerprint: 'fingerprint-001',
      spaceId,
      nodeId,
      uploadSessionId: 'upload-session-001',
      originalFileName,
      contentType,
      contentTypeGroup: contentType.split('/')[0] || 'application',
      contentLength,
      chunkSizeBytes: '8388608',
      totalParts: '1',
      uploadedPartsCount: '1',
      uploadedBytes: contentLength,
      status: 'completed',
      retentionMode: 'long_term',
      cleanupStatus: 'not_required',
      postProcessStatus: 'not_required',
      scene: 'chat_message',
      source: 'agent-studio-chat',
    },
    uploadSession: {
      id: 'upload-session-001',
      tenantId: '100001',
      spaceId,
      nodeId,
      bucket: 'drive-internal',
      objectKey: 'drive/object/key',
      state: 'completed' as const,
      expiresAtEpochMs: '1774108800000',
      version: '1',
      storageProviderId: 'storage-provider-001',
      storageUploadId: 'storage-upload-001',
    },
    parts: [
      {
        partNo: 1,
        etag: '"etag-001"',
        offsetBytes: 0,
        sizeBytes: Number(contentLength),
      },
    ],
  };
}

await runTest('chatUploadService normalizes Drive uploader request attribution and attachment payload', async () => {
  const driveRequests: Array<Record<string, unknown>> = [];
  const service = createChatUploadService({
    createId: () => 'asset-fixed',
    getClient: () => ({
      uploader: {
        uploadAttachment: async (request: Record<string, unknown>) => {
          driveRequests.push(request);
          return createDriveUploadResult();
        },
      },
    }),
    uploadContext: {
      tenantId: '100001',
      organizationId: '0',
      userId: 'user-001',
      appResourceId: 'draft-attachment',
    },
  });

  const blob = new Blob(['image-bytes'], { type: 'image/png' });
  const result = await service.uploadFile({
    fileName: 'Screen Shot 2026-03-22.png',
    kind: 'screenshot',
    data: blob,
    path: 'chat',
  });

  assert.equal(driveRequests.length, 1);
  assert.equal(driveRequests[0]?.file, blob);
  assert.equal(driveRequests[0]?.tenantId, '100001');
  assert.equal(driveRequests[0]?.organizationId, '0');
  assert.equal(driveRequests[0]?.userId, 'user-001');
  assert.equal(driveRequests[0]?.appId, 'agent-studio');
  assert.equal(driveRequests[0]?.appResourceType, 'chat.message_attachment');
  assert.equal(driveRequests[0]?.appResourceId, 'draft-attachment');
  assert.equal(driveRequests[0]?.scene, 'chat-message');
  assert.equal(driveRequests[0]?.source, 'sdkwork-agentstudio-pc');
  assert.equal(driveRequests[0]?.uploadProfileCode, 'attachment');
  assert.deepEqual(driveRequests[0]?.retention, { mode: 'long_term' });

  assert.equal(result.id, 'asset-fixed');
  assert.equal(result.kind, 'screenshot');
  assert.equal(result.name, 'Screen Shot 2026-03-22.png');
  assert.equal(result.mimeType, 'image/png');
  assert.equal(result.sizeBytes, 11);
  assert.equal(result.fileId, 'node-chat-001');
  assert.equal(result.driveSpaceId, 'space-chat');
  assert.equal(result.driveNodeId, 'node-chat-001');
  assert.equal(result.driveUri, 'drive://spaces/space-chat/nodes/node-chat-001');
  assert.equal(result.objectKey, undefined);
  assert.equal(result.url, undefined);
  assert.equal(result.previewUrl, undefined);
});

await runTest('chatUploadService can fetch a remote URL, upload it with Drive uploader, and preserve the original source URL', async () => {
  const fetchCalls: string[] = [];
  const driveRequests: Array<Record<string, unknown>> = [];
  const service = createChatUploadService({
    createId: () => 'asset-url',
    fetchFn: async (input) => {
      const url = String(input);
      fetchCalls.push(url);

      if (url === 'https://remote.example.com/demo.mp3') {
        return new Response(new Blob(['voice-bytes'], { type: 'audio/mpeg' }), {
          status: 200,
          headers: {
            'Content-Type': 'audio/mpeg',
          },
        });
      }

      throw new Error(`Unexpected fetch call ${url}`);
    },
    getClient: () => ({
      uploader: {
        uploadAttachment: async (request: Record<string, unknown>) => {
          driveRequests.push(request);
          return createDriveUploadResult({
            originalFileName: 'demo.mp3',
            contentType: 'audio/mpeg',
            contentLength: '11',
            nodeId: 'node-audio',
          });
        },
      },
    }),
    uploadContext: {
      tenantId: '100001',
      anonymousId: 'anonymous-chat',
      appResourceId: 'draft-audio',
    },
  });

  const result = await service.uploadRemoteUrl({
    url: 'https://remote.example.com/demo.mp3',
    fileName: 'demo.mp3',
    kind: 'audio',
  });

  assert.deepEqual(fetchCalls, ['https://remote.example.com/demo.mp3']);
  assert.equal(driveRequests.length, 1);
  assert.equal(driveRequests[0]?.anonymousId, 'anonymous-chat');
  assert.equal(driveRequests[0]?.contentType, 'audio/mpeg');
  assert.equal(result.kind, 'audio');
  assert.equal(result.originalUrl, 'https://remote.example.com/demo.mp3');
  assert.equal(result.driveUri, 'drive://spaces/space-chat/nodes/node-audio');
});

await runTest('chatUploadService prefers the desktop native remote fetch bridge for URL imports when available', async () => {
  const { configurePlatformBridge, getPlatformBridge } = await import('@sdkwork/agentstudio-pc-infrastructure');
  const originalBridge = getPlatformBridge();
  const nativeFetchCalls: string[] = [];
  const browserFetchCalls: string[] = [];

  configurePlatformBridge({
    platform: createPlatformBridgeStub({
      getPlatform: () => 'desktop',
      fetchRemoteUrl: async (url) => {
        nativeFetchCalls.push(url);
        return {
          url,
          fileName: 'native-demo.mp3',
          contentType: 'audio/mpeg',
          bytes: new TextEncoder().encode('native-voice-bytes'),
        };
      },
    }),
  });

  try {
    const service = createChatUploadService({
      createId: () => 'asset-native-url',
      fetchFn: async (input) => {
        browserFetchCalls.push(String(input));
        throw new Error('browser fetch should not be used for desktop remote imports');
      },
      getClient: () => ({
        uploader: {
          uploadAttachment: async () =>
            createDriveUploadResult({
              originalFileName: 'native-demo.mp3',
              contentType: 'audio/mpeg',
              contentLength: '18',
              nodeId: 'node-native-audio',
            }),
        },
      }),
      uploadContext: {
        tenantId: '100001',
        anonymousId: 'anonymous-native',
      },
    });

    const result = await service.uploadRemoteUrl({
      url: 'https://remote.example.com/native-demo.mp3',
      kind: 'audio',
    });

    assert.deepEqual(nativeFetchCalls, ['https://remote.example.com/native-demo.mp3']);
    assert.deepEqual(browserFetchCalls, []);
    assert.equal(result.name, 'native-demo.mp3');
    assert.equal(result.mimeType, 'audio/mpeg');
    assert.equal(result.originalUrl, 'https://remote.example.com/native-demo.mp3');
    assert.equal(result.driveUri, 'drive://spaces/space-chat/nodes/node-native-audio');
  } finally {
    configurePlatformBridge(originalBridge);
  }
});

await runTest('chatUploadService resolves the desktop native remote fetch bridge at call time instead of service creation time', async () => {
  const { configurePlatformBridge, getPlatformBridge } = await import('@sdkwork/agentstudio-pc-infrastructure');
  const originalBridge = getPlatformBridge();
  const nativeFetchCalls: string[] = [];
  const browserFetchCalls: string[] = [];

  const service = createChatUploadService({
    createId: () => 'asset-late-native-url',
    fetchFn: async (input) => {
      browserFetchCalls.push(String(input));
      return new Response(new Blob(['browser-voice'], { type: 'audio/mpeg' }), {
        status: 200,
        headers: {
          'Content-Type': 'audio/mpeg',
        },
      });
    },
    getClient: () => ({
      uploader: {
        uploadAttachment: async () =>
          createDriveUploadResult({
            originalFileName: 'late-native.mp3',
            contentType: 'audio/mpeg',
            contentLength: '19',
            nodeId: 'node-late-native',
          }),
      },
    }),
    uploadContext: {
      tenantId: '100001',
      anonymousId: 'anonymous-late',
    },
  });

  configurePlatformBridge({
    platform: createPlatformBridgeStub({
      getPlatform: () => 'desktop',
      fetchRemoteUrl: async (url) => {
        nativeFetchCalls.push(url);
        return {
          url,
          fileName: 'late-native.mp3',
          contentType: 'audio/mpeg',
          bytes: new TextEncoder().encode('native-after-create'),
        };
      },
    }),
  });

  try {
    const result = await service.uploadRemoteUrl({
      url: 'https://remote.example.com/late-native.mp3',
      kind: 'audio',
    });

    assert.deepEqual(nativeFetchCalls, ['https://remote.example.com/late-native.mp3']);
    assert.deepEqual(browserFetchCalls, []);
    assert.equal(result.name, 'late-native.mp3');
    assert.equal(result.originalUrl, 'https://remote.example.com/late-native.mp3');
    assert.equal(result.driveUri, 'drive://spaces/space-chat/nodes/node-late-native');
  } finally {
    configurePlatformBridge(originalBridge);
  }
});

await runTest('chatUploadService surfaces a helpful error when Drive uploader rejects the upload', async () => {
  const service = createChatUploadService({
    getClient: () => ({
      uploader: {
        uploadAttachment: async () => {
          throw new Error('Drive uploader rejected the content type.');
        },
      },
    }),
    uploadContext: {
      tenantId: '100001',
      anonymousId: 'anonymous-error',
    },
  });

  await assert.rejects(
    () =>
      service.uploadFile({
        fileName: 'rejected.png',
        kind: 'image',
        data: new Blob(['bad'], { type: 'image/png' }),
      }),
    /rejected\.png.*Drive uploader rejected/i,
  );
});
