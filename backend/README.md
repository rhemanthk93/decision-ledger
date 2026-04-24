# Decision Ledger — Backend

FastAPI + Supabase + Claude/Gemini. Async write loop (extract → resolve → detect → narrate) plus a sync read loop (query resolver). See [decision_ledger_build_plan.pdf](../../Documentation/) for the full spec.

## Setup

Requires Python 3.11+ and [`uv`](https://docs.astral.sh/uv/).

```bash
cd backend

# 1. Install Python deps
uv sync

# 2. Configure secrets
cp .env.example .env
#    then fill in SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, ANTHROPIC_API_KEY, GOOGLE_API_KEY

# 3. Apply the migration (see below)
```

## Apply the migration

The single migration at `db/migrations/001_initial.sql` creates the 4 tables, the pgvector extension, the IVFFlat index, and the Realtime publication. Apply it **once** per Supabase project:

1. Open Supabase Studio → your project → **SQL Editor**.
2. Paste the full contents of `db/migrations/001_initial.sql` and run.
3. Verify in **Table Editor** that `documents`, `topic_clusters`, `decisions`, and `conflicts` exist.
4. Verify in **Database → Extensions** that `vector` is enabled.
5. Verify in **Database → Publications → supabase_realtime** that `decisions`, `conflicts`, and `topic_clusters` are listed.

> **Why the publication matters:** the frontend subscribes to Supabase Realtime on those three tables. If the `alter publication` block is skipped, the timeline won't update live.

## Run the server

```bash
cd backend
uv run uvicorn app.main:app --reload
```

Server listens on `http://localhost:8000`. Health check: `GET /health`.

## Smoke-test Supabase connectivity

```bash
cd backend
uv run python scripts/check_db.py
```

Reads one row from each of the 4 tables. Prints `Supabase connection OK` on success.

## Seed fixtures

`demo_data/` at the repo root holds the 14 canonical fixtures. The seeder POSTs each one to `/ingest`:

```bash
cd backend

# Seed everything
uv run python scripts/seed_from_fixtures.py

# Seed just Doc 01 (q1_arch_review)
uv run python scripts/seed_from_fixtures.py --only 01

# Preview the numbering without posting
uv run python scripts/seed_from_fixtures.py --dry-run
```

The seeder prints the full `doc_num → filename` table on every run — the numbering is derived from `(doc_date, source_type, filename)` so it is stable and matches the corpus guide's numbering.

## Layout

```
backend/
  app/
    main.py           FastAPI entry (GET /health)
    config.py         Model strings, thresholds, intervals
    db.py             Supabase client (service_role key)
    schemas.py        Pydantic RawDocument
    queue.py          raw_docs asyncio.Queue singleton
    routes/
      ingest.py       POST /ingest
    agents/           (Phase 2+)
  scripts/
    seed_from_fixtures.py
    check_db.py
  tests/              (Phase 2+)
  pyproject.toml
  .env.example
```

## Key notes

- **Service-role key** is required for backend writes (bypasses RLS). The anon key is for the frontend only.
- **`content_hash` is the dedupe key** — the unique constraint on `documents.content_hash` is load-bearing for the drip simulator. Do not drop it.
- **Models are hardcoded** in `app/config.py` per §5.2 — they are not env vars.
- **Free-tier projects auto-pause** after 7 days of no API calls. Hit `/health` on demo morning if there's a gap.
