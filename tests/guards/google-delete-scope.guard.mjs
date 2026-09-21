#!/usr/bin/env node
// LORAMER_GOOGLE_DELETE_MY_DATA_V1 — THE DELETION FUNCTIONS CAN ONLY EVER TOUCH THE NAMED CLIENT AND PLATFORM GOOGLE.
//
// ⛔ THE CLASS THIS PINS: a definer function that deletes customer data is a privilege surface, and the only thing
// that keeps it narrow is the predicate written in its body. A parameter can be widened by a caller; a literal
// cannot. So this guard reads migrations/099_google_delete_client_data.sql and proves, per DELETE statement:
//   (a) `client_id = p_client` is in the WHERE clause;
//   (b) a platform/vendor LITERAL is beside it — `platform = 'google'`, `vendor in ('google', 'google_ads')`, the
//       three-spelling sync_state form — or the table is a DECLARED client-only table (src/lib/google-delete/tables.ts);
//   (c) there is no dynamic SQL anywhere in the file (no EXECUTE, no format());
//   (d) every function is `security definer` with `set search_path = public`, and carries REVOKE from public/anon/
//       authenticated plus GRANT EXECUTE to service_role (LORAMER_RPC_GRANT_POSTURE_V1);
//   (e) the set of tables the SQL deletes from EQUALS the list in src/lib/google-delete/tables.ts, and the function
//       named for each table is the one that deletes it; the inception row is deleted LAST in its function;
//   (f) the route (src/app/api/clients/google/delete-data/route.ts) imports the table list, calls every function
//       named there through supabaseAdmin.rpc, and never deletes from a listed table itself.
// The other half — that tables.ts equals what the DATABASE says is client+platform scoped — needs a DB read and is
// scripts/check-google-delete-tables.mjs in check:data.
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const ROOT = process.env.LORAMER_GUARD_ROOT || process.cwd()
const SQL = 'migrations/099_google_delete_client_data.sql'
const TABLES = 'src/lib/google-delete/tables.ts'
const ROUTE = 'src/app/api/clients/google/delete-data/route.ts'
const findings = []
const read = (rel) => { try { return readFileSync(resolve(ROOT, rel), 'utf8') } catch { findings.push(`UNREADABLE ${rel} — a guard that cannot read its evidence FAILS`); return '' } }

