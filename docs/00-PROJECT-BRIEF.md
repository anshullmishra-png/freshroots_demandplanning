# 00: Project Brief

## Company and mandate
Freshroots: 200-person FMCG company distributing packaged snacks and staples across Maharashtra and Goa. 12 years old, regional brand. The CEO wants "something running by Q1" with Rs 15 lakh and 90 days. Deepa Nair (Head of Operations) has no AI team: a 3-person IT team (runs SAP ERP) and one data analyst (Priya Sharma).

## Why demand planning was chosen first
Of three candidate areas (demand planning, distributor service, operations intelligence), demand planning is the only one where outcome, baseline, documented logic, and data all exist today:
- Outcome is measurable in rupees (stockout + overstock loss).
- Baseline is known: Rs 28-34 lakh per quarter.
- Logic is documented (Raghav's rules cover ~80-85% of monthly recommendations).
- Data exists (SAP, exportable as structured files).
Distributor service has no baseline data. Operations intelligence is mainly an ownership problem, not an AI problem.

## Current state
- Raghav Kulkarni, Senior Demand Planner, 6 years in role. Monthly process: about 2 working days pulling sales + inventory from SAP, calculating in Excel, producing a forecast per SKU. Output feeds procurement.
- Data is 3-4 weeks old by the time procurement acts. Festival periods and competitor schemes are missed.
- Raghav: "If the data were already organised for me, I could run the same analysis twice a week."
- Purchase orders are managed in Zoho Inventory (integration comes later).

## The problem in numbers (baseline)
| Item | Per quarter |
|---|---|
| Stockouts (lost sales) | Rs 18-22 lakh |
| Overstock write-offs (mostly perishables) | Rs 10-12 lakh |
| **Total demand planning loss** | **Rs 28-34 lakh** |

## Outcome requirement (not a behavioural requirement)
> After this system runs, Freshroots' quarterly stockout + overstock loss will stay below the Rs 28-34 lakh baseline.

Behavioural requirements ("the system produces flags twice a week") are explicitly NOT the success measure. A system that produces flags and does not lower the loss has failed.

## Five pre-build decisions
1. **Outcome definition:** lower quarterly demand-planning loss, measured in rupees.
2. **Baseline:** Rs 18-22L stockout + Rs 10-12L overstock = Rs 28-34L per quarter.
3. **Workflow change:** cadence moves from monthly to 2 times a week; Raghav moves from calculator to reviewer; accepted AI decisions flow straight to buying; his rejections are logged with a reason.
4. **Measurement plan:** measured in the world (rupee losses, reversal rate), not in logs. See `09-MEASUREMENT-PLAN.md`.
5. **Kill criteria:** Kill 1 and Kill 2. See `06-KILL-SWITCHES.md`.

## What this system is not
- Not a replacement for Raghav's judgment on the 15-20% of cases the rules cannot cover (launches, unusual distributor behaviour, one-off events). Those are surfaced for him, not decided for him.
- Not connected to SAP or Zoho live in the first release: SAP data arrives as exported CSV files; Zoho is a later adapter.
- Not a chatbot. No free-text AI interface.

## People and roles
| Person | Role in system |
|---|---|
| Raghav Kulkarni | Pulls SAP data, uploads it, reviews every AI decision, changes rejected decisions |
| Procurement team | Receives buying decisions, places orders (Zoho Inventory later) |
| Priya Sharma | Owns the dashboard, enters quarterly loss figures, sees reversal rate |
| Deepa Nair | Kill-switch owner, reviews weekly during an alert |
| CEO | Kill-switch owner, receives alerts |
