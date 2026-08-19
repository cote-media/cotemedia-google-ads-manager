#!/usr/bin/env node
// LORAMER_TOP_EDGE_LANE_V1 — IS THE TOP OF THE CALENDAR HELD, OR IS IT QUIETLY GROWING?
//
// ⛔ THE PROPERTY, AND IT IS THE ONE NO OTHER DETECTOR CAN SEE. The walk's anchor is monotonically
// non-increasing — a fresh connect anchors at YESTERDAY and every branch of `deriveAnchorEnd` thereafter
// returns either `lastWindowEnd` (hold) or `lastWindowStart − 1` (recede). Nothing in the repo raises it.
// So the ground between a surface's newest asked window and yesterday is held by NOTHING and grows one day
// per day, per surface, forever. MEASURED 2026-08-19 before this lane existed: **346 of 346 Foam OH surfaces
// topped out at 2026-08-12 with a 6-day strip each — 2,076 owed days, +346/day.**
//
// ⛔ AND `no-owed-day-left-behind` IS BLIND TO IT BY DEFINITION, which is why this is a separate guard and
// not a leg. Its own header defines `ASKED = every day covered by an attempt_started row's recorded bounds`
// and `SKIPPED = ASKED ∧ day > FRONTIER ∧ …`. Days ABOVE the highest window ever asked are not in ASKED, so
// they can never be SKIPPED. The detector built to find left-behind owed ground cannot see the class that
// sits above its own frontier.
//
// ⛔ IT SHIPS RED, AND THAT IS THE PROOF IT WORKS RATHER THAN A DEFECT. The strip is 6 days deep on every
// surface at the moment this lands; it goes green only when the top-edge lane has actually run. Same posture
// as `check-nongrain-window-resolves`, which the roster already describes as "the one check whose green is
// GATE-B by construction rather than by choice".
//
// ⚠ LIMITS, so the green is not over-read: it asks whether the top was ASKED, never whether the answer was
// right — a surface whose strip returns zero every day passes here and is correct to. It reads ALL lanes on
// purpose (a day held by the descent is held), and it says nothing about ground below the frontier.
//
// USAGE: node tests/guards/top-edge-is-held.guard.mjs
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const ROOT = process.env.LORAMER_GUARD_ROOT || process.cwd()
const CLIENT = '957d484e-d0c4-4dd0-b382-d8499d556252' // Foam OH — the only account the walk has ever run on
const VENDOR = 'google'

// ── THE TOLERANCE, DERIVED FROM THE CADENCE RATHER THAN CHOSEN ───────────────────────────────────────
// ⛔ EVERY TERM IS A MEASURED OR PINNED NUMBER, AND THE ARITHMETIC IS THE WHOLE JUSTIFICATION:
//   · the cron fires every 5 minutes ⇒ 288 fires/day (vercel.json; pinned byte-for-byte by
//     universe-stream-consumer.guard.mjs leg (e))
//   · TOP_EDGE_REQUESTS_PER_RUN = 2 ⇒ 576 strip publish-slots/day (universe-resumer.ts, with its own
//     derivation beside the constant)
//   · the catalogue holds 346 selectable surfaces ⇒ demand is 346 strip-days/day, one contiguous strip per
//     surface, one GAQL operation each
//   · 576 ÷ 346 = 1.66× oversubscribed ⇒ **every surface is reached within 346/576 of a day = 14.4 hours**
//   ⇒ a tolerance of 0 would go red on the ordinary gap between one pass and the next (14.4h can straddle a
//     date boundary). **1 DAY IS THE SMALLEST INTEGER ABOVE THE 0.6-DAY REFRESH CYCLE**, and it buys a full
//     24 hours — 288 consecutive missed fires — before a red. Anything larger would hide a lane that had
//     stopped for most of a day, which is exactly what this guard is for.
const TOLERANCE_DAYS = 1

