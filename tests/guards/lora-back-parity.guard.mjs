#!/usr/bin/env node
// LORAMER_LORA_BACK_SOFT_NAV_V1 — THE CHEVRON AND THE BROWSER'S OWN BACK MUST NOT DIVERGE.
//
// ⛔ WHAT THIS PROTECTS, SETTLED ON DEVICE 2026-08-06 RATHER THAN ARGUED. Russ tapped three times: the
// CHEVRON landed on All Clients; the PHONE'S OWN BACK GESTURE landed on the client page. **Two
// destinations for one intent** — which is how a user learns not to trust a control, and it is worse
// than a control that plainly does nothing.
//
// ⛔ THE CAUSE WAS A SIGNAL THAT ANSWERS A DIFFERENT QUESTION THAN THE ONE ASKED. `document.referrer`
// describes the DOCUMENT LOAD, not the route. A Next client-side navigation never touches it, so
// arriving via `openLora`'s `router.push` leaves it at whatever loaded the document — EMPTY for a typed
// URL or a fresh tab — and the gate concluded "not from our app" while a perfectly good history entry
// sat right there. The browser's own back button, which reads the real history stack, was right and our
// button was wrong.
//
// ⛔ WHAT CANNOT BE ASSERTED HERE, STATED SO A GREEN IS NOT OVER-READ: this guard CANNOT prove the two
// destinations agree at runtime — that needs a real history stack, which is a device observation and is
// how this was settled in the first place. What it CAN prove is that the branch is no longer decided by
// the signal that provably cannot see a soft navigation, and that the fallback has not quietly become
// the whole answer. A structural guard for a behavioural property; the limit is named, not implied.
import { readFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = process.env.LORAMER_GUARD_ROOT || resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const read = (p) => { try { return readFileSync(resolve(ROOT, p), 'utf8') } catch { return '' } }
const findings = []

const PAGE = 'src/app/dashboard-next/lora/LoraPageClient.tsx'
// ⛔ COMMENTS STRIPPED. The file now carries a long prose account of the defect, INCLUDING the words
// `document.referrer` and the reasoning about it. A guard reading the quotation instead of the code
// would report the very defect it exists to prevent — bitten three times in the last two days.
const strip = (s) => s.split('\n').filter((l) => !l.trim().startsWith('//') && !l.trim().startsWith('*') && !l.trim().startsWith('/*')).join('\n')

const src = strip(read(PAGE))
if (!src) {
  findings.push(`${PAGE} is unreadable — the exit control cannot be checked.`)
} else {
  // Isolate the back button's handler: from the fallback declaration to the router call.
  const handler = (src.match(/const fallback = [\s\S]{0,1600}?router\.push\(fallback\)/) || [''])[0]
  if (!handler) {
    findings.push(`(a) ${PAGE}: could not locate the back-button handler (fallback → router.push). Either the exit control was restructured or this guard is pointed at the wrong file — re-verify by hand, do not assume green.`)
  } else {
    // ── (a) THE SOFT-NAVIGATION SIGNAL MUST BE PRESENT ─────────────────────────────────────────────
    const hasNavTiming = /getEntriesByType\(\s*['"]navigation['"]\s*\)/.test(handler)
    if (!hasNavTiming) {
      findings.push(`(a) the back handler does not consult the Navigation Timing entry. \`document.referrer\` DESCRIBES THE DOCUMENT LOAD, NOT THE ROUTE — a Next soft navigation never updates it, so arriving here via router.push leaves it empty and the gate takes the fallback while a real history entry exists. MEASURED ON DEVICE 2026-08-06: the chevron went to All Clients and the phone's own back gesture went to the client page. Compare the document's load URL against location.href instead.`)
    }
    // ── (b) referrer MUST NOT BE THE SOLE DETERMINANT ──────────────────────────────────────────────
    const usesReferrer = /document\.referrer/.test(handler)
    if (usesReferrer && !hasNavTiming) {
      findings.push(`(b) \`document.referrer\` is the ONLY signal deciding the branch. It is correct for a HARD navigation from inside the app and blind to every soft one, which is the exact defect. Keep it — it is right for its case — but it may never decide alone.`)
    }
    // ── (c) THE TWO SIGNALS MUST BE COMBINED PERMISSIVELY ──────────────────────────────────────────
    // Either route in is a legitimate in-app arrival, so this is an OR. An AND would be strictly worse
    // than the original: it would take the fallback unless BOTH happened to be true.
    if (hasNavTiming && usesReferrer && !/\|\|/.test(handler)) {
      findings.push(`(c) the two arrival signals are not combined with \`||\`. A soft navigation and a same-origin referrer are each SUFFICIENT evidence of an in-app arrival; requiring both would take the fallback more often than the code this replaced.`)
    }
    // ── (d) router.back() MUST STILL BE THE IN-APP PATH ────────────────────────────────────────────
    // The tempting "fix" is to point the fallback at a per-client route and stop asking the question.
    // That masks the gate: the chevron would land somewhere plausible while still ignoring real history,
    // and would STILL diverge from the browser's own back.
    if (!/router\.back\(\)/.test(handler)) {
      findings.push(`(d) the back handler no longer calls router.back(). Repointing the fallback instead of fixing the gate makes the chevron land somewhere plausible while still ignoring the real history stack — it would still diverge from the browser's own back, just less visibly.`)
    }
    // ── (e) THE FALLBACK MUST SURVIVE ──────────────────────────────────────────────────────────────
    if (!/router\.push\(fallback\)/.test(handler)) {
      findings.push(`(e) the cold-entry fallback is gone. On a genuinely fresh load there is nothing to go back TO and a bare router.back() silently does nothing — which is what a trap feels like, and is why the fallback exists.`)
    }
  }
}

if (findings.length) {
  console.error(`[lora-back-parity] FAIL — ${findings.length} finding(s):`)
  for (const f of findings) console.error(`  · ${f}`)
  process.exit(1)
}
console.log('[lora-back-parity] PASS — the exit gate reads BOTH the Navigation Timing entry (soft navigation) and a same-origin referrer (hard navigation), combined permissively, with router.back() for in-app history and the fallback intact for a cold entry. ⛔ NOT ASSERTED: that the two destinations agree at runtime — that is a device observation. LORAMER_LORA_BACK_SOFT_NAV_V1')
