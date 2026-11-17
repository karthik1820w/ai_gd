import { prisma } from "@/lib/db";
import { fail, guardOrigin, json, readBody } from "@/lib/http";
import { requireUser } from "@/lib/guard";

export async function GET() {
  const { user, error } = await requireUser();
  if (!user) return error;
  const notifications = await prisma.notification.findMany({ where: { userId: user.id }, orderBy: { createdAt: "desc" }, take: 20 });
  return json(notifications);
}

export async function POST(request: Request) {
  const blocked = guardOrigin(request);
  if (blocked) return blocked;
  const { user, error } = await requireUser();
  if (!user) return error;
  const body = (await readBody(request)) as { ids?: string[] } | null;
  await prisma.notification.updateMany({
    where: { userId: user.id, id: body?.ids?.length ? { in: body.ids } : undefined, readAt: null },
    data: { readAt: new Date() },
  });
  return json({ ok: true });
}
