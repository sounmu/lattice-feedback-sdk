import { describe, expect, it } from 'vitest';

import { gzipBytes } from '@/lib/gzip';
import { BodyTooLargeError, readBodyTextWithLimit, readEncodedBodyTextWithLimit } from '@/lib/http/read-body';

const CHUNK_BYTES = 16 * 1024;

function createStreamingRequest(totalChunks: number) {
  let pulledChunks = 0;
  let isCancelled = false;
  const body = new ReadableStream<Uint8Array>({
    pull(controller) {
      if (pulledChunks === totalChunks) {
        controller.close();
        return;
      }
      pulledChunks += 1;
      controller.enqueue(new Uint8Array(CHUNK_BYTES).fill(120));
    },
    cancel() {
      isCancelled = true;
    },
  });
  const request = new Request('http://localhost/', { method: 'POST', body, duplex: 'half' } as RequestInit);
  return { request, getPulledChunks: () => pulledChunks, getIsCancelled: () => isCancelled };
}

describe('readBodyTextWithLimit', () => {
  it('stops reading and cancels a 2 MiB stream right after the limit is crossed', async () => {
    const streaming = createStreamingRequest(128);

    await expect(readBodyTextWithLimit(streaming.request, 64 * 1024)).rejects.toBeInstanceOf(BodyTooLargeError);
    expect(streaming.getPulledChunks()).toBeLessThanOrEqual(6);
    expect(streaming.getIsCancelled()).toBe(true);
  });

  it('returns the full text for a body within the limit', async () => {
    const request = new Request('http://localhost/', { method: 'POST', body: '{"ok":true}' });

    expect(await readBodyTextWithLimit(request, 64 * 1024)).toBe('{"ok":true}');
  });
});

describe('readEncodedBodyTextWithLimit', () => {
  async function createGzipRequest(text: string) {
    const body = await gzipBytes(new TextEncoder().encode(text));
    return new Request('http://localhost/', { method: 'POST', headers: { 'content-type': 'application/gzip' }, body });
  }

  it('unpacks a gzip body that is larger than the upload limit once unpacked', async () => {
    const text = JSON.stringify({ padding: 'x'.repeat(256 * 1024) });

    expect(await readEncodedBodyTextWithLimit(await createGzipRequest(text), 64 * 1024, 1024 * 1024)).toBe(text);
  });

  it('rejects a small gzip upload that unpacks past its own limit', async () => {
    const request = await createGzipRequest('x'.repeat(256 * 1024));

    await expect(readEncodedBodyTextWithLimit(request, 64 * 1024, 128 * 1024)).rejects.toBeInstanceOf(BodyTooLargeError);
  });

  it('reads a body that is not sent as gzip as it is', async () => {
    const request = new Request('http://localhost/', { method: 'POST', body: '{"ok":true}' });

    expect(await readEncodedBodyTextWithLimit(request, 64 * 1024, 1024 * 1024)).toBe('{"ok":true}');
  });
});
