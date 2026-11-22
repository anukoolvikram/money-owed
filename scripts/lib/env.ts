// Terminal-only helpers. Loads .env.local (or the file in LEDGER_ENV_FILE) without printing values.
import { existsSync, readFileSync } from "node:fs";

export function loadEnvFile(): string {
  const file = process.env.LEDGER_ENV_FILE ?? ".env.local";
  if (!existsSync(file)) return "(environment only)";
  for (const line of readFileSync(file, "utf8").split(/\r?\n/)) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
    if (!m || line.trim().startsWith("#")) continue;
    let v = m[2];
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    if (process.env[m[1]] === undefined) process.env[m[1]] = v;
  }
  return file;
}

export function requireVar(name: string): string {
  const v = process.env[name];
  if (!v) {
    console.error(`Missing ${name}. Set it in your shell or env file (see README). Value is never printed.`);
    process.exit(1);
  }
  return v;
}

/** Describes a connection string without its password, for confirmation prompts. */
export function describeDbUrl(url: string): string {
  try {
    const u = new URL(url);
    return `${u.username || "(default user)"}@${u.hostname}:${u.port || "5432"}${u.pathname}`;
  } catch {
    return "(unparseable URL)";
  }
}
