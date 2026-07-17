// LORAMER_NEXT_PARITY_V1 (P2 increment A) — the redesign-native Ask-Lora chat.
// -NEXT-ONLY. Thin client over the SHARED /api/chat (owner-scoped, zero backend change): it self-fetches
// intelligence from clientId and runs the shared tool loop (query_metrics/query_breakdown/query_money), so this
// component just holds the conversation and renders { response }. Desktop = right-docked slide-over; mobile =
// full-screen sheet (responsive via chat.module.css; keyboard-aware input pinned to the bottom, per the mobile
// gospel). Trigger = the "Ask Lora" pill (rendered here) AND a window 'loramer:open-chat' event (dispatched by the
// mobile Lora tab). Ambient window FOLLOWS the shared CardEngine date picker via period-bus (default LAST_30_DAYS
// until a page picker is seen); Lora still fetches any explicit period via the tools. Replies render markdown
// (bold/lists/tables) via react-markdown + remark-gfm; tables scroll on mobile. (LORAMER_NEXT_CHAT_POLISH_V1.)
'use client'
import { useState, useRef, useEffect, useCallback } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { getSharedPeriod, type SharedPeriod } from '@/lib/next/period-bus'
import styles from './chat.module.css'

type Msg = { role: 'user' | 'assistant'; content: string }

const SUGGESTIONS = [
  'What were my top hours by spend last month?',
  'Break down my store revenue — gross to net.',
  'How did conversions trend over the last 30 days?',
]

