import { vi } from 'vitest';

type Listener = (event: FakeEvent) => void;

export interface FakeEvent {
  type: string;
  target: unknown;
  button: number;
  pointerId: number;
  clientX: number;
  clientY: number;
  key: string;
  preventDefault: ReturnType<typeof vi.fn>;
  stopPropagation: ReturnType<typeof vi.fn>;
  stopImmediatePropagation: ReturnType<typeof vi.fn>;
}

function isCapture(options: unknown): boolean {
  if (typeof options === 'boolean') {
    return options;
  }
  return typeof options === 'object' && options !== null && 'capture' in options && options.capture === true;
}

export class FakeEventTarget {
  private readonly listeners: { type: string; listener: Listener; capture: boolean }[] = [];

  addEventListener(type: string, listener: Listener, options?: unknown): void {
    this.listeners.push({ type, listener, capture: isCapture(options) });
  }

  removeEventListener(type: string, listener: Listener, options?: unknown): void {
    const index = this.listeners.findIndex(
      (entry) => entry.type === type && entry.listener === listener && entry.capture === isCapture(options),
    );
    if (index >= 0) {
      this.listeners.splice(index, 1);
    }
  }

  dispatch(event: FakeEvent): void {
    for (const entry of this.listeners.filter((candidate) => candidate.type === event.type)) {
      entry.listener(event);
    }
  }

  get listenerCount(): number {
    return this.listeners.length;
  }
}

export class FakeElement extends FakeEventTarget {
  readonly attributes = new Map<string, string>();
  readonly style: Record<string, string> = {};
  readonly children: FakeElement[] = [];
  parent: FakeElement | null = null;
  textContent = '';
  bounds = { left: 0, top: 0, width: 0, height: 0 };
  setPointerCapture = vi.fn();

  constructor(readonly tagName: string) {
    super();
  }

  setAttribute(name: string, value: string): void {
    this.attributes.set(name, value);
  }

  getAttribute(name: string): string | null {
    return this.attributes.get(name) ?? null;
  }

  appendChild(child: FakeElement): void {
    child.parent = this;
    this.children.push(child);
  }

  remove(): void {
    if (this.parent) {
      this.parent.children.splice(this.parent.children.indexOf(this), 1);
      this.parent = null;
    }
  }

  contains(node: FakeElement): boolean {
    for (let current: FakeElement | null = node; current; current = current.parent) {
      if (current === this) {
        return true;
      }
    }
    return false;
  }

  getBoundingClientRect() {
    return { ...this.bounds, x: this.bounds.left, y: this.bounds.top };
  }

  get allText(): string {
    return [this.textContent, ...this.children.map((child) => child.allText)].join(' ');
  }
}

export function createEvent(type: string, overrides: Partial<FakeEvent> = {}): FakeEvent {
  return {
    type,
    target: null,
    button: 0,
    pointerId: 1,
    clientX: 0,
    clientY: 0,
    key: '',
    preventDefault: vi.fn(),
    stopPropagation: vi.fn(),
    stopImmediatePropagation: vi.fn(),
    ...overrides,
  };
}
