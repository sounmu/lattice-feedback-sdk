import { describe, expect, it } from 'vitest';

import { MOCK_FEEDBACKS } from '@/mocks/feedback';
import { buildTicketDraft } from '@/lib/ticket-draft';
import type { Feedback } from '@/types/feedback';

const ADMIN_URL = 'http://localhost:3000/admin/feedback/fb?projectKey=demo';
const [BUG, QUESTION, IMPROVEMENT, FLOW] = MOCK_FEEDBACKS;

function findSection(feedback: Feedback, headingPrefix: string) {
  return buildTicketDraft({ feedback, adminUrl: ADMIN_URL }).sections.find((section) => section.heading.startsWith(headingPrefix));
}

describe('buildTicketDraft', () => {
  it('starts the title with the feedback type', () => {
    expect(buildTicketDraft({ feedback: BUG, adminUrl: ADMIN_URL }).title).toBe(
      '[버그] 주문 목록에서 엑셀 다운로드 버튼을 누르면 아무 반응이 없습니다.',
    );
  });

  it('shortens a long title and uses only the first line', () => {
    const feedback = { ...BUG, message: `${'가'.repeat(200)}\n두 번째 줄` };

    const { title } = buildTicketDraft({ feedback, adminUrl: ADMIN_URL });

    expect(title.length).toBeLessThanOrEqual(80);
    expect(title.endsWith('…')).toBe(true);
    expect(title).not.toContain('두 번째 줄');
  });

  it('keeps the full message and the admin link', () => {
    const { sections } = buildTicketDraft({ feedback: BUG, adminUrl: ADMIN_URL });

    expect(sections[0]).toEqual({ heading: '요청 내용', lines: [BUG.message] });
    expect(sections.at(-1)).toEqual({ heading: '관리자 화면', lines: [ADMIN_URL] });
  });

  it('does not include the reporter email', () => {
    const text = JSON.stringify(buildTicketDraft({ feedback: IMPROVEMENT, adminUrl: ADMIN_URL }));

    expect(text).not.toContain('tester-c@example.com');
    expect(text).toContain('테스트 사용자 C');
  });

  it('lists comments with their element', () => {
    expect(findSection(QUESTION, '코멘트')?.lines).toEqual([
      '1. "보류" 상태가 출고 보류인지 입고 보류인지 구분이 필요합니다. (inventory-filter-status)',
    ]);
  });

  it('describes a position edit as a move', () => {
    const line = findSection(IMPROVEMENT, '위치 편집')?.lines[0];

    expect(line).toContain('profile-save-button');
    expect(line).toContain('가로 0px, 세로 -1524px');
    expect(line).toContain('페이지 제목 오른쪽에 두면 좋겠습니다.');
  });

  it('lists the flow events in order', () => {
    const lines = findSection(FLOW, '흐름')?.lines ?? [];

    expect(lines).toHaveLength(5);
    expect(lines[0]).toBe('0:01.2 클릭 /partners · partner-create-button');
    expect(lines[1]).toBe('0:01.5 화면 이동 /partners/new');
  });

  it('caps a long flow and says how many were left out', () => {
    const events = Array.from({ length: 25 }, (_, index) => ({
      type: 'click' as const,
      offsetMs: index * 100,
      path: '/orders',
      targetLabel: 'button',
    }));
    const feedback: Feedback = {
      ...BUG,
      attachments: { comments: [], edits: [], flow: { startedAt: BUG.createdAt, endedAt: BUG.createdAt, events } },
    };

    const lines = findSection(feedback, '흐름')?.lines ?? [];

    expect(lines).toHaveLength(21);
    expect(lines.at(-1)).toContain('외 5개');
  });

  it('leaves out sections that have no content', () => {
    const headings = buildTicketDraft({ feedback: BUG, adminUrl: ADMIN_URL }).sections.map((section) => section.heading);

    expect(headings).toEqual(['요청 내용', '정보', '관리자 화면']);
  });
});
