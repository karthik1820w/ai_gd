import "dotenv/config";
import { defineConfig } from "prisma/config";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl || !/^postgres(ql)?:\/\//i.test(databaseUrl)) {
  throw new Error("DATABASE_URL must be set to a PostgreSQL connection string.");
}
if (process.env.DIRECT_URL && !/^postgres(ql)?:\/\//i.test(process.env.DIRECT_URL)) {
  throw new Error("DIRECT_URL must be a PostgreSQL connection string when set.");
}

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: { seed: "tsx prisma/seed.ts" },
  datasource: { url: process.env.DIRECT_URL || databaseUrl },
});
