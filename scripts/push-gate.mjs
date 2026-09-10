#!/usr/bin/env node
// LORAMER_PUSH_GATE_V1 — A `git push` IS REFUSED UNLESS THE GUARD SUITE'S OWN VERDICT LINE READS ALL GREEN.
//
// ⛔ THE DEFECT THIS ENDS, twice measured: 2026-08-15 a `wrap && guard && commit && push` chain printed
// `[run-guards] EXIT 1 — 1 failed, 0 crashed` and the push happened anyway (the push line was read, the verdict
// line above it was not); 2026-09-09 a7cd464 was pushed with the same line on screen because the chain used `;`
// after `npm run guard`. Both times Vercel's build (`npm run guard && next build`) failed, burned a deploy and
// left main un-deployable until a fix-forward. QUOTE THE VERDICT BEFORE THE PUSH (ESSENCE) is a reading
// discipline; this is its mechanical half (QUEUE ★VERDICT-ENFORCER-BEFORE-PUSH): the verdict is PARSED by a
// program, and the push does not leave the machine on anything but `[run-guards] ALL GREEN — N/N`.
//
// WHERE IT LIVES AND WHY HERE: a Claude Code PreToolUse hook on the Bash tool (.claude/settings.json, committed so
// it travels to both machines — LORAMER_HOOKS_OVER_PROSE_V1; the two hooks already live there are the precedent).
// Claude Code is the only thing that pushes in this repo, so the gate sits at the one origin of pushes. It is NOT
// a git pre-push hook: DECISIONS:2086 "NO GIT PRE-PUSH HOOK — deliberate, not an oversight" stands untouched
// (its reason — check:data on push — is honoured: this gate NEVER runs check:data; a data check belongs to a
// schedule, ★SCHEDULED-DATA-CHECK).
//
// THE CONTRACT (PreToolUse, Bash):
//   · command does not match /\bgit\s+push\b/ → silent, exit 0 (this gate costs nothing when it has nothing to say)
//   · otherwise run `npm run guard` in the repo root, parse its MACHINE-FINAL line:
//       `[run-guards] ALL GREEN — N/N guards ran and passed.`  → ALLOW (exit 0), the line logged
//       `[run-guards] EXIT n — …`                              → BLOCK (exit 2 + permissionDecision deny)
//       no parseable verdict, spawn error, or timeout          → BLOCK — "no verdict line found" is NEVER green
//         (the 2026-08-12 false-green shape, `| tail` swallowing a red exit, must not arrive one layer up)
//   Every decision is appended to docs/LORAMER_PUSH_GATE_LOG.jsonl (append-only, committed with the next push —
//   the same posture as docs/LORAMER_PROTOCOL_OVERRIDES.jsonl), so the report can quote the gate's own line.
//
// ⛔ TIMEOUTS, AND WHY THE GATE CARRIES ITS OWN: the vendor cancels a hook that reaches its `timeout` and
// "discarding the hook's output, so on most events a timed-out hook renders no decision" — a timed-out gate would
// FAIL OPEN. So the guard run is bounded HERE, below the hook's timeout, and a run that does not finish inside
// the budget is a BLOCK. INNER_BUDGET_MS ⇐ 2 × the suite's measured wall-clock (209 s on the MacBook Air,
// 2026-09-09, 163 guards) — a run twice its healthy length is not a healthy run. The hook's own `timeout` in
// .claude/settings.json is the vendor default (600 s) so it can never fire before this one.
//
// HONEST LIMIT: it enforces the chain at the Bash tool. A push typed in a terminal outside Claude Code bypasses
// it — by DECISIONS:2086's own reasoning the executor is Claude Code, and a git-hook form would need that
// decision amended first. It proves the verdict was GREEN at push time, never that the reader read it.
//
// USAGE (as the hook): JSON on stdin ({ tool_name, tool_input: { command } }); JSON on stdout only when blocking.
import { spawnSync } from 'node:child_process'
import { appendFileSync, mkdirSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = process.env.LORAMER_GATE_ROOT || process.env.CLAUDE_PROJECT_DIR || process.cwd()
const LOG_REL = 'docs/LORAMER_PUSH_GATE_LOG.jsonl'
// ⛔ A PUSH AT A COMMAND POSITION — line start, or after ; & | ( — with optional VAR=value prefixes. NOT the phrase
// anywhere: the first cut matched inside quoted strings and heredoc bodies, and blocked two commit commands whose
// MESSAGE mentioned pushing (2026-09-10, logged). A commit message is not a push.
export const PUSH_RE = /(^|[;&|(]\s*)(?:[A-Za-z_][A-Za-z0-9_]*=\S*\s+)*git\s+push\b/m
export const MEASURED_SUITE_MS = 209_000 // ⇐ measured 2026-09-09, `npm run guard`, 163 guards, MacBook Air
export const INNER_BUDGET_MS = 2 * MEASURED_SUITE_MS
const GREEN_RE = /^\[run-guards\] ALL GREEN — (\d+)\/(\d+) guards ran and passed\.\s*$/m
const RED_RE = /^\[run-guards\] EXIT (\d+) — .*$/m

// ── PURE CORE — driven by the guard on fixtures, no suite run ─────────────────────────────────────────────
/** The LAST machine-final verdict line in a guard run's output, classified. */
export function parseGuardVerdict(text) {
  const s = String(text || '')
  const greens = [...s.matchAll(new RegExp(GREEN_RE.source, 'gm'))]
  const reds = [...s.matchAll(new RegExp(RED_RE.source, 'gm'))]
  const last = (arr) => (arr.length ? arr[arr.length - 1] : null)
  const g = last(greens), r = last(reds)
  if (g && (!r || g.index > r.index)) return { kind: 'green', ran: Number(g[1]), of: Number(g[2]), line: g[0].trim() }
  if (r) return { kind: 'red', exit: Number(r[1]), line: r[0].trim() }
  return { kind: 'none', line: null }
}

export function decidePush(parsed, run = {}) {
  if (run.timedOut) return { allow: false, reason: `PUSH-GATE — refused: \`npm run guard\` did not finish inside ${Math.round(INNER_BUDGET_MS / 1000)} s (2× its measured wall-clock); an unfinished gate is not a green one.` }
  if (run.spawnError) return { allow: false, reason: `PUSH-GATE — refused: \`npm run guard\` could not run (${run.spawnError}); no verdict is never green.` }
  if (parsed.kind === 'green') {
    if (parsed.ran !== parsed.of) return { allow: false, reason: `PUSH-GATE — refused: verdict says ${parsed.ran}/${parsed.of} — not every guard ran.` }
    return { allow: true, reason: `PUSH-GATE — allowed: ${parsed.line}` }
  }
  if (parsed.kind === 'red') return { allow: false, reason: `PUSH-GATE — refused: ${parsed.line} — fix the guard, quote its finding, then push.` }
  return { allow: false, reason: 'PUSH-GATE — refused: NO PARSEABLE VERDICT LINE in the guard run output ("no verdict line found" is never green).' }
}

// ── THE HOOK ──────────────────────────────────────────────────────────────────────────────────────────────
function log(entry) {
  try {
    const p = resolve(ROOT, LOG_REL)
    mkdirSync(dirname(p), { recursive: true })
    appendFileSync(p, JSON.stringify({ ts: new Date().toISOString(), ...entry }) + '\n')
  } catch { /* the decision stands whether or not it could be logged; the block itself is loud */ }
}

async function main() {
  let raw = ''
  try { for await (const chunk of process.stdin) raw += chunk } catch { return 0 }
  let input = {}
  try { input = JSON.parse(raw || '{}') } catch { return 0 } // not a hook payload — not this gate's business
  if (String(input?.tool_name || '') !== 'Bash') return 0
  const command = String(input?.tool_input?.command || '')
  if (!PUSH_RE.test(command)) return 0

  const started = Date.now()
  const r = spawnSync('npm', ['run', 'guard'], { cwd: ROOT, encoding: 'utf8', timeout: INNER_BUDGET_MS, maxBuffer: 64 * 1024 * 1024, env: process.env })
  const timedOut = r.error?.code === 'ETIMEDOUT' || (r.signal === 'SIGTERM' && Date.now() - started >= INNER_BUDGET_MS - 1000)
  const parsed = parseGuardVerdict(`${r.stdout || ''}\n${r.stderr || ''}`)
  const verdict = decidePush(parsed, { timedOut, spawnError: r.error && !timedOut ? String(r.error.message) : null })
  log({ verdict: verdict.allow ? 'allow' : 'block', line: parsed.line, exit: r.status, signal: r.signal, elapsedMs: Date.now() - started, command: command.slice(0, 200) })
  if (verdict.allow) return 0
  process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: verdict.reason } }))
  process.stderr.write(verdict.reason + '\n')
  return 2
}

const invokedDirectly = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)
if (invokedDirectly) {
  main().then((code) => process.exit(code)).catch((e) => {
    // ⛔ FAIL CLOSED. An error inside the gate is not a licence to push.
    process.stderr.write(`PUSH-GATE — refused: internal fault (${e?.message || e}); fix scripts/push-gate.mjs, then push.\n`)
    process.exit(2)
  })
}
