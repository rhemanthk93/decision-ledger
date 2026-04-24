/**
 * Transforms Supabase rows into the frontend's existing types
 * (lib/types.ts). This is the seam between the backend's schema
 * (§6 of the build plan) and the frontend's client-side data model.
 *
 * The frontend pre-dates the Python backend, so the two schemas
 * diverged:
 *   - source_type (meeting/slack/adr/spec/pr)  ↔  doc_type (transcript/adr/slack/pr/memo)
 *   - type (arch/process/product/action)        ↔  decision_type (arch/strategic/process/product/action)
 *   - d1_id / d2_id                             ↔  earlier_decision_id / later_decision_id
 *   - rule (supersedes/reverses/contradicts/silent_reversal/consistent)
 *                                               ↔  conflict_type (reversal/contradiction/silent_change)
 *   - Decision.status is computed client-side from conflicts (backend doesn't store it).
 *   - topic_cluster_id (uuid)                   ↔  topic_cluster (string label)
 */
import type {
  Conflict,
  ConflictType,
  DLDocument,
  Decision,
  DecisionStatus,
  DecisionType,
  DocType,
} from "./types"

// ---- Raw row shapes (what the Supabase client returns) ----

export type DocumentRow = {
  id: string
  source_type: "meeting" | "slack" | "adr" | "spec" | "pr"
  filename: string
  doc_date: string
  ingested_at: string
  content: string
  content_hash: string
}

export type DecisionRow = {
  id: string
  document_id: string
  statement: string
  topic_keywords: string[]
  type: "architectural" | "process" | "product" | "action"
  decided_at: string
  decided_by: string[]
  source_excerpt: string
  confidence: number
  topic_cluster_id: string | null
  created_at: string
}

export type TopicClusterRow = {
  id: string
  canonical_label: string | null
}

export type ConflictRow = {
  id: string
  cluster_id: string
  d1_id: string
  d2_id: string
  rule:
    | "supersedes"
    | "reverses"
    | "contradicts"
    | "silent_reversal"
    | "consistent"
  narration: string | null
  created_at: string
}

// ---- Mappings ----

const SOURCE_TYPE_TO_DOC_TYPE: Record<DocumentRow["source_type"], DocType> = {
  meeting: "transcript",
  adr: "adr",
  slack: "slack",
  spec: "memo",
  pr: "pr",
}

const DB_TYPE_TO_FRONTEND: Record<DecisionRow["type"], DecisionType> = {
  architectural: "architectural",
  process: "process",
  product: "product",
  action: "action",
}

const RULE_TO_CONFLICT_TYPE: Record<ConflictRow["rule"], ConflictType | null> =
  {
    supersedes: "reversal",
    reverses: "reversal",
    contradicts: "contradiction",
    silent_reversal: "silent_change",
    consistent: null,
  }

const RULE_TO_DECISION_STATUS: Record<ConflictRow["rule"], DecisionStatus | null> =
  {
    supersedes: "superseded",
    reverses: "reversed",
    contradicts: "contradicted",
    silent_reversal: "reversed",
    consistent: null,
  }

// Severity order — if the same decision is on the `earlier` side of
// multiple conflicts, we pick the most severe for its status badge.
const STATUS_SEVERITY: Record<DecisionStatus, number> = {
  active: 0,
  superseded: 1,
  reversed: 2,
  contradicted: 3,
}

// ---- Transformers ----

export function documentRowToDL(row: DocumentRow): DLDocument {
  return {
    id: row.id,
    name: row.filename,
    doc_type: SOURCE_TYPE_TO_DOC_TYPE[row.source_type] ?? "memo",
    content: row.content,
    uploaded_at: row.ingested_at,
    status: "done",
  }
}

export function conflictRowToFrontend(row: ConflictRow): Conflict | null {
  const ctype = RULE_TO_CONFLICT_TYPE[row.rule]
  if (ctype === null) return null // consistent — don't render
  return {
    id: row.id,
    earlier_decision_id: row.d1_id,
    later_decision_id: row.d2_id,
    conflict_type: ctype,
    narration: row.narration ?? undefined,
    resolved: false,
  }
}

/**
 * Transform decision rows, enriching each with:
 *   - topic_cluster: the canonical_label from topic_clusters (fallback: uuid)
 *   - status: computed from the conflicts where this decision is d1
 */
export function decisionRowsToFrontend(
  decisions: DecisionRow[],
  clusters: TopicClusterRow[],
  conflicts: ConflictRow[]
): Decision[] {
  const clusterLabel = new Map<string, string>()
  for (const c of clusters) {
    clusterLabel.set(c.id, c.canonical_label ?? c.id.slice(0, 8))
  }
  // Map decision id → worst status implied by conflicts where it's d1.
  const statusByDecision = new Map<string, DecisionStatus>()
  for (const cf of conflicts) {
    const implied = RULE_TO_DECISION_STATUS[cf.rule]
    if (!implied) continue
    const prev = statusByDecision.get(cf.d1_id)
    if (!prev || STATUS_SEVERITY[implied] > STATUS_SEVERITY[prev]) {
      statusByDecision.set(cf.d1_id, implied)
    }
  }

  return decisions.map(d => ({
    id: d.id,
    statement: d.statement,
    topic_cluster: d.topic_cluster_id
      ? clusterLabel.get(d.topic_cluster_id) ?? "unclustered"
      : "unclustered",
    decision_type: DB_TYPE_TO_FRONTEND[d.type] ?? "product",
    status: statusByDecision.get(d.id) ?? "active",
    decided_at: d.decided_at,
    decided_by: d.decided_by ?? [],
    source_doc_id: d.document_id,
    source_excerpt: d.source_excerpt,
    confidence: d.confidence,
  }))
}
