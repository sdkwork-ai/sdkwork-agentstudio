import type {
  DriveUploaderClient,
  DriveUploaderUploadResult,
} from '@sdkwork/drive-app-sdk';
import {
  platform,
  type PlatformFetchedRemoteUrl,
} from '@sdkwork/agentstudio-pc-infrastructure';
import { uuid } from '@sdkwork/utils/id';
import { parseNumber } from '@sdkwork/utils/number';
import type {
  StudioConversationAttachment,
  StudioConversationAttachmentKind,
} from '@sdkwork/agentstudio-pc-types';
import {
  getAppSdkClientConfig,
  getDriveAppSdkClientWithSession,
} from '../sdk/useAppSdkClient.ts';
import { AGENTSTUDIO_PC_CHAT_MESSAGE_ATTACHMENT_UPLOAD } from '../sdk/uploadDeclaration.ts';

type ChatUploadDriveUploader = Pick<DriveUploaderClient, 'uploadAttachment'>;
type ChatUploadClient = {
  uploader: ChatUploadDriveUploader;
};

export interface ChatUploadContext {
  tenantId?: string;
  organizationId?: string;
  userId?: string;
  anonymousId?: string;
  operatorId?: string;
  appId?: string;
  appResourceType?: string;
  appResourceId?: string;
  scene?: string;
  source?: string;
}

export interface ChatUploadFileInput {
  data: Blob;
  fileName: string;
  kind?: StudioConversationAttachmentKind;
  contentType?: string;
  path?: string;
  appResourceId?: string;
}

export interface ChatUploadRemoteUrlInput {
  url: string;
  fileName?: string;
  kind?: StudioConversationAttachmentKind;
  contentType?: string;
  path?: string;
  appResourceId?: string;
}

export interface CreateChatUploadServiceOptions {
  getClient?: () => ChatUploadClient;
  fetchFn?: typeof fetch;
  fetchRemoteUrl?: (url: string) => Promise<PlatformFetchedRemoteUrl>;
  createId?: () => string;
  uploadContext?: ChatUploadContext;
}

export interface ChatUploadService {
  uploadFile(input: ChatUploadFileInput): Promise<StudioConversationAttachment>;
  uploadRemoteUrl(input: ChatUploadRemoteUrlInput): Promise<StudioConversationAttachment>;
}

function defaultCreateId() {
  return `asset-${uuid()}`;
}

