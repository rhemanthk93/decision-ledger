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

from app.agents.detector import detect_all
from app.agents.extractor import extract
from app.agents.narrator import narrate
from app.agents.resolver import resolve
from app.config import EXTRACTOR_WORKERS, NARRATOR_POLL_SEC, RESOLVER_INTERVAL_SEC
from app.db import get_supabase
from app.queue import raw_docs
from app.schemas import Decision, Document

log = logging.getLogger(__name__)

_worker_tasks: list[asyncio.Task[None]] = []
_resolver_task: asyncio.Task[None] | None = None
_narrator_task: asyncio.Task[None] | None = None


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
    """Fires resolve() then detect_all() every RESOLVER_INTERVAL_SEC.
    One failed cycle in either step must not kill the loop."""
    log.info("resolver interval worker started (every %ds)", RESOLVER_INTERVAL_SEC)
    try:
        while True:
            try:
                await resolve()
            except asyncio.CancelledError:
                raise
            except Exception as e:  # noqa: BLE001
                log.exception("resolver cycle failed: %s", e)
            # Detector runs on the same batch the resolver just produced.
            # Wrapped separately so a detector failure doesn't skip the
            # sleep or prevent the next resolver cycle.
            try:
                await detect_all()
            except asyncio.CancelledError:
                raise
            except Exception as e:  # noqa: BLE001
                log.exception("detector cycle failed: %s", e)
            await asyncio.sleep(RESOLVER_INTERVAL_SEC)
    except asyncio.CancelledError:
        log.info("resolver interval worker cancelled")
        raise


# ============================================================
# Narrator polling worker
# ============================================================

async def _fetch_pending_conflicts() -> list[dict[str, Any]]:
    sb = get_supabase()
    res = await asyncio.to_thread(
        lambda: sb.table("conflicts")
        .select("*")
        .is_("narration", None)
        .order("created_at", desc=False)
        .execute()
    )
    return res.data or []


async def _fetch_decision_for_narrator(decision_id: str) -> dict[str, Any] | None:
    sb = get_supabase()
    res = await asyncio.to_thread(
        lambda: sb.table("decisions")
        .select("id, statement, type, decided_at, decided_by, source_excerpt, topic_keywords, confidence, documents(filename)")
        .eq("id", decision_id)
        .limit(1)
        .execute()
    )
    return res.data[0] if res.data else None


async def _fetch_cluster_history_for_narrator(cluster_id: str) -> list[dict[str, Any]]:
    sb = get_supabase()
    res = await asyncio.to_thread(
        lambda: sb.table("decisions")
        .select("id, statement, type, decided_at, decided_by, confidence, documents(filename)")
        .eq("topic_cluster_id", cluster_id)
        .order("decided_at", desc=False)
        .order("id", desc=False)
        .execute()
    )
    rows = res.data or []
    out: list[dict[str, Any]] = []
    for r in rows:
        docs = r.get("documents") or {}
        filename = docs.get("filename") if isinstance(docs, dict) else ""
        entry: dict[str, Any] = {
            "date": str(r.get("decided_at") or "")[:10],
            "statement": r.get("statement"),
            "type": r.get("type"),
            "decided_by": r.get("decided_by") or [],
            "source_filename": filename,
        }
        conf = r.get("confidence")
        if conf is not None and conf < 0.60:
            entry["confidence"] = round(float(conf), 2)
        out.append(entry)
    return out


def _decision_payload_for_narrator(row: dict[str, Any]) -> dict[str, Any]:
    docs = row.get("documents") or {}
    filename = docs.get("filename") if isinstance(docs, dict) else ""
    return {
        "statement": row.get("statement"),
        "type": row.get("type"),
        "decided_at": str(row.get("decided_at") or "")[:10],
        "decided_by": row.get("decided_by") or [],
        "source_excerpt": row.get("source_excerpt", ""),
        "source_filename": filename,
        "confidence": row.get("confidence"),
    }


async def _process_one_conflict(conflict: dict[str, Any]) -> bool:
    """Returns True if the conflict was narrated (including label written)."""
    cid = conflict["id"]
    cluster_id = conflict["cluster_id"]
    rule = conflict["rule"]

    d1_row = await _fetch_decision_for_narrator(conflict["d1_id"])
    d2_row = await _fetch_decision_for_narrator(conflict["d2_id"])
    if d1_row is None or d2_row is None:
        log.error("narrator poll: conflict %s references missing decision(s)", cid)
        return False

    cluster_history = await _fetch_cluster_history_for_narrator(cluster_id)
    result = await narrate(
        rule,
        _decision_payload_for_narrator(d1_row),
        _decision_payload_for_narrator(d2_row),
        cluster_history,
    )
    if result is None:
        log.error("narrator poll: narrate() returned None for conflict %s", cid)
        return False

    narration = result["narration"]
    cluster_label = result.get("cluster_label", "")

    sb = get_supabase()
    await asyncio.to_thread(
        lambda: sb.table("conflicts").update({"narration": narration}).eq("id", cid).execute()
    )

    if cluster_label:
        existing = await asyncio.to_thread(
            lambda: sb.table("topic_clusters").select("canonical_label").eq("id", cluster_id).limit(1).execute()
        )
        current = (existing.data or [{}])[0].get("canonical_label")
        if current is None:
            await asyncio.to_thread(
                lambda: sb.table("topic_clusters").update({"canonical_label": cluster_label}).eq("id", cluster_id).execute()
            )
            log.info("narrator poll: wrote cluster_label=%r for cluster %s", cluster_label, cluster_id)

    log.info("narrator poll: narrated conflict %s (rule=%s)", cid, rule)
    return True


async def run_narrator_poll() -> None:
    """Polls conflicts WHERE narration IS NULL every NARRATOR_POLL_SEC.
    One failed iteration must not kill the loop."""
    log.info("narrator poll worker started (every %ds)", NARRATOR_POLL_SEC)
    try:
        while True:
            try:
                pending = await _fetch_pending_conflicts()
                for c in pending:
                    try:
                        await _process_one_conflict(c)
                    except asyncio.CancelledError:
                        raise
                    except Exception as e:  # noqa: BLE001
                        log.exception("narrator poll: failed on conflict %s: %s", c.get("id"), e)
            except asyncio.CancelledError:
                raise
            except Exception as e:  # noqa: BLE001
                log.exception("narrator poll cycle failed: %s", e)
            await asyncio.sleep(NARRATOR_POLL_SEC)
    except asyncio.CancelledError:
        log.info("narrator poll worker cancelled")
        raise


# ============================================================
# Lifecycle (called from FastAPI lifespan)
# ============================================================

def start_workers() -> None:
    global _worker_tasks, _resolver_task, _narrator_task
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

    if _narrator_task is None:
        _narrator_task = loop.create_task(run_narrator_poll(), name="narrator-poll")
    else:
        log.warning("narrator poll worker already running")


async def stop_workers() -> None:
    global _worker_tasks, _resolver_task, _narrator_task
    tasks: list[asyncio.Task[None]] = []
    if _worker_tasks:
        tasks.extend(_worker_tasks)
    if _resolver_task is not None:
        tasks.append(_resolver_task)
    if _narrator_task is not None:
        tasks.append(_narrator_task)
    if not tasks:
        return
    for t in tasks:
        t.cancel()
    await asyncio.gather(*tasks, return_exceptions=True)
    _worker_tasks = []
    _resolver_task = None
    _narrator_task = None
    log.info("stopped all workers")
