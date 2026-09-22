#!/usr/bin/env node
// LORAMER_GOOGLE_DELETE_JOB_V1 — GATE-A FOR "Delete Google data" AS A JOB: PRESS, CLOSE THE PAGE, REOPEN, SEE PROGRESS, SEE THE RESULT.
//   npm run dev            (another terminal, port 3000)
//   node tests/ui/google-delete-button.spec.mjs
// Never part of `npm run guard` (needs a live dev server and the local NEXTAUTH_SECRET). The UI law
// (LORAMER_UI_FLIGHT_GATE_A_MOUNTS_V1): mounted at a phone-shaped viewport. REAL: the dev server, the session, the client
// page. FIXTURED, and only this: the job route at the network boundary — GET answers from a scripted job state, POST
// answers 202 and advances it — so nothing is deleted. Asserts: the button is inside 390 px; the confirm is disabled until
// the exact name; the press issues ONE POST and the page shows "running on the server"; the page is CLOSED and REOPENED
// while the job is processing and shows progress from the row alone; a second press while live is refused (202
// in_progress, no run); the page reopened after completion shows the result and the confirmation code.
import { chromium } from '@playwright/test'
import { loadLocalEnv, sessionTokenFor, phoneContext } from '../browser/session.mjs'

loadLocalEnv()
const BASE = process.env.GATEA_BASE || 'http://localhost:3000'
const EMAIL = process.env.GATEA_EMAIL || 'cotebrandmarketing@gmail.com'
const CLIENT = process.env.GATEA_CLIENT || '8bb0cd08-7a97-42f3-86ba-3556f0ad585c' // Tri-Copy
const results = []
const ok = (name, pass, detail = '') => { results.push({ name, pass, detail }); console.log(`  ${pass ? 'PASS' : '⛔ FAIL'}  ${name}${detail ? ' — ' + detail : ''}`) }

// THE SCRIPTED JOB: one shared state the fixtures read and the "server" advances
const job = { state: 'none', code: 'fixture-code-7777', steps: [], months: 0, counts: {}, live: false, completed_at: null }
const shape = () => job.state === 'none' ? null : ({ status: job.state, live: job.live, confirmation_code: job.code, steps: job.steps, counts: job.counts, counts_after: job.state === 'complete' ? { metrics_daily: 0 } : null, months_done: job.months, errors: [], completed_at: job.completed_at, received_at: '2026-09-21T23:00:00Z', tables: [] })
const posts = []
async function wire(page) {
  await page.route('**/api/clients/google/delete-data**', async (route) => {
    const req = route.request()
    if (req.method() === 'GET') { await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ job: shape() }) }).catch(() => {}); return }
    posts.push(req.postDataJSON?.() ?? null)
    if (job.state === 'processing' && job.live) { await route.fulfill({ status: 202, contentType: 'application/json', body: JSON.stringify({ status: 'in_progress', job: shape(), note: 'a deletion is already running for this client; this press only reads its progress' }) }).catch(() => {}); return }
    job.state = 'processing'; job.live = true; job.steps = ['quiet_before', 'connection']; job.counts = { platform_connections: 1 }
    await route.fulfill({ status: 202, contentType: 'application/json', body: JSON.stringify({ status: 'processing', job: shape(), note: 'the deletion runs on the server; close the page if you like — reopen it for progress' }) }).catch(() => {})
  })
}
const open = async (browser, token) => { const ctx = await phoneContext(browser, token); const page = await ctx.newPage(); await wire(page); await page.goto(`${BASE}/dashboard-next/client-profile?clientId=${CLIENT}`, { waitUntil: 'domcontentloaded', timeout: 180_000 }); return { ctx, page } }

const browser = await chromium.launch()
const token = await sessionTokenFor(EMAIL)

