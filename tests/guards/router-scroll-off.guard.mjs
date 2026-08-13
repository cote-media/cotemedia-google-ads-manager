#!/usr/bin/env node
// LORAMER_NEXT_ROUTER_SCROLL_OFF_V1 — every navigation that CAN suppress Next's scroll MUST.
//
// ⛔ THE CORRECTED PREMISE THIS GUARD ENFORCES. LORAMER_NEXT_LANDING_SCROLL_V1 shipped on the belief that
// the router's post-commit scroll "must be out-run". That is WRONG on the PUSH path: next@14.2.3 declares
// `NavigateOptions { scroll?: boolean }` and `push(href, options?)` / `replace(href, options?)`, so the
// scroll can simply be TURNED OFF. It is right only on the POP path — `back(): void` takes no parameters
// and App Router restores the recorded offset with no documented opt-out.
//   ⇒ SUPPRESS WHERE POSSIBLE, RACE ONLY WHERE IT IS NOT.
//
// (a) Every navigation INTO the Lora page passes { scroll: false }.
// (b) `openLora`'s injected navigator can CARRY options — it was typed `(href: string) => void`, a
//     one-argument function, which did not merely fail to pass the option, it made passing it
//     IMPOSSIBLE. A narrowing back to one argument silently re-breaks every caller at once.
// (c) The Lora EXIT suppresses, and only because it records a landing intent on the same path.
// (d) SUPPRESSION IS SCOPED. `scroll:false` is not a global good — on a route that owns no landing it
//     strands the user at the previous page's offset. Generic nav Links and the client switcher must NOT
//     carry it. This leg exists because the guard's first run caught me applying it everywhere.
// (e) The POP path is UNTOUCHED — router.back() stays, and the arrival grace stays with it.
// (f) The landing probe exists and is flag-gated.
//
// ⛔ WHAT THIS GUARD CANNOT DO — ★CHAT-RENDER-MEASUREMENT-MISSING, restated so a green run is not
// over-read: it proves the SUPPRESSION IS REQUESTED, never that the page lands anywhere in particular.
// Whether Lora opens on the newest message is a device observation. GATE-B IS STILL THE ONLY PROOF.
import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'

// ⚠ HONOURS LORAMER_GUARD_ROOT — ★GUARD-IGNORES-LORAMER-GUARD-ROOT: a guard reading relative paths
// silently reads the REAL tree during a throwaway RED proof and reports a false PASS.
const ROOT = process.env.LORAMER_GUARD_ROOT || process.cwd()
const findings = []
const check = (c, m) => { if (!c) findings.push(m) }
const read = (p) => { try { return readFileSync(resolve(ROOT, p), 'utf8') } catch { return '' } }
// QUOTATION IS NOT ASSERTION. Block comments are stripped SPAN-WISE (newlines preserved so line numbers
// stay true) because a `{/*` JSX comment is not caught by a line-prefix test — that exact gap made
// landing-scroll.guard's first run flag correct code.
const stripBlocks = (src) => src.replace(/\{?\/\*[\s\S]*?\*\/\}?/g, (m) => m.replace(/[^\n]/g, ' '))
const isCode = (l) => { const t = l.trim(); return t && !t.startsWith('//') && !t.startsWith('*') }
const codeOf = (src) => stripBlocks(src).split('\n').map((l, i) => ({ n: i + 1, l })).filter(({ l }) => isCode(l))

const OPEN = 'src/lib/next/open-lora.ts'
const LORA = 'src/app/dashboard-next/lora/LoraPageClient.tsx'
const MOBILE = 'src/components/redesign/MobileNav.tsx'
const RAIL = 'src/components/redesign/RailContent.tsx'
const TOP = 'src/components/redesign/TopBar.tsx'
const STICK = 'src/lib/next/use-stick-to-bottom.ts'
const THREAD = 'src/components/redesign/LoraThread.tsx'

for (const f of [OPEN, LORA, MOBILE, RAIL, TOP, STICK, THREAD]) {
  if (!existsSync(resolve(ROOT, f))) {
    console.error(`[router-scroll-off] FAIL — ${f} is missing.`)
    process.exit(1)
  }
}

const open = codeOf(read(OPEN))
const lora = codeOf(read(LORA))
const mobile = codeOf(read(MOBILE))
const rail = codeOf(read(RAIL))
const top = codeOf(read(TOP))
const stick = codeOf(read(STICK))
const thread = codeOf(read(THREAD))

