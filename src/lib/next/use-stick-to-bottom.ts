// LORAMER_CHAT_SHARED_SCROLL_V1 — THE STICK-TO-BOTTOM MACHINE, ONCE, FOR BOTH SCROLLERS.
//
// ⛔ THIS IS AN EXTRACTION, NOT A REWRITE. Every rule below was already live in
// src/app/dashboard-next/lora/LoraPageClient.tsx and is moved here verbatim in behaviour. The desktop
// shelf had ONE unconditional line — `scrollRef.current.scrollTop = scrollRef.current.scrollHeight` on
// every messages/loading change — so every yank the page was fixed for was still live on it. Russ's
// instruction for this flight: unify onto the PAGE's machine, do not average.
//
// ⛔ THE ONE THING THAT IS GENUINELY NEW IS THE PARAMETER, AND IT IS WHY THIS COULD NOT JUST BE COPIED:
// the page scrolls the DOCUMENT and the shelf scrolls an ELEMENT. Everything below is written against a
// tiny scroller façade so the same logic drives both. `history.scrollRestoration` is document-only and
// is guarded accordingly — applying it to an element scroller would be meaningless, not harmful, and
// saying so is cheaper than leaving a reader to wonder.
import { useEffect, useRef, useState, type RefObject } from 'react'

// How close to the bottom still counts as "following". Generous enough that a half-line of momentum
// overshoot does not unpin, small enough that a deliberate scroll of one message does.
export const NEAR_BOTTOM_PX = 80

