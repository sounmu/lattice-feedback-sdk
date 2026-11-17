import { z } from 'zod';
import {
  MAX_CLARIFICATION_ANSWER_LENGTH, MAX_CLARIFICATION_MODEL_LENGTH, MAX_CLARIFICATION_OPTION_LENGTH, MAX_CLARIFICATION_OPTIONS,
  MAX_CLARIFICATION_QUESTION_LENGTH, MAX_CLARIFICATION_QUESTIONS, MIN_CLARIFICATION_OPTIONS,
} from '@/lib/clarification-limits';
import { CLARIFICATION_SLOT_IDS, CLARIFICATION_SLOTS_BY_TYPE } from '@/lib/clarification-slots';
import { MAX_FEEDBACK_DETAIL_LENGTH } from '@/lib/feedback-details-limits';

const clarificationQuestionShape = {
  question: z.string().trim().min(1).max(MAX_CLARIFICATION_QUESTION_LENGTH),
  options: z.array(z.string().trim().min(1).max(MAX_CLARIFICATION_OPTION_LENGTH))
    .min(MIN_CLARIFICATION_OPTIONS)
    .max(MAX_CLARIFICATION_OPTIONS),
  slot: z.enum(CLARIFICATION_SLOT_IDS).optional(),
};

export const clarificationQuestionSchema = z.object(clarificationQuestionShape);

export const clarifyResponseSchema = z.object({
  questions: z.array(clarificationQuestionSchema).max(MAX_CLARIFICATION_QUESTIONS),
  model: z.string().trim().min(1).max(MAX_CLARIFICATION_MODEL_LENGTH).nullable(),
});

export const feedbackClarificationSchema = z.object({
  model: z.string().trim().min(1).max(MAX_CLARIFICATION_MODEL_LENGTH),
  questions: z.array(z.object({
    ...clarificationQuestionShape,
    answer: z.string().trim().min(1).max(MAX_CLARIFICATION_ANSWER_LENGTH).nullable(),
  })).min(1).max(MAX_CLARIFICATION_QUESTIONS),
});

const MAX_FEEDBACK_DETAILS = Math.max(...Object.values(CLARIFICATION_SLOTS_BY_TYPE).map((slots) => slots.length));

export const feedbackDetailsSchema = z.array(z.object({
  slot: z.enum(CLARIFICATION_SLOT_IDS),
  source: z.enum(['answered', 'observed', 'stated', 'missing']),
  value: z.string().min(1).max(MAX_FEEDBACK_DETAIL_LENGTH).nullable(),
})).max(MAX_FEEDBACK_DETAILS);
