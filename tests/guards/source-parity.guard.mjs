#!/usr/bin/env node
// LORAMER_LIVE_VS_CAPTURED_SOURCE_PARITY_GUARD_V1
//
// FAILS if a captured family can reach the registry without Lora being told it exists, or if a BOTH-list family
// loses its dual-source labels / its restatement basis.
//
// THE BUG IT GUARDS: build-claude-context renders ONLY the live snapshot. The captured store reaches Lora solely
// through the tools, so before LORAMER_LIVE_VS_CAPTURED_SOURCE_PARITY_V1 no turn ever presented the two AS SOURCES
// — she could not label what she was never told existed, and a normal settlement gap read to her as a
// discrepancy. Russ, 2026-07-25: "it's not either or … in most cases for honesty it should be BOTH."
//
// IT GUARDS THE CLASS, NOT TODAY'S 35 FAMILIES. Nothing here is hardcoded to a platform or a family:
//   1. RENDERER WIRED — build-claude-context must call buildSourceParityLines, and must emit the standing rule.
//   2. EVERY BOTH-FAMILY toolType EXISTS in the registry (no invented breakdown types — the same rule the
//      degraded renderer carries; pointing Lora at a tool that cannot answer manufactures a false zero).
//   3. EVERY PLATFORM with BOTH families has a RESTATEMENT BASIS — the WHY payload is what turns "they differ"
//      into "they differ BECAUSE"; a family pair with no basis is a discrepancy report waiting to happen.
//   4. CAPTURED-ONLY STAYS COMPUTED — capturedOnlyFor must derive from REGISTRY. If someone replaces it with a
//      typed list, a newly-registered family silently stops being surfaced. That is the regression that matters.
//   5. THE PROHIBITIONS SURVIVE — the standing rule must keep the forbidden-answer framing (never one silently,
//      never fused/averaged, FORBIDDEN). Compression is allowed; deleting a prohibition is not.
//   6. ORDERING — the parity call must precede the campaigns-empty early-return, exactly like the degraded block:
//      "live shows nothing this window" is the turn where the captured second source matters MOST.
//
// AUTHORITATIVE SOURCE = THE CODE + THE REGISTRY, never a doc. HERMETIC: pure filesystem reads, no network/DB.
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const PARITY = resolve(ROOT, 'src/lib/intelligence/source-parity.ts')
const CONTEXT = resolve(ROOT, 'src/lib/intelligence/build-claude-context.ts')
const REGISTRY = resolve(ROOT, 'src/lib/breakdown-registry.ts')

const read = (p) => { try { return readFileSync(p, 'utf8') } catch { return null } }
const failures = []
const fail = (m) => failures.push(m)

const parity = read(PARITY)
const ctx = read(CONTEXT)
const reg = read(REGISTRY)
if (!ctx || !reg) { console.error('FAIL: cannot read build-claude-context.ts or breakdown-registry.ts'); process.exit(1) }

