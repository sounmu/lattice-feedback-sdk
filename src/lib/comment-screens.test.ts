import { expect, it } from 'vitest';
import { addCommentScreen } from '@/lib/comment-screens';
import type { ScreenSnapshotSummary } from '@/types/screen-snapshot';

function createScreen(id: string, url: string): ScreenSnapshotSummary {
  return { id, page: { url } } as ScreenSnapshotSummary;
}

it('replaces the earlier comment screen of the same page and keeps every other screen', () => {
  const manual = createScreen('manual', 'https://host.example.com/');
  const oldComment = createScreen('old', 'https://host.example.com/');
  const otherPage = createScreen('other', 'https://host.example.com/orders');

  const result = addCommentScreen(
    { snapshots: [manual, oldComment, otherPage], commentScreenIds: new Set(['old', 'other']) },
    createScreen('new', 'https://host.example.com/'),
  );

  expect(result.snapshots.map((snapshot) => snapshot.id)).toEqual(['manual', 'other', 'new']);
  expect([...result.commentScreenIds]).toEqual(['other', 'new']);
});
