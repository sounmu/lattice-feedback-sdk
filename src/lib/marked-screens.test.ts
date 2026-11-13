import { expect, it } from 'vitest';
import { addMarkedScreen } from '@/lib/marked-screens';
import type { ScreenSnapshotSummary } from '@/types/screen-snapshot';

function createScreen(id: string, url: string): ScreenSnapshotSummary {
  return { id, page: { url } } as ScreenSnapshotSummary;
}

it('replaces the earlier comment screen of the same page and keeps every other screen', () => {
  const manual = createScreen('manual', 'https://host.example.com/');
  const oldComment = createScreen('old', 'https://host.example.com/');
  const otherPage = createScreen('other', 'https://host.example.com/orders');

  const result = addMarkedScreen(
    { snapshots: [manual, oldComment, otherPage], markedScreenIds: new Set(['old', 'other']) },
    createScreen('new', 'https://host.example.com/'),
  );

  expect(result.snapshots.map((snapshot) => snapshot.id)).toEqual(['manual', 'other', 'new']);
  expect([...result.markedScreenIds]).toEqual(['other', 'new']);
});
