// Turns the Markdown of a ticket draft into Notion blocks. It understands only what the draft uses:
// ## headings, - and 1. lists, > quotes, `code`, [links](https://...) and \-escaped characters.
// Anything else is kept as plain text.

export type NotionBlock = Record<string, unknown>;

// Notion rejects a text longer than 2000 characters and more than 100 blocks per request; stay below both.
const MAX_TEXT_LENGTH = 1900;
const MAX_BLOCK_COUNT = 95;
const TRUNCATION_MARK = '… (전체 내용은 관리자 화면에서 확인)';
const OMITTED_BLOCKS_NOTE = '… 내용이 길어 일부만 옮겼어요.';
const LINK_PATTERN = /^\[((?:\\.|[^\]\\])*)\]\((https?:\/\/[^)\s]+)\)/;

interface TextPiece {
  text: string;
  isCode: boolean;
  linkUrl: string | null;
}

function unescape(text: string): string {
  return text.replace(/\\(.)/g, '$1');
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
    if (character === '\\' && index + 1 < line.length) {
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
        pieces.push({ text: unescape(match[1]), isCode: false, linkUrl: match[2] });
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

function createRichText(line: string) {
  const richText: Record<string, unknown>[] = [];
  let remaining = MAX_TEXT_LENGTH;
  for (const piece of parseInline(line)) {
    if (remaining <= 0) {
      break;
    }
    const isCut = piece.text.length > remaining;
    const content = isCut ? `${piece.text.slice(0, Math.max(remaining - TRUNCATION_MARK.length, 0))}${TRUNCATION_MARK}` : piece.text;
    remaining -= piece.text.length;
    const text: Record<string, unknown> = { content };
    if (piece.linkUrl) {
      text.link = { url: piece.linkUrl };
    }
    const item: Record<string, unknown> = { type: 'text', text };
    if (piece.isCode) {
      item.annotations = { code: true };
    }
    richText.push(item);
  }
  return richText.length > 0 ? richText : [{ type: 'text', text: { content: '' } }];
}

function createBlock(type: string, line: string): NotionBlock {
  return { object: 'block', type, [type]: { rich_text: createRichText(line) } };
}

function createLineBlock(line: string): NotionBlock {
  const heading = /^#{1,6}\s+(.*)$/.exec(line);
  if (heading) {
    return createBlock('heading_2', heading[1]);
  }
  const bullet = /^[-*]\s+(.*)$/.exec(line);
  if (bullet) {
    return createBlock('bulleted_list_item', bullet[1]);
  }
  const numbered = /^\d+\.\s+(.*)$/.exec(line);
  if (numbered) {
    return createBlock('numbered_list_item', numbered[1]);
  }
  return createBlock('paragraph', line);
}

export function convertMarkdownToNotionBlocks(markdown: string): NotionBlock[] {
  const blocks: NotionBlock[] = [];
  let quoteLines: string[] = [];
  const flushQuote = () => {
    if (quoteLines.length > 0) {
      blocks.push(createBlock('quote', quoteLines.join('\n')));
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
      blocks.push(createLineBlock(line));
    }
  }
  flushQuote();

  if (blocks.length <= MAX_BLOCK_COUNT) {
    return blocks;
  }
  return [...blocks.slice(0, MAX_BLOCK_COUNT), createBlock('paragraph', OMITTED_BLOCKS_NOTE)];
}

/** The page title: one line, cut to a length Notion accepts. */
export function createNotionTitle(title: string): NotionBlock[] {
  return createRichText(title.replace(/\s+/g, ' ').trim()) as NotionBlock[];
}
