// LORAMER_CANONICAL_CLIENT_REGISTRY_V1 — the single source of truth for CLIENT IDENTITY.
//
// ⛔ A CLIENT NAME IS NOT AN IDENTIFIER. Two clients in this database are both named "Influential Drones" and two
// are "Escential Group" / "The Escential Group". One of each pair is the real cohort client and the other is a
// fixture, and NOTHING about the name tells you which. The discriminator is the OWNER EMAIL, and it is the field
// that gets skipped.
//
// ── WHY THIS FILE EXISTS: THE SAME MISTAKE, TWICE IN ONE DAY (2026-07-29) ───────────────────────────────────────
//  (1) The ★META-PRODUCT-ID-ROUTE recon mis-stated its own premise — "we hold zero product_id rows" — from a stale
//      QUEUE entry. The writer already existed and had written 69,676 rows across five clients.
//  (2) scripts/frozen-cursors.baseline.mjs asserted that 2617b163 was "NOT a fixture. Real client, richest Shopify
//      history in the fleet." It holds ZERO shopify rows and has no shopify connection. The reasoning was: real
//      387k-row client + familiar name + a remembered fact about Shopify volume. The owner email — the only field
//      that separates the two — was never read.
// DECISIONS ALREADY WARNS ABOUT THIS IN PROSE (the DUPLICATE CLIENT-NAME TRAP), AND THAT PROSE WAS READ THIS
// SESSION. It did not prevent (2). That is the whole point of ★EVAL-BIND and FIX-WITH-GUARD, cited and not
// re-derived: PROSE IN A DOC IS NOT A GUARD, AND A RULE YOU CANNOT FAIL IS A WISH. So the rule now lives in code
// with a guard that fails — tests/guards/canonical-client-identity.guard.mjs.
//
//  (3) 2026-08-23 — THE SAME ROW, THE OPPOSITE DIRECTION, AND THIS FILE DID NOT STOP IT EITHER. An ad-hoc
//      cross-check queried 2617b163 for SHOPIFY data three times and reported "Influential Drones has zero
//      captured rows for 2024 and none for 2025" as a real finding. It holds zero Shopify rows because it is
//      the fixture; the cohort client 5bb9b2ff holds 366 day rows in 2024 alone, and the cross-check the
//      finding said was impossible passes exactly (236 orders / $749,881.58 on both sides). The wrong UUID was
//      hardcoded, lifted from an adjacent round where 2617b163 was legitimately in view.
//      ⛔ WHY (1)/(2)'s FIX DID NOT REACH (3), AND IT IS THE USEFUL PART: entries (1) and (2) were made in
//      COMMITTED FILES, where a build guard can see them. (3) was made in an AD-HOC DATABASE QUERY that never
//      touched the filesystem — no commit, no build, nothing for a guard to read. resolveClientById() sat right
//      here, unused, because nothing calls it from a query typed at the point of use.
//      ⇒ THE ENFORCER FOR THAT SURFACE IS NOT A BUILD GUARD: scripts/fixture-query-gate.mjs runs as a
//      PreToolUse hook on the Supabase MCP tools and names the fixture AT THE MOMENT THE QUERY IS ISSUED.
//      ⚠ ITS HONEST LIMIT: it INFORMS, it does not prevent, and it only knows the ids registered BELOW — a
//      wrong UUID for an unregistered client is invisible to it. See DECISIONS
//      LORAMER_FIXTURE_ROW_MEASURED_AS_REAL_V1.
//
// ── EVERY FACT BELOW WAS READ FROM THE LIVE DB ON 2026-07-29, NOT FROM ANY DOC ──────────────────────────────────
// Sources: clients, platform_connections, and per-platform count/min/max over metrics_daily. Where a banked doc
// disagrees, the doc is stale and gets its own correction — this file does not inherit doc claims.
//
// ── HOW TO USE IT ───────────────────────────────────────────────────────────────────────────────────────────────
// resolveClientById(id)   → the entry, or null when the id is not a known-ambiguous client.
// resolveClientByName(nm) → THROWS AmbiguousClientNameError when the name matches more than one entry. It does not
//                           pick one, does not prefer the cohort, does not warn-and-continue. Silently choosing is
//                           exactly the failure this file exists to make impossible.

export type CanonicalRole = 'cohort' | 'fixture' | 'non-production'

/** Which platforms this client HOLDS metrics_daily ROWS for (not which it has a connection row for — those differ,
 *  and the difference is what made the 2026-07-29 mistake sound plausible). Verified per-platform on 2026-07-29. */
export interface CanonicalPlatforms {
  ga: boolean
  google: boolean
  meta: boolean
  shopify: boolean
  woocommerce: boolean
}

