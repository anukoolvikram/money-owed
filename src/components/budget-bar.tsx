import { formatINR } from "@/lib/money";
import { budgetStatus } from "@/lib/budget";
import { cx } from "./ui";

/** Budget progress with text labels (never colour alone, never divide by zero). */
export function BudgetBar({ spent, limit, label }: { spent: bigint; limit: bigint | null; label: string }) {
  const s = budgetStatus(spent, limit);
  if (s.state === "not_set") {
    return (
      <div className="flex justify-between text-sm">
        <span>{label}</span>
        <span className="text-muted">Not set · spent {formatINR(spent)}</span>
      </div>
    );
  }
  const width = Math.min(100, s.percent ?? 0);
  const text =
    s.state === "over" ? `Over by ${formatINR(-s.remaining!)}` : `${formatINR(s.remaining!)} left`;
  return (
    <div>
      <div className="flex flex-wrap justify-between gap-x-2 text-sm">
        <span>{label}</span>
        <span className={cx("num", s.state === "over" && "font-semibold text-danger")}>
          {formatINR(spent)} of {formatINR(limit!)} · {text}
        </span>
      </div>
      <div
        className="mt-1 h-2.5 rounded-full bg-surface-2"
        role="meter"
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(width)}
        aria-valuetext={`${s.percent}% used. ${text}`}
      >
        <div
          className={cx("h-2.5 rounded-full", s.state === "over" ? "bg-danger" : s.state === "near" ? "bg-warn" : "bg-accent")}
          style={{ width: `${Math.max(width, 1)}%` }}
        />
      </div>
      {s.state === "over" && <p className="mt-1 text-xs font-medium text-danger">Over budget</p>}
      {s.state === "near" && <p className="mt-1 text-xs font-medium text-warn">Almost at the limit</p>}
    </div>
  );
}
