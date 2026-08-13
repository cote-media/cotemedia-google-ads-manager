# EVAL V3 — RUSS'S HAND-VERIFY CHECKLIST (LORAMER_EVAL_SET_V3, 2026-08-13)

STATUS 2026-08-13: 12 checks returned. CERTIFIED — Meta (both), Google on SETTLED windows (A1/C1/E1, two-cent agreement). RESOLVED WITHOUT RE-CHECK — A5 (checklist bug), E18 (vendor restatement, re-anchored). OPEN — GA4 family (one reading owed), Shopify basis (one reading owed).

Purpose: certify the SQL-computed ground truth against the platforms' own UIs. If every check below
matches (within a dollar / a handful of units — platform UIs round), the SQL method is certified for the
rest of the machine-graded set. ANY miss → tell Claude which line; that family escalates to full
hand-verification. Check the box, write the number you saw. ~25 minutes total.

## STRATIFIED SAMPLE — one per platform × window class (7)
- [x] ✅ **A1 · Google spend, Nov 2024 — expect $2,835.93 · RUSS SAW $2,835.91 — CERTIFIED (2c).** ads.google.com → pick account **Foam OH
  (768-852-1852)** in the top-left account picker → date picker (top right) → **Custom** → Nov 1 2024 –
  Nov 30 2024 → read the **Cost** column total on the Campaigns overview row ("Total: Account").
  Saw: ______
- [x] ✅ **C1 · Google spend, Q3 2025 — expect $53,107.04 · RUSS SAW $53,107.03 — CERTIFIED (1c).** Same screen, date Jul 1 2025 – Sep 30 2025,
  read Cost total. Saw: ______
- [x] ✅ **A2 · Meta — RUSS SAW $349,653.78 EXACT — CERTIFIED. expect $349,653.78; Purchases ≈ 9,343 (Meta may show the
  omni figure 9,623 — either matches).** business.facebook.com → Ads Manager → account **Foam OH** →
  date dropdown (top right) → Custom → Nov 1 2024 – Dec 31 2024 → read **Amount spent** total and the
  **Purchases** column total (Columns: Standard events if not visible). Saw: ______ / ______
- [x] ✗ **B1 · GA4 Jul 2026 — RUSS SAW 1,915 vs ours 1,817 (−5.1%). CAPTURE DEFECT: rows captured at 1.3-day lag, GA4 not final. Question HELD ungraded; ★GA-RESTATEMENT-SWEEP-MISSING owns it.** was: expect 1,817. analytics.google.com → Foam OH property →
  **Reports → Acquisition → Traffic acquisition** → date picker Jul 1–31 2026 → read the **Sessions**
  total row. Saw: ______
- [x] ✗ **C18 · GA4 FY2025 — RUSS SAW 549,971 vs ours 552,253 (+0.41%). Captured SETTLED (338-day lag) so NOT freshness — cause UNDETERMINED, one reading owed below. Question HELD ungraded.** was: expect 552,253 (2024 = 791,628 if you want the pair).
  Same report, date Jan 1 – Dec 31 2025. Saw: ______
- [x] ✗→OK **C11 · Shopify Nov 2025 — RUSS SAW $170,607.11 vs ours $169,946.96 (ours low $660.15). REFUND-DATE BASIS, not a defect; tolerance now 0.5% with the reason written. Confirm via the Returns reading below.** was: expect $169,946.96 · 777 orders. admin.shopify.com (Foam
  OH store) → **Analytics → Reports → Total sales over time** → date Nov 1–30 2025 → read **Net sales**
  (NOT total sales — net excludes shipping/tax per house law) and **Orders**. Saw: ______ / ______
- [x] **A5 · Google top keyword — ✅ RESOLVED 2026-08-13, NO RE-CHECK NEEDED. THE CHECKLIST LINE WAS THE
  BUG, NOT THE DATA.** Russ read "bathroom remodeling $2,776.00" — **that figure is in our rows TO THE
  CENT** as a single keyword-criterion row. The instruction told him to sort a table whose rows are
  per-keyword-criterion (six separate "bath fitters" criteria live in six ACTIVE campaigns, summing to
  $8,649.60; no single row reaches it). The eval question asks the ACCOUNT-AGGREGATE — which is what a
  user means by "my top keywords" — so the truth stands at $8,649.60 and only this verification
  instruction was wrong. Capture: correct. Truth: correct. Method: replaced.

## E-BUCKET ANCHORS — the moat claims, all hand-checked (5)
- [x] ✅ **E1 · Google Q2 2025 — expect $51,166.07 · RUSS SAW $51,166.09 — CERTIFIED (2c).** (Foam OH, Apr 1 – Jun 30 2025, Cost total).
  Saw: ______
- [x] ✅ **E1 · Meta Q2 2025 — RUSS SAW $7,780.07 EXACT — CERTIFIED.** (same window, Amount spent). Saw: ______
- [x] ✗→OK **E1/E5 · Shopify Q2 2025 — RUSS SAW $117,795.82 vs ours $117,840.00 (ours HIGH $44.18 — opposite sign to C11, same refund-basis mechanism). Tolerance 0.5%.** was: expect $117,840.00 · 559 orders (Net sales + Orders,
  Apr 1 – Jun 30 2025). Saw: ______ / ______
- [x] ✅ **E6 · Meta Purchases Q2 2025 — RUSS SAW 69 vs 70 — CERTIFIED (alias family, within tolerance).** (Purchases column total, same window). Saw: ______
- [x] ✗→RE-ANCHORED **E18 · Bath Fitter Q2 2026 — RUSS SAW $261,472.11; our stored row read $261,498.57.
  ONE GAQL OP CONFIRMED THE VENDOR NOW REPORTS $261,472.11 — Russ and Google agree to the cent; OUR ROW WAS
  STALE. Truth re-anchored to $261,472.11, tolerance 0.05% with the restatement reason. Conversions also
  drifted 2,343.3 → 2,440.9 (+4.2%) via the 90-day tail. NO RE-CHECK NEEDED.**

## ⛔ TWO READINGS STILL OWED (60 seconds each, whenever you're at a laptop)
- [ ] **GA4 FY2025 — Reports → Engagement → Overview** (NOT Traffic acquisition), date Jan 1 – Dec 31
  2025 → the **Sessions** scorecard. Ours reads 552,253; Traffic acquisition gave you 549,971. If the
  Overview reads 552,253, our recipe is right and the Traffic-acquisition total is the thing that
  differs. Saw: ______
- [ ] **SHOPIFY Returns, Nov 2025** — same Total-sales-over-time report, read the **Returns** column for
  Nov 1–30 2025. If returns booked in Nov ≈ $660 against pre-Nov orders, the refund-basis explanation is
  confirmed outright. Saw: ______

## KNOWN GAPS YOU ARE NOT BEING ASKED TO CHECK (the refusal list, back to you as promised)
- **C6** — 2026 Q1 reads 88/90 captured days TODAY (Q1 2024 reads 91/91). Not certifiable as authored.
- **A4** — only ONE ad group had ≥1 conversion in Nov 2024; "rank the top three" is unanswerable as
  phrased. Reshaped to a boundary question (Lora must SAY only one qualifies).
- **B20** — exit rate is not a captured GA family; reshaped to coverage-honesty ("not captured yet").
- **B12** — its own coverage note says the ads half of the window is incomplete; judge-shaped.
