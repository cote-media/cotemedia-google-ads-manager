// LORAMER_FIRE_CEILING_600_V1 — THE FLEET'S CONCURRENT-FIRE BOUND, IN ONE PLACE.
//
// ⛔ WHAT THIS IS AND WHAT IT IS NOT. `universe_fire_lease` (085) answers "is THIS CLIENT already firing?" and
// is the row-level safety property. This answers a different question — "is the FLEET already at its bound?" —
// and it is a COUNT, not a mutex. At a 600 s ceiling the five-minute rotation starts a second and third fire before
// the first ends, and the rotation picks a different client each time, so nothing else bounds the total.
//
// ⛔ THE REFUSAL IS A HOLD, NOT A FAILURE. A refused fire returns through the same `held` channel a refused
// lease uses, so `continuous-run.ts:187` chains the step without counting it against the no-progress stop
// ("a hold clears on its own; not counted as no progress"). A refusal reported as an ordinary empty step would
// end a customer's run for the crime of the fleet being busy.
//
// ⛔ ROTATION LEAVES ONE SLOT. A named fire (`?clientId=` — the pump, the run route, the button's kickoff) may
// take any free slot; routine rotation passes leaveFree = 1. Migration 107 does the counting and the taking
// under ONE `for update` over the vendor's slots, so two concurrent rotation fires cannot both take the last.
import { supabaseAdmin } from '@/lib/supabase'

export interface FireSlot {
  granted: boolean
  slotNo: number | null
  freeBefore: number | null
  /** Set when the acquire could not be read at all — an unreadable bound holds, it never admits. */
  unreadable: string | null
}

/**
 * Take one of the fleet's fire slots for this vendor, or refuse.
 * @param leaveFree how many slots must remain free AFTER this one is taken (rotation passes ROTATION_SLOT_CEILING's complement: 1)
 */
export async function acquireFireSlot(vendor: string, holder: string, ttlSeconds: number, leaveFree: number): Promise<FireSlot> {
  try {
    const { data, error } = await supabaseAdmin.rpc('universe_fire_slot_acquire', {
      p_vendor: vendor, p_holder: holder, p_ttl_seconds: ttlSeconds, p_leave_free: leaveFree,
    })
    if (error) return { granted: false, slotNo: null, freeBefore: null, unreadable: error.message }
    const row = Array.isArray(data) ? data[0] : data
    return {
      granted: !!row?.granted,
      slotNo: row?.slot_no ?? null,
      freeBefore: typeof row?.free_before === 'number' ? row.free_before : null,
      unreadable: null,
    }
  } catch (e: any) {
    // ⛔ AN UNREADABLE BOUND HOLDS. Same posture as the meter and the lane hold: an instrument that cannot
    // answer must never be read as permission.
    return { granted: false, slotNo: null, freeBefore: null, unreadable: String(e?.message ?? e) }
  }
}

/** Release this holder's slot. Soft-fail: a failed release leaves a row that goes stale after the TTL. */
export async function releaseFireSlot(vendor: string, holder: string): Promise<void> {
  try {
    const { error } = await supabaseAdmin.rpc('universe_fire_slot_release', { p_vendor: vendor, p_holder: holder })
    if (error) console.error(`[fire-slot] release failed for ${holder}: ${error.message} — the slot expires with its TTL`)
  } catch (e: any) {
    console.error(`[fire-slot] release threw for ${holder}: ${String(e?.message ?? e)} — the slot expires with its TTL`)
  }
}
