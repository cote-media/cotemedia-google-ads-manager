#!/usr/bin/env node
// LORAMER_LM_MARK_IS_TEXT_HEIGHT_V1 — THE MARK IS ONE LINE OF THE ANSWER TALL, AND IT IS DERIVED.
//
// ⛔ WHY THIS EXISTS, AND IT IS A CORRECTION THAT EVAPORATED RATHER THAN A BUG. On 2026-08-03 Russ said the
// mark is "small and compact — roughly TEXT-HEIGHT, not a large graphic," sitting top-left of the response
// area where the answer begins. The correction was banked in chat and NEVER REACHED THE REPO: `LmMark`
// shipped with `size = 34` — a number somebody chose — for sixteen days, against an answer whose line box is
// 25.575px. A free constant has no relationship to the thing it is supposed to match, so nothing could ever
// have gone red about it.
//
// ⛔ THE PROPERTY: the mark's box is the ANSWER TEXT'S LINE BOX, expressed as the same two tokens rather
// than as their product. `.bubbleAssistant` sets the text from `--lora-answer-font-size` x
// `--lora-answer-line-height`; `.lmMark` sets width AND height from the identical calc(). Change the text
// metric and the mark follows in the same paint. There is no number in either place to get wrong.
//
// ⛔ AND THE FALLBACKS MUST AGREE, WHICH IS THE LEG A HUMAN CANNOT CHECK BY LOOKING.
// LORAMER_PORTAL_SEVERS_CSS_VARS_V1: the desktop shelf is portaled to document.body, so custom-property
// inheritance from `.tokens` is SEVERED there and every consumer falls back to its literal. If the two
// fallbacks ever drift, the mark matches the text on the phone page and not on the shelf — visible on one
// surface, invisible on the other, and no build check would say a word.
//
// ⚠ LIMIT, stated: this proves the DERIVATION, never the rendered pixel. Whether 25.575px looks right beside
// the answer is Gate-B on a device (DECISIONS:65 — the sm breakpoint is not optional), and no guard can see
// a screen.
//
// USAGE: node tests/guards/lm-mark-is-text-height.guard.mjs
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const ROOT = process.env.LORAMER_GUARD_ROOT || process.cwd()
const TOKENS = process.env.LORAMER_TOKENS_CSS || 'src/components/redesign/redesign.module.css'
const THREAD = process.env.LORAMER_THREAD_CSS || 'src/components/redesign/lora-thread.module.css'
const WORKING = process.env.LORAMER_WORKING_CSS || 'src/components/redesign/lora-working.module.css'
const MARK_TSX = process.env.LORAMER_MARK_TSX || 'src/components/redesign/LoraWorking.tsx'
const findings = []

const read = (rel) => {
  try { return readFileSync(resolve(ROOT, rel), 'utf8') }
  catch (e) { findings.push(`UNREADABLE ${rel} — ${e.message}. A guard that cannot read its evidence FAILS rather than passing.`); return null }
}
const tokensCss = read(TOKENS), threadCss = read(THREAD), workingCss = read(WORKING), markTsx = read(MARK_TSX)

/** The rule body for a selector, brace-matched — the declarations are multi-line and carry calc() parens. */
export function ruleBody(css, selector) {
  const at = css.indexOf(selector)
  if (at === -1) return null
  const open = css.indexOf('{', at)
  if (open === -1) return null
  let depth = 0
  for (let i = open; i < css.length; i++) {
    if (css[i] === '{') depth++
    else if (css[i] === '}') { depth--; if (depth === 0) return css.slice(open, i + 1) }
  }
  return null
}
/** Every `var(--name, <fallback>)` in a string, as [name, fallback] pairs. */
export function varFallbacks(text) {
  return [...String(text).matchAll(/var\(\s*(--[\w-]+)\s*,\s*([^)]+?)\s*\)/g)].map((m) => [m[1], m[2].trim()])
}

const FS = '--lora-answer-font-size'
const LH = '--lora-answer-line-height'

// ── SELF-TEST — the helpers, before they are trusted on the real files ───────────────────────────────
{
  const css = '.a { color: red; }\n.b { width: calc(var(--x, 2px) * var(--y, 3)); }\n'
  const body = ruleBody(css, '.b')
  const fb = varFallbacks(body || '')
  const ok = body && body.includes('calc(') && fb.length === 2 && fb[0][1] === '2px' && fb[1][1] === '3'
    && ruleBody(css, '.zzz') === null
  if (!ok) {
    console.error(`[lm-mark-is-text-height] CANNOT RUN — the parsers failed their own self-test (body=${JSON.stringify(body)} fallbacks=${JSON.stringify(fb)}). ⛔ A BROKEN INSTRUMENT, NOT A PASS.`)
    process.exitCode = 2
    process.exit()
  }
  console.log('[lm-mark-is-text-height] self-test PASS — brace-matched rule bodies and var() fallback extraction both behave, and a missing selector returns null rather than a fragment.')
}

// ── (a) THE TOKENS ARE DECLARED ONCE ─────────────────────────────────────────────────────────────────
if (tokensCss) {
  for (const t of [FS, LH]) {
    if (!new RegExp(`${t}\\s*:`).test(tokensCss)) {
      findings.push(`(a) ${TOKENS} does not declare \`${t}\`. The mark and the answer text both derive from it; without a declaration every consumer silently falls back and the "one source" this guard asserts does not exist.`)
    }
  }
}

