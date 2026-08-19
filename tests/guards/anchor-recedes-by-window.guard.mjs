#!/usr/bin/env node
// LORAMER_ANCHOR_RECEDES_BY_WINDOW_V1 — THE WALK GAINS A WINDOW PER PASS, NOT A RANGE.
// LORAMER_TERMINAL_PARENT_CLAMPS_TO_INCEPTION_V1 (leg C, 2026-08-19) — …AND THE LAST ONE IS THE REMAINDER.
//
// ⛔ WHAT THIS GUARD WAS, AND WHY IT CHANGED SHAPE. It shipped RED on 2026-08-17 asserting the defect:
// `deriveAnchorEnd` receded to `lastWindowStart − 1` where "the last window" came from
// `universe_surface_rotation`, which returned the last RANGE walked, because the consumer wrote range bounds
// into columns named `window_start`/`window_end`. Ranges are walked in ASCENDING date order, so the newest row
// was the range nearest the TOP of the window and the step was ONE DAY. MEASURED by the drive over five
// consecutive passes, zero variance: ~1,427 passes / ~2,854 vendor requests per surface, ~4 years each,
// 346 surfaces. THE WALK COULD NOT REACH INCEPTION AT ALL.
//
// ⛔ IT NOW ASSERTS THE **NEW CONTRACT**, IN LEGS THAT MUST ALL HOLD — LORAMER_PARENT_WINDOW_IS_THE_UNIT_V1:
//   (A) A **KNOWN**, FULLY-ANSWERED WINDOW RECEDES BY THE WINDOW. `universe_attempt_log.parent_window_start/end`
//       (migrations/082) records the ask; the rotation prefers it; the anchor moves a full ~30 days.
//   (B) AN **UNKNOWN** WINDOW DOES NOT RECEDE AT ALL. A pre-082 row carries no parent, and the window it
//       belonged to is recoverable from NO STORED FACT — sizing is adaptive and time-varying, so it cannot be
//       recomputed, forwards or backwards. Receding on bounds we cannot vouch for is the false-all-clear class
//       this rebuild exists to end, so UNKNOWN holds.
//   (C) EVERY ANCHOR MOVE THE LEDGER ACTUALLY RECORDED IS THE WIDTH OF THE WINDOW THAT WAS ASKED, AND NO DAY
//       IS SKIPPED BETWEEN CONSECUTIVE WINDOWS. Rewritten 2026-08-19; see the block above leg (C).
// ⛔ LEG (B) IS NOT A NICETY. Without it the transitional period is the CATASTROPHIC configuration the
// 2026-08-18 adversary pass named: a rotation returning parent-preferred bounds while legacy rows still return
// range bounds would recede a full window on the evidence of one answered day. Either leg alone is worse than
// the defect it replaces.
//
// ⛔ IT DRIVES THE REAL COMPILED FUNCTION, not a copy. A re-implementation of the arithmetic here would prove
// this file's arithmetic, which is the class of mistake the whole 2026-08-17 session was about.
//
// ⚠ WHAT LEGS (A)/(B)/(B2) STILL CANNOT SEE, STATED SO THEIR GREEN IS NOT OVER-READ: they are a UNIT DRIVE.
// Both live skip mechanisms found on 2026-08-18 sit at this function's CALLERS — the ungated hold branch and
// the mis-sized upper half dropped at publish — and are invisible to them by construction. That is what
// `no-owed-day-left-behind.guard.mjs` (the warehouse property), `mis-size-must-re-owe.guard.mjs` and LEG (C)
// are for. A green on (A) means the STEP SIZE is right in the function. It does not mean the LEDGER only ever
// recorded right-sized steps — that is a different question and it needed a different leg.
//
// USAGE: node tests/guards/anchor-recedes-by-window.guard.mjs
//        node tests/guards/anchor-recedes-by-window.guard.mjs --inject-illegal-recede   ← RED PROOF: a 1-day step
//        node tests/guards/anchor-recedes-by-window.guard.mjs --inject-skipped-gap      ← RED PROOF: skipped days
import { mkdtempSync, rmSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'

const ROOT = process.env.LORAMER_GUARD_ROOT || process.cwd()
const MIN_STEP_DAYS = 30            // sizing maxDays; a fully-answered window must yield its own width
const DAYS_TO_FLOOR = 1427          // 2026-01-30 → 2022-03-04, measured 2026-08-17
const INJECT_ONE_DAY = process.argv.includes('--inject-illegal-recede')
const INJECT_GAP = process.argv.includes('--inject-skipped-gap')
const out = mkdtempSync(join(tmpdir(), 'loramer-anchor-'))
const days = (a, b) => Math.round((new Date(a + 'T00:00:00Z') - new Date(b + 'T00:00:00Z')) / 86400000)
const shift = (iso, n) => new Date(Date.parse(iso + 'T00:00:00Z') + n * 86400000).toISOString().slice(0, 10)
const findings = []

// ═══════════════════════════════════════════════════════════════════════════════════════════════════════
// LEG (C) — REWRITTEN 2026-08-19 AFTER IT PRODUCED A FALSE RED ON ITS FIRST LIVE RUN
//
// ⛔ WHAT THE FIRST CUT GOT WRONG, BANKED HERE BECAUSE THE MISTAKE IS MORE INSTRUCTIVE THAN THE FIX.
//   1. **IT HARDCODED 30.** `policy.maxDays = 30` is a CEILING, not the size. `sizeFromPolicy`
//      (capture-adapter.ts:338-375) legally returns `coldStartDays` (7) on a cold start or under
//      `rises-with-range`, and `Math.min(maxDays, Math.max(minDays, floor(rowBudget / maxPerDay)))` on the
//      yielding branch — which is exactly 15 at 20,000 rows/day. `planMisSizedSplit` legally halves 30 to 15
//      again. Asserting "30 or a terminal remainder" therefore called four legal sizes illegal.
//   2. **IT MEASURED THE WRONG THING.** It compared `parent_window_START` to `parent_window_START`, which
//      equals the anchor's movement ONLY when consecutive parents share a width. **THE ANCHOR IS
//      `parent_window_END`** — `deriveWindow` sets `windowEnd = anchorEnd` — so when a mis-size split changes
//      the width from 30 to 15, the START moves 15 while the ANCHOR HAS NOT MOVED AT ALL.
//   RESULT: 5 findings on the two `content_suitability_placement_view` surfaces, every one a mis-size half
//   whose own ledger row says so in words — `MIS-SIZED, not broken: 2 attempt(s) at 30 days. Re-published at
//   15 day(s).` They were reported as ★ANCHOR-HOLD-BRANCH-IS-UNGATED and they are not that. FALSE RED, mine.
//
// ⛔ THE PROPERTY, TESTED DIRECTLY THIS TIME: **the anchor moves by the WIDTH OF THE WINDOW THAT WAS ASKED,
// and no day is skipped between consecutive windows.** Both halves fall out of ONE comparison, which is why
// this shape needs no size constant at all:
//     anchor(n) == start(n−1) − 1   ⟺   anchor(n−1) − anchor(n) == width(n−1)
// Contiguity and correct step size are the same statement. **NO SIZING NUMBER APPEARS IN THE LEGALITY RULE**,
// so no future change to `maxDays`, `rowBudget` or the split can turn this leg red by being legal.
//
// ⛔ AND THE TERMINAL CASE NEEDS NO EXCEPTION, WHICH IS THE PART THE FIRST CUT ALSO MISSED. On run #3 the
// last two parents are `2022-03-27..2022-04-25` (30d) then `2022-03-04..2022-03-26` (23d). The anchor moved
// 04-25 → 03-26 = 30 = the PREVIOUS window's width; it is the NEW window's START that `deriveWindow` clamps
// to the stop (`windowStart = raw < stopDate ? stopDate : raw`). LORAMER_TERMINAL_PARENT_CLAMPS_TO_INCEPTION_V1
// is still true about the WINDOW and simply is not a special case for the ANCHOR.
//
// THE FOUR LEGAL TRANSITIONS, each named so a red says which one it failed to be:
//   · HOLD          — `end(n) == end(n−1)`. The anchor did not move: the window still owed, or a mis-size
//                     UPPER half was published (it shares the parent's end), or the same anchor was re-sized.
//   · RECEDE        — `end(n) == start(n−1) − 1`. The anchor moved by exactly the asked window's width.
//   · SPLIT-LOWER   — `start(n) == start(n−1) && end(n) < end(n−1)`. `planMisSizedSplit`'s lower half sits
//                     inside its parent and shares its start; the anchor has not receded past anything.
//   · ILLEGAL       — everything else, sub-classified: a 1-day move is the ★ANCHOR-RECEDES-BY-RANGE-NOT-WINDOW
//                     class; `end(n) < start(n−1) − 1` names the SKIPPED DAYS explicitly; `end(n) > end(n−1)`
//                     is an anchor that ROSE, which nothing in the repo can do (★TOP-EDGE-HAS-NO-LANE).
//
// ⚠ LIMITS, so the green is not over-read: the series is keyed on each parent's FIRST sighting, so a parent
// re-asked much later reads at its original position; it says nothing about whether the ground INSIDE a
// window was covered (that is `no-owed-day-left-behind`'s subject); and a SPLIT-LOWER is accepted on shape
// alone — this leg does not verify that a mis-size record exists for it.
// ═══════════════════════════════════════════════════════════════════════════════════════════════════════

/**
 * THE PURE DECISION, so the self-test below can drive it with no clock, no DB and no size constant.
 * `prev`/`cur` are `{ start, end }` ISO dates — one parent window each, in ledger order.
 */
export function classifyStep(prev, cur) {
  if (cur.end === prev.end) return { verdict: 'hold', move: 0 }
  if (cur.end > prev.end) return { verdict: 'ILLEGAL', move: days(prev.end, cur.end), why: 'anchor-rose' }
  if (cur.end === shift(prev.start, -1)) return { verdict: 'recede', move: days(prev.end, cur.end) }
  if (cur.start === prev.start && cur.end < prev.end) return { verdict: 'split-lower', move: days(prev.end, cur.end) }
  const move = days(prev.end, cur.end)
  if (move === 1) return { verdict: 'ILLEGAL', move, why: 'range-step' }
  if (cur.end < shift(prev.start, -1)) return { verdict: 'ILLEGAL', move, why: 'skipped-days', skipped: days(shift(prev.start, -1), cur.end) }
  return { verdict: 'ILLEGAL', move, why: 'unexplained' }
}

// ── THE UNIT LEGS (A)/(B)/(B2) — NO DB, NO CLOCK ───────────────────────────────────────────────────────
let step = null, aReceded = null, bReceded = null, cReceded = null
try {
  const r = spawnSync(join(ROOT, 'node_modules', '.bin', 'tsc'), [
    resolve(ROOT, 'src/lib/backfill/universe-resumer.ts'),
    '--target', 'es2020', '--module', 'commonjs', '--moduleResolution', 'node',
    '--skipLibCheck', '--noResolve', '--rootDir', resolve(ROOT), '--outDir', out,
  ], { encoding: 'utf8' })
  if (r.error) throw new Error(`tsc did not run: ${r.error.message}`)
  const R = createRequire(import.meta.url)(join(out, 'src/lib/backfill/universe-resumer.js'))
  if (typeof R.deriveAnchorEnd !== 'function') throw new Error('deriveAnchorEnd is not exported — the subject moved.')

  // ── (A) A KNOWN, FULLY-ANSWERED 30-DAY WINDOW MUST RECEDE BY 30 DAYS ─────────────────────────────────
  // The bounds are the drive's own recorded pass 1: published window 2026-02-03..2026-03-04, every owed day
  // answered. Before 082 the rotation handed this call `2026-03-04..2026-03-04` — the last range written —
  // and the step was ONE day. It now hands the PARENT.
  const a = R.deriveAnchorEnd({
    newestGround: '2026-08-17',
    lastWindowStart: '2026-02-03', lastWindowEnd: '2026-03-04',
    lastWindowFullyAnswered: true,
    lastWindowKnown: true,
  })
  step = days('2026-03-04', a.anchorEnd)
  aReceded = a.receded
  if (!a.receded) {
    findings.push(`(A) a KNOWN, fully-answered window 2026-02-03..2026-03-04 did NOT recede at all (basis: "${a.basis}"). A window that owes nothing must be walked past, or the surface is wedged on covered ground.`)
  } else if (step < MIN_STEP_DAYS) {
    findings.push(
      `(A) a KNOWN, FULLY-ANSWERED 30-day window (2026-02-03..2026-03-04) receded the anchor by ${step} day(s), to ${a.anchorEnd}. ` +
      `The function's own basis reads "${a.basis}". At ${step} day(s) per pass a single surface needs ~${Math.ceil(DAYS_TO_FLOOR / step)} passes and ~${Math.ceil(DAYS_TO_FLOOR / step) * 2} vendor requests to reach inception, ` +
      `and the catalogue holds 346 surfaces. ⛔ THE WALK CANNOT REACH INCEPTION AS BUILT.`)
  }

  // ── (B) AN UNKNOWN WINDOW MUST NOT RECEDE ─────────────────────────────────────────────────────────────
  // Identical bounds, identical fully-answered flag — ONLY `lastWindowKnown` differs. A pre-082 row's bounds
  // are a RANGE wearing a window's name, and no amount of "fully answered" makes them vouchable.
  const b = R.deriveAnchorEnd({
    newestGround: '2026-08-17',
    lastWindowStart: '2026-02-03', lastWindowEnd: '2026-03-04',
    lastWindowFullyAnswered: true,
    lastWindowKnown: false,
  })
  bReceded = b.receded
  if (b.receded) {
    findings.push(
      `(B) an UNKNOWN window (parent_known=false) RECEDED the anchor to ${b.anchorEnd} (basis: "${b.basis}"). ` +
      `⛔ A pre-082 row's bounds are the last RANGE walked, not the window asked, and the window is recoverable from no stored fact. ` +
      `Receding on them skips every owed day of the true window that sits above ${b.anchorEnd} — permanently and silently.`)
  }

  // ── (B2) THE DEFAULT MUST BE SAFE ─────────────────────────────────────────────────────────────────────
  // A caller that forgets `lastWindowKnown` must get the SAFE answer, not the fast one. This is the leg that
  // catches a third caller being added later and quietly inheriting a recession it never asked for.
  const c = R.deriveAnchorEnd({
    newestGround: '2026-08-17',
    lastWindowStart: '2026-02-03', lastWindowEnd: '2026-03-04',
    lastWindowFullyAnswered: true,
  })
  cReceded = c.receded
  if (c.receded) {
    findings.push(`(B2) omitting lastWindowKnown RECEDED the anchor to ${c.anchorEnd}. The default must be UNKNOWN-and-hold: a new caller must not inherit a recession by forgetting a field.`)
  }
} catch (e) {
  rmSync(out, { recursive: true, force: true })
  console.error(`[anchor-recedes-by-window] CANNOT RUN — ${e.message}. A guard that cannot drive its subject FAILS rather than passing.`)
  process.exitCode = 2
  process.exit()
}
rmSync(out, { recursive: true, force: true })

// ── (C0) THE SELF-TEST — GUARD-ON-GUARD, ALWAYS, BEFORE ANY DB READ ────────────────────────────────────
// ⛔ A DETECTOR THAT CANNOT SEE THE DEFECT READS EXACTLY LIKE A CLEAN BILL OF HEALTH
// (LORAMER_NO_OWED_DAY_LEFT_BEHIND_V1's own rule, applied here). The fixtures that matter are the ONE-DAY
// step and the SKIPPED GAP; if the classifier ever admits either, this exits 2 BROKEN rather than 0 or 1.
// ⛔ AND THE FOUR LEGAL SHAPES ARE FIXTURES TOO, TAKEN FROM REAL LEDGER ROWS — the false red this leg shipped
// with came from a classifier that had never been shown a legal mis-size half.
{
  const cases = [
    { name: 'a full 30-day recede (run #3, 2023-06/07)', prev: { start: '2023-06-20', end: '2023-07-19' }, cur: { start: '2023-05-21', end: '2023-06-19' }, want: 'recede' },
    { name: "run #3's terminal window, clamped to inception", prev: { start: '2022-03-27', end: '2022-04-25' }, cur: { start: '2022-03-04', end: '2022-03-26' }, want: 'recede' },
    { name: 'a 15-day recede (a legal smaller size)', prev: { start: '2026-06-14', end: '2026-06-28' }, cur: { start: '2026-05-30', end: '2026-06-13' }, want: 'recede' },
    { name: 'a hold — same anchor, wider window (mis-size upper half)', prev: { start: '2026-05-30', end: '2026-06-13' }, cur: { start: '2026-05-15', end: '2026-06-13' }, want: 'hold' },
    { name: 'a mis-size LOWER half inside its parent', prev: { start: '2026-05-15', end: '2026-06-13' }, cur: { start: '2026-05-15', end: '2026-05-29' }, want: 'split-lower' },
    { name: 'THE RANGE-STEP DEFECT (1 day)', prev: { start: '2024-01-16', end: '2024-02-14' }, cur: { start: '2023-12-15', end: '2024-02-13' }, want: 'ILLEGAL' },
    { name: 'SKIPPED DAYS (a 5-day hole below the window)', prev: { start: '2024-01-16', end: '2024-02-14' }, cur: { start: '2023-12-12', end: '2024-01-10' }, want: 'ILLEGAL' },
    { name: 'an anchor that ROSE', prev: { start: '2024-01-16', end: '2024-02-14' }, cur: { start: '2024-01-20', end: '2024-02-18' }, want: 'ILLEGAL' },
  ]
  const bad = cases.filter((c) => classifyStep(c.prev, c.cur).verdict !== c.want)
  if (bad.length) {
    console.error(`[anchor-recedes-by-window] CANNOT RUN — the leg-(C) classifier failed its own self-test on ${bad.length} fixture(s): ` +
      bad.map((c) => `${c.name} → ${classifyStep(c.prev, c.cur).verdict}, expected ${c.want}`).join(' · ') +
      `. ⛔ A BROKEN INSTRUMENT, NOT A PASS — a classifier that admits a 1-day step or a skipped gap cannot report the defect this guard exists for, and one that rejects a legal smaller size ships a FALSE RED, which this leg already did once.`)
    process.exitCode = 2
    process.exit()
  }
  const skipped = classifyStep({ start: '2024-01-16', end: '2024-02-14' }, { start: '2023-12-12', end: '2024-01-10' })
  console.log(`[anchor-recedes-by-window] self-test PASS — 8/8 fixtures: recede (30d · terminal-clamped · 15d), hold, split-lower all LEGAL; 1-day step, ${skipped.skipped}-day skip and a risen anchor all ILLEGAL. ⛔ NO SIZE CONSTANT IS USED — the legality rule is anchor(n) == start(n−1) − 1.`)
}

// ── (C) THE LIVE LEDGER ────────────────────────────────────────────────────────────────────────────────
async function legC() {
  try {
    for (const l of readFileSync(resolve(ROOT, '.env.local'), 'utf8').split('\n')) {
      const t = l.trim()
      if (!t || t.startsWith('#')) continue
      const i = t.indexOf('=')
      if (i > 0) { const k = t.slice(0, i); if (!process.env[k]) process.env[k] = t.slice(i + 1).replace(/^["']|["']$/g, '') }
    }
  } catch { /* no .env.local — rely on ambient env */ }
  const SB = process.env.NEXT_PUBLIC_SUPABASE_URL, K = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!SB || !K) {
    console.error(`[anchor-recedes-by-window] CANNOT RUN — leg (C) needs Supabase env (NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY). A broken instrument is not a pass.`)
    process.exitCode = 2
    return
  }
  const get = async (p) => {
    const r = await fetch(`${SB}/rest/v1/${p}`, { headers: { apikey: K, Authorization: `Bearer ${K}` } })
    const body = await r.json().catch(() => null)
    if (r.status !== 200 || !Array.isArray(body)) throw new Error(`read failed (HTTP ${r.status}) on ${p.slice(0, 80)}: ${JSON.stringify(body).slice(0, 200)}`)
    return body
  }
  // ⛔ PAGED, BECAUSE PostgREST CAPS AT 1,000 ROWS AND A TRUNCATED LEDGER IS A GUARD THAT MISSES STEPS IT
  // WAS BUILT TO FIND. Same cap that blinded the rate governor once (universe-coverage.ts's own header).
  const pageAll = async (base) => {
    const rows = []
    for (let offset = 0; ; offset += 1000) {
      const page = await get(`${base}&limit=1000&offset=${offset}`)
      rows.push(...page)
      if (page.length < 1000) return rows
    }
  }

  let starts, inceptions, walls
  try {
    starts = await pageAll('universe_attempt_log?select=client_id,vendor,resource,segment,parent_window_start,parent_window_end,recorded_at' +
      '&phase=eq.attempt_started&parent_window_start=not.is.null&order=recorded_at.asc')
    inceptions = await get('universe_account_inception?select=client_id,vendor,inception_date')
    walls = await get('universe_account_floor?select=client_id,vendor,resource,segment,wall_date')
  } catch (e) {
    console.error(`[anchor-recedes-by-window] CANNOT RUN — ${e.message}. ⛔ AN ANCHOR VERDICT MUST NOT BE SYNTHESISED FROM A FAILED READ.`)
    process.exitCode = 2
    return
  }

  // The resolved stop, composed as resolveWalkStop composes it — inception RAISED by any wall for THIS
  // surface. Reported only; it is NOT part of the legality rule any more.
  const inc = new Map(inceptions.map((r) => [`${r.client_id}|${r.vendor}`, String(r.inception_date)]))
  const wall = new Map(walls.map((r) => [`${r.client_id}|${r.vendor}|${r.resource}|${r.segment ?? ''}`, String(r.wall_date)]))
  const stopFor = (k) => {
    const i = inc.get(`${k.client_id}|${k.vendor}`) ?? null
    const w = wall.get(`${k.client_id}|${k.vendor}|${k.resource}|${k.segment ?? ''}`) ?? null
    if (i === null) return w
    if (w === null) return i
    return w > i ? w : i
  }

  const bySurface = new Map()
  for (const r of starts) {
    if (r.resource === '__account_inception') continue
    const sk = `${r.client_id}|${r.vendor}|${r.resource}|${r.segment ?? ''}`
    if (!bySurface.has(sk)) bySurface.set(sk, { key: r, seen: new Set(), series: [] })
    const s = bySurface.get(sk)
    const pk = `${r.parent_window_start}|${r.parent_window_end}`
    if (s.seen.has(pk)) continue
    s.seen.add(pk)
    s.series.push({ start: String(r.parent_window_start), end: String(r.parent_window_end) })
  }

  // ⛔ THE RED PROOFS, AS FLAGS RATHER THAN HIDDEN SWITCHES, AND EACH ANNOUNCES ITSELF — a red proof that
  // does not say it is one is indistinguishable from a real red.
  if (INJECT_ONE_DAY || INJECT_GAP) {
    let longest = null
    for (const s of bySurface.values()) if (!longest || s.series.length > longest.series.length) longest = s
    if (longest && longest.series.length) {
      const last = longest.series[longest.series.length - 1]
      const label = `${longest.key.resource}/${longest.key.segment || '(base)'}`
      if (INJECT_ONE_DAY) {
        const e = shift(last.end, -1)
        longest.series.push({ start: shift(e, -29), end: e })
        console.log(`[anchor-recedes-by-window] ⚠ INJECT MODE — appended a ONE-DAY anchor move (anchor ${last.end} → ${e}) to ${label}. This run MUST go red on it; that is the proof.`)
      }
      if (INJECT_GAP) {
        const e = shift(last.start, -6)   // 5 days below the contiguous position → 5 skipped days
        longest.series.push({ start: shift(e, -29), end: e })
        console.log(`[anchor-recedes-by-window] ⚠ INJECT MODE — appended a step that SKIPS 5 days (contiguous position was ${shift(last.start, -1)}, injected anchor ${e}) to ${label}. This run MUST go red on it; that is the proof.`)
      }
    }
  }

  const tally = { hold: 0, recede: 0, 'split-lower': 0 }
  const illegal = []
  for (const s of bySurface.values()) {
    for (let i = 1; i < s.series.length; i++) {
      const prev = s.series[i - 1], cur = s.series[i]
      const v = classifyStep(prev, cur)
      if (v.verdict === 'ILLEGAL') illegal.push({ s: s.key, prev, cur, v })
      else tally[v.verdict]++
    }
  }

  console.log(`[anchor-recedes-by-window] (C) ledger: ${bySurface.size} surface(s) with parent-stamped windows · ` +
    `${tally.recede} recede(s) by the asked window · ${tally.hold} hold(s) · ${tally['split-lower']} mis-size lower half/halves · ${illegal.length} ILLEGAL.`)
  for (const t of bySurface.values()) {
    const stop = stopFor(t.key)
    const last = t.series[t.series.length - 1]
    if (stop && last && last.start === stop) {
      const prev = t.series[t.series.length - 2]
      console.log(`[anchor-recedes-by-window] (C) ARRIVED — ${t.key.resource}/${t.key.segment || '(base)'} terminal window ${last.start}..${last.end} (${days(last.end, last.start) + 1}d, clamped to the stop ${stop})` +
        (prev ? ` · the anchor still moved ${days(prev.end, last.end)}d = the PREVIOUS window's width ${days(prev.end, prev.start) + 1}d` : '') + '.')
    }
  }

  for (const f of illegal) {
    const label = `${f.s.resource}/${f.s.segment || '(base)'}`
    const base = `(C) ILLEGAL ANCHOR MOVE of ${f.v.move} day(s) on ${label} — window ${f.prev.start}..${f.prev.end} (${days(f.prev.end, f.prev.start) + 1}d) then ${f.cur.start}..${f.cur.end}. ` +
      `The anchor must land on ${shift(f.prev.start, -1)} (the day below the asked window), HOLD at ${f.prev.end}, or be a mis-size lower half sharing the start. It did none of those.`
    findings.push(
      f.v.why === 'range-step'
        ? `${base} ⛔ A ONE-DAY MOVE IS THE ★ANCHOR-RECEDES-BY-RANGE-NOT-WINDOW CLASS — the anchor is moving by the last RANGE written, not the window asked, and at this rate inception is ~${DAYS_TO_FLOOR} passes away.`
        : f.v.why === 'skipped-days'
        ? `${base} ⛔ ${f.v.skipped} DAY(S) SKIPPED — ${shift(f.cur.end, 1)}..${shift(f.prev.start, -1)} were never asked and nothing behind the walk will ever come back for them.`
        : f.v.why === 'anchor-rose'
        ? `${base} ⛔ THE ANCHOR ROSE. Nothing in the repo can raise an anchor (★TOP-EDGE-HAS-NO-LANE); a row that shows one means the rotation returned bounds from another producer.`
        : `${base} ⛔ UNEXPLAINED — it overlaps the asked window without sharing its start, so it is neither a recede, a hold, nor a split.`)
  }
}

await legC()

console.log(`[anchor-recedes-by-window] measured: KNOWN fully-answered 30-day window → ${step} day(s) gained (receded=${aReceded}) · UNKNOWN same bounds → receded=${bReceded} · default → receded=${cReceded}.`)

if (findings.length) {
  console.error(`[anchor-recedes-by-window] FAIL — ${findings.length} finding(s):`)
  for (const f of findings) console.error(`  ✗ ${f}`)
  console.error(`  ⇒ SPEC: docs/LORAMER_WALK_REBUILD_ARCHITECTURE.md § PROGRESS-TRUTH. ⛔ Record the WINDOW **and** evaluate fullyAnswered over that window — either half alone is worse than today.`)
  console.error(`  ⇒ LEG (C) SPEC: DECISIONS LORAMER_TERMINAL_PARENT_CLAMPS_TO_INCEPTION_V1. The anchor moves by the width of the window ASKED, or holds, or is a mis-size lower half. No size constant is involved.`)
  process.exitCode = 1
} else {
  console.log(`[anchor-recedes-by-window] PASS — a KNOWN fully-answered window recedes by at least ${MIN_STEP_DAYS} days; an UNKNOWN one does not recede at all; the default is UNKNOWN; and every anchor move the ledger recorded is the width of the window that was asked, a hold, or a mis-size lower half — with no day skipped between consecutive windows.`)
}
