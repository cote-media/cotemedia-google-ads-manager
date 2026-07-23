#!/usr/bin/env node
// LORAMER_CAPTURE_LANDING_GATE_V1 — STANDARD C: does a captured family actually LAND, per client, in metrics_daily?
//
// SIBLING of scripts/check-capture-completeness.mjs, NOT a replacement. That gate proves manifest↔registry GRAIN
// PARITY and says so on its own face ("NOT live-DB reachability"). This one closes exactly that blind spot: it reads
// the LIVE DB and asks whether the rows a family should have written are there.
//
// NOT HERMETIC BY DESIGN. It needs the prod DB, so it can never live in the same breath as a CI-safe check. Wiring
// decision (WARN vs FAIL, and whether it runs in `npm run guard` at all) is Russ's — this file only reports.
//
// ── THE TWO STANDARDS, and why one strictness would be wrong ────────────────────────────────────────────────────
// PARTITIONING family (device, placement, age, gender, hour, geo-on-meta …): its values PARTITION the anchor's
//   spend, so on any day the anchor actually delivered, the breakdown MUST exist. Anchor day with delivery and no
//   breakdown row = LANDING GAP. This is the Meta-breadth-freeze detector (G1: 10 dims froze at their ship dates
//   while clients kept spending, sync_state read complete, and nothing failed).
// CONDITIONAL family (discount_code, abandoned_checkout, store geo, every WRITE-ONLY / non-partitioning grain):
//   exists only when a condition holds (an order was placed, a code was used, a checkout was abandoned). A sparse
//   day is CORRECT, not a gap. Flagging sparsity here would reproduce the 2026-07-19 geo false alarm — Shopify geo
//   "lagged" the account row on every store purely because geo rows only exist on days with orders. So the only
//   honest signal is PRESENCE: zero rows ever, fleet-wide, or zero on a client that HAS the qualifying event.
//
// ── ANCHOR-ACTIVITY, the refinement that stops thousands of false gaps ──────────────────────────────────────────
// A partitioning family cannot exist on a $0 day either — no delivery, nothing to partition. So the comparison set
// is not "days with an account row", it is "days with an account row THAT SHOWS ACTIVITY". Rests on the banked
// account-grain invariant (an account row exists on every captured day, verified 23/23 fleet-wide), which is what
// makes the account grain usable as the expected-day set at all.
//
// ── CLASSIFICATION IS DERIVED, NEVER GUESSED ────────────────────────────────────────────────────────────────────
// Per the banked RECONCILE-POSTURE law (docs/LORAMER_BREAKDOWN_REGISTRY.md): "a grain reconciles (FLAG-NOT-BLOCK vs
// its anchor) ONLY if it PARTITIONS the anchor's spend; a grain that is a SUBSET is WRITE-ONLY." So:
//   doc says FLAG-NOT-BLOCK              → PARTITIONING
//   doc says WRITE-ONLY / RECONCILE=NONE → CONDITIONAL
//   doc silent → fall back to the CODE's additive flag ONLY when it says non-additive (additive:false ⇒ CONDITIONAL,
//     since a non-additive projection can never partition). additive:true is NOT sufficient evidence of partitioning
//     (Shopify geo is additive over the orders that exist, yet is order-conditional) → UNCLASSIFIED, never failed.
//
// QUERY DISCIPLINE: a fleet-wide GROUP BY over metrics_daily exceeds the statement timeout (proven 2026-07-19). Every
// probe below is bounded by client_id + platform + a date window so it rides the client-leading indexes.
//
// USAGE: node scripts/check-capture-landing.mjs [--days=N] [--json]
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import pg from 'pg'
import { KNOWN_ACCOUNT_ROW_VIOLATIONS } from './account-row-invariant.baseline.mjs'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const read = (rel) => { try { return readFileSync(resolve(ROOT, rel), 'utf8') } catch { return null } }
const arg = (k, d) => { const a = process.argv.find((s) => s.startsWith(`--${k}=`)); return a ? a.split('=')[1] : d }
const WINDOW_DAYS = Number(arg('days', 90))
const AS_JSON = process.argv.includes('--json')
// LORAMER_ACCOUNT_ROW_INVARIANT_V1 — the second assertion (see the block at the foot of this file).
// --invariant-only : run ONLY the account-row-per-day invariant (skip the STANDARD-C landing probes).
// --gate-a         : also run the real-input Gate-A proof that the detector catches a missing-account-row day.
const INVARIANT_ONLY = process.argv.includes('--invariant-only')
const RUN_GATE_A = process.argv.includes('--gate-a')
// --guard        : blocking mode — exit 1 on any violation NOT covered by the baseline.
//                  Run ONLY via `npm run check:data` (pre-push, DB-dependent). ⛔ NEVER add this invocation to
//                  `npm run guard` or `npm run build`: guard is 100% hermetic and sits in the Vercel deploy chain
//                  (vercel.json has no buildCommand → Vercel runs `npm run build`), and this is a live-DB check that
//                  would couple deploys to data state. The code-gate / data-gate split is DELIBERATE (DECISIONS
//                  LORAMER_ACCOUNT_ROW_INVARIANT_V1) — do not re-merge them.
// --prove-exact  : inject a synthetic in-memory violation OUTSIDE the baseline range to prove the baseline is a
//                  bounded window, not a blanket client+platform mute (must make --guard fail). No DB writes.
const GUARD = process.argv.includes('--guard')
const PROVE_EXACT = process.argv.includes('--prove-exact')

