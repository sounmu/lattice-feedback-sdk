import { isReferenceAttribute, rewriteReferences } from '@/sdk/structural-references';

export type AttributeOperator = '=' | '~=' | '|=' | '^=' | '$=' | '*=';

export interface AttributeSelector {
  attribute: string;
  operator: AttributeOperator;
  value: string;
  ignoreCase: boolean;
}

export interface CssSelectors {
  /** Ids, part names and the values reference attributes are selected by exactly (= and ~=). */
  names: Set<string>;
  /** Selectors on data-* attributes, with the operator that decides which part of a value they depend on. */
  dataSelectors: AttributeSelector[];
}

// #id, ::part(names) and [attribute operator value flag]. An id can spell a character as an escape: \: or \31 and a space.
const CSS_SELECTOR = /#((?:\\[0-9a-fA-F]{1,6}\s?|\\.|[\w\u00a1-\uffff-])+)|::part\(([^)]*)\)|\[\s*([^\]=~|^$*\s]+)\s*([~|^$*]?=)\s*(?:"([^"]*)"|'([^']*)'|([^\s\]"']+))(\s+[iIsS])?\s*\]/g;

// The condition of these rules is not a selector: @supports (color: #fff). Only @scope names elements.
const AT_RULE_WITHOUT_SELECTORS = /^(?:\s|\/\*[\s\S]*?\*\/)*@(?!scope\b)/i;

function unescapeIdentifier(identifier: string): string {
  return identifier.replace(/\\(?:([0-9a-fA-F]{1,6})\s?|(.))/g, (_escape, hex: string | undefined, character: string | undefined) => {
    if (hex === undefined) return character ?? '';
    const codePoint = parseInt(hex, 16);
    const isCharacter = codePoint > 0 && codePoint <= 0x10ffff && (codePoint < 0xd800 || codePoint > 0xdfff);
    return isCharacter ? String.fromCodePoint(codePoint) : '\ufffd';
  });
}

/** A stretch of stylesheet text up to the "{", "}" or ";" that ends it. The one before a "{" holds selectors. */
interface CssPiece {
  text: string;
  isSelector: boolean;
}

// "#fff" is an id before a "{" and a color in a declaration, so the text is read piece by piece. Strings, comments
// and escaped characters do not end a piece, and neither does a ";" inside parentheses (a data: URL). Text that
// has none of the three is a selector list on its own.
function splitCssPieces(cssText: string): CssPiece[] {
  const pieces: CssPiece[] = [];
  let start = 0;
  let depth = 0;
  let quote = '';
  for (let at = 0; at < cssText.length; at += 1) {
    const character = cssText[at];
    if (quote) {
      if (character === '\\') at += 1;
      else if (character === quote) quote = '';
    } else if (character === '"' || character === "'") {
      quote = character;
    } else if (character === '/' && cssText[at + 1] === '*') {
      const end = cssText.indexOf('*/', at + 2);
      at = end === -1 ? cssText.length : end + 1;
    } else if (character === '\\') {
      at += 1;
    } else if (character === '(') {
      depth += 1;
    } else if (character === ')') {
      depth = Math.max(0, depth - 1);
    } else if (character === '{' || character === '}' || (character === ';' && depth === 0)) {
      const text = cssText.slice(start, at + 1);
      pieces.push({ text, isSelector: character === '{' && !AT_RULE_WITHOUT_SELECTORS.test(text) });
      start = at + 1;
      depth = 0;
    }
  }
  if (start < cssText.length) {
    const text = cssText.slice(start);
    pieces.push({ text, isSelector: pieces.length === 0 && !AT_RULE_WITHOUT_SELECTORS.test(text) });
  }
  return pieces;
}

export function scanCssSelectors(cssText: string): CssSelectors {
  const names = new Set<string>();
  const dataSelectors: AttributeSelector[] = [];
  for (const piece of splitCssPieces(cssText)) {
    if (!piece.isSelector) {
      // A declaration names another node only as url(#name).
      rewriteReferences('style', piece.text, (name) => {
        names.add(name);
        return name;
      });
      continue;
    }
    for (const match of piece.text.matchAll(CSS_SELECTOR)) {
      if (match[1] !== undefined) names.add(unescapeIdentifier(match[1]));
      if (match[2] !== undefined) match[2].split(/\s+/).filter(Boolean).forEach((part) => names.add(part));
      if (match[3] === undefined) continue;
      const attribute = match[3].toLowerCase();
      const operator = match[4] as AttributeOperator;
      const value = match[5] ?? match[6] ?? match[7] ?? '';
      rewriteSelectorValue(attribute, operator, value, (name) => {
        names.add(name);
        return undefined;
      });
      if (attribute.startsWith('data-')) {
        dataSelectors.push({ attribute, operator, value, ignoreCase: /i/i.test(match[8] ?? '') && !/s/i.test(match[8] ?? '') });
      }
    }
  }
  return { names, dataSelectors };
}

