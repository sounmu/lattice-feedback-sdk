// Makes a saved screen independent of the host service. Same-origin fonts and images are
// pulled out as files and replaced with asset references, because the admin origin cannot load
// them (fonts need CORS, images may sit behind the reporter's login). The widget uploads each
// file once per project, so a font shared by many screens is stored and sent only once.
// Cross-origin URLs stay as they are. Works on the serialized snapshot only; the host DOM is never touched.
import { MAX_MISSING_SNAPSHOT_ASSETS } from '@/lib/feedback-limits';
import { createAssetReference } from '@/lib/snapshot-asset-references';
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
  findLiveImage?: (node: SnapshotNode) => string | null;
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

// The descriptor ("2x", "800w") of the srcset candidate for url, '' for a candidate without one, null when absent.
function findSrcsetDescriptor(srcset: unknown, url: string): string | null {
  if (typeof srcset !== 'string') {
    return null;
  }
  for (const candidate of srcset.split(',')) {
    const [candidateUrl, descriptor = ''] = candidate.trim().split(/\s+/);
    if (candidateUrl === url) {
      return descriptor;
    }
  }
  return null;
}

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
        const source = options.findLiveImage?.(node) ?? attributes.src;
        if (typeof source === 'string' && isSameOrigin(source)) {
          images.push({ attributes, source, picture: parent?.tagName === 'picture' ? parent : null });
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
    // The saved file is the one the browser showed. It keeps its own srcset descriptor (2x, 800w), so the
    // browser applies the same density and the page's CSS sizes it exactly as before; other candidates are dropped.
    for (const { attributes, source, picture } of images) {
      const reference = references.get(source);
      if (!reference) {
        continue;
      }
      const sources = (picture?.childNodes ?? []).filter((candidate) => candidate.tagName === 'source');
      const chosen = [attributes, ...sources.map((candidate) => candidate.attributes ?? {})]
        .map((candidateAttributes) => ({ candidateAttributes, descriptor: findSrcsetDescriptor(candidateAttributes.srcset, source) }))
        .find(({ descriptor }) => descriptor !== null);
      for (const candidate of sources) {
        if (candidate.attributes) {
          delete candidate.attributes.srcset;
        }
      }
      if (chosen?.descriptor) {
        // src would count as an extra 1x candidate and win on a 1x viewer, so the single candidate stands alone.
        delete attributes.src;
        attributes.srcset = `${reference} ${chosen.descriptor}`;
        // A candidate's sizes never comes from another element: without its own, the default is 100vw.
        const sizes = chosen.candidateAttributes.sizes;
        if (typeof sizes === 'string') {
          attributes.sizes = sizes;
        } else {
          delete attributes.sizes;
        }
      } else {
        attributes.src = reference;
        delete attributes.srcset;
        delete attributes.sizes;
      }
    }
  }
  return { assetFiles, missingAssets: missingAssets.slice(0, MAX_MISSING_SNAPSHOT_ASSETS) };
}
