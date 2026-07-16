import { describe, it, expect } from "vitest";
import {
  usdCents,
  lineMoneyCents,
  buildRateHistoryByPair,
  rateAsOf,
  latestRateByAssignment,
  resolveMonthWindow,
  billableInvoiceLines,
  dollarsToCents,
  sumExpenseCents,
} from "../lib/books";

describe("usdCents", () => {
  it("formats positive integer cents as USD with thousands separators", () => {
    expect(usdCents(0)).toBe("$0.00");
    expect(usdCents(5)).toBe("$0.05");
    expect(usdCents(123400)).toBe("$1,234.00");
    expect(usdCents(100000000)).toBe("$1,000,000.00");
  });

  it("puts the sign outside the dollar symbol for negatives", () => {
    expect(usdCents(-123400)).toBe("-$1,234.00");
    expect(usdCents(-1)).toBe("-$0.01");
  });
});

describe("resolveMonthWindow", () => {
  it("resolves a valid month to first/last calendar day", () => {
    const w = resolveMonthWindow("2026-02");
    expect(w).toMatchObject({ month: "2026-02", start: "2026-02-01", end: "2026-02-28", y: 2026, m: 2 });
  });

  it("handles a leap-year February (29 days)", () => {
    expect(resolveMonthWindow("2024-02").end).toBe("2024-02-29");
  });

  it("handles 31- and 30-day months", () => {
    expect(resolveMonthWindow("2026-01").end).toBe("2026-01-31");
    expect(resolveMonthWindow("2026-04").end).toBe("2026-04-30");
  });

  it("falls back to the current month for malformed / out-of-range input", () => {
    // All invalid inputs must collapse to the same default window.
    const def = resolveMonthWindow(null);
    for (const bad of ["2026-13", "2026-00", "2026-1", "garbage", "", undefined]) {
      const w = resolveMonthWindow(bad as string | null | undefined);
      expect(w.month).toBe(def.month);
      expect(w.start).toBe(def.start);
      expect(w.end).toBe(def.end);
    }
    // And the default is itself a well-formed window.
    expect(def.month).toMatch(/^\d{4}-(0[1-9]|1[0-2])$/);
    expect(def.start).toBe(`${def.month}-01`);
  });
});

describe("lineMoneyCents", () => {
  it("treats both-rates-present as billable (revenue + billable cost)", () => {
    const m = lineMoneyCents(10, { bill_rate: 100, pay_rate: 50 });
    expect(m).toMatchObject({
      billable: true,
      missingPay: false,
      revCents: 100000,
      billableCostCents: 50000,
      overheadCents: null,
    });
  });

  it("treats pay-only (no bill rate) as overhead cost, never revenue", () => {
    const m = lineMoneyCents(10, { bill_rate: null, pay_rate: 50 });
    expect(m).toMatchObject({
      billable: false,
      missingPay: false,
      revCents: null,
      billableCostCents: null,
      overheadCents: 50000,
    });
  });

  it("flags a missing pay rate (the only incomplete state)", () => {
    const m = lineMoneyCents(10, { bill_rate: 100, pay_rate: null });
    expect(m.missingPay).toBe(true);
    expect(m.billable).toBe(false);
    expect(m.revCents).toBeNull();
    expect(m.billableCostCents).toBeNull();
    expect(m.overheadCents).toBeNull();
  });

  it("treats an undefined rate as missing pay", () => {
    const m = lineMoneyCents(5, undefined);
    expect(m.missingPay).toBe(true);
    expect(m.billable).toBe(false);
    expect(m.revCents).toBeNull();
    expect(m.overheadCents).toBeNull();
  });

  it("rounds to integer cents (half rounds up)", () => {
    // 3 h × $10.335 × 100 = 3100.5 cents → 3101
    expect(lineMoneyCents(3, { bill_rate: 10.335, pay_rate: 1 }).revCents).toBe(3101);
    // overhead rounding: 3 h × $10.335 × 100 → 3101
    expect(lineMoneyCents(3, { bill_rate: null, pay_rate: 10.335 }).overheadCents).toBe(3101);
  });

  it("handles zero hours", () => {
    const m = lineMoneyCents(0, { bill_rate: 100, pay_rate: 50 });
    expect(m.revCents).toBe(0);
    expect(m.billableCostCents).toBe(0);
  });
});

