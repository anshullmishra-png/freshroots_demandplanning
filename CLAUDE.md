# CLAUDE.md: Freshroots Demand Planning Automation

You are building a working web app and pipeline for Freshroots (FMCG distributor, Maharashtra + Goa). Read this file first, then the docs in the order listed. Do not start coding until you have read them all.

## What you are building (one paragraph)
Raghav (Senior Demand Planner) pulls SAP data 2 times a week and uploads it. A deterministic rule engine cleans it, forecasts, and flags stockout / overstock / high-demand SKUs. A Google Gemini step turns each flag into a decision (action, quantity) with a plain-language explanation. Raghav reviews every AI decision: accepted ones go on to the buying decision, rejected ones he changes (flag + decision + reason) and then they go to the buying decision. Procurement places orders (Zoho Inventory later). Priya owns a dashboard that tracks flags, reversals, and quarterly losses. Two kill switches stop the automation: Kill 1 (Raghav reverses 10% or more of AI decisions, once at least 30 exist) and Kill 2 (quarterly loss above Rs 34L, with an alert above Rs 28L).

## The one rule
Write the outcome before the code. The outcome is NOT "forecasts are produced". It is: **quarterly stockout + overstock losses stay below the Rs 28-34 lakh baseline.** Every feature must serve that outcome or a kill switch. If a requested feature does not, say so and ask.

## Read these, in this order
1. `docs/00-PROJECT-BRIEF.md`: case, outcome, baseline, pre-build decisions
2. `docs/01-COMPONENT-MAP.md`: the approved component map (source of truth for the workflow)
3. `docs/02-BUSINESS-RULES.md`: Raghav's rules, exact definitions, worked example
4. `docs/03-DATA-SPEC.md`: seed data, validation, database schema
5. `docs/04-AI-SPEC.md` + `prompts/`: Gemini step, schema, validation, fallback
6. `docs/05-GUARDRAILS.md`: what must never happen
7. `docs/06-KILL-SWITCHES.md`: exact kill logic
8. `docs/07-WORKFLOW-AND-SCREENS.md`: roles, screens, flows
9. `docs/08-UI-DESIGN-SYSTEM.md`: design tokens and components
10. `docs/09-MEASUREMENT-PLAN.md`: dashboard metrics, how success is measured
11. `docs/10-TEST-PLAN.md`: golden tests on the seed data
12. `docs/11-DEPLOYMENT-AND-ENV.md`: stack, env vars, secrets
13. `docs/12-OPEN-QUESTIONS.md`: **unresolved decisions and the defaults you must use**
14. `docs/13-BUILD-PLAN.md`: phases and acceptance criteria
15. `config/rules.json`: all thresholds live here

## Working rules
- **Do not invent requirements.** If something is not in the docs, check `docs/12-OPEN-QUESTIONS.md`. If it is not there either, stop and ask the user one short question.
- **Use the defaults in `12-OPEN-QUESTIONS.md` until the user answers**, and keep every one of them behind `config/rules.json` so changing it is a one-line edit.
- **No hardcoded thresholds.** 6 weeks, 14 weeks, 20%, 1.5x, 25%, 30 decisions, 10%, Rs 28L, Rs 34L all come from config.
- **The rule engine is deterministic and is the source of truth for flags.** Gemini never creates, removes, or re-scores a flag.
- **Tests first for the rule engine and kill logic.** The golden tests in `docs/10-TEST-PLAN.md` must pass before any UI work.
- **Every AI decision is reviewed by a human before it can reach buying.** No exceptions, no auto-approve.
- **Secrets:** never ask the user to paste keys into chat, never commit them, never log them, never put them in these docs. Read them from environment variables (`docs/11-DEPLOYMENT-AND-ENV.md`). Create `.env.example` with empty values only; `.env.local` is git-ignored.
- **Show your work in small steps.** After each phase in `13-BUILD-PLAN.md`, run the tests, summarise what passed, and wait for the user's go-ahead.
- **Dates and time:** Asia/Kolkata, ISO weeks (`YYYY-Www`, week starts Monday). Money is stored in rupees, displayed in lakhs (1 lakh = 100,000).
- **UI:** follow `docs/08-UI-DESIGN-SYSTEM.md` exactly (sapphire/gold/ivory, Inter, 44px minimum buttons, no vibrant red).

## Definition of done (whole project)
- Golden tests pass on `seed/` data and match `docs/10-TEST-PLAN.md`.
- A full run (upload, flags, AI decisions, review, buying decision, dashboard) works end to end on Vercel + Neon with seed data.
- Both kill switches fire at the exact thresholds, are visible on the dashboard, and are audit-logged.
- No secret appears in the repo, logs, or client bundle.
