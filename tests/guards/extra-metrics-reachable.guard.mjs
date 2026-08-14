#!/usr/bin/env node
// LORAMER_EXTRA_METRIC_REACHABILITY_V1 — the guard for the largest failing class in the 2026-08-14 eval
// baseline: PRESENT_BUT_UNREACHABLE. Six scored questions failed because GA sessions / event counts were
// stored in the `extra` JSONB and NO aggregation path read it — so Lora answered "sessions aren't in the
// captured store" about data we had held for months. The fix makes `extra` cross the wire; this guard makes
// the fix un-regressable.
//
// ⛔ WHAT THIS GUARD CAN AND CANNOT PROVE, STATED BEFORE THE LEGS. It is HERMETIC — it reads source text and
// runs on Vercel with no database. It therefore proves WIRING (the declaration exists, SQL mirrors TS, the
// query layer reads and carries the values, the tool schema names them, the caveat rides along). It CANNOT
// prove that the number Lora serves equals the number in the store — that needs a live read against prod,
// which is scripts/check-extra-metrics-serving.mjs in the check:data roster. Neither half is sufficient:
// wiring without numbers is the "green check answers a narrower question than the reader assumes" trap, and
// numbers without wiring is a check that passes on a tree where the feature was deleted. Both, or nothing.
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const ROOT = process.env.LORAMER_GUARD_ROOT || process.cwd()
const findings = []
const read = (rel) => {
  try { return readFileSync(resolve(ROOT, rel), 'utf8') }
  catch (e) { findings.push(`UNREADABLE ${rel} — ${e.message}. A guard that cannot read its evidence FAILS.`); return '' }
}

const REGISTRY = 'src/lib/breakdown-registry.ts'
const QUERY = 'src/lib/metrics-query.ts'
const TOOLS = 'src/lib/claude-tools.ts'
const MIG = 'migrations/067_extra_metric_reachability.sql'

const regSrc = read(REGISTRY)
const querySrc = read(QUERY)
const toolsSrc = read(TOOLS)
const migSrc = read(MIG)

// ── (a) THE DECLARATION EXISTS AND IS NON-EMPTY ─────────────────────────────────────────────────────────
// Derived by TEXT, never by import: the guard must run without transpiling TypeScript.
const tsPairs = []
{
  const block = regSrc.match(/export const ADDITIVE_EXTRA_METRICS[\s\S]*?\n\]/)
  if (!block) {
    findings.push(`(a) ${REGISTRY} exports no ADDITIVE_EXTRA_METRICS. The whole fix rests on ONE declared list of ` +
      `summable \`extra\` keys; with no list, every consumer is free to improvise one — the two-hand-maintained-lists ` +
      `drift that made 54 tuples hard-blind in the first place.`)
  } else {
    const re = /\{\s*platform:\s*'([a-z]+)'\s*,\s*key:\s*'([A-Za-z0-9_]+)'/g
    let m
    while ((m = re.exec(block[0]))) tsPairs.push(`${m[1]}.${m[2]}`)
    if (!tsPairs.length) findings.push(`(a) ADDITIVE_EXTRA_METRICS parsed to ZERO entries — the list exists but declares nothing.`)
    if (!/export const additiveExtraKeys/.test(regSrc)) findings.push(`(a) ${REGISTRY} exports no additiveExtraKeys() — consumers cannot derive per-platform keys.`)
  }
}

// ── (b) NO KEY IS BOTH SERVED AND DENIED ────────────────────────────────────────────────────────────────
// The denied list is the safety argument (dedup counts and ratios must never be summed). If a key appears on
// both lists the argument is void, and the failure is silent: a plausible number, wrong by the return rate.
{
  const denied = []
  const block = regSrc.match(/export const DENIED_EXTRA_METRICS[\s\S]*?\n\]/)
  if (!block) findings.push(`(b) ${REGISTRY} exports no DENIED_EXTRA_METRICS — the reasons a key is NOT summed are unrecorded, so an omission cannot be told from an oversight.`)
  else {
    const re = /\{\s*platform:\s*'([a-z]+)'\s*,\s*key:\s*'([A-Za-z0-9_]+)'/g
    let m
    while ((m = re.exec(block[0]))) denied.push(`${m[1]}.${m[2]}`)
    const both = tsPairs.filter((p) => denied.includes(p))
    if (both.length) findings.push(`(b) DECLARED BOTH ADDITIVE AND DENIED: ${both.join(', ')}. A key cannot be summable and non-summable; ` +
      `resolve it in the registry, do not let the query layer pick.`)
  }
}

