# LORAMER_UI_INVENTORY.md — the ONE UI list
<!-- LORAMER_UI_INVENTORY_V1 -->

⛔ **THIS FILE SUPERSEDES EVERY PRIOR PARTIAL UI LIST.** Built 2026-08-23 by HARVESTING what was already
banked (LORAMER_QUEUE_OF_RECORD · AUDIT_FINDINGS · LORAMER_DECISIONS · ROADMAP), DEDUPING across those
sources, and only THEN sweeping the tree for items banked nowhere. Prior passes each produced *another*
partial list because each started with a fresh sweep; this one started with the harvest.

⛔ **WHAT THIS FILE IS NOT: A SECOND OWNER.** The QUEUE still owns open/closed per item and DECISIONS still
owns settled status. Every line below carries its provenance and is a POINTER, not a copy. When an item
ships, close it where it lives and strike it here in the same commit.

⚠ **THE HONEST DENOMINATOR, stated because a list like this reads as exhaustive and is not.** The harvest is
complete for items that carry a ★ token or a `[LC]/[NP]/[EXT]/[DG]` tag. It is a FLOOR for two populations:
(a) ROADMAP's 275 unchecked boxes, many of which restate a queue item in different words and were deduped by
reading rather than by a key; (b) chat-only items never banked anywhere, which by definition cannot be
harvested — the sweep in §UNBANKED reaches only what left a trace in the tree.

---

## COUNTS

⛔ **EVERY NUMBER BELOW IS COUNTED FROM THIS FILE'S OWN LINES, not estimated.** Recount at any time:
`grep -cE '^- \[[A-Z-]+\]' docs/LORAMER_UI_INVENTORY.md`

- RAW harvested rows (before dedupe): **153**
- DEDUPED items: **129**
- Collapsed by dedupe: **24** — see §DEDUPE LEDGER. *The gap is itself a finding: about one in six banked UI
  rows was a second copy of a defect already banked somewhere else.*
- UNBANKED: **4 new items** (flagged inline) **+ 2 newly-named CAUSES** under symptoms already banked — see §UNBANKED
- LEFT THIS LIST as data/capture mis-filed as UI: **4** → §WALK TRACK
- CORRECTNESS defects (a user is shown something untrue): **22**
- EXPERIENCE defects: **107**

---

## 1. LAYOUT & OVERFLOW — content that runs off the screen or clips (16)

