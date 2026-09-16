#!/usr/bin/env node
// LORAMER_ENTITY_DIMENSION_V1 — THE CHAIN IS REAL, THE NAME IS CURRENT, AND A RE-READ WRITES NOTHING.
//
// ⛔ THE MEASURED DEFECT THIS EXISTS TO MAKE UNREPEATABLE, Foam OH, 2026-09-16:
//     41,825 ad_group_ad rows · ONE distinct parent value · and that value is the ACCOUNT
//     0 named entities across 98,060 walk rows (entity_name is null on every one)
// The hierarchy was flat and nothing had a name, while the ad group's id was sitting inside the ad's own
// entity_id the whole time: `customers/7688521852/adGroupAds/195408186860~801802996686`.
//
// ⛔ THE COUNTERFACTUAL IS BUILT IN, because a guard that only fails when a function is MISSING proves
// nothing about behaviour. Leg (b) reconstructs the OLD writer's rule — "parent is always the customer id" —
// against the same fixture and asserts it IS caught flattening the chain.
//
// LEGS
//  (a) an ad names its ad group, an ad group its campaign, a campaign its account — resolved from the
//      dimension alone, with no database
//  (b) COUNTERFACTUAL: the old "parent = customerId" rule is detected as flat
//  (c) a rename resolves to the NEW name, and writes exactly one row
//  (d) an UNCHANGED entity writes NOTHING — a daily re-read must not rewrite the dimension
//  (e) a null name never overwrites a known one; "the read was thin" is not "the name is gone"
//  (f) the tilde parse is exact: it derives the ad group, and returns null for shapes that only look parseable
//  (g) the dimension reads carry no `segments.date` — a dimension query that is segmented is a report, and
//      it would land in the capture loop's cost rather than beside it
//  (h) the migration declares no date column — one would make this a fact table and re-open Type 2 by accident
import { readFileSync, mkdtempSync, rmSync } from 'node:fs'
import { resolve, join } from 'node:path'
import { tmpdir } from 'node:os'
import { spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'

const ROOT = process.env.LORAMER_GUARD_ROOT || process.cwd()
const findings = []
const read = (rel) => {
  try { return readFileSync(resolve(ROOT, rel), 'utf8') }
  catch (e) { findings.push(`UNREADABLE ${rel} — ${e.message}. A guard that cannot read its evidence FAILS.`); return '' }
}

const MOD = 'src/lib/backfill/entity-dimension.ts'
const MIG = 'migrations/095_google_entity_dimension.sql'

const out = mkdtempSync(join(tmpdir(), 'loramer-entity-dim-'))
try {
  const tsc = join(ROOT, 'node_modules', '.bin', 'tsc')
  const r = spawnSync(tsc, [resolve(ROOT, MOD), '--target', 'es2020', '--module', 'commonjs',
    '--moduleResolution', 'node', '--skipLibCheck', '--noResolve', '--rootDir', resolve(ROOT), '--outDir', out], { encoding: 'utf8' })
  if (r.error) findings.push(`could not run tsc — ${r.error.message}`)
  const M = createRequire(import.meta.url)(join(out, 'src/lib/backfill/entity-dimension.js'))

  const CID = '1234567890' // fixture: synthetic — the id shape only; the vendor's own doc uses this exact placeholder
  const CAMPAIGN = `customers/${CID}/campaigns/111`
  const ADGROUP = `customers/${CID}/adGroups/222`
  const AD = `customers/${CID}/adGroupAds/222~333`

  // The vendor's three dimension reads, as they actually come back.
  const observed = [
    { entityLevel: 'campaign', entityId: CAMPAIGN, entityName: 'Brand Search', parentEntityId: null },
    { entityLevel: 'ad_group', entityId: ADGROUP, entityName: 'Exact — core', parentEntityId: CAMPAIGN },
    // deliberately WITHOUT an explicit parent, to prove the id-derived fallback carries the ad
    { entityLevel: 'ad_group_ad', entityId: AD, entityName: 'RSA v2', parentEntityId: null },
  ]
  const planned = M.planDimensionRows({ clientId: 'c1', platform: 'google', customerId: CID, observed })

  // ── (f) the tilde parse ────────────────────────────────────────────────────────────────────────────
  if (M.parentFromResourceName(AD) !== ADGROUP) {
    findings.push(`(f) the ad's own id did not yield its ad group. Google documents that parsing the id gives the ad group, and the id is already in the warehouse — got ${M.parentFromResourceName(AD)}.`)
  }
  for (const shape of [ADGROUP, CAMPAIGN, `customers/${CID}/adGroupCriteria/222~333`, 'nonsense', '']) {
    if (M.parentFromResourceName(shape) !== null) {
      findings.push(`(f) parentFromResourceName invented a parent for "${shape}" (${M.parentFromResourceName(shape)}). An ad group's PATH parent is the customer while its LOGICAL parent is the campaign — a confident wrong answer there is worse than none.`)
    }
  }

  // ── (a) the chain ──────────────────────────────────────────────────────────────────────────────────
  const dim = new Map(planned.map((p) => [`${p.entityLevel}|${p.entityId}`,
    { entityLevel: p.entityLevel, entityName: p.entityName, parentEntityId: p.parentEntityId }]))
  const chain = M.resolveChain(dim, 'ad_group_ad', AD)
  const levels = chain.map((c) => c.entityLevel).join(' → ')
  if (levels !== 'ad_group_ad → ad_group → campaign') {
    findings.push(`(a) THE CHAIN IS NOT REAL: got "${levels}". An ad must name its ad group, an ad group its campaign, and a campaign must terminate at the account.`)
  }
  const names = chain.map((c) => c.entityName)
  if (names.join('|') !== 'RSA v2|Exact — core|Brand Search') {
    findings.push(`(a) the chain resolved but the names did not: ${JSON.stringify(names)}.`)
  }
  const campaignRow = planned.find((p) => p.entityLevel === 'campaign')
  if (campaignRow.parentEntityId !== null) {
    findings.push(`(a) a campaign was given a parent row (${campaignRow.parentEntityId}). Its parent is the ACCOUNT, which is the customer_id column, not another dimension row.`)
  }

  // ── (b) THE COUNTERFACTUAL — the old rule, caught ─────────────────────────────────────────────────
  {
    const oldRule = observed.map((o) => ({ ...o, parentEntityId: CID })) // writer:1013 `parent_entity_id: ctx.customerId`
    const oldDim = new Map(oldRule.map((p) => [`${p.entityLevel}|${p.entityId}`,
      { entityLevel: p.entityLevel, entityName: p.entityName, parentEntityId: p.parentEntityId }]))
    const oldChain = M.resolveChain(oldDim, 'ad_group_ad', AD)
    const flat = oldChain.map((c) => c.entityLevel).join(' → ')
    if (flat === 'ad_group_ad → ad_group → campaign') {
      findings.push(`(b) THE COUNTERFACTUAL WENT UNDETECTED. The OLD rule — parent_entity_id = customerId on every row — produced a correct-looking chain in this fixture, so this guard cannot tell the flat hierarchy from the real one and every PASS above is decoration.`)
    }
    const distinctParents = new Set(oldRule.map((o) => o.parentEntityId)).size
    if (distinctParents !== 1) findings.push(`(b) the counterfactual is mis-built: the old rule should produce exactly ONE distinct parent (it produced ${distinctParents}), which is what was measured on 41,825 live rows.`)
  }

  // ── (c)(d)(e) the SCD-1 merge ─────────────────────────────────────────────────────────────────────
  const held = new Map(planned.map((p) => [`${p.entityLevel}|${p.entityId}`,
    { entityName: p.entityName, parentEntityId: p.parentEntityId }]))

  // (d) an unchanged re-read writes nothing
  const noop = M.decideDimensionWrites(held, planned)
  if (noop.length !== 0) {
    findings.push(`(d) AN UNCHANGED RE-READ WROTE ${noop.length} ROW(S). A dimension re-read daily that rewrites regardless is write churn against the measured ceiling, and it is the row-inflation entity_state_history was built to refuse.`)
  }

  // (c) a rename writes exactly one row and resolves to the new name
  const renamed = planned.map((p) => p.entityLevel === 'campaign' ? { ...p, entityName: 'Brand Search 2027' } : p)
  const writes = M.decideDimensionWrites(held, renamed)
  if (writes.length !== 1 || writes[0].entityName !== 'Brand Search 2027') {
    findings.push(`(c) a rename did not write exactly one row with the new name: ${JSON.stringify(writes.map((w) => [w.entityLevel, w.entityName]))}.`)
  }
  const afterDim = new Map(renamed.map((p) => [`${p.entityLevel}|${p.entityId}`,
    { entityLevel: p.entityLevel, entityName: p.entityName, parentEntityId: p.parentEntityId }]))
  const newName = M.resolveChain(afterDim, 'ad_group_ad', AD).at(-1)?.entityName
  if (newName !== 'Brand Search 2027') findings.push(`(c) after a rename the chain still resolves to "${newName}" — the whole point of looking the name up is that it follows the vendor.`)

  // (e) a thin read must not blank a known name
  const thin = planned.map((p) => ({ ...p, entityName: null }))
  const thinWrites = M.decideDimensionWrites(held, thin)
  if (thinWrites.length !== 0) {
    findings.push(`(e) A THIN READ BLANKED ${thinWrites.length} KNOWN NAME(S). "The read did not carry a name" and "the vendor says the name is gone" are different facts, and only one of them is ours to assert.`)
  }

  // the named-beats-null fold inside one read
  const dupes = M.planDimensionRows({ clientId: 'c1', platform: 'google', customerId: CID, observed: [
    { entityLevel: 'ad_group', entityId: ADGROUP, entityName: null, parentEntityId: CAMPAIGN },
    { entityLevel: 'ad_group', entityId: ADGROUP, entityName: 'Exact — core', parentEntityId: CAMPAIGN },
  ] })
  if (dupes.length !== 1 || dupes[0].entityName !== 'Exact — core') {
    findings.push(`(e) two rows for one entity inside a single read did not fold to the NAMED one: ${JSON.stringify(dupes)}. An ad group appears once per ad, so this is the normal case, not an edge.`)
  }

  // cycle safety — a bad write must not hang the resolver
  const cyc = new Map([
    ['a|1', { entityLevel: 'a', entityName: 'A', parentEntityId: '2' }],
    ['b|2', { entityLevel: 'b', entityName: 'B', parentEntityId: '1' }],
  ])
  const cycChain = M.resolveChain(cyc, 'a', '1')
  if (cycChain.length > 4) findings.push(`(a) resolveChain did not stop on a cycle (${cycChain.length} links). A resolver that loops on bad data is a worse defect than the bad data.`)
} catch (e) {
  findings.push(`the behavioural legs could not run — ${e.message}. A guard that cannot execute its subject FAILS; it does not pass quietly.`)
} finally {
  rmSync(out, { recursive: true, force: true })
}

// ── (g) THE DIMENSION READS ARE NOT REPORTS ──────────────────────────────────────────────────────────
const mod = read(MOD)
{
  const block = /DIMENSION_READS[\s\S]*?\n\]/.exec(mod)
  if (!block) findings.push(`(g) ${MOD} declares no DIMENSION_READS.`)
  else {
    if (/segments\.date/.test(block[0])) {
      findings.push(`(g) a dimension read carries segments.date. A segmented query is a REPORT: it costs what a capture query costs and it belongs in the capture loop's budget, which this flight may not grow.`)
    }
    for (const needed of ['campaign', 'ad_group', 'ad_group_ad']) {
      if (!new RegExp(`entityLevel: '${needed}'`).test(block[0])) {
        findings.push(`(g) no dimension read for ${needed} — the chain cannot be resolved without it.`)
      }
    }
    if (!/campaign\.resource_name FROM ad_group/.test(block[0])) {
      findings.push(`(g) the ad_group read does not select campaign.resource_name. That link is the ONE the id cannot give — an ad group's path parent is the customer, not its campaign — so without it the chain stops at the ad group.`)
    }
  }
}

