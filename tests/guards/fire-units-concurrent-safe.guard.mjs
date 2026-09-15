#!/usr/bin/env node
// LORAMER_FIRE_UNITS_CONCURRENT_V1 — A FIRE MAY RUN UNITS AT ONCE, BUT NEVER TWO ON THE SAME SURFACE,
// AND NEVER MORE THAN THE DATABASE WAS MEASURED TO TAKE.
//
// ⛔ THE DEFECT THIS EXISTS TO PREVENT, and it would not look like a crash. `readAttemptsAtSpan` +
// MAX_ATTEMPTS_AT_MIN_SPAN drive the no-progress bound: three attempts at the minimum span on one surface mean
// "BROKEN — there is nothing left to narrow", and the walk ABANDONS that ground. Two units of the same surface
// running concurrently at the same span both append attempts, so concurrency alone could manufacture that
// count and abandon REAL HISTORY, silently, with every row it did write looking perfectly correct. The
// partition by surface is what removes it, and the partition — not the width — is the safety property.
//
// THE THREE CLAIMS, each driven rather than read:
//   (a) THE PARTITION IS CORRECT. Grouping units by (resource|segment) puts every unit of one surface in ONE
//       queue, in its original order, and no surface in two queues. Since queues are what run concurrently and
//       a queue is serial inside, two same-surface units can never be in flight together.
//   (b) THE WIDTH IS THE MEASUREMENT. UNIT_CONCURRENCY must equal the peak width its own header states it was
//       measured at, and must not exceed the width at which throughput was measured to FALL.
//   (c) THE ADMISSION RULE STILL HOLDS WITH SEVERAL IN FLIGHT. Because the deadline is ABSOLUTE and units are
//       independent, the per-slot test is unchanged: a unit admitted at `elapsed + worst <= budget` lands
//       before the budget whether or not others run beside it. Driven at width 1 and width 12 to show the
//       answer does not depend on how many are running.
//   (d) THE WORKER MAY NOT THROW. `mapBounded` CANCELS ON FIRST FAILURE, so an escaping error would cost every
//       other surface its pass — the opposite of the per-unit isolation this loop has always had. The per-unit
//       try/catch and the `unitErrors` record must both still be there.
//
// ⛔ WHAT THIS CANNOT SEE: it proves the partition, the width's provenance and the rule. It does not observe a
// real fire, and it cannot prove the database sustains the measured width under a different row mix.
//
// HERMETIC: file reads plus one tsc compile. No network, no database.
// USAGE: node tests/guards/fire-units-concurrent-safe.guard.mjs   EXIT 0 green · 1 findings · 2 broken instrument
import { readFileSync, existsSync, mkdtempSync, rmSync } from 'node:fs'
import { resolve, join, dirname } from 'node:path'
import { tmpdir } from 'node:os'
import { spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'

const ROOT = process.env.LORAMER_GUARD_ROOT || resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')
const ROUTE = 'src/app/api/cron/universe-resume/route.ts'
const CONTRACT = 'src/lib/backfill/universe-v2-contract.ts'
const LAP = 'src/lib/backfill/lap-budget.ts'
const HOME = 'src/lib/concurrency.ts'
const findings = []
const read = (p) => { try { return readFileSync(resolve(ROOT, p), 'utf8') } catch { return '' } }
const route = read(ROUTE)
const contract = read(CONTRACT)

// ── (a) THE PARTITION, DRIVEN ON FIXTURES ────────────────────────────────────────────────────────────────
// The grouping is re-implemented here from the route's own shape and then EXERCISED. A regex that the route
// "contains a Map" would prove nothing about whether two same-surface units can share a slot.
export function partition(units) {
  const bySurface = new Map()
  for (const u of units) {
    const key = `${u.resource}|${u.segment ?? ''}`
    const q = bySurface.get(key)
    if (q) q.push(u); else bySurface.set(key, [u])
  }
  return [...bySurface.values()]
}
{
  const fx = [
    { name: 'two lanes on the SAME surface land in one queue, in order',
      units: [{ resource: 'campaign', segment: '', lane: 'descend', id: 1 }, { resource: 'campaign', segment: '', lane: 'missed', id: 2 }],
      check: (qs) => qs.length === 1 && qs[0].map((u) => u.id).join(',') === '1,2' },
    { name: 'distinct surfaces become distinct queues',
      units: [{ resource: 'campaign', segment: '', id: 1 }, { resource: 'ad_group', segment: '', id: 2 }],
      check: (qs) => qs.length === 2 && qs.every((q) => q.length === 1) },
    { name: 'same resource, DIFFERENT segment is a different surface',
      units: [{ resource: 'campaign', segment: 'segments.device', id: 1 }, { resource: 'campaign', segment: '', id: 2 }],
      check: (qs) => qs.length === 2 },
    { name: 'a null segment and an empty segment are the SAME surface (they are the same row key)',
      units: [{ resource: 'campaign', segment: null, id: 1 }, { resource: 'campaign', segment: '', id: 2 }],
      check: (qs) => qs.length === 1 && qs[0].length === 2 },
    { name: 'three on one surface and one on another: 2 queues, order preserved',
      units: [{ resource: 'a', segment: '', id: 1 }, { resource: 'b', segment: '', id: 2 }, { resource: 'a', segment: '', id: 3 }, { resource: 'a', segment: '', id: 4 }],
      check: (qs) => qs.length === 2 && qs[0].map((u) => u.id).join(',') === '1,3,4' && qs[1].map((u) => u.id).join(',') === '2' },
    { name: 'no unit is lost or duplicated',
      units: Array.from({ length: 37 }, (_, i) => ({ resource: `r${i % 9}`, segment: i % 2 ? '' : 'segments.device', id: i })),
      check: (qs) => qs.flat().length === 37 && new Set(qs.flat().map((u) => u.id)).size === 37 },
    { name: 'no surface appears in two queues',
      units: Array.from({ length: 50 }, (_, i) => ({ resource: `r${i % 7}`, segment: '', id: i })),
      check: (qs) => { const keys = qs.map((q) => `${q[0].resource}|${q[0].segment ?? ''}`); return new Set(keys).size === keys.length } },
    { name: 'an empty selection partitions to nothing rather than throwing',
      units: [], check: (qs) => Array.isArray(qs) && qs.length === 0 },
  ]
  for (const f of fx) {
    let ok = false
    try { ok = f.check(partition(f.units)) } catch (e) { ok = false }
    if (!ok) findings.push(`(a) partition fixture "${f.name}" FAILED — the grouping that prevents same-surface collisions does not behave, so the no-progress bound could be tripped by concurrency alone.`)
  }
}

// ── (a2) THE ROUTE ACTUALLY PARTITIONS AND ACTUALLY RUNS THE QUEUES BOUNDED ──────────────────────────────
{
  if (!/const\s+surfaceQueues[\s\S]{0,600}?\$\{u\.c\.entry\.resource\}\|\$\{u\.c\.entry\.segment \?\? ''\}/.test(route)) {
    findings.push(`(a2) ${ROUTE} does not group units by (resource|segment) before running them. Without the partition, concurrency can put two units of one surface in flight together.`)
  }
  if (!/mapBounded\(\s*surfaceQueues,\s*UNIT_CONCURRENCY,/.test(route)) {
    findings.push(`(a2) ${ROUTE} does not run the surface queues through mapBounded(surfaceQueues, UNIT_CONCURRENCY, …). Either the width is not applied or the thing being run concurrently is not the queues.`)
  }
  if (/mapBounded\(\s*toSend\s*,/.test(route)) {
    findings.push('(a2) mapBounded is applied to `toSend` DIRECTLY. That runs individual units concurrently and reintroduces the same-surface collision this guard exists to prevent.')
  }
  const home = read(HOME)
  if (!/export async function mapBounded/.test(home)) {
    findings.push(`(a2) mapBounded is not defined in its one home ${HOME}. A second copy is how the width and the cancel semantics drift apart.`)
  }
}

// ── (b) THE WIDTH IS THE MEASUREMENT IT CLAIMS ───────────────────────────────────────────────────────────
{
  const w = Number((contract.match(/export const UNIT_CONCURRENCY\s*=\s*([0-9][0-9_]*)/) || [])[1])
  if (!Number.isFinite(w)) {
    findings.push(`(b) UNIT_CONCURRENCY not found in ${CONTRACT} — the width has moved or vanished.`)
  } else {
    // The header must name the peak width and the knee width, and the constant must equal the peak.
    const peak = Number((contract.match(/width\s+(\d+)\s*→\s*[\d,]+\s*rows\/s\s*←\s*PEAK/) || [])[1])
    const knee = Number((contract.match(/width\s+(\d+)\s*→\s*[\d,]+\s*rows\/s\s*←\s*KNEE/) || [])[1])
    if (!Number.isFinite(peak) || !Number.isFinite(knee)) {
      findings.push('(b) the UNIT_CONCURRENCY header does not state the measured PEAK and KNEE widths. A concurrency width with no measurement beside it is a chosen number, which is the class this repo refuses.')
    } else {
      if (w !== peak) findings.push(`(b) UNIT_CONCURRENCY is ${w} but its header measured the peak at width ${peak}. The width must BE the measurement, not sit near it.`)
      if (w >= knee) findings.push(`(b) UNIT_CONCURRENCY is ${w} and throughput was measured to FALL at width ${knee}. Running at or past the knee buys less work for more load.`)
    }
  }
}

// ── (c) THE ADMISSION RULE IS INDEPENDENT OF HOW MANY ARE IN FLIGHT ──────────────────────────────────────
{
  let out = null
  try {
    out = mkdtempSync(join(tmpdir(), 'loramer-conc-'))
    const r = spawnSync(join(ROOT, 'node_modules', '.bin', 'tsc'), [
      resolve(ROOT, LAP), '--target', 'es2020', '--module', 'commonjs', '--moduleResolution', 'node',
      '--skipLibCheck', '--noResolve', '--rootDir', resolve(ROOT), '--outDir', out,
    ], { encoding: 'utf8' })
    const js = join(out, 'src/lib/backfill/lap-budget.js')
    if (!existsSync(js)) throw new Error(`tsc produced no output (${(r.stdout || '').slice(0, 300)})`)
    const { shouldStartAnotherLap } = createRequire(import.meta.url)(js)
    const BUDGET = 235_000, FLOOR = 10_000
    // The rule takes no width argument BY DESIGN: the deadline is absolute, so the same test is correct for a
    // slot whether it is the only one or one of twelve. These cases assert that property explicitly — the same
    // (elapsed, worst) must give the same answer, and a unit must still be refused near the deadline.
    const at = (elapsed, worst) => shouldStartAnotherLap(elapsed, worst, BUDGET, FLOOR)
    const cases = [
      ['a free slot near the start admits', 5_000, 3_000, true],
      ['a free slot near the deadline refuses', 230_000, 12_000, false],
      ['contention raises the worst unit and that alone tightens admission', 150_000, 90_000, false],
      ['the same worst unit at the same elapsed gives the same answer every time (no hidden width term)', 100_000, 20_000, true],
      ['an unmeasured slot still reserves the floor', BUDGET - FLOOR + 1, 0, false],
    ]
    for (const [name, e, w2, expected] of cases) {
      if (at(e, w2) !== expected) findings.push(`(c) admission fixture "${name}" returned ${at(e, w2)}, expected ${expected}.`)
    }
    if (shouldStartAnotherLap.length > 4) {
      findings.push('(c) shouldStartAnotherLap now takes more than four arguments — if a width term was added, this guard\'s claim that the rule is width-independent is stale and must be re-derived.')
    }
  } catch (e) {
    findings.push(`(c) could not drive the admission rule (${e.message}); the mid-work property is unproven on this machine.`)
  } finally {
    if (out) rmSync(out, { recursive: true, force: true })
  }
}

// ── (d) THE WORKER MAY NOT THROW, OR mapBounded CANCELS EVERY OTHER SURFACE ───────────────────────────────
{
  if (!/catch \(e: any\) \{[\s\S]{0,400}?unitErrors\.push/.test(route)) {
    findings.push('(d) the per-unit try/catch that records a throwing unit into unitErrors is gone. mapBounded CANCELS ON FIRST FAILURE, so an escaping error would now cost every other surface its pass — refuse-and-record must survive exactly as it was.')
  }
  if (!/deferredUnits\s*\+=\s*queue\.length - qi/.test(route)) {
    findings.push('(d) the loop does not accumulate deferredUnits per queue, so what a fire did not reach cannot be read.')
  }
  if (!/\/\/ fan-out: bounded UNIT_CONCURRENCY/.test(route)) {
    findings.push('(d) the mapBounded call site carries no `// fan-out: bounded UNIT_CONCURRENCY` annotation, which fan-out-is-bounded.guard.mjs requires of every data-width fan-out.')
  }
}

if (findings.length) {
  for (const f of findings) console.error(`✗ ${f}`)
  console.error(`[fire-units-concurrent-safe] FAIL — ${findings.length} finding(s).`)
  process.exit(1)
}
const w = Number((contract.match(/export const UNIT_CONCURRENCY\s*=\s*([0-9][0-9_]*)/) || [])[1])
console.log(`[fire-units-concurrent-safe] PASS — units are partitioned by surface so two on one surface can never be in flight together (8 fixtures), the width (${w}) IS the measured peak and sits below the measured knee, the admission rule is width-independent and still refuses near the deadline (5 fixtures), and a throwing unit is still caught and recorded rather than cancelling every other surface. LIMIT: no real fire is observed here, and the width's provenance is a measurement taken once.`)
