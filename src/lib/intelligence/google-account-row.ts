// LORAMER_GOOGLE_FORWARD_RESTATE_V1 — THE ONE PRODUCER OF GOOGLE `entity_level='account'` ROWS.
//
// ⛔ WHY THIS FILE EXISTS, AND WHY IT IS NOT A SUM OF CAMPAIGNS.
// Until now the account row was `data.totals` from fetchGoogleIntelligence — a reduce over the campaign
// query, filtered `campaign.status != 'REMOVED'`, stamped with ONE date. Two defects fell out of that:
//   (1) it could never be range-widened (a wider range writes a MULTI-DAY SUM onto one day), so Google
//       forward capture could never restate — measured 2026-08-24, spend/clicks/conversions all move
//       AFTER capture and nothing ever re-asked the day;
//   (2) the `!= 'REMOVED'` filter drops spend that genuinely occurred. Russ's ruling, 2026-08-24: an
//       account total INCLUDES campaigns that were later deleted, because the money was really spent.
//
// ⛔ AND WHY NOT "just sum all campaigns", which expresses the ruling directly and costs no request:
// google-campaign-backfill reconciles each day's campaign sum against the ACCOUNT row with
// `posture: 'block'` — a day whose campaign rows disagree with the account anchor is NOT WRITTEN. That
// check only means something while the account row comes from an INDEPENDENT fetch. Derive the account
// row from the campaign rows and the reconciler compares its own output to itself: delta 0 by
// construction, the block gate can never fire, and the only detector for a truncated or partial campaign
// fetch is gone — silently. google-adgroup-ad-backfill anchors on the same row and loses the same thing.
//
// SO: the source is `FROM customer` — Google's own account-grain report. It is per-day by construction
// (segments.date), ranged in ONE request, has no campaign filter to apply (so it satisfies the ruling by
// construction rather than by approximation), and is INDEPENDENT of the campaign query, which keeps both
// reconcilers honest.
//
// MEASURED EQUIVALENCE (client ids below are registry ids — verify against src/lib/clients/canonical.ts,
// never against a name), live, 2026-08-24, window 2026-07-25..2026-08-23 (30 days), three clients —
// `FROM customer` vs the sum of ALL campaigns, on all five metrics:
//   60e6dd99 Bath Fitter  $76,877.82 / 3,986 clicks / 52,842 impr / 703.99 conv   DELTA 0 on all five
//   c39ee088 Escential     $4,000.44 / 9,012 / 349,742 / 790.99                   DELTA 0 on all five
//   366afedc Champion     $13,272.95 / 717 / 13,018 / 46.00                       DELTA 0 on all five
// Each returned exactly 30 rows over 30 days. The fleet census on the same window found ZERO removed
// campaigns across all 18 connections, so the ruling ships at a measured $0.00 delta today — and the
// first client to delete a campaign is the first day the two derivations would have diverged.
import { googleAdsCustomerFor } from '@/lib/google-ads-client'
// LORAMER_ACCOUNT_ROW_PROVENANCE_V1 — the provenance vocabulary has ONE owner (the walk writer) and this
// producer borrows two of its three text values. PROVENANCE_VENDOR was defined there on 2026-08 and never
// stamped by anything until this line; PROVENANCE_ZERO_FILLED names the fill below.
import { PROVENANCE_VENDOR, PROVENANCE_ZERO_FILLED } from '@/lib/backfill/google-ads-universe-writer'

/** Which WRITER produced the row. REQUIRED at every call site as a string literal (google-account-row-
 *  provenance.guard.mjs leg (b)) — an unknown lane is a build error, never 'forward'. 'fill' is reserved for
 *  the hole filler (LORAMER_GOOGLE_HOLE_MAP_DETECTOR_V1's next commit) and has no caller yet by design. The
 *  drain's tier-1 account step reaches this producer THROUGH the backfill adapter and is therefore
 *  'backfill': the row's origin is the run-backfill engine's ranged fetch; who scheduled it (drain vs manual)
 *  is a cron_runs / sync_state fact, not a row fact, and BackfillRowContext does not carry it. */
export type AccountRowLane = 'forward' | 'catchup' | 'backfill' | 'fill'

