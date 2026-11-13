// Saves the current page as a screen the admin can rebuild (AGENTS.md section 3, 공통 기반).
// rrweb-snapshot serializes the DOM and applied CSS without patching or mutating the host page.
// Never collected (AGENTS.md section 5): password values, anything marked data-lattice-block or
// data-lattice-mask, script contents, and the SDK's own UI.
import { createMirror, snapshot } from 'rrweb-snapshot';

import {
  MAX_PAGE_TITLE_LENGTH,
  MAX_SNAPSHOT_ASSET_BYTES,
  MAX_SNAPSHOT_ASSETS,
  MAX_SNAPSHOT_ASSETS_TOTAL_BYTES,
  truncateText,
} from '@/lib/feedback-limits';
import {
  createCommentPinEvent,
  createEditMoveEvent,
  createReplayTruncatedEvent,
  RRWEB_FULL_SNAPSHOT_EVENT_TYPE,
  RRWEB_INCREMENTAL_EVENT_TYPE,
  RRWEB_META_EVENT_TYPE,
  SCREEN_SNAPSHOT_FORMAT,
} from '@/lib/screen-snapshot';
import { getPageUrl } from '@/sdk/page-context';
import { extractSnapshotAssets, normalizeFontFamily, SnapshotAssetTooLargeError } from '@/sdk/snapshot-assets';
import { findLiveImageSource } from '@/sdk/live-image-source';
import { removeHiddenValues } from '@/sdk/snapshot-hidden-values';
import { removeInlineScripts } from '@/sdk/snapshot-scripts';
import type { ReplayRecording } from '@/sdk/flow-replay-recorder';
import { createReplayAssetRoot } from '@/sdk/replay-assets';
import { sanitizeReplayEvents, trimReplayStart } from '@/sdk/replay-sanitize';
import { createCommentPins, createEditMoves, type CommentPinSource, type EditMoveSource } from '@/sdk/screen-marks';

import type { CapturedScreen, ScreenCapture } from '@/types/screen-snapshot';

/** Comments and proposed moves to mark on the saved screen. */
export interface ScreenMarkSources {
  comments: readonly CommentPinSource[];
  edits: readonly EditMoveSource[];
}

export const BLOCKED_SELECTOR = '[data-lattice-block], [data-lattice-overlay]';
export const MASKED_SELECTOR = '[data-lattice-mask]';
const ASSET_FETCH_TIMEOUT_MS = 10_000;
// The widget waits 30 s for the capture; this leaves time to serialize and answer.
const ASSET_COLLECTION_DURATION_MS = 15_000;
const CSS_IMAGE_PROPERTIES = ['background-image', 'border-image-source', 'list-style-image', 'mask-image'] as const;
const PSEUDO_ELEMENTS = [null, '::before', '::after'] as const;
const CSS_IMAGE_URL_PATTERN = /url\(\s*"([^"]*)"\s*\)/g;

function isMaskedInput(element: HTMLElement): boolean {
  if (element.closest(MASKED_SELECTOR)) {
    return true;
  }
  // A "show password" toggle switches the type to text, so the autocomplete hint is checked too.
  return element instanceof HTMLInputElement && (element.type === 'password' || element.autocomplete.includes('password'));
}

// Reads at most maxBytes, so a file over the budget is cancelled instead of being held in the host page's memory.
async function fetchSameOriginAsset(url: string, maxBytes: number, timeoutMs: number): Promise<Blob> {
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), Math.min(ASSET_FETCH_TIMEOUT_MS, timeoutMs));
  try {
    const response = await fetch(url, { credentials: 'same-origin', cache: 'force-cache', signal: controller.signal });
    if (!response.ok || !response.body) {
      throw new Error(`Asset request failed with status ${response.status}.`);
    }
    if (Number(response.headers.get('content-length') ?? 0) > maxBytes) {
      controller.abort();
      throw new SnapshotAssetTooLargeError();
    }
    const reader = response.body.getReader();
    const chunks: Uint8Array<ArrayBuffer>[] = [];
    let totalBytes = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }
      totalBytes += value.byteLength;
      if (totalBytes > maxBytes) {
        await reader.cancel();
        throw new SnapshotAssetTooLargeError();
      }
      chunks.push(value);
    }
    return new Blob(chunks, { type: response.headers.get('content-type') ?? '' });
  } finally {
    window.clearTimeout(timer);
  }
}

// CSS images that captured elements actually show. Elements in a blocked region are skipped, so a
// stylesheet shared with them cannot carry their images into the saved screen.
export function findUsedCssImageUrls(excludedSelector: string): Set<string> {
  const urls = new Set<string>();
  for (const element of document.querySelectorAll('*')) {
    if (element.closest(excludedSelector)) {
      continue;
    }
    for (const pseudoElement of PSEUDO_ELEMENTS) {
      const style = getComputedStyle(element, pseudoElement);
      for (const property of CSS_IMAGE_PROPERTIES) {
        for (const match of style.getPropertyValue(property).matchAll(CSS_IMAGE_URL_PATTERN)) {
          urls.add(match[1]);
        }
      }
    }
  }
  return urls;
}

