# ADR-0042: Postgres as Primary Datastore for Event Data

**Status:** Accepted
**Date:** 2026-03-15
**Author:** Wei Ming Tan
**Deciders:** Wei Ming Tan (CTO), Rahul Shah (Ingest), Jessica Wong (Identity), Sarah Chen (Head of Engineering), Daniel Lim (SRE)
**Supersedes:** n/a

## Context

Meridian Labs' primary workload is high-volume event ingestion from customer SDKs (web, iOS, Android). We ended Q1 2026 at ~1.4B events ingested over the quarter, with sustained peak of ~22k events/second. Projections for end of Q2 put us at 35–40k/s, and 18-month projections sit around 60k/s assuming current ARR growth trajectories hold.

The existing production datastore is Postgres 15 on AWS RDS (region `ap-southeast-1`, single writer with two read replicas and a cross-region read replica in `us-east-1` for DR). This was adopted opportunistically when the platform was scaffolded in 2024, without a formal architectural commitment.

Each successive capacity conversation over the last two quarters has surfaced the same underlying question: do we stay on Postgres, or migrate to a store that is purpose-built for append-heavy event workloads (MongoDB, DynamoDB, Cassandra, ClickHouse)? In the absence of a decision, individual squads have had to re-have this debate every time they size a new table. That is the cost we are paying, and this ADR makes the commitment explicit for the next 18 months.

## Decision

**Postgres 15 on AWS RDS is the primary datastore for all event data at Meridian Labs.**

Specifics:

- Region: `ap-southeast-1` primary, `us-east-1` cross-region read replica for DR
- Topology: single writer, two in-region read replicas, quarterly failover drill owned by Platform
- All new services store their operational state in Postgres unless a specific exception is ratified by a subsequent ADR
- The analytics warehouse question (Snowflake, BigQuery, ClickHouse) is explicitly out of scope for this ADR and will be addressed separately by the Ingest squad in Q2

This is the default. Exceptions require a new ADR — not a Slack thread, not a PR description, not a team call.

## Consequences

**Positive**

- Operational simplicity — one primary datastore means one set of backup and restore procedures, one on-call playbook, one query language team-wide
- Zero unplanned Postgres incidents in the trailing 12 months; the failure modes are known and the team has deep reps on them
- Team fluency in Postgres is already deep; query performance review is a standard part of PR review, not a specialist skill
- `JSONB` gives us flexibility for evolving event payloads without blocking schema work
- Hiring pool in Singapore for Postgres experience is large and proven

**Negative, accepted**

- Write amplification on heavily-indexed tables (notably `user_events` in the Identity domain) will grow at scale. We accept this for now and commit to revisiting per-table if sustained amplification exceeds 5x over a 30-day window
- Single-writer ceiling on current schema is ~80–100k writes/sec. This covers the 18-month window with margin, but does not cover a 3-year horizon without sharding or architectural change
- Adding a second production datastore later will require a new ADR that supersedes or scopes an exception to this one; it is explicitly not a decision any individual engineer or squad can make unilaterally

## Alternatives considered

**MongoDB.** Rejected. Adds a second production datastore and the full operational surface that comes with it — backup, DR, on-call runbooks, upgrade paths, capacity planning. The throughput advantage on append-only tables is real but does not offset the cost of running two stores at our current scale and SRE headcount. If a specific table ever demands it, that is a future ADR.

**DynamoDB.** Rejected. Vendor lock-in to AWS is acceptable for RDS because Postgres workloads are portable via standard tooling; DynamoDB's data model would force a rewrite to ever migrate off. Our current query patterns rely on flexible secondary indexes, which are costly and operationally awkward in DynamoDB.

**Cassandra.** Rejected. Team unfamiliarity, smaller hiring pool in Singapore, and the tombstone-and-compaction operational surface are not justified by our current scale.

**ClickHouse.** Rejected as the primary datastore. Remains open as a candidate for the analytics warehouse question in a future ADR.

## Review

Revisit by 2027-Q3, or sooner if any single table exceeds 5x sustained write amplification over a 30-day window, whichever comes first.
