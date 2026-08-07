// LORAMER_NEXT_LANDING_SCROLL_V1 — WHERE A SURFACE OPENS IS A DECISION, AND NOBODY WAS MAKING IT.
//
// ⛔ THE MECHANISM, NAMED FROM THE CODE RATHER THAN ASSUMED. There is NO `scrollRestoration` key in
// next.config, so **Next.js App Router's DEFAULT scroll handling is in force**: a PUSH scrolls the
// document to the top of the new route, and a POP (which is what the Lora chevron's `router.back()`
// performs) RESTORES the recorded offset. That default is why backing out of Lora lands mid-page on the
// Overview — the Overview's old offset is faithfully restored, exactly as designed. Nothing in Shell,
// `/dashboard-next/page.tsx` or `MultiClientOverview` sets an initial position, so the router's default
// is the only thing deciding, and it decides against us on both surfaces.
//
// ⛔ AND THE ROUTER'S RESTORATION IS NOT THE BROWSER'S. `use-stick-to-bottom` already sets
// `history.scrollRestoration = 'manual'` for the document scroller, and that defence is real — but it
// only disarms the BROWSER's restore-on-load. **It does not touch Next's own post-commit scroll**, which
// is a different mechanism running on a client-side navigation where no load event exists at all. That
// gap is why "correct on a hard load, wrong on a soft nav" has been the shape of every one of these.
//
// ⛔ THE PART THAT ALSO EXPLAINS THE CHEVRON-IN-DEAD-SPACE SYMPTOM, and it falls straight out of reading
// `use-stick-to-bottom` next to the router's behaviour. `bottom()` records where it put the view in
// `lastAutoYRef`, and `userMovedUp()` decides the user took control when `getY() < lastAutoYRef - 4`.
// **The router's restoration scroll is, to that test, INDISTINGUISHABLE FROM THE USER SCROLLING UP.** So
// on arrival: our landing scroll runs, the router then restores an offset above it, `userMovedUp()`
// reads true, `stillFollowing()` calls `setPin(false)`, the two deferred shots (rAF and +250ms) are
// CANCELLED — and the jump-to-bottom affordance appears on a thread the user never touched. One cause,
// three symptoms: lands mid-thread, stays there, and shows a chevron explaining a scroll that never happened.
//
// THE FIX IS AN EXPLICIT ARRIVAL INTENT, recorded by the navigation that causes it and consumed once by
// the surface that receives it. It works identically for PUSH and POP because it does not depend on the
// navigation type at all — which is the requirement the earlier back-button work failed.
import { RECOVERY_WINDOW_MS } from '@/lib/next/chat-recovery'

const KEY = 'loramer:landing-intent'

export const LANDING = { OVERVIEW: 'overview', LORA: 'lora' } as const
export type LandingSurface = (typeof LANDING)[keyof typeof LANDING]
export type LandingIntent = 'top' | 'bottom'

type Record_ = { surface: LandingSurface; intent: LandingIntent; clientId: string | null; at: number }

/**
 * Record where the NEXT arrival at `surface` should land. Called by the navigation, not the destination.
 *
 * ⚠ sessionStorage, not localStorage — per-tab, same reasoning as `in-flight-turn.ts`: a landing intent
 * is a property of THIS document's navigation, and localStorage would leak it into every other tab.
 */
export function requestLanding(surface: LandingSurface, intent: LandingIntent, clientId?: string | null): void {
  try {
    const rec: Record_ = { surface, intent, clientId: clientId ?? null, at: Date.now() }
    sessionStorage.setItem(KEY, JSON.stringify(rec))
  } catch { /* private mode / quota — a landing position must never throw into a navigation */ }
}

/**
 * Read and DELETE the intent for `surface`. One-shot by construction.
 *
 * ⛔ THREE REFUSALS, EACH ONE A BUG IT WOULD OTHERWISE SHIP:
 *   1. WRONG SURFACE → null, and the record is LEFT ALONE. The Overview must not eat Lora's intent.
 *   2. CLIENT MISMATCH → null, and the record IS cleared. Scroll position must not carry across a client
 *      switch — the same law `mergeThreadForClient` and `readTurnInFlight` enforce. An intent recorded
 *      while looking at client A is meaningless once the user is on client B, and acting on it would
 *      scroll B's surface because of something A did.
 *   3. STALE → null. An intent is consumed by the very next arrival or it is worthless; anything older
 *      than the turn window describes a navigation that already happened some other way.
 */
export function consumeLanding(surface: LandingSurface, clientId?: string | null): LandingIntent | null {
  try {
    const raw = sessionStorage.getItem(KEY)
    if (!raw) return null
    const rec = JSON.parse(raw) as Partial<Record_>
    if (!rec || rec.surface !== surface) return null
    sessionStorage.removeItem(KEY)
    if (typeof rec.at !== 'number' || Date.now() - rec.at > RECOVERY_WINDOW_MS) return null
    const want = clientId ?? null
    if ((rec.clientId ?? null) !== want) return null
    return rec.intent === 'top' || rec.intent === 'bottom' ? rec.intent : null
  } catch { return null }
}

/**
 * Put the DOCUMENT at the top, now, without animation.
 *
 * ⛔ `behavior: 'instant'`, AND 'auto' IS BANNED FOR THE REASON ALREADY MEASURED IN THIS REPO.
 * `globals.css:126` sets `html { scroll-behavior: smooth }`, and per spec `behavior:'auto'` means "use
 * the element's computed scroll-behavior" — so a call that calls itself instant is in fact ANIMATED.
 * Instrumented previously on a 26,677px thread: one `scrollTo({behavior:'auto'})` was still crawling
 * 3.7 SECONDS later under the user's finger. `'instant'` ignores the CSS and lands in one frame.
 *
 * ⚠ THREE SHOTS — now, next frame, +250ms — deliberately mirroring `use-stick-to-bottom`'s `bottom()`.
 * The router's own scroll lands AFTER our effect on a soft navigation, so a single call is silently
 * undone by it. This is the same shape for the same reason, and it is cheap: a scroll to a position the
 * document is already at is a no-op.
 */
export function jumpToTopInstant(): void {
  const go = () => { try { window.scrollTo({ top: 0, behavior: 'instant' as ScrollBehavior }) } catch { window.scrollTo(0, 0) } }
  go()
  try {
    requestAnimationFrame(go)
    window.setTimeout(go, 250)
  } catch { /* non-browser — the first shot already ran */ }
}
