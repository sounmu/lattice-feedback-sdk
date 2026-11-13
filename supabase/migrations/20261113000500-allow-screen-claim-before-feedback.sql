begin;

-- Screens are claimed for a new feedback id before that feedback row is inserted, so the link
-- cannot be a foreign key. The API only ever writes ids it is about to insert.
alter table public.screen_snapshots drop constraint if exists screen_snapshots_feedback_id_fkey;

commit;
