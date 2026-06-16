# AUDIT_FINDINGS.md — master pre-launch punch-list

Authoritative, deduplicated punch-list (consolidated 2026-06-13, read-only audit). The backlog/GAP notes in CONTINUE_HERE.md feed INTO this file; this is the single ordered list. Each item keeps its tags: **SEV** (HIGH/MED/LOW) · **FREEZE** (safe-now / post-Meta-decision / external-gated) · **DATA-LOSS** (active loss in progress: yes/no). Item numbers (#1–#13) are stable IDs from the 2026-06-13 sweep; the workstreams (WS1–WS3) are the agreed EXECUTION ORDER.

Discipline: when an item ships, move it to RESOLVED in the SAME commit (docs-with-code).

---

## WS1 — CRON INTEGRITY  (active nightly data loss · freeze-safe · DO FIRST)
Rationale: the forward-capture cron is silently dropping whole platforms/clients every night. Stop the bleed, make it visible, then fix it durably. No reviewer-path overlap.

- **WS1a = #1 band-aid** | ✅ RESOLVED 2026-06-15 by WS1c step 1 (per-platform split) — superseded; see RESOLVED. (maxDuration=300 band-aid alone was insufficient: 06-14/06-15 crons still dropped GA+Woo. The split gives each platform its own 300s.)
  Single invocation runs Shopify→Meta→Google→Woo→GA sequentially with NO maxDuration → it hits the Vercel duration cap mid-run. State proof (2026-06-13): GA all 4 frozen (06-08/06-10, health NULL = loop body never ran); Woo frozen 06-10 (health NULL); the Google loop TAIL is truncated too — Escential + Influential Drones got 0 google rows for 06-12 (health NULL). Loss starts mid-loop-3, not just loops 4-5. Likely trigger: the 06-12 ship (Google search-term/keyword + Shopify depth) pushed total runtime past the cap.
  Approach: add `export const maxDuration` to /api/cron/sync (Pro 300 / Hobby 60), deploy, manual-trigger, then re-check GA/Woo/Google-tail rows for the run → confirms the timeout hypothesis.

- **WS1b = #3 completion sentinel** | HIGH | safe-now | DATA-LOSS yes (masks #1)
  summary.errors lives only in the (expired ~1h) Vercel response; a killed run leaves no trace, so starvation is invisible. Approach: persist a `cron_runs` row at the END of the invocation with the summary; absence of the row ⇒ the run was killed mid-flight. A starved platform must surface, never disappear.

- **WS1c = #1 real fix** | STEP 1 ✅ DONE & VERIFIED 2026-06-15 · STEP 2 (catch-up loop) PENDING | HIGH | safe-now | DATA-LOSS step1 stops the bleed; holes remain until step 2
  STEP 1 (per-platform split) SHIPPED: commit c5180b5 (LORAMER_CRON_PLATFORM_SPLIT_V1) — `?platform=` gating on the 5 loops + 5 staggered vercel.json crons (ga :00 / woo :05 / shopify :10 / meta :15 / google :20 @ 08 UTC). Verified: all 5 HTTP 200 each in its own 300s budget; google 196.5s (under ceiling); all starved targets advanced to 06-14. Each platform's client loop stays in ONE invocation (Lesson 26 respected).
  STEP 2 = the CATCH-UP LOOP (repair pre-existing holes; the cron only ever writes yesterday, never reads last_forward_sync_date). Gate-A design inputs captured → **see LORAMER_CATCHUP_LOOP_PLAN.md**. Highest-risk change (all 5 capture paths) → approach-first in a fresh session, Russ gates before build.

- **#8 — dimensional sync_state never stamps last_forward_sync_date** | MED | safe-now | DATA-LOSS no (rows land; freshness untracked)
  google_dimensional + shopify_dimensional show NULL forward dates → no staleness signal for dimensional capture. Approach: stamp sync_state on the dimensional write paths.

- **#9 — sync_state vs rows inconsistency** | MED | safe-now | DATA-LOSS no
  BusyBee has google rows for 06-12 but sync_state frozen at 06-11 → rows written then the sync_state upsert was skipped/errored (or rows came from another path). Approach: order/atomicity so sync_state reflects actual row writes.

## WS2 — CONNECTION-HEALTH CLASSIFIER  (freeze-safe · MUST land before the UI flag · after WS1)
- **#2 — credential FAN-OUT on a single (possibly spurious) auth error** | HIGH | post-Meta-decision (flag off now; fix itself safe-now) | DATA-LOSS no
  classifyConnectionError treats ANY Meta #190 / Google invalid_grant as 'credential' → resolveReconnectScope flips EVERY connection on that shared token; heals only per-account on next success. Proven 2026-06-13: one transient/spurious Meta 190 dark-flagged all 8 Meta conns while the token was alive. Gates `NEXT_PUBLIC_SHOW_CONNECTION_HEALTH_UI` — would show fleet-wide false "Reconnect needed". Approach: require N-consecutive auth failures (or a single /me / token-probe) before a credential-wide flip; transient/spurious 190s must never flip durable state. MUST ship before the flag flips on.

## WS3 — ACCURACY / COMPLETENESS  (freeze-safe)
- **#6 — Shopify ACCOUNT-row counted cancelled orders** | MED | ✅ FIXED 2026-06-16 (LORAMER_SHOPIFY_CANCELLED_ACCURACY_V1) | DATA-LOSS no
  WAS: account totals used `orderNodes` (incl cancelled) while depth used `liveOrders` (excl). Gate-A (data-derived, token-free): the inflation was COUNT-only — a cancelled order's currentSubtotalPriceSet is $0 (proven: 7 cancelled orders across 5 days, account−Σgeo revenue delta = $0.00, count delta = 7). FIX: define `liveOrders = orderNodes.filter(!cancelledAt)` once, base ALL account aggregations on it (count, revenue, AOV, refund amount/count/rate, customer mix, concentration) → account == Σ depth. Builders/backfill unchanged. Test-order exclusion DEFERRED (couldn't safely probe the token / confirm `test:` syntax) — see #6a. HISTORY RE-BACKFILL **NOT RUN — DEFERRED 2026-06-16** (decision): impact = 6 in-wall + 1 beyond-wall stale ORDER-counts with $0.00 revenue error (cancelled orders already contributed $0); the forward path is fixed + Gate-B-verified (2026-06-15 re-captured → account==Σgeo, conv_delta 0) so tonight's cron keeps it clean. A bounded re-walk near the ~60-day wall risks overwriting correct rows with $0 FALSE-ZEROS (Lesson 46) and needs a cursor save/reset/restore (the dimensional cursor is complete=true/earliest=2026-03-14) — not worth that operational risk for a $0-revenue count skew. SAFE CORRECTION POINT: fold #6 history correction into the future **read_all_orders deep Shopify re-backfill** (no wall → corrects ALL 7 incl. beyond-wall 04-14, no false-zero risk). Known stale rows: 5bb9b2ff 04-20(2)/04-24(1)/04-25(2) + c39ee088 06-12(1) [in-wall]; c39ee088 04-14(1) [beyond-wall]. Fast-follow: apply the same rule to /api/shopify/daily (live dashboard chart) pre-launch so it agrees with Lora (#6b).
