#!/usr/bin/env node
// LORAMER_EXTRA_METRIC_REACHABILITY_V1 — THE LIVE HALF. tests/guards/extra-metrics-reachable.guard.mjs is
// hermetic: it proves the WIRING (declaration exists, SQL mirrors TS, the query layer carries the values,
// the tool schema names them). It runs on Vercel, so it cannot touch a database, so it CANNOT prove the one
// thing that actually matters — that the number the RPC returns is the number in the store.
//
// ⛔ THIS IS THE HALF THAT WOULD HAVE CAUGHT THE ORIGINAL DEFECT. Every hermetic check in this repo was green
// on 2026-08-14 while six eval questions failed, because "the code compiles and the enum is present" and "the
// number reaches the user" are different claims. The four assertions below are the exact figures Russ's truth
// pass certified by hand, read back THROUGH THE SHIPPED RPC. If migration 067 is ever reverted, rewritten, or
// replaced by a migration that drops `extra` from the aggregation, these go red with the numbers on the face.
//
// DB WORK, DELIBERATELY OUTSIDE `npm run guard` AND `npm run build` — same posture as every other check:data
// leg. It never runs on Vercel and never gates a deploy on network reachability.
//
// ⛔ SCOPE LIMIT, STATED SO THE GREEN IS NOT OVER-READ: this proves the RPC serves the certified per-day sums
// for ONE client (Foam OH) on FOUR GA families. It does NOT prove Shopify/Meta/Woo extra keys are correct —
// those ship on declared additivity and are not covered by any hand-verified figure yet. It also does NOT
// prove Lora states them correctly; that is the eval's job, not a data check's.
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const ROOT = process.env.LORAMER_GUARD_ROOT || process.cwd()
let SB_URL = process.env.NEXT_PUBLIC_SUPABASE_URL
let SB_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY
if (!SB_URL || !SB_KEY) {
  // Match the house pattern: read .env.local directly rather than depending on a loader. supabase-js is
  // deliberately NOT imported — it throws on Node 20 without a WebSocket polyfill (measured 2026-08-13), and a
  // data check that cannot start is indistinguishable from a data check that passed.
  try {
    const env = readFileSync(resolve(ROOT, '.env.local'), 'utf8')
    const val = (k) => (env.match(new RegExp('^' + k + '=(.*)$', 'm')) || [])[1]?.trim()?.replace(/^["']|["']$/g, '')
    SB_URL ||= val('NEXT_PUBLIC_SUPABASE_URL')
    SB_KEY ||= val('SUPABASE_SERVICE_ROLE_KEY')
  } catch { /* reported below */ }
}
if (!SB_URL || !SB_KEY) {
  console.error('✗ LORAMER_EXTRA_METRIC_REACHABILITY_V1 (live) — no Supabase credentials (env or .env.local). ' +
    'A check that cannot reach its evidence FAILS; it does not pass quietly.')
  process.exitCode = 1
} else {
  const CLIENT = '957d484e-d0c4-4dd0-b382-d8499d556252' // Foam OH — the client every eval truth was certified against

  // The certified figures, hand-verified in the 2026-08-13/14 truth pass and reproduced from metrics_daily.
  // family, level, window, rankBy, [expected top-N values of that metric]
  const CASES = [
    { id: 'B2  ga_landing_page Q2-2026 by sessions', bt: 'ga_landing_page', start: '2026-04-01', end: '2026-06-30', rank: 'sessions', want: [2742, 2033, 1315] },
    { id: 'B6  ga_event Jun-2026 by eventCount', bt: 'ga_event', start: '2026-06-01', end: '2026-06-30', rank: 'eventCount', want: [5603, 3252, 2423] },
    { id: 'B7  ga_device Q2-2026 by sessions', bt: 'ga_device', start: '2026-04-01', end: '2026-06-30', rank: 'sessions', want: [10567, 5766, 889] },
    { id: 'B19 ga_channel Jun-2026 by sessions', bt: 'ga_channel', start: '2026-06-01', end: '2026-06-30', rank: 'sessions', want: [1269, 728] },
  ]

  const rpc = async (name, body) => {
    const r = await fetch(`${SB_URL}/rest/v1/rpc/${name}`, {
      method: 'POST',
      headers: { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    if (!r.ok) throw new Error(`${name} HTTP ${r.status} ${(await r.text()).slice(0, 200)}`)
    return r.json()
  }

  const findings = []
  for (const c of CASES) {
    try {
      const out = await rpc('query_breakdown_agg_topn', {
        p_client_id: CLIENT, p_platform: 'ga', p_breakdown_type: c.bt, p_entity_level: 'account',
        p_start: c.start, p_end: c.end, p_rank_by: c.rank, p_top_n: c.want.length, p_order_dir: 'desc',
        p_parent_entity_id: null, p_entity_id: null,
      })
      const rows = out?.rows || []
      const got = rows.map((r) => r?.extra_metrics?.[c.rank])
      if (got.some((v) => v == null)) {
        findings.push(`${c.id} — the RPC returned ${rows.length} row(s) with NO ${c.rank} in extra_metrics. This is the ` +
          `original defect exactly: the rows exist, the metric is stored, and the aggregation is not reading \`extra\`.`)
        continue
      }
      const bad = got.map((v, i) => (Number(v) === c.want[i] ? null : `#${i + 1} got ${v}, certified ${c.want[i]}`)).filter(Boolean)
      if (bad.length) findings.push(`${c.id} — ${bad.join('; ')}. The certified figure comes from Russ's hand-verified ` +
        `truth pass; a mismatch means either the aggregation changed or the capture did, and BOTH need naming before it is dismissed.`)
    } catch (e) {
      findings.push(`${c.id} — ${e.message}`)
    }
  }

  if (findings.length) {
    console.error(`✗ LORAMER_EXTRA_METRIC_REACHABILITY_V1 (live) — ${findings.length} finding(s):\n`)
    for (const f of findings) console.error('  - ' + f + '\n')
    process.exitCode = 1
  } else {
    console.log(`✓ LORAMER_EXTRA_METRIC_REACHABILITY_V1 (live) — all ${CASES.length} certified GA figures served through ` +
      `query_breakdown_agg_topn exactly (per-day basis; the vendor's deduplicated RANGE total is a separate, declared number).`)
  }
}
