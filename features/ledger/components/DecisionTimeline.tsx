"use client"

import { useMemo } from 'react'
import { motion } from 'framer-motion'
import { TooltipProvider, Tooltip, TooltipTrigger, TooltipContent } from '@/components/ui/tooltip'
import { AlertTriangle } from 'lucide-react'
import type { Decision, Conflict } from '@/lib/types'
import { formatDateShort } from '../lib/formatters'

interface Props {
  decisions: Decision[]
  conflicts: Conflict[]
  onSelectConflict: (conflictId: string) => void
}

const LEFT_WIDTH = 176
const LANE_HEIGHT = 56
const PAD_PCT = 2.5

const STATUS_FILL: Record<string, string> = {
  active:       '#10b981',
  reversed:     '#f59e0b',
  contradicted: '#ef4444',
  superseded:   '#94a3b8',
}

const TOPIC_COLORS = [
  '#8b5cf6', '#0ea5e9', '#f59e0b',
  '#f43f5e', '#14b8a6', '#d946ef', '#84cc16',
]

function toPct(iso: string, minTime: number, maxTime: number): number {
  const range = maxTime - minTime
  if (range === 0) return 50
  return PAD_PCT + ((+new Date(iso) - minTime) / range) * (100 - PAD_PCT * 2)
}

