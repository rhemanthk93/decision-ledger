"use client"

import { useState, useCallback } from 'react'
import {
  Loader2, Zap, Check, AlertCircle, ChevronDown, ChevronUp,
  Database, Cpu, GitMerge, Shield, MessageSquare, HardDrive, Folder,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { detectConflicts, applyConflictStatuses } from '@/features/ledger/lib/conflict-detection'
import type { Decision, Conflict, DLDocument, DecisionStatus } from '@/lib/types'

type StageStatus = 'idle' | 'running' | 'done' | 'error'

interface Stage {
  id:       string
  status:   StageStatus
  detail?:  string
  folders?: { name: string; count: number }[]
}

interface AgentMeta {
  id:       string
  name:     string
  model:    string
  icon:     React.ElementType
  iconCls:  string
  layer:    'bronze' | 'silver' | 'gold' | 'storage'
  parallel: boolean
}

const AGENTS: AgentMeta[] = [
  { id: 'fetch',   name: 'Ingestor',  model: 'File System · demo_data/',   icon: Database,      iconCls: 'text-amber-500',   layer: 'bronze',  parallel: false },
  { id: 'extract', name: 'Extractor', model: 'Claude Haiku 4.5',           icon: Cpu,           iconCls: 'text-blue-500',    layer: 'silver',  parallel: true  },
  { id: 'cluster', name: 'Resolver',  model: 'topic_cluster · TypeScript', icon: GitMerge,      iconCls: 'text-violet-500',  layer: 'silver',  parallel: false },
  { id: 'detect',  name: 'Detector',  model: 'Conflict Detection · TS',    icon: Shield,        iconCls: 'text-rose-500',    layer: 'gold',    parallel: false },
  { id: 'narrate', name: 'Narrator',  model: 'Claude Sonnet 4.6',          icon: MessageSquare, iconCls: 'text-emerald-500', layer: 'gold',    parallel: true  },
  { id: 'store',   name: 'Writer',    model: 'localStorage',               icon: HardDrive,     iconCls: 'text-slate-400',   layer: 'storage', parallel: false },
]

const LAYER_BADGE: Record<AgentMeta['layer'], string> = {
  bronze:  'bg-amber-50 dark:bg-amber-950/20 text-amber-700 dark:text-amber-400 border border-amber-200 dark:border-amber-800',
  silver:  'bg-sky-50 dark:bg-sky-950/20 text-sky-700 dark:text-sky-400 border border-sky-200 dark:border-sky-800',
  gold:    'bg-violet-50 dark:bg-violet-950/20 text-violet-700 dark:text-violet-400 border border-violet-200 dark:border-violet-800',
  storage: 'bg-slate-100 dark:bg-slate-800/40 text-slate-600 dark:text-slate-400 border border-slate-200 dark:border-slate-700',
}

const INITIAL_STAGES: Stage[] = AGENTS.map(a => ({ id: a.id, status: 'idle' }))

interface PipelineResult {
  docs:      number
  decisions: number
  clusters:  number
  conflicts: number
  narrated:  number
}

interface PipelineRunnerProps {
  onComplete: () => void
}

export default function PipelineRunner({ onComplete }: PipelineRunnerProps) {
  const [open,    setOpen]    = useState(true)
  const [running, setRunning] = useState(false)
  const [stages,  setStages]  = useState<Stage[]>(INITIAL_STAGES)
  const [result,  setResult]  = useState<PipelineResult | null>(null)
  const [error,   setError]   = useState<string | null>(null)

  const patch = useCallback((id: string, update: Partial<Stage>) =>
    setStages(prev => prev.map(s => s.id === id ? { ...s, ...update } : s))
  , [])

  const run = useCallback(async () => {
    setRunning(true)
    setResult(null)
    setError(null)
    setStages(INITIAL_STAGES)

    try {
      patch('fetch', { status: 'running', detail: 'Scanning demo_data/ folders...' })

      const filesRes = await fetch('/api/demo-files')
      if (!filesRes.ok) throw new Error(`demo-files: ${filesRes.statusText}`)
      const { documents: rawDocs, count, folders } = await filesRes.json()

      const dlDocs: DLDocument[] = rawDocs.map((d: {
        id: string; name: string; doc_type: DLDocument['doc_type']; content: string; uploaded_at: string
      }) => ({
        id: d.id, name: d.name, doc_type: d.doc_type,
        content: d.content, uploaded_at: d.uploaded_at, status: 'done' as const,
      }))
      localStorage.setItem('dl_documents', JSON.stringify(dlDocs))
      patch('fetch', { status: 'done', detail: `${count} documents ingested`, folders })

      patch('extract', { status: 'running', detail: `Sending ${count} docs in parallel...` })
      const extractRes = await fetch('/api/pipeline/extract-batch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ documents: rawDocs }),
      })
      if (!extractRes.ok) throw new Error(`extract-batch: ${extractRes.statusText}`)
      const { results: extractResults, errors: extractErrors, total_decisions } = await extractRes.json()

      const allDecisions: Decision[] = extractResults.flatMap(
        (r: { decisions: Decision[] }) => r.decisions
      )
      const errCount = extractErrors?.length ?? 0
      patch('extract', {
        status: 'done',
        detail: `${total_decisions} decisions extracted${errCount ? ` (${errCount} errors)` : ''}`,
      })

      patch('cluster', { status: 'running', detail: 'Grouping by topic cluster...' })
      const clusters = Array.from(new Set(allDecisions.map(d => d.topic_cluster)))
      patch('cluster', {
        status: 'done',
        detail: `${clusters.length} clusters — ${clusters.slice(0, 3).join(', ')}${clusters.length > 3 ? '…' : ''}`,
      })

      patch('detect', { status: 'running', detail: 'Walking decision pairs...' })
      const baseDecisions: Decision[] = allDecisions.map(d => ({ ...d, status: 'active' as DecisionStatus }))
      const rawConflicts: Conflict[]   = detectConflicts(baseDecisions)
      const decisionsWithStatus        = applyConflictStatuses(baseDecisions, rawConflicts)
      patch('detect', {
        status: 'done',
        detail: `${rawConflicts.length} conflicts across ${clusters.length} clusters`,
      })

      patch('narrate', { status: 'running', detail: `Sending ${rawConflicts.length} conflicts in parallel...` })
      const decisionsMap = new Map(decisionsWithStatus.map(d => [d.id, d]))
      const narrateItems = rawConflicts
        .map(c => ({
          conflict: c,
          earlier:  decisionsMap.get(c.earlier_decision_id),
          later:    decisionsMap.get(c.later_decision_id),
        }))
        .filter((item): item is { conflict: Conflict; earlier: Decision; later: Decision } =>
          !!item.earlier && !!item.later
        )

      let narratedConflicts: Conflict[] = [...rawConflicts]
      if (narrateItems.length > 0) {
        const narrateRes = await fetch('/api/pipeline/narrate-batch', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ items: narrateItems }),
        })
        if (!narrateRes.ok) throw new Error(`narrate-batch: ${narrateRes.statusText}`)
        const { narrations } = await narrateRes.json()
        const narrationMap = new Map<string, string>(
          narrations.map((n: { conflict_id: string; narration: string }) => [n.conflict_id, n.narration])
        )
        narratedConflicts = rawConflicts.map(c => ({
          ...c,
          narration: narrationMap.get(c.id),
        }))
      }
      patch('narrate', { status: 'done', detail: `${narrateItems.length} conflicts narrated` })

      patch('store', { status: 'running', detail: 'Writing to localStorage...' })
      localStorage.setItem('dl_decisions', JSON.stringify(decisionsWithStatus))
      localStorage.setItem('dl_conflicts', JSON.stringify(narratedConflicts))
      patch('store', {
        status: 'done',
        detail: `${decisionsWithStatus.length} decisions · ${narratedConflicts.length} conflicts persisted`,
      })

      setResult({
        docs:      count,
        decisions: decisionsWithStatus.length,
        clusters:  clusters.length,
        conflicts: rawConflicts.length,
        narrated:  narrateItems.length,
      })
      onComplete()
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      setError(msg)
      setStages(prev =>
        prev.map(s => s.status === 'running' ? { ...s, status: 'error', detail: msg } : s)
      )
    } finally {
      setRunning(false)
    }
  }, [patch, onComplete])

  const isDone  = result !== null
  const stageMap = new Map(stages.map(s => [s.id, s]))

  return (
    <div className="rounded-xl border border-border bg-card overflow-hidden">
      {/* Header */}
      <button
        onClick={() => setOpen(v => !v)}
        className="w-full flex items-center justify-between px-4 py-3 text-sm hover:bg-muted/50 transition-colors"
      >
        <span className="flex items-center gap-2 font-medium">
          <Zap className="h-4 w-4 text-orange-500" />
          Pipeline
          {isDone && (
            <span className="text-[10px] font-mono bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-400 border border-emerald-200 dark:border-emerald-800 rounded px-1.5 py-0.5">
              {result.docs} docs → {result.decisions} decisions → {result.conflicts} conflicts
            </span>
          )}
        </span>
        {open
          ? <ChevronUp className="h-3.5 w-3.5 text-muted-foreground" />
          : <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
        }
      </button>

      {open && (
        <div className="border-t border-border px-3 pt-3 pb-4">
          {/* Agent flow */}
          {AGENTS.map((agent, i) => {
            const Icon    = agent.icon
            const state   = stageMap.get(agent.id) ?? { id: agent.id, status: 'idle' as StageStatus }
            const isLast  = i === AGENTS.length - 1

            const nodeClass =
              state.status === 'idle'    ? 'border-border bg-card' :
              state.status === 'running' ? 'border-blue-500 bg-blue-50/50 dark:bg-blue-950/30 shadow-sm shadow-blue-500/20' :
              state.status === 'done'    ? 'border-emerald-500 bg-emerald-50/50 dark:bg-emerald-950/30' :
                                          'border-red-500 bg-red-50/50 dark:bg-red-950/30'

            const cardClass =
              state.status === 'idle'    ? 'border-border/50 bg-transparent' :
              state.status === 'running' ? 'border-blue-200 dark:border-blue-800/60 bg-blue-50/40 dark:bg-blue-950/20' :
              state.status === 'done'    ? 'border-emerald-200 dark:border-emerald-800/60 bg-emerald-50/20 dark:bg-emerald-950/10' :
                                          'border-red-200 dark:border-red-800/60 bg-red-50/20 dark:bg-red-950/10'

            const statusColor =
              state.status === 'idle'    ? 'text-muted-foreground/30' :
              state.status === 'running' ? 'text-blue-500' :
              state.status === 'done'    ? 'text-emerald-600 dark:text-emerald-400' :
                                          'text-red-500'

            return (
              <div key={agent.id} className="flex gap-2">
                {/* Left: node + connector */}
                <div className="flex flex-col items-center w-7 shrink-0">
                  <div className={`w-6 h-6 rounded-full border-2 flex items-center justify-center shrink-0 mt-2 z-10 ${nodeClass}`}>
                    {state.status === 'idle'    && <Icon className={`h-2.5 w-2.5 ${agent.iconCls} opacity-30`} />}
                    {state.status === 'running' && <Loader2 className="h-2.5 w-2.5 animate-spin text-blue-500" />}
                    {state.status === 'done'    && <Check className="h-2.5 w-2.5 text-emerald-500" />}
                    {state.status === 'error'   && <AlertCircle className="h-2.5 w-2.5 text-red-500" />}
                  </div>
                  {!isLast && <div className="w-px flex-1 bg-border/60 my-1" />}
                </div>

                {/* Right: agent card */}
                <div className={`flex-1 mb-1.5 rounded-lg border p-2.5 ${cardClass}`}>
                  {/* Header row */}
                  <div className="flex items-center justify-between gap-1 flex-wrap">
                    <div className="flex items-center gap-1.5 min-w-0">
                      <Icon className={`h-3 w-3 shrink-0 ${agent.iconCls} ${state.status === 'idle' ? 'opacity-30' : ''}`} />
                      <span className={`text-xs font-semibold tracking-tight ${state.status === 'idle' ? 'text-muted-foreground/50' : 'text-foreground'}`}>
                        {agent.name}
                      </span>
                      <span className={`text-[9px] font-mono rounded px-1 py-px leading-none uppercase tracking-wide ${LAYER_BADGE[agent.layer]}`}>
                        {agent.layer}
                      </span>
                      {agent.parallel && state.status !== 'idle' && (
                        <span className="text-[9px] font-mono rounded px-1 py-px leading-none bg-orange-50 dark:bg-orange-950/20 text-orange-600 dark:text-orange-400 border border-orange-200 dark:border-orange-800">
                          parallel
                        </span>
                      )}
                    </div>
                    <span className={`text-[9px] font-mono flex items-center gap-0.5 shrink-0 ${statusColor}`}>
                      {state.status === 'running' && <Loader2 className="h-2 w-2 animate-spin mr-0.5" />}
                      {state.status === 'done'    && <Check className="h-2 w-2 mr-0.5" />}
                      {state.status === 'error'   && <AlertCircle className="h-2 w-2 mr-0.5" />}
                      {state.status}
                    </span>
                  </div>

                  {/* Model */}
                  <div className={`text-[10px] font-mono mt-0.5 ${state.status === 'idle' ? 'text-muted-foreground/30' : 'text-muted-foreground/60'}`}>
                    {agent.model}
                  </div>

                  {/* Detail */}
                  {state.detail && (
                    <div className="text-[10px] text-muted-foreground mt-1 leading-snug">
                      {state.detail}
                    </div>
                  )}

                  {/* Folder chips (Ingestor only) */}
                  {agent.id === 'fetch' && state.folders && state.folders.length > 0 && (
                    <div className="mt-1.5 flex flex-wrap gap-1">
                      {state.folders.map(f => (
                        <span
                          key={f.name}
                          className="inline-flex items-center gap-0.5 text-[9px] font-mono bg-amber-50 dark:bg-amber-950/20 text-amber-700 dark:text-amber-400 border border-amber-200 dark:border-amber-800 rounded px-1.5 py-0.5"
                        >
                          <Folder className="h-2 w-2 shrink-0" />
                          {f.name}
                          <span className="opacity-60 ml-0.5">{f.count}</span>
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            )
          })}

          {/* Error */}
          {error && (
            <p className="mt-1 text-xs text-red-600 dark:text-red-400 font-mono bg-red-50 dark:bg-red-950/20 rounded p-2">
              {error}
            </p>
          )}

          {/* Run button */}
          <div className="mt-2">
            <Button
              onClick={run}
              disabled={running}
              size="sm"
              className={`w-full gap-2 ${isDone ? 'bg-muted text-foreground hover:bg-muted/80 border border-border' : 'bg-orange-600 hover:bg-orange-700 text-white'}`}
            >
              {running
                ? <><Loader2 className="h-3.5 w-3.5 animate-spin" />Running pipeline...</>
                : isDone
                  ? <><Zap className="h-3.5 w-3.5" />Re-run pipeline</>
                  : <><Zap className="h-3.5 w-3.5" />Run pipeline</>
              }
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}
