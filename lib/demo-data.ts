import type { DLDocument, Decision, Conflict } from './types'

export const DEMO_DOCUMENTS: DLDocument[] = [
  {
    id: 'm-doc-01',
    name: 'Meridian Labs — Q1 2026 Architecture Review',
    doc_type: 'transcript',
    uploaded_at: '2026-03-15T10:00:00Z',
    status: 'done',
    content: `Meridian Labs — Q1 2026 Architecture Review
Date: 2026-03-15, 10:00–11:05 SGT
Location: Orchard meeting room + Zoom bridge
Attendees: Wei Ming Tan (CTO, chair), Rahul Shah (Ingest lead), Jessica Wong (Identity lead), Sarah Chen (Head of Eng), Priya Menon (PM), Daniel Lim (SRE)
Transcript auto-generated and lightly cleaned.

---

Wei Ming: Okay, we're recording — thanks everyone for making time. Agenda has four things, I want to get through all of them but the big one is the datastore call. Rahul, you want to open with scale?

Rahul: Yeah, um, so — pulling up the dashboard — quick numbers. We ended Q1 at about 1.4 billion events ingested, which is — let me check — about 40% up quarter over quarter. Peak rate is sitting around 22k events per second now, sustained, during US business hours.

Wei Ming: And the projection?

Rahul: Projection for end of Q2 is we're looking at roughly 35k peak, maybe 40 if the two enterprise pilots in onboarding convert. The ceiling on the current Postgres setup — Daniel, what was the number we landed on last week?

Daniel: Uh, for a single-writer config, our napkin ceiling is around 80 to 100k sustained writes per second with the current schema, assuming we keep batch inserts and the write-ahead log tuned. We're well under that.

Rahul: Right. So the point I want to make is, we don't have a fire right now. Which is why I don't want us to panic-switch stores just because the graph is going up and to the right.

Jessica: Can I jump in?

Rahul: Go.

Jessica: So — and I want to be careful here because I don't want this to become a datastore war — but on user_events specifically, the write amplification is already biting us. We're seeing 4x amplification on the ingest path because of how the indexes compound.

Wei Ming: That's the table your squad owns, right?

Jessica: Yeah, Identity owns it, it backs the resolution graph lookups. So the 4x is on that one table. The rest of the schema is fine, honestly.

Rahul: But you're saying fine now, or fine at 40k?

Jessica: Fine now. At 40k I'd be nervous about that one table specifically.

Wei Ming: Okay. I hear that. But I want to separate two things — one is what's the primary datastore strategy for the next 18 months. Two is do we have any specific tables that need special handling. Those are different conversations.

Wei Ming: For one, I want to commit. We've been drifting on this for two quarters and every time someone joins they ask what our DB strategy is and we don't have a clean answer. My read is Postgres 15 on RDS, ap-southeast-1, stays primary. Read replicas for analytics. We know how to operate it, we've had zero unplanned Postgres incidents in the last year, and the 18-month runway on capacity is fine. I'd like to sign that as an ADR this afternoon.

Daniel: I'm in favor, on ops grounds alone. Adding a second production datastore doubles on-call surface.

Rahul: Agreed from Ingest.

Jessica: I'm — yeah, okay, for primary, fine. I'm still going to want a conversation about user_events separately at some point.

Wei Ming: That's fair. The ADR is about primary. If a specific table needs a different store later, that's a separate decision, separately documented. But the default is Postgres. Anyone against?

[silence]

Wei Ming: Okay, done. I'll write it up this afternoon, link it in #eng-announcements. Next item.

Sarah: That's me. Um, so — review burden. I've been tracking this for a couple of sprints. The median PR time-to-merge is creeping up, it was 18 hours end of Q4, it's now 31. And when I dug in, the bottleneck is reviewer availability, not PR quality. We have a de facto policy that basically anything can merge with one approval.

Wei Ming: What's the counterfactual policy?

Sarah: I'd like to make it explicit — two approvals required on every PR before merge, no exceptions. It's what most places our size do. It'll slow things down a bit in the short term but I think it's the right floor.

Rahul: Every PR, including trivial stuff like dependency bumps?

Sarah: Every PR.

Daniel: And urgent fixes? Like if prod is on fire?

Sarah: If prod is on fire we're paging, and you can get a second approval in five minutes. I don't want a hotfix carve-out because carve-outs are how policies decay.

Wei Ming: I like it. Two approvals, every PR. Agreed?

Rahul: Yep.

Jessica: Yeah.

Wei Ming: Done. Sarah, you'll announce?

Sarah: I'll post in #eng-announcements after yours.

Wei Ming: Priya, you had the custom integration item.

Priya: Yeah. Um — so sales are pushing really hard to build one-off integrations for smaller customers. We had three asks this quarter alone. I want us to set a policy because otherwise we're going to spend engineering capacity on $8k-a-year customers.

Wei Ming: What's the number?

Priya: I've been thinking $50k ARR as the threshold. Below that you get standard connectors only, no custom builds. Above that it's a case-by-case conversation with the activation squad.

Rahul: Fifty feels right to me. Below that the LTV doesn't cover the maintenance, let alone the build.

Wei Ming: Agreed. No custom integrations for customers under 50k ARR. Priya, can you land that with sales this week?

Priya: Will do.

Wei Ming: Last item was the Snowflake question from last week. I don't want to make a call today, I want to spike that separately. Can I put that in Rahul's court for Q2?

Rahul: Sure, I'll scope it.

Wei Ming: Okay, wrapping. Actions — ADR for Postgres primary from me today, 2-approval policy announcement from Sarah, 50k policy from Priya to sales this week, Snowflake spike by Rahul for Q2. Thanks all.

[end of meeting]`,
  },
  {
    id: 'm-doc-02',
    name: 'ADR-0042: Postgres as Primary Datastore for Event Data',
    doc_type: 'adr',
    uploaded_at: '2026-03-15T15:00:00Z',
    status: 'done',
    content: `# ADR-0042: Postgres as Primary Datastore for Event Data

Status: Accepted
Date: 2026-03-15
Author: Wei Ming Tan
Deciders: Wei Ming Tan (CTO), Rahul Shah (Ingest), Jessica Wong (Identity), Sarah Chen (Head of Engineering), Daniel Lim (SRE)
Supersedes: n/a

## Context

Meridian Labs' primary workload is high-volume event ingestion from customer SDKs (web, iOS, Android). We ended Q1 2026 at ~1.4B events ingested over the quarter, with sustained peak of ~22k events/second. Projections for end of Q2 put us at 35–40k/s, and 18-month projections sit around 60k/s assuming current ARR growth trajectories hold.

The existing production datastore is Postgres 15 on AWS RDS (region ap-southeast-1, single writer with two read replicas and a cross-region read replica in us-east-1 for DR). This was adopted opportunistically when the platform was scaffolded in 2024, without a formal architectural commitment.

Each successive capacity conversation over the last two quarters has surfaced the same underlying question: do we stay on Postgres, or migrate to a store that is purpose-built for append-heavy event workloads (MongoDB, DynamoDB, Cassandra, ClickHouse)? In the absence of a decision, individual squads have had to re-have this debate every time they size a new table. That is the cost we are paying, and this ADR makes the commitment explicit for the next 18 months.

## Decision

Postgres 15 on AWS RDS is the primary datastore for all event data at Meridian Labs.

Specifics:
- Region: ap-southeast-1 primary, us-east-1 cross-region read replica for DR
- Topology: single writer, two in-region read replicas, quarterly failover drill owned by Platform
- All new services store their operational state in Postgres unless a specific exception is ratified by a subsequent ADR
- The analytics warehouse question (Snowflake, BigQuery, ClickHouse) is explicitly out of scope for this ADR and will be addressed separately by the Ingest squad in Q2

This is the default. Exceptions require a new ADR — not a Slack thread, not a PR description, not a team call.

## Consequences

Positive:
- Operational simplicity — one primary datastore means one set of backup and restore procedures, one on-call playbook, one query language team-wide
- Zero unplanned Postgres incidents in the trailing 12 months; the failure modes are known and the team has deep reps on them
- Team fluency in Postgres is already deep; query performance review is a standard part of PR review
- JSONB gives us flexibility for evolving event payloads without blocking schema work

Negative, accepted:
- Write amplification on heavily-indexed tables (notably user_events in the Identity domain) will grow at scale. We accept this for now and commit to revisiting per-table if sustained amplification exceeds 5x over a 30-day window
- Single-writer ceiling on current schema is ~80–100k writes/sec. This covers the 18-month window with margin
- Adding a second production datastore later will require a new ADR that supersedes or scopes an exception to this one; it is explicitly not a decision any individual engineer or squad can make unilaterally

## Alternatives considered

MongoDB: Rejected. Adds a second production datastore and the full operational surface that comes with it — backup, DR, on-call runbooks, upgrade paths, capacity planning. The throughput advantage on append-only tables is real but does not offset the cost of running two stores at our current scale and SRE headcount. If a specific table ever demands it, that is a future ADR.

DynamoDB: Rejected. Vendor lock-in to AWS is acceptable for RDS because Postgres workloads are portable via standard tooling; DynamoDB's data model would force a rewrite to ever migrate off.

Cassandra: Rejected. Team unfamiliarity, smaller hiring pool in Singapore, and the operational surface are not justified by our current scale.

ClickHouse: Rejected as the primary datastore. Remains open as a candidate for the analytics warehouse question in a future ADR.

## Review

Revisit by 2027-Q3, or sooner if any single table exceeds 5x sustained write amplification over a 30-day window, whichever comes first.`,
  },
  {
    id: 'm-doc-03',
    name: 'ADR-0043: Event Schema Versioning and Deprecation Policy',
    doc_type: 'adr',
    uploaded_at: '2026-04-05T09:00:00Z',
    status: 'done',
    content: `# ADR-0043: Event Schema Versioning and Deprecation Policy

Status: Accepted
Date: 2026-04-05
Author: Rahul Shah
Deciders: Rahul Shah (Ingest), Jessica Wong (Identity), Dennis Tan (Activation), Wei Ming Tan (CTO, signoff)
Supersedes: n/a

## Context

Meridian's customers embed our SDK (JavaScript, Swift, Kotlin) in their production applications. Each SDK version emits events against a schema our backend must accept. When we change the schema — anything from adding an optional field, broadening a type, to deeply breaking — we risk rejecting events from customer SDKs already in the wild. Including, critically, SDKs shipped to end-user devices that are beyond our customers' control to force-upgrade.

We currently do not have an explicit policy governing how event schemas evolve. Individual schema changes have been handled case-by-case: sometimes with advance warning in #eng-announcements, sometimes not; sometimes with a forward-compatible rollout, sometimes with a flag-day cutover. This has worked while we've been small, but with 40+ customers now in production and two enterprise pilots adding strict SLA expectations, the ad-hoc approach is no longer viable.

## Decision

Event schemas follow Semantic Versioning. Breaking changes require a major version bump and a 6-month deprecation window before the previous major is retired.

Specifics:
- Schema versions are named EventVX.Y (e.g. EventV1.2, EventV2.0)
- Patch changes (X.Y.Z) — documentation-only, no code change on producers. Not tracked individually.
- Minor bumps (X.Y) — adding optional fields, broadening a type, adding an enum value. Backward compatible. No deprecation period; previous minor is dropped quietly once no traffic has been observed on it for 30 days.
- Major bumps (X) — removing fields, narrowing types, changing field semantics, renaming. Requires a 6-month deprecation window during which both old and new majors are accepted in parallel. Announcement in #eng-announcements, a customer-facing release note, and SDK release coordination are all mandatory before the window starts.
- At the end of the 6-month window, the previous major version is retired; the ingestion gateway begins rejecting it with a clear error message that names the superseding version.
- SDK releases are pinned to specific major versions; bumping an SDK to a new major is always a customer-visible SDK version upgrade.

## Consequences

Positive:
- Customers can reason about when breaking changes might affect them and plan their upgrades against our calendar rather than ours against theirs.
- Our ingestion gateway has a bounded acceptance window — we are never obligated to support more than two concurrent majors.
- Forces us to think carefully about breaking changes up front, since the 6-month overhead is non-trivial.

Negative, accepted:
- Some breaking changes we might otherwise ship quickly now take 6 months to land completely.
- Running two schema majors in parallel adds complexity to the gateway and the downstream consumers for the duration of each deprecation window.

## Alternatives considered

Rolling updates with ad-hoc deprecation timing: Status quo. Rejected — it has worked by luck and will stop working the first time an enterprise customer treats a breaking change as a contract violation.

Permanent backward compatibility (never break): Rejected. Locks us into historical mistakes forever and inflates the gateway surface area indefinitely.

Shorter deprecation window (3 months): Considered. Rejected after checking against actual customer SDK upgrade cadences — most customers ship SDK updates quarterly at best, some twice a year. 6 months gives them two realistic windows.

## Review

Revisit if we observe customer breakage despite following the policy, or if a breaking change lands that genuinely cannot tolerate the 6-month window.`,
  },
  {
    id: 'm-doc-04',
    name: 'Identity Squad Weekly — 2026-04-02',
    doc_type: 'transcript',
    uploaded_at: '2026-04-02T11:00:00Z',
    status: 'done',
    content: `Meridian Labs — Identity Squad Weekly
Date: 2026-04-02, 11:00–11:40 SGT
Location: Clarke meeting room + Zoom
Attendees: Jessica Wong (lead), Arif Rahman, Mei Lin Chong. Daniel Lim joined at 11:22.
Transcript auto-generated and lightly cleaned.

---

Jessica: Okay, standup. Arif, kick us off.

Arif: Yeah, um — yesterday I finished the edge-dedup rewrite, the PR is up, I think Mei Lin reviewed it. Today I'm on the graph-compaction spike, I want to get the rough numbers before Thursday. No blockers.

Mei Lin: I reviewed it, left two comments, nothing blocking.

Jessica: Good. Mei Lin, you?

Mei Lin: Yesterday I was on the profile-merge bug from the Zendesk ticket — the one where two profiles were colliding on a hashed email. I have a reproducer now, writing the fix today. No blockers but I may need an ops hand for the backfill.

Jessica: Noted, we'll grab Daniel when we're ready. Me — I spent most of yesterday looking at user_events write metrics. Which is — actually, I want to take five minutes of this standup for that. Is that okay?

Arif: Go.

Jessica: So. This is the Grafana dashboard I built last week. Top panel is writes per second on user_events, bottom panel is actual disk I/O on the primary. If you look at the ratio — that's 4.1x right now. The model we used when we sized RDS back in December assumed 1.2x.

Arif: That's on just one table?

Jessica: Just on user_events. The rest of the Identity schema is fine. And — I want to be honest — at current traffic we're not at risk. But if you extrapolate the growth curve, we hit trouble around Q3.

Mei Lin: Is the amp coming from the indexes?

Jessica: Mostly, yeah. We have six indexes on user_events because of the different lookup paths. Every insert is cascading.

Jessica: Didn't we just commit to Postgres primary two weeks ago?

Jessica: Yeah. And the ADR explicitly said per-table exceptions would need a separate conversation, which is what this is. I'm not proposing we do anything yet. I'm proposing we look.

[Daniel joins, 11:22]

Daniel: Sorry I'm late, what'd I miss?

Jessica: I was about to start on the user_events write-amp thing. Short version — we're at 4x amp on one table, extrapolation has us in trouble by Q3, I want to spike whether an append-optimized store buys us enough to be worth the complexity.

Daniel: Like Mongo?

Jessica: Mongo or Dynamo, I want to benchmark both on our actual workload shape before I'd have an opinion.

Daniel: Operationally I'd push back hard on Mongo. We just committed to Postgres primary in ADR-0042, adding a second production store is exactly the kind of thing that doubles my on-call surface —

Jessica: I know, I know. I'm not asking us to do anything. I'm asking if I can spend maybe two days running benchmarks and bringing data back. That's it. If the numbers aren't dramatic, we drop it and look at sharding instead.

Daniel: Benchmarks are fine, knock yourself out. Just — no implementation work off the back of it without a new ADR.

Jessica: Obviously. I'll share results next week and we can decide where it goes from there.

Arif: Do you want help on the benchmark harness?

Jessica: Actually yeah — if you can take the replay tooling for real user_events shapes, that'd cut my time in half.

Arif: Sure. Let's sync after this.

[end of meeting]`,
  },
  {
    id: 'm-doc-05',
    name: '#backend-guild — MongoDB benchmark discussion (2026-04-08)',
    doc_type: 'slack',
    uploaded_at: '2026-04-08T16:00:00Z',
    status: 'done',
    content: `#backend-guild

Slack channel — export, 2026-04-08

---

[15:32] @jwong: hey all — ran the benchmarks I mentioned in identity standup last week. Numbers are in this gist.

tl;dr on the append-only user_events workload: MongoDB does ~3.2x more writes/sec than Postgres on comparably-specced instances, p99 write latency is 1.6x lower. This is on a replay of our actual prod shape, not a synthetic benchmark.

[15:33] @jwong: caveat — this is ONLY user_events. the rest of our schema i didn't touch. and read paths aren't in the comparison at all, this is purely about the write amp problem we've been hitting.

[15:36] @rshah: interesting. what spec on both sides — m5.2xlarge?

[15:37] @jwong: m5.2xlarge for postgres (matches current prod), and the mongo equivalent sized for the same working set. exact configs in the gist so anyone can poke.

[15:38] @rshah: and writes/sec is sustained or peak?

[15:39] @jwong: sustained over a 30-min replay. peak is higher on both but the sustained number is the honest one to compare

[15:40] @rshah: gotcha. i'd want to see this with the identity graph lookups layered on before i'd call it either way — but yeah, interesting data. let's add it to the next arch review agenda, i'll put it on sarah's list.

[15:42] @dlim: dropping in late — this is the kind of "one table needs a different store" conversation that is GUARANTEED to become "now we run two datastores in prod" if we're not careful. just flagging ops cost up front, not arguing the numbers.

[15:43] @jwong: yeah i know dan. not proposing anything yet, just putting data in front of people so we have it when the conversation does happen.

[15:44] @dlim: appreciated

[15:46] @arif: the replay methodology is interesting. is the 1% shadow-diff harness you mentioned in standup something you'd run in prod before any cutover?

[15:47] @jwong: yeah that's the idea — dual-write for a couple weeks, shadow-read compare on a sampled slice, only flip once the diff is clean

[15:49] @dtan: looking at the gist — the p99 latency gap, is that coming from the indexing? curious if it shrinks if you drop two of the six indexes

[15:51] @jwong: @dtan i looked at that. the two droppable ones are the audit indexes and losing them breaks the support-ticket reconstruction path.

[15:54] @rshah: ok adding to the arch review doc. thanks jess for the numbers, this is the kind of thing we should be debating with data not vibes.

[16:14] @dlim: one more thought on the ops side — if we ever did go down this path, i'd want the runbook written BEFORE cutover, not after. learned that lesson once.

[16:17] @jwong: agreed, that'd be the deal. not cutting over anything without ops signoff and a runbook.

[16:22] @rshah: ok, bookmarking this thread. next arch review is may 20th. will bring it up then.`,
  },
  {
    id: 'm-doc-06',
    name: 'PR #847 — Migrate user_events writes from Postgres to MongoDB',
    doc_type: 'pr',
    uploaded_at: '2026-04-16T08:12:00Z',
    status: 'done',
    content: `## Pull Request #847
Title: Migrate user_events writes from Postgres to MongoDB
Author: jwong (Jessica Wong)
Created: 2026-04-16
Merged: 2026-04-20
Labels: identity, migration, size/L
Milestone: Q2 Capacity

## What

This PR migrates writes to the user_events table out of Postgres and onto a dedicated MongoDB collection (identity.user_events), using the dual-write then cutover then cleanup pattern we've used before for smaller migrations.

## Why

Write amplification on user_events has been running at ~4x against our December capacity model for six weeks. The full benchmarks are in the gist discussed in the #backend-guild thread from April 8 — short version, on our actual replay shape MongoDB sustains 3.2x higher throughput on the append path and 1.6x lower p99 write latency on comparably-specced instances.

We're not hitting a wall today, but extrapolation puts us in trouble by Q3, and the cost of migrating one table now is materially lower than migrating under pressure later.

## Scope

- user_events table only. No other table moves.
- Reads continue to hit Postgres until cutover completes.
- The Identity graph's dependency on user_events is replaced with a thin repository interface that both backends satisfy, so the Activation squad's code path is unchanged.

## How (migration plan)

1. Dual-write (this PR) — writes go to both Postgres and MongoDB. Feature flag IDENTITY_USER_EVENTS_DUAL_WRITE=true. Shadow reads compare a sampled 1% for drift detection.
2. Backfill — historical rows backfilled via the existing ETL harness, tracked in ticket IDENT-412.
3. Cutover — once shadow comparison is clean for 7 days, flip reads to MongoDB. Estimated 1–2 weeks out.
4. Cleanup — drop Postgres writes, archive the table, remove the feature flag. Separate PR.

## Testing

- Unit tests on the new repository interface
- Integration tests against a MongoDB test container
- Shadow-read diff harness added
- Load-tested in staging against 2x projected peak

## Rollback

Flag flip. Writes resume to Postgres only, MongoDB collection retained for analysis. Full rollback in under 5 minutes.

## Notes

- No new ADR was filed for this datastore exception — the scope is one table, and the migration pattern and benchmarks were discussed in #backend-guild. Keeping it pragmatic rather than blocking on a formal ADR process.

## Reviews

@arif: "Repository interface is clean. Shadow-diff harness is nice. LGTM."
@dlim: "Ops review — rollback story is solid, I'm signed off on adding the Mongo collection to on-call runbooks as part of the cleanup PR. Approving conditional on that ticket being filed before cutover."`,
  },
  {
    id: 'm-doc-07',
    name: '#backend-guild — Hotfix approval policy (2026-05-12)',
    doc_type: 'slack',
    uploaded_at: '2026-05-12T09:30:00Z',
    status: 'done',
    content: `#backend-guild

Slack channel — export, 2026-05-12

---

[09:15] @dlim: morning all. raising something that's been eating me — hotfix velocity. we shipped #987 (the billing rounding fix) in 6h 20m last friday, and most of that was waiting on a second approver to be awake. the actual change was three lines.

is there an appetite to relax the 2-approval rule for genuine hotfixes? not all PRs — just the "prod is on fire" kind.

[09:18] @rshah: define "genuine hotfix" though, we need guardrails or this is how the policy decays

[09:19] @dlim: fully agreed. thinking: must be tagged P0 or P1 at the issue level, must be small (like <50 LOC), and still needs *someone* to approve — just not two.

[09:21] @rshah: loc limit feels arbitrary, and i can see people gaming it. "P0/P1 tag" i can get behind as the single criterion

[09:22] @dlim: fair, drop the loc thing. just the tag then.

[09:24] @jwong: fwiw we had two hotfix situations on identity last month where the 6h wait was genuinely painful. i'd support this.

[09:26] @sarah: works for me. P0/P1 tagged, 1 approval required instead of 2. non-tagged stuff stays on the existing rule.

[09:28] @dlim: thanks sarah

[09:29] @rshah: ok. do we need to write this up anywhere formal?

[09:30] @sarah: i'll update the eng handbook section when i get a sec. might pair it with the on-call refresh i've been meaning to do.

[09:32] @dlim: no rush on my side, i'll just reference this thread if anyone asks in the meantime

[09:33] @sarah: ok

[10:47] @jwong: oh one more thing — does this apply to dependabot-style auto-PRs? we sometimes tag those P1 if they're a CVE patch

[10:49] @sarah: yeah i think cve-tagged dep bumps should count as hotfixes, good catch

[10:50] @jwong: ok`,
  },
  {
    id: 'm-doc-08',
    name: '#sales-eng-sync — Pipeline update (2026-05-20)',
    doc_type: 'slack',
    uploaded_at: '2026-05-20T14:00:00Z',
    status: 'done',
    content: `#sales-eng-sync

Slack channel — export, 2026-05-20

---

[14:00] @marcus: hey team, weekly pipeline dump incoming

[14:01] @marcus: pipeline status:
- Aqueduct — 80% probability, $120k ARR, expected close May 30. Legal redlines back from them yesterday, pretty clean.
- Lumino — 90% probability, $30k ARR, expected close June 5. Contract sitting with their legal.
- Vertex Analytics — 40% probability, $180k ARR, still in exploratory. Good demo monday.
- three more in early qualifying, not worth the slide yet.

[14:03] @priya: aqueduct is great. the $120k tier means they get the normal enterprise onboarding flow, right? not custom work?

[14:04] @marcus: correct, standard connectors. their team already uses a segment-style integration with their current vendor so the migration path is well-trodden.

[14:08] @marcus: great, and jess is already scoping the custom segment pipe we agreed to for lumino, right? want to make sure i can tell them "we're building it" with a straight face when i'm on the call thursday

[14:09] @priya: yep, that's on track. jess — where are you on the lumino spec?

[14:11] @jwong: spec is coming end of next week, just finishing the identity graph compaction work this week. i'll ping you when it's up for review.

[14:12] @marcus: that's what i needed to hear

[14:13] @priya: marcus can you share the lumino technical reqs doc with me? want to make sure the spec hits everything they asked for

[14:15] @marcus: they want segment webhook format basically. we're rebuilding a segment-compatible pipe into our system for them specifically.

[14:18] @jwong: yeah seen the reqs, the spec will cover all of it. webhook schema parity, signed payloads, the whole bit.

[14:19] @marcus: awesome. moving on — vertex. they asked about mobile SDK parity on kotlin, what's the current state there?

[14:20] @priya: kotlin SDK is at feature parity as of last month, just an older api version. we'd bump during onboarding.

[14:25] @marcus: got it, sending them a followup today. thanks both`,
  },
  {
    id: 'm-doc-09',
    name: 'Meridian Labs — Q2 Planning',
    doc_type: 'transcript',
    uploaded_at: '2026-06-01T10:00:00Z',
    status: 'done',
    content: `Meridian Labs — Q2 Planning
Date: 2026-06-01, 10:00–11:15 SGT
Location: Orchard meeting room + Zoom bridge
Attendees: Priya Menon (PM, chair), Wei Ming Tan (CTO), Rahul Shah, Jessica Wong, Sarah Chen
Transcript auto-generated and lightly cleaned.

---

Priya: Hi everyone, thanks for making time. Before Q2 priorities I want to spend five minutes on the Q1 retro so we're grounded. Then priorities, then anything else.

Wei Ming: Go.

Priya: Q1 revenue target was 1.2M ARR net new. We landed at 1.38M, so 115% of target. NRR is sitting at 118%. Churn is flat. Logo retention is high. Q1 was good.

Wei Ming: Q2.

Priya: I've been talking to each of you separately for two weeks and I think we have convergence on three priorities.

One — identity v2. Jessica owns. Graph compaction plus profile-merge improvements plus the TTL question. This is the biggest bet, probably 40% of engineering capacity.

Two — mobile SDK parity. Two of the four deals in flight are blocked by Kotlin being on an older API version. Arif owns the bump, Rahul's squad supports. Maybe 25% of capacity.

Three — EU expansion prep. We need to stand up EU-region infrastructure, work through data residency, get the GDPR story coherent enough for enterprise buyers. Three deals in late-stage are asking about it. Maybe 25% of capacity, shared across squads.

That leaves 10% for maintenance, support escalations, and the things we don't know about yet.

Wei Ming: Where does the mongo migration work sit in that?

Jessica: Inside identity v2. The cutover from dual-write to mongo-primary lands early Q2, cleanup and runbook work mid-Q2. Factored into the 40%.

Wei Ming: Good. And the Snowflake spike from Q1, did that land?

Rahul: Yeah, wrote it up last week. Short version: ClickHouse beats Snowflake for our cost profile, but neither of them is Q2 work. Recommend we revisit in Q3 planning.

Priya: Parking it. Sarah — anything on the process side?

Sarah: Nothing to add on the priorities. My only update — we hit a milestone on the 2-approval rule enforcement in April, median PR time-to-merge dropped from 31 hours back down to 19. The May hotfix carve-out hasn't materially changed things, fewer than 10% of PRs qualify as P0/P1. So I'd call that working.

Wei Ming: Noted. Priya, on priorities — any objections to the three or to the capacity split?

Rahul: On mobile SDK parity — I want to flag we're tracking to 2x event volume in Q3 per our models. The Kotlin bump is non-negotiable but we also need capacity planning work that isn't on this list.

Wei Ming: Put it in the 10% maintenance bucket for now. We'll pull it into Q3 planning as a tentpole if capacity becomes a fire in Q2.

Priya: Great. Jessica, status check — Lumino spec, where are you?

Jessica: On track. Spec is landing mid-June, probably the 15th.

Wei Ming: On EU prep — have we thought about what this looks like technically? Mirror deployment in eu-west-1, data replication strategy, the whole shape?

Priya: That's where I'd love your squads' input. I have a commercial driver, not a technical plan. I need someone to own the architecture question. Can we spike it in June and land an ADR in July?

Rahul: Makes sense. I'll scope the spike.

Priya: And GDPR specifically — are we thinking processor agreements, are we thinking actual data residency, what's the depth?

Wei Ming: Park it, come back next meeting with the legal view. Don't start scoping anything until that's clear.

Jessica: On identity v2 — I'd like to pre-flag something. The profile-merge improvements have a dependency on the mongo cutover being clean. If we're still triaging dual-write drift in July, the merge work slips. Want that risk on the record now.

Priya: Noted. Jessica, can you publish the full identity v2 milestone plan by end of next week so we can see the dependencies explicitly?

Jessica: Will do.

Sarah: One process item — the quarterly incident review is overdue. We had four P1s in Q1 and I want to run a root-cause session. I'll propose a date in #eng-announcements this week.

Wei Ming: Thanks all.

[end of meeting]`,
  },
  {
    id: 'm-doc-10',
    name: 'Lumino Custom Integration — Technical Specification',
    doc_type: 'memo',
    uploaded_at: '2026-06-15T09:00:00Z',
    status: 'done',
    content: `# Lumino Custom Integration — Technical Specification

Status: Draft — Review
Author: Jessica Wong
Reviewers: Priya Menon, Wei Ming Tan, Dennis Tan (Activation)
Date: 2026-06-15
Target delivery: Q3 2026 (July–September)

---

## Overview

Lumino is a strategic customer onboarding in June 2026 ($30k ARR, contract expected to close 2026-06-05). Unlike our standard onboarding flow where customers adopt our SDK directly, Lumino's existing analytics infrastructure is built around Segment's webhook API contract. Their engineering team has asked us to provide an ingestion path that is Segment-compatible at the wire level, allowing them to repoint their existing track, identify, and group calls at our endpoint without client-side code changes.

This document specifies the design, scope, and rollout plan for that integration. The work is targeted for the Q2 engineering cycle per the agreed custom-integration approach for strategic accounts, with production delivery targeted for mid-Q3.

## Background

Meridian's default ingestion surface is our own SDK family (JavaScript, Swift, Kotlin) which provides schema validation, batching, and automatic identity resolution on the client. This is the path all existing customers use and remains the default for new standard onboardings.

Lumino's case is different. They have an 18-month-old internal data layer built around the Segment spec. Migrating it off would involve a three-quarter rewrite on their side, which their engineering leadership has explicitly declined to fund. The commercial choice presented was:

1. Build a Segment-compatible ingestion endpoint and close the deal.
2. Decline the deal.

We are pursuing option 1. This spec describes the "how."

## Goals

- Accept HTTP requests matching the Segment API v1 shape (/v1/track, /v1/identify, /v1/group, /v1/alias, /v1/page, /v1/screen) at a per-customer endpoint (segment.lumino.meridian.app).
- Translate inbound events into our native EventV1.2 schema with full fidelity for mapped fields.
- Target p99 ingest latency < 150ms end-to-end, matching our native SDK path.
- Ship by 2026-08-15 to meet Lumino's contractual go-live window.

## Non-goals

- Generalising this as a "Segment-compatible mode" for other customers. This is Lumino-specific; if a future customer asks for the same shape, it will be a separate ADR and a generalization effort.
- Backfill of historical Segment-shape data — Lumino will backfill natively via their own ETL.

## Design

The integration adds one new service (Edge translator: services/segment-adapter/) and one Kafka topic (events.segment-adapter.v1). Everything downstream is unchanged.

The adapter:
- Terminates TLS on segment.lumino.meridian.app
- Validates the Segment write key against the source registry (backed by Postgres)
- Parses the Segment payload and rejects unknown event types with HTTP 400
- Translates Segment fields to our EventV1.2 representation
- Enqueues to a dedicated Kafka topic for observability and rate-limit isolation

Signed payload verification: Lumino signs requests using HMAC-SHA256, sent in the X-Meridian-Signature header. The edge translator verifies the signature before enqueuing; invalid signatures fail with 401.

Rate-limit isolation: The dedicated Kafka topic means Lumino's traffic cannot degrade the native ingest path if they spike. Topic-level consumer lag is exposed on the existing Datadog dashboards, and the adapter enforces a 5k events/sec soft ceiling per source.

## Rollout plan

Phase 1 — Internal (2026-07-01 to 2026-07-15): Deploy adapter against a Meridian-internal test source. Exit criterion: 48 hours of clean synthetic traffic at 3x peak.

Phase 2 — Lumino staging (2026-07-16 to 2026-08-07): Lumino points a small percentage of their staging traffic at us. Criteria: 72 consecutive hours of zero unexplained errors, p99 latency under 200ms.

Phase 3 — Lumino production cutover (2026-08-08 to 2026-08-15): Staged cutover — 10% day 1, 50% day 3, 100% day 5. Rollback is DNS-level.

Phase 4 — Steady state (post-2026-08-15): Normal on-call. Dedicated Datadog monitor on the segment-adapter service. Quarterly review of the mapping layer.`,
  },
  {
    id: 'm-doc-11',
    name: 'PR #1023 — [hotfix][P1] JWT validation regression in /auth/refresh',
    doc_type: 'pr',
    uploaded_at: '2026-06-24T13:48:00Z',
    status: 'done',
    content: `## Pull Request #1023
Title: [hotfix][P1] Fix JWT validation regression in /auth/refresh
Author: rshah (Rahul Shah)
Created: 2026-06-24T13:48 SGT
Merged: 2026-06-24T14:15 SGT (27 minutes total)
Labels: hotfix, P1, auth, size/XS
Changed files: 2 | Additions: 18 | Deletions: 4

## What

JWT validation on /auth/refresh is rejecting valid tokens signed before 2026-06-22 because the signing-key rotation landed in main at 18:03 SGT today but the refresh handler still expects the new kid header exclusively. This PR restores the fallback-to-previous-key lookup that was accidentally dropped in #1019.

## Why hotfix

P1 — every customer SDK token issued in the last 48h fails to refresh. Customers are getting logged out of their dashboards. We're seeing a 3x spike in /auth/login traffic as a proxy. Triaged by on-call at 21:40 SGT.

## Scope

- services/auth/handlers/refresh.py — restore the two-kid fallback path
- tests/auth/test_refresh.py — add a regression test for the old-kid case

No other files touched. Revert is a one-line flag flip if this causes any secondary issue.

## Testing

- New regression test passes locally and in CI
- Manual smoke: refreshed a token issued 2026-06-21 against this branch, works
- Staging deploy pending post-merge verification

## Review

Merged with 1 approval per the hotfix policy update (see #backend-guild thread from 2026-05-12). Tagged P1 as per that policy.

@jwong: "Verified the test fails on old main and passes with your change. LGTM, ship it."`,
  },
  {
    id: 'm-doc-12',
    name: 'ADR-0047: Identity Graph Edge TTL',
    doc_type: 'adr',
    uploaded_at: '2026-07-10T10:00:00Z',
    status: 'done',
    content: `# ADR-0047: Identity Graph Edge TTL

Status: Accepted
Date: 2026-07-10
Author: Jessica Wong
Deciders: Jessica Wong (Identity), Arif Rahman (Identity), Dennis Tan (Activation), Wei Ming Tan (CTO, signoff)
Supersedes: n/a

## Context

Meridian's identity resolution graph connects user identifiers across devices and sessions. Each connection is stored as an edge with a source event reference, a connection type (hashed email match, device-ID match, explicit merge), and a timestamp. As the product has scaled, edge count has grown roughly linearly with event volume — we are currently at ~2.1 billion edges across the production graph and projecting ~4 billion by end of Q4 2026.

This growth creates three costs. First, graph-traversal query latency degrades as the average node fan-out grows; p99 identity resolution time is up 28% over the trailing 12 months. Second, storage cost on the identity-graph cluster scales directly with edge count — about $14k/month at current volume and rising. Third, recovery after a cluster failure scales with graph size, and our cold-start time from snapshot is now on the wrong side of our stated recovery-time objective.

## Decision

Identity graph edges older than 18 months are archived and dropped from the hot graph.

Specifics:
- Archival is based on edge creation timestamp, not on last traversal. Edges traversed recently are nonetheless archived if they are older than 18 months at origin.
- Archive destination is cold storage in S3 (s3://meridian-identity-archive/), partitioned by year-month of edge creation, Parquet format, retained indefinitely unless a future legal or data-protection requirement dictates otherwise.
- A sliding-window archival job runs daily, moving the tail into S3 atomically with a two-phase commit against the hot graph.
- Rehydration from archive is possible but expensive — on the order of minutes to hours, not milliseconds. Support ticket workflows that depend on older-than-18-month reconstruction will need to tolerate this latency; current analysis of support ticket volume suggests this affects under 0.3% of tickets.

## Consequences

Positive:
- Hot graph size converges to approximately 24 months of steady-state traffic, bounding cost, query latency, and recovery time.
- Storage cost on the identity-graph cluster projected to drop by 35–40% within one quarter.
- p99 identity resolution latency projected to return to early-2025 levels within two months.
- Recovery-time objective becomes achievable again without over-provisioning the cluster purely for cold-start headroom.

Negative, accepted:
- Edge reconstruction for historical support tickets becomes a heavier operation. We accept this because the alternative — retaining indefinitely — makes the hot path worse for everyone every day.
- Users who were last-active 18+ months ago and then return will look like new users until cold-storage rehydration is triggered. Product implications for re-engagement campaigns to be discussed with Activation separately.

## Alternatives considered

No TTL, scale horizontally: Rejected on cost grounds; the identity graph does not shard cleanly by user, and adding nodes to the cluster produces sub-linear gains on query latency.

12-month TTL: Considered. Rejected because support-ticket reconstruction windows land at 12–14 months often enough — GDPR access requests especially — that a 12-month cutoff would force frequent rehydrations.

Edge-usage-based TTL (drop cold edges, keep warm ones): Conceptually attractive but expensive to implement correctly, and has a failure mode where rarely-used but important identifiers get dropped even when they remain materially useful for resolution.

## Review

Revisit in Q2 2027, or sooner if support-ticket rehydration volume exceeds 1% of total tickets for two consecutive months.`,
  },
  {
    id: 'm-doc-13',
    name: 'Incident Retro: ING-2026-07-15 Event-ingestion Degradation',
    doc_type: 'transcript',
    uploaded_at: '2026-07-20T14:00:00Z',
    status: 'done',
    content: `Meridian Labs — Incident Retro: ING-2026-07-15 Event-ingestion Degradation
Date: 2026-07-20, 14:00–14:55 SGT
Location: Clarke meeting room + Zoom bridge
Attendees: Daniel Lim (facilitator), Wei Ming Tan, Arif Rahman (on-call at time of incident), Rahul Shah
Transcript auto-generated and lightly cleaned.

---

Daniel: Okay, we're recording. Ground rules for the hour — we're blameless, nobody's on trial. Format is timeline first, root cause second, action items last. Arif, you were on-call, want to walk us through?

Arif: Yeah. So — it was 2026-07-15, Tuesday. Short version: we lost somewhere between 30% and 45% of inbound events to the gateway for about 40 minutes, starting 14:22 SGT. No data was lost — the client-side retry path picked everything up on the backend — but customers saw latency on their dashboards, and we got two support tickets filed during the window.

Daniel: What alerted first?

Arif: The Datadog monitor on gateway p99 latency tripped at 14:24, two minutes in. I was heads-down on something else, picked it up at 14:28. First move was to check the Kafka lag dashboard — saw producer-side backpressure, consumer lag was normal.

Daniel: Which told you the problem was upstream of Kafka.

Arif: Right. I started poking at the gateway. Container logs — it took me a minute to realize what I was looking at. The INGEST_GATEWAY_MAX_PAYLOAD_KB env var had been changed, so payloads over 256kb were being rejected at ingress instead of at 1024kb where we normally cap.

Daniel: And that change came from where?

Arif: From a config PR that landed in main at 14:08 and was pushed straight to prod as part of the auto-deploy. The intent was to drop the cap because we were seeing abuse from one source; the change was correct in spirit but 256kb was too aggressive. The author tested it against our test-data fixtures, which are all under 10kb.

Rahul: So the test suite didn't catch it, which is fair because our fixtures don't exercise the large-payload path.

Arif: Right. I reverted the change at 14:58, gateway recovered by 15:02. Total customer-visible impact was 40 minutes.

Daniel: Let's do root cause. The proximate cause is a too-aggressive config value. The interesting question is the process. This change went from PR merge to production with no staging soak at any point.

Wei Ming: Why?

Daniel: Because our auto-deploy fires on merge to main for any service in the platform monorepo, and the config is bundled into the service. It's not broken — it's that we've never made an explicit decision that config changes should go through staging first.

Rahul: That's true for anything, really. We've never made the call.

Daniel: Right. So the deep cause is that our deploy policy is implicit. There's no guardrail for changes that are risky in shapes our CI can't catch — and config changes with production-facing impact are the single most common example.

Wei Ming: Are you proposing a change?

Daniel: Yes. My recommendation is all production deploys go through staging for a minimum 24-hour soak period. Exceptions are explicit — someone has to click through a "bypass staging" button in the deploy UI and note a reason, which logs to the incident log regardless of whether anything actually breaks.

Arif: Would this have caught this incident?

Daniel: Yes. We have enough prod-shaped traffic in staging that a 256kb payload rejection would have been obvious in the first hour of soak.

Wei Ming: I support it. Daniel, write it up as an ADR, I'll sign this week.

Daniel: Will do.

Rahul: On the runbook side — the thing that slowed Arif down was not having a playbook for "gateway is dropping large payloads." We've got runbooks for Kafka lag, for database failover, but our runbook coverage on the gateway specifically is thin.

Arif: Yeah, I was flying blind for the first 15 minutes.

Daniel: Proposal — any P0 or P1 incident ticket must have runbook tags linking to the relevant runbooks. If there aren't any, the on-call writes the runbook as part of the post-incident work, within two weeks.

Arif: That's fair. I'll take the gateway runbook as my retro action.

Wei Ming: Agreed. Daniel, same ADR or separate?

Daniel: Separate — this one is process-level, not deploy-level. I'll file both.

Daniel: Right, wrapping. Decisions — all prod deploys go through staging for minimum 24 hours, ADR incoming from me. P0/P1 incidents require runbook tags, ADR from me. Gateway runbook written by Arif in the next two weeks. Thanks everyone.

[end of meeting]`,
  },
  {
    id: 'm-doc-14',
    name: '#identity-squad — Async standup (2026-08-05)',
    doc_type: 'slack',
    uploaded_at: '2026-08-05T09:30:00Z',
    status: 'done',
    content: `#identity-squad

Slack channel — export, 2026-08-05

---

[09:30] @jwong: morning all — async standup usual format, drop yesterday / today / blockers

[09:32] @arif: yesterday: finished the graph-compaction metrics dashboard, it's live at grafana/d/identity-compaction
today: pairing with dan on the gateway runbook from the july retro
blockers: none

[09:34] @meilin: yesterday: shipped the profile-merge dedup fix for the edge case marcus flagged on the lumino data
today: digging into the activation sync regression from the 0.14.2 release
blockers: need ops to re-run the replay harness against staging, will ping dan

[09:37] @jwong: yesterday: wrote up the weekly graph-TTL burn-in report, first week of archival looks clean
today: reviewing dennis's activation PR (#1187) and finishing the identity v2 milestone slide for eng all-hands tomorrow
blockers: none

[09:38] @arif: nice on the TTL report — any surprises?

[09:39] @jwong: no, numbers are tracking the model within ~2%. ~180M edges archived in week one, hot graph is down to 1.94B

[09:40] @arif: ok

[09:42] @meilin: @jwong — the lumino fix we shipped yesterday, does it need a release note or is it caught by the normal 0.x minor bump?

[09:43] @jwong: normal minor bump per the schema versioning policy, no release note needed — backward compatible

[09:44] @meilin: ok

[09:51] @arif: btw the gateway runbook from the july retro is landing tomorrow, draft is in confluence if anyone wants to take a pass before i mark it done

[09:52] @jwong: will look this afternoon`,
  },
]

