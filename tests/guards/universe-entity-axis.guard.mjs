#!/usr/bin/env node
// LORAMER_UNIVERSE_ENTITY_AXIS_V1 — THE FIX-WITH-GUARD HALF.
//
// TWO QUESTIONS, and they are different failures with the same symptom (a walk that looks like it worked):
//   (A) DID WE WRITE THE GRAIN THE VENDOR SERVED? A published entry whose rows land at one flat level has
//       thrown away identity that was already in the response — measured 3.14× of it on the one entry we
//       probed live. Silent, free to produce, and only visible by comparing what came back against what
//       was written.
//   (B) CAN LORA READ WHAT WE WROTE? Every (platform, breakdown_type, entity_level) tuple the walk emits
//       must be DECLARED in src/lib/breakdown-registry.ts. UNWIRED IS MISSING: a family captured but
//       unreachable is a family we do not have, and the customer cannot tell the difference.
//
// ⛔ HERMETIC. No DB, no network, no quota — it drives the real writer against a stub vendor, exactly the
// way universe-runner.guard.mjs proves idempotency, so it runs on Vercel and in `npm run guard`.
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs'
import { resolve, dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { tmpdir } from 'node:os'
import { spawnSync } from 'node:child_process'
import Module, { createRequire } from 'node:module'

const ROOT = process.env.LORAMER_GUARD_ROOT || resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const findings = []
const rel = (p) => join(ROOT, p)
const die = (m) => { console.error(`[universe-entity-axis] FAIL — ${m}`); process.exit(1) }

// ── Compile the writer + the registry to JS so the guard drives the REAL code, never a copy of it ──────────
// Same shape as universe-runner.guard.mjs: --noResolve plus a stubbed module resolver, so the compile needs
// no path aliases and no dependency graph — the two files under test are the only real code loaded.
const out = mkdtempSync(join(tmpdir(), 'loramer-entity-axis-'))
const tsc = join(ROOT, 'node_modules', '.bin', 'tsc')
// ⛔ universe-surfaces IS COMPILED ALONGSIDE THE WRITER AS OF 2026-08-09. The writer now imports its canonical
// key forms from there (LORAMER_CANONICAL_KEY_SPELLING_V1 — one spelling per fact). Left out, it fell through
// to the catch-all stub below and `canonicalEntityId` returned a Proxy function instead of an id, so every row
// collapsed onto one undefined key and the DECLINE state disappeared — six findings that looked like writer
// bugs and were a harness hole. A guard that stubs the thing under test is testing the stub.
const r = spawnSync(tsc, [rel('src/lib/backfill/google-ads-universe-writer.ts'), rel('src/lib/breakdown-registry.ts'),
  rel('src/lib/backfill/universe-surfaces.ts'),
  '--target', 'es2020', '--module', 'commonjs', '--moduleResolution', 'node', '--skipLibCheck', '--noResolve',
  '--rootDir', ROOT, '--outDir', out], { encoding: 'utf8' })
if (r.error) { rmSync(out, { recursive: true, force: true }); die(`could not run tsc — ${r.error.message}`) }

const stub = join(out, '__stub.js')
writeFileSync(stub, `module.exports = new Proxy({ upsertMetricsChunked: async (rows) => ({ written: rows.length, chunks: 1 }) },
  { get: (t, k) => (k in t ? t[k] : (() => {})) })`)
const origResolve = Module._resolveFilename
Module._resolveFilename = function (request, ...rest) {
  // The writer's REAL canonical-spelling dependency resolves for real; only the leaves are stubbed.
  if (/universe-surfaces$/.test(request)) return join(out, 'src/lib/backfill/universe-surfaces.js')
  if (request.startsWith('@/') || request.startsWith('./') || request.startsWith('../')) return stub
  return origResolve.call(this, request, ...rest)
}
const req = createRequire(import.meta.url)
let W, R
try {
  W = req(join(out, 'src/lib/backfill/google-ads-universe-writer.js'))
  R = req(join(out, 'src/lib/breakdown-registry.js'))
} catch (e) {
  Module._resolveFilename = origResolve; rmSync(out, { recursive: true, force: true })
  die(`compiled modules did not load — ${e.message}\n${r.stdout || ''}${r.stderr || ''}`)
} finally { Module._resolveFilename = origResolve }

const doc = JSON.parse(readFileSync(rel('docs/google-ads-capture-universe.json'), 'utf8'))
// ⛔ WHAT THE WALK WRITES IS NO LONGER WHAT IT REQUESTS (LORAMER_UNIVERSE_DERIVED_TIME_V1). The six derived
// time families are computed locally and still stored, so reachability must be checked against
// declarableEntries — checking only the request list would declare 201 families unreachable while their rows
// sit in the table, which is the UNWIRED-IS-MISSING failure pointing the other way.
const selectable = W.declarableEntries(doc)

// ── (A) THE VENDOR SERVED A GRAIN AND WE WROTE IT ──────────────────────────────────────────────────────────
// A stub response shaped like a real one: TWO distinct entities on the SAME date and segment value. If the
// builder writes the vendor's grain, that is TWO rows. If it collapses to one flat level, it is ONE — which
// is precisely the defect this guard exists to catch, and precisely what the old builder did.
{
  const ctx = { clientId: 'c1', userEmail: 'e@x.com', customerId: '777' }
  const probe = [
    { entry: selectable.find((e) => e.segment) , kind: 'segment' },
    { entry: selectable.find((e) => !e.segment), kind: 'resource-only' },
  ]
  for (const { entry, kind } of probe) {
    if (!entry) { findings.push(`(A) no ${kind} entry in the selectable set — the guard could not run its ${kind} leg.`); continue }
    const res = entry.resource
    const segPath = entry.segment ? entry.segment.replace(/^segments\./, '') : null
    const seg = (v) => { const o = { date: '2026-03-07' }; if (segPath) { const ks = segPath.split('.'); let c = o; ks.forEach((k, i) => { if (i === ks.length - 1) c[k] = v; else c = (c[k] = {}) }) } return o }
    const mk = (rn) => ({ [res]: { resource_name: rn }, segments: seg('X'), metrics: { cost_micros: 1_000_000, impressions: 10, clicks: 1, conversions: 0, conversions_value: 0 } })
    const apiRows = [mk(`customers/777/${res}s/1`), mk(`customers/777/${res}s/2`)]
    const built = W.buildUniverseRowsAtGrain(entry, ctx, apiRows)
    const rows = built.rows
    if (rows.length !== 2) {
      findings.push(`(A) ${kind} entry ${res}${entry.segment ? '/' + entry.segment : ''}: the vendor served TWO distinct entities on one date and the builder emitted ${rows.length} row(s). Identity that was already in the response is being discarded.`)
    }
    const levels = [...new Set(rows.map((r) => r.entity_level))]
    if (levels.length !== 1 || levels[0] !== res) {
      findings.push(`(A) ${kind} entry ${res}: entity_level came out ${JSON.stringify(levels)} — it must be the GAQL FROM resource '${res}'. A flat level means the grain was not written.`)
    }
    const ids = [...new Set(rows.map((r) => r.entity_id))]
    if (ids.length !== rows.length) findings.push(`(A) ${kind} entry ${res}: ${rows.length} rows carry only ${ids.length} distinct entity_id — entities collapsed.`)
    if (ids.some((i) => i === ctx.customerId)) findings.push(`(A) ${kind} entry ${res}: an entity_id equals the CUSTOMER id — that is the account-grain collapse this axis replaces.`)

    // THE THIRD STATE. A row the vendor returns with no resource_name is a DECLINE and must be labelled as
    // one — not dropped (absence) and not written as a zero.
    const declined = W.buildUniverseRowsAtGrain(entry, ctx, [{ segments: seg('X'), metrics: { cost_micros: 1_000_000, impressions: 5, clicks: 1, conversions: 0, conversions_value: 0 } }])
    if (declined.grainDeclines !== 1) findings.push(`(A) ${kind} entry ${res}: a row with no resource_name produced grainDeclines=${declined.grainDeclines}, expected 1 — decline is collapsing into absence.`)
    if (declined.rows.length !== 1 || declined.rows[0]?.extra?.grain !== 'VENDOR_DECLINED') {
      findings.push(`(A) ${kind} entry ${res}: a declined grain did not emit exactly one row labelled VENDOR_DECLINED (got ${declined.rows.length} row(s), grain=${declined.rows[0]?.extra?.grain}). Absence, decline and zero must stay three different facts.`)
    }
  }
}

// ── (B) EVERY TUPLE THE WALK WILL WRITE IS DECLARED, SO LORA CAN READ IT ───────────────────────────────────
{
  const declared = new Set()
  for (const e of R.REGISTRY) for (const lv of e.entityLevels) declared.add(`${e.platform}|${e.breakdownType}|${lv}`)
  const missing = []
  for (const entry of selectable) {
    const t = W.breakdownTypeFor(entry)
    const lv = W.entityLevelFor(entry)
    if (!declared.has(`google|${t}|${lv}`)) missing.push(`google|${t}|${lv}`)
  }
  const uniq = [...new Set(missing)]
  if (uniq.length) {
    findings.push(`(B) ${uniq.length} tuple(s) the walk WILL write are NOT declared in breakdown-registry.ts — captured-but-unreachable, which is the same as not captured (UNWIRED IS MISSING). First 8: ${uniq.slice(0, 8).join(', ')}. Regenerate with: node scripts/build-universe-registry.mjs --write`)
  }
  // The registry's own invariant: one entry per (platform, breakdown_type). A duplicate line is not an
  // error the type system can see, and entryFor()/resolveToolType() would silently read only the first.
  const seen = new Map()
  for (const e of R.REGISTRY) {
    const k = `${e.platform}|${e.breakdownType}`
    if (seen.has(k)) findings.push(`(B) DUPLICATE registry entry for ${k} — entryFor() returns the first and the second is silently dead. Merge the entityLevels into one line.`)
    seen.set(k, true)
  }
}

// ── (C) THE GENERATED BLOCK MATCHES THE ARTIFACT ───────────────────────────────────────────────────────────
{
  const gen = await import(`file://${rel('scripts/build-universe-registry.mjs')}`)
  const want = gen.buildBlock(doc)
  const have = gen.currentBlock(ROOT)
  if (have === null) findings.push('(C) breakdown-registry.ts has no LORAMER_UNIVERSE_ENTITY_AXIS_V1 generated-block markers — the artifact-derived declarations cannot be verified.')
  else if (have !== want) findings.push('(C) the generated registry block DRIFTED from docs/google-ads-capture-universe.json. The artifact is the source of surfaces; re-run `node scripts/build-universe-registry.mjs --write` and commit the result.')
}

// ── (D) THE LEGACY GRAINS ARE SUPERSEDED, NOT DELETED — TESTED AS BEHAVIOUR, NOT AS A GREP ─────────────────
// ⛔ THIS LEG WAS WRITTEN AS A TEXT SEARCH FIRST AND IT DID NOT GO RED WHEN IT SHOULD HAVE: deleting the
// LEGACY_ENTITY_LEVELS declaration left the NAME behind in isLegacyEntityLevel's body, so the regex still
// matched. A guard that greps for a string proves the string is present, never that the code does the thing.
// It now drives the compiled module and asserts every one of the eight STILL RESOLVES and is STILL DECLARED
// against real registry rows — which is the actual promise: no existing stored row changes meaning.
const EIGHT = ['account', 'campaign', 'ad_group', 'ad_set', 'ad', 'keyword', 'product', 'variant']
{
  const declaredLevels = new Set(R.REGISTRY.flatMap((e) => e.entityLevels))
  if (!Array.isArray(R.LEGACY_ENTITY_LEVELS) || R.LEGACY_ENTITY_LEVELS.length !== 8) {
    findings.push(`(D) LEGACY_ENTITY_LEVELS does not export the original eight (got ${JSON.stringify(R.LEGACY_ENTITY_LEVELS)}). They are superseded, never removed — the constant is the proof.`)
  }
  for (const lv of EIGHT) {
    if (!(R.LEGACY_ENTITY_LEVELS || []).includes(lv)) findings.push(`(D) '${lv}' is missing from LEGACY_ENTITY_LEVELS — a grain that exists in stored rows must still be a named, legal level.`)
    if (typeof R.isLegacyEntityLevel === 'function' && !R.isLegacyEntityLevel(lv)) findings.push(`(D) isLegacyEntityLevel('${lv}') returned false — an existing stored value stopped being recognised as legacy.`)
    if (!declaredLevels.has(lv)) findings.push(`(D) no registry entry declares entity level '${lv}' any more — rows already stored at that grain would become unreachable to Lora. Superseded means additive, not replaced.`)
  }
  if (typeof R.isLegacyEntityLevel !== 'function') findings.push('(D) isLegacyEntityLevel is not exported — nothing can distinguish an original grain from a vendor-named one.')
  if (R.isLegacyEntityLevel && R.isLegacyEntityLevel('shopping_performance_view')) findings.push('(D) isLegacyEntityLevel accepted a VENDOR-NAMED grain — the distinction it exists to draw is not being drawn.')
}

if (findings.length) {
  console.error(`[universe-entity-axis] FAIL — ${findings.length} finding(s):`)
  for (const f of findings) console.error(`  - ${f}`)
  process.exit(1)
}
console.log(`[universe-entity-axis] PASS — ${selectable.length} selectable entries: every one writes its vendor-named grain, every tuple it emits is declared, the generated block matches the artifact, and the eight legacy grains still read.`)
