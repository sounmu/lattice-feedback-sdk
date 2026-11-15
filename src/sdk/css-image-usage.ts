// Which CSS images the captured part of the page shows: every url() in the computed background, border image,
// list marker and mask of each element and of its ::before and ::after. Elements in an excluded region are
// skipped, so a stylesheet shared with them cannot carry their images into the saved screen.
//
// Reading the computed style of a pseudo-element is the costly part: several microseconds, twice for every
// element, and hardly any has an image. A pseudo-element gets an image of its own only from a rule that names
// it or from an animation on it; what it inherits, its element shows too. So the stylesheets are read first and
// the pseudo-elements of every other element are left alone. Where the stylesheets cannot tell (one that cannot
// be read, a nested or scoped rule, a shadow tree styling its host) every element's are read. A custom element
// may hide its styles in a closed shadow tree, so its own and its children's are always read. Other styles the
// page cannot see, a closed shadow tree on a built-in element or a browser extension, are not taken into account.

const CSS_IMAGE_PROPERTIES = ['background-image', 'border-image-source', 'list-style-image', 'mask-image'] as const;
// A shorthand written with var() leaves its longhands empty until the value is computed.
const CSS_IMAGE_SHORTHANDS = ['background', 'border-image', '-webkit-border-image', 'list-style', 'mask', '-webkit-mask'] as const;
const CSS_IMAGE_URL_PATTERN = /url\(\s*"([^"]*)"\s*\)/g;
const PSEUDO_ELEMENTS = ['::before', '::after'] as const;
const PSEUDO_ELEMENT_PATTERN = /::?(before|after)(?![\w-])/gi;
const NAMES_PSEUDO_ELEMENT = /::?(?:before|after)(?![\w-])/i;
const ANIMATED_PSEUDO_ELEMENT = /^::?(before|after)$/i;
// A rule of a shadow tree reaches the document only through the host of the tree and what is slotted into it.
const REACHES_DOCUMENT = /:host|::slotted/i;
// Reading a rule costs about a tenth of reading both pseudo-elements of one element, and a selector query walks
// the whole document. Past these the stylesheets cost more to read than they save.
const MAX_RULES_PER_ELEMENT = 6;
const MAX_HOST_SELECTORS = 64;

type PseudoElement = (typeof PSEUDO_ELEMENTS)[number];

/** The elements whose pseudo-element may have an image of its own. */
interface PseudoHosts {
  readonly selectors: Set<string>;
  readonly elements: Set<Element>;
  /** True when the stylesheets cannot narrow it down, so every element's pseudo-element is read. */
  isEvery: boolean;
}

type PseudoHostMap = Record<PseudoElement, PseudoHosts>;

interface RuleScope {
  readonly parentSelector?: string;
  /** False where a selector cannot be matched from the document as it is written. */
  readonly isNarrowable: boolean;
  readonly isShadowTree: boolean;
}

interface RuleReader {
  readonly hosts: PseudoHostMap;
  remainingRules: number;
}

/** The parts of the CSS rule interfaces read here. Older browsers have no rules nested in a style rule. */
interface StyleRule extends CSSRule {
  readonly selectorText: string;
  readonly style: CSSStyleDeclaration;
  readonly cssRules?: CSSRuleList;
}

function isStyleRule(rule: CSSRule): rule is StyleRule {
  return 'selectorText' in rule && 'style' in rule;
}

function isImportRule(rule: CSSRule): rule is CSSImportRule {
  return 'styleSheet' in rule;
}

function hasStyle(rule: CSSRule): rule is CSSRule & Pick<StyleRule, 'style'> {
  return 'style' in rule;
}

function hasRules(rule: CSSRule): rule is CSSRule & { readonly cssRules: CSSRuleList } {
  return 'cssRules' in rule;
}

// Only @scope has a start and an end: its selectors are matched from the scope, not from the document.
function isScopeRule(rule: CSSRule): boolean {
  return 'start' in rule && 'end' in rule;
}

function isKeyframeEffect(effect: AnimationEffect | null): effect is KeyframeEffect {
  return effect !== null && 'pseudoElement' in effect && 'target' in effect;
}

function createHosts(isEvery: boolean): PseudoHostMap {
  return {
    '::before': { selectors: new Set(), elements: new Set(), isEvery },
    '::after': { selectors: new Set(), elements: new Set(), isEvery },
  };
}

