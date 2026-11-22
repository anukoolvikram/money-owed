import { describe, expect, it } from "vitest";
import { addDays, cycleFor, isValidLocalDate, nextCycle, previousCycle, todayIn } from "@/lib/dates";

describe("India dates", () => {
  it("uses the Asia/Kolkata calendar date, not UTC", () => {
    // 19:00 UTC on 31 Jan = 00:30 IST on 1 Feb
    expect(todayIn("Asia/Kolkata", new Date("2026-01-31T19:00:00Z"))).toBe("2026-02-01");
    // 18:29 UTC = 23:59 IST same day
    expect(todayIn("Asia/Kolkata", new Date("2026-01-31T18:29:00Z"))).toBe("2026-01-31");
    expect(todayIn("UTC", new Date("2026-01-31T19:00:00Z"))).toBe("2026-01-31");
  });

  it("validates calendar dates", () => {
    expect(isValidLocalDate("2024-02-29")).toBe(true);
    expect(isValidLocalDate("2025-02-29")).toBe(false);
    expect(isValidLocalDate("2026-13-01")).toBe(false);
    expect(isValidLocalDate("2026-04-31")).toBe(false);
    expect(isValidLocalDate("2026-1-1")).toBe(false);
    expect(isValidLocalDate("2026-01-01T00:00:00Z")).toBe(false);
  });

  it("adds days across month and leap-year boundaries", () => {
    expect(addDays("2024-02-28", 1)).toBe("2024-02-29");
    expect(addDays("2025-02-28", 1)).toBe("2025-03-01");
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
  });
});

describe("budget cycles [start, nextStart)", () => {
  it("calendar month when start day is 1", () => {
    expect(cycleFor("2026-03-15", 1)).toEqual({ start: "2026-03-01", end: "2026-04-01" });
    expect(cycleFor("2026-03-01", 1)).toEqual({ start: "2026-03-01", end: "2026-04-01" });
    expect(cycleFor("2026-03-31", 1)).toEqual({ start: "2026-03-01", end: "2026-04-01" });
  });

  it("salary day 25 spans two months; start is inclusive, end exclusive", () => {
    expect(cycleFor("2026-03-25", 25)).toEqual({ start: "2026-03-25", end: "2026-04-25" });
    expect(cycleFor("2026-03-24", 25)).toEqual({ start: "2026-02-25", end: "2026-03-25" });
    expect(cycleFor("2026-01-10", 25)).toEqual({ start: "2025-12-25", end: "2026-01-25" });
  });

  it("day 31 clamps to the last day of short months", () => {
    expect(cycleFor("2026-02-15", 31)).toEqual({ start: "2026-01-31", end: "2026-02-28" });
    expect(cycleFor("2026-02-28", 31)).toEqual({ start: "2026-02-28", end: "2026-03-31" });
    expect(cycleFor("2026-04-30", 31)).toEqual({ start: "2026-04-30", end: "2026-05-31" });
    expect(cycleFor("2026-04-29", 31)).toEqual({ start: "2026-03-31", end: "2026-04-30" });
  });

  it("handles leap February", () => {
    expect(cycleFor("2024-02-29", 30)).toEqual({ start: "2024-02-29", end: "2024-03-30" });
    expect(cycleFor("2024-02-28", 30)).toEqual({ start: "2024-01-30", end: "2024-02-29" });
    expect(cycleFor("2025-02-28", 29)).toEqual({ start: "2025-02-28", end: "2025-03-29" });
  });

  it("cycles tile without gaps or overlaps over several years", () => {
    for (const day of [1, 15, 28, 29, 30, 31]) {
      let c = cycleFor("2023-01-01", day);
      for (let i = 0; i < 40; i++) {
        const n = nextCycle(c, day);
        expect(n.start).toBe(c.end);
        expect(previousCycle(n, day)).toEqual(c);
        expect(n.end > n.start).toBe(true);
        c = n;
      }
    }
  });

  it("rejects invalid start days", () => {
    expect(() => cycleFor("2026-01-01", 0)).toThrow();
    expect(() => cycleFor("2026-01-01", 32)).toThrow();
  });
});
