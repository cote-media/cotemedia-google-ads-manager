# LORAMER_DECISIONS.md — SETTLED-DECISIONS REGISTER  ⛔ MANDATORY SESSION READING (read in full, every session)
Consolidated register of SETTLED decisions — things NOT to relitigate. Built 2026-06-22 from LORAMER_ESSENCE.md,
LORAMER_HANDOFF.md (gospel/non-negotiables + lessons 1–59 + standing principles + bedrock), CLAUDE.md, the
data-completeness docs (accepted caps), STRIPE_BILLING_PLAN.md, LORAMER_WOO_CAPTURED_E1_V1.md,
docs/GOVERNMENT_DATA_REQUEST_POLICY.md, LORAMER_NAV_REGROUP_PLAN.md, and locked decisions in CONTINUE_HERE/design
docs. One line per decision: decision | source | "do not relitigate". Nothing invented. Conflicts resolved from
repo ground truth 2026-06-22. (The QUEUE of work lives in LORAMER_QUEUE_OF_RECORD.md.)
RULE: before proposing any action, restate the settled decisions here that bear on it — to prove you read them.

═══════════════════════════════════════════════════════════════════
GOVERNING LAW & BEDROCK (the rules that override everything)
═══════════════════════════════════════════════════════════════════
- GOVERNING LAW: capture EVERYTHING from EVERYWHERE, store FOREVER (until cancel), at FULL grain WITH history — now, not "later." Only exception = a platform genuinely doesn't serve the data. "Future/phase/scope" deferral of any capture = a VIOLATION. | LORAMER_ESSENCE.md (top) | do not relitigate.
- BEDROCK — TOTAL DATA CAPTURE: on connecting ANY source, auto-capture+backfill every grain/dimension/metric to the deepest the platform allows + forward daily. ENFORCEMENT: (1) auto-backfill on connect, (2) forward covers ALL grains, (3) completeness gate gates "onboarded", (4) fetched-but-unpersisted = DEFECT. No session may narrow this. | LORAMER_HANDOFF.md:35-43 | do not relitigate.
- AUTO-BACKFILL-ON-CONNECT design: on connect → cursor 'pending' (never run inline); cron sweep drains lap-by-lap; 20-lap safety cap; honors per-day self-reconcile HALT; never oscillate into a wall (L51); managed=full speed, Woo=extra-gentle. | CONTINUE_HERE (queued 2026-06-18), ROADMAP Data-Completeness-Onboarding | do not relitigate (design settled; build pending).
- RIGHT > FAST, always. Senior-engineer (20+yr) rigor. NO same mistake twice. | HANDOFF Operator-Level-Truth | do not relitigate.
- EVERYTHING IS LAUNCH-CRITICAL by default for July 14, 2026 — only exceptions: named next-phase (design then write) or external constraint (Meta/Google review). | HANDOFF GOSPEL, ESSENCE | do not relitigate.
- DESKTOP=MOBILE PARITY — ONE responsive app, verify both per increment, never fork. | HANDOFF GOSPEL + STANDING | do not relitigate.
- The MOAT is the intelligence/memory/recommendations layer, NOT the dashboard. Goal = real-world recommendations & growth, not data display. | HANDOFF North-Star, ROADMAP Strategy | do not relitigate.

