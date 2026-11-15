import { describe, expect, it } from 'vitest';
import { AutomaticMasker } from '@/sdk/automatic-masking';
import type { SnapshotNode, SnapshotStyleChange } from '@/sdk/snapshot-assets';
import { SnapshotMasker } from '@/sdk/snapshot-masking';
import { findSelectorRanges, maskOutsideRanges, rewriteCssNames, scanCssSelectors } from '@/sdk/css-selectors';
import { rewriteReferences } from '@/sdk/structural-references';
import { sanitizeReplayEvents } from '@/sdk/replay-sanitize';
import type { ScreenSnapshotEvent } from '@/types/screen-snapshot';

function element(tagName: string, attributes: Record<string, string>, childNodes: SnapshotNode[] = []): SnapshotNode {
  return { type: 2, tagName, attributes, childNodes };
}

function stylesheet(cssText: string): SnapshotNode {
  return element('style', {}, [{ type: 3, textContent: cssText }]);
}

function attributesOf(node: SnapshotNode | undefined): Record<string, string> {
  return (node?.attributes ?? {}) as Record<string, string>;
}

describe('structural references in a masked screen', () => {
  it('maps a generated id and the references to it to the same opaque name', () => {
    const filter = element('filter', { id: 'blur-4f9c2' });
    const shape = element('rect', { filter: 'url(#blur-4f9c2)', style: 'clip-path: url("#blur-4f9c2")' });
    const link = element('use', { href: '#blur-4f9c2', 'xlink:href': '#blur%2D4f9c2' });
    const label = element('label', { for: 'field-9' });
    const input = element('input', { id: 'field-9', 'aria-labelledby': 'field-9 blur-4f9c2', list: 'blur-4f9c2' });
    const root = element('div', {}, [element('svg', {}, [filter, shape, link]), label, input]);

    new SnapshotMasker(new AutomaticMasker(new Set())).node(root);

    const opaque = attributesOf(filter).id;
    expect(opaque).toMatch(/^lattice-ref-\d+$/);
    expect(attributesOf(shape).filter).toBe(`url(#${opaque})`);
    expect(attributesOf(shape).style).toBe(`clip-path: url("#${opaque}")`);
    expect(attributesOf(link).href).toBe(`#${opaque}`);
    expect(attributesOf(link)['xlink:href']).toBe(`#${opaque}`);
    expect(attributesOf(label).for).toBe(attributesOf(input).id);
    expect(attributesOf(input)['aria-labelledby']).toBe(`${attributesOf(input).id} ${opaque}`);
    expect(attributesOf(input).list).toBe(opaque);
    expect(JSON.stringify(root)).not.toMatch(/4f9c2|field-9/);
  });

  it('keeps names the page ships and names its stylesheet uses, so styling and graphics still resolve', () => {
    const known = element('filter', { id: 'blur' });
    const styled = element('div', { id: 'row-12', class: 'row' });
    const user = element('rect', { filter: 'url(#blur)' });
    const root = element('div', {}, [stylesheet('#row-12 { color: red } ::part(thumb) { top: 0 }'), known, styled, user, element('input', { part: 'thumb' })]);

    new SnapshotMasker(new AutomaticMasker(new Set(['blur']))).node(root);

    expect(attributesOf(known).id).toBe('blur');
    expect(attributesOf(styled).id).toBe('row-12');
    expect(attributesOf(user).filter).toBe('url(#blur)');
    expect(attributesOf(root.childNodes?.[4]).part).toBe('thumb');
  });

  it('maps every id in the list an output is for to the name that id got', () => {
    const first = recorded(2, 'input', { id: 'qty-gen-1' });
    const second = recorded(3, 'input', { id: 'qty-gen-2' });
    const output = recorded(4, 'output', { for: 'qty-gen-1 qty-gen-2' });
    const button = recorded(5, 'button', { interestfor: 'qty-gen-1' });

    new SnapshotMasker(new AutomaticMasker(new Set())).node(recorded(1, 'form', {}, [first, second, output, button]));

    expect(attributesOf(output).for).toBe(`${attributesOf(first).id} ${attributesOf(second).id}`);
    expect(attributesOf(button).interestfor).toBe(attributesOf(first).id);
  });

  it('keeps a radio group together and distinct groups apart without exposing the field names', () => {
    const first = element('input', { type: 'radio', name: 'plan-77', value: 'a' });
    const second = element('input', { type: 'radio', name: 'plan-77', value: 'b' });
    const other = element('input', { type: 'radio', name: 'tier-88', value: 'c' });
    const root = element('form', {}, [first, second, other]);

    new SnapshotMasker(new AutomaticMasker(new Set())).node(root);

    expect(attributesOf(first).name).toBe(attributesOf(second).name);
    expect(attributesOf(other).name).not.toBe(attributesOf(first).name);
    expect(attributesOf(first).name).not.toMatch(/plan|77/);
    expect(attributesOf(first).value).toBe('●');
  });

  it('keeps data attribute values a stylesheet selects on, and masks the rest', () => {
    const selected = element('li', { 'data-state': 'open', 'data-customer': 'Mina Park' });
    const root = element('ul', {}, [stylesheet('[data-state="open"] { display: block }'), selected]);

    new SnapshotMasker(new AutomaticMasker(new Set())).node(root);

    expect(attributesOf(selected)['data-state']).toBe('open');
    expect(attributesOf(selected)['data-customer']).toBe('●●●● ●●●●');
  });

  it('applies the same mapping to ids that arrive in later page changes and counts each new name once', () => {
    const masker = new AutomaticMasker(new Set());
    const masking = new SnapshotMasker(masker);
    const first = element('rect', { id: 'gradient-31' });
    masking.node(first);
    const change = { 'aria-controls': 'gradient-31', id: 'gradient-32' };
    masking.attributes(1, change);

    expect(change['aria-controls']).toBe(attributesOf(first).id);
    expect(change.id).not.toBe(attributesOf(first).id);
    expect(masker.maskedValues).toBe(2);
  });

  it('leaves names alone when automatic masking is off', () => {
    const node = element('rect', { id: 'blur-4f9c2', filter: 'url(#blur-4f9c2)' });

    new SnapshotMasker(new AutomaticMasker(new Set(), { enabled: false })).node(node);

    expect(node.attributes).toEqual({ id: 'blur-4f9c2', filter: 'url(#blur-4f9c2)' });
  });

  it('does not treat keywords and external links as names', () => {
    const remap = (name: string) => `x-${name}`;

    expect(rewriteReferences('target', '_blank', remap)).toBe('_blank');
    expect(rewriteReferences('target', 'preview', remap)).toBe('x-preview');
    expect(rewriteReferences('href', 'https://example.com/#top', remap)).toBe('https://example.com/#top');
    expect(rewriteReferences('_cssText', 'a{fill:url(#g)}', remap)).toBe('a{fill:url(#g)}');
    expect(rewriteReferences('exportparts', 'inner:outer, other', remap)).toBe('x-inner:x-outer, x-other');
  });

  it('finds what a stylesheet spells out: names, and the selectors on data attributes', () => {
    const { names, dataSelectors } = scanCssSelectors('#a\\:b{} ::part(x y){} [data-k=v]{} [role="tab" i]{} [for~=lbl]{} a[href^=\'/x\']{} [data-n|="en" i]{}');

    expect([...names].sort()).toEqual(['a:b', 'lbl', 'x', 'y']);
    expect(dataSelectors).toEqual([
      { attribute: 'data-k', operator: '=', value: 'v', ignoreCase: false },
      { attribute: 'data-n', operator: '|=', value: 'en', ignoreCase: true },
    ]);
  });
});

