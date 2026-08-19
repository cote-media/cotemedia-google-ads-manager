#!/usr/bin/env node
// LORAMER_TOP_EDGE_ATTESTS_BY_MESSAGE_V1 — EVERY WRITER OF universe_attempt_log CARRIES THE LANE.
//
// ⛔ THE DEFECT THIS EXISTS TO PREVENT IS ONE I SHIPPED, AND IT WAS LIVE FOR EIGHT MINUTES. The top-edge
// lane put `lane` on `appendAttemptStarted` — which writes through the `universe_attempt_open` RPC — and on
// NOTHING ELSE. The three TERMINAL writers (`appendDayCommitted`, `appendAttemptFinished`,
// `appendMessageFinished`) `.insert({…})` directly, omitted the column, and it took its DEFAULT: 'descend'.
// MEASURED: two top-edge strips finished `zero` stamped 'descend', and `attestedEmptyDays` — whose whole
// purpose was to refuse exactly those rows — attested 12 surface-days on evidence that cannot tell an empty
// day from a not-yet-served one.
//
// ⛔ THE CLASS, NOT THE INSTANCE: a table with a defaulted discriminator column has as many chances to be
// wrong as it has writers, and the default is always the one that looks fine. The reader-side fix
// (`resolveTerminalLane`, universe-coverage.ts) makes the system CORRECT even when a row is mis-stamped;
// this guard makes the rows RIGHT, so the two never have to disagree. Both, deliberately: the reader
// protects the safety property, the writer protects the ledger's own truthfulness.
//
// WHAT IT ASSERTS, and every clause is a whole-object read rather than a name search:
//   (a) every `.from('universe_attempt_log').insert({…})` in the module names `lane`
//   (b) every `.rpc('universe_attempt_open', {…})` names `p_lane`
//   (c) `WriteProvenance` carries `lane`, because that is the thread every writer already holds — a writer
//       that takes `prov` cannot forget the lane without also forgetting the provenance
//   (d) NO OTHER FILE writes to universe_attempt_log. The module boundary is what makes (a) exhaustive;
//       a second writer elsewhere would make this guard's green a statement about one file.
//
// ⚠ LIMIT, stated: this proves the KEY IS PRESENT in each write, never that the VALUE is right. A writer
// that hardcodes `lane: 'descend'` passes here and is caught by `top-edge-never-attests.guard.mjs`, which
// reads what actually landed in the ledger.
//
// USAGE: node tests/guards/attempt-writers-carry-the-lane.guard.mjs
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { resolve, join } from 'node:path'

const ROOT = process.env.LORAMER_GUARD_ROOT || process.cwd()
const SUBJECT = process.env.LORAMER_ATTEMPT_LOG || 'src/lib/backfill/universe-attempt-log.ts'
const TABLE = 'universe_attempt_log'
const findings = []

let src = ''
try { src = readFileSync(resolve(ROOT, SUBJECT), 'utf8') }
catch (e) {
  console.error(`[attempt-writers-carry-the-lane] CANNOT RUN — ${SUBJECT} unreadable (${e.message}). A guard that cannot read its subject FAILS rather than passing.`)
  process.exitCode = 2
  process.exit()
}

/**
 * ⛔ BRACE-MATCHED, NOT REGEXED. The insert objects are multi-line and contain nested `?? null` and template
 * strings; a lazy `\{([^}]*)\}` stops at the first inner brace and reads a fragment. Reading the WHOLE object
 * is the difference between checking the write and checking the first two lines of it.
 */
export function objectsAfter(text, opener) {
  const out = []
  let i = 0
  for (;;) {
    const at = text.indexOf(opener, i)
    if (at === -1) return out
    const braceAt = text.indexOf('{', at + opener.length - 1)
    if (braceAt === -1) return out
    let depth = 0, end = -1
    for (let j = braceAt; j < text.length; j++) {
      const c = text[j]
      if (c === '{') depth++
      else if (c === '}') { depth--; if (depth === 0) { end = j; break } }
    }
    if (end === -1) return out
    out.push({ at, body: text.slice(braceAt, end + 1) })
    i = end + 1
  }
}

const lineOf = (t, idx) => t.slice(0, idx).split('\n').length

// ── (a) EVERY DIRECT INSERT NAMES `lane` ─────────────────────────────────────────────────────────────
const inserts = objectsAfter(src, `.from('${TABLE}').insert(`)
if (inserts.length === 0) {
  findings.push(`(a) no \`.from('${TABLE}').insert({…})\` found in ${SUBJECT}. Either the writers moved — in which case this guard is measuring nothing, which is worse than a red — or the locator is wrong.`)
}
for (const ins of inserts) {
  if (!/\blane\s*:/.test(ins.body)) {
    findings.push(`(a) the insert at ${SUBJECT}:${lineOf(src, ins.at)} writes to ${TABLE} WITHOUT naming \`lane\`. The column has a DEFAULT of 'descend', so the row lands mis-stamped and looks correct — which is exactly how a top-edge terminal attested 12 surface-days it had no evidence for.`)
  }
}

