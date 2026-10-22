import { readFileSync } from "node:fs";
import path from "node:path";
import type { AiInput } from "./types";

export interface PromptBundle {
  /** e.g. "flag-decision/1.0.0". Stored on every decision (docs/04-AI-SPEC.md, prompt versioning). */
  version: string;
  system: string;
  userTemplate: string;
}

const VERSION_HEADER = /<!--\s*prompt_version:\s*([^\s>]+)\s*-->/;

function stripHeader(text: string): { version: string; body: string } {
  const m = VERSION_HEADER.exec(text);
  if (!m) throw new Error("Prompt file has no prompt_version header");
  return { version: m[1], body: text.replace(VERSION_HEADER, "").trim() };
}

export function loadPrompts(dir = path.resolve(process.cwd(), "prompts")): PromptBundle {
  const system = stripHeader(readFileSync(path.join(dir, "flag-decision.system.md"), "utf8"));
  const user = stripHeader(readFileSync(path.join(dir, "flag-decision.user.md"), "utf8"));
  if (system.version !== user.version) {
    throw new Error(`Prompt versions differ: system ${system.version}, user ${user.version}`);
  }
  return { version: system.version, system: system.body, userTemplate: user.body };
}

const RETRY_BLOCK = /\{\{#if RETRY_ERRORS\}\}([\s\S]*?)\{\{\/if\}\}/;

/**
 * Fills the user prompt. The retry block appears only when there are validation errors to feed back.
 * Product names reach the model only as data inside the JSON, and are inserted last so nothing in them
 * can be read as a template tag.
 */
export function renderUserPrompt(template: string, input: AiInput, retryErrors: string[]): string {
  const withRetry = template.replace(RETRY_BLOCK, (_all, inner: string) =>
    retryErrors.length === 0
      ? ""
      : inner.replace("{{RETRY_ERRORS}}", () => retryErrors.map((e) => `- ${e}`).join("\n")),
  );
  return withRetry.replace("{{INPUT_JSON}}", () => JSON.stringify(input, null, 2)).replace(/\n{3,}/g, "\n\n").trim();
}
