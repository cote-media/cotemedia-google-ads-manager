// LORAMER_LORA_L2_EVAL_HARNESS_V1 — SLICE 1 of the L2-RETRIEVAL eval.
//
// EXTENDS tests/lora-evals/, does not replace it. What it reuses, unchanged in mechanism:
//   · the REAL-PATH call (POST /api/chat with a minted next-auth cookie) — LAW 1, run-evals.mjs:155
//   · the NEXTAUTH_URL==BASE config guard, whose absence VOIDED a whole eval run once (banked defect #3 of the
//     seven 2026-07-14/15 misdiagnoses: the harness ran :3000 while the server ran :3111, buildClaudeContext was
//     never called, and every score was a lie about a prompt that never loaded)
//   · the client-block run order that warms the cacheable prefix (LORAMER_LORA_CACHE_WARM_REORDER_V1)
//   · the SHIPPED L2 instrument — src/lib/lora-tool-log.ts writes one lora_tool_decisions row per tool-loop turn
//     (tool_called, tool_name, family, turn_index). NO PRODUCT CODE IS TOUCHED to get the consult column; the
//     signal was already being persisted and nothing was joining it to a scored question.
//
// WHAT IS NEW HERE, and why each exists:
//   1. INDEPENDENT GROUND TRUTH. golden-set.json banks a hand-verified `expected` number. This runner instead
//      COMPUTES the answer from metrics_daily at run time from a `truth` spec. A number a human typed can be
//      wrong the same way the code is wrong; a number the DB computes cannot agree with Lora by coincidence.
//   2. THE CONSULT COLUMN. Per question: did she call a tool, or answer from the prebuilt prompt? A right answer
//      reached WITHOUT querying the store is marked LUCKY, not correct — that is the entire point of this slice.
//      L3 of the completeness audit measured that build-claude-context.ts never reads metrics_daily, so for a
//      captured-only family a from-context answer cannot be grounded even when it happens to be right.
//   3. PER-FAMILY ATTRIBUTION so a failure names the family, not just the question.
//
// GROUND TRUTH MIRRORS THE QUERY LAYER ON PURPOSE. Level resolution uses COARSEST-PRESENT, exactly as
// metrics-query.ts:495-518 does. That is deliberate and it is also the limit of this instrument: it proves Lora
// agrees with the store at the grain the query layer defines, NOT that the grain itself is the right one. The 4x
// inflation regression (DECISIONS LORAMER_BREAKDOWN_LEVEL_SCOPE_V1) is caught because a summed-across-levels
// answer differs from coarsest-present by a whole multiple — but a future bug that moved BOTH would pass here.
//
// COST: one /api/chat turn per question (+1 preflight), each turn up to 6 Anthropic calls (MAX=5 tool turns + the
// final). Zero Google/Meta/Shopify calls are made BY THE HARNESS — ground truth is pure DB. The real path itself
// still fetches live platform data, because that is what a customer hits; that is LAW 1, not a harness choice.
import { createRequire } from 'module'
import fs from 'fs'
import path from 'path'
const require = createRequire(import.meta.url)
const { encode } = require('next-auth/jwt')

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..', '..')
const BASE = process.env.BASE || 'http://localhost:3111'
const OWNER = process.env.OWNER || 'cotebrandmarketing@gmail.com'
const START = process.env.START || '2026-06-01'
const END = process.env.END || '2026-06-30'
const CALL_TIMEOUT_MS = 180000
const TOL_PCT = Number(process.env.TOL_PCT || 2)

