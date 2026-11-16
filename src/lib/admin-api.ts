import type { FeedbackDetailResponse, FeedbackListResponse, UpdateFeedbackInput } from '@/types/feedback';
import type { CreateTicketResponse, TicketContent } from '@/types/ticket';

export type AdminApiResult<TData> = { ok: true; data: TData } | { ok: false; status: number; message: string };

export interface AdminRequestInput {
  projectKey: string;
  token: string;
}

export interface FeedbackDetailRequestInput extends AdminRequestInput {
  id: string;
}

export interface CreateTicketRequestInput extends FeedbackDetailRequestInput {
  ticket: TicketContent;
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
// Some endpoints say more than the status code does; their error code wins over the status message.
const ERROR_MESSAGES_BY_CODE: Record<string, string> = {
  ticket_not_configured: '노션 연결이 설정되지 않았거나 토큰이 올바르지 않아요. 서버 환경변수를 확인해 주세요.',
  ticket_target_not_shared: '노션 보드를 찾을 수 없어요. 보드에 연동 앱을 추가했는지 확인해 주세요.',
  ticket_target_invalid: '노션 보드가 티켓을 받아주지 않았어요. 제목 칼럼 이름을 확인해 주세요.',
  ticket_in_progress: '이미 올리는 중이거나 결과를 확인하는 중이에요. 잠시 뒤 노션 보드를 확인하고, 없으면 다시 시도해 주세요.',
  ticket_rate_limited: '노션이 요청을 잠시 제한하고 있어요. 조금 뒤에 다시 시도해 주세요.',
  ticket_failed: '노션에 티켓을 만들지 못했어요. 잠시 후 다시 시도해 주세요.',
};
const FALLBACK_ERROR_MESSAGE = '요청을 처리하지 못했어요. 잠시 후 다시 시도해 주세요.';

export function findAdminErrorMessage(status: number): string {
  return ERROR_MESSAGES[status] ?? FALLBACK_ERROR_MESSAGE;
}

function createFailure(status: number, errorCode?: string): { ok: false; status: number; message: string } {
  const codeMessage = errorCode === undefined ? undefined : ERROR_MESSAGES_BY_CODE[errorCode];
  return { ok: false, status, message: codeMessage ?? findAdminErrorMessage(status) };
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

function findErrorCode(value: unknown): string | undefined {
  if (!isRecord(value) || !isRecord(value.error)) {
    return undefined;
  }
  return typeof value.error.code === 'string' ? value.error.code : undefined;
}

export function isCreateTicketResponse(value: unknown): value is CreateTicketResponse {
  return isRecord(value) && isRecord(value.ticket) && typeof value.ticket.url === 'string';
}

interface RequestInitInput {
  method: 'GET' | 'PATCH' | 'POST';
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
    const errorBody: unknown = await response.json().catch(() => null);
    return createFailure(response.status, findErrorCode(errorBody));
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

export function createTicket({ id, ticket, ...input }: CreateTicketRequestInput): Promise<AdminApiResult<CreateTicketResponse>> {
  return requestAdminApi(`/api/feedback/${encodeURIComponent(id)}/ticket`, input, { method: 'POST', body: ticket }, isCreateTicketResponse);
}
