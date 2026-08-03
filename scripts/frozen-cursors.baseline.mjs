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
//
// ── 2026-07-30 · THE EIGHT 2617b163 META CURSORS, baselined as ONE SET behind ONE named root cause ──────────────
// ⛔ DO NOT DELETE THESE EIGHT BLIND, AND DO NOT DELETE THEM ONE AT A TIME. Every clause below is load-bearing.
// · 2617b163 is the demo@loramer.com FIXTURE (registry role=fixture, src/lib/clients/canonical.ts); the canonical cohort client of that name is 5bb9b2ff, cotebrandmarketing@gmail.com.
// · ROOT CAUSE IS NAMED, which is the whole basis for baselining: oauth_190 on its meta platform_connection —
//   health=reconnect, last_ok_at 2026-07-23 08:11:28Z, the SAME day all eight cursors last advanced (18:18Z).
//   An invalidated token CANNOT self-heal, so the drain will never move these no matter how many times it fires.
// · BASELINED RATHER THAN FIXED BY DECISION, NOT BY OVERSIGHT: no external consequence exists. Meta App Review was
//   APPROVED 2026-07-02, so there is no reviewer path, no reviewer surface and no reviewer-driven hold on this
//   fixture, and its meta data serves no purpose that anything real depends on.
// · NOT EXCLUDED BY ID, DELIBERATELY — 2617b163 is load-bearing for the pending Google Tool Change Form and its
//   google connection is healthy, so excluding the client would mute a future GOOGLE freeze on it. Baselining the
//   eight specific meta cursors mutes exactly what is explained and nothing else.
// · TO CLEAR: re-auth demo@'s Meta. The moment those cursors move, the anti-rot rule makes check:data FAIL until
//   these eight entries are deleted. THAT IS THE INTENDED EXIT PATH, not a bug — it is what stops this set from
//   quietly outliving its own reason.
const DEMO_FIXTURE_OAUTH190_NOTE = 'demo@loramer.com FIXTURE (src/lib/clients/canonical.ts, role=fixture); frozen 2026-07-23 18:18Z behind oauth_190 on its meta connection, which cannot self-heal. Baselined by decision, not oversight — the block above the array carries the full reasoning, incl. why it is neither re-authed nor excluded by id. Clears by re-authing demo@ Meta; anti-rot then fails until these eight are deleted.'

// One shared reason, eight cursors — written as a mapped set rather than eight copies so the reason cannot drift
// between them. Cursor dates read live 2026-07-30; all eight sat at 7 days when baselined.
const DEMO_FIXTURE_FROZEN_2026_07_23 = [
  ['meta_action_type', '2023-08-15'],
  ['meta_asset', '2026-05-02'],
  ['meta_attribution_window', '2026-03-21'],
  ['meta_comscore_market', '2026-04-21'],
  ['meta_geo', '2024-08-20'],
  ['meta_hour', '2025-03-25'],
  ['meta_placement_adset_ad', '2025-03-26'],
  ['meta_product_id', '2026-04-21'],
].map(([platform, cursorAt]) => ({
  clientId: '2617b163-f392-427e-9a29-f134acc51406',
  client: 'Influential Drones (demo fixture)',
  platform,
  cursorAt,
  daysWhenBaselined: 7,
  note: DEMO_FIXTURE_OAUTH190_NOTE,
}))

export const KNOWN_FROZEN_CURSORS = [
  // ✅ DELETED 2026-08-03 — ALL SIX GOOGLE GEO ENTRIES (Foam OH, Inside, Veterinary mastermind × google_geo +
  // google_user_geo). THE ANTI-ROT RULE DOING ITS JOB, at six times the previous scale: a baseline may not outlive
  // its justification, and every one of these said "live lap still owed" in its own note. The lap has now happened
  // repeatedly on every one of them.
  // ⛔ VERIFIED AGAINST THE LIVE sync_state ROWS BEFORE REMOVAL, not inferred from the guard's complaint — the guard
  // says "no longer frozen", which is ALSO what a deleted client or a removed connection looks like, so the cursors
  // themselves had to be read. Same discipline as the 2026-07-30 removal below. READ 2026-08-03 ~01:20Z, every one
  // written by the 00:20Z drain fire, all backfill_blocked=false / block_fails=0 / backfill_complete=false:
  //   Foam OH        google_geo      2026-04-09 -> 2025-12-10   written 00:32:36Z
  //   Foam OH        google_user_geo 2026-04-09 -> 2026-01-19   written 00:46:23Z
  //   Inside         google_geo      2025-08-12 -> 2025-01-24   written 00:21:03Z
  //   Inside         google_user_geo 2025-08-12 -> 2025-01-24   written 00:21:43Z
  //   Vet mastermind google_geo      2026-04-09 -> 2025-09-21   written 00:21:08Z
  //   Vet mastermind google_user_geo 2026-04-14 -> 2025-09-26   written 00:21:53Z
  // WHAT UNSTUCK THEM, named so the removal is not mistaken for the defect having been benign:
  // LORAMER_DRAIN_EXTENDED_DURATION_V1 (maxDuration 800 -> 1800) freed Inside and Veterinary, and
  // LORAMER_DRAIN_FAIR_SHARE_STEP_ORDER_V1 (7f5a2ed) freed Foam OH, whose block was step-order STARVATION under a
  // shared per-fire budget rather than the statement timeout these notes originally blamed.
  // ⛔ THE VALUES ABOVE ARE A TENSE-LOCKED RECORD OF ONE MOMENT, NOT CURRENT STATE. Re-read sync_state; never trust
  // a cursor position written into a file (LORAMER_DOCS_NEVER_RESTATE_LIVE_STATE_V1).
  // ✅ DELETED 2026-07-30 — The Escential Group (c39ee088) meta_product_id. The entry that stood here PREDICTED its
  // own removal in writing ("Expected to CLEAR on the next drain lap — when it does, this entry FAILS the guard and
  // must be deleted"), and that is exactly what happened: the cursor MOVED from the baselined 2026-05-06 to
  // 2026-04-21, updated_at 2026-07-30 06:17:44Z (~7h old, far inside the 7-day threshold). VERIFIED against the live
  // sync_state row before removal, not inferred from the guard's complaint — the guard says "no longer frozen", which
  // is also what a deleted client would look like, so the cursor itself had to be read. The dedupe fix
  // (LORAMER_META_BREAKDOWN_DEDUPE_V1) + the direct route unstuck the family and rangeLap is walking it backward
  // again. This is the anti-rot rule doing its job: a baseline may not outlive its justification.
  ...DEMO_FIXTURE_FROZEN_2026_07_23,
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
