"use client"

import { useMemo, useState } from 'react'
import { motion } from 'framer-motion'
import { AlertTriangle, ArrowRight, Zap, RotateCcw, Eye, Sparkles, CheckCircle2 } from 'lucide-react'
import type { Decision, Conflict } from '@/lib/types'
import { formatDate } from '../lib/formatters'
import { cn } from '@/lib/utils'

interface Props {
  conflicts: Conflict[]
  decisions: Decision[]
  onExpand: (decisionId: string) => void
  onResolve: (conflictId: string) => void
}

const CONFLICT_META = {
  contradiction: {
    icon: Zap,
    label: 'Direct Contradiction',
    iconWrap: 'bg-red-100 dark:bg-red-950/60',
    iconColor: 'text-red-500 dark:text-red-400',
    labelColor: 'text-red-600 dark:text-red-400',
    cardBorder: 'border-red-200/60 dark:border-red-900/50',
    cardBg: 'bg-red-50/25 dark:bg-red-950/8',
    headerBorder: 'border-red-100 dark:border-red-900/40',
    laterBorder: 'border-red-200/70 dark:border-red-800/50',
    laterBg: 'bg-red-50/50 dark:bg-red-950/20',
    laterLabel: 'text-red-600 dark:text-red-400',
    laterDot: 'bg-red-500',
    connectorBorder: 'border-red-200/50 dark:border-red-800/40',
    connectorBg: 'bg-red-50 dark:bg-red-950/40',
    connectorArrow: 'text-red-400 dark:text-red-500',
    footerBorder: 'border-red-100/80 dark:border-red-900/30',
    btn: 'text-red-600 dark:text-red-400 border-red-200 dark:border-red-800 bg-red-50/80 hover:bg-red-100 dark:bg-red-950/20 dark:hover:bg-red-950/40',
  },
  reversal: {
    icon: RotateCcw,
    label: 'Explicit Reversal',
    iconWrap: 'bg-amber-100 dark:bg-amber-950/60',
    iconColor: 'text-amber-500 dark:text-amber-400',
    labelColor: 'text-amber-600 dark:text-amber-400',
    cardBorder: 'border-amber-200/60 dark:border-amber-900/50',
    cardBg: 'bg-amber-50/25 dark:bg-amber-950/8',
    headerBorder: 'border-amber-100 dark:border-amber-900/40',
    laterBorder: 'border-amber-200/70 dark:border-amber-800/50',
    laterBg: 'bg-amber-50/50 dark:bg-amber-950/20',
    laterLabel: 'text-amber-600 dark:text-amber-400',
    laterDot: 'bg-amber-500',
    connectorBorder: 'border-amber-200/50 dark:border-amber-800/40',
    connectorBg: 'bg-amber-50 dark:bg-amber-950/40',
    connectorArrow: 'text-amber-400 dark:text-amber-500',
    footerBorder: 'border-amber-100/80 dark:border-amber-900/30',
    btn: 'text-amber-600 dark:text-amber-400 border-amber-200 dark:border-amber-800 bg-amber-50/80 hover:bg-amber-100 dark:bg-amber-950/20 dark:hover:bg-amber-950/40',
  },
  silent_change: {
    icon: AlertTriangle,
    label: 'Silent Change',
    iconWrap: 'bg-orange-100 dark:bg-orange-950/60',
    iconColor: 'text-orange-500 dark:text-orange-400',
    labelColor: 'text-orange-600 dark:text-orange-400',
    cardBorder: 'border-orange-200/60 dark:border-orange-900/50',
    cardBg: 'bg-orange-50/25 dark:bg-orange-950/8',
    headerBorder: 'border-orange-100 dark:border-orange-900/40',
    laterBorder: 'border-orange-200/70 dark:border-orange-800/50',
    laterBg: 'bg-orange-50/50 dark:bg-orange-950/20',
    laterLabel: 'text-orange-600 dark:text-orange-400',
    laterDot: 'bg-orange-500',
    connectorBorder: 'border-orange-200/50 dark:border-orange-800/40',
    connectorBg: 'bg-orange-50 dark:bg-orange-950/40',
    connectorArrow: 'text-orange-400 dark:text-orange-500',
    footerBorder: 'border-orange-100/80 dark:border-orange-900/30',
    btn: 'text-orange-600 dark:text-orange-400 border-orange-200 dark:border-orange-800 bg-orange-50/80 hover:bg-orange-100 dark:bg-orange-950/20 dark:hover:bg-orange-950/40',
  },
} as const

