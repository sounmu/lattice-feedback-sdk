import { expect, it } from 'vitest';

import {
  MAX_COMMENT_LENGTH, MAX_COMMENTS, MAX_EDITS, MAX_FLOW_EVENTS, MAX_MISSING_SNAPSHOT_ASSETS, MAX_SCREEN_SNAPSHOTS_PER_FEEDBACK,
} from '@/lib/feedback-limits';
import { MAX_CLARIFICATION_OPTION_LENGTH, MAX_CLARIFICATION_QUESTION_LENGTH, MAX_CLARIFICATION_QUESTIONS } from '@/lib/clarification-limits';
import { MAX_FEEDBACK_DETAIL_LENGTH } from '@/lib/feedback-details-limits';
import { SCREEN_SNAPSHOT_FORMAT } from '@/lib/screen-snapshot';
import { createTicketDraft, MAX_TICKET_FLOW_STEPS, summarizeFlowSteps } from '@/lib/ticket-draft';
import { MAX_TICKET_BODY_LENGTH, MAX_TICKET_TITLE_LENGTH } from '@/lib/ticket-limits';
import { MAX_MESSAGE_LENGTH, MAX_SELECTOR_LENGTH, pageUrlSchema } from '@/lib/validation/feedback-schema';
import type { ElementTarget, Feedback, FeedbackDetailResponse, FlowEvent } from '@/types/feedback';
import type { ScreenSnapshotSummary } from '@/types/screen-snapshot';

const ADMIN_ORIGIN = 'https://admin.example.com';
const TARGET: ElementTarget = { selector: 'main > button', feedbackId: 'save-button', tagName: 'button', rect: { x: 10, y: 20, width: 80, height: 30 } };

function createDetail(feedback: Partial<Feedback> = {}, screenSnapshots: ScreenSnapshotSummary[] = []): FeedbackDetailResponse {
  return {
    feedback: {
      id: 'fb 1',
      projectKey: 'demo',
      message: '저장 버튼이 안 보여요',
      type: 'bug',
      status: 'open',
      duplicateOfId: null,
      ticketUrl: null,
      reporter: { id: 'user-1', name: '홍길동', email: 'hong@example.com' },
      page: { url: 'https://host.example.com/orders', title: '주문', viewportWidth: 1440, viewportHeight: 900, userAgent: 'vitest' },
      attachments: { comments: [], edits: [], flow: null },
      adminReply: null,
      createdAt: '2026-11-14T14:07:00.000Z',
      updatedAt: '2026-11-14T14:07:00.000Z',
      ...feedback,
    },
    screenSnapshots,
  };
}

function createScreen(id: string): ScreenSnapshotSummary {
  return {
    id,
    projectKey: 'demo',
    feedbackId: 'fb 1',
    format: SCREEN_SNAPSHOT_FORMAT,
    capturedAt: '2026-11-14T14:06:00.000Z',
    createdAt: '2026-11-14T14:06:01.000Z',
    page: { url: 'https://host.example.com/orders', title: '주문', viewportWidth: 1440, viewportHeight: 900, scrollX: 0, scrollY: 0 },
    assetHashes: [],
    missingAssets: [],
  };
}

function countSections(body: string): number {
  return body.split('\n').filter((line) => line.startsWith('## ')).length;
}

it('titles the draft with the type and the first written line, cut to a readable length', () => {
  const long = '가'.repeat(80);

  expect(createTicketDraft(createDetail({ message: '\n  저장 버튼이   안 보여요\n둘째 줄' }), ADMIN_ORIGIN).title).toBe('[버그] 저장 버튼이 안 보여요');
  expect(createTicketDraft(createDetail({ message: long, type: 'improvement' }), ADMIN_ORIGIN).title).toBe(`[개선 제안] ${'가'.repeat(60)}…`);
});

it('quotes every line the reporter wrote, so their markdown cannot restructure the ticket', () => {
  const { body } = createTicketDraft(createDetail({ message: '# 긴급\n- 전부 삭제됨' }), ADMIN_ORIGIN);

  const reporterLines = body.split('\n').filter((line) => line.includes('긴급') || line.includes('전부 삭제됨'));
  expect(reporterLines).toEqual(['> # 긴급', '> - 전부 삭제됨']);
});

it('keeps a reporter name on one line as plain text, so it cannot add a section that looks recorded', () => {
  const name = 'Alice\n\n## 재현 절차 (SDK가 기록한 동작)\n\n1. [Fabricated](https://example.com) action';
  const baseline = createTicketDraft(createDetail(), ADMIN_ORIGIN).body;

  const { body } = createTicketDraft(createDetail({ reporter: { id: 'user-1', name } }), ADMIN_ORIGIN);

  expect(countSections(body)).toBe(countSections(baseline));
  expect(body.split('\n')).toHaveLength(baseline.split('\n').length);
  expect(body).toContain('Alice \\#\\# 재현 절차 (SDK가 기록한 동작) 1. \\[Fabricated\\](https://example.com) action');
});