function recorded(id: number, tagName: string, attributes: Record<string, string>, childNodes: SnapshotNode[] = []): SnapshotNode {
  return { type: 2, id, tagName, attributes, childNodes };
}

function textNode(id: number, textContent: string): SnapshotNode {
  return { type: 3, id, textContent };
}

const PRIVATE_TEXT = 'Mina Park';
const MASKED_TEXT = '\u25cf\u25cf\u25cf\u25cf \u25cf\u25cf\u25cf\u25cf';

// A container (1) holds a wrapper (2) holding a text node (3).
function createKeptSubtree(markers: Record<string, string> = { 'data-lattice-keep': '' }) {
  const masking = new SnapshotMasker(new AutomaticMasker(new Set()));
  masking.node(recorded(1, 'div', markers, [recorded(2, 'span', {}, [textNode(3, 'Public heading')])]));
  return masking;
}

describe('the exemption and the mask of a node follow the markers it has now', () => {
  it('masks later text and attributes of a kept subtree once the keep marker is removed from its container', () => {
    const masking = createKeptSubtree();
    expect(masking.text(3, PRIVATE_TEXT)).toBe(PRIVATE_TEXT);

    masking.attributes(1, { 'data-lattice-keep': null });
    const change = { 'data-customer': PRIVATE_TEXT };
    masking.attributes(2, change);

    expect(masking.text(3, PRIVATE_TEXT)).toBe(MASKED_TEXT);
    expect(change['data-customer']).toBe(MASKED_TEXT);
  });

  it('applies a keep marker removed in the same change to the values written by that change', () => {
    const masking = createKeptSubtree();
    const change = { 'data-lattice-keep': null, 'data-customer': PRIVATE_TEXT };

    masking.attributes(1, change);

    expect(change['data-customer']).toBe(MASKED_TEXT);
  });

  it('exempts a subtree whose container gets the keep marker later', () => {
    const masking = createKeptSubtree({});
    expect(masking.text(3, PRIVATE_TEXT)).toBe(MASKED_TEXT);

    masking.attributes(1, { 'data-lattice-keep': '' });

    expect(masking.text(3, PRIVATE_TEXT)).toBe(PRIVATE_TEXT);
  });

  it('lets a mask or block marker on an ancestor win over keep markers below it, and lifts it when it is removed', () => {
    const masking = new SnapshotMasker(new AutomaticMasker(new Set()));
    masking.node(recorded(1, 'div', {}, [recorded(2, 'span', { 'data-lattice-keep': '' }, [textNode(3, 'Public heading')])]));

    masking.attributes(1, { 'data-lattice-mask': '' });
    expect(masking.text(3, PRIVATE_TEXT)).toBe(MASKED_TEXT);
    masking.attributes(1, { 'data-lattice-mask': null, 'data-lattice-block': '' });
    expect(masking.text(3, PRIVATE_TEXT)).toBe(MASKED_TEXT);
    masking.attributes(1, { 'data-lattice-block': null });
    expect(masking.text(3, PRIVATE_TEXT)).toBe(PRIVATE_TEXT);
  });

  it('keeps a password field masked after a show-password toggle changes its type', () => {
    const masking = new SnapshotMasker(new AutomaticMasker(new Set()));
    masking.node(recorded(5, 'input', { type: 'password' }));
    const change = { type: 'text', value: 'hunter2' };

    masking.attributes(5, change);

    expect(change.value).toBe('\u25cf\u25cf\u25cf\u25cf\u25cf\u25cf\u25cf');
  });
});

