import { describe, expect, it } from 'vitest';

import { describeTarget, MAX_TARGET_LABEL_LENGTH } from '@/lib/target-labels';

describe('describeTarget', () => {
  it('prefers the configured id over the tag', () => {
    expect(describeTarget({ feedbackId: 'save-button', tagName: 'button' })).toBe('save-button');
  });

  it('replaces a known tag with a plain word and keeps unknown tags as they are', () => {
    expect(describeTarget({ feedbackId: null, tagName: 'BUTTON' })).not.toBe('button');
    expect(describeTarget({ feedbackId: null, tagName: 'button' })).toBe(describeTarget({ feedbackId: null, tagName: 'BUTTON' }));
    expect(describeTarget({ feedbackId: null, tagName: 'x-custom-chip' })).toBe('x-custom-chip');
  });

  it('shortens an overlong id and marks the cut', () => {
    const longId = 'a'.repeat(MAX_TARGET_LABEL_LENGTH + 5);
    const label = describeTarget({ feedbackId: longId, tagName: 'div' });
    expect(label.length).toBe(MAX_TARGET_LABEL_LENGTH + 1);
    expect(label.endsWith('…')).toBe(true);
  });
});
