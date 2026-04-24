"use client"

import React, { useState, useRef, useEffect, memo, useCallback, useMemo } from 'react'
import {
  Sparkles, Trash2, ArrowUp, Loader2, Maximize2, Minimize2, X,
  Database, RotateCcw, Shield, AlertTriangle, Pin,
} from 'lucide-react'
import { motion, AnimatePresence } from 'framer-motion'
import { Button } from '@/components/ui/button'
import type { Decision } from '@/lib/types'
import { cn } from '@/lib/utils'
import { buildFallbackSuggestions, type SuggestionIcon } from '@/features/ledger/lib/suggestions'
import { Streamdown } from 'streamdown'
import 'streamdown/styles.css'

interface Props {
  decisions: Decision[]
  filterStatus: string
  filterTopic: string
  filterTopicColorDot: string
  isOpen: boolean
  onOpenChange: (v: boolean) => void
}

type ChatMsg = {
  id: string
  role: 'user' | 'assistant'
  content: string
  saved?: boolean
}

type PanelState = 'collapsed' | 'expanded' | 'fullscreen'

type Suggestion = { q: string; icon: React.ElementType }

const suggestionIcons: Record<SuggestionIcon, React.ElementType> = {
  database: Database,
  sparkles: Sparkles,
  alert: AlertTriangle,
  shield: Shield,
  rotate: RotateCcw,
}

// Memoized message row — prevents re-renders per streaming chunk
const MessageRow = memo(function MessageRow({
  msg,
  isStreaming,
  isLast,
  onSave,
}: {
  msg: ChatMsg
  isStreaming: boolean
  isLast: boolean
  onSave: (id: string) => void
}) {
  const isUser = msg.role === 'user'
  const isStreamingThis = isStreaming && isLast && !isUser

  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.18 }}
      className={cn('group/row flex', isUser ? 'justify-end' : 'items-start gap-2.5')}
    >
      {!isUser && (
        <div className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-orange-100 dark:bg-orange-950">
          <Sparkles className="h-3.5 w-3.5 text-orange-600" />
        </div>
      )}

      <div className={cn(
        'relative max-w-[82%] rounded-2xl px-4 py-2.5 text-sm leading-relaxed',
        isUser
          ? 'rounded-tr-sm bg-orange-600 text-white'
          : cn(
              'rounded-tl-sm border border-border bg-muted/40 text-foreground',
              msg.saved && 'border-l-2 border-l-amber-400/70 bg-amber-50/20 dark:bg-amber-950/10',
            ),
      )}>
        {/* Content */}
        {!isUser && !msg.content && isStreamingThis ? (
          <TypingDots />
        ) : isUser ? (
          msg.content
        ) : (
          <Streamdown
            mode={isStreamingThis ? 'streaming' : 'static'}
            isAnimating={isStreamingThis}
            caret="block"
            className="text-sm leading-relaxed"
          >
            {msg.content ?? ''}
          </Streamdown>
        )}

        {/* Save insight button — hover reveal for assistant messages */}
        {!isUser && msg.content && !isStreamingThis && (
          <button
            onClick={() => onSave(msg.id)}
            className={cn(
              'absolute -bottom-5 right-0 flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] transition-all duration-150',
              msg.saved
                ? 'text-amber-500'
                : 'text-muted-foreground/40 opacity-0 group-hover/row:opacity-100 hover:text-muted-foreground',
            )}
          >
            <Pin className="h-2.5 w-2.5" />
            {msg.saved ? 'saved' : 'save insight'}
          </button>
        )}
      </div>
    </motion.div>
  )
})

