import { describe, expect, it } from "vitest";
import { continueUntilDone } from "@/lib/continue-client";

const reply = (body: unknown, status = 200) => async () => new Response(JSON.stringify(body), { status });

describe("continueUntilDone", () => {
  it("keeps asking until nothing remains, and reports each step", async () => {
    const remaining = [5, 2, 0];
    const seen: number[] = [];
    let calls = 0;
    const fetcher = (async (url: string, init: RequestInit) => {
      expect(url).toBe("/api/runs/7/continue");
      expect(init.method).toBe("POST");
      return new Response(JSON.stringify({ runId: 7, flagCount: 9, remaining: remaining[calls++], status: "flagged" }));
    }) as unknown as typeof fetch;
    const final = await continueUntilDone(7, (s) => seen.push(s.flagCount - s.remaining), fetcher);
    expect(calls).toBe(3);
    expect(seen).toEqual([4, 7, 9]);
    expect(final.remaining).toBe(0);
  });

  it("stops at the first error and shows the server's message", async () => {
    const fetcher = reply({ error: { code: "AUTOMATION_STOPPED", message: "Automation is stopped." } }, 409) as unknown as typeof fetch;
    await expect(continueUntilDone(1, () => {}, fetcher)).rejects.toThrow("Automation is stopped.");
  });

  it("gives up rather than loop forever when nothing ever finishes", async () => {
    let calls = 0;
    const fetcher = (async () => {
      calls++;
      return new Response(JSON.stringify({ runId: 1, flagCount: 3, remaining: 3, status: "flagged" }));
    }) as unknown as typeof fetch;
    await expect(continueUntilDone(1, () => {}, fetcher)).rejects.toThrow(/longer than expected/);
    expect(calls).toBe(20);
  });
});
