import { describe, expect, it } from 'vitest';
import { AutomaticMasker } from '@/sdk/automatic-masking';
import type { SnapshotNode } from '@/sdk/snapshot-assets';
import { SnapshotMasker } from '@/sdk/snapshot-masking';
import { findCssNames, rewriteReferences } from '@/sdk/structural-references';

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

  it('finds what a stylesheet spells out', () => {
    expect([...findCssNames('#a\\:b{} ::part(x y){} [data-k=v]{} [role="tab" i]{} a[href^=\'/x\']{}')].sort())
      .toEqual(['/x', 'a:b', 'tab', 'v', 'x', 'y']);
  });
});
