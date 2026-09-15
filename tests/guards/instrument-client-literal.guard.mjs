#!/usr/bin/env node
// LORAMER_INSTRUMENT_CLIENT_LITERAL_GUARD_V1 — AN INSTRUMENT READS ITS SUBJECT FROM THE LEDGER OR ARGV, NEVER FROM A LITERAL.
//
// ⛔ WHY. Five check:data instruments typed Foam OH's id in 2026-08-14..19 (the one-account month) and kept grading
// that one account for a day after 158c608 widened the walk to seventeen — no reader had been walked when the
// producer widened (DECISIONS LORAMER_SESSION_2026_09_14_STORM_AND_INSTRUMENTS_V1 (o); the five were re-cut in
// 89ad90a to derive their subject from the ledger or take --client=). A rule that lives in a comment is 0-for-6 in
// this repo; this guard is the enforcer, and it ends the CLASS rather than the five instances.
//
// THE RULE, mechanical: in scripts/ and tests/guards/ CODE LINES (comments stripped, line-preserving), a literal of
// CLIENT-ID SHAPE — a UUID, a 10-digit google customer id, or a meta `act_<digits>` id — is a build failure UNLESS
//   (1) the file is allowlisted: `*.baseline.mjs` (remove-only freezes of measured violations), the fixture-query
//       gate (its fixtures ARE literal queries), canonical-client-identity (it asserts the registry itself); or
//   (2) the literal's own line carries a WHY annotation in a trailing comment, one of
//         // fixture: <why>            — a certified truth, a hermetic input, a synthetic id; say which and why
//         // registry: src/lib/clients/canonical.ts — the value is the registry's id, copied because the script cannot
//                                     import it (cite the FULL path: canonical-client-identity.guard's A1 binds every
//                                     registry id named in scripts/ to that citation — a seam this guard shares with it)
//         // sentinel: <why>           — a nil/reserved uuid that names a non-client row (e.g. the quota sentinel)
//       An annotation with no WHY text (`// fixture:` alone) does not count. The annotation must be a COMMENT,
//       not text inside a string — the stripper records the comment portion per line and the check reads only that.
// It bans the SHAPE, not the value: a hermetic guard cannot know which UUIDs are clients, and the rule is the shape.
//
// ⛔ THE ANNOTATION IS NOT AN ESCAPE HATCH FOR INSTRUMENTS. An instrument that grades the fleet must derive its
// subject (universe_attempt_log / universe_fire_log / the registry) or take `--client=` / LORAMER_CLIENT; annotating
// a hard-wired subject would be lying to this guard. The three forms name the ONLY legitimate literal classes.
//
// HERMETIC: file reads only. No network, no database, no env. Self-tested on fixtures BEFORE the tree is read.
// SCOPE: scripts/**, tests/guards/**  (.mjs .js .cjs .ts). SELF excluded (its fixtures carry the shapes on purpose).
// BLIND SPOT, stated: a client NAME as a literal ('Foam OH') is not client-id shape and is not seen here; a UUID
// assembled from parts at runtime is not seen here. This proves the shape's absence, not intent.
//
// USAGE: node tests/guards/instrument-client-literal.guard.mjs      EXIT 0 green · 1 findings · 2 broken instrument
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, resolve, dirname, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')
const SELF = 'tests/guards/instrument-client-literal.guard.mjs'
const SCOPES = ['scripts', 'tests/guards']
const EXT = /\.(mjs|js|cjs|ts)$/
const ALLOWLIST = [
  /\.baseline\.mjs$/,
  /(^|\/)fixture-query-gate(\.guard)?\.mjs$/,
  /(^|\/)canonical-client-identity(\.guard)?\.mjs$/,
]

