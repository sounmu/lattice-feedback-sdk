import { NextResponse } from 'next/server';
import { areFeedbackAttachmentsAllowed } from '@/lib/capture-policy';
import { createClarificationContext, findClarificationModelConfig, requestClarificationQuestions } from '@/lib/clarification-model';
import { createApiErrorResponse } from '@/lib/http/api-error';
import { BodyTooLargeError, isDeclaredBodyTooLarge, readBodyTextWithLimit } from '@/lib/http/read-body';
import { consumeRateLimit, getClientAddress, RATE_LIMIT_RETRY_AFTER_SECONDS } from '@/lib/http/rate-limit';
import { isSameOriginRequest } from '@/lib/http/request-origin';
import { findProject, isOriginAllowed } from '@/lib/projects';
import { clarifyInputSchema } from '@/lib/validation/feedback-schema';
import type { ClarifyResponse } from '@/types/feedback';

const MAX_BODY_BYTES = 65536;
// Questions are asked once per feedback, so the same budget as sending feedback, counted separately.
const RATE_LIMIT_KEY_PREFIX = 'clarify:';

// fetch reports every network failure as "fetch failed"; the cause says which (refused, bad port, timeout).
function describeFailure(error: unknown): string {
  if (!(error instanceof Error)) {
    return 'unknown error';
  }
  const cause = error.cause instanceof Error ? ` (${error.cause.message})` : '';
  return `${error.message}${cause}`;
}

function createResponse(body: ClarifyResponse) {
  return NextResponse.json(body, { headers: { 'Cache-Control': 'no-store' } });
}

// Questions are optional: whenever none can be made, the answer is an empty list and the widget sends
// the feedback as it is.
export async function POST(request: Request) {
  if (!isSameOriginRequest(request)) {
    return createApiErrorResponse(403, 'cross_origin_request', 'Questions must be requested from the widget.');
  }
  if (!consumeRateLimit(`${RATE_LIMIT_KEY_PREFIX}${getClientAddress(request)}`)) {
    const response = createApiErrorResponse(429, 'rate_limited', 'Too many question requests. Try again later.');
    response.headers.set('Retry-After', String(RATE_LIMIT_RETRY_AFTER_SECONDS));
    return response;
  }
  if (isDeclaredBodyTooLarge(request, MAX_BODY_BYTES)) {
    return createApiErrorResponse(413, 'payload_too_large', 'Request body is too large.');
  }
  let json: unknown;
  try {
    json = JSON.parse(await readBodyTextWithLimit(request, MAX_BODY_BYTES));
  } catch (error) {
    if (error instanceof BodyTooLargeError) {
      return createApiErrorResponse(413, 'payload_too_large', 'Request body is too large.');
    }
    return createApiErrorResponse(400, 'invalid_json', 'Request body must be valid JSON.');
  }
  const parsed = clarifyInputSchema.safeParse(json);
  if (!parsed.success) {
    return createApiErrorResponse(400, 'invalid_body', 'Request body failed validation.');
  }
  const project = findProject(parsed.data.projectKey);
  if (!project) {
    return createApiErrorResponse(404, 'project_not_found', 'Project not found.');
  }
  if (!isOriginAllowed(project, parsed.data.hostOrigin)) {
    return createApiErrorResponse(403, 'origin_not_allowed', 'Origin is not allowed for this project.');
  }
  if (!areFeedbackAttachmentsAllowed(parsed.data, project.capturePolicy)) {
    return createApiErrorResponse(403, 'capture_not_allowed', 'Captured context is not allowed for this project.');
  }

  const config = findClarificationModelConfig();
  if (!config) {
    return createResponse({ questions: [], model: null });
  }
  try {
    const questions = await requestClarificationQuestions(config, createClarificationContext(parsed.data));
    return createResponse({ questions, model: questions.length > 0 ? config.model : null });
  } catch (error) {
    // The reason is logged without the feedback text; the reporter just sends without questions.
    console.warn('[clarify] No questions:', describeFailure(error));
    return createResponse({ questions: [], model: null });
  }
}
