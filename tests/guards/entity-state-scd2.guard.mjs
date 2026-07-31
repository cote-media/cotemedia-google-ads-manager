#!/usr/bin/env node
// LORAMER_ENTITY_STATE_SCD2_V1 — guard the four ways an SCD2 store lies or explodes.
//
// WHY THIS TABLE EXISTS AT ALL (★NON-METRIC-STORAGE-SHAPE): 64 capture call sites all target metrics_daily,
// whose row is keyed by (client, platform, date, entity, breakdown). Config, entity-state sets and change
// events have no shape that fits, so for two months they read as OUT OF SCOPE rather than MISSING. This is
// the missing shape — and it has exactly two ways to fail badly, so both are pinned here.
//
// (a) THE ROW EXPLOSION. A writer that re-observes daily and appends an UNCHANGED value would put
//     10k negative keywords × 365 = 3.65M rows/year into this table for ONE client — the inflation Fivetran
//     warns about for frequently-changing tables. An unchanged value must produce NO new row.
// (b) THE INVENTED CHANGE DATE. Polling gives the date we OBSERVED, never the date it CHANGED. A first
//     sighting labelled 'poll_transition' asserts a change we never saw — a confident answer over an
//     uncaptured window, ESSENCE law 6, in a new place.
// (c) THE DOUBLE-OPEN SCALAR. Two open rows for one (entity, scalar key) makes point-in-time reconstruction
//     ambiguous — "what was the conversion window on D" would have two answers.
// (d) ABSENCE READ AS FALSE. "No row saying this term was negated" does NOT mean it was not negated. Every
//     read path must return UNKNOWN, never a bare value and never false.
//
// It DRIVES the real transpiled planner and resolver. No DB, because both are pure by design — that purity
// is what makes the invariant provable rather than asserted.
import { spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync, existsSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import Module, { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const ROOT = process.env.LORAMER_GUARD_ROOT || process.cwd()
const fail = (m) => { console.error(`[entity-state-scd2] FAIL — ${m}`); process.exit(1) }
const findings = []
const check = (c, m) => { if (!c) findings.push(m) }

const SRC = 'src/lib/capture/entity-state-history.ts'
if (!existsSync(resolve(ROOT, SRC))) fail(`${SRC} is missing — the non-metric storage shape does not exist, so config/state/events still have nowhere to land.`)

const out = mkdtempSync(join(tmpdir(), 'loramer-scd2-'))
const tsc = join(ROOT, 'node_modules', '.bin', 'tsc')
const r = spawnSync(tsc, [resolve(ROOT, SRC), '--target', 'es2020', '--module', 'commonjs', '--moduleResolution',
  'node', '--skipLibCheck', '--rootDir', resolve(ROOT), '--outDir', out], { encoding: 'utf8' })
if (r.error) { rmSync(out, { recursive: true, force: true }); fail(`could not run tsc — ${r.error.message}`) }

const stub = join(out, '__stub.js')
writeFileSync(stub, 'module.exports = { supabaseAdmin: {} }\n')
const origResolve = Module._resolveFilename
Module._resolveFilename = function (q, ...rest) { return q.startsWith('@/lib/') ? stub : origResolve.call(this, q, ...rest) }
const mod = require(join(out, 'src/lib/capture/entity-state-history.js'))
Module._resolveFilename = origResolve

for (const n of ['planEntityStateTransitions', 'resolveEntityStateAsOf', 'extractGoogleSlice1']) {
  if (typeof mod[n] !== 'function') fail(`${SRC} does not export ${n}.`)
}
const { planEntityStateTransitions: plan, resolveEntityStateAsOf: resolveAsOf, extractGoogleSlice1: extract } = mod
const F = (o) => ({ entityLevel: 'campaign', entityId: 'c1', stateKey: 'advertising_channel_type', stateValue: 'SEARCH', ...o })
const R = (o) => ({ entityLevel: 'campaign', entityId: 'c1', stateKey: 'advertising_channel_type', stateValue: 'SEARCH', validFrom: '2026-01-01', ...o })

// ── (a) UNCHANGED MUST WRITE NOTHING ───────────────────────────────────────────────────────────────────
{
  const t = plan([F({})], [R({})], new Set(['campaign|c1|advertising_channel_type']), '2026-07-31')
  const opens = t.filter((x) => x.op === 'open')
  check(opens.length === 0,
    `(a) an UNCHANGED value produced ${opens.length} open(s). This is the 3.65M-rows-a-year failure: re-observing daily and appending regardless.`)
  check(t.length === 1 && t[0].op === 'touch',
    `(a) an unchanged value should produce exactly one 'touch' (refresh last_seen_at, no new row); got ${JSON.stringify(t.map((x) => x.op))}.`)
  // and it must hold at scale — 500 unchanged facts, still zero rows
  const many = Array.from({ length: 500 }, (_, i) => F({ entityId: `c${i}`, isSet: true, stateKey: 'negative_keyword', stateValue: `term${i}` }))
  const openMany = many.map((f) => R({ entityId: f.entityId, stateKey: 'negative_keyword', stateValue: f.stateValue, isSet: true }))
  const ever = new Set(many.map((f) => `campaign|${f.entityId}|negative_keyword`))
  const t2 = plan(many, openMany, ever, '2026-07-31')
  check(t2.filter((x) => x.op === 'open').length === 0 && t2.filter((x) => x.op === 'close').length === 0,
    `(a) 500 UNCHANGED set members produced ${t2.filter((x) => x.op !== 'touch').length} write(s) — the explosion is live at scale.`)
}

// ── (b) change_source HONESTY ──────────────────────────────────────────────────────────────────────────
{
  const first = plan([F({})], [], new Set(), '2026-07-31').filter((x) => x.op === 'open')
  check(first.length === 1 && first[0].changeSource === 'first_observation',
    `(b) a FIRST observation was labelled '${first[0]?.changeSource}' — claiming a transition we never saw. Polling gives the OBSERVATION date, never the change date.`)
  const changed = plan([F({ stateValue: 'PERFORMANCE_MAX' })], [R({})], new Set(['campaign|c1|advertising_channel_type']), '2026-07-31')
  const o = changed.filter((x) => x.op === 'open')
  const c = changed.filter((x) => x.op === 'close')
  check(o.length === 1 && o[0].changeSource === 'poll_transition',
    `(b) a real A→B transition was labelled '${o[0]?.changeSource}', expected 'poll_transition'.`)
  check(c.length === 1 && c[0].validTo === '2026-07-31',
    `(b) the superseded row was not closed at the observation date (got ${JSON.stringify(c[0]?.validTo)}).`)
  const everSeen = plan([F({})], [], new Set(['campaign|c1|advertising_channel_type']), '2026-07-31').filter((x) => x.op === 'open')
  check(everSeen[0]?.changeSource === 'poll_transition',
    `(b) a key we have seen BEFORE (closed rows exist) re-opened as '${everSeen[0]?.changeSource}' — that falsely tells the reader the start date is unknown when it is not.`)
  // every emitted open must carry one of the three legal values
  const all = [...first, ...o, ...everSeen]
  check(all.every((x) => ['first_observation', 'poll_transition', 'event'].includes(x.changeSource)),
    `(b) an open was emitted without a legal change_source.`)
}

// ── (c) ONE OPEN ROW PER SCALAR KEY ────────────────────────────────────────────────────────────────────
{
  const t = plan([F({ stateValue: 'DISPLAY' })], [R({})], new Set(['campaign|c1|advertising_channel_type']), '2026-07-31')
  const closes = t.filter((x) => x.op === 'close').length
  const opens = t.filter((x) => x.op === 'open').length
  check(closes === 1 && opens === 1,
    `(c) a scalar change produced ${opens} open(s) and ${closes} close(s) — anything but 1/1 leaves two open rows and makes point-in-time reconstruction ambiguous.`)
  const idx = t.findIndex((x) => x.op === 'close')
  const idxO = t.findIndex((x) => x.op === 'open')
  check(idx < idxO, `(c) the OPEN is emitted before the CLOSE — the partial unique index in migration 048 permits exactly one open scalar row, so that ordering collides.`)
  // a SET may legitimately hold many open rows for one key
  const setT = plan(
    [F({ stateKey: 'negative_keyword', stateValue: 'a', isSet: true }), F({ stateKey: 'negative_keyword', stateValue: 'b', isSet: true })],
    [], new Set(), '2026-07-31')
  check(setT.filter((x) => x.op === 'open').length === 2,
    `(c) a SET with two members produced ${setT.filter((x) => x.op === 'open').length} open(s) — sets must allow many open rows per key, unlike scalars.`)
  // removal closes
  const removed = plan([F({ stateKey: 'negative_keyword', stateValue: 'a', isSet: true })],
    [R({ stateKey: 'negative_keyword', stateValue: 'a', isSet: true }), R({ stateKey: 'negative_keyword', stateValue: 'b', isSet: true })],
    new Set(['campaign|c1|negative_keyword']), '2026-07-31')
  check(removed.filter((x) => x.op === 'close').length === 1,
    `(c) a removed set member was not closed — "did my negation get reverted" becomes unanswerable.`)
}

// ── (d) ABSENCE IS UNKNOWN, NEVER FALSE ────────────────────────────────────────────────────────────────
{
  const none = resolveAsOf([], 'campaign', 'c1', 'advertising_channel_type', '2026-07-31')
  check(none.verdict === 'UNKNOWN' && none.reason === 'never_observed',
    `(d) an absent row resolved to ${JSON.stringify(none)} — absence must be UNKNOWN, never a bare value and never false.`)
  check(!('value' in none), `(d) the UNKNOWN verdict leaked a value field, which a caller will render as an answer.`)
  const before = resolveAsOf([{ ...R({}), validTo: null, changeSource: 'first_observation' }], 'campaign', 'c1', 'advertising_channel_type', '2025-06-01')
  check(before.verdict === 'UNKNOWN' && before.reason === 'before_first_observation',
    `(d) a date BEFORE our first observation resolved to ${JSON.stringify(before)} — we did not know the value then and must say so.`)
  const undeclared = resolveAsOf([], 'campaign', 'c1', 'whatever', '2026-07-31', false)
  check(undeclared.verdict === 'UNKNOWN' && undeclared.reason === 'not_in_declared_set',
    `(d) an undeclared key did not resolve to UNKNOWN/not_in_declared_set.`)
  // KNOWN still works, and carries the honesty flag
  const known = resolveAsOf([{ ...R({}), validTo: null, changeSource: 'first_observation' }], 'campaign', 'c1', 'advertising_channel_type', '2026-07-31')
  check(known.verdict === 'KNOWN' && known.value === 'SEARCH',
    `POSITIVE CONTROL: a covering row did not resolve KNOWN — the resolver can only say UNKNOWN, so it says nothing.`)
  check(known.startIsProven === false,
    `(d) a value whose row is a 'first_observation' reported startIsProven=true — the START is our sighting, not truth, and a caller must be able to tell.`)
  const proven = resolveAsOf([{ ...R({}), validTo: null, changeSource: 'poll_transition' }], 'campaign', 'c1', 'advertising_channel_type', '2026-07-31')
  check(proven.startIsProven === true, `(d) a poll_transition row reported startIsProven=false.`)
}

// ── SLICE-1 SCOPE + SOURCE PINS ────────────────────────────────────────────────────────────────────────
{
  const facts = extract({
    campaigns: [{ id: '1', name: 'S', channelType: 'SEARCH', status: 'ENABLED' }],
    impressionShares: [{ campaignId: '1', campaignName: 'S', channelType: 'SEARCH' }],
    conversionActions: [{ id: 'a1', name: 'Purchase', includeInConversions: true }],
  })
  check(facts.length === 3, `slice-1 extractor produced ${facts.length} facts, expected 3 (channel type, status, include_in_conversions) — and channelType must not double-count across campaigns+impressionShares.`)
  check(facts.every((f) => f.isSet !== true), `slice-1 emitted a SET fact; negative keywords are explicitly NOT in this slice.`)
}
const src = readFileSync(resolve(ROOT, SRC), 'utf8')
check(/change_source/.test(src) || /changeSource/.test(src), `change_source is absent from the writer.`)
const mig = resolve(ROOT, 'migrations/048_entity_state_history.sql')
if (existsSync(mig)) {
  const m = readFileSync(mig, 'utf8')
  check(/change_source\s+text\s+NOT NULL/.test(m), `migration 048 does not declare change_source NOT NULL.`)
  check(/CHECK \(change_source IN \('first_observation', 'poll_transition', 'event'\)\)/.test(m), `migration 048 does not constrain change_source to the three legal values.`)
  check(/WHERE valid_to IS NULL AND is_set = false/.test(m), `migration 048 lacks the partial unique index enforcing one open row per SCALAR key.`)
} else findings.push(`migrations/048_entity_state_history.sql is missing — the shape has no home.`)

rmSync(out, { recursive: true, force: true })
if (findings.length) {
  console.error(`[entity-state-scd2] FAIL — ${findings.length} finding(s):`)
  for (const f of findings) console.error(`  · ${f}`)
  process.exit(1)
}
console.log('[entity-state-scd2] PASS — unchanged writes nothing (500-member set proves it at scale), first observations are labelled honestly, scalars keep exactly one open row, and absence resolves UNKNOWN rather than false.')
