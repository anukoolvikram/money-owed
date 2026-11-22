import { describe, expect, it } from "vitest";
import { formatINR, fromPaiseString, MAX_PAISE, paiseToInput, parseRupees, toPaiseString } from "@/lib/money";

const ok = (s: string, opts?: Parameters<typeof parseRupees>[1]) => {
  const r = parseRupees(s, opts);
  if (!r.ok) throw new Error(`expected ok for ${s}: ${r.error}`);
  return r.paise;
};
const err = (v: unknown, opts?: Parameters<typeof parseRupees>[1]) => {
  const r = parseRupees(v, opts);
  expect(r.ok, `expected error for ${String(v)}`).toBe(false);
  return r.ok ? "" : r.error;
};

describe("parseRupees", () => {
  it("parses whole and decimal amounts exactly", () => {
    expect(ok("250")).toBe(25000n);
    expect(ok("99.5")).toBe(9950n);
    expect(ok("99.50")).toBe(9950n);
    expect(ok("0.01")).toBe(1n);
    expect(ok("₹ 1,500.75")).toBe(150075n);
    expect(ok("1,00,000")).toBe(10000000n);
    expect(ok("100,000")).toBe(10000000n);
    expect(ok("  42  ")).toBe(4200n);
  });

  it("0.10 + 0.20 is exactly 0.30", () => {
    expect(ok("0.10") + ok("0.20")).toBe(ok("0.30"));
    expect(formatINR(ok("0.10") + ok("0.20"))).toBe("₹0.30");
  });

  it("rejects invalid input", () => {
    err("");
    err("   ");
    err(undefined);
    err(12 as unknown);
    expect(err("1.234")).toMatch(/two decimal/);
    expect(err("1e5")).toMatch(/Scientific/);
    err("NaN");
    err("Infinity");
    err("abc");
    err("1.2.3");
    err("12,34");
    err("1,5000");
    err("--5");
    err("0x10");
    expect(err("0")).toMatch(/more than zero/);
    expect(err("0.00")).toMatch(/more than zero/);
    expect(err("-5")).toMatch(/positive/);
  });

  it("enforces the supported maximum", () => {
    expect(ok("10000000000")).toBe(MAX_PAISE); // ₹1,000 crore
    expect(err("10000000000.01")).toMatch(/maximum/);
    expect(err("99999999999999999999")).toMatch(/maximum/);
  });

  it("supports signed and zero values when allowed", () => {
    expect(ok("-1500", { allowNegative: true })).toBe(-150000n);
    expect(ok("0", { allowZero: true })).toBe(0n);
    expect(ok("-0", { allowZero: true, allowNegative: true })).toBe(0n);
    expect(err("-10000000000.01", { allowNegative: true })).toMatch(/maximum/);
  });
});

describe("formatting and transport", () => {
  it("formats with Indian grouping", () => {
    expect(formatINR(0n)).toBe("₹0.00");
    expect(formatINR(123456789n)).toBe("₹12,34,567.89");
    expect(formatINR(MAX_PAISE)).toBe("₹10,00,00,00,000.00");
    expect(formatINR(-50000n)).toBe("−₹500.00");
    expect(formatINR(50000n, { sign: "always" })).toBe("+₹500.00");
  });
  it("round-trips through form input strings", () => {
    for (const p of [0n, 1n, 10n, 9950n, 25000n, -150075n, MAX_PAISE]) {
      expect(ok(paiseToInput(p), { allowZero: true, allowNegative: true })).toBe(p);
    }
  });
  it("serialises bigints safely as strings across JSON", () => {
    const payload = JSON.stringify({ amount: toPaiseString(MAX_PAISE) });
    expect(payload).toBe('{"amount":"1000000000000"}');
    expect(fromPaiseString(JSON.parse(payload).amount)).toBe(MAX_PAISE);
    expect(() => fromPaiseString("1.5")).toThrow();
    expect(() => fromPaiseString("1e3")).toThrow();
    expect(() => JSON.stringify({ a: 1n })).toThrow(); // why we never send raw bigints
  });
});
