// LORAMER_META_BATCH_MG_V1 — one module per family (the meta-breadth-forward guard's contract; it resolves
// each imported ./meta-*-backfill module and reads the breakdown_types that module emits).
import { runSimpleBreakdown, type FieldCfg, type SimpleBreakdownResult } from './meta-simple-breakdown-core'

// MEASURED 2026-07-19 (FoamOh 2024-11-28..29): the product breakdown carries $7,128.70 against $13,889.16 of
// spend on the very campaigns it appears in — a 49% shortfall. product_id does NOT partition even WITHIN
// catalog campaigns (a catalog campaign has delivery not attributable to any single product). The
// reconcile-posture law's test is explicit: does Σ(grain) tie to the anchor? It does not → WRITE-ONLY, never
// reconciled. Reconciling it would flag every catalog day forever and drown the real flags.
const PRODUCT_ID: FieldCfg = {
  breakdown_type: 'product_id', metaBreakdown: 'product_id', anchor: 'none',
  levels: ['campaign', 'ad_set', 'ad'],
  emptyMeans: 'account runs NO catalog/Advantage+ shopping campaigns — not a capture failure',
}

export function runMetaProductIdBackfill(clientId: string, startDate: string, endDate: string, opts: { dryRun?: boolean } = {}): Promise<SimpleBreakdownResult> {
  return runSimpleBreakdown(PRODUCT_ID, clientId, startDate, endDate, opts)
}
