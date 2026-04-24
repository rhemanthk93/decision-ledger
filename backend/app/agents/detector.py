"""Agent 3 — Conflict detector (pure Python rules).

Walks each cluster's firm decisions in chronological order, classifies
consecutive pairs into one of five rules, and upserts non-consistent
outcomes into the conflicts table (§7.3).

Design principles:
- Deterministic. No LLM calls, no randomness.
- Inspectable. Every rule is a pure function with hand-built tests.
- Conservative. A keyword-overlap precondition gates every rule except
  'consistent' so that mixed-topic clusters (produced when the
  resolver's threshold is tuned for drift-recall over isolation) do
  not emit false-positive conflicts.
- Soft decisions are part of cluster_history (passed to rule functions
  for intervening-arch checks and narrator context) but are EXCLUDED
  from the consecutive-pair walk. Drifts are firm→firm transitions.
"""
from __future__ import annotations

import asyncio
import logging
import re
from dataclasses import dataclass, field
from datetime import date, datetime
from typing import Any, Literal

import numpy as np

from app.agents.resolver import cosine
from app.db import get_supabase

log = logging.getLogger(__name__)

Rule = Literal["supersedes", "reverses", "contradicts", "silent_reversal", "consistent"]

# Fix A: 0.78 (was 0.7). The embedding reshape in Phase 3 that lets
# surface-variant decisions cluster together also pulls genuinely
# disagreeing pairs up past the naive 0.7 threshold. 0.78 reclaims the
# 0.749 pair (ADR-0042 "new services in Postgres" ↔ PR #847 MongoDB).
# Safe: no other cluster has kw_overlap=True AND type mismatch in the
# newly-disagree range (verified via verbose dump at commit e07598c).
DISAGREE_COSINE_THRESHOLD = 0.78

# Fix D: same-type process-process pairs are allowed to fire contradicts
# at a stricter cosine floor. Rationale: policy statements within one
# cluster that disagree (even slightly) and share keywords are the
# signature of process-decay (Drift #2). Arch-arch is NOT extended
# here — two architectural decisions at similar cosine are usually
# legitimate refinements.
CONTRADICTS_SAMETYPE_PROCESS_COSINE = 0.88

CONFIDENCE_WALK_FLOOR = 0.60


# ============================================================
# Decision shape used by the rule functions
# ============================================================

@dataclass
class DetectorDecision:
    """Minimal shape the rule functions need. Tests build these directly;
    the walker constructs them from joined DB rows."""
    id: str
    statement: str
    type: str
    decided_at: date
    confidence: float
    source_excerpt: str = ""
    topic_keywords: list[str] = field(default_factory=list)
    embedding: np.ndarray | None = None
    filename: str = ""


# ============================================================
# Pure rule helpers
# ============================================================

_ADR_NUM_RE = re.compile(r"adr[-_ ]?(\d{3,})", re.IGNORECASE)
_PR_NUM_RE = re.compile(r"pr[-_ ]?(\d{2,})", re.IGNORECASE)


def _normalize_keyword(k: str) -> str:
    """Lowercase, trim, space/dash → underscore, strip trailing 's'."""
    if not k:
        return ""
    s = k.strip().lower().replace("-", "_").replace(" ", "_")
    if s.endswith("s") and len(s) > 1:
        s = s[:-1]
    return s


def _normalize_set(keywords: list[str]) -> set[str]:
    return {n for n in (_normalize_keyword(k) for k in keywords or []) if n}


def _keywords_overlap(d1: DetectorDecision, d2: DetectorDecision) -> bool:
    """At least one shared normalized keyword."""
    a = _normalize_set(d1.topic_keywords)
    b = _normalize_set(d2.topic_keywords)
    return bool(a & b)


def _citations_of(d1: DetectorDecision) -> list[str]:
    """Lowercase identifiers to look for in d2's text when checking whether
    d2 cites d1. Derived from d1.filename."""
    out: list[str] = []
    fn = (d1.filename or "").lower()
    m = _ADR_NUM_RE.search(fn)
    if m:
        out.extend([f"adr-{m.group(1)}", f"adr {m.group(1)}", f"adr{m.group(1)}"])
    m = _PR_NUM_RE.search(fn)
    if m:
        out.extend([f"pr #{m.group(1)}", f"pr#{m.group(1)}", f"pr {m.group(1)}", f"#{m.group(1)}"])
    return out


def _d2_cites_d1(d1: DetectorDecision, d2: DetectorDecision) -> bool:
    cites = _citations_of(d1)
    if not cites:
        return False
    hay = f"{d2.statement}\n{d2.source_excerpt}".lower()
    return any(c in hay for c in cites)


def _cosine_disagree(d1: DetectorDecision, d2: DetectorDecision) -> bool:
    if d1.embedding is None or d2.embedding is None:
        return False
    return cosine(d1.embedding, d2.embedding) < DISAGREE_COSINE_THRESHOLD


