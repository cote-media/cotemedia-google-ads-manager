// LORAMER_LORA_LLM_JUDGE_V1 — offline LLM-judge re-scorer for the Lora eval harness.
// Test harness only. ZERO prod blast radius: reads banked results files + golden-set, calls
// the Anthropic API directly to grade B/C/D (semantic) cases. NEVER calls /api/chat, never
// touches prod, never runs a new eval. A/E/F stay deterministic (their original pass carries).
//
// Usage:  node tests/lora-evals/rejudge.mjs <passes> <resultsFile ...>
//   passes       number of judge passes per case (stability check; default 1)
//   resultsFile  one or more results-*.json under tests/lora-evals/results/
//
// Judge contract: model claude-opus-4-8, STRICT JSON {"verdict":"PASS"|"FAIL","reason":"..."} only.
// Grades ONLY against the golden rubric + expected fact. Does NOT reward plausibility/fluency.
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import { createRequire } from 'module'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const REPO = path.resolve(__dirname, '../..')
const require = createRequire(path.join(REPO, 'package.json'))

// --- env: load ANTHROPIC_API_KEY from .env.local (never printed) --------------------------------
function loadEnvLocal() {
  const p = path.join(REPO, '.env.local')
  const txt = fs.readFileSync(p, 'utf8')
  for (const line of txt.split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/)
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^['"]|['"]$/g, '').trim()
  }
}
loadEnvLocal()
const KEY = process.env.ANTHROPIC_API_KEY
if (!KEY) { console.error('FATAL: ANTHROPIC_API_KEY not found in .env.local'); process.exit(1) }

const AnthropicMod = require('@anthropic-ai/sdk')
const Anthropic = AnthropicMod.default || AnthropicMod
const client = new Anthropic({ apiKey: KEY })

const JUDGE_MODEL = 'claude-opus-4-8'
// $/million tokens (verified 2026-07-14): opus-4-8 in 5 / out 25 / cacheRead 0.50 / cacheWrite5m 6.25
const RATE = { in: 5, out: 25, cacheRead: 0.5, cacheWrite: 6.25 }
const JUDGED_CATS = new Set(['B', 'C', 'D'])

const golden = JSON.parse(fs.readFileSync(path.join(__dirname, 'golden-set.json'), 'utf8'))
const byId = Object.fromEntries(golden.questions.map(q => [q.id, q]))

const cost = { in: 0, out: 0, cacheRead: 0, cacheWrite: 0, calls: 0 }
function addUsage(u) {
  if (!u) return
  cost.in += u.input_tokens || 0
  cost.out += u.output_tokens || 0
  cost.cacheRead += u.cache_read_input_tokens || 0
  cost.cacheWrite += u.cache_creation_input_tokens || 0
  cost.calls++
}
function usd() {
  return (cost.in * RATE.in + cost.out * RATE.out + cost.cacheRead * RATE.cacheRead + cost.cacheWrite * RATE.cacheWrite) / 1e6
}

const SYS = [
  'You are a STRICT evaluation judge for an analytics assistant named Lora.',
  'You grade ONE answer against ONE rubric. Grade ONLY against the RUBRIC and the EXPECTED FACT.',
  'Do NOT reward plausibility, fluency, confidence, or extra insight.',
  'Under-reporting, dropping, or replacing a captured/expected number is a FAIL even when the reasoning sounds smart.',
  'Fabricating a $0 or a count for data that does not exist is a FAIL.',
  'Output STRICT JSON on a single line and NOTHING ELSE (no markdown, no fences, no preamble):',
  '{"verdict":"PASS"|"FAIL","reason":"<=25 words citing the rubric clause that decided it"}',
].join(' ')

async function judgeOnce(q, response) {
  const a = q.assert
  const expectedLine = a.expected != null
    ? `EXPECTED FACT: the captured value is ${a.expected}.`
    : 'EXPECTED FACT: (none numeric — grade on the rubric).'
  const user = [
    `QUESTION: ${q.message}`,
    `RUBRIC (the answer MUST satisfy this): ${a.rubric}`,
    expectedLine,
    '',
    "LORA'S FULL ANSWER:",
    response || '(empty answer)',
    '',
    'Return ONLY the JSON verdict.',
  ].join('\n')
  const msg = await client.messages.create({
    model: JUDGE_MODEL,
    max_tokens: 400,
    system: SYS,
    messages: [{ role: 'user', content: user }],
  })
  addUsage(msg.usage)
  const text = (msg.content || []).filter(b => b.type === 'text').map(b => b.text).join('').trim()
  const jm = text.match(/\{[\s\S]*\}/)
  if (!jm) return { verdict: 'PARSE_ERROR', reason: text.slice(0, 120) }
  try {
    const p = JSON.parse(jm[0])
    const v = String(p.verdict || '').toUpperCase()
    return { verdict: v === 'PASS' || v === 'FAIL' ? v : 'PARSE_ERROR', reason: String(p.reason || '') }
  } catch (e) { return { verdict: 'PARSE_ERROR', reason: text.slice(0, 120) } }
}

