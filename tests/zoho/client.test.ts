import { beforeEach, describe, expect, it } from "vitest";
import { ZohoError, createZohoClient, forgetZohoTokens, zohoAppUrl, zohoConfigFromEnv } from "@/lib/zoho/client";
import { createFakeZoho, fakeConfig } from "../helpers/fakeZoho";

beforeEach(() => forgetZohoTokens());

describe("the Zoho settings", () => {
  const all = { ZOHO_CLIENT_ID: "id", ZOHO_CLIENT_SECRET: "secret", ZOHO_REFRESH_TOKEN: "refresh", ZOHO_ORG_ID: "123", ZOHO_DC: "in" };

  it("are read from the environment, defaulting to India", () => {
    expect(zohoConfigFromEnv(all)).toEqual({ clientId: "id", clientSecret: "secret", refreshToken: "refresh", orgId: "123", dc: "in" });
    expect(zohoConfigFromEnv({ ...all, ZOHO_DC: undefined })?.dc).toBe("in");
    expect(zohoConfigFromEnv({ ...all, ZOHO_DC: "com" })?.dc).toBe("com");
  });

  it.each(["ZOHO_CLIENT_ID", "ZOHO_CLIENT_SECRET", "ZOHO_REFRESH_TOKEN", "ZOHO_ORG_ID"])("with %s missing, Zoho is simply not connected", (name) => {
    expect(zohoConfigFromEnv({ ...all, [name]: undefined })).toBeNull();
    expect(zohoConfigFromEnv({ ...all, [name]: "  " })).toBeNull();
  });

  it("an unknown data centre is not connected rather than a guessed address", () => {
    expect(zohoConfigFromEnv({ ...all, ZOHO_DC: "evil.example" })).toBeNull();
  });

  it("builds the link to an order in Zoho's own screens", () => {
    expect(zohoAppUrl({ dc: "in", orgId: "123" }, "55")).toBe("https://inventory.zoho.in/app/123#/purchaseorders/55");
  });
});

