// LORAMER_GEO_TARGET_CONSTANT_V1 — ingest Google's geo id→name reference into public.geo_target_constant.
//
// ZERO-QUOTA: downloads the versioned geotargets CSV from developers.google.com/google-ads/api/data/geotargets over
// plain HTTPS. NEVER the API. If the download fails, this FAILS LOUDLY — it does NOT fall back to the API.
//
// RETENTION LAW (migration 040): the table ACCUMULATES — a UNION across CSV versions, never a mirror of the newest.
// Google phases ids out (Removal Planned) and drops them from later CSVs; ids are permanent + never reused, so a
// retired mapping stays correct forever. This loader UPSERTs (insert new / update seen) and NEVER DELETES. An id in
// our table but absent from today's CSV is RETIRED — its row is kept, last_seen_version left at its prior value.
//
//   Run:  node scripts/ingest-geo-target-constants.mjs     (needs SUPABASE_DB_URL in .env.local + `pg` + `unzip` on PATH)
//   Idempotent: a second run of the same CSV version changes zero rows (the ON CONFLICT update is guarded to skip
//   rows whose values + last_seen_version are unchanged).
import fs from 'fs'
import os from 'os'
import path from 'path'
import { execSync } from 'child_process'

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..')
const env = Object.fromEntries(
  fs.readFileSync(path.join(ROOT, '.env.local'), 'utf8').split('\n').filter((l) => l.includes('=') && !l.trim().startsWith('#'))
    .map((l) => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim()] })
)
const die = (msg) => { console.error('✗ ' + msg); process.exit(1) }

// ── 1. Find the NEWEST published CSV version (read what Google publishes today; do not hardcode) ────────────────
const PAGE = 'https://developers.google.com/google-ads/api/data/geotargets'
const pageRes = await fetch(PAGE)
if (!pageRes.ok) die(`geotargets page fetch failed: HTTP ${pageRes.status} — NOT falling back to the API.`)
const html = await pageRes.text()
const versions = [...new Set([...html.matchAll(/geotargets-(\d{4}-\d{2}-\d{2})\.csv\.zip/g)].map((m) => m[1]))].sort()
if (!versions.length) die('no geotargets-YYYY-MM-DD.csv.zip links found on the page — parser or page changed.')
const version = versions[versions.length - 1]
const url = `https://developers.google.com/google-ads/api/data/geo/geotargets-${version}.csv.zip`

// ── 2. Download + unzip (zero quota) ───────────────────────────────────────────────────────────────────────────
const zipRes = await fetch(url)
if (!zipRes.ok) die(`CSV download failed: HTTP ${zipRes.status} for ${url} — NOT falling back to the API.`)
const tmp = path.join(os.tmpdir(), `geotargets-${version}.csv.zip`)
fs.writeFileSync(tmp, Buffer.from(await zipRes.arrayBuffer()))
const csv = execSync(`unzip -p ${JSON.stringify(tmp)}`, { maxBuffer: 512 * 1024 * 1024, encoding: 'utf8' })
fs.unlinkSync(tmp)

// ── 3. Parse (RFC-4180 quoted fields; canonical_name carries embedded commas) ──────────────────────────────────
const parseLine = (line) => {
  const res = []; let cur = ''; let q = false
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]
    if (q) { if (ch === '"') { if (line[i + 1] === '"') { cur += '"'; i++ } else q = false } else cur += ch }
    else { if (ch === '"') q = true; else if (ch === ',') { res.push(cur); cur = '' } else cur += ch }
  }
  res.push(cur); return res
}
const lines = csv.split(/\r?\n/).filter((l) => l.length)
const header = lines.shift() // "Criteria ID,Name,Canonical Name,Parent ID,Country Code,Target Type,Status"
if (!/^Criteria ID,Name,Canonical Name,Parent ID,Country Code,Target Type,Status/.test(header)) die(`unexpected CSV header: ${header}`)
const rows = lines.map(parseLine).filter((r) => r[0])

// ── 4. Accumulating UPSERT (never delete; first_seen preserved; guarded update = idempotent) ───────────────────
const { default: pg } = await import('pg')
const client = new pg.Client({ connectionString: env.SUPABASE_DB_URL })
await client.connect()
const totalBefore = Number((await client.query('SELECT count(*) c FROM public.geo_target_constant')).rows[0].c)

let inserted = 0, updated = 0
const COLS = 9, BATCH = 2000
for (let b = 0; b < rows.length; b += BATCH) {
  const slice = rows.slice(b, b + BATCH)
  const vals = [], params = []
  slice.forEach((r, k) => {
    const o = k * COLS
    vals.push(`($${o + 1},$${o + 2},$${o + 3},$${o + 4},$${o + 5},$${o + 6},$${o + 7},$${o + 8},$${o + 9})`)
    // criteria_id, name, canonical_name, parent_id, country_code, target_type, status, first_seen, last_seen
    params.push(r[0], r[1] ?? '', r[2] ?? '', r[3] ?? '', r[4] ?? '', r[5] ?? '', r[6] ?? '', version, version)
  })
  const sql = `
    INSERT INTO public.geo_target_constant
      (criteria_id,name,canonical_name,parent_id,country_code,target_type,status,first_seen_version,last_seen_version)
    VALUES ${vals.join(',')}
    ON CONFLICT (criteria_id) DO UPDATE SET
      name=EXCLUDED.name, canonical_name=EXCLUDED.canonical_name, parent_id=EXCLUDED.parent_id,
      country_code=EXCLUDED.country_code, target_type=EXCLUDED.target_type, status=EXCLUDED.status,
      last_seen_version=EXCLUDED.last_seen_version, ingested_at=now()
    WHERE geo_target_constant.last_seen_version IS DISTINCT FROM EXCLUDED.last_seen_version
       OR geo_target_constant.name IS DISTINCT FROM EXCLUDED.name
       OR geo_target_constant.canonical_name IS DISTINCT FROM EXCLUDED.canonical_name
       OR geo_target_constant.parent_id IS DISTINCT FROM EXCLUDED.parent_id
       OR geo_target_constant.country_code IS DISTINCT FROM EXCLUDED.country_code
       OR geo_target_constant.target_type IS DISTINCT FROM EXCLUDED.target_type
       OR geo_target_constant.status IS DISTINCT FROM EXCLUDED.status
    RETURNING (xmax = 0) AS ins`
  const res = await client.query(sql, params)
  for (const row of res.rows) row.ins ? inserted++ : updated++
}
const totalAfter = Number((await client.query('SELECT count(*) c FROM public.geo_target_constant')).rows[0].c)
const retired = Number((await client.query('SELECT count(*) c FROM public.geo_target_constant WHERE last_seen_version IS DISTINCT FROM $1', [version])).rows[0].c)
await client.end()

console.log('LORAMER_GEO_TARGET_CONSTANT_V1 — ingest')
console.log(`  CSV version ingested     : ${version}  (${rows.length} CSV rows)`)
console.log(`  rows inserted (new)      : ${inserted}`)
console.log(`  rows updated (changed)   : ${updated}`)
console.log(`  rows retired-but-retained: ${retired}  (in our table, absent from this CSV — KEPT)`)
console.log(`  total rows (before→after): ${totalBefore} → ${totalAfter}`)
