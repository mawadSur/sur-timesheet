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

  describe("neutralizes spreadsheet formula-injection prefixes", () => {
    it("prepends a single quote to a leading = + - @", () => {
      expect(csvCell("=1+1")).toBe("'=1+1");
      expect(csvCell("+1")).toBe("'+1");
      expect(csvCell("-1")).toBe("'-1");
      expect(csvCell("@SUM(A1)")).toBe("'@SUM(A1)");
    });

    it("leaves a normal value unchanged", () => {
      expect(csvCell("hello")).toBe("hello");
    });

    it("still quotes a value that needs CSV quoting", () => {
      // Neutralized (leading =) AND contains a comma, so it is also wrapped.
      expect(csvCell("=SUM(A1,A2)")).toBe('"\'=SUM(A1,A2)"');
      // Plain value with a comma is quoted but not prefixed.
      expect(csvCell("a,b")).toBe('"a,b"');
    });
  });
});
