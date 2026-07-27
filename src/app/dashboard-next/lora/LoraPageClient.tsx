// LORAMER_LORA_PAGE_V1 — full-screen mobile Lora. The SECOND container over the shared engine
// (LORAMER_LORA_CHAT_HOOK_V1); the desktop shelf is the first. No forked send loop, no forked
// recovery, no forked persistence.
//
// WHY A PAGE AND NOT AN OVERLAY: six overlay attempts failed on the iOS keyboard. The probe
// (LORAMER_LORA_PAGE_PROBE_V1) measured a real document keeping the composer clear by +308px with
// ZERO geometry computed by us. So: DOCUMENT scrolls, list is long content, composer is an ordinary
// in-flow element. Nothing here is position:fixed and nothing uses dvh.
//
// ⚠ THE PROBE ALSO FALSIFIED THE FREE-LUNCH HALF: iOS does NOT scroll the composer into view on focus
// (clearance −2013 at scrollY 149, −761 at 1475, +308 only at the bottom). So scroll position is
// MANAGED EXPLICITLY below — on mount, on every new message, and on composer focus.
//
// ⚠ RENDERS OUTSIDE <Shell>, therefore outside `.root`, therefore it MUST carry `.tokens` —
// LORAMER_PORTAL_SEVERS_CSS_VARS_V1. Without it every colour dies exactly as the send button did.
'use client'
import { useEffect, useRef } from 'react'
import { useRouter } from 'next/navigation'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { useLoraChat } from '@/lib/next/use-lora-chat'
import shell from '@/components/redesign/redesign.module.css'
import styles from './lora-page.module.css'

export default function LoraPageClient({ clientId, clientName }: { clientId?: string; clientName?: string }) {
  const router = useRouter()
  const endRef = useRef<HTMLDivElement>(null)
  const rootRef = useRef<HTMLDivElement>(null)
  const {
    messages, input, setInput, loading, streamStatus, debug, probeLine,
    inputRef, send, onKeyDown, onComposerFocus,
  } = useLoraChat({ clientId, clientName, active: true, panelRef: rootRef })

  // SCROLL IS OURS TO MANAGE — the probe proved iOS will not do it.
  // (a) on mount, so an existing thread opens at the newest turn rather than the oldest.
  // ⚠ SCROLL THE DOCUMENT, NOT A SENTINEL INSIDE THE LIST. The first cut called
  // endRef.scrollIntoView({block:'end'}), and Gate-A measured it landing 85px SHORT of the bottom —
  // because the sentinel is the last child of `.list` and the COMPOSER sits after `.list`. Scrolling
  // the sentinel into view therefore leaves the composer, the one element that must be visible,
  // exactly its own height below the fold. 85px was the composer height. On device that would have
  // read as "the send box is just off screen" and looked like the keyboard bug all over again.
  // ⚠ SCROLL AGAIN AFTER LAYOUT SETTLES. A hydrated thread is markdown — 34 bubbles measured at
  // 20,762px — and its height is NOT final at the moment React commits: react-markdown subtrees, the
  // webfont, and long tables all lay out after. Scrolling once on commit lands against a stale
  // scrollHeight and the page sits at the top, which is exactly what Gate-A measured (scrollY 0 of
  // 20,762). So: scroll now, on the next frame, and once more after a beat.
  const bottom = (behavior: ScrollBehavior = 'auto') => {
    const go = () => window.scrollTo({ top: document.documentElement.scrollHeight, behavior })
    go()
    requestAnimationFrame(go)
    window.setTimeout(go, 250)
  }
  // ⚠ TAKE SCROLL RESTORATION OFF THE BROWSER. MEASURED on a clean load: 55 bubbles rendered, our
  // scroll ran, and the page still sat at scrollY 0 of 22,784 with history.scrollRestoration = 'auto'.
  // The browser restores position on the load event, which lands AFTER our effect and silently undoes
  // it. A chat surface that manages its own position must own it outright.
  useEffect(() => {
    const prev = history.scrollRestoration
    try { history.scrollRestoration = 'manual' } catch { /* unsupported — our own scroll still runs */ }
    bottom()
    return () => { try { history.scrollRestoration = prev } catch {} }
  }, [])
  // (b) on every new message, including the streamed status line growing.
  // ⚠ THE FIRST ONE IS INSTANT, NOT SMOOTH. The mount effect above runs while the thread is still
  // empty (hydration is async), so the real "go to the newest turn" happens when messages arrive —
  // and MEASURED, smooth-scrolling a hydrated thread of 18,740px leaves the page sitting at the top
  // for seconds. Instant for the initial landing, smooth for turns the user actually sends.
  const didInitialScroll = useRef(false)
  useEffect(() => {
    if (!messages.length && !loading) return
    bottom(didInitialScroll.current ? 'smooth' : 'auto')
    didInitialScroll.current = true
  }, [messages, loading, streamStatus])

  return (
    // `shell.tokens` is NOT optional. Outside Shell there is no `.root`, so without it every var(--…)
    // in this subtree resolves to nothing — the exact failure that made the send button invisible.
    <div ref={rootRef} className={`${shell.tokens} ${styles.page}`}>
      {debug && <div className={styles.probe}>{probeLine || 'PROBE ARMED — tap the box'}</div>}

      <header className={styles.head}>
        <button type="button" className={styles.back} onClick={() => router.back()} aria-label="Back">
          <i className="ti ti-chevron-left" />
        </button>
        <div className={styles.title}>
          <i className="ti ti-sparkles" /> Ask Lora
          {clientName ? <span className={styles.client}>· {clientName}</span> : null}
        </div>
      </header>

      {/* NOT a scroll container. The DOCUMENT scrolls; this is just long content. Making this the
          scroller would pin the composer to its height, which is the overlay pattern wearing a hat. */}
      <div className={styles.list}>
        {messages.length === 0 ? (
          <p className={styles.empty}>
            {clientId && clientName
              ? `Ask about ${clientName}’s performance — spend, revenue, breakdowns, or how the money splits.`
              : 'Ask about this client’s performance — spend, revenue, breakdowns, or how the money splits.'}
          </p>
        ) : (
          messages.map((m, i) => (
            <div key={i} className={m.role === 'user' ? styles.rowUser : styles.rowAssistant}>
              <div className={m.role === 'user' ? styles.bubbleUser : styles.bubbleAssistant}>
                {m.role === 'assistant'
                  ? <div className={styles.md}><ReactMarkdown remarkPlugins={[remarkGfm]}>{m.content}</ReactMarkdown></div>
                  : m.content}
              </div>
            </div>
          ))
        )}
        {loading && (
          <div className={styles.rowAssistant}>
            <div className={styles.bubbleAssistant}>
              {streamStatus
                ? <span className={styles.streamStatus}>{streamStatus}</span>
                : <span className={styles.typing}><i /><i /><i /></span>}
            </div>
          </div>
        )}
        <div ref={endRef} />
      </div>

      {/* ORDINARY IN-FLOW ELEMENT. No position:fixed, no sticky, no computed height. */}
      <div className={styles.composer}>
        <textarea
          ref={inputRef}
          className={styles.input}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={onKeyDown}
          // (c) on focus — the probe's falsified premise, handled by us instead of by iOS.
          onFocus={() => { onComposerFocus(); setTimeout(() => bottom('smooth'), 350) }}
          placeholder="Ask Lora…"
          rows={1}
        />
        <button
          type="button"
          className={styles.send}
          onClick={() => send(input)}
          disabled={!input.trim() || loading}
          aria-label="Send"
        >
          <i className="ti ti-arrow-up" />
        </button>
      </div>
    </div>
  )
}
