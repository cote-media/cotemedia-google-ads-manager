#!/usr/bin/env node
// LORAMER_LORA_HEADER_VISUAL_VIEWPORT_V1 + LORAMER_CHAT_COMPOSER_CLIP_V1 — the JS/CSS facts behind the
// 2026-08-07 keyboard flight, pinned so the next edit cannot quietly undo half of them.
//
// ⛔ ITS LIMIT IS ON ITS FACE, AND IT IS THE REASON THIS FILE CANNOT BE THE PROOF: ★CHAT-RENDER-
// MEASUREMENT-MISSING IS OPEN. NOTHING IN THIS REPO RENDERS A PAGE, OPENS A KEYBOARD, OR MEASURES A
// PIXEL. This guard reads TEXT. It can prove that both visualViewport events are subscribed, that a
// dismissal path exists, that every listener is removed, and that the composer cap is derived rather
// than hard-coded. It CANNOT prove the header stays put under a thumb-flick, that the transform lands
// on the right element, or that the composer clips correctly — those are LAYOUT and belong to Gate-B on
// device. A green run here must never be read as "the keyboard case is fixed".
//
// ═══ THE ASSERTIONS ═════════════════════════════════════════════════════════════════════════════════
//   (a) BOTH visualViewport events are subscribed — 'resize' AND 'scroll'. `resize` fires when the
//       keyboard opens or closes; `scroll` is what fires when the user flicks the visual viewport with
//       the keyboard ALREADY UP, which is the failing gesture. Subscribing to one fixes half the defect
//       and looks fixed.
//   (b) a blur/focusout dismissal path exists. developer.apple.com/forums/thread/800154 (iOS 26):
//       visualViewport.offsetTop does NOT reset to 0 after dismissal, so resize alone leaves the
//       element displaced. This is an OPEN vendor bug, not a defensive nicety.
//   (c) every listener added is removed — a cleanup return that unsubscribes both vv events and the
//       focusout. A page this route mounts and unmounts on every navigation leaks otherwise.
//   (d) the composer cap DERIVES from viewport height (a `--lora-composer-max` custom property written
//       from visualViewport, consumed inside a min()), rather than resting on a bare literal.
//   (e) NO dvh anywhere in either stylesheet — this surface bans it (on iOS dvh resolves to the LARGE
//       viewport, so a dvh-sized element overhangs before the keyboard is involved).
//   (f) no maximum-scale / user-scalable — suppressing pinch-zoom is an accessibility regression and
//       does not restore scale on blur anyway.
//
// ⛔ LORAMER_GUARD_ROOT — HANDLED, AND STATED BECAUSE ★GUARD-IGNORES-LORAMER-GUARD-ROOT IS OPEN. That
// defect is a guard resolving to the REAL tree while a throwaway proof believes it read a scratch one,
// which makes the RED half of "seen red" worthless. This guard (1) HONOURS LORAMER_GUARD_ROOT — the RED
// proof for this commit ran against a scratch tree and the findings came from THAT tree; (2) falls back
// MODULE-RELATIVE, never process.cwd(); (3) FAILS CLOSED — an unreadable file is a FAILURE, not a pass.
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const ROOT = process.env.LORAMER_GUARD_ROOT || resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const PAGE_TSX = 'src/app/dashboard-next/lora/LoraPageClient.tsx'
const PAGE_CSS = 'src/app/dashboard-next/lora/lora-page.module.css'
const THREAD_TSX = 'src/components/redesign/LoraThread.tsx'
const THREAD_CSS = 'src/components/redesign/lora-thread.module.css'
const findings = []

const read = (rel) => {
  try { return readFileSync(resolve(ROOT, rel), 'utf8') }
  catch (e) { findings.push(`UNREADABLE ${rel} under ROOT ${ROOT} — ${e.message}. A guard that cannot read its evidence FAILS; it does not pass.`); return null }
}
// Comments QUOTE the defective forms to teach them; stripping first is mandatory or the guard fails on
// its own documentation. "QUOTATION IS NOT ASSERTION" — banked twice on 2026-07-29.
const strip = (t) => t.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')

const pageTsx = read(PAGE_TSX)
const threadTsx = read(THREAD_TSX)
const pageCss = read(PAGE_CSS)
const threadCss = read(THREAD_CSS)