def _has_intervening_arch(d1: DetectorDecision, d2: DetectorDecision, cluster_history: list[DetectorDecision]) -> bool:
    """True if a FIRM architectural decision lands strictly between d1
    and d2 (by decided_at) in cluster_history, not counting d1 or d2
    themselves. Fix C: soft architectural decisions (conf < 0.60) do
    NOT block silent_reversal — the 'intervening' check is meant to
    catch formal revisions, not exploratory softs."""
    lo, hi = d1.decided_at, d2.decided_at
    if lo > hi:
        lo, hi = hi, lo
    for d in cluster_history:
        if d.id in (d1.id, d2.id):
            continue
        if d.type != "architectural":
            continue
        if d.confidence < CONFIDENCE_WALK_FLOOR:
            continue
        if lo < d.decided_at < hi:
            return True
    return False


# ============================================================
# Rule functions
# ============================================================

def explicit_supersedes(d1: DetectorDecision, d2: DetectorDecision) -> bool:
    """d2 explicitly references d1 by ADR number / PR number."""
    return _d2_cites_d1(d1, d2)


def explicit_reverses(d1: DetectorDecision, d2: DetectorDecision) -> bool:
    """d2 cites d1 explicitly AND statements disagree.

    Note: a bare citation alone fires as `supersedes` (checked first in
    classify_pair). Reverses requires citation + disagreement, which is
    stricter. Hackathon scope: string match on cited identifiers only.
    """
    return _d2_cites_d1(d1, d2) and _cosine_disagree(d1, d2)


def is_silent_reversal(
    d1: DetectorDecision, d2: DetectorDecision, cluster_history: list[DetectorDecision]
) -> bool:
    """arch → action, disagree, no intervening architectural decision."""
    if d1.type != "architectural" or d2.type != "action":
        return False
    if not _cosine_disagree(d1, d2):
        return False
    if _has_intervening_arch(d1, d2, cluster_history):
        return False
    return True


def is_contradicts(
    d1: DetectorDecision, d2: DetectorDecision, cluster_history: list[DetectorDecision]
) -> bool:
    """Two branches:

    Standard: different types + cos < DISAGREE_COSINE_THRESHOLD + no citation.

    Process-decay (Fix D): SAME type but both 'process' + cos <
    CONTRADICTS_SAMETYPE_PROCESS_COSINE + no citation. Catches Drift #2
    where a review-policy statement and a later carve-out statement are
    both classified as process by the extractor but disagree."""
    if _d2_cites_d1(d1, d2):
        return False
    if d1.type != d2.type:
        return _cosine_disagree(d1, d2)
    if d1.type == "process" and d2.type == "process":
        if d1.embedding is None or d2.embedding is None:
            return False
        return cosine(d1.embedding, d2.embedding) < CONTRADICTS_SAMETYPE_PROCESS_COSINE
    return False


def classify_pair(
    d1: DetectorDecision, d2: DetectorDecision, cluster_history: list[DetectorDecision]
) -> Rule:
    """Pipeline per §7.3.2 with a keyword-overlap precondition.

    The precondition prevents false-positive conflicts on mixed clusters
    (clusters 6, 7 in our corpus) where unrelated decisions share a
    cluster_id due to embedding-space limits at our chosen clustering
    threshold (see config.CLUSTERING_THRESHOLD comment).
    """
    if not _keywords_overlap(d1, d2):
        return "consistent"
    # Fix E: two decisions from the same source document are coherent by
    # construction — the author wrote them together. A drift is, by
    # definition, cross-document. Empty filenames (e.g. hand-built test
    # fixtures) fall through this gate unchanged.
    if d1.filename and d2.filename and d1.filename == d2.filename:
        return "consistent"
    if explicit_supersedes(d1, d2) and not _cosine_disagree(d1, d2):
        return "supersedes"
    if explicit_reverses(d1, d2):
        return "reverses"
    if is_silent_reversal(d1, d2, cluster_history):
        return "silent_reversal"
    if is_contradicts(d1, d2, cluster_history):
        return "contradicts"
    return "consistent"


# ============================================================
# Persistence
# ============================================================

def _parse_pgvector(s: str) -> list[float]:
    s = s.strip()
    if s.startswith("["):
        s = s[1:]
    if s.endswith("]"):
        s = s[:-1]
    if not s:
        return []
    return [float(x) for x in s.split(",")]


