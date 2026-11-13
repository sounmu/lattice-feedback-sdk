import { expect, it } from 'vitest';
import { addMarkedScreen } from '@/lib/marked-screens';
import type { ScreenSnapshotSummary } from '@/types/screen-snapshot';

const HOME = 'https://host.example.com/';

function createScreen(id: string, url = HOME): ScreenSnapshotSummary {
  return { id, page: { url } } as ScreenSnapshotSummary;
}

it('replaces an earlier comment screen of the same page only when the new one keeps all its marks', () => {
  const current = {
    snapshots: [createScreen('manual'), createScreen('covered'), createScreen('modal'), createScreen('other', `${HOME}orders`)],
    marksByScreen: new Map([['covered', ['comment:1']], ['modal', ['comment:2']], ['other', ['edit:1']]]),
  };

  const result = addMarkedScreen(current, createScreen('new'), ['comment:1', 'edit:2'], 5);

  expect(result?.snapshots.map((snapshot) => snapshot.id)).toEqual(['manual', 'modal', 'other', 'new']);
  expect([...(result?.marksByScreen.keys() ?? [])]).toEqual(['modal', 'other', 'new']);
});

it('refuses a screen that would go over the limit', () => {
  const current = { snapshots: [createScreen('a'), createScreen('b')], marksByScreen: new Map([['b', ['comment:1']]]) };

  expect(addMarkedScreen(current, createScreen('c', `${HOME}orders`), ['edit:1'], 2)).toBeNull();
  expect(addMarkedScreen(current, createScreen('c'), ['comment:1', 'edit:1'], 2)?.snapshots.map((snapshot) => snapshot.id)).toEqual(['a', 'c']);
});