const UUID = /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi
const CUSTOMER_ID = /(['"`])\d{10}\1|\b\d{3}-\d{3}-\d{4}\b/g
const ACT_ID = /\bact_\d{5,}\b/g
const ANNOTATION = /\/\/\s*(fixture:\s*\S.*|registry:\s*(?:src\/lib\/clients\/)?canonical\.ts\b.*|sentinel:\s*\S.*)/

/**
 * Pure. Split a source into { code[], comment[] } per line, line-preserving. Strings ('…', "…", `…`) are opaque:
 * a `//` or `/*` inside a string is code, not a comment. Block comments spanning lines contribute their text to
 * each line's comment slot. Regex literals are NOT modelled — a `//` inside a regex would read as a comment; that
 * only ever HIDES a literal (safe direction: a hidden literal is a miss, never a false finding). An unbalanced
 * quote inside a regex is contained to its own line: ' and " state resets at every newline.
 */
export function splitCommentsPerLine(src) {
  const code = [], comment = []
  let cur = '', com = '', q = null, inBlock = false, inLine = false
  const flush = () => { code.push(cur); comment.push(com); cur = ''; com = '' }
  for (let i = 0; i < src.length; i++) {
    const ch = src[i], nx = src[i + 1]
    // A quoted string cannot span a newline in JS, so an open ' or " at end-of-line is a desync (a regex literal
    // such as /^["']|["']$/g reads as an unbalanced quote) — reset it. Template literals (`) legitimately span lines.
    if (ch === '\n') { inLine = false; if (q === '"' || q === "'") q = null; flush(); continue }
    if (inBlock) { com += ch; if (ch === '*' && nx === '/') { com += '/'; i++; inBlock = false } continue }
    if (inLine) { com += ch; continue }
    if (q) { cur += ch; if (ch === '\\') { cur += nx ?? ''; i++; continue } if (ch === q) q = null; continue }
    if (ch === '"' || ch === "'" || ch === '`') { q = ch; cur += ch; continue }
    if (ch === '/' && nx === '*') { inBlock = true; com += '/*'; i++; continue }
    if (ch === '/' && nx === '/') { inLine = true; com += '//'; i++; continue }
    cur += ch
  }
  flush()
  return { code, comment }
}

/** Pure. Audit one file's text. Returns findings `${label}:${line} — reason`. */
export function auditText(text, label) {
  const out = []
  const { code, comment } = splitCommentsPerLine(text)
  for (let i = 0; i < code.length; i++) {
    const hits = [
      ...(code[i].match(UUID) || []).map((v) => `uuid ${v}`),
      ...(code[i].match(CUSTOMER_ID) || []).map((v) => `google customer id ${v}`),
      ...(code[i].match(ACT_ID) || []).map((v) => `meta account id ${v}`),
    ]
    if (!hits.length) continue
    const ann = comment[i].match(ANNOTATION)
    if (ann) continue
    out.push(`${label}:${i + 1} — client-id-shaped literal in a code line (${hits.join(', ')}) with no WHY annotation. Derive the subject from the ledger/registry or take --client=; if it is legitimately literal, say why on the same line: \`// fixture: <why>\` · \`// registry: src/lib/clients/canonical.ts\` · \`// sentinel: <why>\``)
  }
  return out
}

const findings = []

// ── (a) THE CLASSIFIER ON FIXTURES FIRST — a broken classifier must not read the tree green ─────────────────
{
  const U = '957d484e-d0c4-4dd0-b382-d8499d556252'
  const fx = [
    ['bare uuid literal in code', `const CLIENT = '${U}'\n`, 1],
    ['uuid with fixture WHY', `const CLIENT = '${U}' // fixture: certified truths were measured on this account\n`, 0],
    ['uuid with registry annotation', `const TWIN = '${U}' // registry: canonical.ts — copied, the script cannot import TS\n`, 0],
    ['uuid with registry annotation, full path', `const TWIN = '${U}' // registry: src/lib/clients/canonical.ts — copied\n`, 0],
    ['uuid with sentinel WHY', `const NIL = '00000000-0000-0000-0000-000000000000' // sentinel: the quota row's nil client_id\n`, 0],
    ['annotation without a WHY does not count', `const CLIENT = '${U}' // fixture:\n`, 1],
    ['annotation inside a string is not a comment', `const s = '${U} // fixture: nope'\n`, 1],
    ['uuid only in a line comment', `// the account is ${U}, read 2026-08-16\nconst x = 1\n`, 0],
    ['uuid only in a block comment', `/* ${U}\n   spans lines */\nconst x = 1\n`, 0],
    ['uuid in a URL string is still a literal', `const u = 'https://x.test/clients/${U}'\n`, 1],
    ['10-digit google customer id quoted', `const CID = '3699173394'\n`, 1],
    ['10-digit number unquoted is not an id (a timestamp, a count)', `const t = 1757900000\n`, 0],
    ['dashed customer id', `const CID = '369-917-3394'\n`, 1],
    ['meta act_ id', `const ACT = 'act_584246708329858'\n`, 1],
    ['meta act_ id with fixture WHY', `const ACT = 'act_584246708329858' // fixture: synthetic — never resolved\n`, 0],
    ['// inside a string does not start a comment', `const url = 'https://a.b/c'; const CLIENT = '${U}'\n`, 1],
    ['annotation form registry requires canonical.ts', `const TWIN = '${U}' // registry: somewhere else\n`, 1],
    ['a regex with unbalanced quotes on a prior line does not hide the next line\'s annotation', `const v = s.replace(/^["']|["']$/g, '')\nconst CLIENT = '${U}' // fixture: certified — measured here\n`, 0],
    ['a multi-line template literal is still one string', `const sql = \`select 1\n  from t where id = '${U}'\n\`\nconst x = 1\n`, 1],
  ]
  for (const [name, text, expect] of fx) {
    const got = auditText(text, `fixture:${name}`).length
    if (got !== expect) findings.push(`(a) classifier fixture "${name}" produced ${got} finding(s), expected ${expect} — the audit cannot be trusted on real files`)
  }
  if (findings.length) {
    for (const f of findings) console.error(`✗ ${f}`)
    console.error(`[instrument-client-literal] BROKEN INSTRUMENT — ${findings.length} classifier fixture(s) failed; the tree was NOT read.`)
    process.exit(2)
  }
}

// ── (b) THE REAL TREE ─────────────────────────────────────────────────────────────────────────────────────
const files = []
const walk = (dir) => {
  let names
  try { names = readdirSync(dir) } catch { return }
  for (const n of names) {
    const p = join(dir, n)
    let st
    try { st = statSync(p) } catch { continue }
    if (st.isDirectory()) { if (n !== 'node_modules') walk(p) }
    else if (EXT.test(n)) files.push(p)
  }
}
for (const s of SCOPES) walk(join(ROOT, s))
files.sort()

let scanned = 0, allowlisted = 0
const redFiles = new Set()
for (const abs of files) {
  const rel = relative(ROOT, abs).split('\\').join('/')
  if (rel === SELF) continue
  if (ALLOWLIST.some((re) => re.test(rel))) { allowlisted++; continue }
  scanned++
  const f = auditText(readFileSync(abs, 'utf8'), rel)
  if (f.length) redFiles.add(rel)
  findings.push(...f)
}

if (findings.length) {
  for (const f of findings) console.error(`✗ ${f}`)
  console.error(`[instrument-client-literal] FAIL — ${findings.length} client-id-shaped literal(s) in ${redFiles.size} file(s) (scanned ${scanned}, allowlisted ${allowlisted}). An instrument reads its subject from the ledger or argv, never from a literal; a legitimately literal id says why on its own line.`)
  process.exit(1)
}
console.log(`[instrument-client-literal] PASS — 0 unannotated client-id-shaped literals in ${scanned} code file(s) under ${SCOPES.join(', ')} (allowlisted ${allowlisted}: *.baseline.mjs, fixture-query-gate, canonical-client-identity); classifier proven on 19 fixtures first. BLIND SPOT: client NAMES and ids assembled at runtime are not seen here.`)