for (const line of (read('.env.local') || '').split('\n')) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/)
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '')
}
if (!process.env.SUPABASE_DB_URL) {
  // FAIL LOUD, NEVER SKIP. The account-row invariant is a DATA-integrity check run ONLY at the pre-push gate
  // (`npm run check:data`), never inside `npm run guard` / `npm run build` / the Vercel deploy chain. A silent no-op
  // is worse than no check: a missing DB URL here means the pre-push environment is misconfigured, and that must STOP
  // the push, not pass quietly. (An earlier revision skipped for Vercel-safety; the check now lives OUT of the deploy
  // path entirely — see the --guard flag note above + DECISIONS LORAMER_ACCOUNT_ROW_INVARIANT_V1 — so loud is right.)
  console.error('✗ SUPABASE_DB_URL missing (.env.local) — required for the data-integrity check; refusing to pass quietly.')
  process.exit(2)
}

// ── 1. families from the code registry (the ONE declared source) ────────────────────────────────────────────────
const registrySrc = read('src/lib/breakdown-registry.ts')
if (!registrySrc) { console.error('✗ landing gate: cannot read src/lib/breakdown-registry.ts'); process.exit(2) }
const families = []
for (const line of registrySrc.split('\n')) {
  if (line.trimStart().startsWith('//')) continue
  if (!/breakdownType:/.test(line) || !/surface:/.test(line)) continue
  const platform = line.match(/platform:\s*'([a-z]+)'/)?.[1]
  const bt = line.match(/breakdownType:\s*'([^']*)'/)?.[1]
  const lv = line.match(/entityLevels:\s*\[([^\]]*)\]/)?.[1]
  if (!platform || !bt || lv === undefined) continue
  const additive = /additive:\s*true/.test(line)
  const note = line.match(/note:\s*'([^']*)'/)?.[1] || ''
  families.push({ platform, bt, levels: lv.split(',').map((s) => s.trim().replace(/^'|'$/g, '')).filter(Boolean), additive, note })
}
if (families.length < 30) { console.error(`✗ landing gate: only ${families.length} families parsed — parser drift`); process.exit(2) }

// ── 2. posture, derived from the banked law ─────────────────────────────────────────────────────────────────────
const postureDoc = read('docs/LORAMER_BREAKDOWN_REGISTRY.md') || ''
const docLinesFor = (platform, bt) =>
  postureDoc.split('\n').filter((l) => l.startsWith('|') && new RegExp(`\\|\\s*${bt}\\s*\\|`).test(l) &&
    (new RegExp(`\\|\\s*${platform}\\s*\\|`).test(l) || !/\|\s*(google|meta|shopify|woocommerce|ga)\s*\|/.test(l)))
