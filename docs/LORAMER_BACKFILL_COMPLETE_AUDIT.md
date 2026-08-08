# LORAMER_BACKFILL_COMPLETE_AUDIT.md — both backfill engines, end to end
<!-- LORAMER_BACKFILL_COMPLETE_AUDIT_V1 -->

> ⛔ PURPOSE: one authoritative document covering BOTH backfill engines so we stop rediscovering the same
> defects. Every claim below carries a confidence tier per the CLAIM-CONFIDENCE law:
> **VERIFIED** (with the query/command that produced it, named inline) · **DERIVED** (reasoned from verified
> facts; which ones is stated) · **ASSUMED** (not checked — never load-bearing).
>
> OUT OF SCOPE by instruction: the Google Ads 15,000 ops/day developer wall. Vendor constant, not a defect.

**THREE-SOURCE — LORAMER_THREE_SOURCE_PRECONDITION_V1**

- **HISTORY** — searched `LORAMER_DECISIONS.md`, `LORAMER_QUEUE_OF_RECORD.md`, `CONTINUE_HERE.md`,
  `LORAMER_HANDOFF.md`, `LORAMER_RESUME_DIGEST.md` for: `nextStep`, `universe_disk_headroom`,
  `COMPLETE-FLAG-AUDIT`, `RANGELAP-CLAIM-DEFECT`, `2020-01-27`, `2,293,179`, `granularMonths`, `214`, `740`,
  `DEFAULT_RESET_UTC`, `universe_run_notice`. Prior art found and cited inline at every point. Two banked
  claims are contradicted by live reads — recorded in §3 and flagged in the delivery note, not quietly fixed.
- **WEB** — Vercel Queues concepts (retry-until-expiry, no dead-letter queue, forced exponential backoff after
  32 attempts, deployment-pinned push delivery); Google Ads data-retention policy (37 months for hourly/daily/
  weekly reporting, 11 years for monthly/quarterly/annual); GA4 Data API `runReport` (`keepEmptyRows` does not
  override "only data recorded by the property can be displayed", so a pre-creation range returns HTTP 200
  with zero rows and no error).
- **REPO** — read in full before writing: `run-backfill.ts`, `adapters.ts`, `/api/backfill/run`,
  `/api/backfill/status`, `BackfillControl.tsx`, `queues/google-ads-universe/route.ts`,
  `google-ads-universe-writer.ts`, `universe-window-log.ts`, `universe-run-state.ts`,
  `universe-start/route.ts`, `cron/drain/route.ts`, `drain-registry.ts`, `ga-intelligence.ts`,
  `migrations/019`, `migrations/051`, `migrations/059`, `vercel.json`,
  `docs/google-ads-capture-universe.json`. Live database read via Supabase MCP (SELECT only) and Vercel
  runtime error clusters.

---

## §1 · THE JUNE 2026 ENGINE (the one that worked)

### 1a. Architecture as it stands today

Five files, all still present and all still wired. **VERIFIED** — `ls`, `wc -l`, 2026-08-08:

| file | lines | role |
|---|---|---|
| `src/lib/backfill/run-backfill.ts` | 320 | the engine — one bounded chunk loop per invocation |
| `src/lib/backfill/adapters.ts` | 127 | per-platform adapters; the registry is the allowlist |
| `src/app/api/backfill/run/route.ts` | 123 | session-authed POST trigger, ownership-gated |
| `src/app/api/backfill/status/route.ts` | 109 | session-authed GET of `sync_state` progress |
| `src/app/clients/BackfillControl.tsx` | 127 | the button, mounted on the LEGACY `/clients` surface |

**THE CORE LOOP, verbatim** (`run-backfill.ts:204-289`) — note that the ONLY completion condition is
positional and rows are never consulted:

```ts
  while (windowEnd >= targetDate && chunks < MAX_CHUNKS) {
    chunks += 1
    let windowStart = addDays(windowEnd, -(adapter.chunkDays - 1))
    if (windowStart < targetDate) windowStart = targetDate
    let daily: any[] = []
    try {
      daily = await adapter.fetchDaily(token, accountId, windowStart, windowEnd)
    } catch (e: any) {
      // (c) NEVER SWALLOW (Lesson 15): surface the error so the caller can tell a retention floor from a
      // transient from a query-too-heavy. The cursor stays at the last successful chunk so a re-run resumes.
      // We do NOT mark complete on an error — only an empty-success descent to targetDate is "complete".
      stoppedOnError = true
      stopCode = Number.isFinite(Number(e?.code)) ? Number(e.code) : null
      stopSubcode = Number.isFinite(Number(e?.error_subcode)) ? Number(e.error_subcode) : null
      stopDetail = String(e?.message ?? e ?? 'unknown error')
      break
    }
    const rows = adapter.buildRows ? ... : (daily || []).map(...)
    if (rows.length > 0) {
      const { error: metricsError } = await supabaseAdmin
        .from('metrics_daily')
        .upsert(normalizeMetricsRows(rows), { onConflict: METRICS_DAILY_CONFLICT })
      if (metricsError) { return { status: 500, body: { error: 'metrics_daily upsert failed', ... } } }
      totalRows += rows.length
    }
    earliest = windowStart
    const { error: stateError } = await supabaseAdmin
      .from('sync_state')
      .upsert(
        {
          client_id: clientId,
          platform: adapter.platform,
          backfill_earliest_date: earliest,
          backfill_target_date: targetDate,
          backfill_complete: windowStart <= targetDate,
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'client_id,platform' }
      )
    if (stateError) { return { status: 500, body: { error: 'sync_state upsert failed', ... } } }
    if (windowStart <= targetDate) {
      complete = true
      break
    }
    windowEnd = addDays(windowStart, -1)
  }
```

**THE FLOOR CONSTANTS, verbatim** (`run-backfill.ts:91-92, 185-190`):

```ts
const GRANULAR_MONTHS = 132
const MAX_CHUNKS = 60
...
  const targetObj = new Date()
  targetObj.setUTCMonth(targetObj.getUTCMonth() - (adapter.granularMonths ?? GRANULAR_MONTHS))
  let targetDate = fmt(targetObj)
  if (adapter.floorDate && targetDate < adapter.floorDate) {
    targetDate = adapter.floorDate
  }
```

### 1b. Commit history, all five files, 2026-06-03 → 2026-08-08

**VERIFIED** — `git log --follow --format='%h %ad %s' --date=short -- <path>`:

`src/lib/backfill/run-backfill.ts`
- `57b8b81` 2026-06-25 LORAMER_ONBOARD_DRAIN_V1: onboarding auto-backfill drain cron over the writer-registry (deepest-first, per-step-independent, self-heal + real-gap-fill, never-mark-on-error); +granularMonths floor clamp (meta=36) + 3 backoff gaps closed (google account/dim + meta account) + verified Meta error taxonomy; staggered every-6h cron; proven on the Influential meta lap (608 reconciled placement rows)
- `172f750` 2026-06-16 LORAMER_METRICS_NORMALIZE_V1: extend §A finite-guard to 3 remaining metrics_daily writers
- `24f5b51` 2026-06-05 LORAMER_MULTIACCOUNT_PHASE2A_V1: populate account_id in all metrics_daily row builders (conflict key unchanged)
- `e2a9dd8` 2026-06-04 LORAMER_BACKFILL_SHARED_LIB_V3: additive engine hooks (resolveContext, buildRows, floorDate); Google/Meta unchanged via defaults
- `fcd4a08` 2026-06-04 LORAMER_BACKFILL_DEEP_V2: 132-month floor + per-chunk error resilience + honest earliest-from-data label
- `ec02d62` 2026-06-04 LORAMER_BACKFILL_SHARED_LIB_V1: extract google+meta backfill into src/lib/backfill engine+adapters; routes become thin CRON wrappers; no behavior change
- `d14429b` 2026-06-03 LORAMER_BACKFILL_GOOGLE_0B_V2: single-invocation internal-loop backfill (fix cross-request cursor race)
- `4583b2c` 2026-06-03 LORAMER_BACKFILL_GOOGLE_0B_V1: chunked resumable Google account-level backfill

`src/lib/backfill/adapters.ts`
- `57b8b81` 2026-06-25 (as above)
- `0d1b0fd` 2026-06-04 LORAMER_BACKFILL_GA_ADAPTER_V1: register GA backfill adapter via V3 hooks (getValidGaToken + fetchGaDailyMetrics + buildGaMetricsRows + 2015-08-14 floor)
- `ec02d62` 2026-06-04 (as above)

`src/app/api/backfill/run/route.ts`
- `d5b28a3` 2026-06-18 LORAMER_SHOPIFY_DEEP_BACKFILL_V1 — Shopify full-history backfill (button-only, dormant until clicked) … `/api/backfill/run` platform='shopify' dispatch (ownership-gated) → {complete,earliest}; `/api/backfill/status` emits platforms['shopify']; BackfillControl mounted on the Shopify row mirroring google/meta/ga. No backfill triggered.
- `fc0cfad` 2026-06-16 LORAMER_WOO_BACKFILL_ATOMIC_BREAKER_V1: Lesson 52 defense-in-depth — force-no-store on cursor-resume routes
- `9ae53ab` 2026-06-12 LORAMER_SHOPIFY_DIM_BACKFILL_V1: bounded Shopify geo + product-net history backfill (+ pagination/throttle)
- `d9bd0a6` 2026-06-12 LORAMER_SEARCH_TERMS_BACKFILL_V1: bounded ~90-day Google search-term + keyword history backfill
- `00b9d37` 2026-06-04 LORAMER_BACKFILL_RUN_POST_V1: session-authed in-app backfill trigger (ownership check + google/meta allowlist) over shared engine

`src/app/api/backfill/status/route.ts`
- `d5b28a3` 2026-06-18 (as above)
- `fcd4a08` 2026-06-04 LORAMER_BACKFILL_DEEP_V2
- `22eca24` 2026-06-04 LORAMER_BACKFILL_STATUS_GET_V1: session-authed read of sync_state backfill progress for the /clients UI

`src/app/clients/BackfillControl.tsx`
- `aa400e2` 2026-06-04 LORAMER_BACKFILL_UI_V1: per-platform backfill control on /clients (google+meta) over session run/status routes

**DERIVED from the above:** the engine's last substantive change was `57b8b81` on **2026-06-25**. Everything
after that date in this repo's backfill story happened elsewhere. It has been untouched for six weeks.

### 1c. The state model

**VERIFIED** — the engine reads exactly three `sync_state` columns and writes exactly five.

READ (`run-backfill.ts:164-168`):
```ts
  const { data: stateRow } = await supabaseAdmin
    .from('sync_state')
    .select('backfill_earliest_date, backfill_target_date, backfill_complete')
    .eq('client_id', clientId)
    .eq('platform', adapter.platform)
    .maybeSingle()
```

WRITTEN (`run-backfill.ts:262-272`): `client_id`, `platform`, `backfill_earliest_date`,
`backfill_target_date`, `backfill_complete`, `updated_at`. The conflict key is `client_id,platform`.

**THE CLAIM TOKEN AND LEASE DO NOT EXIST IN THIS ENGINE. VERIFIED** —
`grep -n "claim\|lease\|backfill_claim" src/lib/backfill/run-backfill.ts` returns **nothing**. The
`backfill_claim_token` / `backfill_claimed_at` columns and the `claim_backfill_cursor` CAS RPC belong to the
DRAIN (`cron/drain/route.ts:239-287`, key `'__drain_' + platform`), which is a later system built on top of
the same table. **DERIVED:** the June engine is single-invocation and button-driven, so it never needed one —
two concurrent presses would race, and nothing prevents that.

**WHAT MAKES A LAP UNABLE TO FINISH WITHOUT WRITING STATE — the answer is: almost nothing can.** The cursor
upsert at `:260` sits INSIDE the loop and fires after every successful chunk, before the completion test. The
three ways out that leave state unwritten for that chunk, quoted:

1. `adapter.fetchDaily` throws → `break` at `:219` with `stoppedOnError = true`, cursor left at the last
   successful chunk. **State from prior chunks IS durable.** This is the honest path and the comment at
   `:212-214` says so.
2. `metrics_daily` upsert fails → `return { status: 500 }` at `:247` — the cursor is NOT advanced for that
   chunk. Durable state from prior chunks survives.
3. `sync_state` upsert fails → `return { status: 500 }` at `:274`.