- [LAYOUT] Ask-Lora sheet pans sideways on a wide table; the send arrow leaves the screen and the dashboard shows through around the sheet · -next chat, iPhone Chrome+Safari · EXPERIENCE · QUEUE:976 ★UI-OVERFLOW — ⛔ four theories wrong, two prod fixes did not resolve it
- [LAYOUT] Same wide-table/code-block overflow exists on the LEGACY chat, which is where the Shopify reviewer is pinned · /dashboard · EXPERIENCE · QUEUE:986 ★LEGACY-CHAT-OVERFLOW
- [LAYOUT] A fenced code block does not wrap on a phone, so tables lose columns off the right edge and prose is cut mid-sentence · -next chat · EXPERIENCE · QUEUE:117 ★FENCED-BLOCK-OVERFLOWS-ON-MOBILE
- [LAYOUT] Lora's tables bleed out of their container on mobile AND desktop across every Lora surface · all Lora surfaces · EXPERIENCE · QUEUE:720 #2
- [LAYOUT] Connection rows do not wrap at ~390px: the platform name breaks mid-word, badges overrun labels, the last button clips at the screen edge · -next client profile · EXPERIENCE · QUEUE:78 ★RECONNECT-HAS-NO-STATE-MACHINE (iii) — PRE-EXISTING; `redesign.module.css:350` has no flex-wrap and every control is flex-shrink:0
- [LAYOUT] Store breakdown card Y-axis labels truncate ("FoamOh Original Pl") · -next store · EXPERIENCE · QUEUE:681 STANDING UX BAR (1)
- [LAYOUT] The value-model gate renders ON TOP of the open chat on any client with no value model set · -next client profile · EXPERIENCE · QUEUE:987 ★CHAT-GATE-ZINDEX
- [LAYOUT] Chat composer: content appears below the composer and a dead white gap opens during scroll · -next chat, Chrome iOS · EXPERIENCE · QUEUE:1070 ★CHROME-IOS-COMPOSER (1)(2) — ACCEPTED as motion transients
- [LAYOUT] The caret escapes the input while typing · -next chat, Chrome iOS · EXPERIENCE · QUEUE:1070 ★CHROME-IOS-COMPOSER (3) — the one symptom still open
- [LAYOUT] The chat lands scrolled to the bottom of an EMPTY thread, and the messages then load underneath it · -next Lora page · EXPERIENCE · QUEUE:1177 ★CHAT-LANDING-FIRES-BEFORE-HYDRATION
- [LAYOUT] Scrollbar thumb and the content being dragged belong to different elements · -next chat · EXPERIENCE · QUEUE:1062 CHAT-UI DAY (b)
- [LAYOUT] `layout.tsx` hard-codes `fontFamily: Georgia` inline on `<body>`, overriding globals.css — the root cause of every font fight · whole app · EXPERIENCE · ROADMAP:365
- [LAYOUT] Column picker menu escapes its clipping container — FIX BUILT, on-device Gate-B never run · -next platform page · EXPERIENCE · QUEUE:671 P-PL#2
- [LAYOUT] Chat as a sibling panel that SHRINKS the dashboard rather than covering it; panel width becomes a real breakpoint · -next desktop · EXPERIENCE · QUEUE:1081 ★CHAT-DESKTOP-SIDE-PANEL
- [LAYOUT] Landing-scroll probe compares two different origins (`scrollHeight` vs `innerHeight`) so its overflow readout cannot be trusted · instrumentation · EXPERIENCE · QUEUE:1178 ★LANDING-PROBE-SPEC-IS-WRONG
- [LAYOUT] Probe `y` flipped 0→763 while `sH` read 763 in the same tick — internally inconsistent, deliberately unexplained · instrumentation · EXPERIENCE · QUEUE:1179 ★LANDING-PROBE-Y-FLIP-UNEXPLAINED

## 2. CHAT SURFACE — the Ask-Lora experience itself (17)

- [CHAT] A 59-second answer shows a dead spinner instead of arriving progressively; the browser gives up on an answer that exists · -next chat · EXPERIENCE · QUEUE:989 ★CHAT-STREAMING + QUEUE:1061 5b
- [CHAT] No stop button; no status indicator; no working-state mark — all three are downstream of streaming · -next chat · EXPERIENCE · QUEUE:1061 (★CHAT-STOP-BUTTON · ★CHAT-STATUS-INDICATOR · ★LM-MARK-LIVE)
- [CHAT] The whole answer re-parses on every streamed delta — the jank source · -next chat · EXPERIENCE · QUEUE:1062 CHAT-UI DAY (a)
- [CHAT] Device shows "Working…" after the stream reported it was streaming — status frames never reach the render · -next chat · EXPERIENCE · QUEUE:1087 ★CHAT-SURFACE-UNIFICATION-PLAN flight 3
- [CHAT] Composer does not auto-grow with content; send can appear stuck · -next chat · EXPERIENCE · QUEUE:1087 flight 2
- [CHAT] The Ask-Lora input box is far too small on mobile; no auto-scroll to bottom, no full-height sheet · -next chat, mobile · EXPERIENCE · QUEUE:673 P-PL#3
- [CHAT] A copy button on code blocks exists; an EXPAND control does not · -next chat · EXPERIENCE · QUEUE:118 ★CHAT-BLOCK-EXPAND-CONTROL
- [CHAT] No "+" affordance to attach a doc or screenshot from inside chat · -next chat · EXPERIENCE · QUEUE:1078 ★CHAT-UPLOAD-IN-COMPOSER (V1 = docs only)
- [CHAT] No way to export an answer (PDF / Markdown / email) · -next chat · EXPERIENCE · QUEUE:793 N5.1 + ROADMAP:105-107
- [CHAT] An answer written 10s after the mount read is never picked up — no refresh trigger fires · -next chat · CORRECTNESS · QUEUE:1168 ★CHAT-REFRESH-TRIGGERS-MISS-THE-WRITE
- [CHAT] A user cancelling a turn can kill the close path that persists the answer and logs spend · -next chat · CORRECTNESS · QUEUE:1102 ★VERCEL-CANCELLATION-KILLS-THE-CLOSE-PATH
- [CHAT] The chat extraction and its follow-up were REVERTED the night they shipped; the unification is unstarted · -next chat · EXPERIENCE · QUEUE:1158 ★CHAT-SURFACE-REVERTED-2026-08-05
- [CHAT] The whole ChatLauncher scroll/layout/state surface needs ONE workstream, not one-off patches · -next chat · EXPERIENCE · QUEUE:459 ★CHAT-UI-DEDICATED-DAY
- [CHAT] No saved-chats browser · -next · EXPERIENCE · QUEUE:~707 (CONTINUE_HERE QUEUED)
- [CHAT] Chat thread identity across surfaces is unsettled · -next · EXPERIENCE · QUEUE:1081 (★CHAT-THREAD-IDENTITY, points at the side-panel entry)
- [CHAT] At $0 Anthropic balance Lora does not degrade — she BLANKS, with no cap and no message anywhere in the product · all Lora surfaces · CORRECTNESS · QUEUE:255 ★USAGE-CAP-ABSENT
- [CHAT] Lora answered the same question twice in one turn · -next chat · CORRECTNESS · QUEUE:116 ★LORA-ANSWERED-TWICE

