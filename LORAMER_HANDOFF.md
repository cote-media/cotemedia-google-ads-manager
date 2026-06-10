# ⛔ SESSION START GATE — the one authoritative protocol (supersedes every other start/first-reply section in this file)

A fresh Claude knows NOTHING current until it reads the live repo. Background memory AND the mounted project panel both lag and are NEVER authoritative. The git repo is the only source of truth.

**LAUNCH CONTEXT:** Soft launch target: July 14, 2026 (confirmed by Russ 2026-06-09) — invite-only founding cohort, Russ onboards manually. Full launch Q4 2026.

Before proposing, verifying, re-checking, or building ANYTHING, in order:
1. Output the SESSION RESUME paste (below) for Claude Code; WAIT for the result.
2. Read the ACTUAL printed contents of CONTINUE_HERE.md and EVERY file under its "REQUIRED READING — ACTIVE WORKSTREAM" section, in full, in the chat. A hand-typed summary is NOT enough — if you only have a summary, demand the real printed output before doing anything else.
3. Read this file (LORAMER_HANDOFF.md) + ROADMAP.md for standing knowledge: architecture, what's shipped, how we operate, lessons 1–40.
4. State the single confirmed NEXT STEP from CONTINUE_HERE; WAIT for Russ's explicit "go" before any command, edit, or verification.
5. Never re-verify or rebuild work CONTINUE_HERE marks done/locked. Never infer state.

SESSION RESUME paste (this is what "resume loramer" outputs):
SESSION RESUME — read-only, no edits.
cd <repo-for-this-machine> && git pull origin main && git status && git log -1 --oneline
cat CONTINUE_HERE.md, then cat in full every file listed under its "REQUIRED READING — ACTIVE WORKSTREAM" section. Print ALL of it, actual file contents (do NOT summarize), inside ONE single fenced code block in the chat reply per the REPORT FORMAT rule below. Then wait.
Receiving Claude: do not act until those actual contents are in the chat. A summary is not enough.

HOW WE OPERATE NOW (current reality — supersedes any older "delivery formats" notes in this file):
- Russ is a non-coder and never touches code. Claude Code runs locally on both machines with Supabase + Vercel MCP write access; it edits, commits, pushes, deploys, and runs migrations directly (Russ approves each). Russ is the human verification gate.
- READ-FIRST: act only on what you've actually read THIS session — the printed CONTINUE_HERE + REQUIRED READING + the live code. Never act on background memory, the Claude project-knowledge panel, an old handoff zip, or a hand-typed summary; if you only have a summary, demand the real printed output first.
- SINGLE-PASTE: anything Russ must paste to Claude Code is ONE copy-paste block — never split into prose + code + prose. The whole instruction, including verbatim text to insert (delimited by markers), goes in one block.
- NO-BUNDLING: never combine a procedural/rule change with substantive build work in one move, and never start new work or add scope while Russ has an unanswered approval request on the table. One thing at a time; finish it or get the answer first.
- DEFINITION OF DONE includes: any DB write that must touch a row UPSERTs (or checks the affected-row count and logs loudly on 0) — Lesson 39; and no internal flag/enum/status/tier key is ever rendered to a user without a human-readable label — Lesson 40.
- REPORT FORMAT (2026-06-09, supersedes all earlier OUT.txt wording): Every report you give Russ is printed ONCE, IN FULL, inside ONE single fenced code block (triple backticks) in your chat reply — so the Claude phone app renders it with a one-tap COPY button. Nothing of substance outside that block (a one-line lead-in is fine). Never a long version plus a condensed version. Never a file. OUT.txt stays retired. If a report must contain commands or verbatim text for Russ, they live INSIDE that same single block, delimited with `<<<START>>>`/`<<<END>>>` markers instead of nested backticks.
- Label EVERY paste destination "Claude Code" (never "Cursor"). Any runnable command — even one line — goes in its own copyable code block with the destination labeled above it. Secrets never go in chat.
- Verification tiers: visual/className → tsc --noEmit + push + eyeball. logic/interactive/nav → state approach + edge cases first, then a prod (or preview) click-test before promoting; keep a clean revert ready.
- Right > fast. One workstream, one active paste at a time. Never the same mistake twice — log new ones in the lessons list.

---

# LORAMER HANDOFF — Read This Before Doing Anything

You (Claude) are now working with Russell Côté on LoraMer, a business intelligence platform he's building. Russ has been doing this for weeks. This is not a fresh project. Before you touch anything, read this entire document, then read `ROADMAP.md`. Don't skip ahead.

---

## Who you're working with

**Russell Côté.** Founder/operator of Cote Media (a marketing agency since 2011) and the sole non-developer building LoraMer. He does NOT write or edit code. Claude Code runs locally on his machine and makes changes directly — edits, commits, pushes, deploys, migrations — with Russ approving each step; he is the product owner and the human verification gate (see the SESSION START GATE at the top of this file for how we operate). He's a strong product thinker, has been in agency work since 2011, and is the one calling the shots on what LoraMer becomes.

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

**17. Same-named files across projects + `mv` is dangerous (LORAMER_LANDING_V1 revert, May 29, 2026).** Downloads often accumulates stale files with common names (`page.tsx`, `route.ts`). A blind `mv` can overwrite the wrong project's file and ship a broken Vercel build. Always give downloaded patch files unique names before moving. Recovered once via `git revert HEAD && git push`.

**18. Patch scripts with hardcoded machine paths silently fail (May 29, 2026).** Scripts that hardcode `~/Downloads/cotemedia-ads-manager` fail silently on the laptop where the path is `cotemedia-google-ads-manager`. Use the path matching the machine Russ is on, OR detect which directory exists. Better: Russ uses one consistent clone path on both machines.

**19. One canonical date resolver — never roll your own date math per platform (LORAMER_DATE_RANGE_CANONICAL_V1, June 2, 2026).** When each platform/route implements its own date window logic, definitions drift. Real bug: "LAST_MONTH" was 60 days in one path while another used calendar month. Fix: `src/lib/date-range.ts` + `resolveDateWindow()` is the single source of truth. Any new date consumer imports from there; never duplicate.

**20. Revenue = NET, not gross (LORAMER_SHOPIFY_NET_SALES_V1, June 2, 2026).** Shopify `totalPriceSet` includes shipping and ignores refunds on cancelled orders → phantom revenue if you sum gross original totals. Use `currentSubtotalPriceSet` for net sales; surface refunds explicitly. Match what the merchant sees in their own Shopify Analytics.

**21. Google Ads GAQL has NO `LAST_90_DAYS` enum (LORAMER_GOOGLE_DAILY_90DAY_FIX_V1, June 2, 2026).** `segments.date DURING LAST_90_DAYS` is invalid GAQL. Use explicit `BETWEEN 'YYYY-MM-DD' AND 'YYYY-MM-DD'` via `resolveDateWindow`. Same class of bug as Meta breakdowns-in-fields — silent empty returns until you instrument.

**22. Platform selector and tab nav are separate controls (LORAMER_PLATFORM_NAV_FIX_V1, June 2, 2026).** Changing platform (Google/Meta/Combined) does NOT automatically change the active dashboard tab. If the user is on Shopify or Analytics and clicks a platform button, nothing visible happened — felt dead. Fix: when platform changes from a non-ad tab, switch to Overview.

