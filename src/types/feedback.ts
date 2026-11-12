// Shared feedback domain types. Types only: no runtime code lives here.
// Data minimization (AGENTS.md section 5): nothing in these shapes may carry
// input values, query strings, hashes, cookies, tokens, or raw DOM/CSS.

export type FeedbackStatus = 'open' | 'in_progress' | 'resolved';

export type FeedbackType = 'bug' | 'improvement' | 'question' | 'other';

/** Set by the host page through the SDK's setUser. */
export interface FeedbackReporter {
  id: string;
  name: string;
  email?: string;
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
  viewportWidth: number;
  viewportHeight: number;
  note: string;
}

export type FlowEventType = 'click' | 'navigation' | 'input';

export interface FlowEvent {
  type: FlowEventType;
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
}

export interface FeedbackAttachments {
  comments: CommentAttachment[];
  edits: EditAttachment[];
  flow: FlowAttachment | null;
}

export interface Feedback {
  id: string;
  projectKey: string;
  message: string;
  type: FeedbackType;
  status: FeedbackStatus;
  reporter: FeedbackReporter;
  page: PageContext;
  attachments: FeedbackAttachments;
  adminReply: string | null;
  /** ISO timestamp. */
  createdAt: string;
  /** ISO timestamp. */
  updatedAt: string;
}

export type CreateFeedbackInput = Pick<Feedback, 'projectKey' | 'message' | 'type' | 'reporter' | 'page'> & {
  hostOrigin: string;
  attachments?: Partial<FeedbackAttachments>;
};

export type UpdateFeedbackInput = Partial<Pick<Feedback, 'status' | 'adminReply'>>;

export interface CreateFeedbackResponse {
  feedback: Feedback;
}

export interface FeedbackListResponse {
  items: Feedback[];
}

export interface FeedbackDetailResponse {
  feedback: Feedback;
}

export interface ApiErrorResponse {
  error: {
    code: string;
    message: string;
  };
}
