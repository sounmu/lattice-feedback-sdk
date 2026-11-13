// Makes a saved screen independent of the host service. Same-origin fonts and images are
// embedded as data URLs, because the admin origin cannot load them (fonts need CORS, images
// may sit behind the reporter's login). Cross-origin URLs stay as they are.
// Works on the serialized snapshot only; the host DOM is never touched.
import { MAX_MISSING_SNAPSHOT_ASSETS } from '@/lib/feedback-limits';
import type { MissingSnapshotAsset } from '@/types/screen-snapshot';

type SnapshotAttributes = Record<string, string | number | boolean | null>;

/** The part of an rrweb serialized node this module reads and rewrites. */
export interface SnapshotNode {
  type: number;
  tagName?: string;
  attributes?: SnapshotAttributes;
  childNodes?: SnapshotNode[];
}

export interface InlineSnapshotAssetsOptions {
  pageOrigin: string;
  /** Normalized families of fonts the page actually loaded. Unused @font-face rules are skipped. */
  loadedFontFamilies: ReadonlySet<string>;
  fetchAsset: (url: string) => Promise<Blob>;
  maxAssetBytes: number;
  maxTotalBytes: number;
}

const FONT_FACE_PATTERN = /@font-face\s*\{[^}]*\}/g;
const FONT_FAMILY_PATTERN = /font-family\s*:\s*([^;}]+)/i;
const CSS_URL_PATTERN = /url\(\s*(?:"([^"]*)"|'([^']*)'|([^)\s]*))\s*\)/g;
const BASE64_CHUNK_SIZE = 0x8000;

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

async function toDataUrl(blob: Blob): Promise<string> {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let binary = '';
  for (let offset = 0; offset < bytes.length; offset += BASE64_CHUNK_SIZE) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + BASE64_CHUNK_SIZE));
  }
  return `data:${blob.type || 'application/octet-stream'};base64,${btoa(binary)}`;
}

export async function inlineSnapshotAssets(
  root: SnapshotNode,
  options: InlineSnapshotAssetsOptions,
): Promise<MissingSnapshotAsset[]> {
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

  const missingAssets: MissingSnapshotAsset[] = [];
  const dataUrls = new Map<string, string>();
  let totalBytes = 0;
  for (const { url, blob } of fetched) {
    if (blob === null) {
      missingAssets.push({ url: getAssetLabel(url), reason: 'fetch_failed' });
    } else if (blob.size > options.maxAssetBytes) {
      missingAssets.push({ url: getAssetLabel(url), reason: 'too_large' });
    } else if (totalBytes + blob.size > options.maxTotalBytes) {
      missingAssets.push({ url: getAssetLabel(url), reason: 'budget_exceeded' });
    } else {
      totalBytes += blob.size;
      dataUrls.set(url, await toDataUrl(blob));
    }
  }

  if (dataUrls.size > 0) {
    for (const attributes of styleAttributes) {
      attributes._cssText = String(attributes._cssText).replace(
        CSS_URL_PATTERN,
        (match, doubleQuoted?: string, singleQuoted?: string, bare?: string) => {
          const dataUrl = dataUrls.get(doubleQuoted ?? singleQuoted ?? bare ?? '');
          if (!dataUrl) {
            return match;
          }
          return `url("${dataUrl}")`;
        },
      );
    }
    for (const attributes of imageAttributes) {
      const dataUrl = dataUrls.get(String(attributes.src));
      if (dataUrl) {
        attributes.src = dataUrl;
        delete attributes.srcset;
      }
    }
  }
  return missingAssets.slice(0, MAX_MISSING_SNAPSHOT_ASSETS);
}
