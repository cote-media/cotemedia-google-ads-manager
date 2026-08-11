#!/usr/bin/env node
// LORAMER_CHAT_COST_AND_RECOVERY_V1 — guard the three properties this flight bought.
//
// (a) NO MINUTE-OR-FINER TIMESTAMP IN THE CACHED PREFIX. Prompt caching is a PREFIX MATCH — one byte before
//     the breakpoint invalidates everything after it. `buildSourceParityLines` renders liveAsOf.slice(0,16)
//     (minute resolution) and it sat in the cache_control block, so every /api/intelligence miss minted a new
//     minute string and shattered the whole cached prefix. The check is positional: anything that reaches
//     `lines` while `lines` is still `prefixLines` may not carry a volatile timestamp.
// (b) RECOVERY_WINDOW_MS >= OBSERVED p90. 90_000 was sized for a turn shape a tenth of real turns exceed by
//     3.1× (measured 2026-08-06: p50 87s · p90 281s · max 365s over 22 paired turns). The floor asserted here
//     is p90; the shipped value clears the SERVER ceiling (maxDuration 500) because that is the real bound on
//     when a late answer can still land.
// (c) /api/chat HAS PHASE TIMING. It had ZERO Date.now() calls across 377 lines, which is why
//     ★CHAT-PROMPT-ASSEMBLY-DOUBLE-FETCH says in its own text that "any split anyone quotes is invented."
//
// ⛔ WHAT THIS GUARD CANNOT DO, STATED SO A GREEN RUN IS NOT OVER-READ: it cannot prove the cache actually
// HITS. That is a property of Anthropic's servers observed through `usage.cache_read_input_tokens` on a live
// turn — a runtime measurement, not a static one. This proves the KNOWN INVALIDATOR is gone from the prefix
// and that the instrument to measure the rest now exists. The measurement itself is Gate-B.
import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const ROOT = process.env.LORAMER_GUARD_ROOT || process.cwd()
const findings = []
const check = (c, m) => { if (!c) findings.push(m) }
const read = (p) => { try { return readFileSync(resolve(ROOT, p), 'utf8') } catch { return '' } }
// QUOTATION IS NOT ASSERTION — banked three times here, and it has turned a real RED into a false green.
const isCode = (l) => { const t = l.trim(); return t && !t.startsWith('//') && !t.startsWith('*') && !t.startsWith('/*') }

const CTX = 'src/lib/intelligence/build-claude-context.ts'
const ROUTE = 'src/app/api/chat/route.ts'
const REC = 'src/lib/next/chat-recovery.ts'

for (const f of [CTX, ROUTE, REC]) {
  if (!existsSync(resolve(ROOT, f))) { console.error(`[chat-cache-and-recovery] FAIL — ${f} is missing.`); process.exit(1) }
}

