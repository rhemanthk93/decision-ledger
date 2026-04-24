/**
 * Supabase-backed replacements for the localStorage storage layer.
 * The backend is the source of truth; reads are async queries.
 *
 * Writes (saveDecisions, saveConflicts, updateConflictNarration) are
 * intentionally no-ops in this integration — the Python backend's
 * resolver/detector/narrator workers own all mutations. The frontend's
 * "Refresh" button triggers the backend via POST /admin/run-pipeline
 * and then refetches.
 */
import type { Conflict, Decision } from "@/lib/types"
import {
  decisionRowsToFrontend,
  conflictRowToFrontend,
  DecisionRow,
  ConflictRow,
  TopicClusterRow,
} from "@/lib/backend-adapter"
import { getSupabase } from "@/lib/supabase"

export async function getDecisions(): Promise<Decision[]> {
  const sb = getSupabase()
  const [decRes, clusterRes, conflictRes] = await Promise.all([
    sb
      .from("decisions")
      .select(
        "id, document_id, statement, topic_keywords, type, decided_at, decided_by, source_excerpt, confidence, topic_cluster_id, created_at"
      )
      .order("decided_at", { ascending: true }),
    sb.from("topic_clusters").select("id, canonical_label"),
    sb.from("conflicts").select("id, cluster_id, d1_id, d2_id, rule, narration, created_at"),
  ])
  if (decRes.error) {
    console.error("getDecisions:", decRes.error.message)
    return []
  }
  return decisionRowsToFrontend(
    (decRes.data ?? []) as DecisionRow[],
    (clusterRes.data ?? []) as TopicClusterRow[],
    (conflictRes.data ?? []) as ConflictRow[]
  )
}

export async function getConflicts(): Promise<Conflict[]> {
  const sb = getSupabase()
  const { data, error } = await sb
    .from("conflicts")
    .select("id, cluster_id, d1_id, d2_id, rule, narration, created_at")
    .order("created_at", { ascending: true })
  if (error) {
    console.error("getConflicts:", error.message)
    return []
  }
  const rows = (data ?? []) as ConflictRow[]
  return rows
    .map(conflictRowToFrontend)
    .filter((x): x is Conflict => x !== null)
}

// --- Write-path stubs. The backend owns persistence; these are left in
// place so legacy call sites compile. Canonical state lives in Supabase;
// UI refresh comes from re-reading after triggering the backend.

export function saveDecisions(_decisions: Decision[]): void {
  // no-op in Supabase-backed mode
}

export function updateDecision(_decision: Decision): void {
  // no-op in Supabase-backed mode
}

export function saveConflicts(_conflicts: Conflict[]): void {
  // no-op in Supabase-backed mode
}

export function updateConflictNarration(_id: string, _narration: string): void {
  // no-op in Supabase-backed mode
}

export async function clearAll(): Promise<void> {
  // Intentionally unwired — truncating the pipeline's state shouldn't be
  // one button click in the UI. Use the Supabase SQL editor.
  console.warn(
    "clearAll() is disabled in Supabase-backed mode. Truncate tables via Supabase Studio if you really want to reset."
  )
}
