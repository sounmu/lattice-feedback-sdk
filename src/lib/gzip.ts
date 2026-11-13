// Saved screens are mostly repeated markup, so gzip shrinks them about tenfold. Uses the web streams
// both the browser and the server runtime provide.
// Sent as a gzip file, not with Content-Encoding: servers and platforms in between re-compress or unpack an
// encoded body on their own, and they leave this type alone.
export const GZIP_MEDIA_TYPE = 'application/gzip';

export function isGzipBody(headers: Headers): boolean {
  return headers.get('content-type')?.split(';')[0].trim().toLowerCase() === GZIP_MEDIA_TYPE;
}

export class GzipLimitExceededError extends Error {
  constructor() {
    super('The unpacked data is larger than its limit.');
    this.name = 'GzipLimitExceededError';
  }
}

export class InvalidGzipError extends Error {
  constructor() {
    super('The data is not valid gzip.');
    this.name = 'InvalidGzipError';
  }
}

export function isGzipSupported(): boolean {
  return typeof CompressionStream === 'function' && typeof DecompressionStream === 'function';
}

function joinChunks(chunks: readonly Uint8Array[], totalBytes: number): Uint8Array {
  const joined = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    joined.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return joined;
}

export async function gzipBytes(bytes: Uint8Array<ArrayBuffer>): Promise<Uint8Array<ArrayBuffer>> {
  const stream = new Blob([bytes]).stream().pipeThrough(new CompressionStream('gzip'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

// Stops as soon as the output passes maxBytes, so a small upload cannot expand without bound.
export async function gunzipBytesWithLimit(bytes: Uint8Array<ArrayBuffer>, maxBytes: number): Promise<Uint8Array> {
  const reader = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip')).getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  while (true) {
    let result: ReadableStreamReadResult<Uint8Array>;
    try {
      result = await reader.read();
    } catch {
      throw new InvalidGzipError();
    }
    if (result.done) {
      break;
    }
    totalBytes += result.value.byteLength;
    if (totalBytes > maxBytes) {
      await reader.cancel().catch(() => undefined);
      throw new GzipLimitExceededError();
    }
    chunks.push(result.value);
  }
  return joinChunks(chunks, totalBytes);
}
