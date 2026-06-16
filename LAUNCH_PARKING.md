# LoraMer — Launch Parking Lot

Issues flagged during the App Store submission push but NOT addressed in-the-moment.
Three buckets, in priority order.

---

## 🔴 BLOCKER — must fix before submitting

*(none — all blockers resolved; app approved & live May 26, 2026)*

---

## 🔴 PRE-LAUNCH VERIFICATION MATRIX — onboarding identity shapes (LORAMER_ONBOARDING_IDENTITY_MATRIX_V1, 2026-06-10)

The Google account-listing path has been MCC-only since the initial commit (`listAccessibleAccounts` queries `customer_client` under `login_customer_id = GOOGLE_ADS_MANAGER_ACCOUNT_ID`; there is no `ListAccessibleCustomers` path). The "business owner with direct admin on a single Ads account and NO MCC access" shape was assumed away from day one and never walked by a real identity — it surfaced 2026-06-10 when demo@loramer.com (direct admin on Influential Drones, no MCC access) got an empty picker. Before the July cohort, every onboarding identity SHAPE the product claims to support must be walked by a REAL identity of that shape and prove: picker/mapper lists the account → connect → dashboard shows live data. Treat the business-owner path as FIRST-CLASS, not an edge case.

Run all three before launch (✅ when a real identity of that shape passes end-to-end):
- [ ] (a) **MCC agency identity** — a Google identity with access to our Manager (MCC) account. Connect a client via the picker AND the "Set Up Clients" mapper; confirm live Google data loads. (This is the founder's own shape — historically the ONLY shape tested.)
- [ ] (b) **Direct-grant single-account business owner** — a Google identity with direct admin on ONE Ads account and NO MCC access. **demo@loramer.com is our permanent test fixture for this shape.** Currently FAILS (empty picker). Root cause CONFIRMED 2026-06-10 = Cause B (MCC-only listing), NOT an env problem: the nightly cron is healthy (Google rows current through 2026-06-09), which proves `GOOGLE_ADS_MANAGER_ACCOUNT_ID` is live at runtime (the `vercel env pull` 0-char read was a pull artifact — Lesson 45). Fix = add a `CustomerService.ListAccessibleCustomers` path so direct-grant identities are enumerated (queued, ROADMAP Pre-launch). Tonight's demo workaround: grant demo@ READ-ONLY MCC access + link the demo account under the MCC. Must pass before onboarding any direct-grant business owner.
- [ ] (c) **Two LoraMer users, same Ads account** — two different LoraMer user_emails each assign the SAME Ads account to their own client. Both must succeed independently (the "unassigned" filter is per-user, so this should already hold) and load data for both — verify, don't assume.

---

## 🔴 HARD GATE — live-store Woo backfill prerequisites (LORAMER_WOO_BACKFILL_CLAIM_V1, 2026-06-16)

**✅ BUILT + PROVEN 2026-06-16 (LORAMER_WOO_BACKFILL_ATOMIC_BREAKER_V1, migrations 013+014) — the safety mechanism now EXISTS and is verified.** All four prerequisites implemented; pure de-escalation test 9/9; graceful-200/zero-5xx proven; and the CONSECUTIVE breaker-accumulation + no-op-when-blocked e2e now PASSES (mock-only, throwaway client, ZERO live-store contact): block_fails accumulated 0→1→2 ACROSS invocations and tripped; the blocked-gate no-op did ZERO outbound store fetches; ?unblock cleared + allowed exactly one retry. The earlier "verification PARTIAL / infra-blocked (PostgREST schema cache)" note was a MISDIAGNOSIS — real root cause was Next.js App Router fetch-caching dropping the deterministic breaker write (fixed with force-no-store; see Lesson 52). Running an ACTUAL live-store Woo backfill remains a deliberate, separate go (Shelley's 2016–2018 tail stays deferred). (Incident background: Lesson 51.)
- [x] (1) **Circuit-breaker (caller-proof, persisted)**: blocked-window state on the cursor; a blocked backfill no-ops with ZERO outbound, checked BEFORE the claim/any store call — no caller can re-hammer. Trips after N=2 consecutive per-day-floor failures.
- [x] (2) **Graceful route status**: store-side failure → 200 {status:'halted'/'blocked'} (no 5xx/alert); only genuine infra errors stay 5xx.
- [x] (3) **Gentle-on-live-store + adaptive sub-chunking**: 300ms throttle (pages + windows), de-escalate 21→7→1 on error (lighter queries, slips under a slow host), MAX_OUTBOUND_FETCHES=500 backstop, CAS claim guards concurrency.
- [x] (4) **Resume from true frontier**: `before` re-walk override REMOVED; resume purely from the persisted cursor (monotonic). UNBLOCK via CRON_SECRET ?unblock=true after a store is fixed.
GROUP with the cohort Woo-onboarding gate: the forward Woo status+refund accuracy fix is already SHIPPED (LORAMER_WOO_STATUS_ACCURACY_V1 — sale-only {completed,processing,refunded} + net), so forward capture is safe; this gate covers the HISTORICAL backfill path specifically.
CURRENT STATE: Shelley Kyle backfill captured 2018-12-13 → 2026-06-15 (~7.5yr, verified). Deep tail 2016-10 → 2018-12 DEFERRED (blocked by her host's PHP-fatal/500 on the heavy 2018-11-22..12-12 window). Cursor reconciled to 2018-12-13, NOT marked complete. No Woo backfill cron exists and the UI trigger (Phase 2b) is unbuilt/frozen → nothing auto-resumes against her store. To finish the tail later: adaptive sub-chunking (split a 500'd window to per-day to slip under her host's memory limit) UNDER this gate's controls — or confirm genuine store-side corruption and accept ~7.5yr.

**PHASE-2b WIRING GATE:** when the Woo backfill is wired into the generic `/api/backfill/run` path, that route MUST carry `force-no-store` (Lesson 52) AND route Woo through the breaker-protected `woocommerce-backfill` engine — NEVER a raw re-walk. Woo = the fragile self-hosted class (see LORAMER_HANDOFF.md → LIVE-SOURCE PRINCIPLE).

**PRE-LAUNCH AUDIT (light, managed-API hygiene):** confirm the Google Ads / Meta / Shopify / GA adapters back off cleanly on HTTP 429 and don't burst (these are the robust MANAGED class — overload = clean 429/backoff, not a customer outage — so standard rate-limit hygiene is sufficient here).

## 🟡 POST-META-APPROVAL UI BATCH — backfill completeness semantics + Woo Phase 2b trigger (reviewer-path UI, FROZEN until the Meta decision)

Ship together in the post-Meta-approval UI batch (all touch reviewer-path shared UI; bundle with the Meta breakdowns/completeness-label item, AUDIT_FINDINGS #4):
- [ ] **Step 1 — read-only investigation**: the backfill "complete" predicate across platforms + Shelley's Meta cursor state; document where "complete" is computed/surfaced and what it currently means.
- [ ] **Step 2 — completeness-semantics fix (platform-general)**: "complete" should mean "reached the max RETRIEVABLE history" (not a fixed floor); surface the first-activity date; show "Resume" ONLY when genuinely incomplete. Avoid implying a store has no older data when the source simply won't serve it.
- [ ] **Step 3 — Woo Phase 2b UI trigger**: run-backfill Woo branch + BackfillControl mount on the Woo connection row (gated behind the HARD GATE above for live stores).
Reason parked: reviewer-path shared UI is frozen until the Meta decision; these change what the reviewer sees.

---

## ✅ Resolved

### "This month" date range blank tiles on Shopify tab — FIXED (LORAMER_THIS_MONTH_FIX_V1)
Both `shopify-intelligence.ts` and `shopify/daily/route.ts` now map `THIS_MONTH` to `new Date().getDate()` (back to the 1st of the current month), matching `woocommerce-intelligence`. Verified in code May 28, 2026. The two endpoints previously disagreed on the window, leaving metric tiles blank; they are now unified.

---

## 🟡 PRE-LAUNCH-NICE — improves re ship if time permits

### Client row UX — no obvious expand control
The only ways to expand a client profile section are: (1) click the Claude pill, or (2) click the row of a client with zero connections. Once any platform is connected, the row click goes to the dashboard and there's no visible affordance to access disconnect controls, Claude profile editing, or document upload. Should add an explicit Manage / chevron / settings button on every row.

---

## 🟢 POST-LAUNCH — real issue, can iterate

### "Return Rate" field is mislabeled
The Shopify tab "Return Rate" tile computes `returningCustomers / totalOrders * 100`. That's the percentage of orders from returning customers, NOT the percentage of returned/refunded products (which is what "return rate" means in e-commerce). Should either rename to "Returning Customer %" or actually compute refund-rate from the orders' financial_status field.

### Customer segmentation produces strange numbers on dev stores
On dev stores where Bogus Gateway is the oyment method, all test orders attach to the same test customer, producing "100% returning customers / 0 new customers." This is a dev store artifact, not a code bug, but reviewers will see it. Logging in case it warrants a synthetic data approach for the reviewer demo store.

### Left nav information architecture needs a rethink
Sidebar nav was designed when LoraMer was ads-only — Overview / Campaigns / Keywords / Ask Claude. Now ecomm is in (Shopify, WooCommerce) and the roadmap includes Klaviyo, GA, Microsoft, TikTok, Amazon, LinkedIn. The current per-platform-tab pattern does not scale to 10+ integrations — the sidebar would become a long platform list. Question: should the nav be reorganized around function (Performance / Revenue / Audience / Ask) rather than platform? Or hybrid? Worth a focused thinking session before adding any more platform tabs.

### Welcome page "Let's go" button has a hydration delay
After landing on /welcome, clicking "Let's go" sometimes does nothing for a brief moment, then works on subsequent click. Likely React hydration completing async. Not blocking submit but creates a "is this broken?" moment for first-time users. Add a loading skeleton or disable the button until hydration finishes.
### Meta audience targeting data appearing in Claude responses (LORAMER_PARKING_META_AUDIENCE_NOTE_V1)
During Step 2c (Google audience segments) verification on The Escential Group, Claude surfaced specific Meta ad set targeting details — "Ages 18-65 + Crafts/Handicraft interests + FB/IG Engaged (365) + 1% LAL" — in its response. Step 2c only modified `google-intelligence.ts`; no Meta adapter changes. Investigate where Meta targeting spec is being exposed in the existing intelligence flow. Two theories: (a) `meta-intelligence.ts` already collects targeting spec on ad sets, and Claude correctly reasoned from it — in which case 2c is benefiting from work already done; or (b) Claude inferred from ad set names + memory + prior conversation context — in which case the surfaced "audience" data may not be reliable. Important either way: if (a), we have a leg up on Step 5 (Meta Tier 1 targeting spec) and may be able to skip that piece. If (b), we should not trust audience attribution claims on Meta until 2c-equivalent is properly built. Verify by reading `meta-intelligence.ts` end-to-end and comparing what Claude received in the prompt vs. what it reported.
### ✅ RESOLVED (May 28, 2026) — PMax asset-level: combinations shipped, per-asset labels confirmed UI-only (LORAMER_PARKING_END_OF_MAY26_V1)
**Resolution (LORAMER_PARKING_STEP2G_RESOLVED_V1):** Validator-confirmed `asset_group_asset.performance_label` is NOT selectable in v23 — per-asset BEST/GOOD/LOW labels are UI-only, not an API bug. The real asset-level signal is `asset_group_top_combination_view` (Google's Combinations report), which IS valid. Step 2g shipped: combinations query (date-filtered, instrumented .catch) joined to readable asset text via `asset_group_asset.asset`; dead `performance_label` read removed; prompt rewritten to stop implying labels exist. ORIGINAL NOTE BELOW (kept for history):
Project 3 Step 2f shipped successfully — asset GROUPS render correctly (Asset Group 1 with metrics, 5/10 Ad Strength, $306.04 spend etc.) but individual asset-level performance labels (BEST/GOOD/LOW per headline/image/video) are NOT surfacing in Claude's responses. Confirmed via direct Google Ads UI check that Asset Group 1 has 19 images, 5 videos, maxed headlines and descriptions — so the data IS there, the query is failing to retrieve it. Root cause unconfirmed because the `.catch(() => [])` in `google-intelligence.ts` silently swallows the actual GAQL error. Attempted Vercel log diagnostic returned "No logs found" — likely because the 15-min server-side intelligence cache served stale data and the function didn't actually run. Fix tomorrow: (1) instrument the `.catch` to log the actual error, (2) force-bust the cache or wait 15min for it to expire, (3) trigger fresh fetch, (4) check Vercel logs for the actual GAQL rejection, (5) fix the query surgically. Suspected query issue: `WHERE campaign.status != 'REMOVED'` may not be valid as a direct filter on the `asset_group_asset` resource — may need to reach campaign via the asset_group relationship instead. Brand impact: the north-star feature (which combination of assets drove this conversion) is degraded — Claude correctly tells the user "I don't have asset-level data, check Google Ads UI" rather than fabricating, which is brand-positive (honest) but not what we shipped. Top priority for tomorrow.
### Node url.parse() deprecation warning during build (LORAMER_PARKING_NODE_DEPRECATION_V1)
Build output during recent commits shows: `(node:4) [DEP0169] DeprecationWarning: url.parse() behavior is not standardized and prone to errors that have security implications.` This comes from a transitive dependency, not our code. Node is signaling it won't issue CVEs for url.parse() vulnerabilities — long-term security concern. Connected to Project 8 (Next.js 14.2.3 upgrade) and broader dependency hygiene. Defer until post-launch when we do a dependency-update pass. Run `node --trace-deprecation` next to localize the offending dep if we want to be surgical.
### Project 3 Step 2 status note (May 26, 2026)
Project 3 Step 2 (a-f) shipped end-to-end this session. All six sub-steps deployed: search terms, per-campaign conversion attribution, audience segments (with recovery), demographics, RSA asset-level performance, PMax asset groups + assets. Known gaps to address before Project 3 is "fully done": (1) the PMax asset-level query bug above; (2) the Meta audience-data investigation; (3) the second test message "what's the last thing I said in the other tab" exposed an architectural gap addressed by `docs/PROJECT_14_PHASE_4_DESIGN.md` (cross-surface attribution with per-message surface labels). Step 3 (Google Tier 2: geographic, device, hour, auction insights, recommendations) not started — that's tomorrow's main thread once asset-level bug is fixed.
