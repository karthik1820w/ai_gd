import "dotenv/config";
import { defineConfig } from "prisma/config";

// `prisma generate` runs on every `npm install` (postinstall) and never connects to the
// database, so it must work without DATABASE_URL (CI, Vercel's install step, fresh clones).
// Every command that does touch the database (db push, seed, studio) still requires a URL.
const generatingOnly = process.argv.includes("generate");

// DIRECT_URL is optional. Use it when DATABASE_URL is a transaction pooler (port 6543),
// which cannot run schema changes: point DIRECT_URL at a session/direct connection.
const url = process.env.DIRECT_URL || process.env.DATABASE_URL;

if (!url && !generatingOnly) {
  throw new Error("DATABASE_URL must be set to a PostgreSQL connection string.");
}

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: { seed: "tsx prisma/seed.ts" },
  datasource: { url: url || "postgresql://placeholder:placeholder@localhost:5432/placeholder" },
});
