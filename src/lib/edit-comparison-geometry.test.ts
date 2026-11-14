import { describe, expect, it } from 'vitest';

import { describeMove, formatRect, formatSignedPixels, getComparisonBounds } from '@/lib/edit-comparison-geometry';

describe('getComparisonBounds', () => {
  it('uses the viewport when every rectangle fits inside it', () => {
    const rects = [{ x: 10, y: 10, width: 100, height: 40 }];

    expect(getComparisonBounds(1440, 900, rects)).toEqual({ width: 1440, height: 900 });
  });

  it('grows to include a rectangle below the fold', () => {
    const rects = [{ x: 10, y: 1500, width: 100, height: 40 }];

    expect(getComparisonBounds(1440, 900, rects)).toEqual({ width: 1440, height: 1540 });
  });

  it('never returns an empty area', () => {
    expect(getComparisonBounds(0, 0, [])).toEqual({ width: 1, height: 1 });
  });
});

describe('describeMove', () => {
  it('reports the distance in both directions', () => {
    const original = { x: 100, y: 500, width: 80, height: 36 };
    const proposed = { x: 220.4, y: 120, width: 80, height: 36 };

    expect(describeMove(original, proposed)).toEqual({ deltaX: 120, deltaY: -380, isResized: false });
  });

  it('detects a size change', () => {
    const original = { x: 0, y: 0, width: 80, height: 36 };
    const proposed = { x: 0, y: 0, width: 120, height: 36 };

    expect(describeMove(original, proposed).isResized).toBe(true);
  });
});

describe('formatSignedPixels', () => {
  it('shows a plus sign only for positive values', () => {
    expect(formatSignedPixels(120)).toBe('+120px');
    expect(formatSignedPixels(-40)).toBe('-40px');
    expect(formatSignedPixels(0)).toBe('0px');
  });
});

describe('formatRect', () => {
  it('rounds the position and size', () => {
    expect(formatRect({ x: 10.4, y: 20.6, width: 99.5, height: 36 })).toBe('10, 21 · 100×36');
  });
});
