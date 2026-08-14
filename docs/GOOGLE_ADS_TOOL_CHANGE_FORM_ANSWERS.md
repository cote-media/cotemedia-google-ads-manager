<!-- QUEUE-EXEMPT: form-answers doc; Standard Access is tracked in QUEUE T3. -->
# Google Ads API — Tool Change Form answer pack

> ⚠ STATUS SUPERSEDED 2026-07-24 — read this pack as HISTORY (drafted 2026-06-10), NOT current status. Per Google's
> own reply email (2026-07-24), a Standard Access APPLICATION is SUBMITTED and PENDING (not granted; Google asked us
> to clarify the company website). The "we are NOT applying for Standard Access now — deferred" wording below was the
> 2026-06-10 plan and no longer holds. The live-status owner is LORAMER_DECISIONS.md (G7 entry); this doc is retained
> for the answer wording only.

Form: https://support.google.com/adspolicy/contact/tool_change
Purpose: update the developer token's permissible use to REPORTING + external
(client) access, reflecting LoraMer's evolution from an internal Cote Media tool
to an external SaaS. Read-only behavior is unchanged. Basic Access (15k ops/day)
covers the July 2026 invite-only cohort, so we are NOT applying for Standard Access
now — that is deferred to scale-time (the reusable Standard pack is at the bottom).

Status: drafted 2026-06-10 for Russ to review and submit himself. No submission by
Claude. Attach docs/GOOGLE_ADS_API_DESIGN.pdf at Q4.

----------------------------------------------------------------------
ANSWERS (paste verbatim)
----------------------------------------------------------------------

