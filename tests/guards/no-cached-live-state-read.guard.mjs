#!/usr/bin/env node
// LORAMER_NO_CACHED_DB_READ_V1 — GUARD. A READ THAT GATES A WRITE, OR THAT REPORTS LIVE STATE, MAY NEVER BE
// SERVED FROM NEXT'S DATA CACHE.
//
// WHY THIS IS A CLASS AND NOT THREE PATCHES. Next 14 patches global `fetch` and caches GETs; supabase-js reads
// are GETs. OBSERVED THREE TIMES IN THIS REPO: the order-grain one-op-per-shop check returning [] four times
// (2026-07-26), ga-dimensional-recover overwriting a live GA credential with a cached dead token (2026-07-30),
// and cron/catchup's op-budget read answering in 0.71-3.16ms with no network round trip while a no-store client
// took 144-340ms on the same query (2026-07-31) — which is why the drain declined 58 times and catchup never
// declined once. Same cause, three surfaces, escalating cost.
//
// THE RULE IS ENFORCED AT THE ONE SOURCE, NOT PER ROUTE. 105 route files exist; measured 2026-07-31, 52 carry
// no cache directives and 20 of those read live-state tables, including /api/intelligence and the three OAuth
// callbacks that WRITE TOKENS. Guarding a convention across 105 files is the failure mode FIX-WITH-GUARD names
// explicitly: collapse to one source and guard THAT.
//
// FOUR LEGS:
//  (a) supabaseAdmin — THE one source — is constructed with a no-store fetch
//  (b) no OTHER server-side supabase client is constructed WITHOUT one (a second unhardened client re-opens it)
//  (c) the directive DEBT LEDGER is anti-rot: the observed count of unhardened live-state routes must EQUAL the
//      baseline. A new one FAILS. Paying one down also FAILS until the ledger is dropped — a baseline may not
//      outlive its debt.
//  (d) the proven-affected reads are named, so a refactor that reverts one is caught by name and not by count
//
// ⛔ HERMETIC — source text only. Runs inside `npm run guard` -> `npm run build` -> Vercel, no DB, no network.
// HONEST LIMIT: this proves the CLIENT cannot be handed a cached response. It cannot prove Next's behaviour at
// runtime; that was settled by measurement (the latency probe above) and is not re-provable in a static check.

import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs'
import { join, resolve, relative } from 'node:path'

const ROOT = process.env.LORAMER_GUARD_ROOT || process.cwd()
const findings = []
const check = (c, m) => { if (!c) findings.push(m) }
const read = (p) => { try { return readFileSync(resolve(ROOT, p), 'utf8') } catch { return '' } }

// Tables whose rows describe LIVE STATE — budget/spend, quota sentinels, cursors, credentials, pass logs.
// A stale read of any of these produces a confident wrong answer rather than an error.
const LIVE_STATE_TABLES = [
  'cron_runs', 'sync_state', 'platform_connections', 'capture_pass_log', 'entity_state_history',
  'google_tokens', 'meta_tokens', 'shopify_tokens', 'ga_tokens', 'woocommerce_tokens',
  'store_bulk_operations', 'woo_connect_nonce',
]
const TABLE_RE = new RegExp(`from\\(['"](${LIVE_STATE_TABLES.join('|')})['"]\\)`)

