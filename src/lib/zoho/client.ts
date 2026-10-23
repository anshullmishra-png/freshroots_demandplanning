// The only file that talks to Zoho and the only one that reads the ZOHO_* settings (a test pins this). Server only:
// the browser never imports it, so the client secret and refresh token cannot reach a page.

export const ZOHO_DATA_CENTRES = ["in", "com", "eu", "com.au", "jp", "ca", "sa", "com.cn"] as const;
export type ZohoDataCentre = (typeof ZOHO_DATA_CENTRES)[number];

export interface ZohoConfig {
  clientId: string;
  clientSecret: string;
  refreshToken: string;
  orgId: string;
  dc: ZohoDataCentre;
}

type Env = Record<string, string | undefined>;

/** The settings, or null when any is missing (Zoho is then simply "not connected"). */
export function zohoConfigFromEnv(env: Env = process.env): ZohoConfig | null {
  const clientId = env.ZOHO_CLIENT_ID?.trim();
  const clientSecret = env.ZOHO_CLIENT_SECRET?.trim();
  const refreshToken = env.ZOHO_REFRESH_TOKEN?.trim();
  const orgId = env.ZOHO_ORG_ID?.trim();
  const dc = (env.ZOHO_DC?.trim() || "in") as ZohoDataCentre;
  if (!clientId || !clientSecret || !refreshToken || !orgId) return null;
  if (!(ZOHO_DATA_CENTRES as readonly string[]).includes(dc)) return null;
  return { clientId, clientSecret, refreshToken, orgId, dc };
}

export const zohoConnected = (env: Env = process.env): boolean => zohoConfigFromEnv(env) !== null;

/** Where a person opens an order in Zoho's own screens. */
export const zohoAppUrl = (cfg: Pick<ZohoConfig, "dc" | "orgId">, purchaseOrderId: string) =>
  `https://inventory.zoho.${cfg.dc}/app/${cfg.orgId}#/purchaseorders/${purchaseOrderId}`;

/** A problem talking to Zoho, in words that are safe to show: never a token, a secret or a request body. */
export class ZohoError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "ZohoError";
  }
}

export interface ZohoVendor {
  id: string;
  name: string;
}
export interface ZohoItem {
  id: string;
  name: string;
  sku: string;
}
export interface ZohoPurchaseOrder {
  id: string;
  number: string;
  /** Zoho's own word: "draft", "issued", "cancelled", "received" and so on, lower case. */
  status: string;
  reference: string | null;
  vendorId: string;
}
export interface ZohoLine {
  itemId: string;
  quantity: number;
}

export interface ZohoClient {
  readonly config: Pick<ZohoConfig, "dc" | "orgId">;
  organization(): Promise<{ id: string; name: string }>;
  listVendors(): Promise<ZohoVendor[]>;
  listItems(): Promise<ZohoItem[]>;
  createVendor(name: string): Promise<ZohoVendor>;
  createItem(input: { sku: string; name: string; unit: string }): Promise<ZohoItem>;
  findPurchaseOrderByReference(reference: string): Promise<ZohoPurchaseOrder | null>;
  createPurchaseOrder(input: { vendorId: string; reference: string; date: string; notes: string; lines: ZohoLine[] }): Promise<ZohoPurchaseOrder>;
  getPurchaseOrder(id: string): Promise<ZohoPurchaseOrder | null>;
}

type Json = Record<string, unknown>;
const str = (v: unknown): string => (v === null || v === undefined ? "" : String(v));

const tokens = new Map<string, { token: string; expiresAt: number }>();
/** For tests: forget cached access tokens. */
export const forgetZohoTokens = () => tokens.clear();

const MAX_PAGES = 25;

