// LORAMER_META_COMPLIANCE_ENDPOINTS_V1
// Shared verifier for Meta's signed_request (deauthorize + data-deletion
// callbacks). Format: "<sig>.<payload>", both base64url; sig is the raw
// HMAC-SHA256 of the payload STRING (the base64url text, not the decoded
// JSON) keyed with the app secret. Constant-time compare, Shopify-webhook
// style.

import crypto from 'crypto'

export interface SignedRequestPayload {
  user_id?: string
  algorithm?: string
  issued_at?: number
  [key: string]: unknown
}

export type ParseResult =
  | { ok: true; payload: SignedRequestPayload }
  | { ok: false; reason: string }

export function parseSignedRequest(signedRequest: string, appSecret: string): ParseResult {
  if (!signedRequest || typeof signedRequest !== 'string') {
    return { ok: false, reason: 'missing signed_request' }
  }

  const dot = signedRequest.indexOf('.')
  if (dot <= 0 || dot === signedRequest.length - 1) {
    return { ok: false, reason: 'malformed signed_request (expected sig.payload)' }
  }

  const sigPart = signedRequest.slice(0, dot)
  const payloadPart = signedRequest.slice(dot + 1)

  let sig: Buffer
  try {
    sig = Buffer.from(sigPart, 'base64url')
  } catch {
    return { ok: false, reason: 'signature not base64url' }
  }

  // HMAC is computed over the payload portion as transmitted (base64url text)
  const expected = crypto.createHmac('sha256', appSecret).update(payloadPart).digest()

  if (sig.length !== expected.length || !crypto.timingSafeEqual(sig, expected)) {
    return { ok: false, reason: 'invalid signature' }
  }

  let payload: SignedRequestPayload
  try {
    payload = JSON.parse(Buffer.from(payloadPart, 'base64url').toString('utf8'))
  } catch {
    return { ok: false, reason: 'payload not valid base64url JSON' }
  }

  if (payload.algorithm !== 'HMAC-SHA256') {
    return { ok: false, reason: `unexpected algorithm: ${payload.algorithm}` }
  }

  return { ok: true, payload }
}

// Meta POSTs both callbacks as application/x-www-form-urlencoded with a
// single "signed_request" field. Pull it from the raw body.
export function extractSignedRequest(rawBody: string): string | null {
  try {
    const params = new URLSearchParams(rawBody)
    return params.get('signed_request')
  } catch {
    return null
  }
}
