import { expect, it, vi } from 'vitest';
import { createAssetReference, resolveAssetReferences } from '@/lib/snapshot-asset-references';
import {
  extractSnapshotAssets,
  SnapshotAssetTooLargeError,
  type ExtractSnapshotAssetsOptions,
  type SnapshotNode,
} from '@/sdk/snapshot-assets';

const ORIGIN = 'https://host.example.com';
const FONT_BYTES = 'font-bytes';

function createOptions(overrides: Partial<ExtractSnapshotAssetsOptions> = {}): ExtractSnapshotAssetsOptions {
  return {
    pageOrigin: ORIGIN,
    loadedFontFamilies: new Set(['pretendard']),
    usedCssImageUrls: new Set(),
    fetchAsset: vi.fn(async () => new Blob([FONT_BYTES], { type: 'font/woff2' })),
    maxAssetBytes: 1000,
    maxTotalBytes: 2000,
    maxAssetCount: 10,
    maxDurationMs: 15_000,
    ...overrides,
  };
}

function createStyleNode(cssText: string): SnapshotNode {
  return { type: 2, tagName: 'style', attributes: { _cssText: cssText }, childNodes: [] };
}

function createImage(src: string): SnapshotNode {
  return { type: 2, tagName: 'img', attributes: { src }, childNodes: [] };
}

function createDocument(...childNodes: SnapshotNode[]): SnapshotNode {
  return { type: 0, childNodes };
}

it('pulls out only the first same-origin source of a font family the page loaded', async () => {
  const style = createStyleNode(
    [
      `@font-face { font-family: "Pretendard"; src: url("${ORIGIN}/fonts/a.woff2") format("woff2"), url("${ORIGIN}/fonts/a.woff") format("woff"); }`,
      `@font-face { font-family: Unused; src: url("${ORIGIN}/fonts/unused.woff2"); }`,
      '@font-face { font-family: Pretendard; src: url("https://cdn.example.com/b.woff2"); }',
      `.logo { background: url("${ORIGIN}/logo.png"); }`,
    ].join('\n'),
  );
  const options = createOptions();

  const { assetFiles, missingAssets } = await extractSnapshotAssets(createDocument(style), options);

  const cssText = String(style.attributes?._cssText);
  expect(options.fetchAsset).toHaveBeenCalledTimes(1);
  expect(options.fetchAsset).toHaveBeenCalledWith(`${ORIGIN}/fonts/a.woff2`, 1000, expect.any(Number));
  expect(await assetFiles[0].text()).toBe(FONT_BYTES);
  expect(resolveAssetReferences(cssText, (index) => `blob:file-${index}`)).toContain('url("blob:file-0") format("woff2")');
  expect(cssText).toContain(`url("${ORIGIN}/fonts/a.woff")`);
  expect(cssText).toContain(`url("${ORIGIN}/fonts/unused.woff2")`);
  expect(cssText).toContain('url("https://cdn.example.com/b.woff2")');
  expect(cssText).toContain(`url("${ORIGIN}/logo.png")`);
  expect(missingAssets).toEqual([]);
});

it('refers to same-origin images by position and leaves cross-origin images on their own URL', async () => {
  const local = createImage(`${ORIGIN}/logo.svg`);
  local.attributes = { ...local.attributes, srcset: `${ORIGIN}/logo@2x.svg 2x` };
  const repeated = createImage(`${ORIGIN}/logo.svg`);
  const remote = createImage('https://cdn.example.com/banner.png');
  const options = createOptions({ fetchAsset: vi.fn(async () => new Blob(['<svg/>'], { type: 'image/svg+xml' })) });

  const { assetFiles } = await extractSnapshotAssets(createDocument(local, repeated, remote), options);

  expect(assetFiles).toHaveLength(1);
  expect(local.attributes).toEqual({ src: createAssetReference(0) });
  expect(repeated.attributes?.src).toBe(local.attributes?.src);
  expect(remote.attributes).toEqual({ src: 'https://cdn.example.com/banner.png' });
  expect(options.fetchAsset).toHaveBeenCalledTimes(1);
});

