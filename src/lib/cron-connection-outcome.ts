// LORAMER_CONNECTION_OUTCOME_LEDGER_V1 — SUCCESS IS COUNTED, NOT SUBTRACTED.
//
// ⛔ WHAT THIS REPLACES, measured 2026-07-31. Both cron lanes carried the identical expression:
//     connectionsSucceeded = Math.max(0, attempted - erroredConns)
//     erroredConns         = new Set(errsForP.map(e => e.clientId)).size
// Two defects in one line.
//
//  (1) SUCCESS WAS THE ABSENCE OF A RECORDED ERROR. Every `continue` that did not push an error became a
//      success by arithmetic. MEASURED: shopify catchup wrote `att 9 / ok 9 / err 0` on every run of
//      2026-07-29 and 07-30 while the forward lane recorded 2 hard auth errors on two of those same nine
//      connections. catchup never saw them: `if (fillDays.length === 0) continue` (route:388/464/554/783/851)
//      fires AFTER the attempted increment and BEFORE the credential call, and computeFillDays returns []
//      for a connection with no rows at all (route:169-171). A connection that has never captured anything
//      in its life was therefore GUARANTEED to be counted as a success, on all five platforms.
//
//  (2) ERRORS WERE DEDUPED BY CLIENT WHILE attempted COUNTED CONNECTIONS. One client failing on three
//      connections contributed 3 attempted and 1 errored — two more phantom successes.
//
// ⛔ THE FIX IS A LEDGER KEYED BY CONNECTION, not a better subtraction. Every connection is REGISTERED at
// the moment it is attempted, defaulting to 'skipped', and can only become 'ok' at the point where work
// actually completed. attempted is then ok + errored + skipped BY CONSTRUCTION: the three states partition
// the attempted set, so they cannot drift apart the way two independent counters and a subtraction did.
//
// ⛔ WHY errsForP CANNOT DO THIS, stated rather than guessed. SyncError is { clientId, platform, message }
// — there is no account/connection identity on it anywhere in either lane. Counting errors per CONNECTION
// from that list is not possible at all; it is not a harder query, it is missing data. The ledger works
// because it is written INSIDE the connection loop, where `conn.account_id` is in scope.
//
// ⛔ PRECEDENCE — error > ok > skipped, deliberate:
//   · a connection that wrote rows AND recorded an error is ERRORED. A partial fill is precisely the thing
//     that must not read green, and counting it once as an error is the conservative direction.
//   · a connection that wrote nothing and recorded nothing is SKIPPED — never a success.
//   · SKIPPED IS A FIRST-CLASS STATE, not a rounding of either neighbour. Per the denominator law
//     (LORAMER_EMPTY_CARRIES_ITS_DENOMINATOR_V1) "we did not look" is a different fact from "we looked and
//     there was nothing to do", and absorbing one into the other is the ambiguity that was removed on
//     2026-07-31 and would walk straight back in through this door.

export type ConnOutcome = 'ok' | 'error' | 'skipped'

export type OutcomeTally = {
  attempted: number // ok + errored + skipped, always — never an independent counter
  ok: number
  errored: number
  skipped: number
}

// Separator: a platform, a uuid and an account id can all contain '-', ':' and '/', so the delimiter has to
// be something none of them can hold. Written as an ESCAPE, never as a literal control byte in the source —
// a raw NUL in a .ts file makes it binary to grep and to every guard that reads source as text.
const SEP = '\u0000'

// An account id is not always resolvable at the point an error is recorded — GA reads its property id from
// ga_tokens and that read can itself fail (catchup:838-841). An unresolved connection is still ONE
// connection and must be counted; it is labelled rather than dropped.
export const UNRESOLVED_ACCOUNT = '(unresolved)'

export function connectionKey(platform: string, clientId: string, accountId: string | null | undefined): string {
  return `${platform}${SEP}${clientId}${SEP}${accountId || UNRESOLVED_ACCOUNT}`
}

// PURE — the precedence rule, extracted so it is provable without a route.
export function applyOutcome(prev: ConnOutcome | undefined, next: ConnOutcome): ConnOutcome {
  if (prev === 'error' || next === 'error') return 'error'
  if (prev === 'ok' || next === 'ok') return 'ok'
  return 'skipped'
}

// PURE — the count. There is no subtraction anywhere in here and no room to introduce one: `ok` is only ever
// incremented by reading an entry that was explicitly marked 'ok'.
export function tallyOutcomes(entries: Iterable<[string, ConnOutcome]>, platform: string): OutcomeTally {
  const prefix = `${platform}${SEP}`
  let ok = 0
  let errored = 0
  let skipped = 0
  for (const [key, outcome] of entries) {
    if (!key.startsWith(prefix)) continue
    if (outcome === 'ok') ok += 1
    else if (outcome === 'error') errored += 1
    else skipped += 1
  }
  return { attempted: ok + errored + skipped, ok, errored, skipped }
}

export type ConnectionLedger = {
  // Register a connection as ATTEMPTED. Idempotent, and never downgrades an outcome already recorded.
  begin(platform: string, clientId: string, accountId: string | null | undefined): void
  // Record an outcome. Also registers the connection if `begin` never ran (the GA unresolved-identity path).
  mark(platform: string, clientId: string, accountId: string | null | undefined, outcome: ConnOutcome): void
  tally(platform: string): OutcomeTally
  entries(): Iterable<[string, ConnOutcome]>
  size(): number
}

export function createConnectionLedger(): ConnectionLedger {
  const ledger = new Map<string, ConnOutcome>()
  return {
    begin(platform, clientId, accountId) {
      const key = connectionKey(platform, clientId, accountId)
      if (!ledger.has(key)) ledger.set(key, 'skipped')
    },
    mark(platform, clientId, accountId, outcome) {
      const key = connectionKey(platform, clientId, accountId)
      ledger.set(key, applyOutcome(ledger.get(key), outcome))
    },
    tally(platform) {
      return tallyOutcomes(ledger, platform)
    },
    entries() {
      return ledger.entries()
    },
    size() {
      return ledger.size
    },
  }
}
