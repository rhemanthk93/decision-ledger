"""Agent 4 — Sonnet 4.6 conflict narrator + cluster labeller.

Two responsibilities per §7.4:
  1. Produce a three-beat narration (<100 words, teammate voice, past
     tense, inline citations) for a single conflict.
  2. Produce a 2-4 word canonical label for the cluster the conflict
     lives in. The worker writes the label only the FIRST time a cluster
     is narrated — subsequent conflicts in the same cluster reuse it.

A separate helper, `label_remaining_clusters`, uses Haiku in a single
batch call to label clusters that never get a conflict.
"""
from __future__ import annotations

import json
import logging
import re
from typing import Any

import anthropic
from anthropic import AsyncAnthropic

from app.config import ANTHROPIC_API_KEY, HAIKU_MODEL, SONNET_MODEL

log = logging.getLogger(__name__)

# ============================================================
# Tool-use schema
# ============================================================
NARRATE_CONFLICT_TOOL: dict[str, Any] = {
    "name": "narrate_conflict",
    "description": (
        "Produce a short narration of this conflict and a canonical label "
        "for its cluster."
    ),
    "input_schema": {
        "type": "object",
        "properties": {
            "narration": {
                "type": "string",
                "description": (
                    "Three-beat narration under 100 words. Past tense. "
                    "Written as a teammate at a retrospective, NOT as a "
                    "business report. Beat 1: what was decided. Beat 2: "
                    "what happened next. Beat 3: why this is a conflict. "
                    "Cite dates and named authors inline. Do NOT use "
                    "headers, bullets, 'Key findings', 'In summary', "
                    "'The analysis', 'Based on', or any report-style "
                    "framing."
                ),
            },
            "cluster_label": {
                "type": "string",
                "description": (
                    "Short canonical label for the topic cluster, 2-4 "
                    "words. Examples: 'Primary Datastore', 'Code Review "
                    "Policy', 'Custom Integrations'. Title Case. No "
                    "punctuation."
                ),
            },
        },
        "required": ["narration", "cluster_label"],
    },
}


