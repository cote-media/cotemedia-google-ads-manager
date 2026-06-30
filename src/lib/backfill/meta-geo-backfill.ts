// LORAMER_META_GEO_BACKFILL_V1 (T1.9)
// Meta geo-BREADTH backfill writer (NEW; backfill-only — does NOT touch forward capture / the frozen live prompt
// fetch). Mirrors meta-device-backfill.ts EXACTLY (own /act_X/insights call, 4 entity levels, metaFetchAllPaged
// guard 200, monthChunks, account×day spend anchor, reconcileDay FLAG-NOT-BLOCK). Two geo families:
//   breakdown_type='geo_country' ← breakdowns=country         value = ISO country ("US"); missing → 'UNKNOWN'
//   breakdown_type='geo_region'  ← breakdowns=country,region  value = country-qualified ISO composite ("US-AL")
//     via the US region NAME→ISO map below (matches Shopify geo_region "US-CA"). Region MUST be country-qualified
//     (breakdowns=country,region) — breakdowns=region ALONE drops the country (ambiguous). UNMAPPED region
//     (international / unrecognized) → store the RAW composite ("US-Alabama"-style) + a LOUD console.warn naming it
//     (never guess a code, never silently drop) so we capture honestly and see exactly which regions to add later.
//
// RECONCILE = SPEND-only FLAG-NOT-BLOCK vs the account×day anchor (entity_level='account', breakdown_type=''),
// .maybeSingle() (one row/day → no silent 1000-row cap). Geo NEAR-PARTITIONS spend (live-probed Foam OH 2024-09:
// Σ(country) == account EXACTLY on most days; a small STRUCTURAL "undetermined-geo" residual on some days — e.g.
// 09-06 $291.21/3.4%, no 'unknown' bucket — that Meta drops from the breakdown). FLAG-NOT-BLOCK writes everything
// and flags the divergence (the residual is real undetermined-geo signal, NOT a bug — never block/drop it).
// CONVERSIONS are a separate grain (Meta account-level dedup, L58) → NEVER reconciled; conversions=value=0.
//
// FLOOR: standard floor36 (geo rides the ~37mo Meta aggregate #3018 wall). Stateless-range — processes the
// [startDate,endDate] the drain's rangeLap hands it. REUSE: metaFetchAllPaged + reconcileDay. NO schema change —
// rides the existing (breakdown_type, breakdown_value) 7-col key (JSONB/existing-key precedent, like device/age/placement).
import { supabaseAdmin } from '@/lib/supabase'
import { normalizeMetricsRows } from '@/lib/metrics-normalize'
import { reconcileDay } from './reconcile-day'
import { metaFetchAllPaged } from './meta-graph-paged'

const META_API = 'https://graph.facebook.com/v21.0'
const CONFLICT = 'client_id,platform,entity_level,entity_id,date,breakdown_type,breakdown_value'

const fin = (n: any): number => { const v = Number(n); return Number.isFinite(v) ? v : 0 }
const ratio = (a: number, b: number, s = 1): number | null => (b > 0 && Number.isFinite(a / b) ? Number(((a / b) * s).toFixed(4)) : null)
const iso = (d: Date) => d.toISOString().split('T')[0]

