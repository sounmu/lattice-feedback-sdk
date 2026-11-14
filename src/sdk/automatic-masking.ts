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

  text(value: string, context: TextMaskingContext = {}): string {
    const decision = {
      ...context,
      safe: context.safe || this.options.enabled === false,
      commented: context.commented && this.options.keepCommentedText === true,
    };
    if (classifyText(value, this.known, decision) === 'static') return value;
    const masked = maskText(value);
    if (masked !== value) {
      this.maskedValues += 1;
      this.maskedCharacters += value.replace(/\s/g, '').length;
    }
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

/** Literal strings and adjacent literal concatenation only; never evaluate host JavaScript. */
export function extractScriptLiterals(source: string): string[] {
  const literals: string[] = [];
  // Quoted strings cannot span lines, so an apostrophe in a comment or regex cannot desynchronize the rest.
  const pattern = /(["'])((?:\\[\s\S]|(?!\1)[^\\\n])*)\1|`((?:\\[\s\S]|[^\\`])*)`/g;
  let previousEnd = -1;
  let concatenated = '';
  for (const match of source.matchAll(pattern)) {
    const body = match[2] ?? match[3];
    if (match[1] === undefined && body.includes('${')) {
      previousEnd = -1;
      continue;
    }
    const value = body.replace(/\\(?:u([0-9a-f]{4})|x([0-9a-f]{2})|([\\'"`nrt]))/gi, (_match, unicode, hex, escaped) => {
      if (unicode || hex) return String.fromCharCode(parseInt(unicode ?? hex, 16));
      return ({ n: '\n', r: '\r', t: '\t' }[String(escaped)] ?? String(escaped));
    });
    literals.push(value);
    if (previousEnd >= 0 && /^\s*\+\s*$/.test(source.slice(previousEnd, match.index))) {
      concatenated += value;
      literals.push(concatenated);
    } else {
      concatenated = value;
    }
    previousEnd = match.index + match[0].length;
  }
  return literals;
}
