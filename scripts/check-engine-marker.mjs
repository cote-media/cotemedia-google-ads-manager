#!/usr/bin/env node
// LORAMER_CONNECTION_ENGINE_MARKER_V1 — check:data: A WALK-MARKED CONNECTION HAS NO OLD-ENGINE WRITE AFTER IT WAS CREATED.
//
// ⛔ THE CLASS: a marker nothing reads yet can still lie, and a lie banked in a column is read by every build that
// comes after it. So the marker is checked against the old engine's OWN TRACES, from the day it exists:
//   (a) metrics_daily rows at the OLD SPELLING — platform 'google', breakdown_type '' (the legacy forward family
//       writes base rows at <level>/''; the walk writes <resource>/<resource> and never '' — universe-surfaces.ts,
//       LORAMER_WALK_BASE_DEALIAS_V1) — with synced_at after the connection's created_at;
//   (b) the old crons' cursors: sync_state rows whose platform is a legacy google spelling ('google', 'google_<family>',
//       '__fwd_google*', '__drain_google', '__catchup_google') updated after created_at;
//   (c) forward_observation_log rows by a legacy producer (anything not 'driver-…') observed after created_at.
// Any trace on a connection marked 'walk' → RED, naming the connection and the trace. A connection marked 'legacy'
// is never checked: legacy is true by construction today (the old crons iterate every row).
// The column must exist once migrations/101 is in the repo: a missing column is RED (schema behind the repo).
//
//   node scripts/check-engine-marker.mjs [--guard] [--fixture]
// LORAMER_ONE_ENGINE_V1 (2026-09-22): since migration 102 new connections default to walk and every old-engine writer refuses
// a walk row before its first claim (tests/guards/one-engine-writers.guard.mjs pins the source order). This leg is the RUNTIME
// proof: a walk-marked connection with any old-engine trace after its creation means a writer slipped the predicate.
//   --fixture: inside ONE transaction that ends in ROLLBACK, mark the oldest google connection 'walk' (adding the
//              column first if 101 is not applied) and run the same detector — it MUST fire. Nothing persists.
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const ROOT = process.env.LORAMER_GUARD_ROOT || process.cwd()
const args = process.argv.slice(2)
const GUARD = args.includes('--guard'), FIXTURE = args.includes('--fixture')
for (const l of readFileSync(resolve(ROOT, '.env.local'), 'utf8').split('\n')) { const m = l.match(/^([A-Z0-9_]+)=(.*)$/); if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '') }
if (!process.env.SUPABASE_DB_URL) { console.error('[engine-marker] SUPABASE_DB_URL missing'); process.exit(2) }

// LORAMER_FIRE_PLANS_UNTIL_FULL_V1 (2026-09-23) — `__fwd_google:<slice>` is the forward DRIVER's own claim namespace
// (forward-driver.ts, disjoint from the legacy `__fwd_google` key by the colon); the driver is the walk-era writer leg (a)
// allows, so its claims are excluded here. Measured RED on the first walk-marked connection (Tri-Copy, 15:54Z) for a true state.
export const LEGACY_SYNC_STATE_SPELLINGS = `(platform = 'google' or platform like 'google\\_%' escape '\\' or (platform like '\\_\\_fwd\\_google%' escape '\\' and platform not like '\\_\\_fwd\\_google:%' escape '\\') or platform in ('__drain_google', '__catchup_google'))`

