#!/usr/bin/env node
// LORAMER_ORDINAL_DEVICE_RESPELL_V1 — HISTORY REPAIR, detail_placement_view SCOPE ONLY.
// Respells the pre-canonicalisation ordinal device values ('2'..'6') the 2026-08-03 v1 walk wrote at
// entity_level='detail_placement_view' into the canonical names the drain has always written and the v2
// walk writes since LORAMER_CANONICAL_KEY_SPELLING_V1 (2026-08-09). Without this, the un-deferred re-walk
// of detail_placement_view|device UPSERTS canonical rows BESIDE the ordinal ones — same fact, two keys, the
// exact 67,455-row twin class that law exists to end.
//
// ⛔ WHY UPDATE-IN-PLACE AND NOT DELETE: these rows have NO canonical twin (probed live 2026-08-25 — zero
// canonical values at this level, any date) so they are the ONLY copy of that captured history. Deleting
// them destroys real data to avoid a duplication the respell avoids for free — and the re-walk only
// re-covers the window it walks. Measured key collisions at execution scope: 0 (re-proven by this script
// on every run, step 2, and the execute path REFUSES on any collision rather than falling back to delete —
// the ruled shape there is insert-ON-CONFLICT-DO-NOTHING + prune, which is a DIFFERENT flight).
//
// ⛔ GATED, exactly like repair-google-ad-names.mjs: DRY-RUN IS THE DEFAULT AND THE ONLY UNGATED MODE.
// `--execute` requires BOTH the flag AND LORAMER_REPAIR_CONFIRM=device-respell in the environment.
// Execute applies EXACTLY the manifest from a prior dry run — never a fresh computation — so what Russ
// approved is what runs. Reversal = applying the manifest's old (ordinal) values back by id.
//
// ⛔ THE MAPPING IS NOT RESTATED HERE. It is read from the ONE owner — canonicalBreakdownValue /
// DEVICE_ENUM_NAME in src/lib/backfill/universe-surfaces.ts — compiled and invoked, so this script cannot
// drift from the spelling the walk itself writes.
//
// ⛔ SCOPE, pinned in every statement AND re-verified by the guard
// (tests/guards/device-respell-scope.guard.mjs): client 957d484e (Foam OH, the only client holding ordinal
// rows — probed) · platform google · entity_level detail_placement_view ONLY · breakdown_type device ·
// breakdown_value IN ('2','3','4','5','6'). NOT group_placement_view, NOT the legacy-level ordinals, NOT
// any other of the 31 levels — those are their own decisions at their own blast radius.
//
// ⛔ DIRECT POSTGRES (pg, SUPABASE_DB_URL), not PostgREST: the dry run must run the REAL UPDATE inside a
// transaction and ROLL IT BACK, and PostgREST has no transactions. Same driver + gating posture as
// partition-backfill.mjs / refused-stamp-backfill.mjs.
//
// USAGE:
//   node scripts/respell-device-ordinals.mjs                 # manifest + collision proof + rolled-back dry run
//   LORAMER_REPAIR_CONFIRM=device-respell node scripts/respell-device-ordinals.mjs --execute --manifest <file>
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs'
import { resolve, join } from 'node:path'
import { tmpdir } from 'node:os'
import { spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'

const ROOT = process.cwd()
const require_ = createRequire(resolve(ROOT, 'package.json'))
for (const l of readFileSync(resolve(ROOT, '.env.local'), 'utf8').split('\n')) {
  const t = l.trim(); if (!t || t.startsWith('#')) continue
  const i = t.indexOf('='); if (i > 0) { const k = t.slice(0, i); if (!process.env[k]) process.env[k] = t.slice(i + 1).replace(/^["']|["']$/g, '') }
}
const EXECUTE = process.argv.includes('--execute')
const argOf = (n) => { const i = process.argv.indexOf(n); return i > -1 ? process.argv[i + 1] : undefined }
const MANIFEST_PATH = argOf('--manifest') || './device-respell-manifest.json'
if (EXECUTE && process.env.LORAMER_REPAIR_CONFIRM !== 'device-respell') {
  console.error('⛔ REFUSING --execute: LORAMER_REPAIR_CONFIRM=device-respell is not set. The execution is Russ-gated by design.')
  process.exit(2)
}

// ── SCOPE CONSTANTS — the predicate, in one place, spelled once ────────────────────────────────────────
const CLIENT = '957d484e-d0c4-4dd0-b382-d8499d556252' // Foam OH — registry id (canonical.ts), never a name
const LEVEL = 'detail_placement_view'
const ORDINALS = ['2', '3', '4', '5', '6']
const SCOPE_SQL = `client_id = '${CLIENT}' AND platform = 'google' AND entity_level = '${LEVEL}'
     AND breakdown_type = 'device' AND breakdown_value = ANY($1)`

// ── THE MAPPING — compiled from the one owner, never hand-restated ─────────────────────────────────────
function loadCanonicalMapping() {
  const out = mkdtempSync(join(tmpdir(), 'loramer-respell-'))
  try {
    const tsc = join(ROOT, 'node_modules', '.bin', 'tsc')
    const r = spawnSync(tsc, [resolve(ROOT, 'src/lib/backfill/universe-surfaces.ts'), '--target', 'es2020',
      '--module', 'commonjs', '--moduleResolution', 'node', '--skipLibCheck', '--noResolve', '--outDir', out], { encoding: 'utf8' })
    if (r.error) throw new Error(`tsc did not run: ${r.error.message}`)
    const s = createRequire(import.meta.url)(join(out, 'universe-surfaces.js'))
    const map = {}
    for (const o of ORDINALS) {
      const v = s.canonicalBreakdownValue('device', o)
      if (v === o) throw new Error(`canonicalBreakdownValue('device','${o}') returned the ordinal unchanged — the owner no longer maps it; refusing to invent a spelling`)
      map[o] = v
    }
    return map
  } finally {
    rmSync(out, { recursive: true, force: true })
  }
}

const pg = require_('pg')
const c = new pg.Client({ connectionString: process.env.SUPABASE_DB_URL })
await c.connect()
await c.query(`SET statement_timeout = '0'`)

const MAP = loadCanonicalMapping()
console.log(`[respell] mapping (from canonicalBreakdownValue, compiled): ${Object.entries(MAP).map(([k, v]) => `${k}→${v}`).join(' · ')}`)

try {
  if (!EXECUTE) {
    // ── 1. MANIFEST — every affected row key + old value, FIRST, count exact ─────────────────────────────
    const { rows: manifestRows } = await c.query(`
      SELECT id, date, entity_id, breakdown_value AS old_value
      FROM metrics_daily WHERE ${SCOPE_SQL}
      ORDER BY date, entity_id, breakdown_value`, [ORDINALS])
    const byValue = {}
    for (const r of manifestRows) byValue[r.old_value] = (byValue[r.old_value] || 0) + 1
    // ⛔ The count on the predicate, asked independently of the row fetch, so the manifest cannot silently page.
    const { rows: [{ n: predicateCount }] } = await c.query(
      `SELECT count(*)::bigint AS n FROM metrics_daily WHERE ${SCOPE_SQL}`, [ORDINALS])
    if (Number(predicateCount) !== manifestRows.length) {
      throw new Error(`manifest rows (${manifestRows.length}) != predicate count (${predicateCount}) — refusing to write a manifest that does not cover its own predicate`)
    }
    writeFileSync(MANIFEST_PATH, JSON.stringify({
      marker: 'LORAMER_ORDINAL_DEVICE_RESPELL_V1',
      builtAt: new Date().toISOString(),
      scope: { client_id: CLIENT, platform: 'google', entity_level: LEVEL, breakdown_type: 'device', ordinals: ORDINALS },
      mapping: MAP,
      rowCount: manifestRows.length,
      byValue,
      // id + date is the partitioned PK (migrations/052: PRIMARY KEY (id, date)); old_value is the reversal.
      rows: manifestRows.map((r) => ({ id: String(r.id), date: r.date.toISOString().slice(0, 10), old_value: r.old_value })),
    }, null, 1))
    console.log(`[respell] 1. MANIFEST — ${manifestRows.length} row(s) written to ${MANIFEST_PATH} · by value: ${JSON.stringify(byValue)} · equals predicate count ${predicateCount}: ${Number(predicateCount) === manifestRows.length}`)

    // ── 2. COLLISION RE-PROOF — per-key EXISTS against the mapped canonical value ────────────────────────
    const { rows: [{ n: collisions }] } = await c.query(`
      SELECT count(*)::bigint AS n
      FROM metrics_daily o
      WHERE ${SCOPE_SQL.replace(/client_id =/, 'o.client_id =').replace(/platform =/, 'o.platform =').replace(/entity_level =/, 'o.entity_level =').replace(/breakdown_type =/, 'o.breakdown_type =').replace(/breakdown_value =/, 'o.breakdown_value =')}
        AND EXISTS (
          SELECT 1 FROM metrics_daily t
          WHERE t.client_id = o.client_id AND t.platform = o.platform AND t.entity_level = o.entity_level
            AND t.entity_id = o.entity_id AND t.date = o.date AND t.breakdown_type = o.breakdown_type
            AND t.breakdown_value = CASE o.breakdown_value
              WHEN '2' THEN '${MAP['2']}' WHEN '3' THEN '${MAP['3']}' WHEN '4' THEN '${MAP['4']}'
              WHEN '5' THEN '${MAP['5']}' WHEN '6' THEN '${MAP['6']}' END
        )`, [ORDINALS])
    console.log(`[respell] 2. COLLISIONS — ${collisions} row(s) whose canonical twin already exists`)
    if (Number(collisions) !== 0) {
      console.error(`⛔ STOP — ${collisions} collision(s). NOT falling back to delete. The ruled shape for a collided set is insert-canonical-ON-CONFLICT-DO-NOTHING then prune the ordinal — a different flight, Russ decides.`)
      process.exit(1)
    }

    // ── 4. DRY RUN — the REAL update, in a transaction, ROLLED BACK ──────────────────────────────────────
    const { rows: [{ n: before }] } = await c.query(`SELECT count(*)::bigint AS n FROM metrics_daily WHERE ${SCOPE_SQL}`, [ORDINALS])
    await c.query('BEGIN')
    const upd = await c.query(`
      UPDATE metrics_daily SET breakdown_value = CASE breakdown_value
        WHEN '2' THEN '${MAP['2']}' WHEN '3' THEN '${MAP['3']}' WHEN '4' THEN '${MAP['4']}'
        WHEN '5' THEN '${MAP['5']}' WHEN '6' THEN '${MAP['6']}' END
      WHERE ${SCOPE_SQL}`, [ORDINALS])
    const { rows: [{ n: ordAfter }] } = await c.query(`SELECT count(*)::bigint AS n FROM metrics_daily WHERE ${SCOPE_SQL}`, [ORDINALS])
    const { rows: [{ n: canonAfter }] } = await c.query(`
      SELECT count(*)::bigint AS n FROM metrics_daily
      WHERE client_id = '${CLIENT}' AND platform = 'google' AND entity_level = '${LEVEL}'
        AND breakdown_type = 'device' AND breakdown_value = ANY($1)`, [Object.values(MAP)])
    const { rows: [{ n: totalAfter }] } = await c.query(`
      SELECT count(*)::bigint AS n FROM metrics_daily
      WHERE client_id = '${CLIENT}' AND platform = 'google' AND entity_level = '${LEVEL}' AND breakdown_type = 'device'`)
    await c.query('ROLLBACK')
    const { rows: [{ n: ordRestored }] } = await c.query(`SELECT count(*)::bigint AS n FROM metrics_daily WHERE ${SCOPE_SQL}`, [ORDINALS])
    console.log(`[respell] 4. DRY RUN (transaction, ROLLED BACK):`)
    console.log(`    rows updated ............... ${upd.rowCount}`)
    console.log(`    ordinal rows before ........ ${before}`)
    console.log(`    ordinal rows after update .. ${ordAfter}   (must be 0)`)
    console.log(`    canonical rows after ....... ${canonAfter}   (must equal ${before})`)
    console.log(`    total in scope after ....... ${totalAfter}   (must equal ${before} — no row lost, none gained)`)
    console.log(`    ordinal rows post-ROLLBACK . ${ordRestored}   (must equal ${before} — the rollback held)`)
    const ok = Number(ordAfter) === 0 && Number(canonAfter) === Number(before)
      && Number(totalAfter) === Number(before) && Number(ordRestored) === Number(before)
    console.log(ok
      ? `[respell] DRY RUN VERDICT — CLEAN: ${before} rows respell with zero loss, zero gain, zero collisions. Execution HELD for Russ (--execute + LORAMER_REPAIR_CONFIRM=device-respell).`
      : `[respell] DRY RUN VERDICT — NOT CLEAN, see counts above. Do not execute.`)
    process.exit(ok ? 0 : 1)
  }

  // ── EXECUTE — applies EXACTLY the approved manifest, never a fresh computation ─────────────────────────
  const manifest = JSON.parse(readFileSync(MANIFEST_PATH, 'utf8'))
  if (manifest.marker !== 'LORAMER_ORDINAL_DEVICE_RESPELL_V1') { console.error('⛔ REFUSING: manifest marker mismatch.'); process.exit(2) }
  const ids = manifest.rows.map((r) => r.id)
  console.log(`[respell] EXECUTE — applying manifest ${MANIFEST_PATH}: ${ids.length} row(s)`)
  await c.query('BEGIN')
  // Scope predicates REPEATED on the update even though ids suffice — a wrong id can still only touch scope.
  let applied = 0
  for (let i = 0; i < ids.length; i += 5000) {
    const slice = ids.slice(i, i + 5000)
    const r = await c.query(`
      UPDATE metrics_daily SET breakdown_value = CASE breakdown_value
        WHEN '2' THEN '${MAP['2']}' WHEN '3' THEN '${MAP['3']}' WHEN '4' THEN '${MAP['4']}'
        WHEN '5' THEN '${MAP['5']}' WHEN '6' THEN '${MAP['6']}' END
      WHERE id = ANY($2::bigint[]) AND ${SCOPE_SQL}`, [ORDINALS, slice])
    applied += r.rowCount
  }
  const { rows: [{ n: residue }] } = await c.query(`SELECT count(*)::bigint AS n FROM metrics_daily WHERE ${SCOPE_SQL}`, [ORDINALS])
  if (Number(residue) !== 0) { await c.query('ROLLBACK'); console.error(`⛔ ROLLED BACK — ${residue} ordinal row(s) would remain after applying the manifest. The manifest is stale; re-run the dry run.`); process.exit(1) }
  await c.query('COMMIT')
  console.log(`[respell] EXECUTED — ${applied} row(s) respelled, 0 ordinal residue. Reversal = applying old_value back from ${MANIFEST_PATH} by id.`)
} finally {
  await c.end()
}
