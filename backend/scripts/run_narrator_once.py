"""Run the Sonnet narrator once against one or all pending conflicts.

Usage:
    uv run python scripts/run_narrator_once.py --conflict <uuid>
    uv run python scripts/run_narrator_once.py --all
    uv run python scripts/run_narrator_once.py --conflict <uuid> --dry-run --verbose
"""
from __future__ import annotations

import argparse
import asyncio
import json
import logging
import sys
from pathlib import Path
from typing import Any

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from app.agents.narrator import (  # noqa: E402
    _user_message_payload,
    forbidden_phrases_hit,
    narrate,
    word_count,
)
from app.db import get_supabase  # noqa: E402

log = logging.getLogger("run_narrator_once")


async def _fetch_conflict(conflict_id: str) -> dict[str, Any] | None:
    sb = get_supabase()
    res = await asyncio.to_thread(
        lambda: sb.table("conflicts").select("*").eq("id", conflict_id).limit(1).execute()
    )
    return res.data[0] if res.data else None


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


async def _fetch_decision(decision_id: str) -> dict[str, Any] | None:
    sb = get_supabase()
    res = await asyncio.to_thread(
        lambda: sb.table("decisions")
        .select("id, statement, type, decided_at, decided_by, source_excerpt, topic_keywords, confidence, documents(filename)")
        .eq("id", decision_id)
        .limit(1)
        .execute()
    )
    return res.data[0] if res.data else None


async def _fetch_cluster_history(cluster_id: str) -> list[dict[str, Any]]:
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
    return [_flatten_history_row(r) for r in rows]


def _decision_payload(row: dict[str, Any]) -> dict[str, Any]:
    docs = row.get("documents") or {}
    filename = docs.get("filename") if isinstance(docs, dict) else ""
    decided_at = str(row.get("decided_at") or "")[:10]
    return {
        "statement": row.get("statement"),
        "type": row.get("type"),
        "decided_at": decided_at,
        "decided_by": row.get("decided_by") or [],
        "source_excerpt": row.get("source_excerpt", ""),
        "source_filename": filename,
        "confidence": row.get("confidence"),
    }


def _flatten_history_row(row: dict[str, Any]) -> dict[str, Any]:
    docs = row.get("documents") or {}
    filename = docs.get("filename") if isinstance(docs, dict) else ""
    decided_at = str(row.get("decided_at") or "")[:10]
    entry: dict[str, Any] = {
        "date": decided_at,
        "statement": row.get("statement"),
        "type": row.get("type"),
        "decided_by": row.get("decided_by") or [],
        "source_filename": filename,
    }
    conf = row.get("confidence")
    if conf is not None and conf < 0.60:
        entry["confidence"] = round(float(conf), 2)
    return entry


async def _write_narration(conflict_id: str, narration: str, cluster_id: str, cluster_label: str | None) -> None:
    sb = get_supabase()
    await asyncio.to_thread(
        lambda: sb.table("conflicts").update({"narration": narration}).eq("id", conflict_id).execute()
    )
    if cluster_label:
        # Only set canonical_label if it's currently NULL.
        existing = await asyncio.to_thread(
            lambda: sb.table("topic_clusters").select("canonical_label").eq("id", cluster_id).limit(1).execute()
        )
        current = (existing.data or [{}])[0].get("canonical_label")
        if current is None:
            await asyncio.to_thread(
                lambda: sb.table("topic_clusters").update({"canonical_label": cluster_label}).eq("id", cluster_id).execute()
            )


async def _process_one(conflict: dict[str, Any], dry_run: bool, verbose: bool) -> None:
    cid = conflict["id"]
    cluster_id = conflict["cluster_id"]
    rule = conflict["rule"]

    d1_row = await _fetch_decision(conflict["d1_id"])
    d2_row = await _fetch_decision(conflict["d2_id"])
    if d1_row is None or d2_row is None:
        print(f"  ERROR: conflict {cid} references missing decision(s).")
        return
    d1 = _decision_payload(d1_row)
    d2 = _decision_payload(d2_row)
    cluster_history = await _fetch_cluster_history(cluster_id)

    if verbose:
        print("\n--- USER MESSAGE SENT TO SONNET ---")
        print(_user_message_payload(rule, d1, d2, cluster_history))
        print("--- END USER MESSAGE ---\n")

    result = await narrate(rule, d1, d2, cluster_history)
    if result is None:
        print(f"  narrate() returned None for conflict {cid}")
        return

    narration = result["narration"]
    cluster_label = result.get("cluster_label", "")
    wc = word_count(narration)
    hits = forbidden_phrases_hit(narration)

    print(f"\n=== Conflict {cid}  ({rule}) ===")
    print(f"Cluster: {cluster_id}")
    print(f"Cluster label: {cluster_label!r}")
    print(f"Word count: {wc}  {'(over 100!)' if wc > 100 else 'OK'}")
    if hits:
        print(f"Forbidden phrase / pattern hits: {hits}")
    else:
        print("Voice check: clean.")
    print()
    print(narration)
    print()

    if not dry_run:
        await _write_narration(cid, narration, cluster_id, cluster_label)
        print(f"  -> wrote narration to conflicts.{cid}")
        print(f"  -> (if cluster had no label) wrote canonical_label={cluster_label!r}")


async def _run(args: argparse.Namespace) -> int:
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s %(levelname)s %(name)s: %(message)s",
        datefmt="%H:%M:%S",
    )

    if args.conflict:
        row = await _fetch_conflict(args.conflict)
        if row is None:
            print(f"conflict {args.conflict} not found")
            return 1
        targets = [row]
    else:
        targets = await _fetch_pending_conflicts()
        if not targets:
            print("No conflicts with narration IS NULL.")
            return 0

    for c in targets:
        await _process_one(c, args.dry_run, args.verbose)
    print(f"\nProcessed {len(targets)} conflict(s).")
    return 0


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Run the Sonnet narrator once.")
    sel = parser.add_mutually_exclusive_group(required=True)
    sel.add_argument("--conflict", metavar="UUID",
                     help="Narrate this specific conflict.")
    sel.add_argument("--all", action="store_true",
                     help="Narrate every conflict with narration IS NULL.")
    parser.add_argument("--dry-run", action="store_true",
                        help="Print narration + label but skip DB writes.")
    parser.add_argument("--verbose", action="store_true",
                        help="Also print the full user message sent to Sonnet.")
    args = parser.parse_args(argv)
    return asyncio.run(_run(args))


if __name__ == "__main__":
    sys.exit(main())
