# #backend-guild

_Slack channel — export, 2026-04-08_

---

[15:32] @jwong: hey all — ran the benchmarks I mentioned in identity standup last week. Numbers are in this gist → https://gist.github.com/jwong/7a3b2c9f1e4d

tl;dr on the append-only `user_events` workload: MongoDB does ~3.2x more writes/sec than Postgres on comparably-specced instances, p99 write latency is 1.6x lower. This is on a replay of our actual prod shape, not a synthetic benchmark.

[15:33] @jwong: caveat — this is ONLY `user_events`. the rest of our schema i didn't touch. and read paths aren't in the comparison at all, this is purely about the write amp problem we've been hitting.

[15:36] @rshah: interesting. what spec on both sides — m5.2xlarge?

[15:37] @jwong: m5.2xlarge for postgres (matches current prod), and the mongo equivalent sized for the same working set. exact configs in the gist so anyone can poke.

[15:38] @rshah: and writes/sec is sustained or peak?

[15:39] @jwong: sustained over a 30-min replay. peak is higher on both but the sustained number is the honest one to compare

[15:40] @rshah: gotcha. i'd want to see this with the identity graph lookups layered on before i'd call it either way — but yeah, interesting data. let's add it to the next arch review agenda, i'll put it on sarah's list.
[:+1: x2, :chart_with_upwards_trend: x1]

[15:42] @dlim: dropping in late — this is the kind of "one table needs a different store" conversation that is GUARANTEED to become "now we run two datastores in prod" if we're not careful. just flagging ops cost up front, not arguing the numbers.

[15:43] @jwong: yeah i know dan. not proposing anything yet, just putting data in front of people so we have it when the conversation does happen.

[15:44] @dlim: appreciated 🙏

[15:46] @arif: the replay methodology is interesting. is the 1% shadow-diff harness you mentioned in standup something you'd run in prod before any cutover?

[15:47] @jwong: yeah that's the idea — dual-write for a couple weeks, shadow-read compare on a sampled slice, only flip once the diff is clean

[15:49] @dtan: looking at the gist — the p99 latency gap, is that coming from the indexing? curious if it shrinks if you drop two of the six indexes

[15:51] @jwong: @dtan i looked at that. the two droppable ones are the audit indexes and losing them breaks the support-ticket reconstruction path. so not really an option unless we want to give up being able to answer "what did user X do last tuesday" questions from CS.

[15:52] @dtan: ah right, that's the ticket mei lin was on last week. got it.

[15:54] @rshah: ok adding to the arch review doc. thanks jess for the numbers, this is the kind of thing we should be debating with data not vibes.
[:fire: x3, :chart_with_upwards_trend: x1]

[15:56] @jwong: 🙏

[16:14] @dlim: one more thought on the ops side — if we ever did go down this path, i'd want the runbook written BEFORE cutover, not after. learned that lesson once.

[16:17] @jwong: agreed, that'd be the deal. not cutting over anything without ops signoff and a runbook.

[16:22] @rshah: ok, bookmarking this thread. next arch review is — checking the cal — may 20th. will bring it up then.
[:bookmark: x2]
