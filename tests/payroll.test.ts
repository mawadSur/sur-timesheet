import { describe, it, expect } from "vitest";
import { resolvePayPeriod, payrollByContractor } from "@/lib/payroll";
import { buildRateHistoryByPair } from "@/lib/books";

describe("resolvePayPeriod", () => {
  it("defaults to the first half when now is on/before the 15th", () => {
    const p = resolvePayPeriod(null, new Date(2026, 6, 10)); // Jul 10, 2026
    expect(p.key).toBe("2026-07-1");
    expect(p.half).toBe(1);
    expect(p.start).toBe("2026-07-01");
    expect(p.end).toBe("2026-07-15");
    expect(p.payDate).toBe("2026-07-15");
    expect(p.label).toBe("Jul 1–15, 2026");
    expect(p.payLabel).toBe("paid Jul 15");
    expect(p.prevKey).toBe("2026-06-2");
    expect(p.nextKey).toBe("2026-07-2");
  });

  it("defaults to the second half when now is after the 15th", () => {
    const p = resolvePayPeriod(null, new Date(2026, 6, 16)); // Jul 16, 2026
    expect(p.key).toBe("2026-07-2");
    expect(p.start).toBe("2026-07-16");
    expect(p.end).toBe("2026-07-31");
    expect(p.payDate).toBe("2026-07-31");
    expect(p.prevKey).toBe("2026-07-1");
    expect(p.nextKey).toBe("2026-08-1");
  });

  it("treats the 15th as first half and the 16th as second half (boundary)", () => {
    expect(resolvePayPeriod(null, new Date(2026, 6, 15)).half).toBe(1);
    expect(resolvePayPeriod(null, new Date(2026, 6, 16)).half).toBe(2);
  });

  it("wraps to the previous year from January's first half", () => {
    const p = resolvePayPeriod("2026-01-1");
    expect(p.prevKey).toBe("2025-12-2");
    expect(p.nextKey).toBe("2026-01-2");
  });

  it("wraps to the next year from December's second half", () => {
    const p = resolvePayPeriod("2026-12-2");
    expect(p.end).toBe("2026-12-31");
    expect(p.nextKey).toBe("2027-01-1");
    expect(p.prevKey).toBe("2026-12-1");
  });

  it("ends the second half on the real last day of the month (non-leap Feb)", () => {
    expect(resolvePayPeriod("2026-02-2").end).toBe("2026-02-28");
  });

  it("ends the second half on Feb 29 in a leap year", () => {
    expect(resolvePayPeriod("2024-02-2").end).toBe("2024-02-29");
  });

  it("falls back to the now-default on a malformed or out-of-range param", () => {
    expect(resolvePayPeriod("2026-13-1", new Date(2026, 6, 10)).key).toBe("2026-07-1");
    expect(resolvePayPeriod("2026-07-3", new Date(2026, 6, 20)).key).toBe("2026-07-2"); // bad half
    expect(resolvePayPeriod("garbage", new Date(2026, 6, 20)).key).toBe("2026-07-2");
  });
});

