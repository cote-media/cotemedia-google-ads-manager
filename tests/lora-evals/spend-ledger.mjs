// LORAMER_EVAL_SPEND_LEDGER_V1 — the harness reports what its own run cost, per question.
//
// ⛔ WHY THIS EXISTS. Eval run 1 (2026-08-01) cost $20.84 and it took an hour of forensic SQL afterwards to
// find that out — and the first answer given was WRONG ("chat-side spend is not recoverable"). A run that
// cannot tell you what it cost is the same defect as a capture pass that reports zero without its denominator:
// the number is missing and nothing says so. This module is that denominator.
//
// TWO GAPS IT CLOSES, both measured on run 1:
//   1. THE JUDGE IS INVISIBLE TO `anthropic_spend_log`. `logSpend` lives in /api/chat and /api/insight; the
//      judge calls the Anthropic SDK directly from the harness and never touches either, so its 22 calls and
//      $0.33 appear in no ledger anywhere. Recorded here at the call site instead.
//   2. THE LEDGER HAS NO QUESTION ID, so "what did the 7 discarded answers cost" was a BOUND, not a lookup.
//      Fixed by attributing ledger rows to questions by TIME WINDOW — see the reconcile note below.
//
// ⛔ DESIGN CONSTRAINT, and it shapes everything: `anthropic_spend_log` and `logSpend` MUST NOT CHANGE, and
// /api/chat does not return usage to its caller (it returns `{response, model, fellBack}` — verified). So the
// harness cannot read chat usage from the response, and adding it would mean changing a production API shape
// for a test harness's benefit. INSTEAD: the harness timestamps each chat call, and after the run it reads the
// ledger for the run window and attributes each row to the question whose window contains it. Questions run
// STRICTLY SEQUENTIALLY, so the mapping is unambiguous.
//
// ⛔ AND THIS IS WHAT MAKES THE ABORTED-BUT-BILLED CASE MEASURABLE. The harness aborts at 120s; the SERVER
// keeps going and bills. Its ledger row lands AFTER the harness gave up, so a row inside an aborted question's
// window is exactly the evidence that we paid for an answer we threw away. Run 1 had seven of those and could
// only bound their cost. Now it is a lookup.
//
// ⚠ HONEST LIMIT OF TIME-WINDOW ATTRIBUTION: it is correct only while questions are sequential. If this
// harness is ever made concurrent, the windows overlap and the attribution silently becomes guesswork. The
// reconcile refuses to run if it detects overlapping windows rather than producing a plausible wrong answer.

import { readFileSync } from 'node:fs'

// Rates MIRROR src/lib/spend-logger.ts MODEL_PRICING. ⚠ A SECOND COPY OF A PRICE TABLE IS A DRIFT RISK and is
// named as one: the harness runs OUTSIDE Next and cannot import a .ts module without a build step. The guard
// asserts the two stay equal, so drift fails the build rather than mispricing a run in silence.
export const RATES = {
  'claude-opus-5':    { input: 5.00, output: 25.00, cacheRead: 0.50, cacheWrite5m: 6.25 },
  'claude-opus-4-8':  { input: 5.00, output: 25.00, cacheRead: 0.50, cacheWrite5m: 6.25 },
  'claude-opus-4-7':  { input: 5.00, output: 25.00, cacheRead: 0.50, cacheWrite5m: 6.25 },
  'claude-opus-4-6':  { input: 5.00, output: 25.00, cacheRead: 0.50, cacheWrite5m: 6.25 },
  'claude-sonnet-4-6': { input: 3.00, output: 15.00, cacheRead: 0.30, cacheWrite5m: 3.75 },
  'claude-haiku-4-5': { input: 1.00, output: 5.00, cacheRead: 0.10, cacheWrite5m: 1.25 },
  // ⛔ THE DATED ALIASES ARE NOT OPTIONAL, and I left them out on the first pass — the guard caught it.
  // MODEL_PRICING carries both the bare name and the dated id because `logSpend` records whatever the model
  // chain actually answered with, which can be either form. A missing alias here prices a real run at $0.
  'claude-haiku-4-5-20251001': { input: 1.00, output: 5.00, cacheRead: 0.10, cacheWrite5m: 1.25 },
  'claude-sonnet-4-6-20251022': { input: 3.00, output: 15.00, cacheRead: 0.30, cacheWrite5m: 3.75 },
}