export interface GoogleAccountDay {
  date: string
  spend: number
  impressions: number
  clicks: number
  conversions: number
  conversionValue: number
  /** LORAMER_ACCOUNT_ROW_PROVENANCE_V1 — TRUE when Google returned a dated row; FALSE when this producer
   *  zero-filled the date. This is the bit the `??` at the zero-fill used to branch on and discard. It does
   *  NOT mean "the vendor asserted zero": segmented GAQL omits zero-metric rows ALWAYS (measured 2026-08-26),
   *  so "served nothing" and "served a zero" are the same response. It means exactly what it says — a row was
   *  present, or it was not and we recorded the omission as zero under that measured rule. */
  vendorRow: boolean
  /** ISO-8601 UTC of the fetch that observed (or omitted) this date — one value per window, Fivetran's
   *  `_fivetran_synced` shape. It changes on every restate because a restate IS a re-observation. */
  observedAt: string
}

const fin = (v: unknown): number => { const n = Number(v); return Number.isFinite(n) ? n : 0 }
const ratio = (num: number, den: number, mult = 1): number => (den > 0 ? (num / den) * mult : 0)

/** ONE ranged query against Google's own account report. Per-day rows, no campaign filter, no status
 *  filter — there is none to apply at this grain, which is exactly why this is the right source.
 *
 *  ⛔ LORAMER_GOOGLE_ACCOUNT_ZERO_DAY_V1 — EVERY DAY IN THE ASKED RANGE COMES BACK, ZEROS INCLUDED.
 *  Measured live 2026-08-26 on three dormant accounts, both query shapes: GAQL with a segment in the
 *  SELECT omits zero-metric rows ALWAYS (single-day and ranged identically), so `FROM customer` returns
 *  NOTHING for a dormant day — Google never serves a dated zero row in any form. The retired producer's
 *  zero days had come from the UNSEGMENTED campaign entity query, not from the vendor; this producer's
 *  first fire therefore silently dropped 9 of 18 connections' 2026-08-25 account rows, and with them the
 *  anchor google-campaign-backfill's posture:'block' reconciler reads (`fin(acctRow?.spend)` maps a
 *  missing row to $0.00, so the gate can never fire on exactly the days it cannot see).
 *  THE FILL IS OURS AND IT IS A RECORDING, NOT AN INVENTION: the vendor was asked about this exact day and
 *  answered "no activity"; the account entity is the customerId itself, so no listing and no extra op is
 *  needed. When this shipped (2026-08-26) it restored the pre-02e79b7 series byte-for-byte (verified against
 *  a held dormant-day row: zeros + extra{ctr:0,cpc:0,cpm:0,roas:null,cpa:null,convRate:null}); since
 *  LORAMER_ACCOUNT_ROW_PROVENANCE_V1 (2026-09-05) the SIX RATIOS are still byte-identical but every row ALSO
 *  carries provenance · vendorRow · observedAt · lane, so byte-for-byte parity with pre-stamp rows no longer
 *  holds and is not claimed — a pre-stamp row is UNKNOWN-provenance, stated as such by its readers. BOTH lanes at once — forward
 *  (sync:720) and catchup (catchup:674) and the backfill adapter (adapters.ts:54) all take their days from
 *  this one function, which is the point of having one producer.
 *  check:data leg: scripts/check-google-forward-account-day.mjs (registered red against the 9, 2026-08-26). */
const addDayUTC = (iso: string): string => { const d = new Date(iso + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + 1); return d.toISOString().slice(0, 10) }

