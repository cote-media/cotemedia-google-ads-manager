#!/usr/bin/env node
// LORAMER_HYDRATED_CUSTOM_RANGE_V1 — A RESTORED CUSTOM RANGE MUST COME BACK VISIBLE AND FILLED.
//
// ⛔ OBSERVED ON DEVICE 2026-08-16 (Gate-B, iPhone, -next Overview): with a saved custom range the select
// read "Custom range…" and THE DATE INPUTS WERE NOT THERE. The only way back was to pick another preset and
// re-pick Custom. Cause: `customRangeOpen` starts false (CardEngine.tsx useState) and its ONLY writer is the
// onRange handler, so hydration restored `globalCustom` and left the row hidden; and `rangeDraft`/`cmpDraft`
// were never seeded, so even after re-opening, the inputs were EMPTY.
//
// ⛔ BEHAVIOURAL, NOT A GREP (QUEUE:1015 "the wiring was right. THE WIRING WAS NOT THE QUESTION";
// checkdata-verdict-line.guard.mjs:126-160 compiles the real runner). Leg (a) LIFTS the real decision
// function out of the shipped source, strips its type annotations, imports it and CALLS it. That is only
// possible because the decision is a PURE function — which is itself the point: a rule that lives inside a
// component body cannot be driven, and a rule that cannot be driven is a rule nobody can prove.
//
// ⛔ WHY A DRAFT-SEEDING LEG AND NOT JUST AN OPEN/CLOSED LEG: an open row with two empty boxes is the same
// defect wearing a different face — the user still cannot see the range they saved.
//
// USAGE: node tests/guards/hydrated-custom-range.guard.mjs
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs'
import { resolve, dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { tmpdir } from 'node:os'

const ROOT = process.env.LORAMER_GUARD_ROOT || resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const read = (p) => { try { return readFileSync(resolve(ROOT, p), 'utf8') } catch { return null } }
const findings = []

const SRC = 'src/lib/next/card-windows.ts'
const ENGINE = 'src/components/redesign/cards/CardEngine.tsx'
const FN = 'hydratedRangeUi'
const src = read(SRC)
const engine = read(ENGINE)
if (src === null) findings.push(`(a) ${SRC} unreadable — the hydration decision cannot be driven, which is a broken instrument and never a pass.`)
if (engine === null) findings.push(`(c) ${ENGINE} unreadable — the call site cannot be checked.`)

// ⛔ THE BODY BRACE IS FOUND AFTER THE PARAM LIST'S `)`, NOT AFTER THE NAME. This function's parameter is an
// INLINE OBJECT TYPE, so the first `{` in the declaration belongs to the type; brace-matching from there
// returns the type and stops — a silently truncated lift that surfaces downstream as a bogus syntax error.
function extractFn(source, name) {
  const at = source.indexOf(`export function ${name}(`)
  if (at < 0) return null
  const closeParen = source.indexOf(')', at)
  if (closeParen < 0) return null
  const open = source.indexOf('{', closeParen)
  if (open < 0) return null
  let depth = 0
  for (let i = open; i < source.length; i++) {
    if (source[i] === '{') depth++
    else if (source[i] === '}') { depth--; if (depth === 0) return source.slice(at, i + 1) }
  }
  return null
}
// ⛔ SIGNATURE ONLY — the annotation strip never touches the body, and that is deliberate. A blanket
// `: { … }` strip cannot tell a TYPE from an object literal, and this function RETURNS object literals
// (`rangeDraft: { startDate: … }`); a body-wide strip mangled them into a syntax error, which the guard
// would have reported as "could not import" — a broken instrument wearing the costume of a finding.
// Everything before the param list's `)` plus the return annotation is types; everything from the body's
// opening brace is JS and is copied verbatim.
function stripSignatureTypes(fn) {
  const closeParen = fn.indexOf(')')            // these lifted signatures contain no parens inside the params
  const bodyOpen = fn.indexOf('{', closeParen)  // the first brace AFTER the param list is the body
  if (closeParen < 0 || bodyOpen < 0) return fn
  const params = fn.slice(0, closeParen + 1)
    .replace(/:\s*\{[^{}]*\}/g, '')             // inline object param type
    .replace(/:\s*[\w.<>[\]| ]+/g, '')          // named / union param types
  const ret = fn.slice(closeParen + 1, bodyOpen).replace(/:\s*[\w.<>[\]| ]+/g, '')
  return params + ret + fn.slice(bodyOpen)
}

let mod = null
if (src !== null) {
  const fn = extractFn(src, FN)
  if (!fn) {
    findings.push(`(a) ${SRC} exports no pure \`${FN}\` — hydration currently decides inside the component body (CardEngine applyWorking), where no guard can drive it. OBSERVED CONSEQUENCE 2026-08-16: a saved custom range restored with the row HIDDEN and the drafts EMPTY.`)
  } else {
    const tmp = mkdtempSync(join(tmpdir(), 'loramer-hydrate-guard-'))
    try {
      const file = join(tmp, 'hydrate.mjs')
      writeFileSync(file, stripSignatureTypes(fn) + '\n')
      mod = await import(pathToFileURL(file).href)
    } catch (e) {
      findings.push(`(a) could not import the lifted ${FN} — ${e?.message}. A leg that cannot run is not a pass.`)
    } finally {
      rmSync(tmp, { recursive: true, force: true })
    }
  }
}

// ── (a) THE DEVICE CASE: a restored custom range comes back OPEN and FILLED ──────────────────────────────
const CUSTOM = { startDate: '2026-05-16', endDate: '2026-08-02' }   // the window from the Gate-B screenshots
const CMP = { startDate: '2025-05-16', endDate: '2025-08-02' }
if (mod && typeof mod[FN] === 'function') {
  const ui = mod[FN]({ globalCustom: CUSTOM, compareMode: 'custom', customCompare: CMP })
  if (!ui || typeof ui !== 'object') {
    findings.push(`(a) ${FN} returned ${JSON.stringify(ui)} — expected an object carrying the restored range UI state.`)
  } else {
    if (ui.customRangeOpen !== true) {
      findings.push(`(a) ${FN} left customRangeOpen=${JSON.stringify(ui.customRangeOpen)} for a view WITH a saved globalCustom — the select reads "Custom range…" while the date inputs are not rendered, which is exactly the device symptom.`)
    }
    if (ui.rangeDraft?.startDate !== CUSTOM.startDate || ui.rangeDraft?.endDate !== CUSTOM.endDate) {
      findings.push(`(a) ${FN} returned rangeDraft ${JSON.stringify(ui.rangeDraft)} — expected the SAVED window ${JSON.stringify(CUSTOM)}. An open row with empty boxes hides the range just as effectively as a closed one.`)
    }
    if (ui.cmpDraft?.startDate !== CMP.startDate || ui.cmpDraft?.endDate !== CMP.endDate) {
      findings.push(`(a) ${FN} returned cmpDraft ${JSON.stringify(ui.cmpDraft)} — expected the SAVED compare window ${JSON.stringify(CMP)}. The compare row reappears on its own (compareMode is real state) but comes back empty unless the draft is seeded.`)
    }
  }
  // ── (b) THE OPPOSITE CASE: a preset view must NOT open the row ─────────────────────────────────────────
  const plain = mod[FN]({ globalCustom: null, compareMode: 'none', customCompare: null })
  if (plain?.customRangeOpen !== false) {
    findings.push(`(b) ${FN} opened the custom-range row for a view with NO globalCustom (${JSON.stringify(plain?.customRangeOpen)}) — a preset view must restore closed, or every load grows a row nobody asked for.`)
  }
  if (plain?.rangeDraft?.startDate !== '' || plain?.rangeDraft?.endDate !== '') {
    findings.push(`(b) ${FN} invented draft dates for a view with no custom range (${JSON.stringify(plain?.rangeDraft)}) — an empty draft is the honest default.`)
  }
}

// ── (c) THE COMPONENT MUST ACTUALLY USE IT ──────────────────────────────────────────────────────────────
// Text-based and stated as such: leg (a) proves the RULE, this proves the component did not keep a private
// copy of it. Comments are stripped first — quotation is not assertion, a banked hazard in this repo.
if (engine !== null) {
  const body = engine.split('\n').filter((l) => !l.trim().startsWith('//')).join('\n')
  if (!body.includes(`${FN}(`)) {
    findings.push(`(c) ${ENGINE} never calls ${FN}( — whatever leg (a) proves about that rule, the component does not run it, and a guard that certifies an unused function is the failure mode QUEUE:1015 records.`)
  }
  if (!/setCustomRangeOpen\(/.test(body)) {
    findings.push(`(c) ${ENGINE} never calls setCustomRangeOpen from the hydration path — the restored row cannot open.`)
  }
}

if (findings.length) {
  console.error(`\n✗ HYDRATED-CUSTOM-RANGE FAILED — ${findings.length} finding(s):`)
  for (const f of findings) console.error(`  - ${f}`)
  console.error(`  LIMIT: this proves the hydration DECISION and that the component calls it. It does not render anything — whether the row is visible on a phone is Gate-B (QUEUE:900).`)
  process.exit(1)
}
console.log(`[hydrated-custom-range] PASS — the REAL ${FN} was lifted from ${SRC} and driven: a saved custom range restores OPEN with both drafts seeded (range and compare), a preset view restores CLOSED with empty drafts, and ${ENGINE} calls it. LIMIT: proves the decision, not the pixels — visibility on a phone is Gate-B.`)
