# Lumino Custom Integration — Technical Specification

**Status:** Draft → Review
**Author:** Jessica Wong
**Reviewers:** Priya Menon, Wei Ming Tan, Dennis Tan (Activation)
**Date:** 2026-06-15
**Target delivery:** Q3 2026 (July–September)
**Related:** Lumino technical requirements (docs.meridian.internal/lumino-tech-reqs-2026-03.pdf), identity v2 capacity plan, event schema registry v1.2

---

## Overview

Lumino is a strategic customer onboarding in June 2026 ($30k ARR, contract expected to close 2026-06-05). Unlike our standard onboarding flow where customers adopt our SDK directly, Lumino's existing analytics infrastructure is built around Segment's webhook API contract. Their engineering team has asked us to provide an ingestion path that is Segment-compatible at the wire level, allowing them to repoint their existing `track`, `identify`, and `group` calls at our endpoint without client-side code changes.

This document specifies the design, scope, and rollout plan for that integration. The work is targeted for the Q2 engineering cycle per the agreed custom-integration approach for strategic accounts, with production delivery targeted for mid-Q3.

## Background

Meridian's default ingestion surface is our own SDK family (JavaScript, Swift, Kotlin) which provides schema validation, batching, and automatic identity resolution on the client. This is the path all existing customers use and remains the default for new standard onboardings.

Lumino's case is different. They have an 18-month-old internal data layer built around the Segment spec. Migrating it off would involve a three-quarter rewrite on their side, which their engineering leadership has explicitly declined to fund. The commercial choice presented was:

1. Build a Segment-compatible ingestion endpoint and close the deal.
2. Decline the deal.

We are pursuing option 1. This spec describes the "how."

The core technical principle: we translate inbound Segment-shape requests into our internal event schema at the edge, and downstream everything — identity resolution, destination routing, profile unification — operates on our native representation. Lumino-specific behaviour is confined to a thin adapter layer.

## Goals

- Accept HTTP requests matching the Segment API v1 shape (`/v1/track`, `/v1/identify`, `/v1/group`, `/v1/alias`, `/v1/page`, `/v1/screen`) at a per-customer endpoint (`segment.{customer-slug}.meridian.app`).
- Translate inbound events into our native `EventV1.2` schema with full fidelity for mapped fields; explicit drop for fields we don't map.
- Preserve Lumino's batching semantics (up to 500 events per request, server-side validation per event, partial-success responses).
- Authenticate using Lumino's existing write-key-per-source model, mapped internally to our workspace/source hierarchy.
- Target p99 ingest latency < 150ms end-to-end, matching our native SDK path.
- Ship by 2026-08-15 to meet Lumino's contractual go-live window.

## Non-goals

- Segment Protocols (schema governance) compatibility — Lumino doesn't use it.
- Segment Destinations API compatibility — Lumino routes destinations internally; we only receive, we don't re-fan-out in their format.
- Support for Segment Functions or Edge Functions — not in Lumino's ask.
- Generalising this as a "Segment-compatible mode" for other customers. This is Lumino-specific; if a future customer asks for the same shape, it will be a separate ADR and a generalization effort.
- Backfill of historical Segment-shape data — Lumino will backfill natively via their own ETL.

## Design

### High-level shape

```
Lumino app  →  HTTPS POST (Segment shape)  →  segment.lumino.meridian.app
                                                       │
                                                       ▼
                                              Edge translator
                                                       │
                                                       ▼
                                            Kafka (events.segment-adapter.v1)
                                                       │
                                                       ▼
                                          Existing ingest → identity → activation
```

The integration adds one new service and one Kafka topic. Everything downstream is unchanged.

### Components

**1. Edge translator (`services/segment-adapter/`)**

A new Go service (consistent with our existing ingest gateway) that:

- Terminates TLS on `segment.{customer-slug}.meridian.app`
- Validates the Segment write key against the source registry (backed by Postgres, same `sources` table our native SDK uses)
- Parses the Segment payload against a strict schema; rejects unknown event types with HTTP 400
- Translates Segment fields to our `EventV1.2` representation (mapping table below)
- Enqueues to a dedicated Kafka topic `events.segment-adapter.v1` for observability and rate-limit isolation

We are explicitly building webhook-based ingestion, not polling. Polling was discussed as an alternative during the requirements phase — Lumino asked if they could expose a paged read endpoint that we'd crawl — but we rejected it on two grounds: the latency characteristics do not meet their real-time activation needs (Lumino wants sub-second propagation to downstream destinations), and the operational burden of managing per-customer polling schedules is materially higher than serving an endpoint.

**2. Schema mapping layer**

The `EventV1.2 ↔ Segment` mapping is deterministic and will be documented in `docs/schema/segment-mapping.md` (to be drafted under this spec). Summary:

| Segment field | Meridian field | Notes |
|---|---|---|
| `userId` | `identity.user_id` | Direct |
| `anonymousId` | `identity.anonymous_id` | Direct |
| `event` | `event.name` | Direct |
| `properties` | `event.properties` | Direct, no transformation |
| `context.traits` | `identity.traits` | Merged into identity resolver |
| `context.ip` | `event.context.ip` | Direct |
| `context.library` | `event.source.library` | Tagged as "segment-compat" |
| `timestamp` | `event.timestamp` | Coerced to UTC |
| `integrations` | *dropped* | Lumino's destination routing lives outside our system for now |

**3. Signed payload verification**

Lumino signs requests using HMAC-SHA256 with a per-source secret, sent in the `X-Meridian-Signature` header. The edge translator verifies the signature before enqueuing; invalid signatures fail with 401. This differs from the Segment spec (which doesn't mandate signing), but Lumino's security team required it and it aligns with our own native SDK auth model.

**4. Rate-limit isolation**

The dedicated Kafka topic means Lumino's traffic cannot degrade the native ingest path if they spike. Topic-level consumer lag is exposed on the existing Datadog dashboards, and the adapter's own HTTP layer enforces a 5k events/sec soft ceiling per source.

### Storage and downstream

Once an event lands on the Kafka topic, the existing consumer chain picks it up unchanged. Identity resolution, profile unification, and activation all operate on the native `EventV1.2` shape, unaware of where it originated. This is the key architectural bet of the design — the adapter is narrow, the rest of the pipeline is oblivious.

### Error handling

- Malformed Segment payload → HTTP 400 with Segment-compatible error body
- Auth failure → HTTP 401
- Backpressure from Kafka → HTTP 503 with `Retry-After: 5`
- Partial batch success → HTTP 200 with per-event result array matching Segment's response shape

## Alternatives considered

**Pure reverse-proxy approach.** Run segment.com-shaped traffic through a literal proxy that translates at the HTTP layer, no internal Kafka topic. Rejected — provides no rate-limit isolation, no observability separation, and no easy rollback path. The Kafka topic buys all three.

**Native SDK-only with Lumino rewrite.** Declined commercially — Lumino's engineering leadership will not fund the rewrite in their current planning cycle.

**Generalised "Segment-compatible mode" for all customers.** Considered and explicitly deferred. Generalising now would spread the cost across one paying customer (Lumino); deferring keeps the surface narrow and gives us real-traffic data before we decide whether a generalisation is worth it.

## Open questions

1. **PII scrubbing.** Do we apply our standard PII redaction (email hashing, IP truncation) at the edge translator, or downstream in the native pipeline? Leaning edge — closer to source, smaller blast radius if something slips. Want Dennis's input.
2. **Rate limits.** Publish per-source rate limits up front (say 5k events/sec), or start unbounded and throttle reactively if Lumino spikes? Leaning published limits; operational safety.
3. **Deprecation path.** If Lumino ever migrates off Segment-compat onto our native SDK (12–18 months out per their roadmap), do we retain the endpoint indefinitely or sunset it? Leaning "retain until explicit sunset ADR."
4. **Multi-region.** Lumino is EU-based. Does the Segment endpoint need to live in eu-west-1 for data residency reasons, or is ap-southeast-1 with an EU-terminated TLS good enough? Ties into the broader EU expansion spike; this spec will follow that ADR rather than pre-empt it.

## Rollout plan

**Phase 1 — Internal (2026-07-01 → 2026-07-15).** Deploy the adapter against a Meridian-internal test source. Emit synthetic traffic matching Lumino's expected shape at 1x and 3x projected peak. Verify end-to-end latency, Kafka consumer lag, and error-handling paths. Exit criterion: 48 hours of clean synthetic traffic at 3x peak.

**Phase 2 — Lumino staging (2026-07-16 → 2026-08-07).** Lumino points a small percentage of their staging traffic at us. Daily sync between Lumino's engineering lead and Jessica/Dennis. Criteria to proceed: 72 consecutive hours of zero unexplained errors, p99 latency under 200ms.

**Phase 3 — Lumino production cutover (2026-08-08 → 2026-08-15).** Staged cutover — 10% of production traffic on day 1, 50% on day 3, 100% on day 5. Rollback is DNS-level: Lumino repoints back to their previous endpoint, ~5 min recovery.

**Phase 4 — Steady state (post-2026-08-15).** Normal on-call. Dedicated Datadog monitor on the `segment-adapter` service. Quarterly review of the mapping layer for any Segment API changes.

## Review and approval

This spec is circulated for review as of 2026-06-15. Target approval by 2026-06-22 to hit the Phase 1 start date.
