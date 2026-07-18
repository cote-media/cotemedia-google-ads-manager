// LORAMER_GOOGLE_DEMOGRAPHIC_BACKFILL_V1 (G-FILL#3 — age + gender PERSIST)
// Demographic BREADTH backfill writer — Google {campaign, ad_group} × {age | gender}. One dimension per call
// (age or gender), BOTH grains in one pass from ONE view fetch per chunk (quota-minimal). Backfill-only; forward
// capture lives in cron/sync + cron/catchup (shared builder, src/lib/intelligence/google-demographic.ts →
// byte-identical rows). Mirrors google-device-backfill.ts / google-hour-backfill.ts (stateless-range for rangeLap,
// monthChunks, per-day CAMPAIGN-anchor reconcile FLAG-NOT-BLOCK, idempotent per-grain-per-day upsert).
//
// A demographic bucket PARTITIONS a demographics-reporting campaign's spend (every impression maps to one bucket
// incl UNDETERMINED), so each grain reconciles vs the per-day campaign anchor (Σ over the campaigns present that
// day). FLAG-NOT-BLOCK: always write, record divergence in flagged[] (PMax campaigns carry no age/gender criteria
// → they never appear in the view AND are excluded from the anchor sum, so they cannot cause a false flag; a
// campaign whose demographic coverage < its total flags honestly). Anchor read PER DAY (bounded; Lesson 8).
// Conversions never gate (L58).
import { supabaseAdmin } from '@/lib/supabase'
import { normalizeMetricsRows } from '@/lib/metrics-normalize'
import { reconcileDay } from './reconcile-day'
import {
  DEMO_DIMENSION_BY_KEY, DEMO_GRAINS, fetchDemographicWindow, buildDemographicGrainRows,
  type DemoDimensionKey, type DemographicRow,
} from '@/lib/intelligence/google-demographic'

const CONFLICT = 'client_id,platform,entity_level,entity_id,date,breakdown_type,breakdown_value'
const CAMP_DAY_CAP = 5000

const fin = (n: any): number => { const v = Number(n); return Number.isFinite(v) ? v : 0 }
const iso = (d: Date) => d.toISOString().split('T')[0]
function monthChunks(start: string, end: string): { from: string; to: string }[] {
  const chunks: { from: string; to: string }[] = []
  let cur = start
  while (cur <= end) {
    const d = new Date(cur + 'T00:00:00Z')
    const mEnd = iso(new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)))
    const to = mEnd < end ? mEnd : end
    chunks.push({ from: cur, to })
    const next = new Date(to + 'T00:00:00Z'); next.setUTCDate(next.getUTCDate() + 1); cur = iso(next)
  }
  return chunks
}

export interface DemographicBackfillResult { status: number; body: Record<string, any> }