// ── (h) THE MIGRATION IS A DIMENSION, NOT A FACT TABLE ───────────────────────────────────────────────
const mig = read(MIG)
if (mig) {
  if (/^\s*(date|valid_from|valid_to|as_of)\s+/mi.test(mig)) {
    findings.push(`(h) ${MIG} declares a date/validity column. That makes this a fact table and re-opens Type 2 by accident — name HISTORY is owned by entity_state_history (048) and must not gain a second owner here.`)
  }
  if (!/PRIMARY KEY \(client_id, platform, entity_level, entity_id\)/.test(mig)) {
    findings.push(`(h) ${MIG}'s primary key is not (client_id, platform, entity_level, entity_id). One row per entity is what makes a re-capture idempotent.`)
  }
  if (!/REVOKE ALL ON TABLE public\.google_entity_dimension FROM anon/.test(mig)) {
    findings.push(`(h) ${MIG} does not revoke the anon grant BY NAME — revoking PUBLIC alone does not remove it (measured, migration 065).`)
  }
}

if (findings.length) {
  console.error(`[entity-dimension] FAIL — ${findings.length} finding(s):`)
  for (const f of findings) console.error(`  - ${f}`)
  process.exit(1)
}
console.log(`[entity-dimension] PASS — an ad names its ad group, an ad group its campaign, a campaign terminates at the account · the OLD flat rule is detected as flat · a rename resolves to the new name and writes one row · an unchanged re-read writes nothing · a thin read never blanks a known name · the tilde parse is exact and refuses lookalikes · the dimension reads carry no segments.date · the migration declares no date column and revokes anon by name.`)
