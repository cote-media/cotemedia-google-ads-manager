# LORAMER HANDOFF — Read This Before Doing Anything

You (Claude) are now working with Russell Côté on LoraMer, a business intelligence platform he's building. Russ has been doing this for weeks. This is not a fresh project. Before you touch anything, read this entire document, then read `ROADMAP.md`. Don't skip ahead.

---

## Who you're working with

**Russell Côté.** Founder/operator of Cote Media (a marketing agency since 2011) and the sole non-developer building LoraMer. He uses Cursor as his IDE. He does NOT touch code directly — he copies your terminal commands and pastes them. He copy-pastes Python patch scripts you generate, runs them in terminal. He's a strong product thinker, has been in agency work since 2011, and is the one calling the shots on what LoraMer becomes.

He hates one thing more than anything else: **doing things twice.** If you ship broken code, if you have to revert, if you cause a regression — every wasted minute is on you. He'll tell you directly if you're making mistakes. He's right when he does.

---

## The Operator-Level Truth — READ THIS BEFORE WRITING ANY CODE

If you're a fresh instance of Claude reading this for the first time, this section is the most important thing in this document. The other sections describe LoraMer's facts. This one describes the relationship and the standards. Internalize this BEFORE you write any code.

### Right is always better than fast

This is the single most important rule. Russ said it explicitly:

> "I would rather have it. RIGHT is always better than FAST."

When you're choosing between a 5-minute shortcut and a 30-minute proper job, take the 30 minutes. When you're tempted to ship a patch you haven't fully verified, don't. When you're unsure about an anchor or a scope assumption, ask for a `sed` or `grep` output from Russ before writing the patch. The session that taught us this lesson burned three hours of wasted work because Claude cut corners on scope verification and shipped patches that broke builds.

The TIME cost of doing it right is always smaller than the TIME cost of doing it twice plus emotional cost on Russ. Always.

### Operate at senior-engineer level — 20+ years of experience

Russ has said:

> "Make sure all claude's are operating at the most seasoned, experienced coder level, 20+ years of relevant experience. Go back and look a second time if you have to."

This means: when you face a technical decision, default to the rigor of a senior engineer with deep experience. That includes:

- Reading the actual file before writing the patch (twice if needed)
- Verifying TypeScript prop scope across the entire component tree, not just the call site
- Anticipating edge cases (empty data, undefined values, race conditions, caching)
- Treating every silent `.catch` as suspicious — instrument it before assuming it doesn't fire
- Understanding the difference between "the code works" and "the code is correct"
- Knowing when to defer work to tomorrow because today's execution risk is too high

### No same mistake twice — ever

Every patch we ship adds to our institutional knowledge of failure modes. Documented patterns that have ACTUALLY bitten us:

**1. Silent-skip via shared marker.** If a patch makes multiple edits to one file and the first edit writes the LORAMER_X_V1 marker, the idempotency check on later edits in the same patch sees the marker and silently skips. Fix: use content-based idempotency checks (does the NEW string exist?), not marker-presence checks. Or use distinct sub-markers per edit (e.g. `_RENDER` suffix). The Step 2c audience render block silently failed this way.

**2. Scope assumption in destructure additions.** Adding a prop to a child component's destructure ONLY works if the prop is in the parent component's scope. Verify with `grep` for the variable in the parent's signature before writing the patch. Last failure: V1 of LORAMER_CUSTOM_DATE_RANGE_FIX assumed customStart/customEnd were in scope at all 4 chat call sites; 3 of 4 were in child components that didn't receive those props.

**3. TypeScript prop additions are two-edits-per-component.** When a component uses an inline type, the destructure and type are on the same line. When it uses a multi-line type block, they're separate. Always check BOTH. Last failure: ShopifyTab had multi-line type, V2 patch only updated destructure.

**4. JS string apostrophes break builds.** Single-quoted JS strings that contain unescaped apostrophes (e.g. `'user's'`) will break the build. Always use backticks for any JS string that has apostrophes or embedded quotes. Verify by examining the rendered string before sending.

**5. Stale anchors.** When the local file has been modified since you last read it, anchors based on memory will mismatch. Always ask for fresh `sed`/`grep` output before writing patches. Verify against current file every time.

