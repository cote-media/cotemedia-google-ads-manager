#!/usr/bin/env node
// LORAMER_ACCOUNT_ROW_PROVENANCE_V1 — THE ONE ACCOUNT PRODUCER STATES EVERY ROW'S ORIGIN, AND THE BIT IT
// USED TO DISCARD IS KEPT.
//
// ⛔ THE DEFECT THIS PINS, read at google-account-row.ts:95 on 2026-09-04:
//     out.push(byDate.get(d) ?? { date: d, spend: 0, ... })
// The `??` branches on whether Google returned a row for that date — and the pushed object carried no trace
// of which branch fired. Downstream, a vendor-served $0.00 and a writer-filled $0.00 were byte-identical rows,
// so no reader (the hole enumerator's tier, guard B's data leg, the forward-day check) could ever separate
// them. Google omits zero-metric rows ALWAYS in segmented GAQL (measured 2026-08-26), so the fill is ours by
// necessity — which is exactly why the row must SAY so.
//
// ⛔ A NEW GUARD, NOT A LEG ON google-forward-must-restate. That guard's subject is "there is ONE producer and
// it restates"; this one's is "what the one producer stamps". A red on a shared guard would not say which.
//
// LEGS (every one proven RED first against the pre-stamp producer, 2026-09-05):
//   (a) buildGoogleAccountRows takes `lane: AccountRowLane`, REQUIRED, no default; the type is EXACTLY the
//       four values 'forward' | 'catchup' | 'backfill' | 'fill'. An unknown lane is a build error, never 'forward'.
//   (b) EVERY call site in src/ passes a STRING LITERAL from that enum as the lane — never a variable — and
//       the three live lanes (forward · catchup · backfill) each have a caller. A variable would let a lane be
//       "computed" from a default somewhere else; a literal is a decision at the call site.
//   (c) GoogleAccountDay carries `vendorRow: boolean`; the vendor branch sets true, the `??` zero-fill sets
//       false, and nothing defaults it.
//   (d) `provenance` on this producer is a TEXT conditional between exactly PROVENANCE_VENDOR and
//       PROVENANCE_ZERO_FILLED (both owned by the walk writer, both string literals) — never an object, never
//       a third value. `provenance` is read as TEXT by migration 067 and by universe-derived-time.guard.mjs;
//       two types under one key across rows is the canonical-key-spelling class.
//   (e) the stamp carries `vendorRow`, `observedAt`, and `lane` beside the six ratios, and the producer never
//       defaults `lane`.
//   (f) this guard is registered in scripts/run-guards.mjs — an unregistered guard never runs.
//
// LIMITS, named: (b) is a source parse, not a runtime trace — a call reached through a wrapper that forwards
// a literal is still a literal here. (c)/(d) check the SHAPE of the expressions, not their evaluation.
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { resolve, join } from 'node:path'

const ROOT = process.env.LORAMER_GUARD_ROOT || process.cwd()
const findings = []
const read = (rel) => {
  try { return readFileSync(resolve(ROOT, rel), 'utf8') }
  catch (e) { findings.push(`UNREADABLE ${rel} — ${e.message}. A guard that cannot read its evidence FAILS.`); return '' }
}
const strip = (src) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1')

const PRODUCER = 'src/lib/intelligence/google-account-row.ts'
const WRITER = 'src/lib/backfill/google-ads-universe-writer.ts'
const LANES = ['forward', 'catchup', 'backfill', 'fill']
const LIVE_LANES = ['forward', 'catchup', 'backfill']

const producerRaw = read(PRODUCER)
const producer = strip(producerRaw)
const writer = strip(read(WRITER))

// ── (a) THE LANE IS REQUIRED, TYPED, AND EXACTLY FOUR VALUES ─────────────────────────────────────────
{
  const typeM = producer.match(/export\s+type\s+AccountRowLane\s*=\s*([^\n]+)/)
  if (!typeM) findings.push(`(a) ${PRODUCER} exports no \`AccountRowLane\` type — the lane vocabulary is not pinned.`)
  else {
    const got = [...typeM[1].matchAll(/'([a-z]+)'/g)].map((m) => m[1]).sort()
    const want = [...LANES].sort()
    if (got.join('|') !== want.join('|')) findings.push(`(a) AccountRowLane is (${got.join(' | ')}); expected exactly (${want.join(' | ')}). A lane that is not in the enum has no writer; a writer that is not in the enum has no name.`)
  }
  const sig = producer.match(/export\s+function\s+buildGoogleAccountRows\s*\(([\s\S]*?)\)\s*:/)
  if (!sig) findings.push(`(a) ${PRODUCER} has no exported buildGoogleAccountRows signature to check.`)
  else {
    if (!/\blane\s*:\s*AccountRowLane\b/.test(sig[1])) findings.push(`(a) buildGoogleAccountRows does not take \`lane: AccountRowLane\` — the caller cannot say which writer it is, so the row cannot either.`)
    if (/\blane\s*\??\s*:\s*AccountRowLane\s*=/.test(sig[1]) || /\blane\s*\?\s*:/.test(sig[1])) findings.push(`(a) buildGoogleAccountRows DEFAULTS or makes optional its lane — an unknown lane is a build error, never 'forward'.`)
  }
}