describe("payrollByContractor", () => {
  // Rates effective from the epoch, so every work_date prices the same.
  const rateHistory = buildRateHistoryByPair(
    [
      { id: "a1", user_id: "u1", project_id: "p1" },
      { id: "a2", user_id: "u1", project_id: "p2" },
      // u2:p1 has no rate row on file -> missing
    ],
    [
      { assignment_id: "a1", bill_rate: 100, pay_rate: 50, effective_from: "1970-01-01" },
      { assignment_id: "a2", bill_rate: null, pay_rate: 40, effective_from: "1970-01-01" },
    ]
  );
  const wd = "2026-07-01";
  const rows = [
    { work_date: wd, user_id: "u1", project_id: "p1", hours: 10, profiles: { full_name: "Alice" }, projects: { name: "Proj 1" } },
    { work_date: wd, user_id: "u1", project_id: "p1", hours: 2.5, profiles: { full_name: "Alice" }, projects: { name: "Proj 1" } },
    { work_date: wd, user_id: "u1", project_id: "p2", hours: 4, profiles: { full_name: "Alice" }, projects: { name: "Proj 2" } },
    { work_date: wd, user_id: "u2", project_id: "p1", hours: 8, profiles: { full_name: "Bob" }, projects: { name: "Proj 1" } },
    { work_date: wd, user_id: "u1", project_id: "p1", hours: 0, profiles: { full_name: "Alice" }, projects: { name: "Proj 1" } }, // ignored
  ];

  it("sums hours × pay_rate per contractor with a per-project breakdown", () => {
    const out = payrollByContractor(rows, rateHistory);
    const alice = out.find((r) => r.user_id === "u1")!;
    // p1: 12.5h × $50 = $625.00; p2: 4h × $40 = $160.00 -> $785.00 total, 16.5h
    expect(alice.amount_cents).toBe(78500);
    expect(alice.hours).toBe(16.5);
    expect(alice.hasMissingRate).toBe(false);
    expect(alice.projects.map((l) => [l.project_name, l.hours, l.amount_cents])).toEqual([
      ["Proj 1", 12.5, 62500],
      ["Proj 2", 4, 16000],
    ]);
  });

  it("flags hours logged with no pay rate instead of pricing them", () => {
    const out = payrollByContractor(rows, rateHistory);
    const bob = out.find((r) => r.user_id === "u2")!;
    expect(bob.amount_cents).toBe(0);
    expect(bob.hours).toBe(8);
    expect(bob.hasMissingRate).toBe(true);
    expect(bob.projects[0].pay_rate).toBeNull();
    expect(bob.projects[0].missingRate).toBe(true);
  });

  it("sorts contractors by payout, highest first", () => {
    expect(payrollByContractor(rows, rateHistory).map((r) => r.user_id)).toEqual(["u1", "u2"]);
  });

  it("rounds once per (project, rate) group, avoiding per-row float drift", () => {
    const hist = buildRateHistoryByPair(
      [{ id: "a1", user_id: "u3", project_id: "p1" }],
      [{ assignment_id: "a1", bill_rate: null, pay_rate: 100, effective_from: "1970-01-01" }]
    );
    const drifty = Array.from({ length: 3 }, () => ({
      work_date: wd, user_id: "u3", project_id: "p1", hours: 0.1, profiles: { full_name: "C" }, projects: { name: "P" },
    }));
    // 0.3h × $100 = $30.00 exactly, despite 0.1+0.1+0.1 !== 0.3 in binary float
    expect(payrollByContractor(drifty, hist)[0].amount_cents).toBe(3000);
  });

  it("prices each hour at its as-of rate and marks a project mixed when the rate changed", () => {
    const hist = buildRateHistoryByPair(
      [{ id: "a1", user_id: "u1", project_id: "p1" }],
      [
        { assignment_id: "a1", bill_rate: null, pay_rate: 50, effective_from: "2026-01-01" },
        { assignment_id: "a1", bill_rate: null, pay_rate: 60, effective_from: "2026-07-01" }, // a raise
      ]
    );
    const rows2 = [
      { work_date: "2026-06-30", user_id: "u1", project_id: "p1", hours: 10, profiles: { full_name: "Al" }, projects: { name: "P" } }, // @50
      { work_date: "2026-07-05", user_id: "u1", project_id: "p1", hours: 4, profiles: { full_name: "Al" }, projects: { name: "P" } }, // @60
    ];
    const line = payrollByContractor(rows2, hist)[0].projects[0];
    expect(line.amount_cents).toBe(74000); // 10×$50 + 4×$60 = $740.00
    expect(line.hours).toBe(14);
    expect(line.mixedRate).toBe(true);
    expect(line.pay_rate).toBeNull();
  });

  it("falls back to a dash name and returns [] for no rows", () => {
    const hist = buildRateHistoryByPair(
      [{ id: "a1", user_id: "x", project_id: "p1" }],
      [{ assignment_id: "a1", bill_rate: null, pay_rate: 10, effective_from: "1970-01-01" }]
    );
    const out = payrollByContractor([{ work_date: wd, user_id: "x", project_id: "p1", hours: 1 }], hist);
    expect(out[0].name).toBe("—");
    expect(out[0].email).toBeNull();
    expect(payrollByContractor([], rateHistory)).toEqual([]);
  });
});
