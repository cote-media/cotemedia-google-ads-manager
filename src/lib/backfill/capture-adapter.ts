// LORAMER_CAPTURE_ADAPTER_CONTRACT_V1 — ONE CORE, N ADAPTERS. THE SEAM.
//
// ⛔ THE LAW THIS RESTS ON (ESSENCE, banked 2026-08-08):
// **THE RESUMABLE UNIT IS THE DAY BECAUSE THE WAREHOUSE IS KEYED BY DAY. THE VENDOR'S FETCH UNIT IS AN
// ADAPTER CONCERN.** `metrics_daily` is keyed by `(client, platform, entity_level, breakdown_type, DATE)`,
// so "which days do I still owe" is answerable for any platform whose rows land there — measured
// 2026-08-08: google 5 entity_levels / 26 breakdowns, meta 4/26, ga 1/13, shopify 3/16, woocommerce 3/12.
//
// ⛔ WHY A CONTRACT AND NOT FOUR ENGINES. Copying is how one defect ships four times and gets fixed once.
// But a shared core held together by conditionals is worse than four honest engines, so the test applied to
// every field below is: **does this differ between platforms as DATA, or as BEHAVIOUR?** Data goes in the
// adapter. Behaviour that differs goes in the adapter as a DECLARED CAPABILITY the core dispatches on —
// never as an `if (platform === …)` in the core. `capture-adapter-seam.guard.mjs` enforces that the core
// does not name a platform at all.
//
// ⛔ AND THE FOUR THINGS THAT ONLY *LOOKED* NEUTRAL, each of which is a field here rather than a constant
// somewhere in the core:
//   1. SIZING DIRECTION — on Google a query is ONE OPERATION AT ANY SPAN, so a bigger window is cheaper per
//      day. On GA4 token cost RISES WITH DATE-RANGE LENGTH, so a bigger window costs MORE. "Size up to the
//      row budget" is actively wrong there. The direction is DATA.
//   2. THE METER — five incomparable units (see `Meter`).
//   3. THE RETENTION FLOOR — three of five platforms have NO vendor wall at all.
//   4. DAY-CLOSURE ENTITLEMENT — Google may infer closure from ordering; Shopify may not.

// ─────────────────────────────────────────────────────────────────────────────────────────────────────────
// FETCH SHAPE — and the two-phase case is designed in NOW, not discovered in the third adapter
// ─────────────────────────────────────────────────────────────────────────────────────────────────────────
/**
 * ⛔ TWO PLATFORMS DO NOT STREAM AT ALL — THEY HAND BACK A DURABLE JOB HANDLE, AND FOR THEM THE INVOCATION
 * DOES NOT HAVE TO SURVIVE THE WORK. That is BETTER than streaming, not worse, which is exactly why it is a
 * declared capability rather than a fork:
 *   · **Shopify bulk** — `bulkOperationRunQuery` → poll `bulkOperation(id:)` → download a JSONL URL that
 *     EXPIRES AFTER ONE WEEK. Operations may run for 10 days; up to 5 concurrent (API 2026-01+); **the bulk
 *     query's execution is NOT rate-limited**, only the mutation and the polls.
 *   · **Meta async insights** — POST `/insights` → `report_run_id` → poll `async_status` /
 *     `async_percent_completion`. The id EXPIRES AFTER 30 DAYS and a job CANNOT be resumed; it is resubmitted.
 *
 * `'stream'` is the DEGENERATE ONE-PHASE CASE of `'job'`: submit and collect happen in the same invocation.
 * Writing the core against the two-phase shape costs nothing now and avoids re-opening it later.
 */
export type FetchShape = 'stream' | 'job'

// ─────────────────────────────────────────────────────────────────────────────────────────────────────────
// DAY-CLOSURE ENTITLEMENT
// ─────────────────────────────────────────────────────────────────────────────────────────────────────────
/**
 * ⛔ `coveredDaysStrict` RULE (a) — "a later day has rows, therefore the earlier day is closed" — IS ONLY
 * SOUND IF DELIVERY IS ORDERED BY DAY. Google earns it: `ORDER BY segments.date`, and the stream is checked
 * at runtime rather than trusted. **Shopify does not**: `orders(first: 250, query: …)` is an opaque cursor
 * connection with no ordering guarantee that could be verified from the documentation, so inferring closure
 * from a later day would be a false claim made only sometimes — worse than one made always.
 *
 * THE PREDICATE DOES NOT CHANGE. The adapter DECLARES what it may claim, and an adapter that cannot declare
 * a MECHANISM falls back to rule (b), the explicit `day_committed` record, which is already built and
 * already optional.
 */
