# ADR-0043: Event Schema Versioning and Deprecation Policy

**Status:** Accepted
**Date:** 2026-04-05
**Author:** Rahul Shah
**Deciders:** Rahul Shah (Ingest), Jessica Wong (Identity), Dennis Tan (Activation), Wei Ming Tan (CTO, signoff)
**Supersedes:** n/a

## Context

Meridian's customers embed our SDK (JavaScript, Swift, Kotlin) in their production applications. Each SDK version emits events against a schema our backend must accept. When we change the schema — anything from adding an optional field, broadening a type, to deeply breaking — we risk rejecting events from customer SDKs already in the wild. Including, critically, SDKs shipped to end-user devices that are beyond our customers' control to force-upgrade.

We currently do not have an explicit policy governing how event schemas evolve. Individual schema changes have been handled case-by-case: sometimes with advance warning in #eng-announcements, sometimes not; sometimes with a forward-compatible rollout, sometimes with a flag-day cutover. This has worked while we've been small, but with 40+ customers now in production and two enterprise pilots adding strict SLA expectations, the ad-hoc approach is no longer viable.

## Decision

**Event schemas follow Semantic Versioning. Breaking changes require a major version bump and a 6-month deprecation window before the previous major is retired.**

Specifics:

- Schema versions are named `EventVX.Y` (e.g. `EventV1.2`, `EventV2.0`).
- **Patch changes (X.Y.Z)** — documentation-only, no code change on producers. Not tracked individually.
- **Minor bumps (X.Y)** — adding optional fields, broadening a type, adding an enum value. Backward compatible. No deprecation period; previous minor is dropped quietly once no traffic has been observed on it for 30 days.
- **Major bumps (X)** — removing fields, narrowing types, changing field semantics, renaming. Requires a 6-month deprecation window during which both old and new majors are accepted in parallel. Announcement in `#eng-announcements`, a customer-facing release note, and SDK release coordination are all mandatory before the window starts.
- At the end of the 6-month window, the previous major version is retired; the ingestion gateway begins rejecting it with a clear error message that names the superseding version.
- SDK releases are pinned to specific major versions; bumping an SDK to a new major is always a customer-visible SDK version upgrade.

## Consequences

**Positive**

- Customers can reason about when breaking changes might affect them and plan their upgrades against our calendar rather than ours against theirs.
- Our ingestion gateway has a bounded acceptance window — we are never obligated to support more than two concurrent majors.
- Forces us to think carefully about breaking changes up front, since the 6-month overhead is non-trivial.

**Negative, accepted**

- Some breaking changes we might otherwise ship quickly now take 6 months to land completely.
- Running two schema majors in parallel adds complexity to the gateway and the downstream consumers for the duration of each deprecation window.

## Alternatives considered

**Rolling updates with ad-hoc deprecation timing.** Status quo. Rejected — it has worked by luck and will stop working the first time an enterprise customer treats a breaking change as a contract violation.

**Permanent backward compatibility (never break).** Rejected. Locks us into historical mistakes forever and inflates the gateway surface area indefinitely.

**Shorter deprecation window (3 months).** Considered. Rejected after checking against actual customer SDK upgrade cadences — most customers ship SDK updates quarterly at best, some twice a year. 6 months gives them two realistic windows to catch a change before it becomes breaking for them.

## Review

Revisit if we observe customer breakage despite following the policy, or if a breaking change lands that genuinely cannot tolerate the 6-month window. Neither is expected.
