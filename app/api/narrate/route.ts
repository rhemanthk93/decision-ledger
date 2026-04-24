import { streamText } from 'ai'
import { anthropic } from '@ai-sdk/anthropic'

export async function POST(req: Request) {
  try {
    const { earlier, later, conflict_type } = await req.json()

    const conflictLabel = {
      silent_change: 'silent reversal',
      contradiction: 'direct contradiction',
      reversal: 'explicit reversal',
    }[conflict_type as string] ?? 'conflict'

    const result = streamText({
      model: anthropic('claude-sonnet-4-6'),
      system: `You are a decision intelligence analyst. Your job is to narrate conflicts between company decisions clearly and concisely.

Be factual and direct. Point out specifically what changed, who was involved, and what the organizational risk is.
Keep your narration to 3-4 sentences. Do not use bullet points.`,
      prompt: `Narrate this ${conflictLabel} between two decisions:

EARLIER DECISION (${earlier.decided_at}):
Statement: "${earlier.statement}"
Topic: ${earlier.topic_cluster}
Made by: ${earlier.decided_by?.join(', ') || 'unknown'}
Source excerpt: "${earlier.source_excerpt}"
${earlier.rationale ? `Rationale: ${earlier.rationale}` : ''}

LATER DECISION (${later.decided_at}):
Statement: "${later.statement}"
Topic: ${later.topic_cluster}
Made by: ${later.decided_by?.join(', ') || 'unknown'}
Source excerpt: "${later.source_excerpt}"
${later.rationale ? `Rationale: ${later.rationale}` : ''}

Conflict type: ${conflict_type}

Narrate what happened, whether the earlier decision was formally revisited, and what organizational risk this creates.`,
    })

    return result.toTextStreamResponse()
  } catch (error) {
    console.error('Narrate error:', error)
    return new Response('Narration failed', { status: 500 })
  }
}
