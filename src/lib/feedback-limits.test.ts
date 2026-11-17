import { describe, expect, it } from 'vitest';

import { isWithinFeedbackBytes, MAX_FEEDBACK_BYTES, truncateText } from '@/lib/feedback-limits';

describe('truncateText', () => {
  it('keeps text within the limit unchanged', () => {
    expect(truncateText('Orders', 200)).toBe('Orders');
  });

  it('cuts text to the limit', () => {
    expect(truncateText('a'.repeat(201), 200)).toHaveLength(200);
  });

  it('does not split a surrogate pair at the boundary', () => {
    expect(truncateText(`${'a'.repeat(199)}😀`, 200)).toBe('a'.repeat(199));
  });
});

it('measures a submission body in UTF-8 bytes against the API limit', () => {
  expect(isWithinFeedbackBytes({ message: 'a'.repeat(MAX_FEEDBACK_BYTES - 20) })).toBe(true);
  // Korean characters are three bytes each, so the same length no longer fits.
  expect(isWithinFeedbackBytes({ message: '가'.repeat(MAX_FEEDBACK_BYTES / 3) })).toBe(false);
});