type ConflictKey = keyof typeof CONFLICT_META

export default function ConflictCards({ conflicts, decisions, onExpand, onResolve }: Props) {
  const [showResolved, setShowResolved] = useState(false)

  const decisionsById = useMemo(
    () => new Map(decisions.map(decision => [decision.id, decision])),
    [decisions]
  )

  const unresolvedConflicts = conflicts.filter(c => !c.resolved)
  const resolvedConflicts = conflicts.filter(c => c.resolved)
  const visibleConflicts = showResolved ? conflicts : unresolvedConflicts

  if (conflicts.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-border p-12 text-center">
        <CheckCircle2 className="h-8 w-8 text-emerald-500 mx-auto mb-3" />
        <p className="text-sm font-semibold text-foreground mb-1">No conflicts detected</p>
        <p className="text-xs text-muted-foreground">All decisions appear consistent with each other.</p>
      </div>
    )
  }

  if (unresolvedConflicts.length === 0 && !showResolved) {
    return (
      <div className="space-y-3">
        <div className="rounded-xl border border-dashed border-emerald-200 dark:border-emerald-800 p-12 text-center">
          <CheckCircle2 className="h-8 w-8 text-emerald-500 mx-auto mb-3" />
          <p className="text-sm font-semibold text-foreground mb-1">All conflicts resolved</p>
          <p className="text-xs text-muted-foreground mb-3">Great work — no open conflicts remain.</p>
          <button
            onClick={() => setShowResolved(true)}
            className="text-xs text-muted-foreground hover:text-foreground underline underline-offset-2 transition-colors"
          >
            Show {resolvedConflicts.length} resolved
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-xs text-muted-foreground">
          {unresolvedConflicts.length} open conflict{unresolvedConflicts.length !== 1 ? 's' : ''}
          {resolvedConflicts.length > 0 && ` · ${resolvedConflicts.length} resolved`}
        </p>
        {resolvedConflicts.length > 0 && (
          <button
            onClick={() => setShowResolved(v => !v)}
            className="text-xs text-muted-foreground hover:text-foreground transition-colors"
          >
            {showResolved ? 'Hide resolved' : `Show resolved (${resolvedConflicts.length})`}
          </button>
        )}
      </div>

      {visibleConflicts.map((conflict, i) => {
        const earlier = decisionsById.get(conflict.earlier_decision_id)
        const later = decisionsById.get(conflict.later_decision_id)
        if (!earlier || !later) return null

        const meta = CONFLICT_META[(conflict.conflict_type as ConflictKey)] ?? CONFLICT_META.contradiction
        const Icon = meta.icon
        const isResolved = conflict.resolved

        return (
          <motion.div
            key={conflict.id}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: i * 0.05, duration: 0.2 }}
            className={cn(
              'rounded-xl border overflow-hidden',
              isResolved
                ? 'border-border bg-muted/20 opacity-60'
                : cn(meta.cardBorder, meta.cardBg),
            )}
          >
            {/* Header */}
            <div className={cn('flex items-center justify-between px-4 py-3 border-b', isResolved ? 'border-border' : meta.headerBorder)}>
              <div className="flex items-center gap-2.5">
                <span className={cn('flex h-6 w-6 items-center justify-center rounded-md shrink-0', isResolved ? 'bg-muted' : meta.iconWrap)}>
                  <Icon className={cn('h-3.5 w-3.5', isResolved ? 'text-muted-foreground' : meta.iconColor)} />
                </span>
                <span className={cn('text-xs font-semibold tracking-wide', isResolved ? 'text-muted-foreground' : meta.labelColor)}>
                  {meta.label.toUpperCase()}
                </span>
                <span className="text-xs text-muted-foreground">
                  in <span className="font-medium text-foreground/90">{earlier.topic_cluster}</span>
                </span>
              </div>
              <div className="flex items-center gap-2">
                {isResolved && (
                  <div className="flex items-center gap-1 text-[10px] text-emerald-600 dark:text-emerald-500 font-medium">
                    <CheckCircle2 className="h-2.5 w-2.5" />
                    Resolved
                  </div>
                )}
                {!isResolved && conflict.narration && (
                  <div className="flex items-center gap-1 text-[10px] text-emerald-600 dark:text-emerald-500 font-medium">
                    <Sparkles className="h-2.5 w-2.5" />
                    Analysis cached
                  </div>
                )}
              </div>
            </div>

            {/* Decision pair */}
            <div className="flex items-stretch gap-0 p-4">
              {/* Earlier */}
              <div className="flex-1 rounded-lg border border-border/50 bg-card p-3.5 shadow-sm min-w-0">
                <div className="flex items-center gap-1.5 mb-2">
                  <span className="h-1.5 w-1.5 rounded-full bg-slate-400 shrink-0" />
                  <span className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
                    Earlier
                  </span>
                  <span className="ml-auto text-[10px] text-muted-foreground/60 tabular-nums whitespace-nowrap">
                    {formatDate(earlier.decided_at)}
                  </span>
                </div>
                <p className="text-[13px] text-foreground leading-relaxed line-clamp-3">
                  {earlier.statement}
                </p>
                {earlier.decided_by.length > 0 && (
                  <p className="mt-2 text-[10px] text-muted-foreground truncate">
                    {earlier.decided_by.slice(0, 3).join(', ')}
                  </p>
                )}
              </div>

              {/* Connector */}
              <div className="flex flex-col items-center justify-center px-2.5 gap-1 shrink-0">
                <div className="h-5 w-px bg-border/50" />
                <div className={cn(
                  'flex h-5 w-5 items-center justify-center rounded-full border',
                  meta.connectorBorder, meta.connectorBg
                )}>
                  <ArrowRight className={cn('h-2.5 w-2.5', meta.connectorArrow)} />
                </div>
                <div className="h-5 w-px bg-border/50" />
              </div>

              {/* Later */}
              <div className={cn('flex-1 rounded-lg border p-3.5 shadow-sm min-w-0', meta.laterBorder, meta.laterBg)}>
                <div className="flex items-center gap-1.5 mb-2">
                  <span className={cn('h-1.5 w-1.5 rounded-full shrink-0', meta.laterDot)} />
                  <span className={cn('text-[10px] font-semibold uppercase tracking-widest', meta.laterLabel)}>
                    Later
                  </span>
                  <span className="ml-auto text-[10px] text-muted-foreground/60 tabular-nums whitespace-nowrap">
                    {formatDate(later.decided_at)}
                  </span>
                </div>
                <p className="text-[13px] text-foreground leading-relaxed line-clamp-3">
                  {later.statement}
                </p>
                {later.decided_by.length > 0 && (
                  <p className="mt-2 text-[10px] text-muted-foreground truncate">
                    {later.decided_by.slice(0, 3).join(', ')}
                  </p>
                )}
              </div>
            </div>

            {/* Narration preview */}
            {conflict.narration && (
              <div className="mx-4 mb-3 rounded-lg border border-border/50 bg-muted/30 px-3 py-2">
                <p className="text-[11px] text-muted-foreground leading-relaxed line-clamp-2">
                  {conflict.narration}
                </p>
              </div>
            )}

            {/* Footer */}
            <div className={cn('flex items-center justify-between px-4 py-2.5 border-t', isResolved ? 'border-border' : meta.footerBorder)}>
              {!isResolved ? (
                <button
                  onClick={() => onResolve(conflict.id)}
                  className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition-colors border border-emerald-200 dark:border-emerald-800 text-emerald-700 dark:text-emerald-400 bg-emerald-50/80 hover:bg-emerald-100 dark:bg-emerald-950/20 dark:hover:bg-emerald-950/40"
                >
                  <CheckCircle2 className="h-3 w-3" />
                  Mark Resolved
                </button>
              ) : (
                <div />
              )}
              {!isResolved && (
                <button
                  onClick={() => onExpand(later.id)}
                  className={cn(
                    'group flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition-colors border',
                    meta.btn
                  )}
                >
                  <Eye className="h-3 w-3" />
                  View & Analyze
                  <ArrowRight className="h-3 w-3 transition-transform group-hover:translate-x-0.5" />
                </button>
              )}
            </div>
          </motion.div>
        )
      })}
    </div>
  )
}
