"""Agent 2 — Gemini embeddings + greedy cosine clustering.

Groups semantically related decisions into topic clusters regardless of
surface wording (§7.2 of the build plan).

Public API:
    await embed_batch(texts, task_type) -> list[list[float]]
    cosine(a, b) -> float
    await resolve(threshold=None) -> ResolveResult
    await _resolve_with_embeddings(embeddings, threshold) -> ResolveResult
        (used by tune_threshold.py to sweep thresholds on the same embeddings)
"""
from __future__ import annotations

import asyncio
import logging
import uuid
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any, Literal

import numpy as np
from google import genai
from google.genai import types

from app.config import CLUSTERING_THRESHOLD, EMBED_DIM, GEMINI_EMBED_MODEL, GOOGLE_API_KEY
from app.db import get_supabase

log = logging.getLogger(__name__)

TaskType = Literal["RETRIEVAL_DOCUMENT", "RETRIEVAL_QUERY"]


# ============================================================
# Pure helpers (testable without any API or DB)
# ============================================================

def cosine(a: np.ndarray | list[float], b: np.ndarray | list[float]) -> float:
    """Cosine similarity between two vectors."""
    av = np.asarray(a, dtype=np.float32)
    bv = np.asarray(b, dtype=np.float32)
    denom = float(np.linalg.norm(av) * np.linalg.norm(bv))
    if denom == 0.0:
        return 0.0
    return float(np.dot(av, bv) / denom)


def embed_input_for(statement: str, topic_keywords: list[str]) -> str:
    """Lead with keywords as the topic, then the full statement.

    Reshaped from §7.2.2's `"{stmt} [keywords: {kw}]"` after the Phase 3
    threshold sweep showed surface-form prose (especially action-language
    in PRs) dominated the embedding and pushed same-topic decisions apart.
    Leading with "Topic: {kw}." frames the keywords as the subject and
    boosts cross-surface token overlap for the critical drift clusters
    (Postgres policy ↔ MongoDB migration, 2-approval ↔ hotfix carve-outs,
    $50k gate ↔ Lumino custom-integration ghost).
    """
    kw = " ".join(topic_keywords or [])
    return f"Topic: {kw}. {statement}"


# ============================================================
# Gemini client + embedding call
# ============================================================

def _client() -> genai.Client:
    # No caching — genai's httpx AsyncClient binds to the current event loop,
    # so a singleton breaks across pytest-asyncio tests (each gets a new loop).
    # Client construction is cheap.
    return genai.Client(api_key=GOOGLE_API_KEY)


async def embed_batch(texts: list[str], task_type: TaskType) -> list[list[float]]:
    """Embed a batch of texts in a single Gemini call.

    task_type: "RETRIEVAL_DOCUMENT" for decisions being stored,
               "RETRIEVAL_QUERY" for user questions (Phase 10).
    Empty input → empty output, no API call.
    """
    if not texts:
        return []

    client = _client()
    config = types.EmbedContentConfig(
        task_type=task_type,
        output_dimensionality=EMBED_DIM,
    )
    # The new google-genai SDK exposes async via client.aio.
    result = await client.aio.models.embed_content(
        model=GEMINI_EMBED_MODEL,
        contents=texts,
        config=config,
    )
    return [list(e.values) for e in result.embeddings]


# ============================================================
# Clustering primitives
# ============================================================

@dataclass
class _Cluster:
    id: str
    centroid: np.ndarray
    is_new: bool = False  # seeded during this run


@dataclass
class _Assignment:
    decision_id: str
    cluster_id: str


@dataclass
class ResolveResult:
    n_embedded: int = 0
    n_new_clusters: int = 0
    n_assigned: int = 0
    touched_cluster_ids: set[str] = field(default_factory=set)
    total_clusters_after: int = 0
    total_decisions_clustered: int = 0


