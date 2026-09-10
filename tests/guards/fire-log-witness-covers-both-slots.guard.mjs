#!/usr/bin/env node
// LORAMER_FIRE_LOG_WITNESS_BOTH_SLOTS_V1 — THE HEARTBEAT WITNESSES EVERY REQUEST THE FIRE SENDS, FROM BOTH SLOTS.
//
// ⛔ THE DEFECT, MEASURED 2026-09-09: check-fleet-meter-visibility read "FLEET METER DISAGREES WITH THE FIRE LOG BY
// -190 request(s) — fires selected 0, the backfill lane reports 190". The 190 were real, METERED requests
// (universe_attempt_log attempt_started, lane top-edge, Foam OH, 1 each, 2026-09-08 22:06Z → 09-09 02:56Z) — the
// op-budget saw every one. What did not see them was the WITNESS: the fire's heartbeat
// (universe-resume/route.ts, fireHeartbeat 'completed') carried `published: published.length` and
// `requestsSelected: sel.requests` — the DESCENT slot only; the second slot's numbers (selLook.requests,
// lookbackToSend) went to the console and the response, never to universe_fire_log. Self-clearing in observe mode
// (the second slot sends nothing), STRUCTURAL the moment LOOKBACK_SLOT_MODE flips to 'publish': every lookback
// request would be metered and unwitnessed again, and the fleet-meter check would go red by construction.
// ★FLEET-METER-BLIND-TO-SEALED-STRIP-ASKS (08-26) was the same lane's earlier blindness one slot over.
//
// ── THE ASSERTION ───────────────────────────────────────────────────────────────────────────────────────────
//   (a) the 'completed' heartbeat call in universe-resume/route.ts sums BOTH slots: `published` carries
//       `published.length + lookbackToSend.length`, and `requestsSelected` carries `sel.requests +
//       lookbackRequestsToSend` (one integer, one meaning: requests this fire selected to send, all lanes; the
//       per-lane split stays in the response).
//   (b) `lookbackRequestsToSend` is derived beside `lookbackToSend` from the SAME mode switch — in observe mode
//       both are empty/zero by construction.
//   (c) the check's pure core, driven on two STUB fire shapes (named): both slots summed → VISIBLE; the second
//       slot omitted from the witness (the 2026-09-09 shape, descent 0 + lookback 190) → DRIFT.
// RED ON HEAD (9da6853): (a) and (b) absent. Static source read + the check's own pure core; it proves the witness's
// SHAPE, never that a publish-mode fire wrote the sum — that is the first publish fire's Gate-B.
import { readFileSync, existsSync } from 'node:fs'
import { resolve } from 'node:path'

const ROOT = process.env.LORAMER_GUARD_ROOT || process.cwd()
const ROUTE = resolve(ROOT, 'src/app/api/cron/universe-resume/route.ts')
const CHECK = resolve(ROOT, 'scripts/check-fleet-meter-visibility.mjs')
const findings = []

if (!existsSync(ROUTE)) findings.push('universe-resume/route.ts is missing')
else {
  const src = readFileSync(ROUTE, 'utf8')
  const hb = src.match(/fireHeartbeat\(\{\s*fireOutcome: 'completed'[\s\S]*?\}\)/)
  if (!hb) findings.push("(a) no fireHeartbeat({ fireOutcome: 'completed' … }) call found — the fire's completion heartbeat is gone")
  else {
    const call = hb[0]
    // ★FIRE-LOG-PUBLISHED-DOUBLE-COUNTS-LOOKBACK (2026-09-10): the publish path pushes EVERY executed unit — descent AND lookback —
    // into `published` (route.ts :760 → :805), so `published.length` already carries both slots. The f75d8aa sum
    // `published.length + lookbackToSend.length` counted each lookback unit TWICE (fire 6688: published 4 vs publishedOf 2; the
    // 24 h witness 68 vs 34 attempts → walk-liveness read a FALSE EXECUTION-DARK). ONE addend, no second term.
    if (/published:\s*published\.length\s*\+/.test(call)) findings.push("(a) the completion heartbeat's `published` adds a second term to `published.length` — every executed unit (both lanes) is already pushed into `published` at :805, so a second addend counts each lookback unit twice (fire 6688: 4 vs publishedOf 2).")
    if (!/published:\s*published\.length\s*,/.test(call)) findings.push("(a) the completion heartbeat's `published` is not `published.length` — the witness must equal the FIRE line's publishedOf (the executed set, both lanes).")
    if (!/published\.push\(\{\s*lane/.test(src)) findings.push("(a) the executed set no longer pushes `{ lane, … }` into `published` — if lookback units stop entering `published`, the single-addend witness under-counts them (the −190 shape)")
    if (!/requestsSelected:\s*sel\.requests\s*\+\s*lookbackRequestsToSend/.test(call)) findings.push("(a) the completion heartbeat's `requestsSelected` does not sum both slots (expected `sel.requests + lookbackRequestsToSend`) — the 2026-09-09 −190 shape returns on the first publish fire.")
  }
  if (!/const lookbackRequestsToSend\s*=\s*LOOKBACK_SLOT_MODE === 'publish'\s*\?\s*selLook\.requests\s*:\s*0/.test(src)) findings.push("(b) `lookbackRequestsToSend` is not derived from the same LOOKBACK_SLOT_MODE switch as `lookbackToSend` — the two halves of the second slot could disagree.")
}

if (!existsSync(CHECK)) findings.push('scripts/check-fleet-meter-visibility.mjs is missing')
else {
  const mod = await import(CHECK)
  const d = mod.decideFleetMeterVisibility
  // STUB fire shapes (named): the descent slot 0 + the lookback slot 190, meter 190, over 288 fires.
  const summed = d({ selected: 0 + 190, meterBackfill: 190, attemptStarted: 190, windowLog: 0, fires: 288 })
  if (!summed.ok || summed.state !== 'VISIBLE') findings.push(`(c) both slots summed in the witness reads ${summed.state} — expected VISIBLE`)
  const omitted = d({ selected: 0, meterBackfill: 190, attemptStarted: 190, windowLog: 0, fires: 288 })
  if (omitted.ok || omitted.state !== 'DRIFT') findings.push(`(c) the second slot omitted from the witness reads ${omitted.state} — expected DRIFT (the 2026-09-09 −190 shape)`)
}

if (findings.length) {
  console.error(`[fire-log-witness-covers-both-slots] FAIL — ${findings.length} finding(s):\n  - ${findings.join('\n  - ')}`)
  process.exit(1)
}
console.log('[fire-log-witness-covers-both-slots] PASS — the completion heartbeat witnesses both slots ONCE: published = published.length (every executed unit of either lane is pushed there), requestsSelected = sel.requests + lookbackRequestsToSend, both derived from the one mode switch; the check reads VISIBLE on the summed witness and DRIFT on the omitted one (STUB shapes).')
