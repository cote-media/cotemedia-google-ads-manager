// LORAMER_REST_ROW_CAP_READER_V1 — THE ONE PostgREST READER FOR scripts/ AND tests/guards/ THAT CANNOT RETURN A PARTIAL SET.
//
// ⛔ WHY IT EXISTS, MEASURED 2026-09-11 17:02Z: `forward_observation_log?…&limit=100000` through a bare fetch returned
// HTTP 206 · Content-Range 0-999/5423 · 1,000 rows, and the check that trusted `rows.length` judged 16 of 17 connections
// short while every one held 319/319. PostgREST's max-rows is a SERVER ceiling; a client `limit=` cannot raise it
// (docs.postgrest.org → configuration → db-max-rows). The only honest denominator is the one the server writes into
// Content-Range when asked (Prefer: count=exact; docs.postgrest.org → pagination_count), and it must be READ, not assumed.
//
// THE CONTRACT
//   · pages with `Range: start-end` (page ≤ max-rows; a larger page is clamped by the server, so the loop advances by the
//     rows actually received, never by the page size it asked for);
//   · `Prefer: count=exact` on the FIRST page only — the total is read once; later pages carry `*` and that is expected;
//   · accepts 200 (whole set fit in one page) and 206 (partial) only;
//   · THROWS on: any other status · a 416 (the loop overran the total it read) · a total of `*` on the first page
//     (unknown — MDN Content-Range: "<size> — the total length of the document (or * if unknown)"; unknown is not zero
//     and is not "trust the short page") · an unparseable Content-Range · an empty page before the total is reached ·
//     rows held ≠ total at exit. It never returns a partial count.
//   · TOP-LEVEL RESOURCE ONLY. An EMBEDDED resource (`select=…,clients(...)`) is capped by max-rows with NO 206 and NO
//     Content-Range signal (PostgREST/postgrest#2776); this helper cannot see that cap. Use an embed only for 1:1 joins.
//   · `rpc/` paths are refused — an RPC that returns SETOF is capped the same way (migrations/038 comment); aggregate
//     server-side and return jsonb or a scalar instead.
//
// USAGE (from scripts/*.mjs):      import { restAll, restAllCounted } from './lib/rest-all.mjs'
//       (from tests/guards/*.mjs):  import { restAll } from '../../scripts/lib/rest-all.mjs'
//   const rows = await restAll('forward_observation_log?select=client_id&vendor=eq.google')
//   const { rows, total } = await restAllCounted('…')   // total = the server's Content-Range size, for printing denominators
//
// PAGE ⇐ measured 2026-09-11 N=1: Content-Range 0-999/5423 on a Range-less read — the server page is 1,000 rows.
export const PAGE = 1000

const CONTENT_RANGE_RE = /^(?:\*|(\d+)-(\d+))\/(\*|\d+)$/

const short = (p) => String(p).split('?')[0]

