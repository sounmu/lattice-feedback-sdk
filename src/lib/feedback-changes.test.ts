import { expect, it } from 'vitest';

import { createFeedbackChanges, type FeedbackActionForm } from '@/lib/feedback-changes';
import type { Feedback } from '@/types/feedback';

const ORIGINAL_ID = '00000000-0000-4000-8000-000000000001';
const OTHER_ORIGINAL_ID = '00000000-0000-4000-8000-000000000002';

function createStored(overrides: Partial<Pick<Feedback, 'status' | 'adminReply' | 'duplicateOfId'>> = {}) {
  return { status: 'in_progress', adminReply: null, duplicateOfId: null, ...overrides } as const;
}

function createForm(overrides: Partial<FeedbackActionForm> = {}): FeedbackActionForm {
  return { status: 'in_progress', reply: '', duplicateOfId: '', ...overrides };
}

it('sends nothing when the form matches the stored feedback, ignoring spaces around the reply', () => {
  expect(createFeedbackChanges(createStored(), createForm())).toEqual({});
  expect(createFeedbackChanges(createStored({ adminReply: 'Fixed.' }), createForm({ reply: '  Fixed.  ' }))).toEqual({});
});

it('sends a new reply even when the status stays the same', () => {
  expect(createFeedbackChanges(createStored(), createForm({ reply: ' Looking into it. ' }))).toEqual({ adminReply: 'Looking into it.' });
});

it('sends the status and the reply together, and clears a reply that was emptied', () => {
  const stored = createStored({ adminReply: 'Old reply' });

  expect(createFeedbackChanges(stored, createForm({ status: 'rejected', reply: 'Not planned.' }))).toEqual({
    status: 'rejected',
    adminReply: 'Not planned.',
  });
  expect(createFeedbackChanges(stored, createForm({ reply: '  ' }))).toEqual({ adminReply: null });
});

it('sends the original with the duplicate status, also when only the original changed', () => {
  const duplicate = createStored({ status: 'duplicate', duplicateOfId: ORIGINAL_ID });

  expect(createFeedbackChanges(createStored(), createForm({ status: 'duplicate', duplicateOfId: ORIGINAL_ID }))).toEqual({
    status: 'duplicate',
    duplicateOfId: ORIGINAL_ID,
  });
  expect(createFeedbackChanges(duplicate, createForm({ status: 'duplicate', duplicateOfId: ORIGINAL_ID }))).toEqual({});
  expect(createFeedbackChanges(duplicate, createForm({ status: 'duplicate', duplicateOfId: OTHER_ORIGINAL_ID }))).toEqual({
    status: 'duplicate',
    duplicateOfId: OTHER_ORIGINAL_ID,
  });
});

it('leaves the original out when a duplicate gets another status', () => {
  const duplicate = createStored({ status: 'duplicate', duplicateOfId: ORIGINAL_ID });

  expect(createFeedbackChanges(duplicate, createForm({ status: 'rejected', duplicateOfId: ORIGINAL_ID }))).toEqual({ status: 'rejected' });
});
