# LORAMER_CAMPAIGN_TYPE_DATA_MATRIX.md — which campaign types can produce which reporting rows
<!-- LORAMER_CAMPAIGN_TYPE_MATRIX_V1 -->

> ⛔ **NEW-DOC GATE: OVERRIDDEN EXPLICITLY BY RUSS**, 2026-08-01, by filename. Recorded because the
> default is refuse.
>
> **WHY THIS EXISTS.** The completion-claim gate judges every breakdown family against ACCOUNT-GRAIN
> SPEND. That is right for families every campaign type emits and wrong for families that depend on
> criteria or structures a campaign may not have. Foam OH spent $5,956.94 across 90 days on a
> Performance Max campaign; the gate saw an active account, demanded age/gender rows PMax cannot
> produce, and recorded a violation. A live probe on 2026-08-01 confirmed it: control day served,
> six test days inside the window served EMPTY with no refusal, and the campaign grain showed PMax
> for 90 of 91 days.
>
> ⛔ **VENDOR DOCS ARE QUOTED AND CITED. WHERE THEY ARE SILENT THIS DOC SAYS SILENT** rather than
> inferring from our own behaviour. Where a writer in this repo knows something the vendor does not
> publish, it is marked **OBSERVED-BY-US** and is not upgraded to a vendor fact.

---

## 1 · GOOGLE — WHAT THE VENDOR ACTUALLY PUBLISHES

**Source: <https://developers.google.com/google-ads/api/performance-max/reporting> — "Performance Max
reporting". Last updated 2026-07-22 UTC. Fetched 2026-08-01.**

- Verbatim: *"Querying resources such as `ad_group` or `ad_group_ad` won't return any data for your
  Performance Max campaigns."*
- Verbatim: Performance Max campaigns *"don't have standard `AdGroup` and `AdGroupAd` entities."*
- What the page lists as AVAILABLE for PMax: `campaign` · `performance_max_placement_view` ·
  `asset_group` · `asset_group_asset` · `asset_group_top_combination_view` ·
  `asset_group_product_group_view` · `shopping_performance_view` · `shopping_product` ·
  **`location_view`** (location targeting) · **`campaign_search_term_view`** (search terms).
- ⛔ **SILENT on age/gender.** The page does not mention demographic, age, gender or audience-segment
  reporting for Performance Max in either direction. It neither grants nor denies it.

### 1a · THE TWO FINDINGS THAT FALL OUT OF THAT PAGE, AND BOTH ARE OURS TO FIX
- **`ad_group` / `ad_group_ad` FOR PMAX — VENDOR-CONFIRMED CANNOT.** Our `google_adgroup_ad` step
  therefore CANNOT produce rows for a PMax-only window. 22 of the 51 baselined completion-claim
  violations are `google_adgroup_ad`, and the PMax-heavy clients are in that list.
- ⛔ **PMAX SEARCH TERMS ARE SERVED — BY A RESOURCE WE DO NOT QUERY.** Google says
  `campaign_search_term_view`; `src/lib/google-ads.ts:98-102` queries `search_term_view`. So a
  PMax-only window yields no search-term rows from our writer even though Google would serve them
  from the other resource. **That is a real capture gap, not only a misclassification** — and it is
  distinct from ★GOOGLE-SEARCH-TERM-FLOOR-RECOVERY, which is about depth, not about campaign type.

### 1b · THE MATRIX — CAN / CANNOT / PARTIAL, with the basis for each cell named
Legend: **[V]** vendor-published · **[O]** OBSERVED-BY-US, written in a writer and not published ·
**[S]** vendor SILENT and we have no observation either.

| resource / family | Search | Performance Max | Display | Shopping | Video | Demand Gen | App | Local Services |
|---|---|---|---|---|---|---|---|---|
| ad_group / ad_group_ad | CAN [S] | **CANNOT [V]** | CAN [S] | CAN [S] | CAN [S] | [S] | [S] | [S] |
| search_term_view | CAN [S] | **CANNOT [V]** — served via campaign_search_term_view instead | [S] | [S] | [S] | [S] | [S] | [S] |
| keyword_view | CAN [S] | CANNOT [O] | CANNOT [O] | [S] | [S] | [S] | [S] | [S] |
| age_range_view / gender_view | CAN [S] | **CANNOT [O]** — vendor SILENT | [S] | [S] | [S] | [S] | [S] | CANNOT [O] |
| geographic_view / user_location_view | CAN [S] | PARTIAL [V] — `location_view` is what the PMax page lists | [S] | [S] | [S] | [S] | [S] | [S] |
| device / hour segments | CAN [O] | [S] | [S] | [S] | [S] | [S] | [S] | [S] |
| impression_share | CAN [O] | [S] | [S] | [S] | [S] | [S] | [S] | [S] |
| asset-level (BEST/GOOD/LOW) | [S] | **CONTESTED** — see ★PMAX-ASSET-LABEL-CONTESTED | [S] | [S] | [S] | [S] | [S] | [S] |