export async function restAllCounted(path, opts = {}) {
  const page = Number(opts.page ?? PAGE)
  const sb = opts.sb ?? process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = opts.key ?? process.env.SUPABASE_SERVICE_ROLE_KEY
  const fetchImpl = opts.fetchImpl ?? fetch
  if (!sb || !key) throw new Error('restAll: Supabase env missing (NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY) — a reader with no credentials is CANNOT RUN, never an empty set')
  if (!Number.isInteger(page) || page < 1) throw new Error(`restAll: page must be a positive integer, got ${page}`)
  if (/^rpc\//.test(path)) throw new Error(`restAll: refuses rpc/ paths (${short(path)}) — a SETOF RPC is capped the same way; return jsonb or a scalar`)

  // ⛔ LORAMER_STABLE_PAGE_ORDER_V1 (2026-09-24, round 53) — A RANGE PAGE WITHOUT A TOTAL ORDER IS NOT A PAGE. PostgreSQL: "If sorting
  // is not chosen, the rows will be returned in an unspecified order … it must not be relied on." MEASURED on the driver-day leg's read
  // (forward_observation_log, 2026-09-24): 5,526 rows held — exactly the server total, so the held ≠ total guard below could not see it —
  // but 4,408 DISTINCT: 1,118 duplicates and 1,118 rows never read; 8 of 17 connections judged short while every one held 323/323.
  // With order=id the same read held 5,526 distinct. So every read orders by the table's UNIQUE key: appended when the caller names no
  // order, appended AFTER a caller order that is not the key (recorded_at.desc stays first, id breaks its ties). A table this file has no
  // unique key for REFUSES to page (CANNOT RUN) — paging it unkeyed is the defect. Keys read from pg_index 2026-09-24.
  const table = path.split('?')[0]
  const orderKey = ORDER_KEYS[table] ?? (ID_KEYED_TABLES.includes(table) ? 'id' : null)
  if (!orderKey) throw new Error(`restAll: no unique order known for ${table} — a Range page without a total order is not a page; add its primary key to ORDER_KEYS or ID_KEYED_TABLES (scripts/lib/rest-all.mjs)`)
  const om = path.match(/(?:[?&])order=([^&]*)/)
  if (!om) path += (path.includes('?') ? '&' : '?') + 'order=' + orderKey
  else if (!om[1].split(',').map((x) => x.split('.')[0]).includes(orderKey.split(',')[0])) path = path.replace(om[0], om[0] + ',' + orderKey)
  const rows = []
  let total = null
  for (let start = 0; ; ) {
    const headers = { apikey: key, Authorization: `Bearer ${key}`, Range: `${start}-${start + page - 1}` }
    if (start === 0) headers.Prefer = 'count=exact'
    const r = await fetchImpl(`${sb}/rest/v1/${path}`, { headers })
    const cr = r.headers.get('content-range')
    if (r.status === 416) throw new Error(`restAll: 416 Range Not Satisfiable at ${start} on ${short(path)} (Content-Range ${cr}) — the loop overran the total it read (${total})`)
    if (r.status !== 200 && r.status !== 206) throw new Error(`restAll: HTTP ${r.status} on ${short(path)}: ${(await r.text().catch(() => '')).slice(0, 200)}`)
    const m = String(cr ?? '').match(CONTENT_RANGE_RE)
    if (!m) throw new Error(`restAll: unparseable Content-Range "${cr}" on ${short(path)} — without the server's total there is no denominator`)
    if (start === 0) {
      if (m[3] === '*') throw new Error(`restAll: Content-Range total is * (unknown) on ${short(path)} — unknown is not zero and a short page is not the set; the server did not honour Prefer: count=exact`)
      total = Number(m[3])
    }
    const body = await r.json()
    if (!Array.isArray(body)) throw new Error(`restAll: non-array body on ${short(path)}: ${JSON.stringify(body).slice(0, 200)}`)
    rows.push(...body)
    if (rows.length >= total) break
    if (body.length === 0) throw new Error(`restAll: empty page at ${start} while holding ${rows.length} of ${total} on ${short(path)} — the server stopped before its own total`)
    start += body.length // advance by what arrived: a page larger than max-rows is clamped by the server
  }
  if (rows.length !== total) throw new Error(`restAll: held ${rows.length} ≠ server total ${total} on ${short(path)} — refusing to return a partial set`)
  return { rows, total }
}

/** Rows only. Same contract; the total is discarded after the held ≠ total check. */
/** LORAMER_STABLE_PAGE_ORDER_V1 — tables whose unique order is a composite (no single `id` primary key), read from pg_index 2026-09-24. */
export const ORDER_KEYS = Object.freeze({
  metrics_daily: 'id,date',                    // partitioned: primary key (id, date)
  sync_state: 'client_id,platform',            // unique (client_id, platform), no id
  entity_state_history: 'client_id,platform,account_id,entity_level,entity_id,state_key,state_value,valid_from', // its primary key
})
/** LORAMER_STABLE_PAGE_ORDER_V1 — every public table whose primary key is exactly (id), read from pg_index 2026-09-24 (35). */
export const ID_KEYED_TABLES = Object.freeze(['anthropic_spend_log','capture_pass_log','chat_turn_failures','client_context','client_conversations','client_members','client_memory','clients','cron_runs','dashboard_layouts','forward_observation_log','ga_tokens','known_floors','lora_tool_decisions','maintenance_analyze_log','meta_compliance_log','meta_tokens','org_client_grants','org_members','organizations','platform_compliance_log','platform_connections','shopify_compliance_log','shopify_tokens','store_bulk_operations','stripe_events','subscriptions','universe_attempt_log','universe_fire_log','universe_reask_queue','universe_run_notice','universe_window_log','upload_audit','uploaded_docs','woocommerce_tokens'])

export async function restAll(path, opts = {}) {
  return (await restAllCounted(path, opts)).rows
}
