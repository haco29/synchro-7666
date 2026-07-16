import { describe, expect, it } from "vitest";
import { addDays, dayLabel, isIsoDate, weekDates, weekStartOf, weekdayOf } from "./week";

describe("week math", () => {
  it("finds the Thursday starting the week for any day in it", () => {
    expect(weekStartOf("2026-07-16")).toBe("2026-07-16"); // Thursday -> itself
    expect(weekStartOf("2026-07-17")).toBe("2026-07-16"); // Friday -> week's Thursday
    expect(weekStartOf("2026-07-21")).toBe("2026-07-16"); // Tuesday -> week's Thursday
    expect(weekStartOf("2026-07-22")).toBe("2026-07-16"); // Wednesday -> week's Thursday (week end)
    expect(weekStartOf("2026-07-15")).toBe("2026-07-09"); // Wednesday -> prior Thursday
  });

  it("crosses month and year boundaries", () => {
    expect(weekStartOf("2026-01-01")).toBe("2026-01-01"); // 2026-01-01 is a Thursday -> itself
    expect(weekStartOf("2026-01-02")).toBe("2026-01-01"); // Friday -> week's Thursday
    expect(weekStartOf("2025-12-31")).toBe("2025-12-25"); // Wednesday -> prior Thursday
  });

  it("adds days across boundaries", () => {
    expect(addDays("2026-07-12", 6)).toBe("2026-07-18");
    expect(addDays("2025-12-31", 1)).toBe("2026-01-01");
    expect(addDays("2026-07-12", -7)).toBe("2026-07-05");
  });

  it("lists the 7 dates of a week from Thursday through Wednesday", () => {
    const dates = weekDates("2026-07-16");
    expect(dates).toHaveLength(7);
    expect(dates[0]).toBe("2026-07-16"); // Thursday
    expect(dates[6]).toBe("2026-07-22"); // Wednesday
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
