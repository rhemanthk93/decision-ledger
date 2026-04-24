"use client"

import React, { useState, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { Upload, FileText, ChevronDown } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { nanoid } from '@/lib/utils'
import type { DocType, DLDocument, Decision, DecisionType } from '@/lib/types'
import { saveDocument } from '../lib/storage'
import { saveDecisions, saveConflicts, getDecisions } from '@/features/ledger/lib/storage'
import { detectConflicts, applyConflictStatuses } from '@/features/ledger/lib/conflict-detection'
import ExtractionStream from './ExtractionStream'

const DOC_TYPES: { value: DocType; label: string }[] = [
  { value: 'transcript', label: 'Meeting Transcript' },
  { value: 'adr', label: 'Architecture Decision Record' },
  { value: 'slack', label: 'Slack Thread' },
  { value: 'pr', label: 'Pull Request' },
  { value: 'memo', label: 'Planning Memo' },
]

interface Props {
  onSuccess?: () => void
}

type Step = 'idle' | 'processing' | 'done' | 'error'

export default function DocumentUpload({ onSuccess }: Props) {
  const router = useRouter()
  const [name, setName] = useState('')
  const [docType, setDocType] = useState<DocType>('transcript')
  const [content, setContent] = useState('')
  const [step, setStep] = useState<Step>('idle')
  const [conflictCount, setConflictCount] = useState(0)
  const [extractedDecisions, setExtractedDecisions] = useState<Decision[]>([])
  const [error, setError] = useState('')
  const [dragOver, setDragOver] = useState(false)
  const dragCounterRef = React.useRef(0)

  const handleFile = useCallback(async (file: File) => {
    const text = await file.text()
    setContent(text)
    if (!name) setName(file.name.replace(/\.[^.]+$/, ''))
  }, [name])

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    setDragOver(false)
    const file = e.dataTransfer.files[0]
    if (file) handleFile(file)
  }, [handleFile])

  const handleFileInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (file) handleFile(file)
  }

  const handleSubmit = async () => {
    if (!content.trim() || !name.trim()) return

    setStep('processing')
    setError('')

    const docId = nanoid()
    const doc: DLDocument = {
      id: docId,
      name,
      doc_type: docType,
      content,
      uploaded_at: new Date().toISOString(),
      status: 'processing',
    }
    saveDocument(doc)

    try {
      const res = await fetch('/api/extract', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content, doc_type: docType, doc_name: name }),
      })

      if (!res.ok) throw new Error('Extraction failed')

      const data = await res.json()
      const rawDecisions = data.decisions ?? []

      type RawDecision = {
        statement: string; topic_cluster: string; decision_type: DecisionType
        decided_at: string; decided_by?: string[]; source_locator?: string
        source_excerpt: string; rationale?: string; confidence: number
      }
      const decisions: Decision[] = rawDecisions
        .filter((d: RawDecision) => d.confidence >= 0.6)
        .map((d: RawDecision) => ({
          id: nanoid(),
          statement: d.statement,
          topic_cluster: d.topic_cluster,
          decision_type: d.decision_type,
          status: 'active' as const,
          decided_at: d.decided_at,
          decided_by: d.decided_by ?? [],
          source_doc_id: docId,
          source_locator: d.source_locator,
          source_excerpt: d.source_excerpt,
          rationale: d.rationale,
          confidence: d.confidence,
        }))

      saveDecisions(decisions)
      setExtractedDecisions(decisions)

      // Run conflict detection on all decisions
      const allDecisions = getDecisions()
      const conflicts = detectConflicts(allDecisions)
      const updated = applyConflictStatuses(allDecisions, conflicts)

      saveDecisions(updated)
      saveConflicts(conflicts)
      setConflictCount(conflicts.length)

      doc.status = 'done'
      saveDocument(doc)
      setStep('done')
      onSuccess?.()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error')
      doc.status = 'failed'
      saveDocument(doc)
      setStep('error')
    }
  }

  if (step === 'processing' || step === 'done') {
    return (
      <div className="space-y-4">
        <ExtractionStream
          isLoading={step === 'processing'}
          decisions={extractedDecisions}
          conflictCount={conflictCount}
          error={undefined}
        />
        {step === 'done' && (
          <div className="flex items-center gap-3 pt-2">
            <Button onClick={() => router.push('/ledger')} className="bg-orange-600 hover:bg-orange-700">
              View Timeline
            </Button>
            <Button variant="outline" onClick={() => {
              setStep('idle')
              setContent('')
              setName('')
              setConflictCount(0)
              setExtractedDecisions([])
            }}>
              Add Another
            </Button>
          </div>
        )}
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {/* Drag-drop zone */}
      <div
        onDrop={e => { dragCounterRef.current = 0; handleDrop(e) }}
        onDragEnter={() => { dragCounterRef.current++; setDragOver(true) }}
        onDragOver={e => e.preventDefault()}
        onDragLeave={() => { dragCounterRef.current--; if (dragCounterRef.current === 0) setDragOver(false) }}
        className={[
          'rounded-xl border-2 border-dashed p-8 text-center transition-colors',
          dragOver ? 'border-orange-400 bg-orange-50 dark:bg-orange-950/30' : 'border-border hover:border-orange-300 hover:bg-muted/40',
          content ? 'border-orange-400 bg-orange-50/50 dark:bg-orange-950/20 dark:border-orange-500' : '',
        ].join(' ')}
      >
        {content ? (
          <div className="flex items-center justify-center gap-2 text-sm text-orange-700 dark:text-orange-400">
            <FileText className="h-4 w-4" />
            <span>{content.length.toLocaleString()} characters ready to process</span>
          </div>
        ) : (
          <>
            <Upload className="mx-auto h-8 w-8 text-muted-foreground mb-2" />
            <p className="text-sm text-muted-foreground">
              Drop a .txt file here or{' '}
              <label className="cursor-pointer text-orange-600 hover:underline">
                browse
                <input type="file" className="hidden" accept=".txt,.md" onChange={handleFileInput} />
              </label>
            </p>
          </>
        )}
      </div>

      {/* Or paste text */}
      <div>
        <div className="mb-1 text-xs font-medium text-muted-foreground uppercase tracking-wide">
          Or paste text directly
        </div>
        <Textarea
          placeholder="Paste meeting transcript, ADR, Slack thread, PR description..."
          value={content}
          onChange={e => setContent(e.target.value)}
          className="min-h-[120px] font-mono text-xs"
        />
      </div>

      {/* Metadata */}
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <label className="mb-1 block text-xs font-medium text-muted-foreground">Document name</label>
          <input
            type="text"
            placeholder="e.g. Q1 Architecture Review"
            value={name}
            onChange={e => setName(e.target.value)}
            className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
          />
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-muted-foreground">Document type</label>
          <div className="relative">
            <select
              value={docType}
              onChange={e => setDocType(e.target.value as DocType)}
              className="flex h-9 w-full appearance-none rounded-md border border-input bg-transparent px-3 py-1 pr-8 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
            >
              {DOC_TYPES.map(t => (
                <option key={t.value} value={t.value}>{t.label}</option>
              ))}
            </select>
            <ChevronDown className="pointer-events-none absolute right-2 top-2.5 h-4 w-4 text-muted-foreground" />
          </div>
        </div>
      </div>

      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      )}

      <Button
        onClick={handleSubmit}
        disabled={!content.trim() || !name.trim()}
        className="w-full bg-orange-600 hover:bg-orange-700"
      >
        Extract Decisions
      </Button>
    </div>
  )
}
