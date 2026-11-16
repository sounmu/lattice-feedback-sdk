import { afterEach, expect, it, vi } from 'vitest';
import { FeedbackSdk } from '@/sdk/feedback-sdk';
import { MemoryStorage } from '@/sdk/flow-test-fixtures';

const APP_ORIGIN = 'https://app.example.com';
const HOST_ORIGIN = 'https://customer.example.com';

class FakeElement {
  readonly children: FakeElement[] = [];
  readonly attributes = new Map<string, string>();
  readonly classList = { add: vi.fn() };
  src = '';
  private readonly listeners = new Map<string, () => void>();
  constructor(readonly tagName: string) {}
  setAttribute(name: string, value: string): void {
    this.attributes.set(name, value);
  }
  attachShadow(): FakeElement {
    return new FakeElement('shadow-root');
  }
  append(...nodes: FakeElement[]): void {
    this.children.push(...nodes);
  }
  appendChild(node: FakeElement): void {
    this.children.push(node);
  }
  addEventListener(type: string, listener: () => void): void {
    this.listeners.set(type, listener);
  }
  focus(): void {
    this.attributes.set('focused', 'true');
  }
  click(): void {
    this.listeners.get('click')?.();
  }
}

function stubPage() {
  const elements: FakeElement[] = [];
  const createElement = (tagName: string) => {
    const element = new FakeElement(tagName);
    elements.push(element);
    return element;
  };
  const storage = new MemoryStorage();
  vi.stubGlobal('document', {
    body: new FakeElement('body'), createElement,
    createElementNS: (_namespace: string, tagName: string) => createElement(tagName),
  });
  vi.stubGlobal('window', {
    location: { origin: HOST_ORIGIN, pathname: '/orders' },
    history: { pushState: vi.fn(), replaceState: vi.fn() },
    sessionStorage: storage,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  });
  return { storage, findElement: (tagName: string) => elements.find((element) => element.tagName === tagName) };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

it('opens the widget from the launcher when session storage cannot be read', () => {
  const { storage, findElement } = stubPage();
  storage.failReads = true;
  const sdk = new FeedbackSdk(APP_ORIGIN);

  sdk.init({ projectKey: 'demo' });
  findElement('button')?.click();

  expect(findElement('button')?.attributes.get('aria-expanded')).toBe('true');
  expect(findElement('iframe')?.src).toContain(`${APP_ORIGIN}/widget?projectKey=demo`);
});
