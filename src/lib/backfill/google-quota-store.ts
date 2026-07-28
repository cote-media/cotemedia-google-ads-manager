// LORAMER_GOOGLE_QUOTA_GUARD_V1 — DB read/write of the GLOBAL google-quota pause marker.
// Reuses the EXISTING sync_state circuit-breaker columns (migration 013: backfill_blocked /
// backfill_block_window / backfill_block_reason / backfill_block_at) on a SINGLE global sentinel row —
// NO schema change, no new table, no migration. One strike = immediate pause (unlike Woo's 2-strike
// breaker); auto-resume is clock-based (window elapsed → reads as not paused; no manual unblock).
import { supabaseAdmin } from '@/lib/supabase'
import { GOOGLE_QUOTA_SENTINEL_CLIENT, GOOGLE_QUOTA_PLATFORM } from './google-quota'

// READ the global pause. Clock-based auto-resume: an elapsed window reads as NOT paused.
// LORAMER_GOOGLE_QUOTA_LORA_CAVEAT_V1 — `since` (backfill_block_at) added so Lora can state WHEN the quota
// went out, not just that it is out. Purely additive: every existing caller reads .paused / .until / .reason
// and is unaffected. The paused/until/reason semantics are untouched.
export async function readGoogleQuotaPause(): Promise<{ paused: boolean; until: string | null; since: string | null; reason: string | null }> {
  const { data } = await supabaseAdmin
    .from('sync_state')
    .select('backfill_blocked, backfill_block_window, backfill_block_reason, backfill_block_at')
    .eq('client_id', GOOGLE_QUOTA_SENTINEL_CLIENT)
    .eq('platform', GOOGLE_QUOTA_PLATFORM)
    .maybeSingle()
  const until = ((data?.backfill_block_window as string) ?? null) || null
  const reason = ((data?.backfill_block_reason as string) ?? null) || null
  const since = ((data?.backfill_block_at as string) ?? null) || null
  if (!data?.backfill_blocked) return { paused: false, until, since, reason }
  if (until && Date.now() >= new Date(until).getTime()) return { paused: false, until, since, reason } // window elapsed → resumed
  return { paused: true, until, since, reason }
}

// WRITE the global pause. block_window carries the reset ISO the quota error reported.
export async function writeGoogleQuotaPause(resetIso: string, detail: string): Promise<void> {
  const nowIso = new Date().toISOString()
  await supabaseAdmin.from('sync_state').upsert(
    {
      client_id: GOOGLE_QUOTA_SENTINEL_CLIENT,
      platform: GOOGLE_QUOTA_PLATFORM,
      backfill_blocked: true,
      backfill_block_window: resetIso,
      backfill_block_reason: ('google_quota: ' + detail).slice(0, 500),
      backfill_block_at: nowIso,
      updated_at: nowIso,
    },
    { onConflict: 'client_id,platform' }
  )
}