function mutation(data: Record<string, unknown>): ScreenSnapshotEvent {
  return { type: 3, timestamp: 1, data: { source: 0, ...data } } as ScreenSnapshotEvent;
}

function replayText(masking: SnapshotMasker, events: ScreenSnapshotEvent[], id: number): string | null {
  sanitizeReplayEvents(events, new Map(), masking);
  const texts = (events.at(-1)?.data as { texts: { id: number; value: string | null }[] }).texts;
  return texts.find((change) => change.id === id)?.value ?? null;
}

describe('the context of nodes that a page change moves or removes', () => {
  function startReplay() {
    const masking = new SnapshotMasker(new AutomaticMasker(new Set()));
    const full = {
      type: 2, timestamp: 0,
      data: {
        node: {
          type: 0, id: 0,
          childNodes: [
            recorded(1, 'div', { 'data-lattice-keep': '' }, [recorded(2, 'span', {}, [textNode(3, 'Public heading'), recorded(5, 'input', { type: 'password' })])]),
            recorded(4, 'div', {}),
          ],
        },
      },
    } as unknown as ScreenSnapshotEvent;
    sanitizeReplayEvents([full], new Map(), masking);
    return masking;
  }
  const move = (id: number, from: number, to: number) => mutation({
    removes: [{ id, parentId: from }],
    adds: [{ parentId: to, node: { type: 2, id, tagName: 'span', attributes: {} } }],
    texts: [{ id: 3, value: PRIVATE_TEXT }],
  });

  it('masks the text of a subtree moved out of a kept container, and exempts it again when it moves back', () => {
    const masking = startReplay();

    expect(replayText(masking, [move(2, 1, 4)], 3)).toBe(MASKED_TEXT);
    expect(replayText(masking, [move(2, 4, 1)], 3)).toBe(PRIVATE_TEXT);
  });

  it('keeps the markers of nodes inside a moved subtree that the change does not list again', () => {
    const masking = startReplay();
    sanitizeReplayEvents([move(2, 1, 4)], new Map(), masking);
    const change = { value: 'hunter2' };

    masking.attributes(5, change);

    expect(change.value).toBe('\u25cf\u25cf\u25cf\u25cf\u25cf\u25cf\u25cf');
  });

  it('forgets a removed subtree, so it keeps no exemption and later text for it is masked', () => {
    const masking = startReplay();
    expect(masking.text(3, PRIVATE_TEXT)).toBe(PRIVATE_TEXT);

    sanitizeReplayEvents([mutation({ removes: [{ id: 1, parentId: 0 }] })], new Map(), masking);

    expect(masking.text(3, PRIVATE_TEXT)).toBe(MASKED_TEXT);
  });
});

