# LoraMer Security Posture (audit 2026-06-29)

STATUS: current-state MAP from the 2026-06-29 read-only security audit. PROGRESS 2026-06-29 (LORAMER_SAFE_SECURITY_FIXES_V1):
FIX 1 (remove /api/test) CODE-RESOLVED; FIX 2 (NEXTAUTH_SECRET) + FIX 3 (demo@ MCC) = RUSS CONSOLE ACTIONS pending
(exact steps in §7); the refresh-token-in-session + token-column-encryption items remain the POST-META auth-path flight
(they touch the live reviewer auth — not a casual edit). This doc is the system-of-record; re-audit on any auth/route/
token change. Multi-tenant app holding 18+ clients' Google/Meta/Shopify/GA OAuth tokens + Stripe + ad data.

## 0. One-line posture
The wall is APP-LAYER ownership gates (resolveAccess / userOwnsClient / inline user_email), NOT RLS (inert for the
service-role paths that carry 100% of app data). No truly-UNGATED route returns cross-tenant data. The notable
exposures: a browser-reachable Google refresh token, plaintext OAuth-token columns, and a leftover token-debug route.

## 1. Route auth (80 routes under src/app/api) — by gate class
- OWNER-GATED (inline clients.eq(id).eq(user_email)→404): chat · insight · intelligence · clients/metrics ·
  clients/connections · context · knowledge · upload · shopify/daily · backfill/status. ✓