**DERIVED, and it is the structural difference from the walk:** this engine writes durable progress on the
FAILURE path by construction, because the cursor write is per-chunk and precedes the exit. A killed
invocation loses at most one chunk.

### 1d. The proof it worked

**VERIFIED — the record exists at `LORAMER_HANDOFF.md:605-615`, verbatim:**

```
- Deep-history V2: 132-month floor + per-chunk error resilience + honest
  earliest-from-data label. PROVEN on "Bath Fitter | O'Gorman Bros" — full real
  history (earliest 2020-01-27, 1,933 days), total_spend $2,293,179.80 reconciling
  to Google's all-time $2.29M to the penny.
```

Banked by commit `f4cdb09` — "LORAMER_HANDOFF_DEEP_BACKFILL_2026_06_04: backfill button + deep-history V2 +
universal-backfill roadmap; CONTINUE_HERE rewrite" (**VERIFIED**, `git log -S'2,293,179' --all`).

⛔ **AND IT IS CONTRADICTED BY A LATER BANKED FINDING. `LORAMER_DECISIONS.md:210`, verbatim:**

```
- [FINDING 2026-07-14, CORRECTS A GOLDEN FICTION] B6's rubric asserted "2019 predates the 2020-01-27 data
  start." FALSE as stated: Bath Fitter's Google account-grain cursor shows backfill_earliest_date NULL,
  backfill_complete FALSE, never blocked — the account-range backfill NEVER RAN
```

**VERIFIED LIVE 2026-08-08**, and the July finding still holds today:

```sql
select ss.backfill_earliest_date, ss.backfill_target_date, ss.backfill_complete
from sync_state ss join clients c on c.id = ss.client_id
where c.name like 'Bath Fitter%' and ss.platform = 'google';
-- backfill_earliest_date NULL · backfill_target_date NULL · backfill_complete false
```

…while `metrics_daily` for that client on platform `google` **does** hold `min(date) = 2020-01-27`
(**VERIFIED**, lateral `order by date asc limit 1`).

**DERIVED, stated as the open question it is:** the ROWS reaching 2020-01-27 are real and present; the CURSOR
that would prove this engine put them there is empty. Both facts are true. Either the 2026-06-04 run wrote the
rows and its cursor was later cleared (no code path deletes `sync_state` rows — **VERIFIED**, §3 entry 11), or
the rows arrived by another path. **This audit cannot resolve it from the tree, and §7 names the read that
would.** The `$2,293,179.80` reconciliation is a **VERIFIED** historical record of a moment; it is not
re-derivable today from the cursor.

### 1e. Its limits, honestly

**VERIFIED — the complete adapter registry** (`adapters.ts`, final statement):

```ts
export const backfillAdapters: Record<string, BackfillAdapter<any>> = {
  google: googleBackfillAdapter,
  meta: metaBackfillAdapter,
  ga: gaBackfillAdapter,
}
```

THREE adapters. No Shopify, no WooCommerce — those ride separate writers (`runShopifyDeepBackfill`,
`runWooCommerceBackfill`) reached through the drain, not through this engine.

What each adapter actually requests (**VERIFIED**, `adapters.ts`):

| adapter | accountIdKey | chunkDays | floor | what it fetches |
|---|---|---|---|---|
| `google` | `customerId` | 365 | `GRANULAR_MONTHS` 132 | `getDailyMetrics(token, accountId, 'LAST_30_DAYS', undefined, 'day', windowStart, windowEnd)` via `withGoogleRetry` |
| `meta` | `accountId` | 90 | `granularMonths: 36` | `fetchMetaDailyMetrics(token, accountId, s, u)` via `fetchMetaDailyWithRetryNarrow` |
| `ga` | `propertyId` | 365 | `floorDate: '2015-08-14'` | `fetchGaDailyMetrics(accountId, token, windowStart, windowEnd)`; `resolveContext` + `buildRows` V3 hooks |

**THE LIMIT, stated plainly and DERIVED from the default row builder (`run-backfill.ts:223-241`):** every row
this engine writes is `entity_level: 'account'`, `entity_id: accountId`, `breakdown_type: ''`,
`breakdown_value: ''`, carrying only `spend / impressions / clicks / conversions / conversion_value` and
`revenue: 0`. **ONE GRAIN, ONE ROW PER DAY, NO DIMENSIONS, NO PER-RESOURCE SURFACES.** It is the account
spine and nothing else. Every campaign / ad_group / ad / keyword / search_term / geo / device / hour /
demographic row in the database came from a different writer.

### 1f. Every defect it ever had

**D1 · Cross-request cursor race.** Fixed `d14429b` 2026-06-03 — "single-invocation internal-loop backfill
(fix cross-request cursor race)". This is the ancestor of Lesson 26 (never control a backfill loop from a DB
cursor re-read across requests). **VERIFIED** from the commit message.

**D2 · Shallow floor / no per-chunk error resilience.** Fixed `fcd4a08` 2026-06-04 — "132-month floor +
per-chunk error resilience + honest earliest-from-data label". This is where `GRANULAR_MONTHS = 132` and the
`try/catch … break` at `:211-220` entered. **VERIFIED.**

**D3 · Meta requesting pre-retention windows and throwing.** Fixed `57b8b81` 2026-06-25 via
`granularMonths: 36` on the Meta adapter. Its own comment, verbatim (`adapters.ts:47-49`):

```ts
  // Meta insights retain ~37 months; stop at 36 (safety margin) so the engine never requests pre-retention
  // (which Meta THROWS on, stopping the step short) — the floor becomes an empty-success, i.e. "complete".
  granularMonths: 36,
```

⛔ **THE FIX CREATED THE NEXT DEFECT AND SAYS SO ON ITS OWN FACE:** it converts a vendor THROW (which would
have left `complete=false`) into an EMPTY SUCCESS at the clamp (which marks `complete=true`). **DERIVED:** a
Meta cursor sealing at the 36-month clamp is a positional claim, not a coverage claim.

**D4 · Non-finite numerics reaching `metrics_daily`.** Fixed `172f750` 2026-06-16 (finite-guard extended to
three remaining writers) via `normalizeMetricsRows`. ⚠ **AND IT RUNS TOWARD FALSE ZEROS BY DESIGN** —
`metrics-normalize.ts:33-34`, verbatim:

```ts
      // absent → 0 (would otherwise be sent as explicit NULL); present-but-non-finite → 0 (the original guard).
      if (!(c in r) || typeof v !== 'number' || !Number.isFinite(v)) r[c] = 0
```

Correct for NOT-NULL columns; it is also the mechanism by which "we did not fetch it" becomes "it was zero".

**D5 · False `backfill_complete` flags — the big one, and it is NOT this engine's.** `LORAMER_QUEUE_OF_RECORD.md:138`
records the first run of `check-completion-claims.mjs`: **244 claims / 53 connections / 51 violations**, all
baselined. `LORAMER_QUEUE_OF_RECORD.md:162` (★RANGELAP-CLAIM-DEFECT, retitled from ★RUN-BACKFILL-268-CLAIM-DEFECT)
carries the correction, verbatim:

> **THE WRITER OF ALL 43 GOOGLE COMPLETION-CLAIM VIOLATIONS IS `rangeLap` (drain-registry.ts:189) via
> `writeRangeCursor` (drain-registry.ts:166), which serves 22 of the 34 drain steps.** `run-backfill.ts:~268`
> is a SEPARATE site of the same class serving only the google/meta/ga ACCOUNT cursors, with **ZERO current
> violations**

**VERIFIED via the repo record.** Flight A shipped (LORAMER_RANGELAP_COMPLETION_HONESTY_V1). **Flight B — the
repair of up to 43 cursors — is OPEN.**

**D6 · The positional completeness condition itself.** `backfill_complete: windowStart <= targetDate`
(`:268`) and `if (windowStart <= targetDate) complete = true` (`:284-285`). **OPEN.** See §3 entry 14.

---

## §2 · THE UNIVERSE WALK (the current engine)

### 2a. Architecture

| component | file / table | role |
|---|---|---|
| consumer | `src/app/api/queues/google-ads-universe/route.ts` (244 lines) | one message = one entry × one window |
| writer | `src/lib/backfill/google-ads-universe-writer.ts` | the single generic writer; `VENDOR_FLOOR_DATE`, `DEFERRED_ENTRIES`, `decideVendorExhaustion` |
| progress log | `src/lib/backfill/universe-window-log.ts` (254 lines) | `universe_window_log` + the disk floor + lane spend |
| entry state | `src/lib/backfill/universe-run-state.ts` | `universe_run_state`, `universe_run_notice` |
| starter | `src/app/api/backfill/universe-start/route.ts` (176 lines) | publishes the first message per entry |
| surface list | `docs/google-ads-capture-universe.json` | 1,300 declared slots, regenerated by `scripts/google-ads-capture-universe.mjs` |

**THE STATE MODEL.** Two tables, no cursor in `sync_state`:
- `universe_window_log` — one row per (client, vendor, resource, segment, window_start). Columns
  **VERIFIED** from `information_schema`: `id, client_id, vendor, resource, segment, window_start, window_end,
  outcome, rows_written, requests_spent, refused_rows, disk_free_bytes, error, started_at, finished_at`.
  `outcome` is `'ok' | 'zero' | 'skipped' | 'error' | 'floor_stop' | 'quota_stop'` plus the transient
  `'running'`.
- `universe_run_state` — one row per (client, vendor, resource, segment); `vendor_exhausted_below` is the
  seal, `exhaustion_proof` its evidence, `rows_written` / `requests_spent` cumulative.
- `universe_run_notice` — the done signal. **VERIFIED: ZERO ROWS. It has never been written.** See §3 entry 21.

**OPEN/CLOSE, verbatim** (`universe-window-log.ts:126-137`) — note `started_at` is absent from the payload:

```ts
export async function openWindow(k: WindowKey, diskFreeBytes: number): Promise<void> {
  const { error } = await supabaseAdmin.from(TABLE).upsert(
    {
      client_id: k.clientId, vendor: VENDOR, resource: k.resource, segment: seg(k.segment),
      window_start: k.windowStart, window_end: k.windowEnd,
      outcome: 'running', disk_free_bytes: diskFreeBytes,
      rows_written: 0, requests_spent: 0, refused_rows: 0, error: null, finished_at: null,
    },
    { onConflict: 'client_id,vendor,resource,segment,window_start' }
  )
  if (error) throw new Error(`universe_window_log open failed: ${error.message}`)
}
```

**THE RESUME TEST, verbatim** (`universe-window-log.ts:244-254`) — terminal is a NEGATION, not an enum:

```ts
export async function windowAlreadyFinished(k: WindowKey): Promise<boolean> {
  const { data, error } = await supabaseAdmin
    .from(TABLE)
    .select('outcome')
    .eq('client_id', k.clientId).eq('vendor', VENDOR).eq('resource', k.resource)
    .eq('segment', seg(k.segment)).eq('window_start', k.windowStart)
    .maybeSingle()
  if (error) throw new Error(`universe_window_log resume read failed: ${error.message}`)
  const outcome = (data as any)?.outcome
  return !!outcome && outcome !== 'running'
}
```

**THE WINDOW-ADVANCE LOGIC, verbatim** (`route.ts:76-118`) — this is where the seal is NOT written:

```ts
async function advanceToNextWindow(a: {
  msg: UniverseMessage; clientId: string; label: string; startDate: string; entry: UniverseEntry
}): Promise<void> {
  const { msg, clientId, label, startDate, entry } = a
  const bound = shouldRepublish({ stillGoing: true, windowsRemaining: msg.windowsRemaining })
  if (!bound.republish) {
    console.log(`[universe] NOT RE-PUBLISHING ${clientId} ${label}: ${bound.reason}`)
    return
  }
  const nextEnd = addDays(startDate, -1)
  const nextStart = addDays(nextEnd, -(WINDOW_DAYS - 1))
  // ⛔ THE VENDOR FLOOR. Below it Google serves nothing, so walking past it spends quota to learn what the
  // artifact already recorded. The writer still owns the EXHAUSTION verdict; this only stops the publish.
  if (nextEnd < VENDOR_FLOOR_DATE) {
    console.log(`[universe] FLOOR REACHED ${clientId} ${label}: next window would end ${nextEnd}, below the ${VENDOR_FLOOR_DATE} vendor floor — not publishing`)
    return
  }
  ...
  if (gov.mayPublish) {
    await send(TOPIC, { ...msg, startDate: nextStart, endDate: nextEnd, ... },
      { idempotencyKey: `${clientId}|${label}|${nextStart}` } as any)
    return
  }
  const held: WindowKey = { clientId, resource: entry.resource, segment: entry.segment, windowStart: nextStart, windowEnd: nextEnd }
  const disk = await checkDiskFloor()
  await openWindow(held, disk.freeBytes)
  await closeWindow(held, { outcome: 'quota_stop', rowsWritten: 0, requestsSpent: 0, refusedRows: 0, error: gov.reason })
  console.log(`[universe] STAND-DOWN ${clientId} ${label} ${nextStart}..${nextEnd}: ${gov.reason}`)
}
```

