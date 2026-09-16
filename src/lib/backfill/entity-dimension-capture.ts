// LORAMER_ENTITY_DIMENSION_V1 — THE DIMENSION READ, AND WHERE IT IS ALLOWED TO RUN.
//
// ⛔ IT RUNS BESIDE THE CAPTURE LOOP, NEVER INSIDE IT, AND THAT IS THE CONSTRAINT THIS FLIGHT WAS GIVEN.
// The write path is the measured ceiling (7,521 rows/s at width 12, LORAMER_FIRE_UNITS_CONCURRENT_V1) and this
// flight may not slow capture measurably. Three UN-SEGMENTED queries per client per day cannot slow a fire,
// because they do not run in one: the forward driver already holds the token and the customer id, already runs
// once per client per day, and is not the walk.
//
// ⛔ AND IT IS SOFT BY CONSTRUCTION. A dimension read that fails must never fail the driver's real work. The
// names are an ENRICHMENT of rows that are already correct without them; trading a day's metrics for a day's
// names would be the worse half of that bargain in every direction.
//
// ⛔ THE VENDOR CLIENT IS THE SHARED ONE (LORAMER_DIRECT_ACCESS_CUSTOMER_V1), so a customer's own account —
// reached directly rather than through our manager — gets its names and its chain on the same path as ours.
import { supabaseAdmin } from '@/lib/supabase'
import { withGoogleAdsCustomer } from '@/lib/google-ads-client'
import {
  DIMENSION_READS, observedFromRows, planDimensionRows, decideDimensionWrites,
  type ObservedEntity, type DimensionRow,
} from '@/lib/backfill/entity-dimension'

export type DimensionCaptureReport = {
  clientId: string
  customerId: string
  readsAttempted: number
  readsFailed: number
  observed: number
  written: number
  unchanged: number
  errors: string[]
  elapsedMs: number
}

/**
 * Refresh one client's entity dimension. Returns a report; NEVER throws.
 *
 * ⛔ THE WRITE IS AN UPSERT ON THE NATURAL KEY, so re-running this creates no second copy of anything — the
 * same idempotence rule the fact writer lives by, applied to the dimension.
 * ⛔ AND AN UNCHANGED ENTITY IS NOT WRITTEN AT ALL (`decideDimensionWrites`), so a daily refresh on a stable
 * account costs one read per level and ZERO writes.
 */
export async function captureEntityDimension(a: {
  clientId: string
  userEmail: string
  customerId: string
  platform?: string
  log?: (s: string) => void
}): Promise<DimensionCaptureReport> {
  const platform = a.platform ?? 'google'
  const started = Date.now()
  const log = a.log ?? (() => {})
  const rep: DimensionCaptureReport = {
    clientId: a.clientId, customerId: a.customerId,
    readsAttempted: 0, readsFailed: 0, observed: 0, written: 0, unchanged: 0, errors: [], elapsedMs: 0,
  }

  const { data: tok } = await supabaseAdmin
    .from('google_tokens').select('refresh_token').eq('user_email', a.userEmail).maybeSingle()
  const refreshToken = (tok?.refresh_token as string) || ''
  if (!refreshToken) {
    rep.errors.push(`no google refresh token for ${a.userEmail}`)
    rep.elapsedMs = Date.now() - started
    return rep
  }

  const observed: ObservedEntity[] = []
  for (const read of DIMENSION_READS) {
    rep.readsAttempted++
    try {
      const rows: any[] = await withGoogleAdsCustomer(
        { refreshToken, customerId: a.customerId },
        (c: any) => c.query(read.gaql) as Promise<any[]>,
      )
      observed.push(...observedFromRows(read, rows))
    } catch (e: any) {
      // ⛔ SOFT, AND LOUD. serializeVendorError's lesson: the vendor's own words, never "[object Object]".
      rep.readsFailed++
      const msg = `${read.entityLevel}: ${e?.errors?.[0]?.message ?? e?.message ?? String(e)}`.slice(0, 200)
      rep.errors.push(msg)
      log(`[entity-dimension] ${a.clientId} ${msg}`)
    }
  }
  rep.observed = observed.length
  if (!observed.length) { rep.elapsedMs = Date.now() - started; return rep }

  const planned = planDimensionRows({ clientId: a.clientId, platform, customerId: a.customerId, observed })

  // What we already hold, so an unchanged entity writes nothing.
  const held = new Map<string, { entityName: string | null; parentEntityId: string | null }>()
  try {
    const { data: rows } = await supabaseAdmin
      .from('google_entity_dimension')
      .select('entity_level, entity_id, entity_name, parent_entity_id')
      .eq('client_id', a.clientId).eq('platform', platform)
    for (const r of (rows ?? []) as any[]) {
      held.set(`${r.entity_level}|${r.entity_id}`, { entityName: r.entity_name ?? null, parentEntityId: r.parent_entity_id ?? null })
    }
  } catch (e: any) {
    // ⚠ AN UNREADABLE PRIOR STATE MEANS WE CANNOT SAY WHAT CHANGED. Writing everything would be correct but
    // churny; refusing would drop a real refresh. We write everything and SAY SO, because a dimension upsert
    // is idempotent and the cost is bounded by the account's entity count, not by its history.
    rep.errors.push(`prior dimension unreadable, writing all: ${e?.message ?? e}`)
  }

  const toWrite: DimensionRow[] = decideDimensionWrites(held, planned)
  rep.unchanged = planned.length - toWrite.length
  if (toWrite.length) {
    const payload = toWrite.map((w) => ({
      client_id: w.clientId, platform: w.platform, entity_level: w.entityLevel, entity_id: w.entityId,
      entity_name: w.entityName, parent_entity_id: w.parentEntityId, customer_id: w.customerId,
      updated_at: new Date().toISOString(),
    }))
    for (let i = 0; i < payload.length; i += 500) {
      const chunk = payload.slice(i, i + 500)
      const { error } = await supabaseAdmin
        .from('google_entity_dimension')
        .upsert(chunk, { onConflict: 'client_id,platform,entity_level,entity_id' })
      if (error) { rep.errors.push(`upsert: ${error.message}`); break }
      rep.written += chunk.length
    }
  }
  rep.elapsedMs = Date.now() - started
  log(`[entity-dimension] ${a.clientId}: observed ${rep.observed} · written ${rep.written} · unchanged ${rep.unchanged} · reads ${rep.readsAttempted - rep.readsFailed}/${rep.readsAttempted} · ${rep.elapsedMs}ms`)
  return rep
}
