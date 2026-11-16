// Types for turning a feedback into a ticket in an external board. Types only.
import type { TicketDraft } from '@/lib/ticket-draft';

/** What the admin sends to become a ticket: the title and Markdown body of the (possibly edited) draft. */
export type TicketContent = Pick<TicketDraft, 'title' | 'body'>;

export interface CreateTicketResponse {
  ticket: {
    /** Link to the created Notion page. */
    url: string;
  };
}

/** The outcome of asking for the right to make a feedback's ticket. */
export type TicketClaim = { status: 'claimed' } | { status: 'created'; url: string } | { status: 'in_progress' };

/** Error codes the ticket endpoint adds to the standard API error body. */
export type TicketErrorCode =
  | 'ticket_not_configured'
  | 'ticket_target_not_shared'
  | 'ticket_target_invalid'
  | 'ticket_rate_limited'
  | 'ticket_in_progress'
  | 'ticket_failed';