describe('a page change is cleaned as the state it leaves behind', () => {
  it('maps fragment references inside a changed style dictionary to the name their target got', () => {
    const masking = new SnapshotMasker(new AutomaticMasker(new Set()));
    const filter = recorded(2, 'filter', { id: 'blur-generated' });
    masking.node(recorded(1, 'svg', {}, [filter, recorded(3, 'rect', {})]));
    const style: SnapshotStyleChange = {
      filter: 'url(#blur-generated)',
      'clip-path': ['url("#blur-generated")', 'important'],
      color: 'red',
      mask: false,
    };

    sanitizeReplayEvents([mutation({ attributes: [{ id: 3, attributes: { style } }] })], new Map(), masking);

    const opaque = attributesOf(filter).id;
    expect(opaque).toMatch(/^lattice-ref-\d+$/);
    expect(style).toEqual({ filter: `url(#${opaque})`, 'clip-path': [`url("#${opaque}")`, 'important'], color: 'red', mask: false });
  });

  it('masks content added by the change that removes the keep marker from its container', () => {
    const masking = createKeptSubtree();
    const added = recorded(10, 'span', { title: PRIVATE_TEXT }, [textNode(11, PRIVATE_TEXT)]);
    const change = mutation({ attributes: [{ id: 1, attributes: { 'data-lattice-keep': null } }], adds: [{ parentId: 1, node: added }] });

    sanitizeReplayEvents([change], new Map(), masking);

    expect(attributesOf(added).title).toBe(MASKED_TEXT);
    expect(added.childNodes?.[0].textContent).toBe(MASKED_TEXT);
  });

  it('keeps content added by the change that puts the keep marker on its container', () => {
    const masking = createKeptSubtree({});
    const added = recorded(10, 'span', {}, [textNode(11, PRIVATE_TEXT)]);
    const change = mutation({ attributes: [{ id: 1, attributes: { 'data-lattice-keep': '' } }], adds: [{ parentId: 1, node: added }] });

    sanitizeReplayEvents([change], new Map(), masking);

    expect(added.childNodes?.[0].textContent).toBe(PRIVATE_TEXT);
  });
});

const MASKED_FLAGS = '\u25cf'.repeat(7);