// ── (b) THE ANSWER TEXT CONSUMES THEM — NO FREE LITERALS ─────────────────────────────────────────────
let threadFs = null, threadLh = null
if (threadCss) {
  const body = ruleBody(threadCss, '.bubbleAssistant')
  if (!body) findings.push(`(b) ${THREAD} has no \`.bubbleAssistant\` rule — the answer text's metric is the thing the mark is derived FROM; if the selector moved, this guard is measuring nothing.`)
  else {
    const fb = new Map(varFallbacks(body))
    threadFs = fb.get(FS) ?? null
    threadLh = fb.get(LH) ?? null
    if (!threadFs) findings.push(`(b) \`.bubbleAssistant\` does not take its font-size from \`var(${FS}, …)\`. A free literal here is a metric the mark cannot follow — which is exactly how a 34px mark sat beside a 25.575px line for sixteen days.`)
    if (!threadLh) findings.push(`(b) \`.bubbleAssistant\` does not take its line-height from \`var(${LH}, …)\`.`)
  }
}

// ── (c) THE MARK IS THE SAME EXPRESSION, ON BOTH AXES ────────────────────────────────────────────────
let markFs = null, markLh = null
if (workingCss) {
  const body = ruleBody(workingCss, '.lmMark')
  if (!body) findings.push(`(c) ${WORKING} has no \`.lmMark\` rule.`)
  else {
    for (const axis of ['width', 'height']) {
      const m = new RegExp(`${axis}\\s*:\\s*calc\\([^;]*${FS}[^;]*\\*[^;]*${LH}[^;]*\\)`).exec(body)
      if (!m) findings.push(`(c) \`.lmMark\` does not set \`${axis}\` to \`calc(var(${FS}, …) * var(${LH}, …))\`. The mark must be the answer's LINE BOX, expressed as the tokens rather than as their product — a hardcoded ${axis} is a number somebody chose, which is the defect.`)
    }
    const fb = new Map(varFallbacks(body))
    markFs = fb.get(FS) ?? null
    markLh = fb.get(LH) ?? null
  }
}

// ── (d) THE FALLBACKS AGREE — THE PORTAL LEG ─────────────────────────────────────────────────────────
if (threadFs && markFs && threadFs !== markFs) {
  findings.push(`(d) FALLBACK DRIFT on ${FS}: the answer text falls back to \`${threadFs}\`, the mark to \`${markFs}\`. ⛔ LORAMER_PORTAL_SEVERS_CSS_VARS_V1 — the desktop shelf is portaled to document.body and every custom property from \`.tokens\` is SEVERED there, so BOTH sides use their fallback and the mark would match the text on the phone page and not on the shelf. Nothing else in the build can see this.`)
}
if (threadLh && markLh && threadLh !== markLh) {
  findings.push(`(d) FALLBACK DRIFT on ${LH}: text \`${threadLh}\` vs mark \`${markLh}\`. Same severance argument as above.`)
}

// ── (e) NO FREE SIZE IN THE COMPONENT ────────────────────────────────────────────────────────────────
if (markTsx) {
  const at = markTsx.indexOf('export function LmMark')
  if (at === -1) findings.push(`(e) ${MARK_TSX} exports no \`LmMark\` — the subject moved.`)
  else {
    const sig = markTsx.slice(at, markTsx.indexOf('{', markTsx.indexOf(')', at)) + 1)
    if (/size/.test(sig)) {
      findings.push(`(e) \`LmMark\` still takes a \`size\` prop (\`${sig.replace(/\s+/g, ' ').slice(0, 120)}\`). A JS number cannot see the text metric, so it can only ever be a number somebody chose — and it defaulted to 34 against a 25.575px line for sixteen days while the correction sat banked in chat.`)
    }
    const body = markTsx.slice(at, at + 1400)
    if (/\bwidth=\{/.test(body) || /\bheight=\{/.test(body)) {
      findings.push(`(e) \`LmMark\` sets \`width=\`/\`height=\` as SVG presentation attributes. A presentation attribute LOSES to any stylesheet rule, so this would be a second source of truth that the CSS silently overrides — a UI number nobody can trace. Size lives in \`.lmMark\`.`)
    }
    if (!/viewBox=/.test(body)) {
      findings.push(`(e) \`LmMark\` lost its \`viewBox\`. That is the coordinate system the paths are drawn in, NOT a size — removing it while removing the size attributes would collapse the mark.`)
    }
  }
}

if (findings.length) {
  console.error(`[lm-mark-is-text-height] FAIL — ${findings.length} finding(s):`)
  for (const f of findings) console.error(`  ✗ ${f}`)
  console.error(`  ⇒ SPEC: DECISIONS LORAMER_LM_MARK_IS_TEXT_HEIGHT_V1. The mark is the answer's line box expressed as the SAME tokens the text uses. ⚠ And the rendered result is still Gate-B on a device at sm (DECISIONS:65) — this leg proves the derivation, never the pixel.`)
  process.exitCode = 1
} else {
  const px = threadFs && threadLh ? ` Measured line box: ${threadFs} x ${threadLh} = ${(parseFloat(threadFs) * parseFloat(threadLh)).toFixed(3)}px.` : ''
  console.log(`[lm-mark-is-text-height] PASS — the answer text and the LM mark both derive from ${FS} x ${LH}, on both axes, with identical portal-fallbacks, and LmMark carries no size of its own.${px} ⛔ LIMIT: the derivation is proven, the rendered pixel is Gate-B.`)
}
