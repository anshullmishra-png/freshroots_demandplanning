import type { ZohoConfig } from "@/lib/zoho/client";

/** A stand-in for Zoho Inventory that answers the way the real API does. No test ever calls the real Zoho. */
export interface FakePo {
  purchaseorder_id: string;
  purchaseorder_number: string;
  vendor_id: string;
  reference_number: string;
  status: string;
  line_items: Array<{ item_id: string; quantity: number }>;
  notes: string;
  date: string;
  body: Record<string, unknown>;
}

export function fakeConfig(over: Partial<ZohoConfig> = {}): ZohoConfig {
  return { clientId: "client-1", clientSecret: "secret-1", refreshToken: "refresh-token-abcdef", orgId: "9001", dc: "in", ...over };
}

export function createFakeZoho(opts: { vendors?: string[]; items?: Array<{ sku: string; name: string }>; pageSize?: number; org?: string } = {}) {
  const org = opts.org ?? "9001";
  const pageSize = opts.pageSize ?? 200;
  const vendors = (opts.vendors ?? []).map((name, i) => ({ contact_id: `v${i + 1}`, contact_name: name, contact_type: "vendor" }));
  const items = (opts.items ?? []).map((it, i) => ({ item_id: `i${i + 1}`, name: it.name, sku: it.sku }));
  const pos = new Map<string, FakePo>();
  const state = { tokensIssued: 0, calls: [] as Array<{ method: string; url: string; auth: string | null; body: unknown }>, failNextWith: null as null | { status: number; json: unknown }, expireTokens: false };
  let poCounter = 0;
  let validToken = "";

  const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
  const page = <T,>(rows: T[], url: URL) => {
    const p = Number(url.searchParams.get("page") ?? 1);
    const slice = rows.slice((p - 1) * pageSize, p * pageSize);
    return { slice, page_context: { page: p, per_page: pageSize, has_more_page: p * pageSize < rows.length } };
  };

  const fetchImpl = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url);
    const method = (init?.method ?? "GET").toUpperCase();
    const headers = new Headers(init?.headers);
    const rawBody = init?.body;
    const body = typeof rawBody === "string" ? (headers.get("content-type")?.includes("json") ? JSON.parse(rawBody) : Object.fromEntries(new URLSearchParams(rawBody))) : rawBody instanceof URLSearchParams ? Object.fromEntries(rawBody) : null;
    state.calls.push({ method, url: url.toString(), auth: headers.get("authorization"), body });

    if (url.hostname.startsWith("accounts.zoho.")) {
      const b = body as Record<string, string>;
      if (b.client_secret !== "secret-1" || b.refresh_token !== "refresh-token-abcdef") return json(400, { error: "invalid_client" });
      state.tokensIssued++;
      validToken = `tok-${state.tokensIssued}`;
      return json(200, { access_token: validToken, expires_in: 3600, api_domain: "https://www.zohoapis.in" });
    }

    if (state.failNextWith) {
      const f = state.failNextWith;
      state.failNextWith = null;
      return json(f.status, f.json);
    }
    if (state.expireTokens || headers.get("authorization") !== `Zoho-oauthtoken ${validToken}`) {
      state.expireTokens = false;
      return json(401, { code: 57, message: "You are not authorized to perform this operation" });
    }
    if (url.searchParams.get("organization_id") !== org) return json(400, { code: 6, message: "Invalid value passed for organization_id" });

    const path = url.pathname.replace("/inventory/v1", "");
    if (method === "GET" && path === "/organizations") return json(200, { code: 0, organizations: [{ organization_id: org, name: "Freshroots Test Org" }] });
    if (method === "GET" && path === "/contacts") {
      const { slice, page_context } = page(vendors, url);
      return json(200, { code: 0, contacts: slice, page_context });
    }
    if (method === "GET" && path === "/items") {
      const { slice, page_context } = page(items, url);
      return json(200, { code: 0, items: slice, page_context });
    }
    if (method === "POST" && path === "/contacts") {
      const b = body as { contact_name: string };
      const c = { contact_id: `v${vendors.length + 1}`, contact_name: b.contact_name, contact_type: "vendor" };
      vendors.push(c);
      return json(201, { code: 0, message: "success", contact: c });
    }
    if (method === "POST" && path === "/items") {
      const b = body as { name: string; sku: string };
      const i = { item_id: `i${items.length + 1}`, name: b.name, sku: b.sku };
      items.push(i);
      return json(201, { code: 0, message: "success", item: i });
    }
    if (method === "GET" && path === "/purchaseorders") {
      const ref = url.searchParams.get("reference_number");
      const rows = [...pos.values()].filter((p) => !ref || p.reference_number === ref);
      const { slice, page_context } = page(rows, url);
      return json(200, { code: 0, purchaseorders: slice, page_context });
    }
    if (method === "POST" && path === "/purchaseorders") {
      const b = body as Record<string, unknown> & { vendor_id: string; reference_number: string; line_items: FakePo["line_items"]; notes: string; date: string };
      if (!vendors.some((v) => v.contact_id === b.vendor_id)) return json(400, { code: 1002, message: "Vendor does not exist." });
      poCounter++;
      const po: FakePo = {
        purchaseorder_id: `po-id-${poCounter}`,
        purchaseorder_number: `PO-${String(poCounter).padStart(5, "0")}`,
        vendor_id: b.vendor_id,
        reference_number: b.reference_number,
        status: "draft",
        line_items: b.line_items,
        notes: b.notes,
        date: b.date,
        body: b,
      };
      pos.set(po.purchaseorder_id, po);
      return json(201, { code: 0, message: "The purchase order has been created.", purchase_order: po });
    }
    const m = /^\/purchaseorders\/([^/]+)$/.exec(path);
    if (method === "GET" && m) {
      const po = pos.get(decodeURIComponent(m[1]));
      return po ? json(200, { code: 0, purchase_order: po }) : json(404, { code: 1002, message: "Purchase order does not exist." });
    }
    return json(404, { code: 5, message: "Invalid URL" });
  }) as typeof fetch;

  return { fetch: fetchImpl, state, vendors, items, pos, issue: (id: string) => (pos.get(id)!.status = "issued"), setStatus: (id: string, s: string) => (pos.get(id)!.status = s), remove: (id: string) => pos.delete(id) };
}

export const SEED_VENDORS = ["NutriFlow Distributors", "GrainPath Logistics", "PeakSource Supply", "CoastalFresh Traders"];
