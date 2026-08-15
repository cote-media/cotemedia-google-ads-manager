#!/usr/bin/env node
// LORAMER_BINDING_COVERAGE_V1 — A NOT-COMPLETE WINDOW MAY NOT HAND BACK A BARE TOTAL.
//
// ── WHY ─────────────────────────────────────────────────────────────────────────────────────────────────
// ★FALSE-ZERO-ON-UNCOVERED-WINDOW, measured on the 2026-08-14 baseline: 8 FALSE_ZERO + 9 FABRICATED, and the
// diagnosis (LORAMER_FALSE_ZERO_DIAG_V1) falsified the obvious hypothesis. The coverage signal was PRESENT,
// CORRECT and taught at length in the tool description — and three of the failing answers QUOTE it while
// contradicting it (A13 opens "Google `covered` and `complete: true`" then fabricates a state ranking for a
// grain whose floor postdates the window). ★SEMANTIC-LAYER banked the reason in advance: the difference
// between confident-wrong and honest-refusal is ARCHITECTURAL, and "no amount of prompt work closes it".
//
// So the fix is a SHAPE, and this guard exists because a shape can be quietly un-shaped: someone re-adds
// `totals` "for convenience", or restores the account-only early return, or puts back a silent catch — and
// nothing fails, because a bare total looks exactly like a correct answer until a customer acts on it.
//
// ── THE FOUR LEGS ───────────────────────────────────────────────────────────────────────────────────────
//   (i)   BINDING — drives the REAL compiled bindWindow. PARTIAL and UNKNOWN must DELETE `totals` and carry a
//         `withheld` object; COMPLETE must keep `totals`. RED if a not-COMPLETE window hands back a total.
//   (ii)  NO GRAIN GAP — the account-only early return (`if (level && level !== 'account') return result`)
//         must stay gone, and the breakdown-grain resolver must be wired, because a grain can have its own
//         floor inside a window the account covers. That gap IS A13/E7/C14.
//   (iii) FAIL LOUD — no bare `catch { return result }` on the coverage path; an unmeasurable window must be
//         marked UNKNOWN with the existing `read_failed` vocabulary rather than returning an uncaveated total.
//   (iv)  NO OVER-REFUSAL — a COMPLETE window holding zero rows must stay ANSWERABLE and carry
//         `zeroIsReal: true`. Refusing a genuine zero is its own failure and would teach the model to
//         disbelieve every zero, which is the opposite of the honesty this buys.
//
// ── HONEST LIMIT ────────────────────────────────────────────────────────────────────────────────────────
// (i)/(iv) drive the real function; (ii)/(iii) are STATIC SOURCE READS. Nothing here proves the MODEL obeys
// the shape — that is the eval, deferred under LORAMER_EVAL_PAYWALL_MOVED_TO_END_OF_WIRING_V1 — and nothing
// here proves a live window resolves correctly; that is scripts/check-binding-coverage.mjs in check:data.
//
// USAGE: node tests/guards/binding-coverage.guard.mjs
//        [--inject-bare-total] [--inject-grain-gap] [--inject-silent-catch] [--inject-over-refuse]
import { readFileSync, mkdtempSync } from 'node:fs'
import path from 'node:path'
import { tmpdir } from 'node:os'
import { spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'

const ROOT = process.env.LORAMER_GUARD_ROOT || process.cwd()
const read = (rel) => { try { return readFileSync(path.resolve(ROOT, rel), 'utf8') } catch { return null } }
const F = 'src/lib/claude-tools.ts'          // the WIRING (grain gap, fail-loud)
const F_PURE = 'src/lib/lora/coverage-binding.ts' // the pure DECIDER the guard drives
const src = read(F)
if (!src) { console.error(`✗ ${F} unreadable — BROKEN INSTRUMENT, not a pass.`); process.exit(2) }

const BARE = process.argv.includes('--inject-bare-total')
const GRAIN_GAP = process.argv.includes('--inject-grain-gap')
const SILENT = process.argv.includes('--inject-silent-catch')
const OVER = process.argv.includes('--inject-over-refuse')

// Compile the REAL module's pure decider. Never a stub — a stubbed subject is shape (b) of
// ★GUARD-SUITE-SWEEP-FOR-FALSE-GREENS and would make this guard decoration.
let bindWindow = null
{
  const out = mkdtempSync(path.join(tmpdir(), 'loramer-binding-'))
  const tsc = path.join(ROOT, 'node_modules', '.bin', 'tsc')
  const r = spawnSync(tsc, [path.resolve(ROOT, F_PURE), '--target', 'es2020', '--module', 'commonjs', '--outDir', out,
    '--skipLibCheck'], { encoding: 'utf8' })
  try {
    const M = createRequire(import.meta.url)(path.join(out, 'coverage-binding.js'))
    bindWindow = M.bindWindow
  } catch (e) {
    console.error(`✗ could not load the compiled bindWindow — BROKEN INSTRUMENT, not a pass: ${e.message}. tsc said: ${String(r.stdout || '').slice(0, 200)}`)
    process.exit(2)
  }
  if (typeof bindWindow !== 'function') { console.error('✗ bindWindow is not a drivable export — BROKEN INSTRUMENT, not a pass.'); process.exit(2) }
}

const findings = []
const W = (rowCount) => ({ startDate: '2025-01-01', endDate: '2025-03-31', totals: { spend: 1234, rowCount }, canonical: { revenue: 99 } })

// ── (i) BINDING ─────────────────────────────────────────────────────────────────────────────────────────
{
  const partial = bindWindow(W(50), { complete: BARE ? true : false, measured: true })
  if ('totals' in partial) findings.push(`(i) a PARTIAL window still carries a bare \`totals\` key. The whole mechanism is that the key holding a whole number DOES NOT EXIST when the window is not complete — with it present the model can quote a partial figure as a total, which is 6 of the 8 measured FALSE_ZEROs.`)
  if (!partial.withheld?.mustSay) findings.push(`(i) a PARTIAL window carries no \`withheld.mustSay\` directive — the reader gets a renamed key with no instruction attached, which is half a mechanism.`)
  if (partial.coverageVerdict !== 'PARTIAL' || partial.answerable !== false) findings.push(`(i) PARTIAL window verdict/answerable wrong: got ${partial.coverageVerdict}/${partial.answerable}.`)
  if (!partial.partialTotals) findings.push(`(i) PARTIAL deleted the numbers instead of MOVING them to partialTotals. Deleting over-refuses — the covered portion is real and discussable.`)

  const unknown = bindWindow(W(0), { complete: undefined, measured: BARE ? true : false, measureError: 'statement timeout' })
  if ('totals' in unknown) findings.push(`(i) an UNKNOWN (unmeasurable) window still carries a bare \`totals\` key — a failed measurement handing back a clean-looking number is the exact false-all-clear this closes.`)
  if (unknown.unknownReason !== 'read_failed') findings.push(`(i) an unmeasurable window does not carry unknownReason 'read_failed' — the existing coverage vocabulary (coverage.ts:186) must be reused, not re-invented.`)

  const complete = bindWindow(W(50), { complete: true, measured: true })
  if (!('totals' in complete)) findings.push(`(i) a COMPLETE window LOST its \`totals\` key — the binding must be invisible on clean windows or every ordinary answer regresses.`)
  if (complete.answerable !== true) findings.push(`(i) a COMPLETE window is not answerable — over-refusal.`)
}

// ── (iv) NO OVER-REFUSAL — a real zero stays a real zero ────────────────────────────────────────────────
{
  const zero = bindWindow(W(0), { complete: OVER ? false : true, measured: true })
  if (zero.answerable !== true || zero.zeroIsReal !== true) {
    findings.push(`(iv) a COMPLETE window with zero rows is not marked \`zeroIsReal\`/answerable (got answerable=${zero.answerable}, zeroIsReal=${zero.zeroIsReal}). A genuine zero MUST stay statable — refusing it teaches the model to disbelieve every zero, which trades one honesty failure for another.`)
  }
}

// ── (ii) NO GRAIN GAP ───────────────────────────────────────────────────────────────────────────────────
{
  const earlyReturn = /if \(level && level !== 'account'\) return result/.test(src)
  if (GRAIN_GAP || earlyReturn) findings.push(`(ii) ${F}: the account-grain-only early return is back. Coverage would be attached for account questions and SILENTLY ABSENT for every campaign/ad/product grain — and the account verdict does not answer a grain question: A13/E7 fabricated breakdowns for a geo grain whose floor postdated a window the ACCOUNT genuinely covered.`)
  if (!GRAIN_GAP && !/return await bindCoverage\(result, \{ clientId, platforms, level \}\)/.test(src)) findings.push(`(ii) ${F}: runQueryMetricsTool no longer routes every result through bindCoverage — some grain would return unbound, which is the early return wearing a different shape.`)
  // ⛔ AND THE INVERSE, LEARNED THE HARD WAY IN THIS FLIGHT'S OWN GATE-A: getBreakdownCoverage must NOT be
  // called from the metrics path. breakdown-coverage-wired leg (e) bans it because a breakdown-family verdict
  // does not bear on a BASE-grain total — and when I wired it anyway it returned UNKNOWN for a grain with no
  // families and my code turned that into a FALSE PARTIAL. Over-refusal through a side door. Pinned so the
  // same well-meaning wiring cannot come back.
  if (/getBreakdownCoverage\(ctx\.clientId/.test(src)) findings.push(`(ii) ${F}: getBreakdownCoverage is being called from the metrics/binding path. It answers whether BREAKDOWN FAMILIES have holes, which says nothing about a base-grain total — and it returns UNKNOWN where there are no families, which becomes a FALSE PARTIAL. query_breakdown already carries breakdownCoverage; the metrics path must not.`)
}

// ── (iii) FAIL LOUD ─────────────────────────────────────────────────────────────────────────────────────
{
  if (SILENT || /catch\s*\{\s*\n?\s*return result\s*\n?\s*\}/.test(src)) {
    findings.push(`(iii) ${F}: a silent \`catch { return result }\` is back on the coverage path. It returns the total with NO completeness field at all, so "coverage says fine" and "coverage never ran" become indistinguishable by absence — and nothing instructs a reader to notice an absence.`)
  }
  if (!SILENT && !/coverageMeasured/.test(src)) findings.push(`(iii) ${F}: the payload no longer carries \`coverageMeasured\` — the positive signal that the measurement itself succeeded.`)
}

for (const [flag, note] of [
  [BARE, '[--inject-bare-total] fed complete/measured=true where the code must treat the window as not-COMPLETE'],
  [GRAIN_GAP, '[--inject-grain-gap] treated the grain wiring as absent'],
  [SILENT, '[--inject-silent-catch] treated the silent catch as present'],
  [OVER, '[--inject-over-refuse] marked a genuine zero as not-complete'],
]) if (flag) console.log(`  ${note} — it must go RED.`)

console.log('[binding-coverage] (i) PARTIAL/UNKNOWN delete `totals` and carry withheld.mustSay · (ii) no account-only early return, grain resolver wired · (iii) no silent catch, coverageMeasured present · (iv) a COMPLETE zero stays answerable')
console.log('[binding-coverage] (i)/(iv) drive the REAL compiled bindWindow; (ii)/(iii) are static reads. Proves the SHAPE, never that the model obeys it (the eval) and never a live window (check:data).')
if (findings.length) {
  console.error(`✗ binding-coverage FAIL — ${findings.length} finding(s):`)
  for (const f of findings) console.error(`  - ${f}`)
  process.exit(1)
}
console.log('✓ binding-coverage OK — the verdict gates the payload structurally, at every grain, and a real zero survives it.')
process.exit(0)
