# 09: Measurement Plan

Principle: measure what changed in the world, not what the system did. "Flags produced" and "AI calls made" are activity. Rupee losses and Raghav's reversal rate are results.

## Primary outcome metric
| Metric | Definition | Baseline | Source |
|---|---|---|---|
| **Quarter-to-date demand-planning loss (Rs)** | Sum of stockout lost sales + overstock write-offs over `loss_entries` in the current calendar quarter | Rs 28-34 lakh per quarter (stockout Rs 18-22L + overstock Rs 10-12L) | Priya's loss entries |
| Stockout loss (Rs) | Lost sales from SKUs that ran out before the next order arrived | Rs 18-22L per quarter | Priya |
| Overstock write-off (Rs) | Write-offs, mostly perishable SKUs | Rs 10-12L per quarter | Priya |

Bands: green at or below Rs 28L, alert above Rs 28L, kill above Rs 34L.

## Quality metrics (is the AI trustworthy?)
| Metric | Definition |
|---|---|
| **Reversal rate** | Reversed reviewed AI decisions / reviewed AI decisions (non-fallback, cumulative since epoch). Kill 1 fires at 10% or more once 30 are reviewed |
| Reversals by reason code | Count of rejections per `reason_code`. Weekly review input for improving rules and prompts |
| AI fallback rate | Fallback decisions / all decisions in a run. Warn above 30% |
| Needs-judgment share | Decisions flagged needs_judgment / all decisions. A proxy for the 15-20% the rules do not cover |

## Workflow metrics (did the process change?)
| Metric | Definition | Baseline |
|---|---|---|
| **Data age at buying decision (days)** | `placed_at` minus `as_of_date` of the run | 3-4 weeks (21-28 days) |
| Runs per month | Completed runs in the month | 1 (monthly process) |
| Review turnaround (hours) | Run created to last review saved | Not measured before |
| Order lag (hours) | Review saved to order marked placed | Not measured before |

## Activity metrics (shown, but never used as proof of success)
Flags per run by type, accepted vs rejected counts, runs completed.

## Instrumentation
- Every metric is computed from database tables defined in `03-DATA-SPEC.md`, with fixed definitions (guardrail G-M3). The dashboard cannot redefine them.
- Losses are entered by Priya, because the seed data carries no rupee loss. Method for computing the figures is Priya's existing method (see open questions).
- Each dashboard metric has a tooltip with its definition and baseline.

## Review rhythm
| When | Who | What |
|---|---|---|
| After each run | Raghav | Review all decisions; reasons recorded |
| Weekly | Deepa | Review reversal rate, reason codes, and (during an alert) loss trend; acknowledge in the app |
| Weekly | Priya | Enter loss figures for the week or month |
| Quarterly | Deepa + CEO | Compare quarter loss with the Rs 28-34L baseline; decide continue, redesign, or stop |

## Reading the results honestly
- Festival months (Oct, Nov, Mar) lift demand and risk. Compare like with like where possible (same quarter last year) before claiming an improvement.
- A low reversal rate does not prove the outcome. It only shows Raghav agrees with the AI. The loss figure is the judge.
- Kill 2 can only be read after real loss data exists for a quarter. Until then Kill 1 and the quality metrics are the early warning.
