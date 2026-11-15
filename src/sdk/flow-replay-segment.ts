// A Flow replay is one segment per document it passed through. rrweb numbers nodes from 1 again in every
// document, so node ids are only ever looked up inside their own segment.
import type { ReplayChunk, ReplayProgress } from '@/sdk/flow-replay-session';
import { trimReplayStart } from '@/sdk/replay-sanitize';
import type { ScreenSnapshotEvent, ScreenSnapshotPage } from '@/types/screen-snapshot';

export interface ReplaySegment {
  page: ScreenSnapshotPage;
  /** Cleaned events of one document, starting with its Meta and FullSnapshot pair. */
  events: ScreenSnapshotEvent[];
  /** Same-origin CSS image URLs the page showed at some point while recording, not only at the end. */
  usedCssImageUrls: string[];
  /** Normalized families of the fonts this document had loaded while recording. */
  loadedFontFamilies: string[];
  /** The file each <img> showed when it was recorded (srcset or <picture> choice), by rrweb node id. */
  liveImageSources: [number, string][];
  /** Events recorded before this document were lost; the replay carries a marker here. */
  gapBefore: boolean;
}

export interface SavedReplay {
  segments: ReplaySegment[];
  /** What the saved part already uses of the replay limits. */
  eventCount: number;
  bytes: number;
  /** Events of every saved chunk, also those of a document with nothing left to show. */
  recordedCount: number;
  /** Number and saved event count of the last document that saved anything; -1 when none did. */
  lastSegment: number;
  lastEventCount: number;
  /** The last saved document left nothing that can be shown, so whatever comes next follows a gap. */
  hasGapAfter: boolean;
  isEnded: boolean;
}

function isStashedChunk(value: unknown): value is ReplayChunk {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const candidate = value as Partial<Record<keyof ReplayChunk, unknown>>;
  return Number.isSafeInteger(candidate.segment) && Number.isSafeInteger(candidate.index) && Array.isArray(candidate.events) &&
    typeof candidate.bytes === 'number' && Array.isArray(candidate.usedCssImageUrls) &&
    Array.isArray(candidate.loadedFontFamilies) && Array.isArray(candidate.liveImageSources);
}

/** Reads the tail a document stashed as it was left. Anything that is not a list of chunks yields none. */
export function parseStashedChunks(text: string | null): ReplayChunk[] {
  if (text === null) {
    return [];
  }
  try {
    const parsed: unknown = JSON.parse(text);
    return Array.isArray(parsed) && parsed.every(isStashedChunk) ? parsed : [];
  } catch (error) {
    if (error instanceof SyntaxError) {
      return [];
    }
    throw error;
  }
}

export function getChunkKey(chunk: Pick<ReplayChunk, 'segment' | 'index'>): string {
  return `${chunk.segment}:${chunk.index}`;
}

/** The saved chunks and the stashed tail as one run in recorded order. A chunk found in both is kept once. */
export function mergeStashedChunks(stored: readonly ReplayChunk[], stashed: readonly ReplayChunk[]): ReplayChunk[] {
  const chunks = new Map<string, ReplayChunk>();
  for (const chunk of [...stashed, ...stored]) {
    chunks.set(getChunkKey(chunk), chunk);
  }
  return [...chunks.values()].sort((first, second) => first.segment - second.segment || first.index - second.index);
}

/**
 * The stashed chunks IndexedDB does not hold. The stash is their only copy, so they have to be saved again
 * before it goes, or a document after the next one would not find them.
 */
export function findUnsavedChunks(stored: readonly ReplayChunk[], stashed: readonly ReplayChunk[]): ReplayChunk[] {
  const savedKeys = new Set(stored.map(getChunkKey));
  return stashed.filter((chunk) => !savedKeys.has(getChunkKey(chunk)));
}

/**
 * Whether events were lost on the way into this document. The document before it notes how many events it
 * recorded as it was left, and how many the whole Flow had by then: fewer saved than either, or no note from
 * it, means some are missing. The Flow-wide count catches a loss in a document further back.
 */
export function findGapBefore(saved: SavedReplay, progress: ReplayProgress | null): boolean {
  return saved.hasGapAfter || progress?.segment !== saved.lastSegment || progress.eventCount > saved.lastEventCount ||
    !Number.isSafeInteger(progress.totalEventCount) || progress.totalEventCount > saved.recordedCount;
}

export function mergeReplayChunks(chunks: readonly ReplayChunk[]): SavedReplay {
  const saved: SavedReplay = { segments: [], eventCount: 0, bytes: 0, recordedCount: 0, lastSegment: -1, lastEventCount: 0, hasGapAfter: false, isEnded: false };
  const groups = new Map<number, ReplayChunk[]>();
  for (const chunk of chunks) {
    const group = groups.get(chunk.segment) ?? [];
    group.push(chunk);
    groups.set(chunk.segment, group);
  }
  for (const [segment, group] of groups) {
    const [{ page, gapBefore }] = group;
    const events = group.flatMap((chunk) => chunk.events);
    const playable = page ? trimReplayStart(events, page.url) : [];
    saved.lastSegment = segment;
    saved.lastEventCount = events.length;
    saved.recordedCount += events.length;
    saved.isEnded ||= group.some((chunk) => chunk.ended);
    saved.hasGapAfter ||= gapBefore;
    if (!page || playable.length === 0) {
      // Its snapshot never got saved, so nothing of this document can be shown.
      saved.hasGapAfter = true;
      continue;
    }
    saved.segments.push({
      page,
      events: playable,
      usedCssImageUrls: group.flatMap((chunk) => chunk.usedCssImageUrls),
      loadedFontFamilies: group.flatMap((chunk) => chunk.loadedFontFamilies),
      liveImageSources: group.flatMap((chunk) => chunk.liveImageSources),
      gapBefore: saved.hasGapAfter,
    });
    // The marker of a gap is an event of the saved screen too.
    saved.eventCount += playable.length + (saved.hasGapAfter ? 1 : 0);
    saved.bytes += group.reduce((total, chunk) => total + chunk.bytes, 0);
    saved.hasGapAfter = false;
  }
  return saved;
}
