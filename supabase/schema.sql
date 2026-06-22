  -- Run this in the Supabase SQL Editor (Dashboard → SQL → New query).

  create table if not exists public.error_logs (
    id uuid primary key default gen_random_uuid(),
    worker_message text not null,
    broken_part text,
    severity text check (severity in ('low', 'medium', 'high', 'critical')),
    action_plan text,
    created_at timestamptz not null default now()
  );

  alter table public.error_logs enable row level security;

  create policy "Allow anonymous read"
    on public.error_logs
    for select
    to anon, authenticated
    using (true);

  create policy "Allow anonymous insert"
    on public.error_logs
    for insert
    to anon, authenticated
    with check (true);

  alter publication supabase_realtime add table public.error_logs;

-- RAG documents + pgvector (see supabase/migrations/20260621200000_documents_rag.sql)
-- Ingest local docs: pip install -r requirements-ingest.txt && python ingest.py --replace

-- Profiles (see supabase/migrations/20260621120000_profiles.sql)

-- Default logins (create via: npm run seed:users)
--   worker:  ivan@noob.com / 123
--   manager: matvik@pro.com / 123
