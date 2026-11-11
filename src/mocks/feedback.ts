import type { Feedback, PageContext } from '@/types/feedback';

const DEMO_USER_AGENT = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36';

function createDemoPage(pathname: string, title: string): PageContext {
  return {
    url: `https://demo.example.com${pathname}`,
    title,
    viewportWidth: 1440,
    viewportHeight: 900,
    userAgent: DEMO_USER_AGENT,
  };
}

export const MOCK_FEEDBACKS: Feedback[] = [
  {
    id: 'fb_0001',
    projectKey: 'demo',
    message: '주문 목록에서 엑셀 다운로드 버튼을 누르면 아무 반응이 없습니다.',
    type: 'bug',
    status: 'open',
    reporter: { id: 'user_001', name: '테스트 사용자 A', email: 'tester-a@example.com' },
    page: createDemoPage('/orders', '주문 관리'),
    attachments: { comments: [], edits: [], flow: null },
    adminReply: null,
    createdAt: '2026-11-11T01:12:00.000Z',
    updatedAt: '2026-11-11T01:12:00.000Z',
  },
  {
    id: 'fb_0002',
    projectKey: 'demo',
    message: '검색 필터 라벨이 무엇을 의미하는지 잘 모르겠어요.',
    type: 'question',
    status: 'in_progress',
    reporter: { id: 'user_002', name: '테스트 사용자 B' },
    page: createDemoPage('/inventory', '재고 현황'),
    attachments: {
      comments: [
        {
          target: {
            selector: '[data-feedback-id="inventory-filter-status"]',
            feedbackId: 'inventory-filter-status',
            tagName: 'select',
            rect: { x: 320, y: 184, width: 180, height: 36 },
          },
          comment: '"보류" 상태가 출고 보류인지 입고 보류인지 구분이 필요합니다.',
        },
      ],
      edits: [],
      flow: null,
    },
    adminReply: null,
    createdAt: '2026-11-11T02:30:00.000Z',
    updatedAt: '2026-11-11T03:05:00.000Z',
  },
  {
    id: 'fb_0003',
    projectKey: 'demo',
    message: '저장 버튼이 화면 아래에 있어서 매번 스크롤해야 합니다. 상단으로 옮겨 주세요.',
    type: 'improvement',
    status: 'resolved',
    reporter: { id: 'user_003', name: '테스트 사용자 C', email: 'tester-c@example.com' },
    page: createDemoPage('/settings/profile', '프로필 설정'),
    attachments: {
      comments: [],
      edits: [
        {
          target: {
            selector: '[data-feedback-id="profile-save-button"]',
            feedbackId: 'profile-save-button',
            tagName: 'button',
            rect: { x: 1180, y: 1620, width: 120, height: 40 },
          },
          originalRect: { x: 1180, y: 1620, width: 120, height: 40 },
          proposedRect: { x: 1180, y: 96, width: 120, height: 40 },
          viewportWidth: 1440,
          viewportHeight: 900,
          note: '페이지 제목 오른쪽에 두면 좋겠습니다.',
        },
      ],
      flow: null,
    },
    adminReply: '다음 배포에서 저장 버튼을 상단 헤더로 옮겼습니다. 확인 부탁드립니다.',
    createdAt: '2026-11-10T08:00:00.000Z',
    updatedAt: '2026-11-11T05:40:00.000Z',
  },
  {
    id: 'fb_0004',
    projectKey: 'demo',
    message: '거래처를 등록하고 목록으로 돌아오면 방금 등록한 거래처가 보이지 않습니다.',
    type: 'bug',
    status: 'open',
    reporter: { id: 'user_004', name: '테스트 사용자 D' },
    page: createDemoPage('/partners', '거래처 목록'),
    attachments: {
      comments: [],
      edits: [],
      flow: {
        startedAt: '2026-11-11T06:00:00.000Z',
        endedAt: '2026-11-11T06:00:21.500Z',
        events: [
          { type: 'click', offsetMs: 1200, path: '/partners', targetLabel: 'partner-create-button' },
          { type: 'navigation', offsetMs: 1500, path: '/partners/new', targetLabel: null },
          { type: 'input', offsetMs: 6800, path: '/partners/new', targetLabel: 'partner-name-input' },
          { type: 'click', offsetMs: 14300, path: '/partners/new', targetLabel: 'partner-submit-button' },
          { type: 'navigation', offsetMs: 15100, path: '/partners', targetLabel: null },
        ],
      },
    },
    adminReply: null,
    createdAt: '2026-11-11T06:01:00.000Z',
    updatedAt: '2026-11-11T06:01:00.000Z',
  },
];
