/** What asked for a screen to be saved: the reporter, a comment or edit, or a finished Flow. */
export type CaptureSource = 'manual' | 'marks' | 'flow';

/** Counters that move when the draft is discarded (`draft`) and when its Flow is removed (`flow`). */
export interface CaptureGeneration {
  draft: number;
  flow: number;
}

/**
 * Whether a screen asked for at `asked` may still be added to the draft. A discarded draft drops every
 * screen; a removed Flow drops only its replay, so screens saved by hand or for comments and edits stay.
 */
export function isCaptureCurrent(source: CaptureSource, asked: CaptureGeneration, current: CaptureGeneration): boolean {
  if (asked.draft !== current.draft) {
    return false;
  }
  return source !== 'flow' || asked.flow === current.flow;
}