- resolveAccess (owner+member): next/{card-breakdown,client-metrics,client-timeseries}. ✓
- Owner-scoped aggregation (listAccessibleClients from the session): next/{portfolio-metrics,clients}. ✓
- user_email-scoped reads (return only caller's rows): conversations · memory(/bootstrap) · meta/{campaigns,daily,debug}
  · woocommerce/daily · billing/* · clients · clients/profiles · welcome. ✓
- CRON_SECRET-gated: all /api/backfill/* + /api/cron/{sync,catchup,drain,status} + query-metrics. ✓
- Webhooks signature-gated: shopify/webhooks (HMAC vs raw body) · stripe/webhook (constructEvent) ·
  meta/data-deletion + meta/deauthorize (signed_request). ✓
- SOFT-SPOTS (bounded, not open holes):
  - LIVE-DATA routes (campaigns · daily · keywords · google/ads · google/adgroups(/daily) · ga/daily · ga/properties
    · meta/{ads,adsets,campaigns,daily,debug} · platform): session-gated, fetch via the CALLER'S OWN token, but the
    accountId is NOT bound to an owned client (#18). Bounded by token scope; an MCC identity (cote@, demo@) can read
    any MCC-child accountId.
  - query-metrics + backfill: CRON_SECRET-ONLY (no owner gate, #19) — a CRON_SECRET leak = cross-tenant read.
  - next/layouts (POST): VIEWER-keyed, no resolveAccess on the clientId for a client-scoped save (low harm).
  - /api/test: session-gated but mints + RETURNS the caller's Google access token (debug; own-token).

## 2. Secrets — storage + blast radius
- Git: only .env.example tracked — NO real secret in the repo. ✓
- Client bundle: NEXT_PUBLIC_* = SUPABASE_ANON_KEY + SUPABASE_URL + a UI flag only — no secret-ish leak. ✓
- Server-side env (Vercel): SERVICE_ROLE_KEY · GOOGLE_ADS_DEVELOPER_TOKEN · GOOGLE_CLIENT_SECRET ·
  GOOGLE_ANALYTICS_CLIENT_SECRET · META_APP_SECRET · SHOPIFY_CLIENT_SECRET · STRIPE_SECRET_KEY · STRIPE_WEBHOOK_SECRET
  · CRON_SECRET · ANTHROPIC_API_KEY · NEXTAUTH_SECRET · REVIEWER_LOGIN_TOKEN. None in the browser.
- BLAST RADIUS: SERVICE_ROLE_KEY = crown jewel (all data incl. plaintext tokens, bypasses RLS). CRON_SECRET = the
  only gate on the internal/cron routes. NEXTAUTH_SECRET = forgeable sessions if weak/unset (verify it in prod).

## 3. Platform OAuth token storage (highest-sensitivity)
- PLAINTEXT columns (NO app-level encryption — no crypto/pgcrypto/vault): google_tokens(refresh_token, access_token)
  · meta_tokens(access_token) · ga_tokens(access_token, refresh_token) · shopify_tokens(access_token, refresh_token)
  · woocommerce_tokens(consumer_key, consumer_secret). Keyed by user_email (owner).
- Protected today by Supabase at-rest encryption + access control + the service-role key + RLS-blocks-anon — NOT by
  app-side column encryption. A DB/service-role leak exposes EVERY tenant's ad-account tokens directly.
- Cross-tenant: token lookups are user_email-scoped; no app path returns another user's token. Only the service role reads all.

## 4. Tenant isolation
App-layer gates only: resolveAccess (owner via clients.user_email + member via client_members; FAIL-CLOSED to null),
userOwnsClient (owner-only), inline user_email, listAccessibleClients (owner+member). Lora's clientId is server-injected
(not model-supplied). No bypass found in gated routes; the one soft spot is the #18 live-data accountId (token-bounded).

## 5. Session / auth model
NextAuth JWT (no DB adapter; encrypted-cookie sessions). Cookie flags = NextAuth defaults (httpOnly · secure prod ·
sameSite lax). Providers: Google OAuth (adwords scope, offline) + 2 CredentialsProviders — 'reviewer-token' (shared
REVIEWER_LOGIN_TOKEN → demo/reviewer account) + 'shopify-install' (signed JWT). No admin/escalation role.
⚠ session.refreshToken = the Google REFRESH TOKEN is placed on the session → served to the browser via /api/auth/session
(useSession is on 4 pages). Own-token (not cross-tenant), but a persistent adwords-scope credential in the browser.

## 6. RLS reality check
RLS is ENABLED on tables but INERT for the app: all data flows through supabaseAdmin (service role) which BYPASSES RLS,
and no Supabase JWT is ever issued (NextAuth ≠ Supabase auth). The app-layer gates are the entire wall — and the app
correctly does NOT lean on RLS anywhere. RLS DOES block the browser anon key (no policies → 0 rows). The anon createClient
export (supabase.ts:8) is DEAD (imported nowhere). next@14.2.3 is behind the 14.2.x security line (CVE-2025-29927 N/A —
no middleware auth); upgrade fast-follow.

## 7. GAP LIST
LAUNCH-CRITICAL (pre-7/14) — 1 of 4 code-resolved 2026-06-29; 2 await Russ console actions; 1 is post-Meta:
1. [POST-META] Google refresh token in the browser session — remove session.refreshToken from the NextAuth session
   callback; live routes read DB google_tokens / getToken() server-side. Touches the LIVE reviewer auth path → sequence
   post-Meta / with extreme care, NOT a casual edit.
2. [RUSS CONSOLE ACTION] Revoke demo@'s MCC access (widens #18 to all MCC-child accounts). NO code wiring grants it —
   demo@loramer.com is just the Meta-reviewer LOGIN; the access (if any) is a Google Ads MCC user grant. STEPS: Google
   Ads → open the agency MANAGER (MCC) account (GOOGLE_ADS_MANAGER_ACCOUNT_ID) → Admin → Access and security → Users →
   find demo@loramer.com (or any non-agency/test Google account) → ⋮ → Remove access. This does NOT affect the Meta
   review (demo@ reviews Meta, not Google). Structural follow-up (fast-follow CODE): bind accountId→owned-client on the
   live-data routes (#18) so MCC membership alone can't read children.
3. [DONE 2026-06-29] Remove /api/test — the prod Google-token-debug endpoint (minted a Google access token from the
   session refresh token + queried the MCC). Route DELETED (confirmed unreferenced; not the reviewer path). tsc green.
4. [RUSS CONSOLE ACTION] NEXTAUTH_SECRET — CODE CONFIRMED FAIL-CLOSED: authOptions sets no `secret:` field and has NO
   insecure fallback (no `|| 'default'`), so NextAuth reads process.env.NEXTAUTH_SECRET and THROWS in production if it
   is unset (no silent default). ACTION: confirm it is set + strong in Vercel (Project → Settings → Environment
   Variables → NEXTAUTH_SECRET, Production scope). To rotate: `openssl rand -base64 32` → paste as the new value →
   redeploy. Rotating LOGS EVERYONE OUT (everyone re-logs-in) — acceptable pre-launch. Never commit the value anywhere.

FAST-FOLLOW (hardening):
5. Encrypt the OAuth-token columns at rest with an app-side key (the single highest-value hardening for this app).
6. Bind accountId→owned-client on the live-data routes (#18).
7. query-metrics + /api/backfill/* are CRON_SECRET-only (#19) — keep CRON_SECRET tight/rotated; consider an owner gate.
8. Extract ONE assertOwnsClient helper, route all gated endpoints through it; delete the dead anon export / de-alias.
9. Rotate/disable the reviewer-token credential login after Meta + Shopify review.
10. resolveAccess on next/layouts client-scoped saves; align Lora's owner-only gate with resolveAccess (member access).
11. Upgrade next 14.2.3 → latest 14.2.x.
