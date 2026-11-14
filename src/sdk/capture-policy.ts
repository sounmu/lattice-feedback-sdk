import {
  getGenericTargetLabel, MAX_STRUCTURAL_SELECTOR_LENGTH, TAG_NAME_PATTERN, type CapturePolicy,
} from '@/lib/capture-policy';
import type { ElementTarget } from '@/types/feedback';

export interface CaptureTarget {
  readonly element: HTMLElement;
  readonly target: ElementTarget;
}

type ConfiguredTarget = CapturePolicy['targets'][number];

// Never selectable, together with everything inside them (AGENTS.md section 5).
const EXCLUDED_TAGS = new Set(['lattice-feedback-root', 'iframe', 'script', 'style']);
const EXCLUDED_ATTRIBUTES = ['data-lattice-block', 'data-lattice-mask', 'data-lattice-overlay'];
const SECRET_INPUT_TYPES = new Set(['password', 'hidden']);
const PASSWORD_AUTOCOMPLETE_TOKENS = new Set(['current-password', 'new-password']);
const DOCUMENT_SKELETON_TAGS = new Set(['html', 'head', 'body']);

/** Without a policy every page the SDK is on is allowed. An explicit list still restricts. */
export function isCapturePageAllowed(policy: CapturePolicy | null): boolean {
  return policy === null || policy.allowedPaths.includes(window.location.pathname);
}

function isExcluded(element: Element): boolean {
  if (EXCLUDED_TAGS.has(element.localName) || EXCLUDED_ATTRIBUTES.some((name) => element.hasAttribute(name))) return true;
  // A password field switched to text by a "show" button still declares itself through autocomplete.
  const autocomplete = (element.getAttribute('autocomplete') ?? '').toLowerCase().split(/\s+/);
  if (autocomplete.some((token) => PASSWORD_AUTOCOMPLETE_TOKENS.has(token))) return true;
  return element.localName === 'input' && SECRET_INPUT_TYPES.has((element.getAttribute('type') ?? '').toLowerCase());
}

function findSelectableElement(start: Element): HTMLElement | null {
  let visual: Element | null = start;
  for (let current: Element | null = start; current; current = current.parentElement) {
    if (isExcluded(current)) return null;
    // The shapes of an icon are not boxes a pin or a drag can use, so the HTML element holding the outermost <svg> stands in.
    if (current.localName === 'svg') visual = current.parentElement;
  }
  if (!(visual instanceof HTMLElement) || DOCUMENT_SKELETON_TAGS.has(visual.localName)) return null;
  return visual;
}

function findSegment(element: Element): string | null {
  const parent = element.parentElement;
  const tag = element.localName;
  if (!parent || !TAG_NAME_PATTERN.test(tag)) return null;
  let position = 0;
  let total = 0;
  for (const sibling of Array.from(parent.children)) {
    if (sibling.localName !== tag || sibling.namespaceURI !== element.namespaceURI) continue;
    total += 1;
    if (sibling === element) position = total;
  }
  return total > 1 ? `${tag}:nth-of-type(${position})` : tag;
}

// Tag names and positions only: no ids, classes, attributes, or text can end up in the selector.
function findStructuralSelector(element: Element): string | null {
  const segments: string[] = [];
  let current: Element | null = element;
  while (current && current !== document.body) {
    const segment = findSegment(current);
    if (!segment) return null;
    segments.unshift(segment);
    current = current.parentElement;
  }
  if (!current || segments.length === 0) return null;
  const full = ['body', ...segments].join(' > ');
  if (full.length <= MAX_STRUCTURAL_SELECTOR_LENGTH) return full;
  // Too deep to spell out from <body>: keep the longest tail that fits, if it still names one element.
  for (let start = 1; start < segments.length; start += 1) {
    const tail = segments.slice(start).join(' > ');
    if (tail.length <= MAX_STRUCTURAL_SELECTOR_LENGTH) {
      return document.querySelectorAll(tail).length === 1 ? tail : null;
    }
  }
  return null;
}

function findConfiguredTarget(element: Element, policy: CapturePolicy | null, includeAncestors: boolean): ConfiguredTarget | null {
  for (const target of policy?.targets ?? []) {
    try {
      if (includeAncestors ? element.closest(target.selector) : element.matches(target.selector)) return target;
    } catch (error) {
      if (!(error instanceof DOMException && error.name === 'SyntaxError')) throw error;
    }
  }
  return null;
}

/**
 * The element under the pointer itself, never a configured ancestor in its place. A configured target
 * names the element only when the element matches its selector. Any other element is identified by structure.
 */
export function findCaptureTarget(eventTarget: EventTarget | null, policy: CapturePolicy | null): CaptureTarget | null {
  if (!isCapturePageAllowed(policy) || !(eventTarget instanceof Element)) {
    return null;
  }
  const element = findSelectableElement(eventTarget);
  if (!element) {
    return null;
  }
  const bounds = element.getBoundingClientRect();
  if (bounds.width <= 0 || bounds.height <= 0) {
    return null;
  }
  const tagName = element.localName;
  const configured = findConfiguredTarget(element, policy, false);
  const selector = configured ? configured.selector : findStructuralSelector(element);
  if (selector === null || !TAG_NAME_PATTERN.test(tagName)) {
    return null;
  }
  return {
    element,
    target: {
      selector,
      pagePath: window.location.pathname,
      feedbackId: configured ? configured.id : null,
      tagName,
      rect: {
        x: bounds.x + window.scrollX,
        y: bounds.y + window.scrollY,
        width: bounds.width,
        height: bounds.height,
      },
    },
  };
}

/** Label of a Flow event on this element: the nearest configured target's id, otherwise its tag. Never text. */
export function findFlowTargetLabel(eventTarget: EventTarget | null, policy: CapturePolicy | null): string | null {
  const found = findCaptureTarget(eventTarget, policy);
  if (!found) {
    return null;
  }
  return findConfiguredTarget(found.element, policy, true)?.id ?? getGenericTargetLabel(found.target.tagName);
}
