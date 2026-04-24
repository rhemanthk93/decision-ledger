# ADR-0047: Identity Graph Edge TTL

**Status:** Accepted
**Date:** 2026-07-10
**Author:** Jessica Wong
**Deciders:** Jessica Wong (Identity), Arif Rahman (Identity), Dennis Tan (Activation), Wei Ming Tan (CTO, signoff)
**Supersedes:** n/a

## Context

Meridian's identity resolution graph connects user identifiers across devices and sessions. Each connection is stored as an edge with a source event reference, a connection type (hashed email match, device-ID match, explicit merge), and a timestamp. As the product has scaled, edge count has grown roughly linearly with event volume — we are currently at ~2.1 billion edges across the production graph and projecting ~4 billion by end of Q4 2026.

This growth creates three costs. First, graph-traversal query latency degrades as the average node fan-out grows; p99 identity resolution time is up 28% over the trailing 12 months. Second, storage cost on the identity-graph cluster scales directly with edge count — about $14k/month at current volume and rising. Third, recovery after a cluster failure scales with graph size, and our cold-start time from snapshot is now on the wrong side of our stated recovery-time objective.

We have deferred confronting this for roughly eight months, most recently in the Q2 planning discussion where the TTL question was pulled into the identity v2 workstream. This ADR resolves it.

## Decision

**Identity graph edges older than 18 months are archived and dropped from the hot graph.**

Specifics:

- Archival is based on edge creation timestamp, not on last traversal. Edges traversed recently are nonetheless archived if they are older than 18 months at origin.
- Archive destination is cold storage in S3 (`s3://meridian-identity-archive/`), partitioned by year-month of edge creation, Parquet format, retained indefinitely unless a future legal or data-protection requirement dictates otherwise.
- A sliding-window archival job runs daily, moving the tail into S3 atomically with a two-phase commit against the hot graph.
- Rehydration from archive is possible but expensive — on the order of minutes to hours, not milliseconds. Support ticket workflows that depend on older-than-18-month reconstruction will need to tolerate this latency; current analysis of support ticket volume suggests this affects under 0.3% of tickets.

## Consequences

**Positive**

- Hot graph size converges to approximately 24 months of steady-state traffic, bounding cost, query latency, and recovery time.
- Storage cost on the identity-graph cluster projected to drop by 35-40% within one quarter.
- p99 identity resolution latency projected to return to early-2025 levels within two months.
- Recovery-time objective becomes achievable again without over-provisioning the cluster purely for cold-start headroom.

**Negative, accepted**

- Edge reconstruction for historical support tickets becomes a heavier operation. We accept this because the alternative — retaining indefinitely — makes the hot path worse for everyone every day.
- Users who were last-active 18+ months ago and then return will look like new users until cold-storage rehydration is triggered. Product implications for re-engagement campaigns to be discussed with Activation separately.

## Alternatives considered

**No TTL, scale horizontally.** Rejected on cost grounds; the identity graph does not shard cleanly by user, and adding nodes to the cluster produces sub-linear gains on query latency.

**12-month TTL.** Considered. Rejected because support-ticket reconstruction windows land at 12-14 months often enough — GDPR access requests especially — that a 12-month cutoff would force frequent rehydrations and degrade the average support ticket resolution time.

**Edge-usage-based TTL (drop cold edges, keep warm ones).** Conceptually attractive but expensive to implement correctly, and has a failure mode where rarely-used but important identifiers (employer-issued email aliases, recovery addresses, alternate device IDs) get dropped even when they remain materially useful for resolution.

## Review

Revisit in Q2 2027, or sooner if support-ticket rehydration volume exceeds 1% of total tickets for two consecutive months.
