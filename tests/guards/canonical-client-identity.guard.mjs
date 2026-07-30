#!/usr/bin/env node
// LORAMER_CANONICAL_CLIENT_REGISTRY_V1 — the enforcer for src/lib/clients/canonical.ts.
//
// WHY A GUARD AND NOT ANOTHER PARAGRAPH: the duplicate-client-name trap is banked in DECISIONS as prose, that prose
// was READ on 2026-07-29, and the same night a new file asserted that 2617b163 was "NOT a fixture. Real client,
// richest Shopify history in the fleet" — a client with ZERO shopify rows. Second instance of the class that day
// (the first was the ★META-PRODUCT-ID-ROUTE recon restating a stale premise). ★EVAL-BIND and FIX-WITH-GUARD are
// cited, not re-derived: PROSE IN A DOC IS NOT A GUARD, AND A RULE YOU CANNOT FAIL IS A WISH.
//
// ── TWO MODES, because two of the three assertions CANNOT be hermetic ───────────────────────────────────────────
// DEFAULT (hermetic) — runs in `npm run guard`, i.e. the Vercel build path:
//   A1 CITATION RULE (structural)  · A2 ROLE-WORD CONTRADICTION (heuristic) · A3 DATA-CLAIM CONTRADICTION (heuristic)
//   A4 registry self-consistency   · A5 the REAL resolver throws on an ambiguous name
// --db — additionally runs, and is wired into `npm run check:data`:
//   B  every registry id exists in `clients`, and its owner email matches the DB
//   C  every duplicate-name client in the DB is present in the registry
//   D  every registry `platforms` flag matches live metrics_daily row presence
// ⛔ B/C/D NEED THE LIVE DB, SO THEY CANNOT LIVE IN THE BUILD. That is not a weakening: the assertions are kept at
// full strength and moved to the only place they can run. `npm run guard` is 100% hermetic and sits in the Vercel
// deploy chain (vercel.json has no buildCommand → Vercel runs `npm run build`); a DB read there would couple every
// deploy to data state. Settled split, cited not re-derived — DECISIONS LORAMER_ACCOUNT_ROW_INVARIANT_V1, and the
// same posture as check-capture-landing.mjs / check-frozen-cursors.mjs.
//
// ── HONEST LIMIT, stated because a green run here must not be over-read ─────────────────────────────────────────
// A2 and A3 read PROSE. They are pattern matchers over the phrasings that actually occurred, not comprehension: a
// false claim worded differently can slip past them, and a window holding two registry ids is deliberately SKIPPED
// as unattributable rather than guessed at. THE UN-EVADABLE PARTS ARE A1 (a file that names a registry id must cite
// the registry — no wording gets around it) and B/C/D (checked against the database, not against words). A2/A3 are
// the cheap catch for the exact mistake made tonight; A1 and B/C/D are the structure.
import { spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync, readFileSync, existsSync, readdirSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve, relative } from 'node:path'
import { createRequire } from 'node:module'

const ROOT = process.env.LORAMER_GUARD_ROOT || process.cwd()
const WITH_DB = process.argv.includes('--db')
const findings = []
const add = (m) => findings.push(m)
const die = (m) => { console.error(`[canonical-client-identity] FAIL — ${m}`); process.exit(1) }

const REG = 'src/lib/clients/canonical.ts'
if (!existsSync(resolve(ROOT, REG))) die(`${REG} is missing — the canonical client registry is the single source of truth for identity; without it nothing can be checked.`)

// ── load the REAL registry (transpiled with the installed tsc; canonical.ts has no imports, so no stubs) ────────
const out = mkdtempSync(join(tmpdir(), 'loramer-canonical-guard-'))
const tsc = join(ROOT, 'node_modules', '.bin', 'tsc')
const r = spawnSync(tsc, [resolve(ROOT, REG), '--target', 'es2020', '--module', 'commonjs', '--moduleResolution',
  'node', '--skipLibCheck', '--rootDir', resolve(ROOT), '--outDir', out], { encoding: 'utf8' })
if (r.error) { rmSync(out, { recursive: true, force: true }); die(`could not run tsc — ${r.error.message}`) }
let reg
try { reg = createRequire(import.meta.url)(join(out, 'src/lib/clients/canonical.js')) }
catch (e) { rmSync(out, { recursive: true, force: true }); die(`compiled registry did not load — ${e.message}\n${r.stdout || ''}${r.stderr || ''}`) }
rmSync(out, { recursive: true, force: true })

