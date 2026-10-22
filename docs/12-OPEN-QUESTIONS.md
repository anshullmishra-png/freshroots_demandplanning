# 12: Open Questions and Defaults

These are decisions the case and the user's answers did not settle. **Build with the default shown, keep each one behind `config/rules.json` (or a single constant), and ask the user to confirm.** When the user answers, update this file, the config, and any doc named in the last column. Do not silently change a default.

Priority A = changes flags or kill behaviour; confirm first. B = changes behaviour at the edges. C = can wait.

| # | Pri | Question | Default used | Where it matters |
|---|---|---|---|---|
| 1 | A | May the AI differ from the rule engine's action or quantity? "AI does the action, quantity, explanation" can mean restate-and-explain, or genuinely decide. | **No.** AI must match the rule action and quantity (`ai.deviation_policy = none`). Alternative `bounded` (+/- a set %) is built but off | 04, config |
| 2 | A | Is the 12-week average taken over the last 12 weeks including the last 4, or over the 12 weeks before them? | **Including** the last 4 (W31-W42 on seed) | 02, config |
| 3 | A | How does the 25% festival uplift apply? On which date is the month judged? | Multiply the average demand rate by 1.25 for cover calculations; the demand ratio is unaffected; the month of `as_of_date` decides | 02, 10 |
| 4 | A | Do perishable limits (3 min, 4 max weeks) replace the 6 and 14 week limits? | **Replace** them for Perishability = High | 02 |
| 5 | A | Reorder quantity for stockout risk without high demand, and when both flags apply | Stockout only: 1.0 x standard qty. Both: 1.5 x (highest wins). Standard qty = `Standard_Reorder_Qty` | 02 |
| 6 | A | What counts as a "reversal" for Kill 1? | Raghav rejects and the final action or quantity differs from the AI's. Fallback decisions are excluded | 06 |
| 7 | A | Kill 1 counting unit and window | Each reviewed AI decision per run counts once; cumulative since go-live (restarts at re-arm); minimum 30 reviewed; fires at 10% or more | 06 |
| 8 | A | What is a "quarter" for Kill 2 and how often are losses entered? | Calendar quarters (Jan-Mar = Q1, matching "running by Q1"); Priya enters weekly or monthly figures; kill evaluated on the quarter-to-date sum | 06, 09 |
| 9 | A | How does Priya compute "stockout lost sales (Rs)" and "overstock write-off (Rs)"? The seed has no prices or loss data | Priya enters figures from her existing method; the app does not compute them | 09 |
| 10 | A | What exactly happens to in-flight work when a kill fires? | New runs and AI blocked; unreviewed decisions voided; unplaced buying decisions marked held (not cancelled); banner everywhere | 06 |
| 11 | A | Who may re-arm a kill switch, and what resets? | `deepa` or `ceo`, written reason; Kill 1 count restarts; Kill 2 keeps loss entries | 06 |
| 12 | B | Kill 2 alert delivery and what "monitor closely" means | Dashboard alert + email to Raghav, Deepa, CEO; Deepa reviews weekly and acknowledges in the app | 06, 07 |
| 13 | B | Email provider | `console` logger in dev; real provider to be chosen | 11 |
| 14 | B | Needs-judgment proxies (the 15-20% the rules cannot cover) | Conflicting flags; under 12 weeks of history; a zero-sales week in the last 12; a week-on-week swing above 50% in the last 4 weeks | 02 |
| 15 | B | What if Raghav does not review in time? | No auto-approve (ever). Show "waiting for review" age. No escalation timer | 05, 07 |
| 16 | B | What does `Distributor_ID` on the SKU master mean, and do distributor regions outside Maharashtra and Goa matter? | Stored and shown as information only; not used in any calculation | 03 |
| 17 | B | Which days are the two weekly data pulls? | Not enforced. No scheduling in the app (the trigger is manual) | 01, 07 |
| 18 | B | Success target beyond staying under the baseline (for example a % reduction)? | None set. States are only green, alert, killed | 09 |
| 19 | B | Users and roles: who exactly has an account, and sign-in method | Seed one user per role (raghav, procurement, priya, deepa, ceo) plus admin; email + password; names and emails to be provided | 07, 11 |
| 20 | C | Gemini model ID | From `GEMINI_MODEL`; Claude Code verifies the current ID in Google's docs and tells the user | 04, 11 |
| 21 | C | Zoho Inventory: which module, when | Draft purchase orders only, built after the user provides credentials. First release exports CSV | 11 |
| 22 | C | Spot-check of unflagged SKUs to guard against automation bias (used in the course's hiring example) | **Off.** Not on the approved component map | 05 |
| 23 | C | Real scale: 400 SKUs and 1,200 distributors versus the 15-SKU seed. Sales are SKU-level in the seed | Build for 400 SKUs; forecasting stays SKU-level in the first release | 03 |
| 24 | C | Past-year loss history to compare festival quarters like for like | Not available; compare to the stated baseline only | 09 |

## How to use this file
- When a build decision touches one of these, use the default and write a one-line note in the pull request: "Used default for Q#".
- If something comes up that is not in this table, stop and ask the user one short question, then add it here.
