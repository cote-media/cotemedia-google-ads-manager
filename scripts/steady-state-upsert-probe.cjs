#!/usr/bin/env node
// LORAMER_STEADY_STATE_MEASURE_V1 — the WRITE half, through the REAL writer.
//
// ⛔ NOT RAW SQL, AND THAT IS THE POINT. The walk's throughput is whatever upsertMetricsChunked
// achieves against the live conflict key, chunked exactly as production chunks it. A bare INSERT
// would measure a code path nothing uses and flatter the result.
//
// Called by scripts/steady-state-measure.mjs. Writes 5,000 probe rows across three partitions,
// times the upsert, then DELETES every one of them. Leaves nothing behind.
const fs = require('fs'), path = require('path'), os = require('os')
const { execFileSync } = require('child_process')
const ROOT = path.resolve(__dirname, '..')
for (const l of fs.readFileSync(path.join(ROOT, '.env.local'), 'utf8').split('\n')) {
  const m = /^([A-Z_][A-Z0-9_]*)=(.*)$/.exec(l.trim()); if (m && !process.env[m[1]]) process.env[m[1]] = m[2]
}
if (typeof globalThis.WebSocket === 'undefined') globalThis.WebSocket = class { constructor() {} close() {} }

const PROBE_PLATFORM = '__steady_state_probe'
const N = 5000

;(async () => {
  // Compile the real writer the same way the guards do — no copy of the logic, the actual module.
  const out = fs.mkdtempSync(path.join(os.tmpdir(), 'loramer-steady-'))
  const cfg = path.join(out, 'tsconfig.json')
  // ⛔ typeRoots IS NOT OPTIONAL HERE, and its absence is what broke the first run: the config lives in
  // a temp dir, so tsc resolves @types RELATIVE TO THE CONFIG, finds nothing, and fails on `process`
  // with "Cannot find name 'process'". Point it back at the repo's own @types explicitly.
  fs.writeFileSync(cfg, JSON.stringify({
    compilerOptions: { module: 'commonjs', target: 'es2020', moduleResolution: 'node', skipLibCheck: true,
      esModuleInterop: true, rootDir: ROOT, baseUrl: ROOT, paths: { '@/*': ['src/*'] }, outDir: out,
      typeRoots: [path.join(ROOT, 'node_modules/@types')], types: ['node'] },
    files: [path.join(ROOT, 'src/lib/metrics-upsert.ts'), path.join(ROOT, 'src/lib/supabase.ts')],
  }))
  try {
    execFileSync(path.join(ROOT, 'node_modules/.bin/tsc'), ['-p', cfg], { stdio: 'pipe' })
  } catch (e) {
    // ⛔ SHOW THE COMPILER'S OWN WORDS. The first version swallowed them into "Command failed" and
    // cost a debugging round-trip for what was a one-line config error.
    throw new Error(`tsc failed:\n${String(e.stdout || '').trim() || String(e.message)}`)
  }
  try { fs.symlinkSync(path.join(ROOT, 'node_modules'), path.join(out, 'node_modules')) } catch {}

  const Module = require('module'); const orig = Module._resolveFilename
  Module._resolveFilename = function (req, ...a) {
    if (req.startsWith('@/')) return path.join(out, 'src', req.slice(2) + '.js')
    return orig.call(this, req, ...a)
  }
  const { upsertMetricsChunked } = require(path.join(out, 'src/lib/metrics-upsert.js'))

  const dates = ['2026-08-04', '2025-11-15', '2024-02-29']   // three different partitions on purpose
  const rows = Array.from({ length: N }, (_, i) => ({
    client_id: '00000000-0000-0000-0000-000000000000', user_email: 'steady@probe', platform: PROBE_PLATFORM,
    account_id: 'probe', entity_level: 'account', entity_id: 'e' + (i % 500), entity_name: null,
    parent_entity_id: null, date: dates[i % 3], breakdown_type: '__probe', breakdown_value: 'v' + i,
    spend: 1, impressions: 10, clicks: 1, conversions: 0, conversion_value: 0, revenue: 0, extra: null,
  }))

  const t0 = Date.now()
  const r = await upsertMetricsChunked(rows)
  const insertMs = Date.now() - t0

  // ⛔ THE SECOND PASS IS THE ONE THAT MATTERS FOR THE WALK. Re-walking existing ground is an UPDATE
  // path, which metrics-upsert's own header calls out as orders of magnitude dearer than an insert.
  const t1 = Date.now()
  await upsertMetricsChunked(rows)
  const updateMs = Date.now() - t1

  console.log(`  upsert INSERT path : ${insertMs} ms for ${r.written.toLocaleString()} rows in ${r.chunks} chunk(s) — ${Math.round(N / (insertMs / 1000)).toLocaleString()} rows/s`)
  console.log(`  upsert UPDATE path : ${updateMs} ms for the SAME rows — ${Math.round(N / (updateMs / 1000)).toLocaleString()} rows/s  ⛔ this is the re-walk cost`)

  const { default: pg } = await import('pg')
  const c = new pg.Client({ connectionString: process.env.SUPABASE_DB_URL })
  await c.connect()
  const del = await c.query(`delete from public.metrics_daily where platform = $1`, [PROBE_PLATFORM])
  const { rows: left } = await c.query(`select count(*)::int n from public.metrics_daily where platform = $1`, [PROBE_PLATFORM])
  await c.end()
  console.log(`  probe cleanup      : ${del.rowCount.toLocaleString()} deleted · ${left[0].n} remaining ${left[0].n === 0 ? '✓' : '⛔ PROBE ROWS LEFT BEHIND'}`)
})().catch((e) => { console.error('  ⚠ upsert probe FAILED:', e.message); process.exit(1) })
