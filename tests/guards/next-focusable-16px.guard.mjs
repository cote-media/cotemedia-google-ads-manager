#!/usr/bin/env node
// LORAMER_NEXT_FOCUSABLE_16PX_V1 — EVERY FOCUSABLE CONTROL ON THE -NEXT CARD SURFACE IS AT LEAST 16px.
//
// ⛔ WHY 16px, AND IT IS MEASURED RATHER THAN STYLED. DECISIONS:599 (LORAMER_NEXT_CHAT_INPUT_16PX_V1) banked
// it after the chat composer: "iOS auto-zooms ANY focused input under 16px", and the zoom "was proven to
// occur at 1.1431818× on this exact input". The same rule was never applied to the card surface, where the
// page date-range select (.viewSel), the custom-range date inputs (.dateIn) and every config-panel field
// (.sel) sat at 12-13px — so tapping the date range magnified the page and shifted the toolbar off-centre.
//
// ⛔ WHAT COUNTS AS FOCUSABLE HERE, AND WHY CHECKBOXES ARE DELIBERATELY EXCLUDED. iOS auto-zoom fires when a
// TEXT-ENTRY or PICKER control takes focus — <input> (except checkbox/radio), <select>, <textarea>. A
// checkbox opens no keyboard and no wheel, takes no text, and is not magnified; CardConfigPanel.tsx has two
// bare <input type="checkbox"> with no class at all, and flagging them would be a false finding, not rigour.
//
// ⛔ THE LIMIT, STATED ON THE PASS LINE RATHER THAN IMPLIED — QUEUE:900 (★MOBILE-WIDTH-GUARD): "a headless
// RENDER-MEASUREMENT guard PASSES while the bug is live on iOS … If built, it MUST assert the CSS INVARIANT
// … OR run on a real iOS surface." This guard asserts the DECLARED CSS INVARIANT. It never sees a rendered
// pixel and never observes the zoom itself; that is Gate-B on a real phone, and no guard replaces it.
//
// USAGE: node tests/guards/next-focusable-16px.guard.mjs
import { readFileSync, readdirSync } from 'node:fs'
import { resolve, dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = process.env.LORAMER_GUARD_ROOT || resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const read = (p) => { try { return readFileSync(resolve(ROOT, p), 'utf8') } catch { return null } }
const findings = []

const CSS_REL = 'src/components/redesign/cards/cards.module.css'
const TSX_DIR = 'src/components/redesign/cards'
const FLOOR = 16

// ── THE DECLARED SIZES, PARSED FROM THE MODULE ───────────────────────────────────────────────────────────
// Multi-selector rules (`.act, .actOn { … }`) map EVERY listed class to the same declaration, which is why
// the selector list is split rather than matched whole.
function parseCss(src) {
  const byClass = new Map()   // class -> { size: number|null, line: number }
  const lineOf = (idx) => src.slice(0, idx).split('\n').length
  for (const m of src.matchAll(/([^{}]+)\{([^}]*)\}/g)) {
    const selectors = m[1]
    const body = m[2]
    const fs = body.match(/font-size:\s*([\d.]+)px/)
    const size = fs ? Number(fs[1]) : null
    // The selector capture swallows the preceding newline/indent, so the line number is taken from the
    // FIRST NON-SPACE character of the selector — a guard that cites the wrong line teaches distrust.
    const selStart = m.index + (selectors.length - selectors.trimStart().length)
    for (const c of selectors.matchAll(/\.([A-Za-z0-9_-]+)/g)) {
      const name = c[1]
      // A later rule wins in CSS; keep the last one that DECLARES a size, else record the first sighting.
      const prev = byClass.get(name)
      if (size !== null || !prev) byClass.set(name, { size: size !== null ? size : (prev?.size ?? null), line: lineOf(selStart) })
    }
  }
  return byClass
}

