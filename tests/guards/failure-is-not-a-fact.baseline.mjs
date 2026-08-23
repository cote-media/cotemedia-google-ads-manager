// LORAMER_FAILURE_IS_NOT_A_FACT_V1 — the error-discarding-read baseline. SHRINK-ONLY.
//
// ⛔ DATA, NOT A MUTE. The number may FALL freely and may NEVER RISE. A rise means a new supabase read in
// src/lib/next/ or src/app/api/next/ throws its `error` away — and a discarded error becomes `data: null`
// becomes a confident NO, which is the entire defect class this guard exists for.
//
// ⛔ THE FIX FOR A RISE IS NEVER TO RAISE THIS NUMBER. It is to destructure `error` on the new read and
// return an explicit unknown. Lower it here in the same commit that earns the gain, or the ratchet does not
// hold — same posture as queue-tag-matches-text.baseline.mjs.
//
// MEASURED 2026-08-23 by the guard itself, BEFORE the fix, and named so the burn-down is auditable:
//   src/app/api/next/client-metrics/route.ts:99   ever()            → "not connected" on the Overview
//   src/app/api/next/money/route.ts:28            latestMoneyDate() → a money window silently reads absent
//   src/lib/next/roas-bases.ts:55                 ever()            → "Meta not connected" as an absentReason
//   src/lib/next/shell-client.ts:44               client list       → "No clients yet" for a user who has clients
//   src/lib/next/query-completeness.ts:137        readHealthForClients → every client reads as no-health-row
//   src/lib/next/store-detect.ts:16               latestStoreDate() → the client's store resolves to none
export const ERROR_DESTRUCTURE_BASELINE = 0