**THE EXHAUSTION VERDICT, verbatim** (`google-ads-universe-writer.ts`), and its floor constant at `:156`:

```ts
export const VENDOR_FLOOR_DATE = '2022-03-05'
...
export function decideVendorExhaustion(args: {
  windowStart: string; rowsReturned: number; gaql: string; floorDate: string
}): VendorExhaustion {
  const { windowStart, rowsReturned, gaql, floorDate } = args
  if (rowsReturned > 0) {
    return { complete: false, exhaustedBelow: null, proof: `vendor returned ${rowsReturned} row(s) at/below ${windowStart} — the walk continues` }
  }
  if (windowStart > floorDate) {
    return { complete: false, exhaustedBelow: null,
      proof: `vendor returned 0 rows for [${windowStart}], which is ABOVE the measured floor ${floorDate} — that is ONE EMPTY WINDOW (dormancy), NOT exhaustion. The walk continues.` }
  }
  return { complete: true, exhaustedBelow: windowStart,
    proof: `vendor returned 0 rows for [${windowStart}] at/below the MEASURED floor ${floorDate} — corroborated by the probe that established the floor. via: ${gaql}` }
}
```

**THE DISK FLOOR** — `PROVISIONED_BYTES = 280 * 1024 ** 3` and
`FLOOR_BYTES = Math.max(15 * 1024 ** 3, Math.floor(PROVISIONED_BYTES * 0.2))` = 56 GiB
(`universe-window-log.ts:23,33`). The RPC `public.universe_disk_headroom(bigint)` returns
`least(provisioned_bytes - v_used, 536870912000 - v_used)`; it does not raise (`migrations/059`, commit
`512a2ab`, applied — **VERIFIED** by `pg_get_functiondef` 2026-08-08). Live at the time of writing:
used 173.13 GB, free 106.87 GB.

**THE GOVERNOR** — `decidePublishFleetAware({ spentRequestsToday: await readLaneSpendToday(), fleet: await
readGoogleSpendToday(), want: 1 })`. `readLaneSpendToday()` sums `universe_window_log.requests_spent`
server-side (`migrations/057`, commit `27ec3c9`). **This is the sole spend input, and §3 entry 16 is why it
under-reports.**

### 2b. Why the shape changed

**VERIFIED — DECISIONS `LORAMER_VENDOR_CATALOG_IS_THE_DENOMINATOR_V1` (2026-08-03).** The prior completeness
gate was CIRCULAR: `capture-surface.manifest.mjs` was seeded from `docs/LORAMER_DATA_COMPLETENESS.md` — a doc
a human wrote — and `check-capture-completeness.mjs` compared our breakdown-registry against THAT. Both sides
were ours, so it could only confirm we had what we already knew about. The law that replaced it: the
denominator comes from the vendor's own `GoogleAdsFieldService`, and our registry may only ever be the
numerator.

**MEASURED 2026-08-03 with 594 live requests on one account (Foam OH):** 14 of 38 surfaces captured, 19 of 53
segments on the surfaces we hold, **0 of 256 on the 24 we never asked for** — every number invisible to a
green gate.

**AND THE NAMING LAW, `LORAMER_CAPTURE_UNIVERSE_NAMED_FOR_THE_API_V1` (2026-08-03, Russ):** universes are named
for the VENDOR API, never the company — `google_ads`, not `google` — so GA4 can never inherit Google Ads' list.

**THE ARTIFACT, VERIFIED** by reading `docs/google-ads-capture-universe.json` (598,343 bytes, 2026-08-03):

```
slotAccounting: declaredSlots 1300 · emittedRows 1300 · probedTrue 1164 · probedFalse 136 ·
                delivering 559 · declined 590 · budgetExhausted 0
deliveryObservation: account "Foam OH 957d484e / customer 7688521852" · probeWindow 2026-03-01..2026-03-31 ·
                measuredUtc 2026-08-03 · googleRequests 594 · accountFloor "2022-03-05" ·
                accountDarkAfter "2026-04-05"
```

Of the 559 slots the vendor was observed to DELIVER on that account, **92 were captured by the legacy writers
and 467 were not** (**VERIFIED**, `delivers===true` × `capturedToday`). Twenty-five resources had ZERO
captured slots.

### 2c. Commit history of the walk

**VERIFIED** — `git log --follow`, all walk files:

- `a98bf88` 2026-08-03 LORAMER_GOOGLE_ADS_UNIVERSE_RUNNER_V1: the unattended runner — one message per entry per window, self-re-publishing until the vendor says stop
- `0384b41` 2026-08-03 LORAMER_GOOGLE_UNIVERSE_WRITER_V1: one writer, not 24 — the surface list is data, and a clock can no longer end a walk
- `069707e` 2026-08-03 LORAMER_VENDOR_CATALOG_IS_THE_DENOMINATOR_V1: the universal Google capture list becomes a regenerable artifact, and the law that stops it going stale
- `ca720e8` 2026-08-03 LORAMER_CAPTURE_UNIVERSE_NAMED_FOR_THE_API_V1: google → google_ads, because GA4 must never inherit Google Ads' list
- `fb49b90` 2026-08-03 LORAMER_UNIVERSE_ARTIFACT_EMITS_EVERY_SLOT_V1: every catalog slot emits a row, and the re-probe overturned the cardinality picture — the artifact was understating its own top slot by ~170x
- `e2605be` 2026-08-03 LORAMER_UNIVERSE_ENTITY_AXIS_V1: Flight 3 — the vendor names the grain, and the flight's own premise was false: the entity grain was already in every response and was being thrown away
- `5e34fb4` 2026-08-03 LORAMER_UNIVERSE_ONE_WINDOW_MEASURED_V1: the ceiling is a measurement now — 6,048,263 rows, 832 B/row, ~252 GB per client, below the old low end
- `a17caf4` 2026-08-03 LORAMER_UNIVERSE_DERIVED_TIME_V1: Route B — stop asking Google for arithmetic. 559 → 358 requests per window, and the row saving is 5.8%, not the 31% the item promised
- `ce76e5e` 2026-08-03 LORAMER_UNIVERSE_REFUSED_METRIC_V1: the probe now asks the question the walk asks, and a refused metric is no longer a zero — 559 → 356 requests per window, ETA 4.7 → 3.0 days
- `e3c73cd` 2026-08-04 LORAMER_UNIVERSE_WINDOW_LOG_V1: the walk did not fire — 226.7 GB needed, 49 GB above the floor
- `e408c98` 2026-08-04 LORAMER_UNIVERSE_NARROWED_SET_V1: the request set is 346 — and the walk still did not fire
- `1f7f722` 2026-08-04 LORAMER_UNIVERSE_BOUNDED_RUN_V1: "one window is a proof" needs a number, not an intention
- `a9520e5` 2026-08-04 LORAMER_BACKFILL_YIELDS_TO_PRODUCT_V1: the reserve is a floor now, not an ordering
- `cb7b762` 2026-08-04 LORAMER_REFUSED_RATIO_IS_NULL_V1: a refused metric is not a zero, and a ratio on one is not 0
- `e89253c` 2026-08-04 LORAMER_RESUME_MUST_ADVANCE_V1: the release died on message one — a resume that does not advance
- `f2bb307` 2026-08-05 LORAMER_ZERO_ROWS_IS_NOT_EXHAUSTION_V1: one empty window is not the end of history
- `27ec3c9` 2026-08-05 LORAMER_LANE_SPEND_IS_SERVER_SIDE_V1: the rate governor was reading 997 of 10,788
- `0c28a81` 2026-08-06 LORAMER_GOOGLE_OP_BUDGET_BACKFILL_LANE_COUNTED_V3: the fleet ceiling could not see its largest spender
- `512a2ab` 2026-08-07 LORAMER_UNIVERSE_DISK_CEILING_V1: 500 GiB is the authorization, 280 GiB is the limit, and the function says so on its own face

**DERIVED:** nineteen commits in five days, against the June engine's eight commits in twenty-two days.

### 2d. Queue config, `maxDuration`, `WINDOW_DAYS`

**VERIFIED — `vercel.json`, verbatim:**

```json
  "functions": {
    "src/app/api/queues/google-ads-universe/route.ts": {
      "experimentalTriggers": [
        {
          "type": "queue/v2beta",
          "topic": "google-ads-universe",
          "retryAfterSeconds": 60,
          "maxConcurrency": 2
        }
      ]
    }
  }
```

