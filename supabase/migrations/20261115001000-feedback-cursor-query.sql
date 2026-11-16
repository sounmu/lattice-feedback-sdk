begin;

-- The REST OR filter scans and discards earlier rows even with the ordering index.
-- Keep the same exclusive cursor, including UUID ties, as a single index range.
create function public.read_feedback_before(
  p_project text, p_created_at timestamptz, p_id uuid
) returns setof public.feedback
language sql stable security invoker as $$
  select * from public.feedback
  where project_key = p_project and (created_at, id) < (p_created_at, p_id)
  order by created_at desc, id desc limit 100;
$$;

-- As with feedback table reads, the server authorizes the project before calling.
revoke all on function public.read_feedback_before(text, timestamptz, uuid) from public, anon, authenticated;
grant execute on function public.read_feedback_before(text, timestamptz, uuid) to service_role;

commit;
