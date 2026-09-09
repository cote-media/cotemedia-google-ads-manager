#!/usr/bin/env node
// LORAMER_LOOKBACK_LANE_V1 — check:data leg: EVERY GOOGLE ACCOUNT HOLDS ITS CONVERSION-ACTION LOOKBACK WINDOWS.
//
// The lookback lane's boundary is READ from entity_state_history (conversion_action rows carrying
// click_through_lookback_window_days / view_through_lookback_window_days), never typed (DECISIONS
// LORAMER_SESSION_2026_09_05_RULINGS (i)). An account with no such row makes the lane REFUSE (UNKNOWN never
// defaults) — correct, and invisible unless something reports it. This leg reports it, per live google connection.
// ⛔ RED TODAY BY DESIGN: entity_state_history holds 0 conversion_action rows (★CONVERSION-ACTION-CAPTURE-DARK); the
// capture ships in the same commit and lands on the next forward fire after deploy. A red here is the denominator,
// not a surprise. READ-ONLY. No vendor requests.
import { readFileSync, existsSync } from 'node:fs'
import { resolve } from 'node:path'
const ROOT = process.cwd()
if (existsSync(resolve(ROOT, '.env.local'))) {
  for (const line of readFileSync(resolve(ROOT, '.env.local'), 'utf8').split('\n')) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/)
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '')
  }
}
const SB = process.env.NEXT_PUBLIC_SUPABASE_URL
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY
if (!SB || !KEY) { console.error('✗ conversion-action-config-captured: no Supabase credentials (needs .env.local)'); process.exit(1) }
async function rest(path) {
  const r = await fetch(`${SB}/rest/v1/${path}`, { headers: { apikey: KEY, Authorization: `Bearer ${KEY}` } })
  if (!r.ok) throw new Error(`PostgREST ${r.status} on ${path.split('?')[0]}: ${(await r.text()).slice(0, 200)}`)
  return r.json()
}
const KEYS = ['click_through_lookback_window_days', 'view_through_lookback_window_days']
const conns = await rest(`platform_connections?select=client_id,account_id,clients!inner(id,name,deleted_at)&platform=eq.google`)
const live = conns.filter((c) => !c.clients?.deleted_at)
const rows = await rest(`entity_state_history?select=client_id,account_id,state_key,state_value&platform=eq.google&entity_level=eq.conversion_action&state_key=in.(${KEYS.join(',')})&valid_to=is.null&limit=5000`)
const byConn = new Map()
for (const r of rows) {
  const k = `${r.client_id}|${r.account_id}`
  const e = byConn.get(k) ?? { click: 0, view: 0 }
  if (r.state_key === KEYS[0]) e.click++
  else e.view++
  byConn.set(k, e)
}
const missing = live.filter((c) => { const e = byConn.get(`${c.client_id}|${c.account_id}`); return !e || e.click === 0 })
console.log(`[conversion-action-config-captured] ${live.length} live google connection(s) · ${rows.length} open lookback-window row(s) · ${live.length - missing.length} connection(s) hold a click-through window · ${missing.length} hold none.`)
if (missing.length) {
  console.error(`✗ CONVERSION-ACTION-CONFIG-CAPTURED FAILED — ${missing.length} of ${live.length} google connection(s) carry NO conversion_action lookback-window row, so the lookback lane's boundary is UNKNOWN there and the lane REFUSES (by design):`)
  for (const c of missing.slice(0, 20)) console.error(`  - ${c.client_id.slice(0, 8)} (${c.clients?.name ?? '?'}) account ${c.account_id}`)
  console.error('  ⇒ SPEC: DECISIONS (i) — the boundary is read from conversion_action state every forward fire; QUEUE ★CONVERSION-ACTION-CAPTURE-DARK. Lands on the first forward fire after the capture deploys.')
  process.exit(1)
}
console.log(`✓ conversion-action-config-captured OK — every live google connection holds its click-through lookback window; the lookback lane can derive a boundary on all ${live.length}.`)
