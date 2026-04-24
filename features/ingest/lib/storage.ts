import type { DLDocument } from '@/lib/types'
import {
  readStoredArray,
  upsertStoredRecord,
  updateStoredRecord,
} from '@/lib/browser-storage'

const DOCUMENTS_KEY = 'dl_documents'

export function getDocuments(): DLDocument[] {
  return readStoredArray<DLDocument>(DOCUMENTS_KEY)
}

export function saveDocument(doc: DLDocument): void {
  upsertStoredRecord(DOCUMENTS_KEY, doc, 'document')
}

export function updateDocumentStatus(
  id: string,
  status: DLDocument['status']
): void {
  updateStoredRecord(
    DOCUMENTS_KEY,
    id,
    doc => ({ ...doc, status }),
    'document'
  )
}
