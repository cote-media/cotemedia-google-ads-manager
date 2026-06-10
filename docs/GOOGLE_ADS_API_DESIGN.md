# LoraMer — Google Ads API Design & Usage

Prepared for the Google Ads API Tool Change Form (permissible-use update).
Last updated: 2026-06-10.

LoraMer (https://loramer.com) is a business-intelligence platform for marketing
agencies and business owners. It connects each customer's own advertising and
analytics accounts and turns the data into dashboards and AI-generated
recommendations. This document describes how LoraMer uses the Google Ads API.


## 1. Summary

- Access model: external SaaS. Each customer authorizes their OWN Google Ads
  account(s) to LoraMer via Google OAuth (scope
  https://www.googleapis.com/auth/adwords). OAuth app verification for this
  sensitive scope was APPROVED 2026-06-10 (GCP project savvy-palace-495920-v2).
- API usage: strictly READ-ONLY reporting. Every call is a GAQL search via
  GoogleAdsService.Search (the google-ads-api client's customer.query method),
  plus one read-only diagnostic that calls googleAds:search over REST. There are
  ZERO mutate / create / update / remove operations anywhere in the codebase.
- Permissible use requested: REPORTING, with external (client) access.
- Launch posture: invite-only founding cohort, July 2026. Low daily operation
  volume, comfortably within Basic Access limits. Standard Access is deferred to
  scale-time and is not requested now.


## 2. Origin and the change being made

LoraMer began as an internal Cote Media (a marketing agency operating since 2011)
tool for reporting on the agency's own managed Google Ads accounts. It has evolved
into LoraMer, an external SaaS product where third-party customers connect their
own Google Ads accounts. The Tool Change Form updates the developer token's
permissible use from internal to external (client) access, in the REPORTING
category, to reflect this. The API behavior itself is unchanged and remains
read-only.


## 3. Data flow

1. A customer signs in to LoraMer with Google and authorizes the `adwords` scope
   for their own Google Ads account(s) (Google OAuth / NextAuth).
2. LoraMer stores the resulting refresh token (per customer) and reads it server-
   side to mint short-lived access tokens. The agency Manager (MCC) account is
   passed as `login_customer_id` so the API call is made in the customer's context.
3. For each request, LoraMer issues GAQL reporting queries (GoogleAdsService.Search)
   for the requested account, date range, and metrics.
4. Results are rendered in dashboards and fed to an AI analyst (Anthropic Claude)
   that produces written performance analysis and optimization recommendations.
   Recommendations are advisory only; LoraMer does NOT act on the account.
5. A nightly job optionally captures account/campaign-level daily totals into a
   historical store so customers can see period-over-period trends from connect-day
   forward. This is also read-only reporting.

No campaign, budget, bid, keyword, asset, or any other entity is ever created,
edited, paused, or removed through the Google Ads API.


## 4. API surface used (reporting resources)

All of the following are SELECT-only GAQL reporting queries (GoogleAdsService.Search):

- customer, customer_client (account discovery under the Manager account)
- campaign, ad_group, ad_group_ad (performance by level)
- keyword_view, search_term_view (keyword and search-term reporting)
- conversion_action (conversion definitions / counts)
- audience_view, age_range_view, gender_view (audience & demographic reporting)
- ad_group_ad_asset_view (RSA asset reporting)
- asset_group, asset_group_asset, asset_group_top_combination_view (Performance Max
  reporting)
- geographic_view (geographic performance)
- recommendation (read-only retrieval of Google's recommendations for display;
  recommendations are NOT applied)

Methods used: GoogleAdsService.Search only (GAQL). No GoogleAdsService.Mutate, no
service-level mutate (CampaignService, AdGroupService, etc.), no account creation,
no user management, no billing operations.


## 5. Security posture

- Credentials (developer token, OAuth client secret, per-customer refresh tokens)
  are stored as server-side environment variables / encrypted database rows and are
  never exposed to the browser. All Google Ads API calls are made server-side.
- OAuth refresh tokens are scoped to `adwords` only (plus basic OpenID profile for
  sign-in). No broader Google scopes are requested.
- Read-only by construction: there is no code path that performs a write, so a
  compromised session cannot mutate a customer's Google Ads account through LoraMer.
- Per-customer isolation: each customer's data is keyed to their account and only
  returned to that customer's authenticated session.
- Customers can disconnect at any time, which removes LoraMer's stored tokens.


## 6. Volume and access level

- Reporting refreshes are cached (~15 minutes), so repeated views do not re-query.
- At the July 2026 invite-only launch the operation volume is well within Basic
  Access (15,000 operations/day). Standard Access (unlimited) is a scale-time item
  and is not requested in this change.


## 7. Roadmap note (not part of this request)

Write / ad-management features (applying recommendations, keyword and negative-
keyword changes) are on LoraMer's longer-term roadmap. They are NOT built today and
are NOT covered by this request. When such functionality is implemented and
demonstrable, LoraMer will separately update its permissible use and apply for the
appropriate access at that time. The present request covers reporting-only use.
