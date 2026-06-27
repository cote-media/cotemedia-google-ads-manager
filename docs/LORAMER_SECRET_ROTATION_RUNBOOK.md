# CRON_SECRET / Secret Rotation Runbook

GOVERNING RULE (verify behaviorally, never by timestamp or pull):
- A rotation is DONE only when a live 200/401 probe passes. Until that probe is green, the rotation is NOT complete — no matter what the dashboard or a "Done" message says.
- `vercel env ls` last column is "created", NOT updated. An in-place value edit does NOT change it. NEVER infer "prod is stale / rotation didn't land" from the ls timestamp — it is blind to value edits.
- `vercel env pull` BLANKS sensitive vars (Lesson 45) — CRON_SECRET pulls as empty even when set. A blank pull is NOT evidence of a blank prod value. Cannot fingerprint-compare prod via pull.
- Therefore the ONLY ground truth for a secret rotation is the behavioral probe.

SEQUENCE (every CRON_SECRET rotation):
1. Generate on the machine in use: openssl rand -hex 32 → write to .env.local in place (leave all other vars, esp SUPABASE_SERVICE_ROLE_KEY, untouched) + /tmp/cron_new.txt; back up .env.local first. Confirm fingerprint (first4/last4/len) WITHOUT printing the value.
2. Paste the value into Vercel → Settings → Environment Variables → CRON_SECRET (Production) → Save. Then REDEPLOY (Lesson 37 — env binds only on a new deploy; native crons keep working, Vercel injects current value).
3. COMPLETION GATE — behavioral probe (route is GET-only):
   match-good secret → expect 200 ; junk secret → expect 401. Both required. This step is mandatory; skipping it is how a rotation half-finishes (the 2026-06-26 failure).
4. Update EVERY machine's .env.local to the new value (all machines that run local cron/probe/Gate-A). A rotation done on one machine leaves the others stale → they 401 until synced.

FAILURE HISTORY:
- 2026-06-26 (iMac): new secret 983e…c2f1 generated + put on iMac local; marked "done + redeployed" but NO 200 probe was run to confirm prod bound it. Whether it reached prod is unknown/unprovable after the fact (the ls timestamp is created-only and cannot show it). Next session (2026-06-27, Air) the gap surfaced. Lesson: the 200 probe is non-skippable.
- 2026-06-27 (Air): clean rotation to 71ec…cbbe, verified 200/401 live. Prod + Air aligned and proven.
