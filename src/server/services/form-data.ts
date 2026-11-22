import type { OwnerContext } from "../auth/owner";
import type { Exec } from "./ledger-sql";
import { listAccounts } from "./accounts";
import { listCategories } from "./categories";
import { listPeople } from "./people";
import { ownerToday } from "./settings";

/** Minimal DTOs needed by the entry form. Includes archived refs only when editing them. */
export async function getEntryFormData(db: Exec, owner: OwnerContext, keep: { accountIds?: (string | null)[]; categoryId?: string | null; personId?: string | null } = {}) {
  const [accounts, categories, people, today] = await Promise.all([
    listAccounts(db, owner, { includeArchived: true }),
    listCategories(db, owner, { includeArchived: true }),
    listPeople(db, owner, { includeArchived: true }),
    ownerToday(db, owner),
  ]);
  const keepAcc = new Set((keep.accountIds ?? []).filter(Boolean));
  return {
    today,
    accounts: accounts
      .filter((a) => !a.archived || keepAcc.has(a.id))
      .map((a) => ({ id: a.id, name: a.archived ? `${a.name} (archived)` : a.name, kind: a.kind, balancePaise: a.balancePaise, openingDate: a.openingDate })),
    categories: categories
      .filter((c) => !c.archived || c.id === keep.categoryId)
      .map((c) => ({ id: c.id, name: c.name, kind: c.kind, useCount: c.useCount })),
    people: people
      .filter((p) => !p.archived || p.id === keep.personId)
      .map((p) => ({ id: p.id, name: p.name, label: p.label, netPaise: p.netPaise })),
  };
}
