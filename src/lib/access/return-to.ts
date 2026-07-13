// LORAMER_NEXT_CONNECT_V1 F2 — open-redirect guard for the OPTIONAL returnTo threaded through the -next connect
// flows (Shopify Branch A, WooCommerce). ONLY a same-origin -next client-profile PATH is allowed; anything else
// (absent, external, protocol-relative '//host', 'https://host', 'javascript:', a non-string) → null, and the
// caller falls back to the existing legacy /clients redirect (byte-identical). The strict startsWith prefix makes
// an external redirect impossible: the value must begin with the literal '/dashboard-next/'.
export function safeReturnTo(raw: unknown): string | null {
  if (typeof raw !== 'string') return null
  if (!raw.startsWith('/dashboard-next/')) return null
  return raw
}
