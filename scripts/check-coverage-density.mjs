#!/usr/bin/env node
// LORAMER_COVERAGE_DENSITY_V1 — THE LIVE HALF, AND IT IS A DRIFT MONITOR, NOT ONLY AN ASSERTION.
//
// ⛔ WHY IT MEASURES RATHER THAN MERELY ASSERTS (Russ, 2026-08-15): the fleet numbers that justified the
// 7-day threshold are a SNAPSHOT. If a client's capture degrades, the RECENT-WINDOW flip rate is the earliest
// visible symptom — and the alternative to watching it here is discovering it on stage. So this prints the
// flip rate per standard window every run, and FAILS only on the invariant that must never break.
//
// THE INVARIANT (fails the gate): NO recent-window (L7 / L30) client×platform pair may read PARTIAL while
// capture is healthy. That is the demo surface, and the pre-build measurement showed a naive rule would flip
// 30 of 30 there. A red here means either capture really is holed on a live client — which is worth waking
// up for — or the frontier/threshold has regressed.
// THE DRIFT (printed, never fails): the L90 / YTD / LY flip rates, so the historical picture is visible as it
// moves. Those windows are EXPECTED to carry flips: measured at build time, YTD 5/30 and LY 8/30, and every
// one of them is a genuine multi-week outage.
//
// ⚠ HONEST LIMIT: it re-measures OUR OWN rule against OUR OWN store. It cannot tell a genuine 7+-day pause
// from a capture hole — nothing at base grain can (★ATTESTED-EMPTY-UNREACHABLE-FROM-LORA) — so a client who
// legitimately pauses for a fortnight will show as a flip and that is the threshold's known cost, not a bug.
//
// USAGE: node scripts/check-coverage-density.mjs [--guard]
import { readFileSync } from 'node:fs'
import path from 'node:path'

const ROOT = process.env.LORAMER_GUARD_ROOT || process.cwd()

export function decideDensityDrift(rows) {
  const findings = []
  for (const r of rows) {
    if ((r.label === 'L7' || r.label === 'L30') && r.partial > 0) {
      findings.push(`${r.label}: ${r.partial} of ${r.total} client×platform pair(s) read PARTIAL on a RECENT window — ${r.examples.join(', ')}. Recent windows are the demo surface and were 0/30 at build time: either a live client's capture is genuinely holed (act on it) or the frontier/threshold has regressed (fix it). This is the early warning, and it is meant to be seen here rather than on stage.`)
    }
  }
  return { ok: findings.length === 0, findings }
}

