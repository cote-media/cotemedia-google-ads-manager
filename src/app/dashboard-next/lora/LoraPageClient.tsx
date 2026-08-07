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
import { useCallback, useEffect, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { useLoraChat } from '@/lib/next/use-lora-chat'
import shell from '@/components/redesign/redesign.module.css'
import LoraThread from '@/components/redesign/LoraThread'
import styles from './lora-page.module.css'
import { requestLanding, LANDING } from '@/lib/next/landing-scroll' // LORAMER_NEXT_LANDING_SCROLL_V1

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
    messages, input, setInput, loading, streamStatus, streamingText, debug, probeLine,
    inputRef, send, onKeyDown, onComposerFocus, noteInput,
  } = useLoraChat({ clientId, clientName, active: true, panelRef: rootRef })

  // ⛔ THE KEYBOARD INSET EFFECT MOVED INTO <LoraThread> (LORAMER_CHAT_SHARED_THREAD_V1), because its
  // second half calls followBottom() and the scroll machine lives there now. Leaving it here would have
  // meant either duplicating the pin logic or dropping the keyboard-arrival scroll — and dropping it is
  // exactly what the first cut of this extraction did, until chat-scroll-chain.guard.mjs said so.
  // This container still OWNS the element the inset is set on, which is why the ref is passed down.

  // ── LORAMER_LORA_HEADER_VISUAL_VIEWPORT_V1, 2026-08-07 — THE HEADER IS PINNED TO THE VISUAL
  // VIEWPORT, NOT THE LAYOUT ONE. Gate-B on device: with the keyboard up, a thumb-flick detaches the
  // header and it scrolls away.
  // ⛔ THE ELEMENT IS `position: sticky`, NOT `fixed`, AND THE DISTINCTION DOES NOT SAVE IT. Sticky
  // pins to the top of its SCROLLPORT, which here is the LAYOUT viewport (this header is a child of
  // `.page`, outside the thread). The keyboard does not change the layout viewport — it changes the
  // VISUAL one, and iOS then lets the visual viewport scroll WITHIN the layout viewport. So the header
  // stays glued to a line that is no longer on screen. Same mechanism as the long-documented WebKit
  // behaviour where `position: fixed` stops being honoured while the keyboard is open; same published
  // fix — drive the element from `window.visualViewport`.
  // ⛔ BOTH EVENTS, NOT JUST resize. `resize` fires when the keyboard opens/closes; `scroll` is what
  // fires when the user flicks the visual viewport around with the keyboard already up, which is
  // exactly the failing gesture. Listening to one of the two fixes half the defect and looks fixed.
  // ⛔ transform, NEVER top. `top` is layout and would re-run sticky's own resolution every frame;
  // a transform is composited and cannot fight the sticky it is correcting.
  // ⛔ THE APPLE BUG IS HANDLED EXPLICITLY AND NOT ASSUMED AWAY — developer.apple.com/forums/thread/800154
  // (iOS 26): `visualViewport.offsetTop` does NOT reset to 0 after the keyboard is dismissed, so an
  // element driven from it stays displaced until something forces a recalc. `resize` alone does not
  // clear it. The focusout path below zeroes the transform directly and then re-reads on the next two
  // frames, so a late-arriving correct value still wins.
  // ── LORAMER_LORA_HEADER_ONE_OWNER_V1, 2026-08-07 — EXACTLY ONE MECHANISM WRITES THE HEADER'S
  // POSITION AT ANY MOMENT. bb84bc1 left TWO: sticky (resolved by the browser every frame, because a
  // sticky offset is a function of SCROLL) and our transform (applied from JS one frame later). With
  // the keyboard up iOS pans the visual viewport continuously, so the correction was permanently a
  // frame behind the thing it corrected — which is the flicker Russ saw, why it tracked scroll speed,
  // and why it vanished the moment the keyboard closed and the panning stopped.
  //
  // ⛔ THE KEYBOARD-UP TEST IS THE EXISTING `--lora-kb-inset`, DELIBERATELY READ RATHER THAN
  // RE-DERIVED. LoraThread already computes it as a MEASURED GAP (docH − offsetTop − vv.height, with a
  // 100px floor so a URL-bar collapse cannot read as a keyboard) and writes it onto this very element.
  // A second detector here would be a second answer to the same question, and the two would disagree
  // on exactly the frames that matter.
  // ⚠ ORDERING IS BENIGN AND IS STATED RATHER THAN RELIED ON SILENTLY: React runs child effects before
  // parent ones, so LoraThread subscribes to visualViewport first and its handler writes the property
  // before ours reads it. If that ever changed, the class would toggle ONE FRAME LATE at the
  // transition only — it cannot affect steady-state motion, because during motion the value is stable.
  // ⛔ LORAMER_PINNED_ELEMENT_SWEEP_V1, 2026-08-07 — EVERY TOP-PINNED ELEMENT ON THIS PAGE, NOT JUST THE
  // ONE THAT WAS REPORTED. fb95147 fixed `.head` because `.head` was what Russ saw; `.probe` is the
  // SAME shape — `position: sticky; top: 0` against the LAYOUT viewport (lora-page.module.css:112) —
  // and would detach under the keyboard in exactly the same way. Three flights on this surface each
  // fixed the instance that was noticed while its siblings carried the defect (★PINNED-ELEMENTS-FIXED-
  // ONE-AT-A-TIME). A LIST, not a ref, is what makes the next one a one-line addition instead of a
  // fourth flight.
  const headRef = useRef<HTMLElement>(null)
  const probeRef = useRef<HTMLDivElement>(null)
  const kbUpRef = useRef(false)
  const syncHead = useCallback(() => {
    const page = rootRef.current
    const vv = typeof window !== 'undefined' ? window.visualViewport : null
    if (!page || !vv) return
    // ⚠ `.probe` is debug-only and usually absent — a null ref is NORMAL here, not an error, so the
    // list is filtered rather than guarded element-by-element.
    const pinned: HTMLElement[] = [headRef.current, probeRef.current].filter(Boolean) as HTMLElement[]
    if (!pinned.length) return
    const inset = parseFloat(page.style.getPropertyValue('--lora-kb-inset')) || 0
    const kbUp = inset > 0

    // ⛔ KEYBOARD DOWN: HANDS OFF. Clear the inline `top` and the element is plain sticky again, exactly
    // as it shipped — that state is confirmed correct and JS must not touch it. The transform is written
    // back to the stylesheet's own resting value rather than blanked, so the two agree on one string
    // instead of one relying on the other's default.
    if (!kbUp) {
      if (kbUpRef.current) {
        for (const el of pinned) {
          el.style.top = ''
          el.style.transform = 'translate3d(0, 0, 0)'
        }
        kbUpRef.current = false
      }
      return
    }

    // ⛔ KEYBOARD UP: THE BROWSER STILL OWNS PLACEMENT — JS ONLY SUPPLIES THE PARAMETER. Setting `top`
    // lets sticky resolve the final position ITSELF, every frame, from a value that changes only when
    // the visual viewport pans. That is ONE writer of the painted position. Applying a transform here
    // as well would put the frame-late correction back and recreate the flicker, so there is none:
    // the transform stays at its resting identity for the whole keyboard-up state.
    kbUpRef.current = true
    const y = Math.max(0, Math.round(vv.offsetTop || 0))
    for (const el of pinned) el.style.top = `${y}px`
  }, [])
  useEffect(() => {
    const vv = typeof window !== 'undefined' ? window.visualViewport : null
    if (!vv) return // ⛔ NO visualViewport = NO CORRECTION, and that is the right failure: the header
                    // keeps today's sticky behaviour rather than being driven by a value we cannot read.
    let raf = 0
    const schedule = () => {
      if (raf) return
      raf = window.requestAnimationFrame(() => { raf = 0; syncHead() })
    }
    // THE DISMISSAL PATH. Zero it immediately so the header cannot be left displaced, then re-read on
    // the next two frames in case offsetTop is still stale at the moment focus leaves (the Apple bug).
    // ⛔ THE APPLE BUG PATH FROM bb84bc1, PRESERVED AND NOW ALSO RESPONSIBLE FOR THE HANDOVER BACK.
    // developer.apple.com/forums/thread/800154 (iOS 26): visualViewport.offsetTop does NOT reset to 0
    // after dismissal, so `resize` alone leaves the element displaced. This zeroes the transform
    // IMMEDIATELY, returns the header to sticky and removes the flow compensation in the same task,
    // then re-reads on the next TWO frames so a late-but-correct offsetTop still wins.
    const onFocusOut = () => {
      for (const el of [headRef.current, probeRef.current]) {
        if (!el) continue
        el.style.top = ''
        el.style.transform = 'translate3d(0, 0, 0)'
      }
      kbUpRef.current = false
      window.requestAnimationFrame(() => {
        syncHead()
        window.requestAnimationFrame(syncHead)
      })
    }
    syncHead()
    vv.addEventListener('resize', schedule)
    vv.addEventListener('scroll', schedule)
    window.addEventListener('focusout', onFocusOut)
    return () => {
      if (raf) window.cancelAnimationFrame(raf)
      vv.removeEventListener('resize', schedule)
      vv.removeEventListener('scroll', schedule)
      window.removeEventListener('focusout', onFocusOut)
    }
  }, [syncHead])

  return (
    // `shell.tokens` is NOT optional. Outside Shell there is no `.root`, so without it every var(--)
    // in this subtree resolves to nothing — the exact failure that made the send button invisible.
    <div ref={rootRef} className={`${shell.tokens} ${styles.page}`}>
      {debug && <div ref={probeRef} className={styles.probe}>{probeLine || 'PROBE ARMED — tap the box'}</div>}

      <header ref={headRef} className={styles.head}>
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
            ⚠ THE FALLBACK IT THEN TOOK WAS ITSELF POINTED AT THE ALL-CLIENTS INDEX, which ignores
            `?clientId=` entirely (its component takes no props at all) — so the wrong branch had a
            maximally wrong destination. That second half was ★NEXT-CLIENTS-PAGE-IGNORES-CLIENTID, and
            it was deliberately left alone HERE because repointing the fallback while the gate was still
            broken would have MASKED the gate rather than fixed it.
            ✅ THE GATE IS FIXED (below), SO THAT REASON EXPIRED. The fallback was repointed at the
            client's own Overview by LORAMER_LORA_BACK_LANDS_ON_THE_CLIENT_V1 — see the comment on the
            `fallback` line itself for why the destination moved rather than the All-Clients page.

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
            // LORAMER_LORA_BACK_LANDS_ON_THE_CLIENT_V1 — THE FALLBACK NOW POINTS AT THE CLIENT, and the
            // choice between the two available fixes is not the smaller one, it is the correct one.
            //
            // ⛔ THE OTHER FIX — teaching /dashboard-next/clients to honour ?clientId — WOULD BREAK A
            // DELIBERATE DESIGN, not complete one. That page is the PORTFOLIO surface: its component takes
            // no props at all, and its own in-file justification reads "ALLOWLISTED: genuinely CLIENT-LESS
            // by design. This is the PORTFOLIO (all clients) surface — it has no single active client, so
            // it does NOT call resolveShellClient and mounts <Shell> with no clientId. That is correct,
            // not an oversight." `shell-client-context.guard.mjs` enforces exactly that allowlist. Making
            // All Clients render ONE client would fight the guard and wreck the portfolio surface, to
            // reach a destination that already exists elsewhere.
            //
            // ⇒ `/dashboard-next` (Overview) IS the client home: `DashboardNextPage` already takes
            // `searchParams.clientId` and resolves it through `resolveShellClient`. Sending the fallback
            // there needs no new route, no new prop, and no guard exception.
            //
            // ⚠ AND THE OLD COMMENT SAYING THIS WOULD "MASK THE GATE" WAS TRUE WHEN WRITTEN AND IS NOT
            // TRUE NOW. It was written while `cameFromApp` was still `document.referrer` alone and wrongly
            // false, so repointing the fallback then would have hidden a broken gate.
            // LORAMER_LORA_BACK_SOFT_NAV_V1 fixed the gate. What is left is a fallback that was always
            // pointed at the wrong place, and it is now safe to say so.
            const fallback = clientId ? `/dashboard-next?clientId=${clientId}` : '/dashboard-next/clients'
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
            // LORAMER_NEXT_LANDING_SCROLL_V1 — RECORD THE ARRIVAL INTENT BEFORE NAVIGATING, and record it
            // on BOTH branches. This is the whole reason the fix works on a client-side route change:
            // `router.back()` is a POP (App Router RESTORES the Overview's old offset) and
            // `router.push()` is a PUSH (it scrolls to top). The intent does not care which — the
            // destination consumes it either way, so the two branches stop having two behaviours.
            requestLanding(LANDING.OVERVIEW, 'top', clientId ?? null)
            // ⛔ LORAMER_NEXT_ROUTER_SCROLL_OFF_V1 — THE TWO BRANCHES ARE NOT SYMMETRICAL AND THAT IS
            // THE WHOLE SHAPE OF THIS FIX. `push` CAN be told not to scroll, so it is. `back()` CANNOT —
            // next@14.2.3 declares `back(): void`, no parameters, and App Router RESTORES the recorded
            // offset on a POP with no documented way to opt out. So the POP path is the one place where
            // racing the router is genuinely required, and the arrival grace stays for it alone.
            // ⚠ Russ's call, not re-opened here: keep `back()`. Swapping it for push() creates a
            // back-loop on the phone's system gesture (Overview → Lora → Overview′ → back returns to
            // Lora); replace() avoids the loop but destroys the forward entry and makes the whole
            // `cameFromApp` gate dead code. Neither trade is worth a scroll offset.
            if (cameFromApp) router.back()
            else router.push(fallback, { scroll: false })
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
        debug={debug}   /* LORAMER_NEXT_LANDING_PROBE_VISIBLE_V1 — on-screen landing readout */
        messages={messages}
        loading={loading}
        streamStatus={streamStatus}
        streamingText={streamingText}
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
