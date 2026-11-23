import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createHarness, idem, makeOwner, resetAll, type Harness } from "../helpers/db";
import type { OwnerContext } from "@/server/auth/owner";
import { createAccount, getAccount, listAccounts } from "@/server/services/accounts";
import { listPeople } from "@/server/services/people";
import { createQuickIou, updateQuickIou } from "@/server/services/quick-iou";
import { createPerson, removePerson, setPersonColor } from "@/server/services/people";
import { PERSON_COLOR_HEXES } from "@/lib/person-color";
import { getTransaction } from "@/server/services/transactions";
import { ServiceError } from "@/server/services/errors";
import { addDays, todayIn } from "@/lib/dates";

let h: Harness;
let owner: OwnerContext;
const TODAY = todayIn("Asia/Kolkata");
const net = async (name: string) => (await listPeople(h.db, owner)).find((p) => p.name === name)?.netPaise;

beforeAll(() => {
  h = createHarness();
});
afterAll(async () => {
  await h.close();
});
beforeEach(async () => {
  await resetAll(h);
  owner = await makeOwner(h);
});

describe("quick lend / borrow", () => {
  it("creates a new person and a Cash account when none exist", async () => {
    await createQuickIou(h.db, owner, { type: "lend", amount: "500", date: TODAY, newPersonName: "Ravi", idempotencyKey: idem() });
    expect(await net("Ravi")).toBe("50000");
    const accts = await listAccounts(h.db, owner);
    expect(accts.map((a) => a.name)).toEqual(["Cash"]);
    expect(accts[0].balancePaise).toBe("-50000");
  });

  it("reuses an existing person by id or by name, and borrowing goes negative", async () => {
    await createAccount(h.db, owner, { name: "Bank", kind: "bank", openingBalance: "1000", openingDate: addDays(TODAY, -30) });
    const r = await createQuickIou(h.db, owner, { type: "lend", amount: "200", date: TODAY, newPersonName: "Asha", idempotencyKey: idem() });
    await createQuickIou(h.db, owner, { type: "borrow", amount: "500", date: TODAY, personId: r.personId, idempotencyKey: idem() });
    await createQuickIou(h.db, owner, { type: "borrow", amount: "100", date: TODAY, newPersonName: "asha", idempotencyKey: idem() });
    expect((await listPeople(h.db, owner)).length).toBe(1);
    expect(await net("Asha")).toBe("-40000"); // 200 - 500 - 100: I have to give 400
  });

  it("is idempotent: a retry does not duplicate the person or the entry", async () => {
    const key = idem();
    const a = await createQuickIou(h.db, owner, { type: "lend", amount: "50", date: TODAY, newPersonName: "Kiran", idempotencyKey: key });
    const b = await createQuickIou(h.db, owner, { type: "lend", amount: "50", date: TODAY, newPersonName: "Kiran", idempotencyKey: key });
    expect(b.duplicate).toBe(true);
    expect(b.id).toBe(a.id);
    expect((await listPeople(h.db, owner)).length).toBe(1);
    expect(await net("Kiran")).toBe("5000");
  });

  it("rejects future dates and a missing person", async () => {
    await expect(createQuickIou(h.db, owner, { type: "lend", amount: "5", date: addDays(TODAY, 1), newPersonName: "X", idempotencyKey: idem() })).rejects.toBeInstanceOf(ServiceError);
    await expect(createQuickIou(h.db, owner, { type: "lend", amount: "5", date: TODAY, idempotencyKey: idem() })).rejects.toBeInstanceOf(ServiceError);
    expect((await listPeople(h.db, owner)).length).toBe(0);
  });

  it("records against the cash account first", async () => {
    const bank = (await createAccount(h.db, owner, { name: "Bank", kind: "bank", openingBalance: "1000", openingDate: addDays(TODAY, -30) })).id;
    const cash = (await createAccount(h.db, owner, { name: "Wallet", kind: "cash", openingBalance: "0", openingDate: addDays(TODAY, -30) })).id;
    await createQuickIou(h.db, owner, { type: "borrow", amount: "300", date: TODAY, newPersonName: "Meera", idempotencyKey: idem() });
    expect((await getAccount(h.db, owner, cash)).balancePaise).toBe("30000");
    expect((await getAccount(h.db, owner, bank)).balancePaise).toBe("100000");
  });

  it("allows back-dated entries for people and accounts that started at zero", async () => {
    const p = (await createPerson(h.db, owner, { name: "Dev", openingIou: "0", openingDate: TODAY })).id;
    await createQuickIou(h.db, owner, { type: "lend", amount: "10", date: TODAY, personId: p, idempotencyKey: idem() });
    await createQuickIou(h.db, owner, { type: "lend", amount: "20", date: addDays(TODAY, -10), personId: p, idempotencyKey: idem() });
    expect(await net("Dev")).toBe("3000");
  });

  it("edits amount, type, person and date of an entry", async () => {
    const a = await createQuickIou(h.db, owner, { type: "lend", amount: "100", date: TODAY, newPersonName: "Om", idempotencyKey: idem() });
    const b = await createQuickIou(h.db, owner, { type: "lend", amount: "1", date: TODAY, newPersonName: "Zoya", idempotencyKey: idem() });
    const t = await getTransaction(h.db, owner, a.id);
    await updateQuickIou(h.db, owner, { id: a.id, version: t.version, type: "borrow", amount: "70", date: addDays(TODAY, -3), note: "fixed", personId: b.personId });
    expect(await net("Om")).toBe("0");
    expect(await net("Zoya")).toBe("-6900");
    const after = await getTransaction(h.db, owner, a.id);
    expect(after.note).toBe("fixed");
    expect(after.date).toBe(addDays(TODAY, -3));
  });

  it("removing a person deletes their transactions and restores account balances", async () => {
    const a = await createQuickIou(h.db, owner, { type: "lend", amount: "100", date: TODAY, newPersonName: "Neel", idempotencyKey: idem() });
    await createQuickIou(h.db, owner, { type: "borrow", amount: "30", date: TODAY, personId: a.personId, idempotencyKey: idem() });
    await createQuickIou(h.db, owner, { type: "lend", amount: "5", date: TODAY, newPersonName: "Other", idempotencyKey: idem() });
    expect(await removePerson(h.db, owner, a.personId)).toEqual({ deletedEntries: 2 });
    expect((await listPeople(h.db, owner, { includeArchived: true })).map((p) => p.name)).toEqual(["Other"]);
    expect((await listAccounts(h.db, owner))[0].balancePaise).toBe("-500");
  });

  it("gives new people different colour tags and lets the colour be changed", async () => {
    for (const n of ["A", "B", "C", "D", "E", "F"]) await createPerson(h.db, owner, { name: n, openingIou: "0", openingDate: TODAY });
    await createQuickIou(h.db, owner, { type: "lend", amount: "1", date: TODAY, newPersonName: "G", idempotencyKey: idem() });
    const list = await listPeople(h.db, owner);
    const colors = list.map((p) => p.color);
    expect(colors.every((c) => c && PERSON_COLOR_HEXES.includes(c))).toBe(true);
    expect(new Set(colors).size).toBe(7); // all different while the palette has room
    await setPersonColor(h.db, owner, { id: list[0].id, color: PERSON_COLOR_HEXES[0] });
    expect((await listPeople(h.db, owner))[0].color).toBe(PERSON_COLOR_HEXES[0]);
    await expect(setPersonColor(h.db, owner, { id: list[0].id, color: "#123456" })).rejects.toBeInstanceOf(ServiceError);
  });
});
