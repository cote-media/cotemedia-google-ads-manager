# LoraMer — Asset-Layer Scope (T3b: creative + asset-combination attribution)
<!-- LORAMER_ASSET_LAYER_SCOPE_V1 -->

STATUS: scoped 2026-06-29, build = POST-LAUNCH FLAGSHIP (T3b). Core capability / 2027 write destination. NOT a thin slice — per-combination attribution requires a modeling layer (joint unserved by Meta+Google).

This is a SCOPE, not a build. Grounded read-only 2026-06-29 (repo + schema + inventory; ZERO platform API calls). Routes the size/timing decision; the 4 decision-forks (§5) are the flagship's OPENING decisions.

═══════════════════════════════════════════════════════════════════
## 1. PER-PLATFORM: what the APIs SERVE at the asset grain + the hard ceilings
═══════════════════════════════════════════════════════════════════
META (Insights + /ads creative) — ALREADY FETCHED today, discarded:
- CONTENT: /act/ads?fields=creative{id,object_story_spec,asset_feed_spec,image_hash,image_url,video_id,thumbnail_url,title,body,call_to_action_type,link_url}. Dynamic Creative → asset_feed_spec{bodies,titles,descriptions,images,videos,link_urls,cta_types} — each asset a STABLE id + content. (Today we read only creative{title,body,cta,image_url,video_id} for the prompt.) Account-structure object → NO time limit (current-state).
- PER-ASSET PERFORMANCE: YES — the 7 asset breakdowns (image_asset/video_asset/title_asset/body_asset/description_asset/call_to_action_asset/link_url_asset) at AD level each return per-asset spend + actions[] conversions + content + stable id. History = 37-mo granular floor (same as all Insights). NOT captured today.
- CEILING — PER-COMBINATION = IMPOSSIBLE via Insights (#100: image_asset,body_asset → error; Meta does NOT serve the joint distribution). The marginal of each asset is queryable; the joint (which image+headline+CTA combo drove which conversions) is NOT. asset_feed_spec enumerates the combinatorial SPACE only → must be MODELED.

GOOGLE (GAQL) — ALREADY FETCHED today in v23, discarded:
- RSA (ad_group_ad_asset_view): per-asset CONTENT (asset.text) + field_type (HEADLINE/DESCRIPTION) + performance LABEL (BEST/GOOD/LOW). NO per-asset NUMERIC metrics (UI-only in the API). No RSA combination report (auto-assembled).
- PMax: asset_group (GROUP-level metrics: impr/clicks/cost/conversions/value — served) · asset_group_asset (asset text/type/id + isImage/isVideo, NO per-asset numeric) · asset_group_top_combination_view (which assets served TOGETHER as a top combination + ad_strength — QUALITATIVE, NOT per-combo conversion counts).
- CEILING — Google per-asset NUMERIC perf is NOT served (RSA = labels only; PMax = group-level + qualitative combos). The top-combinations report says WHICH assets served together, NOT "this combo drove $X / N conversions."
- Content/structure = account-structure objects → NO time limit. Group metrics/combos = granular retention.

NET CEILING (the core-capability truth): per-COMBINATION conversion attribution "to the nickel, by type" is served by NEITHER platform — Meta can't express the joint at all; Google reports top combos qualitatively, not per-combo conversions. ⇒ the core capability REQUIRES A MODELING layer on BOTH platforms (infer the joint from marginals + serving/combination signals), not direct capture.

SHOPIFY/WOO: the "asset" analog is the CATALOG content layer (products/variants), already scoped as T1.22 — NOT the ad-creative asset layer and NO combination ceiling (commerce pivots freely). Out of T3b scope.

CAPTURE-PATH NOTE: NOT a new fetch surface — both platforms' asset data is ALREADY fetched (4 typed payloads: IntelligenceAdAsset / IntelligenceAssetGroup / IntelligenceAssetGroupAsset / IntelligenceAssetCombination) for the live prompt and discarded. Persisting rides existing fetches.

═══════════════════════════════════════════════════════════════════
## 2. SCHEMA VERDICT — does it fit metrics_daily?
═══════════════════════════════════════════════════════════════════
- Per-asset NUMERIC performance (asset_id × entity × date × spend/conv/value): FITS metrics_daily as a new grain (entity_level='asset' or breakdown_type='asset', entity_id=asset_id, parent=ad/ad_group/asset_group). Numeric, per-day — same shape as device/geo. BUT only Meta serves it; Google per-asset numeric is unserved (labels only).
- Creative CONTENT (id/type/text/image_url/video_id/hash/thumbnail/link + asset_feed_spec): DOES NOT FIT — slow-changing catalog content, no date/numeric grain (the inventory already says "creative store, not metrics_daily"). NEEDS A NEW TABLE.
- Asset↔entity LINKAGE + Google performance LABELS (categorical, not numeric): does not fit the numeric fact cleanly → its own linkage table.
- Asset-COMBINATION: the combination RECORD + the MODELED per-combo attribution → neither fits metrics_daily; needs its own table(s) + a modeling-output store.

MINIMAL NEW TABLE SET (shape only — NOT a migration):
- ad_assets (CONTENT catalog): PK (platform, account_id, asset_id) · client_id · asset_type · text · image_url/image_hash/thumbnail_url · video_id · link_url · raw jsonb (asset_feed_spec/object_story_spec) · first_seen/last_seen. Slow-changing snapshot.
- asset_membership (LINKAGE): (platform, asset_id, entity_level, entity_id) · field_type · performance_label · status. Which asset belongs to which ad/ad_group/asset_group + its role/label.
- [per-asset numeric perf] → ride metrics_daily (entity_level='asset') for Meta; OR a thin asset_performance fact.
- asset_combinations (COMBINATION layer): combination_id · client_id · platform · asset_group_id/ad_id · asset_ids[] · source ('google_native' | 'meta_modeled' | 'rsa_modeled') · served-together/ad_strength signal · [modeled: conversions/value by type + confidence + method + eval_version].

═══════════════════════════════════════════════════════════════════
## 3. SIZE CLASS
═══════════════════════════════════════════════════════════════════
(c) NEW-SCHEMA + MODELING layer for combinations = FLAGSHIP MULTI-WEEK.
Reasoning: it is NOT a handful of writers on the existing schema. It is 2–4 new tables (content catalog + linkage + combinations) + writers (content snapshot + Meta per-asset perf + Google group/labels/combos) + a 37-mo per-asset perf BACKFILL + — the decisive piece — a per-combination conversion-attribution MODELING engine (the joint is unserved on both platforms), which under the honesty/accuracy rules is an OFFLINE-EVAL-GATED research workstream (same gate as money-moving recommendations) + surfacing. The modeling alone is multi-week; this is explicitly the "core capability" feeding the 2027 write destination.

═══════════════════════════════════════════════════════════════════
## 4. PRE-7/14 VERDICT (straight)
═══════════════════════════════════════════════════════════════════
A COMPLETE, law-honoring version (full content catalog + per-asset perf w/ 37-mo history + the cross-platform combination MODELING with eval gating + surfacing) CANNOT land in T-15. The modeling is an eval-gated research effort, surfacing is frozen behind the Meta App Review decision, and a thin slice (just persist the already-fetched content/labels) would VIOLATE the law (per-combination is the whole point; a marginal-only slice is unfinished code).
HONEST CALL: SCOPE NOW (this doc), BUILD AS THE POST-LAUNCH FLAGSHIP. The pre-7/14 lane is surfacing the breadth already captured, not opening the asset layer.

═══════════════════════════════════════════════════════════════════
## 5. GATING + DECISION-FORKS (for Russ to route — the flagship's OPENING decisions)
═══════════════════════════════════════════════════════════════════
- v24-lib (T3a): NOT A DEPENDENCY. Every Google asset query (asset_group, asset_group_asset, asset_group_top_combination_view, ad_group_ad_asset_view) runs TODAY in the pinned v23 (live on the prompt). T3b is INDEPENDENT of the v24 bump (T3a is only for PMax×ad_network_type network breadth).
- Quota: forward content snapshot + Meta per-asset perf = cheap / Meta has NO quota wall. The Google asset surface is already fetched (no new calls forward); a Google per-asset/group/combo BACKFILL would contend with the shared Basic-Access dev-token (15k/day) — but Google per-asset numeric isn't served, so the Google backfill is light (group metrics + combos). Meta per-asset 37-mo backfill = no quota wall.

DECISION-FORKS:
1. CORE (Fork 1 = Russ product call): accept a MODELED (estimated, confidence-scored, eval-gated, honestly-labeled "modeled not measured") per-combination conversion attribution — since neither platform serves the joint? This is the central product call and the flagship's first gate.
2. SCHEMA: the ad_assets content-store shape (new table) — a Russ-approvable schema decision (like the GA4 columns-vs-jsonb fork).
3. GRAIN: per-asset numeric perf rides metrics_daily (widen entity_level→'asset') vs a dedicated asset_performance table.
4. TIMING: post-launch flagship (the honest verdict) vs a deliberately-scoped pre-launch foundation.
