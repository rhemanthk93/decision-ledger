import type { Decision, Conflict } from '@/lib/types'
import {
  mergeStoredRecords,
  readStoredArray,
  removeStoredKeys,
  updateStoredRecord,
  writeStoredArray,
} from '@/lib/browser-storage'

const DECISIONS_KEY = 'dl_decisions'
const CONFLICTS_KEY = 'dl_conflicts'

export function getDecisions(): Decision[] {
  return readStoredArray<Decision>(DECISIONS_KEY)
}

export function saveDecisions(decisions: Decision[]): void {
  mergeStoredRecords(DECISIONS_KEY, decisions, 'decisions')
}

export function updateDecision(decision: Decision): void {
  updateStoredRecord(
    DECISIONS_KEY,
    decision.id,
    () => decision,
    'decisions'
  )
}

export function getConflicts(): Conflict[] {
  return readStoredArray<Conflict>(CONFLICTS_KEY)
}

export function saveConflicts(conflicts: Conflict[]): void {
  writeStoredArray(CONFLICTS_KEY, conflicts, 'conflicts')
}

export function updateConflictNarration(id: string, narration: string): void {
  updateStoredRecord(
    CONFLICTS_KEY,
    id,
    conflict => ({ ...conflict, narration }),
    'conflicts'
  )
}

export function clearAll(): void {
  removeStoredKeys([DECISIONS_KEY, CONFLICTS_KEY, 'dl_documents'])
}