- **#6a — Shopify test-order exclusion** | LOW | safe-now | DATA-LOSS no | DEFERRED from #6. Confirm (token-safe) whether the orders query returns TEST orders and whether `test:false` (or the correct equivalent) is valid Shopify orders-query syntax; if so, fold into the same liveOrders rule (count only real, completed orders) + one re-backfill. Token is per-store in DB (service-role only) — don't print it.
- **#6b — /api/shopify/daily cancelled rule (pre-launch fast-follow)** | MED | PRE-LAUNCH | DATA-LOSS no | The live dashboard Shopify chart is a SEPARATE fetch (not fetchShopifyIntelligence); apply the same cancelled-order exclusion so the chart agrees with Lora/metrics_daily. Align before launch.
- **#5 — Lora prompt-leak** | ✅ RESOLVED 2026-06-13 (LORAMER_PROMPT_LEAK_GUARD_V1) — see RESOLVED section.
- **#7 — Woo backfill adapter missing (forward-only; no history)** | MED | safe-now | DATA-LOSS no
  Approach: build the shared-engine Woo adapter (daily fetch + byte-identical row builder + registration).

## HELD until the Meta decision  (Russ's call 2026-06-13)
- **#4 — Meta breakdowns not persisted (publisher_platform/age/gender live-only)** | MED | HELD (Meta-adapter code) | DATA-LOSS yes (never written to metrics_daily)
  Active completeness loss, BUT it lives in the Meta adapter. Do NOT touch while Meta App Review is live, even though the change is likely reviewer-invisible. Approach (when unfrozen): add a meta dimensional grain mirroring google_dimensional (breakdowns in `&breakdowns=`, not `fields=`).