describe('names that stylesheets mention after a name was already remapped', () => {
  function startWithGeneratedId() {
    const masking = new SnapshotMasker(new AutomaticMasker(new Set()));
    const row = recorded(2, 'li', { id: 'row-generated' });
    masking.node(recorded(1, 'ul', {}, [row, recorded(3, 'style', {}, [textNode(4, '.row { color: blue }')])]));
    return { masking, row, opaque: attributesOf(row).id };
  }

  it('writes a later stylesheet text change and the later references with the token the element already has', () => {
    const { masking, opaque } = startWithGeneratedId();
    expect(opaque).toMatch(/^lattice-ref-\d+$/);
    const reference = { 'aria-controls': 'row-generated' };

    const css = masking.text(4, '#row-generated { color: red } [id="row-generated"] > b { top: 0 }');
    masking.attributes(1, reference);

    expect(css).toBe(`#${opaque} { color: red } [id="${opaque}"] > b { top: 0 }`);
    expect(reference['aria-controls']).toBe(opaque);
  });

  it('writes a stylesheet element added later, and a linked sheet added later, with the existing token', () => {
    const { masking, opaque } = startWithGeneratedId();
    const style = recorded(10, 'style', {}, [textNode(11, '#row-generated { color: red }')]);
    const link = recorded(12, 'link', { rel: 'stylesheet', _cssText: '.x::part(a) { top: 0 } #row-generated { left: 0 }' });

    sanitizeReplayEvents([mutation({ adds: [{ parentId: 1, node: style }, { parentId: 1, node: link }] })], new Map(), masking);

    expect(style.childNodes?.[0].textContent).toBe(`#${opaque} { color: red }`);
    expect(attributesOf(link)._cssText).toBe(`.x::part(a) { top: 0 } #${opaque} { left: 0 }`);
  });

  it('writes stylesheet rules inserted later, declarations set later and adopted style sheets', () => {
    const { masking, opaque } = startWithGeneratedId();
    const rule = { source: 8, adds: [{ rule: '#row-generated { color: red }', index: 0 }], replaceSync: '#row-generated { top: 0 }' };
    const declaration = { source: 13, index: [0], set: { property: 'filter', value: 'url(#row-generated)', priority: '' } };
    const adopted = { source: 15, id: 1, styleIds: [1], styles: [{ styleId: 1, rules: [{ rule: '#row-generated { top: 1px }', index: 0 }] }] };

    sanitizeReplayEvents([rule, declaration, adopted].map((data) => ({ type: 3, timestamp: 1, data }) as ScreenSnapshotEvent), new Map(), masking);

    expect(rule.adds[0].rule).toBe(`#${opaque} { color: red }`);
    expect(rule.replaceSync).toBe(`#${opaque} { top: 0 }`);
    expect(declaration.set.value).toBe(`url(#${opaque})`);
    expect(adopted.styles[0].rules[0].rule).toBe(`#${opaque} { top: 1px }`);
  });

  it('keeps a name literal when a stylesheet mentioned it before anything was remapped, later sheets included', () => {
    const masking = new SnapshotMasker(new AutomaticMasker(new Set()));
    const early = recorded(3, 'style', {}, [textNode(4, '#early-name { color: red }')]);
    const first = recorded(2, 'li', { id: 'early-name' });
    masking.node(recorded(1, 'ul', {}, [early, first]));
    const later = masking.css('#early-name > b { top: 0 }');

    expect(attributesOf(first).id).toBe('early-name');
    expect(later).toBe('#early-name > b { top: 0 }');
  });

  it('keeps the token of a name when the index later learns it as static text', () => {
    const known = new Set<string>();
    const masking = new SnapshotMasker(new AutomaticMasker(known));
    const element = recorded(2, 'li', { id: 'Orders' });
    masking.node(recorded(1, 'ul', {}, [element]));
    const opaque = attributesOf(element).id;
    known.add('Orders');
    const reference = { 'aria-controls': 'Orders' };

    masking.attributes(1, reference);

    expect(opaque).toMatch(/^lattice-ref-/);
    expect(reference['aria-controls']).toBe(opaque);
  });

  it('rewrites only what a mapping exists for', () => {
    const lookup = (name: string) => (name === 'row' ? 'lattice-ref-1' : undefined);

    expect(rewriteCssNames('#row, #other, [for~=row], [data-x=row], [id^=row], ::part(row other)', lookup))
      .toBe('#lattice-ref-1, #other, [for~=lattice-ref-1], [data-x=row], [id^=row], ::part(lattice-ref-1 other)');
  });
});

