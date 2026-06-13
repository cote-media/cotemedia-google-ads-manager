# AUDIT_FINDINGS.md — master pre-launch punch-list

Authoritative, deduplicated punch-list (consolidated 2026-06-13, read-only audit). The backlog/GAP notes in CONTINUE_HERE.md feed INTO this file; this is the single ordered list. Each item keeps its tags: **SEV** (HIGH/MED/LOW) · **FREEZE** (safe-now / post-Meta-decision / external-gated) · **DATA-LOSS** (active loss in progress: yes/no). Item numbers (#1–#13) are stable IDs from the 2026-06-13 sweep; the workstreams (WS1–WS3) are the agreed EXECUTION ORDER.

Discipline: when an item ships, move it to RESOLVED in the SAME commit (docs-with-code).

---

## WS1 — CRON INTEGRITY  (active nightly data loss · freeze-safe · DO FIRST)
Rationale: the forward-capture cron is silently dropping whole platforms/clients every night. Stop the bleed, make it visible, then fix it durably. No reviewer-path overlap.

- **WS1a = #1 band-aid** | HIGH | safe-now | DATA-LOSS yes
  Single invocation runs Shopify→Meta→Google→Woo→GA sequentially with NO maxDuration → it hits the Vercel duration cap mid-run. State proof (2026-06-13): GA all 4 frozen (06-08/06-10, health NULL = loop body never ran); Woo frozen 06-10 (health NULL); the Google loop TAIL is truncated too — Escential + Influential Drones got 0 google rows for 06-12 (health NULL). Loss starts mid-loop-3, not just loops 4-5. Likely trigger: the 06-12 ship (Google search-term/keyword + Shopify depth) pushed total runtime past the cap.
  Approach: add `export const maxDuration` to /api/cron/sync (Pro 300 / Hobby 60), deploy, manual-trigger, then re-check GA/Woo/Google-tail rows for the run → confirms the timeout hypothesis.

- **WS1b = #3 completion sentinel** | HIGH | safe-now | DATA-LOSS yes (masks #1)
  summary.errors lives only in the (expired ~1h) Vercel response; a killed run leaves no trace, so starvation is invisible. Approach: persist a `cron_runs` row at the END of the invocation with the summary; absence of the row ⇒ the run was killed mid-flight. A starved platform must surface, never disappear.

- **WS1c = #1 real fix** | HIGH | safe-now | DATA-LOSS yes
  Band-aid only buys time; it doesn't scale to N clients. Approach: split into per-platform cron paths (or parallelize) so no platform/tail is ever starved. Keep each platform's client loop in ONE invocation — do NOT drive the loop from a re-read DB cursor across requests (Lesson 26).

- **#8 — dimensional sync_state never stamps last_forward_sync_date** | MED | safe-now | DATA-LOSS no (rows land; freshness untracked)
  google_dimensional + shopify_dimensional show NULL forward dates → no staleness signal for dimensional capture. Approach: stamp sync_state on the dimensional write paths.

- **#9 — sync_state vs rows inconsistency** | MED | safe-now | DATA-LOSS no
  BusyBee has google rows for 06-12 but sync_state frozen at 06-11 → rows written then the sync_state upsert was skipped/errored (or rows came from another path). Approach: order/atomicity so sync_state reflects actual row writes.

## WS2 — CONNECTION-HEALTH CLASSIFIER  (freeze-safe · MUST land before the UI flag · after WS1)
- **#2 — credential FAN-OUT on a single (possibly spurious) auth error** | HIGH | post-Meta-decision (flag off now; fix itself safe-now) | DATA-LOSS no
  classifyConnectionError treats ANY Meta #190 / Google invalid_grant as 'credential' → resolveReconnectScope flips EVERY connection on that shared token; heals only per-account on next success. Proven 2026-06-13: one transient/spurious Meta 190 dark-flagged all 8 Meta conns while the token was alive. Gates `NEXT_PUBLIC_SHOW_CONNECTION_HEALTH_UI` — would show fleet-wide false "Reconnect needed". Approach: require N-consecutive auth failures (or a single /me / token-probe) before a credential-wide flip; transient/spurious 190s must never flip durable state. MUST ship before the flag flips on.

## WS3 — ACCURACY / COMPLETENESS  (freeze-safe)
- **#6 — Shopify ACCOUNT-row includes cancelled orders in totalRevenue** | MED | safe-now | DATA-LOSS no (accuracy mismatch)
  Depth grains already exclude cancelled; the account calc doesn't. Approach: reconcile the account calc to the depth-grain rule (exclude cancelled).
- **#5 — Lora prompt-leak (constraints meta-commentary reaches users)** | MED | safe-now (backend prompt) | DATA-LOSS no
  Located: build-claude-context.ts rules block ~906-964 ("the constraint wins", "verify NOTHING contradicts these constraints"). Approach: harden so the model never narrates about its own constraints/context.
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

## LOW / WHEN-CONVENIENT
- **#10 — GA dimensional grains + GA/Meta entity-depth backfills** | LOW | safe-now | DATA-LOSS no | completeness depth, post-core.
- **#12 — transient "Google data fetch failed temporarily" in Lora (06-12)** | LOW | safe-now | DATA-LOSS no | check Vercel logs for the real error when convenient (Lesson 15); likely transient GAQL/timeout.
- **#13 — Shopify token read keyed by user_email alone** | LOW | safe-now | DATA-LOSS no | getValidShopifyToken reads `.eq('user_email')` — verify a user with 2 shops can't grab the wrong row (add shop_domain to the key if so). Low: hardening V1 shipped; likely 1 shop/user today.

## RESOLVED  (do not re-open)
- **Meta token "dies ~30 days early"** — DEBUNKED 2026-06-13: token alive, all accounts HTTP 200; the 8 'reconnect' flags are stale false-alarms from #2 (self-heal on next successful Meta capture). (NOTE: the deliberate ~07-10 Meta reconnect before the projected ~07-13 expiry STILL stands — see CONTINUE_HERE date-gated.)
- **Influential Drones Meta ghost** — SETTLED 2026-06-13: alive-but-empty (HTTP 200, no spend>0 campaigns), not dead/forbidden.
- **Shopify token hardening** (post-refresh save guard, missing rotated refresh_token, concurrent-refresh race) — SHIPPED + proven (CAS claim + winner re-read + TTL + release).
- **Customer Mix new-vs-returning** — SHIPPED + verified (true first-order date; history re-backfilled on all 3 stores).
- **Mobile custom-range (3 fixes)** — SHIPPED (date-picker affordance, chart range, banner/Lora window sync).
- **Google campaign-status V2** — SHIPPED + verified (primary_status; false "$523/day live budget" alarm impossible).
- **query_metrics ownership gate** — SHIPPED + verified (cross-tenant read closed at route + central tool loop).
- **ROAS 0.00x** — confirmed NON-BUG (presentational; optionally hide when conversionValue=0).
