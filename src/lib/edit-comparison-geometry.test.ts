import { describe, expect, it } from 'vitest';

import {
  describeMove, formatEditChange, formatRect, formatSignedPixels, getComparisonBounds, normalizeRotation,
} from '@/lib/edit-comparison-geometry';

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

    expect(describeMove(original, proposed)).toEqual({ deltaX: 120, deltaY: -380, scaleX: 1, scaleY: 1, rotation: 0, isResized: false });
  });

  it('measures the move by the centre, so an element scaled in place has not moved', () => {
    const original = { x: 0, y: 0, width: 100, height: 40 };
    const proposed = { x: -10, y: -4, width: 120, height: 48 };

    expect(describeMove(original, proposed, 30)).toEqual({ deltaX: 0, deltaY: 0, scaleX: 1.2, scaleY: 1.2, rotation: 30, isResized: true });
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

describe('normalizeRotation', () => {
  it('keeps every angle between -180 and 180, spelling a half turn as 180', () => {
    expect(normalizeRotation(190)).toBe(-170);
    expect(normalizeRotation(-190)).toBe(170);
    expect(normalizeRotation(360)).toBe(0);
    expect(normalizeRotation(-180)).toBe(180);
    expect(Object.is(normalizeRotation(-360), 0)).toBe(true);
  });
});

describe('formatEditChange', () => {
  const original = { x: 0, y: 0, width: 100, height: 40 };

  it('names the move, the scale and the turn together', () => {
    const proposed = { x: 30, y: -4, width: 120, height: 48 };

    expect(formatEditChange(describeMove(original, proposed, 15))).toBe('가로 +40px, 세로 0px 이동 · 크기 120% · 시계 방향 15° 회전');
  });

  it('names a stretch on each axis and a counter-clockwise turn', () => {
    const proposed = { x: 0, y: 0, width: 150, height: 40 };

    expect(formatEditChange(describeMove({ ...original, x: 25 }, { ...proposed, x: 0 }, -30))).toBe('크기 가로 150%, 세로 100% · 반시계 방향 30° 회전');
  });

  it('says the element stays when nothing changed', () => {
    expect(formatEditChange(describeMove(original, original))).toBe('제자리');
  });
});
