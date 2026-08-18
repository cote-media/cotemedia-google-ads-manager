#!/usr/bin/env node
// LORAMER_MISSIZE_REOWES_THE_UPPER_HALF_V1 — A NARROWED WINDOW MAY NOT DROP ITS OTHER HALF.
//
// ⛔ THE DEFECT, MEASURED BEFORE IT WAS FIXED. When a window fails NARROW_AFTER_ATTEMPTS times above the
// minimum span, the consumer re-publishes it at HALF the span — and it published `[startDate, narrowedEnd]`,
// the OLDER half, while NOTHING ever republished `[narrowedEnd+1, endDate]`. The resumer cannot rescue that
// ground: the anchor only moves DOWN, and the narrowed window's own attempt rows pull the rotation below the
// dropped days on the very next fire. So the upper half was not walked later; it was walked NEVER.
// LIVE PROOF, 2026-08-18, from `no-owed-day-left-behind.guard.mjs` reading the warehouse: 270 owed days above
// the frontier across 14 surfaces — and TWELVE of them reporting EXACTLY 15 days at 2026-03-24..2026-04-07,
// which is precisely the upper half of the 30-day window [2026-03-09..2026-04-07] this branch narrowed to 15.
// 18 mis-sized events stand in the attempt log.
//
// ⛔ AND IT IS ITS OWN MARKER BECAUSE THE PARENT-WINDOW FIX DOES NOT CLOSE IT. The narrowed message's window
// genuinely IS the narrow one, so `parent_window_start/end` records it FAITHFULLY. The ground is lost at the
// PUBLISH site, not at the anchor. A fix that closes a hole and leaves the CLASS alive is a failure even
// shipped green (LORAMER_ENGINEER_OF_RECORD_V1).
//
// TWO KINDS OF LEG, because the property has two halves and only one of them is arithmetic:
//   (a) DRIVEN — the real compiled `planMisSizedSplit` over a table of window shapes. The invariant asserted
//       is the defect restated: **the two halves must PARTITION the window — contiguous, disjoint, and no day
//       belonging to neither.** Driven, never re-implemented here.
//   (b) SOURCE — the consumer must publish the UPPER half FIRST and must NOT publish the lower half when the
//       upper is refused. That ORDER is the safety property: the governor can refuse, and a refusal must cost
//       us the NARROWING (recoverable) rather than the DATA (not). No pure function can hold that; it is a
//       property of the call sequence, so it is checked at the source. ⚠ A SOURCE LEG IS A WEAKER
//       INSTRUMENT THAN A DRIVE and is labelled as one rather than dressed up.
//
// USAGE: node tests/guards/mis-size-must-re-owe.guard.mjs
import { mkdtempSync, rmSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'

const ROOT = process.env.LORAMER_GUARD_ROOT || process.cwd()
const ROUTE = 'src/app/api/queues/google-ads-universe-v2/route.ts'
const out = mkdtempSync(join(tmpdir(), 'loramer-missize-'))
const findings = []
const dayList = (from, to) => {
  const acc = []
  const d = new Date(from + 'T00:00:00Z'), end = new Date(to + 'T00:00:00Z')
  while (d <= end) { acc.push(d.toISOString().slice(0, 10)); d.setUTCDate(d.getUTCDate() + 1) }
  return acc
}

// ── (a) THE DRIVEN LEG ────────────────────────────────────────────────────────────────────────────────────
try {
  const r = spawnSync(join(ROOT, 'node_modules', '.bin', 'tsc'), [
    resolve(ROOT, 'src/lib/backfill/universe-resumer.ts'),
    '--target', 'es2020', '--module', 'commonjs', '--moduleResolution', 'node',
    '--skipLibCheck', '--noResolve', '--rootDir', resolve(ROOT), '--outDir', out,
  ], { encoding: 'utf8' })
  if (r.error) throw new Error(`tsc did not run: ${r.error.message}`)
  const R = createRequire(import.meta.url)(join(out, 'src/lib/backfill/universe-resumer.js'))
  if (typeof R.planMisSizedSplit !== 'function') {
    throw new Error('planMisSizedSplit is not exported from universe-resumer — the split is inline again, which is the shape that dropped the upper half')
  }

  // The first row is the LIVE case: Foam OH's 30-day window narrowed to 15, whose upper half 12 surfaces are
  // still holding as skipped ground. The rest bracket the edges where an off-by-one would invent or lose a day.
  const CASES = [
    { windowStart: '2026-03-09', windowEnd: '2026-04-07', minDays: 1, note: 'the live 30-day case, narrowed to 15' },
    { windowStart: '2026-02-03', windowEnd: '2026-03-04', minDays: 1, note: '30 days' },
    { windowStart: '2026-01-01', windowEnd: '2026-01-02', minDays: 1, note: '2 days — the smallest splittable window' },
    { windowStart: '2026-01-01', windowEnd: '2026-01-01', minDays: 1, note: '1 day — nothing to split' },
    { windowStart: '2026-01-01', windowEnd: '2026-01-07', minDays: 1, note: '7 days, odd span' },
    { windowStart: '2026-01-01', windowEnd: '2026-01-05', minDays: 3, note: 'minDays floors the half above span/2' },
    { windowStart: '2026-01-01', windowEnd: '2026-01-03', minDays: 3, note: 'minDays >= span — the narrow consumes the window' },
  ]
  for (const c of CASES) {
    const s = R.planMisSizedSplit(c)
    const window = dayList(c.windowStart, c.windowEnd)
    const covered = [...dayList(s.lower.start, s.lower.end), ...(s.upper ? dayList(s.upper.start, s.upper.end) : [])]
    const seen = new Set(covered)
    const label = `${c.windowStart}..${c.windowEnd} minDays=${c.minDays} (${c.note})`

    // ⛔ THE INVARIANT THAT IS THE DEFECT RESTATED: every day of the window belongs to exactly one half.
    const lost = window.filter((d) => !seen.has(d))
    if (lost.length) {
      findings.push(`(a) ${label} — ${lost.length} day(s) of the window belong to NEITHER half (${lost[0]}..${lost[lost.length - 1]}). THAT IS THE DEFECT: those days are published by nobody and the anchor walks past them.`)
    }
    if (covered.length !== seen.size) {
      findings.push(`(a) ${label} — the halves OVERLAP; ${covered.length - seen.size} day(s) would be walked twice.`)
    }
    const invented = covered.filter((d) => d < c.windowStart || d > c.windowEnd)
    if (invented.length) {
      findings.push(`(a) ${label} — ${invented.length} day(s) fall OUTSIDE the window (${invented[0]}). A split must never invent ground the walk was not asked about.`)
    }
    if (s.upper) {
      const nextAfterLower = dayList(s.lower.end, s.upper.start)[1]
      if (s.upper.start !== nextAfterLower) {
        findings.push(`(a) ${label} — the halves are NOT contiguous: the lower ends ${s.lower.end} and the upper starts ${s.upper.start}. A gap here is the defect in miniature.`)
      }
    }
    if (s.lower.start !== c.windowStart) {
      findings.push(`(a) ${label} — the lower half starts at ${s.lower.start}, not at the window's own start ${c.windowStart}.`)
    }
    if (s.upper && s.upper.end !== c.windowEnd) {
      findings.push(`(a) ${label} — the upper half ends at ${s.upper.end}, not at the window's own end ${c.windowEnd}.`)
    }
    if (s.upper === null && s.lower.end !== c.windowEnd) {
      findings.push(`(a) ${label} — there is no upper half, but the lower half stops at ${s.lower.end} short of ${c.windowEnd}. With no second message those days are dropped.`)
    }
  }
  const live = R.planMisSizedSplit({ windowStart: '2026-03-09', windowEnd: '2026-04-07', minDays: 1 })
  console.log(`[mis-size-must-re-owe] driven: the live 30-day window splits to ${live.lower.start}..${live.lower.end} + ${live.upper ? `${live.upper.start}..${live.upper.end}` : 'NOTHING'} · ${CASES.length} shape(s) checked for a day belonging to neither half.`)
} catch (e) {
  rmSync(out, { recursive: true, force: true })
  console.error(`[mis-size-must-re-owe] CANNOT RUN — ${e.message}. A guard that cannot drive its subject FAILS rather than passing.`)
  process.exitCode = 2
  process.exit()
}
rmSync(out, { recursive: true, force: true })

// ── (b) THE SOURCE LEG — the publish ORDER and the fail-closed refusal ────────────────────────────────────
let src = ''
try { src = readFileSync(resolve(ROOT, ROUTE), 'utf8') }
catch (e) { findings.push(`(b) UNREADABLE ${ROUTE} — ${e.message}. A guard that cannot read its evidence FAILS.`) }
if (src) {
  if (!/planMisSizedSplit\s*\(/.test(src)) {
    findings.push(`(b) ${ROUTE} does not call planMisSizedSplit — the split arithmetic is inline again, and inline is what dropped the upper half.`)
  }
  const iUpper = src.indexOf('narrow-upper')
  const iLower = src.search(/\|narrow`/)
  if (iUpper === -1) {
    findings.push(`(b) ${ROUTE} never publishes an upper-half message (no 'narrow-upper' idempotency key). The mis-sized branch is dropping ${'[narrowedEnd+1, endDate]'} again.`)
  } else if (iLower !== -1 && iUpper > iLower) {
    findings.push(`(b) ${ROUTE} publishes the LOWER half before the upper. ⛔ THE ORDER IS THE SAFETY PROPERTY: the governor may refuse, and if the lower half is already out when the upper is refused, the rotation moves down onto the narrowed window and the upper half is below no future ask. Publish the endangered half first.`)
  }
  if (!/if\s*\(\s*!\s*upper\.published\s*\)/.test(src)) {
    findings.push(`(b) ${ROUTE} does not branch on the upper half's publish result. A refused upper half must HOLD the whole window, not split it — otherwise a quota refusal becomes a permanent hole.`)
  }
}

if (findings.length) {
  console.error(`[mis-size-must-re-owe] FAIL — ${findings.length} finding(s):`)
  for (const f of findings) console.error(`  - ${f}`)
  console.error(`  ⇒ A mis-sized window must be SPLIT, never TRUNCATED. Both halves get published or neither does.`)
  process.exitCode = 1
} else {
  console.log(`[mis-size-must-re-owe] PASS — the split partitions the window (no day belongs to neither half), the upper half is published FIRST, and a refused upper half holds the whole window instead of dropping it.`)
}
