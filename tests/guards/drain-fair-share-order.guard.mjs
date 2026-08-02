#!/usr/bin/env node
// LORAMER_DRAIN_FAIR_SHARE_STEP_ORDER_V1 — guard the drain's step ORDER, its dependency boundary, and its
// budget reservation.
//
// THE DEFECT: `for (const step of DRAIN_REGISTRY)` iterated a literal array, identically on every fire forever,
// so a SLOW step starved everything behind it and the starved step could never lead. Foam OH's google_user_geo
// sat 35 days behind google_geo, dispatched into the remainder of the fire and killed at maxDuration with no
// cursor, no log line and no cron_runs stamp — indistinguishable from never having run.
//
// THREE LEGS, and leg (2) is the one that must be seen RED:
//   (1) STRUCTURAL — every step declares a tier; tier is non-decreasing across array index; and EXACTLY ONE
//       tier holds more than one step. Widening the change means editing this guard, deliberately.
//   (2) BEHAVIOURAL — the REAL compiled orderStepsFairShare, driven with two same-tier steps whose cursors are
//       30 days apart. The STALE one must lead. Reverting to array order must make this fail.
//   (3) SOURCE PIN — shouldStartAnotherLap is the dispatch gate inside the step loop, and the bare
//       `Date.now() - started > BUDGET_MS` is no longer what decides whether a lap starts.
//
// ⚠ WHAT THIS DELIBERATELY DOES NOT ASSERT, so a green run is never over-read: it does NOT assert that a
// starved lap will COMPLETE once it leads. It cannot — that depends on the cold-read cost of the slice, which
// is a physical-I/O question this ordering does not touch (see LORAMER_COMPUTE_BASELINE_2026_08_02_V1). What it
// asserts is that the starved step gets DISPATCHED FIRST and is never dispatched into a window too small to
// hold it. Whether it finishes is the first live fire's answer, not this guard's.
import { spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync, existsSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { createRequire } from 'node:module'

const ROOT = process.env.LORAMER_GUARD_ROOT || process.cwd()
const findings = []
const fail = (m) => { console.error(`[drain-fair-share-order] FAIL — ${m}`); process.exit(1) }

const ORDER_SRC = 'src/lib/backfill/drain-step-order.ts'
const REG_SRC = 'src/lib/backfill/drain-registry.ts'
const ROUTE_SRC = 'src/app/api/cron/drain/route.ts'
for (const f of [ORDER_SRC, REG_SRC, ROUTE_SRC]) {
  if (!existsSync(resolve(ROOT, f))) fail(`${f} is missing.`)
}
const regText = readFileSync(resolve(ROOT, REG_SRC), 'utf8')
const routeText = readFileSync(resolve(ROOT, ROUTE_SRC), 'utf8')
// Comments are stripped before any source matching. QUOTATION IS NOT ASSERTION — this file and the sources it
// reads both QUOTE the defective expression in order to teach why it is gone, and a guard that fails on its own
// documentation gets deleted. Banked three times now (canonical-client-identity, ga-dim-completion-honesty,
// wire-coverage-instrument); stripping first is the fix that survived.
const stripComments = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').split('\n').filter((l) => !l.trim().startsWith('//')).join('\n')
const routeCode = stripComments(routeText)

// ── LEG 1 · STRUCTURAL ────────────────────────────────────────────────────────────────────────────────────────
// Parsed from source text rather than by importing the registry: the registry pulls the entire backfill writer
// tree at module scope, and the tier declaration is a literal we can read directly and unambiguously.
const stepRe = /^\s{4}key: '([a-z0-9_]+)',\s*$/gm
const keys = [...regText.matchAll(stepRe)].map((m) => m[1])
const tierRe = /^\s{4}tier: (\d+),\s*$/gm
const tiers = [...regText.matchAll(tierRe)].map((m) => Number(m[1]))
if (keys.length === 0) findings.push(`${REG_SRC}: no step keys parsed — the registry shape changed and this guard is now blind. Fix the guard before trusting a green.`)
if (keys.length !== tiers.length) {
  findings.push(`${REG_SRC}: ${keys.length} step(s) declare a key but only ${tiers.length} declare a tier. EVERY DrainStep must declare one — an undeclared tier has no dependency boundary, so fair-share could reorder it against a step that is its anchor.`)
} else {
  for (let i = 1; i < tiers.length; i++) {
    if (tiers[i] < tiers[i - 1]) {
      findings.push(`${REG_SRC}: tier goes BACKWARDS at '${keys[i]}' (tier ${tiers[i]} after '${keys[i - 1]}' tier ${tiers[i - 1]}). Tier must be non-decreasing across array index, or a tier silently contradicts the historical order the prose dependencies were written against.`)
    }
  }
  const counts = new Map()
  for (let i = 0; i < keys.length; i++) counts.set(tiers[i], [...(counts.get(tiers[i]) ?? []), keys[i]])
  const shared = [...counts.entries()].filter(([, ks]) => ks.length > 1)
  if (shared.length !== 1) {
    findings.push(`${REG_SRC}: expected EXACTLY ONE shared tier, found ${shared.length} (${shared.map(([t, ks]) => `tier ${t}: ${ks.join('+')}`).join(' | ') || 'none'}). Day one shares exactly one pair; widening it is a deliberate act that must edit this guard, never a side effect of an unrelated flight.`)
  } else {
    const [, members] = shared[0]
    const want = ['google_geo', 'google_user_geo']
    if (members.length !== 2 || !want.every((k) => members.includes(k))) {
      findings.push(`${REG_SRC}: the shared tier holds [${members.join(', ')}], expected exactly [${want.join(', ')}]. Those two are safe to share because both are stateless-range, WRITE-ONLY, no reconcile, separate cursors and separate vendor views — neither is the other's anchor. Another pair has not been shown to be.`)
    }
  }
}

// ── LEG 2 · BEHAVIOURAL — the real compiled function ──────────────────────────────────────────────────────────
const out = mkdtempSync(join(tmpdir(), 'loramer-fairshare-guard-'))
const tsc = join(ROOT, 'node_modules', '.bin', 'tsc')
const r = spawnSync(tsc, [resolve(ROOT, ORDER_SRC), '--target', 'es2020', '--module', 'commonjs',
  '--moduleResolution', 'node', '--skipLibCheck', '--noResolve', '--rootDir', resolve(ROOT), '--outDir', out],
  { encoding: 'utf8' })
if (r.error) { rmSync(out, { recursive: true, force: true }); fail(`could not run tsc — ${r.error.message}`) }
const req = createRequire(import.meta.url)
let mod
try { mod = req(join(out, 'src/lib/backfill/drain-step-order.js')) }
catch (e) { rmSync(out, { recursive: true, force: true }); fail(`compiled module did not load — ${e.message}\n${r.stdout || ''}${r.stderr || ''}`) }
rmSync(out, { recursive: true, force: true })

if (typeof mod.orderStepsFairShare !== 'function') {
  findings.push(`${ORDER_SRC} does not export orderStepsFairShare — the ordering is inlined again, which is exactly why it went untested while it starved a step for 35 days.`)
} else {
  const order = mod.orderStepsFairShare
  const FRESH = '2026-08-02T12:34:33.000Z'
  const STALE = '2026-06-28T06:04:11.000Z' // ~35 days older — Foam OH's real google_user_geo stamp
  const CASES = [
    { name: 'SAME TIER, cursors 30+ days apart -> the STALE step leads',
      input: [
        { key: 'google_geo', tier: 5, lastSucceededAt: FRESH },
        { key: 'google_user_geo', tier: 5, lastSucceededAt: STALE },
      ],
      want: ['google_user_geo', 'google_geo'],
      why: 'THE DEFECT CASE, with Foam OH\'s real stamps. Array order puts geo first forever; fair-share must hand the turn to the starved one.' },
    { name: 'SAME TIER, null (never succeeded) leads a dated sibling',
      input: [
        { key: 'google_geo', tier: 5, lastSucceededAt: FRESH },
        { key: 'google_user_geo', tier: 5, lastSucceededAt: null },
      ],
      want: ['google_user_geo', 'google_geo'],
      why: 'Never-succeeded is the most starved state there is. NULLS FIRST, or a step with no cursor row could never lead.' },
    { name: 'DIFFERENT TIERS -> tier wins even when the later tier is far staler',
      input: [
        { key: 'google_campaign', tier: 2, lastSucceededAt: FRESH },
        { key: 'google_geo', tier: 5, lastSucceededAt: STALE },
      ],
      want: ['google_campaign', 'google_geo'],
      why: 'THE DEPENDENCY MUST WIN. geo is "after google_campaign for grouping". If staleness could cross a tier, fair-share would run a step before its anchor and the failure would read as a data gap.' },
    { name: 'IDENTICAL stamps -> original array position, stable',
      input: [
        { key: 'google_geo', tier: 5, lastSucceededAt: FRESH },
        { key: 'google_user_geo', tier: 5, lastSucceededAt: FRESH },
      ],
      want: ['google_geo', 'google_user_geo'],
      why: 'Equal inputs must never reorder — same data, same answer, every run. The determinism law applied to a scheduler.' },
    { name: 'self-correcting: once the starved step lands, its sibling leads next',
      input: [
        { key: 'google_geo', tier: 5, lastSucceededAt: STALE },
        { key: 'google_user_geo', tier: 5, lastSucceededAt: FRESH },
      ],
      want: ['google_geo', 'google_user_geo'],
      why: 'The inverse of case 1. If this did not flip back, fair-share would just move the starvation onto the other step.' },
  ]
  for (const c of CASES) {
    let got
    try { got = order(c.input).map((s) => s.key) } catch (e) { got = [`THREW: ${e.message}`] }
    if (got.join(',') !== c.want.join(',')) {
      findings.push(`ORDERING: ${c.name}\n      expected [${c.want.join(', ')}] got [${got.join(', ')}]\n      WHY IT MATTERS: ${c.why}`)
    }
  }
}

// ── LEG 3 · SOURCE PIN ────────────────────────────────────────────────────────────────────────────────────────
if (!/orderStepsFairShare\s*\(/.test(routeCode)) {
  findings.push(`${ROUTE_SRC}: does not CALL orderStepsFairShare. Exporting an ordering nothing calls is a comment — the loop is back on raw array position.`)
}
if (!/shouldStartAnotherLap\s*\(/.test(routeCode)) {
  findings.push(`${ROUTE_SRC}: does not CALL shouldStartAnotherLap. Without a reservation, a lap dispatched just under the budget line runs past maxDuration and is KILLED with no cursor and no log line — the silent failure this change exists to end.`)
}
// The bare comparison may still legitimately gate the POOL (runPool's stop predicate). What it may never do
// again is decide whether a LAP starts. Scope the check to the step-loop block.
const loopStart = routeCode.indexOf('for (const step of orderedSteps)')
if (loopStart === -1) {
  findings.push(`${ROUTE_SRC}: the step loop no longer iterates 'orderedSteps' — either it was reverted to DRAIN_REGISTRY, or renamed without updating this guard. Either way the ordering is unproven.`)
} else {
  const loopBody = routeCode.slice(loopStart, loopStart + 1200)
  if (/if\s*\(\s*Date\.now\(\)\s*-\s*started\s*>\s*BUDGET_MS\s*\)\s*break/.test(loopBody)) {
    findings.push(`${ROUTE_SRC}: the bare 'Date.now() - started > BUDGET_MS' is STILL the dispatch gate inside the step loop. That check reserves NOTHING for the lap it is about to begin, which is the overrun LORAMER_META_ASSET_BUDGET_HEADROOM_V1 already fixed one level down.`)
  }
  if (!/shouldStartAnotherLap/.test(loopBody)) {
    findings.push(`${ROUTE_SRC}: shouldStartAnotherLap is imported/called somewhere but NOT inside the step loop. The reservation has to be at the dispatch site or it guards nothing.`)
  }
}

if (findings.length) {
  console.error(`[drain-fair-share-order] FAIL — ${findings.length} finding(s):`)
  for (const f of findings) console.error(`  - ${f}`)
  process.exit(1)
}
console.log('[drain-fair-share-order] PASS — tiers declared + non-decreasing + exactly one shared pair; the real orderStepsFairShare hands the turn to the starved step and never crosses a tier; the route calls it and reserves budget at the dispatch site.')
