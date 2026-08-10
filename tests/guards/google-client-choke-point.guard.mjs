#!/usr/bin/env node
// LORAMER_GOOGLE_CLIENT_CHOKE_POINT_V1 — GOOGLE ADS CLIENT CONSTRUCTION IS A RATCHET: 14 frozen legacy
// sites, the factory, and NOTHING ELSE. The count only falls.
//
// ⛔ THE DEFECT, measured 2026-08-10: six probe operations hit Google and appeared in NO ledger. Every
// governor sums our own ledgers, so a code path that constructs its own client is a path whose spend the
// governors re-grant to someone else. This guard makes ADDING such a path a build failure, while the 14
// pre-existing sites are frozen by NAME with a per-file count — migrated lane-by-lane in their own flights
// (live paths: forward, catchup, drain, intelligence, legacy UI routes), never in one big-bang deploy.
//
// ⛔ ANTI-ROT, both directions: a file that leaves the baseline (migrated) FAILS until its entry is deleted —
// the ledger may not outlive the debt (the metrics-upsert-chunked precedent) — and a baseline file whose
// site count GROWS fails like a new site.
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { resolve, join } from 'node:path'

const ROOT = process.env.LORAMER_GUARD_ROOT || process.cwd()
const findings = []

const FACTORY = 'src/lib/google-ads-client.ts'
// ── THE FROZEN BASELINE — every pre-choke-point construction site, by file, with its count ───────────
// ⛔ APPEND NOTHING. Entries leave when their file migrates to googleAdsCustomerFor; they never join.
const BASELINE = {
  'src/app/api/google/adgroups/route.ts': 1,
  'src/app/api/google/adgroups/daily/route.ts': 1,
  'src/app/api/google/ads/route.ts': 1,
  'src/app/api/platform/route.ts': 1,
  'src/lib/google-ads.ts': 1,
  'src/lib/platforms/google.ts': 1,
  'src/lib/intelligence/google-device.ts': 1,
  'src/lib/intelligence/google-hour.ts': 1,
  'src/lib/intelligence/google-geo.ts': 1,
  'src/lib/intelligence/google-dimensional.ts': 1,
  'src/lib/intelligence/google-demographic.ts': 1,
  'src/lib/intelligence/google-intelligence.ts': 1,
  'src/lib/backfill/google-adgroup-ad-backfill.ts': 1,
  'src/lib/backfill/google-campaign-backfill.ts': 1,
}

const files = []
;(function walk(dir) {
  let entries = []
  try { entries = readdirSync(dir) } catch { return }
  for (const name of entries) {
    const p = join(dir, name)
    let st; try { st = statSync(p) } catch { continue }
    if (st.isDirectory()) walk(p)
    else if (/\.(ts|tsx|js|mjs)$/.test(name)) files.push(p)
  }
})(resolve(ROOT, 'src'))
files.push(resolve(ROOT, 'mcp-server.js')) // the standalone MCP server is a Google caller too

const seen = {}
for (const abs of files) {
  let src = ''
  try { src = readFileSync(abs, 'utf8') } catch { continue }
  const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1')
  const n = (code.match(/new\s+GoogleAdsApi\s*\(/g) || []).length
  if (n > 0) seen[abs.slice(resolve(ROOT).length + 1)] = n
}

for (const [rel, n] of Object.entries(seen)) {
  if (rel === FACTORY) { if (n > 1) findings.push(`the factory itself constructs ${n} clients — one construction, one place.`); continue }
  const frozen = BASELINE[rel]
  if (frozen === undefined) {
    findings.push(`NEW Google Ads client construction in ${rel} (${n} site(s)). ⛔ Every new Google touch goes through ` +
      `googleAdsCustomerFor (${FACTORY}) — a self-constructed client is a path whose spend no governor can see ` +
      `(measured: 6 probe ops in no ledger, 2026-08-10).`)
  } else if (n > frozen) {
    findings.push(`${rel} grew from ${frozen} to ${n} construction site(s). The baseline is a RATCHET — it only falls.`)
  }
}
for (const [rel, frozen] of Object.entries(BASELINE)) {
  const n = seen[rel] ?? 0
  if (n < frozen) {
    findings.push(`${rel} migrated (${frozen} → ${n}) but its baseline entry survives. DELETE the entry — the ledger may not outlive the debt.`)
  }
}
if (!seen[FACTORY]) findings.push(`${FACTORY} no longer constructs the client — the choke point was removed or moved without this guard following it.`)

if (findings.length) {
  console.error(`[google-client-choke-point] FAIL — ${findings.length} finding(s):`)
  for (const f of findings) console.error(`  - ${f}`)
  process.exit(1)
}
console.log(`[google-client-choke-point] PASS — client construction is choked: the factory + ${Object.keys(BASELINE).length} frozen legacy site(s) (ratchet: count only falls), 0 new sites, mcp-server.js clean, and the two universe vendor files construct through googleAdsCustomerFor. LIMIT: this chokes CONSTRUCTION; unified request-grain CHARGING is ★GOOGLE-REQUEST-LEDGER, not yet built.`)
