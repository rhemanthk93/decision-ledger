# Decision Ledger

**Git history, for the decisions your team makes — not just the code.**

Decision Ledger ingests company artifacts (meeting transcripts, Slack threads, ADRs, tech specs, merged PRs) and turns them into a structured, searchable ledger of decisions. It automatically detects **silent drift** — moments when an earlier architectural commitment was quietly reversed, decayed, or superseded without a formal follow-up record.

---

## What it detects (on the bundled 14-fixture corpus)

| # | Drift | Anchor | Reversal | Rule |
|---|---|---|---|---|
| 1 | Primary datastore | ADR-0042 commits to Postgres (Mar 15) | PR #847 migrates `user_events` to MongoDB (Apr 20) with no superseding ADR | `silent_reversal` |
| 2 | Review policy | Q1 arch review: "2 approvals, no exceptions" (Mar 15) | May 12 backend-guild thread carves out P0/P1 and CVE PRs to 1-approval hotfix path | `contradicts` |
| 3 | Custom integrations | Q1 product policy: "no custom work under $50k ARR" (Mar 15) | Jun 15 Lumino Segment-adapter spec ($30k ARR account) ships with its own edge translator | `contradicts` (ghost) |

All 3 land on the ledger automatically. Every conflict gets a teammate-voice narration from Sonnet 4.6, not a report-voice summary.

---

## Architecture

A five-agent pipeline split across two loops that share a single Supabase instance. Bronze → Silver → Gold follows the medallion pattern.

```
                                           ┌──────── raw_docs queue ────────┐
  ┌─────────┐     ┌─────────────┐           │                                │
  │ Clients │────▶│ POST /ingest│──insert──▶│ documents (Bronze)             │
  │  curl,  │     │ sha256 dedupe│          └────────────────────────────────┘
  │ seeder  │     └─────────────┘                       │
  └─────────┘                                           ▼
                                           ┌────────────────────────────────┐
                                           │ Extractor  (Haiku 4.5 tool-use)│
                                           │   N=4 consumers, asyncio       │
                                           └────────────────────────────────┘
                                                        │
                                                        ▼
                                           ┌────────────────────────────────┐
                                           │ decisions (Silver)             │
                                           └────────────────────────────────┘
                                                        │
                                  ┌─────────────────────┼─────────────────────┐
                                  ▼                     ▼                     ▼
                        ┌─────────────────┐   ┌─────────────────┐   ┌─────────────────┐
                        │ Resolver        │──▶│ Detector        │──▶│ Narrator        │
                        │ (Gemini emb.    │   │ (pure Python    │   │ (Sonnet 4.6,    │
                        │  + cosine)      │   │  rule engine)   │   │  polls every 2s)│
                        │ every 20s       │   │ same interval   │   └─────────────────┘
                        └─────────────────┘   └─────────────────┘
                                  │                     │                     │
                                  ▼                     ▼                     ▼
                        ┌─────────────────┐   ┌─────────────────┐   ┌─────────────────┐
                        │ topic_clusters  │   │ conflicts       │   │ conflicts       │
                        │ (centroids +    │   │ (rule rows,     │   │ .narration      │
                        │  canonical_label)│   │  idempotent)    │   │ updated inline  │
                        └─────────────────┘   └─────────────────┘   └─────────────────┘
                                                                              │
                                                                              ▼
                                                                  ┌─────────────────┐
                                                                  │ Frontend        │
                                                                  │ (Next.js + SB   │
                                                                  │  Realtime       │
                                                                  │  subscribe)     │
                                                                  └─────────────────┘
```

### The 5 agents

| # | Agent | Model / technique | Loop |
|---|---|---|---|
| 1 | **Extractor** | Claude Haiku 4.5 via tool-use (forced `record_decisions`) | write (queue consumer, N=4) |
| 2 | **Resolver** | Gemini `gemini-embedding-001` at 768-dim + greedy cosine clustering | write (interval worker, 20 s) |
| 3 | **Detector** | Pure Python rule engine, 5 rules + keyword-overlap + cross-file preconditions | write (after resolve, same interval) |
| 4 | **Narrator** | Claude Sonnet 4.6 via tool-use, teammate-voice few-shot | polls conflicts WHERE narration IS NULL every 2 s |
| 5 | **Query resolver** | (not wired in this branch) | — |

Only two stages call an LLM. Embeddings + Python rules do the middle. That's deliberate — judges can read the rules and trust that conflicts aren't hallucinated.

