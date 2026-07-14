// LORAMER_LORA_EVAL_HARNESS_V1 — the accuracy GATE from LORAMER_LORA_SPEC §7.
// Sends each golden question through Lora's REAL answer path (POST /api/chat → the Anthropic tool loop a customer
// hits — NOT a mock), captures her answer, and scores it against a DB-VERIFIED expected value + per-question
// assertions. For surface-sync (cat A) it ALSO live-fetches the dashboard card (/api/next/client-metrics) and
// compares card-vs-Lora — the exact known contradiction risk. Writes a timestamped results file + prints a scorecard.
//
// Auth: mints a next-auth JWT session cookie for the client OWNER (so resolveAccess passes) using the SAME
// NEXTAUTH_SECRET the server runs on. Run against a local dev server started with NEXTAUTH_URL pointed at itself
// (so /api/chat's internal /api/intelligence sub-fetch is self-consistent):
//   NEXTAUTH_URL=http://localhost:3111 npm run dev -- -p 3111
//   BASE=http://localhost:3111 OWNER=cotebrandmarketing@gmail.com node tests/lora-evals/run-evals.mjs
import { createRequire } from 'module'
import fs from 'fs'
import path from 'path'
const require = createRequire('/Users/russcote2/Downloads/cotemedia-google-ads-manager/package.json')
const { encode } = require('next-auth/jwt')

const ROOT = '/Users/russcote2/Downloads/cotemedia-google-ads-manager'
const BASE = process.env.BASE || 'http://localhost:3111'
const OWNER = process.env.OWNER || 'cotebrandmarketing@gmail.com'
const CALL_TIMEOUT_MS = 120000

