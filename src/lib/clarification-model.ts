// Asks a model behind an OpenAI-compatible chat completions endpoint (a local server such as vLLM, Ollama or
// LM Studio) to word questions for details a feedback still lacks. Which details to ask about is decided in
// code (clarification-slots); the model only writes the sentences and choices, and a question about any
// other detail is dropped. Only the reporter's words and the labels the SDK recorded are sent: saved
// screens, page text, input values and the reporter's identity never are.
import {
  MAX_CLARIFICATION_OPTION_LENGTH, MAX_CLARIFICATION_OPTIONS, MAX_CLARIFICATION_QUESTION_LENGTH,
  MAX_CLARIFICATION_QUESTIONS, MIN_CLARIFICATION_OPTIONS,
} from '@/lib/clarification-limits';
import { describeMove, formatEditChange } from '@/lib/edit-comparison-geometry';
import { FEEDBACK_TYPE_LABELS, getPagePath } from '@/lib/feedback-display';
import { CLARIFICATION_SLOT_IDS, CLARIFICATION_SLOTS, type ClarificationSlotId } from '@/lib/clarification-slots';
import { describeTarget } from '@/lib/target-labels';
import { summarizeFlowSteps } from '@/lib/ticket-draft';
import type { ClarificationQuestion, ClarifyInput } from '@/types/feedback';

const DEFAULT_TIMEOUT_MS = 5_000;
const MIN_TIMEOUT_MS = 1_000;
const MAX_TIMEOUT_MS = 20_000;
const MAX_RESPONSE_TOKENS = 800;

export interface ClarificationModelConfig {
  /** Base of the OpenAI-compatible API, such as http://localhost:11434/v1. */
  baseUrl: string;
  model: string;
  apiKey: string | null;
  timeoutMs: number;
}

type Environment = Record<string, string | undefined>;

function findTrimmed(environment: Environment, name: string): string | null {
  const value = environment[name]?.trim();
  return value ? value : null;
}

function isHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}

function getTimeoutMs(value: string | null): number {
  const parsed = value === null ? Number.NaN : Number(value);
  if (!Number.isInteger(parsed)) {
    return DEFAULT_TIMEOUT_MS;
  }
  return Math.min(Math.max(parsed, MIN_TIMEOUT_MS), MAX_TIMEOUT_MS);
}

/** Null until an endpoint and a model are set: the widget then sends feedback without asking. */
export function findClarificationModelConfig(environment: Environment = process.env): ClarificationModelConfig | null {
  const baseUrl = findTrimmed(environment, 'FEEDBACK_AI_BASE_URL');
  const model = findTrimmed(environment, 'FEEDBACK_AI_MODEL');
  if (!baseUrl || !model || !isHttpUrl(baseUrl)) {
    return null;
  }
  return {
    baseUrl,
    model,
    apiKey: findTrimmed(environment, 'FEEDBACK_AI_API_KEY'),
    timeoutMs: getTimeoutMs(findTrimmed(environment, 'FEEDBACK_AI_TIMEOUT_MS')),
  };
}

/** What the model reads about a feedback. */
export interface ClarificationContext {
  feedbackType: string;
  message: string;
  pagePath: string;
  comments: { element: string; comment: string }[];
  edits: { element: string; change: string; note?: string }[];
  flowSteps: string[];
}

export function createClarificationContext(input: ClarifyInput): ClarificationContext {
  const comments = input.attachments?.comments ?? [];
  const edits = input.attachments?.edits ?? [];
  const flow = input.attachments?.flow ?? null;
  return {
    feedbackType: FEEDBACK_TYPE_LABELS[input.type],
    message: input.message,
    pagePath: getPagePath(input.page.url),
    comments: comments.map(({ target, comment }) => ({ element: describeTarget(target), comment })),
    edits: edits.map((edit) => ({
      element: describeTarget(edit.target),
      change: formatEditChange(describeMove(edit.originalRect, edit.proposedRect, edit.rotation)),
      ...(edit.note.trim() ? { note: edit.note } : {}),
    })),
    flowSteps: flow ? summarizeFlowSteps(flow).steps : [],
  };
}

