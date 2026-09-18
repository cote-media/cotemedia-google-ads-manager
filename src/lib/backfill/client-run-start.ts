// LORAMER_ONE_CLICK_RUN_V1 — THE BUTTON STARTS THE RUN ONCE; A SECOND PRESS IS THE METER; A FLOOR-DONE RUN NEVER RESTARTS.
//
// ⛔ ADOPTED-FROM Temporal's WorkflowIdConflictPolicy USE_EXISTING ("Prevents the Workflow Execution from spawning and
// returns a successful response with the Open Workflow Execution's Run Id") and Fivetran's sync endpoint at
// force=false ("the connection will sync only if it isn't currently syncing"). The lane (client_id, vendor) IS the
// idempotency key — no client-side key, no client-side guard (Airbyte #10215 is what a client-only guard looks like:
// the button spins forever and the server's "already running" is never seen).
//
// ⛔ WHY THIS IS NOT THE RUN ROUTE'S action=start: that upsert RESETS a running row's counters and started_at
// (universe-run/route.ts:69-79), and the step in flight then loses its compare-and-set. It stays the OPERATOR's
// path behind CRON_SECRET. This module is the CUSTOMER's path: owner-session-authed by the route, race-safe at the
// database (an insert that hits the primary key returns the existing row; a restart is a conditional update on
// finished_at that returns zero rows when someone else already restarted).
//
// THE RESTART RULE (rounds 8–9, 2026-09-18): RESTART ⇔ finished_at IS NOT NULL ∧ (endKind ≠ 'floor' ∨ readout ≠ 'complete').
//   failed → restart · stopped by an operator → restart · floor-done while the readout still says complete → METER ONLY
//   (MAP §7: "when it is done, it is done"; forward capture and the rotation own the future) · floor-done whose readout
//   has fallen back to partial (a re-admitted seal, a grown catalogue) → restart, because owed ground exists again.
import { supabaseAdmin } from '@/lib/supabase'
import { endKindOf, runView, type RunRowLike, type RunView } from '@/lib/backfill/continuous-run'
import type { GoogleWalkState } from '@/lib/backfill/google-walk-status'

export type StartDecision = 'insert' | 'restart' | 'existing' | 'meter'

/** PURE. What a press does to this lane, given the row (or none) and the readout the customer sees. */
export function decideStart(row: RunRowLike | null | undefined, readout: GoogleWalkState): StartDecision {
  if (!row) return 'insert'
  if (!row.finished_at) return 'existing' // running or stopping — one run per lane, the press returns it
  const kind = endKindOf({ status: row.status, stopReason: row.stop_reason, finishedAt: row.finished_at })
  if (kind === 'floor' && readout === 'complete') return 'meter'
  return 'restart'
}

/** The fresh row a start or restart writes — the same shape the operator route writes (universe-run/route.ts:71-76). */
export function freshRunRow(clientId: string, vendor: string, nowIso: string) {
  return {
    client_id: clientId, vendor, status: 'running', started_at: nowIso, updated_at: nowIso,
    finished_at: null, steps: 0, requests_opened: 0, days_committed: 0, steps_without_progress: 0,
    stop_reason: null, last_step_at: null,
    last_invocation: null, // no claim: the next minute's pump may take the lane at once
  }
}

export interface StartDeps {
  read: (clientId: string, vendor: string) => Promise<RunRowLike | null>
  /** INSERT; must throw with `code: '23505'` (or return { conflict: true }) when the primary key already exists. */
  insert: (row: ReturnType<typeof freshRunRow>) => Promise<{ conflict: boolean }>
  /** UPDATE … WHERE finished_at IS NOT NULL; returns how many rows changed (0 = someone else restarted or it went live). */
  restart: (clientId: string, vendor: string, row: ReturnType<typeof freshRunRow>) => Promise<number>
}

const realDeps: StartDeps = {
  read: async (clientId, vendor) => {
    const { data, error } = await supabaseAdmin.from('universe_run')
      .select('status, steps, requests_opened, days_committed, started_at, last_step_at, finished_at, stop_reason, last_invocation')
      .eq('client_id', clientId).eq('vendor', vendor).maybeSingle()
    if (error) throw new Error(`run row unreadable: ${error.message}`)
    return (data as RunRowLike | null) ?? null
  },
  insert: async (row) => {
    const { error } = await supabaseAdmin.from('universe_run').insert(row)
    if (error) {
      if ((error as any).code === '23505') return { conflict: true }
      throw new Error(`run insert failed: ${error.message}`)
    }
    return { conflict: false }
  },
  restart: async (clientId, vendor, row) => {
    const { data, error } = await supabaseAdmin.from('universe_run')
      .update(row)
      .eq('client_id', clientId).eq('vendor', vendor).not('finished_at', 'is', null)
      .select('client_id')
    if (error) throw new Error(`run restart failed: ${error.message}`)
    return data?.length ?? 0
  },
}