async function main() {
  try {
    for (const l of readFileSync(path.resolve(ROOT, '.env.local'), 'utf8').split('\n')) {
      const t = l.trim(); if (!t || t.startsWith('#')) continue
      const i = t.indexOf('='); if (i > 0) { const k = t.slice(0, i); if (!process.env[k]) process.env[k] = t.slice(i + 1).replace(/^["']|["']$/g, '') }
    }
  } catch { /* ambient env */ }
  const SB = process.env.NEXT_PUBLIC_SUPABASE_URL, K = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!SB || !K) { console.error('✗ coverage-density CANNOT RUN — Supabase env missing. A broken instrument is not a pass.'); process.exitCode = 2; return }
  let readFailure = null
  const rpc = async (fn, body) => {
    const r = await fetch(`${SB}/rest/v1/rpc/${fn}`, { method: 'POST', headers: { apikey: K, Authorization: `Bearer ${K}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
    const j = await r.json().catch(() => null)
    if (!r.ok || (j && j.code)) { readFailure = `HTTP ${r.status} ${JSON.stringify(j).slice(0, 160)}`; return null }
    return j
  }
  const get = async (p) => {
    const r = await fetch(`${SB}/rest/v1/${p}`, { headers: { apikey: K, Authorization: `Bearer ${K}` } })
    const j = await r.json().catch(() => null)
    if (!r.ok || (j && j.code)) { readFailure = `HTTP ${r.status} ${JSON.stringify(j).slice(0, 160)}`; return null }
    return j
  }

  const THRESH = 7
  const iso = (d) => d.toISOString().slice(0, 10)
  const frontier = iso(new Date(Date.now() - 86400000))
  const back = (n) => iso(new Date(Date.now() - n * 86400000))
  const WINDOWS = [
    { label: 'L7', s: back(7), e: back(1) }, { label: 'L30', s: back(30), e: back(1) },
    { label: 'L90', s: back(90), e: back(1) }, { label: 'YTD', s: `${new Date().getUTCFullYear()}-01-01`, e: back(1) },
    { label: 'LY', s: `${new Date().getUTCFullYear() - 1}-01-01`, e: `${new Date().getUTCFullYear() - 1}-12-31` },
  ]

  const conns = await get('platform_connections?select=client_id,platform&limit=200')
  if (!conns) { console.error(`✗ coverage-density CANNOT RUN — connection roster unreadable: ${readFailure}`); process.exitCode = 2; return }
  const names = await get('clients?select=id,name&limit=200')
  const nameOf = new Map((names || []).map((c) => [c.id, c.name]))

  const rows = []
  for (const w of WINDOWS) {
    let partial = 0, total = 0
    const examples = []
    for (const c of conns) {
      const d = await rpc('coverage_density_days', { p_client_id: c.client_id, p_platform: c.platform, p_start: w.s, p_end: w.e })
      if (d === null) { console.error(`✗ coverage-density CANNOT RUN — density read failed: ${readFailure}`); process.exitCode = 2; return }
      const row = Array.isArray(d) ? d[0] : d
      const present = (row?.present_days || []).filter((x) => x <= frontier)
      const floor = row?.capture_floor ?? null
      if (floor === null || floor > w.e) continue           // floor fact — the floor test's to report
      total++
      const end = w.e < frontier ? w.e : frontier
      if (present.length === 0) { partial++; if (examples.length < 3) examples.push(`${nameOf.get(c.client_id) || c.client_id}/${c.platform} 0 days`); continue }
      // longest missing run, window edges included
      let longest = 0, cursor = w.s
      const day = (x, n) => iso(new Date(Date.parse(x + 'T00:00:00Z') + n * 86400000))
      for (const p of present) {
        if (p > cursor) longest = Math.max(longest, Math.round((Date.parse(p) - Date.parse(cursor)) / 86400000))
        cursor = day(p, 1)
      }
      if (cursor <= end) longest = Math.max(longest, Math.round((Date.parse(end) - Date.parse(cursor)) / 86400000) + 1)
      if (longest >= THRESH) { partial++; if (examples.length < 3) examples.push(`${nameOf.get(c.client_id) || c.client_id}/${c.platform} ${longest}d`) }
    }
    rows.push({ label: w.label, total, partial, examples })
    console.log(`[coverage-density] ${w.label.padEnd(4)} ${w.s}..${w.e}: ${partial}/${total} pair(s) PARTIAL${examples.length ? ` — ${examples.join(', ')}` : ''}`)
  }

  const v = decideDensityDrift(rows)
  console.log(`[coverage-density] threshold ${THRESH}d · frontier ${frontier} · DRIFT MONITOR: recent windows FAIL the gate, historical windows are reported so degradation is visible before it is discovered on stage.`)
  if (!v.ok) { console.error(`✗ COVERAGE-DENSITY FAILED — ${v.findings.length} finding(s):`); for (const f of v.findings) console.error(`  - ${f}`); process.exitCode = 1; return }
  console.log('✓ coverage-density OK — no recent-window pair reads PARTIAL; historical flip rates printed above for drift.')
}

const invokedDirectly = process.argv[1] && import.meta.url.endsWith(path.basename(process.argv[1]))
if (invokedDirectly) await main()
