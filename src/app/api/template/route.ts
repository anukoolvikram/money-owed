import { toCsv } from "@/lib/csv";
import { TEMPLATE_HEADERS } from "@/server/services/csv-io";

// Public, contains only fictional example rows.
export async function GET() {
  const csv = toCsv([
    TEMPLATE_HEADERS,
    ["2026-01-05", "expense", "250", "My bank", "", "Food", "", "", "upi", "Example lunch"],
    ["2026-01-06", "transfer", "1000", "My bank", "Cash", "", "", "", "", ""],
    ["2026-01-07", "lend", "500", "Cash", "", "", "Example person", "", "cash", ""],
  ]);
  return new Response(csv, { headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": 'attachment; filename="personal-ledger-template.csv"' } });
}