if (!parity) {
  fail('NO SOURCE-PARITY MODULE: src/lib/intelligence/source-parity.ts is absent — the captured store is invisible to Lora as a SOURCE; she can only ever report the live snapshot.')
} else {
  // ── 1. RENDERER WIRED ───────────────────────────────────────────────────────────────────────────────────────
  if (!/buildSourceParityLines\s*\(/.test(ctx)) {
    fail('RENDERER NEVER CALLED: build-claude-context.ts does not call buildSourceParityLines — the two sources are never presented to Lora as sources.')
  }
  if (!/SOURCE_PARITY_RULE/.test(ctx)) {
    fail('STANDING RULE NOT EMITTED: build-claude-context.ts never pushes SOURCE_PARITY_RULE — the per-platform labels exist with no rule telling Lora to call the tool and report both.')
  }
  // ── 6. ORDERING vs the campaigns-empty early-return ─────────────────────────────────────────────────────────
  const callIdx = ctx.indexOf('buildSourceParityLines(parity.key')
  const emptyIdx = ctx.indexOf('if (!platform.campaigns?.length)')
  if (callIdx !== -1 && emptyIdx !== -1 && callIdx > emptyIdx) {
    fail('ORDERING: the parity block renders AFTER the `!platform.campaigns?.length` early-return. A window with no live rows is exactly when Lora most needs to know the captured store is a second source — it would be silenced there.')
  }

  // ── PARSE the declared BOTH families ────────────────────────────────────────────────────────────────────────
  const bothBlock = parity.match(/export const BOTH_FAMILIES[\s\S]*?\n\}/)
  const basisBlock = parity.match(/export const RESTATEMENT_BASIS[\s\S]*?\n\}/)
  if (!bothBlock) fail('NO BOTH_FAMILIES MAP: nothing declares which families exist in both sources.')
  if (!basisBlock) fail('NO RESTATEMENT_BASIS MAP: nothing tells Lora WHY the two sources differ — she can only report that they do.')

  if (bothBlock && basisBlock) {
    // Registry truth: platform → set of real breakdown toolTypes.
    const regTypes = new Map()
    for (const m of reg.matchAll(/platform:\s*'(\w+)'[\s\S]{0,400}?toolType:\s*'([a-z0-9_]*)'/g)) {
      if (!regTypes.has(m[1])) regTypes.set(m[1], new Set())
      if (m[2]) regTypes.get(m[1]).add(m[2])
    }
    // Declared: platform → [toolType]
    const declared = new Map()
    for (const pm of bothBlock[0].matchAll(/^\s{2}(\w+):\s*\[([\s\S]*?)\n\s{2}\],?$/gm)) {
      declared.set(pm[1], [...pm[2].matchAll(/toolType:\s*'([a-z0-9_]*)'/g)].map((x) => x[1]))
    }
    if (declared.size === 0) fail('BOTH_FAMILIES parsed EMPTY — the guard cannot see any declared family; treat as a failure, never a pass.')

    const basisPlatforms = new Set([...basisBlock[0].matchAll(/^\s{2}(\w+):\s*'/gm)].map((m) => m[1]))
    for (const [pf, types] of declared) {
      // ── 2. NO INVENTED TOOL TYPES ────────────────────────────────────────────────────────────────────────────
      const real = regTypes.get(pf) || new Set()
      const bogus = types.filter((t) => t && !real.has(t))
      if (bogus.length) {
        fail(`INVENTED breakdownType(s) for ${pf}: ${bogus.join(', ')} — not in breakdown-registry.ts. Lora would be told to call a tool that cannot answer, which manufactures a false zero.`)
      }
      // ── 3. EVERY BOTH-PLATFORM HAS A BASIS ───────────────────────────────────────────────────────────────────
      if (types.length && !basisPlatforms.has(pf)) {
        fail(`NO RESTATEMENT BASIS for ${pf}: it declares ${types.length} dual-source famil(ies) but no basis string, so Lora can say THAT the sources differ and never WHY. Add it from LORAMER_RESTATEMENT_WINDOW_LAW_V1 — do not re-derive the window.`)
      }
    }
  }

  // ── 4. CAPTURED-ONLY STAYS COMPUTED FROM THE REGISTRY ───────────────────────────────────────────────────────
  const copFn = parity.match(/export function capturedOnlyFor[\s\S]*?\n\}/)
  if (!copFn) {
    fail('capturedOnlyFor() MISSING: nothing tells Lora that captured-only families exist, so a family in the store but absent from the prompt reads as nonexistent.')
  } else if (!/REGISTRY\s*\.\s*filter/.test(copFn[0].replace(/\/\/[^\n]*/g, ''))) {
    // Comments stripped first, and we require REAL USAGE (REGISTRY.filter), not a mention: a hardcoded list under
    // a comment that still SAYS "computed from the registry" is exactly the honest-but-false shape this rejects.
    fail('capturedOnlyFor() NO LONGER DERIVES FROM THE REGISTRY: it must compute from REGISTRY, never a typed list. With a hardcoded list, a newly-registered family silently stops being surfaced to Lora — the exact class this guard exists for.')
  }

  // ── 5. THE PROHIBITIONS SURVIVE COMPRESSION ─────────────────────────────────────────────────────────────────
  const ruleBlock = parity.match(/export const SOURCE_PARITY_RULE[\s\S]*?\.join\('\\n'\)/)
  if (!ruleBlock) {
    fail('SOURCE_PARITY_RULE MISSING — no standing rule instructs Lora to call the tool and report both.')
  } else {
    const r = ruleBlock[0]
    const required = [
      ['MUST call', /MUST call/],
      ['report BOTH', /report BOTH/],
      ['never one silently', /NEVER report one source silently/],
      ['no fusing/averaging', /NEVER average, blend, or fuse/],
      ['FORBIDDEN framing', /FORBIDDEN/],
    ]
    for (const [name, re] of required) {
      if (!re.test(r)) fail(`PROHIBITION LOST: the standing rule no longer carries "${name}". Compression is fine; deleting a prohibition is not — this is the idiom proven in LORAMER_LORA_FETCHERRORS_DEGRADED_V1.`)
    }
  }
}

if (failures.length) {
  console.error('\n❌ LORAMER_LIVE_VS_CAPTURED_SOURCE_PARITY_GUARD_V1 FAILED\n')
  failures.forEach((f) => console.error('  • ' + f))
  console.error('')
  process.exit(1)
}
console.log('source-parity.guard: PASS — renderer wired before the empty-state return, standing rule intact with all prohibitions, every BOTH toolType real, every dual-source platform has a restatement basis, captured-only still computed from the registry.')
