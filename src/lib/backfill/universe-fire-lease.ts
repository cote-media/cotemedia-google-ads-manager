// LORAMER_INLINE_FIRE_LEASE_V1 — the fire lease, DORMANT. Nothing imports this module yet, by design:
// C1 ships the primitive and proves it live; C2 (the queue-removal cutover) is the first caller. If you
// are wiring this before the cutover commit exists, you are in the wrong flight.
//
// ⛔ WHAT THIS EXCLUDES, vendor-quoted in migrations/085 where the table lives: Vercel documents that a
// cron fire can overlap a still-running fire, that a scheduled run can be invoked twice, and that a
// deploy does NOT interrupt a running fire — plus our fourth source, an operator drive vs the cron.
// One lease per (client, vendor) lane; the loser exits visibly ('lease-held' heartbeat, written by the
// caller), never silently.
//
// ⛔ ALL ARITHMETIC IS IN DB TIME. The TTL comparison and acquired_at stamping happen inside the SQL
// functions (085) via now(); no Date.now() participates in any lease decision. The contract's
// LEASE_TTL_S is the value of record and is PASSED on every call — the DB default is only a fallback.
import { supabaseAdmin } from '@/lib/supabase'

// ⛔ THE TTL IS NOT DECLARED HERE AND THAT IS DELIBERATE. LEASE_TTL_S lives in universe-v2-contract.ts
// BESIDE the ceiling it is derived from (LEASE_TTL_S = CONSUMER_MAX_DURATION_S + 30, with the
// derivation and the guard-pinned invariant on its face there). This module does not import the
// contract: universe-stream-consumer.guard leg (e) treats any contract import as topic-reach, and the
// lease has no business near the topic. Callers pass the contract's constant on every call — ttlS is
// REQUIRED, so no fallback value can drift here.

export interface LeaseVerdict {
  won: boolean
  /** who holds it now (the caller if won; the incumbent if not) */
  holder: string | null
  /** when the current hold began (DB time) */
  heldSince: string | null
}

/**
 * Acquire the (client, vendor) fire lease. ONE CAS statement in the DB (085's
 * universe_fire_lease_acquire): granted iff unclaimed or stale (> LEASE_TTL_S). A refused acquire is a
 * VERDICT, not an error — the caller reports 'lease-held' and exits; it never retries inside the fire.
 * ⛔ AN UNREADABLE LEASE IS A REFUSAL, NEVER A GRANT: throwing here would let a transient read error
 * start a second concurrent fire — the exact event the lease exists to exclude. Fail closed, loudly.
 */
export async function acquireFireLease(
  clientId: string, vendor: string, holderInvocationId: string, ttlS: number,
): Promise<LeaseVerdict> {
  const { data, error } = await supabaseAdmin.rpc('universe_fire_lease_acquire', {
    p_client_id: clientId, p_vendor: vendor, p_holder: holderInvocationId, p_ttl_s: ttlS,
  })
  if (error) {
    console.error(`[fire-lease] ACQUIRE UNREADABLE for ${clientId}/${vendor}: ${error.message} — refusing (an unreadable lease must never grant).`)
    return { won: false, holder: null, heldSince: null }
  }
  const row = (data as Array<{ won: boolean; holder_invocation_id: string | null; held_since: string | null }> | null)?.[0]
  if (!row) return { won: false, holder: null, heldSince: null }
  return { won: row.won === true, holder: row.holder_invocation_id ?? null, heldSince: row.held_since ?? null }
}

/**
 * Release the lease — HOLDER-CHECKED in the DB (085's universe_fire_lease_release), so a TTL-expired
 * loser cannot release the winner. Returns whether anything was released. A failed release is logged
 * and swallowed: the TTL recovers it, and throwing from a fire's finally would mask the real error —
 * the same one-place-swallowing-is-correct posture as the terminal-row write (universe-v2-worker.ts).
 */
export async function releaseFireLease(
  clientId: string, vendor: string, holderInvocationId: string, ttlS: number,
): Promise<boolean> {
  const { data, error } = await supabaseAdmin.rpc('universe_fire_lease_release', {
    p_client_id: clientId, p_vendor: vendor, p_holder: holderInvocationId,
  })
  if (error) {
    console.error(`[fire-lease] RELEASE FAILED for ${clientId}/${vendor} (holder ${holderInvocationId}): ${error.message} — TTL (${ttlS}s) will recover it.`)
    return false
  }
  return data === true
}
