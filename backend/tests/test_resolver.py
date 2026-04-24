"""Resolver tests.

Pure unit tests (no marker) exercise the cosine math and the empty-input
short-circuit. Integration tests (@pytest.mark.integration) hit the live
Gemini API and the Supabase DB — they assume the corpus has been seeded.

Run with:
    uv run pytest tests/test_resolver.py -v
"""
from __future__ import annotations

import pytest

from app.agents.resolver import cosine, embed_batch, resolve
from app.config import EMBED_DIM


# ============================================================
# Pure (no API, no DB)
# ============================================================

def test_cosine_math():
    assert cosine([1.0, 0.0], [1.0, 0.0]) == pytest.approx(1.0, abs=1e-6)
    assert cosine([1.0, 0.0], [0.0, 1.0]) == pytest.approx(0.0, abs=1e-6)
    assert cosine([1.0, 0.0], [-1.0, 0.0]) == pytest.approx(-1.0, abs=1e-6)
    # Scale invariance
    assert cosine([1.0, 2.0, 3.0], [2.0, 4.0, 6.0]) == pytest.approx(1.0, abs=1e-6)
    # Zero vector guard (no NaN)
    assert cosine([0.0, 0.0], [1.0, 1.0]) == 0.0


async def test_embed_batch_empty_input():
    """Empty input returns [] without calling the API."""
    result = await embed_batch([], "RETRIEVAL_DOCUMENT")
    assert result == []


# ============================================================
# Integration (live Gemini / Supabase)
# ============================================================

@pytest.mark.integration
async def test_embed_batch_returns_correct_dimensions():
    texts = ["Postgres is the primary datastore.", "Event schemas use SemVer.", "hello world"]
    result = await embed_batch(texts, "RETRIEVAL_DOCUMENT")
    assert len(result) == len(texts)
    for v in result:
        assert len(v) == EMBED_DIM
        assert all(isinstance(x, float) for x in v[:10])


@pytest.mark.integration
async def test_resolve_idempotent():
    """Two back-to-back resolve() calls; the second must be a no-op."""
    first = await resolve()
    second = await resolve()
    assert second.n_embedded == 0, f"second resolve re-embedded {second.n_embedded}"
    assert second.n_new_clusters == 0, f"second resolve created {second.n_new_clusters} new clusters"
    assert second.n_assigned == 0, f"second resolve assigned {second.n_assigned} decisions"
    # Cluster count should be identical
    assert second.total_clusters_after == first.total_clusters_after