export function costOf(model, u) {
  const r = RATES[model]
  // ⛔ NEVER PRICE AN UNKNOWN MODEL AT $0. A silent zero is the failure this whole module exists to stop.
  if (!r) return { usd: null, unpriced: true }
  const usd =
    (u.input || 0) / 1e6 * r.input +
    (u.output || 0) / 1e6 * r.output +
    (u.cacheRead || 0) / 1e6 * r.cacheRead +
    (u.cacheWrite || 0) / 1e6 * r.cacheWrite5m
  return { usd, unpriced: false }
}

export function createLedger() {
  const chat = []   // { qid, startedAt, endedAt, aborted, httpStatus }
  const judge = []  // { qid, model, usage, usd }
  let runStart = null

  return {
    begin() { runStart = new Date().toISOString() },
    get runStart() { return runStart },

    markChatStart(qid) { chat.push({ qid, startedAt: new Date().toISOString(), endedAt: null, aborted: false, httpStatus: null }) },
    markChatEnd(qid, httpStatus) {
      const e = [...chat].reverse().find((c) => c.qid === qid && c.endedAt === null)
      if (e) { e.endedAt = new Date().toISOString(); e.httpStatus = httpStatus; e.aborted = httpStatus === 0 }
    },

    recordJudge(qid, model, usage) {
      const u = {
        input: usage?.input_tokens || 0,
        output: usage?.output_tokens || 0,
        cacheRead: usage?.cache_read_input_tokens || 0,
        cacheWrite: usage?.cache_creation_input_tokens || 0,
      }
      const { usd, unpriced } = costOf(model, u)
      judge.push({ qid, model, usage: u, usd, unpriced })
    },

    // ── RECONCILE — read the ledger for the run window and attribute rows to questions ──────────────────
    async reconcile({ sbUrl, sbHeaders, runEnd }) {
      // OVERLAP CHECK FIRST. Time-window attribution is only valid for sequential runs; see the header.
      const done = chat.filter((c) => c.endedAt)
      for (let i = 1; i < done.length; i++) {
        if (Date.parse(done[i].startedAt) < Date.parse(done[i - 1].endedAt)) {
          return { ok: false, reason: `OVERLAPPING QUESTION WINDOWS (${done[i - 1].qid} and ${done[i].qid}) — time-window attribution is invalid for a concurrent run. Refusing to guess.` }
        }
      }
      const url = `${sbUrl}/rest/v1/anthropic_spend_log` +
        `?select=created_at,endpoint,model,input_tokens,output_tokens,cost_usd` +
        `&created_at=gte.${encodeURIComponent(runStart)}&created_at=lte.${encodeURIComponent(runEnd)}` +
        `&order=created_at.asc&limit=5000`
      let rows
      try {
        const res = await fetch(url, { headers: sbHeaders })
        if (!res.ok) return { ok: false, reason: `ledger read failed: HTTP ${res.status} ${(await res.text()).slice(0, 200)}` }
        rows = await res.json()
      } catch (e) {
        return { ok: false, reason: `ledger read threw: ${String(e?.message || e)}` }
      }
      if (!Array.isArray(rows)) return { ok: false, reason: 'ledger read returned a non-array' }

      const attributed = new Map()  // qid -> { usd, calls }
      const unattributed = []
      // ⛔ COMPARE TIMESTAMPS NUMERICALLY, NEVER AS STRINGS. Postgres returns `2026-08-01 06:59:49.71+00`
      // (SPACE separator, `+00` offset); `toISOString()` produces `2026-08-01T06:59:49.710Z` (T, Z). Comparing
      // those as strings splits on character 10, where ' ' (0x20) sorts BELOW 'T' (0x54) — so every ledger row
      // sorted before every window and the bracketing silently failed. MEASURED on this module's FIRST REAL
      // RUN: $3.16 of $6.23 chat spend (>50%) landed in "matched NO question window", and the per-question
      // lines read $0.0000 for ten questions that had certainly cost money. The report was well-formed and
      // wrong — exactly the class this ledger was built to stop, committed inside the ledger itself.
      const ms = (v) => { const n = Date.parse(String(v).replace(' ', 'T')); return Number.isNaN(n) ? null : n }
      for (const r of rows) {
        const t = ms(r.created_at)
        if (t === null) { unattributed.push(r); continue }
        // A row belongs to the question whose [start, end] brackets it. An ABORTED question's server-side
        // completion lands AFTER endedAt, so extend that question's claim to the next question's start.
        let owner = null
        for (let i = 0; i < done.length; i++) {
          const c = done[i]
          const upper = ms(c.aborted ? (done[i + 1]?.startedAt ?? runEnd) : c.endedAt)
          const lower = ms(c.startedAt)
          if (lower !== null && upper !== null && t >= lower && t <= upper) { owner = c; break }
        }
        if (!owner) { unattributed.push(r); continue }
        const cur = attributed.get(owner.qid) || { usd: 0, calls: 0, aborted: owner.aborted }
        cur.usd += Number(r.cost_usd || 0); cur.calls += 1
        attributed.set(owner.qid, cur)
      }
      return { ok: true, rows: rows.length, attributed, unattributed, chat: done, judge }
    },

    // ── REPORT — and it REFUSES to print a total it could not measure ───────────────────────────────────
    report(rec) {
      const L = []
      L.push('')
      L.push('---- RUN SPEND (LORAMER_EVAL_SPEND_LEDGER_V1) ----')
      const judgeUsd = judge.reduce((s, j) => s + (j.usd || 0), 0)
      const judgeUnpriced = judge.filter((j) => j.unpriced)
      if (!rec?.ok) {
        // ⛔ FAIL LOUD. A run summary without a cost must SAY it has no cost, never omit the line and read clean.
        L.push('  ⛔ CHAT SPEND NOT MEASURED — this run CANNOT report what it cost.')
        L.push(`     reason: ${rec?.reason || 'reconcile was never run'}`)
        L.push(`     judge spend IS known: ${judge.length} calls · $${judgeUsd.toFixed(4)}`)
        L.push('     ⚠ TREAT THE RUN AS UNCOSTED. Do not infer a total from the judge half.')
        return { text: L.join('\n'), measured: false, judgeUsd }
      }
      const chatUsd = [...rec.attributed.values()].reduce((s, a) => s + a.usd, 0)
      const unattrUsd = rec.unattributed.reduce((s, r) => s + Number(r.cost_usd || 0), 0)
      const abortedEntries = [...rec.attributed.entries()].filter(([, a]) => a.aborted)
      const abortedUsd = abortedEntries.reduce((s, [, a]) => s + a.usd, 0)
      const answered = rec.chat.filter((c) => c.httpStatus === 200).length

      L.push(`  CHAT   ${rec.rows} ledger row(s) · $${chatUsd.toFixed(4)} attributed to questions`)
      L.push(`  JUDGE  ${judge.length} call(s) · $${judgeUsd.toFixed(4)}  (NOT in anthropic_spend_log — direct SDK)`)
      L.push(`  TOTAL  $${(chatUsd + judgeUsd + unattrUsd).toFixed(4)}`)
      if (answered) L.push(`  PER ANSWERED QUESTION: $${((chatUsd + judgeUsd) / answered).toFixed(4)} over ${answered} answered`)
      if (abortedEntries.length) {
        L.push('')
        L.push(`  ⛔ PAID FOR AND DISCARDED: ${abortedEntries.length} question(s) aborted at the harness timeout`)
        L.push(`     while the server completed and billed them — $${abortedUsd.toFixed(4)} spent on answers we threw away.`)
        for (const [qid, a] of abortedEntries) L.push(`       ${qid}: $${a.usd.toFixed(4)} (${a.calls} call${a.calls > 1 ? 's' : ''})`)
      }
      if (rec.unattributed.length) {
        L.push(`  ⚠ ${rec.unattributed.length} ledger row(s) ($${unattrUsd.toFixed(4)}) matched NO question window —`)
        L.push('    counted in TOTAL but not attributable. Preflight and any concurrent traffic land here.')
      }
      if (judgeUnpriced.length) L.push(`  ⛔ ${judgeUnpriced.length} judge call(s) had NO PRICE for their model — cost understated, see RATES.`)
      L.push('')
      L.push('  PER QUESTION (chat only, judge listed separately):')
      for (const c of rec.chat) {
        const a = rec.attributed.get(c.qid)
        const j = judge.filter((x) => x.qid === c.qid).reduce((s, x) => s + (x.usd || 0), 0)
        const tag = c.aborted ? ' ABORTED-BUT-BILLED' : c.httpStatus !== 200 ? ` HTTP ${c.httpStatus}` : ''
        L.push(`    ${c.qid.padEnd(5)} chat $${(a?.usd ?? 0).toFixed(4)}${j ? ` · judge $${j.toFixed(4)}` : ''}${tag}`)
      }
      return { text: L.join('\n'), measured: true, chatUsd, judgeUsd, totalUsd: chatUsd + judgeUsd + unattrUsd }
    },
  }
}
