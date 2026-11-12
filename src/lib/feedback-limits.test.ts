import { describe, expect, it } from 'vitest';

import { truncateText } from '@/lib/feedback-limits';

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