/** The detector. Runs on the given client (inside or outside a transaction). Returns { walkCount, legacyCount, findings[] }. */
export async function detect(db) {
  const col = await db.query(`select 1 from information_schema.columns where table_schema='public' and table_name='platform_connections' and column_name='engine'`)
  if (!col.rowCount) return { columnMissing: true, walkCount: 0, legacyCount: 0, findings: ['platform_connections.engine does not exist — migrations/101_connection_engine_marker.sql is in the repo and not applied'] }
  const by = await db.query(`select engine, count(*)::int n from public.platform_connections group by engine`)
  const walkCount = by.rows.find((r) => r.engine === 'walk')?.n ?? 0, legacyCount = by.rows.find((r) => r.engine === 'legacy')?.n ?? 0
  const findings = []
  const walks = await db.query(`select id, client_id, platform, account_id, created_at from public.platform_connections where engine = 'walk' and platform = 'google' order by created_at`)
  for (const c of walks.rows) {
    const a = await db.query(`select max(synced_at) newest, count(*)::int n from public.metrics_daily where client_id = $1 and platform = 'google' and breakdown_type = '' and synced_at > $2`, [c.client_id, c.created_at])
    if (a.rows[0].n > 0) findings.push(`${c.client_id} (google ${c.account_id}, marked walk, created ${c.created_at.toISOString()}): ${a.rows[0].n} old-spelling metrics_daily row(s) (breakdown_type '') synced after creation, newest ${a.rows[0].newest?.toISOString?.() ?? a.rows[0].newest}`)
    const b = await db.query(`select platform, updated_at from public.sync_state where client_id = $1 and ${LEGACY_SYNC_STATE_SPELLINGS} and updated_at > $2 order by updated_at desc limit 3`, [c.client_id, c.created_at])
    if (b.rowCount) findings.push(`${c.client_id} (google ${c.account_id}, marked walk): legacy cron cursor(s) moved after creation — ${b.rows.map((r) => `${r.platform}@${r.updated_at.toISOString()}`).join(', ')}`)
    const f = await db.query(`select producer, max(observed_at) newest, count(*)::int n from public.forward_observation_log where client_id = $1 and vendor in ('google','google_ads') and producer not like 'driver-%' and observed_at > $2 group by producer order by 2 desc limit 3`, [c.client_id, c.created_at])
    if (f.rowCount) findings.push(`${c.client_id} (google ${c.account_id}, marked walk): legacy forward producer(s) observed after creation — ${f.rows.map((r) => `${r.producer}×${r.n}@${r.newest.toISOString()}`).join(', ')}`)
  }
  return { columnMissing: false, walkCount, legacyCount, findings, walkGoogle: walks.rowCount }
}

const isMain = process.argv[1] && resolve(process.argv[1]) === new URL(import.meta.url).pathname
if (isMain) {
  const pg = (await import('pg')).default
  const db = new pg.Client({ connectionString: process.env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false }, application_name: FIXTURE ? 'check-engine-marker-FIXTURE-ROLLBACK' : 'check-engine-marker-readonly' })
  await db.connect()
  await db.query('set statement_timeout = 120000')
  let out
  try {
    if (FIXTURE) {
      await db.query('begin'); await db.query(`set local lock_timeout = '5s'`)
      const col = await db.query(`select 1 from information_schema.columns where table_schema='public' and table_name='platform_connections' and column_name='engine'`)
      if (!col.rowCount) await db.query(readFileSync(resolve(ROOT, 'migrations/101_connection_engine_marker.sql'), 'utf8'))
      const u = await db.query(`update public.platform_connections set engine = 'walk' where id = (select id from public.platform_connections where platform = 'google' order by created_at limit 1) returning client_id, account_id`)
      console.log(`[engine-marker] FIXTURE (rolled back): marked ${u.rows[0]?.client_id} (google ${u.rows[0]?.account_id}) walk${col.rowCount ? '' : ' after applying 101 in the transaction'}`)
      out = await detect(db)
      await db.query('rollback')
    } else out = await detect(db)
  } finally { await db.end() }
  const lines = []
  lines.push(`[engine-marker] platform_connections: ${out.legacyCount} legacy · ${out.walkCount} walk${out.columnMissing ? ' (column missing)' : ''} · ${out.walkGoogle ?? 0} walk-marked google connection(s) checked against the old engine's traces`)
  for (const f of out.findings) lines.push(`  ✗ ${f}`)
  const red = out.findings.length
  const reason = out.columnMissing ? 'schema behind the repo' : out.walkCount === 0 ? 'no connection is marked walk, so no marker can lie yet — every row is legacy, which is true by construction while the old crons iterate every row' : red ? `${red} old-engine trace(s) on walk-marked connection(s) after creation — the marker lies` : 'every walk-marked connection is free of old-engine writes after creation'
  lines.push(`[engine-marker] VERDICT — EXIT ${red ? 1 : 0} · ${red ? red + ' finding(s)' : 'GREEN'} — ${reason}${FIXTURE ? ' [FIXTURE, rolled back]' : ''}`)
  console.log(lines.join('\n'))
  process.exit(red ? 1 : 0)
}
