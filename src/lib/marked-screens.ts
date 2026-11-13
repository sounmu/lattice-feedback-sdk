import type { ScreenSnapshotSummary } from '@/types/screen-snapshot';

interface CommentScreens {
  snapshots: ScreenSnapshotSummary[];
  markedScreenIds: ReadonlySet<string>;
}

/**
 * Adds a screen saved after a comment or edit. Every such screen marks all comments and edits on its
 * page, so it replaces the earlier marked screen of the same page instead of piling up.
 */
export function addMarkedScreen(current: CommentScreens, created: ScreenSnapshotSummary): CommentScreens {
  const replaced = new Set(
    current.snapshots
      .filter((snapshot) => current.markedScreenIds.has(snapshot.id) && snapshot.page.url === created.page.url)
      .map((snapshot) => snapshot.id),
  );
  const markedScreenIds = new Set([...current.markedScreenIds].filter((id) => !replaced.has(id)));
  markedScreenIds.add(created.id);
  return {
    snapshots: [...current.snapshots.filter((snapshot) => !replaced.has(snapshot.id)), created],
    markedScreenIds,
  };
}
