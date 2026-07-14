// LORAMER_LEGACY_COHORT_V1 — EDGE-SAFE predicate (pure string logic, ZERO imports) so BOTH the -next preview gate
// (src/lib/preview-gate.ts, Node) and the legacy-surface middleware (src/middleware.ts, Edge) share ONE source of
// truth without pulling Node-only next-auth/getServerSession into the Edge bundle. The LEGACY COHORT = the Shopify/
// Meta review + demo fixture accounts that are HELD on the current screencast-matching UI while the Shopify App Store
// review is still open; every real user is on -next.
export function isLegacyCohort(email: string | null | undefined): boolean {
  const e = (email || '').trim().toLowerCase()
  if (!e) return false
  if (e === 'shopify-reviewer@loramer.app' || e === 'demo@loramer.com') return true
  if (/^shopify\+.*@loramer\.app$/.test(e)) return true // Shopify App-Store install test fixtures
  return false
}
