import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { findUsedCssImageUrls } from '@/sdk/css-image-usage';

type PseudoKey = 'self' | '::before' | '::after';

class FakeElement {
  shadowRoot: { styleSheets: FakeSheet[]; adoptedStyleSheets: FakeSheet[] } | null = null;
  children: FakeElement[] = [];
  private readonly shown = new Map<string, string>();
  constructor(readonly localName = 'div') {}
  setComputedImage(pseudo: PseudoKey, property: string, image: string): this {
    this.shown.set(`${pseudo}:${property}`, `url("${image}")`);
    return this;
  }
  computed(pseudo: string | null | undefined) {
    return { getPropertyValue: (property: string) => this.shown.get(`${pseudo ?? 'self'}:${property}`) ?? 'none' };
  }
  querySelectorAll(selector: string): FakeElement[] {
    return selector === '*' ? this.children : [];
  }
}

interface FakeRule {
  selectorText?: string;
  style?: { getPropertyValue(property: string): string };
  cssRules?: FakeRule[];
  start?: string;
  end?: string | null;
}

interface FakeSheet {
  cssRules: FakeRule[];
}

function declarations(values: Record<string, string>) {
  return { getPropertyValue: (property: string) => values[property] ?? '' };
}

function rule(selectorText: string, values: Record<string, string>, cssRules?: FakeRule[]): FakeRule {
  return { selectorText, style: declarations(values), cssRules };
}

const IMAGE = { 'background-image': 'url("declared.png")' };
const EXCLUDED = '[data-lattice-block]';
let elements: FakeElement[];
let matches: Map<string, FakeElement[]>;
let sheets: FakeSheet[];
let animations: { effect: { target: FakeElement; pseudoElement: string | null } }[];

function scan(): string[] {
  return [...findUsedCssImageUrls(EXCLUDED)];
}

function addElementWithBeforeImage(image: string, localName?: string): FakeElement {
  const host = new FakeElement(localName).setComputedImage('::before', 'background-image', image);
  elements.push(host);
  return host;
}

beforeEach(() => {
  elements = [];
  matches = new Map();
  sheets = [];
  animations = [];
  vi.stubGlobal('document', {
    querySelectorAll: (selector: string) => (selector === '*' ? elements : matches.get(selector) ?? []),
    get styleSheets() {
      return sheets;
    },
    adoptedStyleSheets: [],
    getAnimations: () => animations,
  });
  vi.stubGlobal('getComputedStyle', (element: FakeElement, pseudo?: string | null) => element.computed(pseudo));
});
afterEach(() => vi.unstubAllGlobals());

describe('images of the elements themselves', () => {
  it('collects every image property of every element, in document order, and nothing of an excluded region', () => {
    const first = new FakeElement().setComputedImage('self', 'background-image', 'a.png').setComputedImage('self', 'mask-image', 'b.png');
    const second = new FakeElement().setComputedImage('self', 'list-style-image', 'c.png').setComputedImage('self', 'border-image-source', 'a.png');
    const blocked = new FakeElement().setComputedImage('self', 'background-image', 'secret.png');
    const inside = new FakeElement().setComputedImage('self', 'background-image', 'inner-secret.png');
    blocked.children = [inside];
    elements.push(first, blocked, inside, second);
    matches.set(EXCLUDED, [blocked]);

    expect(scan()).toEqual(['a.png', 'b.png', 'c.png']);
  });
});

