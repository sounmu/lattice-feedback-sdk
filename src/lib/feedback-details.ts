// The details a ticket needs, one field each, worked out by the server when a feedback is stored. Each
// value keeps its source: the reporter's answer to an AI question, what the SDK recorded, or the reporter's
// own sentence. Nothing is summarized or inferred here, so every value can be traced back to the feedback.
import { createClarificationContext, type ClarificationContext } from '@/lib/clarification-model';
import { CLARIFICATION_SLOTS_BY_TYPE, findStatedSentence, type ClarificationSlotId } from '@/lib/clarification-slots';
import { MAX_FEEDBACK_DETAIL_LENGTH } from '@/lib/feedback-details-limits';
import type { CreateFeedbackInput, FeedbackDetail } from '@/types/feedback';

const MAX_LISTED_ITEMS = 3;

function truncate(text: string): string {
  const collapsed = text.replace(/\s+/g, ' ').trim();
  return collapsed.length > MAX_FEEDBACK_DETAIL_LENGTH ? `${collapsed.slice(0, MAX_FEEDBACK_DETAIL_LENGTH - 1)}…` : collapsed;
}

function listWithRest(items: string[]): string {
  const rest = items.length - MAX_LISTED_ITEMS;
  return `${items.slice(0, MAX_LISTED_ITEMS).join(', ')}${rest > 0 ? ` 외 ${rest}개` : ''}`;
}

// What the SDK recorded for the details it can record. Matches isObserved in clarification-slots.
function findObservedValue(slot: ClarificationSlotId, context: ClarificationContext): string | null {
  switch (slot) {
    case 'target': {
      const elements = [...new Set([...context.comments, ...context.edits].map(({ element }) => element))];
      return elements.length > 0 ? listWithRest(elements) : null;
    }
    case 'desired':
      return context.edits.length > 0 ? listWithRest(context.edits.map(({ element, change }) => `${element}: ${change}`)) : null;
    case 'steps': {
      const { flowSteps } = context;
      if (flowSteps.length === 0) {
        return null;
      }
      const shown = flowSteps.slice(0, MAX_LISTED_ITEMS).join(' → ');
      return `흐름 기록 ${flowSteps.length}단계: ${shown}${flowSteps.length > MAX_LISTED_ITEMS ? ' → …' : ''}`;
    }
    default:
      return null;
  }
}

/** Every detail of the feedback's type in asking order, each with its value and where it came from. */
export function createFeedbackDetails(input: CreateFeedbackInput): FeedbackDetail[] {
  const context = createClarificationContext(input);
  const answers = input.clarification?.questions ?? [];
  return CLARIFICATION_SLOTS_BY_TYPE[input.type].map((slot) => {
    const answer = answers.find((question) => question.slot === slot && question.answer !== null)?.answer;
    if (answer) {
      return { slot, source: 'answered', value: truncate(answer) };
    }
    const observed = findObservedValue(slot, context);
    if (observed !== null) {
      return { slot, source: 'observed', value: truncate(observed) };
    }
    const sentence = findStatedSentence(slot, context);
    if (sentence !== null) {
      return { slot, source: 'stated', value: truncate(sentence) };
    }
    return { slot, source: 'missing', value: null };
  });
}
