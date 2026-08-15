// LORAMER_GOOGLE_AD_NAME_COMPOSE_V1 — ONE composition, ONE home. Every path that turns a Google ad row into
// a display name imports THIS function: the live route (/api/google/ads), the forward intelligence mapper
// (google-intelligence.ts ads map → google-metrics-row pushRow('ad', …)), and the ad-grain backfill writer
// (google-adgroup-ad-backfill.ts). google-ad-name-compose.guard.mjs fails the build if any of them re-derives
// a local join instead.
//
// ⛔ WHY THIS EXISTS (★GOOGLE-AD-ENTITY-NAMES-MISSING, diagnosed VENDOR-EMPTY by probe 2026-08-15):
// Google serves NO `ad.name` for search-type ads — the live proto (googleapis v22 ad.proto, field 47):
//   "The name field is currently only supported for DisplayUploadAd, ImageAd, LegacyAppInstallAd,
//    ShoppingComparisonListingAd, VideoAd, VideoResponsiveAd and DemandGen ads."
// Measured on Foam OH: 44 of 50 ads have NO name in the raw response (RSA/ETA/DSA + 2 more types), and the
// 6 that do carry auto-generated junk — verbatim "Ad #1", "Ad 1", "(Ad 1) auto-generated video ad". The
// name-bearing MATERIAL (RSA headlines/descriptions, ETA parts) IS served on the very ads whose name is
// absent. docs/LORAMER_BACKFILL_FACT_REGISTRY.md §AD.NAME owns both facts with the probe evidence.
//
// ⛔ PRECEDENCE, and both directions are deliberate (the adversary attacks from each side):
//   1. COMPOSITION WINS WHEN MATERIAL EXISTS — first 3 RSA headlines joined ' | ', or ETA part1 | part2.
//      This is byte-compatible with what /api/google/ads has shipped since LORAMER_PROJECT_3: users have
//      been seeing these composed names on the live surface all along; the warehouse now agrees with it.
//      A junk vendor name ("Ad 1") LOSES to a composition — junk identifies nothing.
//   2. THE VENDOR NAME WINS WHEN NO MATERIAL EXISTS — video/image/display-upload ads have no headlines to
//      compose from, and their vendor name (even an auto-generated one) is the only identity served.
//   3. '' ONLY WHEN NOTHING AT ALL IS SERVED — and the guard pins that a writer may not stamp '' when
//      material was present in the row it read.
// ⚠ NO industry-standard composition exists to diverge from — searched 2026-08-15: reporting tools (Looker
// Studio connectors etc.) surface headlines as separate dimensions rather than composing a name. The ' | '
// join is a HOUSE convention, chosen because it is what our own live surface already shows.

export type GoogleAdNameSource = {
  name?: string | null
  responsive_search_ad?: { headlines?: Array<{ text?: string | null }> | null; descriptions?: Array<{ text?: string | null }> | null } | null
  expanded_text_ad?: { headline_part1?: string | null; headline_part2?: string | null; description?: string | null } | null
}

export function composeGoogleAdName(ad: GoogleAdNameSource | null | undefined): string {
  if (!ad) return ''
  const rsa = (ad.responsive_search_ad?.headlines || []).map((h) => (h?.text || '').trim()).filter(Boolean)
  if (rsa.length > 0) return rsa.slice(0, 3).join(' | ')
  const eta = [ad.expanded_text_ad?.headline_part1, ad.expanded_text_ad?.headline_part2].map((s) => (s || '').trim()).filter(Boolean)
  if (eta.length > 0) return eta.join(' | ')
  return (ad.name || '').trim()
}
