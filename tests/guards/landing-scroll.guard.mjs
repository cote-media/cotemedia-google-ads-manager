#!/usr/bin/env node
// LORAMER_NEXT_LANDING_SCROLL_V1 — guard the landing-position INTENT at both entry points.
//
// ⛔ READ THIS BEFORE TRUSTING A GREEN RUN. ★CHAT-RENDER-MEASUREMENT-MISSING is the standing gap and this
// guard does NOT close it. No guard in this repo can compute where an element lands — that needs a real
// layout engine, a real viewport and a real scroll height, none of which exist at build time.
//   WHAT IT CAN ASSERT: that the intent is RECORDED by the navigation that leaves Lora; that the Overview
//   MOUNTS a consumer for it; that the consumer is one-shot and client-scoped; that the instant-scroll
//   call defeats `html { scroll-behavior: smooth }` rather than silently animating; and that the arrival
//   grace exists, is bounded, and is cleared on the client-switch reset path.
//   WHAT IT CANNOT ASSERT: that the Overview actually ends up at scrollY 0, that Lora actually ends up at
//   the newest message, or that either is true on a real device. Three positional defects in a row have
//   reached Russ's thumb precisely because that half is unguardable here. **GATE-B IS THE ONLY PROOF.**
import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'

// ⚠ HONOURS LORAMER_GUARD_ROOT — see ★GUARD-IGNORES-LORAMER-GUARD-ROOT (found 2026-08-07): a guard that
// reads relative paths silently reads the REAL tree during a throwaway RED proof and reports a false PASS.
const ROOT = process.env.LORAMER_GUARD_ROOT || process.cwd()
const findings = []
const check = (c, m) => { if (!c) findings.push(m) }
const read = (p) => { try { return readFileSync(resolve(ROOT, p), 'utf8') } catch { return '' } }
// QUOTATION IS NOT ASSERTION — these files quote the old behaviour and the banned 'auto' in their comments.
// ⛔ AND A LINE-PREFIX TEST IS NOT ENOUGH IN A TSX FILE. This guard's own first run proved it: leg (a)'s
// ordering check failed against CORRECT code because `LoraPageClient.tsx:56` opens a JSX comment with
// `{/*` and quotes `router.back()` inside it. A prefix test for `//`, `*` and `/*` does not match `{/*`,
// so a HISTORY LESSON was read as the live call and ordered before the real one. Block comments are
// stripped span-wise, newlines preserved so reported line numbers stay true.
const stripBlocks = (src) => src.replace(/\{?\/\*[\s\S]*?\*\/\}?/g, (m) => m.replace(/[^\n]/g, ' '))
const isCode = (l) => { const t = l.trim(); return t && !t.startsWith('//') && !t.startsWith('*') }
const codeOf = (src) => stripBlocks(src).split('\n').map((l, i) => ({ n: i + 1, l })).filter(({ l }) => isCode(l))

const LIB = 'src/lib/next/landing-scroll.ts'
const CONSUMER = 'src/components/redesign/LandingScroll.tsx'
const OVERVIEW = 'src/app/dashboard-next/page.tsx'
const LORA = 'src/app/dashboard-next/lora/LoraPageClient.tsx'
const STICK = 'src/lib/next/use-stick-to-bottom.ts'

for (const f of [LIB, CONSUMER, OVERVIEW, LORA, STICK]) {
  if (!existsSync(resolve(ROOT, f))) {
    console.error(`[landing-scroll] FAIL — ${f} is missing.`)
    process.exit(1)
  }
}

const lib = codeOf(read(LIB))
const consumer = codeOf(read(CONSUMER))
const overview = codeOf(read(OVERVIEW))
const lora = codeOf(read(LORA))
const stick = codeOf(read(STICK))

