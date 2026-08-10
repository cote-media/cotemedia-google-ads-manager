#!/usr/bin/env node
// LORAMER_SURFACE_SCOPED_WALL_V1 — A WALL IS SCOPED account × resource × segment. NEVER account-wide.
//
// ⛔ THE DEFECT THIS EXISTS TO MAKE UNSHIPPABLE, and it is `floor36()`'s exact shape one level in: a floor
// discovered for ONE resource, at ONE granularity, becomes an ACCOUNT-WIDE seal. That is how 214 cursors
// across 18 clients came to read `backfill_complete=true` over live data — not because anyone decided to
// seal an account, but because a fact with a narrow scope was stored and read as though it were broad.
//
// ⛔ AND THE VENDOR'S OWN RULE IS WHY THE SCOPE IS EXACTLY THIS WIDE AND NO WIDER. Google's retention wall
// is stated for GRANULAR segments specifically — "granular date segments (`segments.date`, `segments.week`,
// and hourly segments) only support a lookback window of 37 months"
// (developers.google.com/google-ads/api/docs/reporting/segmentation). So a refusal on `segments.date` says
// NOTHING about `segments.month` on the same resource, and nothing at all about a different resource.
// A key that drops `resource` or `segment` cannot express that, and the loss is silent.
//
// ⛔ WHAT THIS GUARD CANNOT DO, said plainly: it checks the KEY, not the NAME. `readAccountWall` /
// `recordAccountWall` still carry "Account" in their identifiers (the rename needs
// `google-ads-universe-writer.ts`, outside the 2026-08-10 amendment ceiling — ★WALL-HELPERS-STILL-NAMED-
// ACCOUNT). A correctly-keyed call through a badly-named function passes here, and should: the key is what
// the database enforces and the name is what a reader assumes. Both matter; only one is mechanical.
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { resolve, join } from 'node:path'

const ROOT = process.env.LORAMER_GUARD_ROOT || process.cwd()
const findings = []

// ── (a) EVERY CALL SITE MUST PASS BOTH resource AND segment ──────────────────────────────────────────
// Walk src/ rather than naming files: a NEW caller is exactly the case that must not slip through, and a
// hardcoded file list would pass on the day someone adds one.
const SRC = resolve(ROOT, 'src')
const files = []
;(function walk(dir) {
  let entries = []
  try { entries = readdirSync(dir) } catch { return }
  for (const name of entries) {
    const p = join(dir, name)
    let st
    try { st = statSync(p) } catch { continue }
    if (st.isDirectory()) walk(p)
    else if (/\.tsx?$/.test(name)) files.push(p)
  }
})(SRC)

const FLOOR_FNS = ['readAccountWall', 'recordAccountWall', 'readSurfaceWall', 'recordSurfaceWall']
let callSites = 0
for (const abs of files) {
  const rel = abs.slice(resolve(ROOT).length + 1)
  let src = ''
  try { src = readFileSync(abs, 'utf8') } catch { continue }
  const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1')
  for (const fn of FLOOR_FNS) {
    // Match the call and its argument object, non-greedily to the balancing `})`.
    const re = new RegExp(`${fn}\\s*\\(\\s*\\{([\\s\\S]*?)\\}\\s*\\)`, 'g')
    let m
    while ((m = re.exec(code)) !== null) {
      // A DEFINITION is not a call site. The writer declares these; only callers are checked here.
      if (/export\s+(async\s+)?function\s*$/.test(code.slice(Math.max(0, m.index - 40), m.index))) continue
      callSites++
      const args = m[1]
      for (const required of ['resource', 'segment', 'clientId']) {
        if (!new RegExp(`\\b${required}\\b`).test(args)) {
          findings.push(`(a) ${rel}: ${fn}({…}) omits \`${required}\` from the key. ` +
            `A wall is scoped account × resource × segment; a read or write missing any of the three either seals surfaces ` +
            `it never observed or fails to find the one it did. Args seen: ${args.replace(/\s+/g, ' ').trim().slice(0, 160)}`)
        }
      }
    }
  }
}
if (callSites === 0) {
  findings.push(`(a) NO floor read/write call site found anywhere in src/. Either the wall was removed — in which case the ` +
    `discovered-floor design is gone and this guard is the wrong shape — or it is now reached by a name this guard does not know. ` +
    `A guard that silently checks nothing is worse than no guard.`)
}

// ── (b) THE STORE'S KEY MUST CARRY THE SAME FOUR COLUMNS ─────────────────────────────────────────────
// ⛔ A correct caller against a too-narrow PRIMARY KEY is still an account-wide seal — the last writer wins
// and every other surface silently adopts its wall. The call site and the schema must agree, so both are checked.
const MIG = 'migrations/062_universe_account_floor.sql'
let sql = ''
try { sql = readFileSync(resolve(ROOT, MIG), 'utf8') }
catch (e) { findings.push(`(b) UNREADABLE ${MIG} — ${e.message}. A guard that cannot read its evidence FAILS.`) }
if (sql) {
  const pk = sql.match(/PRIMARY\s+KEY\s*\(([^)]*)\)/i)
  if (!pk) findings.push(`(b) ${MIG} declares no PRIMARY KEY — the wall would have no identity at all.`)
  else {
    for (const col of ['client_id', 'vendor', 'resource', 'segment']) {
      if (!new RegExp(`\\b${col}\\b`).test(pk[1])) {
        findings.push(`(b) ${MIG} PRIMARY KEY (${pk[1].replace(/\s+/g, ' ').trim()}) omits \`${col}\`. ` +
          `Without it two different surfaces collide on one row and the last refusal observed silently becomes every surface's wall.`)
      }
    }
  }
  for (const p of ['p_resource', 'p_segment']) {
    if (!new RegExp(`\\b${p}\\b`).test(sql)) {
      findings.push(`(b) the wall-record RPC in ${MIG} takes no \`${p}\`. A write that cannot name the surface cannot be scoped to it.`)
    }
  }
}

if (findings.length) {
  console.error(`[wall-is-surface-scoped] FAIL — ${findings.length} finding(s):`)
  for (const f of findings) console.error(`  - ${f}`)
  process.exit(1)
}
console.log(`[wall-is-surface-scoped] PASS — ${callSites} floor read/write call site(s) across ${files.length} source file(s) each pass clientId + resource + segment · and the store's PRIMARY KEY carries client_id, vendor, resource and segment with an RPC that names the surface. LIMIT: it checks the KEY, not the function NAME (★WALL-HELPERS-STILL-NAMED-ACCOUNT).`)
