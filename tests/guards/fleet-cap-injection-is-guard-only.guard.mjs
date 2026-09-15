#!/usr/bin/env node
// LORAMER_CAP_FOLLOWS_GRANT_V1 — THE CAP/ALLOCATION OVERRIDE IS A TEST HANDLE AND MAY NEVER BECOME A DIAL.
//
// ⛔ WHY THIS EXISTS, AND IT IS THE PRICE OF THE HANDLE RATHER THAN AN AFTERTHOUGHT. Standard access removed
// Google's daily operations cap, so `LANE_ALLOCATIONS` is all-null and the fleet-ceiling and lane-allocation
// branches of `decideBudget` became UNREACHABLE from the module defaults. A branch no test can reach is a
// branch that rots, so `decideBudget(lane, spend, { cap, allocations })` now lets the guard drive both
// regimes — a finite cap with finite lane shares, and today's unlimited one.
//
// ⛔ AND THAT HANDLE IS EXACTLY HOW A CAP COMES BACK BY THE SIDE DOOR. One production call site passing
// `{ cap: 12_000 }` would re-impose a ceiling nobody derived, in a file nobody reads, with no decision behind
// it — the "finite number is a fiction" failure the grant flight refused on purpose. The header of
// `google-op-budget.ts` asserts that nothing in src/ may pass either option; A LAW IS NOT BANKED UNTIL IT CAN
// FAIL A BUILD, so this is that law as a build failure rather than a sentence.
//
// THE RULE: inside src/, a call to `decideBudget(...)` may pass at most TWO arguments. `cap`, `allocations`
// and `multiplier` are guard-only. tests/ and scripts/ are free to pass them — that is what they are for.
//
// ⛔ ALSO PINNED HERE, because the two would otherwise drift apart silently: the live table may only ever hold
// `null` (no daily-ops limit) or `0` (stopped by decision). A finite non-zero lane share is a self-imposed
// ceiling, and it would re-create holds at a new arbitrary boundary with no derivation anywhere.
//
// HERMETIC: file reads only. No network, no database. Classifier proven on fixtures before the tree is read.
// USAGE: node tests/guards/fleet-cap-injection-is-guard-only.guard.mjs   EXIT 0 green · 1 findings · 2 broken
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, resolve, dirname, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')
const OWNER = 'src/lib/backfill/google-op-budget.ts'
const findings = []
const read = (p) => { try { return readFileSync(resolve(ROOT, p), 'utf8') } catch { return '' } }
const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, (c) => c.replace(/[^\n]/g, '')).replace(/(^|[^:'"`])\/\/[^\n]*/g, '$1')

/** Index of the matching close paren for the open paren at `i`, skipping strings. -1 if unbalanced. */
function matchParen(src, i) {
  let depth = 0, q = null
  for (let j = i; j < src.length; j++) {
    const ch = src[j]
    if (q) { if (ch === '\\') { j++; continue } if (ch === q) q = null; continue }
    if (ch === '"' || ch === "'" || ch === '`') { q = ch; continue }
    if (ch === '(') depth++
    else if (ch === ')') { depth--; if (depth === 0) return j }
  }
  return -1
}
/** Split a call's argument list on TOP-LEVEL commas only — a nested object or array must not read as two args. */
function topLevelArgs(inner) {
  const out = []
  let depth = 0, q = null, cur = ''
  for (let i = 0; i < inner.length; i++) {
    const ch = inner[i]
    if (q) { cur += ch; if (ch === '\\') { cur += inner[++i] ?? ''; continue } if (ch === q) q = null; continue }
    if (ch === '"' || ch === "'" || ch === '`') { q = ch; cur += ch; continue }
    if ('([{'.includes(ch)) depth++
    else if (')]}'.includes(ch)) depth--
    if (ch === ',' && depth === 0) { out.push(cur.trim()); cur = ''; continue }
    cur += ch
  }
  if (cur.trim()) out.push(cur.trim())
  return out
}

/** Pure. Findings for one src/ file's text. */
export function auditText(text, label) {
  const out = []
  const src = strip(text)
  const re = /\bdecideBudget\s*\(/g
  let m
  while ((m = re.exec(src))) {
    // ⛔ THE DECLARATION IS NOT A CALL. `export function decideBudget(lane, spend, opts)` has three parameters
    // BY DESIGN — that is the handle being defined. Matching it would make the owner file permanently red and
    // the guard would be deleted within a day for crying wolf about the thing it exists to protect.
    if (/\bfunction\s+$/.test(src.slice(Math.max(0, m.index - 20), m.index))) continue
    const open = m.index + m[0].length - 1
    const close = matchParen(src, open)
    if (close < 0) continue
    const args = topLevelArgs(src.slice(open + 1, close))
    if (args.length > 2) {
      const line = src.slice(0, m.index).split('\n').length
      out.push(`${label}:${line} — decideBudget() is called with ${args.length} arguments. The third (\`{ cap, allocations, multiplier }\`) is a GUARD HANDLE: passing it from src/ re-imposes a daily ceiling nobody derived, in a file nobody reads. Third arg: ${args[2].slice(0, 80)}`)
    }
  }
  return out
}

// ── (a) THE CLASSIFIER ON FIXTURES FIRST ─────────────────────────────────────────────────────────────────
{
  const fx = [
    ['two args is the production shape', 'const b = decideBudget(lane, spend)\n', 0],
    ['three args is a finding', 'const b = decideBudget(lane, spend, { cap: 12000 })\n', 1],
    ['a nested object must not read as two args', 'const b = decideBudget(lane, { byLane: { a: 1, b: 2 }, unattributedRaw: 0 })\n', 0],
    ['a nested array must not read as two args', 'const b = decideBudget(lane, mk([1, 2, 3]))\n', 0],
    ['a comma inside a string is not an argument break', "const b = decideBudget(lane, spend, { reason: 'a, b' })\n", 1],
    ['only in a comment is not a call', '// decideBudget(lane, spend, { cap: 1 })\nconst x = 1\n', 0],
    ['multi-line three-arg call', 'const b = decideBudget(\n  lane,\n  spend,\n  { allocations: T },\n)\n', 1],
    ['a different function is not matched', 'const b = notDecideBudgetAtAll(a, b, c)\n', 0],
    ['the DECLARATION of the handle is not a call', 'export function decideBudget(lane, spend, opts = {}) { return 1 }\n', 0],
  ]
  for (const [name, text, expect] of fx) {
    const got = auditText(text, `fixture:${name}`).length
    if (got !== expect) findings.push(`(a) classifier fixture "${name}" produced ${got} finding(s), expected ${expect} — the audit cannot be trusted on real files`)
  }
  if (findings.length) {
    for (const f of findings) console.error(`✗ ${f}`)
    console.error(`[fleet-cap-injection] BROKEN INSTRUMENT — ${findings.length} classifier fixture(s) failed; the tree was NOT read.`)
    process.exit(2)
  }
}

// ── (b) THE OWNER STILL DECLARES THE HANDLE AS GUARD-ONLY ────────────────────────────────────────────────
{
  const owner = read(OWNER)
  if (!owner) findings.push(`(b) ${OWNER} could not be read — the fact has no home.`)
  else if (!/allocations\?:\s*Record<BudgetLane,\s*number \| null>/.test(owner)) {
    findings.push(`(b) ${OWNER} no longer declares the \`allocations\` override. If the handle was removed, delete this guard in the same commit; if it was renamed, this guard is now blind.`)
  }
}

// ── (c) THE LIVE TABLE: null OR 0, NEVER A FINITE SHARE ──────────────────────────────────────────────────
{
  const owner = strip(read(OWNER))
  const block = owner.match(/export const LANE_ALLOCATIONS[^{]*\{([\s\S]*?)\n\}/)
  if (!block) findings.push(`(c) LANE_ALLOCATIONS not found in ${OWNER} — the table's shape cannot be checked.`)
  else {
    for (const line of block[1].split('\n')) {
      const t = line.match(/^\s*([a-z]+):\s*([A-Za-z0-9_]+)/)
      if (!t) continue
      const [, lane, val] = t
      if (val === 'null' || val === '0') continue
      // A named constant is fine only if that constant is itself null.
      const named = owner.match(new RegExp(`export const ${val}\\s*(?::[^=]+)?=\\s*([A-Za-z0-9_]+)`))
      const resolved = named ? named[1] : null
      if (resolved === 'null' || resolved === 'GOOGLE_DAILY_OP_CAP') continue
      findings.push(`(c) LANE_ALLOCATIONS.${lane} = ${val}${resolved ? ` (= ${resolved})` : ''}. Under Standard access a lane is either null (no daily-ops limit) or 0 (stopped by decision). A finite non-zero share is a self-imposed ceiling with no derivation — the constant class this repo refuses.`)
    }
  }
}

// ── (d) THE REAL TREE — src/ ONLY ────────────────────────────────────────────────────────────────────────
const files = []
const walk = (dir) => {
  let names
  try { names = readdirSync(dir) } catch { return }
  for (const n of names) {
    const p = join(dir, n)
    let st
    try { st = statSync(p) } catch { continue }
    if (st.isDirectory()) { if (n !== 'node_modules') walk(p) }
    else if (/\.(ts|tsx)$/.test(n)) files.push(p)
  }
}
walk(join(ROOT, 'src'))
files.sort()
let scanned = 0
for (const abs of files) {
  const rel = relative(ROOT, abs).split('\\').join('/')
  scanned++
  findings.push(...auditText(readFileSync(abs, 'utf8'), rel))
}

if (findings.length) {
  for (const f of findings) console.error(`✗ ${f}`)
  console.error(`[fleet-cap-injection] FAIL — ${findings.length} finding(s). The cap/allocation override is a guard handle; production code may not re-impose a daily ceiling through it.`)
  process.exit(1)
}
console.log(`[fleet-cap-injection] PASS — no src/ call passes decideBudget a cap/allocations override (${scanned} file(s) scanned), the owner still declares the handle as guard-only, and every live lane allocation is null (unlimited) or 0 (stopped by decision). Classifier proven on 9 fixtures first. BLIND SPOT: a cap re-imposed somewhere other than this option — a new gate in a new file — is not visible here.`)
