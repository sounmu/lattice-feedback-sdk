// A Flow replay is one segment per document it passed through. rrweb numbers nodes from 1 again in every
// document, so node ids are only ever looked up inside their own segment.
import type { ReplayChunk } from '@/sdk/flow-replay-session';
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
  /** Number and saved event count of the last document that saved anything; -1 when none did. */
  lastSegment: number;
  lastEventCount: number;
  /** The last saved document left nothing that can be shown, so whatever comes next follows a gap. */
  hasGapAfter: boolean;
  isEnded: boolean;
}

export function mergeReplayChunks(chunks: readonly ReplayChunk[]): SavedReplay {
  const saved: SavedReplay = { segments: [], eventCount: 0, bytes: 0, lastSegment: -1, lastEventCount: 0, hasGapAfter: false, isEnded: false };
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
