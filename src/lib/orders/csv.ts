// CSV writing for exports. Anything a person typed (names, reasons, order references) can start with a character
// that a spreadsheet would run as a formula. Such cells are written as plain text instead (guardrail G-S7).

/** Characters that make Excel, Sheets or LibreOffice treat a cell as a formula (OWASP CSV injection list). */
const FORMULA_START = /^[=+\-@\t\r]/;

export function csvCell(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "number") return Number.isFinite(value) ? String(value) : "";
  let text = value;
  if (FORMULA_START.test(text)) text = `'${text}`; // a leading apostrophe makes it text
  if (/[",\r\n]/.test(text)) text = `"${text.replace(/"/g, '""')}"`;
  return text;
}

/** Rows to CSV text: CRLF line endings, and a byte-order mark so Excel reads UTF-8 correctly. */
export function toCsv(rows: Array<Array<string | number | null | undefined>>): string {
  return "﻿" + rows.map((row) => row.map(csvCell).join(",")).join("\r\n") + "\r\n";
}