function declaresImage(style: CSSStyleDeclaration): boolean {
  const hasImage = CSS_IMAGE_PROPERTIES.some((property) => {
    const value = style.getPropertyValue(property);
    return value !== '' && value !== 'none';
  });
  return hasImage || CSS_IMAGE_SHORTHANDS.some((shorthand) => style.getPropertyValue(shorthand).includes('var('));
}

/** The selector with what is inside brackets, parentheses, strings and escapes blanked out, at the same positions. */
function outlineSelector(selectorText: string): string {
  let outline = '';
  let depth = 0;
  let quote = '';
  for (let at = 0; at < selectorText.length; at += 1) {
    const character = selectorText[at];
    if (character === '\\') {
      outline += '__';
      at += 1;
    } else if (quote) {
      if (character === quote) quote = '';
      outline += '_';
    } else if (character === '"' || character === "'") {
      quote = character;
      outline += '_';
    } else if (character === '(' || character === '[') {
      depth += 1;
      outline += '_';
    } else if (character === ')' || character === ']') {
      depth = Math.max(0, depth - 1);
      outline += '_';
    } else {
      outline += depth > 0 ? '_' : character;
    }
  }
  return outline;
}

/** For each pseudo-element, selectors of the elements a selector list gives that pseudo-element to. */
function findHostSelectors(selectorText: string): Record<PseudoElement, string[]> {
  const hostSelectors: Record<PseudoElement, string[]> = { '::before': [], '::after': [] };
  const outline = outlineSelector(selectorText);
  let start = 0;
  for (let end = 0; end <= outline.length; end += 1) {
    if (end < outline.length && outline[end] !== ',') continue;
    for (const match of outline.slice(start, end).matchAll(PSEUDO_ELEMENT_PATTERN)) {
      const host = selectorText.slice(start, start + match.index);
      const pseudoElement = match[1].toLowerCase() === 'before' ? '::before' : '::after';
      // "::before" on its own, or after a combinator, is the pseudo-element of any element at that place.
      hostSelectors[pseudoElement].push(/(?:^|[\s>+~])$/.test(host) ? `${host}*` : host);
    }
    start = end + 1;
  }
  return hostSelectors;
}

function noteImageRule(selector: string, style: CSSStyleDeclaration, scope: RuleScope, hosts: PseudoHostMap): void {
  // Nearly every rule names no pseudo-element, so the selector is looked at before the declarations are read.
  if (!NAMES_PSEUDO_ELEMENT.test(selector) || (scope.isShadowTree && !REACHES_DOCUMENT.test(selector))) return;
  if (!declaresImage(style)) return;
  const hostSelectors = findHostSelectors(selector);
  for (const pseudoElement of PSEUDO_ELEMENTS) {
    const found = hosts[pseudoElement];
    if (hostSelectors[pseudoElement].length === 0) continue;
    if (!scope.isNarrowable) found.isEvery = true;
    hostSelectors[pseudoElement].forEach((hostSelector) => found.selectors.add(hostSelector));
  }
}

function readRules(rules: CSSRuleList, scope: RuleScope, reader: RuleReader): void {
  for (const rule of rules) {
    reader.remainingRules -= 1;
    if (reader.remainingRules < 0 || PSEUDO_ELEMENTS.every((pseudoElement) => reader.hosts[pseudoElement].isEvery)) return;
    if (isImportRule(rule)) {
      if (rule.styleSheet) readRules(rule.styleSheet.cssRules, scope, reader);
    } else if (isStyleRule(rule)) {
      const isNested = scope.parentSelector !== undefined;
      // A nested selector is relative to the rule around it, so the two are read as one text and not narrowed down.
      const selector = isNested ? `${scope.parentSelector} ${rule.selectorText}` : rule.selectorText;
      const inner: RuleScope = { ...scope, parentSelector: selector, isNarrowable: scope.isNarrowable && !isNested };
      noteImageRule(selector, rule.style, inner, reader.hosts);
      if (rule.cssRules) readRules(rule.cssRules, inner, reader);
    } else if (hasStyle(rule)) {
      // Declarations written after a nested rule belong to the rule around them.
      if (scope.parentSelector !== undefined) noteImageRule(scope.parentSelector, rule.style, scope, reader.hosts);
    } else if (hasRules(rule)) {
      readRules(rule.cssRules, { ...scope, isNarrowable: scope.isNarrowable && !isScopeRule(rule) }, reader);
    }
  }
}

