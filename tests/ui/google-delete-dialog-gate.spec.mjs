#!/usr/bin/env node
// LORAMER_GOOGLE_DELETE_DIALOG_GATE_V1 — GATE-A: A FINISHED JOB MUST NOT HIDE THE CONFIRM FORM.
//   npm run dev            (another terminal, port 3000)
//   node tests/ui/google-delete-dialog-gate.spec.mjs
// Never part of `npm run guard` (needs a live dev server and the local NEXTAUTH_SECRET). The UI law
// (LORAMER_UI_FLIGHT_GATE_A_MOUNTS_V1): a REAL mounted render at a phone-shaped viewport, because a render gate
// is invisible to curl by construction — round 348's defect was three render conditions and nothing else.
// REAL: the dev server, the session, the client page. FIXTURED, and only this: the job route at the network
// boundary, so nothing is deleted and no live row is touched.
//
// THREE STATES, one screenshot each:
//   (i)   no job            → the dialog shows the name box and the red button
//   (ii)  a finished job    → the PAGE shows the dated receipt AND the dialog still opens on the name box
//   (iii) a processing job  → the dialog shows live progress and NO form
import { chromium } from '@playwright/test'
import { mkdirSync } from 'node:fs'
import { loadLocalEnv, sessionTokenFor, phoneContext } from '../browser/session.mjs'

loadLocalEnv()
const BASE = process.env.GATEA_BASE || 'http://localhost:3000'
const EMAIL = process.env.GATEA_EMAIL || 'cotebrandmarketing@gmail.com'
const CLIENT = process.env.GATEA_CLIENT || '8bb0cd08-7a97-42f3-86ba-3556f0ad585c' // Tri-Copy
const SHOTS = process.env.GATEA_SHOTS || '/tmp/gatea-dialog-gate'
mkdirSync(SHOTS, { recursive: true })

const results = []
const ok = (name, pass, detail = '') => { results.push({ name, pass, detail }); console.log(`  ${pass ? 'PASS' : '⛔ FAIL'}  ${name}${detail ? ' — ' + detail : ''}`) }

// The 2026-09-21 shape, verbatim from platform_compliance_log: a COMPLETE job with a real completion time.
const FINISHED = {
  status: 'complete', live: false, confirmation_code: '5ff2f7d8-d2f5-47b4-92f7-cd828c9fc083',
  steps: ['quiet_before', 'connection', 'quiet', 'ledgers', 'metrics', 'capture', 'walk_state', 'resweep', 'cache', 'revoke'],
  counts: { platform_connections: 1, sync_state: 14 }, counts_after: {}, months_done: 49, errors: [],
  completed_at: '2026-09-22T01:08:22.929Z', corrections: [], tables: [],
}
const RUNNING = {
  status: 'processing', live: true, confirmation_code: 'fixture-running-2222',
  steps: ['quiet_before', 'connection'], counts: { platform_connections: 1 }, counts_after: null,
  months_done: 3, errors: [], completed_at: null, corrections: [], tables: [],
}

let posts = 0
async function open(browser, token, job) {
  const ctx = await phoneContext(browser, token)
  const page = await ctx.newPage()
  await page.route('**/api/clients/google/delete-data**', async (route) => {
    if (route.request().method() === 'GET') {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ job }) }).catch(() => {})
      return
    }
    posts++
    await route.fulfill({ status: 202, contentType: 'application/json', body: JSON.stringify({ status: 'processing', job: RUNNING, note: 'fixture' }) }).catch(() => {})
  })
  await page.goto(`${BASE}/dashboard-next/client-profile?clientId=${CLIENT}`, { waitUntil: 'domcontentloaded' })
  return { ctx, page }
}
const pressOpen = async (page) => {
  const btn = page.getByTestId('delete-google-data')
  await btn.waitFor({ state: 'visible', timeout: 60_000 })
  await page.waitForLoadState('networkidle', { timeout: 60_000 }).catch(() => {})
  await btn.scrollIntoViewIfNeeded()
  for (let i = 0; i < 3; i++) {
    await btn.click()
    if (await page.locator('h3', { hasText: 'Delete all Google Ads data for' }).isVisible({ timeout: 3_000 }).catch(() => false)) break
  }
}
const ids = async (page) => (await page.locator('[data-testid]').evaluateAll((els) => els.map((e) => e.getAttribute('data-testid')))).filter((t) => t && t.startsWith('delete-google'))

