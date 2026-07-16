import { describe, it, expect } from "vitest";
import { resolvePayPeriod, payrollByContractor } from "@/lib/payroll";

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
  const rateByPair = new Map<string, { pay_rate: number | null; bill_rate?: number | null }>([
    ["u1:p1", { pay_rate: 50, bill_rate: 100 }],
    ["u1:p2", { pay_rate: 40, bill_rate: null }], // overhead — still paid the contractor
    ["u2:p1", { pay_rate: null }], // no pay rate on file
  ]);
  const rows = [
    { user_id: "u1", project_id: "p1", hours: 10, profiles: { full_name: "Alice" }, projects: { name: "Proj 1" } },
    { user_id: "u1", project_id: "p1", hours: 2.5, profiles: { full_name: "Alice" }, projects: { name: "Proj 1" } },
    { user_id: "u1", project_id: "p2", hours: 4, profiles: { full_name: "Alice" }, projects: { name: "Proj 2" } },
    { user_id: "u2", project_id: "p1", hours: 8, profiles: { full_name: "Bob" }, projects: { name: "Proj 1" } },
    { user_id: "u1", project_id: "p1", hours: 0, profiles: { full_name: "Alice" }, projects: { name: "Proj 1" } }, // ignored
  ];

  it("sums hours × pay_rate per contractor with a per-project breakdown", () => {
    const out = payrollByContractor(rows, rateByPair);
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
    const out = payrollByContractor(rows, rateByPair);
    const bob = out.find((r) => r.user_id === "u2")!;
    expect(bob.amount_cents).toBe(0);
    expect(bob.hours).toBe(8);
    expect(bob.hasMissingRate).toBe(true);
    expect(bob.projects[0].pay_rate).toBeNull();
  });

  it("sorts contractors by payout, highest first", () => {
    const out = payrollByContractor(rows, rateByPair);
    expect(out.map((r) => r.user_id)).toEqual(["u1", "u2"]);
  });

  it("rounds once on the summed line, avoiding per-row float drift", () => {
    const rate = new Map([["u3:p1", { pay_rate: 100 }]]);
    const drifty = [
      { user_id: "u3", project_id: "p1", hours: 0.1, profiles: { full_name: "C" }, projects: { name: "P" } },
      { user_id: "u3", project_id: "p1", hours: 0.1, profiles: { full_name: "C" }, projects: { name: "P" } },
      { user_id: "u3", project_id: "p1", hours: 0.1, profiles: { full_name: "C" }, projects: { name: "P" } },
    ];
    // 0.3h × $100 = $30.00 exactly, despite 0.1+0.1+0.1 !== 0.3 in binary float
    expect(payrollByContractor(drifty, rate)[0].amount_cents).toBe(3000);
  });

  it("falls back to a dash name and returns [] for no rows", () => {
    const out = payrollByContractor(
      [{ user_id: "x", project_id: "p1", hours: 1 }],
      new Map([["x:p1", { pay_rate: 10 }]])
    );
    expect(out[0].name).toBe("—");
    expect(out[0].email).toBeNull();
    expect(payrollByContractor([], rateByPair)).toEqual([]);
  });
});
