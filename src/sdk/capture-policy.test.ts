import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { findCapturePolicy, isStructuralSelector, type CapturePolicy } from '@/lib/capture-policy';
import { findCaptureTarget, findFlowTargetLabel, isCapturePageAllowed } from '@/sdk/capture-policy';

class FakeElement {
  parentElement: FakeElement | null = null;
  children: FakeElement[] = [];
  namespaceURI = 'fake';
  bounds = { x: 10, y: 20, width: 100, height: 40 };
  matched: string[] = [];
  constructor(readonly localName: string, private readonly attributes: Record<string, string> = {}) {}
  add<TChild extends FakeElement>(child: TChild): TChild {
    child.parentElement = this;
    this.children.push(child);
    return child;
  }
  getAttribute(name: string): string | null {
    return this.attributes[name] ?? null;
  }
  hasAttribute(name: string): boolean {
    return name in this.attributes;
  }
  matches(selector: string): boolean {
    return this.matched.includes(selector);
  }
  closest(selector: string): FakeElement | null {
    if (this.matches(selector)) return this;
    return this.parentElement?.closest(selector) ?? null;
  }
  getBoundingClientRect() {
    return this.bounds;
  }
}
class FakeHtmlElement extends FakeElement {}

const POLICY: CapturePolicy = { allowedPaths: ['/contracts'], targets: [{ id: 'register-contract', selector: 'main button' }] };
const html = (tag: string, attributes?: Record<string, string>) => new FakeHtmlElement(tag, attributes);
const find = (element: FakeElement, policy: CapturePolicy | null) => findCaptureTarget(element as unknown as EventTarget, policy);
const label = (element: FakeElement, policy: CapturePolicy | null) => findFlowTargetLabel(element as unknown as EventTarget, policy);
let body: FakeHtmlElement;
let queryAll: ReturnType<typeof vi.fn>;

beforeEach(() => {
  body = html('html').add(html('body'));
  queryAll = vi.fn(() => []);
  vi.stubGlobal('Element', FakeElement);
  vi.stubGlobal('HTMLElement', FakeHtmlElement);
  vi.stubGlobal('window', { location: { pathname: '/contracts' }, scrollX: 0, scrollY: 5 });
  vi.stubGlobal('document', { body, querySelectorAll: queryAll });
});
afterEach(() => vi.unstubAllGlobals());

describe('capture policy boundary', () => {
  it('allows only the explicitly configured pathname', () => {
    const policy = findCapturePolicy({
      allowedPaths: ['/contracts'],
      targets: [{ id: 'register-contract', selector: 'main button' }],
    });
    vi.stubGlobal('window', { location: { pathname: '/contracts' } });
    expect(isCapturePageAllowed(policy)).toBe(true);

    vi.stubGlobal('window', { location: { pathname: '/contracts/private' } });
    expect(isCapturePageAllowed(policy)).toBe(false);
    expect(isCapturePageAllowed(null)).toBe(true);
  });

  it.each([
    undefined,
    {},
    { allowedPaths: ['https://host.example/'], targets: [] },
    { allowedPaths: ['/contracts?token=secret'], targets: [] },
    { allowedPaths: ['/contracts#private'], targets: [] },
    { allowedPaths: ['/'], targets: [{ id: 'valid', selector: '' }] },
    { allowedPaths: ['/'], targets: [{ id: 'customer@example.com', selector: 'button' }] },
    { allowedPaths: ['/'], targets: [{ id: 'same', selector: 'button' }, { id: 'same', selector: 'input' }] },
    { allowedPaths: Array.from({ length: 21 }, () => '/'), targets: [] },
    { allowedPaths: ['/'], targets: Array.from({ length: 51 }, (_, index) => ({ id: `target-${index}`, selector: 'button' })) },
  ])('rejects missing, sensitive, ambiguous, or oversized configuration: %j', (value) => {
    expect(findCapturePolicy(value)).toBeNull();
  });

  it('copies configuration so caller mutation cannot broaden captured pages', () => {
    const input = { allowedPaths: ['/contracts'], targets: [{ id: 'register', selector: 'button' }] };
    const policy = findCapturePolicy(input);
    input.allowedPaths.push('/private');
    input.targets[0].selector = '*';
    vi.stubGlobal('window', { location: { pathname: '/private' } });

    expect(isCapturePageAllowed(policy)).toBe(false);
    expect(policy?.targets[0].selector).toBe('button');
  });
});