// FAMILY-LEVEL doc rules the per-row parser cannot see, each cited to the exact banked line it comes from.
// These are DERIVATIONS with a citation, not guesses — the doc states the posture for the FAMILY, and the family
// expands to breakdown_types the table never lists one-by-one.
const DOC_FAMILY_RULES = [
  { test: (p, bt) => p === 'google' && /^(user_)?geo_/.test(bt), posture: 'CONDITIONAL',
    why: 'BREAKDOWN_REGISTRY "geo_* (FAMILY)" row: "RECONCILE=NONE (write-only, non-partitioning)"' },
  { test: (p, bt) => p === 'google' && (bt === 'search_term' || bt === 'keyword'), posture: 'CONDITIONAL',
    why: 'RECONCILE-POSTURE law names them: keyword_view "excludes PMax/Display/Search-partner spend ... same class as the search_term/keyword breakdowns" = SUBSET, write-only' },
]
// PER-GRAIN exception, straight from the law ("posture is PER-GRAIN, not per-dimension"): device × keyword is a
// SEARCH-only SUBSET even though device × {campaign, ad_group, ad} partitions.
const GRAIN_SUBSET = new Set(['google|device|keyword'])
// THIRD source: the vendor-surface manifest's per-family notes. They carry posture statements the registry line does
// not (e.g. meta.placement: "account is DERIVE-NOT-CAPTURE — the clean rollup of campaign (Σ placement == account
// spend to the cent)" — that sentence IS the law's partition test, stated for that family).
const manifestSrc = read('scripts/capture-surface.manifest.mjs') || ''
function manifestNoteFor(platform, bt) {
  const re = new RegExp(`^\\s*${bt}:\\s*\\{[^}]*\\}`, 'm')
  const platBlock = manifestSrc.split(new RegExp(`^\\s{2}${platform}:\\s*\\{`, 'm'))[1] || ''
  return (platBlock.split(/^\s{2}\},/m)[0] || '').match(re)?.[0] || ''
}
function classify(f) {
  const lines = docLinesFor(f.platform, f.bt).join(' ')
  const manifestNote = f.note + ' ' + manifestNoteFor(f.platform, f.bt)
  const src = lines + ' ' + manifestNote
  for (const r of DOC_FAMILY_RULES) if (r.test(f.platform, f.bt)) return { posture: r.posture, why: r.why }
  if (/FLAG-NOT-BLOCK/i.test(src)) return { posture: 'PARTITIONING', why: 'doc/registry posture = FLAG-NOT-BLOCK (partitions the anchor)' }
  if (/WRITE-ONLY|RECONCILE=NONE/i.test(src)) return { posture: 'CONDITIONAL', why: 'doc/registry posture = WRITE-ONLY / RECONCILE=NONE (subset, non-partitioning)' }
  // The registry note sometimes states the partition property directly ("Σ placement == account spend to the cent",
  // "Σ order_time ≡ account net"). That IS the partition test the law prescribes, stated in code.
  if (/Σ[^.]*==\s*account|Σ[^.]*≡\s*account/i.test(manifestNote)) return { posture: 'PARTITIONING', why: 'registry note states the partition identity (Σ family == account) — the law\'s own test' }
  if (!f.additive) return { posture: 'CONDITIONAL', why: 'registry additive:false — a non-additive projection cannot partition' }
  return { posture: 'UNCLASSIFIED', why: 'no posture marker in the doc; additive:true is not sufficient evidence of partitioning' }
}
for (const f of families) Object.assign(f, classify(f))

// ── 3. probe ────────────────────────────────────────────────────────────────────────────────────────────────────
const client = new pg.Client({ connectionString: process.env.SUPABASE_DB_URL })
await client.connect()
const q = async (text, params) => (await client.query(text, params)).rows

const conns = await q(
  `select pc.client_id, pc.platform, c.name
     from platform_connections pc join clients c on c.id = pc.client_id
    where c.deleted_at is null order by c.name, pc.platform`)

