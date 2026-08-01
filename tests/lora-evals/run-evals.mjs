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
// LORAMER_EVAL_BOUNDARY_JUDGE_V1 — the two V2 schema extensions live in their own module so both harnesses can
// use them without either importing the other.
import { judgeBoundary, judgeSpend, wilson, JUDGE_MODEL, TAXONOMY } from './boundary-judge.mjs'
// LORAMER_EVAL_SPEND_LEDGER_V1 — the run reports its own cost, per question, or says loudly that it cannot.
import { createLedger } from './spend-ledger.mjs'

const ROOT = '/Users/russcote2/Downloads/cotemedia-google-ads-manager'
const BASE = process.env.BASE || 'http://localhost:3111'
const OWNER = process.env.OWNER || 'cotebrandmarketing@gmail.com'
// LORAMER_EVAL_SPEND_LEDGER_V1 follow-on — the abort is env-configurable because 120s is a GUESS, and on
// run 1 it cost us seven answers we PAID FOR and threw away (all seven were the complex multi-surface
// questions). Raise it with EVAL_TIMEOUT_MS and report what each question actually took, so the ceiling
// can be set from measured latency instead of a round number.
// DEFAULT RAISED 120s → 300s ON 2026-08-01, FROM MEASURED LATENCY RATHER THAN A ROUND NUMBER.
// All seven run-1 aborts, re-run and timed: E10 171.4s · E11 158.6s · C8 133.7s · E12 125.3s ·
// B17 98.8s · E15 86.7s · C13 77.7s. Only FOUR genuinely exceeded 120s; three came in under it and
// aborted in run 1 for another reason — most likely contention as the credit exhaustion cascaded, which
// means run 1's abort count OVERSTATED the timeout problem. Max observed across all 18 was 171.4s, so
// 300s is ~1.75x the worst case and would have saved all seven. Raise with EVAL_TIMEOUT_MS if a future
// question class runs longer, and record the measurement when you do.
const CALL_TIMEOUT_MS = Number(process.env.EVAL_TIMEOUT_MS || 300000)

