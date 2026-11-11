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
import type { FeedbackReporter, PageContext } from '@/types/feedback';

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

export type HostToWidgetMessage = InitMessage | ReporterUpdateMessage | PageUpdateMessage;

export type ReadyMessage = ProtocolMessage<'ready', EmptyPayload>;
export type CloseMessage = ProtocolMessage<'close', EmptyPayload>;
export type SubmittedMessage = ProtocolMessage<'submitted', { feedbackId: string }>;

export type WidgetToHostMessage = ReadyMessage | CloseMessage | SubmittedMessage;

export type HostToWidgetMessageType = HostToWidgetMessage['type'];
export type WidgetToHostMessageType = WidgetToHostMessage['type'];