// LORAMER_ACCOUNT_ROW_INVARIANT_V1 — focused mode: run only the second assertion, reusing this connection.
if (INVARIANT_ONLY) {
  const { exitCode } = await runAccountRowInvariant(conns, q, { gateA: RUN_GATE_A, guard: GUARD, proveExact: PROVE_EXACT })
  await client.end()
  process.exit(exitCode)
}

// anchor activity: a day the account grain shows real delivery. GA carries sessions in extra, not spend/revenue.
const ACTIVE = `(m.spend > 0 or m.revenue > 0 or m.conversions > 0 or coalesce((m.extra->>'sessions')::numeric, 0) > 0)`

const results = []
const seenPlatformFamily = new Map() // 'platform|bt' -> total rows fleet-wide (for CONDITIONAL zero-ever)

for (const c of conns) {
  const fams = families.filter((f) => f.platform === c.platform)
  if (!fams.length) continue

  const [anchor] = await q(
    `select count(*)::int as active_days, max(m.date) as last_active
       from metrics_daily m
      where m.client_id = $1 and m.platform = $2 and m.entity_level = 'account'
        and m.breakdown_type = '' and m.breakdown_value = ''
        and m.date >= current_date - $3::int and ${ACTIVE}`,
    [c.client_id, c.platform, WINDOW_DAYS])
  if (!anchor.active_days) continue // dormant in-window: nothing to expect, nothing to flag

  const pairs = fams.flatMap((f) => f.levels
    .filter((lv) => !GRAIN_SUBSET.has(`${c.platform}|${f.bt}|${lv}`)) // per-grain subset exception (the law)
    .map((lv) => ({ f, lv })))
  if (!pairs.length) continue
  const values = pairs.map((_, i) => `($${i * 2 + 4}, $${i * 2 + 5})`).join(',')
  const params = [c.client_id, c.platform, WINDOW_DAYS, ...pairs.flatMap((p) => [p.f.bt, p.lv])]

  const probe = await q(
    `with act as (
        select m.date from metrics_daily m
         where m.client_id = $1 and m.platform = $2 and m.entity_level = 'account'
           and m.breakdown_type = '' and m.breakdown_value = ''
           and m.date >= current_date - $3::int and ${ACTIVE})
      select f.bt, f.lvl,
             (select count(*)::int from metrics_daily m
               where m.client_id = $1 and m.platform = $2 and m.breakdown_type = f.bt
                 and m.entity_level = f.lvl and m.date >= current_date - $3::int) as rows_in_window,
             (select max(m.date) from metrics_daily m
               where m.client_id = $1 and m.platform = $2 and m.breakdown_type = f.bt
                 and m.entity_level = f.lvl) as last_landed,
             (select count(*)::int from act a where not exists (
                select 1 from metrics_daily m
                 where m.client_id = $1 and m.platform = $2 and m.breakdown_type = f.bt
                   and m.entity_level = f.lvl and m.date = a.date)) as missing_active_days
        from (values ${values}) as f(bt, lvl)`,
    params)

  for (const r of probe) {
    const f = fams.find((x) => x.bt === r.bt)
    // FLEET-EVER, not fleet-in-window. A family with real history but nothing in the last 90 days is SPARSE, not
    // absent — counting only the window turned google.geo_district / geo_province (which genuinely do not exist for
    // US advertisers) into false CONDITIONAL-ZEROs on the first run. last_landed is max(date) over ALL time.
    const k = `${c.platform}|${r.bt}`
    seenPlatformFamily.set(k, (seenPlatformFamily.get(k) || 0) + (r.last_landed ? 1 : 0))
    results.push({
      clientId: c.client_id, client: c.name, platform: c.platform, bt: r.bt, level: r.lvl,
      posture: f.posture, why: f.why,
      activeDays: anchor.active_days, lastActive: anchor.last_active,
      rows: r.rows_in_window, lastLanded: r.last_landed, missingDays: r.missing_active_days,
    })
  }
}
// ── SECOND ASSERTION (LORAMER_ACCOUNT_ROW_INVARIANT_V1) — also runs in the full pass, reusing this connection ──
await runAccountRowInvariant(conns, q, { gateA: RUN_GATE_A })

await client.end()

