#!/usr/bin/env node
// LORAMER_REFUSED_RATIO_IS_NULL_V1 — THE FIX-WITH-GUARD HALF.
//
// ⛔ WHAT THIS PROTECTS, MEASURED 2026-08-04: 119,375 of 119,375 stamped rows carried roas/cpa/cpc/ctr/cpm
// computed on a metric the vendor had REFUSED, sitting directly beneath a `refusedMeaning` telling the reader
// never to do exactly that. The row carried its own contradiction. The cause was ORDER OF EVALUATION — the
// ratios were built at the top of the `extra` literal and the refusal stamp was spread in at the bottom — so
// nothing was wrong with either half on its own, which is precisely why review did not catch it.
//
// ⛔ NULL AND 0 ARE DIFFERENT FACTS AND THAT IS THE WHOLE POINT. A 0 ROAS is a CLAIM about performance. A null
// is an ABSENCE of information. A reader cannot tell them apart after the fact, so the distinction has to be
// made at the moment of writing and again at the moment of reading.
//
// ⛔ EVERY LEG DRIVES COMPILED CODE. Text-search guards went green over broken behaviour THREE times in the 24
// hours before this file was written, one of them in a guard authored hours after the hazard was banked
// (★CODE-HYGIENE-SWEEP-KNOWN-HAZARDS item 3). Nothing here greps for a name.
import { readFileSync, mkdtempSync, writeFileSync, symlinkSync } from 'node:fs'
import { resolve, dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFileSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { createRequire } from 'node:module'

const ROOT = process.env.LORAMER_GUARD_ROOT || resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const findings = []
const read = (p) => readFileSync(resolve(ROOT, p), 'utf8')

function compile(files, label) {
  const out = mkdtempSync(join(tmpdir(), 'loramer-rrn-'))
  const cfg = join(out, 'tsconfig.json')
  writeFileSync(cfg, JSON.stringify({
    extends: join(ROOT, 'tsconfig.json'),
    compilerOptions: {
      module: 'commonjs', moduleResolution: 'node', noEmit: false, declaration: false,
      incremental: false, composite: false, rootDir: ROOT, baseUrl: ROOT,
      paths: { '@/*': ['src/*'] }, outDir: out,
      typeRoots: [join(ROOT, 'node_modules/@types')], types: ['node'],
    },
    files: files.map((f) => join(ROOT, f)), include: [], exclude: [],
  }))
  execFileSync(join(ROOT, 'node_modules/.bin/tsc'), ['-p', cfg], { stdio: 'pipe' })
  try { symlinkSync(join(ROOT, 'node_modules'), join(out, 'node_modules')) } catch {}
  const stub = join(out, 'supabase-stub.js')
  writeFileSync(stub, 'exports.supabaseAdmin = { from: () => { throw new Error("guard stub") }, rpc: () => { throw new Error("guard stub") } };\n')
  const require_ = createRequire(import.meta.url)
  const Module = require_('module')
  const orig = Module._resolveFilename
  Module._resolveFilename = function (req, ...a) {
    if (req === '@/lib/supabase') return stub
    if (req.startsWith('@/')) return join(out, 'src', req.slice(2) + '.js')
    return orig.call(this, req, ...a)
  }
  try { return files.map((f) => require_(join(out, f.replace(/\.ts$/, '.js')))) }
  finally { Module._resolveFilename = orig }
}

// ── (a)+(b) THE WRITER: no ratio on a refused input, and it is NULL rather than 0 ─────────────────
try {
  const [W] = compile(['src/lib/backfill/google-ads-universe-writer.ts'], 'writer')
  if (typeof W.derivedRatios !== 'function') {
    findings.push('(a) derivedRatios() is gone from the writer. The six ratios are back inline in the `extra` literal, which is the exact shape that produced 119,375 contradictory rows — the ratio is computed before the refusal is consulted.')
  } else {
    // A grain that refuses spend + clicks + impressions (the real conversion_action shape).
    const refusing = { resource: 'campaign_budget', segment: 'segments.conversion_action',
      refusesMetrics: ['metrics.cost_micros', 'metrics.clicks', 'metrics.impressions'],
      servesMetrics: ['metrics.conversions', 'metrics.conversions_value'], metricSetReason: '{"error_code":{"query_error":53}}' }
    const clean = { resource: 'campaign', segment: 'segments.device', refusesMetrics: [], servesMetrics: [] }
    const m = { spend: 100, impressions: 1000, clicks: 50, conversions: 10, conversionValue: 400 }

    const r = W.derivedRatios(refusing, m)
    // Every ratio here touches spend, clicks or impressions — all refused — so ALL SIX must be null.
    for (const k of ['ctr', 'cpc', 'cpm', 'roas', 'cpa', 'convRate']) {
      if (r[k] !== null) {
        findings.push(`(b) derivedRatios wrote ${k}=${JSON.stringify(r[k])} on a grain refusing spend/clicks/impressions. It MUST be null: 0 is a CLAIM about performance, null is an ABSENCE, and no reader can tell them apart afterwards.`)
      }
    }
    // ⛔ AND THE OPPOSITE ERROR — nulling everything would be just as wrong and would pass a naive check.
    const c = W.derivedRatios(clean, m)
    for (const k of ['ctr', 'cpc', 'cpm', 'roas', 'cpa', 'convRate']) {
      if (typeof c[k] !== 'number') {
        findings.push(`(a) derivedRatios returned ${JSON.stringify(c[k])} for ${k} on a grain that refuses NOTHING. Suppressing real ratios is the same failure in the other direction — it destroys good data instead of publishing bad.`)
      }
    }
    // EITHER SIDE POISONS IT: refusing only the NUMERATOR must still null the ratio.
    const numOnly = { resource: 'x', segment: 'segments.y', refusesMetrics: ['metrics.conversions_value'], servesMetrics: [] }
    const rn = W.derivedRatios(numOnly, m)
    if (rn.roas !== null) {
      findings.push(`(a) roas=${JSON.stringify(rn.roas)} when only its NUMERATOR (conversion_value) is refused. A ratio is poisoned by EITHER side, not just the denominator — a half-real ratio is more dangerous than none.`)
    }
    if (rn.cpc === null) {
      findings.push('(a) cpc was nulled when only conversion_value is refused — cpc does not use it. Over-suppression hides real data.')
    }
  }
} catch (e) {
  findings.push(`(a) could not drive the writer: ${String(e.stdout || '').trim() || e.message}`)
}

// ── (c) THE READ PATH: never hands back a ratio or a divisible 0 from a refused metric ────────────
try {
  const [R] = compile(['src/lib/google-refused-metrics.ts'], 'read')
  if (typeof R.applyRefusal !== 'function' || typeof R.refusedMetricsFor !== 'function') {
    findings.push('(c) applyRefusal()/refusedMetricsFor() are gone. The read path is back to serving a refused metric as a divisible 0 — ★UNIVERSE-REFUSED-METRIC-READ-PATH, reopened.')
  } else {
    const refused = R.refusedMetricsFor('google', 'conversion_action', 'campaign_budget')
    if (!refused.includes('spend')) {
      findings.push(`(c) refusedMetricsFor('google','conversion_action','campaign_budget') = ${JSON.stringify(refused)} — expected it to include 'spend'. The grain map has drifted from the artifact; regenerate with scripts/build-refused-metrics.mjs.`)
    }
    const out = R.applyRefusal(
      { spend: 100, impressions: 1000, clicks: 50, conversions: 10, conversion_value: 400 },
      { ctr: 5, cpc: 2, cpm: 100, roas: 4, cpa: 10, convRate: 20 }, refused)
    for (const k of refused) {
      if (out.metrics[k] !== null) {
        findings.push(`(c) the read path returned ${k}=${JSON.stringify(out.metrics[k])} for a REFUSED metric. Lora can divide by that. It must be null.`)
      }
    }
    for (const k of ['roas', 'cpa', 'cpc', 'ctr', 'cpm']) {
      if (out.derived[k] !== null) {
        findings.push(`(c) the read path returned derived.${k}=${JSON.stringify(out.derived[k])} built on a refused metric. That is a confident wrong number reaching the answer layer.`)
      }
    }
    // Nothing refused → nothing suppressed.
    const clean = R.applyRefusal({ spend: 100, clicks: 50 }, { cpc: 2 }, [])
    if (clean.metrics.spend !== 100 || clean.derived.cpc !== 2) {
      findings.push('(c) applyRefusal suppressed values on a grain that refuses nothing — that silently deletes real data from every ordinary breakdown.')
    }
  }
} catch (e) {
  findings.push(`(c) could not drive the read path: ${String(e.stdout || '').trim() || e.message}`)
}

// ── THE GENERATED MAP MUST MATCH THE ARTIFACT (it is generated; drift is silent) ───────────────────
try {
  const doc = JSON.parse(read('docs/google-ads-capture-universe.json'))
  const { buildMap } = await import(resolve(ROOT, 'scripts/build-refused-metrics.mjs'))
  const expected = buildMap(doc)
  const [R] = compile(['src/lib/google-refused-metrics.ts'], 'map')
  const got = R.GOOGLE_REFUSED_METRICS || {}
  const ek = Object.keys(expected).sort(), gk = Object.keys(got).sort()
  if (ek.length !== gk.length || ek.some((k, i) => k !== gk[i])) {
    findings.push(`(d) src/lib/google-refused-metrics.ts is STALE: ${gk.length} grains vs ${ek.length} in the artifact. It is GENERATED — re-run scripts/build-refused-metrics.mjs. A stale map means the read path stops suppressing grains the probe has since found to be refused.`)
  }
} catch (e) {
  findings.push(`(d) could not compare the generated map to the artifact: ${e.message}`)
}

const label = 'LORAMER_REFUSED_RATIO_IS_NULL_V1'
if (findings.length) {
  console.error(`✗ ${label} GUARD FAILED — ${findings.length} finding(s):`)
  for (const f of findings) console.error(`  - ${f}`)
  process.exit(1)
}
console.log(`✓ ${label} GUARD PASSED — no ratio on a refused input, null never 0, the read path refuses too, and the generated map matches the artifact.`)