// ── (a) THE LORA ENTRY SUPPRESSES ───────────────────────────────────────────────────────────────────
{
  const pushes = open.filter(({ l }) => /push\(loraPageHref\(/.test(l))
  check(pushes.length > 0, `(a) ${OPEN} no longer pushes loraPageHref — cannot verify the Lora entry.`)
  for (const { n, l } of pushes) {
    check(
      /\{\s*scroll:\s*false\s*\}/.test(l),
      `(a) ${OPEN}:${n} — the Lora entry push omits { scroll: false }. Next's scroll-to-top then lands ` +
        'the page on the FIRST message and our landing scroll has to race it.',
    )
  }
}

// ── (b) THE INJECTED NAVIGATOR CAN CARRY OPTIONS ────────────────────────────────────────────────────
{
  const narrowed = open.filter(({ l }) => /push:\s*\(href:\s*string\)\s*=>\s*void/.test(l))
  check(
    narrowed.length === 0,
    `(b) ${OPEN}${narrowed.length ? ':' + narrowed.map(({ n }) => n).join(',') : ''} — the injected ` +
      'navigator is typed as a ONE-ARGUMENT function again. That does not just drop { scroll: false }, ' +
      'it makes passing it impossible, and it breaks all four callers at once and silently.',
  )
  check(
    open.some(({ l }) => /scroll\?:\s*boolean/.test(l)),
    `(b) ${OPEN} does not declare a scroll option on its navigator type.`,
  )
  check(
    open.some(({ l }) => /export function openLora\(push:\s*PushWithOptions/.test(l)),
    `(b) openLora no longer takes the widened PushWithOptions navigator.`,
  )
}

// ── (c) THE LORA EXIT SUPPRESSES — IT CARRIES AN EXPLICIT LANDING INTENT ────────────────────────────
{
  const loraFallback = lora.filter(({ l }) => /router\.push\(fallback/.test(l))
  check(loraFallback.length > 0, `(c) ${LORA} no longer pushes the fallback.`)
  for (const { n, l } of loraFallback) {
    check(/\{\s*scroll:\s*false\s*\}/.test(l), `(c) ${LORA}:${n} — router.push(fallback) omits { scroll: false }.`)
  }
  // The suppression is only legitimate BECAUSE an intent is recorded on the same path. If the
  // requestLanding call ever goes away, scroll:false stops being a fix and becomes the bug below.
  check(
    lora.some(({ l }) => /requestLanding\(/.test(l)),
    '(c) The Lora exit suppresses the router scroll but records no landing intent — the Overview would ' +
      'then simply keep whatever scroll position Lora had.',
  )
}

// ── (d) SUPPRESSION IS SCOPED — AND THIS LEG EXISTS BECAUSE I GOT IT WRONG FIRST ────────────────────
// ⛔ `scroll: false` IS NOT A GLOBAL GOOD. It does not mean "land sensibly"; it means "do not move the
// scroll position at all". On a destination that OWNS its landing (the Lora page always goes to the
// newest message; the Overview consumes a recorded 'top' intent) that is exactly right. On a destination
// that owns NOTHING — Store, Mer, Analytics, Team, All Clients, client-profile — it strands the user at
// whatever offset the PREVIOUS page had: tap Store from the bottom of a long Lora thread and you arrive
// scrolled into the middle of Store. **Next's default scroll-to-top is CORRECT for those routes**, and
// suppressing it there trades one positional defect for a worse one.
// This guard's first run flagged MobileNav:21/:32 and RailContent:49 after I had applied the option by
// the rule "suppress everywhere you can". RailContent:74 was worse still — a LOOP over every rail item,
// so one attribute would have suppressed Overview, Google Ads, Meta Ads, Analytics, Store, Mer AND Team.
// They were reverted. The rule is SUPPRESS WHERE THE DESTINATION OWNS ITS LANDING, nowhere else.
{
  for (const [file, lines] of [[MOBILE, mobile], [RAIL, rail]]) {
    const stray = lines.filter(({ l }) => /<Link\b/.test(l) && /scroll=\{false\}/.test(l))
    check(
      stray.length === 0,
      `(d) ${file}${stray.length ? ':' + stray.map(({ n }) => n).join(',') : ''} — <Link scroll={false}> on a ` +
        'generic nav destination. Those routes own no landing decision, so this strands the user at the ' +
        "PREVIOUS page's scroll offset instead of landing them at the top.",
    )
  }
  // The client switcher is the sharpest case: suppressing there carries one client's scroll position onto
  // another client's page, which is the same law mergeThreadForClient and readTurnInFlight enforce.
  const switcher = top.filter(({ l }) => /router\.push\(clientId\s*\?/.test(l))
  check(switcher.length > 0, `(d) ${TOP} client switcher push not found.`)
  for (const { n, l } of switcher) {
    check(
      !/\{\s*scroll:\s*false\s*\}/.test(l),
      `(d) ${TOP}:${n} — the client switcher passes { scroll: false }, which CARRIES SCROLL POSITION ` +
        'ACROSS A CLIENT SWITCH. Scroll state must not survive a client change.',
    )
  }
}

// ── (e) THE POP PATH IS UNTOUCHED, AND ITS RACE MACHINERY SURVIVES ──────────────────────────────────
{
  // back() must remain: replacing it with push() creates a system-gesture back-loop, and replace()
  // destroys the forward entry and makes the cameFromApp gate dead code. Russ's decision, pinned here.
  check(
    lora.some(({ l }) => /router\.back\(\)/.test(l)),
    `(e) ${LORA} no longer calls router.back() — the POP exit was replaced. That is a route decision ` +
      'with history-stack consequences (back-loop on push, lost forward entry on replace), not a scroll fix.',
  )
  // back() takes no options in next@14.2.3; anyone who "fixes" it by passing some will be silently wrong.
  const bogus = lora.filter(({ l }) => /router\.back\(\s*\{/.test(l))
  check(
    bogus.length === 0,
    `(e) ${LORA}${bogus.length ? ':' + bogus.map(({ n }) => n).join(',') : ''} — options passed to ` +
      'router.back(). next@14.2.3 declares back(): void; the argument is silently ignored.',
  )
  // The grace is the ONLY defence on the POP path and must not be removed as "now redundant".
  check(
    stick.some(({ l }) => /ARRIVAL_GRACE_MS/.test(l)) && stick.some(({ l }) => /arriving\(\)/.test(l)),
    '(e) The arrival grace is gone from use-stick-to-bottom. Suppression covers PUSH only; a POP into ' +
      'Lora (forward button, or backing in) and a hard reload still restore, and racing is the only ' +
      'option there.',
  )
}

// ── (f) THE PROBE FAMILY IS REMOVED AND MUST NOT RETURN PIECEMEAL ───────────────────────────────────
// ⛔ THIS LEG INVERTED 2026-08-13 (LORAMER_GEO_PROBE_DISARMED_V1), SEEN RED FIRST — five findings against
// the tree the removal produced, then each rewritten to pin the REMOVAL instead of the presence. Gate-B
// closed on device (at-rest geometry exact, zero ⛔ flags across all samples), and the whole ?debug=chat
// instrument family came out: strips, arming flag, endpoint, and the NEUTERED landing-probe machinery —
// which, with its on-screen consumer deleted, could never be observed again and was therefore dead code
// wearing an instrument's name.
// ⛔ WHAT THIS LEG NOW PREVENTS: a HALF-RETURN. The old probe carried two banked spec defects (mismatched
// bases; an arming window that closed before hydration — ★LANDING-PROBE-SPEC-IS-WRONG, recorded in the
// QUEUE at ★LANDING-PROBE-STICKY-UNFIXED, closed-by-removal) and a sticky-detach defect. Re-adding any
// piece of it without a NEW decision re-ships those. A future landing probe is welcome — behind a fresh
// marker, with its spec argued against the recorded defects, and with this leg moved deliberately.
{
  check(
    !stick.some(({ l }) => /setProbeLines\(|probeArmedRef|loramer:debug-landing/.test(l)),
    '(f) landing-probe machinery is back in use-stick-to-bottom (setProbeLines/probeArmedRef/loramer:debug-landing). ' +
      'It was REMOVED 2026-08-13 with Gate-B closed; its spec defects are banked in the QUEUE. A new probe needs a new decision, not a resurrection.',
  )
  check(
    !thread.some(({ l }) => /probeLines\.map\(|landingProbe|GEO PROBE/.test(l)),
    '(f) a probe strip is back in LoraThread (probeLines/landingProbe/GEO PROBE). The ?debug=chat strips were removed 2026-08-13 after Gate-B closed on device.',
  )
}

console.log(`[router-scroll-off] scanned ${open.length} open-lora · ${lora.length} lora · ${mobile.length} mobile · ${rail.length} rail · ${top.length} top · ${stick.length} stick`)
if (findings.length) {
  console.error(`[router-scroll-off] FAIL — ${findings.length} finding(s):`)
  for (const f of findings) console.error(`  · ${f}`)
  process.exit(1)
}
console.log('[router-scroll-off] PASS — every PUSH/Link suppresses, the navigator can carry options, the POP path and its grace survive. ⛔ Proves the REQUEST, never the resulting position.')
