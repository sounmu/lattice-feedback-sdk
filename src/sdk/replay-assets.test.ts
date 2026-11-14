import { expect, it, vi } from 'vitest';
import { createAssetReference } from '@/lib/snapshot-asset-references';
import { createReplayAssetRoot, createSegmentedReplayAssetRoot } from '@/sdk/replay-assets';
import { sanitizeReplayEvents, type AttributeChange } from '@/sdk/replay-sanitize';
import { extractSnapshotAssets, type ExtractSnapshotAssetsOptions, type SnapshotNode } from '@/sdk/snapshot-assets';
import type { ScreenSnapshotEvent } from '@/types/screen-snapshot';

const ORIGIN = 'https://host.example.com';

function element(id: number, tagName: string, attributes: Record<string, string>, childNodes: SnapshotNode[] = []): SnapshotNode {
  return { type: 2, id, tagName, attributes, childNodes };
}

function createRecording(full: SnapshotNode, adds: SnapshotNode[], changes: AttributeChange[]): ScreenSnapshotEvent[] {
  return [
    { type: 4, timestamp: 1, data: {} },
    { type: 2, timestamp: 1, data: { node: { type: 0, id: 0, childNodes: [full] } } },
    { type: 3, timestamp: 2, data: { source: 0, adds: adds.map((node) => ({ node })), attributes: [] } },
    { type: 3, timestamp: 3, data: { source: 0, adds: [], attributes: changes } },
    { type: 3, timestamp: 4, data: { source: 2, type: 2, id: 2, x: 1, y: 1 } },
  ];
}

function extractReplayAssets(events: ScreenSnapshotEvent[], overrides: Partial<ExtractSnapshotAssetsOptions> = {}) {
  const options: ExtractSnapshotAssetsOptions = {
    pageOrigin: ORIGIN,
    loadedFontFamilies: new Set(),
    usedCssImageUrls: new Set([`${ORIGIN}/hero.png`, `${ORIGIN}/box.png`]),
    fetchAsset: vi.fn(async (url: string) => new Blob([url], { type: 'image/png' })),
    maxAssetBytes: 1000,
    maxTotalBytes: 4000,
    maxAssetCount: 10,
    maxDurationMs: 15_000,
    ...overrides,
  };
  const assetRoot = createReplayAssetRoot(events, sanitizeReplayEvents(events));
  const result = extractSnapshotAssets(assetRoot.root, options).then((extracted) => {
    assetRoot.applyRewrites();
    return extracted;
  });
  return { options, result };
}

it('replaces the images and styles added or changed after the first snapshot, numbering files across the whole recording', async () => {
  const first = element(2, 'img', { src: `${ORIGIN}/first.png` });
  const full = element(1, 'html', {}, [first, element(3, 'div', {}), element(4, 'iframe', {})]);
  const addedImage = element(10, 'img', { src: `${ORIGIN}/second.png` });
  const addedStyle = element(11, 'style', { _cssText: `.hero { background: url("${ORIGIN}/hero.png"); }` });
  const swapped: AttributeChange = { id: 2, attributes: { src: `${ORIGIN}/second.png`, style: { opacity: '1' } } };
  const restyled: AttributeChange = { id: 3, attributes: { style: `background: url("${ORIGIN}/box.png")` } };
  const frame: AttributeChange = { id: 4, attributes: { src: `${ORIGIN}/frame.html` } };
  const { options, result } = extractReplayAssets(createRecording(full, [addedImage, addedStyle], [swapped, restyled, frame]));

  const { assetFiles, missingAssets } = await result;

  expect(await Promise.all(assetFiles.map((file) => file.text()))).toEqual(
    ['first.png', 'second.png', 'hero.png', 'box.png'].map((name) => `${ORIGIN}/${name}`),
  );
  expect(options.fetchAsset).toHaveBeenCalledTimes(4);
  expect(first.attributes?.src).toBe(createAssetReference(0));
  expect(addedImage.attributes?.src).toBe(createAssetReference(1));
  expect(addedStyle.attributes?._cssText).toBe(`.hero { background: url("${createAssetReference(2)}"); }`);
  expect(swapped.attributes).toEqual({ src: createAssetReference(1), style: { opacity: '1' } });
  expect(restyled.attributes.style).toBe(`background: url("${createAssetReference(3)}")`);
  expect(frame.attributes.src).toBe(`${ORIGIN}/frame.html`);
  expect(missingAssets).toEqual([]);
});

