import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createFeedbackBody, createJsonRequest } from '@/app/api/feedback/feedback-test-fixtures';
import { POST } from '@/app/api/feedback/route';
import { resetRateLimit } from '@/lib/http/rate-limit';
import { resetMemoryFeedbackStore } from '@/lib/memory-feedback-repository';

const POLICY = { allowedPaths: ['/orders'], targets: [{ id: 'save-button', selector: 'button.save' }] };
const TARGET = { feedbackId: 'save-button', selector: 'button.save', tagName: 'button', rect: { x: 1, y: 2, width: 80, height: 30 } };

beforeEach(() => {
  vi.stubEnv('FEEDBACK_STORAGE', 'memory');
  vi.stubEnv('FEEDBACK_CAPTURE_POLICY', JSON.stringify(POLICY));
  resetRateLimit();
  resetMemoryFeedbackStore();
});
afterEach(() => vi.unstubAllEnvs());

it('accepts an approved comment attachment through the API', async () => {
  const response = await POST(createJsonRequest('http://localhost:3000/api/feedback', 'POST',
    createFeedbackBody({ attachments: { comments: [{ target: TARGET, comment: 'Move this button' }] } })));

  expect(response.status).toBe(201);
  expect((await response.json()).feedback.attachments.comments[0].target.feedbackId).toBe('save-button');
});

it.each([
  { name: 'unlisted ID', target: { ...TARGET, feedbackId: 'private-target' } },
  { name: 'forged selector', target: { ...TARGET, selector: '[data-secret="value"]' } },
  { name: 'forged tag name', target: { ...TARGET, tagName: 'private text' } },
  { name: 'unapproved source page', target: { ...TARGET, pagePath: '/private' } },
])('rejects $name in captured metadata', async ({ target }) => {
  const response = await POST(createJsonRequest('http://localhost:3000/api/feedback', 'POST',
    createFeedbackBody({ attachments: { comments: [{ target, comment: 'Feedback' }] } })));

  expect(response.status).toBe(403);
  expect((await response.json()).error.code).toBe('capture_not_allowed');
});

it.each([
  { path: '/private', targetLabel: 'save-button' },
  { path: '/orders', targetLabel: 'private-value' },
])('rejects unapproved Flow path or target: %j', async (event) => {
  const response = await POST(createJsonRequest('http://localhost:3000/api/feedback', 'POST',
    createFeedbackBody({ attachments: { flow: {
      startedAt: '2026-11-12T12:00:00Z', endedAt: '2026-11-12T12:01:00Z',
      events: [{ type: 'input', offsetMs: 10, ...event }],
    } } })));

  expect(response.status).toBe(403);
});

it('keeps text submission available without a capture policy', async () => {
  vi.stubEnv('FEEDBACK_CAPTURE_POLICY', undefined);

  const response = await POST(createJsonRequest('http://localhost:3000/api/feedback', 'POST', createFeedbackBody()));

  expect(response.status).toBe(201);
});

it('denies attachments when capture is not configured', async () => {
  vi.stubEnv('FEEDBACK_CAPTURE_POLICY', undefined);

  const response = await POST(createJsonRequest('http://localhost:3000/api/feedback', 'POST',
    createFeedbackBody({ attachments: { comments: [{ target: TARGET, comment: 'Feedback' }] } })));

  expect(response.status).toBe(403);
});