// 1 — the press
{
  const { ctx, page } = await open(browser, token)
  const btn = page.getByTestId('delete-google-data'); await btn.waitFor({ state: 'visible', timeout: 60_000 })
  const box = await btn.boundingBox()
  ok('button inside the 390 px viewport', !!box && box.x >= 0 && box.x + box.width <= 391, box ? `x=${Math.round(box.x)} w=${Math.round(box.width)}` : 'no box')
  ok('no horizontal page scroll', !(await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1)))
  await page.waitForLoadState('networkidle', { timeout: 60_000 }).catch(() => {})
  await btn.scrollIntoViewIfNeeded()
  const run = page.getByTestId('delete-google-run')
  for (let i = 0; i < 3; i++) { await btn.click(); if (await run.isVisible({ timeout: 3_000 }).catch(() => false)) break }
  ok('confirm disabled before the name is typed', await run.isDisabled())
  const h3 = await page.locator('h3').filter({ hasText: 'Delete all Google Ads data for' }).innerText()
  const name = h3.replace(/^Delete all Google Ads data for\s*/, '').replace(/\?$/, '').trim()
  await page.getByTestId('delete-google-confirm').fill(name)
  ok('confirm enabled with the exact name', !(await run.isDisabled()))
  await run.click()
  await page.getByTestId('delete-google-result').waitFor({ state: 'visible', timeout: 15_000 })
  ok('the press issues exactly one POST', posts.length === 1, `posts=${posts.length}`)
  const t = await page.getByTestId('delete-google-result').innerText()
  ok('the page says the deletion runs on the server', /running on the server/.test(t), t.slice(0, 80))
  ok('the confirmation code shows at once', t.includes(job.code))
  await ctx.close() // THE PAGE IS CLOSED MID-RUN
}
// 2 — the server advances while nobody is looking
job.steps = ['quiet_before', 'connection', 'quiet', 'ledgers']; job.months = 57; job.counts = { platform_connections: 1, universe_attempt_log: 149163, metrics_daily: 1200000 }
// 3 — reopen: progress from the row alone, no press
{
  const { ctx, page } = await open(browser, token)
  const st = page.getByTestId('delete-google-status'); await st.waitFor({ state: 'visible', timeout: 60_000 })
  const t = await st.innerText()
  ok('reopened page shows progress without a press', /running on the server/.test(t) && /4 of 10 steps/.test(t) && /57 months/.test(t), t.slice(0, 120))
  // a second press while live is refused
  const btn = page.getByTestId('delete-google-data'); await btn.scrollIntoViewIfNeeded(); await btn.click()
  const res = page.getByTestId('delete-google-result'); await res.waitFor({ state: 'visible', timeout: 10_000 })
  ok('the modal on a live job shows progress, not a confirm field', (await page.getByTestId('delete-google-confirm').count()) === 0)
  ok('no POST was issued by opening the modal on a live job', posts.length === 1, `posts=${posts.length}`)
  await ctx.close()
}
// 4 — the server finishes; reopen shows the result
job.state = 'complete'; job.live = false; job.steps = ['quiet_before', 'connection', 'quiet', 'ledgers', 'metrics', 'capture', 'walk_state', 'resweep', 'cache', 'revoke']; job.months = 126; job.counts = { platform_connections: 1, universe_attempt_log: 149163, metrics_daily: 3058401 }; job.completed_at = '2026-09-21T23:43:19Z'
{
  const { ctx, page } = await open(browser, token)
  const st = page.getByTestId('delete-google-status'); await st.waitFor({ state: 'visible', timeout: 60_000 })
  const t = await st.innerText()
  ok('reopened page shows the result and the code', /Google data deleted/.test(t) && t.includes(job.code), t.slice(0, 120))
  await page.screenshot({ path: 'tests/browser/gate-a-google-delete-job.png' }).catch(() => {})
  await ctx.close()
}
await browser.close()
const failed = results.filter((r) => !r.pass)
console.log(`\n${failed.length ? '⛔' : '✅'} google-delete-job Gate-A — ${results.length - failed.length}/${results.length} passed`)
process.exit(failed.length ? 1 : 0)
