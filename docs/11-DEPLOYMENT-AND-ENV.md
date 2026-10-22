# 11: Deployment and Environment

## Stack (decided by the user's accounts; the rest is a recommendation)
| Part | Choice |
|---|---|
| Framework | Next.js (App Router) + TypeScript |
| Styling | Tailwind CSS, tokens from `08-UI-DESIGN-SYSTEM.md`; Inter via `next/font`; Lucide icons |
| Database | Neon Postgres (serverless driver) with Drizzle ORM (or Prisma) and migrations |
| AI | Google Gemini via the Google Gen AI SDK for TypeScript |
| Auth | Auth.js with email + password for the seeded users, role claim in the session |
| Hosting | Vercel (preview deployments per branch, production from `main`) |
| Scheduled job | Vercel Cron: daily Kill 2 check |
| Source control + CI | GitHub; Actions run lint, typecheck, test on every push and PR |
| Tests | Vitest + Playwright |
| Email | Behind an adapter; `console` provider in dev (see open questions for the real provider) |

## Environment variables (names only, never values)
| Variable | Used by | Notes |
|---|---|---|
| `DATABASE_URL` | app | Neon pooled connection string |
| `DATABASE_URL_UNPOOLED` | migrations | Neon direct connection |
| `GEMINI_API_KEY` | server only | Never exposed to the client |
| `GEMINI_MODEL` | server | Current model ID; verify in Google's docs before first use |
| `AUTH_SECRET` | app | Random 32+ bytes |
| `APP_URL` | app | Base URL for links in emails |
| `EMAIL_PROVIDER` | app | `console` in dev |
| `EMAIL_API_KEY`, `EMAIL_FROM` | app | Only when a real provider is chosen |
| `CRON_SECRET` | cron route | The cron endpoint rejects calls without it |
| `ZOHO_CLIENT_ID`, `ZOHO_CLIENT_SECRET`, `ZOHO_REFRESH_TOKEN`, `ZOHO_ORG_ID`, `ZOHO_DC` | later | Not used in the first release |

Create `.env.example` with these names and empty values. `.env.local` is in `.gitignore`.

## Accounts and tokens the user will provide
The user has said they will provide a Gemini paid API key, GitHub access, a Vercel token, a Neon API key, and Zoho later. Rules for handling them:
- **Never** ask the user to paste a key into the chat. Ask them to set it as an environment variable in their terminal, in `.env.local`, or in the Vercel/Neon dashboards, and confirm when done.
- **GitHub:** recommend a fine-grained token limited to this one repository (contents, pull requests, actions read/write). **Vercel:** a token scoped to this project/team. **Neon:** a project-scoped key. Tell the user to rotate or revoke tokens after the build.
- Dev tokens (GitHub, Vercel, Neon management keys) are used by tooling only. They never go into the app's runtime env, the repo, the logs, or the client bundle.
- Before the first commit, run a secret scan (for example `gitleaks` or a simple grep for key patterns) and add it to CI.
- Use separate Neon branches: one for dev/preview, one for production.

## Repository layout
```
/src
  /lib/rules        rule engine (pure functions, no I/O)
  /lib/validation   CSV parsing and validation
  /lib/ai           Gemini client, validator, fallback
  /lib/kill         kill-switch evaluation
  /lib/metrics      dashboard queries
  /lib/orders       OrderSink adapters
  /app              pages and API routes
/config/rules.json
/prompts/*.md
/seed/*.csv
/docs/*.md
/tests
```
Keep the rule engine and the kill logic pure (data in, result out) so the tests in `10-TEST-PLAN.md` run without a database.

## Zoho Inventory adapter (later)
Define now, implement later:
```ts
interface OrderSink {
  name: 'csv' | 'zoho';
  createDraftOrders(decisions: BuyingDecision[]): Promise<{ ref: string; results: Array<{ sku_id: string; ok: boolean; error?: string }> }>;
}
```
First release ships `CsvSink` only (export for procurement). `ZohoSink` must create **draft** purchase orders only (guardrail G-B3). Do not start it until the user provides Zoho credentials and says go.

## Deployment steps
1. Create the GitHub repo; push the scaffold with these docs.
2. Create the Neon project and branches; run migrations; load seed data.
3. Connect the repo to Vercel; set environment variables in Vercel (not in code).
4. Enable GitHub Actions CI.
5. Deploy a preview, run the Playwright end-to-end test against it with the mock AI, then switch to the real Gemini key.
6. Deploy production only after the user approves.

## Operations
- Health route `/api/health` (no secrets in output).
- Structured logs without personal data or secrets.
- Daily database backup is Neon's responsibility; export `audit_log`, `reviews`, and `kill_events` weekly to CSV for Priya.
