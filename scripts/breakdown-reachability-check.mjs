// LORAMER_BREAKDOWN_REACHABILITY_CHECK_V1  (G2 STEP 2B)
//
// The check the BUILD GUARD structurally CANNOT do. It diffs the LIVE database's DISTINCT (platform,
// breakdown_type, entity_level) tuples against what breakdown-registry.ts declares, and reports any
// CAPTURED-but-UNADMITTED tuple — a dimension we are paying to store that Lora cannot read.
//
// ⚠ THIS is the honest half of the pair. The build guard (tests/guards/breakdown-registry-drift.guard.mjs) proves
// the schema and query layer don't drift from the registry — but CI has no network and the DB is prod, so it can
// NEVER prove Lora reaches every captured row. A GREEN BUILD GUARD IS NOT "LORA SEES EVERYTHING." This script is.
// It is NOT a build gate (it needs the prod DB); run it manually or on a cron and read the diff.
//
//   Run:  node scripts/breakdown-reachability-check.mjs        (needs SUPABASE_DB_URL in .env.local + the `pg` pkg)
//   Exit: 0 always (it is a REPORT, not a gate). A non-empty "captured-but-unadmitted" list = work to do.
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const env = Object.fromEntries(
  fs.readFileSync(path.join(ROOT, '.env.local'), 'utf8').split('\n').filter((l) => l.includes('=') && !l.trim().startsWith('#'))
    .map((l) => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim()] })
)

// ── 1. DECLARED tuples = the registry, expanded (platform × breakdown_type × each entityLevel). Text-parsed so this
//    script needs no TS loader (same parse the drift guard uses). ────────────────────────────────────────────────
const registry = fs.readFileSync(path.join(ROOT, 'src/lib/breakdown-registry.ts'), 'utf8')
const declared = new Set()
for (const line of registry.split('\n')) {
  if (!/breakdownType:/.test(line) || !/surface:/.test(line)) continue
  const platform = line.match(/platform:\s*'([a-z]+)'/)?.[1]
  const bt = line.match(/breakdownType:\s*'([^']*)'/)?.[1]
  const levels = line.match(/entityLevels:\s*\[([^\]]*)\]/)?.[1]
  if (platform === undefined || bt === undefined || levels === undefined) continue
  for (const lv of [...levels.matchAll(/'([a-z_]+)'/g)].map((m) => m[1])) declared.add(`${platform}|${bt}|${lv}`)
}

// ── 2. LIVE tuples = recursive loose-index-scan over idx_metrics_daily_client_platform_bt_level_date (clears 8s
//    where a naive GROUP BY does not — the migration-037 skip-scan). ─────────────────────────────────────────────
const LOOSE_SCAN = `
  WITH RECURSIVE loose AS (
    (SELECT client_id, platform, breakdown_type, entity_level FROM metrics_daily
     ORDER BY client_id, platform, breakdown_type, entity_level LIMIT 1)
    UNION ALL
    SELECT n.client_id, n.platform, n.breakdown_type, n.entity_level FROM loose l
    CROSS JOIN LATERAL (
      SELECT client_id, platform, breakdown_type, entity_level FROM metrics_daily m
      WHERE (m.client_id, m.platform, m.breakdown_type, m.entity_level)
          > (l.client_id, l.platform, l.breakdown_type, l.entity_level)
      ORDER BY m.client_id, m.platform, m.breakdown_type, m.entity_level LIMIT 1) n)
  SELECT DISTINCT platform, breakdown_type, entity_level FROM loose ORDER BY 1,2,3;`

const { default: pg } = await import('pg')
const client = new pg.Client({ connectionString: env.SUPABASE_DB_URL })
await client.connect()
await client.query("SET statement_timeout='115s'")
const { rows } = await client.query(LOOSE_SCAN)
await client.end()

const live = rows.map((r) => `${r.platform}|${r.breakdown_type}|${r.entity_level}`)
const liveSet = new Set(live)
const unadmitted = live.filter((t) => !declared.has(t)) // CAPTURED but not in the registry → unreachable by Lora
const deadDecls = [...declared].filter((t) => !liveSet.has(t)) // declared but no live rows (informational)

console.log('LORAMER_BREAKDOWN_REACHABILITY_CHECK_V1')
console.log(`  registry-declared tuples : ${declared.size}`)
console.log(`  live DISTINCT tuples      : ${liveSet.size}`)
console.log(`  captured-but-UNADMITTED   : ${unadmitted.length}`)
for (const t of unadmitted) console.log('    ⚠ UNREACHABLE (captured, not in registry): ' + t.replace(/\|/g, ' / '))
console.log(`  declared-but-empty (info) : ${deadDecls.length}`)
for (const t of deadDecls) console.log('    · declared, no live rows: ' + t.replace(/\|/g, ' / '))
console.log(unadmitted.length === 0
  ? '\n✓ Every captured (platform, breakdown_type, entity_level) tuple is declared in the registry → reachable by Lora.'
  : `\n✗ ${unadmitted.length} captured tuple(s) are NOT reachable by Lora — add them to breakdown-registry.ts.`)
console.log('  (Reminder: this is the LIVE-DB check the build guard cannot do. Green build guard ≠ Lora sees everything.)')
