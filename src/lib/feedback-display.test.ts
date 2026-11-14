import { describe, expect, it } from 'vitest';

import {
  formatDateTime,
  formatOffset,
  formatRelativeTime,
  getElementLabel,
  getPagePath,
  summarizeAttachments,
} from '@/lib/feedback-display';
import type { ElementTarget, FeedbackAttachments } from '@/types/feedback';

const NOW = Date.parse('2026-11-13T12:00:00.000Z');

describe('formatDateTime', () => {
  it('shows Korea time whatever the viewer time zone is', () => {
    expect(formatDateTime('2026-11-13T14:28:00.000Z')).toBe('2026.11.13 23:28');
  });

  it('rolls over to the next day after midnight in Korea', () => {
    expect(formatDateTime('2026-12-31T15:30:00.000Z')).toBe('2027.01.01 00:30');
  });

  it('returns the original text when it is not a date', () => {
    expect(formatDateTime('not a date')).toBe('not a date');
  });
});

describe('formatRelativeTime', () => {
  it('says just now for the last minute', () => {
    expect(formatRelativeTime('2026-11-13T11:59:30.000Z', NOW)).toBe('방금 전');
  });

  it('counts minutes, hours and days', () => {
    expect(formatRelativeTime('2026-11-13T11:45:00.000Z', NOW)).toBe('15분 전');
    expect(formatRelativeTime('2026-11-13T09:00:00.000Z', NOW)).toBe('3시간 전');
    expect(formatRelativeTime('2026-11-10T12:00:00.000Z', NOW)).toBe('3일 전');
  });

  it('falls back to the date after a week', () => {
    expect(formatRelativeTime('2026-11-01T12:00:00.000Z', NOW)).toBe('2026.11.01 21:00');
  });
});

describe('formatOffset', () => {
  it('formats minutes, seconds and tenths', () => {
    expect(formatOffset(0)).toBe('0:00.0');
    expect(formatOffset(3200)).toBe('0:03.2');
    expect(formatOffset(65_300)).toBe('1:05.3');
  });

  it('treats a negative offset as the start', () => {
    expect(formatOffset(-50)).toBe('0:00.0');
  });
});

describe('getPagePath', () => {
  it('returns the pathname of a page URL', () => {
    expect(getPagePath('https://demo.example.com/orders/2')).toBe('/orders/2');
  });

  it('returns the text itself when it is not a URL', () => {
    expect(getPagePath('/orders')).toBe('/orders');
  });
});

describe('getElementLabel', () => {
  const target: ElementTarget = {
    selector: 'main > button:nth-child(2)',
    feedbackId: null,
    tagName: 'button',
    rect: { x: 0, y: 0, width: 10, height: 10 },
  };

  it('prefers the data-feedback-id', () => {
    expect(getElementLabel({ ...target, feedbackId: 'save-button' })).toBe('save-button');
  });

  it('uses the selector when there is no data-feedback-id', () => {
    expect(getElementLabel(target)).toBe('main > button:nth-child(2)');
  });
});

describe('summarizeAttachments', () => {
  it('lists nothing when there are no attachments', () => {
    expect(summarizeAttachments({ comments: [], edits: [], flow: null })).toEqual([]);
  });

  it('lists only the kinds that were used', () => {
    const attachments: FeedbackAttachments = {
      comments: [],
      edits: [],
      flow: { startedAt: '2026-11-13T00:00:00.000Z', endedAt: '2026-11-13T00:01:00.000Z', events: [] },
    };

    expect(summarizeAttachments(attachments)).toEqual([{ kind: 'flow', label: '흐름 0개' }]);
  });
});
