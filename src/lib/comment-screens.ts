import type { ScreenSnapshotSummary } from '@/types/screen-snapshot';

export interface CommentScreens {
  snapshots: ScreenSnapshotSummary[];
  /** Keys of the comments pinned on each screen saved for comments, by screen id. */
  commentPinsByScreen: ReadonlyMap<string, readonly string[]>;
}

/**
 * Adds a screen saved after a comment. An earlier comment screen of the same page is replaced only
 * when the new one still pins every comment it showed, so a comment written in another UI state
 * (an open modal, for example) keeps its own screen. Returns null when the result would exceed the
 * screen limit.
 */
export function addCommentScreen(
  current: CommentScreens,
  created: ScreenSnapshotSummary,
  pinKeys: readonly string[],
  maxSnapshots: number,
): CommentScreens | null {
  const replaced = new Set(
    current.snapshots
      .filter((snapshot) => {
        const earlierPins = current.commentPinsByScreen.get(snapshot.id);
        return earlierPins !== undefined && snapshot.page.url === created.page.url &&
          earlierPins.every((key) => pinKeys.includes(key));
      })
      .map((snapshot) => snapshot.id),
  );
  const snapshots = [...current.snapshots.filter((snapshot) => !replaced.has(snapshot.id)), created];
  if (snapshots.length > maxSnapshots) {
    return null;
  }
  const commentPinsByScreen = new Map([...current.commentPinsByScreen].filter(([id]) => !replaced.has(id)));
  commentPinsByScreen.set(created.id, pinKeys);
  return { snapshots, commentPinsByScreen };
}