def _row_to_detector_decision(row: dict[str, Any]) -> DetectorDecision:
    e = row.get("embedding")
    if isinstance(e, str):
        e = _parse_pgvector(e)
    emb_arr: np.ndarray | None = np.asarray(e, dtype=np.float32) if e else None
    decided_at_raw = row["decided_at"]
    if isinstance(decided_at_raw, str):
        decided_at = date.fromisoformat(decided_at_raw[:10])
    elif isinstance(decided_at_raw, datetime):
        decided_at = decided_at_raw.date()
    else:
        decided_at = decided_at_raw
    filename = ""
    docs = row.get("documents") or {}
    if isinstance(docs, dict):
        filename = docs.get("filename") or ""
    return DetectorDecision(
        id=row["id"],
        statement=row["statement"] or "",
        type=row["type"],
        decided_at=decided_at,
        confidence=float(row.get("confidence") or 0),
        source_excerpt=row.get("source_excerpt") or "",
        topic_keywords=list(row.get("topic_keywords") or []),
        embedding=emb_arr,
        filename=filename,
    )


async def _fetch_cluster_ids() -> list[str]:
    sb = get_supabase()
    res = await asyncio.to_thread(
        lambda: sb.table("topic_clusters").select("id").execute()
    )
    return [r["id"] for r in (res.data or [])]


async def _fetch_cluster_decisions(cluster_id: str) -> list[DetectorDecision]:
    sb = get_supabase()
    res = await asyncio.to_thread(
        lambda: sb.table("decisions")
        .select("id, statement, type, decided_at, confidence, source_excerpt, topic_keywords, embedding, documents(filename)")
        .eq("topic_cluster_id", cluster_id)
        .order("decided_at", desc=False)
        .order("id", desc=False)
        .execute()
    )
    return [_row_to_detector_decision(r) for r in (res.data or [])]


async def _fetch_existing_pair_keys() -> set[tuple[str, str]]:
    sb = get_supabase()
    res = await asyncio.to_thread(
        lambda: sb.table("conflicts").select("d1_id, d2_id").execute()
    )
    return {(r["d1_id"], r["d2_id"]) for r in (res.data or [])}


async def _insert_conflict(cluster_id: str, d1_id: str, d2_id: str, rule: Rule) -> bool:
    """Returns True if a new row was inserted, False if it already existed."""
    sb = get_supabase()
    try:
        res = await asyncio.to_thread(
            lambda: sb.table("conflicts").insert({
                "cluster_id": cluster_id,
                "d1_id": d1_id,
                "d2_id": d2_id,
                "rule": rule,
            }).execute()
        )
        return bool(res.data)
    except Exception as e:  # noqa: BLE001 — treat unique-violation as "already there"
        msg = str(e).lower()
        if "duplicate" in msg or "unique" in msg or "23505" in msg:
            return False
        raise


# ============================================================
# Cluster walker + orchestration
# ============================================================

@dataclass
class ClusterResult:
    cluster_id: str
    walked: int = 0            # number of firm decisions walked
    total: int = 0             # full cluster size including softs
    pairs_checked: int = 0
    conflicts_new: int = 0
    firings: list[tuple[DetectorDecision, DetectorDecision, Rule]] = field(default_factory=list)


async def detect_conflicts_for(cluster_id: str, existing_pairs: set[tuple[str, str]]) -> ClusterResult:
    cluster_history = await _fetch_cluster_decisions(cluster_id)
    walk_decisions = [d for d in cluster_history if d.confidence >= CONFIDENCE_WALK_FLOOR]
    result = ClusterResult(
        cluster_id=cluster_id,
        walked=len(walk_decisions),
        total=len(cluster_history),
    )
    if len(walk_decisions) < 2:
        return result
    # Fix C: enumerate all (i, j) pairs with i < j within this cluster,
    # still chronological. This lets arch→action drifts see a direct
    # pairing even when a process or soft decision sits between them.
    for i, d1 in enumerate(walk_decisions):
        for d2 in walk_decisions[i + 1:]:
            result.pairs_checked += 1
            rule = classify_pair(d1, d2, cluster_history)
            if rule == "consistent":
                continue
            result.firings.append((d1, d2, rule))
            if (d1.id, d2.id) in existing_pairs:
                continue
            if await _insert_conflict(cluster_id, d1.id, d2.id, rule):
                result.conflicts_new += 1
                existing_pairs.add((d1.id, d2.id))
    return result


async def detect_all() -> list[ClusterResult]:
    cluster_ids = await _fetch_cluster_ids()
    existing = await _fetch_existing_pair_keys()
    results: list[ClusterResult] = []
    for cid in cluster_ids:
        try:
            r = await detect_conflicts_for(cid, existing)
        except Exception as e:  # noqa: BLE001 — one bad cluster must not break the loop
            log.exception("detect_conflicts_for(%s) failed: %s", cid, e)
            continue
        results.append(r)
    total_new = sum(r.conflicts_new for r in results)
    total_firings = sum(len(r.firings) for r in results)
    log.info(
        "detect_all: clusters=%d firings=%d new_conflicts=%d",
        len(cluster_ids), total_firings, total_new,
    )
    return results
