#!/usr/bin/env node
// LORAMER_COMPARE_LABEL_YEAR_V1 — TWO WINDOWS SHOWN TOGETHER MUST NOT PRINT THE SAME LABEL.
//
// ⛔ OBSERVED ON DEVICE 2026-08-16 (Gate-B, iPhone, Foam OH Overview): with range 2026-07-16→2026-08-11 and
// compare = "Previous year", the chart legend read "Jul 16–Aug 11" for the BLUE series and "Jul 16–Aug 11"
// for the GREY one. Two identical names on a comparison chart.
//
// ⛔ THE DATA WAS NEVER WRONG, AND THAT IS WHY THIS GUARD IS ABOUT LABELS AND NOTHING ELSE. The resolver was
// verified correct (card-windows.ts:49 prev_year → shiftYears(…, 1), which SUBTRACTS a year) and the two
// series come from two SEPARATE fetches with different windows (CardViz.tsx:120-121). The whole defect was
// that `winLabel` formats month+day only — `toLocaleDateString('en-US', { month:'short', day:'numeric' })` —
// so two windows one year apart render identically.
//
// ⛔ BEHAVIOURAL, NOT A GREP — the house lesson (QUEUE:1015 ★GUARD-PASSED-A-CHANGE-THAT-BROKE-PRODUCTION:
// "the wiring was right. THE WIRING WAS NOT THE QUESTION"; checkdata-verdict-line.guard.mjs:126-160 compiles
// the REAL runner rather than reading it). Leg (a) EXTRACTS THE REAL LABEL FUNCTIONS FROM THE SHIPPED SOURCE,
// strips their type annotations, and CALLS them. A copy of the logic living here would prove only that the
// copy works.
//
// USAGE: node tests/guards/compare-label-year.guard.mjs
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs'
import { resolve, dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { tmpdir } from 'node:os'

const ROOT = process.env.LORAMER_GUARD_ROOT || resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const read = (p) => { try { return readFileSync(resolve(ROOT, p), 'utf8') } catch { return null } }
const findings = []

const SRC = 'src/lib/next/card-windows.ts'
const VIZ = 'src/components/redesign/cards/CardViz.tsx'
const src = read(SRC)
const viz = read(VIZ)
if (src === null) findings.push(`(a) ${SRC} unreadable — the label functions cannot be driven, which is a broken instrument and never a pass.`)
if (viz === null) findings.push(`(b) ${VIZ} unreadable — the call sites cannot be checked.`)

// ── EXTRACT ONE `export function NAME(...) { ... }` BY BRACE MATCHING ────────────────────────────────────
// Only these label helpers are lifted; they depend on nothing outside Date/String, which is what makes
// lifting them honest rather than a re-implementation.
function extractFn(source, name) {
  const at = source.indexOf(`export function ${name}(`)
  if (at < 0) return null
  const open = source.indexOf('{', at)
  if (open < 0) return null
  let depth = 0
  for (let i = open; i < source.length; i++) {
    if (source[i] === '{') depth++
    else if (source[i] === '}') { depth--; if (depth === 0) return source.slice(at, i + 1) }
  }
  return null
}
// Narrow, targeted annotation strip — parameter and return types only. Anything it cannot handle shows up as
// an import failure below, never as a silent pass.
const stripTypes = (s) => s
  .replace(/:\s*\[string,\s*string\]/g, '')
  .replace(/:\s*Win\b/g, '')
  .replace(/:\s*string\b/g, '')
  .replace(/:\s*number\b/g, '')
  .replace(/:\s*boolean\b/g, '')

let mod = null
if (src !== null) {
  const wanted = ['winLabel', 'winLabelPair']
  const parts = []
  for (const n of wanted) {
    const fn = extractFn(src, n)
    if (fn) parts.push(stripTypes(fn))
  }
  if (!parts.length) {
    findings.push(`(a) neither winLabel nor winLabelPair could be extracted from ${SRC} — the guard cannot drive what it cannot find.`)
  } else {
    const tmp = mkdtempSync(join(tmpdir(), 'loramer-label-guard-'))
    try {
      const file = join(tmp, 'labels.mjs')
      writeFileSync(file, parts.join('\n\n') + '\n')
      mod = await import(pathToFileURL(file).href)
    } catch (e) {
      findings.push(`(a) could not import the lifted label functions — ${e?.message}. A leg that cannot run is not a pass.`)
    } finally {
      rmSync(tmp, { recursive: true, force: true })
    }
  }
}

// ── (a) THE DEVICE CASE: A YEAR APART MUST NOT PRINT THE SAME ───────────────────────────────────────────
const CUR = { startDate: '2026-07-16', endDate: '2026-08-11' }   // the exact windows from the Gate-B session
const CMP = { startDate: '2025-07-16', endDate: '2025-08-11' }   // prev_year of the above
if (mod) {
  const pair = typeof mod.winLabelPair === 'function'
    ? mod.winLabelPair(CUR, CMP)
    : [mod.winLabel(CUR), mod.winLabel(CMP)]
  const how = typeof mod.winLabelPair === 'function' ? 'winLabelPair' : 'winLabel (no pair-aware variant exists)'
  if (pair[0] === pair[1]) {
    findings.push(`(a) ${how} renders BOTH windows as ${JSON.stringify(pair[0])} — current ${CUR.startDate}..${CUR.endDate} and compare ${CMP.startDate}..${CMP.endDate} are ONE YEAR APART and print identically. Observed on device 2026-08-16: a comparison chart whose two series carry the same name reads as broken even though the data is right.`)
  }
  // ── (c) THE OPPOSITE ERROR: same-year pairs must NOT gain a year (Option B, not Option A) ──────────────
  // Space is the scarce resource on the phone toolbar; a year on every label is noise, so this leg pins the
  // conditional behaviour rather than letting a future edit slide into always-on years.
  const SAME_A = { startDate: '2026-07-16', endDate: '2026-08-11' }
  const SAME_B = { startDate: '2026-06-16', endDate: '2026-07-11' }
  if (typeof mod.winLabelPair === 'function') {
    const same = mod.winLabelPair(SAME_A, SAME_B)
    if (same.some((l) => /\b20\d\d\b/.test(l))) {
      findings.push(`(c) winLabelPair added a YEAR to a same-year pair (${JSON.stringify(same)}). The year is conditional by design: two 2026 windows are already distinguishable by month and day, and a year on every label costs width the phone toolbar does not have.`)
    }
    if (same[0] === same[1]) {
      findings.push(`(c) winLabelPair renders two DIFFERENT same-year windows identically (${JSON.stringify(same)}) — the pair rule must not collapse distinct windows.`)
    }
  }
}

// ── (b) EVERY COMPARE-CONTEXT CALL SITE USES THE PAIR-AWARE LABEL ───────────────────────────────────────
// Supplementary and text-based, stated as such: leg (a) proves the FUNCTION, this proves the CALL SITES did
// not quietly revert to the bare single-window label in a place where two windows are shown together.
if (viz !== null) {
  const strip = (s) => s.split('\n').filter((l) => !l.trim().startsWith('//')).join('\n')
  const body = strip(viz)
  // A <Line …/> pair (current + compare) is the legend case; a bare winLabel(compare) is the stat delta case.
  const bareCompare = [...body.matchAll(/winLabel\(\s*compare/g)].length
  if (bareCompare > 0) {
    findings.push(`(b) ${VIZ} still calls winLabel(compare…) in ${bareCompare} place(s) — a compare context renders TWO windows together and must use the pair-aware label, or the two can print identically again.`)
  }
}

if (findings.length) {
  console.error(`\n✗ COMPARE-LABEL-YEAR FAILED — ${findings.length} finding(s):`)
  for (const f of findings) console.error(`  - ${f}`)
  console.error(`  LIMIT: this proves the LABEL text only. The underlying windows were verified correct separately (card-windows.ts:49 shiftYears subtracts; CardViz.tsx:120-121 fetches the two windows independently) and this guard asserts nothing about them.`)
  process.exit(1)
}
console.log(`[compare-label-year] PASS — the REAL label function was lifted from ${SRC} and driven: a one-year-apart pair renders two DIFFERENT labels, a same-year pair stays year-free, and no compare-context call site in ${VIZ} uses the bare single-window label. LIMIT: proves the label text only — the windows themselves are the resolver's job and are asserted elsewhere.`)
