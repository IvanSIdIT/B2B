-- RAG: pgvector table + cosine similarity search
-- Run via Supabase SQL Editor or: supabase db push

create extension if not exists vector;

create table if not exists public.documents (
  id uuid primary key default gen_random_uuid(),
  content text not null,
  metadata jsonb not null default '{}'::jsonb,
  embedding vector(1536) not null,
  created_at timestamptz not null default now()
);

create index if not exists documents_embedding_idx
  on public.documents
  using hnsw (embedding vector_cosine_ops);

alter table public.documents enable row level security;

-- No public policies: only service_role (server ingest/search) can access rows.

create or replace function public.match_documents(
  query_embedding vector(1536),
  match_threshold float default 0.5,
  match_count int default 5
)
returns table (
  id uuid,
  content text,
  metadata jsonb,
  similarity float
)
language sql
stable
as $$
  select
    d.id,
    d.content,
    d.metadata,
    1 - (d.embedding <=> query_embedding) as similarity
  from public.documents d
  where 1 - (d.embedding <=> query_embedding) > match_threshold
  order by d.embedding <=> query_embedding
  limit match_count;
$$;

grant execute on function public.match_documents(vector, float, int) to service_role;
