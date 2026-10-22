export type FileKey = "sales" | "inventory" | "sku_master" | "distributor_master" | "calendar";

export const FILE_KEYS: FileKey[] = ["sales", "inventory", "sku_master", "distributor_master", "calendar"];

export const FILE_NAMES: Record<FileKey, string> = {
  sales: "weekly_sales.csv",
  inventory: "current_inventory.csv",
  sku_master: "sku_master.csv",
  distributor_master: "distributor_master.csv",
  calendar: "calendar.csv",
};

export const REQUIRED_COLUMNS: Record<FileKey, string[]> = {
  sales: ["SKU_ID", "Week", "Units_Sold"],
  inventory: ["SKU_ID", "Location", "Units_On_Hand", "As_Of_Date"],
  sku_master: [
    "SKU_ID",
    "SKU_Name",
    "Category",
    "Perishability",
    "Standard_Reorder_Qty",
    "Unit_of_Measure",
    "Distributor_ID",
  ],
  distributor_master: ["Distributor_ID", "Distributor_Name", "Region", "Status"],
  calendar: ["Year", "Month", "Year_Month", "Is_Festival_Month"],
};

export type ErrorCode =
  | "MISSING_FILE"
  | "MISSING_COLUMN"
  | "FILE_TOO_LARGE"
  | "TOO_MANY_ROWS"
  | "MALFORMED_ROW"
  | "NOT_WHOLE_NUMBER"
  | "NEGATIVE_NUMBER"
  | "BAD_QTY"
  | "BAD_PERISHABILITY"
  | "BAD_BOOLEAN"
  | "BAD_MONTH"
  | "BAD_DATE"
  | "BAD_WEEK_FORMAT"
  | "DUPLICATE_KEY"
  | "UNKNOWN_SKU"
  | "NO_INVENTORY_ROW"
  | "FEWER_THAN_MIN_WEEKS"
  | "WEEK_GAP"
  | "STALE_OR_FUTURE_SALES"
  | "NO_AS_OF_DATE"
  | "MIXED_AS_OF_DATES"
  | "STALE_INVENTORY"
  | "CALENDAR_MONTH_MISSING";

export type WarningCode =
  | "DISTRIBUTOR_NOT_ACTIVE"
  | "ZERO_SALES_WEEK"
  | "NO_SALES_AT_ALL"
  | "STOCK_UNIT_MISMATCH";

export interface Issue {
  level: "ERROR" | "WARNING";
  file: FileKey;
  /** 1-based line in the file (header is line 1). Null when the issue is about the whole file. */
  row: number | null;
  column: string | null;
  code: ErrorCode | WarningCode;
  message: string;
}

export type UploadFiles = Partial<Record<FileKey, string>>;

export interface SkuRow {
  sku_id: string;
  name: string;
  category: string;
  perishability: "Low" | "High";
  standard_reorder_qty: number;
  uom: string;
  distributor_id: string | null;
}

export interface DistributorRow {
  distributor_id: string;
  name: string;
  region: string;
  status: string;
}

export interface CalendarRow {
  year: number;
  month: number;
  is_festival: boolean;
}

export interface SalesRow {
  sku_id: string;
  week: string;
  units_sold: number;
}

export interface InventoryRow {
  sku_id: string;
  location: string;
  units_on_hand: number;
  as_of_date: string;
}

/** Cleaned, typed data. Only produced when the upload has no errors. */
export interface ValidatedData {
  asOfDate: string;
  lastCompleteWeek: string;
  skus: SkuRow[];
  distributors: DistributorRow[];
  calendar: CalendarRow[];
  sales: SalesRow[];
  inventory: InventoryRow[];
  /** SKUs in the master with no sales at all (possible new launches). The rule engine must not forecast them. */
  skusWithoutSales: string[];
}

export interface ValidationResult {
  ok: boolean;
  errors: Issue[];
  warnings: Issue[];
  /** Parsed data rows per file; null when the file could not be read. */
  fileStats: Record<FileKey, number | null>;
  data: ValidatedData | null;
}
