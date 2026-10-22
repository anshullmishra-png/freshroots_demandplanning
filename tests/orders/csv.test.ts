import { describe, expect, it } from "vitest";
import { csvCell, toCsv } from "@/lib/orders/csv";
import { CsvSink, ORDER_CSV_HEADER, type BuyingDecision } from "@/lib/orders/sink";
import { parseCsv } from "@/lib/validation/csv";

describe("csvCell", () => {
  it("writes numbers and empty values plainly", () => {
    expect(csvCell(750)).toBe("750");
    expect(csvCell(0)).toBe("0");
    expect(csvCell(null)).toBe("");
    expect(csvCell(undefined)).toBe("");
    expect(csvCell(Number.NaN)).toBe("");
    expect(csvCell("Freshroots Mango Drink 200ml")).toBe("Freshroots Mango Drink 200ml");
  });

  it("quotes cells with commas, quotes or line breaks", () => {
    expect(csvCell("a,b")).toBe('"a,b"');
    expect(csvCell('say "hi"')).toBe('"say ""hi"""');
    expect(csvCell("line1\nline2")).toBe('"line1\nline2"');
    expect(csvCell("line1\r\nline2")).toBe('"line1\r\nline2"');
  });

  describe("formula injection (G-S7)", () => {
    it.each([
      ["=1+1", "'=1+1"],
      ["+44 20 7946 0000", "'+44 20 7946 0000"],
      ["-2+3", "'-2+3"],
      ["@SUM(A1:A9)", "'@SUM(A1:A9)"],
      ["\t=1+1", "'\t=1+1"],
      ["=cmd|' /C calc'!A0", "'=cmd|' /C calc'!A0"],
    ])("writes %j as text", (input, expected) => {
      expect(csvCell(input)).toBe(expected);
    });

    it("writes a formula that also needs quoting as quoted text", () => {
      expect(csvCell('=HYPERLINK("http://evil.example","click")')).toBe('"\'=HYPERLINK(""http://evil.example"",""click"")"');
      expect(csvCell("\r=1+1")).toBe("\"'\r=1+1\"");
    });

    it("leaves safe text and numbers alone", () => {
      expect(csvCell("Order PO-1234")).toBe("Order PO-1234");
      expect(csvCell("a=b")).toBe("a=b"); // only a leading character matters
      expect(csvCell(" =1+1")).toBe(" =1+1"); // a leading space already makes it text
      expect(csvCell("'already text")).toBe("'already text");
      expect(csvCell(-5)).toBe("-5"); // a real number is not text
    });

    it("no parsed cell of an exported file starts with a formula character", () => {
      const evil = ["=1+1", "+1", "-1", "@x", "\tx", "\rx", '=HYPERLINK("u","t")', "=A1,=B1", "-1\n=2"];
      const parsed = parseCsv(toCsv([["h"], ...evil.map((e) => [e])]));
      expect(parsed).toHaveLength(evil.length + 1);
      for (const rec of parsed.slice(1)) expect(rec.cells[0]).toMatch(/^'/);
    });
  });
});

describe("toCsv", () => {
  it("starts with a byte-order mark, uses CRLF, and ends with a line break", () => {
    const text = toCsv([["a", "b"], [1, "x,y"]]);
    expect(text.startsWith("﻿")).toBe(true);
    expect(text).toBe('﻿a,b\r\n1,"x,y"\r\n');
  });

  it("round-trips ordinary values", () => {
    const rows = [["sku", "note"], ["SKU001", 'He said "ok", twice'], ["SKU002", "plain"]];
    const parsed = parseCsv(toCsv(rows)).map((r) => r.cells);
    expect(parsed).toEqual(rows.map((r) => r.map(String)));
  });
});

describe("CsvSink", () => {
  const decision = (over: Partial<BuyingDecision> = {}): BuyingDecision => ({
    id: 1,
    skuId: "SKU001",
    skuName: "Freshroots Mango Drink 200ml",
    unit: "Units",
    action: "REORDER",
    quantity: 600,
    status: "pending",
    orderReference: null,
    source: "raghav_changed",
    reasonCode: "WRONG_QUANTITY",
    reasonText: "Smaller batch",
    runId: 3,
    asOfDate: "2026-10-19",
    ...over,
  });

  it("is the csv sink", () => {
    expect(new CsvSink().name).toBe("csv");
  });

  it("writes a header and one row per decision, and reports every row ok", async () => {
    const res = await new CsvSink().createDraftOrders([decision(), decision({ id: 2, skuId: "SKU006", action: "PAUSE_ORDER", quantity: 0, source: "ai_accepted", reasonCode: null, reasonText: null })]);
    expect(res.ref).toBe("csv:2-rows");
    expect(res.results).toEqual([{ sku_id: "SKU001", ok: true }, { sku_id: "SKU006", ok: true }]);
    const rows = parseCsv(res.content!).map((r) => r.cells);
    expect(rows[0]).toEqual(ORDER_CSV_HEADER);
    expect(rows[1]).toEqual(["1", "SKU001", "Freshroots Mango Drink 200ml", "REORDER", "Reorder 600 Units", "600", "Units", "Raghav changed", "WRONG_QUANTITY", "Smaller batch", "3", "2026-10-19", "pending", ""]);
    // A pause is "hold the next order", never a cancellation (G-B4).
    expect(rows[2][4]).toBe("Hold the next order");
    expect(rows[2][4]).not.toMatch(/cancel/i);
  });

  it("an empty list is just the header", async () => {
    const res = await new CsvSink().createDraftOrders([]);
    expect(parseCsv(res.content!)).toHaveLength(1);
    expect(res.results).toEqual([]);
  });

  it("escapes text a person typed: names, reasons and order references", async () => {
    const res = await new CsvSink().createDraftOrders([
      decision({ skuName: "=cmd|' /C calc'!A0", reasonText: '@SUM(1+1)*cmd|"x"', orderReference: "+1-555-0100" }),
    ]);
    const row = parseCsv(res.content!)[1].cells;
    expect(row[2]).toBe("'=cmd|' /C calc'!A0");
    expect(row[9]).toBe("'@SUM(1+1)*cmd|\"x\"");
    expect(row[13]).toBe("'+1-555-0100");
  });
});
