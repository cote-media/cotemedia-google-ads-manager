#!/usr/bin/env node
// LORAMER_CONVERSION_ACTION_ATTRIBUTE_ONLY_V1 — THE conversion_action READ IS ATTRIBUTE-ONLY, AND IT STAYS THAT WAY.
//
// ── WHY ─────────────────────────────────────────────────────────────────────────────────────────────────────────
// `metrics.conversions FROM conversion_action` is refused by Google at validation: {"query_error":49} "Cannot select
// or filter on the following metrics: 'conversions' (could not support requested resources: 'CONVERSION_ACTION')".
// The v23 field reference serves exactly FOUR metrics on this resource (all_conversions, all_conversions_value,
// conversion_last_conversion_date, conversion_last_received_request_date_time) and FOUR segments (date, week, month,
// quarter) — and our own 2026-08-03 GoogleAdsFieldService pull recorded the same counts. The intelligence layer's
// conversion_action query carried `metrics.conversions` from its birth (df58e8a, 2026-05-20); safeQuery swallowed the
// refusal to [] on EVERY forward fire (measured ≥ 2026-07-27: cron_runs google forward error_count = 2 × attempted,
// daily), so intel.conversionActions was always empty, the slice-1 extractor never saw a row, entity_state_history
// held 0 conversion_action rows, and the lookback lane's boundary — read from that store — was UNKNOWN on every
// account (★CONVERSION-ACTION-CAPTURE-DARK). A metric-compat refusal fires BEFORE any attribute is read, so a query
// that carries the boundary's attributes must carry NOTHING a compat rule can refuse: no metrics, no segments, no
// runtime interpolation of any kind.
//
// ── THE ASSERTION ───────────────────────────────────────────────────────────────────────────────────────────────
//   1. CLASS: every backtick template in src/**/*.ts|tsx + mcp-server.js that matches /FROM\s+conversion_action\b/
//      contains no `metrics.`, no `segments.`, and no `${` (any interpolation) — RED otherwise.
//   2. DENOMINATOR: at least one such template exists — ZERO is RED ("the read itself is gone"), because a deleted
//      read looks exactly like a passing one to a scan that only bans.
//   3. POSITIVE PIN: exactly one such template, and its SELECT names ALL TEN attributes below and NOTHING ELSE.
// The verdict line carries the denominator (templates judged, files scanned). Exit 1 on any red, 0 on green, 2 when
// the guard cannot run or its own self-test fails.
//
// ── HONEST LIMIT ────────────────────────────────────────────────────────────────────────────────────────────────
// STATIC SOURCE READ. Templates are backtick-delimited; a template nested inside `${…}` would split the outer one —
// but `${` is itself red here, so that shape cannot hide. It proves the SHAPE of the query, never that Google
// accepts it: Gate-A on the real API did that (2026-09-09, 2 requests, Foam OH + Escential).
//
// USAGE: node tests/guards/conversion-action-attribute-only.guard.mjs
//        [--inject-metrics | --inject-segment | --inject-interpolation | --remove-query | --split-from]
//        Each flag mutates an IN-MEMORY copy of the real google-intelligence.ts (never the tree) and judges that:
//        the four inject/remove flags must read RED; --split-from must still count 1 of 1.
import { readFileSync, readdirSync, statSync } from 'node:fs'
import path from 'node:path'

const ROOT = process.env.LORAMER_GUARD_ROOT || process.cwd()
const OWNER_FILE = 'src/lib/intelligence/google-intelligence.ts'
const TAG = '[conversion-action-attribute-only]'