## 3. MOBILE & VIEWPORT — iOS keyboard and visual-viewport behaviour (6)

- [MOBILE] `interactive-widget=resizes-content` would close this entire class outright; WebKit has not implemented it · -next, iOS · EXPERIENCE · QUEUE:1147 ★IOS-NO-STANDARDS-FIX
- [MOBILE] `visualViewport.offsetTop` never resets after the iOS keyboard dismisses; the Lora header stays displaced · -next chat, iOS · EXPERIENCE · QUEUE:1148 ★IOS-VISUAL-VIEWPORT-OFFSETTOP-NEVER-RESETS
- [MOBILE] The keyboard-inset detector computes structurally zero on Chrome iOS and cannot fire · -next chat · EXPERIENCE · QUEUE:1106 ★KB-INSET-DETECTOR-STRUCTURALLY-ZERO
- [MOBILE] The chat probe display live-updates forever because its freeze latch never engages · instrumentation · EXPERIENCE · QUEUE:1071 ★CHAT-PROBE-DISPLAY-CANNOT-SHOW-DISMISSAL
- [MOBILE] No path from mobile to the all-clients card grid — the dropdown has no "all clients" · -next mobile nav · EXPERIENCE · QUEUE:721 #3
- [MOBILE] Mobile can no longer author card arrangement; `view.layoutSm` is empty on all 17 stored rows · -next CardEngine · EXPERIENCE · DECISIONS LORAMER_NEXT_MOBILE_LAYOUT_V1 status 2026-08-16

## 4. NAVIGATION & ROUTING — where a click lands (9)

- [NAV] ✅ CLOSED 2026-08-23 — the Team page showed one client while the URL said another and Ask-Lora answered about the wrong one; fixed and guard-held before this audit ran, and the entry was merely stale · -next team · **CORRECTNESS** · QUEUE:923 #2 — closed on the dangerous-five diagnosis
- [NAV] Team sits in the client-scoped rail but is an ORG-level surface; it belongs in the account menu · -next rail · EXPERIENCE · QUEUE:924 #3
- [NAV] The per-platform drill pages do not exist as routes at all · /dashboard-next/{google-ads,meta-ads,shopify,analytics} · EXPERIENCE · QUEUE:663
- [NAV] `/dashboard-next/clients` silently ignores `?clientId=` — the only -next page taking no props · -next · EXPERIENCE · QUEUE:1161 ★NEXT-CLIENTS-PAGE-IGNORES-CLIENTID
- [NAV] The Lora back chevron's fallback lands on ALL CLIENTS rather than the client you came from · -next Lora page · EXPERIENCE · QUEUE:1160 ★LORA-BACK-FALLBACK-TARGETS-ALL-CLIENTS
- [NAV] Switching clients keeps the previous scroll position instead of landing at the top · -next, all pages · EXPERIENCE · QUEUE:936 SCROLL-TO-TOP ON CLIENT SWITCH
- [NAV] Single-ad-platform clients are missing their platform tab in the dashboard rail · /dashboard · EXPERIENCE · QUEUE:743 #11 + AUDIT_FINDINGS:64
- [NAV] A carried-valid tab renders empty on an ad→ad platform switch · /dashboard · EXPERIENCE · QUEUE:861 activePlatform sibling-axis
- [NAV] The founder cannot reach `/dashboard-next/*` with his own working email — not in the allowlist · -next · EXPERIENCE · QUEUE:342 ★FOUNDER-EMAILS-NOT-ALLOWLISTED

