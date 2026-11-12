begin;

create table public.feedback (
  id uuid primary key default gen_random_uuid(),
  project_key text not null check (char_length(project_key) between 1 and 200),
  message text not null check (char_length(message) between 1 and 5000),
  type text not null check (type in ('bug', 'improvement', 'question', 'other')),
  status text not null default 'open' check (status in ('open', 'in_progress', 'resolved')),
  reporter jsonb not null check (jsonb_typeof(reporter) = 'object'),
  page jsonb not null check (jsonb_typeof(page) = 'object'),
  attachments jsonb not null default '{"comments":[],"edits":[],"flow":null}'::jsonb
    check (jsonb_typeof(attachments) = 'object'),
  admin_reply text check (char_length(admin_reply) <= 5000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index feedback_project_created_index on public.feedback (project_key, created_at desc, id desc);

-- The Next.js API authorizes each project; browsers have no direct table access.
alter table public.feedback enable row level security;
revoke all on public.feedback from public, anon, authenticated, service_role;
grant select, insert, update on public.feedback to service_role;

commit;
