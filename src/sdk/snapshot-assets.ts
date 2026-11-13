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
  tagName?: string;
  attributes?: SnapshotAttributes;
  childNodes?: SnapshotNode[];
}

export interface ExtractSnapshotAssetsOptions {
  pageOrigin: string;
  /** Normalized families of fonts the page actually loaded. Unused @font-face rules are skipped. */
  loadedFontFamilies: ReadonlySet<string>;
  fetchAsset: (url: string) => Promise<Blob>;
  maxAssetBytes: number;
  maxTotalBytes: number;
  maxAssetCount: number;
}

export interface ExtractedSnapshotAssets {
  /** Files in reference order: reference N points to assetFiles[N]. */
  assetFiles: Blob[];
  missingAssets: MissingSnapshotAsset[];
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
  const styleAttributes: SnapshotAttributes[] = [];
  const imageAttributes: SnapshotAttributes[] = [];
  const urls = new Set<string>();

  function visit(node: SnapshotNode): void {
    const attributes = node.attributes;
    if (attributes) {
      const cssText = attributes._cssText;
      if (typeof cssText === 'string') {
        styleAttributes.push(attributes);
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
      const source = attributes.src;
      if (node.tagName === 'img' && typeof source === 'string' && isSameOrigin(source)) {
        imageAttributes.push(attributes);
        urls.add(source);
      }
    }
    node.childNodes?.forEach(visit);
  }
  visit(root);

  const fetched = await Promise.all(
    [...urls].map(async (url) => {
      try {
        return { url, blob: await options.fetchAsset(url) };
      } catch {
        // Recorded below as a missing asset, which the viewer shows to the admin.
        return { url, blob: null };
      }
    }),
  );

  const assetFiles: Blob[] = [];
  const missingAssets: MissingSnapshotAsset[] = [];
  const references = new Map<string, string>();
  let totalBytes = 0;
  for (const { url, blob } of fetched) {
    if (blob === null) {
      missingAssets.push({ url: getAssetLabel(url), reason: 'fetch_failed' });
    } else if (blob.size > options.maxAssetBytes) {
      missingAssets.push({ url: getAssetLabel(url), reason: 'too_large' });
    } else if (totalBytes + blob.size > options.maxTotalBytes || assetFiles.length >= options.maxAssetCount) {
      missingAssets.push({ url: getAssetLabel(url), reason: 'budget_exceeded' });
    } else {
      totalBytes += blob.size;
      references.set(url, createAssetReference(assetFiles.length));
      assetFiles.push(blob);
    }
  }

  if (references.size > 0) {
    for (const attributes of styleAttributes) {
      attributes._cssText = String(attributes._cssText).replace(
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
    for (const attributes of imageAttributes) {
      const reference = references.get(String(attributes.src));
      if (reference) {
        attributes.src = reference;
        delete attributes.srcset;
      }
    }
  }
  return { assetFiles, missingAssets: missingAssets.slice(0, MAX_MISSING_SNAPSHOT_ASSETS) };
}
