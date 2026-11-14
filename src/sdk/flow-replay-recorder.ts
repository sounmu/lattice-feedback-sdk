// Records what happens on the page while Flow is on, so the admin can watch it back.
// Inputs are always masked here: Flow keeps that an input happened, never its value (AGENTS.md section 3).
// Each event is cleaned before it is kept, and saved as it is recorded, so the replay continues in the next
// document after a reload or full navigation instead of starting over.
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
import { RRWEB_FULL_SNAPSHOT_EVENT_TYPE, RRWEB_INCREMENTAL_EVENT_TYPE, RRWEB_META_EVENT_TYPE } from '@/lib/screen-snapshot';
import { findGapBefore, mergeReplayChunks, type ReplaySegment } from '@/sdk/flow-replay-segment';
import { openReplayStore, type ReplayChunk } from '@/sdk/flow-replay-session';
import { getPageUrl } from '@/sdk/page-context';
import { findLiveImageSource } from '@/sdk/live-image-source';
import { isMutationEvent, sanitizeReplayEvents, trimReplayStart, type MutationData, type RecordedElements } from '@/sdk/replay-sanitize';
import { findStyleSheetOwnerId, resolveStyleSheetChange } from '@/sdk/replay-assets';
import { BLOCKED_SELECTOR, findLoadedFontFamilies, findUsedCssImageUrls, MASKED_SELECTOR } from '@/sdk/screen-capture';
import type { SnapshotNode } from '@/sdk/snapshot-assets';
import type { ScreenSnapshotEvent, ScreenSnapshotPage } from '@/types/screen-snapshot';

// Reading every element's computed style is costly, so page changes are sampled at most once per second.
const CSS_USAGE_SAMPLE_INTERVAL_MS = 1000;
const IMAGE_TAG_NAME = 'img';
// The DOMContentLoaded and Load events rrweb emits when it starts on a loading page are not kept.
const RECORDED_EVENT_TYPES: ReadonlySet<number> = new Set([RRWEB_META_EVENT_TYPE, RRWEB_FULL_SNAPSHOT_EVENT_TYPE, RRWEB_INCREMENTAL_EVENT_TYPE]);
// Until the saved part is read, a later document does not know which segment it is.
const UNKNOWN_SEGMENT = -2;

export interface ReplaySession {
  projectKey: string;
  /** Identifies one Flow in one tab and stays the same across its documents. */
  sessionId: string;
  /** True when the Flow began in an earlier document, whose saved replay is read back first. */
  resumed: boolean;
  /** False on a page the policy leaves out: nothing of it is read, and the replay ends at the pages before it. */
  recordPage: boolean;
}

export interface ReplayRecording {
  /** ISO timestamp of the first event. */
  startedAt: string;
  /** The first recorded page. */
  page: ScreenSnapshotPage;
  /** One per recorded document, in order. */
  segments: ReplaySegment[];
  /** True when the later part is missing: the count, size or duration limit was reached, or the recording was cut off. */
  truncated: boolean;
}

export interface ReplayRecorder {
  /** Stops and hands over the whole replay, earlier documents included. Its saved copy is removed. */
  stop(): Promise<ReplayRecording | null>;
  /** Stops recording for good and marks the replay as missing its later part; later documents record nothing. */
  cutOff(): void;
  /** Stops and removes the replay, its saved copy included. */
  discard(): void;
}

function createUnsaved(): Pick<ReplayChunk, 'events' | 'bytes' | 'usedCssImageUrls' | 'loadedFontFamilies' | 'liveImageSources'> {
  return { events: [], bytes: 0, usedCssImageUrls: [], loadedFontFamilies: [], liveImageSources: [] };
}

// rrweb records a rule set through script as the page wrote it. In a linked stylesheet its URLs are relative
// to that file, so they are made absolute while the page can still tell where the file is.
function resolveLinkedStyleSheetUrls(event: ScreenSnapshotEvent): ScreenSnapshotEvent {
  const ownerId = findStyleSheetOwnerId(event);
  if (ownerId === undefined) {
    return event;
  }
  const owner = record.mirror.getNode(ownerId) as { sheet?: { href?: string | null } | null } | null;
  const styleSheetUrl = owner?.sheet?.href;
  return styleSheetUrl ? resolveStyleSheetChange(event, styleSheetUrl) : event;
}

