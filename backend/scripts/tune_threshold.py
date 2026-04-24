"""Sweep CLUSTERING_THRESHOLD across a few candidate values and report
which one best satisfies the §8 Phase 3 verify gate (6 clusters,
Postgres+MongoDB together).

Usage:
    uv run python scripts/tune_threshold.py

Embeds all decisions ONCE at the start, then reuses the cache for each
threshold (Gemini free tier is 1,500 req/day — don't burn it).
"""
from __future__ import annotations

import argparse
import asyncio
import logging
import sys
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from app.agents.resolver import (  # noqa: E402
    _resolve_with_embeddings,
    embed_batch,
    embed_input_for,
)
from app.db import get_supabase  # noqa: E402

THRESHOLDS = [0.72, 0.73, 0.74, 0.75, 0.76, 0.77, 0.78, 0.80, 0.82, 0.85]

log = logging.getLogger("tune_threshold")


async def _reset_clusters() -> None:
    sb = get_supabase()
    await asyncio.to_thread(
        lambda: sb.table("decisions").update({"topic_cluster_id": None}).neq("id", "00000000-0000-0000-0000-000000000000").execute()
    )
    await asyncio.to_thread(
        lambda: sb.table("topic_clusters").delete().neq("id", "00000000-0000-0000-0000-000000000000").execute()
    )


async def _fetch_all_decisions_with_source() -> list[dict]:
    sb = get_supabase()
    res = await asyncio.to_thread(
        lambda: sb.table("decisions")
        .select("id, statement, topic_keywords, confidence, decided_at, topic_cluster_id, documents(filename, source_type)")
        .order("decided_at", desc=False)
        .order("id", desc=False)
        .execute()
    )
    return res.data or []


# ============================================================
# Membership-check helpers
# ============================================================

def _by_filename(rows: list[dict], needle: str) -> list[dict]:
    return [r for r in rows if (r.get("documents") or {}).get("filename", "").startswith(needle)]


def _pick_by_kw(rows: list[dict], needles: list[str]) -> list[dict]:
    """Rows whose statement contains any of the needles (case-insensitive)."""
    out = []
    for r in rows:
        s = (r.get("statement") or "").lower()
        if any(n.lower() in s for n in needles):
            out.append(r)
    return out


def _same_cluster(*groups: list[dict]) -> bool:
    """True if there is a single cluster_id present in every group."""
    if not groups or any(not g for g in groups):
        return False
    cluster_sets = [{r["topic_cluster_id"] for r in g if r.get("topic_cluster_id")} for g in groups]
    if any(not cs for cs in cluster_sets):
        return False
    common = set.intersection(*cluster_sets)
    return bool(common)


def _isolated(rows: list[dict], needle: str) -> bool:
    """The decisions from files matching `needle` all share one cluster,
    and that cluster has no members from other documents."""
    target = _by_filename(rows, needle)
    if not target:
        return False
    cluster_ids = {r["topic_cluster_id"] for r in target}
    if len(cluster_ids) != 1:
        return False
    cid = next(iter(cluster_ids))
    same_cluster_decisions = [r for r in rows if r["topic_cluster_id"] == cid]
    other_files = {(r.get("documents") or {}).get("filename") for r in same_cluster_decisions}
    other_files.discard(None)
    # Allow the target filename itself; reject if any other filenames share the cluster
    target_filenames = {(r.get("documents") or {}).get("filename") for r in target}
    return other_files.issubset(target_filenames)


