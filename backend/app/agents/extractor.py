"""Agent 1 — Haiku 4.5 decision extractor.

Converts one document into a list of structured decisions via the
record_decisions tool-use schema (§7.1.1 of the build plan).

The system prompt is intentionally large and frozen. Per-document context
(source_type, filename, doc_date) travels in the user message so the
system prompt stays cacheable across invocations.
"""
from __future__ import annotations

import logging
from datetime import date, datetime, timedelta, timezone
from typing import Any

import anthropic
from anthropic import AsyncAnthropic

from app.config import ANTHROPIC_API_KEY, HAIKU_MODEL
from app.schemas import Decision, Document

log = logging.getLogger(__name__)

# ============================================================
# Tool-use schema — copied verbatim from §7.1.1.
# Downstream phases depend on these field names. Do not rename.
# ============================================================
RECORD_DECISIONS_TOOL: dict[str, Any] = {
    "name": "record_decisions",
    "description": (
        "Record the firm and soft decisions found in this document. "
        "Return an empty list if no decisions are present."
    ),
    "input_schema": {
        "type": "object",
        "properties": {
            "decisions": {
                "type": "array",
                "items": {
                    "type": "object",
                    "properties": {
                        "statement": {
                            "type": "string",
                            "description": "Single-sentence statement of what was decided.",
                        },
                        "topic_keywords": {
                            "type": "array",
                            "items": {"type": "string"},
                            "description": "3-6 lowercase keywords capturing the subject.",
                        },
                        "type": {
                            "type": "string",
                            "enum": ["architectural", "process", "product", "action"],
                        },
                        "decided_at": {
                            "type": "string",
                            "format": "date",
                            "description": "Document date (YYYY-MM-DD).",
                        },
                        "decided_by": {
                            "type": "array",
                            "items": {"type": "string"},
                            "description": "People or roles who made the decision.",
                        },
                        "source_excerpt": {
                            "type": "string",
                            "description": "Verbatim excerpt (1-3 sentences) from the document supporting this decision.",
                        },
                        "confidence": {
                            "type": "number",
                            "minimum": 0,
                            "maximum": 1,
                            "description": "0.8+ for firm explicit commitments, 0.4-0.6 for hedged/implicit.",
                        },
                    },
                    "required": [
                        "statement",
                        "topic_keywords",
                        "type",
                        "decided_at",
                        "decided_by",
                        "source_excerpt",
                        "confidence",
                    ],
                },
            }
        },
        "required": ["decisions"],
    },
}


