// Records what happens on the page while Flow is on, so the admin can watch it back.
// Inputs are always masked here: Flow keeps that an input happened, never its value (AGENTS.md section 3).
import { record } from '@rrweb/record';

import { MAX_PAGE_TITLE_LENGTH, MAX_REPLAY_DURATION_MS, MAX_REPLAY_EVENTS, truncateText } from '@/lib/feedback-limits';
import { getPageUrl } from '@/sdk/page-context';
import { BLOCKED_SELECTOR, MASKED_SELECTOR } from '@/sdk/screen-capture';
import type { ScreenSnapshotEvent, ScreenSnapshotPage } from '@/types/screen-snapshot';


export interface ReplayRecording {
  /** ISO timestamp of the first event. */
  startedAt: string;
  page: ScreenSnapshotPage;
  events: ScreenSnapshotEvent[];
  /** True when events were dropped because the count or duration limit was reached. */
  truncated: boolean;
}

export interface ReplayRecorder {
  stop(): ReplayRecording | null;
  discard(): void;
}

export function startReplayRecording(sdkSelector: string): ReplayRecorder {
  const startedAtMs = Date.now();
  const page: ScreenSnapshotPage = {
    url: getPageUrl(window.location.href),
    title: truncateText(document.title, MAX_PAGE_TITLE_LENGTH),
    viewportWidth: window.innerWidth,
    viewportHeight: window.innerHeight,
    scrollX: window.scrollX,
    scrollY: window.scrollY,
  };
  const events: ScreenSnapshotEvent[] = [];
  let truncated = false;
  let stopRecording: (() => void) | undefined = record({
    emit: (event) => {
      const recorded = event as ScreenSnapshotEvent;
      if (events.length >= MAX_REPLAY_EVENTS || recorded.timestamp - startedAtMs > MAX_REPLAY_DURATION_MS) {
        truncated = true;
        return;
      }
      events.push(recorded);
    },
    blockSelector: `${sdkSelector}, ${BLOCKED_SELECTOR}`,
    maskTextSelector: MASKED_SELECTOR,
    maskAllInputs: true,
    slimDOMOptions: { script: true },
    inlineStylesheet: true,
    inlineImages: false,
    recordCanvas: false,
    collectFonts: false,
    // Pointer moves are thinned out; clicks, scrolls and DOM changes are kept.
    sampling: { mousemove: 100, scroll: 150, input: 'last' },
  });

  function end(): void {
    stopRecording?.();
    stopRecording = undefined;
  }

  return {
    stop() {
      end();
      if (events.length < 2) {
        return null;
      }
      return { startedAt: new Date(events[0].timestamp).toISOString(), page, events: [...events], truncated };
    },
    discard() {
      end();
      events.length = 0;
    },
  };
}