═══════════════════════════════════════════════════════════════════
NON-NEGOTIABLE BRAND COMMITMENTS (commitments win over product decisions)
═══════════════════════════════════════════════════════════════════
- DEEP KNOWLEDGE: LoraMer = "lore + sea" = accumulated deep knowledge; every feature judged on whether it makes Claude know the customer better. | HANDOFF/ROADMAP Brand | do not relitigate.
- A REAL HUMAN, ALWAYS: every customer reaches a real person on every plan, every time — operational not just marketing (Project 15 SLAs). | ROADMAP Project 15, HANDOFF | do not relitigate.
- PROMPT HONESTY: Lora never says what it can't show/prove; connected-but-empty surfaced explicitly; never fabricate (margin, audience, $0 false-zero). | ESSENCE, L11/L46/L47 | do not relitigate.
- CONNECTION-STATE CLAIMS REQUIRE A LIVE PROBE: no session writes "broken/dead/frozen/blocked/unhealthy" about a connection into any handoff doc from a stored flag alone; stored health flags are hypotheses until a live capture-path probe proves them. ENFORCED IN CODE across all 5 platforms (2026-06-24): meta/google + woocommerce are probe-gated in recordConnectionAuthFailure (a live probe before any 'reconnect' write — LORAMER_CONNECTION_PROBE_BEFORE_FLIP_V1 / _WOO_V1); shopify + ga are PROVEN-SAFE-BY-CONSTRUCTION (their credential flip comes only from a real refresh-determination or a live-API 401, narrow scope — WS2 #2b audit) — do NOT re-audit this ground. | Lesson 60, ESSENCE "never say what it can't prove" | do not relitigate.
- CLAIM-CONFIDENCE RULE (binds chat-Claude every session AND Lora in-product; obey, do NOT narrate): Before stating any factual claim, rule, or generalization, internally classify it — VERIFIED (read this session: docs/code/DB, or just searched — state plainly, cite source only when it adds something), DERIVED (reasoned from something verified — show the reasoning step, not a label; if the derivation can't be shown it's a guess, not derived), or UNVERIFIED (memory / pattern-match / clean-sounding generalization not checked — do NOT state as fact; either verify first via search/read/probe, or say "I haven't verified this — want me to check?" and stop). Banned move: stating an unverified claim in a confident, verified-sounding voice. A tidy authoritative-sounding generalization is the HIGHEST-risk case — treat the urge to state a clean rule as the trigger to verify, not to assert. Do NOT label sentences as ceremony; the classification is an internal gate on whether/how to speak. Surface uncertainty ONLY when a claim is actually unverified. Test every claim: could I show where this came from right now? If no → check it or flag it, never assert. | Root cause: 2026-06-24 session, repeated confident-but-unverified assertions (e.g. "breadth has no purge clock", "I can't see your settings") each corrected only by Russ pushing back — the exact failure this rule exists to stop. | do not relitigate.

═══════════════════════════════════════════════════════════════════
OPERATING PROTOCOL (how we work — settled)
═══════════════════════════════════════════════════════════════════
- SESSION START GATE is the ONE authoritative resume protocol: ESSENCE → CONTINUE_HERE + REQUIRED READING (in full) → HANDOFF + ROADMAP → state NEXT STEP → wait for "go". Act only on what's read THIS session; repo is sole source of truth; panel+memory lag. | HANDOFF:1-31 | do not relitigate.
- REPORT FORMAT (2026-06-09): every report ONCE, IN FULL, in ONE fenced code block; commands/verbatim inside via <<<START>>>/<<<END>>>; OUT.txt retired; no file delivery. | HANDOFF:27, CONTINUE_HERE | do not relitigate.
- Russ never touches code; Claude Code edits/commits/pushes/deploys/migrates directly; Russ approves + is the human verification gate. Single-paste instructions; label "Claude Code"; secrets never in chat. | HANDOFF | do not relitigate.
- DOCS MOVE WITH CODE: every feature/fix flips its own ROADMAP/PARKING/MATRIX/CONTINUE_HERE item in the SAME commit. ENV/MACHINE state + CODEBASE_MAP move with the fact, same commit. | HANDOFF docs-with-code + standing rules | do not relitigate.
- COMMIT/PUSH GATE (2026-06-22): commit+push in one motion ONLY when clean (tsc/build green · Gate A where applicable · freeze intact · only intended files · one change in flight, revert-ready). Push earned, not ceremonial; if any uncertain, STOP. | HANDOFF:834 | do not relitigate.
- ADAPTER CHANGE GATE (2026-06-11): any platform query/adapter change is machine-validated vs the REAL API locally pre-deploy (Gate A) + verified in prod-identical code before the human (Gate B). "connected but fetch failed" ≠ "not connected". | HANDOFF:218 | do not relitigate.
- SPEC RULE (2026-06-11): chat-Claude specs state OUTCOMES; any named API field/syntax is a hypothesis Gate A must confirm; no "if cheap" extras. | HANDOFF:220 | do not relitigate.
- NO-BUNDLING: never combine a rule/process change with substantive build in one move; never add scope while an approval is pending. | HANDOFF:25 | do not relitigate.
- 100% green Vercel deploys — npm run build (with .env.local) is the pre-push gate; tsc ≠ build (L14). | HANDOFF | do not relitigate.
- Session wrap: refresh CONTINUE_HERE NEXT STEP + append dated session-log (newest-first, only in CONTINUE_HERE); capture new lessons; verify clean+pushed+green. | HANDOFF standing rules | do not relitigate.
- Two machines (iMac cotemedia-ads-manager / Air cotemedia-google-ads-manager) — folder names differ BY DESIGN, never "fix"; git pull at start, clean+pushed before leaving; divergence recovery = reset-to-origin + cherry-pick (L34). | HANDOFF Multi-machine | do not relitigate.

═══════════════════════════════════════════════════════════════════
STANDING PRINCIPLES
═══════════════════════════════════════════════════════════════════
- LIVE-SOURCE PRINCIPLE: every connected source is a LIVE production system. SELF-HOSTED (Woo) = full gentle-citizen hardening (breaker, graceful-200, throttle, adaptive sub-chunk, CAS); MANAGED (Google/Meta/Shopify/GA) = standard 429 hygiene. Dashboard reads CAPTURED data, never live-fetch self-hosted on render. | HANDOFF:822 | do not relitigate.
- -next is the ONLY dev target; live app frozen/ignored until the Meta decision (touching reviewer surfaces mid-review could affect outcome). | HANDOFF:828, CONTINUE_HERE | do not relitigate.
- Mobile experience is first-class on ALL -next surfaces (Claude-app-caliber); acceptance criteria, not a later pass. | HANDOFF:831 | do not relitigate.
- Platform extensibility: (client, platform, account) is the universal key; new platforms = backfill adapter + registry entry + new metrics_daily platform value — never a schema change or core rewrite. | CLAUDE.md, Historical-Engine §2 | do not relitigate.
- Universal backfill pattern: daily fetch + shared byte-identical row builder + adapter (resolveContext/buildRows/floorDate hooks) + thin CRON wrapper + BackfillControl mount; whole job in ONE invocation, never DB-cursor control across requests (L26). | HANDOFF addenda, CLAUDE.md | do not relitigate.
--- LORAMER_NAV_REGROUP_PLAN.md (DESIGN INVARIANT decided 2026-06-17; each its own line) ---
- NAV INVARIANT: a platform's nav/rail visibility depends on EXACTLY ONE condition — whether the client connected it; every connected platform gets its own entry, unconditionally. No rule may hide a platform the customer brought in (no hasBoth-style gates, no "show X only if Y"). | NAV_REGROUP §Design-invariant | do not relitigate.
- Combination-aware logic is permitted ONLY to ADD aggregate/cross-platform views (e.g. blended Combined for 2+ ad platforms) — NEVER to gate individual platform visibility. | NAV_REGROUP | do not relitigate.
- Per-connection visibility lives at the secondary (within-client) platform selector; top-level nav stays scoped to clients + cross-cutting surfaces (scales to any platform combination). | NAV_REGROUP | do not relitigate.
- TEST for any nav rule: does it ever hide a connected platform? If yes, it's wrong. | NAV_REGROUP | do not relitigate.
- WAYFINDING stays familiar (convention beats novelty); novelty lives in the intelligence. | ROADMAP §NAV-MOAT 2026-06-05 | do not relitigate.

═══════════════════════════════════════════════════════════════════
LOCKED PRODUCT/POLICY/DATA DECISIONS
═══════════════════════════════════════════════════════════════════
--- STRIPE_BILLING_PLAN.md (each LOCKED decision its own line) ---
- Processor = Stripe; the Shopify path is data-connector + free install funnel ONLY — never touches money. | STRIPE §Decisions | do not relitigate.
- Stripe account = a SEPARATE dedicated LoraMer account owned by russ@loramer.com (NOT cotebrandmarketing/FreshBooks/Cote Media); own statement descriptor "LoraMer"; build in TEST, bank/legal activation only at Phase 6. | STRIPE §Decisions | do not relitigate.
- Billing key = user_email (text), threaded everywhere; NO agency/account/workspace table; user_email→clients[](=workspaces)→connections; Stripe customer maps 1:1 to user_email. | STRIPE §Account-model | do not relitigate.
- beta_unlimited = founding-cohort mechanism: uncapped, hand-onboarded, bypasses gating. | STRIPE | do not relitigate.
- Entitlement matrix LOCKED: free $0/1ws/5Q/30d; business $79mo·$750yr/1ws/100Q/365d; agency $199mo·$1900yr/10ws/500Q/full/flags wyws+priority_support; scale $999mo·$9500yr/50ws/2500Q/full/+automations+white_label+bulk_export+sla; enterprise custom manual-invoice/unlimited/all-flags; beta_unlimited intro/unlimited/all-flags/bypass. (CANONICAL annual = marketing-rounded $750/$1900/$9500; the matrix's earlier $758/$1910/$9590 is SUPERSEDED.) | STRIPE §Entitlement-matrix + §Open-items | do not relitigate.
- Flags: wyws=agency+; automations/white_label/bulk_export/sla=scale+. Annual = 20% off; founding gets extended intro pricing. | STRIPE | do not relitigate.
- DESIGN DECISION 1: retention = VIEW WINDOW, NOT deletion — capture is permanent forever (system-of-record); tier only limits how far back a user can SEE (query date filter); doubles as upgrade lever. | STRIPE §Design-decisions | do not relitigate.
- DESIGN DECISION 2: rename solo→business everywhere; ONE paid entry tier (=1 workspace); internal key DECOUPLED from display_name (relabel via config, no migration). | STRIPE | do not relitigate.
- DESIGN DECISION 3: "AI question" = one user message/chat turn (tool calls within a turn don't each count); monthly reset. | STRIPE | do not relitigate.
- DESIGN DECISION 4: entitlements are DB-DRIVEN (plan_entitlements, one row/tier = single source of truth); caps/quotas/flags = instant Supabase edits; dollar PRICES live in Stripe, changed deliberately, never silently re-price existing subscribers. | STRIPE | do not relitigate.
- ARCHITECTURE: Stripe holds plans + HOSTED Checkout (card data never touches the app); Customer Portal handles upgrade/downgrade/cancel/proration/annual; webhooks sync Stripe→Supabase (Stripe = source of truth + subscriptions mirror); server reads plan_entitlements to enforce. | STRIPE §Architecture | do not relitigate.
- LOCKED Phase-2 answers: customer hook = /api/welcome (best-effort, skips @loramer.app synthetic); webhook NEVER overrides beta_unlimited/enterprise (manual-tier sticky); past_due = entitled (grace); no trial configured, trialing = entitled; TEST/LIVE separated via event.livemode gate + livemode column. | STRIPE Phase2 | do not relitigate.
- invoice.* intentionally NOT handled in Phase 2 (entitlement rides subscription.* status; dunning deferred). | STRIPE Phase2 | do not relitigate.
- /billing checkout: self-serve tier only, client_reference_id=user_email; all user_profiles billing writes are UPSERTs (FIX A, L39); welcome gate covers /dashboard+/clients+/billing (FIX B). | STRIPE Phase3 | do not relitigate.
- Annual prices SHIPPED marketing-rounded: Business $750 / Agency $1900 / Scale $9500 (superseded $758/$1910/$9590). | STRIPE §Open-items | do not relitigate.
- No free trial (Free tier IS the trial); webhook already treats trialing as entitled → adding a trial later is config-only. | STRIPE | do not relitigate.
- Stripe Phase 4 finding: Portal "cancel at period end" = cancel_at (timestamp), not the boolean (L41); entitlement keys off status. | HANDOFF L41 | do not relitigate.
--- LORAMER_WOO_CAPTURED_E1_V1.md (locked 2026-06-17; each its own line) ---
- WOO dashboard tab reads CAPTURED metrics_daily, never live-fetches the self-hosted store on render (LIVE-SOURCE PRINCIPLE); Woo only — Shopify (managed) stays live, untouched. | WOO_CAPTURED §intro | do not relitigate.
- new/returning customer = FIRST-EVER buyer, unified across Woo + Shopify (replaces Woo's window-local-repeat definition). [E2] | WOO_CAPTURED §Decisions | do not relitigate.
- Woo guest checkouts (no customer key) = separate "Guest" bucket, NOT folded into "new". [E2] | WOO_CAPTURED | do not relitigate.
- customer-mix engine is 0-PII-AT-REST (classify at capture, persist only aggregates/probabilistic sketches — Bloom/HLL). [E2] | WOO_CAPTURED | do not relitigate.
- ship E1 aggregate metrics now; New/Returning tiles show an HONEST empty state in the E1→E2 gap (never fabricated zeros). | WOO_CAPTURED | do not relitigate.
- captured edges: today-inclusive ranges show through latest captured day with "as of <date>"; ranges before earliest-captured surface the gap explicitly ("captured from <date>"); missing day INSIDE captured range = genuine no-sales day (show 0); only pre-capture + today are "unknown". | WOO_CAPTURED §Edges | do not relitigate.
- WOO revenue basis: account = NET = wooNetOf (o.total incl shipping/tax + negative refunds); product grain = refund-netted pro-rata to account net (Fix-1b), Σproduct ≡ account residual 0 per client; extra.netBasis tags basis. Per-platform basis difference (Woo incl shipping/tax vs Shopify subtotal-excl) carried by tooltips; Path-1 subtotal re-base BANKED (near-zero likelihood). | DATA_COMPLETENESS, ROADMAP tooltips, Lesson 2026-06-22 | do not relitigate.
- SHOPIFY revenue = NET via currentSubtotalPriceSet (after refunds, excl shipping/tax); product grain refund-netted (Flight 1) Σproduct≡account; cancelled orders excluded at all grains (#6). | L20/L58/L59, MATRIX | do not relitigate.
- WOO counted-as-sale statuses = {completed, processing, refunded}; refunded stays counted (net ~0). | AUDIT#7-FWD, woo-intelligence | do not relitigate.
- Meta placement persist: campaign×placement×day, breakdown_type='placement', breakdown_value='<pub>:<pos>', spend/clicks/impr only (conversions=0, none per placement); account-level reconcile FLAG-NOT-BLOCK; intel.placements (Lora prompt) byte-identical. | this-session Slice1/Slice2 | do not relitigate.
- Meta conversion seam: backfill uses account-level daily definition; query_metrics carries a Meta conversion provenance caveat (notes) — state limit, don't over-narrate. | LORAMER_QUERY_METRICS_META_CAVEAT_V2 (HANDOFF Session 2026-06-04) | do not relitigate.
- Google campaign-grain conversion seam: campaign backfill reconciles per-day on SPEND only (exact, L59-gated); account-vs-Σcampaign CONVERSIONS differ slightly by attribution (pilot Bath Fitter +2.8/mo; spend/clicks/impr reconcile EXACTLY) — ACCEPTED caveat, same class as the Meta conversion seam; query_metrics may note it. Writer correctly does NOT gate on conversions. | LORAMER_GOOGLE_CAMPAIGN_BACKFILL_V1 | do not relitigate.
--- docs/GOVERNMENT_DATA_REQUEST_POLICY.md (adopted 2026-06-11; owner Cote LLC d/b/a Cote Media; each principle its own line) ---
- (1) LEGALITY REVIEW: every public-authority request reviewed for valid legal process/jurisdiction/scope before any response; no data on an informal/voluntary/unverified request; invalid/improper requests refused. | GOV §1 | do not relitigate.
- (2) CHALLENGE: requests believed unlawful/overbroad/improper are challenged (narrow/quash via legal channels; counsel engaged as needed). | GOV §2 | do not relitigate.
- (3) DATA MINIMIZATION: where disclosure is legally compelled, disclose only the minimum data the process requires. | GOV §3 | do not relitigate.
- (4) DOCUMENTATION: every request documented + retained (request, legal reasoning, parties, response). | GOV §4 | do not relitigate.
- (5) USER NOTIFICATION: where lawful, affected users are notified of requests concerning their data. | GOV §5 | do not relitigate.
- Declared data processors = Supabase, Vercel, Anthropic, Cloudflare (all US); responsible entity = Cote LLC d/b/a Cote Media. | Meta data-handling / CONTINUE_HERE | do not relitigate.
- Meta App Review: request ads_read (+ business_management to enumerate) ONLY now; write/ad-management is roadmap, read-only = launch posture. Reviewer creds (demo@) stay valid 1 year. | META_APP_REVIEW_ANSWERS, CONTINUE_HERE | do not relitigate.
- Uploads: stored SEPARATE from user_notes; injected as DELIMITED untrusted DATA (never instructions); text-only; 25MB/file; magic-byte validation; managed scan seam (scan_status). | UPLOAD_FEATURE_DESIGN (locked 2026-06-02) | do not relitigate.
- localStorage keys use legacy advar- prefix (rebrand deferred); platform type union = 'google'|'meta'|'combined' (no Shopify/Woo member); JSX child comments must be {/* */}. | CLAUDE.md, L32 | do not relitigate.
- Anthropic models: claude-haiku-4-5 insight banner; claude-sonnet-4-6 chat (16k tokens, prompt caching cache_control on prefix). | CLAUDE.md, HANDOFF | do not relitigate.
- AUDIENCE/people-data: "everything gets everything" is right for METRICS, WRONG (minimization) for people-data; audiences are compliance-gated, lawyer-first, NOT set up now. | CONTINUE_HERE(7) | do not relitigate (until legal).

═══════════════════════════════════════════════════════════════════
ACCEPTED / DOCUMENTED DATA CAPS (deliberate, not bugs — per DATA_COMPLETENESS_MATRIX)
═══════════════════════════════════════════════════════════════════
- Google Ads: granular ~37-month rolling retention (enforced 2026-06-01; past-37mo granular → DateRangeError) + 11yr monthly aggregate; engine floor 132mo. | MATRIX, L31, HISTORICAL_ENGINE §3 | do not relitigate.
- Google search-term/keyword deep history bounded by Google's search-term report retention (~90d backfill, then BANKED-AND-GROWING forward forever). | MATRIX, CONTINUE_HERE | do not relitigate.
- Meta: aggregate ~37-month retention (floor ~2023-06); breakdowns ~6–13 months. | MATRIX, HISTORICAL_ENGINE | do not relitigate.
- GA4: Data API ~36mo + indefinite aggregate; engine floor 2015-08-14; granular 2/14mo is event/user-scope only (aggregated date-scoped backfills years). | MATRIX, DATA_COMPLETENESS | do not relitigate.
- Shopify/WooCommerce: full history, no purge clock (Shopify needs read_all_orders scope; was a 60-day wall, now lifted on re-auth). | MATRIX#1, L46/L54 | do not relitigate.
- Forward-capture row caps (top-N) are deliberate noise controls, logged on truncation. | MATRIX | do not relitigate (but Woo top-10 product cap was DATA-LOSS → removed Fix-1a; not a noise cap).

═══════════════════════════════════════════════════════════════════
COMPLETED-ARCHIVE EMBEDDED RULINGS (do-not-relitigate rulings inside ROADMAP shipped/archive sections)
═══════════════════════════════════════════════════════════════════
- BRAND PRINCIPLE "permanent system of record": permanent from capture-day FORWARD + bounded backfill; NEVER claim recovery of already-purged data. | ROADMAP:1394 | do not relitigate.
- Read-only is the LAUNCH posture; write/ad-management is the long-term destination, gated on the 95% analysis core + per-platform write scopes requested INCREMENTALLY and only when demoable + the eval program. | ROADMAP 2027-vision/1383/1493 | do not relitigate.
- STRUCTURED-ACCURACY GATE: money-moving recommendations require PROVEN accuracy (the 21%→95% stack) before shipping (Lora cross-platform strategy brain + proactive recs gate on it). | ROADMAP:1473-1475 | do not relitigate.
- query_metrics is Lora's MANDATORY first path (query-don't-guess); maintenance rule = any adapter/schema/grain change updates the matching skill/reference doc in the SAME commit (accuracy decays 95→65 without it); ~90% per-domain offline-eval gate before cohort exposure; provenance footer on every Lora answer. | ROADMAP:1475, QUERY_METRICS_REFERENCE | do not relitigate.
- Distill into docs, DON'T dump corpus: raw retrieval over historical queries/chats moved accuracy <1pt (Anthropic null result) — knowledge goes into reference docs, not a corpus dump. | ROADMAP:1475 | do not relitigate.
- LORA WEB RESEARCH scoping: availability = a tool-wiring decision; SCOPE = a role/PURPOSE decision — do NOT hard-allowlist domains (blocks the long-tail business blogs we want); scope by purpose (marketing analyst serving the client's growth); off-purpose requests declined as not-her-job. External findings always CITED + kept SEPARATE from the client's own data. | ROADMAP:1486-1487 | do not relitigate.
- AGGREGATE BENCHMARKING mandatory sequence (when built): (1) legality review of Google/Meta platform terms re aggregated derivatives FIRST; (2) explicit opt-in toggle — never buried in ToS, never retroactive; (3) guardrails — min cohort ~10+ businesses/segment, derived aggregates only (medians/ranges), never raw rows/campaign names, published methodology. | ROADMAP:1385 | do not relitigate (sequence settled; build future).
- search_term/keyword needs NO dedicated table — the metrics_daily dimensional BREAKDOWN mechanism (as Meta uses for publisher_platform/age) carries per-term grain (earlier "dedicated table" assumption SUPERSEDED). | ROADMAP:1476 | do not relitigate.
- Meta ads_management WRITE scope was DROPPED for launch (read-only posture; unused write scope risks App Review rejection); re-add + new App Review only when write features ship; existing connections need RE-AUTH for the new grant. | ROADMAP:1383 (LORAMER_META_SCOPE_READONLY_V1) | do not relitigate.
- INSTANT CROSS-DEVICE SYNC is a product principle: same state phone+desktop instantly; LoraMer must NEVER fork or lag across devices (URL-held state + Supabase realtime). | ROADMAP:1387 | do not relitigate.

═══════════════════════════════════════════════════════════════════
LESSONS 1–60 (+ 1 dated 2026-06-22) — failure modes that bit this project; never repeat. (LORAMER_HANDOFF.md)
COUNT: 60 numbered lessons, sequence 1–60 CONTIGUOUS, NO GAPS (lesson 26 is split 26a/26b — HANDOFF dual-numbered it) + 1 dated lesson (2026-06-22) + 2 early pre-numbered patterns below.
═══════════════════════════════════════════════════════════════════
1 Silent-skip via shared marker — use content-based idempotency, not marker-presence.
2 Scope assumption in destructure adds — grep the prop in the parent's scope before patching.
3 TS prop add = two edits/component (destructure AND type; check inline vs multi-line type).
4 JS string apostrophes break builds — use backticks for any string with apostrophes/quotes.
5 Stale anchors — re-read the current file (fresh sed/grep) before any patch.
6 Marker-collision silent failure — distinct sub-markers OR per-edit content checks.
7 Per-edit content-based idempotency check is the best practice (all/some/none present logic).
8 Silent .catch(()=>[]) hides GAQL/API errors — instrument console.error before concluding "no data".
9 Cache invalidation hides deployed fixes (15-min) — force a miss via a never-used date range.
10 Whitespace in anchors — bytes matter; dump exact bytes when an anchor fails.
11 PROMPT-AS-MIRROR — grounding/constraint text goes in code comments (INTERNAL_GROUNDING), never user-rendered prompt.
12 Meta breakdowns go in &breakdowns=, NOT &fields= (else HTTP 400, swallowed by .catch).
13 Same-line comment after a token (comma/paren/bracket/template) can break webpack — comment on its own line.
14 tsc --noEmit is NOT npm run build — webpack is stricter (syntax/mangled-literals); build is the real gate.
15 Surfacing raw API status/body into the prompt = diagnostic of last resort (always with a planned cleanup).
16 Anchor only from the current-turn paste — never memory/earlier turns/grep; small anchors over big.
17 Same-named files + blind mv is dangerous — unique-name downloads before moving.
18 Patch scripts with hardcoded machine paths silently fail — match the machine's path.
19 ONE canonical date resolver (resolveDateWindow) — never roll per-platform date math.
20 Revenue = NET (currentSubtotalPriceSet), not gross — surface refunds; match merchant analytics.
21 GAQL has NO LAST_90_DAYS enum — explicit BETWEEN via resolveDateWindow.
22 Platform selector and tab nav are separate controls — switch to Overview on platform change from a non-ad tab.
23 Safe Supabase dup cleanup — backup→repoint children→verify counts→delete only emptied twins (keeper isn't always older).
24 Bug hunts in big files — investigate-only first, then a tight fix spec.
25 Repo is single source of truth — git pull at session start on either machine; unpushed work doesn't travel.
26a Serverless backfill cross-request cursor race — do the whole job in ONE invocation (in-memory loop); persist the cursor only for resume-after-interrupt, never as the loop's control.
26b RightPanel renders TWIN desktop/mobile message containers (hidden md:flex / flex md:hidden, both in DOM) — audit BOTH when touching either; assign anchors by document order. (HANDOFF dual-numbered both as "26"; HANDOFF:730 explicitly notes the collision.)
27 zsh eats unquoted globs (quote --include="*.ts"); BSD grep needs -E for alternation.
28 Verify a freshly-deployed cron/route against LIVE prod + give it time (stale triggers/logs mislead).
29 Heredoc/terminal pastes drop characters — deliver code as files; tsc catches mangled identifiers, NOT mangled string literals — grep critical strings.
30 Backfill depth = "as deep as the platform serves," discovered by probing; report the ACTUAL earliest row, never the swept cursor.
31 Per-platform retention differs — probe before trusting any documented limit.
32 JSX comments are {/* */}, not /* */ (renders as visible text; tsc misses it).
33 CRON-GATED VERIFICATION — deploy before the cron window or manually trigger after; capture writes YESTERDAY's date.
34 Handoffs anchor on session TAG + files, never a commit hash (local commits squash/rewrite on push).
35 pg_dump in CI: invoke by ABSOLUTE path /usr/lib/postgresql/17/bin/pg_dump (PATH resolves to v16).
36 GitHub Actions "Re-run jobs" replays the ORIGINAL commit — use a fresh workflow_dispatch to test a fix.
37 Vercel env rotation needs a redeploy to bind; native cron rotates atomically with the redeploy.
38 Supabase DB password is reset-safe (app uses API keys, not raw Postgres password).
39 A DB write that must touch a row → UPSERT (not UPDATE) + check affected count, log loudly on 0; never assume success on no-throw.
40 Never render internal flag/enum/status/tier keys to users — pass through a human-label map next to the keys.
41 Stripe Portal "cancel at period end" sets cancel_at (timestamp), not cancel_at_period_end (boolean).
42 Google OAuth consent-screen edits (name/domains/scopes/URLs/logo) trigger RE-verification — treat as frozen at launch.
43 Google Ads permissible-use update → Tool Change Form (zero-risk MCC metadata), not a full Standard Access app.
44 Walk every onboarding identity SHAPE with a real identity before launch (founder-only testing only exercises one shape).
45 vercel env pull can report a populated prod var as blank — verify "empty env" against runtime behavior; never re-set to a guess.
46 An API probe verifies what the CREDENTIAL can see, not what EXISTS — a boundary coinciding with a known limit IS the explanation; scope-truncated $0 rows are false-zeros, delete them.
47 EVERYTHING GETS EVERYTHING — completeness is a CORRECTNESS requirement; every gap explicit; any cap is a logged deliberate decision (MATRIX).
48 Vercel MCP has NO env-write — rotate via CLI (value via stdin, never printed) + redeploy to bind.
49 Guard NOT-NULL numerics vs NaN at the WRITE BOUNDARY (Number.isFinite), not per-builder (NaN ?? 0 = NaN → 23502 drops the whole row).
50 Don't conclude a logic bug from a symptom seen under one timing — replay the exact query against live DB; schedule catchup AFTER forward.
51 A backfill DRIVER LOOP must circuit-break on a persistent per-window error; never oscillate/re-walk; be gentle on live stores; resume from the TRUE frontier; when in doubt, STOP and surface.
52 Next.js App Router caches global fetch → deterministic supabase-js reads/writes go STALE/DROPPED on Vercel; force-no-store on read-after-write routes; a unique request body masks the bug.
53 A persisted UI selection carried across a context switch must be RE-VALIDATED against the new context (derive caps from the incoming entity); land on a valid non-blank default.
54 Shopify managed-install scopes come from the DEPLOYED config (shopify app deploy), not the authorize-URL scope= param; a refresh preserves the original grant; verify a scope change by PROBE.
55 A flag-gated reconnect control can be invisible exactly when needed — any re-auth/extend-scope affordance must be reachable for a HEALTHY connection.
56 shopify app deploy needs the Shopify CLI on node ≥22.12 (CLI 4.x crashes on node 20).
57 Vercel env VALUES are unreadable from tooling (masked / pull-blanked / no MCP env tool) — confirm from the source system.
58 Shopify revenue basis differs BY GRAIN — reconcile to the cent (per-line refund attribution + pro-rata residual) or ship a silent per-SKU lie; a WRONG basis is worse than no basis.
59 A permanent-history backfill must self-reconcile per unit of work (Σ within 1¢ each day BEFORE write/cursor-advance) or HALT loudly — never persist a bad day.
60 A connection-state claim (broken/dead/frozen/blocked/unhealthy/reconnect-needed) is a HYPOTHESIS until a LIVE capture-path probe proves it — never written as fact from a stored flag (health/last_error_code/oauth_190/last_ok_at) alone; stored flags are DERIVED CONTEXT, not ground truth (same class as the Google end_date adapter-semantics bug). Origin: a prior session wrote "Influential Drones Meta BLOCKED/broken/oauth_190" into CONTINUE_HERE + QUEUE + a session log as settled fact from the flag alone — it was FALSE (token alive HTTP 200, warehouse reconciled to the penny) and survived days because each session read it forward without re-deriving. RULE: before writing any negative connection claim into ANY handoff doc, run a live probe (raw HTTP status + body, Lesson 15 style); until probed, record "flag says X — UNVERIFIED, probe before acting," never as a blocker. The transient-190-dark-flags-a-live-connection generator = WS2 #2 (separate fix).
(2026-06-22) Product/line grain must reconcile to its account grain on the SAME revenue basis; re-capture history ONLY AFTER the basis fix ships (re-capturing before forces a second pass — violates "never twice").

═══════════════════════════════════════════════════════════════════
EARLY "NO SAME MISTAKE TWICE" PATTERNS (HANDOFF Operator-Level-Truth, pre-numbered, overlap lessons above)
═══════════════════════════════════════════════════════════════════
- Claude.ai cannot read the local repo — use Claude Code for whole-repo audits/multi-file reads; don't guess from the lagging project panel.
- Right > fast cost: doing it twice always costs more time than doing it right once + the emotional cost on Russ.
