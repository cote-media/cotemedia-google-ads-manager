#!/usr/bin/env node
// LORAMER_CHAT_IN_FLIGHT_SURVIVES_REMOUNT_V1 + LORAMER_LORA_BACK_LANDS_ON_THE_CLIENT_V1 — three properties.
//
// (a) IN-FLIGHT STATE SURVIVES A REMOUNT. `loading`, `streamStatus`, the fetch, the AbortController and
//     the recovery loop are ALL component state or closure state inside `send()`. A remount kills every
//     one of them, and the refresh triggers (visibilitychange · focus · once on mount) cannot help
//     because there is no timer, no poll and no subscription anywhere in the hook. The fact that a turn
//     is in flight must therefore live somewhere that outlives the mount, be WRITTEN before the first
//     await, and be CLEARED when the turn ends.
// (b) IN-FLIGHT STATE IS CLIENT-SCOPED. A turn in flight for client A must never light the working
//     indicator on client B's thread — the same data-attribution law `mergeThreadForClient` enforces one
//     layer down. This also forces sessionStorage over localStorage: localStorage is shared across every
//     tab of the origin, so it cannot be scoped to "this document had a turn in flight".
// (c) THE BACK FALLBACK DOES NOT TARGET A ROUTE THAT DISCARDS CLIENT IDENTITY.
//     `/dashboard-next/clients` is the PORTFOLIO surface — its component takes no props and its
//     client-less posture is enforced by shell-client-context.guard.mjs. Sending a client-scoped
//     fallback there loses the client by construction, however the query string is decorated.
//
// ⛔ WHAT THIS GUARD CANNOT DO: it cannot prove the resumed poll actually finds the answer on a real
// device, and it cannot prove the indicator reappears. Those are live observations — Gate-B. This proves
// the state has a home that outlives the mount, that the home refuses another client's record, and that
// the back button no longer aims at a client-less page.
import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const ROOT = process.env.LORAMER_GUARD_ROOT || process.cwd()
const findings = []
const check = (c, m) => { if (!c) findings.push(m) }
const read = (p) => { try { return readFileSync(resolve(ROOT, p), 'utf8') } catch { return '' } }
// QUOTATION IS NOT ASSERTION — these files quote the OLD broken destination and the old state names in
// their own comments, so a match on raw text would read a history lesson as the current code.
const isCode = (l) => { const t = l.trim(); return t && !t.startsWith('//') && !t.startsWith('*') && !t.startsWith('/*') }
const codeOf = (src) => src.split('\n').map((l, i) => ({ n: i + 1, l })).filter(({ l }) => isCode(l))

const HOOK = 'src/lib/next/use-lora-chat.ts'
const STORE = 'src/lib/next/in-flight-turn.ts'
const PAGE = 'src/app/dashboard-next/lora/LoraPageClient.tsx'

for (const f of [HOOK, STORE, PAGE]) {
  if (!existsSync(resolve(ROOT, f))) {
    console.error(`[chat-in-flight-and-back] FAIL — ${f} is missing.`)
    process.exit(1)
  }
}

const hook = codeOf(read(HOOK))
const store = codeOf(read(STORE))
const page = codeOf(read(PAGE))