it('pulls out CSS background images captured elements show, from stylesheets and inline styles', async () => {
  const style = createStyleNode(`.hero { background: url("${ORIGIN}/hero.png"); } .unused { background: url("${ORIGIN}/unused.png"); }`);
  const banner: SnapshotNode = {
    type: 2,
    tagName: 'div',
    attributes: { style: `background-image: url(${ORIGIN}/inline.png)` },
    childNodes: [],
  };
  const options = createOptions({
    usedCssImageUrls: new Set([`${ORIGIN}/hero.png`, `${ORIGIN}/inline.png`]),
    fetchAsset: vi.fn(async () => new Blob(['png'], { type: 'image/png' })),
  });

  const { assetFiles } = await extractSnapshotAssets(createDocument(style, banner), options);

  expect(assetFiles).toHaveLength(2);
  expect(options.fetchAsset).not.toHaveBeenCalledWith(`${ORIGIN}/unused.png`, expect.any(Number), expect.any(Number));
  expect(style.attributes?._cssText).toContain(`url("${createAssetReference(0)}")`);
  expect(style.attributes?._cssText).toContain(`url("${ORIGIN}/unused.png")`);
  expect(banner.attributes?.style).toBe(`background-image: url("${createAssetReference(1)}")`);
});

it('records files it could not keep without downloading past the budget, and keeps their original URLs', async () => {
  const names = ['failed.png?token=secret', 'huge.png', 'first.png', 'over-budget.png', 'small.png', 'over-count.png'];
  const images = names.map((name) => createImage(`${ORIGIN}/${name}`));
  const sizes: Record<string, number> = { 'huge.png': 11, 'first.png': 8, 'over-budget.png': 8, 'small.png': 1, 'over-count.png': 1 };
  const fetchAsset = vi.fn(async (url: string, maxBytes: number) => {
    const name = url.slice(ORIGIN.length + 1);
    if (!(name in sizes)) {
      throw new TypeError('Failed to fetch');
    }
    if (sizes[name] > maxBytes) {
      throw new SnapshotAssetTooLargeError();
    }
    return new Blob(['x'.repeat(sizes[name])], { type: 'image/png' });
  });

  const { assetFiles, missingAssets } = await extractSnapshotAssets(
    createDocument(...images),
    createOptions({ fetchAsset, maxAssetBytes: 10, maxTotalBytes: 12, maxAssetCount: 2 }),
  );

  expect(assetFiles).toHaveLength(2);
  expect(missingAssets).toEqual([
    { url: `${ORIGIN}/failed.png`, reason: 'fetch_failed' },
    { url: `${ORIGIN}/huge.png`, reason: 'too_large' },
    { url: `${ORIGIN}/over-budget.png`, reason: 'budget_exceeded' },
    { url: `${ORIGIN}/over-count.png`, reason: 'budget_exceeded' },
  ]);
  expect(fetchAsset).toHaveBeenCalledWith(`${ORIGIN}/over-budget.png`, 4, expect.any(Number));
  expect(fetchAsset).not.toHaveBeenCalledWith(`${ORIGIN}/over-count.png`, expect.any(Number), expect.any(Number));
  expect(images.map((image) => String(image.attributes?.src).startsWith('lattice-asset:'))).toEqual([
    false, false, true, false, true, false,
  ]);
});

it('stops downloading at the deadline and reports the rest as timed out', async () => {
  let clock = 0;
  const images = ['slow.png', 'late.png', 'never.png'].map((name) => createImage(`${ORIGIN}/${name}`));
  const fetchAsset = vi.fn(async (url: string, _maxBytes: number, timeoutMs: number) => {
    clock += 6_000;
    if (url.endsWith('late.png')) {
      expect(timeoutMs).toBe(4_000);
      throw new DOMException('The operation was aborted.', 'AbortError');
    }
    return new Blob(['png'], { type: 'image/png' });
  });

  const { assetFiles, missingAssets } = await extractSnapshotAssets(
    createDocument(...images),
    createOptions({ fetchAsset, maxDurationMs: 10_000, now: () => clock }),
  );

  expect(assetFiles).toHaveLength(1);
  expect(missingAssets).toEqual([
    { url: `${ORIGIN}/late.png`, reason: 'timed_out' },
    { url: `${ORIGIN}/never.png`, reason: 'timed_out' },
  ]);
  expect(fetchAsset).toHaveBeenCalledTimes(2);
});

