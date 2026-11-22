"use server";
import { runAction } from "./run";
import { commitCsvImport, previewCsvImport } from "@/server/services/csv-io";
import { commitRestore, previewRestore } from "@/server/services/backup";

const MAX_TEXT = 1_600_000;
const asText = (v: unknown) => (typeof v === "string" && v.length <= MAX_TEXT ? v : "");

export async function previewCsvAction(text: unknown, options: unknown) {
  return runAction(async (db, o) => {
    const { preview } = await previewCsvImport(db, o, asText(text), options);
    // Cap rows sent back to the browser; all errors stay summarised in counts.
    const withProblems = preview.rows.filter((r) => r.errors.length || r.warnings.length);
    return { ...preview, rows: [...withProblems.slice(0, 200), ...preview.rows.filter((r) => !r.errors.length && !r.warnings.length).slice(0, 50)], totalRows: preview.rows.length };
  }, { refresh: false });
}

export async function commitCsvAction(text: unknown, options: unknown) {
  return runAction((db, o) => commitCsvImport(db, o, asText(text), options));
}

export async function previewRestoreAction(text: unknown) {
  return runAction(async (db, o) => (await previewRestore(db, o, asText(text))).preview, { refresh: false });
}

export async function commitRestoreAction(text: unknown) {
  return runAction((db, o) => commitRestore(db, o, asText(text)));
}
