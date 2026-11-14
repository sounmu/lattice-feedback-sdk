import { describe, expect, it } from 'vitest';
import {
  AutomaticMasker, classifyText, extractScriptLiterals, maskText, normalizeStaticText, shouldIndexScriptLiteral,
} from '@/sdk/automatic-masking';
import { SnapshotMasker } from '@/sdk/snapshot-masking';
import type { SnapshotNode } from '@/sdk/snapshot-assets';

describe('automatic text masking', () => {
  it('keeps normalized proven static text and masks unknown values including punctuation and digits', () => {
    const masker = new AutomaticMasker(new Set(['Order total']));
    expect(masker.text(' Order\n total ')).toBe(' Order\n total ');
    expect(masker.text('Mina Park: $12.50')).toBe('●●●● ●●●●● ●●●●●●');
    expect(classifyText('unavailable', new Set())).toBe('data');
    expect(masker.maskedValues).toBe(1);
  });

  it('preserves whitespace and UTF-16 length without preserving digit or punctuation shape', () => {
    expect(maskText('A-12\t😀\n B')).toBe('●●●●\t●●\n ●');
    expect(maskText('')).toBe('');
  });

  it('requires opt-in for commented text and gives forced masking precedence over every exemption', () => {
    const defaultMasker = new AutomaticMasker(new Set());
    const optedIn = new AutomaticMasker(new Set(), { keepCommentedText: true });
    expect(defaultMasker.text('Jane', { commented: true })).toBe('●●●●');
    expect(optedIn.text('Jane', { commented: true })).toBe('Jane');
    expect(optedIn.text('Jane', { commented: true, safe: true, forced: true })).toBe('●●●●');
    expect(new AutomaticMasker(new Set(), { enabled: false }).text('Jane', { forced: true })).toBe('●●●●');
  });

  it('indexes i18n literals and adjacent string concatenation without evaluating expressions', () => {
    const known = new Set(extractScriptLiterals(`const t={save:"Save",total:'Order ' + 'total',escaped:"caf\\u00e9"}; const x=\`Hello \${name}\`;`).map(normalizeStaticText));
    expect(classifyText('Order total', known)).toBe('static');
    expect(classifyText('café', known)).toBe('static');
    expect(classifyText('Save', known)).toBe('static');
    expect(classifyText('Hello Jane', known)).toBe('data');
  });

  it('keeps finding literals after an apostrophe in a comment and never lets digit-only literals prove static text', () => {
    const literals = extractScriptLiterals(`// don't break\nconst label = "Order list"; const amount = "12,000";`);
    expect(literals).toContain('Order list');
    expect(shouldIndexScriptLiteral('Order list')).toBe(true);
    expect(shouldIndexScriptLiteral('A-12')).toBe(true);
    expect(shouldIndexScriptLiteral('12,000')).toBe(false);
    expect(shouldIndexScriptLiteral('₩')).toBe(true);
  });

  it('leaves class names alone so layout survives while masking other identifying attributes', () => {
    const tree: SnapshotNode = { type: 2, id: 1, tagName: 'div', attributes: { class: 'btn btn-primary', id: 'row-4821' } };
    new SnapshotMasker(new AutomaticMasker(new Set())).node(tree);
    expect(tree.attributes).toEqual({ class: 'btn btn-primary', id: '●●●●●●●●' });
  });

  it('exempts only direct text of the commented element while masking descendant and attribute values', () => {
    const tree: SnapshotNode = {
      type: 2, id: 1, tagName: 'div', attributes: { title: 'Jane' },
      childNodes: [
        { type: 3, id: 2, textContent: 'Jane' },
        { type: 2, id: 3, tagName: 'span', childNodes: [{ type: 3, id: 4, textContent: 'Salary' }] },
      ],
    };
    new SnapshotMasker(new AutomaticMasker(new Set(), { keepCommentedText: true }), new Set([1])).node(tree);
    expect(tree.attributes?.title).toBe('●●●●');
    expect(tree.childNodes?.[0].textContent).toBe('Jane');
    expect(tree.childNodes?.[1].childNodes?.[0].textContent).toBe('●●●●●●');
  });

  it('masks new Flow text and attribute values using inherited exclusions', () => {
    const masker = new SnapshotMasker(new AutomaticMasker(new Set(['Total'])));
    masker.node({ type: 2, id: 1, tagName: 'div', attributes: { 'data-lattice-mask': '' }, childNodes: [{ type: 3, id: 2, textContent: 'Total' }] });
    expect(masker.text(2, 'Total')).toBe('●●●●●');
    expect(masker.text(99, 'NEW-792')).toBe('●●●●●●●');
    const attributes = { title: 'NEW-792', 'data-account': 'NEW-792' };
    masker.attributes(1, attributes);
    expect(attributes).toEqual({ title: '●●●●●●●', 'data-account': '●●●●●●●' });
  });

  it('honors safe subtrees but masks passwords and a mask added later on their parent', () => {
    const masker = new SnapshotMasker(new AutomaticMasker(new Set(['Total'])));
    const tree: SnapshotNode = { type: 2, id: 1, tagName: 'section', attributes: { 'data-lattice-keep': '' }, childNodes: [
      { type: 3, id: 2, textContent: 'Public' },
      { type: 2, id: 3, tagName: 'input', attributes: { type: 'text', autocomplete: 'current-password', value: 'SECRET' } },
    ] };
    masker.node(tree);
    expect(tree.childNodes?.[0].textContent).toBe('Public');
    expect(tree.childNodes?.[1].attributes?.value).toBe('●●●●●●');
    masker.attributes(1, { 'data-lattice-mask': '' });
    expect(masker.text(2, 'Total')).toBe('●●●●●');
  });
});
