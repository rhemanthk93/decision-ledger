import { streamText } from 'ai'
import { anthropic } from '@ai-sdk/anthropic'
import type { Decision } from '@/lib/types'

export async function POST(req: Request) {
  try {
    const { q, decisions }: { q: string; decisions: Decision[] } = await req.json()

    if (!q || !decisions?.length) {
      return new Response('q and decisions required', { status: 400 })
    }
    if (typeof q !== 'string' || q.length > 2000) {
      return new Response('q must be a string under 2000 characters', { status: 400 })
    }

    const context = [...decisions]
      .sort((a, b) => new Date(b.decided_at).getTime() - new Date(a.decided_at).getTime())
      .map(d => `[${d.decided_at}] [${d.status.toUpperCase()}] [${d.topic_cluster}] ${d.statement}${d.rationale ? ` (Rationale: ${d.rationale})` : ''}`)
      .join('\n')

    const result = streamText({
      model: anthropic('claude-sonnet-4-6'),
      system: `You are a decision intelligence assistant. Answer questions about company decisions based on the provided decision ledger.

Format your answer clearly:
1. State the current active decision (if any) in bold
2. Show the history of decisions on this topic (chronological)
3. Flag any conflicts or contradictions
4. Be concise — 2-4 sentences max unless the history is complex`,
      prompt: `Decision Ledger Context:
${context}

Question: ${q}`,
    })

    return result.toTextStreamResponse()
  } catch (error) {
    console.error('Query error:', error)
    return new Response('Query failed', { status: 500 })
  }
}
