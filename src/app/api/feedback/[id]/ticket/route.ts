import { NextResponse } from 'next/server';
import { getFeedbackRepository } from '@/lib/feedback-repository';
import { FeedbackStorageUnavailableError } from '@/lib/feedback-storage-unavailable-error';
import { authorizeAdmin } from '@/lib/http/admin-auth';
import { createApiErrorResponse } from '@/lib/http/api-error';
import { createNotionTicket } from '@/lib/notion-client';
import { findNotionConfig } from '@/lib/notion-config';
import { findProject } from '@/lib/projects';
import { buildTicketDraft } from '@/lib/ticket-draft';
import type { CreateTicketResponse, TicketErrorCode } from '@/types/ticket';

interface RouteContext {
  params: Promise<{ id: string }>;
}

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

function createAdminUrl(request: Request, projectKey: string, id: string): string {
  const { origin } = new URL(request.url);
  return `${origin}/admin/feedback/${encodeURIComponent(id)}?projectKey=${encodeURIComponent(projectKey)}`;
}

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

  const config = findNotionConfig();
  if (!config) {
    return createTicketErrorResponse('ticket_not_configured');
  }

  try {
    const feedback = await getFeedbackRepository().find(project.projectKey, id);
    if (!feedback) {
      return createApiErrorResponse(404, 'feedback_not_found', 'Feedback not found.');
    }
    const draft = buildTicketDraft({ feedback, adminUrl: createAdminUrl(request, project.projectKey, feedback.id) });
    const result = await createNotionTicket(config, draft);
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
