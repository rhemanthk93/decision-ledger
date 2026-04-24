"use client"

import { motion, AnimatePresence } from 'framer-motion'
import { CheckCircle, AlertTriangle, Sparkles, Loader2 } from 'lucide-react'
import type { Decision } from '@/lib/types'

interface Props {
  isLoading: boolean
  decisions: Decision[]
  conflictCount: number
  error?: string
}

export default function ExtractionStream({ isLoading, decisions, conflictCount, error }: Props) {
  if (error) {
    return (
      <div className="rounded-lg border border-red-200 bg-red-50 p-4">
        <div className="flex items-center gap-2 text-sm font-medium text-red-700 mb-1">
          <AlertTriangle className="h-4 w-4" />
          Extraction failed
        </div>
        <p className="text-xs text-red-600">{error}</p>
      </div>
    )
  }

  return (
    <div className="space-y-3">
      {/* Status header */}
      <div className="flex items-center gap-2 text-sm font-medium">
        {isLoading ? (
          <>
            <Loader2 className="h-4 w-4 animate-spin text-orange-500" />
            <span className="text-foreground">Extracting decisions with Claude…</span>
          </>
        ) : decisions.length > 0 ? (
          <>
            <CheckCircle className="h-4 w-4 text-emerald-500" />
            <span className="text-foreground">
              Found <span className="font-bold">{decisions.length}</span> decision{decisions.length !== 1 ? 's' : ''}
            </span>
            {conflictCount > 0 && (
              <span className="inline-flex items-center gap-1 rounded-full bg-red-100 px-2 py-0.5 text-xs font-medium text-red-700">
                <AlertTriangle className="h-3 w-3" />
                {conflictCount} conflict{conflictCount !== 1 ? 's' : ''} detected
              </span>
            )}
          </>
        ) : null}
      </div>

      {/* Streaming decision cards */}
      <AnimatePresence>
        {decisions.map((d, i) => (
          <motion.div
            key={d.id}
            initial={{ opacity: 0, x: -10 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ delay: i * 0.05, duration: 0.25 }}
            className={[
              'rounded-lg border p-3',
              d.status === 'contradicted' || d.status === 'reversed'
                ? 'border-red-200 bg-red-50/60'
                : 'border-border bg-card',
            ].join(' ')}
          >
            <div className="text-sm font-medium text-foreground line-clamp-2">{d.statement}</div>
            <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-muted-foreground">
              <span className="font-medium text-foreground/70">{d.topic_cluster}</span>
              <span className="text-border">·</span>
              <span>{d.decision_type}</span>
              <span className="text-border">·</span>
              <span>{d.decided_at}</span>
              <span className="text-border">·</span>
              <span className="tabular-nums">{Math.round(d.confidence * 100)}% confidence</span>
            </div>
          </motion.div>
        ))}
      </AnimatePresence>

      {/* Shimmer placeholder while loading */}
      {isLoading && decisions.length === 0 && (
        <div className="space-y-2">
          {[1, 2, 3].map(i => (
            <div
              key={i}
              className="h-16 rounded-lg border border-border bg-muted/40 animate-pulse"
              style={{ animationDelay: `${i * 0.15}s` }}
            />
          ))}
        </div>
      )}

      {/* Claude attribution */}
      {decisions.length > 0 && (
        <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <Sparkles className="h-3 w-3" />
          Extracted by Claude Sonnet — only high-confidence decisions included
        </div>
      )}
    </div>
  )
}
