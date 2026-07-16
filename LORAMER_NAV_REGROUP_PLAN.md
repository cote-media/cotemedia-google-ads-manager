# LORAMER_NAV_REGROUP_PLAN

Design + plan owner for the left-nav / channel-rail regroup (branch `nav-regroup-v1`). Until now this work was tracked only as two completed ROADMAP checkboxes (LORAMER_NAV_REGROUP_V1, 2026-06-06) plus a diagnosed backlog note in CONTINUE_HERE. This doc is the single home for its design invariants and open items.

## Status
- SHIPPED (LORAMER_NAV_REGROUP_V1, 2026-06-06): Channels group in the rail (dynamic per connected source); Campaigns + Keywords demoted from top-level to in-channel tabs.
- OPEN VIOLATION: the channel-rail pushes the Google and Meta rail items only inside the `hasBoth` (hasGoogle && hasMeta) branch, so single-ad-platform clients (e.g. Meta-only) get no standalone platform tab. ROADMAP marks "dynamic per connected source, scales to N" as done — treat that as PARTIAL until this gate is removed.
- UNBLOCKED (Meta APPROVED 2026-07-02 — no freeze): a live-path shared-UI change; build with graduated care (blast radius: every client).

## DESIGN INVARIANT — per-connection nav visibility (decided 2026-06-17)
A platform's visibility in nav/rail depends on exactly ONE condition: whether the client has connected it. Every connected platform gets its own nav entry, unconditionally. No rule may hide a platform a customer brought in — no `hasBoth`-style gates, no "show X only if Y". Test for any nav rule: does it ever hide a connected platform? If yes, it is wrong. Combination-aware logic is permitted ONLY to ADD aggregate/cross-platform views (e.g. a blended Google+Meta "Combined" view that appears only with 2+ ad platforms) — never to gate individual platform visibility. Per the IA direction, per-connection visibility lives at the secondary (within-client) platform selector; top-level nav stays scoped to clients + cross-cutting surfaces, so the model scales to any number of platform combinations.

## Diagnosed instances (re-confirmed 2026-06-17 on Shelley Kyle, Meta-only)
- hasBoth rail gate → Meta-only / Google-only clients get no standalone platform tab; their ad surface is reachable only via "Overview". (First diagnosed 2026-06-12.)
- ✅ CLOSED (2026-06-17, LORAMER_CLIENT_SWITCH_TAB_V1) — Stale `advar-active-tab` sticky routing: a carried tab (`shopify`/`woocommerce`/`ga`) under a client lacking that platform rendered a BLANK body with no rail highlight; the old normalizer only covered keywords/campaigns. Fixed at the `selectClient` normalizer: the carried tab is now validated against the destination client's available tabs (mirroring each render gate) and falls back to a valid, non-blank landing tab (ad→overview, ecom-only→its ecom tab, GA-only→Analytics). The blank-on-switch class is gone.
  - RESIDUAL (distinct item, NOT closed by the normalizer): "Meta pill opens Woo" for a client that HAS Woo. The pill (`goToDashboard(client,'meta')`) sets `advar-active-platform` but never the tab, so a sticky `='woocommerce'` is still a VALID tab for a woo-connected client → kept → lands on Woo, not Meta. No longer a blank, but the pill should also set the tab (overview) on the /clients pill path. Separate fix; reviewer-path UI → POST-Meta batch.
