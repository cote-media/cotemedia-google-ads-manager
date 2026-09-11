#!/usr/bin/env node
// LORAMER_REST_ROW_CAP_READER_V1 — A RAW PostgREST READ IN scripts/ OR tests/guards/ MUST PAGE, COUNT, OR GO THROUGH THE HELPER.
//
// ⛔ THE DEFECT, MEASURED 2026-09-11 17:02Z: check-forward-driver-connection-day-complete.mjs fetched
// `forward_observation_log?…&limit=100000` with a bare fetch, received HTTP 206 · Content-Range 0-999/5423 · 1,000 rows,
// and judged 16 of 17 connections SHORT on a truncated page while every one of them held 319/319. PostgREST's max-rows
// is a server ceiling a client `limit=` cannot raise (docs.postgrest.org configuration → db-max-rows); the true total is
// in Content-Range only when the reader asks (Prefer: count=exact) and reads it. The same shape lay in
// top-edge-never-attests.guard.mjs:173 — 1,000 of 9,097 top-edge starts examined, 8,097 never looked at, verdict PASS.
// repair-google-ad-names.mjs:125 already called this "the third instance of the page-cap class this repo has banked";
// this guard is the first time the CLASS, not an instance, can fail a build.
//
// THE PROPERTY (settled in the 2026-09-11 ADVERSARY round): every `fetch(`${…}/rest/v1/…`)` in scripts/*.mjs,
// scripts/lib/*.mjs and tests/guards/*.mjs either
//   · carries a `Range:` header (client paging), or
//   · is a `method: 'HEAD'` count read, or
//   · targets `/rest/v1/rpc/` (server-side aggregate), or
//   · lives in a file that imports scripts/lib/rest-all.mjs (the helper pages from the server's own total and THROWS when
//     the rows held differ from it).
// Anything else is a one-page-and-trust reader: a candidate liar, RED here unless frozen below.
//
// ⛔ THE ALLOWLIST IS A REMOVE-ONLY BASELINE FREEZE (the house shape: A LAW IS NOT BANKED UNTIL IT CAN FAIL A BUILD —
// "a baseline freeze is not absolution; it is a burn-down under Russ's approval"). It holds the 18 sites that existed on
// 2026-09-11 with one line each saying WHY they are honest today or when they stop being so. ADDING AN ENTRY IS ITSELF A
// REFUSAL — a new raw reader goes through the helper. A stale entry (its snippet no longer in the file) is a FINDING too:
// remove it, so the burn-down is recorded rather than silently forgotten.
//
// LIMIT, stated: the regex sees a fetch whose template carries `/rest/v1/` literally. A base URL that already contains
// `/rest/v1` (`${REST}/metrics_daily`) is invisible to it — the one such caller today
// (backfill-google-conv-action-category-name.mjs:66) paginates by offset. A grep guard proves SHAPE, never that a
// paged read is used where it matters; that half is the helper's throw.
//
// USAGE: node tests/guards/rest-row-cap-readers.guard.mjs    (registered in scripts/run-guards.mjs)
import { readFileSync, readdirSync } from 'node:fs'
import { resolve, join } from 'node:path'

const ROOT = process.env.LORAMER_GUARD_ROOT || process.cwd()
const SELF = 'tests/guards/rest-row-cap-readers.guard.mjs'
const HELPER = 'scripts/lib/rest-all.mjs'
const DIRS = ['scripts', 'scripts/lib', 'tests/guards']

