#!/usr/bin/env node
// LORAMER_QUOTA_ARM_AT_ERROR_BOUNDARY_V1 — GUARD. ONE WRITER, THREE READERS IS A BUG SHAPE, NOT AN ARCHITECTURE.
//
// MEASURED 2026-07-31: `writeGoogleQuotaPause` had EXACTLY ONE caller (cron/drain/route.ts) while FOUR modules
// read the sentinel. The developer-scope token was exhausted at ~11:59Z by catchup — 13,869 of the fleet's
// 15,075 raw requests — and the sentinel still read NOT BLOCKED twelve hours later, because the only lane that
// could arm it was the only lane that made no Google calls that day (the op budget declined the drain 180
// times before it reached the API). Capture lanes believed they were clear; the live path fired ~20 GAQL
// queries per dashboard load into a token Google was refusing; and Lora reported the resulting empty Google
// data as an ABSENCE, with no outage line, because the note was attached only when the sentinel already said
// paused. That last one is ESSENCE law 6 reached through the one code path built to prevent it.
//
// TWO LEGS:
//  (a) READ IMPLIES WRITE, OR AN EXPLICIT READ-ONLY REASON. Any module importing readGoogleQuotaPause must
//      either also arm the sentinel (noteGoogleQuotaError / writeGoogleQuotaPause) or appear in READ_ONLY below
//      WITH a stated reason. The allowlist is the point: it forces the next person to say why a reader cannot
//      observe the event, instead of the asymmetry going unnoticed for months.
//  (b) EVERY GOOGLE ERROR BOUNDARY ARMS. The four wrappers that observe a Google rejection must call
//      noteGoogleQuotaError, and the SWALLOW POINT must additionally MARK the entry so a caller can tell an
//      outage from an absence. A boundary that returns [] on a quota error without marking it is the exact
//      mechanism that turned an outage into a zero.
//
// ⛔ WHAT THIS DOES NOT DO: it does not prove the sentinel is armed at RUNTIME, and it cannot — that needs a
// live quota error. It proves the WIRING exists at every boundary we know of. A new Google call site that
// invents a fifth wrapper is NOT caught; leg (b) lists the boundaries by name, and that list is maintained by
// hand. Named as a limit rather than sold as total coverage.