export async function runGoogleDemographicBackfill(
  clientId: string, startDate: string, endDate: string, dimension: DemoDimensionKey, opts: { dryRun?: boolean } = {}
): Promise<DemographicBackfillResult> {
  const dim = DEMO_DIMENSION_BY_KEY[dimension]
  if (!dim) return { status: 400, body: { error: `unknown demographic dimension: ${dimension}` } }

  const { data: clientRow, error: cErr } = await supabaseAdmin
    .from('clients').select('id, user_email, platform_connections(*)').eq('id', clientId).is('deleted_at', null).single() // LORAMER_DELETE_CLIENT_V1 — archived client → no row → no-op
  if (cErr || !clientRow) return { status: 404, body: { error: 'Client not found', detail: cErr?.message } }
  const conn = (clientRow.platform_connections || []).find((c: any) => c.platform === 'google')
  if (!conn) return { status: 400, body: { error: 'Client has no Google connection' } }
  const customerId = conn.account_id as string
  const userEmail = (conn.user_email || clientRow.user_email) as string
  const { data: tok, error: tErr } = await supabaseAdmin
    .from('google_tokens').select('refresh_token').eq('user_email', userEmail).single()
  if (tErr || !tok?.refresh_token) return { status: 400, body: { error: 'No Google refresh token', detail: tErr?.message } }
  const refreshToken = tok.refresh_token as string

  // PER-DAY campaign-anchor cache (scoped to one date → bounded, never the silent 1000-row cap; Lesson 8).
  const campCache = new Map<string, Record<string, number>>()
  const campDay = async (date: string): Promise<Record<string, number>> => {
    const hit = campCache.get(date)
    if (hit) return hit
    const { data } = await supabaseAdmin
      .from('metrics_daily').select('entity_id,spend')
      .eq('client_id', clientId).eq('platform', 'google').eq('entity_level', 'campaign')
      .eq('breakdown_type', '').eq('breakdown_value', '').eq('date', date).limit(CAMP_DAY_CAP)
    const m: Record<string, number> = {}
    for (const r of data || []) m[String((r as any).entity_id)] = fin((r as any).spend)
    campCache.set(date, m)
    return m
  }
  // PER-DAY account-anchor (the account base row's spend) — reference only, shown in the dry-run proof so the
  // reviewer sees Σ(demo) vs BOTH the account total and the campaign anchor. Never gates.
  const acctCache = new Map<string, number>()
  const acctDay = async (date: string): Promise<number> => {
    const hit = acctCache.get(date)
    if (hit != null) return hit
    const { data } = await supabaseAdmin
      .from('metrics_daily').select('spend')
      .eq('client_id', clientId).eq('platform', 'google').eq('entity_level', 'account')
      .eq('breakdown_type', '').eq('breakdown_value', '').eq('date', date).limit(1)
    const v = fin((data && data[0] as any)?.spend)
    acctCache.set(date, v)
    return v
  }

  let grainDayRows = 0, written = 0, daysWritten = 0, daysFlagged = 0
  const perGrain: Record<string, { rows: number; daysFlagged: number }> = {}
  const flagged: any[] = []
  const distinctValueRaw = new Set<string>()
  const reconcileRows: any[] = [] // dry-run proof: per (grain,date) Σ(demo) vs campaign + account anchors
  let sampleRow: Record<string, unknown> | null = null

  for (const chunk of monthChunks(startDate, endDate)) {
    const winRows = await fetchDemographicWindow(dim, refreshToken, customerId, chunk.from, chunk.to)
    const byDate: Record<string, DemographicRow[]> = {}
    for (const r of winRows) {
      distinctValueRaw.add(r.valueRaw)
      ;(byDate[r.date] ||= []).push(r)
    }
    for (const [date, dayRows] of Object.entries(byDate)) {
      const dayCamp = await campDay(date)
      const acctSpend = await acctDay(date)
      const campaignIds = new Set(dayRows.map((r) => r.campaignId).filter(Boolean))
      let anchorSpend = 0, anchorMissing = 0
      for (const cid of campaignIds) { if (cid in dayCamp) anchorSpend += dayCamp[cid]; else anchorMissing++ }

      for (const grain of DEMO_GRAINS) {
        const built = buildDemographicGrainRows(dim, grain, clientId, userEmail, date, customerId, dayRows)
        grainDayRows += built.length
        perGrain[grain.entityLevel] ||= { rows: 0, daysFlagged: 0 }
        perGrain[grain.entityLevel].rows += built.length
        if (built.length === 0) continue
        if (opts.dryRun && !sampleRow) sampleRow = built[0]

        // FLAG-NOT-BLOCK vs the per-day campaign anchor (demographic bucket partitions campaign spend).
        const grainSpend = built.reduce((s, r) => s + fin((r as any).spend), 0)
        const { within: tolWithin, delta } = reconcileDay(grainSpend, anchorSpend, { posture: 'flag' })
        const within = anchorMissing === 0 && tolWithin
        if (opts.dryRun) {
          reconcileRows.push({
            grain: grain.entityLevel, date, demo_spend: Number(grainSpend.toFixed(2)),
            campaign_anchor_spend: Number(anchorSpend.toFixed(2)), account_anchor_spend: Number(acctSpend.toFixed(2)),
            delta_vs_campaign: Number(delta.toFixed(2)), anchor_missing_campaigns: anchorMissing, within,
          })
        }
        if (!within) {
          daysFlagged++; perGrain[grain.entityLevel].daysFlagged++
          flagged.push({ grain: grain.entityLevel, date, demo_spend: Number(grainSpend.toFixed(2)), campaign_anchor_spend: Number(anchorSpend.toFixed(2)), delta_vs_campaign: Number(delta.toFixed(2)), anchor_missing_campaigns: anchorMissing })
        }

        if (!opts.dryRun) {
          const { error: upErr } = await supabaseAdmin.from('metrics_daily').upsert(normalizeMetricsRows(built), { onConflict: CONFLICT })
          if (upErr) return { status: 500, body: { error: 'upsert failed', dimension, grain: grain.entityLevel, date, detail: upErr.message, flagged } }
        }
        written += built.length; daysWritten++
      }
    }
  }

  return {
    status: 200,
    body: {
      clientId, customerId, dimension, breakdownType: dim.breakdownType, view: dim.resource,
      range: `${startDate}→${endDate}`, dryRun: !!opts.dryRun,
      reconcile: 'PER-GRAIN: campaign + ad_group = FLAG-NOT-BLOCK vs per-day campaign anchor (demographic bucket partitions campaign spend; PMax has no demo criteria → excluded from both view + anchor)',
      grainDayRows, written, daysWritten, daysFlagged, perGrain, flagged,
      ...(opts.dryRun ? { distinctValueRaw: Array.from(distinctValueRaw), sampleRow, reconcileRows } : {}),
    },
  }
}

// rangeLap-compatible thin wrappers (one per dimension → one drain step each; matches google-device/hour writers).
export function runGoogleAgeBackfill(clientId: string, startDate: string, endDate: string, opts: { dryRun?: boolean } = {}): Promise<DemographicBackfillResult> {
  return runGoogleDemographicBackfill(clientId, startDate, endDate, 'age', opts)
}
export function runGoogleGenderBackfill(clientId: string, startDate: string, endDate: string, opts: { dryRun?: boolean } = {}): Promise<DemographicBackfillResult> {
  return runGoogleDemographicBackfill(clientId, startDate, endDate, 'gender', opts)
}
