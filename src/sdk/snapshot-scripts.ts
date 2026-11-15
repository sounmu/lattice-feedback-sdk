// Script contents are never collected (AGENTS.md section 5). rrweb drops <script> elements;
// inline event handlers, javascript: URLs and iframe srcdoc markup carry script too, so they
// are removed from the serialized snapshot before it leaves the page.
import type { SnapshotNode } from '@/sdk/snapshot-assets';

const EVENT_HANDLER_ATTRIBUTE_PATTERN = /^on/i;
const LAST_IGNORED_URL_CHARACTER = 0x20;
const SCRIPT_URL_SCHEME = 'javascript:';
const UPPER_CASE_A = 65;
const UPPER_CASE_Z = 90;
const LOWER_CASE_OFFSET = 32;
const INLINE_DOCUMENT_ATTRIBUTE = 'srcdoc';

function isScriptUrl(value: string): boolean {
  // Browsers skip whitespace and control characters when they read a URL scheme. Only the scheme is read here,
  // so a whole stylesheet or data: URL is not copied to look at its first characters.
  let matched = 0;
  for (let at = 0; at < value.length && matched < SCRIPT_URL_SCHEME.length; at += 1) {
    const code = value.charCodeAt(at);
    if (code <= LAST_IGNORED_URL_CHARACTER) continue;
    // An ASCII capital is the only character that lower-cases to a letter of the scheme.
    const lowerCased = code >= UPPER_CASE_A && code <= UPPER_CASE_Z ? code + LOWER_CASE_OFFSET : code;
    if (lowerCased !== SCRIPT_URL_SCHEME.charCodeAt(matched)) return false;
    matched += 1;
  }
  return matched === SCRIPT_URL_SCHEME.length;
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
