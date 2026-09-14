#!/usr/bin/env node
// LORAMER_FANOUT_BOUNDED_GUARD_V1 — A DATA-WIDTH FAN-OUT THAT IS NOT BOUNDED FAILS THE BUILD.
//
// THE CLASS (measured 2026-09-14, fire-7621): `Promise.all(days.map(probe))` launched one PostgREST fetch per day of a
// 3,700-day span at once and exhausted the Vercel host's resolver/fd pool (`getaddrinfo EBUSY` → "TypeError: fetch
// failed"). The fix bounded ONE launcher (mapBounded). The class is every fan-out whose WIDTH IS DATA — days, clients,
// surfaces, rows — and the round-5 survey that declared "exactly one member" was wrong by one because its grep required
// `Promise.all(` and `.map(` on the same line: src/app/api/clients/metrics/route.ts held a multi-line one per client, on
// a live page route. This guard is the instrument that survey should have been: it bracket-matches ACROSS lines.
//
// THE RULE: for every Promise.all / Promise.allSettled / Promise.any call in scope whose first argument contains `.map(`,
// the RECEIVER before `.map(` is classed CONSTANT (an array literal, an ALL_CAPS identifier, or an identifier declared
// `const X = [` in the same file) or DATA. A DATA site passes ONLY as `mapBounded(receiver, <CONST>, …)` (the one home,
// src/lib/concurrency.ts) with `// fan-out: bounded <CONST>` above it, or with `// fan-out: constant <NAME> — <reason>`
// above the call (the width is a constant the classifier cannot see). An unawaited `.map(async …)` outside any Promise.*
// argument is a fire-and-forget fan-out and fails too. mapBounded must be defined in src/lib/concurrency.ts and nowhere
// else (a second definition is the drift this guard exists to stop).
// SCOPE: src/app/api, src/lib, scripts. EXCLUDED, stated: src/app/dashboard/page.tsx (LEGACY IS FROZEN, DECISIONS:2461; its
// `adSets.map` fan-out is a BROWSER fan-out against our API and is retired with the legacy path, never edited).
// ⛔ BLIND SPOT, STATED ON THE FACE: a loop that pushes promises into an array and then `Promise.all(arr)`s it carries no
// `.map(` and is NOT seen here; nor is fan-out inside third-party packages. Today the tree holds neither (round 16 survey);
// this guard proves shapes, not absence.
//  (a) the classifier is driven on 10 fixtures BEFORE it reads the tree (a broken classifier must not pass green)
//  (b) the real tree carries 0 findings
//  (c) mapBounded's one home is src/lib/concurrency.ts; universe-coverage.ts may only re-export it
//  (d) registered in scripts/run-guards.mjs
// Seen RED first against 0d07bc6: clients/metrics/route.ts:131 (DATA, unannotated) · next/coverage.ts:111 and
// claude-tools.ts:450 (parameter-width, unannotated).
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, resolve, dirname, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')
const findings = []
const read = (p) => { try { return readFileSync(resolve(ROOT, p), 'utf8') } catch { return '' } }
const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, (c) => c.replace(/[^\n]/g, '')).replace(/(^|[^:'"`])\/\/(?! fan-out:)[^\n]*/g, '$1')
const HOME = 'src/lib/concurrency.ts'
const RUNNER = 'scripts/run-guards.mjs'
const SELF = 'tests/guards/fan-out-is-bounded.guard.mjs'
const SCOPES = ['src/app/api', 'src/lib', 'scripts']
const EXCLUDED = ['src/app/dashboard/page.tsx']

/** Index of the matching close bracket for the open bracket at `i`, skipping strings/templates. -1 if unbalanced. */
function matchBracket(src, i) {
  const open = src[i], close = open === '(' ? ')' : open === '[' ? ']' : '}'
  let depth = 0, q = null
  for (let j = i; j < src.length; j++) {
    const ch = src[j]
    if (q) { if (ch === '\\') { j++; continue } if (ch === q) q = null; continue }
    if (ch === '"' || ch === "'" || ch === '`') { q = ch; continue }
    if (ch === open) depth++
    else if (ch === close) { depth--; if (depth === 0) return j }
  }
  return -1
}
const lineOf = (src, idx) => src.slice(0, idx).split('\n').length

/** Pure. Audit one file's text. Returns findings as `${label}:${line} — reason`. */
export function auditText(text, label) {
  const out = []
  const src = strip(text)
  const lines = src.split('\n')
  const annotationAbove = (line) => {
    for (let k = line - 2; k >= Math.max(0, line - 4); k--) { const m = lines[k].match(/\/\/\s*fan-out:\s*(constant|bounded)\s+([A-Za-z_][\w.]*)/); if (m) return { kind: m[1], name: m[2] } }
    return null
  }
  const sameFileConst = (name) => new RegExp(`\\bconst\\s+${name}\\s*(?::[^=]+)?=\\s*\\[`).test(src)
  const isConstantReceiver = (recv) => /^\[/.test(recv) || /^[A-Z][A-Z0-9_]*$/.test(recv) || (/^[A-Za-z_$][\w$]*$/.test(recv) && sameFileConst(recv))
  const promiseArgRanges = []
  const promiseRe = /Promise\.(all|allSettled|any)\s*\(/g
  let m
  while ((m = promiseRe.exec(src))) {
    const openIdx = m.index + m[0].length - 1
    const closeIdx = matchBracket(src, openIdx)
    if (closeIdx < 0) continue
    promiseArgRanges.push([openIdx, closeIdx])
    const arg = src.slice(openIdx + 1, closeIdx)
    const mapIdx = arg.search(/\.map\s*\(/)
    if (mapIdx < 0) continue // Promise.all([a(), b()]) — a literal list, constant by construction
    const before = arg.slice(0, mapIdx)
    const recvMatch = before.match(/([A-Za-z_$][\w$.]*|\][\s\S]*?|\))\s*$/)
    const recv = (before.match(/([A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*)\s*$/) || [, ''])[1] || (before.trim().endsWith(']') ? '[' : before.trim())
    const line = lineOf(src, m.index)
    if (isConstantReceiver(recv)) continue
    const ann = annotationAbove(line)
    if (ann?.kind === 'constant') continue
    out.push(`${label}:${line} — Promise.${m[1]}(${recv}.map(…)) is a DATA-width fan-out (receiver \`${recv}\` is not a literal, an ALL_CAPS constant, or a same-file const array) and carries no bound: wrap it in mapBounded(${recv}, <CONST>, …) from ${HOME} with \`// fan-out: bounded <CONST>\` above, or state the width with \`// fan-out: constant <NAME> — <reason>\``)
    void recvMatch
  }
  // mapBounded sites: must carry the bounded annotation and a named (not literal) limit
  const mbRe = /\bmapBounded\s*\(/g
  while ((m = mbRe.exec(src))) {
    const line = lineOf(src, m.index)
    if (/function\s+mapBounded|export\s*\{\s*mapBounded/.test(lines[line - 1])) continue
    const closeIdx = matchBracket(src, m.index + m[0].length - 1)
    const args = closeIdx > 0 ? src.slice(m.index + m[0].length, closeIdx) : ''
    const limit = (args.split(',')[1] || '').trim()
    if (!/^[A-Za-z_$][\w$.]*$/.test(limit) || /^\d/.test(limit)) out.push(`${label}:${line} — mapBounded's limit \`${limit}\` is not a named constant`)
    const ann = annotationAbove(line)
    if (!ann || ann.kind !== 'bounded' || ann.name !== limit) out.push(`${label}:${line} — mapBounded(…, ${limit}) lacks \`// fan-out: bounded ${limit}\` above it`)
  }
  // fire-and-forget: `.map(async` outside every Promise.* argument and outside mapBounded
  const ffRe = /\.map\s*\(\s*async\b/g
  while ((m = ffRe.exec(src))) {
    const inside = promiseArgRanges.some(([a, b]) => m.index > a && m.index < b)
    if (inside) continue
    out.push(`${label}:${lineOf(src, m.index)} — \`.map(async …)\` outside any Promise.all/allSettled/any argument: a fire-and-forget fan-out with no bound and no result`)
  }
  return out
}

// ── (a) THE CLASSIFIER ON TEN SHAPES FIRST ──────────────────────────────────────────────────────────────
{
  const fx = [
    ['literal array', "await Promise.all([a(), b(), c()])\n", 0],
    ['ALL_CAPS constant receiver', "const x = await Promise.all(STORE_PLATFORMS.map((p) => f(p)))\n", 0],
    ['same-file const array receiver', "const platforms = ['google', 'meta']\nconst x = await Promise.all(platforms.map((p) => f(p)))\n", 0],
    ['data receiver, unannotated', "const x = await Promise.all(ids.map(async (id) => g(id)))\n", 1],
    ['data receiver, annotated constant', "// fan-out: constant PLATFORMS — ≤ 5 platforms\nconst x = await Promise.all(use.map((p) => f(p)))\n", 0],
    ['mapBounded with bounded annotation', "// fan-out: bounded PROBE_N\nconst x = await mapBounded(ids, PROBE_N, async (id) => g(id))\n", 0],
    ['MULTI-LINE Promise.all(\\n x.map(async …))', "await Promise.all(\n  clientIds.map(async id => {\n    const { data } = await q(id)\n    m[id] = data\n  })\n)\n", 1],
    ['allSettled over data', "const r = await Promise.allSettled(rows.map((r) => h(r)))\n", 1],
    ['unawaited .map(async — fire and forget', "ids.map(async (id) => { await g(id) })\n", 1],
    ['loop-push then Promise.all(arr) — the stated blind spot', "const arr = []\nfor (const id of ids) arr.push(g(id))\nawait Promise.all(arr)\n", 0],
  ]
  for (const [name, text, expect] of fx) {
    const got = auditText(text, `fixture:${name}`).length
    if (got !== expect) findings.push(`(a) classifier fixture "${name}" produced ${got} finding(s), expected ${expect} — the audit cannot be trusted on real files`)
  }
}

// ── (c) ONE HOME ─────────────────────────────────────────────────────────────────────────────────────────
{
  const home = strip(read(HOME))
  if (!/export async function mapBounded/.test(home)) findings.push(`(c) ${HOME} does not define mapBounded — the one home is empty`)
}

// ── (b) THE REAL TREE ────────────────────────────────────────────────────────────────────────────────────
const files = []
const walk = (dir) => {
  let names = []
  try { names = readdirSync(dir) } catch { return }
  for (const name of names) {
    if (name === 'node_modules' || name === '.next' || name.startsWith('.')) continue
    const p = join(dir, name)
    const st = statSync(p)
    if (st.isDirectory()) walk(p)
    else if (/\.(ts|tsx|mjs|js)$/.test(name)) files.push(p)
  }
}
for (const s of SCOPES) walk(join(ROOT, s))
let homes = 0
for (const f of files) {
  const rel = relative(ROOT, f)
  if (rel === SELF || EXCLUDED.includes(rel)) continue
  const text = read(rel)
  if (/export async function mapBounded/.test(strip(text))) { homes++; if (rel !== HOME) findings.push(`(c) ${rel} defines mapBounded — the one home is ${HOME}; import it (universe-coverage.ts may only re-export)`) }
  if (!/Promise\.(all|allSettled|any)|mapBounded|\.map\s*\(\s*async/.test(text)) continue
  findings.push(...auditText(text, rel).map((s) => `(b) ${s}`))
}
if (homes === 0) findings.push(`(c) no file in scope defines mapBounded`)

// ── (d) REGISTERED ───────────────────────────────────────────────────────────────────────────────────────
if (!read(RUNNER).includes(SELF)) findings.push(`(d) ${RUNNER} does not register ${SELF}`)

if (findings.length) {
  console.error(`[fan-out-is-bounded] FAIL — ${findings.length} finding(s):`)
  for (const f of findings) console.error(`  - ${f}`)
  process.exit(1)
}
console.log(`[fan-out-is-bounded] PASS — every Promise.all/allSettled/any fan-out in ${SCOPES.join(', ')} is constant-width, annotated, or bounded through mapBounded (one home: ${HOME}); no fire-and-forget .map(async); classifier proven on 10 shapes. EXCLUDED: ${EXCLUDED.join(', ')} (legacy frozen). BLIND SPOT: loop-push + Promise.all(arr) and third-party fan-out are not seen here — this proves shapes, not absence.`)
