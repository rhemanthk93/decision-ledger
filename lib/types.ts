export type DocType = 'transcript' | 'adr' | 'slack' | 'pr' | 'memo'
export type DecisionType = 'architectural' | 'strategic' | 'process' | 'product'
export type DecisionStatus = 'active' | 'reversed' | 'contradicted' | 'superseded'
export type ConflictType = 'reversal' | 'contradiction' | 'silent_change'

export type DLDocument = {
  id: string
  name: string
  doc_type: DocType
  content: string
  uploaded_at: string
  status: 'pending' | 'processing' | 'done' | 'failed'
}

export type Decision = {
  id: string
  statement: string
  topic_cluster: string
  decision_type: DecisionType
  status: DecisionStatus
  decided_at: string
  decided_by: string[]
  source_doc_id: string
  source_locator?: string
  source_excerpt: string
  rationale?: string
  confidence: number
}

export type Conflict = {
  id: string
  earlier_decision_id: string
  later_decision_id: string
  conflict_type: ConflictType
  narration?: string
  resolved?: boolean
}
