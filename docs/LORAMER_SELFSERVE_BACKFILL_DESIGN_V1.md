# LoraMer — Self-Serve Concurrent Backfill Spine (DESIGN)
<!-- LORAMER_SELFSERVE_BACKFILL_DESIGN_V1 -->

STATUS: DESIGN / approach-before-build. NOT built. Decisions for Russ to review before any code. Builds on the
verified findings in docs/LORAMER_SELFSERVE_BACKFILL_FINDINGS.md. Goal: customer connects → system AUTO
forward+backfills every platform, FAST, no operator, holding the per-customer promise at customer #5 AND #500.
Russ's own clients are the first connections through this spine.

## 0. Verified inputs (do not re-measure)
- Instance: Vercel Fluid ENABLED, Standard = 1 vCPU / 2048MB, iad1. Paid scale lever: Performance 2vCPU/4GB.
- Per-sweep PEAK memory (Veterinary geo 2-level, measured): 20d=544MB · 40d=690MB · 60d=829MB · ~13d≈270-380MB. ~linear (~7MB/day).
- Sweep TIME (full single-connection, all steps): ~187-250s AT THE CURRENT 20d geo window. Only the geo steps scale with the geo window (device/hour/campaign/adgroup are 365d-window, fixed); so the sweep GROWS with the geo window (see §2 caveat).
- Lease: claim_backfill_cursor (migration 014) = 360s. MUST stay > the full sweep time (lease→200s is dead).
- Cost: active-CPU is WORK-BOUND (~$0.30 cohort geo). Concurrency within the free 2GB adds NO active-CPU $ (same work, overlapped I/O). Paid only at Performance tier or the onboarding-volume cliff (~17-26 deep onboards/mo).
- Connect flow: OAuth callback inserts platform_connections, onboard_steps_done=null; the ONLY driver is the 5-min round-robin drain cron — NO connect-kickoff, NO priority.

## 1. CONCURRENCY DIAL (N) — bounded, runtime-config
N = client-sweeps run concurrently per drain pass, via a BOUNDED Promise.all (never unbounded). N is ONE runtime
config constant (env `DRAIN_CONCURRENCY` or a config value), changeable without rebuild. Default N = the max-free
for the chosen window.

FREE-N TABLE (conservative N × full-sweep-peak ≤ 2048MB; base RSS shared across N so this over-counts → safe):
| window | peak/sweep | N=2 | N=3 | N=4 | N=5 | max free N |
|--------|-----------|-----|-----|-----|-----|-----------|
| 60d    | 829MB     | 1658 ✓ | 2487 ✗ | — | — | 2 |
| 40d    | 690MB     | 1380 ✓ | 2070 ✗ | — | — | 2 |
| 20d    | 544MB     | 1088 ✓ | 1632 ✓ | 2176 ✗ | — | 3 |
| ~13d   | ~380MB    | 760 ✓  | 1140 ✓ | 1520 ✓ | 1900 ✓ | 5 |
(The 2GB Standard instance — NOT the old 1024MB — is what makes N≥2 + wide windows free. Old 1024MB capped N=1.)

## 2. OPTIMAL FREE CONFIG — the math
Two independent speed bounds per client:
- LEASE-FLOOR (per client): one lap per lease → time = laps × lease. laps = ceil(1095/window). This binds a SINGLE
  (e.g. prioritized new) client; N does NOT speed up one client (lease-bound), N parallelizes ACROSS clients.
- THROUGHPUT (cohort): drain does ~N sweeps per sweep-duration → all 18 background clients share that → background
  fill is slower (throughput-bound), but it's no-clock background history → acceptable.

⚠ LEASE-vs-WINDOW COUPLING (correction to the earlier "40d + lease 300s" idea — that is UNSAFE): the full sweep
GROWS with the geo window (geo+user_geo at 20d≈82s, 40d≈135s, 60d≈~200s; other steps fixed). So:
- 20d: sweep ~187-250s → lease 300s SAFE. laps 55 → new-client = 55×300 = ~4.6hr.
- 40d: sweep ~270-300s → lease MUST be 360s (NOT 300s). laps 27 → new-client = 27×360 = ~2.7hr.
- 60d: sweep ~340-370s (EXTRAPOLATED — verify) → lease ~420s. laps 18 → new-client = 18×420 = ~2.1hr.

