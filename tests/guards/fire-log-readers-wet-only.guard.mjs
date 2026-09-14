#!/usr/bin/env node
// LORAMER_STATUS_WET_FIRES_ONLY_V1 — EVERY READER OF universe_fire_log EXCLUDES DRY FIRES, AT THE QUERY OR ON THE ROWS.
//
// THE DEFECT (QUEUE ★BACKFILL-STATUS-READS-DRY-FIRES, measured 2026-09-14): src/app/api/backfill/status/route.ts read the
// newest fire_outcome='completed' row for catalog_size with NO dry_run filter — the one reader of the table that did not.
// Foam OH holds three dry COMPLETED rows (ids 1268 · 1270 · 1779, 2026-08-22/24) whose catalog_size is 346, not the wet 349:
// the day a dry completed fire is the newest row, the "complete" verdict (`sealed >= catalogSize`) is judged against a
// stale — or, for a dry run on an injected catalogue, a false — denominator. Value-harmless today only because the newest
// completed row happens to be wet. Synthetic traffic is tagged (dry_run) so that every consumer can exclude it; a consumer
// that does not is reading test traffic as production.
//
// THE RULE, pinned as a STATIC AUDIT over src/ and scripts/ (both reader shapes):
//  (a) `.from('universe_fire_log')` chains that READ (no `.insert(`) carry `.eq('dry_run', false)` in the same chain.
//  (b) `universe_fire_log?select=` REST reads carry `dry_run=eq.false` / `dry_run=is.false` in the URL, OR select the
//      dry_run column AND filter the fetched rows on it within the next 30 lines (`.filter((f) => !f.dry_run)`) — a
//      Node-side filter on a column that was not SELECTED is a no-op (PostgREST returns only selected columns), so the
//      select list is checked too.
//  (c) the classifier is driven on inline fixtures (an unfiltered chain → finding; a filtered chain → none; an insert →
//      ignored; a REST read filtering a column it never selected → finding) so a broken audit cannot pass green.
//  (d) registered in scripts/run-guards.mjs.
// Seen RED first against 9f7ec28: (a) src/app/api/backfill/status/route.ts:45 — no dry_run filter on the catalog_size read.
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, resolve, dirname, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')
const findings = []
const RUNNER = 'scripts/run-guards.mjs'
const SELF = 'tests/guards/fire-log-readers-wet-only.guard.mjs'