const CLIENTS = reg.CANONICAL_CLIENTS
if (!Array.isArray(CLIENTS) || CLIENTS.length === 0) die(`${REG} exports no CANONICAL_CLIENTS entries.`)
for (const fn of ['resolveClientById', 'resolveClientByName', 'normalizeClientName', 'ambiguousClientNames'])
  if (typeof reg[fn] !== 'function') die(`${REG} does not export ${fn}() — the resolver contract is the point of the file.`)

// ── A4: registry self-consistency ───────────────────────────────────────────────────────────────────────────────
const ROLES = new Set(['cohort', 'fixture', 'non-production'])
const PLATFORM_KEYS = ['ga', 'google', 'meta', 'shopify', 'woocommerce']

// Claim vocabulary, shared by A4b (the registry's own prose) and A2/A3 (every other file). Deliberately NARROW and
// phrase-level: broad single words ('canonical', 'demo', 'real') produced false positives on correct text during
// construction, so each pattern below is one that only appears in an actual role assertion.
const COHORT_CLAIM = /\b(real client|the real one|cohort client|golden[- ]list|not a fixture|not the fixture|richest)\b/i
const FIXTURE_CLAIM = /\b(fixture|demo twin|shell client|non-production|test client|test store)\b/i
// A DATA claim = a platform word bound to a data noun, or a superlative reaching one. "shopify connection" is NOT a
// data claim; "Shopify history" and "richest ... Shopify" are. This is precisely the shape of tonight's error.
const DATA_NOUN = '(history|histories|rows|data|orders|revenue|spend|volume|records)'
const dataClaimRe = (p) => new RegExp(`\\b${p}\\s+${DATA_NOUN}\\b|\\b(richest|deepest|largest|biggest|most|longest)\\b[^.;]{0,40}\\b${p}\\b`, 'i')
// NEGATED CLAIMS ARE CORRECT STATEMENTS, NOT VIOLATIONS. "ZERO shopify rows" and "no ga rows ever" are precisely how
// the truth about a fixture gets written down, and the first version of this guard failed on all of them. A match is
// discarded when a negator sits in the 24 characters immediately before it — short on purpose, so the distant "NOT"
// in "NOT a fixture. Real client, richest Shopify history" cannot launder that claim (verified: tonight's false
// sentence still fails, on both the adjacency and the superlative branch).
const NEGATOR = /\b(no|zero|never|without|not|lacks|none|0)\b/i
function dataClaim(blob, platform) {
  const m = blob.match(dataClaimRe(platform))
  if (!m) return null
  const before = blob.slice(Math.max(0, m.index - 24), m.index)
  return NEGATOR.test(before) ? null : m
}
const seenIds = new Set()
for (const c of CLIENTS) {
  const tag = `${c.id || '(no id)'} ${c.name || ''}`.trim()
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(c.id || '')) add(`A4 ${tag}: id is not a uuid.`)
  if (seenIds.has(c.id)) add(`A4 ${tag}: duplicate registry entry for the same id.`)
  seenIds.add(c.id)
  if (!c.name || !c.name.trim()) add(`A4 ${tag}: empty name.`)
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(c.owner || '')) add(`A4 ${tag}: owner "${c.owner}" is not an email — the owner IS the discriminator when names collide, so it cannot be blank or malformed.`)
  if (!ROLES.has(c.role)) add(`A4 ${tag}: role "${c.role}" is not one of cohort | fixture | non-production.`)
  if (!c.reason || c.reason.trim().length < 20) add(`A4 ${tag}: reason is missing or too short to tell this client from its twin.`)
  if (!c.platforms || PLATFORM_KEYS.some((k) => typeof c.platforms[k] !== 'boolean'))
    add(`A4 ${tag}: platforms must carry an explicit boolean for every one of ${PLATFORM_KEYS.join(', ')} — an omitted platform reads as "unknown", and unknown is what let the false shopify claim through.`)
}

