"use client"

import { useState, useEffect, useCallback, useDeferredValue, useMemo, useRef } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  Plus, Search, ChevronDown, ChevronUp,
  FileText, LayoutList, Clock, Loader2, Sparkles, RotateCcw, Copy, Check, CheckCircle2, X, Zap,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Tooltip, TooltipTrigger, TooltipContent, TooltipProvider,
} from '@/components/ui/tooltip'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs'
import DecisionTimeline from './DecisionTimeline'
import QueryBar from './QueryBar'
import ConflictCards from './ConflictCards'
import DocumentUpload from '@/features/ingest/components/DocumentUpload'
import PipelineRunner from '@/features/pipeline/components/PipelineRunner'
import type { Decision, Conflict, DecisionStatus, DLDocument } from '@/lib/types'
import {
  getDecisions,
  getConflicts,
  saveConflicts,
  saveDecisions,
  updateConflictNarration,
  clearAll,
} from '../lib/storage'
import { detectConflicts, applyConflictStatuses } from '../lib/conflict-detection'
import { formatDate, statusLabel, docTypeLabel, conflictTypeLabel } from '../lib/formatters'
import { getDocuments } from '@/features/ingest/lib/storage'
import { seedDemoData, LIVE_DEMO_DOCUMENT } from '@/lib/demo-data'
import { cn } from '@/lib/utils'

const TOPIC_COLORS = [
  { dot: 'bg-violet-500', text: 'text-violet-600 dark:text-violet-400', chip: 'bg-violet-50 dark:bg-violet-950/30 text-violet-700 dark:text-violet-300 border-violet-200 dark:border-violet-800' },
  { dot: 'bg-sky-500',    text: 'text-sky-600 dark:text-sky-400',       chip: 'bg-sky-50 dark:bg-sky-950/30 text-sky-700 dark:text-sky-300 border-sky-200 dark:border-sky-800' },
  { dot: 'bg-amber-500',  text: 'text-amber-600 dark:text-amber-400',   chip: 'bg-amber-50 dark:bg-amber-950/30 text-amber-700 dark:text-amber-300 border-amber-200 dark:border-amber-800' },
  { dot: 'bg-rose-500',   text: 'text-rose-600 dark:text-rose-400',     chip: 'bg-rose-50 dark:bg-rose-950/30 text-rose-700 dark:text-rose-300 border-rose-200 dark:border-rose-800' },
  { dot: 'bg-teal-500',   text: 'text-teal-600 dark:text-teal-400',     chip: 'bg-teal-50 dark:bg-teal-950/30 text-teal-700 dark:text-teal-300 border-teal-200 dark:border-teal-800' },
  { dot: 'bg-fuchsia-500',text: 'text-fuchsia-600 dark:text-fuchsia-400', chip: 'bg-fuchsia-50 dark:bg-fuchsia-950/30 text-fuchsia-700 dark:text-fuchsia-300 border-fuchsia-200 dark:border-fuchsia-800' },
  { dot: 'bg-lime-500',   text: 'text-lime-600 dark:text-lime-400',     chip: 'bg-lime-50 dark:bg-lime-950/30 text-lime-700 dark:text-lime-300 border-lime-200 dark:border-lime-800' },
]

const STATUS_ACCENT: Record<DecisionStatus, string> = {
  active:       'bg-emerald-500',
  reversed:     'bg-amber-500',
  contradicted: 'bg-red-500',
  superseded:   'bg-muted-foreground/30',
}

const STATUS_BADGE: Record<DecisionStatus, string> = {
  active:       'bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-400 border-emerald-200 dark:border-emerald-800',
  reversed:     'bg-amber-50 dark:bg-amber-950/40 text-amber-700 dark:text-amber-400 border-amber-200 dark:border-amber-800',
  contradicted: 'bg-red-50 dark:bg-red-950/40 text-red-700 dark:text-red-400 border-red-200 dark:border-red-800',
  superseded:   'bg-muted text-muted-foreground border-border',
}

const STATUS_FILTERS: { value: 'all' | DecisionStatus; label: string }[] = [
  { value: 'all',          label: 'All' },
  { value: 'active',       label: 'Active' },
  { value: 'reversed',     label: 'Reversed' },
  { value: 'contradicted', label: 'Contradicted' },
  { value: 'superseded',   label: 'Superseded' },
]

