import type { ElementTarget } from '@/types/feedback';
import type { CapturePolicy } from '@/lib/capture-policy';

export interface CaptureTarget {
  readonly element: HTMLElement;
  readonly target: ElementTarget;
}

const EXCLUDED_ELEMENTS = 'lattice-feedback-root, iframe, script, style, input[type="password"], [contenteditable="true"]';

export function isCapturePageAllowed(policy: CapturePolicy | null): boolean {
  return policy !== null && policy.allowedPaths.includes(window.location.pathname);
}

export function findCaptureTarget(eventTarget: EventTarget | null, policy: CapturePolicy | null): CaptureTarget | null {
  if (!policy || !isCapturePageAllowed(policy) || !(eventTarget instanceof Element)) {
    return null;
  }
  if (eventTarget.closest(EXCLUDED_ELEMENTS)) {
    return null;
  }
  for (const allowedTarget of policy.targets) {
    let element: Element | null;
    try {
      element = eventTarget.closest(allowedTarget.selector);
    } catch (error) {
      if (error instanceof DOMException && error.name === 'SyntaxError') {
        continue;
      }
      throw error;
    }
    if (!(element instanceof HTMLElement) || element.closest(EXCLUDED_ELEMENTS)) {
      continue;
    }
    const bounds = element.getBoundingClientRect();
    if (bounds.width <= 0 || bounds.height <= 0) {
      continue;
    }
    return {
      element,
      target: {
        selector: allowedTarget.selector,
        feedbackId: allowedTarget.id,
        tagName: element.tagName.toLowerCase(),
        rect: {
          x: bounds.x + window.scrollX,
          y: bounds.y + window.scrollY,
          width: bounds.width,
          height: bounds.height,
        },
      },
    };
  }
  return null;
}
