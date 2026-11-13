begin;

-- Fonts and images of saved screens, stored once per project and content hash.
create table public.screen_snapshot_assets (
  project_key text not null check (char_length(project_key) between 1 and 200),
  hash text not null check (hash ~ '^[0-9a-f]{64}$'),
  content_type text not null check (char_length(content_type) between 1 and 100),
  byte_size integer not null check (byte_size between 0 and 3145728),
  data bytea not null,
  created_at timestamptz not null default now(),
  primary key (project_key, hash)
);

alter table public.screen_snapshots
  add column asset_hashes jsonb not null default '[]'::jsonb check (jsonb_typeof(asset_hashes) = 'array');

-- The Next.js API authorizes each project; browsers have no direct table access.
alter table public.screen_snapshot_assets enable row level security;
revoke all on public.screen_snapshot_assets from public, anon, authenticated, service_role;
grant select, insert on public.screen_snapshot_assets to service_role;

commit;
