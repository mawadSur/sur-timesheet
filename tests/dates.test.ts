import { describe, it, expect } from "vitest";
import { isEnded, projectPhase } from "../lib/dates";

// Fixed "today" built from local Y/M/D parts so getFullYear/Month/Date are stable
// regardless of the runner's timezone (2026-07-07).
const TODAY = new Date(2026, 6, 7);

describe("isEnded", () => {
  it("is true only when the end date is strictly before today", () => {
    expect(isEnded("2026-07-06", TODAY)).toBe(true);
  });

  it("keeps a project ending today active (not ended)", () => {
    expect(isEnded("2026-07-07", TODAY)).toBe(false);
  });

  it("is false for a future end date", () => {
    expect(isEnded("2026-07-08", TODAY)).toBe(false);
    expect(isEnded("2027-01-01", TODAY)).toBe(false);
  });

  it("treats missing / invalid dates as not-ended", () => {
    expect(isEnded(null, TODAY)).toBe(false);
    expect(isEnded("", TODAY)).toBe(false);
    expect(isEnded("not-a-date", TODAY)).toBe(false);
  });

  it("accepts a full timestamp, comparing by calendar day", () => {
    expect(isEnded("2026-07-06T23:59:59Z", TODAY)).toBe(true);
    expect(isEnded("2026-07-07T00:00:00Z", TODAY)).toBe(false);
  });
});

describe("projectPhase", () => {
  it("is 'upcoming' before the start date", () => {
    expect(projectPhase("2026-08-01", null, TODAY)).toBe("upcoming");
    expect(projectPhase("2026-08-01", "2026-12-31", TODAY)).toBe("upcoming");
  });

  it("is 'active' within the window", () => {
    expect(projectPhase("2026-01-01", "2026-12-31", TODAY)).toBe("active");
  });

  it("is 'ended' once the end date has passed", () => {
    expect(projectPhase("2026-01-01", "2026-07-06", TODAY)).toBe("ended");
  });

  it("treats start today as active and end today as active (boundaries)", () => {
    expect(projectPhase("2026-07-07", null, TODAY)).toBe("active");
    expect(projectPhase(null, "2026-07-07", TODAY)).toBe("active");
  });

  it("defaults an open-ended (no dates) project to active", () => {
    expect(projectPhase(null, null, TODAY)).toBe("active");
  });

  it("lets 'ended' win over 'upcoming' when both apply", () => {
    // End already passed but start is in the future (inverted window): ended first.
    expect(projectPhase("2026-08-01", "2026-07-06", TODAY)).toBe("ended");
  });
});