// ── (a) IN-FLIGHT STATE SURVIVES A REMOUNT ──────────────────────────────────────────────────────────
{
  check(
    store.some(({ l }) => /sessionStorage\.setItem\(/.test(l)),
    '(a) The in-flight record is never persisted — component state dies with the mount, which IS the defect.',
  )
  check(
    store.some(({ l }) => /sessionStorage\.getItem\(/.test(l)),
    '(a) The in-flight record is never read back.',
  )

  // Written by send(), and BEFORE the first await — a page that dies mid-turn must already have left the note.
  const markIdx = hook.findIndex(({ l }) => /markTurnInFlight\(/.test(l))
  check(markIdx !== -1, '(a) send() never records the turn as in flight.')
  if (markIdx !== -1) {
    const before = hook.slice(Math.max(0, markIdx - 30), markIdx).map(({ l }) => l).join('\n')
    check(
      !/\bawait\b/.test(before) || /setLoading\(true\)/.test(before),
      `(a) markTurnInFlight at ${HOOK}:${hook[markIdx].n} appears to sit after an await in send() — ` +
        'the record must be written before anything can fail, or a page that dies early leaves no note.',
    )
  }

  // Cleared when the turn ends. Both the live path (send's finally) and the resumed path must clear it,
  // or the NEXT mount resumes a turn that is already over — the defect, inverted.
  const clears = hook.filter(({ l }) => /clearTurnInFlight\(/.test(l))
  check(
    clears.length >= 2,
    `(a) clearTurnInFlight appears ${clears.length}×; expected at least 2 (send()'s finally AND the ` +
      'resumed poll\'s exit). A record that outlives its turn lights the indicator forever.',
  )

  // The resume path exists, reuses the recovery discriminator, and is bounded.
  check(
    hook.some(({ l }) => /readTurnInFlight\(/.test(l)),
    '(a) Nothing reads the in-flight record on mount — the state survives but nobody resumes it.',
  )
  check(
    hook.some(({ l }) => /remainingWindowMs\(/.test(l)),
    '(a) The resumed poll is not bounded by the turn\'s remaining window — it would spin past the ' +
      'server\'s own maxDuration against an answer that is never coming.',
  )
  check(
    store.some(({ l }) => /RECOVERY_WINDOW_MS/.test(l)),
    '(a) The store does not bound records by RECOVERY_WINDOW_MS — a stale record would resume forever.',
  )
  // REUSE, not a second mechanism. A second discriminator drifts from the first.
  check(
    hook.some(({ l }) => /pickRecoveredAnswer\(/.test(l) && !/got\s*=\s*pickRecoveredAnswer\(Array/.test(l)) &&
      hook.filter(({ l }) => /pickRecoveredAnswer\(/.test(l)).length >= 2,
    '(a) The resumed poll does not reuse pickRecoveredAnswer — a second discriminator will drift from ' +
      'the recovery path\'s.',
  )
}

// ── (b) IN-FLIGHT STATE IS CLIENT-SCOPED ────────────────────────────────────────────────────────────
{
  // localStorage is shared across tabs; it cannot express "this document had a turn in flight".
  const local = store.filter(({ l }) => /localStorage\./.test(l))
  check(
    local.length === 0,
    `(b) localStorage used at ${local.map(({ n }) => `${STORE}:${n}`).join(', ')} — it is shared across ` +
      'every tab of the origin, so a turn for client A in one tab would show as working on client B in another.',
  )
  // The read must REFUSE a record belonging to another client. Asserted on the comparison, not on wording.
  check(
    store.some(({ l }) => /t\.clientId\s*!==\s*clientId/.test(l)) &&
      store.some(({ l }) => /return null/.test(l)),
    '(b) readTurnInFlight does not refuse a record whose clientId differs — the working indicator would ' +
      'cross clients, which is the failure mergeThreadForClient exists to prevent.',
  )
  // The record must actually carry the client.
  check(
    store.some(({ l }) => /clientId:\s*string/.test(l)),
    '(b) The in-flight record has no clientId field — it cannot be scoped at all.',
  )
  // And the hook must pass the CURRENT client to the read, not read unconditionally.
  check(
    hook.some(({ l }) => /readTurnInFlight\(\s*cid\b/.test(l)),
    '(b) readTurnInFlight is not called with the current client id.',
  )
}

// ── (c) THE BACK FALLBACK KEEPS THE CLIENT ──────────────────────────────────────────────────────────
{
  const fb = page.filter(({ l }) => /const fallback\s*=/.test(l))
  check(fb.length > 0, '(c) The back fallback is gone — cannot prove where it points.')
  for (const { n, l } of fb) {
    // The client-scoped branch must not aim at the portfolio index, which discards clientId by design.
    check(
      !/clientId\s*\?\s*[`'"]\/dashboard-next\/clients\?clientId=/.test(l),
      `(c) ${PAGE}:${n} — the client-scoped fallback targets /dashboard-next/clients, whose component ` +
        'takes no props and is guard-allowlisted as CLIENT-LESS. The client is discarded on arrival.',
    )
    check(
      /clientId\s*\?\s*[`'"]\/dashboard-next\?clientId=/.test(l),
      `(c) ${PAGE}:${n} — the client-scoped fallback does not target /dashboard-next?clientId=, the ` +
        'Overview route that actually resolves it through resolveShellClient.',
    )
  }
}

console.log(`[chat-in-flight-and-back] scanned ${hook.length} hook · ${store.length} store · ${page.length} page code lines`)
if (findings.length) {
  console.error(`[chat-in-flight-and-back] FAIL — ${findings.length} finding(s):`)
  for (const f of findings) console.error(`  · ${f}`)
  process.exit(1)
}
console.log('[chat-in-flight-and-back] PASS')
