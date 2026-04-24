# Run Decision Ledger locally

End-to-end: Python backend + Next.js frontend + live Supabase. ~5 min setup.

## One-time setup

```bash
# 1. Backend deps
cd backend
uv sync                 # installs Python deps via uv
cp .env.example .env    # if you haven't already
# fill in .env:
#   SUPABASE_URL=https://alrjqiehegqwxpejxups.supabase.co
#   SUPABASE_SERVICE_ROLE_KEY=<service-role secret from Supabase dashboard>
#   ANTHROPIC_API_KEY=sk-ant-...
#   GOOGLE_API_KEY=AIza...

# 2. Frontend deps (from repo root)
cd ..
pnpm install            # if you don't have pnpm: `corepack enable` first,
                        # or `COREPACK_INTEGRITY_KEYS=0 pnpm install` on newer Node

# 3. Frontend env — create .env.local at the repo root
cat > .env.local <<'EOF'
NEXT_PUBLIC_SUPABASE_URL=https://alrjqiehegqwxpejxups.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=<anon key, safe to commit>
NEXT_PUBLIC_BACKEND_URL=http://localhost:8000

# Server-side - used by the Next.js /api/query route (Ask Claude button).
# Same value as backend/.env's ANTHROPIC_API_KEY.
ANTHROPIC_API_KEY=sk-ant-api03-...
EOF
```

Notes:
- The **service-role key** is backend-only; never put it in `.env.local` (it bypasses RLS).
- The **anon key** is the one that starts with `sb_publishable_...` or the legacy `eyJhbG...` JWT marked `anon` in the Supabase dashboard.
- The **ANTHROPIC_API_KEY** is needed by the Next.js `/api/query` route (the chat/"Ask Claude" UI). Copy it from `backend/.env`. Without it, the chat silently returns empty responses.
- IMPORTANT: keep `.env.local` ASCII-only. Next.js's dotenv parser silently drops everything after a line containing an em dash (`—`, U+2014) or other non-ASCII characters, so do not paste fancy-quoted comments into this file.
- Database state is already seeded: 14 documents, 26 decisions (all clustered), 8 topic_clusters (all labeled), 6 conflicts (all narrated). You do not need to rerun the pipeline to see data.

## Daily run

Two terminals:

### Terminal 1 — Backend

```bash
cd backend
uv run uvicorn app.main:app --reload --port 8000
```

You should see:
```
INFO:     Uvicorn running on http://127.0.0.1:8000
... app.workers: started 4 extractor worker(s)
... app.workers: resolver interval worker started (every 20s)
... app.workers: narrator poll worker started (every 2s)
```

Sanity-check the backend:
```bash
curl http://localhost:8000/health
# -> {"status":"ok"}

curl http://localhost:8000/admin/status
# -> {"documents":14,"decisions":26,"topic_clusters":8,"conflicts":6, ...}
```

### Terminal 2 — Frontend

```bash
# From the repo root (NOT backend/)
pnpm dev
# -> Ready in ~4s, http://localhost:3000
```

Open http://localhost:3000/ledger in your browser.

## What you'll see

- **Timeline** — 26 decisions in chronological order, status badges driven by conflicts.
- **Clusters** — 8 topic clusters with `canonical_label` (Primary Datastore, PR Approval Policy, Custom Integrations, Production Deployment, Event Schema Versioning, Identity Graph TTL, Q2 Capacity Planning, Segment Adapter).
- **Conflicts** — 3 drift cards with teammate-voice narrations:
  - Drift #1 (Primary Datastore): silent reversal — Postgres ADR vs. PR #847 MongoDB migration
  - Drift #2 (PR Approval Policy): contradicts — 2-approval rule vs. P0/P1 + CVE hotfix carve-outs
  - Drift #3 (Custom Integrations): contradicts — $50k ARR gate vs. Lumino Segment-adapter spec

*(Drift #1 actually has 3 conflict rows and Drift #2 has 2, because the detector fires on every qualifying pair. The frontend renders each independently for now. See the notes in `backend/app/agents/detector.py` for dedupe options.)*

- **Refresh pipeline** button (top-right of the Ledger page) — calls `POST http://localhost:8000/admin/run-pipeline`, which runs `resolve → detect → narrate` synchronously and returns a summary. On an already-processed corpus this is a ~3s no-op; after a fresh `/ingest` it drives the backlog through the pipeline.
- **Realtime subscription** — any change to `decisions` / `conflicts` / `topic_clusters` in Supabase pushes a refresh to the page automatically. Open a second tab, click Refresh on one, watch the other update.

## How the pipeline runs

Two independent paths, both pointing at the same Supabase:

1. **Interval workers** (auto, started by `uv run uvicorn …`)
   - Extractor pool: 4 coroutines consuming the `raw_docs` asyncio queue. A `POST /ingest` call enqueues a `doc_id`; one worker loads the doc and extracts decisions.
   - Resolver: every 20 s, embeds any `decisions.topic_cluster_id IS NULL` rows via Gemini and greedily clusters.
   - Detector: runs right after the resolver in the same interval.
   - Narrator: polls `conflicts WHERE narration IS NULL` every 2 s and narrates via Sonnet.

2. **Refresh button** (manual)
   - `POST /admin/run-pipeline` fires the middle+back of the pipeline (resolve → detect → narrate) in one synchronous call. Returns a JSON summary the UI uses to stamp "last run" state.

## Re-seeding from scratch

If you truncate the DB or want a fresh demo state:

```bash
# in Supabase SQL editor:
truncate documents cascade;

# in a terminal:
cd backend
uv run python scripts/seed_from_fixtures.py    # POSTs all 14 fixtures → /ingest → workers extract
# wait ~30s for extractor consumers to drain the queue
uv run python scripts/run_extractor_once.py --all   # optional, idempotent re-extract if any docs lag

# cluster + detect + narrate:
#   option a: wait ~40s for interval workers to fire
#   option b: curl -X POST http://localhost:8000/admin/run-pipeline

# label the non-conflict clusters with Haiku:
uv run python scripts/label_remaining_clusters.py
```

## Troubleshooting

- **Frontend shows "getDecisions:" error in browser console.** `.env.local` isn't loaded. Restart `pnpm dev` after editing `.env.local`.
- **CORS error on `/admin/run-pipeline`.** Backend allows `http://localhost:3000` only. If you're on a different port, edit `backend/app/main.py` → `allow_origins`.
- **Backend says `ModuleNotFoundError: No module named 'app'`.** Run from `backend/`, not the repo root.
- **pnpm says "Cannot find matching keyid" via corepack.** Prefix with `COREPACK_INTEGRITY_KEYS=0`.
- **Page loads but tables are empty.** Check `curl http://localhost:8000/admin/status`. If `documents=0`, the DB was truncated. Re-seed per above.
- **"Ask Claude" button does nothing / returns empty.** The Next.js `/api/query` route calls Anthropic directly and needs `ANTHROPIC_API_KEY` in `.env.local` (server-side only, no `NEXT_PUBLIC_` prefix). Also: if you have non-ASCII characters in `.env.local` (em dashes, curly quotes, etc.), Next.js's dotenv parser drops every line after the offending character. Keep the file ASCII-only.
