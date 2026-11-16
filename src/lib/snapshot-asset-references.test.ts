import { describe, expect, it } from 'vitest';
import { copyWithResolvedAssetReferences, resolveAssetReferences } from '@/lib/snapshot-asset-references';

const URLS = ['blob:http://admin.test/font', 'blob:http://admin.test/image', null];

function resolve(index: number): string | null {
  return URLS[index] ?? null;
}

// How the viewer rewrote the events before: the whole payload as one JSON string.
function resolveThroughJson(value: unknown): unknown {
  return JSON.parse(resolveAssetReferences(JSON.stringify(value), resolve));
}

function createEvents() {
  return [
    { type: 4, timestamp: 1, data: { href: 'http://host.test/orders', width: 1440, height: 900 } },
    {
      type: 2,
      timestamp: 2,
      data: {
        initialOffset: { left: 0, top: 120 },
        node: {
          type: 0,
          id: 1,
          childNodes: [
            {
              type: 2,
              id: 2,
              tagName: 'style',
              attributes: { _cssText: '@font-face { src: url(lattice-asset:0) } .a { background: url(lattice-asset:2) }' },
              childNodes: [{ type: 3, id: 3, textContent: '.b { background: url(lattice-asset:1) } .c { background: url(lattice-asset:1) }' }],
            },
            {
              type: 2,
              id: 4,
              tagName: 'img',
              attributes: { src: 'lattice-asset:1', alt: 'plain "quoted" text', width: 10, hidden: false, title: null },
              childNodes: [],
            },
          ],
        },
      },
    },
  ];
}

describe('copyWithResolvedAssetReferences', () => {
  it('gives the same events as rewriting the JSON text, nested references and unknown indexes included', () => {
    const events = createEvents();

    expect(copyWithResolvedAssetReferences(events, resolve)).toEqual(resolveThroughJson(events));
  });

  it('keeps a reference whose file could not be loaded', () => {
    const rewritten = JSON.stringify(copyWithResolvedAssetReferences(createEvents(), resolve));

    expect(rewritten).toContain('url(lattice-asset:2)');
    expect(rewritten).not.toContain('lattice-asset:0');
  });

  it('leaves the given events as they were and shares no object with the copy', () => {
    const events = createEvents();

    const copy = copyWithResolvedAssetReferences(events, resolve);

    expect(events).toEqual(createEvents());
    expect(copy).not.toBe(events);
    expect(JSON.stringify(copy)).not.toBe(JSON.stringify(events));
    expect(copy).toEqual(resolveThroughJson(createEvents()));
    if (!Array.isArray(copy)) {
      throw new Error('The copy of an event list is a list.');
    }
    expect(copy[0]).not.toBe(events[0]);
  });
});
