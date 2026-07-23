// LORAMER_CONN_DEGRADED_STATE_V1 (SLICE 2) — THE ONE SOURCE for what a platform_connections.health value
// MEANS to every reader. connection-health.ts is the only WRITER; this is the only place the READ semantics
// live, so a new state ('degraded') is taught ONCE and scripts/check-connection-degraded-readers.mjs can prove
// no reader silently forgot it. (FIX-WITH-GUARD: collapse the convention to one source, then guard that.)
//
//   healthy       login alive, capture flowing.
//   degraded      login ALIVE, but capture has FAILED continuously >= 24h (promoted by bump_connection_failures,
//                 migration 042). Usually the store's own server, NOT the credential. Distinct from reconnect.
//   reconnect     credential is dead — the USER must re-authorize.
//   disconnected  removed.
//   null          not yet observed → treated healthy-until-observed.

export type Health = 'healthy' | 'degraded' | 'reconnect' | 'disconnected' | null | undefined

// A dead credential the user fixes by re-auth (or a removed connection). Re-auth is the remedy.
export function needsReconnect(h: Health): boolean {
  return h === 'reconnect' || h === 'disconnected'
}

// Capture is persistently failing while the login is fine (server-side, usually). Re-auth will NOT fix it.
export function isDegraded(h: Health): boolean {
  return h === 'degraded'
}

// Any state that must NOT count as green / ready. degraded blocks green (data is stale) WITHOUT being a
// reconnect. This is the predicate readiness + any "all good?" gate must use.
export function blocksGreen(h: Health): boolean {
  return needsReconnect(h) || isDegraded(h)
}

// Is this still a live connection for "connected" / coverage purposes? degraded = YES (it IS connected, just
// failing); reconnect / disconnected = NO (data can't be trusted / is gone).
export function isConnectedForCoverage(h: Health): boolean {
  return !needsReconnect(h)
}

export type HealthTone = 'good' | 'warn' | 'bad' | 'neutral'
// Badge label + tone. `neutralLabel` is what an unobserved (null) connection shows (callers vary: "Connected"
// / "Healthy"). Tone maps to a UI class at the call site (good→hHealthy, warn→hDegraded, bad→hReconnect/…).
export function badgeFor(h: Health, neutralLabel = 'Connected'): { label: string; tone: HealthTone } {
  switch (h) {
    case 'healthy':      return { label: 'Healthy', tone: 'good' }
    case 'degraded':     return { label: 'Capture failing', tone: 'warn' }
    case 'reconnect':    return { label: 'Reconnect', tone: 'bad' }
    case 'disconnected': return { label: 'Disconnected', tone: 'bad' }
    default:             return { label: neutralLabel, tone: 'neutral' }
  }
}

// Honest to-green task for a degraded connection — NOT "reconnect your login".
export function degradedTask(platformLabel: string): string {
  return `${platformLabel} capture has been failing for over a day — check that ${platformLabel} is reachable (often the store's own server, not your login). Lora's ${platformLabel} data may be stale until it clears.`
}

// Lora-facing line for a degraded connection.
export function degradedLoraNote(platformLabel: string, accountName: string): string {
  return `${platformLabel} (${accountName}) is CONNECTED and the login is fine, but its capture has been FAILING continuously for over a day — the latest ${platformLabel} data is STALE, not $0 and not disconnected, and usually this is the store's own server rather than an auth problem. Use query_metrics for the last captured values and say plainly that ${platformLabel} data may be out of date; never report "$0", "no activity", or "not connected" for it.`
}
