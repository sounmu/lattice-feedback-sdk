import { expect, it } from 'vitest';

import { SCREEN_SNAPSHOT_FORMAT } from '@/lib/screen-snapshot';
import { createTicketDraft, MAX_TICKET_FLOW_STEPS, summarizeFlowSteps } from '@/lib/ticket-draft';
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
