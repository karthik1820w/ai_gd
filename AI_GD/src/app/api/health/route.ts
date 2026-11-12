import { prisma } from "@/lib/db";
import { json } from "@/lib/http";
import { aiEnabled } from "@/server/ai";

export async function GET() {
  try {
    await prisma.$queryRaw`SELECT 1`;
    return json({ ok: true, ai: aiEnabled() });
  } catch {
    return json({ ok: false }, 503);
  }
}
