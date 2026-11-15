import { isReferenceAttribute } from '@/sdk/structural-references';

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

// #id, ::part(names) and [attribute operator value flag]
const CSS_SELECTOR = /#((?:\\.|[\w\u00a1-\uffff-])+)|::part\(([^)]*)\)|\[\s*([^\]=~|^$*\s]+)\s*([~|^$*]?=)\s*(?:"([^"]*)"|'([^']*)'|([^\s\]"']+))(\s+[iIsS])?\s*\]/g;

function unescapeIdentifier(identifier: string): string {
  return identifier.replace(/\\(.)/g, '$1');
}

export function scanCssSelectors(cssText: string): CssSelectors {
  const names = new Set<string>();
  const dataSelectors: AttributeSelector[] = [];
  for (const match of cssText.matchAll(CSS_SELECTOR)) {
    if (match[1] !== undefined) names.add(unescapeIdentifier(match[1]));
    if (match[2] !== undefined) match[2].split(/\s+/).filter(Boolean).forEach((part) => names.add(part));
    if (match[3] === undefined) continue;
    const attribute = match[3].toLowerCase();
    const operator = match[4] as AttributeOperator;
    const value = match[5] ?? match[6] ?? match[7] ?? '';
    if (isReferenceAttribute(attribute) && (operator === '=' || operator === '~=')) names.add(value);
    if (attribute.startsWith('data-')) {
      dataSelectors.push({ attribute, operator, value, ignoreCase: /i/i.test(match[8] ?? '') && !/s/i.test(match[8] ?? '') });
    }
  }
  return { names, dataSelectors };
}

/** The same stylesheet with the names that already have another name in this document written as that other name. */
export function rewriteCssNames(cssText: string, findReplacement: (name: string) => string | undefined): string {
  return cssText.replace(CSS_SELECTOR, (
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
    if (attribute === undefined || !isReferenceAttribute(attribute.toLowerCase()) || (operator !== '=' && operator !== '~=')) return whole;
    const value = double ?? single ?? bare ?? '';
    const replacement = findReplacement(value);
    if (replacement === undefined) return whole;
    const quote = double === undefined ? (single === undefined ? '' : "'") : '"';
    return `[${attribute}${operator}${quote}${replacement}${quote}${flag ?? ''}]`;
  });
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
