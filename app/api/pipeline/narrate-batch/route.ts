/**
 * Stage 5 — Narration (Gold Layer)
 *
 * For each conflict row, calls Claude Sonnet with the two decisions + cluster history.
 * Fixed 3-beat structure: what was decided → what happened next → why this is a conflict.
 * Under 100 words. Non-streaming (generateText) so we can batch in parallel.
 *
 * In production this updates the `narration` column on the conflicts table.
 */
import { NextResponse } from 'next/server'
import { generateText } from 'ai'
import { anthropic } from '@ai-sdk/anthropic'
import type { Decision, Conflict } from '@/lib/types'

interface NarrateItem {
  conflict: Conflict
  earlier: Decision
  later: Decision
}

const CONFLICT_LABEL: Record<string, string> = {
  silent_change:  'silent reversal',
  contradiction:  'direct contradiction',
  reversal:       'explicit reversal',
}

export async function POST(req: Request) {
  try {
    const { items } = await req.json() as { items: NarrateItem[] }

    if (!Array.isArray(items) || items.length === 0) {
      return NextResponse.json({ narrations: [] })
    }

    // Narrate all conflicts in parallel
    const settled = await Promise.allSettled(
      items.map(async ({ conflict, earlier, later }) => {
        const label = CONFLICT_LABEL[conflict.conflict_type] ?? 'conflict'

        const { text } = await generateText({
          model: anthropic('claude-sonnet-4-6'),
          system: `You are a decision intelligence analyst. Narrate conflicts between company decisions in exactly 3 sentences:
1. What was decided (with date, author, source citation).
2. What happened next (the action taken, and whether a new formal decision was made).
3. Why this is a conflict (the organizational risk or governance gap).
Under 100 words total. No bullet points. Factual and direct.`,
          prompt: `Narrate this ${label}:

EARLIER (${earlier.decided_at}, by ${earlier.decided_by.join(', ')}):
"${earlier.statement}"
Source: "${earlier.source_excerpt}"

LATER (${later.decided_at}, by ${later.decided_by.join(', ')}):
"${later.statement}"
Source: "${later.source_excerpt}"`,
        })

        return { conflict_id: conflict.id, narration: text.trim() }
      })
    )

    const narrations = settled
      .filter((r): r is PromiseFulfilledResult<{ conflict_id: string; narration: string }> =>
        r.status === 'fulfilled'
      )
      .map(r => r.value)

    const errors = settled
      .map((r, i) =>
        r.status === 'rejected'
          ? { conflict_id: items[i]?.conflict.id, error: String(r.reason) }
          : null
      )
      .filter(Boolean)

    return NextResponse.json({ narrations, errors })
  } catch (error) {
    console.error('[narrate-batch] Error:', error)
    return NextResponse.json({ error: 'Batch narration failed' }, { status: 500 })
  }
}