// ── (a) THE ONE SOURCE ─────────────────────────────────────────────────────────────────────────────────
{
  const src = read('src/lib/supabase.ts')
  check(!!src, '(a) src/lib/supabase.ts is unreadable — the one source is gone.')
  const adminBlock = src.slice(src.indexOf('export const supabaseAdmin'))
  check(/cache:\s*['"]no-store['"]/.test(adminBlock),
    "(a) supabaseAdmin is NOT constructed with a no-store fetch. Every route inherits this client, so without it a `.select()` inside a route handler can be answered from Next's Data Cache — observed three times in this repo, twice destroying data (a duplicated bulk operation, an overwritten live GA credential).")
  check(/global:\s*\{[\s\S]{0,200}?fetch:/.test(adminBlock),
    '(a) supabaseAdmin does not override `global.fetch` — the no-store option has nowhere to attach.')
}

// ── (b) NO SECOND UNHARDENED SERVER CLIENT ─────────────────────────────────────────────────────────────
{
  const walk = (dir, out = []) => {
    for (const e of readdirSync(resolve(ROOT, dir))) {
      const p = join(dir, e)
      const st = statSync(resolve(ROOT, p))
      if (st.isDirectory()) walk(p, out)
      else if (/\.(ts|tsx)$/.test(e)) out.push(p)
    }
    return out
  }
  let files = []
  try { files = walk('src') } catch { /* handled by (a) */ }
  for (const f of files) {
    const src = read(f)
    if (!/createClient\(/.test(src)) continue
    // Only server-side clients matter: the anon browser client is not subject to the server Data Cache.
    if (!/SUPABASE_SERVICE_ROLE_KEY/.test(src)) continue
    const rel = f.replace(/\\/g, '/')
    check(/cache:\s*['"]no-store['"]/.test(src),
      `(b) ${rel} constructs a SERVICE-ROLE supabase client without a no-store fetch. A second unhardened client re-opens the whole class one file over — that is how the pattern spread the first time.`)
  }
}

// ── (c) THE DEBT LEDGER, ANTI-ROT ──────────────────────────────────────────────────────────────────────
// The one-source fix means route directives are no longer load-bearing for DB reads. They still matter for any
// RAW fetch a route makes, so the debt is tracked rather than declared paid. Observed must EQUAL listed.
// ⚠ 21, NOT 20. An earlier hand-written shell grep reported 20 because its table list omitted
// `woo_connect_nonce`, which /api/woocommerce/auth reads. The guard's own LIVE_STATE_TABLES list is the
// authoritative denominator — a hand-rolled inventory of this repo has been wrong before (banked: a
// single-line grep undercounted metrics_daily write sites by half, 25 vs 53). The checker produces its own
// inventory rather than trusting a number someone typed.
const UNHARDENED_LIVE_STATE_ROUTES_BASELINE = 21
{
  const apiDir = 'src/app/api'
  const routes = []
  const walk = (dir) => {
    for (const e of readdirSync(resolve(ROOT, dir))) {
      const p = join(dir, e)
      if (statSync(resolve(ROOT, p)).isDirectory()) walk(p)
      else if (e === 'route.ts') routes.push(p)
    }
  }
  try { walk(apiDir) } catch { /* no api dir */ }
  const unhardened = routes.filter((r) => {
    const src = read(r)
    if (!TABLE_RE.test(src)) return false
    return !/^export const (dynamic|fetchCache)/m.test(src)
  }).map((r) => r.replace(/\\/g, '/'))
  // The temporary cache probe must never be committed; if present it is its own finding.
  const probe = unhardened.filter((r) => r.includes('debug/cache-probe'))
  check(probe.length === 0,
    `(c) the TEMPORARY cache probe is still present (${probe.join(', ')}) — it was a diagnostic and must not ship.`)
  const real = unhardened.filter((r) => !r.includes('debug/cache-probe'))
  check(real.length === UNHARDENED_LIVE_STATE_ROUTES_BASELINE,
    `(c) DEBT LEDGER DRIFT — ${real.length} routes read a live-state table without cache directives, baseline says ${UNHARDENED_LIVE_STATE_ROUTES_BASELINE}. ` +
    (real.length > UNHARDENED_LIVE_STATE_ROUTES_BASELINE
      ? 'A NEW unhardened live-state route appeared. supabaseAdmin protects its DB reads, but any RAW fetch in it is still cacheable — add the directives or raise the baseline deliberately.'
      : 'Debt was PAID and the ledger was not updated. A baseline may not outlive its debt (the rule the metrics-upsert ledger already carries).') +
    `\n      observed: ${real.join(', ')}`)
}

// ── (d) THE PROVEN-AFFECTED READS, BY NAME ─────────────────────────────────────────────────────────────
{
  // shopify-bulk's sbNoStore is the original proven instance and must not be quietly removed on the grounds
  // that supabaseAdmin is now safe — it also guards RAW fetches in that adapter.
  const bulk = read('src/lib/order-grain/shopify-bulk.ts')
  check(/sbNoStore/.test(bulk) && /cache:\s*['"]no-store['"]/.test(bulk),
    "(d) order-grain/shopify-bulk.ts no longer carries its own no-store client. It was the FIRST proven instance (four bulk operations started where one was allowed) and its guard is independent of the shared client.")
  // The budget reader is the 2026-07-31 instance; it must go through the shared hardened client.
  const budget = read('src/lib/backfill/google-op-budget.ts')
  check(/from\('cron_runs'\)/.test(budget) && /supabaseAdmin/.test(budget),
    '(d) google-op-budget no longer reads cron_runs through supabaseAdmin — if it grew its own client it must be no-store (leg b), and if it stopped reading spend the budget is inert.')
  // The SCD2 writer's open-set read is a READ THAT GATES A WRITE — the sharpest case in the class.
  const scd2 = read('src/lib/capture/entity-state-history.ts')
  check(/supabaseAdmin/.test(scd2) && /from\('entity_state_history'\)/.test(scd2),
    '(d) entity-state-history no longer reads its open set through supabaseAdmin — that read GATES the insert, and a cached empty answer makes every fact plan as an open and collide on the primary key.')
}

if (findings.length) {
  console.error(`[no-cached-live-state-read] FAIL — ${findings.length} finding(s):`)
  for (const f of findings) console.error(`  · ${f}`)
  process.exit(1)
}
console.log(`[no-cached-live-state-read] PASS — supabaseAdmin is no-store at the one source, no second unhardened service-role client exists, the ${UNHARDENED_LIVE_STATE_ROUTES_BASELINE}-route directive debt ledger matches, and the three proven-affected reads are intact.`)
