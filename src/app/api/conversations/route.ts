import { NextResponse } from 'next/server';
import { ConversationLimitError, getConversationMessages } from '@/lib/conversation';
import { getFeedbackRepository } from '@/lib/feedback-repository';
import { FeedbackStorageUnavailableError } from '@/lib/feedback-storage-unavailable-error';
import { createApiErrorResponse } from '@/lib/http/api-error';
import { consumeRateLimit, getClientAddress } from '@/lib/http/rate-limit';
import { BodyTooLargeError, readBodyTextWithLimit } from '@/lib/http/read-body';
import { isSameOriginRequest } from '@/lib/http/request-origin';
import { findProject, isOriginAllowed } from '@/lib/projects';
import { findVerifiedReporterId, hashConversationSecret } from '@/lib/reporter-identity';
import { conversationPostSchema, conversationRequestSchema } from '@/lib/validation/conversation-schema';
import type { Feedback } from '@/types/feedback';

// Reporter responses deliberately exclude saved screens, page metadata and private access fields.
function getThread(feedback: Feedback) {
  return { id: feedback.id, status: feedback.status, createdAt: feedback.createdAt, messages: getConversationMessages(feedback) };
}

async function handleRequest(request: Request, write: boolean) {
  if (!isSameOriginRequest(request)) return createApiErrorResponse(403, 'cross_origin_request', 'Use the widget.');
  const key = `conversation:${write ? 'write' : 'read'}:${getClientAddress(request)}`;
  if (!consumeRateLimit(key, Date.now(), write ? 20 : 120)) {
    const response = createApiErrorResponse(429, 'rate_limited', 'Try again later.');
    response.headers.set('Retry-After', '60');
    return response;
  }
  try {
    const raw = await readBodyTextWithLimit(request, 32768);
    let json: unknown;
    try {
      json = JSON.parse(raw);
    } catch {
      return createApiErrorResponse(400, 'invalid_json', 'Invalid JSON.');
    }
    const parsed = (write ? conversationPostSchema : conversationRequestSchema).safeParse(json);
    if (!parsed.success) return createApiErrorResponse(400, 'invalid_body', 'Invalid conversation request.');
    const input = parsed.data;
    const project = findProject(input.projectKey);
    if (!project) return createApiErrorResponse(404, 'project_not_found', 'Project not found.');
    if (!isOriginAllowed(project, input.hostOrigin)) return createApiErrorResponse(403, 'origin_not_allowed', 'Origin not allowed.');
    const credentials = {
      verifiedReporterId: findVerifiedReporterId(project, input.reporter),
      browserSecretHashes: input.secrets.map(hashConversationSecret),
    };
    const repository = getFeedbackRepository();
    if ('message' in input && typeof input.message === 'string' && 'feedbackId' in input && typeof input.feedbackId === 'string') {
      const feedback = await repository.appendReporterMessage(project.projectKey, input.feedbackId, { credentials, body: input.message });
      if (!feedback) return createApiErrorResponse(404, 'conversation_not_found', 'Conversation not found.');
      return NextResponse.json({ thread: getThread(feedback) }, { headers: { 'Cache-Control': 'no-store' } });
    }
    const items = await repository.findMany(project.projectKey, credentials);
    return NextResponse.json({ threads: items.slice(0, 100).map(getThread) }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    if (error instanceof BodyTooLargeError) return createApiErrorResponse(413, 'payload_too_large', 'Request too large.');
    if (error instanceof ConversationLimitError) return createApiErrorResponse(409, 'conversation_full', error.message);
    if (error instanceof FeedbackStorageUnavailableError) return createApiErrorResponse(503, 'storage_unavailable', error.message);
    throw error;
  }
}

// POST avoids placing bearer proofs in URLs, logs, history or referrers.
export function POST(request: Request) {
  return handleRequest(request, false);
}

export function PUT(request: Request) {
  return handleRequest(request, true);
}
