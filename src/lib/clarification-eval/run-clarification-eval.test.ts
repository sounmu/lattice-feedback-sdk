import { expect, it } from 'vitest';
import { CLARIFICATION_EVAL_CASES } from '@/lib/clarification-eval/clarification-eval-cases';
import { runClarificationEval, type ClarificationAsker } from '@/lib/clarification-eval/run-clarification-eval';
import { MAX_CLARIFICATION_QUESTIONS } from '@/lib/clarification-limits';

// A model that ignores what the feedback says and asks about the first details it is offered: the case
// where the prompt alone protects nothing.
const askFirstOffered: ClarificationAsker = async (_testCase, slots) => slots
  .slice(0, MAX_CLARIFICATION_QUESTIONS)
  .map((slot) => ({ slot, question: `${slot}?`, options: ['예', '아니요'] }));

it('halves the questions about covered details when the code chooses what to ask', async () => {
  const report = await runClarificationEval(CLARIFICATION_EVAL_CASES, askFirstOffered);

  expect(report.cases).toBeGreaterThanOrEqual(10);
  expect(report.slotsJudgedCorrectly / report.slotsJudged).toBeGreaterThanOrEqual(0.8);
  expect(report.codeChosen.knownQuestions * 2).toBeLessThanOrEqual(report.modelOnly.knownQuestions);
  expect(report.skippedModelCalls).toBeGreaterThan(0);
});