describe("talking to Zoho", () => {
  it("gets an access token from the refresh token, sends it as Zoho-oauthtoken, and reuses it", async () => {
    const zoho = createFakeZoho({ vendors: ["A"] });
    const c = createZohoClient(fakeConfig(), { fetch: zoho.fetch });
    await c.listVendors();
    await c.listVendors();
    expect(zoho.state.tokensIssued).toBe(1);
    const api = zoho.state.calls.filter((x) => x.url.includes("/inventory/v1"));
    expect(api.every((x) => x.auth === "Zoho-oauthtoken tok-1")).toBe(true);
    const tokenCall = zoho.state.calls.find((x) => x.url.includes("/oauth/v2/token"))!;
    expect(tokenCall.url).toContain("accounts.zoho.in");
    expect(tokenCall.body).toMatchObject({ grant_type: "refresh_token", client_id: "client-1" });
  });

  it("asks for a new token when the old one has expired", async () => {
    let t = 1_000_000;
    const zoho = createFakeZoho({ vendors: ["A"] });
    const c = createZohoClient(fakeConfig(), { fetch: zoho.fetch, now: () => t });
    await c.listVendors();
    t += 3_600_000;
    await c.listVendors();
    expect(zoho.state.tokensIssued).toBe(2);
  });

  it("recovers from one rejected token by refreshing and trying again", async () => {
    const zoho = createFakeZoho({ vendors: ["A"] });
    const c = createZohoClient(fakeConfig(), { fetch: zoho.fetch });
    await c.listVendors();
    zoho.state.expireTokens = true;
    await expect(c.listVendors()).resolves.toHaveLength(1);
    expect(zoho.state.tokensIssued).toBe(2);
  });

  it("every request carries the organisation, and the India address is used", async () => {
    const zoho = createFakeZoho({ vendors: ["A"] });
    await createZohoClient(fakeConfig(), { fetch: zoho.fetch }).listVendors();
    const call = zoho.state.calls.find((x) => x.url.includes("/contacts"))!;
    expect(call.url).toContain("https://www.zohoapis.in/inventory/v1/contacts");
    expect(call.url).toContain("organization_id=9001");
  });

  it("reads every page of a long list", async () => {
    const zoho = createFakeZoho({ vendors: ["A", "B", "C", "D", "E"], pageSize: 2 });
    const vendors = await createZohoClient(fakeConfig(), { fetch: zoho.fetch }).listVendors();
    expect(vendors.map((v) => v.name)).toEqual(["A", "B", "C", "D", "E"]);
  });

  it("bad credentials are a clear error that never repeats the secret or the token", async () => {
    const zoho = createFakeZoho();
    const c = createZohoClient(fakeConfig({ clientSecret: "wrong-secret-xyz" }), { fetch: zoho.fetch });
    const err = await c.listVendors().catch((e) => e);
    expect(err).toBeInstanceOf(ZohoError);
    expect(err.code).toBe("ZOHO_AUTH");
    expect(err.message).toMatch(/invalid_client/);
    for (const secret of ["wrong-secret-xyz", "refresh-token-abcdef", "client-1"]) expect(err.message).not.toContain(secret);
  });

  it("'Access Denied' from the token service comes with the hint about asking for tokens too fast", async () => {
    const zoho = createFakeZoho();
    const real = zoho.fetch;
    const denied = (async (input: string | URL | Request, init?: RequestInit) =>
      String(input).includes("oauth") ? new Response(JSON.stringify({ error: "Access Denied" }), { status: 200 }) : real(input, init)) as typeof fetch;
    const err = await createZohoClient(fakeConfig(), { fetch: denied }).listVendors().catch((e) => e);
    expect(err.code).toBe("ZOHO_AUTH");
    expect(err.message).toMatch(/Access Denied/);
    expect(err.message).toMatch(/wait 10 minutes/);
  });

  it("a rate limit is reported as such", async () => {
    const zoho = createFakeZoho({ vendors: ["A"] });
    const c = createZohoClient(fakeConfig(), { fetch: zoho.fetch });
    await c.listVendors();
    zoho.state.failNextWith = { status: 429, json: { code: 44, message: "too many" } };
    await expect(c.listVendors()).rejects.toMatchObject({ code: "ZOHO_RATE_LIMIT", status: 429 });
  });

  it("an error from Zoho comes back in Zoho's words", async () => {
    const zoho = createFakeZoho({ vendors: ["A"] });
    const c = createZohoClient(fakeConfig(), { fetch: zoho.fetch });
    await expect(c.createPurchaseOrder({ vendorId: "nope", reference: "R", date: "2026-10-23", notes: "", lines: [{ itemId: "i1", quantity: 1 }] })).rejects.toThrow(/Vendor does not exist/);
  });

  it("creates a purchase order with only vendor, reference, date, notes and lines: no status, no price", async () => {
    const zoho = createFakeZoho({ vendors: ["A"], items: [{ sku: "SKU001", name: "Mango" }] });
    const po = await createZohoClient(fakeConfig(), { fetch: zoho.fetch }).createPurchaseOrder({
      vendorId: "v1",
      reference: "FR-1",
      date: "2026-10-23",
      notes: "n",
      lines: [{ itemId: "i1", quantity: 750 }],
    });
    expect(po).toMatchObject({ number: "PO-00001", status: "draft", reference: "FR-1", vendorId: "v1" });
    const sent = zoho.state.calls.find((x) => x.method === "POST" && x.url.includes("/purchaseorders"))!.body as Record<string, unknown>;
    expect(Object.keys(sent).sort()).toEqual(["date", "line_items", "notes", "reference_number", "vendor_id"]);
    expect(sent.line_items).toEqual([{ item_id: "i1", quantity: 750 }]);
  });

  it("finds an order by its reference, and says null when there is none", async () => {
    const zoho = createFakeZoho({ vendors: ["A"], items: [{ sku: "S", name: "S" }] });
    const c = createZohoClient(fakeConfig(), { fetch: zoho.fetch });
    expect(await c.findPurchaseOrderByReference("FR-1")).toBeNull();
    await c.createPurchaseOrder({ vendorId: "v1", reference: "FR-1", date: "d", notes: "", lines: [{ itemId: "i1", quantity: 1 }] });
    expect(await c.findPurchaseOrderByReference("FR-1")).toMatchObject({ number: "PO-00001" });
    expect(await c.findPurchaseOrderByReference("FR-2")).toBeNull();
  });

  it("reads an order's status in lower case, and null for one that no longer exists", async () => {
    const zoho = createFakeZoho({ vendors: ["A"], items: [{ sku: "S", name: "S" }] });
    const c = createZohoClient(fakeConfig(), { fetch: zoho.fetch });
    const po = await c.createPurchaseOrder({ vendorId: "v1", reference: "FR-1", date: "d", notes: "", lines: [{ itemId: "i1", quantity: 1 }] });
    expect((await c.getPurchaseOrder(po.id))?.status).toBe("draft");
    zoho.issue(po.id);
    expect((await c.getPurchaseOrder(po.id))?.status).toBe("issued");
    zoho.remove(po.id);
    expect(await c.getPurchaseOrder(po.id)).toBeNull();
  });

  it("names the organisation", async () => {
    const zoho = createFakeZoho();
    expect(await createZohoClient(fakeConfig(), { fetch: zoho.fetch }).organization()).toEqual({ id: "9001", name: "Freshroots Test Org" });
  });
});
