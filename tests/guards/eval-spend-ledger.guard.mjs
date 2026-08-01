#!/usr/bin/env node
// LORAMER_EVAL_SPEND_LEDGER_V1 — GUARD. Two copies of a price table is a drift risk; this is the enforcer.
//
// ⛔ WHY A SECOND COPY EXISTS AT ALL, stated so the next reader does not "fix" it by deleting one: the eval
// harness runs OUTSIDE Next, as plain .mjs, and cannot import `src/lib/spend-logger.ts` without a build step.
// So `tests/lora-evals/spend-ledger.mjs` carries its own RATES. That is a deliberate duplication with a known
// failure mode — Anthropic changes a rate, someone updates MODEL_PRICING, and the harness silently keeps
// pricing runs at the old rate. A mispriced run is worse than an uncosted one, because it looks like an answer.
//
// THE PRECEDENT THIS FOLLOWS: MODEL_PRICING's own header records that 4.6/4.7 sat STALE at $15/$75 while the
// published rate was $5/$25, and that an unmapped model logs $0 and "cost lies (banked law)". Same class.
//
// THREE LEGS:
//  (a) EVERY model priced in MODEL_PRICING is priced IDENTICALLY in the harness RATES (input/output/cacheRead/
//      cacheWrite5m, all four). A model the harness prices differently would mis-cost every run it appears in.
//  (b) THE HARNESS NEVER SILENTLY PRICES AT ZERO — `costOf` must return an explicit unpriced marker for an
//      unknown model rather than 0, and the report must surface it.
//  (c) A RUN THAT CANNOT COST ITSELF MUST FAIL LOUDLY — run-evals must exit non-zero when the reconcile fails,
//      never print a scorecard and stop. Same rule as an empty result carrying its denominator.
//
// ⛔ NOT CHECKED: whether the rates match ANTHROPIC. Nothing in this repo can know that — it is a vendor fact
// and its home is the MODEL_PRICING header's dated verification note. This guard only proves the two copies
// agree with each other.

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const ROOT = process.env.LORAMER_GUARD_ROOT || process.cwd()
const findings = []
const read = (p) => { try { return readFileSync(resolve(ROOT, p), 'utf8') } catch { return '' } }

const loggerSrc = read('src/lib/spend-logger.ts')
const ledgerSrc = read('tests/lora-evals/spend-ledger.mjs')
if (!loggerSrc) findings.push('OWNER-READ FAILED: src/lib/spend-logger.ts unreadable — cannot compare price tables.')
if (!ledgerSrc) findings.push('OWNER-READ FAILED: tests/lora-evals/spend-ledger.mjs unreadable.')

// Parse `'model': { input: N, output: N, cacheRead: N, cacheWrite5m: N }` out of both files.
const parseRates = (src) => {
  const out = {}
  for (const m of src.matchAll(/'([a-z0-9.\-]+)':\s*\{([^}]*)\}/gi)) {
    const body = m[2]
    if (!/input:/.test(body) || !/output:/.test(body)) continue
    const num = (k) => { const x = body.match(new RegExp(`${k}:\\s*([0-9.]+)`)); return x ? Number(x[1]) : null }
    out[m[1]] = { input: num('input'), output: num('output'), cacheRead: num('cacheRead'), cacheWrite5m: num('cacheWrite5m') }
  }
  return out
}

if (loggerSrc && ledgerSrc) {
  const prod = parseRates(loggerSrc)
  const harness = parseRates(ledgerSrc)
  const prodModels = Object.keys(prod)
  if (prodModels.length === 0) findings.push('(a) parsed ZERO models out of MODEL_PRICING — the matcher is broken, and a guard that compares nothing passes for the wrong reason.')
  for (const model of prodModels) {
    const h = harness[model]
    if (!h) {
      findings.push(`(a) MODEL_PRICING prices '${model}' and the harness RATES do NOT. A run that answers on that model would be costed at $0 or refused. Add it to tests/lora-evals/spend-ledger.mjs.`)
      continue
    }
    for (const field of ['input', 'output', 'cacheRead', 'cacheWrite5m']) {
      if (prod[model][field] !== h[field]) {
        findings.push(`(a) RATE DRIFT on '${model}'.${field}: production MODEL_PRICING says ${prod[model][field]}, harness RATES says ${h[field]}. Every eval run since the change has been mispriced, and a mispriced run looks like an answer.`)
      }
    }
  }
}

// ── (b) NO SILENT ZERO ────────────────────────────────────────────────────────────────────────────────
if (ledgerSrc) {
  const costOfBody = (ledgerSrc.match(/export function costOf[\s\S]*?\n\}/) || [''])[0]
  const noComments = costOfBody.split('\n').filter((l) => !/^\s*\/\//.test(l)).join('\n')
  if (!/unpriced:\s*true/.test(noComments)) {
    findings.push('(b) costOf() does not return an `unpriced: true` marker for an unknown model. Returning 0 for a model it cannot price is how a run reports a confident, wrong, cheap-looking total.')
  }
  if (/return\s+0\b/.test(noComments) && !/usd:\s*null/.test(noComments)) {
    findings.push('(b) costOf() returns a bare 0 for an unknown model instead of a null cost plus an unpriced flag.')
  }
}

// ── (c) A RUN THAT CANNOT COST ITSELF FAILS LOUDLY ────────────────────────────────────────────────────
{
  const runner = read('tests/lora-evals/run-evals.mjs')
  const noComments = runner.split('\n').filter((l) => !/^\s*\/\//.test(l)).join('\n')
  if (!/spendReport\.measured/.test(noComments)) {
    findings.push('(c) run-evals.mjs does not check `spendReport.measured` — a run whose cost could not be measured would print a clean scorecard with the cost silently absent.')
  }
  if (!/measured[\s\S]{0,400}process\.exit\(/.test(noComments)) {
    findings.push('(c) run-evals.mjs does not EXIT NON-ZERO when the cost could not be measured. Printing the failure and exiting 0 makes it invisible to any caller that checks status — the same defect one level out.')
  }
  if (!/ledger\.markChatStart/.test(noComments) || !/ledger\.markChatEnd/.test(noComments)) {
    findings.push('(c) run-evals.mjs no longer brackets the chat call with markChatStart/markChatEnd — without both, ledger rows cannot be attributed to questions and the aborted-but-billed case becomes unmeasurable again.')
  }
  if (!/ledger\.recordJudge/.test(noComments)) {
    findings.push('(c) run-evals.mjs no longer records judge usage. The judge never touches /api/chat, so if the harness does not record it, its cost exists in NO ledger anywhere.')
  }
}

if (findings.length) {
  console.error(`[eval-spend-ledger] FAIL — ${findings.length} finding(s):`)
  for (const f of findings) console.error(`  · ${f}`)
  process.exit(1)
}
console.log('[eval-spend-ledger] PASS — harness RATES match production MODEL_PRICING on every model and field; costOf refuses to price an unknown model at zero; and a run that cannot cost itself exits non-zero.')
