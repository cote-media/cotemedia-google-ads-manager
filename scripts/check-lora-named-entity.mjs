#!/usr/bin/env node
// LORAMER_LORA_NAMED_ENTITY_READ_V1 — THE LIVE HALF: a named entity actually comes back, per platform.
//
// ⛔ WHY A SECOND CHECK EXISTS AT ALL. The build guard is hermetic — it proves the tool is defined, dispatched
// and attached to both loops. On 2026-08-14 EVERY hermetic check in this repo was green while six scored eval
// questions failed, because "the enum is present" and "the number reaches the user" are different claims and
// only the second one is the product (the same reason check-extra-metrics-serving exists). This check reads
// the store through the SHIPPED shape and fails with the numbers on its face if a name stops arriving.
//
// THE ASSERTION, per ad platform that has entity rows at all: the top entity BY SPEND at the platform's own
// entity grain carries a NON-EMPTY entity_name. A platform with no entity rows is reported and SKIPPED, not
// failed — absence of capture is not a naming defect, and conflating them would make this check cry wolf on a
// client who simply has not been backfilled.
//
// ⚠ HONEST LIMIT: this proves the WAREHOUSE serves a name through the query's own predicate shape. It does not
// drive the Claude tool loop (that needs an API key and costs money) and it cannot prove the model CHOOSES the
// tool — that is the eval's job, and the tool description's.
//
// USAGE: node scripts/check-lora-named-entity.mjs [--guard]
import { readFileSync } from 'node:fs'
import path from 'node:path'

const ROOT = process.env.LORAMER_GUARD_ROOT || process.cwd()

// PURE CORE — the verdict, drivable with no DB.
export function decideNamedEntity(rows) {
  const findings = []
  const skipped = []
  for (const r of rows) {
    if (r.entityRows === 0) { skipped.push(`${r.platform}/${r.level}: no ${r.level} rows captured for any of the ${r.clientsChecked} client(s) checked in the bounded window — SKIPPED, not failed`); continue }
    if (r.namedTop === 0) {
      findings.push(`${r.platform}/${r.level}: the top entity by spend has an EMPTY entity_name across ${r.clientsChecked} client(s) holding ${r.entityRows} row(s). Lora's named read would return a blank where a campaign/ad name belongs — the exact 2026-08-14 failure, one layer down.`)
    }
  }
  return { ok: findings.length === 0, findings, skipped }
}