def _assign(
    decision_ids: list[str],
    embeddings: dict[str, np.ndarray],
    existing_clusters: list[_Cluster],
    threshold: float,
) -> tuple[list[_Assignment], list[_Cluster]]:
    """Greedy cosine assignment per §7.2.3.

    A decision that seeds a new cluster within this run CAN attract later
    decisions in the same run. Centroids seeded in-run use the seeding
    decision's own embedding as their 1-member centroid.
    """
    clusters: list[_Cluster] = list(existing_clusters)
    assignments: list[_Assignment] = []
    for did in decision_ids:
        emb = embeddings[did]
        best_id: str | None = None
        best_sim = -2.0
        for c in clusters:
            s = cosine(emb, c.centroid)
            if s > best_sim:
                best_id, best_sim = c.id, s
        if best_sim >= threshold and best_id is not None:
            assignments.append(_Assignment(decision_id=did, cluster_id=best_id))
        else:
            new_id = str(uuid.uuid4())
            clusters.append(_Cluster(id=new_id, centroid=emb, is_new=True))
            assignments.append(_Assignment(decision_id=did, cluster_id=new_id))
    return assignments, clusters


# ============================================================
# Persistence helpers
# ============================================================

async def _fetch_unclustered() -> list[dict[str, Any]]:
    """Ordered by (decided_at, id) so the greedy clustering is
    deterministic across runs. Without this, the unclustered fetch
    order is whatever Postgres decides to return, and the greedy
    algorithm's order-dependence makes cluster boundaries flicker
    between runs at borderline cosine distances."""
    sb = get_supabase()
    res = await asyncio.to_thread(
        lambda: sb.table("decisions")
        .select("id, statement, topic_keywords, embedding, confidence, decided_at")
        .is_("topic_cluster_id", None)
        .order("decided_at", desc=False)
        .order("id", desc=False)
        .execute()
    )
    return res.data or []


async def _fetch_existing_clusters() -> list[_Cluster]:
    sb = get_supabase()
    res = await asyncio.to_thread(
        lambda: sb.table("topic_clusters").select("id, centroid").execute()
    )
    out: list[_Cluster] = []
    for row in res.data or []:
        c = row["centroid"]
        if isinstance(c, str):
            # pgvector returned as string like "[0.1,0.2,...]"
            c = _parse_pgvector(c)
        out.append(_Cluster(id=row["id"], centroid=np.asarray(c, dtype=np.float32)))
    return out


def _parse_pgvector(s: str) -> list[float]:
    s = s.strip()
    if s.startswith("["):
        s = s[1:]
    if s.endswith("]"):
        s = s[:-1]
    if not s:
        return []
    return [float(x) for x in s.split(",")]


async def _insert_new_clusters(new_cluster_rows: list[dict[str, Any]]) -> None:
    if not new_cluster_rows:
        return
    sb = get_supabase()
    await asyncio.to_thread(
        lambda: sb.table("topic_clusters").insert(new_cluster_rows).execute()
    )


async def _update_decision(decision_id: str, embedding: list[float], cluster_id: str) -> None:
    sb = get_supabase()
    await asyncio.to_thread(
        lambda: sb.table("decisions")
        .update({"embedding": embedding, "topic_cluster_id": cluster_id})
        .eq("id", decision_id)
        .execute()
    )


async def _recompute_centroids(cluster_ids: set[str]) -> None:
    """For each touched cluster, centroid = mean of member embeddings."""
    if not cluster_ids:
        return
    sb = get_supabase()
    res = await asyncio.to_thread(
        lambda: sb.table("decisions")
        .select("topic_cluster_id, embedding")
        .in_("topic_cluster_id", list(cluster_ids))
        .execute()
    )
    buckets: dict[str, list[np.ndarray]] = {}
    for row in res.data or []:
        cid = row["topic_cluster_id"]
        e = row["embedding"]
        if isinstance(e, str):
            e = _parse_pgvector(e)
        if e is None or (isinstance(e, list) and not e):
            continue
        buckets.setdefault(cid, []).append(np.asarray(e, dtype=np.float32))
    now_iso = datetime.now(timezone.utc).isoformat()
    for cid, vecs in buckets.items():
        if not vecs:
            continue
        mean = np.mean(np.vstack(vecs), axis=0).tolist()
        await asyncio.to_thread(
            lambda m=mean, c=cid: sb.table("topic_clusters")
            .update({"centroid": m, "updated_at": now_iso})
            .eq("id", c)
            .execute()
        )


# ============================================================
# Orchestration
# ============================================================

