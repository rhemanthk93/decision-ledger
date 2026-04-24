# #backend-guild

_Slack channel — export, 2026-05-12_

---

[09:15] @dlim: morning all. raising something that's been eating me — hotfix velocity. we shipped #987 (the billing rounding fix) in 6h 20m last friday, and most of that was waiting on a second approver to be awake. the actual change was three lines.

is there an appetite to relax the 2-approval rule for genuine hotfixes? not all PRs — just the "prod is on fire" kind.

[09:18] @rshah: define "genuine hotfix" though, we need guardrails or this is how the policy decays

[09:19] @dlim: fully agreed. thinking: must be tagged P0 or P1 at the issue level, must be small (like <50 LOC), and still needs *someone* to approve — just not two.

[09:21] @rshah: loc limit feels arbitrary, and i can see people gaming it. "P0/P1 tag" i can get behind as the single criterion

[09:22] @dlim: fair, drop the loc thing. just the tag then.

[09:24] @jwong: fwiw we had two hotfix situations on identity last month where the 6h wait was genuinely painful. i'd support this.

[09:26] @sarah: works for me. P0/P1 tagged, 1 approval required instead of 2. non-tagged stuff stays on the existing rule.
[:+1: x3, :pray: x1]

[09:28] @dlim: 🙌 thanks sarah

[09:29] @rshah: ok. do we need to write this up anywhere formal?

[09:30] @sarah: i'll update the eng handbook section when i get a sec. might pair it with the on-call refresh i've been meaning to do.

[09:32] @dlim: no rush on my side, i'll just reference this thread if anyone asks in the meantime

[09:33] @sarah: 👍

[10:47] @jwong: oh one more thing — does this apply to dependabot-style auto-PRs? we sometimes tag those P1 if they're a CVE patch

[10:49] @sarah: yeah i think cve-tagged dep bumps should count as hotfixes, good catch

[10:50] @jwong: 👍
