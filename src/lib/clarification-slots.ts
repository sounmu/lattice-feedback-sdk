// What a feedback of each type should tell the developer, and which of it the feedback already does. The
// questions are decided here, in code: the model is only asked to word a question for a detail that is
// still missing, so it cannot ask again for an element, a change or steps the SDK already recorded.
import type { ClarificationContext } from '@/lib/clarification-model';
import type { FeedbackDetailSource, FeedbackType } from '@/types/feedback';

export const CLARIFICATION_SLOT_IDS = [
  'actual', 'expected', 'steps', 'frequency', 'since', 'problem', 'desired', 'target', 'goal',
] as const;

export type ClarificationSlotId = (typeof CLARIFICATION_SLOT_IDS)[number];

interface ClarificationSlot {
  /** The field name in the ticket and the admin card. */
  label: string;
  /** What to ask about, for the model. */
  hint: string;
}

export const CLARIFICATION_SLOTS: Record<ClarificationSlotId, ClarificationSlot> = {
  actual: { label: '실제 결과', hint: '조작한 뒤 실제로 무슨 일이 일어났는지' },
  expected: { label: '기대한 결과', hint: '원래 어떻게 되어야 한다고 생각했는지' },
  steps: { label: '재현 순서', hint: '어떤 조작을 하다가 문제가 생겼는지' },
  frequency: { label: '재현 빈도', hint: '매번 그러는지, 가끔 그러는지' },
  since: { label: '발생 시점', hint: '언제부터 그랬는지' },
  problem: { label: '불편한 점', hint: '지금 무엇이 불편하거나 어려운지' },
  desired: { label: '원하는 모습', hint: '어떻게 바뀌면 좋겠는지' },
  target: { label: '대상 요소', hint: '화면의 어느 부분에 대한 이야기인지' },
  goal: { label: '하려던 일', hint: '무엇을 하려다가 막혔는지' },
};

/** Where a detail of a stored feedback came from, kept apart so a reader can tell words from records. */
export const FEEDBACK_DETAIL_SOURCE_LABELS: Record<FeedbackDetailSource, string> = {
  answered: '고객 답변',
  observed: 'SDK 기록',
  stated: '고객 설명',
  missing: '비어 있음',
};

/** The field a question fills, for display. Questions stored before details existed have none. */
export function getClarificationFieldLabel(slot: ClarificationSlotId | undefined): string {
  return slot ? CLARIFICATION_SLOTS[slot].label : '추가 확인';
}

// In the order they are asked: the first missing ones become the questions.
export const CLARIFICATION_SLOTS_BY_TYPE: Record<FeedbackType, readonly ClarificationSlotId[]> = {
  bug: ['actual', 'expected', 'steps', 'frequency', 'since'],
  improvement: ['problem', 'desired', 'target'],
  question: ['goal', 'target'],
  other: ['goal', 'target'],
};

// Phrases that show the reporter already said it. Missing a phrase only costs one question; a false match
// would hide a question, so each pattern stays narrow.
const STATED_PATTERNS: Record<ClarificationSlotId, RegExp | null> = {
  actual: /안\s?(돼|되|나와|나오|열려|열리|눌려|눌리|보여|보이|떠|넘어가|바뀌|움직)|않(아|았|고)|오류|에러|실패|멈춰|멈추|사라져|사라지|느려|깨져|깨지|튕겨|먹통|반응이?\s?없|빈\s?화면/,
  expected: /해야|돼야|되어야|될\s?줄|되길|원래|기대|했으면|하면\s?좋|으면\s?좋|게\s?해\s?주/,
  steps: /누르고|눌렀더니|누르면|클릭(하고|하면|했더니)|들어가(서|면)|선택(하고|하면|했더니)|입력(하고|하면|했더니)|한\s?다음|하고\s?나서/,
  // A count alone is often a step ("3번 누르고"); it only answers frequency as a share or a streak ("10번 중 3번", "3번 다").
  frequency: /항상|매번|가끔|자주|때때로|간헐|계속|매일|\d+\s?번\s?(중|에\s?\d|째|이상|넘게|연속|다|모두)/,
  // An update or deployment only dates the problem with a time word after it, not as the button that was pressed.
  since: /부터|어제|오늘|그제|지난|이후|최근|아까|(업데이트|배포)\s?(된\s?)?(후|뒤|하고\s?나서)/,
  problem: /불편|어렵|헷갈|복잡|번거|힘들|안\s?보|잘\s?안|작아|너무/,
  desired: /했으면|하면\s?좋|으면\s?좋|게\s?해\s?주|바꿔|옮겨|키워|줄여|추가해|없애/,
  target: null,
  goal: /하려고|하려는|하려면|하고\s?싶|어떻게|방법/,
};

export type ClarificationSlotStatus = 'observed' | 'stated' | 'missing';

export interface ClarificationSlotState {
  id: ClarificationSlotId;
  /** observed: the SDK recorded it. stated: the reporter's words cover it. missing: worth a question. */
  status: ClarificationSlotStatus;
}

function isObserved(id: ClarificationSlotId, context: ClarificationContext): boolean {
  switch (id) {
    case 'target':
      return context.comments.length > 0 || context.edits.length > 0;
    case 'desired':
      return context.edits.length > 0;
    case 'steps':
      return context.flowSteps.length > 0;
    default:
      return false;
  }
}

// The reporter's words sentence by sentence, so a stated detail can be shown with the sentence that states it.
function getReporterSentences(context: ClarificationContext): string[] {
  return [
    context.message,
    ...context.comments.map(({ comment }) => comment),
    ...context.edits.flatMap(({ note }) => (note ? [note] : [])),
  ]
    .flatMap((text) => text.split(/\n+|(?<=[.!?。])\s+/))
    .map((sentence) => sentence.trim())
    .filter((sentence) => sentence !== '');
}

/** The reporter's sentence that already gives this detail, or null when none does. */
export function findStatedSentence(id: ClarificationSlotId, context: ClarificationContext): string | null {
  const pattern = STATED_PATTERNS[id];
  if (!pattern) {
    return null;
  }
  return getReporterSentences(context).find((sentence) => pattern.test(sentence)) ?? null;
}

export function getClarificationSlotStates(type: FeedbackType, context: ClarificationContext): ClarificationSlotState[] {
  return CLARIFICATION_SLOTS_BY_TYPE[type].map((id) => {
    if (isObserved(id, context)) {
      return { id, status: 'observed' };
    }
    if (findStatedSentence(id, context) !== null) {
      return { id, status: 'stated' };
    }
    return { id, status: 'missing' };
  });
}

/**
 * Every detail worth asking about, in asking order. Empty when nothing is missing. All of them go to the
 * model: when it finds one already answered in words the patterns missed, it moves on to the next, and the
 * question limit applies only to what it returns.
 */
export function findMissingClarificationSlots(type: FeedbackType, context: ClarificationContext): ClarificationSlotId[] {
  return getClarificationSlotStates(type, context)
    .filter(({ status }) => status === 'missing')
    .map(({ id }) => id);
}