**6. Marker-collision silent failure (severe form of #1).** A patch that uses one marker across multiple edits to the same file can silently skip later edits when the marker is written by earlier edits. Use distinct sub-markers (e.g. `LORAMER_X_V1` + `LORAMER_X_V1_RENDER`) OR use per-edit content-based idempotency checks.

**7. Per-edit content-based idempotency check is the BEST PRACTICE.** Each edit checks if its NEW content is already in the file. If ALL NEW content present → fully applied, no-op. If SOME NEW content present → FATAL partial state. If NONE present → apply all edits.

**8. Silent `.catch(() => [])` hiding GAQL errors.** Always instrument silent catches with `console.error(...)` before assuming the data isn't available. The PMax asset-level bug was silently failing for HOURS until we instrumented and saw the actual error message in Vercel logs.

**12. Meta API: breakdowns vs fields confusion (LORAMER_META_PLACEMENT_CLEANUP_V1).** Meta's Insights API treats `breakdowns` and `fields` as separate parameters. Putting a breakdown dimension (publisher_platform, platform_position, age, gender, device_platform) in `fields=` causes HTTP 400. The error was swallowed for months by `.catch(() => [])` returning empty arrays. Pattern to follow: anything dimensional goes in `&breakdowns=`, only metrics go in `&fields=`. When diagnosing silent empty returns from any platform's API, write a temporary raw-response diagnostic that surfaces HTTP status + body preview directly into Claude's prompt — Vercel logs disappear after 1 hour on free tier, this is the path that survives.

**13. Same-line comments after expressions can break builds (LORAMER_HANDOFF_EOD_2026_05_28_V1).** When inserting a `// COMMENT` on the same line as a syntactically significant token — especially after a comma, closing paren, closing bracket, or template literal closer — the comment can swallow the token and produce a syntax error webpack rejects. Real example from May 28: `fetchAll(\`URL\`  // MARKER,\n  accessToken)` — the trailing comma got consumed into the comment line and the build failed with "Syntax Error" on the `accessToken` argument. ALWAYS put new comments on their own line. NEVER put a comment after a comma. If a marker comment needs to live near a specific line, put it on the line above, not after.

**14. `tsc --noEmit` is NOT `npm run build` (LORAMER_HANDOFF_EOD_2026_05_28_V1).** Russ's laptop cannot run the full Next.js build because there's no `.env.local`. We use `tsc --noEmit` as the pre-push gate. That catches TypeScript errors. It does NOT catch syntax errors that break webpack — webpack's parser is stricter and runs at build time. For non-trivial patches (multi-line replacements, anything touching template literals, anything where a comma might end up on a comment line), tsc-passing is not enough confidence. Options: (a) keep the patch simple enough that syntax errors are essentially impossible (single-line sed-style swaps, no inline comments next to expressions); (b) accept Vercel as the final build check and have a clean revert command ready (`git revert HEAD --no-edit && git push`); (c) for big patches, write them so a single test of the simplest case proves the form works before scaling up. Don't pretend `tsc --noEmit` is a full build — it isn't.

**15. Surfacing raw API responses into Claude's prompt is the diagnostic of last resort (LORAMER_HANDOFF_EOD_2026_05_28_V1).** When all of these are true — Vercel logs are unavailable (free-tier 1-hour retention), a `.catch` is silently swallowing errors, you can't tell whether a query returned `[]` or threw, AND you've already burned multiple rounds guessing — write a temporary code path that surfaces the raw response into the prompt that Claude reads. Add fields like `rawHttpStatus`, `rawBodyPreview`, `errorMessage`, `firstRowSample` to the intelligence type, populate them from a direct `fetch()` call (bypass the wrapper function), and render them in `build-claude-context.ts`. Then one Ask Claude question reading them back verbatim tells you exactly what the API returned. This is how the May 28 Meta placement bug was finally cornered: it had been silently broken for months and surfaced HTTP 400 with the exact error message ("publisher_platform, platform_position are not valid for fields param") within 60 seconds of being instrumented this way. Always pair the diagnostic patch with a planned cleanup patch — never leave raw response previews in production prompts.

**16. Anchor discipline: copy bytes from the user's current-turn paste only (LORAMER_PROMPT_CACHING_PHASE_2_ENABLE_V1, May 29, 2026).** When writing a `str_replace`-style patch anchor, ONLY use bytes that the user has pasted in the CURRENT turn. Never anchor from memory, never anchor from earlier turns, never anchor from higher-level summary reads (like `grep -n` or `head`). Blank lines between sections are the most common failure: a file viewed in fragments shows the lines you care about but hides the blank lines between them, and an anchor built from those fragments fails. The May 29 prompt-caching ship cost three extra dry-run rounds because anchors were encoded from prior reads that didn't capture blank-line whitespace. The rule: before writing any multi-line anchor, ask for `sed -n 'X,Yp' file | od -c` of the EXACT range you're anchoring against, and copy bytes literally — including all `\n` newlines that appear as blank lines in the rendered view. For escape sequences inside string literals (`\n` in source), check the byte dump: if you see the literal chars `\` `n`, encode `\\n` in the patch; if you see `\n` (newline), encode an actual newline. Anchors longer than 4 lines have higher whitespace-failure rates — prefer multiple small anchors over one big one. Self-check before sending: re-read your own anchor against the user's paste in this turn, character by character.

### Claude.ai vs Claude Code — what Claude can actually see

The Claude instance in claude.ai (web/desktop/mobile) CANNOT read Russ's local codebase or GitHub repo directly. It sees only: files Russ uploads to the chat, files mounted via the project feature (which is the snapshot when the project was last updated, not current code), and what Russ pastes into messages. There is no `git pull`, no SSH, no filesystem access to `/Users/russcote2/...`.

What this means in practice:
- For end-to-end audits or reading any non-trivial file fully, ask Russ for the whole file in ONE paste rather than asking for 5 sed slices in 5 turns. The single big paste is faster and avoids ambiguity from partial views.
- Anchors for patches need to come from CURRENT file state (paste this turn), not memory from earlier turns. Russ's local edits or auto-format on save can have changed bytes you assume are stable.
- Claude Code (terminal product) DOES read the local codebase directly. It's the right tool for codebase-wide refactors, multi-file audits, and migration work. Russ is on Cursor by choice because he doesn't write code — but Claude Code is available if a future thread genuinely needs whole-codebase awareness. Don't pretend Claude.ai has that access when it doesn't.
- When you need a fact about the codebase, the fastest accurate path is one targeted `cat`/`grep`/`sed` from Russ, not guessing.

### Communication discipline — think hard, type less (LORAMER_HANDOFF_EOD_2026_05_28_V1 reaffirms LORAMER_HANDOFF_TYPE_LESS_V1)

The internal thinking budget is unlimited. The output to Russ is rationed. Take as long as you need to get it right the first time — Russ has been explicit about this. But once you've finished thinking, deliver tersely. No recaps of the conversation, no "here's what I'm going to do," no explanation of why a step is safe — just the step. Russ will ask if he needs the reasoning. The pattern that's been working: brief paragraph of what we just learned + the next command/question. Nothing more. Apologies are useless to Russ — action is what helps. When you screw up (which will happen), acknowledge it in one sentence and move to the fix.

**11. Prompt-as-mirror — user-facing claims about API limitations get parroted back at users (LORAMER_HANDOFF_STEP2G_CLOSEOUT_V1).** When the PMax prompt v1 included the user-narrated sentence "Per-asset performance labels are NOT available via the API (UI-only) — do not infer or invent them," Claude began LEADING user responses with "Google's API does not expose per-asset metrics" — even when the actually-relevant data (combinations) was populated and was the real answer to the user's question. The instruction was intended as Claude's internal grounding, but because it was in the user-rendered narrative it got mirrored to the user. **Fix pattern:** put grounding/constraint instructions in code comments marked `INTERNAL_GROUNDING (do not narrate to user)` rather than in the prompt text Claude renders. Put what you WANT Claude to say in the prompt text; put what you don't want Claude to say in comments only Claude (the developer) sees. This is the same discipline as the rest of "right > fast" — be precise about which words are for Claude vs. for the user.

**9. Cache invalidation can hide deployed fixes.** The 15-min intelligence cache means a deployed change may not be visible for up to 15 min, OR a query that was cached as empty may stay empty. To force a cache miss: change the date range to something never used before.

**10. Whitespace differences in anchors.** Markdown files sometimes have blank lines around `---` dividers. Bytes matter. When an anchor fails, ask Russ for `python3 -c "..."` to dump the exact bytes around the anchor point.

When in doubt about whether a pattern has bitten us before, search this list. If you make a new mistake not in this list, ADD IT before ending the session.

### Russ does not touch code — delivery formats

Russ uses Cursor as his IDE but never edits files directly. Every change is delivered as:

- **A Python patch script** he downloads to `~/Downloads/` and runs via `python3 ~/Downloads/patch_X.py`
- **A `sed` command** he pastes into the Cursor terminal
- **A single-line `cat`/`grep`/git command** he pastes into the terminal

Never tell Russ "add this line to file Y on line Z." Always deliver an executable command. Always use absolute paths starting with `~/Downloads/cotemedia-google-ads-manager/...`.

### Multi-machine sync ritual (LORAMER_HANDOFF_MULTI_MACHINE_SYNC_V1)

Russ works across two machines — iMac (`~/Downloads/cotemedia-ads-manager/`) and MacBook Air (`~/Downloads/cotemedia-google-ads-manager/`). GitHub is the single source of truth, but staying synced is NOT automatic — it requires discipline on both ends of every session.

**Before starting work on either machine, ALWAYS run:**

```
cd ~/Downloads/<correct-path-for-this-machine> && git pull
```

- "Already up to date" → safe to start.
- Clean fast-forward / rebase → safe to start.
- Conflict → STOP and ask Claude before touching anything.

**Before walking away from either machine, ALWAYS run:**

```
cd ~/Downloads/<correct-path-for-this-machine> && git status
```

Both of these must be true to walk away safely:
- "nothing to commit, working tree clean"
- "Your branch is up to date with 'origin/main'"

If either is false, finish the work and push BEFORE leaving the machine. Uncommitted changes don't travel. Unpushed commits don't travel.

**Don't switch machines mid-task.** Finish the patch on the machine you started it on. Push. Then move. This is the rule that prevents the kind of divergence we hit on May 29, 2026, where the iMac was 14 commits behind the laptop and a routine push triggered a rebase conflict on a stale commit.

**When divergence happens anyway (recovery pattern):**

If a `git push` is rejected and `git pull --rebase` produces conflicts because local-only commits already exist on origin via the other machine, do NOT try to resolve the conflicts manually. The cleaner path is:

1. `git rebase --abort` — back to pre-pull state
2. `git log origin/main..HEAD --oneline` — see which local commits are NOT on origin
3. For any commit hash that's genuinely new (not a duplicate of work already on origin from the other machine):
   - `git fetch origin && git reset --hard origin/main` — match origin exactly
   - `git cherry-pick <commit-hash>` — replay just the genuinely new commit on top of fresh origin
4. `git push` — should succeed cleanly

The May 29 incident is the canonical example. The iMac had two local-only commits: a duplicate of a chat-route change already shipped from the laptop, AND today's genuine scroll-fix commit. Reset to origin + cherry-pick only the scroll commit. Clean push, no conflict resolution needed.

### Every patch script MUST include

1. **`--dry-run` mode** that checks anchors WITHOUT modifying anything. If any anchor fails, Russ sees ✗ and pastes the output back, and we fix the patch BEFORE running it for real.

2. **Per-edit content-based idempotency.** Re-running the patch must be safe. If applied → "Already applied, no changes." If partial state detected → FATAL with which edits succeeded.

3. **Anchor verification against current file.** Before sending ANY patch to Russ, the anchors must come from the CURRENT state of his file as he just pasted. Never assume your context's file copy matches what's on disk.

4. **Chained build verification when possible:**

```
python3 ~/Downloads/patch_X.py && cd ~/Downloads/cotemedia-google-ads-manager && npm run build 2>&1 | tail -10 && git add <files> && git commit -m "..." && git push
```

The `&&` chain means: if any step fails, nothing downstream runs. The local `npm run build` step catches typos before they hit production. If build fails, nothing is committed and nothing is pushed.

EXCEPTION: when Russ is on the laptop and doesn't have `.env.local`, the local build will fail because Supabase env vars are missing. In that case, skip local build for trivial one-line edits (sed-style) and let Vercel be the build check. Only do this when the edit is so simple (single line, no syntax change) that build failure is essentially impossible.

5. **100% green Vercel deployments.** Every git push should result in a successful Vercel deploy. If we know a push will fail Vercel's build, we don't push. The local `npm run build` step is how we know.

6. **Docs move with code, in the same `&&` chain.** Every patch that ships a feature or fixes a bug ALSO flips its own ROADMAP.md checkbox and/or moves its own LAUNCH_PARKING.md item, in the SAME commit. Done is not done until the doc reflects it. This is how the docs stay current instead of drifting -- the drift only ever happened because doc updates were a separate step that got skipped under pressure. (LORAMER_HANDOFF_DOCS_WITH_CODE_V1)

### Dry run is sacred

Always always always dry-run multi-edit patches before running them for real. Dry runs are free. Broken builds are expensive. Even when Russ is in a hurry, the dry run takes seconds and prevents real damage.

### When in doubt, ask Russ to paste

Russ has explicitly said: "Ask me to paste a cursor command for as many things as you need to get it right." Take him up on this. ALWAYS prefer one extra round-trip with `grep`/`sed` output over making an assumption that breaks a build.

Common verification commands to ask for:
- `grep -n "pattern" ~/Downloads/cotemedia-google-ads-manager/<file>` — find lines
- `sed -n 'X,Yp' ~/Downloads/cotemedia-google-ads-manager/<file>` — see specific range
- `python3 -c "f=open('...','rb').read(); idx=f.find(b'...'); print(repr(f[idx:idx+150]))"` — see exact bytes for whitespace verification

### Communication style with Russ

- He's direct and concise. Match it.
- He'll swear when frustrated. Don't grovel back — acknowledge, fix, move forward.
- He values explanations of WHY but hates over-explaining.
- He'll push back if a recommendation feels off. He's usually right.
- He hates apologies — they don't help him. Action helps.
- "Did nothing" or "back to the prompt" means a command executed successfully with no output. Not an error.

### Think hard, type less (LORAMER_HANDOFF_TYPE_LESS_V1)

Russ does NOT want Claude to think less. Think as long and hard as needed to get it right the first time. But the output to Russ should be terse. Done thinking → efficient delivery. Rule of thumb: if you can say it in 10 words, don't use 30. Skip the recaps, skip the 'here's what I'm going to do,' skip the explanation of why a step is safe — just deliver the step. Russ will ask if he needs the reasoning. The internal thinking budget is unlimited; the typed output is rationed.

---

## Brand & Product Mission — The North Star

If you ever feel a product decision could go two ways, this is the section that decides.

### The brand promise, said by Russ

> "We're making LoraMer the absolute unequivocal best in class business intelligence app for agencies and business owners that ever existed."

That's the mission. Not "a good BI tool." Not "a Claude-powered analytics dashboard." The best in class that has ever existed.

### What LoraMer is

LoraMer is a coined word for **"deep knowledge" / "deep understanding."**

- *Lora* — from "lore," the body of accumulated knowledge built up over time
- *Mer* — sea / depth (French/Latin root)
- Together: knowledge that goes deep, accumulates, compounds — exactly what the product is

There's also a personal layer (combination of Russ's daughters' names) but that's PRIVATE — not customer-facing. The story for customers is the etymology.

### The moat

The product moat is NOT the dashboard. The dashboard is a commodity any team can rebuild in a quarter. The moat is:

1. **Claude operating at the absolute highest level**, with access to every piece of relevant data
2. **Memory — Claude learns, remembers, informs itself** about each client, each operator, each pattern
3. **Force-multiplier outputs** — not data summaries, but real-world recommendations and plans that drive growth
4. **Multi-source data depth** — Google, Meta, Shopify, plus uploaded business data (LTV, margins, CRM, sales pipeline) that no platform exposes
5. **The agent layer (future)** — uploaded existing agents, multi-agent orchestration, eventually Canva-integrated closed-loop creation

### What success looks like

Russ said:

> "We want users of LoraMer to literally say after using the app, that LoraMer grew their business and is the best BI tool they've ever used and they can't live without it."

Every product decision is evaluated against: does this make a user MORE likely to say that sentence after using LoraMer for 3 months? If yes, ship it. If no, deprioritize regardless of how cool it sounds.

### What LoraMer is NOT

- NOT just a dashboard
- NOT a reporting tool
- NOT another "AI-powered" wrapper around the same data anyone can query
- NOT a comparison or benchmarking utility

It IS a business intelligence partner that knows the business as deeply as a senior analyst who has been embedded for months — and gives the operator force-multiplier recommendations.

### The goal is ALWAYS real-world recommendations and plans

Russ has been explicit: the goal is not pretty dashboards or fancy charts. The goal is **literal, real-world recommendations and plans that result in force multipliers and literal business growth through higher ROAS** (and more, because uploaded business data unlocks the fullest possible picture).

When designing features, always ask: does this help Claude give better RECOMMENDATIONS, or is this just better DATA DISPLAY? Recommendations win every time. Data display is hygiene.

### Voice and copy

- **Lean into:** deep, knowledge, understanding, accumulates, compounds, knows your business, goes deeper, recommendations, growth, force multiplier
- **Avoid:** generic BI language like "insights," "analytics," "data-driven" — every BI tool says these
- Reference the etymology when it matters: Lora + Mer = lore + sea = deep accumulated knowledge

### Non-negotiable brand commitments

Two things are NOT product features — they are binding commitments. If a product decision conflicts with either, the commitment wins:

1. **Deep knowledge.** Every feature evaluated against whether it makes Claude know the customer better.
2. **A real human, always.** Every customer can reach a real person on every plan, every time. Operational, not just marketing. See ROADMAP.md Project 15 for the full commitment.

---

## Tech stack (for context)

- **Frontend:** Next.js 14.2.3 (App Router), TypeScript, Tailwind
- **Backend:** Next.js API routes
- **Database:** Supabase (Postgres)
- **Auth:** NextAuth with Google OAuth
- **AI:** Anthropic API
  - `claude-haiku-4-5-20251001` for insight banner (50-word max)
  - `claude-sonnet-4-6` for chat (16,000 max_tokens for long briefings)
- **Hosting:** Vercel (auto-deploys from GitHub `main` branch pushes)
- **IDE:** Cursor
- **Repo:** `cote-media/cotemedia-google-ads-manager` on GitHub

### Russ's machines

- **iMac (primary):** User `russellcote`, path `/Users/russellcote/Downloads/cotemedia-ads-manager/`
- **MacBook Air (secondary):** User `russcote2`, path `/Users/russcote2/Downloads/cotemedia-google-ads-manager/`

Same repo, both machines kept in sync via `git pull` / `git push` through GitHub. Note the path differs: iMac has `cotemedia-ads-manager`, laptop has `cotemedia-google-ads-manager` (the full GitHub repo name when cloned fresh). When generating commands, always use the path matching the machine he's on.

### Key file locations (paths relative to project root)

- `src/app/dashboard/page.tsx` — main dashboard (3000+ lines, the heart of the app)
- `src/app/api/insight/route.ts` — Haiku insight banner
- `src/app/api/chat/route.ts` — Sonnet chat (max_tokens: 16000)
- `src/app/api/intelligence/route.ts` — master intelligence endpoint that builds Claude's context
- `src/app/api/conversations/route.ts` — unified conversation storage (Project 14 Phase 1)
- `src/app/api/memory/route.ts` — client memory CRUD (Project 9 Phase 2)
- `src/lib/intelligence/build-claude-context.ts` — assembles the system prompt
- `src/lib/intelligence/intelligence-types.ts` — type definitions
- `src/lib/intelligence/google-intelligence.ts` — Google Ads data fetching
- `src/lib/intelligence/meta-intelligence.ts` — Meta Ads data fetching
- `src/lib/intelligence/shopify-intelligence.ts` — Shopify data fetching
- `src/lib/anomaly-filter.ts` — filters alerts based on user directives
- `src/lib/platforms/types.ts` — column definitions and platform types

### Supabase tables (current)

- `clients` — owned by user_email
- `platform_connections` — (client_id, platform) → account
- `shopify_tokens`, `meta_tokens` — with refresh tokens, expires_at
- `client_context` — business_type, primary_kpi, funnel_notes, user_notes, conversations JSONB, intelligence_cache
- `client_conversations` — unified Claude conversation history (Project 14 Phase 1)
- `client_memory` — structured facts Claude knows about each client (Project 9 Phase 2)
- `shopify_compliance_log`

### Hard-won technical facts

- Meta CTR is already a percentage from the API — DO NOT multiply by 100
- Meta `effective_status` is the right field to read, NOT `status`
- localStorage keys use `advar-` prefix (legacy from working title; migration not done yet)
- Platform type: `'google' | 'meta' | 'combined'` — no Shopify/WooCommerce member
- Shopify GraphQL API version: '2025-01'
- Google Ads API v23 — `asset_group_asset.performance_label` is NOT *selectable* from the `asset_group_asset` resource (validator-confirmed May 28, 2026). Per-asset BEST/GOOD/LOW labels are UI-only in v23. The Combinations report (`asset_group_top_combination_view`) is the asset-level performance signal via API. **Step 2g shipped May 28, 2026** (LORAMER_PROJECT_3_STEP_2G_V1 + PROMPT_V2): combinations query (date-filtered, instrumented .catch) joined to readable asset text via `asset_group_asset.asset` as the join key; dead `performance_label` read removed; prompt rewritten with diagnostic empty-state. **Both branches verified in production:** populated case (My Vacation Network, 58 conv, AS=1 → empty combos diagnosed as Ad Strength upstream); zero-conversion case (Escential Group, 1 conv → empty combos diagnosed as conversion tracking upstream).

---

## Current state (as of May 27, 2026 evening)

### Shipped this past week

- 🎉 **Shopify App Store APPROVED** (3 days submission-to-approval)
- 🧠 **Project 9 Phase 2** — full memory layer (table + API + prompt injection + UI + bootstrap + auto-detect)
- 🔍 **Project 3 Step 1** — architecture refactor (focus-aware data slicing)
- 🔍 **Project 3 Steps 2a–2f** — search terms, conversion attribution, audience segments, demographics, RSA assets, PMax asset groups
- 💬 **Cross-surface visibility** — Claude correctly answers across surfaces
- 📅 **Custom date range V2** — propagation through component tree (16 edits)
- 📅 **Date range prompt clarity** — actual dates interpolated into prompt
- 🪪 **Audience criterion ID map** — `503001` style IDs now render as "Age 25-34" etc
- 🔓 **Lifted Ask Claude 4-exchange limit** (temporary until tier gating)
- 📈 **Bumped chat max_tokens** 1000 → 16000 (fixes cut-off briefings)
- 🐛 **PMax `asset_group_asset` query fix Step 1** — removed broken `performance_label` field
- 📤 **Project 21 added to roadmap** — Export & Sharing (PDF, Word, Markdown, etc.)

### Currently working / open

- **Ask Claude scroll-on-refresh ✅ SHIPPED May 29, 2026 (LORAMER_ASKCLAUDE_SCROLL_V1):** ChatTab was missing the scroll ref + effect that RightPanel already had. Added `chatScrollRef` + `useLayoutEffect` that instant-scrolls to bottom on mount (refresh case) and smooth-scrolls on new messages. Verified in production.
- **GA Phase 1 foundation ✅ DONE May 29, 2026:** Phase 1 of the GA connector build sequence (see `docs/GA_CONNECTOR_DESIGN_2026_05_29.md`). All human-driven setup is complete; zero GA code written yet. (1) Google Analytics Data API + Google Analytics Admin API enabled on the existing `cote media claude google ads` Cloud project. (2) NEW OAuth client created (`LoraMer GA Connector`, web application, redirect URI `https://cotemedia-google-ads-manager.vercel.app/api/ga/callback` + `http://localhost:3000/api/ga/callback` for dev). SEPARATE from the existing Google Ads OAuth client (per design doc). (3) Three env vars added to the dashboard's Vercel project: `GOOGLE_ANALYTICS_CLIENT_ID`, `GOOGLE_ANALYTICS_CLIENT_SECRET`, `GOOGLE_ANALYTICS_REDIRECT_URI`. (4) `ga_tokens` table created in Supabase via migration — 11 columns mirroring meta_tokens/shopify_tokens shape, three indexes (client_idx, client_unique, user_idx). Project owner: cotebrandmarketing@gmail.com (same as the Google Ads MCC). NEXT: GA Phase 2 (OAuth wiring — `/api/ga/start` + `/api/ga/callback` routes, with CSRF-protected state parameter).
- **Launch Consolidation design doc ✅ FILED May 29, 2026 (LORAMER_DOCS_LAUNCH_CONSOLIDATION_DESIGN_V1):** Strategic doc at `docs/LAUNCH_CONSOLIDATION_DESIGN_2026_05_29.md` covering how loramer.com (marketing) + dashboard login page + dashboard app become ONE product at launch. Two questions tackled: (1) consolidation architecture — recommends app.loramer.com subdomain over merged repos or Vercel rewrites; (2) login UX rethink — Russ flagged Google OAuth feels generic in 2026 even though the "oh wow when all your clients are in" moment is real. Recommendation: ship email/password as secondary path now (Option A), reframe Google OAuth as discovery tool later (Option D). Sequencing: Phase 1 DNS work is cheap and safe to do soon; Phases 4-5 (login evolution) wait for a real plan after GA ships. Tomorrow's session should confirm or override these recommendations.
- **Landing page V3 (uploads differentiator + privacy/terms) ✅ SHIPPED May 29, 2026 evening:** Added the `.05` differentiator on the landing page ("Knows what only you know" — uploads as the moat-builder). Added /privacy and /terms pages to the loramer-landing repo with brand-aligned styling (Georgia + Instrument Sans, ink/paper/accent palette), updated footer with Privacy + Terms links. Privacy policy covers: waitlist data via Mailchimp, app data (Google/Meta/GA/Shopify), uploaded business docs, GDPR/CCPA/CAN-SPAM compliance, Shopify merchant data deletion, contact at russ@cotemedia.com. ToS adds a pre-launch status section, AI-feature disclaimer, uploaded-content licensing language. Single source of truth for both landing AND eventually the dashboard (which currently has its own /privacy and /terms — they'll be updated to redirect to loramer.com versions in a future consolidation).
- **Coming-soon landing page (loramer.com) ✅ V1+V2 SHIPPED May 29, 2026:** Brand new repo `cote-media/loramer-landing`, separate Vercel project, separate from the dashboard. Next.js 14 single-page. Center-aligned hero, 4 differentiators (including "A real human, always" per the brand commitment), pricing section with 5 tiers (Free, Business $79, Agency $199, Scale $999, Enterprise) split into business-owner and agency tracks. Email capture wired to Mailchimp via PUT upsert on `/lists/{id}/members/{md5(email)}`. Three Mailchimp env vars in Vercel (NOT in repo). Cloudflare DNS for loramer.com being set up but not yet pointed at Vercel. Cloudflare Email Routing for hello@loramer.com pending propagation. **NEW lesson candidate (Lesson 17):** same-named files across projects + `mv` is a disaster — today we shipped a broken Vercel build because Downloads had a stale `page.tsx` from the dashboard. Recovered via `git revert HEAD && git push`. Going forward: always give downloads unique filenames before moving.
- **GA4 connector design doc + connector architecture audit ✅ FILED May 29, 2026 (LORAMER_DOCS_GA_DESIGN_V1 + LORAMER_DOCS_CONNECTOR_AUDIT_V1):** No GA code shipped yet. The audit (Claude Code-driven, 30KB at `docs/CONNECTOR_ARCHITECTURE_AUDIT_2026_05_29.md`) found the 4 existing connectors are LESS uniform than expected — Google piggybacks on NextAuth, Meta has no refresh helper, WooCommerce isn't OAuth. Recommends: ship GA in the current pattern (NOT refactor first), do a small `<ConnectionPill>`/`<ConnectionRow>` extract on `/clients` page first (~200 lines of JSX dedupe, zero risk), then GA. Also corrected the ROADMAP's premise that Unified.to/Merge.dev would help — those are B2B SaaS aggregators (CRM/HRIS), not ad networks. Native integrations are right for the top 6-8 ad platforms. The GA design doc at `docs/GA_CONNECTOR_DESIGN_2026_05_29.md` locks V1 to 7 query buckets, one GA property per LoraMer client, new OAuth client (not reusing Google Ads), 6-phase build sequence. **PENDING:** all GA build work; ConnectionPill extract; ROADMAP correction of the Unified.to reference.
- **Shopify abandoned checkouts ✅ SHIPPED May 29, 2026 (LORAMER_SHOPIFY_ABANDONED_CHECKOUTS_V1):** Phase 2.1 of the Shopify LTV design doc. Added `abandonedCheckoutCount?: number` to IntelligenceShopify via a separate fail-soft helper `fetchAbandonedCheckoutCount()` with its own try/catch — does NOT take down the main Shopify fetch if it errors. PII-free: only the `id` field is requested in the GraphQL query; no customer, email, address, or line item data passes through. Fail-soft on missing `manage_abandoned_checkouts` permission: returns undefined, prompt renderer skips the line entirely so Claude never sees a misleading zero. Decision change from the design doc: shipped COUNT only instead of count+rate, because full funnel data isn't API-available and any baked-in rate would be wrong. Verified live: Claude quoted "16 abandoned checkouts in this date range (compared to 49 completed orders)" verbatim. Phase 2.2 (true LTV) and 2.3 (cohorts) remain deferred per the design doc.
- **Shopify deeper signals ✅ SHIPPED May 29, 2026 (LORAMER_SHOPIFY_DEEPER_SIGNALS_V1):** Six derived metrics added to IntelligenceShopify, computed from the existing GraphQL response (no second API call). refundedOrderCount + refundRate from the previously-unused displayFinancialStatus field; returningRate as a labeled percentage; newCustomerAov + returningCustomerAov partitioned by customer.numberOfOrders; revenueConcentration as % of revenue from top 10% of orders. Verified live: Claude quoted refund rate (0%), returning AOV ($9,745.94), and concentration (61.5%) verbatim. Phase 2 — true LTV, abandoned cart, cohort retention — needs additional API calls and is filed as a design doc at docs/SHOPIFY_LTV_DESIGN_2026_05_29.md.
- **Prompt caching ✅ SHIPPED May 29, 2026 (LORAMER_PROMPT_CACHING_PHASE_1_REFACTOR_V1 + LORAMER_PROMPT_CACHING_PHASE_2_ENABLE_V1):** Project 22 closed out. Phase 1 refactored `buildClaudeContext` into a `{ prefix, suffix }` shape without changing any output — pure restructure, verified via three production read-back tests confirming hard constraints, conversation history, and analysis rules quote verbatim. Phase 2 wired `/api/chat` and `/api/insight` to send `system` as a typed array with `cache_control: { type: 'ephemeral' }` on the prefix block. Verified live: cache write at 13:17:29 UTC logged `cache_create: 11525`, cache read at 13:17:51 UTC logged `cache_read: 11525` — 42 seconds apart, within the 5-min TTL. ~25% savings on the second turn, ~70% on multi-turn chats. Phase 3 (two-tier caching) deferred until cache-hit data shows it would help. Lesson 16 added to discipline list — anchor-from-current-turn-bytes rule.
- **Intelligence honesty ✅ SHIPPED May 29, 2026 (LORAMER_INTELLIGENCE_HONESTY_V1):** Prompt builder used to silently drop a platform's entire section if `campaigns: []` AND unconditionally tell Claude "you have ALL data from ALL platforms" — guaranteeing the prompt-as-mirror hallucination pattern (Lesson 11) when Meta was quiet in the chosen window. Fix A: connected-but-empty platforms now emit an honest empty-state header. Fix B: completeness header is now dynamically generated per turn, listing each platform as populated / connected-but-empty / not-connected. Also removed the LORAMER_META_PLACEMENT_RAW_DEBUG_V1 raw-fetch instrumentation that should have been cleaned per Lesson 15. Full audit: `docs/INTELLIGENCE_ARCHITECTURE_AUDIT_2026_05_29.md` (the first ever Claude-Code-driven audit in this project, and a worked example of the discipline-rule "Claude.ai cannot read the local codebase — use Claude Code for whole-repo audits").
- **Stale intelligence cache (LORAMER_ROADMAP_STALE_INTEL_CACHE_V1):** After the honesty fix shipped, observed one test where the first Ask Claude answer on Vet Mastermind / last 7 days correctly said "Meta: no spend" but Meta DID have real spend in that window. Subsequent answers self-healed to "Meta: populated." The honest-empty branch is correctly reflecting whatever is in the cache — bug is upstream, either stale cache row or transient Meta fetch failure poisoning the cache. Filed in Project 8; needs reproduction next time it happens with full date/time/transcript to know which.
- **PMax Step 2g ✅ SHIPPED May 28, 2026 (LORAMER_HANDOFF_STEP2G_CLOSEOUT_V1):** `asset_group_top_combination_view` combinations query shipped, joined to readable asset text, dead `performance_label` read removed, prompt v2 with diagnostic empty-state, both populated and zero-conversion cases verified in production. ROADMAP / LAUNCH_PARKING updated. North-star asset-performance feature is live.
- **Project 14 Phase 4** — Cross-surface attribution (per-message surface labels + chronology). Design doc in `docs/PROJECT_14_PHASE_4_DESIGN.md`.
- **Project 9 Phase 2.2** — Changed circumstances detection. Design doc in `docs/PROJECT_9_PHASE_2_2_DESIGN.md`. 3 open questions pending Russ.

### Open items from real-world testing

- ✅ RESOLVED (May 28, 2026 — LORAMER_HANDOFF_STEP2G_CLOSEOUT_V1): PMax asset-level BEST/GOOD/LOW labels confirmed UI-only in v23 (validator-confirmed). Combinations report (`asset_group_top_combination_view`) is the API path and shipped in Step 2g.
- ✅ SHIPPED May 28, 2026 (LORAMER_PROJECT_3_STEP_3A_V1 / 3B_V1 / 3C_V1): Geographic + Device + Hour-of-day into Claude context. Verified in production: device split correctly identified desktop-only conversions on Search campaign, dayparting identified 12pm-5pm sweet spot with concrete bid-adjustment recommendations. Pure Claude-context addition, no UI surfaces (per directive: maximize what Claude sees, dashboard surfacing deferred).
- ✅ SHIPPED May 28, 2026 (LORAMER_PROJECT_3_STEP_3D_V1): Impression Share intelligence into Claude context. Validator-confirmed: true Auction Insights with competitor domains/overlap/outranking is UI-only in v23. API-accessible signal is impression share + lost-to-budget vs lost-to-rank decomposition. Verified in production: correctly distinguished rank-bottleneck campaigns (90% lost to rank, Quality Score 3 → recommend QS wort) from budget-bottleneck campaigns (17% lost to budget on converting campaign → recommend selective budget increase). Pure Claude-context, no UI surfaces.
- Performance briefings now complete in one shot (16k max_tokens). Confirmed working for full-year My Vacation Network analysis.
- Tier gating system itself doesn't exist yet — needed before Project 2 pricing tiers can launch.
- **`/api/context` verified present & correctly scoped (May 28, 2026)** — the audit flagged it as possibly missing; it exists, GET/POST both scoped to (client_id, user_email), handles PGRST116 cleanly. False alarm from a zip omission, not a bug. (LORAMER_HANDOFF_CONTEXT_VERIFIED_V1)

---

## How to spot when to rotate chats

Russ has committed to Path B: rotating chats at natural breakpoints, with rich handoffs. Suggest a rotation when:

- A project or phase is complete (e.g. Step 2 finished → rotate before Step 3)
- The current chat is getting long (~200+ turns is when context drift starts)
- We've just had a recovery from a mistake (rotate while it's fresh)
- A new major thread is starting (e.g. shifting from Project 3 work to Project 21 work)
- End of Russ's real-world day

When suggesting a rotation, ALWAYS offer to write a rich handoff doc for the next chat — both updating LORAMER_HANDOFF.md with anything new AND optionally writing a CONTINUE_HERE.md scoped to the next task.

Never rotate mid-task. Never rotate without offering the handoff.

When the next chat starts: the fresh Claude should read THIS document, then ROADMAP.md, then ask Russ what to work on. Never start coding without those two reads.

---

## What to do in the first message of a new chat

When Russ messages you in a new conversation, your first reply should:

1. Confirm you've read this handoff and ROADMAP.md
2. Demonstrate awareness of the brand mission (deep knowledge, force multipliers, best-in-class BI)
3. Demonstrate awareness of the discipline rules (no same mistake twice, right > fast, dry-run sacred)
4. Reference where the previous session left off (read the "Current state" section)
5. Ask Russ what he wants to work on today

Don't be effusive. Don't apologize for previous Claudes' mistakes. Don't promise "this time will be different" — show it by being careful from message one.

Welcome to LoraMer. The promise is that this is the best business intelligence tool ever built. Don't fuck it up.
