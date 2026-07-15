import { describe, it, expect } from "vitest";
import {
  usdCents,
  lineMoneyCents,
  buildRateByPair,
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

describe("buildRateByPair", () => {
  it("keys rates by user_id:project_id via the assignment id", () => {
    const assignments = [
      { id: "a1", user_id: "u1", project_id: "p1" },
      { id: "a2", user_id: "u2", project_id: "p1" },
      { id: "a3", user_id: "u3", project_id: "p1" }, // no rate row
    ];
    const rates = [
      { assignment_id: "a1", bill_rate: 100, pay_rate: 50 },
      { assignment_id: "a2", bill_rate: null, pay_rate: 40 },
    ];
    const map = buildRateByPair(assignments, rates);
    expect(map.get("u1:p1")).toEqual({ assignment_id: "a1", bill_rate: 100, pay_rate: 50 });
    expect(map.get("u2:p1")).toEqual({ assignment_id: "a2", bill_rate: null, pay_rate: 40 });
    expect(map.has("u3:p1")).toBe(false); // assignment with no rate is absent
  });

  it("returns an empty map for empty/null inputs", () => {
    expect(buildRateByPair(null, null).size).toBe(0);
    expect(buildRateByPair([], []).size).toBe(0);
    expect(buildRateByPair(undefined, undefined).size).toBe(0);
  });
});

describe("billableInvoiceLines", () => {
  const rateByPair = buildRateByPair(
    [
      { id: "a1", user_id: "u1", project_id: "p1" },
      { id: "a2", user_id: "u2", project_id: "p1" },
      { id: "a3", user_id: "u3", project_id: "p1" }, // overhead (no bill rate)
    ],
    [
      { assignment_id: "a1", bill_rate: 100, pay_rate: 50 },
      { assignment_id: "a2", bill_rate: 200, pay_rate: 80 },
      { assignment_id: "a3", bill_rate: null, pay_rate: 30 },
    ]
  );

  it("aggregates billable hours per consultant and sorts by amount desc", () => {
    const rows = [
      { user_id: "u1", project_id: "p1", hours: 10, profiles: { full_name: "Ann", email: "a@x" } },
      { user_id: "u1", project_id: "p1", hours: 5, profiles: { full_name: "Ann", email: "a@x" } },
      { user_id: "u2", project_id: "p1", hours: 4, profiles: { full_name: "Bob", email: "b@x" } },
      { user_id: "u3", project_id: "p1", hours: 8, profiles: { full_name: "Cy", email: "c@x" } }, // overhead → excluded
    ];
    const lines = billableInvoiceLines(rows, rateByPair);
    expect(lines).toHaveLength(2);
    // u1: 15 h × $100 = $1500 = 150000c ; u2: 4 h × $200 = $800 = 80000c
    expect(lines[0]).toMatchObject({ user_id: "u1", name: "Ann", hours: 15, bill_rate: 100, amount_cents: 150000 });
    expect(lines[1]).toMatchObject({ user_id: "u2", name: "Bob", hours: 4, bill_rate: 200, amount_cents: 80000 });
  });

  it("falls back to email then em-dash for the display name", () => {
    const rows = [
      { user_id: "u1", project_id: "p1", hours: 1, profiles: { full_name: null, email: "a@x" } },
    ];
    expect(billableInvoiceLines(rows, rateByPair)[0].name).toBe("a@x");
  });

  it("returns an empty array for no rows or only-overhead rows", () => {
    expect(billableInvoiceLines([], rateByPair)).toEqual([]);
    const overheadOnly = [{ user_id: "u3", project_id: "p1", hours: 8, profiles: { full_name: "Cy" } }];
    expect(billableInvoiceLines(overheadOnly, rateByPair)).toEqual([]);
  });

  it("sums integer cents across many lines without float drift", () => {
    const rows = Array.from({ length: 3 }, () => ({
      user_id: "u1",
      project_id: "p1",
      hours: 0.1,
      profiles: { full_name: "Ann" },
    }));
    // Each line: 0.1 h × $100 × 100 = 1000c → 3 lines = 3000c
    expect(billableInvoiceLines(rows, rateByPair)[0].amount_cents).toBe(3000);
  });
});

describe("dollarsToCents", () => {
  it("parses plain dollar amounts to integer cents (half-up)", () => {
    expect(dollarsToCents("149.99")).toBe(14999);
    expect(dollarsToCents("25000")).toBe(2500000);
    expect(dollarsToCents("0.005")).toBe(1); // 0.5c rounds half-up to 1c
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