## POST-META-DECISION  (reviewer-path)
- **#11 — Dashboard rail "missing Google tab" for single-ad-platform clients** | LOW | post-Meta-decision | DATA-LOSS no
  ~4-line fix at dashboard ~3784 (push the single platform's rail item when hasGoogle/hasMeta). Touches the frozen reviewer-path dashboard → ship after the Meta decision.

## EXTERNAL-GATED  (no code blocker)
- **Stripe Phase 6 — go-live** | external-gated (bank/legal lead time) | DATA-LOSS no
  Phases 0-4 done + verified; Phase 5 gating deferred (cohort = beta_unlimited bypasses). At go-live: re-create the portal config in LIVE mode, flip TEST→LIVE keys, register LIVE webhook, smoke-test.

## ENV-TRUTH AUDIT  (freeze-safe · ops hygiene)
- **Air .env.local has blank/placeholder sensitive values behind present NAMES** | MED | safe-now | DATA-LOSS no
  Value-level audit 2026-06-13: `CRON_SECRET` = 11-char placeholder; the 8 "pulled" vars (GA ×3, Shopify ×2, Stripe webhook/portal, reviewer token) = BLANK (len 0 — `vercel env pull` returned them empty, Lesson 45). Real: Google-Ads, Supabase, Anthropic (set this session). Approach: set the Air's real `CRON_SECRET` + the 8 blanks by hand from a real source (NOT `vercel env pull` — it blanks them); silent no-echo method (separate non-mirrored terminal). Then re-audit by shape/length.
- **iMac value-level env audit pending** | MED | safe-now | DATA-LOSS no
  Names never confirmed at value level on the iMac; it may already hold the real GA/Shopify/Stripe/Cron values. Do a full shape/length audit next iMac session and stamp the HANDOFF MACHINES & ENV STATE block.
- PRINCIPLE: keep ENV-STATE honest — name-presence ≠ value-validity; audit VALUES, update the HANDOFF block in the same commit as any env change (ENV/MACHINE STATE same-commit rule).

## LOW / WHEN-CONVENIENT
- **#10 — GA dimensional grains + GA/Meta entity-depth backfills** | LOW | safe-now | DATA-LOSS no | completeness depth, post-core.
- **#12 — transient "Google data fetch failed temporarily" in Lora (06-12)** | LOW | safe-now | DATA-LOSS no | check Vercel logs for the real error when convenient (Lesson 15); likely transient GAQL/timeout.
- **#13 — Shopify token read keyed by user_email alone** | LOW | safe-now | DATA-LOSS no | getValidShopifyToken reads `.eq('user_email')` — verify a user with 2 shops can't grab the wrong row (add shop_domain to the key if so). Low: hardening V1 shipped; likely 1 shop/user today.

## OBSERVED DURING WS1c STEP 1 VERIFY  (2026-06-15 · NOT caused by the split · triage)
- **#14 — Shopify dead refresh token (2 clients)** | MED | safe-now | DATA-LOSS yes (those 2 stores stop capturing)
  During the manual platform=shopify invoke, 2 clients returned `refresh_failed - "This request requires an active refresh_token"` (clientIds efe036b4-c55c-4351-b834-7bc7ad30c740, bb9e2c31-fdc9-4aea-82a0-7e332647696f). Dead/absent Shopify refresh token → needs reconnect (the LORAMER_SHOPIFY_TOKEN_HARDEN path correctly refused to return an unpersisted token). Approach: identify the 2 clients by name + reconnect Shopify.
- **#15 — Meta transient code 1 / subcode 99 (2 clients)** | LOW | safe-now | DATA-LOSS no (self-heals)
  platform=meta invoke: 2 clients returned `{"code":1,"message":"An unknown error occurred","error_subcode":99}` (clientIds 5bb9b2ff-a1df-4d46-ac6b-0471ef543e15, 2617b163-f392-427e-9a29-f134acc51406 = Influential Drones). Transient Meta API hiccup — matches the WS2 #2 transient pattern; self-heals on the next successful capture. The other 7 Meta clients captured fine (28 rows). No action unless it persists across multiple nights.

## TENANT-ISOLATION AUDIT  (2026-06-16 · #16+#20 FIXED 2026-06-16 · #17 RETRACTED)
Threat model: multi-tenant data keyed by client_id, owned by user_email. ALL app reads go through `supabaseAdmin` (service role, `src/lib/supabase.ts:11`) which BYPASSES RLS → **app-layer ownership gating is the SOLE defense**. RLS is enabled on all 21 public tables but policies exist on only `clients` + `platform_connections` (qual `user_email = JWT email claim`), and no Supabase JWT is ever issued (NextAuth ≠ Supabase auth) → RLS is INERT for every real path. Proven: `anon` role does not bypass RLS (`rolbypassrls=false`) and `set role anon; select count(*) from clients` = 0. No CONFIRMED cross-tenant READ found.

- **#16 — /api/shopify/daily: request-supplied clientId NOT owner-verified on a service-role read** | HIGH | ✅ FIXED 2026-06-16 (LORAMER_OWNERSHIP_GATE_20260616) | DATA-LOSS no
  WAS: `shopify/daily/route.ts` did `platform_connections.select('account_id').eq('client_id', clientId)` with NO `user_email` filter and NO ownership gate — a signed-in user could pass another tenant's clientId and the service role read that tenant's connection row (existence oracle + shop domain; actual data was already blocked by the owner-scoped `getValidShopifyToken`). FIX: standard clients ownership gate (`clients.eq(id).eq(user_email).maybeSingle → 404`) inserted BEFORE the connection lookup, identical to /api/insight & /api/intelligence.

- **#17 — ANON-KEY ANOMALY** | ❌ RETRACTED 2026-06-16 (FALSE — based on a misread)
  The premise was wrong: `/api/clients` GET (`clients/route.ts:4`) and `/api/ga/connect` (`ga/connect/route.ts:11`) import `import { supabaseAdmin as supabase }` — the identifier `supabase` in those files is the SERVICE-ROLE client, ALIASED, not the anon client. They work because service role bypasses RLS (by design). The TRUE anon export (`supabase.ts:8`) is imported by ZERO files (dead export), so the app has no behavioral dependency on `NEXT_PUBLIC_SUPABASE_ANON_KEY`'s role and there is no anomaly. The RLS-INERT conclusion still stands (every path uses the service role → RLS provides no protection → app-layer gating is the entire wall). See follow-up #22 (the misleading alias is what caused this misread).

- **#18 — legacy live-data routes: request-supplied accountId not bound to an owned client** | MED | safe-now | DATA-LOSS no
  `/api/platform` (`105-140`), `/api/campaigns`, `/api/keywords`, `/api/daily`, `/api/google/ads`, `/api/google/adgroups`, `/api/google/adgroups/daily`, `/api/meta/{ads,adsets,campaigns,daily,debug}` accept a request-supplied accountId/adSetId/campaignId and fetch LIVE platform data using the CALLER'S OWN token (session.refreshToken for Google; meta_tokens by session.user.email for Meta), with no check the account belongs to a client the user owns. NOT a DB cross-tenant read — bounded by the caller's own token. BUT an MCC-access identity (Russ/cote@/demo@) reads any MCC-child accountId (documented Cause-B breadth); external single-account users are bounded to their own. Fix later: bind accountId → owned client before fetch.

- **#19 — query-metrics + CRON backfill wrappers: service-role + request id, no owner gate** | MED | safe-now | DATA-LOSS no
  `/api/query-metrics` and `/api/backfill/{ga,google,meta,google-dimensional,shopify-dimensional,probe,probe-ga}` take a request-supplied clientId/accountId, query with the service role, and have NO ownership gate — mitigated only by CRON_SECRET (not browser-reachable). By design (internal/cron). If CRON_SECRET leaks → full cross-tenant read. Note for the secret-rotation/hygiene program.

- **#20 — write paths upsert by (client_id,user_email) without an ownership gate** | MED | ✅ FIXED 2026-06-16 (LORAMER_OWNERSHIP_GATE_20260616) | DATA-LOSS no
  WAS: `/api/upload`, `/api/context` POST, `/api/clients/connections` POST wrote with the caller's own user_email + a request-supplied clientId and no ownership gate — a tampered clientId created a STRAY row under (otherTenantClientId, attackerEmail) (no overwrite/exfil; reads filter by user_email). FIX: the standard clients ownership gate inserted before each write (upload: after the clientId guard; context: before the upsert; connections: after body parse, var `client_id`). All three are session-authed browser routes (confirmed: no cron/CRON_SECRET/server-to-server callers).

- **#21 — CONFIRMED-CORRECT read paths** | INFO
  Ownership gate (clients.eq(id).eq(user_email).maybeSingle → 404) present + correct on every request-id service-role READ: `/api/intelligence:84-89`, `/api/insight:43-47`, `/api/chat:43-47`, `/api/backfill/run:49-94`, `/api/backfill/status:31-35`. Row-level owner scoping (client_id AND user_email on the data table): `/api/conversations`, `/api/context` (read), `/api/memory`, `/api/memory/bootstrap`, `/api/clients/metrics` (derives clientIds from owner), `/api/clients/profiles`, `/api/woocommerce/daily`. Token lookups owner-scoped by user_email: `getValidGaToken` (`ga-token.ts:30-31`) → `/api/ga/daily` safe; `getValidShopifyToken` (`shopify-token.ts:50-51`, by user_email AND shop_domain — **resolves #13**, the 2-shops concern: shop_domain IS in the key). `query_metrics` tool: `userOwnsClient` gate (`claude-tools.ts:19-25`), withheld unless owner verified (`:185`), clientId injected server-side not model-supplied (`:211-213`) — confirms LORAMER_QUERY_METRICS_OWNERSHIP_V1. Lora context (build-claude-context via /api/intelligence) pulls ONLY owner data. `/api/cron/status` (shipped 2026-06-16): CRON_SECRET-authed, returns per-(mode,platform) run metadata, no tenant data. Edge cases: multi-client user scoped by user_email (all own, none beyond); demo@ = ordinary user (MCC-access widens #18 only → teardown revokes MCC pre-launch); beta_unlimited affects entitlement/gating not isolation; no admin role bypasses ownership.

- **#22 — DEFENSE-IN-DEPTH: extract `assertOwnsClient` helper + delete dead anon export** | MED | safe-now | DATA-LOSS no
  Today the ownership gate is INLINE-duplicated across ~9 routes (the 5 pre-existing + the 4 added 2026-06-16). "One forgotten gate on a new route = instant cross-tenant" (RLS is inert). Extract a single `assertOwnsClient(userEmail, clientId)` helper (mirror `userOwnsClient` in `claude-tools.ts:19-25`) and route ALL gated endpoints through it, so a new client_id route can't ship without it. Also DELETE the dead anon export `supabase.ts:8` (imported nowhere) and DE-ALIAS `import { supabaseAdmin as supabase }` in clients/route.ts + ga/connect/route.ts + clients/connections/route.ts — the misleading alias is exactly what caused the #17 misread. Pure refactor; verify byte-identical behavior.

## RESOLVED  (do not re-open)
- **WS1a #1 cron maxDuration band-aid** — SUPERSEDED/RESOLVED 2026-06-15 by WS1c step 1. The `export const maxDuration = 300` band-aid (commits 3b445ab + 4263a74) was proven INSUFFICIENT on its own: the 06-14 and 06-15 crons ran under it yet still dropped GA + Woo entirely and left a Google tail (sequential 5-platform single invocation can't fit ~17 clients × 5 platforms in 300s). The per-platform split (c5180b5) is the durable fix — each platform now gets its own fresh 300s. maxDuration=300 is retained on the route (each split route still benefits).
- **#5 Lora prompt-leak (constraints meta-commentary reaching users)** — RESOLVED 2026-06-13 (LORAMER_PROMPT_LEAK_GUARD_V1). Root cause: /api/insight INITIAL_INSIGHT_PROMPT rule 1 said "If there are HARD CONSTRAINTS at the top of your context…" — conditional self-reference to prompt scaffolding → when a client had no constraints (Foam OH), Haiku narrated the absence ("I don't see any hard constraints…"). Fix: (a) reworded that rule to unconditional, non-meta obedience (imperative kept in the user message); de-meta'd the build-claude-context ~1135 REMINDER positional self-reference; (b) added an always-on anti-meta guard in the identity prefix (covers insight + chat) forbidding narration of own instructions/constraints/context, (c) explicitly scoped to instructions ONLY — data-gap/provenance honesty preserved. Validated live (Haiku A/B ×3: no meta-commentary, ROAS-ignore obedience held on Glass Plus, quality intact; Sonnet over-suppression probe confirmed gaps-out-loud survives). The data-honesty instruction (build-claude-context ~1036) deliberately left untouched.
- **Meta token "dies ~30 days early"** — DEBUNKED 2026-06-13: token alive, all accounts HTTP 200; the 8 'reconnect' flags are stale false-alarms from #2 (self-heal on next successful Meta capture). (NOTE: the deliberate ~07-10 Meta reconnect before the projected ~07-13 expiry STILL stands — see CONTINUE_HERE date-gated.)
- **Influential Drones Meta ghost** — SETTLED 2026-06-13: alive-but-empty (HTTP 200, no spend>0 campaigns), not dead/forbidden.
- **Shopify token hardening** (post-refresh save guard, missing rotated refresh_token, concurrent-refresh race) — SHIPPED + proven (CAS claim + winner re-read + TTL + release).
- **Customer Mix new-vs-returning** — SHIPPED + verified (true first-order date; history re-backfilled on all 3 stores).
- **Mobile custom-range (3 fixes)** — SHIPPED (date-picker affordance, chart range, banner/Lora window sync).
- **Google campaign-status V2** — SHIPPED + verified (primary_status; false "$523/day live budget" alarm impossible).
- **query_metrics ownership gate** — SHIPPED + verified (cross-tenant read closed at route + central tool loop).
- **ROAS 0.00x** — confirmed NON-BUG (presentational; optionally hide when conversionValue=0).