export const TEN_ATTRIBUTES = [
  'id', 'name', 'category', 'status', 'type', 'include_in_conversions_metric',
  'click_through_lookback_window_days', 'view_through_lookback_window_days', 'primary_for_goal', 'counting_type',
]
const FROM_RE = /FROM\s+conversion_action\b/
const TEMPLATE_RE = /`[^`]*`/g

// ── PURE CORE ───────────────────────────────────────────────────────────────────────────────────────────────────
/** files: [{ rel, text }]. Returns { findings, templates, files } — templates is the denominator. */
export function judge(files) {
  const findings = []
  const hits = []
  for (const { rel, text } of files) {
    TEMPLATE_RE.lastIndex = 0
    for (let m; (m = TEMPLATE_RE.exec(text)); ) {
      const t = m[0]
      if (!FROM_RE.test(t)) continue
      const line = text.slice(0, m.index).split('\n').length
      hits.push({ rel, line, t })
      const bad = []
      if (/metrics\./.test(t)) bad.push('metrics.')
      if (/segments\./.test(t)) bad.push('segments.')
      if (t.includes('${')) bad.push('${…} interpolation')
      if (bad.length) {
        findings.push(`${rel}:${line} — the FROM conversion_action template carries ${bad.join(' + ')}. Google refuses this class at validation (query_error 49/53) BEFORE any attribute is read; the read must be attribute-only.`)
      }
    }
  }
  if (hits.length === 0) {
    findings.push(`0 FROM conversion_action templates in the scanned tree — the read itself is gone. The lookback boundary is read from entity_state_history rows that ONLY this query produces; a deleted read is a dark capture, not a clean scan.`)
  } else {
    if (hits.length !== 1) findings.push(`${hits.length} FROM conversion_action templates (${hits.map((h) => `${h.rel}:${h.line}`).join(', ')}) — the pin is exactly ONE, in ${OWNER_FILE}. One writer per surface; a second read is a second spelling waiting to drift.`)
    for (const h of hits) {
      const sel = (h.t.match(/SELECT([\s\S]*?)FROM\s+conversion_action\b/) || [])[1]
      if (sel === undefined) { findings.push(`${h.rel}:${h.line} — no SELECT … FROM conversion_action clause could be read from the template.`); continue }
      const named = [...sel.matchAll(/conversion_action\.([a-z_]+)/g)].map((x) => x[1])
      const missing = TEN_ATTRIBUTES.filter((f) => !named.includes(f))
      const extra = named.filter((f) => !TEN_ATTRIBUTES.includes(f))
      const foreign = sel.replace(/conversion_action\.[a-z_]+/g, '').replace(/[\s,]/g, '')
      if (missing.length) findings.push(`${h.rel}:${h.line} — SELECT is missing ${missing.length} of the ten pinned attributes: ${missing.join(', ')}.`)
      if (extra.length) findings.push(`${h.rel}:${h.line} — SELECT names conversion_action attribute(s) outside the pinned ten: ${extra.join(', ')} — widen the pin in this guard in the same commit, or drop the field.`)
      if (foreign) findings.push(`${h.rel}:${h.line} — SELECT carries non-attribute token(s): ${foreign.slice(0, 80)} — attributes only; anything else is what Google refuses.`)
    }
  }
  return { findings, templates: hits.length, files: files.length }
}

export function verdictLine(r) {
  return r.findings.length === 0
    ? `${TAG} GREEN — ${r.templates} of ${r.templates} FROM conversion_action template(s) attribute-only, ${TEN_ATTRIBUTES.length}/${TEN_ATTRIBUTES.length} attributes pinned, ${r.files} file(s) scanned.`
    : `${TAG} RED — ${r.findings.length} finding(s) over ${r.templates} FROM conversion_action template(s), ${r.files} file(s) scanned:\n  · ${r.findings.join('\n  · ')}`
}

// ── BUILT-IN FIXTURES — the predicate proves itself on every run before it judges the tree ─────────────────────
const GOOD = '`SELECT conversion_action.id, conversion_action.name, conversion_action.category,\n conversion_action.status, conversion_action.type, conversion_action.include_in_conversions_metric,\n conversion_action.click_through_lookback_window_days, conversion_action.view_through_lookback_window_days,\n conversion_action.primary_for_goal, conversion_action.counting_type\n FROM conversion_action\n WHERE conversion_action.status = \'ENABLED\'`'
const fixtures = [
  { name: 'attribute-only ten', text: GOOD, want: true },
  { name: 'metrics.', text: GOOD.replace('SELECT ', 'SELECT metrics.all_conversions, '), want: false },
  { name: 'segments.', text: GOOD.replace('SELECT ', 'SELECT segments.date, '), want: false },
  { name: 'interpolation', text: GOOD.replace('WHERE ', 'WHERE ${dateFilter} AND '), want: false },
  { name: 'missing attribute', text: GOOD.replace('conversion_action.counting_type', 'conversion_action.status'), want: false },
  { name: 'zero templates', text: 'const x = []', want: false },
  { name: 'FROM split across lines', text: GOOD.replace('FROM conversion_action', 'FROM\n    conversion_action'), want: true },
]
for (const f of fixtures) {
  const r = judge([{ rel: 'fixture.ts', text: f.text }])
  const ok = r.findings.length === 0
  if (ok !== f.want) {
    console.error(`✗ ${TAG} SELF-TEST FAILED — fixture "${f.name}" expected ${f.want ? 'GREEN' : 'RED'}, got ${ok ? 'GREEN' : 'RED'}${ok ? '' : ` (${r.findings[0]})`}`)
    process.exit(2)
  }
}

