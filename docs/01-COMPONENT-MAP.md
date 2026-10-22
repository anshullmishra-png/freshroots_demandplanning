# 01: Component Map (approved, source of truth)

Rows are actors. Columns are stages: Trigger, Input, Context, Processing, AI, Output. Each component sends to the next one with a single arrow, except where noted.

| # | Component | Stage | Actor | What it is | Goes to |
|---|---|---|---|---|---|
| 1 | Data pull | Trigger | Raghav | Manual, 2 times a week. Raghav pulls data from SAP | #2 |
| 2 | SAP export file | Input | SAP | Exported CSV files (sales, inventory, SKU master, distributor master, calendar) | #3 |
| 3 | Guardrails + rules for ordering | Context | Automation | Raghav's rules + guardrails, loaded from `config/rules.json` | #4 |
| 4 | Clean + forecast + flag | Processing | Automation | Validate and clean the files, compute averages and cover, raise flags | #5 |
| 5 | Flag decision + explanation | AI | AI (Gemini) | AI sets action and quantity for each flag and explains the rule engine's flag | #6 |
| 6 | Raghav reviews | Output | Raghav | Accept or reject each AI decision | accepted: #8; rejected: #7 |
| 7 | Raghav changes the flag + decision | Output | Automation (records) | Only on rejection. He changes the flag and the decision (NOT the rules) and records what is wrong | #8 |
| 8 | Buying decision | Output | Zoho Inventory | The final decision goes to Zoho Inventory; the procurement team places the order | #9 |
| 9 | Dashboard tracking | Output | Priya | Profit and loss and other metrics; Priya owns | #10 |
| 10 | Outcome + KILL 2 | Output | CEO + Deepa | Quarterly loss vs Rs 28-34L. Alert above Rs 28L, kill above Rs 34L | end |
| K1 | KILL 1: reversal monitor | Output | Kill switch 1 | OUTSIDE the workflow. Reads from #9. At 30+ decisions, if reversals reach 10%, stop the AI automation and revert to the previous process | n/a |

## Flow
```
#1 Raghav pulls data -> #2 SAP export file -> #3 Rules + guardrails -> #4 Clean + forecast + flag
  -> #5 AI flag decision + explanation -> #6 Raghav reviews
        |- accepted -> #8 Buying decision
        '- rejected -> #7 Raghav changes flag + decision (+ reason) -> #8 Buying decision
  -> #9 Dashboard -> #10 Outcome (+ Kill 2)

K1 (monitor, not in the flow): reads #9; fires Kill 1.
```

## Notes that matter for the build
- **Kill 1 is not a step in the flow.** Accepted flags do not pass through it. It is a monitor that reads reviewed-decision counts from the dashboard data.
- **Raghav never edits rules in the app.** He changes the flag and the decision for a specific item and gives a reason. Rule changes happen in `config/rules.json` through a code change.
- **The five ordering rules are not on the map**; they live in `02-BUSINESS-RULES.md` and `config/rules.json`.
- **Outcome and Kill 2 are one box (#10).**
- **Zoho Inventory is a later integration.** Until then, #8 produces an order list that procurement can see and export; the adapter interface is defined in `11-DEPLOYMENT-AND-ENV.md`.
