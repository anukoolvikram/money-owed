// Neutral defaults created for a new owner. No transactions or balances are seeded.
export const DEFAULT_CATEGORIES: { name: string; kind: "expense" | "income" }[] = [
  { name: "Food", kind: "expense" },
  { name: "Groceries", kind: "expense" },
  { name: "Transport", kind: "expense" },
  { name: "Shopping", kind: "expense" },
  { name: "Bills", kind: "expense" },
  { name: "Health", kind: "expense" },
  { name: "Entertainment", kind: "expense" },
  { name: "Travel", kind: "expense" },
  { name: "Other", kind: "expense" },
  { name: "Salary", kind: "income" },
  { name: "Freelance", kind: "income" },
  { name: "Interest", kind: "income" },
  { name: "Gifts received", kind: "income" },
  { name: "Other income", kind: "income" },
];
