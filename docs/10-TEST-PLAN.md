# 10: Test Plan

Write these tests before the UI. Use Vitest (unit/integration) and Playwright (end to end). CI runs on every push. **No test calls the real Gemini API**; use a mock client.

## A. Golden test: seed data, default config
Input: the five files in `seed/`, `config/rules.json` as shipped. `as_of_date` 2026-10-19; last complete week 2026-W42; October is a festival month (uplift 1.25).

Expected flags (cover weeks rounded to 2 decimals):
| SKU | Flags | cover wks | rule action | rule qty |
|---|---|---|---|---|
| SKU001 | HIGH_DEMAND, STOCKOUT_RISK | 3.35 | REORDER | 750 |
| SKU003 | STOCKOUT_RISK | 4.36 | REORDER | 300 |
| SKU004 | STOCKOUT_RISK | 1.80 | REORDER | 150 |
| SKU006 | OVERSTOCK_RISK | 22.23 | PAUSE_ORDER | 0 |
| SKU007 | OVERSTOCK_RISK | 4.08 | PAUSE_ORDER | 0 |
| SKU011 | STOCKOUT_RISK | 1.80 | REORDER | 500 |
| SKU013 | STOCKOUT_RISK | 3.17 | REORDER | 120 |

Exactly 7 flagged SKUs. These SKUs have no flag: SKU002, SKU005, SKU008, SKU009, SKU010, SKU012, SKU014, SKU015.
Also assert: `avg_weekly_sales` for SKU001 = 214.92 (W31-W42), `recent_avg` = 261.00 (W39-W42), `demand_ratio` = 1.2144.

## B. Variant: festival uplift off
Same data, but a calendar with October marked non-festival (uplift 1.00). Expected flagged SKUs and cover weeks:
SKU001 HIGH_DEMAND + STOCKOUT_RISK (4.2), SKU002 OVERSTOCK_RISK (14.3), SKU003 STOCKOUT_RISK (5.4), SKU004 STOCKOUT_RISK (2.3), SKU006 OVERSTOCK_RISK (27.8), SKU007 OVERSTOCK_RISK (5.1), SKU011 STOCKOUT_RISK (2.3), SKU013 STOCKOUT_RISK (4.0). This proves the uplift is applied and read from the calendar.

## C. Boundary tests (synthetic fixtures)
| Case | Expected |
|---|---|
| demand_ratio exactly 1.20 | no HIGH_DEMAND |
| demand_ratio 1.2001 | HIGH_DEMAND |
| cover exactly 6.0 (normal SKU) | no STOCKOUT_RISK |
| cover 5.99 | STOCKOUT_RISK |
| cover exactly 14.0 (normal) | no OVERSTOCK_RISK |
| cover 14.01 | OVERSTOCK_RISK |
| cover exactly 3.0 (perishable) | no STOCKOUT_RISK |
| cover 2.99 (perishable) | STOCKOUT_RISK |
| cover exactly 4.0 (perishable) | no OVERSTOCK_RISK |
| cover 4.01 (perishable) | OVERSTOCK_RISK |
| perishable SKU at cover 5.0 | OVERSTOCK_RISK (4 weeks max replaces 14) |
| HIGH_DEMAND + OVERSTOCK_RISK | both flags, PAUSE_ORDER, needs_judgment = true |
| rounding | quantities are whole numbers; 1.5 x 150 = 225 |
| determinism | two runs on the same input give byte-identical flag output |
| config | changing `stockout_cover_weeks` in config changes the flags with no code change |

## D. Data validation tests
One test per ERROR and WARNING row in `03-DATA-SPEC.md`: missing column, negative units, duplicate week, unknown SKU, SKU with no inventory, bad week format, fewer than 12 weeks, week gap, stale sales, stale inventory, month missing from calendar, bad perishability, CRLF and BOM files parse correctly. An ERROR blocks the run and writes nothing.

## E. AI step tests (mock Gemini)
| Case | Expected |
|---|---|
| valid response | stored, `valid = true` |
| action not allowed | invalid; retry; then fallback |
| quantity differs from rule quantity (policy none) | invalid |
| quantity inside range (policy bounded) | valid |
| invented number in explanation | invalid |
| mentions another SKU | invalid |
| `needs_judgment` false while engine true | invalid |
| LOW confidence with needs_judgment false | invalid |
| malformed JSON, timeout, API error | retry up to 2, then fallback with `is_fallback = true` |
| fallback decision | templated explanation, badge flag set, excluded from Kill 1 count |
| over 30% fallbacks in a run | run-level warning raised |
| API key | never appears in logs, responses, or client bundle (grep test on build output) |

## F. Review and workflow tests
- Accept sends the decision to a buying decision with the AI's action and quantity.
- Reject without a reason code is refused. Reject with no change from the AI decision is refused.
- Reject creates a buying decision with Raghav's final action and quantity, and stores flag, decision, reason code and text.
- Needs-judgment and fallback rows cannot be bulk-accepted.
- Only `raghav` (or audited `admin`) can review; procurement, priya, deepa, ceo get 403.
- Nothing reaches buying without a review. Direct API attempts to create a buying decision from an unreviewed decision fail.
- Reviews are append-only; a post-buying change writes an audit entry.
- Procurement can mark placed; `held` items show the warning banner.

## G. Kill switch tests
**Kill 1** (min 30 reviewed, 10%, cumulative, fallbacks excluded):
| Reviewed | Reversed | Expected |
|---|---|---|
| 29 | 10 | no kill (below minimum sample) |
| 30 | 2 | OK (6.7%) |
| 30 | 3 | **KILL** (exactly 10%) |
| 100 | 9 | OK |
| 100 | 10 | **KILL** |
| 30 valid + 20 fallback, 3 reversed of valid | **KILL** (fallbacks excluded) |
After a kill: new runs blocked, unreviewed decisions voided, buying decisions held, banner shown on every page. Re-arm by deepa or ceo with a 20+ character reason resets the epoch; any other role gets 403.

**Kill 2** (calendar quarter, quarter-to-date sum):
| Quarter-to-date loss (Rs) | Expected state |
|---|---|
| 28,00,000 | green |
| 28,00,001 | alert (email queued to Raghav, Deepa, CEO; dashboard alert) |
| 34,00,000 | alert |
| 34,00,001 | **killed** |
Also: entries split across several records sum correctly; an entry dated in a new quarter does not count toward the previous one; a killed state survives a quarter rollover until re-armed; evaluation is idempotent (two evaluations create one event).

## H. End-to-end (Playwright, seed data, mock Gemini)
1. Raghav signs in, uploads the five seed files, starts a run, sees 7 flags.
2. Reviews: accepts 5, rejects 2 with reasons. Run completes.
3. Procurement sees 7 buying decisions, marks them placed.
4. Priya enters a loss of Rs 29,00,000 for the quarter. Alert appears; email is queued.
5. Priya enters another Rs 6,00,000 (total Rs 35,00,000). Kill 2 fires; banner everywhere; new run disabled.
6. Deepa re-arms with a reason; the audit log shows every step.

## I. Non-functional
- Run of 400 SKUs with 52 weeks of history completes the rule engine in under 5 seconds.
- Pages meet the UI rules: buttons at least 44px, ivory background, no colour outside the token set.
- `npm run lint`, `typecheck`, `test` all pass in CI.
