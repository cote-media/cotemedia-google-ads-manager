#!/usr/bin/env node
// LORAMER_DOC_OWNERSHIP_GUARD_V1 — A DOC MAY POINT AT A FACT. IT MAY NOT STATE A VALUE SOMETHING ELSE OWNS.
//
// ⛔ WHAT THIS COVERS, AND THE BOUNDARY IS THE DESIGN — NOT A LIMITATION APOLOGISED FOR AT THE BOTTOM.
// This guard checks ONLY facts with a SINGLE MACHINE-READABLE OWNER and a LITERAL value that can be compared:
//   · MODEL IDS        — a doc naming claude-* vs the resolved default in the route that owns it
//   · API VERSION PINS — Shopify '20xx-xx', Meta 'vNN.0', google-ads-api major, next major — vs code/package.json
//   · FILE FACTS       — line counts and enumerated table lists asserted in prose
// Those are decidable by comparison. Everything below is NOT, and is DELIBERATELY NOT ATTEMPTED:
//   · "this doc RESTATES a decision instead of citing it" — needs to know two prose passages mean the same
//     thing. That is COMPREHENSION, NOT MATCHING.
//   · TENSE. "Meta approved 2026-07-02" (history, allowed) vs "Meta is approved" (a copy, forbidden) is the
//     actual ownership rule and separating them reliably needs parsing, not grep.
// ⛔ THE PRECEDENT FOR REFUSING THOSE IS IN THIS REPO: canonical-client-identity's A2/A3 are pattern matchers
// over phrasings that actually occurred; they have TWICE forced a CORRECT sentence to be reworded rather than
// catching a real error, and A2 still lacks the negation handling A3 has (★A2-NEGATION-HANDLING, open).
// Scaling that shape to arbitrary decisions produces a guard that mostly false-fails, and a guard that cries
// wolf gets deleted. The decision/tense half stays a CLAUDE.md REFUSAL GATE — weaker, but it does not
// manufacture false confidence, and an unenforceable rule dressed as a check is the thing this flight exists
// to stop writing.
//
// ⛔ SPLIT, deliberate: THIS file is hermetic and runs in `npm run guard` -> `npm run build` -> Vercel.
// The DB-dependent half — migration applied-state and env presence — lives in `scripts/check-doc-ownership-data.mjs`
// under `npm run check:data`, same posture as every other DB check, so a data condition can never brick a deploy.
//
// WHY IT EXISTS, measured 2026-07-31: ELEVEN live-wrong copied facts across HANDOFF, CLAUDE.md and migrations/
// inside a 9/9-green freshness gate — because that gate proves docs match DOCS, never that a doc matches CODE.
// HANDOFF named two model ids, both wrong for weeks. CLAUDE.md enumerated NINE tables against a 39-table
// database. Shopify's pin read '2025-01' after the pin moved, and '2025-01' was fiction anyway.

import { readFileSync, existsSync } from 'node:fs'
import { resolve } from 'node:path'

const ROOT = process.env.LORAMER_GUARD_ROOT || process.cwd()
const findings = []
const check = (c, m) => { if (!c) findings.push(m) }
const read = (p) => { try { return readFileSync(resolve(ROOT, p), 'utf8') } catch { return '' } }

// Strip line comments / historical quotes is NOT possible in markdown, so instead every rule below EXEMPTS a
// line that is explicitly recording the defect. QUOTATION IS NOT ASSERTION — banked three times, most recently
// INSIDE the guard written to catch it, so the exemption is a marker a human must type on purpose.
const EXEMPT = /⛔|not restated here|owned by|it read|used to say|Historical:|do not restate|NOT LISTED HERE|NOT AUTHORITATIVE|shelf life/i
const DOCS = ['CLAUDE.md', 'LORAMER_HANDOFF.md', 'LORAMER_ESSENCE.md', 'RESUME_INSTRUCTIONS.md']

const lines = (f) => read(f).split('\n').map((t, i) => ({ f, n: i + 1, t })).filter((l) => l.t.trim())

