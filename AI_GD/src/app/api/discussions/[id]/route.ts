import { unlink } from "fs/promises";
import { prisma } from "@/lib/db";
import { fail, json } from "@/lib/http";
import { requireUser } from "@/lib/guard";
import { readBrief } from "@/server/brief";

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const { user, error } = await requireUser();
  if (!user) return error;
  const { id } = await context.params;
  const discussion = await prisma.discussion.findUnique({
    where: { id },
    include: {
      accessCodes: { where: { active: true }, take: 1 },
      participants: { include: { user: { select: { email: true, name: true } }, stat: true } },
      evaluations: true,
    },
  });
  if (!discussion) return fail("Discussion not found.", 404);
  const member = discussion.participants.some((participant) => participant.userId === user.id && !participant.removed);
  if (discussion.hostId !== user.id && !member) return fail("You cannot view this discussion.", 403);
  if (discussion.hostId === user.id) return json(discussion);
  const own = discussion.participants.find((person) => person.userId === user.id);
  const storedBrief = await readBrief(discussion.aiBrief);
  const publicBrief = storedBrief ? { ...storedBrief, rubric: undefined, misconceptions: undefined } : null;
  return json({
    ...discussion,
    aiBrief: publicBrief ? JSON.stringify(publicBrief) : null,
    context: "",
    accessCodes: [],
    evaluations: discussion.evaluations.filter((item) => item.participantId === own?.id),
    participants: discussion.participants.map((person) => person.userId === user.id ? person : { ...person, stat: null, user: { name: person.user.name, email: "" } }),
  });
}

export async function DELETE(_request: Request, context: { params: Promise<{ id: string }> }) {
  const { user, error } = await requireUser("HOST");
  if (!user) return error;
  const { id } = await context.params;
  const discussion = await prisma.discussion.findUnique({ where: { id }, include: { recordings: true } });
  if (!discussion || discussion.hostId !== user.id) return fail("Discussion not found.", 404);
  if (discussion.status === "LIVE") return fail("End the live discussion before deleting it.", 409);
  for (const recording of discussion.recordings) await unlink(recording.path).catch(() => undefined);
  await prisma.discussion.delete({ where: { id } });
  return json({ ok: true });
}
