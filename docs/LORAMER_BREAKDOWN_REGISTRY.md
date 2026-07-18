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

ENTITY-LEVEL is a universal breadth axis (governing rule): every breadth dimension is selectable at MULTIPLE entity levels (campaign / ad_group / ad / keyword), not just campaign. Completeness = every dimension × every grain × every entity level the API serves. A campaign-only breadth dim is unfinished code.

RECONCILE POSTURE is PER-GRAIN, not per-dimension (governing rule): a grain reconciles (FLAG-NOT-BLOCK vs its anchor) ONLY if it PARTITIONS the anchor's spend; a grain that is a SUBSET is WRITE-ONLY. Decided per (dimension, entity-level), not per dimension. Verified: device × {campaign, ad_group, ad} PARTITION campaign spend → FLAG-NOT-BLOCK; device × keyword is a SEARCH-only SUBSET (keyword_view excludes PMax/Display/Search-partner spend) → WRITE-ONLY, same class as the search_term/keyword breakdowns. Reconciling a non-partition grain produces FALSE flags that drown the real ones (Gate A: keyword reconcile flagged 21/21 days on a mixed account). Test before choosing: does Σ(grain) tie to the anchor on a MIXED (non-pure-search) account? Yes → reconcile; no → write-only.

DRAIN SPEED is FREE to crank; cost is WORK-BOUND, not speed-bound (governing fact, measured 2026-06-27): Vercel Pro bills ACTIVE-CPU only (I/O wait — Google API fetch, Supabase upserts — is $0); a geo lap measured 53% active-CPU / 47% I/O-wait. The cohort's full geo backfill ≈ 2-3 active-CPU-HOURS one-time ≈ ~$0.30 — trivial vs the $20/mo Pro credit. Because active-CPU scales with TOTAL WORK (rows × dims × clients × history-depth), NOT cadence, running faster does the SAME work sooner at the SAME cost. FREE-MAX drain config (LORAMER_DRAIN_FREEMAX_V1): google drain cron 6h → */5 (minute-level, Pro; ~8,640 inv/mo ≪ 1M free); maxDuration 300→800s (Pro GA, free); BUDGET_MS 250→750s; PER_PLATFORM_CAP[google] 4→18 → 36-mo backfill ~2-3 MONTHS → ~6-9 HOURS at ZERO added cost. COST CLIFF (first overage $): NOT cadence/duration/concurrency — it's VOLUME: ~17-26 deep-36mo-history clients ONBOARDING in one month (one-time backfill bursts, ~6-9 CPU-hr each), OR ~900-1500 steady clients (nightly forward across all dims). Tipping variable = onboarding rate of deep-history clients, then steady client count. SAFETY: faster cron is safe iff one connection's full step-sweep (~150s) stays under the 360s claim lease (migration 014) — overlapping 800s fires then pick different lease-expired connections, never double-claim; raise the lease if a sweep ever approaches it.

PEAK-MEMORY is bounded by the LAP WINDOW, not chunk size or entity-split (governing rule, measured 2026-06-27): for a high-volume dimension (geo at 2 entity levels, nationwide client), peak rss scales with the TOTAL rows processed per lap = the WINDOW (V8 high-water; freed memory isn't returned to the OS). Fetch CHUNK size bounds only the per-QUERY buffer (10-day vs monthly both peaked ~830-860MB at 60d → chunk is NOT the memory lever). An entity-level split does NOT help either (the writer already processes one grain×entity at a time; peak = a single grain×entity×window's high-water). LEVER = shorten the lap window until peak fits the function memory limit with margin (geo: 60d=829MB too close to 1024MB → 20d=544MB safe). MEASURE peak-vs-window on the heaviest ACTIVE client; never assume chunking fixes memory.

