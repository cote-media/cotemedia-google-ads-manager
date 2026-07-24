#!/usr/bin/env node
// LORAMER_LORA_TOOL_DECISION_LOG_V1 — read-only RATE QUERY for the L2-retrieval instrument (lora_tool_decisions).
// The family is classified + stored at WRITE time (src/lib/lora-tool-log.ts), so this reads the stored `family`
// and only needs to know which families are NARRATED (build-claude-context puts them in the prompt → a from-context
// answer is CORRECT) vs CAPTURED-HISTORY-ONLY (not in the prompt → a from-context answer is a SKIP, the metric).
// The narrated set comes from the ONE source src/lib/lora-family-classify.ts (isNarratedFamily) — no drift.
// `unknown` is excluded from the rate, never silently bucketed.
//
// USAGE: node scripts/lora-tool-decision-rate.mjs [--since=YYYY-MM-DD] [--until=YYYY-MM-DD]
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import { createRequire } from 'node:module'
import pg from 'pg'
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
for (const line of (readFileSync(resolve(ROOT, '.env.local'), 'utf8') || '').split('\n')) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/); if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '')
}
const arg = (k, d) => { const a = process.argv.find((s) => s.startsWith(`--${k}=`)); return a ? a.split('=')[1] : d }
const since = arg('since', '2000-01-01'), until = arg('until', '2999-01-01')

// import isNarratedFamily from the ONE source (transpile the pure .ts)
const require = createRequire(resolve(ROOT, 'package.json'))
const ts = require('typescript')
const js = ts.transpileModule(readFileSync(resolve(ROOT, 'src/lib/lora-family-classify.ts'), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText
const mod = { exports: {} }; new Function('exports', 'require', 'module', js)(mod.exports, require, mod)
const { isNarratedFamily } = mod.exports

const client = new pg.Client({ connectionString: process.env.SUPABASE_DB_URL })
await client.connect()
const { rows } = await client.query(
  `select family, tool_called from lora_tool_decisions
    where created_at >= $1::timestamptz and created_at < ($2::date + 1)::timestamptz`,
  [since, until])
await client.end()

const b = { captured: { total: 0, skip: 0, tool: 0 }, narrated: { total: 0, ctx: 0, tool: 0 }, unknown: 0 }
for (const r of rows) {
  const fam = r.family || 'unknown'
  if (fam === 'unknown') { b.unknown++; continue }
  if (isNarratedFamily(fam)) { b.narrated.total++; r.tool_called ? b.narrated.tool++ : b.narrated.ctx++ }
  else { b.captured.total++; r.tool_called ? b.captured.tool++ : b.captured.skip++ }
}

console.log(`LORA TOOL-DECISION RATE  [${since} .. ${until}]  rows=${rows.length}`)
console.log(`  CAPTURED-HISTORY-ONLY : ${b.captured.total}  → answered-from-context (SKIP): ${b.captured.skip}  · with-tool (correct): ${b.captured.tool}`)
const rate = b.captured.total ? (100 * b.captured.skip / b.captured.total).toFixed(1) : 'n/a'
console.log(`  >>> SKIP RATE (the metric) : ${b.captured.skip}/${b.captured.total} = ${rate}%  (captured-history questions answered without a tool)`)
console.log(`  NARRATED (context is correct): ${b.narrated.total}  → from-context (correct): ${b.narrated.ctx}  · with-tool (tool-eager, also fine): ${b.narrated.tool}`)
console.log(`  UNKNOWN (unclassified, excluded from rate): ${b.unknown}`)
