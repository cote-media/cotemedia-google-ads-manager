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
import { useRouter } from 'next/navigation'
import { openLora } from '@/lib/next/open-lora' // LORAMER_LORA_PAGE_V1 — the pill is the fifth trigger
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { useLoraChat, type Msg } from '@/lib/next/use-lora-chat' // LORAMER_LORA_CHAT_HOOK_V1 — the shared conversation engine
import styles from './chat.module.css'
// LORAMER_LORA_WORKING_SHARED_V1 — the mark + status line come from the SHARED component, not from
// chat.module.css. This file is the DESKTOP shelf; /dashboard-next/lora is the phone. One copy, both surfaces.
import { LoraTurn, LoraWorking } from './LoraWorking'
import shell from './redesign.module.css' // LORAMER_PORTAL_SEVERS_CSS_VARS_V1 — token scope for the portaled overlay

const SUGGESTIONS = [
  'What were my top hours by spend last month?',
  'Break down my store revenue — gross to net.',
  'How did conversions trend over the last 30 days?',
]

export default function ChatLauncher({ clientId, clientName }: { clientId?: string; clientName?: string }) {
  const [open, setOpen] = useState(false)
  const router = useRouter() // LORAMER_LORA_PAGE_V1
  const scrollRef = useRef<HTMLDivElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)   // LORAMER_NEXT_CHAT_DEBUG_V1 — measured by the ?debug=chat overlay only
  const dbgRef = useRef<HTMLDivElement>(null)      // LORAMER_NEXT_CHAT_DEBUG_V1
  const [mounted, setMounted] = useState(false)   // LORAMER_NEXT_CHAT_FULLSCREEN_V1 — portal target exists only client-side

  // LORAMER_LORA_CHAT_HOOK_V1 — THE ENGINE. Identical code to what used to live inline here; the shelf
  // is now a thin container over it, and /dashboard-next/lora is a second container over the SAME hook.
  const {
    messages, setMessages, input, setInput, loading, streamStatus,
    debug, probeLine, inputRef, rowCtxRef, threadMaxIdRef, hydratedForRef,
    send, onKeyDown, onComposerFocus,
  } = useLoraChat({ clientId, clientName, active: open, panelRef })

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

  // LORAMER_NEXT_CHAT_DEBUG_V1 — ?debug=chat opens a live HORIZONTAL-AXIS readout (visualViewport.offsetLeft has never
  // been measured; the reverted fix bound offsetTop = the VERTICAL axis, against a horizontal symptom). Detect the param
  // CLIENT-ONLY (post-mount) so there is zero SSR/default-path effect; absent it, `debug` stays false and NOTHING below runs.
  useEffect(() => { setMounted(true) }, [])

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

  return (
    <>
      {/* Trigger — visually the same "Ask Lora" pill it replaces, now a real button. */}
      {/* LORAMER_LORA_PAGE_V1 — the fifth trigger. On mobile this navigates to the full-screen page; on
          desktop it opens the shelf exactly as before. Same helper as the other four, so the branch
          cannot drift between them. */}
      <button type="button" className={styles.trigger} onClick={() => openLora(router.push, clientId)} aria-haspopup="dialog" aria-expanded={open}>
        <i className="ti ti-sparkles" /> Ask Lora
      </button>

      {/* LORAMER_NEXT_CHAT_FULLSCREEN_V1 — PORTALED to document.body. No ancestor defeats position:fixed
          today (verified 2026-07-26 down the whole chain), but this makes that permanent: a future
          transform/filter/contain anywhere in Shell can never contain this overlay. A portal preserves
          the React TREE position, so ChatLauncher does NOT remount and the d55f739 cross-client bleed
          cannot be reintroduced — asserted in Gate-A. Guarded on `mounted` so SSR never touches document. */}
      {open && mounted && createPortal(
        // LORAMER_PORTAL_SEVERS_CSS_VARS_V1 — `shell.tokens` is applied HERE, on the portaled root.
        // The portal moves this subtree out of `.root`, which severs CSS custom property inheritance
        // and left every var(--) in the overlay unresolved: the send button rendered as a white glyph
        // in a transparent circle on a white bar. `.tokens` carries the token declarations and NOTHING
        // else, deliberately — `.root` would also have brought display:flex, min-height:100vh and
        // background:var(--paper) into <body>, i.e. layout nobody asked for.
        <div className={`${shell.tokens} ${styles.scrim}`} onClick={() => setOpen(false)} role="dialog" aria-modal="true" aria-label="Ask Lora">
          <div className={styles.panel} ref={panelRef} onClick={(e) => e.stopPropagation()}>
            <header className={styles.head}>
              <div className={styles.headTitle}><i className="ti ti-sparkles" /> Ask Lora{clientName ? <span className={styles.headClient}>· {clientName}</span> : null}</div>
              <button type="button" className={styles.close} onClick={() => setOpen(false)} aria-label="Close"><i className="ti ti-x" /></button>
            </header>
            {/* LORAMER_NEXT_CHAT_VIEWPORT_PROBE_V1 — UNMISSABLE readout. The previous one was a 12px
                sticky box INSIDE the message list; on 2026-07-26 it produced no reading at all. This is
                a flex child of .panel directly under the header, so it cannot be scrolled away, cannot
                be pushed off by the keyboard, and is sized to be read on a phone at arm's length.
                Debug-gated: renders nothing at all without the flag. */}
            {debug && (
              <div className={styles.probeBar} aria-hidden="true">
                {probeLine || 'PROBE ARMED — tap the message box'}
              </div>
            )}

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
                    {/* LORAMER_LORA_WORKING_SHARED_V1 — an assistant turn is LoraTurn: the static mark on the
                        page background, then the bubble. Same element and same position the working state
                        used, so nothing jumps when the answer arrives. A user turn keeps its bare bubble. */}
                    {m.role === 'assistant' ? (
                      <LoraTurn>
                        <div className={styles.bubbleAssistant}>
                          <div className={styles.md}><ReactMarkdown remarkPlugins={[remarkGfm]}>{m.content}</ReactMarkdown></div>
                        </div>
                      </LoraTurn>
                    ) : (
                      <div className={styles.bubbleUser}>{m.content}</div>
                    )}
                  </div>
                ))
              )}
              {loading && (
                /* LORAMER_LORA_WORKING_SHARED_V1 — ⛔ NO CONTAINER. This used to sit inside .bubbleAssistant,
                   a rounded grey box, which said "this is a message from Lora" about a thing that is not a
                   message. The mark and the line now render on the page background, and LoraWorking reserves
                   the vertical space the answer will fill — no skeleton, no shimmer, nothing pushed down.
                   ONE mark, not the two that used to stack here. */
                <div className={styles.rowAssistant}>
                  <LoraWorking status={streamStatus} />
                </div>
              )}
            </div>

            <div className={styles.inputBar}>
              <textarea
                ref={inputRef}
                className={styles.input}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={onKeyDown}
                onFocus={onComposerFocus}   // LORAMER_NEXT_CHAT_VIEWPORT_PROBE_V1 — no-op unless the debug flag is on
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
