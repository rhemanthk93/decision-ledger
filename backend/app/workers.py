"""Extraction consumer + shared persistence helpers.

The consumer coroutine pulls doc_ids from the raw_docs queue, loads the
document row, calls the extractor, and writes the resulting decisions to
the decisions table. N=EXTRACTOR_WORKERS coroutines run in parallel via
asyncio.gather, launched by start_workers() on FastAPI startup.

The `load_document`, `delete_existing_decisions`, and `insert_decisions`
helpers are also imported by the run_extractor_once CLI, which bypasses
the queue and drives them synchronously.
"""
from __future__ import annotations

import asyncio
import logging
from typing import Any

from app.agents.extractor import extract
from app.agents.resolver import resolve
from app.config import EXTRACTOR_WORKERS, RESOLVER_INTERVAL_SEC
from app.db import get_supabase
from app.queue import raw_docs
from app.schemas import Decision, Document

log = logging.getLogger(__name__)

_worker_tasks: list[asyncio.Task[None]] = []
_resolver_task: asyncio.Task[None] | None = None


# ============================================================
# Persistence helpers (shared with CLI)
# ============================================================

async def load_document(doc_id: str) -> Document | None:
    sb = get_supabase()
    res = await asyncio.to_thread(
        lambda: sb.table("documents").select("*").eq("id", doc_id).limit(1).execute()
    )
    if not res.data:
        return None
    row = res.data[0]
    return Document(
        id=row["id"],
        source_type=row["source_type"],
        filename=row["filename"],
        doc_date=row["doc_date"],
        content=row["content"],
    )


async def delete_existing_decisions(doc_id: str) -> int:
    sb = get_supabase()
    res = await asyncio.to_thread(
        lambda: sb.table("decisions").delete().eq("document_id", doc_id).execute()
    )
    return len(res.data) if getattr(res, "data", None) else 0


def _decision_to_row(doc_id: str, d: Decision) -> dict[str, Any]:
    return {
        "document_id": doc_id,
        "statement": d.statement,
        "topic_keywords": d.topic_keywords,
        "type": d.type,
        "decided_at": d.decided_at.isoformat(),
        "decided_by": d.decided_by,
        "source_excerpt": d.source_excerpt,
        "confidence": d.confidence,
    }


async def insert_decisions(doc_id: str, decisions: list[Decision]) -> list[dict[str, Any]]:
    if not decisions:
        return []
    rows = [_decision_to_row(doc_id, d) for d in decisions]
    sb = get_supabase()
    res = await asyncio.to_thread(
        lambda: sb.table("decisions").insert(rows).execute()
    )
    return res.data or []


# ============================================================
# Consumer coroutine
# ============================================================

async def _process_one(worker_id: int, doc_id: str) -> None:
    doc = await load_document(doc_id)
    if doc is None:
        log.error("worker %d: doc_id=%s not found", worker_id, doc_id)
        return
    decisions = await extract(doc)
    await delete_existing_decisions(doc_id)
    if decisions:
        inserted = await insert_decisions(doc_id, decisions)
        log.info(
            "worker %d inserted %d decisions for doc_id=%s filename=%s",
            worker_id, len(inserted), doc_id, doc.filename,
        )
    else:
        log.info(
            "worker %d: 0 decisions for doc_id=%s filename=%s",
            worker_id, doc_id, doc.filename,
        )


async def _consumer_loop(worker_id: int) -> None:
    log.info("extractor worker %d started", worker_id)
    try:
        while True:
            doc_id = await raw_docs.get()
            try:
                await _process_one(worker_id, doc_id)
            except asyncio.CancelledError:
                raise
            except Exception as e:  # noqa: BLE001 — never kill the worker pool on a single-doc failure
                log.exception("worker %d failed on doc_id=%s: %s", worker_id, doc_id, e)
            finally:
                try:
                    raw_docs.task_done()
                except ValueError:
                    pass
    except asyncio.CancelledError:
        log.info("extractor worker %d cancelled", worker_id)
        raise


# ============================================================
# Resolver interval worker
# ============================================================

async def run_resolver_interval() -> None:
    """Fires resolve() every RESOLVER_INTERVAL_SEC. One failed cycle must
    not kill the loop. Phase 4 will add a detector call right after each
    successful resolve (see DETECTOR-HOOK below)."""
    log.info("resolver interval worker started (every %ds)", RESOLVER_INTERVAL_SEC)
    try:
        while True:
            try:
                await resolve()
                # DETECTOR-HOOK: Phase 4 wires the conflict detector here
                # (runs on the same batch that resolve just produced).
                #
                # Phase 4 precondition: detector rule functions must
                # require d1.topic_keywords and d2.topic_keywords to
                # share at least one token (lightly normalized — e.g.
                # singular/plural) before classifying any conflict other
                # than `consistent`. This prevents false positives on
                # the mixed clusters that exist because CLUSTERING_THRESHOLD
                # is tuned for drift-recall over isolation (see config.py).
            except asyncio.CancelledError:
                raise
            except Exception as e:  # noqa: BLE001
                log.exception("resolver cycle failed: %s", e)
            await asyncio.sleep(RESOLVER_INTERVAL_SEC)
    except asyncio.CancelledError:
        log.info("resolver interval worker cancelled")
        raise


# ============================================================
# Lifecycle (called from FastAPI lifespan)
# ============================================================

def start_workers() -> None:
    global _worker_tasks, _resolver_task
    loop = asyncio.get_event_loop()
    if not _worker_tasks:
        _worker_tasks = [
            loop.create_task(_consumer_loop(i + 1), name=f"extractor-{i+1}")
            for i in range(EXTRACTOR_WORKERS)
        ]
        log.info("started %d extractor worker(s)", EXTRACTOR_WORKERS)
    else:
        log.warning("extractor workers already running (n=%d)", len(_worker_tasks))

    if _resolver_task is None:
        _resolver_task = loop.create_task(run_resolver_interval(), name="resolver-interval")
    else:
        log.warning("resolver interval worker already running")


async def stop_workers() -> None:
    global _worker_tasks, _resolver_task
    tasks: list[asyncio.Task[None]] = []
    if _worker_tasks:
        tasks.extend(_worker_tasks)
    if _resolver_task is not None:
        tasks.append(_resolver_task)
    if not tasks:
        return
    for t in tasks:
        t.cancel()
    await asyncio.gather(*tasks, return_exceptions=True)
    _worker_tasks = []
    _resolver_task = None
    log.info("stopped all workers")