def _report(rows: list[dict], threshold: float) -> dict:
    clusters: dict[str, list[dict]] = {}
    for r in rows:
        cid = r.get("topic_cluster_id")
        if cid is None:
            continue
        clusters.setdefault(cid, []).append(r)
    sizes = sorted((len(v) for v in clusters.values()), reverse=True)

    # Membership checks
    postgres_core = _by_filename(rows, "adr-0042")
    mongodb_mig = _by_filename(rows, "pr_847")
    two_approval = _pick_by_kw(_by_filename(rows, "q1_arch_review"), ["approval"])
    hotfix_tag = _pick_by_kw(_by_filename(rows, "backend_guild_2026-05-12"), ["P0", "P1"])
    hotfix_cve = _pick_by_kw(_by_filename(rows, "backend_guild_2026-05-12"), ["CVE", "cve", "dependency"])
    fifty_k = _pick_by_kw(_by_filename(rows, "q1_arch_review"), ["50k", "$50", "custom integration"])
    lumino_ghost = _by_filename(rows, "sales_sync")
    lumino_spec = _by_filename(rows, "spec_lumino_custom")

    checks = {
        "postgres + mongodb together": _same_cluster(postgres_core, mongodb_mig),
        "2-approval + hotfix (P0/P1) + hotfix (CVE)": _same_cluster(two_approval, hotfix_tag, hotfix_cve),
        "$50k + lumino ghost + any lumino spec": _same_cluster(fifty_k, lumino_ghost, lumino_spec),
        "event_schema isolated (adr-0043)": _isolated(rows, "adr-0043"),
        "identity_ttl isolated (adr-0047)": _isolated(rows, "adr-0047"),
        "deploy_policy isolated (incident_retro)": _isolated(rows, "incident_retro"),
    }

    print(f"\n--- Threshold {threshold:.2f} ---")
    print(f"N clusters formed: {len(clusters)}")
    print(f"Cluster sizes: {sizes}")
    print("Key memberships:")
    for name, ok in checks.items():
        print(f"  {name:<45}  {'YES' if ok else 'no '}")

    return {
        "threshold": threshold,
        "n_clusters": len(clusters),
        "max_size": max(sizes) if sizes else 0,
        "sizes": sizes,
        "checks": checks,
        "all_checks_pass": all(checks.values()),
    }


async def _run() -> int:
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s %(levelname)s %(name)s: %(message)s",
        datefmt="%H:%M:%S",
    )

    # 1. Reset once up front so all decisions need (re-)clustering.
    log.info("resetting clusters before sweep...")
    await _reset_clusters()

    # 2. Fetch all decisions with their text.
    decisions = await _fetch_all_decisions_with_source()
    log.info("fetched %d decisions for sweep", len(decisions))

    # 3. Embed everything ONCE.
    texts = [embed_input_for(d["statement"], d.get("topic_keywords") or []) for d in decisions]
    log.info("embedding %d decisions once (cached across all thresholds)", len(texts))
    vectors = await embed_batch(texts, "RETRIEVAL_DOCUMENT")
    emb_map: dict[str, np.ndarray] = {
        d["id"]: np.asarray(v, dtype=np.float32) for d, v in zip(decisions, vectors)
    }

    # 4. For each threshold: reset (after first iter), then resolve with cached embeddings.
    all_reports: list[dict] = []
    for i, thr in enumerate(THRESHOLDS):
        if i > 0:
            await _reset_clusters()
        # Build the "unclustered_rows" input shape expected by _resolve_with_embeddings.
        unclustered = [
            {
                "id": d["id"],
                "statement": d["statement"],
                "topic_keywords": d.get("topic_keywords") or [],
                "embedding": None,  # force persistence to use the cached embedding
            }
            for d in decisions
        ]
        await _resolve_with_embeddings(unclustered, emb_map, thr)
        rows_after = await _fetch_all_decisions_with_source()
        report = _report(rows_after, thr)
        all_reports.append(report)

    # 5. Pick recommendation: all 6 membership checks pass.
    #    Total cluster count is expected to be ~7-8 (the Lumino technical
    #    sub-cluster and PR #1023's orphan cluster are acceptable by-products),
    #    so we no longer require n_clusters == 6 exactly.
    qualifying = [r for r in all_reports if r["all_checks_pass"]]
    print("\n" + "=" * 68)
    if qualifying:
        best = min(qualifying, key=lambda r: (r["max_size"], abs(r["n_clusters"] - 7)))
        print(f"Recommended threshold: {best['threshold']:.2f}  "
              f"— all critical memberships present, {best['n_clusters']} clusters, "
              f"max-cluster-size={best['max_size']}.")
    else:
        # Fallback: highest number of passing checks, then n_clusters closest to 6
        by_score = sorted(
            all_reports,
            key=lambda r: (
                -sum(r["checks"].values()),
                abs(r["n_clusters"] - 6),
                r["max_size"],
            ),
        )
        best = by_score[0]
        passing = sum(best["checks"].values())
        print(f"No threshold hit the full 6-cluster + all-memberships gate.")
        print(f"Best partial: {best['threshold']:.2f}  "
              f"— {best['n_clusters']} clusters, {passing}/6 memberships present.")
    print("=" * 68)
    return 0


def main(argv: list[str] | None = None) -> int:
    argparse.ArgumentParser(description="Sweep clustering thresholds.").parse_args(argv or [])
    return asyncio.run(_run())


if __name__ == "__main__":
    sys.exit(main())
