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

  it("quotes a value with an embedded carriage return", () => {
    // A lone \r would otherwise mis-split the row in a \r-aware CSV reader.
    expect(csvCell("line1\rline2")).toBe('"line1\rline2"');
  });

  it("doubles embedded double-quotes and wraps the whole cell", () => {
    expect(csvCell('he said "hi"')).toBe('"he said ""hi"""');
    expect(csvCell('"')).toBe('""""');
  });

  it("handles a value with commas, quotes and newlines together", () => {
    expect(csvCell('a,"b"\nc')).toBe('"a,""b""\nc"');
  });

  describe("neutralizes spreadsheet formula-injection prefixes", () => {
    it("prepends a single quote to a leading = + - @ TAB CR (formula-shaped)", () => {
      expect(csvCell("=1+1")).toBe("'=1+1");
      expect(csvCell("+1+2")).toBe("'+1+2");
      expect(csvCell("-1+2")).toBe("'-1+2"); // leading minus that isn't a plain number
      expect(csvCell("@SUM(A1)")).toBe("'@SUM(A1)");
      expect(csvCell("\t9")).toBe("'\t9"); // leading TAB branch
    });

    it("does NOT prefix a well-formed number (would corrupt exported totals)", () => {
      expect(csvCell("-42.50")).toBe("-42.50"); // negative money cell stays numeric
      expect(csvCell("-1")).toBe("-1");
      expect(csvCell("1234.00")).toBe("1234.00");
      expect(csvCell("0")).toBe("0");
    });

    it("leaves a normal value unchanged", () => {
      expect(csvCell("hello")).toBe("hello");
    });

    it("still quotes a value that needs CSV quoting", () => {
      // Neutralized (leading =) AND contains a comma, so it is also wrapped.
      expect(csvCell("=SUM(A1,A2)")).toBe('"\'=SUM(A1,A2)"');
      // Formula prefix AND an embedded quote: prefix first, then double+wrap.
      expect(csvCell('=a"b')).toBe('"\'=a""b"');
      // Plain value with a comma is quoted but not prefixed.
      expect(csvCell("a,b")).toBe('"a,b"');
    });
  });
});
