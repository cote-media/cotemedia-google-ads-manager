#!/usr/bin/env node
// LORAMER_PRE_STEP_READ_V1 — A WALK-REBUILD STEP MAY NOT BE MARKED BUILT WITHOUT NAMING THE PRODUCTION CODE
// THAT ALREADY DOES IT, AT file:line — OR SAYING "NONE FOUND" AND LISTING WHAT WAS SEARCHED.
//
// ⛔ THIS IS THE 2026-08-08 LAW FINALLY GIVEN TEETH, AND THE LAW'S OWN PRECEDENT IS THE ARGUMENT FOR THE GUARD.
// "CHECK WHAT ALREADY WORKS BEFORE BUILDING IT AGAIN" was banked as ESSENCE law on 2026-08-08 after Russ asked
// THREE TIMES whether the June backfill engine had been read. It had not — eight steps in. When it finally was,
// it already held write-then-advance-per-unit AND the warehouse-over-cursor rule (in a comment stating the law
// better than the plan did), and its no-progress bound was NOT PLANNED AT ALL and would have shipped missing.
//
// ⛔ AND THEN THE LAW WAS BROKEN INSIDE 24 HOURS, WHICH IS WHY PROSE IS NOT ENOUGH. The 2026-08-09 sweep
// measured v2 walking straight past THREE capabilities already live in production: the between-iteration budget
// reservation (`lap-budget.ts:28-31`, applied at `cron/drain/route.ts:327`), the quota sentinel
// (`cron/drain/route.ts:122-123`), and the fleet-aware yield (`universe-governor.ts:150`). Steps 0-7 shipped
// ahead of the sweep that would have found all three. **This is the check that would have stopped that.**
//
// ⛔ A PLAN-TIME JUDGMENT IS NOT AN ANSWER. `decideVendorExhaustion` and `decideRangeLapCompletion` were classed
// "SURVIVES" in the rebuild plan — a judgment made without opening either file. Leg (c) fails a bare
// SURVIVES/survives verdict inside the step entry that carries no file:line beside it.
//
// ⛔ WHAT IT CANNOT DO, stated rather than implied: it cannot tell whether the file:line offered is the RIGHT
// one, or whether the reader understood it. It enforces that the READ HAPPENED AND WAS WRITTEN DOWN — the same
// enforceable half as the three-source header, and the same honest limit. A human reading the answer can judge
// it; a guard can only insist the answer exists.
//
// THE MARKER FORMAT, anywhere in LORAMER_QUEUE_OF_RECORD.md, one per built step:
//   PRE-STEP READ <n>: <file.ts:line — what it already does> ‖ PRE-STEP READ <n>: NONE FOUND — searched <paths>
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const ROOT = process.env.LORAMER_GUARD_ROOT || process.cwd()
const DOC = 'LORAMER_QUEUE_OF_RECORD.md'
const ENTRY_TOKEN = '★WALK-REBUILD-STEPS-8-16'

// ── THE BASELINE FREEZE — REMOVE-ONLY ─────────────────────────────────────────────────────────────────────
// ⛔ EVERY STEP BELOW SHIPPED WITHOUT ITS PRE-STEP READ. That is not absolution and it is not retro-stamped:
// writing the answers now, from memory, months later, would MANUFACTURE the provenance this guard exists to
// make real — the same rubber-stamp failure the three-source guard names. They are frozen as the debt they
// are, and each one is discharged by the sweep that finally read those paths.
const EXCEPTIONS = [
  { step: '0', date: '2026-08-09', queue: '★SWEEP-THE-WALK-AND-DRAIN-PATHS',
    note: 'adapter contract + retrofit — shipped 2026-08-09 ahead of the sweep' },
  { step: '3', date: '2026-08-09', queue: '★SWEEP-THE-WALK-AND-DRAIN-PATHS',
    note: 'resource→surface mapping — shipped ahead of the sweep' },
  { step: '4', date: '2026-08-09', queue: '★SWEEP-THE-WALK-AND-DRAIN-PATHS',
    note: 'density model, falsified and DELETED — shipped ahead of the sweep' },
  { step: '5', date: '2026-08-09', queue: '★SWEEP-THE-WALK-AND-DRAIN-PATHS',
    note: 'universe_attempt_log migration + append helpers — shipped ahead of the sweep' },
  { step: '6', date: '2026-08-09', queue: '★SWEEP-THE-WALK-AND-DRAIN-PATHS',
    note: 'streaming day-resumable consumer — shipped ahead of the sweep; the sweep then found C1/C2/C4 in it' },
  { step: '7', date: '2026-08-09', queue: '★SWEEP-THE-WALK-AND-DRAIN-PATHS',
    note: 'resumer cron — shipped ahead of the sweep; the sweep then found C3/C6 in it' },
]

const findings = []
let text
try { text = readFileSync(resolve(ROOT, DOC), 'utf8') } catch (e) {
  console.error(`[pre-step-read] FAIL — ${DOC} unreadable (${e.message}). A guard that cannot read its subject is not a pass.`)
  process.exit(1)
}