// The fetch shape under judgement. Built from a string so this file's own source does not match itself.
const FETCH_RE = new RegExp('fetch\\(`\\$\\{[A-Za-z_]+\\}' + '/rest/v1/')
const EXEMPT_RE = /Range:|method:\s*['"]HEAD['"]|\/rest\/v1\/rpc\//
const IMPORTS_HELPER_RE = /^\s*import\b[^\n]*rest-all\.mjs['"]/m

// REMOVE-ONLY. Matching is by file + snippet (the trimmed line, first 72 chars); the recorded line is for the reader.
// A drifted line number is reported, never a failure — the snippet is the identity.
const ALLOWLIST = [
  { file: 'scripts/check-binding-coverage.mjs', line: 50, why: 'reads: connections limit=200 (~60 rows) + limit=1 existence probes' },
  { file: 'scripts/check-conversion-action-config-captured.mjs', line: 24, why: 'CANDIDATE — :31 limit=5000 absence-judgement over entity_state_history open rows (456 on 2026-09-11); lies past max-rows' },
  { file: 'scripts/check-consumer-liveness.mjs', line: 123, why: 'bounded: 45-minute window, limit=200 (≤ 9 fires at the 5-minute cadence)' },
  { file: 'scripts/check-coverage-density.mjs', line: 54, why: 'reads: connections + clients limit=200 (~60 rows); density itself via RPC' },
  { file: 'scripts/check-fleet-meter-visibility.mjs', line: 91, why: 'CANDIDATE-BY-GROWTH — :107 fires limit=500 (288 per 24 h on 2026-09-11); the forward leg :163 counts via HEAD count=exact' },
  { file: 'scripts/check-google-forward-account-day.mjs', line: 39, why: 'CANDIDATE — :127 limit=1000 absence-judgement (~connections × fires, ~108 on 2026-09-11); metrics reads chunk 50 ids' },
  { file: 'scripts/check-lora-named-entity.mjs', line: 54, why: 'reads: clients limit=40 + top-1 by spend (limit=1)' },
  { file: 'scripts/check-walk-liveness.mjs', line: 109, why: 'newest-200 fires by order=fired_at.desc, used only for latestCompleted; rows via RPC :136, attempts via HEAD count=exact :151' },
  { file: 'scripts/check-restate-prune-live.mjs', line: 63, why: 'CANDIDATE — :174 one client-day of ad_group×search_term rows with no limit (300 on 2026-09-09); :130 limit=6 sample; :194 exact-count scope legs' },
  { file: 'scripts/check-restate-prune-live.mjs', line: 69, why: 'a POST upsert (write, not a read)' },
  { file: 'scripts/check-restate-prune-live.mjs', line: 76, why: 'a DELETE (write, not a read)' },
  { file: 'scripts/google-ads-capture-universe.mjs', line: 240, why: 'single-row lookups: one connection, one token' },
  { file: 'scripts/drive-one-surface.mjs', line: 202, why: 'limit=1 reads only (frontier, newest row, one terminal)' },
  { file: 'scripts/rmf-adapter-gate.mjs', line: 85, why: 'single-row lookups: one connection, one token' },
  { file: 'scripts/stripe-sync-products.mjs', line: 129, why: 'one plan_entitlements row per tier' },
  { file: 'tests/guards/anchor-recedes-by-window.guard.mjs', line: 233, why: 'CANDIDATE-BY-GROWTH — :262-263 inception (2 rows) / floor (0 rows) read with no limit; floor can reach one row per client × surface; :243 pages by offset' },
  { file: 'tests/guards/device-respell-scope.guard.mjs', line: 40, why: 'limit=1 existence probe' },
  { file: 'tests/guards/top-edge-is-held.guard.mjs', line: 102, why: 'pages by limit=1000&offset loop at :112' },
]

const findings = []
const notes = []
const read = (p) => { try { return readFileSync(resolve(ROOT, p), 'utf8') } catch { return null } }
const snip = (s) => s.trim().slice(0, 72)

const files = []
for (const d of DIRS) {
  let names = []
  try { names = readdirSync(resolve(ROOT, d)) } catch { continue }
  for (const n of names) if (n.endsWith('.mjs')) files.push(join(d, n).replace(/\\/g, '/'))
}

const sites = [] // { file, line, snippet }
for (const f of files) {
  if (f === SELF || f === HELPER) continue
  const src = read(f)
  if (src === null) continue
  if (IMPORTS_HELPER_RE.test(src)) continue // honest by construction — the helper pages from the server total and throws on a mismatch
  const lines = src.split('\n')
  lines.forEach((l, i) => {
    if (/^\s*(\/\/|\*)/.test(l)) return // a comment is not a reader
    if (!FETCH_RE.test(l)) return
    if (EXEMPT_RE.test(l)) return
    sites.push({ file: f, line: i + 1, snippet: snip(l) })
  })
}

// the snippet each allowlist entry pins, read from the file at build time so the freeze is by identity, not by number
const allowMatched = new Set()
for (const a of ALLOWLIST) {
  const src = read(a.file)
  if (src === null) { findings.push(`STALE ALLOWLIST — ${a.file} no longer exists; remove its ${a.file}:${a.line} entry`); continue }
  const lines = src.split('\n')
  const hits = sites.filter((s) => s.file === a.file)
  const exact = hits.find((s) => s.line === a.line)
  const byDrift = exact ? null : hits.find((s) => !allowMatched.has(`${s.file}:${s.line}`))
  const site = exact || byDrift
  if (!site) { findings.push(`STALE ALLOWLIST — ${a.file}:${a.line} no longer carries a raw /rest/v1/ fetch; remove the entry so the burn-down is recorded`); continue }
  if (!exact) notes.push(`allowlist line drift — ${a.file}:${a.line} is now :${site.line} (${snip(lines[site.line - 1])})`)
  allowMatched.add(`${site.file}:${site.line}`)
}

const unfrozen = sites.filter((s) => !allowMatched.has(`${s.file}:${s.line}`))
for (const s of unfrozen) {
  findings.push(`${s.file}:${s.line} — a raw /rest/v1/ fetch with no Range:, no HEAD, no rpc/, in a file that does not import ${HELPER}: \`${s.snippet}\`. ` +
    `One page of a server-capped response is not the row set; route the read through restAll() (pages from Content-Range, throws when held ≠ total). ⛔ Adding this line to the allowlist is itself a refusal.`)
}

// the helper must exist and carry the four throws once anything imports it
const helperSrc = read(HELPER)
const importers = files.filter((f) => f !== HELPER && f !== SELF && IMPORTS_HELPER_RE.test(read(f) || ''))
if (importers.length) {
  if (!helperSrc) findings.push(`${importers.length} file(s) import ${HELPER} but it does not exist`)
  else {
    for (const [what, re] of [
      ['Prefer: count=exact on the first page', /count=exact/],
      ['a Range header per page', /Range:/],
      ['a throw on an unknown (*) total', /total[^\n]*\*|\*[^\n]*unknown/i],
      ['a throw on 416', /416/],
      ['a throw when held ≠ total', /held[^\n]*(≠|!==)[^\n]*total|total[^\n]*(≠|!==)[^\n]*held/i],
    ]) if (!re.test(helperSrc)) findings.push(`${HELPER} lacks ${what}`)
  }
}

const roster = read('scripts/run-guards.mjs') || ''
if (!roster.includes(SELF)) findings.push(`this guard is not registered in scripts/run-guards.mjs — an unregistered guard never runs`)

for (const n of notes) console.log(`[rest-row-cap-readers] note: ${n}`)
if (findings.length) {
  console.error(`✗ rest-row-cap-readers FAILED — ${findings.length} finding(s) across ${files.length} file(s), ${sites.length} raw /rest/v1/ fetch site(s), ${ALLOWLIST.length} frozen:`)
  for (const f of findings) console.error(`  ✗ ${f}`)
  console.error('  ⇒ SPEC: LORAMER_REST_ROW_CAP_READER_V1 — page from the server total (scripts/lib/rest-all.mjs), count with HEAD + Prefer: count=exact, or aggregate in an RPC. A client limit= cannot exceed max-rows.')
  process.exit(1)
}
console.log(`✓ rest-row-cap-readers OK — ${files.length} file(s) scanned · ${sites.length} raw /rest/v1/ fetch site(s), all ${ALLOWLIST.length} frozen by identity · ${importers.length} file(s) read through ${HELPER}.`)
