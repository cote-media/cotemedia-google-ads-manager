#!/usr/bin/env node
// LORAMER_CHAT_SHARED_THREAD_V1 — BOTH CONTAINERS MOUNT THE SHARED SURFACE, AND NEITHER KEEPS ITS OWN.
//
// ⛔ WHAT THIS PROTECTS, and it is the defect class this repo has paid for twice. `useLoraChat`
// extracted the CONVERSATION and left the SURFACE behind, so every status-line and LM-mark change of
// 2026-08-02 landed on the desktop shelf only and the PHONE — the only device Gate-B actually runs on —
// showed a plain italic line and no mark, WHILE A GREEN GUARD ASSERTED THE MARK WAS MOUNTED. The mark
// was mounted; it was mounted in the file the guard was reading. Three of the four chat guards verify
// the ENGINE and the SHARED COMPONENT and never assert that a CONTAINER still renders them
// (★CHAT-GUARD-CONTAINER-MOUNT-UNASSERTED). This one does.
//
// ⛔ AND IT GUARDS THE OTHER DIRECTION TOO: a container that re-grows its own scroll handling silently
// un-does the unification. The shelf's single unconditional `scrollTop = scrollHeight` is exactly how
// it drifted the first time, and it is one careless line from coming back.
import { readFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = process.env.LORAMER_GUARD_ROOT || resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const read = (p) => { try { return readFileSync(resolve(ROOT, p), 'utf8') } catch { return '' } }
const findings = []

// ⛔ dashboard/page.tsx IS DELIBERATELY ABSENT. It is the legacy REVIEWER surface (demo@,
// shopify-reviewer@) with its own markdown rendering, it is out of scope by standing instruction while
// Shopify review is open, and its absence is recorded here so it reads as a decision, not an oversight.
const CONTAINERS = [
  'src/components/redesign/ChatLauncher.tsx',
  'src/app/dashboard-next/lora/LoraPageClient.tsx',
]
const SHARED = 'src/components/redesign/LoraThread.tsx'
const HOOK = 'src/lib/next/use-stick-to-bottom.ts'
const SHARED_CSS = 'src/components/redesign/lora-thread.module.css'

// QUOTATION IS NOT ASSERTION — both containers now carry PROSE describing the scroll code that was
// removed, and a guard that read the comment as the code would report the defect it exists to prevent.
const strip = (s) => s.split('\n').filter((l) => !l.trim().startsWith('//')).join('\n')

// ── (a) THE SHARED FILES EXIST ────────────────────────────────────────────────────────────────────
for (const [f, what] of [[SHARED, 'the shared thread component'], [HOOK, 'the shared scroll machine'], [SHARED_CSS, 'the shared stylesheet']]) {
  if (!read(f)) findings.push(`(a) ${f} is missing — ${what} does not exist, so "one component, two containers" is a claim with nothing behind it.`)
}

// ── (b) EVERY CONTAINER MOUNTS IT ─────────────────────────────────────────────────────────────────
for (const f of CONTAINERS) {
  const src = strip(read(f))
  if (!src) { findings.push(`(b) ${f} is missing or unreadable — a container this guard must cover cannot be checked.`); continue }
  const mounts = [...src.matchAll(/<LoraThread\b/g)].length
  if (mounts === 0) {
    findings.push(`(b) ${f} does not mount <LoraThread>. The shared surface exists and this container does not render it — the exact shape of the defect that left the phone with a plain italic line and no mark while every guard stayed green.`)
  } else if (mounts > 1) {
    findings.push(`(b) ${f} mounts <LoraThread> ${mounts} times. One surface per container.`)
  }
  if (!/variant=["'](panel|page)["']/.test(src)) {
    findings.push(`(b) ${f} mounts <LoraThread> without a literal variant="panel" or "page". The variant decides WHO SCROLLS — the panel's own region or the document — and getting it wrong silently gives a surface the other one's scroller.`)
  }
}

// ── (c) NO CONTAINER KEEPS ITS OWN SCROLL HANDLING ────────────────────────────────────────────────
// The shelf's `scrollTop = scrollHeight` is the specific regression; the rest are the machinery that
// belongs to useStickToBottom and nowhere else.
const SCROLL_SMELLS = [
  [/\.scrollTop\s*=/, '`scrollTop =` — a direct scroll write'],
  [/scrollIntoView\s*\(/, 'scrollIntoView()'],
  [/new ResizeObserver\s*\(/, 'a ResizeObserver (the re-glue-on-growth machinery)'],
  [/history\.scrollRestoration/, 'history.scrollRestoration'],
  [/window\.scrollTo\s*\(/, 'window.scrollTo()'],
]
for (const f of CONTAINERS) {
  const src = strip(read(f))
  if (!src) continue
  for (const [re, what] of SCROLL_SMELLS) {
    if (re.test(src)) {
      findings.push(`(c) ${f} contains ${what}. Scroll behaviour belongs to useStickToBottom, shared by both surfaces. A container growing its own is how the shelf ended up yanking the user back down on every message while the page did not.`)
    }
  }
}

// ── (d) THE SHARED COMPONENT DEPENDS ON SHELL FOR NOTHING ─────────────────────────────────────────
// The page renders OUTSIDE <Shell> and the shelf is PORTALED out of `.root`. Both severances have
// already cost a defect: the CSS custom properties (an invisible send button) and the Tabler icon
// webfont (a 0x0 invisible back button). Icons must be inline SVG and colours must carry fallbacks.
{
  const src = read(SHARED)
  if (src) {
    if (/className=["'][^"']*\bti\s+ti-/.test(src)) {
      findings.push(`(d) ${SHARED} uses the Tabler icon webfont (\`ti ti-…\`). That font is linked ONLY from Shell.tsx, and the phone page renders WITHOUT Shell — the glyph silently does not exist, leaving an element that is in the DOM, in bounds and invisible. Use inline SVG.`)
    }
    if (!/<svg\b/.test(src)) {
      findings.push(`(d) ${SHARED} contains no inline SVG — it has no self-contained icons, so whatever it draws depends on something handed down.`)
    }
  }
  const css = read(SHARED_CSS)
  if (css) {
    // Every var() must carry a literal fallback: a severed token scope must degrade to today's value,
    // never to nothing.
    const bare = [...css.replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/var\(\s*(--[a-z-]+)\s*\)/g)].map((m) => m[1])
    if (bare.length) {
      findings.push(`(d) ${SHARED_CSS} uses var(${bare.join('), var(')}) with NO fallback. Both surfaces sever custom-property inheritance — the page renders outside Shell and the shelf is portaled out of \`.root\` — and a bare var() in that state resolves to nothing. That is how the send button became a white glyph in a transparent circle on a white bar.`)
    }
  }
}

const label = 'LORAMER_CHAT_SHARED_THREAD_V1'
if (findings.length) {
  console.error(`[lora-thread-shared] FAIL — ${findings.length} finding(s):`)
  for (const f of findings) console.error(`  · ${f}`)
  process.exit(1)
}
console.log(`[lora-thread-shared] PASS — both -next containers mount <LoraThread> with an explicit variant, neither keeps its own scroll handling, and the shared surface depends on Shell for nothing. ${label}`)
