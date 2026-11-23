import { describe, expect, it } from "vitest";
import { checkPassphrase } from "@/server/auth/password-policy";
import { lockSecondsFor, normaliseEmail, throttleKey } from "@/server/auth/login-throttle";
import { accountDelta, describeIou, iouDelta } from "@/lib/txn-types";
import { iouTotals } from "@/server/services/ledger-sql";
import { needsCrossZeroConfirm } from "@/server/services/transactions";
import { budgetStatus } from "@/server/services/budgets";

describe("password policy", () => {
  it("accepts any non-empty password up to the max length", () => {
    expect(checkPassphrase("a").ok).toBe(true);
    expect(checkPassphrase("123456").ok).toBe(true);
    expect(checkPassphrase("").ok).toBe(false);
    expect(checkPassphrase("x".repeat(129)).ok).toBe(false);
  });
});

describe("login throttle", () => {
  it("is progressive and capped, never permanent", () => {
    expect(lockSecondsFor(4)).toBe(0);
    expect(lockSecondsFor(5)).toBe(30);
    expect(lockSecondsFor(6)).toBe(60);
    expect(lockSecondsFor(100)).toBe(900);
  });
  it("normalises the account key", () => {
    expect(normaliseEmail("  Owner@Example.COM ")).toBe("owner@example.com");
    expect(throttleKey("Owner@Example.com", "s")).toBe(throttleKey(" owner@example.com", "s"));
    expect(throttleKey("owner@example.com", "s")).not.toContain("owner");
  });
});

describe("transaction effects", () => {
  const t = (type: Parameters<typeof iouDelta>[0], amount = 100n) => ({ type, amountPaise: amount, accountId: "A", toAccountId: type === "transfer" ? "B" : null });
  it("matches the effects table", () => {
    expect(accountDelta(t("expense"), "A")).toBe(-100n);
    expect(accountDelta(t("income"), "A")).toBe(100n);
    expect(accountDelta(t("transfer"), "A")).toBe(-100n);
    expect(accountDelta(t("transfer"), "B")).toBe(100n);
    expect(accountDelta(t("lend"), "A")).toBe(-100n);
    expect(accountDelta(t("borrow"), "A")).toBe(100n);
    expect(accountDelta(t("repayment_received"), "A")).toBe(100n);
    expect(accountDelta(t("repayment_paid"), "A")).toBe(-100n);
    expect(iouDelta("lend", 100n)).toBe(100n);
    expect(iouDelta("repayment_paid", 100n)).toBe(100n);
    expect(iouDelta("borrow", 100n)).toBe(-100n);
    expect(iouDelta("repayment_received", 100n)).toBe(-100n);
    expect(iouDelta("expense", 100n)).toBe(0n);
    expect(iouDelta("transfer", 100n)).toBe(0n);
  });
  it("keeps owed-to-me and I-owe separate across people", () => {
    expect(iouTotals([500n, -200n, 0n, 300n])).toEqual({ owedToMe: 800n, iOwe: 200n });
    expect(describeIou(1n)).toBe("owes_me");
    expect(describeIou(-1n)).toBe("i_owe");
    expect(describeIou(0n)).toBe("settled");
  });
  it("asks for confirmation when crossing zero or over-repaying", () => {
    expect(needsCrossZeroConfirm("repayment_received", 500n, 0n)).toBe(false); // exact settle
    expect(needsCrossZeroConfirm("repayment_received", 500n, -100n)).toBe(true);
    expect(needsCrossZeroConfirm("repayment_received", 0n, -100n)).toBe(true);
    expect(needsCrossZeroConfirm("repayment_paid", -300n, 0n)).toBe(false);
    expect(needsCrossZeroConfirm("repayment_paid", 0n, 100n)).toBe(true);
    expect(needsCrossZeroConfirm("borrow", 200n, -300n)).toBe(true);
    expect(needsCrossZeroConfirm("borrow", 2000n, 1500n)).toBe(false);
    expect(needsCrossZeroConfirm("lend", 0n, 500n)).toBe(false);
  });
});

describe("budget status", () => {
  it("never divides by zero and labels unset budgets", () => {
    expect(budgetStatus(1000n, null)).toEqual({ state: "not_set", remaining: null, percent: null });
    expect(budgetStatus(0n, 1000n).state).toBe("ok");
    expect(budgetStatus(950n, 1000n).state).toBe("near");
    expect(budgetStatus(1001n, 1000n)).toMatchObject({ state: "over", remaining: -1n });
  });
});