**23. Safe duplicate-data cleanup in Supabase (June 2, 2026 — client dedupe, not in git).** Pattern: back up affected tables to CSV → re-point unique children onto the per-pair keeper → verify counts → delete only emptied twins. Keepers aren't always the older copy — review each pair (Escential kept May-20 copy because it had GA + more conversations). Never delete without backup and count verification.

**24. Bug hunts in big files: investigate-only first (June 2, 2026).** For complex diagnosis in large files (`dashboard/page.tsx`, intelligence adapters), use Claude Code in "investigate-only, report don't edit" mode first. Review the diagnosis, then write a tight fix spec. Prevents speculative patches that burn build cycles.

**25. Cross-machine: repo is single source of truth — always `git pull` at session start (June 2, 2026).** iMac: `~/Downloads/cotemedia-ads-manager/`. Air: `~/Downloads/cotemedia-google-ads-manager/`. Same repo, different clone folder names. Every session on either machine starts with `git pull`. Uncommitted/unpushed work doesn't travel. See Multi-machine sync ritual below.

**26. Serverless backfill cross-request cursor race (LORAMER_BACKFILL_GOOGLE_0B_V2).** A chunked/resumable job that re-reads its cursor from the DB on each separate HTTP call can restart from the same point, because a just-committed write isn't reflected in the next invocation's read ~1s later. Fix: do the whole job in ONE invocation with an in-memory loop; persist the cursor per chunk only for resume-after-interrupt, never as the loop's control.

**27. zsh eats unquoted globs; BSD grep needs -E.** `grep --include=*.ts` failed with "no matches found" because zsh expanded `*.ts` before grep saw it; quote globs (`--include="*.ts"`). macOS grep is BSD: use `grep -E "a|b"` for alternation, not `\|`. Keep pasted commands simple — heavy quoting risks smart-quote corruption on paste.

**28. Verify a freshly-deployed cron/route against LIVE production and give it time to finish.** The generic Vercel Logs view serves stale invocations; triggering from an old deployment's summary runs old code. The Google adapter looked broken for several rounds purely because of stale triggers + stale logs. Trigger current production, wait for completion (later loops in the cron write last), then check the DB.

### Claude.ai vs Claude Code — what Claude can actually see

The Claude instance in claude.ai (web/desktop/mobile) CANNOT read Russ's local codebase or GitHub repo directly. It sees only: files Russ uploads to the chat, files mounted via the project feature (which is the snapshot when the project was last updated, not current code), and what Russ pastes into messages. There is no `git pull`, no SSH, no filesystem access to `/Users/russcote2/...`.

What this means in practice:
- For end-to-end audits or reading any non-trivial file fully, ask Russ for the whole file in ONE paste rather than asking for 5 sed slices in 5 turns. The single big paste is faster and avoids ambiguity from partial views.
- Anchors for patches need to come from CURRENT file state (paste this turn), not memory from earlier turns. Russ's local edits or auto-format on save can have changed bytes you assume are stable.
- Claude Code (terminal product) DOES read the local codebase directly, and it is now the primary way LoraMer is built — codebase-wide refactors, multi-file audits, migrations, commits, and deploys all run through it. (This "Claude.ai vs Claude Code" section is retained for the case where a thread runs in claude.ai without Claude Code: don't pretend claude.ai has local-repo access when it doesn't.)
- When you need a fact about the codebase, the fastest accurate path is one targeted `cat`/`grep`/`sed` from Russ, not guessing.

### Communication discipline — think hard, type less (LORAMER_HANDOFF_EOD_2026_05_28_V1 reaffirms LORAMER_HANDOFF_TYPE_LESS_V1)

The internal thinking budget is unlimited. The output to Russ is rationed. Take as long as you need to get it right the first time — Russ has been explicit about this. But once you've finished thinking, deliver tersely. No recaps of the conversation, no "here's what I'm going to do," no explanation of why a step is safe — just the step. Russ will ask if he needs the reasoning. The pattern that's been working: brief paragraph of what we just learned + the next command/question. Nothing more. Apologies are useless to Russ — action is what helps. When you screw up (which will happen), acknowledge it in one sentence and move to the fix.

**11. Prompt-as-mirror — user-facing claims about API limitations get parroted back at users (LORAMER_HANDOFF_STEP2G_CLOSEOUT_V1).** When the PMax prompt v1 included the user-narrated sentence "Per-asset performance labels are NOT available via the API (UI-only) — do not infer or invent them," Claude began LEADING user responses with "Google's API does not expose per-asset metrics" — even when the actually-relevant data (combinations) was populated and was the real answer to the user's question. The instruction was intended as Claude's internal grounding, but because it was in the user-rendered narrative it got mirrored to the user. **Fix pattern:** put grounding/constraint instructions in code comments marked `INTERNAL_GROUNDING (do not narrate to user)` rather than in the prompt text Claude renders. Put what you WANT Claude to say in the prompt text; put what you don't want Claude to say in comments only Claude (the developer) sees. This is the same discipline as the rest of "right > fast" — be precise about which words are for Claude vs. for the user.

**9. Cache invalidation can hide deployed fixes.** The 15-min intelligence cache means a deployed change may not be visible for up to 15 min, OR a query that was cached as empty may stay empty. To force a cache miss: change the date range to something never used before.

**10. Whitespace differences in anchors.** Markdown files sometimes have blank lines around `---` dividers. Bytes matter. When an anchor fails, ask Russ for `python3 -c "..."` to dump the exact bytes around the anchor point.

When in doubt about whether a pattern has bitten us before, search this list. If you make a new mistake not in this list, ADD IT before ending the session.

### Russ does not touch code — how changes are delivered

Russ never edits files. Claude Code runs locally and makes every change directly — edits, commits, pushes, deploys, Supabase/Vercel MCP migrations — with Russ approving each. The old model (Python patch scripts / `sed` pastes into a Cursor terminal) is retired. See "HOW WE OPERATE NOW" in the SESSION START GATE at the top of this file: SINGLE-PASTE instructions, REPORT FORMAT (one fenced code block in chat — OUT.txt retired), label every paste "Claude Code," secrets never in chat. Never tell Russ "add this line to file Y on line Z."

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

### How changes get verified before they're "done"

Claude Code edits and runs the build directly; there are no patch scripts to dry-run anymore. Verification follows the tiers in the SESSION START GATE: visual/className → `tsc --noEmit` + push + eyeball; logic/interactive/nav → state approach + edge cases first, then a prod (or preview) click-test before promoting, clean revert ready. Two standing rules survive from the old patch-script era: 100% green Vercel deploys (every push builds clean — `npm run build` locally is the gate, with `.env.local`), and **docs move with code** (every feature/bugfix flips its own ROADMAP.md checkbox / moves its LAUNCH_PARKING.md item in the SAME commit — done is not done until the doc reflects it; LORAMER_HANDOFF_DOCS_WITH_CODE_V1).

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
- **Dev tool:** Claude Code (runs locally on both machines; edits/commits/pushes/deploys + Supabase/Vercel MCP directly)
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
- `src/lib/intelligence/ga-intelligence.ts` — Google Analytics 4 data fetching (GA V1, June 2, 2026)
- `src/lib/date-range.ts` — canonical date window resolver (`resolveDateWindow`); single source of truth for LAST_MONTH, rolling windows, THIS_MONTH (June 2, 2026)
- `src/lib/anomaly-filter.ts` — filters alerts based on user directives
- `src/lib/platforms/types.ts` — column definitions and platform types

### Supabase tables (current)

