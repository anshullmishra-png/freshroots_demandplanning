# 14: Deploy runbook (Phase 8)

How Freshroots gets from this repository to a running preview and then to production, who provides what, and what to check. Written for Raghav and for whoever deploys. Docs/11 says what the pieces are; this says what to do.

## 1. Three environments

| | Local | Preview | Production |
|---|---|---|---|
| Where | the developer's machine | Vercel preview deployment | Vercel production (`main`) |
| Database | Neon `dev` branch (throwaway) | Neon `preview` branch (throwaway) | Neon `production` branch (**empty at start, real data only**) |
| AI | real Gemini, or `AI_CLIENT=mock` | `AI_CLIENT=mock` for the end-to-end test, then real Gemini for one smoke run | real Gemini only. `AI_CLIENT=mock` is **refused** on production |
| Accounts | demo or e2e accounts (emails end `.test`) | e2e accounts | the six real people |
| Kill-check cron | not run | not run (Vercel runs crons on production only) | daily 00:30 UTC (06:00 India) |
| Email | console (logs only) | console | **console until a provider is chosen (Q13): alerts reach nobody** |

Never point a preview at the production database. The reset script for the end-to-end test refuses a database that has any account whose email does not end in `.test`.

## 2. What the person deploying needs, and how it is handed over

Nothing secret is ever typed into chat or committed. A value goes from where it is created to the clipboard to the tool, and the clipboard is cleared afterwards.

| Need | Used for | How it is provided |
|---|---|---|
| **Vercel access token** (account, Tokens; scoped to the team; short expiry) | create the project, set variables, deploy | copy it, then say "copied Vercel" |
| **Neon API key** (account, API keys) | create the `preview` and `production` branches and read their connection strings | copy it, then say "copied Neon". Without it: create the two branches in the Neon console and copy each connection string, one at a time, saying which it is |
| Gemini key | the AI step | already on the machine in `.env.local`. It is pushed to Vercel without being shown |
| `AUTH_SECRET`, `CRON_SECRET` | sessions, cron | generated per environment by the deployer (different value in preview and production) |
| Real names and emails of the six people | the accounts | in `users.local.json` (git-ignored), then `npm run seed:users`. Passwords are generated, written to `.seed-passwords.local.txt`, and handed over privately |
| Email provider choice and key (Q13) | alert and kill emails | decision first, then the key by clipboard. Until then the app shows the problem on the health page |
| **Approval** | the first production deploy | said in chat. Nothing is promoted to production without it |

After the build: rotate the Neon password (the first connection string was pasted into a chat), and revoke or let expire the Vercel and Neon tokens.

## 3. Environment variables

Set in Vercel per environment (`vercel env add NAME production|preview`, value from stdin, never on the command line).

| Variable | Preview | Production | Notes |
|---|---|---|---|
| `DATABASE_URL` | preview branch, pooled | production branch, pooled | the app |
| `DATABASE_URL_UNPOOLED` | preview branch, direct | production branch, direct | migrations only (`drizzle-kit`) |
| `AUTH_SECRET` | random 32+ bytes | a different random 32+ bytes | |
| `CRON_SECRET` | random 16+ chars | a different one | also guards `/api/health/deep` |
| `APP_URL` | the preview address | the https address people use | alert emails link to it |
| `GEMINI_API_KEY`, `GEMINI_MODEL` | yes | yes | model checked against Google's docs before first use (Q20) |
| `AI_CLIENT` | `mock` while testing, then unset | **never set** | production refuses it |
| `AI_MOCK_DELAY_MS`, `AI_STEP_BUDGET_SECONDS` | `700` and `0.5` while testing the mock, then unset | never set | test hooks that make a run need two requests, so the browser's "carry on" loop is exercised. They only act on the mock |
| `EMAIL_PROVIDER` | `console` | `console` until Q13 | `/api/health/deep` warns while it is `console` |

## 4. First deployment, step by step

1. **Neon.** Create branches `preview` and `production` from an empty parent. Keep `dev` for local work.
2. **Migrations** on each branch: `DATABASE_URL_UNPOOLED=<branch> npm run db:migrate`. Check `/api/health/deep` afterwards.
3. **Vercel project** from the GitHub repo (framework Next.js, Node 22 or newer, default build). Set the variables in section 3.
4. **Preview deploy** of `phase-8-deploy`. In the Vercel project, create a "Protection Bypass for Automation" secret so the test can get past Vercel's own sign-in (`VERCEL_AUTOMATION_BYPASS_SECRET`).
5. **End-to-end test against the preview** (mock AI, preview database):
   ```
   npm run e2e:reset -- --host <preview database host>
   E2E_BASE_URL=https://<preview> E2E_EXPECT_RESUME=1 E2E_DATABASE_URL=<preview connection> npm run test:e2e
   ```
   All seven tests must pass. (`E2E_EXPECT_RESUME=1` is right only while the preview has the two test hooks from section 3.) Then unset `AI_CLIENT` on the preview and do one run with real Gemini from the screen; check every decision shows a real explanation and the fallback count is low.
6. **Production data.** Production starts empty. Create the six real accounts: `users.local.json`, then `npm run seed:users` pointed at the production branch. The seed data is **not** loaded on production; Raghav uploads the first real SAP files.
7. **Go-live reset of Kill 1.** Kill 1 counts reviews since the database was migrated. On go-live day, set the epoch to that moment (re-arm count: `UPDATE kill_state SET kill1_epoch_start = now()`) so test reviews never count.
8. **Production deploy, only after approval.** Merge to `main`, confirm `/api/health/deep` (with the cron secret) reports `ok: true`, then sign in as each role once.
9. Watch the first daily kill-check (06:00 India next morning): `/kill` shows it, the audit log shows `kill2.*` only if a level was crossed.

## 5. Before every run, every week

- The inventory file must be 7 days old or less. The calendar file must contain the as-of month. The seed's calendar ends in 2026-12: upload a calendar that covers the next year before January.
- A run takes a few minutes. The New Run screen shows "AI decisions x of y" and must stay open; if it is closed, the run is saved and Raghav finishes it from the Review page ("Make the remaining decisions").

## 6. Operations

- `/api/health` is public and says only `ok`. `/api/health/deep` needs `Authorization: Bearer <CRON_SECRET>`: database reachable, every table present, the kill-state row present, which variables are set (never their values), AI mode, email provider. It returns 503 when something is wrong.
- Brute-force protection: 5 wrong passwords for one email, or 20 failures from one address, in 15 minutes locks further attempts for the rest of the window (settings in `config/rules.json`). A person locked out waits at most 15 minutes. An attacker can also keep a real person locked out by guessing their email; the audit trail and the 15-minute limit are the accepted cost.
- Weekly: export `audit_log`, `reviews`, `kill_events` for Priya (Dashboard exports).
- Rollback: Vercel keeps previous deployments; promote the last good one. Migrations are additive, so an older deployment keeps working with a newer database.
- Secrets: if one leaks, rotate it in the source (Neon, Google, Vercel), then update Vercel. `AUTH_SECRET` rotation signs everyone out.

## 7. Known limits

- Email is a logger until a provider is chosen (Q13). Until then Raghav, Deepa and the CEO see an alert or a stop only by opening the app (the banner shows on every page).
- Zoho is not connected; procurement works from the CSV export.
- The AI step uses a budget per request (`ai.step_budget_seconds`, 150) inside Vercel's 300 second limit and carries on in further requests. Hobby and Pro plans both allow 300 seconds on these routes.
- The daily check runs on production only, once a day, at a time Vercel may shift within the hour on a Hobby plan.
