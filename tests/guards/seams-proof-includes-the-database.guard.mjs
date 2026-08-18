#!/usr/bin/env node
// LORAMER_SEAMS_PROOF_INCLUDES_THE_DATABASE_V1 — THE DATABASE IS A READER. WALK IT.
//
// ⛔ WHY THIS EXISTS, AND IT IS THE SEVENTH ENTRY IN A LIST THAT IS 0-FOR-6. LORAMER_SEAMS_PROOF_V1 says a
// flight that changes a thing other code reads must NAME every reader and PROVE each still sees it correctly.
// On 2026-08-17 I quoted that law in the morning and broke it in the afternoon: `AttemptOutcome` gained
// 'nongrain', `universe_attempt_log_outcome_ck` did not, Postgres rejected every write with 23514, and the
// pass recorded outcome='error' — the fix INERT and DEGRADING. `npm run build`, 124/124 guards and a full
// check:data were ALL GREEN, because not one of them writes such a row. Production found it in 21 minutes.
// **PROSE HAS NO ENFORCEMENT MECHANISM IN THIS CODEBASE** (banked law). This is the mechanical half.
//
// ⛔ THE LEG THIS FILE OWNS IS **DISCOVERY**, NOT EQUALITY. `db-enum-mirrors-ts.guard.mjs` already proves that
// a REGISTERED (union ↔ constraint) pair agrees. It can only ever check pairs somebody remembered to register,
// and "somebody remembered" is precisely what failed. This leg finds the unions that COULD take the same hit
// and forces each one to be either REGISTERED or ALLOWLISTED WITH A REASON. Silence is not an answer.
//
// ⛔ THE DATAFLOW PROXY, STATED AS A PROXY: a string-literal union declared in a file that ALSO performs a
// supabase write (.insert/.upsert/.update). That is not real dataflow analysis and it does not claim to be —
// it is the cheapest predicate that catches the shape that actually bit us, and it costs nothing to run.
// MEASURED 2026-08-17 across src/: 44 string-literal unions in total, 13 of them in files that also write.
//
// ⛔ WHAT THIS GUARD DELIBERATELY DOES **NOT** DO, AND WHY REFUSING WAS THE RIGHT CALL:
// it does NOT bulk-register the constraint-backed unions it discovers. `WindowOutcome` (7 values) maps to
// `universe_window_log_outcome_check_v2` (8 values) and the extra one is `'running'` — legitimately DB-only,
// because a window is OPENED as running and the TS type is for CLOSING it. Registering that pair mechanically
// would have shipped a FALSE RED on day one. Each pair needs its own reading; the gap is named in
// ★DB-ENUM-MIRRORS-TS-ONLY-COVERS-ONE-PAIR rather than papered over with a bulk edit.
//
// USAGE: node tests/guards/seams-proof-includes-the-database.guard.mjs
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { resolve, join } from 'node:path'

const ROOT = process.env.LORAMER_GUARD_ROOT || process.cwd()
const findings = []

// ── ALLOWLIST — each entry says WHY this union cannot take the 23514 hit. "It probably doesn't" is not a
// reason; the reason must name where the value goes. Adding a union here is a claim someone can check.
const NOT_A_DB_ENUM = {
  CronMode: 'cron_runs.mode — the column carries no CHECK constraint (verified against pg_constraint 2026-08-17), so a widened union cannot be rejected. If a constraint is ever added, register the pair instead of extending this note.',
  CronTrigger: 'cron_runs.trigger — same table, same absence of a CHECK constraint.',
  ConnAuthClass: 'connection-health classification computed for DISPLAY and for the health JSON blob; it is not the domain of any constrained column.',
  ConnHealth: 'as ConnAuthClass — a rendered verdict, stored only inside jsonb where no CHECK applies.',
  BudgetLane: 'google-op-budget lane names are keys of an in-memory allocation map; the ledger rows they produce carry counts, not the lane string, in a constrained column.',
  BudgetBlockedBy: 'a reason returned to the caller for logging; never persisted to a constrained column.',
  BulkPurpose: 'shopify-bulk purpose is a request-shaping argument; the bulk ledger stores ids and status, not this string, under a CHECK.',
  GoogleQuotaReadState: 'the sentinel READ state is derived at read time from sync_state booleans — it is an output of the reader, never a written value.',
  PersistOutcome: 'the chat persist outcome is returned to the caller and logged; chat_turn_failures constrains phase and recovered, neither of which takes this union.',
  PlacementLevel: 'meta placement level selects which Graph edge to call; it lands in metrics_daily.entity_level, which has no CHECK constraint (that column is open by design across five platforms).',
  ChangeSource: 'REGISTRATION PENDING, NOT EXEMPT — entity_state_history_change_source_chk mirrors it exactly today (first_observation/poll_transition/event, verified 2026-08-17). Listed here rather than registered because registration is being done one verified pair at a time; see ★DB-ENUM-MIRRORS-TS-ONLY-COVERS-ONE-PAIR.',
  PassOutcome: 'REGISTRATION PENDING, NOT EXEMPT — capture_pass_log_outcome_chk mirrors it exactly today (ok/skipped/error, verified 2026-08-17). Same reason as ChangeSource.',
  WindowOutcome: 'REGISTRATION PENDING AND THE PAIR IS NOT AN EQUALITY — universe_window_log_outcome_check_v2 holds EIGHT values to this union\'s seven, and the extra one is \'running\', which is legitimately DB-only: a window is OPENED as running and this type is for CLOSING it. A mechanical registration would false-RED. It needs a containment rule, not an equality rule.',
}

