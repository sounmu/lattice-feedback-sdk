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
