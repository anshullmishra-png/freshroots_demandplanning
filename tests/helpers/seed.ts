import { readFileSync } from "node:fs";
import path from "node:path";
import { loadRules, type RulesConfig } from "@/lib/config/rules";
import { validateUpload } from "@/lib/validation/validate";
import { FILE_KEYS, FILE_NAMES, type FileKey, type UploadFiles, type ValidationResult } from "@/lib/validation/types";

/** Seed data is as of 2026-10-19; "today" in tests is the same day unless a test says otherwise. */
export const NOW = new Date("2026-10-19T12:00:00+05:30");

export function seedFiles(): Record<FileKey, string> {
  const files = {} as Record<FileKey, string>;
  for (const key of FILE_KEYS) {
    files[key] = readFileSync(path.resolve(__dirname, "../../seed", FILE_NAMES[key]), "utf8");
  }
  return files;
}

export function validate(
  files: UploadFiles,
  opts: { now?: Date; rules?: RulesConfig } = {},
): ValidationResult {
  return validateUpload(files, { rules: opts.rules ?? loadRules(), now: opts.now ?? NOW });
}

/** Replace text that must exist, so a test can never silently edit nothing. */
export function replaceOnce(text: string, from: string, to: string): string {
  if (!text.includes(from)) throw new Error(`test fixture: "${from}" not found`);
  return text.replace(from, to);
}

export function removeLines(text: string, predicate: (line: string) => boolean): string {
  const lines = text.split(/\r?\n/);
  const kept = lines.filter((l) => !predicate(l));
  if (kept.length === lines.length) throw new Error("test fixture: no line matched");
  return kept.join("\r\n");
}

export function appendLine(text: string, line: string): string {
  return text.replace(/\s*$/, "") + `\r\n${line}\r\n`;
}

export function codes(result: ValidationResult, level: "errors" | "warnings" = "errors"): string[] {
  return result[level].map((i) => i.code);
}

export function withRules(patch: (r: RulesConfig) => void): RulesConfig {
  const rules = structuredClone(loadRules());
  patch(rules);
  return rules;
}
