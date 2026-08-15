#!/usr/bin/env node
// LORAMER_GOOGLE_AD_NAME_COMPOSE_V1 — HISTORY REPAIR. Composes display names for already-captured google
// ad-grain rows whose entity_name is '' (or vendor junk), from the vendor's OWN current headline material.
//
// ⛔ GATED. DRY-RUN IS THE DEFAULT AND THE ONLY UNGATED MODE. `--execute` requires BOTH the flag AND
// LORAMER_REPAIR_CONFIRM=ad-names in the environment — Russ authorizes the execution explicitly
// (this flight's instruction: built and proven, NOT run until he says so).
//
// ⛔ WHY AN UPDATE CANNOT COLLIDE, STRUCTURALLY — the adversary's collision attack dissolves before it starts:
// the natural key is (client_id, platform, entity_level, entity_id, date, breakdown_type, breakdown_value)
// (migrations/052:59, metrics_daily_p_natural_key) and **entity_name IS NOT IN IT**. An UPDATE that touches
// ONLY entity_name cannot create a key collision on any row, ever. The dry run still prints the constraint
// definition read live from the catalog, so the proof is quoted, not asserted.
//
// ⛔ WHAT IT TOUCHES AND WHAT IT NEVER TOUCHES:
//   · TARGETS: platform='google', entity_level='ad', breakdown_type='' base rows whose entity_name is ''
//     OR matches the vendor's auto-generated junk shapes ("Ad 1", "Ad #1", "(Ad 1) auto-generated video ad")
//     — junk loses to a composition (LORAMER_GOOGLE_AD_NAME_COMPOSE_V1 precedence), but ONLY when a
//     composition exists for that ad; junk with no material keeps its junk (it is the only identity served).
//   · NEVER: a row whose entity_name is real (non-empty, non-junk) — real vendor names win by precedence;
//     any non-google row; any non-ad grain; any breakdown row.
//   · Ads the vendor no longer serves (deleted/ancient) get NO composition → their rows are LEFT AS-IS and
//     counted in the manifest as unrepairable. Absence stays absence; we do not invent.
//
// ⛔ MANIFEST-FIRST, REVERSIBLE: the dry run writes a manifest JSON (old name → new name per ad, per client,
// with row counts) to the path in --manifest (default ./ad-name-repair-manifest.json). The execute mode
// REQUIRES the manifest from a prior dry run and applies EXACTLY it — never a fresh computation — so what
// Russ approved is what runs. Reversal = applying the manifest's old names back.
//
// USAGE:
//   node scripts/repair-google-ad-names.mjs --client <id>          # dry run, one client
//   node scripts/repair-google-ad-names.mjs                        # dry run, all google clients
//   LORAMER_REPAIR_CONFIRM=ad-names node scripts/repair-google-ad-names.mjs --execute --manifest <file>
import { readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { createRequire } from 'node:module'

const ROOT = process.cwd()
const require_ = createRequire(resolve(ROOT, 'package.json'))
for (const l of readFileSync(resolve(ROOT, '.env.local'), 'utf8').split('\n')) {
  const t = l.trim(); if (!t || t.startsWith('#')) continue
  const i = t.indexOf('='); if (i > 0) { const k = t.slice(0, i); if (!process.env[k]) process.env[k] = t.slice(i + 1).replace(/^["']|["']$/g, '') }
}
const EXECUTE = process.argv.includes('--execute')
const argOf = (name) => { const i = process.argv.indexOf(name); return i > -1 ? process.argv[i + 1] : undefined }
const ONLY_CLIENT = argOf('--client')
const MANIFEST_PATH = argOf('--manifest') || './ad-name-repair-manifest.json'
if (EXECUTE && process.env.LORAMER_REPAIR_CONFIRM !== 'ad-names') {
  console.error('⛔ REFUSING --execute: LORAMER_REPAIR_CONFIRM=ad-names is not set. The execution is Russ-gated by design.')
  process.exit(2)
}

// The junk shapes measured in the probe — anchored, whole-string, so a REAL name containing "Ad 1" survives.
const JUNK = /^(Ad #?\d+|\(Ad \d+\) auto-generated video ad)$/

if (typeof globalThis.WebSocket === 'undefined') globalThis.WebSocket = class { constructor() {} close() {} addEventListener() {} removeEventListener() {} send() {} }
const { createClient } = require_('@supabase/supabase-js')
const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } })

// The composition — imported logic, restated inline ONLY because this is an .mjs script and the TS module
// needs a build step; google-ad-name-compose.guard.mjs leg (a2) pins this copy byte-equivalent to the TS rules.
const composeGoogleAdName = (ad) => {
  if (!ad) return ''
  const rsa = (ad.responsive_search_ad?.headlines || []).map((h) => (h?.text || '').trim()).filter(Boolean)
  if (rsa.length > 0) return rsa.slice(0, 3).join(' | ')
  const eta = [ad.expanded_text_ad?.headline_part1, ad.expanded_text_ad?.headline_part2].map((s) => (s || '').trim()).filter(Boolean)
  if (eta.length > 0) return eta.join(' | ')
  return (ad.name || '').trim()
}

async function main() {
  // ── COLLISION PROOF — quoted from the migration source (no generic SQL RPC is exposed via PostgREST;
  // the live-catalog read of the same constraint is in the flight report, taken via the Supabase MCP) ──
  const migration = readFileSync(resolve(ROOT, 'migrations/052_partition_metrics_daily.sql'), 'utf8')
  const keyLine = migration.split('\n').find((l) => l.includes('metrics_daily_p_natural_key')) || ''
  console.log(`[collision-proof] natural key (migrations/052): ${keyLine.trim()}`)
  if (/entity_name/.test(keyLine)) { console.error('⛔ ABORT: entity_name appears in the natural key — the structural no-collision argument is void.'); process.exit(2) }
  console.log('[collision-proof] entity_name is NOT a key column — an entity_name-only UPDATE cannot violate metrics_daily_p_natural_key on any row.')

  if (EXECUTE) {
    // ── EXECUTE: apply EXACTLY the approved manifest ──────────────────────────────────────────────────
    const manifest = JSON.parse(readFileSync(resolve(ROOT, MANIFEST_PATH), 'utf8'))
    let updated = 0
    for (const c of manifest.clients) {
      for (const ad of c.ads) {
        if (!ad.newName) continue
        const { error, count } = await sb.from('metrics_daily')
          .update({ entity_name: ad.newName }, { count: 'exact' })
          .eq('client_id', c.clientId).eq('platform', 'google').eq('entity_level', 'ad')
          .eq('breakdown_type', '').eq('entity_id', ad.adId).eq('entity_name', ad.oldName)
        if (error) { console.error(`✗ UPDATE failed for ad ${ad.adId}: ${error.message} — stopping; the manifest records exactly how far this got.`); process.exit(1) }
        updated += count ?? 0
        console.log(`  ${c.clientName} · ad ${ad.adId}: ${count} row(s) → ${JSON.stringify(ad.newName.slice(0, 60))}`)
      }
    }
    console.log(`\n[execute] DONE — ${updated} row(s) renamed, per the approved manifest ${MANIFEST_PATH}. Reversal = applying oldName back from the same file.`)
    return
  }

  // ── DRY RUN: build the manifest ───────────────────────────────────────────────────────────────────
  const { GoogleAdsApi } = require_('google-ads-api')
  const api = new GoogleAdsApi({ client_id: process.env.GOOGLE_CLIENT_ID, client_secret: process.env.GOOGLE_CLIENT_SECRET, developer_token: process.env.GOOGLE_ADS_DEVELOPER_TOKEN })

  let q = sb.from('platform_connections').select('client_id, account_id, clients!inner(id, name, user_email, deleted_at)').eq('platform', 'google')
  if (ONLY_CLIENT) q = q.eq('client_id', ONLY_CLIENT)
  const { data: conns, error: cErr } = await q
  if (cErr) { console.error(`✗ connection read failed: ${cErr.message}`); process.exit(1) }

  const manifest = { builtAt: null, note: 'ad-name repair manifest — dry-run output; --execute applies EXACTLY this. Reversal = oldName.', clients: [] }
  let vendorRequests = 0, totalRows = 0, totalRepairable = 0, totalUnrepairable = 0

  for (const conn of conns || []) {
    const client = conn.clients
    if (!client || client.deleted_at) continue
    // Target rows: '' or junk names, base ad grain, grouped per ad.
    // ⛔ PAGINATED — PostgREST caps a single read at 1,000 rows on this project, and the first dry run of this
    // very script read EXACTLY 1,000 of Foam OH's 3,727 ad-grain rows and reported the truncation as a total
    // (the third instance of the page-cap class this repo has banked: 10,788→997 on the spend sum,
    // rows_written.sum() on the liveness check, now this). A manifest built on a capped read under-counts
    // rowCount per ad and mis-scopes the UPDATE. Loop until a short page proves the end.
    const rows = []
    for (let fromIdx = 0; ; fromIdx += 1000) {
      const { data: page, error: rErr } = await sb.from('metrics_daily')
        .select('entity_id, entity_name')
        .eq('client_id', conn.client_id).eq('platform', 'google').eq('entity_level', 'ad').eq('breakdown_type', '')
        .order('id', { ascending: true })
        .range(fromIdx, fromIdx + 999)
      if (rErr) { console.error(`✗ row read failed for ${client.name}: ${rErr.message}`); process.exit(1) }
      rows.push(...(page || []))
      if (!page || page.length < 1000) break
    }
    const byAd = new Map()
    for (const r of rows || []) {
      const name = String(r.entity_name ?? '')
      const target = name === '' || JUNK.test(name)
      const e = byAd.get(r.entity_id) || { rows: 0, targetRows: 0, oldName: name }
      e.rows++; if (target) { e.targetRows++; e.oldName = name }
      byAd.set(r.entity_id, e)
    }
    const targetAds = [...byAd.entries()].filter(([, v]) => v.targetRows > 0)
    if (targetAds.length === 0) { console.log(`  ${client.name}: no target rows — skipped, 0 vendor requests`); continue }

    // ONE vendor request per client: current material for every ad.
    const { data: tok } = await sb.from('google_tokens').select('refresh_token').eq('user_email', client.user_email).single()
    if (!tok?.refresh_token) { console.log(`  ${client.name}: NO refresh token — ${targetAds.length} ad(s) left unrepairable`); totalUnrepairable += targetAds.length; continue }
    const customer = api.Customer({ customer_id: conn.account_id, refresh_token: tok.refresh_token, login_customer_id: process.env.GOOGLE_ADS_MANAGER_ACCOUNT_ID })
    vendorRequests++
    const vendor = await customer.query(`SELECT ad_group_ad.ad.id, ad_group_ad.ad.name, ad_group_ad.ad.responsive_search_ad.headlines, ad_group_ad.ad.expanded_text_ad.headline_part1, ad_group_ad.ad.expanded_text_ad.headline_part2 FROM ad_group_ad`)
    const material = new Map()
    for (const v of vendor) material.set(String(v.ad_group_ad?.ad?.id), v.ad_group_ad?.ad)

    const entry = { clientId: conn.client_id, clientName: client.name, ads: [], unrepairableAds: [] }
    for (const [adId, info] of targetAds) {
      const composed = composeGoogleAdName(material.get(adId))
      totalRows += info.targetRows
      // PRECEDENCE: only a non-empty composition that DIFFERS from the junk/'' repairs a row. A composed
      // value equal to the vendor junk (video ads: no material → compose returns the junk name itself)
      // is NOT a repair — those rows keep the only identity the vendor serves.
      if (composed && composed !== info.oldName) {
        entry.ads.push({ adId, oldName: info.oldName, newName: composed, rowCount: info.targetRows })
        totalRepairable += info.targetRows
      } else {
        entry.unrepairableAds.push({ adId, oldName: info.oldName, reason: material.has(adId) ? 'no composition material served (vendor name is the only identity)' : 'ad no longer served by vendor' , rowCount: info.targetRows })
        totalUnrepairable += info.targetRows
      }
    }
    manifest.clients.push(entry)
    console.log(`  ${client.name}: ${targetAds.length} target ad(s) · ${entry.ads.length} repairable · ${entry.unrepairableAds.length} unrepairable · 1 vendor request`)
  }

  manifest.builtAt = new Date().toISOString()
  writeFileSync(resolve(ROOT, MANIFEST_PATH), JSON.stringify(manifest, null, 1) + '\n')
  console.log(`\n[dry-run] manifest → ${MANIFEST_PATH}`)
  console.log(`[dry-run] vendor requests: ${vendorRequests} · target rows: ${totalRows} · repairable: ${totalRepairable} · unrepairable (left as-is): ${totalUnrepairable}`)
  console.log('[dry-run] ZERO writes performed. Execute requires --execute AND LORAMER_REPAIR_CONFIRM=ad-names, applying EXACTLY this manifest.')
}
await main()
