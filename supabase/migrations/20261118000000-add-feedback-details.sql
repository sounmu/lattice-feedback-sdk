begin;

-- The details a ticket needs for the feedback's type ([{ slot, source, value }]), worked out by the server when
-- the feedback is stored. Null on feedback stored before details existed. The API validates the shape; the
-- check only keeps one row from growing without bound: five values of 300 characters at up to four bytes each,
-- plus their keys, stay well under it.
alter table public.feedback
  add column details jsonb
    check (details is null or (jsonb_typeof(details) = 'array' and pg_column_size(details) <= 16384));

commit;
