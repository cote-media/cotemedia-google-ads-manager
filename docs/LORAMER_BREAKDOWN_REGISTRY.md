# LoraMer Breakdown Registry (§7)

Status: DRAFT for review — authored Phase 2 Step 1. Uncommitted.
Governing law: capture EVERYTHING from EVERYWHERE, store FOREVER, full grain WITH history.
Source of truth for: per-dimension {entity_level, value-encoding, source field}, the query allowlist, and the entity_level CHECK set. Every breadth writer keys off this file.

## 1. Canonical conventions

### entity_level (finite set — basis for the future CHECK constraint)
account · campaign · ad_group · ad_set · ad
- ad_group (Google) and ad_set (Meta) stay native, NOT unified.
- Today entity_level is free text in code — a typo silently forks a grain. The CHECK constraint enforcing this set is a SEPARATE approach-gated migration (schema touch); flagged in §5, not done in this step.

### value-encoding (per breakdown_type — pick ONE, never mix within a type)
- raw      : exact source string, no transform (e.g. search_term, keyword text)
- iso      : ISO code (e.g. geo_country = "US")
- composite: stable joined key with a fixed separator, documented per type (e.g. placement = "<publisher>:<position>", geo_region = "US-CA")
Rule for NEW dimensions: prefer raw or iso; use composite ONLY when the dimension is inherently multi-part and the parts are meaningless alone (placement is the sole current case).
CASING: MAPPED ENUM → UPPER canonical name (convention: EXACT/ENABLED/DESKTOP). RAW API string → stored verbatim (ISO upper e.g. 'US'; Meta raw lower e.g. 'facebook:feed'). breakdown_value follows source type; mapped-enum display Title-case (e.g. 'Mobile') is prompt-only, never persisted.

API-TRUTH-FIRST + ALL-GRAINS (governing rule): a dimension's grain set is whatever the API actually serves, VERIFIED against the live API (probe — don't assume field names or counts), per resource. Capture EVERY grain the API returns; a subset is unfinished code, NOT a design choice. "Empty for a client today" ≠ "unsupported" — still capture it. The ONLY acceptable omission is a grain the platform genuinely does not serve (e.g. user_geo_country — geo_target_country is not selectable on user_location_view), and that omission must be stated. When one logical dimension spans multiple API resources (e.g. geo = geographic_view + user_location_view) OR multiple grains, each resource/grain is its own breakdown_type — never collapse them.

ACTIVE-BASELINE (governing rule): every Gate-A baseline, byte-identical comparison, and lap-window/throughput SIZING must run against a CURRENTLY-ACTIVE account (recent spend in the window measured) — and a heavy one for timing. A dormant client's zeros validate nothing and can mask a real defect (the MVN lesson 2026-06-27: My Vacation Network had near-zero recent data, so a window measured on it would have looked instant and hidden the true nationwide lap cost; Bath Fitter + Veterinary, both active, gave the real numbers). Verify recency (max(date), recent-window spend) BEFORE choosing a Gate-A/sizing client.

### base-row sentinel
breakdown_type = '' and breakdown_value = '' (empty string). The query layer's double-count guard depends on this exact sentinel. Never NULL.

### writer contract (every breadth writer obeys)
- conflict key = the 7 metrics_daily columns; idempotent upsert.
- reconcile via the shared reconcileDay primitive, FLAG-NOT-BLOCK default (Lesson 59 + stale-anchor lesson). Conversions NEVER gate.
- ONE drain-registry entry per dimension; cohort auto-backfills (additive, idempotent); onboard_steps_done is a per-step SET.
- NO 37-month clock on breadth — indefinite retention. Stop-at-floor still applies per platform (Lesson 61: floor = empty-success, never a throw).
- Backend = freeze-safe. Surfacing in UI = Phase 4, -next only.

## 2. Current persisted registry (VERIFIED in-code this session)

| breakdown_type | platform | entity_level | encoding  | source field                          | notes |
|----------------|----------|--------------|-----------|---------------------------------------|-------|
| search_term    | google   | ad_group     | raw       | search term text (google-dimensional) | parent=campaign |
| keyword        | google   | ad_group     | raw       | keyword text (google-dimensional)     | parent=campaign |
| placement      | meta     | campaign     | composite | breakdowns=publisher_platform,platform_position → "<pub>:<pos>" | parent=acct |
| geo_country    | shopify  | account      | iso       | ISO country code (shopify-metrics-row)|       |
| geo_region     | shopify  | account      | composite | "US-CA" (shopify-metrics-row)         |       |
| (base rows)    | all      | (native)     | sentinel  | —                                     | type='' value='' |

