// LORAMER_LORA_PAGE_V1 — full-screen mobile Lora. The SECOND container over the shared engine
// (LORAMER_LORA_CHAT_HOOK_V1) and, as of LORAMER_CHAT_SHARED_THREAD_V1, over the shared SURFACE too.
// This file is now the page's CHROME and the keyboard inset. The message list, the markdown, the
// working indicator, the composer, the jump-to-bottom button and ALL scroll behaviour live in
// <LoraThread> / useStickToBottom and are shared byte-for-byte with the desktop shelf.
//
// WHY A PAGE AND NOT AN OVERLAY: six overlay attempts failed on the iOS keyboard. The probe
// (LORAMER_LORA_PAGE_PROBE_V1) measured a real document keeping the composer clear by +308px with ZERO
// geometry computed by us. So: DOCUMENT scrolls, list is long content, composer is an ordinary in-flow
// element. Nothing here is position:fixed and nothing uses dvh.
//
// ⚠ RENDERS OUTSIDE <Shell>, therefore outside `.root`, therefore it MUST carry `.tokens` —
// LORAMER_PORTAL_SEVERS_CSS_VARS_V1. Without it every colour dies exactly as the send button did.
'use client'
import { useRef } from 'react'
import { useRouter } from 'next/navigation'
import { useLoraChat } from '@/lib/next/use-lora-chat'
import shell from '@/components/redesign/redesign.module.css'
import LoraThread from '@/components/redesign/LoraThread'
import styles from './lora-page.module.css'

// LORAMER_LORA_PAGE_ICONS_V1 — INLINE SVG, NOT THE ICON WEBFONT. The Tabler font is linked only from
// Shell.tsx and this page renders WITHOUT Shell, so `<i class="ti ti-chevron-left">` was an EMPTY
// element: a 0x0 invisible button, in the DOM, in bounds, perfectly tappable if you knew where to aim.
const Icon = ({ d, size = 22 }: { d: string; size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor"
    strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
    <path d={d} />
  </svg>
)
const CHEVRON_LEFT = 'M15 6l-6 6 6 6'
const SPARKLE = 'M12 3l1.9 4.6L18.5 9.5l-4.6 1.9L12 16l-1.9-4.6L5.5 9.5l4.6-1.9z'

export default function LoraPageClient({ clientId, clientName }: { clientId?: string; clientName?: string }) {
  const router = useRouter()
  const rootRef = useRef<HTMLDivElement>(null)
  const {
    messages, input, setInput, loading, streamStatus, debug, probeLine,
    inputRef, send, onKeyDown, onComposerFocus,
  } = useLoraChat({ clientId, clientName, active: true, panelRef: rootRef })

  // ⛔ THE KEYBOARD INSET EFFECT MOVED INTO <LoraThread> (LORAMER_CHAT_SHARED_THREAD_V1), because its
  // second half calls followBottom() and the scroll machine lives there now. Leaving it here would have
  // meant either duplicating the pin logic or dropping the keyboard-arrival scroll — and dropping it is
  // exactly what the first cut of this extraction did, until chat-scroll-chain.guard.mjs said so.
  // This container still OWNS the element the inset is set on, which is why the ref is passed down.

  return (
    // `shell.tokens` is NOT optional. Outside Shell there is no `.root`, so without it every var(--)
    // in this subtree resolves to nothing — the exact failure that made the send button invisible.
    <div ref={rootRef} className={`${shell.tokens} ${styles.page}`}>
      {debug && <div className={styles.probe}>{probeLine || 'PROBE ARMED — tap the box'}</div>}

      <header className={styles.head}>
        {/* LORAMER_LORA_PAGE_EXIT_V1 — A FULL-SCREEN PAGE MUST HAVE A VISIBLE WAY OUT. router.back()
            alone is not one: on a fresh load there is nothing to go back TO and the button silently
            does nothing, which is what a trap feels like.
            ⚠ `history.length > 1` IS NOT A SAFE TEST — it counts the whole TAB's history, so back can
            leave the app entirely (the first cut exited to about:blank). document.referrer answers the
            honest question: did the user arrive here from inside our app. */}
        <button
          type="button"
          className={styles.back}
          onClick={() => {
            const fallback = clientId ? `/dashboard-next/clients?clientId=${clientId}` : '/dashboard-next/clients'
            let cameFromApp = false
            try { cameFromApp = !!document.referrer && new URL(document.referrer).origin === window.location.origin } catch { cameFromApp = false }
            if (cameFromApp) router.back()
            else router.push(fallback)
          }}
          aria-label="Close Lora"
        >
          <Icon d={CHEVRON_LEFT} />
        </button>
        <div className={styles.title}>
          <span className={styles.spark}><Icon d={SPARKLE} size={17} /></span> Ask Lora
          {clientName ? <span className={styles.client}>· {clientName}</span> : null}
        </div>
      </header>

      <LoraThread
        variant="page"
        messages={messages}
        loading={loading}
        streamStatus={streamStatus}
        input={input}
        setInput={setInput}
        inputRef={inputRef}
        onKeyDown={onKeyDown}
        onComposerFocus={onComposerFocus}
        send={send}
        clientId={clientId}
        clientName={clientName}
        active
        insetTargetRef={rootRef}
      />
    </div>
  )
}
