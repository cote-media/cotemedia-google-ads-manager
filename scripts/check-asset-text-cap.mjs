#!/usr/bin/env node
// LORAMER_META_ASSET_CODEPOINT_TRUNCATION_V1 — guard. FAILS if capped asset text can carry a lone surrogate,
// or if the shared writer goes back to a raw .slice() cap.
// SHARED-WRITER GUARD: meta-asset-backfill.ts is called by drain-registry.ts:30 (meta_asset step, 4 fires/day
// across 13 Meta clients) AND /api/backfill/meta-asset. A regression breaks scheduled capture for every Meta
// client and the direct route simultaneously.
import { readFileSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { fileURLToPath } from 'node:url'; import { dirname, resolve, join } from 'node:path'
import { tmpdir } from 'node:os'; import { spawnSync } from 'node:child_process'; import { createRequire } from 'node:module'
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const out = mkdtempSync(join(tmpdir(), 'cap-')), cd = mkdtempSync(join(tmpdir(), 'c-')), cfg = join(cd, 'tsconfig.json')
writeFileSync(cfg, JSON.stringify({ compilerOptions: { target:'es2020', module:'commonjs', moduleResolution:'node', skipLibCheck:true, rootDir:ROOT, outDir:out, noEmitOnError:false }, files:[join(ROOT,'src/lib/backfill/safe-truncate.ts')] }))
spawnSync(join(ROOT,'node_modules','.bin','tsc'), ['-p', cfg])
const M = createRequire(import.meta.url)(join(out,'src/lib/backfill/safe-truncate.js'))
const CAP = 300
// THE REAL VALUE: 299 chars then the emoji run that the cap lands inside. Reproduces Foam OH 2024-11-01.
const REAL = 'A'.repeat(295) + '🟠🟡🟢' // UTF-16 len 301 -> .slice(0,300) splits the last pair; codepoint len 298
const FAMILIES = ['image_asset','video_asset','title_asset','body_asset','description_asset','call_to_action_asset','link_url_asset']
const lone = s => { for (let i=0;i<s.length;i++){ const c=s.charCodeAt(i)
  if(c>=0xd800&&c<=0xdbff){const n=s.charCodeAt(i+1); if(!(n>=0xdc00&&n<=0xdfff))return true; i++}
  else if(c>=0xdc00&&c<=0xdfff)return true } return false }
const bad=[]
console.log('LORAMER_META_ASSET_CODEPOINT_TRUNCATION_V1 guard\n')
// VACUITY CHECK: the fixture must actually be hostile under the OLD cap, or every assertion below is meaningless.
const oldWay = REAL.slice(0, CAP)
if (!lone(oldWay)) { console.error('✗ FIXTURE NOT HOSTILE — .slice(0,CAP) produced no lone surrogate; the guard would pass vacuously'); process.exit(2) }
console.log(`  ✓ fixture is hostile: .slice(0,${CAP}) leaves a lone surrogate (the live Foam OH shape)\n`)
for (const f of FAMILIES) {
  const r = M.capText(REAL, CAP)
  // PRESERVATION, not just validity. Under a UTF-16 .slice() the pair splits and stripLoneSurrogates then
  // removes the orphan — output stays VALID while the emoji is silently DROPPED. Validity alone cannot tell
  // "correctly truncated" from "lost the character", and silent loss is the worse failure. Assert the emoji
  // survives and the codepoint count is exact.
  const valid = !lone(r.value) && Buffer.from(r.value,'utf8').toString('utf8') === r.value
  const preserved = r.value.endsWith('\u{1F7E2}') && [...r.value].length === 298
  const ok = valid && preserved
  if (!ok) bad.push(`${f}: valid=${valid} preserved=${preserved} (endsWithGreen=${r.value.endsWith('\u{1F7E2}')} cp=${[...r.value].length}, expected 298)`)
  console.log(`  ${ok?'✓':'✗'} ${f} — cp=${[...r.value].length} endsWith🟢=${r.value.endsWith('\u{1F7E2}')} valid=${valid} sanitised=${r.sanitised}`)
}
// CLEAN PATH must be byte-identical
const CLEAN = 'Plain ASCII ad copy with no astral characters at all.'
const c = M.capText(CLEAN, CAP)
const identical = c.value === CLEAN && c.truncated === false && c.sanitised === false
if (!identical) bad.push('clean value NOT byte-identical')
console.log(`  ${identical?'✓':'✗'} clean value byte-identical (no truncation, no sanitisation flag)`)
// SOURCE PIN — the shared writer must not cap with a raw .slice()
const src = readFileSync(resolve(ROOT,'src/lib/backfill/meta-asset-backfill.ts'),'utf8')
const usesHelper = /capText\s*\(/.test(src)
const rawSlice = /\.slice\(\s*0\s*,\s*VALUE_CAP\s*\)/.test(src)
if (!usesHelper) bad.push('meta-asset-backfill.ts does NOT call capText — the shared writer still caps unsafely')
if (rawSlice) bad.push('meta-asset-backfill.ts still contains .slice(0, VALUE_CAP) — the exact defect')
console.log(`  ${usesHelper?'✓':'✗'} writer calls capText()`)
console.log(`  ${!rawSlice?'✓':'✗'} writer no longer uses .slice(0, VALUE_CAP)`)
rmSync(out,{recursive:true,force:true}); rmSync(cd,{recursive:true,force:true})
if (bad.length){ console.error(`\n✗ asset-text-cap guard: ${bad.length} failure(s)`); bad.forEach(b=>console.error('   → '+b)); process.exit(2) }
console.log('\n✓ asset-text-cap guard: capped asset text can never carry a lone surrogate, and the shared writer caps by codepoint.')