export type DayClosure =
  | {
      rule: 'later-day-closes'
      /** ⛔ THE MECHANISM, NOT A PROMISE. "the vendor sorts" is not a mechanism; "ORDER BY segments.date" is. */
      mechanism: string
      /** Whether the adapter VERIFIES ordering at runtime instead of trusting the request. */
      runtimeChecked: boolean
    }
  | {
      rule: 'explicit-commit-only'
      /** Why this adapter is not entitled to rule (a). Recorded so the entitlement can be re-earned. */
      why: string
    }

// ─────────────────────────────────────────────────────────────────────────────────────────────────────────
// RETENTION FLOOR — nullable, and a null floor must be STRUCTURALLY unable to claim exhaustion
// ─────────────────────────────────────────────────────────────────────────────────────────────────────────
/**
 * ⛔ THREE OF FIVE PLATFORMS HAVE NO VENDOR WALL:
 *   Google Ads  37 months, documented · Meta 37 months, rolling (`date_preset=lifetime` removed in Graph
 *   v10.0, replaced by `maximum`) · **GA4 NONE for the Data API** — standard reports and the Data API are
 *   NOT bound by the retention setting; 2/14 months (26/38/50 on 360) binds EXPLORATIONS only ·
 *   **Shopify NONE** and **WooCommerce NONE** — it is the merchant's own database.
 *
 * `floorDate: null` means THERE IS NO VENDOR WALL, which is a completely different fact from "we have not
 * measured one". `decideExhaustion` below cannot return `complete: true` for a null floor by construction —
 * that is the enforcement, not a convention.
 */
export interface RetentionFloor {
  /** ISO date, or null when the vendor imposes NO wall. */
  floorDate: string | null
  source: 'vendor-documented' | 'vendor-measured' | 'account-derived' | 'none'
  /** The doc, the measurement, or the field the date came from. A floor with no provenance is a guess. */
  citation: string
}

// ─────────────────────────────────────────────────────────────────────────────────────────────────────────
// THE METER — five incomparable units
// ─────────────────────────────────────────────────────────────────────────────────────────────────────────
/**
 * ⛔ THE GOVERNOR'S INTERFACE IS SHARED; EVERY CONSTANT AND THE METER ITSELF IS ADAPTER DATA. These are not
 * the same number in different clothes:
 *   · **Google Ads** — 15,000 operations/day; a query is ONE operation regardless of span, and paginated
 *     requests carrying a valid next_page_token are not counted at all.
 *   · **GA4** — 200,000 core tokens per property per DAY, 40,000 per HOUR, 14,000 per project per property
 *     per hour, 10 concurrent. Cost is VARIABLE per call and rises with date-range length and row count.
 *   · **Meta** — Business Use Case rate limiting, a PERCENTAGE utilisation per AD ACCOUNT across THREE
 *     simultaneous meters (`call_count`, `total_cputime`, `total_time`), each throttling at 100, reported in
 *     the `X-Business-Use-Case-Usage` header.
 *   · **Shopify** — a leaky bucket with a 1,000-point ceiling enforced BEFORE execution on the REQUESTED
 *     cost; **bulk operation execution is not charged at all**.
 *   · **WooCommerce** — none documented. It is the customer's own WordPress host, so the real constraint is
 *     not overloading it.
 *
 * ⛔ `unit` AND `costDirection` ARE REQUIRED SO A BARE NUMBER CANNOT SATISFY THIS. A meter that is just a
 * daily cap is a Google-shaped constant wearing an interface, and the guard refuses it.
 */
