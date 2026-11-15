import { prisma } from "@/lib/db";
import { describeDbError } from "@/lib/dbHints";
import { json } from "@/lib/http";
import { aiEnabled } from "@/server/ai";

const REQUIRED = ["DATABASE_URL", "JWT_SECRET", "HOST_EMAIL", "HOST_PASSWORD"] as const;

/** Open /api/health on your deployment to see what is wrong. Shows which settings are present (never their values). */
export async function GET() {
  const settings = Object.fromEntries(REQUIRED.map((name) => [name, Boolean(process.env[name]?.trim())]));
  const missing = REQUIRED.filter((name) => !settings[name]);
  try {
    await prisma.$queryRaw`SELECT 1`;
    await prisma.user.count(); // fails with a clear hint if the tables were never created
    return json({ ok: missing.length === 0, database: "ok", settings, hint: missing.length ? `Missing settings: ${missing.join(", ")}.` : undefined, ai: aiEnabled() }, missing.length ? 503 : 200);
  } catch (error) {
    console.error("Health check failed.", error);
    return json({ ok: false, database: "failed", settings, hint: missing.includes("DATABASE_URL") ? "DATABASE_URL is not set in Vercel. Add it and redeploy." : describeDbError(error) }, 503);
  }
}
