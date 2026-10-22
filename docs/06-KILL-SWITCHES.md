# 06: Kill Switches

Two kill switches stop the AI automation and return Freshroots to the previous process (Raghav's manual monthly forecast and procurement as before). Both are monitors that sit outside the workflow. Thresholds come from `config/rules.json`.

## KILL 1: Reversal monitor
**Meaning:** if Raghav reverses 10% or more of AI flag decisions, the automation is projecting wrong.

**Counts**
- A **decision** is one reviewed AI flag decision (one `ai_decisions` row that has a `reviews` row). The same SKU flagged in two different runs is two decisions.
- A **reversal** is a review with outcome `rejected` where the final action or final quantity differs from the AI's. (DEFAULT, see `12-OPEN-QUESTIONS.md`: any change to action or quantity counts; a reason-only rejection with no change is impossible because a rejection must change something.)
- Fallback decisions (`is_fallback = true`) are excluded from both numerator and denominator.
- Counting is **cumulative since go-live** (or since the last re-arm, see below).
- Counting is done by Priya's dashboard data (the dashboard owns the number).

**Trigger**
```
reviewed = count of valid, non-fallback AI decisions with a review, since epoch
reversed = count of those with outcome 'rejected' (final differs from AI)
if reviewed >= 30 and reversed / reviewed >= 0.10:   # exactly 10% fires
    KILL 1
```
Examples: 29 reviewed, 10 reversed: no kill (below the minimum sample). 30 reviewed, 2 reversed (6.7%): OK. 30 reviewed, 3 reversed (10.0%): KILL. 100 reviewed, 10 reversed: KILL. 100 reviewed, 9 reversed: OK.

**Reference SQL** (adapt to the ORM):
```sql
SELECT count(*) AS reviewed,
       count(*) FILTER (WHERE r.outcome = 'rejected') AS reversed
FROM ai_decisions d
JOIN reviews r ON r.ai_decision_id = d.id
WHERE d.is_fallback = false
  AND r.reviewed_at >= (SELECT kill1_epoch_start FROM kill_state);
```

## KILL 2: Outcome gate (merged with the Outcome box)
**Meaning:** quarterly demand-planning loss is not staying below the baseline.

**Measure:** `quarter_to_date_loss = sum(stockout_loss_rupees + overstock_writeoff_rupees)` over all `loss_entries` falling inside the current calendar quarter (Jan-Mar, Apr-Jun, Jul-Sep, Oct-Dec; DEFAULT, see open questions).

| State | Condition (strictly above) | What happens |
|---|---|---|
| green | loss <= Rs 28,00,000 | nothing |
| **alert** | loss > Rs 28,00,000 and <= Rs 34,00,000 | dashboard alert; email to Raghav, Deepa, CEO; "monitor closely" = Deepa reviews weekly and acknowledges in the app |
| **killed** | loss > Rs 34,00,000 | KILL 2: stop the automation and revert to the previous process |

Examples: 28,00,000 exactly: green. 28,00,001: alert. 34,00,000 exactly: alert. 34,00,001: killed.
The quarter resets to green at the start of each new quarter (a killed state does NOT reset; it needs a re-arm).

**Data source:** Priya enters actual stockout lost-sales (Rs) and overstock write-off (Rs) as loss entries (weekly or monthly, her choice; the sum is what counts). The seed data has no rupee-loss data, so this is a manual entry form first. Later it can come from SAP/Zoho.

## What "killed" does (both switches)
1. `kill_state` flips to killed. A `kill_events` row and an `audit_log` row are written with the metric, threshold, and counts.
2. New runs and the AI step are blocked. The "New run" button is disabled and shows why.
3. All unreviewed AI decisions are marked `voided_by_kill` and cannot be reviewed.
4. Buying decisions already created but not yet placed are marked `held` and shown to procurement with the banner "Automation stopped. Confirm with Raghav before ordering." They are not cancelled. (DEFAULT, see open questions.)
5. Every page shows a top banner: "Automation stopped (Kill 1/2). Use the previous process." Dashboard stays readable.
6. Email to Raghav, Deepa, CEO, Priya with the metric and threshold.

## Re-arming
- Only role `deepa` or `ceo`. Needs a written reason (min 20 characters).
- Writes `kill_events (rearmed)` and `audit_log`.
- Kill 1 re-arm sets `kill1_epoch_start = now()` so counting restarts from zero; otherwise it would fire again immediately. Past data is kept.
- Kill 2 re-arm does not erase loss entries. If the quarter-to-date loss is still above Rs 34L it will fire again on the next evaluation, so the UI must warn before allowing the re-arm.

## When to evaluate
- Kill 1: after every review is saved.
- Kill 2: after every loss entry is saved or edited, and once a day by a scheduled job (Vercel Cron) in case of rollovers.
- Evaluation is idempotent: running it twice produces one event, not two.

## Dashboard display
- Kill 1 card: reviewed count out of 30 minimum, reversals, reversal rate with 10% line, state. Before 30 reviews it reads "Collecting data: n of 30".
- Kill 2 card: quarter-to-date loss, bands at Rs 28L and Rs 34L, state.
- Muted colours only (no vibrant red): armed/green = emerald, alert = gold, killed = muted terracotta.

## Tests required
See `10-TEST-PLAN.md`, section "Kill switch tests". Boundary values above must each be a test.
