import { expect, it, vi } from 'vitest';
import { createAssetReference, resolveAssetReferences } from '@/lib/snapshot-asset-references';
import { extractSnapshotAssets, type ExtractSnapshotAssetsOptions, type SnapshotNode } from '@/sdk/snapshot-assets';

const ORIGIN = 'https://host.example.com';
const FONT_BYTES = 'font-bytes';

function createOptions(overrides: Partial<ExtractSnapshotAssetsOptions> = {}): ExtractSnapshotAssetsOptions {
  return {
    pageOrigin: ORIGIN,
    loadedFontFamilies: new Set(['pretendard']),
    fetchAsset: vi.fn(async () => new Blob([FONT_BYTES], { type: 'font/woff2' })),
    maxAssetBytes: 1000,
    maxTotalBytes: 2000,
    maxAssetCount: 10,
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
  expect(options.fetchAsset).toHaveBeenCalledWith(`${ORIGIN}/fonts/a.woff2`);
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

it('records files it could not keep, without query strings, and keeps their original URLs', async () => {
  const images = ['failed.png?token=secret', 'huge.png', 'first.png', 'over-budget.png', 'over-count.png'].map((name) =>
    createImage(`${ORIGIN}/${name}`),
  );
  const sizes: Record<string, number> = { 'huge.png': 11, 'first.png': 8, 'over-budget.png': 8, 'over-count.png': 1 };
  const fetchAsset = vi.fn(async (url: string) => {
    const name = url.slice(ORIGIN.length + 1);
    if (!(name in sizes)) {
      throw new TypeError('Failed to fetch');
    }
    return new Blob(['x'.repeat(sizes[name])], { type: 'image/png' });
  });

  const { assetFiles, missingAssets } = await extractSnapshotAssets(
    createDocument(...images),
    createOptions({ fetchAsset, maxAssetBytes: 10, maxTotalBytes: 12, maxAssetCount: 1 }),
  );

  expect(assetFiles).toHaveLength(1);
  expect(missingAssets).toEqual([
    { url: `${ORIGIN}/failed.png`, reason: 'fetch_failed' },
    { url: `${ORIGIN}/huge.png`, reason: 'too_large' },
    { url: `${ORIGIN}/over-budget.png`, reason: 'budget_exceeded' },
    { url: `${ORIGIN}/over-count.png`, reason: 'budget_exceeded' },
  ]);
  expect(images.map((image) => String(image.attributes?.src).startsWith('lattice-asset:'))).toEqual([
    false, false, true, false, false,
  ]);
});
