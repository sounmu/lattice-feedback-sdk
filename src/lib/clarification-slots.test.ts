import { describe, expect, it } from 'vitest';
import type { ClarificationContext } from '@/lib/clarification-model';
import { findMissingClarificationSlots, getClarificationSlotStates } from '@/lib/clarification-slots';

const EMPTY: ClarificationContext = { feedbackType: '버그', message: '', pagePath: '/', comments: [], edits: [], flowSteps: [] };

describe('getClarificationSlotStates', () => {
  it('marks what the SDK recorded as observed, what the reporter wrote as stated and the rest as missing', () => {
    const context = { ...EMPTY, message: '어제부터 저장이 안 돼요', flowSteps: ['`/orders`에서 `저장` 클릭'] };
    expect(getClarificationSlotStates('bug', context)).toEqual([
      { id: 'actual', status: 'stated' },
      { id: 'expected', status: 'missing' },
      { id: 'steps', status: 'observed' },
      { id: 'frequency', status: 'missing' },
      { id: 'since', status: 'stated' },
    ]);
  });

  it('reads comments and edit notes as the reporter words, and takes an edit as the desired look and target', () => {
    const context = {
      ...EMPTY,
      comments: [{ element: '버튼', comment: '글씨가 작아서 불편해요' }],
      edits: [{ element: '버튼', change: '가로 +40px 이동' }],
    };
    expect(getClarificationSlotStates('improvement', context).map(({ status }) => status)).toEqual(['stated', 'observed', 'observed']);
  });
});

describe('findMissingClarificationSlots', () => {
  it('returns the first missing details, at most two, and none when nothing is missing', () => {
    expect(findMissingClarificationSlots('bug', EMPTY)).toEqual(['actual', 'expected']);
    expect(findMissingClarificationSlots('question', { ...EMPTY, message: '엑셀로 받으려면 어떻게 해요?', comments: [{ element: '표', comment: '' }] })).toEqual([]);
  });
});
