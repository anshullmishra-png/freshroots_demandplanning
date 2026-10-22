# 03: Data Spec

## Seed files (in `seed/`)
All five files are CSV with CRLF line endings. Strip BOM and `\r` on read.

| File | Columns | Rows (seed) | Notes |
|---|---|---|---|
| `sku_master.csv` | SKU_ID, SKU_Name, Category, Perishability (Low/High), Standard_Reorder_Qty, Unit_of_Measure, Distributor_ID | 15 | Perishable (High): SKU004, SKU007, SKU011 |
| `distributor_master.csv` | Distributor_ID, Distributor_Name, Region, Status | 4 | Regions in seed include Karnataka and Gujarat, though the company serves Maharashtra and Goa |
| `weekly_sales.csv` | SKU_ID, Week (`YYYY-Www`), Units_Sold | 240 (15 SKUs x 16 weeks, 2026-W27 to W42) | **SKU-level**, not distributor-level. No gaps or duplicates in seed |
| `current_inventory.csv` | SKU_ID, Location, Units_On_Hand, As_Of_Date | 15 | One location (Pune Central Warehouse), as of 2026-10-19 |
| `calendar.csv` | Year, Month, Year_Month, Is_Festival_Month | 24 (2025-01 to 2026-12) | Festival: Mar, Oct, Nov |

The real company has about 400 SKUs and 1,200 distributors. The seed is a small sample. Build for the real scale: nothing may assume 15 SKUs.

`Distributor_ID` on `sku_master.csv` is stored and shown as information only. It is not used in any calculation (see `12-OPEN-QUESTIONS.md`).

## Ingestion flow
1. Raghav uploads the five files (or only the changed ones; master files are kept from the previous upload).
2. Parse, normalise (trim, strip BOM, handle CRLF), and validate (below).
3. If any ERROR: the run is blocked, nothing is written to run tables, and the UI lists every error with file, row, and reason.
4. If only WARNINGs: Raghav sees them and must tick "I have read the warnings" to continue.
5. On success: store a `data_snapshot` (raw files kept for audit) and create a `run`.

## Validation rules
| Level | Rule |
|---|---|
| ERROR | Missing file or missing required column |
| ERROR | `Units_Sold` or `Units_On_Hand` not a whole number, or negative |
| ERROR | Duplicate `(SKU_ID, Week)` in sales |
| ERROR | `SKU_ID` in sales or inventory not in `sku_master` |
| ERROR | An SKU in `sku_master` has no inventory row |
| ERROR | `Week` not in `YYYY-Www` format |
| ERROR | Fewer than 12 consecutive weeks of sales for an SKU (config: `min_weeks_of_sales_required`) |
| ERROR | A gap in the weeks inside the last 12 for any SKU |
| ERROR | Sales do not end at the last complete week before `as_of_date` (stale or future data) |
| ERROR | `as_of_date` is older than 7 days at upload time (config: `max_inventory_age_days`) |
| ERROR | `as_of_date` month is missing from `calendar.csv` |
| ERROR | `Standard_Reorder_Qty` not a positive whole number |
| ERROR | `Perishability` not Low or High |
| WARNING | An SKU in sales/inventory sits under a distributor with status other than Active |
| WARNING | A week with 0 units sold inside the last 12 |
| WARNING | An SKU in `sku_master` with no sales at all (new launch?) |
| WARNING | Stock more than 3x any weekly sales figure ever seen for the SKU (possible unit mismatch) |

Never silently fix data. Cleaning means: trimming whitespace, normalising line endings, and casting types. Anything else is reported, not repaired.

## Database (Neon Postgres)
Use a migration tool (Drizzle or Prisma, builder's choice, TypeScript). Suggested tables:

```
users            id, name, email (unique), role (raghav|procurement|priya|deepa|ceo|admin), active
skus             sku_id PK, name, category, perishability, standard_reorder_qty, uom, distributor_id
distributors     distributor_id PK, name, region, status
calendar_months  year, month, is_festival   PK(year, month)
data_snapshots   id, uploaded_by, uploaded_at, as_of_date, raw_files_json, validation_report_json
weekly_sales     snapshot_id, sku_id, week, units_sold   PK(snapshot_id, sku_id, week)
inventory        snapshot_id, sku_id, location, units_on_hand, as_of_date
runs             id, snapshot_id, created_by, created_at, rules_version, rules_json, status
                 (created|flagged|ai_done|in_review|completed|blocked), kill_state_at_run
flags            id, run_id, sku_id, flag_types[], avg_weekly_sales, recent_avg, demand_ratio,
                 uplift, demand_rate, units_on_hand, cover_weeks, min_cover, max_cover,
                 rule_action, rule_qty, needs_judgment, judgment_reasons[]
ai_decisions     id, flag_id, status (pending_review|reviewed|voided_by_kill), model, prompt_version, action, quantity, explanation, confidence,
                 needs_judgment, valid (bool), invalid_reasons[], is_fallback (bool),
                 raw_response_json, latency_ms, created_at
reviews          id, ai_decision_id UNIQUE, reviewer_id, outcome (accepted|rejected), reviewed_at,
                 final_action, final_qty, final_flag_types[], reason_code, reason_text
buying_decisions id, review_id UNIQUE, sku_id, action, quantity, sink (csv|zoho), sink_ref,
                 status (pending|placed|held|cancelled), placed_by, placed_at
loss_entries     id, period_start, period_end, stockout_loss_rupees, overstock_writeoff_rupees,
                 entered_by, entered_at, note   UNIQUE(period_start, period_end)
kill_state       id (single row), kill1_state (armed|killed), kill2_state (green|alert|killed),
                 kill1_epoch_start, updated_at
kill_events      id, switch (1|2), event (alert|killed|rearmed), metric_value, threshold,
                 details_json, created_at, acknowledged_by, acknowledged_at
audit_log        id, actor_id, action, entity, entity_id, before_json, after_json, created_at
```

Rules for the schema:
- Money is `numeric(14,2)` in rupees.
- `reviews` rows are append-only. A change of mind creates an audit entry, not an update, once the buying decision exists.
- Store the full `rules_json` on every run so a result can be reproduced later.
- Never delete rows from `ai_decisions`, `reviews`, `kill_events`, or `audit_log`.

## Rejection reason codes (for `reviews.reason_code`)
`WRONG_QUANTITY`, `WRONG_ACTION`, `WRONG_FLAG`, `DATA_LOOKS_WRONG`, `MARKET_EVENT`, `NEW_LAUNCH_OR_DISTRIBUTOR_CHANGE`, `OTHER`. `reason_text` is required when the code is `OTHER` and recommended otherwise. A rejection without a reason cannot be saved.
