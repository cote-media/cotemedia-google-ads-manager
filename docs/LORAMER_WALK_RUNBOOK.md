# THE WALK — WHAT TO CHECK IN THE MORNING

The Google Ads universe walk is running for **Foam OH**, backwards through history to **2022-03-05**.
It runs by itself for about **three days**. This page is everything you need.

⛔ **THE ONE-LINE VERSION: run the first block below. If `running` is 0 and `error` is 0, it is fine —
close the tab.**

---

## ⛔ FIRST — DO I NEED TO DO ANYTHING?

**No.** There is nothing to start, restart, babysit or top up.

- It resumes itself. If a window dies, the next message picks up from where it left off.
- It stops itself when Google runs out of history, when the disk gets low, or when the rest of the
  app needs the daily Google allowance.
- It will pause for hours at a time on purpose. **That is the design, not a stall.**

The only reason to act is if you see an `error` count climbing, or `running` rows that never clear.
Both are explained below.

---

## 1 · THE PROGRESS CHECK

Paste into the **Supabase SQL Editor**:

```sql
select outcome,
       count(*)                as windows,
       sum(rows_written)       as rows_added,
       sum(requests_spent)     as google_requests,
       min(window_start)       as oldest_window,
       max(window_start)       as newest_window
from public.universe_window_log
where vendor = 'google_ads'
group by outcome
order by outcome;
```

**WHAT THE ANSWERS MEAN.** One line per outcome — you will not see all of them:

- **`ok`** — worked, and wrote data. This is the one you want growing.
- **`zero`** — it asked Google and Google said "nothing here". ⛔ **This is a real answer, not a
  failure.** Foam OH's Google account stopped spending in April 2026, so every window newer than
  that is legitimately empty. Expect a lot of these.
- **`skipped`** — that slice could never be asked for (something it needs does not exist). Normal,
  and it is recorded rather than hidden.
- **`quota_stop`** — the walk stood down to leave Google allowance for the live app. **CORRECT
  BEHAVIOUR — see §3.**
- **`floor_stop`** — it stopped because disk got low. See §4.
- **`error`** — something actually broke. See §5.
- ⛔ **`running`** — see §2. **This one is not progress.**

**WHAT "DONE" LOOKS LIKE:** `oldest_window` reaches **2022-03-05** (or Google stops serving before
that), and there are no `running` rows left. Roughly **54 windows** in total.

---

## 2 · ⛔ `running` MEANS A WINDOW DIED

**A `running` row is NOT a window in progress. It is a window that started and never came back.**

A window takes about 30 minutes. A row that has said `running` for more than an hour is dead.

```sql
select resource, segment, window_start, window_end, started_at
from public.universe_window_log
where vendor = 'google_ads' and outcome = 'running'
order by started_at;
```

- **Empty result** — good, nothing is stuck.
- **A few rows, all started in the last hour** — fine, those are live.
- **Rows older than an hour** — those windows died. They are not lost: the walk re-walks anything
  that is not finished. Send me the output.

---

## 3 · ⛔ `quota_stop` IS THE WALK BEHAVING CORRECTLY

Google gives the whole account **15,000 operations a day** — shared between the live app (today's
numbers, the dashboard, the nightly sync) and this walk.

**The walk always yields. The live app never does.** When the day's allowance gets tight, the walk
stops publishing and writes a `quota_stop` row with the arithmetic.

⛔ **Seeing `quota_stop` rows is good news, not bad.** It means the safety worked and today's
customer data was protected. The walk simply continues the next day.

The only thing `quota_stop` costs you is time — it is why this takes ~3 days rather than ~1.

---

## 4 · DISK — WHAT IS FINE AND WHAT IS NOT

```sql
select pg_size_pretty(used_bytes)  as used,
       pg_size_pretty(free_bytes)  as free,
       pg_size_pretty(free_bytes - (56::bigint*1024^3)::bigint) as spare_above_the_floor
from public.universe_disk_headroom(300647710720);
```

- **`spare_above_the_floor` is a big positive number (tens of GB)** — fine. Expect it to shrink a
  little each day; the whole walk needs about **87 GB** and there is about **110 GB** spare.
- **It is getting close to zero** — the walk will stop itself cleanly and write `floor_stop` rows.
  Nothing breaks. Tell me and we decide whether to add disk.
- **You see `floor_stop` rows** — it already stopped. Nothing is damaged; it is waiting for room.

⛔ **The walk will never fill the disk.** It checks before every single window and refuses rather
than pushing through.

---

## 5 · IF SOMETHING ACTUALLY BROKE

```sql
select resource, segment, window_start, left(error, 200) as what_went_wrong, started_at
from public.universe_window_log
where vendor = 'google_ads' and outcome = 'error'
order by started_at desc
limit 20;
```

- **Empty** — nothing broke.
- **A handful** — some slices of Google's data refuse certain combinations. The walk records it and
  carries on. Not urgent.
- **Dozens, all with the same message** — something systemic. Send me the output.

---

## ⛔ WHAT NOT TO CONCLUDE

- **"Lots of `zero` rows, so it is broken."** No — the account genuinely has no Google spend after
  early April 2026. Empty is the correct answer for those months.
- **"It has not moved in an hour, so it is stuck."** Check for `quota_stop` first. Standing down is
  the design.
- **"`rows_added` is small, so it is not working."** Most months are far lighter than the busiest
  one. The total will land well under the original estimate, and that is a good thing.

---

## THE NUMBERS THIS WAS STARTED ON

Recorded so a surprise can be checked against what was expected, not against memory.

- **~52 windows remaining**, 30 days each, back to 2022-03-05
- **~17,992 Google requests** total, at 1 operation each
- ⛔ **~3.9 MB of disk per window — MEASURED 2026-08-07, AND IT CORRECTS A FIGURE THAT WAS WRONG BY ~430×.**
  This line read "~1.67 GB per window → ~87 GB for the whole walk" until 2026-08-07. That was a
  PROJECTION made before the walk ran, and the walk itself falsified it: `universe_window_log.disk_free_bytes`
  went 182,205,025,754 → 127,844,527,578 across the 08-04→08-05 run, i.e. **54.36 GB over 13,239 windows
  = ~3.9 MB/window, ~1,067 bytes/row over 50,924,048 rows.** ⚠ CAVEAT ON THE AVERAGE: it mixes 8,769
  productive windows with 4,458 zero-row ones, and the entries still remaining skew productive — so the
  true per-window cost is HIGHER than 3.9 MB, though it would have to be ~14 MB (3.6×) before the disk
  floor is touched at all. **REMAINING AT 2026-08-07: 136 entries · ~4,509 windows · ~17.6 GB projected,
  against ~63 GiB of headroom before the 56 GiB floor.**
- **~29 minutes per window measured**
- ⛔ **What makes it take 3 days is the daily Google allowance (~17 windows/day), not speed.**
  On raw speed alone it would finish in about a day.
