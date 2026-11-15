import type { CaptureState } from '@/types/sdk-message';

export type StatusPhase = 'comment-pick' | 'comment-write' | 'edit-pick' | 'edit-drag' | 'flow-recording' | 'flow-paused';

export function getStatusPhase(state: Pick<CaptureState, 'activeMode' | 'selection' | 'enabled'>): StatusPhase | null {
  switch (state.activeMode) {
    case 'comment':
      return state.selection ? 'comment-write' : 'comment-pick';
    case 'edit':
      return state.selection ? 'edit-drag' : 'edit-pick';
    case 'flow':
      return state.enabled ? 'flow-recording' : 'flow-paused';
    default:
      return null;
  }
}

export interface StatusActions {
  finish: 'hidden' | 'neutral' | 'recording';
  isRecording: boolean;
  escapeCancels: boolean;
}

export function getStatusActions(phase: StatusPhase): StatusActions {
  switch (phase) {
    case 'comment-pick':
      return { finish: 'neutral', isRecording: false, escapeCancels: true };
    case 'comment-write':
    case 'edit-pick':
    case 'edit-drag':
      return { finish: 'hidden', isRecording: false, escapeCancels: true };
    case 'flow-recording':
    case 'flow-paused':
      return { finish: 'recording', isRecording: true, escapeCancels: false };
  }
}
