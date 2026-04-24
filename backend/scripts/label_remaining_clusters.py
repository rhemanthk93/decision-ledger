"""One-shot: label any topic_clusters that still have canonical_label IS NULL.

The narrator only touches clusters that have a conflict. Non-conflict
clusters never get a label that way. This script takes the remaining
clusters, sends all of them to Haiku in a single batch call, and writes
the labels back.

Usage:
    uv run python scripts/label_remaining_clusters.py
    uv run python scripts/label_remaining_clusters.py --dry-run
"""
from __future__ import annotations

import argparse
import asyncio
import logging
import sys
from pathlib import Path
from typing import Any

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from app.agents.narrator import label_clusters_with_haiku  # noqa: E402
from app.db import get_supabase  # noqa: E402

log = logging.getLogger("label_remaining_clusters")


async def _fetch_unlabeled_clusters() -> list[dict[str, Any]]:
    sb = get_supabase()
    res = await asyncio.to_thread(
        lambda: sb.table("topic_clusters")
        .select("id, canonical_label")
        .is_("canonical_label", None)
        .execute()
    )
    return res.data or []


async def _fetch_cluster_decisions(cluster_id: str) -> list[dict[str, Any]]:
    sb = get_supabase()
    res = await asyncio.to_thread(
        lambda: sb.table("decisions")
        .select("statement, type, topic_keywords")
        .eq("topic_cluster_id", cluster_id)
        .order("decided_at", desc=False)
        .execute()
    )
    return res.data or []


async def _write_label(cluster_id: str, label: str) -> None:
    sb = get_supabase()
    await asyncio.to_thread(
        lambda: sb.table("topic_clusters")
        .update({"canonical_label": label})
        .eq("id", cluster_id)
        .execute()
    )


async def _run(args: argparse.Namespace) -> int:
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s %(levelname)s %(name)s: %(message)s",
        datefmt="%H:%M:%S",
    )

    clusters = await _fetch_unlabeled_clusters()
    if not clusters:
        log.info("No unlabeled clusters — nothing to do.")
        return 0

    log.info("Labeling %d unlabeled cluster(s)", len(clusters))
    payload: list[dict[str, Any]] = []
    for c in clusters:
        decisions = await _fetch_cluster_decisions(c["id"])
        payload.append({"cluster_id": c["id"], "decisions": decisions})

    labels = await label_clusters_with_haiku(payload)
    if not labels:
        log.error("Haiku returned no labels.")
        return 1

    print(f"\nReceived {len(labels)} labels from Haiku:")
    for cid, lbl in labels.items():
        print(f"  {cid} -> {lbl!r}")

    if args.dry_run:
        print("\n(dry-run — no DB writes)")
        return 0

    missing = [c["id"] for c in clusters if c["id"] not in labels]
    if missing:
        log.warning("Haiku omitted %d cluster(s): %s", len(missing), missing)

    for cid, lbl in labels.items():
        await _write_label(cid, lbl)

    print(f"\nWrote {len(labels)} labels to topic_clusters.")
    return 0


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Label topic_clusters that have no canonical_label.")
    parser.add_argument("--dry-run", action="store_true",
                        help="Print labels but skip DB writes.")
    args = parser.parse_args(argv)
    return asyncio.run(_run(args))


if __name__ == "__main__":
    sys.exit(main())
