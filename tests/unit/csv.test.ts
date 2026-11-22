import { describe, expect, it } from "vitest";
import { csvCell, parseCsv, restoreFormula, toCsv } from "@/lib/csv";

describe("CSV writing", () => {
  it("neutralises formula payloads", () => {
    for (const p of ["=HYPERLINK(\"http://x\")", "+1+1", "-2+3", "@SUM(A1)", "\tcmd", "\r=1"]) {
      const c = csvCell(p);
      expect(c.replace(/^"/, "").startsWith("'")).toBe(true);
    }
    expect(csvCell("normal note")).toBe("normal note");
  });
  it("quotes commas, quotes, newlines and edge spaces", () => {
    expect(csvCell("a,b")).toBe('"a,b"');
    expect(csvCell('say "hi"')).toBe('"say ""hi"""');
    expect(csvCell("line1\nline2")).toBe('"line1\nline2"');
    expect(csvCell(" padded ")).toBe('" padded "');
  });
});

describe("CSV round trip", () => {
  it("preserves Unicode, commas, quotes, newlines and formula text", () => {
    const rows = [
      ["date", "note"],
      ["2026-01-01", "चाय, समोसा ☕"],
      ["2026-01-02", 'He said "₹500"'],
      ["2026-01-03", "multi\nline\r\nnote"],
      ["2026-01-04", "=1+2"],
      ["2026-01-05", ""],
    ];
    const text = toCsv(rows);
    expect(text.startsWith("﻿")).toBe(true);
    const parsed = parseCsv(text);
    if (!parsed.ok) throw new Error(parsed.error);
    expect(parsed.rows.map((r) => r.map(restoreFormula))).toEqual(rows);
    expect(parsed.rows[4][1]).toBe("'=1+2"); // inert in the file itself
  });
  it("reports malformed input and row limits", () => {
    expect(parseCsv('a,"b').ok).toBe(false);
    expect(parseCsv('a,"b"x').ok).toBe(false);
    expect(parseCsv("a\nb\nc\n", 2).ok).toBe(false);
    expect(parseCsv("a\nb\n", 2).ok).toBe(true);
  });
});
