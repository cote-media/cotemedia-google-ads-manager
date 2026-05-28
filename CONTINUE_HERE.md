# CONTINUE_HERE — PMax Asset-Level Performance (read after HANDOFF + ROADMAP)

*Written May 28, 2026, at the end of a session that diagnosed the PMax asset-label bug down to the API level. No code was changed for PMax this session — the work was diagnosis. This file tells you exactly what we learned and what to build.*

---

## What this is about

The north-star PMax feature — "which assets / asset combinations drove performance" — is degraded. Claude's insight bar correctly tells users "I can see the asset text but not the per-asset performance labels — check the Google Ads UI." That's honest, but it's not what we want to ship long-term. This session figured out *why* and *what's actually possible via the API*.

## The bug, precisely

In `src/lib/intelligence/google-intelligence.ts`, the `asset_group_asset` query (around lines 485–493) does **NOT** select a performance label field, but the result-mapper (around line 519) reads `row.asset_group_asset?.performance_label` — so `performanceLabel` is **always an empty string**. You can't read a field you didn't SELECT. That's the immediate, visible cause of every empty label.

A prior session "fixed Step 1" by *removing* `performance_label` from the SELECT (recorded in the handoff "Shipped" list). It did that because of a belief that the field "doesn't exist in v23." That belief was imprecise — see below.

## What we PROVED via Google's Query Validator (not assumed — validated May 28)

Validator URL: `https://developers.google.com/google-ads/api/fields/v23/query_validator`

1. **`asset_group_asset.performance_label` is NOT selectable** from the `asset_group_asset` resource in v23. The validator rejected it explicitly: *"not a valid field in the SELECT clause when 'asset_group_asset' is the resource... Fields in the SELECT must be 'Selectable'."* So adding it back to the SELECT would re-break the entire asset query (silent `.catch(() => [])` → empty array → lose the asset text we currently get). **Do not add it back.**

2. **Per-asset BEST/GOOD/LOW labels are UI-only in v23.** Not available via API from this resource. The corrected fact is now in the handoff "Hard-won technical facts."

3. **`asset_group_top_combination_view` IS a valid resource** (validator confirmed "Valid Query" for):
   ```
   SELECT asset_group.id, asset_group.name, campaign.name, asset_group_top_combination_view.asset_group_top_combinations FROM asset_group_top_combination_view WHERE segments.date DURING LAST_30_DAYS AND campaign.advertising_channel_type = 'PERFORMANCE_MAX'
   ```
   This returns top-performing *combinations* of assets (Google's "Combinations report"), NOT per-asset labels. It's a different, richer shape — and it's the real path to the north-star "what combination drove this conversion."

## The decision in front of you — Path A vs Path B

**Path A (small, honest, ship-now):** Remove the dead `performanceLabel` read on line 519 (and its field on the `IntelligenceAssetGroupAsset` type if present) so the code stops carrying an always-empty value, and make sure Claude's prompt doesn't imply per-asset API labels exist. Tiny, safe, makes the product truthful. Does NOT deliver labels — concedes they're UI-only. The insight bar already degrades gracefully, so this just aligns the backend with that reality.

**Path B (the north-star feature):** Build `asset_group_top_combination_view` properly — new GAQL query (validated shape above, but swap the hardcoded `LAST_30_DAYS` for the existing `${dateFilter}` variable so it respects the user's date range), new result-mapping (combinations are a nested structure — each row has a list of `AssetGroupAssetCombinationData`, each containing a list of `AssetUsage`), a new field on the intelligence type, and prompt wiring so Claude reasons over combinations. This is real feature work — new types, new mapping, new wiring — NOT a one-line fix.

**My recommendation (the Claude who diagnosed this):** Do Path A first as the immediate truthful fix. Scope Path B as its own focused build with fresh execution — it deserves that, and rushing it is how regressions happen. Path B is genuinely the north-star payoff, so it's worth doing well, not fast.

## Discipline reminders specific to this work

- The two `.catch` blocks on the asset-group queries are ALREADY instrumented (`LORAMER_PMAX_CATCH_INSTRUMENTATION_V1`) — they log real GAQL errors to Vercel. If you trigger a fresh fetch (cache-bust with a never-used custom date range — the 15-min cache hides everything otherwise, failure-mode #9), you can read the real error in Vercel Runtime Logs.
- Validate ANY new GAQL in the Query Validator BEFORE writing the patch. That single step is what saved this session from shipping the broken `performance_label`-in-SELECT fix.
- Per handoff rule 6: whatever you ship, flip the ROADMAP checkbox and move the LAUNCH_PARKING PMax item (`LORAMER_PARKING_END_OF_MAY26_V1`) in the SAME commit.
- A perfect query may still return some empty/unrated results for a young asset group — Google needs serving data before it rates. That's not a bug; don't chase it.

## Exact locations

- File: `src/lib/intelligence/google-intelligence.ts`
- Asset-group query + asset query: ~lines 471–494
- Result mapping (the dead `performanceLabel` read): ~line 519
- Type: `IntelligenceAssetGroupAsset` in `src/lib/intelligence/intelligence-types.ts`
- Open item tracked in: `LAUNCH_PARKING.md` (`LORAMER_PARKING_END_OF_MAY26_V1`) and `ROADMAP.md` Project 3

## Client for testing

The Escential Group — campaign "Sales-Performance Max-April '26" — Asset Group 1 (19 images, 5 videos, 5/10 Ad Strength). Use a Google platform view and a never-used custom date range to force a live fetch.
