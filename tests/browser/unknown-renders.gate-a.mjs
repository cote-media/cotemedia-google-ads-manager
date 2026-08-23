#!/usr/bin/env node
// LORAMER_UNKNOWN_RENDERS_HONESTLY_V1 — BROWSER GATE-A. ⛔ MANUAL ONLY. Never wired into `npm run guard` or
// `npm run build` — a browser in the deploy path is a new failure mode on every push, same posture as
// check:data and evals.
//
// ⛔ WHY A MOUNTED RENDER AND NOT CURL: a wrong string and a render loop are BOTH invisible to curl-shaped
// proof. That is exactly how the reconnect build shipped and reverted the same night with a fully green
// API Gate-A — the law banked from it (ESSENCE, 2026-08-23) is that a -next UI flight's Gate-A mounts the
// component. This is that gate.
//
// ⛔ THE STUB, NAMED RATHER THAN BURIED (LORAMER_REAL_INPUT_GATE_A_V1): the unknown is induced by REWRITING
// THE PAYLOAD at the network boundary, not by breaking the database. That is the correct layer for THIS
// gate — Part 1's Gate-A already induced a real DB failure against the live database and proved the PAYLOAD
// carries unknown+reason; Part 2 owns the RENDER, so it stubs the payload and exercises the real component,
// real mount, real viewport. Each layer's gate induces at its own seam. Everything else is real: a real dev
// server, a real session, real client data from the production database.
//
// USAGE:  node tests/browser/unknown-renders.gate-a.mjs
//         (expects a dev server already listening; start it yourself so its logs stay yours to read)

import { chromium } from '@playwright/test'
import { encode } from 'next-auth/jwt'
import { readFileSync } from 'node:fs'

for (const l of readFileSync('.env.local', 'utf8').split('\n')) {
  const m = l.match(/^([A-Z_]+)=(.*)$/)
  if (m) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '')
}

const BASE = process.env.GATEA_BASE || 'http://localhost:3000'
const OWNER = 'cotebrandmarketing@gmail.com'
const FOAM = '957d484e-d0c4-4dd0-b382-d8499d556252' // PROOF-TARGET DEFAULT (DECISIONS): a client with real data
const VIEWPORT = { width: 390, height: 844 } // iPhone 14/15 CSS pixels
const results = []
const ok = (name, pass, detail = '') => { results.push({ name, pass, detail }); console.log(`  ${pass ? 'PASS' : '⛔ FAIL'}  ${name}${detail ? ' — ' + detail : ''}`) }

const token = await encode({ token: { name: 'Gate-A', email: OWNER, sub: 'gate-a' }, secret: process.env.NEXTAUTH_SECRET })
const browser = await chromium.launch()

