// Saves the current page as a screen the admin can rebuild (AGENTS.md section 3, 공통 기반).
// rrweb-snapshot serializes the DOM and applied CSS without patching or mutating the host page.
// Never collected (AGENTS.md section 5): password values, anything marked data-lattice-block or
// data-lattice-mask, script contents, and the SDK's own UI.
import { snapshot } from 'rrweb-snapshot';

import {
  MAX_PAGE_TITLE_LENGTH,
  MAX_SNAPSHOT_ASSET_BYTES,
  MAX_SNAPSHOT_ASSETS,
  MAX_SNAPSHOT_ASSETS_TOTAL_BYTES,
  truncateText,
} from '@/lib/feedback-limits';
import { RRWEB_FULL_SNAPSHOT_EVENT_TYPE, RRWEB_META_EVENT_TYPE, SCREEN_SNAPSHOT_FORMAT } from '@/lib/screen-snapshot';
import { getPageUrl } from '@/sdk/page-context';
import { extractSnapshotAssets, normalizeFontFamily, SnapshotAssetTooLargeError } from '@/sdk/snapshot-assets';
import { removeInlineScripts } from '@/sdk/snapshot-scripts';
import type { CapturedScreen, ScreenCapture } from '@/types/screen-snapshot';

const BLOCKED_SELECTOR = '[data-lattice-block], [data-lattice-overlay]';
const MASKED_SELECTOR = '[data-lattice-mask]';
const ASSET_FETCH_TIMEOUT_MS = 10_000;

function isMaskedInput(element: HTMLElement): boolean {
  if (element.closest(MASKED_SELECTOR)) {
    return true;
  }
  // A "show password" toggle switches the type to text, so the autocomplete hint is checked too.
  return element instanceof HTMLInputElement && (element.type === 'password' || element.autocomplete.includes('password'));
}

// Reads at most maxBytes, so a file over the budget is cancelled instead of being held in the host page's memory.
async function fetchSameOriginAsset(url: string, maxBytes: number): Promise<Blob> {
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), ASSET_FETCH_TIMEOUT_MS);
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

// URLs the page actually loaded. A CSS image is saved only when it was really shown, not for every rule in the stylesheet.
function getLoadedResourceUrls(): Set<string> {
  return new Set(performance.getEntriesByType('resource').map((entry) => entry.name));
}

export async function captureScreen(sdkSelector: string): Promise<ScreenCapture> {
  const capturedAt = Date.now();
  const node = snapshot(document, {
    blockSelector: `${sdkSelector}, ${BLOCKED_SELECTOR}`,
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
  const loadedFontFamilies = new Set<string>();
  document.fonts.forEach((fontFace) => {
    if (fontFace.status === 'loaded') {
      loadedFontFamilies.add(normalizeFontFamily(fontFace.family));
    }
  });

  const { assetFiles, missingAssets } = await extractSnapshotAssets(node, {
    pageOrigin: window.location.origin,
    loadedFontFamilies,
    loadedResourceUrls: getLoadedResourceUrls(),
    fetchAsset: fetchSameOriginAsset,
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
    ],
    missingAssets,
  };
  return { screen, assetFiles };
}
