"""Run the resolver once against the current DB state.

Usage:
    uv run python scripts/run_resolver_once.py
    uv run python scripts/run_resolver_once.py --reset
"""
from __future__ import annotations

import argparse
import asyncio
import logging
import sys
from datetime import datetime
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from app.agents.resolver import resolve  # noqa: E402
from app.db import get_supabase  # noqa: E402

log = logging.getLogger("run_resolver_once")


async def _reset_clusters() -> None:
    sb = get_supabase()
    log.info("--reset: nulling topic_cluster_id on all decisions")
    await asyncio.to_thread(
        lambda: sb.table("decisions").update({"topic_cluster_id": None}).neq("id", "00000000-0000-0000-0000-000000000000").execute()
    )
    log.info("--reset: deleting all topic_clusters rows")
    await asyncio.to_thread(
        lambda: sb.table("topic_clusters").delete().neq("id", "00000000-0000-0000-0000-000000000000").execute()
    )


async def _dump_clusters() -> None:
    sb = get_supabase()
    rows = await asyncio.to_thread(
        lambda: sb.table("decisions")
        .select("id, statement, confidence, decided_at, topic_cluster_id, document_id, documents(source_type, filename)")
        .order("topic_cluster_id")
        .execute()
    )
    data = rows.data or []
    by_cluster: dict[str | None, list[dict]] = {}
    for r in data:
        by_cluster.setdefault(r.get("topic_cluster_id"), []).append(r)

    # Sort clusters by size desc, then by first decision's date for stability
    def _sort_key(item):
        cid, rows = item
        first_date = min((r["decided_at"] for r in rows), default="")
        return (-len(rows), first_date)

    clusters_sorted = sorted(
        (item for item in by_cluster.items() if item[0] is not None),
        key=_sort_key,
    )

    print(f"\n{'=' * 68}")
    print(f"{len(clusters_sorted)} clusters total. Per-cluster members:")
    print("=" * 68)
    for i, (cid, members) in enumerate(clusters_sorted, start=1):
        print(f"\nCluster {i}  (id: {cid})  —  {len(members)} decision(s):")
        # sort by decided_at
        members_sorted = sorted(members, key=lambda m: m["decided_at"])
        for m in members_sorted:
            date = str(m["decided_at"])[:10]
            stype = (m.get("documents") or {}).get("source_type", "?")
            stmt = m["statement"]
            if len(stmt) > 90:
                stmt = stmt[:87] + "..."
            conf = m["confidence"]
            print(f"  [{date}][{stype:<7}] {stmt}  (conf {conf:.2f})")

    unclustered = by_cluster.get(None, [])
    if unclustered:
        print(f"\nUnclustered: {len(unclustered)} decision(s) — this should be zero after a resolve run.")
        for m in unclustered[:5]:
            print(f"  - {m['statement'][:100]}")


async def _run(args: argparse.Namespace) -> int:
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s %(levelname)s %(name)s: %(message)s",
        datefmt="%H:%M:%S",
    )
    if args.reset:
        await _reset_clusters()

    result = await resolve()

    print("\nResolve summary:")
    print(f"  Embedded:             {result.n_embedded}")
    print(f"  New clusters:         {result.n_new_clusters}")
    print(f"  Assigned to existing: {result.n_assigned}")
    print(f"  Total clusters now:   {result.total_clusters_after}")
    print(f"  Decisions clustered:  {result.total_decisions_clustered}")

    await _dump_clusters()
    return 0


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Run the resolver once.")
    parser.add_argument("--reset", action="store_true",
                        help="Null topic_cluster_id on all decisions and delete all topic_clusters rows before running.")
    args = parser.parse_args(argv)
    return asyncio.run(_run(args))


if __name__ == "__main__":
    sys.exit(main())
