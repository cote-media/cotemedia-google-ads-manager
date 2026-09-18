#!/usr/bin/env node
// LORAMER_ONE_CLICK_RUN_V1 — THE MOUNTED RENDER, AT PHONE WIDTH, FOR THE SIX BACKFILL STATES. RUN BY HAND:
//   npm run dev            (another terminal, port 3000)
//   node tests/ui/backfill-button.spec.mjs
// Never part of `npm run guard` (needs a live dev server and the local NEXTAUTH_SECRET). The UI law
// (LORAMER_UI_FLIGHT_GATE_A_MOUNTS_V1): a -next UI flight's Gate-A mounts the component at a phone-shaped viewport —
// a render loop or a clipped state is invisible to source guards by construction.
//
// FIXTURES: /api/backfill/status is answered at the payload boundary with a scripted platforms.google for each state;
// /api/clients/backfill is answered with { action: 'existing', run } and COUNTED (a second click while live must issue
// no POST). Everything else is real: the dev server, the session, the client's other data.
import { chromium } from '@playwright/test'
import { loadLocalEnv, sessionTokenFor, phoneContext } from '../browser/session.mjs'

loadLocalEnv()
const BASE = process.env.GATEA_BASE || 'http://localhost:3000'
const OWNER = process.env.GATEA_OWNER || 'cotebrandmarketing@gmail.com'
const CLIENT = process.env.GATEA_CLIENT || '957d484e-d0c4-4dd0-b382-d8499d556252' // PROOF-TARGET DEFAULT (DECISIONS): a client with real data; overridable
const results = []
const ok = (name, pass, detail = '') => { results.push({ name, pass, detail }); console.log(`  ${pass ? 'PASS' : '⛔ FAIL'}  ${name}${detail ? ' — ' + detail : ''}`) }

const base = { earliestDate: '2022-03-05', complete: false, state: 'partial', sealed: 10, catalogSize: 349, inception: '2022-03-04', progress: { daysNoLongerOwed: null, denominator: 578642 }, stalled: false }
const run = (o) => ({ status: 'running', steps: 3, requestsOpened: 120, daysNoLongerOwed: 4200, startedAt: '2026-09-18T15:00:00Z', lastStepAt: '2026-09-18T15:58:00Z', finishedAt: null, stopReason: null, endKind: null, live: true, stalled: false, stalledForMinutes: null, ...o })
const STATES = {
  'not-started': { google: { ...base, state: 'not-started', earliestDate: null, inception: null, run: null, progress: { daysNoLongerOwed: null, denominator: null } }, expect: /Not started/, enabled: true },
  queued: { google: { ...base, run: run({ steps: 0, daysNoLongerOwed: 0 }), progress: { daysNoLongerOwed: 0, denominator: 578642 } }, expect: /Queued — starts within a minute/, enabled: false },
  importing: { google: { ...base, run: run({}), progress: { daysNoLongerOwed: 4200, denominator: 578642 } }, expect: /Importing — 4,200 of 578,642 days/, enabled: false },
  stopping: { google: { ...base, run: run({ status: 'stopping' }) }, expect: /Stopping…/, enabled: false },
  complete: { google: { ...base, state: 'complete', complete: true, sealed: 349, run: run({ status: 'done', finishedAt: '2026-09-18T15:59:00Z', stopReason: 'the lane reached its floor — nothing is owed above inception', endKind: 'floor', live: false }) }, expect: /Complete — back to 2022-03-05/, enabled: true },
  failed: { google: { ...base, run: run({ status: 'failed', finishedAt: '2026-09-17T18:50:35Z', stopReason: 'step reported a fatal condition: step returned HTTP 508: null', endKind: 'failed', live: false }) }, expect: /Last run failed — step reported a fatal condition/, enabled: true },
  stalled: { google: { ...base, stalled: true, run: run({ stalled: true, stalledForMinutes: 23, lastStepAt: '2026-09-18T15:30:00Z' }) }, expect: /No progress for 23 min/, enabled: false },
}

const token = await sessionTokenFor(OWNER)
const browser = await chromium.launch()
for (const [name, fx] of Object.entries(STATES)) {
  console.log(`\n── ${name} ──`)
  const ctx = await phoneContext(browser, token)
  const page = await ctx.newPage()
  const counts = { status: 0, post: 0 }
  await page.route('**/api/backfill/status**', async (route) => {
    counts.status += 1
    const res = await route.fetch()
    const body = await res.json().catch(() => ({ platforms: {} }))
    body.platforms = { ...(body.platforms || {}), google: fx.google }
    await route.fulfill({ response: res, body: JSON.stringify(body) })
  })
  await page.route('**/api/clients/backfill**', async (route) => {
    counts.post += 1
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ platform: 'google', action: fx.google.run?.live ? 'existing' : 'insert', run: fx.google.run ?? run({ steps: 0 }), note: 'fixture' }) })
  })
  await page.goto(`${BASE}/dashboard-next/client-profile?clientId=${CLIENT}`, { waitUntil: 'networkidle' })
  await page.waitForFunction(() => /Data history/.test(document.body.innerText), null, { timeout: 25_000 }).catch(() => {})
  const btn = page.locator('button[data-backfill-platform="google"]')
  await btn.waitFor({ timeout: 10_000 }).catch(() => {})
  const text = await page.locator('body').innerText()
  ok(`text renders: ${fx.expect}`, fx.expect.test(text))
  const disabled = await btn.isDisabled().catch(() => null)
  ok(`google button ${fx.enabled ? 'enabled' : 'disabled'}`, disabled === !fx.enabled, `disabled=${disabled}`)
  // unclipped at 390 px: the state text's box lies inside the viewport
  const box = await page.locator('button[data-backfill-platform="google"]').boundingBox().catch(() => null)
  ok('button inside the 390 px viewport', !!box && box.x >= 0 && box.x + box.width <= 390 + 1, box ? `x=${Math.round(box.x)} w=${Math.round(box.width)}` : 'no box')
  const hscroll = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth)
  ok('no horizontal page scroll', !hscroll)
  // per-platform buttons: one per connected platform
  const buttons = await page.locator('button[data-backfill-platform]').count()
  ok('one button per connected platform (≥ 1)', buttons >= 1, `buttons=${buttons}`)
  if (!fx.enabled) {
    await btn.click({ force: true }).catch(() => {})
    await btn.click({ force: true }).catch(() => {})
    await page.waitForTimeout(500)
    ok('two clicks while disabled issue NO POST', counts.post === 0, `posts=${counts.post}`)
  } else {
    await btn.click()
    await page.waitForTimeout(800)
    ok('one click issues exactly one POST', counts.post === 1, `posts=${counts.post}`)
  }
  if (fx.google.run?.live) {
    const before = counts.status
    await page.waitForTimeout(9000)
    ok('poll continues while the run is live (≥1 status read in 9 s)', counts.status > before, `status reads ${before}→${counts.status}`)
  }
  await ctx.close()
}
await browser.close()
const fails = results.filter((r) => !r.pass)
console.log(`\n[backfill-button.spec] ${fails.length === 0 ? 'PASS' : 'FAIL'} — ${results.length - fails.length}/${results.length} assertions across ${Object.keys(STATES).length} states at 390×844`)
process.exit(fails.length ? 1 : 0)
