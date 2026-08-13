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
import { useLoraChat } from '@/lib/next/use-lora-chat' // LORAMER_LORA_CHAT_HOOK_V1 — the shared conversation engine
import styles from './chat.module.css'
// LORAMER_CHAT_SHARED_THREAD_V1 — the MESSAGE LIST, the markdown, the working indicator and the COMPOSER
// all come from the shared component now. This file is the desktop shelf's CHROME and nothing else:
// trigger pill, portal, scrim, header, and body-scroll lock, history-back.
import LoraThread from './LoraThread'
import shell from './redesign.module.css' // LORAMER_PORTAL_SEVERS_CSS_VARS_V1 — token scope for the portaled overlay

const SUGGESTIONS = [
  'What were my top hours by spend last month?',
  'Break down my store revenue — gross to net.',
  'How did conversions trend over the last 30 days?',
]

export default function ChatLauncher({ clientId, clientName }: { clientId?: string; clientName?: string }) {
  const [open, setOpen] = useState(false)
  const router = useRouter() // LORAMER_LORA_PAGE_V1
  const [mounted, setMounted] = useState(false)   // LORAMER_NEXT_CHAT_FULLSCREEN_V1 — portal target exists only client-side

  // LORAMER_LORA_CHAT_HOOK_V1 — THE ENGINE. Identical code to what used to live inline here; the shelf
  // is now a thin container over it, and /dashboard-next/lora is a second container over the SAME hook.
  const {
    messages, setMessages, input, setInput, loading, streamStatus, streamingText,
    inputRef, rowCtxRef, threadMaxIdRef, hydratedForRef,
    send, onKeyDown,
  } = useLoraChat({ clientId, clientName, active: open })

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

  // ⛔ THE SHELF'S OWN SCROLL HANDLING IS GONE (LORAMER_CHAT_SHARED_THREAD_V1). It was one line —
  // `scrollRef.current.scrollTop = scrollRef.current.scrollHeight` on every messages/loading change,
  // UNCONDITIONALLY — so scrolling up to read history got yanked back down on the next frame. The page
  // had a 90-line pin/unpin machine for exactly that defect and the shelf never got it. Both surfaces
  // now share `useStickToBottom` via LoraThread; a container reintroducing its own scroll code is a
  // guarded regression (lora-thread-shared.guard.mjs).

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

  useEffect(() => { setMounted(true) }, [])


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
          <div className={styles.panel} onClick={(e) => e.stopPropagation()}>
            <header className={styles.head}>
              <div className={styles.headTitle}><i className="ti ti-sparkles" /> Ask Lora{clientName ? <span className={styles.headClient}>· {clientName}</span> : null}</div>
              <button type="button" className={styles.close} onClick={() => setOpen(false)} aria-label="Close"><i className="ti ti-x" /></button>
            </header>
            <LoraThread
              variant="panel"
              messages={messages}
              loading={loading}
              streamStatus={streamStatus}
              streamingText={streamingText}
              input={input}
              setInput={setInput}
              inputRef={inputRef}
              onKeyDown={onKeyDown}
              send={send}
              clientId={clientId}
              clientName={clientName}
              suggestions={SUGGESTIONS}
              active={open}
            />
          </div>
        </div>,
        document.body,
      )}
    </>
  )
}