// ── LOCATE STRING-LITERAL UNIONS. ⛔ THE FIRST VERSION OF THIS LOCATOR RETURNED ['nongrain'] FOR
// AttemptOutcome — it matched from a COMMENT LINE that happened to quote the new value, so it would have
// missed the very union whose divergence caused the incident. Read the declaration, strip comment lines, THEN
// take the literals. Caught by driving the locator against the known case before trusting it.
function unionsIn(src) {
  const out = []
  const re = /export type (\w+)\s*=/g
  let m
  while ((m = re.exec(src)) !== null) {
    const name = m[1]
    const tail = src.slice(m.index + m[0].length)
    // ⛔ IT MUST ACTUALLY BE A UNION. The first meaningful character after `=` is `'` or `|`; anything else
    // (`{`, an identifier, `Array<`) is a different kind of type. Without this the locator reported
    // `GoogleOpBudget` — an OBJECT type — because a TRAILING comment on one of its fields quotes three
    // literals (`state: GoogleQuotaReadState // 'blocked' | 'not_blocked' | 'unknown'`). A guard that
    // invents a subject is worse than one that misses one, so the shape is checked before the values.
    const firstMeaningful = tail.replace(/^(\s|\/\/[^\n]*\n|\/\*[\s\S]*?\*\/)*/, '')[0]
    if (firstMeaningful !== "'" && firstMeaningful !== '|') continue
    // The declaration runs until a line that neither continues the union nor is a comment.
    const lines = tail.split('\n')
    const body = []
    for (const raw of lines) {
      const l = raw.trim()
      if (l === '') break
      if (l.startsWith('//') || l.startsWith('*') || l.startsWith('/*')) { body.push(''); continue }
      body.push(raw.replace(/\/\/[^\n]*$/, ''))
      if (!/[|=]\s*$/.test(raw) && !/^\s*\|/.test(raw) && body.filter(Boolean).length > 0 && !/\|\s*$/.test(raw)) {
        if (!/\|/.test(raw) && body.filter(Boolean).length > 1) break
      }
      if (body.filter(Boolean).length > 40) break
    }
    const code = body.join('\n')
    const vals = [...code.matchAll(/'([^']+)'/g)].map((x) => x[1])
    if (vals.length >= 2) out.push({ name, values: vals })
  }
  return out
}

function walk(dir) {
  const out = []
  for (const e of readdirSync(resolve(ROOT, dir))) {
    const rel = join(dir, e)
    const st = statSync(resolve(ROOT, rel))
    if (st.isDirectory()) out.push(...walk(rel))
    else if (e.endsWith('.ts') && !e.endsWith('.d.ts')) out.push(rel)
  }
  return out
}

// ── THE REGISTERED PAIRS come from db-enum-mirrors-ts, read rather than duplicated — two lists of the same
// fact is how they drift apart, which is the whole subject of this guard.
let registered = new Set()
try {
  const src = readFileSync(resolve(ROOT, 'tests/guards/db-enum-mirrors-ts.guard.mjs'), 'utf8')
  registered = new Set([...src.matchAll(/tsAnchor:\s*'export type (\w+)'/g)].map((m) => m[1]))
} catch (e) {
  findings.push(`cannot read db-enum-mirrors-ts.guard.mjs to learn which pairs are registered — ${e?.message}. Without it this leg cannot tell registered from unhandled, and a guard that cannot tell is not a pass.`)
}

const WRITE = /\.(insert|upsert|update)\s*\(/
let scanned = 0, writers = 0
const unhandled = []
for (const f of walk('src')) {
  const src = readFileSync(resolve(ROOT, f), 'utf8')
  scanned++
  if (!WRITE.test(src)) continue
  writers++
  for (const u of unionsIn(src)) {
    if (registered.has(u.name)) continue
    if (Object.prototype.hasOwnProperty.call(NOT_A_DB_ENUM, u.name)) continue
    unhandled.push(`${u.name} (${u.values.length} values) in ${f}`)
  }
}

if (unhandled.length) {
  findings.push(
    `${unhandled.length} string-literal union(s) live in a file that WRITES to supabase and are neither REGISTERED in db-enum-mirrors-ts nor allowlisted here: ${unhandled.join(' · ')}. ` +
    `⛔ EACH ONE CAN TAKE THE 2026-08-17 HIT: widen the TS side, ship green through build + guards + check:data, and have Postgres reject every write with 23514 in production while the caller records a different outcome. ` +
    `Either register the pair (union ↔ CHECK constraint) or add it to NOT_A_DB_ENUM with a reason that NAMES WHERE THE VALUE GOES. "It probably isn't a column" is not a reason.`)
}

if (findings.length) {
  console.error(`[seams-proof-includes-the-database] FAIL — ${findings.length} finding(s):`)
  for (const f of findings) console.error(`  - ${f}`)
  process.exitCode = 1
} else {
  console.log(`[seams-proof-includes-the-database] PASS — ${scanned} TS file(s) scanned, ${writers} of them write to supabase; every string-literal union in a writer is registered or allowlisted with a reason (${registered.size} registered, ${Object.keys(NOT_A_DB_ENUM).length} allowlisted).`)
  console.log(`⛔ LIMIT: this proves each union was CONSIDERED, never that the consideration was correct. Three allowlist entries say REGISTRATION PENDING and are real gaps — ★DB-ENUM-MIRRORS-TS-ONLY-COVERS-ONE-PAIR.`)
}
