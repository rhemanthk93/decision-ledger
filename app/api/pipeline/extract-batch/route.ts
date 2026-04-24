/**
 * Stage 2 — Extraction (Silver Layer)
 *
 * Runs Claude Haiku 4.5 on every document in parallel (Promise.allSettled ≈ asyncio.gather).
 * Tool-use schema forces structured JSON — we never parse prose.
 * Filters confidence < 0.6 before returning.
 *
 * In production this writes rows to the `decisions` table and pushes to the decisions queue.
 */
import { NextResponse } from 'next/server'
import { generateObject } from 'ai'
import { anthropic } from '@ai-sdk/anthropic'
import { z } from 'zod'
import { nanoid } from '@/lib/utils'
import type { DocType, DecisionType } from '@/lib/types'

const DecisionSchema = z.object({
  decisions: z.array(z.object({
    statement:      z.string().describe('The exact decision made, stated as an imperative fact'),
    topic_cluster:  z.string().describe('Normalized topic label, e.g. "Database choice", "Authentication provider"'),
    decision_type:  z.enum(['architectural', 'strategic', 'process', 'product']),
    decided_at:     z.string().describe('ISO date YYYY-MM-DD when the decision was made'),
    decided_by:     z.array(z.string()).describe('Names of people who made or ratified the decision'),
    source_locator: z.string().optional().describe('Section or reference within the document'),
    source_excerpt: z.string().max(300).describe('Verbatim quote (max 300 chars) that confirms this is a decision'),
    rationale:      z.string().optional().describe('Brief rationale if stated in the document'),
    confidence:     z.number().min(0).max(1).describe('Confidence this is actually a decision (0–1)'),
  }))
})

const SYSTEM_PROMPT = `You are a precision decision extraction engine for an engineering decision ledger.

RULES:
1. Only extract ACTUAL DECISIONS — imperative commitments ("we will use X", "agreed: X", "decision: X", "we are migrating to X")
2. Do NOT extract discussions, suggestions, questions, or hedged language ("we should consider X", "maybe X")
3. Normalize topic_cluster to a canonical label used consistently across all documents:
   - Use "Primary datastore" (not "DB decision" or "database selection")
   - Use "PR review policy" (not "code review" or "approval policy")
   - Use "Custom integration policy" (not "integration threshold")
   - Use consistent labels so the same topic maps to the same cluster across documents
4. Extract the exact date from context — if not explicit, infer from document headers or metadata
5. Set confidence < 0.6 for ambiguous statements; only return high-confidence decisions
6. Extract source_excerpt as a verbatim quote that proves this is a decision (not a discussion)
7. Include context about WHO made the decision in decided_by

Be strict. Fewer, high-quality decisions are better than many low-quality ones.
A dense ADR might emit 3–5 decisions. A Slack thread might emit 1–2. A standup update might emit 0.`

interface RawDoc {
  id: string
  name: string
  doc_type: DocType
  content: string
}

interface ExtractedDecision {
  id: string
  source_doc_id: string
  statement: string
  topic_cluster: string
  decision_type: DecisionType
  status: 'active'
  decided_at: string
  decided_by: string[]
  source_locator?: string
  source_excerpt: string
  rationale?: string
  confidence: number
}

export async function POST(req: Request) {
  try {
    const { documents } = await req.json() as { documents: RawDoc[] }

    if (!Array.isArray(documents) || documents.length === 0) {
      return NextResponse.json({ error: 'documents array required' }, { status: 400 })
    }

    // Parallel extraction — N docs in ~1 round trip (asyncio.gather equivalent)
    const settled = await Promise.allSettled(
      documents.map(async (doc) => {
        const { object } = await generateObject({
          model: anthropic('claude-haiku-4-5-20251001'),
          schema: DecisionSchema,
          system: SYSTEM_PROMPT,
          prompt: `Extract all decisions from this ${doc.doc_type} document titled "${doc.name}":\n\n${doc.content.slice(0, 12000)}`,
        })

        const decisions: ExtractedDecision[] = object.decisions
          .filter(d => d.confidence >= 0.6)
          .map(d => ({
            id:            nanoid(),
            source_doc_id: doc.id,
            status:        'active' as const,
            statement:     d.statement,
            topic_cluster: d.topic_cluster,
            decision_type: d.decision_type,
            decided_at:    d.decided_at,
            decided_by:    d.decided_by,
            source_excerpt: d.source_excerpt,
            source_locator: d.source_locator,
            rationale:     d.rationale,
            confidence:    d.confidence,
          }))

        return { doc_id: doc.id, doc_name: doc.name, decisions, count: decisions.length }
      })
    )

    const results = settled
      .filter((r): r is PromiseFulfilledResult<{
        doc_id: string; doc_name: string; decisions: ExtractedDecision[]; count: number
      }> => r.status === 'fulfilled')
      .map(r => r.value)

    const errors = settled
      .map((r, i) => r.status === 'rejected' ? { doc_id: documents[i]?.id, error: String(r.reason) } : null)
      .filter(Boolean)

    const totalDecisions = results.reduce((sum, r) => sum + r.count, 0)

    return NextResponse.json({ results, errors, total_decisions: totalDecisions })
  } catch (error) {
    console.error('[extract-batch] Error:', error)
    return NextResponse.json({ error: 'Batch extraction failed' }, { status: 500 })
  }
}
