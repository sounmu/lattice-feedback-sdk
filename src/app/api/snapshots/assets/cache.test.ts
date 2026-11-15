import { createHash } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GET, PUT } from '@/app/api/snapshots/assets/[hash]/route';
import { resetRateLimit } from '@/lib/http/rate-limit';
import { resetMemoryScreenSnapshotStore } from '@/lib/memory-screen-snapshot-repository';
import { getScreenSnapshotRepository } from '@/lib/screen-snapshot-repository';

const DATA = new TextEncoder().encode('saved-font');
const HASH = createHash('sha256').update(DATA).digest('hex');
const ETAG = `"${HASH}"`;
const BASE_URL = 'http://localhost:3000/api/snapshots/assets';

function requestAsset(headers: HeadersInit, projectKey = 'demo') {
  return GET(new Request(`${BASE_URL}/${HASH}?projectKey=${projectKey}`, { headers }), {
    params: Promise.resolve({ hash: HASH }),
  });
}

beforeEach(async () => {
  vi.stubEnv('FEEDBACK_STORAGE', 'memory');
  vi.stubEnv('FEEDBACK_ADMIN_TOKEN', 'cache-test-token');
  vi.stubEnv('FEEDBACK_ALLOWED_ORIGINS', 'http://localhost:4000');
  resetMemoryScreenSnapshotStore();
  resetRateLimit();
  await getScreenSnapshotRepository().saveAsset({ projectKey: 'demo', hash: HASH, contentType: 'font/woff2', data: DATA });
});

afterEach(() => vi.unstubAllEnvs());

describe('private content-addressed asset caching', () => {
  it('serves the original bytes with an immutable private validator scoped to authorization', async () => {
    const response = await requestAsset({ authorization: 'Bearer cache-test-token' });

    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('private, max-age=31536000, immutable');
    expect(response.headers.get('etag')).toBe(`W/${ETAG}`);
    expect(response.headers.get('vary')).toBe('Authorization, Accept-Encoding');
    expect(response.headers.get('content-encoding')).toBeNull();
    expect(response.headers.get('content-security-policy')).toBe("sandbox; default-src 'none'");
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(DATA);
  });

  it.each([ETAG, `W/${ETAG}`, `"another", W/${ETAG}`, '*'])(
    'returns no body when the stored asset matches %s',
    async (validator) => {
      const response = await requestAsset({ authorization: 'Bearer cache-test-token', 'if-none-match': validator });

      expect(response.status).toBe(304);
      expect(response.headers.get('etag')).toBe(`W/${ETAG}`);
      expect(response.headers.get('vary')).toBe('Authorization, Accept-Encoding');
      expect(response.headers.get('cache-control')).toBe('private, max-age=31536000, immutable');
      expect(await response.text()).toBe('');
    },
  );

  it('sends the bytes when the validator does not match', async () => {
    const response = await requestAsset({ authorization: 'Bearer cache-test-token', 'if-none-match': '"another"' });

    expect(response.status).toBe(200);
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(DATA);
  });

  it.each(['', 'Bearer wrong-token'])('authorizes conditional reads before using the validator (%s)', async (authorization) => {
    const response = await requestAsset({ authorization, 'if-none-match': ETAG });

    expect(response.status).toBe(401);
    expect(response.headers.get('etag')).toBeNull();
  });

  it('does not disclose another project through a conditional read', async () => {
    const response = await requestAsset({ authorization: 'Bearer cache-test-token', 'if-none-match': ETAG }, 'other');

    expect(response.status).toBe(404);
    expect(response.headers.get('etag')).toBeNull();
  });

  it('does not report an absent asset as cached even if another project stores its hash', async () => {
    resetMemoryScreenSnapshotStore();
    await getScreenSnapshotRepository().saveAsset({ projectKey: 'other', hash: HASH, contentType: 'font/woff2', data: DATA });

    const response = await requestAsset({ authorization: 'Bearer cache-test-token', 'if-none-match': ETAG });

    expect(response.status).toBe(404);
    expect(response.headers.get('etag')).toBeNull();
  });

  it('still rejects different bytes uploaded under an existing hash', async () => {
    const query = new URLSearchParams({ projectKey: 'demo', hostOrigin: 'http://localhost:4000', pageUrl: 'http://localhost:4000/orders' });

    const response = await PUT(new Request(`${BASE_URL}/${HASH}?${query}`, {
      method: 'PUT', headers: { 'sec-fetch-site': 'same-origin' }, body: 'different-font',
    }), { params: Promise.resolve({ hash: HASH }) });

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: { code: 'asset_hash_mismatch' } });
  });
});
