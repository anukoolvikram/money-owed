import "server-only";
import { cache } from "react";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { auth } from "./auth";
import { db } from "../db/client";
import { resolveOwner, type OwnerContext } from "./owner";

export class UnauthorizedError extends Error {
  constructor() {
    super("Not signed in");
    this.name = "UnauthorizedError";
  }
}

/**
 * Validates the session against the database (no cookie cache) and confirms the
 * user is the singleton app owner. Returns null when either check fails.
 * Memoised per request with React cache().
 */
export const getOwner = cache(async (): Promise<OwnerContext | null> => {
  const h = await headers();
  let session;
  try {
    session = await auth().api.getSession({ headers: h, query: { disableCookieCache: true, disableRefresh: true } });
  } catch {
    return null;
  }
  if (!session) return null;
  return resolveOwner(db(), session.user.id, session.session.id);
});

/** For data access, server actions and route handlers: throws if not the owner. */
export async function requireOwner(): Promise<OwnerContext> {
  const owner = await getOwner();
  if (!owner) throw new UnauthorizedError();
  return owner;
}

/** For pages: redirects to the login page if not the owner. */
export async function requireOwnerPage(): Promise<OwnerContext> {
  const owner = await getOwner();
  if (!owner) redirect("/login");
  return owner;
}