it('saves the fonts and images of CSS changed after the first snapshot, which rrweb records with the URLs as the page wrote them', async () => {
  const styleText = { type: 3, id: 6, textContent: '' };
  const full = element(1, 'html', {}, [element(5, 'style', { _cssText: '.a { color: red; }' }, [styleText])]);
  const fontRule = { rule: '@font-face { font-family: Late; src: url(../late.woff2); }', index: 0 };
  const failing = { rule: '.c { background: url("/gone.png"); }' };
  const adoptedRule = { rule: ".b { background: url('/box.png'); }" };
  const declaration = { property: 'background-image', value: 'url("set.png")', priority: undefined };
  const addedText = { type: 3, id: 21, textContent: '.d { background: url(/added.png); }' };
  const textChange = { id: 6, value: '.a { background: url(/swap.png); filter: url(#blur); }' };
  const otherText = { id: 99, value: 'url(/swap.png) is only text here' };
  const events: ScreenSnapshotEvent[] = [
    { type: 4, timestamp: 1, data: { href: `${ORIGIN}/app/page` } },
    { type: 2, timestamp: 1, data: { node: { type: 0, id: 0, childNodes: [full] } } },
    { type: 3, timestamp: 2, data: { source: 8, id: 5, adds: [fontRule, failing] } },
    { type: 3, timestamp: 3, data: { source: 15, id: 1, styleIds: [1], styles: [{ styleId: 1, rules: [adoptedRule] }] } },
    { type: 3, timestamp: 4, data: { source: 13, id: 5, index: [0], set: declaration } },
    { type: 3, timestamp: 5, data: { source: 0, adds: [{ parentId: 1, node: element(20, 'style', {}) }, { parentId: 20, node: addedText }], attributes: [] } },
    { type: 3, timestamp: 6, data: { source: 0, adds: [], attributes: [], texts: [textChange, otherText] } },
  ];
  const used = ['box.png', 'app/set.png', 'added.png', 'swap.png', 'gone.png'].map((name) => `${ORIGIN}/${name}`);
  const { result } = extractReplayAssets(events, {
    loadedFontFamilies: new Set(['late']),
    usedCssImageUrls: new Set(used),
    fetchAsset: vi.fn(async (url: string) => {
      if (url.endsWith('/gone.png')) {
        throw new Error('not found');
      }
      return new Blob([url]);
    }),
  });

  const { assetFiles, missingAssets } = await result;

  const names = await Promise.all(assetFiles.map(async (file) => (await file.text()).replace(`${ORIGIN}/`, '')));
  const reference = (name: string) => `url("${createAssetReference(names.indexOf(name))}")`;
  expect([...names].sort()).toEqual(['added.png', 'app/set.png', 'box.png', 'late.woff2', 'swap.png']);
  expect(fontRule.rule).toBe(`@font-face { font-family: Late; src: ${reference('late.woff2')}; }`);
  expect(failing.rule).toBe(`.c { background: url("${ORIGIN}/gone.png"); }`);
  expect(adoptedRule.rule).toBe(`.b { background: ${reference('box.png')}; }`);
  expect(declaration.value).toBe(reference('app/set.png'));
  expect(addedText.textContent).toBe(`.d { background: ${reference('added.png')}; }`);
  expect(textChange.value).toBe(`.a { background: ${reference('swap.png')}; filter: url(#blur); }`);
  expect(otherText.value).toBe('url(/swap.png) is only text here');
  expect(missingAssets).toEqual([{ url: `${ORIGIN}/gone.png`, reason: 'fetch_failed' }]);
});

it('counts files that appear later against the same budget as the first snapshot', async () => {
  const full = element(1, 'html', {}, [element(2, 'img', { src: `${ORIGIN}/first.png` })]);
  const swapped: AttributeChange = { id: 2, attributes: { src: `${ORIGIN}/second.png` } };
  const { result } = extractReplayAssets(createRecording(full, [], [swapped]), { maxAssetCount: 1 });

  const { assetFiles, missingAssets } = await result;

  expect(assetFiles).toHaveLength(1);
  expect(swapped.attributes.src).toBe(`${ORIGIN}/second.png`);
  expect(missingAssets).toEqual([{ url: `${ORIGIN}/second.png`, reason: 'budget_exceeded' }]);
});

it('rewrites images inside style changes recorded as property dictionaries, keeping their priority', async () => {
  const full = element(1, 'html', {}, [element(2, 'div', {})]);
  const restyled: AttributeChange = {
    id: 2,
    attributes: { style: { 'background-image': [`url("${ORIGIN}/box.png")`, 'important'], color: 'red', 'border-image': false } },
  };
  const { result } = extractReplayAssets(createRecording(full, [], [restyled]));

  const { assetFiles } = await result;

  expect(assetFiles).toHaveLength(1);
  expect(restyled.attributes.style).toEqual({
    'background-image': [`url("${createAssetReference(0)}")`, 'important'],
    color: 'red',
    'border-image': false,
  });
});

