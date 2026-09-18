#!/usr/bin/env node
// LORAMER_ONE_CLICK_RUN_V1 — THE BUTTON'S STATES COME FROM THE SERVER'S RUN ROW, ONE BUTTON PER PLATFORM, DISABLED WHILE LIVE.
//
// SOURCE-LEVEL (the mounted render at phone width is tests/ui/backfill-button.spec.mjs, run by hand — no build guard can
// see a browser). This guard pins in ClientPage.tsx:
//   (a) the six Google state texts: 'Not started' · 'Queued — starts within a minute' · 'Importing — ' · 'Stopping…' ·
//       'Complete — back to ' · 'No progress for ' (stalled) + 'Last run failed — ' / 'Stopped — back to ' (needs-attention)
//   (b) the POST carries `&platform=`; there is one <button data-backfill-platform> per connected platform inside the map
//   (c) the google button's disabled binding includes the live run (googleRunLive) and the handler refuses while live
//   (d) the google poll's exit condition is the RUN's liveness (useEffect keyed on googleRunLive), never a 12-tick counter;
//       the other platforms keep their bounded poll
//   (e) the readout branch still names 'not-started' (readout-reads-walk-floor leg (d) stays true)
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const ROOT = process.env.LORAMER_GUARD_ROOT || process.cwd()
const findings = []
const check = (c, m) => { if (!c) findings.push(m) }
const read = (rel) => { try { return readFileSync(resolve(ROOT, rel), 'utf8') } catch (e) { findings.push(`UNREADABLE ${rel} — ${e.message}. A guard that cannot read its evidence FAILS.`); return '' } }
const PAGE = 'src/components/redesign/ClientPage.tsx'
const p = read(PAGE)
const stripped = p.replace(/\{\/\*[\s\S]*?\*\/\}/g, '').replace(/\/\*[\s\S]*?\*\//g, '').split('\n').filter((l) => !/^\s*\/\//.test(l)).join('\n')

for (const t of ["'Not started'", "'Queued — starts within a minute'", '`Importing — ', "'Stopping…'", "'Complete — back to '", '`No progress for ', "'Last run failed — '", "'Stopped — back to '"]) {
  check(stripped.includes(t), `(a) ${PAGE} lacks the state text ${t}`)
}
check(/&platform=' \+ encodeURIComponent\(platform\)/.test(stripped), `(b) ${PAGE}: the POST must carry &platform= (one button per platform names its platform)`)
const mapI = stripped.indexOf('bfPlatforms.map((pf)')
check(mapI !== -1 && stripped.indexOf('data-backfill-platform={pf}', mapI) !== -1, `(b) ${PAGE}: the per-platform <button data-backfill-platform={pf}> must be rendered inside the platform map`)
check(/disabled = busy \|\| !enabled \|\| \(pf === 'google' && googleRunLive\)/.test(stripped), `(c) ${PAGE}: the disabled binding must include the live google run`)
check(/if \(platform === 'google' && googleRunLive\) return/.test(stripped), `(c) ${PAGE}: the handler must refuse a google press while the run is live (no POST)`)
check(/const googleRunLive = !!bfStatus\.google\?\.run\?\.live/.test(stripped), `(c) ${PAGE}: liveness must come from the server's run row (bfStatus.google.run.live)`)
check(/useEffect\(\(\) => \{\s*if \(!googleRunLive\) return\s*const iv = setInterval\(\(\) => \{ loadBackfillStatus\(\) \}, 8000\)/.test(stripped) && /\}, \[googleRunLive\]\)/.test(stripped), `(d) ${PAGE}: the google poll must run while the run is live and stop when it leaves (keyed on googleRunLive), never a tick counter`)
check(/if \(n >= 12\) clearInterval\(iv\)/.test(stripped) && /\[anyOtherKicked\]\)/.test(stripped), `(d) ${PAGE}: the other platforms keep their bounded ~1.5 min poll`)
check(/state === 'not-started'/.test(stripped), `(e) ${PAGE} must still branch on state 'not-started'`)
check(/run\.stalled/.test(stripped) && /run\.steps === 0/.test(stripped) && /run\.endKind === 'failed'/.test(stripped) && /run\.endKind === 'stopped'/.test(stripped) && /run\.status === 'stopping'/.test(stripped), `(a) ${PAGE}: the six states must be derived from run.live / steps / stalled / status / endKind`)
check(/progress\?\.daysNoLongerOwed/.test(stripped) && /progress\?\.denominator/.test(stripped), `(a) ${PAGE}: the meter must read progress.daysNoLongerOwed of progress.denominator`)

if (findings.length) {
  console.error(`[backfill-button-states] FAIL — ${findings.length} finding(s):`)
  for (const f of findings) console.error('  • ' + f)
  process.exit(1)
}
console.log('[backfill-button-states] PASS — one button per platform, six Google states from the server run row, disabled while live, the google poll keyed on the run\'s liveness.')
