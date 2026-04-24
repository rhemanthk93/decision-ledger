"""Fixture-based tests against the real Haiku API.

Per §10.2: quality of the prompt is what's being tested, so do not mock.
Requires the 14 fixtures to be seeded in the documents table.

Run with:
    uv run pytest tests/test_extractor.py -v
"""
from __future__ import annotations

import asyncio

import pytest

from app.agents.extractor import extract
from app.db import get_supabase
from app.schemas import Document

SOURCE_TYPE_PRIORITY = {"meeting": 0, "adr": 1, "slack": 2, "spec": 3, "pr": 4}


async def _doc_by_num(num: int) -> Document:
    sb = get_supabase()
    res = await asyncio.to_thread(lambda: sb.table("documents").select("*").execute())
    rows = sorted(
        res.data or [],
        key=lambda r: (r["doc_date"], SOURCE_TYPE_PRIORITY.get(r["source_type"], 99), r["filename"]),
    )
    assert 1 <= num <= len(rows), f"doc num {num} out of range (have {len(rows)})"
    r = rows[num - 1]
    return Document(
        id=r["id"],
        source_type=r["source_type"],
        filename=r["filename"],
        doc_date=r["doc_date"],
        content=r["content"],
    )


def _statements(decisions) -> str:
    return " | ".join(d.statement.lower() for d in decisions)


@pytest.mark.integration
async def test_doc_01_returns_3_firm_decisions():
    """Q1 arch review — anchor meeting for all 3 drifts. §9.2 target: 3 firm, 0 soft."""
    doc = await _doc_by_num(1)
    assert "q1_arch_review" in doc.filename

    decisions = await extract(doc)
    assert len(decisions) == 3, f"expected 3 firm decisions, got {len(decisions)}"

    firm = [d for d in decisions if d.confidence >= 0.80]
    assert len(firm) == 3, f"expected 3 with confidence >= 0.80, got {len(firm)}"

    blob = _statements(decisions)
    # Postgres primary datastore (architectural)
    assert "postgres" in blob, f"no postgres decision in: {blob}"
    # 2-approval review policy (process)
    assert "approval" in blob or "review" in blob, f"no review/approval decision in: {blob}"
    # $50k custom integration gate (product)
    assert "$50k" in blob or "50k" in blob or "custom integration" in blob, f"no $50k/custom-integration decision in: {blob}"


@pytest.mark.integration
async def test_doc_05_returns_zero_decisions():
    """Apr 8 backend-guild — discussion about Snowflake/SDK priority/cold storage. §9.2 target: 0, 20 anti-ex msgs."""
    doc = await _doc_by_num(5)
    assert "backend_guild_2026-04-08" in doc.filename

    decisions = await extract(doc)
    assert decisions == [], (
        f"expected 0 decisions (this is the canary anti-example fixture), "
        f"got {len(decisions)}: {_statements(decisions)}"
    )


@pytest.mark.integration
async def test_doc_14_returns_zero_decisions():
    """Aug 5 identity standup — async yesterday/today/blockers. §9.2 target: 0, 12 anti-ex msgs."""
    doc = await _doc_by_num(14)
    assert "identity_standup" in doc.filename

    decisions = await extract(doc)
    assert decisions == [], (
        f"expected 0 decisions (pure anti-example standup fixture), "
        f"got {len(decisions)}: {_statements(decisions)}"
    )


@pytest.mark.integration
async def test_doc_08_returns_one_soft_ghost_reference():
    """May 20 sales_sync — Marcus references 'the custom segment pipe we agreed to
    for lumino', Priya confirms 'yep that's on track', Jessica agrees spec is coming.
    This is the Drift #3 ghost-decision trigger. Must extract exactly 1 soft
    decision pointing at the Lumino custom work."""
    doc = await _doc_by_num(8)
    assert "sales_sync" in doc.filename

    decisions = await extract(doc)
    assert len(decisions) == 1, (
        f"expected exactly 1 soft ghost reference, got {len(decisions)}: "
        f"{_statements(decisions)}"
    )
    d = decisions[0]
    assert 0.40 <= d.confidence <= 0.55, (
        f"expected confidence in [0.40, 0.55], got {d.confidence:.3f}"
    )
    stmt_low = d.statement.lower()
    assert "lumino" in stmt_low or "custom" in stmt_low, (
        f"expected statement to mention 'lumino' or 'custom' integration; got: {d.statement}"
    )
    assert "agreed to" in d.source_excerpt.lower() or "agreed" in d.source_excerpt.lower(), (
        f"expected source_excerpt to contain the retrospective phrase; got: {d.source_excerpt!r}"
    )


@pytest.mark.integration
async def test_doc_03_returns_one_soft_decision():
    """Apr 2 identity squad weekly — foreshadows Drift #1 as a soft decision. §9.2 target: 0 firm, 1 soft."""
    doc = await _doc_by_num(3)
    assert "identity_squad_weekly" in doc.filename

    decisions = await extract(doc)
    assert len(decisions) == 1, f"expected exactly 1 soft decision, got {len(decisions)}: {_statements(decisions)}"

    d = decisions[0]
    assert 0.40 <= d.confidence <= 0.60, (
        f"expected soft confidence in [0.40, 0.60], got {d.confidence:.3f}"
    )