describe('images of ::before and ::after', () => {
  it.each([
    ['.badge::before', '.badge'],
    ['.badge:before', '.badge'],
    ['.list ::before', '.list *'],
    ['.list > ::before', '.list > *'],
    ['::before', '*'],
    ['.other, :is(.a, .b)::before', ' :is(.a, .b)'],
    ['a[title="x, y"]::before', 'a[title="x, y"]'],
  ])('reads the pseudo-element of what %j selects', (selectorText, hostSelector) => {
    const host = addElementWithBeforeImage('icon.png');
    matches.set(hostSelector, [host]);
    sheets.push({ cssRules: [rule(selectorText, IMAGE)] });

    expect(scan()).toEqual(['icon.png']);
  });

  it.each([
    ['a longhand', { 'mask-image': 'url("m.svg")' }],
    ['a shorthand whose value is a variable', { background: 'var(--icon)' }],
    ['a prefixed shorthand whose value is a variable', { '-webkit-mask': 'var(--icon)' }],
  ])('counts a rule that sets an image through %s', (_name, values) => {
    const host = addElementWithBeforeImage('icon.png');
    matches.set('.badge', [host]);
    sheets.push({ cssRules: [rule('.badge::before', values)] });

    expect(scan()).toEqual(['icon.png']);
  });

  it('finds rules inside conditional groups and imported stylesheets', () => {
    const grouped = addElementWithBeforeImage('grouped.png');
    const imported = addElementWithBeforeImage('imported.png');
    matches.set('.grouped', [grouped]);
    matches.set('.imported', [imported]);
    sheets.push({
      cssRules: [
        { cssRules: [{ cssRules: [rule('.grouped::before', IMAGE)] }] },
        { styleSheet: { cssRules: [rule('.imported::before', IMAGE)] } } as FakeRule,
      ],
    });

    expect(scan()).toEqual(['grouped.png', 'imported.png']);
  });

  it('leaves alone a pseudo-element that only a class name, an attribute value or an imageless rule mentions', () => {
    const host = addElementWithBeforeImage('never-declared.png');
    matches.set('.x', [host]);
    matches.set('.x\\:before', [host]);
    sheets.push({
      cssRules: [
        rule('.x\\:before', IMAGE),
        rule('.x[data-part="::before"]', IMAGE),
        rule('.x::before', { 'background-image': 'none', content: '""' }),
        rule('.x::before-custom', IMAGE),
      ],
    });

    expect(scan()).toEqual([]);
  });

  it('reads the pseudo-element an animation runs on', () => {
    const host = addElementWithBeforeImage('frame.png');
    animations.push({ effect: { target: host, pseudoElement: '::before' } }, { effect: { target: new FakeElement(), pseudoElement: null } });

    expect(scan()).toEqual(['frame.png']);
  });

  it('reads the pseudo-elements of a custom element and of its children, whose styles may be in a closed shadow tree', () => {
    const host = addElementWithBeforeImage('host.png', 'x-card');
    const slotted = addElementWithBeforeImage('slotted.png');
    host.children = [slotted];

    expect(scan()).toEqual(['host.png', 'slotted.png']);
  });
});

describe('when the stylesheets cannot tell which pseudo-elements have an image', () => {
  function expectEveryPseudoElementRead(): void {
    addElementWithBeforeImage('unlisted.png');
    expect(scan()).toContain('unlisted.png');
  }

  it('reads every pseudo-element when a stylesheet cannot be read', () => {
    sheets.push({
      get cssRules(): FakeRule[] {
        throw new DOMException('Cannot access rules', 'SecurityError');
      },
    });

    expectEveryPseudoElementRead();
  });

  it.each([
    ['is nested in another rule', (): FakeRule[] => [rule('.card', {}, [rule('&::before', IMAGE)])]],
    ['is nested under a pseudo-element rule', (): FakeRule[] => [rule('.card::before', {}, [rule('&:hover', IMAGE)])]],
    ['is scoped', (): FakeRule[] => [{ start: '.card', end: null, cssRules: [rule(':scope::before', IMAGE)] }]],
    ['is matched by a selector the browser cannot query', (): FakeRule[] => [rule('.card:unknown::before', IMAGE)]],
  ])('reads every pseudo-element when a rule with an image %s', (_name, createRules) => {
    vi.stubGlobal('document', {
      ...document,
      styleSheets: [{ cssRules: createRules() }],
      querySelectorAll: (selector: string) => {
        if (selector.includes(':unknown')) throw new DOMException('Not a valid selector', 'SyntaxError');
        return selector === '*' ? elements : [];
      },
    });

    expectEveryPseudoElementRead();
  });

  it('keeps the declarations written after a nested rule with the rule around them', () => {
    const host = addElementWithBeforeImage('trailing.png');
    matches.set('.card', [host]);
    sheets.push({ cssRules: [rule('.card::before', {}, [rule('&:hover', {}), { style: declarations(IMAGE) }])] });

    expect(scan()).toEqual(['trailing.png']);
  });

  it('reads every pseudo-element when a shadow tree gives its host an image, and none for rules that stay inside it', () => {
    const host = addElementWithBeforeImage('host.png');
    host.shadowRoot = { styleSheets: [{ cssRules: [rule('b::before', IMAGE)] }], adoptedStyleSheets: [] };
    expect(scan()).toEqual([]);

    host.shadowRoot.adoptedStyleSheets.push({ cssRules: [rule(':host::before', IMAGE)] });
    expect(scan()).toEqual(['host.png']);
  });

  it('reads every pseudo-element when the stylesheets are larger than reading the elements would cost', () => {
    sheets.push({ cssRules: Array.from({ length: 20 }, () => rule('.plain', {})) });

    expectEveryPseudoElementRead();
  });

  it('reads every pseudo-element when the browser cannot list the running animations', () => {
    vi.stubGlobal('document', { ...document, styleSheets: sheets, getAnimations: undefined });

    expectEveryPseudoElementRead();
  });
});