describe('generic element selection', () => {
  it('selects the clicked element itself, not the configured target around it', () => {
    const button = body.add(html('main')).add(html('button'));
    button.matched = ['main button'];
    const text = button.add(html('span'));

    expect(find(text, POLICY)).toEqual({
      element: text,
      target: {
        selector: 'body > main > button > span', pagePath: '/contracts', feedbackId: null, tagName: 'span',
        rect: { x: 10, y: 25, width: 100, height: 40 },
      },
    });
    expect(find(button, POLICY)?.target).toMatchObject({ selector: 'main button', feedbackId: 'register-contract' });
    expect(find(button, null)?.target).toMatchObject({ selector: 'body > main > button', feedbackId: null });
  });

  it('tells same-tag siblings apart by position only', () => {
    const list = body.add(html('ul'));
    list.add(html('li'));
    list.add(html('div'));
    const second = list.add(html('li', { id: 'customer-42', class: 'vip' }));
    const selector = find(second, null)?.target.selector ?? '';

    expect(selector).toBe('body > ul > li:nth-of-type(2)');
    expect(isStructuralSelector(selector, 'li')).toBe(true);
  });

  it('falls back to a unique tail when the full path would exceed 500 characters', () => {
    let deepest: FakeElement = body;
    for (let depth = 0; depth < 70; depth += 1) deepest = deepest.add(html('section'));
    queryAll.mockReturnValue([deepest]);
    const selector = find(deepest, null)?.target.selector ?? '';

    expect(selector).toHaveLength(497);
    expect(isStructuralSelector(selector, 'section')).toBe(true);
    expect(queryAll).toHaveBeenCalledWith(selector);
    queryAll.mockReturnValue([deepest, deepest]);
    expect(find(deepest, null)).toBeNull();
  });

  it.each<[string, (root: FakeElement) => FakeElement]>([
    ['the SDK root', (root) => root.add(html('lattice-feedback-root'))],
    ['a selection overlay', (root) => root.add(html('div', { 'data-lattice-overlay': 'selection' }))],
    ['a script', (root) => root.add(html('script'))],
    ['a style sheet', (root) => root.add(html('style'))],
    ['a password input', (root) => root.add(html('input', { type: 'PASSWORD' }))],
    ['a revealed password input', (root) => root.add(html('input', { type: 'text', autocomplete: 'section-login current-password' }))],
    ['a hidden input', (root) => root.add(html('input', { type: 'hidden' }))],
    ['content inside a blocked area', (root) => root.add(html('section', { 'data-lattice-block': '' })).add(html('p'))],
    ['content inside a masked area', (root) => root.add(html('section', { 'data-lattice-mask': '' })).add(html('p'))],
    ['the body', (root) => root],
    ['the document element', (root) => root.parentElement ?? root],
  ])('never selects %s', (_name, build) => {
    expect(find(build(body), null)).toBeNull();
  });

  it('selects ordinary inputs, skips invisible elements, and respects an explicit page list', () => {
    const input = body.add(html('input', { type: 'text', autocomplete: 'username' }));
    expect(find(input, null)?.target.tagName).toBe('input');

    window.location.pathname = '/private';
    expect(find(input, POLICY)).toBeNull();
    expect(find(input, null)).not.toBeNull();
    input.bounds = { x: 0, y: 0, width: 0, height: 40 };
    expect(find(input, null)).toBeNull();
  });

  it('selects the HTML element holding an icon when a shape inside the icon is clicked', () => {
    const button = body.add(html('button'));
    const shape = button.add(new FakeElement('svg')).add(new FakeElement('g')).add(new FakeElement('path'));

    expect(find(shape, null)?.element).toBe(button);
    expect(find(shape, null)?.target).toMatchObject({ selector: 'body > button', tagName: 'button' });
  });

  it('labels Flow events with the nearest configured target, else a tag from the fixed list', () => {
    const button = body.add(html('button'));
    button.matched = ['main button'];

    expect(label(button.add(html('span')), POLICY)).toBe('register-contract');
    expect(label(body.add(html('div')), POLICY)).toBe('div');
    expect(label(body.add(html('x-date-picker')), null)).toBe('element');
    expect(label(body.add(html('input', { type: 'password' })), null)).toBeNull();
  });
});
