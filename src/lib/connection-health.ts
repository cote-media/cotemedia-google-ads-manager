// LORAMER_CONNECTION_HEALTH_V1
// The connection-health signal: classify a fetch error per platform, then persist a
// per-connection health verdict onto platform_connections (last_ok_at / last_error_at /
// last_error_code / health). The UI ("Reconnect needed" badge, dashboard banner, Lora
// prompt) reads `health`; this module is the ONLY writer.
//
// HARD RULES (the whole point of this layer):
//  1. Only an AUTH-class rejection flips a connection to 'reconnect'. A TRANSIENT failure
//     (gRPC 4/13/14, timeout, throttle, 5xx, 429, WAF 406) and an EMPTY result (Lesson 46 —
//     paused account / no orders) MUST NOT flip health. When in doubt → classify as null
//     (do not flip): a false "Reconnect needed" is as much a trust violation as a false
//     "Connected", so the conservative default is to leave health untouched.
//  2. Two-level model. A dead SHARED credential (Google MCC OAuth, Meta FB token) flips
//     EVERY account on that credential. A per-account denial (one revoked customer / ad
//     account) flips ONLY that row. GA/Shopify/Woo credentials are effectively per-
//     connection, so their "credential" scope is narrow by construction.
//  3. Never throw. A health-write failure must never break the data write that triggered it —
//     every persist is wrapped and swallowed (logged).
//
// Health is written DIRECTLY (not re-derived each read): success → 'healthy', auth-failure →
// 'reconnect'. The next successful per-account fetch self-heals a stale 'reconnect'. null
// health = "not yet observed" = treated healthy-until-observed by the UI.

import { supabaseAdmin } from '@/lib/supabase'
import { probeCredential, type ProbeResult, type WooCreds } from '@/lib/connection-probe' // LORAMER_CONNECTION_PROBE_BEFORE_FLIP_V1 + LORAMER_CONNECTION_PROBE_WOO_V1

export type ConnAuthClass = 'credential' | 'account' | null
export type ConnHealth = 'healthy' | 'reconnect' | 'disconnected'

export interface ConnClassification {
  authClass: ConnAuthClass
  code: string | null
}

// Transient signals — shared across platforms. These NEVER flip health.
const TRANSIENT_GRPC = new Set([4, 13, 14]) // DEADLINE_EXCEEDED, INTERNAL, UNAVAILABLE
// NB: do NOT match the bare word "unavailable" / "internal" — our own token helpers throw
// "token unavailable", which is an AUTH problem, not a transient one. The gRPC UNAVAILABLE/
// INTERNAL statuses are caught by TRANSIENT_GRPC (code 13/14); the text forms below are the
// specific phrases those services actually emit.
const TRANSIENT_RE =
  /deadline_exceeded|\bdeadline exceeded\b|timeout|etimedout|econnreset|socket hang up|throttl|temporar(?:y|ily)|service is (?:currently )?unavailable|currently unavailable|\b5\d\d\b|\b429\b|\b406\b|rate limit|please reduce|user request limit/i

function msgOf(err: unknown): string {
  if (err == null) return ''
  if (typeof err === 'string') return err
  const anyErr = err as any
  return String(anyErr?.message ?? anyErr ?? '')
}

function isTransient(err: unknown): boolean {
  const anyErr = err as any
  if (anyErr && typeof anyErr.code === 'number' && TRANSIENT_GRPC.has(anyErr.code)) return true
  return TRANSIENT_RE.test(msgOf(err))
}

