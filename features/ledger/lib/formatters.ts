import type { DecisionStatus, ConflictType, DocType } from '@/lib/types'

export function formatDate(iso: string): string {
  const d = new Date(iso)
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

export function formatDateShort(iso: string): string {
  const d = new Date(iso)
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

export function statusLabel(status: DecisionStatus): string {
  return {
    active: 'Active',
    reversed: 'Reversed',
    contradicted: 'Contradicted',
    superseded: 'Superseded',
  }[status] ?? status
}

export function conflictTypeLabel(type: ConflictType): string {
  return {
    reversal: 'Explicit Reversal',
    contradiction: 'Direct Contradiction',
    silent_change: 'Silent Change',
  }[type] ?? type
}

export function docTypeLabel(type: DocType): string {
  return {
    transcript: 'Meeting Transcript',
    adr: 'Architecture Decision Record',
    slack: 'Slack Thread',
    pr: 'Pull Request',
    memo: 'Planning Memo',
  }[type] ?? type
}

export function truncate(text: string, maxLen = 120): string {
  if (text.length <= maxLen) return text
  return text.slice(0, maxLen).trim() + '…'
}

export function statusColor(status: DecisionStatus): {
  bg: string
  text: string
  border: string
  dot: string
} {
  return {
    active: {
      bg: 'bg-emerald-50',
      text: 'text-emerald-700',
      border: 'border-emerald-200',
      dot: 'bg-emerald-500',
    },
    reversed: {
      bg: 'bg-amber-50',
      text: 'text-amber-700',
      border: 'border-amber-200',
      dot: 'bg-amber-500',
    },
    contradicted: {
      bg: 'bg-red-50',
      text: 'text-red-700',
      border: 'border-red-200',
      dot: 'bg-red-500',
    },
    superseded: {
      bg: 'bg-muted',
      text: 'text-muted-foreground',
      border: 'border-border',
      dot: 'bg-muted-foreground',
    },
  }[status] ?? {
    bg: 'bg-muted',
    text: 'text-muted-foreground',
    border: 'border-border',
    dot: 'bg-muted-foreground',
  }
}