export const DEMO_DECISIONS: Decision[] = [
  // PRIMARY DATASTORE — will form 2 conflicts with m-dec-06 (auto-detected via tech keywords)
  {
    id: 'm-dec-01',
    statement: 'Postgres 15 on AWS RDS is the primary datastore for all event data — exceptions require a formal ADR, not a Slack thread or PR description',
    topic_cluster: 'Primary datastore',
    decision_type: 'architectural',
    status: 'contradicted',
    decided_at: '2026-03-15',
    decided_by: ['Wei Ming Tan', 'Rahul Shah', 'Jessica Wong', 'Daniel Lim'],
    source_doc_id: 'm-doc-01',
    source_excerpt: 'The default is Postgres. If a specific table needs a different store later, that\'s a separate decision, separately documented. But the default is Postgres.',
    rationale: 'Operational simplicity, zero Postgres incidents in 12 months, team fluency, 18-month capacity runway',
    confidence: 0.97,
  },
  {
    id: 'm-dec-02',
    statement: 'ADR-0042 formalises Postgres as primary datastore — adding any second production datastore requires a new ADR, not a Slack thread, not a PR description, not a team call',
    topic_cluster: 'Primary datastore',
    decision_type: 'architectural',
    status: 'contradicted',
    decided_at: '2026-03-15',
    decided_by: ['Wei Ming Tan', 'Rahul Shah', 'Jessica Wong', 'Sarah Chen', 'Daniel Lim'],
    source_doc_id: 'm-doc-02',
    source_excerpt: 'This is the default. Exceptions require a new ADR — not a Slack thread, not a PR description, not a team call.',
    rationale: 'Explicit commitment to prevent unilateral per-squad datastore exceptions at scale',
    confidence: 0.99,
  },

  // PR REVIEW POLICY — forms conflict 3 with m-dec-07 (pre-defined, no tech keywords)
  {
    id: 'm-dec-03',
    statement: 'Two approvals required on every PR before merge — no exceptions, including production hotfixes',
    topic_cluster: 'PR review policy',
    decision_type: 'process',
    status: 'reversed',
    decided_at: '2026-03-15',
    decided_by: ['Sarah Chen', 'Wei Ming Tan'],
    source_doc_id: 'm-doc-01',
    source_excerpt: 'I don\'t want a hotfix carve-out because carve-outs are how policies decay.',
    rationale: 'Median PR time-to-merge rising from 18h to 31h; bottleneck is reviewer availability, floor needed',
    confidence: 0.96,
  },

  // CUSTOM INTEGRATION POLICY — forms conflict 4 with m-dec-09 (pre-defined, no tech keywords)
  {
    id: 'm-dec-04',
    statement: 'No custom integrations for customers below $50k ARR — standard connectors only below that threshold',
    topic_cluster: 'Custom integration policy',
    decision_type: 'strategic',
    status: 'contradicted',
    decided_at: '2026-03-15',
    decided_by: ['Wei Ming Tan', 'Priya Menon'],
    source_doc_id: 'm-doc-01',
    source_excerpt: '$50k ARR as the threshold. Below that you get standard connectors only, no custom builds. Below that the LTV doesn\'t cover the maintenance, let alone the build.',
    rationale: 'Custom integrations below $50k ARR have negative LTV when including build and maintenance cost',
    confidence: 0.94,
  },

  // EVENT SCHEMA VERSIONING — no conflicts
  {
    id: 'm-dec-05',
    statement: 'Event schemas follow Semantic Versioning — major version breaks require a 6-month deprecation window before retiring the previous major',
    topic_cluster: 'Event schema versioning',
    decision_type: 'process',
    status: 'active',
    decided_at: '2026-04-05',
    decided_by: ['Rahul Shah', 'Jessica Wong', 'Dennis Tan', 'Wei Ming Tan'],
    source_doc_id: 'm-doc-03',
    source_excerpt: 'Event schemas follow Semantic Versioning. Breaking changes require a major version bump and a 6-month deprecation window before the previous major is retired.',
    rationale: '40+ customers in production, enterprise SLA expectations, SDK upgrades shipped quarterly at best',
    confidence: 0.98,
  },

  // PRIMARY DATASTORE — the violation: migrates Postgres table to MongoDB without a new ADR
  {
    id: 'm-dec-06',
    statement: 'Migrate user_events table writes from Postgres to MongoDB using dual-write then cutover — no formal ADR filed for this datastore exception',
    topic_cluster: 'Primary datastore',
    decision_type: 'architectural',
    status: 'active',
    decided_at: '2026-04-20',
    decided_by: ['Jessica Wong'],
    source_doc_id: 'm-doc-06',
    source_excerpt: 'No new ADR was filed for this datastore exception — the scope is one table, and the migration pattern and benchmarks were discussed in #backend-guild. Keeping it pragmatic rather than blocking on a formal ADR process.',
    rationale: '4x write amplification on user_events, MongoDB 3.2x higher throughput on append path at matching spec',
    confidence: 0.93,
  },

  // PR REVIEW POLICY — the carve-out that Sarah said would cause "policy decay"
  {
    id: 'm-dec-07',
    statement: 'P0/P1-tagged hotfixes can merge with 1 approval instead of 2 — severity tag is the single criterion',
    topic_cluster: 'PR review policy',
    decision_type: 'process',
    status: 'active',
    decided_at: '2026-05-12',
    decided_by: ['Sarah Chen', 'Daniel Lim'],
    source_doc_id: 'm-doc-07',
    source_excerpt: 'works for me. P0/P1 tagged, 1 approval required instead of 2. non-tagged stuff stays on the existing rule.',
    rationale: 'P0/P1 hotfix wait time for second approver causing 6h+ delays; billing rounding fix took 6h 20m for a 3-line change',
    confidence: 0.93,
  },

  // ENGINEERING PRIORITIES — no conflicts
  {
    id: 'm-dec-08',
    statement: 'Q2 engineering priorities: Identity v2 (40% capacity), mobile SDK Kotlin parity (25%), EU expansion infrastructure prep (25%)',
    topic_cluster: 'Engineering priorities',
    decision_type: 'strategic',
    status: 'active',
    decided_at: '2026-06-01',
    decided_by: ['Priya Menon', 'Wei Ming Tan'],
    source_doc_id: 'm-doc-09',
    source_excerpt: 'One — identity v2. Two — mobile SDK parity. Three — EU expansion prep.',
    rationale: 'Q1 115% ARR target, expansion pipeline blocked by Kotlin parity and EU data residency',
    confidence: 0.95,
  },

  // CUSTOM INTEGRATION POLICY — the commercial exception for a $30k ARR customer
  {
    id: 'm-dec-09',
    statement: 'Build Segment-compatible custom ingestion endpoint for Lumino ($30k ARR) — commercial exception to the $50k custom integration threshold',
    topic_cluster: 'Custom integration policy',
    decision_type: 'product',
    status: 'active',
    decided_at: '2026-06-15',
    decided_by: ['Jessica Wong', 'Priya Menon', 'Wei Ming Tan'],
    source_doc_id: 'm-doc-10',
    source_excerpt: 'Lumino is a strategic customer onboarding in June 2026 ($30k ARR). The commercial choice presented was: 1. Build a Segment-compatible ingestion endpoint and close the deal. 2. Decline the deal. We are pursuing option 1.',
    rationale: 'Segment-compatible endpoint allows Lumino to onboard without rewriting 18-month-old data layer; deal closure commercial priority',
    confidence: 0.91,
  },

  // IDENTITY GRAPH MANAGEMENT — no conflicts
  {
    id: 'm-dec-10',
    statement: 'Identity graph edges older than 18 months are archived to S3 cold storage and removed from the hot graph',
    topic_cluster: 'Identity graph management',
    decision_type: 'architectural',
    status: 'active',
    decided_at: '2026-07-10',
    decided_by: ['Jessica Wong', 'Arif Rahman', 'Wei Ming Tan'],
    source_doc_id: 'm-doc-12',
    source_excerpt: 'Identity graph edges older than 18 months are archived and dropped from the hot graph. Archive destination is cold storage in S3, partitioned by year-month of edge creation, Parquet format, retained indefinitely.',
    rationale: '2.1B edges growing to 4B by Q4, $14k/month storage cost rising, p99 identity resolution up 28% in 12 months',
    confidence: 0.98,
  },

  // DEPLOYMENT POLICY — no conflicts
  {
    id: 'm-dec-11',
    statement: 'All production deploys must go through staging for minimum 24-hour soak before production — bypass requires explicit click-through with logged reason',
    topic_cluster: 'Deployment policy',
    decision_type: 'process',
    status: 'active',
    decided_at: '2026-07-20',
    decided_by: ['Daniel Lim', 'Wei Ming Tan'],
    source_doc_id: 'm-doc-13',
    source_excerpt: 'All production deploys go through staging for a minimum 24-hour soak period. Exceptions are explicit — someone has to click through a "bypass staging" button in the deploy UI and note a reason, which logs to the incident log.',
    rationale: 'ING-2026-07-15: config change auto-deployed to prod without staging soak caused 40-min event ingestion degradation',
    confidence: 0.97,
  },

  // INCIDENT RESPONSE — no conflicts
  {
    id: 'm-dec-12',
    statement: 'P0/P1 incident tickets must link to relevant runbooks — on-call writes the runbook within 2 weeks as post-incident action if none exists',
    topic_cluster: 'Incident response process',
    decision_type: 'process',
    status: 'active',
    decided_at: '2026-07-20',
    decided_by: ['Daniel Lim', 'Wei Ming Tan'],
    source_doc_id: 'm-doc-13',
    source_excerpt: 'Any P0 or P1 incident ticket must have runbook tags linking to the relevant runbooks. If there aren\'t any, the on-call writes the runbook as part of the post-incident work, within two weeks.',
    rationale: 'Arif flew blind for 15 minutes during ING-2026-07-15 due to missing gateway runbook',
    confidence: 0.95,
  },
]