export async function captureScreen(
  sdkSelector: string,
  marks: ScreenMarkSources = { comments: [], edits: [] },
): Promise<ScreenCapture> {
  const capturedAt = Date.now();
  const excludedSelector = `${sdkSelector}, ${BLOCKED_SELECTOR}`;
  const mirror = createMirror();
  const node = snapshot(document, {
    mirror,
    blockSelector: excludedSelector,
    maskTextSelector: MASKED_SELECTOR,
    // Every input value passes through maskInputFn, which hides only the ones that must not be stored.
    maskAllInputs: true,
    maskInputFn: (text, element) => (isMaskedInput(element) ? '*'.repeat(text.length) : text),
    inlineStylesheet: true,
    slimDOM: { script: true },
    // rrweb's image inlining rewrites crossOrigin on live <img> elements; assets are extracted below instead.
    inlineImages: false,
    recordCanvas: false,
  });
  if (!node) {
    throw new Error('The page could not be serialized.');
  }
  removeInlineScripts(node);
  removeHiddenValues(node);

  // Read together with the DOM, before any await: the reporter may scroll or navigate while files download.
  const url = getPageUrl(window.location.href);
  const page: CapturedScreen['page'] = {
    url,
    title: truncateText(document.title, MAX_PAGE_TITLE_LENGTH),
    viewportWidth: window.innerWidth,
    viewportHeight: window.innerHeight,
    scrollX: window.scrollX,
    scrollY: window.scrollY,
  };
  const moves = createEditMoves(marks.edits, (element) => mirror.getId(element));
  const pins = createCommentPins(marks.comments, {
    findNodeId: (element) => mirror.getId(element),
    scrollX: page.scrollX,
    scrollY: page.scrollY,
  });
  const loadedFontFamilies = new Set<string>();
  document.fonts.forEach((fontFace) => {
    if (fontFace.status === 'loaded') {
      loadedFontFamilies.add(normalizeFontFamily(fontFace.family));
    }
  });

  const { assetFiles, missingAssets } = await extractSnapshotAssets(node, {
    pageOrigin: window.location.origin,
    loadedFontFamilies,
    usedCssImageUrls: findUsedCssImageUrls(excludedSelector),
    fetchAsset: fetchSameOriginAsset,
    maxDurationMs: ASSET_COLLECTION_DURATION_MS,
    matchesMedia: (query) => window.matchMedia(query).matches,
    findLiveImage: (serialized) => {
      if (serialized.id === undefined) {
        return null;
      }
      return findLiveImageSource(mirror.getNode(serialized.id), excludedSelector);
    },
    maxAssetBytes: MAX_SNAPSHOT_ASSET_BYTES,
    maxTotalBytes: MAX_SNAPSHOT_ASSETS_TOTAL_BYTES,
    maxAssetCount: MAX_SNAPSHOT_ASSETS,
  });

  const screen: CapturedScreen = {
    format: SCREEN_SNAPSHOT_FORMAT,
    capturedAt: new Date(capturedAt).toISOString(),
    page,
    events: [
      {
        type: RRWEB_META_EVENT_TYPE,
        timestamp: capturedAt,
        data: { href: url, width: page.viewportWidth, height: page.viewportHeight },
      },
      {
        type: RRWEB_FULL_SNAPSHOT_EVENT_TYPE,
        timestamp: capturedAt,
        data: { node, initialOffset: { left: page.scrollX, top: page.scrollY } },
      },
      ...pins.map((pin) => createCommentPinEvent(pin, capturedAt)),
      ...moves.map((move) => createEditMoveEvent(move, capturedAt)),
    ],
    missingAssets,
  };
  return { screen, assetFiles };
}

function findLoadedFontFamilies(): Set<string> {
  const families = new Set<string>();
  document.fonts.forEach((fontFace) => {
    if (fontFace.status === 'loaded') {
      families.add(normalizeFontFamily(fontFace.family));
    }
  });
  return families;
}

/**
 * Turns a recorded Flow into a saved screen: its first full snapshot plus the page changes after it.
 * The same exclusions as a still screen are applied to every recorded node and attribute change, and the
 * fonts and images they refer to are pulled out as files. A recording that lost its later part ends with a
 * marker event.
 */
export async function captureRecording(recording: ReplayRecording, sdkSelector: string): Promise<ScreenCapture> {
  const [meta, full, ...rest] = trimReplayStart(recording.events, recording.page.url);
  if (meta?.type !== RRWEB_META_EVENT_TYPE || full?.type !== RRWEB_FULL_SNAPSHOT_EVENT_TYPE) {
    throw new Error('The recording does not start with a full snapshot.');
  }
  // A later Meta or FullSnapshot (a checkout) is not expected; only the changes are kept after the first pair.
  const events = [meta, full, ...rest.filter((event) => event.type === RRWEB_INCREMENTAL_EVENT_TYPE)];
  const elements = sanitizeReplayEvents(events);
  const excludedSelector = `${sdkSelector}, ${BLOCKED_SELECTOR}`;
  const assetRoot = createReplayAssetRoot(events, elements);
  const { assetFiles, missingAssets } = await extractSnapshotAssets(assetRoot.root, {
    pageOrigin: window.location.origin,
    loadedFontFamilies: findLoadedFontFamilies(),
    // Images the page showed while recording count too, not only those still shown at the end.
    usedCssImageUrls: new Set([...recording.usedCssImageUrls, ...findUsedCssImageUrls(excludedSelector)]),
    fetchAsset: fetchSameOriginAsset,
    maxDurationMs: ASSET_COLLECTION_DURATION_MS,
    matchesMedia: (query) => window.matchMedia(query).matches,
    maxAssetBytes: MAX_SNAPSHOT_ASSET_BYTES,
    maxTotalBytes: MAX_SNAPSHOT_ASSETS_TOTAL_BYTES,
    maxAssetCount: MAX_SNAPSHOT_ASSETS,
  });
  assetRoot.applyStyleChanges();
  if (recording.truncated) {
    events.push(createReplayTruncatedEvent(events[events.length - 1].timestamp));
  }
  const screen: CapturedScreen = {
    format: SCREEN_SNAPSHOT_FORMAT,
    capturedAt: recording.startedAt,
    page: recording.page,
    events,
    missingAssets,
  };
  return { screen, assetFiles };
}
