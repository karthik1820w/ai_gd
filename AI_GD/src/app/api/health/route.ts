import { prisma } from "@/lib/db";
import { json } from "@/lib/http";

export async function GET() {
  try {
    await prisma.$queryRaw`SELECT 1`;
    return json({ ok: true, ai: Boolean(process.env.AI_API_KEY && process.env.AI_BASE_URL) });
  } catch {
    return json({ ok: false }, 503);
  }
}
