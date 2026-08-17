#!/usr/bin/env node
// LORAMER_CONSUMER_LIVENESS_V1 — DELIVERY, WITNESSED FROM THE CONSUMER'S SIDE ONLY.
//
// ⛔ THE OUTAGE THIS EXISTS TO CATCH, AND IT IS NOT HYPOTHETICAL — IT IS RUNNING RIGHT NOW.
// 2026-08-17 05:32:32Z the queue consumer stopped being invoked. The producer never faltered: it fired every
// 15 minutes and Vercel returned 2xx for 1,476 messages. `check-walk-liveness` read **ALIVE for over ten
// hours**, because its health branch is:
//     if (publishedTotal > 0 || rowsWritten24h > 0) → ALIVE
// and `publishedTotal` is `universe_fire_log.published` — THE PRODUCER'S OWN COUNT OF WHAT IT HANDED THE
// QUEUE. A producer that is working keeps that disjunct true forever, no matter what happens downstream.
// **THE INSTRUMENT WAS NOT WRONG ABOUT WHAT IT MEASURED; IT MEASURED THE WRONG HALF OF THE PIPE.**
// (LORAMER_BACKFILL_DONE_DONE_V1 condition 6: liveness tests CONSUMPTION, not publishing. This is that half.)
//
// ⛔ THE ONE RULE THAT MAKES THIS CHECK DIFFERENT FROM THE ONE IT REPAIRS:
// **THE HEALTH SIGNAL IS READ FROM `universe_attempt_log` AND FROM NOWHERE ELSE.** The producer cannot write
// that table — only the consumer opens an attempt (`appendAttemptStarted`, before the vendor is called). The
// fire log is used ONLY to answer "was there anything to consume", never "is it healthy". If those two roles
// are ever collapsed again, this check becomes the bug it replaces.
//
// ⛔ AND IT IS DELIBERATELY NOT A SECOND WALK-LIVENESS. A dead SCHEDULER is walk-liveness's red; a dead
// DELIVERY PATH is this one's. When the producer published nothing, this check asserts nothing and says so —
// two checks fighting over one red teaches everyone to ignore both.
//
// USAGE: node scripts/check-consumer-liveness.mjs [--guard]
// EXIT:  0 healthy/not-applicable · 1 DELIVERY DARK · 2 CANNOT RUN (a read that cannot answer is never a pass)
// READ-ONLY. No writes, no vendor requests.
import { readFileSync } from 'node:fs'
import path from 'node:path'

const ROOT = process.env.LORAMER_GUARD_ROOT || process.cwd()

// ── THE WINDOW, AND THE ARITHMETIC BEHIND IT RATHER THAN A ROUND NUMBER ─────────────────────────────────
// The resumer fires every 15 minutes. A published message is normally delivered within seconds (measured
// 2026-08-17: fire 05:16:43Z, consumer attempts at 05:16:45Z), and the consumer's own ceiling is 300s. So the
// worst honest lag between "published" and "the consumer wrote a row" is ~6 minutes. 45 minutes spans THREE
// publishing fires and ~7× the worst lag: wide enough that ordinary jitter, a deploy, or one slow handler
// cannot empty it, narrow enough that a dark delivery path is a SAME-HOUR red instead of a next-day autopsy.
const WINDOW_MINUTES = 45
// ⛔ TWO PUBLISHING FIRES MINIMUM. One fire that landed seconds ago has not had time to be consumed, and
// alarming on it would be crying wolf at the clock. Requiring two means at least ~15 minutes of publishing
// went unconsumed before this says a word.
const MIN_PUBLISHING_FIRES = 2

