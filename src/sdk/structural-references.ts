// Names that point at other nodes of the saved screen are structure, not displayed text. Masking one of them
// on its own breaks the link (a filter whose id was masked while url(#id) was not). Every attribute that
// declares or uses such a name goes through the same per-token decision instead, so a name either stays or
// becomes the same opaque token on both sides.

type ReferenceKind = 'name' | 'names' | 'parts' | 'target';

const REFERENCE_ATTRIBUTES: ReadonlyMap<string, ReferenceKind> = new Map<string, ReferenceKind>([
  // A name this element declares, or exactly one name it points at.
  ['id', 'name'], ['name', 'name'], ['slot', 'name'], ['for', 'name'], ['form', 'name'], ['list', 'name'],
  ['aria-activedescendant', 'name'], ['popovertarget', 'name'], ['commandfor', 'name'], ['anchor', 'name'],
  // Space separated lists of names.
  ['aria-labelledby', 'names'], ['aria-describedby', 'names'], ['aria-controls', 'names'], ['aria-owns', 'names'],
  ['aria-flowto', 'names'], ['aria-details', 'names'], ['aria-errormessage', 'names'], ['headers', 'names'],
  ['itemref', 'names'], ['part', 'names'],
  ['exportparts', 'parts'],
  ['target', 'target'],
]);
// Attributes whose value is a URL that can be a same-document fragment.
const FRAGMENT_ATTRIBUTES = new Set(['href', 'xlink:href', 'usemap']);
const TARGET_KEYWORDS = new Set(['_blank', '_self', '_parent', '_top']);
const URL_REFERENCE = /url\(\s*(["']?)#([^"')\s]+)\1\s*\)/g;
// #id, ::part(name) and [attribute=value] selectors: a page's stylesheet names these literally.
const CSS_NAME = /#((?:\\.|[\w\u00a1-\uffff-])+)|::part\(([^)]*)\)|\[[^\]=~|^$*\s]+\s*[~|^$*]?=\s*(?:"([^"]*)"|'([^']*)'|([^\s\]]+))/g;

export type TokenRemapper = (token: string) => string;

function decodeFragment(fragment: string): string {
  try {
    return decodeURIComponent(fragment);
  } catch {
    return fragment;
  }
}

function remapFragment(fragment: string, remap: TokenRemapper): string {
  const decoded = decodeFragment(fragment);
  const mapped = remap(decoded);
  return mapped === decoded ? fragment : mapped;
}

/** Names and attribute values that stylesheet text mentions literally. Such a value is part of the page's code. */
export function findCssNames(cssText: string): Set<string> {
  const names = new Set<string>();
  for (const match of cssText.matchAll(CSS_NAME)) {
    if (match[1] !== undefined) names.add(match[1].replace(/\\(.)/g, '$1'));
    if (match[2] !== undefined) match[2].split(/\s+/).filter(Boolean).forEach((part) => names.add(part));
    const value = match[3] ?? match[4] ?? match[5];
    if (value !== undefined) names.add(value);
  }
  return names;
}

/** The value with every name in it passed through remap. Values that name nothing come back unchanged. */
export function rewriteReferences(attribute: string, value: string, remap: TokenRemapper): string {
  const lower = attribute.toLowerCase();
  const kind = REFERENCE_ATTRIBUTES.get(lower);
  let result = value;
  if (kind === 'name') {
    result = remap(value);
  } else if (kind === 'names') {
    result = value.replace(/\S+/g, remap);
  } else if (kind === 'parts') {
    result = value.replace(/[^\s,:]+/g, remap);
  } else if (kind === 'target') {
    result = TARGET_KEYWORDS.has(value) ? value : remap(value);
  } else if (FRAGMENT_ATTRIBUTES.has(lower) && value.startsWith('#')) {
    result = `#${remapFragment(value.slice(1), remap)}`;
  }
  // Serialized stylesheet text starts with an underscore (_cssText); its names were kept by the same rule.
  if (!lower.startsWith('_') && result.includes('url(')) {
    result = result.replace(URL_REFERENCE, (_match, quote: string, fragment: string) => `url(${quote}#${remapFragment(fragment, remap)}${quote})`);
  }
  return result;
}
