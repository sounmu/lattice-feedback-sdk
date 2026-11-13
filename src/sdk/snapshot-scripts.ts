// Script contents are never collected (AGENTS.md section 5). rrweb drops <script> elements;
// inline event handlers, javascript: URLs and iframe srcdoc markup carry script too, so they
// are removed from the serialized snapshot before it leaves the page.
import type { SnapshotNode } from '@/sdk/snapshot-assets';

const EVENT_HANDLER_ATTRIBUTE_PATTERN = /^on/i;
const IGNORED_URL_CHARACTERS_PATTERN = /[\u0000-\u0020]/g;
const SCRIPT_URL_SCHEME = 'javascript:';
const INLINE_DOCUMENT_ATTRIBUTE = 'srcdoc';

function isScriptUrl(value: string): boolean {
  // Browsers skip whitespace and control characters when they read a URL scheme.
  return value.replace(IGNORED_URL_CHARACTERS_PATTERN, '').toLowerCase().startsWith(SCRIPT_URL_SCHEME);
}

export function removeInlineScripts(root: SnapshotNode): void {
  const attributes = root.attributes;
  if (attributes) {
    for (const [name, value] of Object.entries(attributes)) {
      const isScript =
        EVENT_HANDLER_ATTRIBUTE_PATTERN.test(name) ||
        name.toLowerCase() === INLINE_DOCUMENT_ATTRIBUTE ||
        (typeof value === 'string' && isScriptUrl(value));
      if (isScript) {
        delete attributes[name];
      }
    }
  }
  root.childNodes?.forEach(removeInlineScripts);
}