function sanitizePathSegment(value: string) {
  return value
    .trim()
    .replace(/[^a-zA-Z0-9._-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

function sanitizeFileName(fileName: string) {
  const normalized = fileName.trim().replace(/[\\/:*?"<>|]+/g, '-');
  return normalized || 'upload.bin';
}

function inferAttachmentKind(
  kind: StudioConversationAttachmentKind | undefined,
  contentType: string,
): StudioConversationAttachmentKind {
  if (kind) {
    return kind;
  }

  if (contentType.startsWith('image/')) {
    return 'image';
  }
  if (contentType.startsWith('audio/')) {
    return 'audio';
  }
  if (contentType.startsWith('video/')) {
    return 'video';
  }

  return 'file';
}

function deriveFileNameFromUrl(url: string) {
  try {
    const pathname = new URL(url).pathname;
    const segment = pathname.split('/').filter(Boolean).pop();
    return segment ? decodeURIComponent(segment) : 'remote-resource';
  } catch {
    return 'remote-resource';
  }
}

async function fetchRemoteUrlWithFetch(
  fetchFn: typeof fetch,
  url: string,
): Promise<PlatformFetchedRemoteUrl> {
  const sourceResponse = await fetchFn(url, {
    method: 'GET',
  });

  if (!sourceResponse.ok) {
    throw new Error(
      `Failed to fetch ${url}: ${sourceResponse.status} ${sourceResponse.statusText}`.trim(),
    );
  }

  return {
    url: sourceResponse.url || url,
    bytes: new Uint8Array(await sourceResponse.arrayBuffer()),
    contentType: sourceResponse.headers.get('content-type')?.trim() || undefined,
  };
}

function toErrorMessage(error: unknown, fallback: string) {
  if (error instanceof Error && error.message.trim()) {
    return error.message;
  }
  if (typeof error === 'string' && error.trim()) {
    return error;
  }
  return fallback;
}

function driveUri(spaceId: string, nodeId: string) {
  return `drive://spaces/${spaceId}/nodes/${nodeId}`;
}

function numberFromString(value: string | undefined, fallback: number): number {
  if (!value) {
    return fallback;
  }
  return parseNumber(value) ?? fallback;
}

function resolveChatUploadContext(params: {
  base: ChatUploadContext;
  attachmentId: string;
  path?: string;
  appResourceId?: string;
}): Required<Pick<ChatUploadContext, 'tenantId' | 'operatorId' | 'appId' | 'appResourceType' | 'appResourceId' | 'scene' | 'source'>> &
  Pick<ChatUploadContext, 'organizationId' | 'userId' | 'anonymousId'> {
  const config = getAppSdkClientConfig();
  const appId = params.base.appId || 'agent-studio';
  const tenantId = params.base.tenantId || config?.tenantId;
  const userId = params.base.userId;
  const anonymousId = params.base.anonymousId || (userId ? undefined : `anonymous-${appId}`);
  const operatorId = params.base.operatorId || userId || anonymousId;
  const pathResource = params.path ? sanitizePathSegment(params.path) : '';
  const appResourceId =
    params.appResourceId ||
    params.base.appResourceId ||
    (pathResource ? `${pathResource}-${params.attachmentId}` : params.attachmentId);

  if (!tenantId) {
    throw new Error('Drive uploader requires a tenantId for agent-studio chat attachments.');
  }
  if (!operatorId) {
    throw new Error('Drive uploader requires a userId, anonymousId, or operatorId.');
  }

  return {
    tenantId,
    organizationId: params.base.organizationId || config?.organizationId,
    userId,
    anonymousId,
    operatorId,
    appId,
    appResourceType:
      params.base.appResourceType ||
      AGENTSTUDIO_PC_CHAT_MESSAGE_ATTACHMENT_UPLOAD.appResourceType,
    appResourceId,
    scene: params.base.scene || AGENTSTUDIO_PC_CHAT_MESSAGE_ATTACHMENT_UPLOAD.scene,
    source: params.base.source || AGENTSTUDIO_PC_CHAT_MESSAGE_ATTACHMENT_UPLOAD.source,
  };
}

function mapDriveUploadToAttachment(params: {
  result: DriveUploaderUploadResult;
  id: string;
  kind: StudioConversationAttachmentKind;
  fileName: string;
  contentType: string;
  sizeBytes: number;
  originalUrl?: string;
}): StudioConversationAttachment {
  const uploadItem = params.result.uploadItem;
  const uploadSession = params.result.uploadSession;
  const spaceId = uploadSession.spaceId || uploadItem.spaceId;
  const nodeId = uploadSession.nodeId || uploadItem.nodeId;

  return {
    id: params.id,
    kind: params.kind,
    name: uploadItem.originalFileName?.trim() || params.fileName,
    mimeType: uploadItem.contentType?.trim() || params.contentType,
    sizeBytes: numberFromString(uploadItem.contentLength, params.sizeBytes),
    fileId: nodeId,
    driveSpaceId: spaceId,
    driveNodeId: nodeId,
    driveUri: driveUri(spaceId, nodeId),
    originalUrl: params.originalUrl?.trim() || undefined,
  };
}

async function uploadAttachment(params: {
  uploader: ChatUploadDriveUploader;
  data: Blob;
  fileName: string;
  contentType: string;
  context: ReturnType<typeof resolveChatUploadContext>;
}): Promise<DriveUploaderUploadResult> {
  return params.uploader.uploadAttachment({
    file: params.data,
    tenantId: params.context.tenantId,
    organizationId: params.context.organizationId,
    userId: params.context.userId,
    anonymousId: params.context.anonymousId,
    operatorId: params.context.operatorId,
    appId: params.context.appId,
    appResourceType: params.context.appResourceType,
    appResourceId: params.context.appResourceId,
    scene: params.context.scene,
    source: params.context.source,
    uploadProfileCode: 'attachment',
    originalFileName: params.fileName,
    contentType: params.contentType,
    retention: {
      mode: 'long_term',
    },
  });
}

export function createChatUploadService(
  options: CreateChatUploadServiceOptions = {},
): ChatUploadService {
  const getClient = options.getClient ?? getDriveAppSdkClientWithSession;
  const fetchFn = options.fetchFn ?? fetch;
  const fetchRemoteUrl =
    options.fetchRemoteUrl ??
    ((url: string) =>
      platform.getPlatform() === 'desktop'
        ? platform.fetchRemoteUrl(url)
        : fetchRemoteUrlWithFetch(fetchFn, url));
  const createId = options.createId ?? defaultCreateId;
  const uploadContext = options.uploadContext ?? {};

  return {
    async uploadFile(input) {
      const attachmentId = createId();
      const client = getClient();
      const fileName = sanitizeFileName(input.fileName);
      const contentType =
        (input.contentType || input.data.type || 'application/octet-stream').trim();
      const size = input.data.size;
      const kind = inferAttachmentKind(input.kind, contentType);
      const context = resolveChatUploadContext({
        base: uploadContext,
        attachmentId,
        path: input.path,
        appResourceId: input.appResourceId,
      });

      try {
        const result = await uploadAttachment({
          uploader: client.uploader,
          data: input.data,
          fileName,
          contentType,
          context,
        });

        return mapDriveUploadToAttachment({
          result,
          id: attachmentId,
          kind,
          fileName,
          contentType,
          sizeBytes: size,
        });
      } catch (error) {
        throw new Error(
          `Failed to upload ${fileName}: ${toErrorMessage(error, 'Unknown upload error')}`,
        );
      }
    },

    async uploadRemoteUrl(input) {
      const remoteFile = await fetchRemoteUrl(input.url);
      const contentType =
        (
          input.contentType ||
          remoteFile.contentType ||
          'application/octet-stream'
        ).trim();
      const data = new Blob([new Uint8Array(remoteFile.bytes)], {
        type: contentType,
      });
      const fileName = sanitizeFileName(
        input.fileName ||
          remoteFile.fileName ||
          deriveFileNameFromUrl(remoteFile.url || input.url),
      );

      try {
        const attachment = await this.uploadFile({
          data,
          fileName,
          kind: input.kind,
          contentType,
          path: input.path,
          appResourceId: input.appResourceId,
        });

        return {
          ...attachment,
          originalUrl: input.url,
        };
      } catch (error) {
        throw new Error(
          `Failed to upload ${fileName} from ${input.url}: ${toErrorMessage(error, 'Unknown upload error')}`,
        );
      }
    },
  };
}

export const chatUploadService = createChatUploadService();
