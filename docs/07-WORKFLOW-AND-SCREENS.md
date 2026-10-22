# 07: Workflow and Screens

## Roles and access
| Role | Can do | Cannot do |
|---|---|---|
| `raghav` | Upload data, start runs, review and reject/accept AI decisions, view dashboard | Edit rules, place orders, enter losses, re-arm kills |
| `procurement` | See buying decisions, mark orders placed, export order list | Review decisions, start runs |
| `priya` | Enter loss figures, see all dashboard data, export metrics | Review decisions, re-arm kills |
| `deepa` | Everything read-only, acknowledge alerts, re-arm kills | Review decisions (unless admin break-glass) |
| `ceo` | Dashboard read-only, receive alerts, re-arm kills | Review decisions |
| `admin` | Manage users; break-glass actions are audit-logged | n/a |

## End-to-end flow (matches `01-COMPONENT-MAP.md`)
1. **Raghav starts a run (2 times a week, manual).** He exports the files from SAP and uploads them on the New Run page.
2. **Validate.** The system validates and shows a report. Errors block; warnings need a tick.
3. **Forecast + flag.** The rule engine computes metrics and flags. Progress shows on the pipeline tracker.
4. **AI decisions.** Gemini produces a decision and explanation per flag. Invalid outputs fall back to the rule engine and are badged.
5. **Raghav reviews** every decision on the Review page.
   - **Accept:** the decision goes straight to a buying decision.
   - **Reject:** he changes the flag and the decision, picks a reason, and saves. The changed decision goes to a buying decision.
6. **Buying decision.** Procurement sees the final decisions and places the orders (Zoho Inventory later). Marks them placed.
7. **Dashboard.** Priya's dashboard updates: flags, reversals, data age, losses.
8. **Outcome + Kill 2.** Priya enters losses; the quarter-to-date total drives the alert and kill.
9. **Kill 1** watches the reversal rate in the background and fires on its own.

## Screens

### 1. Sign in
Email + password. Redirect by role: raghav to Review, procurement to Orders, others to Dashboard.

### 2. New Run (Raghav)
- Five upload slots (sales, inventory, SKU master, distributor master, calendar) with file name, size, row count after parsing.
- "Use previous master files" option for the three master files.
- Validation report: errors (block) and warnings (tick to continue), each with file, row, reason.
- "Start run" button (disabled while killed, with the reason shown).
- Pipeline tracker (vertical timeline): Upload, Validate, Forecast and flag, AI decisions, Review, Buying decision. Completed = emerald check, active = gold arrow, pending = gray.

### 3. Review (Raghav): the main working screen
- Header: run date, rules version, counts (to review / accepted / rejected), AI fallback count.
- List sorted: `needs_judgment` first, then STOCKOUT_RISK, HIGH_DEMAND, OVERSTOCK_RISK.
- Each row: SKU id and name, flag pills, a small cover bar (cover weeks against the min-max band), AI decision ("Reorder 750 units" / "Pause next order"), the explanation, confidence pill, badges (Needs judgment, AI unavailable fallback), buttons **Accept** and **Reject**.
- Label every AI decision as "AI decision, pending your review".
- **Reject panel** (drawer or inline): change flag (HIGH_DEMAND / STOCKOUT_RISK / OVERSTOCK_RISK / none), action (REORDER / PAUSE_ORDER / NO_ACTION), quantity, reason code (required), reason text (required for OTHER). Save is disabled until something differs from the AI decision.
- Bulk accept: only for rows that are not needs-judgment and not fallback; shows the count and the list before confirming.
- Progress at top: "42 of 60 reviewed". The run completes when all rows have a review.

### 4. Orders (Procurement)
- Table of buying decisions: SKU, action, quantity, source (AI accepted / Raghav changed), reason if changed, status (pending, placed, held), run date, data age.
- Actions: Mark placed (with optional order reference), Export CSV (formula-injection-safe).
- Held items (from a kill) show the banner "Automation stopped. Confirm with Raghav before ordering."
- Zoho Inventory sync status panel (shows "Not connected" until the adapter is built).

### 5. Dashboard (Priya owns; visible to all roles)
- Top row: **Quarter-to-date loss** card (with the Rs 28L and Rs 34L bands), **Kill 1** card, **Kill 2** card, **Data age at buying** card.
- Charts: loss per week or month in the quarter, reversal rate over time, rejection reasons by code, flags per run by type.
- Table: run history (date, flags, accepted, rejected, fallback, review turnaround).
- Priya-only: **Enter loss** form (period start/end, stockout loss Rs, overstock write-off Rs, note) and metrics CSV export.
- Metric definitions come from `09-MEASUREMENT-PLAN.md` and are shown in tooltips.

### 6. Kill and alerts (Deepa, CEO)
- Current state of both switches, history of `kill_events`, weekly alert acknowledgement ("I reviewed this week's alert"), and Re-arm (reason required, warns if it will re-fire immediately).

### 7. Audit log (Deepa, admin)
Filterable table of `audit_log`.

### 8. Settings (admin)
Users and roles. Read-only view of the active `rules.json` version.

## Global elements
- Persistent top banner when any kill is active or Kill 2 is in alert.
- Header navigation by role (see `08-UI-DESIGN-SYSTEM.md`). Mobile gets the bottom tab bar; Review and Orders must be usable on a phone.
- Empty states say what to do next ("No run yet. Upload this week's SAP files.").
- Every list has loading, empty, and error states.