ENTITY-LEVEL is PROBED PER DIMENSION, NEVER ASSUMED (governing rule): the entity-level axis is NOT one shape — it differs per dimension and must be live-probed. A REJECTION of a (segment, entity-resource) pair = the not-served exception (don't chase it); an EMPTY result on an accepted pair = a gap (capture it). Verified shapes 2026-06-24: device = segment selectable FROM {campaign, ad_group, ad, keyword} (4 levels); hour = segment FROM {campaign, ad_group} ONLY (ad/keyword REJECTED, 2 levels); geo = segments NOT selectable from entity resources at all — instead the geo VIEWS (geographic_view/user_location_view) expose ad_group.id, so geo's entity axis = add the entity id to the view query. THREE distinct shapes — never assume the device pattern generalizes.

GOOGLE ADS API COST/ACCESS (verified fact, Google docs 2026): the Google Ads API is FREE at all access levels including Standard (no charge). Standard Access = UNLIMITED ops/day; Basic = 15,000 ops/day. The entity-level query multiply (every breadth dim × every entity level = many per-grain queries) is constrained ONLY by Basic's 15k/day, which Standard removes at ZERO Google cost. Apply for Standard EARLY — the application backlog is weeks (Google acknowledged Feb 2026). Standard carries RMF (Required Minimum Functionality) requirements — review before applying. QUERY-COUNTING: one Search/SearchStream = 1 op regardless of rows returned; paginated next_page_token requests are NOT counted. So per-grain query count = ops; pagination is free.

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
| device         | meta     | account+campaign+ad_set+ad | raw (lower) | breakdowns=impression_device | ✅ LORAMER_META_DEVICE_BREADTH_V1; 4 levels; FLAG-NOT-BLOCK |
| device_platform| meta     | account+campaign+ad_set+ad | raw (lower) | breakdowns=device_platform   | ✅ LORAMER_META_DEVICE_BREADTH_V1; separate family; FLAG-NOT-BLOCK |
| age            | meta     | account+campaign+ad_set+ad | raw (lower) | breakdowns=age               | ✅ LORAMER_META_AGE_GENDER_BREADTH_V1; FLAG-NOT-BLOCK |
| gender         | meta     | account+campaign+ad_set+ad | raw (lower) | breakdowns=gender            | ✅ LORAMER_META_AGE_GENDER_BREADTH_V1; FLAG-NOT-BLOCK |
| age_gender     | meta     | account+campaign+ad_set+ad | composite   | breakdowns=age,gender → "<age>:<gender>" | ✅ LORAMER_META_AGE_GENDER_BREADTH_V1; the joint; FLAG-NOT-BLOCK |
| action_type    | meta     | account+campaign+ad_set+ad | raw (action string) | insights actions[]/action_values[]/cost_per_action_type/purchase_roas (RIDES+FIELD-WIDEN, NOT a breakdown) | ✅ LORAMER_META_ACTION_TYPE_TAXONOMY_V1 (T1.1); FULL taxonomy; conv=count, value=value, cost/ROAS→extra; WRITE-ONLY (non-partition, NEVER reconciled); drain 'meta_action_type' |
| video          | meta     | account+campaign+ad_set+ad | marker (value='') | insights video_* fields (FIELD-WIDEN, NOT a breakdown; arrays→.value — 8 COUNTS Σ, video_avg_time/cost_per_thruplay SINGLE-VALUE) | ✅ LORAMER_META_VIDEO_CAPTURE_V1 (T1.4); 10 DEDICATED COLUMNS (Layer-1, migration 023): video_plays/thruplays/p25-p100/30s/avg_time_sec/cost_per_thruplay; spend/impr/clicks/conv=0; WRITE-ONLY (non-partition, NEVER reconciled); drain 'meta_video' |
| geo_country    | shopify  | account      | iso       | ISO country code (shopify-metrics-row)|       |
| geo_region     | shopify  | account      | composite | "US-CA" (shopify-metrics-row)         |       |
| geo_country    | meta     | account+campaign+ad_set+ad | iso       | breakdowns=country (ISO "US"; missing→'UNKNOWN') | ✅ LORAMER_META_GEO_BACKFILL_V1 (T1.9); FLAG-NOT-BLOCK vs account spend (geo near-partitions; undetermined-geo residual flagged-not-dropped); drain 'meta_geo' |
| geo_region     | meta     | account+campaign+ad_set+ad | composite | breakdowns=country,region → "US-AL" (region NAME→ISO map, matches Shopify; unmapped intl→raw "US-&lt;name&gt;"+loud warn; missing→"&lt;cc&gt;-UNKNOWN") | ✅ LORAMER_META_GEO_BACKFILL_V1 (T1.9); FLAG-NOT-BLOCK; conversions=0 (L58); drain 'meta_geo' |
| hour           | meta     | account+campaign+ad_set+ad | raw (zero-padded "00".."23") | breakdowns=hourly_stats_aggregated_by_advertiser_time_zone | ✅ LORAMER_META_HOUR_V1 (T1.10); 4 levels (live-VERIFIED, not campaign-only); value "00".."23" (raw range in extra.hourRange); matches google-hour → 'hour' is one cross-platform dimension; FLAG-NOT-BLOCK vs account×day (hour partitions the day's spend); conversions=0 (L58); drain 'meta_hour' (15d) |
| conversion_action | google | campaign   | raw (action NAME) | intel.conversionsByCampaign (RIDES live-intel GAQL, no new call) | ✅ LORAMER_GOOGLE_CONV_ACTION_IS_PERSIST_V1 (T0.1); forward-persist; per-action conv/value + category(extra); WRITE-ONLY; history=T2.3 |
| impression_share  | google | campaign   | constant 'search' | intel.impressionShares (RIDES live-intel GAQL, no new call)      | ✅ LORAMER_GOOGLE_CONV_ACTION_IS_PERSIST_V1 (T0.2); forward-persist; 7 IS ratios in extra (count cols=0); WRITE-ONLY; campaign-only; history=T2.3 |
| age            | google | campaign + ad_group | enum name (mapped) | age_range_view (ad_group_criterion.age_range.type) | ✅ LORAMER_GOOGLE_DEMOGRAPHIC_CAPTURE_V1 (G-FILL#3, 2026-07-18); RESOLVES G3 (was fetched-then-dropped); 2 grains from ONE view fetch; FLAG-NOT-BLOCK vs per-day campaign anchor; criterion-id→enum map (503001→AGE_RANGE_18_24 … 503999→AGE_RANGE_UNDETERMINED, raw id in valueRaw); drain 'google_age' |
| gender         | google | campaign + ad_group | enum name (mapped) | gender_view (ad_group_criterion.gender.type) | ✅ LORAMER_GOOGLE_DEMOGRAPHIC_CAPTURE_V1 (G-FILL#3, 2026-07-18); MALE/FEMALE/UNDETERMINED (criterion ids 10/11/20→enum); FLAG-NOT-BLOCK; drain 'google_gender' |
| (base rows)    | all      | (native)     | sentinel  | —                                     | type='' value='' |

## 3. Mismatch resolutions (the inconsistency §7 names)

Query-layer queryBreakdown allowlist (LORAMER_QUERY_ALLOWLIST_BREADTH_V1, 2026-07-02) = {search_term, keyword, placement, age, gender, device, device_platform, hour, action_type, conversion_action, geo_country, geo_region}. BREAKDOWN_PLATFORM(1:1) is now BREAKDOWN_PLATFORMS(type→[platforms]) with BREAKDOWN_PRIMARY back-compat defaults. `variant` is a GRAIN via query_metrics level='variant' (not a breakdown_type). NON-additive impression_share + video = P1b (singleVal/extra path); money = P1c.

- ✅ RESOLVED 2026-07-02 (LORAMER_QUERY_ALLOWLIST_BREADTH_V1) — WRITTEN but NOT queryable → 'placement' (meta): canonical name = `placement`; the legacy read-name `publisher_platform` now ALIASES to `placement` (BREAKDOWN_ALIAS) so both resolve to the written rows (was returning 0). Gate-A: publisher_platform 0→19 values. No data migration.
- QUERYABLE but NOT written — 'age', 'gender' (meta). RESOLUTION: mark RESERVED (writer pending Phase 2). Do not delete from allowlist. Writers land as Phase-2 dimensions below.
- ✅ RESOLVED 2026-07-02 (LORAMER_QUERY_ALLOWLIST_BREADTH_V1) — CROSS-PLATFORM COLLISION (device/geo/hour exist on BOTH google AND meta): BREAKDOWN_PLATFORM(1:1) → BREAKDOWN_PLATFORMS(type→[platforms]). Resolution: an explicit platform must be in the list; omitted+single→that platform; omitted+multi→BREAKDOWN_PRIMARY back-compat default (geo_country/geo_region→shopify, preserving existing answers byte-identical) or a loud "pass platform" note (device/hour REQUIRE it — no historical default). Every metrics_daily row already carries platform → NO data migration. Gate-A: age + geo_country(shopify) byte-identical pre/post; device(meta)/hour(meta)/geo_country(meta) read back real rows; device w/o platform → loud note (never guesses).

## 4. Phase 2 dimension catalog (forward + backfill, one drain entry each)

Confidence: [VERIFIED in-code] = source field proven in the live fetcher. [VERIFY-AT-WRITER] = source field NOT yet confirmed against live API; confirm against current API docs when authoring that writer — do not assume field names.

### Google
All five VERIFIED dimensions are CAMPAIGN grain (corrected from the draft's ad_group — the proven live GAQL is FROM campaign). Google age & gender are TWO separate views (age_range_view, gender_view) → two breakdown_types, NOT a combined 'age_gender'.
| breakdown_type     | entity_level | encoding | source field            | confidence |
|--------------------|--------------|----------|-------------------------|------------|
| device  | campaign + ad_group + ad + keyword | raw (UPPER enum name) | segments.device, FROM campaign / ad_group / ad_group_ad / keyword_view | VERIFIED live — 4 entity grains (entity-level gap CLOSED). breakdown_type='device'. FLAG-NOT-BLOCK (partitions spend). OS/model NOT served (exception). See "Device" below. |
| hour               | campaign + ad_group | zero-padded int "00".."23" | segments.hour (+ segments.day_of_week → extra), FROM campaign AND ad_group | VERIFIED live 2026-06-24. See "Hour" below. breakdown_type='hour'; raw-int (NOT enum → UPPER rule N/A); dow name in extra only (derived from date, dropped from key). RECONCILE=FLAG-NOT-BLOCK (partitions spend). ad/keyword NOT served. |
| geo_* (FAMILY)     | campaign + ad_group | "geoTargetConstants/<id>" (+ ":<LOCATION_TYPE_UPPER>" on geographic_view grains) | per-grain segments across geographic_view + user_location_view, each at campaign + ad_group | VERIFIED live 2026-06-27 (probe). FULL family × 2 entity levels — see "Geo family" subsection below. RECONCILE=NONE (write-only, non-partitioning). raw opaque id, name resolution DEFERRED. |
| age                | campaign + ad_group | enum name (mapped) | age_range_view (campaign.id + ad_group.id) | ✅ SHIPPED 2026-07-18 (LORAMER_GOOGLE_DEMOGRAPHIC_CAPTURE_V1 + _BACKFILL_V1, G-FILL#3) — RESOLVES G3. History (pre-2026-07-15 note): age_range_view was FETCHED live for the Lora prompt (google-intelligence.ts:414-437) and DROPPED — zero rows ever landed (fetched-but-unpersisted = DEFECT per BEDROCK 4). Now persisted at BOTH grains from ONE view fetch. breakdown_value = canonical enum; GATE-A found .query() returns criterion IDs 503001..503999 → mapped to AGE_RANGE_* names (raw id kept in valueRaw). FLAG-NOT-BLOCK vs per-day campaign anchor (Σ==campaign ≤$0.01; PMax has no demo criteria → excluded from view AND anchor, no false flag). Forward cron/sync+catchup; drain 'google_age'. |
| gender             | campaign + ad_group | enum name (mapped) | gender_view (campaign.id + ad_group.id) | ✅ SHIPPED 2026-07-18 (same V1 as `age`, G-FILL#3) — RESOLVES G3 (was FETCHED-then-DROPPED, zero landed rows). breakdown_value = MALE/FEMALE/UNDETERMINED (GATE-A: criterion ids 10/11/20 → enum names). FLAG-NOT-BLOCK; drain 'google_gender'. |
| network            | campaign     | raw      | segments.ad_network_type | VERIFY-AT-WRITER |
| impression_share   | campaign     | constant 'search' | intel.impressionShares (search_* IS family, FROM campaign) | ✅ SHIPPED forward 2026-06-29 (LORAMER_GOOGLE_CONV_ACTION_IS_PERSIST_V1, T0.2) — RIDES the live-intel GAQL (ZERO new call); 7 IS ratios in extra, count cols=0; WRITE-ONLY (ratio, not a partition); campaign-only (ad_group/keyword IS = new fetch = T2); LIMIT-200 cap; HISTORY backfill = T2.3 (quota-gated) |
| conversion_action  | campaign     | raw (action NAME) | intel.conversionsByCampaign (segments.conversion_action_name/_category, FROM campaign) | ✅ SHIPPED forward 2026-06-29 (LORAMER_GOOGLE_CONV_ACTION_IS_PERSIST_V1, T0.1) — RIDES the live-intel GAQL (ZERO new call); per-action conversions/value, category in extra, spend/click cols=0 (segment carries no cost); WRITE-ONLY (Σ ≠ account; multi-action attribution); LIMIT-200 cap; HISTORY backfill = T2.3 (quota-gated) |
| video              | ad           | raw      | (video metrics)         | VERIFY-AT-WRITER |
| all_conversions    | campaign     | raw      | (all_conversions split) | VERIFY-AT-WRITER |

#### Hour (Google) — VERIFIED live 2026-06-24 (shipped full-family from scratch; was prompt-only before)
breakdown_type='hour'. Two entity grains, BOTH captured from the start (entity-level rule): campaign × hour
(entity_level='campaign') + ad_group × hour (entity_level='ad_group'). segments.hour + segments.day_of_week are
served FROM campaign + ad_group ONLY — ad_group_ad + keyword_view REJECT them (not-served exception, do not attempt).
- ENCODING: breakdown_value = ZERO-PADDED hour "00".."23" (raw int, lexically sortable; NOT an enum → the UPPER-name
  casing rule does NOT apply). day_of_week is CONSTANT per date (date → weekday derivable) → DROPPED from the key;
  its name (MON..SUN, from DayOfWeek enum 2=MON..8=SUN) is stored in extra.day_of_week for readability only.
- RECONCILE = FLAG-NOT-BLOCK vs the per-day campaign anchor (like device, NOT geo's write-only): hour PARTITIONS
  campaign spend — verified Σ hour == campaign total to the cent (Bath Fitter $2508.92, Veterinary $92.11). Both
  grains roll up to the campaign total. conversions never gate.
- One drain step 'google_hour' (both grains, default 365-day window — hour cardinality is bounded: entities × ≤24h).
- ⚠ HOUR "00" IS A GOOGLE CATCH-ALL (LORAMER_GOOGLE_HOUR0_NOTE_V1, 2026-07-02): Google buckets the FULL-DAY spend of campaigns without hourly segmentation (Display, some PMax) into segments.hour=0 — the DATA IS REAL and Σ24==campaign anchor reconciles to the cent, but hour 0 is INFLATED and is NOT genuine midnight activity. Verified Veterinary June: a Display campaign put $236.27 at hour 0 / $0.09 at all other hours, ~$8/day every day. query_breakdown(google,hour) attaches a note + the query_breakdown tool description caveats it, so Lora never presents hour 0 as a real dayparting peak or recommends a midnight bid-down. Do NOT "fix" by dropping the spend (breaks the reconcile) — it's an interpretation caveat, not a data error.

#### Device (Google) — 4 entity grains (entity-level gap CLOSED — backward sweep, live-confirmed 2026-06-24)
breakdown_type='device', breakdown_value = UPPER enum name (MOBILE/TABLET/DESKTOP/OTHER/CONNECTED_TV; int→name map).
segments.device is selectable FROM every entity resource → device is captured at ALL 4 grains (gap CLOSED):
- campaign × device  → entity_level='campaign', FROM campaign
- ad_group × device  → entity_level='ad_group', FROM ad_group, parent=campaign.id
- ad × device        → entity_level='ad',       FROM ad_group_ad (entity_id=ad_group_ad.ad.id), parent=ad_group.id
- keyword × device   → entity_level='keyword',  FROM keyword_view (entity_id=ad_group_criterion.criterion_id,
                       entity_name=keyword text), parent=ad_group.id
Device's second axis is ENTITY LEVEL, NOT a second resource (unlike geo's user_location_view) — the SAME
segments.device on each entity report. RECONCILE = PER-GRAIN: campaign/ad_group/ad = FLAG-NOT-BLOCK vs per-day
campaign anchor (they PARTITION spend; Gate A 0 flagged). keyword = WRITE-ONLY (keyword_view is a SEARCH-keyword
SUBSET — PMax/Display/Search-partner spend isn't keyword-attributed, so Σkeyword < campaign on mixed accounts;
Gate A: reconciling it flagged Veterinary 21/21 days = false noise). One drain step 'google_device' covers all 4
grains.
NOT SERVED (documented exception, NOT a gap): OS / OS-version / device-model as performance segments
(segments.operating_system_version_constant + segments.device_model both rejected as invalid on perf reports; the
operating_system_version_constant + mobile_device_constant resources are targeting-reference LOOKUP tables with no
metrics / no per-day performance). So device OS/model performance is genuinely uncapturable.

#### Geo family (Google) — VERIFIED live 2026-06-27
Geo is a FAMILY of grains captured PER-GRAIN (one GAQL per grain — co-selecting segments returns the
intersection and under-captures; proven: all-9 co-select = 0 rows, city+region = city-alone ≠ region-alone).
value = "geoTargetConstants/<id>" (raw opaque resource-name; country_criterion_id's bare id is normalized to the
same form). Name resolution DEFERRED (additive later layer; gates Lora-queryability). RECONCILE=NONE for every geo
grain at EVERY entity level (write-only — geo is non-partitioning).
- geographic_view (targeted/interest) — each grain APPENDS ":<LOCATION_TYPE_UPPER>" (2→AREA_OF_INTEREST,
  3→LOCATION_OF_PRESENCE, 1→UNKNOWN, 0→UNSPECIFIED): geo_city, geo_metro, geo_region, geo_state, geo_province,
  geo_county, geo_district, geo_postal, geo_most_specific (segments.geo_target_*) + geo_country
  (geographic_view.country_criterion_id). = 10 grains.
- user_location_view (PHYSICAL location, NO location_type, DIFFERENT ids): user_geo_city, user_geo_metro,
  user_geo_region, user_geo_state, user_geo_province, user_geo_county, user_geo_district, user_geo_postal,
  user_geo_most_specific. = 9 grains. (user_geo_country NOT served — geo_target_country not selectable on this
  view + no country field; the ONLY acceptable omission = platform genuinely doesn't serve it.)
- ENTITY-LEVEL axis (campaign-only gap CLOSED 2026-06-27): every geo grain captured at TWO entity levels —
  campaign (entity_level='campaign', byte-identical to the original) AND ad_group (entity_level='ad_group',
  entity_id=ad_group.id, parent=campaign.id). Mechanism = VIEW SUBDIVISION: add ad_group.id to the geo-view query
  (geo segments are NOT selectable from entity resources — proven REJECTED). ad × geo and keyword × geo are NOT
  served on either view (rejected both clients) = locked not-served exception. Third distinct entity-axis shape
  (device=segment-from-4-resources, hour=segment-from-2-resources, geo=view-subdivided-by-{campaign,ad_group}).
  ad_group multiplier 0.88–2.15× (varies: PMax campaigns have no ad_groups → ad_group < campaign).
- COST: 38 queries/lap (19 grains × 2 entity levels), one per grain×entity. Two drain steps: 'google_geo'
  (geographic_view) + 'google_user_geo' (user_location_view), both at GEO_WINDOW_DAYS=20 + 10-day fetch chunks.
- SIZING (heaviest = Veterinary nationwide, geographic 2-level, measured 2026-06-27): peak MEMORY scales with the
  WINDOW (V8 high-water), NOT chunk size (10-day vs monthly both ~830-860MB at 60d). Window=20d → ~544MB peak
  (under the 1024MB function default with margin) · ~42s lap · ~55 laps/step to floor. Volume is REAL (audited:
  most_specific 22,696 distinct geo ids/month, no duplication). impression-only rows (spend=0, impressions>0) are
  legitimate activity and ARE captured; truly-empty locations produce NO row (absence=zero, computed by Lora
  against the geo reference universe at read time, never stored).

### Meta
| breakdown_type     | entity_level | encoding | source field            | confidence |
|--------------------|--------------|----------|-------------------------|------------|
| age                | account + campaign + ad_set + ad | raw (lower) | breakdowns=age | ✅ SHIPPED 2026-06-28 (LORAMER_META_AGE_GENDER_BREADTH_V1) — 4 entity levels (Meta serves age at ALL four, probe+Gate-A proven; Σ age == account spend EXACT → FLAG-NOT-BLOCK partition). values: 18-24/25-34/35-44/45-54/55-64/65+/unknown (Meta "Unknown"→lower). conversions=0, never reconciled (L58). FLOOR=37mo (#3018 at 2023-05; reconciled exact at 2023-06/~36mo). |
| gender             | account + campaign + ad_set + ad | raw (lower) | breakdowns=gender | ✅ SHIPPED 2026-06-28 (LORAMER_META_AGE_GENDER_BREADTH_V1) — same 4 levels, FLAG-NOT-BLOCK. values: female/male/unknown. SEPARATE family from age (each its own partition). |
| age_gender         | account + campaign + ad_set + ad | composite | breakdowns=age,gender → "<age>:<gender>" (both lower, e.g. "25-34:female") | ✅ SHIPPED 2026-06-28 (LORAMER_META_AGE_GENDER_BREADTH_V1) — the JOINT (age×gender); ~20 combos; same 4 levels, FLAG-NOT-BLOCK. THREE separate families captured (age, gender, age_gender; never summed) — the cross is information-complete but age/gender stay first-class queryable. CORRECTS the prior "ad_set only / VERIFY-AT-WRITER" draft. |
| geo                | campaign     | composite| insights breakdown      | VERIFY-AT-WRITER |
| device             | account + campaign + ad_set + ad | raw (lower verbatim) | breakdowns=impression_device | ✅ SHIPPED 2026-06-28 (LORAMER_META_DEVICE_BREADTH_V1) — 4 entity levels (Meta serves device at ALL four, probe-proven; Σ device == account spend EXACT → FLAG-NOT-BLOCK partition). values: iphone/android_smartphone/ipad/android_tablet/desktop/other. conversions=0, NEVER reconciled (L58). FLOOR=37mo aggregate limit (assumed ~13mo breakdown floor REFUTED — served at 2023-06/~36mo, #3018 at 2023-05). |
| device_platform    | account + campaign + ad_set + ad | raw (lower verbatim) | breakdowns=device_platform | ✅ SHIPPED 2026-06-28 (LORAMER_META_DEVICE_BREADTH_V1) — SEPARATE breakdown_type family from 'device' (each its own clean partition; NEVER summed). values: desktop/mobile_app/mobile_web/unknown. Same 4 entity levels, FLAG-NOT-BLOCK, conversions=0. |
| hour               | account + campaign + ad_set + ad | raw (zero-padded "00".."23") | breakdowns=hourly_stats_aggregated_by_advertiser_time_zone | ✅ SHIPPED 2026-07-02 (LORAMER_META_HOUR_V1, T1.10) — VERIFIED live (Veterinary): ALL 4 entity levels serve the breakdown (draft "campaign-only" REFUTED). value = zero-padded leading hour of Meta's "HH:MM:SS - HH:MM:SS" advertiser-tz bucket (matches google-hour → 'hour' is ONE cross-platform dimension); raw range in extra.hourRange. FLAG-NOT-BLOCK vs account×day anchor: hour PARTITIONS the day's spend — Σhour==account $516.56 EXACT on finalized 2026-04-24 all 4 levels; recent days flag ~stale-anchor (6/30 $0.62/0.30%, hour-fetch more complete than the 2-day-old anchor). conversions=0, never reconciled (L58). floor36. drain 'meta_hour' (15d window, Gate-B tunable). |
| video              | ad           | raw      | video metrics           | VERIFY-AT-WRITER |
| ranking            | ad           | raw      | quality/engagement rank | VERIFY-AT-WRITER |
| action_type        | account + campaign + ad_set + ad | raw (action_type string) | actions[]/action_values[]/cost_per_action_type/purchase_roas/website_purchase_roas (insights &fields=, NOT a breakdown) | ✅ SHIPPED 2026-06-29 (LORAMER_META_ACTION_TYPE_TAXONOMY_V1, T1.1) — FULL taxonomy (live-probed Veterinary 2026-06-29: 36 action_types, cost_per_action_type 19). One row per (entity × action_type × day): conversions=count, conversion_value=value, cost_per_action_type + purchase_roas + website_purchase_roas in extra, spend/clicks/impr cols=0. RIDES-EXISTING + FIELD-WIDEN (no new calls, no row mult). WRITE-ONLY (non-partition; Meta conversions don't sum to account by dedup → NEVER reconciled). drain step 'meta_action_type' (30d window) → back-drains cohort to floor36 (Meta no quota). |

### GA / Shopify / Woo
- GA is account-only today. GA breadth needs a build-time DECISION (first-class session/user columns vs extra-jsonb) — deferred to the GA writer step (§7/§12). NEEDS-DECISION, not pre-judged here.
- Shopify geo_country/geo_region already persisted; further Shopify/Woo breadth catalogued at writer time.

## 5. Tracked follow-ups (NOT done in this step)

- ✅ DONE 2026-07-02 (LORAMER_QUERY_ALLOWLIST_BREADTH_V1) — Query allowlist read-name `publisher_platform`→`placement` (aliased) + re-keyed the allowlist on (platform, breakdown_type) for the cross-platform dims (§3); added device/device_platform/hour/action_type/conversion_action + Meta geo + `variant` (query_metrics level). IS/video→P1b, money→P1c. Live read-path; byte-identical on existing types (Gate-A).
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