it('saves every candidate of a srcset changed later and leaves other sources alone', async () => {
  const full = element(1, 'html', {}, [element(2, 'img', { src: `${ORIGIN}/first.png` }), element(3, 'video', {}, [element(4, 'source', {})])]);
  const responsive: AttributeChange = {
    id: 2,
    attributes: { srcset: `${ORIGIN}/after.png 1x, ${ORIGIN}/after-2x.png 2x, https://cdn.example.com/after-3x.png 3x`, src: `${ORIGIN}/fallback.png` },
  };
  const clip: AttributeChange = { id: 4, attributes: { src: `${ORIGIN}/clip.mp4` } };
  const { options, result } = extractReplayAssets(createRecording(full, [], [responsive, clip]));

  const { assetFiles } = await result;

  expect(await Promise.all(assetFiles.map((file) => file.text()))).toEqual(
    ['first.png', 'after.png', 'after-2x.png', 'fallback.png'].map((name) => `${ORIGIN}/${name}`),
  );
  expect(options.fetchAsset).toHaveBeenCalledTimes(4);
  expect(responsive.attributes).toEqual({
    srcset: `${createAssetReference(1)} 1x, ${createAssetReference(2)} 2x, https://cdn.example.com/after-3x.png 3x`,
    src: createAssetReference(3),
  });
  expect(clip.attributes.src).toBe(`${ORIGIN}/clip.mp4`);
});

it('keeps the src an image falls back to when its srcset is removed later, although the first snapshot saved only the shown file', async () => {
  const image = element(2, 'img', { src: `${ORIGIN}/fallback.png`, srcset: `${ORIGIN}/retina.png 2x` });
  const full = element(1, 'html', {}, [image]);
  const removal: AttributeChange = { id: 2, attributes: { srcset: null } };
  const { result } = extractReplayAssets(createRecording(full, [], [removal]), {
    findLiveImage: (node) => (node.id === 2 ? `${ORIGIN}/retina.png` : null),
  });

  const { assetFiles, missingAssets } = await result;

  expect(await Promise.all(assetFiles.map((file) => file.text()))).toEqual([`${ORIGIN}/retina.png`, `${ORIGIN}/fallback.png`]);
  expect(image.attributes).toEqual({ srcset: `${createAssetReference(0)} 2x` });
  expect(removal.attributes).toEqual({ srcset: null, src: createAssetReference(1) });
  expect(missingAssets).toEqual([]);
});

it('does not bring back a src the page removed before it removed the srcset', async () => {
  const image = element(2, 'img', { src: `${ORIGIN}/fallback.png`, srcset: `${ORIGIN}/retina.png 2x` });
  const full = element(1, 'html', {}, [image]);
  const sourceRemoval: AttributeChange = { id: 2, attributes: { src: null } };
  const srcsetRemoval: AttributeChange = { id: 2, attributes: { srcset: null } };
  const { result } = extractReplayAssets(createRecording(full, [], [sourceRemoval, srcsetRemoval]), {
    findLiveImage: (node) => (node.id === 2 ? `${ORIGIN}/retina.png` : null),
  });

  const { assetFiles } = await result;

  expect(await Promise.all(assetFiles.map((file) => file.text()))).toEqual([`${ORIGIN}/retina.png`]);
  expect(sourceRemoval.attributes).toEqual({ src: null });
  expect(srcsetRemoval.attributes).toEqual({ srcset: null });
});

it('reads each document of a Flow on its own, since rrweb node ids start over in every document', async () => {
  const createPage = (child: SnapshotNode, change: AttributeChange): ScreenSnapshotEvent[] => [
    { type: 4, timestamp: 1, data: {} },
    { type: 2, timestamp: 1, data: { node: { type: 0, id: 1, childNodes: [child] } } },
    { type: 3, timestamp: 2, data: { source: 0, adds: [], attributes: [change] } },
  ];
  const image = element(2, 'img', { src: `${ORIGIN}/first.png` });
  const swapped: AttributeChange = { id: 2, attributes: { src: `${ORIGIN}/second.png` } };
  const navigated: AttributeChange = { id: 2, attributes: { src: `${ORIGIN}/frame.html` } };
  const assetRoot = createSegmentedReplayAssetRoot([
    { events: createPage(image, swapped), liveImageSources: [[2, `${ORIGIN}/first-2x.png`]] },
    { events: createPage(element(2, 'iframe', {}), navigated), liveImageSources: [] },
  ]);

  const { assetFiles } = await extractSnapshotAssets(assetRoot.root, {
    pageOrigin: ORIGIN,
    loadedFontFamilies: new Set(),
    usedCssImageUrls: new Set(),
    fetchAsset: async (url: string) => new Blob([url], { type: 'image/png' }),
    maxAssetBytes: 1000,
    maxTotalBytes: 4000,
    maxAssetCount: 10,
    maxDurationMs: 15_000,
  });
  assetRoot.applyRewrites();

  expect([...assetRoot.liveImages]).toEqual([[image, `${ORIGIN}/first-2x.png`]]);
  expect(await Promise.all(assetFiles.map((file) => file.text()))).toEqual([`${ORIGIN}/first.png`, `${ORIGIN}/second.png`]);
  expect(swapped.attributes.src).toBe(createAssetReference(1));
  expect(navigated.attributes.src).toBe(`${ORIGIN}/frame.html`);
});
