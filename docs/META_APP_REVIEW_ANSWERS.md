<!-- QUEUE-EXEMPT: Meta app-review form answers (submission doc), not a build plan. -->
# Meta App Review — answer pack (`ads_read`)

> ⚠ ARCHIVED / HISTORICAL RECORD — Meta App Review was APPROVED 2026-07-02. This is the submitted answer pack, kept for the record. There is NO active Meta review, no reviewer path, no reviewer-driven hold; blast radius on shared surfaces is about BLAST RADIUS ALONE (see LORAMER_DECISIONS "META APP REVIEW — APPROVED"). The data-deletion/deauth callback referenced below is a permanent PRODUCTION requirement, not a review artifact.

Where: Meta App Dashboard → App Review → Permissions and Features → request
`Ads Read` (and see the SCOPE DECISION below re: `business_management`).
Purpose: get the permissions approved + flip the app Development → Live so the
July 2026 founding cohort can connect their Meta ad accounts. Behavior is
strictly READ-ONLY (reporting), unchanged.

Status: drafted 2026-06-11 for Russ to review and submit himself. No submission
by Claude. Prereqs already cleared: Tech Provider (2026-06-09), Business
verification (Cote Media, business_id 778546245572025), Access verification
(DONE), compliance Phases 1+2 (deauthorize + data-deletion endpoints LIVE and
registered 2026-06-07).

This pack mirrors docs/GOOGLE_ADS_TOOL_CHANGE_FORM_ANSWERS.md in tone and intent.

----------------------------------------------------------------------
⚠️ SCOPE DECISION — read before requesting anything (RUSS to decide)
----------------------------------------------------------------------
The connect flow currently requests THREE scopes, not one
(src/app/api/meta/auth/route.ts):

    scope = 'ads_read,ads_management,business_management'

- `ads_read` — REQUIRED. Every Insights/entity call is a read. This is the
  permission this pack justifies.
