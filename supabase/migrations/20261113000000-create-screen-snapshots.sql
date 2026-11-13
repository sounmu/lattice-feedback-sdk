begin;

create table public.screen_snapshots (
  id uuid primary key default gen_random_uuid(),
  project_key text not null check (char_length(project_key) between 1 and 200),
  feedback_id uuid references public.feedback (id) on delete cascade,
  format text not null check (format = 'rrweb-2'),
  captured_at timestamptz not null,
  page jsonb not null check (jsonb_typeof(page) = 'object'),
  events jsonb not null check (jsonb_typeof(events) = 'array'),
  missing_assets jsonb not null default '[]'::jsonb check (jsonb_typeof(missing_assets) = 'array'),
  created_at timestamptz not null default now()
);

create index screen_snapshots_feedback_index on public.screen_snapshots (project_key, feedback_id, created_at, id);

-- The Next.js API authorizes each project; browsers have no direct table access.
alter table public.screen_snapshots enable row level security;
revoke all on public.screen_snapshots from public, anon, authenticated, service_role;
grant select, insert, update on public.screen_snapshots to service_role;

commit;