if (pageTsx) {
  const code = strip(pageTsx)

  // ── (a) BOTH EVENTS ───────────────────────────────────────────────────────────────────────────────
  const hasVv = /visualViewport/.test(code)
  if (!hasVv) {
    findings.push(`(a) ${PAGE_TSX} never reads window.visualViewport. The header is position:sticky against the LAYOUT viewport; the keyboard changes the VISUAL one, so without this the header detaches on a thumb-flick.`)
  } else {
    for (const evt of ['resize', 'scroll']) {
      if (!new RegExp(`addEventListener\\(\\s*['"]${evt}['"]`).test(code)) {
        findings.push(`(a) no visualViewport '${evt}' listener in ${PAGE_TSX}. BOTH are required: 'resize' fires when the keyboard opens/closes, 'scroll' fires when the visual viewport is flicked with the keyboard ALREADY UP — which is the failing gesture. One of the two fixes half the defect and looks fixed.`)
      }
    }
  }

  // ── (b) THE DISMISSAL PATH ────────────────────────────────────────────────────────────────────────
  if (!/(focusout|blur)/.test(code)) {
    findings.push(`(b) ${PAGE_TSX} has no focusout/blur path. developer.apple.com/forums/thread/800154 (iOS 26): visualViewport.offsetTop does NOT reset to 0 after keyboard dismissal, so 'resize' alone leaves the header displaced. This is an OPEN vendor bug, not defensive coding.`)
  }

  // ── (c) CLEANUP ───────────────────────────────────────────────────────────────────────────────────
  const added = (code.match(/addEventListener\(/g) || []).length
  const removed = (code.match(/removeEventListener\(/g) || []).length
  if (removed < added) {
    findings.push(`(c) ${PAGE_TSX} adds ${added} listener(s) and removes ${removed}. This page mounts and unmounts on every navigation, so an unremoved visualViewport listener keeps a detached header alive and firing.`)
  }
}

// ── (d) THE CAP IS DERIVED, NOT A BARE LITERAL ──────────────────────────────────────────────────────
if (threadCss && threadTsx) {
  const css = strip(threadCss)
  const tsx = strip(threadTsx)
  const wroteFromViewport = /--lora-composer-max/.test(tsx) && /visualViewport|vv\.height/.test(tsx)
  const consumed = /max-height\s*:\s*min\([^;]*--lora-composer-max/.test(css)
  if (!wroteFromViewport) {
    findings.push(`(d) ${THREAD_TSX} never writes --lora-composer-max from the visual viewport. Then the composer cap is 40vh and a 120px literal, neither of which shrinks when the keyboard opens, so on a short visible area the composer is most of what is left.`)
  }
  if (!consumed) {
    findings.push(`(d) .input's max-height does not consume --lora-composer-max inside a min(). It must be a min() term so the live value can only cap LOWER and can never raise the ceiling above the static ones.`)
  }
}

// ── (e) NO dvh · (f) NO ZOOM SUPPRESSION ────────────────────────────────────────────────────────────
for (const [rel, text] of [[PAGE_CSS, pageCss], [THREAD_CSS, threadCss]]) {
  if (!text) continue
  const code = strip(text)
  if (/\b\d+(\.\d+)?dvh\b/.test(code)) {
    findings.push(`(e) ${rel} uses dvh. This surface bans it: on iOS dvh resolves to the LARGE viewport while documentElement.clientHeight is the small one, so a dvh-sized element overhangs before the keyboard is even involved.`)
  }
  if (/maximum-scale|user-scalable/.test(code)) {
    findings.push(`(f) ${rel} references maximum-scale/user-scalable. That disables pinch-zoom for every user to hide one input's zoom — an accessibility regression — and iOS does not restore scale on blur either way. The fix is font-size >= 16px.`)
  }
}

if (findings.length) {
  console.error(`[chat-visual-viewport] FAIL — ${findings.length} finding(s):`)
  for (const f of findings) console.error(`  - ${f}`)
  process.exit(1)
}
console.log('[chat-visual-viewport] PASS — header driven from visualViewport on BOTH resize and scroll · focusout dismissal path present (Apple thread/800154) · every listener removed on unmount · composer cap derived from viewport height inside a min() · no dvh · no zoom suppression. ⛔ CSS/JS FACTS ONLY — this proves NO pixel; the thumb-flick and the clip are Gate-B on device (★CHAT-RENDER-MEASUREMENT-MISSING).')
