import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const root = path.resolve(__dirname, "../../src");
const files = (dir: string): string[] =>
  readdirSync(dir).flatMap((f) => {
    const p = path.join(dir, f);
    return statSync(p).isDirectory() ? files(p) : [p];
  });
const sourceFiles = files(root).filter((f) => /\.tsx$/.test(f));

describe("forms never put sensitive values in the URL", () => {
  it("the sign-in form posts, and its fields have no name attribute (a submit before hydration sends nothing)", () => {
    const text = readFileSync(path.join(root, "components/LoginForm.tsx"), "utf8");
    expect(text).toMatch(/<form[^>]*method="post"/);
    expect(text).not.toMatch(/<input[^>]*\sname=/);
    expect(text).not.toMatch(/FormData\(/);
  });

  it("no form in the app can fall back to a GET submission", () => {
    for (const f of sourceFiles) {
      const text = readFileSync(f, "utf8");
      for (const tag of text.match(/<form\b[^>]*>/g) ?? []) {
        expect(tag, `${path.relative(root, f)}: ${tag}`).toMatch(/method="post"/);
      }
    }
  });

  it("nothing builds a URL from a password or token", () => {
    for (const f of sourceFiles) {
      const text = readFileSync(f, "utf8");
      expect(text, path.relative(root, f)).not.toMatch(/[?&](password|token|secret|key)=/i);
    }
  });
});