// ── (c) THE SQL MIRRORS THE TS, KEY FOR KEY ─────────────────────────────────────────────────────────────
// The RPCs cannot import TypeScript, so the key set is written TWICE. Two hand-maintained lists is exactly the
// drift this repo has paid for repeatedly, so the mirror is pinned to the EXECUTABLE text of the migration
// (the jsonb_typeof expressions themselves), never to a comment that can rot while the SQL moves.
{
  const sqlPairs = []
  const re = /p_platform\s*=\s*'([a-z]+)'\s+and\s+jsonb_typeof\(extra\s*->\s*'([A-Za-z0-9_]+)'\)/g
  let m
  while ((m = re.exec(migSrc))) sqlPairs.push(`${m[1]}.${m[2]}`)
  const sqlSet = [...new Set(sqlPairs)]
  if (!sqlSet.length) {
    findings.push(`(c) ${MIG} contains no per-platform \`extra\` sum expressions. The RPCs are where the aggregation ` +
      `happens; a TS declaration alone changes nothing about what Postgres returns.`)
  } else {
    const missingInSql = tsPairs.filter((p) => !sqlSet.includes(p))
    const extraInSql = sqlSet.filter((p) => !tsPairs.includes(p))
    if (missingInSql.length) findings.push(`(c) DECLARED IN TS BUT NOT SUMMED IN SQL: ${missingInSql.join(', ')}. ` +
      `These read as absent to Lora — the exact defect the baseline measured.`)
    if (extraInSql.length) findings.push(`(c) SUMMED IN SQL BUT NOT DECLARED IN TS: ${extraInSql.join(', ')}. ` +
      `SQL is the copy, TS is the source; a key that exists only in the migration was never argued for.`)
  }
}

// ── (d) THE MIGRATION REPLACES, IT DOES NOT DROP ────────────────────────────────────────────────────────
// ⛔ DROP+CREATE would silently undo LORAMER_RPC_GRANT_POSTURE_V1 (migration 065). A newly created function
// carries PostgreSQL's default EXECUTE grant to PUBLIC, so dropping and recreating these two RPCs would hand
// `anon` execute rights on a client-scoped reader — re-opening the exact hole that flight closed six days ago.
// CREATE OR REPLACE keeps the existing ACL because the pg_proc row is updated, not replaced.
{
  if (migSrc) {
    for (const fn of ['query_breakdown_agg', 'query_breakdown_agg_topn']) {
      const dropped = new RegExp(`drop\\s+function[^;]*\\b${fn}\\b`, 'i').test(migSrc)
      if (dropped) findings.push(`(d) ${MIG} DROPs ${fn}. A dropped-and-recreated function loses its ACL and defaults to ` +
        `EXECUTE for PUBLIC — that reverts migration 065's grant posture. Use CREATE OR REPLACE (same signature, same return type).`)
      const replaced = new RegExp(`create\\s+or\\s+replace\\s+function\\s+public\\.${fn}\\b`, 'i').test(migSrc)
      if (!replaced) findings.push(`(d) ${MIG} does not CREATE OR REPLACE public.${fn} — the fix cannot reach the path that serves it.`)
    }
    // A signature change forces a new function (an OVERLOAD), which is a DROP by another name for ACL purposes.
    // Pinned to the EXACT parameter list of each function as migrations 038/039 declared it — a name-based
    // search for a guessed parameter would miss any rename, and would also (as it did on the first run of this
    // guard) fire on the word appearing in a COMMENT. Read the signature, not the file.
    const SIGNATURES = {
      query_breakdown_agg: ['p_client_id', 'p_platform', 'p_breakdown_type', 'p_entity_level', 'p_start', 'p_end', 'p_parent_entity_id', 'p_entity_id'],
      query_breakdown_agg_topn: ['p_client_id', 'p_platform', 'p_breakdown_type', 'p_entity_level', 'p_start', 'p_end', 'p_rank_by', 'p_top_n', 'p_order_dir', 'p_parent_entity_id', 'p_entity_id'],
    }
    for (const [fn, want] of Object.entries(SIGNATURES)) {
      const sig = migSrc.match(new RegExp(`create\\s+or\\s+replace\\s+function\\s+public\\.${fn}\\s*\\(([\\s\\S]*?)\\)\\s*\\n?returns`, 'i'))
      if (!sig) continue // the missing-CREATE-OR-REPLACE case is already reported above
      const got = [...sig[1].matchAll(/\b(p_[a-z_]+)\b/g)].map((m) => m[1])
      if (got.join(',') !== want.join(',')) {
        findings.push(`(d) ${MIG} changes the signature of ${fn}: expected (${want.join(', ')}), found (${got.join(', ')}). ` +
          `CREATE OR REPLACE cannot change a signature — Postgres creates an OVERLOAD instead, which is a brand-new pg_proc ` +
          `row carrying the default PUBLIC EXECUTE grant, silently reverting migration 065. Keep the signature; carry any new list in the body.`)
      }
    }
  }
}

