"""Pure tests for the detector rule functions (§10.2).

No I/O, no API calls, no DB — all decisions are hand-built. These must
pass before the detector runs against real data.
"""
from __future__ import annotations

from datetime import date, timedelta

import numpy as np

from app.agents.detector import (
    DetectorDecision,
    classify_pair,
    is_contradicts,
    is_silent_reversal,
)


def _dec(
    id: str,
    stmt: str,
    type_: str,
    day_offset: int,
    kws: list[str],
    emb: list[float] | None = None,
    *,
    confidence: float = 0.90,
    filename: str = "",
    source_excerpt: str = "",
) -> DetectorDecision:
    return DetectorDecision(
        id=id,
        statement=stmt,
        type=type_,
        decided_at=date(2026, 1, 1) + timedelta(days=day_offset - 1),
        confidence=confidence,
        source_excerpt=source_excerpt,
        topic_keywords=kws,
        embedding=np.asarray(emb or [1.0, 0.0, 0.0], dtype=np.float32),
        filename=filename,
    )


# ============================================================
# Precondition: no shared keyword → consistent
# ============================================================

def test_keyword_overlap_precondition_blocks_unrelated():
    """Pair with disagreeing types + disagreeing embeddings is still
    'consistent' when they share no keyword — the mixed-cluster guard."""
    d1 = _dec("a", "Postgres is primary datastore.", "architectural", 1,
              ["postgres", "datastore"], [1.0, 0.0, 0.0])
    d2 = _dec("b", "CVE patches merge with 1 approval.", "action", 5,
              ["cve", "dependabot"], [0.0, 1.0, 0.0])  # cosine = 0 (disagree)
    assert classify_pair(d1, d2, [d1, d2]) == "consistent"


# ============================================================
# silent_reversal
# ============================================================

def test_silent_reversal_fires_on_arch_to_action():
    d1 = _dec("a", "Postgres is the primary datastore.", "architectural", 1,
              ["postgres", "datastore"], [1.0, 0.0, 0.0])
    d2 = _dec("b", "Migrate user_events writes from Postgres to MongoDB.", "action", 30,
              ["postgres", "mongodb", "migration"], [0.0, 1.0, 0.0])  # cosine = 0
    assert is_silent_reversal(d1, d2, [d1, d2]) is True
    assert classify_pair(d1, d2, [d1, d2]) == "silent_reversal"


def test_silent_reversal_blocked_by_intervening_arch():
    d1 = _dec("a", "Postgres is the primary datastore.", "architectural", 1,
              ["postgres", "datastore"], [1.0, 0.0, 0.0])
    mid = _dec("m", "Event-store schemas follow SemVer.", "architectural", 15,
               ["postgres", "event_schema", "semver"], [0.7, 0.7, 0.0])
    d2 = _dec("b", "Migrate user_events writes from Postgres to MongoDB.", "action", 30,
              ["postgres", "mongodb", "migration"], [0.0, 1.0, 0.0])
    # Intervening architectural decision between d1 and d2 blocks silent_reversal.
    assert is_silent_reversal(d1, d2, [d1, mid, d2]) is False
    # classify_pair falls through to contradicts (arch vs action is type-diff, cosine < 0.7,
    # keywords overlap, no citation). So expect "contradicts" rather than "silent_reversal".
    assert classify_pair(d1, d2, [d1, mid, d2]) == "contradicts"


# ============================================================
# contradicts
# ============================================================

def test_contradicts_fires_on_type_mismatch():
    """Standard contradicts: process vs action with kw overlap + disagree
    + cross-file."""
    d1 = _dec("a", "All pull requests require two approvals before merge.",
              "process", 1, ["pull_request", "approval", "review_policy"],
              [1.0, 0.0, 0.0], filename="q1_arch_review_2026-03-15.txt")
    d2_action = _dec("c", "PR merged with one approval per hotfix policy.",
                     "action", 60, ["pull_request", "approval", "hotfix"],
                     [0.0, 1.0, 0.0], filename="pr_1050_hotfix.json")
    assert is_contradicts(d1, d2_action, [d1, d2_action]) is True
    assert classify_pair(d1, d2_action, [d1, d2_action]) == "contradicts"

    # Arch-arch same-type pair with disagreement must NOT fire contradicts
    # — Fix D carve-out is process-process only.
    a1 = _dec("x", "Postgres is primary datastore.", "architectural", 1,
              ["postgres", "datastore"], [1.0, 0.0, 0.0],
              filename="adr-0042.md")
    a2 = _dec("y", "Architectural refinement, different topic.", "architectural", 2,
              ["postgres", "datastore"], [0.0, 1.0, 0.0],
              filename="adr-0099.md")
    assert is_contradicts(a1, a2, [a1, a2]) is False


def test_same_file_pair_returns_consistent():
    """Fix E: two decisions from the same filename, even with type
    mismatch + kw overlap + disagreeing embeddings, must return
    'consistent'. Drifts are cross-document by definition."""
    d1 = _dec("a", "HMAC-SHA256 signatures authenticate Segment-shaped requests.",
              "architectural", 1, ["segment_adapter", "authentication"],
              [1.0, 0.0, 0.0], filename="spec_lumino_custom_integration_2026-06-15.md")
    d2 = _dec("b", "Segment adapter will be delivered by 2026-08-15.",
              "action", 2, ["segment_adapter", "delivery_deadline"],
              [0.0, 1.0, 0.0], filename="spec_lumino_custom_integration_2026-06-15.md")
    # Same filename → Fix E blocks all non-consistent rules.
    assert classify_pair(d1, d2, [d1, d2]) == "consistent"

    # Flip one filename → should fire silent_reversal (arch → action,
    # kw overlap, cos=0 < 0.78, cross-file).
    d2_crossfile = _dec("c", "Segment adapter will be delivered by 2026-08-15.",
                        "action", 2, ["segment_adapter", "delivery_deadline"],
                        [0.0, 1.0, 0.0], filename="other_spec.md")
    assert classify_pair(d1, d2_crossfile, [d1, d2_crossfile]) == "silent_reversal"


# ============================================================
# consistent fallback
# ============================================================

def test_contradicts_fires_on_same_type_process():
    """Fix D: process↔process allowed to fire contradicts at cos < 0.88
    (Drift #2 — 2-approval policy vs hotfix carve-out, both typed as
    process by the extractor)."""
    d1 = _dec("a", "All pull requests require two approvals before merge, with no exceptions.",
              "process", 1, ["pull_request", "approval", "review_policy"],
              [1.0, 0.0, 0.0])
    d2 = _dec("b", "P0/P1 pull requests require only one approval instead of two.",
              "process", 60, ["pull_request", "approval", "hotfix"],
              [0.85, 0.5, 0.0])  # cos ~= 0.862, below 0.88
    assert is_contradicts(d1, d2, [d1, d2]) is True
    assert classify_pair(d1, d2, [d1, d2]) == "contradicts"


def test_consistent_fallback():
    # Same type, keyword overlap, high cosine — nothing should fire.
    d1 = _dec("a", "Postgres 15 on RDS is the primary datastore.",
              "architectural", 1, ["postgres", "datastore"], [1.0, 0.0, 0.0])
    d2 = _dec("b", "Postgres remains primary; read replicas for analytics.",
              "architectural", 5, ["postgres", "datastore", "analytics"],
              [0.95, 0.05, 0.0])  # cosine high
    assert classify_pair(d1, d2, [d1, d2]) == "consistent"