// ── THE FOCUSABLE CONTROLS, FROM THE JSX ─────────────────────────────────────────────────────────────────
// Tag-scoped: capture each <select|input|textarea …> opening tag, then read its `type` and its
// `className={styles.X}` from WITHIN that tag, so attribute order cannot fool the scan.
const EXCLUDED_TYPES = new Set(['checkbox', 'radio'])
function scanControls(file, src) {
  const out = []
  for (const m of src.matchAll(/<(select|input|textarea)\b([^>]*)>/g)) {
    const tag = m[1]
    const attrs = m[2]
    const type = (attrs.match(/type=["']([a-z]+)["']/) || [])[1] || (tag === 'select' || tag === 'textarea' ? tag : 'text')
    if (EXCLUDED_TYPES.has(type)) continue
    const cls = (attrs.match(/className=\{styles\.([A-Za-z0-9_]+)\}/) || [])[1] || null
    out.push({ file, tag, type, cls, line: src.slice(0, m.index).split('\n').length })
  }
  return out
}

const css = read(CSS_REL)
if (css === null) findings.push(`(a) ${CSS_REL} unreadable — the invariant cannot be asserted, which is a broken instrument, never a pass.`)

let controls = []
try {
  for (const f of readdirSync(resolve(ROOT, TSX_DIR)).filter((f) => f.endsWith('.tsx'))) {
    const src = read(join(TSX_DIR, f))
    if (src) controls = controls.concat(scanControls(`${TSX_DIR}/${f}`, src))
  }
} catch (e) {
  findings.push(`(a) ${TSX_DIR} unreadable — ${e?.message}`)
}
if (css !== null && controls.length === 0) {
  findings.push(`(a) NO focusable control found under ${TSX_DIR} — the scan matched nothing, so a green result would be vacuous. Check the tag regex before trusting this guard.`)
}

const byClass = css === null ? new Map() : parseCss(css)

// ── (b) EVERY CLASSED CONTROL MUST DECLARE >= 16px ───────────────────────────────────────────────────────
const seen = new Map()   // class -> [{file,line,tag,type}]
for (const c of controls) {
  if (!c.cls) {
    findings.push(`(b) ${c.file}:${c.line} <${c.tag}${c.type ? ` type=${c.type}` : ''}> has NO className={styles.*} — its font-size cannot be verified, and an unverifiable focusable control is not a pass.`)
    continue
  }
  if (!seen.has(c.cls)) seen.set(c.cls, [])
  seen.get(c.cls).push(c)
}
for (const [cls, uses] of [...seen.entries()].sort()) {
  const rule = byClass.get(cls)
  const where = uses.map((u) => `${u.file}:${u.line}`).join(', ')
  if (!rule) {
    findings.push(`(b) .${cls} is applied to a focusable control (${where}) but declares no rule in ${CSS_REL} — cannot verify.`)
    continue
  }
  if (rule.size === null) {
    findings.push(`(b) .${cls} (${CSS_REL}:${rule.line}) declares NO font-size but is applied to a focusable control (${where}) — an inherited size cannot be asserted here; declare it.`)
    continue
  }
  if (rule.size < FLOOR) {
    findings.push(`(b) .${cls} font-size ${rule.size}px (${CSS_REL}:${rule.line}) — applied to ${uses.length} focusable control(s): ${where}. iOS auto-zooms ANY focused input under ${FLOOR}px (DECISIONS:599 LORAMER_NEXT_CHAT_INPUT_16PX_V1, measured 1.1431818× on this exact class of input).`)
  }
}

if (findings.length) {
  console.error(`\n✗ NEXT-FOCUSABLE-16PX FAILED — ${findings.length} finding(s):`)
  for (const f of findings) console.error(`  - ${f}`)
  console.error(`  LIMIT: this asserts the DECLARED CSS invariant, never a rendered pixel — a real phone is the only instrument that sees the zoom (QUEUE:900 ★MOBILE-WIDTH-GUARD).`)
  process.exit(1)
}
console.log(`[next-focusable-16px] PASS — ${seen.size} class(es) on ${controls.length} focusable control(s) under ${TSX_DIR} all declare >= ${FLOOR}px (checkbox/radio excluded: they open no keyboard and are not magnified). LIMIT: asserts the DECLARED CSS invariant, never a rendered pixel — the zoom itself is Gate-B on a real phone (QUEUE:900).`)
