import type { FeedbackDetailResponse, FeedbackListResponse, UpdateFeedbackInput } from '@/types/feedback';

export type AdminApiResult<TData> = { ok: true; data: TData } | { ok: false; status: number; message: string };

export interface AdminRequestInput {
  projectKey: string;
  token: string;
}

export interface FeedbackDetailRequestInput extends AdminRequestInput {
  id: string;
}

export interface UpdateFeedbackRequestInput extends FeedbackDetailRequestInput {
  changes: UpdateFeedbackInput;
}

/** Status 0 means the request never reached the server. */
export const NETWORK_ERROR_STATUS = 0;
export const INVALID_RESPONSE_STATUS = 502;

const ERROR_MESSAGES: Record<number, string> = {
  [NETWORK_ERROR_STATUS]: '서버에 연결하지 못했어요. 네트워크를 확인해 주세요.',
  400: '입력한 내용이 올바르지 않아요.',
  401: '관리자 토큰이 올바르지 않아요.',
  404: '피드백을 찾을 수 없어요.',
  [INVALID_RESPONSE_STATUS]: '서버 응답 형식이 올바르지 않아요.',
  503: '저장소를 사용할 수 없어요. 잠시 후 다시 시도해 주세요.',
};
const FALLBACK_ERROR_MESSAGE = '요청을 처리하지 못했어요. 잠시 후 다시 시도해 주세요.';

export function findAdminErrorMessage(status: number): string {
  return ERROR_MESSAGES[status] ?? FALLBACK_ERROR_MESSAGE;
}

function createFailure(status: number): { ok: false; status: number; message: string } {
  return { ok: false, status, message: findAdminErrorMessage(status) };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isFeedbackLike(value: unknown): boolean {
  return isRecord(value) && typeof value.id === 'string' && typeof value.message === 'string';
}

export function isFeedbackListResponse(value: unknown): value is FeedbackListResponse {
  return isRecord(value) && Array.isArray(value.items) && value.items.every(isFeedbackLike);
}

export function isFeedbackDetailResponse(value: unknown): value is FeedbackDetailResponse {
  return isRecord(value) && isFeedbackLike(value.feedback) && Array.isArray(value.screenSnapshots);
}

interface RequestInitInput {
  method: 'GET' | 'PATCH';
  body?: unknown;
}

async function requestAdminApi<TData>(
  path: string,
  { projectKey, token }: AdminRequestInput,
  { method, body }: RequestInitInput,
  isValidBody: (value: unknown) => value is TData,
): Promise<AdminApiResult<TData>> {
  const headers: Record<string, string> = { Authorization: `Bearer ${token}` };
  if (body !== undefined) {
    headers['Content-Type'] = 'application/json';
  }

  let response: Response;
  try {
    response = await fetch(`${path}?projectKey=${encodeURIComponent(projectKey)}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      cache: 'no-store',
    });
  } catch {
    return createFailure(NETWORK_ERROR_STATUS);
  }

  if (!response.ok) {
    return createFailure(response.status);
  }
  const responseBody: unknown = await response.json().catch(() => null);
  if (!isValidBody(responseBody)) {
    return createFailure(INVALID_RESPONSE_STATUS);
  }
  return { ok: true, data: responseBody };
}

export function getFeedbackList(input: AdminRequestInput): Promise<AdminApiResult<FeedbackListResponse>> {
  return requestAdminApi('/api/feedback', input, { method: 'GET' }, isFeedbackListResponse);
}

export function getFeedbackDetail({ id, ...input }: FeedbackDetailRequestInput): Promise<AdminApiResult<FeedbackDetailResponse>> {
  return requestAdminApi(`/api/feedback/${encodeURIComponent(id)}`, input, { method: 'GET' }, isFeedbackDetailResponse);
}

export function updateFeedback({ id, changes, ...input }: UpdateFeedbackRequestInput): Promise<AdminApiResult<FeedbackDetailResponse>> {
  return requestAdminApi(
    `/api/feedback/${encodeURIComponent(id)}`,
    input,
    { method: 'PATCH', body: changes },
    isFeedbackDetailResponse,
  );
}
