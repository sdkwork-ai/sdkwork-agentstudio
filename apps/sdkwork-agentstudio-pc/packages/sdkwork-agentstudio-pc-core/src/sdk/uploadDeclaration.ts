/**
 * Application upload declaration constants.
 *
 * Authority: `DRIVE_SPEC.md` section 18 (Application Upload Declaration Contract).
 * Declared values live in `apps/sdkwork-agentstudio-pc/specs/upload.declaration.json`; this module
 * carries them into code so upload call sites reference a constant instead of repeating literals.
 *
 * The call site previously defaulted to `chat-message-attachment` / `chat_message` /
 * `agent-studio-chat`, none of which matched the declaration. Sections 18.2 and 18.3 require the
 * declared values to be what is actually sent: `appResourceType` is a dotted
 * `<domain>.<resource>` business type, `scene` is a lowercase kebab-case label, and `source` is a
 * stable call-origin label rather than a module name.
 */

export interface AgentStudioPcUploadDeclarationEntry {
  readonly appResourceIdKind: 'application' | 'entity' | 'draft';
  readonly appResourceType: string;
  readonly purpose: string;
  readonly retention: 'long_term' | 'temporary';
  readonly scene: string;
  readonly source: string;
  readonly uploadProfileCode: string;
}

/** This application's canonical appId, from `sdkwork.app.config.json` `backend.appId`. */
export const AGENTSTUDIO_PC_APP_ID = 'sdkwork-agentstudio' as const;

/** The single call-origin label for every upload from this application. */
export const AGENTSTUDIO_PC_UPLOAD_SOURCE = 'sdkwork-agentstudio-pc' as const;

/** A file attached to an agent studio chat message. */
export const AGENTSTUDIO_PC_CHAT_MESSAGE_ATTACHMENT_UPLOAD = {
  appResourceIdKind: 'entity',
  appResourceType: 'chat.message_attachment',
  purpose:
    'File attached to an agent studio chat message so the conversation can reference out-of-band content.',
  retention: 'long_term',
  scene: 'chat-message',
  source: AGENTSTUDIO_PC_UPLOAD_SOURCE,
  uploadProfileCode: 'attachment',
} as const satisfies AgentStudioPcUploadDeclarationEntry;

/** Every declared upload purpose for this application. */
export const AGENTSTUDIO_PC_UPLOAD_DECLARATIONS: readonly AgentStudioPcUploadDeclarationEntry[] = [
  AGENTSTUDIO_PC_CHAT_MESSAGE_ATTACHMENT_UPLOAD,
];