export default function ChatLauncher({ clientId, clientName }: { clientId?: string; clientName?: string }) {
  const [open, setOpen] = useState(false)
  const [messages, setMessages] = useState<Msg[]>([])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const scrollRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const scrimRef = useRef<HTMLDivElement>(null) // LORAMER_NEXT_CHAT_VISUAL_VIEWPORT_V1 — the fixed sheet, bound to visualViewport below
  const [period, setPeriod] = useState<SharedPeriod>(() => getSharedPeriod())
  const rowCtxRef = useRef<string | null>(null) // LORAMER_NEXT_PLATFORM_PAGE_V1 — optional per-row context carried into /api/chat (additive; /api/chat already accepts rowContext)

  // Any surface (mobile Lora tab, a drill row's ✦) can open the chat by dispatching this event; detail may carry
  // { rowContext, prompt } to open Lora focused on a specific entity. No detail → identical to before.
  useEffect(() => {
    const openIt = (e: Event) => {
      const d = (e as CustomEvent).detail as { rowContext?: string; prompt?: string } | undefined
      if (d?.rowContext) rowCtxRef.current = d.rowContext
      if (d?.prompt) setInput(d.prompt)
      setOpen(true)
    }
    window.addEventListener('loramer:open-chat', openIt)
    return () => window.removeEventListener('loramer:open-chat', openIt)
  }, [])

  // clear any carried row context when the panel closes (a fresh open without context starts clean).
  useEffect(() => { if (!open) rowCtxRef.current = null }, [open])

  // Ambient window follows the shared CardEngine date picker (period-bus): seed on mount + subscribe to changes.
  useEffect(() => {
    setPeriod(getSharedPeriod())
    const onPeriod = (e: Event) => { const d = (e as CustomEvent).detail; if (d) setPeriod(d as SharedPeriod) }
    window.addEventListener('loramer:period', onPeriod)
    return () => window.removeEventListener('loramer:period', onPeriod)
  }, [])

  // Esc closes; focus the input + scroll to the newest message when open/updated.
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false) }
    window.addEventListener('keydown', onKey)
    const t = setTimeout(() => inputRef.current?.focus(), 60)
    return () => { window.removeEventListener('keydown', onKey); clearTimeout(t) }
  }, [open])

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight
  }, [messages, loading])

  // LORAMER_NEXT_CHAT_VISUAL_VIEWPORT_V1 — the sheet is position:fixed but sized in dvh, and dvh does NOT shrink for
  // the on-screen keyboard (only for the address bar). Bind the fixed .scrim to the VISUAL viewport — its height and
  // top offset — so the sheet covers exactly the visible area and tracks the keyboard raise/dismiss. This fixes the
  // pan-on-dismiss AND the page bleeding through the gap (both were the sheet not knowing where the screen actually is).
  // We drive the .scrim (the position:fixed element, where top/height are honored directly) rather than the .panel (a
  // static flex child whose transform would fight the slideUp animation); .panel is height:100% so it tracks the scrim.
  // We do NOT touch the browser's own scroll-into-view. If window.visualViewport is absent, the CSS vars stay unset and
  // .scrim/.panel fall back to 100dvh (degraded, not broken).
  useEffect(() => {
    if (!open) return
    const vv = window.visualViewport
    if (!vv) return
    const sync = () => {
      const el = scrimRef.current
      if (!el) return
      el.style.setProperty('--chat-h', `${vv.height}px`)
      el.style.setProperty('--chat-top', `${vv.offsetTop}px`)
    }
    sync()
    vv.addEventListener('resize', sync)
    vv.addEventListener('scroll', sync)
    return () => {
      vv.removeEventListener('resize', sync)
      vv.removeEventListener('scroll', sync)
    }
  }, [open])

  const send = useCallback(async (text: string) => {
    const q = text.trim()
    if (!q || loading) return
    const next = [...messages, { role: 'user' as const, content: q }]
    setMessages(next)
    setInput('')
    setLoading(true)
    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: q,
          history: messages, // prior turns only (server appends the new message from `message`)
          clientId,
          clientName,
          dateRange: period.dateRange || 'LAST_30_DAYS',
          customStart: period.customStart,
          customEnd: period.customEnd,
          location: 'chat',
          ...(rowCtxRef.current ? { rowContext: rowCtxRef.current } : {}), // LORAMER_NEXT_PLATFORM_PAGE_V1 — per-row focus (drill ✦); absent otherwise
        }),
      })
      const d = await res.json().catch(() => ({}))
      const reply = res.ok
        ? (d.response || 'I wasn’t able to complete that — please try rephrasing.')
        : (d.error === 'Client not found'
            ? 'I can’t access this client’s data from here.'
            : 'Something went wrong reaching Lora. Please try again.')
      setMessages((m) => [...m, { role: 'assistant', content: reply }])
    } catch {
      setMessages((m) => [...m, { role: 'assistant', content: 'Network error reaching Lora. Please try again.' }])
    } finally {
      setLoading(false)
    }
  }, [messages, loading, clientId, clientName, period])

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(input) }
  }

  return (
    <>
      {/* Trigger — visually the same "Ask Lora" pill it replaces, now a real button. */}
      <button type="button" className={styles.trigger} onClick={() => setOpen(true)} aria-haspopup="dialog" aria-expanded={open}>
        <i className="ti ti-sparkles" /> Ask Lora
      </button>

      {open && (
        <div ref={scrimRef} className={styles.scrim} onClick={() => setOpen(false)} role="dialog" aria-modal="true" aria-label="Ask Lora">
          <div className={styles.panel} onClick={(e) => e.stopPropagation()}>
            <header className={styles.head}>
              <div className={styles.headTitle}><i className="ti ti-sparkles" /> Ask Lora{clientName ? <span className={styles.headClient}>· {clientName}</span> : null}</div>
              <button type="button" className={styles.close} onClick={() => setOpen(false)} aria-label="Close"><i className="ti ti-x" /></button>
            </header>

            <div className={styles.scroll} ref={scrollRef}>
              {messages.length === 0 ? (
                <div className={styles.empty}>
                  {/* LORAMER_NEXT_CHAT_EMPTYSTATE_NAME_V1 — name the client when there IS one. clientId is the real-client
                      signal (clientName defaults to "All clients" on the portfolio Shell, which must NOT become a possessive). */}
                  <p className={styles.emptyLead}>{clientId && clientName ? `Ask about ${clientName}’s performance — spend, revenue, breakdowns, or how the money splits.` : 'Ask about this client’s performance — spend, revenue, breakdowns, or how the money splits.'}</p>
                  <div className={styles.suggestions}>
                    {SUGGESTIONS.map((s) => (
                      <button key={s} type="button" className={styles.suggestion} onClick={() => send(s)}>{s}</button>
                    ))}
                  </div>
                </div>
              ) : (
                messages.map((m, i) => (
                  <div key={i} className={m.role === 'user' ? styles.rowUser : styles.rowAssistant}>
                    <div className={m.role === 'user' ? styles.bubbleUser : styles.bubbleAssistant}>
                      {m.role === 'user'
                        ? m.content
                        : <div className={styles.md}><ReactMarkdown remarkPlugins={[remarkGfm]}>{m.content}</ReactMarkdown></div>}
                    </div>
                  </div>
                ))
              )}
              {loading && (
                <div className={styles.rowAssistant}><div className={styles.bubbleAssistant}><span className={styles.typing}><i /><i /><i /></span></div></div>
              )}
            </div>

            <div className={styles.inputBar}>
              <textarea
                ref={inputRef}
                className={styles.input}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={onKeyDown}
                placeholder="Ask Lora…"
                rows={1}
              />
              <button type="button" className={styles.sendBtn} onClick={() => send(input)} disabled={!input.trim() || loading} aria-label="Send">
                <i className="ti ti-arrow-up" />
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