⚠ **MOST OF THIS TABLE IS [S], AND THAT IS THE HONEST STATE.** Google publishes a PMax-specific
reporting page and essentially nothing equivalent per campaign type for the others. Filling those
cells would mean inferring from our own data, which is exactly what produced the misclassification
this doc exists to correct.

### 1c · WHAT OUR WRITERS ASSERT — RECONCILED AGAINST THE DOCS
- `google-demographic-backfill.ts:10` and `:148`, and `google-demographic.ts:21` — *"PMax has no
  demo criteria → excluded from both view + anchor"*. **OBSERVED-BY-US. The vendor page is SILENT.**
  The 2026-08-01 Foam OH probe is consistent with it — six empty days, no refusal, PMax-only window
  — but consistent-with is not proof, and one client is not the class. NO CONTRADICTION with the doc;
  the doc simply does not speak.
- `google-device.ts:70` — *"keyword_view = SEARCH-keyword SUBSET (PMax/Display/Search-partner spend
  isn't keyword-attributed)"*. **OBSERVED-BY-US**, vendor SILENT here.
- `google-adgroup-ad-backfill.ts:14` — *"Σad_group / Σad do NOT always equal account (PMax/Shopping…)"*.
  **AGREES WITH THE VENDOR**, and the vendor states it more strongly: not "may not sum" but "won't
  return any data".
- `google-hour.ts:9` — hour is served from `ad_group` but *"ad_group_ad and keyword_view REJECT them"*.
  **OBSERVED-BY-US**, vendor SILENT.
- ⛔ **NO WRITER CONTRADICTS A VENDOR STATEMENT.** Every campaign-type claim in our code is either
  agreed-with or unaddressed by the published docs. The one live contradiction in this repo is the
  PMax asset-label claim, which is tracked separately as ★PMAX-ASSET-LABEL-CONTESTED and is NOT
  resolved here.

---

## 2 · META — OBJECTIVE AND ADVANTAGE+ vs BREAKDOWNS

**Source: <https://developers.facebook.com/docs/marketing-api/insights/breakdowns/> — "Breakdowns".
Fetched 2026-08-01. No last-updated date displayed.**

- ⛔ **SILENT on campaign objective, optimization goal and standard Advantage+ status.** The page
  ties no breakdown's availability to campaign type. Stated as SILENT rather than inferred.
- The only Advantage+ reference is descriptive, not restrictive — verbatim: *"User segment (ex: new,
  existing) of Advantage+ Shopping Campaigns (ASC). Existing user is specified by the custom audience
  in ASC settings."*
- What the page DOES restrict is COMBINATIONS, verbatim: *"Due to storage constraints, only some
  permutations of breakdowns are available."* Named: `video_*` fields cannot be used with hourly
  stats breakdowns; `video_avg_time_watched_actions` cannot be used with region breakdown;
  `action_type` is implicitly added when `action_breakdowns` is unspecified.
- OBSERVED-BY-US, `meta-adset-ad-backfill.ts:26` — *"Meta has no PMax-style structural gap — every
  campaign exposes adsets and ads"*. Vendor SILENT; consistent with the absence of any restriction.
- ⚠ **meta_video (16 of the 51 baselined) is a CREATIVE-dependent family, not a campaign-type one.**
  An account running only image creative emits no video rows. The vendor does not frame this as a
  restriction because it is not one — there is simply nothing to report. Treat it as the same CLASS
  of misclassification with a different cause.

---

## 3 · ⛔ UNESTABLISHED — DO NOT PRESENT ANY OF THIS AS SETTLED

1. **Whether PMax truly serves no age/gender.** Vendor SILENT; our writers assert it; one probe on
   one client is consistent with it. The settling read is one GAQL for `age_range_view` on a
   PMax-only day for a client whose account was demonstrably delivering — cheap, not yet run.
2. **Every [S] cell in the matrix.** Display, Shopping, Video, Demand Gen, App and Local Services are
   largely unpublished per resource. We have not probed them.
3. **Whether `campaign_search_term_view` would recover PMax search terms for history we hold.**
   Google lists the resource for PMax; we have never queried it. Depth, retention and cost unknown.
4. **Whether Local Services campaigns produce any breakdown rows at all.** Champion and Ennis are
   both Local-Services-dominated in their claimed windows and hold nothing. Vendor docs for the API
   surface of Local Services campaigns were not fetched in this pass.
5. **The PMax asset-label question** — ★PMAX-ASSET-LABEL-CONTESTED, still contested, still excluded
   from Lora's prompt.

⛔ Where this doc says SILENT it means the vendor does not say, NOT that the answer is no.
