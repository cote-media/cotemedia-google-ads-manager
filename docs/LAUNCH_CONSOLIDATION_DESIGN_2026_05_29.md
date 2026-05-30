# Launch Consolidation Design — How loramer.com + login + app become one product

*Filed end-of-day May 29, 2026. Strategic doc, NOT implementation. Russ sleeps on it; tomorrow we pick a direction.*

*Marker: LORAMER_LAUNCH_CONSOLIDATION_V1.*

---

## The question

Right now LoraMer lives in two places:

1. **loramer.com** — public marketing, waitlist, pricing, brand story. Just shipped tonight. Lives in `cote-media/loramer-landing` repo on a separate Vercel project.
2. **cotemedia-google-ads-manager.vercel.app** — the actual product. Has its own landing page that does sign-in (Google OAuth) and lands users in the dashboard. Lives in `cote-media/cotemedia-google-ads-manager` repo.

At launch, these need to be one experience: someone hits loramer.com, decides to sign up, signs in, and lands in their dashboard. The current state has the marketing site and the product site speaking past each other — different domains, different visual languages, no continuity.

There are two questions inside this one question, and they're worth separating:

- **The consolidation question:** what's the right route/domain/handoff between marketing and app at launch?
- **The login UX question:** is Google-only OAuth still the right door? It was great for the discovery moment (sign in with Google → all your ad accounts appear). It feels increasingly generic in 2026.

Russ noted: Google OAuth is "very good for important reasons (the oh wow moment when all of your clients are in), but seems outdated somewhat." Both halves of that statement are real.

---

## Part 1 — The consolidation question

### What we know

- loramer.com points at the loramer-landing Vercel project (apex, DNS-only at Cloudflare, Vercel-issued SSL)
- cotemedia-google-ads-manager.vercel.app is the production dashboard URL
- Cote Media owns both repos and both Vercel projects
- The dashboard has a `/login` route (NextAuth + Google OAuth) and a `/` route that's currently a separate landing page (where the agency/business paths were)
- The Shopify App Store-approved install flow exists and uses a different path (via /api/shopify/install)

### The target shape at launch

```
loramer.com/              → marketing (current loramer-landing)
loramer.com/login         → login / signup
loramer.com/signup        → optional, may collapse into /login
loramer.com/dashboard     → the actual app (current dashboard, behind auth)
loramer.com/clients       → also dashboard (one of many internal routes)
loramer.com/privacy       → legal (already exists in loramer-landing as of tonight)
loramer.com/terms         → legal (already exists)
loramer.com/api/*         → API routes — but WHICH project's API routes?
```

That last point is the architectural crux. The two projects each have their own `/api/*` routes (loramer-landing has `/api/waitlist`, the dashboard has dozens including `/api/intelligence`, `/api/chat`, `/api/google/*`, `/api/meta/*`, `/api/shopify/*`, etc.). Two projects, one domain, both want to own `/api/*`.

### Option A — Merge the two repos into one

Move loramer-landing's pages into the dashboard repo. One Vercel project. One codebase. loramer.com points at the unified Vercel project.

