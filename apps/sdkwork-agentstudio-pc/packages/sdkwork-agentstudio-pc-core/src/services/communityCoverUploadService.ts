import type { DriveUploaderClient } from '@sdkwork/drive-app-sdk';
import { AGENTSTUDIO_PC_COMMUNITY_POST_COVER_UPLOAD } from '../sdk/uploadDeclaration.ts';
import { getDriveAppSdkClientWithSession } from '../sdk/useAppSdkClient.ts';

/**
 * Community post cover upload for the agent studio community surface.
 *
 * The picked image uploads through the Drive uploader with this application's
 * declared cover intent (`DRIVE_SPEC.md` §18 — the service layer, not the UI,
 * supplies declared values) and the caller stores the returned `drive://`
 * reference. Local object URLs stay presentation-only previews and are never
 * persisted.
 */

type CoverDriveUploader = Pick<DriveUploaderClient, 'uploadImage'>;

function driveUri(spaceId: string, nodeId: string): string {
  return `drive://spaces/${spaceId}/nodes/${nodeId}`;
}

export interface CommunityCoverUploadClient {
  uploader: CoverDriveUploader;
}

export function createCommunityCoverUploadService(
  getClient: () => CommunityCoverUploadClient = getDriveAppSdkClientWithSession,
) {
  return {
    /** Uploads the cover and returns the stable `drive://` reference. */
    async uploadCover(file: File): Promise<string> {
      const client = getClient();
      const result = await client.uploader.uploadImage({
        file,
        appResourceType: AGENTSTUDIO_PC_COMMUNITY_POST_COVER_UPLOAD.appResourceType,
        scene: AGENTSTUDIO_PC_COMMUNITY_POST_COVER_UPLOAD.scene,
        source: AGENTSTUDIO_PC_COMMUNITY_POST_COVER_UPLOAD.source,
        uploadProfileCode: AGENTSTUDIO_PC_COMMUNITY_POST_COVER_UPLOAD.uploadProfileCode,
        originalFileName: file.name,
        contentType: file.type || 'image/png',
        retention: { mode: 'long_term' },
      });
      const uploadItem = result.uploadItem;
      const uploadSession = result.uploadSession;
      const spaceId = uploadSession.spaceId || uploadItem.spaceId;
      const nodeId = uploadSession.nodeId || uploadItem.nodeId;
      if (!spaceId || !nodeId) {
        throw new Error('Drive cover upload completed without spaceId/nodeId.');
      }
      return driveUri(spaceId, nodeId);
    },
  };
}
