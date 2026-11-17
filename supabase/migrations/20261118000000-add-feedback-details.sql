begin;

-- The details a ticket needs for the feedback's type ([{ slot, source, value }]), worked out by the server when
-- the feedback is stored. Null on feedback stored before details existed. The API validates the shape; the
-- check only keeps one row from growing without bound.
alter table public.feedback
  add column details jsonb
    check (details is null or (jsonb_typeof(details) = 'array' and pg_column_size(details) <= 4096));

commit;
