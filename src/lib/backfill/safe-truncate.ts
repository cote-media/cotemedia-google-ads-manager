// LORAMER_META_ASSET_CODEPOINT_TRUNCATION_V1 — cap external text WITHOUT splitting a surrogate pair.
//
// THE DEFECT (confirmed live 2026-07-29): meta-asset-backfill.ts capped breakdown_value with
// `.slice(0, VALUE_CAP)`. JS strings are UTF-16, so .slice() cuts by CODE UNIT, not codepoint. Foam OH's
// body_asset for campaign/2024-11-01 is 307 chars ending "…🟠🟡🟢"; the cut at index 299 landed INSIDE
// U+1F7E2 (surrogate pair D83D DFE2), keeping the lone high surrogate D83D. JS is lenient and passes it
// through JSON.stringify unharmed; the UTF-8 encoding on the wire turns it into EF BF BD and Postgres
// rejects the whole statement with "invalid input syntax for type json".
//
// ⛔ THE CORRUPTION WAS OURS, NOT META'S. The raw values from the API are clean — I scanned all 53 rows for
// NUL, lone surrogates and control chars and found none. We created the invalid sequence at truncation.
//
// THE RULE, which outlives this writer: ANY CAP APPLIED TO EXTERNAL TEXT MUST CUT BY CODEPOINT. `.slice()`
// on a JS string splits surrogate pairs silently — no exception, no warning, and the damage only surfaces at
// a boundary that validates UTF-8. Emoji in ad copy is not an edge case; it is normal marketing text.
export type CappedText = { value: string; truncated: boolean; sanitised: boolean }

// Lone-surrogate strip: belt-and-braces for anything that survives the codepoint slice (e.g. text that
// ALREADY contained an unpaired surrogate before we touched it).
function stripLoneSurrogates(s: string): { out: string; stripped: boolean } {
  let out = '', stripped = false
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i)
    if (c >= 0xd800 && c <= 0xdbff) {
      const n = s.charCodeAt(i + 1)
      if (n >= 0xdc00 && n <= 0xdfff) { out += s[i] + s[i + 1]; i++ } else { stripped = true }
    } else if (c >= 0xdc00 && c <= 0xdfff) { stripped = true } else { out += s[i] }
  }
  return { out, stripped }
}

export function capText(input: string, cap: number): CappedText {
  const cps = [...input]                    // iterating a string yields CODEPOINTS, never half a pair
  const truncated = cps.length > cap
  const cut = truncated ? cps.slice(0, cap).join('') : input
  const { out, stripped } = stripLoneSurrogates(cut)
  return { value: out, truncated, sanitised: stripped }
}