// ── (b) EVERY CALL SITE PASSES A LANE LITERAL FROM THE ENUM; ALL THREE LIVE LANES HAVE A CALLER ───────
function tsFiles(dir, out = []) {
  let entries = []
  try { entries = readdirSync(resolve(ROOT, dir)) } catch { return out }
  for (const name of entries) {
    const rel = join(dir, name)
    let st; try { st = statSync(resolve(ROOT, rel)) } catch { continue }
    if (st.isDirectory()) { if (name !== 'node_modules' && name !== '.next') tsFiles(rel, out) }
    else if (/\.tsx?$/.test(name)) out.push(rel)
  }
  return out
}
/** Balanced argument list starting just after `(`; returns the top-level args. Strings and nesting respected. */
function topLevelArgs(src, openIdx) {
  let depth = 0, i = openIdx, cur = '', args = [], q = null
  for (; i < src.length; i++) {
    const ch = src[i]
    if (q) { cur += ch; if (ch === '\\') { cur += src[++i]; continue } if (ch === q) q = null; continue }
    if (ch === '\'' || ch === '"' || ch === '`') { q = ch; cur += ch; continue }
    if ('([{'.includes(ch)) { depth++; if (depth === 1 && ch === '(' && i === openIdx) continue; cur += ch; continue }
    // A trailing comma before `)` is legal TS and leaves an empty final arg — drop it, never read it as a lane.
    if (')]}'.includes(ch)) { depth--; if (depth === 0) { if (cur.trim() !== '' || args.length === 0) args.push(cur.trim()); return args } cur += ch; continue }
    if (ch === ',' && depth === 1) { args.push(cur.trim()); cur = ''; continue }
    cur += ch
  }
  return null
}
{
  const seen = new Set()
  let sites = 0
  for (const rel of tsFiles('src')) {
    if (rel === PRODUCER) continue
    const code = strip(read(rel))
    let idx = 0
    while ((idx = code.indexOf('buildGoogleAccountRows(', idx)) !== -1) {
      const open = idx + 'buildGoogleAccountRows'.length
      const args = topLevelArgs(code, open)
      idx = open + 1
      if (!args) { findings.push(`(b) ${rel}: could not parse the argument list of a buildGoogleAccountRows call.`); continue }
      sites++
      const last = args[args.length - 1]
      const m = last.match(/^'([a-z]+)'$/)
      if (!m) findings.push(`(b) ${rel}: buildGoogleAccountRows(...) passes \`${last.slice(0, 60)}\` as its lane — not a string literal. The lane is a DECISION at the call site, never a variable that could carry a default.`)
      else if (!LANES.includes(m[1])) findings.push(`(b) ${rel}: lane literal '${m[1]}' is not in the enum (${LANES.join(' | ')}).`)
      else seen.add(m[1])
    }
  }
  if (sites === 0) findings.push(`(b) NO call site of buildGoogleAccountRows found outside the producer — either the producer lost its callers or the guard is blind. Neither passes.`)
  for (const l of LIVE_LANES) if (!seen.has(l)) findings.push(`(b) no call site passes lane '${l}' — the ${l} lane writes account rows (verified 2026-09-04: cron/sync, cron/catchup, backfill/adapters.ts) and must say so.`)
}

