import { describe, expect, it, vi } from "vitest";
import { errorResponse } from "@/lib/api/http";
import { badRequest, forbidden } from "@/lib/errors";

describe("errorResponse", () => {
  it("turns an application error into its status and a stable body", async () => {
    const res = errorResponse(forbidden("No."));
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: { code: "FORBIDDEN", message: "No." } });
    const bad = errorResponse(badRequest("X", "Bad", [1]));
    expect(bad.status).toBe(400);
    expect((await bad.json()).error.details).toEqual([1]);
  });

  it("turns an unexpected error into a plain 500 that leaks nothing", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const res = errorResponse(new Error("connection to the database host failed"));
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: { code: "INTERNAL", message: "Something went wrong." } });
    expect(spy).toHaveBeenCalledTimes(1);
    spy.mockRestore();
  });

  it("lets framework control-flow signals through instead of hiding them as a 500", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const dynamic = Object.assign(new Error("Route needs to bail out of prerendering"), { digest: "DYNAMIC_SERVER_USAGE" });
    const redirect = Object.assign(new Error("NEXT_REDIRECT"), { digest: "NEXT_REDIRECT;replace;/login;307;" });
    const postpone = Object.assign(new Error("postponed"), { $$typeof: Symbol.for("react.postpone") });
    for (const signal of [dynamic, redirect, postpone]) expect(() => errorResponse(signal)).toThrow(signal);
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });
});
