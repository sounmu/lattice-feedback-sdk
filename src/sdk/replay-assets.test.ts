import { expect, it, vi } from 'vitest';
import { createAssetReference } from '@/lib/snapshot-asset-references';
import { createReplayAssetRoot } from '@/sdk/replay-assets';
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
    assetRoot.applyStyleChanges();
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
