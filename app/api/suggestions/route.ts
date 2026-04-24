import { generateObject } from 'ai'
import { anthropic } from '@ai-sdk/anthropic'
import { z } from 'zod'
import type { Decision } from '@/lib/types'
import {
  buildFallbackSuggestionQuestions,
  normalizeSuggestionQuestions,
  SUGGESTION_COUNT,
  SUGGESTION_MAX_LENGTH,
} from '@/features/ledger/lib/suggestions'

const suggestionsSchema = z.object({
  suggestions: z.array(z.string().max(SUGGESTION_MAX_LENGTH)).length(SUGGESTION_COUNT),
})

function repairSuggestionsText(text: string, decisions: Decision[]) {
  try {
    const parsed = JSON.parse(text)
    return JSON.stringify({
      suggestions: normalizeSuggestionQuestions(parsed?.suggestions, decisions),
    })
  } catch {
    return JSON.stringify({
      suggestions: buildFallbackSuggestionQuestions(decisions),
    })
  }
}

export async function POST(req: Request) {
  const body = await req.json().catch(() => null)
  const decisions = Array.isArray(body?.decisions) ? body.decisions as Decision[] : []
  const fallbackSuggestions = buildFallbackSuggestionQuestions(decisions)

  if (!decisions.length) {
    return Response.json({ suggestions: fallbackSuggestions })
  }

  try {
    const decisionSummary = decisions
      .slice(0, 25)
      .map(d =>
        `[${d.topic_cluster}] ${d.statement} — ${d.status}, decided by ${d.decided_by.join(', ')} on ${d.decided_at}`
      )
      .join('\n')

    const { object } = await generateObject({
      model: anthropic('claude-sonnet-4-6'),
      schema: suggestionsSchema,
      experimental_repairText: async ({ text }) => repairSuggestionsText(text, decisions),
      prompt: `You are helping a user explore a decision ledger. Based on the decisions below, generate exactly 4 insightful questions a user would want to ask about this specific decision history. Questions must be directly relevant to the actual topics, decision-makers, and conflicts present — not generic.

Good question types:
- Ask about a specific topic cluster's evolution or current state
- Surface conflicts, reversals, or silent changes
- Ask who made a controversial or solo decision
- Ask why a decision was reversed or overridden

Hard requirements:
- Return exactly 4 questions in the schema format
- Keep every question at 80 characters or fewer
- Never exceed ${SUGGESTION_MAX_LENGTH} characters
- Shorten names, dates, or details when needed to stay concise
- Return questions only, with no commentary

Decisions in this ledger:
${decisionSummary}`,
    })

    return Response.json({
      suggestions: normalizeSuggestionQuestions(object.suggestions, decisions),
    })
  } catch (error) {
    console.error('Suggestions error:', error)
    return Response.json({ suggestions: fallbackSuggestions })
  }
}
