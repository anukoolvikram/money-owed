import { defineConfig } from "drizzle-kit";

// Only used from the terminal. Uses the schema-owning migration role.
export default defineConfig({
  dialect: "postgresql",
  schema: "./src/server/db/schema/index.ts",
  out: "./drizzle",
  dbCredentials: { url: process.env.MIGRATION_DATABASE_URL ?? "" },
  strict: true,
  verbose: true,
});
