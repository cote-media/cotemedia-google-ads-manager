// LORAMER_SHOPIFY_INSTALL_V1
// src/lib/shopify-install-token.ts
//
// Signs and verifies short-lived install tokens used by the Shopify-initiated
// install flow. After OAuth callback completes server-side, we sign a token
// containing the userEmail and pass it to /install/complete via URL, where
// the client calls signIn('shopify-install', { token }) to create a session.
//
// Tokens are signed with NEXTAUTH_SECRET (HMAC-SHA256), expire after 5 minutes,
// and are single-purpose (sign-in only, no other auth scope).
//
// No external JWT library — uses Node's built-in crypto module.

import crypto from 'crypto'

const TOKEN_TTL_MS = 5 * 60 * 1000 // 5 minutes

export type InstallTokenPayload = {
  userEmail: string
  iat: number // issued-at, ms epoch
  exp: number // expires-at, ms epoch
}

function getSecret(): string {
  const s = process.env.NEXTAUTH_SECRET
  if (!s) throw new Error('NEXTAUTH_SECRET not set')
  return s
}

function base64UrlEncode(buf: Buffer | string): string {
  const b = typeof buf === 'string' ? Buffer.from(buf, 'utf8') : buf
  return b.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function base64UrlDecode(s: string): Buffer {
  const padded = s.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (s.length % 4)) % 4)
  return Buffer.from(padded, 'base64')
}

function sign(payloadB64: string): string {
  return base64UrlEncode(
    crypto.createHmac('sha256', getSecret()).update(payloadB64).digest()
  )
}

/**
 * Sign a fresh install token for the given userEmail.
 * Returns a compact token string: <payload-b64>.<sig-b64>
 */
export function signInstallToken(userEmail: string): string {
  const now = Date.now()
  const payload: InstallTokenPayload = {
    userEmail,
    iat: now,
    exp: now + TOKEN_TTL_MS,
  }
  const payloadB64 = base64UrlEncode(JSON.stringify(payload))
  const sig = sign(payloadB64)
  return `${payloadB64}.${sig}`
}

/**
 * Verify and decode an install token. Returns the payload on success,
 * or null if signature is invalid, token is malformed, or token is expired.
 */
export function verifyInstallToken(token: string | null | undefined): InstallTokenPayload | null {
  if (!token || typeof token !== 'string') return null

  const parts = token.split('.')
  if (parts.length !== 2) return null

  const [payloadB64, sigB64] = parts

  // Constant-time signature comparison
  const expectedSig = sign(payloadB64)
  if (expectedSig.length !== sigB64.length) return null
  try {
    if (!crypto.timingSafeEqual(Buffer.from(sigB64), Buffer.from(expectedSig))) {
      return null
    }
  } catch {
    return null
  }

  // Parse + validate payload
  let payload: InstallTokenPayload
  try {
    payload = JSON.parse(base64UrlDecode(payloadB64).toString('utf8'))
  } catch {
    return null
  }

  if (typeof payload.userEmail !== 'string' || !payload.userEmail) return null
  if (typeof payload.exp !== 'number') return null

  // Expiry check
  if (Date.now() > payload.exp) return null

  return payload
}
