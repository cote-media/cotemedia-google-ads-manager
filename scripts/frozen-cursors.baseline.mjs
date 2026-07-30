// LORAMER_FROZEN_CURSOR_DETECTOR_V1 — BASELINE (data, NOT a code exemption).
//
// Known, accepted FROZEN backfill cursors, recorded as EXACT (clientId, platform) pairs. Same shape-as-data idea as
// scripts/account-row-invariant.baseline.mjs and capture-surface.manifest.mjs's KNOWN_INCOMPLETE: the gate WARNS on
// what is already known and FAILS on anything NEW, so the first run does not drown the signal in today's backlog.
//
// ⛔ ANTI-ROT — THIS BASELINE CANNOT BECOME PERMANENT PERMISSION. An entry here that no longer matches a real frozen
// cursor FAILS the guard (it does not merely warn — deliberately STRICTER than the account-row baseline, where a
// stale entry warns). CONSEQUENCE, stated so it is never a surprise: when a frozen cursor is FIXED and starts
// advancing, `npm run check:data` FAILS until its entry is deleted from this file. That is the design. A baseline
// that survives its own justification is how "known issue" turns into "nobody looks any more", and this project has
// already paid for that lesson four times over ("a green check answers a narrower question than the reader assumes").
// Removing a cleared entry is a one-line docs-with-code edit in the same commit as the fix.
//
// MATCHING is on (clientId, platform) frozen-ness ONLY. `cursorAt` and `daysWhenBaselined` are RECORDED CONTEXT, not
// part of the match: a cursor that advances a few days and re-freezes is still the same known freeze, and pinning the
// date would turn every partial advance into a build failure. The check PRINTS a ⚠ MOVED / ⚠ WORSE note when the
// live values drift from what is recorded here, so drift is visible without being fatal.
//
// VERIFIED 2026-07-29 against the live DB (node scripts/check-frozen-cursors.mjs). Seven entries — the seven FROZEN
// cursors found by the ★RANGELAP-RATCHET-SWEEP. The sweep also found TWO ORPHANED cursors (Inside woocommerce_money
// / woocommerce_variant); they are NOT baselined here because ORPHANED is a separate, non-fatal bucket — baselining
// them would trip the anti-rot rule immediately, since they are by definition not in the FROZEN set.
export const KNOWN_FROZEN_CURSORS = [
  {
    clientId: '957d484e-d0c4-4dd0-b382-d8499d556252', client: 'Foam OH', platform: 'google_geo',
    cursorAt: '2026-04-09', daysWhenBaselined: 31,
    note: 'statement_timeout on 15,587-row single upsert; fix shipped 31f0dac (chunked writer), live lap still owed — QUEUE ★GOOGLE-GEO-STATEMENT-TIMEOUTS',
  },
  {
    clientId: '957d484e-d0c4-4dd0-b382-d8499d556252', client: 'Foam OH', platform: 'google_user_geo',
    cursorAt: '2026-04-09', daysWhenBaselined: 31,
    note: 'same root cause as google_geo above; same fix, same owed live lap',
  },
  {
    clientId: '4a7faf0a-25d7-4f91-b977-6a796ec13b8b', client: 'Inside', platform: 'google_geo',
    cursorAt: '2025-08-12', daysWhenBaselined: 31,
    note: 'same statement_timeout class (13,117-row slice measured); Inside is NOT on the golden list (deprioritised 2026-07-29)',
  },
  {
    clientId: '4a7faf0a-25d7-4f91-b977-6a796ec13b8b', client: 'Inside', platform: 'google_user_geo',
    cursorAt: '2025-08-12', daysWhenBaselined: 26,
    note: 'same class as the line above',
  },
  {
    clientId: 'f5fbe7e5-7b22-4a17-9681-6fab7fbeddb2', client: 'Veterinary mastermind', platform: 'google_geo',
    cursorAt: '2026-04-09', daysWhenBaselined: 29,
    note: 'THE PROOF THIS DETECTOR IS NEEDED — frozen 29 days with ZERO surviving Vercel error clusters (7-day retention). Loss confirmed by probe: geo_city/campaign 2026-03-15 = 0 rows.',
  },
  {
    clientId: 'f5fbe7e5-7b22-4a17-9681-6fab7fbeddb2', client: 'Veterinary mastermind', platform: 'google_user_geo',
    cursorAt: '2026-04-14', daysWhenBaselined: 26,
    note: 'same as the line above; no cluster survives for this one either',
  },
  {
    clientId: 'c39ee088-c635-4bfe-b308-43fe9640f1ca', client: 'The Escential Group', platform: 'meta_product_id',
    cursorAt: '2026-05-06', daysWhenBaselined: 7,
    note: 'ROOT CAUSE ALREADY FIXED (63c65ca dedupe + 37fce69 route; the 7 lost days were recovered). Expected to CLEAR on the next drain lap — when it does, this entry FAILS the guard and must be deleted. That is the anti-rot rule working, not a defect.',
  },
]