async function openMer({ induceUnknown }) {
  const ctx = await browser.newContext({
    viewport: VIEWPORT,
    deviceScaleFactor: 3,
    isMobile: true,
    hasTouch: true,
    userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
  })
  await ctx.addCookies([{ name: 'next-auth.session-token', value: token, domain: 'localhost', path: '/', httpOnly: true, sameSite: 'Lax' }])
  const page = await ctx.newPage()
  const counts = { doc: 0, metrics: 0, rsc: 0 }
  page.on('request', (r) => {
    const u = r.url()
    if (r.resourceType() === 'document') counts.doc += 1
    if (u.includes('/api/next/client-metrics')) counts.metrics += 1
    if (u.includes('_rsc=')) counts.rsc += 1
  })
  if (induceUnknown) {
    // THE STUB. Every channel's presence becomes 'unknown' with a reason; nothing else in the payload moves.
    await page.route('**/api/next/client-metrics**', async (route) => {
      const res = await route.fetch()
      const body = await res.json().catch(() => null)
      if (body?.channels) {
        body.channels = body.channels.map((c) => ({ ...c, presence: 'unknown', presenceReason: 'STUB: induced at the payload boundary for Gate-A' }))
      }
      await route.fulfill({ response: res, body: JSON.stringify(body) })
    })
  }
  await page.goto(`${BASE}/dashboard-next/mer?clientId=${FOAM}`, { waitUntil: 'networkidle' })
  // Wait for the CLIENT-SIDE fetch to land. Asserting before it does measures the loading state and calls it
  // a result — the first run of this gate did exactly that and reported a false failure on the $ figures.
  // Wait for the REVENUE SOURCES region to settle — that is the region every assertion reads, and waiting
  // for a settle signal elsewhere is how the first two runs measured the loading state and called it a result.
  const settled = induceUnknown
    ? () => /couldn[’']t check/.test(document.body.innerText)
    : () => /Revenue sources/.test(document.body.innerText) && /\$/.test(document.body.innerText)
  await page.waitForFunction(settled, null, { timeout: 25_000 }).catch(() => {})
  return { ctx, page, counts }
}

// ── 1. HEALTHY BASELINE FIRST. A fix that fires when nothing is wrong is a new defect. ───────────────────
console.log('\n── 1. HEALTHY BASELINE (Foam OH, no fault induced) ──')
{
  const { ctx, page, counts } = await openMer({ induceUnknown: false })
  const text = await page.locator('body').innerText()
  ok('page mounted (the client name renders)', /Foam|Spend contribution/i.test(text), text.slice(0, 60).replace(/\n/g, ' '))
  ok('"couldn’t check" appears ZERO times on a healthy client', !/couldn[’']t check/i.test(text))
  ok('a real spend figure is rendered', /\$[\d,]+/.test(text))
  // ⛔ ≤2, NOT ==1, AND THE REASON IS NAMED RATHER THAN THE NUMBER LOOSENED: Next dev enables React
  // StrictMode, which double-invokes effects by design. The property under test is BOUNDED, not one.
  ok('client-metrics calls are BOUNDED (≤2; dev StrictMode double-invokes)', counts.metrics <= 2, `metrics=${counts.metrics}`)
  await ctx.close()
}

// ── 2. INDUCED UNKNOWN — the render contract under fault ─────────────────────────────────────────────────
console.log('\n── 2. INDUCED UNKNOWN (payload stub — every channel presence=unknown) ──')
{
  const { ctx, page, counts } = await openMer({ induceUnknown: true })
  const text = await page.locator('body').innerText()
  ok('"couldn’t check" is PRESENT', /couldn[’']t check/i.test(text))
  ok('"not connected" appears ZERO times', !/not connected/i.test(text))
  // The MER headline legitimately reads $0 when a client has no ad spend in range — that is a REAL zero and
  // not this flight's business. Scope the assertion to the revenue cards, which is where the lie would be.
  const cardsText = await page.locator('text=/couldn/').first().locator('xpath=ancestor::div[1]').innerText().catch(() => '')
  ok('the unknown card shows no fabricated figure', !/\$/.test(cardsText), cardsText.replace(/\n/g, ' ').slice(0, 60))
  // ⛔ THE CARD COUNT, AND IT IS THE POINT OF THIS WHOLE GATE. The old `.filter(({c}) => c?.hasDataEver)`
  // REMOVED the card on an unknown — no text to assert on, no pixel, nothing for a user to be suspicious of.
  // A text assertion passes happily over a card that is not there. Count the cards.
  const revenueCards = await page.locator('text=/^(Shopify|WooCommerce|Analytics \\(GA\\))$/').count()
  ok('revenue cards are PRESENT, not filtered away (count > 0)', revenueCards > 0, `cards=${revenueCards}`)
  await ctx.close()
}

// ── 3. NO REPEAT REQUESTS — the reconnect render-loop check ──────────────────────────────────────────────
console.log('\n── 3. NO REPEAT REQUESTS (30s idle) ──')
{
  const { ctx, page, counts } = await openMer({ induceUnknown: true })
  await page.waitForTimeout(30_000)
  ok('exactly ONE document navigation', counts.doc === 1, `doc=${counts.doc}`)
  ok('client-metrics calls do NOT GROW over 30s idle (≤2, StrictMode)', counts.metrics <= 2, `metrics=${counts.metrics}`)
  await page.screenshot({ path: 'tests/browser/gate-a-390.png' })
  console.log('  screenshot → tests/browser/gate-a-390.png')
  await ctx.close()
}

await browser.close()
const failed = results.filter((r) => !r.pass)
console.log(`\n[gate-a] ${results.length - failed.length}/${results.length} assertions passed`)
console.log('[gate-a] ⛔ WHAT THIS CANNOT SEE: whether the WORDS read as honest to a human, and whether iOS Safari behaves as headless Chromium does. ★MOBILE-WIDTH-GUARD MEASURED that gap — headless WebKit contained a 976px table at 390px while the bug was live on the device. Headless is a FLOOR; Gate-B on the phone stays mandatory.')
process.exit(failed.length ? 1 : 0)
