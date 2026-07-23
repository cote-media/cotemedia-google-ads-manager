// LORAMER_NEXT_META_ACCOUNT_SORT_V1 — DISPLAY-ORDER ONLY sort for the -next "Choose a Meta ad account" picker
// (src/components/redesign/ClientPage.tsx). Pure, no data mutation: it sorts a COPY and returns it. Extracted to
// its own module so the ordering has ONE source and is unit-testable (Gate-A imports THIS function, not a copy).
//
// TWO GROUPS ON PURPOSE — do NOT "simplify" this to a single localeCompare. Some Meta ad accounts have no real
// name, so the picker displays the account NUMBER instead (e.g. 12909870, 55917252). A naive alphabetical/locale
// sort orders digits before letters, so those numeric-named accounts FLOAT TO THE TOP — worse than leaving the
// list unsorted. So: accounts WITH a real name sort A→Z (case-insensitive) FIRST; accounts whose displayed name is
// just the numeric id go in a SECOND group BELOW, ordered by id ascending.
export type MetaAccountLike = { id: string; name: string }

const bareId = (a: MetaAccountLike) => a.id.replace(/^act_/, '')
const displayName = (a: MetaAccountLike) => (a.name || '').trim()

// "numeric-only name" = the picker would show a bare number: name absent/blank, OR equal to the id (with or
// without the "act_" prefix), OR all digits.
export function isNumericOnlyName(a: MetaAccountLike): boolean {
  const n = displayName(a)
  if (!n) return true
  return n === a.id || n === bareId(a) || /^\d+$/.test(n)
}

// Exact numeric-string compare — Meta account ids reach 16 digits (> 2^53), so Number() would lose precision and
// could misorder two near-equal ids. Shorter number first, then lexicographic (valid for non-negative integers).
const cmpNumericStr = (x: string, y: string) => x.length - y.length || (x < y ? -1 : x > y ? 1 : 0)

export function sortMetaAccounts<T extends MetaAccountLike>(list: T[]): T[] {
  return [...list].sort((a, b) => {
    const na = isNumericOnlyName(a), nb = isNumericOnlyName(b)
    if (na !== nb) return na ? 1 : -1                                                 // named group first, numeric last
    if (na) return cmpNumericStr(bareId(a), bareId(b))                                // numeric group: id ascending
    return displayName(a).localeCompare(displayName(b), undefined, { sensitivity: 'base' }) // named: A→Z, case-insensitive
  })
}
