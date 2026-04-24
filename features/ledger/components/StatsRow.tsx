"use client"

import { motion } from 'framer-motion'
import { FileCheck, CheckCircle, AlertTriangle, Layers } from 'lucide-react'
import type { Decision, Conflict } from '@/lib/types'

interface Props {
  decisions: Decision[]
  conflicts: Conflict[]
}

export default function StatsRow({ decisions, conflicts }: Props) {
  const activeCount = decisions.filter(d => d.status === 'active').length
  const topicCount = new Set(decisions.map(d => d.topic_cluster.toLowerCase().trim())).size

  const stats = [
    {
      label: 'Total Decisions',
      value: decisions.length,
      icon: FileCheck,
      color: 'text-orange-600 dark:text-orange-400',
      bg: 'bg-orange-50 dark:bg-orange-950/40',
    },
    {
      label: 'Active Decisions',
      value: activeCount,
      icon: CheckCircle,
      color: 'text-emerald-600 dark:text-emerald-400',
      bg: 'bg-emerald-50 dark:bg-emerald-950/40',
    },
    {
      label: 'Conflicts',
      value: conflicts.length,
      icon: AlertTriangle,
      color: conflicts.length > 0 ? 'text-red-600 dark:text-red-400' : 'text-muted-foreground',
      bg: conflicts.length > 0 ? 'bg-red-50 dark:bg-red-950/40' : 'bg-muted',
      badge: conflicts.length > 0,
    },
    {
      label: 'Topics Tracked',
      value: topicCount,
      icon: Layers,
      color: 'text-violet-600 dark:text-violet-400',
      bg: 'bg-violet-50 dark:bg-violet-950/40',
    },
  ]

  return (
    <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
      {stats.map((s, i) => (
        <motion.div
          key={s.label}
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          whileHover={{ y: -2, scale: 1.01 }}
          transition={{ delay: i * 0.06 }}
          className="relative rounded-xl border border-border bg-card p-4 cursor-default preview-glow"
        >
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-medium text-muted-foreground">{s.label}</span>
            <div className={`flex h-7 w-7 items-center justify-center rounded-lg ${s.bg} ${s.color}`}>
              <s.icon className="h-3.5 w-3.5" />
            </div>
          </div>
          <div className="flex items-end gap-2">
            <span className={`text-2xl font-bold ${s.badge ? 'text-red-600' : 'text-foreground'}`}>
              {s.value}
            </span>
            {s.badge && s.value > 0 && (
              <span className="mb-0.5 flex h-2 w-2 rounded-full bg-red-500 animate-pulse" />
            )}
          </div>
        </motion.div>
      ))}
    </div>
  )
}
