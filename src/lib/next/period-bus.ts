// LORAMER_NEXT_CHAT_POLISH_V1 — tiny CLIENT-ONLY bus so the Ask-Lora chat's ambient window follows the CardEngine's
// shared date picker (they live in separate component trees — Shell vs the page — so lifting state is awkward).
// CardEngine calls setSharedPeriod() on picker change + mount; ChatLauncher reads getSharedPeriod() when it opens and
// subscribes to the 'loramer:period' event for live updates. -next only; no backend, no SSR dependency (guards window).
export type SharedPeriod = { dateRange: string; customStart?: string; customEnd?: string }

let current: SharedPeriod = { dateRange: 'LAST_30_DAYS' }

export function setSharedPeriod(p: SharedPeriod): void {
  current = p
  if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent('loramer:period', { detail: p }))
}

export function getSharedPeriod(): SharedPeriod {
  return current
}
