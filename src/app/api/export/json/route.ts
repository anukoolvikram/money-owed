import { requireOwner } from "@/server/auth/guard";
import { db } from "@/server/db/client";
import { PRIVATE_HEADERS } from "@/server/http";
import { exportBackup } from "@/server/services/backup";
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
  const [backup, today] = await Promise.all([exportBackup(db(), owner), ownerToday(db(), owner)]);
  return new Response(JSON.stringify(backup, null, 2), {
    headers: {
      ...PRIVATE_HEADERS,
      "Content-Type": "application/json; charset=utf-8",
      "Content-Disposition": `attachment; filename="ledger-backup-${today}.json"`,
    },
  });
}