// ── (e) TYPE COERCION IS GUARDED, NOT ASSUMED ───────────────────────────────────────────────────────────
// `extra` is JSONB written by five independent adapters. A bare (extra->>'k')::numeric raises 22P02 on the
// first row where a key holds a string — and it WILL, because the same column carries netBasis, caveat,
// tzBasis and provenance as text. jsonb_typeof(...)='number' is the total function: it filters instead of
// throwing, so one odd row degrades a value, never the whole answer for every client on that platform.
{
  if (migSrc) {
    const casts = (migSrc.match(/\(extra\s*->>\s*'[A-Za-z0-9_]+'\)::numeric/g) || []).length
    const guards = (migSrc.match(/jsonb_typeof\(extra\s*->\s*'[A-Za-z0-9_]+'\)\s*=\s*'number'/g) || []).length
    if (casts && guards < casts) findings.push(`(e) ${MIG} has ${casts} numeric cast(s) of \`extra\` but only ${guards} ` +
      `jsonb_typeof guard(s). An unguarded cast throws 22P02 on the first text value in that key and takes the whole query down.`)
  }
}

// ── (f) THE BASE PATH READS extra ───────────────────────────────────────────────────────────────────────
// aggregateWindow is what query_metrics calls for account/campaign totals — the path V5 ("sessions for the
// full year, 25 versus 24") went through. It SELECTed six metric columns plus platform; `extra` was never in
// the projection, so a stored session count was invisible no matter how the question was asked.
{
  const agg = querySrc.match(/async function aggregateWindow[\s\S]*?\n\}\n/)
  if (!agg) findings.push(`(f) ${QUERY} exposes no aggregateWindow — the guard cannot locate the base-row path it must pin.`)
  else if (!/\.select\([^)]*extra/.test(agg[0])) {
    findings.push(`(f) aggregateWindow's SELECT does not include \`extra\`. Base-row questions (account sessions, ` +
      `store orders) cannot reach any extra-resident metric; this is the V5 failure verbatim.`)
  }
}

// ── (g) BOTH BREAKDOWN PATHS CARRY THE VALUES OUT ───────────────────────────────────────────────────────
// Summing in SQL and dropping the result in JS is a fix that measures green and serves nothing. There are
// THREE breakdown paths (038 all-groups, 039 bounded top-N, and the carryRoas row-pager) and a value that
// survives only two of them is a family that works until the question changes shape.
{
  if (querySrc && !/extraMetrics/.test(querySrc)) {
    findings.push(`(g) ${QUERY} never mentions extraMetrics — the RPCs may sum \`extra\`, but nothing carries it into the ` +
      `BreakdownRow, so Lora still cannot see it.`)
  } else if (querySrc) {
    const hits = (querySrc.match(/extra_metrics|extraMetrics/g) || []).length
    if (hits < 4) findings.push(`(g) ${QUERY} references extraMetrics only ${hits}× — too few for the type, the bounded ` +
      `path (039), the all-groups path (038) and the row-pager to each carry it. Name the path that is missing.`)
  }
}

