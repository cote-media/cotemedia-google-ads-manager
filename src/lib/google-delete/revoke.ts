// LORAMER_GOOGLE_DELETE_MY_DATA_V1 — THE REVOKE BRANCH, PURE ENOUGH TO PROVE WITHOUT GOOGLE.
//
// Google access is revoked ONLY when the user has no other Google client left: the refresh token in google_tokens is
// keyed by user_email and serves every google connection that email owns (universe-vendor-stream.ts, sync, the
// driver). Revoking it while another client still uses it would silently kill that client's capture.
// Vendor contract (developers.google.com/identity/protocols/oauth2/web-server, read 2026-09-21): POST
// https://oauth2.googleapis.com/revoke with `token=<refresh or access token>`; 200 on success. Revoking a refresh
// token invalidates the grant. The fetch is INJECTED so the branch is proven with a stub and never against Google.

export const GOOGLE_REVOKE_ENDPOINT = 'https://oauth2.googleapis.com/revoke'

/** True when this deletion removes the user's LAST google client → the grant may be revoked. */
export function decideRevoke(a: { otherGoogleConnections: number }): boolean {
  return a.otherGoogleConnections === 0
}

export async function revokeGoogleRefreshToken(
  refreshToken: string,
  fetchImpl: typeof fetch = fetch,
): Promise<{ ok: boolean; status: number }> {
  const r = await fetchImpl(GOOGLE_REVOKE_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ token: refreshToken }).toString(),
  })
  return { ok: r.ok, status: r.status }
}