// ── 4. verdicts ─────────────────────────────────────────────────────────────────────────────────────────────────
const iso = (d) => (d ? new Date(d).toISOString().slice(0, 10) : 'never')
const failures = []
for (const r of results) {
  if (r.posture === 'PARTITIONING') {
    if (r.missingDays > 0) failures.push({ ...r, tag: 'PARTITIONING-GAP' })
  } else if (r.posture === 'CONDITIONAL') {
    // ONLY the fleet-ever-zero clause is implemented. The second clause Russ specified — "zero on a client that HAS
    // the qualifying event" — is NOT implemented and is NOT silently approximated: the qualifying event is
    // family-specific (an order carrying a code for discount_code, an abandoned checkout for abandoned_checkout, a
    // shipping address for store geo) and is not derivable from the registry. Approximating it would manufacture
    // exactly the sparse-day false alarms this standard exists to avoid. Stated as a limitation, not papered over.
    const fleetClientsWithRows = seenPlatformFamily.get(`${r.platform}|${r.bt}`) || 0
    if (fleetClientsWithRows === 0) failures.push({ ...r, tag: 'CONDITIONAL-ZERO', scope: 'fleet-ever' })
  }
}
const key = (f) => `${f.platform}.${f.bt}.${f.level}`
const byFamily = new Map()
for (const f of failures) {
  const e = byFamily.get(key(f)) || { key: key(f), tag: f.tag, posture: f.posture, clients: [] }
  e.clients.push(f)
  byFamily.set(key(f), e)
}

if (AS_JSON) { console.log(JSON.stringify({ window: WINDOW_DAYS, failures, baseline: [...byFamily.keys()] }, null, 2)); process.exit(0) }

console.log('LORAMER_CAPTURE_LANDING_GATE_V1 (STANDARD C — live DB, read-only)')
console.log(`  window : last ${WINDOW_DAYS} days   probes : ${results.length}   connections : ${conns.length}`)
const counts = families.reduce((a, f) => { a[f.posture] = (a[f.posture] || 0) + 1; return a }, {})
console.log(`  families: PARTITIONING ${counts.PARTITIONING || 0} · CONDITIONAL ${counts.CONDITIONAL || 0} · UNCLASSIFIED ${counts.UNCLASSIFIED || 0} (unclassified are reported, never failed)`)

console.log('\nUNCLASSIFIED (posture not derivable from the banked law — decide, then re-run):')
for (const f of families.filter((x) => x.posture === 'UNCLASSIFIED')) console.log(`  ${f.platform}.${f.bt} — ${f.why}`)

console.log(`\nLANDING FAILURES — ${failures.length} (family × client × grain):`)
for (const e of [...byFamily.values()].sort((a, b) => a.key.localeCompare(b.key))) {
  console.log(`\n  ${e.tag}  ${e.key}   [${e.clients.length} client(s)]`)
  for (const c of e.clients.sort((a, b) => a.client.localeCompare(b.client))) {
    const label = `${c.client} (${String(c.clientId).slice(0, 8)})`
    console.log(`     ${label.padEnd(42)} lastLanded=${iso(c.lastLanded).padEnd(10)} anchorLastActive=${iso(c.lastActive)} missingActiveDays=${c.missingDays}/${c.activeDays}`)
  }
}

console.log('\nBASELINE SET the gate would write (WARN on these, FAIL on anything new):')
console.log('export const KNOWN_NOT_LANDING = [')
for (const k of [...byFamily.keys()].sort()) console.log(`  '${k}',`.padEnd(46) + `// ${byFamily.get(k).tag}, ${byFamily.get(k).clients.length} client(s)`)
console.log(']')
console.log('\n(read-only; nothing written, nothing wired into npm run guard)')

