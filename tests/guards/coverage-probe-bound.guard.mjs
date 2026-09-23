#!/usr/bin/env node
// LORAMER_COVERAGE_PROBE_BOUND_V1 — windowCoverage's per-day probes are launched through a SLIDING WINDOW, never all at once.
// ⛔ AMENDED 2026-09-23 — LORAMER_FIRE_PLANS_UNTIL_FULL_V1: the per-day probe now runs INSIDE Postgres (migrations/103
// universe_coverage_dates, generate_series × LATERAL limit-1), one RPC per ≤ 900-day part. The four intents below are
// re-pinned against that shape: (β) a 3,000-day span issues ceil(3000/900) = 4 sequential parts (never two in flight),
// each ≤ 900 days, covering every day exactly once; (γ) a part that fails rejects the read carrying the error and no later
// part launches; (δ) covered/uncovered are placed by index in day order with the alias consulted server-side. (α) keeps
// its static pins (no Promise.all(days.map) launch anywhere; the launcher's one home still imported).
//
// THE DEFECT (measured 2026-09-14, fire-7621 class, DECISIONS/QUEUE ★METER-UNREADABLE-HOLD-7621): windowCoverage
// (universe-coverage.ts) launched `Promise.all(days.map(probe))` — ONE PostgREST fetch per day of the span, all in
// flight at once. The missed lane enumerates inception→T−B, so a wall-less surface on a 2016–2018 inception put
// 3,000–3,700 fetches in flight on one Vercel host; the host's resolver/fd pool exhausted ("getaddrinfo EBUSY
// rumpndvubxlcajkrnbvb.supabase.co", surfaced by undici as "TypeError: fetch failed" — no Postgres error, 0.123 ms per
// probe server-side), the enumeration threw, the meter's own next fetch failed the same way and read null, and the
// fire was 'meter-held' on a gauge that was never broken. 13 of 13 meter-held fires since 09-13 20:06Z carried
// refusals {"missed-enumeration-error":1}; Tri-Copy and Influential Drones wrote NOTHING for 19 h.
//
// THE FIX, pinned below:
//  (α) STATIC — universe-coverage.ts contains NO `Promise.all(days.map` launch, exports COVERAGE_PROBE_CONCURRENCY,
//      and the launcher carries a `cancelled` flag (queued-but-unlaunched probes never launch after the first failure).
//  (β) DRIVEN — on the real compiled module with a scripted supabase that COUNTS in-flight probes: a 3,000-day span
//      never has more than COVERAGE_PROBE_CONCURRENCY probes in flight, and every day is probed exactly once.
//  (γ) DRIVEN — a probe that fails at day k rejects the whole read (the module's own contract: a coverage answer is
//      never synthesised from a failed read) AND launches at most k + COVERAGE_PROBE_CONCURRENCY probes in total —
//      the residual after a failure is one in-flight window, not the rest of the span.
//  (δ) DRIVEN — the answer is byte-identical to the unbounded launcher's: covered/uncovered are computed from
//      results placed by index, in day order, with the alias fallback still consulted inside the same slot.
//  (ε) registered in scripts/run-guards.mjs.
// Seen RED first against 50df9ac (the unbounded launcher): (α) ×3 · (β) max in-flight 3,000 · (γ) launched 3,000.
import { readFileSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { join, resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { tmpdir } from 'node:os'
import { spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'
import Module from 'node:module'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')
const findings = []
const read = (p) => { try { return readFileSync(resolve(ROOT, p), 'utf8') } catch (e) { findings.push(`UNREADABLE ${p} — ${e.message}. A guard that cannot read its evidence FAILS.`); return '' } }
const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1')

const COVERAGE = 'src/lib/backfill/universe-coverage.ts'
const SURFACES = 'src/lib/backfill/universe-surfaces.ts'
const RUNNER = 'scripts/run-guards.mjs'
const SELF = 'tests/guards/coverage-probe-bound.guard.mjs'

// ── (α) STATIC ────────────────────────────────────────────────────────────────────────────────────────────
{
  const cov = strip(read(COVERAGE))
  if (/Promise\.all\(\s*days\.map/.test(cov)) findings.push(`(α) ${COVERAGE} still launches \`Promise.all(days.map(...))\` — every day of the span in flight at once; on a 2016 inception that is ~3,700 fetches and the host's resolver exhausts (getaddrinfo EBUSY → "TypeError: fetch failed").`)
  if (!/export const COVERAGE_PROBE_CONCURRENCY\s*=\s*\d+/.test(cov)) findings.push(`(α) ${COVERAGE} does not export COVERAGE_PROBE_CONCURRENCY — the bound must be a named, derived constant, not a literal in the launcher.`)
  // LORAMER_FANOUT_BOUNDED_GUARD_V1 — the launcher now lives in src/lib/concurrency.ts (one home); the flag is read there,
  // and universe-coverage.ts must still IMPORT it from that home (a second copy would be the drift the fan-out guard stops).
  const launcher = strip(read('src/lib/concurrency.ts'))
  if (!/from '@\/lib\/concurrency'/.test(cov)) findings.push(`(α) ${COVERAGE} does not import mapBounded from src/lib/concurrency.ts — the launcher must come from its one home`)
  if (!/cancelled/.test(launcher)) findings.push(`(α) src/lib/concurrency.ts carries no \`cancelled\` flag — after the first failed probe the queued-but-unlaunched probes must never launch (the residual storm is what breaks the NEXT fetch and the next fire).`)
}
// ── (ε) REGISTERED ────────────────────────────────────────────────────────────────────────────────────────
if (!read(RUNNER).includes(SELF)) findings.push(`(ε) ${RUNNER} does not register ${SELF}`)

// ── COMPILE THE REAL SUBJECT + ITS REAL VOCABULARY DEPENDENCY ────────────────────────────────────────────
const out = mkdtempSync(join(tmpdir(), 'loramer-probe-bound-'))
const origResolve = Module._resolveFilename
try {
  const tsc = join(ROOT, 'node_modules', '.bin', 'tsc')
  const r = spawnSync(tsc, [resolve(ROOT, COVERAGE), resolve(ROOT, SURFACES), resolve(ROOT, 'src/lib/concurrency.ts'),
    '--target', 'es2020', '--module', 'commonjs', '--moduleResolution', 'node',
    '--skipLibCheck', '--noResolve', '--rootDir', resolve(ROOT), '--outDir', out], { encoding: 'utf8' })
  if (r.error) findings.push(`could not run tsc — ${r.error.message}`)

  // The scripted supabase: metrics_daily probes resolve asynchronously (a macrotask, so concurrency is REAL, not
  // microtask-collapsed), count in-flight and launched probes, and can fail at one scripted day. The
  // universe_attempt_log reads (committedDays / attestedEmptyDays) return nothing — this guard is about the
  // launcher, and those two reads are one request each.
  const stub = join(out, '__supabase_stub.js')
  writeFileSync(stub, `

class Q {
  constructor(table) { this.table = table; this.conds = {} }
  select() { return this }
  eq(c, v) { this.conds[c] = String(v); return this }
  in() { return this }
  lte() { return this }
  gte() { return this }
  not() { return this }
  order() { return this }
  limit() { return this }
  then(res, rej) {
    if (this.table !== 'metrics_daily') return Promise.resolve({ data: [], error: null }).then(res, rej)
    const day = this.conds.date
    const S = globalThis.__PROBE_STUB; S.launched += 1; S.inFlight += 1; S.maxInFlight = Math.max(S.maxInFlight, S.inFlight)
    S.seen.push(day + '|' + this.conds.entity_level + '|' + this.conds.breakdown_type)
    return new Promise((ok) => setTimeout(ok, 1)).then(() => {
      S.inFlight -= 1
      if (S.failAt === day) return { data: null, error: { message: 'TypeError: fetch failed (scripted EBUSY at ' + day + ')' } }
      const has = S.hasRows(day, this.conds.entity_level, this.conds.breakdown_type)
      return { data: has ? [{ date: day }] : [], error: null }
    }).then(res, rej)
  }
}
function datesBetween(a, b) { const o = []; const d = new Date(a + 'T00:00:00Z'); const e = new Date(b + 'T00:00:00Z'); while (d <= e) { o.push(d.toISOString().slice(0, 10)); d.setUTCDate(d.getUTCDate() + 1) } return o }
async function rpc(name, args) {
  const S = globalThis.__PROBE_STUB
  if (name !== 'universe_coverage_dates') return { data: null, error: { message: 'unknown rpc ' + name } }
  const part = datesBetween(args.p_start, args.p_end)
  S.launched += 1; S.inFlight += 1; S.maxInFlight = Math.max(S.maxInFlight, S.inFlight); S.parts.push(part.length)
  await new Promise((ok) => setTimeout(ok, 1))
  S.inFlight -= 1
  if (S.failAt && part.includes(S.failAt)) return { data: null, error: { message: 'TypeError: fetch failed (scripted EBUSY in the part holding ' + S.failAt + ')' } }
  for (const day of part) S.seen.push(day + '|' + args.p_entity_level + '|' + args.p_breakdown_type)
  const data = part.filter((day) => S.hasRows(day, args.p_entity_level, args.p_breakdown_type) || (args.p_alias_entity_level && S.hasRows(day, args.p_alias_entity_level, args.p_alias_breakdown_type)))
  return { data, error: null }
}
module.exports = { supabaseAdmin: { from: (t) => new Q(t), rpc } }
`)
  const surfacesJs = join(out, 'src/lib/backfill/universe-surfaces.js')
  Module._resolveFilename = function (request, ...rest) {
    if (/\/concurrency$/.test(request)) return join(out, 'src/lib/concurrency.js') // LORAMER_FANOUT_BOUNDED_GUARD_V1 — mapBounded's real home, compiled alongside
    if (/universe-surfaces$/.test(request)) return surfacesJs
    if (/@\/lib\/supabase$/.test(request)) return stub
    if (request.startsWith('@/') || request.startsWith('./') || request.startsWith('../')) {
      if (/universe-coverage|universe-surfaces/.test(request)) return origResolve.call(this, request, ...rest)
      return stub
    }
    return origResolve.call(this, request, ...rest)
  }
  const req = createRequire(import.meta.url)
  const cov = req(join(out, 'src/lib/backfill/universe-coverage.js'))
  const N = Number(cov.COVERAGE_PROBE_CONCURRENCY)
  if (!(N > 0)) findings.push(`(β) the compiled module exports COVERAGE_PROBE_CONCURRENCY=${cov.COVERAGE_PROBE_CONCURRENCY} — not a positive number`)
  const B = N > 0 ? N : 64 // the driven legs judge an unbounded launcher against the expected bound, so they read RED rather than vacuous

  const K = { clientId: 'c1', platform: 'google', entityLevel: 'campaign', breakdownType: '' }
  const KA = { clientId: 'c1', platform: 'google', entityLevel: 'geographic_view', breakdownType: 'geo_target_city' } // has a drain alias → campaign/geo_city
  const fresh = (over = {}) => { globalThis.__PROBE_STUB = { launched: 0, inFlight: 0, maxInFlight: 0, seen: [], parts: [], failAt: null, hasRows: () => false, ...over } }
  const days = cov.dayList('2018-03-01', '2026-05-17') // 3,000 days — the skinregimen-class span
  if (days.length !== 3000) findings.push(`fixture: expected a 3,000-day span, got ${days.length}`)

  // ── (β) THE BOUND HOLDS, AND EVERY DAY IS PROBED ONCE ──────────────────────────────────────────────────
  fresh()
  await cov.windowCoverage(K, '2018-03-01', '2026-05-17')
  {
    const S = globalThis.__PROBE_STUB
    const MAXD = Number(cov.COVERAGE_WINDOW_MAX_DAYS)
    if (!(MAXD > 0 && MAXD <= 1000)) findings.push(`(β) COVERAGE_WINDOW_MAX_DAYS=${cov.COVERAGE_WINDOW_MAX_DAYS} — must be a positive number under PostgREST's 1,000-row default`)
    const expectParts = Math.ceil(3000 / (MAXD || 900))
    if (S.maxInFlight > 1) findings.push(`(β) ${S.maxInFlight} coverage RPC parts in flight at once — parts are sequential; the storm must not come back as parallel parts`)
    if (S.launched !== expectParts) findings.push(`(β) ${S.launched} RPC part(s) for 3,000 days — expected ${expectParts} (≤ ${MAXD} days each)`)
    if (S.parts.some((n) => n > MAXD) || S.parts.reduce((a, b) => a + b, 0) !== 3000) findings.push(`(β) parts ${JSON.stringify(S.parts)} — every part ≤ ${MAXD} days and the parts must sum to the span`)
    if (new Set(S.seen).size !== 3000) findings.push(`(β) ${new Set(S.seen).size} distinct (day, surface) probes — a day was probed twice or skipped`)
  }

  // ── (γ) FAIL AT DAY k: REJECTS, AND LAUNCHES AT MOST k + N ─────────────────────────────────────────────
  const k = 500
  fresh({ failAt: days[k] })
  let rejected = null
  try { await cov.windowCoverage(K, '2018-03-01', '2026-05-17') } catch (e) { rejected = e }
  {
    const S = globalThis.__PROBE_STUB
    if (!rejected) findings.push(`(γ) a failed probe at day ${days[k]} did NOT reject windowCoverage — a coverage answer was synthesised from a failed read (the module's own header forbids it)`)
    else if (!/fetch failed/.test(String(rejected.message))) findings.push(`(γ) rejected, but the probe's own error is not carried: ${String(rejected.message).slice(0, 120)}`)
    const failingPart = Math.floor(k / Number(cov.COVERAGE_WINDOW_MAX_DAYS || 900)) + 1
    if (S.launched > failingPart) findings.push(`(γ) ${S.launched} RPC part(s) launched after a failure inside part ${failingPart} — no later part may launch; the residual after a failure is nothing, never the rest of the span.`)
  }

  // ── (δ) ANSWER PARITY: results by index, day order, alias inside the slot ──────────────────────────────
  // rows on days 100..109 (primary) and on day 200 via the ALIAS only; the newest day-with-rows is ambiguous
  // (coveredDaysStrict rule (a)) so 200 is uncovered unless committed — that is today's answer too.
  const primary = new Set(days.slice(100, 110))
  fresh({ hasRows: (day, el, bt) => (el === 'geographic_view' && bt === 'geo_target_city' && primary.has(day)) || (el === 'campaign' && bt === 'geo_city' && day === days[200]) })
  const got = await cov.windowCoverage(KA, '2018-03-01', '2026-05-17')
  {
    const S = globalThis.__PROBE_STUB
    const expectCovered = days.slice(100, 110) // days 100..109 closed by a later day (200); 200 is newest → ambiguous → uncovered
    if (JSON.stringify(got.covered) !== JSON.stringify(expectCovered)) findings.push(`(δ) covered = ${JSON.stringify(got.covered).slice(0, 200)} — expected days 100..109 in day order (results must be placed by index, never by arrival)`)
    if (got.uncovered.length !== 3000 - 10) findings.push(`(δ) uncovered has ${got.uncovered.length} days — expected ${3000 - 10}`)
    if (got.uncovered.includes(days[105]) || !got.uncovered.includes(days[200])) findings.push(`(δ) uncovered set wrong around the alias day: day 105 uncovered=${got.uncovered.includes(days[105])}, day 200 uncovered=${got.uncovered.includes(days[200])}`)
    if (got.probes !== 3000) findings.push(`(δ) probes=${got.probes} — must remain days.length (3,000); the meaning of the instrument is unchanged`)
    if (S.maxInFlight > 1) findings.push(`(δ) ${S.maxInFlight} parts in flight with the alias consulted — the alias runs INSIDE the RPC, never as a second launch`)
  }
} catch (e) {
  findings.push(`could not DRIVE windowCoverage — ${e.message}. A guard that cannot run its subject FAILS rather than passing.`)
} finally {
  Module._resolveFilename = origResolve
  rmSync(out, { recursive: true, force: true })
  delete globalThis.__PROBE_STUB
}

if (findings.length) {
  console.error(`[coverage-probe-bound] FAIL — ${findings.length} finding(s):`)
  for (const f of findings) console.error(`  - ${f}`)
  process.exit(1)
}
console.log(`[coverage-probe-bound] PASS — DRIVEN on the real compiled coverage module: a 3,000-day span is read as sequential RPC parts of ≤ COVERAGE_WINDOW_MAX_DAYS (never two in flight), every day probed once inside Postgres; a part that fails rejects the read and launches nothing further; covered/uncovered are placed by index in day order with the alias consulted server-side; no Promise.all(days.map) launch remains; registered.`)
