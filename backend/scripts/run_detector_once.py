"""Run the conflict detector once against current clusters.

Usage:
    uv run python scripts/run_detector_once.py
    uv run python scripts/run_detector_once.py --reset
"""
from __future__ import annotations

import argparse
import asyncio
import logging
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from app.agents.detector import (  # noqa: E402
    CONFIDENCE_WALK_FLOOR,
    DISAGREE_COSINE_THRESHOLD,
    _d2_cites_d1,
    _fetch_cluster_decisions,
    _fetch_cluster_ids,
    _keywords_overlap,
    classify_pair,
    detect_all,
)
from app.agents.resolver import cosine  # noqa: E402
from app.db import get_supabase  # noqa: E402

log = logging.getLogger("run_detector_once")


async def _reset_conflicts() -> None:
    sb = get_supabase()
    log.info("--reset: deleting all rows from conflicts")
    await asyncio.to_thread(
        lambda: sb.table("conflicts").delete().neq("id", "00000000-0000-0000-0000-000000000000").execute()
    )


def _short(stmt: str, n: int = 70) -> str:
    stmt = (stmt or "").replace("\n", " ")
    return stmt if len(stmt) <= n else stmt[: n - 1] + "…"


async def _verbose_dump() -> None:
    print("\n--- Verbose per-pair diagnostics ---")
    cluster_ids = await _fetch_cluster_ids()
    for cid in cluster_ids:
        history = await _fetch_cluster_decisions(cid)
        walk = [d for d in history if d.confidence >= CONFIDENCE_WALK_FLOOR]
        if len(walk) < 2:
            continue
        print(f"\nCluster {cid}  (firm {len(walk)}/{len(history)})")
        for i, d1 in enumerate(walk):
            for d2 in walk[i + 1:]:
                c = cosine(d1.embedding, d2.embedding) if d1.embedding is not None and d2.embedding is not None else None
                kw = _keywords_overlap(d1, d2)
                cite = _d2_cites_d1(d1, d2)
                rule = classify_pair(d1, d2, history)
                print(f"  ({d1.type:>13} → {d2.type:<13})  cos={c:.3f}  "
                      f"kw_overlap={str(kw):<5}  d2→d1_cite={str(cite):<5}  rule={rule}")
                print(f"     d1: {_short(d1.statement, 80)}")
                print(f"     d2: {_short(d2.statement, 80)}")


async def _run(args: argparse.Namespace) -> int:
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s %(levelname)s %(name)s: %(message)s",
        datefmt="%H:%M:%S",
    )
    if args.reset:
        await _reset_conflicts()

    results = await detect_all()

    print("\nDetector summary:")
    total_new = sum(r.conflicts_new for r in results)
    total_firings = sum(len(r.firings) for r in results)
    for r in sorted(results, key=lambda x: -len(x.firings)):
        if r.firings:
            print(f"\nCluster {r.cluster_id}  (walked {r.walked}/{r.total} firm, {r.pairs_checked} pairs)")
            for d1, d2, rule in r.firings:
                print(f"  {rule:<17} d1={_short(d1.statement, 50)}")
                print(f"  {' ' * 17} d2={_short(d2.statement, 50)}")
                print(f"  {' ' * 17}   d1.type={d1.type}  d2.type={d2.type}  "
                      f"d1.file={d1.filename or '—'}  d2.file={d2.filename or '—'}")
        else:
            print(f"Cluster {r.cluster_id}: walked={r.walked}/{r.total}, pairs={r.pairs_checked}, no conflicts.")
    print(f"\nTotal: {total_firings} conflict firings across {len(results)} clusters; {total_new} newly inserted.")

    if args.verbose:
        await _verbose_dump()
    return 0


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Run the conflict detector once.")
    parser.add_argument("--reset", action="store_true",
                        help="Delete all rows from conflicts before running.")
    parser.add_argument("--verbose", action="store_true",
                        help="Dump cosine + precondition details for every walked pair.")
    args = parser.parse_args(argv)
    return asyncio.run(_run(args))


if __name__ == "__main__":
    sys.exit(main())
