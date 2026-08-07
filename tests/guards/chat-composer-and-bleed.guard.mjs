#!/usr/bin/env node
// LORAMER_CHAT_ASSISTANT_FULL_BLEED_V1 + LORAMER_CHAT_COMPOSER_AUTOGROW_V1 — the CSS FACTS behind the
// 2026-08-07 readability flight, pinned so the next stylesheet edit cannot quietly undo them.
//
// ⛔ ITS LIMIT IS ON ITS FACE AND IT IS THE WHOLE REASON THIS FILE IS SHORT: ★CHAT-RENDER-MEASUREMENT-
// MISSING IS OPEN. NOTHING IN THIS REPO RENDERS A PAGE AND MEASURES A PIXEL. This guard reads TEXT. It
// therefore asserts DECLARATIONS — that a property is present, absent, or numerically at least some
// value — and it CANNOT assert that the composer is full width, that the send button paints inside the
// field, that the assistant text is wider than it was, or that the field grows and shrinks. Every one of
// those is a LAYOUT claim and only a device or a headless render can settle it. That half is GATE-B,
// Russ on the phone, and saying so here is the point: a green run on this file must never be read as
// "the surface looks right".
//
// ═══ THE ASSERTIONS ═════════════════════════════════════════════════════════════════════════════════
//   (a) .input font-size >= 16px — the iOS zoom fix. A focused control under 16px zooms the viewport
//       and iOS does NOT zoom back out on blur. ⛔ AND THE OTHER HALF IS ASSERTED TOO: no
//       maximum-scale / user-scalable=no anywhere in the chat surface, because suppressing pinch-zoom
//       for everyone is an accessibility regression, not a fix.
//   (b) `field-sizing: content` present AND inside an @supports gate — it is NOT Baseline (Chromium
//       123+, Safari 26.2+) and every iOS browser is WebKit, so an ungated declaration is a silent
//       no-op on the exact device this flight is for.
//   (c) a JS autosize fallback exists in LoraThread and is gated on CSS.supports('field-sizing', …),
//       so native sizing and the fallback can never both run.
//   (d) the fallback resets height to 'auto' before reading scrollHeight — without it the field
//       ratchets up and never SHRINKS when cleared, which is a stated requirement, not a nicety.
//   (e) .input has a max-height cap — an uncapped auto-grow lets one paste eat the thread.
//   (f) .bubbleAssistant carries NO background and NO border-radius — the full-bleed change itself.
//
// ⛔ LORAMER_GUARD_ROOT — HANDLED, AND STATED BECAUSE ★GUARD-IGNORES-LORAMER-GUARD-ROOT IS OPEN. That
// defect is a guard whose paths resolve to the REAL tree while a throwaway proof believes it is reading
// a scratch one, so the RED half of "seen red" proves nothing. This guard (1) HONOURS LORAMER_GUARD_ROOT
// when set — the RED proofs for this commit were run against a scratch tree and the findings came from
// THAT tree; (2) falls back MODULE-RELATIVE, never process.cwd(), so it cannot follow whatever directory
// invoked it; (3) FAILS CLOSED — an unreadable file is a FAILURE, never a pass.
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const ROOT = process.env.LORAMER_GUARD_ROOT || resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const CSS_PATH = 'src/components/redesign/lora-thread.module.css'
const TSX_PATH = 'src/components/redesign/LoraThread.tsx'
const findings = []

const read = (rel) => {
  try { return readFileSync(resolve(ROOT, rel), 'utf8') }
  catch (e) { findings.push(`UNREADABLE ${rel} under ROOT ${ROOT} — ${e.message}. A guard that cannot read its evidence FAILS; it does not pass.`); return null }
}
const css = read(CSS_PATH)
const tsx = read(TSX_PATH)

// Comments in this repo QUOTE the defective forms in order to teach them. Stripping them first is
// mandatory or the guard fails on its own documentation — "QUOTATION IS NOT ASSERTION", banked twice
// on 2026-07-29 after it fired in two unrelated source-scanning guards.
const strip = (t) => t.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
// The declaration block for one class, comments already gone.
const ruleOf = (t, cls) => {
  const m = new RegExp(`\\.${cls}\\s*\\{([^}]*)\\}`).exec(t)
  return m ? m[1] : null
}