describe('what a selector on a data attribute depends on', () => {
  function maskedAttribute(css: string, attribute: string, value: string, other: Record<string, string> = {}) {
    const masking = new SnapshotMasker(new AutomaticMasker(new Set()));
    const element = recorded(2, 'li', { [attribute]: value, ...other });
    masking.node(recorded(1, 'ul', {}, [recorded(3, 'style', {}, [textNode(4, css)]), element]));
    return attributesOf(element);
  }

  it.each([
    ['~= keeps the word and masks the rest', '[data-flags~="selected"]', 'data-flags', 'selected enabled', `selected ${'\u25cf'.repeat(7)}`],
    ['~= keeps the word inside private text and masks the rest', '[data-note~="urgent"]', 'data-note', 'Mina Park urgent', '\u25cf\u25cf\u25cf\u25cf \u25cf\u25cf\u25cf\u25cf urgent'],
    ['|= keeps the prefix up to the hyphen', '[data-lang|="en"]', 'data-lang', 'en-private', `en-${'\u25cf'.repeat(7)}`],
    ['|= keeps an exact value', '[data-lang|="en"]', 'data-lang', 'en', 'en'],
    ['^= keeps the prefix', '[data-id^="row-"]', 'data-id', 'row-4821', `row-${'\u25cf'.repeat(4)}`],
    ['$= keeps the suffix', '[data-file$=".pdf"]', 'data-file', 'invoice-77.pdf', `${'\u25cf'.repeat(10)}.pdf`],
    ['*= keeps every occurrence', '[data-x*="ab"]', 'data-x', 'xxabyyabzz', `\u25cf\u25cfab\u25cf\u25cfab\u25cf\u25cf`],
    ['= keeps the whole value', '[data-state="open"]', 'data-state', 'open', 'open'],
    ['an i flag ignores case and keeps the original letters', '[data-state="open" i]', 'data-state', 'OPEN', 'OPEN'],
  ])('%s', (_name, css, attribute, value, expected) => {
    expect(maskedAttribute(css, attribute, value)[attribute]).toBe(expected);
  });

  it('masks a value that no selector matches, a word that is only part of another word, and every attribute the selector does not name', () => {
    const attributes = maskedAttribute('[data-flags~="selected"]', 'data-flags', 'unselected Mina', { 'data-other': 'selected', 'data-note': 'Mina Park' });

    expect(attributes['data-flags']).toBe(`${'\u25cf'.repeat(10)} \u25cf\u25cf\u25cf\u25cf`);
    expect(attributes['data-other']).toBe('\u25cf'.repeat(8));
    expect(attributes['data-note']).toBe('\u25cf\u25cf\u25cf\u25cf \u25cf\u25cf\u25cf\u25cf');
  });

  it('masks everything inside a masked region, and keeps a value that is static text whole', () => {
    const masking = new SnapshotMasker(new AutomaticMasker(new Set(['selected and more'])));
    const inside = recorded(2, 'li', { 'data-flags': 'selected enabled', 'data-lattice-mask': '' });
    const whole = recorded(3, 'li', { 'data-flags': 'selected and more' });
    masking.node(recorded(1, 'ul', {}, [recorded(4, 'style', {}, [textNode(5, '[data-flags~="selected"]')]), inside, whole]));

    expect(attributesOf(inside)['data-flags']).toBe(`${'\u25cf'.repeat(8)} ${'\u25cf'.repeat(7)}`);
    expect(attributesOf(whole)['data-flags']).toBe('selected and more');
  });

  it('works out ranges and the masked rest on their own', () => {
    const selectors = [{ attribute: 'data-x', operator: '*=' as const, value: 'ab', ignoreCase: false }, { attribute: 'data-x', operator: '^=' as const, value: 'xa', ignoreCase: false }];

    const ranges = findSelectorRanges('xaabyyab', selectors);

    expect(ranges).toEqual([[2, 4], [6, 8], [0, 2]]);
    expect(maskOutsideRanges('xaabyyab', ranges, (gap) => '-'.repeat(gap.length))).toBe('xaab--ab');
  });
});

