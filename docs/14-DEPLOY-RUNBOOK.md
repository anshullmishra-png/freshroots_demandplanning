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
| **Vercel** | create the project, set variables, deploy | **done, no token needed**: the Vercel CLI on the deploying machine is signed in (team `anshull-mesa`), the project `freshroots-demand-planning` exists and is linked to the GitHub repo |
| **Neon connection strings** (pooled and direct) for each database | the app and migrations | the preview database is the current dev branch. For **production**, create an empty branch `production` in the Neon console, then copy each string, saying which it is ("copied Neon production pooled", and so on). An API key is not needed |
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
| `DEMO_OPEN_ACCESS` | `1` on the shared demo preview | **never set** (ignored, and flagged as a problem by the deep health check) | sign in with no password as a test role, see Q58 |
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

### Status of the preview (2026-10-23)
- Deployed from `phase-8-deploy` with `npx vercel deploy`, functions pinned to Singapore (`vercel.json` `regions: ["sin1"]`) beside the Neon database. Vercel's own sign-in protects previews; the test uses an automation bypass secret (kept in the git-ignored `.preview-secrets.local.json`, never in Vercel's variables).
- All seven end-to-end tests passed against it (mock AI, resume loop exercised, headers and lockout checked on the live site).
- One run with real Gemini from Vercel: 7 flags, 7 decisions in 5 s, 0 fallbacks (`npm run smoke:preview`). The preview currently has the real AI. To repeat the end-to-end test, first add the three test hooks (section 3) to the preview, redeploy, and remove them again afterwards.
- Bug found only on the live site: with a short budget, each "carry on" request spent it all on database round trips from the US and finished nothing. Every request now always does at least one batch, and the browser stops and says so if three requests in a row make no progress.

### Status of the databases (2026-10-23)
Neon project `freshroots_demandplanning` (Singapore, `aws-ap-southeast-1`) has two branches, each with its own endpoint:
- `preview` (renamed from the default branch Neon had called `production`): throwaway. Test accounts and test runs. The e2e reset wipes it.
- `production`: a separate root branch created schema-only, then reset and built by running all six migrations, so Drizzle's own record matches. It holds **no users and no data**; the only row is `kill_state` (both switches armed and green). Its connection strings are in the git-ignored `.production-urls.local.json` on the deploying machine and are **not yet in Vercel**.
- Not yet done for production, on purpose: Vercel production variables, the six real accounts, the Kill 1 go-live reset, the first deploy.
- **Lock:** the repo is connected to Vercel, which would deploy production on every push to `main`. `vercel.json` therefore has `git.deploymentEnabled.main = false` (a test pins it), so merging and pushing `main` deploys nothing. **At go-live, after the owner approves:** add the production variables, then either remove that setting in the same commit (the test says so) or run `vercel deploy --prod`, which is not affected by the lock.

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

## 8. Lessons from the first deployments
- The very first `vercel deploy` of a new project lands on the **Production** target, not a preview (it did, on 2026-10-23, with no production variables: a public login page that could not sign anyone in; it was removed). Always deploy previews with `vercel deploy --target=preview`, and check `vercel ls --prod` shows nothing before go-live.
- `vercel env add` reads the value from stdin and stores it as a hidden secret, which `vercel env pull` cannot show. Use Git Bash and `printf '%s'` so no newline is added, and set `MSYS_NO_PATHCONV=1` before `vercel api /v1/...` calls.

## 9. The shared link and how it is updated
The shared address is `https://freshroots-demand-planning-demo.vercel.app`. It follows the Git branch **`live`**: whatever is pushed to `live` is built by Vercel (as a preview, with the preview database and settings) and the address moves to it. Production stays empty and is not involved.

To publish an update: finish the work, merge it into `main`, run the checks, then

    git push origin main:live

To put the story back to the start (every decision waiting for Raghav): `npm run e2e:reset -- --host <preview database host>` and then `E2E_BASE_URL=https://freshroots-demand-planning-demo.vercel.app npm run demo:stage`.
