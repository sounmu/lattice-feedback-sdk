import { describe, expect, it } from 'vitest';

import { convertMarkdownToNotionBlocks, createNotionTitle } from '@/lib/markdown-to-notion-blocks';

function readTypes(markdown: string): string[] {
  return convertMarkdownToNotionBlocks(markdown).map((block) => block.type as string);
}

function readText(block: Record<string, unknown>): string {
  const content = block[block.type as string] as { rich_text: { text: { content: string } }[] };
  return content.rich_text.map((item) => item.text.content).join('');
}

describe('convertMarkdownToNotionBlocks', () => {
  it('maps headings, lists, quotes and paragraphs to blocks and skips blank lines', () => {
    const markdown = ['## 요약', '', '- 유형: 버그', '1. 첫 단계', '> 사용자 말', '그냥 줄'].join('\n');

    expect(readTypes(markdown)).toEqual(['heading_2', 'bulleted_list_item', 'numbered_list_item', 'quote', 'paragraph']);
  });

  it('joins the lines of one quote into a single block', () => {
    const blocks = convertMarkdownToNotionBlocks('> 첫 줄\n> 둘째 줄');

    expect(blocks).toHaveLength(1);
    expect(readText(blocks[0])).toBe('첫 줄\n둘째 줄');
  });

  it('keeps a reporter line that starts with # as quoted text, not a heading', () => {
    expect(readTypes('> # 제목처럼 보이는 말')).toEqual(['quote']);
  });

  it('removes the escapes the draft adds and keeps the character', () => {
    const [block] = convertMarkdownToNotionBlocks('- 작성자: a\\*b\\_c');

    expect(readText(block)).toBe('작성자: a*b_c');
  });

  it('marks `code` and links', () => {
    const [block] = convertMarkdownToNotionBlocks('- `/pricing`: [화면 1](https://admin.example/admin/snapshots/s1?projectKey=demo)');
    const richText = (block.bulleted_list_item as { rich_text: Record<string, unknown>[] }).rich_text;

    expect(richText[0]).toMatchObject({ text: { content: '/pricing' }, annotations: { code: true } });
    expect(richText[2]).toMatchObject({ text: { content: '화면 1', link: { url: 'https://admin.example/admin/snapshots/s1?projectKey=demo' } } });
  });

  it('does not turn a non-http link into a link', () => {
    const [block] = convertMarkdownToNotionBlocks('[눌러](javascript:alert(1))');

    expect(JSON.stringify(block)).not.toContain('"link"');
  });

  it('shortens a text that is too long for Notion', () => {
    const [block] = convertMarkdownToNotionBlocks(`> ${'가'.repeat(5000)}`);

    expect(readText(block).length).toBeLessThanOrEqual(2000);
    expect(readText(block)).toContain('전체 내용은 관리자 화면에서 확인');
  });

  it('keeps the block count under the Notion limit', () => {
    const markdown = Array.from({ length: 300 }, (_, index) => `- 줄 ${index}`).join('\n');

    expect(convertMarkdownToNotionBlocks(markdown).length).toBeLessThanOrEqual(100);
  });
});

function readRichTextCounts(blocks: Record<string, unknown>[]): number[] {
  return blocks.map((block) => (block[block.type as string] as { rich_text: unknown[] }).rich_text.length);
}

// Alternating `code` and plain pieces cannot be merged: n code spans and n - 1 spaces make 2n - 1 items.
function createAlternatingLine(codeSpanCount: number, suffix = ''): string {
  return `- ${Array.from({ length: codeSpanCount }, () => '`x`').join(' ')}${suffix}`;
}