- `clients` — owned by user_email
- `platform_connections` — (client_id, platform) → account
- `shopify_tokens`, `meta_tokens`, `ga_tokens` — with refresh tokens, expires_at
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
- **Date windows:** `src/lib/date-range.ts` → `resolveDateWindow()` is canonical (June 2, 2026). LAST_MONTH = previous calendar month; rolling 7/14/30/90 = complete days ending yesterday; THIS_MONTH = 1st through today. Shopify/GA/Woo intelligence + daily routes use it. Google Ads paths partially migrated — remainder in Project 8 tech debt.
- **Shopify revenue:** net sales via `currentSubtotalPriceSet`, not gross `totalPriceSet` (June 2, 2026 — LORAMER_SHOPIFY_NET_SALES_V1). Surface refunds; match Shopify Analytics.
- **GAQL date literals:** no `LAST_90_DAYS` enum — use explicit `BETWEEN` dates (June 2, 2026 — LORAMER_GOOGLE_DAILY_90DAY_FIX_V1).

---

## Current state (as of June 3, 2026 evening)

### Historical Data Engine
- **Phase 0a COMPLETE** — all 5 forward adapters live + verified (Shopify, Meta, Google, WooCommerce, GA); nightly cron `/api/cron/sync` forward-captures daily metrics into `metrics_daily`.
- **Phase 0b backfill DONE + verified** on My Vacation Network — `/api/backfill/google` V2 pulled 658 account-level daily rows, 2024-05-17→2026-06-02, $76.5k spend, one clean run after fixing cross-request cursor race.
- **Google Ads developer token AND CRON_SECRET both rotated.**
- **Remaining Phase 0b:** `query_metrics` tool — basic query layer proving multi-period comparison ("last 7 days vs 6 / 12 / 18 months ago") on stored data.

### Shipped today (June 2, 2026 — 14 commits on main)

- **GA connector V1 ✅ DONE** (Phases 2–5 + dashboard — LORAMER_GA_OAUTH_V1 through LORAMER_GA_OVERVIEW_COMBINED_V1): OAuth, property picker, `ga-intelligence.ts`, Claude context + GA-vs-Shopify reconciliation, Analytics tab, sessions chart, property-name cleanup, Day/Week/Month granularity, compact GA on Overview/Combined. **Only Phase 6 disconnect pending** (`/api/ga/disconnect` + UI button).
- **Canonical date windows ✅** (LORAMER_DATE_RANGE_CANONICAL_V1): `src/lib/date-range.ts`; fixed LAST_MONTH = 60 days bug; Meta LAST_90_DAYS → `last_90d`.
- **Shopify net sales ✅** (LORAMER_SHOPIFY_NET_SALES_V1): verified Escential May = $45.00 vs Shopify Analytics.
- **Platform-nav fix ✅** (LORAMER_PLATFORM_NAV_FIX_V1): platform buttons now switch to Overview from non-ad tabs.
- **Google daily 90-day fix ✅** (LORAMER_GOOGLE_DAILY_90DAY_FIX_V1): explicit BETWEEN dates in `getDailyMetrics()`.
- **Supabase client dedupe ✅** (data migration, not in git): 16 duplicate name-pairs merged; keepers documented in CONTINUE_HERE.md. No duplicate names remain.

