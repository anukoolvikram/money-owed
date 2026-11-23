"use server";
// Server actions. Each one independently checks origin + owner via runAction.
// Inputs are validated by the service layer with Zod; ids from the client are
// only ever used together with the session-derived owner id.
import { runAction } from "./run";
import * as tx from "@/server/services/transactions";
import * as acc from "@/server/services/accounts";
import * as cat from "@/server/services/categories";
import * as ppl from "@/server/services/people";
import * as quick from "@/server/services/quick-iou";
import * as bud from "@/server/services/budgets";
import * as set from "@/server/services/settings";
import { cookies } from "next/headers";

export async function createTransactionAction(input: unknown) {
  return runAction((db, o) => tx.createTransaction(db, o, input));
}
export async function updateTransactionAction(input: unknown) {
  return runAction((db, o) => tx.updateTransaction(db, o, input));
}
export async function deleteTransactionAction(input: unknown) {
  return runAction((db, o) => tx.deleteTransaction(db, o, input));
}

export async function quickIouAction(input: unknown) {
  return runAction((db, o) => quick.createQuickIou(db, o, input));
}

export async function updateQuickIouAction(input: unknown) {
  return runAction((db, o) => quick.updateQuickIou(db, o, input));
}

export async function createAccountAction(input: unknown) {
  return runAction((db, o) => acc.createAccount(db, o, input));
}
export async function updateAccountAction(input: unknown) {
  return runAction((db, o) => acc.updateAccount(db, o, input));
}
export async function archiveAccountAction(id: unknown, archived: unknown) {
  return runAction((db, o) => acc.setAccountArchived(db, o, String(id), archived === true));
}
export async function deleteAccountAction(id: unknown) {
  return runAction((db, o) => acc.deleteAccount(db, o, String(id)));
}

export async function createCategoryAction(input: unknown) {
  return runAction((db, o) => cat.createCategory(db, o, input));
}
export async function renameCategoryAction(input: unknown) {
  return runAction((db, o) => cat.renameCategory(db, o, input));
}
export async function archiveCategoryAction(id: unknown, archived: unknown) {
  return runAction((db, o) => cat.setCategoryArchived(db, o, String(id), archived === true));
}
export async function deleteCategoryAction(id: unknown) {
  return runAction((db, o) => cat.deleteCategory(db, o, String(id)));
}

export async function createPersonAction(input: unknown) {
  return runAction((db, o) => ppl.createPerson(db, o, input));
}
export async function updatePersonAction(input: unknown) {
  return runAction((db, o) => ppl.updatePerson(db, o, input));
}
export async function archivePersonAction(id: unknown, archived: unknown) {
  return runAction((db, o) => ppl.setPersonArchived(db, o, String(id), archived === true));
}
export async function removePersonAction(id: unknown) {
  return runAction((db, o) => ppl.removePerson(db, o, String(id)));
}
export async function setPersonColorAction(input: unknown) {
  return runAction((db, o) => ppl.setPersonColor(db, o, input));
}
export async function deletePersonAction(id: unknown) {
  return runAction((db, o) => ppl.deletePerson(db, o, String(id)));
}

export async function setBudgetAction(input: unknown) {
  return runAction((db, o) => bud.setBudget(db, o, input));
}

export async function updateSettingsAction(input: unknown) {
  const r = await runAction((db, o) => set.updateSettings(db, o, input));
  if (r.ok) {
    // Theme is a harmless display preference; a cookie lets the layout render it without a flash.
    (await cookies()).set("ledger_theme", r.data.theme, { httpOnly: false, sameSite: "lax", secure: process.env.NODE_ENV === "production", path: "/", maxAge: 60 * 60 * 24 * 365 });
  }
  return r;
}