describe('a node that is serialized again keeps what it was known to be', () => {
  const moveWithinKept = (changes: Record<string, string>) => mutation({
    removes: [{ id: 5, parentId: 2 }],
    adds: [{ parentId: 4, node: recorded(5, 'input', changes) }],
  });

  function startKeptWithPassword() {
    const masking = new SnapshotMasker(new AutomaticMasker(new Set()));
    masking.node(recorded(1, 'div', { 'data-lattice-keep': '' }, [
      recorded(2, 'p', {}, [recorded(5, 'input', { type: 'password', value: 'hunter2' })]),
      recorded(4, 'p', {}),
    ]));
    return masking;
  }

  it('keeps a password field secret when it is switched to text and then moved inside a kept subtree', () => {
    const masking = startKeptWithPassword();
    masking.attributes(5, { type: 'text' });
    const moved = moveWithinKept({ type: 'text', value: 'hunter2' });

    sanitizeReplayEvents([moved], new Map(), masking);
    const typed = { source: 5, id: 5, text: 'hunter2', isChecked: false };
    sanitizeReplayEvents([{ type: 3, timestamp: 2, data: typed } as ScreenSnapshotEvent], new Map(), masking);

    expect(attributesOf((moved.data as { adds: { node: SnapshotNode }[] }).adds[0].node).value).toBe(MASKED_FLAGS);
    expect(typed.text).toBe(MASKED_FLAGS);
  });

  it('keeps the secret of a descendant that the same change serializes again', () => {
    const masking = startKeptWithPassword();
    masking.attributes(5, { type: 'text' });
    const wrapper = recorded(2, 'p', {}, [recorded(5, 'input', { type: 'text', value: 'hunter2' })]);

    sanitizeReplayEvents([mutation({ removes: [{ id: 2, parentId: 1 }], adds: [{ parentId: 4, node: wrapper }] })], new Map(), masking);

    expect(attributesOf(wrapper.childNodes?.[0]).value).toBe(MASKED_FLAGS);
  });

  it('keeps a secret through later attribute changes, and lets an id that was forgotten start fresh', () => {
    const masking = startKeptWithPassword();
    masking.attributes(5, { type: 'text' });
    masking.attributes(5, { autocomplete: 'off', type: null as unknown as string });
    const change = { value: 'hunter2' };
    masking.attributes(5, change);
    expect(change.value).toBe(MASKED_FLAGS);

    sanitizeReplayEvents([mutation({ removes: [{ id: 5, parentId: 2 }] })], new Map(), masking);
    const fresh = recorded(5, 'input', { type: 'text', value: 'hunter2' });
    sanitizeReplayEvents([mutation({ adds: [{ parentId: 4, node: fresh }] })], new Map(), masking);

    expect(attributesOf(fresh).value).toBe('hunter2');
  });
});

describe('attributes that carry displayed text', () => {
  it.each(['aria-valuetext', 'aria-roledescription', 'abbr', 'datetime', 'download', 'summary'])('masks %s when it is not static text', (attribute) => {
    const node = recorded(2, 'time', { [attribute]: 'Mina Park' });

    new SnapshotMasker(new AutomaticMasker(new Set())).node(recorded(1, 'div', {}, [node]));

    expect(attributesOf(node)[attribute]).toBe(MASKED_TEXT);
  });
});

describe('tokens and names the page already uses', () => {
  it('does not hand out a token that a stylesheet of the page names', () => {
    const masking = new SnapshotMasker(new AutomaticMasker(new Set()));
    const dynamic = recorded(2, 'li', { id: 'dynamic-order-999' });
    const literal = recorded(3, 'li', { id: 'lattice-ref-1' });
    masking.node(recorded(1, 'ul', {}, [recorded(4, 'style', {}, [textNode(5, '#lattice-ref-1 { color: red }')]), dynamic, literal]));

    expect(attributesOf(literal).id).toBe('lattice-ref-1');
    expect(attributesOf(dynamic).id).toMatch(/^lattice-ref-\d+$/);
    expect(attributesOf(dynamic).id).not.toBe('lattice-ref-1');
  });

  it('renames a page name spelled like a token already handed out, in a later stylesheet too', () => {
    const masking = new SnapshotMasker(new AutomaticMasker(new Set()));
    const dynamic = recorded(2, 'li', { id: 'dynamic-order-999' });
    masking.node(recorded(1, 'ul', {}, [dynamic, recorded(3, 'style', {}, [textNode(4, '.row { color: blue }')])]));
    expect(attributesOf(dynamic).id).toBe('lattice-ref-1');

    const css = masking.text(4, '#lattice-ref-1 { top: 0 }');
    const later = { id: 'lattice-ref-1' };
    masking.attributes(5, later);

    expect(later.id).toMatch(/^lattice-ref-\d+$/);
    expect(later.id).not.toBe('lattice-ref-1');
    expect(css).toBe('#' + later.id + ' { top: 0 }');
  });
});

describe('names a stylesheet selects through an attribute', () => {
  it('keeps a name that a stylesheet selects through a fragment or a list of names', () => {
    const masking = new SnapshotMasker(new AutomaticMasker(new Set()));
    const link = recorded(2, 'a', { href: '#panel', 'aria-controls': 'one two' });
    const panel = recorded(3, 'div', { id: 'panel' });
    const css = 'a[href="#panel"], [aria-controls="one two"] { top: 0 }';
    masking.node(recorded(1, 'div', {}, [recorded(4, 'style', {}, [textNode(5, css)]), link, panel]));

    expect(attributesOf(link)).toEqual({ href: '#panel', 'aria-controls': 'one two' });
    expect(attributesOf(panel).id).toBe('panel');
  });
});
