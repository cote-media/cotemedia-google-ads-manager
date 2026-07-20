// LORAMER_META_BATCH_MG_V1 — one module per family (the meta-breadth-forward guard's contract; it resolves
// each imported ./meta-*-backfill module and reads the breakdown_types that module emits).
import { runSimpleBreakdown, type FieldCfg, type SimpleBreakdownResult } from './meta-simple-breakdown-core'

// The FORWARD-ONLY replacement for `dma`, which Meta REMOVED API-wide — historical DMA data is permanently
// unrecoverable (a platform purge, not our gap). Populates ONLY for comScore-MEASURED accounts, only from
// ~2026-06. Near-partitions the campaigns it covers → FLAG-NOT-BLOCK against campaigns present.
const COMSCORE_MARKET: FieldCfg = {
  breakdown_type: 'comscore_market', metaBreakdown: 'comscore_market', anchor: 'campaigns_present',
  levels: ['campaign', 'ad_set', 'ad'],
  emptyMeans: 'account is NOT comScore-measured, or the day predates ~2026-06 when Meta introduced this breakdown — not a capture failure and NOT a data gap',
}

export function runMetaComscoreMarketBackfill(clientId: string, startDate: string, endDate: string, opts: { dryRun?: boolean } = {}): Promise<SimpleBreakdownResult> {
  return runSimpleBreakdown(COMSCORE_MARKET, clientId, startDate, endDate, opts)
}
