// LORAMER_GOOGLE_HOLE_MAP_DETECTOR_V1 — THE HOLE ENUMERATOR: (client, surface, CONTIGUOUS SPAN), floored by the
// one resolver, grained by the coverage module, with coverage reported in TWO LABELLED TIERS.
//
// ⛔ WHY THIS IS PER-SURFACE AND NOT PER-DAY, measured 2026-09-04 before a line was written: Glenn Stearns
// 2023-04-18..2023-05-22 holds 24 base-ACTIVE days (spend>0) and ZERO breakdown families; skinregimen
// 2018-06-20..2020-02-14 holds 197 and ZERO. Every account-grain instrument in this repo calls those 221 days
// COVERED, because the account row is the signal they key on. A hole is a property of (client, surface, day),
// and the account row cannot represent it — universe-stream-consumer.guard.mjs leg (g) is what keeps this
// module from ever reading that row as evidence about any other surface.
//
// ⛔ THE FLOOR IS DISCOVERED, NEVER COMPUTED. There is no 37-month wall: `universe_account_floor` held ZERO
// vendor refusals fleet-wide on 2026-09-04, and the fact registry's own probes served daily rows 53 months
// back and a clean empty at 128. So the only floor is `resolveWalkStop` — max(vendor refusal wall,
// min(account inception, earliest held day)) — reached through the ONE composition site and never composed
// here (inception-stop.guard.mjs legs (c) and (f)). UNKNOWN inception REFUSES THE WHOLE ENUMERATION: a
// partial list on UNKNOWN is a silent walk-to-epoch wearing a hole map. This module NEVER fetches — it
// passes `discover: null` exactly as the resumer does; the one-op discovery belongs to the consumer and to
// the proof script, both of which are metered and ledgered.
//
// ⛔ TWO TIERS, NEVER A BARE BOOLEAN. Measured 2026-09-04: 92 ledger-attested account-days against ~14,375
// held fleet-wide (0.6%). A ledger-REQUIRED read would declare 99.4% of the warehouse uncovered and re-ask
// it; a presence-ONLY read cannot tell an honest zero from a degraded-fetch zero. So `covered` is reported
// as `ledgerAttested` (a `day_committed` record from an attempt that demonstrably finished — read through
// the coverage module's own narrow `committedDays`, never the spend API) and `presenceOnly` (rows, closed by
// a later day, no attestation). Neither is a hole. Both are named. The FILL consumes only `uncovered`.
//
// ⛔ BOUNDED, NEVER ONE CALL. Coverage costs ~one indexed probe per surface-day; 349 surfaces × 35 days is
// ~12k probes. The resumer's own bounds apply — MAX_ENTRIES_SCANNED_PER_RUN entries per page (imported from
// the resumer, whose deciders are pure) and a wall-clock allowance per page — and the caller pages with
// `fromEntry`. A page that runs out of allowance returns `nextEntry` and everything it proved so far;
// nothing is inferred about entries it did not reach.
// ⛔ THE ALLOWANCE IS PASSED IN, NOT IMPORTED, AND THE REASON IS A GUARD THAT FIRED. SCAN_ALLOWANCE_MS lives
// in the v2 contract module, and universe-stream-consumer.guard.mjs leg (e) names the ONLY files that may
// touch that module — the consumer, the resumer, the drive, the poll lane — because reaching it is how a
// module becomes a candidate publisher to the v2 topic. A library that enumerates holes has no business
// there. So the EXECUTION HOST (a script today, a route when the fill lands — one that is NAMED in leg (e)
// as a decision, not slipped past it) owns the clock budget and hands it in, exactly as the route owns
// `maxDuration = CONSUMER_MAX_DURATION_S` rather than the worker.
//
// ⛔ THE ALIAS QUESTION IS ANSWERED INSIDE windowCoverage, not here: drain-written and forward-written rows at
// the legacy spelling count as coverage for the walk's surface through the read-side alias map in
// universe-surfaces.ts, proven from rows by drain-alias-coverage.guard.mjs leg (v). This module asks at the
// walk's own key and inherits that proof; it does not invent a third spelling.
import { windowCoverage, committedDays, toRanges, type CoverageKey } from '@/lib/backfill/universe-coverage'
import {
  loadUniverse, selectableEntries, readWalkStopAccountFacts, resolveWalkStop, type UniverseEntry,
} from '@/lib/backfill/google-ads-universe-writer'
import { surfaceOfEntry } from '@/lib/backfill/capture-adapters/google-ads.adapter'
import { MAX_ENTRIES_SCANNED_PER_RUN } from '@/lib/backfill/universe-resumer'