const findings = []
const iso = (d) => d.toISOString().slice(0, 10)
const daysBetween = (a, b) => Math.round((Date.parse(a + 'T00:00:00Z') - Date.parse(b + 'T00:00:00Z')) / 86400000)

/**
 * THE PURE DECISION, so the self-test drives it with no clock and no DB.
 * `newestAsked` is the newest `window_end` ANY lane has asked for on this surface.
 */
export function stripVerdict({ newestAsked, newestServable, toleranceDays }) {
  if (newestAsked === null) return { held: false, behind: null, why: 'never-asked' }
  const behind = daysBetween(newestServable, newestAsked)
  return { held: behind <= toleranceDays, behind, why: behind <= toleranceDays ? 'held' : 'strip' }
}

// ── SELF-TEST — GUARD-ON-GUARD, ALWAYS, BEFORE ANY DB READ ───────────────────────────────────────────
// ⛔ A DETECTOR THAT CANNOT SEE THE DEFECT READS EXACTLY LIKE A CLEAN BILL OF HEALTH. The fixture that
// matters is the strip this lane was built for — 6 days — and the one it must NOT cry wolf on, a surface
// asked yesterday. If either goes the wrong way this exits 2 BROKEN rather than 0 or 1.
{
  const cases = [
    { name: 'the 6-day strip measured before the lane existed', a: { newestAsked: '2026-08-12', newestServable: '2026-08-18', toleranceDays: TOLERANCE_DAYS }, held: false },
    { name: 'a surface asked for yesterday', a: { newestAsked: '2026-08-18', newestServable: '2026-08-18', toleranceDays: TOLERANCE_DAYS }, held: true },
    { name: 'a surface exactly at tolerance', a: { newestAsked: '2026-08-17', newestServable: '2026-08-18', toleranceDays: TOLERANCE_DAYS }, held: true },
    { name: 'a surface one day past tolerance', a: { newestAsked: '2026-08-16', newestServable: '2026-08-18', toleranceDays: TOLERANCE_DAYS }, held: false },
    { name: 'a surface never asked at all', a: { newestAsked: null, newestServable: '2026-08-18', toleranceDays: TOLERANCE_DAYS }, held: false },
  ]
  const bad = cases.filter((c) => stripVerdict(c.a).held !== c.held)
  if (bad.length) {
    console.error(`[top-edge-is-held] CANNOT RUN — the decision failed its own self-test on ${bad.length} fixture(s): ` +
      bad.map((c) => `${c.name} → held=${stripVerdict(c.a).held}, expected ${c.held}`).join(' · ') +
      `. ⛔ A BROKEN INSTRUMENT, NOT A PASS.`)
    process.exitCode = 2
    process.exit()
  }
  console.log(`[top-edge-is-held] self-test PASS — 5/5 fixtures at TOLERANCE_DAYS=${TOLERANCE_DAYS}: the 6-day strip is REFUSED, yesterday and exactly-at-tolerance are HELD, one-day-past and never-asked are REFUSED.`)
}

