#!/usr/bin/env node
// LORAMER_GOOGLE_DELETE_MY_DATA_V1 — check:data: THE DELETION'S TABLE LIST EQUALS WHAT THE DATABASE SAYS IS CLIENT-SCOPED.
//
// ⛔ THE CLASS: a Google delete that misses a table is a customer's data left behind, silently, forever — and the
// table that gets missed is the one added AFTER the list was written. So the list is never trusted; it is compared,
// at check time, against the schema itself: every table in public that carries a client_id column AND a platform or
// vendor column (partitions folded to their parent through pg_inherits), PLUS the client-only tables tables.ts
// declares with a reason. Anything the database lists and tables.ts does not → RED. Anything tables.ts lists and
// the database does not → RED (a table that no longer exists is a delete that will fail).
//
//   node scripts/check-google-delete-tables.mjs [--guard] [--against <json file with {"tables":[...]}>]
//   --against replaces the repo's list with another one (used to show the WIPE-DRAFT's list RED, 2026-09-21).
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const ROOT = process.env.LORAMER_GUARD_ROOT || process.cwd()
const args = process.argv.slice(2)
const GUARD = args.includes('--guard')
const againstIdx = args.indexOf('--against')
const AGAINST = againstIdx >= 0 ? args[againstIdx + 1] : null

for (const l of readFileSync(resolve(ROOT, '.env.local'), 'utf8').split('\n')) { const m = l.match(/^([A-Z0-9_]+)=(.*)$/); if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '') }
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL, KEY = process.env.SUPABASE_SERVICE_ROLE_KEY
if (!SUPABASE_URL || !KEY) { console.error('[google-delete-tables] NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY missing'); process.exit(2) }

// THE REPO'S LIST (or the list under test)
let repoList, clientOnly = [], excluded = []
if (AGAINST) {
  repoList = JSON.parse(readFileSync(resolve(ROOT, AGAINST), 'utf8')).tables
} else {
  const ts = readFileSync(resolve(ROOT, 'src/lib/google-delete/tables.ts'), 'utf8')
  repoList = [...ts.matchAll(/\{\s*table:\s*'([a-z0-9_]+)',\s*scope:\s*'([a-z_-]+)'/g)].map((m) => m[1])
  clientOnly = [...(ts.match(/GOOGLE_DELETE_CLIENT_ONLY[^=]*=\s*\[([\s\S]*?)\n\]/)?.[1] ?? '').matchAll(/table:\s*'([a-z0-9_]+)'/g)].map((m) => m[1])
  excluded = [...(ts.match(/GOOGLE_DELETE_EXCLUDED[^=]*=\s*\[([\s\S]*?)\n\]/)?.[1] ?? '').matchAll(/table:\s*'([a-z0-9_]+)',\s*reason:\s*'([^']*)'/g)].map((m) => ({ table: m[1], reason: m[2] }))
}

// THE DATABASE'S LIST — read through the schema-introspection RPC if present, else through PostgREST's information_schema view
async function dbTables() {
  // information_schema is not exposed through PostgREST by default; use the SQL-over-RPC helper the repo already ships
  // for check:data reads (rpc `exec_readonly_sql`) when present, else fall back to pg over SUPABASE_DB_URL.
  const sql = `
    with cols as (
      select c.table_name, bool_or(c.column_name='client_id') has_client, bool_or(c.column_name in ('platform','vendor')) has_pv
        from information_schema.columns c where c.table_schema='public' group by c.table_name),
    parts as (select child.relname child, parent.relname parent from pg_inherits i join pg_class child on child.oid=i.inhrelid join pg_class parent on parent.oid=i.inhparent)
    select distinct coalesce(p.parent, t.table_name) as table_name
      from cols t left join parts p on p.child = t.table_name
      join pg_class k on k.relname = t.table_name and k.relkind in ('r','p')
     where t.has_client and t.has_pv
     order by 1`
  const pg = (await import('pg')).default
  const c = new pg.Client({ connectionString: process.env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false }, application_name: 'check-google-delete-tables-readonly' })
  await c.connect()
  try { const r = await c.query(sql); return r.rows.map((x) => x.table_name) } finally { await c.end() }
}

const db = await dbTables()
const dbSet = new Set(db), repoSet = new Set(repoList)
const excludedSet = new Set(excluded.map((e) => e.table))
const missingInRepo = db.filter((t) => !repoSet.has(t) && !excludedSet.has(t))
const extraInRepo = repoList.filter((t) => !dbSet.has(t) && !clientOnly.includes(t))
const lines = []
lines.push(`[google-delete-tables] database: ${db.length} table(s) carry client_id + (platform|vendor) [partitions folded] · ${AGAINST ? 'list under test' : 'src/lib/google-delete/tables.ts'}: ${repoList.length} table(s) (${clientOnly.length} declared client-only)`)
for (const t of missingInRepo) lines.push(`  ✗ ${t} — the database says it is client+platform scoped and the deletion does not list it (a customer's rows would be left behind)`)
for (const t of extraInRepo) lines.push(`  ✗ ${t} — listed for deletion but the database has no such client+platform table (the delete would fail or the list is stale)`)
for (const t of clientOnly) lines.push(`  · ${t} — client-only, deleted by declaration (not in the class rule's set)`)
for (const e of excluded) lines.push(`  · ${e.table} — in the class rule's set, NOT deleted by declaration: ${e.reason}`)
const red = missingInRepo.length + extraInRepo.length
lines.push(`[google-delete-tables] VERDICT — EXIT ${red ? 1 : 0} · ${db.length} database table(s) vs ${repoList.length} listed: ${red ? red + ' mismatch(es)' : 'EQUAL'}`)
console.log(lines.join('\n'))
process.exit(red && GUARD ? 1 : red ? 1 : 0)
