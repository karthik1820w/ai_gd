import { PrismaClient } from "@prisma/client";
import { withPoolerSettings } from "@/lib/dbHints";

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

const url = withPoolerSettings(process.env.DATABASE_URL);

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    ...(url ? { datasources: { db: { url } } } : {}),
    log: process.env.NODE_ENV === "development" ? ["error", "warn"] : ["error"],
  });

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;
