import { describe, expect, it } from 'vitest';
import { GzipLimitExceededError, InvalidGzipError, gunzipBytesWithLimit, gzipBytes } from '@/lib/gzip';

const encoder = new TextEncoder();

describe('gzip', () => {
  it('shrinks repeated markup and restores the original bytes', async () => {
    const original = encoder.encode('<div class="row">cell</div>'.repeat(2000));

    const compressed = await gzipBytes(original);

    expect(compressed.byteLength).toBeLessThan(original.byteLength / 10);
    expect(await gunzipBytesWithLimit(compressed, original.byteLength)).toEqual(original);
  });

  it('refuses data that unpacks past the limit', async () => {
    const compressed = await gzipBytes(new Uint8Array(1024 * 1024));

    await expect(gunzipBytesWithLimit(compressed, 1024 * 1024 - 1)).rejects.toBeInstanceOf(GzipLimitExceededError);
  });

  it('refuses data that is not gzip', async () => {
    await expect(gunzipBytesWithLimit(encoder.encode('{"plain":true}'), 1024)).rejects.toBeInstanceOf(InvalidGzipError);
  });
});