SYSTEM_PROMPT = """You are the narrator agent inside the Decision Ledger pipeline at Meridian Labs. You read a conflict between two decisions and write one short narration that an engineer could read out loud in a retrospective to explain what happened.

Call the `narrate_conflict` tool exactly once. Do not produce any text response — only the tool call.

========================================================================
VOICE
========================================================================

You are a teammate at a retro, not a PDF executive summary. Write in past tense. Cite dates and named authors inline the first time they appear ("On March 15, Wei Ming signed…"). Use concrete nouns (PR numbers, ADR numbers) when they're in the input. End on the IMPLICATION — what the conflict means — not on a summary sentence.

Three beats. No headers. No bullet points. One flowing paragraph of 3-6 sentences.

Under 100 words. Count them as you write. If you go over, cut adjectives and throat-clearing first, then trim one beat to its essential verb.

========================================================================
CITATION STYLE
========================================================================

- Refer to documents by their type, not their filename. Say "the identity squad's weekly on April 2" or "the April 8 backend-guild thread", not "identity_squad_weekly_2026-04-02.txt" or "backend_guild_2026-04-08.md". Filenames belong in metadata, not prose.
- Normalize people's names within a single narration. If you use a full name on first mention ("Jessica Wong"), use the first name after ("Jessica"), not the handle ("jwong"). Never switch between "Jessica Wong" and "jwong" in the same narration. If the only name you have is a handle, treat it as the person's first name and stay consistent.

========================================================================
EXAMPLE OUTPUT (silent_reversal style) — this is the tone to match
========================================================================

"On March 15, Wei Ming signed ADR-0042 committing to Postgres as the primary datastore for all event data, and the ADR explicitly rejected MongoDB on operational grounds. Five weeks later, Jessica merged PR #847, migrating user_events to MongoDB with two approvals and a reference to an April Slack benchmark thread. No superseding ADR was written between the two. The architectural commitment was undone by an implementation PR with no formal revision."

(97 words. Three beats. Past tense. Inline citations. Ends on implication.)

========================================================================
FORBIDDEN PHRASES AND PATTERNS
========================================================================

Never begin with or include:
  "Key findings"
  "In summary"
  "The analysis"
  "Based on"
  "Key takeaway"
  "I notice"
  "I found"
  "It appears that"
  "Seemingly"
  "This report"
  "The team" as a subject substitute for a named person (use the actual name)

Never include:
  Section headers ("## Decision context", "**Finding**:")
  Bullet points or numbered lists
  First-person self-reference ("I", "my analysis", "Claude")
  The word "Claude" anywhere

If you are tempted to hedge ("it appears that Jessica merged…"), drop the hedge and state the fact. The inputs are authoritative; don't equivocate.

========================================================================
INPUT SHAPE
========================================================================

The user message contains a JSON object with:
  rule              — one of "silent_reversal", "contradicts", "reverses", "supersedes"
  d1                — the earlier decision (statement, type, decided_at, decided_by, source_excerpt, source_filename)
  d2                — the later decision (same fields)
  cluster_history   — the full ordered list of decisions in this topic cluster, including soft ones (confidence < 0.60) which are the "where this started" evidence. Each has date, statement, type, and optionally confidence and decided_by.

Use the cluster_history to find the foreshadowing beat — a soft decision between d1 and d2 that hinted at the change before it formally happened. Mention it as "where this started" evidence, not as a formal step.

========================================================================
THREE-BEAT STRUCTURE
========================================================================

Beat 1 — what was decided. Scene-set d1: date, author, substance. One or two sentences.

Beat 2 — what happened next. If cluster_history has a soft decision between d1 and d2, lead with "where this started" and cite its date. Then d2: date, author, substance. Two or three sentences.

Beat 3 — why this is a conflict. One sentence. End on the implication. For silent_reversal: "…was undone by…", "…reversed without a formal revision", "…no superseding ADR was written". For contradicts: "…the earlier policy and the later carve-out both stand in the record…", "…the practice quietly diverged from the committed policy".

========================================================================
CLUSTER LABEL
========================================================================

2-4 words. Title Case. No punctuation. The label is for a group of decisions sharing a topic, not for this specific conflict. Examples:
  "Primary Datastore"
  "Code Review Policy"
  "Custom Integrations"
  "Deploy Policy"
  "Event Schema"

Avoid generic labels like "Architecture Decisions" or "Process Policies". The label should uniquely identify THIS cluster's topic.
"""


# ============================================================
# Voice + word-count validators
# ============================================================

FORBIDDEN_PHRASES = (
    "key findings",
    "in summary",
    "the analysis",
    "based on",
    "key takeaway",
    "i notice",
    "i found",
    "it appears that",
    "seemingly",
    "this report",
)

_HEADER_RE = re.compile(r"^\s{0,3}#{1,6}\s", re.MULTILINE)
_BULLET_RE = re.compile(r"^\s*[-•*]\s", re.MULTILINE)
_CLAUDE_RE = re.compile(r"\bclaude\b", re.IGNORECASE)


def word_count(text: str) -> int:
    return len(text.split())


def forbidden_phrases_hit(text: str) -> list[str]:
    low = text.lower()
    hits = [p for p in FORBIDDEN_PHRASES if p in low]
    if _HEADER_RE.search(text):
        hits.append("markdown header")
    if _BULLET_RE.search(text):
        hits.append("bullet/list marker")
    if _CLAUDE_RE.search(text):
        hits.append("literal 'Claude'")
    return hits


# ============================================================
# Narration
# ============================================================

def _client() -> AsyncAnthropic:
    # No singleton — pytest-asyncio gets a fresh event loop per test;
    # matches resolver.py's rationale.
    return AsyncAnthropic(api_key=ANTHROPIC_API_KEY, max_retries=2)


def _user_message_payload(rule: str, d1: dict[str, Any], d2: dict[str, Any], cluster_history: list[dict[str, Any]]) -> str:
    payload = {
        "rule": rule,
        "d1": d1,
        "d2": d2,
        "cluster_history": cluster_history,
    }
    return "```json\n" + json.dumps(payload, indent=2, default=str) + "\n```"


def _extract_tool_input(resp: anthropic.types.Message) -> dict[str, Any] | None:
    for block in resp.content:
        if getattr(block, "type", None) == "tool_use" and getattr(block, "name", None) == "narrate_conflict":
            inp = getattr(block, "input", None)
            if isinstance(inp, dict):
                return inp
    return None


