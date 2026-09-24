#!/usr/bin/env node
// LORAMER_STABLE_PAGE_ORDER_V1 (2026-09-24, round 53) — A RANGE PAGE WITHOUT A TOTAL ORDER IS NOT A PAGE.
//
// WHY. scripts/lib/rest-all.mjs paged PostgREST by Range with no order. PostgreSQL: "If sorting is not chosen, the rows will be
// returned in an unspecified order … it must not be relied on." Measured 2026-09-24 on the driver-day leg's read: 5,526 rows held
// (= the server total, so the held ≠ total guard could not see it) but 4,408 distinct — 1,118 duplicates and 1,118 rows never
// read; 8 of 17 connections judged short while every one held 323/323. With order=id: 5,526 distinct. Three legs:
//   (a) restAllCounted driven against a fake server that serves OVERLAPPING pages unless the request orders by the key, and
//       stable pages when it does — distinct must equal held;
//   (b) a caller order that is not unique (the canary's recorded_at.desc) gets the key appended, never replaced;
//   (c) every table a scripts/ or tests/guards restAll reader names is known to rest-all (id-keyed or in ORDER_KEYS), so a new
//       table cannot page unkeyed — rest-all THROWS on an unknown table rather than paging without an order.
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { resolve, dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')
const findings = []
let R
try { R = await import(resolve(ROOT, 'scripts/lib/rest-all.mjs')) } catch (e) { findings.push(`CANNOT IMPORT rest-all: ${e.message}`) }
const ORDER_KEYS = R?.ORDER_KEYS, ID_KEYED_TABLES = R?.ID_KEYED_TABLES
if (!ORDER_KEYS || !ID_KEYED_TABLES) findings.push('(c) rest-all must export ORDER_KEYS (composite keys) and ID_KEYED_TABLES (measured id-keyed tables)')
// a fake PostgREST: 30 rows; without order=…key it serves pages that overlap (page n starts one row early), with the key it pages exactly.
function fakeServer(keyName) {
  const rowsAll = Array.from({ length: 30 }, (_, i) => ({ id: i + 1, v: `r${i + 1}` }))
  const seen = []
  const fetchImpl = async (url, { headers }) => {
    seen.push(url)
    const [a, b] = headers.Range.split('-').map(Number)
    const om = url.match(/[?&]order=([^&]*)/)
    const ordered = !!om && om[1].split(',').some((part) => part.split('.')[0] === keyName)
    const start = ordered || a === 0 ? a : a - 1 // unordered: page 2+ starts one row early → a duplicate and a missed tail row
    const body = rowsAll.slice(start, start + (b - a + 1))
    return { status: 206, headers: { get: (h) => (h === 'content-range' ? `${a}-${a + body.length - 1}/30` : null) }, json: async () => body, text: async () => '' }
  }
  return { fetchImpl, seen }
}
if (R) {
  // (a) unordered → overlap; keyed → exact. The current rest-all must send the key on its own.
  const s = fakeServer('id')
  try {
    const { rows, total } = await R.restAllCounted('forward_observation_log?select=id', { fetchImpl: s.fetchImpl, sb: 'http://fake', key: 'k', page: 10 })
    const distinct = new Set(rows.map((r) => r.id)).size
    if (rows.length !== total || distinct !== rows.length) findings.push(`(a) ⛔ restAll read ${rows.length} of ${total} with ${distinct} distinct — the pages overlapped because the request carried no unique order (requests: ${s.seen.map((u) => u.split('?')[1]).join(' | ')})`)
    if (!s.seen.every((u) => /order=/.test(u))) findings.push(`(a) rest-all sent a Range request with no order= at all: ${s.seen[0]}`)
  } catch (e) { findings.push(`(a) restAllCounted threw on the fake: ${e.message}`) }
  // (b) the canary's shape keeps recorded_at.desc first and gains ,id
  const s2 = fakeServer('id')
  try {
    await R.restAllCounted('universe_attempt_log?select=id&order=recorded_at.desc', { fetchImpl: s2.fetchImpl, sb: 'http://fake', key: 'k', page: 10 })
    const q = s2.seen[0] ?? ''
    if (!/order=recorded_at\.desc,id(&|$)/.test(q)) findings.push(`(b) a caller order that is not unique must keep its order and gain ,id — sent: ${q.split('?')[1]}`)
  } catch (e) { findings.push(`(b) threw: ${e.message}`) }
  // (b2) metrics_daily's key is composite
  const s3 = fakeServer('id')
  try { await R.restAllCounted('metrics_daily?select=id', { fetchImpl: s3.fetchImpl, sb: 'http://fake', key: 'k', page: 10 }); if (!/order=id,date(&|$)/.test(s3.seen[0] ?? '')) findings.push(`(b) metrics_daily must order by id,date (its primary key) — sent: ${(s3.seen[0] ?? '').split('?')[1]}`) } catch (e) { findings.push(`(b2) threw: ${e.message}`) }
  // (b3) an unknown table refuses to page
  let threw = false
  try { await R.restAllCounted('some_new_table?select=id', { fetchImpl: fakeServer('id').fetchImpl, sb: 'http://fake', key: 'k', page: 10 }) } catch { threw = true }
  if (!threw) findings.push('(b3) rest-all must THROW on a table it has no unique order for — paging it unkeyed is the defect')
  // (c) every restAll table named in scripts/ and tests/guards is known
  const walk = (dir, out = []) => { for (const e of readdirSync(dir)) { const p = join(dir, e); if (statSync(p).isDirectory()) walk(p, out); else if (/\.mjs$/.test(e)) out.push(p) } return out }
  const tables = new Set()
  for (const f of [...walk(resolve(ROOT, 'scripts')), ...walk(resolve(ROOT, 'tests/guards'))]) {
    const src = readFileSync(f, 'utf8')
    for (const m of src.matchAll(/(?:restAll(?:Counted)?|rest)\(\s*`([a-z_]+)\?/g)) tables.add(m[1])
  }
  for (const t of tables) if (!ID_KEYED_TABLES?.includes(t) && !ORDER_KEYS?.[t]) findings.push(`(c) ${t} is read through restAll but rest-all knows no unique order for it — add it to ID_KEYED_TABLES (if its pk is id) or ORDER_KEYS`)
}
if (findings.length) { console.error(`[rest-stable-order] FAIL — ${findings.length} finding(s):`); for (const f of findings) console.error(`  - ${f}`); process.exit(1) }
console.log(`[rest-stable-order] PASS — every Range page carries the table's unique key (id, or the pinned composite), a caller order keeps its place and gains the key, an unknown table refuses to page, and every restAll table in scripts/ and tests/guards is keyed (${ID_KEYED_TABLES.length} id-keyed + ${Object.keys(ORDER_KEYS).length} composite).`)