// ── (a) THE ENTRY AND ITS BUILT LIST ──────────────────────────────────────────────────────────────────────
const entry = text.split('\n').find((l) => l.includes(ENTRY_TOKEN) && /^- /.test(l))
if (!entry) {
  console.error(`[pre-step-read] FAIL — no ${ENTRY_TOKEN} entry in ${DOC}. The walk rebuild's status entry is where BUILT is declared; without it nothing can be checked.`)
  process.exit(1)
}
const builtSeg = entry.match(/\*\*BUILT:([\s\S]*?)\*\*UNBUILT/)
if (!builtSeg) {
  findings.push(`${ENTRY_TOKEN} NO LONGER DECLARES A MACHINE-READABLE BUILT LIST (\`**BUILT: …** … **UNBUILT\`). The BUILT list is what this guard reads; a prose rewrite of it silently disables the check.`)
}
// ⛔ TWO SHAPES, AND THE FIRST ONE COST A RED RUN TO NOTICE: the leading step rides INSIDE the label
// (`**BUILT: 0**`), so its opening `**` is consumed by the label and a plain `**n**` scan silently misses it.
// A step the parser cannot see is a step this guard would wave through, which is the failure mode it exists to
// prevent, one level up. Both shapes are read.
const built = builtSeg
  ? [...new Set([
      ...[...builtSeg[1].matchAll(/\*\*\s*(\d{1,2})\s*\*\*/g)].map((m) => m[1]),
      ...(builtSeg[1].match(/^\s*(\d{1,2})\s*\*\*/) ? [builtSeg[1].match(/^\s*(\d{1,2})\s*\*\*/)[1]] : []),
    ])].sort((a, b) => Number(a) - Number(b))
  : []
if (builtSeg && built.length === 0) {
  findings.push(`${ENTRY_TOKEN} declares a BUILT segment with NO step numbers in it. Either nothing is built (say so) or the numbering shape changed.`)
}

// ── (b) EVERY BUILT STEP ANSWERS "WHAT PRODUCTION CODE ALREADY DOES THIS" ─────────────────────────────────
const FILELINE = /[\w./-]+\.(?:ts|tsx|mjs|js|sql)\s*:\s*\d+/
const excepted = new Map(EXCEPTIONS.map((e) => [e.step, e]))
const answered = new Set()

for (const n of built) {
  const re = new RegExp(`PRE-STEP READ\\s+${n}\\s*:([^\\n]*)`)
  const m = text.match(re)
  if (m) {
    const body = m[1]
    const hasFileLine = FILELINE.test(body)
    const hasNoneFound = /NONE FOUND/i.test(body) && /searched/i.test(body)
    if (!hasFileLine && !hasNoneFound) {
      findings.push(`STEP ${n} HAS A PRE-STEP READ WITH NO EVIDENCE IN IT: "${body.trim().slice(0, 120)}". It must name production code at file:line, or say NONE FOUND and list the paths actually searched. A verdict without a path is the plan-time judgment this guard exists to refuse.`)
    }
    answered.add(n)
    continue
  }
  if (excepted.has(n)) continue
  findings.push(
    `STEP ${n} IS MARKED BUILT WITH NO \`PRE-STEP READ ${n}:\` ANSWER in ${DOC}.\n` +
    `      Answer "WHAT PRODUCTION CODE ALREADY DOES THIS" at file:line, or state NONE FOUND with the paths searched.\n` +
    `      Precedent: the June engine already held write-then-advance-per-unit and the warehouse-over-cursor rule,\n` +
    `      and its no-progress bound was not planned at all — five rounds of adversarial planning re-derived two of\n` +
    `      three and would have shipped without the third.`
  )
}

// ── (c) "SURVIVES" IS NOT AN ANSWER WITHOUT A file:line ───────────────────────────────────────────────────
for (const m of entry.matchAll(/\bSURVIVES?\b/gi)) {
  const around = entry.slice(Math.max(0, m.index - 200), m.index + 200)
  if (!FILELINE.test(around)) {
    findings.push(`PLAN-TIME JUDGMENT IN ${ENTRY_TOKEN}: "${entry.slice(Math.max(0, m.index - 60), m.index + 60).trim()}" — a SURVIVES verdict with no file:line within 200 characters. decideVendorExhaustion and decideRangeLapCompletion were both classed SURVIVES by a judgment nobody had opened the files to make.`)
  }
}

// ── (d) DEAD COVER ────────────────────────────────────────────────────────────────────────────────────────
for (const ex of EXCEPTIONS) {
  if (answered.has(ex.step)) {
    findings.push(`DEAD EXCEPTION — step ${ex.step} now HAS its \`PRE-STEP READ ${ex.step}:\` answer (${ex.queue}). The debt is paid; delete this entry so the freeze cannot outlive it.`)
    continue
  }
  if (builtSeg && !built.includes(ex.step)) {
    findings.push(`DEAD EXCEPTION — step ${ex.step} is no longer listed as BUILT (${ex.queue}). Delete this entry rather than leaving cover for a step number that may be reused.`)
  }
}

if (findings.length) {
  console.error(`\n❌ LORAMER_PRE_STEP_READ_V1 FAILED — ${findings.length} finding(s)\n`)
  findings.forEach((f) => console.error('  • ' + f + '\n'))
  console.error('  ⛔ THE EXCEPTIONS LIST IS REMOVE-ONLY. A new step does the read BEFORE it is marked built —')
  console.error('     that is the whole point, and it is free compared to re-deriving what already ships.\n')
  process.exit(1)
}
console.log(
  `pre-step-read.guard: PASS — ${built.length} BUILT step(s) [${built.join(', ')}], ${answered.size} answered with evidence, ` +
  `${EXCEPTIONS.length} frozen as pre-guard debt. LIMIT: it enforces that the read was written down, never that it was right.`
)
