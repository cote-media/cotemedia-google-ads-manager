// LORAMER_GOOGLE_DELETE_MY_DATA_V1 — THE TABLE LIST, PURE, ONE PLACE.
//
// ⛔ NO IMPORTS, BY DESIGN: tests/guards/google-delete-scope.guard.mjs reads this file by regex and proves that every
// table named here is deleted by migrations/099_google_delete_client_data.sql (and nothing else is), and
// scripts/check-google-delete-tables.mjs (check:data) proves that this list EQUALS the set of tables the database
// itself says carry a client_id and a platform or vendor column (partitions folded to their parent) plus the
// walk-owned client-only tables declared below. The list is never typed against memory: a new client-scoped Google
// table that lands in the schema turns check:data red until it is added here AND to the migration.
//
// `scope` names the literal predicate the migration's function carries beside `client_id = p_client`:
//   platform     → platform = 'google'
//   vendor       → vendor in ('google', 'google_ads')       (the walk spells its vendor both ways — measured 2026-09-21)
//   sync_state   → platform = 'google' | like 'google_%' | like '__%google%'
//   client-only  → no platform/vendor column; the table is walk-owned and the walk is Google-only
// `fn` is the database function that deletes it; `order` is children-first within a function.

export type DeleteScope = 'platform' | 'vendor' | 'sync_state' | 'client-only'
export interface DeleteTable { table: string; scope: DeleteScope; fn: string }

export const GOOGLE_DELETE_TABLES: readonly DeleteTable[] = [
  // 1 — the connection first: every writer (sync, catchup, drain, driver, resume roster) enumerates it
  { table: 'platform_connections', scope: 'platform', fn: 'google_delete_client_connection' },
  // 2 — the ledgers (append-only for the app)
  { table: 'universe_attempt_log', scope: 'vendor', fn: 'google_delete_client_ledgers' },
  { table: 'universe_window_log', scope: 'vendor', fn: 'google_delete_client_ledgers' },
  { table: 'forward_observation_log', scope: 'vendor', fn: 'google_delete_client_ledgers' },
  { table: 'universe_fire_log', scope: 'client-only', fn: 'google_delete_client_ledgers' },
  // 3 — the warehouse, one date range per call
  { table: 'metrics_daily', scope: 'platform', fn: 'google_delete_client_metrics' },
  // 4 — capture tables
  { table: 'capture_pass_log', scope: 'platform', fn: 'google_delete_client_capture' },
  { table: 'entity_state_history', scope: 'platform', fn: 'google_delete_client_capture' },
  { table: 'google_entity_dimension', scope: 'platform', fn: 'google_delete_client_capture' },
  { table: 'known_floors', scope: 'platform', fn: 'google_delete_client_capture' },
  { table: 'sync_state', scope: 'sync_state', fn: 'google_delete_client_capture' },
  { table: 'metrics_daily_hour_respell_manifest_20260826', scope: 'platform', fn: 'google_delete_client_capture' },
  { table: 'metrics_daily_walkdupe_manifest_20260811', scope: 'platform', fn: 'google_delete_client_capture' },
  { table: 'walk_prefixed_snapshot_20260821', scope: 'platform', fn: 'google_delete_client_capture' },
  { table: 'store_order_line_items', scope: 'platform', fn: 'google_delete_client_capture' },
  { table: 'store_orders', scope: 'platform', fn: 'google_delete_client_capture' },
  { table: 'store_bulk_operations', scope: 'platform', fn: 'google_delete_client_capture' },
  // 5 — the walk state, children first, inception LAST (its absence is what starts a re-descent on reconnect)
  { table: 'universe_missed_cursor', scope: 'vendor', fn: 'google_delete_client_walk_state' },
  { table: 'universe_run_notice', scope: 'vendor', fn: 'google_delete_client_walk_state' },
  { table: 'universe_run_state', scope: 'vendor', fn: 'google_delete_client_walk_state' },
  { table: 'universe_run', scope: 'vendor', fn: 'google_delete_client_walk_state' },
  { table: 'universe_fire_lease', scope: 'vendor', fn: 'google_delete_client_walk_state' },
  { table: 'universe_lane_hold', scope: 'vendor', fn: 'google_delete_client_walk_state' },
  { table: 'universe_account_floor', scope: 'vendor', fn: 'google_delete_client_walk_state' },
  { table: 'universe_account_inception', scope: 'vendor', fn: 'google_delete_client_walk_state' },
]

/** Tables the class rule (client_id + platform/vendor column) would list but that are NOT Google data and are not
 *  deleted: each carries a reason the check:data leg prints. Keep this empty unless the schema forces an entry. */
export const GOOGLE_DELETE_EXCLUDED: readonly { table: string; reason: string }[] = [
  { table: 'platform_compliance_log', reason: 'the deletion log itself — the record of the request is kept, never deleted by the request it records' },
]

/** Client-scoped tables with no platform/vendor column that ARE deleted, with the reason (the class rule cannot see them). */
export const GOOGLE_DELETE_CLIENT_ONLY: readonly { table: string; reason: string }[] = [
  { table: 'universe_fire_log', reason: 'walk-owned, per-fire rows; the walk is Google-only today' },
]

/** Not deleted, nulled: the intelligence cache bundles every platform per client, so the row stays and the cache is cleared. */
export const GOOGLE_DELETE_NULLED = [{ table: 'client_context', column: 'intelligence_cache' }] as const

export const GOOGLE_DELETE_PLATFORM = 'google' as const
export const GOOGLE_DELETE_VENDORS = ['google', 'google_ads'] as const
/** The row ceiling one metrics call accepts before answering SPLIT (measured 2026-09-21: see DECISIONS). */
export const GOOGLE_DELETE_MAX_ROWS_PER_CALL = 300_000
