/** Pure classification. The index contains extracted literals, never a copy of a script. */
export interface AutomaticMaskingOptions {
  readonly enabled?: boolean;
  readonly keepCommentedText?: boolean;
}

export interface TextMaskingContext {
  readonly forced?: boolean;
  readonly safe?: boolean;
  readonly commented?: boolean;
}

export function normalizeStaticText(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

/** Preserve whitespace and UTF-16 length; punctuation and digits reveal data too. */
export function maskText(text: string): string {
  return text.replace(/\S/g, '\u25cf');
}

export function classifyText(
  text: string,
  known: ReadonlySet<string>,
  context: TextMaskingContext = {},
): 'static' | 'data' {
  if (context.forced) return 'data';
  if (context.safe || context.commented) return 'static';
  const normalized = normalizeStaticText(text);
  return !normalized || known.has(normalized) ? 'static' : 'data';
}

export class AutomaticMasker {
  // Counts occurrences, including changes, not unique originals. No originals are retained here.
  maskedCharacters = 0;
  maskedValues = 0;

  constructor(
    readonly known: ReadonlySet<string>,
    readonly options: AutomaticMaskingOptions = {},
  ) {}

  isStatic(value: string, context: TextMaskingContext = {}): boolean {
    const decision = {
      ...context,
      safe: context.safe || this.options.enabled === false,
      commented: context.commented && this.options.keepCommentedText === true,
    };
    return classifyText(value, this.known, decision) === 'static';
  }

  /** For a value the caller replaces with something other than the circles (an opaque name). */
  countMasked(value: string): void {
    this.maskedValues += 1;
    this.maskedCharacters += value.replace(/\s/g, '').length;
  }

  text(value: string, context: TextMaskingContext = {}): string {
    if (this.isStatic(value, context)) return value;
    const masked = maskText(value);
    if (masked !== value) this.countMasked(value);
    return masked;
  }
}

/**
 * A script literal made of digits and symbols with no letter ("1200", "2024-11") is as likely to be a
 * coincidental value as a label, so it never proves text static. Markup text keeps its numbers.
 */
export function shouldIndexScriptLiteral(literal: string): boolean {
  return !(/\d/.test(literal) && !/\p{L}/u.test(literal));
}

type QuoteCharacter = '"' | "'" | '`';

function isQuoteCharacter(character: string): character is QuoteCharacter {
  return character === '"' || character === "'" || character === '`';
}

/**
 * Where the string opened by the quote at start closes. A quoted string cannot span lines and a template can.
 * When there is no closing quote, end is where the search gave up.
 */
function findStringEnd(source: string, start: number): { isClosed: boolean; end: number } {
  const quote = source[start];
  let position = start + 1;
  while (position < source.length) {
    const character = source[position];
    if (character === quote) return { isClosed: true, end: position };
    if (character === '\n' && quote !== '`') return { isClosed: false, end: position };
    // An escaped character, a line break included, belongs to the string.
    position += character === '\\' ? 2 : 1;
  }
  return { isClosed: false, end: source.length };
}

/**
 * Literal strings and adjacent literal concatenation only; never evaluate host JavaScript. A run of concatenated
 * literals is added once as a whole: its shorter prefixes are never a value of the expression, and keeping
 * them would make a long chain cost the square of its length.
 *
 * Comments and regular expressions are not recognized (a regular expression like /\/\// would read as a comment),
 * so a quote inside one can open a string that never closes. That quote is skipped and reading goes on right
 * after it, so an apostrophe in a comment does not hide the literals that follow. Every later quote of the same
 * kind before the point where the search gave up is an escaped quote of that failed string and cannot close
 * either, so it is skipped without searching again: each character is read a bounded number of times.
 */
export function extractScriptLiterals(source: string): string[] {
  const literals: string[] = [];
  const unclosedUntil: Record<QuoteCharacter, number> = { '"': 0, "'": 0, '`': 0 };
  let previousEnd = -1;
  let run = '';
  let runPieces = 0;
  const endRun = (): void => {
    if (runPieces > 1) literals.push(run);
    runPieces = 0;
  };
  let position = 0;
  while (position < source.length) {
    const quote = source[position];
    if (!isQuoteCharacter(quote) || position < unclosedUntil[quote]) {
      position += 1;
      continue;
    }
    const start = position;
    const { isClosed, end } = findStringEnd(source, start);
    if (!isClosed) {
      unclosedUntil[quote] = end;
      position += 1;
      continue;
    }
    const body = source.slice(start + 1, end);
    position = end + 1;
    if (quote === '`' && body.includes('${')) {
      endRun();
      previousEnd = -1;
      continue;
    }
    const value = body.replace(/\\(?:u([0-9a-f]{4})|x([0-9a-f]{2})|([\\'"`nrt]))/gi, (_match, unicode, hex, escaped) => {
      if (unicode || hex) return String.fromCharCode(parseInt(unicode ?? hex, 16));
      return ({ n: '\n', r: '\r', t: '\t' }[String(escaped)] ?? String(escaped));
    });
    if (previousEnd >= 0 && /^\s*\+\s*$/.test(source.slice(previousEnd, start))) {
      run += value;
      runPieces += 1;
    } else {
      endRun();
      run = value;
      runPieces = 1;
    }
    literals.push(value);
    previousEnd = position;
  }
  endRun();
  return literals;
}