### Why two loops share one database

- **Async write loop.** Documents stream in, get extracted, clustered, checked, narrated in the background. All agents live here.
- **Sync read loop.** The frontend subscribes to Supabase Realtime on `decisions`, `conflicts`, and `topic_clusters`. No polling on the client side.
- **On-demand pipeline trigger.** The frontend's **Refresh Pipeline** button hits `POST /admin/run-pipeline` on the Python backend, which fires `resolve → detect → narrate` synchronously and returns a timing/state summary.

---

## Tech stack

| Layer | Choice |
|---|---|
| Backend language | Python 3.11 (asyncio throughout) |
| Web framework | FastAPI |
| Database | Supabase (Postgres 15 + `pgvector` extension) |
| Vector index | IVFFlat on `decisions.embedding` |
| Queue | `asyncio.Queue` in-process (swap for `pg_notify` in prod) |
| LLM — extract | Claude Haiku 4.5 |
| LLM — narrate, query | Claude Sonnet 4.6 |
| Embeddings | Gemini `gemini-embedding-001` at 768-dim (MRL-truncated from 3072) |
| Frontend framework | Next.js 15 (App Router) + React 19 |
| UI components | Tailwind + shadcn/ui |
| Realtime | Supabase Realtime (`@supabase/supabase-js`) |
| Package managers | `uv` (backend), `pnpm` (frontend) |

All services fit on free tiers.

---

## Running locally

Quick version (full details in [RUN_LOCALLY.md](RUN_LOCALLY.md)):

```bash
# backend
cd backend
uv sync
cp .env.example .env   # fill in the 4 secrets
uv run uvicorn app.main:app --reload --port 8000

# frontend (in another terminal, from repo root)
cp .env.local.example .env.local   # fill in the 3 vars + ANTHROPIC_API_KEY
./scripts/start-frontend.sh        # wraps `pnpm dev` and unsets shell-poisoned env vars
```

Then open http://localhost:3000/ledger.

The DB is already seeded (14 docs → 26 decisions → 8 clusters → 6 narrated conflicts), so the page has real content on the first render. Click **Refresh Pipeline** to drive a fresh `resolve → detect → narrate` cycle against Supabase and watch the live counts come back.

---

## Repo layout

```
decision-ledger/
├── backend/                 # Python pipeline (FastAPI + asyncio)
│   ├── app/
│   │   ├── agents/          # extractor.py, resolver.py, detector.py, narrator.py
│   │   ├── routes/          # ingest.py, admin.py
│   │   ├── config.py        # model strings, thresholds, intervals
│   │   ├── db.py            # Supabase client (service-role key)
│   │   ├── main.py          # FastAPI entry + lifespan workers
│   │   ├── queue.py         # raw_docs asyncio.Queue
│   │   ├── schemas.py       # Pydantic Document, Decision, RawDocument
│   │   └── workers.py       # extractor pool + resolver interval + narrator poll
│   ├── scripts/
│   │   ├── seed_from_fixtures.py   # POST all 14 fixtures to /ingest
│   │   ├── run_extractor_once.py   # CLI: --doc NN | --all | --dry-run
│   │   ├── run_resolver_once.py    # CLI: --reset + cluster dump
│   │   ├── tune_threshold.py       # sweep cosine thresholds
│   │   ├── run_detector_once.py    # CLI: --reset + per-pair diagnostics
│   │   ├── run_narrator_once.py    # CLI: --conflict UUID | --all + --dry-run
│   │   └── label_remaining_clusters.py   # one-shot Haiku label of non-conflict clusters
│   ├── tests/               # pure + integration tests per agent
│   ├── pyproject.toml
│   ├── README.md            # backend-specific setup
│   └── .env.example
│
├── db/
│   └── migrations/
│       ├── 001_initial.sql                 # §6 schema for fresh projects
│       └── 002_align_with_build_plan.sql   # drop+recreate if the project has a legacy schema
│
├── demo_data/               # 14 canonical fixtures: 3 adr, 4 meeting, 4 slack, 1 spec, 2 pr
│
├── app/                     # Next.js App Router pages + API routes
│   ├── api/
│   │   ├── query/route.ts   # /api/query — "Ask Claude" chat bar (Sonnet streaming)
│   │   ├── extract/ narrate/ pipeline/  # (teammate's POC — now unused)
│   │   └── ...
│   ├── ledger/page.tsx
│   └── layout.tsx
│
├── features/                # feature modules (components + lib)
│   ├── ledger/              # timeline, conflict cards, query bar, stats
│   ├── ingest/              # document upload UI
│   └── pipeline/            # PipelineRunner component (wired to /admin/run-pipeline)
│
├── components/              # shared UI + shadcn/ui primitives
├── lib/
│   ├── supabase.ts          # browser client (anon key)
│   ├── backend-adapter.ts   # Supabase rows → frontend types (schema impedance seam)
│   └── types.ts
│
├── scripts/
│   └── start-frontend.sh    # unsets shell-poisoned env vars then execs `pnpm dev`
│
├── RUN_LOCALLY.md
├── README.md  (this file)
├── .env.example / .env.local.example
├── package.json, pnpm-lock.yaml, tsconfig.json, next.config.ts
└── .gitignore
```

