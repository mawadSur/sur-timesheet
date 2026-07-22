import { describe, it, expect } from "vitest";
import {
  addDays,
  currentWeekStart,
  formatHours,
  isFutureWeek,
  isInWeek,
  isMonday,
  isValidISODate,
  mondayOf,
  normalizeHours,
  sumHours,
  todayISO,
  weekDays,
  weekEnd,
  weekRangeLabel,
} from "../lib/week";

// Fixed "today" built from local Y/M/D parts so getFullYear/Month/Date are
// stable regardless of the runner's timezone. 2026-07-22 is a Wednesday.
const WED = new Date(2026, 6, 22);

describe("mondayOf", () => {
  it("walks back to the Monday of the same week", () => {
    expect(mondayOf("2026-07-22")).toBe("2026-07-20"); // Wed → Mon
    expect(mondayOf("2026-07-24")).toBe("2026-07-20"); // Fri → Mon
  });

  it("keeps a Monday where it is", () => {
    expect(mondayOf("2026-07-20")).toBe("2026-07-20");
  });

  it("treats Sunday as the END of its week, not the start", () => {
    expect(mondayOf("2026-07-26")).toBe("2026-07-20");
  });

  it("crosses a month and a year boundary", () => {
    expect(mondayOf("2026-07-01")).toBe("2026-06-29"); // Wed → prev month
    expect(mondayOf("2027-01-01")).toBe("2026-12-28"); // Fri → prev year
  });

  it("returns malformed input unchanged", () => {
    expect(mondayOf("not-a-date")).toBe("not-a-date");
  });
});

describe("isValidISODate", () => {
  it("accepts real calendar dates", () => {
    expect(isValidISODate("2026-07-20")).toBe(true);
    expect(isValidISODate("2028-02-29")).toBe(true); // leap year
  });

  it("rejects dates that do not exist rather than rolling them over", () => {
    expect(isValidISODate("2026-02-31")).toBe(false);
    expect(isValidISODate("2026-13-01")).toBe(false);
    expect(isValidISODate("2027-02-29")).toBe(false); // not a leap year
  });

  it("rejects malformed input", () => {
    expect(isValidISODate("")).toBe(false);
    expect(isValidISODate("2026-7-2")).toBe(false);
    expect(isValidISODate("2026-07-20T10:00:00Z")).toBe(false);
  });
});

describe("isMonday", () => {
  it("is true only for Mondays", () => {
    expect(isMonday("2026-07-20")).toBe(true);
    expect(isMonday("2026-07-21")).toBe(false);
    expect(isMonday("2026-07-26")).toBe(false); // Sunday
  });

  it("is false for invalid input", () => {
    expect(isMonday("2026-02-31")).toBe(false);
  });
});

describe("addDays / weekEnd", () => {
  it("shifts across month boundaries", () => {
    expect(addDays("2026-07-30", 3)).toBe("2026-08-02");
    expect(addDays("2026-08-02", -3)).toBe("2026-07-30");
  });

  it("ends a week on the Sunday six days later", () => {
    expect(weekEnd("2026-07-20")).toBe("2026-07-26");
    expect(weekEnd("2026-12-28")).toBe("2027-01-03");
  });
});

describe("weekDays", () => {
  const days = weekDays("2026-07-20");

  it("returns seven days starting on Monday", () => {
    expect(days).toHaveLength(7);
    expect(days[0]).toMatchObject({ date: "2026-07-20", name: "Mon", dayOfMonth: 20 });
    expect(days[6]).toMatchObject({ date: "2026-07-26", name: "Sun", dayOfMonth: 26 });
  });

  it("flags exactly Saturday and Sunday as the weekend", () => {
    expect(days.filter((d) => d.weekend).map((d) => d.name)).toEqual(["Sat", "Sun"]);
  });

  it("returns nothing for an invalid week start", () => {
    expect(weekDays("nope")).toEqual([]);
  });
});

describe("weekRangeLabel", () => {
  it("collapses a repeated month and year", () => {
    expect(weekRangeLabel("2026-07-20")).toBe("20 – 26 Jul 2026");
  });

  it("keeps both months when the week straddles them", () => {
    expect(weekRangeLabel("2026-06-29")).toBe("29 Jun – 5 Jul 2026");
  });

  it("keeps both years when the week straddles them", () => {
    expect(weekRangeLabel("2026-12-28")).toBe("28 Dec 2026 – 3 Jan 2027");
  });
});

describe("currentWeekStart / isFutureWeek", () => {
  it("anchors on the Monday of the week containing today", () => {
    expect(todayISO(WED)).toBe("2026-07-22");
    expect(currentWeekStart(WED)).toBe("2026-07-20");
  });

  it("treats the current week as submittable, not future", () => {
    expect(isFutureWeek("2026-07-20", WED)).toBe(false);
  });

  it("blocks the week after the current one", () => {
    expect(isFutureWeek("2026-07-27", WED)).toBe(true);
  });

  it("allows past weeks", () => {
    expect(isFutureWeek("2026-07-13", WED)).toBe(false);
  });
});

describe("isInWeek", () => {
  it("covers Monday through Sunday inclusive", () => {
    expect(isInWeek("2026-07-20", "2026-07-20")).toBe(true);
    expect(isInWeek("2026-07-26", "2026-07-20")).toBe(true);
  });

  it("excludes the days on either side", () => {
    expect(isInWeek("2026-07-19", "2026-07-20")).toBe(false);
    expect(isInWeek("2026-07-27", "2026-07-20")).toBe(false);
  });

  it("is false for unparseable input", () => {
    expect(isInWeek("garbage", "2026-07-20")).toBe(false);
  });
});

describe("normalizeHours", () => {
  it("snaps to quarter hours", () => {
    expect(normalizeHours("7.6")).toBe(7.5);
    expect(normalizeHours("7.63")).toBe(7.75);
    expect(normalizeHours(8)).toBe(8);
  });

  it("floors blanks, junk and negatives to zero", () => {
    expect(normalizeHours("")).toBe(0);
    expect(normalizeHours("abc")).toBe(0);
    expect(normalizeHours(-4)).toBe(0);
    expect(normalizeHours(null)).toBe(0);
  });

  it("clamps a day to 24 hours", () => {
    expect(normalizeHours(99)).toBe(24);
  });
});

describe("sumHours", () => {
  it("adds quarter hours without float drift", () => {
    expect(sumHours([0.1, 0.2])).toBe(0.3);
    expect(sumHours([7.25, 7.25, 7.25, 7.25, 7.25])).toBe(36.25);
  });

  it("is zero for an empty week", () => {
    expect(sumHours([])).toBe(0);
  });
});

describe("formatHours", () => {
  it("trims trailing zeros", () => {
    expect(formatHours(8)).toBe("8");
    expect(formatHours(7.5)).toBe("7.5");
    expect(formatHours(7.25)).toBe("7.25");
  });

  it("renders an empty cell as 0", () => {
    expect(formatHours(0)).toBe("0");
    expect(formatHours(NaN)).toBe("0");
  });
});