export default function QueryBar({
  decisions,
  filterStatus,
  filterTopic,
  filterTopicColorDot,
  isOpen,
  onOpenChange,
}: Props) {
  const [messages, setMessages]         = useState<ChatMsg[]>([])
  const [input, setInput]               = useState('')
  const [streaming, setStreaming]       = useState(false)
  const [hasMounted, setHasMounted]     = useState(false)
  const [panelState, setPanelState]     = useState<PanelState>('expanded')
  const [aiSuggestions, setAiSuggestions] = useState<string[] | null>(null)
  const [loadingSuggestions, setLoadingSuggestions] = useState(false)

  const scrollRef      = useRef<HTMLDivElement>(null)
  const inputRef       = useRef<HTMLTextAreaElement>(null)
  const abortRef       = useRef<AbortController | null>(null)
  const panelRef       = useRef<HTMLDivElement>(null)
  const fetchedForRef  = useRef<string | null>(null)

  const openPanel = useCallback(() => {
    if (!hasMounted) setHasMounted(true)
    setPanelState('expanded')
    onOpenChange(true)
  }, [hasMounted, onOpenChange])

  const closePanel = useCallback(() => {
    setPanelState('expanded')
    onOpenChange(false)
  }, [onOpenChange])

  // Click-outside closes the panel (slide-down exit)
  useEffect(() => {
    if (!isOpen) return
    const handleMouseDown = (e: MouseEvent) => {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
        closePanel()
      }
    }
    document.addEventListener('mousedown', handleMouseDown)
    return () => document.removeEventListener('mousedown', handleMouseDown)
  }, [closePanel, isOpen])

  // Cmd+K to toggle
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault()
        if (isOpen) {
          closePanel()
          return
        }

        openPanel()
      }
      if (e.key === 'Escape' && isOpen) closePanel()
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [closePanel, isOpen, openPanel])

  // Auto-scroll to latest message
  useEffect(() => {
    scrollRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  // Auto-resize textarea
  useEffect(() => {
    const raf = requestAnimationFrame(() => {
      const el = inputRef.current
      if (!el) return
      el.style.height = 'auto'
      el.style.height = `${Math.min(el.scrollHeight, 120)}px`
    })
    return () => cancelAnimationFrame(raf)
  }, [input])

  const submit = useCallback(async (q: string) => {
    if (!q.trim() || !decisions.length || streaming) return

    abortRef.current?.abort()
    abortRef.current = new AbortController()

    const userMsg: ChatMsg = { id: crypto.randomUUID(), role: 'user', content: q }
    const assistantId = crypto.randomUUID()

    setMessages(prev => [
      ...prev,
      userMsg,
      { id: assistantId, role: 'assistant', content: '' },
    ])
    setInput('')
    setStreaming(true)

    try {
      const res = await fetch('/api/query', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ q, decisions }),
        signal: abortRef.current.signal,
      })

      if (!res.ok || !res.body) throw new Error('Query failed')

      const reader  = res.body.getReader()
      const decoder = new TextDecoder()

      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        const chunk = decoder.decode(value)
        setMessages(prev =>
          prev.map(m => m.id === assistantId ? { ...m, content: m.content + chunk } : m)
        )
      }
    } catch (err) {
      if ((err as Error).name !== 'AbortError') {
        setMessages(prev =>
          prev.map(m =>
            m.id === assistantId ? { ...m, content: 'Query failed. Please try again.' } : m
          )
        )
      }
    } finally {
      setStreaming(false)
      setTimeout(() => inputRef.current?.focus(), 50)
    }
  }, [decisions, streaming])

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      submit(input)
    }
  }

  const clear = () => {
    abortRef.current?.abort()
    setMessages([])
    setStreaming(false)
    setTimeout(() => inputRef.current?.focus(), 50)
  }

  const saveInsight = (id: string) => {
    setMessages(prev => prev.map(m => m.id === id ? { ...m, saved: !m.saved } : m))
  }

  const handleOpen = () => {
    openPanel()
    setTimeout(() => inputRef.current?.focus(), 200)
  }

  const enterFullscreen = () => {
    setPanelState('fullscreen')
    setTimeout(() => inputRef.current?.focus(), 100)
  }

  const exitFullscreen = () => {
    setPanelState('expanded')
  }

  const isFullscreen = panelState === 'fullscreen'
  const lastAssistantIdx = messages.map(m => m.role).lastIndexOf('assistant')

  // Computed fallback — instant, no network
  const computedSuggestions = useMemo(
    () => buildFallbackSuggestions(decisions).map(({ q, icon }) => ({ q, icon: suggestionIcons[icon] })),
    [decisions]
  )

  // Upgrade to AI-generated suggestions on first open for this set of decisions
  const ICONS = [AlertTriangle, Database, Shield, RotateCcw] as const
  const suggested: Suggestion[] = aiSuggestions
    ? aiSuggestions.map((q, i) => ({ q, icon: ICONS[i % ICONS.length] }))
    : computedSuggestions

  useEffect(() => {
    if (!isOpen || !decisions.length || loadingSuggestions) return
    const fingerprint = decisions.map(d => d.id).join(',')
    if (fetchedForRef.current === fingerprint) return
    fetchedForRef.current = fingerprint
    setLoadingSuggestions(true)
    fetch('/api/suggestions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ decisions }),
    })
      .then(r => r.json())
      .then(data => { if (Array.isArray(data.suggestions)) setAiSuggestions(data.suggestions) })
      .catch(() => { /* keep computed fallback */ })
      .finally(() => setLoadingSuggestions(false))
  }, [isOpen, decisions]) // eslint-disable-line react-hooks/exhaustive-deps

  // Context chips
  const contextChips = [
    { label: `${decisions.length} decisions`, always: true },
    filterStatus !== 'all' ? { label: filterStatus } : null,
    filterTopic !== 'all'  ? { label: filterTopic, dot: filterTopicColorDot } : null,
  ].filter(Boolean) as { label: string; dot?: string; always?: boolean }[]

  return (
    <AnimatePresence mode="popLayout">
      {!isOpen ? (
        <motion.div
          key="pill"
          layoutId="chat-widget"
          onClick={handleOpen}
          role="button"
          tabIndex={0}
          onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') handleOpen() }}
          transition={{ type: 'spring', bounce: 0.2, duration: 0.5 }}
          className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 w-[90%] sm:w-[80%] overflow-hidden rounded-full border border-border bg-card shadow-lg cursor-pointer group hover:border-orange-300/70 transition-colors"
        >
          <motion.div
            key="pill-content"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.12 }}
            className="flex items-center gap-3 px-5 py-3"
          >
            <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-orange-100 dark:bg-orange-950">
              <Sparkles className="h-3.5 w-3.5 text-orange-600" />
            </div>
            <span className="flex-1 text-sm text-muted-foreground text-left group-hover:text-foreground transition-colors">
              Ask about your {decisions.length} decisions…
            </span>
            <kbd className="hidden sm:flex h-5 items-center gap-1 rounded border border-border bg-muted px-1.5 text-[10px] font-medium text-muted-foreground">
              ⌘K
            </kbd>
            <div className="flex h-7 w-7 items-center justify-center rounded-full bg-orange-600 text-white shrink-0">
              <ArrowUp className="h-3.5 w-3.5" />
            </div>
          </motion.div>
        </motion.div>
      ) : (
        <motion.div
          key="panel"
          layoutId={isFullscreen ? undefined : 'chat-widget'}
          ref={panelRef}
          transition={{ type: 'spring', bounce: 0.2, duration: 0.5 }}
          className={cn(
            'fixed z-50 flex flex-col border border-border bg-card shadow-2xl overflow-hidden',
            isFullscreen
              ? 'inset-0 rounded-none'
              : 'bottom-6 left-1/2 -translate-x-1/2 w-[90%] sm:w-[80%] max-h-[65dvh] rounded-2xl',
          )}
        >
            {/* Panel header */}
            <div className="flex shrink-0 items-center justify-between border-b border-border/60 px-4 py-2.5">
              <div className="flex items-center gap-2">
                <div className="flex h-6 w-6 items-center justify-center rounded-full bg-orange-100 dark:bg-orange-950">
                  <Sparkles className="h-3.5 w-3.5 text-orange-600" />
                </div>
                <span className="text-sm font-semibold text-foreground">Ask Claude</span>
              </div>
              <div className="flex items-center gap-1">
                {messages.length > 0 && (
                  <button
                    onClick={clear}
                    className="flex items-center gap-1 rounded-md px-2 py-1 text-xs text-muted-foreground hover:bg-muted/60 hover:text-foreground transition-colors"
                  >
                    <Trash2 className="h-3 w-3" />Clear
                  </button>
                )}
                {isFullscreen ? (
                  <button
                    onClick={exitFullscreen}
                    className="flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground hover:bg-muted/60 hover:text-foreground transition-colors"
                    title="Restore"
                  >
                    <Minimize2 className="h-3.5 w-3.5" />
                  </button>
                ) : (
                  <button
                    onClick={enterFullscreen}
                    className="flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground hover:bg-muted/60 hover:text-foreground transition-colors"
                    title="Fullscreen"
                  >
                    <Maximize2 className="h-3.5 w-3.5" />
                  </button>
                )}
                <button
                  onClick={closePanel}
                  className="flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground hover:bg-muted/60 hover:text-foreground transition-colors"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
            </div>

            {/* Context chips */}
            <div className="shrink-0 flex items-center flex-wrap gap-1.5 px-4 py-2 bg-muted/5 border-b border-border/30">
              <span className="text-[10px] text-muted-foreground font-medium uppercase tracking-wide">Context:</span>
              {contextChips.map(chip => (
                <span
                  key={chip.label}
                  className="inline-flex items-center gap-1 rounded-full border border-border/60 bg-muted/40 px-2.5 py-0.5 text-[11px] font-medium text-muted-foreground"
                >
                  {chip.dot && <span className={cn('h-1.5 w-1.5 rounded-full shrink-0', chip.dot)} />}
                  {chip.label}
                </span>
              ))}
            </div>

            {/* Messages area (lazy-mounted) */}
            <div className="flex-1 min-h-0 overflow-y-auto px-4 py-4">
              {hasMounted && (
                <AnimatePresence mode="wait">
                  {messages.length === 0 ? (
                    <motion.div
                      key="empty"
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      exit={{ opacity: 0 }}
                      transition={{ duration: 0.15 }}
                    >
                      <div className="mb-3 flex items-center justify-between">
                        <p className="text-xs text-muted-foreground">
                          Ask a question about your decision history:
                        </p>
                        {loadingSuggestions && (
                          <span className="flex items-center gap-1 text-[10px] text-muted-foreground/50">
                            <Loader2 className="h-2.5 w-2.5 animate-spin" />
                            personalising…
                          </span>
                        )}
                      </div>
                      <div className="grid grid-cols-2 gap-2">
                        {suggested.map(({ q, icon: Icon }) => (
                          <button
                            key={q}
                            onClick={() => submit(q)}
                            disabled={!decisions.length}
                            className="flex items-start gap-2 rounded-lg border border-border p-3 text-left text-xs text-muted-foreground hover:border-orange-400 hover:bg-orange-50/10 hover:text-foreground disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                          >
                            <Icon className="h-3.5 w-3.5 mt-0.5 shrink-0 text-orange-500/70" />
                            {q}
                          </button>
                        ))}
                      </div>
                    </motion.div>
                  ) : (
                    <motion.div
                      key="messages"
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      className="space-y-5 pb-2"
                    >
                      {messages.map((msg, i) => (
                        <MessageRow
                          key={msg.id}
                          msg={msg}
                          isStreaming={streaming}
                          isLast={i === lastAssistantIdx}
                          onSave={saveInsight}
                        />
                      ))}
                      <div ref={scrollRef} />
                    </motion.div>
                  )}
                </AnimatePresence>
              )}
            </div>

            {/* Input bar */}
            <div className="shrink-0 border-t border-border/60 px-4 py-3">
              <div className="flex items-end gap-2">
                <textarea
                  ref={inputRef}
                  rows={1}
                  placeholder={decisions.length ? 'Ask about your decisions…' : 'Add documents first'}
                  value={input}
                  onChange={e => setInput(e.target.value)}
                  onKeyDown={handleKeyDown}
                  disabled={!decisions.length || streaming}
                  style={{ resize: 'none' }}
                  className="flex-1 min-h-[36px] max-h-[120px] rounded-xl border border-input bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-orange-500/40 focus-within:border-orange-500/40 disabled:opacity-50 leading-snug overflow-hidden"
                />
                <Button
                  onClick={() => submit(input)}
                  disabled={!input.trim() || !decisions.length || streaming}
                  size="sm"
                  className="bg-orange-600 hover:bg-orange-700 shrink-0 h-9 w-9 p-0 rounded-xl"
                >
                  {streaming
                    ? <Loader2 className="h-4 w-4 animate-spin" />
                    : <ArrowUp className="h-4 w-4" />}
                </Button>
              </div>
              <p className="mt-1.5 text-[10px] text-muted-foreground/60 text-center">
                ⌘K to toggle · ↵ to send · shift+↵ for newline
              </p>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
  )
}

function TypingDots() {
  return (
    <div className="flex items-center gap-1 py-0.5">
      {[0, 1, 2].map(i => (
        <motion.span
          key={i}
          className="block h-1.5 w-1.5 rounded-full bg-muted-foreground"
          animate={{ scale: [1, 1.4, 1], opacity: [0.4, 1, 0.4] }}
          transition={{ duration: 0.9, repeat: Infinity, delay: i * 0.18 }}
        />
      ))}
    </div>
  )
}
