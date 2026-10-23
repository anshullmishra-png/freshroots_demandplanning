// What a deployment needs in its environment, checked without ever returning a value. Used by the deep health
// check and by the guard that keeps test settings out of production.
import { GEMINI_KEY_VAR, geminiKeyIsSet } from "@/lib/ai/gemini";

type Env = Record<string, string | undefined>;

export interface EnvReport {
  /** "production", "preview", "development" (Vercel's VERCEL_ENV), or "local" when not on Vercel. */
  environment: string;
  production: boolean;
  /** True/false per variable: is it set (and long enough where that matters). Never the value. */
  present: Record<string, boolean>;
  aiMode: "gemini" | "mock";
  emailProvider: string;
  /** Things that make this deployment unfit to run. */
  problems: string[];
  /** Things that work but that Raghav should know about. */
  warnings: string[];
}

export const MOCK_AI_IN_PRODUCTION =
  "AI_CLIENT=mock is set on a production deployment. The mock repeats the rule engine and is for tests only. Remove AI_CLIENT.";

export function isProduction(env: Env = process.env): boolean {
  return env.VERCEL_ENV === "production";
}

export function checkEnvironment(env: Env = process.env): EnvReport {
  const production = isProduction(env);
  const aiMode = env.AI_CLIENT === "mock" ? "mock" : "gemini";
  const emailProvider = env.EMAIL_PROVIDER ?? "console";
  const long = (name: string, min: number) => (env[name] ?? "").length >= min;
  const present: Record<string, boolean> = {
    DATABASE_URL: !!env.DATABASE_URL,
    AUTH_SECRET: long("AUTH_SECRET", 32),
    CRON_SECRET: long("CRON_SECRET", 16),
    APP_URL: !!env.APP_URL,
    [GEMINI_KEY_VAR]: geminiKeyIsSet(env),
    GEMINI_MODEL: !!env.GEMINI_MODEL,
  };

  const problems: string[] = [];
  const warnings: string[] = [];
  if (!present.DATABASE_URL) problems.push("DATABASE_URL is not set.");
  if (!present.AUTH_SECRET) problems.push("AUTH_SECRET is missing or shorter than 32 characters.");
  if (!present.CRON_SECRET) problems.push("CRON_SECRET is missing or shorter than 16 characters: the daily kill check cannot run.");
  if (aiMode === "gemini") {
    if (!present[GEMINI_KEY_VAR]) problems.push(`${GEMINI_KEY_VAR} is not set.`);
    if (!present.GEMINI_MODEL) problems.push("GEMINI_MODEL is not set.");
  }
  if (production) {
    if (aiMode === "mock") problems.push(MOCK_AI_IN_PRODUCTION);
    // Ignored by the code on production, but a leftover setting means the wrong environment was copied.
    if (env.DEMO_OPEN_ACCESS) problems.push("DEMO_OPEN_ACCESS is set on a production deployment. It is for a throwaway preview only. Remove it.");
    if (!/^https:\/\//.test(env.APP_URL ?? "")) problems.push("APP_URL must be the https address people use, because alert emails link to it.");
    if (emailProvider === "console") warnings.push("EMAIL_PROVIDER is console: alert and kill emails are only written to the log and reach nobody.");
  }
  return { environment: env.VERCEL_ENV ?? "local", production, present, aiMode, emailProvider, problems, warnings };
}
