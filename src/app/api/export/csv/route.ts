import { requireOwner } from "@/server/auth/guard";
import { db } from "@/server/db/client";
import { PRIVATE_HEADERS } from "@/server/http";
import { exportTransactionsCsv } from "@/server/services/csv-io";
import { ownerToday } from "@/server/services/settings";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  let owner;
  try {
    owner = await requireOwner();
  } catch {
    return new Response("Not signed in", { status: 401, headers: PRIVATE_HEADERS });
  }
  const [csv, today] = await Promise.all([exportTransactionsCsv(db(), owner), ownerToday(db(), owner)]);
  return new Response(csv, {
    headers: {
      ...PRIVATE_HEADERS,
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="ledger-transactions-${today}.csv"`,
    },
  });
}