async def _call_sonnet(messages: list[dict[str, Any]]) -> anthropic.types.Message:
    client = _client()
    return await client.messages.create(
        model=SONNET_MODEL,
        max_tokens=2048,
        system=[{
            "type": "text",
            "text": SYSTEM_PROMPT,
            "cache_control": {"type": "ephemeral"},
        }],
        tools=[NARRATE_CONFLICT_TOOL],  # type: ignore[list-item]
        tool_choice={"type": "tool", "name": "narrate_conflict"},
        messages=messages,
    )


async def narrate(rule: str, d1: dict[str, Any], d2: dict[str, Any], cluster_history: list[dict[str, Any]]) -> dict[str, Any] | None:
    """Generate a narration + cluster_label. Returns None on persistent failure.

    Validation retries (per §7.4.3):
      - If the narration contains forbidden voice phrases, retry ONCE.
      - If word count > 100, retry ONCE with an explicit cut request.
    Both retries preserve the conversation (prior assistant + tool-result
    + corrective user message). The SDK's built-in max_retries handles
    transient HTTP errors (429/500/timeout).
    """
    user_msg = _user_message_payload(rule, d1, d2, cluster_history)
    messages: list[dict[str, Any]] = [
        {"role": "user", "content": user_msg},
    ]

    try:
        resp = await _call_sonnet(messages)
    except anthropic.APIError as e:
        log.error("narrator: Sonnet call failed for rule=%s: %s", rule, e)
        return None

    first = _extract_tool_input(resp)
    if first is None:
        log.error("narrator: first response had no tool_use block (rule=%s)", rule)
        return None

    narration = str(first.get("narration", "")).strip()
    label = str(first.get("cluster_label", "")).strip()

    retries_done: list[str] = []

    def _needs_voice_retry(n: str) -> bool:
        return bool(forbidden_phrases_hit(n))

    def _needs_length_retry(n: str) -> bool:
        return word_count(n) > 100

    # Round 1 of corrective retry (pick voice first if both fail — voice
    # is the more-expensive fix).
    if _needs_voice_retry(narration):
        hits = forbidden_phrases_hit(narration)
        correction = (
            f"Your previous narration used report-style phrasing (detected: {', '.join(hits)}). "
            "Rewrite in teammate voice — past tense, inline date+author citations, no framing "
            "phrases, no headers or bullets. Keep the three-beat structure. Call narrate_conflict "
            "again with the revised narration."
        )
        tool_use_id = next(
            (b.id for b in resp.content if getattr(b, "type", None) == "tool_use"),
            None,
        )
        if tool_use_id is None:
            log.error("narrator: could not find tool_use id for retry")
            return None
        messages += [
            {"role": "assistant", "content": resp.content},
            {"role": "user", "content": [{
                "type": "tool_result",
                "tool_use_id": tool_use_id,
                "content": correction,
                "is_error": True,
            }]},
        ]
        try:
            resp = await _call_sonnet(messages)
        except anthropic.APIError as e:
            log.error("narrator: voice-retry Sonnet call failed: %s", e)
            return None
        retries_done.append("voice")
        second = _extract_tool_input(resp)
        if second is None:
            log.error("narrator: voice-retry response had no tool_use block")
            return None
        narration = str(second.get("narration", "")).strip()
        label = str(second.get("cluster_label", "")).strip() or label

    if _needs_length_retry(narration):
        n_words = word_count(narration)
        correction = (
            f"Your previous narration was {n_words} words; cut to under 100 words while "
            "preserving the three-beat structure. Drop adjectives and throat-clearing first, "
            "then trim one beat to its essential verb. Call narrate_conflict again."
        )
        tool_use_id = next(
            (b.id for b in resp.content if getattr(b, "type", None) == "tool_use"),
            None,
        )
        if tool_use_id is None:
            log.error("narrator: could not find tool_use id for length-retry")
            return None
        messages += [
            {"role": "assistant", "content": resp.content},
            {"role": "user", "content": [{
                "type": "tool_result",
                "tool_use_id": tool_use_id,
                "content": correction,
                "is_error": True,
            }]},
        ]
        try:
            resp = await _call_sonnet(messages)
        except anthropic.APIError as e:
            log.error("narrator: length-retry Sonnet call failed: %s", e)
            return None
        retries_done.append("length")
        third = _extract_tool_input(resp)
        if third is None:
            log.error("narrator: length-retry response had no tool_use block")
            return None
        narration = str(third.get("narration", "")).strip()
        label = str(third.get("cluster_label", "")).strip() or label

    usage = resp.usage
    log.info(
        "narrator: rule=%s words=%d retries=%s in=%d out=%d cache_read=%d cache_create=%d label=%r",
        rule,
        word_count(narration),
        "+".join(retries_done) or "none",
        usage.input_tokens,
        usage.output_tokens,
        getattr(usage, "cache_read_input_tokens", 0) or 0,
        getattr(usage, "cache_creation_input_tokens", 0) or 0,
        label,
    )
    return {"narration": narration, "cluster_label": label}


