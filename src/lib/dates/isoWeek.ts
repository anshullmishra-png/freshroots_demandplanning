// ISO-week and date helpers. Everything is computed in UTC on plain calendar dates,
// so the machine's time zone never changes a result. Weeks run Monday to Sunday.

const DAY_MS = 86_400_000;
const WEEK_MS = 7 * DAY_MS;

export interface IsoWeek {
  year: number;
  week: number;
}

/** Strict `YYYY-MM-DD` to a UTC date. Returns null for bad format or a date that does not exist. */
export function parseIsoDate(s: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (!m) return null;
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  return formatIsoDate(d) === s ? d : null;
}

export function formatIsoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** Today's calendar date in Asia/Kolkata as `YYYY-MM-DD`. */
export function istDate(now: Date): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

/** Whole days from date string `a` to date string `b` (b minus a). */
export function daysBetween(a: string, b: string): number {
  const da = parseIsoDate(a);
  const db = parseIsoDate(b);
  if (!da || !db) throw new Error(`daysBetween: bad date (${a}, ${b})`);
  return Math.round((db.getTime() - da.getTime()) / DAY_MS);
}

function mondayOfIsoWeek1(year: number): number {
  const jan4 = new Date(Date.UTC(year, 0, 4));
  const dow = (jan4.getUTCDay() + 6) % 7; // Monday = 0
  return jan4.getTime() - dow * DAY_MS;
}

/** The ISO year and week that contain a date. */
export function isoWeekOf(date: Date): IsoWeek {
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const dow = (d.getUTCDay() + 6) % 7;
  d.setUTCDate(d.getUTCDate() - dow + 3); // the Thursday of this week decides the ISO year
  const year = d.getUTCFullYear();
  const week = 1 + Math.round((d.getTime() - (mondayOfIsoWeek1(year) + 3 * DAY_MS)) / WEEK_MS);
  return { year, week };
}

export function weeksInIsoYear(year: number): number {
  return isoWeekOf(new Date(Date.UTC(year, 11, 28))).week;
}

/** Parses `YYYY-Www`. Returns null when the format is wrong or the week does not exist in that year. */
export function parseWeek(s: string): IsoWeek | null {
  const m = /^(\d{4})-W(\d{2})$/.exec(s);
  if (!m) return null;
  const year = Number(m[1]);
  const week = Number(m[2]);
  if (week < 1 || week > weeksInIsoYear(year)) return null;
  return { year, week };
}

export function formatWeek(w: IsoWeek): string {
  return `${w.year}-W${String(w.week).padStart(2, "0")}`;
}

/** A whole number that increases by 1 for each ISO week, so week arithmetic is plain subtraction. */
export function weekIndex(w: IsoWeek): number {
  const monday = mondayOfIsoWeek1(w.year) + (w.week - 1) * WEEK_MS;
  return Math.floor(monday / WEEK_MS);
}

export function weekFromIndex(index: number): IsoWeek {
  const monday = index * WEEK_MS + 4 * DAY_MS; // inverse of weekIndex (epoch day 0 is a Thursday)
  return isoWeekOf(new Date(monday));
}

/** The ISO week that ended before `asOf`: the week of `asOf`, minus one. */
export function lastCompleteWeek(asOf: Date): IsoWeek {
  return weekFromIndex(weekIndex(isoWeekOf(asOf)) - 1);
}
