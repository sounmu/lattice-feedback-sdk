// Example feedback for measuring the questions, each labelled by hand with the details it really leaves out.
// The wording is varied on purpose, including phrasings the detail patterns do not catch, so the measured
// detection rate is not tuned to these cases. Fictional data only.
import type { ClarificationContext } from '@/lib/clarification-model';
import type { ClarificationSlotId } from '@/lib/clarification-slots';
import type { FeedbackType } from '@/types/feedback';

export interface ClarificationEvalCase {
  name: string;
  type: FeedbackType;
  context: ClarificationContext;
  /** The details this feedback does not cover, labelled by hand. */
  missing: readonly ClarificationSlotId[];
}

function createContext(change: Partial<ClarificationContext>): ClarificationContext {
  return { feedbackType: '버그', message: '', pagePath: '/orders', comments: [], edits: [], flowSteps: [], ...change };
}

const CLICK_STEP = '`/orders`에서 `저장` 클릭';

export const CLARIFICATION_EVAL_CASES: readonly ClarificationEvalCase[] = [
  { name: '짧은 버그', type: 'bug', context: createContext({ message: '저장이 안 돼요' }), missing: ['expected', 'steps', 'frequency', 'since'] },
  { name: '흰 화면', type: 'bug', context: createContext({ message: '결제 버튼 눌렀더니 흰 화면만 나와요' }), missing: ['expected', 'frequency', 'since'] },
  { name: '흐름 기록 + 튕김', type: 'bug', context: createContext({ message: '로그인하면 자꾸 튕겨요', flowSteps: ['`/login`에서 `로그인` 클릭'] }), missing: ['expected', 'since'] },
  { name: '시점·빈도 포함', type: 'bug', context: createContext({ message: '어제 업데이트 이후로 엑셀 다운로드가 실패해요. 매번 그래요.' }), missing: ['expected', 'steps'] },
  { name: '코멘트로 가리킨 숫자 오류', type: 'bug', context: createContext({ message: '합계가 이상해요', comments: [{ element: '표', comment: '이 표 숫자가 틀려요' }] }), missing: ['expected', 'steps', 'frequency', 'since'] },
  { name: '정렬 기대', type: 'bug', context: createContext({ message: '검색하면 원래 최신순이어야 하는데 오래된 순으로 나와요' }), missing: ['frequency', 'since'] },
  { name: '필터 후 빈 목록', type: 'bug', context: createContext({ message: '필터를 적용하면 목록이 비어요. 항상 그래요.', flowSteps: [CLICK_STEP] }), missing: ['expected', 'since'] },
  { name: '모두 적은 버그', type: 'bug', context: createContext({ message: '저장 버튼을 누르고 나서 원래 저장돼야 하는데 오류가 떠요. 어제부터 매번 그래요.' }), missing: [] },
  { name: '편집으로 옮긴 버튼', type: 'improvement', context: createContext({ feedbackType: '개선', message: '버튼을 오른쪽으로 옮겨 주세요', edits: [{ element: '버튼', change: '가로 +120px 이동' }] }), missing: ['problem'] },
  { name: '깊은 메뉴', type: 'improvement', context: createContext({ feedbackType: '개선', message: '메뉴가 너무 깊어서 찾기 힘들어요' }), missing: ['desired', 'target'] },
  { name: '작은 글씨 코멘트', type: 'improvement', context: createContext({ feedbackType: '개선', comments: [{ element: '안내 문구', comment: '글자가 작아서 잘 안 보여요' }] }), missing: ['desired'] },
  { name: '다크 모드 요청', type: 'improvement', context: createContext({ feedbackType: '개선', message: '다크 모드가 있으면 좋겠어요' }), missing: ['problem', 'target'] },
  { name: '엑셀 받는 법', type: 'question', context: createContext({ feedbackType: '질문', message: '주문 내역을 엑셀로 받으려면 어떻게 해요?' }), missing: ['target'] },
  { name: '아이콘 뜻', type: 'question', context: createContext({ feedbackType: '질문', comments: [{ element: '아이콘', comment: '이 아이콘은 무슨 뜻이에요?' }] }), missing: ['goal'] },
  { name: '전반적으로 느림', type: 'other', context: createContext({ feedbackType: '기타', message: '사이트가 전체적으로 느려요' }), missing: ['goal', 'target'] },
];
