import { describe, expect, it } from "vitest";
import { addDays, isIsoDate, sundayOf, weekDates, weekdayOf } from "./week";

describe("week math", () => {
  it("finds the Sunday of a week for any day in it", () => {
    expect(sundayOf("2026-07-13")).toBe("2026-07-12"); // Monday -> prior Sunday
    expect(sundayOf("2026-07-12")).toBe("2026-07-12"); // Sunday -> itself
    expect(sundayOf("2026-07-18")).toBe("2026-07-12"); // Saturday -> week's Sunday
  });

  it("crosses month and year boundaries", () => {
    expect(sundayOf("2026-01-01")).toBe("2025-12-28");
    expect(sundayOf("2026-03-01")).toBe("2026-03-01"); // 2026-03-01 is a Sunday
  });

  it("adds days across boundaries", () => {
    expect(addDays("2026-07-12", 6)).toBe("2026-07-18");
    expect(addDays("2025-12-31", 1)).toBe("2026-01-01");
    expect(addDays("2026-07-12", -7)).toBe("2026-07-05");
  });

  it("lists the 7 dates of a week from Sunday", () => {
    const dates = weekDates("2026-07-12");
    expect(dates).toHaveLength(7);
    expect(dates[0]).toBe("2026-07-12");
    expect(dates[6]).toBe("2026-07-18");
  });

  it("computes weekday index with Sunday = 0", () => {
    expect(weekdayOf("2026-07-12")).toBe(0);
    expect(weekdayOf("2026-07-18")).toBe(6);
  });

  it("validates ISO dates", () => {
    expect(isIsoDate("2026-07-12")).toBe(true);
    expect(isIsoDate("2026-7-12")).toBe(false);
    expect(isIsoDate("not-a-date")).toBe(false);
    expect(isIsoDate("2026-13-40")).toBe(false);
  });
});