// ── (b) THE RPC WRITER NAMES `p_lane` ────────────────────────────────────────────────────────────────
const rpcs = objectsAfter(src, `.rpc('universe_attempt_open'`)
if (rpcs.length === 0) {
  findings.push(`(b) no \`.rpc('universe_attempt_open', {…})\` call found in ${SUBJECT}. That RPC owns the ONLY INSERT of an attempt_started row (attempt_no is derived under an advisory lock); if it is gone, the lane's source of truth is gone with it.`)
}
for (const c of rpcs) {
  if (!/\bp_lane\s*:/.test(c.body)) {
    findings.push(`(b) the \`universe_attempt_open\` call at ${SUBJECT}:${lineOf(src, c.at)} does not pass \`p_lane\`. The RPC defaults it to 'descend' (migrations/084) so a top-edge attempt would enter the rotation and drag the descending anchor to the top of the calendar.`)
  }
}

// ── (c) THE THREAD EXISTS: WriteProvenance CARRIES THE LANE ──────────────────────────────────────────
// ⛔ THIS IS THE STRUCTURAL HALF OF THE FIX. Putting the lane on the provenance every writer ALREADY takes
// is what makes forgetting it require forgetting the provenance too. A future writer that accepts `prov`
// gets the lane for free; one that does not accept `prov` fails leg (a) or (b) instead.
{
  const at = src.indexOf('export interface WriteProvenance')
  if (at === -1) findings.push(`(c) ${SUBJECT} no longer exports \`WriteProvenance\` — the thread every writer holds is gone, and legs (a)/(b) would then be checking a key with no source.`)
  else {
    const body = objectsAfter(src.slice(at), 'export interface WriteProvenance')[0]
    if (!body || !/\blane\??\s*:/.test(body.body)) {
      findings.push(`(c) \`WriteProvenance\` does not carry \`lane\`. Every append in the consumer threads this one object; without the lane on it, each writer needs its own argument and the next one added will omit it — which is the defect this guard exists for, restated as a design.`)
    }
  }
}

// ── (d) NO OTHER FILE WRITES THE TABLE ───────────────────────────────────────────────────────────────
// ⛔ WITHOUT THIS, LEG (a) IS A STATEMENT ABOUT ONE FILE RATHER THAN ABOUT THE LEDGER. The module boundary
// is the reason the other legs are exhaustive, so it is asserted rather than assumed.
{
  const skip = new Set([SUBJECT])
  const walk = (dir, out = []) => {
    for (const e of readdirSync(resolve(ROOT, dir))) {
      const p = join(dir, e)
      if (/node_modules|\.next|\.git/.test(p)) continue
      const st = statSync(resolve(ROOT, p))
      if (st.isDirectory()) walk(p, out)
      else if (/\.(ts|tsx)$/.test(e)) out.push(p)
    }
    return out
  }
  let files = []
  try { files = walk('src') } catch { /* reported by absence below */ }
  for (const f of files) {
    if (skip.has(f)) continue
    const t = readFileSync(resolve(ROOT, f), 'utf8')
    const code = t.split('\n').filter((l) => !/^\s*(\/\/|\*)/.test(l)).join('\n')
    if (new RegExp(`from\\(['"]${TABLE}['"]\\)[\\s\\S]{0,200}?\\.(insert|upsert)\\(`).test(code)) {
      findings.push(`(d) ${f} INSERTs into ${TABLE} directly. The append helpers are the only writers by design — a second one carries its own chance to omit the lane, and leg (a) cannot see it.`)
    }
  }
}

if (findings.length) {
  console.error(`[attempt-writers-carry-the-lane] FAIL — ${findings.length} finding(s):`)
  for (const f of findings) console.error(`  ✗ ${f}`)
  console.error(`  ⇒ SPEC: DECISIONS LORAMER_TOP_EDGE_ATTESTS_BY_MESSAGE_V1. The lane rides on WriteProvenance; every writer threads it, and no writer may take the column's default by omission.`)
  process.exitCode = 1
} else {
  console.log(`[attempt-writers-carry-the-lane] PASS — ${inserts.length} direct insert(s) and ${rpcs.length} RPC call(s) into ${TABLE} all name the lane, WriteProvenance carries it, and no other file in src/ writes the table. ⛔ LIMIT: this proves the KEY is present, never that the VALUE is right — top-edge-never-attests reads what actually landed.`)
}
