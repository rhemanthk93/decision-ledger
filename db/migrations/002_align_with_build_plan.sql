-- Align an existing Supabase project's schema with build plan §6.
--
-- Background. An earlier draft of the build plan produced a schema with
--   - `topics` instead of `topic_clusters`
--   - text-typed ids instead of uuid
--   - `decision_type` / `relationship` instead of `type` / `rule`
--   - `decision_a_id` / `decision_b_id` instead of `d1_id` / `d2_id`
--   - no `consistent` value in the rule enum
--   - no unique(d1_id, d2_id) upsert key
--   - RLS enabled (the PDF explicitly leaves RLS off for the hackathon)
-- This migration drops that schema and recreates the §6 tables.
--
-- Use this migration when aligning an existing Supabase project. For a
-- fresh project, apply only db/migrations/001_initial.sql (the §6 schema
-- without drops).
--
-- Safety. Requires the target tables to be empty — there is no data
-- preservation. The hackathon project was empty when this was applied
-- (verified via MCP pre-flight).

drop table if exists public.conflicts       cascade;
drop table if exists public.decisions       cascade;
drop table if exists public.topics          cascade;
drop table if exists public.topic_clusters  cascade;
drop table if exists public.documents       cascade;

-- pgvector for embeddings
create extension if not exists vector;

-- ============================================================
-- documents (Bronze)
-- ============================================================
create table documents (
    id              uuid primary key default gen_random_uuid(),
    source_type     text not null check (source_type in
                        ('meeting', 'slack', 'adr', 'spec', 'pr')),
    filename        text not null,
    doc_date        timestamptz not null,
    ingested_at     timestamptz not null default now(),
    content         text not null,
    content_hash    text not null unique
);

create index idx_documents_doc_date on documents(doc_date);

-- ============================================================
-- topic_clusters (Silver)
-- ============================================================
create table topic_clusters (
    id              uuid primary key default gen_random_uuid(),
    canonical_label text,
    centroid        vector(768) not null,
    created_at      timestamptz not null default now(),
    updated_at      timestamptz not null default now()
);

-- ============================================================
-- decisions (Silver)
-- ============================================================
create table decisions (
    id              uuid primary key default gen_random_uuid(),
    document_id     uuid not null references documents(id) on delete cascade,
    statement       text not null,
    topic_keywords  text[] not null default '{}',
    type            text not null check (type in
                        ('architectural', 'process', 'product', 'action')),
    decided_at      timestamptz not null,
    decided_by      text[] not null default '{}',
    source_excerpt  text not null,
    confidence      real not null check (confidence between 0 and 1),
    embedding       vector(768),
    topic_cluster_id uuid references topic_clusters(id) on delete set null,
    created_at      timestamptz not null default now()
);

create index idx_decisions_cluster_date
    on decisions(topic_cluster_id, decided_at);
create index idx_decisions_embedding
    on decisions using ivfflat (embedding vector_cosine_ops)
    with (lists = 10);

-- ============================================================
-- conflicts (Gold)
-- ============================================================
create table conflicts (
    id          uuid primary key default gen_random_uuid(),
    cluster_id  uuid not null references topic_clusters(id) on delete cascade,
    d1_id       uuid not null references decisions(id) on delete cascade,
    d2_id       uuid not null references decisions(id) on delete cascade,
    rule        text not null check (rule in
                    ('supersedes', 'reverses', 'contradicts',
                     'silent_reversal', 'consistent')),
    narration   text,
    created_at  timestamptz not null default now(),
    unique (d1_id, d2_id)
);

create index idx_conflicts_cluster on conflicts(cluster_id);
create index idx_conflicts_narration_null on conflicts(id) where narration is null;

-- ============================================================
-- Realtime publication
-- ============================================================
alter publication supabase_realtime add table decisions;
alter publication supabase_realtime add table conflicts;
alter publication supabase_realtime add table topic_clusters;
