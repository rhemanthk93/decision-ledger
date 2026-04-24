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
    doc_date        timestamptz not null,    -- when the event happened
    ingested_at     timestamptz not null default now(),
    content         text not null,
    content_hash    text not null unique     -- SHA256, for dedupe
);

create index idx_documents_doc_date on documents(doc_date);

-- ============================================================
-- topic_clusters (Silver)
-- ============================================================
create table topic_clusters (
    id              uuid primary key default gen_random_uuid(),
    canonical_label text,                                       -- human-readable, set by detector/narrator
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
    narration   text,                             -- filled by narrator
    created_at  timestamptz not null default now(),
    unique (d1_id, d2_id)                         -- idempotent upsert key
);

create index idx_conflicts_cluster on conflicts(cluster_id);
create index idx_conflicts_narration_null on conflicts(id) where narration is null;

-- ============================================================
-- Realtime publication
-- ============================================================
-- Supabase Realtime listens to the 'supabase_realtime' publication.
-- Add the three tables the frontend subscribes to.
alter publication supabase_realtime add table decisions;
alter publication supabase_realtime add table conflicts;
alter publication supabase_realtime add table topic_clusters;