export interface CanonicalClient {
  id: string
  name: string
  /** clients.user_email — THE discriminator when names collide. */
  owner: string
  role: CanonicalRole
  platforms: CanonicalPlatforms
  /** One line, verified, sufficient to tell this client from its twin. */
  reason: string
}

const P = (over: Partial<CanonicalPlatforms>): CanonicalPlatforms =>
  ({ ga: false, google: false, meta: false, shopify: false, woocommerce: false, ...over })

// ⚠ ENTRIES ARE ADDED ONLY FROM A LIVE DB READ. Adding one from a doc, a memory, or another entry's wording is the
// precise mechanism of both failures above. The guard verifies every id and owner against the DB, so a guessed
// entry fails rather than propagating.
//
// ⛔ THE FOUR ROWS THIS FILE RECORDED AS UNREGISTERED ON 2026-08-23 ARE NOW REGISTERED, AND HOW EACH ROLE WAS
// SETTLED IS PART OF THE ENTRY. Three of them were resolved by TRACING A SIGN-IN PATH IN CODE, not by reading the
// doc that already asserted an answer: QUEUE ★TEST-CLIENT-CLEANUP calls Bertings a "Shopify review fixture", and
// that sentence is deliberately NOT the basis for its role here — a doc's assertion is what produced failures (1)
// and (2) above. The basis is a live shopify_installs mapping plus the callback that reuses it.
// ⛔ AND "UNREGISTERED" STILL CARRIES NO MEANING IN CODE. Nothing here or downstream may read absence from this
// list as either cohort or fixture; the fixture-query gate keys on the ids that ARE here and is silent about
// everything else. Giving absence a default is a design decision and it has not been made.

