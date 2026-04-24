import type { Decision } from '@/lib/types'

export const SUGGESTION_COUNT = 4
export const SUGGESTION_MAX_LENGTH = 90

export type SuggestionIcon = 'database' | 'sparkles' | 'alert' | 'shield' | 'rotate'

export type LedgerSuggestion = {
  q: string
  icon: SuggestionIcon
}

const GENERIC_FALLBACKS: LedgerSuggestion[] = [
  { q: 'What is the current database strategy?', icon: 'database' },
  { q: 'Summarize all active architectural decisions', icon: 'sparkles' },
  { q: 'Are there any conflicting decisions?', icon: 'alert' },
  { q: 'Which decisions have been reversed?', icon: 'rotate' },
]

function truncateQuestion(question: string) {
  if (question.length <= SUGGESTION_MAX_LENGTH) return question

  let shortened = question.slice(0, SUGGESTION_MAX_LENGTH - 1).trimEnd()
  const lastSpace = shortened.lastIndexOf(' ')

  if (lastSpace >= 48) {
    shortened = shortened.slice(0, lastSpace)
  }

  shortened = shortened.replace(/[.?!,:;-]+$/, '').trimEnd()

  if (!shortened) {
    return question.slice(0, SUGGESTION_MAX_LENGTH).trim()
  }

  return `${shortened}?`
}

function normalizeQuestion(question: string) {
  const normalized = question.replace(/\s+/g, ' ').trim()

  if (!normalized) return ''

  return truncateQuestion(normalized)
}

function dedupeQuestions(questions: string[]) {
  const seen = new Set<string>()

  return questions.filter(question => {
    if (seen.has(question)) return false
    seen.add(question)
    return true
  })
}

export function buildFallbackSuggestions(decisions: Decision[]): LedgerSuggestion[] {
  const clusters = [...new Set(decisions.map(d => d.topic_cluster).filter(Boolean))]
  const hasConflicts = decisions.some(d => d.status === 'contradicted' || d.status === 'reversed')
  const hasSoloDecisions = decisions.some(d => d.decided_by.length === 1)

  const suggestions: LedgerSuggestion[] = []

  if (clusters[0]) {
    suggestions.push({ q: `What is the current state of our ${clusters[0]} decisions?`, icon: 'database' })
  }
  if (clusters[1]) {
    suggestions.push({ q: `Summarize all decisions about ${clusters[1]}`, icon: 'sparkles' })
  }

  suggestions.push(
    hasConflicts
      ? { q: 'Which decisions have been contradicted or silently overridden?', icon: 'alert' }
      : { q: 'What are the key architectural decisions made so far?', icon: 'alert' }
  )

  suggestions.push(
    hasSoloDecisions
      ? { q: 'Which decisions were made by a single person without team sign-off?', icon: 'shield' }
      : { q: 'Which decisions have been reversed and why?', icon: 'rotate' }
  )

  while (suggestions.length < SUGGESTION_COUNT) {
    suggestions.push(GENERIC_FALLBACKS[suggestions.length])
  }

  return suggestions
    .slice(0, SUGGESTION_COUNT)
    .map(suggestion => ({ ...suggestion, q: normalizeQuestion(suggestion.q) }))
}

export function buildFallbackSuggestionQuestions(decisions: Decision[]) {
  return buildFallbackSuggestions(decisions).map(({ q }) => q)
}

export function normalizeSuggestionQuestions(rawSuggestions: unknown, decisions: Decision[]) {
  const fallbackQuestions = buildFallbackSuggestionQuestions(decisions)
  const genericQuestions = GENERIC_FALLBACKS.map(({ q }) => normalizeQuestion(q))
  const normalized = Array.isArray(rawSuggestions)
    ? rawSuggestions
      .filter((question): question is string => typeof question === 'string')
      .map(normalizeQuestion)
      .filter(Boolean)
    : []

  const questions = dedupeQuestions(normalized)

  for (const fallbackQuestion of dedupeQuestions([...fallbackQuestions, ...genericQuestions])) {
    if (questions.length >= SUGGESTION_COUNT) break
    if (!questions.includes(fallbackQuestion)) {
      questions.push(fallbackQuestion)
    }
  }

  return questions.slice(0, SUGGESTION_COUNT)
}
