# Freshroots Demand Planning: build pack for Claude Code

Start with `START-PROMPT.md`. `CLAUDE.md` is the entry point Claude Code reads.

| File | Purpose |
|---|---|
| `CLAUDE.md` | Master instructions, working rules, definition of done |
| `START-PROMPT.md` | First message to paste into Claude Code |
| `docs/00-PROJECT-BRIEF.md` | Case, outcome, baseline, pre-build decisions |
| `docs/01-COMPONENT-MAP.md` | Approved component map (workflow source of truth) |
| `docs/02-BUSINESS-RULES.md` | Raghav's five rules, exact definitions, worked example |
| `docs/03-DATA-SPEC.md` | Seed data, validation rules, database schema |
| `docs/04-AI-SPEC.md` | Gemini step, output schema, validator, fallback |
| `docs/05-GUARDRAILS.md` | Everything that must always or never happen |
| `docs/06-KILL-SWITCHES.md` | Kill 1 and Kill 2, exact logic |
| `docs/07-WORKFLOW-AND-SCREENS.md` | Roles, flow, screens |
| `docs/08-UI-DESIGN-SYSTEM.md` | Sapphire / gold / ivory design tokens and components |
| `docs/09-MEASUREMENT-PLAN.md` | Metrics, baselines, review rhythm |
| `docs/10-TEST-PLAN.md` | Golden and boundary tests |
| `docs/11-DEPLOYMENT-AND-ENV.md` | Stack, env var names, secrets handling, Zoho adapter |
| `docs/12-OPEN-QUESTIONS.md` | Unsettled decisions and the defaults to use |
| `docs/13-BUILD-PLAN.md` | Phases with acceptance criteria |
| `prompts/flag-decision.system.md` | Gemini system prompt |
| `prompts/flag-decision.user.md` | Gemini user prompt template |
| `config/rules.json` | Every threshold in one file |
| `seed/*.csv` | Your five seed files, unchanged |

No API keys are in this pack. Set them as environment variables when Claude Code asks.