## 3. Mismatch resolutions (the inconsistency §7 names)

Query-layer queryBreakdown allowlist today = {search_term, keyword, publisher_platform, age, gender, geo_country, geo_region}.

- WRITTEN but NOT queryable — 'placement' (meta). RESOLUTION: canonical name = `placement` (keep the composite; splitting gains no grain and forces a migration). Fix the allowlist read-name `publisher_platform` → `placement`. This edit is CODE on the live read-path = STOP-and-confirm; TRACKED in §5, NOT done in Step 1. No data migration.
- QUERYABLE but NOT written — 'age', 'gender' (meta). RESOLUTION: mark RESERVED (writer pending Phase 2). Do not delete from allowlist. Writers land as Phase-2 dimensions below.
- CROSS-PLATFORM COLLISION — device/geo/age/gender exist on BOTH google AND meta (e.g. google device = campaign grain, meta device = campaign grain). The query layer's BREAKDOWN_PLATFORM map is 1:1 (breakdown_type → ONE platform) and cannot represent device→{google,meta}. RESOLUTION: breakdown_type stays platform-NEUTRAL ('device'); the query allowlist + read-path key on (platform, breakdown_type), and platform is REQUIRED when a type is multi-platform. Every metrics_daily row already carries platform → NO data migration. This is part of the §5 STOP-and-confirm query-layer edit, NOT bundled into a writer commit.

## 4. Phase 2 dimension catalog (forward + backfill, one drain entry each)

Confidence: [VERIFIED in-code] = source field proven in the live fetcher. [VERIFY-AT-WRITER] = source field NOT yet confirmed against live API; confirm against current API docs when authoring that writer — do not assume field names.