// US states + DC → ISO 3166-2 region code (Meta returns the region NAME; Shopify geo_region uses the CODE "US-CA").
const US_REGION_TO_ISO: Record<string, string> = {
  Alabama: 'AL', Alaska: 'AK', Arizona: 'AZ', Arkansas: 'AR', California: 'CA', Colorado: 'CO', Connecticut: 'CT',
  Delaware: 'DE', Florida: 'FL', Georgia: 'GA', Hawaii: 'HI', Idaho: 'ID', Illinois: 'IL', Indiana: 'IN', Iowa: 'IA',
  Kansas: 'KS', Kentucky: 'KY', Louisiana: 'LA', Maine: 'ME', Maryland: 'MD', Massachusetts: 'MA', Michigan: 'MI',
  Minnesota: 'MN', Mississippi: 'MS', Missouri: 'MO', Montana: 'MT', Nebraska: 'NE', Nevada: 'NV',
  'New Hampshire': 'NH', 'New Jersey': 'NJ', 'New Mexico': 'NM', 'New York': 'NY', 'North Carolina': 'NC',
  'North Dakota': 'ND', Ohio: 'OH', Oklahoma: 'OK', Oregon: 'OR', Pennsylvania: 'PA', 'Rhode Island': 'RI',
  'South Carolina': 'SC', 'South Dakota': 'SD', Tennessee: 'TN', Texas: 'TX', Utah: 'UT', Vermont: 'VT',
  Virginia: 'VA', Washington: 'WA', 'West Virginia': 'WV', Wisconsin: 'WI', Wyoming: 'WY', 'District of Columbia': 'DC',
}

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

// Entity-level configs (native repo terms ad_set/ad). Account carries no entity id → entity_id = the account id.
interface LevelCfg {
  entity_level: 'account' | 'campaign' | 'ad_set' | 'ad'
  metaLevel: string
  idFields: string
  extract: (ins: any, acctId: string, acctName: string) => { entityId: string; entityName: string; parentId: string }
}
const LEVELS: LevelCfg[] = [
  { entity_level: 'account', metaLevel: 'account', idFields: '',
    extract: (_ins, acctId, acctName) => ({ entityId: acctId, entityName: acctName, parentId: '' }) },
  { entity_level: 'campaign', metaLevel: 'campaign', idFields: 'campaign_id,campaign_name',
    extract: (ins, acctId) => ({ entityId: String(ins.campaign_id || ''), entityName: String(ins.campaign_name || ''), parentId: acctId }) },
  { entity_level: 'ad_set', metaLevel: 'adset', idFields: 'adset_id,adset_name,campaign_id',
    extract: (ins) => ({ entityId: String(ins.adset_id || ''), entityName: String(ins.adset_name || ''), parentId: String(ins.campaign_id || '') }) },
  { entity_level: 'ad', metaLevel: 'ad', idFields: 'ad_id,ad_name,adset_id',
    extract: (ins) => ({ entityId: String(ins.ad_id || ''), entityName: String(ins.ad_name || ''), parentId: String(ins.adset_id || '') }) },
]

// Normalize a Meta country to an ISO sentinel; missing/'unknown' → 'UNKNOWN' (matches Shopify's UNKNOWN bucket).
function isoCountry(raw: any): string {
  const c = String(raw || '').trim()
  return (!c || c.toLowerCase() === 'unknown') ? 'UNKNOWN' : c
}

// The two geo families. value() returns the breakdown_value; geo_region maps NAME→ISO + loud-warns the unmapped.
interface FieldCfg { breakdown_type: 'geo_country' | 'geo_region'; metaBreakdown: string; value: (ins: any, ctx: string) => string }
const FIELDS: FieldCfg[] = [
  { breakdown_type: 'geo_country', metaBreakdown: 'country', value: (ins) => isoCountry(ins.country) },
  {
    breakdown_type: 'geo_region', metaBreakdown: 'country,region',
    value: (ins, ctx) => {
      const country = isoCountry(ins.country)
      const region = String(ins.region || '').trim()
      if (!region || region.toLowerCase() === 'unknown') return `${country}-UNKNOWN`
      const code = country === 'US' ? US_REGION_TO_ISO[region] : undefined
      if (code) return `US-${code}` // "US-AL" — matches Shopify geo_region encoding
      // UNMAPPED (international / unrecognized): store RAW composite + loud warn — never guess, never drop.
      console.warn(`[meta-geo] UNMAPPED region "${region}" (country=${country}) — storing RAW "${country}-${region}", add to US_REGION_TO_ISO: ${ctx}`)
      return `${country}-${region}`
    },
  },
]

interface ComboStat {
  entity_level: string; breakdown_type: string
  rows: number; daysWritten: number; daysFlagged: number; anchorSum: number; geoSum: number
}

