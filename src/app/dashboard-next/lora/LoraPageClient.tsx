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
    inputRef, send, onKeyDown, onComposerFocus, noteInput,
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
            leave the app entirely (the first cut exited to about:blank).

            ⛔ AND `document.referrer` ALONE WAS ALSO WRONG — LORAMER_LORA_BACK_SOFT_NAV_V1, SETTLED ON
            DEVICE 2026-08-06 RATHER THAN ARGUED. Russ's three taps: the CHEVRON landed on All Clients
            while the PHONE'S OWN BACK GESTURE landed on the client page — two different destinations
            for one intent, which is how a user learns not to trust a control.
            THE CAUSE: `document.referrer` DESCRIBES THE DOCUMENT LOAD, NOT THE ROUTE. A Next
            client-side navigation never touches it, so arriving here via `openLora`'s `router.push`
            leaves it at whatever loaded the document — empty for a typed URL or a fresh tab — and the
            gate concluded "not from our app" while a perfectly good history entry sat right there.
            ⚠ THE FALLBACK IT THEN TOOK IS ITSELF POINTED AT THE ALL-CLIENTS INDEX, which ignores
            `?clientId=` entirely (its component takes no props at all) — so the wrong branch had a
            maximally wrong destination. That second half is [[★NEXT-CLIENTS-PAGE-IGNORES-CLIENTID]]
            and is DELIBERATELY NOT CHANGED HERE: repointing the fallback would mask this gate rather
            than fix it.

            THE TEST THAT IS ACTUALLY TRUE: did THIS DOCUMENT load somewhere else? The Navigation
            Timing entry records the URL the document was fetched at, and a soft navigation does not
            change it — so `entry.name !== location.href` means we moved WITHIN this document and a
            real in-app history entry exists to go back to. The same-origin referrer is kept as the
            SECOND signal, because it is the one that is true for a HARD navigation from inside the
            app. Either alone is incomplete; together they cover both ways in. */}
        <button
          type="button"
          className={styles.back}
          onClick={() => {
            const fallback = clientId ? `/dashboard-next/clients?clientId=${clientId}` : '/dashboard-next/clients'
            let cameFromApp = false
            try {
              // (1) SOFT NAVIGATION — the document loaded at a DIFFERENT url than the one we are on.
              const nav = performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming | undefined
              const softNavigated = !!nav?.name && nav.name !== window.location.href
              // (2) HARD NAVIGATION FROM INSIDE THE APP — same-origin referrer. The original test, kept
              // rather than replaced: it is correct for its case and only ever wrong on its own.
              const sameOriginReferrer = !!document.referrer && new URL(document.referrer).origin === window.location.origin
              cameFromApp = softNavigated || sameOriginReferrer
            } catch { cameFromApp = false }
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
        noteInput={noteInput}
        send={send}
        clientId={clientId}
        clientName={clientName}
        active
        insetTargetRef={rootRef}
      />
    </div>
  )
}
