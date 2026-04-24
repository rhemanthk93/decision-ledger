# #identity-squad

_Slack channel — export, 2026-08-05_

---

[09:30] @jwong: morning all — async standup 📋 usual format, drop yesterday / today / blockers

[09:32] @arif: **yesterday:** finished the graph-compaction metrics dashboard, it's live at `grafana/d/identity-compaction`
**today:** pairing with dan on the gateway runbook from the july retro
**blockers:** none

[09:34] @meilin: **yesterday:** shipped the profile-merge dedup fix for the edge case marcus flagged on the lumino data
**today:** digging into the activation sync regression from the 0.14.2 release
**blockers:** need ops to re-run the replay harness against staging, will ping dan

[09:37] @jwong: **yesterday:** wrote up the weekly graph-TTL burn-in report, first week of archival looks clean
**today:** reviewing dennis's activation PR (#1187) and finishing the identity v2 milestone slide for eng all-hands tomorrow
**blockers:** none

[09:38] @arif: nice on the TTL report — any surprises?

[09:39] @jwong: no, numbers are tracking the model within ~2%. ~180M edges archived in week one, hot graph is down to 1.94B

[09:40] @arif: 👍

[09:42] @meilin: @jwong — the lumino fix we shipped yesterday, does it need a release note or is it caught by the normal 0.x minor bump?

[09:43] @jwong: normal minor bump per the schema versioning policy, no release note needed — backward compatible

[09:44] @meilin: 👍

[09:51] @arif: btw the gateway runbook from the july retro is landing tomorrow, draft is in confluence if anyone wants to take a pass before i mark it done

[09:52] @jwong: 👀 will look this afternoon