export interface StartResult {
  action: StartDecision
  run: RunView | null
  note: string
}

/**
 * Start the lane's run once. Race-safe: two presses land on one row — the second reads the first's row back.
 * `readout` is the customer's own readout state (googleWalkStatus), read by the route before calling.
 */
export async function startClientRun(
  a: { clientId: string; vendor: string; readout: GoogleWalkState; nowMs?: number },
  deps: StartDeps = realDeps,
): Promise<StartResult> {
  const nowMs = a.nowMs ?? Date.now()
  const nowIso = new Date(nowMs).toISOString()
  const row = await deps.read(a.clientId, a.vendor)
  const decision = decideStart(row, a.readout)
  if (decision === 'existing') {
    return { action: 'existing', run: runView(row, nowMs), note: 'a run is already live on this lane — returned unchanged (Use Existing); the meter is the answer' }
  }
  if (decision === 'meter') {
    return { action: 'meter', run: runView(row, nowMs), note: 'this lane reached its floor and the readout is complete — nothing to start; forward capture and the rotation own the future' }
  }
  const fresh = freshRunRow(a.clientId, a.vendor, nowIso)
  if (decision === 'insert') {
    const r = await deps.insert(fresh)
    if (r.conflict) {
      const now = await deps.read(a.clientId, a.vendor)
      return { action: 'existing', run: runView(now, nowMs), note: 'another press won the insert — returned its row' }
    }
    return { action: 'insert', run: runView(fresh as RunRowLike, nowMs), note: 'run row written; the next minute\'s pump takes the lane' }
  }
  const changed = await deps.restart(a.clientId, a.vendor, fresh)
  if (changed === 0) {
    const now = await deps.read(a.clientId, a.vendor)
    return { action: 'existing', run: runView(now, nowMs), note: 'the lane went live before this restart landed — returned the live row' }
  }
  return { action: 'restart', run: runView(fresh as RunRowLike, nowMs), note: `restarted (the previous run had ended: ${row?.stop_reason ?? 'no reason recorded'})` }
}

// ── PREFLIGHT — WHOSE TOKEN ─────────────────────────────────────────────────────────────────────────────────
// The fire runs on the CONNECTION's email (universe-resume/route.ts: `userEmail = conn.user_email || client.user_email`),
// which is the Google login that connected the account (clients/connections/route.ts stamps session.user.email), and
// google_tokens is keyed by that email (universe-vendor-stream.ts). Never the presser's session email.
export function tokenEmailFor(conn: { user_email: string | null } | null, ownerEmail: string): string {
  return conn?.user_email || ownerEmail
}

export interface PreflightDeps {
  connection: (clientId: string) => Promise<{ account_id: string | null; user_email: string | null } | null>
  hasToken: (email: string) => Promise<boolean>
}
const realPreflight: PreflightDeps = {
  connection: async (clientId) => {
    const { data } = await supabaseAdmin.from('platform_connections').select('account_id, user_email')
      .eq('client_id', clientId).eq('platform', 'google').limit(1).maybeSingle()
    return (data as any) ?? null
  },
  hasToken: async (email) => {
    const { data } = await supabaseAdmin.from('google_tokens').select('refresh_token').eq('user_email', email).maybeSingle()
    return !!data?.refresh_token
  },
}

export async function preflightGoogle(
  a: { clientId: string; ownerEmail: string }, deps: PreflightDeps = realPreflight,
): Promise<{ ok: true; tokenEmail: string; customerId: string } | { ok: false; reason: string }> {
  const conn = await deps.connection(a.clientId)
  if (!conn || !conn.account_id) return { ok: false, reason: 'no Google Ads connection on this client — connect one first' }
  const tokenEmail = tokenEmailFor(conn, a.ownerEmail)
  if (!(await deps.hasToken(tokenEmail))) {
    return { ok: false, reason: `the Google login that connected this account (${tokenEmail}) has no token on file — reconnect Google Ads with that login` }
  }
  return { ok: true, tokenEmail, customerId: conn.account_id }
}
