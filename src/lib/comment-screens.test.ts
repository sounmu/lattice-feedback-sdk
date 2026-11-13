import { expect, it } from 'vitest';
import { addCommentScreen } from '@/lib/comment-screens';
import type { ScreenSnapshotSummary } from '@/types/screen-snapshot';

const HOME = 'https://host.example.com/';

function createScreen(id: string, url = HOME): ScreenSnapshotSummary {
  return { id, page: { url } } as ScreenSnapshotSummary;
}

it('replaces an earlier comment screen of the same page only when the new one keeps all its pins', () => {
  const current = {
    snapshots: [createScreen('manual'), createScreen('covered'), createScreen('modal'), createScreen('other', `${HOME}orders`)],
    commentPinsByScreen: new Map([['covered', [1]], ['modal', [2]], ['other', [3]]]),
  };

  const result = addCommentScreen(current, createScreen('new'), [1, 4], 5);

  expect(result?.snapshots.map((snapshot) => snapshot.id)).toEqual(['manual', 'modal', 'other', 'new']);
  expect([...(result?.commentPinsByScreen.keys() ?? [])]).toEqual(['modal', 'other', 'new']);
});

it('refuses a screen that would go over the limit', () => {
  const current = { snapshots: [createScreen('a'), createScreen('b')], commentPinsByScreen: new Map([['b', [1]]]) };

  expect(addCommentScreen(current, createScreen('c', `${HOME}orders`), [2], 2)).toBeNull();
  expect(addCommentScreen(current, createScreen('c'), [1, 2], 2)?.snapshots.map((snapshot) => snapshot.id)).toEqual(['a', 'c']);
});