if (css) {
  const code = strip(css)

  // ── (a) THE iOS ZOOM FIX ──────────────────────────────────────────────────────────────────────────
  const input = ruleOf(code, 'input')
  if (!input) {
    findings.push(`(a) no .input rule found in ${CSS_PATH} — the composer's own declarations are the evidence and they are missing.`)
  } else {
    const fs = /font-size\s*:\s*([\d.]+)px/.exec(input)
    if (!fs) findings.push(`(a) .input declares NO font-size. iOS zooms any focused control whose COMPUTED size is under 16px, and inheriting leaves that to chance.`)
    else if (parseFloat(fs[1]) < 16) findings.push(`(a) .input font-size is ${fs[1]}px, under the 16px iOS floor. A focused control under 16px zooms the viewport and iOS does NOT zoom back out on blur (measured 1.1431818x, LORAMER_NEXT_CHAT_INPUT_16PX_V1).`)

    // ── (e) THE CAP ─────────────────────────────────────────────────────────────────────────────────
    if (!/max-height\s*:/.test(input)) {
      findings.push(`(e) .input has NO max-height. Auto-grow without a ceiling lets a single long paste push the entire thread off screen.`)
    }
  }

  // ── (b) field-sizing, GATED ───────────────────────────────────────────────────────────────────────
  if (!/field-sizing\s*:\s*content/.test(code)) {
    findings.push(`(b) ${CSS_PATH} does not declare \`field-sizing: content\` — the native auto-grow is absent.`)
  } else {
    const gated = /@supports\s*\(\s*field-sizing\s*:\s*content\s*\)\s*\{[^]*?field-sizing\s*:\s*content/.test(code)
    if (!gated) findings.push(`(b) \`field-sizing: content\` is declared OUTSIDE an @supports gate. It is NOT Baseline (Chromium 123+, Safari 26.2+) and every iOS browser is WebKit, so ungated it is a silent no-op on the target device while the JS fallback stands down thinking it is handled.`)
  }

  // ── (f) THE BUBBLE IS GONE ────────────────────────────────────────────────────────────────────────
  const bub = ruleOf(code, 'bubbleAssistant')
  if (!bub) {
    findings.push(`(f) no .bubbleAssistant rule found — the assistant container's declarations are the evidence.`)
  } else {
    if (/background(-color)?\s*:/.test(bub)) findings.push(`(f) .bubbleAssistant still declares a background. LORAMER_CHAT_ASSISTANT_FULL_BLEED_V1 removed the card: assistant text renders on the page background with the page's own margin and no fill.`)
    if (/border-radius\s*:/.test(bub)) findings.push(`(f) .bubbleAssistant still declares a border-radius. A rounded corner with no fill is the shape of a card that was half-removed.`)
  }

  // ── (a, second half) NEVER SUPPRESS PINCH-ZOOM ────────────────────────────────────────────────────
  if (/maximum-scale|user-scalable/.test(code)) {
    findings.push(`(a) the chat stylesheet references maximum-scale/user-scalable. That disables pinch-zoom for every user to hide one input's zoom — an accessibility regression, and it does not restore scale on blur either. The fix is font-size >= 16px.`)
  }
}

if (tsx) {
  const code = strip(tsx)
  // ── (c) THE FALLBACK EXISTS AND IS GATED ──────────────────────────────────────────────────────────
  const supportsGate = /CSS\.supports\(\s*['"]field-sizing['"]/.test(code)
  const growsFromScrollHeight = /scrollHeight/.test(code) && /style\.height/.test(code)
  if (!growsFromScrollHeight) {
    findings.push(`(c) ${TSX_PATH} has no JS autosize fallback (no style.height driven from scrollHeight). Engines without field-sizing — which includes every iOS browser below Safari 26.2 — would get a fixed one-line box.`)
  }
  if (!supportsGate) {
    findings.push(`(c) the autosize fallback is not gated on CSS.supports('field-sizing', …). Ungated it runs ALONGSIDE native field-sizing, and two mechanisms sizing one element is how a field jitters on every keystroke.`)
  }
  // ── (d) IT MUST SHRINK, NOT ONLY GROW ─────────────────────────────────────────────────────────────
  const resetsFirst = /style\.height\s*=\s*['"]auto['"]/.test(code)
  if (!resetsFirst) {
    findings.push(`(d) the fallback never resets height to 'auto' before reading scrollHeight. scrollHeight on an element already sized to its content returns that size, so the field RATCHETS UP and never shrinks back when cleared — which is a stated requirement of this flight, not a nicety.`)
  }
}

if (findings.length) {
  console.error(`[chat-composer-and-bleed] FAIL — ${findings.length} finding(s):`)
  for (const f of findings) console.error(`  - ${f}`)
  process.exit(1)
}
console.log('[chat-composer-and-bleed] PASS — .input >= 16px with a max-height cap · field-sizing present and @supports-gated · JS fallback present, CSS.supports-gated, and resets to auto so it shrinks · .bubbleAssistant carries no background and no border-radius. ⛔ CSS FACTS ONLY — this proves NO pixel; layout is Gate-B on device (★CHAT-RENDER-MEASUREMENT-MISSING).')
