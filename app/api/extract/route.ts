import { NextResponse } from 'next/server'
import { generateObject } from 'ai'
import { anthropic } from '@ai-sdk/anthropic'
import { z } from 'zod'

const DecisionSchema = z.object({
  decisions: z.array(z.object({
    statement: z.string().describe('The exact decision made, stated as an imperative fact'),
    topic_cluster: z.string().describe('Normalized topic label, e.g. "Database choice", "Authentication provider"'),
    decision_type: z.enum(['architectural', 'strategic', 'process', 'product']),
    decided_at: z.string().describe('ISO date YYYY-MM-DD when the decision was made'),
    decided_by: z.array(z.string()).describe('Names of people who made or ratified the decision'),
    source_locator: z.string().optional().describe('Section or reference within the document'),
    source_excerpt: z.string().describe('Verbatim quote (max 200 chars) that confirms this is a decision'),
    rationale: z.string().optional().describe('Brief rationale if stated'),
    confidence: z.number().min(0).max(1).describe('Confidence this is actually a decision (0-1)'),
  }))
})

const SYSTEM_PROMPT = `You are a precision decision extraction engine.

RULES:
1. Only extract ACTUAL DECISIONS — imperative commitments ("we will use X", "agreed: X", "decision: X")
2. Do NOT extract discussions, suggestions, or hedged language ("we should consider X", "maybe X")
3. Normalize topic_cluster to a canonical label (e.g. always "Database choice" not "DB decision" or "database selection")
4. Extract the exact date from context — if not explicit, infer from document metadata
5. Set confidence < 0.6 for ambiguous statements
6. Extract source_excerpt as a verbatim quote that proves this is a decision

Be strict. Fewer, high-quality decisions are better than many low-quality ones.`

export async function POST(req: Request) {
  try {
    const { content, doc_type, doc_name } = await req.json()

    if (!content || !doc_type) {
      return NextResponse.json({ error: 'content and doc_type required' }, { status: 400 })
    }

    const { object } = await generateObject({
      model: anthropic('claude-sonnet-4-6'),
      schema: DecisionSchema,
      system: SYSTEM_PROMPT,
      prompt: `Extract all decisions from this ${doc_type} document titled "${doc_name}":\n\n${content}`,
    })

    return NextResponse.json(object)
  } catch (error) {
    console.error('Extract error:', error)
    return NextResponse.json({ error: 'Extraction failed' }, { status: 500 })
  }
}