// Besides names, rewriteCssNames writes a url(#name) without the whitespace around the name and a ::part() list again.
const REWRITTEN_WITHOUT_NAMES = /url\(\s*["']?#|::part\(/;

/**
 * True when rewriteCssNames returns the text as it is for as long as none of the names scanCssSelectors finds in
 * it has another name, so a caller that knows those names can skip the rewrite.
 */
export function isVerbatimWithoutReplacements(cssText: string): boolean {
  return !REWRITTEN_WITHOUT_NAMES.test(cssText);
}

/** The same stylesheet with the names that already have another name in this document written as that other name. */
export function rewriteCssNames(cssText: string, findReplacement: (name: string) => string | undefined): string {
  return splitCssPieces(cssText)
    .map((piece) => {
      if (piece.isSelector) return rewriteSelectorNames(piece.text, findReplacement);
      return rewriteReferences('style', piece.text, (name) => findReplacement(name) ?? name);
    })
    .join('');
}

function rewriteSelectorNames(selector: string, findReplacement: (name: string) => string | undefined): string {
  return selector.replace(CSS_SELECTOR, (
    whole: string, id: string | undefined, parts: string | undefined, attribute: string | undefined,
    operator: string | undefined, double: string | undefined, single: string | undefined, bare: string | undefined, flag: string | undefined,
  ) => {
    if (id !== undefined) {
      const replacement = findReplacement(unescapeIdentifier(id));
      return replacement === undefined ? whole : `#${replacement}`;
    }
    if (parts !== undefined) {
      return whole.replace(parts, parts.replace(/\S+/g, (part) => findReplacement(part) ?? part));
    }
    if (attribute === undefined || operator === undefined) return whole;
    const value = double ?? single ?? bare ?? '';
    const rewritten = rewriteSelectorValue(attribute.toLowerCase(), operator, value, findReplacement);
    if (rewritten === value) return whole;
    const quote = findQuote(double, single);
    return `[${attribute}${operator}${quote}${rewritten}${quote}${flag ?? ''}]`;
  });
}

function findQuote(double: string | undefined, single: string | undefined): string {
  if (double !== undefined) return '"';
  if (single !== undefined) return "'";
  return '';
}

// A selector value names nodes the way the attribute itself does. "=" compares the whole value, so a fragment
// (href="#name") or a list of names (aria-controls="one two") is read like that attribute. "~=" compares one name.
function rewriteSelectorValue(attribute: string, operator: string, value: string, findReplacement: (name: string) => string | undefined): string {
  if (operator === '=') return rewriteReferences(attribute, value, (name) => findReplacement(name) ?? name);
  if (operator === '~=' && isReferenceAttribute(attribute)) return findReplacement(value) ?? value;
  return value;
}

function toComparable(text: string, ignoreCase: boolean): string {
  // Only ASCII letters change, so offsets stay the same.
  return ignoreCase ? text.replace(/[A-Z]/g, (letter) => letter.toLowerCase()) : text;
}

/**
 * The parts of a value that selectors on its attribute depend on: the whole value for =, one whitespace separated
 * word for ~=, the prefix up to and including the hyphen for |=, the prefix for ^=, the suffix for $=, and every
 * occurrence for *=. Anything else in the value is not needed for the selector to match.
 */
export function findSelectorRanges(value: string, selectors: readonly AttributeSelector[]): [number, number][] {
  const ranges: [number, number][] = [];
  for (const { operator, value: selected, ignoreCase } of selectors) {
    const subject = toComparable(value, ignoreCase);
    const needle = toComparable(selected, ignoreCase);
    if (operator === '=') {
      if (subject === needle) ranges.push([0, value.length]);
    } else if (needle === '') {
      continue;
    } else if (operator === '~=') {
      if (/\s/.test(needle)) continue;
      for (const word of subject.matchAll(/\S+/g)) {
        if (word[0] === needle) ranges.push([word.index, word.index + needle.length]);
      }
    } else if (operator === '|=') {
      if (subject === needle) ranges.push([0, value.length]);
      else if (subject.startsWith(`${needle}-`)) ranges.push([0, needle.length + 1]);
    } else if (operator === '^=') {
      if (subject.startsWith(needle)) ranges.push([0, needle.length]);
    } else if (operator === '$=') {
      if (subject.endsWith(needle)) ranges.push([value.length - needle.length, value.length]);
    } else {
      for (let at = subject.indexOf(needle); at !== -1; at = subject.indexOf(needle, at + needle.length)) {
        ranges.push([at, at + needle.length]);
      }
    }
  }
  return ranges;
}

export function maskOutsideRanges(value: string, ranges: readonly [number, number][], maskGap: (text: string) => string): string {
  if (ranges.length === 0) return maskGap(value);
  let result = '';
  let cursor = 0;
  for (const [start, end] of [...ranges].sort((first, second) => first[0] - second[0])) {
    if (end <= cursor) continue;
    const from = Math.max(start, cursor);
    if (from > cursor) result += maskGap(value.slice(cursor, from));
    result += value.slice(from, end);
    cursor = end;
  }
  return cursor < value.length ? result + maskGap(value.slice(cursor)) : result;
}