async function main() {
  try {
    for (const l of readFileSync(resolve(ROOT, '.env.local'), 'utf8').split('\n')) {
      const t = l.trim()
      if (!t || t.startsWith('#')) continue
      const i = t.indexOf('=')
      if (i > 0) { const k = t.slice(0, i); if (!process.env[k]) process.env[k] = t.slice(i + 1).replace(/^["']|["']$/g, '') }
    }
  } catch { /* no .env.local — ambient env */ }
  const SB = process.env.NEXT_PUBLIC_SUPABASE_URL, K = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!SB || !K) {
    console.error('✗ top-edge-is-held CANNOT RUN — Supabase env missing. A broken instrument is not a pass.')
    process.exitCode = 2
    return
  }
  const get = async (p) => {
    const r = await fetch(`${SB}/rest/v1/${p}`, { headers: { apikey: K, Authorization: `Bearer ${K}` } })
    const body = await r.json().catch(() => null)
    if (r.status !== 200 || !Array.isArray(body)) throw new Error(`read failed (HTTP ${r.status}) on ${p.slice(0, 90)}: ${JSON.stringify(body).slice(0, 200)}`)
    return body
  }
  // ⛔ PAGED — PostgREST caps at 1,000 rows, and a truncated ledger is a guard that misses the surfaces it
  // was built to find. The same cap that once blinded the rate governor.
  const pageAll = async (base) => {
    const rows = []
    for (let offset = 0; ; offset += 1000) {
      const page = await get(`${base}&limit=1000&offset=${offset}`)
      rows.push(...page)
      if (page.length < 1000) return rows
    }
  }

  let rows
  try {
    // ⛔ ALL LANES, DELIBERATELY. A day the DESCENT asked for is held just as well as one the strip lane
    // asked for; this guard measures whether the TOP IS HELD, not which lane held it.
    rows = await pageAll(`universe_attempt_log?select=resource,segment,window_end&client_id=eq.${CLIENT}&vendor=eq.${VENDOR}&phase=eq.attempt_started&resource=neq.__account_inception&order=window_end.desc`)
  } catch (e) {
    console.error(`✗ top-edge-is-held CANNOT RUN — ${e.message}. ⛔ A COVERAGE VERDICT MUST NOT BE SYNTHESISED FROM A FAILED READ.`)
    process.exitCode = 2
    return
  }

  const newest = new Map()
  for (const r of rows) {
    const k = `${r.resource}|${r.segment ?? ''}`
    const we = String(r.window_end)
    const cur = newest.get(k)
    if (cur === undefined || we > cur) newest.set(k, we)
  }
  if (newest.size === 0) {
    console.error(`✗ top-edge-is-held CANNOT RUN — no attempt_started rows for ${CLIENT}/${VENDOR}; there is no catalog to measure.`)
    process.exitCode = 2
    return
  }

  const newestServable = iso(new Date(Date.now() - 86400000)) // yesterday, the resumer's own frame
  const behind = []
  for (const [k, we] of newest) {
    const v = stripVerdict({ newestAsked: we, newestServable, toleranceDays: TOLERANCE_DAYS })
    if (!v.held) behind.push({ k, we, behind: v.behind })
  }
  behind.sort((a, b) => b.behind - a.behind)

  console.log(`[top-edge-is-held] ${newest.size} surface(s) · newest servable ${newestServable} · tolerance ${TOLERANCE_DAYS} day(s) · ${newest.size - behind.length} held · ${behind.length} carrying a strip.`)
  if (behind.length) {
    const totalDays = behind.reduce((n, b) => n + (b.behind - TOLERANCE_DAYS), 0)
    findings.push(
      `${behind.length} of ${newest.size} surface(s) have UNHELD ground above their newest asked window — ${totalDays} owed day(s) beyond tolerance, growing by ${newest.size} day(s) per day. ` +
      `Deepest: ${behind.slice(0, 5).map((b) => `${b.k} at ${b.we} (${b.behind}d behind)`).join(' · ')}${behind.length > 5 ? ` · …and ${behind.length - 5} more` : ''}. ` +
      `⛔ THE WALK'S ANCHOR ONLY MOVES DOWN, so nothing behind it will ever come back for these days — they are held by the top-edge lane or by nothing.`)
  }
}

await main()

if (findings.length) {
  console.error(`[top-edge-is-held] FAIL — ${findings.length} finding(s):`)
  for (const f of findings) console.error(`  ✗ ${f}`)
  console.error(`  ⇒ SPEC: DECISIONS LORAMER_TOP_EDGE_LANE_V1 + QUEUE ★TOP-EDGE-HAS-NO-LANE. Expected RED until the top-edge lane has run a full cycle (~14.4h at 288 fires × ${'2'} slots against 346 surfaces).`)
  process.exitCode = 1
} else {
  console.log(`[top-edge-is-held] PASS — every surface's newest asked window is within ${TOLERANCE_DAYS} day(s) of the newest servable day. ⛔ LIMIT: this proves the top was ASKED, never that the answer was right.`)
}
