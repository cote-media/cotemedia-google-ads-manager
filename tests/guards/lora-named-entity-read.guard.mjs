#!/usr/bin/env node
// LORAMER_LORA_NAMED_ENTITY_READ_V1 — EVERY GRAIN LORA CAN ASK FOR MUST HAVE A PATH THAT RETURNS ITS NAME.
//
// ── WHY ─────────────────────────────────────────────────────────────────────────────────────────────────
// ★ENTITY-NAME-AND-GRAIN-UNREACHABLE, measured 2026-08-14: Lora had NO per-entity named read — not a broken
// one, NONE — and the hole produced two confident wrong answers in one baseline. `query_metrics` sums a level
// into ONE unnamed total; `query_breakdown` groups by breakdown_value and never reads entity_name. So:
//   · "the campaign breakdown returns one row with a blank name" — 2,564 google campaign-family rows all carry
//     breakdown_value='' (identity is in entity_id), while 4,878 BASE rows held the real names, unreachable.
//   · a Meta creative question answered at ASSET grain, where conversions are legitimately 0 on all 472
//     body_asset values, while entity_level='ad' base rows held 1,523 conversions AND the ad names.
// ⛔ BOTH WERE SILENT. The query succeeded, the numbers were arithmetically correct, and the answer was to a
// different question than the one asked. Nothing failed; that is the whole danger.
//
// ── THE THREE LEGS ──────────────────────────────────────────────────────────────────────────────────────
//   (i)  REACHABILITY, DRIVEN AGAINST THE TOOL REGISTRY — for EVERY level in query_entities' own enum there
//        must be a Lora-callable path returning entityName. Registry-driven on purpose: a future grain added
//        to the enum without a named read fails the build instead of shipping another unreachable level.
//        Also asserts the tool is in BOTH tools arrays (blocking + streaming loops) and in the dispatcher —
//        a tool defined and not dispatched is the purest narrow green.
//   (ii) WRITER/READER COLUMN AGREEMENT — for the vendor-named families the walk writes, the column the
//        WRITER populates (entity_id, breakdown_value='') must be the column the READER groups by, or the
//        family is structurally unrankable. This leg does NOT demand they match; it demands the disagreement
//        stay DECLARED, so nobody "fixes" a family by smuggling identity into breakdown_value and silently
//        changing the conflict key.
//   (iii) THE TEACHING SURVIVES — the tool description must keep both the THINGS-vs-DIMENSION-VALUES rule and
//        the named asset trap. The model chose assets because assets were the only named thing it could
//        reach; the description is the only thing that stops it choosing them again now that ad grain exists.
//
// ── HONEST LIMIT ────────────────────────────────────────────────────────────────────────────────────────
// STATIC SOURCE READ. It proves the tool is defined, dispatched, attached to both loops, and still teaching.
// It CANNOT prove the model chooses correctly (that is the eval), and it cannot prove a row comes back with a
// non-empty name — that is the LIVE half, scripts/check-lora-named-entity.mjs, in check:data.
//
// USAGE: node tests/guards/lora-named-entity-read.guard.mjs
//        [--inject-drop-tool] [--inject-drop-dispatch] [--inject-one-loop] [--inject-drop-teaching]
import { readFileSync } from 'node:fs'
import path from 'node:path'

const ROOT = process.env.LORAMER_GUARD_ROOT || process.cwd()
const read = (rel) => { try { return readFileSync(path.resolve(ROOT, rel), 'utf8') } catch { return null } }

const DROP_TOOL = process.argv.includes('--inject-drop-tool')
const DROP_DISPATCH = process.argv.includes('--inject-drop-dispatch')
const ONE_LOOP = process.argv.includes('--inject-one-loop')
const DROP_TEACHING = process.argv.includes('--inject-drop-teaching')

const F_TOOLS = 'src/lib/claude-tools.ts'
const F_QUERY = 'src/lib/metrics-query.ts'
const F_WRITER = 'src/lib/backfill/google-ads-universe-writer.ts'
const tools = read(F_TOOLS), query = read(F_QUERY), writer = read(F_WRITER)
for (const [n, s] of [[F_TOOLS, tools], [F_QUERY, query], [F_WRITER, writer]]) {
  if (!s) { console.error(`✗ ${n} unreadable — BROKEN INSTRUMENT, not a pass.`); process.exit(2) }
}

const findings = []

