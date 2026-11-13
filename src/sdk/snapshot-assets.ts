// Makes a saved screen independent of the host service. Same-origin fonts and images are
// pulled out as files and replaced with asset references, because the admin origin cannot load
// them (fonts need CORS, images may sit behind the reporter's login). The widget uploads each
// file once per project, so a font shared by many screens is stored and sent only once.
// Cross-origin URLs stay as they are. Works on the serialized snapshot only; the host DOM is never touched.
import { MAX_MISSING_SNAPSHOT_ASSETS } from '@/lib/feedback-limits';
import { createAssetReference } from '@/lib/snapshot-asset-references';
import type { LiveImageSource } from '@/sdk/live-image-source';
import type { MissingSnapshotAsset } from '@/types/screen-snapshot';

type SnapshotAttributes = Record<string, string | number | boolean | null>;

/** The part of an rrweb serialized node this module reads and rewrites. */
export interface SnapshotNode {
  type: number;
  id?: number;
  tagName?: string;
  attributes?: SnapshotAttributes;
  childNodes?: SnapshotNode[];
}

export interface ExtractSnapshotAssetsOptions {
  pageOrigin: string;
  /** Normalized families of fonts the page actually loaded. Unused @font-face rules are skipped. */
  loadedFontFamilies: ReadonlySet<string>;
  /**
   * CSS images shown by captured (not blocked) elements. Others were never visible on the saved screen
   * or belong to an excluded region, so they are not collected.
   */
  usedCssImageUrls: ReadonlySet<string>;
  /** Must throw SnapshotAssetTooLargeError instead of reading past maxBytes, and give up after timeoutMs. */
  fetchAsset: (url: string, maxBytes: number, timeoutMs: number) => Promise<Blob>;
  /** Downloads stop at this deadline so the capture answers the widget in time; the rest are reported as timed out. */
  maxDurationMs: number;
  now?: () => number;
  /** The image the browser actually shows for an <img>, picked from srcset or <picture>. Null for excluded images. */
  findLiveImage?: (node: SnapshotNode) => LiveImageSource | null;
  maxAssetBytes: number;
  maxTotalBytes: number;
  maxAssetCount: number;
}

export interface ExtractedSnapshotAssets {
  /** Files in reference order: reference N points to assetFiles[N]. */
  assetFiles: Blob[];
  missingAssets: MissingSnapshotAsset[];
}

export class SnapshotAssetTooLargeError extends Error {
  constructor() {
    super('The asset is larger than its budget.');
    this.name = 'SnapshotAssetTooLargeError';
  }
}

const FONT_FACE_PATTERN = /@font-face\s*\{[^}]*\}/g;
const FONT_FAMILY_PATTERN = /font-family\s*:\s*([^;}]+)/i;
const CSS_URL_PATTERN = /url\(\s*(?:"([^"]*)"|'([^']*)'|([^)\s]*))\s*\)/g;