## 5. DATA-DISPLAY CORRECTNESS — the surface shows something untrue (12)

- [DATA] ⛔ The Age (Meta) card renders an ERROR STRING as its body, where the data belongs · -next Overview, The Escential Group, seen in prod · **CORRECTNESS** · QUEUE:1172 ★NEXT-OVERVIEW-AGE-CARD-SHOWS-ERROR-STRING
- [DATA] ⛔ The completeness meter shows CONNECTED platforms as NOT_CONNECTED when the readiness RPC times out — on the surface built to prove capture honesty · -next client profile · **CORRECTNESS** · QUEUE:565 + QUEUE:1145 (same root cause, two entries)
- [DATA] ⛔ The readiness checklist stays empty and the % stays stuck at 61% while the fields say "Saved" — the checklist reads a different source than the field writes · -next client profile · **CORRECTNESS** · QUEUE:925 #4
- [DATA] ⛔ The legacy dashboard's Shopify chart counts cancelled orders, so it shows more orders than Lora and a LOWER average order value for the same client — revenue agrees, the order count and AOV do not · /dashboard · **CORRECTNESS** · AUDIT_FINDINGS:47 #6b — RESTATED 2026-08-23: not two revenues; a cancelled order's subtotal is $0 (measured, #6)
- [DATA] "Meta is still importing history — no action needed" may be false for BASE data · -next · **CORRECTNESS** · QUEUE:~926 #5
- [DATA] `campaign.advertising_channel_type` renders as a raw enum NUMBER in front of a user · dashboard · **CORRECTNESS** · QUEUE:231 ★CHANNEL-TYPE-ENUM-UNMAPPED
- [DATA] Store compare legend labels BOTH windows with the same date range · -next store · **CORRECTNESS** · QUEUE:~679 S-PL#5
- [DATA] Woo captured-READ display still caps products at top-10 · /dashboard · **CORRECTNESS** · QUEUE:~656
- [DATA] Geo card params (geoGrain/geoScope) are not forwarded, so the card cannot ask for the grain it displays · -next · **CORRECTNESS** · QUEUE:~955 ★G2.8
- [DATA] Lora reports missing data as ZERO and partial coverage as COMPLETE on grain-absence questions · all Lora surfaces · **CORRECTNESS** · QUEUE:431 ★HONESTY-ENFORCERS-MISS-GRAIN-ABSENCE
- [DATA] Stale intelligence cache can serve an EMPTY Meta payload · /dashboard · **CORRECTNESS** · ROADMAP:362
- [DATA] Meta spend>0 filter silently hides ad-set structure · /dashboard · **CORRECTNESS** · ROADMAP:364

## 6. LOADING / EMPTY / ERROR STATES (9)

- [STATE] Overview at Last 90 days shows "Couldn't load data — the request failed"; the same client/range loads fine on Analytics · /dashboard · EXPERIENCE · AUDIT_FINDINGS:128
- [STATE] "Loading..." text instead of skeletons anywhere content is pending · whole app · EXPERIENCE · ROADMAP:255 + QUEUE:779 P5
- [STATE] Empty states are thin and give no guidance about what to do next · whole app · EXPERIENCE · ROADMAP:260 + QUEUE:779 P5
- [STATE] No error boundaries with friendly messages — a client-side exception is a white screen · whole app · EXPERIENCE · QUEUE:784 P8
- [STATE] Portfolio-insights card on the all-clients page is a neutral PLACEHOLDER until the proactive engine lands · -next clients · EXPERIENCE · **UNBANKED** · MultiClientOverview.tsx:182
- [STATE] Each client card shows a neutral status placeholder — no working / needs-attention signal · -next clients · EXPERIENCE · **UNBANKED** · MultiClientOverview.tsx:347
- [STATE] Backfill has no progress meter and needs a manual Resume · -next + /clients · EXPERIENCE · QUEUE:~719 #1/#6
- [STATE] Onboarding has no post-connect nudge layer · -next · EXPERIENCE · QUEUE:~708
- [STATE] Encrypted-PDF rejection copy is harsh · /api/knowledge surface · EXPERIENCE · QUEUE:~711

## 7. FORMS & INPUTS (8)

- [FORM] The Meta ad-account picker renders all 199 accounts in one scrolling modal with no search or filter · -next client profile · EXPERIENCE · QUEUE:522 ★META-PICKER-SCALE + ROADMAP:245 + QUEUE:779 P5 (three entries, one defect)
- [FORM] Bracket-prefixed names ("[do not use] …") sort ABOVE the real accounts in that picker · -next · EXPERIENCE · QUEUE:522
- [FORM] The NAICS picker is 6-digit only, so a 3-digit subsector cannot be selected · -next client profile · EXPERIENCE · QUEUE:808 ★NAICS-PARENT-CODES
- [FORM] The value-model gate is hard and non-dismissable, yet 11 of 28 clients have no value model — they got in another way · -next client profile · EXPERIENCE · QUEUE:804 ★VALUE-MODEL-COVERAGE-GAP
- [FORM] The value-model modal is a stub Russ wants fully built · -next · EXPERIENCE · QUEUE:~710 VALUE-MODEL POPUP polish
- [FORM] Re-adding an existing team member silently OVERWRITES their grant with no warning · -next team · **CORRECTNESS** · QUEUE:685 TEAM-MANAGEMENT V2 (b)
- [FORM] No way to edit an existing member's client access — invite/revoke only · -next team · EXPERIENCE · QUEUE:685 (a)
- [FORM] No address, business phone or business email fields exist on the client profile · -next client profile · EXPERIENCE · QUEUE:806 ★CLIENT-PROFILE-BUSINESS-IDENTITY (= ★CLIENT-BIO, same item)

## 8. STATE PERSISTENCE & CLIENT-SWITCH (8)

- [STATE-PERSIST] Component state can survive a client switch — the server-side guard goes green while the bug is live · -next · **CORRECTNESS** · QUEUE:929 #7 SHELL CLIENT-CONTEXT GUARD (b)
- [STATE-PERSIST] Switching clients via the sidebar does not visibly refresh the client's data · /dashboard · **CORRECTNESS** · ROADMAP:258
- [STATE-PERSIST] Chart metric selection does not persist · /dashboard · EXPERIENCE · ROADMAP:271
- [STATE-PERSIST] Chart granularity (Day/Week/Month) does not persist · /dashboard · EXPERIENCE · ROADMAP:272
- [STATE-PERSIST] Ad-group chart visible lines do not persist · /dashboard · EXPERIENCE · ROADMAP:273
- [STATE-PERSIST] Ad bar-chart metric selection does not persist · /dashboard · EXPERIENCE · ROADMAP:274
- [STATE-PERSIST] Table sort column/direction does not persist per table per platform · /dashboard · EXPERIENCE · ROADMAP:275
- [STATE-PERSIST] 51 `advar-` localStorage keys still carry the pre-rebrand prefix and need a migration · whole app · EXPERIENCE · ROADMAP:347 + QUEUE:784 P8

## 9. CROSS-TAB PATTERNS — one behaviour that must exist on every table/card (7)

- [PATTERN] Not every table is sortable on every column · redesign tables · EXPERIENCE · QUEUE:~719 + AUDIT_FINDINGS:130
- [PATTERN] Cards need an always-on 9-dot drag handle with no edit-mode toggle first — DESKTOP ONLY after the 2026-08-16 rescope · -next CardEngine · EXPERIENCE · QUEUE:825 ALWAYS-ON DRAG
- [PATTERN] The platform page offers only Last 7/14/30/90 — no full preset set, no custom picker · -next platform pages · EXPERIENCE · QUEUE:670 P-PL#1
- [PATTERN] Adding a column to a table does not make that metric available as a chart line · /dashboard · EXPERIENCE · ROADMAP:279
- [PATTERN] The store card catalog exposes only product/variant/customer_mix · -next store · EXPERIENCE · QUEUE:~678 S-PL#6
- [PATTERN] No user-defined Tier-2 dashboard cards · /dashboard · EXPERIENCE · ROADMAP:259
- [PATTERN] Agency client list cannot be sorted, filtered or drag-ordered · /clients · EXPERIENCE · ROADMAP:332

## 10. EXPLANATORY COPY & TOOLTIPS (7)

- [COPY] No site-wide ("i") explainers where a metric or term may confuse · whole app · EXPERIENCE · ROADMAP:247 + QUEUE:779 P5
- [COPY] Quick Tips are ad-hoc; no managed coachmark system and no in-app glossary · whole app · EXPERIENCE · ROADMAP:246 + QUEUE:779 P5
- [COPY] No per-platform revenue-basis tooltip (Shopify subtotal-excl vs Woo incl-shipping/tax) · /dashboard · EXPERIENCE · QUEUE:~657
- [COPY] Memory categories have no glossary popover · -next Mer · EXPERIENCE · ROADMAP:442
- [COPY] Landing page still says "ads, reimagined" / "Google Ads management" — outdated vs the BI repositioning · / · EXPERIENCE · ROADMAP:367
- [COPY] Back nav reads "← Cote Media Ads Manager" instead of a clean "← Back" · /dashboard · EXPERIENCE · ROADMAP:294
- [COPY] Privacy / no-training copy is unwritten · homepage · EXPERIENCE · QUEUE:~712

## 11. UNBUILT SURFACES & AFFORDANCES — missing, not broken (16)

- [UNBUILT] Homepage unification — loramer.com ↔ app.loramer.com · marketing + app · EXPERIENCE · QUEUE:~938 HOMEPAGE UNIFICATION ⚠ parked on the Google Standard Access review
- [UNBUILT] Voice in and out, cross-checked · -next · EXPERIENCE · QUEUE:458 ★LORA-VOICE — 9/30 deadline
- [UNBUILT] The insight bar is a rebuild, not a model swap — a detect→drill tool loop · /dashboard banner · EXPERIENCE · QUEUE:1000 ★INSIGHT-INVESTIGATOR
- [UNBUILT] While-You-Were-Sleeping digest window + scheduling model · -next · EXPERIENCE · QUEUE:1001 ★DIGEST-WINDOW-MODEL
- [UNBUILT] One-click "look at everything and tell me what to do" · -next · EXPERIENCE · QUEUE:248 ★MERIDA
- [UNBUILT] A reporting surface where every section carries Lora's narration of that section · -next · EXPERIENCE · QUEUE:1121 ★REPORTING-WITH-LORA-OVERLAY
- [UNBUILT] Every figure Lora states should be traceable to the query behind it, checkable in seconds · -next chat · EXPERIENCE · QUEUE:252 ★NUMBER-PROVENANCE-SPOT-CHECKABLE
- [UNBUILT] A wasted-spend counter, clickable through to the terms · -next · EXPERIENCE · QUEUE:309 ★WASTED-SPEND-COUNTER
- [UNBUILT] Agency profile & settings behind the top-right avatar · -next · EXPERIENCE · QUEUE:~665
- [UNBUILT] Per-client profile card front — identity, thresholds, rules, logo upload + monogram · -next Mer · EXPERIENCE · QUEUE:~666 + ROADMAP:18
- [UNBUILT] Admin page for user management — today it is Supabase SQL only · /admin · EXPERIENCE · ROADMAP:348 + QUEUE:784 P8
- [UNBUILT] One-click "Refresh connection" affordance per platform · -next client profile · EXPERIENCE · ROADMAP:349 + QUEUE:784 P8 (⇒ now owned by ★RECONNECT-HAS-NO-STATE-MACHINE)
- [UNBUILT] `/demo` route with realistic fake data, no login · /demo · EXPERIENCE · ROADMAP:288 + QUEUE:779 P5
- [UNBUILT] Explicit "open client profile" affordance — today only the Claude pill expands it · /clients · EXPERIENCE · ROADMAP:263 + QUEUE:779 P5
- [UNBUILT] Metric-cards redesign on Overview + a general visual refresh · /dashboard · EXPERIENCE · ROADMAP:261 + QUEUE:779 P5
- [UNBUILT] Legacy /clients is still fuller than the -next clients surface; the cutover cannot complete until parity · -next · EXPERIENCE · QUEUE:~692

## 12. UI INSTRUMENTATION & GUARDS — the things that watch the UI (7)

- [INSTRUMENT] ⛔ NOTHING in this repo renders a page and measures anything — every guard reads text, so "every CSS rule is present and the layout is still wrong" is invisible · EXPERIENCE · QUEUE:1159 ★CHAT-RENDER-MEASUREMENT-MISSING
- [INSTRUMENT] No whole-surface UI behaviour audit has ever been run; every UI bug found came from Russ clicking · EXPERIENCE · QUEUE:993 ★WHOLE-SURFACE UI BEHAVIOR AUDIT
- [INSTRUMENT] No mobile horizontal-overflow guard — and a headless width-measurement guard would ship the bug GREEN · EXPERIENCE · QUEUE:988 ★MOBILE-WIDTH-GUARD
- [INSTRUMENT] Three of four chat guards never assert that either container still mounts the component they check · EXPERIENCE · QUEUE:1072 ★CHAT-GUARD-CONTAINER-MOUNT-UNASSERTED
- [INSTRUMENT] A guard ignores `LORAMER_GUARD_ROOT` and silently reads the real tree — a red-proof that never happened · EXPERIENCE · QUEUE:1171 ★GUARD-IGNORES-LORAMER-GUARD-ROOT
- [INSTRUMENT] Guards pin today's literal call site, so a correct edit reports a structural failure · EXPERIENCE · QUEUE:1176 ★GUARD-LOCATORS-PIN-TODAYS-CALL-SITE
- [INSTRUMENT] Any future -next page persisting card order outside CardEngine reintroduces the mobile-persist gap · EXPERIENCE · QUEUE:698 MOBILE-PARITY WATCH — guardrail, no current gap

## 13. OTHER — real items that fit no category above (7)

- [OTHER] ⛔ An effect that refreshes on its own SUCCESS rather than on a state TRANSITION, with idempotence assumed from `[]` — the class that took the reconnect UI down · -next client profile · **CORRECTNESS** · DECISIONS LORAMER_EFFECT_REFRESH_ON_SUCCESS_V1 + QUEUE:78 (1)(2)
- [OTHER] The Google Ads connection row is rendered by a SECOND writer that never calls `badgeFor` and always shows a full-primary Reconnect · -next client profile · **CORRECTNESS** · QUEUE:78 (v) — ClientPage.tsx:548-568 vs :588-613
- [OTHER] A live, clickable button wears the repo's disabled costume (`cursor: not-allowed`, grey) · -next client profile · EXPERIENCE · QUEUE:78 (ii)
- [OTHER] Two demo/reviewer fixtures are pinned to the LEGACY surface permanently, including the Shopify reviewer whose obligation requires the complete feature set · legacy · EXPERIENCE · QUEUE:975 ★LEGACY-PIN vs -NEXT CUTOVER
- [OTHER] Four `react-hooks/exhaustive-deps` suppressions live in the -next UI tree — each is a latent stale-closure or re-fire, which is exactly the class that caused the 2026-08-23 revert · -next · EXPERIENCE · **UNBANKED** · ClientPage.tsx:298, KnowledgePanel.tsx:29 (+2)
- [OTHER] Two unreachable disabled Connect/Reconnect branches — every platform that reaches them is in `NEXT_CONNECTABLE`, so the code is dead · -next client profile · EXPERIENCE · **UNBANKED** · ClientPage.tsx:583, :606
- [OTHER] Legacy `/api/upload` (broken pdf-parse v1) and the /clients uploader must be removed at cutover · legacy · EXPERIENCE · QUEUE:~711

## ⛔ ACCESSIBILITY — ZERO ITEMS, AND THAT IS THE FINDING

There is **not one banked accessibility item** anywhere in the QUEUE, AUDIT_FINDINGS, DECISIONS or ROADMAP.
No keyboard-navigation item, no focus-management item, no contrast item, no screen-reader item. The category
is empty **because nobody has ever looked**, not because the surface is clean — and this file will not
manufacture a category to fill. It is recorded here as a coverage gap so the next audit has a denominator.

---

## DEDUPE LEDGER — 24 collapses

Same defect, more than one banked row. Both provenances kept; the item is counted once.
1. Readiness RPC timeout — QUEUE:565 + QUEUE:1145
2. Meta picker scale — QUEUE:522 + ROADMAP:245 + QUEUE:779 P5 (3→1)
3. Chat streaming — QUEUE:989 + QUEUE:1061 5b
4. Client bio / business identity — QUEUE:806 + QUEUE:~991 ★CLIENT-BIO
5. Universal table sort — QUEUE:~719 + AUDIT_FINDINGS:130
6. Dashboard rail missing tab — QUEUE:743 + AUDIT_FINDINGS:64
7. localStorage rebrand — ROADMAP:347 + QUEUE:784
8. Admin user-management page — ROADMAP:348 + QUEUE:784
9. Refresh-connection UX — ROADMAP:349 + QUEUE:784 (→ absorbed by ★RECONNECT-HAS-NO-STATE-MACHINE)
10. Loading skeletons — ROADMAP:255 + QUEUE:779
11. Better empty states — ROADMAP:260 + QUEUE:779
12. Site-wide tooltips — ROADMAP:247 + QUEUE:779
13. Coachmarks + glossary — ROADMAP:246 + QUEUE:779
14. Client-switch data refresh — ROADMAP:258 + QUEUE:779
15. User-defined Tier-2 cards — ROADMAP:259 + QUEUE:779
16. Metric-cards redesign — ROADMAP:261 + QUEUE:779
17. Open-profile affordance — ROADMAP:263 + QUEUE:779
18. Demo mode — ROADMAP:288 + QUEUE:779
19. Chart/sort state persistence — ROADMAP:271-275 + QUEUE:779 (bundle counted as 5 distinct controls, 1 collapse)
20. Per-client profile card — QUEUE:~666 + ROADMAP:18
21. Woo Phase 2b UI — AUDIT_FINDINGS:55 + QUEUE post-approval batch
22. Chat upload — QUEUE:1078 + QUEUE:1062 (f)
23. Chat copy blocks — QUEUE:1062 (d) + ★CHAT-COPY-BLOCKS
24. Chat stop/status/mark — QUEUE:1061 (3 tokens, one flight)

---

## ⛔ LEFT THIS LIST — DATA / CAPTURE MIS-FILED AS UI (4) → WALK TRACK

These read as UI complaints and are not. They belong to capture, and fixing the surface would hide them.
1. **GA page-level capture gap** — "which pages moved this week" is unanswerable because we capture
   source/medium only, not pagePath. The API serves it. · AUDIT_FINDINGS:129
2. **Hour-grain capture hole** — Shopify, WooCommerce and GA store no hour grain at all · QUEUE:~1003
   ★HOUR-GRAIN-CAPTURE-HOLE
3. **Meta breadth unseal (2026-06-27 → today hole)** — forward does not fill it and catchup cannot see it ·
   QUEUE:~927 #6 G1(b)
4. **Google search-term / PMax non-search-term surfaces** — clients read as an honest empty because the
   reports are never queried · QUEUE:304 ★GOOGLE-NON-SEARCH-TERM-SURFACES

---

## UNBANKED — found in the tree, banked nowhere (6)

1. Portfolio-insights placeholder card · MultiClientOverview.tsx:182
2. Per-client neutral status placeholder · MultiClientOverview.tsx:347
3. Four `react-hooks/exhaustive-deps` suppressions in the -next tree · ClientPage.tsx:298, KnowledgePanel.tsx:29 (+2)
4. Two unreachable disabled Connect/Reconnect branches · ClientPage.tsx:583, :606
5. `.connRow` has no `flex-wrap` and no breakpoint anywhere touches it · redesign.module.css:350 (the
   mechanism under the 390px overflow — banked as a symptom, never as a cause)
6. `connectBtnStyle` carries `cursor: not-allowed` and is used on live buttons · ClientPage.tsx:43