async function rescoreFile(file, passes) {
  const abs = path.isAbsolute(file) ? file : path.join(__dirname, 'results', path.basename(file))
  const data = JSON.parse(fs.readFileSync(abs, 'utf8'))
  const rows = []
  for (const r of data.results) {
    const q = byId[r.id]
    if (!q) { rows.push({ id: r.id, cat: r.cat, mode: 'MISSING-GOLDEN', pass: r.pass, verdicts: [] }); continue }
    if (!JUDGED_CATS.has(r.cat)) {
      // A/E/F: deterministic — carry the original harness verdict unchanged
      rows.push({ id: r.id, cat: r.cat, mode: 'deterministic', pass: !!r.pass, verdicts: [] })
      continue
    }
    const verdicts = []
    for (let i = 0; i < passes; i++) verdicts.push(await judgeOnce(q, r.response || ''))
    const v0 = verdicts[0].verdict
    const stable = verdicts.every(v => v.verdict === v0)
    rows.push({
      id: r.id, cat: r.cat, mode: 'judge',
      pass: v0 === 'PASS', verdict1: v0, reason1: verdicts[0].reason,
      verdicts: verdicts.map(v => v.verdict), stable,
    })
  }
  return { file: path.basename(abs), rows }
}

function scorecard(rows) {
  const cats = {}
  for (const r of rows) {
    const c = cats[r.cat] || (cats[r.cat] = { pass: 0, total: 0 })
    c.total++; if (r.pass) c.pass++
  }
  return cats
}

const passes = parseInt(process.argv[2] || '1', 10)
const files = process.argv.slice(3)
if (!files.length) { console.error('usage: node rejudge.mjs <passes> <resultsFile ...>'); process.exit(1) }

const out = { passes, files: [], acceptance: {}, stability: { flips: [] } }
for (const f of files) {
  const res = await rescoreFile(f, passes)
  const cats = scorecard(res.rows)
  const catStr = Object.keys(cats).sort().map(c => {
    const { pass, total } = cats[c]
    return `${c}=${pass}/${total}(${Math.round(100 * pass / total)}%)`
  }).join('  ')
  const overallPass = res.rows.filter(r => r.pass).length
  console.log(`\n=== ${res.file} ===`)
  console.log(`overall ${overallPass}/${res.rows.length} (${Math.round(100 * overallPass / res.rows.length)}%)   ${catStr}`)
  // judged-case detail
  for (const r of res.rows.filter(r => r.mode === 'judge')) {
    const flag = r.stable ? '' : '  <<< FLIP'
    console.log(`  ${r.id} ${r.cat}  ${r.verdict1.padEnd(5)}  [${r.verdicts.join(',')}]${flag}  ${r.reason1}`)
    if (!r.stable) out.stability.flips.push({ file: res.file, id: r.id, verdicts: r.verdicts })
  }
  // acceptance anchors
  for (const id of ['D1', 'D2', 'B6']) {
    const r = res.rows.find(x => x.id === id)
    if (r) out.acceptance[`${res.file}:${id}`] = { verdict: r.verdict1 || (r.pass ? 'PASS' : 'FAIL'), reason: r.reason1 || '(deterministic)', verdicts: r.verdicts }
  }
  out.files.push({ file: res.file, cats, overall: `${overallPass}/${res.rows.length}` })
}

console.log(`\n=== JUDGE COST ===`)
console.log(`calls=${cost.calls}  in=${cost.in}  out=${cost.out}  cacheRead=${cost.cacheRead}  cacheWrite=${cost.cacheWrite}`)
console.log(`cost this run = $${usd().toFixed(4)}  (opus-4-8 @ $5/$25 per M)`)

fs.writeFileSync(path.join(__dirname, 'results', 'rejudge-report.json'), JSON.stringify({ ...out, cost: { ...cost, usd: usd() } }, null, 2) + '\n')
console.log(`\nwrote results/rejudge-report.json`)
