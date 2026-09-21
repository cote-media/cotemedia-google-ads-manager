#!/usr/bin/env node
// LORAMER_GOOGLE_DELETE_MY_DATA_V1 — GATE-A FOR THE "Delete Google data" BUTTON: MOUNTED, AT PHONE WIDTH, REAL PATH.
//   npm run dev            (another terminal, port 3000)
//   node tests/ui/google-delete-button.spec.mjs
// Never part of `npm run guard` (needs a live dev server and the local NEXTAUTH_SECRET). The UI law
// (LORAMER_UI_FLIGHT_GATE_A_MOUNTS_V1): a -next UI flight's Gate-A mounts the component at a phone-shaped viewport.
// What is REAL: the dev server, the session, the client page and its connections. What is FIXTURED, and only this:
// POST /api/clients/google/delete-data is fulfilled at the network boundary with a complete/partial payload — this
// spec must never delete anything. Asserts: the button is inside 390 px; the confirm button is disabled until the
// client name is typed exactly; one click issues exactly one POST whose body carries confirm=<name>; the result
// (code + per-table counts) renders; a partial answer shows "Press again" and a second press is a second POST.
import { chromium } from '@playwright/test'
import { loadLocalEnv, sessionTokenFor, phoneContext } from '../browser/session.mjs'

loadLocalEnv()
const BASE = process.env.GATEA_BASE || 'http://localhost:3000'
const EMAIL = process.env.GATEA_EMAIL || 'cotebrandmarketing@gmail.com'
const CLIENT = process.env.GATEA_CLIENT || '8bb0cd08-7a97-42f3-86ba-3556f0ad585c' // Tri-Copy — the template client
const results = []
const ok = (name, pass, detail = '') => { results.push({ name, pass, detail }); console.log(`  ${pass ? 'PASS' : '⛔ FAIL'}  ${name}${detail ? ' — ' + detail : ''}`) }

const browser = await chromium.launch()
const token = await sessionTokenFor(EMAIL)
for (const fx of [
  { name: 'complete', body: { status: 'complete', confirmation_code: 'fixture-code-1111', counts: { platform_connections: 1, universe_attempt_log: 149163, metrics_daily: 3058401 } }, expect: /Google data deleted\./, again: false },
  { name: 'partial', body: { status: 'partial', confirmation_code: 'fixture-code-2222', counts: { platform_connections: 1 }, note: 'time budget reached at 2024-05; press again to continue' }, expect: /Deletion paused — press again to continue\./, again: true },
]) {
  console.log(`\n▸ fixture: ${fx.name}`)
  const ctx = await phoneContext(browser, token)
  const page = await ctx.newPage()
  const posts = []
  await page.route('**/api/clients/google/delete-data**', async (route) => {
    const req = route.request()
    posts.push({ method: req.method(), body: req.postDataJSON?.() ?? null })
    await route.fulfill({ status: fx.body.status === 'complete' ? 200 : 202, contentType: 'application/json', body: JSON.stringify(fx.body) }).catch(() => {})
  })
  await page.goto(`${BASE}/dashboard-next/client-profile?clientId=${CLIENT}`, { waitUntil: 'domcontentloaded', timeout: 180_000 })
  const clientName = (await page.locator('h1, h2').first().innerText().catch(() => '')).trim()
  const btn = page.getByTestId('delete-google-data')
  await btn.waitFor({ state: 'visible', timeout: 60_000 })
  const box = await btn.boundingBox()
  ok('button inside the 390 px viewport', !!box && box.x >= 0 && box.x + box.width <= 390 + 1, box ? `x=${Math.round(box.x)} w=${Math.round(box.width)}` : 'no box')
  const hscroll = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1)
  ok('no horizontal page scroll', !hscroll)
  // hydration first: the first click on a server-rendered button before React attaches its handler does nothing
  await page.waitForLoadState('networkidle', { timeout: 60_000 }).catch(() => {})
  await btn.scrollIntoViewIfNeeded()
  const run = page.getByTestId('delete-google-run')
  for (let attempt = 0; attempt < 3; attempt++) {
    await btn.click()
    if (await run.isVisible({ timeout: 3_000 }).catch(() => false)) break
  }
  await run.waitFor({ state: 'visible', timeout: 10_000 })
  ok('confirm button disabled before the name is typed', await run.isDisabled())
  await run.click({ force: true }).catch(() => {})
  ok('a click while disabled issues NO POST', posts.length === 0, `posts=${posts.length}`)
  const nameOnPage = await page.locator('h3').filter({ hasText: 'Delete all Google Ads data for' }).innerText()
  const name = nameOnPage.replace(/^Delete all Google Ads data for\s*/, '').replace(/\?$/, '').trim()
  await page.getByTestId('delete-google-confirm').fill(name)
  ok('confirm button enabled once the exact name is typed', !(await run.isDisabled()), `name="${name}"`)
  await run.click()
  await page.getByTestId('delete-google-result').waitFor({ state: 'visible', timeout: 15_000 })
  ok('one click issues exactly one POST', posts.length === 1, `posts=${posts.length}`)
  ok('the POST carries confirm=<client name>', posts[0]?.body?.confirm === name, JSON.stringify(posts[0]?.body))
  const text = await page.getByTestId('delete-google-result').innerText()
  ok(`result renders: ${fx.expect}`, fx.expect.test(text))
  ok('confirmation code renders', text.includes(fx.body.confirmation_code))
  ok('per-table counts render', text.includes('platform_connections: 1'))
  if (fx.again) {
    await page.getByTestId('delete-google-again').click()
    await page.waitForTimeout(500)
    ok('"Press again" issues a second POST', posts.length === 2, `posts=${posts.length}`)
  }
  await page.screenshot({ path: `tests/browser/gate-a-google-delete-${fx.name}.png`, fullPage: false }).catch(() => {})
  await page.unrouteAll({ behavior: 'ignoreErrors' })
  await ctx.close()
  void clientName
}
await browser.close()
const failed = results.filter((r) => !r.pass)
console.log(`\n${failed.length ? '⛔' : '✅'} google-delete-button Gate-A — ${results.length - failed.length}/${results.length} passed`)
process.exit(failed.length ? 1 : 0)
