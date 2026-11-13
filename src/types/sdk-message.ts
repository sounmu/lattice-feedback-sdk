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
  flowEventCount: number;
  errorMessage: string | null;
}
export type CaptureUpdateMessage = ProtocolMessage<'capture:update', CaptureState>;

// Saved screens: the widget asks with 'screen:capture', the SDK serializes the host page and answers once.
export type ScreenCapturedMessage = ProtocolMessage<'screen:captured', ScreenCapture>;
export type ScreenCaptureFailedMessage = ProtocolMessage<'screen:capture-failed', { reason: ScreenCaptureFailureReason }>;

export type HostToWidgetMessage =
  | InitMessage
  | ReporterUpdateMessage
  | PageUpdateMessage
  | ScreenCapturedMessage
  | ScreenCaptureFailedMessage;

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

export type ScreenCaptureMessage = ProtocolMessage<'screen:capture', EmptyPayload>;

export type WidgetToHostMessage = ReadyMessage | CloseMessage | SubmittedMessage | ScreenCaptureMessage;

export type HostToWidgetMessageType = HostToWidgetMessage['type'];
export type WidgetToHostMessageType = WidgetToHostMessage['type'];
