"""POST /admin/run-pipeline — force a synchronous pipeline cycle.

Intended as a "Refresh" trigger from the frontend: drain any unclustered
decisions through the resolver → detector → narrator pipeline in one go,
and return a status snapshot.

This is additive to the interval workers — the workers keep running on
their schedule; this endpoint just fires a cycle on demand.
"""
from __future__ import annotations

import asyncio
import logging
import time
from typing import Any

from fastapi import APIRouter

from app.agents.detector import detect_all
from app.agents.narrator import narrate
from app.agents.resolver import resolve
from app.db import get_supabase
from app.workers import (
    _fetch_pending_conflicts,
    _process_one_conflict,
)

log = logging.getLogger(__name__)

router = APIRouter(prefix="/admin")


def _summarize_state() -> dict[str, int]:
    sb = get_supabase()
    out: dict[str, int] = {}
    for table in ("documents", "decisions", "topic_clusters", "conflicts"):
        res = sb.table(table).select("id", count="exact").limit(1).execute()
        out[table] = getattr(res, "count", None) or 0
    # Pending counts (what the pipeline still has to do)
    unclustered = (
        sb.table("decisions")
        .select("id", count="exact")
        .is_("topic_cluster_id", None)
        .limit(1)
        .execute()
    )
    out["unclustered_decisions"] = getattr(unclustered, "count", None) or 0
    pending = (
        sb.table("conflicts")
        .select("id", count="exact")
        .is_("narration", None)
        .limit(1)
        .execute()
    )
    out["unnarrated_conflicts"] = getattr(pending, "count", None) or 0
    return out


@router.post("/run-pipeline")
async def run_pipeline() -> dict[str, Any]:
    """Run resolve → detect → narrate once synchronously.

    The extractor consumer is queue-driven and fired by /ingest, so this
    endpoint does NOT extract — if there are documents without decisions,
    those need to flow through /ingest first. We do the middle+back of the
    pipeline here.

    Returns a summary the frontend can render as a "last run" timestamp.
    """
    started = time.monotonic()
    log.info("admin/run-pipeline: starting synchronous cycle")

    before = await asyncio.to_thread(_summarize_state)

    resolver_result = await resolve()
    detector_results = await detect_all()

    # Narrate every pending conflict NOW (don't wait for the 2s poll).
    pending = await _fetch_pending_conflicts()
    narrated = 0
    narrator_failed = 0
    for conflict in pending:
        try:
            ok = await _process_one_conflict(conflict)
            if ok:
                narrated += 1
            else:
                narrator_failed += 1
        except Exception as e:  # noqa: BLE001
            narrator_failed += 1
            log.exception("admin/run-pipeline: narrator failed on conflict %s: %s", conflict["id"], e)

    after = await asyncio.to_thread(_summarize_state)

    elapsed_ms = int((time.monotonic() - started) * 1000)
    payload = {
        "ok": True,
        "elapsed_ms": elapsed_ms,
        "resolver": {
            "n_embedded": resolver_result.n_embedded,
            "n_new_clusters": resolver_result.n_new_clusters,
            "n_assigned_to_existing": resolver_result.n_assigned,
            "total_clusters": resolver_result.total_clusters_after,
        },
        "detector": {
            "clusters_walked": len(detector_results),
            "firings": sum(len(r.firings) for r in detector_results),
            "new_conflicts": sum(r.conflicts_new for r in detector_results),
        },
        "narrator": {
            "narrated": narrated,
            "failed": narrator_failed,
            "pending_before": len(pending),
        },
        "state_before": before,
        "state_after": after,
    }
    log.info("admin/run-pipeline: done in %dms: %s", elapsed_ms, payload)
    return payload


@router.get("/status")
async def status() -> dict[str, Any]:
    """Cheap snapshot of table counts + pending work. Suitable for
    frontend polling or a dashboard banner."""
    return await asyncio.to_thread(_summarize_state)