// ════════════════════════════════════════════════════════════════════════════════════════════════════════════════
// LORAMER_ACCOUNT_ROW_INVARIANT_V1 — SECOND ASSERTION: the account-row-per-day invariant.
//
// RULE: for every (client_id, platform, date) that has ANY row in metrics_daily, a row with
//   entity_level='account' AND breakdown_type='' AND breakdown_value=''  MUST exist for that same
//   (client_id, platform, date). A day with rows but no account row = INVARIANT VIOLATION.
// UNIFORM — NO family exemption (not for conditional / non-partitioning / write-only families): any row on a day
//   means the day WAS captured, so the account anchor must be there. This is deliberately stricter than the
//   landing gate's PARTITIONING/CONDITIONAL split above — that gate asks "should this breakdown exist on this day";
//   this assertion asks the platform-neutral question "does the anchor exist on any day we wrote anything".
// WHY IT MATTERS: this is the schema-UNENFORCED invariant the six latest-date reads
//   (LORAMER_LATEST_DATE_ACCOUNT_GRAIN_V1: money, store-detect, client-metrics, portfolio-metrics, ga-overview,
//   clients/metrics) silently depend on. A day with breakdown rows but no account row makes those reads skip it and
//   return a STALE (or null) "latest captured date" with NO error raised — a quiet-stale failure.
//
// INDEX DISCIPLINE (live statement_timeout is 8s; metrics_daily is ~34M rows): never an unconstrained scan. Every
// probe is bounded by client_id + platform so it rides the client-leading indexes, exactly like the landing gate:
//   allDates  — distinct date for (client, platform)            → idx_metrics_daily_client_platform_date
//   acctDates — distinct date + entity_level='account' filter   → idx_metrics_daily_client_platform_level_date
// Both are index-only distinct-date scans over ONE client×platform range; the diff (allDates − acctDates) is in JS.
// SCOPE (stated, not papered over): the driver is the connected (client, platform) pairs from platform_connections
// (same driver as the landing gate). A (client, platform) with historical metrics_daily rows but no current
// connection row is out of scope — deriving the pair-set from a fleet-wide DISTINCT would be the unbounded scan the
// 8s ceiling forbids.

// PURE core — Gate-A drives this directly with a modified comparison set, so a real catch is proven with NO DB write.
function accountRowViolations(allDates, acctDates) {
  const acct = new Set(acctDates)
  return allDates.filter((d) => !acct.has(d)).sort()
}

