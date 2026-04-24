# #sales-eng-sync

_Slack channel — export, 2026-05-20_

---

[14:00] @marcus: hey team, weekly pipeline dump incoming 📈

[14:01] @marcus: **pipeline status:**
• Aqueduct — 80% probability, $120k ARR, expected close May 30. Legal redlines back from them yesterday, pretty clean.
• Lumino — 90% probability, $30k ARR, expected close June 5. Contract sitting with their legal.
• Vertex Analytics — 40% probability, $180k ARR, still in exploratory. Good demo monday.
• three more in early qualifying, not worth the slide yet.

[14:03] @priya: aqueduct is great. the $120k tier means they get the normal enterprise onboarding flow, right? not custom work?

[14:04] @marcus: correct, standard connectors. their team already uses a segment-style integration with their current vendor so the migration path is well-trodden.

[14:06] @priya: 👍

[14:08] @marcus: great, and jess is already scoping the custom segment pipe we agreed to for lumino, right? want to make sure i can tell them "we're building it" with a straight face when i'm on the call thursday

[14:09] @priya: yep, that's on track. jess — where are you on the lumino spec?

[14:11] @jwong: spec is coming end of next week, just finishing the identity graph compaction work this week. i'll ping you when it's up for review.

[14:12] @marcus: 🙏 that's what i needed to hear

[14:13] @priya: marcus can you share the lumino technical reqs doc with me? want to make sure the spec hits everything they asked for

[14:14] @marcus: yep, will dig it out of the drive

[14:15] @marcus: found it — docs.meridian.internal/lumino-tech-reqs-2026-03.pdf
they want segment webhook format basically. we're rebuilding a segment-compatible pipe into our system for them specifically.

[14:17] @priya: got it. jess you've seen this?

[14:18] @jwong: yeah seen the reqs, the spec will cover all of it. webhook schema parity, signed payloads, the whole bit.

[14:19] @marcus: awesome. moving on — vertex. they asked about mobile SDK parity on kotlin, what's the current state there?

[14:20] @priya: kotlin SDK is at feature parity as of last month, just an older api version. we'd bump during onboarding.

[14:22] @marcus: perfect. and on the pricing side, they asked about usage tiers — last question on vertex — our $150k tier goes up to how many MAU?

[14:23] @priya: 5M MAU included, $0.02 per additional MAU. they'd be comfortably inside.

[14:25] @marcus: got it, sending them a followup today. thanks both 🙌

[14:26] @priya: np 👍
