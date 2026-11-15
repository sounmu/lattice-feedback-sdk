export interface BoundedSource {
  text: string;
  byteLength: number;
  /** False when the source was larger than the budget or its download stopped early. */
  isComplete: boolean;
}

/**
 * Reads text up to a byte budget. A source that is too large, or whose download stops, keeps the part that
 * was read: that part is still text the page served, so it can prove labels static.
 */
export async function readTextWithinBudget(
  reader: Pick<ReadableStreamDefaultReader<Uint8Array>, 'read'>,
  maxBytes: number,
): Promise<BoundedSource> {
  const decoder = new TextDecoder();
  let text = '';
  let byteLength = 0;
  try {
    while (byteLength < maxBytes) {
      const chunk = await reader.read();
      if (chunk.done) {
        return { text: text + decoder.decode(), byteLength, isComplete: true };
      }
      const usable = chunk.value.subarray(0, maxBytes - byteLength);
      byteLength += usable.byteLength;
      // Streaming keeps a character cut at the budget out of the text instead of turning it into a wrong one.
      text += decoder.decode(usable, { stream: true });
    }
  } catch {
    // The download stopped (timeout or network). The caller reports the source as incomplete.
  }
  return { text, byteLength, isComplete: false };
}
