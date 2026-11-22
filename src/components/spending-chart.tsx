"use client";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { formatINR } from "@/lib/money";
import { formatDate } from "@/lib/dates";

type Point = { date: string; spentPaise: string };

/**
 * Daily spending for the current cycle. Single series, so no legend: the
 * heading names it. Exact totals are always shown as text alongside, and a
 * table view is available for screen readers and precise reading.
 */
export function SpendingChart({ data }: { data: Point[] }) {
  // Numbers are only for drawing bar heights; every label uses exact paise strings.
  const rows = data.map((d) => ({ ...d, day: Number(d.date.slice(8)), rupees: Number(BigInt(d.spentPaise)) / 100 }));
  return (
    <figure>
      <div className="h-40 w-full" aria-hidden>
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={rows} margin={{ top: 8, right: 4, bottom: 0, left: 4 }} barCategoryGap={2}>
            <CartesianGrid vertical={false} stroke="var(--border)" strokeWidth={1} />
            <XAxis dataKey="day" tickLine={false} axisLine={{ stroke: "var(--border)" }} tick={{ fill: "var(--muted)", fontSize: 11 }} interval="preserveStartEnd" minTickGap={16} />
            <YAxis hide domain={[0, "auto"]} />
            <Tooltip
              cursor={{ fill: "var(--surface-2)" }}
              content={({ active, payload }) => {
                const p = active && payload?.[0]?.payload as (Point & { day: number }) | undefined;
                if (!p) return null;
                return (
                  <div className="rounded-lg border border-line bg-surface px-2 py-1 text-xs text-ink shadow">
                    <div className="text-muted">{formatDate(p.date)}</div>
                    <div className="num font-semibold">{formatINR(BigInt(p.spentPaise))}</div>
                  </div>
                );
              }}
            />
            <Bar dataKey="rupees" fill="var(--chart)" radius={[4, 4, 0, 0]} maxBarSize={24} isAnimationActive={false} />
          </BarChart>
        </ResponsiveContainer>
      </div>
      <details className="mt-2 text-sm">
        <summary className="inline-flex min-h-11 cursor-pointer items-center text-accent">Show as table</summary>
        <table className="mt-2 w-full text-sm">
          <caption className="sr-only">Spending per day</caption>
          <thead>
            <tr className="text-left text-muted">
              <th scope="col" className="py-1 font-medium">Date</th>
              <th scope="col" className="py-1 text-right font-medium">Spent</th>
            </tr>
          </thead>
          <tbody>
            {data.filter((d) => d.spentPaise !== "0").map((d) => (
              <tr key={d.date} className="border-t border-line">
                <td className="py-1">{formatDate(d.date)}</td>
                <td className="num py-1 text-right">{formatINR(BigInt(d.spentPaise))}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </figure>
  );
}