export interface Meter {
  /** Human-readable, e.g. 'operations/day', 'core tokens/property/day', 'BUC utilisation %'. */
  unit: string
  /** The cap in `unit`. */
  cap: number
  /** ⛔ Whether a LONGER window costs more. See `SizingPolicy`. */
  costDirection: CostDirection
  /**
   * Expected cost of ONE fetch covering `days` days, in `unit`.
   * ⛔ IT TAKES `days` BECAUSE FOR SOME VENDORS THAT IS THE WHOLE POINT — on Google it is constant, on GA4
   * it is not, and a signature without `days` would have hidden that difference behind a constant.
   */
  costOf(days: number): number
  /**
   * Spent so far in the current window, in `unit`.
   * ⛔ `null` MEANS UNREADABLE, AND AN UNREADABLE METER HOLDS. It must never be read as zero spend — that is
   * a governor granting itself unlimited quota because its instrument broke.
   */
  spentSoFar(): Promise<number | null>
}

/**
 * ⛔ THE COST CURVE'S **DIRECTION** IS ADAPTER DATA, NOT A CONSTANT TO TUNE.
 *   `'flat-per-request'` — one operation at any span (Google Ads). A BIGGER window is CHEAPER per day, so
 *                          size UP to whatever our own write throughput can absorb.
 *   `'rises-with-range'` — cost grows with the range (GA4 tokens). A bigger window costs MORE, so "size up
 *                          to the row budget" is ACTIVELY WRONG and the policy must trade the two off.
 */
export type CostDirection = 'flat-per-request' | 'rises-with-range'

// ─────────────────────────────────────────────────────────────────────────────────────────────────────────
// SIZING POLICY
// ─────────────────────────────────────────────────────────────────────────────────────────────────────────
/**
 * ⛔ THE SHAPE IS SHARED — fixed conservative on run one, then MAX of prior windows, intermittent entries
 * staying fixed. That came out of a falsification: the two-factor density model was falsified on all 35
 * resources (MdAPE 87.2% against a >50% falsifier) and every covariate made it WORSE than a constant.
 *
 * ⛔ THE NUMBERS ARE NOT SHARED. `rowBudget` is OUR write throughput; `coldStartDays` was derived from it
 * AND from Google's flat cost curve. Under `'rises-with-range'` the same arithmetic points the wrong way.
 */
export interface SizingPolicy {
  /** Rows one invocation can durably write. A property of OUR write path, but stated per adapter so it can differ. */
  rowBudget: number
  coldStartDays: number
  minDays: number
  maxDays: number
}

// ─────────────────────────────────────────────────────────────────────────────────────────────────────────
// THE ADAPTER
// ─────────────────────────────────────────────────────────────────────────────────────────────────────────
/** What one adapter calls a capture target — a Google catalog entry, a GA4 report bucket, a Meta breakdown. */
export interface CaptureSurface {
  /** The `entity_level` written to metrics_daily. */
  entityLevel: string
  /** The `breakdown_type` written to metrics_daily. */
  breakdownType: string
  /** A stable label for logs and the attempt log's `resource`/`segment` columns. */
  resource: string
  segment: string
}

export interface CaptureContext {
  clientId: string
  userEmail: string
  accountId: string
}

/** A durable handle for the two-phase shape. Meaningless for `'stream'`. */
export interface JobHandle {
  id: string
  /** ⛔ WHEN THE HANDLE DIES. Shopify's result URL expires after ONE WEEK; Meta's report_run_id after 30 DAYS. */
  expiresAt: string | null
  submittedAt: string
}

export interface CaptureAdapter<TRow = any> {
  /** The `platform` value in metrics_daily and the `vendor` value in universe_attempt_log. */
  platform: string
  fetchShape: FetchShape
  retention: RetentionFloor
  dayClosure: DayClosure
  meter: Meter
  sizing: SizingPolicy

  /** ONE-PHASE. Required when `fetchShape === 'stream'`. */
  stream?(ctx: CaptureContext, surface: CaptureSurface, startDate: string, endDate: string): AsyncGenerator<TRow>
  /** TWO-PHASE. Required when `fetchShape === 'job'`. */
  submit?(ctx: CaptureContext, surface: CaptureSurface, startDate: string, endDate: string): Promise<JobHandle>
  /** TWO-PHASE. `ready: false` means poll again later — the invocation need not survive the work. */
  collect?(ctx: CaptureContext, handle: JobHandle): Promise<{ ready: boolean; rows?: AsyncGenerator<TRow>; progress?: string }>

