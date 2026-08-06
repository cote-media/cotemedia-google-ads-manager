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
import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { useLoraChat } from '@/lib/next/use-lora-chat'
import shell from '@/components/redesign/redesign.module.css'
// LORAMER_LORA_WORKING_SHARED_V1 — THE SAME component the desktop shelf uses. This page is the PHONE
// surface (open-lora.ts routes ≤767px here) and it had NONE of the status UI: a plain italic line, no mark.
// Importing the shared component rather than copying its CSS is the fix for the defect CLASS, not the defect.
import { LoraTurn, LoraWorking } from '@/components/redesign/LoraWorking'
import styles from './lora-page.module.css'

// LORAMER_LORA_PAGE_ICONS_V1 — INLINE SVG, NOT THE ICON WEBFONT.
// ⛔ ROOT CAUSE OF "THERE IS NO BACK BUTTON" (2026-07-27): the Tabler webfont is loaded by a single
// <link> inside Shell.tsx:34, and THIS PAGE RENDERS WITHOUT SHELL (LORAMER_LORA_PAGE_SHELL_RESOLUTION_V1).
// So `<i className="ti ti-chevron-left" />` was an EMPTY element with no glyph, and `.back` had no
// background and no size of its own — a 0×0 invisible button that was in the DOM, in bounds, and
// perfectly tappable if you knew where to aim. The send button survived the same amputation ONLY
// because `.send` carries an explicit 38×38 and a background, so it painted as a blank accent circle.
// THE CLASS, and this is the second instance today: RENDERING OUTSIDE SHELL SILENTLY DROPS WHATEVER
// SHELL PROVIDED. First it was the CSS custom properties (the send button). Now it is the icon font.
// The fix is not another link tag — it is to stop depending on anything Shell hands down. These are
// self-contained, need no stylesheet, and cannot be severed by where the page renders.
const Icon = ({ d, size = 22 }: { d: string; size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor"
    strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
    <path d={d} />
  </svg>
)
const CHEVRON_LEFT = 'M15 6l-6 6 6 6'
const CHEVRON_DOWN = 'M6 9l6 6 6-6'
const ARROW_UP = 'M12 19V5M5 12l7-7 7 7'
const SPARKLE = 'M12 3l1.9 4.6L18.5 9.5l-4.6 1.9L12 16l-1.9-4.6L5.5 9.5l4.6-1.9z'

// LORAMER_LORA_PAGE_STICK_TO_BOTTOM_V1 — how close to the bottom still counts as "following".
// Generous enough that a half-line of momentum overshoot does not unpin, small enough that a
// deliberate scroll of one message does.
const NEAR_BOTTOM_PX = 80
// LORAMER_LORA_PAGE_KEYBOARD_INSET_V1 — the same threshold the probe uses to call the keyboard up.
// Device values 2026-07-26: layout 766 vs visual 428. Address-bar chrome moves this by tens of px,
// never by 100+, so nothing below the threshold lifts the composer.
const KEYBOARD_MIN_DELTA_PX = 100

export default function LoraPageClient({ clientId, clientName }: { clientId?: string; clientName?: string }) {
  const router = useRouter()
  const endRef = useRef<HTMLDivElement>(null)
  const rootRef = useRef<HTMLDivElement>(null)
  const {
    messages, input, setInput, loading, streamStatus, debug, probeLine,
    inputRef, send, onKeyDown, onComposerFocus,
  } = useLoraChat({ clientId, clientName, active: true, panelRef: rootRef })

  // ── LORAMER_LORA_PAGE_STICK_TO_BOTTOM_V1 ────────────────────────────────────────────────────────
  // ⛔ THE DEFECT THIS FIXES, and Russ called it the worst of the four: scrolling up to read history
  // got YANKED back down. Every auto-scroll below used to be unconditional, so reading older turns
  // fought the page. AN AUTO-SCROLL THAT OVERRIDES A DELIBERATE USER SCROLL IS WORSE THAN NO
  // AUTO-SCROLL — it takes control away from the one person who knows where they want to be.
  //
  // THE RULE: follow the bottom ONLY while the user is already at (or near) it. The moment they move
  // upward, stop following; resume when they come back.
  //
  // ⚠ WHY UNPINNING READS THE DIRECTION AND RE-PINNING READS THE DISTANCE, rather than one test for
  // both: our OWN scrolls are the loudest scroll events on this page, and a distance-based unpin
  // would fire on every frame of a smooth animation (the page is 800px from the bottom mid-flight),
  // unpinning us in the middle of the very scroll we asked for. But every programmatic scroll here
  // goes DOWN, toward the bottom — so "unpin only on upward movement" is structurally immune to our
  // own scrolling, with no timers, no suppression windows and no flags to get out of sync. That
  // matters: a suppression window would also swallow a REAL upward scroll that lands inside it, which
  // is the yank all over again, just rarer and harder to reproduce.
  const [pinned, setPinned] = useState(true)
  const pinnedRef = useRef(true)
  const lastYRef = useRef(0)
  const setPin = (v: boolean) => { pinnedRef.current = v; setPinned(v) }

  // ⛔ THE PIN CANNOT BE DRIVEN BY THE SCROLL EVENT ALONE, and this is the finding that took three
  // runs to isolate. INSTRUMENTED IN WEBKIT (window.scrollTo wrapped, stacks captured): after a scroll
  // to the top of a 23,650px thread, the ResizeObserver callback fired at t+111ms and the `scroll`
  // EVENT did not arrive until t+134ms. Everything that consumed the pin in between read a stale
  // `true` and scrolled the user straight back down — which is precisely the yank, arriving through
  // the very machinery meant to prevent it.
  // THE SYNCHRONOUS TRUTH is the position itself: record where WE last put the view, and if the view
  // is now ABOVE that, something other than us moved it. That is decidable in the same tick, with no
  // event, no timer and no ordering assumption.
  // ⚠ IT MUST BE "MOVED UP FROM OUR LAST SCROLL", NOT "FAR FROM THE BOTTOM". Content growing BELOW
  // the viewport — a 1,200px answer landing — also puts the view far from the bottom, and a
  // distance-based test would read that as the user leaving and stop following mid-answer.
  const lastAutoYRef = useRef(-1)
  const userMovedUp = () => lastAutoYRef.current >= 0 && window.scrollY < lastAutoYRef.current - 4

  // ⚠ SCROLL THE DOCUMENT, NOT A SENTINEL INSIDE THE LIST. The first cut called
  // endRef.scrollIntoView({block:'end'}), and Gate-A measured it landing 85px SHORT of the bottom —
  // because the sentinel is the last child of `.list` and the COMPOSER sits after `.list`. Scrolling
  // the sentinel into view therefore leaves the composer, the one element that must be visible,
  // exactly its own height below the fold. 85px was the composer height.
  // ⚠ SCROLL AGAIN AFTER LAYOUT SETTLES. A hydrated thread is markdown — 34 bubbles measured at
  // 20,762px — and its height is NOT final at the moment React commits: react-markdown subtrees, the
  // webfont, and long tables all lay out after. Scrolling once on commit lands against a stale
  // scrollHeight and the page sits at the top, which is exactly what Gate-A measured (scrollY 0 of
  // 20,762). So: scroll now, on the next frame, and once more after a beat.
  // ⛔ THE DEFAULT IS 'instant', AND 'auto' IS BANNED HERE — MEASURED 2026-07-27, and it had been
  // wrong since this page shipped. globals.css:126 sets `html { scroll-behavior: smooth }`, and per
  // spec `behavior: 'auto'` means "use the element's computed scroll-behavior" — so EVERY scroll on
  // this page that called itself instant was in fact ANIMATED. Instrumented on a 26,677px thread: a
  // single scrollTo({behavior:'auto'}) crawled 25911 → 25870 → 25772 → 25602 and was still moving
  // 3.7 SECONDS later. That is a multi-second animation running under the user's finger, and the
  // comment three lines below (written when the page was built) already said the initial landing must
  // be instant — it just never was. 'instant' ignores the CSS and lands in one frame.
  const bottom = (behavior: ScrollBehavior = 'instant') => {
    const go = () => {
      window.scrollTo({ top: document.documentElement.scrollHeight, behavior })
      // Record where we put it. With 'instant' this is the final position; with 'smooth' it is the
      // animation's start, which is a LOWER bound and therefore still safe — it can never manufacture
      // a false "the user moved up".
      lastAutoYRef.current = window.scrollY
    }
    go()
    // ⛔ THE DEFERRED SHOTS OBEY THE PIN, AND THIS IS THE SUBTLEST YANK OF THE LOT — Gate-A caught it
    // and it would have shipped. `bottom()` fires three times to survive late markdown layout, but the
    // two deferred shots used to run unconditionally: so a content-settle at the bottom would schedule
    // a scroll for +250ms, the user would scroll up inside that window and correctly unpin, and then
    // the orphaned timer fired anyway and dragged them back. MEASURED: scrolling to the top of a
    // 23,548px thread returned to 23,548 every time, while a scroll to the MIDDLE — issued later, with
    // no timer outstanding — held perfectly. A pin that only governs the DECISION to scroll, and not
    // the scrolls already in flight, is not a pin.
    requestAnimationFrame(() => { if (stillFollowing()) go() })
    window.setTimeout(() => { if (stillFollowing()) go() }, 250)
  }
  // THE ONE GATE every automatic scroll passes through — the React pin AND the synchronous position
  // check, because either alone is wrong: the pin lags the event, and the position alone cannot tell
  // "the user left" from "the content grew". Unpinning here (rather than waiting for the scroll event)
  // also means the jump-to-bottom affordance appears in the same frame the user takes control.
  const stillFollowing = () => {
    if (!pinnedRef.current) return false
    if (userMovedUp()) { setPin(false); return false }
    return true
  }
  // `bottom()` stays available for the two scrolls that are not automatic at all — the first landing,
  // and the user tapping jump-to-bottom.
  const followBottom = (behavior: ScrollBehavior = 'instant') => { if (stillFollowing()) bottom(behavior) }

  useEffect(() => {
    lastYRef.current = window.scrollY
    const onScroll = () => {
      const y = window.scrollY
      const movedUp = y < lastYRef.current - 2   // 2px of slack: iOS emits sub-pixel jitter at rest
      lastYRef.current = y
      const dist = document.documentElement.scrollHeight - (y + window.innerHeight)
      // RE-PIN BY DISTANCE (they came back), UNPIN BY DIRECTION (they left). Order matters: a user
      // scrolling up INSIDE the near-bottom band has not really left, so the distance test wins.
      if (dist <= NEAR_BOTTOM_PX) { if (!pinnedRef.current) setPin(true) }
      else if (movedUp && pinnedRef.current) setPin(false)
    }
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [])

  // ⚠ TAKE SCROLL RESTORATION OFF THE BROWSER. MEASURED on a clean load: 55 bubbles rendered, our
  // scroll ran, and the page still sat at scrollY 0 of 22,784 with history.scrollRestoration = 'auto'.
  // The browser restores position on the load event, which lands AFTER our effect and silently undoes
  // it. A chat surface that manages its own position must own it outright.
  useEffect(() => {
    const prev = history.scrollRestoration
    try { history.scrollRestoration = 'manual' } catch { /* unsupported — our own scroll still runs */ }
    bottom()   // first landing is not an auto-follow; it is where the surface opens
    return () => { try { history.scrollRestoration = prev } catch {} }
  }, [])

  // (b) on every new message, including the streamed status line growing — BUT ONLY IF PINNED.
  // ⚠ THE FIRST ONE IS INSTANT, NOT SMOOTH. The mount effect above runs while the thread is still
  // empty (hydration is async), so the real "go to the newest turn" happens when messages arrive —
  // and MEASURED, smooth-scrolling a hydrated thread of 18,740px leaves the page sitting at the top
  // for seconds. Instant for the initial landing, smooth for turns the user actually sends.
  const didInitialScroll = useRef(false)
  useEffect(() => {
    if (!messages.length && !loading) return
    // ⚠ EVEN THE FIRST LANDING OBEYS THE USER. Hydration is async and a long thread settles for
    // seconds; instrumented, this effect fired AFTER the harness had already scrolled away, and an
    // unconditional `bottom()` here dragged the view back. If they have already moved, they win.
    if (!didInitialScroll.current) { didInitialScroll.current = true; followBottom('instant'); return }
    followBottom('smooth')
  }, [messages, loading, streamStatus])

  // ⚠ STAY GLUED WHILE THE CONTENT IS STILL GROWING. Three scroll attempts (now / next frame / +250ms)
  // are not enough for a hydrated markdown thread: MEASURED, the page settled 64px short on open and
  // 1,294px short after an answer landed, because react-markdown subtrees and long tables lay out well
  // after our last retry and the scroll target had moved. A scroll to a target computed from a stale
  // scrollHeight is a scroll to the wrong place, however many times you repeat it inside 250ms.
  // Observing the list closes that: while PINNED, any growth re-glues to the new bottom. While
  // UNPINNED it does nothing at all, so it can never become another way to yank the user.
  const listRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const el = listRef.current
    if (!el || typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(() => followBottom('instant'))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  // ── LORAMER_LORA_PAGE_KEYBOARD_INSET_V1 — THE STICKY COMPOSER, AND HOW IT SURVIVES THE KEYBOARD ──
  // Russ: the composer sat at the END of the document, so reading history meant scrolling all the way
  // back down to type. It must stay visible at every scroll position.
  //
  // ⚠ THIS IS THE EXACT GROUND SIX OVERLAY ATTEMPTS DIED ON, so the mechanism is chosen for how it
  // FAILS, not for how it works:
  //   · The composer is `position: sticky`, NEVER `position: fixed`. It is still an in-flow element in
  //     a document-flow page; sticky only changes WHERE it paints once it would leave the scrollport.
  //   · `bottom: var(--lora-kb-inset, 0px)`. With no JS, a stale value, or no visualViewport at all,
  //     the inset is 0 and the composer pins to the bottom of the layout viewport — WHICH IS EXACTLY
  //     WHERE IT SITS TODAY when the document is scrolled to its end, the geometry Russ already
  //     confirmed working on device. The failure mode of the new mechanism is the old mechanism.
  //   · The ONLY number computed here is a single bottom inset. The overlay attempts computed a whole
  //     rect — top, left, width AND height — and fought iOS compositing for all four.
  // The keyboard occupies the band below `offsetTop + height` in layout-viewport coordinates, so the
  // inset that lifts the composer clear of it is `docH - (offsetTop + vvH)`. Device: 766 − 428 = 338.
  //
  // ⛔ CEILING, STATED PLAINLY: Gate-A replays the recorded device numbers (vvH 428 and 458 at
  // docH 766) and proves the BINDING — that the composer's bottom lands on the keyboard line. It
  // CANNOT prove how iOS composites a sticky element with the keyboard up; WebKit headless has no
  // keyboard. That is Gate-B on device, and it is the same ceiling the step-2 harness carried.
  useEffect(() => {
    const vv = typeof window !== 'undefined' ? window.visualViewport : null
    if (!vv) return
    const apply = () => {
      const docH = document.documentElement.clientHeight
      const raw = Math.round(docH - (vv.offsetTop || 0) - vv.height)
      const inset = raw > KEYBOARD_MIN_DELTA_PX ? raw : 0
      rootRef.current?.style.setProperty('--lora-kb-inset', `${inset}px`)
      // SCROLL WHEN THE KEYBOARD ACTUALLY ARRIVES. visualViewport resize is the only event that fires
      // at the moment the viewport really shrinks — focus fires before the keyboard animates in.
      // ⚠ IT OBEYS THE PIN LIKE EVERY OTHER AUTO-SCROLL (Russ, explicitly). Bound to the composer
      // having focus as well, so it cannot fight a user scrolling with the keyboard already down.
      if (document.activeElement === inputRef.current) {
        followBottom()
        window.setTimeout(() => followBottom(), 200)
      }
    }
    apply()
    vv.addEventListener('resize', apply)
    vv.addEventListener('scroll', apply)
    return () => { vv.removeEventListener('resize', apply); vv.removeEventListener('scroll', apply) }
  }, [])

  return (
    // `shell.tokens` is NOT optional. Outside Shell there is no `.root`, so without it every var(--…)
    // in this subtree resolves to nothing — the exact failure that made the send button invisible.
    <div ref={rootRef} className={`${shell.tokens} ${styles.page}`}>
      {debug && <div className={styles.probe}>{probeLine || 'PROBE ARMED — tap the box'}</div>}

      <header className={styles.head}>
        {/* LORAMER_LORA_PAGE_EXIT_V1 — A FULL-SCREEN PAGE MUST HAVE A VISIBLE WAY OUT. router.back()
            alone is not one: on a fresh load (opened from a link, or after the history entry is spent)
            there is nothing to go back TO, and the button silently does nothing — which is what a
            trap feels like. So: go back if there is somewhere to go, otherwise route to the client's
            own page. Either way the tap always lands somewhere.
            ⚠ AND IT MUST BE VISIBLE, which it was not: see the Icon note at the top of this file. It
            now paints its own chevron and carries its own surface, so it depends on nothing handed
            down from a Shell this page does not render inside. */}
        <button
          type="button"
          className={styles.back}
          onClick={() => {
            // ⚠ `history.length > 1` IS NOT A SAFE TEST and Gate-A caught it: it counts the whole
            // TAB's history, so back can leave the app entirely — the first cut exited to about:blank,
            // which is still a trap, just a blank one. The honest question is "did the user arrive here
            // from inside our app", and document.referrer answers it. Same-origin referrer → go back
            // where they came from. Anything else (fresh tab, external link, shared URL) → route to the
            // client's own page, which is always somewhere real.
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

      {/* NOT a scroll container. The DOCUMENT scrolls; this is just long content. Making this the
          scroller would pin the composer to its height, which is the overlay pattern wearing a hat. */}
      <div ref={listRef} className={styles.list}>
        {messages.length === 0 ? (
          <p className={styles.empty}>
            {clientId && clientName
              ? `Ask about ${clientName}’s performance — spend, revenue, breakdowns, or how the money splits.`
              : 'Ask about this client’s performance — spend, revenue, breakdowns, or how the money splits.'}
          </p>
        ) : (
          messages.map((m, i) => (
            <div key={i} className={m.role === 'user' ? styles.rowUser : styles.rowAssistant}>
              {/* LORAMER_LORA_WORKING_SHARED_V1 — an assistant turn is LoraTurn: the static mark on the page
                  background at the answer’s own text margin, then the bubble. Same element, same position the
                  working state used, so nothing jumps when the answer lands. */}
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
          /* LORAMER_LORA_WORKING_SHARED_V1 — ⛔ NO CONTAINER. This used to be a plain italic span inside
             .bubbleAssistant, a rounded grey box. The mark and the line now render on the page background and
             LoraWorking reserves the vertical space the answer will fill — no skeleton, nothing pushed down. */
          <div className={styles.rowAssistant}>
            <LoraWorking status={streamStatus} />
          </div>
        )}
        <div ref={endRef} />
      </div>

      {/* STICKY, NEVER FIXED — see LORAMER_LORA_PAGE_KEYBOARD_INSET_V1 above. */}
      <div className={styles.composer}>
        {/* LORAMER_LORA_PAGE_JUMP_TO_BOTTOM_V1 — what makes unpinning SAFE. Once auto-scroll stops
            following, the user needs a way back that is not "scroll a 20,000px thread by hand".
            ⚠ IT LIVES INSIDE THE COMPOSER ON PURPOSE. The obvious build is a position:fixed floater,
            which is banned on this page for the reason six overlays are in the ground. As an absolute
            child of the sticky composer it rides the composer instead — including the keyboard lift —
            so it needs no geometry of its own and cannot drift away from the surface it belongs to. */}
        {!pinned && (
          <button
            type="button"
            className={styles.jump}
            onClick={() => { setPin(true); bottom('smooth') }}
            aria-label="Jump to latest"
          >
            <Icon d={CHEVRON_DOWN} size={20} />
          </button>
        )}
        <textarea
          ref={inputRef}
          className={styles.input}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={onKeyDown}
          // (c) on focus. ⚠ DIAGNOSED AGAINST THE REAL EVENT ORDER, not the harness: on iOS the tap
          // fires focus FIRST and the keyboard animates in AFTERWARDS, so a single scroll at focus (or
          // at a guessed 350ms) runs while the viewport is still full height and is then undone as the
          // keyboard takes ~300-400ms to arrive. WebKit headless has no keyboard, so it passed there
          // and failed on device. The event that actually signals "the keyboard is here" is
          // visualViewport resize — handled in the effect above. This stays as the immediate nudge.
          // ⚠ AND IT OBEYS THE PIN. Focusing the composer while reading history used to yank the page
          // to the bottom; it no longer can. Nothing is lost by that — the composer is sticky now, so
          // it is already on screen and already lifted clear of the keyboard wherever they are.
          onFocus={() => { onComposerFocus(); followBottom(); setTimeout(() => followBottom('smooth'), 400) }}
          placeholder="Ask Lora…"
          rows={1}
        />
        <button
          type="button"
          className={styles.send}
          onClick={() => { setPin(true); send(input) }}
          disabled={!input.trim() || loading}
          aria-label="Send"
        >
          <Icon d={ARROW_UP} size={19} />
        </button>
      </div>
    </div>
  )
}