// A4b — the registry's own prose must agree with its own fields. A2/A3 skip this file (see below), so without this
// an entry could carry role='fixture' beside a reason calling it the real client, and nothing would notice. The
// entry's reason is checked against the OPPOSITE role's vocabulary and against its own platforms flags.
for (const c of CLIENTS) {
  const why = String(c.reason || '')
  if (c.role !== 'cohort' && COHORT_CLAIM.test(why))
    add(`A4b ${c.id.slice(0, 8)} ${c.name}: role=${c.role} but its own reason makes a cohort/real-client claim ("${(why.match(COHORT_CLAIM) || [])[0]}").`)
  if (c.role === 'cohort' && FIXTURE_CLAIM.test(why))
    add(`A4b ${c.id.slice(0, 8)} ${c.name}: role=cohort but its own reason makes a fixture claim ("${(why.match(FIXTURE_CLAIM) || [])[0]}").`)
  for (const p of PLATFORM_KEYS) {
    if (c.platforms?.[p]) continue
    const m = dataClaim(why, p)
    if (m) add(`A4b ${c.id.slice(0, 8)} ${c.name}: platforms.${p}=false but its own reason claims ${p} data ("${m[0].trim()}").`)
  }
}

// ── A5: the REAL resolver must THROW on an ambiguous name, and must NOT throw on a unique one ───────────────────
const ambiguous = reg.ambiguousClientNames()
if (ambiguous.length === 0)
  add(`A5 ambiguousClientNames() returned nothing. This database HAS colliding client names (verified 2026-07-29: "Influential Drones" x2, "Escential Group" / "The Escential Group"). An empty result means entries were removed or the normaliser stopped collapsing the leading article.`)
for (const nm of ambiguous) {
  let threw = false
  try { reg.resolveClientByName(nm) } catch (e) { threw = e && e.name === 'AmbiguousClientNameError' }
  if (!threw) add(`A5 resolveClientByName("${nm}") did NOT throw AmbiguousClientNameError. Silently returning one of two clients that share a name is the exact failure the registry exists to make impossible.`)
}
const unique = CLIENTS.find((c) => !ambiguous.includes(reg.normalizeClientName(c.name)))
if (unique) {
  try {
    const got = reg.resolveClientByName(unique.name)
    if (!got || got.id !== unique.id) add(`A5 resolveClientByName("${unique.name}") returned ${got ? got.id : 'null'}, expected ${unique.id} — an unambiguous name must still resolve.`)
  } catch { add(`A5 resolveClientByName("${unique.name}") threw on an UNAMBIGUOUS name — the throw must be reserved for real ambiguity or callers will stop using it.`) }
}
if (reg.resolveClientById(CLIENTS[0].id)?.id !== CLIENTS[0].id) add(`A5 resolveClientById() does not resolve a registered id.`)
if (reg.resolveClientById('00000000-0000-0000-0000-000000000000') !== null) add(`A5 resolveClientById() must return null for an unregistered id, not a guess.`)

// ── A1/A2/A3: scan src/, scripts/, tests/ for claims about registry ids ─────────────────────────────────────────
const SCAN_DIRS = ['src', 'scripts', 'tests']
const SCAN_EXT = /\.(ts|tsx|mjs|js|cjs)$/
const CITATION = /(clients\/canonical|canonical-client-identity|CANONICAL_CLIENTS|resolveClientById|resolveClientByName)/