- `ads_management` — NOT USED. The product performs zero create/update/delete/
  mutate calls anywhere (verified across all src/app/api/meta/* routes and
  src/lib/intelligence/meta-intelligence.ts — all GETs). Requesting a write
  scope on a read-only tool invites a reviewer rejection ("why does a reporting
  tool need write access?") and would itself require Advanced Access + its own
  justification. RECOMMENDATION: drop it from the scope string before review.
- `business_management` — USED, and needed for the agency model. Account
  discovery (getAllMetaAccounts in api/meta/callback) enumerates Business
  Manager owned + client ad accounts via /me/businesses,
  /{biz}/owned_ad_accounts, /{biz}/client_ad_accounts — those require
  `business_management`. A single business owner connecting a directly-owned
  account via /me/adaccounts would work on `ads_read` alone, but agencies
  (the core cohort) need BM enumeration. RECOMMENDATION: request
  `business_management` in the SAME App Review submission as `ads_read`.

NET RECOMMENDATION: change the scope string to `ads_read,business_management`
(one-line edit, NOT done this session — no code changes were requested), and
submit App Review for BOTH `ads_read` and `business_management` together. Each
permission gets its own justification box; reuse the sections below for both.
If Russ prefers to keep the cohort to direct-owner connects only at launch,
`ads_read` alone is viable and `business_management` can be deferred — but then
agency BM connects won't enumerate accounts until it's approved.

----------------------------------------------------------------------
1. USE-CASE JUSTIFICATION (paste into the permission request box)
----------------------------------------------------------------------
What LoraMer is:
LoraMer (https://loramer.com, app at https://app.loramer.com) is a business-
intelligence platform for marketing agencies and business owners. Each customer
connects their own advertising and analytics accounts (Google Ads, Meta Ads,
Google Analytics, Shopify) and LoraMer renders unified performance dashboards
and an AI analyst that writes plain-language performance summaries and
optimization recommendations. It is reporting/analytics only — advisory, never
acting on the account.

Why we need `ads_read`:
We read each connected ad account's advertising performance to display it back
to the account owner and to ground the AI analyst's summaries. Specifically we
call the Marketing API (Graph API, read-only GET requests):
- `GET /me/adaccounts` and (for agencies) `GET /me/businesses`,
  `GET /{business-id}/owned_ad_accounts`, `GET /{business-id}/client_ad_accounts`
  — to let the user pick which ad account to connect.
- `GET /act_{ad-account-id}/insights` at the account, campaign, ad set, and ad
  levels — fields: spend, clicks, impressions, ctr, reach, frequency, actions,
  action_values, conversions; with breakdowns publisher_platform,
  platform_position for placement reporting.
- `GET /act_{ad-account-id}/campaigns`, `/adsets`, `/ads` — names, status,
  effective_status, objective, bid strategy, budget, targeting summary, and
  creative metadata (headline/body/CTA/image/video id) for context.
- `GET /me?fields=id` — at connect time only, to store the app-scoped user id
  used by our deauthorize/data-deletion callbacks.

Read-only launch posture:
LoraMer makes zero write calls to the Meta API — no create, update, delete, or
mutate operations exist anywhere in the product. Launch posture is read-only
reporting.

How data is stored:
The user's long-lived access token is stored server-side in Supabase
(`meta_tokens`, scoped to the LoraMer login, never exposed to the browser).
Fetched metrics are written as per-day rows in `metrics_daily` (spend,
impressions, clicks, conversions, conversion value) for historical charts;
live dashboard reads are cached ~15 minutes. We store performance metrics and
entity metadata only — no personal data of end users of the advertiser.

How deauthorization and data deletion are honored:
- Deauthorize callback: POST https://app.loramer.com/api/meta/deauthorize —
  on app removal we delete our stored token and the user's Meta connections
  (LIVE, signature-verified).
- Data deletion callback: POST https://app.loramer.com/api/meta/data-deletion —
  on a deletion request we delete all Meta-sourced data for that user
  (metrics_daily Meta rows, sync cursors, cached intelligence, connections, and
  the token), and return Meta's required { url, confirmation_code }. A public
  status page resolves the code at
  https://app.loramer.com/meta/deletion-status?code=...
Both callback URLs are registered in the App Dashboard (Facebook Login for
Business). Verified end-to-end with valid/invalid signed_request signatures.

----------------------------------------------------------------------
2. REVIEWER TEST INSTRUCTIONS (paste into "Instructions for testing")
----------------------------------------------------------------------
LoraMer is at https://app.loramer.com. Sign in with the test credentials in the
"Test credentials" field (Google sign-in).

1. After sign-in you land on the workspace at https://app.loramer.com/clients,
   which lists client workspaces as cards.
2. On the target client card, find the connection pills row and click the
   "+ Meta" pill. This starts Facebook Login for Business (the OAuth dialog
   requesting Ads Read).
3. Authorize with the Facebook account provided in the test credentials, then
   choose the ad account to connect in the "Connect Meta Ad Accounts" picker.
4. The Meta pill on the card turns blue ("Meta"). Click it to open the
   dashboard on the Meta tab.
5. On the dashboard you will see Meta data populated from `ads_read`: spend /
   clicks / impressions / CTR / conversions summary cards, a daily trend chart,
   and a campaign / ad set / ad breakdown — all read from the connected ad
   account's Insights.
6. (Optional) Open "Ask Lora" and ask "How did Meta perform last 30 days?" — the
   AI analyst answers from the same read-only Meta data.

To revoke: remove the LoraMer app from the Facebook account's Business
Integrations settings — our deauthorize callback fires and the connection
disappears in LoraMer.

----------------------------------------------------------------------
3. REVIEWER TEST CREDENTIALS  ⚠️ GAP — RUSS MUST PROVISION
----------------------------------------------------------------------
LoraMer login (exists):
  demo@loramer.com — provisioned 2026-06-10 as the reviewer demo account
  (tier beta_unlimited, welcome gate pre-cleared). Password: <RUSS: provide>.

WHAT EXISTS:
  - demo@ can sign in and reach /clients.
  - demo@ has a GOOGLE connection (client "Influential Drones"). It does NOT
    have any Meta connection.

WHAT IS MISSING (must be provisioned before submitting):
  a) A FACEBOOK identity the reviewer can authorize with — the "+ Meta" flow is
     Facebook Login, not the demo@ Google login. Options:
       • A dedicated Facebook test user (App Dashboard → Roles → Test Users)
         that has a role on a Meta ad account with real spend history; OR
       • A real Facebook login Russ controls, with access to one Meta ad
         account that has live data, supplied as reviewer credentials.
  b) That Facebook account must have access to at least ONE Meta ad account
     WITH non-zero spend in the last 30 days, so step 5 shows populated cards
     and charts (an empty account makes the read look broken).
  c) APP MODE: the app is currently in Development. In Development mode only
     app Admins/Developers/Testers can complete the flow. Either add the
     reviewer's Facebook account as a Tester, or rely on the screencast +
     provided test user — confirm Meta's current reviewer requirement when
     submitting. (The app flips to Live only AFTER approval — see section 5.)

DECISION FOR RUSS (the demo Meta ad account question):
  Which Facebook identity + which Meta ad account (with live spend) will the
  reviewer use? Recommended: create a Facebook Test User, give it a role on one
  Cote Media client ad account that has recent spend (e.g. the account used in
  the Meta backfill verification), and list that test user + the demo@loramer.com
  Google login as the two credentials. Fill both into the App Review credential
  fields before submitting.

----------------------------------------------------------------------
4. SCREENCAST SHOT LIST (record in this order)
----------------------------------------------------------------------
Record one continuous screen capture matching section 2 exactly. Narrate or
caption each step. Use the same test credentials you submit.

  1. Browser at https://app.loramer.com — click Sign in, complete Google
     sign-in as demo@loramer.com. Land on /clients (show the client cards).
  2. On the target client card, point to the connection pills; click "+ Meta".
  3. The Facebook Login for Business dialog appears — show it clearly listing
     the requested permission(s) (Ads Read). Authorize with the test Facebook
     account.
  4. Back in LoraMer: the "Connect Meta Ad Accounts" picker — select the ad
     account; show it attaching to the client.
  5. The Meta pill turns blue. Click it → dashboard opens on the Meta tab.
  6. Show the populated Meta data: summary cards (spend / clicks / impressions /
     CTR / conversions), the daily trend chart, and the campaign/ad set/ad
     breakdown. Hold long enough to read the numbers.
  7. (Optional but persuasive) Open "Ask Lora", ask "How did Meta perform last
     30 days?", show the read-only AI summary.
  8. (Optional) Show revocation: Facebook → Settings → Business Integrations →
     remove LoraMer → return to LoraMer and show the Meta connection gone
     (demonstrates the deauthorize callback).

Keep it tight (2–4 min). Make sure real numbers are visible — reviewers reject
screencasts where the requested permission's data never appears on screen.

----------------------------------------------------------------------
5. POST-APPROVAL CHECKLIST
----------------------------------------------------------------------
  [ ] Confirm `ads_read` (and `business_management` if submitted) show
      "Approved" / "Advanced Access" in App Review.
  [ ] (If the scope edit was made) confirm the live scope string matches what
      was approved — request only approved scopes.
  [ ] Flip the app Development → Live (App Dashboard → top toggle). Requires a
      completed Privacy Policy URL, Data Deletion URL, and category — all
      already set.
  [ ] Verify as a FRESH EXTERNAL USER (not an app admin/tester): from a clean
      browser, a non-Test Facebook account completes "+ Meta" connect and sees
      live data. In Development mode this would have failed for a non-tester;
      Live mode is what proves the cohort can actually connect.
  [ ] Re-run the deauthorize + data-deletion path once on a real external
      connection to confirm both callbacks still fire post-Live.
  [ ] Update CONTINUE_HERE.md / ROADMAP: Meta connect unblocked for the cohort.

----------------------------------------------------------------------
GAPS / OPEN QUESTIONS (surface to Russ)
----------------------------------------------------------------------
1. SCOPE: the live OAuth request is `ads_read,ads_management,business_management`.
   Drop `ads_management` (unused write scope) and decide whether to include
   `business_management` (needed for agency BM enumeration) in this submission.
   This is a one-line code edit — NOT made this session.
2. DEMO META ACCOUNT: no Meta connection or Meta ad account exists for the
   reviewer path. Russ must provision a Facebook identity + a Meta ad account
   with live spend, and (Development mode) add it as a Tester. See section 3.
3. demo@loramer.com password is not in the repo — Russ supplies it in the
   credential field.
4. Confirm whether Meta currently wants the reviewer added as a Tester vs.
   relying on a Test User + screencast (their requirement wording shifts).
</content>
</invoke>
