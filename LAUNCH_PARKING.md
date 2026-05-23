# LoraMer — Launch Parking Lot

Issues flagged during the App Store submission push but NOT addressed in-the-moment.
Three buckets, in priority order.

---

## 🔴 BLOCKER — must fix before submitting

### "This month" date range returns blank tiles on Shopify tab
Selecting "This month" on the Shopify tab shows the chart correctly but ALL metric tiles are blank. "Last 7 days" and "Last 30 days" work fine. Root cause: `shopify-intelligence.ts` line 22 maps `THIS_MONTH` to a 30-day lookback while `shopify/daily/route.ts` line 47 maps it to `new Date().getDate()` (back to the 1st of the month). The two endpoints return data for different windows and one returns nothing, leaving the UI blank. A user picking "this month" and seeing zero tiles will assume the product is broken. Fix: make both endpoints use the same lookback (back to the 1st of the current month is the conventional meaning of "this month").

---

## 🟡 PRE-LAUNCH-NICE — improves re ship if time permits

### Client row UX — no obvious expand control
The only ways to expand a client profile section are: (1) click the Claude pill, or (2) click the row of a client with zero connections. Once any platform is connected, the row click goes to the dashboard and there's no visible affordance to access disconnect controls, Claude profile editing, or document upload. Should add an explicit Manage / chevron / settings button on every row.

---

## 🟢 POST-LAUNCH — real issue, can iterate

### "Return Rate" field is mislabeled
The Shopify tab "Return Rate" tile computes `returningCustomers / totalOrders * 100`. That's the percentage of orders from returning customers, NOT the percentage of returned/refunded products (which is what "return rate" means in e-commerce). Should either rename to "Returning Customer %" or actually compute refund-rate from the orders' financial_status field.

### Customer segmentation produces strange numbers on dev stores
On dev stores where Bogus Gateway is the oyment method, all test orders attach to the same test customer, producing "100% returning customers / 0 new customers." This is a dev store artifact, not a code bug, but reviewers will see it. Logging in case it warrants a synthetic data approach for the reviewer demo store.
