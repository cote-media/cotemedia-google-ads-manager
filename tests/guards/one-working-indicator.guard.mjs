#!/usr/bin/env node
// LORAMER_ONE_WORKING_INDICATOR_PER_TURN_V1 — ONE working indicator per turn, ONE mark size, and the
// CONTAINERS must actually mount the shared component.
//
// ⛔ WHAT THIS PROTECTS, OBSERVED ON DEVICE 2026-08-05 (Chrome iOS, Foam OH, ONE turn): a large static LM
// mark, a bubble reading "Still working on this one…", and BELOW IT a second animating mark reading
// "Working…". Two indicators, two copies, one turn.
//
// ⛔ THE CAUSE WAS NOT IN LoraWorking AND NOT IN ITS CSS. `setLoading(false)` sits in the `finally` of
// `send()`, and `finally` cannot run until the `catch` RETURNS — while the catch AWAITS the recovery poll
// for up to 90 seconds. So `loading` stayed true for the whole window, `{loading && <LoraWorking/>}` kept
// rendering, and the recovery bubble appended inside that window rendered through LoraTurn WITH ITS OWN
// AVATAR MARK. Deterministic, on every recovered turn, on both surfaces.
//
// ⛔ LEG (c) EXISTS BECAUSE OF ★CHAT-GUARD-CONTAINER-MOUNT-UNASSERTED: three of the four existing chat
// guards verify the ENGINE and the SHARED COMPONENT and never assert that a CONTAINER still mounts them,
// so deleting `<LoraWorking>` from a surface left every one of them green.
import { readFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = process.env.LORAMER_GUARD_ROOT || resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const read = (p) => { try { return readFileSync(resolve(ROOT, p), 'utf8') } catch { return '' } }
const findings = []

const HOOK = 'src/lib/next/use-lora-chat.ts'
const SHARED = 'src/components/redesign/LoraWorking.tsx'
const SHARED_CSS = 'src/components/redesign/lora-working.module.css'
// ⛔ THE CONTAINERS ARE NAMED HERE AND THIS LIST IS THE POINT OF LEG (c). dashboard/page.tsx is
// DELIBERATELY ABSENT: it is the legacy REVIEWER surface, it renders its own markdown, and it is out of
// scope by instruction — recorded so its absence reads as a decision rather than an oversight.
const CONTAINERS = [
  'src/components/redesign/ChatLauncher.tsx',
  'src/app/dashboard-next/lora/LoraPageClient.tsx',
]

// Strip line comments so QUOTATION IS NOT ASSERTION — a banked hazard: prose describing the defect must
// never satisfy a check looking for the fix.
const strip = (s) => s.split('\n').filter((l) => !l.trim().startsWith('//')).join('\n')

// ── (a) THE WORKING FLAG MUST BE CLEARED BEFORE THE RECOVERY BUBBLE EXISTS ────────────────────────────
// ⛔ ORDERING IS A TEXT PROPERTY AND COMPARING SOURCE OFFSETS IS THE HONEST WAY TO ASSERT IT. This is a
// React hook: it cannot be driven headlessly without a renderer, and pretending otherwise would be a
// worse proof than a stated one.
{
  const src = strip(read(HOOK))
  const catchAt = src.indexOf('} catch (e) {')
  const finallyAt = src.indexOf('} finally {')
  if (catchAt === -1 || finallyAt === -1 || finallyAt < catchAt) {
    findings.push(`(a) ${HOOK}: could not locate the catch/finally pair in send() — this guard is pointed at the wrong file or the failure path was restructured. It must be re-verified by hand, not assumed green.`)
  } else {
    const block = src.slice(catchAt, finallyAt)
    const clearAt = block.indexOf('setLoading(false)')
    const bubbleAt = block.indexOf('COPY.CHECKING')
    if (bubbleAt === -1) {
      findings.push(`(a) ${HOOK}: the catch block no longer appends COPY.CHECKING — the recovery bubble is the thing this leg orders against, so its absence makes the check vacuous.`)
    } else if (clearAt === -1) {
      findings.push(`(a) ${HOOK}: the catch block appends the recovery bubble and NEVER clears \`loading\`. \`finally\` cannot run until this block returns, and it awaits the recovery poll for up to 90s — so the generic <LoraWorking> indicator renders ALONGSIDE the recovery bubble for that whole window. TWO working indicators, one turn.`)
    } else if (clearAt > bubbleAt) {
      findings.push(`(a) ${HOOK}: \`setLoading(false)\` appears AFTER the recovery bubble is appended (offsets ${clearAt} vs ${bubbleAt}). It must come FIRST — the recovery bubble IS the working indicator from that moment, so the generic one has to stand down before it appears, not after.`)
    }
  }
}

// ── (b) ONE MARK, ONE SIZE ────────────────────────────────────────────────────────────────────────────
// Two different sizes in one view is what the device report described. The mark is BOTH the working
// indicator and Lora's avatar (★LM-MARK-LIVE), so a size that differs by state also makes the avatar
// inconsistent turn to turn.
{
  const shared = strip(read(SHARED))
  const sizes = new Set()
  for (const m of shared.matchAll(/<LmMark\b([^/>]*)\/?>/g)) {
    const sizeProp = /size=\{?\s*(\d+)/.exec(m[1] || '')
    sizes.add(sizeProp ? sizeProp[1] : 'default')
  }
  if (sizes.size === 0) {
    findings.push(`(b) ${SHARED}: no <LmMark> mount found at all — the mark is the working indicator AND the avatar; losing it loses both.`)
  } else if (sizes.size > 1) {
    findings.push(`(b) ${SHARED}: <LmMark> is mounted at MORE THAN ONE size (${[...sizes].join(', ')}). The mark is one size everywhere it appears — the working state and the avatar are the same element in the same place, and a size that changes with state makes them read as two different things.`)
  }
  // The CSS must not reintroduce by stylesheet what the prop keeps uniform.
  const css = SHARED_CSS ? read(SHARED_CSS) : ''
  const cssNoComments = css.replace(/\/\*[\s\S]*?\*\//g, '')
  if (/\.lmMarkWorking\s*\{[^}]*(width|height|transform\s*:\s*scale)/.test(cssNoComments)) {
    findings.push(`(b) ${SHARED_CSS}: .lmMarkWorking sets width/height/scale, so the WORKING mark is a different size from the idle avatar. The animation may change how the mark is DRAWN; it may not change how big it is.`)
  }
}

// ── (c) EVERY CONTAINER STILL MOUNTS THE SHARED COMPONENT ─────────────────────────────────────────────
// ⛔ ★CHAT-GUARD-CONTAINER-MOUNT-UNASSERTED. A shared component proves nothing if a surface stopped
// rendering it — which is exactly how the phone showed a plain italic line for weeks while a green guard
// asserted the mark was mounted.
// ⛔ DELEGATION IS SATISFACTION — BUT ONLY BECAUSE THE DELEGATE IS ITSELF ASSERTED (LORAMER_CHAT_
// SHARED_THREAD_V1). The containers no longer draw a turn: they mount <LoraThread>, which draws it for
// both. Asserting the mark against the containers would now be asserting the WRONG FILE, and a guard
// pointed at the wrong file is the failure this whole leg exists to catch, not a stricter version of it.
// So a container satisfies these checks by mounting <LoraThread>, and LoraThread must satisfy them
// DIRECTLY — it is checked here too, in the same pass, so the property is still proven end to end.
// ⛔ AND THE CONTAINMENT HALF IS RED-PROVED ELSEWHERE: lora-thread-shared.guard.mjs fails when either
// container's mount is deleted, so "delegates" can never become a way to opt out of the property.
const SHARED_SURFACE = 'src/components/redesign/LoraThread.tsx'
for (const f of [...CONTAINERS, SHARED_SURFACE]) {
  const src = strip(read(f))
  if (!src) { findings.push(`(c) ${f} is missing or unreadable — a file this guard is required to cover cannot be checked.`); continue }
  const delegates = f !== SHARED_SURFACE && /<LoraThread\b/.test(src)
  const working = delegates ? 1 : [...src.matchAll(/<LoraWorking\b/g)].length
  const turn = delegates ? 1 : [...src.matchAll(/<LoraTurn\b/g)].length
  if (working === 0) {
    findings.push(`(c) ${f} does not mount <LoraWorking>. The shared status component exists and this surface does not render it — the defect class that left the phone with a plain italic line and no mark while every guard stayed green.`)
  } else if (working > 1) {
    findings.push(`(c) ${f} mounts <LoraWorking> ${working} times. One working indicator per turn means one mount per surface.`)
  }
  if (turn === 0) {
    findings.push(`(c) ${f} does not mount <LoraTurn>, so assistant turns render with no avatar mark and the working state and the answer no longer occupy the same position — which is what makes the answer land without a jump.`)
  }
  // The indicator must be CONDITIONAL on loading, or it is not an indicator.
  if (!delegates && working > 0 && !/\{loading && \(/.test(src) && !/loading &&[\s\S]{0,200}<LoraWorking/.test(src)) {
    findings.push(`(c) ${f} renders <LoraWorking> without a \`loading &&\` guard — an indicator that is always on says nothing.`)
  }
}

const label = 'LORAMER_ONE_WORKING_INDICATOR_PER_TURN_V1'
if (findings.length) {
  console.error(`[one-working-indicator] FAIL — ${findings.length} finding(s):`)
  for (const f of findings) console.error(`  · ${f}`)
  process.exit(1)
}
console.log(`[one-working-indicator] PASS — the working flag clears before the recovery bubble exists, the LM mark is one size, and both -next containers mount LoraWorking + LoraTurn. ${label}`)
