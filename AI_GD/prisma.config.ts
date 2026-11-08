import "dotenv/config";
import { defineConfig } from "prisma/config";

process.env.DATABASE_URL ||= "file:./dev.db";

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: { seed: "tsx prisma/seed.ts" },
  datasource: { url: process.env.DATABASE_URL || "file:./dev.db" },
});
