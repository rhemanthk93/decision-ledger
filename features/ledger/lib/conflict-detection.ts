import type { Decision, Conflict } from '@/lib/types'
import { nanoid } from '@/lib/utils'

const REVERSAL_KEYWORDS = [
  'reverting', 'revert', 'switching from', 'replacing', 'moving away from',
  'no longer using', 'instead of', 'migrating from', 'dropping', 'removing',
  'abandoning', 'not using', 'switching to', 'migrate to', 'discontinue',
  'roll back', 'rolling back', 'abandon', 'away from', 'pivot away',
]

const EXCLUSIVE_SCOPE_MARKERS = [
  {
    left: ['internal service', 'internal services', 'service-to-service', 'internal api'],
    right: ['public-facing', 'public facing', 'public api', 'public apis', 'external api', 'external apis'],
  },
]

// Tech keyword groups — statements mentioning different items from the same group contradict each other
// Terms requiring word-boundary matching to avoid false positives
// e.g. 'go' must not match 'going', 'rest' must not match 'interesting'
const TECH_GROUPS: Array<{ terms: string[]; wordBoundary: boolean }> = [
  { terms: ['postgresql', 'postgres', 'mysql', 'mongodb', 'mongo', 'cassandra', 'sqlite', 'cockroachdb', 'supabase', 'aurora'], wordBoundary: false },
  { terms: ['react', 'next.js', 'nextjs', 'svelte', 'vue', 'angular', 'remix', 'solid', 'qwik'], wordBoundary: false },
  { terms: ['kubernetes', 'k8s', 'ecs', 'fargate', 'heroku', 'fly.io', 'render', 'railway'], wordBoundary: false },
  { terms: ['auth0', 'cognito', 'firebase auth', 'clerk', 'supabase auth', 'okta', 'keycloak'], wordBoundary: false },
  // DynamoDB removed from caching group — it was in both DB and cache groups causing double-hits
  { terms: ['redis', 'memcached', 'elasticache'], wordBoundary: false },
  // 'rest' and 'go' need word-boundary matching to avoid substring false positives
  { terms: ['rest', 'graphql', 'grpc', 'trpc'], wordBoundary: true },
  { terms: ['kafka', 'rabbitmq', 'sqs', 'pubsub', 'nats'], wordBoundary: false },
  { terms: ['typescript', 'javascript', 'python', 'go', 'rust', 'java', 'kotlin'], wordBoundary: true },
]

function termMatches(text: string, term: string, wordBoundary: boolean): boolean {
  if (!wordBoundary) return text.includes(term)
  const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return new RegExp(`\\b${escaped}\\b`).test(text)
}

function matchesAnyPhrase(text: string, terms: string[]): boolean {
  return terms.some(term => text.includes(term))
}

function hasReversalLanguage(statement: string): boolean {
  const lower = statement.toLowerCase()
  return REVERSAL_KEYWORDS.some(kw => lower.includes(kw))
}

function scopesAreExplicitlyDifferent(a: string, b: string): boolean {
  const left = a.toLowerCase()
  const right = b.toLowerCase()

  return EXCLUSIVE_SCOPE_MARKERS.some(({ left: leftTerms, right: rightTerms }) => (
    (matchesAnyPhrase(left, leftTerms) && matchesAnyPhrase(right, rightTerms)) ||
    (matchesAnyPhrase(left, rightTerms) && matchesAnyPhrase(right, leftTerms))
  ))
}

function extractTechKeywords(text: string): Array<{ term: string; group: number }> {
  const lower = text.toLowerCase()
  const found: Array<{ term: string; group: number }> = []
  TECH_GROUPS.forEach(({ terms, wordBoundary }, groupIdx) => {
    terms.forEach(term => {
      if (termMatches(lower, term, wordBoundary)) found.push({ term, group: groupIdx })
    })
  })
  return found
}

