// LORAMER_GOOGLE_CONV_ACTION_CATEGORY_NAME_V1 — idempotent, additive backfill of the decoded
// conversion_action_category_name onto EXISTING Google conversion_action rows in metrics_daily.
//
// WHAT IT DOES: for every row WHERE platform='google' AND breakdown_type='conversion_action'
//   AND extra->>'conversion_action_category' IS NOT NULL AND extra->>'conversion_action_category_name' IS NULL,
//   shallow-copies extra, adds conversion_action_category_name = decode(ordinal), and writes it back by id
//   (PATCH on the primary key — the existing row, never a new one). The raw ordinal is kept byte-for-byte.
//   Null-decode rows (blank / non-numeric ordinal) are SKIPPED, never written.
//
// DECODE: byte-identical twin of decodeCategoryName() in src/lib/intelligence/google-conversion-action.ts.
//   (That file is TS behind the '@/…' path alias, not importable from a plain .mjs; the enum source —
//   google-ads-api v23 ConversionActionCategory — is the same authoritative object both use.)
//
// SAFE TO RE-RUN: idempotent. Once a row has the name key it is no longer a candidate. ZERO Google API,
//   ZERO quota, $0. Reads/writes ONLY metrics_daily.extra.
//
// USAGE (from repo root, on a machine WITH real Supabase creds — NOT the placeholder-cred MacBook Air):
//   node scripts/backfill-google-conv-action-category-name.mjs           # DRY-RUN (default): 0 writes, prints plan
//   node scripts/backfill-google-conv-action-category-name.mjs --apply   # performs the PATCH writes
//
// Follows the stripe-sync pattern: loads .env.local, and talks to PostgREST via direct authenticated
// fetch (NOT @supabase/supabase-js — its createClient eagerly builds a realtime ws client that throws on Node 20).

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import gapkg from 'google-ads-api'
const { enums } = gapkg

const APPLY = process.argv.includes('--apply')

// ── env ──────────────────────────────────────────────────────────────────────
function loadDotEnvLocal() {
  let raw
  try { raw = readFileSync(resolve(process.cwd(), '.env.local'), 'utf8') } catch { return }
  for (const line of raw.split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/)
    if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '')
  }
}
loadDotEnvLocal()
const SUPA_URL = process.env.NEXT_PUBLIC_SUPABASE_URL
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY
if (!SUPA_URL || !SERVICE_KEY) { console.error('Missing NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY'); process.exit(1) }
const REST = `${SUPA_URL.replace(/\/$/, '')}/rest/v1`
const headers = { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, 'Content-Type': 'application/json' }

// ── decode (byte-identical to decodeCategoryName in google-conversion-action.ts) ──
function decodeCategoryName(ordinal) {
  if (ordinal == null || ordinal === '') return null
  const n = Number(ordinal)
  if (!Number.isInteger(n)) return null
  return enums.ConversionActionCategory[n] ?? null
}

// ── fetch all candidate rows (paged) ──────────────────────────────────────────
async function fetchCandidates() {
  const rows = []
  const PAGE = 1000
  let from = 0
  // name key absent/null AND ordinal present. `->>` yields null when the key is absent, so is.null covers both.
  const filter =
    `platform=eq.google&breakdown_type=eq.conversion_action` +
    `&extra->>conversion_action_category=not.is.null` +
    `&extra->>conversion_action_category_name=is.null`
  for (;;) {
    const url = `${REST}/metrics_daily?select=id,extra&${filter}&order=id.asc&limit=${PAGE}&offset=${from}`
    const res = await fetch(url, { headers })
    if (!res.ok) throw new Error(`select failed ${res.status}: ${await res.text()}`)
    const batch = await res.json()
    rows.push(...batch)
    if (batch.length < PAGE) break
    from += PAGE
  }
  return rows
}

// ── main ──────────────────────────────────────────────────────────────────────
const candidates = await fetchCandidates()
let toUpdate = 0, toSkip = 0
const byOrdinal = new Map()   // ordinal -> { name, count }
const samples = []
const updates = []            // { id, extra } for --apply
for (const r of candidates) {
  const ordinal = r.extra?.conversion_action_category ?? null
  const name = decodeCategoryName(ordinal)
  const bucket = byOrdinal.get(String(ordinal)) || { name, count: 0 }
  bucket.count++; byOrdinal.set(String(ordinal), bucket)
  if (name == null) { toSkip++; continue }          // null-decode → skip, never write
  toUpdate++
  const proposed = { ...r.extra, conversion_action_category_name: name }   // shallow copy, raw retained
  updates.push({ id: r.id, extra: proposed })
  if (samples.length < 5) samples.push({ id: r.id, before: r.extra, after: proposed })
}

console.log(`\n=== ${APPLY ? 'APPLY' : 'DRY-RUN (0 writes)'} — Google conv-action category-name backfill ===`)
console.log(`candidate rows (name missing, ordinal present): ${candidates.length}`)
console.log(`WOULD UPDATE: ${toUpdate}    WOULD SKIP (null-decode): ${toSkip}`)
console.log('\nby ordinal → name (× rows):')
for (const [ord, b] of [...byOrdinal.entries()].sort((a, b) => b[1].count - a[1].count))
  console.log(`  ${String(ord).padStart(3)} → ${b.name ?? 'null (SKIP)'}  × ${b.count}`)
console.log('\nsample before/after (raw ordinal untouched, name added):')
for (const s of samples) {
  console.log(`  id ${s.id}`)
  console.log(`    before: ${JSON.stringify(s.before)}`)
  console.log(`    after : ${JSON.stringify(s.after)}`)
}

if (!APPLY) { console.log('\nDRY-RUN only — no rows written. Re-run with --apply to write.'); process.exit(0) }

// ── apply: PATCH each row by id (idempotent; existing row, never a new one) ──
let done = 0
for (const u of updates) {
  const res = await fetch(`${REST}/metrics_daily?id=eq.${u.id}`, {
    method: 'PATCH', headers: { ...headers, Prefer: 'return=minimal' }, body: JSON.stringify({ extra: u.extra }),
  })
  if (!res.ok) { console.error(`PATCH id ${u.id} failed ${res.status}: ${await res.text()}`); process.exit(1) }
  if (++done % 100 === 0) console.log(`  …${done}/${updates.length}`)
}
console.log(`\nAPPLIED: ${done} rows updated. skipped: ${toSkip}.`)