function secret() {
  const env = fs.readFileSync(path.join(ROOT, '.env.local'), 'utf8')
  const m = env.match(/^NEXTAUTH_SECRET=(.*)$/m)
  const s = m ? m[1].trim().replace(/^["']|["']$/g, '') : ''
  if (!s) throw new Error('NEXTAUTH_SECRET not found in .env.local')
  return s
}
function envVal(name) {
  const env = fs.readFileSync(path.join(ROOT, '.env.local'), 'utf8')
  const m = env.match(new RegExp('^' + name + '=(.*)$', 'm'))
  return m ? m[1].trim().replace(/^["']|["']$/g, '') : ''
}
const SB_URL = envVal('NEXT_PUBLIC_SUPABASE_URL') || envVal('SUPABASE_URL')
const SB_KEY = envVal('SUPABASE_SERVICE_ROLE_KEY')
const SBH = { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}` }

// LORAMER_LORA_EVAL_UPLOAD_V1 — E3 uploads a real .xlsx through the CUSTOMER route (/api/upload), then the harness
// CLEANS UP: uploaded text persists in client_context.user_notes and would leak into every later run on that client,
// silently mutating the golden set. Snapshot before, restore after (try/finally), and verify the pre-state returns.
async function uploadFixture(cookie, clientId, fixture) {
  const buf = fs.readFileSync(path.join(ROOT, 'tests/lora-evals/fixtures', fixture))
  const fd = new FormData()
  fd.append('file', new Blob([buf]), fixture)
  fd.append('clientId', clientId)
  const res = await fetch(`${BASE}/api/upload`, { method: 'POST', headers: { Cookie: `next-auth.session-token=${cookie}` }, body: fd })
  return { status: res.status, body: await res.json().catch(() => ({})) }
}
async function currentNotes(clientId) {
  const r = await fetch(`${SB_URL}/rest/v1/client_context?client_id=eq.${clientId}&user_email=eq.${encodeURIComponent(OWNER)}&select=user_notes`, { headers: SBH })
  const rows = await r.json().catch(() => [])
  return Array.isArray(rows) && rows.length ? { existed: true, notes: rows[0].user_notes ?? null } : { existed: false, notes: null }
}
async function restoreCtx(clientId, snap) {
  const url = `${SB_URL}/rest/v1/client_context?client_id=eq.${clientId}&user_email=eq.${encodeURIComponent(OWNER)}`
  if (snap.existed) await fetch(url, { method: 'PATCH', headers: { ...SBH, 'Content-Type': 'application/json', Prefer: 'return=minimal' }, body: JSON.stringify({ user_notes: snap.notes }) })
  else await fetch(url, { method: 'DELETE', headers: { ...SBH, Prefer: 'return=minimal' } })
}

// LORAMER_LORA_EVAL_CONFIG_GUARD_V1 — a mismatched server NEXTAUTH_URL silently reduces the eval to the TOOL-ONLY path:
// /api/chat fetches its intelligence via `${NEXTAUTH_URL}/api/intelligence`; if that doesn't point at THIS server the
// internal fetch throws, /api/chat falls back to a minimal system prompt, and the entire build-claude-context prompt
// (Part A fallback, coverage/canonical guidance, user_notes/uploaded docs) NEVER loads. This happened on 2026-07-15
// (server on :3111, NEXTAUTH_URL=:3000) and invalidated a full flight's runs. Assert config BEFORE any scoring; abort loud.
function abort(msg) { console.error(`\n❌ EVAL ABORTED — ${msg}\n`); process.exit(2) }
function assertConfig() {
  // The operator MUST pass the SAME NEXTAUTH_URL to the harness that the dev server was started with, and it MUST equal BASE.
  const nextAuth = process.env.NEXTAUTH_URL || envVal('NEXTAUTH_URL')
  if (nextAuth !== BASE) {
    abort(`NEXTAUTH_URL (${nextAuth || 'unset'}) must equal BASE (${BASE}).\n` +
      `  /api/chat loads its intelligence prompt via NEXTAUTH_URL. If it doesn't point at this server, the intelligence\n` +
      `  prompt silently fails to load and the eval tests ONLY the query_metrics tool path — every scorecard is then a lie.\n` +
      `  FIX: start the server AND run the harness with a matching NEXTAUTH_URL, e.g.\n` +
      `    NEXTAUTH_URL=${BASE} PORT=${(BASE.split(':')[2] || '3111')} LORA_CHAT_MODEL=claude-opus-5 npm run dev\n` +
      `    NEXTAUTH_URL=${BASE} BASE=${BASE} OWNER=${OWNER} node tests/lora-evals/run-evals.mjs`)
  }
  // LORAMER_LORA_OPUS5_MIGRATION_V1 — transitional: accept the outgoing floor (opus-4-8) AND the incoming floor (opus-5)
  // so the 4.8 baseline stays reproducible while the Opus 5 re-baseline runs. Narrow back to opus-5-only once the prod flip lands.
  const ALLOWED_MODELS = new Set(['claude-opus-4-8', 'claude-opus-5'])
  const model = process.env.LORA_CHAT_MODEL || envVal('LORA_CHAT_MODEL')
  if (model && !ALLOWED_MODELS.has(model)) abort(`LORA_CHAT_MODEL (${model}) must be one of: ${[...ALLOWED_MODELS].join(', ')} (the ship/eval model floor).`)
  if (!model) console.warn('⚠ LORA_CHAT_MODEL not visible to the harness — ensure the dev server was started with LORA_CHAT_MODEL set to the model under test.')
  console.log(`[config] NEXTAUTH_URL=${nextAuth} == BASE ✓ · model=${model || '(server-side; verify)'}`)
}
// PREFLIGHT (costs ~1 chat call) — behavioral confirmation the intelligence prompt actually loaded, not just the tool path.
// Set PREFLIGHT=off to skip. NOTE: the fully-robust version wants a /api/chat ?debug=intel flag (proposed prod change);
// this best-effort probe asks for a profile fact that ONLY exists in build-claude-context (never in any tool result).
async function preflight(cookie) {
  if (process.env.PREFLIGHT === 'off') { console.log('[preflight] skipped (PREFLIGHT=off)'); return }
  const q = { message: 'PREFLIGHT CHECK: reply with the single token INTEL_LOADED if you can see this client’s configured business profile / connection status in your context, otherwise reply INTEL_MISSING. One token only.', clientId: '23c697bb-5255-4289-9329-659544ba8e6e', clientName: 'Shelley Kyle', dateRange: 'LAST_MONTH' }
  const got = await callChat(cookie, q)
  const ok = /INTEL_LOADED/i.test(got.response || '')
  console.log(`[preflight] intelligence prompt loaded: ${ok} · reply="${(got.response || '').replace(/\s+/g, ' ').slice(0, 60)}"`)
  if (!ok) abort('preflight: /api/chat did not reflect the intelligence prompt — it likely fell back to the tool-only path. Fix NEXTAUTH_URL and retry. (Set PREFLIGHT=off only if you have independently confirmed the prompt loads.)')
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
  // LORAMER_EVAL_BOUNDARY_JUDGE_V1 — two V2 types the deterministic scorer deliberately does NOT decide.
  // `ungraded`: the question RUNS and its answer is recorded, but its correctness axis has no ground truth yet.
  // It is NOT a pass and NOT a fail — scoring it either way would put 77 questions into a denominator that
  // cannot support them. `boundary`: graded by the LLM judge in the run loop, because the pass/fail turns on
  // confidence and assertion, which a regex cannot read.
  if (a.type === 'ungraded') return { graded: false, pass: null, detail: `UNGRADED — needs ground truth from ${a.truthSource || 'the source platform'}` }
  if (a.type === 'boundary') return { deferred: true, pass: null, detail: 'judge pending' }
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
  // LORAMER_EVAL_BOUNDARY_JUDGE_V1 — `--set <file>` so this harness runs the 28-question golden set OR the
  // 100-question V2 set. ONE runner, two sets: V2 is a golden-set SUCCESSOR, so forking a third harness to run
  // it would widen the split that ★TWO-EVAL-HARNESSES-ONE-JUDGE exists to record.
  const setArg = (process.argv.find((a) => a.startsWith('--set=')) || '').split('=')[1]
    || (process.argv.includes('--set') ? process.argv[process.argv.indexOf('--set') + 1] : null)
  const setFile = setArg || 'golden-set.json'
  const gold = JSON.parse(fs.readFileSync(path.join(ROOT, 'tests/lora-evals', setFile), 'utf8'))
  console.log(`[set] ${setFile} — ${gold.questions.length} questions`)
  // --only A5,A7,... runs a SUBSET. Used to finish a run that died partway rather than re-spending on the
  // answers we already have — run 1's 82 answers cost $20.51 and re-running them would buy nothing.
  const onlyArg = (process.argv.find((a) => a.startsWith('--only=')) || '').split('=')[1]
    || (process.argv.includes('--only') ? process.argv[process.argv.indexOf('--only') + 1] : null)
  if (onlyArg) {
    const want = new Set(onlyArg.split(',').map((x) => x.trim()).filter(Boolean))
    const before = gold.questions.length
    gold.questions = gold.questions.filter((q) => want.has(q.id))
    const missing = [...want].filter((w) => !gold.questions.some((q) => q.id === w))
    if (missing.length) abort(`--only names ${missing.length} id(s) not in the set: ${missing.join(', ')}`)
    console.log(`[only] ${gold.questions.length} of ${before} questions: ${[...want].join(', ')}`)
  }
  const ledger = createLedger()
  ledger.begin()
  assertConfig() // LORAMER_LORA_EVAL_CONFIG_GUARD_V1 — abort on NEXTAUTH_URL/model mismatch BEFORE spending a token
  const cookie = await encode({ token: { email: OWNER, name: 'Eval', sub: 'eval-' + OWNER }, secret: secret() })
  await preflight(cookie) // 1-token behavioral confirmation the intelligence prompt loaded (PREFLIGHT=off to skip)
  const results = []
  // LORAMER_LORA_CACHE_WARM_REORDER_V1 — group questions BY CLIENT (stable: client blocks in first-appearance order,
  // original order preserved within each block) so each client's ~12k cacheable prefix is WRITTEN once and READ by the
  // rest of that client's questions inside the 5-min prompt-cache TTL. Score-neutral: every /api/chat call is stateless
  // (history:[]); the only cross-call state — E3's persisted upload — stays LAST within its client block (Shelley:
  // A5,B3,C2,D1,E1,E3), so no question sees a contamination it wouldn't in golden order. Pure cost/latency optimization.
  const _clientOrder = []
  const _byClient = new Map()
  for (const q of gold.questions) {
    if (!_byClient.has(q.clientId)) { _byClient.set(q.clientId, []); _clientOrder.push(q.clientId) }
    _byClient.get(q.clientId).push(q)
  }
  const runOrder = _clientOrder.flatMap(cid => _byClient.get(cid))
  console.log(`[cache-warm] ${runOrder.length} questions in ${_clientOrder.length} client blocks: ` +
    _clientOrder.map(cid => `${(_byClient.get(cid)[0].clientName || '').slice(0, 12)}(${_byClient.get(cid).length})`).join(' '))
  // eval hygiene — snapshot every upload client's context so we can restore it after the run (uploads persist)
  const uploadClients = [...new Set(gold.questions.filter(q => q.upload).map(q => q.clientId))]
  const snaps = {}
  for (const cid of uploadClients) { snaps[cid] = await currentNotes(cid); console.log(`[hygiene] snapshot ${cid}: existed=${snaps[cid].existed} notesLen=${(snaps[cid].notes || '').length}`) }
  try {
    for (const q of runOrder) {
      process.stdout.write(`[${q.id}/${q.cat}] ${q.clientName} … `)
      let card = null, got = { status: -1, response: '(autofail — no call)' }, up = null
      if (q.assert.type !== 'autofail') {
        if (q.upload) { up = await uploadFixture(cookie, q.clientId, q.upload); process.stdout.write(`[upload ${q.upload}→${up.status}${up.body?.truncated ? ' TRUNCATED' : ''}] `) }
        if (q.cardCheck) card = await fetchCard(cookie, q.clientId)
        ledger.markChatStart(q.id)
        const _t0 = Date.now()
        got = await callChat(cookie, q)
        got.elapsedMs = Date.now() - _t0
        ledger.markChatEnd(q.id, got.status)
      }
      // ⛔ A QUESTION THAT NEVER GOT AN ANSWER CANNOT BE GRADED — `graded: false` is not optional here.
      // MEASURED 2026-08-01: the Anthropic credit balance ran out mid-run and 18 of 100 questions came back
      // HTTP 500/0. Without this flag they fell through as `{pass:false}` with `graded` UNDEFINED, and
      // `sc.graded !== false` counted every one of them as a GRADED FAILURE. The scorecard printed 9/40 = 22.5%
      // when the real result was 9/22 — an account balance and a network timeout scored as if Lora had answered
      // wrongly. A harness that turns its own outage into the subject's failure is worse than one that crashes.
      let sc = (got.status === 200 || q.assert.type === 'autofail') ? score(q, got.response || '', card)
                : { pass: false, graded: false, detail: `NOT GRADED — no answer received: HTTP ${got.status} ${got.error || got.response}` }
      // LORAMER_EVAL_BOUNDARY_JUDGE_V1 — the judge runs ONLY for `boundary`, and only on a real 200. A judge
      // asked to grade an HTTP failure would score the harness, not the answer.
      let judged = null
      if (sc.deferred && got.status === 200) {
        judged = await judgeBoundary({
          root: ROOT, apiKey: envVal('ANTHROPIC_API_KEY'), question: q.message,
          rubric: q.assert.rubric, mustNotAssert: q.assert.mustNotAssert, answer: got.response || '',
        })
        if (judged?.usage) ledger.recordJudge(q.id, JUDGE_MODEL, judged.usage)
        sc = { pass: judged.verdict === 'PASS', graded: judged.verdict !== 'PARSE_ERROR', detail: `${judged.verdict} · ${judged.classification || '-'} · ${judged.taxonomy || '-'} · ${judged.reason}` }
      } else if (sc.deferred) {
        sc = { pass: false, graded: false, detail: `judge NOT run — HTTP ${got.status}` }
      }
      const graded = sc.graded !== false && sc.pass !== null
      results.push({ id: q.id, cat: q.cat, axis: q.axis || 'correctness', scored: q.scored !== false, graded,
        assertType: q.assert.type, client: q.clientName, message: q.message,
        pass: sc.pass, detail: sc.detail, judge: judged,
        httpStatus: got.status, elapsedMs: got.elapsedMs ?? null, response: got.response,
        card: card && { spend: card.spend, revenue: card.revenue, roas: card.roas },
        upload: up ? { file: q.upload, status: up.status, truncated: !!up.body?.truncated } : undefined })
      console.log(!graded ? (q.assert.type === 'ungraded' ? 'UNGRADED' : 'NOT-GRADED') : sc.pass ? 'PASS' : 'FAIL')
    }
  } finally {
    for (const cid of uploadClients) {
      const before = await currentNotes(cid)
      await restoreCtx(cid, snaps[cid])
      const after = await currentNotes(cid)
      const clean = (after.notes ?? null) === (snaps[cid].notes ?? null) && after.existed === snaps[cid].existed
      console.log(`[hygiene] restore ${cid}: during-run-had-upload=${(before.notes || '').includes('[Uploaded:')} → restored-to-pre-state=${clean}`)
    }
  }
  // ── SCORECARD ────────────────────────────────────────────────────────────────────────────────────────
  // ⛔ THE DENOMINATOR IS THE WHOLE POINT. `graded` questions are the ONLY ones that may enter a percentage.
  // On the V2 set that is ~22 of 100 — the other 77 have no ground truth yet and 2 are unscored by design.
  // A percentage over 22 presented as an accuracy figure for a 100-question set is a lie by denominator, and
  // it is the exact shape of every misleading eval number this project has banked a law against.
  const gradedResults = results.filter((r) => r.graded)
  const ungradedResults = results.filter((r) => !r.graded)
  const cats = {}
  for (const r of gradedResults) { (cats[r.cat] ||= { p: 0, n: 0 }); cats[r.cat].n++; if (r.pass) cats[r.cat].p++ }
  const overallP = gradedResults.filter(r => r.pass).length, overallN = gradedResults.length
  const stamp = process.env.STAMP || 'run'
  const outFile = path.join(ROOT, `tests/lora-evals/results/results-${stamp}.json`)
  fs.mkdirSync(path.dirname(outFile), { recursive: true })
  fs.writeFileSync(outFile, JSON.stringify({ base: BASE, owner: OWNER, cats, overall: { pass: overallP, n: overallN }, results }, null, 2))  // spend appended after reconcile
  console.log('\n================ LORA EVAL SCORECARD ================')
  const CATNAME = { A: 'A basic-accuracy/surface-sync', B: 'B honesty/false-zero', C: 'C four-source ROAS', D: 'D Meta dedup', E: 'E doc/COGS', F: 'F comparisons/windows' }
  for (const c of Object.keys(cats).sort()) {
    const { p, n } = cats[c]; const pct = Math.round((p / n) * 1000) / 10
    const gate = pct >= 90 ? 'PASS' : 'FAIL'
    console.log(`  ${CATNAME[c] || c}: ${p}/${n} = ${pct}%  [gate≥90%: ${gate}]`)
  }
  const opct = overallN ? Math.round((overallP / overallN) * 1000) / 10 : 0
  const w = wilson(overallP, overallN)
  console.log(`  OVERALL (GRADED ONLY): ${overallP}/${overallN} = ${opct}%`)
  console.log(`  95% Wilson interval: ${(w.low * 100).toFixed(1)}% – ${(w.high * 100).toFixed(1)}%`)
  if (ungradedResults.length) {
    const ung = ungradedResults.filter((r) => r.assertType === 'ungraded' && r.httpStatus === 200).length
    const noAnswer = results.filter((r) => r.httpStatus !== 200).length
    const unscored = ungradedResults.length - ung - noAnswer
    console.log('')
    console.log(`  ⛔ DENOMINATOR: ${overallN} of ${results.length} questions are graded.`)
    console.log(`     ${ung} ran with NO GROUND TRUTH (correctness axis UNGRADED — answers recorded, not scored)`)
    // NO ANSWER IS ITS OWN BUCKET, never folded into pass/fail. See the graded:false comment in the run loop.
    if (noAnswer) console.log(`     ⛔ ${noAnswer} GOT NO ANSWER AT ALL (HTTP error/timeout) — NOT gradeable, NOT failures`)
    if (unscored > 0) console.log(`     ${unscored} unscored by design (see per-question detail)`)
    console.log(`     ⚠ ${opct}% IS NOT AN ACCURACY FIGURE FOR THIS SET. It is the pass rate on the ${overallN}`)
    console.log('       boundary/calibration questions only. Do not quote it as the set\'s accuracy.')
  }
  // ── ADVERSARIAL, INDIVIDUALLY — three-way, never rolled into a rate ──────────────────────────────────
  const adv = results.filter((r) => r.axis === 'adversarial' && r.judge)
  if (adv.length) {
    console.log('\n---- ADVERSARIAL, PER QUESTION ----')
    for (const r of adv) {
      console.log(`  [${r.id}] ${r.judge.verdict.padEnd(5)} ${String(r.judge.classification || '-').padEnd(15)} ${r.judge.reason}`)
    }
    const byCls = {}
    for (const r of adv) { const k = r.judge.classification || 'PARSE_ERROR'; byCls[k] = (byCls[k] || 0) + 1 }
    console.log(`  roll-up: ${Object.entries(byCls).map(([k, v]) => `${k}=${v}`).join(' · ')}`)
  }
  // ── FAILURE TAXONOMY — judge-assigned, not hand-labelled after the fact ──────────────────────────────
  const failed = results.filter((r) => r.graded && !r.pass)
  if (failed.length) {
    const byTax = {}
    for (const r of failed) { const k = r.judge?.taxonomy || 'UNCLASSIFIED'; (byTax[k] ||= []).push(r.id) }
    console.log('\n---- FAILURE TAXONOMY ----')
    for (const k of [...TAXONOMY, 'UNCLASSIFIED']) if (byTax[k]) console.log(`  ${k}: ${byTax[k].length} — ${byTax[k].join(', ')}`)
  }
  console.log(`\n---- JUDGE SPEND ----`)
  console.log(`  ${judgeSpend.calls} calls · in ${judgeSpend.input} · out ${judgeSpend.output} tokens (${JUDGE_MODEL})`)
  // LORAMER_EVAL_SPEND_LEDGER_V1 — reconcile the run against anthropic_spend_log and report cost PER QUESTION.
  // The ledger is UNCHANGED and UNREAD by production; this is a read-only attribution pass at the harness layer.
  const rec = await ledger.reconcile({ sbUrl: SB_URL, sbHeaders: SBH, runEnd: new Date().toISOString() })
  const spendReport = ledger.report(rec)
  console.log(spendReport.text)
  // ⛔ A RUN THAT CANNOT REPORT ITS COST FAILS LOUDLY. Same rule as an empty result carrying its denominator:
  // the summary may not read clean while the number is silently missing. Results are still written first, so a
  // costing failure never destroys the run's answers.
  if (!spendReport.measured) {
    fs.writeFileSync(outFile, JSON.stringify({ base: BASE, owner: OWNER, cats, overall: { pass: overallP, n: overallN }, spend: { measured: false, reason: rec?.reason }, results }, null, 2))
    console.error('\n❌ RUN COST NOT MEASURED — see the reason above. The scorecard stands; the cost does not.')
    console.error('   Exiting non-zero: a run summary without a cost must not read as a clean run.')
    process.exit(3)
  }
  console.log('\n---- FAILED QUESTIONS ----')
  for (const r of results.filter(x => !x.pass)) {
    console.log(`  [${r.id}/${r.cat}] ${r.client} — ${r.message}`)
    console.log(`     detail: ${r.detail}`)
    console.log(`     got: ${(r.response || '').replace(/\s+/g, ' ').slice(0, 240)}`)
  }
  console.log(`\nresults written: ${outFile}`)
}
main().catch(e => { console.error('HARNESS ERROR', e); process.exit(1) })