WINNER (new-client promise, the self-serve number): **40d window + lease 360s + N=2 → new client backfilled in
~2.7hr, FREE** (690MB/sweep, N=2=1380MB, comfortable 2GB margin; lease 360s already proven-safe). 
PUSH-TO-~2hr OPTION: 60d + lease ~420s + N=2 (829MB, 1658MB — fits 2GB) → ~2.1hr, FREE, but VERIFY the 60d
full-sweep time first (lease must exceed it) before adopting. 20d/lease300 (~4.6hr) is dominated — reject.
RECOMMENDATION: ship 40d/lease360/N=2 (safe, ~2.7hr); promote to 60d once the 60d sweep-time is measured.

## 3. CONNECT-TRIGGERED KICKOFF (remove the 5-min wait)
Today: connect inserts the connection; backfill waits for the next 5-min drain tick + round-robin position
(minutes-to-hours of dead time on an empty dashboard). Design:
- On OAuth callback (after the platform_connections insert), the connect handler does a fire-and-forget kickoff:
  set the new connection's priority = HIGH (§4), then trigger the drain for THIS connection immediately —
  preferred: an internal authenticated call to `/api/cron/drain?platform=<p>&clientId=<id>` (the drain already
  accepts `onlyClientId`, line 52/64) via `waitUntil()` so the OAuth response returns instantly while the drain
  starts. (Alt: a lightweight "backfill_requested" flag the drain reads; the direct call is simpler + uses the
  existing `clientId` param.)
- Idempotent + lease-guarded: the kickoff claims under the same 360s lease, so the kickoff + the regular cron
  never double-process. If the kickoff is mid-sweep when the cron fires, the cron skips this connection (lease).

## 4. PRIORITY LANE (new-client HIGH preempts background LOW)
- Add a `backfill_priority` (smallint: 0=normal/background, 10=new-client-high) — on platform_connections, OR on
  the `__drain_<platform>` sync_state claim row. Connect-kickoff sets HIGH; it decays to normal once the
  connection's onboard_steps_done ⊇ requiredSteps (fully backfilled) — a one-line update at the existing
  "mark done" site (drain route ~line 147).
- Claim ordering: change the round-robin sort (drain route ~line 92) from `backfill_claimed_at ASC` to
  `(backfill_priority DESC, backfill_claimed_at ASC)` — HIGH first, then least-recently-claimed within a tier.
  So a just-connected client gets a slot every lease window (hits its lease-floor) while background clients fill
  underneath. Anti-double-fire UNCHANGED (same 360s lease; lease still > sweep).
- New-client guarantee: with priority + a frequent-enough cron (see §6), a HIGH client is re-claimed right after
  each lease expiry → ~1 lap/lease → laps×lease (≈2.7hr@40d), INDEPENDENT of how many background clients exist
  (priority preempts them). This is what holds the per-customer promise at #5 AND #500.

## 5. MEMORY SAFETY — hard cap, never OOM
- The bounded-concurrency runner takes N from config AND validates `N × peak(window) ≤ 2048MB − margin` (margin
  ~256MB for base/GC). If the configured (N, window) would exceed it, the runner REDUCES N to fit (or refuses to
  raise) — it NEVER spawns beyond the memory-safe N. peak(window) from the measured linear model (§0).
- One in-flight sweep = one ~690MB (40d) working set; the runner holds at most N concurrently. Per-grain-per-day
  upserts inside each sweep are already small (no row accumulation across laps — verified). So peak = N × sweep-peak.
- CAVEAT (verify at build, from findings): Vercel fluid MAY pack concurrent invocations into one shared-memory
  instance. The bounded Promise.all keeps concurrency WITHIN ONE invocation (one instance, one 2GB budget) — so N
  is bounded by THIS instance's 2GB, which the cap enforces. (Cross-invocation overlap from frequent cron is a
  SEPARATE multiplier — keep total in-flight per instance ≤ the cap; if relying on cron-overlap, confirm fluid's
  per-instance packing in the dashboard before counting on it.)