// ── PURE CORE — no I/O, so the guard can drive every branch ─────────────────────────────────────────────
// `publishingFires` / `publishedRecent` — universe_fire_log. USED ONLY AS A PRECONDITION.
// `consumerAttemptsRecent`            — universe_attempt_log, phase='attempt_started'. THE ONLY HEALTH INPUT.
export function decideConsumerLiveness(a) {
  const { publishingFires, publishedRecent, consumerAttemptsRecent, quotaHeld, lastConsumerAgoMin } = a

  // ⛔ NOTHING WAS HANDED TO THE QUEUE ⇒ ZERO CONSUMPTION IS THE CORRECT ANSWER, NOT A DARK ONE.
  // This is the idle case the brief calls "owed==0 fleet-wide": the resumer refuses with 'nothing-owed' and
  // publishes zero, so there is nothing for a consumer to have consumed. Whether the PRODUCER should have
  // published is walk-liveness's question and is deliberately left to it.
  if (publishingFires === 0 || publishedRecent === 0) {
    return { ok: true, state: 'NO-PUBLISH', reason: `nothing published in the trailing ${WINDOW_MINUTES}m, so zero consumption is CORRECT rather than dark. This check asserts nothing about delivery today and says so instead of printing a pass it did not earn. (A dead SCHEDULER is walk-liveness's red, not this one's.)` }
  }

  // ⛔ THE HEALTH BRANCH, AND IT READS EXACTLY ONE THING. Consumer-side evidence, present ⇒ delivery works.
  if (consumerAttemptsRecent > 0) {
    return { ok: true, state: 'ALIVE', reason: `delivery alive — ${consumerAttemptsRecent} consumer attempt(s) opened in the trailing ${WINDOW_MINUTES}m against ${publishedRecent} message(s) published across ${publishingFires} fire(s).` }
  }

  // ⛔ THE CONSUMER'S OWN STEP 0 RETURNS **BEFORE** IT OPENS AN ATTEMPT. On an armed sentinel it records a
  // quota hold and returns, so silence in the attempt log is EXPECTED and is not a delivery fault. Without
  // this branch the first real quota pause would fire a false DELIVERY_DARK and teach everyone to ignore it.
  if (quotaHeld) {
    return { ok: true, state: 'QUOTA-HELD', reason: `${publishedRecent} message(s) published and no consumer attempt in ${WINDOW_MINUTES}m, but the google quota sentinel is HOLDING — the consumer's step 0 returns before it opens an attempt, so this silence is the designed behaviour, not a dark delivery path.` }
  }

  // ⛔ NOT ENOUGH TIME HAS PASSED. One publishing fire could be seconds old.
  if (publishingFires < MIN_PUBLISHING_FIRES) {
    return { ok: true, state: 'WARMING', reason: `only ${publishingFires} publishing fire(s) in the trailing ${WINDOW_MINUTES}m — below the ${MIN_PUBLISHING_FIRES}-fire minimum, so a just-published message has not had time to be consumed. Not an alarm; a clock.` }
  }

  return {
    ok: false, state: 'DELIVERY_DARK',
    reason: `DELIVERY IS DARK — ${publishedRecent} message(s) published across ${publishingFires} fire(s) in the trailing ${WINDOW_MINUTES}m and the consumer opened ZERO attempts. ` +
      (lastConsumerAgoMin === null
        ? `The attempt log has NEVER recorded a consumer attempt. `
        : `Last consumer attempt was ${lastConsumerAgoMin} minute(s) ago. `) +
      `The producer is healthy and the quota sentinel is clear, so the messages are being accepted and NOT delivered. ` +
      `⛔ DO NOT READ A GREEN walk-liveness AS A CONTRADICTION: it tests the PRODUCER (published>0), which stays true throughout exactly this failure — that is why this check exists.`,
  }
}

