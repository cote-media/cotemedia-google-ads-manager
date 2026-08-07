// LORAMER_CHAT_IN_FLIGHT_SURVIVES_REMOUNT_V1 — a turn in flight is a fact that must outlive the mount.
//
// ⛔ THE TWO TAILS THIS CLOSES, AND THEY ARE THE SAME DEFECT SEEN FROM TWO SIDES.
//   TAIL A (2026-08-07, Russ's device): he sent a turn, backgrounded the tab, came back. His MESSAGE
//     was there — LORAMER_CHAT_MERGE_NOT_REPLACE_V1 did its job — but THE WORKING INDICATOR WAS GONE
//     while the server was still generating. The screen looked idle while a paid turn was in flight.
//   TAIL B (2026-08-06 22:03, Foam OH): the page was open and visible the whole time. The mount read
//     landed at 22:03:36, the answer was written at 22:03:46.570, and NO TRIGGER EVER FIRED AGAIN.
//   Both are the same hole: `loading` and `streamStatus` are component state, and the fetch, the
//   AbortController and the recovery loop all live inside `send()`'s closure. **A REMOUNT KILLS EVERY
//   ONE OF THEM, AND THE REFRESH TRIGGERS (visibilitychange · focus · once on mount) CANNOT HELP —
//   there is no timer, no poll, and no subscription anywhere in the hook.**
//
// ⚠ WHAT IS NOT LOST, AND IT IS WHY THIS FIX IS SMALL: the ANSWER is durable. `/api/chat` writes the
// assistant turn SERVER-SIDE from inside its own stream-close path (LORAMER_CHAT_SERVER_TURN_WRITE_V1),
// so the row lands whether or not the browser survived. The only thing the client loses is the KNOWLEDGE
// THAT IT SHOULD KEEP LOOKING. That knowledge is all this module stores.
//
// ⛔ sessionStorage, NOT localStorage, AND THE CHOICE IS THE CLIENT-SCOPING LAW ONE LEVEL UP.
// localStorage is shared across every tab of the origin, so a turn in flight for client A in one tab
// would light the working indicator on client B's thread in another — the same data-attribution failure
// `mergeThreadForClient` exists to prevent. sessionStorage is per-tab, which is exactly the scope of
// "this document had a turn in flight". Backgrounding and returning is the SAME tab, so it survives the
// eviction/reload cycle that causes the defect; closing the tab correctly forgets.
import { RECOVERY_WINDOW_MS } from '@/lib/next/chat-recovery'

const KEY = 'loramer:lora-in-flight'

export type InFlightTurn = {
  clientId: string
  // The thread watermark at the moment the turn started — `pickRecoveredAnswer`'s discriminator. Any row
  // above it is new since we asked. Null when the thread was empty, which is a real and common case.
  sinceId: number | null
  startedAt: number
}

export function markTurnInFlight(t: InFlightTurn): void {
  try { sessionStorage.setItem(KEY, JSON.stringify(t)) } catch { /* private mode / quota — never throw into a turn */ }
}

export function clearTurnInFlight(): void {
  try { sessionStorage.removeItem(KEY) } catch { /* same */ }
}

/**
 * The record, but ONLY if it is still ours and still live.
 *
 * ⛔ THREE REFUSALS, AND EACH ONE IS A BUG THIS WOULD OTHERWISE SHIP:
 *   1. CLIENT MISMATCH → null. A turn in flight for client A must never render as working on client B's
 *      thread. Same law as `mergeThreadForClient`, enforced at the read rather than trusted at the write.
 *   2. PAST THE WINDOW → null. The bound is RECOVERY_WINDOW_MS, which equals `/api/chat`'s `maxDuration`
 *      of 500s — the real ceiling on when a late answer can still land. A record older than that
 *      describes a turn the server has already given up on, and resuming it would spin a poll forever
 *      against an answer that is never coming.
 *   3. MALFORMED / ABSENT → null, silently. A parse failure must never throw into a mount.
 */
export function readTurnInFlight(clientId: string, now: number): InFlightTurn | null {
  try {
    const raw = sessionStorage.getItem(KEY)
    if (!raw) return null
    const t = JSON.parse(raw) as Partial<InFlightTurn>
    if (!t || typeof t.clientId !== 'string' || typeof t.startedAt !== 'number') return null
    if (t.clientId !== clientId) return null
    if (now - t.startedAt > RECOVERY_WINDOW_MS) return null
    const sinceId = typeof t.sinceId === 'number' ? t.sinceId : null
    return { clientId: t.clientId, sinceId, startedAt: t.startedAt }
  } catch { return null }
}

/** Milliseconds of the turn's window still ahead of it. Never negative. */
export function remainingWindowMs(t: InFlightTurn, now: number): number {
  return Math.max(0, t.startedAt + RECOVERY_WINDOW_MS - now)
}
