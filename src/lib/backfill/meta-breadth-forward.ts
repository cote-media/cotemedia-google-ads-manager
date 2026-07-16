// LORAMER_META_BREADTH_FORWARD_V1
// The ONE list of Meta BREADTH writers the FORWARD paths (cron/sync + cron/catchup) drive for a SINGLE day.
//
// WHY THIS EXISTS (the defect it closes — 2026-07-15 master audit, G1):
// Meta's only forward writer is meta-metrics-row.ts, which emits breakdown_type '' (base) and 'placement' and
// NOTHING else. Every other Meta breadth dimension existed ONLY via the drain's rangeLap (drain-registry.ts:152-168),
// which walks strictly BACKWARD from its cursor — so it can never capture "today". Each dim's data therefore FROZE at
// its own writer's ship date (device/age/gender 2026-06-27/28, action_type 06-29, video/geo 06-30, hour 07-02) while
// the same clients kept spending, and meta_device + meta_video had already reached floor with backfill_complete=true,
// sealing the hole permanently. Proven at audit: 4 active clients spending $2,920 over 2026-07-01..14 had base rows
// current to 07-14 and ZERO breadth rows for those days; a 1-day dryRun on Veterinary mastermind
// (f5fbe7e5-7b22-4a17-9681-6fab7fbeddb2) for 2026-07-14 returned 1,903 rows Meta serves and we were not storing.
// This wiring is the "forward covers ALL grains" half of the BEDROCK law. The backward repair of the existing hole is
// a SEPARATE flight (G1(b), cursor unseal) — deliberately NOT done here.
//
// REUSE, NOT REINVENTION: forward capture is just a ONE-DAY range, so each entry is the EXISTING, Gate-A-proven,
// reconcile-gated, fully-paginated backfill writer called with startDate === endDate === captureDate. Zero new
// row-building logic; every guard (full pagination via metaFetchAllPaged, the FLAG-NOT-BLOCK reconcile posture, the
// spend>0 filter, floor clamping, the no-fabricated-key skip) is inherited by construction.
//
// CURSORS: none of these writers touch sync_state (verified — cursors are written only by the drain's rangeLap), so
// driving them forward cannot advance, complete, or corrupt any backfill cursor. G1(b) stays untouched.
//
// ORDER is presentational only — each entry is independent and runs under its OWN isolated try/catch at the call
// site, so one dim's failure can never drop a sibling's rows (the Google breadth pattern, cron/sync:554-579).
import { runMetaDeviceBackfill } from './meta-device-backfill'
import { runMetaAgeGenderBackfill } from './meta-age-gender-backfill'
import { runMetaActionTypeBackfill } from './meta-action-type-backfill'
import { runMetaVideoBackfill } from './meta-video-backfill'
import { runMetaGeoBackfill } from './meta-geo-backfill'
import { runMetaHourBackfill } from './meta-hour-backfill'

// Structurally identical to drain-registry's RangeWriter (every writer already returns { status, body }); redeclared
// here rather than exported from there so the forward path takes no dependency on the drain's internals.
export type MetaBreadthWriter = (
  clientId: string,
  startDate: string,
  endDate: string,
  opts: { dryRun?: boolean }
) => Promise<{ status: number; body: Record<string, any> }>

// key = the log/error label (NOT a breakdown_type — several writers emit more than one family, e.g. 'device' writes
// both 'device' and 'device_platform'; 'age_gender' writes 'age', 'gender' and 'age_gender').
// The 6 writers cover all 10 breadth breakdown_types across all 4 entity levels {account, campaign, ad_set, ad}:
//   device      → device, device_platform      (4 levels x 2 fields =  8 insights reports/day)
//   age_gender  → age, gender, age_gender      (4 levels x 3 fields = 12)
//   action_type → action_type                  (4 levels, field-widen =  4)
//   video       → video                        (4 levels, field-widen =  4)
//   geo         → geo_country, geo_region      (4 levels x 2 fields =  8)
//   hour        → hour                         (4 levels, field-widen =  4)
//                                                            TOTAL/client/day = 40 reports
// placement is NOT here: it already HAS forward capture (meta-metrics-row.ts:131). Its campaign-only grain gap is a
// separate item (G6) — do not fold it in here.
export const META_BREADTH_FORWARD: { key: string; run: MetaBreadthWriter }[] = [
  { key: 'device', run: runMetaDeviceBackfill as MetaBreadthWriter },
  { key: 'age_gender', run: runMetaAgeGenderBackfill as MetaBreadthWriter },
  { key: 'action_type', run: runMetaActionTypeBackfill as MetaBreadthWriter },
  { key: 'video', run: runMetaVideoBackfill as MetaBreadthWriter },
  { key: 'geo', run: runMetaGeoBackfill as MetaBreadthWriter },
  { key: 'hour', run: runMetaHourBackfill as MetaBreadthWriter },
]