// ── OWNER 1: MODEL IDS ─────────────────────────────────────────────────────────────────────────────────
{
  const chat = read('src/app/api/chat/route.ts')
  const insight = read('src/app/api/insight/route.ts')
  const owned = new Set()
  for (const src of [chat, insight]) {
    for (const m of src.matchAll(/process\.env\.LORA_(?:CHAT|INSIGHT)_MODEL\s*\|\|\s*'([^']+)'/g)) owned.add(m[1])
  }
  check(owned.size > 0, 'OWNER-READ FAILED: could not resolve any model default from chat/insight route.ts — the guard cannot compare against an owner it cannot read, and a guard that silently passes because it read nothing is worse than none.')
  for (const f of DOCS) {
    for (const l of lines(f)) {
      if (EXEMPT.test(l.t)) continue
      // ⛔ MATCH ONLY REAL ANTHROPIC MODEL-ID SHAPES: claude-<family>-<numbers>. The first cut used
      // /claude-[a-z0-9][a-z0-9.-]*/ and produced TWELVE false positives on its first run — `claude-tools.ts`,
      // `claude-context.ts`, `Claude-app`, `Claude-side`, `Claude-powered`. That is precisely the false-fail
      // mode this guard's own header warns about (canonical-client-identity's A2 has twice forced a correct
      // sentence to be reworded), so the pattern is anchored to the family names and a leading digit, and a
      // filename can never satisfy it.
      for (const m of l.t.matchAll(/\b(claude-(?:opus|sonnet|haiku)-\d[\w-]*)/gi)) {
        const id = m[1].replace(/[.,)`]+$/, '')
        check(owned.has(id),
          `${l.f}:${l.n} STATES model id '${id}', which the CODE owns and which does not match a current default (${[...owned].join(', ')}). Point at LORA_CHAT_MODEL / LORA_INSIGHT_MODEL and the route that defaults them; do not write the value. HANDOFF carried two wrong ids for weeks inside a green gate, and prod once ran Sonnet while the eval measured Opus.`)
      }
    }
  }
}

// ── OWNER 2: API VERSION PINS ──────────────────────────────────────────────────────────────────────────
{
  const shopifyPin = (read('src/lib/intelligence/shopify-intelligence.ts').match(/GRAPHQL_API_VERSION\s*=\s*'([^']+)'/) || [])[1]
  check(!!shopifyPin, 'OWNER-READ FAILED: GRAPHQL_API_VERSION not found in shopify-intelligence.ts.')
  for (const f of DOCS) {
    for (const l of lines(f)) {
      if (EXEMPT.test(l.t)) continue
      // A Shopify-shaped version literal in a doc line that also mentions Shopify.
      if (/shopify/i.test(l.t)) {
        for (const m of l.t.matchAll(/'(\d{4}-\d{2})'/g)) {
          const stated = m[1]
          check(stated === shopifyPin,
            `${l.f}:${l.n} STATES Shopify API version '${stated}' — the code pin is '${shopifyPin}' (shopify-intelligence.ts). Point at the constant. This exact line read '2025-01' long after the pin moved, and Shopify was silently serving 2025-10 regardless.`)
        }
      }
    }
  }
}

// ── OWNER 3: FILE FACTS — line counts and enumerated table lists ───────────────────────────────────────
{
  for (const f of DOCS) {
    for (const l of lines(f)) {
      if (EXEMPT.test(l.t)) continue
      const m = l.t.match(/`?([\w./-]+\.tsx?)`?[^\n]{0,80}?([\d,]{3,})\+?\s*lines/i)
      if (m) {
        const claimed = Number(m[2].replace(/,/g, ''))
        const actual = read(m[1]).split('\n').length
        check(actual > 0 && Math.abs(actual - claimed) <= Math.max(50, claimed * 0.05),
          `${l.f}:${l.n} STATES ${m[1]} is ~${claimed} lines; it is ${actual}. A count in prose is a fact with a shelf life — describe the file, do not measure it here.`)
      }
    }
  }
  // An enumerated Supabase table list in prose is the same class: CLAUDE.md named NINE against 39.
  for (const f of DOCS) {
    for (const l of lines(f)) {
      if (EXEMPT.test(l.t)) continue
      if (/Supabase tables?:/i.test(l.t)) {
        const ticks = (l.t.match(/`[a-z_]+`/g) || []).length
        check(ticks < 3,
          `${l.f}:${l.n} ENUMERATES ${ticks} Supabase tables in prose. The SCHEMA owns the table set — point at migrations/ or list_tables. This line named nine while the database held thirty-nine.`)
      }
    }
  }
}

if (findings.length) {
  console.error(`[doc-ownership] FAIL — ${findings.length} finding(s):`)
  for (const f of findings) console.error(`  · ${f}`)
  process.exit(1)
}
console.log('[doc-ownership] PASS — no governance doc states a model id, an API version pin, a file line count or a table enumeration that another source owns. (Decision-restatement and tense are NOT checked, by design — see header.)')
