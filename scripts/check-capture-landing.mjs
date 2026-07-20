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

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const read = (rel) => { try { return readFileSync(resolve(ROOT, rel), 'utf8') } catch { return null } }
const arg = (k, d) => { const a = process.argv.find((s) => s.startsWith(`--${k}=`)); return a ? a.split('=')[1] : d }
const WINDOW_DAYS = Number(arg('days', 90))
const AS_JSON = process.argv.includes('--json')

for (const line of (read('.env.local') || '').split('\n')) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/)
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '')
}
if (!process.env.SUPABASE_DB_URL) { console.error('✗ landing gate: SUPABASE_DB_URL missing (.env.local)'); process.exit(2) }

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