// ── (i) REACHABILITY — registry-driven ──────────────────────────────────────────────────────────────────
// Pull the level enum out of the SHIPPED tool definition, not a hand-copy: the point is that the guard reads
// the same list the model is offered.
const toolBlock = DROP_TOOL ? '' : (/export const QUERY_ENTITIES_TOOL[\s\S]*?\n\}\n/.exec(tools)?.[0] ?? '')
if (!toolBlock) {
  findings.push(`(i) ${F_TOOLS}: QUERY_ENTITIES_TOOL is gone. Without it Lora has NO per-entity named read at any grain and both 2026-08-14 baseline failures return — a blank-named campaign list and a creative answer at asset grain.`)
} else {
  const levelEnum = /level:\s*\{[\s\S]*?enum:\s*\[([^\]]*)\]/.exec(toolBlock)
  const levels = levelEnum ? [...levelEnum[1].matchAll(/'([a-z_]+)'/g)].map((m) => m[1]) : []
  if (levels.length === 0) findings.push(`(i) ${F_TOOLS}: QUERY_ENTITIES_TOOL declares no level enum — the reachability leg cannot enumerate what it must check. A guard that cannot see its subject FAILS.`)
  // The single named path: queryEntities. It must select entity_name and be grain-generic (no level allowlist
  // that could silently exclude an enum member).
  const qeBlock = /export async function queryEntities\([\s\S]*?\n\}\n/.exec(query)?.[0] ?? ''
  const selectsName = qeBlock.includes('entity_name')
  const returnsName = /entityName: e\.entityName/.test(qeBlock)
  const grainGeneric = /\.eq\('entity_level', opts\.level\)/.test(qeBlock)
  for (const lvl of levels) {
    if (!(selectsName && returnsName && grainGeneric)) {
      findings.push(`(i) level '${lvl}' is offered to the model but queryEntities no longer provides a named read for it (selects entity_name=${selectsName} · returns entityName=${returnsName} · grain-generic=${grainGeneric}). An offered grain with no named path is exactly the hole this flight closed.`)
      break
    }
  }
  const dispatched = !DROP_DISPATCH && /tu\.name === 'query_entities'\) payload = await runQueryEntitiesTool/.test(tools)
  if (!dispatched) findings.push(`(i) ${F_TOOLS}: 'query_entities' is not dispatched in executeToolUses. A tool the model can see and the executor cannot run returns "unknown tool" — defined-but-undispatched is the purest narrow green.`)
  const arrays = (tools.match(/QUERY_METRICS_TOOL, QUERY_BREAKDOWN_TOOL, QUERY_MONEY_TOOL, QUERY_ENTITIES_TOOL/g) || []).length
  const want = ONE_LOOP ? 99 : 2
  if (arrays < want) findings.push(`(i) ${F_TOOLS}: QUERY_ENTITIES_TOOL is attached to ${arrays} of 2 tools arrays. There are TWO loops — blocking and streaming — and a tool present in one is a tool that vanishes the moment the streaming flag flips.`)
}

// ── (ii) WRITER/READER COLUMN AGREEMENT ─────────────────────────────────────────────────────────────────
// The walk writes resource-only entries with breakdown_value='' and identity in entity_id. That convention is
// DELIBERATE and load-bearing on the conflict key; the reader groups by breakdown_value. The disagreement is
// therefore REAL and must stay DECLARED at the writer, so no future flight "fixes" a family by moving identity
// into breakdown_value — which would change the upsert key and silently re-key stored history.
const conventionDeclared = /carries its identity in entity_id[\s\S]{0,120}rather than smuggling it into breakdown_value/.test(writer)
if (!conventionDeclared) {
  findings.push(`(ii) ${F_WRITER}: the resource-only convention ("breakdown_value='' and identity in entity_id, NOT smuggled into breakdown_value") is no longer declared at the builder. That sentence is what stops someone making a vendor-named family rankable by moving identity into breakdown_value — which is part of the conflict key (client, platform, entity_level, entity_id, date, breakdown_type, breakdown_value) and would re-key every stored row of that family.`)
}
const readerGroupsByValue = /const value = String\(row\.breakdown_value \?\? ''\)/.test(query)
if (!readerGroupsByValue) {
  findings.push(`(ii) ${F_QUERY}: the breakdown reader no longer groups by breakdown_value — leg (ii)'s premise has moved and the writer/reader agreement must be re-derived rather than assumed.`)
}

// ── (iii) THE TEACHING SURVIVES ─────────────────────────────────────────────────────────────────────────
if (!DROP_TEACHING && toolBlock) {
  const teaches = [
    [/named THING/i, 'the THINGS-vs-DIMENSION-VALUES rule'],
    [/query_breakdown/, 'the explicit comparison against query_breakdown'],
    [/does not attribute conversions to individual creative assets/i, 'the Meta asset trap — the measured reason the model picked assets over ads'],
  ]
  for (const [re, what] of teaches) {
    if (!re.test(toolBlock)) findings.push(`(iii) ${F_TOOLS}: QUERY_ENTITIES_TOOL's description no longer carries ${what}. The description is the ONLY thing standing between the model and the asset families it correctly-but-wrongly chose on 2026-08-14; the tool existing is not the fix, the tool being CHOSEN is.`)
  }
} else if (DROP_TEACHING) {
  findings.push('(iii) [--inject-drop-teaching] the description teaching was treated as absent in the check INPUT.')
}

for (const [flag, note] of [
  [DROP_TOOL, '[--inject-drop-tool] treated QUERY_ENTITIES_TOOL as absent'],
  [DROP_DISPATCH, '[--inject-drop-dispatch] treated the dispatcher branch as absent'],
  [ONE_LOOP, '[--inject-one-loop] demanded the tool in more arrays than exist (simulates a one-loop attach)'],
  [DROP_TEACHING, '[--inject-drop-teaching] treated the description teaching as absent'],
]) if (flag) console.log(`  ${note} — it must go RED.`)

console.log('[lora-named-entity-read] (i) registry-driven reachability + dispatch + both loops · (ii) writer/reader column agreement DECLARED · (iii) the description still teaches the choice')
console.log('[lora-named-entity-read] STATIC READ — proves the tool is wired and still teaching, NOT that the model chooses it (the eval) and NOT that a name comes back (scripts/check-lora-named-entity.mjs, check:data).')
if (findings.length) {
  console.error(`✗ lora-named-entity-read FAIL — ${findings.length} finding(s):`)
  for (const f of findings) console.error(`  - ${f}`)
  process.exit(1)
}
console.log('✓ lora-named-entity-read OK — every offered grain has a named path, it is dispatched on both loops, and the choice is still taught.')
process.exit(0)
