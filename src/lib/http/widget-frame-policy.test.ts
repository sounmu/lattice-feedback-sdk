import { beforeEach, describe, expect, it } from 'vitest';

import { getWidgetFrameAncestorsPolicy } from '@/lib/http/widget-frame-policy';

beforeEach(() => {
  delete process.env.FEEDBACK_ALLOWED_ORIGINS;
});

describe('getWidgetFrameAncestorsPolicy', () => {
  it('allows only the configured host origins for a known project', () => {
    process.env.FEEDBACK_ALLOWED_ORIGINS = 'https://demo.example.com, http://localhost:4000';

    expect(getWidgetFrameAncestorsPolicy('demo')).toBe(
      'frame-ancestors https://demo.example.com http://localhost:4000',
    );
  });

  it('blocks framing for an unknown or missing project', () => {
    expect(getWidgetFrameAncestorsPolicy('nope')).toBe("frame-ancestors 'none'");
    expect(getWidgetFrameAncestorsPolicy(null)).toBe("frame-ancestors 'none'");
  });
});
