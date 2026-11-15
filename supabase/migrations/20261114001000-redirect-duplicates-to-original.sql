begin;

-- When a feedback that has duplicates becomes a duplicate itself, its duplicates follow it to the new
-- original in the same transaction, so a duplicate never points at a duplicate.
create function public.redirect_feedback_duplicates() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  update public.feedback
    set duplicate_of = new.duplicate_of
    where project_key = new.project_key and duplicate_of = new.id;
  return null;
end;
$$;

create trigger feedback_duplicates_redirect
  after update on public.feedback
  for each row
  when (new.duplicate_of is not null and new.duplicate_of is distinct from old.duplicate_of)
  execute function public.redirect_feedback_duplicates();

commit;
