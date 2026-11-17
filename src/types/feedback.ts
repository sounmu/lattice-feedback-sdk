// Shared feedback domain types. Types only: no runtime code lives here.
// Capture context excludes credentials. Reporter identity proofs and conversation
// capabilities are transient authentication fields, never persisted as feedback metadata.

import type { ScreenSnapshotSummary } from '@/types/screen-snapshot';
import type { ConversationMessage, ReporterSignature } from '@/types/conversation';

export type FeedbackStatus = 'open' | 'in_progress' | 'resolved' | 'rejected' | 'duplicate';

export type FeedbackType = 'bug' | 'improvement' | 'question' | 'other';

/** The company or department a reporter belongs to. Only the id is covered by an identity signature. */
export interface ReporterOrganization {
  id: string;
  /** Display text supplied alongside the id; never signed. */
  name?: string;
}

/** Set by the host page through the SDK's setUser. */
export interface FeedbackReporter {
  id: string;
  name: string;
  email?: string;
  /** The host page's claim. Transient: stripped before persistence, and never shown as verified. */
  organization?: ReporterOrganization;
  /** Transient identity proof; stripped before persistence. */
  identity?: ReporterSignature;
  /** Set by the server only, when a valid v2 signature covers this organization's id. Absent otherwise. */
  verifiedOrganization?: ReporterOrganization;
}

export interface PageContext {
  /** origin + pathname only, never query or hash. */
  url: string;
  title: string;
  viewportWidth: number;
  viewportHeight: number;
  userAgent: string;
}

/** Document coordinates in CSS px. */
export interface ElementRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface ElementTarget {
  selector: string;
  /** Pathname at capture time, even if submission happens after an SPA navigation. */
  pagePath?: string;
  /** Value of data-feedback-id when present. */
  feedbackId: string | null;
  tagName: string;
  rect: ElementRect;
}

export interface CommentAttachment {
  target: ElementTarget;
  comment: string;
}

export interface EditAttachment {
  target: ElementTarget;
  originalRect: ElementRect;
  proposedRect: ElementRect;
  /** Clockwise degrees around the proposed box's centre; absent when the element is not rotated. */
  rotation?: number;
  viewportWidth: number;
  viewportHeight: number;
  note: string;
}

export type FlowEventType = 'click' | 'navigation' | 'input';

export interface FlowEvent {
  type: FlowEventType;
  navigationType?: 'spa' | 'document' | 'reload';
  /** Milliseconds since FlowAttachment.startedAt. */
  offsetMs: number;
  /** location.pathname only, never query or hash. */
  path: string;
  /** data-feedback-id or tag name, never user text. 'input' events record that input happened, never the value. */
  targetLabel: string | null;
}

export interface FlowAttachment {
  /** ISO timestamp. */
  startedAt: string;
  /** ISO timestamp. */
  endedAt: string;
  events: FlowEvent[];
  truncated?: boolean;
  interrupted?: boolean;
}

export interface FeedbackAttachments {
  comments: CommentAttachment[];
  edits: EditAttachment[];
  flow: FlowAttachment | null;
}

/** A question the AI asked before the feedback was sent, with the choices it offered. */
export interface ClarificationQuestion {
  question: string;
  options: string[];
}

export interface ClarificationAnswer extends ClarificationQuestion {
  /** The reporter's answer: one of the options or their own words. Null when they skipped it. */
  answer: string | null;
}

/** AI inference, kept apart from what the reporter wrote and what the SDK recorded. */
export interface FeedbackClarification {
  /** The model that wrote the questions. */
  model: string;
  questions: ClarificationAnswer[];
}

export interface Feedback {
  id: string;
  projectKey: string;
  message: string;
  type: FeedbackType;
  status: FeedbackStatus;
  /** The feedback this one repeats. Set exactly when status is 'duplicate'. */
  duplicateOfId: string | null;
  /** Link to the ticket made from this feedback. Null until one is made. */
  ticketUrl: string | null;
  reporter: FeedbackReporter;
  page: PageContext;
  attachments: FeedbackAttachments;
  adminReply: string | null;
  messages?: ConversationMessage[];
  /** Null or absent when no question was asked. */
  clarification?: FeedbackClarification | null;
  /** ISO timestamp. */
  createdAt: string;
  /** ISO timestamp. */
  updatedAt: string;
}

export type CreateFeedbackInput = Pick<Feedback, 'projectKey' | 'message' | 'type' | 'reporter' | 'page'> & {
  hostOrigin: string;
  attachments?: Partial<FeedbackAttachments>;
  /** Saved screens uploaded before submission. They are linked to the feedback when it is created. */
  screenSnapshotIds?: string[];
  clarification?: FeedbackClarification;
};

/** What the widget sends to ask for questions: the draft without the reporter or the saved screens. */
export type ClarifyInput = Pick<CreateFeedbackInput, 'projectKey' | 'hostOrigin' | 'message' | 'type' | 'attachments'> & {
  page: Pick<PageContext, 'url'>;
};

export interface ClarifyResponse {
  questions: ClarificationQuestion[];
  /** Null when no model is configured or it gave no usable questions. */
  model: string | null;
}

export type UpdateFeedbackInput = Partial<Pick<Feedback, 'status' | 'adminReply' | 'duplicateOfId'>>;

export interface CreateFeedbackResponse {
  feedback: Feedback;
  conversationSecret?: string;
}

export interface FeedbackListResponse {
  items: Feedback[];
}

export interface FeedbackDetailResponse {
  feedback: Feedback;
  /** Screens saved with this feedback, without their event payload. */
  screenSnapshots: ScreenSnapshotSummary[];
}

export interface ApiErrorResponse {
  error: {
    code: string;
    message: string;
  };
}