export function startReplayRecording(sdkSelector: string, session: ReplaySession): ReplayRecorder {
  const store = openReplayStore(session.projectKey, session.sessionId);
  const page: ScreenSnapshotPage = {
    url: getPageUrl(window.location.href),
    title: truncateText(document.title, MAX_PAGE_TITLE_LENGTH),
    viewportWidth: window.innerWidth,
    viewportHeight: window.innerHeight,
    scrollX: window.scrollX,
    scrollY: window.scrollY,
  };
  const excludedSelector = `${sdkSelector}, ${BLOCKED_SELECTOR}`;
  const maxReplayBytes = isGzipSupported() ? MAX_REPLAY_BYTES : MAX_PLAIN_REPLAY_BYTES;
  const encoder = new TextEncoder();
  const elements: RecordedElements = new Map();
  const events: ScreenSnapshotEvent[] = [];
  const usedCssImageUrls = new Set<string>();
  const loadedFontFamilies = new Set<string>();
  const liveImageSources = new Map<number, string>();
  let earlier: ReplaySegment[] = [];
  let segment = session.resumed ? UNKNOWN_SEGMENT : 0;
  let gapBefore = false;
  let startedAtMs = Date.now();
  // Events and bytes of the whole Flow so far, earlier documents included.
  let totalCount = 0;
  let totalBytes = 0;
  let truncated = !session.recordPage;
  let isRemoved = false;
  // Events wait here until the saved part is read, because the limits count it too. Null from then on.
  let waiting: ScreenSnapshotEvent[] | null = session.resumed ? [] : null;
  let unsaved = createUnsaved();
  let nextChunkIndex = 0;
  let isSaveQueued = false;
  let lastSampledAt = Number.NEGATIVE_INFINITY;
  let stopRecording: (() => void) | undefined;

  // Each document notes its own images and fonts: a later document of the Flow cannot tell what an
  // earlier one showed.
  function sampleAssetUsage(at: number): void {
    lastSampledAt = at;
    for (const url of findUsedCssImageUrls(excludedSelector)) {
      if (!usedCssImageUrls.has(url)) {
        usedCssImageUrls.add(url);
        unsaved.usedCssImageUrls.push(url);
      }
    }
    for (const family of findLoadedFontFamilies()) {
      if (!loadedFontFamilies.has(family)) {
        loadedFontFamilies.add(family);
        unsaved.loadedFontFamilies.push(family);
      }
    }
  }

  // The first file seen for an image is kept, so the replay starts with what the reporter saw.
  function keepLiveImage(id: number, element: unknown): void {
    const source = findLiveImageSource(element, excludedSelector);
    if (id >= 0 && source && !liveImageSources.has(id)) {
      liveImageSources.set(id, source);
      unsaved.liveImageSources.push([id, source]);
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

  // Runs in a microtask after each burst of events, so a navigation interrupts at most that burst.
  function save(ended = false): void {
    isSaveQueued = false;
    // Images and fonts noted since the last save are worth a chunk of their own: without them the files
    // of this document are neither saved nor reported as missing.
    const hasUnsaved = unsaved.events.length > 0 || unsaved.usedCssImageUrls.length > 0 ||
      unsaved.loadedFontFamilies.length > 0 || unsaved.liveImageSources.length > 0;
    if (isRemoved || waiting || (!hasUnsaved && !ended)) {
      return;
    }
    store.append({ segment, index: nextChunkIndex, page: session.recordPage ? page : null, gapBefore, ended, ...unsaved });
    nextChunkIndex += 1;
    unsaved = createUnsaved();
  }

  function end(): void {
    stopRecording?.();
    stopRecording = undefined;
    window.removeEventListener('pagehide', handlePageHide);
    window.removeEventListener('pageshow', handlePageShow);
  }

  // Nothing more is recorded, here or in later documents: the saved copy carries that on.
  function finish(): void {
    truncated = true;
    // rrweb may still be inside its own emit loop, so it is stopped after this call returns.
    queueMicrotask(end);
    save(true);
  }

  function accept(event: ScreenSnapshotEvent): void {
    if (truncated) {
      return;
    }
    const isChange = event.type === RRWEB_INCREMENTAL_EVENT_TYPE;
    const text = JSON.stringify(event);
    const bytes = encoder.encode(text).length;
    // Only the very first snapshot is kept whatever its size; everything after it has to fit an upload,
    // so a long recording is saved cut short instead of being rejected whole.
    const isOverBytes = (isChange || earlier.length > 0) && totalBytes + bytes > maxReplayBytes;
    if (totalCount >= MAX_REPLAY_EVENTS || event.timestamp - startedAtMs > MAX_REPLAY_DURATION_MS || isOverBytes) {
      finish();
      return;
    }
    // rrweb keeps the nodes it emitted as its own record of the page, so a copy is what gets cleaned and kept.
    const recorded = JSON.parse(text) as ScreenSnapshotEvent;
    if (recorded.type === RRWEB_META_EVENT_TYPE) {
      // The Meta event carries window.location.href; the kept one gets the URL without query and fragment.
      recorded.data = { ...(recorded.data as Record<string, unknown>), href: page.url };
    }
    sanitizeReplayEvents([recorded], elements);
    events.push(recorded);
    unsaved.events.push(recorded);
    unsaved.bytes += bytes;
    totalCount += 1;
    totalBytes += bytes;
    if (!isSaveQueued) {
      isSaveQueued = true;
      queueMicrotask(save);
    }
  }

  function handleEvent(emitted: ScreenSnapshotEvent): void {
    if (truncated || !RECORDED_EVENT_TYPES.has(emitted.type)) {
      return;
    }
    const event = resolveLinkedStyleSheetUrls(emitted);
    // The page is read now, even when the event itself has to wait for the saved part.
    sampleAddedImages(event);
    if (event.type === RRWEB_FULL_SNAPSHOT_EVENT_TYPE) {
      for (const image of document.querySelectorAll(IMAGE_TAG_NAME)) {
        keepLiveImage(record.mirror.getId(image), image);
      }
    }
    if (event.type === RRWEB_INCREMENTAL_EVENT_TYPE && event.timestamp - lastSampledAt >= CSS_USAGE_SAMPLE_INTERVAL_MS) {
      sampleAssetUsage(event.timestamp);
    }
    if (!waiting) {
      accept(event);
      return;
    }
    waiting.push(event);
    if (waiting.length >= MAX_REPLAY_EVENTS) {
      finish();
    }
  }

  function restore(chunks: ReplayChunk[]): void {
    if (isRemoved) {
      return;
    }
    const saved = mergeReplayChunks(chunks);
    const progress = store.findProgress();
    earlier = saved.segments;
    segment = saved.lastSegment + 1;
    gapBefore = findGapBefore(saved, progress);
    totalCount = saved.eventCount + (gapBefore ? 1 : 0);
    totalBytes = saved.bytes;
    startedAtMs = earlier[0]?.events[0].timestamp ?? startedAtMs;
    const held = waiting ?? [];
    waiting = null;
    if (saved.isEnded || truncated) {
      finish();
      return;
    }
    held.forEach(accept);
  }

  function handlePageHide(): void {
    // The last look at this document: a later one cannot tell which images and fonts it showed.
    if (!truncated) {
      sampleAssetUsage(Date.now());
    }
    save();
    store.saveProgress({ segment, eventCount: events.length });
    // IndexedDB may not finish writing before this document goes; the next one merges the stash in.
    store.stashPending();
  }

  // A restored document starts a fresh snapshot after the pages recorded while it was suspended.
  // Reusing its old node stream would place new events before those intervening pages.
  function handlePageShow(event: PageTransitionEvent): void {
    if (!event.persisted || truncated || isRemoved) {
      return;
    }
    stopRecording?.();
    stopRecording = undefined;
    waiting = [];
    events.length = 0;
    elements.clear();
    usedCssImageUrls.clear();
    loadedFontFamilies.clear();
    liveImageSources.clear();
    unsaved = createUnsaved();
    nextChunkIndex = 0;
    segment = UNKNOWN_SEGMENT;
    ready = ready.then(() => store.load()).then(restore);
    beginRecording();
  }

  let ready: Promise<void> = session.resumed ? store.load().then(restore) : Promise.resolve();
  function beginRecording(): void {
    sampleAssetUsage(Date.now());
    stopRecording = record({
      emit: (event) => handleEvent(event as ScreenSnapshotEvent),
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
  }

  if (session.recordPage) {
    beginRecording();
    window.addEventListener('pagehide', handlePageHide);
    window.addEventListener('pageshow', handlePageShow);
  }

  function findRecording(): ReplayRecording | null {
    const playable = trimReplayStart(events, page.url);
    const segments = [...earlier];
    if (playable.length > 0) {
      segments.push({ page, events: playable, usedCssImageUrls: [...usedCssImageUrls], loadedFontFamilies: [...loadedFontFamilies], liveImageSources: [...liveImageSources], gapBefore });
    }
    if (segments.length === 0) {
      return null;
    }
    return {
      startedAt: new Date(segments[0].events[0].timestamp).toISOString(),
      page: segments[0].page,
      segments,
      // A page left before its snapshot was taken is missing from the end, like one that was cut short.
      truncated: truncated || playable.length === 0,
    };
  }

  return {
    async stop() {
      end();
      await ready;
      if (isRemoved) {
        return null;
      }
      const recording = findRecording();
      isRemoved = true;
      void store.clear();
      return recording;
    },
    cutOff() {
      end();
      if (!truncated) {
        finish();
      }
    },
    discard() {
      end();
      isRemoved = true;
      void store.clear();
    },
  };
}
