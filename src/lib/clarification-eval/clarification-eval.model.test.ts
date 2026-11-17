// Runs the evaluation set against a real model. Off by default; run it with the FEEDBACK_AI_* settings and
// FEEDBACK_AI_EVAL=1, for example:
//   FEEDBACK_AI_EVAL=1 FEEDBACK_AI_BASE_URL=http://localhost:11434/v1 FEEDBACK_AI_MODEL=<model> \
//     npx vitest run --reporter=verbose src/lib/clarification-eval/clarification-eval.model.test.ts
import { expect, it } from 'vitest';
import { CLARIFICATION_EVAL_CASES } from '@/lib/clarification-eval/clarification-eval-cases';
import { runClarificationEval } from '@/lib/clarification-eval/run-clarification-eval';
import { findClarificationModelConfig, requestClarificationQuestions } from '@/lib/clarification-model';

const config = process.env.FEEDBACK_AI_EVAL === '1' ? findClarificationModelConfig() : null;

it.runIf(config !== null)('measures questions about covered details on a real model', async () => {
  if (!config) {
    return;
  }
  const report = await runClarificationEval(
    CLARIFICATION_EVAL_CASES,
    (testCase, slots) => requestClarificationQuestions(config, testCase.context, slots),
  );
  console.table({
    '모델만 (모든 항목 제시)': { 질문: report.modelOnly.questions, '이미 아는 내용 질문': report.modelOnly.knownQuestions },
    '코드가 고른 빈 항목': { 질문: report.codeChosen.questions, '이미 아는 내용 질문': report.codeChosen.knownQuestions },
  });
  console.info(`항목 판정 일치 ${report.slotsJudgedCorrectly}/${report.slotsJudged}, 모델 호출 생략 ${report.skippedModelCalls}/${report.cases}`);
  expect(report.cases).toBe(CLARIFICATION_EVAL_CASES.length);
}, 300_000);