export const CANONICAL_CLIENTS: CanonicalClient[] = [
  // ══ COLLISION 1: "Influential Drones" × 2 ══
  {
    id: '5bb9b2ff-a1df-4d46-ac6b-0471ef543e15',
    name: 'Influential Drones',
    owner: 'cotebrandmarketing@gmail.com',
    role: 'cohort',
    platforms: P({ ga: true, google: true, meta: true, shopify: true }),
    reason: 'THE REAL ONE. Four healthy connections (ga/google/meta/shopify), 726,264 rows, all current to 2026-07-28; shopify 16,350 rows spanning 2019-04-13..2026-07-28.',
  },
  {
    id: '2617b163-f392-427e-9a29-f134acc51406',
    name: 'Influential Drones',
    owner: 'demo@loramer.com',
    role: 'fixture',
    platforms: P({ google: true, meta: true }),
    reason: 'THE DEMO TWIN. Ads only — no ga connection, no shopify connection, and ZERO shopify and ga rows ever. Holds ~387k real Ads rows because it points at the SAME vendor accounts as 5bb9b2ff (google 3699173394, meta act_584246708329858), which is what makes it look real. Its meta connection reads health=reconnect / oauth_190 since 2026-07-23. demo@ is load-bearing for the pending Google Tool Change Form — this is not a deletion candidate.',
  },

  // ══ COLLISION 2: "Escential Group" vs "The Escential Group" — differ only by a leading article ══
  {
    id: 'c39ee088-c635-4bfe-b308-43fe9640f1ca',
    name: 'The Escential Group',
    owner: 'cotebrandmarketing@gmail.com',
    role: 'cohort',
    platforms: P({ ga: true, google: true, meta: true, shopify: true }),
    reason: 'THE REAL ONE, golden list. Four healthy connections, 4,036,434 rows; shopify 1,194 rows. This is the client whose meta_product_id days were recovered on 2026-07-29.',
  },
  {
    id: 'bb9e2c31-fdc9-4aea-82a0-7e332647696f',
    name: 'Escential Group',
    owner: 'shopify+k9tpib-st@loramer.app',
    role: 'fixture',
    platforms: P({}),
    reason: 'Shopify install-flow leftover SHELL. One shopify connection reading health=degraded, ZERO metrics_daily rows of any platform, ZERO backfill cursors.',
  },

  // ══ PREFIX FAMILY: "LoraMer" / "LoraMer Demo" / "LoraMer Reviewer Demo" ══
  // Not an article-or-case collision, so resolveClientByName() can separate them — they are registered because they
  // are CONFUSABLE TO A READER and each has a role that code has already asserted. A prior roster audit did conflate
  // them.
  {
    id: 'e392d94c-9bfa-47bd-bab8-5034b2c871b8',
    name: 'LoraMer',
    owner: 'cotebrandmarketing@gmail.com',
    role: 'fixture',
    platforms: P({ shopify: true }),
    reason: "LoraMer's OWN shopify store card, not an agency client. One healthy shopify connection, 143 rows, shopify only.",
  },
  {
    id: 'efe036b4-c55c-4351-b834-7bc7ad30c740',
    name: 'LoraMer Demo',
    owner: 'shopify-reviewer@loramer.app',
    role: 'fixture',
    platforms: P({}),
    reason: 'ZERO metrics_daily rows, shopify connection health=degraded. LOAD-BEARING regardless: its owner shopify-reviewer@loramer.app IS the reviewer-token login provider identity, so do not delete the client.',
  },
  {
    id: '2fa78486-ad8a-40ef-aa1f-44ddd2fa6292',
    name: 'LoraMer Reviewer Demo',
    owner: 'shopify+loramer-reviewer-demo@loramer.app',
    role: 'fixture',
    platforms: P({ shopify: true }),
    reason: 'The reviewer-demo store with LIVE data — one healthy shopify connection, 595 rows. A fixture by role, but the only one whose staleness has an external consequence, so it is NOT muted in the frozen-cursor sweep.',
  },

  // ══ NOT NAME-AMBIGUOUS, registered to BIND A ROLE that code already asserts ══
  {
    id: 'a4b2bdd3-2f74-4119-9111-721999d8f5c7',
    name: 'Advar Test Store 1',
    owner: 'cotebrandmarketing@gmail.com',
    role: 'non-production',
    // ⚠ shopify:true was NOT obvious and I first wrote it false, reasoning from the name and the WooCommerce story.
    // The --db check (assertion D) caught it: 143 shopify rows (2026-05-23..2026-07-28) alongside 57 woocommerce rows
    // (2026-06-02..2026-07-28). A flag inferred from a client's NAME is the same mistake in miniature as resolving a
    // client by name — recorded here rather than quietly fixed.
    platforms: P({ shopify: true, woocommerce: true }),
    reason: 'Non-production (Russ-confirmed). WooCommerce host unreachable, so no woo backfill lap can ever advance; its woo cursors read backfill_complete=true. Holds 143 shopify + 57 woocommerce rows from install testing. Registered so the role claim in scripts/frozen-cursors.baseline.mjs is checkable.',
  },

  // ══ THE INSTALL-EMAIL FAMILY — every one of these wears `shopify+<shop>@loramer.app`, and THAT IS WHY THEY ARE
  //    HERE. src/app/api/shopify/callback/route.ts:157 mints that address for EVERY App Store install, real
  //    merchants included, so the email says HOW a row arrived and NOTHING about what it is. Registered 2026-08-23
  //    (roles traced, not inferred) so no future reader has to guess from the address. ══
  {
    id: '212dcb43-5f9b-4bcf-bafb-8c2f6af3ed4a',
    name: 'Cozy Foam Factory',
    owner: 'shopify+cozy-sack@loramer.app',
    role: 'cohort',
    platforms: P({ shopify: true }),
    // ⛔ THE ENTRY THIS FILE'S OWN HEADER PREDICTED: A REAL CLIENT WEARING THE INSTALL-FIXTURE EMAIL. Inferring
    // 'fixture' from `shopify+cozy-sack@loramer.app` would be failure (2) with a different field, and the pattern
    // was formally disqualified as a classification key on 2026-08-23. Its presence here is the thing that stops
    // the next reader making that inference.
    reason: 'REAL CLIENT — Russ-confirmed 2026-08-23, and the live DB corroborates independently: 27,246 shopify rows spanning 2016-05-01..2026-08-22, 1,757 account orders / $340,109.00, one HEALTHY shopify connection to cozy-sack.myshopify.com. Arrived through the App Store install flow (shopify_installs row 2026-07-12), which is why it carries an install email and why that email means nothing about its role.',
  },
  {
    id: 'ddd3a3c7-8ae6-4ba8-b905-937f2940a006',
    name: 'Bertings Mech Store',
    owner: 'shopify+dphutk-fs@loramer.app',
    role: 'fixture',
    platforms: P({}),
    // REACHABLE ⇒ FIXTURE, and the reach is a traced code path rather than a label: a LIVE shopify_installs row
    // (dphutk-fs.myshopify.com → this email → this client, 2026-05-26) means callback/route.ts:162-169 REUSES this
    // exact client on any re-install, signs the installer in via auth.ts's 'shopify-install' provider, and
    // /api/clients/route.ts:16 then renders this row as their client list. Marking it 'non-production' would
    // assert nothing can reach it, and something can.
    reason: 'Shopify install-flow client with ZERO connections and ZERO metrics_daily rows of any platform, yet REACHABLE: shopify_installs still maps dphutk-fs.myshopify.com to it, so a re-install of that store resurfaces this exact client row for whoever installs. Treated as load-bearing for that reason alone. ⚠ QUEUE ★TEST-CLIENT-CLEANUP calls it a "Shopify review fixture"; that doc sentence is NOT the basis for this role — the install mapping and the callback are.',
  },
  {
    id: 'd972202e-47d6-4ce7-8206-ae8bf305abbf',
    name: 'Reviewer Test Client',
    owner: 'demo@loramer.com',
    role: 'fixture',
    platforms: P({}),
    // LOAD-BEARING UNDER AN OPEN EXTERNAL REVIEW. demo@loramer.com is pinned in legacy-cohort.ts:9, so it lands on
    // the legacy surface, and /api/clients/route.ts:16 scopes by owner email — this row IS one of the cards the
    // submitted Meta screencast promises ("Land on /clients (show the client cards)" … "On the target client card
    // … click '+ Meta'", docs/META_APP_REVIEW_ANSWERS.md:177-179). An EMPTY client is exactly what a connect-flow
    // demonstration needs.
    reason: 'Meta/Google reviewer workspace fixture. ZERO connections, ZERO metrics_daily rows — deliberately empty: it is the card the submitted Meta review screencast connects a Meta ad account TO. CONTINUE_HERE carries the standing instruction "keep the Reviewer Test Client card until review closes", and Meta requires reviewer credentials to stay valid for ONE YEAR after submission. Do not delete while that review is open.',
  },
  {
    id: '6e5e441b-adc9-468b-bc8d-de8e4d5c7b71',
    name: 'Test 2',
    owner: 'shopify-reviewer@loramer.app',
    role: 'fixture',
    platforms: P({}),
    // ⛔ THIS ROW IS ON A SHOPIFY REVIEWER'S SCREEN TODAY. Its owner IS the reviewer-token login identity
    // (auth.ts:37 returns exactly this email), pinned by legacy-cohort.ts:9 and honoured by both middleware.ts and
    // preview-gate.ts. /api/clients/route.ts:16 scopes by owner email, and a live DB read confirms that identity
    // owns EXACTLY TWO clients — efe036b4 and this one. Whatever a reviewer sees, this is half of it.
    reason: 'Shopify reviewer-login fixture, and one of only TWO clients that login can see (the other is efe036b4). ZERO connections, ZERO metrics_daily rows — the measured reason a reviewer signing in today sees an app with no data. DECISIONS records the ONGOING Shopify obligation that submitted reviewer credentials stay valid and grant full access to the complete feature set, and that it does NOT end at approval. Never delete.',
  },
]