/** `null` scroller = the DOCUMENT scrolls (the page). An element ref = that element scrolls (the shelf). */
export function useStickToBottom(scrollerRef: RefObject<HTMLElement | null> | null, deps: {
  /** Anything whose change should re-glue to the bottom while pinned — messages, loading, status. */
  watch: unknown[]
  /** The growing content, observed so a late markdown/table layout cannot land us short. */
  contentRef: RefObject<HTMLElement | null>
  /** Off until the surface is actually visible (the shelf is mounted while closed). */
  active: boolean
}) {
  const { watch, contentRef, active } = deps

  // ── THE SCROLLER FAÇADE ─────────────────────────────────────────────────────────────────────────
  const el = () => (scrollerRef ? scrollerRef.current : null)
  const isDoc = () => !scrollerRef
  const getY = () => { const e = el(); return e ? e.scrollTop : window.scrollY }
  const getMaxY = () => { const e = el(); return e ? e.scrollHeight : document.documentElement.scrollHeight }
  const getViewport = () => { const e = el(); return e ? e.clientHeight : window.innerHeight }
  const doScroll = (top: number, behavior: ScrollBehavior) => {
    const e = el()
    if (e) e.scrollTo({ top, behavior })
    else window.scrollTo({ top, behavior })
  }

  const [pinned, setPinned] = useState(true)
  const pinnedRef = useRef(true)
  const lastYRef = useRef(0)
  const setPin = (v: boolean) => { pinnedRef.current = v; setPinned(v) }

  // ⛔ THE PIN CANNOT BE DRIVEN BY THE SCROLL EVENT ALONE. INSTRUMENTED IN WEBKIT (window.scrollTo
  // wrapped, stacks captured): after a scroll to the top of a 23,650px thread the ResizeObserver
  // callback fired at t+111ms and the `scroll` EVENT did not arrive until t+134ms. Everything that
  // consumed the pin in between read a stale `true` and scrolled the user straight back down — the
  // yank, arriving through the very machinery meant to prevent it.
  // THE SYNCHRONOUS TRUTH is the position itself: record where WE last put the view, and if the view is
  // now ABOVE that, something other than us moved it. Decidable in the same tick, no event, no timer.
  // ⚠ IT MUST BE "MOVED UP FROM OUR LAST SCROLL", NOT "FAR FROM THE BOTTOM". Content growing BELOW the
  // viewport — a 1,200px answer landing — also puts the view far from the bottom, and a distance test
  // would read that as the user leaving and stop following mid-answer.
  const lastAutoYRef = useRef(-1)
  const userMovedUp = () => lastAutoYRef.current >= 0 && getY() < lastAutoYRef.current - 4

  /** THE ONE GATE every automatic scroll passes through — the React pin AND the synchronous position
   *  check, because either alone is wrong: the pin lags the event, and the position alone cannot tell
   *  "the user left" from "the content grew". Unpinning here (rather than waiting for the scroll event)
   *  also means the jump-to-bottom affordance appears in the same frame the user takes control. */
  const stillFollowing = () => {
    if (!pinnedRef.current) return false
    if (userMovedUp()) { setPin(false); return false }
    return true
  }

  // ⛔ THE DEFAULT IS 'instant', AND 'auto' IS BANNED. globals.css sets `html { scroll-behavior: smooth }`
  // and per spec `behavior:'auto'` means "use the element's computed scroll-behavior" — so every scroll
  // that called itself instant was in fact ANIMATED. Instrumented on a 26,677px thread: a single
  // scrollTo({behavior:'auto'}) crawled 25911 → 25870 → 25772 → 25602 and was still moving 3.7 SECONDS
  // later, under the user's finger. 'instant' ignores the CSS and lands in one frame.
  const bottom = (behavior: ScrollBehavior = 'instant') => {
    const go = () => {
      doScroll(getMaxY(), behavior)
      // Record where we put it. With 'instant' this is the final position; with 'smooth' it is the
      // animation's START, a LOWER bound, which can never manufacture a false "the user moved up".
      lastAutoYRef.current = getY()
    }
    go()
    // ⛔ THE DEFERRED SHOTS OBEY THE PIN. `bottom()` fires three times to survive late markdown layout;
    // the two deferred shots used to run unconditionally, so a content-settle at the bottom scheduled a
    // scroll for +250ms, the user scrolled up inside that window and correctly unpinned, and the
    // orphaned timer fired anyway and dragged them back. A pin that governs only the DECISION to scroll,
    // and not the scrolls already in flight, is not a pin.
    requestAnimationFrame(() => { if (stillFollowing()) go() })
    window.setTimeout(() => { if (stillFollowing()) go() }, 250)
  }

  const followBottom = (behavior: ScrollBehavior = 'instant') => {
    if (stillFollowing()) bottom(behavior)
  }

  // RE-PIN BY DISTANCE (they came back), UNPIN BY DIRECTION (they left). Order matters: a user scrolling
  // up INSIDE the near-bottom band has not really left, so the distance test wins.
  useEffect(() => {
    if (!active) return
    lastYRef.current = getY()
    const onScroll = () => {
      const y = getY()
      const movedUp = y < lastYRef.current - 2   // 2px of slack: iOS emits sub-pixel jitter at rest
      lastYRef.current = y
      const dist = getMaxY() - (y + getViewport())
      if (dist <= NEAR_BOTTOM_PX) { if (!pinnedRef.current) setPin(true) }
      else if (movedUp && pinnedRef.current) setPin(false)
    }
    const target: HTMLElement | Window = el() ?? window
    target.addEventListener('scroll', onScroll as EventListener, { passive: true })
    return () => target.removeEventListener('scroll', onScroll as EventListener)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, scrollerRef])

  // ⚠ TAKE SCROLL RESTORATION OFF THE BROWSER — DOCUMENT SCROLLER ONLY. MEASURED on a clean load: 55
  // bubbles rendered, our scroll ran, and the page still sat at scrollY 0 of 22,784 with
  // history.scrollRestoration = 'auto'. The browser restores position on the load event, which lands
  // AFTER our effect and silently undoes it. Meaningless for an element scroller, so it is skipped
  // there rather than applied blindly.
  const didInitialScroll = useRef(false)
  useEffect(() => {
    if (!active) return
    let prev: ScrollRestoration | undefined
    if (isDoc()) {
      prev = history.scrollRestoration
      try { history.scrollRestoration = 'manual' } catch { /* unsupported — our own scroll still runs */ }
    }
    // The first landing is not an auto-follow; it is where the surface opens.
    bottom()
    return () => { if (isDoc() && prev) { try { history.scrollRestoration = prev } catch {} } }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active])

  // ⚠ EVEN THE FIRST LANDING OBEYS THE USER. Hydration is async and a long thread settles for seconds;
  // instrumented, this effect fired AFTER the harness had already scrolled away, and an unconditional
  // bottom() here dragged the view back. If they have already moved, they win.
  // ⚠ THE FIRST ONE IS INSTANT, NOT SMOOTH — smooth-scrolling a hydrated 18,740px thread leaves the page
  // sitting at the top for seconds. Instant for the initial landing, smooth for turns the user sends.
  useEffect(() => {
    if (!active) return
    if (!didInitialScroll.current) { didInitialScroll.current = true; followBottom('instant'); return }
    followBottom('smooth')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, ...watch])

  // ⚠ STAY GLUED WHILE THE CONTENT IS STILL GROWING. Three attempts (now / next frame / +250ms) are not
  // enough for a hydrated markdown thread: MEASURED, the page settled 64px short on open and 1,294px
  // short after an answer landed, because react-markdown subtrees and long tables lay out well after our
  // last retry and the scroll target had moved. While PINNED, any growth re-glues; while UNPINNED it
  // does nothing at all, so it can never become another way to yank the user.
  useEffect(() => {
    if (!active) return
    const node = contentRef.current
    if (!node || typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(() => followBottom('instant'))
    ro.observe(node)
    return () => ro.disconnect()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, contentRef])

  // ⛔ CLEAN ON MOUNT. The shelf stays MOUNTED inside Shell while the page REMOUNTS, so a surface that
  // reopens must not inherit the previous session's pin state — that is the same class as the d55f739
  // cross-client bleed, one layer down.
  useEffect(() => {
    if (active) return
    didInitialScroll.current = false
    lastAutoYRef.current = -1
    setPin(true)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active])

  return { pinned, bottom, followBottom, setPin }
}
