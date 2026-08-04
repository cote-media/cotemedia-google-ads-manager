#!/usr/bin/env node
// LORAMER_STEADY_STATE_MEASURE_V1 — the tier decision, measured rather than guessed.
//
// RUN THIS AFTER DROPPING COMPUTE TO SMALL:
//   node scripts/steady-state-measure.mjs
//
// ⛔ WHY IT EXISTS. Every latency number this project holds was taken on XL — several of them against
// the OLD UNSPLIT table, which is the worst possible combination. Choosing the permanent tier from
// those figures would mean paying for XL forever to solve a problem partitioning already solved.
// This script re-runs the SAME queries and prints the new numbers BESIDE the old ones, each labelled
// with the tier and table it was taken on, so the comparison cannot be made dishonestly by accident.
//
// ⛔ IT CHANGES NOTHING. Read-only apart from one upsert probe, which it removes. It does not resize
// compute, does not touch metrics_daily_old, and does not drop anything.
import { readFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
for (const l of readFileSync(resolve(ROOT, '.env.local'), 'utf8').split('\n')) {
  const m = /^([A-Z_][A-Z0-9_]*)=(.*)$/.exec(l.trim()); if (m && !process.env[m[1]]) process.env[m[1]] = m[2]
}

// ── THE BASELINES, TENSE-LOCKED. Every one measured 2026-08-03/04. ─────────────────────────────────
// ⛔ EACH CARRIES ITS TIER AND ITS TABLE. A number without both is not comparable to anything.
const BASELINE = {
  geoColdOldXL:   { ms: 28257, note: 'XL · OLD UNSPLIT table · COLD — the number that started all of this' },
  geoWarmOldXL:   { ms: 1570,  note: 'XL · OLD UNSPLIT table · WARM' },
  geoColdNewXL:   { ms: 3627,  note: 'XL · partitioned, BEFORE analyze · COLD — plan was suboptimal, see below' },
  geoWarmNewXL:   { ms: 984,   note: 'XL · partitioned, AFTER analyze · WARM — the good plan' },
  // ⚠ geo COLD on the partitioned table WITH good statistics was NEVER MEASURED on XL: by the time
  // ANALYZE had run, the pages were already cached, and a managed Postgres gives no way to evict
  // them. That gap is stated rather than filled with a guess — this run is the first honest cold
  // reading of the good plan, and it will be on SMALL.
  geoColdNewAnalyzedXL: { ms: null, note: 'NEVER MEASURED — see comment' },
  sharedBuffersXL: '4GB', effectiveCacheXL: '12GB',
}

const CLIENT = '957d484e-d0c4-4dd0-b382-d8499d556252'
const GEO_SQL = `
  select breakdown_value, sum(spend) s, sum(impressions) i
  from metrics_daily
  where client_id=$1 and platform='google'
    and breakdown_type='geo_target_most_specific_location' and entity_level='user_location_view'
    and date between '2026-03-07' and '2026-04-05'
  group by 1`
// A representative Lora question at the grain she actually uses: account totals over a month.
const LORA_SQL = `
  select date, sum(spend) s, sum(impressions) i, sum(clicks) c, sum(conversions) cv
  from metrics_daily
  where client_id=$1 and platform='google' and entity_level='account'
    and breakdown_type='' and date between '2026-03-07' and '2026-04-05'
  group by date order by date`

const ms = (t) => Number((Number(process.hrtime.bigint() - t) / 1e6).toFixed(1))
const cmp = (now, base) => base?.ms ? `${(base.ms / now).toFixed(1)}× vs ${base.ms} ms` : 'no comparable baseline'

const { default: pg } = await import('pg')
const c = new pg.Client({ connectionString: process.env.SUPABASE_DB_URL })
await c.connect()
await c.query("SET statement_timeout='0'")

const { rows: cfg } = await c.query(`
  select current_setting('shared_buffers') sb, current_setting('effective_cache_size') ecs,
         current_setting('maintenance_work_mem') mwm, current_setting('work_mem') wm,
         current_setting('max_parallel_workers') mpw`)
const { rows: hit } = await c.query(`
  select round(100.0*sum(heap_blks_hit)/nullif(sum(heap_blks_hit)+sum(heap_blks_read),0),3) heap_pct,
         round(100.0*sum(idx_blks_hit)/nullif(sum(idx_blks_hit)+sum(idx_blks_read),0),3) idx_pct
  from pg_statio_user_tables where relname like 'metrics_daily%'`)

console.log('═══ TIER BEING MEASURED NOW ═══')
console.log(`  shared_buffers ${cfg[0].sb} · effective_cache_size ${cfg[0].ecs} · maintenance_work_mem ${cfg[0].mwm}`)
console.log(`  work_mem ${cfg[0].wm} · max_parallel_workers ${cfg[0].mpw}`)
console.log(`  cache hit (cumulative): heap ${hit[0].heap_pct}% · index ${hit[0].idx_pct}%`)
console.log(`  ⛔ FOR REFERENCE, XL WAS: shared_buffers ${BASELINE.sharedBuffersXL} · effective_cache_size ${BASELINE.effectiveCacheXL}`)
console.log(`\n  ⚠ IF shared_buffers STILL READS ${BASELINE.sharedBuffersXL}, THE RESIZE HAS NOT TAKEN EFFECT — stop and re-check before trusting anything below.\n`)

// ── 1. THE WORST GEO READ, COLD THEN WARM ─────────────────────────────────────────────────────────
// ⛔ "COLD" HERE MEANS FIRST-TOUCH-AFTER-RESTART, WHICH IS WHAT A COMPUTE RESIZE GIVES US FOR FREE.
// It is the only honest cold reading available on managed Postgres — there is no way to evict the
// buffer cache on demand. RUN THIS SCRIPT FIRST, BEFORE ANY OTHER QUERY, or the cold number is warm.
let t = process.hrtime.bigint()
await c.query(GEO_SQL, [CLIENT])
const geoCold = ms(t)
t = process.hrtime.bigint()
await c.query(GEO_SQL, [CLIENT])
const geoWarm = ms(t)

// ── 2. A REPRESENTATIVE LORA QUERY ────────────────────────────────────────────────────────────────
t = process.hrtime.bigint()
const { rows: lora } = await c.query(LORA_SQL, [CLIENT])
const loraMs = ms(t)

// ── 3. PARTITION PRUNING STILL HAPPENING? ⛔ A fast query that scans 145 partitions is luck, not design.
const { rows: plan } = await c.query({ text: `explain (analyze, buffers) ${GEO_SQL}`, values: [CLIENT], rowMode: 'array' })
const planText = plan.map((r) => r[0]).join('\n')
const scanned = (planText.match(/metrics_daily_p_\d{4}_\d{2}/g) || []).filter((v, i, a) => a.indexOf(v) === i)
const filtered = /Rows Removed by Filter: ([\d,]+)/.exec(planText)

console.log('═══ RESULTS ON THIS TIER ═══')
console.log(`  worst geo read COLD : ${geoCold} ms   (${cmp(geoCold, BASELINE.geoColdOldXL)} on the OLD table)`)
console.log(`  worst geo read WARM : ${geoWarm} ms   (${cmp(geoWarm, BASELINE.geoWarmOldXL)} on the OLD table)`)
console.log(`  representative Lora : ${loraMs} ms   (${lora.length} rows — account totals by day, one month)`)
console.log(`  partitions scanned  : ${scanned.length} → ${scanned.join(', ') || '(none named — CHECK THE PLAN)'}`)
console.log(`  filter discard      : ${filtered ? '⛔ ' + filtered[1] + ' rows — statistics are stale, run ANALYZE' : 'none — statistics are good'}`)

// ── 4. A REAL UPSERT THROUGH THE ACTUAL WRITER, TIMED ─────────────────────────────────────────────
// ⛔ Not raw SQL. The walk's throughput is what upsertMetricsChunked achieves, not what INSERT does.
console.log('\n═══ WRITE PATH ═══')
try {
  const { execFileSync } = await import('node:child_process')
  const out = execFileSync('node', [resolve(ROOT, 'scripts/steady-state-upsert-probe.cjs')], { encoding: 'utf8' })
  process.stdout.write(out)
} catch (e) {
  console.log(`  ⚠ upsert probe did not run: ${String(e.message).slice(0, 200)}`)
  console.log(`     (measure it by hand before deciding — the walk's throughput is a write number, not a read one)`)
}

console.log(`\n═══ ⛔ THE COMPARISON, STATED SO IT CANNOT BE MADE DISHONESTLY ═══`)
console.log(`  ${String(BASELINE.geoColdOldXL.ms).padStart(6)} ms  ${BASELINE.geoColdOldXL.note}`)
console.log(`  ${String(BASELINE.geoWarmOldXL.ms).padStart(6)} ms  ${BASELINE.geoWarmOldXL.note}`)
console.log(`  ${String(BASELINE.geoColdNewXL.ms).padStart(6)} ms  ${BASELINE.geoColdNewXL.note}`)
console.log(`  ${String(BASELINE.geoWarmNewXL.ms).padStart(6)} ms  ${BASELINE.geoWarmNewXL.note}`)
console.log(`     never  ${BASELINE.geoColdNewAnalyzedXL.note}`)
console.log(`  ${String(geoCold).padStart(6)} ms  THIS RUN · COLD · partitioned + analyzed · tier above`)
console.log(`  ${String(geoWarm).padStart(6)} ms  THIS RUN · WARM · partitioned + analyzed · tier above`)
console.log(`\n  ⛔ THE TIER DECISION RULE IS IN docs/LORAMER_MORNING_RUNBOOK_2026_08_04.md AND WAS WRITTEN`)
console.log(`     BEFORE THESE NUMBERS EXISTED. Read it there; do not invent a threshold to fit the result.`)

await c.end()
