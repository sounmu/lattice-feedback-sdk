import { describe, expect, it } from 'vitest';

import { findAttachmentChange, type AttachmentCounts } from '@/lib/attachment-notice';

const EMPTY: AttachmentCounts = { comments: 0, edits: 0, flows: 0, screens: 0 };

describe('findAttachmentChange', () => {
  it('returns null when nothing changed', () => {
    expect(findAttachmentChange(EMPTY, { ...EMPTY })).toBeNull();
    expect(findAttachmentChange({ ...EMPTY, comments: 2 }, { ...EMPTY, comments: 2 })).toBeNull();
  });

  it('reports the kind that was added with its new total', () => {
    expect(findAttachmentChange({ ...EMPTY, comments: 1 }, { ...EMPTY, comments: 2 })).toEqual({ kind: 'comment', direction: 'added', total: 2 });
    expect(findAttachmentChange(EMPTY, { ...EMPTY, flows: 1 })).toEqual({ kind: 'flow', direction: 'added', total: 1 });
  });

  it('prefers the reporter action over the screen saved alongside it', () => {
    expect(findAttachmentChange(EMPTY, { ...EMPTY, edits: 1, screens: 1 })).toEqual({ kind: 'edit', direction: 'added', total: 1 });
  });

  it('prefers an addition over a removal that happened in the same update', () => {
    const previous: AttachmentCounts = { comments: 0, edits: 0, flows: 0, screens: 1 };
    const next: AttachmentCounts = { comments: 1, edits: 0, flows: 0, screens: 0 };
    expect(findAttachmentChange(previous, next)).toEqual({ kind: 'comment', direction: 'added', total: 1 });
  });

  it('reports a removal with the remaining total', () => {
    expect(findAttachmentChange({ ...EMPTY, screens: 2 }, { ...EMPTY, screens: 1 })).toEqual({ kind: 'screen', direction: 'removed', total: 1 });
  });
});
