# EVAL V3 — RUSS'S HAND-VERIFY CHECKLIST (LORAMER_EVAL_SET_V3, 2026-08-13)

Purpose: certify the SQL-computed ground truth against the platforms' own UIs. If every check below
matches (within a dollar / a handful of units — platform UIs round), the SQL method is certified for the
rest of the machine-graded set. ANY miss → tell Claude which line; that family escalates to full
hand-verification. Check the box, write the number you saw. ~25 minutes total.

## STRATIFIED SAMPLE — one per platform × window class (7)
- [ ] **A1 · Google spend, Nov 2024 — expect $2,835.93.** ads.google.com → pick account **Foam OH
  (768-852-1852)** in the top-left account picker → date picker (top right) → **Custom** → Nov 1 2024 –
  Nov 30 2024 → read the **Cost** column total on the Campaigns overview row ("Total: Account").
  Saw: ______
- [ ] **C1 · Google spend, Q3 2025 — expect $53,107.04.** Same screen, date Jul 1 2025 – Sep 30 2025,
  read Cost total. Saw: ______
- [ ] **A2 · Meta spend, Nov 1–Dec 31 2024 — expect $349,653.78; Purchases ≈ 9,343 (Meta may show the
  omni figure 9,623 — either matches).** business.facebook.com → Ads Manager → account **Foam OH** →
  date dropdown (top right) → Custom → Nov 1 2024 – Dec 31 2024 → read **Amount spent** total and the
  **Purchases** column total (Columns: Standard events if not visible). Saw: ______ / ______
- [ ] **B1 · GA4 sessions, Jul 2026 — expect 1,817.** analytics.google.com → Foam OH property →
  **Reports → Acquisition → Traffic acquisition** → date picker Jul 1–31 2026 → read the **Sessions**
  total row. Saw: ______
- [ ] **C18 · GA4 sessions, full-year 2025 — expect 552,253** (2024 = 791,628 if you want the pair).
  Same report, date Jan 1 – Dec 31 2025. Saw: ______
- [ ] **C11 · Shopify net sales, Nov 2025 — expect $169,946.96 · 777 orders.** admin.shopify.com (Foam
  OH store) → **Analytics → Reports → Total sales over time** → date Nov 1–30 2025 → read **Net sales**
  (NOT total sales — net excludes shipping/tax per house law) and **Orders**. Saw: ______ / ______
- [ ] **A5 · Google top keyword by cost, Jul 2026 — expect "bath fitters" at $8,649.60.** ads.google.com
  → account **Bath Fitter | O'Gorman Bros (687-105-5643)** → **Audiences, keywords and content →
  Search keywords** → date Jul 1–31 2026 → sort by **Cost** descending → top row. Saw: ______

## E-BUCKET ANCHORS — the moat claims, all hand-checked (5)
- [ ] **E1 · Google spend Q2 2025 — expect $51,166.07** (Foam OH, Apr 1 – Jun 30 2025, Cost total).
  Saw: ______
- [ ] **E1 · Meta spend Q2 2025 — expect $7,780.07** (same window, Amount spent). Saw: ______
- [ ] **E1/E5 · Shopify net sales Q2 2025 — expect $117,840.00 · 559 orders** (Net sales + Orders,
  Apr 1 – Jun 30 2025). Saw: ______ / ______
- [ ] **E6 · Meta Purchases Q2 2025 — expect 70** (Purchases column total, same window). Saw: ______
- [ ] **E18 · Bath Fitter Google spend Q2 2026 — expect $261,498.57** (Cost total, Apr 1 – Jun 30 2026;
  the 2025 pair is $142,058.67 if you want both). Saw: ______

## KNOWN GAPS YOU ARE NOT BEING ASKED TO CHECK (the refusal list, back to you as promised)
- **C6** — 2026 Q1 reads 88/90 captured days TODAY (Q1 2024 reads 91/91). Not certifiable as authored.
- **A4** — only ONE ad group had ≥1 conversion in Nov 2024; "rank the top three" is unanswerable as
  phrased. Reshaped to a boundary question (Lora must SAY only one qualifies).
- **B20** — exit rate is not a captured GA family; reshaped to coverage-honesty ("not captured yet").
- **B12** — its own coverage note says the ads half of the window is incomplete; judge-shaped.
