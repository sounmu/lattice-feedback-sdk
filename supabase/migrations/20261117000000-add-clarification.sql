begin;

-- The questions the AI asked before a feedback was sent and the reporter's answers
-- ({ model, questions: [{ question, options, answer }] }). Null when nothing was asked. The API validates the
-- shape; the check only keeps one row from growing without bound.
alter table public.feedback
  add column clarification jsonb
    check (clarification is null or (jsonb_typeof(clarification) = 'object' and pg_column_size(clarification) <= 8192));

commit;
