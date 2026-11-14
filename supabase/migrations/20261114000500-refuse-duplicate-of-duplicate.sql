begin;

-- An original must not itself be a duplicate, or two feedbacks could end up pointing at each other.
-- The original's row is locked while it is checked, so two concurrent updates cannot both pass.
create function public.check_feedback_duplicate_original() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.duplicate_of is null then
    return new;
  end if;
  if tg_op = 'UPDATE' then
    if new.duplicate_of is not distinct from old.duplicate_of then
      return new;
    end if;
  end if;
  perform 1 from public.feedback
    where project_key = new.project_key and id = new.duplicate_of and status <> 'duplicate'
    for share;
  if not found then
    raise exception 'The original of a duplicate must be a feedback that is not itself a duplicate.'
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

create trigger feedback_duplicate_original_check
  before insert or update on public.feedback
  for each row execute function public.check_feedback_duplicate_original();

commit;