// ── (a) THE INTENT IS RECORDED WHEN LEAVING LORA, ON BOTH BRANCHES ──────────────────────────────────
{
  const req = lora.filter(({ l }) => /requestLanding\(/.test(l))
  check(req.length > 0, `(a) ${LORA} never records a landing intent — the Overview has nothing to consume.`)
  for (const { n, l } of req) {
    check(
      /LANDING\.OVERVIEW/.test(l) && /'top'/.test(l),
      `(a) ${LORA}:${n} — the recorded intent is not (OVERVIEW, 'top').`,
    )
  }
  // It must be recorded BEFORE the branch, or only one of router.back()/router.push() gets the behaviour —
  // which is exactly the PUSH-vs-POP split that broke the earlier back-button work.
  const reqIdx = lora.findIndex(({ l }) => /requestLanding\(/.test(l))
  const backIdx = lora.findIndex(({ l }) => /router\.back\(\)/.test(l))
  check(
    reqIdx !== -1 && backIdx !== -1 && reqIdx < backIdx,
    '(a) requestLanding does not precede router.back() — a POP arrival would miss the intent while a ' +
      'PUSH arrival got it, leaving the two navigation types with two behaviours.',
  )
}

// ── (b) THE OVERVIEW MOUNTS A CONSUMER, AND IT IS ONE-SHOT + CLIENT-SCOPED ──────────────────────────
{
  check(
    overview.some(({ l }) => /<LandingScroll\b/.test(l)),
    `(b) ${OVERVIEW} does not mount <LandingScroll/> — the intent is recorded and never read.`,
  )
  check(
    overview.some(({ l }) => /<LandingScroll[^>]*clientId=/.test(l)),
    '(b) <LandingScroll/> is mounted without clientId — the intent cannot be client-scoped.',
  )
  check(
    consumer.some(({ l }) => /consumeLanding\(/.test(l)),
    `(b) ${CONSUMER} never calls consumeLanding.`,
  )
  // ONE-SHOT: the record must be removed by the read, not left to fire again on the next arrival.
  check(
    lib.some(({ l }) => /sessionStorage\.removeItem\(/.test(l)),
    '(b) consumeLanding never removes the record — a single intent would re-fire on every later arrival.',
  )
  // CLIENT-SCOPED: scroll state must not carry across a client switch.
  check(
    lib.some(({ l }) => /rec\.clientId\s*\?\?\s*null\)\s*!==\s*want/.test(l)) ||
      lib.some(({ l }) => /!==\s*want/.test(l) && /return null/.test(l)),
    '(b) consumeLanding does not refuse a record belonging to another client — scroll position would ' +
      'carry across a client switch.',
  )
  // sessionStorage, not localStorage: a landing intent belongs to THIS document's navigation.
  const local = lib.filter(({ l }) => /localStorage\./.test(l))
  check(local.length === 0, `(b) localStorage used at ${local.map(({ n }) => `${LIB}:${n}`).join(', ')} — it leaks the intent into every other tab.`)
}

// ── (c) THE INSTANT JUMP DEFEATS scroll-behavior: smooth ────────────────────────────────────────────
{
  const jump = lib.filter(({ l }) => /window\.scrollTo\(\{/.test(l))
  check(jump.length > 0, '(c) No document scroll call in landing-scroll.')
  for (const { n, l } of jump) {
    check(
      /behavior:\s*'instant'/.test(l),
      `(c) ${LIB}:${n} — scrollTo without behavior:'instant'. globals.css sets ` +
        "`html { scroll-behavior: smooth }`, and 'auto' means \"use the computed scroll-behavior\", so " +
        'the call would ANIMATE. Measured previously: still crawling 3.7s later.',
    )
  }
  check(
    !lib.some(({ l }) => /behavior:\s*'auto'/.test(l)),
    "(c) behavior:'auto' appears in landing-scroll — it is banned in this repo for the reason above.",
  )
}

// ── (d) THE ARRIVAL GRACE EXISTS, IS BOUNDED, AND DOES NOT SURVIVE A CLIENT SWITCH ──────────────────
{
  check(
    stick.some(({ l }) => /ARRIVAL_GRACE_MS/.test(l)),
    `(d) ${STICK} has no arrival grace — the router's restoration scroll is still read as the user ` +
      'scrolling up, which unpins, cancels the deferred shots and raises the chevron on an untouched thread.',
  )
  // Bounded: a grace that never expires is a pin that can never be released by the user.
  const decl = stick.find(({ l }) => /const ARRIVAL_GRACE_MS\s*=\s*(\d+)/.test(l))
  check(!!decl, '(d) ARRIVAL_GRACE_MS is not a literal constant — it cannot be shown to be bounded.')
  if (decl) {
    const ms = Number(decl.l.match(/=\s*(\d+)/)?.[1] ?? 0)
    check(ms > 0 && ms <= 1000, `(d) ARRIVAL_GRACE_MS is ${ms}ms — outside the defensible 1..1000 range. Too long and a real user scroll inside the window is ignored.`)
  }
  // BOTH the synchronous test and the scroll EVENT must honour it, or the event path still hands the pin away.
  check(
    stick.some(({ l }) => /userMovedUp\s*=\s*\(\)\s*=>\s*!arriving\(\)/.test(l)),
    '(d) userMovedUp does not consult the arrival grace.',
  )
  check(
    stick.some(({ l }) => /movedUp && pinnedRef\.current && !arriving\(\)/.test(l)),
    "(d) The scroll-event handler does not consult the arrival grace — guarding only the synchronous " +
      'test leaves the event path unpinning on the router\'s own scroll.',
  )
  // CLEARED on the !active reset — the shelf stays mounted across a client switch.
  const resetIdx = stick.findIndex(({ l }) => /didInitialScroll\.current = false/.test(l))
  check(resetIdx !== -1, '(d) The on-mount/inactive reset block is gone.')
  if (resetIdx !== -1) {
    const block = stick.slice(resetIdx, resetIdx + 6).map(({ l }) => l).join('\n')
    check(
      /arrivalUntilRef\.current\s*=\s*0/.test(block),
      '(d) The arrival window is not cleared on the client-switch reset — one client\'s arrival would ' +
        'suppress the next client\'s unpin, which is scroll state carried across a switch.',
    )
  }
}

console.log(`[landing-scroll] scanned ${lib.length} lib · ${consumer.length} consumer · ${overview.length} overview · ${lora.length} lora · ${stick.length} stick code lines`)
if (findings.length) {
  console.error(`[landing-scroll] FAIL — ${findings.length} finding(s):`)
  for (const f of findings) console.error(`  · ${f}`)
  process.exit(1)
}
console.log('[landing-scroll] PASS — intent recorded, consumed once, client-scoped, instant, grace bounded. ⛔ This proves INTENT, never POSITION (★CHAT-RENDER-MEASUREMENT-MISSING).')