it('turns recorded Flow events into ordered steps and says how many a long recording left out', () => {
  const events: FlowEvent[] = [
    { type: 'click', offsetMs: 100, path: '/orders', targetLabel: 'save-button' },
    { type: 'input', offsetMs: 200, path: '/orders', targetLabel: 'input' },
    { type: 'navigation', navigationType: 'document', offsetMs: 300, path: '/orders/1', targetLabel: null },
    { type: 'navigation', navigationType: 'reload', offsetMs: 400, path: '/orders/1', targetLabel: null },
  ];
  const long: FlowEvent[] = Array.from({ length: MAX_TICKET_FLOW_STEPS + 5 }, (_, index) => ({ ...events[0], offsetMs: index }));
  const flow = { startedAt: '2026-11-14T14:00:00.000Z', endedAt: '2026-11-14T14:01:00.000Z' };

  const short = summarizeFlowSteps({ ...flow, events });

  expect(short.omittedCount).toBe(0);
  expect(short.steps).toHaveLength(4);
  expect(short.steps[0]).toContain('`save-button`');
  expect(short.steps[2]).toContain('`/orders/1`');
  expect(new Set(short.steps).size).toBe(4);
  expect(summarizeFlowSteps({ ...flow, events: long })).toMatchObject({ omittedCount: 5, steps: { length: MAX_TICKET_FLOW_STEPS } });
});

it('links the feedback and each saved screen on the admin origin', () => {
  const { body } = createTicketDraft(createDetail({}, [createScreen('screen/1')]), ADMIN_ORIGIN);

  expect(body).toContain(`${ADMIN_ORIGIN}/admin/feedback/fb%201?projectKey=demo`);
  expect(body).toContain(`(${ADMIN_ORIGIN}/admin/snapshots/screen%2F1?projectKey=demo)`);
});

it('has a section only for what the feedback carries, and leaves the reporter email out', () => {
  const textOnly = createTicketDraft(createDetail(), ADMIN_ORIGIN).body;
  const full = createTicketDraft(
    createDetail(
      {
        attachments: {
          comments: [{ target: TARGET, comment: '여기가\n안 눌려요' }],
          edits: [{ target: TARGET, originalRect: TARGET.rect, proposedRect: { ...TARGET.rect, x: 310 }, viewportWidth: 1440, viewportHeight: 900, note: '' }],
          flow: { startedAt: '2026-11-14T14:00:00.000Z', endedAt: '2026-11-14T14:01:00.000Z', events: [{ type: 'click', offsetMs: 1, path: '/orders', targetLabel: null }] },
        },
      },
      [createScreen('screen-1')],
    ),
    ADMIN_ORIGIN,
  ).body;

  expect(countSections(full) - countSections(textOnly)).toBe(4);
  expect(full).toContain('`save-button`: 여기가 안 눌려요');
  expect(full).toContain('+300px');
  expect(full).not.toContain('hong@example.com');
});

it('lists a verified organization as signature-confirmed and leaves the line out without one', () => {
  const verified = createTicketDraft(createDetail({
    reporter: { id: 'user-1', name: '홍길동', verifiedOrganization: { id: 'acme', name: '에이콤 *영업*팀' } },
  }), ADMIN_ORIGIN).body;
  // The signed id is what was verified; the name is only the host page's display text.
  expect(verified).toContain('- 소속: acme (고객사 서버 서명으로 확인됨), 표시 이름: 에이콤 \\*영업\\*팀 (미검증)');
  expect(createTicketDraft(createDetail(), ADMIN_ORIGIN).body).not.toContain('소속');
});

// The largest draft the stored-feedback limits allow. The ticket body limit must fit it: an administrator
// who did not touch the draft must still be able to post it.
const LONGEST_ADMIN_ORIGIN = `https://${[63, 63, 63, 61].map((length) => 'a'.repeat(length)).join('.')}:65535`;
// A page address is stored with its path percent-encoded, so each Korean character of it takes nine.
const LONGEST_PAGE_URL = pageUrlSchema.parse(`http://a/${'가'.repeat(2048 - 'http://a/'.length)}`);