export async function fetchGoogleAccountWindow(
  refreshToken: string, customerId: string, startDate: string, endDate: string
): Promise<GoogleAccountDay[]> {
  const customer = googleAdsCustomerFor({ refreshToken, customerId })
  const rows = await customer.query(`
    SELECT segments.date, metrics.cost_micros, metrics.clicks, metrics.impressions,
           metrics.conversions, metrics.conversions_value
    FROM customer WHERE segments.date BETWEEN '${startDate}' AND '${endDate}'
  `)
  // LORAMER_ACCOUNT_ROW_PROVENANCE_V1 — one observation time per window: the moment the vendor answered.
  const observedAt = new Date().toISOString()
  const byDate = new Map<string, GoogleAccountDay>()
  for (const r of rows as any[]) {
    const date = String(r.segments?.date || '')
    if (!date) continue
    byDate.set(date, {
      date,
      spend: fin(r.metrics?.cost_micros) / 1e6,
      impressions: fin(r.metrics?.impressions),
      clicks: fin(r.metrics?.clicks),
      conversions: fin(r.metrics?.conversions),
      conversionValue: fin(r.metrics?.conversions_value),
      vendorRow: true, // the vendor named this date
      observedAt,
    })
  }
  // The zero-fill. Bounded to the asked range, so a caller that asks one day gets one day (catchup) and a
  // caller that asks 31 gets 31 (forward restate) — and the forward window self-heals recent holes on its
  // first post-deploy fire, because absent days INSIDE the window now come back as zeros and upsert.
  // ⛔ LORAMER_ACCOUNT_ROW_PROVENANCE_V1 — THE BIT THIS `??` BRANCHES ON IS NOW KEPT. Before 2026-09-05 the
  // filled object was indistinguishable from a vendor row; `vendorRow: false` is the fill saying so itself.
  const out: GoogleAccountDay[] = []
  for (let d = startDate; d <= endDate; d = addDayUTC(d)) {
    out.push(byDate.get(d) ?? { date: d, spend: 0, impressions: 0, clicks: 0, conversions: 0, conversionValue: 0, vendorRow: false, observedAt })
  }
  return out
}

/** metrics_daily rows, one per day. The CONFLICT KEY is unchanged from the account row buildGoogleMetricsRows
 *  used to emit, so a re-pull REPLACES rather than duplicates. The six ratio keys in `extra` are byte-identical
 *  to before; LORAMER_ACCOUNT_ROW_PROVENANCE_V1 adds four ADDITIVE keys beside them (provenance · vendorRow ·
 *  observedAt · lane) — `extra` is nullable jsonb with no key pin, no reader on this grain selects them, and
 *  migration 067's jsonb_typeof guards filter the non-numeric ones out of every sum.
 *  `lane` is REQUIRED — the producer cannot know its caller, and an unknown lane is a build error, not a
 *  default (google-account-row-provenance.guard.mjs legs (a)/(b)/(e)). */
export function buildGoogleAccountRows(
  clientId: string, userEmail: string, customerId: string, accountName: string | null | undefined, days: GoogleAccountDay[],
  lane: AccountRowLane,
): Record<string, unknown>[] {
  return days.map((d) => {
    const spend = Number(d.spend.toFixed(2))
    const convValue = Number(d.conversionValue.toFixed(2))
    return {
      client_id: clientId,
      user_email: userEmail,
      platform: 'google',
      account_id: customerId,
      entity_level: 'account',
      entity_id: customerId,
      entity_name: accountName || customerId,
      date: d.date,
      breakdown_type: '',
      breakdown_value: '',
      spend,
      impressions: d.impressions,
      clicks: d.clicks,
      conversions: d.conversions,
      conversion_value: convValue,
      revenue: 0,
      extra: {
        ctr: ratio(d.clicks, d.impressions, 100),
        cpc: ratio(spend, d.clicks),
        cpm: ratio(spend, d.impressions, 1000),
        roas: spend > 0 && convValue > 0 ? convValue / spend : null,
        cpa: d.conversions > 0 ? spend / d.conversions : null,
        convRate: d.clicks > 0 ? (d.conversions / d.clicks) * 100 : null,
        // LORAMER_ACCOUNT_ROW_PROVENANCE_V1 — the row states its own origin. TEXT under `provenance` (the walk's
        // key and type), the kept bit as a boolean, the observation time, and the writer's lane. Never an
        // object under `provenance`, never a run id on the row (the ledger owns the run link; a per-row id
        // would churn every restated row — the Airbyte raw_id defect).
        provenance: d.vendorRow ? PROVENANCE_VENDOR : PROVENANCE_ZERO_FILLED,
        vendorRow: d.vendorRow,
        observedAt: d.observedAt,
        lane,
      },
    }
  })
}