  /** The day this row belongs to, or null when it carries none. The core never guesses a date. */
  dateOf(row: TRow): string | null
  /** Vendor rows → metrics_daily rows, for ONE day. The core calls this at the commit boundary. */
  buildRows(surface: CaptureSurface, ctx: CaptureContext, rows: TRow[]): { rows: Record<string, unknown>[]; grainDeclines: number }
  /** Vendor error → a readable string. NEVER `String(e)`: a GoogleAdsFailure yields "[object Object]". */
  serializeError(e: unknown): string
}

// ═════════════════════════════════════════════════════════════════════════════════════════════════════════
// CORE DECISIONS — platform-free by construction, and the guard proves it
// ═════════════════════════════════════════════════════════════════════════════════════════════════════════

export type ExhaustionVerdict =
  | { complete: false; exhaustedBelow: null; proof: string }
  | { complete: true; exhaustedBelow: string; proof: string }

/**
 * ⛔ AN ADAPTER WITH A NULL FLOOR IS STRUCTURALLY UNABLE TO CLAIM EXHAUSTION, AND THE TYPE SAYS SO:
 * `complete: true` REQUIRES a non-null `exhaustedBelow`, and the only source of that value is
 * `floor.floorDate`. There is no branch that can produce a completion without one.
 *
 * ⛔ AND THE RULE THAT PREDATES THIS AND STILL BINDS — `LORAMER_ZERO_ROWS_IS_NOT_EXHAUSTION_V1`: a run of
 * empty days is **NO_DATA_OBSERVED**, not a wall. 214 false completions came from a 36-month CLOCK
 * concluding exhaustion; the only input that may end a walk is the vendor returning zero AT OR BELOW a floor
 * whose provenance is recorded. For GA4, Shopify and WooCommerce there is no such floor, so the walk is
 * ended by something else entirely — an account-derived start date — and never by this function.
 *
 * ⛔ NO_DATA_OBSERVED, AND THE NAME IS THE CORRECTION — LORAMER_NO_DATA_OBSERVED_V1, 2026-08-10, from
 * external adversarial review. This state used to be called DORMANCY, which is a claim about the ACCOUNT:
 * "nothing was running". **A successful empty response establishes exactly one thing — THIS QUERY RETURNED
 * NO ROWS.** It does not establish that the account was idle, that the entity never existed, or that the
 * range is empty for any OTHER resource, segment or granularity. It grounds NO floor and implies NO
 * account-level fact, and the verdicts below now say so in the words they return rather than leaving a
 * reader to supply the stronger reading for himself.
 * ⚠ Even the WEAK reading depends on a vendor rule, quoted rather than assumed: "Rows whose selected
 * metrics are all zero won't be returned" and "Dates with no metrics are not returned in such a report"
 * (developers.google.com/google-ads/api/docs/reporting/zero-metrics). That holds for a query that SELECTS
 * metrics. It says nothing about one that selects none.
 */
export function decideExhaustion(args: {
  windowStart: string
  rowsReturned: number
  floor: RetentionFloor
  /** For the proof string. The query, the job id — whatever names what was asked. */
  asked: string
}): ExhaustionVerdict {
  const { windowStart, rowsReturned, floor, asked } = args
  if (rowsReturned > 0) {
    return { complete: false, exhaustedBelow: null, proof: `vendor returned ${rowsReturned} row(s) at/below ${windowStart} — the walk continues` }
  }
  if (floor.floorDate === null) {
    // ⛔ THE NULL-FLOOR PATH. NOT "we do not know the floor" — THERE IS NO VENDOR WALL. Concluding
    // exhaustion here would be inferring a wall from silence, which is the exact defect
    // LORAMER_ZERO_ROWS_IS_NOT_EXHAUSTION_V1 exists to forbid.
    return {
      complete: false, exhaustedBelow: null,
      proof: `NO_DATA_OBSERVED: this query returned 0 rows for [${windowStart}], and this adapter declares NO retention wall (${floor.source}: ${floor.citation}). ` +
        `⛔ EXHAUSTION IS NOT CLAIMABLE. This establishes ONLY that THIS query returned nothing — NOT that the account was idle, NOT that the entity is absent, ` +
        `and NOTHING about any other resource, segment or granularity. It grounds no floor. A walk with no vendor wall must be ended by an ACCOUNT-DERIVED start date, never by silence. via: ${asked}`,
    }
  }
  if (windowStart > floor.floorDate) {
    return {
      complete: false, exhaustedBelow: null,
      proof: `NO_DATA_OBSERVED: this query returned 0 rows for [${windowStart}], which is ABOVE the floor ${floor.floorDate} (${floor.source}) — ONE EMPTY WINDOW, NOT exhaustion. ` +
        `It is a fact about this query, not about the account. The walk continues.`,
    }
  }
  return {
    complete: true, exhaustedBelow: floor.floorDate,
    proof: `vendor returned 0 rows for [${windowStart}] at/below the ${floor.source} floor ${floor.floorDate} (${floor.citation}). via: ${asked}`,
  }
}