export interface GeoBackfillResult { status: number; body: Record<string, any> }

export async function runMetaGeoBackfill(
  clientId: string, startDate: string, endDate: string, opts: { dryRun?: boolean } = {}
): Promise<GeoBackfillResult> {
  const { data: clientRow, error: cErr } = await supabaseAdmin
    .from('clients').select('id, user_email, platform_connections(*)').eq('id', clientId).single()
  if (cErr || !clientRow) return { status: 404, body: { error: 'Client not found', detail: cErr?.message } }
  const conn = (clientRow.platform_connections || []).find((c: any) => c.platform === 'meta')
  if (!conn) return { status: 400, body: { error: 'Client has no Meta connection' } }
  const metaAccountId = conn.account_id as string
  const actId = metaAccountId.startsWith('act_') ? metaAccountId : 'act_' + metaAccountId
  const acctName = String(conn.account_name || '')
  const userEmail = (conn.user_email || clientRow.user_email) as string
  const { data: tok, error: tErr } = await supabaseAdmin
    .from('meta_tokens').select('access_token').eq('user_email', userEmail).single()
  if (tErr || !tok?.access_token) return { status: 400, body: { error: 'No Meta access token', detail: tErr?.message } }
  const token = tok.access_token as string

  // PER-DAY account-spend anchor cache (.maybeSingle → one row/day, no bulk query → no silent 1000-row cap).
  const acctCache = new Map<string, number>()
  const acctDay = async (date: string): Promise<number> => {
    const hit = acctCache.get(date)
    if (hit !== undefined) return hit
    const { data } = await supabaseAdmin
      .from('metrics_daily').select('spend')
      .eq('client_id', clientId).eq('platform', 'meta').eq('entity_level', 'account')
      .eq('breakdown_type', '').eq('breakdown_value', '').eq('date', date).maybeSingle()
    const v = fin((data as any)?.spend)
    acctCache.set(date, v)
    return v
  }

  const combos: Record<string, ComboStat> = {}
  const comboOf = (l: string, b: string): ComboStat => {
    const k = `${l}|${b}`
    if (!combos[k]) combos[k] = { entity_level: l, breakdown_type: b, rows: 0, daysWritten: 0, daysFlagged: 0, anchorSum: 0, geoSum: 0 }
    return combos[k]
  }
  const flagged: any[] = []
  const unmappedRegions = new Set<string>()
  const sampleRow: Record<string, unknown> = {} // dryRun diagnostic: first built row per breakdown_type
  let written = 0

  for (const chunk of monthChunks(startDate, endDate)) {
    const timeRange = encodeURIComponent(JSON.stringify({ since: chunk.from, until: chunk.to }))
    const filtering = encodeURIComponent(JSON.stringify([{ field: 'spend', operator: 'GREATER_THAN', value: '0' }]))

    for (const level of LEVELS) {
      const idSel = level.idFields ? level.idFields + ',' : ''
      for (const field of FIELDS) {
        const combo = comboOf(level.entity_level, field.breakdown_type)
        // breakdowns in &breakdowns= (NOT &fields=, L12). Full pagination via metaFetchAllPaged (guard 200).
        const url = `${META_API}/${actId}/insights?level=${level.metaLevel}&time_range=${timeRange}&time_increment=1&breakdowns=${field.metaBreakdown}&fields=${idSel}spend,clicks,impressions&filtering=${filtering}&limit=500`
        const insights = await metaFetchAllPaged(url, token, { guard: 200 })

        const byDate: Record<string, { rows: Record<string, unknown>[]; spend: number }> = {}
        for (const ins of insights) {
          const date = ins?.date_start // time_increment=1 → one day per row
          if (!date) continue
          const { entityId, entityName, parentId } = level.extract(ins, metaAccountId, acctName)
          if (!entityId) continue // unkeyable row — skip (never a fabricated key)
          const ctx = `client=${clientId} ${level.entity_level} ${entityId} ${date}`
          const geoValue = field.value(ins, ctx)
          if (field.breakdown_type === 'geo_region' && /^[A-Z]{2}-/.test(geoValue) === false && geoValue.includes('-') && !geoValue.endsWith('-UNKNOWN')) {
            // raw-composite fallback fired (warn already logged in value()); record which region for the report.
            unmappedRegions.add(geoValue)
          }
          const spend = fin(parseFloat(ins.spend || '0'))
          const clicks = fin(parseInt(ins.clicks || '0'))
          const impressions = fin(parseInt(ins.impressions || '0'))
          if (!byDate[date]) byDate[date] = { rows: [], spend: 0 }
          const b = byDate[date]
          b.spend += spend
          b.rows.push({
            client_id: clientId, user_email: userEmail, platform: 'meta', account_id: metaAccountId,
            entity_level: level.entity_level, entity_id: entityId, entity_name: entityName,
            parent_entity_id: parentId, date, breakdown_type: field.breakdown_type, breakdown_value: geoValue,
            spend: Number(spend.toFixed(2)), impressions, clicks, conversions: 0, conversion_value: 0, revenue: 0,
            extra: {
              ctr: ratio(clicks, impressions, 100), cpc: ratio(spend, clicks), cpm: ratio(spend, impressions, 1000),
              geoField: field.metaBreakdown,
              ...(field.breakdown_type === 'geo_region' ? { regionRaw: String(ins.region || '') } : {}),
            },
          })
        }
        combo.rows += Object.values(byDate).reduce((s, d) => s + d.rows.length, 0)
        if (opts.dryRun && !sampleRow[field.breakdown_type]) {
          const fb = Object.values(byDate).find((d) => d.rows.length > 0)
          if (fb) sampleRow[field.breakdown_type] = fb.rows[0]
        }

        for (const [date, bucket] of Object.entries(byDate)) {
          // RECONCILE = ACCOUNT level, SPEND only, FLAG-NOT-BLOCK. Σ(geo spend) ~== account×day anchor (geo
          // NEAR-partitions; the small undetermined-geo residual is flagged-but-written, never dropped).
          const acctSpend = await acctDay(date)
          const { within, delta } = reconcileDay(bucket.spend, acctSpend, { posture: 'flag' })
          combo.anchorSum += acctSpend
          combo.geoSum += bucket.spend
          if (!within) {
            combo.daysFlagged++
            flagged.push({
              entity_level: level.entity_level, breakdown_type: field.breakdown_type, date,
              geo_spend: Number(bucket.spend.toFixed(2)), account_spend: Number(acctSpend.toFixed(2)), delta: Number(delta.toFixed(2)),
            })
          }
          if (!opts.dryRun) {
            const { error: upErr } = await supabaseAdmin.from('metrics_daily').upsert(normalizeMetricsRows(bucket.rows), { onConflict: CONFLICT })
            if (upErr) return { status: 500, body: { error: 'upsert failed', entity_level: level.entity_level, breakdown_type: field.breakdown_type, date, detail: upErr.message, flagged } }
          }
          written += bucket.rows.length
          combo.daysWritten++
        }
      }
    }
  }

  return {
    status: 200,
    body: {
      clientId, metaAccountId, range: `${startDate}→${endDate}`, dryRun: !!opts.dryRun,
      written,
      reconcile: Object.values(combos).map((c) => ({
        entity_level: c.entity_level, breakdown_type: c.breakdown_type,
        rows: c.rows, daysWritten: c.daysWritten, daysFlagged: c.daysFlagged,
        anchorSum: Number(c.anchorSum.toFixed(2)), geoSum: Number(c.geoSum.toFixed(2)),
        delta: Number((c.geoSum - c.anchorSum).toFixed(2)),
      })),
      daysFlagged: flagged.length, flagged,
      unmappedRegions: [...unmappedRegions],
      ...(opts.dryRun ? { sampleRow } : {}),
    },
  }
}
