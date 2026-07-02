// LORAMER_NEXT_PARITY_V1 (P2 increment A) — the redesign-native Ask-Lora chat.
// -NEXT-ONLY. Thin client over the SHARED /api/chat (owner-scoped, zero backend change): it self-fetches
// intelligence from clientId and runs the shared tool loop (query_metrics/query_breakdown/query_money), so this
// component just holds the conversation and renders { response }. Desktop = right-docked slide-over; mobile =
// full-screen sheet (responsive via chat.module.css; keyboard-aware input pinned to the bottom, per the mobile
// gospel). Trigger = the "Ask Lora" pill (rendered here) AND a window 'loramer:open-chat' event (dispatched by the
// mobile Lora tab). Ambient window = LAST_30_DAYS (the CardEngine default); Lora fetches any specific period via the
// query tools. Binding the live shared CardEngine period is a trivial follow-up (that state isn't lifted to Shell).
'use client'
import { useState, useRef, useEffect, useCallback } from 'react'
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

  // Any surface (mobile Lora tab, a card CTA) can open the chat by dispatching this event.
  useEffect(() => {
    const openIt = () => setOpen(true)
    window.addEventListener('loramer:open-chat', openIt)
    return () => window.removeEventListener('loramer:open-chat', openIt)
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
          dateRange: 'LAST_30_DAYS',
          location: 'chat',
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
  }, [messages, loading, clientId, clientName])

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
        <div className={styles.scrim} onClick={() => setOpen(false)} role="dialog" aria-modal="true" aria-label="Ask Lora">
          <div className={styles.panel} onClick={(e) => e.stopPropagation()}>
            <header className={styles.head}>
              <div className={styles.headTitle}><i className="ti ti-sparkles" /> Ask Lora{clientName ? <span className={styles.headClient}>· {clientName}</span> : null}</div>
              <button type="button" className={styles.close} onClick={() => setOpen(false)} aria-label="Close"><i className="ti ti-x" /></button>
            </header>

            <div className={styles.scroll} ref={scrollRef}>
              {messages.length === 0 ? (
                <div className={styles.empty}>
                  <p className={styles.emptyLead}>Ask about this client’s performance — spend, revenue, breakdowns, or how the money splits.</p>
                  <div className={styles.suggestions}>
                    {SUGGESTIONS.map((s) => (
                      <button key={s} type="button" className={styles.suggestion} onClick={() => send(s)}>{s}</button>
                    ))}
                  </div>
                </div>
              ) : (
                messages.map((m, i) => (
                  <div key={i} className={m.role === 'user' ? styles.rowUser : styles.rowAssistant}>
                    <div className={m.role === 'user' ? styles.bubbleUser : styles.bubbleAssistant}>{m.content}</div>
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
