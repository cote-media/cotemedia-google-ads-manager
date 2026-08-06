#!/usr/bin/env node
// LORAMER_CHAT_COPY_BLOCKS_V1 — guard the copy affordance on -next fenced blocks.
//
// ⛔ WHAT THIS EXISTS TO CATCH, and it is a shape this repo has already paid for twice. LoraThread has
// TWO markdown call sites — the completed turn and the STREAMING PREVIEW — and every chat change that
// touched only one of them shipped a surface that worked after the answer landed and not while it was
// arriving. The fix was to collapse both onto ONE `<Md>` renderer; this guard is what stops a future
// edit spelling `<ReactMarkdown>` out again at one site and quietly losing the override there.
// (FIX-WITH-GUARD: "Where a pattern lives in N files, do not guard the convention — COLLAPSE IT TO ONE
// SOURCE and guard that.")
//
// ⛔ AND IT GUARDS THE LEGACY BOUNDARY IN THE DIRECTION THAT CAN ACTUALLY BREAK. Blast radius for this
// flight is -next ONLY. `src/app/dashboard/page.tsx` carries its own six ReactMarkdown call sites and
// must not gain the affordance; the check is that legacy neither imports the shared thread nor its
// stylesheet, so a leak is structurally impossible rather than merely absent today.
//
// LEGS:
//  (a) the `pre` override exists and is wired into ReactMarkdown's `components`
//  (b) BOTH markdown call sites go through the single shared renderer — no bare <ReactMarkdown> left
//  (c) no Tabler icon webfont class in this component (it renders outside Shell; `ti ti-*` is a 0x0
//      invisible element there — the banked defect, not a hypothetical)
//  (d) the copied state is reset-keyed, so it cannot survive a client switch on the always-mounted shelf
//  (e) the copy source EXCLUDES the button node, so "Copy" is never pasted into the user's clipboard
//  (f) legacy /dashboard does not reach the shared thread or its stylesheet
//  (g) the shipped `.md pre` rule carries `position: relative` — without it the absolutely-positioned
//      button escapes to the nearest positioned ancestor, which on the shelf is the portaled panel
import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const ROOT = process.env.LORAMER_GUARD_ROOT || process.cwd()
const findings = []
const check = (c, m) => { if (!c) findings.push(m) }
const read = (p) => { try { return readFileSync(resolve(ROOT, p), 'utf8') } catch { return '' } }
// ⛔ QUOTATION IS NOT ASSERTION — banked three times in this repo, and it bit the chat guards twice in
// one day when a fix COMMENT naming the property it removed satisfied the check that property was gone.
const strip = (src) => src.split('\n').filter((l) => !l.trim().startsWith('//') && !l.trim().startsWith('*') && !l.trim().startsWith('/*')).join('\n')

const TSX = 'src/components/redesign/LoraThread.tsx'
const CSS = 'src/components/redesign/lora-thread.module.css'
const LEGACY = 'src/app/dashboard/page.tsx'

if (!existsSync(resolve(ROOT, TSX))) {
  console.error(`[chat-copy-blocks] FAIL — ${TSX} is missing; the shared -next thread is where this affordance lives.`)
  process.exit(1)
}
const raw = read(TSX)
const code = strip(raw)
const css = read(CSS)
const legacy = read(LEGACY)