function listStyleSheets(root: DocumentOrShadowRoot): CSSStyleSheet[] {
  // Browsers from before 2023 have no adoptedStyleSheets.
  return [...root.styleSheets, ...(root.adoptedStyleSheets ?? [])];
}

/** False when a selector is not one querySelectorAll takes, so what it matches is unknown. */
function addMatches(selectors: ReadonlySet<string>, elements: Set<Element>): boolean {
  try {
    for (const selector of selectors) {
      for (const element of document.querySelectorAll(selector)) elements.add(element);
    }
    return true;
  } catch (error) {
    if (error instanceof DOMException) return false;
    throw error;
  }
}

// The rules of a closed shadow tree cannot be read. They can style its host and what is slotted into it.
function addPossibleShadowHosts(host: Element, hosts: PseudoHostMap): void {
  for (const pseudoElement of PSEUDO_ELEMENTS) {
    hosts[pseudoElement].elements.add(host);
    for (const child of host.children) hosts[pseudoElement].elements.add(child);
  }
}

function addAnimatedHosts(hosts: PseudoHostMap): void {
  for (const animation of document.getAnimations()) {
    const effect = animation.effect;
    if (!isKeyframeEffect(effect) || !effect.target) continue;
    const name = ANIMATED_PSEUDO_ELEMENT.exec(effect.pseudoElement ?? '')?.[1].toLowerCase();
    if (name) hosts[name === 'before' ? '::before' : '::after'].elements.add(effect.target);
  }
}

function findPseudoHosts(elements: NodeListOf<Element>): PseudoHostMap {
  // Without the list of running animations an animated pseudo-element cannot be ruled out.
  if (typeof document.getAnimations !== 'function') return createHosts(true);
  const reader: RuleReader = { hosts: createHosts(false), remainingRules: elements.length * MAX_RULES_PER_ELEMENT };
  try {
    for (const sheet of listStyleSheets(document)) {
      readRules(sheet.cssRules, { isNarrowable: true, isShadowTree: false }, reader);
    }
    for (const element of elements) {
      if (!element.shadowRoot) {
        if (element.localName.includes('-')) addPossibleShadowHosts(element, reader.hosts);
        continue;
      }
      for (const sheet of listStyleSheets(element.shadowRoot)) {
        readRules(sheet.cssRules, { isNarrowable: false, isShadowTree: true }, reader);
      }
    }
  } catch (error) {
    // The rules of a stylesheet from another origin cannot be read, so nothing can be ruled out.
    if (error instanceof DOMException) return createHosts(true);
    throw error;
  }
  if (reader.remainingRules < 0) return createHosts(true);
  for (const pseudoElement of PSEUDO_ELEMENTS) {
    const found = reader.hosts[pseudoElement];
    if (found.isEvery) continue;
    found.isEvery = found.selectors.size > MAX_HOST_SELECTORS || !addMatches(found.selectors, found.elements);
  }
  addAnimatedHosts(reader.hosts);
  return reader.hosts;
}

function findExcludedElements(excludedSelector: string): Set<Element> {
  const excluded = new Set<Element>();
  for (const root of document.querySelectorAll(excludedSelector)) {
    excluded.add(root);
    for (const element of root.querySelectorAll('*')) excluded.add(element);
  }
  return excluded;
}

function collectImageUrls(style: CSSStyleDeclaration, urls: Set<string>): void {
  for (const property of CSS_IMAGE_PROPERTIES) {
    const value = style.getPropertyValue(property);
    if (!value.includes('url(')) continue;
    for (const match of value.matchAll(CSS_IMAGE_URL_PATTERN)) urls.add(match[1]);
  }
}

export function findUsedCssImageUrls(excludedSelector: string): Set<string> {
  const urls = new Set<string>();
  const elements = document.querySelectorAll('*');
  const excluded = findExcludedElements(excludedSelector);
  const hosts = findPseudoHosts(elements);
  for (const element of elements) {
    if (excluded.has(element)) continue;
    collectImageUrls(getComputedStyle(element), urls);
    for (const pseudoElement of PSEUDO_ELEMENTS) {
      const found = hosts[pseudoElement];
      if (found.isEvery || found.elements.has(element)) collectImageUrls(getComputedStyle(element, pseudoElement), urls);
    }
  }
  return urls;
}
