import { describe, expect, it } from 'vitest';

import { getStatusActions, getStatusPhase } from '@/sdk/capture-status-model';
import type { ElementTarget } from '@/types/feedback';

const TARGET: ElementTarget = { selector: 'body > button', feedbackId: null, tagName: 'button', rect: { x: 0, y: 0, width: 10, height: 10 } };

describe('getStatusPhase', () => {
  it('is null outside a mode', () => {
    expect(getStatusPhase({ activeMode: null, selection: null, enabled: true })).toBeNull();
  });

  it('splits comment and edit modes by whether an element is picked', () => {
    expect(getStatusPhase({ activeMode: 'comment', selection: null, enabled: true })).toBe('comment-pick');
    expect(getStatusPhase({ activeMode: 'comment', selection: TARGET, enabled: true })).toBe('comment-write');
    expect(getStatusPhase({ activeMode: 'edit', selection: null, enabled: true })).toBe('edit-pick');
    expect(getStatusPhase({ activeMode: 'edit', selection: TARGET, enabled: true })).toBe('edit-drag');
  });

  it('marks a flow as paused on a page the policy leaves out', () => {
    expect(getStatusPhase({ activeMode: 'flow', selection: null, enabled: true })).toBe('flow-recording');
    expect(getStatusPhase({ activeMode: 'flow', selection: null, enabled: false })).toBe('flow-paused');
  });
});

describe('getStatusActions', () => {
  it('offers a neutral finish only while picking comment targets', () => {
    expect(getStatusActions('comment-pick').finish).toBe('neutral');
    expect(getStatusActions('comment-write').finish).toBe('hidden');
    expect(getStatusActions('edit-pick').finish).toBe('hidden');
    expect(getStatusActions('edit-drag').finish).toBe('hidden');
  });

  it('treats both flow phases as a recording that Escape must not end', () => {
    for (const phase of ['flow-recording', 'flow-paused'] as const) {
      expect(getStatusActions(phase)).toEqual({ finish: 'recording', isRecording: true, escapeCancels: false });
    }
  });

  it('lets Escape cancel the transient modes', () => {
    for (const phase of ['comment-pick', 'comment-write', 'edit-pick', 'edit-drag'] as const) {
      expect(getStatusActions(phase).escapeCancels).toBe(true);
    }
  });
});
