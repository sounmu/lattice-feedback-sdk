import { expect, it } from 'vitest';
import type { SnapshotNode } from '@/sdk/snapshot-assets';
import { sanitizeReplayEvents } from '@/sdk/replay-sanitize';
import type { ScreenSnapshotEvent } from '@/types/screen-snapshot';

function element(id: number, tagName: string, attributes: Record<string, string>, childNodes: SnapshotNode[] = []): SnapshotNode {
  return { type: 2, id, tagName, attributes, childNodes };
}

it('applies the saved-screen exclusions to the snapshot and to everything added or changed later', () => {
  const hidden = element(3, 'input', { type: 'hidden', value: 'CSRF-1' });
  const full = element(1, 'html', {}, [element(2, 'button', { onclick: 'steal()' }), hidden]);
  const addedHidden = element(10, 'input', { type: 'hidden', value: 'CSRF-2' });
  const addedButton = element(11, 'a', { href: '/next', onmouseover: 'steal()' });
  const events: ScreenSnapshotEvent[] = [
    { type: 4, timestamp: 1, data: {} },
    { type: 2, timestamp: 1, data: { node: { type: 0, id: 0, childNodes: [full] } } },
    { type: 3, timestamp: 2, data: { source: 0, adds: [{ node: addedHidden }, { node: addedButton }], attributes: [] } },
    {
      type: 3,
      timestamp: 3,
      data: { source: 0, adds: [], attributes: [{ id: 3, attributes: { value: 'CSRF-3' } }, { id: 11, attributes: { onclick: 'x()', title: 'Next' } }] },
    },
    { type: 3, timestamp: 4, data: { source: 5, id: 4, text: '***' } },
  ];

  sanitizeReplayEvents(events);

  expect(hidden.attributes).toEqual({ type: 'hidden' });
  expect(full.childNodes?.[0].attributes).toEqual({});
  expect(addedHidden.attributes).toEqual({ type: 'hidden' });
  expect(addedButton.attributes).toEqual({ href: '/next' });
  expect((events[3].data as { attributes: unknown[] }).attributes).toEqual([
    { id: 3, attributes: {} },
    { id: 11, attributes: { title: 'Next' } },
  ]);
  expect(events[4].data).toEqual({ source: 5, id: 4, text: '***' });
});
