# Google Ads API — Tool Change Form answer pack

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
