import { describe, expect, it } from 'vitest';
import { createFeedbackDetails } from '@/lib/feedback-details';
import { MAX_FEEDBACK_DETAIL_LENGTH } from '@/lib/feedback-details-limits';
import type { CreateFeedbackInput, ElementTarget } from '@/types/feedback';

const TARGET: ElementTarget = { selector: '#save', feedbackId: 'save-button', tagName: 'BUTTON', rect: { x: 0, y: 0, width: 80, height: 32 } };

const INPUT: CreateFeedbackInput = {
  projectKey: 'demo',
  hostOrigin: 'http://localhost:4000',
  message: '저장 버튼을 눌렀더니 오류가 떠요.',
  type: 'bug',
  reporter: { id: 'user-1', name: '홍길동' },
  page: { url: 'http://localhost:4000/orders', title: '주문', viewportWidth: 1280, viewportHeight: 800, userAgent: 'test' },
};

describe('createFeedbackDetails', () => {
  it('fills each field from an answer, the SDK record or the reporter sentence, and leaves the rest missing', () => {
    const details = createFeedbackDetails({
      ...INPUT,
      attachments: { comments: [], edits: [], flow: null },
      clarification: {
        model: 'local',
        questions: [
          { question: '원래는 어떻게 되어야 하나요?', options: ['저장 완료', '목록 이동'], slot: 'expected', answer: '저장 완료' },
          { question: '얼마나 자주 그런가요?', options: ['매번', '가끔'], slot: 'frequency', answer: null },
        ],
      },
    });
    expect(details).toEqual([
      { slot: 'actual', source: 'stated', value: '저장 버튼을 눌렀더니 오류가 떠요.' },
      { slot: 'expected', source: 'answered', value: '저장 완료' },
      { slot: 'steps', source: 'stated', value: '저장 버튼을 눌렀더니 오류가 떠요.' },
      { slot: 'frequency', source: 'missing', value: null },
      { slot: 'since', source: 'missing', value: null },
    ]);
  });

  it('takes the pointed elements and the proposed moves as recorded by the SDK', () => {
    const details = createFeedbackDetails({
      ...INPUT,
      type: 'improvement',
      message: '버튼이 너무 작아요',
      attachments: {
        comments: [{ target: TARGET, comment: '여기' }],
        edits: [],
        flow: null,
      },
    });
    expect(details.map(({ slot, source }) => [slot, source])).toEqual([['problem', 'stated'], ['desired', 'missing'], ['target', 'observed']]);
    expect(details[2].value).toContain('save-button');
  });

  it('never cuts an emoji in half', () => {
    const details = createFeedbackDetails({
      ...INPUT,
      clarification: { model: 'm', questions: [{ question: '무슨 일이?', options: ['a', 'b'], slot: 'actual', answer: '😀'.repeat(151) }] },
    });
    expect(details[0].value?.endsWith('😀…')).toBe(true);
  });

  it('cuts a long sentence to the stored limit', () => {
    const [actual] = createFeedbackDetails({ ...INPUT, message: `${'가'.repeat(400)} 오류가 떠요` });
    expect(actual.value).toHaveLength(MAX_FEEDBACK_DETAIL_LENGTH);
    expect(actual.value?.endsWith('…')).toBe(true);
  });
});
