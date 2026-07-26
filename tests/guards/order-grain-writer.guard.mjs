#!/usr/bin/env node
// LORAMER_ORDER_GRAIN_WRITER_GUARD_V1
//
// TWO defects this guards, both of which would be SILENT — correct-looking code, no error, wrong data:
//
// (1) LINE ITEMS BARE-UPSERTED. An order edit can REMOVE a line. An upsert only overwrites keys that RECUR,
//     so a removed line survives forever and inflates every product/variant aggregate built from the grain.
//     That is the exact stale-key trap already live in the metrics_daily day-REPLACE (cron/sync:319 is
//     upsert-only, no delete) and the whole point of storing the order grain is to stop reproducing it.
//     REQUIRED SHAPE: replace-per-order — upsert the current set, then DELETE that order's lines that are not
//     in it. An upsert with no accompanying scoped delete fails.
//
// (2) created_date DERIVED IN SQL. Shopify returns createdAt with the SHOP's UTC offset and forward capture
//     buckets a day with String(o.createdAt).slice(0,10) — the SHOP-LOCAL date. A generated
//     `((created_at at time zone 'UTC')::date)` column disagrees by one day for every late-evening order, so
//     every recompute-from-local would contradict rows forward capture already wrote. Byte-identical-to-
//     forward-capture is banked law. REQUIRED: the migration declares created_date as a plain adapter-written
//     column, and the adapter derives it with the same slice(0,10) expression.
//
// AUTHORITATIVE SOURCE = THE CODE + THE MIGRATION. HERMETIC: filesystem reads only.
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const ADAPTER = resolve(ROOT, 'src/lib/order-grain/shopify-bulk.ts')
const MIGRATION = resolve(ROOT, 'migrations/045_store_order_grain.sql')

