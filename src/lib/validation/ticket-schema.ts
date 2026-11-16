import { z } from 'zod';

import { MAX_TICKET_BODY_LENGTH, MAX_TICKET_TITLE_LENGTH } from '@/lib/ticket-limits';

export const ticketContentSchema = z.object({
  title: z.string().trim().min(1).max(MAX_TICKET_TITLE_LENGTH),
  body: z.string().max(MAX_TICKET_BODY_LENGTH),
});