const browser = await chromium.launch()
const token = await sessionTokenFor(EMAIL)

// (i) NO JOB — the form is there, as it always was
{
  const { ctx, page } = await open(browser, token, null)
  await pressOpen(page)
  const form = page.getByTestId('delete-google-confirm'), run = page.getByTestId('delete-google-run')
  ok('(i) no job: the name box is visible', await form.isVisible())
  ok('(i) no job: the red button is visible', await run.isVisible())
  ok('(i) no job: the confirm is disabled before the name is typed', await run.isDisabled())
  const box = await run.boundingBox()
  ok('(i) the red button is inside the 390 px viewport', !!box && box.x >= 0 && box.x + box.width <= 391, box ? `x=${Math.round(box.x)} w=${Math.round(box.width)}` : 'no box')
  console.log(`         testids: ${(await ids(page)).join(', ')}`)
  await page.screenshot({ path: `${SHOTS}/i-no-job.png`, fullPage: true })
  await ctx.close()
}

// (ii) A FINISHED JOB — the defect's own state. The dated receipt is on the page; the form still opens.
{
  const { ctx, page } = await open(browser, token, FINISHED)
  const status = page.getByTestId('delete-google-status')
  await status.waitFor({ state: 'visible', timeout: 60_000 })
  const receipt = await status.innerText()
  ok('(ii) the page shows the finished receipt with its code', receipt.includes('5ff2f7d8-d2f5-47b4-92f7-cd828c9fc083'))
  ok('(ii) the page receipt names its date', /2026/.test(receipt), receipt.replace(/\s+/g, ' ').slice(0, 90))
  await pressOpen(page)
  const form = page.getByTestId('delete-google-confirm'), run = page.getByTestId('delete-google-run')
  ok('(ii) THE DIALOG STILL OPENS ON THE NAME BOX', await form.isVisible())
  ok('(ii) the red button is reachable', await run.isVisible())
  ok('(ii) no progress block stands in for the form', !(await page.getByTestId('delete-google-result').isVisible().catch(() => false)))
  console.log(`         testids: ${(await ids(page)).join(', ')}`)
  await page.screenshot({ path: `${SHOTS}/ii-finished-job.png`, fullPage: true })
  // and the form actually sends
  const h3 = await page.locator('h3').filter({ hasText: 'Delete all Google Ads data for' }).innerText()
  await page.getByTestId('delete-google-confirm').fill(h3.replace(/^Delete all Google Ads data for\s*/, '').replace(/\?$/, '').trim())
  ok('(ii) the confirm enables with the exact name', !(await run.isDisabled()))
  await ctx.close()
}

// (iii) A RUNNING JOB — progress, and no form
{
  const { ctx, page } = await open(browser, token, RUNNING)
  await pressOpen(page)
  const result = page.getByTestId('delete-google-result')
  await result.waitFor({ state: 'visible', timeout: 20_000 })
  ok('(iii) running: the progress block is shown', await result.isVisible())
  ok('(iii) running: the name box is NOT rendered', (await page.getByTestId('delete-google-confirm').count()) === 0)
  ok('(iii) running: the red confirm is NOT rendered', (await page.getByTestId('delete-google-run').count()) === 0)
  const t = await result.innerText()
  ok('(iii) running: the copy says running, not deleted', /running on the server|continues within a minute/.test(t), t.replace(/\s+/g, ' ').slice(0, 80))
  console.log(`         testids: ${(await ids(page)).join(', ')}`)
  await page.screenshot({ path: `${SHOTS}/iii-processing-job.png`, fullPage: true })
  await ctx.close()
}

await browser.close()
const failed = results.filter((r) => !r.pass)
console.log(`\n[dialog-gate gate-A] ${results.length - failed.length}/${results.length} · screenshots in ${SHOTS}`)
if (failed.length) process.exit(1)
