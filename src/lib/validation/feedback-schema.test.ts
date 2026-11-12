import { describe, expect, it } from 'vitest';
import {
  createFeedbackInputSchema,
  MAX_COMMENTS,
  MAX_MESSAGE_LENGTH,
  updateFeedbackInputSchema,
} from '@/lib/validation/feedback-schema';
import type { CommentAttachment, CreateFeedbackInput } from '@/types/feedback';

const VALID_INPUT: CreateFeedbackInput = {
  projectKey: 'demo',
  hostOrigin: 'https://host.example.com',
  message: 'The export button does nothing.',
  type: 'bug',
  reporter: { id: 'user_1', name: 'Tester' },
  page: {
    url: 'https://host.example.com/orders',
    title: 'Orders',
    viewportWidth: 1280,
    viewportHeight: 720,
    userAgent: 'test-agent',
  },
};

const COMMENT: CommentAttachment = {
  target: {
    selector: '[data-feedback-id="export"]',
    feedbackId: 'export',
    tagName: 'button',
    rect: { x: 10, y: 20, width: 100, height: 30 },
  },
  comment: 'This one.',
};

describe('createFeedbackInputSchema', () => {
  it('strips query and hash from page.url', () => {
    const result = createFeedbackInputSchema.parse({
      ...VALID_INPUT,
      page: { ...VALID_INPUT.page, url: 'https://host.example.com/orders/12?token=secret#row-3' },
    });
    expect(result.page.url).toBe('https://host.example.com/orders/12');
  });

  it('rejects a non-http page.url', () => {
    const result = createFeedbackInputSchema.safeParse({
      ...VALID_INPUT,
      page: { ...VALID_INPUT.page, url: 'javascript:alert(1)' },
    });
    expect(result.success).toBe(false);
  });

  it('rejects an empty or whitespace-only message', () => {
    expect(createFeedbackInputSchema.safeParse({ ...VALID_INPUT, message: '' }).success).toBe(false);
    expect(createFeedbackInputSchema.safeParse({ ...VALID_INPUT, message: '   \n ' }).success).toBe(false);
  });

  it('rejects an oversized message and accepts one at the limit', () => {
    const atLimit = 'a'.repeat(MAX_MESSAGE_LENGTH);
    expect(createFeedbackInputSchema.safeParse({ ...VALID_INPUT, message: atLimit }).success).toBe(true);
    expect(createFeedbackInputSchema.safeParse({ ...VALID_INPUT, message: `${atLimit}a` }).success).toBe(false);
  });

  it('rejects a hostOrigin with a path', () => {
    expect(createFeedbackInputSchema.safeParse({ ...VALID_INPUT, hostOrigin: 'https://host.example.com/app' }).success).toBe(
      false,
    );
    expect(createFeedbackInputSchema.safeParse({ ...VALID_INPUT, hostOrigin: 'https://host.example.com/' }).success).toBe(
      false,
    );
    expect(createFeedbackInputSchema.safeParse({ ...VALID_INPUT, hostOrigin: 'ftp://host.example.com' }).success).toBe(false);
  });

  it('rejects more than MAX_COMMENTS comments', () => {
    const atLimit = Array.from({ length: MAX_COMMENTS }, () => COMMENT);
    expect(createFeedbackInputSchema.safeParse({ ...VALID_INPUT, attachments: { comments: atLimit } }).success).toBe(true);
    expect(
      createFeedbackInputSchema.safeParse({ ...VALID_INPUT, attachments: { comments: [...atLimit, COMMENT] } }).success,
    ).toBe(false);
  });

  it('fills attachment defaults when attachments are missing or partial', () => {
    expect(createFeedbackInputSchema.parse(VALID_INPUT).attachments).toEqual({ comments: [], edits: [], flow: null });
    expect(createFeedbackInputSchema.parse({ ...VALID_INPUT, attachments: { comments: [COMMENT] } }).attachments).toEqual({
      comments: [COMMENT],
      edits: [],
      flow: null,
    });
  });

  it('drops unknown fields instead of storing them', () => {
    const result = createFeedbackInputSchema.parse({ ...VALID_INPUT, cookie: 'session=abc' });
    expect(result).not.toHaveProperty('cookie');
  });
});

describe('updateFeedbackInputSchema', () => {
  it('accepts a status change and a null reply', () => {
    expect(updateFeedbackInputSchema.parse({ status: 'resolved', adminReply: null })).toEqual({
      status: 'resolved',
      adminReply: null,
    });
  });

  it('rejects an unknown status', () => {
    expect(updateFeedbackInputSchema.safeParse({ status: 'closed' }).success).toBe(false);
  });
});