const VENDOR = 'google'

/** The page bounds. `allowanceMs` is REQUIRED — the execution host owns the clock budget (see the header);
 *  `maxEntries` defaults to the resumer's own scan bound. */
export interface HoleMapBounds {
  allowanceMs: number
  maxEntries?: number
}

export interface HoleSurface {
  /** The GAQL FROM resource and its segment ('' for base) — the walk's own identity for the surface. */
  resource: string
  segment: string
  /** The two metrics_daily columns coverage is asked at. */
  entityLevel: string
  breakdownType: string
}

/** ONE contiguous run of UNCOVERED days on ONE surface. The unit of TRUTH is the day; the unit of REQUEST is
 *  this span — one GAQL request per (surface, span), which is why spans and not loose days come out. */
export interface HoleSpan {
  clientId: string
  surface: HoleSurface
  start: string
  end: string
  days: number
}

export interface SurfaceTally {
  surface: HoleSurface
  /** The floor this surface was scanned from — max(requested start, resolved stop). */
  effectiveStart: string
  stopDate: string
  basis: string
  ledgerAttested: number
  presenceOnly: number
  attestedEmpty: number
  uncovered: number
  spans: number
  probes: number
  ms: number
}

export interface HoleMapRefusal {
  refused: true
  clientId: string
  reason: string
}

export interface HoleMapPage {
  refused: false
  clientId: string
  span: { start: string; end: string }
  floor: { inceptionDate: string; earliestHeldDate: string | null }
  /** Entries examined on THIS page, and where the next page starts (null = the catalog is exhausted). */
  scanned: number
  totalEntries: number
  fromEntry: number
  nextEntry: number | null
  elapsedMs: number
  /** Surfaces whose resolved stop sits above the requested end — nothing to ask, nothing inferred. */
  belowFloor: number
  tiers: { ledgerAttested: number; presenceOnly: number; attestedEmpty: number; uncovered: number }
  /** Oldest span first, then by surface — the fill order. ONLY `uncovered` days appear here. */
  uncovered: HoleSpan[]
  perSurface: SurfaceTally[]
}

const cmp = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0)

/**
 * Enumerate the holes of ONE client over ONE span, one bounded page at a time.
 *
 * REFUSES (returns `{ refused: true }` and NOTHING ELSE) when the account inception is UNKNOWN or any surface
 * resolves to a null stop. Otherwise returns a page: every surface from `fromEntry` up to the scan bounds,
 * each with its two-tier coverage and its contiguous uncovered spans.
 */