function statementsContradict(a: string, b: string): boolean {
  if (scopesAreExplicitlyDifferent(a, b)) return false

  const techA = extractTechKeywords(a)
  const techB = extractTechKeywords(b)

  if (techA.length === 0 || techB.length === 0) return false

  // Check if both statements mention different technologies from the same group
  for (const ta of techA) {
    for (const tb of techB) {
      if (ta.group === tb.group && ta.term !== tb.term) {
        return true
      }
    }
  }

  // Fallback: regex-based tech extraction for things not in keyword groups
  const techPatterns = [
    /use\s+(\w[\w.]*)/g,
    /adopt\s+(\w[\w.]*)/g,
    /switch(?:ing)?\s+to\s+(\w[\w.]*)/g,
    /migrat(?:e|ing)\s+(?:to|from)\s+(\w[\w.]*)/g,
    /(\w[\w.]*)\s+as\s+(?:our|the)\s+(?:primary|main|standard)/g,
  ]
  const extractRegexTech = (text: string): string[] => {
    const lower = text.toLowerCase()
    const matches: string[] = []
    for (const pattern of techPatterns) {
      pattern.lastIndex = 0
      let match
      while ((match = pattern.exec(lower)) !== null) {
        const term = match[1]?.toLowerCase() ?? ''
        if (term.length > 2) matches.push(term)
      }
    }
    return matches
  }
  const regexA = extractRegexTech(a)
  const regexB = extractRegexTech(b)
  if (regexA.length > 0 && regexB.length > 0) {
    const overlap = regexA.some(t => regexB.includes(t))
    if (!overlap && (hasReversalLanguage(b) || hasReversalLanguage(a))) return true
  }

  return false
}

export function detectConflicts(decisions: Decision[]): Conflict[] {
  const conflicts: Conflict[] = []
  const seenPairs = new Set<string>()

  // Group by topic_cluster (normalized)
  const clusters = new Map<string, Decision[]>()
  for (const d of decisions) {
    const key = d.topic_cluster.toLowerCase().trim()
    if (!clusters.has(key)) clusters.set(key, [])
    clusters.get(key)!.push(d)
  }

  for (const [, clusterDecisions] of clusters) {
    if (clusterDecisions.length < 2) continue

    // Sort by decided_at ascending
    const sorted = [...clusterDecisions].sort(
      (a, b) => new Date(a.decided_at).getTime() - new Date(b.decided_at).getTime()
    )

    // Walk all pairs (earlier, later)
    for (let i = 0; i < sorted.length - 1; i++) {
      for (let j = i + 1; j < sorted.length; j++) {
        const earlier = sorted[i]
        const later = sorted[j]
        const pairKey = `${earlier.id}::${later.id}`

        if (seenPairs.has(pairKey)) continue

        // Multiple decisions can be extracted from a single document. Treat those as
        // complementary by default unless the later statement explicitly reverses the earlier one.
        if (
          earlier.source_doc_id === later.source_doc_id &&
          !hasReversalLanguage(later.statement)
        ) {
          continue
        }

        let conflictType: Conflict['conflict_type'] | null = null

        // Explicit reversal: later statement uses reversal language
        if (hasReversalLanguage(later.statement)) {
          conflictType = 'reversal'
        }
        // Silent change: later decision is from an informal source (pr/slack)
        // contradicting a formal earlier decision (architectural/strategic)
        else if (
          ['architectural', 'strategic'].includes(earlier.decision_type) &&
          statementsContradict(earlier.statement, later.statement)
        ) {
          conflictType = 'silent_change'
        }
        // Direct contradiction: same topic, different statements, no reversal language
        else if (statementsContradict(earlier.statement, later.statement)) {
          conflictType = 'contradiction'
        }

        if (conflictType) {
          seenPairs.add(pairKey)
          conflicts.push({
            id: nanoid(),
            earlier_decision_id: earlier.id,
            later_decision_id: later.id,
            conflict_type: conflictType,
          })
        }
      }
    }
  }

  return conflicts
}

export function applyConflictStatuses(
  decisions: Decision[],
  conflicts: Conflict[]
): Decision[] {
  const updated = decisions.map(d => ({ ...d }))

  for (const conflict of conflicts) {
    const earlier = updated.find(d => d.id === conflict.earlier_decision_id)
    const later = updated.find(d => d.id === conflict.later_decision_id)

    if (earlier && later) {
      if (conflict.conflict_type === 'reversal') {
        earlier.status = 'reversed'
      } else if (conflict.conflict_type === 'silent_change' || conflict.conflict_type === 'contradiction') {
        earlier.status = 'contradicted'
      }
    }
  }

  return updated
}
