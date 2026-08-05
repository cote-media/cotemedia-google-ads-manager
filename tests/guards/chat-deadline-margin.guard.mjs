#!/usr/bin/env node
// LORAMER_CHAT_DEADLINE_GAP_CLOSED_V1 — THE TWO CHAT DEADLINES ONLY MEAN ANYTHING RELATIVE TO EACH OTHER.
//
// ⛔ WHAT THIS PROTECTS. `/api/chat` carries a server `maxDuration`; the browser carries its own absolute
// `CHAT_TOTAL_MS`. They live in DIFFERENT FILES, on different sides of the wire, and nothing has ever
// compared them. On 2026-08-05 the pair was 300s server / 240s client and a turn that took 281s —
// COMPLETED, PERSISTED, AND PAID FOR IN FULL (66,617 input + 32,523 cache-create + 65,046 cache-read +
// 9,547 output tokens) — was thrown away by the client with 19s of server budget still unused. That
// 60-second band was not a safety margin; it was a band in which a SUCCESSFUL turn is guaranteed to
// look like a failure.
//
// ⛔ TWO INVARIANTS, AND THEY PULL IN OPPOSITE DIRECTIONS, WHICH IS WHY BOTH ARE GUARDED:
//   (a) THE CLIENT MUST DIE FIRST. If the client outlives the server it sits waiting on a lambda that
//       is already dead — and worse, the recovery poll has nothing to recover INTO, because the server
//       never reached the code that writes the answer the poll goes looking for.
//   (b) NEITHER MAY DRIFT BACK UNDER A SEVEN-MINUTE TURN. LORAMER_NARRATED_LENGTH_BEATS_SILENT_SPEED_V1
//       (Russ): a long turn is fine, and good, provided the screen narrates the work. A future "let's
//       tighten this back up" is exactly how the gap comes back, and it would come back silently.
//
// The values are READ FROM THE REAL SOURCE, never restated here — a guard carrying its own copy of a
// constant goes green on a drift that updated the guard and one call site.
import { readFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = process.env.LORAMER_GUARD_ROOT || resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const read = (p) => { try { return readFileSync(resolve(ROOT, p), 'utf8') } catch { return '' } }
const findings = []

const READER = 'src/lib/chat-stream-read.ts'
const ROUTE = 'src/app/api/chat/route.ts'
// A seven-minute turn must survive end to end. 281s and 294s were both MEASURED on 2026-08-05; the
// floor is set above them with room, not at them.
const MIN_TURN_S = 420

// ⛔ COMMENTS ARE STRIPPED BEFORE MATCHING. Both files now carry PROSE containing the old numbers (300,
// 240) as the record of what changed — QUOTATION IS NOT ASSERTION, and a guard that read the history
// as the value would report the defect it exists to prevent.
const strip = (s) => s.split('\n').filter((l) => !l.trim().startsWith('//')).join('\n')

const readerSrc = strip(read(READER))
const routeSrc = strip(read(ROUTE))

const num = (s) => Number(String(s).replace(/_/g, ''))
const clientM = /export const CHAT_TOTAL_MS\s*=\s*([\d_]+)/.exec(readerSrc)
const idleM = /export const CHAT_IDLE_GAP_MS\s*=\s*([\d_]+)/.exec(readerSrc)
const routeM = /export const maxDuration\s*=\s*(\d+)/.exec(routeSrc)

if (!clientM) findings.push(`${READER}: CHAT_TOTAL_MS is gone or no longer a literal — the client's absolute ceiling cannot be compared to the server's, so the invariant that keeps recovery working is unverifiable.`)
if (!routeM) findings.push(`${ROUTE}: maxDuration is gone or no longer a literal — same problem from the other side.`)
if (!idleM) findings.push(`${READER}: CHAT_IDLE_GAP_MS is gone or no longer a literal. It is the timer that still catches a genuinely dead socket fast now that the total is generous.`)

if (clientM && routeM && idleM) {
  const clientS = num(clientM[1]) / 1000
  const idleS = num(idleM[1]) / 1000
  const routeS = num(routeM[1])

  // ── (a) THE CLIENT MUST DIE FIRST ───────────────────────────────────────────────────────────────
  if (clientS >= routeS) {
    findings.push(`(a) THE CLIENT OUTLIVES THE SERVER: CHAT_TOTAL_MS is ${clientS}s and the route's maxDuration is ${routeS}s. The client must abort STRICTLY FIRST. If the server dies first the browser waits on a dead lambda, and the recovery poll has nothing to recover into — the server never reached the code that persists the answer the poll looks for.`)
  } else if (routeS - clientS < 30) {
    findings.push(`(a) THE MARGIN IS ${routeS - clientS}s. It must be at least 30s: the recovery poll needs a window in which the server is still alive and finishing the answer AFTER the client has given up. That window IS the margin — shrink it to nothing and recovery becomes decoration.`)
  }

  // ── (b) NEITHER MAY DRIFT BACK UNDER A SEVEN-MINUTE TURN ────────────────────────────────────────
  if (clientS < MIN_TURN_S) {
    findings.push(`(b) CHAT_TOTAL_MS is ${clientS}s, under the ${MIN_TURN_S}s floor. Measured 2026-08-05: real turns ran 281s and 294s and were DISCARDED by a 240s ceiling after being paid for in full. LORAMER_NARRATED_LENGTH_BEATS_SILENT_SPEED_V1 (Russ) — a long turn is fine provided the screen narrates it; silence is the defect, not length.`)
  }
  if (routeS < MIN_TURN_S) {
    findings.push(`(b) maxDuration is ${routeS}s, under the ${MIN_TURN_S}s floor — the server would become the limiter again and the client ceiling could not be raised above it without breaking invariant (a).`)
  }

  // ── (c) THE IDLE TIMER MUST STILL BE THE FAST FAILURE PATH ──────────────────────────────────────
  // Raising the total must NOT slow down detection of a genuinely dead socket. With streaming on every
  // frame re-arms the idle timer, so it — not the total — is what catches a dropped connection.
  if (idleS >= clientS) {
    findings.push(`(c) CHAT_IDLE_GAP_MS (${idleS}s) is not below CHAT_TOTAL_MS (${clientS}s), so the idle timer can never fire before the absolute deadline and a dead socket is only caught at the total. Raising the total must not slow failure detection — that is the whole reason the idle timer exists.`)
  }
}

if (findings.length) {
  console.error(`[chat-deadline-margin] FAIL — ${findings.length} finding(s):`)
  for (const f of findings) console.error(`  · ${f}`)
  process.exit(1)
}
const c = num(clientM[1]) / 1000, r = num(routeM[1]), i = num(idleM[1]) / 1000
console.log(`[chat-deadline-margin] PASS — client ${c}s < route ${r}s (margin ${r - c}s), both above the ${MIN_TURN_S}s turn floor, idle ${i}s still the fast failure path. LORAMER_CHAT_DEADLINE_GAP_CLOSED_V1`)
