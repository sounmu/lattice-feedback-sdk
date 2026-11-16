// Turns the Markdown of a ticket draft into Notion blocks. It understands only what the draft uses:
// ## headings, - and 1. lists, > quotes, `code`, [links](https://...) and \-escaped characters.
// Anything else is kept as plain text.

export type NotionBlock = Record<string, unknown>;

// Notion rejects a text longer than 2000 characters and more than 100 blocks per request; stay below both.
const MAX_TEXT_LENGTH = 1900;
const MAX_BLOCK_COUNT = 95;
const TRUNCATION_MARK = '… (전체 내용은 관리자 화면에서 확인)';
const OMITTED_BLOCKS_NOTE = '… 내용이 길어 일부만 옮겼어요.';
// Notion accepts at most 100 rich-text items in one block and a link address of at most 2000 characters.
const MAX_RICH_TEXT_COUNT = 100;
const MAX_LINK_URL_LENGTH = 2000;
// The characters ticket-draft escapes with a backslash. Any other backslash is the reporter's own.
const ESCAPABLE_CHARACTERS = '\\`*_[]<>#|~';
const LINK_PATTERN = /^\[((?:\\.|[^\]\\])*)\]\((https?:\/\/[^)\s]+)\)/;

interface TextPiece {
  text: string;
  isCode: boolean;
  linkUrl: string | null;
}

function unescape(text: string): string {
  return text.replace(/\\(.)/g, (match, character: string) => (ESCAPABLE_CHARACTERS.includes(character) ? character : match));
}

function parseInline(line: string): TextPiece[] {
  const pieces: TextPiece[] = [];
  let plain = '';
  const flush = () => {
    if (plain !== '') {
      pieces.push({ text: plain, isCode: false, linkUrl: null });
      plain = '';
    }
  };

  let index = 0;
  while (index < line.length) {
    const character = line[index];
    if (character === '\\' && index + 1 < line.length && ESCAPABLE_CHARACTERS.includes(line[index + 1])) {
      plain += line[index + 1];
      index += 2;
      continue;
    }
    if (character === '`') {
      const end = line.indexOf('`', index + 1);
      if (end > index + 1) {
        flush();
        pieces.push({ text: line.slice(index + 1, end), isCode: true, linkUrl: null });
        index = end + 1;
        continue;
      }
    }
    if (character === '[') {
      const match = LINK_PATTERN.exec(line.slice(index));
      if (match) {
        flush();
        const label = unescape(match[1]);
        // A link address Notion would reject stays in the text instead, so the page can still be made.
        if (match[2].length <= MAX_LINK_URL_LENGTH) {
          pieces.push({ text: label, isCode: false, linkUrl: match[2] });
        } else {
          pieces.push({ text: `${label} (${match[2]})`, isCode: false, linkUrl: null });
        }
        index += match[0].length;
        continue;
      }
    }
    plain += character;
    index += 1;
  }
  flush();
  return pieces;
}

// Neighbouring pieces with the same look are one rich-text item, so a long run of plain text is not split.
function mergePieces(pieces: TextPiece[]): TextPiece[] {
  const merged: TextPiece[] = [];
  for (const piece of pieces) {
    const last = merged[merged.length - 1];
    if (last && last.isCode === piece.isCode && last.linkUrl === piece.linkUrl) {
      last.text += piece.text;
    } else {
      merged.push({ ...piece });
    }
  }
  return merged;
}

function createRichTextItem(piece: TextPiece, content: string): Record<string, unknown> {
  const text: Record<string, unknown> = { content };
  if (piece.linkUrl) {
    text.link = { url: piece.linkUrl };
  }
  const item: Record<string, unknown> = { type: 'text', text };
  if (piece.isCode) {
    item.annotations = { code: true };
  }
  return item;
}

function limitPieces(pieces: TextPiece[]): Record<string, unknown>[] {
  const items: Record<string, unknown>[] = [];
  let remaining = MAX_TEXT_LENGTH;
  for (const piece of pieces) {
    if (remaining <= 0) {
      break;
    }
    const isCut = piece.text.length > remaining;
    const content = isCut ? `${piece.text.slice(0, Math.max(remaining - TRUNCATION_MARK.length, 0))}${TRUNCATION_MARK}` : piece.text;
    remaining -= piece.text.length;
    items.push(createRichTextItem(piece, content));
  }
  return items;
}

// The rich text of one line, in groups small enough for one block each. A line that needs more than one
// group continues in the blocks after the first.
function createRichTextGroups(line: string, isRaw: boolean): Record<string, unknown>[][] {
  const pieces = isRaw ? [{ text: line, isCode: false, linkUrl: null }] : mergePieces(parseInline(line));
  const items = limitPieces(pieces);
  if (items.length === 0) {
    return [[{ type: 'text', text: { content: '' } }]];
  }
  const groups: Record<string, unknown>[][] = [];
  for (let start = 0; start < items.length; start += MAX_RICH_TEXT_COUNT) {
    groups.push(items.slice(start, start + MAX_RICH_TEXT_COUNT));
  }
  return groups;
}

function createBlocks(type: string, line: string, isRaw = false): NotionBlock[] {
  return createRichTextGroups(line, isRaw).map((richText, index) => {
    const blockType = index === 0 || type === 'quote' ? type : 'paragraph';
    return { object: 'block', type: blockType, [blockType]: { rich_text: richText } };
  });
}

function createLineBlocks(line: string): NotionBlock[] {
  const heading = /^#{1,6}\s+(.*)$/.exec(line);
  if (heading) {
    return createBlocks('heading_2', heading[1]);
  }
  const bullet = /^[-*]\s+(.*)$/.exec(line);
  if (bullet) {
    return createBlocks('bulleted_list_item', bullet[1]);
  }
  const numbered = /^\d+\.\s+(.*)$/.exec(line);
  if (numbered) {
    return createBlocks('numbered_list_item', numbered[1]);
  }
  return createBlocks('paragraph', line);
}

export function convertMarkdownToNotionBlocks(markdown: string): NotionBlock[] {
  const blocks: NotionBlock[] = [];
  let quoteLines: string[] = [];
  const flushQuote = () => {
    if (quoteLines.length > 0) {
      // The reporter's words are not escaped in the draft, so a quote is kept exactly as written.
      blocks.push(...createBlocks('quote', quoteLines.join('\n'), true));
      quoteLines = [];
    }
  };

  for (const rawLine of markdown.split('\n')) {
    const line = rawLine.trimEnd();
    const quoted = /^>\s?(.*)$/.exec(line);
    if (quoted) {
      quoteLines.push(quoted[1]);
      continue;
    }
    flushQuote();
    if (line.trim() !== '') {
      blocks.push(...createLineBlocks(line));
    }
  }
  flushQuote();

  if (blocks.length <= MAX_BLOCK_COUNT) {
    return blocks;
  }
  return [...blocks.slice(0, MAX_BLOCK_COUNT), ...createBlocks('paragraph', OMITTED_BLOCKS_NOTE)];
}

/** The page title: one line, cut to a length Notion accepts. */
export function createNotionTitle(title: string): NotionBlock[] {
  return createRichTextGroups(title.replace(/\s+/g, ' ').trim(), true)[0] as NotionBlock[];
}
