import { expect, it, vi } from 'vitest';
import { inlineSnapshotAssets, type InlineSnapshotAssetsOptions, type SnapshotNode } from '@/sdk/snapshot-assets';

const ORIGIN = 'https://host.example.com';
const FONT_BYTES = 'font-bytes';
const FONT_DATA_URL = `data:font/woff2;base64,${btoa(FONT_BYTES)}`;

function createOptions(overrides: Partial<InlineSnapshotAssetsOptions> = {}): InlineSnapshotAssetsOptions {
  return {
    pageOrigin: ORIGIN,
    loadedFontFamilies: new Set(['pretendard']),
    fetchAsset: vi.fn(async () => new Blob([FONT_BYTES], { type: 'font/woff2' })),
    maxAssetBytes: 1000,
    maxTotalBytes: 2000,
    ...overrides,
  };
}

function createStyleNode(cssText: string): SnapshotNode {
  return { type: 2, tagName: 'style', attributes: { _cssText: cssText }, childNodes: [] };
}

function createDocument(...childNodes: SnapshotNode[]): SnapshotNode {
  return { type: 0, childNodes };
}

it('embeds only the first same-origin source of a font family the page loaded', async () => {
  const style = createStyleNode(
    [
      `@font-face { font-family: "Pretendard"; src: url("${ORIGIN}/fonts/a.woff2") format("woff2"), url("${ORIGIN}/fonts/a.woff") format("woff"); }`,
      `@font-face { font-family: Unused; src: url("${ORIGIN}/fonts/unused.woff2"); }`,
      '@font-face { font-family: Pretendard; src: url("https://cdn.example.com/b.woff2"); }',
      `.logo { background: url("${ORIGIN}/logo.png"); }`,
    ].join('\n'),
  );
  const options = createOptions();

  const missingAssets = await inlineSnapshotAssets(createDocument(style), options);

  const cssText = String(style.attributes?._cssText);
  expect(options.fetchAsset).toHaveBeenCalledTimes(1);
  expect(options.fetchAsset).toHaveBeenCalledWith(`${ORIGIN}/fonts/a.woff2`);
  expect(cssText).toContain(`url("${FONT_DATA_URL}") format("woff2")`);
  expect(cssText).toContain(`url("${ORIGIN}/fonts/a.woff")`);
  expect(cssText).toContain(`url("${ORIGIN}/fonts/unused.woff2")`);
  expect(cssText).toContain('url("https://cdn.example.com/b.woff2")');
  expect(cssText).toContain(`url("${ORIGIN}/logo.png")`);
  expect(missingAssets).toEqual([]);
});

it('embeds same-origin images and leaves cross-origin images to load from their own URL', async () => {
  const local: SnapshotNode = {
    type: 2,
    tagName: 'img',
    attributes: { src: `${ORIGIN}/logo.svg`, srcset: `${ORIGIN}/logo@2x.svg 2x` },
    childNodes: [],
  };
  const remote: SnapshotNode = {
    type: 2,
    tagName: 'img',
    attributes: { src: 'https://cdn.example.com/banner.png' },
    childNodes: [],
  };
  const options = createOptions({ fetchAsset: vi.fn(async () => new Blob(['<svg/>'], { type: 'image/svg+xml' })) });

  await inlineSnapshotAssets(createDocument({ type: 2, tagName: 'body', attributes: {}, childNodes: [local, remote] }), options);

  expect(local.attributes).toEqual({ src: `data:image/svg+xml;base64,${btoa('<svg/>')}` });
  expect(remote.attributes).toEqual({ src: 'https://cdn.example.com/banner.png' });
  expect(options.fetchAsset).toHaveBeenCalledTimes(1);
});

it('records assets it could not embed, without query strings, and keeps their original URLs', async () => {
  const images = ['failed.png?token=secret', 'huge.png', 'first.png', 'over-budget.png'].map(
    (name): SnapshotNode => ({ type: 2, tagName: 'img', attributes: { src: `${ORIGIN}/${name}` }, childNodes: [] }),
  );
  const sizes: Record<string, number> = { 'huge.png': 11, 'first.png': 8, 'over-budget.png': 8 };
  const fetchAsset = vi.fn(async (url: string) => {
    const name = url.slice(ORIGIN.length + 1);
    if (!(name in sizes)) {
      throw new TypeError('Failed to fetch');
    }
    return new Blob(['x'.repeat(sizes[name])], { type: 'image/png' });
  });

  const missingAssets = await inlineSnapshotAssets(
    createDocument(...images),
    createOptions({ fetchAsset, maxAssetBytes: 10, maxTotalBytes: 12 }),
  );

  expect(missingAssets).toEqual([
    { url: `${ORIGIN}/failed.png`, reason: 'fetch_failed' },
    { url: `${ORIGIN}/huge.png`, reason: 'too_large' },
    { url: `${ORIGIN}/over-budget.png`, reason: 'budget_exceeded' },
  ]);
  expect(images.map((image) => String(image.attributes?.src).startsWith('data:'))).toEqual([false, false, true, false]);
});