// ── (a) NO VOLATILE TIMESTAMP IN THE CACHED PREFIX ─────────────────────────────────────────────────
{
  const lines = read(CTX).split('\n')
  const swap = lines.findIndex((l) => l.includes('lines = suffixLines') && isCode(l))
  // ⛔ SCOPE THE SCAN TO THE CACHEABLE BUILDER'S OWN BODY, AND THE REASON IS A REAL FIRST-RUN FINDING RATHER
  // THAN A CONVENIENCE. `buildGaSection` and `buildPlatformSection` are SHARED with `buildClaudeContext`, the
  // flat non-cached builder, and each contains `if (parity) lines.push(...buildSourceParityLines(...))`. Those
  // lines are positionally "before the swap" but belong to a function with no prefix/suffix at all — flagging
  // them fails the correct implementation. What actually matters is (i) the cacheable builder's own body, and
  // (ii) that it passes `undefined` for parity so the shared branch is unreachable from the cached path. Both
  // are asserted; the second is what a future edit would break.
  const bodyStart = lines.findIndex((l) => /export function buildClaudeContextCacheable/.test(l))
  check(bodyStart > 0, `(a) could not locate buildClaudeContextCacheable in ${CTX}.`)
  check(swap > 0, `(a) could not locate the \`lines = suffixLines\` swap in ${CTX} — the prefix/suffix boundary is what this leg measures, so without it the guard proves nothing.`)
  if (swap > 0 && bodyStart > 0) {
    const cacheableBody = lines.slice(bodyStart, swap).join('\n')
    check(/buildPlatformSection\([^)]*'Google'[^)]*limits, undefined/.test(cacheableBody),
      `(a) the cacheable builder passes a parity object to buildPlatformSection for Google. That reaches the shared \`if (parity)\` branch, which renders the minute-resolution as-of straight into the CACHED PREFIX.`)
    check(/buildPlatformSection\([^)]*'Meta'[^)]*limits, undefined/.test(cacheableBody),
      `(a) the cacheable builder passes a parity object to buildPlatformSection for Meta — same prefix invalidation as Google.`)
    check(/buildGaSection\([^)]*limits, undefined\)/.test(cacheableBody),
      `(a) the cacheable builder passes a parity object to buildGaSection — same prefix invalidation.`)
    // Only pushes into `lines` matter. A push into a COLLECTOR array (parityBlock) is emitted later, in the
    // suffix, and is exactly the fix — counting it as a finding would fail the correct implementation.
    const offenders = []
    for (let i = bodyStart; i < swap; i++) {
      const l = lines[i]
      if (!isCode(l)) continue
      if (!/\blines\.push\(/.test(l)) continue
      if (/liveAsOf|fetchedAt|buildSourceParityLines/.test(l)) offenders.push(`${CTX}:${i + 1}`)
    }
    check(offenders.length === 0,
      `(a) a volatile as-of value is pushed into the CACHED PREFIX at ${offenders.join(', ')}. buildSourceParityLines renders liveAsOf at MINUTE resolution; in the prefix that invalidates the entire cached block on every /api/intelligence cache miss (15-min TTL) against a cache that must survive far longer.`)
    // The positive half: it must actually still be emitted somewhere, or the fix deleted the honesty rule.
    const after = lines.slice(swap).join('\n')
    check(/parityBlock/.test(after),
      `(a) the parity block is not emitted in the SUFFIX. Moving the as-of out of the prefix must RELOCATE it, never remove it — Lora's source-parity rule depends on stating the live basis.`)
  }
  check(/buildSourceParityLines/.test(read(CTX)),
    `(a) buildSourceParityLines is no longer called at all — the live/captured as-of disclosure is gone, which is a prompt-honesty regression, not a caching win.`)
}

// ── (b) RECOVERY WINDOW CLEARS THE MEASURED p90 ────────────────────────────────────────────────────
{
  const OBSERVED_P90_MS = 281_000   // measured 2026-08-06, 22 paired user→assistant turns
  const OBSERVED_MAX_MS = 365_000
  const rec = read(REC)
  const m = rec.match(/RECOVERY_WINDOW_MS\s*=\s*([0-9_]+)/)
  check(!!m, `(b) RECOVERY_WINDOW_MS not found in ${REC}.`)
  if (m) {
    const v = Number(m[1].replace(/_/g, ''))
    check(v >= OBSERVED_P90_MS,
      `(b) RECOVERY_WINDOW_MS is ${v}ms, below the measured p90 turn duration of ${OBSERVED_P90_MS}ms — a tenth of real turns finish after the poll gives up, and the recovered answer is never found. (Observed max ${OBSERVED_MAX_MS}ms.)`)
    // The server can still be writing until maxDuration; the window must cover that, not the client deadline.
    const maxDur = Number((read(ROUTE).match(/export const maxDuration\s*=\s*(\d+)/) || [])[1] || 0)
    check(maxDur > 0 && v >= maxDur * 1000,
      `(b) RECOVERY_WINDOW_MS (${v}ms) is below /api/chat's maxDuration (${maxDur}s = ${maxDur * 1000}ms). The poll runs AFTER the client gave up and exists to catch an answer the SERVER is still writing, so the server ceiling is the bound — not the client's own deadline.`)
  }
}