# ============================================================
# Haiku batch labeller for clusters that never get a conflict
# ============================================================

RECORD_CLUSTER_LABELS_TOOL: dict[str, Any] = {
    "name": "record_cluster_labels",
    "description": "Produce a 2-4 word Title Case canonical label for each cluster.",
    "input_schema": {
        "type": "object",
        "properties": {
            "labels": {
                "type": "array",
                "items": {
                    "type": "object",
                    "properties": {
                        "cluster_id": {"type": "string"},
                        "label": {
                            "type": "string",
                            "description": "2-4 words, Title Case, no punctuation.",
                        },
                    },
                    "required": ["cluster_id", "label"],
                },
            }
        },
        "required": ["labels"],
    },
}


CLUSTER_LABEL_SYSTEM_PROMPT = """You label decision clusters for the Decision Ledger.

Given a list of clusters, each with its member decisions, produce a 2-4 word canonical label per cluster. Title Case. No punctuation. The label should uniquely identify the cluster's topic, not describe its decisions generically.

Call record_cluster_labels exactly once with an entry per cluster.

Examples of good labels:
  "Primary Datastore"
  "Code Review Policy"
  "Custom Integrations"
  "Deploy Policy"
  "Event Schema"
  "Identity Graph TTL"

Avoid generic labels like "Architecture Decisions", "Process Policies", or "Multiple Topics". If a cluster appears to mix topics, pick the dominant one."""


async def label_clusters_with_haiku(clusters: list[dict[str, Any]]) -> dict[str, str]:
    """Batch-label clusters. Input is a list of {cluster_id, decisions: [...]}.

    Returns a dict mapping cluster_id -> label. Clusters that the model
    omits from its output are silently skipped.
    """
    if not clusters:
        return {}

    client = _client()
    payload_lines = []
    for c in clusters:
        payload_lines.append(f"## Cluster {c['cluster_id']}")
        for d in c["decisions"]:
            kw = " ".join(d.get("topic_keywords") or [])
            payload_lines.append(f"  - [{d.get('type')}] {d.get('statement')}  (keywords: {kw})")
    user_msg = "\n".join(payload_lines)

    try:
        resp = await client.messages.create(
            model=HAIKU_MODEL,
            max_tokens=2048,
            system=[{
                "type": "text",
                "text": CLUSTER_LABEL_SYSTEM_PROMPT,
                "cache_control": {"type": "ephemeral"},
            }],
            tools=[RECORD_CLUSTER_LABELS_TOOL],  # type: ignore[list-item]
            tool_choice={"type": "tool", "name": "record_cluster_labels"},
            messages=[{"role": "user", "content": user_msg}],
        )
    except anthropic.APIError as e:
        log.error("label_clusters_with_haiku: Sonnet call failed: %s", e)
        return {}

    for block in resp.content:
        if getattr(block, "type", None) == "tool_use" and getattr(block, "name", None) == "record_cluster_labels":
            inp = getattr(block, "input", None)
            if isinstance(inp, dict):
                out: dict[str, str] = {}
                for entry in inp.get("labels") or []:
                    cid = str(entry.get("cluster_id", "")).strip()
                    lbl = str(entry.get("label", "")).strip()
                    if cid and lbl:
                        out[cid] = lbl
                return out
    log.error("label_clusters_with_haiku: no tool_use block in response")
    return {}
