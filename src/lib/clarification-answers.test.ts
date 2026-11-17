import { expect, it } from 'vitest';
import { createFeedbackClarification, CUSTOM_CLARIFICATION_CHOICE } from '@/lib/clarification-answers';

const QUESTIONS = [
  { question: '저장 뒤 어떤 일이 있었나요?', options: ['오류가 떴어요', '아무 반응이 없었어요'] },
  { question: '언제부터인가요?', options: ['오늘', '예전부터'] },
];

it('stores the picked option, the reporter own words, or a skip for each question', () => {
  expect(createFeedbackClarification('m', QUESTIONS, [
    { selected: '1', customText: '' },
    { selected: CUSTOM_CLARIFICATION_CHOICE, customText: '  어제 오후부터  ' },
  ]).questions.map(({ answer }) => answer)).toEqual(['아무 반응이 없었어요', '어제 오후부터']);

  expect(createFeedbackClarification('m', QUESTIONS, [
    { selected: CUSTOM_CLARIFICATION_CHOICE, customText: '   ' },
  ]).questions.map(({ answer }) => answer)).toEqual([null, null]);
});