// Local-component date format (node-pg returns a DATE as a local-midnight JS Date, so getFullYear/Month/Date give the
// true calendar day). Both date-sets pass through this identically, so the set diff is timezone-invariant regardless.
function fmtDate(d) {
  const dt = d instanceof Date ? d : new Date(d)
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`
}

// Distinct captured dates for one (client, platform). accountOnly=true adds the account-triple filter.
//
// LOOSE INDEX SCAN (skip-scan emulation via a recursive CTE): enumerate DISTINCT dates with ONE index seek per date
// — anchor seeks MIN(date), each step seeks the next date > previous — instead of scanning the whole (client,
// platform) grain range. Cost is O(distinct-days), NOT O(rows). A plain GROUP BY/DISTINCT over the heaviest pair
// (Veterinary google = 4.8M rows) blows the pooled statement timeout; this recursive form returned its 122 distinct
// days in 243ms (EXPLAIN ANALYZE, all Index Only Scan limit-1 on idx_metrics_daily_client_platform_date; acctDates'
// triple predicate rides the partial idx_metrics_daily_account_canonical). No ceiling-raise — honours the 8s law.
// Formatting is done in JS so the index sort order is preserved.
async function datesFor(q, clientId, platform, accountOnly) {
  const filt = accountOnly ? `and m.entity_level = 'account' and m.breakdown_type = '' and m.breakdown_value = ''` : ``
  const rows = await q(
    `with recursive dd as (
        select (select m.date from metrics_daily m
                 where m.client_id = $1 and m.platform = $2 ${filt}
                 order by m.date asc limit 1) as date
      union all
        select (select m.date from metrics_daily m
                 where m.client_id = $1 and m.platform = $2 ${filt} and m.date > dd.date
                 order by m.date asc limit 1) as date
        from dd where dd.date is not null)
      select date from dd where date is not null order by date`,
    [clientId, platform])
  return rows.map((r) => fmtDate(r.date))
}

async function runAccountRowInvariant(conns, q, { gateA, guard, proveExact }) {
  console.log('\n════════════════════════════════════════════════════════════════════════════════════════════════════')
  console.log('LORAMER_ACCOUNT_ROW_INVARIANT_V1 (SECOND ASSERTION — live DB, read-only)')
  console.log("  rule: every (client, platform, date) with ANY row must carry an account row")
  console.log("        (entity_level='account', breakdown_type='', breakdown_value=''). Uniform — no family exemption.")

  let tuplesChecked = 0
  const violations = []
  const scannedPairs = new Set()
  for (const c of conns) {
    scannedPairs.add(`${c.client_id}|${c.platform}`)
    const allDates = await datesFor(q, c.client_id, c.platform, false)
    const acctDates = await datesFor(q, c.client_id, c.platform, true)
    tuplesChecked += allDates.length
    for (const d of accountRowViolations(allDates, acctDates))
      violations.push({ clientId: c.client_id, client: c.name, platform: c.platform, date: d })
  }

  // --prove-exact: inject a synthetic violation OUTSIDE the baselined range (in memory only, no DB write) to prove
  // the baseline is a bounded [from..to] window — this out-of-range Shelley woo day must NOT be baselined → guard fails.
  if (proveExact) {
    violations.push({ clientId: '23c697bb-5255-4289-9329-659544ba8e6e', client: 'Shelley Kyle (SYNTHETIC out-of-range)', platform: 'woocommerce', date: '2025-06-15', synthetic: true })
    console.log('\n  [--prove-exact] injected synthetic Shelley woo violation on 2025-06-15 (OUTSIDE the 2016..2018 baseline).')
  }

  console.log(`\n  (client, platform, date) tuples checked : ${tuplesChecked}`)
  console.log(`  invariant violations                    : ${violations.length}`)

  if (violations.length > 0) {
    // Full accounting so the total is never just "first 20" — one line per (client, platform) with count + date span.
    const byPair = new Map()
    for (const v of violations) {
      const k = `${v.client} (${String(v.clientId).slice(0, 8)}) · ${v.platform}`
      const e = byPair.get(k) || { n: 0, lo: v.date, hi: v.date }
      e.n++; if (v.date < e.lo) e.lo = v.date; if (v.date > e.hi) e.hi = v.date
      byPair.set(k, e)
    }
    console.log('\n  BY (client, platform) — all violations accounted for:')
    for (const [k, e] of [...byPair.entries()].sort((a, b) => b[1].n - a[1].n))
      console.log(`     ${k.padEnd(48)} ${String(e.n).padStart(5)} day(s)   ${e.lo} .. ${e.hi}`)

    console.log('\n  VIOLATIONS (up to 20) — client, platform, date, breakdown-rows-that-day:')
    for (const v of violations.slice(0, 20)) {
      const [row] = await q(
        `select count(*)::int as n from metrics_daily
          where client_id = $1 and platform = $2 and date = $3::date`,
        [v.clientId, v.platform, v.date])
      const label = `${v.client} (${String(v.clientId).slice(0, 8)})`
      console.log(`     ${label.padEnd(42)} ${v.platform.padEnd(12)} ${v.date}   rows=${row.n} (all breakdown; no account row)`)
    }
    if (violations.length > 20) console.log(`     … and ${violations.length - 20} more`)
  } else {
    console.log('  → invariant HOLDS across all connections in scope.')
  }

  if (gateA) await runGateA(conns, q)

  // GUARD verdict (blocking): classify every violation against the EXACT baseline windows.
  let exitCode = 0
  if (guard) {
    const { novel, stale } = classifyAgainstBaseline(violations, scannedPairs)
    console.log('\n  GUARD — baseline classification:')
    console.log(`     violations ${violations.length} · baselined ${violations.length - novel.length} · NEW ${novel.length} · stale-baseline ${stale.length}`)
    for (const b of stale)
      console.log(`     ⚠ STALE baseline (data now clean — remove this entry): ${String(b.clientId).slice(0, 8)} ${b.platform} ${b.from}..${b.to}`)
    if (novel.length) {
      console.error(`\n✗ ACCOUNT-ROW-INVARIANT GUARD FAILED — ${novel.length} violation(s) NOT covered by the baseline:`)
      for (const v of novel.slice(0, 20))
        console.error(`     ${v.client} (${String(v.clientId).slice(0, 8)}) ${v.platform} ${v.date}`)
      if (novel.length > 20) console.error(`     … and ${novel.length - 20} more`)
      console.error('  A day with rows but no account row breaks the six latest-date reads silently (LORAMER_LATEST_DATE_ACCOUNT_GRAIN_V1).')
      console.error('  FIX the capture, or (deliberately) extend scripts/account-row-invariant.baseline.mjs to grandfather a KNOWN hole.')
      exitCode = 1
    } else {
      console.log('  ✓ ACCOUNT-ROW-INVARIANT GUARD PASSED — every violation is within a baselined window (stale entries warned, non-fatal).')
    }
  }
  return { tuplesChecked, violations, exitCode }
}

// Classify violations against the EXACT baseline windows. A violation is baselined iff some entry matches its
// (clientId, platform) AND from <= date <= to. `stale` = baseline entries whose (client, platform) WAS scanned this
// run but produced zero matching violations (the hole is filled → the entry is clearable). Only scanned pairs can be
// judged stale, so a disconnected client is never falsely read as "fixed". Stale is a WARNING, not a failure: data
// getting BETTER must never brick a code deploy — the entry is simply owed removal at the next docs pass.
function classifyAgainstBaseline(violations, scannedPairs) {
  const inRange = (v, b) => v.clientId === b.clientId && v.platform === b.platform && v.date >= b.from && v.date <= b.to
  const novel = violations.filter((v) => !KNOWN_ACCOUNT_ROW_VIOLATIONS.some((b) => inRange(v, b)))
  const stale = KNOWN_ACCOUNT_ROW_VIOLATIONS.filter((b) =>
    scannedPairs.has(`${b.clientId}|${b.platform}`) && !violations.some((v) => inRange(v, b)))
  return { novel, stale }
}

// GATE-A (real inputs, no fixtures, no writes): prove the detector catches a missing-account-row day using REAL rows.
// Pick a real client+platform with a CLEAN baseline (0 real violations, ≥5 account dates), take its REAL account
// dates, EXCLUDE a handful from the comparison set IN MEMORY (nothing is deleted), and confirm accountRowViolations
// flags EXACTLY the excluded dates and nothing else. Each excluded date is a real captured day that carries an
// account row, so dropping it from the comparison set is a faithful stand-in for "the day has rows but its account
// row is gone" — precisely the violation this invariant exists to catch.
async function runGateA(conns, q) {
  console.log('\n  ── GATE-A (real-input, no fixtures, no writes) ──')
  for (const c of conns) {
    const allDates = await datesFor(q, c.client_id, c.platform, false)
    const acctDates = await datesFor(q, c.client_id, c.platform, true)
    const baseline = accountRowViolations(allDates, acctDates)
    if (baseline.length !== 0 || acctDates.length < 5) continue // need a clean baseline with room to exclude
    const pick = [...new Set([acctDates[1], acctDates[Math.floor(acctDates.length / 2)], acctDates[acctDates.length - 2]])].sort()
    const reducedAcct = acctDates.filter((d) => !pick.includes(d))
    const flagged = accountRowViolations(allDates, reducedAcct)
    const exact = flagged.length === pick.length && flagged.every((d, i) => d === pick[i])
    console.log(`  client   : ${c.name} (${String(c.client_id).slice(0, 8)})  platform=${c.platform}`)
    console.log(`  real set : ${allDates.length} total dates · ${acctDates.length} account dates · ${baseline.length} baseline violations`)
    console.log(`  excluded : ${pick.join(', ')}   (removed from the comparison set only — no DB rows touched)`)
    console.log(`  flagged  : ${flagged.join(', ') || '(none)'}`)
    console.log(`  result   : ${exact ? 'PASS — flagged EXACTLY the excluded dates, nothing else' : 'FAIL — mismatch'}`)
    return { exact, client: c.name, platform: c.platform, excluded: pick, flagged }
  }
  console.log('  (no client+platform with a clean baseline and ≥5 account dates found — cannot run Gate-A cleanly)')
  return null
}
