import type { ScreenSnapshotSummary } from '@/types/screen-snapshot';

interface CommentScreens {
  snapshots: ScreenSnapshotSummary[];
  commentScreenIds: ReadonlySet<string>;
}

/**
 * Adds a screen saved after a comment. Every such screen pins all comments on its page,
 * so it replaces the earlier comment screen of the same page instead of piling up.
 */
export function addCommentScreen(current: CommentScreens, created: ScreenSnapshotSummary): CommentScreens {
  const replaced = new Set(
    current.snapshots
      .filter((snapshot) => current.commentScreenIds.has(snapshot.id) && snapshot.page.url === created.page.url)
      .map((snapshot) => snapshot.id),
  );
  const commentScreenIds = new Set([...current.commentScreenIds].filter((id) => !replaced.has(id)));
  commentScreenIds.add(created.id);
  return {
    snapshots: [...current.snapshots.filter((snapshot) => !replaced.has(snapshot.id)), created],
    commentScreenIds,
  };
}
