import type { CreateFeedbackInput, ElementTarget } from '@/types/feedback';

export interface CapturePolicy {
  readonly allowedPaths: readonly string[];
  readonly targets: readonly { readonly id: string; readonly selector: string }[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function findCapturePolicy(value: unknown): CapturePolicy | null {
  if (!isRecord(value) || !Array.isArray(value.allowedPaths) || !Array.isArray(value.targets)) {
    return null;
  }
  if (value.allowedPaths.length > 20 || value.targets.length > 50) {
    return null;
  }
  const allowedPaths: string[] = [];
  for (const path of value.allowedPaths) {
    if (typeof path !== 'string' || !path.startsWith('/') || path.length > 2048 || /[?#]/.test(path)) {
      return null;
    }
    allowedPaths.push(path);
  }
  const targets: CapturePolicy['targets'][number][] = [];
  for (const target of value.targets) {
    if (!isRecord(target) || typeof target.id !== 'string' || !/^[a-z][a-z0-9-]{0,119}$/.test(target.id)) {
      return null;
    }
    if (typeof target.selector !== 'string' || !target.selector.trim() || target.selector.length > 500) {
      return null;
    }
    if (targets.some((existing) => existing.id === target.id)) {
      return null;
    }
    targets.push({ id: target.id, selector: target.selector });
  }
  return { allowedPaths, targets };
}

export function findCapturePolicyFromJson(value: string | undefined): CapturePolicy | null {
  if (!value) return null;
  try {
    return findCapturePolicy(JSON.parse(value));
  } catch (error) {
    if (error instanceof SyntaxError) return null;
    throw error;
  }
}

export function areFeedbackAttachmentsAllowed(input: CreateFeedbackInput, policy: CapturePolicy | null): boolean {
  const comments = input.attachments?.comments ?? [];
  const edits = input.attachments?.edits ?? [];
  const flow = input.attachments?.flow;
  if (comments.length === 0 && edits.length === 0 && !flow) return true;
  if (!policy) return false;
  const page = new URL(input.page.url);
  if (page.origin !== input.hostOrigin || !policy.allowedPaths.includes(page.pathname)) return false;
  const isAllowedTarget = (target: ElementTarget): boolean =>
    /^[a-z][a-z0-9-]*$/.test(target.tagName) &&
    policy.targets.some((allowed) => allowed.id === target.feedbackId && allowed.selector === target.selector);
  if (!comments.every(({ target }) => isAllowedTarget(target)) || !edits.every(({ target }) => isAllowedTarget(target))) {
    return false;
  }
  return !flow || flow.events.every((event) =>
    policy.allowedPaths.includes(event.path) &&
    (event.type === 'navigation'
      ? event.targetLabel === null
      : policy.targets.some((target) => target.id === event.targetLabel)),
  );
}
