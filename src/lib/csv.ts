// Minimal RFC 4180 CSV writer/parser with spreadsheet formula-injection protection.

const FORMULA_START = /^[=+\-@\t\r]/;

/**
 * Makes a cell inert in spreadsheet apps: a value starting with = + - @ tab or CR
 * gets a leading apostrophe so Excel/Sheets/Numbers treat it as text.
 * Numbers we generate ourselves (amounts) never start with these characters.
 */
export function neutraliseFormula(v: string): string {
  return FORMULA_START.test(v) ? `'${v}` : v;
}

/** Reverses neutraliseFormula for cells we exported ourselves. */
export function restoreFormula(v: string): string {
  return v.length > 1 && v[0] === "'" && FORMULA_START.test(v.slice(1)) ? v.slice(1) : v;
}

export function csvCell(v: string | null | undefined): string {
  const s = neutraliseFormula(v ?? "");
  return /[",\r\n]/.test(s) || s !== s.trim() ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCsv(rows: (string | null | undefined)[][]): string {
  // BOM so spreadsheet apps detect UTF-8 (₹, Hindi names, emoji).
  return "﻿" + rows.map((r) => r.map(csvCell).join(",")).join("\r\n") + "\r\n";
}

export type CsvParseResult = { ok: true; rows: string[][] } | { ok: false; error: string };

/** Parses CSV text. Handles quoted fields, "" escapes, embedded newlines, CRLF and a BOM. */
export function parseCsv(text: string, maxRows = 10_000): CsvParseResult {
  const src = text.startsWith("﻿") ? text.slice(1) : text;
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let i = 0;
  let inQuotes = false;
  let fieldStart = true;
  while (i < src.length) {
    const c = src[i];
    if (inQuotes) {
      if (c === '"') {
        if (src[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i++;
        if (i < src.length && src[i] !== "," && src[i] !== "\n" && src[i] !== "\r") {
          return { ok: false, error: `Unexpected character after a closing quote on line ${rows.length + 1}.` };
        }
        continue;
      }
      field += c;
      i++;
      continue;
    }
    if (c === '"' && fieldStart) {
      inQuotes = true;
      fieldStart = false;
      i++;
      continue;
    }
    if (c === ",") {
      row.push(field);
      field = "";
      fieldStart = true;
      i++;
      continue;
    }
    if (c === "\r" || c === "\n") {
      row.push(field);
      if (!(row.length === 1 && row[0] === "")) rows.push(row);
      if (rows.length > maxRows) return { ok: false, error: `Too many rows. The limit is ${maxRows - 1} data rows per file.` };
      row = [];
      field = "";
      fieldStart = true;
      i += c === "\r" && src[i + 1] === "\n" ? 2 : 1;
      continue;
    }
    field += c;
    fieldStart = false;
    i++;
  }
  if (inQuotes) return { ok: false, error: "The file ends inside a quoted field." };
  if (field !== "" || row.length) {
    row.push(field);
    if (!(row.length === 1 && row[0] === "")) rows.push(row);
  }
  if (rows.length > maxRows) return { ok: false, error: `Too many rows. The limit is ${maxRows - 1} data rows per file.` };
  return { ok: true, rows };
}
