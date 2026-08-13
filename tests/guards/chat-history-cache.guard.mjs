#!/usr/bin/env node
// LORAMER_CHAT_HISTORY_CACHE_V1 — the conversation breakpoint and the honest cache ledger.
//
// ⛔ WHAT WAS MEASURED BEFORE THIS EXISTED (anthropic_spend_log, Opus-5 era, 2026-08-13): the full thread
// rode `messages` at FULL PRICE on every model call of every turn, re-paid per tool-loop iteration. The
// Escential Group thread (64,010 history tokens) hit $2.1380 on one turn (285,526 full-price input); the
// prefix-only cache saved ~$1.49 NET in three weeks. AND the ledger under-priced every 1h cache write at
// the 5m rate — 37.5% under, ~$1.83 to date — because the route shipped ttl:'1h' after the pricing map was
// written for 5m.
//
// FOUR LEGS, the last one DRIVEN (the compiled function, not its source):
//   (a) the FINAL user message carries cache_control ttl '5m' — the vendor's multi-turn pattern
//   (b) THE ORDERING LAW (vendor, verbatim: "Cache entries with longer TTL must appear before shorter
//       TTLs") — the system prefix stays 1h and the message breakpoint stays 5m, never inverted
//   (c) THE 4-BREAKPOINT CEILING — cache_control sites across the request assembly stay ≤ 4 (2 today)
//   (d) computeCostUsd prices a 1h write at the 1h rate — proven by EXECUTION on Opus 5:
//       1M 1h-tokens → $10.00 · 1M 5m-tokens → $6.25. Text-search guards have gone green over broken
//       behaviour three times in one day in this repo; the pricing claim is executed, not grepped.
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs'
import { resolve, join } from 'node:path'
import { tmpdir } from 'node:os'
import { spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'
import Module from 'node:module'

const ROOT = process.env.LORAMER_GUARD_ROOT || process.cwd()
const findings = []
const read = (rel) => {
  try { return readFileSync(resolve(ROOT, rel), 'utf8') }
  catch (e) { findings.push(`UNREADABLE ${rel} — ${e.message}. A guard that cannot read its evidence FAILS.`); return '' }
}
const ROUTE = 'src/app/api/chat/route.ts'
const LOGGER = 'src/lib/spend-logger.ts'
const TOOLS = 'src/lib/claude-tools.ts'
const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').split('\n').filter((l) => !/^\s*\/\//.test(l)).join('\n')

const route = strip(read(ROUTE))

// ── (a) THE CONVERSATION BREAKPOINT ─────────────────────────────────────────────────────────────────
// The final user message must be array-of-blocks (cache_control requires it) with an ephemeral 5m marker.
{
  const m = route.match(/role:\s*'user'\s*as\s*const,\s*content:\s*\[\s*\{\s*type:\s*'text'[\s\S]{0,200}?cache_control:\s*\{\s*type:\s*'ephemeral'[^}]*ttl:\s*'5m'/)
  if (!m) {
    findings.push(`(a) ${ROUTE} does not mark the FINAL user message with cache_control ttl '5m'. Without the conversation breakpoint the ENTIRE thread rides messages at full price on every model call of every turn — the measured $2.14-per-turn shape on a 64k-token thread, re-paid per tool-loop iteration.`)
  }
}

// ── (b) THE ORDERING LAW — 1h BEFORE 5m, NEVER INVERTED ─────────────────────────────────────────────
// Vendor: longer TTLs must appear before shorter. system (1h) precedes messages (5m) in the request, so
// the pair is legal exactly as long as NEITHER side flips. Both sides are pinned; flipping either without
// the other is a malformed request or a silent price change.
{
  if (!/cache_control:\s*\{\s*type:\s*'ephemeral',\s*ttl:\s*'1h'\s*\}/.test(route)) {
    findings.push(`(b) ${ROUTE} no longer carries the 1h prefix breakpoint. If this was deliberate, the 5m message breakpoint and the ledger's TTL attribution move in the same commit — the ordering law and the pricing both assumed 1h-then-5m.`)
  }
  const iPrefix = route.search(/ttl:\s*'1h'/)
  const iMsg = route.search(/ttl:\s*'5m'/)
  if (iPrefix !== -1 && iMsg !== -1 && iMsg < iPrefix) {
    findings.push(`(b) the 5m breakpoint appears BEFORE the 1h breakpoint in ${ROUTE}. Vendor law, verbatim: "Cache entries with longer TTL must appear before shorter TTLs" — this request shape is malformed.`)
  }
}

// ── (c) THE 4-BREAKPOINT CEILING ────────────────────────────────────────────────────────────────────
{
  const count = (route.match(/cache_control:/g) || []).length
  const toolsCount = (strip(read(TOOLS)).match(/cache_control:/g) || []).length
  if (count + toolsCount > 4) {
    findings.push(`(c) ${count + toolsCount} cache_control sites across ${ROUTE} + ${TOOLS} — the API allows at most 4 breakpoints per request and returns a 400 past it. Remove one or restructure.`)
  }
  if (count < 2) {
    findings.push(`(c) fewer than 2 cache_control sites in ${ROUTE} — either the prefix or the conversation breakpoint is gone, and whichever it is, the spend shape this guard was sized on no longer holds.`)
  }
}

// ── (d) THE LEDGER, DRIVEN ──────────────────────────────────────────────────────────────────────────
{
  const out = mkdtempSync(join(tmpdir(), 'loramer-histcache-'))
  const tsc = join(ROOT, 'node_modules', '.bin', 'tsc')
  const r = spawnSync(tsc, [resolve(ROOT, LOGGER), '--target', 'es2020', '--module', 'commonjs', '--outDir', out, '--skipLibCheck'], { encoding: 'utf8' })
  // The logger imports `@/lib/supabase` for logSpend; computeCostUsd is pure. Stub the alias so the pure
  // half is drivable without a DB — same pattern as inception-stop's compiled-module legs.
  const stub = join(out, 'stub.js')
  writeFileSync(stub, 'module.exports = new Proxy({}, { get: () => function () {} })\n')
  const origResolve = Module._resolveFilename
  Module._resolveFilename = function (request, ...rest) {
    if (typeof request === 'string' && request.startsWith('@/')) return origResolve.call(this, stub, ...rest)
    return origResolve.call(this, request, ...rest)
  }
  let L = null
  try { L = createRequire(import.meta.url)(join(out, 'spend-logger.js')) }
  catch (e) { findings.push(`(d) could not compile/load ${LOGGER} — ${r.error?.message ?? e.message}. A BROKEN INSTRUMENT, not a pass.`) }
  finally { Module._resolveFilename = origResolve }
  if (L) {
    if (typeof L.computeCostUsd !== 'function') {
      findings.push(`(d) ${LOGGER} exports no computeCostUsd — the pricing function this leg drives has moved or vanished.`)
    } else {
      const oneH = L.computeCostUsd('claude-opus-5', 0, 0, 0, 0, 1_000_000)
      const fiveM = L.computeCostUsd('claude-opus-5', 0, 0, 0, 1_000_000, 0)
      if (Math.abs(oneH - 10.00) > 1e-9) {
        findings.push(`(d) 1,000,000 1h cache-write tokens on claude-opus-5 priced at $${oneH} — expected $10.00 (2× the $5 base; vendor: "1-hour cache write tokens are 2 times the base input tokens price"). This is the exact 37.5% under-report the ledger carried for a week.`)
      }
      if (Math.abs(fiveM - 6.25) > 1e-9) {
        findings.push(`(d) 1,000,000 5m cache-write tokens on claude-opus-5 priced at $${fiveM} — expected $6.25 (1.25× base). The 5m rate moved while the 1h leg was added; both must hold.`)
      }
      // Every model that carries cache rates must carry BOTH write rates — a missing 1h rate silently
      // re-opens the under-pricing on any model the chain falls back to.
      for (const [name, rates] of Object.entries(L.MODEL_PRICING)) {
        if (rates.cacheWrite5m != null && rates.cacheWrite1h == null) {
          findings.push(`(d) MODEL_PRICING['${name}'] has a 5m write rate but NO 1h rate — a fallback to it re-opens the 37.5% under-report with only a console.warn to show for it.`)
        }
      }
    }
  }
}

if (findings.length) {
  console.error(`[chat-history-cache] FAIL — ${findings.length} finding(s):`)
  for (const f of findings) console.error(`  - ${f}`)
  process.exit(1)
}
console.log(`[chat-history-cache] PASS — the final user message carries the 5m conversation breakpoint · the 1h prefix precedes it (vendor ordering law) · ≤4 breakpoints per request (2 today) · and computeCostUsd, EXECUTED, prices 1M 1h-write tokens at $10.00 and 1M 5m-write tokens at $6.25 on Opus 5, with every cache-rated model carrying both write rates. LIMIT: this proves the REQUEST SHAPE and the LEDGER ARITHMETIC — that the API actually serves cache hits is visible only in anthropic_spend_log's cache_read column on live turns.`)
