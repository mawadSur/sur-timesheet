import { describe, it, expect } from "vitest";
import { csvCell } from "../lib/csv";

describe("csvCell", () => {
  it("leaves a plain value untouched", () => {
    expect(csvCell("plain")).toBe("plain");
    expect(csvCell("hello world")).toBe("hello world");
  });

  it("coerces null / undefined to an empty string", () => {
    expect(csvCell(null)).toBe("");
    expect(csvCell(undefined)).toBe("");
  });

  it("stringifies non-string primitives", () => {
    expect(csvCell(123)).toBe("123");
    expect(csvCell(0)).toBe("0");
    expect(csvCell(true)).toBe("true");
  });

  it("quotes and wraps a value containing a comma", () => {
    expect(csvCell("a,b")).toBe('"a,b"');
    expect(csvCell("Doe, Jane")).toBe('"Doe, Jane"');
  });

  it("quotes a value with an embedded newline", () => {
    expect(csvCell("line1\nline2")).toBe('"line1\nline2"');
  });

  it("doubles embedded double-quotes and wraps the whole cell", () => {
    expect(csvCell('he said "hi"')).toBe('"he said ""hi"""');
    expect(csvCell('"')).toBe('""""');
  });

  it("handles a value with commas, quotes and newlines together", () => {
    expect(csvCell('a,"b"\nc')).toBe('"a,""b""\nc"');
  });

  // Documents CURRENT behavior: csvCell escapes for CSV parsing only — it has NO
  // spreadsheet formula-injection guard, so a value that starts with = + - @ is
  // returned verbatim unless it also contains a comma/quote/newline. See the
  // follow-up note; if a prefix guard is ever added these expectations change.
  it("does NOT neutralize formula-injection prefixes (no guard today)", () => {
    expect(csvCell("=1+1")).toBe("=1+1");
    expect(csvCell("+1")).toBe("+1");
    expect(csvCell("-1")).toBe("-1");
    expect(csvCell("@SUM(A1)")).toBe("@SUM(A1)");
    // A formula that also contains a comma is quoted for CSV reasons only.
    expect(csvCell("=SUM(A1,A2)")).toBe('"=SUM(A1,A2)"');
  });
});
