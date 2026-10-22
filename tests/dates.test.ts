import { describe, expect, it } from "vitest";
import {
  daysBetween,
  formatWeek,
  isoWeekOf,
  istDate,
  lastCompleteWeek,
  parseIsoDate,
  parseWeek,
  weekFromIndex,
  weekIndex,
} from "@/lib/dates/isoWeek";

const d = (s: string) => parseIsoDate(s)!;

describe("ISO weeks", () => {
  it("finds the ISO week of a date", () => {
    expect(formatWeek(isoWeekOf(d("2026-10-19")))).toBe("2026-W43"); // Monday
    expect(formatWeek(isoWeekOf(d("2026-10-18")))).toBe("2026-W42"); // Sunday
    expect(formatWeek(isoWeekOf(d("2021-01-03")))).toBe("2020-W53"); // belongs to the previous ISO year
    expect(formatWeek(isoWeekOf(d("2024-12-30")))).toBe("2025-W01"); // belongs to the next ISO year
  });

  it("last complete week is the week before the as-of date's week", () => {
    expect(formatWeek(lastCompleteWeek(d("2026-10-19")))).toBe("2026-W42"); // seed: Monday
    expect(formatWeek(lastCompleteWeek(d("2026-10-21")))).toBe("2026-W42"); // mid-week
    expect(formatWeek(lastCompleteWeek(d("2026-10-18")))).toBe("2026-W41"); // Sunday: W42 not over yet
    expect(formatWeek(lastCompleteWeek(d("2025-12-29")))).toBe("2025-W52"); // Monday of 2026-W01: across the year boundary
    expect(formatWeek(lastCompleteWeek(d("2026-01-05")))).toBe("2026-W01");
  });

  it("parses only real weeks", () => {
    expect(parseWeek("2026-W42")).toEqual({ year: 2026, week: 42 });
    expect(parseWeek("2026-W53")).toEqual({ year: 2026, week: 53 }); // 2026 has 53 ISO weeks
    expect(parseWeek("2025-W53")).toBeNull(); // 2025 has 52
    expect(parseWeek("2026-W00")).toBeNull();
    expect(parseWeek("2026-42")).toBeNull();
    expect(parseWeek("2026-W4")).toBeNull();
  });

  it("week index goes up by one per week, across year ends", () => {
    expect(weekIndex(parseWeek("2026-W43")!) - weekIndex(parseWeek("2026-W42")!)).toBe(1);
    expect(weekIndex(parseWeek("2026-W01")!) - weekIndex(parseWeek("2025-W52")!)).toBe(1);
    expect(weekIndex(parseWeek("2026-W42")!) - weekIndex(parseWeek("2026-W31")!)).toBe(11);
    expect(formatWeek(weekFromIndex(weekIndex(parseWeek("2026-W27")!)))).toBe("2026-W27");
  });
});

describe("dates", () => {
  it("rejects dates that do not exist", () => {
    expect(parseIsoDate("2026-02-30")).toBeNull();
    expect(parseIsoDate("2026-13-01")).toBeNull();
    expect(parseIsoDate("19-10-2026")).toBeNull();
    expect(parseIsoDate("2026-10-19")).not.toBeNull();
  });

  it("uses the Asia/Kolkata calendar day", () => {
    expect(istDate(new Date("2026-10-19T20:00:00Z"))).toBe("2026-10-20"); // 01:30 IST next day
    expect(istDate(new Date("2026-10-19T10:00:00Z"))).toBe("2026-10-19");
  });

  it("counts days between dates", () => {
    expect(daysBetween("2026-10-19", "2026-10-26")).toBe(7);
    expect(daysBetween("2026-10-19", "2026-10-19")).toBe(0);
  });
});