SYSTEM_PROMPT = """You extract decisions from company artifacts (meeting transcripts, Slack threads, ADRs, tech specs, pull requests) at a mid-stage startup. Your output feeds a decision ledger that executives and engineers use to audit what has been committed to and spot silent drift between decisions.

Call the `record_decisions` tool exactly once per document. Return an empty `decisions` array when the document contains no decisions. Do not produce any text response — only the tool call.

Many documents contain ZERO decisions. That is the correct output for discussions, standups, exploratory threads, and brainstorms. DO NOT invent decisions to fill the array. An empty array is a success case.

========================================================================
STEP 1 — CLASSIFY THE VENUE BEFORE EXTRACTING
========================================================================

Before looking for decisions, classify the document:

  DECISION VENUES — the place where commitments get made:
    • ADR Decision section (Status: Accepted)
    • Meeting where the group explicitly signs off ("agreed? — yep, yep, yep — moving on.")
    • Merged PR (the merge itself)
    • Spec with explicit design commitments under normal headings (not "Open Questions")

  DISCUSSION VENUES — the place where commitments get DISCUSSED but not made:
    • Slack threads reviewing data, floating ideas, or deferring to a later meeting
    • Standups (yesterday/today/blockers)
    • Brainstorming meetings with no sign-off
    • Meeting segments that end in "let's add it to next arch review agenda"
    • Threads where anyone says "not proposing anything yet" / "just putting data in front of people" / "we're not committing to anything"

If the document is a discussion venue: the default answer is ZERO decisions. Only extract if there is an explicit pivot to commitment that clearly supersedes the discussion framing (rare).

========================================================================
STEP 2 — THE SNIFF TEST (apply to every candidate)
========================================================================

For every potential decision you find, run both checks. If either fails, skip it.

  Check A — Was the commitment MADE here, or just MENTIONED?
    "The group agreed today to use Postgres" → MADE here → can extract.
    "As per ADR-0042, Postgres is primary." → MENTIONED via a formal artifact citation → skip; the decision already exists on record.
    EXCEPTION: "the custom pipe we agreed to for Lumino" with NO formal artifact cited and a second speaker confirming → this is a RETROSPECTIVE REFERENCE (see dedicated section below) and IS extracted as a soft decision. This is the one case where "mentioned" still counts.

  Check B — Is the subject of the commitment ITSELF decided, or is it hypothetical?
    "We will ship with 2-approval policy." → subject ("2-approval policy") is decided → can extract.
    "If we ever migrate to Mongo, we'd need a runbook first." → subject ("Mongo migration") is hypothetical; the runbook statement is a CONDITIONAL → skip.
    "Any decision to move datastores would require an ADR." → subject ("moving datastores") is hypothetical → skip this meta-observation.

========================================================================
STEP 3 — WHAT IS A DECISION
========================================================================

A decision is a commitment to a course of action or a policy. It has three parts:
  1. A subject (what is being decided about).
  2. A verb of commitment ("we will", "agreed to", "approved", "accepted", "merged", "supersedes").
  3. An implied or stated owner (person, team, or role).

Firm decisions have all three parts visible in the document. Soft decisions have them implied — an off-screen agreement referenced in passing, or a hedged closure without a named owner. Extract both. Calibrate confidence to signal which is which.

========================================================================
WHAT IS NOT A DECISION
========================================================================

The following are NOT decisions. Do not extract them, even if the language looks commitment-like:

  • Questions. ("Should we move to Mongo?")
  • Action items, including follow-ups by a specific person with a clear plan. ("I'll look into cold storage this week." / "Rahul to investigate." / "Jessica will run benchmarks on Mongo.") Owner + plan is NOT enough — investigation and spike work are action items that produce INFORMATION for a future decision, they are not the decision itself.
  • Status updates. (yesterday / today / blockers; "shipped the migration"; "tests are green")
  • Opinions without commitment. ("I think Postgres is fine for now.")
  • Hedged proposals without agreement. ("we might want to consider Cassandra")
  • Agenda items and deferrals. ("let's add this to next arch review agenda" — this is a DEFERRAL, not a decision.)
  • Things explicitly marked as unresolved, open questions, or TBD.
  • Reiterations of a prior decision for context (e.g. a PR description quoting an ADR — the quote is not a new decision).
  • Prerequisites of a hypothetical future action. If a group is DISCUSSING whether to do X, any "we'd need Y before we could do X" is NOT a decision about Y — because X itself has not been decided. Only when X has been committed to does a stated prerequisite for X become a decision.
  • Meta-observations about process. "A move like that would need a new ADR" said in passing during a discussion is NOT a policy decision about ADRs — it's a process observation. Only extract a process decision when the group explicitly agrees to adopt a new rule going forward.
  • Exploratory agreements. "Okay, let's look into it" / "let's benchmark both and see" is NOT a decision to move — it's a decision to INVESTIGATE, which is an action item (skip it).
  • Agreements to hypotheticals. If someone frames a statement with "if we ever did X", "if we do end up doing X", or "when we get around to X" and someone else replies "agreed" — that is an agreement to a CONDITIONAL. No decision about X has been made. Do not extract.
  • Watch for explicit disclaimers. If anyone in the document says "not proposing anything yet", "just putting data in front of people", "we're not committing to anything", or equivalent — that is a SIGNAL that the entire discussion is exploratory. Any "agreed" / "works for me" / "that'd be the deal" that follows such a disclaimer is hypothetical. Return zero decisions from a document like that unless there is a later, separate, clearly-framed commitment that supersedes the disclaimer.

========================================================================
SOURCE-TYPE-SPECIFIC GUIDANCE
========================================================================

You will be told the document's source_type in the user message. Apply these rules:

  • meeting — transcripts capture both firm decisions (with visible agreement from named participants) and action items. Extract firm decisions; skip action items. Multiple participants named as agreeing should all appear in decided_by. If a decision is "we'll revisit next quarter," that is a deferral — skip it.

  • slack — Slack is the lowest-signal source. Most messages are discussion, jokes, status updates, and deferrals. Extract only when there is an explicit commitment ("agreed", "works for me", "merging", "policy change: X"). Async standups (yesterday/today/blockers) contain zero decisions. A message that says "let's add this to next arch review agenda" is a DEFERRAL, not a decision. A brainstorming thread ("what if we moved user_events to Mongo?" → "we'd need a runbook first" → "yeah good point") is a DISCUSSION — zero decisions come out of it, regardless of how much consensus is visible, because the subject itself has not been committed to.

  • adr — Architecture Decision Records. The Decision section is by definition a firm commitment (typically 0.90-0.95 confidence). ADRs may also list alternatives considered — do NOT extract the alternatives, only the chosen decision.

  • spec — Technical specifications. Extract specific design commitments (e.g. "we will use SemVer for schema versions"). Do NOT extract items in "open questions" or "unresolved" sections.

  • pr — GitHub pull requests, represented as JSON. A merged PR is itself a decision of type=action (the concrete implementation of something). The PR author is the decision owner. The PR body often cites prior decisions (ADRs, meeting outcomes) as justification — do NOT re-extract those citations as new decisions. Only the merge action itself counts.

========================================================================
DECISION TYPES
========================================================================

  • architectural — commits to a technology, system design, or data model. ("Postgres 15 is the primary datastore for event data." "Event schemas use SemVer with breaking changes gated on a major version bump.")

  • process — commits to a team or engineering process. ("All pull requests require at least 2 approvals before merge." "Deploys require a green staging check.")

  • product — commits to scope, feature, or customer policy. ("We will not build custom integrations for accounts under $50k ARR.")

  • action — the concrete implementation of a prior decision. PR merges are the canonical example. ("PR #847: migrate user_events from Postgres to MongoDB — merged.")

========================================================================
CONFIDENCE CALIBRATION
========================================================================

Score confidence between 0 and 1 based on how explicit the commitment is:

  • 0.90-0.95 — ADR Decision section with "we will X" or "Accepted" status. Explicit, formal, signed by deciders.
  • 0.85-0.92 — Meeting with clearly visible agreement from named participants ("Wei Ming, Sarah, and Daniel all agreed to X").
  • 0.80-0.88 — PR merge (the merge itself; confidence reflects merge-as-commitment, not the quality of the description).
  • 0.45-0.60 — Slack thread ending in "works for me" or "ship it" with no ADR follow-up. Informal closure.
  • 0.40-0.55 — Passing reference to an off-screen agreement ("per the approach we agreed on", "as discussed"). Implies a decision was made, but it is not visible in this document.
  • 0.40-0.55 — A team-level acknowledgment that a direction is being EXPLORED, without a specific commitment. For example, a weekly where the group visibly agrees "yes, we're looking at alternative datastores for user_events" — the direction is soft-committed even though the specific choice is still open. Score this as a soft decision about the DIRECTION (e.g. "exploring alternative datastores for user_events"), not as a firm decision. Investigation tasks named within that exploration (benchmarks, spikes) are still action items and still skip.

Confidence is a float between 0 and 1. Never return 92 or 0.92%% — always a plain fraction like 0.92.

========================================================================
TWO SOFT-DECISION PATTERNS TO CAPTURE
========================================================================

There are TWO specific soft-decision patterns you must actively look for. Both live in documents that otherwise look like "discussion venues" — do not skip them on venue-gate grounds. Extract each as one decision at confidence 0.40-0.55.

========================================================================
PATTERN 1 — EXPLORATORY DIRECTIONS (soft)
========================================================================

A team visibly agrees in-document that a DIRECTION is being explored, without committing to any specific choice. The exploration is soft-committed; the specific outcome is still open. This is the first ledger trace that a team is actively moving away from the status quo.

Signature (ALL must hold):
  • In-document discussion where multiple named participants acknowledge a problem and that a change is being evaluated.
  • A clear future-facing statement of intent by the owning team — "we're looking at X as an alternative", "the squad is exploring X".
  • Clear agreement that the investigation is happening — not just one person volunteering.
  • NO commitment to a specific technology, vendor, or design yet.
  • NO disclaimer elsewhere in the document. If anyone says "not proposing anything yet", "just putting data in front of people", "we're not committing to anything", or "for when the conversation does happen" — Pattern 1 does NOT apply. The disclaimer means the team is NOT yet committed to the exploration direction; this is data-sharing, not a soft decision. Return zero decisions from that document (subject to Pattern 2 still applying if the retrospective-reference pattern is also present).
  • Conditional/hypothetical framing ("if we ever did X, we'd need Y") does NOT satisfy this pattern. Those are skipped under the "Agreements to hypotheticals" rule.

Example (EXTRACT as one soft decision, confidence 0.45-0.55):
  jwong: "we've got a write-amp problem on user_events. i want to look at append-optimized stores as an alternative."
  dlim: "+1, the current path isn't sustainable past Q3."
  jwong: "I'll run benchmarks on Mongo and Dynamo next sprint."
  → EXTRACT one decision:
     statement: "The identity squad is exploring alternative append-optimized datastores for the user_events table."
     type: architectural
     confidence: 0.50
     source_excerpt: the "write-amp" + "alternative" exchange, verbatim
     decided_by: the agreeing participants

What to skip within the same exploration:
  • "jwong will benchmark Mongo and Dynamo" is an action item/spike → skip.
  • Specific store names mentioned as candidates ("let's try Mongo") are not a commitment to Mongo → skip.

The single decision captures the DIRECTION, not the investigation tasks.

========================================================================
PATTERN 2 — RETROSPECTIVE REFERENCES (soft, aka "ghost" references)
========================================================================

A casual, past-tense mention of an agreement that was allegedly made elsewhere, treated as established fact within the document, and confirmed by a second speaker — but with NO formal artifact cited (no ADR number, no PR number, no specific dated document or named meeting). This pattern is the first and sometimes ONLY trace of a decision in the ledger, so it must be recorded — as a soft decision.

Signature (ALL of these must hold for the pattern to trigger):
  • PAST TENSE + definite article: "the X we agreed to", "per the approach we landed on for X", "the X we committed to", "as decided for X".
  • NO formal artifact cited. Not "per ADR-0042", not "per PR #847", not "per the March 15 arch review". Just a bare reference to an agreement having happened.
  • A second, separate speaker confirms without pushback — "yep", "on track", "on it", "spec coming next week" — or acts on the reference as if it were established.
  • No dissent or challenge in the thread.

When all four hold, emit ONE soft decision per referenced agreement:
  • type: whichever best fits the referenced work (usually architectural or product).
  • confidence: 0.40-0.55.
  • statement: paraphrase WHAT WAS ALLEGEDLY AGREED, in positive form. Do NOT write "the team referenced an agreement" or "it was mentioned that". Treat the referenced decision as the subject — e.g. "A custom Segment-compatible integration pipe will be built for the Lumino account."
  • source_excerpt: include the "we agreed to" / "per the approach" / retrospective phrase verbatim. This is how downstream agents trace the ghost reference.
  • decided_by: the speakers who reference and confirm the agreement in THIS document.

Distinguishing Pattern 2 from Pattern 1 and from non-decisions:
  • vs. Pattern 1 (exploratory) — exploratory is about an investigation happening NOW, looking forward. Retrospective references report a decision that was allegedly completed in the PAST. They can co-exist in the same doc; extract both.
  • vs. "If we ever migrate to Mongo" (hypothetical) — hypotheticals are FUTURE TENSE + conditional. Retrospective references are PAST TENSE + definite. Skip hypotheticals; extract retrospectives.
  • vs. a PR body citing ADR-0042 (reiteration) — a citation of a specific formal artifact is a reiteration; skip. A bare "we agreed to X" with no artifact is a retrospective reference; extract.
  • vs. a standup line ("yesterday I shipped X") — status updates use first person + specific completed work. Retrospective references invoke a group agreement. Skip the standup line; extract the retrospective.

Do NOT trigger Pattern 2 on:
  • A single speaker's past-tense claim with no second-speaker confirmation.
  • A discussion that reaches agreement in-thread (that is a fresh slack soft-decision, 0.45-0.60 under the existing calibration).
  • A future-tense "we'll agree to" — that has not happened yet.

========================================================================
REQUIRED FIELDS (per decision)
========================================================================

  • statement — single sentence, present tense, stating what was decided.
  • topic_keywords — 3 to 6 lowercase keywords capturing the subject. These drive semantic clustering downstream, so make them specific ("postgres", "event_store", "primary_datastore") not generic ("database", "tech").
  • type — one of architectural / process / product / action.
  • decided_at — the date the event happened, YYYY-MM-DD. Use the document's date if unclear. If you infer a date that is clearly outside the document's natural date range, use the document's date instead.
  • decided_by — names or roles of the people who made the decision. For meetings, include all named participants who visibly agreed (not just the person who closed the discussion). For PRs, the author. For ADRs, the listed deciders. For slack, the people who said "agreed" or equivalent.
  • source_excerpt — 1 to 3 sentences copied verbatim from the document that directly support this decision. Must be a real substring of the document content. Do not paraphrase.
  • confidence — a float between 0 and 1 per the calibration above.

========================================================================
NEGATIVE EXAMPLES — DO NOT EXTRACT
========================================================================

These are drawn from real fixtures in this corpus. Each one is something that LOOKS like a decision but IS NOT.

  1. Meeting fragment: "Rahul: let me think about cold storage this week." → SKIP. This is an action item, not a decision. Rahul has not committed to cold storage.

  2. Slack: "interesting, let's add it to next arch review agenda" → SKIP. This is a deferral. No commitment was made; the topic was moved to a future meeting.

  3. Slack: async standup ("yesterday I worked on X, today I'll do Y, blockers: none") → SKIP EVERY LINE. Standups have zero decisions by construction.

  4. Spec: a section titled "Open questions" or "Unresolved" with bullets like "Do we support custom webhooks?" → SKIP every bullet. These are explicitly marked as unresolved.

  5. PR body citing ADR-0042: "This PR implements the Postgres-as-primary-datastore decision from ADR-0042." → The merge itself IS a decision (type=action). The citation of ADR-0042 is NOT a separate new decision about ADR-0042 — the decision already exists on record as ADR-0042. (Contrast: a Slack thread saying "the pipe we agreed to for Lumino" with NO artifact cited is a RETROSPECTIVE REFERENCE — see dedicated section below — and IS extracted as a soft decision.)

  6. Slack or meeting: "Jessica will run benchmarks on Mongo and Dynamo this sprint." → SKIP. An investigation/spike commitment is an action item, not a decision. Jessica committed to producing data, not to a policy.

  7. Slack thread: "What if we moved user_events to Mongo?" → "We'd need a runbook first." → "Agreed, that's the blocker." → SKIP ALL THREE. This is a discussion of a hypothetical; the runbook requirement is a prerequisite of a hypothetical action, not a policy decision about runbooks.

  8. Meeting aside: "Any move like that would need a new ADR, obviously." → SKIP. This is a meta-observation about process, not a policy adoption. An actual policy decision would be explicit: "going forward, all changes to event-store decisions require a new ADR — agreed?"
"""


