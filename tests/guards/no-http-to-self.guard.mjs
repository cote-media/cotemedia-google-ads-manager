#!/usr/bin/env node
// LORAMER_NO_HTTP_TO_SELF_V1 — NO SCHEDULED OR BACKGROUND PATH MAY FETCH THIS DEPLOYMENT'S OWN URL.
//
// ⛔ THE TWO WALLS, BOTH MEASURED 2026-09-17:
//   1. Vercel's loop detector (`x-vercel-id` "allows Vercel to automatically prevent infinite loops") refuses the
//      fourth nested self-request with HTTP 508 INFINITE_LOOP_DETECTED. No threshold is published.
//   2. This project runs Vercel Authentication in "Standard Protection" (`prod_deployment_urls_and_all_previews`,
//      read from the project as `all_except_custom_domains`): a request to a *.vercel.app deployment URL — which is
//      exactly the origin a CRON-invoked function sees in `request.url` — is answered `302 → vercel.com/sso-api` and
//      then an HTTP 200 login page. It is not an error. The pump read it as a fire that "asked nothing" for 159 steps.
// A background path that fetches its own deployment therefore fails SILENTLY on the second wall and LOUDLY on the
// first. The run makes no HTTP request to itself at all: the fire is called in-process (universe-run-fire.ts).
//
// WHAT THIS GUARD DOES: in every scheduled or background file (src/app/api/cron/**, src/lib/backfill/**), a `fetch(`
// whose URL is built from the request's own origin, from `origin`, or from VERCEL_URL / VERCEL_BRANCH_URL is a
// finding. Comments are stripped first. The one allowlisted file is named with WHY, and the allowlist may only
// shrink.
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { resolve, join } from 'node:path'

const ROOT = process.env.LORAMER_GUARD_ROOT || process.cwd()
const findings = []
const read = (rel) => { try { return readFileSync(resolve(ROOT, rel), 'utf8') } catch { return '' } }
const strip = (src) => src.replace(/\/\*[\s\S]*?\*\//g, '').split('\n').filter((l) => !/^\s*(\/\/|\*)/.test(l)).join('\n')
const walk = (dir, out = []) => {
  let entries = []
  try { entries = readdirSync(resolve(ROOT, dir)) } catch { return out }
  for (const e of entries) {
    const p = join(dir, e)
    const st = statSync(resolve(ROOT, p))
    if (st.isDirectory()) walk(p, out); else if (/\.(ts|tsx)$/.test(e)) out.push(p)
  }
  return out
}

// ⛔ ALLOWLIST — REMOVE-ONLY. Each entry says WHY the fetch cannot meet either wall.
const ALLOWED = new Map([
  ['src/lib/backfill/kickoff.ts', 'the connect/backfill kick: its `origin` is the USER\'s request host (a browser on the custom domain, which Standard Protection exempts), it is invoked only from user-facing routes (clients/*, shopify/ga/woocommerce callbacks — never from a cron), and it is ONE hop deep. It is not a scheduled path.'],
])

// A file fetches its own deployment when it calls fetch() AND builds a URL from its own origin — the origin
// parameter, the request's origin, or the VERCEL_URL / VERCEL_BRANCH_URL system variables. Two lines apart counts:
// kickoff.ts builds `const url = \`${origin}/api/…\`` and fetches it on the next line.
const OWN_ORIGIN = /\$\{\s*origin\s*\}|new URL\(request\.url\)\.origin|process\.env\.VERCEL_(URL|BRANCH_URL)\b/
const fetchesSelf = (src) => /\bfetch\s*\(/.test(src) && OWN_ORIGIN.test(src)
for (const f of [...walk('src/app/api/cron'), ...walk('src/lib/backfill')]) {
  const src = strip(read(f))
  if (!fetchesSelf(src)) continue
  if (ALLOWED.has(f)) continue
  const line = src.split('\n').findIndex((l) => OWN_ORIGIN.test(l)) + 1
  findings.push(`${f}:${line} fetches this deployment's own URL from a scheduled/background path. A cron-invoked function's origin is the *.vercel.app deployment URL, which Vercel Authentication answers with a login page (HTTP 200, not an error); a nested self-request is refused at the fourth hop with 508. Call the handler in-process (see universe-run-fire.ts), or name this file here with a reason that survives both walls.`)
}
// the allowlist may only shrink: a dead entry is cover for the next violation
for (const [f, why] of ALLOWED) {
  if (!read(f)) findings.push(`allowlist entry ${f} no longer exists — remove it (${why.slice(0, 40)}…)`)
  else if (!fetchesSelf(strip(read(f)))) findings.push(`allowlist entry ${f} no longer fetches its own origin — remove the entry so it cannot shelter a future one.`)
}
// and the run's chain must be HTTP-free end to end
for (const f of ['src/lib/backfill/universe-run-step.ts', 'src/lib/backfill/universe-run-pump.ts', 'src/lib/backfill/universe-run-fire.ts', 'src/app/api/cron/universe-run-pump/route.ts']) {
  const src = strip(read(f))
  if (!src) { findings.push(`${f} is missing — the run's chain is not where this guard expects it.`); continue }
  if (/\bfetch\s*\(/.test(src)) findings.push(`${f} calls fetch(). The run's chain makes no HTTP request at all — the fire is called in-process.`)
}
if (!/import \{ GET as resumeFire \} from '@\/app\/api\/cron\/universe-resume\/route'/.test(read('src/lib/backfill/universe-run-fire.ts'))) {
  findings.push(`universe-run-fire.ts does not import the resumer's GET handler — the fire must be the existing handler, called in-process, not a copy and not a URL.`)
}

if (findings.length) {
  console.error(`[no-http-to-self] FAIL — ${findings.length} finding(s):`)
  for (const f of findings) console.error(`  - ${f}`)
  process.exit(1)
}
console.log(`[no-http-to-self] PASS — no scheduled or background path fetches this deployment's own URL (${ALLOWED.size} allowlisted with reason) · the run's chain is HTTP-free and the fire is the resumer's handler called in-process.`)
