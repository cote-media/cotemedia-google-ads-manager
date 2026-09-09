#!/usr/bin/env node
// LORAMER_LOOKBACK_LANE_V1 — THE LOOKBACK SLOT SHIPS OBSERVE-ONLY, AND THE FLIP TO 'publish' IS A RULING, NOT AN EDIT.
//
// The route declares ONE named constant, LOOKBACK_SLOT_MODE, with exactly two values:
//   'observe' — the second slot DERIVES boundary windows and LOGS them; it sends nothing and charges nothing.
//   'publish' — the second slot executes them under lane 'lookback' (the first attesting terminal lands).
// STOP-and-confirm 2 (QUEUE ★LOOKBACK-LANE-OWNS-PROMOTION (7)) sits exactly on that flip. So a 'publish' value
// must carry, ON THE SAME LINE OR THE LINE ABOVE, a dated ruling cite — `DECISIONS … 2026-MM-DD` or
// `ruling … 2026-MM-DD` — naming the decision that authorised it. Without the cite the build is red: the flip
// cannot happen by a stray edit, a merge, or a "while I'm here".
// ⛔ THIS GUARD PROVES THE ARTIFACT (a cite is present), never that a ruling happened — the same honest limit
// as the protocol gate. Its self-test plants both shapes and must see the uncited one red.
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const ROOT = process.env.LORAMER_GUARD_ROOT || process.cwd()
const ROUTE = process.env.LORAMER_RESUME_ROUTE || 'src/app/api/cron/universe-resume/route.ts'
const DECL = /^[ \t]*(?:export\s+)?const\s+LOOKBACK_SLOT_MODE\s*(?::\s*[^=]+)?=\s*'(observe|publish)'/m
const CITE = /(DECISIONS|ruling)[^\n]{0,160}?20\d\d-\d\d-\d\d|20\d\d-\d\d-\d\d[^\n]{0,160}?(DECISIONS|ruling)/i

export function verdictFor(src) {
  const lines = src.split('\n')
  const idx = lines.findIndex((l) => DECL.test(l))
  if (idx === -1) {
    const anyRef = /LOOKBACK_SLOT_MODE/.test(src)
    return { ok: false, why: anyRef
      ? `LOOKBACK_SLOT_MODE is referenced but not declared as \`const LOOKBACK_SLOT_MODE = 'observe' | 'publish'\` on one line — the gate reads the declaration, and it cannot find one.`
      : `LOOKBACK_SLOT_MODE is not declared — the lookback slot has NO GATE between observe and publish.` }
  }
  const value = lines[idx].match(DECL)[1]
  if (value === 'observe') return { ok: true, why: `LOOKBACK_SLOT_MODE = 'observe' (${ROUTE}:${idx + 1}) — the slot derives and logs; nothing is sent.` }
  const here = lines[idx], above = idx > 0 ? lines[idx - 1] : ''
  if (CITE.test(here) || CITE.test(above)) return { ok: true, why: `LOOKBACK_SLOT_MODE = 'publish' with a dated ruling cite beside it (${ROUTE}:${idx + 1}).` }
  return { ok: false, why: `LOOKBACK_SLOT_MODE = 'publish' at ${ROUTE}:${idx + 1} WITHOUT a dated ruling cite on that line or the line above. The flip is STOP-and-confirm 2; cite the DECISIONS ruling and its date beside the value or set it back to 'observe'.` }
}

// ── SELF-TEST ─────────────────────────────────────────────────────────────────────────────────────────
const cases = [
  { src: "const LOOKBACK_SLOT_MODE = 'observe' as 'observe' | 'publish'", want: true },
  { src: "const LOOKBACK_SLOT_MODE = 'publish' as 'observe' | 'publish'", want: false },
  { src: "// DECISIONS LORAMER_SESSION_2026_09_05_RULINGS (x) — 2026-09-30 flip\nconst LOOKBACK_SLOT_MODE = 'publish' as 'observe' | 'publish'", want: true },
  { src: "const LOOKBACK_SLOT_MODE = 'publish' as 'observe' | 'publish' // ruling: DECISIONS (u) 2026-09-08", want: true },
  { src: 'const nothingHere = 1', want: false },
]
for (const c of cases) {
  const v = verdictFor(c.src)
  if (v.ok !== c.want) {
    console.error(`✗ lookback-slot-mode-is-gated SELF-TEST FAILED — fixture ${JSON.stringify(c.src.slice(0, 60))} expected ok=${c.want}, got ok=${v.ok} (${v.why})`)
    process.exit(2)
  }
}

let src = ''
try { src = readFileSync(resolve(ROOT, ROUTE), 'utf8') } catch (e) {
  console.error(`✗ lookback-slot-mode-is-gated CANNOT RUN — ${ROUTE} unreadable (${e.message}).`)
  process.exit(2)
}
const v = verdictFor(src)
if (!v.ok) {
  console.error(`✗ LOOKBACK-SLOT-MODE-IS-GATED FAILED — ${v.why}`)
  console.error('  ⇒ SPEC: QUEUE ★LOOKBACK-LANE-OWNS-PROMOTION (7) — TWO STOP-and-confirms: before the migration, and before the first attesting terminal lands (this flip).')
  process.exit(1)
}
console.log(`[lookback-slot-mode-is-gated] PASS — ${v.why} (5/5 self-test fixtures).`)