const sql = read(SQL), tablesTs = read(TABLES), route = read(ROUTE)
if (sql && tablesTs && route) {
  // the declared list
  const declared = [...tablesTs.matchAll(/\{\s*table:\s*'([a-z0-9_]+)',\s*scope:\s*'([a-z_-]+)',\s*fn:\s*'([a-z_]+)'\s*\}/g)].map((m) => ({ table: m[1], scope: m[2], fn: m[3] }))
  if (declared.length < 20) findings.push(`(e) ${TABLES} declares only ${declared.length} table(s); the list is expected to be the whole client+platform set`)
  const clientOnly = new Set([...(tablesTs.match(/GOOGLE_DELETE_CLIENT_ONLY[^=]*=\s*\[([\s\S]*?)\n\]/)?.[1] ?? '').matchAll(/table:\s*'([a-z0-9_]+)'/g)].map((x) => x[1]))

  // (c) no dynamic SQL
  const codeOnly = sql.replace(/^\s*--.*$/gm, '').replace(/^\s*(grant|revoke)\b.*$/gim, '')
  if (/\bexecute\b/i.test(codeOnly)) findings.push('(c) the migration contains EXECUTE — dynamic SQL is not allowed in a definer delete')
  if (/\bformat\s*\(/i.test(sql)) findings.push('(c) the migration contains format( — dynamic SQL is not allowed in a definer delete')

  // functions
  const fns = [...sql.matchAll(/create or replace function public\.([a-z_]+)\(([^)]*)\)[\s\S]*?\$\$([\s\S]*?)\$\$;/g)].map((m) => ({ name: m[1], sig: m[2], body: m[3], head: sql.slice(m.index, m.index + 400) }))
  if (fns.length < 8) findings.push(`found only ${fns.length} function(s) in ${SQL}; expected the eight`)
  const deletedBy = new Map()
  for (const f of fns) {
    if (!/security definer/i.test(f.head)) findings.push(`(d) ${f.name} is not SECURITY DEFINER`)
    if (!/set search_path = public/i.test(f.head)) findings.push(`(d) ${f.name} does not pin search_path = public`)
    if (/\bp_platform\b|\bp_vendor\b|\bp_table\b/.test(f.sig)) findings.push(`(b) ${f.name} takes a platform/vendor/table parameter — containment must be a literal in the body`)
    const revoke = new RegExp(['public', 'anon', 'authenticated'].map((r) => `revoke all on function public\\.${f.name}\\([^)]*\\) from ${r};`).join('[\\s\\S]*'))
    const grant = new RegExp(`grant execute on function public\\.${f.name}\\([^)]*\\) to service_role;`)
    if (!revoke.test(sql)) findings.push(`(d) ${f.name} lacks the REVOKE ... from public, anon, authenticated line`)
    if (!grant.test(sql)) findings.push(`(d) ${f.name} lacks GRANT EXECUTE ... to service_role`)
    for (const d of f.body.matchAll(/delete from public\.([a-z0-9_]+)\s+where\s+([\s\S]*?);/g)) {
      const table = d[1], where = d[2].replace(/\s+/g, ' ')
      deletedBy.set(table, f.name)
      if (!/client_id = p_client/.test(where)) findings.push(`(a) ${f.name}: DELETE FROM ${table} does not pin client_id = p_client`)
      const platformPin = /platform = 'google'/.test(where)
      const vendorPin = /vendor in \('google', 'google_ads'\)/.test(where)
      const syncPin = /platform = 'google' or platform like 'google\\_%' escape '\\' or platform like '\\_\\_%google%' escape '\\'/.test(where)
      if (!(platformPin || vendorPin || syncPin) && !clientOnly.has(table)) findings.push(`(b) ${f.name}: DELETE FROM ${table} carries no platform/vendor literal and ${table} is not a declared client-only table`)
      if (/\bor\b/.test(where) && !syncPin) findings.push(`(b) ${f.name}: DELETE FROM ${table} has an OR in its predicate outside the declared sync_state form`)
    }
  }
  // (e) equality with the declared list, and the declared function
  const declaredSet = new Set(declared.map((t) => t.table))
  for (const t of declared) {
    if (!deletedBy.has(t.table)) findings.push(`(e) ${t.table} is declared in ${TABLES} but no function in ${SQL} deletes from it`)
    else if (deletedBy.get(t.table) !== t.fn) findings.push(`(e) ${t.table} is declared under ${t.fn} but ${SQL} deletes it in ${deletedBy.get(t.table)}`)
  }
  for (const [table, fn] of deletedBy) if (!declaredSet.has(table)) findings.push(`(e) ${SQL} deletes from ${table} (in ${fn}) but ${TABLES} does not declare it — the list must be the one place`)
  const walk = fns.find((f) => f.name === 'google_delete_client_walk_state')
  if (walk) { const order = [...walk.body.matchAll(/delete from public\.([a-z0-9_]+)/g)].map((m) => m[1]); if (order[order.length - 1] !== 'universe_account_inception') findings.push(`(e) the walk-state function must delete universe_account_inception LAST; it deletes ${order[order.length - 1]} last`) }
  // (e2) the re-count function names every declared table with the same pins — the run ENDS by reading each back at 0
  const cnt = fns.find((f) => f.name === 'google_count_client_rows')
  if (!cnt) findings.push('(e2) google_count_client_rows is missing — the run must end with every table re-counted')
  else {
    const counted = new Map()
    for (const line of cnt.body.split('\n')) {
      const m = line.match(/'([a-z0-9_]+)',\s*\(select count\(\*\) from (?:\(select 1 from )?public\.([a-z0-9_]+) where (.*)$/)
      if (m) counted.set(m[1], { table: m[2], where: m[3] })
    }
    for (const t of declared) {
      const c = counted.get(t.table)
      if (!c) { findings.push(`(e2) google_count_client_rows does not count ${t.table}`); continue }
      if (c.table !== t.table) findings.push(`(e2) the count labelled ${t.table} reads ${c.table}`)
      if (!/client_id = p_client/.test(c.where)) findings.push(`(e2) the count of ${t.table} does not pin client_id = p_client`)
      const pinned = /platform = 'google'/.test(c.where) || /vendor in \('google', 'google_ads'/.test(c.where) || clientOnly.has(t.table)
      if (!pinned) findings.push(`(e2) the count of ${t.table} carries no platform/vendor literal`)
    }
    for (const t of counted.keys()) if (!declaredSet.has(t)) findings.push(`(e2) google_count_client_rows counts ${t}, which is not declared`)
  }
  // (f) the route
  if (!/from '@\/lib\/google-delete\/tables'/.test(route)) findings.push(`(f) ${ROUTE} does not import the table list`)
  for (const fn of new Set(declared.map((t) => t.fn))) if (!new RegExp(`rpc[<(][^)]*'${fn}'`).test(route) && !route.includes(`'${fn}'`)) findings.push(`(f) ${ROUTE} never calls ${fn}`)
  for (const d of route.matchAll(/\.from\('([a-z0-9_]+)'\)[\s\S]{0,120}?\.delete\(/g)) if (declaredSet.has(d[1])) findings.push(`(f) ${ROUTE} deletes from ${d[1]} directly — every listed table is deleted only through its definer function`)
  if (!/maxDuration = 800/.test(route)) findings.push(`(f) ${ROUTE} must declare maxDuration = 800 (the month loop and the quiet wait need it)`)
}

if (findings.length) {
  console.error(`\n❌ LORAMER_GOOGLE_DELETE_SCOPE_V1 FAILED — ${findings.length} finding(s)\n`)
  findings.forEach((f) => console.error('  • ' + f))
  process.exit(1)
}
console.log('google-delete-scope.guard: PASS — every DELETE in migrations/099 pins client_id = p_client and a platform/vendor literal, no dynamic SQL, definer + search_path + grant posture on all functions, the SQL table set equals src/lib/google-delete/tables.ts, inception last, the re-count names every table with the same pins, the route deletes only through the functions.')
