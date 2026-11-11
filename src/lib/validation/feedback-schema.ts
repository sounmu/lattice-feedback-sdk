import { z } from 'zod';
import type { CreateFeedbackInput, UpdateFeedbackInput } from '@/types/feedback';

export const MAX_MESSAGE_LENGTH = 5000;
export const MAX_COMMENT_LENGTH = 1000;
export const MAX_COMMENTS = 20;
export const MAX_EDITS = 10;
export const MAX_FLOW_EVENTS = 200;
export const MAX_SELECTOR_LENGTH = 500;
export const MAX_REPLY_LENGTH = 5000;

const MAX_SHORT_TEXT_LENGTH = 200;
const MAX_URL_LENGTH = 2048;
const MAX_USER_AGENT_LENGTH = 512;

const FEEDBACK_TYPES = ['bug', 'improvement', 'question', 'other'] as const;
const FEEDBACK_STATUSES = ['open', 'in_progress', 'resolved'] as const;
const FLOW_EVENT_TYPES = ['click', 'navigation', 'input'] as const;

function findHttpUrl(value: string): URL | null {
  try {
    const url = new URL(value);
    if (url.protocol === 'http:' || url.protocol === 'https:') {
      return url;
    }
    return null;
  } catch {
    return null;
  }
}

function isHttpOrigin(value: string): boolean {
  const url = findHttpUrl(value);
  return url !== null && url.origin === value;
}

function isPathOnly(value: string): boolean {
  return value.startsWith('/') && !value.includes('?') && !value.includes('#');
}

const shortTextSchema = z.string().max(MAX_SHORT_TEXT_LENGTH);

const pageUrlSchema = z
  .string()
  .max(MAX_URL_LENGTH)
  .refine((value) => findHttpUrl(value) !== null, { message: 'page.url must be an http(s) URL' })
  .transform((value) => {
    const url = new URL(value);
    return `${url.origin}${url.pathname}`;
  });

const viewportSizeSchema = z.number().nonnegative();

const elementRectSchema = z.object({
  x: z.number(),
  y: z.number(),
  width: z.number().nonnegative(),
  height: z.number().nonnegative(),
});

const elementTargetSchema = z.object({
  selector: z.string().min(1).max(MAX_SELECTOR_LENGTH),
  feedbackId: shortTextSchema.nullable(),
  tagName: shortTextSchema.min(1),
  rect: elementRectSchema,
});

const commentAttachmentSchema = z.object({
  target: elementTargetSchema,
  comment: z.string().trim().min(1).max(MAX_COMMENT_LENGTH),
});

const editAttachmentSchema = z.object({
  target: elementTargetSchema,
  originalRect: elementRectSchema,
  proposedRect: elementRectSchema,
  viewportWidth: viewportSizeSchema,
  viewportHeight: viewportSizeSchema,
  note: z.string().max(MAX_COMMENT_LENGTH),
});

const flowEventSchema = z.object({
  type: z.enum(FLOW_EVENT_TYPES),
  offsetMs: z.number().int().nonnegative(),
  path: z.string().max(MAX_URL_LENGTH).refine(isPathOnly, { message: 'path must be a pathname without query or hash' }),
  targetLabel: shortTextSchema.nullable(),
});

const flowAttachmentSchema = z.object({
  startedAt: z.iso.datetime(),
  endedAt: z.iso.datetime(),
  events: z.array(flowEventSchema).max(MAX_FLOW_EVENTS),
});

const attachmentsSchema = z
  .object({
    comments: z.array(commentAttachmentSchema).max(MAX_COMMENTS).default([]),
    edits: z.array(editAttachmentSchema).max(MAX_EDITS).default([]),
    flow: flowAttachmentSchema.nullable().default(null),
  })
  .default({ comments: [], edits: [], flow: null });

export const createFeedbackInputSchema = z.object({
  projectKey: shortTextSchema.min(1),
  hostOrigin: z
    .string()
    .max(MAX_URL_LENGTH)
    .refine(isHttpOrigin, { message: 'hostOrigin must be an http(s) origin without a path' }),
  message: z.string().trim().min(1).max(MAX_MESSAGE_LENGTH),
  type: z.enum(FEEDBACK_TYPES),
  reporter: z.object({
    id: shortTextSchema.min(1),
    name: shortTextSchema.min(1),
    email: z.email().max(MAX_SHORT_TEXT_LENGTH).optional(),
  }),
  page: z.object({
    url: pageUrlSchema,
    title: z.string().max(MAX_SHORT_TEXT_LENGTH),
    viewportWidth: viewportSizeSchema,
    viewportHeight: viewportSizeSchema,
    userAgent: z.string().max(MAX_USER_AGENT_LENGTH),
  }),
  attachments: attachmentsSchema,
});

export const updateFeedbackInputSchema = z.object({
  status: z.enum(FEEDBACK_STATUSES).optional(),
  adminReply: z.string().max(MAX_REPLY_LENGTH).nullable().optional(),
});

// Compile-time checks: parsed output must be assignable to the shared types.
type IsAssignable<TFrom, TTo> = [TFrom] extends [TTo] ? true : false;
type AssertTrue<T extends true> = T;
export type CreateFeedbackSchemaMatchesType = AssertTrue<
  IsAssignable<z.output<typeof createFeedbackInputSchema>, CreateFeedbackInput>
>;
export type UpdateFeedbackSchemaMatchesType = AssertTrue<
  IsAssignable<z.output<typeof updateFeedbackInputSchema>, UpdateFeedbackInput>
>;
