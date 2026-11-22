/** Budget progress state. Never divides by zero; an unset limit is "not_set". */
export function budgetStatus(spent: bigint, limit: bigint | null) {
  if (limit === null) return { state: "not_set" as const, remaining: null, percent: null };
  const remaining = limit - spent;
  const percent = Number((spent * 1000n) / limit) / 10; // one decimal, display only
  return {
    state: spent > limit ? ("over" as const) : spent * 10n >= limit * 9n ? ("near" as const) : ("ok" as const),
    remaining,
    percent,
  };
}