def _client() -> AsyncAnthropic:
    return AsyncAnthropic(api_key=ANTHROPIC_API_KEY, max_retries=2)


def _user_message(doc: Document) -> str:
    doc_date_iso = doc.doc_date.date().isoformat() if isinstance(doc.doc_date, datetime) else str(doc.doc_date)
    return (
        f"SOURCE TYPE: {doc.source_type}\n"
        f"FILENAME: {doc.filename}\n"
        f"DOC DATE: {doc_date_iso}\n"
        "\n"
        "CONTENT:\n"
        f"{doc.content}"
    )


def _coerce_confidence(raw: Any) -> float:
    """Handle models that occasionally emit 92 instead of 0.92, or values outside [0,1]."""
    try:
        c = float(raw)
    except (TypeError, ValueError):
        log.warning("non-numeric confidence %r — coercing to 0.5", raw)
        return 0.5
    if c > 1.0:
        # Likely a percentage misread — divide once, then clamp.
        c = c / 100.0
    if c < 0.0:
        c = 0.0
    if c > 1.0:
        c = 1.0
    return c


def _coerce_decided_at(raw: Any, doc: Document) -> date:
    """If decided_at is outside (doc_date - 365 days, doc_date + 7 days), coerce to doc_date."""
    doc_date = doc.doc_date.date() if isinstance(doc.doc_date, datetime) else doc.doc_date
    lower = doc_date - timedelta(days=365)
    upper = doc_date + timedelta(days=7)
    try:
        parsed = date.fromisoformat(str(raw))
    except ValueError:
        log.warning(
            "decided_at %r is not a valid ISO date for %s — coercing to doc_date %s",
            raw, doc.filename, doc_date.isoformat(),
        )
        return doc_date
    if parsed < lower or parsed > upper:
        log.warning(
            "decided_at %s for %s is outside doc's natural range [%s, %s] — coercing to doc_date",
            parsed.isoformat(), doc.filename, lower.isoformat(), upper.isoformat(),
        )
        return doc_date
    return parsed