export function createZohoClient(cfg: ZohoConfig, opts: { fetch?: typeof fetch; now?: () => number } = {}): ZohoClient {
  const doFetch = opts.fetch ?? fetch;
  const now = opts.now ?? Date.now;
  const api = `https://www.zohoapis.${cfg.dc}/inventory/v1`;
  const cacheKey = `${cfg.dc}:${cfg.clientId}:${cfg.refreshToken.slice(-6)}`;

  async function accessToken(force = false): Promise<string> {
    const cached = tokens.get(cacheKey);
    if (!force && cached && cached.expiresAt - 60_000 > now()) return cached.token;
    const res = await doFetch(`https://accounts.zoho.${cfg.dc}/oauth/v2/token`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ grant_type: "refresh_token", client_id: cfg.clientId, client_secret: cfg.clientSecret, refresh_token: cfg.refreshToken }),
    });
    const body = (await res.json().catch(() => ({}))) as Json;
    if (!res.ok || typeof body.access_token !== "string") {
      // Zoho's own error word (for example "invalid_client") is safe; nothing we sent is repeated.
      const why = str(body.error) || String(res.status);
      // Zoho answers "Access Denied" both for wrong settings and when tokens are asked for too fast (about 10 in 10 minutes).
      const hint = /access denied/i.test(why) ? " If the settings are right, Zoho may be limiting how fast tokens are issued: wait 10 minutes." : "";
      throw new ZohoError(res.status || 502, "ZOHO_AUTH", `Zoho refused the connection (${why}). Check the Zoho settings.${hint}`);
    }
    tokens.set(cacheKey, { token: body.access_token, expiresAt: now() + Number(body.expires_in ?? 3600) * 1000 });
    return body.access_token;
  }

  async function request(method: "GET" | "POST", path: string, o: { query?: Record<string, string | number>; body?: unknown } = {}, retried = false): Promise<Json> {
    const url = new URL(`${api}${path}`);
    url.searchParams.set("organization_id", cfg.orgId);
    for (const [k, v] of Object.entries(o.query ?? {})) url.searchParams.set(k, String(v));
    const res = await doFetch(url, {
      method,
      headers: { authorization: `Zoho-oauthtoken ${await accessToken(retried)}`, ...(o.body === undefined ? {} : { "content-type": "application/json" }) },
      body: o.body === undefined ? undefined : JSON.stringify(o.body),
    });
    if (res.status === 401 && !retried) return request(method, path, o, true);
    const json = (await res.json().catch(() => ({}))) as Json;
    if (res.status === 429) throw new ZohoError(429, "ZOHO_RATE_LIMIT", "Zoho is limiting requests right now. Wait a minute and try again.");
    if (!res.ok || (typeof json.code === "number" && json.code !== 0)) {
      throw new ZohoError(res.status, "ZOHO_REQUEST", `Zoho said: ${str(json.message) || `error ${res.status}`}`);
    }
    return json;
  }

  async function listAll(path: string, key: string, query: Record<string, string | number> = {}): Promise<Json[]> {
    const out: Json[] = [];
    for (let page = 1; page <= MAX_PAGES; page++) {
      const json = await request("GET", path, { query: { ...query, page, per_page: 200 } });
      out.push(...((json[key] as Json[] | undefined) ?? []));
      if (!(json.page_context as Json | undefined)?.has_more_page) break;
    }
    return out;
  }

  const toPo = (p: Json): ZohoPurchaseOrder => ({
    id: str(p.purchaseorder_id),
    number: str(p.purchaseorder_number),
    status: str(p.status).toLowerCase(),
    reference: p.reference_number ? str(p.reference_number) : null,
    vendorId: str(p.vendor_id),
  });

  return {
    config: { dc: cfg.dc, orgId: cfg.orgId },

    async organization() {
      const json = await request("GET", "/organizations");
      const orgs = (json.organizations as Json[] | undefined) ?? [];
      const mine = orgs.find((o) => str(o.organization_id) === cfg.orgId) ?? orgs[0];
      if (!mine) throw new ZohoError(404, "ZOHO_NO_ORG", "Zoho has no organisation for these settings.");
      return { id: str(mine.organization_id), name: str(mine.name) };
    },

    async listVendors() {
      const rows = await listAll("/contacts", "contacts", { contact_type: "vendor" });
      return rows.map((c) => ({ id: str(c.contact_id), name: str(c.contact_name) }));
    },

    async listItems() {
      const rows = await listAll("/items", "items");
      return rows.map((i) => ({ id: str(i.item_id), name: str(i.name), sku: str(i.sku) }));
    },

    async createVendor(name) {
      const json = await request("POST", "/contacts", { body: { contact_name: name, contact_type: "vendor" } });
      const c = (json.contact ?? {}) as Json;
      return { id: str(c.contact_id), name: str(c.contact_name) || name };
    },

    async createItem({ sku, name, unit }) {
      // No price is sent: the buying price is procurement's to set in Zoho.
      const json = await request("POST", "/items", { body: { name, sku, unit, item_type: "inventory", product_type: "goods" } });
      const i = (json.item ?? {}) as Json;
      return { id: str(i.item_id), name: str(i.name) || name, sku: str(i.sku) || sku };
    },

    async findPurchaseOrderByReference(reference) {
      const rows = await listAll("/purchaseorders", "purchaseorders", { reference_number: reference });
      const hit = rows.map(toPo).find((p) => p.reference === reference);
      return hit ?? null;
    },

    async createPurchaseOrder({ vendorId, reference, date, notes, lines }) {
      // No `status` is sent and none can be: Zoho creates the order as a draft. Issuing it is a person's step in Zoho.
      const json = await request("POST", "/purchaseorders", {
        body: {
          vendor_id: vendorId,
          reference_number: reference,
          date,
          notes,
          line_items: lines.map((l) => ({ item_id: l.itemId, quantity: l.quantity })),
        },
      });
      const made = toPo(((json.purchase_order ?? json.purchaseorder) ?? {}) as Json);
      if (!made.id) throw new ZohoError(502, "ZOHO_UNEXPECTED", "Zoho answered but did not say which order it made. Check Zoho before sending again.");
      return made;
    },

    async getPurchaseOrder(id) {
      try {
        const json = await request("GET", `/purchaseorders/${encodeURIComponent(id)}`);
        return toPo(((json.purchase_order ?? json.purchaseorder) ?? {}) as Json);
      } catch (e) {
        if (e instanceof ZohoError && e.status === 404) return null;
        throw e;
      }
    },
  };
}

/** A client for the settings in the environment, or null when Zoho is not connected. */
export function zohoClientFromEnv(env: Env = process.env): ZohoClient | null {
  const cfg = zohoConfigFromEnv(env);
  return cfg ? createZohoClient(cfg) : null;
}
