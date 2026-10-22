# 05: Guardrails

Guardrails are things that must always (or never) happen. They are enforced in code and covered by tests, not left to the prompt. Lesson from the course: a system can run perfectly and still fail when the old workflow assumed human accuracy and no review step was added. Here, the review step is built in.

## 1. Data guardrails
- **G-D1** A run is blocked if any validation ERROR in `03-DATA-SPEC.md` exists. No partial runs.
- **G-D2** Never silently repair data. Cleaning is limited to trim, line endings, and type casting. Everything else is reported.
- **G-D3** Stale data is blocked: inventory older than 7 days, or sales not ending at the last complete week.
- **G-D4** The calendar must contain the run month, otherwise the run is blocked (the festival uplift would be wrong).
- **G-D5** Raw uploaded files are stored per run so any result can be reproduced.

## 2. Rule-engine guardrails
- **G-R1** All thresholds come from `config/rules.json`. A hardcoded threshold is a bug.
- **G-R2** The engine is deterministic: same input and same config always produce the same flags. No randomness, no model calls in this stage.
- **G-R3** Every run stores the full `rules_json` and `rules_version` it used.
- **G-R4** Comparisons are exact as written: `>` 20%, `<` min cover, `>` max cover. Boundary values are covered by tests.
- **G-R5** Raghav cannot edit rules in the app. Rule changes need a config change and a new `rules_version`.

## 3. AI guardrails
- **G-A1** The AI never creates, removes, or re-scores a flag.
- **G-A2** Action must be in the allowed set; quantity must be inside the allowed limits (under the default policy: equal to the rule quantity).
- **G-A3** The explanation may contain only numbers present in the input. Any invented number invalidates the response.
- **G-A4** The AI may raise `needs_judgment`, never lower it.
- **G-A5** On invalid output after retries, or on API failure: rule-engine fallback, clearly badged, excluded from Kill 1.
- **G-A6** No free-text user input ever reaches the model. Product names are passed as data and the prompt says to treat them as data.
- **G-A7** Server-side only. The Gemini key never reaches the browser, logs, or the repo.
- **G-A8** The system never claims certainty it does not have: LOW confidence always means needs-judgment.

## 4. Human-in-the-loop guardrails
- **G-H1** No AI decision reaches buying without Raghav's explicit accept or reject. There is no auto-approve and no timeout-approve.
- **G-H2** A rejection requires a reason code (and free text when the code is OTHER). It cannot be saved without one.
- **G-H3** Raghav changes the flag and the decision for the item; he never changes rules from this screen.
- **G-H4** Items marked `needs_judgment` are shown first and visually distinct. They cannot be bulk-accepted.
- **G-H5** Bulk accept is allowed only for items that are not `needs_judgment` and not fallback, and only after the list is on screen (no blind "accept all" button with a hidden list).
- **G-H6** Reviews are append-only. After a buying decision exists, any change goes through an audit entry.
- **G-H7** Only the `raghav` role (or `admin` as a break-glass, audit-logged) can review. Procurement can only act on reviewed items.

## 5. Buying guardrails
- **G-B1** A buying decision is created only from a reviewed decision (accepted or rejected-and-changed).
- **G-B2** Procurement places the order; the system never places an order by itself.
- **G-B3** When the Zoho adapter exists, it can only create draft purchase orders and requires procurement confirmation. No direct submit.
- **G-B4** PAUSE_ORDER decisions are shown to procurement as "hold the next order", never as a cancellation of an existing order.
- **G-B5** Quantity must be a positive whole number for REORDER and zero for PAUSE_ORDER, whoever sets it.

## 6. Kill-switch guardrails
- **G-K1** Kill states are evaluated automatically after every review action and every loss entry. No human has to remember to check.
- **G-K2** When a kill fires, the AI step and new runs stop immediately. See `06-KILL-SWITCHES.md`.
- **G-K3** Re-arming a kill switch needs role `deepa` or `ceo`, a written reason, and creates an audit entry. Nobody else can re-arm.
- **G-K4** Kill events are never deleted or edited.

## 7. Security guardrails
- **G-S1** Secrets only in environment variables. `.env.local` git-ignored; `.env.example` has empty values.
- **G-S2** Never log request headers, API keys, tokens, or full uploaded files in application logs.
- **G-S3** Role-based access on every API route and page (server-side checks, not just hidden buttons).
- **G-S4** All input validated server-side (file size limit 5 MB per file, CSV only, row cap of 500,000 sales rows).
- **G-S5** SQL only through the ORM or parameterised queries.
- **G-S6** Session cookies httpOnly, secure, sameSite=lax.
- **G-S7** Upload parsing never executes anything from file content (treat CSV cells beginning with `=`, `+`, `-`, `@` as plain text on export to CSV to avoid formula injection).

## 8. Audit and measurement guardrails
- **G-M1** The dashboard measures outcomes in the world (rupee losses, reversal rate), not only system activity (runs, tokens, flags).
- **G-M2** Every state change (upload, run, review, buying decision, loss entry, kill event, re-arm) writes an `audit_log` row with actor and time.
- **G-M3** Metric definitions are fixed in `09-MEASUREMENT-PLAN.md`; the dashboard must not redefine them.

## 9. UI guardrails
- **G-U1** No vibrant red. Warnings and kills use muted tones (see `08-UI-DESIGN-SYSTEM.md`).
- **G-U2** Buttons are at least 44px tall.
- **G-U3** A killed state is always visible at the top of every page for every role.
- **G-U4** The UI never presents an AI decision as final. It says "AI decision, pending your review".