// ── (c) PHASE TIMING EXISTS IN /api/chat ───────────────────────────────────────────────────────────
{
  const route = read(ROUTE)
  const code = route.split('\n').filter(isCode).join('\n')
  check(/Date\.now\(\)/.test(code),
    `(c) ${ROUTE} contains no Date.now() call. With zero timing, every latency question about prompt assembly is unanswerable and any split quoted for it is invented (★CHAT-PROMPT-ASSEMBLY-DOUBLE-FETCH).`)
  // ⛔ RE-POINTED 2026-08-11 (LORAMER_CHAT_FIRST_FRAME_V1) — 'fetch2' LEFT THE LIST BECAUSE THE QUESTION IT
  // TIMED IS ANSWERED. This leg required a phase marker for the SECOND intelligence fetch because the double
  // fetch was "the open question this instrument exists to answer". The dedup closed it: ONE fetch feeds both
  // builders, so a fetch2 marker cannot exist — and requiring it would fail the build for the fix.
  // Lesson 68 shape (a), an assertion encoding a superseded model, repaired at the moment the model changed
  // rather than discovered later. The inverse is now pinned: fetch2 REAPPEARING means the dedup regressed.
  for (const p of ['session', 'fetch1', 'build1', 'build2', 'model']) {
    check(new RegExp(`phase\\('${p}'\\)`).test(code),
      `(c) no phase marker for '${p}'. Every stage of assembly must be timed separately — a single total cannot attribute a latency question.`)
  }
  check(!/phase\('fetch2'\)/.test(code),
    `(c) a phase marker for 'fetch2' is BACK — the second intelligence fetch was deduped on 2026-08-11 (one response feeds both prompt builders, LORAMER_CHAT_FIRST_FRAME_V1); its reappearance means the route is paying the double fetch again.`)
  check(/\[chat\] phases/.test(code), `(c) the phase log line is missing or not greppable on the '[chat] phases' marker.`)
  check(/first_frame_ms/.test(code), `(c) time-to-first-frame is not recorded.`)
  check(/durationMs:/.test(code), `(c) durationMs is not passed to logSpend — the duration would live only in a Vercel log line that expires in an hour, which is the exact gap this flight exists to close.`)
  // ⛔ NO CLIENT DATA ON THE LOG LINE. A client id PREFIX is fine; the name, the question and the email are not.
  const line = (code.match(/console\.log\('\[chat\] phases'[\s\S]{0,600}?\)\)/g) || []).join('\n')
  check(line.length > 0, `(c) could not locate the phases log line to inspect it for leaked client data.`)
  for (const leak of ['clientName', 'message', 'session.user.email']) {
    check(!new RegExp(leak).test(line),
      `(c) the phases log line carries '${leak}'. Diagnostics may carry durations, token counts and an id PREFIX — never a client name, a question, or an email.`)
  }
  check(/slice\(0, 8\)/.test(line), `(c) the phases line does not truncate the client id to a prefix.`)
}

// ── (d) THE 1-HOUR TTL IS DECLARED ─────────────────────────────────────────────────────────────────
{
  const code = read(ROUTE).split('\n').filter(isCode).join('\n')
  check(/cache_control:\s*\{\s*type:\s*'ephemeral',\s*ttl:\s*'1h'\s*\}/.test(code),
    `(d) the system prefix is not cached at the 1-hour TTL. With the 5-minute default a p90 turn (281s) plus any read-and-reply gap expires the cache before the conversation's SECOND turn — the turn caching exists to serve.`)
}

// ── (e) THE SPEND LOG PERSISTS WHAT THE LOG LINE WOULD OTHERWISE LOSE ──────────────────────────────
{
  const logger = read('src/lib/spend-logger.ts')
  for (const col of ['duration_ms', 'cache_read_tokens', 'cache_creation_tokens']) {
    check(new RegExp(col).test(logger), `(e) spend-logger does not persist ${col} (migration 058) — the figure survives only in a Vercel log line that expires in one hour.`)
  }
  check(/\?\?\s*null/.test(logger),
    `(e) the new spend columns are not written with \`?? null\`. \`|| 0\` would make a genuine zero (real cache miss) indistinguishable from "not recorded", and every percentile over this table would silently average in fake zeros.`)
}

if (findings.length) {
  console.error(`[chat-cache-and-recovery] FAIL — ${findings.length} finding(s):`)
  for (const f of findings) console.error(`  · ${f}`)
  process.exit(1)
}
console.log('[chat-cache-and-recovery] PASS — no volatile as-of in the cached prefix (relocated, not removed), recovery window clears the measured p90 AND the server maxDuration, /api/chat carries per-phase timing with no client data on the line, the 1h TTL is declared, and the spend log persists duration + cache split with NULL-not-zero semantics. ⛔ Cannot prove the cache HITS — that is `usage.cache_read_input_tokens` on a live turn, i.e. Gate-B.')
