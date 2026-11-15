import { z } from 'zod';

export const MAX_TICKET_TITLE_LENGTH = 300;
export const MAX_TICKET_BODY_LENGTH = 20000;

export const ticketContentSchema = z.object({
  title: z.string().trim().min(1).max(MAX_TICKET_TITLE_LENGTH),
  body: z.string().max(MAX_TICKET_BODY_LENGTH),
});