const envFile = fs.readFileSync(path.join(ROOT, '.env.local'), 'utf8')
const envVal = (n) => { const m = envFile.match(new RegExp('^' + n + '=(.*)$', 'm')); return m ? m[1].trim().replace(/^["']|["']$/g, '') : '' }
const SB_URL = envVal('NEXT_PUBLIC_SUPABASE_URL') || envVal('SUPABASE_URL')
const SB_KEY = envVal('SUPABASE_SERVICE_ROLE_KEY')
const SBH = { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}` }
const abort = (m) => { console.error(`\n❌ L2 EVAL ABORTED — ${m}\n`); process.exit(2) }

function assertConfig() {
  const nextAuth = process.env.NEXTAUTH_URL || envVal('NEXTAUTH_URL')
  if (nextAuth !== BASE) abort(
    `NEXTAUTH_URL (${nextAuth || 'unset'}) must equal BASE (${BASE}).\n` +
    `  /api/chat loads its intelligence prompt via NEXTAUTH_URL. If it does not point at THIS server the prompt\n` +
    `  silently fails to load, the run tests only the tool path, and every score is a lie. (Banked: 2026-07-14 #3.)`)
  const model = process.env.LORA_CHAT_MODEL || envVal('LORA_CHAT_MODEL')
  const ALLOWED = new Set(['claude-opus-4-8', 'claude-opus-5'])
  if (model && !ALLOWED.has(model)) abort(`LORA_CHAT_MODEL (${model}) is off the ship/eval floor (${[...ALLOWED].join(', ')}).`)
  console.log(`[config] NEXTAUTH_URL == BASE ✓ · model=${model || '(server-side)'} · window=${START}..${END} · tol=±${TOL_PCT}%`)
}

// ── GROUND TRUTH — computed from metrics_daily, never from a banked constant ────────────────────────────────
// PAGINATED. PostgREST caps a response at its configured max-rows (1000 here) and returns the truncated page with
// a 200 — no error, no flag. The first version of this harness did NOT paginate and produced ga_landing_page =
// "1000 distinct landing pages", which is the CEILING wearing the costume of an answer (real: 27,299). It was
// caught only because 1000 is a suspiciously round number. Ground truth that silently truncates is worse than no
// ground truth: it would have scored Lora WRONG for being RIGHT. Range headers, loop until short page.
const PAGE = 1000
const sbRows = async (qs) => {
  const out = []
  for (let from = 0; ; from += PAGE) {
    const r = await fetch(`${SB_URL}/rest/v1/metrics_daily?${qs}`, {
      headers: { ...SBH, Range: `${from}-${from + PAGE - 1}`, 'Range-Unit': 'items' },
    })
    if (!r.ok && r.status !== 206) throw new Error(`metrics_daily ${r.status}: ${(await r.text()).slice(0, 200)}`)
    const page = await r.json()
    out.push(...page)
    if (page.length < PAGE) return out
    if (out.length > 2_000_000) throw new Error('ground-truth page loop exceeded 2M rows — refusing to continue')
  }
}
const LEVEL_ORDER = ['account', 'campaign', 'ad_group', 'ad_set', 'ad', 'keyword'] // metrics-query.ts:502, verbatim
async function coarsestLevel(clientId, platform, bt) {
  for (const lv of LEVEL_ORDER) {
    const rows = await sbRows(`select=entity_level&client_id=eq.${clientId}&platform=eq.${platform}&breakdown_type=eq.${encodeURIComponent(bt)}&entity_level=eq.${lv}&date=gte.${START}&date=lte.${END}&limit=1`)
    if (rows.length) return lv
  }
  return null
}
async function truthFor(q, spec) {
  const s = spec || q.truth
  if (s.kind === 'chain') return chainTruth(q)
  if (s.kind === 'multi') {
    const parts = []
    for (const p of s.parts) parts.push({ label: p.label, ...(await truthFor(q, { ...p, kind: 'sum' })) })
    return { kind: 'multi', parts }
  }
  const bt = s.breakdownType ?? ''
  const level = s.level === 'COARSEST' ? await coarsestLevel(q.clientId, s.platform, bt) : s.level
  if (!level) return { kind: s.kind, level: null, value: null, note: 'no rows at any level in window' }
  const sel = `select=breakdown_value,entity_id,spend,revenue,conversions,impressions,clicks`
  const rows = await sbRows(`${sel}&client_id=eq.${q.clientId}&platform=eq.${s.platform}&breakdown_type=eq.${encodeURIComponent(bt)}&entity_level=eq.${level}&date=gte.${START}&date=lte.${END}&limit=100000`)
  if (s.kind === 'distinct_values') return { kind: s.kind, level, value: new Set(rows.map(r => r.breakdown_value)).size }
  if (s.kind === 'distinct_entities') return { kind: s.kind, level, value: new Set(rows.map(r => r.entity_id)).size }
  const m = s.metric || 'spend'
  if (s.kind === 'sum') return { kind: s.kind, level, value: +rows.reduce((a, r) => a + Number(r[m] || 0), 0).toFixed(2) }
  if (s.kind === 'top') {
    const agg = new Map()
    for (const r of rows) agg.set(r.breakdown_value, (agg.get(r.breakdown_value) || 0) + Number(r[m] || 0))
    const sorted = [...agg.entries()].sort((a, b) => b[1] - a[1])
    return { kind: s.kind, level, label: sorted[0]?.[0] ?? null, value: sorted[0] ? +sorted[0][1].toFixed(2) : null, distinct: agg.size }
  }
  throw new Error('unknown truth kind ' + s.kind)
}

// ── SCORING — number extraction + tolerance, same posture as run-evals.mjs ──────────────────────────────────
const nums = (t) => [...String(t || '').matchAll(/-?\$?\s?\d[\d,]*(?:\.\d+)?/g)]
  .map(m => Number(m[0].replace(/[$,\s]/g, ''))).filter(Number.isFinite)
const hit = (list, exp, tol = TOL_PCT) => exp == null ? false
  : list.some(n => exp === 0 ? n === 0 : Math.abs(n - exp) / Math.abs(exp) * 100 <= tol)

function scoreOne(q, truth, text) {
  if (!text) return { verdict: 'unanswered', detail: 'empty response' }
  const found = nums(text)
  if (truth.kind === 'multi') {
    const landed = truth.parts.filter(p => hit(found, p.value))
    return { verdict: landed.length === truth.parts.length ? 'correct' : 'incorrect',
      detail: `${landed.length}/${truth.parts.length} parts matched: ${truth.parts.map(p => `${p.label}=${p.value}${hit(found, p.value) ? '✓' : '✗'}`).join(' · ')}`,
      partsLanded: landed.length, partsTotal: truth.parts.length }
  }
  if (truth.value == null) return { verdict: 'unanswered', detail: 'no ground truth in window' }
  const numOk = hit(found, truth.value)
  const labelOk = truth.label == null ? true : String(text).toLowerCase().includes(String(truth.label).toLowerCase())
  return { verdict: numOk && labelOk ? 'correct' : 'incorrect',
    detail: `expected ${truth.value}${truth.label ? ` (${truth.label})` : ''} @${truth.level} · numberMatch=${numOk}${truth.label ? ` labelMatch=${labelOk}` : ''}` }
}

// ── THE CONSULT COLUMN — read the SHIPPED instrument, no product code touched ───────────────────────────────
async function toolDecisions(clientId, sinceIso, untilIso) {
  const r = await fetch(`${SB_URL}/rest/v1/lora_tool_decisions?select=tool_called,tool_name,family,turn_index,created_at&client_id=eq.${clientId}&created_at=gte.${sinceIso}&created_at=lte.${untilIso}&order=turn_index.asc`, { headers: SBH })
  return r.ok ? r.json() : []
}

async function callChat(cookie, q) {
  const ctrl = new AbortController(); const t = setTimeout(() => ctrl.abort(), CALL_TIMEOUT_MS)
  try {
    const res = await fetch(`${BASE}/api/chat`, { method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: `next-auth.session-token=${cookie}` },
      body: JSON.stringify({ message: q.message, history: [], clientId: q.clientId, clientName: q.clientName, startDate: START, endDate: END, dateRange: 'CUSTOM', location: 'chat' }),
      signal: ctrl.signal })
    const j = await res.json().catch(() => ({}))
    return { status: res.status, response: j.response || '', error: j.error || null }
  } catch (e) { return { status: 0, response: '', error: String(e?.message || e) } }
  finally { clearTimeout(t) }
}


// ── (3) CHAIN GROUND TRUTH — six SEQUENTIALLY DEPENDENT steps, each resolved from the previous ──────────────
// Breadth cannot exercise MAX=5: Anthropic emits many tool_use blocks per turn and claude-tools.ts:321 counts
// TURNS. Only a dependency chain forces turn count. Each step is computed here the same way the query layer would.
async function chainTruth(q) {
  const W = `&date=gte.${START}&date=lte.${END}`
  const topBy = (rows, key, metric) => {
    const g = new Map()
    for (const r of rows) g.set(r[key], (g.get(r[key]) || 0) + Number(r[metric] || 0))
    const s = [...g.entries()].sort((a, b) => b[1] - a[1])[0]
    return s ? { label: s[0], value: +s[1].toFixed(2) } : { label: null, value: null }
  }
  const base = (lv) => `select=entity_id,entity_name,parent_entity_id,breakdown_value,spend&client_id=eq.${q.clientId}&platform=eq.google&entity_level=eq.${lv}`
  // 1 top campaign
  const camps = await sbRows(`${base('campaign')}&breakdown_type=eq.${W}`)
  const cg = new Map(); const cname = new Map()
  for (const r of camps) { cg.set(r.entity_id, (cg.get(r.entity_id) || 0) + Number(r.spend || 0)); cname.set(r.entity_id, r.entity_name) }
  const cTop = [...cg.entries()].sort((a, b) => b[1] - a[1])[0]
  const campId = cTop?.[0]
  const s1 = { label: cname.get(campId) || campId, value: cTop ? +cTop[1].toFixed(2) : null }
  // 2 top ad group INSIDE that campaign
  const ags = await sbRows(`${base('ad_group')}&breakdown_type=eq.&parent_entity_id=eq.${campId}${W}`)
  const ag = new Map(); const aname = new Map()
  for (const r of ags) { ag.set(r.entity_id, (ag.get(r.entity_id) || 0) + Number(r.spend || 0)); aname.set(r.entity_id, r.entity_name) }
  const aTop = [...ag.entries()].sort((a, b) => b[1] - a[1])[0]
  const agId = aTop?.[0]
  const s2 = { label: aname.get(agId) || agId, value: aTop ? +aTop[1].toFixed(2) : null }
  // 3/4/5 keyword · search_term · device INSIDE that ad group   6 hour back at that campaign
  const kw = await sbRows(`${base('ad_group')}&breakdown_type=eq.keyword&entity_id=eq.${agId}${W}`)
  const st = await sbRows(`${base('ad_group')}&breakdown_type=eq.search_term&entity_id=eq.${agId}${W}`)
  const dv = await sbRows(`${base('ad_group')}&breakdown_type=eq.device&entity_id=eq.${agId}${W}`)
  const hr = await sbRows(`${base('campaign')}&breakdown_type=eq.hour&entity_id=eq.${campId}${W}`)
  const parts = [
    { label: 'top campaign', ...s1 },
    { label: 'top ad group in it', ...s2 },
    { label: 'top keyword in that ad group', ...topBy(kw, 'breakdown_value', 'spend') },
    { label: 'top search term in that ad group', ...topBy(st, 'breakdown_value', 'spend') },
    { label: 'top device in that ad group', ...topBy(dv, 'breakdown_value', 'spend') },
    { label: 'top hour in that campaign', ...topBy(hr, 'breakdown_value', 'spend') },
  ]
  // GUARD: a multi-part question whose parts are not distinguishable cannot be scored positionally. The FIRST
  // L10 failed exactly here — 6 parts, 3 distinct values, so one emitted number satisfied three of them.
  const vals = parts.map((p) => p.value).filter((v) => v != null)
  const distinct = new Set(vals).size
  return { kind: 'chain', parts, distinctValues: distinct, scorable: distinct === vals.length && vals.length === 6 }
}

// ── (2) LLM JUDGE — reuses the rejudge.mjs contract (LORAMER_LORA_LLM_JUDGE_V1, validated 117x3 zero flips) ──
// Number-in-text cannot tell whether the RIGHT number was attributed to the RIGHT question. The judge is given
// the DB-computed truth and must check attribution, not presence. Judge spend is metered separately.
const JUDGE_MODEL = process.env.JUDGE_MODEL || 'claude-opus-4-8'
const judgeSpend = { calls: 0, input: 0, output: 0 }
let _anthropic = null
async function anthropic() {
  if (_anthropic) return _anthropic
  const { default: Anthropic } = await import(path.join(ROOT, 'node_modules/@anthropic-ai/sdk/index.mjs'))
  _anthropic = new Anthropic({ apiKey: envVal('ANTHROPIC_API_KEY') })
  return _anthropic
}
async function judge(q, truth, answer) {
  const expected = truth.kind === 'chain' || truth.kind === 'multi'
    ? truth.parts.map((p, i) => `${i + 1}. ${p.label} = ${p.value}${p.label && truth.kind === 'chain' ? '' : ''}`).join('\n')
    : `${truth.value}${truth.label ? ` (label: ${truth.label})` : ''} at entity_level=${truth.level}`
  const sys = 'You grade a data assistant against DB-computed ground truth. Return ONLY strict JSON: ' +
    '{"verdict":"PASS"|"FAIL","attribution":"OK"|"MISATTRIBUTED"|"NA","reason":"<=30 words"}. ' +
    'PASS only if every expected value appears AND is attributed to the CORRECT item/step. A number that is present ' +
    'but attached to the wrong step is MISATTRIBUTED and FAILS. Tolerance +-2% on numbers. Do not reward fluency.'
  const msg = [`QUESTION:\n${q.message}`, `\nGROUND TRUTH (computed from the database, authoritative):\n${expected}`,
    `\nASSISTANT ANSWER:\n${answer || '(empty)'}`, '\nReturn ONLY the JSON verdict.'].join('\n')
  try {
    const c = await anthropic()
    const r = await c.messages.create({ model: JUDGE_MODEL, max_tokens: 400, system: sys, messages: [{ role: 'user', content: msg }] })
    judgeSpend.calls++; judgeSpend.input += r.usage?.input_tokens || 0; judgeSpend.output += r.usage?.output_tokens || 0
    const t = (r.content || []).map((b) => b.text || '').join('')
    const m = t.match(/\{[\s\S]*\}/)
    if (!m) return { verdict: 'PARSE_ERROR', attribution: 'NA', reason: t.slice(0, 100) }
    const p = JSON.parse(m[0])
    const v = String(p.verdict || '').toUpperCase()
    return { verdict: v === 'PASS' || v === 'FAIL' ? v : 'PARSE_ERROR', attribution: String(p.attribution || 'NA').toUpperCase(), reason: String(p.reason || '') }
  } catch (e) { return { verdict: 'PARSE_ERROR', attribution: 'NA', reason: String(e?.message || e).slice(0, 100) } }
}

// ── (4) BEHAVIOURAL PREFLIGHT — ported from run-evals.mjs:89. The config guard proves the URL matches; only this
// proves the intelligence PROMPT actually loaded. Its absence is banked defect #3 of 2026-07-14 (a whole run void).
async function preflight(cookie) {
  if (process.env.PREFLIGHT === 'off') { console.log('[preflight] skipped (PREFLIGHT=off)'); return }
  const got = await callChat(cookie, { message: 'PREFLIGHT CHECK: reply with the single token INTEL_LOADED if you can see this client’s configured business profile / connection status in your context, otherwise reply INTEL_MISSING. One token only.', clientId: '23c697bb-5255-4289-9329-659544ba8e6e', clientName: 'Shelley Kyle' })
  const ok = /INTEL_LOADED/i.test(got.response || '')
  console.log(`[preflight] intelligence prompt loaded: ${ok} · "${(got.response || '').replace(/\s+/g, ' ').slice(0, 50)}"`)
  if (!ok) abort('preflight: /api/chat did not reflect the intelligence prompt — it likely fell back to the tool-only path.')
}

async function main() {
  assertConfig()
  const seed = JSON.parse(fs.readFileSync(path.join(ROOT, 'tests/lora-evals/l2-seed-set.json'), 'utf8'))
  const cookie = await encode({ token: { email: OWNER, name: 'L2Eval', sub: 'l2eval-' + OWNER }, secret: envVal('NEXTAUTH_SECRET') })
  await preflight(cookie)

  // client-block order — warms each client's cacheable prefix once (run-evals.mjs pattern)
  const order = [], byClient = new Map()
  for (const q of seed.questions) { if (!byClient.has(q.clientId)) { byClient.set(q.clientId, []); order.push(q.clientId) } byClient.get(q.clientId).push(q) }
  const runOrder = order.flatMap(c => byClient.get(c))
  console.log(`[order] ${runOrder.length} questions in ${order.length} client blocks\n`)

  const results = []
  for (const q of runOrder) {
    const truth = await truthFor(q)
    const t0 = new Date(Date.now() - 1000).toISOString()
    const got = await callChat(cookie, q)
    await new Promise(r => setTimeout(r, 2500)) // the instrument is FIRE-AND-FORGET; give the insert time to land
    const t1 = new Date(Date.now() + 1000).toISOString()
    const decisions = await toolDecisions(q.clientId, t0, t1)
    const consulted = decisions.some(d => d.tool_called)
    const sc = scoreOne(q, truth, got.response)
    const jv = await judge(q, truth, got.response)
    // JUDGE IS AUTHORITATIVE; the number matcher is kept only as a disagreement signal.
    const verdict = jv.verdict === 'PASS' ? 'correct' : jv.verdict === 'FAIL' ? 'incorrect' : sc.verdict
    // CEILING: MAX=5 turns (claude-tools.ts:321). Did we reach it, and did she SAY she stopped early?
    const ceilingHit = decisions.length >= 5
    const disclosed = /couldn.t (?:complete|finish)|unable to (?:complete|retrieve all)|only (?:got|retrieved|able)|ran out of|stopped short|could not fetch all|limit/i.test(got.response || '')
    // A right answer reached WITHOUT touching the store is LUCKY, not correct — the whole point of this column.
    const grounded = verdict === 'correct' && consulted
    const row = { id: q.id, platform: q.platform, family: q.family, trait: q.trait, status: got.status,
      verdict, judge: jv, numberMatcher: sc.verdict, judgeAgreesWithMatcher: (jv.verdict==='PASS')===(sc.verdict==='correct'),
      ceilingHit, disclosedEarlyStop: disclosed, grounded, consultedStore: consulted,
      toolNames: [...new Set(decisions.filter(d => d.tool_called).map(d => d.tool_name))],
      toolTurns: decisions.length, loggedFamily: decisions[0]?.family ?? null,
      truth, detail: sc.detail, partsLanded: sc.partsLanded, partsTotal: sc.partsTotal,
      answer: (got.response || got.error || '').replace(/\s+/g, ' ').slice(0, 400) }
    results.push(row)
    console.log(`${verdict === 'correct' ? (consulted ? '✓' : '⚠LUCKY') : verdict === 'unanswered' ? '—' : '✗'} ${q.id} ${q.platform}/${q.family}` +
      `  store=${consulted ? 'YES' : 'NO'} turns=${row.toolTurns}${ceilingHit ? ' CEILING' : ''}${row.toolNames.length ? ' [' + row.toolNames.join(',') + ']' : ''}` +
      `\n    judge=${jv.verdict} attr=${jv.attribution} — ${jv.reason}` +
      `${row.judgeAgreesWithMatcher ? '' : `\n    ⚠ judge DISAGREES with number-matcher (${sc.verdict}): ${sc.detail}`}`)
  }

  const n = results.length
  const correct = results.filter(r => r.verdict === 'correct').length
  const grounded = results.filter(r => r.grounded).length
  const lucky = results.filter(r => r.verdict === 'correct' && !r.consultedStore).length
  const consulted = results.filter(r => r.consultedStore).length
  console.log(`\n════ SCORECARD ════`)
  console.log(`  correct           ${correct}/${n}  (${(correct / n * 100).toFixed(1)}%)`)
  console.log(`  incorrect         ${results.filter(r => r.verdict === 'incorrect').length}/${n}`)
  console.log(`  unanswered        ${results.filter(r => r.verdict === 'unanswered').length}/${n}`)
  console.log(`  ── the column that matters ──`)
  console.log(`  consulted store   ${consulted}/${n}  (${(consulted / n * 100).toFixed(1)}%)`)
  console.log(`  GROUNDED-correct  ${grounded}/${n}  (${(grounded / n * 100).toFixed(1)}%)   <- correct AND queried`)
  console.log(`  LUCKY-correct     ${lucky}/${n}   <- right answer, never touched the store`)
  const ceil = results.filter(r => r.ceilingHit)
  console.log(`  ── MAX=5 ceiling ──`)
  console.log(`  ceiling hit       ${ceil.length}/${n}${ceil.length ? ' (' + ceil.map(r => r.id + '@' + r.toolTurns + ' turns, disclosed=' + r.disclosedEarlyStop + ')').join(' ') + ')' : ''}`)
  const jc = (judgeSpend.input * 5 + judgeSpend.output * 25) / 1e6
  console.log(`  ── judge cost (separate) ──`)
  console.log(`  judge calls ${judgeSpend.calls} · in ${judgeSpend.input} · out ${judgeSpend.output} · $${jc.toFixed(4)} (${JUDGE_MODEL})`)
  console.log(`  matcher/judge disagreements: ${results.filter(r => !r.judgeAgreesWithMatcher).length}`)
  console.log(`\n  per-family:`)
  for (const r of results) console.log(`    ${r.platform}/${r.family} — ${r.verdict}${r.consultedStore ? '' : ' (no store query)'}`)

  const out = path.join(ROOT, 'tests/lora-evals/results/l2-slice1.json')
  fs.writeFileSync(out, JSON.stringify({ base: BASE, owner: OWNER, window: { START, END },
    totals: { n, correct, incorrect: n - correct - results.filter(r => r.verdict === 'unanswered').length,
      unanswered: results.filter(r => r.verdict === 'unanswered').length, consulted, grounded, lucky }, results }, null, 2))
  console.log(`\n  written: ${out}`)
}
main().catch(e => abort(e?.stack || String(e)))
