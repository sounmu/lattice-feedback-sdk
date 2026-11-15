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

describe('createNotionTitle', () => {
  it('puts the title on one line', () => {
    const [item] = createNotionTitle('[버그]\n두 줄   제목') as unknown as { text: { content: string } }[];

    expect(item.text.content).toBe('[버그] 두 줄 제목');
  });
});
