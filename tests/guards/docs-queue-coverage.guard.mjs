#!/usr/bin/env node
// LORAMER_DOCS_QUEUE_COVERAGE_GUARD_V1
//
// FORCING FUNCTION — the MIRROR of tests/guards/digest-queue-coverage.guard.mjs, one direction earlier in the
// chain. That guard asserts QUEUE → DIGEST (every open queue item reaches the resume digest). THIS one asserts
// DOCS → QUEUE: every doc that describes planned-but-unbuilt work must have a matching entry in
// LORAMER_QUEUE_OF_RECORD.md. Together they close the loop DOC → QUEUE → DIGEST so scoped work cannot go invisible.
//
// WHY THIS EXISTS. 2026-07-23: docs/scoping/multi-account-phase2.md scoped platform_connections uniqueness +
// sync_state keying + a query-layer account filter, and the QUEUE held only an UMBRELLA line (":354", "Phase 2 =
// widen the metrics_daily conflict key") — the sub-items were never tracked. Nothing caught it, because the only
// coverage guard runs queue→digest, never docs→queue. This is that missing check.
//
// SCOPE (candidate docs): docs/*.md + docs/scoping/*.md + root *_PLAN.md / *_DESIGN.md.
// IN-SCOPE (needs queue coverage) = a candidate whose text carries a planned-but-unbuilt marker (UNBUILT below):
//   LORAMER_*_PHASE* markers, "scoping only", "nothing executed", "not (yet) built", "deferred", "design pending",
//   "phase 3+", "post-launch", "NOT applied/run/executed", "to be built", "planned but", "unbuilt", "later", "TODO".
//   ("later"/"TODO" are high-noise triggers — included per spec; false positives opt out with QUEUE-EXEMPT.)
//
// UNITS + GRANULARITY (the line-354 lesson). An umbrella queue entry can exist while sub-items go untracked, so a
// doc is checked as UNITS, not as one blob:
//   • If the doc declares `QUEUE-KEY: <tok>[, <tok>…]` (machine-readable, in the doc), EACH token is a unit that
//     must appear verbatim (case-insensitive substring) in the QUEUE. THIS is how sub-item granularity is enforced:
//     a doc that scopes 3 phases lists 3 keys and each is matched independently.
//   • Otherwise (no QUEUE-KEY) the guard falls back to ONE doc-level unit, matched by the doc's filename topic
//     phrase or any LORAMER_* marker it contains. WHERE THIS IS WEAK, stated plainly: the fallback is doc-level, so
//     it CANNOT by itself detect sub-items an umbrella entry hides (exactly the :354 failure). It will pass a doc
//     whose umbrella topic is named in the queue even if named sub-items are not. The fix is per-doc: add QUEUE-KEY
//     lines so each sub-item is its own unit. Until a doc does, its known sub-item gaps live in the BASELINE by
//     hand (e.g. multi-account's pc/sync_state/query-layer rows) so they are tracked and clear individually.
//
// OPT-OUT: a doc may write `QUEUE-EXEMPT: <reason>` (machine-readable, in the doc) to declare it needs no queue
//   entry (pure reference, shipped-and-historical, form answers, …). SILENCE IS NEVER AN EXEMPTION — only that tag.
//
// BASELINE: tests/guards/docs-queue-coverage.baseline.mjs (data). NEW unmatched unit → FAIL; a baselined unit is
//   grandfathered; a baseline row that now matches is a loud WARNING to remove it (queue can only shrink).
//
// EXIT: 0 = every in-scope unit is matched or baselined or exempt · 1 = one or more NEW unmatched (named) · 2 =
//   cannot read inputs. NOT hermetic-vs-DB — this is pure filesystem, CI-safe like its mirror.
import { readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import { KNOWN_DOCS_QUEUE_GAPS } from './docs-queue-coverage.baseline.mjs'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')
const read = (rel) => { try { return readFileSync(resolve(ROOT, rel), 'utf8') } catch { return null } }
const lsMd = (dir) => { try { return readdirSync(resolve(ROOT, dir)).filter((f) => f.endsWith('.md')).map((f) => `${dir}/${f}`) } catch { return [] } }
const lsRootPlans = () => { try { return readdirSync(ROOT).filter((f) => /_(PLAN|DESIGN)\.md$/.test(f)) } catch { return [] } }
const INJECT = process.argv.includes('--inject-unqueued') // synthetic NEW gap → must fail (baseline must not mute it)

const queue = read('LORAMER_QUEUE_OF_RECORD.md')
if (!queue) { console.error('✗ docs-queue-coverage: cannot read LORAMER_QUEUE_OF_RECORD.md'); process.exit(2) }
const queueLc = queue.toLowerCase()

const UNBUILT = /(LORAMER_\w*PHASE\w*)|(\bscoping[- ]only\b)|(\bnothing executed\b)|(\bnot (yet )?built\b)|(\bunbuilt\b)|(\bdeferred\b)|(\bdesign pending\b)|(\bphase\s*[3-9]\s*\+?)|(\bpost-launch\b)|(\bNOT (applied|run|executed)\b)|(\bto be built\b)|(\bplanned but\b)|(\bTODO\b)|(\blater\b)/i

// Filename → topic phrase(s): strip DESIGN/SCOPE/PLAN/SPEC/date/PHASEn/V1/LORAMER/PROJECTn, keep the distinctive stem.
function topicTerms(path) {
  let t = path.split('/').pop().replace(/\.md$/i, '')
  t = t.replace(/_(DESIGN|SCOPE|PLAN|SPEC)\b/gi, ' ').replace(/_V\d+\b/gi, ' ').replace(/_?\d{4}[-_]\d{2}[-_]\d{2}\b/g, ' ')
       .replace(/PHASE[_ ]?[0-9._]*/gi, ' ').replace(/^LORAMER_?/i, '').replace(/^PROJECT_?\d*/i, '')
  const hyphen = t.replace(/_/g, '-').replace(/\s+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '').toLowerCase()
  const space = hyphen.replace(/-/g, ' ')
  const terms = new Set()
  if (hyphen.length >= 5) { terms.add(hyphen); terms.add(space) }
  return [...terms]
}
const markersIn = (text) => [...new Set((text.match(/LORAMER_[A-Z0-9_]*PHASE[A-Z0-9_]*/gi) || []).map((s) => s.toLowerCase()))]
const inQueue = (term) => term && term.length >= 5 && queueLc.includes(term.toLowerCase())

// ── build the in-scope UNIT set from the docs ──────────────────────────────────────────────────────────────
const candidates = [...lsMd('docs'), ...lsMd('docs/scoping'), ...lsRootPlans()]
let scanned = 0, inScope = 0, exempt = 0
const units = [] // { doc, unit, matched, terms }
for (const rel of candidates) {
  const text = read(rel); if (text == null) continue
  scanned++
  if (!UNBUILT.test(text)) continue                       // built/reference doc — not planned-unbuilt
  const exemptM = text.match(/QUEUE-EXEMPT:\s*(.+)/i)
  if (exemptM) { exempt++; continue }                     // explicit machine-readable opt-out (silence is not)
  inScope++
  const keyM = [...text.matchAll(/QUEUE-KEY:\s*(.+)/gi)].flatMap((m) => m[1].replace(/\s*(-->|\*\/|#)\s*$/, '').split(',').map((s) => s.trim()).filter(Boolean))
  if (keyM.length) {
    for (const k of keyM) units.push({ doc: rel, unit: k, matched: inQueue(k), terms: [k] })
  } else {
    const terms = [...topicTerms(rel), ...markersIn(text)]
    units.push({ doc: rel, unit: '(whole doc)', matched: terms.some(inQueue), terms })
  }
}

if (INJECT) units.push({ doc: 'docs/__synthetic__.md', unit: 'synthetic-unqueued-item', matched: false, terms: ['synthetic-unqueued-item'] })

// ── classify unmatched against the baseline ────────────────────────────────────────────────────────────────
const key = (u) => `${u.doc}::${u.unit}`
const baseSet = new Set(KNOWN_DOCS_QUEUE_GAPS.map((b) => `${b.doc}::${b.unit}`))
const unmatched = units.filter((u) => !u.matched)
const baselined = unmatched.filter((u) => baseSet.has(key(u)))
const novel = unmatched.filter((u) => !baseSet.has(key(u)))
const unitKeys = new Set(units.map(key))
const stale = KNOWN_DOCS_QUEUE_GAPS.filter((b) => { const u = units.find((x) => key(x) === `${b.doc}::${b.unit}`); return !u || u.matched }) // baselined but now matched/gone

console.log('LORAMER_DOCS_QUEUE_COVERAGE_GUARD_V1  (docs → queue; mirror of digest-queue-coverage)')
console.log(`  candidate docs scanned : ${scanned}   in-scope (planned-unbuilt) : ${inScope}   exempt : ${exempt}`)
console.log(`  units checked : ${units.length}   matched : ${units.filter((u) => u.matched).length}   unmatched : ${unmatched.length}  (baselined ${baselined.length} · NEW ${novel.length} · stale-baseline ${stale.length})`)

if (unmatched.length) {
  console.log('\nUNMATCHED UNITS (no LORAMER_QUEUE_OF_RECORD.md entry found):')
  for (const u of unmatched.sort((a, b) => a.doc.localeCompare(b.doc))) {
    console.log(`  ${baseSet.has(key(u)) ? '·' : '★'} ${u.doc}  ::  ${u.unit}   [tried: ${u.terms.slice(0, 4).join(' | ')}]`)
  }
  console.log('  (· = baselined/known · ★ = NEW — this run introduced it → FAILS)')
}
for (const b of stale) console.log(`  ⚠ STALE baseline (now queued or gone — remove it): ${b.doc} :: ${b.unit}`)

if (novel.length) {
  console.error(`\n✗ DOCS-QUEUE COVERAGE GUARD FAILED — ${novel.length} planned-but-unbuilt doc unit(s) with NO queue entry:`)
  for (const u of novel) console.error(`  ${u.doc} :: ${u.unit}`)
  console.error('  FIX: add the item to LORAMER_QUEUE_OF_RECORD.md, or add `QUEUE-KEY: <tok>` (matching the queue) /')
  console.error('       `QUEUE-EXEMPT: <reason>` IN the doc. To grandfather a KNOWN gap, add it to')
  console.error('       tests/guards/docs-queue-coverage.baseline.mjs (as data — never blanket-mute a doc).')
  process.exit(1)
}
console.log('\n✓ GUARD PASSED — every in-scope doc unit is matched in the queue, baselined, or exempt. (heuristic')
console.log('  matching by filename topic + LORAMER markers + QUEUE-KEY; the fallback is doc-level — see the header.)')
process.exit(0)