it('saves the responsive image the browser picked with its own descriptor, and drops other candidates', async () => {
  const dense: SnapshotNode = {
    type: 2,
    tagName: 'img',
    id: 1,
    attributes: { src: `${ORIGIN}/small.png`, srcset: `${ORIGIN}/small.png 1x, ${ORIGIN}/large.png 2x` },
    childNodes: [],
  };
  const widthBased: SnapshotNode = {
    type: 2,
    tagName: 'img',
    id: 3,
    attributes: { src: `${ORIGIN}/small.png`, srcset: `${ORIGIN}/small.png 400w, ${ORIGIN}/large.png 800w`, sizes: '50vw' },
    childNodes: [],
  };
  const source: SnapshotNode = {
    type: 2,
    tagName: 'source',
    attributes: { srcset: `${ORIGIN}/wide.webp 1600w`, sizes: '100vw', media: '(min-width: 800px)' },
    childNodes: [],
  };
  const fallback: SnapshotNode = { type: 2, tagName: 'img', id: 2, attributes: { src: `${ORIGIN}/fallback.png` }, childNodes: [] };
  const picture: SnapshotNode = { type: 2, tagName: 'picture', attributes: {}, childNodes: [source, fallback] };
  const blocked: SnapshotNode = { type: 2, tagName: 'img', id: 4, attributes: { rr_width: '100px', rr_height: '50px' }, childNodes: [] };
  const live: Record<number, string> = { 1: `${ORIGIN}/large.png`, 2: `${ORIGIN}/wide.webp`, 3: `${ORIGIN}/large.png` };
  const options = createOptions({
    fetchAsset: vi.fn(async () => new Blob(['img'], { type: 'image/png' })),
    findLiveImage: (node) => (node.id === undefined ? null : (live[node.id] ?? null)),
  });

  await extractSnapshotAssets(createDocument(dense, widthBased, picture, blocked), options);

  const large = createAssetReference(0);
  const wide = createAssetReference(1);
  expect(options.fetchAsset).toHaveBeenCalledTimes(2);
  expect(options.fetchAsset).not.toHaveBeenCalledWith(`${ORIGIN}/small.png`, expect.any(Number), expect.any(Number));
  expect(dense.attributes).toEqual({ srcset: `${large} 2x` });
  expect(widthBased.attributes).toEqual({ srcset: `${large} 800w`, sizes: '50vw' });
  expect(fallback.attributes).toEqual({ srcset: `${wide} 1600w`, sizes: '100vw' });
  expect(source.attributes).toEqual({ sizes: '100vw', media: '(min-width: 800px)' });
  expect(blocked.attributes).toEqual({ rr_width: '100px', rr_height: '50px' });
});

it('keeps the default sizes of a picture source that has none instead of borrowing the img sizes', async () => {
  const source: SnapshotNode = { type: 2, tagName: 'source', attributes: { srcset: `${ORIGIN}/wide.png 800w` }, childNodes: [] };
  const fallback: SnapshotNode = { type: 2, tagName: 'img', id: 1, attributes: { src: `${ORIGIN}/fallback.png`, sizes: '50vw' }, childNodes: [] };
  const options = createOptions({
    fetchAsset: vi.fn(async () => new Blob(['img'], { type: 'image/png' })),
    findLiveImage: () => `${ORIGIN}/wide.png`,
  });

  await extractSnapshotAssets(
    createDocument({ type: 2, tagName: 'picture', attributes: {}, childNodes: [source, fallback] }),
    options,
  );

  expect(fallback.attributes).toEqual({ srcset: `${createAssetReference(0)} 800w` });
});