// ── THE TREE ────────────────────────────────────────────────────────────────────────────────────────────────────
function walk(dir, out) {
  for (const name of readdirSync(dir)) {
    const p = path.join(dir, name)
    const st = statSync(p)
    if (st.isDirectory()) { if (name !== 'node_modules') walk(p, out) }
    else if (/\.tsx?$/.test(name)) out.push(p)
  }
  return out
}
let files
try {
  const abs = walk(path.resolve(ROOT, 'src'), [])
  const mcp = path.resolve(ROOT, 'mcp-server.js')
  try { statSync(mcp); abs.push(mcp) } catch { /* mcp-server.js absent on this tree — scanned set says so in the count */ }
  files = abs.map((p) => ({ rel: path.relative(ROOT, p), text: readFileSync(p, 'utf8') }))
} catch (e) {
  console.error(`✗ ${TAG} CANNOT RUN — ${e.message}`)
  process.exit(2)
}

// ── FLAGS — in-memory mutation of the real owner file, never the tree ──────────────────────────────────────────
const argv = process.argv.slice(2)
const flag = argv.find((a) => a.startsWith('--'))
if (flag) {
  const owner = files.find((f) => f.rel === OWNER_FILE)
  if (!owner) { console.error(`✗ ${TAG} CANNOT SELF-TEST — ${OWNER_FILE} not found in the scanned tree.`); process.exit(2) }
  const tmpl = (owner.text.match(TEMPLATE_RE) || []).find((t) => FROM_RE.test(t))
  if (!tmpl) { console.error(`✗ ${TAG} CANNOT SELF-TEST — no FROM conversion_action template in ${OWNER_FILE} to mutate.`); process.exit(2) }
  let mutated, expectRed
  switch (flag) {
    case '--inject-metrics': mutated = tmpl.replace(/SELECT\s+/, 'SELECT metrics.all_conversions, '); expectRed = true; break
    case '--inject-segment': mutated = tmpl.replace(/SELECT\s+/, 'SELECT segments.date, '); expectRed = true; break
    case '--inject-interpolation': mutated = tmpl.replace(/WHERE\s+/, 'WHERE ${dateFilter} AND '); expectRed = true; break
    case '--remove-query': mutated = '[]'; expectRed = true; break
    case '--split-from': mutated = tmpl.replace(/FROM\s+conversion_action/, 'FROM\n    conversion_action'); expectRed = null; break
    default: console.error(`✗ ${TAG} unknown flag ${flag}`); process.exit(2)
  }
  const mutatedFiles = files.map((f) => (f.rel === OWNER_FILE ? { rel: f.rel, text: f.text.replace(tmpl, mutated) } : f))
  const r = judge(mutatedFiles)
  console.log(`${TAG} SELF-TEST ${flag} (STUB: in-memory mutation of ${OWNER_FILE}, not the tree)`)
  console.log(verdictLine(r))
  if (expectRed === true) {
    if (r.findings.length === 0) { console.error(`✗ ${TAG} SELF-TEST FAILED — ${flag} expected RED, got GREEN.`); process.exit(2) }
    console.log(`${TAG} SELF-TEST OK — ${flag} read RED as required.`)
    process.exit(1)
  }
  if (r.templates !== 1) { console.error(`✗ ${TAG} SELF-TEST FAILED — ${flag} expected the split FROM to count 1 of 1, counted ${r.templates}.`); process.exit(2) }
  console.log(`${TAG} SELF-TEST OK — ${flag} counted 1 of 1 with FROM and conversion_action on separate lines.`)
  process.exit(r.findings.length ? 1 : 0)
}

// ── VERDICT ─────────────────────────────────────────────────────────────────────────────────────────────────────
const result = judge(files)
console.log(verdictLine(result))
if (result.findings.length) {
  console.error(`  ⇒ SPEC: QUEUE ★CONVERSION-ACTION-CAPTURE-DARK — attribute-only read; the count seam sums from conv_by_campaign, never from this query.`)
  process.exit(1)
}
process.exit(0)