// ── LIVE READ ───────────────────────────────────────────────────────────────────────────────────────────
async function main() {
  try {
    for (const l of readFileSync(path.resolve(ROOT, '.env.local'), 'utf8').split('\n')) {
      const t = l.trim()
      if (!t || t.startsWith('#')) continue
      const i = t.indexOf('=')
      if (i > 0) { const k = t.slice(0, i); if (!process.env[k]) process.env[k] = t.slice(i + 1).replace(/^["']|["']$/g, '') }
    }
  } catch { /* no .env.local — rely on ambient env */ }
  const SB = process.env.NEXT_PUBLIC_SUPABASE_URL, K = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!SB || !K) { console.error('✗ consumer-liveness CANNOT RUN — Supabase env missing. A broken instrument is not a pass.'); process.exitCode = 2; return }

  const get = async (p) => {
    const r = await fetch(`${SB}/rest/v1/${p}`, { headers: { apikey: K, Authorization: `Bearer ${K}` } })
    return { status: r.status, body: await r.json().catch(() => null) }
  }
  // ⛔ EVERY READ THAT CANNOT ANSWER IS exit 2, NEVER A NUMBER. An unreadable counter that reads as zero is
  // the most permissive answer an instrument can give — the rows-counter defect of 2026-08-15, learned twice.
  const need = (res, what) => {
    if (res.status !== 200 || !Array.isArray(res.body)) {
      console.error(`✗ consumer-liveness CANNOT RUN — ${what} read failed (HTTP ${res.status}): ${JSON.stringify(res.body).slice(0, 200)}`)
      process.exitCode = 2
      return null
    }
    return res.body
  }

  const since = new Date(Date.now() - WINDOW_MINUTES * 60 * 1000).toISOString()
  const enc = encodeURIComponent(since)

  // (1) PRECONDITION ONLY — was anything handed to the queue?
  const firesRes = await get(`universe_fire_log?select=fired_at,dry_run,published&fired_at=gte.${enc}&order=fired_at.desc&limit=200`)
  const fires = need(firesRes, 'fire-log'); if (!fires) return
  const wet = fires.filter((f) => !f.dry_run)
  const publishingFires = wet.filter((f) => Number(f.published ?? 0) > 0).length
  const publishedRecent = wet.reduce((s, f) => s + Number(f.published ?? 0), 0)

  // (2) THE HEALTH SIGNAL — consumer-side evidence, and nothing else touches this number.
  const attemptsRes = await get(`universe_attempt_log?select=recorded_at&phase=eq.attempt_started&recorded_at=gte.${enc}&limit=200`)
  const attempts = need(attemptsRes, 'consumer attempt-log'); if (!attempts) return
  const consumerAttemptsRecent = attempts.length

  // (3) SILENCE DURATION — indexed ordered LIMIT 1, for the message only. Never a health input.
  const lastRes = await get('universe_attempt_log?select=recorded_at&phase=eq.attempt_started&order=recorded_at.desc&limit=1')
  const last = need(lastRes, 'last-attempt'); if (!last) return
  const lastConsumerAgoMin = last.length
    ? Math.round((Date.now() - new Date(last[0].recorded_at).getTime()) / 60000)
    : null

  // (4) THE QUOTA SENTINEL — the one legitimate reason for consumer silence under a live producer.
  // Same row the shipped reader uses (google-quota.ts: sentinel client 000…0, platform '__google_quota').
  const qRes = await get("sync_state?select=backfill_blocked,backfill_block_window&client_id=eq.00000000-0000-0000-0000-000000000000&platform=eq.__google_quota&limit=1")
  const qRows = need(qRes, 'quota sentinel'); if (!qRows) return
  const q = qRows[0] ?? null
  // ⛔ MIRRORS `holdGoogleWork` — blocked, UNLESS the block window has already elapsed. An UNREADABLE
  // sentinel is not modelled here as "held": step (4) already exits 2 rather than guessing.
  const quotaHeld = !!(q?.backfill_blocked) &&
    !(q?.backfill_block_window && Date.now() >= new Date(q.backfill_block_window).getTime())

  const verdict = decideConsumerLiveness({ publishingFires, publishedRecent, consumerAttemptsRecent, quotaHeld, lastConsumerAgoMin })

  console.log(`[consumer-liveness] ${WINDOW_MINUTES}m: fires=${wet.length} publishing=${publishingFires} published=${publishedRecent} · consumer attempts=${consumerAttemptsRecent} · last consumer attempt=${lastConsumerAgoMin === null ? 'never' : lastConsumerAgoMin + 'm ago'} · quotaHeld=${quotaHeld} · state=${verdict.state}`)
  if (!verdict.ok) { console.error(`✗ CONSUMER-LIVENESS FAILED — ${verdict.reason}`); process.exitCode = 1; return }
  console.log(`✓ consumer-liveness OK — ${verdict.reason}`)
}

// Import-safe: the guard imports decideConsumerLiveness without running the live read.
const invokedDirectly = process.argv[1] && import.meta.url.endsWith(path.basename(process.argv[1]))
if (invokedDirectly) await main()