**Pros:**
- Single source of truth, no domain confusion
- /api/* routing is trivially clean
- Auth state, sessions, analytics tracking all unified
- One deploy pipeline

**Cons:**
- The cleanness we achieved tonight (marketing changes can't break the dashboard) goes away
- Every dashboard build now also builds the marketing site
- The marketing site loses its tiny ~17kB build size and inherits the dashboard's 3000+ line surface area
- All the work we did tonight (separate repo, clean Vercel project, isolated env vars) gets undone

**Realistic effort:** ~half day. Copy marketing pages into dashboard repo, update Tailwind config to merge tokens (already mostly aligned), wire up routes, redirect loramer-landing Vercel project to retire it, point loramer.com at the dashboard Vercel project, update env vars.

### Option B — Keep two projects, use Vercel's "rewrites" to make them feel like one

Marketing lives at loramer.com. Dashboard lives at app.loramer.com OR loramer.com/dashboard via Vercel rewrites that proxy specific paths to the dashboard project.

**Pros:**
- Keeps the separation (marketing changes don't risk the dashboard)
- Each project keeps its own deploy pipeline, env vars, build times
- Both projects continue to exist as standalone, only the public-facing URL is unified
- Rollback is trivial — turn off the rewrite, both projects keep working independently

**Cons:**
- Subdomain approach (app.loramer.com) is cleaner technically but means two different URLs for users — the marketing site at loramer.com and the app at app.loramer.com
- Path-based rewrites (loramer.com/dashboard → cotemedia-google-ads-manager.vercel.app/dashboard) are more complex to configure, can have edge cases (cookies, redirects)
- Auth/session handling across two domains needs careful work (CORS, cookie domains)

**Realistic effort:** ~1-2 days, depending on rewrite vs subdomain choice.

### Option C — Different routes, different projects, accept the visible URL change

loramer.com is marketing. app.loramer.com (or dashboard.loramer.com) is the app. No rewrites — just two distinct subdomains. Users SEE the URL change when they go from marketing to app.

**Pros:**
- Simplest infrastructure. Add a subdomain to the dashboard Vercel project, point app.loramer.com at it
- Standard SaaS pattern (Stripe does stripe.com vs dashboard.stripe.com; Notion does notion.so vs notion.com; many others)
- Each project stays clean
- No CORS gymnastics
- DNS work is minimal — add one CNAME record

**Cons:**
- Users SEE the URL change. Some find that disorienting
- Marketing analytics and product analytics don't naturally unify (need cross-domain tracking)
- The "feel like one product" goal is met by visual consistency, not URL consistency

**Realistic effort:** half a day. Add subdomain to dashboard Vercel project, configure DNS, update the login flow's redirects, update the marketing site's CTA links to point to app.loramer.com.

### Recommendation for Part 1

**Option C** — different subdomains for different concerns.

Reasons:
- Lowest infrastructure risk
- Industry standard (Stripe, Notion, Linear, Figma, etc.)
- Preserves the clean separation we earned tonight
- Doesn't undo any of today's work
- Each project's deploy pipeline stays simple
- Rollback is trivial (just point DNS elsewhere)
- The URL change from loramer.com → app.loramer.com is actually a feature, not a bug — it signals "you're inside the product now"

Option A's "merged repos" is conceptually clean but undoes today's separation work and creates a 3000-line monolith. Option B's rewrites are too clever for the value they bring.

---

## Part 2 — The login UX question

### What we know about the current login

- Sign in with Google (NextAuth)
- After Google OAuth, the app reads the user's Google Ads MCC account
- Every Google Ads account the user has access to becomes a candidate LoraMer client
- The user picks which accounts to add
- The "oh wow" moment: a user with 30 client accounts in Google Ads sees them all appear ready to use in seconds

That's a genuinely good moment. It's also genuinely Google-centric. A user who doesn't run Google Ads loses the magic entirely.

### What "outdated" probably means

The "Sign in with Google" button is the same button on every SaaS in 2026. It became table stakes around 2020. It's not bad — it's neutral. What's missing:

1. **It assumes Google is the right identity surface.** For an e-comm operator who lives in Shopify, Google login is the third or fourth-most-important platform. For an agency owner whose primary identity is Microsoft 365 or Okta, Google login is a personal account, not their professional one.
2. **The discovery magic happens at the door.** Users who sign in expecting magic and then have to MANUALLY connect Meta, Shopify, GA, etc. feel a downhill experience. Could the magic happen after signup too?
3. **It's the same as everyone else's door.** Stripe, Linear, Notion, Figma, Shopify itself — they all start with a similar OAuth chooser. The DOORWAY is generic. LoraMer's product is differentiated; its doorway could be too.

### Option A — Keep Google OAuth as primary, add email/password as secondary

The simplest evolution. Marketing CTA leads to /login. /login shows "Sign in with Google" as the primary, "Or sign in with email" as the secondary. Google still gives the oh-wow moment for users with Google Ads. Email/password is the door for everyone else, with the oh-wow happening post-signup when they connect platforms.

**Pros:** small change, preserves the strong path
**Cons:** doesn't address the "feels outdated" half of Russ's instinct

### Option B — "Sign in with [the platform that matters most to you]"

A literal multi-button login: "Sign in with Google" (for ad operators), "Sign in with Shopify" (for e-comm — already exists via the install flow, just expose it more prominently), "Sign in with Meta Business" (for Meta-heavy operators), plus "Or use email."

**Pros:**
- The discovery moment happens at the door, regardless of which door
- Aligns with the brand's "deep knowledge across every platform" promise
- Distinctive — no one else does this

**Cons:**
- More moving parts to support (each OAuth flow is its own bug surface)
- "Which platform should I sign in with?" is a decision the user has to make upfront — adds friction
- Shopify-signin would need cleanup (today the Shopify path goes through their App Store install flow, which is technically different from "sign in with Shopify")

**Realistic effort:** medium. Several days of OAuth wiring, plus the discovery flow for each platform.

### Option C — Email-first signup, discovery happens after

Standard SaaS pattern. Sign up with email/password. Then in onboarding, "Connect your first platform" with a beautiful animation as data flows in.

**Pros:**
- Most flexible
- The oh-wow moment becomes the FIRST onboarding step, which is dramatically powerful when done well
- Email/password works for everyone, regardless of which platform they use

**Cons:**
- Loses the "click one button, see everything" moment we have today
- Two steps to value instead of one
- Loses some of the trust-by-association that "Sign in with Google" provides

### Option D — Keep the Google magic, frame it differently

What if Sign in with Google isn't a login mechanism — it's an ANALYSIS mechanism. Pitch: "Sign in with Google to see your accounts instantly" — even if you eventually use email/password for your account. Two flows: (a) Google OAuth as the discovery+signup fast path, which creates an email-password account behind the scenes. (b) Email/password for users who don't want Google in the loop. The Google flow doesn't change — but its FRAMING does. Less "sign in with Google because you must" and more "let Google introduce us to your accounts."

**Pros:**
- Preserves the magic
- Doesn't feel like Google is the only way in
- Brand-distinctive framing

**Cons:**
- Requires careful UX writing to land the framing without being confusing
- Behind the scenes it's still the same OAuth — just relabeled

### Recommendation for Part 2

**Probably Option D, with Option A as the minimum viable evolution.**

The instinct that Google OAuth feels outdated is real, but the magic is too valuable to throw away. Option D preserves the magic and updates the framing. It's smaller than Option B (much less new OAuth wiring) and more distinctive than Option A.

If short on time at launch, ship Option A (Google OAuth + email/password). Reframe later toward D.

The Shopify signin angle (Option B) is real and might emerge naturally from the existing Shopify App Store install flow — users can already get into LoraMer via Shopify; we just don't surface that as "sign in with Shopify" on the marketing page. Worth exposing prominently regardless of which option we pick.

---

## Part 3 — Sequencing and what blocks what

The two questions interact but are independently sequenceable. Recommendation:

### Sequence A — Consolidation first, login second (recommended)

1. **Phase 1:** Set up app.loramer.com pointing at the dashboard Vercel project. DNS work + Vercel domain config. ~half day. Login still works at app.loramer.com/login. Marketing still lives at loramer.com.
2. **Phase 2:** Update all marketing CTAs and links to point at app.loramer.com/signup (instead of cotemedia-google-ads-manager.vercel.app). Trivial.
3. **Phase 3:** Visual harmonization of the dashboard's login page. It currently uses font-mono and gray styling; should match the new marketing site (Georgia + ink/paper/accent palette). Half day of styling.
4. **Phase 4:** Login UX evolution (Option A baseline: Google OAuth + email/password). Real work — auth flows, signup forms, email verification. 1-2 days.
5. **Phase 5 (later):** Login framing evolution toward Option D — repositioning Google OAuth as a discovery tool rather than identity-only.

### Sequence B — Login first, consolidation second

1. **Phase 1:** Login UX evolution on the dashboard first.
2. **Phase 2:** Then consolidate.

Reasoning against this: the login work depends on which domain/route structure we land on. Doing login work in the wrong domain context means redoing it.

### Sequence C — Defer both, treat the current state as launch-ready

If shipping pressure is high, we could launch loramer.com pointing at the dashboard via Vercel rewrites (Option B from Part 1) and Google-only login (current state). Doesn't address the "feels outdated" instinct but ships the product.

### Recommendation

**Sequence A**, with Phase 1 (DNS + app.loramer.com) being the cheap, fast move worth doing soon. Phases 4-5 (login evolution) wait for a real plan and probably for after GA Phase 1+ ships.

---

## Part 4 — Open questions for tomorrow's session

1. **Which Part 1 option?** (A merged repos / B rewrites / C subdomain). Recommendation is C, but worth confirming.
2. **Which Part 2 option?** (A keep+email / B multi-platform / C email-first / D reframe Google). Recommendation is A short-term, D long-term.
3. **What's the "Shopify signin" story?** Today it's via the Shopify App Store install flow. Should we make it a first-class login button at the door too? Affects the marketing page (could add a "Get started from your Shopify store" path) and the login page (could add a "Sign in with Shopify" button).
4. **When does this happen?** Before GA Phase 1 (which we're about to start), or after the connector pipeline is humming? Probably after — the consolidation is launch-critical but not blocking-other-work.
5. **What about the existing `cotemedia-google-ads-manager.vercel.app` URL?** It's been the dashboard URL for months; some Shopify reviewers have it bookmarked. We should keep it forwarding for at least 6 months post-launch to honor existing bookmarks. Probably a 301 redirect to app.loramer.com.

---

## Part 5 — Risk and rollback

Each phase needs an "undo" path.

- **Phase 1 (app.loramer.com DNS):** rollback is removing the DNS record. Trivial. The original cotemedia-google-ads-manager.vercel.app keeps working.
- **Phase 2 (marketing CTA updates):** rollback is git revert.
- **Phase 3 (login page visual restyle):** rollback is git revert.
- **Phase 4 (login UX evolution):** highest risk. Auth changes have real production user impact. Strict feature-flag this if there are any beta users with active sessions when we ship. Test on a staging deployment first.
- **Phase 5 (Google OAuth reframe):** copy/UX only, no auth flow changes, low risk.

The Shopify App Store reviewer experience must survive every phase. That's a non-negotiable since LoraMer is already approved and live on the App Store.

---

## What's NOT in this doc

- **Pricing, billing, plan-change UX.** Project 2 in ROADMAP handles that.
- **The post-signup onboarding flow.** Project 10 (Data Ingestion) touches part of it. Need a separate design doc for the full onboarding sequence once we know the login direction.
- **Multi-user workspaces / team invites.** Project 20 handles that.
- **The Shopify install flow's relationship to general signup.** Worth a separate look — the App Store-approved flow is its own beast.

---

## TL;DR for the next Claude

Russ flagged at end of May 29 that loramer.com (marketing) and cotemedia-google-ads-manager.vercel.app (dashboard) need to feel like one product at launch. Also wants to rethink the Google-only OAuth login — keeping the "oh wow when all your clients appear" magic but updating the framing/door.

This doc lays out the options. The recommendation in two sentences: **(1) Use app.loramer.com as the dashboard subdomain (Sequence A, Option C from Part 1). Cheapest, lowest-risk, industry-standard. (2) Add email/password as a secondary login path now (Option A from Part 2), then reframe Google OAuth as a discovery tool later (Option D).**

Tomorrow's session should: (a) confirm or override these recommendations, (b) ship Phase 1 (app.loramer.com DNS) since it's cheap and unblocks future work, (c) defer Phases 4-5 until after GA Phase 1+.
