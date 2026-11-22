import type { Metadata } from "next";
import { requireOwnerPage } from "@/server/auth/guard";
import { db } from "@/server/db/client";
import { listCategories } from "@/server/services/categories";
import { Card, Main, PageHeader, SectionTitle } from "@/components/ui";
import { AddCategoryForm, CategoryRow } from "@/components/category-forms";

export const metadata: Metadata = { title: "Categories" };

export default async function CategoriesPage() {
  const owner = await requireOwnerPage();
  const cats = await listCategories(db(), owner, { includeArchived: true });
  const groups = [
    { title: "Expense", items: cats.filter((c) => c.kind === "expense" && !c.archived) },
    { title: "Income", items: cats.filter((c) => c.kind === "income" && !c.archived) },
    { title: "Archived", items: cats.filter((c) => c.archived) },
  ];
  return (
    <>
      <PageHeader title="Categories" back="/more" />
      <Main>
        <Card><AddCategoryForm /></Card>
        <p className="mt-3 text-sm text-muted">Categories with entries can’t be deleted — archive them to hide them from the add screen while keeping history.</p>
        {groups.map((g) => g.items.length > 0 && (
          <div key={g.title}>
            <SectionTitle>{g.title}</SectionTitle>
            <Card className="py-1"><ul className="divide-y divide-line">{g.items.map((c) => <CategoryRow key={c.id} c={c} />)}</ul></Card>
          </div>
        ))}
      </Main>
    </>
  );
}
