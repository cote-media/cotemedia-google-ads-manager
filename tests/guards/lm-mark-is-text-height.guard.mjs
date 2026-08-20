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
    // ⛔ EITHER FORM IS THE SAME DERIVATION, AND BOTH ARE ACCEPTED ON PURPOSE: the axis may name
    // `--lm-mark-size` (declared in .tokens as exactly this product, and leg (f) pins that declaration) or
    // spell the product inline. What is REFUSED is a length that is neither — a number somebody chose.
    // This widened when the size and the ink-padding tokens were unified; a guard that only accepted the
    // inline spelling would have gone red on the very commit that removed the duplication.
    for (const axis of ['width', 'height']) {
      const inline = new RegExp(`${axis}\\s*:\\s*calc\\([^;]*${FS}[^;]*\\*[^;]*${LH}[^;]*\\)`).test(body)
      const viaToken = new RegExp(`${axis}\\s*:\\s*var\\(\\s*--lm-mark-size\\b`).test(body)
      if (!inline && !viaToken) findings.push(`(c) \`.lmMark\` does not set \`${axis}\` from the answer's line box — expected \`var(--lm-mark-size, …)\` or \`calc(var(${FS}, …) * var(${LH}, …))\`. A hardcoded ${axis} is a number somebody chose, which is the defect.`)
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

// ── (f) THE OPTICAL OFFSETS ARE THE ARTWORK'S OWN PADDING, EXPRESSED — LORAMER_LM_MARK_BASELINE_V1 ────
// ⛔ THIS LEG EXISTS BECAUSE THE SIZE FIX BROKE THE ALIGNMENT AND NOTHING NOTICED. `.mark`'s `-4px` and
// `.statusText`'s `-6px` were both DERIVED — correctly — against a 34px box, and both comments said so in
// writing ("at 34px there is ~4.1px … and ~8.4px below"; "change the viewBox and this number changes with
// it"). The very next commit changed the box to 25.575px and left both: over-pulling by 0.91px and 1.71px,
// so the mark sat low and the status line rode up under it. A correct derivation written as a NUMBER is one
// resize away from being a wrong number, and the comment saying it was derived is what makes it look safe.
// ⛔ THE INK BOX IS READ FROM THE PATHS, NOT ASSUMED: viewBox `0 0 24 24`; centrelines y 4.5→16.5 (L) and
// 7.5→16.5 (M) — FLUSH at the bottom, the M does not descend — plus 1.6 of round-cap ink each side from
// strokeWidth 3.2 ⇒ ink y 2.9→18.1 ⇒ 2.9 above, 5.9 below.
{
  const tok = tokensCss || ''
  for (const [name, ratio] of [['--lm-ink-top', '2.9'], ['--lm-ink-bottom', '5.9']]) {
    const body = ruleBody(tok, '.tokens') || ''
    const re = new RegExp(`${name}\\s*:\\s*calc\\([^;]*--lm-mark-size[^;]*\\*[^;]*${ratio.replace('.', '\\.')}[^;]*/[^;]*24[^;]*\\)`)
    if (!re.test(body)) {
      findings.push(`(f) \`${name}\` is not declared as \`calc(var(--lm-mark-size) * ${ratio} / 24)\`. The mark's optical padding is a RATIO OF THE BOX taken from the viewBox — write it as a pixel value and the next resize silently un-aligns the mark, which is exactly what happened between LORAMER_LM_MARK_IS_TEXT_HEIGHT_V1 and this commit.`)
    }
  }
  const wk = workingCss || ''
  const markBody = ruleBody(wk, '.mark') || ''
  if (!/margin-top:\s*calc\([^;]*--lm-ink-top/.test(markBody)) {
    findings.push(`(f) \`.mark\` does not pull its margin-top from \`--lm-ink-top\`. It must cancel EXACTLY the empty box above the stroke so the ink top lands where the adjacent text's cap-height starts; a literal here was -4px against a real 3.090px and it over-pulled.`)
  }
  const statusBody = ruleBody(wk, '.statusText') || ''
  if (!/margin-top:\s*calc\([^;]*--lm-ink-bottom/.test(statusBody)) {
    findings.push(`(f) \`.statusText\` does not derive its margin-top from \`--lm-ink-bottom\`. It must cancel the empty box BELOW the stroke and leave the authored optical gap; a literal here was -6px against a real 6.287px, leaving 0.29px instead of 2px.`)
  }
  for (const [label, body] of [['.mark', markBody], ['.statusText', statusBody]]) {
    if (/margin-top:\s*-?\d/.test(body)) {
      findings.push(`(f) \`${label}\` sets margin-top to a bare number. Optical offsets against this artwork are ratios of the box; a number is correct only for the box size it was measured against, and nothing tells you which one that was.`)
    }
  }
}

// ── (g) THE TWO LETTERS ARE THE SAME HEIGHT, AND THE DASH COVERS THE LONGER OF THEM ──────────────────
// ⛔ LORAMER_LM_EQUAL_CAP_HEIGHT_V1 — RUSS'S CALL, SETTLED: the L and the M are equal cap-height. It shipped
// with the M at y 7.5→16.5 = 9 units against the L's 4.5→16.5 = 12 — **75% of the L, sharing a bottom edge**
// — which is what made the M read as sitting low. That is an ARTWORK defect, and no amount of CSS margin
// could have fixed it: the earlier flights moved the box and then the box's padding, and the glyph inside
// stayed wrong both times.
// ⛔ AND THE DASH IS COUPLED TO THE GEOMETRY, WHICH IS WHY IT IS THE SAME LEG. Raising the M lengthened it
// 29.1018 → 37.6473 user units. `stroke-dasharray` must exceed the LONGER path or one dash cannot cover the
// stroke: at the old 32 the M would have started 5.65 units already-visible and finished 5.65 short of
// drawn. The keyframe's opening `stroke-dashoffset` must equal the dasharray or the stroke starts partly
// drawn. Both are computed here from the PATHS THEMSELVES, so an artwork edit that forgets the dash fails.
{
  const tsx = markTsx || ''
  // ⛔ COMMENTS STRIPPED BEFORE MATCHING, AND IT IS NOT HYGIENE — IT WENT RED ON THE FIRST RUN. The
  // stylesheet's own header QUOTES the historical value ("`stroke-dasharray: 1` was read against paths of
  // 17.5 and 29.1"), so an unstripped scan reads the number out of the PROSE EXPLAINING THE OLD BUG and
  // reports it as the shipped value. Same phantom-token-in-prose class this repo has paid for twice.
  const wk = String(workingCss || '').replace(/\/\*[\s\S]*?\*\//g, '')
  // Parse the absolute M/V/H/L subset these two paths use. Anything else is a finding, not a guess.
  const points = (d) => {
    const pts = []
    let x = null, y = null
    const toks = String(d).trim().split(/(?=[MVHL])/)
    for (const t of toks) {
      const cmd = t[0], nums = t.slice(1).trim().split(/[\s,]+/).filter(Boolean).map(Number)
      if (nums.some((n) => !Number.isFinite(n))) return null
      if (cmd === 'M') { x = nums[0]; y = nums[1] }
      else if (cmd === 'V') { y = nums[0] }
      else if (cmd === 'H') { x = nums[0] }
      else if (cmd === 'L') { x = nums[0]; y = nums[1] }
      else return null
      pts.push([x, y])
    }
    return pts.every((p) => Number.isFinite(p[0]) && Number.isFinite(p[1])) ? pts : null
  }
  const len = (pts) => pts.slice(1).reduce((n, p, i) => n + Math.hypot(p[0] - pts[i][0], p[1] - pts[i][1]), 0)
  const ds = [...tsx.matchAll(/<path[^>]*\sd="([^"]+)"/g)].map((m) => m[1])
  if (ds.length !== 2) {
    findings.push(`(g) expected exactly 2 <path d="…"> in ${MARK_TSX}, found ${ds.length}. The mark is two letters; a third path or a missing one means this leg is measuring something else.`)
  } else {
    const parsed = ds.map(points)
    if (parsed.some((p) => p === null)) {
      findings.push(`(g) a path in ${MARK_TSX} uses a command this leg cannot parse (it handles absolute M/V/H/L only). ⛔ AN UNPARSED PATH IS NOT A PASS — teach the parser in the same commit that introduces the command, or the equal-height and dash checks silently stop running.`)
    } else {
      const ys = parsed.map((p) => p.map((q) => q[1]))
      const extent = ys.map((a2) => Math.max(...a2) - Math.min(...a2))
      const tops = ys.map((a2) => Math.min(...a2)), bottoms = ys.map((a2) => Math.max(...a2))
      if (Math.abs(extent[0] - extent[1]) > 0.001) {
        findings.push(`(g) THE TWO LETTERS ARE NOT THE SAME HEIGHT — L spans ${extent[0]} vertical units (y ${tops[0]}→${bottoms[0]}), M spans ${extent[1]} (y ${tops[1]}→${bottoms[1]}); the M is ${((extent[1] / extent[0]) * 100).toFixed(0)}% of the L. Sharing a bottom edge, a shorter M reads as sitting low, and NO CSS margin can correct it — the defect is in the artwork. Russ settled this: equal cap-height (LORAMER_LM_EQUAL_CAP_HEIGHT_V1).`)
      }
      if (Math.abs(bottoms[0] - bottoms[1]) > 0.001) {
        findings.push(`(g) the letters do not share a baseline — L bottoms at y ${bottoms[0]}, M at y ${bottoms[1]}. Equal height off a shared baseline is the whole property; equal height off two different baselines is a different mark.`)
      }
      const longest = Math.max(...parsed.map(len))
      const dashM = /stroke-dasharray:\s*([\d.]+)/.exec(wk)
      const offM = /0%\s*\{\s*stroke-dashoffset:\s*([\d.]+)/.exec(wk)
      if (!dashM) findings.push('(g) no `stroke-dasharray` found in the working stylesheet — the draw-on animation has no dash to animate.')
      else if (Number(dashM[1]) <= longest) {
        findings.push(`(g) \`stroke-dasharray: ${dashM[1]}\` is NOT longer than the longest path (${longest.toFixed(4)} user units). One dash must cover either stroke completely, or the stroke starts partly visible and finishes short of drawn — which reads as a glitching animation and which nothing else in the build can see. ⛔ pathLength cannot be used to normalise this: WebKit parses and ignores it, and every browser on iOS is WebKit.`)
      }
      if (dashM && offM && dashM[1] !== offM[1]) {
        findings.push(`(g) the keyframe opens at \`stroke-dashoffset: ${offM[1]}\` but the dash is \`${dashM[1]}\`. They must be equal or the stroke is already part-drawn at 0%.`)
      }
      if (!findings.length) {
        console.log(`[lm-mark-is-text-height] (g) artwork: both letters span ${extent[0]} vertical units off a shared baseline y=${bottoms[0]}; longest path ${longest.toFixed(4)} units, dash ${dashM ? dashM[1] : '?'} (headroom ${dashM ? (Number(dashM[1]) - longest).toFixed(4) : '?'}).`)
      }
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
