// Records what happens on the page while Flow is on, so the admin can watch it back.
// Inputs are always masked here: Flow keeps that an input happened, never its value (AGENTS.md section 3).
import { record } from '@rrweb/record';

import {
  MAX_PAGE_TITLE_LENGTH,
  MAX_PLAIN_REPLAY_BYTES,
  MAX_REPLAY_BYTES,
  MAX_REPLAY_DURATION_MS,
  MAX_REPLAY_EVENTS,
  truncateText,
} from '@/lib/feedback-limits';
import { isGzipSupported } from '@/lib/gzip';
import { RRWEB_INCREMENTAL_EVENT_TYPE } from '@/lib/screen-snapshot';
import { getPageUrl } from '@/sdk/page-context';
import { findLiveImageSource } from '@/sdk/live-image-source';
import { isMutationEvent, type MutationData } from '@/sdk/replay-sanitize';
import { BLOCKED_SELECTOR, findUsedCssImageUrls, MASKED_SELECTOR } from '@/sdk/screen-capture';
import type { SnapshotNode } from '@/sdk/snapshot-assets';
import type { ScreenSnapshotEvent, ScreenSnapshotPage } from '@/types/screen-snapshot';

// Reading every element's computed style is costly, so page changes are sampled at most once per second.
const CSS_USAGE_SAMPLE_INTERVAL_MS = 1000;
const IMAGE_TAG_NAME = 'img';

export interface ReplayRecording {
  /** ISO timestamp of the first event. */
  startedAt: string;
  page: ScreenSnapshotPage;
  events: ScreenSnapshotEvent[];
  /** True when the later part is missing: the count, size or duration limit was reached, or the recording was cut off. */
  truncated: boolean;
  /** Same-origin CSS image URLs the page showed at some point while recording, not only at the end. */
  usedCssImageUrls: ReadonlySet<string>;
  /** The file each <img> showed when it was recorded (srcset or <picture> choice), by rrweb node id. */
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
  const encoder = new TextEncoder();
  let recordedBytes = 0;
  const maxReplayBytes = isGzipSupported() ? MAX_REPLAY_BYTES : MAX_PLAIN_REPLAY_BYTES;

  // The first file seen for an image is kept, so the replay starts with what the reporter saw.
  function keepLiveImage(id: number, element: unknown): void {
    const source = findLiveImageSource(element, excludedSelector);
    if (id >= 0 && source && !liveImageSources.has(id)) {
      liveImageSources.set(id, source);
    }
  }

  function sampleShownImages(): void {
    for (const image of document.querySelectorAll(IMAGE_TAG_NAME)) {
      keepLiveImage(record.mirror.getId(image), image);
    }
  }

  // An image inserted later is read when its insertion is recorded. Read at the end, it would show a
  // file it changed to afterwards from the moment it appears in the replay.
  function sampleAddedImages(event: ScreenSnapshotEvent): void {
    if (!isMutationEvent(event)) {
      return;
    }
    const visit = (node: SnapshotNode): void => {
      if (node.tagName === IMAGE_TAG_NAME && node.id !== undefined) {
        keepLiveImage(node.id, record.mirror.getNode(node.id));
      }
      node.childNodes?.forEach(visit);
    };
    (event.data as MutationData).adds?.forEach((add) => visit(add.node));
  }

  let stopRecording: (() => void) | undefined = record({
    emit: (event) => {
      const recorded = event as ScreenSnapshotEvent;
      const isChange = recorded.type === RRWEB_INCREMENTAL_EVENT_TYPE;
      const bytes = encoder.encode(JSON.stringify(recorded)).length;
      // The first snapshot is always kept; page changes stop once the screen would no longer fit an upload,
      // so a long recording is saved cut short instead of being rejected whole.
      const isOverBytes = isChange && recordedBytes + bytes > maxReplayBytes;
      if (events.length >= MAX_REPLAY_EVENTS || recorded.timestamp - startedAtMs > MAX_REPLAY_DURATION_MS || isOverBytes) {
        // Nothing more can be saved, so rrweb stops observing the page; the events so far are kept.
        // Stopped after this callback returns, since rrweb may still be inside its own emit loop.
        if (!truncated) {
          queueMicrotask(end);
        }
        truncated = true;
        return;
      }
      events.push(recorded);
      recordedBytes += bytes;
      sampleAddedImages(recorded);
      if (isChange && recorded.timestamp - lastSampledAt >= CSS_USAGE_SAMPLE_INTERVAL_MS) {
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
  sampleShownImages();

  function end(): void {
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
