import type { RulesConfig } from "@/lib/config/rules";
import {
  daysBetween,
  formatWeek,
  istDate,
  lastCompleteWeek,
  parseIsoDate,
  parseWeek,
  weekIndex,
} from "@/lib/dates/isoWeek";
import { parseCsv } from "./csv";
import {
  FILE_KEYS,
  FILE_NAMES,
  REQUIRED_COLUMNS,
  type CalendarRow,
  type DistributorRow,
  type ErrorCode,
  type FileKey,
  type InventoryRow,
  type Issue,
  type SalesRow,
  type SkuRow,
  type UploadFiles,
  type ValidationResult,
  type WarningCode,
} from "./types";

interface Row {
  row: number;
  v: Record<string, string>;
}

const WHOLE = /^\d+$/;
const NEGATIVE_WHOLE = /^-\d+$/;

/**
 * Validates and cleans the five uploaded files (docs/03-DATA-SPEC.md).
 * Pure: no database, no clock except the `now` passed in. Nothing is ever repaired:
 * cleaning is limited to trimming, line endings and type casting.
 */
export function validateUpload(
  files: UploadFiles,
  ctx: { rules: RulesConfig; now: Date },
): ValidationResult {
  const { rules, now } = ctx;
  const guard = rules.data_guardrails;
  const issues: Issue[] = [];
  const fileStats = {} as Record<FileKey, number | null>;

  const error = (file: FileKey, row: number | null, column: string | null, code: ErrorCode, message: string) =>
    issues.push({ level: "ERROR", file, row, column, code, message });
  const warn = (file: FileKey, row: number | null, column: string | null, code: WarningCode, message: string) =>
    issues.push({ level: "WARNING", file, row, column, code, message });

  // 1. Read each file into rows keyed by column name.
  const tables: Partial<Record<FileKey, Row[]>> = {};
  for (const key of FILE_KEYS) {
    fileStats[key] = null;
    const name = FILE_NAMES[key];
    const text = files[key];
    if (text === undefined || text.trim() === "") {
      error(key, null, null, "MISSING_FILE", `${name} is missing or empty.`);
      continue;
    }
    const bytes = new TextEncoder().encode(text).length;
    if (bytes > guard.max_file_bytes) {
      error(key, null, null, "FILE_TOO_LARGE", `${name} is ${bytes} bytes; the limit is ${guard.max_file_bytes}.`);
      continue;
    }
    const records = parseCsv(text);
    if (records.length === 0) {
      error(key, null, null, "MISSING_FILE", `${name} is missing or empty.`);
      continue;
    }
    const header = records[0].cells;
    const missing = REQUIRED_COLUMNS[key].filter((c) => !header.includes(c));
    if (missing.length > 0) {
      for (const column of missing) {
        error(key, 1, column, "MISSING_COLUMN", `${name} has no "${column}" column.`);
      }
      continue;
    }
    const dataRecords = records.slice(1);
    if (dataRecords.length > guard.max_rows_per_file) {
      error(key, null, null, "TOO_MANY_ROWS", `${name} has ${dataRecords.length} rows; the limit is ${guard.max_rows_per_file}.`);
      continue;
    }
    const rows: Row[] = [];
    for (const rec of dataRecords) {
      if (rec.cells.length !== header.length) {
        error(key, rec.line, null, "MALFORMED_ROW", `${name} line ${rec.line} has ${rec.cells.length} cells; the header has ${header.length}.`);
        continue;
      }
      const v: Record<string, string> = {};
      header.forEach((h, i) => (v[h] = rec.cells[i]));
      rows.push({ row: rec.line, v });
    }
    tables[key] = rows;
    fileStats[key] = rows.length;
  }

  // Cell readers that report problems and return null.
  const text = (key: FileKey, r: Row, column: string): string | null => {
    const value = r.v[column];
    if (value === "") {
      error(key, r.row, column, "MALFORMED_ROW", `${FILE_NAMES[key]} line ${r.row}: "${column}" is empty.`);
      return null;
    }
    return value;
  };
  const whole = (key: FileKey, r: Row, column: string): number | null => {
    const value = r.v[column];
    if (WHOLE.test(value)) return Number(value);
    if (NEGATIVE_WHOLE.test(value)) {
      error(key, r.row, column, "NEGATIVE_NUMBER", `${FILE_NAMES[key]} line ${r.row}: "${column}" is negative (${value}).`);
    } else {
      error(key, r.row, column, "NOT_WHOLE_NUMBER", `${FILE_NAMES[key]} line ${r.row}: "${column}" must be a whole number, found "${value}".`);
    }
    return null;
  };

  // 2. Master files.
  const distributors = new Map<string, DistributorRow & { row: number }>();
  for (const r of tables.distributor_master ?? []) {
    const id = text("distributor_master", r, "Distributor_ID");
    if (id === null) continue;
    if (distributors.has(id)) {
      error("distributor_master", r.row, "Distributor_ID", "DUPLICATE_KEY", `distributor_master.csv line ${r.row}: Distributor_ID ${id} appears more than once.`);
      continue;
    }
    distributors.set(id, {
      row: r.row,
      distributor_id: id,
      name: r.v.Distributor_Name,
      region: r.v.Region,
      status: r.v.Status,
    });
  }

  const skus = new Map<string, SkuRow & { row: number }>();
  for (const r of tables.sku_master ?? []) {
    const id = text("sku_master", r, "SKU_ID");
    if (id === null) continue;
    if (skus.has(id)) {
      error("sku_master", r.row, "SKU_ID", "DUPLICATE_KEY", `sku_master.csv line ${r.row}: SKU_ID ${id} appears more than once.`);
      continue;
    }
    let valid = true;
    const perishability = r.v.Perishability;
    if (perishability !== "Low" && perishability !== "High") {
      error("sku_master", r.row, "Perishability", "BAD_PERISHABILITY", `sku_master.csv line ${r.row}: Perishability must be Low or High, found "${perishability}".`);
      valid = false;
    }
    const qtyText = r.v.Standard_Reorder_Qty;
    const qty = WHOLE.test(qtyText) ? Number(qtyText) : NaN;
    if (!(qty > 0)) {
      error("sku_master", r.row, "Standard_Reorder_Qty", "BAD_QTY", `sku_master.csv line ${r.row}: Standard_Reorder_Qty must be a positive whole number, found "${qtyText}".`);
      valid = false;
    }
    if (!valid) continue;
    skus.set(id, {
      row: r.row,
      sku_id: id,
      name: r.v.SKU_Name,
      category: r.v.Category,
      perishability: perishability as "Low" | "High",
      standard_reorder_qty: qty,
      uom: r.v.Unit_of_Measure,
      distributor_id: r.v.Distributor_ID === "" ? null : r.v.Distributor_ID,
    });
  }
  // A SKU that failed its own checks is still a known SKU for the cross-file checks below.
  const knownSkuIds = new Set<string>(skus.keys());
  for (const r of tables.sku_master ?? []) if (r.v.SKU_ID) knownSkuIds.add(r.v.SKU_ID);
  const haveSkuMaster = tables.sku_master !== undefined;

  const calendar = new Map<string, CalendarRow>();
  for (const r of tables.calendar ?? []) {
    const year = whole("calendar", r, "Year");
    const month = whole("calendar", r, "Month");
    const flag = r.v.Is_Festival_Month.toUpperCase();
    if (flag !== "TRUE" && flag !== "FALSE") {
      error("calendar", r.row, "Is_Festival_Month", "BAD_BOOLEAN", `calendar.csv line ${r.row}: Is_Festival_Month must be TRUE or FALSE, found "${r.v.Is_Festival_Month}".`);
    }
    if (month !== null && (month < 1 || month > 12)) {
      error("calendar", r.row, "Month", "BAD_MONTH", `calendar.csv line ${r.row}: Month must be 1 to 12, found ${month}.`);
      continue;
    }
    if (year === null || month === null || (flag !== "TRUE" && flag !== "FALSE")) continue;
    const key = `${year}-${month}`;
    if (calendar.has(key)) {
      error("calendar", r.row, "Month", "DUPLICATE_KEY", `calendar.csv line ${r.row}: ${year}-${String(month).padStart(2, "0")} appears more than once.`);
      continue;
    }
    calendar.set(key, { year, month, is_festival: flag === "TRUE" });
  }

  // 3. Sales.
  const sales: Array<SalesRow & { row: number; index: number }> = [];
  const salesSeen = new Set<string>();
  for (const r of tables.sales ?? []) {
    const skuId = text("sales", r, "SKU_ID");
    const units = whole("sales", r, "Units_Sold");
    const parsed = parseWeek(r.v.Week);
    if (!parsed) {
      error("sales", r.row, "Week", "BAD_WEEK_FORMAT", `weekly_sales.csv line ${r.row}: Week must look like 2026-W42 and be a real ISO week, found "${r.v.Week}".`);
    }
    if (skuId === null || units === null || !parsed) continue;
    if (haveSkuMaster && !knownSkuIds.has(skuId)) {
      error("sales", r.row, "SKU_ID", "UNKNOWN_SKU", `weekly_sales.csv line ${r.row}: ${skuId} is not in sku_master.csv.`);
      continue;
    }
    const week = formatWeek(parsed);
    const key = `${skuId}|${week}`;
    if (salesSeen.has(key)) {
      error("sales", r.row, "Week", "DUPLICATE_KEY", `weekly_sales.csv line ${r.row}: ${skuId} already has a row for ${week}.`);
      continue;
    }
    salesSeen.add(key);
    sales.push({ row: r.row, sku_id: skuId, week, units_sold: units, index: weekIndex(parsed) });
  }

  // 4. Inventory.
  const inventory: Array<InventoryRow & { row: number }> = [];
  const inventorySeen = new Set<string>();
  const inventorySkuIds = new Set<string>();
  for (const r of tables.inventory ?? []) {
    const skuId = text("inventory", r, "SKU_ID");
    const location = text("inventory", r, "Location");
    const units = whole("inventory", r, "Units_On_Hand");
    let asOf: string | null = r.v.As_Of_Date;
    if (!parseIsoDate(asOf)) {
      error("inventory", r.row, "As_Of_Date", "BAD_DATE", `current_inventory.csv line ${r.row}: As_Of_Date must be a real date like 2026-10-19, found "${asOf}".`);
      asOf = null;
    }
    if (skuId !== null) inventorySkuIds.add(skuId);
    if (skuId === null || location === null || units === null || asOf === null) continue;
    if (haveSkuMaster && !knownSkuIds.has(skuId)) {
      error("inventory", r.row, "SKU_ID", "UNKNOWN_SKU", `current_inventory.csv line ${r.row}: ${skuId} is not in sku_master.csv.`);
      continue;
    }
    const key = `${skuId}|${location}`;
    if (inventorySeen.has(key)) {
      error("inventory", r.row, "Location", "DUPLICATE_KEY", `current_inventory.csv line ${r.row}: ${skuId} already has a row for ${location}.`);
      continue;
    }
    inventorySeen.add(key);
    inventory.push({ row: r.row, sku_id: skuId, location, units_on_hand: units, as_of_date: asOf });
  }

  // 5. As-of date, freshness and calendar.
  let asOfDate: string | null = null;
  if (tables.inventory) {
    const dates = [...new Set(inventory.map((i) => i.as_of_date))];
    if (dates.length === 1) {
      asOfDate = dates[0];
    } else if (dates.length > 1) {
      error("inventory", null, "As_Of_Date", "MIXED_AS_OF_DATES", `current_inventory.csv has more than one As_Of_Date (${dates.sort().join(", ")}). One date is needed per run.`);
    } else if (!issues.some((i) => i.file === "inventory" && i.code === "BAD_DATE")) {
      error("inventory", null, "As_Of_Date", "NO_AS_OF_DATE", "current_inventory.csv has no usable rows, so the as-of date cannot be determined.");
    }
  }
  let lastWeekIndex: number | null = null;
  if (asOfDate) {
    const age = daysBetween(asOfDate, istDate(now));
    if (age > guard.max_inventory_age_days) {
      error("inventory", null, "As_Of_Date", "STALE_INVENTORY", `Inventory is as of ${asOfDate}, ${age} days before today. The limit is ${guard.max_inventory_age_days} days.`);
    }
    const asOf = parseIsoDate(asOfDate)!;
    lastWeekIndex = weekIndex(lastCompleteWeek(asOf));
    if (tables.calendar && !calendar.has(`${asOf.getUTCFullYear()}-${asOf.getUTCMonth() + 1}`)) {
      error("calendar", null, null, "CALENDAR_MONTH_MISSING", `calendar.csv has no row for ${asOfDate.slice(0, 7)}, so the festival uplift cannot be decided.`);
    }
  }

  // 6. Every SKU in the master needs inventory.
  if (tables.inventory && haveSkuMaster) {
    for (const [id, sku] of skus) {
      if (!inventorySkuIds.has(id)) {
        error("sku_master", sku.row, "SKU_ID", "NO_INVENTORY_ROW", `${id} is in sku_master.csv but has no row in current_inventory.csv.`);
      }
    }
  }

  // 7. Sales coverage per SKU.
  const skusWithoutSales: string[] = [];
  const salesBySku = new Map<string, Array<(typeof sales)[number]>>();
  for (const s of sales) {
    const list = salesBySku.get(s.sku_id);
    if (list) list.push(s);
    else salesBySku.set(s.sku_id, [s]);
  }
  const windowWeeks = rules.rules.average_window_weeks;
  if (tables.sales && haveSkuMaster) {
    for (const [id, sku] of skus) {
      const list = salesBySku.get(id) ?? [];
      if (list.length === 0) {
        skusWithoutSales.push(id);
        warn("sku_master", sku.row, "SKU_ID", "NO_SALES_AT_ALL", `${id} is in sku_master.csv but has no sales at all (new launch?). It will not be forecast.`);
        continue;
      }
      if (list.length < guard.min_weeks_of_sales_required) {
        error("sales", null, "Week", "FEWER_THAN_MIN_WEEKS", `${id} has ${list.length} weeks of sales; at least ${guard.min_weeks_of_sales_required} are required.`);
        continue;
      }
      if (lastWeekIndex === null) continue;
      const have = new Set(list.map((s) => s.index));
      const latest = Math.max(...have);
      if (latest !== lastWeekIndex) {
        const latestWeek = list.find((s) => s.index === latest)!.week;
        const expected = formatWeek(lastCompleteWeek(parseIsoDate(asOfDate!)!));
        error("sales", null, "Week", "STALE_OR_FUTURE_SALES", `${id} sales end at ${latestWeek}, but the last complete week before ${asOfDate} is ${expected}.`);
        continue;
      }
      const gaps: number[] = [];
      for (let i = lastWeekIndex - windowWeeks + 1; i <= lastWeekIndex; i++) if (!have.has(i)) gaps.push(i);
      if (gaps.length > 0) {
        error("sales", null, "Week", "WEEK_GAP", `${id} is missing ${gaps.length} week(s) inside the last ${windowWeeks} weeks.`);
      }
      for (const s of list) {
        if (s.index > lastWeekIndex - windowWeeks && s.units_sold === 0) {
          warn("sales", s.row, "Units_Sold", "ZERO_SALES_WEEK", `${id} sold 0 units in ${s.week}, inside the last ${windowWeeks} weeks.`);
        }
      }
    }
  }

  // 8. Warnings that need both files.
  const activeSkuIds = new Set<string>([...salesBySku.keys(), ...inventory.map((i) => i.sku_id)]);
  for (const id of activeSkuIds) {
    const sku = skus.get(id);
    const dist = sku?.distributor_id ? distributors.get(sku.distributor_id) : undefined;
    if (sku && dist && dist.status.toLowerCase() !== "active") {
      warn("sku_master", sku.row, "Distributor_ID", "DISTRIBUTOR_NOT_ACTIVE", `${id} sits under ${dist.distributor_id} (${dist.name}), whose status is "${dist.status}".`);
    }
  }
  for (const inv of inventory) {
    const list = salesBySku.get(inv.sku_id);
    if (!list) continue;
    const peak = Math.max(...list.map((s) => s.units_sold));
    const multiple = guard.stock_vs_peak_weekly_sales_warning_multiple;
    if (inv.units_on_hand > multiple * peak) {
      warn("inventory", inv.row, "Units_On_Hand", "STOCK_UNIT_MISMATCH", `${inv.sku_id} has ${inv.units_on_hand} on hand, more than ${multiple} times its highest weekly sales (${peak}). Check the units.`);
    }
  }

  // 9. Result.
  const order = (i: Issue) => FILE_KEYS.indexOf(i.file) * 1e7 + (i.row ?? 0);
  const sorted = [...issues].sort((a, b) => order(a) - order(b));
  const errors = sorted.filter((i) => i.level === "ERROR");
  const warnings = sorted.filter((i) => i.level === "WARNING");
  const ok = errors.length === 0;

  return {
    ok,
    errors,
    warnings,
    fileStats,
    data: ok
      ? {
          asOfDate: asOfDate!,
          lastCompleteWeek: formatWeek(lastCompleteWeek(parseIsoDate(asOfDate!)!)),
          skus: [...skus.values()].map((s) => ({
            sku_id: s.sku_id,
            name: s.name,
            category: s.category,
            perishability: s.perishability,
            standard_reorder_qty: s.standard_reorder_qty,
            uom: s.uom,
            distributor_id: s.distributor_id,
          })),
          distributors: [...distributors.values()].map((d) => ({
            distributor_id: d.distributor_id,
            name: d.name,
            region: d.region,
            status: d.status,
          })),
          calendar: [...calendar.values()],
          sales: sales.map((s) => ({ sku_id: s.sku_id, week: s.week, units_sold: s.units_sold })),
          inventory: inventory.map((i) => ({
            sku_id: i.sku_id,
            location: i.location,
            units_on_hand: i.units_on_hand,
            as_of_date: i.as_of_date,
          })),
          skusWithoutSales,
        }
      : null,
  };
}