export const DEMO_CONFLICTS: Conflict[] = [
  // Conflict 1: Q1 Arch Review Postgres commitment → PR #847 MongoDB migration (no ADR filed)
  {
    id: 'm-conflict-01',
    earlier_decision_id: 'm-dec-01',
    later_decision_id: 'm-dec-06',
    conflict_type: 'silent_change',
    narration: 'The Q1 Architecture Review locked Meridian onto Postgres and stipulated that any exception required a formal ADR. PR #847, merged six weeks later, migrated the user_events table to MongoDB with two solid engineering approvals and a detailed rollback plan — but no superseding ADR was ever filed. The migration proceeded exactly as the meeting had prohibited: as a unilateral squad decision without formal authorisation.',
  },
  // Conflict 2: ADR-0042 explicit prohibition → PR #847 MongoDB migration
  {
    id: 'm-conflict-02',
    earlier_decision_id: 'm-dec-02',
    later_decision_id: 'm-dec-06',
    conflict_type: 'silent_change',
    narration: "ADR-0042's exact words: 'Adding a second production datastore requires a new ADR — not a Slack thread, not a PR description, not a team call.' PR #847's own notes explicitly state 'no new ADR was filed for this datastore exception — keeping it pragmatic.' The violation is acknowledged in the PR body and caught here by the ledger. This is the system catching what the process was designed to prevent.",
  },
  // Conflict 3: "no exceptions, carve-outs are how policies decay" → P0/P1 carve-out via Slack
  {
    id: 'm-conflict-03',
    earlier_decision_id: 'm-dec-03',
    later_decision_id: 'm-dec-07',
    conflict_type: 'reversal',
    narration: "In the Q1 Architecture Review, Sarah Chen proposed two approvals for every PR and explicitly rejected hotfix carve-outs, saying 'carve-outs are how policies decay.' Seven weeks later, that exact carve-out was introduced via a Slack thread — P0/P1-tagged PRs now merge with one approval. PR #1023 (JWT hotfix) cited that Slack thread as its authorisation and merged in 27 minutes before any formal documentation was updated.",
  },
  // Conflict 4: $50k ARR custom integration floor → Lumino at $30k ARR gets full custom endpoint
  {
    id: 'm-conflict-04',
    earlier_decision_id: 'm-dec-04',
    later_decision_id: 'm-dec-09',
    conflict_type: 'silent_change',
    narration: "The Q1 Architecture Review set a $50k ARR floor for custom integrations, with the explicit rationale that 'below that the LTV doesn't cover the maintenance, let alone the build.' Three months later, Lumino — a $30k ARR customer — received a full Segment-compatible custom ingestion endpoint. The Lumino specification frames this as a commercial exception, but no formal revision to the $50k policy was ever filed. The exception became precedent without being acknowledged as a policy change.",
  },
]

