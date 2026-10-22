# 13: Build Plan

Build in phases. After each phase: run the tests, summarise what passed and what did not, list any "default used" items, and **wait for the user's go-ahead**. Do not start the UI before the rule engine passes the golden test.

## Phase 0: Scaffold (setup)
- Next.js + TypeScript + Tailwind, Drizzle, Vitest, Playwright, ESLint, `.env.example`, `.gitignore`, secret scan, GitHub Actions CI.
- Copy `docs/`, `prompts/`, `config/`, `seed/` into the repo as they are.
- Ask the user to set the environment variables (names in `11-DEPLOYMENT-AND-ENV.md`) without pasting them in chat.
- **Done when:** repo builds, CI runs green on an empty test, Neon branch connects.

## Phase 1: Data in
- CSV parser, validation (every rule in `03-DATA-SPEC.md`), snapshot storage, migrations, seed loader.
- **Done when:** the seed files load; every validation test in section D of the test plan passes; a bad file blocks with a clear report.

## Phase 2: Rule engine (pure code, no UI)
- Metrics, flags, recommended action and quantity, needs-judgment proxies, config loading.
- **Done when:** golden test A, variant B, and boundary tests C pass exactly. This is the gate for everything else.

## Phase 3: AI step
- Gemini client (server only), prompt loading with version, structured output, validator, retries, fallback, concurrency limit, logging without secrets.
- Mock client for tests.
- **Done when:** all section E tests pass with the mock; one real call on one seed flag works and passes the validator; the user is told which model ID was used.

## Phase 4: Review and reject workflow
- Auth and roles, Review page, Reject panel (change flag + decision + reason), append-only reviews, guardrails G-H1 to G-H7.
- **Done when:** section F tests pass, including the 403 role tests.

## Phase 5: Buying decision
- Buying decisions from reviews, Orders page, mark placed, CSV export (injection-safe), `OrderSink` interface with `CsvSink`.
- **Done when:** nothing can reach buying without a review; procurement flow works end to end.

## Phase 6: Dashboard and kill switches
- Metrics per `09-MEASUREMENT-PLAN.md`, loss-entry form, Kill 1 and Kill 2 evaluation, kill actions, banners, alert emails (adapter), cron job, re-arm, audit log page.
- **Done when:** section G tests pass at every boundary; the dashboard shows both kill cards and the loss bands.

## Phase 7: UI polish and accessibility
- Apply `08-UI-DESIGN-SYSTEM.md` exactly; mobile bottom bar; Review and Orders usable on a phone; empty, loading, error states.
- **Done when:** UI rules hold (44px buttons, ivory background, no vibrant red, contrast checks).

## Phase 8: Deploy
- Vercel preview, end-to-end test H on the preview with the mock AI, then real Gemini. Production only after approval.
- **Done when:** the full flow works on Vercel + Neon with seed data; no secret in repo, logs, or client bundle.

## Phase 9 (later, only when the user says go): Zoho Inventory
- `ZohoSink` creating draft purchase orders only; credentials from env; test against a sandbox if available.

## For every phase
- Keep thresholds in config, never hardcoded.
- Update `docs/12-OPEN-QUESTIONS.md` when the user answers a question.
- Small commits with clear messages; one pull request per phase.
