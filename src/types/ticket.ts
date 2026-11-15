// Types for turning a feedback into a ticket in an external board. Types only.

export interface CreateTicketResponse {
  ticket: {
    /** Link to the created Notion page. */
    url: string;
  };
}

/** Error codes the ticket endpoint adds to the standard API error body. */
export type TicketErrorCode =
  | 'ticket_not_configured'
  | 'ticket_target_not_shared'
  | 'ticket_target_invalid'
  | 'ticket_rate_limited'
  | 'ticket_failed';
