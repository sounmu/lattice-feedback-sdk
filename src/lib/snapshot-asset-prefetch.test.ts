import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createSnapshotAssetPrefetch,
  findRememberedAssetHashes,
  rememberSnapshotAssetHashes,
} from '@/lib/snapshot-asset-prefetch';

const FONT_HASH = 'a'.repeat(64);
const IMAGE_HASH = 'b'.repeat(64);
const MISSING_HASH = 'c'.repeat(64);

let fetchMock: ReturnType<typeof vi.fn>;
let createdUrls: string[];

beforeEach(() => {
  createdUrls = [];
  fetchMock = vi.fn(async (input: string) => {
    if (input.includes(MISSING_HASH)) {
      return new Response(null, { status: 404 });
    }
    return new Response(new Blob([input]));
  });
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  createdUrls.forEach((url) => URL.revokeObjectURL(url));
  vi.unstubAllGlobals();
});

async function loadUrls(prefetch: ReturnType<typeof createSnapshotAssetPrefetch>, hashes: string[]) {
  const urls = await prefetch.loadUrls(hashes);
  createdUrls.push(...urls.filter((url) => url !== null));
  return urls;
}

describe('createSnapshotAssetPrefetch', () => {
  it('requests each file once however often it is listed or asked for', async () => {
    const prefetch = createSnapshotAssetPrefetch({ projectKey: 'demo', token: 'secret', signal: new AbortController().signal });
    prefetch.prefetch([FONT_HASH, FONT_HASH, IMAGE_HASH]);

    const urls = await loadUrls(prefetch, [FONT_HASH, IMAGE_HASH, FONT_HASH]);

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(urls[0]).toBe(urls[2]);
    expect(urls[1]).not.toBe(urls[0]);
  });

  it('answers null at the position of a file that could not be loaded', async () => {
    const prefetch = createSnapshotAssetPrefetch({ projectKey: 'demo', token: 'secret', signal: new AbortController().signal });

    const urls = await loadUrls(prefetch, [FONT_HASH, MISSING_HASH]);

    expect(urls).toEqual([expect.stringMatching(/^blob:/), null]);
  });

  it('reads with the project key and token of its own viewer and stops with its signal', async () => {
    const controller = new AbortController();
    const prefetch = createSnapshotAssetPrefetch({ projectKey: 'a b', token: 'secret', signal: controller.signal });

    await loadUrls(prefetch, [FONT_HASH]);

    expect(fetchMock).toHaveBeenCalledWith(`/api/snapshots/assets/${FONT_HASH}?projectKey=a%20b`, {
      headers: { authorization: 'Bearer secret' },
      signal: controller.signal,
    });
  });
});

describe('remembered asset hashes', () => {
  it('belong to the project and screen they were remembered for', () => {
    rememberSnapshotAssetHashes('demo', 'screen-1', [FONT_HASH]);

    expect(findRememberedAssetHashes('demo', 'screen-1')).toEqual([FONT_HASH]);
    expect(findRememberedAssetHashes('other', 'screen-1')).toEqual([]);
    expect(findRememberedAssetHashes('demo', 'screen-2')).toEqual([]);
  });
});
