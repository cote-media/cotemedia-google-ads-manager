// LORAMER_RUN_PUMP_V1 — THE FIRE, CALLED IN-PROCESS. No HTTP anywhere in the run's chain.
//
// ⛔ WHY IN-PROCESS AND NOT A FETCH — measured 2026-09-17 20:32Z, the pump's first live minute. The pump built the
// fire URL from its own request origin; a cron-invoked function's origin is the *.vercel.app deployment URL, and this
// project's Vercel Authentication is `all_except_custom_domains`, so every fire fetch was answered by a 302 to
// vercel.com/sso-api and then an HTML login page: HTTP 200, no JSON, no fire. 159 steps in six minutes read as
// "nothing asked", the run row raced my stop, and not one Google request was spent. A URL is a second way to be
// wrong about which code runs; importing the handler is not.
//
// The resumer's GET is an ordinary exported function (universe-resume/route.ts:119). It is called here with a
// synthetic Request carrying the same `Bearer $CRON_SECRET` the cron sends, so its auth, lease, heartbeat, meter and
// instrument all run exactly as on a scheduled fire. Precedent for a route importing another route's module:
// universe-start/route.ts:19 imports WINDOW_DAYS from the queues route.
//
// ⛔ THE FIRE'S OWN CEILING NO LONGER BOUNDS IT — the pump's does (800 s). The fire's WORK is still bounded by
// FIRE_WORK_BUDGET_MS from its own start (LORAMER_FIRE_DEADLINE_FROM_FIRE_START_V1), so a step cannot outgrow the
// reserve the pump keeps for it.
import { GET as resumeFire } from '@/app/api/cron/universe-resume/route'

export type FireAnswer = { ok: boolean; status: number; body: unknown }

export async function inProcessFire(clientId: string, secret: string): Promise<FireAnswer> {
  // The host is a placeholder: the handler reads only the search params and the authorization header.
  const req = new Request(`https://loramer.internal/api/cron/universe-resume?clientId=${encodeURIComponent(clientId)}&dryRun=0`, {
    headers: { authorization: `Bearer ${secret}` },
  })
  const res = await resumeFire(req)
  const body = await res.json().catch(() => null)
  return { ok: res.ok, status: res.status, body }
}