## 6. SCALE PATH (deliberate, documented, NOT built now)
Per-client speed is FREE up to ~2-2.7hr (lease-floor). Cohort/onboarding THROUGHPUT is what eventually needs $:
- (a) RAISE N via Performance tier (2vCPU/4GB) — PAID. 4GB → N=4@40d / N=5@20d → ~2× background throughput +
  the 2nd vCPU lifts the active-CPU wall-clock floor. Trigger: onboarding bursts exceed free throughput.
- (b) FLUID SCALE-OUT across instances — FREE if Vercel autoscales concurrent drain fires onto separate instances
  (each its own 2GB). VERIFY in dashboard before relying on it. Trigger: many simultaneous new connects.
- (c) NARROW the window for more free N (e.g. 13d → N=5 free) — trades more laps (slower per-client) for more
  cohort parallelism. Free. Trigger: many background clients, per-client speed less critical.
- COST CLIFF (first paid $): VOLUME, not speed — ~17-26 deep-36mo-history onboards in one month, OR ~900-1500
  steady clients (nightly forward). Feeds pricing: marginal active-CPU ≈ ~$0.30 of geo per deep-history client +
  ~negligible/mo forward. Speed stays free; the paid lever is the Performance tier when onboarding volume spikes.

## 7. FREE vs PAID — explicit
- FREE (within Standard 2vCPU... 1vCPU/2GB): 40d/lease360/N=2 (~2.7hr/new client), connect-kickoff, priority lane,
  bounded-concurrency runner, the memory cap. All work-bound; no added active-CPU $.
- PAID (deliberate, later): Performance 4GB tier (raises N + adds a vCPU) — only when onboarding VOLUME exceeds
  free throughput. NOT needed for the per-customer promise.

## 8. BUILD PLAN (ordered, small, each its own gated change — NOT started)
1. PRIORITY CLAIM MODEL: add `backfill_priority` + change the drain claim sort to (priority DESC, claimed_at ASC)
   + decay-to-normal at the mark-done site. (Migration + drain-route edit. Freeze-safe.) Gate: round-robin still
   covers all; lease unchanged.
2. CONNECT-KICKOFF: OAuth callbacks set priority=HIGH + waitUntil() call /api/cron/drain?clientId=. (Per-connector
   edit.) Gate: kickoff is idempotent + lease-guarded (no double-process); OAuth response still instant.
3. BOUNDED-CONCURRENCY RUNNER: replace the drain's serial `for (conn) await sweep` with a bounded Promise.all (N
   from config) + the §5 memory cap. (Drain-route edit.) Gate: N×peak ≤ 2GB enforced; per-client output
   byte-identical to serial; lease/claim still single-owner per connection.
4. SET N + WINDOW + LEASE: config N=2, GEO_WINDOW_DAYS 20→40, lease 360 (migration if changing). Gate: measure a
   real N=2@40d concurrent fire's peak RSS in prod runtime logs ≤ ~1.4GB; new-client end-to-end ~2.7hr.
5. (OPTIONAL) STRESS-TEST + promote to 60d: measure the 60d full-sweep time; if lease ~420s holds, bump window 60d
   → ~2.1hr. Or adopt Performance tier if onboarding volume warrants.

## 9. OPEN DECISIONS FOR RUSS (genuine forks)
- Window/lease: ship 40d/lease360 (safe, ~2.7hr) now, or invest the 60d sweep-time measurement to reach ~2.1hr?
- Lease change is a migration (014) — confirm before touching the claim RPC (it's load-bearing for double-fire).
- Priority field home: platform_connections (travels with the connection) vs the drain sync_state claim row.
- Connect-kickoff transport: direct authenticated /api/cron/drain call via waitUntil (simple, reuses clientId) vs
  a "requested" flag + cron pickup (more decoupled). Recommend the direct call.
- When to flip Performance tier (the one PAID lever) — tie to an onboarding-rate threshold, not speed.
