// Measures how often the questions ask for something the feedback already says, comparing two ways of
// choosing what to ask: the model alone, given every detail and told to skip the covered ones, and the
// code-chosen missing details (what /api/clarify does).
import type { ClarificationEvalCase } from '@/lib/clarification-eval/clarification-eval-cases';
import {
  CLARIFICATION_SLOTS_BY_TYPE, findMissingClarificationSlots, getClarificationSlotStates, type ClarificationSlotId,
} from '@/lib/clarification-slots';
import type { ClarificationQuestion } from '@/types/feedback';

export type ClarificationAsker = (testCase: ClarificationEvalCase, slots: readonly ClarificationSlotId[]) => Promise<ClarificationQuestion[]>;

export interface ClarificationEvalTally {
  questions: number;
  /** Questions about a detail the feedback already covers. */
  knownQuestions: number;
}

export interface ClarificationEvalReport {
  cases: number;
  /** Details whose covered-or-missing call matched the hand label. */
  slotsJudgedCorrectly: number;
  slotsJudged: number;
  modelOnly: ClarificationEvalTally;
  codeChosen: ClarificationEvalTally;
  /** Feedback sent without calling the model because nothing was missing. */
  skippedModelCalls: number;
}

function addQuestions(tally: ClarificationEvalTally, testCase: ClarificationEvalCase, questions: ClarificationQuestion[]) {
  tally.questions += questions.length;
  tally.knownQuestions += questions.filter(({ slot }) => !slot || !testCase.missing.includes(slot)).length;
}

export async function runClarificationEval(
  cases: readonly ClarificationEvalCase[],
  ask: ClarificationAsker,
): Promise<ClarificationEvalReport> {
  const report: ClarificationEvalReport = {
    cases: cases.length,
    slotsJudgedCorrectly: 0,
    slotsJudged: 0,
    modelOnly: { questions: 0, knownQuestions: 0 },
    codeChosen: { questions: 0, knownQuestions: 0 },
    skippedModelCalls: 0,
  };
  for (const testCase of cases) {
    for (const { id, status } of getClarificationSlotStates(testCase.type, testCase.context)) {
      report.slotsJudged += 1;
      if ((status === 'missing') === testCase.missing.includes(id)) {
        report.slotsJudgedCorrectly += 1;
      }
    }
    addQuestions(report.modelOnly, testCase, await ask(testCase, CLARIFICATION_SLOTS_BY_TYPE[testCase.type]));
    const missing = findMissingClarificationSlots(testCase.type, testCase.context);
    if (missing.length === 0) {
      report.skippedModelCalls += 1;
      continue;
    }
    addQuestions(report.codeChosen, testCase, await ask(testCase, missing));
  }
  return report;
}