### Google
All five VERIFIED dimensions are CAMPAIGN grain (corrected from the draft's ad_group — the proven live GAQL is FROM campaign). Google age & gender are TWO separate views (age_range_view, gender_view) → two breakdown_types, NOT a combined 'age_gender'.
| breakdown_type     | entity_level | encoding | source field            | confidence |
|--------------------|--------------|----------|-------------------------|------------|
| device             | campaign     | raw (enum name) | segments.device, FROM campaign | VERIFIED in-code (google-intelligence:653) — FIRST WRITER |
| hour               | campaign     | composite (hour×day_of_week) | segments.hour, segments.day_of_week, FROM campaign | VERIFIED in-code (google-intelligence:663) |
| geo_* (FAMILY)     | campaign     | "geoTargetConstants/<id>" (+ ":<LOCATION_TYPE_UPPER>" on geographic_view grains) | per-grain segments across geographic_view + user_location_view | VERIFIED live 2026-06-27 (probe). FULL family — see "Geo family" subsection below. RECONCILE=NONE (write-only, non-partitioning). raw opaque id, name resolution DEFERRED. |
| age                | campaign     | raw      | FROM age_range_view     | VERIFIED in-code (google-intelligence:392) |
| gender             | campaign     | raw      | FROM gender_view        | VERIFIED in-code (google-intelligence:405) |
| network            | campaign     | raw      | segments.ad_network_type | VERIFY-AT-WRITER |
| impression_share   | campaign     | raw      | (competitive metrics)   | VERIFY-AT-WRITER |
| video              | ad           | raw      | (video metrics)         | VERIFY-AT-WRITER |
| all_conversions    | campaign     | raw      | (all_conversions split) | VERIFY-AT-WRITER |

#### Geo family (Google) — VERIFIED live 2026-06-27
Geo is a FAMILY of grains captured PER-GRAIN (one GAQL per grain — co-selecting segments returns the
intersection and under-captures; proven: all-9 co-select = 0 rows, city+region = city-alone ≠ region-alone).
All entity_level='campaign', value = "geoTargetConstants/<id>" (raw opaque resource-name; country_criterion_id's
bare id is normalized to the same form). Name resolution DEFERRED (additive later layer; gates Lora-queryability).
RECONCILE=NONE for every geo grain (write-only).
- geographic_view (targeted/interest) — each grain APPENDS ":<LOCATION_TYPE_UPPER>" (2→AREA_OF_INTEREST,
  3→LOCATION_OF_PRESENCE, 1→UNKNOWN, 0→UNSPECIFIED): geo_city, geo_metro, geo_region, geo_state, geo_province,
  geo_county, geo_district, geo_postal, geo_most_specific (segments.geo_target_*) + geo_country
  (geographic_view.country_criterion_id). = 10 grains.
- user_location_view (PHYSICAL location, NO location_type, DIFFERENT ids): user_geo_city, user_geo_metro,
  user_geo_region, user_geo_state, user_geo_province, user_geo_county, user_geo_district, user_geo_postal,
  user_geo_most_specific. = 9 grains. (user_geo_country NOT served — geo_target_country not selectable on this
  view + no country field; the ONLY acceptable omission = platform genuinely doesn't serve it.)
- COST: 19 queries/client (10 + 9), one per grain, both forward (per day) and backfill (per window). Two drain
  steps: 'google_geo' (geographic_view family) + 'google_user_geo' (user_location_view family).

### Meta
| breakdown_type     | entity_level | encoding | source field            | confidence |
|--------------------|--------------|----------|-------------------------|------------|
| age_gender         | ad_set       | composite| insights breakdown      | VERIFY-AT-WRITER (the age/gender at meta-intelligence:149-151 is TARGETING config, NOT insights — do not reuse) |
| geo                | campaign     | composite| insights breakdown      | VERIFY-AT-WRITER |
| device             | campaign     | raw      | impression_device       | VERIFY-AT-WRITER |
| hourly             | campaign     | raw      | hourly_stats breakdown  | VERIFY-AT-WRITER |
| video              | ad           | raw      | video metrics           | VERIFY-AT-WRITER |
| ranking            | ad           | raw      | quality/engagement rank | VERIFY-AT-WRITER |

### GA / Shopify / Woo
- GA is account-only today. GA breadth needs a build-time DECISION (first-class session/user columns vs extra-jsonb) — deferred to the GA writer step (§7/§12). NEEDS-DECISION, not pre-judged here.
- Shopify geo_country/geo_region already persisted; further Shopify/Woo breadth catalogued at writer time.

## 5. Tracked follow-ups (NOT done in this step)

- [CODE / STOP-and-confirm] Query allowlist read-name `publisher_platform` → `placement`, AND re-key the allowlist on (platform, breakdown_type) for the cross-platform dims (§3). Live read-path.
- [CODE / next motion] Google `device` FORWARD capture in cron/sync + cron/catchup (mirror the search_term/keyword forward wiring). Pairs with the device backfill to satisfy fwd+backfill.
- [MIGRATION / approach-gated] entity_level CHECK constraint over the §1 finite set. Schema touch.
- [DECISION / deferred] GA breadth storage shape.
- [CLEANUP / later] raw jsonb column is DEAD — drop or repurpose; not now.

## 6. Build order (route; Claude owns)

1. THIS doc (Step 1, done — review).
2. Google `device` BACKFILL writer + 'google_device' drain entry — AUTHORED (LORAMER_GOOGLE_DEVICE_BACKFILL_V1, src/lib/backfill/google-device-backfill.ts; campaign × device; FROM campaign segments.device; FLAG-NOT-BLOCK vs per-day campaign anchor). Gate A pending before commit. Backend = freeze-safe.
2b. Google `device` FORWARD capture (cron/sync + cron/catchup) — the IMMEDIATE NEXT motion (NOT deferred; the search_term/keyword precedent shipped capture + backfill as two adjacent commits). Governing law = fwd + backfill for every dimension.
3. Remaining Google dimensions (hour/geo/age/gender — proven in-code; then network/IS/video/all_conversions VERIFY-AT-WRITER), then Meta dimensions (each VERIFY-AT-WRITER first), then GA/Shopify/Woo breadth.
NOTE: the (platform, breakdown_type) query-allowlist edit (§3/§5) is a SEPARATE STOP-and-confirm change on the live read-path — it gates when device becomes queryable by Lora, not when it is captured.
