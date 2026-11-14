import type { CreateFeedbackInput, ElementTarget } from '@/types/feedback';

export interface CapturePolicy {
  readonly allowedPaths: readonly string[];
  readonly targets: readonly { readonly id: string; readonly selector: string }[];
  readonly automaticMasking?: {
    readonly enabled?: boolean;
    readonly keepCommentedText?: boolean;
  };
}

export const MAX_STRUCTURAL_SELECTOR_LENGTH = 500;
/** Tag names as the SDK reports them. The pattern leaves no room for text, ids, or attribute values. */
export const TAG_NAME_PATTERN = /^[a-z][a-z0-9-]*$/;

const MAX_PATH_LENGTH = 2048;
const STRUCTURAL_SEGMENT = '[a-z][a-z0-9-]*(?::nth-of-type\\([1-9][0-9]{0,5}\\))?';
const STRUCTURAL_SELECTOR_PATTERN = new RegExp(`^(?:body > )?${STRUCTURAL_SEGMENT}(?: > ${STRUCTURAL_SEGMENT})*$`);
const GENERIC_TARGET_FALLBACK_LABEL = 'element';
const GENERIC_TARGET_TAGS = new Set((
  'a abbr address article aside audio b blockquote button canvas caption code dd details dialog div dl dt em ' +
  'fieldset figcaption figure footer form h1 h2 h3 h4 h5 h6 header hr i img input label legend li main mark menu ' +
  'nav ol optgroup option p picture pre progress section select small span strong sub summary sup table tbody td ' +
  'textarea tfoot th thead time tr u ul video'
).split(' '));

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** True for a selector made only of tag names and positions that ends at the given tag. */
export function isStructuralSelector(selector: string, tagName: string): boolean {
  if (selector.length > MAX_STRUCTURAL_SELECTOR_LENGTH || !STRUCTURAL_SELECTOR_PATTERN.test(selector)) return false;
  return selector.slice(selector.lastIndexOf(' ') + 1).split(':')[0] === tagName;
}

/** Flow label of an element no configured target names: its tag, or 'element' for tags outside the fixed list. */
export function getGenericTargetLabel(tagName: string): string {
  return GENERIC_TARGET_TAGS.has(tagName) ? tagName : GENERIC_TARGET_FALLBACK_LABEL;
}

/** The labels getGenericTargetLabel can produce. The list is fixed, so a label can never carry page text. */
export function isGenericTargetLabel(label: unknown): label is string {
  return typeof label === 'string' && (label === GENERIC_TARGET_FALLBACK_LABEL || GENERIC_TARGET_TAGS.has(label));
}

// A pathname on the host origin: '//host/path' would point at another origin.
function isSameOriginPath(path: string): boolean {
  return path.startsWith('/') && !path.startsWith('//') && path.length <= MAX_PATH_LENGTH && !/[?#\\]/.test(path);
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
  if (value.automaticMasking !== undefined) {
    const masking = value.automaticMasking;
    if (!isRecord(masking) ||
      (masking.enabled !== undefined && typeof masking.enabled !== 'boolean') ||
      (masking.keepCommentedText !== undefined && typeof masking.keepCommentedText !== 'boolean')) return null;
    return { allowedPaths, targets, automaticMasking: {
      enabled: masking.enabled, keepCommentedText: masking.keepCommentedText,
    } };
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

// No configured restriction is different from an explicitly malformed restriction.
export function resolveCapturePolicyFromJson(value: string | undefined): CapturePolicy | null {
  if (!value?.trim()) return null;
  return findCapturePolicyFromJson(value) ?? { allowedPaths: [], targets: [] };
}

export function areFeedbackAttachmentsAllowed(input: CreateFeedbackInput, policy: CapturePolicy | null): boolean {
  const comments = input.attachments?.comments ?? [];
  const edits = input.attachments?.edits ?? [];
  const flow = input.attachments?.flow;
  if (comments.length === 0 && edits.length === 0 && !flow) return true;
  const page = new URL(input.page.url);
  // Without a policy every page of the host origin is allowed. An explicit list still restricts.
  const isAllowedPath = (path: string): boolean => (policy ? policy.allowedPaths.includes(path) : isSameOriginPath(path));
  if (page.origin !== input.hostOrigin || !isAllowedPath(page.pathname)) return false;
  const isConfiguredId = (id: string | null): boolean => {
    if (!policy) return typeof id === 'string' && /^[a-z][a-z0-9-]{0,119}$/.test(id);
    return policy.targets.some((target) => target.id === id);
  };
  const isAllowedTarget = (target: ElementTarget): boolean => {
    if (!TAG_NAME_PATTERN.test(target.tagName) || !isAllowedPath(target.pagePath ?? page.pathname)) return false;
    // Unnamed targets use structure. An explicit server policy still validates configured labels;
    // without one, the SDK's optional labels must not disable otherwise allowed captures.
    if (target.feedbackId === null) return isStructuralSelector(target.selector, target.tagName);
    if (!policy) return isConfiguredId(target.feedbackId);
    return policy?.targets.some((allowed) => allowed.id === target.feedbackId && allowed.selector === target.selector) ?? false;
  };
  if (!comments.every(({ target }) => isAllowedTarget(target)) || !edits.every(({ target }) => isAllowedTarget(target))) {
    return false;
  }
  return !flow || flow.events.every((event) => {
    if (!isAllowedPath(event.path)) return false;
    if (event.type === 'navigation') return event.targetLabel === null;
    return isGenericTargetLabel(event.targetLabel) || isConfiguredId(event.targetLabel);
  });
}