---

## Design decisions worth calling out

- **LLMs at the edges, deterministic code in the middle.** Only extract and narrate call an LLM. Clustering is Gemini embeddings + numpy cosine; conflict detection is 5 pure Python rules. A judge can read the detector and verify it, which is the whole trust story.
- **Keyword-overlap + cross-file preconditions** on the conflict rules. The resolver's threshold was tuned for **drift recall** (the 3 anchor↔reversal pairs must cluster), which means some topically-adjacent decisions also land in the same cluster. The detector's two preconditions — shared normalized keyword and `d1.filename != d2.filename` — eliminate the false-positive conflicts that would otherwise appear on those mixed clusters. See `backend/app/agents/detector.py` for the rule functions.
- **Soft decisions are evidence, not drifts.** Decisions with `confidence < 0.60` are excluded from the consecutive-pair walk (they don't themselves fire drifts) but stay in `cluster_history` so the narrator can use them as "where this started" context. Doc 08's ghost reference to a Lumino pipe (`"the custom pipe we agreed to"`) is captured as soft and shows up in Drift #3's narration.
- **Deterministic order throughout.** `_fetch_unclustered` uses `ORDER BY decided_at ASC, id ASC`. Without this the greedy cosine algorithm is order-dependent, and Drift #1 would cluster intermittently run-to-run — caught during Phase 3 rehearsal.
- **Prompt caching** is on both LLM agents (`cache_control: {type: "ephemeral"}` on the system block). The extractor prompt is ~5 KB cached; the narrator prompt is ~3 KB cached. After the first call per cycle, subsequent calls are ~90% cheaper on the system side.
- **Frontend reads from Supabase, writes are backend-only.** The frontend has stub write functions left in place so legacy call sites compile, but they're no-ops. Supabase is the source of truth; Realtime pushes the UI updates; the Refresh button forces a synchronous backend cycle when the user wants one.

---

## Stable demo state

The Supabase project bound to this repo is already seeded:

| Table | Rows |
|---|---|
| `documents` | 14 (3 ADR, 4 meeting, 4 slack, 1 spec, 2 PR) |
| `decisions` | 26 (all clustered, all embedded) |
| `topic_clusters` | 8 (all with `canonical_label`) |
| `conflicts` | 6 (all with `narration` filled) |

First-load of `/ledger` renders the full demo without re-running the pipeline.

---

## Known watch-outs

- **Free-tier Supabase auto-pauses after 7 days of no API calls.** If the timeline is empty on a cold morning, hit `curl http://localhost:8000/admin/status` once to wake the project and refresh.
- **Shell env pollution.** Some shells (Claude Code's harness, certain CI environments) export `ANTHROPIC_API_KEY=""`. The Python side handles this with `load_dotenv(override=True)`; the frontend needs `./scripts/start-frontend.sh` which unsets the poisoned var before `pnpm dev`.
- **`.env.local` parser.** Next.js's dotenv drops lines after a non-ASCII character (em dashes, curly quotes). Keep the file ASCII-only.
- **Secret rotation.** After the hackathon, rotate `SUPABASE_SERVICE_ROLE_KEY`, `ANTHROPIC_API_KEY`, and `GOOGLE_API_KEY` — they've been seen by multiple tools and chat transcripts.

---

---

## Credit

Built for **Push to Prod Hackathon with Genspark & Claude** (Singapore, April 24 2026). Architecture inspired by the medallion pattern; deterministic conflict rules over LLM judgement; teammate-voice narration over business-report summaries.