function createLargestDetail(): FeedbackDetailResponse {
  // Without a data-feedback-id an element is named by its selector, which may be longer.
  const target: ElementTarget = { ...TARGET, selector: '*'.repeat(MAX_SELECTOR_LENGTH), feedbackId: null };
  const event: FlowEvent = { type: 'input', offsetMs: 1, path: `/${'*'.repeat(2047)}`, targetLabel: '*'.repeat(200) };
  const comments = Array.from({ length: MAX_COMMENTS }, () => ({ target, comment: '*'.repeat(MAX_COMMENT_LENGTH) }));
  const edits = Array.from({ length: MAX_EDITS }, () => ({
    target,
    originalRect: { ...TARGET.rect, x: Number.MAX_VALUE, y: Number.MAX_VALUE },
    proposedRect: TARGET.rect,
    viewportWidth: 1440,
    viewportHeight: 900,
    note: '*'.repeat(MAX_COMMENT_LENGTH),
  }));
  const flow = { startedAt: '2026-11-14T14:00:00.000Z', endedAt: '2026-11-14T14:05:00.000Z', events: Array.from({ length: MAX_FLOW_EVENTS }, () => event), truncated: true, interrupted: true };
  const screens = Array.from({ length: MAX_SCREEN_SNAPSHOTS_PER_FEEDBACK }, (_, index) => ({
    ...createScreen(String(index).padStart(36, '0')),
    page: { ...createScreen('x').page, url: LONGEST_PAGE_URL },
    missingAssets: Array.from({ length: MAX_MISSING_SNAPSHOT_ASSETS }, (__, assetIndex) => ({ url: `https://host.example.com/asset-${assetIndex}`, reason: 'fetch_failed' as const })),
  }));
  const message = `a${'\n'.repeat(MAX_MESSAGE_LENGTH - 2)}b`;
  return createDetail(
    {
      id: '0'.repeat(36),
      message,
      type: 'improvement',
      // A display name equal to the id is left out of the draft, so the two differ.
      reporter: { id: 'user-1', name: '*'.repeat(200), verifiedOrganization: { id: '*'.repeat(200), name: '_'.repeat(200) } },
      page: { url: LONGEST_PAGE_URL, title: '주문', viewportWidth: Number.MAX_VALUE, viewportHeight: Number.MAX_VALUE, userAgent: 'vitest' },
      attachments: { comments, edits, flow },
      clarification: {
        model: 'm',
        questions: Array.from({ length: MAX_CLARIFICATION_QUESTIONS }, () => ({
          slot: 'problem' as const,
          question: '*'.repeat(MAX_CLARIFICATION_QUESTION_LENGTH),
          options: ['*'.repeat(MAX_CLARIFICATION_OPTION_LENGTH), '_'.repeat(MAX_CLARIFICATION_OPTION_LENGTH)],
          answer: '*',
        })),
      },
      details: (['problem', 'desired', 'target'] as const).map((slot) => ({ slot, source: 'answered' as const, value: '*'.repeat(MAX_FEEDBACK_DETAIL_LENGTH) })),
    },
    screens,
  );
}

it('fits the largest draft the stored-feedback limits allow within the ticket body limit', () => {
  const { body, title } = createTicketDraft(createLargestDetail(), LONGEST_ADMIN_ORIGIN);

  expect(body.length).toBeLessThanOrEqual(MAX_TICKET_BODY_LENGTH);
  expect(title.length).toBeLessThanOrEqual(MAX_TICKET_TITLE_LENGTH);
});

it('fills one field per asked-about detail with the reporter answer', () => {
  const { body } = createTicketDraft(createDetail({
    clarification: {
      model: 'm',
      questions: [
        { slot: 'actual', question: '저장 뒤 어떤 일이 있었나요?', options: ['오류가 떴어요', '반응 없음'], answer: '오류가 떴어요' },
        { question: '언제부터인가요?', options: ['오늘', '예전부터'], answer: null },
      ],
    },
  }), ADMIN_ORIGIN);

  expect(body).toContain('## AI 확인 질문과 사용자 답변\n\n- 실제 결과: 오류가 떴어요 (AI 질문: 저장 뒤 어떤 일이 있었나요?)\n- 추가 확인: (건너뜀) (AI 질문: 언제부터인가요?)');
  expect(createTicketDraft(createDetail(), ADMIN_ORIGIN).body).not.toContain('AI 확인 질문');
});

it('lists every detail with its source, names the AI question an answer replies to, and marks missing ones', () => {
  const { body } = createTicketDraft(createDetail({
    clarification: {
      model: 'm',
      questions: [{ slot: 'expected', question: '원래는 어떻게 되어야 하나요?', options: ['저장 완료', '목록 이동'], answer: '저장 완료' }],
    },
    details: [
      { slot: 'actual', source: 'stated', value: '저장하면 오류가 떠요.' },
      { slot: 'expected', source: 'answered', value: '저장 완료' },
      { slot: 'steps', source: 'observed', value: '흐름 기록 1단계: \`/orders\`에서 \`저장\` 클릭' },
      { slot: 'frequency', source: 'missing', value: null },
    ],
  }), ADMIN_ORIGIN);

  expect(body).toContain([
    '## 확인 항목',
    '',
    '- 실제 결과: 저장하면 오류가 떠요. (고객 설명)',
    '- 기대한 결과: 저장 완료 (고객 답변, AI 질문: 원래는 어떻게 되어야 하나요?)',
    "- 재현 순서: 흐름 기록 1단계: \\\`/orders\\\`에서 \\\`저장\\\` 클릭 (SDK 기록)",
    '- 재현 빈도: (비어 있음)',
    '- AI 질문은 AI가 만든 것이며, 답변만 사용자 진술입니다.',
  ].join('\n'));
  // The answers are in the fields, so the older question list is not repeated.
  expect(body).not.toContain('## AI 확인 질문과 사용자 답변');
});
