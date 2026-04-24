/**
 * Supabase-backed document storage. The backend's /ingest endpoint
 * owns writes; this module only reads from the documents table.
 */
import type { DLDocument } from "@/lib/types"
import { documentRowToDL, DocumentRow } from "@/lib/backend-adapter"
import { getSupabase } from "@/lib/supabase"

export async function getDocuments(): Promise<DLDocument[]> {
  const sb = getSupabase()
  const { data, error } = await sb
    .from("documents")
    .select("id, source_type, filename, doc_date, ingested_at, content, content_hash")
    .order("doc_date", { ascending: true })
  if (error) {
    console.error("getDocuments:", error.message)
    return []
  }
  return ((data ?? []) as DocumentRow[]).map(documentRowToDL)
}

// Write-path stubs — Supabase is the source of truth. The /ingest
// endpoint on the Python backend writes documents; this UI path is
// read-only at the moment.

export function saveDocument(_doc: DLDocument): void {
  // no-op in Supabase-backed mode
}

export function updateDocumentStatus(
  _id: string,
  _status: DLDocument["status"]
): void {
  // no-op in Supabase-backed mode
}
