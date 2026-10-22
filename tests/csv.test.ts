import { describe, expect, it } from "vitest";
import { parseCsv } from "@/lib/validation/csv";

describe("parseCsv", () => {
  it("reads CRLF, LF and a BOM the same way", () => {
    const crlf = parseCsv("A,B\r\n1,2\r\n3,4\r\n");
    const lf = parseCsv("A,B\n1,2\n3,4\n");
    const bom = parseCsv("﻿A,B\r\n1,2\r\n3,4\r\n");
    expect(lf).toEqual(crlf);
    expect(bom).toEqual(crlf);
    expect(crlf.map((r) => r.cells)).toEqual([["A", "B"], ["1", "2"], ["3", "4"]]);
  });

  it("trims cells and skips blank lines", () => {
    const rows = parseCsv(" A , B \r\n\r\n 1 ,2\r\n\r\n");
    expect(rows.map((r) => r.cells)).toEqual([["A", "B"], ["1", "2"]]);
  });

  it("keeps 1-based line numbers, counting blank lines", () => {
    const rows = parseCsv("A,B\r\n\r\n1,2\r\n");
    expect(rows.map((r) => r.line)).toEqual([1, 3]);
  });

  it("handles quoted commas, escaped quotes and a final line with no newline", () => {
    const rows = parseCsv('A,B\r\n"x, y","say ""hi"""');
    expect(rows[1].cells).toEqual(["x, y", 'say "hi"']);
  });

  it("does not treat formula characters specially (that is an export concern)", () => {
    expect(parseCsv("A\r\n=1+1")[1].cells).toEqual(["=1+1"]);
  });
});
