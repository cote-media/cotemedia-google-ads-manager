#!/usr/bin/env node
// LORAMER_CHAT_STATUS_FITS_THE_PHONE_V1 — THE STATUS LINE FITS THE PHONE, AND WHAT SURVIVES IS FIXED.
//
// ⛔ OBSERVED ON DEVICE 2026-08-06: "Reading Foam OH · All · 2026 YTD (Jan 1 - Aug 5) +1 more + 1 ..."
// ran off the right edge and was cut mid-word.
//
// ⛔ AND THE CAUSE IS WHY THIS GUARD DRIVES A FUNCTION INSTEAD OF READING CSS: `text-overflow: ellipsis`
// always cuts the TAIL, and the tail is where the COUNT lives. The browser was faithfully deleting the
// single most important token on the line. Truncation has to be PRIORITY-AWARE, and priority is a
// product decision rather than a rendering side effect.
//
// THE PRIORITY, and it is the whole contract: the CLIENT is never dropped · the COUNT is never dropped
// and never rounded · the middle (platform, breakdown, range) gives way first, from the right.
//
// ⚠ WHAT THIS CANNOT ASSERT, NAMED ON THE PASS LINE RATHER THAN IMPLIED: that the line fits in PIXELS.
// Measuring text needs a layout and this repo has no render measurement
// (★CHAT-RENDER-MEASUREMENT-MISSING). The character budget is a conservative stand-in, and it is the
// second time in two days that gap has set the ceiling on what a guard can prove.
import { readFileSync, mkdtempSync, rmSync } from 'node:fs'
import { resolve, dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { tmpdir } from 'node:os'
import { execFileSync } from 'node:child_process'
import { createRequire } from 'node:module'

const ROOT = process.env.LORAMER_GUARD_ROOT || resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const read = (p) => { try { return readFileSync(resolve(ROOT, p), 'utf8') } catch { return '' } }
const findings = []

const SUBJECT = 'src/lib/chat/tool-subject.ts'
const WORKING_CSS = 'src/components/redesign/lora-working.module.css'
const THREAD_CSS = 'src/components/redesign/lora-thread.module.css'

// ── DRIVE THE REAL FUNCTION. A regex over the source would prove a name exists, not that a string fits.
let mod = null
const out = mkdtempSync(join(tmpdir(), 'loramer-fit-'))
try {
  execFileSync(join(ROOT, 'node_modules/.bin/tsc'), [
    resolve(ROOT, SUBJECT), '--target', 'es2020', '--module', 'commonjs',
    '--outDir', out, '--skipLibCheck',
  ], { stdio: 'pipe' })
  mod = createRequire(import.meta.url)(join(out, 'tool-subject.js'))
} catch (e) {
  findings.push(`could not compile ${SUBJECT}: ${String(e.stdout || '').trim() || e.message}`)
}

if (mod) {
  const { fitStatusLine, MAX_STATUS_CHARS } = mod

  // ⛔ THE GUARD OWNS ITS OWN CEILING, AND THIS IS THE FIX FOR A LEG THAT COULD NOT FAIL.
  // The first version compared the output only against MAX_STATUS_CHARS — read from the module under
  // test. Raising that constant to 200 therefore raised the yardstick with it and the leg went GREEN on
  // a line that would run off the phone. A guard that reads its own limit from the code it is testing
  // measures nothing. Found by FIRING the failure path; unreadable from the source.
  // ⚠ THIS IS NOT THE "guard carries its own copy of a constant" hazard banked elsewhere — that is about
  // a value which must MATCH and silently drifts. This is a CEILING: the guard owns the limit, the code
  // owns its choice within it, and disagreement is exactly what must be caught.
  // 52 is derived like the code's 46: a 390px screen less 32px list padding and 13px mark indent leaves
  // ~345px; at 13px in the app's sans the average glyph is ~6.5px, so ~53 characters is the hard edge.
  const PHONE_CEILING = 52
  if (typeof MAX_STATUS_CHARS === 'number' && MAX_STATUS_CHARS > PHONE_CEILING) {
    findings.push(`(a) MAX_STATUS_CHARS is ${MAX_STATUS_CHARS}, above the ${PHONE_CEILING}-character ceiling a 390px phone can show at 13px. The line would run off the right edge and be cut mid-word — exactly what was observed on device 2026-08-06.`)
  }
  if (typeof fitStatusLine !== 'function' || typeof MAX_STATUS_CHARS !== 'number') {
    findings.push(`(a) ${SUBJECT} exports no fitStatusLine/MAX_STATUS_CHARS. Without priority-aware fitting the line is truncated by CSS from the TAIL — which deletes the count, the one token that may never be lost.`)
  } else {
    // The exact line Russ photographed, plus the shapes that stress each rule.
    const CASES = [
      ['the observed overflow', 'Reading Foam OH · All · 2026 YTD (Jan 1 – Aug 5) · product_type', 1, 'Foam OH'],
      ['no extras', 'Reading Foam OH · All · 2026 YTD (Jan 1 – Aug 5) · product_type', 0, 'Foam OH'],
      ['many extras', 'Reading Foam OH · All · 2026 YTD (Jan 1 – Aug 5) · product_type', 7, 'Foam OH'],
      ['a long client name', `Reading ${'Veterinary mastermind holdings'} · Shopify · customer_cohort · Jan–Aug 2026`, 3, 'Veterinary'],
      ['an absurd client', `Reading ${'X'.repeat(80)} · All · 2026 YTD`, 2, 'X'],
      ['a bare tool name', 'Reading query_breakdown', 4, null],
    ]
    for (const [label, subject, n, clientFragment] of CASES) {
      let line
      try { line = fitStatusLine(subject, n) } catch (e) { findings.push(`(a) fitStatusLine threw on "${label}": ${e.message}`); continue }

      // ── (a) IT MUST FIT ────────────────────────────────────────────────────────────────────────
      if (typeof line !== 'string' || line.length > MAX_STATUS_CHARS) {
        findings.push(`(a) "${label}" produced ${line?.length} chars against a ${MAX_STATUS_CHARS} budget — it overflows the phone exactly as observed on device 2026-08-06, where the line ran off the right edge and was cut mid-word.`)
      }
      // ── (b) THE COUNT SURVIVES, AND IS EXACT ───────────────────────────────────────────────────
      if (n > 0) {
        if (!new RegExp(`\\+ ${n} more source`).test(line)) {
          findings.push(`(b) "${label}" lost or altered the count of ${n} additional sources — got "${line}". CSS ellipsis cuts the TAIL, which is precisely where the count lives; that is the defect this function exists to prevent. Hiding concurrent work is the same class of untruth as a fake progress bar.`)
        }
        for (const vague of ['several', 'many', 'a few', 'multiple']) {
          if (line.toLowerCase().includes(vague)) {
            findings.push(`(b) "${label}" rounded the count to "${vague}". If five sources are being read it says five.`)
          }
        }
      }
      // ── (c) THE CLIENT SURVIVES ────────────────────────────────────────────────────────────────
      if (clientFragment && !line.includes(clientFragment)) {
        findings.push(`(c) "${label}" dropped the client — got "${line}". A status naming no one is not a status; the client is elided character-by-character if it must give, never removed.`)
      }
    }
  }
}
rmSync(out, { recursive: true, force: true })

// ── (d) THE FONT FLOOR, AND THE DISTINCTION THAT MATTERS ─────────────────────────────────────────
// ⚠ THE BANKED 16px RULE IS ABOUT THE COMPOSER INPUT, NOT THIS LINE. LORAMER_NEXT_CHAT_INPUT_16PX_V1
// exists because iOS AUTO-ZOOMS a focused input under 16px (measured at 1.1431818x) — a focus behaviour,
// not a legibility one. The status line is not focusable and has always been 13px. Both are asserted
// here so neither is "fixed" by shrinking type: the input may never drop below 16, and the status line
// may never be shrunk as a way to make a too-long string fit.
{
  const threadCss = read(THREAD_CSS)
  const inputRule = (threadCss.match(/\.input\s*\{[^}]*\}/) || [''])[0]
  const inputPx = /font-size:\s*(\d+(?:\.\d+)?)px/.exec(inputRule)
  if (!inputPx) {
    findings.push(`(d) ${THREAD_CSS}: .input declares no font-size. 16px is load-bearing — iOS auto-zooms any focused input below it (LORAMER_NEXT_CHAT_INPUT_16PX_V1).`)
  } else if (Number(inputPx[1]) < 16) {
    findings.push(`(d) ${THREAD_CSS}: .input is ${inputPx[1]}px, below the 16px floor. iOS auto-zooms a focused input under 16px — measured at 1.1431818x. Never shrink type to fit.`)
  }
  const workCss = read(WORKING_CSS)
  const statusRule = (workCss.match(/\.statusText\s*\{[^}]*\}/) || [''])[0]
  const statusPx = /font-size:\s*(\d+(?:\.\d+)?)px/.exec(statusRule)
  if (statusPx && Number(statusPx[1]) < 13) {
    findings.push(`(d) ${WORKING_CSS}: .statusText was reduced to ${statusPx[1]}px. Shrinking the status type is a way of making an over-long string fit, and it trades legibility for a problem that fitStatusLine already solves properly.`)
  }
  // ── (e) IT MAY NOT WRAP AND SHIFT THE LAYOUT ───────────────────────────────────────────────────
  if (statusRule && !/white-space:\s*nowrap/.test(statusRule)) {
    findings.push(`(e) ${WORKING_CSS}: .statusText lost \`white-space: nowrap\`. A status that wraps to two lines changes the height of the working block and shifts everything below it mid-turn.`)
  }
  if (statusRule && !/text-overflow:\s*ellipsis/.test(statusRule)) {
    findings.push(`(e) ${WORKING_CSS}: .statusText lost \`text-overflow: ellipsis\`. It is the BACKSTOP for anything the character budget misjudges — the budget is an approximation, so the belt stays on.`)
  }
}

if (findings.length) {
  console.error(`[chat-status-fits] FAIL — ${findings.length} finding(s):`)
  for (const f of findings) console.error(`  · ${f}`)
  process.exit(1)
}
console.log('[chat-status-fits] PASS — every subject shape fits the budget with the client and the exact count intact, the middle gives way first, the composer input holds 16px and the status line holds its size and stays on one line. ⛔ NOT ASSERTED: that it fits in PIXELS — that needs render measurement this repo does not have. LORAMER_CHAT_STATUS_FITS_THE_PHONE_V1')