// ⛔ QUOTATION IS NOT ASSERTION. This file, the registry, and the frozen-cursor baseline all QUOTE tonight's false
// sentence verbatim in order to teach why the rule exists — and the first version of this guard failed all three for
// doing so. A guard that makes institutional memory unwritable gets deleted, so quoted spans are removed before any
// claim matching. Double-quoted and backticked spans are stripped ACROSS lines (the quotation wraps); single-quoted
// spans are stripped only when they open and close on the SAME line, so a prose apostrophe ("Shopify's") cannot
// swallow the rest of a comment. LIMIT, stated: this can only ever HIDE a claim, never invent one, and a false claim
// written inside quote marks would be missed — the A1 citation rule is what still binds that case.
function stripQuoted(text) {
  const out = text.replace(/"[^"]*"/gs, ' ').replace(/`[^`]*`/gs, ' ')
  return out.split('\n').map((l) => l.replace(/'[^'\n]*'/g, ' ')).join('\n')
}

function walk(dir, acc = []) {
  let ents
  try { ents = readdirSync(dir) } catch { return acc }
  for (const e of ents) {
    if (e === 'node_modules' || e === '.next' || e === '.git') continue
    const p = join(dir, e)
    const st = statSync(p)
    if (st.isDirectory()) walk(p, acc)
    else if (SCAN_EXT.test(e)) acc.push(p)
  }
  return acc
}

// Match the 8-hex short form as well as the full uuid — the short form is this repo's house convention and is how
// tonight's false claim was written. Bounded so a longer hex run (a git sha) is not mistaken for an id.
const idTokens = CLIENTS.map((c) => ({ c, re: new RegExp(`(?<![0-9a-f])${c.id.slice(0, 8)}(?![0-9a-f])`, 'i'), full: c.id }))
let unattributable = 0
let claimWindows = 0

for (const abs of walk(resolve(ROOT, 'src')).concat(...SCAN_DIRS.slice(1).map((d) => walk(resolve(ROOT, d))))) {
  const rel = relative(ROOT, abs)
  const text = readFileSync(abs, 'utf8')
  const hits = idTokens.filter((t) => t.re.test(text) || text.includes(t.full))
  if (hits.length === 0) continue

  // A1 CITATION RULE — structural, un-evadable by wording. A file that names a registry client must point at the
  // registry, so a reader (or the next model) is one grep from the verified truth instead of trusting the sentence
  // in front of them. This is the assertion that would have caught tonight's file regardless of how it was phrased.
  if (rel !== REG && !CITATION.test(text))
    add(`A1 ${rel} names registry client(s) ${hits.map((h) => h.c.id.slice(0, 8)).join(', ')} but never cites ${REG}. Reference the registry (or resolve through resolveClientById) so the claim is bound to the verified record.`)

  // A2/A3 do not run against the registry itself: it IS the source of truth, and scanning its own entry text for
  // agreement with its own role field only produces mis-attribution (an id mentioned mid-sentence in one entry's
  // reason reads as a claim about that id). The registry's internal consistency is asserted separately, below.
  if (rel === REG) continue

  const lines = stripQuoted(text).split('\n')
  for (let i = 0; i < lines.length; i++) {
    const here = idTokens.filter((t) => t.re.test(lines[i]) || lines[i].includes(t.full))
    if (here.length === 0) continue
    // Window = this line plus its continuation, stopping at a blank line, a new bullet, or another registry id.
    // Attribution stops where certainty stops: a window naming two ids is a CONTRAST, and guessing which claim
    // belongs to which id is how a guard turns into a nuisance. Those are reported, never failed.
    const win = [lines[i]]
    for (let j = i + 1; j < Math.min(i + 6, lines.length); j++) {
      const l = lines[j]
      if (!l.trim()) break
      if (/^\s*(\/\/\s*)?[·*-]\s/.test(l)) break
      // A RECORD BOUNDARY ENDS A CLAIM UNIT. Without this the window bled out of one array entry and into the next,
      // and attributed the NEXT entry's words to THIS entry's id (caught in construction: bb9e2c31's record ran on
      // into an unregistered neighbour's "fixture" and reported it against c39ee088).
      if (/^\s*[{}]/.test(l)) break
      if (idTokens.some((t) => t.re.test(l) || l.includes(t.full))) break
      win.push(l)
    }
    const idsInWin = new Set()
    for (const l of win) for (const t of idTokens) if (t.re.test(l) || l.includes(t.full)) idsInWin.add(t.c.id)
    if (idsInWin.size !== 1) { unattributable++; continue }
    const entry = CLIENTS.find((c) => c.id === [...idsInWin][0])
    // Strip the citation path itself so "clients/canonical.ts" can never read as a claim word.
    const blob = win.join(' ').replace(/[\w./-]*clients\/canonical[\w.]*/gi, ' ').replace(/canonical-client-identity[\w.]*/gi, ' ')
    claimWindows++

    // A2 ROLE-WORD CONTRADICTION
    if (entry.role !== 'cohort' && COHORT_CLAIM.test(blob))
      add(`A2 ${rel}:${i + 1} asserts a COHORT/real-client claim for ${entry.id.slice(0, 8)} ("${(blob.match(COHORT_CLAIM) || [])[0]}"), but the registry records role=${entry.role} — ${entry.reason}`)
    if (entry.role === 'cohort' && FIXTURE_CLAIM.test(blob))
      add(`A2 ${rel}:${i + 1} asserts a FIXTURE claim for ${entry.id.slice(0, 8)} ("${(blob.match(FIXTURE_CLAIM) || [])[0]}"), but the registry records role=cohort — ${entry.reason}`)

    // A3 DATA-CLAIM CONTRADICTION
    for (const p of PLATFORM_KEYS) {
      if (entry.platforms[p]) continue
      const m = dataClaim(blob, p)
      if (m) add(`A3 ${rel}:${i + 1} claims ${p.toUpperCase()} data for ${entry.id.slice(0, 8)} ("${m[0].trim()}"), but the registry records platforms.${p}=false — ${entry.reason}`)
    }
  }
}

// ── B / C / D: the live-DB assertions ───────────────────────────────────────────────────────────────────────────
if (WITH_DB) {
  const readRoot = (rel) => { try { return readFileSync(resolve(ROOT, rel), 'utf8') } catch { return null } }
  for (const line of (readRoot('.env.local') || '').split('\n')) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/)
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '')
  }
  if (!process.env.SUPABASE_DB_URL) die(`--db requested but SUPABASE_DB_URL is missing (.env.local). Refusing to pass quietly — a skipped identity check reads as a passing one.`)
  const pg = (await import('pg')).default
  const client = new pg.Client({ connectionString: process.env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false } })
  await client.connect()
  const q = async (sql, params) => (await client.query(sql, params)).rows

  // B — id exists, owner matches.
  const dbRows = await q(`select id::text as id, name, user_email, deleted_at from clients where id::text = any($1)`,
    [CLIENTS.map((c) => c.id)])
  for (const c of CLIENTS) {
    const row = dbRows.find((r) => r.id === c.id)
    if (!row) { add(`B ${c.id.slice(0, 8)} ${c.name}: no such row in clients. A registry entry for a client that does not exist is a guessed entry.`); continue }
    if (row.user_email !== c.owner) add(`B ${c.id.slice(0, 8)} ${c.name}: registry owner "${c.owner}" != DB user_email "${row.user_email}". The owner is THE discriminator — a wrong one is worse than none.`)
    if (row.name.trim() !== c.name.trim()) add(`B ${c.id.slice(0, 8)}: registry name "${c.name}" != DB name "${row.name}" — the client was renamed; re-verify which twin is which before editing.`)
  }

  // C — every duplicate-name client in the DB must be registered, so a NEW collision cannot appear unnoticed.
  const dupes = await q(`
    with n as (select id::text as id, name, user_email,
                      lower(regexp_replace(regexp_replace(name, '^(the|a|an)\\s+', '', 'i'), '\\s+', ' ', 'g')) as norm
                 from clients where deleted_at is null)
    select norm, count(*)::int as n,
           array_agg(id || ' (' || user_email || ')' order by name) as members
      from n group by norm having count(*) > 1 order by norm`)
  const registered = new Set(CLIENTS.map((c) => c.id))
  for (const d of dupes) {
    const missing = d.members.filter((m) => !registered.has(m.split(' ')[0]))
    if (missing.length)
      add(`C DB name collision "${d.norm}" (${d.n} clients) has ${missing.length} member(s) NOT in the registry: ${missing.join(', ')}. Every side of a collision must be registered or the next reader picks by name and gets it wrong.`)
  }

  // D — platforms flags vs live row presence, BOTH directions. A flag that says false while rows exist is a stale
  // registry (and is exactly the field tonight's false claim got wrong); true-while-empty is a data loss signal.
  for (const c of CLIENTS) {
    for (const p of PLATFORM_KEYS) {
      const [row] = await q(`select exists (select 1 from metrics_daily where client_id = $1 and platform = $2) as any_rows`, [c.id, p])
      if (row.any_rows && !c.platforms[p]) add(`D ${c.id.slice(0, 8)} ${c.name}: registry says platforms.${p}=false but metrics_daily HOLDS ${p} rows. Registry is stale — re-verify and update, do not assume the flag.`)
      if (!row.any_rows && c.platforms[p]) add(`D ${c.id.slice(0, 8)} ${c.name}: registry says platforms.${p}=true but metrics_daily holds NO ${p} rows. Either the registry is wrong or that platform's data is gone.`)
    }
  }
  await client.end()
}

// ── verdict ─────────────────────────────────────────────────────────────────────────────────────────────────────
console.log(`[canonical-client-identity] ${CLIENTS.length} registry entries · ${claimWindows} attributable claim window(s) · ${unattributable} skipped as unattributable (2+ ids) · DB assertions ${WITH_DB ? 'ON' : 'off (hermetic run)'}`)
if (findings.length) {
  console.error(`[canonical-client-identity] FAIL — ${findings.length} finding(s):`)
  for (const f of findings) console.error(`  - ${f}`)
  console.error(`  A CLIENT NAME IS NOT AN IDENTIFIER. Verify against ${REG}, and if the registry is the thing that is wrong, fix it from a live DB read — never from another doc.`)
  process.exit(1)
}
console.log('[canonical-client-identity] OK')