export function normalizeFontFamily(value: string): string {
  return value.trim().replace(/^["']|["']$/g, '').toLowerCase();
}

function findCssUrls(cssText: string): string[] {
  return [...cssText.matchAll(CSS_URL_PATTERN)].map((match) => match[1] ?? match[2] ?? match[3] ?? '');
}

function getAssetLabel(url: string): string {
  const parsed = new URL(url);
  return `${parsed.origin}${parsed.pathname}`;
}

export async function extractSnapshotAssets(
  root: SnapshotNode,
  options: ExtractSnapshotAssetsOptions,
): Promise<ExtractedSnapshotAssets> {
  const isSameOrigin = (url: string): boolean => url.startsWith(`${options.pageOrigin}/`);
  // Each entry is an attribute holding CSS text: a serialized stylesheet (_cssText) or an inline style.
  const cssAttributes: { attributes: SnapshotAttributes; name: string }[] = [];
  const images: {
    attributes: SnapshotAttributes;
    source: string;
    live: LiveImageSource | null;
    picture: SnapshotNode | null;
  }[] = [];
  const urls = new Set<string>();

  function collectCssImages(attributes: SnapshotAttributes, name: string, cssText: string): void {
    cssAttributes.push({ attributes, name });
    for (const url of findCssUrls(cssText.replace(FONT_FACE_PATTERN, ''))) {
      if (isSameOrigin(url) && options.usedCssImageUrls.has(url)) {
        urls.add(url);
      }
    }
  }

  function visit(node: SnapshotNode, parent: SnapshotNode | null): void {
    const attributes = node.attributes;
    if (attributes) {
      if (typeof attributes.style === 'string') {
        collectCssImages(attributes, 'style', attributes.style);
      }
      const cssText = attributes._cssText;
      if (typeof cssText === 'string') {
        collectCssImages(attributes, '_cssText', cssText);
        for (const block of cssText.match(FONT_FACE_PATTERN) ?? []) {
          const family = FONT_FAMILY_PATTERN.exec(block)?.[1];
          if (!family || !options.loadedFontFamilies.has(normalizeFontFamily(family))) {
            continue;
          }
          // Browsers load the first source they support, so later fallbacks are not fetched.
          const source = findCssUrls(block).find(isSameOrigin);
          if (source) {
            urls.add(source);
          }
        }
      }
      if (node.tagName === 'img') {
        const live = options.findLiveImage?.(node) ?? null;
        const source = live?.url ?? attributes.src;
        if (typeof source === 'string' && isSameOrigin(source)) {
          images.push({ attributes, source, live, picture: parent?.tagName === 'picture' ? parent : null });
          urls.add(source);
        }
      }
    }
    node.childNodes?.forEach((child) => visit(child, node));
  }
  visit(root, null);

  // One download at a time, each capped by the remaining budget, so the live page never buffers more than the budget.
  const assetFiles: Blob[] = [];
  const missingAssets: MissingSnapshotAsset[] = [];
  const references = new Map<string, string>();
  let totalBytes = 0;
  const now = options.now ?? Date.now;
  const deadline = now() + options.maxDurationMs;
  for (const url of urls) {
    const remainingBytes = options.maxTotalBytes - totalBytes;
    const remainingMs = deadline - now();
    if (remainingMs <= 0) {
      missingAssets.push({ url: getAssetLabel(url), reason: 'timed_out' });
      continue;
    }
    if (assetFiles.length >= options.maxAssetCount || remainingBytes <= 0) {
      missingAssets.push({ url: getAssetLabel(url), reason: 'budget_exceeded' });
      continue;
    }
    const isLimitedByTotal = remainingBytes < options.maxAssetBytes;
    try {
      const blob = await options.fetchAsset(url, Math.min(options.maxAssetBytes, remainingBytes), remainingMs);
      totalBytes += blob.size;
      references.set(url, createAssetReference(assetFiles.length));
      assetFiles.push(blob);
    } catch (error) {
      if (!(error instanceof SnapshotAssetTooLargeError) && now() >= deadline) {
        missingAssets.push({ url: getAssetLabel(url), reason: 'timed_out' });
      } else if (!(error instanceof SnapshotAssetTooLargeError)) {
        // Recorded as a missing asset, which the viewer shows to the admin.
        missingAssets.push({ url: getAssetLabel(url), reason: 'fetch_failed' });
      } else if (isLimitedByTotal) {
        missingAssets.push({ url: getAssetLabel(url), reason: 'budget_exceeded' });
      } else {
        missingAssets.push({ url: getAssetLabel(url), reason: 'too_large' });
      }
    }
  }

  if (references.size > 0) {
    for (const { attributes, name } of cssAttributes) {
      attributes[name] = String(attributes[name]).replace(
        CSS_URL_PATTERN,
        (match, doubleQuoted?: string, singleQuoted?: string, bare?: string) => {
          const reference = references.get(doubleQuoted ?? singleQuoted ?? bare ?? '');
          if (!reference) {
            return match;
          }
          return `url("${reference}")`;
        },
      );
    }
    // The saved file is the one the browser showed, so responsive candidates that could pick another are dropped.
    for (const { attributes, source, live, picture } of images) {
      const reference = references.get(source);
      if (!reference) {
        continue;
      }
      // Without srcset the browser no longer applies the candidate's density, so its laid-out size is kept explicitly.
      const isResponsive = attributes.srcset !== undefined || picture !== null;
      if (isResponsive && live && attributes.width === undefined && attributes.height === undefined) {
        attributes.width = live.width;
        attributes.height = live.height;
      }
      attributes.src = reference;
      delete attributes.srcset;
      delete attributes.sizes;
      for (const candidate of picture?.childNodes ?? []) {
        if (candidate.tagName === 'source' && candidate.attributes) {
          delete candidate.attributes.srcset;
        }
      }
    }
  }
  return { assetFiles, missingAssets: missingAssets.slice(0, MAX_MISSING_SNAPSHOT_ASSETS) };
}
