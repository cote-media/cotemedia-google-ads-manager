// LORAMER_NAICS_V1 — one-off, reusable builder for the bundled NAICS 2022 dictionary.
//
// Downloads the official US Census NAICS 2022 sources into a gitignored scratch dir (.naics-tmp/),
// parses them with SheetJS, and writes two committed JSON artifacts:
//   • src/lib/naics/naics-index.json        → [{ code, title }]  for ALL 2–6 digit codes (+ the 3 sector
//     ranges 31-33 / 44-45 / 48-49). Slim; for client-side search later.
//   • src/lib/naics/naics-definitions.json  → { code: "<official definition>" } for every level the source
//     provides cleanly (2–6 digit). SERVER-ONLY later — never import into a client component.
//
// Sources (2022 vintage, current through 2027):
//   index titles + codes : 2022_NAICS_Structure.xlsx   (cols: Change Indicator | Code | Title; header row 3)
//   definitions          : 2022_NAICS_Descriptions.xlsx (cols: Code | Title | Description; header row 1)
//
// Run: node scripts/build-naics.mjs   (re-downloads only if the scratch files are missing)
import xlsx from 'xlsx'
import { mkdirSync, existsSync, writeFileSync } from 'fs'
import { writeFile } from 'fs/promises'

const TMP = '.naics-tmp'
const OUT = 'src/lib/naics'
const SOURCES = {
  structure: { url: 'https://www.census.gov/naics/2022NAICS/2022_NAICS_Structure.xlsx', file: `${TMP}/2022_NAICS_Structure.xlsx` },
  descriptions: { url: 'https://www.census.gov/naics/2022NAICS/2022_NAICS_Descriptions.xlsx', file: `${TMP}/2022_NAICS_Descriptions.xlsx` },
}

mkdirSync(TMP, { recursive: true })
mkdirSync(OUT, { recursive: true })

async function ensure(src) {
  if (existsSync(src.file)) return
  console.log('downloading', src.url)
  const res = await fetch(src.url)
  if (!res.ok) throw new Error(`download failed ${res.status} for ${src.url}`)
  await writeFile(src.file, Buffer.from(await res.arrayBuffer()))
}

// "Agriculture, Forestry, Fishing and HuntingT" -> "Agriculture, Forestry, Fishing and Hunting"
// The trailing "T" is the documented trilateral-agreement marker (see the Structure legend); strip it.
function cleanTitle(raw) {
  let t = String(raw == null ? '' : raw).replace(/\s+/g, ' ').trim()
  if (/[a-z)]\)?T$/.test(t)) t = t.replace(/T$/, '').trim() // marker attaches after a real (lowercase/")") word
  return t
}
function cleanDef(raw) {
  return String(raw == null ? '' : raw).replace(/\r\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim()
}

const main = async () => {
  await ensure(SOURCES.structure)
  await ensure(SOURCES.descriptions)

  // ── INDEX from Structure (header at row index 2 → data from row 3; cols [1]=code, [2]=title) ──
  const sw = xlsx.readFile(SOURCES.structure.file)
  const srows = xlsx.utils.sheet_to_json(sw.Sheets[sw.SheetNames[0]], { header: 1, raw: false })
  const index = []
  const seen = new Set()
  for (const r of srows.slice(3)) {
    if (!r || r[1] == null) continue
    const code = String(r[1]).trim()
    if (!code || seen.has(code)) continue
    const title = cleanTitle(r[2])
    if (!title) continue
    seen.add(code)
    index.push({ code, title })
  }

  // ── DEFINITIONS from Descriptions (header row 0 → data from row 1; cols Code|Title|Description) ──
  const dw = xlsx.readFile(SOURCES.descriptions.file)
  const drows = xlsx.utils.sheet_to_json(dw.Sheets[dw.SheetNames[0]], { header: 1, raw: false })
  const definitions = {}
  for (const r of drows.slice(1)) {
    if (!r || r[0] == null) continue
    const code = String(r[0]).trim()
    const def = cleanDef(r[2])
    if (code && def) definitions[code] = def
  }

  writeFileSync(`${OUT}/naics-index.json`, JSON.stringify(index, null, 0) + '\n')
  writeFileSync(`${OUT}/naics-definitions.json`, JSON.stringify(definitions, null, 0) + '\n')

  // ── Stats ──
  const dist = {}
  for (const e of index) { const L = e.code.includes('-') ? 'range' : String(e.code.length); dist[L] = (dist[L] || 0) + 1 }
  console.log('INDEX entries:', index.length, 'by length:', JSON.stringify(dist))
  console.log('DEFINITIONS entries:', Object.keys(definitions).length)
  for (const code of ['561710', '722511', '541110']) {
    const t = index.find(e => e.code === code)
    console.log(`\n[${code}] title:`, t ? t.title : '(missing)')
    console.log(`[${code}] def:`, (definitions[code] || '(missing)').slice(0, 200))
  }
}

main().catch(e => { console.error(e); process.exit(1) })
