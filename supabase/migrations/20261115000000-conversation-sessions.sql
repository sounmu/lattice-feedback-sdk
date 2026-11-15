begin;

alter table public.feedback
  add column browser_secret_hash text check (browser_secret_hash ~ '^[a-f0-9]{64}$'),
  add column verified_reporter_id text,
  add column messages jsonb not null default '[]'::jsonb
    check (jsonb_typeof(messages) = 'array' and jsonb_array_length(messages) <= 99);

-- Existing ids are unverified claims. Never backfill verified_reporter_id from reporter.
update public.feedback set messages = jsonb_build_array(jsonb_build_object(
  'id', id::text || ':legacy', 'authorRole', 'admin', 'body', admin_reply, 'createdAt', updated_at
)) where admin_reply is not null and admin_reply <> '';

create index feedback_verified_reporter on public.feedback(project_key, verified_reporter_id);
create index feedback_browser_secret on public.feedback(project_key, browser_secret_hash);

-- Each UPDATE holds a row lock, making the limit and append atomic even for concurrent admins.
create function public.append_admin_conversation_message() returns trigger
language plpgsql set search_path = public as $$
begin
  if new.admin_reply is not null and btrim(new.admin_reply) <> '' then
    if jsonb_array_length(old.messages) >= 99 then
      raise sqlstate 'PT409' using message = 'Conversation message limit reached.';
    end if;
    new.messages := old.messages || jsonb_build_array(jsonb_build_object(
      'id', gen_random_uuid(), 'authorRole', 'admin', 'body', new.admin_reply,
      'createdAt', clock_timestamp()
    ));
  end if;
  return new;
end;
$$;

create trigger append_admin_conversation_message
before update of admin_reply on public.feedback
for each row execute function public.append_admin_conversation_message();

create function public.read_reporter_conversations(
  p_project text, p_id uuid, p_hashes text[], p_reporter text
) returns setof public.feedback
language sql stable security invoker set search_path = public as $$
  select * from public.feedback
  where project_key = p_project and (p_id is null or id = p_id)
    and (browser_secret_hash = any(p_hashes)
      or (p_reporter is not null and verified_reporter_id = p_reporter))
  order by created_at desc, id desc limit 100;
$$;

create function public.append_reporter_message(
  p_project text, p_id uuid, p_hashes text[], p_reporter text, p_body text
) returns setof public.feedback
language plpgsql security invoker set search_path = public as $$
declare
  target public.feedback;
begin
  select * into target from public.feedback
    where project_key = p_project and id = p_id
      and (browser_secret_hash = any(p_hashes)
        or (p_reporter is not null and verified_reporter_id = p_reporter))
    for update;
  if not found then return; end if;
  if char_length(btrim(p_body)) < 1 or char_length(p_body) > 5000
    or jsonb_array_length(target.messages) >= 99 then
    raise sqlstate 'PT409' using message = 'Conversation message limit reached.';
  end if;
  return query update public.feedback set
    messages = target.messages || jsonb_build_array(jsonb_build_object(
      'id', gen_random_uuid(), 'authorRole', 'reporter', 'body', p_body,
      'createdAt', clock_timestamp()
    )), updated_at = clock_timestamp()
    where id = target.id and project_key = p_project returning *;
end;
$$;

revoke all on function public.append_admin_conversation_message() from public, anon, authenticated;
revoke all on function public.read_reporter_conversations(text, uuid, text[], text) from public, anon, authenticated;
revoke all on function public.append_reporter_message(text, uuid, text[], text, text) from public, anon, authenticated;
grant execute on function public.read_reporter_conversations(text, uuid, text[], text) to service_role;
grant execute on function public.append_reporter_message(text, uuid, text[], text, text) to service_role;

commit;
