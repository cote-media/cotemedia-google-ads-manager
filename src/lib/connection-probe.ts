// LORAMER_CONNECTION_PROBE_BEFORE_FLIP_V1
// Live credential probes used by the connection-health writer to CONFIRM a shared credential
// is actually dead before flipping every connection on it to 'reconnect'. Meta's #190
// OAuthException fires transiently as well as for genuinely dead tokens, so a single
// classify-as-'credential' error is a HYPOTHESIS (Lesson 60) — these probes are the live
// capture-path confirmation that turns the hypothesis into a fact before any durable write.
//
// 3-state, and NEVER throws to the caller:
//   'alive'         — clean success: the credential authenticates RIGHT NOW.
//   'dead'          — clean auth death: Meta #190 (not the transient subcode 99) /
//                     Google invalid_grant|invalid_client.
//   'indeterminate' — anything else (timeout / 5xx / 429 / network / unexpected shape).
//                     FAIL SAFE: the caller must NOT flip and must NOT heal on this verdict.
//
// NOTE: no top-level alias import — probeGoogle pulls @/lib/google-ads lazily — so this module
// can be imported and exercised against the real Graph API outside the Next bundle (Gate A).

export type ProbeResult = 'alive' | 'dead' | 'indeterminate'

const META_PROBE_TIMEOUT_MS = 8000

// Meta: the canonical cheapest validity check (the same call as src/app/api/meta/callback/route.ts:91):
// GET /v18.0/me?fields=id. 200 + id → alive. OAuthException #190 (token expired/invalidated/
// malformed), excluding the transient subcode 99 (AUDIT #15) → dead. Everything else → indeterminate.
export async function probeMeta(
  accessToken: string,
  timeoutMs: number = META_PROBE_TIMEOUT_MS
): Promise<ProbeResult> {
  if (!accessToken) return 'indeterminate'
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), timeoutMs)
  try {
    const res = await fetch(
      `https://graph.facebook.com/v18.0/me?fields=id&access_token=${encodeURIComponent(accessToken)}`,
      { signal: ctrl.signal }
    )
    let data: any
    try {
      data = await res.json()
    } catch {
      return 'indeterminate'
    }
    if (data && data.error) {
      const code = Number(data.error.code)
      const sub = data.error.error_subcode
      if (code === 190 && sub !== 99) return 'dead'
      return 'indeterminate' // permission / rate / transient subcode 99 / unexpected → not a death
    }
    if (res.ok && data && data.id) return 'alive'
    return 'indeterminate'
  } catch {
    return 'indeterminate' // abort/timeout/network — fail safe
  } finally {
    clearTimeout(timer)
  }
}

// Google: reuse listAccessibleAccounts (exercises the OAuth refresh + an MCC query — google-ads.ts:18).
// A clean invalid_grant/invalid_client is an authoritative credential death; anything else →
// indeterminate. Dynamic import keeps this module free of the google-ads-api chain at load time.
export async function probeGoogle(refreshToken: string): Promise<ProbeResult> {
  if (!refreshToken) return 'indeterminate'
  try {
    const { listAccessibleAccounts } = await import('@/lib/google-ads')
    await listAccessibleAccounts(refreshToken)
    return 'alive'
  } catch (e) {
    const m = String((e as any)?.message ?? e ?? '').toLowerCase()
    if (/invalid_grant|invalid_client/.test(m)) return 'dead'
    return 'indeterminate'
  }
}

// Only meta + google are probe-gated this change (the WIDE shared-credential fan-out). Any other
// platform returns 'indeterminate' so a caller that wrongly routes here can never cause a flip.
export async function probeCredential(platform: string, token: string): Promise<ProbeResult> {
  if (platform === 'meta') return probeMeta(token)
  if (platform === 'google') return probeGoogle(token)
  return 'indeterminate'
}