/** Thrown, never swallowed. A caller that cannot tell two clients apart must stop, not guess. */
export class AmbiguousClientNameError extends Error {
  readonly candidates: CanonicalClient[]
  constructor(name: string, candidates: CanonicalClient[]) {
    super(
      `Client name "${name}" is AMBIGUOUS — ${candidates.length} clients share it. Resolve by ID, never by name.\n` +
        candidates.map((c) => `  ${c.id}  ${c.owner.padEnd(42)} ${c.role}  ${c.reason}`).join('\n'),
    )
    this.name = 'AmbiguousClientNameError'
    this.candidates = candidates
  }
}

// Case-insensitive, whitespace-collapsed, leading-article-stripped. "The Escential Group" and "Escential Group"
// normalise to the same key ON PURPOSE — they are two different clients whose names differ only by "The", which is
// exactly the pair a human or a model will conflate, so a lookup by either form must be treated as ambiguous.
export function normalizeClientName(name: string): string {
  return name.trim().replace(/\s+/g, ' ').replace(/^(the|a|an)\s+/i, '').toLowerCase()
}

export function resolveClientById(id: string): CanonicalClient | null {
  return CANONICAL_CLIENTS.find((c) => c.id === id) ?? null
}

/**
 * Resolve a known-ambiguous client by name.
 * @returns the single matching entry, or null when the name matches no registry entry (i.e. it is not a name this
 *          registry has anything to say about — resolve it however the caller normally would).
 * @throws  AmbiguousClientNameError when more than one entry matches. NEVER returns a "best" match.
 */
export function resolveClientByName(name: string): CanonicalClient | null {
  const key = normalizeClientName(name)
  const hits = CANONICAL_CLIENTS.filter((c) => normalizeClientName(c.name) === key)
  if (hits.length > 1) throw new AmbiguousClientNameError(name, hits)
  return hits[0] ?? null
}

/** Every normalised name that maps to more than one registry entry. Used by the guard, and by anything that wants to
 *  warn a human before they type a name into a query. */
export function ambiguousClientNames(): string[] {
  const seen = new Map<string, number>()
  for (const c of CANONICAL_CLIENTS) {
    const k = normalizeClientName(c.name)
    seen.set(k, (seen.get(k) ?? 0) + 1)
  }
  return [...seen.entries()].filter(([, n]) => n > 1).map(([k]) => k).sort()
}
