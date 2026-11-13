import { expect, it } from 'vitest';
import type { SnapshotNode } from '@/sdk/snapshot-assets';
import { sanitizeReplayEvents, type AttributeChange } from '@/sdk/replay-sanitize';
import type { ScreenSnapshotEvent } from '@/types/screen-snapshot';

function element(id: number, tagName: string, attributes: Record<string, string>, childNodes: SnapshotNode[] = []): SnapshotNode {
  return { type: 2, id, tagName, attributes, childNodes };
}

function createRecording(full: SnapshotNode, ...changes: AttributeChange[][]): ScreenSnapshotEvent[] {
  return [
    { type: 4, timestamp: 1, data: {} },
    { type: 2, timestamp: 1, data: { node: { type: 0, id: 0, childNodes: [full] } } },
    ...changes.map((attributes, index) => ({ type: 3, timestamp: index + 2, data: { source: 0, adds: [], attributes } })),
  ];
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

it('removes later values of token metas and of inputs that are or become hidden, and keeps visible ones', () => {
  const full = element(1, 'html', {}, [
    element(2, 'meta', { name: 'csrf-token', content: 'TOKEN-1' }),
    element(3, 'meta', { name: 'viewport', content: 'width=1' }),
    element(4, 'input', { type: 'text', value: '***' }),
  ]);
  const rotatedToken: AttributeChange = { id: 2, attributes: { content: 'TOKEN-2' } };
  const viewport: AttributeChange = { id: 3, attributes: { content: 'width=2' } };
  const typed: AttributeChange = { id: 4, attributes: { value: '****' } };
  const becameHidden: AttributeChange = { id: 4, attributes: { type: 'hidden', value: 'SECRET-1' } };
  const whileHidden: AttributeChange = { id: 4, attributes: { value: 'SECRET-2' } };

  sanitizeReplayEvents(createRecording(full, [rotatedToken, viewport, typed], [becameHidden], [whileHidden]));

  expect(rotatedToken.attributes).toEqual({});
  expect(viewport.attributes).toEqual({ content: 'width=2' });
  expect(typed.attributes).toEqual({ value: '****' });
  expect(becameHidden.attributes).toEqual({ type: 'hidden' });
  expect(whileHidden.attributes).toEqual({});
});

it('removes script-carrying attributes from later changes and passes other values through, text or not', () => {
  const full = element(1, 'html', {}, [element(2, 'a', { href: '/a' }), element(3, 'iframe', {}), element(4, 'div', { style: 'color: red' })]);
  const link: AttributeChange = { id: 2, attributes: { href: ' JavaScript:steal()', title: 'Next', onclick: null } };
  const frame: AttributeChange = { id: 3, attributes: { srcdoc: '<script>steal()</script>', src: '/frame' } };
  const box: AttributeChange = { id: 4, attributes: { style: { color: 'blue', width: ['10px', 'important'], height: false }, class: null } };
  const untracked: AttributeChange = { id: 99, attributes: { onload: 'steal()', hidden: null } };

  sanitizeReplayEvents(createRecording(full, [link, frame, box, untracked]));

  expect(link.attributes).toEqual({ title: 'Next' });
  expect(frame.attributes).toEqual({ src: '/frame' });
  expect(box.attributes).toEqual({ style: { color: 'blue', width: ['10px', 'important'], height: false }, class: null });
  expect(untracked.attributes).toEqual({ hidden: null });
});

it('clears input events of hidden inputs and keeps the masked ones of visible inputs', () => {
  const full = element(1, 'html', {}, [element(2, 'input', { type: 'hidden' }), element(3, 'input', { type: 'text' })]);
  const events = [
    ...createRecording(full),
    { type: 3, timestamp: 5, data: { source: 5, id: 2, text: 'CSRF-3', isChecked: false } },
    { type: 3, timestamp: 6, data: { source: 5, id: 3, text: '****', isChecked: false } },
  ];

  sanitizeReplayEvents(events);

  expect(events.slice(2).map((event) => (event.data as { text: string }).text)).toEqual(['', '****']);
});
