import { formatWeek, isoWeekOf, lastCompleteWeek, parseIsoDate, parseWeek, weekFromIndex, weekIndex } from "@/lib/dates/isoWeek";
import { FILE_KEYS, type FileKey } from "@/lib/validation/types";
import { seedFiles } from "./seed";

type Files = Record<FileKey, string>;

const EOL = /\r?\n/;

function mapCsv(text: string, edit: (header: string[], row: string[]) => string[] | null): string {
  const eol = text.includes("\r\n") ? "\r\n" : "\n";
  const [head, ...rows] = text.split(EOL).filter((l) => l !== "");
  const header = head.split(",");
  const out = rows.map((r) => edit(header, r.split(","))).filter((r): r is string[] => r !== null);
  return [head, ...out.map((r) => r.join(","))].join(eol) + eol;
}

/**
 * The seed data moved to a later date, so it passes the 7-day freshness rule on `asOf` (a `YYYY-MM-DD` India date).
 * Sales weeks are relabelled so the last one is the last complete week before `asOf`; inventory is dated `asOf`; the
 * calendar is rebuilt around `asOf`'s year with the same festival pattern. Quantities are untouched, so the rule
 * engine flags the same SKUs. The as-of month keeps the seed month's festival setting, so the uplift is the same too.
 */
export function shiftSeed(asOf: string, files: Files = seedFiles()): Files {
  const asOfDate = parseIsoDate(asOf);
  if (!asOfDate) throw new Error(`shiftSeed: bad date ${asOf}`);

  // Sales: relabel every week by the same number of weeks.
  let newest = -Infinity;
  mapCsv(files.sales, (h, r) => {
    const w = parseWeek(r[h.indexOf("Week")]);
    if (!w) throw new Error(`shiftSeed: bad week ${r[h.indexOf("Week")]}`);
    newest = Math.max(newest, weekIndex(w));
    return r;
  });
  const delta = weekIndex(lastCompleteWeek(asOfDate)) - newest;
  const sales = mapCsv(files.sales, (h, r) => {
    const i = h.indexOf("Week");
    r[i] = formatWeek(weekFromIndex(weekIndex(parseWeek(r[i])!) + delta));
    return r;
  });

  // Inventory: every row is as of the new date.
  const seedAsOf = files.inventory.split(EOL)[1].split(",")[3];
  const inventory = mapCsv(files.inventory, (h, r) => {
    r[h.indexOf("As_Of_Date")] = asOf;
    return r;
  });

  // Calendar: three years around the new date; festival months follow the seed's pattern by month.
  const seedFlags = new Map<number, string>();
  mapCsv(files.calendar, (h, r) => {
    if (r[h.indexOf("Year")] === seedAsOf.slice(0, 4)) seedFlags.set(Number(r[h.indexOf("Month")]), r[h.indexOf("Is_Festival_Month")]);
    return r;
  });
  const year = isoWeekOf(asOfDate).year;
  const asOfYear = asOfDate.getUTCFullYear();
  const rows = ["Year,Month,Year_Month,Is_Festival_Month"];
  for (let y = Math.min(year, asOfYear) - 1; y <= Math.max(year, asOfYear) + 1; y++) {
    for (let m = 1; m <= 12; m++) {
      const isAsOfMonth = y === asOfYear && m === asOfDate.getUTCMonth() + 1;
      const flag = isAsOfMonth ? seedFlags.get(Number(seedAsOf.slice(5, 7)))! : seedFlags.get(m)!;
      rows.push(`${y},${m},${y}-${String(m).padStart(2, "0")},${flag}`);
    }
  }
  const calendar = rows.join("\r\n") + "\r\n";

  const out = { ...files, sales, inventory, calendar };
  for (const k of FILE_KEYS) if (out[k] === undefined) throw new Error(`shiftSeed: lost ${k}`);
  return out;
}