// ── NON-PRODUCTION FIXTURES — excluded from the sweep entirely, BY ID, each with its reason inline ───────────────
// ⛔ DO NOT REMOVE AN ENTRY WITHOUT READING ITS REASON. Every exclusion here is a client whose cursors CANNOT be
// expected to advance, so flagging it would be crying wolf — and a detector that cries wolf gets ignored, which is
// strictly worse than not having one.
export const EXCLUDED_FIXTURE_CLIENTS = [
  { clientId: 'a4b2bdd3-2f74-4119-9111-721999d8f5c7', name: 'Advar Test Store 1',
    why: 'non-production (Russ-confirmed); WooCommerce host unreachable, so no lap can ever advance. Its 5 woo cursors read backfill_complete=true anyway (DECISIONS ★ADVAR-NON-PRODUCTION).' },
  { clientId: 'efe036b4-c55c-4351-b834-7bc7ad30c740', name: 'LoraMer Demo',
    why: 'Shopify reviewer-token login fixture. ZERO metrics_daily rows and ZERO real cursors — nothing to freeze. LOAD-BEARING for the reviewer path, do NOT delete the client (QUEUE ★TEST-CLIENT-CLEANUP).' },
  { clientId: '6e5e441b-adc9-468b-bc8d-de8e4d5c7b71', name: 'Test 2',
    why: 'same owner as LoraMer Demo (shopify-reviewer@loramer.app), same reviewer hold. ZERO rows, ZERO real cursors.' },
  { clientId: 'd972202e-47d6-4ce7-8206-ae8bf305abbf', name: 'Reviewer Test Client',
    why: 'demo@loramer.com reviewer-era fixture. ZERO platform_connections, ZERO rows, ZERO real cursors.' },
  { clientId: 'bb9e2c31-fdc9-4aea-82a0-7e332647696f', name: 'Escential Group (SHELL)',
    why: 'Shopify install-flow leftover shell. ZERO rows, ZERO real cursors. ⚠ NOT the same client as c39ee088 "The Escential Group", which is REAL, golden-list, and baselined above — do not conflate them.' },
  { clientId: 'ddd3a3c7-8ae6-4ba8-b905-937f2940a006', name: 'Bertings Mech Store',
    why: 'Shopify install-flow fixture, no connections. ZERO rows, ZERO real cursors.' },
]

// ── DELIBERATELY *NOT* EXCLUDED, and why (recorded so nobody "completes the list" by adding them) ───────────────
// · 2fa78486 LoraMer Reviewer Demo — a demo by NAME, but it holds 595 live rows and a MOVING cursor, and Shopify's
//   ongoing reviewer obligation requires that path to keep showing real data. Muting it would make a freeze there
//   silent, which is the one failure mode with an external consequence. If it ever goes noisy, baseline the specific
//   cursor — do not exclude the client.
// · 2617b163 Influential Drones — the demo@loramer.com FIXTURE (see src/lib/clients/canonical.ts; an earlier
//   revision of this note claimed the opposite and it was WRONG). It holds ~387k REAL Ads rows because it points at
//   the SAME vendor accounts — google 3699173394, meta act_584246708329858 — but it has no ga and no shopify
//   connection and has never held a single shopify or ga row.
//   5bb9b2ff (cotebrandmarketing@gmail.com) is the real one of that name: four healthy connections, 726,264 rows,
//   and the 2019-04-13..2026-07-28 shopify history. Two clients, one name — resolve by ID, never by name.
//   Not excluded anyway: its 8 Meta cursors all last advanced 2026-07-23, the day its Meta connection went
//   health='reconnect' with last_error_code oauth_190, and they cross this threshold on 2026-07-30. That is a TRUE
//   POSITIVE the detector should fire on (the fix is a deliberate demo@ re-auth, and demo@ is load-bearing for the
//   pending Google Tool Change Form), not noise to be muted.