### Shipped this past week (May 27–29 recap)

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
- **GA Phase 1 foundation ✅ DONE May 29, 2026** → **GA V1 ✅ SHIPPED June 2, 2026** (see above). Design doc at `docs/GA_CONNECTOR_DESIGN_2026_05_29.md`. Phase 6 disconnect still open.
- **Launch Consolidation design doc ✅ FILED May 29, 2026 (LORAMER_DOCS_LAUNCH_CONSOLIDATION_DESIGN_V1):** Strategic doc at `docs/LAUNCH_CONSOLIDATION_DESIGN_2026_05_29.md` covering how loramer.com (marketing) + dashboard login page + dashboard app become ONE product at launch. Two questions tackled: (1) consolidation architecture — recommends app.loramer.com subdomain over merged repos or Vercel rewrites; (2) login UX rethink — Russ flagged Google OAuth feels generic in 2026 even though the "oh wow when all your clients are in" moment is real. Recommendation: ship email/password as secondary path now (Option A), reframe Google OAuth as discovery tool later (Option D). Sequencing: Phase 1 DNS work is cheap and safe to do soon; Phases 4-5 (login evolution) wait for a real plan after GA ships. Tomorrow's session should confirm or override these recommendations.
- **Landing page V3 (uploads differentiator + privacy/terms) ✅ SHIPPED May 29, 2026 evening:** Added the `.05` differentiator on the landing page ("Knows what only you know" — uploads as the moat-builder). Added /privacy and /terms pages to the loramer-landing repo with brand-aligned styling (Georgia + Instrument Sans, ink/paper/accent palette), updated footer with Privacy + Terms links. Privacy policy covers: waitlist data via Mailchimp, app data (Google/Meta/GA/Shopify), uploaded business docs, GDPR/CCPA/CAN-SPAM compliance, Shopify merchant data deletion, contact at russ@cotemedia.com. ToS adds a pre-launch status section, AI-feature disclaimer, uploaded-content licensing language. Single source of truth for both landing AND eventually the dashboard (which currently has its own /privacy and /terms — they'll be updated to redirect to loramer.com versions in a future consolidation).
- **Coming-soon landing page (loramer.com) ✅ V1+V2+V3 SHIPPED May 29, 2026:** Brand new repo `cote-media/loramer-landing`, live at https://loramer.com. See ROADMAP Project 5 for full detail. Lesson 17 added to discipline list (same-named files + `mv`).
- **GA4 connector design doc + connector architecture audit ✅ FILED May 29, 2026:** GA V1 now shipped (June 2). ConnectionPill extract still pending from audit recommendations.
- **Shopify abandoned checkouts ✅ SHIPPED May 29, 2026 (LORAMER_SHOPIFY_ABANDONED_CHECKOUTS_V1):** Phase 2.1 of the Shopify LTV design doc. Added `abandonedCheckoutCount?: number` to IntelligenceShopify via a separate fail-soft helper `fetchAbandonedCheckoutCount()` with its own try/catch — does NOT take down the main Shopify fetch if it errors. PII-free: only the `id` field is requested in the GraphQL query; no customer, email, address, or line item data passes through. Fail-soft on missing `manage_abandoned_checkouts` permission: returns undefined, prompt renderer skips the line entirely so Claude never sees a misleading zero. Decision change from the design doc: shipped COUNT only instead of count+rate, because full funnel data isn't API-available and any baked-in rate would be wrong. Verified live: Claude quoted "16 abandoned checkouts in this date range (compared to 49 completed orders)" verbatim. Phase 2.2 (true LTV) and 2.3 (cohorts) remain deferred per the design doc.
- **Shopify deeper signals ✅ SHIPPED May 29, 2026 (LORAMER_SHOPIFY_DEEPER_SIGNALS_V1):** Six derived metrics added to IntelligenceShopify, computed from the existing GraphQL response (no second API call). refundedOrderCount + refundRate from the previously-unused displayFinancialStatus field; returningRate as a labeled percentage; newCustomerAov + returningCustomerAov partitioned by customer.numberOfOrders; revenueConcentration as % of revenue from top 10% of orders. Verified live: Claude quoted refund rate (0%), returning AOV ($9,745.94), and concentration (61.5%) verbatim. Phase 2 — true LTV, abandoned cart, cohort retention — needs additional API calls and is filed as a design doc at docs/SHOPIFY_LTV_DESIGN_2026_05_29.md.
- **Prompt caching ✅ SHIPPED May 29, 2026 (LORAMER_PROMPT_CACHING_PHASE_1_REFACTOR_V1 + LORAMER_PROMPT_CACHING_PHASE_2_ENABLE_V1):** Project 22 closed out. Phase 1 refactored `buildClaudeContext` into a `{ prefix, suffix }` shape without changing any output — pure restructure, verified via three production read-back tests confirming hard constraints, conversation history, and analysis rules quote verbatim. Phase 2 wired `/api/chat` and `/api/insight` to send `system` as a typed array with `cache_control: { type: 'ephemeral' }` on the prefix block. Verified live: cache write at 13:17:29 UTC logged `cache_create: 11525`, cache read at 13:17:51 UTC logged `cache_read: 11525` — 42 seconds apart, within the 5-min TTL. ~25% savings on the second turn, ~70% on multi-turn chats. Phase 3 (two-tier caching) deferred until cache-hit data shows it would help. Lesson 16 added to discipline list — anchor-from-current-turn-bytes rule.
- **Intelligence honesty ✅ SHIPPED May 29, 2026 (LORAMER_INTELLIGENCE_HONESTY_V1):** Prompt builder used to silently drop a platform's entire section if `campaigns: []` AND unconditionally tell Claude "you have ALL data from ALL platforms" — guaranteeing the prompt-as-mirror hallucination pattern (Lesson 11) when Meta was quiet in the chosen window. Fix A: connected-but-empty platforms now emit an honest empty-state header. Fix B: completeness header is now dynamically generated per turn, listing each platform as populated / connected-but-empty / not-connected. Also removed the LORAMER_META_PLACEMENT_RAW_DEBUG_V1 raw-fetch instrumentation that should have been cleaned per Lesson 15. Full audit: `docs/INTELLIGENCE_ARCHITECTURE_AUDIT_2026_05_29.md` (the first ever Claude-Code-driven audit in this project, and a worked example of the discipline-rule "Claude.ai cannot read the local codebase — use Claude Code for whole-repo audits").
- **Stale intelligence cache (LORAMER_ROADMAP_STALE_INTEL_CACHE_V1):** After the honesty fix shipped, observed one test where the first Ask Claude answer on Vet Mastermind / last 7 days correctly said "Meta: no spend" but Meta DID have real spend in that window. Subsequent answers self-healed to "Meta: populated." The honest-empty branch is correctly reflecting whatever is in the cache — bug is upstream, either stale cache row or transient Meta fetch failure poisoning the cache. Filed in Project 8; needs reproduction next time it happens with full date/time/transcript to know which.
- **PMax Step 2g ✅ SHIPPED May 28, 2026 (LORAMER_HANDOFF_STEP2G_CLOSEOUT_V1):** `asset_group_top_combination_view` combinations query shipped, joined to readable asset text, dead `performance_label` read removed, prompt v2 with diagnostic empty-state, both populated and zero-conversion cases verified in production. ROADMAP / LAUNCH_PARKING updated. North-star asset-performance feature is live.
- **Project 14 Phase 4** — Cross-surface attribution (per-message surface labels + chronology). Design doc in `docs/PROJECT_14_PHASE_4_DESIGN.md`.
- **Project 9 Phase 2.2** — Changed circumstances detection. Design doc in `docs/PROJECT_9_PHASE_2_2_DESIGN.md`. 3 open questions pending Russ.
- **Upload / Knowledge feature — design filed, launch-critical (June 2, 2026, LORAMER_HANDOFF_UPLOAD_DESIGN_V1):** Full design at `docs/UPLOAD_FEATURE_DESIGN.md`. Extends Project 10. Locked: uploaded_docs stored SEPARATE from user_notes (fixes directive-regex bug); agency + client knowledge hierarchy at launch (agency docs curated/smaller, ride along on every client conversation); text-only storage (no originals); 25MB/file; managed malware-scan API now; prompt-injection defense = inject docs as delimited untrusted DATA never instructions. Bulk import flagged launch-adjacent. Surfaced a separate need: a lightweight in-app message/nudge layer (its own foundational item).

### Open items from real-world testing

- ✅ RESOLVED (May 28, 2026 — LORAMER_HANDOFF_STEP2G_CLOSEOUT_V1): PMax asset-level BEST/GOOD/LOW labels confirmed UI-only in v23 (validator-confirmed). Combinations report (`asset_group_top_combination_view`) is the API path and shipped in Step 2g.
- ✅ SHIPPED May 28, 2026 (LORAMER_PROJECT_3_STEP_3A_V1 / 3B_V1 / 3C_V1): Geographic + Device + Hour-of-day into Claude context. Verified in production: device split correctly identified desktop-only conversions on Search campaign, dayparting identified 12pm-5pm sweet spot with concrete bid-adjustment recommendations. Pure Claude-context addition, no UI surfaces (per directive: maximize what Claude sees, dashboard surfacing deferred).
- ✅ SHIPPED May 28, 2026 (LORAMER_PROJECT_3_STEP_3D_V1): Impression Share intelligence into Claude context. Validator-confirmed: true Auction Insights with competitor domains/overlap/outranking is UI-only in v23. API-accessible signal is impression share + lost-to-budget vs lost-to-rank decomposition. Verified in production: correctly distinguished rank-bottleneck campaigns (90% lost to rank, Quality Score 3 → recommend QS wort) from budget-bottleneck campaigns (17% lost to budget on converting campaign → recommend selective budget increase). Pure Claude-context, no UI surfaces.
- Performance briefings now complete in one shot (16k max_tokens). Confirmed working for full-year My Vacation Network analysis.
- Tier gating system itself doesn't exist yet — needed before Project 2 pricing tiers can launch.
- **`/api/context` verified present & correctly scoped (May 28, 2026)** — false alarm from zip omission, not a bug. (LORAMER_HANDOFF_CONTEXT_VERIFIED_V1)

### Open / urgent (June 2, 2026)

- ✅ **SECURITY (HIGH):** ✅ DONE June 3 except one — rotated & verified NextAuth secret, Meta app secret, both Google OAuth client secrets, Shopify client secret, and Supabase keys (migrated to new sb_secret/sb_publishable system). STILL OUTSTANDING: Google Ads developer token (prerequisite for the Google sync adapter).
- **GA Phase 6 disconnect** — `/api/ga/disconnect` + button on GA connection row (minor, closes V1)
- **Google date-path tech debt** — finish migrating all Google routes to `resolveDateWindow` (Project 8)
- **New roadmap items filed:** site-wide info tooltips, warm-start agency brain, client-list sort/filter/drag-drop, Project 18 scope expansion to all tabs — see ROADMAP.md

### Session — June 3, 2026 (evening): Security rotation + Historical Data Engine (Phase 0a) launched

**Security rotation (the June 2 exposed-secrets item) — DONE except one.** Rotated & verified: NextAuth secret, Meta app secret, both Google OAuth client secrets (login client + GA connector), Shopify client secret (gotcha: webhooks stay signed with the OLD secret until you revoke it — revoke to clear invalid_hmac on reconnect), and Supabase keys (migrated to the new sb_secret/sb_publishable key system; env var NAMES unchanged; legacy anon+service_role disabled). STILL OUTSTANDING: the Google Ads developer token — not yet rotated, and the prerequisite for the Google sync adapter below.

**Meta "no spend" bug — FIXED (commit 65db1a8).** Root cause: meta-intelligence.ts buildDatePreset mapped LAST_7_DAYS/LAST_30_DAYS to invalid Meta enums; valid enums are last_7d/last_30d. fetchAll also swallowed Meta errors and returned [] while reporting connected:true. Fixed the enums and made fetchAll throw on d.error. Verified in-app Claude now matches the dashboard.

**Historical Data Engine — Phase 0a built, deployed, VERIFIED.** The foundation for period-over-period / arbitrary historical analysis. Design: docs/HISTORICAL_DATA_ENGINE_DESIGN.md. Architecture: platform-agnostic daily-grain Supabase warehouse + nightly forward-capture cron + (later) backfill + (later) a Claude query layer.
- 0a.1 Schema — DONE. Tables created in Supabase SQL Editor: metrics_daily (daily fact table; UNIQUE(client_id,platform,entity_level,entity_id,date,breakdown_type,breakdown_value) for idempotent upserts; breakdown_type/value default ''), sync_state (forward + backfill progress per client×platform), google_tokens (user_email PK, refresh_token, access_token, expires_at). RLS enabled on all three, no policies (service-role only).
- 0a.2 Google refresh-token persistence — DONE (commit 0e1dee7). auth.ts jwt callback upserts the Google refresh token into google_tokens on sign-in (writes refresh_token only when present; never blocks login). Verified stored for cotebrandmarketing@gmail.com. Lets the cron reach Google without a session.
- 0a.3a Cron + Shopify adapter — LIVE & VERIFIED (commit a844ada + fixes). vercel.json cron "0 8 * * *" → GET /api/cron/sync. Bearer CRON_SECRET auth (trim-tolerant), resolveDateWindow('YESTERDAY') single-day capture, iterates clients × platform_connections, getValidShopifyToken → fetchShopifyIntelligence(single-day) → upserts metrics_daily (account + product rows) + sync_state, per-connection try/catch via serializeCaughtError, JSON summary. VERIFIED: influential-drones wrote account + product rows at $179.99 / 1 order for 2026-06-02, matching Shopify.
- 0a.3b Meta adapter — LIVE & VERIFIED (commit 961e5c7). Mirrors Shopify: Meta token from meta_tokens by user_email, single-day fetchMetaIntelligence, buildMetaMetricsRows → account → campaign → ad_set → ad rows (parents set), spend/impressions/clicks/conversions + conversion_value (revenue 0 for ad platforms), extra jsonb for ctr/cpc/cpm/roas. VERIFIED: Veterinary Mastermind account $90.80 = exact sum of its 3 campaigns; full hierarchy reconciles.

**CRON_SECRET** is set in Vercel (Production). A value was shared in plain text in chat during debugging — ROTATE it. Hard-won gotcha: it was first created as `CronSecret` (camelCase); the code reads process.env.CRON_SECRET, so the env var NAME must be exactly CRON_SECRET (case-sensitive).

**Shopify token-refresh failures — INVESTIGATED & RESOLVED (no customer impact).** The cron's 'refresh_failed' errors were all DEV/REVIEWER stores. Two self-healed (transient one-time-refresh-token races). The stale one was a DUPLICATE token row for the App Store reviewer demo store, whose refresh token was rotated away by another row for the SAME store under a different email. Real customer store (influential-drones) is clean. Root cause: multiple shopify_tokens rows per store under different user_emails fight over Shopify's one-time-use refresh token.

**Parked follow-ups (NOT urgent, no customer data at risk):**
1. Harden getValidShopifyToken: post-refresh DB save is fire-and-forget (returns ok even if it fails / matches 0 rows); guard a missing refresh_token in Shopify's response + the cron-vs-dashboard race. Same path serves the live app.
2. Dedupe shopify_tokens rows per store + reconcile the 3-way user_email keying (cron conn.user_email vs in-app session vs App Store shopify+{handle}@loramer.app).
3. Cosmetic: cron clientsProcessed double-counts clients with both Shopify and Meta.

**NEXT (where the next session picks up):**
1. Rotate the Google Ads developer token (Google Ads API Center) — closes the last exposed secret and unblocks Google.
2. Build 0a.3c — Google sync adapter (mirror the Meta adapter; GAQL daily pull per customer id; uses google_tokens refresh token + rotated dev token).
3. Build 0a.3d — GA + WooCommerce adapters.
4. Phase 0b — one-time backfill (races the ~37-month rolling purge on Google/Meta for old data).
5. Phase 3 — Claude query layer (tools that pull warehouse slices per question).

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

## First reply of a new chat

Consolidated into the **SESSION START GATE** at the top of this file — there is no separate first-reply checklist. (LoraMer's promise: the best business intelligence tool ever built. Be careful from message one.)

**26. RightPanel (star panel) renders TWO message containers (LORAMER_ALLSURFACE_SCROLL_V1, June 4, 2026).** A desktop panel (`hidden md:flex`, right side) and a mobile bottom sheet (`flex md:hidden`, `top-[25%]`) both render the same `messages` and are BOTH in the DOM at once - CSS toggles visibility, not conditional render. They share identical container classNames (`flex-1 overflow-y-auto px-4 py-4 space-y-3`), so any anchor on that line matches twice - assign by document order (desktop first). Mobile historically had NO scroll end-marker or effect. Claude surfaces that must open scrolled to bottom: ChatTab (fixed May 29), RightPanel desktop + mobile, InsightChat (`it-` container) - all now share one useLayoutEffect instant-on-mount / smooth-on-new-message pattern. General rule: page.tsx has desktop/mobile twin render blocks - audit BOTH when touching either.

**Phase 0b query layer (June 4, 2026 - LORAMER_QUERY_METRICS_0B_V1).** Built src/lib/metrics-query.ts + /api/query-metrics (CRON_SECRET-auth, read-only). queryMetrics({clientId, platforms[], level, baseRange, offsetsMonths[]}) sums metrics_daily per window (paginated, breakdown_type='' only) and builds equal-length comparison windows by shifting the base window END date back N calendar months. /api/chat is STILL single-shot (no tool-use loop) - wiring Claude onto the query layer is a deliberate later ship. Proving call: GET /api/query-metrics?clientId=...&platform=google&level=account&baseRange=LAST_7_DAYS&offsets=0,6,12,18 with Bearer CRON_SECRET.

**/api/chat is no longer single-shot (June 4, 2026 - LORAMER_QUERY_METRICS_TOOL_0B_V1).** It runs a capped tool-use loop (MAX_TOOL_TURNS=5) exposing query_metrics (-> src/lib/metrics-query.ts). clientId is injected server-side, never a model input; tools are passed only when clientId is present, and if Claude calls no tool the path is identical to the old single-shot behavior. Usage is summed across tool turns for spend logging. /api/insight (Haiku) deliberately has NO tools. Phase 0b complete; Phase 1 = generalize backfill to the other platforms + replace the curl/CRON_SECRET backfill trigger with an in-app button.

**All Claude surfaces share one tool loop (June 4, 2026 - LORAMER_QUERY_METRICS_SHARED_LOOP_V1 + LORAMER_INSIGHT_FOLLOWUP_SONNET_V1).** src/lib/claude-tools.ts is the single source of truth for QUERY_METRICS_TOOL + runQueryMetricsTool + runClaudeToolLoop. Both /api/chat (Sonnet) and /api/insight follow-ups (Sonnet, maxTokens 2000) call runClaudeToolLoop; the /api/insight auto-banner stays Haiku/no-tool. 2 ENGINES, 3 DOORWAYS: Ask Claude tab + star right panel -> /api/chat; blue insight box -> /api/insight. clientId is always injected server-side, never a model input. To add a future tool, add it once in claude-tools.ts and it lights up everywhere.

**Meta backfill (June 4, 2026 - LORAMER_BACKFILL_META_0B_V1).** /api/backfill/meta mirrors /api/backfill/google but: Meta connection (platform_connections platform='meta'), token from meta_tokens.access_token by user_email, fetcher = fetchMetaDailyMetrics in NEW src/lib/meta-ads.ts (account-level daily Graph v18 insights, time_increment=1 as a PARAM not a field per lesson 12, paginated, throws on Graph error). CHUNK_DAYS=90 (smaller than Google's 365 - Meta daily insights are touchier on long ranges; resumable via sync_state so a timeout just continues on re-run). CONVERSION-DEFINITION SEAM: backfill uses the account-level daily set (purchase/lead/complete_registration/offsite_conversion/submit_application; value=purchase, matching /api/meta/daily); the cron uses a per-campaign priority-pick (lead -> fb_pixel_lead -> fb_pixel_purchase -> insight.conversions, summed over spend>0 campaigns). Spend/impressions/clicks reconcile exactly; conversions differ in definition at the boundary. KNOWN DUPLICATION: the conversion mapping lives in both /api/meta/daily (inline) and src/lib/meta-ads.ts (mapMetaDailyInsightRow), identical today - unify later. Backfill v18 vs intelligence v21 - unify later. NEXT: surface a Meta conversion caveat in the query_metrics result.

**Meta conversion caveat in query layer (June 4, 2026 - LORAMER_QUERY_METRICS_META_CAVEAT_V1).** queryMetrics() now returns notes?: string[]. When Meta is in scope (platform=meta or all), notes carries: spend/clicks/impressions exact; Meta conversion counts use the account-level daily definition, directionally accurate, may not reconcile with campaign-level figures; surface only when conversions are central. The result is JSON-stringified into the tool_result Claude reads, so Claude can state the limit honestly without over-narrating. Meta backfill verified on MyVN: 565 rows to 2023-06-04.


---

## Session Wrap-Up Checklist (run EVERY time a session ends or rotates)

The consolidated version of the rotation + multi-machine sync + docs-with-code rules
above, in ONE place so no future session has to assemble it from three sections.
Never rotate mid-task; reach a clean breakpoint first. Do these in order:

1. CLEAN TREE, PUSHED. In Claude Code:
   `cd ~/Downloads/cotemedia-google-ads-manager && git status`
   Both must be true: "nothing to commit, working tree clean" AND "Your branch is up
   to date with 'origin/main'". If not, commit + push the pending work first.
   (iMac path: cotemedia-ads-manager.) Uncommitted/unpushed work does NOT travel to
   the next session or the other machine.

2. NEW LESSONS CAPTURED. If anything bit us this session that is not already in the
   "No same mistake twice" list, add it as a new numbered lesson here (same commit as
   the work, per docs-with-code).

3. HANDOFF CURRENT-STATE REFRESHED. Update this file so its current-state reflects what
   shipped this session: what's done, what's verified, what's the next thread. ROADMAP.md
   checkboxes should already be flipped per docs-with-code; double-check.

4. CONTINUE_HERE.md REWRITTEN for the next task. Scope it to the single next thing, with:
   the resume command (git pull), the next-task spec, any decisions already made, and the
   relevant facts/gotchas so the next chat does not re-derive them. CONTINUE_HERE reads
   AFTER the handoff + roadmap, never before.

5. DOCS COMMITTED + PUSHED. Commit the handoff/CONTINUE_HERE updates and push. Re-run
   `git status` to confirm clean + up to date (step 1 again).

6. DEPLOYS GREEN. Any code pushed this session should show a green Vercel deploy before
   walking away.

The paired START-of-session protocol lives in "What to do in the first message of a new
chat" + the Multi-machine sync ritual (git pull first). A fresh Claude reads
LORAMER_HANDOFF.md -> ROADMAP.md -> CONTINUE_HERE.md, then asks what to work on, before
any code.


---

### Session end - June 4, 2026 (query layer + all-surface tool wiring + Meta backfill)

Shipped + verified this session:
- LORAMER_ALLSURFACE_SCROLL_V1 - all Claude surfaces (RightPanel desktop + mobile, the
  InsightChat blue box) open scrolled to the latest message, matching the May 29 ChatTab
  fix. (Lesson 26: RightPanel has TWIN desktop/mobile render blocks - audit both.)
- LORAMER_QUERY_METRICS_0B_V1 - Phase 0b query layer: src/lib/metrics-query.ts (paginated
  aggregation over metrics_daily + equal-length multi-period windows) + read-only proving
  route /api/query-metrics. Proven on My Vacation Network (Google): 7d vs 6/12/18mo reconciles.
- LORAMER_QUERY_METRICS_TOOL_0B_V1 + _SHARED_LOOP_V1 + LORAMER_INSIGHT_FOLLOWUP_SONNET_V1 -
  query_metrics is now a Claude tool across ALL surfaces. src/lib/claude-tools.ts is the
  single tool-loop home. /api/chat (Sonnet) and /api/insight follow-ups (Sonnet, 2000 tok)
  both call it; the /api/insight auto-banner stays Haiku/no-tool. clientId injected
  server-side. 2 engines, 3 doorways.
- LORAMER_BACKFILL_META_0B_V1 - Meta account-level historical backfill (/api/backfill/meta +
  src/lib/meta-ads.ts). Verified on MyVN: 565 rows back to 2023-06-04. Conversion seam
  documented (account-level daily vs cron campaign-summed).
- LORAMER_QUERY_METRICS_META_CAVEAT_V1 - query_metrics result carries a Meta conversion
  provenance caveat (notes field) so Claude states the precision limit honestly when
  conversions are central, without over-narrating.

Phase 0b COMPLETE. Meta DONE for Phase 1.

NEXT THREAD (see CONTINUE_HERE.md): the in-app backfill button. Investigate-only assessment
done; three corrections are baked into CONTINUE_HERE: (1) per-platform laps + poll/resume,
NOT one-click-all-in-one-request (60s route cap, no background queue); (2) the session route
MUST add a client-ownership check - the existing backfill GET routes are CRON_SECRET-only
with no user_email ownership (latent IDOR); (3) extract the backfill loops into a shared lib
so the session POST route calls them directly (no CRON_SECRET in the browser path, no nested
timeouts) - also the registry that lets Shopify/GA/Woo plug in later.

NOTE: the Meta conversion caveat shipped as V1 then was strengthened to LORAMER_QUERY_METRICS_META_CAVEAT_V2 (firmer "MUST add a one-line note when reporting conversions/CPA" wording). VERIFIED live June 4 - a Meta conversions/CPA question gets the caveat appended; spend-only answers stay clean.


---

## Session Start / Handoff Protocol — MOVED

The authoritative resume protocol is the **SESSION START GATE at the top of this file** (its SESSION RESUME paste replaces the old numbered steps + ground-truth command). The two standing directives below survive because they're not fully captured there:

**Use Claude Code for deep-dive research.**
<!-- LORAMER_CLAUDE_CODE_DEEP_DIVE_DIRECTIVE_V1 -->
For anything where getting it exactly right depends on code you can't fully see — multi-file reads, whole-repo audits, tracing how a function is used, confirming a field or type, verifying against the real file — read the live repo directly (Claude Code runs locally, investigate-only first) rather than guessing from memory or the lagging project panel. Lighter tasks that don't hinge on unseen code can proceed directly.

**The overriding rule:** whenever there is even a slim doubt that the next step is 100% correct and mistake-free, STOP and verify — read the file, investigate, or ask — before producing the step. Caution over speed, every time. (Reinforces "right > fast" and investigate-first.)

**Panel + memory are background only:** the mounted project panel and your background memory routinely lag the repo by days; that's normal — never remark on their dates or call them "stale." The live repo (git pull output + commit log) is the only source of truth. Reconcile silently and proceed.


---

## SESSION ADDENDUM — June 4-5, 2026 (backfill button + deep history)
<!-- LORAMER_BACKFILL_DEEP_SESSION_2026_06_04 -->

The authoritative current state now lives in CONTINUE_HERE.md (read it). Headlines:
- In-app backfill button shipped (Phase 1): shared engine `src/lib/backfill/`
  (run-backfill.ts + adapters.ts), thin CRON GET wrappers, session POST
  /api/backfill/run (ownership-gated), GET /api/backfill/status (honest label),
  read-only /api/backfill/probe, and `src/app/clients/BackfillControl.tsx` on
  /clients (google+meta). The CRON_SECRET curl is retired.
- Deep-history V2: 132-month floor + per-chunk error resilience + honest
  earliest-from-data label. PROVEN on "Bath Fitter | O'Gorman Bros" — full real
  history (earliest 2020-01-27, 1,933 days), total_spend $2,293,179.80 reconciling
  to Google's all-time $2.29M to the penny.

### New lessons
- Lesson 29 - Heredoc/terminal code pastes silently DROP characters (we hit
  `fetchDaily` -> `fetcaily` and `NextResponse` -> `Nexesponse`, each a single
  mangled occurrence while every other copy was correct). Deliver code as
  downloadable files/zips (byte-exact); never paste multi-line code through the
  terminal. `tsc` catches mangled IDENTIFIERS; it does NOT catch mangled STRING
  LITERALS in untyped calls (e.g. a Supabase column name) - grep the critical
  strings after writing.
- Lesson 30 - Backfill depth = "as deep as the platform will serve," discovered by
  PROBING a wide date range, not a fixed cap. Always report the ACTUAL earliest row
  held (min(date) in metrics_daily), never the swept cursor target - the swept
  target lies (it claimed depth that had no data behind it).
- Lesson 31 - Per-platform retention differs and must be respected, not assumed:
  Google Ads = rolling 37-month granular / 11yr aggregate (effective Jun 1 2026,
  but the API still served full history on Jun 4 - backfill urgently while it
  lasts); GA4 = 2/14/50mo for event/user (Explorations) but aggregate is indefinite
  and the Data API serves it unrestricted; Shopify/Woo = no purge clock. Instrument
  (probe) before trusting any documented limit.
- Lesson 32 - JSX comments live in {/* */}, not /* */ (LORAMER_BACKFILL_GA_UI_V1,
  Jun 5). Wrapping a JSX element around an expression-position comment turns it
  into literal VISIBLE text: `{cond && ( /* X */ <div>...` is a valid JS comment,
  but `{cond && (<div> /* X */ <inner/>...` renders the string "/* X */" on the
  page. tsc does NOT catch it (valid JSX text, not a type/syntax error — Lesson
  14 family). In JSX children, comments MUST be {/* X */}. Caught in diff review.
- Lesson 33 - CRON-GATED VERIFICATION: A change whose only proof-of-correctness
  is the once-daily forward-capture cron (~08:45 UTC / ~04:45 ET) must be
  deployed BEFORE that window, or verified immediately by manually invoking
  /api/cron/sync (with CRON_SECRET) right after deploy. Deploying after the
  day's run already fired forces a ~16h wait. Never plan the dependent locking
  step for a session that can't reach a cron cycle. TWO SPECIFICS (hit Jun 5):
  (a) the capture writes YESTERDAY's date (resolveDateWindow('YESTERDAY')), so
  the gate-clearing run for day D is the FIRST run after midnight UTC of D+1 —
  a manual trigger before midnight UTC just re-updates D-1 and clears nothing;
  (b) the manual same-day workaround is curl-ing /api/cron/sync with
  "Authorization: Bearer CRON_SECRET" AFTER midnight UTC instead of waiting
  for the ~08:45 scheduled run.

### Universal backfill pattern (institutional)
Adding a platform backfill = register an adapter in `src/lib/backfill/adapters.ts`
(loadToken + fetchDaily + chunkDays + labels) + add it to `backfillAdapters` +
render <BackfillControl> on that platform's /clients row. The engine and the
run/status/probe routes are platform-agnostic. See CONTINUE_HERE.md ->
"HOW TO ADD A NEW PLATFORM BACKFILL".

## SESSION ADDENDUM — June 5, 2026 (GA backfill + engine made platform-agnostic)
<!-- LORAMER_BACKFILL_GA_SESSION_2026_06_05 -->

GA4 historical backfill shipped end-to-end, and the shared engine was
generalized so any non-ads platform rides it without forking.

- Engine V3 (LORAMER_BACKFILL_SHARED_LIB_V3): three OPTIONAL adapter hooks —
  resolveContext (override platform_connections + loadToken resolution),
  buildRows (override the ACCOUNT-LEVEL row mapping), floorDate (per-adapter hard
  floor). Adapters setting none (Google, Meta) behave EXACTLY as V2; the default
  row mapping was verified byte-identical.
- GA daily fetch (LORAMER_GA_DAILY_FETCH_V1): fetchGaDailyMetrics in
  ga-intelligence.ts — per-day series via a date-dimension runReport, mirroring
  the proven fetchAccountTotals/fetchEcommerce metric groupings, resiliently.
- Shared GA row builder (LORAMER_GA_METRICS_ROW_V1): gaExtra + buildGaMetricsRows
  extracted from cron/sync into src/lib/intelligence/ga-metrics-row.ts so
  forward-capture AND backfill write byte-identical rows (same conflict key).
  Param widened to a GaMetricsInput Pick so IntelligenceGa and GaDailySlice both
  feed it without a cast.
- GA adapter (LORAMER_BACKFILL_GA_ADAPTER_V1): registered via the V3 hooks —
  resolveContext uses getValidGaToken(clientId, userEmail), entity_id =
  gaPropertyId (same source as forward-capture), floorDate '2015-08-14' (GA Data
  API hard floor, proven by probe).
- GA CRON wrapper (LORAMER_BACKFILL_GA_0B_V1) at /api/backfill/ga + UI mount
  (LORAMER_BACKFILL_GA_UI_V1): <BackfillControl platform="ga"> on the GA row.

VERIFIED: probe found GA's API-wide hard floor = 2015-08-14; My Vacation
Network's real data floor = 2022-12-14. Headless backfill wrote 1266 rows
(== probe rowCount), earliest 2022-12-14, per-day sessions byte-matched the
probe, complete:true, no error. UI shows "complete back to 2022-12-14".
Confirmed on a second new GA client too.

ADDING A NEW PLATFORM BACKFILL (now): (1) a daily fetch returning per-day
slices, (2) a shared row builder matching forward-capture, (3) register an
adapter (resolveContext/buildRows/floorDate hooks for non-ads shapes, defaults
for ads), (4) a thin CRON wrapper, (5) mount <BackfillControl>. Shopify + Woo
are next and follow this exactly — no purge clock, not urgent.

KNOWN ROUGH EDGE (pre-existing, NOT from this session): Meta backfill shows
"partial / Resume" that never completes. Meta's data IS captured back to the
account's first day; the issue is Meta's fetch THROWS when swept before the
account's first data (Google returns empty instead), so the engine catches,
stops, and never marks complete. Cosmetic, not data loss. Fix = give Meta a
floorDate and/or have its adapter return [] on out-of-range windows (the
roadmap's "per-adapter floor for Meta"). Diagnose with a headless run
(stoppedOnError:true) before fixing.

## Lesson 34 — Handoffs anchor on session TAG + files, never a commit hash
(Numbered 34, not 26 as drafted — Lesson 26 already exists: "RightPanel has TWIN
desktop/mobile render blocks"; sequence was already at 33.)
Local commits are squashed on push and rewritten, so a hash recorded in a handoff (e.g. 088b687) never appears on origin and the resume check fails every time. Verify instead: clean fast-forward pull + the LORAMER_*_V1 session tag in HEAD's message + an ls/grep proving the named deliverable files exist.

## Lesson 35 — pg_dump in CI: invoke by ABSOLUTE path
Use the full path `/usr/lib/postgresql/17/bin/pg_dump`, never bare `pg_dump`. On Ubuntu runners the `pg_wrapper` shim resolves bare `pg_dump` to a preinstalled OLDER client (v16), which refuses to dump a newer server (17.6) with "server version mismatch." Installing `postgresql-client-17` is NOT enough — PATH still wins, so the wrapper picks v16. Pin the absolute v17 binary and echo `--version` right before the dump as log proof. (LORAMER_OFFSITE_R2_BACKUP_PGDUMP17_FIX_V1, db-backup.yml.)

## Lesson 36 — GitHub Actions "Re-run jobs" replays the ORIGINAL commit
"Re-run jobs" re-runs the workflow file as it was at the commit that triggered the original run — NOT current `main` HEAD. To test a workflow FIX you just pushed, start a fresh "Run workflow" (workflow_dispatch) so the updated file actually runs; re-running the failed job will just replay the broken version.

## Lesson 37 — Vercel env rotation needs a redeploy; native cron rotates atomically
Serverless functions bind environment variables at deploy time, so changing a Vercel env var is NOT live until a redeploy. Vercel-native cron auto-injects secrets from the SAME project env at run time, so updating the var + redeploy rotates the function's check AND the scheduler together — there is no separate caller to update. (Confirmed during the CRON_SECRET rotation: new value in Vercel → redeploy → prod verify NEW bearer 200 / junk 401; next 08:00 UTC cron auto-used it.)

## Lesson 38 — Supabase DB password is reset-safe for LoraMer
The raw Postgres DB password isn't viewable after creation — only resettable. Resetting it is SAFE: the app authenticates to Supabase via the API keys (anon/service-role), not the raw DB password. Only raw-Postgres consumers care about it (e.g. `pg_dump` in the backup Action, the Supabase MCP). After a reset, update only those consumers' connection strings.

## Lesson 39 — A DB write that expects 1 row must check the affected count and log on 0 (LORAMER_STRIPE_PHASE3_FIX_UPSERT_V1)
An `UPDATE ... WHERE key = x` against a row that doesn't exist affects 0 rows and returns NO error — a silent no-op. The Stripe webhook resolved `tier=business` correctly but wrote it with `update().eq('user_email', …)` while the user had no `user_profiles` row (they'd bypassed the welcome gate), so the tier landed nowhere and `/billing` showed Free over an active subscription — a bug that hid for a full click-test. Rules: (1) any write that conceptually "must touch a row" uses UPSERT, not UPDATE, when the row's existence isn't guaranteed; (2) where a 1-row effect is expected, pass `{ count: 'exact' }` and `console.error` loudly on `count === 0`. Never assume a write happened because it didn't throw.

## Lesson 40 — Never render internal flag/enum keys to users (LORAMER_STRIPE_PHASE3_FLAGLABELS_V1)
`/billing` printed raw `feature_flags` keys ("wyws, priority_support, white_label, …") straight from `plan_entitlements` to the customer. Internal DB keys (flags, enums, status codes, tier slugs) must pass through a human-label map before they hit a user surface — keep the map next to the keys (e.g. `FLAG_LABELS` in `src/lib/billing/plans.ts`) so adding a key forces adding its label. Same discipline as Lesson 11 (prompt-as-mirror): be deliberate about which strings are for the machine vs. for the human.

## Lesson 41 — Stripe Customer Portal "cancel at period end" sets cancel_at, not cancel_at_period_end (LORAMER_STRIPE_PHASE4_VERIFIED_V1)
When a customer cancels via the hosted Customer Portal with the config's cancellation mode = at_period_end, Stripe represents the scheduled cancellation as `subscription.cancel_at` (a unix timestamp = period end) and leaves `subscription.cancel_at_period_end = false`. (This differs from a programmatic `subscriptions.update({cancel_at_period_end:true})`, which sets the boolean.) Verified Jun 10 2026: portal showed "Cancels Jun 10 2027" while BOTH Stripe and our subscriptions mirror read cancel_at_period_end=false — the mirror was correct, it faithfully matched Stripe. Entitlement was unaffected because we key grant off `status` (active → entitled) and the eventual `customer.subscription.deleted` drops the tier to free. The gap: any UI/logic that reads `cancel_at_period_end` to show "your plan will cancel on X" will MISS a portal-scheduled cancel. Fix when needed: add a `cancel_at` column to the subscriptions mirror and treat "will cancel" as `cancel_at_period_end OR cancel_at IS NOT NULL`. Don't trust the boolean alone once the portal is the cancel path.

## Lesson 42 — Google OAuth consent-screen edits trigger RE-verification (LORAMER_GOOGLE_OAUTH_APPROVED_V1, 2026-06-10)
The adwords sensitive-scope verification was APPROVED 2026-06-10 (GCP project savvy-palace-495920-v2; the unverified-app warning is gone). Google's approval email warns that ANY change to the OAuth consent screen configuration — app name, authorized domains, scopes, homepage/privacy/TOS URLs, or logo — sends the app BACK into verification (the unverified warning can reappear meanwhile). So: treat the consent screen as frozen during launch; batch any domain/URL changes deliberately and budget a re-review window; never edit it mid-cohort. This is the binding constraint on the **homepage unification** work (loramer.com ↔ app.loramer.com) and on adding any new OAuth scope (e.g. when write/ad-management ships). Verify the current consent-screen state before proposing any change that touches it.

## Standing rule — End every session by refreshing CONTINUE_HERE.md
At the end of each session, the strategy Claude rewrites the "NEXT STEP" line (one sentence: the very next action) and the state notes at the top of CONTINUE_HERE.md, and Claude Code commits it. The "▶ RESUME LORAMER" header block is static — never edit it.

## Standing rule — Keep LORAMER_CODEBASE_MAP.md current via git, not memory
At each handoff run: git diff --name-status $(git log -1 --format=%H -- LORAMER_CODEBASE_MAP.md)..HEAD
If the output has any A (added), D (deleted), or R (renamed) entries, the codebase shape changed — update the affected section(s) of LORAMER_CODEBASE_MAP.md and its "Map last verified" line in the same commit. If only M (modified) entries appear, the map is still accurate — leave it. The map is architecture-level only: never add line numbers, counts, or implementation specifics.
