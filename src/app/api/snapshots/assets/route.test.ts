import { createHash } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ADMIN_AUTHORIZATION, createJsonRequest } from '@/app/api/feedback/feedback-test-fixtures';
import { GET as getAsset, PUT as putAsset } from '@/app/api/snapshots/assets/[hash]/route';
import { POST as findMissingAssets } from '@/app/api/snapshots/assets/route';
import { POST } from '@/app/api/snapshots/route';
import { createScreenSnapshotBody } from '@/app/api/snapshots/screen-snapshot-test-fixtures';
import { resetRateLimit } from '@/lib/http/rate-limit';
import { resetMemoryScreenSnapshotStore } from '@/lib/memory-screen-snapshot-repository';

const SNAPSHOTS_URL = 'http://localhost:3000/api/snapshots';
const FONT = new TextEncoder().encode('font-bytes');
const FONT_HASH = createHash('sha256').update(FONT).digest('hex');
const PAGE_URL = createScreenSnapshotBody().page.url;
const OWNER_QUERY = new URLSearchParams({
  projectKey: 'demo', hostOrigin: createScreenSnapshotBody().hostOrigin, pageUrl: PAGE_URL,
}).toString();

beforeEach(() => {
  vi.stubEnv('FEEDBACK_STORAGE', 'memory');
  vi.stubEnv('FEEDBACK_ALLOWED_ORIGINS', 'http://localhost:4000');
  vi.stubEnv('FEEDBACK_ADMIN_TOKEN', 'dev-admin-token');
  vi.stubEnv('FEEDBACK_CAPTURE_POLICY', '');
  resetMemoryScreenSnapshotStore();
  resetRateLimit();
});
afterEach(() => vi.unstubAllEnvs());

function uploadFont(hash = FONT_HASH, headers: Record<string, string> = {}) {
  const request = new Request(`${SNAPSHOTS_URL}/assets/${hash}?${OWNER_QUERY}`, {
    method: 'PUT',
    headers: { 'content-type': 'font/woff2', 'sec-fetch-site': 'same-origin', ...headers },
    body: FONT,
  });
  return putAsset(request, { params: Promise.resolve({ hash }) });
}

function requestFont(headers: Record<string, string> = {}) {
  const request = new Request(`${SNAPSHOTS_URL}/assets/${FONT_HASH}?projectKey=demo`, { headers });
  return getAsset(request, { params: Promise.resolve({ hash: FONT_HASH }) });
}

async function lookUp(hashes: string[]): Promise<unknown> {
  const body = { projectKey: 'demo', hostOrigin: createScreenSnapshotBody().hostOrigin, pageUrl: PAGE_URL, hashes };
  const response = await findMissingAssets(createJsonRequest(`${SNAPSHOTS_URL}/assets`, 'POST', body));
  return response.json();
}

describe('saved screen files', () => {
  it('uploads a file only once and serves it to the admin only', async () => {
    expect(await lookUp([FONT_HASH])).toEqual({ missingHashes: [FONT_HASH] });
    expect((await uploadFont()).status).toBe(204);
    expect(await lookUp([FONT_HASH])).toEqual({ missingHashes: [] });

    const served = await requestFont({ authorization: ADMIN_AUTHORIZATION });
    expect(served.status).toBe(200);
    expect(served.headers.get('content-type')).toBe('font/woff2');
    expect(served.headers.get('x-content-type-options')).toBe('nosniff');
    expect(served.headers.get('cache-control')).toBe('private, max-age=31536000, immutable');
    expect(new Uint8Array(await served.arrayBuffer())).toEqual(FONT);
    expect((await requestFont()).status).toBe(401);
  });

  it('rejects a file whose bytes do not match its hash, or that comes from another site', async () => {
    const mismatched = await uploadFont('b'.repeat(64));
    expect(mismatched.status).toBe(400);
    expect(await mismatched.json()).toMatchObject({ error: { code: 'asset_hash_mismatch' } });

    const crossSite = await uploadFont(FONT_HASH, { 'sec-fetch-site': 'cross-site', origin: 'https://evil.example.com' });
    expect(crossSite.status).toBe(403);
    expect(await lookUp([FONT_HASH])).toEqual({ missingHashes: [FONT_HASH] });
  });

  it('accepts no file for a page the project policy does not allow', async () => {
    vi.stubEnv('FEEDBACK_CAPTURE_POLICY', JSON.stringify({ allowedPaths: ['/'], targets: [] }));

    const upload = await uploadFont();
    expect(upload.status).toBe(403);
    expect(await upload.json()).toMatchObject({ error: { code: 'capture_not_allowed' } });

    vi.stubEnv('FEEDBACK_CAPTURE_POLICY', '');
    expect(await lookUp([FONT_HASH])).toEqual({ missingHashes: [FONT_HASH] });
  });

  it('saves a screen only after every file it refers to is uploaded', async () => {
    const missing = await POST(createJsonRequest(SNAPSHOTS_URL, 'POST', createScreenSnapshotBody({ assetHashes: [FONT_HASH] })));
    expect(missing.status).toBe(400);
    expect(await missing.json()).toMatchObject({ error: { code: 'screen_snapshot_asset_missing' } });

    await uploadFont();
    const saved = await POST(createJsonRequest(SNAPSHOTS_URL, 'POST', createScreenSnapshotBody({ assetHashes: [FONT_HASH, FONT_HASH] })));
    expect(saved.status).toBe(201);
    expect(await saved.json()).toMatchObject({ snapshot: { assetHashes: [FONT_HASH, FONT_HASH] } });
  });
});
