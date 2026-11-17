import { MAX_CLARIFICATION_ANSWER_LENGTH } from '@/lib/clarification-limits';
import type { ClarificationQuestion, FeedbackClarification } from '@/types/feedback';

/** The choice value that opens a text field for the reporter's own answer. */
export const CUSTOM_CLARIFICATION_CHOICE = 'custom';

/** What the reporter picked for one question: an option's index as text, the custom choice, or nothing. */
export interface ClarificationChoice {
  selected: string | null;
  customText: string;
}

export const EMPTY_CLARIFICATION_CHOICE: ClarificationChoice = { selected: null, customText: '' };

export function getClarificationAnswer(question: ClarificationQuestion, choice: ClarificationChoice): string | null {
  if (choice.selected === null) {
    return null;
  }
  if (choice.selected === CUSTOM_CLARIFICATION_CHOICE) {
    const text = choice.customText.trim();
    return text ? text.slice(0, MAX_CLARIFICATION_ANSWER_LENGTH) : null;
  }
  return question.options[Number(choice.selected)] ?? null;
}

/** The questions with the reporter's answers; a question left alone is stored as skipped. */
export function createFeedbackClarification(
  model: string,
  questions: ClarificationQuestion[],
  choices: readonly ClarificationChoice[],
): FeedbackClarification {
  return {
    model,
    questions: questions.map((question, index) => ({
      ...question,
      answer: getClarificationAnswer(question, choices[index] ?? EMPTY_CLARIFICATION_CHOICE),
    })),
  };
}
