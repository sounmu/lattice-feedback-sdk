import { expect, it } from 'vitest';

import { findReplyDraft, saveReplyDraft, type ReplyDraftStorage } from '@/lib/admin-reply-drafts';

const FEEDBACK = { id: 'feedback-1', projectKey: 'demo', adminReply: null };

function createStorage(): ReplyDraftStorage & { values: Map<string, string> } {
  const values = new Map<string, string>();
  return {
    values,
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => {
      values.set(key, value);
    },
    removeItem: (key) => {
      values.delete(key);
    },
  };
}

it('brings a draft back for the feedback it was written on, and for no other feedback or project', () => {
  const storage = createStorage();

  saveReplyDraft(storage, FEEDBACK, '  Looking into it');

  expect(findReplyDraft(storage, FEEDBACK)).toBe('  Looking into it');
  expect(findReplyDraft(storage, { ...FEEDBACK, id: 'feedback-2' })).toBeNull();
  expect(findReplyDraft(storage, { ...FEEDBACK, projectKey: 'other' })).toBeNull();
});

it('clears the draft when the reply is back to what is saved, ignoring spaces around it', () => {
  const storage = createStorage();
  const answered = { ...FEEDBACK, adminReply: 'Fixed.' };

  saveReplyDraft(storage, answered, 'Fixed. And more');
  saveReplyDraft(storage, answered, ' Fixed. ');

  expect(findReplyDraft(storage, answered)).toBeNull();
  expect(storage.values.size).toBe(0);
});

it('drops a draft once the saved reply it was written over has changed', () => {
  const storage = createStorage();

  saveReplyDraft(storage, FEEDBACK, 'Looking into it');

  expect(findReplyDraft(storage, { ...FEEDBACK, adminReply: 'Looking into it' })).toBeNull();
  expect(storage.values.size).toBe(0);
});

it('ignores stored values that are not a draft', () => {
  const storage = createStorage();
  saveReplyDraft(storage, FEEDBACK, 'Looking into it');
  const [key] = [...storage.values.keys()];

  for (const value of ['not json', '"text"', 'null', '{"reply":"only a reply"}', '{"savedReply":"","reply":7}']) {
    storage.values.set(key, value);

    expect(findReplyDraft(storage, FEEDBACK)).toBeNull();
  }
});
