// Shared feedback domain types. Types only: no runtime code lives here.
// Data minimization (AGENTS.md section 5): nothing in these shapes may carry
// input values, query strings, hashes, cookies, tokens, or raw DOM/CSS.

import type { ScreenSnapshotSummary } from '@/types/screen-snapshot';

export type FeedbackStatus = 'open' | 'in_progress' | 'resolved' | 'rejected' | 'duplicate';

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

export interface Feedback {
  id: string;
  projectKey: string;
  message: string;
  type: FeedbackType;
  status: FeedbackStatus;
  /** The feedback this one repeats. Set exactly when status is 'duplicate'. */
  duplicateOfId: string | null;
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
  /** Saved screens uploaded before submission. They are linked to the feedback when it is created. */
  screenSnapshotIds?: string[];
};

export type UpdateFeedbackInput = Partial<Pick<Feedback, 'status' | 'adminReply' | 'duplicateOfId'>>;

export interface CreateFeedbackResponse {
  feedback: Feedback;
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
