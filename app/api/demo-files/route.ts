/**
 * Stage 1 — Arrival (Bronze Layer)
 *
 * Serves the raw demo_data/ files as normalized RawDocument objects.
 * In production this becomes a Supabase insert to the `documents` table.
 */
import { NextResponse } from 'next/server'
import { readFile, readdir } from 'fs/promises'
import path from 'path'
import type { DocType } from '@/lib/types'

const DEMO_DATA_DIR = path.join(process.cwd(), 'demo_data')

const DIR_TO_DOC_TYPE: Record<string, DocType> = {
  adr:     'adr',
  meeting: 'transcript',
  pr:      'pr',
  slack:   'slack',
  spec:    'memo',
}

function friendlyName(dir: string, filename: string): string {
  const base = filename.replace(/\.[^.]+$/, '')

  // ADR pattern: adr-0042-primary-datastore-postgres
  const adrMatch = base.match(/^(adr-\d+)[-–](.+)$/i)
  if (adrMatch) {
    const num = adrMatch[1].toUpperCase().replace('-', '-')
    const rest = adrMatch[2].replace(/-/g, ' ')
    return `${num}: ${rest.replace(/\b\w/g, c => c.toUpperCase())}`
  }

  // PR pattern: pr_847_user_events_mongodb_migration
  const prMatch = base.match(/^pr_(\d+)_(.+)$/)
  if (prMatch) {
    return `PR #${prMatch[1]} — ${prMatch[2].replace(/_/g, ' ')}`
  }

  // Date-suffixed pattern: q1_arch_review_2026-03-15 or backend_guild_2026-04-08
  const dateMatch = base.match(/^(.+?)_(\d{4}-\d{2}-\d{2})$/)
  if (dateMatch) {
    const label = dateMatch[1].replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())
    return `${label} (${dateMatch[2]})`
  }

  // incident_retro_2026-07-20
  const retro = base.match(/^(.+)_(\d{4}-\d{2}-\d{2})$/)
  if (retro) {
    return retro[1].replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())
  }

  return base.replace(/[_-]/g, ' ').replace(/\b\w/g, c => c.toUpperCase())
}

function docDate(content: string, filename: string): string {
  // Try to extract date from content
  const dateMatch = content.match(/Date:\s*(\d{4}-\d{2}-\d{2})|(\d{4}-\d{2}-\d{2})/)
  if (dateMatch) return (dateMatch[1] ?? dateMatch[2]) + 'T00:00:00Z'

  // Fall back to date in filename
  const fnDate = filename.match(/(\d{4}-\d{2}-\d{2})/)
  if (fnDate) return fnDate[1] + 'T00:00:00Z'

  return new Date().toISOString()
}

export async function GET() {
  try {
    const entries = await readdir(DEMO_DATA_DIR, { withFileTypes: true })
    const dirs = entries
      .filter(e => e.isDirectory() && !e.name.startsWith('.'))
      .map(e => e.name)
      .sort()

    const documents = []
    const folders: { name: string; count: number }[] = []

    for (const dir of dirs) {
      const dirPath = path.join(DEMO_DATA_DIR, dir)
      const files = (await readdir(dirPath)).filter(f => !f.startsWith('.'))

      folders.push({ name: dir, count: files.length })

      for (const file of files) {
        const filePath = path.join(dirPath, file)
        const content = await readFile(filePath, 'utf-8')
        const doc_type = DIR_TO_DOC_TYPE[dir] ?? 'memo'
        const id = `raw-${dir}-${file.replace(/\.[^.]+$/, '').replace(/[^a-z0-9]/gi, '-')}`

        documents.push({
          id,
          filename: file,
          name: friendlyName(dir, file),
          doc_type,
          content,
          uploaded_at: docDate(content, file),
          source_dir: dir,
          ingested_at: new Date().toISOString(),
        })
      }
    }

    documents.sort((a, b) => a.uploaded_at.localeCompare(b.uploaded_at))

    return NextResponse.json({ documents, count: documents.length, folders })
  } catch (error) {
    console.error('[demo-files] Error:', error)
    return NextResponse.json({ error: 'Failed to load demo files' }, { status: 500 })
  }
}