export async function enumerateGoogleHoles(input: {
  clientId: string
  start: string
  end: string
  bounds: HoleMapBounds
  fromEntry?: number
  /** Injectable for tests and for a narrower proof; defaults to the walk's own selectable catalog. */
  entries?: UniverseEntry[]
  /** Injectable clock so a guard can drive the allowance without waiting for it. */
  now?: () => number
}): Promise<HoleMapRefusal | HoleMapPage> {
  const { clientId, start, end } = input
  const maxEntries = input.bounds.maxEntries ?? MAX_ENTRIES_SCANNED_PER_RUN
  const allowanceMs = input.bounds.allowanceMs
  const now = input.now ?? (() => Date.now())
  const t0 = now()
  if (!(allowanceMs > 0) || !(maxEntries > 0)) return { refused: true, clientId, reason: `bounds must be positive (allowanceMs=${allowanceMs}, maxEntries=${maxEntries}) — an unbounded page is one call` }
  if (start > end) return { refused: true, clientId, reason: `span start ${start} is after end ${end} — nothing to enumerate` }

  // ── THE FLOOR, FROM THE ONE RESOLVER. This module never discovers: `discover: null`, like the resumer. ──
  const facts = await readWalkStopAccountFacts({ clientId, vendor: VENDOR, discover: null })
  if (facts.inceptionDate === null) {
    return {
      refused: true, clientId,
      reason: 'account inception UNKNOWN — no universe_account_inception row for this client/vendor. ' +
        'One metered, ledgered op discovers it (discoverAccountInception); this module never fetches. Refusing the whole enumeration rather than trimming to a partial list.',
    }
  }

  const entries = input.entries ?? selectableEntries(loadUniverse())
  const fromEntry = Math.max(0, input.fromEntry ?? 0)
  const perSurface: SurfaceTally[] = []
  const uncovered: HoleSpan[] = []
  const tiers = { ledgerAttested: 0, presenceOnly: 0, attestedEmpty: 0, uncovered: 0 }
  let belowFloor = 0
  let i = fromEntry
  for (; i < entries.length; i++) {
    if (i - fromEntry >= maxEntries) break
    if (now() - t0 > allowanceMs) break
    const s = surfaceOfEntry(entries[i])
    const surface: HoleSurface = { resource: s.resource, segment: s.segment, entityLevel: s.entityLevel, breakdownType: s.breakdownType }

    const stop = await resolveWalkStop({ clientId, vendor: VENDOR, resource: s.resource, segment: s.segment, facts })
    if (stop.stopDate === null) {
      return { refused: true, clientId, reason: `surface ${s.resource}/${s.segment || '(base)'} resolved to a null stop (${stop.basis}) — refusing the whole enumeration` }
    }
    const effectiveStart = stop.stopDate > start ? stop.stopDate : start
    if (effectiveStart > end) { belowFloor += 1; continue }

    const key: CoverageKey = { clientId, platform: VENDOR, entityLevel: s.entityLevel, breakdownType: s.breakdownType }
    const cov = await windowCoverage(key, effectiveStart, end)
    // Tier the covered days: an attestation from an attempt that finished vs rows alone. committedDays is the
    // coverage module's own narrow read of the ledger — the spend-and-failure API is never imported here.
    const committed = new Set(await committedDays(key, effectiveStart, end))
    let ledgerAttested = 0
    for (const d of cov.covered) if (committed.has(d)) ledgerAttested += 1
    const presenceOnly = cov.covered.length - ledgerAttested

    const spans = toRanges(cov.uncovered).map((r) => ({
      clientId, surface, start: r.start, end: r.end,
      days: Math.round((Date.parse(r.end) - Date.parse(r.start)) / 86_400_000) + 1,
    }))
    uncovered.push(...spans)
    tiers.ledgerAttested += ledgerAttested
    tiers.presenceOnly += presenceOnly
    tiers.attestedEmpty += cov.attestedEmpty.length
    tiers.uncovered += cov.uncovered.length
    perSurface.push({
      surface, effectiveStart, stopDate: stop.stopDate, basis: stop.basis,
      ledgerAttested, presenceOnly, attestedEmpty: cov.attestedEmpty.length, uncovered: cov.uncovered.length,
      spans: spans.length, probes: cov.probes, ms: cov.ms,
    })
  }

  uncovered.sort((a, b) => cmp(a.start, b.start) || cmp(a.surface.resource, b.surface.resource) || cmp(a.surface.segment, b.surface.segment))
  return {
    refused: false, clientId, span: { start, end },
    floor: { inceptionDate: facts.inceptionDate, earliestHeldDate: facts.earliestHeldDate },
    scanned: i - fromEntry, totalEntries: entries.length, fromEntry, nextEntry: i < entries.length ? i : null,
    elapsedMs: now() - t0, belowFloor, tiers, uncovered, perSurface,
  }
}
