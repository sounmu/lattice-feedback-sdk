import { describe, expect, it } from 'vitest';
import { createCaptureCommand, createCaptureUpdate, isCaptureCommand, isCaptureUpdate } from '@/lib/capture-protocol';
import type { CaptureState } from '@/types/sdk-message';

const STATE: CaptureState = {
  enabled: true, activeMode: null, selection: null,
  attachments: { comments: [], edits: [], flow: null },
  flowEventCount: 0, errorMessage: null,
};

describe('capture protocol', () => {
  it.each([
    createCaptureCommand({ type: 'capture:start', payload: { mode: 'comment' } }),
    createCaptureCommand({ type: 'capture:start', payload: { mode: 'edit' } }),
    createCaptureCommand({ type: 'capture:start', payload: { mode: 'flow' } }),
    createCaptureCommand({ type: 'capture:cancel', payload: {} }),
    createCaptureCommand({ type: 'flow:stop', payload: {} }),
    createCaptureCommand({ type: 'comment:add', payload: { comment: 'Please move this' } }),
    createCaptureCommand({ type: 'attachment:remove', payload: { kind: 'comments', index: 0 } }),
    createCaptureCommand({ type: 'draft:reset', payload: {} }),
  ])('accepts capture command $type', (message) => {
    expect(isCaptureCommand(message)).toBe(true);
  });

  it.each([
    { type: 'capture:start', payload: { mode: 'eval' } },
    { type: 'comment:add', payload: { comment: ' ' } },
    { type: 'comment:add', payload: { comment: 'x'.repeat(1001) } },
    { type: 'attachment:remove', payload: { kind: '__proto__', index: 0 } },
    { type: 'attachment:remove', payload: { kind: 'comments', index: -1 } },
    { type: 'attachment:remove', payload: { kind: 'edits', index: 0.5 } },
  ])('rejects invalid capture command payload: %j', ({ type, payload }) => {
    expect(isCaptureCommand({ ...createCaptureCommand({ type: 'draft:reset', payload: {} }), type, payload })).toBe(false);
  });

  it('accepts a complete empty draft and bounded restored Flow state', () => {
    expect(isCaptureUpdate(createCaptureUpdate(STATE))).toBe(true);
    expect(isCaptureUpdate(createCaptureUpdate({
      ...STATE,
      attachments: { comments: [], edits: [], flow: {
        startedAt: '2026-11-12T12:00:00Z', endedAt: '2026-11-12T12:01:00Z', interrupted: true,
        events: [{ type: 'navigation', navigationType: 'reload', offsetMs: 100, path: '/', targetLabel: null }],
      } },
    }))).toBe(true);
  });

  it.each([
    { flowEventCount: 201 },
    { flowEventCount: NaN },
    { selection: { rect: { width: -1 } } },
    { attachments: { comments: [], edits: [], flow: { events: [] } } },
    { activeMode: 'unknown' },
  ])('rejects malformed capture state: %j', (invalid) => {
    expect(isCaptureUpdate({ ...createCaptureUpdate(STATE), payload: { ...STATE, ...invalid } }))
      .toBe(false);
  });
});
