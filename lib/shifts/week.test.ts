import { describe, expect, it } from "vitest";
import { addDays, dayLabel, isIsoDate, weekDates, weekStartOf, weekdayOf } from "./week";

describe("week math", () => {
  it("finds the Wednesday starting the week for any day in it", () => {
    expect(weekStartOf("2026-07-15")).toBe("2026-07-15"); // Wednesday -> itself
    expect(weekStartOf("2026-07-16")).toBe("2026-07-15"); // Thursday -> week's Wednesday
    expect(weekStartOf("2026-07-13")).toBe("2026-07-08"); // Monday -> prior Wednesday
    expect(weekStartOf("2026-07-14")).toBe("2026-07-08"); // Tuesday -> prior Wednesday (week end)
    expect(weekStartOf("2026-07-12")).toBe("2026-07-08"); // Sunday -> prior Wednesday
  });

  it("crosses month and year boundaries", () => {
    expect(weekStartOf("2026-01-01")).toBe("2025-12-31"); // Thursday -> prior Wednesday
    expect(weekStartOf("2025-12-31")).toBe("2025-12-31"); // 2025-12-31 is a Wednesday
  });

  it("adds days across boundaries", () => {
    expect(addDays("2026-07-12", 6)).toBe("2026-07-18");
    expect(addDays("2025-12-31", 1)).toBe("2026-01-01");
    expect(addDays("2026-07-12", -7)).toBe("2026-07-05");
  });

  it("lists the 7 dates of a week from Wednesday through Tuesday", () => {
    const dates = weekDates("2026-07-15");
    expect(dates).toHaveLength(7);
    expect(dates[0]).toBe("2026-07-15"); // Wednesday
    expect(dates[6]).toBe("2026-07-21"); // Tuesday
  });

  it("computes weekday index with Sunday = 0", () => {
    expect(weekdayOf("2026-07-12")).toBe(0);
    expect(weekdayOf("2026-07-18")).toBe(6);
  });

  it("labels a date with its Hebrew weekday plus the date", () => {
    expect(dayLabel("2026-07-22")).toBe("רביעי, Jul 22"); // Wednesday
    expect(dayLabel("2026-07-26")).toBe("ראשון, Jul 26"); // Sunday
    expect(dayLabel("2026-07-25")).toBe("שבת, Jul 25"); // Saturday
  });

  it("validates ISO dates", () => {
    expect(isIsoDate("2026-07-12")).toBe(true);
    expect(isIsoDate("2026-7-12")).toBe(false);
    expect(isIsoDate("not-a-date")).toBe(false);
    expect(isIsoDate("2026-13-40")).toBe(false);
  });
});