function secret() {
  const env = fs.readFileSync(path.join(ROOT, '.env.local'), 'utf8')
  const m = env.match(/^NEXTAUTH_SECRET=(.*)$/m)
  const s = m ? m[1].trim().replace(/^["']|["']$/g, '') : ''
  if (!s) throw new Error('NEXTAUTH_SECRET not found in .env.local')
  return s
}

// --- number extraction / matching ------------------------------------------------------------
function extractNumbers(text) {
  const out = []
  const re = /\$?\s?(\d{1,3}(?:,\d{3})+(?:\.\d+)?|\d+(?:\.\d+)?)\s?([kKmM])?/g
  let m
  while ((m = re.exec(text)) !== null) {
    let n = parseFloat(m[1].replace(/,/g, ''))
    if (m[2]) { const s = m[2].toLowerCase(); n = s === 'k' ? n * 1e3 : n * 1e6 }
    if (!isNaN(n)) out.push(n)
  }
  return out
}
function matchNumber(nums, expected, tolPct = 2) {
  const tol = Math.max(Math.abs(expected) * (tolPct / 100), 0.5)
  let best = null
  for (const n of nums) { const d = Math.abs(n - expected); if (best === null || d < best.d) best = { n, d } }
  return { pass: nums.some(n => Math.abs(n - expected) <= tol), closest: best ? best.n : null }
}

// --- assertion scorer ------------------------------------------------------------------------
function score(q, response, card) {
  const a = q.assert
  const nums = extractNumbers(response)
  const lo = response.toLowerCase()
  if (a.type === 'autofail') return { pass: false, detail: a.reason }
  if (a.type === 'number') {
    const r = matchNumber(nums, a.expected, a.tolerancePct || 2)
    let cardNote = ''
    if (q.cardCheck && card && typeof card.spend === 'number') cardNote = ` | card spend=${card.spend} rev=${card.revenue}`
    return { pass: r.pass, detail: `expected ${a.expected} (${a.label||''}); closest-in-answer ${r.closest}${cardNote}` }
  }
  if (a.type === 'numbers') {
    const results = a.expected.map(e => ({ e, ...matchNumber(nums, e, a.tolerancePct || 2) }))
    return { pass: results.every(r => r.pass), detail: results.map(r => `${r.e}→${r.pass?'ok':`MISS(closest ${r.closest})`}`).join(' , ') }
  }
  if (a.type === 'honesty') {
    const honest = /(no data|not connected|isn'?t connected|wasn'?t connected|don'?t have|do not have|no google|no meta|no shopify|no store|no woo|before .{0,20}(data|connect|start)|not available|can'?t compute|cannot compute|unable to|no revenue|prior to|didn'?t have|not set up|weren'?t (running|connected)|hasn'?t)/i.test(response)
    const fabricatedZero = /\$0\b|\$0\.00|was \$?0\b|is \$?0\b|0 dollars/i.test(response) && !honest
    return { pass: honest && !fabricatedZero, detail: `honestPhrase=${honest} fabricatedZero=${fabricatedZero}` }
  }
  if (a.type === 'sources') {
    const srcHits = [...new Set((a.sourceWords||[]).filter(w => lo.includes(w.toLowerCase())))]
    const distinct = [...new Set(nums.map(n => Math.round(n * 100) / 100))]
    const phraseOk = !a.mustPhraseAny || a.mustPhraseAny.some(p => lo.includes(p.toLowerCase()))
    const pass = srcHits.length >= (a.minSources||2) && distinct.length >= (a.minDistinctNumbers||2) && phraseOk
    return { pass, detail: `sources=[${srcHits.join(',')}] distinctNums=${distinct.length} phraseOk=${phraseOk}` }
  }
  if (a.type === 'ceiling') {
    const near = nums.filter(n => n >= (a.floor ?? 0) && n <= a.ceiling)
    const overstated = nums.some(n => n > a.ceiling && n < a.ceiling * 20 && Math.abs(n - a.expected) > a.ceiling)
    // pass if the expected count (±) appears within [floor,ceiling] and nothing is presented as a wildly higher count
    const hasExpected = nums.some(n => Math.abs(n - a.expected) <= Math.max(1, a.expected * 0.2))
    return { pass: hasExpected && !overstated, detail: `expected≈${a.expected} ceiling ${a.ceiling}; in-band=[${near.join(',')}] overstated=${overstated}` }
  }
  return { pass: false, detail: 'unknown assertion type' }
}

async function callChat(cookie, q) {
  const ctrl = new AbortController()
  const t = setTimeout(() => ctrl.abort(), CALL_TIMEOUT_MS)
  try {
    const res = await fetch(`${BASE}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: `next-auth.session-token=${cookie}` },
      body: JSON.stringify({ message: q.message, history: [], clientId: q.clientId, clientName: q.clientName, dateRange: q.dateRange || 'LAST_30_DAYS', location: 'chat' }),
      signal: ctrl.signal,
    })
    const j = await res.json().catch(() => ({}))
    return { status: res.status, response: j.response || j.error || '', raw: j }
  } catch (e) { return { status: 0, response: '', error: String(e?.message || e) } }
  finally { clearTimeout(t) }
}
async function fetchCard(cookie, clientId) {
  try {
    const res = await fetch(`${BASE}/api/next/client-metrics?clientId=${clientId}&period=LAST_MONTH`, { headers: { Cookie: `next-auth.session-token=${cookie}` } })
    if (!res.ok) return null
    return await res.json()
  } catch { return null }
}

async function main() {
  const gold = JSON.parse(fs.readFileSync(path.join(ROOT, 'tests/lora-evals/golden-set.json'), 'utf8'))
  const cookie = await encode({ token: { email: OWNER, name: 'Eval', sub: 'eval-' + OWNER }, secret: secret() })
  const results = []
  for (const q of gold.questions) {
    process.stdout.write(`[${q.id}/${q.cat}] ${q.clientName} … `)
    let card = null, got = { status: -1, response: '(autofail — no call)' }
    if (q.assert.type !== 'autofail') {
      if (q.cardCheck) card = await fetchCard(cookie, q.clientId)
      got = await callChat(cookie, q)
    }
    const sc = (got.status === 200 || q.assert.type === 'autofail') ? score(q, got.response || '', card)
              : { pass: false, detail: `HTTP ${got.status} ${got.error || got.response}` }
    results.push({ id: q.id, cat: q.cat, client: q.clientName, message: q.message, pass: sc.pass, detail: sc.detail, httpStatus: got.status, response: got.response, card: card && { spend: card.spend, revenue: card.revenue, roas: card.roas } })
    console.log(sc.pass ? 'PASS' : 'FAIL')
  }
  // scorecard
  const cats = {}
  for (const r of results) { (cats[r.cat] ||= { p: 0, n: 0 }); cats[r.cat].n++; if (r.pass) cats[r.cat].p++ }
  const overallP = results.filter(r => r.pass).length, overallN = results.length
  const stamp = process.env.STAMP || 'run'
  const outFile = path.join(ROOT, `tests/lora-evals/results/results-${stamp}.json`)
  fs.mkdirSync(path.dirname(outFile), { recursive: true })
  fs.writeFileSync(outFile, JSON.stringify({ base: BASE, owner: OWNER, cats, overall: { pass: overallP, n: overallN }, results }, null, 2))
  console.log('\n================ LORA EVAL SCORECARD ================')
  const CATNAME = { A: 'A basic-accuracy/surface-sync', B: 'B honesty/false-zero', C: 'C four-source ROAS', D: 'D Meta dedup', E: 'E doc/COGS', F: 'F comparisons/windows' }
  for (const c of Object.keys(cats).sort()) {
    const { p, n } = cats[c]; const pct = Math.round((p / n) * 1000) / 10
    const gate = pct >= 90 ? 'PASS' : 'FAIL'
    console.log(`  ${CATNAME[c] || c}: ${p}/${n} = ${pct}%  [gate≥90%: ${gate}]`)
  }
  const opct = Math.round((overallP / overallN) * 1000) / 10
  console.log(`  OVERALL: ${overallP}/${overallN} = ${opct}%  [gate≥95%: ${opct >= 95 ? 'PASS' : 'FAIL'}]`)
  console.log('\n---- FAILED QUESTIONS ----')
  for (const r of results.filter(x => !x.pass)) {
    console.log(`  [${r.id}/${r.cat}] ${r.client} — ${r.message}`)
    console.log(`     detail: ${r.detail}`)
    console.log(`     got: ${(r.response || '').replace(/\s+/g, ' ').slice(0, 240)}`)
  }
  console.log(`\nresults written: ${outFile}`)
}
main().catch(e => { console.error('HARNESS ERROR', e); process.exit(1) })