// line-preserving: block comments are replaced by the same number of newlines so reported lines match the file
const stripComments = (s) => s.replace(/\/\*[\s\S]*?\*\//g, (c) => c.replace(/[^\n]/g, '')).replace(/(^|[^:'"`])\/\/[^\n]*/g, '$1')

/** Audit one file's text; returns findings as `${label}:${line} — reason`. Exported shape for the fixture leg. */
export function auditText(text, label) {
  const out = []
  const src = stripComments(text)
  const lines = src.split('\n')
  const lineOf = (idx) => src.slice(0, idx).split('\n').length
  // (a) supabase-js chains
  const chainRe = /\.from\(\s*['"]universe_fire_log['"]\s*\)/g
  let m
  while ((m = chainRe.exec(src))) {
    const start = m.index
    // the chain runs to the first line that does not continue with `.` or `)` — bounded at 15 lines
    const from = lineOf(start) - 1
    let chain = ''
    for (let i = from; i < Math.min(lines.length, from + 15); i++) {
      chain += lines[i] + '\n'
      const next = (lines[i + 1] ?? '').trim()
      if (i > from && !next.startsWith('.') && !next.startsWith(')')) break
    }
    if (/\.insert\(/.test(chain) || /\.upsert\(/.test(chain) || /\.update\(/.test(chain) || /\.delete\(/.test(chain)) continue // a writer, not a reader
    if (!/\.eq\(\s*['"]dry_run['"]\s*,\s*false\s*\)/.test(chain)) {
      out.push(`${label}:${from + 1} — a universe_fire_log READ with no \`.eq('dry_run', false)\` in the chain: dry (synthetic) fires reach this reader`)
    }
  }
  // (b) REST reads
  const restRe = /universe_fire_log\?select=([^&`'"\s]*)([^`'"\s]*)/g
  while ((m = restRe.exec(src))) {
    const line = lineOf(m.index)
    const selectList = m[1].split(',').map((s) => s.trim())
    const url = m[0]
    if (/dry_run=(eq|is)\.false/.test(url)) continue
    const window = lines.slice(line - 1, line + 30).join('\n')
    const nodeFilter = /\.filter\(\s*\(?\s*(\w+)\s*\)?\s*=>\s*!\s*\1\.dry_run\s*\)/.test(window)
    if (!selectList.includes('dry_run') && !selectList.includes('*')) {
      out.push(`${label}:${line} — REST read of universe_fire_log neither filters dry_run in the URL nor selects the dry_run column${nodeFilter ? ' (its Node-side filter tests a column PostgREST never returns — a no-op)' : ''}`)
      continue
    }
    if (!nodeFilter) out.push(`${label}:${line} — REST read selects dry_run but never filters the rows on it (no \`.filter((f) => !f.dry_run)\` within 30 lines) and the URL carries no dry_run=eq.false`)
  }
  return out
}

// ── (c) DRIVE THE CLASSIFIER ON FIXTURES FIRST — a broken audit must not pass green ────────────────────
{
  const fx = [
    ['unfiltered chain', `const { data } = await supabaseAdmin.from('universe_fire_log')\n  .select('catalog_size')\n  .eq('client_id', id).eq('fire_outcome', 'completed')\n  .order('fired_at', { ascending: false }).limit(1)\n`, 1],
    ['filtered chain', `const { data } = await supabaseAdmin.from('universe_fire_log')\n  .select('catalog_size')\n  .eq('client_id', id).eq('dry_run', false).eq('fire_outcome', 'completed')\n  .limit(1)\n`, 0],
    ['insert (writer)', `const { error } = await supabaseAdmin.from('universe_fire_log').insert({\n  client_id: clientId, dry_run: dryRun,\n})\n`, 0],
    ['rest url-filtered', "const r = await get(`universe_fire_log?select=fired_at,published&dry_run=eq.false&limit=5`)\n", 0],
    ['rest selected+node-filtered', "const r = await get(`universe_fire_log?select=fired_at,dry_run,published&limit=5`)\nconst wet = r.body.filter((f) => !f.dry_run)\n", 0],
    ['rest node-filter on unselected column', "const r = await get(`universe_fire_log?select=fired_at,published&limit=5`)\nconst wet = r.body.filter((f) => !f.dry_run)\n", 1],
    ['rest selected but never filtered', "const r = await get(`universe_fire_log?select=fired_at,dry_run,published&limit=5`)\nconst n = r.body.length\n", 1],
  ]
  for (const [name, text, expect] of fx) {
    const got = auditText(text, `fixture:${name}`).length
    if (got !== expect) findings.push(`(c) classifier fixture "${name}" produced ${got} finding(s), expected ${expect} — the audit cannot be trusted on real files`)
  }
}

// ── (a)/(b) THE REAL TREE ──────────────────────────────────────────────────────────────────────────────
const files = []
const walk = (dir) => {
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name === '.next' || name.startsWith('.')) continue
    const p = join(dir, name)
    const st = statSync(p)
    if (st.isDirectory()) walk(p)
    else if (/\.(ts|tsx|mjs|js)$/.test(name)) files.push(p)
  }
}
for (const d of ['src', 'scripts']) walk(join(ROOT, d))
for (const f of files) {
  const rel = relative(ROOT, f)
  if (rel === SELF) continue
  let text = ''
  try { text = readFileSync(f, 'utf8') } catch { continue }
  if (!text.includes('universe_fire_log')) continue
  findings.push(...auditText(text, rel).map((s) => `(a/b) ${s}`))
}

// ── (d) REGISTERED ────────────────────────────────────────────────────────────────────────────────────
try { if (!readFileSync(resolve(ROOT, RUNNER), 'utf8').includes(SELF)) findings.push(`(d) ${RUNNER} does not register ${SELF}`) } catch { findings.push(`(d) ${RUNNER} unreadable`) }

if (findings.length) {
  console.error(`[fire-log-readers-wet-only] FAIL — ${findings.length} finding(s):`)
  for (const f of findings) console.error(`  - ${f}`)
  process.exit(1)
}
console.log(`[fire-log-readers-wet-only] PASS — every universe_fire_log reader in src/ and scripts/ excludes dry fires (query-level .eq('dry_run', false) / dry_run=eq.false, or selects dry_run and filters the rows on it); writers ignored; the classifier proved on 7 fixtures (unfiltered chain, unselected-column no-op filter and selected-but-unfiltered all red); registered.`)
