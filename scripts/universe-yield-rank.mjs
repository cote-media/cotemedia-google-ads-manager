#!/usr/bin/env node
// LORAMER_UNIVERSE_YIELD_RANK_V1 — RANK EVERY REQUESTED ENTRY BY MEASURED YIELD. READ-ONLY.
//
// ⛔ WHY THIS IS A SCRIPT AND NOT AN MCP QUERY: the aggregate is over the 6,048,263 rows one window
// of one client landed, and it exceeds the MCP statement ceiling. This runs on the direct pg
// connection with statement_timeout 0, the same posture as scripts/partition-backfill.mjs.
//
// ⛔ IT WRITES NOTHING. No upsert, no DDL, no vendor call. Zero Google Ads quota.
//
// AN "ENTRY" IS (entity_level, breakdown_type) — the GAQL FROM resource and its segment
// (LORAMER_UNIVERSE_ENTITY_AXIS_V1). One entry × one window = ONE request, so for a single window
// ROWS PER REQUEST IS SIMPLY ROWS PER ENTRY. That identity is why this ranking is honest: it is not
// a proxy for cost, it IS the cost.
import { readFileSync, writeFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
for (const l of readFileSync(resolve(ROOT, '.env.local'), 'utf8').split('\n')) {
  const m = /^([A-Z_][A-Z0-9_]*)=(.*)$/.exec(l.trim()); if (m && !process.env[m[1]]) process.env[m[1]] = m[2]
}

const CLIENT = '957d484e-d0c4-4dd0-b382-d8499d556252'   // Foam OH — the measured window's account
const WINDOW = { start: '2026-03-07', end: '2026-04-05' }
const BYTES_PER_ROW = 832        // MEASURED for this shape (heap 500 / index 332), not the 740 average
const WINDOWS_IN_WALK = 50
const USABLE_BYTES = 49 * 1024 ** 3

// ⛔ THE DENOMINATOR IS THE ARTIFACT, NOT THE TABLE, AND GETTING THIS WRONG IS THE EASY MISTAKE.
// A naive `group by entity_level, breakdown_type` over the window returns 541 entries / 11,707,353
// rows — because metrics_daily at that window holds the UNION of the universe write AND the ordinary
// forward/drain/backfill capture, which writes byte-identical rows to the same conflict key by
// design. Ranking that union would rank other lanes' work as if the walk produced it.
// So the key set comes from selectableEntries() — literally the 356 entries the walk requests.
// ⚠ THE HONEST RESIDUAL, stated rather than hidden: at grains the walk SHARES with legacy capture
// (campaign/geo_city, ad_group/device, …) the row count is still the union of both writers, because
// the two are indistinguishable on purpose. Those counts are therefore a CEILING on the walk's own
// yield at those grains, never an undercount — which is the safe direction for a cut decision.
const { execFileSync } = await import('node:child_process')
// ⛔ THE SELECTION IS READ FROM THE WRITER, NEVER REIMPLEMENTED HERE. selectableEntries() already
// encodes three rules (delivers, dateCombinable, derived-time exclusion) and a copy of them in this
// script would drift from the walk the moment any one changes — ranking a set the walk does not
// request. The WebSocket shim is only needed because the writer transitively imports the Supabase
// client, which constructs a realtime client on Node 20; nothing here touches the network.
const artifactKeys = JSON.parse(execFileSync('npx', ['tsx', '-e', `
  globalThis.WebSocket = globalThis.WebSocket || class { constructor() {} close() {} }
  import('./src/lib/backfill/google-ads-universe-writer').then((mod) => {
    const m = mod.default && mod.default.loadUniverse ? mod.default : mod
    const es = m.selectableEntries(m.loadUniverse())
    process.stdout.write(JSON.stringify(es.map((e) => [m.entityLevelFor(e), m.breakdownTypeFor(e)])))
  }).catch((e) => { console.error(e); process.exit(1) })
`], { cwd: ROOT, encoding: 'utf8', maxBuffer: 1 << 24 }).trim())
// ⛔ ONE SEPARATOR, WRITTEN AS A PLAIN SPACE. The first version of this line carried a LITERAL NUL
// byte in the source — the exact hazard cron-connection-outcome.ts warns about ("a raw NUL makes
// the file binary to grep") — while every comparison below used a space, so NOTHING ever matched
// and the script cheerfully reported 358 entries yielding zero rows. entity_level and
// breakdown_type are bare identifiers and cannot contain a space, so a space is unambiguous here.
const K = (lvl, bt) => `${lvl} ${bt}`
const KEYSET = new Set(artifactKeys.map(([lvl, bt]) => K(lvl, bt)))
console.log(`ARTIFACT: ${artifactKeys.length} selectable entries (the set the walk actually requests)`)

const { default: pg } = await import('pg')
const c = new pg.Client({ connectionString: process.env.SUPABASE_DB_URL })
await c.connect()
await c.query(`SET statement_timeout = '0'`)

const { rows } = await c.query(`
  select entity_level, breakdown_type,
         count(*)::bigint                       as rows,
         count(distinct entity_id)::bigint      as entities,
         count(distinct breakdown_value)::bigint as values,
         count(distinct date)::int              as days
  from public.metrics_daily
  where client_id = $1 and platform = 'google' and date between $2 and $3
  group by 1, 2`, [CLIENT, WINDOW.start, WINDOW.end])

const mb = (b) => b / 1024 ** 2

// ⛔ RESTRICT TO THE ARTIFACT'S OWN KEY SET, and account for BOTH directions of mismatch.
if (process.env.DEBUG_KEYS) {
  console.log('ARTIFACT sample:', [...KEYSET].slice(0, 6))
  console.log('DB sample      :', rows.slice(0, 6).map((r) => K(r.entity_level, r.breakdown_type)))
  const dbSet = new Set(rows.map((r) => K(r.entity_level, r.breakdown_type)))
  console.log('INTERSECTION   :', [...KEYSET].filter((k) => dbSet.has(k)).length)
  console.log('geographic_view in artifact:', [...KEYSET].filter((k) => k.startsWith('geographic_view')).slice(0, 4))
  console.log('geographic_view in DB      :', [...dbSet].filter((k) => k.startsWith('geographic_view')).slice(0, 4))
}
const landed = rows.filter((r) => KEYSET.has(K(r.entity_level, r.breakdown_type)))
const foreign = rows.filter((r) => !KEYSET.has(K(r.entity_level, r.breakdown_type)))
const foreignRows = foreign.reduce((a, r) => a + Number(r.rows), 0)
// ⛔ ZERO IS A FACT, NOT A SKIP: an artifact entry with NO row in the window is a real measurement
// — the vendor was asked and named nothing — and dropping it would flatter the fill-rate picture.
const landedKeys = new Set(landed.map((r) => K(r.entity_level, r.breakdown_type)))
const missing = artifactKeys.filter(([l, b]) => !landedKeys.has(K(l, b)))
console.log(`  matched in the window: ${landed.length} · returned ZERO rows: ${missing.length} · non-artifact grains excluded: ${foreign.length} (${foreignRows.toLocaleString()} rows — other lanes' capture, not the walk's)`)

const total = landed.reduce((a, r) => a + Number(r.rows), 0)

const entries = landed.map((r) => {
  const n = Number(r.rows)
  const days = Number(r.days)
  const entities = Number(r.entities)
  const values = Number(r.values)
  // FILL RATE — landed rows as a fraction of the dense grid this entry COULD have produced
  // (entities × values × days). ⛔ This is the number that separates "the vendor had little to say"
  // from "we asked for a cross-product that was always going to be mostly empty".
  const dense = entities * values * days
  return {
    entry: `${r.entity_level}${r.breakdown_type ? '/' + r.breakdown_type : ''}`,
    entityLevel: r.entity_level, breakdownType: r.breakdown_type,
    rows: n, entities, values, days,
    fillPct: dense > 0 ? (n / dense) * 100 : null,
    // ONE ENTRY × ONE WINDOW = ONE REQUEST. rows-per-request IS rows.
    rowsPerRequest: n,
    windowMB: mb(n * BYTES_PER_ROW),
    walkGB: (n * BYTES_PER_ROW * WINDOWS_IN_WALK) / 1024 ** 3,
    shareOfMassPct: (n / total) * 100,
  }
}).concat(missing.map(([l, b]) => ({
  entry: `${l}${b && b !== l ? '/' + b : ''}`, entityLevel: l, breakdownType: b,
  rows: 0, entities: 0, values: 0, days: 0, fillPct: 0, rowsPerRequest: 0,
  windowMB: 0, walkGB: 0, shareOfMassPct: 0,
  note: 'ZERO ROWS IN THIS WINDOW — the vendor was asked and named nothing. A FACT, not a skip.',
}))).sort((a, b) => b.rows - a.rows)

// ── THE DISTRIBUTION, NOT A SUMMARY ───────────────────────────────────────────────────────────────
const pct = (p) => { const s = [...entries].sort((a, b) => a.rows - b.rows); return s[Math.min(s.length - 1, Math.floor((s.length - 1) * p))].rows }
console.log(`ENTRIES: ${entries.length} · ROWS: ${total.toLocaleString()} · WINDOW ${WINDOW.start}..${WINDOW.end} · Foam OH`)
console.log(`projected for 50 windows: ${((total * BYTES_PER_ROW * WINDOWS_IN_WALK) / 1024 ** 3).toFixed(1)} GB/client at ${BYTES_PER_ROW} B/row`)
console.log(`\nROWS-PER-ENTRY PERCENTILES: p10 ${pct(0.10).toLocaleString()} · p25 ${pct(0.25).toLocaleString()} · p50 ${pct(0.50).toLocaleString()} · p75 ${pct(0.75).toLocaleString()} · p90 ${pct(0.90).toLocaleString()} · max ${pct(1).toLocaleString()}`)

// Cumulative mass — the shape of the decision.
let cum = 0
const marks = [50, 80, 90, 95, 99]
const cumAt = {}
entries.forEach((e, i) => {
  cum += e.rows
  for (const m of marks) if (cumAt[m] === undefined && (cum / total) * 100 >= m) cumAt[m] = i + 1
})
console.log(`\nCUMULATIVE MASS — how few entries carry how much:`)
for (const m of marks) console.log(`  ${String(m).padStart(3)}% of all rows comes from the top ${String(cumAt[m]).padStart(3)} entries (${((cumAt[m] / entries.length) * 100).toFixed(0)}% of the set)`)

const band = (lo, hi) => entries.filter((e) => e.rows >= lo && e.rows < hi)
console.log(`\nBANDS BY ROWS PER REQUEST:`)
for (const [lo, hi, name] of [[0, 1, 'ZERO — vendor answered, named nothing'], [1, 100, '1–99'], [100, 1_000, '100–999'], [1_000, 10_000, '1k–9,999'], [10_000, 100_000, '10k–99,999'], [100_000, Infinity, '100k+']]) {
  const b = band(lo, hi)
  if (!b.length) continue
  const r = b.reduce((a, e) => a + e.rows, 0)
  console.log(`  ${name.padEnd(38)} ${String(b.length).padStart(3)} entries · ${r.toLocaleString().padStart(10)} rows · ${((r / total) * 100).toFixed(1).padStart(5)}% of mass · ${((r * BYTES_PER_ROW * WINDOWS_IN_WALK) / 1024 ** 3).toFixed(1).padStart(6)} GB/walk`)
}

console.log(`\nTOP 25 BY YIELD (the mass):`)
console.log(`  ${'entry'.padEnd(52)} ${'rows/req'.padStart(9)} ${'fill%'.padStart(7)} ${'GB/walk'.padStart(8)} ${'mass%'.padStart(6)}`)
for (const e of entries.slice(0, 25)) {
  console.log(`  ${e.entry.slice(0, 52).padEnd(52)} ${e.rows.toLocaleString().padStart(9)} ${(e.fillPct === null ? '—' : e.fillPct.toFixed(1)).padStart(7)} ${e.walkGB.toFixed(2).padStart(8)} ${e.shareOfMassPct.toFixed(2).padStart(6)}`)
}

console.log(`\nBOTTOM 30 BY YIELD (⛔ LOW YIELD IS NOT LOW VALUE — this list is evidence, not a cut list):`)
console.log(`  ${'entry'.padEnd(52)} ${'rows/req'.padStart(9)} ${'fill%'.padStart(7)} ${'GB/walk'.padStart(8)}`)
for (const e of entries.slice(-30)) {
  console.log(`  ${e.entry.slice(0, 52).padEnd(52)} ${e.rows.toLocaleString().padStart(9)} ${(e.fillPct === null ? '—' : e.fillPct.toFixed(1)).padStart(7)} ${e.walkGB.toFixed(2).padStart(8)}`)
}

writeFileSync(resolve(ROOT, 'docs/universe-yield-rank.json'),
  JSON.stringify({ measuredAt: 'window ' + WINDOW.start + '..' + WINDOW.end, client: 'Foam OH', bytesPerRow: BYTES_PER_ROW, windowsInWalk: WINDOWS_IN_WALK, usableBytes: USABLE_BYTES, totalRows: total, entries }, null, 2))
console.log(`\nwrote docs/universe-yield-rank.json (${entries.length} entries, full ranking — the report shows extremes, the file holds all of it)`)

await c.end()