// ── (h) THE EXTRA METRICS ARE RANKABLE ──────────────────────────────────────────────────────────────────
// B2 asked for "top ten landing pages BY SESSIONS". Reaching the number is half the answer; the RANKING is
// the other half, and it happens inside migration 039's ORDER BY. If RANKABLE refuses 'sessions', the query
// layer rejects the question before any of this matters.
{
  const rk = querySrc.match(/const RANKABLE = new Set\(\[[^\]]*\]/)
  if (!rk) findings.push(`(h) ${QUERY} exposes no RANKABLE set — cannot verify that an extra metric may be ranked by.`)
  else if (!/additiveExtraKeys|allAdditiveExtraKeys/.test(rk[0])) {
    findings.push(`(h) RANKABLE is a fixed literal that does not derive from the registry's additive extra keys. ` +
      `"Top N by sessions" is refused at the query layer even though the number is now reachable — half a fix.`)
  }
  if (migSrc && !/p_rank_by/.test(migSrc)) {
    findings.push(`(h) ${MIG} does not touch p_rank_by — migration 039 ranks in SQL, so an extra-keyed rankBy silently ` +
      `falls through to the default anchor and returns the top pages by SPEND labelled as by sessions.`)
  }
}

// ── (i) THE PER-DAY BASIS IS DECLARED ───────────────────────────────────────────────────────────────────
// ⛔ THE HALF OF RUSS'S 2026-08-13 GRAIN CALL THAT THIS FLIGHT CAN ACTUALLY HONOUR. He certified the RANGE
// TOTAL as customer-facing truth (FY2025 = 549,971 from the property itself) against our per-day sum of
// 552,253 — GA4 deduplicates sessions spanning midnight, so the two differ by +0.41% and always will. The
// range-serving path is NOT built (★SEMANTIC-LAYER owns it). His decision has a second clause for exactly
// this state: Lora DECLARES the per-day basis when she cannot serve the range. Reachable-and-labelled is the
// deliverable; reachable-and-silent would trade a visible refusal for an invisible discrepancy, which is worse.
{
  if (querySrc && !/PER-DAY BASIS|perDayBasis/.test(querySrc)) {
    findings.push(`(i) ${QUERY} attaches no per-day-basis declaration for GA session metrics. Σ per-day sessions is NOT ` +
      `the vendor's range total (measured 552,253 vs 549,971 on FY2025); serving the sum unlabelled states a number the ` +
      `customer's own GA4 will not show, with nothing on the answer to explain the gap.`)
  }
}

// ── (j) LORA IS TOLD THE METRICS EXIST ──────────────────────────────────────────────────────────────────
// The baseline's failure was not arithmetic — it was Lora asserting, fluently and wrongly, that we do not
// capture sessions. She believed the tool schema. If the schema still omits them she will keep saying it while
// the data sits one SELECT away, and every leg above will still be green.
{
  if (toolsSrc && !/sessions/.test(toolsSrc)) {
    findings.push(`(j) ${TOOLS} never mentions sessions. The query layer can serve it and Lora will still refuse the ` +
      `question — she reports what the tool schema tells her exists. This is the leg that closes the loop.`)
  }
}

const label = 'LORAMER_EXTRA_METRIC_REACHABILITY_V1'
if (findings.length) {
  console.error(`✗ ${label} — ${findings.length} finding(s):\n`)
  for (const f of findings) console.error('  - ' + f + '\n')
  process.exitCode = 1
} else {
  console.log(`✓ ${label} — extra-JSONB metrics are declared once, mirrored in SQL, summed on all three breakdown paths ` +
    `and the base path, rankable, labelled with their per-day basis, and named to Lora.`)
}