/**
 * ⛔ MAY THIS ADAPTER INFER DAY CLOSURE FROM ORDERING? The core asks; it never assumes. An adapter that
 * declares `later-day-closes` without a MECHANISM is refused here rather than silently trusted, because a
 * closure claim that is wrong only sometimes is worse than one that is always wrong.
 */
export function mayInferClosureFromOrder(a: CaptureAdapter): boolean {
  return a.dayClosure.rule === 'later-day-closes' && a.dayClosure.mechanism.trim().length > 0
}

export interface SizeVerdict {
  days: number
  basis: 'cold-start-no-history' | 'max-of-prior-windows' | 'intermittent-fixed'
  estimateRowsPerDay: number | null
  sizedOnRowsPerDay: number | null
  reason: string
}

/** ≥ this share of prior windows returning ZERO makes a series intermittent; its median is zero by construction. */
export const INTERMITTENT_ZERO_SHARE = 0.4

/**
 * ⛔ SIZE ON MAX, REPORT PREV — AND OBEY THE ADAPTER'S COST DIRECTION.
 *
 * The loss is ASYMMETRIC and the metric ranked the estimators exactly backwards (measured 2026-08-08 over
 * 10,198 strictly-causal predictions): PREV has the BEST accuracy (MdAPE 42.7%) and under-predicts 30% of
 * the time; MAX has the WORST (292.9%) and under-predicts 3%. Over-predicting costs a window that finishes
 * early; under-predicting costs one re-fetch. **Optimise for the cost, not the accuracy.**
 *
 * ⛔ AND THE DIRECTION IS WHAT MAKES THIS PLATFORM-NEUTRAL RATHER THAN GOOGLE-SHAPED. Under
 * `'flat-per-request'` a bigger window is cheaper per day, so size up to the row budget. Under
 * `'rises-with-range'` a bigger window costs MORE, so the row budget is not the binding constraint and the
 * policy must not chase it — the span is capped at the cold-start size until an adapter supplies a real
 * trade-off. **Refusing to guess is the correct behaviour here; guessing is how "size up" ships to GA4.**
 */