export const CLARIFICATION_SYSTEM_PROMPT = [
  '너는 웹서비스 고객 피드백을 받는 담당자를 돕는다.',
  '고객이 쓴 설명과 SDK가 기록한 맥락(가리킨 요소와 의견, 위치·크기·각도 변경 제안, 조작 순서)을 읽고,',
  'askAbout에 적힌 항목마다 고객에게 물을 질문을 하나씩 만든다.',
  '규칙:',
  `- askAbout에 없는 항목은 묻지 않는다. 질문은 최대 ${MAX_CLARIFICATION_QUESTIONS}개다.`,
  '- 각 질문의 slot에는 askAbout의 slot 값을 그대로 적는다.',
  '- 고객 설명에 이미 그 항목의 답이 있으면 그 항목은 건너뛴다.',
  '- 이미 알려진 요소, 위치, 변경 내용, 클릭·이동 순서, 페이지는 다시 묻지 않는다.',
  `- 질문은 한 문장의 짧은 한국어 존댓말로, 고객이 고를 수 있는 선택지 ${MIN_CLARIFICATION_OPTIONS}~${MAX_CLARIFICATION_OPTIONS}개를 함께 준다.`,
  '- 선택지는 서로 겹치지 않는 짧은 표현으로 쓴다.',
  '- 원인을 단정하지 않고, 개인정보·계정·비밀번호는 묻지 않는다.',
  '- 다음 JSON 하나로만 답한다: {"questions":[{"slot":"...","question":"...","options":["...","..."]}]}',
].join('\n');

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

// Reasoning models put their thinking first and some wrap the JSON in a code fence; only the object is read.
function findJsonText(content: string): string | null {
  const answer = content.replace(/<think>[\s\S]*?<\/think>/g, '');
  const start = answer.indexOf('{');
  const end = answer.lastIndexOf('}');
  return start >= 0 && end > start ? answer.slice(start, end + 1) : null;
}

function findOptions(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  const options = value
    .filter((option): option is string => typeof option === 'string')
    .map((option) => option.trim())
    .filter((option) => option.length > 0 && option.length <= MAX_CLARIFICATION_OPTION_LENGTH);
  return [...new Set(options)].slice(0, MAX_CLARIFICATION_OPTIONS);
}

function isClarificationSlotId(value: unknown): value is ClarificationSlotId {
  return CLARIFICATION_SLOT_IDS.some((id) => id === value);
}

/**
 * The usable questions in a model's reply: one per asked-about detail, in the order given. A question about
 * another detail, or one that breaks a limit, is dropped, never shortened.
 */
export function parseClarificationQuestions(content: string, slots: readonly ClarificationSlotId[]): ClarificationQuestion[] {
  const jsonText = findJsonText(content);
  if (jsonText === null) {
    return [];
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonText);
  } catch {
    return [];
  }
  if (!isRecord(parsed) || !Array.isArray(parsed.questions)) {
    return [];
  }
  const questionsBySlot = new Map<ClarificationSlotId, ClarificationQuestion>();
  for (const item of parsed.questions) {
    if (!isRecord(item) || typeof item.question !== 'string' || !isClarificationSlotId(item.slot)) {
      continue;
    }
    const slot = item.slot;
    if (!slots.includes(slot) || questionsBySlot.has(slot)) {
      continue;
    }
    const question = item.question.trim();
    const options = findOptions(item.options);
    if (question.length === 0 || question.length > MAX_CLARIFICATION_QUESTION_LENGTH || options.length < MIN_CLARIFICATION_OPTIONS) {
      continue;
    }
    questionsBySlot.set(slot, { question, options, slot });
  }
  return slots.flatMap((slot) => questionsBySlot.get(slot) ?? []).slice(0, MAX_CLARIFICATION_QUESTIONS);
}

function getChatCompletionsUrl(baseUrl: string): URL {
  return new URL('chat/completions', baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`);
}

function findReplyContent(body: unknown): string | null {
  if (!isRecord(body) || !Array.isArray(body.choices)) {
    return null;
  }
  const [choice] = body.choices;
  if (!isRecord(choice) || !isRecord(choice.message) || typeof choice.message.content !== 'string') {
    return null;
  }
  return choice.message.content;
}

/** Throws when the model cannot be reached, answers with an error or runs past the timeout. */
export async function requestClarificationQuestions(
  config: ClarificationModelConfig,
  context: ClarificationContext,
  slots: readonly ClarificationSlotId[],
  fetchImplementation: typeof fetch = fetch,
): Promise<ClarificationQuestion[]> {
  const askAbout = slots.map((slot) => ({ slot, about: CLARIFICATION_SLOTS[slot].hint }));
  const response = await fetchImplementation(getChatCompletionsUrl(config.baseUrl), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(config.apiKey ? { Authorization: `Bearer ${config.apiKey}` } : {}),
    },
    body: JSON.stringify({
      model: config.model,
      temperature: 0.2,
      max_tokens: MAX_RESPONSE_TOKENS,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: CLARIFICATION_SYSTEM_PROMPT },
        { role: 'user', content: JSON.stringify({ ...context, askAbout }) },
      ],
    }),
    signal: AbortSignal.timeout(config.timeoutMs),
  });
  if (!response.ok) {
    throw new Error(`The clarification model answered ${response.status}.`);
  }
  const content = findReplyContent(await response.json());
  if (content === null) {
    throw new Error('The clarification model reply has no message.');
  }
  return parseClarificationQuestions(content, slots);
}
