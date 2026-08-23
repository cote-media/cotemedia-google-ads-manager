// LORAMER_QUEUE_TAG_MATCHES_TEXT_V1 — the untokened-item baseline. SHRINK-ONLY.
//
// ⛔ THIS IS DATA, NOT A MUTE. Same posture as `frozen-cursors.baseline.mjs` and
// `completion-claims.baseline.mjs`: the number may FALL freely and may NEVER RISE. A rise means new items
// entered LORAMER_QUEUE_OF_RECORD.md carrying no ★ or LORAMER_*_V token, which makes them invisible to the
// digest's §L topic index — the enforcer that exists because ESSENCE law 7 (the claim-of-novelty gate) is a
// rule about behaviour and rules about behaviour are the ones that fail.
//
// ⛔ THE FIX FOR A RISE IS NEVER TO RAISE THIS NUMBER. It is to mint a token on the item that lacks one. The
// digest says so itself, in §L's own output: "An untokened decision is invisible to the enforcer; the fix is
// to mint a token when banking, not to widen the matcher."
//
// WHEN THE NUMBER FALLS: lower it here in the same commit that earned the gain, or the ratchet does not hold.
//
// MEASURED 2026-08-20 against HEAD by the guard itself (`node tests/guards/queue-tag-matches-text.guard.mjs`).
// Cross-check, independently computed at the 2026-08-19/20 wrap and printed in the digest's §L:
//   "265 QUEUE items carry NO token at all, so they cannot be found this way."
export const UNTOKENED_BASELINE = 263

// ── CONTRADICTIONS AWAITING A HUMAN READ ──────────────────────────────────────────────────────────────────
// ⛔ THIS IS NOT A MUTE AND IT IS NOT "THE GUARD IS TOO NOISY". It is eleven items whose tag and prose
// disagree in ways a regex has no standing to resolve, listed by name so nobody has to re-derive which. The
// count may FALL freely and may NEVER RISE: a rise means a NEW contradiction entered the queue, which is
// exactly what this guard exists to catch.
//
// THE ELEVEN, MEASURED 2026-08-20, WITH WHY EACH IS HELD RATHER THAN FIXED:
//   :125  ★WALK-REBUILD-STEPS-8-16          — header says "THE UNBUILT HALF … NOTHING IS WIRED". OPEN is true;
//                                             the match came from body prose. False positive.
//   :165  ★GAQL-OP-COUNT-DISCREPANCY        — "HALF-CLOSED": request count settled, operations count "NOT OURS
//                                             to settle". OPEN is true for the half that remains.
//   :237  ★RANGELAP-RATCHET-SWEEP           — tag reads `shipped [LC]`. ⛔ `shipped` is NOT in statusIsDone's
//   :239  ★DEMO-FIXTURE-META-REAUTH         — tag `decided [LC]`.        terminal vocabulary (resolved|done|
//   :257  ★GOOGLE-SEARCH-TERM-RETENTION-WALL— tag `**answered … [LC]**`.  closed), so all three count OPEN
//                                             forever. A vocabulary gap, not a tagging error — see
//                                             ★FILLDONE-TOLERATES-ONE-WORD-TITLES, which owns the fix.
//   :314  ★SHOPIFY-API-VERSION-SUNSET       — header "CLOSED 2026-07-26" but the body still owes "restore the
//                                             pin BEFORE writing the bulk adapter". Closed-with-a-follow-on.
//   :695  #14 Shopify dead refresh token    — sub-item (a) CLOSED, sub-item (b) "LOAD-BEARING. STAYS". Half.
//   :867  1. CLIENT-PROFILE STATE BLEED     — "✅ CLOSED 2026-07-16 — CAUSE FIXED + GATE-B PASSED" with an
//                                             `open [LC]` tail. Reads as a TRUE contradiction; held only
//                                             because it is a master-audit numbered line, not a ★ item.
//   :921  ★ UI-OVERFLOW (Bug 1)             — header says "OPEN. NOT FIXED." The match came from a FAILED-
//                                             THEORY line ("two fixes shipped … NEITHER resolved it").
//                                             ⇒ closure words inside a description of FAILED work.
//   :935  ★ DEPLOY-WEBHOOK                  — "RESOLVED (transient); STAYS OPEN pending recurrence",
//                                             `open-watch [LC]`. Deliberately open.
//   :988  W-FILL#7                          — the fillDone multi-word-title bug. Owned by
//                                             ★FILLDONE-TOLERATES-ONE-WORD-TITLES.
//
// ⇒ ROUGHLY: 4 false positives the matcher should eventually learn (125, 165, 921, 935), 4 vocabulary/format
// bugs owned by a queue item (237, 239, 257, 988), 3 genuine judgement calls for Russ (314, 695, 867).
export const CONTRADICTION_BASELINE = 11