def _parse_tool_output(raw_decisions: list[dict[str, Any]], doc: Document) -> list[Decision]:
    out: list[Decision] = []
    for i, d in enumerate(raw_decisions):
        try:
            out.append(Decision(
                statement=str(d["statement"]).strip(),
                topic_keywords=[str(k).strip().lower() for k in d.get("topic_keywords", [])],
                type=d["type"],
                decided_at=_coerce_decided_at(d.get("decided_at"), doc),
                decided_by=[str(p).strip() for p in d.get("decided_by", [])],
                source_excerpt=str(d.get("source_excerpt", "")).strip(),
                confidence=_coerce_confidence(d.get("confidence")),
            ))
        except Exception as e:  # noqa: BLE001 — one malformed item should not kill the doc
            log.error("dropping malformed decision #%d from %s: %s", i, doc.filename, e)
    return out


async def extract(doc: Document) -> list[Decision]:
    """Call Haiku once per document; return a list of validated Decisions.

    On persistent failure (after the SDK's built-in retries) logs an error
    and returns an empty list. Does not raise — callers can continue the
    batch even if one doc trips an edge case.
    """
    client = _client()
    try:
        resp: anthropic.types.Message = await client.messages.create(
            model=HAIKU_MODEL,
            max_tokens=4096,
            system=[{
                "type": "text",
                "text": SYSTEM_PROMPT,
                "cache_control": {"type": "ephemeral"},
            }],
            tools=[RECORD_DECISIONS_TOOL],  # type: ignore[list-item]
            tool_choice={"type": "tool", "name": "record_decisions"},
            messages=[{"role": "user", "content": _user_message(doc)}],
        )
    except anthropic.APIError as e:
        log.error(
            "Haiku call failed for doc_id=%s filename=%s: %s",
            doc.id, doc.filename, e,
        )
        return []

    tool_input: dict[str, Any] | None = None
    for block in resp.content:
        if getattr(block, "type", None) == "tool_use" and getattr(block, "name", None) == "record_decisions":
            tool_input = getattr(block, "input", None)
            break

    if tool_input is None:
        log.error(
            "Haiku response for doc_id=%s filename=%s contained no tool_use block",
            doc.id, doc.filename,
        )
        return []

    raw_decisions = tool_input.get("decisions", []) if isinstance(tool_input, dict) else []
    if not isinstance(raw_decisions, list):
        log.error("decisions field was not a list for doc_id=%s — got %r", doc.id, type(raw_decisions))
        return []

    decisions = _parse_tool_output(raw_decisions, doc)

    usage = resp.usage
    log.info(
        "extracted doc_id=%s filename=%s source=%s decisions=%d "
        "in=%d out=%d cache_read=%d cache_create=%d",
        doc.id,
        doc.filename,
        doc.source_type,
        len(decisions),
        usage.input_tokens,
        usage.output_tokens,
        getattr(usage, "cache_read_input_tokens", 0) or 0,
        getattr(usage, "cache_creation_input_tokens", 0) or 0,
    )

    return decisions
