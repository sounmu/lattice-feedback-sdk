begin;

-- The link to the ticket made from a feedback, and when a ticket was last started for it. The start time is
-- how two admins at once are told apart: only one UPDATE can set it while ticket_url is still empty.
alter table public.feedback
  add column ticket_url text
    check (ticket_url is null or (char_length(ticket_url) <= 2048 and ticket_url ~ '^https://')),
  add column ticket_claimed_at timestamptz;

commit;
