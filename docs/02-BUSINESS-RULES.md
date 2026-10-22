# 02: Business Rules

These are Raghav's documented rules (from Deepa's brief). They govern about 80-85% of his monthly recommendations. All numbers come from `config/rules.json`.

## The five rules (as written by Raghav)
1. If an SKU's sales in the last 4 weeks are more than 20% above its 12-week average, flag as **high-demand** and recommend a reorder at **1.5x** the standard quantity.
2. If current stock falls below **6 weeks** of average weekly sales, flag as **stockout risk** and recommend an **immediate reorder**.
3. If current stock exceeds **14 weeks** of average weekly sales, flag as **overstock risk** and recommend **pausing the next order**.
4. **Festival months (October, November, March):** apply a **25% demand uplift** before any threshold checks.
5. **High-perishability SKUs** follow tighter windows: **maximum 4 weeks** of stock, **minimum 3 weeks**.

The remaining 15-20% (new product launches, unusual distributor behaviour, one-off market events) is handled by Raghav's judgment and is NOT automated. See "Needs judgment" below.

## Exact definitions (how the engine computes things)
Run on the latest complete data. Let `as_of_date` be the `As_Of_Date` in `current_inventory.csv`.

| Term | Definition |
|---|---|
| `last_complete_week` | The ISO week that ended before `as_of_date`. Seed: as_of 2026-10-19 (Monday) so last complete week = 2026-W42 |
| `recent_avg` | Mean of `Units_Sold` over the last 4 complete weeks (seed: W39-W42) |
| `avg_weekly_sales` | Mean of `Units_Sold` over the last 12 complete weeks, **including** the last 4 (seed: W31-W42) |
| `is_festival` | `Is_Festival_Month` in `calendar.csv` for the month of `as_of_date` |
| `uplift` | 1.25 if `is_festival` else 1.00 |
| `demand_rate` | `avg_weekly_sales x uplift` |
| `cover_weeks` | `Units_On_Hand / demand_rate` |
| `demand_ratio` | `recent_avg / avg_weekly_sales` (the uplift is applied to both sides, so it cancels) |
| `min_cover` / `max_cover` | Normal SKU: 6 / 14 weeks. Perishability = High: 3 / 4 weeks (these replace 6 / 14, not add to them) |

## Flag logic (per SKU)
```
flags = []
if demand_ratio > 1.20:            flags += HIGH_DEMAND        # strictly greater than
if cover_weeks < min_cover:        flags += STOCKOUT_RISK      # strictly less than
if cover_weeks > max_cover:        flags += OVERSTOCK_RISK     # strictly greater than
```
HIGH_DEMAND can combine with STOCKOUT_RISK. OVERSTOCK_RISK never combines with STOCKOUT_RISK (mutually exclusive by construction). HIGH_DEMAND with OVERSTOCK_RISK is possible and must be surfaced as a conflict for Raghav (flag both, recommended action = pause, `needs_judgment = true`).

## Recommended action and quantity (rule engine output)
`standard_qty` = `Standard_Reorder_Qty` from `sku_master.csv`.

| Flags | Action | Quantity |
|---|---|---|
| STOCKOUT_RISK only | REORDER (immediate) | 1.0 x standard_qty |
| HIGH_DEMAND (with or without STOCKOUT_RISK) | REORDER | 1.5 x standard_qty (highest multiplier wins) |
| OVERSTOCK_RISK only | PAUSE_ORDER | 0 |
| HIGH_DEMAND + OVERSTOCK_RISK | PAUSE_ORDER, needs_judgment | 0 |
| No flags | NO_ACTION | not sent to AI, not shown for review |

Round quantities to whole units (round half up). Unit of measure is in `sku_master.csv`.

## Needs judgment
The engine sets `needs_judgment = true` when any of these hold:
- conflicting flags (HIGH_DEMAND + OVERSTOCK_RISK)
- fewer than 12 weeks of history for the SKU
- a zero-sales week inside the last 12 weeks
- week-on-week swing above 50% inside the last 4 weeks

These are surfaced prominently to Raghav. They are the proxy for the 15-20% the rules cannot cover. (Thresholds in this list are DEFAULTS; see `12-OPEN-QUESTIONS.md`.)

## Worked example on the seed data (default interpretation)
Date: 2026-10-19 (October = festival month, uplift 1.25).

| SKU | Perishable | avg12 | last4 | ratio | demand_rate | on hand | cover wks | band | Flags | Action |
|---|---|---|---|---|---|---|---|---|---|---|
| SKU001 Mango Drink | Low | 214.92 | 261.00 | 1.2144 | 268.65 | 900 | 3.35 | 6-14 | HIGH_DEMAND + STOCKOUT_RISK | REORDER 750 (1.5 x 500) |
| SKU003 Brown Rice | Low | 150.50 | 150.75 | 1.0017 | 188.12 | 820 | 4.36 | 6-14 | STOCKOUT_RISK | REORDER 300 |
| SKU004 Almond Milk | High | 79.83 | 81.00 | 1.0146 | 99.79 | 180 | 1.80 | 3-4 | STOCKOUT_RISK | REORDER 150 |
| SKU006 Quinoa | Low | 39.58 | 40.25 | 1.0168 | 49.48 | 1100 | 22.23 | 6-14 | OVERSTOCK_RISK | PAUSE |
| SKU007 Coconut Water | High | 121.50 | 133.50 | 1.0988 | 151.88 | 620 | 4.08 | 3-4 | OVERSTOCK_RISK | PAUSE |
| SKU011 Multigrain Bread | High | 204.33 | 209.25 | 1.0241 | 255.42 | 460 | 1.80 | 3-4 | STOCKOUT_RISK | REORDER 500 |
| SKU013 Peanut Butter | Low | 45.42 | 44.75 | 0.9853 | 56.77 | 180 | 3.17 | 6-14 | STOCKOUT_RISK | REORDER 120 |

The other 8 SKUs (002, 005, 008, 009, 010, 012, 014, 015) have no flag. Boundary cases to protect with tests: SKU001 ratio 1.2144 (just over 1.20) and SKU007 cover 4.08 (just over the perishable max of 4).

If the festival uplift were NOT applied, the result changes (SKU002 would show 14.3 weeks and become OVERSTOCK_RISK; SKU007 would show 5.1 weeks). That is why the uplift interpretation is in `12-OPEN-QUESTIONS.md`.

## Rule-change policy
Raghav does not edit rules inside the app. Rule changes are made in `config/rules.json`, versioned, and every run stores the `rules_version` it used.
