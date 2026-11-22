import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { ownerSettings } from "../db/schema";
import type { OwnerContext } from "../auth/owner";
import type { Exec } from "./ledger-sql";
import { DEFAULT_TZ, isValidTimezone, todayIn } from "@/lib/dates";
import { validation, zodFieldErrorsSafe } from "./util";

export type Settings = { timezone: string; cycleStartDay: number; theme: "system" | "light" | "dark" };

export async function getSettings(db: Exec, owner: OwnerContext): Promise<Settings> {
  const rows = await db
    .select({ timezone: ownerSettings.timezone, cycleStartDay: ownerSettings.cycleStartDay, theme: ownerSettings.theme })
    .from(ownerSettings)
    .where(eq(ownerSettings.ownerId, owner.ownerId));
  if (rows[0]) return rows[0];
  // Self-heal if the settings row is missing (e.g. restored database).
  await db.insert(ownerSettings).values({ ownerId: owner.ownerId }).onConflictDoNothing();
  return { timezone: DEFAULT_TZ, cycleStartDay: 1, theme: "system" };
}

export async function ownerToday(db: Exec, owner: OwnerContext): Promise<string> {
  const s = await getSettings(db, owner);
  return todayIn(s.timezone);
}

const settingsInput = z.object({
  timezone: z.string().refine(isValidTimezone, { message: "Choose a valid timezone." }),
  cycleStartDay: z.coerce.number().int().min(1, { message: "Use a day from 1 to 31." }).max(31, { message: "Use a day from 1 to 31." }),
  theme: z.enum(["system", "light", "dark"]),
});

export async function updateSettings(db: Exec, owner: OwnerContext, raw: unknown): Promise<Settings> {
  const parsed = settingsInput.safeParse(raw);
  if (!parsed.success) throw validation("Check the highlighted settings.", zodFieldErrorsSafe(parsed.error));
  await getSettings(db, owner);
  await db
    .update(ownerSettings)
    .set({ ...parsed.data, updatedAt: new Date() })
    .where(and(eq(ownerSettings.ownerId, owner.ownerId)));
  return parsed.data;
}
