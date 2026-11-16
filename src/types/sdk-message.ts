/*
 * postMessage protocol between the SDK (host page) and the widget iframe.
 *
 * Handshake:
 * 1. The SDK mounts <iframe src="https://APP/widget?projectKey=...&hostOrigin=<host location.origin>">.
 * 2. The iframe posts 'ready' to window.parent with targetOrigin = hostOrigin
 *    (read from its own query string). It never posts with targetOrigin '*'.
 * 3. The SDK answers with 'init' via iframe.contentWindow.postMessage, targetOrigin = APP origin
 *    (derived from the sdk.js script src). Later 'reporter:update' / 'page:update' use the same target.
 * 4. The widget posts 'close' / 'submitted' to the parent, again with targetOrigin = hostOrigin.
 *
 * Receiving rule (both sides): accept a message ONLY when
 *   - event.origin === the expected origin (SDK expects APP origin, widget expects hostOrigin), AND
 *   - event.source === the expected window (SDK: iframe.contentWindow, widget: window.parent), AND
 *   - the guard from '@/lib/sdk-protocol' passes (isWidgetToHostMessage / isHostToWidgetMessage).
 * Anything else is ignored silently.
 *
 * Large preview of a saved screen:
 * 1. The widget creates a MessageChannel, queues 'preview:content' on one port and posts 'preview:open'
 *    to the SDK with the other port as a transferable.
 * 2. The SDK mounts a second panel with <iframe src="https://APP/widget/preview?...">. That iframe posts
 *    'preview:ready' to window.parent; the SDK answers 'preview:connect', transferring the widget's port.
 *    The SDK never reads from the port, so a saved screen goes from the widget to the preview directly
 *    and does not pass through the host page a second time.
 * 3. 'preview:close' (from the widget or the preview iframe) or the SDK itself ends the preview; the SDK
 *    then tells the widget with 'preview:closed'.
 * The same receiving rule applies to the preview iframe (it expects hostOrigin and window.parent). A port
 * message carries no origin, so its content is checked by shape alone (isPreviewContentMessage).
 */
import type { ElementTarget, FeedbackAttachments, FeedbackReporter, PageContext } from '@/types/feedback';
import type { ScreenCapture, ScreenCaptureFailureReason } from '@/types/screen-snapshot';

export const MESSAGE_SOURCE = 'lattice-feedback' as const;
export const PROTOCOL_VERSION = 1 as const;

type EmptyPayload = Record<string, never>;

type ProtocolMessage<TType extends string, TPayload> = {
  source: typeof MESSAGE_SOURCE;
  version: typeof PROTOCOL_VERSION;
  type: TType;
  payload: TPayload;
};

export type InitMessage = ProtocolMessage<
  'init',
  { projectKey: string; reporter: FeedbackReporter | null; page: PageContext }
>;
export type ReporterUpdateMessage = ProtocolMessage<'reporter:update', { reporter: FeedbackReporter | null }>;
export type PageUpdateMessage = ProtocolMessage<'page:update', { page: PageContext }>;

export type CaptureMode = 'comment' | 'edit' | 'flow';
export type AttachmentKind = 'comments' | 'edits' | 'flow';
export interface CaptureState {
  enabled: boolean;
  activeMode: CaptureMode | null;
  selection: ElementTarget | null;
  attachments: FeedbackAttachments;
  /** Stable key of each comment, in the same order as attachments.comments. */
  commentKeys: string[];
  /** Stable key of each edit, in the same order as attachments.edits. */
  editKeys: string[];
  flowEventCount: number;
  errorMessage: string | null;
}
export type CaptureUpdateMessage = ProtocolMessage<'capture:update', CaptureState>;

// Saved screens: the widget asks with 'screen:capture', the SDK serializes the host page and answers once.
// Several saves can run at once, so each answer carries the id of the request it answers.
export interface ScreenCaptureRequest {
  requestId: string;
}
export type ScreenCapturedMessage = ProtocolMessage<'screen:captured', ScreenCapture & ScreenCaptureRequest>;
export type ScreenCaptureFailedMessage = ProtocolMessage<'screen:capture-failed', ScreenCaptureRequest & { reason: ScreenCaptureFailureReason }>;

// Each preview has an id, so a 'preview:closed' that arrives after the widget opened the next one is ignored.
export interface PreviewRequest {
  previewId: string;
}
/** Posted with exactly one MessagePort as a transferable. */
export type PreviewOpenMessage = ProtocolMessage<'preview:open', PreviewRequest>;
export type PreviewCloseMessage = ProtocolMessage<'preview:close', EmptyPayload>;
/** Sent for every preview that ends, whoever closed it. */
export type PreviewClosedMessage = ProtocolMessage<'preview:closed', PreviewRequest>;

export type HostToWidgetMessage =
  | ProtocolMessage<'visibility:update', { isOpen: boolean }>
  | InitMessage
  | ReporterUpdateMessage
  | PageUpdateMessage
  | ScreenCapturedMessage
  | ScreenCaptureFailedMessage
  | PreviewClosedMessage;

export type ReadyMessage = ProtocolMessage<'ready', EmptyPayload>;
export type CloseMessage = ProtocolMessage<'close', EmptyPayload>;
export type SubmittedMessage = ProtocolMessage<'submitted', { feedbackId: string }>;
export type CaptureStartMessage = ProtocolMessage<'capture:start', { mode: CaptureMode }>;
export type CaptureCancelMessage = ProtocolMessage<'capture:cancel', EmptyPayload>;
export type FlowStopMessage = ProtocolMessage<'flow:stop', EmptyPayload>;
export type CommentAddMessage = ProtocolMessage<'comment:add', { comment: string }>;
export type AttachmentRemoveMessage = ProtocolMessage<'attachment:remove', { kind: AttachmentKind; index: number }>;
export type DraftResetMessage = ProtocolMessage<'draft:reset', EmptyPayload>;
export type CaptureCommand = CaptureStartMessage | CaptureCancelMessage | FlowStopMessage |
  CommentAddMessage | AttachmentRemoveMessage | DraftResetMessage;

export type ScreenCaptureMessage = ProtocolMessage<'screen:capture', ScreenCaptureRequest>;
// After a Flow is attached, the widget asks for its replay; the SDK answers with 'screen:captured' once.
export type FlowCaptureMessage = ProtocolMessage<'flow:capture', ScreenCaptureRequest>;

export type WidgetToHostMessage = ReadyMessage | CloseMessage | SubmittedMessage | ScreenCaptureMessage | FlowCaptureMessage |
  PreviewOpenMessage | PreviewCloseMessage;

export type PreviewReadyMessage = ProtocolMessage<'preview:ready', EmptyPayload>;
export type PreviewToHostMessage = PreviewReadyMessage | PreviewCloseMessage;
/** Posted to the preview iframe with the widget's MessagePort as a transferable. */
export type PreviewConnectMessage = ProtocolMessage<'preview:connect', EmptyPayload>;

/** What the preview shows: the names the widget gives the screen, and the screen as this browser captured it. */
export interface PreviewContent {
  title: string;
  subtitle: string;
  capture: ScreenCapture;
}
/** Sent over the MessagePort, from the widget to the preview iframe. */
export type PreviewContentMessage = ProtocolMessage<'preview:content', PreviewContent>;

export type HostToWidgetMessageType = HostToWidgetMessage['type'];
export type WidgetToHostMessageType = WidgetToHostMessage['type'];
