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
import { createPortal } from 'react-dom' // LORAMER_NEXT_CHAT_FULLSCREEN_V1
import { readChatResponse, CHAT_IDLE_GAP_MS, CHAT_TOTAL_MS } from '@/lib/chat-stream-read' // LORAMER_CHAT_STREAMING_V1
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { getSharedPeriod, type SharedPeriod } from '@/lib/next/period-bus'
import { classifyTurnFailure, pickRecoveredAnswer, COPY, RECOVERY_WINDOW_MS, RECOVERY_POLL_MS } from '@/lib/next/chat-recovery' // LORAMER_CHAT_ANSWER_RECOVERY_V1
import { logNextConversationTurn, NEXT_CHAT_SURFACE } from '@/lib/next/log-conversation-turn' // LORAMER_NEXT_CONV_WRITE_V1 — persist turns (closes the -next write island); NEXT_CHAT_SURFACE also keys the fetch-on-open below
import styles from './chat.module.css'

type Msg = { role: 'user' | 'assistant'; content: string; recoveryKey?: string }

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
  const [period, setPeriod] = useState<SharedPeriod>(() => getSharedPeriod())
  const [streamStatus, setStreamStatus] = useState<string | null>(null) // LORAMER_CHAT_STREAMING_V1 — transient working copy
  const rowCtxRef = useRef<string | null>(null) // LORAMER_NEXT_PLATFORM_PAGE_V1 — optional per-row context carried into /api/chat (additive; /api/chat already accepts rowContext)
  const threadMaxIdRef = useRef<number | null>(null) // LORAMER_CHAT_ANSWER_RECOVERY_V1 — watermark for recovery
  const hydratedForRef = useRef<string | null>(null) // LORAMER_CHAT_FETCH_ON_OPEN_V1 — clientId whose DB history has been loaded into this instance
  const panelRef = useRef<HTMLDivElement>(null)   // LORAMER_NEXT_CHAT_DEBUG_V1 — measured by the ?debug=chat overlay only
  const dbgRef = useRef<HTMLDivElement>(null)      // LORAMER_NEXT_CHAT_DEBUG_V1
  const [mounted, setMounted] = useState(false)   // LORAMER_NEXT_CHAT_FULLSCREEN_V1 — portal target exists only client-side
  const [debug, setDebug] = useState(false)        // LORAMER_NEXT_CHAT_DEBUG_V1 — true only when ?debug=chat is in the URL

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

  // LORAMER_NEXT_CHAT_FULLSCREEN_V1 — BODY SCROLL LOCK. The message list is the only scroller we want
  // moving; without this the document underneath was still scrollable and the drag chained to it once
  // .scroll hit an edge. Restores the PRIOR inline value, not a hardcoded '' — another effect may own
  // body.overflow and clobbering it would be a silent regression elsewhere.
  useEffect(() => {
    if (!open) return
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => { document.body.style.overflow = prev }
  }, [open])

  // LORAMER_NEXT_CHAT_FULLSCREEN_V1 — BACK CLOSES THE CHAT, and never navigates. On open we push ONE
  // history entry tagged as ours; a back gesture/button pops it and popstate closes the panel. If the
  // panel is closed any OTHER way (X, scrim, Esc) we consume our own entry with history.back() so no
  // phantom entry survives to swallow a later back press. ownedRef is what distinguishes "our entry is
  // still on the stack" from "the user already popped it", so we never call back() twice.
  const historyOwnedRef = useRef(false)
  useEffect(() => {
    if (!open) return
    window.history.pushState({ loramerChat: true }, '')
    historyOwnedRef.current = true
    const onPop = () => { historyOwnedRef.current = false; setOpen(false) }
    window.addEventListener('popstate', onPop)
    return () => {
      window.removeEventListener('popstate', onPop)
      // Closed by X / scrim / Esc / unmount while our entry is still on the stack → consume it.
      if (historyOwnedRef.current) { historyOwnedRef.current = false; window.history.back() }
    }
  }, [open])


  // LORAMER_CHAT_PERSISTENCE_LAW / LORAMER_CHAT_FETCH_ON_OPEN_V1 — ports the legacy fetch-on-open the -next panel never
  // had (dashboard/page.tsx openPanel, LORAMER_CONV_API_V1_OPENPANEL / LORAMER_CONV_API_V1_CHATTAB). On first open FOR
  // THE CURRENT CLIENT, load that client's own thread from the DB (surface=next-ask-lora, all scopes = the one visible
  // thread) and REPLACE the in-memory messages with it — so the panel always shows THIS client's history (empty if
  // none), never a carried-over thread. Guarded per-clientId (hydratedForRef): fetched once per client so a
  // mid-conversation reopen keeps the live in-memory turns (whose fire-and-forget DB writes may still be settling)
  // instead of clobbering them with a stale read. Belt-and-suspenders with the Shell key={clientId} remount: even if
  // this instance were reused across a switch, a clientId change re-hydrates on the next open.
  useEffect(() => {
    if (!open) return
    const cid = clientId || null
    if (hydratedForRef.current === cid) return
    hydratedForRef.current = cid
    if (!cid) { setMessages([]); return }   // portfolio Shell (no real client) — nothing to load
    let cancelled = false
    ;(async () => {
      try {
        const params = new URLSearchParams({ clientId: cid, surface: NEXT_CHAT_SURFACE })
        const r = await fetch('/api/conversations?' + params.toString())
        const d = await r.json().catch(() => ({}))
        const rows = Array.isArray(d.messages) ? d.messages : []
        threadMaxIdRef.current = rows.reduce((mx: number, m: { id?: number }) => Math.max(mx, Number(m?.id) || 0), 0) || null // LORAMER_CHAT_ANSWER_RECOVERY_V1
        const prior = rows.map((m: { role: 'user' | 'assistant'; content: string }) => ({ role: m.role, content: m.content }))
        if (!cancelled) setMessages(prior)   // this client's OWN history (empty array if none) — never the prior client's
      } catch { /* a failed load must not blank a live thread or cross-contaminate — leave the fresh-mount empty state */ }
    })()
    return () => { cancelled = true }
  }, [open, clientId])

  // LORAMER_NEXT_CHAT_DEBUG_V1 — ?debug=chat opens a live HORIZONTAL-AXIS readout (visualViewport.offsetLeft has never
  // been measured; the reverted fix bound offsetTop = the VERTICAL axis, against a horizontal symptom). Detect the param
  // CLIENT-ONLY (post-mount) so there is zero SSR/default-path effect; absent it, `debug` stays false and NOTHING below runs.
  useEffect(() => { setMounted(true) }, [])
  useEffect(() => {
    try { setDebug(new URLSearchParams(window.location.search).get('debug') === 'chat') } catch { /* URL unavailable — stay off */ }
  }, [])

  // LORAMER_NEXT_CHAT_DEBUG_V1 — the readout. GUARD (proven in Gate-A): early-returns unless debug===true → with no param,
  // ZERO listeners, ZERO interval, ZERO DOM writes. Writes textContent/title/placeholder directly (no React re-render).
  // The v1 floating overlay panned off-screen WITH the sheet (every fixed element does, regardless of z-index — a finding),
  // so the readout is IN-FLOW (sticky inside the message list) and mirrored to document.title + the input placeholder.
  // It tracks the PEAK |value| each number reaches while open: the pan may spike then settle to 0, so the peak is the
  // signal and the current value is a lie. Re-runs on `open` → peaks reset per open (fresh measurement each time).
  useEffect(() => {
    if (!debug) return
    const vv = typeof window !== 'undefined' ? window.visualViewport : null // may be undefined — guarded everywhere below
    const peaks: Record<string, number> = {}
    const titleWas = document.title
    const fmt = (v: number | undefined | null, d = 0) => (v == null || Number.isNaN(v) ? '—' : v.toFixed(d))
    const trk = (k: string, v: number | undefined | null, d = 0) => { // track peak |value|, return "current / pk<peak>"
      if (v == null || Number.isNaN(v)) return `— / pk${fmt(peaks[k] ?? 0, d)}`
      peaks[k] = Math.max(peaks[k] ?? 0, Math.abs(v))
      return `${v.toFixed(d)} / pk${peaks[k].toFixed(d)}`
    }
    const update = () => {
      const panel = panelRef.current?.getBoundingClientRect()
      const scroll = scrollRef.current
      const table = scrollRef.current?.querySelector('table') as HTMLElement | null // .md table is display:block; overflow-x:auto → itself the scroller
      const de = document.scrollingElement as HTMLElement | null
      const docRect = document.documentElement.getBoundingClientRect()
      const lines = [
        `vv.offsetLeft   ${vv ? trk('voL', vv.offsetLeft, 1) : 'no-vv'}   <- THE number`,
        `vv.offsetTop    ${vv ? trk('voT', vv.offsetTop, 1) : 'no-vv'}`,
        `vv.pageLeft     ${vv ? fmt(vv.pageLeft, 1) : 'no-vv'}`,
        `vv.width/inner  ${vv ? fmt(vv.width) : 'no-vv'} / ${fmt(window.innerWidth)}`,
        `window.scrollX  ${trk('wsx', window.scrollX, 1)}`,
        `docEl.rect.left ${trk('drl', docRect.left, 1)}`,
        `docEl.scrollL   ${trk('dsl', de?.scrollLeft, 1)}`,
        `panel.left/w    ${trk('pnl', panel?.left, 1)} / ${fmt(panel?.width)}`,
        `.scroll L/sw/cw ${trk('scl', scroll?.scrollLeft)} / ${fmt(scroll?.scrollWidth)} / ${fmt(scroll?.clientWidth)}`,
        `table   L/sw/cw ${table ? `${trk('tbl', table.scrollLeft)} / ${fmt(table.scrollWidth)} / ${fmt(table.clientWidth)}` : 'no-table'}`,
      ]
      if (dbgRef.current) dbgRef.current.textContent = lines.join('\n')       // PRIMARY — in-flow, survives (Russ scrolls to it)
      document.title = vv ? `oL ${fmt(vv.offsetLeft)}/pk${fmt(peaks['voL'] ?? 0)} pL ${fmt(panel?.left)}/pk${fmt(peaks['pnl'] ?? 0)}` : 'no-vv' // tab backstop
      if (inputRef.current) inputRef.current.placeholder = vv ? `oL ${fmt(vv.offsetLeft)}/pk${fmt(peaks['voL'] ?? 0)} · pL ${fmt(panel?.left)}/pk${fmt(peaks['pnl'] ?? 0)}` : 'Ask Lora…' // placeholder backstop
    }
    update()
    // 'scroll' with capture:true catches NESTED-element scrolls (scroll events don't bubble) + the vv pan events + resize.
    window.addEventListener('scroll', update, true)
    window.addEventListener('resize', update)
    vv?.addEventListener('resize', update)
    vv?.addEventListener('scroll', update)
    const iv = window.setInterval(update, 120) // poll fast — the pan may be transient, and peak-tracking needs the samples
    return () => {
      window.removeEventListener('scroll', update, true)
      window.removeEventListener('resize', update)
      vv?.removeEventListener('resize', update)
      vv?.removeEventListener('scroll', update)
      window.clearInterval(iv)
      document.title = titleWas
      if (inputRef.current) inputRef.current.placeholder = 'Ask Lora…'
    }
  }, [debug, open])

  const send = useCallback(async (text: string) => {
    const q = text.trim()
    if (!q || loading) return
    // LORAMER_NEXT_CONV_WRITE_V1 — snapshot the drill focus at turn start so BOTH turns of one exchange share a
    // scope even if the panel closes mid-flight (rowCtxRef is cleared on close). 'drill' = opened from a drill row.
    const turnScope = rowCtxRef.current ? 'drill' : null
    const next = [...messages, { role: 'user' as const, content: q }]
    setMessages(next)
    setInput('')
    setLoading(true)
    // LORAMER_NEXT_CONV_WRITE_V1 — persist the USER turn (fire-and-forget; never awaited, never throws). Logged
    // regardless of whether the reply below succeeds — the user really said it, exactly as the legacy surfaces log.
    logNextConversationTurn({ clientId, role: 'user', content: q, scope: turnScope })
    // LORAMER_CHAT_CLIENT_ABORT_V1 — a DELIBERATE client-side ceiling SHORTER than the server maxDuration (300s), so a
    // slow turn fails at a KNOWN bound with an HONEST message instead of at an unknown browser/gateway limit that
    // surfaced a misleading "Network error." 120s clears the observed ~59s worst case (and heavier multi-tool turns),
    // so normal turns are untouched. Stopgap; the durable fix is streaming (★CHAT-STREAMING).
    // LORAMER_CHAT_STREAMING_V1 — IDLE-GAP, not total-duration. A streamed turn has no meaningful total bound; a
    // DEAD one stops producing bytes. The timer is re-armed on every SSE event, so a legitimately long multi-tool
    // answer never trips it while a dropped connection is caught in 45s. With streaming OFF nothing re-arms it and
    // it degrades to exactly the original 120s total cap — byte-identical behavior, one timer, no second code path.
    // LORAMER_CHAT_ANSWER_RECOVERY_V1 — DUAL DEADLINE. The old rearmIdle REPLACED the total cap, so once
    // the first event arrived the absolute ceiling vanished and a stream dripping one byte every 40s ran
    // forever. The ABSOLUTE deadline is now set once and never re-armed; the IDLE timer arms only AFTER the
    // first SSE event (rearmIdle is called from the event callback), so with streaming OFF — no events ever —
    // the total cap alone governs and a healthy 200s blocking turn is never killed by an idle gap it was not
    // in. Every re-arm is CLAMPED to the remaining time, so the deadline always wins.
    const controller = new AbortController()
    const deadlineAt = Date.now() + CHAT_TOTAL_MS
    let abortTimer = setTimeout(() => controller.abort(), CHAT_TOTAL_MS)
    const rearmIdle = () => {
      clearTimeout(abortTimer)
      abortTimer = setTimeout(() => controller.abort(), Math.max(0, Math.min(CHAT_IDLE_GAP_MS, deadlineAt - Date.now())))
    }
    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        signal: controller.signal,
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
          // LORAMER_CHAT_SERVER_TURN_WRITE_V1 — declare the conversation target so the SERVER writes
          // the assistant turn. This is what moves ownership; without it the server writes nothing.
          persistTurn: { surface: NEXT_CHAT_SURFACE, scope: turnScope },
          ...(rowCtxRef.current ? { rowContext: rowCtxRef.current } : {}), // LORAMER_NEXT_PLATFORM_PAGE_V1 — per-row focus (drill ✦); absent otherwise
        }),
      })
      const d = await readChatResponse(res, (ev, data, live) => {
        rearmIdle()
        // LIVE RENDER. `live` is the answer text accumulated so far, so the user watches it appear instead of a
        // spinner. On a tool event the reader has already cleared it (preamble is narration, not answer) and we
        // show what Lora is actually doing. All of this is TRANSIENT — cleared in the finally block, and
        // logNextConversationTurn still fires only on the authoritative answer, so nothing provisional persists.
        if (ev === 'tool' && data?.name) setStreamStatus(`Checking ${String(data.name).replace(/_/g, ' ')}…`)
        else if (ev === 'delta') setStreamStatus(live || null)
      })
      // LORAMER_CHAT_FAILURE_BRANCHES_V1 — EVERY failure mode gets its OWN sentence. Before this, a 503 from an
      // exhausted model chain and a 500 from a real bug rendered the SAME string, so the user could not tell
      // "Anthropic is busy, retry in a minute" from "something is broken, tell Russ" — and neither could we,
      // reading a screenshot. The `error` codes are machine-readable and set by the route, not sniffed from prose.
      const reply = d.ok
        ? (d.response || 'I wasn’t able to complete that — please try rephrasing.')
        : d.error === 'Client not found'
          ? 'I can’t access this client’s data from here.'
          : d.error === 'overloaded'
            // Chain exhausted: every model was busy. This is Anthropic-side capacity, NOT your data and NOT a
            // bug — say so, because the honest action is "wait and re-ask", not "report a problem".
            ? 'Claude is overloaded right now — I tried every model available to me and all of them were busy. Nothing is wrong with your data or your connection. Please try again in a minute.'
            : 'Something went wrong on my side — this is an error, not a busy model. Please try again, and if it keeps happening it’s worth flagging.'
      setMessages((m) => [...m, { role: 'assistant', content: reply }])
      // LORAMER_CHAT_SERVER_TURN_WRITE_V1 — the assistant turn is written SERVER-SIDE by /api/chat,
      // from inside the stream close path. It is NOT written here and must never be: this line ran
      // only if the browser survived the read, which is how two answers were lost on 2026-07-26.
      // The user turn above stays client-side (unchanged this slice).
    } catch (e) {
      // LORAMER_CHAT_ANSWER_RECOVERY_V1 (amends LORAMER_CHAT_CLIENT_ABORT_V1 + LORAMER_CHAT_FAILURE_BRANCHES_V1).
      // Classify on the SIGNAL WE OWN, not the error's name: iOS Safari reports an abort as
      // `TypeError: Load failed`, identical to a real network drop, which is how a COMPLETED turn rendered as
      // "the connection dropped" on 2026-07-26. No string here may assert the answer was lost — since the
      // server persists the assistant turn from its own completion path, that claim is false and unknowable.
      const kind = classifyTurnFailure(controller.signal.aborted, e)
      // ONE bubble, keyed, replaced in place — never a second bubble appended.
      const key = `rec:${Date.now()}`
      setMessages((m) => [...m, { role: 'assistant', content: COPY.CHECKING, recoveryKey: key }])
      const replace = (content: string) =>
        setMessages((m) => m.map((x) => (x.recoveryKey === key ? { role: 'assistant' as const, content } : x)))
      // RECOVERY IS A READ. It re-fetches the thread; it NEVER re-POSTs /api/chat. A silent retry would
      // double the spend on a turn that most likely already succeeded.
      let done = false
      const since = threadMaxIdRef.current
      if (clientId && since != null) {
        const until = Date.now() + RECOVERY_WINDOW_MS
        while (!done && Date.now() < until) {
          try {
            const params = new URLSearchParams({ clientId, surface: NEXT_CHAT_SURFACE })
            const rr = await fetch('/api/conversations?' + params.toString())
            const dd = await rr.json().catch(() => ({}))
            const got = pickRecoveredAnswer(Array.isArray(dd.messages) ? dd.messages : [], since)
            if (got.status === 'found') { threadMaxIdRef.current = got.maxId; replace(got.text); done = true; break }
            if (got.status === 'ambiguous') { replace(COPY.AMBIGUOUS); done = true; break }
          } catch { /* a failed recovery read must never throw into the turn */ }
          await new Promise((r) => setTimeout(r, RECOVERY_POLL_MS))
        }
      }
      if (!done) {
        // The answer may still land after our window closes (server maxDuration 300s > our 240s), so force
        // the next open to re-read the thread rather than trusting the per-client hydration guard.
        hydratedForRef.current = null
        replace(kind === 'aborted' ? COPY.ABORTED_UNCONFIRMED : COPY.NETWORK_UNCONFIRMED)
      }
    } finally {
      clearTimeout(abortTimer)
      setStreamStatus(null)
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

      {/* LORAMER_NEXT_CHAT_FULLSCREEN_V1 — PORTALED to document.body. No ancestor defeats position:fixed
          today (verified 2026-07-26 down the whole chain), but this makes that permanent: a future
          transform/filter/contain anywhere in Shell can never contain this overlay. A portal preserves
          the React TREE position, so ChatLauncher does NOT remount and the d55f739 cross-client bleed
          cannot be reintroduced — asserted in Gate-A. Guarded on `mounted` so SSR never touches document. */}
      {open && mounted && createPortal(
        <div className={styles.scrim} onClick={() => setOpen(false)} role="dialog" aria-modal="true" aria-label="Ask Lora">
          <div className={styles.panel} ref={panelRef} onClick={(e) => e.stopPropagation()}>
            <header className={styles.head}>
              <div className={styles.headTitle}><i className="ti ti-sparkles" /> Ask Lora{clientName ? <span className={styles.headClient}>· {clientName}</span> : null}</div>
              <button type="button" className={styles.close} onClick={() => setOpen(false)} aria-label="Close"><i className="ti ti-x" /></button>
            </header>

            <div className={styles.scroll} ref={scrollRef}>
              {/* LORAMER_NEXT_CHAT_DEBUG_V1 — in-flow horizontal-axis readout; only mounts with ?debug=chat. Sticky to the
                  top of the message list; pans with the sheet but is readable after the pan settles (peak-tracked). */}
              {debug && <div ref={dbgRef} className={styles.debug} aria-hidden="true" />}
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
                <div className={styles.rowAssistant}><div className={styles.bubbleAssistant}>
                  {/* LORAMER_CHAT_STREAMING_V1 — the spinner is what made a slow turn indistinguishable from a dead
                      one. When streaming is on, replace it with what Lora is ACTUALLY doing. Transient: cleared in
                      the finally block, never persisted, never logged as a turn. */}
                  {streamStatus
                    ? <span className={styles.streamStatus}>{streamStatus}</span>
                    : <span className={styles.typing}><i /><i /><i /></span>}
                </div></div>
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
        </div>,
        document.body,
      )}
    </>
  )
}
