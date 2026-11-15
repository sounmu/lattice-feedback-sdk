import { NextResponse } from 'next/server';
import { getFeedbackRepository } from '@/lib/feedback-repository';
import { FeedbackStorageUnavailableError } from '@/lib/feedback-storage-unavailable-error';
import { authorizeAdmin } from '@/lib/http/admin-auth';
import { createApiErrorResponse } from '@/lib/http/api-error';
import { consumeRateLimit, getClientAddress } from '@/lib/http/rate-limit';
import { BodyTooLargeError, readBodyTextWithLimit } from '@/lib/http/read-body';
import { createNotionTicket } from '@/lib/notion-client';
import { findNotionConfig } from '@/lib/notion-config';
import { findProject } from '@/lib/projects';
import { ticketContentSchema } from '@/lib/validation/ticket-schema';
import type { CreateTicketResponse, TicketErrorCode } from '@/types/ticket';

interface RouteContext {
  params: Promise<{ id: string }>;
}

const MAX_BODY_BYTES = 65536;
const MAX_TICKETS_PER_WINDOW = 20;

const TICKET_ERROR_STATUS: Record<TicketErrorCode, number> = {
  ticket_not_configured: 503,
  ticket_target_not_shared: 502,
  ticket_target_invalid: 502,
  ticket_rate_limited: 429,
  ticket_failed: 502,
};

const TICKET_ERROR_MESSAGE: Record<TicketErrorCode, string> = {
  ticket_not_configured: 'Notion is not configured or its token was rejected.',
  ticket_target_not_shared: 'The Notion board was not found. Share it with the integration.',
  ticket_target_invalid: 'The Notion board rejected the ticket. Check the title column name.',
  ticket_rate_limited: 'Notion is limiting requests. Try again shortly.',
  ticket_failed: 'The ticket could not be created in Notion.',
};

function createTicketErrorResponse(code: TicketErrorCode) {
  return createApiErrorResponse(TICKET_ERROR_STATUS[code], code, TICKET_ERROR_MESSAGE[code]);
}

// Creates a Notion page from the draft the admin edited. The feedback must exist, so a ticket is never
// made for an id that is not in this project.
export async function POST(request: Request, context: RouteContext) {
  const { id } = await context.params;
  const projectKey = new URL(request.url).searchParams.get('projectKey') ?? '';
  const project = findProject(projectKey);
  if (!project) {
    return createApiErrorResponse(404, 'project_not_found', 'Project not found.');
  }
  if (!authorizeAdmin(request, project)) {
    return createApiErrorResponse(401, 'unauthorized', 'Admin authorization is required.');
  }
  if (!consumeRateLimit(`admin-ticket:${projectKey}:${getClientAddress(request)}`, Date.now(), MAX_TICKETS_PER_WINDOW)) {
    return createApiErrorResponse(429, 'rate_limited', 'Try again later.');
  }

  let json: unknown;
  try {
    json = JSON.parse(await readBodyTextWithLimit(request, MAX_BODY_BYTES));
  } catch (error) {
    if (error instanceof BodyTooLargeError) return createApiErrorResponse(413, 'payload_too_large', 'Request too large.');
    return createApiErrorResponse(400, 'invalid_json', 'Request body must be valid JSON.');
  }
  const parsed = ticketContentSchema.safeParse(json);
  if (!parsed.success) {
    return createApiErrorResponse(400, 'invalid_body', 'Request body failed validation.');
  }

  const config = findNotionConfig();
  if (!config) {
    return createTicketErrorResponse('ticket_not_configured');
  }

  try {
    const feedback = await getFeedbackRepository().find(project.projectKey, id);
    if (!feedback) {
      return createApiErrorResponse(404, 'feedback_not_found', 'Feedback not found.');
    }
    const result = await createNotionTicket(config, parsed.data);
    if (!result.ok) {
      return createTicketErrorResponse(result.code);
    }
    const body: CreateTicketResponse = { ticket: { url: result.url } };
    return NextResponse.json(body, { status: 201 });
  } catch (error) {
    if (error instanceof FeedbackStorageUnavailableError) {
      return createApiErrorResponse(503, 'storage_unavailable', error.message);
    }
    throw error;
  }
}