describe("buildRateHistoryByPair + rateAsOf", () => {
  const assignments = [
    { id: "a1", user_id: "u1", project_id: "p1" },
    { id: "a2", user_id: "u2", project_id: "p1" },
    { id: "a3", user_id: "u3", project_id: "p1" }, // no rate row
  ];
  const rates = [
    { assignment_id: "a1", bill_rate: 100, pay_rate: 50, effective_from: "2026-01-01" },
    { assignment_id: "a1", bill_rate: 120, pay_rate: 60, effective_from: "2026-06-01" }, // a raise
    { assignment_id: "a2", bill_rate: null, pay_rate: 40, effective_from: "2026-01-01" },
  ];

  it("keys rate history by user_id:project_id, newest effective_from first", () => {
    const map = buildRateHistoryByPair(assignments, rates);
    expect(map.get("u1:p1")?.map((r) => r.effective_from)).toEqual(["2026-06-01", "2026-01-01"]);
    expect(map.get("u2:p1")).toHaveLength(1);
    expect(map.has("u3:p1")).toBe(false); // assignment with no rate is absent
  });

  it("rateAsOf returns the rate in effect on the work date", () => {
    const h = buildRateHistoryByPair(assignments, rates).get("u1:p1");
    expect(rateAsOf(h, "2026-05-31")).toEqual({ bill_rate: 100, pay_rate: 50 }); // before the raise
    expect(rateAsOf(h, "2026-06-01")).toEqual({ bill_rate: 120, pay_rate: 60 }); // on the raise day
    expect(rateAsOf(h, "2026-09-01")).toEqual({ bill_rate: 120, pay_rate: 60 }); // after
  });

  it("rateAsOf is undefined before any rate took effect, or with no history", () => {
    const map = buildRateHistoryByPair(assignments, rates);
    expect(rateAsOf(map.get("u1:p1"), "2025-12-31")).toBeUndefined();
    expect(rateAsOf(undefined, "2026-06-01")).toBeUndefined();
  });

  it("returns an empty map for empty/null inputs", () => {
    expect(buildRateHistoryByPair(null, null).size).toBe(0);
    expect(buildRateHistoryByPair([], []).size).toBe(0);
    expect(buildRateHistoryByPair(undefined, undefined).size).toBe(0);
  });
});

describe("latestRateByAssignment", () => {
  it("picks the newest rate on or before the as-of date, ignoring future rows", () => {
    const rates = [
      { assignment_id: "a1", bill_rate: 100, pay_rate: 50, effective_from: "2026-01-01" },
      { assignment_id: "a1", bill_rate: 120, pay_rate: 60, effective_from: "2026-06-01" },
      { assignment_id: "a1", bill_rate: 999, pay_rate: 999, effective_from: "2027-01-01" }, // future
    ];
    expect(latestRateByAssignment(rates, "2026-07-01").get("a1")).toEqual({ bill_rate: 120, pay_rate: 60 });
    expect(latestRateByAssignment(rates, "2025-01-01").has("a1")).toBe(false); // before any rate
  });
});

