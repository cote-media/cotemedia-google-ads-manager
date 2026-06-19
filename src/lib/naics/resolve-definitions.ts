import 'server-only'
// LORAMER_NAICS_V1 — SERVER-ONLY. Resolves a client's selected NAICS 2022 codes to a prompt block carrying
// each code's OFFICIAL Census definition (read verbatim by Lora). This is the ONLY module that imports the
// 763KB naics-definitions.json, so that data can never reach a client bundle ('server-only' throws if it does).
import definitions from './naics-definitions.json'

type NaicsSelection = { code: string; title: string }

const DEFS = definitions as Record<string, string>

// codes → formatted prompt block, e.g.:
//   Industry classification (NAICS 2022):
//     - 561710 Exterminating and Pest Control Services: <official definition>
// A code with no definition falls back to title only. Empty/null/all-invalid → "" (inject nothing).
export function resolveNaicsBlock(codes: NaicsSelection[] | null | undefined): string {
  if (!Array.isArray(codes) || codes.length === 0) return ''
  const lines: string[] = ['Industry classification (NAICS 2022):']
  for (const c of codes) {
    if (!c || typeof c.code !== 'string') continue
    const code = c.code.trim()
    if (!code) continue
    const title = (typeof c.title === 'string' ? c.title : '').trim()
    const def = DEFS[code]
    lines.push(def ? `  - ${code} ${title}: ${def}` : `  - ${code} ${title}`)
  }
  return lines.length > 1 ? lines.join('\n') : ''
}