Q1 (checkbox — confirm ONLY after you've actually updated it in API Center):
  "My API contact email is up to date." → check it ONLY once you've set the API
  contact email in the Google Ads API Center to the address you use at Q7.

Q2 — Manager (MCC) account ID:
  <<RUSS: fill your Google Ads Manager account ID in XXX-XXX-XXXX format>>
  NOTE: this is not stored in our environment (the prod env var is empty / the
  local one is a placeholder), so it can't be auto-filled. Read it from the top-
  right of your Google Ads Manager account UI and enter it as XXX-XXX-XXXX.

Q3 — "What changes are you making to your tool?":
  LoraMer began as an internal Cote Media tool for reporting on our own agency's
  managed Google Ads accounts. It has since become LoraMer (https://loramer.com),
  an external SaaS business-intelligence platform for marketing agencies and
  business owners. The change we are making is to our permissible use: external
  customers now each authorize their OWN Google Ads accounts to LoraMer via Google
  OAuth (the adwords scope; our OAuth app verification for this sensitive scope was
  approved on 2026-06-10, GCP project savvy-palace-495920-v2). Our use of the API
  remains strictly READ-ONLY reporting — every call is a GAQL search via
  GoogleAdsService.Search, and there are zero mutate, create, update, or remove
  operations anywhere in the product. We read campaign, ad group, ad, keyword,
  search-term, conversion, audience, demographic, geographic, Performance Max, and
  recommendation reporting, render it in dashboards, and feed it to an AI analyst
  that writes performance summaries and optimization recommendations for the
  customer (advisory only — LoraMer never acts on the account). Accordingly, our
  permissible use should be REPORTING with external/client access. We are launching
  invite-only in July 2026 at low volume, well within Basic Access limits, so we are
  not requesting Standard Access at this time.

Q4 — Attach design document:
  Attach: docs/GOOGLE_ADS_API_DESIGN.pdf
  Absolute path on the MacBook Air:
  /Users/russcote2/Downloads/cotemedia-google-ads-manager/docs/GOOGLE_ADS_API_DESIGN.pdf
  (iMac path: /Users/russellcote/Downloads/cotemedia-ads-manager/docs/GOOGLE_ADS_API_DESIGN.pdf)

Q5 — "Is your tool accessible to people outside of your company?":
  Yes.

Q7 — Contact email:
  Replace the prefilled gmail address with the SAME address you set as the API
  contact email in the Google Ads API Center (e.g. hello@loramer.com or whichever
  you chose). The Q7 email and the API Center contact email must match.

----------------------------------------------------------------------
DEFERRED — Standard Access answer pack (reuse at scale-time; do NOT submit now)
----------------------------------------------------------------------
Apply in the Ads MCC API Center (tied to the developer token, NOT the GCP project).
Declare External + Reporting-Only permissible use. RMF (which only applies at
Standard) does NOT require write features for a reporting-only tool — it only
requires required default columns + a clearly-labeled export per displayed
hierarchy level (account/campaign/ad group/ad/keyword). Pre-submit audit: confirm
default columns + a labeled export exist for each level we display.

### Pre-submit audit — DEFAULT COLUMNS: done 2026-08-14 (LORAMER_RMF_REPORTING_DEFAULTS_V1)

⛔ SCOPE: LEGACY `/dashboard` ONLY — that is the surface a reviewer is given, because the demo/reviewer accounts sit
in the legacy cohort (`src/lib/legacy-cohort.ts`) and `requirePreviewUser()` redirects them off `-next`. The `-next`
surface has its OWN gaps (no status column at any level; keyword/search-term cards render one metric) and is a
SEPARATE queued flight. Do not read this audit as covering `-next`.

Required defaults now present, enforced by `tests/guards/rmf-reporting-defaults.guard.mjs` in `npm run guard`:
- R.10 Account — clicks · cost · impressions · conversions · **all_conversions** (new; summed from the campaign rows).
- R.20 Campaign — clicks · cost · **impressions** (was default-off) · conversions · **all_conversions** (new) · status
  (always-on; paused campaigns appear, REMOVED are filtered).
- R.40 Ad — clicks · cost · **impressions** (was default-off) · conversions · status (always-on).
- R.50 Keyword — keyword · match type · **status** (new column; the field was already selected and silently dropped by
  the mapper) · clicks · cost · **impressions** (was default-off) · **conversions** (was default-off) ·
  **first_page_cpc** + **first_position_cpc** (new).
- Date range on every level: Today / Yesterday / Last 7 / 14 / 30 (default) / This month / Last month / Last 90 /
  Custom. ⚠ The Keywords screen's picker was INERT until this flight — `/api/keywords` never forwarded `dateRange`.

⚠ TWO HONEST CAVEATS TO CARRY INTO THE SUBMISSION, both measured, neither papered over:
1. `first_page_cpc` / `first_position_cpc` are SELECTABLE on google-ads-api v23 and the live API accepts them, but
   returned NULL on **293 of 293 rows across two live accounts** (3699173394 and 2102961791, 2026-08-14). The columns
   exist and render an em dash. That is Google's data, not a capture defect — but a reviewer WILL see two empty
   columns, so do not let the screencast imply otherwise. `quality_score` is likewise sparse: 33/200 on one account,
   0/93 on the other.
2. ⛔ **THE EXPORT HALF OF RMF IS STILL UNMET.** This audit closed the default-columns half only. There is NO
   clearly-labeled export on ANY reporting level in legacy — the only download in the whole surface is a chat
   transcript (`downloadChat`). Tracked as ★RMF-EXPORT-PER-LEVEL; it must land before submission.

- Tool type: Reporting-only, external/third-party SaaS.
- Permissible use: Reporting (read-only). Keep stated use aligned with actual
  methods — do not list ad management we don't perform.
- Description: reuse Q3 above (it already states the model, read-only nature, and
  resources).
- Collateral: reuse docs/GOOGLE_ADS_API_DESIGN.pdf; provide demo sign-in access
  (external tool requirement); a screencast of the reporting dashboards is commonly
  requested — reuse the OAuth consent-flow footage and extend it to show the
  reporting screens.
- Volume: Basic = 15k ops/day; Standard = unlimited. Apply for Standard only when
  approaching the Basic ceiling. Expect a review backlog (acknowledged by Google in
  early 2026); never gate a launch on Standard approval.
- Account-owner-only (Russ): API Center status check (Basic vs Test), set/verify
  API contact email, link managed accounts, advertiser verification, submit, provide
  demo sign-in creds.
