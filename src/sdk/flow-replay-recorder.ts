// Records what happens on the page while Flow is on, so the admin can watch it back.
// Inputs are always masked here: Flow keeps that an input happened, never its value (AGENTS.md section 3).
import { record } from '@rrweb/record';

import { MAX_PAGE_TITLE_LENGTH, MAX_REPLAY_DURATION_MS, MAX_REPLAY_EVENTS, truncateText } from '@/lib/feedback-limits';
import { getPageUrl } from '@/sdk/page-context';
import { findLiveImageSource } from '@/sdk/live-image-source';
import { BLOCKED_SELECTOR, findUsedCssImageUrls, MASKED_SELECTOR } from '@/sdk/screen-capture';
import type { ScreenSnapshotEvent, ScreenSnapshotPage } from '@/types/screen-snapshot';

// Reading every element's computed style is costly, so page changes are sampled at most once per second.
const CSS_USAGE_SAMPLE_INTERVAL_MS = 1000;
// rrweb EventType.IncrementalSnapshot.
const INCREMENTAL_EVENT_TYPE = 3;

export interface ReplayRecording {
  /** ISO timestamp of the first event. */
  startedAt: string;
  page: ScreenSnapshotPage;
  events: ScreenSnapshotEvent[];
  /** True when the later part is missing: the count or duration limit was reached, or the recording was cut off. */
  truncated: boolean;
  /** Same-origin CSS image URLs the page showed at some point while recording, not only at the end. */
  usedCssImageUrls: ReadonlySet<string>;
  /** The file each recorded <img> showed (srcset or <picture> choice), by rrweb node id. */
  liveImageSources: ReadonlyMap<number, string>;
}

export interface ReplayRecorder {
  stop(): ReplayRecording | null;
  /** Stops here and marks what was recorded so far as missing its later part. */
  cutOff(): ReplayRecording | null;
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
  const excludedSelector = `${sdkSelector}, ${BLOCKED_SELECTOR}`;
  const usedCssImageUrls = new Set<string>();
  let lastSampledAt = Number.NEGATIVE_INFINITY;

  function sampleCssImageUsage(at: number): void {
    lastSampledAt = at;
    findUsedCssImageUrls(excludedSelector).forEach((url) => usedCssImageUrls.add(url));
  }

  sampleCssImageUsage(startedAtMs);
  const liveImageSources = new Map<number, string>();

  // The first file seen for an image is kept, so the replay starts with what the reporter saw.
  function sampleLiveImages(): void {
    for (const image of document.querySelectorAll('img')) {
      const id = record.mirror.getId(image);
      const source = findLiveImageSource(image, excludedSelector);
      if (id >= 0 && source && !liveImageSources.has(id)) {
        liveImageSources.set(id, source);
      }
    }
  }

  let stopRecording: (() => void) | undefined = record({
    emit: (event) => {
      const recorded = event as ScreenSnapshotEvent;
      if (events.length >= MAX_REPLAY_EVENTS || recorded.timestamp - startedAtMs > MAX_REPLAY_DURATION_MS) {
        // Nothing more can be saved, so rrweb stops observing the page; the events so far are kept.
        // Stopped after this callback returns, since rrweb may still be inside its own emit loop.
        if (!truncated) {
          queueMicrotask(end);
        }
        truncated = true;
        return;
      }
      events.push(recorded);
      if (recorded.type === INCREMENTAL_EVENT_TYPE && recorded.timestamp - lastSampledAt >= CSS_USAGE_SAMPLE_INTERVAL_MS) {
        sampleCssImageUsage(recorded.timestamp);
      }
    },
    blockSelector: excludedSelector,
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
  sampleLiveImages();

  function end(): void {
    if (stopRecording) {
      sampleLiveImages();
    }
    stopRecording?.();
    stopRecording = undefined;
  }

  function findRecording(): ReplayRecording | null {
    if (events.length < 2) {
      return null;
    }
    return {
      startedAt: new Date(events[0].timestamp).toISOString(),
      page,
      events: [...events],
      truncated,
      usedCssImageUrls: new Set(usedCssImageUrls),
      liveImageSources: new Map(liveImageSources),
    };
  }

  return {
    stop() {
      end();
      return findRecording();
    },
    cutOff() {
      end();
      truncated = true;
      return findRecording();
    },
    discard() {
      end();
      events.length = 0;
    },
  };
}
