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
//   (C) EVERY RECEDE THE LEDGER ACTUALLY RECORDED IS EITHER A FULL WINDOW OR THE EXACT REMAINDER TO THE
//       RESOLVED STOP. Nothing else. Added 2026-08-19; see the block above leg (C).
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
// `no-owed-day-left-behind.guard.mjs` (the warehouse property), `mis-size-must-re-owe.guard.mjs` and NOW
// LEG (C) are for. A green on (A) means the STEP SIZE is right in the function. It does not mean the LEDGER
// only ever recorded right-sized steps — that is a different question and it needed a different leg.
//
// USAGE: node tests/guards/anchor-recedes-by-window.guard.mjs
//        node tests/guards/anchor-recedes-by-window.guard.mjs --inject-illegal-recede   ← the RED PROOF
import { mkdtempSync, rmSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'

const ROOT = process.env.LORAMER_GUARD_ROOT || process.cwd()
const MIN_STEP_DAYS = 30            // sizing maxDays; a fully-answered window must yield its own width
const DAYS_TO_FLOOR = 1427          // 2026-01-30 → 2022-03-04, measured 2026-08-17
const INJECT = process.argv.includes('--inject-illegal-recede')
const out = mkdtempSync(join(tmpdir(), 'loramer-anchor-'))
const days = (a, b) => Math.round((new Date(a + 'T00:00:00Z') - new Date(b + 'T00:00:00Z')) / 86400000)
const findings = []

// ═══════════════════════════════════════════════════════════════════════════════════════════════════════
// LEG (C) — LORAMER_TERMINAL_PARENT_CLAMPS_TO_INCEPTION_V1
//
// ⛔ THE PROPERTY, AND IT IS ABOUT THE LEDGER RATHER THAN THE FUNCTION: **a walk descends by exactly one
// window per step, EXCEPT the last, which descends by exactly the remainder to the resolved stop.** Anything
// else is a step nobody sized — and the one that already cost this project a rebuild is a step of ONE DAY.
//
// ⛔ WHY 30-OR-REMAINDER AND NOT "≥30". `deriveWindow` clamps the terminal window's START to the resolved
// stop (`windowStart = raw < stopDate ? stopDate : raw`), so the FINAL parent is legitimately narrower than
// the sizing — 11 days on run #1, 20 on run #2, 23 on run #3. A leg that demanded 30 everywhere would have
// gone red on all three arrivals, i.e. red on the only three successes the engine has. A leg that accepted
// "anything ≤ 30" would accept the 1-day range step this guard was BUILT to kill. The remainder is legal
// EXACTLY when the new parent starts AT the stop; anywhere else a short step is unexplained.
//
// ⛔ MEASURED ON THE LIVE LEDGER 2026-08-19, and the numbers are why this leg is worth its DB read:
//   · 1,625 recedes of exactly 30 across 344 surfaces
//   · 3 terminal remainders, one per gate run, every one landing on inception 2022-03-04 —
//     campaign_search_term_view/segments.device 11 · geo_target_most_specific_location 20 ·
//     geo_target_airport 23 (2022-03-27 − 2022-03-04 = 23)
//   · 5 ILLEGAL steps of 15 days, on the TWO content_suitability_placement_view surfaces — and they are not
//     a new finding: they are ★ANCHOR-HOLD-BRANCH-IS-UNGATED reproduced from data the guard was never told
//     about. Every attempt on those surfaces finishes `outcome='error'` (GAQL query_error 49), so the window
//     is never fully answered and the anchor goes out through the HOLD branch, which is a MOVER.
//
// ⛔ STRICTLY-DESCENDING STEPS ONLY, AND THAT SCOPE IS DELIBERATE. A step of 0 is a HOLD (the parent came
// back partially answered — the design, asserted by leg B and by `universe-horizon-recedes`), and a NEGATIVE
// step is the mis-sized upper half being re-owned (LORAMER_MISSIZE_REOWES_THE_UPPER_HALF_V1, asserted by
// `mis-size-must-re-owe.guard.mjs`). Re-asserting either here would double-count another guard's subject and
// go red on behaviour this repo has already decided is correct.
//
// ⚠ LIMITS, so the green is not over-read: the series is keyed on each parent's FIRST sighting, so a parent
// re-asked much later reads at its original position; the resolved stop is read from
// `universe_account_inception` + `universe_account_floor` exactly as `resolveWalkStop` composes it, so a
// surface with NO discovered stop has no terminal case to test and its short steps are simply ILLEGAL — which
// is the safe direction; and it says nothing about whether the ground INSIDE a window was covered.
// ═══════════════════════════════════════════════════════════════════════════════════════════════════════

/**
 * THE PURE DECISION, so the self-test below can drive it with no clock and no DB.
 * `sizingMaxDays` is READ FROM THE ADAPTER, never retyped — a second copy of 30 is exactly the
 * LORAMER_ADJACENT_NUMBER_V1 class.
 */
export function classifyRecede({ recedeDays, newParentStart, stopDate, sizingMaxDays }) {
  if (!(recedeDays > 0)) return 'not-a-descent'
  if (recedeDays === sizingMaxDays) return 'window'
  if (stopDate !== null && newParentStart === stopDate && recedeDays < sizingMaxDays) return 'terminal-remainder'
  return 'ILLEGAL'
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

// ── THE SIZING CONSTANT, READ FROM THE ADAPTER ─────────────────────────────────────────────────────────
// ⛔ NEVER RETYPED. `maxDays` lives in the adapter's SizingPolicy; a second copy here is the
// LORAMER_ADJACENT_NUMBER_V1 class, and this leg's whole verdict turns on it.
const ADAPTER = 'src/lib/backfill/capture-adapters/google-ads.adapter.ts'
let SIZING_MAX = null
try {
  const m = /maxDays:\s*(\d+)/.exec(readFileSync(resolve(ROOT, ADAPTER), 'utf8'))
  if (m) SIZING_MAX = Number(m[1])
} catch { /* reported below */ }

// ── (C0) THE SELF-TEST — GUARD-ON-GUARD, ALWAYS, BEFORE ANY DB READ ────────────────────────────────────
// ⛔ A DETECTOR THAT CANNOT SEE THE DEFECT READS EXACTLY LIKE A CLEAN BILL OF HEALTH
// (LORAMER_NO_OWED_DAY_LEFT_BEHIND_V1's own rule, applied here). The fixture that matters is the ONE-DAY
// step — the defect this whole guard was built for — and if the classifier ever admits it, this exits 2
// BROKEN rather than 0 or 1.
{
  const S = SIZING_MAX ?? 30
  const cases = [
    { name: 'a full window', a: { recedeDays: S, newParentStart: '2024-01-16', stopDate: '2022-03-04', sizingMaxDays: S }, want: 'window' },
    { name: "run #3's terminal remainder", a: { recedeDays: 23, newParentStart: '2022-03-04', stopDate: '2022-03-04', sizingMaxDays: S }, want: 'terminal-remainder' },
    { name: 'THE RANGE-STEP DEFECT (1 day)', a: { recedeDays: 1, newParentStart: '2024-01-16', stopDate: '2022-03-04', sizingMaxDays: S }, want: 'ILLEGAL' },
    { name: 'a short step that is NOT at the stop', a: { recedeDays: 15, newParentStart: '2026-05-30', stopDate: '2022-03-04', sizingMaxDays: S }, want: 'ILLEGAL' },
    { name: 'a short step with NO stop resolved', a: { recedeDays: 23, newParentStart: '2022-03-04', stopDate: null, sizingMaxDays: S }, want: 'ILLEGAL' },
    { name: 'a hold', a: { recedeDays: 0, newParentStart: '2024-01-16', stopDate: '2022-03-04', sizingMaxDays: S }, want: 'not-a-descent' },
  ]
  const bad = cases.filter((c) => classifyRecede(c.a) !== c.want)
  if (bad.length) {
    console.error(`[anchor-recedes-by-window] CANNOT RUN — the leg-(C) classifier failed its own self-test on ${bad.length} fixture(s): ` +
      bad.map((c) => `${c.name} → ${classifyRecede(c.a)}, expected ${c.want}`).join(' · ') +
      `. ⛔ A BROKEN INSTRUMENT, NOT A PASS — a classifier that admits a 1-day step cannot report the defect this guard exists for.`)
    process.exitCode = 2
    process.exit()
  }
  console.log(`[anchor-recedes-by-window] self-test PASS — the classifier rejects a 1-day step, rejects a short step away from the stop, rejects a short step with no stop, and accepts a full window and a terminal remainder. sizingMaxDays=${S} read from ${ADAPTER}.`)
}

// ── (C) THE LIVE LEDGER ────────────────────────────────────────────────────────────────────────────────
async function legC() {
  if (SIZING_MAX === null) {
    console.error(`[anchor-recedes-by-window] CANNOT RUN — could not read \`maxDays\` from ${ADAPTER}. The leg's whole verdict turns on that number and it is not being guessed.`)
    process.exitCode = 2
    return
  }
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
    console.error(`[anchor-recedes-by-window] CANNOT RUN — ${e.message}. ⛔ A RECEDE VERDICT MUST NOT BE SYNTHESISED FROM A FAILED READ.`)
    process.exitCode = 2
    return
  }

  // THE RESOLVED STOP, composed exactly as resolveWalkStop composes it: the account's inception RAISED by any
  // wall discovered for THIS surface. `null` is UNKNOWN and stays UNKNOWN — never defaulted.
  const incKey = (r) => `${r.client_id}|${r.vendor}`
  const inc = new Map(inceptions.map((r) => [incKey(r), String(r.inception_date)]))
  const wall = new Map(walls.map((r) => [`${r.client_id}|${r.vendor}|${r.resource}|${r.segment ?? ''}`, String(r.wall_date)]))
  const stopFor = (k) => {
    const i = inc.get(`${k.client_id}|${k.vendor}`) ?? null
    const w = wall.get(`${k.client_id}|${k.vendor}|${k.resource}|${k.segment ?? ''}`) ?? null
    if (i === null) return w
    if (w === null) return i
    return w > i ? w : i
  }

  // Each parent at its FIRST sighting, per surface, in ledger order.
  const bySurface = new Map()
  for (const r of starts) {
    if (r.resource === '__account_inception') continue
    const sk = `${r.client_id}|${r.vendor}|${r.resource}|${r.segment ?? ''}`
    if (!bySurface.has(sk)) bySurface.set(sk, { key: r, seen: new Set(), series: [] })
    const s = bySurface.get(sk)
    const pk = `${r.parent_window_start}|${r.parent_window_end}`
    if (s.seen.has(pk)) continue
    s.seen.add(pk)
    s.series.push({ ps: String(r.parent_window_start), pe: String(r.parent_window_end), t: r.recorded_at })
  }

  // ⛔ THE RED PROOF, AND IT IS A FLAG RATHER THAN A HIDDEN SWITCH. `--inject-illegal-recede` appends ONE
  // synthetic 1-day step to the LONGEST observed series, so the leg can be SEEN TO FAIL on the shape it
  // exists to catch, on real data, through the shipped code path. It prints what it did — a red proof that
  // does not announce itself is indistinguishable from a real red.
  if (INJECT) {
    let longest = null
    for (const s of bySurface.values()) if (!longest || s.series.length > longest.series.length) longest = s
    if (longest && longest.series.length) {
      const last = longest.series[longest.series.length - 1]
      const injStart = new Date(Date.parse(last.ps + 'T00:00:00Z') - 86400000).toISOString().slice(0, 10)
      longest.series.push({ ps: injStart, pe: last.pe, t: last.t, injected: true })
      console.log(`[anchor-recedes-by-window] ⚠ INJECT MODE — appended a synthetic ONE-DAY step (${last.ps} → ${injStart}) to ${longest.key.resource}/${longest.key.segment || '(base)'}. This run MUST go red on it; that is the proof.`)
    }
  }

  let descents = 0, windowSteps = 0, terminal = 0, holds = 0, reowns = 0
  const illegal = []
  for (const s of bySurface.values()) {
    const stop = stopFor(s.key)
    for (let i = 1; i < s.series.length; i++) {
      const prev = s.series[i - 1], cur = s.series[i]
      const recede = days(prev.ps, cur.ps)
      if (recede === 0) { holds++; continue }
      if (recede < 0) { reowns++; continue }
      descents++
      const verdict = classifyRecede({ recedeDays: recede, newParentStart: cur.ps, stopDate: stop, sizingMaxDays: SIZING_MAX })
      if (verdict === 'window') windowSteps++
      else if (verdict === 'terminal-remainder') terminal++
      else illegal.push({ s: s.key, prev, cur, recede, stop })
    }
  }

  console.log(`[anchor-recedes-by-window] (C) ledger: ${bySurface.size} surface(s) with parent-stamped windows · ${descents} descending step(s) — ` +
    `${windowSteps} full window(${SIZING_MAX}d) · ${terminal} terminal remainder(s) · ${illegal.length} ILLEGAL · (${holds} hold(s) and ${reowns} re-own(s) are other guards' subjects and are not judged here).`)
  for (const t of [...bySurface.values()]) {
    const stop = stopFor(t.key)
    const last = t.series[t.series.length - 1]
    if (stop && last && last.ps === stop) {
      const prev = t.series[t.series.length - 2]
      console.log(`[anchor-recedes-by-window] (C) ARRIVED — ${t.key.resource}/${t.key.segment || '(base)'} terminal parent ${last.ps}..${last.pe}` +
        (prev ? ` · remainder ${days(prev.ps, last.ps)}d (${prev.ps} − ${stop})` : '') + ` · stop ${stop}.`)
    }
  }

  for (const f of illegal) {
    findings.push(
      `(C) ILLEGAL RECEDE of ${f.recede} day(s) on ${f.s.resource}/${f.s.segment || '(base)'} — parent ${f.prev.ps} → ${f.cur.ps} (${f.cur.ps}..${f.cur.pe}), resolved stop ${f.stop ?? 'UNKNOWN'}. ` +
      `A descent must be EXACTLY ${SIZING_MAX} day(s) (a full window) or EXACTLY the remainder to the stop (which requires the new parent to START at ${f.stop ?? 'a stop that has not been discovered'}). ` +
      (f.recede === 1
        ? `⛔ A ONE-DAY STEP IS THE ★ANCHOR-RECEDES-BY-RANGE-NOT-WINDOW CLASS — the anchor is moving by the last RANGE written, not the window asked, and at this rate inception is ~${DAYS_TO_FLOOR} passes away.`
        : `⛔ NOBODY SIZED THIS STEP. A short descent away from the stop is ground the walk skipped or re-derived from bounds it cannot vouch for.`))
  }
}

await legC()

console.log(`[anchor-recedes-by-window] measured: KNOWN fully-answered 30-day window → ${step} day(s) gained (receded=${aReceded}) · UNKNOWN same bounds → receded=${bReceded} · default → receded=${cReceded}.`)

if (findings.length) {
  console.error(`[anchor-recedes-by-window] FAIL — ${findings.length} finding(s):`)
  for (const f of findings) console.error(`  ✗ ${f}`)
  console.error(`  ⇒ SPEC: docs/LORAMER_WALK_REBUILD_ARCHITECTURE.md § PROGRESS-TRUTH. ⛔ Record the WINDOW **and** evaluate fullyAnswered over that window — either half alone is worse than today.`)
  console.error(`  ⇒ LEG (C) SPEC: DECISIONS LORAMER_TERMINAL_PARENT_CLAMPS_TO_INCEPTION_V1. A descending step is ${SIZING_MAX ?? '<maxDays>'} or the exact remainder to the resolved stop, and nothing else.`)
  process.exitCode = 1
} else {
  console.log(`[anchor-recedes-by-window] PASS — a KNOWN fully-answered window recedes by at least ${MIN_STEP_DAYS} days; an UNKNOWN one does not recede at all; the default is UNKNOWN; and every descending step the ledger recorded is a full window or the exact remainder to the resolved stop.`)
}
