# LORAMER_NAV_REGROUP_PLAN

Design + plan owner for the left-nav / channel-rail regroup (branch `nav-regroup-v1`). Until now this work was tracked only as two completed ROADMAP checkboxes (LORAMER_NAV_REGROUP_V1, 2026-06-06) plus a diagnosed backlog note in CONTINUE_HERE. This doc is the single home for its design invariants and open items.

## Status
- SHIPPED (LORAMER_NAV_REGROUP_V1, 2026-06-06): Channels group in the rail (dynamic per connected source); Campaigns + Keywords demoted from top-level to in-channel tabs.
- OPEN VIOLATION: the channel-rail pushes the Google and Meta rail items only inside the `hasBoth` (hasGoogle && hasMeta) branch, so single-ad-platform clients (e.g. Meta-only) get no standalone platform tab. ROADMAP marks "dynamic per connected source, scales to N" as done — treat that as PARTIAL until this gate is removed.
- HELD: reviewer-path UI freeze (until the Meta decision). No build until then.

## DESIGN INVARIANT — per-connection nav visibility (decided 2026-06-17)
A platform's visibility in nav/rail depends on exactly ONE condition: whether the client has connected it. Every connected platform gets its own nav entry, unconditionally. No rule may hide a platform a customer brought in — no `hasBoth`-style gates, no "show X only if Y". Test for any nav rule: does it ever hide a connected platform? If yes, it is wrong. Combination-aware logic is permitted ONLY to ADD aggregate/cross-platform views (e.g. a blended Google+Meta "Combined" view that appears only with 2+ ad platforms) — never to gate individual platform visibility. Per the IA direction, per-connection visibility lives at the secondary (within-client) platform selector; top-level nav stays scoped to clients + cross-cutting surfaces, so the model scales to any number of platform combinations.

## Diagnosed instances (re-confirmed 2026-06-17 on Shelley Kyle, Meta-only)
- hasBoth rail gate → Meta-only / Google-only clients get no standalone platform tab; their ad surface is reachable only via "Overview". (First diagnosed 2026-06-12.)
- Stale `advar-active-tab` sticky routing: the Meta pill on /clients sets active-platform but never clears the saved tab, so a stale `='woocommerce'` makes the dashboard restore the Woo tab ("Meta pill opens Woo"). Related nav bug; same freeze batch.
