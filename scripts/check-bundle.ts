// Scans the built client bundle (.next/static) for secrets, credentials and fixture data.
// Run after `npm run build`. Exits non-zero if anything sensitive is found.
import { readdirSync, readFileSync, statSync, existsSync } from "node:fs";
import { join } from "node:path";

function walk(dir: string, out: string[] = []): string[] {
  for (const f of readdirSync(dir)) {
    const p = join(dir, f);
    if (statSync(p).isDirectory()) walk(p, out);
    else out.push(p);
  }
  return out;
}

const secrets: string[] = [];
for (const file of [".env.local", ".env.test", ".env.production", ".env"]) {
  if (!existsSync(file)) continue;
  for (const line of readFileSync(file, "utf8").split(/\r?\n/)) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*"?(.*?)"?\s*$/.exec(line);
    if (m && /URL|SECRET|PASSWORD|TOKEN/.test(m[1]) && m[2] && !/^https?:\/\/localhost/.test(m[2])) secrets.push(m[2]);
  }
}
const patterns: (string | RegExp)[] = [
  ...secrets,
  /postgres(ql)?:\/\//i,
  "BETTER_AUTH_SECRET",
  "DATABASE_URL",
  "MIGRATION_DATABASE_URL",
  "fictional test passphrase",
  "fictional e2e passphrase",
  "$scrypt",
  "owner@example.test",
  "zz-private-marker",
];

const files = walk(".next/static").filter((f) => /\.(js|css|json|html|txt)$/.test(f));
let bad = 0;
for (const f of files) {
  const text = readFileSync(f, "utf8");
  for (const p of patterns) {
    if (typeof p === "string" ? text.includes(p) : p.test(text)) {
      console.error(`FOUND sensitive pattern in ${f}: ${typeof p === "string" && secrets.includes(p) ? "(a secret value)" : String(p)}`);
      bad++;
    }
  }
}
console.log(`Scanned ${files.length} client files for ${patterns.length} patterns.`);
if (bad) process.exit(1);
console.log("No secrets, credentials or fixture data found in the client bundle.");