export function sizeFromPolicy(
  policy: SizingPolicy, direction: CostDirection, priorRowsPerDay: number[], priorRowTotals: number[],
): SizeVerdict {
  if (!priorRowsPerDay.length) {
    return { days: policy.coldStartDays, basis: 'cold-start-no-history', estimateRowsPerDay: null, sizedOnRowsPerDay: null,
      reason: `no finished attempt for this surface — cold start at ${policy.coldStartDays} day(s)` }
  }
  const zeroShare = priorRowTotals.filter((r) => r === 0).length / priorRowTotals.length
  if (zeroShare >= INTERMITTENT_ZERO_SHARE) {
    // ⛔ THE DIRECTION DECIDES, HERE TOO — LORAMER_INTERMITTENT_WIDENS_UNDER_FLAT_COST_V1, 2026-08-10.
    // This branch used to pin EVERY intermittent series to coldStartDays, and under flat-per-request cost
    // that is BACKWARD: one request costs the same at any span, so empty ground is exactly where the window
    // should be WIDEST. Measured on the roster: BusyBee's real 2,267-day dormancy gap (data on BOTH sides)
    // crossed at 7-day windows is ~324 requests per surface — ~112k fleet-wide, 18.7 days of the whole
    // 6,000/day lane, 4.3× the cost of crossing it at maxDays. The rows-per-day risk the pin was hedging is
    // hedged the same way the yielding branch hedges it: a wrong guess costs ONE re-fetch, because
    // day-committed resume narrows to what is still owed.
    // ⛔ UNDER rises-with-range the pin REMAINS CORRECT — a wide window there costs more by construction,
    // and "refusing to guess" (the branch below) is the stated policy for that direction.
    if (direction === 'flat-per-request') {
      return { days: policy.maxDays, basis: 'intermittent-fixed', estimateRowsPerDay: Math.round(priorRowsPerDay[0]), sizedOnRowsPerDay: null,
        reason: `${(zeroShare * 100).toFixed(0)}% of the last ${priorRowTotals.length} window(s) returned ZERO rows — an intermittent series, whose median is zero by construction. Cost is FLAT per request, so empty ground gets the WIDEST window: ${policy.maxDays} day(s). (This branch pinned to ${policy.coldStartDays}d until 2026-08-10, which priced a measured 2,267-day dormancy at 4.3× — LORAMER_INTERMITTENT_WIDENS_UNDER_FLAT_COST_V1.)` }
    }
    return { days: policy.coldStartDays, basis: 'intermittent-fixed', estimateRowsPerDay: Math.round(priorRowsPerDay[0]), sizedOnRowsPerDay: null,
      reason: `${(zeroShare * 100).toFixed(0)}% of the last ${priorRowTotals.length} window(s) returned ZERO rows — an intermittent series, whose median is zero by construction. Cost ${direction} — held at the ${policy.coldStartDays}-day cold-start size; widening is only cheap under flat-per-request.` }
  }
  const maxPerDay = Math.max(...priorRowsPerDay)
  const prevPerDay = priorRowsPerDay[0]
  if (direction === 'rises-with-range') {
    return { days: policy.coldStartDays, basis: 'max-of-prior-windows', estimateRowsPerDay: Math.round(prevPerDay), sizedOnRowsPerDay: Math.round(maxPerDay),
      reason: `cost RISES WITH RANGE for this adapter, so the row budget is NOT the binding constraint and sizing up to it would be actively wrong. Held at ${policy.coldStartDays} day(s) until this adapter supplies a real trade-off. (MAX ${Math.round(maxPerDay)} rows/day, PREV ${Math.round(prevPerDay)} — reported, not used.)` }
  }
  const days = maxPerDay > 0
    ? Math.min(policy.maxDays, Math.max(policy.minDays, Math.floor(policy.rowBudget / maxPerDay)))
    : policy.maxDays
  return { days, basis: 'max-of-prior-windows', estimateRowsPerDay: Math.round(prevPerDay), sizedOnRowsPerDay: Math.round(maxPerDay),
    reason: `flat-per-request cost, so a larger window is cheaper per day. Sized on MAX(${Math.round(maxPerDay)} rows/day over ${priorRowsPerDay.length} prior window(s)) → ${days} day(s) at the ${policy.rowBudget.toLocaleString()}-row budget. ESTIMATE was PREV=${Math.round(prevPerDay)} (MdAPE 42.7% vs MAX's 292.9%) — reported, not used, because MAX under-predicts 3% of the time against PREV's 30%.` }
}

/**
 * ⛔ MAY THIS ADAPTER SPEND? The governor's INTERFACE, in the adapter's OWN unit. An unreadable meter HOLDS.
 * There is no shared constant here on purpose: `cap` and `costOf` both come from the adapter, so nothing in
 * the core can be tuned into meaning "operations".
 */
export async function mayFetch(a: CaptureAdapter, days: number): Promise<{ ok: boolean; reason: string }> {
  const spent = await a.meter.spentSoFar()
  if (spent === null) {
    return { ok: false, reason: `${a.platform} meter unreadable — HOLDING. An instrument that cannot answer must never be read as permission; that is a governor granting itself unlimited quota because its own gauge broke.` }
  }
  const want = a.meter.costOf(days)
  if (spent + want > a.meter.cap) {
    return { ok: false, reason: `${a.platform}: ${spent} + ${want} would exceed ${a.meter.cap} ${a.meter.unit}` }
  }
  return { ok: true, reason: `${a.platform}: ${spent} + ${want} of ${a.meter.cap} ${a.meter.unit}` }
}