export default function LedgerContent() {
  const [decisions, setDecisions]   = useState<Decision[]>([])
  const [conflicts, setConflicts]   = useState<Conflict[]>([])
  const [documents, setDocuments]   = useState<DLDocument[]>([])
  const [activeTab, setActiveTab]   = useState<'timeline'|'decisions'|'conflicts'>('timeline')
  const [filterStatus, setFilterStatus] = useState<'all' | DecisionStatus>('all')
  const [filterTopic, setFilterTopic]   = useState('all')
  const [filterText, setFilterText]     = useState('')
  const [dateRange, setDateRange]       = useState<'30d'|'90d'|'all'>('all')
  const [groupBy, setGroupBy]           = useState<'date'|'topic'>('date')
  const [expandedDecisionId, setExpandedDecisionId]   = useState<string | null>(null)
  const [highlightedDecisionId, setHighlightedDecisionId] = useState<string | null>(null)
  const [chatOpen, setChatOpen]         = useState(false)
  const [inlineNarratingId, setInlineNarratingId] = useState<string | null>(null)
  const [inlineStreamText, setInlineStreamText]   = useState('')
  const [showUpload, setShowUpload]     = useState(false)
  const [seeded, setSeeded]             = useState(false)
  const [copied, setCopied]             = useState(false)
  const [showPipeline, setShowPipeline] = useState(false)

  const inlineNarrationAbort = useRef<AbortController | null>(null)
  const highlightRef = useRef<HTMLDivElement | null>(null)
  const deferredFilterText = useDeferredValue(filterText)

  const load = useCallback(() => {
    let decs = getDecisions()
    const storedConflicts = getConflicts()
    const docs = getDocuments()
    setDocuments(docs)

    if (decs.length === 0) {
      seedDemoData()
      decs = getDecisions()
      setSeeded(true)
    }

    if (decs.length > 0) {
      const storedByPair = new Map(
        storedConflicts.map(c => [
          `${c.earlier_decision_id}::${c.later_decision_id}`,
          c,
        ])
      )
      const freshConflicts = detectConflicts(decs)
      const conflictsWithData = freshConflicts.map(c => {
        const stored = storedByPair.get(`${c.earlier_decision_id}::${c.later_decision_id}`)
        return stored ? { ...c, narration: stored.narration, resolved: stored.resolved } : c
      })
      const activeConflicts = conflictsWithData.filter(c => !c.resolved)
      const resetDecs = decs.map(d => ({ ...d, status: 'active' as DecisionStatus }))
      const updated = applyConflictStatuses(resetDecs, activeConflicts)
      setDecisions(updated)
      setConflicts(conflictsWithData)
      saveDecisions(updated)
      saveConflicts(conflictsWithData)
    } else {
      setDecisions(decs)
      setConflicts(storedConflicts)
    }
  }, [])

  useEffect(() => {
    const frame = requestAnimationFrame(load)
    return () => cancelAnimationFrame(frame)
  }, [load])

  // Scroll highlighted card into view
  useEffect(() => {
    if (!highlightedDecisionId) return
    const t = setTimeout(() => {
      highlightRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' })
    }, 80)
    const clear = setTimeout(() => setHighlightedDecisionId(null), 2200)
    return () => { clearTimeout(t); clearTimeout(clear) }
  }, [highlightedDecisionId])

  const topics = useMemo(
    () => Array.from(new Set(decisions.map(d => d.topic_cluster))).sort(),
    [decisions]
  )

  const decisionsById = useMemo(
    () => new Map(decisions.map(decision => [decision.id, decision])),
    [decisions]
  )

  const conflictsById = useMemo(
    () => new Map(conflicts.map(conflict => [conflict.id, conflict])),
    [conflicts]
  )

  const documentsById = useMemo(
    () => new Map(documents.map(document => [document.id, document])),
    [documents]
  )

  const primaryConflictByDecisionId = useMemo(() => {
    const map = new Map<string, Conflict>()

    const getConflictTime = (conflict: Conflict) =>
      +new Date(decisionsById.get(conflict.later_decision_id)?.decided_at ?? 0)

    const assignConflict = (decisionId: string, conflict: Conflict) => {
      const current = map.get(decisionId)
      if (!current || getConflictTime(conflict) >= getConflictTime(current)) {
        map.set(decisionId, conflict)
      }
    }

    conflicts.forEach(conflict => {
      assignConflict(conflict.earlier_decision_id, conflict)
      assignConflict(conflict.later_decision_id, conflict)
    })

    return map
  }, [conflicts, decisionsById])

  const topicColorOf = (topic: string) => TOPIC_COLORS[topics.indexOf(topic) % TOPIC_COLORS.length] ?? TOPIC_COLORS[0]

  const dateFilteredDecisions = useMemo(() => {
    if (dateRange === 'all') return decisions
    const cutoff = new Date()
    cutoff.setDate(cutoff.getDate() - (dateRange === '30d' ? 30 : 90))
    return decisions.filter(d => new Date(d.decided_at) >= cutoff)
  }, [decisions, dateRange])

  const filteredDecisions = useMemo(() => {
    return [...dateFilteredDecisions]
      .sort((a, b) => new Date(b.decided_at).getTime() - new Date(a.decided_at).getTime())
      .filter(d => {
        if (filterStatus !== 'all' && d.status !== filterStatus) return false
        if (filterTopic !== 'all' && d.topic_cluster !== filterTopic) return false
        if (deferredFilterText) {
          const q = deferredFilterText.toLowerCase().trim()
          return (
            d.statement.toLowerCase().includes(q) ||
            d.topic_cluster.toLowerCase().includes(q) ||
            d.decided_by.some(p => p.toLowerCase().includes(q))
          )
        }
        return true
      })
  }, [dateFilteredDecisions, deferredFilterText, filterStatus, filterTopic])

  const groupedDecisions = useMemo(() => {
    if (groupBy !== 'topic') return null
    const groups = new Map<string, Decision[]>()
    filteredDecisions.forEach(d => {
      if (!groups.has(d.topic_cluster)) groups.set(d.topic_cluster, [])
      groups.get(d.topic_cluster)!.push(d)
    })
    return groups
  }, [filteredDecisions, groupBy])

  const topicCounts = useMemo(() => {
    const m = new Map<string, number>()
    decisions.forEach(d => m.set(d.topic_cluster, (m.get(d.topic_cluster) ?? 0) + 1))
    return m
  }, [decisions])

  const handleConflictSelect = useCallback((conflictId: string) => {
    const c = conflictsById.get(conflictId)
    if (!c) return
    const targetId = c.later_decision_id
    setExpandedDecisionId(targetId)
    setHighlightedDecisionId(targetId)
    setActiveTab('decisions')
  }, [conflictsById])

  const handleInlineNarrate = async (conflict: Conflict, earlier: Decision, later: Decision) => {
    inlineNarrationAbort.current?.abort()
    inlineNarrationAbort.current = new AbortController()
    setInlineNarratingId(conflict.id)
    setInlineStreamText('')

    try {
      const res = await fetch('/api/narrate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ earlier, later, conflict_type: conflict.conflict_type }),
        signal: inlineNarrationAbort.current.signal,
      })
      if (!res.ok || !res.body) throw new Error('Failed')

      const reader  = res.body.getReader()
      const decoder = new TextDecoder()
      let full = ''

      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        const chunk = decoder.decode(value)
        full += chunk
        setInlineStreamText(prev => prev + chunk)
      }

      updateConflictNarration(conflict.id, full)
      setConflicts(prev => prev.map(c => c.id === conflict.id ? { ...c, narration: full } : c))
    } catch (err) {
      if ((err as Error).name !== 'AbortError') {
        setInlineStreamText('Analysis failed. Please try again.')
      }
    } finally {
      setInlineNarratingId(null)
    }
  }
  const handleResolveConflict = (conflictId: string) => {
    setConflicts(prev => {
      const next = prev.map(c => c.id === conflictId ? { ...c, resolved: true } : c)
      saveConflicts(next)
      const active = next.filter(c => !c.resolved)
      const resetDecs = decisions.map(d => ({ ...d, status: 'active' as DecisionStatus }))
      const updatedDecs = applyConflictStatuses(resetDecs, active)
      setDecisions(updatedDecs)
      saveDecisions(updatedDecs)
      return next
    })
  }

  const handleResetDemo = () => {
    clearAll()
    seedDemoData()
    setSeeded(true)
    load()
  }

  const handleCopyLiveDoc = async () => {
    await navigator.clipboard.writeText(LIVE_DEMO_DOCUMENT)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  const filterTopicColorDot = filterTopic !== 'all' ? topicColorOf(filterTopic).dot : ''

  const renderDecisionCard = (d: Decision, i: number) => {
    const isConflicted = d.status === 'contradicted' || d.status === 'reversed'
    const conflict = isConflicted ? primaryConflictByDecisionId.get(d.id) : undefined
    const isEarlier       = conflict?.earlier_decision_id === d.id
    const earlierDecision = conflict
      ? (isEarlier ? d : decisionsById.get(conflict.earlier_decision_id) ?? null)
      : null
    const laterDecision = conflict
      ? (isEarlier ? decisionsById.get(conflict.later_decision_id) ?? null : d)
      : null

    const isExpanded    = expandedDecisionId === d.id
    const isHighlighted = highlightedDecisionId === d.id
    const sourceDoc     = documentsById.get(d.source_doc_id)
    const tc            = topicColorOf(d.topic_cluster)

    const displayNarration = conflict && inlineNarratingId === conflict.id
      ? inlineStreamText
      : (conflict?.narration ?? '')
    const isNarrating = !!conflict && inlineNarratingId === conflict.id

    const conflictAccent = d.status === 'reversed'
      ? { border: 'border-amber-200/70 dark:border-amber-900/50', bg: 'bg-amber-50/25 dark:bg-amber-950/10', hover: 'hover:bg-amber-50/40 dark:hover:bg-amber-950/15' }
      : { border: 'border-red-200/70 dark:border-red-900/50',    bg: 'bg-red-50/25 dark:bg-red-950/10',    hover: 'hover:bg-red-50/40 dark:hover:bg-red-950/15' }

    return (
      <motion.div
        key={d.id}
        ref={isHighlighted ? highlightRef : undefined}
        initial={{ opacity: 0, y: 6 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: i * 0.025 }}
        className={cn(
          'relative rounded-r-xl border cursor-pointer overflow-hidden transition-all duration-200',
          isConflicted
            ? cn(conflictAccent.border, conflictAccent.bg, conflictAccent.hover)
            : isExpanded
              ? 'border-orange-200/60 dark:border-orange-800/40 bg-orange-50/15 dark:bg-orange-950/10'
              : 'border-border bg-card hover:border-border/60 hover:shadow-sm',
          isHighlighted && 'ring-2 ring-orange-400/50 ring-offset-1',
        )}
        onClick={() => setExpandedDecisionId(isExpanded ? null : d.id)}
      >
        {/* Status accent stripe */}
        <div className={cn('absolute left-0 inset-y-0 w-[3px]', STATUS_ACCENT[d.status])} />

        {/* Card body */}
        <div className="pl-5 pr-4 pt-3 pb-3">
          {/* Top row: topic chip + conflict badge + status + chevron */}
          <div className="flex items-center gap-2 mb-2 flex-wrap">
            <span className={cn('inline-flex items-center rounded-md border px-2 py-0.5 text-[11px] font-medium leading-none', tc.chip)}>
              {d.topic_cluster}
            </span>
            {isConflicted && (
              <span className={cn(
                'inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[10px] font-semibold leading-none',
                d.status === 'reversed'
                  ? 'bg-amber-50 dark:bg-amber-950/30 text-amber-700 dark:text-amber-400 border-amber-200 dark:border-amber-800'
                  : 'bg-red-50 dark:bg-red-950/30 text-red-600 dark:text-red-400 border-red-200 dark:border-red-800',
              )}>
                <span className="h-1 w-1 rounded-full bg-current animate-pulse" />
                Conflict
              </span>
            )}
            <div className="ml-auto flex items-center gap-1.5">
              <span className={cn('inline-flex items-center rounded-md border px-2 py-0.5 text-[11px] font-medium leading-none', STATUS_BADGE[d.status])}>
                {statusLabel(d.status)}
              </span>
              {isExpanded
                ? <ChevronUp className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                : <ChevronDown className="h-3.5 w-3.5 text-muted-foreground shrink-0" />}
            </div>
          </div>

          {/* Statement */}
          <p className="text-sm font-medium text-foreground leading-snug line-clamp-2 mb-2">
            {d.statement}
          </p>

          {/* Metadata row */}
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
            <span className="tabular-nums">{formatDate(d.decided_at)}</span>
            {d.decided_by.length > 0 && (
              <>
                <span className="text-border select-none">·</span>
                <span className="flex items-center gap-0.5">
                  {d.decided_by.slice(0, 3).map(name => (
                    <Tooltip key={name}>
                      <TooltipTrigger asChild>
                        <span className="inline-flex h-4 w-4 items-center justify-center rounded-full bg-muted border border-border text-[8px] font-bold text-muted-foreground cursor-default select-none">
                          {name.charAt(0).toUpperCase()}
                        </span>
                      </TooltipTrigger>
                      <TooltipContent side="top" className="text-xs">{name}</TooltipContent>
                    </Tooltip>
                  ))}
                  {d.decided_by.length > 3 && (
                    <span className="text-[10px] text-muted-foreground ml-0.5">+{d.decided_by.length - 3}</span>
                  )}
                </span>
              </>
            )}
            {d.source_excerpt && (
              <>
                <span className="text-border select-none">·</span>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <button
                      onClick={e => e.stopPropagation()}
                      className="inline-flex items-center gap-1 hover:text-foreground transition-colors max-w-[160px]"
                    >
                      <FileText className="h-3 w-3 shrink-0" />
                      <span className="truncate">{sourceDoc?.name ?? 'source'}</span>
                    </button>
                  </TooltipTrigger>
                  <TooltipContent side="top" className="max-w-xs text-xs italic">
                    {`"${d.source_excerpt.slice(0, 200)}${d.source_excerpt.length > 200 ? '…' : ''}"`}
                  </TooltipContent>
                </Tooltip>
              </>
            )}
          </div>
        </div>

        {/* Inline expansion */}
        <AnimatePresence>
          {isExpanded && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              exit={{ opacity: 0, height: 0 }}
              transition={{ duration: 0.2 }}
              className="overflow-hidden"
              onClick={e => e.stopPropagation()}
            >
              {isConflicted && conflict && earlierDecision && laterDecision ? (
                <div className="border-t border-border/40 px-5 pb-4 pt-3 space-y-3">
                  <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                    {conflictTypeLabel(conflict.conflict_type)}
                  </div>

                  <div className="grid grid-cols-2 gap-2">
                    {/* Earlier */}
                    <div className="rounded-lg border border-border/60 bg-card p-3 shadow-sm">
                      <div className="flex items-center gap-1.5 mb-1.5">
                        <span className="h-1.5 w-1.5 rounded-full bg-slate-400 shrink-0" />
                        <span className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">Earlier</span>
                        <span className="ml-auto text-[10px] text-muted-foreground/60 tabular-nums">{formatDate(earlierDecision.decided_at)}</span>
                      </div>
                      <p className="text-xs text-foreground leading-relaxed">{earlierDecision.statement}</p>
                      {earlierDecision.source_excerpt && (
                        <blockquote className="mt-2 text-[10px] italic text-muted-foreground border-l-2 border-slate-200 dark:border-slate-700 pl-2">
                          {`"${earlierDecision.source_excerpt.slice(0, 100)}…"`}
                        </blockquote>
                      )}
                    </div>

                    {/* Later */}
                    <div className={cn(
                      'rounded-lg border p-3 shadow-sm',
                      d.status === 'reversed'
                        ? 'border-amber-200/70 dark:border-amber-800/50 bg-amber-50/40 dark:bg-amber-950/15'
                        : 'border-red-200/70 dark:border-red-800/50 bg-red-50/40 dark:bg-red-950/15',
                    )}>
                      <div className="flex items-center gap-1.5 mb-1.5">
                        <span className={cn('h-1.5 w-1.5 rounded-full shrink-0', d.status === 'reversed' ? 'bg-amber-500' : 'bg-red-500')} />
                        <span className={cn('text-[10px] font-semibold uppercase tracking-widest', d.status === 'reversed' ? 'text-amber-600 dark:text-amber-400' : 'text-red-600 dark:text-red-400')}>Later</span>
                        <span className="ml-auto text-[10px] text-muted-foreground/60 tabular-nums">{formatDate(laterDecision.decided_at)}</span>
                      </div>
                      <p className="text-xs text-foreground leading-relaxed">{laterDecision.statement}</p>
                      {laterDecision.source_excerpt && (
                        <blockquote className={cn('mt-2 text-[10px] italic text-muted-foreground border-l-2 pl-2', d.status === 'reversed' ? 'border-amber-200 dark:border-amber-700' : 'border-red-200 dark:border-red-700')}>
                          {`"${laterDecision.source_excerpt.slice(0, 100)}…"`}
                        </blockquote>
                      )}
                    </div>
                  </div>

                  {/* Claude analysis */}
                  <div className="rounded-lg border border-border/50 bg-muted/30 p-3">
                    <div className="flex items-center justify-between mb-2">
                      <div className="flex items-center gap-1.5 text-xs font-medium text-foreground/70">
                        <Sparkles className="h-3.5 w-3.5 text-orange-500" />
                        Claude Analysis
                      </div>
                      <div className="flex items-center gap-1.5">
                        {!isNarrating && (
                          <button
                            onClick={() => handleInlineNarrate(conflict, earlierDecision, laterDecision)}
                            className="text-[11px] px-2.5 py-1 rounded-md border border-border text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
                          >
                            {displayNarration ? 'Re-analyze' : 'Analyze Conflict'}
                          </button>
                        )}
                        <button
                          onClick={() => handleResolveConflict(conflict.id)}
                          className="flex items-center gap-1 text-[11px] px-2.5 py-1 rounded-md border border-emerald-200 dark:border-emerald-800 text-emerald-700 dark:text-emerald-400 bg-emerald-50/80 hover:bg-emerald-100 dark:bg-emerald-950/20 transition-colors"
                        >
                          <CheckCircle2 className="h-3 w-3" />
                          Resolve
                        </button>
                      </div>
                    </div>
                    {isNarrating && !displayNarration && (
                      <div className="flex items-center gap-2 text-xs text-muted-foreground">
                        <Loader2 className="h-3 w-3 animate-spin" />
                        Analyzing…
                      </div>
                    )}
                    {displayNarration ? (
                      <p className="text-xs text-foreground leading-relaxed whitespace-pre-wrap">
                        {displayNarration}
                        {isNarrating && (
                          <span className="inline-block w-0.5 h-3 ml-0.5 bg-orange-500 animate-pulse align-middle" />
                        )}
                      </p>
                    ) : !isNarrating ? (
                      <p className="text-xs text-muted-foreground">
                        {'Click "Analyze Conflict" to get Claude\'s assessment.'}
                      </p>
                    ) : null}
                  </div>
                </div>
              ) : (
                <div className="border-t border-border/40 px-5 pb-4 pt-3 space-y-3">
                  {d.source_excerpt && (
                    <blockquote className="text-xs italic text-muted-foreground leading-relaxed border-l-2 border-orange-200 dark:border-orange-800 pl-3">
                      {`"${d.source_excerpt}"`}
                    </blockquote>
                  )}
                  {d.rationale && (
                    <div>
                      <span className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Rationale</span>
                      <p className="mt-0.5 text-xs text-muted-foreground">{d.rationale}</p>
                    </div>
                  )}
                  <div className="flex items-center gap-4 text-xs text-muted-foreground flex-wrap">
                    <span><span className="font-medium text-foreground/60">Type:</span> {d.decision_type}</span>
                    <span><span className="font-medium text-foreground/60">Confidence:</span> {Math.round(d.confidence * 100)}%</span>
                    {sourceDoc && (
                      <span><span className="font-medium text-foreground/60">Source:</span> {docTypeLabel(sourceDoc.doc_type)}</span>
                    )}
                  </div>
                  <div className="h-0.5 rounded-full bg-muted overflow-hidden">
                    <div
                      className={cn(
                        'h-full rounded-full transition-all duration-700',
                        d.confidence > 0.8 ? 'bg-emerald-500' : d.confidence > 0.6 ? 'bg-amber-500' : 'bg-red-500',
                      )}
                      style={{ width: `${d.confidence * 100}%` }}
                    />
                  </div>
                </div>
              )}
            </motion.div>
          )}
        </AnimatePresence>
      </motion.div>
    )
  }

  const renderDecisionList = () => {
    if (filteredDecisions.length === 0) {
      return (
        <div className="rounded-xl border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
          No decisions match your filters.
        </div>
      )
    }

    if (groupBy === 'topic' && groupedDecisions) {
      return (
        <div className="space-y-6">
          {Array.from(groupedDecisions.entries()).map(([topic, decs]) => {
            const tc = topicColorOf(topic)
            return (
              <div key={topic}>
                <div className="flex items-center gap-2 mb-2">
                  <span className={cn('h-2 w-2 rounded-full shrink-0', tc.dot)} />
                  <span className={cn('text-xs font-semibold', tc.text)}>{topic}</span>
                  <span className="text-xs text-muted-foreground">({decs.length})</span>
                </div>
                <div className="space-y-2">
                  {decs.map((d, i) => renderDecisionCard(d, i))}
                </div>
              </div>
            )
          })}
        </div>
      )
    }

    return (
      <div className="space-y-2">
        {filteredDecisions.map((d, i) => renderDecisionCard(d, i))}
      </div>
    )
  }

  return (
    <TooltipProvider delayDuration={300}>
      <div className="mx-auto max-w-[1400px] px-4 md:px-6 py-8 pb-28">

        {/* Header */}
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4 }}
          className="mb-6 flex items-start justify-between gap-4"
        >
          <div>
            <h1 className="text-2xl font-bold tracking-tight">Decision Ledger</h1>
            <p className="text-sm text-muted-foreground mt-1">All extracted decisions by topic & time</p>
          </div>
          <div className="flex items-center gap-2 shrink-0 flex-wrap justify-end">
            {seeded && (
              <button
                onClick={handleResetDemo}
                className="flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-xs text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
              >
                <RotateCcw className="h-3 w-3" />
                Reset demo
              </button>
            )}
            {decisions.length > 0 && (
              <button
                onClick={handleCopyLiveDoc}
                className="flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-xs text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
              >
                {copied
                  ? <><Check className="h-3 w-3 text-green-600" /><span className="text-green-600">Copied!</span></>
                  : <><Copy className="h-3 w-3" />Copy live PR</>
                }
              </button>
            )}
            <button
              onClick={() => setShowPipeline(v => !v)}
              className="flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-xs text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
            >
              <Zap className="h-3 w-3" />
              Pipeline
            </button>
            <Button
              onClick={() => setShowUpload(v => !v)}
              className="gap-2 bg-orange-600 hover:bg-orange-700 h-8 px-3 text-xs"
            >
              {showUpload ? <X className="h-3.5 w-3.5" /> : <Plus className="h-3.5 w-3.5" />}
              {showUpload ? 'Close' : 'Add Document'}
            </Button>
          </div>
        </motion.div>

        {/* Pipeline panel */}
        <AnimatePresence>
          {showPipeline && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              exit={{ opacity: 0, height: 0 }}
              transition={{ duration: 0.2 }}
              className="overflow-hidden mb-6"
            >
              <PipelineRunner onComplete={load} />
            </motion.div>
          )}
        </AnimatePresence>

        {/* Upload panel */}
        <AnimatePresence>
          {showUpload && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              exit={{ opacity: 0, height: 0 }}
              transition={{ duration: 0.2 }}
              className="overflow-hidden mb-6"
            >
              <DocumentUpload onSuccess={() => { setShowUpload(false); load() }} />
            </motion.div>
          )}
        </AnimatePresence>

        {/* Empty state */}
        {decisions.length === 0 && (
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-border py-20 text-center"
          >
            <div className="text-4xl mb-4">📋</div>
            <h2 className="text-lg font-semibold text-foreground mb-2">No decisions yet</h2>
            <p className="text-sm text-muted-foreground mb-6 max-w-xs">
              Upload documents to automatically extract and track decisions
            </p>
            <Button onClick={() => setShowUpload(true)} className="gap-2 bg-orange-600 hover:bg-orange-700">
              <Plus className="h-4 w-4" />Add Your First Document
            </Button>
            <p className="mt-4 text-xs text-muted-foreground">
              Supports: Transcripts · ADRs · Slack exports · PRs · Memos
            </p>
          </motion.div>
        )}

        {decisions.length > 0 && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.1 }}
            className="flex gap-6"
          >
            {/* ─── Sidebar ─── */}
            <aside className="w-64 shrink-0 hidden lg:flex flex-col gap-4">

              {/* Status filter */}
              <div>
                <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mb-2">Status</div>
                <div className="flex flex-col gap-1">
                  {STATUS_FILTERS.map(f => (
                    <button
                      key={f.value}
                      onClick={() => setFilterStatus(f.value)}
                      className={cn(
                        'flex items-center justify-between rounded-lg px-3 py-1.5 text-xs font-medium transition-colors text-left',
                        filterStatus === f.value
                          ? 'bg-orange-600 text-white'
                          : 'text-muted-foreground hover:bg-muted hover:text-foreground',
                      )}
                    >
                      <span>{f.label}</span>
                      {filterStatus === f.value && <span className="h-1 w-1 rounded-full bg-white/70" />}
                    </button>
                  ))}
                </div>
              </div>

              {/* Topic filter */}
              {topics.length > 0 && (
                <div>
                  <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mb-2">Topic</div>
                  <div className="flex flex-col gap-1">
                    <button
                      onClick={() => setFilterTopic('all')}
                      className={cn(
                        'flex items-center gap-2 rounded-lg px-3 py-1.5 text-xs font-medium transition-colors text-left',
                        filterTopic === 'all' ? 'bg-muted text-foreground' : 'text-muted-foreground hover:bg-muted/50 hover:text-foreground',
                      )}
                    >
                      <span className="h-2 w-2 rounded-full bg-muted-foreground/40 shrink-0" />
                      <span>All topics</span>
                      <span className="ml-auto text-[10px] text-muted-foreground">({decisions.length})</span>
                    </button>
                    {topics.map(topic => {
                      const tc = topicColorOf(topic)
                      return (
                        <button
                          key={topic}
                          onClick={() => setFilterTopic(topic)}
                          className={cn(
                            'flex items-center gap-2 rounded-lg px-3 py-1.5 text-xs font-medium transition-colors text-left',
                            filterTopic === topic ? 'bg-muted text-foreground' : 'text-muted-foreground hover:bg-muted/50 hover:text-foreground',
                          )}
                        >
                          <span className={cn('h-2 w-2 rounded-full shrink-0', tc.dot)} />
                          <span className="truncate">{topic}</span>
                          <span className="ml-auto text-[10px] text-muted-foreground shrink-0">
                            ({topicCounts.get(topic) ?? 0})
                          </span>
                        </button>
                      )
                    })}
                  </div>
                </div>
              )}

              {/* Date range */}
              <div>
                <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mb-2">Date Range</div>
                <div className="flex gap-1">
                  {(['30d', '90d', 'all'] as const).map(r => (
                    <button
                      key={r}
                      onClick={() => setDateRange(r)}
                      className={cn(
                        'flex-1 rounded-lg border px-2 py-1 text-[11px] font-medium transition-colors',
                        dateRange === r
                          ? 'bg-orange-600 text-white border-orange-600'
                          : 'border-border text-muted-foreground hover:border-orange-300 hover:text-foreground bg-card',
                      )}
                    >
                      {r === 'all' ? 'All' : r}
                    </button>
                  ))}
                </div>
              </div>

              {/* Search */}
              <div className="relative">
                <Search className="absolute left-2.5 top-2 h-3.5 w-3.5 text-muted-foreground" />
                <input
                  type="text"
                  placeholder="Search decisions…"
                  value={filterText}
                  onChange={e => setFilterText(e.target.value)}
                  className="h-7 w-full rounded-lg border border-border bg-card pl-8 pr-3 text-xs placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                />
              </div>

              {/* Count */}
              <div className="text-[11px] text-muted-foreground">
                {filteredDecisions.length} of {decisions.length} decisions
              </div>
            </aside>

            {/* ─── Main content ─── */}
            <div className="flex-1 min-w-0">
              <Tabs value={activeTab} onValueChange={v => setActiveTab(v as typeof activeTab)}>
                <div className="flex items-center justify-between mb-4">
                  <TabsList>
                    <TabsTrigger value="timeline">Timeline</TabsTrigger>
                    <TabsTrigger value="decisions">
                      Decisions
                      <span className="ml-1.5 rounded-full bg-secondary px-1.5 py-0.5 text-[10px] font-medium text-secondary-foreground">
                        {filteredDecisions.length}
                      </span>
                    </TabsTrigger>
                    <TabsTrigger value="conflicts">
                      Conflicts
                      {conflicts.filter(c => !c.resolved).length > 0 && (
                        <span className="ml-1.5 rounded-full bg-red-100 dark:bg-red-950/50 px-1.5 py-0.5 text-[10px] font-medium text-red-600 dark:text-red-400">
                          {conflicts.filter(c => !c.resolved).length}
                        </span>
                      )}
                    </TabsTrigger>
                  </TabsList>

                  {/* Mobile filters (shown below lg breakpoint where sidebar is hidden) */}
                  <div className="flex items-center gap-2 lg:hidden flex-wrap">
                    <select
                      value={filterStatus}
                      onChange={e => setFilterStatus(e.target.value as typeof filterStatus)}
                      className="h-7 appearance-none rounded-full border border-border bg-card px-3 pr-6 text-xs text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                    >
                      {STATUS_FILTERS.map(f => (
                        <option key={f.value} value={f.value}>{f.label}</option>
                      ))}
                    </select>
                    {topics.length > 1 && (
                      <select
                        value={filterTopic}
                        onChange={e => setFilterTopic(e.target.value)}
                        className="h-7 appearance-none rounded-full border border-border bg-card px-3 pr-6 text-xs text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                      >
                        <option value="all">All topics</option>
                        {topics.map(t => <option key={t} value={t}>{t}</option>)}
                      </select>
                    )}
                    <div className="relative">
                      <Search className="absolute left-2 top-1.5 h-3.5 w-3.5 text-muted-foreground" />
                      <input
                        type="text"
                        placeholder="Search…"
                        value={filterText}
                        onChange={e => setFilterText(e.target.value)}
                        className="h-7 rounded-full border border-border bg-card pl-7 pr-3 text-xs focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring w-28"
                      />
                    </div>
                  </div>
                </div>

                {/* Timeline tab */}
                <TabsContent value="timeline">
                  {/* Date range chips (mobile + desktop) */}
                  <div className="mb-3 flex items-center gap-2">
                    <span className="text-xs text-muted-foreground">Show:</span>
                    {(['30d', '90d', 'all'] as const).map(r => (
                      <button
                        key={r}
                        onClick={() => setDateRange(r)}
                        className={cn(
                          'rounded-full border px-3 py-0.5 text-xs font-medium transition-colors',
                          dateRange === r
                            ? 'bg-orange-600 text-white border-orange-600'
                            : 'border-border text-muted-foreground hover:border-orange-300 hover:text-foreground bg-card',
                        )}
                      >
                        {r === 'all' ? 'All time' : `Last ${r}`}
                      </button>
                    ))}
                  </div>
                  <DecisionTimeline
                    decisions={dateFilteredDecisions}
                    conflicts={conflicts}
                    onSelectConflict={handleConflictSelect}
                  />
                </TabsContent>

                {/* Decisions tab */}
                <TabsContent value="decisions">
                  <div className="flex items-center justify-between mb-3">
                    <div className="flex items-center gap-1.5">
                      <button
                        onClick={() => setGroupBy('date')}
                        className={cn(
                          'flex items-center gap-1 rounded-md px-2.5 py-1 text-xs font-medium transition-colors',
                          groupBy === 'date' ? 'bg-muted text-foreground' : 'text-muted-foreground hover:text-foreground',
                        )}
                      >
                        <Clock className="h-3 w-3" />Chronological
                      </button>
                      <button
                        onClick={() => setGroupBy('topic')}
                        className={cn(
                          'flex items-center gap-1 rounded-md px-2.5 py-1 text-xs font-medium transition-colors',
                          groupBy === 'topic' ? 'bg-muted text-foreground' : 'text-muted-foreground hover:text-foreground',
                        )}
                      >
                        <LayoutList className="h-3 w-3" />By Topic
                      </button>
                    </div>
                    <span className="text-xs text-muted-foreground">{filteredDecisions.length} decisions</span>
                  </div>
                  {renderDecisionList()}
                </TabsContent>

                {/* Conflicts tab */}
                <TabsContent value="conflicts">
                  <ConflictCards
                    conflicts={conflicts}
                    decisions={decisions}
                    onExpand={(decisionId) => {
                      setExpandedDecisionId(decisionId)
                      setHighlightedDecisionId(decisionId)
                      setActiveTab('decisions')
                    }}
                    onResolve={handleResolveConflict}
                  />
                </TabsContent>
              </Tabs>
            </div>
          </motion.div>
        )}

        {/* Floating chat */}
        {decisions.length > 0 && (
          <QueryBar
            decisions={filteredDecisions}
            filterStatus={filterStatus}
            filterTopic={filterTopic}
            filterTopicColorDot={filterTopicColorDot}
            isOpen={chatOpen}
            onOpenChange={setChatOpen}
          />
        )}
      </div>
    </TooltipProvider>
  )
}