async function main() {
  try {
    for (const l of readFileSync(path.resolve(ROOT, '.env.local'), 'utf8').split('\n')) {
      const t = l.trim(); if (!t || t.startsWith('#')) continue
      const i = t.indexOf('='); if (i > 0) { const k = t.slice(0, i); if (!process.env[k]) process.env[k] = t.slice(i + 1).replace(/^["']|["']$/g, '') }
    }
  } catch { /* ambient env */ }
  const SB = process.env.NEXT_PUBLIC_SUPABASE_URL, K = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!SB || !K) { console.error('✗ lora-named-entity CANNOT RUN — Supabase env missing. A broken instrument is not a pass.'); process.exitCode = 2; return }
  // ⛔ A FAILED READ IS NOT AN EMPTY ONE. The first cut of this check returned null on !ok and the caller read
  // that as "no rows captured" → SKIP → GREEN, while the real cause was 57014 statement timeout (the 8-second
  // law) on an unbounded cross-client `order=spend.desc` over a 78M-row partitioned table. It printed
  // "rows=none" for SIX grains that hold millions of rows and exited 0. Caught by checking the instrument
  // against a fact already known from SQL. A read that fails now HALTS the check as CANNOT-RUN.
  let readFailure = null
  const get = async (p) => {
    const r = await fetch(`${SB}/rest/v1/${p}`, { headers: { apikey: K, Authorization: `Bearer ${K}` } })
    const body = await r.json().catch(() => null)
    if (!r.ok || (body && body.code)) { readFailure = `HTTP ${r.status} ${JSON.stringify(body).slice(0, 160)}`; return null }
    return body
  }

  // The grains Lora is offered, per platform — mirrors QUERY_ENTITIES_TOOL's enum semantics (google uses
  // ad_group, meta uses ad_set; store grains are product/variant).
  const GRAINS = [
    { platform: 'google', level: 'campaign' }, { platform: 'google', level: 'ad' },
    { platform: 'meta', level: 'campaign' }, { platform: 'meta', level: 'ad' },
    { platform: 'shopify', level: 'product' }, { platform: 'woocommerce', level: 'product' },
  ]
  // ⛔ BOUNDED BY CLIENT AND WINDOW, OR IT CANNOT RUN AT ALL. metrics_daily is partitioned and ~78M rows; an
  // unbounded `order=spend.desc` scan times out at the 8s ceiling (measured, above). The check walks the
  // client roster with a recent window so every read matches an index and returns in ~0.5s.
  const clients = await get('clients?select=id&limit=40')
  if (!clients) { console.error(`✗ lora-named-entity CANNOT RUN — client roster unreadable: ${readFailure}`); process.exitCode = 2; return }
  const SINCE = new Date(Date.now() - 120 * 86400000).toISOString().slice(0, 10)
  const rows = []
  for (const g of GRAINS) {
    // The SHIPPED predicate: base rows only (breakdown_type=''), one client, one platform, one entity_level,
    // bounded window — then the highest-spend row's name. Ordering in Postgres, not Node: a page cap cannot
    // truncate a max. First client that HAS rows at this grain answers for the grain.
    let top = null, checked = 0
    for (const c of clients) {
      checked++
      const r = await get(`metrics_daily?select=entity_id,entity_name,spend&client_id=eq.${c.id}&platform=eq.${g.platform}&entity_level=eq.${g.level}&breakdown_type=eq.&date=gte.${SINCE}&order=spend.desc&limit=1`)
      if (r === null) { console.error(`✗ lora-named-entity CANNOT RUN — read failed on ${g.platform}/${g.level}: ${readFailure}`); process.exitCode = 2; return }
      if (r.length > 0) { top = r; break }
    }
    const anyRows = Array.isArray(top) ? top.length : 0 // null was already halted above; 0 here means genuinely no rows across the roster
    const named = anyRows > 0 && String(top[0].entity_name ?? '').trim() !== '' ? 1 : 0
    rows.push({
      platform: g.platform, level: g.level, entityRows: anyRows, namedTop: named, clientsChecked: checked,
      sample: anyRows > 0 ? String(top[0].entity_name ?? '') : null,
    })
    console.log(`[lora-named-entity] ${g.platform}/${g.level}: rows=${anyRows ? 'yes' : 'none'} · topName=${anyRows ? JSON.stringify(String(top[0].entity_name ?? '').slice(0, 48)) : 'n/a'}`)
  }

  const v = decideNamedEntity(rows)
  for (const s of v.skipped) console.log(`[lora-named-entity] SKIP — ${s}`)
  console.log(`[lora-named-entity] ${rows.length} grain(s) examined · ${rows.filter((r) => r.entityRows > 0).length} with rows · ${rows.filter((r) => r.namedTop).length} serving a name`)
  console.log('[lora-named-entity] LIVE READ of the warehouse through the shipped predicate — NOT a drive of the Claude tool loop and NOT proof the model chooses the tool.')
  if (!v.ok) { console.error(`✗ LORA-NAMED-ENTITY FAILED — ${v.findings.length} finding(s):`); for (const f of v.findings) console.error(`  - ${f}`); process.exitCode = 1; return }
  console.log('✓ lora-named-entity OK — every grain that holds entity rows serves a non-empty name at the top of it.')
}

const invokedDirectly = process.argv[1] && import.meta.url.endsWith(path.basename(process.argv[1]))
if (invokedDirectly) await main()
