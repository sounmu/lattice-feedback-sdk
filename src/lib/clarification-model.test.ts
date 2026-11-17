import { describe, expect, it, vi } from 'vitest';
import {
  CLARIFICATION_SYSTEM_PROMPT, createClarificationContext, findClarificationModelConfig, parseClarificationQuestions,
  requestClarificationQuestions, type ClarificationModelConfig,
} from '@/lib/clarification-model';
import type { ClarifyInput } from '@/types/feedback';

const CONFIG: ClarificationModelConfig = { baseUrl: 'http://localhost:11434/v1', model: 'deepseek-v4.1-flash', apiKey: null, timeoutMs: 5000 };
const TARGET = { selector: 'main > button', feedbackId: 'save-button', tagName: 'button', rect: { x: 0, y: 0, width: 80, height: 30 } };
const INPUT: ClarifyInput = {
  projectKey: 'demo',
  hostOrigin: 'http://localhost:4000',
  message: '저장이 안 돼요',
  type: 'bug',
  page: { url: 'http://localhost:4000/orders' },
  attachments: {
    comments: [{ target: TARGET, comment: '이 버튼' }],
    edits: [{
      target: TARGET, originalRect: TARGET.rect, proposedRect: { x: 40, y: 0, width: 80, height: 30 },
      viewportWidth: 1440, viewportHeight: 900, note: '',
    }],
    flow: { startedAt: '2026-11-17T00:00:00.000Z', endedAt: '2026-11-17T00:00:05.000Z', events: [{ type: 'click', offsetMs: 10, path: '/orders', targetLabel: 'save-button' }] },
  },
};

function createReply(content: string, status = 200): Response {
  return new Response(JSON.stringify({ choices: [{ message: { role: 'assistant', content } }] }), { status });
}

describe('findClarificationModelConfig', () => {
  it('stays off until an http endpoint and a model are set', () => {
    expect(findClarificationModelConfig({})).toBeNull();
    expect(findClarificationModelConfig({ FEEDBACK_AI_BASE_URL: 'http://localhost:11434/v1' })).toBeNull();
    expect(findClarificationModelConfig({ FEEDBACK_AI_BASE_URL: 'file:///etc', FEEDBACK_AI_MODEL: 'm' })).toBeNull();
  });

  it('reads the key and keeps the timeout between one and twenty seconds', () => {
    const environment = { FEEDBACK_AI_BASE_URL: ' http://ai.internal/v1 ', FEEDBACK_AI_MODEL: 'm', FEEDBACK_AI_API_KEY: 'k' };
    expect(findClarificationModelConfig(environment)).toEqual({ baseUrl: 'http://ai.internal/v1', model: 'm', apiKey: 'k', timeoutMs: 5000 });
    expect(findClarificationModelConfig({ ...environment, FEEDBACK_AI_TIMEOUT_MS: '60000' })?.timeoutMs).toBe(20000);
    expect(findClarificationModelConfig({ ...environment, FEEDBACK_AI_TIMEOUT_MS: '10' })?.timeoutMs).toBe(1000);
  });
});

describe('createClarificationContext', () => {
  it('passes the reporter words and recorded labels, and nothing about the reporter or the screen', () => {
    expect(createClarificationContext(INPUT)).toEqual({
      feedbackType: '버그',
      message: '저장이 안 돼요',
      pagePath: '/orders',
      comments: [{ element: expect.any(String), comment: '이 버튼' }],
      edits: [{ element: expect.any(String), change: '가로 +40px, 세로 0px 이동' }],
      flowSteps: ['`/orders`에서 `save-button` 클릭'],
    });
  });
});

describe('parseClarificationQuestions', () => {
  it('reads the JSON after a reasoning block or inside a code fence', () => {
    const content = '<think>버튼 위치는 이미 알려졌다</think>\n```json\n{"questions":[{"question":"저장 뒤 어떤 일이 있었나요?","options":["오류가 떴어요","아무 반응이 없었어요"]}]}\n```';
    expect(parseClarificationQuestions(content)).toEqual([
      { question: '저장 뒤 어떤 일이 있었나요?', options: ['오류가 떴어요', '아무 반응이 없었어요'] },
    ]);
  });

  it('drops questions that break a limit, removes repeated options and keeps at most two', () => {
    const questions = [
      { question: '하나', options: ['가', '가', '나'] },
      { question: '선택지 하나', options: ['가'] },
      { question: 'x'.repeat(201), options: ['가', '나'] },
      { question: '둘', options: ['가', 'x'.repeat(61), '나', '다', '라', '마'] },
      { question: '셋', options: ['가', '나'] },
    ];
    expect(parseClarificationQuestions(JSON.stringify({ questions }))).toEqual([
      { question: '하나', options: ['가', '나'] },
      { question: '둘', options: ['가', '나', '다', '라'] },
    ]);
  });

  it('gives no questions for text that is not the expected JSON', () => {
    expect(parseClarificationQuestions('질문이 없습니다')).toEqual([]);
    expect(parseClarificationQuestions('{"questions": "none"}')).toEqual([]);
    expect(parseClarificationQuestions('{"questions": [')).toEqual([]);
  });
});

describe('requestClarificationQuestions', () => {
  it('posts the rules and the context to the chat completions endpoint of the base URL', async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => createReply('{"questions":[{"question":"언제부터인가요?","options":["오늘","예전부터"]}]}'));
    const questions = await requestClarificationQuestions({ ...CONFIG, apiKey: 'local-key' }, createClarificationContext(INPUT), fetchMock);

    expect(questions).toEqual([{ question: '언제부터인가요?', options: ['오늘', '예전부터'] }]);
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toBe('http://localhost:11434/v1/chat/completions');
    expect((init?.headers as Record<string, string>).Authorization).toBe('Bearer local-key');
    const body = JSON.parse(String(init?.body));
    expect(body.model).toBe('deepseek-v4.1-flash');
    expect(body.messages[0]).toEqual({ role: 'system', content: CLARIFICATION_SYSTEM_PROMPT });
    expect(JSON.parse(body.messages[1].content)).toEqual(createClarificationContext(INPUT));
  });

  it('throws when the model answers with an error or without a message', async () => {
    await expect(requestClarificationQuestions(CONFIG, createClarificationContext(INPUT), async () => createReply('{}', 500))).rejects.toThrow('500');
    await expect(requestClarificationQuestions(CONFIG, createClarificationContext(INPUT), async () => new Response('{"choices":[]}'))).rejects.toThrow();
  });
});
