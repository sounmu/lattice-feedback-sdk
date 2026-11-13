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
import { extractSnapshotAssets, normalizeFontFamily } from '@/sdk/snapshot-assets';
import { removeInlineScripts } from '@/sdk/snapshot-scripts';
import type { ScreenCapture } from '@/types/screen-snapshot';

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

async function fetchSameOriginAsset(url: string): Promise<Blob> {
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), ASSET_FETCH_TIMEOUT_MS);
  try {
    const response = await fetch(url, { credentials: 'same-origin', cache: 'force-cache', signal: controller.signal });
    if (!response.ok) {
      throw new Error(`Asset request failed with status ${response.status}.`);
    }
    return await response.blob();
  } finally {
    window.clearTimeout(timer);
  }
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
    // rrweb's image inlining rewrites crossOrigin on live <img> elements; assets are embedded below instead.
    inlineImages: false,
    recordCanvas: false,
  });
  if (!node) {
    throw new Error('The page could not be serialized.');
  }
  removeInlineScripts(node);

  const loadedFontFamilies = new Set<string>();
  document.fonts.forEach((fontFace) => {
    if (fontFace.status === 'loaded') {
      loadedFontFamilies.add(normalizeFontFamily(fontFace.family));
    }
  });
  const { assetFiles, missingAssets } = await extractSnapshotAssets(node, {
    pageOrigin: window.location.origin,
    loadedFontFamilies,
    fetchAsset: fetchSameOriginAsset,
    maxAssetBytes: MAX_SNAPSHOT_ASSET_BYTES,
    maxTotalBytes: MAX_SNAPSHOT_ASSETS_TOTAL_BYTES,
    maxAssetCount: MAX_SNAPSHOT_ASSETS,
  });

  const url = getPageUrl(window.location.href);
  const screen = {
    format: SCREEN_SNAPSHOT_FORMAT,
    capturedAt: new Date(capturedAt).toISOString(),
    page: {
      url,
      title: truncateText(document.title, MAX_PAGE_TITLE_LENGTH),
      viewportWidth: window.innerWidth,
      viewportHeight: window.innerHeight,
      scrollX: window.scrollX,
      scrollY: window.scrollY,
    },
    events: [
      {
        type: RRWEB_META_EVENT_TYPE,
        timestamp: capturedAt,
        data: { href: url, width: window.innerWidth, height: window.innerHeight },
      },
      {
        type: RRWEB_FULL_SNAPSHOT_EVENT_TYPE,
        timestamp: capturedAt,
        data: { node, initialOffset: { left: window.scrollX, top: window.scrollY } },
      },
    ],
    missingAssets,
  };
  return { screen, assetFiles };
}