async def _resolve_with_embeddings(
    unclustered_rows: list[dict[str, Any]],
    embeddings: dict[str, np.ndarray],
    threshold: float,
) -> ResolveResult:
    """Cluster + persist step. Caller provides the decisions to process
    and a dict mapping decision_id -> embedding (np.ndarray)."""
    if not unclustered_rows:
        total = await _count_total_clusters()
        return ResolveResult(total_clusters_after=total)

    existing = await _fetch_existing_clusters()
    decision_ids = [r["id"] for r in unclustered_rows]
    assignments, clusters_after = _assign(decision_ids, embeddings, existing, threshold)

    # 1. Insert new clusters with their seed centroid (1-member centroid for now;
    #    recompute below if they ended up with more than 1 member).
    new_clusters = [c for c in clusters_after if c.is_new]
    new_cluster_rows = [
        {"id": c.id, "centroid": c.centroid.tolist()}
        for c in new_clusters
    ]
    await _insert_new_clusters(new_cluster_rows)

    # 2. Update each decision with (embedding, topic_cluster_id). Sequential
    #    to keep the supabase client happy; 26 rows is trivial.
    for a in assignments:
        emb = embeddings[a.decision_id].tolist()
        await _update_decision(a.decision_id, emb, a.cluster_id)

    # 3. Recompute centroids for every touched cluster (new or grown).
    touched = {a.cluster_id for a in assignments}
    await _recompute_centroids(touched)

    total_clusters = await _count_total_clusters()
    total_clustered = await _count_total_clustered_decisions()

    return ResolveResult(
        n_embedded=sum(1 for r in unclustered_rows if not r.get("embedding")),
        n_new_clusters=len(new_clusters),
        n_assigned=len(assignments) - len(new_clusters),
        touched_cluster_ids=touched,
        total_clusters_after=total_clusters,
        total_decisions_clustered=total_clustered,
    )


async def _count_total_clusters() -> int:
    sb = get_supabase()
    res = await asyncio.to_thread(
        lambda: sb.table("topic_clusters").select("id", count="exact").limit(1).execute()
    )
    return getattr(res, "count", None) or 0


async def _count_total_clustered_decisions() -> int:
    sb = get_supabase()
    res = await asyncio.to_thread(
        lambda: sb.table("decisions")
        .select("id", count="exact")
        .not_.is_("topic_cluster_id", None)
        .limit(1)
        .execute()
    )
    return getattr(res, "count", None) or 0


async def resolve(threshold: float | None = None) -> ResolveResult:
    """Main entry point. Fetches unclustered decisions, embeds the ones
    without an embedding, clusters them, persists, recomputes centroids."""
    thr = threshold if threshold is not None else CLUSTERING_THRESHOLD

    unclustered = await _fetch_unclustered()
    if not unclustered:
        total = await _count_total_clusters()
        clustered = await _count_total_clustered_decisions()
        log.info("resolve: no unclustered decisions; nothing to do (%d clusters)", total)
        return ResolveResult(total_clusters_after=total, total_decisions_clustered=clustered)

    # Build or reuse embeddings per decision
    to_embed_idx: list[int] = []
    to_embed_texts: list[str] = []
    for i, row in enumerate(unclustered):
        if not row.get("embedding"):
            to_embed_idx.append(i)
            to_embed_texts.append(embed_input_for(row["statement"], row.get("topic_keywords") or []))

    new_embeddings: list[list[float]] = []
    if to_embed_texts:
        log.info("resolve: embedding %d decisions", len(to_embed_texts))
        new_embeddings = await embed_batch(to_embed_texts, "RETRIEVAL_DOCUMENT")

    emb_map: dict[str, np.ndarray] = {}
    for i, row in enumerate(unclustered):
        if i in to_embed_idx:
            e = new_embeddings[to_embed_idx.index(i)]
            emb_map[row["id"]] = np.asarray(e, dtype=np.float32)
        else:
            e = row["embedding"]
            if isinstance(e, str):
                e = _parse_pgvector(e)
            emb_map[row["id"]] = np.asarray(e, dtype=np.float32)

    result = await _resolve_with_embeddings(unclustered, emb_map, thr)
    result.n_embedded = len(to_embed_texts)
    log.info(
        "resolve: threshold=%.3f embedded=%d new_clusters=%d assigned_to_existing=%d "
        "total_clusters=%d clustered_decisions=%d",
        thr,
        result.n_embedded,
        result.n_new_clusters,
        result.n_assigned,
        result.total_clusters_after,
        result.total_decisions_clustered,
    )
    return result