import { readFileSync, existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { execSync } from 'node:child_process'

const ROOT = process.env.LORAMER_GUARD_ROOT || process.cwd()
const findings = []
const read = (p) => { try { return readFileSync(resolve(ROOT, p), 'utf8') } catch { return '' } }
// Comments are not code. QUOTATION IS NOT ASSERTION — banked three times, once INSIDE the guard written to
// catch it, so every check below runs against comment-stripped source.
const code = (p) => read(p).split('\n').filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n')

// ── (a) READ IMPLIES WRITE ─────────────────────────────────────────────────────────────────────────────
const READ_ONLY = {
  'src/app/api/intelligence/route.ts':
    'THE ANSWER PATH. It reads the sentinel to caveat the prompt and now also builds the caveat from an observed ' +
    'refusal, but it never issues a Google call itself — the arming happens one level down, in google-intelligence ' +
    'safeQuery/withGaqlRetry, which this route calls. Adding a write here would duplicate that.',
  'src/app/api/cron/catchup/route.ts':
    'GATES on the sentinel before spending, and its Google work goes through fetchGoogleIntelligence / ' +
    'fetchGoogleDimensional, both of which arm at their own error boundary. A write here would be a second home ' +
    'for a rule that now lives at the boundary — precisely the duplication RULE-HOME LAW warns about.',
  // ── ADDED 2026-08-09, LORAMER_V2_QUOTA_SENTINEL_WIRED_V1 — the two v2 walk entry points. ──
  'src/app/api/queues/google-ads-universe-v2/route.ts':
    'GATES on the sentinel before any vendor work (and before the ADVANCE publish, since publishing into an ' +
    'armed quota spends the fleet\'s tomorrow). Its only Google contact is universe-vendor-stream.ts, which IS ' +
    'boundary 5 below and arms there. A write here would be a second home for a rule that now lives at the ' +
    'boundary — the duplication RULE-HOME LAW warns about, and the reason the arm moved to boundaries at all.',
  'src/app/api/cron/universe-resume/route.ts':
    'THE SCHEDULER, AND IT STRUCTURALLY CANNOT OBSERVE A QUOTA ERROR: it publishes, it never fetches. It ' +
    'constructs the adapter with a stream factory that THROWS if anyone calls it ("the resumer never fetches — ' +
    'it publishes"), and googleAdsStreamFor is not imported at all. It reads the sentinel because everything it ' +
    'publishes becomes a vendor call later; there is no Google rejection here for it to arm from.',
}

const readers = []
{
  let out = ''
  try {
    out = execSync(`grep -rl "readGoogleQuotaPause" "${resolve(ROOT, 'src')}" --include=*.ts || true`, { encoding: 'utf8' })
  } catch { out = '' }
  for (const abs of out.split('\n').map((s) => s.trim()).filter(Boolean)) {
    const rel = abs.replace(resolve(ROOT) + '/', '')
    const src = code(rel)
    if (!/import[^\n]*readGoogleQuotaPause/.test(src)) continue // a mention in prose is not a dependency
    readers.push(rel)
    if (rel === 'src/lib/backfill/google-quota-store.ts') continue // the module that DEFINES both
    const writes = /noteGoogleQuotaError|writeGoogleQuotaPause/.test(src)
    if (writes) continue
    // ⛔ `rel in READ_ONLY`, NOT `READ_ONLY[rel]` — truthiness makes the empty-reason check below UNREACHABLE,
    // because '' is falsy and falls through to the unallowlisted branch instead. Caught by mutation-proving the
    // guard's own legs: the mutation went red, but on the WRONG message, which is how a dead check hides.
    if (rel in READ_ONLY) {
      if (!String(READ_ONLY[rel] ?? '').trim()) {
        findings.push(`(a) ${rel} is allowlisted read-only with an EMPTY reason. The reason IS the allowlist's value — an entry without one is just a silenced finding.`)
      }
      continue
    }
    findings.push(
      `(a) ${rel} READS the google quota sentinel but can never ARM it, and is not allowlisted. This is the exact ` +
      `asymmetry that left the sentinel reading NOT BLOCKED for ~16 hours on 2026-07-31 while the token was ` +
      `exhausted. Either call noteGoogleQuotaError where it observes a Google error, or add it to READ_ONLY in ` +
      `this guard WITH a reason saying why it cannot observe one.`)
  }
}
if (readers.length === 0) {
  findings.push('(a) OWNER-READ FAILED: found ZERO importers of readGoogleQuotaPause. A guard that silently passes because it read nothing is worse than no guard.')
}

// ── (b) EVERY ERROR BOUNDARY ARMS ──────────────────────────────────────────────────────────────────────
// The FIVE boundaries, by name and by the lane each one covers. If a sixth appears this list must grow — see
// the honest limit in the header.
// ⛔ IT WAS FOUR UNTIL 2026-08-09, AND THE FIFTH IS THE ONE THIS GUARD SAID IT COULD NOT CATCH. The header's
// own limit reads: "A new Google call site that invents a fifth wrapper is NOT caught; leg (b) lists the
// boundaries by name, and that list is maintained by hand." The universe walk was exactly that — a bare
// `customer.queryStream(gaql)` in `universe-vendor-stream.ts` with no wrapper and no arm — and it was found by
// the 2026-08-09 sweep (★WALK-DOES-NOT-READ-OR-ARM-THE-QUOTA-SENTINEL), by a human read, not by this guard.
// ⛔ THE COUNT STAYS EXACT. It is NOT loosened to "at least N": the whole value of this leg is that the number
// of places a quota refusal can be observed is KNOWN. A guard that stops counting stops being the thing that
// makes a sixth wrapper visible.
const BOUNDARIES = [
  ['src/lib/google-retry.ts', 'withGaqlRetry', 'the LIVE dashboard path and the FORWARD capture path'],
  ['src/lib/backfill/gaql-with-retry.ts', 'gaqlWithRetry', 'the campaign + adgroup backfill writers'],
  ['src/lib/backfill/retry.ts', 'withGoogleRetry', 'the account adapter and the dimensional backfill'],
  ['src/lib/intelligence/google-intelligence.ts', 'safeQuery', 'the 20 live sub-queries — the swallow point'],
  // ⛔ THE FIFTH. It wraps CONSUMPTION rather than the call, because `queryStream` returns an AsyncGenerator and
  // the vendor library rejects from the ITERATOR (its handleStreamError converts the streamed error object to a
  // GoogleAdsFailure) — an arm around the call would never fire.
  ['src/lib/backfill/universe-vendor-stream.ts', 'armingStream', 'the v2 universe walk — the only place it touches Google'],
]
if (BOUNDARIES.length !== 5) {
  findings.push(`(b) THE BOUNDARY COUNT MOVED: this leg is written against FIVE known Google error boundaries and now holds ${BOUNDARIES.length}. Growing the list is correct when a real sixth boundary appears — update this assertion IN THE SAME COMMIT and say which one, so the count never drifts silently.`)
}
for (const [file, fn, lane] of BOUNDARIES) {
  if (!existsSync(resolve(ROOT, file))) { findings.push(`(b) ${file} is missing — cannot verify the ${fn} boundary.`); continue }
  const src = code(file)
  if (!new RegExp(`${fn}\\b`).test(src)) { findings.push(`(b) ${file} no longer defines ${fn} — the boundary list is stale.`); continue }
  if (!/noteGoogleQuotaError/.test(src)) {
    findings.push(
      `(b) ${file} (${fn}) observes Google rejections for ${lane} but does NOT call noteGoogleQuotaError. ` +
      `A quota error seen here would be lost, and every lane downstream keeps firing into an exhausted token.`)
  }
}

// ── (b2) THE SWALLOW POINT MUST MARK, NOT JUST ARM ─────────────────────────────────────────────────────
// Arming alone is not enough: safeQuery returns [] either way, so without a marked entry the CALLER still
// cannot separate "Google refused" from "Google reported no rows". That distinction is the whole finding.
{
  const gi = code('src/lib/intelligence/google-intelligence.ts')
  const marks = /fetchErrors\.push\([^)]*quota/s.test(gi) || /quota:\s*true/.test(gi)
  if (!marks) {
    findings.push(
      '(b2) google-intelligence safeQuery arms the sentinel but does NOT mark the fetchErrors entry as a quota ' +
      'failure. It returns [] on both a refusal and a true zero, so the caller cannot tell an OUTAGE from an ' +
      'ABSENCE — which is how Lora came to report "no Google data" during a live outage.')
  }
  const route = code('src/app/api/intelligence/route.ts')
  if (!/fetchErrors[\s\S]{0,120}quota/.test(route) || !/googleQuota\s*=/.test(route)) {
    findings.push(
      '(b2) /api/intelligence does not build the outage caveat from an OBSERVED refusal. Attaching it only when ' +
      'the sentinel already reads paused is what produced a SILENT prompt on 2026-07-31: sentinel clear, token ' +
      'exhausted, Lora reporting an outage as an absence.')
  }
}

if (findings.length) {
  console.error(`[quota-sentinel-armed] FAIL — ${findings.length} finding(s):`)
  for (const f of findings) console.error(`  · ${f}`)
  process.exit(1)
}
console.log(`[quota-sentinel-armed] PASS — ${readers.length} sentinel reader(s) either arm it or are allowlisted with a reason; all ${BOUNDARIES.length} Google error boundaries call noteGoogleQuotaError; the swallow point marks quota failures and the answer path builds its caveat from an observed refusal.`)
