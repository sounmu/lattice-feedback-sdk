import type { ScreenSnapshotSummary } from '@/types/screen-snapshot';

export interface MarkedScreens {
  snapshots: ScreenSnapshotSummary[];
  /** Comments and edits marked on each screen saved for them (keys like "comment-1"), by screen id. */
  marksByScreen: ReadonlyMap<string, readonly string[]>;
}

/**
 * Adds a screen saved after a comment or edit. An earlier marked screen of the same page is replaced
 * only when the new one still shows every mark it had, so a mark made in another UI state (an open
 * modal, for example) keeps its own screen. Returns null when the result would exceed the screen limit.
 */
export function addMarkedScreen(
  current: MarkedScreens,
  created: ScreenSnapshotSummary,
  markKeys: readonly string[],
  maxSnapshots: number,
): MarkedScreens | null {
  const replaced = new Set(
    current.snapshots
      .filter((snapshot) => {
        const earlierMarks = current.marksByScreen.get(snapshot.id);
        return earlierMarks !== undefined && snapshot.page.url === created.page.url &&
          earlierMarks.every((key) => markKeys.includes(key));
      })
      .map((snapshot) => snapshot.id),
  );
  const snapshots = [...current.snapshots.filter((snapshot) => !replaced.has(snapshot.id)), created];
  if (snapshots.length > maxSnapshots) {
    return null;
  }
  const marksByScreen = new Map([...current.marksByScreen].filter(([id]) => !replaced.has(id)));
  marksByScreen.set(created.id, markKeys);
  return { snapshots, marksByScreen };
}
