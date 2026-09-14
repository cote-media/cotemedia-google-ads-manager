#!/usr/bin/env node
// LORAMER_FLEET_METER_PINNED_WINDOW_V1 — THE FLEET-METER WITNESS READS A PINNED CLOSED FIRE INTERVAL, COUNTS DISCOVERY OPS,
// AND IMPORTS ITS PER-FIRE CEILING — SO THE EXPECTED DRIFT IS EXACTLY 0 AND ONE LOST FIRE IS VISIBLE.
//
// THE DEFECT (QUEUE ★FLEET-METER-DRIFT-FLICKERS, diagnosed live 2026-09-14 round 8): check-fleet-meter-visibility compared a
// rolling now−24h sum of universe_attempt_log(attempt_started) against the fires' requests_selected over the same rolling
// window, under a hand-typed `IN_FLIGHT_TOLERANCE = 40`. Three classes, all measured:
//  (a) a fire STRADDLING the window edge is in one sum and not the other (attempts by recorded_at, fires by completion);
//  (b) the first-touch DISCOVERY op (resource '__account_inception', requests_spent 1) is metered but in no fire's selection —
//      +1 per cold client (14 on 09-13, exactly the +14 drift pinned at 16:08:21Z);
//  (c) a read landing MID-FIRE sees that fire's attempts and not its row — 48–50 today, over the literal 40 (a copy of the
//      OLD MAX_REQUESTS_PER_RUN) — so ~40% of reads flickered RED on healthy data, and a 2-request lost fire hid under 40.
// THE FIX, pinned here: pinFleetWindow() drops the straddler and pins [first kept fire's start, newest fired_at]; the meter
// is read from that start and the attempts recorded after the newest fire (the in-flight fire) are subtracted; discovery
// ops inside the interval join the witness; the per-fire ceiling is READ from universe-resumer.ts (MAX_REQUESTS_PER_RUN +
// LOOKBACK_REQUESTS_PER_RUN + MISSED_REQUESTS_PER_RUN), never typed; the verdict demands drift === 0.
// Seen RED first against 9ff445c: pinFleetWindow absent → fixtures (a) straddler, (c) mid-fire and (e′) small lost fire
// judged under the rolling contract read DRIFT · VISIBLE · VISIBLE where VISIBLE · VISIBLE · DRIFT is required.
import { readFileSync, existsSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')
const findings = []
const CHECK = 'scripts/check-fleet-meter-visibility.mjs'
const RESUMER = 'src/lib/backfill/universe-resumer.ts'
const RUNNER = 'scripts/run-guards.mjs'
const SELF = 'tests/guards/fleet-meter-pinned-window.guard.mjs'
const read = (p) => { try { return readFileSync(resolve(ROOT, p), 'utf8') } catch { return '' } }

// ── the ceiling, parsed INDEPENDENTLY of the script so a wrong reader cannot agree with itself ─────────────
const resumer = read(RESUMER)
const constOf = (name) => { const m = resumer.match(new RegExp(`export const ${name}\\s*=\\s*([0-9_]+)`)); return m ? Number(m[1].replace(/_/g, '')) : NaN }
const CEILING = constOf('MAX_REQUESTS_PER_RUN') + constOf('LOOKBACK_REQUESTS_PER_RUN') + constOf('MISSED_REQUESTS_PER_RUN')
if (!Number.isFinite(CEILING)) findings.push(`(f) could not parse the three per-run constants from ${RESUMER}`)

// ── STATIC: the literal is gone ─────────────────────────────────────────────────────────────────────────
const src = read(CHECK).replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`])\/\/[^\n]*/g, '$1') // comments stripped: the CODE may not carry the literal
if (/IN_FLIGHT_TOLERANCE\s*=\s*\d+/.test(src)) findings.push(`(g) ${CHECK} still carries a hand-typed IN_FLIGHT_TOLERANCE literal — the ceiling must be read from ${RESUMER}`)
if (!/__account_inception/.test(src)) findings.push(`(b) ${CHECK} never reads discovery ops (resource '__account_inception') — the +1-per-cold-client drift stays`)
if (!read(RUNNER).includes(SELF)) findings.push(`(h) ${RUNNER} does not register ${SELF}`)

// ── DRIVEN: the pure core on five fire shapes ────────────────────────────────────────────────────────────
const mod = existsSync(resolve(ROOT, CHECK)) ? await import(pathToFileURL(resolve(ROOT, CHECK)).href) : null
const decide = mod?.decideFleetMeterVisibility
const pin = mod?.pinFleetWindow
if (typeof decide !== 'function') findings.push(`${CHECK} does not export decideFleetMeterVisibility`)
if (typeof pin !== 'function') findings.push(`${CHECK} does not export pinFleetWindow — the witness has no pinned window`)
if (typeof mod?.readPerFireCeiling === 'function') {
  const got = mod.readPerFireCeiling(ROOT)
  if (got !== CEILING) findings.push(`(f) readPerFireCeiling() = ${got}, independent parse of ${RESUMER} = ${CEILING}`)
} else findings.push(`(f) ${CHECK} does not export readPerFireCeiling — the ceiling is not imported`)

// A fixture is judged the way the LIVE read will judge it. When pinFleetWindow is absent (the pre-fix script) the
// rolling contract is emulated — that is what makes this guard red-first rather than vacuous.
const T0 = Date.parse('2026-09-14T00:00:00Z')
const iso = (ms) => new Date(ms).toISOString()
const fire = (endOffsetS, elapsedS, sel) => ({ fired_at: iso(T0 + endOffsetS * 1000), elapsed_ms: elapsedS * 1000, requests_selected: sel, dry_run: false })
const att = (offsetS, n) => ({ recorded_at: iso(T0 + offsetS * 1000), requests_spent: n })
function judge({ since, fires, attemptsAll, discovery }) {
  // attemptsAll: every attempt_started row in the DB with recorded_at/requests_spent (discovery rows included by caller)
  if (typeof pin === 'function' && typeof decide === 'function') {
    const w = pin({ fires, sinceIso: iso(since), attemptsAfterNewest: attemptsAll.filter((a) => Date.parse(a.recorded_at) > Date.parse(fires.reduce((m, f) => (f.fired_at > m ? f.fired_at : m), fires[0].fired_at))), discoveryOps: discovery })
    const meter = attemptsAll.filter((a) => Date.parse(a.recorded_at) >= Date.parse(w.fromIso)).reduce((s, a) => s + a.requests_spent, 0) - w.inFlight
    return decide({ selected: w.selected, meterBackfill: meter, attemptStarted: meter, windowLog: 0, fires: w.fires, ceiling: CEILING }).state
  }
  // pre-fix emulation: rolling window on both sides, tolerance 40
  const selected = fires.filter((f) => Date.parse(f.fired_at) >= since).reduce((s, f) => s + f.requests_selected, 0)
  const meter = attemptsAll.filter((a) => Date.parse(a.recorded_at) >= since).reduce((s, a) => s + a.requests_spent, 0)
  return typeof decide === 'function' ? decide({ selected, meterBackfill: meter, attemptStarted: meter, windowLog: 0, fires: fires.length }).state : 'NO-MODULE'
}
const since = T0 + 3600 * 1000 // the window opens at +1h
// ten healthy fires: start at +1h+5m·k, run 120 s, select 48, attempts 48 recorded 30 s after start
const healthy = []
const attemptsHealthy = []
for (let k = 0; k < 10; k++) { const start = since + 300 * 1000 * (k + 1); healthy.push({ fired_at: iso(start + 120000), elapsed_ms: 120000, requests_selected: 48, dry_run: false }); attemptsHealthy.push(att((start - T0) / 1000 + 30, 48)) }

// (a) a fire straddling the window edge: started 90 s BEFORE `since`, completed 30 s after — its attempts are before the edge
{
  const straddler = fire((since - T0) / 1000 + 30, 120, 48)
  const straddlerAttempts = att((since - T0) / 1000 - 60, 48)
  const s = judge({ since, fires: [straddler, ...healthy], attemptsAll: [straddlerAttempts, ...attemptsHealthy], discovery: [] })
  if (s !== 'VISIBLE') findings.push(`(a) a fire straddling the window edge reads ${s} — expected VISIBLE (drop the straddler, pin the window to the kept fires)`)
}
// (b) a discovery op inside the window (metered 1, in no fire's selection)
{
  const disc = { recorded_at: iso(since + 300 * 1000 * 3 + 40000), requests_spent: 1, resource: '__account_inception' }
  const s = judge({ since, fires: healthy, attemptsAll: [...attemptsHealthy, disc], discovery: [disc] })
  if (s !== 'VISIBLE') findings.push(`(b) a discovery op in-window reads ${s} — expected VISIBLE (the +1 the fire never selected must join the witness)`)
}
// (c) a read landing mid-fire: an 11th fire has written its attempts but no row yet
{
  const inflight = att((since - T0) / 1000 + 300 * 11 + 30, 48)
  const s = judge({ since, fires: healthy, attemptsAll: [...attemptsHealthy, inflight], discovery: [] })
  if (s !== 'VISIBLE') findings.push(`(c) a read landing mid-fire reads ${s} — expected VISIBLE (attempts newer than the newest fire row are the in-flight fire, subtract them)`)
}
// (d) the 2026-09-09 shape: the second slot omitted from the witness stays DRIFT
{
  const s = typeof decide === 'function' ? decide({ selected: 0, meterBackfill: 190, attemptStarted: 190, windowLog: 0, fires: 288, ceiling: CEILING }).state : 'NO-MODULE'
  if (s !== 'DRIFT') findings.push(`(d) the omitted-second-slot shape reads ${s} — expected DRIFT`)
}
// (e) a genuinely lost fire: selected, never metered — a full fire and a 2-request (sealed-account) fire
{
  const lostBig = judge({ since, fires: healthy, attemptsAll: attemptsHealthy.slice(0, 9), discovery: [] })
  if (lostBig !== 'DRIFT') findings.push(`(e) a lost 48-request fire reads ${lostBig} — expected DRIFT`)
  const sealed = { fired_at: iso(since + 300 * 1000 * 12 + 50000), elapsed_ms: 50000, requests_selected: 2, dry_run: false }
  const lostSmall = judge({ since, fires: [...healthy, sealed], attemptsAll: attemptsHealthy, discovery: [] })
  if (lostSmall !== 'DRIFT') findings.push(`(e′) a lost 2-request fire (Foam OH's sealed-account shape) reads ${lostSmall} — expected DRIFT (a blanket tolerance hides it)`)
}

if (findings.length) {
  console.error(`[fleet-meter-pinned-window] FAIL — ${findings.length} finding(s):`)
  for (const f of findings) console.error(`  - ${f}`)
  process.exit(1)
}
console.log(`[fleet-meter-pinned-window] PASS — the fleet-meter witness pins a closed fire interval (straddler dropped, in-flight subtracted), counts discovery ops, reads its per-fire ceiling (${CEILING}) from universe-resumer.ts, and demands drift === 0: straddler VISIBLE · discovery VISIBLE · mid-fire VISIBLE · omitted slot DRIFT · lost 48 DRIFT · lost 2 DRIFT; no tolerance literal; registered.`)