// ── LIVE DEMO DOCUMENT ────────────────────────────────────────────────────────
// Paste this into the upload panel during a live demo.
// It extracts a new MongoDB decision → auto-triggers two new conflicts with m-dec-01 and m-dec-02
// (same "Primary datastore" cluster, postgres+mongodb in same TECH_GROUPS entry)

export const LIVE_DEMO_DOCUMENT = `## Pull Request #1124
Title: identity: migrate identity_sessions from Postgres to MongoDB
Author: arif (Arif Rahman)
Created: 2026-09-12
Reviewers: @jwong, @dlim

## Summary

Following the successful user_events migration (PR #847, merged April 2026), this PR migrates
identity_sessions from Postgres to MongoDB using the same dual-write then cutover pattern.

The identity_sessions table has the same write-amplification profile as user_events prior to
migration: 5.8x write amplification against the December capacity model, driven by 8 compound
indexes on the session lookup path.

## Changes

- Dual-write layer for identity_sessions (Postgres + MongoDB)
- Shadow-read harness on 2% sampled slice, same diff tooling as PR #847
- Updated Identity squad on-call runbook for MongoDB session operations
- Repository interface abstracted to support both backends during migration window

## Why MongoDB?

- Reusing migration infrastructure and runbook proven in PR #847
- 5.8x write amplification on identity_sessions documented in IDENT-589
- MongoDB throughput advantage on append-heavy workloads validated in production by user_events result

## Migration pattern

Same as PR #847: dual-write (this PR) → shadow-diff clean for 7 days → cutover → cleanup PR.
Estimated 2 weeks to cutover from merge.

## Notes

Following the same approach as PR #847 — no new ADR filed for this per-table datastore exception,
consistent with the pattern established for Postgres to MongoDB migrations on write-amplified tables.
Rollback: feature flag flip, under 5 minutes.

Reviewers: @jwong, @dlim`

export function seedDemoData() {
  if (typeof window === 'undefined') return
  localStorage.setItem('dl_documents', JSON.stringify(DEMO_DOCUMENTS))
  localStorage.setItem('dl_decisions', JSON.stringify(DEMO_DECISIONS))
  localStorage.setItem('dl_conflicts', JSON.stringify(DEMO_CONFLICTS))
}