// Per-platform AUTH-class predicates. Transient is checked FIRST by the caller, so these
// only see non-transient errors. Default (no match) → { authClass: null } = do not flip.
export function classifyConnectionError(platform: string, err: unknown): ConnClassification {
  if (isTransient(err)) return { authClass: null, code: null }
  const m = msgOf(err).toLowerCase()

  switch (platform) {
    case 'google': {
      if (/invalid_grant|invalid_client/.test(m)) return { authClass: 'credential', code: 'invalid_grant' }
      if (/no google refresh token|no_token|no refresh token/.test(m)) return { authClass: 'credential', code: 'no_token' }
      if (/user_permission_denied|permission_denied/.test(m)) return { authClass: 'account', code: 'permission_denied' }
      if (/customer_not_found|not_adwords_user|customer_not_enabled/.test(m)) return { authClass: 'account', code: 'customer_not_found' }
      if (/authenticationerror|oauth.?token|unauthenticated/.test(m)) return { authClass: 'credential', code: 'auth_error' }
      return { authClass: null, code: null }
    }
    case 'meta': {
      // Graph error code 190 = OAuthException (token expired / invalidated). Shared FB token.
      if (/\(#?190\)|code[^0-9]{0,4}190|oauthexception|access token has expired|session has been invalidated|error validating access token|malformed access token|no meta token/.test(m)) {
        return { authClass: 'credential', code: /no meta token/.test(m) ? 'no_token' : 'oauth_190' }
      }
      if (/\(#?200\)|\(#?10\)|does not have permission|permissions error|ad account.*disabled/.test(m)) {
        return { authClass: 'account', code: 'permission' }
      }
      return { authClass: null, code: null }
    }
    case 'ga': {
      // The observed killer (2026-06): refresh returns invalid_grant after a verification
      // transition. ga-token surfaces it as "refresh_failed - {...invalid_grant...}".
      if (/invalid_grant|invalid_client/.test(m)) return { authClass: 'credential', code: 'invalid_grant' }
      if (/no_token|missing ga_property|no.{0,3}token/.test(m)) return { authClass: 'credential', code: 'no_token' }
      // bare 'refresh_failed' (network / env not configured) is NOT proven-dead → do not flip.
      return { authClass: null, code: null }
    }
    case 'shopify': {
      if (/refresh_expired/.test(m)) return { authClass: 'credential', code: 'refresh_expired' }
      if (/no_token|no token/.test(m)) return { authClass: 'credential', code: 'no_token' }
      if (/\b401\b|unauthorized|invalid_token|invalid api key|access token.*invalid/.test(m)) {
        return { authClass: 'credential', code: '401' }
      }
      // bare 'refresh_failed' (claim race / network) is ambiguous → do not flip.
      return { authClass: null, code: null }
    }
    case 'woocommerce': {
      if (/\b401\b|woocommerce_rest_authentication|invalid signature|consumer key|unauthorized|rest_cannot_view/.test(m)) {
        return { authClass: 'credential', code: '401' }
      }
      if (/no woocommerce cred|no_token|no credentials/.test(m)) return { authClass: 'credential', code: 'no_token' }
      return { authClass: null, code: null }
    }
    default:
      return { authClass: null, code: null }
  }
}

// A health filter is a set of equality predicates AND'd together (column -> value).
export type HealthFilter = Record<string, string>

// PURE two-level scope resolver (unit-tested). Given the auth class + identifiers, returns the
// exact platform_connections filter to flip, or null if we lack the keys to scope safely.
//  • account-level denial   → the single (client, platform, account) row
//  • credential google/meta → every row on that shared user credential
//  • credential shopify     → every row on that shop_domain (account_id), across clients
//  • credential ga/woo      → the per-client connection (narrow by account if known)
export function resolveReconnectScope(
  platform: string,
  authClass: Exclude<ConnAuthClass, null>,
  args: { userEmail?: string | null; clientId?: string | null; accountId?: string | null }
): HealthFilter | null {
  if (authClass === 'account') {
    if (!args.clientId || !args.accountId) return null
    return { client_id: args.clientId, platform, account_id: args.accountId }
  }
  switch (platform) {
    case 'google':
    case 'meta':
      if (!args.userEmail) return null
      return { user_email: args.userEmail, platform }
    case 'shopify':
      if (!args.accountId) return null
      return { platform: 'shopify', account_id: args.accountId }
    case 'ga':
    case 'woocommerce':
      if (!args.clientId) return null
      return args.accountId
        ? { client_id: args.clientId, platform, account_id: args.accountId }
        : { client_id: args.clientId, platform }
    default:
      return null
  }
}

async function applyUpdate(filter: HealthFilter, patch: Record<string, unknown>): Promise<void> {
  try {
    let q: any = supabaseAdmin.from('platform_connections').update(patch)
    for (const [col, val] of Object.entries(filter)) q = q.eq(col, val)
    const { error } = await q
    if (error) {
      console.error('[conn-health] update failed:', error.message)
    }
  } catch (e) {
    console.error('[conn-health] update threw:', (e as any)?.message ?? e)
  }
}

// LORAMER_CONN_FAILURE_STREAK_V1 — a compact, honest code for a NON-auth failure: the HTTP status if the
// message carries one, else a coarse token. (Auth failures already carry a classify code.)
function transientFailureCode(err: unknown): string {
  const m = err == null ? '' : typeof err === 'string' ? err : String((err as any)?.message ?? err)
  const s = m.match(/\b(5\d\d|429|406|408)\b/)
  if (s) return s[1]
  if (/deadline|timeout|etimedout|econnreset|socket hang up/i.test(m)) return 'timeout'
  return 'transient'
}

// LORAMER_CONN_FAILURE_STREAK_V1 — THE ONE failure-recording path. Every failure branch that (correctly)
// does NOT flip health — the transient/empty/unknown branch of recordConnectionResult and the indeterminate
// probe branch of recordConnectionAuthFailure — routes HERE instead of returning silently, so a PERSISTENT
// failure accrues a visible streak. Atomic +1 via the SQL function (supabase-js cannot express col+1).
// NEVER throws (rule 3) — swallow + log; a streak-write failure must not break the data write that triggered it.
async function recordFailureStreak(
  scope: { platform: string; clientId?: string | null; accountId?: string | null; userEmail?: string | null },
  code: string | null
): Promise<void> {
  try {
    const { error } = await supabaseAdmin.rpc('bump_connection_failures', {
      p_platform: scope.platform,
      p_client_id: scope.clientId ?? null,
      p_account_id: scope.accountId ?? null,
      p_user_email: scope.userEmail ?? null,
      p_code: code,
    })
    if (error) console.error('[conn-health] failure-streak bump failed:', error.message)
  } catch (e) {
    console.error('[conn-health] failure-streak bump threw:', (e as any)?.message ?? e)
  }
}

// Success: this exact connection authenticated. Heal it (clears any stale 'reconnect').
export async function recordConnectionSuccess(args: {
  clientId: string
  platform: string
  accountId: string
}): Promise<void> {
  const nowIso = new Date().toISOString()
  await applyUpdate(
    { client_id: args.clientId, platform: args.platform, account_id: args.accountId },
    // LORAMER_CONN_FAILURE_STREAK_V1 — a successful fetch CLEARS the streak (recovered → no longer failing).
    { health: 'healthy', last_ok_at: nowIso, last_error_code: null, consecutive_failures: 0, first_failure_at: null, last_failure_code: null }
  )
}

// LORAMER_CONNECTION_PROBE_BEFORE_FLIP_V1 — coalesce probes per (platform, userEmail): a fleet-wide
// 190 burst in one invocation (N connections on one shared token all throw) triggers exactly ONE
// live probe of that credential, not N — the token is shared, so one verdict is authoritative for
// every row on it. TTL-scoped so a warm serverless container can't reuse a stale verdict across the
// next (hours-later) cron run; staleness only ever errs toward NOT flipping (the design ethic).
const PROBE_MEMO_TTL_MS = 5 * 60 * 1000
const probeMemo = new Map<string, { at: number; p: Promise<ProbeResult> }>()

async function resolveCredentialToken(platform: string, userEmail: string): Promise<string | null> {
  if (platform === 'meta') {
    const { data } = await supabaseAdmin.from('meta_tokens').select('access_token').eq('user_email', userEmail).single()
    return data?.access_token ?? null
  }
  if (platform === 'google') {
    const { data } = await supabaseAdmin.from('google_tokens').select('refresh_token').eq('user_email', userEmail).single()
    return data?.refresh_token ?? null
  }
  return null
}

async function probeCredentialCoalesced(platform: string, userEmail: string): Promise<ProbeResult> {
  const key = `${platform}:${userEmail}`
  const now = Date.now()
  const hit = probeMemo.get(key)
  if (hit && now - hit.at < PROBE_MEMO_TTL_MS) return hit.p
  const p = (async (): Promise<ProbeResult> => {
    const token = await resolveCredentialToken(platform, userEmail)
    if (!token) return 'dead' // no credential at all = authoritatively unauthable → flip is correct
    return probeCredential(platform, token)
  })()
  probeMemo.set(key, { at: now, p })
  return p
}

// LORAMER_CONNECTION_PROBE_WOO_V1 — Woo has NO OAuth refresh, so resolve the stored API keys the SAME
// way the capture path does (woocommerce_tokens by client_id [+ user_email]) and gentle-probe with them.
async function resolveWooCreds(clientId: string, userEmail: string | null): Promise<WooCreds | null> {
  let q: any = supabaseAdmin
    .from('woocommerce_tokens')
    .select('store_url, consumer_key, consumer_secret')
    .eq('client_id', clientId)
  if (userEmail) q = q.eq('user_email', userEmail)
  const { data } = await q.maybeSingle()
  if (!data?.store_url || !data?.consumer_key || !data?.consumer_secret) return null
  return { storeUrl: data.store_url, consumerKey: data.consumer_key, consumerSecret: data.consumer_secret }
}

// Per-client coalescing (Woo scope is per-client, no fan-out): one gentle probe per (woocommerce,clientId)
// per invocation so an error burst can't hammer the self-hosted store.
async function probeWooCoalesced(clientId: string, userEmail: string | null): Promise<ProbeResult> {
  const key = `woocommerce:${clientId}`
  const now = Date.now()
  const hit = probeMemo.get(key)
  if (hit && now - hit.at < PROBE_MEMO_TTL_MS) return hit.p
  const p = (async (): Promise<ProbeResult> => {
    const creds = await resolveWooCreds(clientId, userEmail)
    if (!creds) return 'dead' // no stored keys at all = unauthable → flip is correct
    return probeCredential('woocommerce', creds)
  })()
  probeMemo.set(key, { at: now, p })
  return p
}

// Auth failure: flip to 'reconnect' at the right scope (credential = many; account = one).
export async function recordConnectionAuthFailure(args: {
  platform: string
  authClass: Exclude<ConnAuthClass, null>
  code: string | null
  userEmail?: string | null
  clientId?: string | null
  accountId?: string | null
}): Promise<void> {
  // LORAMER_CONNECTION_PROBE_BEFORE_FLIP_V1 (google/meta) + LORAMER_CONNECTION_PROBE_WOO_V1 (woocommerce)
  // — PROBE BEFORE FLIP. A classify-as-'credential' error is only a HYPOTHESIS (Lesson 60); confirm the
  // credential is actually dead via a live probe before flipping. Covered: google/meta (WIDE shared-token
  // fan-out → probe per user_email, heal credential-wide) + woocommerce (self-hosted, NO refresh layer →
  // probe per client_id, heal per-connection). account-class + Shopify + GA stay UNCHANGED: proven
  // evidence-backed by construction (Shopify = getValidShopifyToken refresh-determination or a live
  // Admin-API 401; GA = invalid_grant from the refresh POST) with narrow scope (WS2 #2b audit).
  const wideCred =
    args.authClass === 'credential' && (args.platform === 'google' || args.platform === 'meta') && !!args.userEmail
  const wooCred =
    args.authClass === 'credential' && args.platform === 'woocommerce' && !!args.clientId
  if (wideCred || wooCred) {
    const probe = wooCred
      ? await probeWooCoalesced(args.clientId!, args.userEmail ?? null)
      : await probeCredentialCoalesced(args.platform, args.userEmail!)
    const healFilter: HealthFilter = wooCred
      ? (args.accountId
          ? { client_id: args.clientId!, platform: args.platform, account_id: args.accountId }
          : { client_id: args.clientId!, platform: args.platform })
      : { user_email: args.userEmail!, platform: args.platform }
    const subject = wooCred ? `client ${args.clientId}` : `credential ${args.userEmail}`
    if (probe === 'alive') {
      // Authenticates RIGHT NOW → the error was spurious. Do NOT flip; HEAL (clears any stale 'reconnect';
      // for google/meta this is credential-wide and also fixes the quiet-account never-heals trap).
      await applyUpdate(healFilter, {
        health: 'healthy',
        last_ok_at: new Date().toISOString(),
        last_error_code: null,
        last_error_at: null,
      })
      return
    }
    if (probe === 'indeterminate') {
      // FAIL SAFE (Lesson 15/60): uncertainty (timeout/5xx/429/406/network/WAF) must NEVER dark-flag a
      // live connection. Leave health untouched and warn loudly; the next event re-probes.
      console.warn(
        `[conn-health] ${args.platform} ${subject}: probe INDETERMINATE (err ${args.code ?? 'auth'}) — leaving health unchanged (fail-safe)`
      )
      // LORAMER_CONN_FAILURE_STREAK_V1 — same blind spot as the transient branch: an indeterminate probe
      // still must NOT flip, but must NOT be silent. Record at the SAME scope the flip would use (woo =
      // per-connection; google/meta = credential-wide).
      await recordFailureStreak(
        wooCred
          ? { platform: args.platform, clientId: args.clientId, accountId: args.accountId ?? null }
          : { platform: args.platform, userEmail: args.userEmail },
        args.code ?? 'indeterminate'
      )
      return
    }
    // probe === 'dead' → fall through to the flip below.
  }

  const filter = resolveReconnectScope(args.platform, args.authClass, args)
  if (!filter) return // not enough keys to scope safely — never flip blindly
  const nowIso = new Date().toISOString()
  await applyUpdate(filter, {
    health: 'reconnect' as ConnHealth,
    last_error_at: nowIso,
    last_error_code: args.code ?? 'auth',
  })
}

// Convenience used at every call site: pass the error (or omit for success). Classifies and
// writes. TRANSIENT/EMPTY (authClass === null) → no-op, health untouched.
export async function recordConnectionResult(args: {
  platform: string
  clientId: string
  accountId: string
  userEmail?: string | null
  error?: unknown
}): Promise<void> {
  if (args.error == null) {
    await recordConnectionSuccess({ clientId: args.clientId, platform: args.platform, accountId: args.accountId })
    return
  }
  const { authClass, code } = classifyConnectionError(args.platform, args.error)
  if (authClass == null) {
    // LORAMER_CONN_FAILURE_STREAK_V1 — transient/empty/unknown STILL does not flip health (rule 1), but it
    // is NO LONGER silent: record the streak so a persistent failure (Shelley: a 5xx every fire) accrues state.
    await recordFailureStreak(
      { platform: args.platform, clientId: args.clientId, accountId: args.accountId, userEmail: args.userEmail },
      transientFailureCode(args.error)
    )
    return
  }
  await recordConnectionAuthFailure({
    platform: args.platform,
    authClass,
    code,
    userEmail: args.userEmail,
    clientId: args.clientId,
    accountId: args.accountId,
  })
}