const read = (p) => { try { return readFileSync(p, 'utf8') } catch { return null } }
const strip = (s) => s.replace(/\/\/[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '')
const failures = []
const fail = (m) => failures.push(m)

const adapterRaw = read(ADAPTER)
const migrationRaw = read(MIGRATION)
if (!adapterRaw) fail(`CANNOT READ ${ADAPTER} — the order-grain adapter is missing; treat as failure, never a pass.`)
if (!migrationRaw) fail(`CANNOT READ ${MIGRATION} — cannot verify the created_date column shape.`)

// ── 1. LINE ITEMS: REPLACE-PER-ORDER, NOT A BARE UPSERT ───────────────────────────────────────────────────
// Comments are stripped first, so a prose promise ("we replace per order") cannot satisfy the check.
if (adapterRaw) {
  const code = strip(adapterRaw)
  const upserts = [...code.matchAll(/from\(\s*'store_order_line_items'\s*\)[\s\S]{0,200}?\.upsert\(/g)]
  const deletes = [...code.matchAll(/from\(\s*'store_order_line_items'\s*\)[\s\S]{0,400}?\.delete\(\)/g)]

  if (upserts.length === 0) {
    fail("NO LINE-ITEM WRITE FOUND: nothing upserts into store_order_line_items. Either the writer is gone or it was renamed — this guard cannot verify a path it cannot find, so it fails rather than passing silently.")
  }
  if (deletes.length === 0) {
    fail("BARE UPSERT: store_order_line_items is upserted but NEVER deleted from. An order edit that REMOVES a line would leave that line in the table forever, inflating every product and variant aggregate built from the grain. Required: replace-per-order — upsert the current set, then delete that order's lines not in it.")
  } else {
    // The delete must be SCOPED TO ONE ORDER. An unscoped delete on this table is a different, worse bug.
    const scoped = /from\(\s*'store_order_line_items'\s*\)[\s\S]{0,400}?\.delete\(\)[\s\S]{0,400}?\.eq\(\s*'order_id'/.test(code)
    if (!scoped) {
      fail("UNSCOPED LINE-ITEM DELETE: the delete on store_order_line_items is not filtered by .eq('order_id', …). Replace-per-order means exactly one order's lines; an unscoped delete would wipe the grain.")
    }
    // And it must EXCLUDE the ids just written, or it is a delete-everything-then-nothing.
    const prunesByNotIn = /\.not\(\s*'line_item_id'\s*,\s*'in'/.test(code)
    if (!prunesByNotIn) {
      fail("DELETE DOES NOT EXCLUDE THE CURRENT SET: no `.not('line_item_id', 'in', …)` filter accompanies the scoped delete, so the prune cannot distinguish a line that is still present from one that was removed upstream.")
    }
  }
}

// ── 2. created_date IS ADAPTER-WRITTEN, NOT GENERATED ─────────────────────────────────────────────────────
if (migrationRaw) {
  const sql = migrationRaw.replace(/--[^\n]*/g, '')
  if (/created_date[^,)]*generated\s+always\s+as/i.test(sql)) {
    fail("created_date IS A GENERATED COLUMN: the migration derives it in SQL. Shopify's createdAt carries the SHOP's UTC offset and forward capture buckets on the shop-local date (shopify-intelligence:938), so a UTC-derived column disagrees by a day on every late-evening order and every recompute-from-local would contradict rows forward capture already wrote.")
  }
  if (!/created_date\s+date\s+NOT NULL/i.test(sql)) {
    fail('created_date IS NOT DECLARED `date NOT NULL` in the migration — the day key must be present on every row, or a recompute silently skips orders.')
  }
}

if (adapterRaw) {
  const code = strip(adapterRaw)
  // The adapter must derive the day the SAME way the live path does.
  if (!/slice\(\s*0\s*,\s*10\s*\)/.test(code)) {
    fail("ADAPTER DOES NOT DERIVE THE DAY KEY BY slice(0, 10): forward capture buckets with String(o.createdAt).slice(0,10). Any other derivation (Date parsing, toISOString, a timezone library) reintroduces the UTC-vs-shop-local disagreement this guard exists to prevent.")
  }
  if (!/created_at_raw/.test(code)) {
    fail('ADAPTER DOES NOT WRITE created_at_raw: without the verbatim vendor string, a day-key disagreement cannot be proven after the fact — only argued about.')
  }
  if (/from\(\s*'metrics_daily'\s*\)/.test(code)) {
    fail("ORDER-GRAIN ADAPTER TOUCHES metrics_daily: this layer's entire safety property is that a failure here is invisible to every existing number. It may read and write store_* tables ONLY.")
  }
}

// ── 3. THE GATING READ MUST NOT BE CACHED ─────────────────────────────────────────────────────────────────
// LORAMER_ORDER_GRAIN_NOSTORE_READ_V1. Next.js 14's App Router patches global fetch and CACHES GET requests by
// default; supabase-js reads are GETs. During Gate-A the one-op-per-shop check returned [] four times while the
// identical PostgREST query returned four rows to curl — the FIRST, legitimately-empty answer was replayed, and
// four bulk ops were started where one was allowed. Nothing errored. A read that GATES A WRITE must be no-store.
if (adapterRaw) {
  const code = strip(adapterRaw)
  if (!/cache:\s*'no-store'/.test(code)) {
    fail("GATING READ IS CACHEABLE: no `cache: 'no-store'` client exists in the adapter. Next.js caches supabase-js GETs by default, so the one-op-per-shop check would answer from a snapshot taken before the first submit and silently permit duplicate bulk operations.")
  }
  const inFlightBlock = code.slice(code.indexOf('const IN_FLIGHT'), code.indexOf('const endpoint'))
  if (inFlightBlock && /sbNoStore[\s\S]{0,120}?from\(\s*'store_bulk_operations'\s*\)/.test(inFlightBlock) === false) {
    fail("ONE-OP-PER-SHOP CHECK DOES NOT USE THE NO-STORE CLIENT: it reads store_bulk_operations through the shared client, whose GETs Next.js will cache. This is the exact defect Gate-A caught.")
  }
}

if (failures.length) {
  console.error('\n❌ LORAMER_ORDER_GRAIN_WRITER_GUARD_V1 FAILED\n')
  failures.forEach((f) => console.error('  • ' + f))
  console.error('')
  process.exit(1)
}
console.log('order-grain-writer.guard: PASS — line items replace-per-order (scoped delete excluding the current set), created_date adapter-written via slice(0,10) with created_at_raw preserved, metrics_daily untouched.')
