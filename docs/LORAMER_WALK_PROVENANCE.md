# LORAMER_WALK_PROVENANCE — the hard-won walk work, indexed so the method is legible
<!-- LORAMER_WALK_PROVENANCE_V1 · created 2026-08-25 on Russ's explicit ruling (NEW-DOC gate overridden by instruction) -->
<!-- QUEUE-EXEMPT: living INDEX of shipped work, not a plan — it proposes nothing unbuilt, so there is no queue item to owe -->

**PURPOSE, on its face:** a plain-English index of the universe walk's hard-won engineering, built so the
METHOD is legible, exportable and potentially salable — and so any of it can be pointed at later without
archaeology. **NOT code comments:** comments scatter and go stale; this points AT the code and survives
refactors. **NOT status:** no entry here says what is running or complete — DECISIONS and the QUEUE own
that. Each entry is: what it does · why it was hard (the defect it kills) · where it lives · proof.

⛔ **LIVING DOC:** every future walk flight appends its entry in the same shape, same commit as the code.

---

## 1. Anchor recedes BY WINDOW, not by range
**What:** a fully-answered 30-day window recedes the surface's anchor ~30 days in one step.
**Why it was hard:** the anchor used to recede by the width of the LAST RANGE WRITTEN — usually one day —
so a walk that was succeeding perfectly was arithmetically incapable of arriving: one day of ground per
pass against 1,427 days to the floor is four years per surface, ×346 surfaces. The rate looked right and
the arrival was impossible; only converting rate → time-to-target exposed it (LORAMER_ADJACENT_NUMBER_V1).
**Where:** `src/lib/backfill/universe-v2-worker.ts` (deriveAnchorEnd + the window-grain advance) ·
detector `tests/guards/anchor-recedes-by-window.guard.mjs` (ships red until proven live).
**Proof:** DECISIONS LORAMER_ADJACENT_NUMBER_V1; the guard's own (C) leg watches for illegal moves.

## 2. Queue transport removed — the inline lease lane
**What:** the walk executes inside the cron invocation under a lease, not through a message queue.
**Why it was hard:** BOTH queue transports decayed to death in the same ~1,000–1,200 attempt band, with
green health the whole way. Diagnosis kept treating symptoms until the transport itself was removed;
+24h endurance then read 8,456 attempts at 7.2× the death band, landing continuously across 27 hours and
ten deployments.
**Where:** `src/app/api/cron/universe-resume/route.ts` + `src/lib/backfill/universe-fire-lease.ts`.
**Proof:** DECISIONS LORAMER_ENDURANCE_24H_READ_V1 · revert path `git revert fdc23ae` (banked).

## 3. The region pin
**What:** the walk's function runs pinned to one region so the lease and the DB sit together.
**Where:** `vercel.json` (functions block, iad1) · the lease's own comments.
**Why it was hard:** cross-region lease races look exactly like transport flakiness — the class above.

## 4. Floor seal + rotation starvation ended
**What:** a surface at its measured floor is SEALED and skipped without consuming a rotation slot; a
non-publishing branch still advances rotation.
**Why it was hard:** floor-reached surfaces sat at the head of rotation consuming every slot — the walk
starved on its own success (the "floor-reached starvation wedge").
**Where:** `21220af` (LORAMER_WALK_FLOOR_SEAL_V1 + LORAMER_NONPUBLISH_ADVANCES_ROTATION_V1) ·
`src/lib/backfill/universe-resumer.ts` / `universe-surface-rotation`.
**Proof:** the commit's own Gate-A; guard `nonpublishing-branch-must-advance-rotation.guard.mjs`.

## 5. Terminal-row guarantee — no exit without a record
**What:** every worker exit writes a terminal attempt row; a lawful early return (quota_stop/floor_stop)
never charges an attempt; one window in, one successor out.
**Why it was hard:** an exit that records nothing is indistinguishable from a hang, and the resumer
re-derives owed-ness from the ledger — a silent exit poisons the derivation.
**Where:** `src/lib/backfill/universe-attempt-log.ts` (append-only, UPDATE/DELETE revoked) ·
`universe-v2-worker.ts` exit paths.
**Proof:** check `universe-failure-is-durable` (live legs, every check:data run) + `universe-attempt-append-only`.

