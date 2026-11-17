import { prisma } from "@/lib/db";
import { fail, guardOrigin, json, readBody } from "@/lib/http";
import { requireUser } from "@/lib/guard";
import { inviteSchema } from "@/lib/validators";
import { seatsTaken, activeCode } from "@/server/access";
import { appOrigin, meetingUrl } from "@/server/ids";
import { sendMail } from "@/server/mail";
import { notify } from "@/server/notify";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const blocked = guardOrigin(request);
  if (blocked) return blocked;
  const { user, error } = await requireUser("HOST");
  if (!user) return error;
  const { id } = await context.params;
  const discussion = await prisma.discussion.findUnique({ where: { id } });
  if (!discussion || discussion.hostId !== user.id) return fail("Discussion not found.", 404);
  const parsed = inviteSchema.safeParse(await readBody(request));
  if (!parsed.success) return fail("Enter a valid email.");
  const invitee = await prisma.user.findUnique({ where: { email: parsed.data.email.toLowerCase() } });
  if (!invitee) return fail("No Quorum account uses that email yet. Share the meeting code so they can register and join.");
  if (invitee.id === user.id) return fail("You are already the host.");
  const existing = await prisma.discussionParticipant.findUnique({ where: { discussionId_userId: { discussionId: id, userId: invitee.id } } });
  if (existing && !existing.removed) return fail("They are already on the list.", 409);
  const seated = await seatsTaken(id, discussion.hostId);
  if (seated >= discussion.maxParticipants) return fail("This discussion is full.", 409);
  if (existing) await prisma.discussionParticipant.update({ where: { id: existing.id }, data: { removed: false, displayName: invitee.name } });
  else await prisma.discussionParticipant.create({ data: { discussionId: id, userId: invitee.id, displayName: invitee.name } });
  const code = await activeCode(id);
  const url = meetingUrl(appOrigin(request), discussion.meetingId, code?.code ?? "");
  await notify({ userId: invitee.id, discussionId: id, type: "INVITE", title: "You are invited to a discussion", body: `${discussion.title}: ${discussion.topic}`, href: url });
  await sendMail(invitee.email, `Invitation: ${discussion.title}`, `Join “${discussion.title}” on Quorum.\nTopic: ${discussion.topic}\n${url}`);
  return json({ ok: true });
}