describe("billableInvoiceLines", () => {
  const rateHistory = buildRateHistoryByPair(
    [
      { id: "a1", user_id: "u1", project_id: "p1" },
      { id: "a2", user_id: "u2", project_id: "p1" },
      { id: "a3", user_id: "u3", project_id: "p1" }, // overhead (no bill rate)
    ],
    [
      { assignment_id: "a1", bill_rate: 100, pay_rate: 50, effective_from: "1970-01-01" },
      { assignment_id: "a2", bill_rate: 200, pay_rate: 80, effective_from: "1970-01-01" },
      { assignment_id: "a3", bill_rate: null, pay_rate: 30, effective_from: "1970-01-01" },
    ]
  );
  const wd = "2026-07-01"; // any date; these rates are effective from the epoch

  it("aggregates billable hours per consultant and sorts by amount desc", () => {
    const rows = [
      { work_date: wd, user_id: "u1", project_id: "p1", hours: 10, profiles: { full_name: "Ann", email: "a@x" } },
      { work_date: wd, user_id: "u1", project_id: "p1", hours: 5, profiles: { full_name: "Ann", email: "a@x" } },
      { work_date: wd, user_id: "u2", project_id: "p1", hours: 4, profiles: { full_name: "Bob", email: "b@x" } },
      { work_date: wd, user_id: "u3", project_id: "p1", hours: 8, profiles: { full_name: "Cy", email: "c@x" } }, // overhead → excluded
    ];
    const lines = billableInvoiceLines(rows, rateHistory);
    expect(lines).toHaveLength(2);
    // u1: 15 h × $100 = $1500 = 150000c ; u2: 4 h × $200 = $800 = 80000c
    expect(lines[0]).toMatchObject({ user_id: "u1", name: "Ann", hours: 15, bill_rate: 100, amount_cents: 150000 });
    expect(lines[1]).toMatchObject({ user_id: "u2", name: "Bob", hours: 4, bill_rate: 200, amount_cents: 80000 });
  });

  it("splits a consultant into per-rate lines when the bill rate changed mid-period", () => {
    const hist = buildRateHistoryByPair(
      [{ id: "a1", user_id: "u1", project_id: "p1" }],
      [
        { assignment_id: "a1", bill_rate: 100, pay_rate: 50, effective_from: "2026-01-01" },
        { assignment_id: "a1", bill_rate: 120, pay_rate: 60, effective_from: "2026-07-01" },
      ]
    );
    const rows = [
      { work_date: "2026-06-30", user_id: "u1", project_id: "p1", hours: 10, profiles: { full_name: "Ann" } }, // @100
      { work_date: "2026-07-05", user_id: "u1", project_id: "p1", hours: 4, profiles: { full_name: "Ann" } }, // @120
    ];
    const lines = billableInvoiceLines(rows, hist).sort((a, b) => a.bill_rate - b.bill_rate);
    expect(lines).toHaveLength(2);
    expect(lines[0]).toMatchObject({ bill_rate: 100, hours: 10, amount_cents: 100000 });
    expect(lines[1]).toMatchObject({ bill_rate: 120, hours: 4, amount_cents: 48000 });
  });

  it("falls back to email then em-dash for the display name", () => {
    const rows = [
      { work_date: wd, user_id: "u1", project_id: "p1", hours: 1, profiles: { full_name: null, email: "a@x" } },
    ];
    expect(billableInvoiceLines(rows, rateHistory)[0].name).toBe("a@x");
  });

  it("returns an empty array for no rows or only-overhead rows", () => {
    expect(billableInvoiceLines([], rateHistory)).toEqual([]);
    const overheadOnly = [{ work_date: wd, user_id: "u3", project_id: "p1", hours: 8, profiles: { full_name: "Cy" } }];
    expect(billableInvoiceLines(overheadOnly, rateHistory)).toEqual([]);
  });

  it("sums integer cents across many lines without float drift", () => {
    const rows = Array.from({ length: 3 }, () => ({
      work_date: wd,
      user_id: "u1",
      project_id: "p1",
      hours: 0.1,
      profiles: { full_name: "Ann" },
    }));
    // Each line: 0.1 h × $100 × 100 = 1000c → 3 lines = 3000c
    expect(billableInvoiceLines(rows, rateHistory)[0].amount_cents).toBe(3000);
  });
});

describe("dollarsToCents", () => {
  it("parses plain dollar amounts to integer cents (half-up)", () => {
    expect(dollarsToCents("149.99")).toBe(14999);
    expect(dollarsToCents("25000")).toBe(2500000);
    expect(dollarsToCents("0.005")).toBe(1); // 0.5c rounds half-up to 1c
    // Sub-cent inputs whose *100 lands just below .5 in binary float must still
    // round half-up (regression guard for the toFixed pre-round).
    expect(dollarsToCents("1.005")).toBe(101); // 1.005*100 === 100.4999999… -> 101
    expect(dollarsToCents("0.145")).toBe(15);
  });

  it("tolerates '$' and thousands separators", () => {
    expect(dollarsToCents("$1,250.50")).toBe(125050);
    expect(dollarsToCents(" $ 42 ")).toBe(4200);
  });

  it("returns null for blank / invalid / negative / absurd input", () => {
    expect(dollarsToCents("")).toBeNull();
    expect(dollarsToCents("   ")).toBeNull();
    expect(dollarsToCents(null)).toBeNull();
    expect(dollarsToCents(undefined)).toBeNull();
    expect(dollarsToCents("abc")).toBeNull();
    expect(dollarsToCents("-5")).toBeNull();
    expect(dollarsToCents("2000000000")).toBeNull(); // > 1e9 ceiling
  });
});

describe("sumExpenseCents", () => {
  it("totals amount_cents as integers with no float drift", () => {
    expect(sumExpenseCents([{ amount_cents: 14999 }, { amount_cents: 1 }, { amount_cents: 100000 }])).toBe(115000);
  });

  it("coerces string amounts and skips null/garbage", () => {
    expect(sumExpenseCents([{ amount_cents: "500" }, { amount_cents: null }, { amount_cents: undefined }])).toBe(500);
  });

  it("returns 0 for empty / null / undefined", () => {
    expect(sumExpenseCents([])).toBe(0);
    expect(sumExpenseCents(null)).toBe(0);
    expect(sumExpenseCents(undefined)).toBe(0);
  });
});
