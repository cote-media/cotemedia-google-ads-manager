#!/usr/bin/env node
// LORAMER_PUSH_GATE_V1 — THE ENFORCER FOR scripts/push-gate.mjs: WIRED, FAIL-CLOSED, AND ITS PARSER PROVEN BOTH WAYS.
//
// ── THE ASSERTION ───────────────────────────────────────────────────────────────────────────────────────────
//   (a) WIRED — .claude/settings.json registers scripts/push-gate.mjs on PreToolUse with a matcher that reaches the
//       Bash tool, and a numeric `timeout` LARGER than the gate's own inner budget (a hook that times out renders
//       NO decision — fail-open — so the outer timeout must never fire first).
//   (b) FAIL-CLOSED SHAPE — the script blocks with `permissionDecision: 'deny'` + exit 2, and never invokes
//       check:data (DECISIONS:2086's reason, honoured).
//   (c) THE PARSER, on three STUB fixtures (strings, not a real suite run):
//         `[run-guards] EXIT 1 — 1 failed, 0 crashed.`              → block
//         `[run-guards] ALL GREEN — 163/163 guards ran and passed.` → allow
//         output with no verdict line                              → block
//       plus the two run-shaped refusals: timed out → block; spawn error → block.
//   (d) THE HOOK ITSELF, run exactly as Claude Code runs it (JSON on stdin), on a NON-push command → exit 0 and
//       no output — the gate is silent when it has nothing to say, and it must not run the suite from inside the
//       suite (this guard is part of `npm run guard`).
//
// HONEST LIMIT: this proves the wiring and the parser. It cannot prove that a push was blocked at push time — the
// gate's own append-only log (docs/LORAMER_PUSH_GATE_LOG.jsonl) is that record.
import { readFileSync, existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { spawnSync } from 'node:child_process'

const ROOT = process.env.LORAMER_GUARD_ROOT || process.cwd()
const SCRIPT = resolve(ROOT, 'scripts/push-gate.mjs')
const SETTINGS = resolve(ROOT, '.claude/settings.json')
const findings = []

// ── (a) WIRED ───────────────────────────────────────────────────────────────────────────────────────────────
if (!existsSync(SCRIPT)) findings.push('(a) scripts/push-gate.mjs is MISSING — there is no push gate.')
let mod = null
try { mod = await import(SCRIPT) } catch (e) { findings.push(`(a) scripts/push-gate.mjs cannot be imported (${e.message}).`) }
const innerBudgetS = mod ? Math.ceil(mod.INNER_BUDGET_MS / 1000) : NaN
if (!existsSync(SETTINGS)) {
  findings.push('(a) .claude/settings.json is MISSING — the gate is not registered on any tool call.')
} else {
  let cfg = null
  try { cfg = JSON.parse(readFileSync(SETTINGS, 'utf8')) } catch (e) { findings.push(`(a) .claude/settings.json is not valid JSON (${e.message}).`) }
  const pre = cfg?.hooks?.PreToolUse
  const entry = Array.isArray(pre) ? pre.find((e) => JSON.stringify(e).includes('scripts/push-gate.mjs')) : null
  if (!entry) findings.push('(a) hooks.PreToolUse has no entry invoking scripts/push-gate.mjs — a `git push` reaches the network unexamined.')
  else {
    const matcher = String(entry.matcher || '')
    if (!/(^|\|)\s*Bash\s*($|\|)/.test(matcher)) findings.push(`(a) the push-gate entry's matcher "${matcher}" does not reach the Bash tool — git push is typed in Bash.`)
    const h = (entry.hooks || []).find((x) => String(x.command || '').includes('scripts/push-gate.mjs'))
    const t = Number(h?.timeout)
    if (!Number.isFinite(t)) findings.push('(a) the push-gate hook carries no numeric `timeout` — the vendor default applies silently; state it.')
    else if (Number.isFinite(innerBudgetS) && t <= innerBudgetS) findings.push(`(a) the hook timeout (${t} s) is not larger than the gate's inner budget (${innerBudgetS} s) — the outer timeout would fire first and a timed-out hook renders NO decision (fail-open).`)
  }
}

// ── (b) FAIL-CLOSED SHAPE ───────────────────────────────────────────────────────────────────────────────────
if (existsSync(SCRIPT)) {
  const src = readFileSync(SCRIPT, 'utf8')
  if (!/permissionDecision:\s*'deny'/.test(src)) findings.push("(b) scripts/push-gate.mjs never emits permissionDecision 'deny' — it cannot block.")
  if (!/process\.exit\(code\)|process\.exit\(2\)|return 2/.test(src)) findings.push('(b) scripts/push-gate.mjs has no exit-2 path — on PreToolUse exit 2 is the block.')
  if (/check:data/.test(src.replace(/\/\/.*$/gm, ''))) findings.push('(b) scripts/push-gate.mjs invokes check:data — DECISIONS:2086 forbids a data check on the push trigger.')
}

// ── (c) THE PARSER — STUB fixtures (strings), named as such ─────────────────────────────────────────────────
if (mod) {
  const cases = [
    { name: 'EXIT 1 → block', text: 'stuff\n[run-guards] EXIT 1 — 1 failed, 0 crashed.\n', want: false },
    { name: 'ALL GREEN → allow', text: '  163  ok  208ms  tests/guards/x.guard.mjs\n[run-guards] ALL GREEN — 163/163 guards ran and passed.\n', want: true },
    { name: 'no verdict → block', text: 'npm ERR! something\n', want: false },
    { name: 'green then red later → block', text: '[run-guards] ALL GREEN — 163/163 guards ran and passed.\n[run-guards] EXIT 1 — 1 failed, 0 crashed.\n', want: false },
  ]
  for (const c of cases) {
    const v = mod.decidePush(mod.parseGuardVerdict(c.text))
    if (v.allow !== c.want) findings.push(`(c) parser fixture "${c.name}" expected allow=${c.want}, got allow=${v.allow} (${v.reason})`)
  }
  // (e) THE TRIGGER — a push at a command position, never the phrase inside a string (STUB command strings)
  const trig = [
    ['git push origin main', true], ['git add -A && git commit -q -F m.txt && git push origin main', true],
    ['cd /x; git push', true], ['GIT_TRACE=1 git push', true],
    ['echo "the gate blocks git push on red"', false], ["cat > m.txt <<'EOF'\nfeat: git push gate\nEOF", false],
    ['git status --short', false], ['git pull -q origin main', false],
  ]
  for (const [cmd, want] of trig) {
    if (mod.PUSH_RE.test(cmd) !== want) findings.push(`(e) trigger fixture ${JSON.stringify(cmd.slice(0, 50))} expected match=${want}, got ${!want}`)
  }
  const to = mod.decidePush(mod.parseGuardVerdict(''), { timedOut: true })
  if (to.allow) findings.push('(c) a timed-out guard run was ALLOWED — the inner budget is decorative.')
  const se = mod.decidePush(mod.parseGuardVerdict(''), { spawnError: 'ENOENT' })
  if (se.allow) findings.push('(c) a spawn error was ALLOWED — no verdict was treated as green.')
}

// ── (d) THE HOOK on a non-push command: silent, exit 0, no suite run ──────────────────────────────────────────
if (existsSync(SCRIPT)) {
  const r = spawnSync(process.execPath, [SCRIPT], { input: JSON.stringify({ tool_name: 'Bash', tool_input: { command: 'git status --short' } }), encoding: 'utf8', env: { ...process.env, LORAMER_GATE_ROOT: ROOT }, timeout: 20_000 })
  if (r.status !== 0) findings.push(`(d) the hook exited ${r.status} on a non-push Bash command — it must be silent there (stderr: ${String(r.stderr).slice(0, 120)}).`)
  if ((r.stdout || '').trim()) findings.push(`(d) the hook wrote output on a non-push command: ${String(r.stdout).slice(0, 120)}`)
}

if (findings.length) {
  console.error(`[push-gate] FAIL — ${findings.length} finding(s):\n  - ${findings.join('\n  - ')}`)
  process.exit(1)
}
console.log(`[push-gate] PASS — wired on PreToolUse Bash with timeout > ${innerBudgetS} s inner budget; deny+exit-2 shape; no check:data; 4 parser fixtures + 2 run-shaped refusals (STUB strings) decide as required; silent on a non-push command.`)
