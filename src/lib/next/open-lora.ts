// LORAMER_LORA_PAGE_V1 — ONE trigger helper for every Lora entry point.
//
// WHY ONE: there are five triggers (the Ask-Lora pill, the mobile nav Lora tab, the desktop rail
// button, the rail content item, and a drill row's ✦). Branching mobile-vs-desktop in five places is
// how they drift — the same reasoning that put the Meta breadth dims behind ONE shared list.
//
// THE BRANCH: on mobile Lora is its own PAGE (six overlay attempts died on the iOS keyboard;
// LORAMER_LORA_PAGE_PROBE_V1 validated a real document). On desktop the right-docked shelf is
// unchanged and still opens via the existing event — desktop was never broken and is not being fixed.
//
// The breakpoint is the SAME 767px the CSS uses. If they ever disagree, a device gets a page with
// shelf styling or vice versa, so they are pinned to one number here.
export const LORA_MOBILE_QUERY = '(max-width: 767px)'
export const LORA_PAGE_PATH = '/dashboard-next/lora'

export type OpenLoraDetail = { rowContext?: string; prompt?: string }

export function isLoraMobile(): boolean {
  try { return window.matchMedia(LORA_MOBILE_QUERY).matches } catch { return false }
}

// Build the page URL. clientId keeps the page on the same client the user was looking at;
// rowContext/prompt carry the drill-row focus that the event used to pass in its detail, so the ✦
// behaves the same on both surfaces.
export function loraPageHref(clientId?: string, detail?: OpenLoraDetail): string {
  const p = new URLSearchParams()
  if (clientId) p.set('clientId', clientId)
  if (detail?.rowContext) p.set('rowContext', detail.rowContext)
  if (detail?.prompt) p.set('prompt', detail.prompt)
  const q = p.toString()
  return q ? `${LORA_PAGE_PATH}?${q}` : LORA_PAGE_PATH
}

// THE ONE ENTRY POINT every trigger calls.
// `push` is injected (the caller's router.push) so this stays a pure module — no next/navigation
// import, no hook rules, and it is directly unit-testable.
export function openLora(push: (href: string) => void, clientId?: string, detail?: OpenLoraDetail): void {
  if (isLoraMobile()) { push(loraPageHref(clientId, detail)); return }
  // Desktop: unchanged. The mounted ChatLauncher listens for this exact event.
  try {
    window.dispatchEvent(detail ? new CustomEvent('loramer:open-chat', { detail }) : new Event('loramer:open-chat'))
  } catch { /* never throw out of a trigger */ }
}