describe('rich-text count limit', () => {
  it('keeps a line of exactly 100 items in one block', () => {
    const blocks = convertMarkdownToNotionBlocks(createAlternatingLine(50, ' y'));

    expect(blocks).toHaveLength(1);
    expect(readRichTextCounts(blocks)).toEqual([100]);
  });

  it('continues a line of 101 items in a second block', () => {
    const blocks = convertMarkdownToNotionBlocks(createAlternatingLine(51));

    expect(readRichTextCounts(blocks)).toEqual([100, 1]);
    expect(blocks.map((block) => block.type)).toEqual(['bulleted_list_item', 'paragraph']);
  });

  it('never sends a block with more than 100 items, and keeps all the text', () => {
    const blocks = convertMarkdownToNotionBlocks(createAlternatingLine(101));

    expect(Math.max(...readRichTextCounts(blocks))).toBeLessThanOrEqual(100);
    expect(blocks.map(readText).join('').replaceAll(' ', '')).toBe('x'.repeat(101));
  });

  it('merges neighbouring pieces that look the same', () => {
    const [block] = convertMarkdownToNotionBlocks('- 가 \\* 나 \\_ 다');

    expect(readRichTextCounts([block])).toEqual([1]);
  });
});

describe('link address limit', () => {
  const PREFIX = 'https://admin.example/';

  it('links an address of exactly 2000 characters', () => {
    const url = PREFIX + 'a'.repeat(2000 - PREFIX.length);
    const [block] = convertMarkdownToNotionBlocks(`- [화면](${url})`);

    expect(JSON.stringify(block)).toContain('"link"');
  });

  it('keeps an address of 2001 characters as text instead of a link', () => {
    const url = PREFIX + 'a'.repeat(2001 - PREFIX.length);
    const [block] = convertMarkdownToNotionBlocks(`- [화면](${url})`);

    expect(JSON.stringify(block)).not.toContain('"link"');
    expect(readText(block).startsWith('화면 (https://admin.example/')).toBe(true);
  });
});

describe('request size limit', () => {
  // 100 links with addresses as long as Notion allows make the largest block there is, about 206KB.
  // Notion rejects a request over 500KB, so two such blocks fit in one and a third does not.
  function createLargestLine(label: string): string {
    const links = Array.from({ length: 100 }, (_, index) => {
      const prefix = `https://admin.example/${label}/${index}/`;
      return `[${label}](${prefix}${'a'.repeat(2000 - prefix.length)})`;
    });
    return `- ${links.join('')}`;
  }

  it('keeps the blocks that fit in one request from the start, and says in a last block that the rest was left out', () => {
    const blocks = convertMarkdownToNotionBlocks(['A', 'B', 'C'].map(createLargestLine).join('\n'));

    expect(blocks.map((block) => block.type)).toEqual(['bulleted_list_item', 'bulleted_list_item', 'paragraph']);
    expect(blocks.slice(0, 2).map(readText)).toEqual(['A'.repeat(100), 'B'.repeat(100)]);
    expect(JSON.stringify(blocks[2])).not.toContain('"link"');
  });

  it('keeps every block of a long draft that fits in one request', () => {
    const paragraphs = Array.from({ length: 95 }, (_, index) => `${index} ${'a'.repeat(1890)}`);

    expect(convertMarkdownToNotionBlocks(paragraphs.join('\n')).map(readText)).toEqual(paragraphs);
  });
});

describe('backslashes', () => {
  it('keeps a Windows path in a reporter quote', () => {
    const [block] = convertMarkdownToNotionBlocks('> C:\\Users\\alice\\report.csv 를 못 열어요');

    expect(readText(block)).toBe('C:\\Users\\alice\\report.csv 를 못 열어요');
  });

  it('keeps a backslash before an ordinary letter outside a quote too', () => {
    const [block] = convertMarkdownToNotionBlocks('- 작성자: C:\\Users\\alice');

    expect(readText(block)).toBe('작성자: C:\\Users\\alice');
  });

  it('keeps a quote exactly as written, including escape-like text', () => {
    const [block] = convertMarkdownToNotionBlocks('> 별표 \\* 와 `코드` 와 [링크](https://a.example)');

    expect(readText(block)).toBe('별표 \\* 와 `코드` 와 [링크](https://a.example)');
  });
});

describe('createNotionTitle', () => {
  it('puts the title on one line', () => {
    const [item] = createNotionTitle('[버그]\n두 줄   제목') as unknown as { text: { content: string } }[];

    expect(item.text.content).toBe('[버그] 두 줄 제목');
  });
});