## 6. The single-producer account row
**What:** exactly ONE code path produces Google `entity_level='account'` rows — `FROM customer`, Google's
own account report, independent of the campaign query so both reconcilers stay meaningful.
**Why it was hard:** the row was a reduce over the campaign query (filtered `!= 'REMOVED'`, stamping ONE
date — unwidenable and dropping deleted campaigns' real spend), and a SECOND producer hid in
run-backfill's default builder on the identical conflict key, reachable from the one-click cold path —
while the guard's hardcoded four-file list read green over it. The guard now scans the CLASS.
**Where:** `src/lib/intelligence/google-account-row.ts` · `src/lib/backfill/adapters.ts` (both hooks) ·
guard `tests/guards/google-forward-must-restate.guard.mjs` leg (d).
**Proof:** `02e79b7` — guard seen red naming run-backfill.ts before green; measured $0.00 delta vs the
sum-of-campaigns on three clients × 30 days.

## 7. The forward restate lookback
**What:** Google forward capture asks a 30-day range every fire — because Google restates AFTER capture,
and not only conversions (spend moved on accounts with zero counting conversion actions).
**Why it was hard:** the depth had to be a MEASURED platform property (drift knee at day 30: moving-day
share halves, typical size drops 3.5×), never a per-account conversion-window derivation — which would
never re-ask the accounts whose spend was wrong. One named constant; a bare literal fails the build.
**Where:** `src/app/api/cron/sync/route.ts` GOOGLE_RESTATE_LOOKBACK_DAYS + the six *Window() fetchers.
**Proof:** `02e79b7`; guard legs (a)(a2)(b)(c).

## 8. The capped-grain prune — a re-pulled day equals the fresh payload
**What:** after the fresh top-N payload upserts, rows whose key the fresh pull no longer carries are
deleted — inside the exact (client · google · ad_group · search_term/keyword · dates-with-rows) scope.
**Why it was hard:** upsert-on-conflict replaces only keys that RECUR, so a restatement that moved the
top-N boundary left old ∪ new forever (QUEUE ★SHOPIFY-TIER2 gap 1, arriving on Google nightly via #7).
Upsert-then-prune, never delete-then-insert: a crash leaves a superset, never a false zero. A day with NO
fresh rows is never pruned — a short vendor answer must not wipe real history.
**Where:** `src/lib/intelligence/google-dimensional-prune.ts` (the ONE destructive write in the Google
capture path) · static guard `google-restate-prune-capped.guard.mjs` (5 legs) · live check
`scripts/check-restate-prune-live.mjs` (synthetic client, real writer, per-leg control rows).
**Proof:** `8134806` — red→green on live rows; "STALE ROW(S) SURVIVED A RE-PULL: pet lovers united" was
the red's own evidence line.

## 9. The ordinal respell — key-spelling repair without data loss
**What:** pre-canonicalisation ordinal device values ('2'..'6') respelled to MOBILE/TABLET/… in place,
manifest-first, reversible, double-locked execute (flag + env token), dry-run-in-transaction proven first.
**Why it was hard:** the values are INSIDE the 7-column natural key, so respelling is a key change —
viable only where no canonical twin exists (measured 0 collisions), and the alternative (delete + re-walk)
destroys the only copy of history outside the walked window. The rule is banked: no twin → respell;
twins → insert-on-conflict-do-nothing + prune; never plain delete.
**Where:** `scripts/respell-device-ordinals.mjs` · guard `tests/guards/device-respell-scope.guard.mjs`
(state + scope pin + out-of-scope shrink baseline).
**Proof:** `cb43bcb` — 92,509 rows, 0 lost, 0 collisions; the full 4.18M-row / 31-level class is
manifested in QUEUE ★ORDINAL-CLASS-REMAINDER.

## 10. The mini-walk pattern — un-defer a named family set, prove it, measure it
**What:** a deferral is un-done as a one-line-class change (the table is data), pinned by a count guard
that goes red the moment the set moves without its record, scoped to one client by STRUCTURE (the pinned
cron; no per-client flag to get wrong), gated per-message by the disk floor, and proven by ledger ignition
on the first fire.
**Why it was hard:** the alternative was re-arguing the whole walk per family. The pattern's preconditions
travel with it: key-hygiene repair first (#9), guard pin same commit, headroom read live, no-fan-out proven
from config + imports, Gate-B = the measured size (QUEUE ★UNDEFER-3-SIZE-READ).
**Where:** `DEFERRED_ENTRIES` in `google-ads-universe-writer.ts` · `universe-window-log.guard.mjs` leg (g).
**Proof:** `3418df6` — selectable 346→349; all three families attempt_started → attempt_finished →
message_finished on the FIRST post-deploy cron tick, 3m06s after READY.