export default function DecisionTimeline({ decisions, conflicts, onSelectConflict }: Props) {
  const decisionsById = useMemo(
    () => new Map(decisions.map(decision => [decision.id, decision])),
    [decisions]
  )

  const conflictMap = useMemo(() => {
    const map = new Map<string, Conflict[]>()
    for (const c of conflicts) {
      const earlier = map.get(c.earlier_decision_id) ?? []
      earlier.push(c)
      map.set(c.earlier_decision_id, earlier)

      const later = map.get(c.later_decision_id) ?? []
      later.push(c)
      map.set(c.later_decision_id, later)
    }
    return map
  }, [conflicts])

  const primaryConflictByDecisionId = useMemo(() => {
    const map = new Map<string, Conflict>()

    const compareConflicts = (candidate: Conflict, current?: Conflict) => {
      if (!current) return true

      const candidateTime = +new Date(
        decisionsById.get(candidate.later_decision_id)?.decided_at ?? 0
      )
      const currentTime = +new Date(
        decisionsById.get(current.later_decision_id)?.decided_at ?? 0
      )

      return candidateTime >= currentTime
    }

    for (const [decisionId, decisionConflicts] of conflictMap.entries()) {
      decisionConflicts.forEach(conflict => {
        if (compareConflicts(conflict, map.get(decisionId))) {
          map.set(decisionId, conflict)
        }
      })
    }

    return map
  }, [conflictMap, decisionsById])

  const { minTime, maxTime } = useMemo(() => {
    if (decisions.length === 0) {
      return { minTime: 0, maxTime: 0 }
    }

    const times = decisions.map(d => +new Date(d.decided_at))
    return { minTime: Math.min(...times), maxTime: Math.max(...times) }
  }, [decisions])

  const lanes = useMemo(() => {
    const map = new Map<string, Decision[]>()
    for (const d of decisions) {
      const key = d.topic_cluster.toLowerCase().trim()
      if (!map.has(key)) map.set(key, [])
      map.get(key)!.push(d)
    }
    return Array.from(map.entries())
      .map(([key, decs], i) => ({
        key,
        label: decs[0].topic_cluster,
        color: TOPIC_COLORS[i % TOPIC_COLORS.length],
        decisions: decs.sort((a, b) => +new Date(a.decided_at) - +new Date(b.decided_at)),
        hasConflict: decs.some(d => primaryConflictByDecisionId.has(d.id)),
      }))
      .sort((a, b) => (a.hasConflict === b.hasConflict ? 0 : a.hasConflict ? -1 : 1))
  }, [decisions, primaryConflictByDecisionId])

  const markers = useMemo(
    () => {
      if (decisions.length === 0) return []

      return [0, 0.25, 0.5, 0.75, 1].map((pct, i) => ({
        i,
        pct,
        xPct: PAD_PCT + pct * (100 - PAD_PCT * 2),
        label: formatDateShort(
          new Date(minTime + pct * (maxTime - minTime)).toISOString()
        ),
      }))
    },
    [decisions.length, minTime, maxTime]
  )

  if (decisions.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-border p-12 text-center text-muted-foreground">
        No decisions match the current timeline range.
      </div>
    )
  }

  return (
    <TooltipProvider>
      <div className="rounded-xl border border-border bg-card overflow-hidden">

        {/* Date axis */}
        <div className="flex border-b border-border" style={{ height: 36 }}>
          <div
            className="shrink-0 border-r border-border bg-muted/40"
            style={{ width: LEFT_WIDTH }}
          />
          <div className="flex-1 relative bg-muted/10">
            {markers.map(({ i, pct, xPct, label }) => (
              <span
                key={pct}
                className="absolute text-[10px] font-medium text-muted-foreground whitespace-nowrap tabular-nums select-none tracking-wide"
                style={{
                  left: `${xPct}%`,
                  top: '50%',
                  transform: `translateY(-50%) ${
                    i === 0
                      ? 'translateX(0)'
                      : i === 4
                      ? 'translateX(-100%)'
                      : 'translateX(-50%)'
                  }`,
                }}
              >
                {label}
              </span>
            ))}
          </div>
        </div>

        {/* Lanes */}
        {lanes.map((lane, laneIdx) => {
          const firstX = toPct(lane.decisions[0].decided_at, minTime, maxTime)
          const lastX = toPct(
            lane.decisions[lane.decisions.length - 1].decided_at,
            minTime,
            maxTime
          )

          return (
            <div
              key={lane.key}
              className={`flex border-b last:border-b-0 ${
                lane.hasConflict
                  ? 'bg-red-50/70 dark:bg-red-950/20'
                  : laneIdx % 2 === 1
                  ? 'bg-muted/20'
                  : ''
              }`}
              style={{ height: LANE_HEIGHT, position: 'relative' }}
            >
              {lane.hasConflict && (
                <div
                  className="absolute left-0 top-0 bottom-0 z-10 rounded-r-sm"
                  style={{ width: 3, backgroundColor: '#ef4444', opacity: 0.65 }}
                />
              )}

              {/* Label */}
              <div
                className="shrink-0 flex items-center gap-2 pl-5 pr-3 border-r border-border"
                style={{ width: LEFT_WIDTH }}
              >
                <span
                  className="shrink-0 rounded-full"
                  style={{
                    width: 7,
                    height: 7,
                    backgroundColor: lane.color,
                    boxShadow: `0 0 0 2px ${lane.color}20`,
                  }}
                />
                <span className="text-[11px] font-medium text-foreground/80 leading-tight line-clamp-2 flex-1 min-w-0">
                  {lane.label}
                </span>
                {lane.hasConflict && (
                  <AlertTriangle className="h-3.5 w-3.5 text-red-500 shrink-0" />
                )}
              </div>

              {/* Timeline */}
              <div className="flex-1 relative" style={{ height: LANE_HEIGHT }}>

                {/* Vertical grid lines */}
                {markers.map(({ pct, xPct }) => (
                  <div
                    key={pct}
                    className="absolute top-0 bottom-0 w-px border-border"
                    style={{
                      left: `${xPct}%`,
                      backgroundColor: 'currentColor',
                      opacity: 0.12,
                    }}
                  />
                ))}

                {/* Connecting line */}
                {lane.decisions.length > 1 && (
                  <div
                    className="absolute"
                    style={{
                      left: `${firstX}%`,
                      width: `${lastX - firstX}%`,
                      top: '50%',
                      height: 0,
                      marginTop: -1,
                      borderTop: lane.hasConflict
                        ? '2px dashed rgba(239,68,68,0.45)'
                        : '2px solid rgba(148,163,184,0.5)',
                    }}
                  />
                )}

                {/* Nodes */}
                {lane.decisions.map((decision, nodeIdx) => {
                  const xPct = toPct(decision.decided_at, minTime, maxTime)
                  const conflict = primaryConflictByDecisionId.get(decision.id)
                  const fill = STATUS_FILL[decision.status] ?? '#94a3b8'
                  const isHot =
                    decision.status === 'contradicted' ||
                    decision.status === 'reversed'

                  return (
                    <div
                      key={decision.id}
                      className="absolute top-1/2"
                      style={{
                        left: `${xPct}%`,
                        transform: 'translate(-50%, -50%)',
                        zIndex: 10,
                      }}
                    >
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <motion.button
                            style={{
                              position: 'relative',
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'center',
                              width: 16,
                              height: 16,
                              borderRadius: '50%',
                              backgroundColor: fill,
                              border: '2.5px solid hsl(var(--background))',
                              boxShadow: isHot
                                ? `0 0 0 3px ${fill}28, 0 1px 4px rgba(0,0,0,0.14)`
                                : '0 1px 3px rgba(0,0,0,0.10)',
                              cursor: conflict ? 'pointer' : 'default',
                              outline: 'none',
                              overflow: 'visible',
                            }}
                            initial={{ scale: 0, opacity: 0 }}
                            animate={{ scale: 1, opacity: 1 }}
                            transition={{
                              delay: laneIdx * 0.04 + nodeIdx * 0.07,
                              type: 'spring',
                              stiffness: 340,
                              damping: 20,
                            }}
                            onClick={() => conflict && onSelectConflict(conflict.id)}
                            tabIndex={conflict ? 0 : -1}
                          >
                            <span
                              className="absolute rounded-full pointer-events-none"
                              style={{
                                inset: -3,
                                backgroundColor: fill,
                                opacity: 0.15,
                                borderRadius: '50%',
                              }}
                            />
                            {isHot && (
                              <span
                                className="animate-conflict-ping absolute rounded-full pointer-events-none"
                                style={{
                                  inset: -4,
                                  backgroundColor: fill,
                                  opacity: 0.25,
                                  borderRadius: '50%',
                                }}
                              />
                            )}
                          </motion.button>
                        </TooltipTrigger>
                        <TooltipContent
                          side="top"
                          className="max-w-[220px] p-3 space-y-1"
                        >
                          <p className="text-xs font-semibold leading-snug">
                            {decision.statement}
                          </p>
                          <p className="text-[10px] text-muted-foreground">
                            {formatDateShort(decision.decided_at)}
                            {decision.decided_by.length > 0 &&
                              ` · ${decision.decided_by.slice(0, 2).join(', ')}`}
                          </p>
                          {conflict && (
                            <p className="text-[10px] font-semibold text-red-500">
                              ⚠ Click to view conflict
                            </p>
                          )}
                        </TooltipContent>
                      </Tooltip>
                    </div>
                  )
                })}
              </div>
            </div>
          )
        })}

        {/* Legend */}
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-border px-4 py-2.5 bg-muted/20">
          {Object.entries(STATUS_FILL).map(([status, color]) => (
            <div key={status} className="flex items-center gap-1.5">
              <span
                className="rounded-full"
                style={{ width: 8, height: 8, backgroundColor: color, display: 'inline-block' }}
              />
              <span className="text-xs capitalize text-muted-foreground">{status}</span>
            </div>
          ))}
          <span className="ml-auto text-xs text-muted-foreground hidden sm:block">
            · Click a red/amber node to view conflict
          </span>
        </div>
      </div>
    </TooltipProvider>
  )
}