**No `maxDeliveries`. No dead-letter queue. No per-message TTL** (so Vercel's 24-hour default applies).

**VERIFIED — `route.ts:32-37`, verbatim:**

```ts
export const fetchCache = 'force-no-store'
export const maxDuration = 300

export const TOPIC = 'google-ads-universe'
/** Window size per message. Small enough that one message is one cheap request; the walk is the loop. */
export const WINDOW_DAYS = 30
```

**EVERY CONSUMER OF `WINDOW_DAYS`, the complete list (VERIFIED, grep):**

```
src/app/api/queues/google-ads-universe/route.ts:37   export const WINDOW_DAYS = 30
src/app/api/queues/google-ads-universe/route.ts:86   const nextStart = addDays(nextEnd, -(WINDOW_DAYS - 1))
src/app/api/backfill/universe-start/route.ts:125     const startDate = addDays(endDate, -(WINDOW_DAYS - 1))
src/app/api/backfill/universe-start/route.ts:147     window: { startDate, endDate, windowDays: WINDOW_DAYS }
```

**There is NO per-resource, per-entry or per-window override anywhere in the walk. VERIFIED** by grep for
`windowDays|window_days|perResource|resourceWindow|windowFor|windowSizeFor` across every walk file — the only
hits are the four lines above.

---

## §3 · EVERY PROBLEM, EVERY FIX, EVERY THEORY — COMPLETE LEDGER

Chronological. Each entry: **SYMPTOM · ROOT CAUSE (verbatim where the code is the evidence) · FIX + SHA or
OPEN · DURABLE STATE ON FAILURE vs SUCCESS PATH · GUARD, and whether it was ever SEEN RED.**

---

**#1 · 2026-06-03 — CROSS-REQUEST CURSOR RACE (June engine)**
SYMPTOM: a backfill driven by re-reading a DB cursor across requests raced itself.
ROOT CAUSE: loop control lived in the caller, not in one invocation.
FIX: `d14429b` — single-invocation internal loop. Became Lesson 26.
DURABLE STATE: success only, before the fix (a lost request lost its position). After: per-chunk, both paths.
GUARD: none mechanical; the lesson is prose. **Never seen red.**

---

**#2 · 2026-06-25 — META THROWS PAST RETENTION, STOPPING THE STEP SHORT (June engine)**
SYMPTOM: a Meta lap requesting pre-37-month windows threw, and the step stopped short of complete.
ROOT CAUSE: the shared 132-month floor was deeper than Meta serves.
FIX: `57b8b81`, `granularMonths: 36`.
⛔ THE FIX INTRODUCED #14's shape and says so in its own comment: *"the floor becomes an empty-success, i.e.
'complete'."*
DURABLE STATE: both paths (cursor written per chunk).
GUARD: none. **Never seen red.**

---

**#3 · 2026-07-30 — 51 FALSE `backfill_complete` CLAIMS (drain/rangeLap, not the June engine)**
SYMPTOM: cursors claiming complete over ground they never covered.
ROOT CAUSE: `rangeLap` sealed on WINDOW POSITION and had a zero-work seal —
`if (curEnd < floor) writeRangeCursor(clientId, key, floor, TRUE)`.
FIX (Flight A): `LORAMER_RANGELAP_COMPLETION_HONESTY_V1` — zero-work seal removed, anomalous cursor restarts,
both decisions extracted as pure exported functions (`resolveRangeLapWindowEnd`, `decideRangeLapCompletion`).
⛔ **FLIGHT B — THE REPAIR OF UP TO 43 CURSORS — IS OPEN.** QUEUE ★RANGELAP-CLAIM-DEFECT.
DURABLE STATE: success only — the seal was written, the absence of rows was not.
GUARD: `check-completion-claims.mjs` in `npm run check:data`. **SEEN RED: 51 violations on first run**, all
baselined so the 52nd fails.

---

**#4 · 2026-08-03 — THE CIRCULAR COMPLETENESS GATE**
SYMPTOM: a green completeness gate while 24 vendor surfaces had never been asked for.
ROOT CAUSE: `capture-surface.manifest.mjs` seeded from a human-written doc; `check-capture-completeness.mjs`
compared our registry against it. Both sides ours.
FIX: `069707e` — `LORAMER_VENDOR_CATALOG_IS_THE_DENOMINATOR_V1`; denominator now `GoogleAdsFieldService`.
DURABLE STATE: n/a (a gate, not a writer).
GUARD: the artifact + its regenerator. **Seen red by measurement: 14 of 38 surfaces, 0 of 256 segments.**

---

**#5 · 2026-08-03 — THE 740-SLOT PROBE/WRITER METRIC-SET GAP**
SYMPTOM: the probe asked a different question from the walk, so slot counts and costs disagreed.
ROOT CAUSE: probe and writer did not share a metric set; refused metrics were being counted as zeros.
FIX: `ce76e5e` — `LORAMER_UNIVERSE_REFUSED_METRIC_V1`: "the probe now asks the question the walk asks, and a
refused metric is no longer a zero — 559 → 356 requests per window".
Also `fb49b90` — every catalog slot emits a row; the re-probe found the artifact "understating its own top
slot by ~170x".
DURABLE STATE: n/a (measurement).
GUARD: `universe-artifact-slots.guard.mjs`. **Not observed red in this audit.**

---

**#6 · 2026-08-03 — DERIVED TIME FAMILIES BOUGHT 5.8%, NOT 31%**
SYMPTOM: six derived time families were believed to consume ~31% of storage.
ROOT CAUSE: a projection, not a measurement.
FIX: `a17caf4` — Route B, stop asking Google for arithmetic; **the commit message itself corrects the claim**:
"the row saving is 5.8%, not the 31% the item promised". Requests 559 → 358.
DURABLE STATE: n/a.
GUARD: `universe-derived-time.guard.mjs`. **Not observed red in this audit.**

---

**#7 · 2026-08-04 — RATIOS ON REFUSED DENOMINATORS WRITTEN 0 INSTEAD OF NULL**
SYMPTOM: 119,375 of 119,375 stamped rows carried `roas/cpa/cpc/ctr/cpm` computed on a denominator the vendor
had REFUSED.
ROOT CAUSE, verbatim (`google-ads-universe-writer.ts:397-400`): *"A RATIO BUILT ON A REFUSED METRIC MUST BE
NULL, NEVER 0. NULL AND 0 ARE DIFFERENT FACTS: a 0 ROAS is a CLAIM about performance; a null is an ABSENCE of
information."* — sitting directly beneath a `refusedMeaning` that said never to do exactly that.
FIX: `cb7b762` — `LORAMER_REFUSED_RATIO_IS_NULL_V1`.
DURABLE STATE: success path only — the wrong value was durable, its wrongness was not.
GUARD: `refused-ratio-is-null.guard.mjs`. **Not observed red in this audit.**

---

**#8 · 2026-08-04 — THE BARE-RETURN RESUME THAT KILLED THE WALK ON MESSAGE ONE**
SYMPTOM: the starter reported `started: true, published: 346` and the chain was already dead.
ROOT CAUSE, verbatim (`route.ts:130-135`): the already-finished branch was a bare `return`; releasing the walk
publishes 346 messages at the most recent window, that window had already been walked as the proof run, so all
346 returned early and NONE re-published.
FIX: `e89253c` — `LORAMER_RESUME_MUST_ADVANCE_V1`; the branch now advances.
DURABLE STATE: **NEITHER PATH.** A silent success wrote nothing at all — the defining property of the failure.
GUARD: `universe-runner.guard.mjs`. **Not observed red in this audit.**

---

**#9 · 2026-08-05 — FALSE VENDOR-EXHAUSTION SEAL (a dormant month read as exhaustion)**
SYMPTOM: a zero-row window sealed an entry as vendor-exhausted.
ROOT CAUSE: zero rows was being read as a statement about all earlier dates. The corrected reasoning is now in
the file, verbatim: *"A zero-row response is the vendor stating DORMANCY. It is not, and cannot be, a
statement about earlier dates: the query asked about ONE window and the answer describes ONE window."*
FIX: `f2bb307` — `LORAMER_ZERO_ROWS_IS_NOT_EXHAUSTION_V1`; exhaustion may now only be concluded at/below the
measured `VENDOR_FLOOR_DATE`. ⛔ A consecutive-empty-window threshold was considered and REJECTED in the code
comment: any N would be "a number chosen to make this account work".
DURABLE STATE: success only — the seal was durable, the doubt was not.
GUARD: `google-ads-universe-writer.guard.mjs`. **Not observed red in this audit.**

---

**#10 · 2026-08-05 — THE REQUEST COUNTER STUCK AT 1,000 (Supabase silent row cap)**
SYMPTOM: the governor authorised ~10,800 consecutive publishes and wrote zero `quota_stop` rows while the lane
overran its 6,000/day allowance by ~2×.
ROOT CAUSE: `readLaneSpendToday()` summed an un-ranged PostgREST select — **measured on the real path as
`content-range: 0-999/10788`, sum 997.** A silent cap, no error.
FIX: `27ec3c9` — `LORAMER_LANE_SPEND_IS_SERVER_SIDE_V1`; summed in Postgres via `migrations/057`
(`universe_lane_spend_today`).
⛔ **NOTE THE SHAPE: THIS DEFECT WAS CREATED BY THE FIX FOR THE PREVIOUS ONE** — the cumulative per-entry
counter was replaced with one row per window, which is correct, and which is exactly what crossed the page cap
on day one.
DURABLE STATE: success only.
GUARD: `universe-window-log.guard.mjs`. **Not observed red in this audit.**

---

**#11 · 2026-08-05 — DEPLOYMENT PINNING PREVENTED A FIX REACHING A RUNNING CHAIN**
SYMPTOM: the spend fix deployed at `27ec3c9` and was PROVEN correct, and the walk kept running the old binary
at `dpl_JATwGWTZ` (`f2bb307`) regardless — 236 consumer invocations in twelve minutes, all on the old
deployment, none on the new.
ROOT CAUSE (**WEB**, vendor-documented): Vercel Queues partitions topics by deployment ID in push mode —
"messages are delivered back to the same deployment that published them" — and every re-publish inherits the
pin.
FIX: none possible in code. The operator halt (`universe_disk_headroom` rewritten to raise) was the only lever;
the chain then died on the 24h message TTL. **VERIFIED**: that error cluster's last occurrence is
`2026-08-06T14:08:35Z` and it has not recurred.
DURABLE STATE: neither — the refusal fired before `openWindow`.
GUARD: none possible. **THE HONEST LIMIT: a fix for a running chain is not live until the chain is restarted
from the deployment that carries it.**

---

**#12 · 2026-08-05 — FABRICATED `DEFAULT_RESET_UTC` AND THE OTHER SELF-INVENTED CONSTANTS**
SYMPTOM: nine sites assume a fixed daily Google quota reset at 08:03:57 UTC.
ROOT CAUSE, **VERIFIED** (`src/lib/backfill/google-forward-reserve.ts:34`):

```ts
const DEFAULT_RESET_UTC: ResetTimeOfDay = { h: 8, m: 3, s: 57 }
```

It is not a clock time. It is `armed_at 2026-08-01T00:00:23.422Z` plus Google's own "Retry in 29014 seconds",
from ONE error on ONE day, since restated as a daily recurrence. Google documents a SLIDING 24-hour period
that "doesn't reset at precisely the same time every day".
Related self-invented mechanisms banked as law-9 precedents: *"withGoogleRetry, which every lane funnels
through"* (there were FOUR boundaries), *"catchup's fillDays skip fires BEFORE the budget gate"* (falsified),
*"the Google search-term floor is a vendor retention wall"* (it is `DEFAULT_DAYS = 90` in our own backfill),
and *"a human read of the Google Ads API Center UI"* (**that screen does not exist**).
FIX: **OPEN.** Counting since midnight under-counts against a sliding window — the direction that walks into
RESOURCE_EXHAUSTED believing there is headroom. Deliberately not changed; it tightens the throttle on live
capture lanes.
DURABLE STATE: n/a (a constant).
GUARD: `quota-sentinel-armed.guard.mjs` covers arming, not the constant. **Never seen red for this.**

---

**#13 · 2026-08-07 — `migration 019` SEEDED `google_campaign` UNCONDITIONALLY**
SYMPTOM: 15 Google clients carry `google_campaign` in `onboard_steps_done` while `sync_state` holds **ZERO
rows** for `platform='google_campaign'` anywhere in the database. The step can never run
(`cron/drain/route.ts:303` filters done steps out).
ROOT CAUSE, verbatim (`migrations/019_onboard_backfill_marker.sql:38-39`):

```sql
    select 'google_campaign'
      where pc.platform = 'google'
```

Every other step in that seed carries an `EXISTS` test against `metrics_daily` (`'account'` :34-36,
`'google_dimensional'` :43-45, `'meta_placement'` :49-56, `'shopify_deep'` :60-62, `'woo'` :66-67). This one
carries only a comment (:16-17): *"DONE for all google connections — VERIFIED this session"*. A session note
was promoted to a database fact for 15 connections.
**VERIFIED 2026-08-08:** no code path deletes `sync_state` rows —
`grep -rn "from('sync_state')" src/ scripts/ | grep -i delete` returns nothing, and migrations contain no
`DELETE FROM` / `TRUNCATE` / `DROP` against it. The cursors were never written, not deleted.
Same shape, smaller: `meta_placement` (5 of ~9 clients), `google_dimensional` (Influential Drones).
FIX: **OPEN.**
DURABLE STATE: the SEED is durable; the absence of evidence for it is not.
GUARD: none. **Never seen red.**

---

**#14 · ONGOING — POSITIONAL COMPLETENESS (`windowStart <= targetDate`, rows never consulted)**
SYMPTOM: a cursor claims coverage it does not have.
ROOT CAUSE, verbatim (`run-backfill.ts:268` and `:284-285`) — rows gate only the upsert at `:242`:

```ts
          backfill_complete: windowStart <= targetDate,
...
    if (windowStart <= targetDate) {
      complete = true
      break
    }
```

The sole protection is the `catch` at `:211-220`, which breaks WITHOUT marking complete. **That works for
Google Ads, which errors past its wall. It does not work for GA4.**
`ga-intelligence.ts:47-66`, verbatim — throws only on a non-2xx, otherwise returns `json.rows || []`:

```ts
  const json = (await res.json()) as GaRunReportResponse & { message?: string }
  if (!res.ok) {
    throw new Error(json.error?.message || json.message || `GA runReport HTTP ${res.status}`)
  }
  return json.rows || []
```

**WEB-CONFIRMED:** GA4 answers a pre-property-creation range with HTTP 200 and zero rows; `keepEmptyRows` does
not override "only data recorded by the property can be displayed". So a GA backfill descends ~7 empty years
to the `floorDate: '2015-08-14'` clamp and marks `complete = true`.
**VERIFIED LIVE:** every GA cursor reads `backfill_earliest_date = 2015-08-14` (`ga`: 11 rows; `ga_dimensional`:
11 rows) while the real data starts 2022–2023.
WooCommerce has the same shape from the other direction — `woocommerce-backfill.ts:36`: *"~11y floor;
completeness normally triggers earlier on an empty chunk"* — on a self-hosted store, where empty can be
transient.
FIX: **OPEN.** The correct model already exists one file over —
`decideRangeLapCompletion` (`drain-registry.ts:231-243`) splits `complete` (position) from `rowsCovered`
(rows), and documents why requiring rows to complete would infinite-loop.
DURABLE STATE: success only.
GUARD: `check-completion-claims.mjs` catches the RESULT (a dishonest `true`), not the mechanism.
**SEEN RED: 51 violations, and again on 2026-08-07 with 2 of 108 datable cursors.**

---

**#15 · 2026-08-07 — `nextStep()` IS DEAD CODE WHILE THE DOCS NAME IT AS THE MECHANISM**
SYMPTOM: ★DRAIN-STEP-DONE-AND-CURSOR-INCOMPLETE-DIVERGE is banked in DECISIONS:726, QUEUE:949 and the digest
as *"drain/route.ts:198,223 → nextStep, drain-registry.ts:691"*, with the fix "in the SHARED `nextStep()`".
ROOT CAUSE: **`nextStep()` HAS ZERO CALLERS REPO-WIDE. VERIFIED** — `grep -rn "nextStep"` over
`*.ts,*.tsx,*.mjs,*.js,*.sql,*.md` returns the definition, documentation prose, and one unrelated local
`const nextStep` in `scripts/build-resume-digest.mjs:129`. `drain/route.ts:19` imports
`DRAIN_REGISTRY, requiredSteps, GEO_WINDOW_DAYS, DrainConn` — not `nextStep` — and reimplements the predicate
inline at `:302-304`:

```ts
    const incomplete = DRAIN_REGISTRY.filter(
      (step) => step.platforms.includes(platform) && !curDone.includes(step.key),
    )
```

Patching `:691` would change nothing in production.
FIX: **OPEN**, and SMALLER than banked — the real sites are `drain/route.ts:302-304` and the mark-done write at
`:353-365`.
DURABLE STATE: n/a (a docs/code divergence).
GUARD: none. **Never seen red.**

---

**#16 · 2026-08-07 — THE DONE-ARRAY OUTRANKS THE CURSOR**
SYMPTOM: a step present in `onboard_steps_done` is never re-run no matter what its cursor says.
ROOT CAUSE: completion is recorded in TWO places nothing reconciles —
`platform_connections.onboard_steps_done` (what the scheduler selects on) and `sync_state.backfill_complete`
(what every gate, detector and human reads). When they disagree the SCHEDULER wins silently.
**VERIFIED LIVE 2026-08-08**, denominator first: 354 done-steps across 23 non-deleted clients — 322 done AND
cursor complete, **2 done but cursor incomplete**, 30 done with no cursor row under the mapped key (28 of
those genuine, per #13; 2 are an artifact of the step-key → cursor-key mapping for `woo`/`woo_variant`).
THE TWO:
- Bath Fitter | O'Gorman Bros · google · step `account` · cursor `google` · earliest NULL · complete=false
- Foam OH · meta · step `account` · cursor `meta` · earliest 2023-06-21 · target 2015-06-05 · complete=false
⚠ `updated_at` on both is TODAY — that is the forward sync touching the same row, not a backfill lap. Live
confirmation of ★FROZEN-DETECTOR-READS-UPDATED-AT-AS-FREEZE.
FIX: **OPEN.**
DURABLE STATE: the done-array is durable; the cursor's disagreement is durable too — and nothing reads both.
GUARD: the FLOOR_REACHED_NOT_COMPLETE leg of `check-completion-claims.mjs` catches ONE shape (cursor at its
floor). A step done while its cursor sits MID-WALK is still invisible. **SEEN RED 2026-08-07: 2 of 108
datable cursors, exit 1; GREEN after; MUTATION-PROVEN with `--inject-floor-not-complete`.**

---

**#17 · 2026-08-08 — THE 300s TIMEOUT POISON-MESSAGE LOOP**
SYMPTOM: `/api/queues/google-ads-universe` timing out at 300 seconds, **47 times in 12 hours**, last
`2026-08-08T14:47:23Z` on the current deployment, for three days, with no capture and no record.
ROOT CAUSE: a window too large for one invocation, plus a resume test that deliberately re-walks `running`.
`route.ts:33` `maxDuration = 300`; `vercel.json` `retryAfterSeconds: 60`, no max-attempts, no DLQ;
`route.ts:127-129`, verbatim:

```
  // ⛔ TERMINAL OUTCOMES ONLY. A row reading `running` is a window that DIED, not one that finished, so it
  // falls through and is walked again.
```

Open → vendor call → killed at 300s → never acknowledged → redelivered → `running` is not terminal → walked
again → forever.
FIX: **PARTIAL — TWO OPERATOR HALTS, NO CODE FIX.** `id 2871` (2025-12-07..2026-01-05) set to `outcome='error'`
at `2026-08-08 15:21:02.325085+00`, affected rows 1; `id 17959` (2025-11-07..2025-12-06) set to
`outcome='error'` at `2026-08-08 15:47:27.677887+00`, affected rows 1. Both windows are **STILL UNCAPTURED
AND UNQUEUED — nothing will re-walk them.**
AFTER THE SECOND HALT the chain advanced and walked cleanly: 2025-10-08 (619,713 rows, 4m20s), 2025-09-08
(350,112, 2m24s), 2025-08-09 (307,800, 2m09s), 2025-07-10 (ok), deepest reached 2025-06-10, **zero timeouts
since 15:47:27Z**. **DERIVED: this is an outlier at the top of the density curve, not a broken resource** —
and it corrects an earlier over-generalisation in this session that every window back to the floor would fail.
DURABLE STATE: **NEITHER PATH** — see #18.
GUARD: none. **Never seen red.**

---

**#18 · 2026-08-08 — `requests_spent` IS WRITTEN ONLY BY `closeWindow()`**
SYMPTOM: hundreds of killed attempts spent real Google requests and the governor billed the lane nothing.
ROOT CAUSE: `requests_spent` is set exclusively in `closeWindow` (`universe-window-log.ts:150-161`), which a
killed invocation never reaches. `openWindow` writes `requests_spent: 0`.
**VERIFIED:** both halted rows read `requests_spent = 0` after three days and after fifteen minutes
respectively; the trailing-24h recorded total (4,587 requests over 4,589 windows) excludes every attempt.
FIX: **OPEN.** This is the half of the fix that is unconditional.
DURABLE STATE: **SUCCESS PATH ONLY, and this is the single-cause finding of the whole audit.**
GUARD: none. **Never seen red.**

⛔ **MEASURED COST OF #18, ONE WINDOW, ONE TIMESTAMP RANGE — recorded so the governor's error is a number and
not an observation.** Window `17966` (`campaign_search_term_view`, 2025-05-11..2025-06-09) lived from
`2026-08-08T16:07:03.063937Z` to the operator halt at `2026-08-08T17:49:11.566619Z` — **1h42m**. Over exactly
that range, Vercel runtime errors on `/api/queues/google-ads-universe` report
**`Task timed out after 300 seconds` — count = 10**, last `2026-08-08T17:38:06Z`
(read with `since=2026-08-08T16:07:03Z`).

- **VERIFIED:** 10 invocations ran the full 300 seconds and were killed.
- **DERIVED (not verified, and the reason it cannot be verified IS the defect):** each of those 10 reached the
  vendor call — the row was opened, and nothing else in that handler takes 300 seconds — so **at least 10
  Google Ads requests were dispatched and NEVER COUNTED.** `requests_spent` read **0** for the entire life of
  the row and still reads 0 at the halt.
- ⇒ `readLaneSpendToday()` (`migrations/057:39`), the fleet backfill lane (`google-op-budget.ts:86,335`) and
  the operator's own `6000 - sum(requests_spent)` (`scripts/universe-walk-progress.sql:27`) were each short by
  **≥10 requests** across that window, on a lane whose whole purpose is to yield before the product does.
- ⚠ **THE FIGURE IS A FLOOR, NOT A TOTAL.** It covers ONE of three loops. `2871` ran the same way for three
  days (86 timeouts in the 3-day cluster read on 2026-08-08) and `17959` for 15 minutes; neither can be
  attributed exactly, for the same reason. The true fleet-wide undercount is larger and is not recoverable —
  the counter that would have recorded it is the one being fixed.

---

**#19 · 2026-08-08 — `openWindow()` UPSERT OMITS `started_at`, SO ATTEMPT COUNT IS UNKNOWABLE**
SYMPTOM: a row cannot say how many times its window was attempted.
ROOT CAUSE: the upsert payload (quoted in §2a) does not include `started_at`, so on the update branch the
column keeps its FIRST value. `id 2871` read a 3-day "duration" that is age since first attempt, not the
length of one.
FIX: **OPEN.**
DURABLE STATE: partial on failure (`outcome='running'` IS written), none of the attempt history.
GUARD: none. **Never seen red.**

---

**#20 · 2026-08-08 — THE FLOOR-REACHED PUBLISH PATH WRITES NO SEAL**
SYMPTOM: 253 of 346 entries read as unsealed forever.
ROOT CAUSE: `advanceToNextWindow` returns on `nextEnd < VENDOR_FLOOR_DATE` (quoted in §2a) writing NOTHING —
no `universe_window_log` row, no `universe_run_state.vendor_exhausted_below`. The seal is only ever written by
`decideVendorExhaustion`, which requires ZERO rows at/below the floor. Any entry whose deepest window returned
rows exits unsealed.
**VERIFIED LIVE:** 346 entries · 93 sealed · 253 unsealed — and **249 of those 253 have already walked to at
or below the 2022-03-05 floor.** Only 4 are genuinely owed more windows. Anything reading "unsealed" as "owed"
over-reports by ~62×.
FIX: **OPEN.**
DURABLE STATE: **NEITHER PATH** on the floor exit.
GUARD: none. **Never seen red.**

---

**#21 · 2026-08-08 — `universe_run_notice` HAS NEVER BEEN WRITTEN**
SYMPTOM: `select * from public.universe_run_notice` returns **zero rows** (**VERIFIED**; the table exists per
`migrations/051`, 11 columns).
ROOT CAUSE: the writer IS wired — `route.ts:232-234`:

```ts
  const states = await readAllEntryStates(clientId)
  const done = isClientComplete({ totalEntries: total, states })
  if (done.done) await writeCompletionNotice(clientId, states, total)
```

…but `isClientComplete` requires EVERY entry settled (`vendor_exhausted_below !== null || skipped_reason`),
and **#20 guarantees 249 entries never settle.** The done signal is unreachable by construction.
**DERIVED: #21 is a SYMPTOM OF #20, not an independent defect.** Fixing the floor-stop seal makes the notice
fire.
FIX: **OPEN** (downstream of #20).
DURABLE STATE: success only, and the success is unreachable.
GUARD: none. **Never seen red.**

---

**#22 · 2026-08-08 — `campaign|segments.hour` ERROR CARRIES ONLY A REQUEST ID**
SYMPTOM: the chain for that entry died and the stored diagnostic is unusable.
ROOT CAUSE / EVIDENCE, **VERIFIED** — the row's `error` column reads, in full:

```
{"request_id":"nJr0jCq60AffwC4bJlitqw"}
```

No message, no code, no status. Window `2024-02-16`, `outcome='error'`, `started_at 2026-08-07 22:08:17Z`.
`shouldRepublish({stillGoing:false})` ⇒ never republished. This is the house `.catch`/`[object Object]`
pathology in a new place.
FIX: **OPEN.**
DURABLE STATE: failure path wrote a row (good) with no usable content (the defect).
GUARD: none. **Never seen red.**

---

**#23 · CARRIED, NOT NEW — THE ACCOUNT-ROW-INVARIANT GUARD HAS NO DATE WINDOW**
`datesFor()` enumerates every date over all time with no `current_date` bound, so it flags IN-FLIGHT days and
manufactures a fresh violation every day in the ~8-hour gap the 00:15Z meta drain opens ahead of the 08:16Z
forward pass. **DIAGNOSED 2026-08-03, NOT FIXED.** Included so a `check:data` reader does not re-derive it.

---

## §3b · THE SINGLE-CAUSE TEST

For every defect in §3: was durable state written on the FAILURE path, or ONLY on the SUCCESS path?

| # | defect | durable state on FAILURE path? |
|---|---|---|
| 1 | cross-request cursor race | SUCCESS ONLY (pre-fix) |
| 2 | Meta throws past retention | BOTH |
| 3 | 51 false `backfill_complete` claims | SUCCESS ONLY |
| 4 | circular completeness gate | n/a (not a writer) |
| 5 | 740-slot probe/writer metric-set gap | n/a (not a writer) |
| 6 | derived time families 5.8% vs 31% | n/a (not a writer) |
| 7 | ratios on refused denominators | SUCCESS ONLY |
| 8 | bare-return resume | NEITHER |
| 9 | false vendor-exhaustion seal | SUCCESS ONLY |
| 10 | request counter stuck at 1,000 | SUCCESS ONLY |
| 11 | deployment pinning | NEITHER |
| 12 | fabricated `DEFAULT_RESET_UTC` | n/a (a constant) |
| 13 | migration 019 seeded `google_campaign` | SUCCESS ONLY |
| 14 | positional completeness | SUCCESS ONLY |
| 15 | `nextStep()` dead code | n/a (docs/code divergence) |
| 16 | done-array outranks cursor | SUCCESS ONLY |
| 17 | 300s poison-message loop | NEITHER |
| 18 | `requests_spent` only in `closeWindow()` | SUCCESS ONLY |
| 19 | `openWindow()` omits `started_at` | PARTIAL |
| 20 | floor-reached path writes no seal | NEITHER |
| 21 | `universe_run_notice` never written | SUCCESS ONLY (unreachable) |
| 22 | error carries only a request_id | FAILURE PATH WROTE (content unusable) |

**COUNTS**

- Durable state on the FAILURE path: **2** (#2 BOTH, #22 wrote-but-unusable)
- Durable state on the SUCCESS PATH ONLY, or on NEITHER: **15**
  (SUCCESS ONLY: #1, #3, #7, #9, #10, #13, #14, #16, #18, #21 = 10 · NEITHER: #8, #11, #17, #20 = 4 ·
  PARTIAL: #19 = 1)
- Not applicable (not a writer / a constant / a docs divergence): **5** (#4, #5, #6, #12, #15)

Total entries tabulated: 22.

---

## §3c · THE MEASUREMENT RECORD

**`campaign_search_term_view`, segment `''`, client Foam OH — EVERY window ever attempted. VERIFIED**,
`select window_start, window_end, outcome, rows_written, requests_spent, (finished_at - started_at) …`:

| window | outcome | rows | requests | duration |
|---|---|---|---|---|
| 2026-07-05..2026-08-03 | zero | 0 | 1 | 0.78s |
| 2026-03-07..2026-04-05 | ok | 262,880 | 1 | 2m16.76s |
| 2026-02-05..2026-03-06 | ok | 115,858 | 1 | 34.77s |
| 2026-01-06..2026-02-04 | zero | 0 | 1 | 0.53s |
| 2025-12-07..2026-01-05 | error (halted) | 0 | 0 | never completed |
| 2025-11-07..2025-12-06 | error (halted) | 0 | 0 | never completed |
| 2025-10-08..2025-11-06 | ok | 619,713 | 1 | 4m20.46s |
| 2025-09-08..2025-10-07 | ok | 350,112 | 1 | 2m23.71s |
| 2025-08-09..2025-09-07 | ok | 307,800 | 1 | 2m08.77s |
| 2025-07-10..2025-08-08 | ok | — | 1 | completed |
| 2025-03-02..2025-03-31 | ok | 242,596 | 1 | 1m31.33s |

**DERIVED — rows per second, per completed window:**
242,596 / 91.33s = **2,656** · 350,112 / 143.71s = **2,436** · 307,800 / 128.77s = **2,390** ·
619,713 / 260.46s = **2,379** · 262,880 / 136.76s = **1,922**. **Call it ~2,400 rows/sec, and note how flat
it is across a 5× range of row counts.**

**DERIVED — rows per day:** 3,862 (2026-02) · 8,087 (2025-03) · 8,763 (2026-03) · 10,260 (2025-08) ·
11,670 (2025-09) · **20,657 (2025-10, the densest)**. Two windows returned honest zeros.

**DERIVED — the ceiling is ROWS, not DAYS:** 300s × ~2,400 rows/s ≈ **720,000 rows per invocation**. The
619,713-row window used 260s — **87% of budget — and PASSED.**

⛔ **WINDOW_DAYS HAS NEVER BEEN VARIED FROM 30. EVERY WINDOW IN THE TABLE ABOVE IS 30 DAYS WIDE, SO THIS TABLE
CANNOT ANSWER WHICH WINDOW LENGTH IS SAFE.** The largest window length with a clean completion is 30 days,
which is also the only length ever attempted. What the table CAN say is that a 30-day window survives to at
least 619,713 rows.

⚠ **ASSUMED, NOT MEASURED:** that the two failed windows exceeded ~720,000 rows. Neither ever returned a row
count. They sit between a 619,713-row month and an honest-zero month, and Nov–Dec is plausibly the densest
search-term period of the year — but that is a hypothesis. **Do not bank it and do not size a fix on it.**

---

## §4 · COMPARE AND CONTRAST — THE JUNE ENGINE'S STATE MODEL WAS EQUALLY NAIVE; ITS DRIVER WAS BOUNDED

> Authored by the conversation layer (Claude). Recorded here as written. Claude Code's rebuttal is §9, not here.

- `run-backfill.ts` catches on error and deliberately does NOT mark complete: throw → no state change → safe
  retry. Completeness is positional (`windowStart <= targetDate`), rows never consulted. **SAME DEFECT CLASS
  AS THE WALK.**
- It survived because the DRIVER was bounded: a client-side lap loop, `MAX_CHUNKS`, a human watching a button.
  When a lap died, NOTHING retried it. **The human was the retry limiter.**
- The walk kept that state model and swapped the driver for an unbounded at-least-once queue with no DLQ.
  **"No state change on failure" now means INFINITE REDELIVERY instead of safe retry.**
- **CONSEQUENCE 1:** the one-click button, if it fires the walk, inherits this — a customer press can start a
  loop nobody sees.
- **CONSEQUENCE 2:** the June engine is NOT a template to return to. It is a template that was never
  load-tested.
- **SECOND STRUCTURAL DIFFERENCE:** June had ONE state row per client/platform that a lap could not finish
  without writing. The walk splits state across `universe_run_state` and `universe_window_log`, neither
  reconciling with `sync_state`, and the FLOOR-REACHED path writes to none of them — the mechanical reason 249
  entries read unsealed forever.

## §5 · WEB RESEARCH, MAPPED TO NAMED DEFECTS

> Authored by the conversation layer (Claude). Recorded here as written.

**POISON MESSAGES / DEAD-LETTER QUEUES → #17, #22.** Every DLQ rests on a delivery-attempt counter + a
threshold + a destination. Vercel Queues has NO DLQ; retries run until expiry; forced exponential backoff only
after 32 attempts. Standard guidance is 2–5 attempts, LOWER for expensive/paid-API jobs. At
`maxConcurrency: 2` one poison message consumed half the walk's capacity (head-of-line / contended work).
⇒ **WE MUST IMPLEMENT THE COUNTER; THE BROKER WILL NOT.**
- https://www.task-queues.com/queue-fundamentals-architecture/dead-letter-queues-poison-messages/
- https://www.glukhov.org/app-architecture/integration-patterns/dead-letter-queues

**CHECKPOINTING (Airbyte) → #18, #19, #20.** State is emitted DURING the read, often on every page; "state
represents the latest checkpoint successfully achieved," enabling resume regardless of success or failure;
the target is no more than 30 minutes without a checkpoint. **OUR checkpoint interval is one 30-day window,
written only at the end.**
- https://docs.airbyte.com/platform/connector-development/cdk-python/incremental-stream
- https://airbyte.com/blog/checkpointing

**RESUMABLE FULL REFRESH → #17.** A synthetic cursor based on the API's pagination strategy lets a stream
failing midway resume from the last checkpointed page.
- https://airbyte.com/blog/resumable-full-refresh-building-resilient-systems-for-syncing-data

**dbt MICROBATCH — NAMES OUR EXACT SHAPE → #17.** Traditional incremental reruns all 30 days on failure and
wastes the first 16; microbatch commits 1–16 and retries from 17. Built for "timeout-prone queries where
individual batches might fail due to resource limits but most batches complete fine."
- https://adriennevermorel.com/notes/microbatch-backfill-and-full-refresh-protection/

**ADAPTIVE RETRY REQUIRES INSTRUMENTATION → #18.** Failure rates and success counts, state per resource.
**We cannot adapt while `requests_spent` reads 0.**
- https://medium.com/@navidbarsalari/adaptive-retry-strategy-a-resilient-approach-for-modern-systems-ce2484d1cf00

## §6 · CLAUDE'S PLAN

> Authored by the conversation layer (Claude), written WITHOUT having read §7. Recorded here as written, in
> substance verbatim. Claude Code's attack on it is §9.

Four parts, strictly ordered.

**A. MAKE FAILURE DURABLE** (unconditional; addresses 15 of 22 per §3b). Increment an attempt counter at
`openWindow` BEFORE the vendor call. Refresh `started_at` per attempt. Increment `requests_spent` when the
request is ISSUED, not at close. Nothing about a killed invocation stays invisible.

**B. BOUND THE RETRIES.** At open time, `attempts >= 3` → write terminal `'error'` and return BEFORE spending
a request. The DLQ we do not have, in one indexed read, zero happy-path cost.

**C. SPLIT ON DEATH, NOT GLOBALLY.** A window that dies splits in half and publishes two messages, recursive
to a 1-day floor. No `WINDOW_DAYS` change, no per-resource table. Guards the CLASS: any resource exceeding the
ceiling is handled, not only `campaign_search_term_view`.

**D. RE-QUEUE** the two uncaptured windows: `2871` (2025-12-07..2026-01-05) and `17959`
(2025-11-07..2025-12-06).

**CROSS-CUTTING:** the cursor must carry ROWS SEEN, not only position. One field closes the 51 false
complete-claims, the GA4 empty-seal, and positional completeness together — and it is what lets a
customer-facing button say "complete" honestly.

---

## §7 · CLAUDE CODE'S INDEPENDENT PLAN

> Written after §1–§3c and WITHOUT reading §4–§6, which are empty by instruction. This is what the evidence
> above argues for on its own.

**THE ONE FINDING THAT ORDERS EVERYTHING ELSE.** §3b is not close: 15 defects wrote durable state only on the
success path or on neither, against 2 that wrote anything useful on failure. That is not twenty-two separate
bugs. **It is one architectural property — THE SYSTEM RECORDS WHAT WORKED AND FORGETS WHAT DIDN'T — appearing
twenty-two times.** Every "silent" symptom in this repo's history (a green gate over a hole, a governor
reading 997 of 10,788, a chain dead on message one, a lane spending quota that no counter sees) is that same
property wearing a different hat. Fix the property and the class stops; fix the instances and the class
returns under a new name, which is exactly what the last six weeks look like.

**STEP 1 — MAKE FAILURE DURABLE IN THE WALK. This is the whole plan's keystone and nothing else should ship
first.**
`closeWindow()` is the only writer of `requests_spent` and `outcome`, and a killed invocation never reaches
it. Three changes, one commit:
1. `openWindow()` writes `started_at` on EVERY open (it is absent from the upsert payload today) and
   increments an `attempts` counter, so #19 stops hiding the attempt history.
2. `openWindow()` records the request as SPENT AT DISPATCH, reconciled down by `closeWindow` if the call never
   went out — pessimistic accounting, because the failure direction of an optimistic counter is
   "spend the fleet's quota against a pause we cannot see" (the repo has already paid for that once).
3. A `running` row older than one `maxDuration` is TERMINAL BY CONSTRUCTION on the next read — the resume test
   at `universe-window-log.ts:253` gains an age check, so #17 cannot re-form without an operator.
**GUARD, same commit, SEEN RED FIRST:** the two halted rows and the stale-`running` state are sitting in the
database right now and make a red proof available without manufacturing one.

**STEP 2 — SEAL ON THE FLOOR-REACHED PATH.** `advanceToNextWindow` returns writing nothing when
`nextEnd < VENDOR_FLOOR_DATE`. Write the seal (or a distinct `floor_reached` terminal state) there. This
takes unsealed from 253 to ~4, makes "how much is left" answerable for the first time, and — per §3 #21 —
makes `universe_run_notice` fire, which closes a second defect for free. **Do not build a notice fix
separately; it is downstream.**

**STEP 3 — RE-QUEUE THE TWO ORPHANED WINDOWS.** `id 2871` and `id 17959` are two 30-day windows of real Foam
OH data that are marked terminal so the chain could move and are queued by nothing. Whatever Step 1 produces
must come back for them, and the audit is the only place they are currently written down.

**STEP 4 — SPLIT POSITION FROM COVERAGE IN `run-backfill.ts`.** `backfill_complete: windowStart <= targetDate`
is the June engine's one remaining live defect and it is the reason every GA cursor claims 2015-08-14. The
correct model is already written and guarded one file over (`decideRangeLapCompletion`, with its infinite-loop
reasoning). Reuse it; do not re-derive it.

**STEP 5 — THE `WINDOW_DAYS` QUESTION, AND MY ANSWER IS "NOT YET".** §3c says plainly that the length has never
been varied, so nobody in this repo knows what length is safe — including me. A blanket cut would triple the
message count for windows that finish in 35 seconds. **The evidence supports a retry-with-halved-window on a
timeout, not a smaller global constant**, and Step 1 is what makes that retry observable. If a per-resource
override is wanted anyway, note there is no mechanism for one today (§2d) and `DEFERRED_ENTRIES` is the
existing per-entry home to extend.

**STEP 6 — CLOSE THE SEEDED-DONE LIE (#13).** 15 clients cannot run `google_campaign` and nothing will ever
tell them so. Re-derive the `migration 019` seed against real cursor evidence, or clear the three affected
step keys and let the drain re-probe — which migration 019's own header says was the preferred posture.

**WHAT I WOULD NOT DO, stated so it is a decision and not an omission:**
- Not patch `nextStep()` (#15). It has no callers; the change belongs at `drain/route.ts:302-304`.
- Not touch `DEFAULT_RESET_UTC` (#12) in the same flight. It is wrong, and correcting it tightens the throttle
  on live capture lanes — that is its own flight with its own blast radius.
- Not re-release or re-scope the walk until Step 1 lands. The walk is currently healthy and advancing; the
  danger is not that it is stopped, it is that when it next fails we will again have no record of it.

**THE HONEST LIMIT OF THIS PLAN.** Steps 1–3 are mechanical and provable. Step 4 changes a completion semantic
that ~244 existing cursors were written under, so it needs a decision about what happens to those cursors
before it ships — and that decision is Russ's, not mine.

---

## §8 · FORK POINTS — DECISIONS FOR RUSS

> Neither side resolves a fork in its own favour. One line of tradeoff per side.

**SETTLED — §6 and §7 agree, no decision needed:**
- **S1 · Make failure durable FIRST, before anything else.** §6.A and §7 Step 1 are the same keystone, reached
  independently, from the same §3b count. Nothing else ships first.
- **S2 · `requests_spent` must be recorded at dispatch, not at close.** Both name it; both call the current
  behaviour the reason the governor is blind.
- **S3 · `started_at` must refresh per attempt and an attempt count must exist.** Both name it.
- **S4 · The two orphaned windows (2871, 17959) must be re-queued.** §6.D and §7 Step 3.
- **S5 · No global `WINDOW_DAYS` change.** §6.C rejects it explicitly; §7 Step 5 says "not yet" and gives the
  same reason (§3c: the length has never been varied, so nobody knows what is safe).
- **S6 · Position must be split from coverage on the cursor.** §6's cross-cutting rows-seen field and §7
  Step 4 are the same change; §6 states the customer-facing case for it and §7 names the existing
  implementation to reuse (`decideRangeLapCompletion`, `drain-registry.ts:231-243`).

**FORK 1 · HOW A DEAD WINDOW IS RECOVERED — split-on-death vs halve-and-retry.**
- §6.C: the dying window splits in half and publishes TWO messages, recursive to a 1-day floor.
  *Tradeoff:* covers any resource that exceeds the ceiling, including ones nobody has measured — but §9.C
  shows the publish path derives its successor from `startDate` alone and both halves would advance, creating
  two overlapping backward chains per split.
- §7 Step 5: the dying window is RE-PUBLISHED AS ITSELF at half length, one message, chain unchanged.
  *Tradeoff:* one successor, no fan-out, no overlap — but the halved length is not carried on the message
  today, so it needs a `windowDays` field that §6.C does not require.

**FORK 2 · WHAT AN EXHAUSTED ATTEMPT BUDGET MEANS — abandon vs quarantine.**
- §6.B: `attempts >= 3` → write terminal `'error'` and stop.
  *Tradeoff:* the loop can never re-form and it costs one indexed read — but a window that failed for a
  transient reason is abandoned permanently and silently, because `'error'` is terminal to
  `windowAlreadyFinished` (`universe-window-log.ts:253`).
- §9's counter-proposal: a distinct non-terminal-but-not-retryable outcome, or an `owed` list the fix comes
  back for.
  *Tradeoff:* nothing is lost and orphans are enumerable — but it is a second state to design and read, and
  §6.B's virtue is that it needs neither.

**FORK 3 · WHETHER THE FLOOR-REACHED SEAL IS IN SCOPE NOW.**
- §6: not addressed. Four parts, none touching `advanceToNextWindow`'s floor return.
- §7 Step 2: fix it in this arc, because it is what makes "how much is left" answerable and it closes #21
  (`universe_run_notice`) for free.
  *Tradeoff:* §6's silence keeps the flight small and shippable; §7 argues 253 unsealed entries make every
  progress reading wrong by ~62× until it is fixed, and the notice cannot fire at all.

**FORK 4 · WHETHER THE SEEDED-DONE LIE (#13) BELONGS IN THIS ARC.**
- §6: not addressed.
- §7 Step 6: re-derive the `migration 019` seed or clear the three step keys.
  *Tradeoff:* it is a different engine (the drain, not the walk) and folding it in widens the blast radius;
  leaving it means 15 clients keep a `google_campaign` step that can never run and nothing says so.

**FORK 5 · WHAT §4 CONCEDES ABOUT THE JUNE ENGINE, AND WHETHER §1c OVER-CLAIMED.**
- §4: the June engine's state model was equally naive; only its bounded driver saved it — so it is not a
  template to return to.
- §1c/§9: per-chunk checkpointing IS a measurable difference from the walk's per-window-at-end checkpoint, and
  §5's own Airbyte citation makes checkpoint interval the central property.
  *Tradeoff:* both are true of different properties (completeness semantics vs checkpoint granularity); the
  decision is whether the June engine's per-chunk write is worth preserving as a pattern or discarded with the
  rest of it.

---

## §9 · CLAUDE CODE'S ATTACK ON §6

> Rules of engagement: an objection must cite CODE (file:line, verbatim), a QUERY RESULT, or a VENDOR DOC. An
> objection resting on judgment is LABELLED JUDGMENT and does not win the point. Where §6 is correct and I
> cannot break it, I say so.

### 9.A — "MAKE FAILURE DURABLE" · I CANNOT BREAK IT. CONCEDED IN FULL.

§6.A and §7 Step 1 are the same change, reached independently from the same §3b count, and §6 states it more
sharply than I did ("nothing about a killed invocation stays invisible"). I have no objection to the substance.

Three implementation facts it must absorb, none of which is a rebuttal (see §Task-4 in the delivery report):
- **There is no column to increment.** `migrations/054_universe_window_log.sql:27-49` declares
  `id, client_id, vendor, resource, segment, window_start, window_end, outcome, rows_written, requests_spent,
  refused_rows, disk_free_bytes, error, started_at, finished_at`. **A migration is required.**
- **`openWindow`'s upsert cannot increment anything, and today it RESETS.** Verbatim
  (`universe-window-log.ts:127-135`): the payload is a literal object and PostgREST's upsert can only set a
  column to the value supplied, never to an expression over the existing row. It already writes
  `rows_written: 0, requests_spent: 0, refused_rows: 0, error: null, finished_at: null` on every open — so an
  `attempts` field written the same way would be reset to 1 on every redelivery, which is the exact opposite
  of the counter B depends on. **A.1 requires an RPC or a SQL function, not a payload change.**
- **`started_at` is absent from that payload**, which is precisely why #19 exists; adding it is a one-line
  change in the same upsert.

**RANK: no objection. §6.A stands, and B depends on it landing first — which §6's ordering already gets right.**

### 9.B — "BOUND THE RETRIES" · SERIOUS, and the challenge is (i)

**(i) DOES `attempts >= 3 → terminal 'error'` PERMANENTLY ABANDON A TRANSIENT FAILURE? YES, AS WRITTEN, AND
THE EVIDENCE IS ALREADY IN THE DATABASE.** `'error'` is terminal to the resume test —
`universe-window-log.ts:253`, verbatim:

```ts
  return !!outcome && outcome !== 'running'
```

So the window is skipped forever and the chain advances past it. **This is not a prediction: it is what
happened to ids 2871 and 17959 on 2026-08-08.** Both were set to `'error'`, both are recorded in §3 #17 as
**STILL UNCAPTURED AND UNQUEUED**, and the only reason we know they are owed is that this document writes them
down. §6.D re-queues those two by hand — which concedes the point: **the mechanism creates orphans, and D's
answer does not generalise to the third one.**

**CAN A TRANSIENT FAILURE BE DISTINGUISHED? PARTIALLY, AND NOT IN THE ONE CASE B EXISTS FOR.** The code
already separates several causes before they reach an attempt counter:
- a governor stand-down writes `outcome: 'quota_stop'` (`route.ts:116`)
- a disk breach writes `outcome: 'floor_stop'` (`route.ts:158`)
- a vendor error writes `outcome: 'error'` WITH the vendor's message and `requestsSpent: 1` (`route.ts:182`)
- a developer-scope quota pause is held upstream by `holdGoogleWork` before any work

⛔ **BUT A 300-SECOND KILL WRITES NOTHING** — the invocation dies before any catch, which is why the row sat at
`'running'`. So the single failure mode B is designed to bound is the one that leaves no evidence to classify
by. **B cannot tell a too-big window from a deploy, a 5xx or a cold start**, and at `retryAfterSeconds: 60`
three attempts can elapse inside one bad four-minute period.

**DOES §6 LOSE DATA IT SHOULD NOT? YES, unless the orphan is enumerable.** RANK: **SERIOUS**, not FATAL —
because the defect is one field wide, not structural. **CHEAPER, MORE DURABLE ALTERNATIVE:** keep B's counter
and B's stop, but make the terminal state *say what it is* — a distinct outcome (or an `owed` boolean) meaning
"we stopped asking, and this window is still owed". `windowAlreadyFinished` then skips it (loop broken, B's
whole purpose intact) while a one-line query enumerates every orphan the system has ever created. That costs
one CHECK-constraint value and removes the need for D to be a hand-written list.

### 9.C — "SPLIT ON DEATH" · **FATAL AS WRITTEN.** The publish path assumes exactly one successor.

**(ii) DOES THE PUBLISH PATH SUPPORT FAN-OUT?** Mechanically yes, semantically no.

`send` is a plain call (`route.ts:17`, `import { handleCallback, send } from '@vercel/queue'`) and nothing
stops a second invocation of it. **But `advanceToNextWindow` derives its successor from `startDate` alone**,
verbatim (`route.ts:85-86`):

```ts
  const nextEnd = addDays(startDate, -1)
  const nextStart = addDays(nextEnd, -(WINDOW_DAYS - 1))
```

**THE THREE BREAKS, in order of severity:**

**1 · TWO OVERLAPPING BACKWARD CHAINS PER SPLIT — FATAL.** Split `W = [2025-11-07 .. 2025-12-06]` into
`A = [2025-11-07 .. 2025-11-21]` and `B = [2025-11-22 .. 2025-12-06]`. Each half, on completion, calls
`advanceToNextWindow` with its OWN `startDate`:
- B advances from `2025-11-22` → publishes `[2025-10-23 .. 2025-11-21]`
- A advances from `2025-11-07` → publishes `[2025-10-08 .. 2025-11-06]`

B's successor **overlaps A's own range and then walks past it**. Both chains continue to the floor. Every
split permanently doubles the walk for that entry, and a recursive split to a 1-day floor is a **binary tree
of chains, not two messages.** Nothing merges them: the idempotency key is
`` `${clientId}|${label}|${nextStart}` `` (`route.ts:107`), which is per-`nextStart` and therefore distinct for
every overlapping chain, so it dedupes nothing here.

**2 · THE SPLIT IS NOT STICKY.** `UniverseMessage` (`route.ts:39-61`) carries `clientId, userEmail,
customerId, entry, startDate, endDate, windowsRemaining?` — **there is no `windowDays` field.** A 15-day half
that completes publishes a **30-day** successor, because `nextStart` is computed from the module constant. The
split survives exactly one hop and then reverts to the size that killed it. **C as written does not persist
its own remedy.**

**3 · IT MULTIPLIES #20 AND DELAYS #21.** The FLOOR-REACHED check is `if (nextEnd < VENDOR_FLOOR_DATE)`
(`route.ts:89`) and that path writes NO seal (§3 #20). With N chains per entry, N of them hit the floor and N
exit unsealed. `isClientComplete` requires EVERY entry settled
(`universe-run-state.ts:82-92`), so more chains means the notice is further from firing, not closer.

**WHAT IT DOES NOT BREAK:** the `(client_id, vendor, resource, segment, window_start)` upsert key is safe —
two halves have different `window_start`, so they get distinct rows and neither clobbers the parent. **The
seal logic is also untouched**, because `decideVendorExhaustion` only reads `windowStart`, `rowsReturned` and
`floorDate`. So (ii)'s three sub-questions answer: **key SAFE · seal SAFE · FLOOR-REACHED check BROKEN by
multiplication, and the advance path broken outright.**

**RANK: FATAL as written. CHEAPER, MORE DURABLE ALTERNATIVE THAT KEEPS C'S GOAL:** re-publish the dying window
**as itself at half length** — ONE message, same `startDate`, `endDate` unchanged is wrong so carry an explicit
`windowDays` on the message and have `advanceToNextWindow` read it instead of the constant. One successor, no
fan-out, no overlap, and the halved size travels with the chain. This also keeps C's real virtue, which I
concede is the best idea in §6: **it guards the CLASS rather than one resource, and it needs no per-resource
table.**

### 9.D — "RE-QUEUE THE TWO WINDOWS" · MINOR, and correct as far as it goes

Right, necessary, and it is the only part of §6 that repairs existing damage. Two objections, both small:
- **It is a hand-written list, and 9.B shows the mechanism keeps producing orphans.** Generalise it or accept
  that every future orphan needs a human to notice it. RANK: **MINOR** (it becomes moot if 9.B's alternative
  is adopted).
- **There is no re-queue path today.** The only publisher of a first message per entry is
  `/api/backfill/universe-start` (`route.ts:125`), which computes `startDate` from `WINDOW_DAYS` and the most
  recent window — it cannot target an arbitrary historical window. **D needs a route or a script that does not
  exist**, and §6 does not say which. RANK: **MINOR**, but it is unbuilt work hiding inside a one-line item.

### 9.CROSS-CUTTING — "THE CURSOR MUST CARRY ROWS SEEN" · I CANNOT BREAK IT, AND IT IS BETTER THAN MY §7 STEP 4

Correct, and more valuable than I stated it. One field does close three things at once, and §6 names a fourth
I did not: **it is what lets a customer-facing button say "complete" honestly.** §7 Step 4 said the same change
in weaker terms.

The only thing I add, and it strengthens rather than rebuts: **the field already exists and is already
guarded, one file over.** `decideRangeLapCompletion` (`drain-registry.ts:231-243`) returns
`{ complete, rowsCovered }` and its header documents why requiring rows to *complete* would infinite-loop
against the daily cap. **Reuse it; do not re-derive it** — re-deriving is how this repo got two floors for one
disk. **RANK: no objection.**

### 9.(iv) — DOES §6 ADDRESS THE 249 UNSEALED FLOOR-REACHED ENTRIES? **NO. IT DOES NOT.**

Nothing in A, B, C, D or the cross-cutting field touches `advanceToNextWindow`'s floor return
(`route.ts:89-92`), which is the sole mechanical cause of #20. Consequences, all verified: 253 of 346 entries
read unsealed while **249 have already walked to at or below the floor**; any progress reading is wrong by
~62×; and `universe_run_notice` **has never been written** (#21) because `isClientComplete` cannot be
satisfied. RANK: **SERIOUS OMISSION**, and it is FORK 3.

### 9.(v) — WHICH OF §3b'S SUCCESS-ONLY / NEITHER DEFECTS DOES §6 LEAVE OPEN?

§6 closes or addresses: **#17** (B + C), **#18** (A), **#19** (A), **#3** and **#14** (cross-cutting rows-seen),
**#9** partially (rows-seen makes a zero-row seal visible).

**§6 LEAVES OPEN, by number:**
- **#13** — `migration 019` seeded `google_campaign` for 15 clients with no cursor; the step can never run.
- **#16** — the done-array outranks the cursor at `drain/route.ts:302-304`; 2 live divergences.
- **#20** — the FLOOR-REACHED path writes no seal; 249 entries.
- **#21** — `universe_run_notice` never written (downstream of #20).
- **#11** — deployment pinning. **Unfixable in code, and §6 is right not to try.**

(#1, #7, #8, #10 are already fixed and are historical entries; #4, #5, #6, #12, #15 are not writers.)

### 9 — SUMMARY OF RANKINGS

| §6 part | verdict | rank |
|---|---|---|
| A · make failure durable | **cannot break it — conceded in full** | — |
| B · bound the retries | abandons transient failures permanently; orphan not enumerable | **SERIOUS** |
| C · split on death | publish path assumes one successor; two overlapping chains per split; split not sticky | **FATAL as written** |
| D · re-queue the two windows | correct; hand-written list, and no re-queue path exists | **MINOR** |
| cross-cutting · rows seen | **cannot break it — better than my §7 Step 4** | — |
| (iv) 249 unsealed entries | not addressed at all | **SERIOUS OMISSION** |

**WHAT I CANNOT BREAK, STATED PLAINLY SO THE CONCESSION IS NOT BURIED:** §6.A is right and is the keystone.
The cross-cutting rows-seen field is right and is better argued than my own version of it. §6.C's *goal* —
guard the class, not the resource, with no per-resource table — is the best single idea in either plan, and my
objection is to its mechanism, not its intent. **§4's central claim is also correct and corrects me:** I wrote
in §1c that the June engine "writes durable progress on the FAILURE path by construction", and §4 is right
that this says nothing about its completeness semantics, which are the same positional defect as the walk's.
**ONE THING §4 UNDERSTATES, and I label it as an objection with a citation rather than a preference:**
per-chunk checkpointing versus one checkpoint at the end of a 30-day window is a real, measurable difference,
and §5's own Airbyte citation ("no more than 30 minutes without a checkpoint") makes checkpoint interval the
central property — so the June engine's per-chunk write is worth keeping as a pattern even if nothing else
about it is. RANK: **MINOR.**

**JUDGMENT (does not win a point, labelled per the rules):** I think §6's strict ordering A → B → C → D is
correct and better than presenting the parts as independent, because B is unimplementable without A's counter
and C is undiagnosable without A's instrumentation. That is a preference about sequencing, not evidence.

---

## §10 · FALSIFICATIONS — CLAIMS IN THIS DOCUMENT THAT LATER READS PROVED WRONG

> ⛔ RECORDED AS FALSIFICATIONS, NOT SILENTLY SUPERSEDED (Russ, 2026-08-08). A corrected claim that is quietly
> edited leaves the reasoning that produced it intact and re-derivable. Each entry names the WRONG claim, the
> file:line that disproves it, and what changes downstream.

### F-1 · §9.D — "there is no re-queue path today" is WRONG ABOUT THE DATE

**THE CLAIM (§9.D):** *"There is no re-queue path today. The only first-message publisher is
`/api/backfill/universe-start`, which computes `startDate` from `WINDOW_DAYS` and the most recent window
(`universe-start/route.ts:125`) and cannot target an arbitrary historical window."*

**FALSIFIED BY `src/app/api/backfill/universe-start/route.ts:37,49-51`, verbatim:**

```ts
  const endDate = url.searchParams.get('endDate') || ''
  ...
  if (!clientId || !/^\d{4}-\d{2}-\d{2}$/.test(endDate)) {
    return NextResponse.json({ error: 'clientId and endDate=YYYY-MM-DD are required — the first window is explicit, never inferred from a clock' }, { status: 400 })
  }
```

`endDate` is an **explicit, required, validated parameter**, and its own error message says the first window is
never inferred from a clock. The starter has always been able to target an arbitrary historical date.

**WHAT IS ACTUALLY MISSING, and the correction narrows the work rather than widening it:**
- **ENTRY SCOPE** — `selectableEntries(doc)` at `:87` and `entries.slice(0, gov.allowance)` at `:126` publish
  for *every* entry. A re-walk of one window would fan out to all 346.
- **`windowDays`** as a starter param, because `startDate = addDays(endDate, -(WINDOW_DAYS - 1))` at `:125`
  uses the module constant.
- **An idempotency discriminator** — see F-3.
- **NOT missing:** the chain bound. `?windows=1` already stops a re-walk starting a second backward chain
  (`universe-window-log.ts:105-107`, parsed at `universe-start/route.ts:43-47`).

### F-2 · §3 #21 — "`universe_run_notice` is purely downstream of #20" is WRONG

**THE CLAIM (§3 #21):** *"DERIVED: #21 is a SYMPTOM OF #20, not an independent defect. Fixing the floor-stop
seal makes the notice fire."*

**FALSIFIED BY A DENOMINATOR MISMATCH, computed 2026-08-08 from `docs/google-ads-capture-universe.json`
against the two filters:**

- `queues/google-ads-universe/route.ts:231` — `doc.entries.filter(e => e.delivers === true && (e.segment ===
  null || e.dateCombinable === true)).length` = **559**
- `selectableEntries(doc)` (`google-ads-universe-writer.ts:212-216`), which the starter actually publishes
  from, adds two more exclusions (derived-time segments, `DEFERRED_ENTRIES`) = **346** — matching the 346 rows
  in `universe_run_state` exactly.

`isClientComplete` requires `states.length >= totalEntries` (`universe-run-state.ts:85-87`). **346 < 559, so
the done signal is unsatisfiable BY CONSTRUCTION, with or without the seal.** The notice is downstream of
**TWO** defects, and fixing only the floor path would have left it silently never firing with no new
explanation.

⛔ **AND THE FIX HAS ITS OWN TRAP, which is why Amendment 4 exists:** simply changing `:231` to
`selectableEntries(doc).length` makes `complete` mean **346 of 559**, with 213 catalog entries excluded and
nothing saying so — a green flag over a hole, which the governing law forbids outright. The notice therefore
carries BOTH denominators (`entries_catalog_total`, `entries_excluded`, added in `migrations/060`) with the
per-entry exclusions and their reasons enumerable from `detail`.
**VENDOR_CATALOG_IS_THE_DENOMINATOR STANDS — the catalog is not narrowed; the debt is made visible.**

### F-3 · §9.B's remedy was right, and the FIRST TWO ORPHANS WERE STORED IN THE WRONG STATE

§9.B proposed a distinct terminal value meaning "we stopped asking, and this window is still owed", rather
than a bare `'error'`. That was adopted as `'abandoned_owed'` (`migrations/060`). **The consequence the audit
did not state:** ids `2871` and `17959` had already been halted into `'error'` on 2026-08-08, so **the first
two orphans the system ever created would have been the only two its own owed-list could not see.**
`migrations/060` moves them, asserting exactly 2 rows.

### F-4 · §9's "every window of this resource is a candidate for the same failure" was OVER-GENERALISED

Stated during the session and corrected in `§3 #17` the same day: four windows immediately behind the failing
ones completed cleanly. **Updated measurement, 2026-08-08:** `campaign_search_term_view` has now completed
**2025-10-08 (619,713 rows / 260s), 2025-09-08 (350,112 / 144s), 2025-08-09 (307,800 / 129s), 2025-07-10
(334,634 / 161s), 2025-06-10 (571,175 / 275s)** and failed **2025-12-07, 2025-11-07, 2025-05-11**.
⛔ **`2025-06-10` USED 275s OF A 300s BUDGET — 92%, THE CLOSEST MEASURED PASS**, and the window immediately
behind it is the one that died. The resource is **marginal at 30 days**, not broken: the failures cluster at
the top of the density curve and are one window away from the passes.

### F-5 · `CONTINUE_HERE.md:57-60` — both claims stale (recorded here because the opener is not this doc's to edit)

It says `universe_disk_headroom()`'s body "is a bare `raise exception`" and that "THE ORIGINAL BODY IS NOT
COMMITTED ANYWHERE IN THIS REPO". Live `pg_get_functiondef` returns the `migrations/059` body — it computes
`least(provisioned − used, 500 GiB − used)` and does **not** raise — and `059` was committed at `512a2ab` on
2026-08-07 and is applied. The restore that opener calls for is not owed.