// ── (a) THE OVERRIDE EXISTS AND IS WIRED ───────────────────────────────────────────────────────────
check(/components=\{[A-Za-z_$][\w$]*\}|components=\{\{[\s\S]{0,200}?pre:/.test(code),
  `(a) ReactMarkdown is rendered without a \`components\` override. Without it a fenced block is a bare <pre> and there is no copy affordance at all.`)
check(/\bpre:\s*CopyablePre\b/.test(code),
  `(a) the \`pre\` slot is not mapped to CopyablePre — the override object exists but does not replace the block element the affordance attaches to.`)
check(/function\s+CopyablePre\b/.test(code),
  `(a) CopyablePre is not defined in ${TSX}.`)
check(/navigator\.clipboard\.writeText\(/.test(code),
  `(a) nothing calls navigator.clipboard.writeText — the button is decorative.`)

// ── (b) ONE RENDERER, BOTH CALL SITES ──────────────────────────────────────────────────────────────
{
  const mdUses = [...code.matchAll(/<Md>\{/g)].length
  check(mdUses >= 2,
    `(b) found ${mdUses} <Md> call site(s); the component has TWO — the completed turn AND the streaming preview. A change that reaches only one ships an affordance that appears after the answer lands and is missing while it arrives, which is the exact half-surface defect this repo shipped twice.`)
  const bare = [...code.matchAll(/<ReactMarkdown\b/g)].length
  check(bare === 1,
    `(b) ${bare} <ReactMarkdown> element(s) in ${TSX}; there must be exactly ONE, inside <Md>. A second means a call site has been spelled out again and will drift away from the override.`)
  check(/function\s+Md\s*\(/.test(code),
    `(b) the shared <Md> renderer is gone — the two call sites are no longer collapsed onto one source, so the override can be present on one and absent on the other.`)
}

// ── (c) NO ICON WEBFONT — IT RENDERS OUTSIDE SHELL ─────────────────────────────────────────────────
check(!/className=["'`][^"'`]*\bti\s+ti-/.test(code) && !/<i\s+className=/.test(code),
  `(c) a Tabler icon webfont class appears in ${TSX}. The font is linked only from Shell; the page renders OUTSIDE Shell and the shelf is portaled out of .root, so \`<i class="ti ti-*">\` is a 0x0 invisible element — in the DOM, in bounds, perfectly tappable if you knew where to aim. Icons here are INLINE SVG.`)
check(/<Icon d=\{copied \? CHECK : COPY\}|d=\{copied \? CHECK : COPY\}/.test(code),
  `(c) the copy button does not render the inline-SVG Icon with a distinct copied state.`)

// ── (d) THE COPIED STATE CANNOT SURVIVE A CLIENT SWITCH (d55f739) ──────────────────────────────────
check(/CopyResetContext/.test(code),
  `(d) there is no reset key for the copied state. The shelf stays MOUNTED across a client switch while the page remounts, and messages.map keys by INDEX — so React reuses this component and its state when another client's conversation replaces it. That is the d55f739 bleed one layer down.`)
check(/<CopyResetContext\.Provider\s+value=\{clientId/.test(code),
  `(d) CopyResetContext is not provided from clientId — a reset key that never changes on a client switch resets nothing.`)
check(/useEffect\(\(\)\s*=>\s*\{\s*setCopied\(false\)\s*\},\s*\[resetKey\]\)/.test(code),
  `(d) the copied flag is not cleared when the reset key changes.`)

// ── (e) THE BUTTON'S OWN TEXT IS NEVER COPIED ──────────────────────────────────────────────────────
check(/dataset\.loraCopy/.test(code) && /data-lora-copy=/.test(code),
  `(e) the copy source does not exclude the button node by identity. The button lives INSIDE the <pre>, so reading the <pre>'s textContent wholesale pastes the word "Copy" into the user's negative-keyword box — the precise output this feature exists to make paste-able.`)
check(!/pre\.textContent/.test(code),
  `(e) the copy reads the <pre>'s own textContent, which includes the button.`)

// ── (f) THE LEGACY SURFACE IS NOT REACHED ──────────────────────────────────────────────────────────
check(!/LoraThread/.test(legacy),
  `(f) legacy ${LEGACY} imports the shared -next thread. Blast radius for this flight is -next ONLY.`)
check(!/lora-thread\.module\.css/.test(legacy),
  `(f) legacy ${LEGACY} pulls the -next thread stylesheet; the affordance's styling would leak onto the legacy surface.`)

// ── (g) THE SHIPPED .md pre RULE CARRIES position: relative ────────────────────────────────────────
{
  const rule = (css.match(/^\.md pre \{[^}]*\}/m) || [''])[0]
  check(/position:\s*relative/.test(rule),
    `(g) \`.md pre\` does not set \`position: relative\`. The copy button is absolutely positioned INSIDE the <pre>; without a positioned ancestor it escapes to the nearest one — on the shelf that is the portaled panel, so the button floats off the block entirely.`)
  check(/\.copyBtn\s*\{/.test(css), `(g) the .copyBtn rule is missing from ${CSS}.`)
  // Every colour a var WITH a literal fallback — the banked white-glyph-on-white-bar defect.
  const btn = (css.match(/^\.copyBtn \{[^}]*\}/m) || [''])[0]
  for (const m of [...btn.matchAll(/var\(([^),]+)\)/g)]) {
    check(false, `(g) \`.copyBtn\` uses \`var(${m[1]})\` with NO literal fallback. Both surfaces render outside .root, where an unresolved custom property has already shipped a white glyph in a transparent circle on a white bar.`)
  }
}

if (findings.length) {
  console.error(`[chat-copy-blocks] FAIL — ${findings.length} finding(s):`)
  for (const f of findings) console.error(`  · ${f}`)
  process.exit(1)
}
console.log('[chat-copy-blocks] PASS — the pre override is wired through the single shared <Md> renderer (both the completed and streaming call sites), icons are inline SVG, the copied flag is reset-keyed on clientId, the button node is excluded from the copy, `.md pre` is positioned, and the legacy surface reaches none of it.')
