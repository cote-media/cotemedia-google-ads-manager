<!-- QUEUE-EXEMPT: findings for the shipped self-serve spine; reference. -->
# LoraMer — Self-Serve Backfill Investigation Findings

## Self-Serve Backfill — investigation findings (2026-06-27, not yet designed)

CONNECT FLOW (verified): connections insert on OAuth callback (woo/ga/shopify/google); onboard_steps_done left null; the ONLY backfill driver is the 5-min drain cron, flat round-robin — NO connect-triggered kickoff, NO priority tier. (This is the gap the self-serve spine must fill: connect→immediate kickoff + new-client priority.)

SWEEP TIMING (measured, heaviest client): full single-connection drain sweep ≈ 187s (geo 41 + user_geo 41 + device 43 + hour 24 + campaign 16 + adgroup 23), ≈ 220-250s incl. account/dimensional.

LEASE CONSTRAINT (verified): claim lease (migration 014) is 360s. Lease→200s is UNSAFE — sweep (220-250s) exceeds it → mid-sweep double-claim. RULE: lease must stay safely ABOVE the real sweep time (>~250s, current 360s is safe). The earlier "shorten lease for free 2hr" idea is DEAD.

CONCURRENCY/MEMORY (Vercel fluid, researched — direction confirmed, exact threshold needs dashboard verify): fluid PACKS concurrent invocations into one shared-memory warm instance (not guaranteed separate-instance isolation). So N concurrent 544MB sweeps may co-locate → N×544MB on one instance → OOM above the default. Cannot rely on free per-instance isolation. FREE concurrency lever = shrink per-sweep peak (smaller geo window → ~270MB at ~7-10d) so multiple sweeps fit the free instance, trading lap-count for concurrency. PAID lever = raise instance memory. TODO: verify the project's actual fluid instance memory default + observed co-location in Vercel dashboard runtime logs (Lesson-57: confirm from source system).

SPEED LEVERS SUMMARY: backfill wall-clock = laps (= 1095/window, memory-bounded) × lease (>~250s) ÷ concurrency (memory-bounded). All three free knobs are MEMORY-bounded on the free 1024MB instance. Cost is work-bound (~$0.30 cohort geo, active-CPU); speed beyond the free-memory envelope needs a paid memory bump. Cost cliff = volume (~17-26 deep onboards/mo), not speed.
