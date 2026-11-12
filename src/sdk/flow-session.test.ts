import { describe, expect, it } from 'vitest';
import { FLOW_MAX_DURATION_MS, readFlowSession, toFlowAttachment, type FlowSessionState } from '@/sdk/flow-session';
import { MemoryStorage } from '@/sdk/flow-test-fixtures';

const KEY = 'flow-key';
const POLICY = { isPathAllowed: (path: string) => path === '/contracts', isTargetAllowed: (id: string) => id === 'save-button' };

function storageWith(value: unknown): Storage {
  const storage = new MemoryStorage();
  storage.setItem(KEY, JSON.stringify(value));
  return storage;
}

function baseState(overrides: Partial<FlowSessionState> = {}): FlowSessionState {
  return {
    version: 1,
    sessionId: 'abc-123',
    startedAtMs: 1_000,
    lastActivityAtMs: 2_000,
    lastOffsetMs: 1_000,
    events: [{ type: 'click', offsetMs: 1_000, path: '/contracts', targetLabel: 'save-button' }],
    truncated: false,
    interrupted: false,
    ...overrides,
  };
}

describe('flow session persistence', () => {
  it('restores only known sanitized fields', () => {
    const storage = storageWith({
      ...baseState(),
      draftMessage: 'customer secret',
      events: [{ type: 'click', offsetMs: 1_000, path: '/contracts', targetLabel: 'save-button', value: 'secret' }],
    });
    const result = readFlowSession(storage, KEY, POLICY, 3_000);

    expect(result.kind).toBe('restored');
    expect(JSON.stringify(result)).not.toContain('secret');
  });

  it.each([
    ['decreasing offsets', { lastOffsetMs: 2_000, events: [
      { type: 'click', offsetMs: 2_000, path: '/contracts', targetLabel: 'save-button' },
      { type: 'click', offsetMs: 1_000, path: '/contracts', targetLabel: 'save-button' },
    ] }],
    ['offset beyond recorded maximum', { lastOffsetMs: 10 }],
    ['invalid date range', { startedAtMs: Number.MAX_SAFE_INTEGER, lastActivityAtMs: Number.MAX_SAFE_INTEGER }],
    ['offset beyond recording duration', { lastOffsetMs: FLOW_MAX_DURATION_MS + 1 }],
    ['revoked target', { events: [{ type: 'click', offsetMs: 1_000, path: '/contracts', targetLabel: 'delete-button' }] }],
    ['query in path', { events: [{ type: 'click', offsetMs: 1_000, path: '/contracts?id=1', targetLabel: 'save-button' }] }],
    ['navigation type on a click', { events: [{ type: 'click', offsetMs: 1_000, path: '/contracts', targetLabel: 'save-button', navigationType: 'spa' }] }],
  ])('discards and removes state with %s', (_name, overrides) => {
    const storage = storageWith({ ...baseState(), ...overrides });

    expect(readFlowSession(storage, KEY, POLICY, 3_000)).toEqual({ kind: 'discarded', reason: 'invalid' });
    expect(storage.getItem(KEY)).toBeNull();
  });

  it('expires at the hard maximum even with recent activity', () => {
    const now = 1_000 + FLOW_MAX_DURATION_MS + 1;
    const storage = storageWith(baseState({ lastActivityAtMs: now - 1 }));

    expect(readFlowSession(storage, KEY, POLICY, now)).toEqual({ kind: 'discarded', reason: 'expired' });
  });

  it('keeps endedAt at or after the last offset and sets flags only when true', () => {
    const attachment = toFlowAttachment(baseState({ interrupted: true }), 500);

    expect(attachment.endedAt).toBe(new Date(2_000).toISOString());
    expect(attachment.interrupted).toBe(true);
    expect('truncated' in attachment).toBe(false);
  });
});