// ── (c) THE SERVED-VS-FILLED BIT IS KEPT, NEVER DEFAULTED ─────────────────────────────────────────────
{
  const iface = producer.match(/export\s+interface\s+GoogleAccountDay\s*\{([\s\S]*?)\}/)
  if (!iface || !/\bvendorRow\s*:\s*boolean\b/.test(iface[1])) findings.push(`(c) GoogleAccountDay carries no \`vendorRow: boolean\` — the bit line 95 branches on is still discarded.`)
  const trues = (producer.match(/vendorRow\s*:\s*true\b/g) || []).length
  const falses = (producer.match(/vendorRow\s*:\s*false\b/g) || []).length
  if (trues !== 1) findings.push(`(c) expected exactly ONE \`vendorRow: true\` (the vendor branch, inside byDate.set) in ${PRODUCER}; found ${trues}.`)
  if (falses !== 1) findings.push(`(c) expected exactly ONE \`vendorRow: false\` (the \`??\` zero-fill) in ${PRODUCER}; found ${falses}.`)
  if (!/byDate\.set\([\s\S]*?vendorRow\s*:\s*true/.test(producer)) findings.push(`(c) the vendor branch (byDate.set) does not set vendorRow: true.`)
  if (!/\?\?\s*\{[^}]*vendorRow\s*:\s*false/.test(producer)) findings.push(`(c) the \`??\` zero-fill literal does not set vendorRow: false — the fill is not labelled as ours.`)
  if (/vendorRow\s*\?\?/.test(producer) || /vendorRow\s*=\s*(true|false)/.test(producer)) findings.push(`(c) vendorRow is defaulted or reassigned somewhere in ${PRODUCER} — it is set at the branch and nowhere else.`)
}

// ── (d) PROVENANCE IS TEXT, TWO VALUES, OWNED BY THE WRITER ────────────────────────────────────────────
{
  const provs = producer.match(/\bprovenance\s*:/g) || []
  if (provs.length !== 1) findings.push(`(d) expected exactly one \`provenance:\` in ${PRODUCER}; found ${provs.length}.`)
  if (/\bprovenance\s*:\s*\{/.test(producer)) findings.push(`(d) \`provenance\` is an OBJECT in ${PRODUCER} — it is TEXT everywhere else in the warehouse (migration 067, universe-derived-time.guard.mjs). Two types under one key is a second spelling.`)
  if (!/\bprovenance\s*:\s*d\.vendorRow\s*\?\s*PROVENANCE_VENDOR\s*:\s*PROVENANCE_ZERO_FILLED\b/.test(producer)) {
    findings.push(`(d) \`provenance\` is not \`d.vendorRow ? PROVENANCE_VENDOR : PROVENANCE_ZERO_FILLED\` — the value must be exactly one of the writer's two text constants, chosen by the kept bit.`)
  }
  if (!/import\s*\{[^}]*\bPROVENANCE_VENDOR\b[^}]*\bPROVENANCE_ZERO_FILLED\b[^}]*\}\s*from\s*['"]@\/lib\/backfill\/google-ads-universe-writer['"]/.test(producer)
    && !/import\s*\{[^}]*\bPROVENANCE_ZERO_FILLED\b[^}]*\bPROVENANCE_VENDOR\b[^}]*\}\s*from\s*['"]@\/lib\/backfill\/google-ads-universe-writer['"]/.test(producer)) {
    findings.push(`(d) ${PRODUCER} does not import PROVENANCE_VENDOR and PROVENANCE_ZERO_FILLED from ${WRITER} — the vocabulary has one owner and this is not it.`)
  }
  if (!/export\s+const\s+PROVENANCE_VENDOR\s*=\s*'VENDOR_REPORTED'/.test(writer)) findings.push(`(d) ${WRITER} does not define PROVENANCE_VENDOR = 'VENDOR_REPORTED'.`)
  if (!/export\s+const\s+PROVENANCE_ZERO_FILLED\s*=\s*'ZERO_FILLED_VENDOR_OMITTED'/.test(writer)) findings.push(`(d) ${WRITER} does not define PROVENANCE_ZERO_FILLED = 'ZERO_FILLED_VENDOR_OMITTED' — the zero-fill has no name.`)
}

// ── (e) THE STAMP IS COMPLETE AND THE LANE IS NEVER DEFAULTED ─────────────────────────────────────────
{
  const extra = producer.match(/extra\s*:\s*\{([\s\S]*?)\n\s*\}/)
  if (!extra) findings.push(`(e) ${PRODUCER} has no extra literal to inspect.`)
  else {
    for (const k of ['ctr', 'cpc', 'cpm', 'roas', 'cpa', 'convRate', 'vendorRow', 'observedAt', 'lane']) {
      if (!new RegExp(`(^|[\\s,{])${k}\\s*[:,\\n]`).test(extra[1]) && !new RegExp(`(^|[\\s,{])${k}\\s*$`, 'm').test(extra[1])) findings.push(`(e) the account row's extra literal lacks \`${k}\`.`)
    }
  }
  if (/\blane\s*\?\?/.test(producer) || /\?\?\s*'(forward|catchup|backfill|fill)'/.test(producer)) findings.push(`(e) ${PRODUCER} defaults the lane — an unknown lane is UNKNOWN, not 'forward'.`)
}

// ── (f) REGISTERED ────────────────────────────────────────────────────────────────────────────────────
{
  const roster = read('scripts/run-guards.mjs')
  if (roster && !roster.includes('tests/guards/google-account-row-provenance.guard.mjs')) findings.push(`(f) this guard is not registered in scripts/run-guards.mjs — an unregistered guard never runs.`)
}

if (findings.length) {
  console.error(`[google-account-row-provenance] FAIL — ${findings.length} finding(s):`)
  for (const f of findings) console.error(`  - ${f}`)
  process.exit(1)
}
console.log(`[google-account-row-provenance] PASS — (a) lane is REQUIRED and typed to exactly ${LANES.join(' | ')} · (b) every call site passes a lane LITERAL and all three live lanes have a caller · (c) vendorRow is set true on the vendor branch and false on the \`??\` zero-fill, never defaulted · (d) provenance is TEXT, exactly PROVENANCE_VENDOR | PROVENANCE_ZERO_FILLED, owned by the writer · (e) the stamp carries vendorRow, observedAt and lane beside the six unchanged ratios, and the lane is never defaulted · (f) registered. LIMIT: (b) is a source parse, not a runtime trace.`)
